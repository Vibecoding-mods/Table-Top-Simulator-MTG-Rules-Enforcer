// Builds the friend package: one folder, and a zip of it, that lets a friend host the rules-enforced Commander table
// on their own Windows PC. The friend has Docker Desktop and nothing else of ours: no Node, no repo. They double-click
// MTG Companion.exe (companion/, built here when companion/build.cmd exists), which loads the engine images, starts the
// relay and the room, runs the bridge from this folder and opens TTS; in TTS they load "MTG Table (rules engine)".
//   node tools/make-friend-package.js                 dist/MTG-Table-<date>-<bridge>/ and dist/MTG-Table-<date>-<bridge>.zip
//   node tools/make-friend-package.js --no-images     without images/ (no docker save, which takes minutes): quick runs
//   --allow-undeployed-bridge   ship bridge code that isn't the deployed one (stack/deployed.json `bridge`)
//   --allow-changed-save        ship a save whose bytes changed since the deploy (its table stamp must still match)
//   --companion <dir>           the tree that holds companion/build.cmd (default: this repo)
//   --out <dir>                 where the package goes (default: dist/)
// It refuses, saying why, when stack/deployed.json disagrees with the images it would ship, the running engine
// containers or the save file. It only reads the TTS save; it never writes in the Saves folder.
//
// The layout is the contract with the companion app (keep the two in step):
//   MTG Companion.exe             or "MTG Companion - NOT BUILT.txt" when there is no companion/build.cmd
//   version.json                  { bridge, table, save, node, relay, built, gitCommit, ... } (versionInfo below)
//   runtime/node/node.exe         this PC's Node
//   bridge/                       the bridge's code (bridge/versions.js BRIDGE_FILES) and the data it reads
//   decks/                        our decks; manabrew/public/preset_decks/: Manabrew's (bridge/presets.js)
//   stack/compose.yml             relay + forge-room, project "mtg-table", ports on 127.0.0.1
//   stack/deployed.json           the deploy record the bridge's /versions compares with (bridge = the packaged code)
//   images/mtg-images.tar         docker save of both engine images (plain: their layers are gzip already, see below)
//   table/MTG Table.json (+ .png) the deployed save, SaveName "MTG Table (rules engine)"
//   logs/                         empty; the bridge writes here when started with MTG_LOG_DIR=<package>\logs
//   README-FRIEND.txt, LICENSES/
const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { pipeline } = require("stream/promises");
const versions = require("../bridge/versions");

const ROOT = path.join(__dirname, "..");
const SAVE = process.env.MTG_SAVE || path.join(process.env.USERPROFILE || "", "Documents/My Games/Tabletop Simulator/Saves/TS_Save_1.json"); // (as tools/patch-save.js)
const SAVE_NAME = "MTG Table (rules engine)";
const PROJECT = "mtg-table"; // the package's compose project: containers mtg-table-relay-1, mtg-table-forge-room-1
const IMAGES = { relay: "mtg-relay:exile", node: "mtg-forge-node:exile" };
// What the bridge reads beside its code (path.join(__dirname, ...) in bridge.js). The image cache is git-ignored and
// rebuilt from Scryfall when missing, so it is shipped when there is one.
const BRIDGE_DATA = ["forge-cards.json", "token-scripts.json"];
const BRIDGE_CACHE = ["image-cache-klrmngr.json"];
const DEFAULT_DECKS_RE = /const DEFAULT_DECKS = (\[[^\]]*\]);/; // the AI's decks when none was chosen (bridge.js)
const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"); // Windows' bsdtar writes zips

const sha8 = versions.sha8;
const stop = (why) => { console.error(`make-friend-package stopped: ${why}`); process.exit(1); };
const flag = (name) => process.argv.includes(`--${name}`);
const option = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

// ───────── pure parts (tests/test_friend_package.js) ─────────

// The table script's version stamp in a save's text: the string, or null when the script has none
function stampOf(saveText) {
  const m = /function engineStamp\(\) return "([^"]*)" end/.exec(JSON.parse(saveText).LuaScript || "");
  return m ? m[1] : null;
}

// The save with its top-level SaveName replaced and every other byte kept (TTS lists a save by this name)
function renameSave(raw, name) {
  const re = /^(\s*"SaveName":\s*)"(?:[^"\\]|\\.)*"/m; // (the first key of a TTS save; nested objects have no SaveName)
  if (!re.test(raw)) throw new Error("no SaveName in the save");
  const out = raw.replace(re, (_, lead) => `${lead}${JSON.stringify(name)}`);
  if (JSON.parse(out).SaveName !== name) throw new Error("SaveName didn't change");
  return out;
}

// Why the package can't be built, from what was read: [] when everything agrees with the deploy record.
// read: { deployed, tags: { node, relay } (image ids of the tags, null = missing), containers: { node, relay } (null =
// Docker can't say), save: { stamp, sha8 } | null, bridge (the code's hash), compose (stack/compose.yml's text) }
function refusals(read, opts = {}) {
  const { deployed: d } = read;
  if (!d) return ["stack/deployed.json is missing: nothing was deployed (node tools/deploy.js)"];
  const out = [];
  for (const k of ["node", "relay"]) {
    const what = k === "node" ? "Forge room" : "relay";
    if (!read.tags[k]) out.push(`the image ${IMAGES[k]} is missing`);
    else if (read.tags[k] !== d[k]) out.push(`${IMAGES[k]} is ${read.tags[k].slice(7, 19)}, but the deploy ran ${d[k].slice(7, 19)}: the tag moved since the deploy`);
    if (read.containers[k] === null) out.push(`can't read the running ${what} container: is Docker up and the stack started?`);
    else if (read.containers[k] !== d[k]) out.push(`the running ${what} container is ${read.containers[k].slice(7, 19)}, not the deployed ${d[k].slice(7, 19)}`);
    if (!new RegExp(`^\\s*image:\\s*${IMAGES[k].replace(/[.:]/g, "\\$&")}\\s*$`, "m").test(read.compose || "")) out.push(`stack/compose.yml doesn't run ${IMAGES[k]}`);
  }
  if (!read.save) out.push(`the table save ${SAVE} can't be read`);
  else {
    if (read.save.stamp !== d.table) out.push(`${read.save.stamp ? `the save's table is ${read.save.stamp}` : "the save has no table stamp"}, but the deploy wrote ${d.table}: deploy again (node tools/deploy.js)`);
    else if (read.save.sha8 !== d.save && !opts.allowChangedSave) out.push(`the save changed since the deploy (${read.save.sha8}, deployed ${d.save}): a Save in TTS can add decks or a game; deploy again, or pass --allow-changed-save after checking it`);
  }
  if (read.bridge !== d.bridge && !opts.allowUndeployedBridge) out.push(`the bridge's code (${read.bridge}) isn't the deployed one (${d.bridge}): deploy it first, or pass --allow-undeployed-bridge to ship code that hasn't run live`);
  return out;
}

// The package's compose file: the engine only (no web client), the same images, every port on this PC alone
function composeYaml() {
  return `# The rules engine for the MTG table (friend package; made by tools/make-friend-package.js).
# MTG Companion.exe runs it: docker compose -f stack/compose.yml up -d
# Relay and Forge room only. Every port is bound to 127.0.0.1: nothing here is reachable from another PC.
name: ${PROJECT}
services:
  relay:
    image: ${IMAGES.relay}
    pull_policy: never   # (from images/mtg-images.tar: docker load; there is nothing to pull)
    environment:
      MANABREW_SERVER_KEY: "\${MANABREW_SERVER_KEY:-tts-local}"
      RUST_LOG: "manabrew_server=info"
    ports:
      - "127.0.0.1:9443:9443"   # the bridge connects here
    restart: unless-stopped

  forge-room:
    image: ${IMAGES.node}
    pull_policy: never
    environment:
      SELF_HOSTED_NODE_RELAY_URL: "ws://relay:9443"
      SELF_HOSTED_NODE_SERVER_KEY: "\${MANABREW_SERVER_KEY:-tts-local}"
      SELF_HOSTED_NODE_ROOM_NAME: "tts-commander"
      SELF_HOSTED_NODE_ENGINE_BACKEND: forge
      SELF_HOSTED_NODE_FORMAT: commander
      SELF_HOSTED_NODE_MAX_PLAYERS: "4"
      SELF_HOSTED_NODE_AUTO_START: "true"
      RUST_LOG: "self_hosted_node=info"
    depends_on: [relay]
    restart: unless-stopped
`;
}

// The entries a tar stream holds, by name (wanted: names whose text to keep): { names: Set, text: { name: string } }.
// Plain ustar headers only (docker save writes short names); enough to read index.json and manifest.json.
async function tarRead(stream, wanted) {
  const names = new Set(), text = {};
  let head = Buffer.alloc(0), skip = 0, take = null;
  for await (let c of stream) {
    while (c.length) {
      if (skip) {
        const n = Math.min(skip, c.length);
        if (take) take.parts.push(c.subarray(0, n));
        skip -= n; c = c.subarray(n);
        if (!skip && take) { text[take.name] = Buffer.concat(take.parts).subarray(0, take.size).toString("utf8"); take = null; }
        continue;
      }
      const need = 512 - head.length;
      head = Buffer.concat([head, c.subarray(0, need)]); c = c.subarray(need);
      if (head.length < 512) break;
      const h = head; head = Buffer.alloc(0);
      if (h.every((b) => b === 0)) continue; // (the two end blocks)
      const str = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0[\s\S]*$/, "");
      const prefix = str(257, 262) === "ustar" ? str(345, 500) : "";
      const name = (prefix ? `${prefix}/` : "") + str(0, 100);
      const size = parseInt(str(124, 136).trim() || "0", 8);
      names.add(name);
      skip = Math.ceil(size / 512) * 512;
      take = wanted.includes(name) ? { name, size, parts: [] } : null;
      if (take && !skip) { text[name] = ""; take = null; }
    }
  }
  return { names, text };
}

// What a docker save tar holds: tag -> { id (the OCI index digest: the image id in Docker's containerd store), config
// (the config digest: the image id in the classic store) }
function tarImages(text) {
  const out = {};
  const index = JSON.parse(text["index.json"] || "{\"manifests\":[]}");
  for (const m of index.manifests || []) {
    const name = m.annotations?.["io.containerd.image.name"] || "";
    const tag = name.replace(/^docker\.io\/library\//, "");
    if (tag) out[tag] = { ...out[tag], id: m.digest };
  }
  for (const m of JSON.parse(text["manifest.json"] || "[]")) {
    for (const tag of m.RepoTags || []) out[tag] = { ...out[tag], config: `sha256:${path.basename(m.Config)}` };
  }
  return out;
}

const readmeText = (v) => `MTG Table (rules engine) - host it on your own PC
=================================================

Rules-enforced Commander in Tabletop Simulator: the Forge rules engine runs the game, asks the questions (targets,
blockers, triggers) and moves the cards. This folder lets YOU host it. Friends who join your game need only TTS.

Package: built ${v.built.slice(0, 10)}, bridge ${v.bridge}, table ${v.table}.


WHAT YOU NEED
- Windows 10 or 11 (64-bit), Tabletop Simulator (Steam).
- Docker Desktop: https://www.docker.com/products/docker-desktop/
  Install it, start it once, and finish its first-run screens yourself (sign-in is optional).
- About 2 GB of free disk for the engine.


FIRST TIME
1. Unzip the whole folder somewhere you keep, e.g. Documents\\MTG-Table. Don't run it from inside the zip.
   (Before unzipping: right-click the .zip > Properties > tick "Unblock" > OK. Otherwise Windows may say "Windows
   protected your PC" when you start the app: click "More info", then "Run anyway".)
2. Start Docker Desktop and wait until it says it is running.
3. Double-click "MTG Companion.exe". The first start loads the engine into Docker (a few minutes). It also copies the
   table into your TTS saves. Then it starts the engine and opens Tabletop Simulator.


EVERY GAME NIGHT
1. Double-click "MTG Companion.exe" and wait until its lights are green.
2. In TTS: Create > Multiplayer (so friends can join; Singleplayer to play alone against the AI)
   > Games > Save & Load > "${SAVE_NAME}".
3. Friends join your server (Steam invite, or the server browser). They need nothing but TTS.
4. Everyone sits at a colour, brings a deck with the table's Card Importer, and presses READY? on their playmat.
   Turn the engine on with the middle tile (Engine: on), then press Start. Against the computer: type
   "mtg start ai 1" in chat (up to 3 AI players).
5. When you are done: "End game night" in the companion (or just shut down the PC).


IF A LIGHT IS RED
Each red light says what is wrong and has one button that fixes it. The usual ones:
- Docker: Docker Desktop isn't running. Start it (the button does), wait a minute.
- Relay or Forge room: press the fix button ("Restart relay and room"). This happens after Windows slept or Docker
  restarted. If a game was being set up, type "mtg reset" in TTS chat first.
- Bridge: press "Start the bridge". If it says another program holds port 39998, close the TTS extension of VS Code
  or Atom (they use the same port).
- Table: the table loaded in TTS isn't this package's. Load "${SAVE_NAME}" again (step 2 above).
Fix buttons that restart things are locked while a game is on, so a fix never ends a game by surprise.
Still stuck: close the companion, start it again. Then send the files in the "logs" folder to whoever gave you this.


PRIVACY
Everything here listens on your own PC only (127.0.0.1). Nothing is opened to the internet; TTS's own multiplayer is
how your friends reach the table. Card pictures come from Scryfall.


LICENCES
See the LICENSES folder. The rules engine is built from Forge (GPL-3.0) and Manabrew (AGPL-3.0-or-later); its
source is described in LICENSES\\SOURCE.txt. Magic: The Gathering is (c) Wizards of the Coast; this is unofficial Fan
Content permitted under the Wizards of the Coast Fan Content Policy, not approved or endorsed by Wizards.
`;

const sourceText = (v) => `Source of the rules engine in images/mtg-images.tar
====================================================

The two Docker images in this package (${IMAGES.relay}, ${IMAGES.node}) are built from public source:

- Manabrew (relay and self-hosted node), https://github.com/witchesofthehill/manabrew
  at commit ${v.manabrewCommit}, licensed AGPL-3.0-or-later (see Manabrew-LICENSE.md and the licence texts here),
  with our changes in source/manabrew.patch (AGPL-3.0-or-later).
- Forge (the rules engine inside the node image), https://github.com/witchesofthehill/forge
  at commit ${v.forgeCommit}, licensed GPL-3.0 (Forge-LICENSE.txt), with our changes in source/forge.patch (GPL-3.0).

source/build-images.sh fetches those exact commits, applies the two patches beside it and builds both images:
    bash build-images.sh        (run in the source folder; needs Docker, git and several GB of disk; about 20 minutes)

The bridge, the table script and the tools (everything else in this package that isn't Node.js) are ours and in the
public domain (LICENSE, the Unlicense). They talk to the engine over its network protocol as a separate program.
node.exe is Node.js ${v.nodeVersion} (MIT, Node-LICENSE.txt).

Patches shipped: manabrew.patch sha8 ${v.patches.manabrew}, forge.patch sha8 ${v.patches.forge}.
If you received this package and want the complete source in another form, ask the person who gave it to you.
`;

// Node's own MIT notice (node.exe ships with no licence file on disk; the full file with its bundled parts:
// https://github.com/nodejs/node/blob/<version>/LICENSE)
const nodeLicense = (version) => `node.exe is Node.js ${version}. Full licence, including the parts it bundles:
https://github.com/nodejs/node/blob/${version}/LICENSE

Node.js is licensed for use as follows:

"""
Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
"""
`;

// ───────── reading this PC ─────────

const docker = (args) => { try { return execFileSync("docker", args, { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
function tagIds() {
  const out = {};
  for (const k of ["node", "relay"]) out[k] = docker(["image", "inspect", "-f", "{{.Id}}", IMAGES[k]]);
  return out;
}
function readSave() {
  try { const raw = fs.readFileSync(SAVE); return { raw, stamp: stampOf(raw.toString("utf8")), sha8: sha8(raw) }; } catch { return null; }
}
function gitCommit() {
  try {
    const sha = execFileSync("git", ["-C", ROOT, "rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--", "bridge", "decks", "tools/make-friend-package.js"], { encoding: "utf8" }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch { return null; }
}
function nodeExe() {
  let found = null;
  try { found = execFileSync("where", ["node"], { encoding: "utf8" }).split(/\r?\n/).find((l) => /node\.exe$/i.test(l.trim()))?.trim(); } catch {}
  if (!found) stop("no node.exe on PATH (where node)");
  const version = execFileSync(found, ["--version"], { encoding: "utf8" }).trim();
  if (Number(version.slice(1).split(".")[0]) < 22) stop(`${found} is Node ${version}; the bridge needs 22 or newer (built-in WebSocket)`);
  return { file: found, version };
}
const pinned = (name) => (fs.readFileSync(path.join(ROOT, "engine", "build-images.sh"), "utf8").match(new RegExp(`^${name}=(\\w+)`, "m")) || [])[1] || "?";

// docker save to a file, then read it back: the tar must hold exactly the deployed images under their tags
async function saveImages(file, deployed) {
  const p = spawn("docker", ["save", IMAGES.relay, IMAGES.node], { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => { err += d; });
  const exited = new Promise((done) => p.on("close", done));
  await pipeline(p.stdout, fs.createWriteStream(file));
  const code = await exited;
  if (code !== 0) stop(`docker save failed (${code}): ${err.trim()}`);
  const { text } = await tarRead(fs.createReadStream(file), ["index.json", "manifest.json"]);
  const held = tarImages(text);
  for (const k of ["node", "relay"]) {
    if (held[IMAGES[k]]?.id !== deployed[k]) stop(`images/mtg-images.tar holds ${IMAGES[k]} as ${held[IMAGES[k]]?.id || "nothing"}, not the deployed ${deployed[k]}`);
  }
  return held;
}

function copy(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
function copyJsonDir(from, to) {
  const names = fs.readdirSync(from).filter((f) => f.endsWith(".json"));
  for (const f of names) copy(path.join(from, f), path.join(to, f));
  return names;
}
function sizeOf(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0) : st.size;
}

// The companion: built with its own build.cmd (csc.exe) when it exists, else a note in its place
function companion(pkg) {
  const tree = path.resolve(option("companion", ROOT));
  const build = path.join(tree, "companion", "build.cmd");
  if (!fs.existsSync(build)) {
    fs.writeFileSync(path.join(pkg, "MTG Companion - NOT BUILT.txt"), `MTG Companion.exe wasn't built into this package: ${path.relative(ROOT, build) || build} didn't exist when it was made.\r\n`);
    return "not built (no companion/build.cmd)";
  }
  const t0 = Date.now() - 2000;
  execFileSync("cmd", ["/c", build], { cwd: tree, stdio: "inherit", timeout: 300000 });
  const exe = [path.join(tree, "MTG Companion.exe"), path.join(tree, "companion", "MTG Companion.exe")].find((f) => fs.existsSync(f) && fs.statSync(f).mtimeMs >= t0);
  if (!exe) stop(`${build} ran, but no fresh "MTG Companion.exe" is in ${tree} or its companion folder`);
  copy(exe, path.join(pkg, "MTG Companion.exe"));
  return `built from ${tree}`;
}

async function main() {
  const noImages = flag("no-images");
  const deployed = versions.readManifest();
  const save = readSave();
  const compose = fs.readFileSync(path.join(ROOT, "stack", "compose.yml"), "utf8");
  const containers = await new Promise((done) => versions.containerImages(done)); // (the running stack on this PC)
  const bridge = versions.bridgeHash();
  const why = refusals({ deployed, tags: tagIds(), containers, save, bridge, compose },
    { allowChangedSave: flag("allow-changed-save"), allowUndeployedBridge: flag("allow-undeployed-bridge") });
  if (why.length) stop(`stack/deployed.json disagrees with what would be shipped:\n  - ${why.join("\n  - ")}`);

  // the bridge's data, checked before anything is written
  const presetsDir = path.join(ROOT, "manabrew", "public", "preset_decks");
  const defaults = JSON.parse(DEFAULT_DECKS_RE.exec(fs.readFileSync(path.join(ROOT, "bridge", "bridge.js"), "utf8"))[1]);
  for (const id of defaults) if (!fs.existsSync(path.join(presetsDir, `${id}.json`)) && !fs.existsSync(path.join(ROOT, "decks", `${id}.json`))) stop(`the AI's default deck ${id} is in neither decks/ nor ${path.relative(ROOT, presetsDir)}`);
  for (const f of BRIDGE_DATA) if (!fs.existsSync(path.join(ROOT, "bridge", f))) stop(`bridge/${f} is missing`);
  const licences = {
    "LICENSE": path.join(ROOT, "LICENSE"), "THIRD-PARTY-NOTICES.md": path.join(ROOT, "THIRD-PARTY-NOTICES.md"),
    "Forge-LICENSE.txt": path.join(ROOT, "manabrew", "forge", "LICENSE"),
    "Manabrew-LICENSE.md": path.join(ROOT, "manabrew", "LICENSE.md"),
    "Manabrew-LICENSE-AGPL-3.0-or-later.txt": path.join(ROOT, "manabrew", "LICENSE-AGPL-3.0-or-later"),
    "Manabrew-LICENSE-GPL-3.0-or-later.txt": path.join(ROOT, "manabrew", "LICENSE-GPL-3.0-or-later"),
    "source/manabrew.patch": path.join(ROOT, "engine", "manabrew.patch"), "source/forge.patch": path.join(ROOT, "engine", "forge.patch"),
    "source/build-images.sh": path.join(ROOT, "engine", "build-images.sh"),
  };
  for (const [to, from] of Object.entries(licences)) if (!fs.existsSync(from)) stop(`${to} would come from ${from}, which is missing (the Manabrew clone?)`);
  const node = nodeExe();

  const d = new Date();
  const date = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  const out = path.resolve(option("out", path.join(ROOT, "dist")));
  const name = `MTG-Table-${date}-${bridge}`;
  const pkg = path.join(out, name), zip = `${pkg}.zip`;
  fs.rmSync(pkg, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  fs.mkdirSync(pkg, { recursive: true });
  console.log(`building ${pkg}`);

  // bridge: its code (the files its hash covers, so the hash is the same here) and its data
  for (const f of versions.BRIDGE_FILES) copy(f, path.join(pkg, "bridge", path.basename(f)));
  for (const f of BRIDGE_DATA) copy(path.join(ROOT, "bridge", f), path.join(pkg, "bridge", f));
  for (const f of BRIDGE_CACHE) {
    if (fs.existsSync(path.join(ROOT, "bridge", f))) copy(path.join(ROOT, "bridge", f), path.join(pkg, "bridge", f));
    else console.log(`  (no bridge/${f}: the first games fetch card pictures from Scryfall)`);
  }
  const packaged = sha8(versions.BRIDGE_FILES.map((f) => fs.readFileSync(path.join(pkg, "bridge", path.basename(f)), "utf8")).join("\0"));
  if (packaged !== bridge) stop(`the packaged bridge hashes to ${packaged}, not ${bridge}`);
  const ours = copyJsonDir(path.join(ROOT, "decks"), path.join(pkg, "decks"));
  const theirs = copyJsonDir(presetsDir, path.join(pkg, "manabrew", "public", "preset_decks"));

  copy(node.file, path.join(pkg, "runtime", "node", "node.exe"));

  // the table: the deployed save under its new name, and its picture
  const table = Buffer.from(renameSave(save.raw.toString("utf8"), SAVE_NAME), "utf8");
  if (stampOf(table.toString("utf8")) !== deployed.table) stop("the renamed save lost its table stamp");
  fs.mkdirSync(path.join(pkg, "table"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "table", "MTG Table.json"), table);
  const png = SAVE.replace(/\.json$/i, ".png");
  if (fs.existsSync(png)) copy(png, path.join(pkg, "table", "MTG Table.png"));

  const info = {
    bridge, table: deployed.table, save: sha8(table), node: deployed.node, relay: deployed.relay,
    built: new Date().toISOString(), gitCommit: gitCommit(),
    // (beyond the contract's keys) the deploy this was cut from, and both ids of each image: Docker's containerd store
    // reports `id`, the classic store `config`
    deployed: { bridge: deployed.bridge, save: deployed.save, at: deployed.at },
    images: {}, imagesFile: noImages ? null : "images/mtg-images.tar", nodeVersion: node.version, saveName: SAVE_NAME, composeProject: PROJECT,
  };

  fs.mkdirSync(path.join(pkg, "stack"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "stack", "compose.yml"), composeYaml());
  // what the bridge's /versions compares with: this package's own code and save
  fs.writeFileSync(path.join(pkg, "stack", "deployed.json"), `${JSON.stringify({ ...deployed, bridge, save: info.save, at: info.built }, null, 1)}\n`);

  fs.mkdirSync(path.join(pkg, "images"), { recursive: true });
  if (noImages) {
    console.log("  --no-images: images/ left empty");
    for (const k of ["node", "relay"]) info.images[IMAGES[k]] = { id: deployed[k] };
  } else {
    // (not gzipped: Docker's containerd store saves the layers already compressed; gzip took 1% off the relay's tar)
    const tar = path.join(pkg, "images", "mtg-images.tar");
    console.log(`  docker save ${IMAGES.relay} ${IMAGES.node} (a few minutes)`);
    info.images = await saveImages(tar, deployed);
    const after = tagIds();
    if (after.node !== deployed.node || after.relay !== deployed.relay) stop("an image tag moved during docker save: run it again");
  }
  fs.mkdirSync(path.join(pkg, "logs"), { recursive: true });

  for (const [to, from] of Object.entries(licences)) copy(from, path.join(pkg, "LICENSES", to));
  fs.writeFileSync(path.join(pkg, "LICENSES", "Node-LICENSE.txt"), nodeLicense(node.version));
  fs.writeFileSync(path.join(pkg, "LICENSES", "SOURCE.txt"), sourceText({
    manabrewCommit: pinned("MANABREW_COMMIT"), forgeCommit: pinned("FORGE_COMMIT"), nodeVersion: node.version,
    patches: { manabrew: sha8(fs.readFileSync(licences["source/manabrew.patch"])), forge: sha8(fs.readFileSync(licences["source/forge.patch"])) },
  }).replace(/\n/g, "\r\n"));
  const made = companion(pkg);
  fs.writeFileSync(path.join(pkg, "version.json"), `${JSON.stringify(info, null, 1)}\n`);
  fs.writeFileSync(path.join(pkg, "README-FRIEND.txt"), readmeText(info).replace(/\n/g, "\r\n"));

  console.log(`  zipping (${mb(sizeOf(pkg))})`);
  execFileSync(TAR, ["-a", "-c", "-f", zip, "-C", out, name], { stdio: "inherit", timeout: 1800000 });

  const lines = fs.readdirSync(pkg).sort().map((f) => `  ${f.padEnd(28)} ${mb(sizeOf(path.join(pkg, f))).padStart(10)}`);
  console.log(`${lines.join("\n")}\n  decks: ${ours.length} ours, ${theirs.length} Manabrew's; companion: ${made}`);
  console.log(`made ${pkg} (${mb(sizeOf(pkg))}) and ${zip} (${mb(fs.statSync(zip).size)})`);
}

if (require.main === module) main().catch((e) => stop(e.stack || e.message));
module.exports = { stampOf, renameSave, refusals, composeYaml, tarRead, tarImages, readmeText, IMAGES, PROJECT, SAVE_NAME, BRIDGE_SHIPPED: [...BRIDGE_DATA, ...BRIDGE_CACHE] };
