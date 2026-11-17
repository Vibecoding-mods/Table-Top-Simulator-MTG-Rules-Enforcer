// Builds the friend package for Linux (Steam Deck) and macOS: MTG-Table-linux-x64-<date>.tar.gz and
// MTG-Table-macos-<arch>-<date>.tar.gz, each one folder of the same name. The friend unpacks it, runs start.sh
// (Linux) or double-clicks "MTG Companion.command" (Mac) and opens the status page in a browser. The companion is
// companion-node/ (plain JavaScript, shipped as the files themselves) run by the official Node.js binary for that
// platform, which this script takes from an archive you downloaded from nodejs.org: it downloads nothing and never
// runs the binary it ships.
//   node tools/make-friend-package-unix.js --node <dir|archive> [--platform linux-x64|macos-arm64|macos-x64|all]
//     --node <dir|archive>  node-v<ver>-linux-x64.tar.xz / -darwin-arm64.tar.gz / -darwin-x64.tar.gz, or a folder
//                           holding them (and SHASUMS256.txt, which is then required to list them), or an already
//                           extracted node-v<ver>-<os>-<arch> folder. Archives are extracted into a new empty temp
//                           folder, only bin/node and LICENSE.
//     --platform            default linux-x64; "all" for the three
//     --repo <dir>          the repo whose deployed stack, bridge, decks, table patcher and licences are shipped (default:
//                           this tree). The companion always comes from this tree's companion-node/.
//     --out <dir>           default <repo>/dist
//     --no-images           images/ left empty (no docker save): quick runs
//     --images-tar <file>   use a docker save tar made before (checked against the deploy record like a fresh one)
//     --allow-undeployed-bridge   as tools/make-friend-package.js
// It refuses, saying why, when the deploy record disagrees with the images, the running containers or the table the
// sources make from this PC's Workshop copy (the repo's own refusals()). Like the Windows package it ships NO table,
// only our patcher in table/ (the companion makes the table from the host's own subscribed copy), and it never
// writes in TTS's folders.
//
// The layout (companion-node/logic.js makeLayout is the contract):
//   start.sh, stop.sh                         (Linux) or "MTG Companion.command", "Stop MTG.command" (Mac)
//   version.json                              as the Windows package's, plus platform and nodeArchive
//   runtime/node/bin/node, runtime/node/LICENSE   the official Node.js, byte for byte from its archive
//   companion/                                companion-node/ byte for byte, plus page.html (the status page, from
//                                             companion/src/WebPage.cs) and release-keys.txt (the public key)
//   bridge/ decks/ manabrew/public/preset_decks/ scenarios/ stack/ images/ table/ (the patcher) logs/ LICENSES/   as on Windows
//   README-FRIEND-LINUX.txt or README-FRIEND-MAC.txt
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync, spawn } = require("child_process");
const { pipeline } = require("stream/promises");

const TREE = path.join(__dirname, "..");
const COMPANION = path.join(TREE, "companion-node");
const stop = (why) => { console.error(`make-friend-package-unix stopped: ${why}`); process.exit(1); };
const flag = (name) => process.argv.includes(`--${name}`);
const option = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sha256File = async (file) => { const h = crypto.createHash("sha256"); for await (const c of fs.createReadStream(file)) h.update(c); return h.digest("hex"); };

const PLATFORMS = {
  "linux-x64": { os: "linux", arch: "x64", node: "linux-x64", readme: "README-FRIEND-LINUX.txt" },
  "macos-arm64": { os: "darwin", arch: "arm64", node: "darwin-arm64", readme: "README-FRIEND-MAC.txt" },
  "macos-x64": { os: "darwin", arch: "x64", node: "darwin-x64", readme: "README-FRIEND-MAC.txt" },
};

// ───────── pure parts (tests/test_friend_package_unix.js) ─────────

// ── a tar (ustar, PAX for long or non-ASCII names) with the modes the friend's tar must keep: 0755 for node and the
// launchers. Windows' tar.exe can't set modes from here, so the archive is written by hand.

function octal(n, width) { return `${n.toString(8).padStart(width - 1, "0")}\0`; }
function header(name, size, mode, mtime, type, prefix) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write(octal(mode, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(mtime, 12), 136, "ascii");
  h.fill(0x20, 148, 156);
  h.write(type, 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  if (prefix) h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return h;
}
// ustar's name/prefix split: [prefix, name], or null when the name needs a PAX record
function splitName(name) {
  if (/[^\x20-\x7e]/.test(name)) return null;
  if (name.length <= 100) return ["", name];
  for (let i = name.lastIndexOf("/", 155); i > 0; i = name.lastIndexOf("/", i - 1)) {
    if (name.length - i - 1 <= 100 && name.length - i - 1 > 0) return [name.slice(0, i), name.slice(i + 1)];
  }
  return null;
}
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return Buffer.from(`${len}${body}`, "utf8");
}
const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512);
// the blocks that start one entry (its headers): name ends with "/" for a directory
function entryHead(name, size, mode, mtime) {
  const dir = name.endsWith("/");
  const split = splitName(name);
  if (split) return [header(split[1], dir ? 0 : size, mode, mtime, dir ? "5" : "0", split[0])];
  const rec = paxRecord("path", name);
  const short = Buffer.from(name.replace(/[^\x20-\x7e]/g, "_")).subarray(0, 99).toString("latin1");
  return [header("PaxHeader/x", rec.length, 0o644, mtime, "x"), rec, pad(rec.length), header(short, dir ? 0 : size, mode, mtime, dir ? "5" : "0")];
}

// Writes entries [{ name, mode, data (Buffer) | file (path) | dir: true }] as a gzipped tar to `out` (a writable
// stream). Directories the entries sit in are added first, 0755. Resolves when everything is written.
async function writeTarGz(entries, out, { mtime = Math.floor(Date.now() / 1000), level = 6 } = {}) {
  const gz = zlib.createGzip({ level });
  const done = pipeline(gz, out);
  const put = (b) => (gz.write(b) ? Promise.resolve() : new Promise((r) => gz.once("drain", r)));
  const dirs = new Set();
  for (const e of entries) {
    const parts = e.name.replace(/\/$/, "").split("/");
    for (let i = 1; i < (e.dir ? parts.length + 1 : parts.length); i++) {
      const d = `${parts.slice(0, i).join("/")}/`;
      if (dirs.has(d)) continue;
      dirs.add(d);
      for (const b of entryHead(d, 0, 0o755, mtime)) await put(b);
    }
    if (e.dir) continue;
    const size = e.data ? e.data.length : fs.statSync(e.file).size;
    for (const b of entryHead(e.name, size, e.mode, mtime)) await put(b);
    if (e.data) await put(e.data);
    else {
      let n = 0;
      for await (const c of fs.createReadStream(e.file)) { n += c.length; await put(c); }
      if (n !== size) throw new Error(`${e.file} changed size while it was packed`);
    }
    await put(pad(size));
  }
  await put(Buffer.alloc(1024));
  gz.end();
  await done;
}

// Reads a gzipped tar back (the test, and the check after a build): [{ name, mode, size, type, data? }]. wanted(name):
// keep that entry's bytes.
async function readTarGz(stream, wanted = () => true) {
  const out = [];
  let head = Buffer.alloc(0), cur = null, left = 0, padLeft = 0, pax = null, sumBad = 0;
  const finish = () => {
    if (cur.parts) cur.data = Buffer.concat(cur.parts);
    delete cur.parts;
    if (cur.type === "x") pax = (/(?:^|\n)\d+ path=([^\n]*)\n/.exec(cur.data.toString("utf8")) || [])[1] || null;
    else out.push(cur);
    cur = null;
  };
  for await (let c of stream.pipe(zlib.createGunzip())) {
    while (c.length) {
      if (left) { const n = Math.min(left, c.length); if (cur.parts) cur.parts.push(c.subarray(0, n)); left -= n; c = c.subarray(n); if (!left) finish(); continue; }
      if (padLeft) { const n = Math.min(padLeft, c.length); padLeft -= n; c = c.subarray(n); continue; }
      const need = 512 - head.length;
      head = Buffer.concat([head, c.subarray(0, need)]); c = c.subarray(need);
      if (head.length < 512) break;
      const h = head; head = Buffer.alloc(0);
      if (h.every((b) => b === 0)) continue;
      const s = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0[\s\S]*$/, "");
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
      if (sum !== parseInt(s(148, 156).trim(), 8)) sumBad++;
      const prefix = s(257, 263) === "ustar" ? s(345, 500) : "";
      let name = (prefix ? `${prefix}/` : "") + s(0, 100);
      const type = s(156, 157) || "0";
      if (type !== "x" && pax) { name = pax; pax = null; }
      if (type === "5" && !name.endsWith("/")) name += "/";
      cur = { name, mode: parseInt(s(100, 108), 8), size: parseInt(s(124, 136).trim() || "0", 8), type };
      left = cur.size; padLeft = Math.ceil(cur.size / 512) * 512 - cur.size;
      if (type === "x" || (type === "0" && wanted(name))) cur.parts = [];
      if (!left) finish();
    }
  }
  if (sumBad) throw new Error(`${sumBad} tar headers with a wrong checksum`);
  return out;
}

// ── the launchers: short, readable, LF. Each one only runs the bundled node on companion/companion.js.
const LAUNCH_HEAD = (what) => `#!/bin/sh
# ${what}
# It runs companion/companion.js (plain JavaScript: read it, or companion/README.txt) with the official Node.js in
# runtime/node. Nothing else is started from here.
cd "$(dirname "$0")" || exit 1
`;
const launchers = (platform) => {
  const mac = PLATFORMS[platform].os === "darwin";
  const start = `${LAUNCH_HEAD("Starts the MTG Companion. Its status page opens in your browser; keep this window open while you play.")}exec ./runtime/node/bin/node companion/companion.js "$@"
`;
  const stopIt = `${LAUNCH_HEAD("Stops the MTG bridge and the engine's containers (Docker or Podman keeps running). During a game: add --force.")}exec ./runtime/node/bin/node companion/companion.js --stop "$@"
`;
  return mac ? { "MTG Companion.command": start, "Stop MTG.command": stopIt } : { "start.sh": start, "stop.sh": stopIt };
};

// the package's entries as tools/make-friend-package.js tableCopies() reads them: paths inside the package folder, and
// the whole text of every file that starts like JSON (win.jsonText: a TTS save's ObjectStates can be far in)
function tableCheckEntries(entries, folder) {
  const win = require("./make-friend-package");
  const text = (e) => {
    if (e.data) return win.jsonText(e.data.subarray(0, 64), e.data.length, () => e.data);
    const fd = fs.openSync(e.file, "r");
    let head;
    try { const b = Buffer.alloc(64); head = b.subarray(0, fs.readSync(fd, b, 0, b.length, 0)); } finally { fs.closeSync(fd); }
    return win.jsonText(head, fs.statSync(e.file).size, () => fs.readFileSync(e.file));
  };
  return entries.filter((e) => !e.dir).map((e) => {
    const rel = e.name.startsWith(`${folder}/`) ? e.name.slice(folder.length + 1) : e.name;
    return { rel, text: text(e) };
  });
}

// every file of companion-node, byte for byte, as package entries under companion/
function companionEntries(dir, extra) {
  const walk = (rel) => {
    const p = path.join(dir, rel);
    return fs.statSync(p).isDirectory() ? fs.readdirSync(p).sort().flatMap((f) => walk(rel ? `${rel}/${f}` : f)) : [rel];
  };
  const out = walk("").map((rel) => ({ name: `companion/${rel}`, mode: rel === "shim/docker" ? 0o755 : 0o644, data: fs.readFileSync(path.join(dir, rel)), from: path.join(dir, rel) }));
  for (const [rel, data] of Object.entries(extra)) out.push({ name: `companion/${rel}`, mode: 0o644, data: Buffer.from(data) });
  return out;
}

// Why a file shipped to be read isn't plainly readable ([] when it is): minified, packed or encoded code
function unreadable(name, text) {
  const out = [];
  const lines = text.split("\n");
  if (/\r/.test(text) && /\.(sh|command)$|(^|\/)docker$/.test(name)) out.push(`${name} has CR line ends (sh can't run it)`);
  const long = lines.findIndex((l) => l.length > 1000);
  if (long >= 0) out.push(`${name}:${long + 1} is ${lines[long].length} characters long (minified?)`);
  const b64 = /[A-Za-z0-9+/]{200,}={0,2}/.exec(text);
  if (b64) out.push(`${name} holds ${b64[0].length} characters of base64 (embedded code?)`);
  if (/\beval\s*\(|new Function\s*\(|\bvm\.(runIn|Script)|require\(["']vm["']\)/.test(text)) out.push(`${name} evaluates code from a string`);
  if (/\.min\.js$/.test(name)) out.push(`${name} is a minified file`);
  return out;
}

// Mach-O / ELF: the binary is for that platform (the archive's own bin/node; never run here)
function binaryKind(head) {
  if (head.readUInt32BE(0) === 0x7f454c46) return { os: "linux", arch: head.readUInt16LE(18) === 0x3e ? "x64" : head.readUInt16LE(18) === 0xb7 ? "arm64" : "?" };
  if (head.readUInt32LE(0) === 0xfeedfacf) { const cpu = head.readUInt32LE(4); return { os: "darwin", arch: cpu === 0x01000007 ? "x64" : cpu === 0x0100000c ? "arm64" : "?" }; }
  if (head.readUInt32BE(0) === 0xcafebabe) return { os: "darwin", arch: "universal" };
  return { os: "?", arch: "?" };
}

// the node archive for a platform in a folder: { file, version } or null
function findNodeArchive(dir, platform) {
  const re = new RegExp(`^node-(v\\d+\\.\\d+\\.\\d+)-${PLATFORMS[platform].node}\\.tar\\.(xz|gz)$`);
  const hits = fs.readdirSync(dir).map((f) => [f, re.exec(f)]).filter(([, m]) => m).sort((a, b) => b[1][1].localeCompare(a[1][1], undefined, { numeric: true }));
  return hits.length ? { file: path.join(dir, hits[0][0]), version: hits[0][1][1] } : null;
}
// SHASUMS256.txt's line for a file name: the hex, or null
function shasumFor(text, name) {
  const m = new RegExp(`^([0-9a-f]{64})\\s+\\*?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").exec(text || "");
  return m ? m[1] : null;
}

// ───────── the READMEs ─────────

// what every host needs beside its own system (the Windows README's HOST REQUIREMENTS says the same)
const hostCommon = (engine) => `- At least 4 CPU cores and 16 GB of RAM recommended. The engine uses 2 cores and about 8 GB inside ${engine}; TTS
  and the system need the rest. These are estimates, not measured limits.
- The tables, subscribed on the Steam Workshop (this package doesn't include them; the companion makes the
  rules-engine table from your own copy):
    4 players: https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369
    6 players: https://steamcommunity.com/sharedfiles/filedetails/?id=2293586471
  After subscribing, start TTS once so Steam downloads them.`;

const readmeLinux = (v) => `MTG Table (rules engine) for Linux and the Steam Deck - host it on your own computer
===================================================================================

Rules-enforced Commander in Tabletop Simulator: the Forge rules engine runs the game, asks the questions (targets,
blockers, triggers) and moves the cards. This folder lets YOU host it. Friends who join your game need only TTS.

Package: built ${v.built.slice(0, 10)}, bridge ${v.bridge}, table ${v.table}, for Linux on x86-64 (Steam Deck, or a PC).


HOST REQUIREMENTS (the computer that runs the engine; friends who only join need just TTS)
- Linux on an x86-64 processor. On a Steam Deck: SteamOS 3.5 or newer, used in Desktop Mode.
- Tabletop Simulator (Steam). The Linux version and the Windows version through Proton both work.
- Podman (the Steam Deck has it built in) or Docker. Check in a terminal (Konsole on the Deck):
      podman info
  It should print a page about the host, not an error. On another Linux: install podman from your distribution
  (e.g. sudo apt install podman), or use Docker if you have it (your account must be in the "docker" group:
  sudo usermod -aG docker "$USER", then sign out and back in). Podman and Docker Engine need no BIOS setting;
  Docker Desktop for Linux does: SVM (AMD) or VT-x (Intel) on in the BIOS, and /dev/kvm usable
  (sudo usermod -aG kvm "$USER"). More help: docs/docker-setup.md in the project's repository.
- About 3 GB of free disk: about 1.5 GB for the engine inside Podman (in ~/.local/share/containers) and about
  1.2 GB for this folder (the .tar.gz can be deleted once it is unpacked).
- A web browser on the same computer, for the companion's status page.
${hostCommon("Podman")}


FIRST TIME (Steam Deck)
1. Hold the power button > Switch to Desktop.
2. Put the .tar.gz in a plain folder of your home, e.g. /home/deck/Games. In Dolphin (the file manager): right-click
   it > Extract > Extract archive here. You get the folder
      ${v.folder}
   Don't put it on an SD card formatted for Windows (exFAT/NTFS): the programs in it need Linux file permissions.
3. Open the folder in Dolphin, right-click an empty spot > Open Terminal Here (or open Konsole and type
   cd ~/Games/${v.folder}). Then type:
      ./start.sh
4. The status page opens in your browser (if not, open the address the terminal prints, http://127.0.0.1:48790/).
   The companion checks everything, but starts nothing yet. Press "Start engine" (under Actions). The first start
   takes a few minutes while it loads the engine into Podman. It also makes the table from your Workshop copy
   (subscribe first: HOST REQUIREMENTS) and puts it in your TTS saves. Then it starts the engine and the bridge and
   opens Tabletop Simulator.
   Keep the terminal window open while you play: closing it stops the companion (the engine and the bridge keep
   running, and the next ./start.sh finds them running).


EVERY GAME NIGHT
1. In the folder: ./start.sh, press "Start engine" on the status page, and wait until its lights are green. The
   TTS light stays amber until the table is loaded (step 2).
2. In TTS: Create > Multiplayer (so friends can join; Singleplayer to play alone against the AI)
   > Games > Save & Load > "${v.saveName}".
3. Friends join your server (Steam invite, or the server browser). They need nothing but TTS.
4. Everyone sits at a colour, brings a deck with the table's Card Importer, and presses READY? on their playmat.
   Turn the engine on with the middle tile (Engine: on), then press Start. Against the computer: type
   "mtg start ai 1" in chat (up to 3 AI players).
5. When you are done: "Stop everything" on the status page, or ./stop.sh in the folder, or just shut down.
   During a game ./stop.sh refuses (it would end the game for everyone); ./stop.sh --force stops it anyway.
   Back to Gaming Mode afterwards: the engine needs nothing from Desktop Mode once it is stopped.


IF A LIGHT IS RED
Each red light says what is wrong and has one button that fixes it. The usual ones:
- Container engine: Podman isn't working. Type podman info in a terminal and read its error. "Docker" or "Podman"
  is named on the light, whichever the companion uses.
- Engine stack: press "Restart relay and room". This happens after the Deck slept. If a game was being set up,
  type "mtg reset" in TTS chat first.
- Bridge: press "Start the bridge". If it says another program holds port 39998, close the TTS extension of VS Code
  or Atom (they use the same port). If it says the folder can't be written to, move the folder (FIRST TIME, step 2).
- Table save: "Subscribe to the table on the Steam Workshop": do that, start TTS once so it downloads, then press
  "Try again". If it says a patch didn't apply, the table's author changed it on the Workshop since this package was
  made: ask whoever gave you this for a newer package. Otherwise it says which folder it looked for. TTS keeps its
  saves in ~/.local/share/Tabletop Simulator/Saves (the Linux version), or inside Steam's Proton folder for TTS when
  only the Windows version was ever started. Start TTS once, then press Try again.
- TTS: red when the table loaded in TTS isn't this package's. Load "${v.saveName}" again (step 2 above).
Fix buttons that restart things are locked while a game is on, so a fix never ends a game by surprise.
Still stuck: Ctrl+C in the terminal, ./start.sh again. Then send the files in the "logs" folder to whoever gave you
this.


UPDATES
The companion checks for a newer release now and then and says so on the status page. It doesn't install updates
here: download the new package, "Stop everything" in the old one, unpack the new one next to it and start that.


PRIVACY
Everything here listens on your own computer only (127.0.0.1). Nothing is opened to the internet; TTS's own
multiplayer is how your friends reach the table. Card pictures come from Scryfall.
The status page's access token can be read by other accounts on this same computer: if others have their own
account on it, only run the companion if you trust them.


WHAT RUNS, AND HOW TO READ IT
Nothing in this folder is encrypted, compiled, minified or obfuscated:
- start.sh and stop.sh are a few lines of shell; read them in any text editor.
- They run companion/companion.js with runtime/node/bin/node. The companion folder IS the companion's source
  (plain JavaScript; companion/README.txt says what each file does). runtime/node/bin/node is the official Node.js
  ${v.nodeVersion} from nodejs.org, unchanged (version.json "nodeArchive" has the archive's name and sha256).
- The bridge (bridge/*.js) is plain JavaScript too.
- The engine runs in two containers from images/mtg-images.tar; how they are built is in LICENSES/SOURCE.txt.
To check the companion's own rules: runtime/node/bin/node companion/companion.js --selftest


LICENCES
See the LICENSES folder. The rules engine is built from Forge (GPL-3.0) and Manabrew (AGPL-3.0-or-later); its
source is described in LICENSES/SOURCE.txt. Node.js is MIT (LICENSES/Node-LICENSE.txt). Magic: The Gathering is (c)
Wizards of the Coast; this is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy,
not approved or endorsed by Wizards.


MADE WITH CLAUDE CODE
This project was made with Claude Code (https://claude.com/claude-code), Anthropic's AI coding assistant: it wrote
the code, the tests and these instructions.
`;

const readmeMac = (v) => `MTG Table (rules engine) for macOS - host it on your own Mac
===========================================================

Rules-enforced Commander in Tabletop Simulator: the Forge rules engine runs the game, asks the questions (targets,
blockers, triggers) and moves the cards. This folder lets YOU host it. Friends who join your game need only TTS.

Package: built ${v.built.slice(0, 10)}, bridge ${v.bridge}, table ${v.table}, for ${v.arch === "arm64" ? "Macs with Apple Silicon (M1 or newer)" : "Macs with an Intel processor"}.


HOST REQUIREMENTS (the Mac that runs the engine; friends who only join need just TTS)
- macOS 12 or newer${v.arch === "arm64" ? " on an Apple Silicon Mac (an Intel Mac needs the macos-x64 package)" : " on an Intel Mac (an Apple Silicon Mac needs the macos-arm64 package)"}.
- Tabletop Simulator (Steam).
- Docker Desktop: https://www.docker.com/products/docker-desktop/  Install it, start it once and finish its
  first-run screens yourself (sign-in is optional). It asks for your Mac password once, to install its helper:
  that's the Mac's "run as administrator". Macs need no BIOS setting. If it won't start, Docker Desktop's
  Troubleshoot (bug icon) > Restart; more help in docs/docker-setup.md in the project's repository.${v.arch === "arm64" ? `
  The engine is built for Intel (x86-64) processors and runs on Apple Silicon through emulation: in Docker
  Desktop > Settings > General, turn on "Use Rosetta for x86_64/amd64 emulation on Apple Silicon" (macOS 13 or
  newer). Without it Docker uses a much slower emulator, and the engine may take minutes to answer.` : ""}
- About 3 GB of free disk: about 1.5 GB for the engine inside Docker and about 1.2 GB for this folder (the .tar.gz
  can be deleted once it is unpacked).
${hostCommon("Docker")}


FIRST TIME
1. Double-click the .tar.gz to unpack it. Move the folder it makes,
      ${v.folder}
   to a plain folder of your own, e.g. a Games folder in your home. Not into iCloud Drive (synced folders get in the
   way).
2. Start Docker Desktop and wait until it says it is running.
3. Double-click "MTG Companion.command". The launcher isn't signed, so the first time macOS may refuse it: then
   right-click it > Open > Open. (If macOS still refuses, open Terminal and run
       xattr -dr com.apple.quarantine <drag the folder here>
   which removes the "downloaded from the internet" mark from this folder only.)
   A Terminal window opens: keep it open while you play.
4. The status page opens in your browser (if not, open the address the Terminal prints, http://127.0.0.1:48790/).
   The companion checks everything, but starts nothing yet. Press "Start engine" (under Actions). The first start
   takes a few minutes while it loads the engine into Docker. It also makes the table from your Workshop copy
   (subscribe first: HOST REQUIREMENTS) and puts it in your TTS saves. Then it starts the engine and opens TTS.


EVERY GAME NIGHT
1. Double-click "MTG Companion.command", press "Start engine" on the status page, and wait until its lights are
   green. The TTS light stays amber until the table is loaded (step 2).
2. In TTS: Create > Multiplayer (so friends can join; Singleplayer to play alone against the AI)
   > Games > Save & Load > "${v.saveName}".
3. Friends join your server (Steam invite, or the server browser). They need nothing but TTS.
4. Everyone sits at a colour, brings a deck with the table's Card Importer, and presses READY? on their playmat.
   Turn the engine on with the middle tile (Engine: on), then press Start. Against the computer: type
   "mtg start ai 1" in chat (up to 3 AI players).
5. When you are done: "Stop everything" on the status page, or double-click "Stop MTG.command", or just shut down.
   During a game "Stop MTG.command" refuses (it would end the game for everyone); in Terminal in this folder,
   ./"Stop MTG.command" --force stops it anyway.


IF A LIGHT IS RED
Each red light says what is wrong and has one button that fixes it. The usual ones:
- Container engine: Docker Desktop isn't running: press "Start Docker Desktop" and wait a minute.
- Engine stack: press "Restart relay and room". This happens after the Mac slept or Docker restarted. If a game was
  being set up, type "mtg reset" in TTS chat first.
- Bridge: press "Start the bridge". If it says another program holds port 39998, close the TTS extension of VS Code
  or Atom (they use the same port). If it says the folder can't be written to, move the folder (FIRST TIME, step 1).
- TTS: red when the table loaded in TTS isn't this package's. Load "${v.saveName}" again (step 2 above).
Fix buttons that restart things are locked while a game is on, so a fix never ends a game by surprise.
Still stuck: close the Terminal window, double-click "MTG Companion.command" again. Then send the files in the
"logs" folder to whoever gave you this.


UPDATES
The companion checks for a newer release now and then and says so on the status page. It doesn't install updates
here: download the new package, "Stop everything" in the old one, unpack the new one next to it and start that.


PRIVACY
Everything here listens on your own Mac only (127.0.0.1). Nothing is opened to the internet; TTS's own multiplayer
is how your friends reach the table. Card pictures come from Scryfall.
The status page's access token can be read by other accounts on this same Mac: on a shared Mac, only run the
companion from an account whose other users you trust.


WHAT RUNS, AND HOW TO READ IT
Nothing in this folder is encrypted, compiled, minified or obfuscated:
- "MTG Companion.command" and "Stop MTG.command" are a few lines of shell; open them in TextEdit to read them.
- They run companion/companion.js with runtime/node/bin/node. The companion folder IS the companion's source
  (plain JavaScript; companion/README.txt says what each file does). runtime/node/bin/node is the official Node.js
  ${v.nodeVersion} from nodejs.org, unchanged and signed by the Node.js project (version.json "nodeArchive" has
  the archive's name and sha256).
- The bridge (bridge/*.js) is plain JavaScript too.
- The engine runs in two containers from images/mtg-images.tar; how they are built is in LICENSES/SOURCE.txt.
To check the companion's own rules, in Terminal in this folder: runtime/node/bin/node companion/companion.js --selftest


LICENCES
See the LICENSES folder. The rules engine is built from Forge (GPL-3.0) and Manabrew (AGPL-3.0-or-later); its
source is described in LICENSES/SOURCE.txt. Node.js is MIT (LICENSES/Node-LICENSE.txt). Magic: The Gathering is (c)
Wizards of the Coast; this is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy,
not approved or endorsed by Wizards.


MADE WITH CLAUDE CODE
This project was made with Claude Code (https://claude.com/claude-code), Anthropic's AI coding assistant: it wrote
the code, the tests and these instructions.
`;

const sourceText = (v) => `Source of the rules engine in images/mtg-images.tar
====================================================

The two container images in this package (${v.images.join(", ")}) are built from public source:

- Manabrew (relay and self-hosted node), https://github.com/witchesofthehill/manabrew
  at commit ${v.manabrewCommit}, licensed AGPL-3.0-or-later (see Manabrew-LICENSE.md and the licence texts here),
  with our changes in source/manabrew.patch (AGPL-3.0-or-later).
- Forge (the rules engine inside the node image), https://github.com/witchesofthehill/forge
  at commit ${v.forgeCommit}, licensed GPL-3.0 (Forge-LICENSE.txt), with our changes in source/forge.patch (GPL-3.0).

source/build-images.sh fetches those exact commits, applies the two patches beside it and builds both images:
    bash build-images.sh        (run in the source folder; needs Docker, git and several GB of disk; about 20 minutes)
The images are linux/amd64.

The bridge, the companion, the table script and the tools (everything else in this package that isn't Node.js) are
ours and in the public domain (LICENSE, the Unlicense). They talk to the engine over its network protocol as a
separate program. runtime/node is Node.js ${v.nodeVersion} (MIT, Node-LICENSE.txt, the licence file from its archive).

Patches shipped: manabrew.patch sha8 ${v.patches.manabrew}, forge.patch sha8 ${v.patches.forge}.
If you received this package and want the complete source in another form, ask the person who gave it to you.
`;

// ───────── reading this PC ─────────

function nodeRuntime(input, platform, scratch) {
  const st = fs.statSync(input);
  // an extracted folder: <input>/bin/node, or <input>/node-v*-<os>-<arch>/bin/node
  if (st.isDirectory()) {
    const sub = fs.readdirSync(input).find((f) => new RegExp(`^node-v[\\d.]+-${PLATFORMS[platform].node}$`).test(f) && fs.statSync(path.join(input, f)).isDirectory());
    const dir = fs.existsSync(path.join(input, "bin", "node")) ? input : sub ? path.join(input, sub) : null;
    if (dir) {
      const version = (/node-(v\d+\.\d+\.\d+)-/.exec(path.basename(dir)) || [])[1] || null;
      return { node: path.join(dir, "bin", "node"), license: path.join(dir, "LICENSE"), version, archive: null };
    }
    const a = findNodeArchive(input, platform);
    if (!a) stop(`no node-v*-${PLATFORMS[platform].node}.tar.xz/.tar.gz (or extracted folder) in ${input}`);
    return fromArchive(a.file, a.version, platform, scratch, path.join(input, "SHASUMS256.txt"));
  }
  const m = /^node-(v\d+\.\d+\.\d+)-(\S+?)\.tar\.(xz|gz)$/.exec(path.basename(input));
  if (!m) stop(`${input} isn't a node-v<version>-<os>-<arch>.tar.xz/.tar.gz archive`);
  if (m[2] !== PLATFORMS[platform].node) stop(`${input} is for ${m[2]}, not ${PLATFORMS[platform].node}`);
  return fromArchive(input, m[1], platform, scratch, path.join(path.dirname(input), "SHASUMS256.txt"));
}
// only bin/node and LICENSE, into a new empty folder; the archive's sha256 checked against SHASUMS256.txt beside it
function fromArchive(file, version, platform, scratch, sums) {
  const hash = sha256(fs.readFileSync(file));
  const listed = fs.existsSync(sums) ? shasumFor(fs.readFileSync(sums, "utf8"), path.basename(file)) : null;
  if (fs.existsSync(sums) && !listed) stop(`${path.basename(file)} isn't listed in ${sums}`);
  if (listed && listed !== hash) stop(`${path.basename(file)} has sha256 ${hash}, but ${sums} says ${listed}`);
  if (!listed) console.log(`  (no SHASUMS256.txt beside ${path.basename(file)}: its sha256 ${hash} is recorded, not checked)`);
  const top = `node-${version}-${PLATFORMS[platform].node}`;
  const dir = fs.mkdtempSync(path.join(scratch, `${top}-`));
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-x", "-f", file, "-C", dir, `${top}/bin/node`, `${top}/LICENSE`], { stdio: ["ignore", "inherit", "inherit"], timeout: 300000 });
  const node = path.join(dir, top, "bin", "node"), license = path.join(dir, top, "LICENSE");
  for (const f of [node, license]) if (!fs.existsSync(f) || fs.lstatSync(f).isSymbolicLink() || !fs.statSync(f).isFile()) stop(`${file} has no plain ${path.relative(dir, f)}`);
  return { node, license, version, archive: { file: path.basename(file), sha256: hash, checked: !!listed } };
}

async function saveImages(file, versions, pack, deployed) {
  const p = spawn("docker", ["save", pack.IMAGES.relay, pack.IMAGES.node], { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => { err += d; });
  const exited = new Promise((done) => p.on("close", done));
  await pipeline(p.stdout, fs.createWriteStream(file));
  const code = await exited;
  if (code !== 0) stop(`docker save failed (${code}): ${err.trim()}`);
  return checkImages(file, pack, deployed);
}
async function checkImages(file, pack, deployed) {
  const { text } = await pack.tarRead(fs.createReadStream(file), ["index.json", "manifest.json"]);
  const held = pack.tarImages(text);
  const wrong = pack.tarMismatch(held, deployed);
  if (wrong.length) stop(wrong.join("; "));
  return held;
}

const docker = (args) => { try { return execFileSync("docker", args, { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []);
function treeCommit() {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: TREE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "companion-node", "tools/make-friend-package-unix.js"], { cwd: TREE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch { return null; }
}

async function main() {
  const repo = path.resolve(option("repo", TREE));
  const pack = require(path.join(repo, "tools", "make-friend-package.js"));
  const versions = require(path.join(repo, "bridge", "versions.js"));
  const { pageFromCs } = require(path.join(COMPANION, "web.js"));
  const want = option("platform", "linux-x64");
  const platforms = want === "all" ? Object.keys(PLATFORMS) : want.split(",");
  for (const p of platforms) if (!PLATFORMS[p]) stop(`--platform ${p}: one of ${Object.keys(PLATFORMS).join(", ")}, or all`);
  const nodeIn = option("node", null);
  if (!nodeIn || !fs.existsSync(nodeIn)) stop("--node <dir|archive>: the official Node.js archive(s) from nodejs.org (nothing is downloaded here)");
  const noImages = flag("no-images");

  // what was deployed, and whether this PC still agrees with it (the repo's own checks)
  const deployed = versions.readManifest();
  if (flag("allow-changed-save")) stop("--allow-changed-save is gone: the package ships no save (the companion makes the table from the host's Workshop copy)");
  const tables = require(path.join(repo, "tools", "make-table.js"));
  const made4p = pack.readTable();
  const compose = fs.readFileSync(path.join(repo, "stack", "compose.yml"), "utf8");
  const containers = await new Promise((done) => versions.containerImages(done));
  const bridge = versions.bridgeHash();
  const tags = {};
  for (const k of ["node", "relay"]) tags[k] = docker(["image", "inspect", "-f", "{{.Id}}", pack.IMAGES[k]]);
  const why = pack.refusals({ deployed, tags, containers, table: made4p, bridge, compose }, { allowUndeployedBridge: flag("allow-undeployed-bridge") });
  if (why.length) stop(`stack/deployed.json disagrees with what would be shipped:\n  - ${why.join("\n  - ")}`);

  const licences = {
    "LICENSE": path.join(repo, "LICENSE"), "THIRD-PARTY-NOTICES.md": path.join(repo, "THIRD-PARTY-NOTICES.md"),
    "Forge-LICENSE.txt": path.join(repo, "manabrew", "forge", "LICENSE"),
    "Manabrew-LICENSE.md": path.join(repo, "manabrew", "LICENSE.md"),
    "Manabrew-LICENSE-AGPL-3.0-or-later.txt": path.join(repo, "manabrew", "LICENSE-AGPL-3.0-or-later"),
    "Manabrew-LICENSE-GPL-3.0-or-later.txt": path.join(repo, "manabrew", "LICENSE-GPL-3.0-or-later"),
    "source/manabrew.patch": path.join(repo, "engine", "manabrew.patch"), "source/forge.patch": path.join(repo, "engine", "forge.patch"),
    "source/build-images.sh": path.join(repo, "engine", "build-images.sh"),
  };
  for (const [to, from] of Object.entries(licences)) if (!fs.existsSync(from)) stop(`LICENSES/${to} would come from ${from}, which is missing`);
  for (const f of pack.BRIDGE_SHIPPED.slice(0, 3)) if (!fs.existsSync(path.join(repo, "bridge", f))) stop(`bridge/${f} is missing`);
  const pinned = (name) => (fs.readFileSync(licences["source/build-images.sh"], "utf8").match(new RegExp(`^${name}=(\\w+)`, "m")) || [])[1] || "?";

  // the companion: every file of companion-node, and the two it reads beside itself
  const cs = path.join(TREE, "companion", "src", "WebPage.cs");
  const keys = path.join(TREE, "companion", "release-keys.txt");
  if (!fs.existsSync(cs)) stop(`${cs} is missing (the status page)`);
  const page = pageFromCs(fs.readFileSync(cs, "utf8"));
  if (!page || !page.includes("{{TOKEN}}")) stop("the status page couldn't be read from companion/src/WebPage.cs");
  const keyText = fs.existsSync(keys) ? fs.readFileSync(keys, "utf8") : "";
  if (/PRIVATE KEY/.test(keyText)) stop("companion/release-keys.txt holds a private key");
  const comp = companionEntries(COMPANION, { "page.html": page, ...(keyText ? { "release-keys.txt": keyText } : {}) });
  const bad = comp.filter((e) => /\.(js|html|txt)$|(^|\/)docker$/.test(e.name)).flatMap((e) => unreadable(e.name, e.data.toString("utf8")));
  if (bad.length) stop(`not plainly readable:\n  - ${bad.join("\n  - ")}`);

  const out = path.resolve(option("out", path.join(repo, "dist")));
  fs.mkdirSync(out, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-unix-pkg-"));
  const d = new Date();
  const date = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");

  try {
    // the Node runtimes first (cheap, and a bad archive stops the build before the docker save)
    const runtimes = {};
    for (const p of platforms) {
      const r = nodeRuntime(path.resolve(nodeIn), p, scratch);
      const kind = binaryKind(fs.readFileSync(r.node).subarray(0, 64));
      if (kind.os !== PLATFORMS[p].os || (kind.arch !== PLATFORMS[p].arch && kind.arch !== "universal")) stop(`${r.node} is a ${kind.os}/${kind.arch} binary, not ${p}`);
      if (!r.version || Number(r.version.slice(1).split(".")[0]) < 22) stop(`Node ${r.version || "?"} for ${p}: the bridge needs 22 or newer (built-in WebSocket)`);
      runtimes[p] = r;
      console.log(`  ${p}: Node ${r.version}${r.archive ? ` from ${r.archive.file} (sha256 ${r.archive.checked ? "matches SHASUMS256.txt" : "not checked"})` : " (extracted folder)"}`);
    }

    // the images: one docker save for every platform (the images are linux/amd64 on all of them)
    let imagesTar = null, held = {};
    if (noImages) {
      for (const k of ["node", "relay"]) held[pack.IMAGES[k]] = { id: deployed[k] };
      console.log("  --no-images: images/ left empty");
    } else if (option("images-tar", null)) {
      imagesTar = path.resolve(option("images-tar"));
      held = await checkImages(imagesTar, pack, deployed);
      console.log(`  images: ${imagesTar} (${mb(fs.statSync(imagesTar).size)}), the deployed ids`);
    } else {
      imagesTar = path.join(scratch, "mtg-images.tar");
      console.log(`  docker save ${pack.IMAGES.relay} ${pack.IMAGES.node} (a few minutes)`);
      held = await saveImages(imagesTar, versions, pack, deployed);
      for (const k of ["node", "relay"]) if (docker(["image", "inspect", "-f", "{{.Id}}", pack.IMAGES[k]]) !== deployed[k]) stop("an image tag moved during docker save: run it again");
    }

    // what every platform shares
    const shared = [];
    const file = (name, from, mode = 0o644) => shared.push({ name, mode, file: from });
    for (const f of versions.BRIDGE_FILES) file(`bridge/${path.basename(f)}`, f);
    for (const f of pack.BRIDGE_SHIPPED) if (fs.existsSync(path.join(repo, "bridge", f))) file(`bridge/${f}`, path.join(repo, "bridge", f));
    const packaged = versions.sha8(versions.BRIDGE_FILES.map((f) => fs.readFileSync(f, "utf8")).join("\0"));
    if (packaged !== bridge) stop(`the packaged bridge hashes to ${packaged}, not ${bridge}`);
    const counts = pack.DATA_DIRS.map((dir) => { const names = jsonFiles(path.join(repo, dir)); for (const n of names) file(`${dir}/${n}`, path.join(repo, dir, n)); return names.length; });
    // the table: our patcher, never the table itself (the companion makes it from the host's Workshop copy)
    for (const f of tables.PATCHER_FILES) file(`table/${f}`, path.join(repo, "tools", f));
    shared.push({ name: "table/README.txt", mode: 0o644, data: Buffer.from(pack.tableReadme()) });
    shared.push({ name: "stack/compose.yml", mode: 0o644, data: Buffer.from(`# On Linux and macOS the companion runs these two containers with plain run commands, the same settings
# (companion/platform.js runArgs), with Docker or Podman; no compose is needed. This file is the reference.
${pack.composeYaml()}`) });
    if (imagesTar) file("images/mtg-images.tar", imagesTar);
    shared.push({ name: "logs/", dir: true });
    for (const [to, from] of Object.entries(licences)) file(`LICENSES/${to}`, from);

    const built = new Date().toISOString();
    const save8 = made4p.save;
    const TABLE = tables.TABLES["4p"];
    const made = [];
    for (const p of platforms) {
      const P = PLATFORMS[p], r = runtimes[p];
      const name = `MTG-Table-${p}-${date}`;
      const info = {
        bridge, table: made4p.stamp, save: save8, node: deployed.node, relay: deployed.relay, built, gitCommit: treeCommit(),
        deployed: { bridge: deployed.bridge, save: deployed.save, at: deployed.at },
        images: held, imagesFile: imagesTar ? "images/mtg-images.tar" : null, nodeVersion: r.version, saveName: pack.SAVE_NAME, composeProject: pack.PROJECT,
        workshop: { id: TABLE.id, url: TABLE.url, sha8: made4p.workshop },
        tables: tables.versionTables(),
        platform: p, companion: "node", nodeArchive: r.archive ? { file: r.archive.file, sha256: r.archive.sha256 } : null,
      };
      const v = { ...info, folder: name, arch: P.arch };
      const entries = [
        ...Object.entries(launchers(p)).map(([n, text]) => ({ name: n, mode: 0o755, data: Buffer.from(text) })),
        { name: "version.json", mode: 0o644, data: Buffer.from(`${JSON.stringify(info, null, 1)}\n`) },
        { name: "runtime/node/bin/node", mode: 0o755, file: r.node },
        { name: "runtime/node/LICENSE", mode: 0o644, file: r.license },
        ...comp,
        ...shared,
        { name: "stack/deployed.json", mode: 0o644, data: Buffer.from(`${JSON.stringify(pack.deployedRecord(deployed, { bridge, save: save8, at: built, images: held }), null, 1)}\n`) },
        { name: "LICENSES/Node-LICENSE.txt", mode: 0o644, file: r.license },
        { name: "LICENSES/SOURCE.txt", mode: 0o644, data: Buffer.from(sourceText({ images: [pack.IMAGES.relay, pack.IMAGES.node], manabrewCommit: pinned("MANABREW_COMMIT"), forgeCommit: pinned("FORGE_COMMIT"), nodeVersion: r.version, patches: { manabrew: versions.sha8(fs.readFileSync(licences["source/manabrew.patch"])), forge: versions.sha8(fs.readFileSync(licences["source/forge.patch"])) } })) },
        { name: P.readme, mode: 0o644, data: Buffer.from((P.os === "darwin" ? readmeMac : readmeLinux)(v)) },
      ].map((e) => ({ ...e, name: `${name}/${e.name}` }));
      const dup = entries.map((e) => e.name).find((n, i, all) => all.indexOf(n) !== i);
      if (dup) stop(`${dup} twice in the package`);
      const copies = pack.tableCopies(tableCheckEntries(entries, name));
      if (copies.length) stop(`the package would hand out a copy of a Workshop table (Steam lets subscribers use it, not distribute it): ${copies.join(", ")}`);
      const target = path.join(out, `${name}.tar.gz`);
      const tmp = `${target}.part`;
      console.log(`  writing ${target}`);
      await writeTarGz(entries, fs.createWriteStream(tmp), { mtime: Math.floor(Date.parse(built) / 1000) });
      fs.renameSync(tmp, target);
      made.push(target);
    }
    console.log(`  decks: ${counts[0]} ours, ${counts[1]} Manabrew's; ${counts[2]} debug scenarios; companion: ${comp.length} files from companion-node`);
    for (const f of made) console.log(`made ${f} (${mb(fs.statSync(f).size)})`);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

if (require.main === module) main().catch((e) => stop(e.stack || e.message));
module.exports = { writeTarGz, readTarGz, splitName, paxRecord, launchers, companionEntries, tableCheckEntries, unreadable, binaryKind, findNodeArchive, shasumFor, readmeLinux, readmeMac, sourceText, PLATFORMS };
