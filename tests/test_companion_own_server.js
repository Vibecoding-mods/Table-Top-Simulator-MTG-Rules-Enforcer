// The Windows companion's own-server mode (companion/src/OwnServer.cs; docs/companion-app-spec.md §5.8): a friend's
// companion plays on the host's engine over the network instead of running Docker.
//  1. `--selftest --section own-server`: server.json and --server, the key encrypted at rest (DPAPI, a plain key saved
//     again encrypted), the start light (the server's engine build against the table's), the bridge's environment, no
//     Own server box (the owner's decision, 2026-11-17), the key never shown or logged.
//  2. The real companion (`--observe --dump --steps 1,2,3`) in a temp package with a server.json, against a fake relay
//     on this computer (a WebSocket server on a spare port, never the live 9443): the server answers (green, Docker and
//     the images "Not needed here"), a wrong key, nothing on the port, a busy room, no Forge room, a name that doesn't
//     resolve, no key, and no server.json (this computer's engine again); the key never in the dump or the log.
//  3. The status page (companion/src/WebPage.cs, its script in a Node vm) has no Own server box.
// Builds the exe first: build.cmd on Windows; elsewhere mono's mcs (C# 5, the same sources) and runs it under mono with
// a virtual display (xvfb-run), when they are installed.
//   node tests/test_companion_own_server.js
// (COMPANION_EXE=<an exe> runs that build, COMPANION_PAGE=<a WebPage.cs> reads that page:
// tools/mutate-companion-own-server.js breaks one rule at a time so a check fails by name.)
require("./no-live-ports");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn, spawnSync, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "companion", "src");
const WIN = process.platform === "win32";
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const KEY = `k-${crypto.randomBytes(6).toString("hex")}-own`;

// ── the exe: COMPANION_EXE, else built from companion/src (null: no C# compiler here)
const has = (cmd) => spawnSync(WIN ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;
function build() {
  if (process.env.COMPANION_EXE) return process.env.COMPANION_EXE;
  if (WIN) {
    // (into a temp folder: the real bin's exe may be running, and then it can't be overwritten)
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-companion-test-"));
    execFileSync("cmd", ["/c", path.join(ROOT, "companion", "build.cmd")], { stdio: "ignore", timeout: 300000, env: { ...process.env, COMPANION_OUT: out } });
    return path.join(out, "MTG Companion.exe");
  }
  if (!has("mcs") || !has("mono") || !has("xvfb-run")) return null;
  const out = path.join(os.tmpdir(), `mtg-companion-own-server-${process.pid}.exe`);
  const refs = ["System", "System.Core", "System.Drawing", "System.Windows.Forms", "System.Management", "System.Web.Extensions", "System.Security", "System.IO.Compression", "System.IO.Compression.FileSystem"];
  const cs = fs.readdirSync(SRC).filter((f) => f.endsWith(".cs")).map((f) => path.join(SRC, f));
  const r = spawnSync("mcs", ["-nologo", "-target:winexe", "-langversion:5", `-out:${out}`, `-resource:${path.join(ROOT, "companion", "release-keys.txt")},release-keys.txt`, ...refs.map((x) => `-r:${x}.dll`), ...cs], { encoding: "utf8", timeout: 300000 });
  if (r.status !== 0) { ok("build: the companion compiles (C# 5)", false, r.stdout + r.stderr); return null; }
  process.on("exit", () => { try { fs.rmSync(out, { force: true }); } catch {} });
  return out;
}
// runs the exe with these arguments in cwd: { status, out }
function runExe(exe, args, cwd, env = {}) {
  const [cmd, list] = WIN ? [exe, args] : ["xvfb-run", ["-a", "mono", exe, ...args]];
  return new Promise((done) => {
    const p = spawn(cmd, list, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
    const t = setTimeout(() => p.kill(), 120000);
    p.on("close", (status) => { clearTimeout(t); done({ status, out }); });
  });
}

// A fake relay: answers Authenticate (the right key only) and ListRooms (rooms as given)
function fakeRelay({ key = KEY, rooms = [{ room_name: "tts-commander", status: "Lobby" }] } = {}) {
  const srv = http.createServer((req, res) => { res.writeHead(426); res.end(); });
  const seen = [];
  srv.on("upgrade", (req, sock) => {
    const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (o) => {
      const b = Buffer.from(JSON.stringify(o));
      const head = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]);
      sock.write(Buffer.concat([head, b]));
    };
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const op = buf[0] & 15;
        let len = buf[1] & 127, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
        if (buf.length < at + 4 + len) return;
        const mask = buf.slice(at, at + 4), data = Buffer.from(buf.slice(at + 4, at + 4 + len));
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
        buf = buf.slice(at + 4 + len);
        if (op === 8) { sock.end(); return; }
        if (op !== 1) continue;
        const m = JSON.parse(data.toString("utf8"));
        seen.push(m);
        if (m.type === "Authenticate") send(m.password === key ? { type: "AuthResult", success: true } : { type: "AuthResult", success: false, error: "invalid key" });
        else if (m.type === "ListRooms") send({ type: "RoomList", rooms });
      }
    });
    sock.on("error", () => {});
  });
  return new Promise((done) => srv.listen(0, "127.0.0.1", () => done({ port: srv.address().port, seen, close: () => new Promise((c) => { srv.closeAllConnections?.(); srv.close(c); }) })));
}
const freePort = () => new Promise((done) => { const s = require("net").createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => done(p)); }); });

// a temp friend package: the exe's folder with version.json and a server.json (null: none)
function makePkg(exe, server, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-own-server-pkg-"));
  fs.mkdirSync(path.join(dir, "logs"));
  fs.mkdirSync(path.join(dir, "stack"));
  fs.writeFileSync(path.join(dir, "version.json"), JSON.stringify({ built: "2026-11-17T00:00:00Z" }));
  if (server !== null) fs.writeFileSync(path.join(dir, "server.json"), typeof server === "string" ? server : JSON.stringify(server));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
  const copy = path.join(dir, "MTG Companion.exe");
  fs.copyFileSync(exe, copy);
  return { dir, exe: copy };
}
// one --observe pass of steps 1-3: the dump's rows and text, and the log
async function observe(exe, server, extraArgs = [], env = {}, files = {}) {
  const pkg = makePkg(exe, server, files);
  try {
    const dumpFile = path.join(pkg.dir, "dump.txt");
    const r = await runExe(pkg.exe, ["--observe", "--no-web", "--no-browser", "--steps", "1,2,3", "--state", path.join(pkg.dir, "state"), "--saves", path.join(pkg.dir, "saves"),
      "--bridge-url", "http://127.0.0.1:9", "--dump", dumpFile, ...extraArgs], pkg.dir, { MTG_SERVER_KEY: "", ...env });
    const dump = fs.existsSync(dumpFile) ? fs.readFileSync(dumpFile, "utf8") : "";
    const log = fs.existsSync(path.join(pkg.dir, "logs", "companion.log")) ? fs.readFileSync(path.join(pkg.dir, "logs", "companion.log"), "utf8") : "";
    const rows = {};
    for (const m of dump.matchAll(/^\s+(\d) (.{14}) \[(\w+)\s*\] (.*)$/gm)) rows[m[1]] = { name: m[2].trim(), light: m[3], text: m[4] };
    return { rows, dump, log, out: r.out, status: r.status };
  } finally { fs.rmSync(pkg.dir, { recursive: true, force: true }); }
}

// ── 3. the page's box: its pure functions out of WebPage.cs
function pageChecks() {
  const file = process.env.COMPANION_PAGE || path.join(SRC, "WebPage.cs");
  const cs = fs.readFileSync(file, "utf8");
  const m = /public const string Html = @"([\s\S]*?)";\s*\}\s*\}\s*$/.exec(cs);
  if (!m) { ok("page: the Html string", false, file); return; }
  const html = m[1];
  const script = (/<script\b[^>]*>([\s\S]*?)<\/script>/.exec(html) || [])[1] || "";
  const ctx = vm.createContext({});
  vm.runInContext(script, ctx);
  const P = ctx.MtgPage;
  ok("page: no Own server box (the owner's decision, 2026-11-17)", !/srvbox|id='srv-|\/api\/server/.test(html), (/.{0,60}(srvbox|srv-|\/api\/server).{0,60}/.exec(html) || [""])[0]);
  ok("page: its script has no box functions left", P && P.serverView === undefined && P.serverRequest === undefined);
}

(async () => {
  pageChecks();
  const exe = build();
  if (!exe) {
    process.stdout.write("SKIP the companion's own checks: no C# compiler here (Windows: build.cmd; elsewhere: mono's mcs, mono and xvfb-run)\n");
    console.log(failed ? `FAIL test_companion_own_server: ${failed} failed, ${passed} passed` : `PASSED: ${passed} checks (the page only)`);
    process.exit(failed ? 1 : 0);
  }
  // 1. the self-test section
  {
    const r = await runExe(exe, ["--selftest", "--section", "own-server"], os.tmpdir());
    const fails = (r.out.match(/^FAIL .*$/gm) || []);
    for (const f of fails) ok(`selftest: ${f.slice(5).split("   got:")[0]}`, false, f);
    const m = /(\d+) passed, (\d+) failed/.exec(r.out);
    ok("selftest: the own-server section ran, every check passed", m && Number(m[1]) >= 50 && m[2] === "0" && r.status === 0, r.out.slice(-400));
  }
  // 2. the real companion against a fake relay
  const relay = await fakeRelay();
  try {
    const s = { host: "127.0.0.1", port: relay.port, key: KEY };
    let o = await observe(exe, s);
    ok("server answers: green, Your server, the room open", o.rows[3]?.name === "Your server" && o.rows[3]?.light === "GREEN" && /Your server answers \(127\.0\.0\.1:\d+\): room tts-commander is open/.test(o.rows[3]?.text), o.dump || o.out);
    ok("server answers: Docker and the images aren't needed here", o.rows[1]?.light === "GREEN" && /Not needed here/.test(o.rows[1]?.text) && o.rows[2]?.light === "GREEN" && /Not needed here/.test(o.rows[2]?.text), JSON.stringify(o.rows));
    ok("server answers: the dump says which engine", /^Engine: your server 127\.0\.0\.1:\d+$/m.test(o.dump), o.dump);
    ok("server answers: the key was sent to the server", relay.seen.some((m) => m.type === "Authenticate" && m.password === KEY));
    ok("the key is never in the dump or the log", !o.dump.includes(KEY) && !o.log.includes(KEY) && !o.out.includes(KEY));
    o = await observe(exe, { ...s, key: "not-the-key-000" });
    ok("a wrong key: red, refused the key, Try again", o.rows[3]?.light === "RED" && /refused the key/.test(o.rows[3]?.text) && /button: Try again/.test(o.rows[3]?.text), o.rows[3]?.text || o.out);
    const nothing = await freePort();
    o = await observe(exe, { ...s, port: nothing });
    ok("nothing on the port: red, nothing listens", o.rows[3]?.light === "RED" && new RegExp(`nothing listens on port ${nothing} there`).test(o.rows[3]?.text), o.rows[3]?.text || o.out);
    o = await observe(exe, { ...s, host: "no-such-host.invalid" });
    ok("a name that doesn't resolve: red, isn't known", o.rows[3]?.light === "RED" && /"no-such-host\.invalid" isn't known/.test(o.rows[3]?.text), o.rows[3]?.text || o.out);
    o = await observe(exe, { host: "127.0.0.1", port: relay.port });
    ok("no key: red, says where the key goes, nothing sent", o.rows[3]?.light === "RED" && /no key for your server/.test(o.rows[3]?.text), o.rows[3]?.text || o.out);
    o = await observe(exe, { host: "127.0.0.1", port: relay.port }, [], { MTG_SERVER_KEY: KEY });
    ok("MTG_SERVER_KEY gives the key: green", o.rows[3]?.light === "GREEN", o.rows[3]?.text || o.out);
    o = await observe(exe, "{ \"host\": ");
    ok("a broken server.json: red, says so", o.rows[3]?.light === "RED" && /server\.json isn't valid JSON/.test(o.rows[3]?.text), o.rows[3]?.text || o.out);
    o = await observe(exe, null, ["--server", `127.0.0.1:${relay.port}`], { MTG_SERVER_KEY: KEY });
    ok("--server HOST:PORT without a server.json: green", o.rows[3]?.light === "GREEN" && o.rows[3]?.name === "Your server", o.rows[3]?.text || o.out);
    o = await observe(exe, null);
    ok("no server.json: this computer's engine (Engine stack, Docker asked)", o.rows[3]?.name === "Engine stack" && /^Engine: this PC \(Docker\)$/m.test(o.dump) && !/Not needed here/.test(o.dump), o.dump || o.out);
  } finally { await relay.close(); }
  // the server's engine build against the table's (stack/deployed.json engineBuild): amber when they differ
  const built = await fakeRelay({ rooms: [{ room_name: "tts-commander", status: "Lobby", engine_build: "engine1120" }] });
  try {
    const s = { host: "127.0.0.1", port: built.port, key: KEY };
    let o = await observe(exe, s, [], {}, { "stack/deployed.json": JSON.stringify({ bridge: "b", table: "t", engineBuild: "engine1121" }) });
    ok("another engine build than the table's: amber, both named, Try again", o.rows[3]?.light === "AMBER" && /Your server runs engine engine1120, but this table was deployed with engine engine1121/.test(o.rows[3]?.text), o.rows[3]?.text || o.out);
    o = await observe(exe, s, [], {}, { "stack/deployed.json": JSON.stringify({ bridge: "b", table: "t", engineBuild: "engine1120" }) });
    ok("the table's engine build: green", o.rows[3]?.light === "GREEN" && /room tts-commander is open/.test(o.rows[3]?.text), o.rows[3]?.text || o.out);
  } finally { await built.close(); }
  for (const [name, rooms, re] of [["a busy room", [{ room_name: "tts-commander", status: "InGame" }], /busy with an earlier game/], ["no Forge room", [], /its Forge room \(tts-commander\) isn't open/]]) {
    const r2 = await fakeRelay({ rooms });
    try {
      const o = await observe(exe, { host: "127.0.0.1", port: r2.port, key: KEY });
      ok(`${name}: red, says so`, o.rows[3]?.light === "RED" && re.test(o.rows[3]?.text), o.rows[3]?.text || o.out);
    } finally { await r2.close(); }
  }
  console.log(failed ? `FAIL test_companion_own_server: ${failed} failed, ${passed} passed` : `PASSED: ${passed} checks`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_companion_own_server: ${e.stack}`); process.exit(1); });
