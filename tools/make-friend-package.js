// Builds the friend package: one folder, and a zip of it, that lets a friend host the rules-enforced Commander table
// on their own Windows PC. The friend has Docker Desktop and nothing else of ours: no Node, no repo. They double-click
// MTG Companion.exe (companion/, built here when companion/build.cmd exists), which loads the engine images, starts the
// relay and the room, runs the bridge from this folder and opens TTS; in TTS they load "MTG Table (rules engine)".
//   node tools/make-friend-package.js                 dist/MTG-Table-<date>-<bridge>/ and dist/MTG-Table-<date>-<bridge>.zip
//   node tools/make-friend-package.js --no-images     without images/ (no docker save, which takes minutes): quick runs
//   --allow-undeployed-bridge   ship bridge code that isn't the deployed one (stack/deployed.json `bridge`)
//   --companion <dir>           the tree that holds companion/build.cmd (default: this repo)
//   --out <dir>                 where the package goes (default: dist/)
//   --release [--tag T] [--previous update-manifest.json]   also dist/release-<tag>/: the parts the companion's
//                               self-update downloads (docs/companion-app-spec.md §11); it prints what to attach to the
//                               GitHub release, which the user creates by hand. --previous: the PUBLISHED latest
//                               release's manifest (else a reused part must be in dist/release-<its tag>/ with its sha).
//                               Signs update-manifest.json with the release key, %USERPROFILE%\.mtg-release\release-key.pem
//                               (MTG_RELEASE_KEY overrides; made on first use; never in the repo). Refuses --allow-undeployed-bridge.
// It refuses, saying why, when stack/deployed.json disagrees with the images it would ship, the running engine
// containers or the table the sources make. The package holds NO table: the Workshop table (2296042369) is its
// author's, and Steam's Subscriber Agreement lets a subscriber use a Workshop item, not hand out copies. It ships our
// patcher instead (table/: tools/make-table.js and what it runs), and the companion makes the table on the host's PC
// from the host's own subscribed copy. To check what that makes, this script runs the same patcher on this PC's
// Workshop copy (MTG_WORKSHOP overrides the path) and records the result's hashes in version.json. It never writes in
// TTS's folders.
//
// The layout is the contract with the companion app (keep the two in step):
//   MTG Companion.exe             or "MTG Companion - NOT BUILT.txt" when there is no companion/build.cmd
//   version.json                  { bridge, table, save, node, relay, built, gitCommit, ... } (versionInfo below)
//   runtime/node/node.exe         this PC's Node
//   bridge/                       the bridge's code (bridge/versions.js BRIDGE_FILES) and the data it reads
//   decks/                        our decks; manabrew/public/preset_decks/: Manabrew's (bridge/presets.js)
//   stack/compose.yml             relay + forge-room, project "mtg-table", ports on 127.0.0.1
//   scenarios/                    the debug scenarios ("mtg debug <name>")
//   stack/deployed.json           the deploy record the bridge's /versions compares with (bridge = the packaged code,
//                                 nodeConfig / relayConfig = the image ids in Docker's classic store)
//   images/mtg-images.tar         docker save of both engine images (plain: their layers are gzip already, see below)
//   table/                        the patcher (make-table.js PATCHER_FILES, README.txt), never a table: the companion
//                                 writes table/MTG Table.json (+ .png) there from the host's own Workshop copy,
//                                 SaveName "MTG Table (rules engine)"
//   logs/                         empty; the companion starts the bridge with MTG_HOME=<package> and
//                                 MTG_LOG_DIR=<package>\logs, so its logs and resume file land here
//   README-FRIEND.txt, LICENSES/
const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { pipeline } = require("stream/promises");
const versions = require("../bridge/versions");

const ROOT = path.join(__dirname, "..");
const tables = require("./make-table");
const TABLE = tables.TABLES["4p"];
const WORKSHOP = process.env.MTG_WORKSHOP || path.join(process.env.USERPROFILE || require("os").homedir(), "Documents", "My Games", "Tabletop Simulator", "Mods", "Workshop", `${TABLE.id}.json`);
const SAVE_NAME = TABLE.saveName;
const PROJECT = "mtg-table"; // the package's compose project: containers mtg-table-relay-1, mtg-table-forge-room-1
const IMAGES = { relay: "mtg-relay:exile", node: "mtg-forge-node:exile" };
// What the bridge reads beside its code (path.join(__dirname, ...) in bridge.js). The image cache is git-ignored and
// rebuilt from Scryfall when missing, so it is shipped when there is one.
const BRIDGE_DATA = ["forge-cards.json", "token-scripts.json", "forge-planes.json", "forge-formats.json"];
const BRIDGE_CACHE = ["image-cache-klrmngr.json"];
// The folders of JSON files the bridge reads through home.data(), copied whole (the repo's path = the package's;
// tests/test_home_paths.js checks every home.data() folder is here or stack/): decks, Manabrew's, "mtg debug" scenarios
const DATA_DIRS = ["decks", "manabrew/public/preset_decks", "scenarios"];
const DEFAULT_DECKS_RE = /const DEFAULT_DECKS = (\[[^\]]*\]);/; // the AI's decks when none was chosen (bridge.js)
const STANDARD_DECKS_RE = /const STANDARD_DECKS = (\[[^\]]*\]);/; // the same in a Standard game
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

const renameSave = tables.renameSave; // (tools/make-table.js: the companion renames with the same code)

// What in a package would be a copy of a Workshop table, as package paths ([] when none): by name, a JSON under
// table/, a file named after a Workshop id or a TTS save; by content, a JSON file that is a whole TTS save.
// entries: [{ rel, text? }] (text: the file's start, for .json files)
const WORKSHOP_IDS = Object.values(tables.TABLES).map((t) => t.id);
function tableCopies(entries) {
  return entries.filter(({ rel, text }) => {
    const base = rel.split("/").pop();
    if (/^table\/.*\.json$/i.test(rel) || /^TS_Save_\d+\.json$/i.test(base)) return true;
    if (WORKSHOP_IDS.some((id) => base.startsWith(`${id}.`))) return true;
    return /\.json$/i.test(rel) && typeof text === "string" && /"SaveName"\s*:/.test(text) && /"ObjectStates"\s*:/.test(text);
  }).map((e) => e.rel);
}
// every file under a folder as { rel, text? } for tableCopies (a .json file's first 64 KB: a save starts with SaveName)
function packageEntries(root, rel = "") {
  const p = path.join(root, rel);
  if (!fs.statSync(p).isDirectory()) {
    let text;
    if (/\.json$/i.test(rel)) { const fd = fs.openSync(p, "r"); try { const b = Buffer.alloc(65536); text = b.subarray(0, fs.readSync(fd, b, 0, b.length, 0)).toString("utf8"); } finally { fs.closeSync(fd); } }
    return [{ rel, text }];
  }
  return fs.readdirSync(p).flatMap((f) => packageEntries(root, rel ? `${rel}/${f}` : f));
}

// The package's table/ folder: our patcher, and a note saying where the table comes from
const tableReadme = () => `This folder holds no table. The table is "${TABLE.saveName}", made on your PC from your own Steam
Workshop copy of the group's table, which this package doesn't include (Steam lets a subscriber use a Workshop item,
not hand out copies of it):
    ${TABLE.url}
Subscribe to it, start Tabletop Simulator once so it downloads, then press Start engine in MTG Companion. The companion
runs make-table.js here on that copy and installs the result as a TTS save; it writes "MTG Table.json" in this folder.
make-table.js runs make-engine-copy.js (with engine-json.lua and engine-renderer.lua, the table's engine scripts). All
plain JavaScript and Lua: read them to see every change made to the table.
`;

// Why the package can't be built, from what was read: [] when everything agrees with the deploy record.
// read: { deployed, tags: { node, relay } (image ids of the tags, null = missing), containers: { node, relay } (null =
// Docker can't say), table: { stamp } | { error } (make-table run on this PC's Workshop copy), bridge (the code's
// hash), compose (stack/compose.yml's text) }
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
  if (!read.table || read.table.error) out.push(`the table can't be made from this PC's Workshop copy (${WORKSHOP}): ${read.table ? read.table.error : "not tried"}. Subscribe to ${TABLE.url} and start TTS once, or point MTG_WORKSHOP at the file`);
  else if (read.table.stamp !== d.table) out.push(`the sources make table ${read.table.stamp}, but the deploy wrote ${d.table}: the table's source changed since the deploy; deploy again (node tools/deploy.js)`);
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

// Why a docker save tar isn't the deployed images ([] when it is): each tag must be in it under the deployed id
function tarMismatch(held, deployed) {
  return ["node", "relay"].filter((k) => held[IMAGES[k]]?.id !== deployed[k])
    .map((k) => `images/mtg-images.tar holds ${IMAGES[k]} as ${held[IMAGES[k]]?.id || "nothing"}, not the deployed ${deployed[k]}`);
}

// The package's stack/deployed.json, which the bridge's /versions compares with: this package's own code and save, and
// for each image its config digest too (the id Docker's classic store gives an image loaded from the tar)
function deployedRecord(deployed, { bridge, save, at, images }) {
  const out = { ...deployed, bridge, save, at };
  for (const k of ["node", "relay"]) if (images?.[IMAGES[k]]?.config) out[`${k}Config`] = images[IMAGES[k]].config;
  return out;
}

// ── a release for the companion's self-update (docs/companion-app-spec.md §11)

// The parts of a release, their assets and what each holds (paths in the package)
const RELEASE_PARTS = {
  app: { file: "app.zip", holds: ["bridge", "decks", "manabrew", "scenarios", "stack/compose.yml", "stack/deployed.json", "README-FRIEND.txt", "LICENSES", "version.json"] },
  table: { file: "table.zip", holds: ["table"] },
  images: { file: "images.tar", holds: ["images/mtg-images.tar"] },
  runtime: { file: "runtime.zip", holds: ["runtime"] },
  companion: { file: "MTG.Companion.exe", holds: ["MTG Companion.exe"] },
};
const UPDATE_FORMAT = 2; // the companion's Updates.Format that can apply what this writes (2: the table part is the
// patcher, and the table is made on the host from its Workshop copy; a format-1 companion would install no table, so
// it takes the new companion first)
// (the app part's version leaves these out: they change with every release; the manifest carries the first two)
const APP_UNVERSIONED = ["version.json", "stack/deployed.json", "README-FRIEND.txt", "bridge/image-cache-klrmngr.json"]; // (README: its build date; the picture cache: the friend's own, kept by the updater, not in app.zip)
const APP_EXCLUDED = ["bridge/image-cache-klrmngr.json"]; // (in the package, not in app.zip: an update keeps the friend's cache)
// the app part's version: every file it holds but the unversioned ones
const appVersion = (entries) => treeHash(entries.filter((e) => !APP_UNVERSIONED.includes(e.rel)));
// a release tag: word characters, dots and dashes, not only dots ("." and ".." are paths); the companion's Updates.ValidTag
const validTag = (tag) => typeof tag === "string" && /^[\w.-]{1,100}$/.test(tag) && tag.replace(/\./g, "") !== "";

// One hash over files: [{ rel, bytes }] in path order, path and bytes each
function treeHash(entries) {
  const sorted = [...entries].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return sha8(Buffer.concat(sorted.flatMap((e) => [Buffer.from(`${e.rel}\0`), Buffer.from(e.bytes), Buffer.from("\0")])));
}
// the images part's version: the same in the companion (Updates.ImagesVersion)
const imagesVersion = (node, relay) => sha8(Buffer.from(`${node}${relay}`, "utf8"));

// Which parts to build, and which an older release already carries: a part whose version is the previous release's
// points at the release holding its file
// points at the release holding its file. published: previous is the published latest release's manifest (--previous);
// else a reused file must be in dist/release-<its tag>/ with its sha256 (have(release, file, sha) says), or it is built
function planRelease(partVersions, previous, { published = true, have = () => true } = {}) {
  const build = [], reuse = {}, unproven = [];
  for (const [k, version] of Object.entries(partVersions)) {
    const old = previous?.parts?.[k];
    const release = old?.release || previous?.version;
    if (old && old.version === version && old.file && old.sha256 && validTag(release)) {
      if (published || have(release, old.file, old.sha256)) { reuse[k] = { ...old, release }; continue; }
      unproven.push(k);
    }
    build.push(k);
  }
  return { build, reuse, unproven };
}

// what --release refuses (the companion installs these on friends' PCs: only what ran live, and every part shipped)
function releaseRefusals({ build, imagesFile, allowUndeployedBridge, tag }) {
  const out = [];
  if (!validTag(tag)) out.push(`the tag ${tag} has characters a release tag can't have`);
  if (allowUndeployedBridge) out.push("--allow-undeployed-bridge: a release ships only a bridge that ran live (deploy it first)");
  if (build.includes("images") && !imagesFile) out.push("the engine images changed since the previous release, so they must be shipped (drop --no-images)");
  return out;
}

// the releases a manifest still points at (each must stay published, or the updater can't fetch that part)
const pointedAt = (manifest) => [...new Set(Object.values(manifest.parts).map((p) => p.release).filter((r) => r && r !== manifest.version))].sort();

// ── the release key: ECDSA P-256; the companion carries the public half (companion/release-keys.txt, built in)
const crypto = require("crypto");
// the signature over the manifest's bytes: IEEE P1363 (r || s, 64 bytes), base64 (the companion's Updates.VerifySignature)
const signManifest = (bytes, privateKey) => crypto.sign("sha256", bytes, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
// the public key as the companion reads it: base64 of X || Y (32 bytes each)
function publicKeyText(key) {
  const jwk = crypto.createPublicKey(key).export({ format: "jwk" });
  if (jwk.crv !== "P-256") throw new Error(`the release key is ${jwk.crv}, not P-256`);
  return Buffer.concat([Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64");
}
// the private key file, made on first use (outside the repo: refused inside it). Returns { key, made }
function releaseKey(file, root) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error(`the release key ${file} is inside the repo; keep it outside (default %USERPROFILE%\\.mtg-release\\release-key.pem)`);
  if (fs.existsSync(file)) return { key: crypto.createPrivateKey(fs.readFileSync(file)), made: false };
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  return { key: privateKey, made: true };
}

// update-manifest.json. built: { part: { file, sha256, size } } for the parts made now
function releaseManifest({ tag, built, gitCommit, partVersions, made, reuse, full, versionJson, deployedJson }) {
  const parts = {};
  for (const k of Object.keys(partVersions)) {
    if (reuse[k]) parts[k] = reuse[k];
    else if (made[k]) parts[k] = { ...made[k], version: partVersions[k], release: tag };
    else throw new Error(`the ${k} part was neither built nor carried by an older release`);
  }
  return { format: UPDATE_FORMAT, version: tag, built, gitCommit, minCompanion: UPDATE_FORMAT, parts, full, versionJson, deployedJson };
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

// HOST REQUIREMENTS for a Windows host (this README, README.md and docs/companion-app-spec.md say the same)
const hostRequirements = () => `HOST REQUIREMENTS (the PC that runs the engine; friends who only join need just TTS)
- Windows 10 or 11 on an x64 processor (Intel or AMD). Windows on ARM (e.g. Snapdragon laptops) won't run the
  engine.
- At least 4 CPU cores and 16 GB of RAM recommended. The engine uses 2 cores and about 8 GB inside Docker; TTS and
  Windows need the rest. These are estimates, not measured limits.
- About 2 GB of free disk: about 1.5 GB for the engine inside Docker and about 400 MB for this folder (the .zip can
  be deleted once it is unzipped). An update needs up to about 700 MB more while it installs, and about 400 MB
  stays afterwards: the companion keeps the previous version's files for an undo.
- Docker Desktop: https://www.docker.com/products/docker-desktop/
  * In its installer choose "All-users installation": it turns on Windows' Virtual Machine Platform, which Docker
    needs. Or, before installing, run  wsl --install  in an administrator PowerShell and restart the PC.
  * Then start Docker Desktop once, finish its first-run screens yourself (sign-in is optional), and sign out of
    Windows and back in (or restart): the install adds you to the "docker-users" group, which only counts after a
    new sign-in.
  * If Docker says virtualization is off: turn on SVM (AMD) or Intel VT-x (Intel) in the PC's BIOS/UEFI settings.
- Tabletop Simulator (Steam).
- The tables, subscribed on the Steam Workshop (this package doesn't include them; the companion makes the
  rules-engine table from your own copy):
    4 players: ${tables.TABLES["4p"].url}
    6 players: ${tables.TABLES["6p"].url}
  After subscribing, start TTS once so Steam downloads them.
`;

const readmeText = (v) => `MTG Table (rules engine) - host it on your own PC
=================================================

Rules-enforced Commander in Tabletop Simulator: the Forge rules engine runs the game, asks the questions (targets,
blockers, triggers) and moves the cards. This folder lets YOU host it. Friends who join your game need only TTS.

Package: built ${v.built.slice(0, 10)}, bridge ${v.bridge}, table ${v.table}.


${hostRequirements()}


FIRST TIME
1. Before unzipping: right-click the .zip > Properties > tick "Unblock" > OK.
   MTG Companion.exe isn't signed. If you skip this, Windows may say "Windows protected your PC" when you start it:
   click "More info", then "Run anyway".
   If Windows blocks it outright with no "Run anyway" (Smart App Control): delete the unzipped folder, do the
   Unblock step above on the .zip, and unzip again. If it is still blocked, Smart App Control won't run unsigned
   programs on this PC, and the companion only runs with it off (Windows Security > App & browser control). That
   is your decision to make: on many PCs it can't be turned back on without resetting Windows.
2. Unzip the whole folder to a plain folder of its own, e.g. C:\\Games\\MTG-Table. Not into OneDrive, Documents or
   Program Files (synced or protected folders get in the way), and don't run it from inside the zip.
3. Start Docker Desktop and wait until it says it is running. Its first start may ask you to accept its terms, or
   to update WSL (Windows' Linux layer, which Docker uses): do both, then let it finish starting.
4. Subscribe to the table on the Steam Workshop (HOST REQUIREMENTS above) and start Tabletop Simulator once, up to
   its main menu, so Steam downloads it. This package doesn't include the table: the companion makes the rules-engine
   table from your own copy.
5. Double-click "MTG Companion.exe". It opens its status page and checks everything, but starts nothing yet.
   Press "Start engine" (under Actions). The first start takes a few minutes while it loads the engine into
   Docker. It also makes the table from your Workshop copy and puts it in your TTS saves. Then it starts the
   engine and opens Tabletop Simulator.


EVERY GAME NIGHT
1. Double-click "MTG Companion.exe", press "Start engine", and wait until its lights are green. The TTS light
   stays amber until the table is loaded (step 2).
2. In TTS: Create > Multiplayer (so friends can join; Singleplayer to play alone against the AI)
   > Games > Save & Load > "${SAVE_NAME}".
3. Friends join your server (Steam invite, or the server browser). They need nothing but TTS.
4. Everyone sits at a colour, brings a deck with the table's Card Importer, and presses READY? on their playmat.
   Turn the engine on with the middle tile (Engine: on), then press Start. Against the computer: type
   "mtg start ai 1" in chat (up to 3 AI players).
5. When you are done: "Stop everything" in the companion, or just shut down the PC. While the companion installs
   an update, Windows says "Finishing update…" and waits: let it finish (a minute or two). If the PC went off
   anyway, the next start of the companion puts the package back as it was before the update.


IF A LIGHT IS RED
Each red light says what is wrong and has one button that fixes it. The usual ones:
- Docker: Docker Desktop isn't running: "Start Docker Desktop", wait a minute. If it says Windows doesn't let this
  account use Docker yet, sign out of Windows and back in (or restart), then press "Try again". If Docker Desktop
  never gets going, see the Docker Desktop notes in HOST REQUIREMENTS (Virtual Machine Platform, virtualization).
- Table save: "Subscribe to the table on the Steam Workshop": do that, start TTS once so it downloads, then press
  "Try again". If it says a patch didn't apply, the table's author changed it on the Workshop since this package
  was made: ask whoever gave you this for a newer package.
- Engine stack: press "Restart relay and room". This happens after Windows slept or Docker restarted. If a game was
  being set up, type "mtg reset" in TTS chat first.
- Bridge: press "Start the bridge". If it says another program holds port 39998, close the TTS extension of VS Code
  or Atom (they use the same port). If it says the folder can't be written to, move the folder (FIRST TIME, step 2).
- TTS: red when the table loaded in TTS isn't this package's. Load "${SAVE_NAME}" again (step 2 above).
Fix buttons that restart things are locked while a game is on, so a fix never ends a game by surprise.
Still stuck: close the companion, start it again. Then send the files in the "logs" folder to whoever gave you this.


PRIVACY
Everything here listens on your own PC only (127.0.0.1). Nothing is opened to the internet; TTS's own multiplayer is
how your friends reach the table. Card pictures come from Scryfall.


LICENCES
See the LICENSES folder. The rules engine is built from Forge (GPL-3.0) and Manabrew (AGPL-3.0-or-later); its
source is described in LICENSES\\SOURCE.txt. MTG Companion.exe's full source is in LICENSES\\source\\companion (read it,
or build your own exe from it with its build.cmd); the bridge is plain JavaScript in bridge\\. Nothing is encrypted. Magic: The Gathering is (c) Wizards of the Coast; this is unofficial Fan
Content permitted under the Wizards of the Coast Fan Content Policy, not approved or endorsed by Wizards.


MADE WITH CLAUDE CODE
This project was made with Claude Code (https://claude.com/claude-code), Anthropic's AI coding assistant: it wrote
the code, the tests and these instructions.
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
// the table the package's patcher makes from this PC's Workshop copy: { stamp, save, workshop } or { error }. Only
// its hashes are used: its bytes are never shipped (the companion makes the same bytes from the host's copy)
function readTable() {
  try { const b = tables.build(WORKSHOP, { table: "4p" }); return { stamp: b.stamp, save: b.save, workshop: b.workshop }; }
  catch (e) { return { error: e.missing ? "no such file" : e.message }; }
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
  const wrong = tarMismatch(held, deployed);
  if (wrong.length) stop(wrong.join("; "));
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
  const exe = [path.join(tree, "companion", "bin", "MTG Companion.exe"), path.join(tree, "MTG Companion.exe"), path.join(tree, "companion", "MTG Companion.exe")].find((f) => fs.existsSync(f) && fs.statSync(f).mtimeMs >= t0);
  if (!exe) stop(`${build} ran, but no fresh "MTG Companion.exe" is in ${tree} or its companion folder`);
  copy(exe, path.join(pkg, "MTG Companion.exe"));
  companionSource(tree, pkg);
  return `built from ${tree}`;
}
// The companion's full source, from the tree the exe was just built from, so anyone can read what they run or build
// their own exe with build.cmd (Windows' own C# compiler). In LICENSES/, which the app part of an update carries
// (companion/src/Update.cs lists the folders an installed companion replaces; a new top-level folder would go stale).
function companionSource(tree, pkg) {
  const from = path.join(tree, "companion"), to = path.join(pkg, "LICENSES", "source", "companion");
  const files = ["build.cmd", "app.manifest", "app.ico", "release-keys.txt"].filter((f) => fs.existsSync(path.join(from, f)));
  for (const f of files) copy(path.join(from, f), path.join(to, f));
  const src = fs.readdirSync(path.join(from, "src")).filter((f) => f.endsWith(".cs")).sort();
  if (!src.length) stop(`no companion source in ${path.join(from, "src")}`);
  for (const f of src) copy(path.join(from, "src", f), path.join(to, "src", f));
  fs.writeFileSync(path.join(to, "README.txt"), [
    "The full source of MTG Companion.exe, exactly the files it was built from for this package.",
    "",
    "Nothing in the exe is encrypted or obfuscated. To check it:",
    "- read the .cs files in src\\ (plain C#);",
    "- or build your own: double-click build.cmd (it uses the C# compiler that comes with Windows, no downloads) and",
    "  run bin\\MTG Companion.exe instead of the one in this package. (Two builds of the same source are not byte for",
    "  byte identical with that compiler, so compare by building, not by hash.)",
    "- release-keys.txt holds only the PUBLIC half of the key that signs updates; the companion uses it to refuse any",
    "  update not signed by the person who made this package.",
    "The bridge (bridge\\*.js) is plain JavaScript too, run by the official Node.js in runtime\\node.",
    "",
  ].join("\r\n"));
  return src.length;
}

async function main() {
  const noImages = flag("no-images");
  const deployed = versions.readManifest();
  if (flag("allow-changed-save")) stop("--allow-changed-save is gone: the package ships no save (the companion makes the table from the host's Workshop copy)");
  const made4p = readTable();
  const compose = fs.readFileSync(path.join(ROOT, "stack", "compose.yml"), "utf8");
  const containers = await new Promise((done) => versions.containerImages(done)); // (the running stack on this PC)
  const bridge = versions.bridgeHash();
  if (flag("release") && flag("allow-undeployed-bridge"))
    stop(releaseRefusals({ build: [], imagesFile: "-", tag: "-", allowUndeployedBridge: true }).join("; "));
  // the release key before the companion is built: its public half must be inside the exe this release ships
  const signing = flag("release") ? releaseSigning() : null;
  const why = refusals({ deployed, tags: tagIds(), containers, table: made4p, bridge, compose },
    { allowUndeployedBridge: flag("allow-undeployed-bridge") });
  if (why.length) stop(`stack/deployed.json disagrees with what would be shipped:\n  - ${why.join("\n  - ")}`);

  // the bridge's data, checked before anything is written
  const presetsDir = path.join(ROOT, "manabrew", "public", "preset_decks");
  const bridgeSrc = fs.readFileSync(path.join(ROOT, "bridge", "bridge.js"), "utf8");
  const defaults = [DEFAULT_DECKS_RE, STANDARD_DECKS_RE].flatMap((re) => JSON.parse(re.exec(bridgeSrc)[1]));
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
  const [ours, theirs, scenarios] = DATA_DIRS.map((d) => (fs.existsSync(path.join(ROOT, d)) ? copyJsonDir(path.join(ROOT, d), path.join(pkg, d)) : []));

  copy(node.file, path.join(pkg, "runtime", "node", "node.exe"));

  // the table: our patcher, never the table itself (the companion makes it from the host's Workshop copy)
  for (const f of tables.PATCHER_FILES) copy(path.join(__dirname, f), path.join(pkg, "table", f));
  fs.writeFileSync(path.join(pkg, "table", "README.txt"), tableReadme().replace(/\n/g, "\r\n"));

  const info = {
    bridge, table: made4p.stamp, save: made4p.save, node: deployed.node, relay: deployed.relay,
    // (what the companion makes the table from: the Workshop item, and the hash of the copy this package was checked
    // with; a host's copy with another hash was updated by its author and may or may not still patch)
    workshop: { id: TABLE.id, url: TABLE.url, sha8: made4p.workshop },
    tables: [{ key: "4p", id: TABLE.id, url: TABLE.url, saveName: TABLE.saveName, file: TABLE.file, optional: false }],
    built: new Date().toISOString(), gitCommit: gitCommit(),
    // (beyond the contract's keys) the deploy this was cut from, and both ids of each image: Docker's containerd store
    // reports `id`, the classic store `config`
    deployed: { bridge: deployed.bridge, save: deployed.save, at: deployed.at },
    images: {}, imagesFile: noImages ? null : "images/mtg-images.tar", nodeVersion: node.version, saveName: SAVE_NAME, composeProject: PROJECT,
  };

  fs.mkdirSync(path.join(pkg, "stack"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "stack", "compose.yml"), composeYaml());

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
  fs.writeFileSync(path.join(pkg, "stack", "deployed.json"), `${JSON.stringify(deployedRecord(deployed, { bridge, save: info.save, at: info.built, images: info.images }), null, 1)}\n`);
  fs.mkdirSync(path.join(pkg, "logs"), { recursive: true });

  for (const [to, from] of Object.entries(licences)) copy(from, path.join(pkg, "LICENSES", to));
  fs.writeFileSync(path.join(pkg, "LICENSES", "Node-LICENSE.txt"), nodeLicense(node.version));
  fs.writeFileSync(path.join(pkg, "LICENSES", "SOURCE.txt"), sourceText({
    manabrewCommit: pinned("MANABREW_COMMIT"), forgeCommit: pinned("FORGE_COMMIT"), nodeVersion: node.version,
    patches: { manabrew: sha8(fs.readFileSync(licences["source/manabrew.patch"])), forge: sha8(fs.readFileSync(licences["source/forge.patch"])) },
  }).replace(/\n/g, "\r\n"));
  const made = companion(pkg);
  fs.writeFileSync(path.join(pkg, "README-FRIEND.txt"), readmeText(info).replace(/\n/g, "\r\n"));
  const release = flag("release") ? releaseStart(pkg, out, info) : null;
  fs.writeFileSync(path.join(pkg, "version.json"), `${JSON.stringify(info, null, 1)}\n`);
  const copies = tableCopies(packageEntries(pkg));
  if (copies.length) stop(`the package would hand out a copy of a Workshop table (Steam lets subscribers use it, not distribute it): ${copies.join(", ")}`);

  console.log(`  zipping (${mb(sizeOf(pkg))})`);
  execFileSync(TAR, ["-a", "-c", "-f", zip, "-C", out, name], { stdio: "inherit", timeout: 1800000 });

  const lines = fs.readdirSync(pkg).sort().map((f) => `  ${f.padEnd(28)} ${mb(sizeOf(path.join(pkg, f))).padStart(10)}`);
  console.log(`${lines.join("\n")}\n  decks: ${ours.length} ours, ${theirs.length} Manabrew's; ${scenarios.length} debug scenarios; companion: ${made}`);
  console.log(`made ${pkg} (${mb(sizeOf(pkg))}) and ${zip} (${mb(fs.statSync(zip).size)})`);
  if (release) releaseFinish(release, pkg, zip, info, signing);
}

// ── --release: dist/release-<tag>/ (docs/companion-app-spec.md §11.3)

const sha256 = (file) => require("crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function filesUnder(root, rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return [];
  if (!fs.statSync(p).isDirectory()) return [{ rel, bytes: fs.readFileSync(p) }];
  return fs.readdirSync(p).flatMap((f) => filesUnder(root, `${rel}/${f}`));
}
function companionVersion() {
  const dir = path.join(path.resolve(option("companion", ROOT)), "companion");
  if (!fs.existsSync(path.join(dir, "src"))) return null;
  const files = [...fs.readdirSync(path.join(dir, "src")).filter((f) => f.endsWith(".cs")).map((f) => `src/${f}`), "app.manifest", "build.cmd", "release-keys.txt"]; // (the keys are inside the exe)
  return treeHash(files.flatMap((rel) => filesUnder(dir, rel)));
}
// the private key, and the public half in the companion's release-keys.txt (added when missing: commit that file)
function releaseSigning() {
  const file = process.env.MTG_RELEASE_KEY || path.join(process.env.USERPROFILE || require("os").homedir(), ".mtg-release", "release-key.pem");
  let k;
  try { k = releaseKey(file, ROOT); } catch (e) { stop(e.message); }
  if (k.made) console.log(`\n  NEW RELEASE KEY: ${file}\n  Back it up somewhere safe and never share it or commit it. Every installed companion trusts only\n  this key: lose it and friends must download a full package again (key change: docs/companion-app-spec.md §11.3).\n`);
  const pub = publicKeyText(k.key);
  const keysFile = path.join(path.resolve(option("companion", ROOT)), "companion", "release-keys.txt");
  const have = fs.existsSync(keysFile) ? fs.readFileSync(keysFile, "utf8") : "";
  if (!have.split(/\r?\n/).map((l) => l.trim()).includes(pub)) {
    fs.writeFileSync(keysFile, `${have}${have && !have.endsWith("\n") ? "\n" : ""}${pub}\n`);
    console.log(`  added the release key's public half to ${keysFile}: commit it (the exe built now carries it)`);
  }
  return { key: k.key, file, pub };
}

function previousManifest(out, tag) {
  const given = option("previous", null);
  if (given) return JSON.parse(fs.readFileSync(given, "utf8"));
  const found = fs.existsSync(out) ? fs.readdirSync(out).filter((d) => d.startsWith("release-") && d !== `release-${tag}`)
    .map((d) => path.join(out, d, "update-manifest.json")).filter((m) => fs.existsSync(m))
    .map((m) => JSON.parse(fs.readFileSync(m, "utf8"))).sort((a, b) => (a.built < b.built ? 1 : -1)) : [];
  return found[0] || null;
}

// before version.json is written: the tag and the part versions go into it
function releaseStart(pkg, out, info) {
  const d = new Date(), two = (n) => String(n).padStart(2, "0");
  const tag = option("tag", `v${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`);
  if (!validTag(tag)) stop(`the tag ${tag} has characters a release tag can't have`);
  const app = RELEASE_PARTS.app.holds.flatMap((h) => filesUnder(pkg, h));
  // (the table part is our patcher: its version is its files' hash, not the table's, which each host makes)
  const partVersions = { app: appVersion(app), table: treeHash(filesUnder(pkg, "table")), images: imagesVersion(info.node, info.relay), runtime: info.nodeVersion };
  const cv = companionVersion();
  if (cv && fs.existsSync(path.join(pkg, "MTG Companion.exe"))) partVersions.companion = cv;
  const previous = previousManifest(out, tag);
  const published = !!option("previous", null);
  const plan = planRelease(partVersions, previous, { published, have: (release, file, sha) => { const f = path.join(out, `release-${release}`, file); return fs.existsSync(f) && sha256(f) === sha; } });
  for (const k of plan.unproven) console.log(`  (${k}: unchanged, but ${previous.parts[k].file} of ${previous.parts[k].release || previous.version} isn't in ${out} with its sha256, and no --previous says it is published: built again)`);
  const why = releaseRefusals({ build: plan.build, imagesFile: info.imagesFile, tag });
  if (why.length) stop(`--release: ${why.join("; ")}`);
  info.release = tag;
  info.parts = partVersions;
  return { tag, dir: path.join(out, `release-${tag}`), partVersions, previous, plan };
}

function releaseFinish({ tag, dir, partVersions, previous, plan }, pkg, zip, info, signing) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const put = (from, name) => { const to = path.join(dir, name); try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } return to; };
  const made = {};
  for (const k of plan.build) {
    const { file, holds } = RELEASE_PARTS[k];
    const to = path.join(dir, file);
    if (file.endsWith(".zip")) execFileSync(TAR, ["-a", "-c", "-f", to, "-C", pkg, ...APP_EXCLUDED.flatMap((x) => ["--exclude", x]), ...holds.filter((h) => fs.existsSync(path.join(pkg, h)))], { stdio: "inherit", timeout: 1800000 });
    else put(path.join(pkg, holds[0]), file);
    made[k] = { file, sha256: sha256(to), size: fs.statSync(to).size };
  }
  const fullName = path.basename(zip);
  put(zip, fullName);
  const manifest = releaseManifest({
    tag, built: info.built, gitCommit: info.gitCommit, partVersions, made, reuse: plan.reuse,
    full: { file: fullName, sha256: sha256(path.join(dir, fullName)), size: fs.statSync(zip).size },
    versionJson: info, deployedJson: JSON.parse(fs.readFileSync(path.join(pkg, "stack", "deployed.json"), "utf8")),
  });
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 1)}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "update-manifest.json"), bytes);
  fs.writeFileSync(path.join(dir, "update-manifest.json.sig"), `${signManifest(bytes, signing.key)}\n`);
  if (!crypto.verify("sha256", bytes, { key: crypto.createPublicKey(signing.key), dsaEncoding: "ieee-p1363" }, Buffer.from(fs.readFileSync(path.join(dir, "update-manifest.json.sig"), "utf8").trim(), "base64"))) stop("the manifest's signature doesn't verify");
  console.log(`\nrelease ${tag} in ${dir}${previous ? ` (after ${previous.version})` : " (no previous release: every part built)"}`);
  console.log(`  Create the release with tag ${tag} on Vibecoding-mods/Table-Top-Simulator-Mock-MTGA and attach:`);
  for (const f of ["update-manifest.json", "update-manifest.json.sig", ...plan.build.map((k) => RELEASE_PARTS[k].file), fullName]) console.log(`    ${f.padEnd(34)} ${mb(fs.statSync(path.join(dir, f)).size).padStart(10)}`);
  for (const [k, p] of Object.entries(plan.reuse)) console.log(`  (${k}: unchanged, the updater takes ${p.file} from release ${p.release})`);
  for (const r of pointedAt(manifest)) console.log(`  keep release ${r} published: this release takes files from it`);
  console.log(`  signed with ${signing.file} (public key in companion/release-keys.txt)`);
}

if (require.main === module) main().catch((e) => stop(e.stack || e.message));
module.exports = { companionSource, stampOf, renameSave, tableCopies, packageEntries, tableReadme, hostRequirements, readTable, WORKSHOP, refusals, composeYaml, tarRead, tarImages, tarMismatch, deployedRecord, readmeText, treeHash, imagesVersion, planRelease, releaseManifest, releaseRefusals, pointedAt, appVersion, validTag, signManifest, publicKeyText, releaseKey, RELEASE_PARTS, UPDATE_FORMAT, APP_UNVERSIONED, APP_EXCLUDED, IMAGES, DATA_DIRS, PROJECT, SAVE_NAME, BRIDGE_SHIPPED: [...BRIDGE_DATA, ...BRIDGE_CACHE] };
