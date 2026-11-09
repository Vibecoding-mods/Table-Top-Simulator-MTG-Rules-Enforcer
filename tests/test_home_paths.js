// Where the bridge finds its data and writes its logs (bridge/home.js): unset, the repo's places as before; with
// MTG_HOME and MTG_LOG_DIR, the package's (tools/make-friend-package.js). The modules read the env when loaded, so each
// case runs in a child process. The last case starts a real bridge from a copied folder on spare ports.
//   node tests/test_home_paths.js
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const REPO = path.join(__dirname, "..");
const BRIDGE = path.join(REPO, "bridge");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MTG_HOME|MTG_LOG_DIR|MTG_RESUME_FILE|MTG_SCENARIO_DIR|COMPOSE_PROJECT_NAME)$/i.test(k)));
// what the modules resolve, read in a fresh process with this env
function resolved(env) {
  const code = `
    const containers = []; // (the names versions.js asks docker about; it takes execFile when loaded)
    require("child_process").execFile = (cmd, args, opts, done) => { containers.push(...args.slice(3)); done(new Error("no docker here")); };
    const home = require(${JSON.stringify(path.join(BRIDGE, "home"))});
    const versions = require(${JSON.stringify(path.join(BRIDGE, "versions"))});
    const presets = require(${JSON.stringify(path.join(BRIDGE, "presets"))});
    versions.containerImages(() => {});
    console.log(JSON.stringify({ data: home.data("decks"), tmp: home.tmp("x.log"), beside: home.beside("y.log"), logDir: home.LOG_DIR,
      manifest: versions.MANIFEST, compose: versions.COMPOSE, containers, presetDirs: presets.PRESET_DIRS, ids: presets.presetIds(),
      deployed: versions.readManifest(), files: versions.BRIDGE_FILES.map((f) => require("path").basename(f)) }));`;
  return JSON.parse(execFileSync(process.execPath, ["-e", code], { env: { ...CLEAN, ...env }, encoding: "utf8" }));
}

// unset: the repo's places, exactly as the paths were written before home.js
{
  const r = resolved({});
  same("default: decks in the repo", r.data, path.join(REPO, "decks"));
  same("default: logs and state in the repo's tmp/", r.tmp, path.join(REPO, "tmp", "x.log"));
  same("default: the console and game logs beside the bridge", r.beside, path.join(BRIDGE, "y.log"));
  same("default: no log folder set", r.logDir, null);
  same("default: the deploy record", r.manifest, path.join(REPO, "stack", "deployed.json"));
  same("default: the compose file", r.compose, path.join(REPO, "stack", "compose.yml"));
  same("default: containers of the project named after the compose file's folder", r.containers, ["stack-forge-room-1", "stack-relay-1"]);
  same("default: presets, ours first", r.presetDirs, [path.join(REPO, "decks"), path.join(REPO, "manabrew", "public", "preset_decks")]);
  ok("default: home.js counts in the bridge's hash", r.files.includes("home.js"));
}

// MTG_HOME and MTG_LOG_DIR: a package-shaped folder, the log folder made at load
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-home-"));
const pkg = path.join(tmpRoot, "pkg"), logs = path.join(tmpRoot, "pkg", "logs");
const put = (rel, text) => { const f = path.join(pkg, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
put("decks/ours_one.json", "{}");
put("decks/both.json", "{}");
put("manabrew/public/preset_decks/theirs_one.json", "{}");
put("manabrew/public/preset_decks/both.json", "{}");
put("stack/compose.yml", "# a comment\nname: mtg-table\nservices: {}\n");
put("stack/deployed.json", JSON.stringify({ bridge: "pkgbrdg1", table: "t" }));
{
  const r = resolved({ MTG_HOME: pkg, MTG_LOG_DIR: logs });
  same("MTG_HOME: decks", r.data, path.join(pkg, "decks"));
  same("MTG_LOG_DIR: logs and state", r.tmp, path.join(logs, "x.log"));
  same("MTG_LOG_DIR: the console and game logs too", r.beside, path.join(logs, "y.log"));
  ok("MTG_LOG_DIR: the folder is made", fs.existsSync(logs));
  same("MTG_HOME: the deploy record", r.manifest, path.join(pkg, "stack", "deployed.json"));
  same("MTG_HOME: the deploy record is read from there", r.deployed?.bridge, "pkgbrdg1");
  same("compose name: sets the containers' project", r.containers, ["mtg-table-forge-room-1", "mtg-table-relay-1"]);
  same("MTG_HOME: presets from both folders, each id once", r.ids, ["both", "ours_one", "theirs_one"]);
  same("MTG_HOME: presets, ours first", r.presetDirs, [path.join(pkg, "decks"), path.join(pkg, "manabrew", "public", "preset_decks")]);
}
{
  const r = resolved({ MTG_LOG_DIR: logs });
  same("MTG_LOG_DIR alone: data stays in the repo", r.data, path.join(REPO, "decks"));
  same("COMPOSE_PROJECT_NAME unset: the repo's project", r.containers[0], "stack-forge-room-1");
  same("COMPOSE_PROJECT_NAME wins over the file, as in compose", resolved({ MTG_HOME: pkg, COMPOSE_PROJECT_NAME: "other" }).containers, ["other-forge-room-1", "other-relay-1"]);
}

// editor-forward's save backups go to the log folder
{
  const save = path.join(tmpRoot, "TS_Save_9.json");
  fs.writeFileSync(save, "{\"SaveName\":\"x\"}");
  const code = `require(${JSON.stringify(path.join(BRIDGE, "editor-forward"))}).makeSaveBackup(${JSON.stringify(save)})().then((f) => console.log(f));`;
  const to = execFileSync(process.execPath, ["-e", code], { env: { ...CLEAN, MTG_LOG_DIR: logs }, encoding: "utf8" }).trim();
  same("MTG_LOG_DIR: save backups in <logs>/backup", path.dirname(to), path.join(logs, "backup"));
}

// No path into the repo is left outside home.js: every other file of the bridge resolves the repo through it, and what
// it reads beside itself is what the friend package ships
{
  const pack = require("../tools/make-friend-package");
  const shipped = new Set(pack.BRIDGE_SHIPPED);
  for (const f of require("../bridge/versions").BRIDGE_FILES) {
    const name = path.basename(f);
    if (name === "home.js") continue;
    let src = fs.readFileSync(f, "utf8");
    // (versions.js keeps the repo for the table's source, tools/*.lua: only to say it changed, and absent in a package)
    if (name === "versions.js") src = src.replace('const ROOT = path.join(__dirname, "..");', "");
    same(`no repo path in ${name} but through home.js`, src.match(/path\.join\(__dirname, "\.\."/g) || [], []);
    for (const m of src.matchAll(/path\.join\(__dirname, "([^"]+)"\)/g)) ok(`the package ships bridge/${m[1]} (read by ${name})`, shipped.has(m[1]));
  }
}

// a real bridge from a copied folder: it answers /versions from that folder's files, its logs go to MTG_LOG_DIR
const freePort = () => new Promise((done) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => done(p)); }); });
async function liveRun() {
  const versions = require("../bridge/versions");
  fs.mkdirSync(path.join(pkg, "bridge"), { recursive: true });
  for (const f of versions.BRIDGE_FILES) fs.copyFileSync(f, path.join(pkg, "bridge", path.basename(f)));
  const [ttsIn, ttsOut, debug, relay] = [await freePort(), await freePort(), await freePort(), await freePort()];
  const child = spawn(process.execPath, ["bridge.js", "--tts-in", ttsIn, "--tts-out", ttsOut, "--debug-port", debug, "--relay", `ws://127.0.0.1:${relay}`].map(String),
    { cwd: path.join(pkg, "bridge"), env: { ...CLEAN, MTG_LOG_DIR: logs }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  try {
    let v = null;
    for (let i = 0; i < 60 && !v; i++) {
      await new Promise((done) => setTimeout(done, 250));
      v = await fetch(`http://127.0.0.1:${debug}/versions`).then((r) => r.json()).catch(() => null);
    }
    ok("live: the copied bridge answers /versions", !!v, out.slice(-500));
    if (!v) return;
    const want = versions.sha8(versions.BRIDGE_FILES.map((f) => fs.readFileSync(path.join(pkg, "bridge", path.basename(f)), "utf8")).join("\0"));
    same("live: its hash is the copied code's", v.now.bridge, want);
    same("live: its deploy record is the folder's", v.deployed?.bridge, "pkgbrdg1");
    ok("live: it says the code isn't the folder's deployed one", (v.outOfStep || []).some((s) => s.includes("bridge isn't the deployed")), JSON.stringify(v.outOfStep));
    ok("live: no table source here, so nothing waits for it", !(v.waiting || []).some((s) => s.includes("engine-renderer")), JSON.stringify(v.waiting));
    const stats = await fetch(`http://127.0.0.1:${debug}/stats`).then((r) => r.ok).catch(() => false);
    ok("live: /stats answers", stats);
    ok("live: no tmp/ made in the folder", !fs.existsSync(path.join(pkg, "tmp")));
    // GET /health: cheap (no docker, no TTS), and the table's hello shows in it
    const health = async () => { const t0 = Date.now(); const body = await fetch(`http://127.0.0.1:${debug}/health`).then((r) => r.json()); return { ms: Date.now() - t0, body }; };
    const h0 = await health();
    ok("health: answers in well under a second", h0.ms < 500, `${h0.ms} ms`);
    same("health: no game, the table not heard", h0.body, { phase: "none", started: false, seats: false, bridge: want, table: { stamp: null, lastHeardMs: null }, ttsConnected: null });
    await fetch(`http://127.0.0.1:${debug}/msg`, { method: "POST", body: JSON.stringify({ t: "hello", stamp: "abcd1234", again: true }) });
    const h1 = (await health()).body;
    same("health: the table's stamp, after its hello", h1.table.stamp, "abcd1234");
    ok("health: heard just now", typeof h1.table.lastHeardMs === "number" && h1.table.lastHeardMs < 5000, JSON.stringify(h1.table));
    same("health: TTS spoke, so it is up", h1.ttsConnected, true);
  } finally {
    const gone = new Promise((done) => child.on("exit", done));
    child.kill();
    await gone; // (Windows keeps the folder busy until the process is gone)
  }
}

liveRun().catch((e) => ok("live run", false, e.stack)).finally(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.stdout.write(failed ? `\n${failed} bridge home checks failed (${passed} passed)\n` : `all ${passed} bridge home checks pass\n`);
  process.exit(failed ? 1 : 0);
});
