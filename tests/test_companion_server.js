// The companion's own-server mode (companion-node: logic.serverSetting / decideServer, Controller.doServer / serverEnv,
// companion.js reading server.json and --server; HOW-TO-PLAY.md "Own server"): against a fake relay on this computer
// (a WebSocket server on a spare port, never the live 9443), the real connection check (probes.relayLogin) and the
// light it gives for each way a server can fail; then the companion itself (--observe --dump) with a server.json.
//   node tests/test_companion_server.js            the checks
//   node tests/test_companion_server.js --breakit  breaks the wiring one rule at a time (controller.js, companion.js,
//                                                  edited in place and put back by sha256) and requires a named FAIL,
//                                                  here or in the companion's --selftest (its own-server wiring checks)
require("./no-live-ports");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync, spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const C = path.join(ROOT, "companion-node");

if (process.argv.includes("--breakit")) { breakit(); return; }

const L = require("../companion-node/logic");
const probes = require("../companion-node/probes");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };

// A fake relay: answers Authenticate (the right key only) and ListRooms (rooms as given); silent: never answers
function fakeRelay({ key = "server-key", rooms = [{ room_name: L.Room, status: "Lobby" }], silent = false } = {}) {
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
        if (op !== 1 || silent) continue;
        const m = JSON.parse(data.toString("utf8"));
        seen.push(m);
        if (m.type === "Authenticate") send(m.password === key ? { type: "AuthResult", success: true } : { type: "AuthResult", success: false, error: "invalid key" });
        else if (m.type === "ListRooms") send({ type: "RoomList", rooms });
      }
    });
    sock.on("error", () => {});
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ port: srv.address().port, seen, close: () => new Promise((d) => srv.close(d)) })));
}
const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const settingFor = (port, extra = {}) => L.serverSetting(JSON.stringify({ host: "127.0.0.1", port, key: "server-key", ...extra }), null, null);
const check = async (setting) => L.decideServer(setting, await probes.relayLogin(L.serverUrl(setting.server), setting.server.key, L.Room, 1500), L.Game.none("no game"));
const readOr = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const waitFor = async (cond, ms) => { const until = Date.now() + ms; while (Date.now() < until) { const v = await cond(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } return null; };
const httpText = (url, headers = {}) => new Promise((done) => {
  const req = http.get(url, { headers, agent: false }, (res) => { let b = ""; res.on("data", (d) => { b += d; }); res.on("end", () => done({ status: res.statusCode, body: b })); });
  req.on("error", (e) => done({ status: 0, body: e.message })); req.setTimeout(5000, () => req.destroy());
});

// The bridge's side of own-server mode (bridge.js under tests/bridge-harness.js: nothing reaches a real relay, TTS or
// container): the key from MTG_KEY_FILE, and "mtg reset" / a Start after a cut-off game touching no container here
async function bridgeSide(tmp) {
  const harness = require("./bridge-harness");
  const vars = ["MTG_KEY_FILE", "MTG_KEY", "MTG_REMOTE_ENGINE", "MTG_RELAY"];
  const had = Object.fromEntries(vars.map((k) => [k, process.env[k]]));
  const put = (o) => { for (const k of vars) { if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k]; } };
  const said = (h) => h.effects.filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text).join("\n");
  const restarts = (h) => h.effects.filter((e) => e.execFile && e.execFile.includes("restart")).length;
  const keyFile = path.join(tmp, "bridge-key");
  fs.writeFileSync(keyFile, "file-key\n");
  try {
    put({ MTG_KEY_FILE: keyFile, MTG_KEY: "env-key", MTG_REMOTE_ENGINE: "1", MTG_RELAY: "ws://mtg.example.org:9443" });
    let h = harness.load();
    const es = h.B._engineSetting();
    ok("bridge: MTG_KEY_FILE's key is the one used (beats MTG_KEY)", es.KEY === "file-key", es.KEY);
    ok("bridge: with MTG_KEY_FILE, MTG_KEY is dropped from the environment (Node's reports print it)", process.env.MTG_KEY === undefined);
    const versionsOf = (B) => new Promise((done) => {
      const res = { writeHead() {}, setHeader() {}, end: (b) => done(b) };
      B.debugServer.emit("request", { method: "GET", url: "/versions", headers: { host: "127.0.0.1:48787" } }, res);
    });
    let vb = null;
    try { vb = JSON.parse(await versionsOf(h.B)); } catch { /* no answer */ }
    ok("bridge, own server: GET /versions says its relay and remoteEngine, and checks no container here", vb && vb.relay === "ws://mtg.example.org:9443" && vb.remoteEngine === true && vb.now.remote === true && !vb.outOfStep.some((w) => /Docker|engine isn't|relay isn't/.test(w)) && restarts(h) === 0 && !h.effects.some((e) => e.execFile), vb);
    h.B.onTTS({ t: "reset" });
    await h.flush();
    ok("bridge, own server: mtg reset restarts no container here and says to restart the room on the server", restarts(h) === 0 && said(h).includes("restart the room on the host's server"), said(h));
    h.effects.length = 0;
    h.B._setGame({ started: true, fromTable: false, seats: new Map(), setupAt: 0 });
    h.B.onTTS({ t: "start", autoReset: true, seats: [] });
    await h.flush();
    ok("bridge, own server: Start after a cut-off game restarts no container and goes on at once (not stuck waiting)", restarts(h) === 0 && said(h).includes("can't restart its Forge room") && said(h).includes("Nobody is seated"), said(h));
    harness.restore();
    put({ MTG_KEY: "env-key" });
    h = harness.load();
    ok("bridge: no MTG_KEY_FILE: MTG_KEY as before", h.B._engineSetting().KEY === "env-key" && process.env.MTG_KEY === "env-key", h.B._engineSetting().KEY);
    ok("bridge, engine here: the local relay, not remote (as before)", h.B._engineSetting().RELAY === "ws://127.0.0.1:9443" && h.B._engineSetting().REMOTE_ENGINE === false, h.B._engineSetting().RELAY);
    h.B.onTTS({ t: "reset" });
    await h.flush();
    ok("bridge, engine here: mtg reset still restarts the Forge room", restarts(h) === 1 && !said(h).includes("own server"), JSON.stringify(h.effects.filter((e) => e.execFile)));
    harness.restore();
  } finally { put(had); }
}

// The companion for real (not --observe): Start engine with a server, steps 3 and 5, so it starts the bridge loop,
// which starts bridge/bridge.js: here a fake that records its environment, command line and a Node diagnostic report,
// and answers /versions. The key must reach the bridge (through its file) and nothing else: not its environment, its
// command line, the report, the logs or the status page. The container engine is a fake (fake-engine.js) that only
// writes down what was asked of it. Also --stop, with a server.json that's fine and one with a problem.
async function realRun() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-companion-real-"));
  const SECRET = `srv-${crypto.randomBytes(8).toString("hex")}`;
  const procs = [];
  const relay = await fakeRelay({ key: SECRET }), relayPort = relay.port;
  try {
    for (const d of ["saves", "state", "logs", "bridge", "stack", "tmp"]) fs.mkdirSync(path.join(home, d), { recursive: true });
    fs.writeFileSync(path.join(home, "Start MTG.bat"), "rem (a repo layout: home mode)\n");
    const record = path.join(home, "bridge-record.json"), engineLog = path.join(home, "engine-calls.txt");
    fs.writeFileSync(path.join(home, "bridge", "bridge.js"), [
      "const fs = require(\"fs\"), http = require(\"http\");",
      "let key = null; try { key = fs.readFileSync(process.env.MTG_KEY_FILE, \"utf8\"); } catch { /* none */ }",
      "const report = JSON.stringify(process.report.getReport());",
      "fs.writeFileSync(process.env.MTG_TEST_RECORD, JSON.stringify({ argv: process.argv, execArgv: process.execArgv, env: process.env, keyFromFile: key, report }));",
      "http.createServer((q, s) => s.end(q.url === \"/versions\" ? JSON.stringify({ now: { bridge: null }, relay: process.env.MTG_RELAY || \"ws://127.0.0.1:9443\", remoteEngine: process.env.MTG_REMOTE_ENGINE === \"1\" }) : JSON.stringify({ started: false, seats: null })))",
      "  .listen(Number(process.env.MTG_TEST_BRIDGE_PORT), \"127.0.0.1\");",
      "const pp = process.ppid; setInterval(() => { try { process.kill(pp, 0); } catch { process.exit(0); } }, 300); setTimeout(() => process.exit(0), 120000);",
    ].join("\n"));
    const pre = path.join(home, "fake-engine.js");
    fs.writeFileSync(pre, [
      "if (process.env.MTG_TEST_AS_LINUX === \"1\") Object.defineProperty(process, \"platform\", { value: \"linux\" });",
      "const fs = require(\"fs\");",
      `const E = require(${JSON.stringify(path.join(C, "engine.js"))}).Engine;`,
      "for (const m of [\"detect\", \"up\", \"down\", \"stop\", \"restart\", \"load\", \"imageId\", \"container\", \"startDesktop\"])",
      "  E.prototype[m] = async function () { fs.appendFileSync(process.env.MTG_TEST_ENGINE_LOG, `${m}\\n`); if (m === \"detect\") { this.cli = \"docker\"; return { answers: true }; } return { code: 0 }; };",
    ].join("\n"));
    const bridgePort = await freePort();
    const env = { ...process.env, NODE_OPTIONS: `--require "${pre.replace(/\\/g, "/")}"`, MTG_TEST_AS_LINUX: process.platform === "win32" ? "1" : "0",
      MTG_TEST_RECORD: record, MTG_TEST_ENGINE_LOG: engineLog, MTG_TEST_BRIDGE_PORT: String(bridgePort), MTG_CONTAINER_RUNTIME: "docker", MTG_SERVER_KEY: "", MTG_KEY: "" };
    const common = ["--home", home, "--saves", path.join(home, "saves"), "--state", path.join(home, "state"), "--log", path.join(home, "logs", "companion.log")];
    const serverFile = path.join(home, "server.json");
    fs.writeFileSync(serverFile, JSON.stringify({ host: "127.0.0.1", port: relayPort, key: SECRET }), { mode: 0o644 });
    if (process.platform !== "win32") fs.chmodSync(serverFile, 0o644);

    let out = "";
    const p = spawn(process.execPath, [path.join(C, "companion.js"), ...common, "--start", "--no-browser", "--web-port", "0", "--bridge-url", `http://127.0.0.1:${bridgePort}`, "--steps", "3,5"], { env });
    procs.push(p);
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
    const url = await waitFor(() => (/Status page: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(out) || [])[1], 30000);
    ok("real run: the status page is up", !!url, out.slice(0, 400));
    const rec = await waitFor(() => { try { return JSON.parse(fs.readFileSync(record, "utf8")); } catch { return null; } }, 60000);
    ok("real run: the companion started the bridge (through the bridge loop)", !!rec, `${readOr(path.join(home, "logs", "companion.log")).slice(-1500)} | bridge log: ${readOr(path.join(home, "tmp", "bridge-live.log")).slice(-800)}`);
    let status = null;
    if (url) {
      const page = await httpText(url);
      const token = (page.body.match(/[0-9a-f]{32}/g) || []).find(() => true);
      status = await waitFor(async () => {
        for (const t of page.body.match(/[0-9a-f]{32}/g) || [token]) {
          const r = await httpText(`${url}api/status`, { "X-MTG-Token": t });
          if (r.status === 200) { const o = JSON.parse(r.body); if (o.lights && o.lights[4] && o.lights[4].state !== "busy" && /Running/.test(o.lights[4].text)) return r.body; }
        }
        return null;
      }, 60000);
    }
    ok("real run: the bridge light goes green on the bridge's answer", !!status, status || out.slice(-600));
    if (rec) {
      const vals = (o) => Object.entries(o || {}).map(([k, v]) => `${k}=${v}`).join("\n");
      ok("real run: the bridge gets the key through its file (MTG_KEY_FILE)", rec.keyFromFile === SECRET, rec.keyFromFile);
      ok("real run: the bridge's environment holds no key", !vals(rec.env).includes(SECRET), Object.keys(rec.env).filter((k) => /KEY/.test(k)).join(" "));
      ok("real run: the bridge's command line holds no key", ![...rec.argv, ...rec.execArgv].join(" ").includes(SECRET), [...rec.argv, ...rec.execArgv].join(" "));
      ok("real run: a Node diagnostic report of the bridge (as --report-on-fatalerror writes) holds no key", rec.report.length > 1000 && !rec.report.includes(SECRET));
      ok("real run: the bridge is told the server's relay, and that the engine isn't here", rec.env.MTG_RELAY === `ws://127.0.0.1:${relayPort}` && rec.env.MTG_REMOTE_ENGINE === "1", `${rec.env.MTG_RELAY} ${rec.env.MTG_REMOTE_ENGINE}`);
      let mode = null;
      try { mode = fs.statSync(rec.env.MTG_KEY_FILE).mode & 0o777; } catch { /* none */ }
      ok("real run: the key file is readable by this account only (0600)", process.platform === "win32" ? mode !== null : mode === 0o600, mode === null ? "no file" : mode.toString(8));
    }
    if (process.platform !== "win32") ok("real run: server.json readable by others is made private (0600)", (fs.statSync(serverFile).mode & 0o777) === 0o600 && out.includes("made readable by you only"), (fs.statSync(serverFile).mode & 0o777).toString(8));
    ok("real run: the key isn't in the status page's JSON", !!status && !status.includes(SECRET));
    ok("real run: the key isn't in the companion's output", !out.includes(SECRET));
    ok("real run: the key isn't in the logs (companion.log, the bridge's log)", !readOr(path.join(home, "logs", "companion.log")).includes(SECRET) && !readOr(path.join(home, "tmp", "bridge-live.log")).includes(SECRET)
      && readOr(path.join(home, "logs", "companion.log")).length > 0);
    ok("real run: nothing was asked of the container engine", readOr(engineLog) === "", readOr(engineLog));
    p.kill("SIGKILL");
    const loop = Number(readOr(path.join(home, "tmp", "bridge-loop.pid")));
    if (loop > 0) { try { process.kill(loop, "SIGKILL"); } catch { /* gone */ } }

    // --stop: a server that's fine leaves the engine alone; one with a problem counts as no server (the engine here stops)
    const stop = () => new Promise((done) => {
      const q = spawn(process.execPath, [path.join(C, "companion.js"), ...common, "--stop", "--bridge-url", "http://127.0.0.1:9"], { env });
      let o = ""; q.stdout.on("data", (d) => { o += d; }); q.stderr.on("data", (d) => { o += d; });
      const t = setTimeout(() => q.kill("SIGKILL"), 60000);
      q.on("close", () => { clearTimeout(t); done(o); });
    });
    fs.writeFileSync(engineLog, "");
    let o = await stop();
    ok("--stop with a server: the engine there is left running, nothing stopped here", o.includes("its engine was left running") && readOr(engineLog) === "", `${o} | ${readOr(engineLog)}`);
    fs.writeFileSync(serverFile, "{ \"host\": \"ws://127.0.0.1\" }");
    o = await stop();
    ok("--stop with a server.json problem: the engine on this computer is stopped", o.includes("as without a server") && /^stop$/m.test(readOr(engineLog)), `${o} | ${readOr(engineLog)}`);
  } finally {
    for (const q of procs) { try { q.kill("SIGKILL"); } catch { /* gone */ } }
    await relay.close();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  }
}

(async () => {
  const bt = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-companion-bridge-"));
  try { await bridgeSide(bt); } finally { fs.rmSync(bt, { recursive: true, force: true }); }
  // ── the connection check, for real, against the fake relay
  let relay = await fakeRelay();
  let v = await check(settingFor(relay.port));
  ok("check: a server whose room is open is green and named", v.light === L.Light.Green && v.text.includes(`127.0.0.1:${relay.port}`) && v.text.includes(L.Room), v.text);
  ok("check: it logs in with server.json's key", relay.seen.some((m) => m.type === "Authenticate" && m.password === "server-key"), JSON.stringify(relay.seen));
  v = await check(settingFor(relay.port, { key: "wrong-key" }));
  ok("check: a wrong key is red and says to put the server's key in server.json", v.light === L.Light.Red && v.text.includes("refused the key") && v.text.includes("invalid key"), v.text);
  await relay.close();
  relay = await fakeRelay({ rooms: [] });
  v = await check(settingFor(relay.port));
  ok("check: a relay with no Forge room is red and says to start the room on the server", v.light === L.Light.Red && v.text.includes("isn't open"), v.text);
  await relay.close();
  relay = await fakeRelay({ rooms: [{ room_name: L.Room, status: "InGame" }] });
  v = await check(settingFor(relay.port));
  ok("check: a room busy with an earlier game is red", v.light === L.Light.Red && v.text.includes("busy"), v.text);
  await relay.close();
  relay = await fakeRelay({ silent: true });
  v = await check(settingFor(relay.port));
  ok("check: a server that never answers is red and says the firewall", v.light === L.Light.Red && v.text.includes("didn't answer") && v.text.includes("firewall"), v.text);
  await relay.close();
  const nobody = await freePort();
  const reachV = async (host, port) => L.decideServer(L.serverSetting(JSON.stringify({ host, port, key: "k" }), null, null), await probes.tcpReach(host, port, 1500), L.Game.none("no game"));
  v = await reachV("127.0.0.1", nobody);
  ok("check: nothing on the port is red: refused, the port named, Try again", v.light === L.Light.Red && v.text.includes("refused the connection") && v.text.includes(`port ${nobody}`) && v.fix === L.Fixes.Retry, v.text);
  v = await reachV("no-such-host.invalid", 9555);
  ok("check: a name that doesn't resolve is red and says to check the spelling", v.light === L.Light.Red && v.text.includes("isn't known") && v.text.includes("no-such-host.invalid"), v.text);
  const up = await probes.tcpReach("127.0.0.1", (relay = await fakeRelay()).port, 1500);
  ok("check: the TCP check passes on a listening server", up.kind === "ok", JSON.stringify(up));
  await relay.close();

  // ── the companion itself: server.json read, steps 1-3 as the server's (one observe pass, nothing started)
  relay = await fakeRelay();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-companion-server-"));
  try {
    for (const d of ["saves", "state", "logs", "bridge", "stack"]) fs.mkdirSync(path.join(home, d), { recursive: true });
    fs.writeFileSync(path.join(home, "version.json"), JSON.stringify({ built: "2026-11-16T00:00:00Z", release: "test" }));
    fs.writeFileSync(path.join(home, "bridge", "bridge.js"), "// (not run: --observe)\n");
    const run = async (serverJson, extra = []) => {
      if (serverJson === null) { try { fs.unlinkSync(path.join(home, "server.json")); } catch { /* none */ } }
      else fs.writeFileSync(path.join(home, "server.json"), serverJson);
      const dump = path.join(home, "dump.json");
      try { fs.unlinkSync(dump); } catch { /* none */ }
      const r = await new Promise((done) => {
        // on Windows the companion refuses to start (it is the Linux/macOS one), so the test runs it as on Linux there
        const asLinux = process.platform === "win32" ? ["--require", path.join(home, "as-linux.js")] : [];
        if (asLinux.length) fs.writeFileSync(path.join(home, "as-linux.js"), 'Object.defineProperty(process, "platform", { value: "linux" });\n');
        const p = spawn(process.execPath, [...asLinux, path.join(C, "companion.js"), "--home", home, "--observe", "--no-web", "--dump", dump, "--saves", path.join(home, "saves"),
          "--state", path.join(home, "state"), "--log", path.join(home, "logs", "companion.log"), "--bridge-url", "http://127.0.0.1:9", "--steps", "1,2,3", ...extra],
          { env: { ...process.env, MTG_CONTAINER_RUNTIME: "docker", MTG_SERVER_KEY: "" } });
        let stdout = "", stderr = "";
        p.stdout.on("data", (d) => { stdout += d; }); p.stderr.on("data", (d) => { stderr += d; });
        const t = setTimeout(() => p.kill("SIGKILL"), 60000);
        p.on("close", () => { clearTimeout(t); done({ stdout, stderr }); });
      });
      let text = "";
      try { text = fs.readFileSync(dump, "utf8"); } catch { /* no dump */ }
      return { out: `${r.stdout}${r.stderr}`, text };
    };
    let r = await run(JSON.stringify({ host: "127.0.0.1", port: relay.port, key: "server-key" }));
    ok("companion: says it uses the own server at start", r.out.includes(`Own server: the engine runs on 127.0.0.1:${relay.port}`), r.out.slice(0, 400));
    ok("companion: the engine light is the server's login, green", r.text.includes(`Your server (127.0.0.1:${relay.port}): room ${L.Room} is open`), r.text.slice(0, 600));
    ok("companion: steps 1-2 not needed with a server", /1 Container engine \[GREEN\] Not needed here: the engine runs on your server/.test(r.text) && /2 Engine images +\[GREEN\] Not needed here: the engine runs on your server/.test(r.text), r.text.slice(0, 600));
    ok("companion: the key is never in its output or its dump", !r.out.includes("server-key") && !r.text.includes("server-key"));
    const logText = (() => { try { return fs.readFileSync(path.join(home, "logs", "companion.log"), "utf8"); } catch { return ""; } })();
    ok("companion: the key is never in its log", !logText.includes("server-key"));
    r = await run(JSON.stringify({ host: "127.0.0.1", port: relay.port, key: "server-key" }), ["--server", `127.0.0.1:${nobody}`]);
    ok("companion: --server's port beats server.json's (and the check says nothing listens there)", r.text.includes(`127.0.0.1:${nobody}`) && r.text.includes("refused the connection"), r.text.slice(0, 600));
    r = await run(JSON.stringify({ host: "127.0.0.1", port: relay.port, key: "server-key" }), ["--server", "localhost"]);
    ok("companion: --server naming another host drops server.json's key (and says to set MTG_SERVER_KEY)", r.text.includes("isn't sent to another server") && r.text.includes("MTG_SERVER_KEY"), r.text.slice(0, 600));
    const before = relay.seen.length;
    r = await run(JSON.stringify({ host: "127.0.0.1", port: relay.port, key: "server-key" }), ["--server", `localhost:${relay.port}`]);
    ok("companion: no key for another host: no login is tried, so no key goes there", relay.seen.length === before && r.text.includes("no key"), `${relay.seen.length - before} messages; ${r.text.slice(0, 400)}`);
    r = await run("{ \"host\": \"ws://127.0.0.1\" }");
    ok("companion: a server.json problem is said at start and on the engine light", r.out.includes("Own server: server.json:") && r.text.includes("without ws://"), `${r.out.slice(0, 300)} ${r.text.slice(0, 300)}`);
    // the server's engine build against the table's (stack/deployed.json engineBuild): a warning, the start not stopped
    const built = await fakeRelay({ rooms: [{ room_name: L.Room, status: "Lobby", engine_build: "engine1120" }] });
    try {
      fs.writeFileSync(path.join(home, "stack", "deployed.json"), JSON.stringify({ bridge: "b", table: "t", engineBuild: "engine1121" }));
      r = await run(JSON.stringify({ host: "127.0.0.1", port: built.port, key: "server-key" }));
      ok("companion: a server on another engine build than the table's: amber, both named", /3 Engine stack +\[AMBER\] Your server runs engine engine1120, but this table was deployed with engine engine1121/.test(r.text), r.text.slice(0, 700));
      fs.writeFileSync(path.join(home, "stack", "deployed.json"), JSON.stringify({ bridge: "b", table: "t", engineBuild: "engine1120" }));
      r = await run(JSON.stringify({ host: "127.0.0.1", port: built.port, key: "server-key" }));
      ok("companion: the same engine build as the table's: green", r.text.includes(`Your server (127.0.0.1:${built.port}): room ${L.Room} is open`), r.text.slice(0, 700));
    } finally { await built.close(); fs.rmSync(path.join(home, "stack", "deployed.json"), { force: true }); }
    r = await run(null);
    ok("companion: no server.json: the engine light is this computer's again", !r.out.includes("Own server") && !r.text.includes("Your server"), r.out.slice(0, 300));
  } finally {
    await relay.close();
    fs.rmSync(home, { recursive: true, force: true });
  }

  await realRun();

  console.log(`${failed ? "FAIL" : "PASS"} test_companion_server: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_companion_server: ${e.stack}`); process.exit(1); });

// ── break-it: each case breaks the wiring in place, runs this test and requires the named check to fail ──
function breakit() {
  // [file (companion-node/, or a path from the repo root), what, find, replace, the check's name, "test" | "selftest", posix only]
  const ReadKey = "(() => { try { return fs.readFileSync(process.env.MTG_KEY_FILE, \"utf8\"); } catch { return \"\"; } })()";
  const Cases = [
    ["controller.js", "the login goes to another port than server.json's (never the live 9443: a break must not reach a real relay)",
      "await probes.relayLogin(own ? L.serverUrl(own) :", "await probes.relayLogin(own ? L.serverUrl({ ...own, port: own.port + 1 }) :", "companion: the engine light is the server's login, green"],
    ["controller.js", "the login uses this package's key, not the server's",
      "own ? own.key : this.relayKey", "this.relayKey", "companion: the engine light is the server's login, green"],
    ["controller.js", "steps 1-2 run the container engine even with a server",
      "case Step.Docker: ok = this.server ? this.serverNotNeeded(Step.Docker) : await this.doDocker(); break;", "case Step.Docker: ok = await this.doDocker(); break;", "own server: steps 1-2 not needed (green), nothing asked of the container engine", "selftest"],
    ["controller.js", "the bridge isn't told the server's relay and key file",
      "return { MTG_RELAY: L.serverUrl(s), MTG_REMOTE_ENGINE: \"1\", MTG_KEY_FILE: this.writeKeyFile(s.key) };", "return {};", "own server: the bridge gets the server's relay and a key file", "selftest"],
    ["controller.js", "the key goes into the bridge's environment beside its file",
      "MTG_KEY_FILE: this.writeKeyFile(s.key) };", "MTG_KEY_FILE: this.writeKeyFile(s.key), MTG_KEY: s.key };", "real run: the bridge's environment holds no key"],
    ["controller.js", "an MTG_KEY / MTG_SERVER_KEY set on this computer reaches the bridge with a server",
      "if (own) { delete env.MTG_KEY; delete env.MTG_SERVER_KEY; delete env.MANABREW_SERVER_KEY; }", "if (own) { /* kept */ }", "own server: the key is in none of the bridge's environment", "selftest"],
    ["controller.js", "the key file is left readable by others (umask)",
      "fs.chmodSync(tmp, 0o600); // (the mode above", "fs.chmodSync(tmp, 0o644); // (the mode above", "real run: the key file is readable by this account only (0600)", "test", true],
    ["controller.js", "the container engine is asked for the bridge's settings with a server",
      "const env = { ...process.env, ...(own ? {} : this.engine.bridgeEnv()) };", "const env = { ...process.env, ...this.engine.bridgeEnv() };", "own server: the container engine isn't asked for the bridge's settings", "selftest"],
    ["controller.js", "the key is written in companion.log",
      ", its key from server.json or MTG_SERVER_KEY` :", ", key ${this.server.server.key}` :", "real run: the key isn't in the logs"],
    ["controller.js", "Stop everything stops the container engine's containers with a server too",
      "if (!(this.server && this.server.ok)) {\n        const answers", "if (true) {\n        const answers", "own server: Stop everything stops the bridge only", "selftest"],
    ["controller.js", "Stop everything with a server.json problem leaves the engine here running",
      "if (!(this.server && this.server.ok)) {\n        const answers", "if (!this.server) {\n        const answers", "server.json with a problem: Stop everything stops the engine on this computer", "selftest"],
    ["controller.js", "Stop everything leaves the key file behind",
      "      await this.stopBridge();\n      this.removeKeyFile();", "      await this.stopBridge();", "own server: Stop everything removes the key file", "selftest"],
    ["controller.js", "the watcher asks the container engine with a server",
      "const f = this.server ? null : await this.engine.detect();", "const f = await this.engine.detect();", "own server: the watcher asks no container engine either", "selftest"],
    ["controller.js", "a bridge running for another engine is kept",
      "if (v.action === Actions.RestartBridge) {", "if (false) {", "own server: a bridge running for the engine here is stopped and started again", "selftest"],
    ["controller.js", "a bridge running for another engine is restarted during a game",
      "if (this.isLocked) { this.set(Step.Bridge, verdict(Light.Amber, `${v.text.replace(", "if (false) { this.set(Step.Bridge, verdict(Light.Amber, `${v.text.replace(", "own server: during a game that bridge is left alone", "selftest"],
    ["companion.js", "server.json is never read",
      "probes.exists(layout.serverFile) ? probes.readText(layout.serverFile) : null, opt(", "null, opt(", "companion: says it uses the own server at start"],
    ["companion.js", "--server is ignored",
      "probes.readText(layout.serverFile) : null, opt(\"server\"), process.env.MTG_SERVER_KEY)", "probes.readText(layout.serverFile) : null, null, process.env.MTG_SERVER_KEY)", "companion: --server's port beats server.json's"],
    ["companion.js", "a server.json problem isn't said at start",
      ": `Own server: ${server.problem}`);", ": \"\");", "companion: a server.json problem is said at start"],
    ["companion.js", "--stop with a server.json problem leaves the engine here running",
      "const remote = !!(server && server.ok);", "const remote = !!server;", "--stop with a server.json problem: the engine on this computer is stopped"],
    ["companion.js", "--stop stops the engine here even with a server",
      "const remote = !!(server && server.ok);", "const remote = false;", "--stop with a server: the engine there is left running"],
    ["companion.js", "the bridge loop asks the container engine with a server",
      "if (!process.env.MTG_CONTAINER_CLI && process.env.MTG_REMOTE_ENGINE !== \"1\")", "if (!process.env.MTG_CONTAINER_CLI)", "real run: nothing was asked of the container engine"],
    ["companion.js", "server.json readable by others is left so",
      "try { fs.chmodSync(layout.serverFile, 0o600);", "try { fs.chmodSync(layout.serverFile, 0o644);", "real run: server.json readable by others is made private", "test", true],
    ["bridge-loop.js", "the bridge loop puts the key in the bridge's environment",
      "env: { ...process.env, ...env }, stdio", `env: { ...process.env, ...env, MTG_KEY: ${ReadKey} }, stdio`, "real run: the bridge's environment holds no key"],
    ["bridge-loop.js", "the bridge loop puts the key on the bridge's command line",
      "`--report-directory=${reports}`, layout.bridgeJs]", `\`--report-directory=\${reports}\`, layout.bridgeJs, ${ReadKey}]`, "real run: the bridge's command line holds no key"],
    ["web.js", "the status page's JSON shows the key",
      "versions: { text: c.versionText,", "versions: { k: c.server && c.server.ok ? c.server.server.key : null, text: c.versionText,", "real run: the key isn't in the status page's JSON"],
    ["bridge/bridge.js", "the bridge ignores MTG_KEY_FILE",
      "const KEY = process.env.MTG_KEY_FILE && !process.argv.includes(\"--key\") ? keyFromFile(process.env.MTG_KEY_FILE) : arg(\"key\", \"tts-local\");", "const KEY = arg(\"key\", \"tts-local\");", "bridge: MTG_KEY_FILE's key is the one used"],
    ["bridge/bridge.js", "the bridge keeps MTG_KEY in its environment beside MTG_KEY_FILE",
      "if (process.env.MTG_KEY_FILE) delete process.env.MTG_KEY;", "", "bridge: with MTG_KEY_FILE, MTG_KEY is dropped"],
    ["bridge/bridge.js", "mtg reset restarts the local Forge room with a server",
      "  if (REMOTE_ENGINE) {\n    // (own server", "  if (false) {\n    // (own server", "bridge, own server: mtg reset restarts no container here"],
    ["companion-node/probes.js", "the room's engine build not read",
      "r.engineBuild = found && typeof found.engine_build === \"string\" && found.engine_build ? found.engine_build : null;", "r.engineBuild = null;", "companion: a server on another engine build than the table's: amber, both named"],
    ["companion-node/controller.js", "the table's engine build not passed to the light",
      "this.unstarted(Step.Stack, L.decideServer(this.server, login, this.game, L.str(this.deployed, \"engineBuild\")))", "this.unstarted(Step.Stack, L.decideServer(this.server, login, this.game))", "companion: a server on another engine build than the table's: amber, both named"],
    ["bridge/bridge.js", "mtg reset with a server doesn't say to restart the room on the host's server",
      "If a game is stuck there, restart the room on the host's server", "If a game is stuck there, restart the Forge room", "bridge, own server: mtg reset restarts no container here and says to restart the room on the server"],
    ["bridge/bridge.js", "with a server, Start after a cut-off game is left waiting",
      "    if (then) guarded(\"start (own server)\", then);\n", "", "bridge, own server: Start after a cut-off game"],
    ["bridge/bridge.js", "GET /versions doesn't say the bridge's relay",
      "relay: RELAY, remoteEngine: REMOTE_ENGINE }, null, 1));", "}, null, 1));", "bridge, own server: GET /versions says its relay"],
    ["bridge/bridge.js", "with a server, the bridge inspects the containers here",
      "if (REMOTE_ENGINE) return done({ bridge: BRIDGE_HASH, table: tableStamp, remote: true });", "", "bridge, own server: GET /versions says its relay and remoteEngine, and checks no container here"],
  ];
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  let missed = 0;
  const base = spawnSync(process.execPath, [__filename], { encoding: "utf8", timeout: 600000 });
  if (base.status !== 0) { console.log(`the test fails unbroken: fix that first\n${base.stdout}`); process.exit(1); }
  const st = spawnSync(process.execPath, [path.join(C, "companion.js"), "--selftest"], { encoding: "utf8", timeout: 600000 });
  if (st.status !== 0) { console.log(`the selftest fails unbroken: fix that first\n${st.stdout}`); process.exit(1); }
  let skipped = 0;
  for (const [file, what, find, repl, name, by = "test", posixOnly = false] of Cases) {
    if (posixOnly && process.platform === "win32") { skipped++; console.log(`SKIPPED ${what} (file modes: not on Windows)`); continue; }
    const f = file.includes("/") ? path.join(ROOT, file) : path.join(C, file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8");
    const at = src.indexOf(find);
    if (at < 0 || src.indexOf(find, at + 1) >= 0) { missed++; console.log(`NOT APPLIED ${what}: the text is ${at < 0 ? "missing" : "there twice"} in ${file}`); continue; }
    let r;
    try {
      fs.writeFileSync(f, src.slice(0, at) + repl + src.slice(at + find.length));
      r = spawnSync(process.execPath, by === "selftest" ? [path.join(C, "companion.js"), "--selftest"] : [__filename], { encoding: "utf8", timeout: 600000 });
    } finally {
      fs.writeFileSync(f, orig);
      if (sha(f) !== h) { console.log(`RESTORE FAILED: ${file}`); process.exit(100); }
    }
    const red = r.stdout.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith("FAIL test_companion_server"));
    const hit = red.some((l) => l.includes(name));
    if (!hit) missed++;
    console.log(`${hit ? "RED" : "MISSED"} ${what}  ->  ${hit ? `FAIL ${name} (${red.length} red)` : `"${name}" stayed green`}`);
  }
  console.log(`${Cases.length - skipped - missed} of ${Cases.length - skipped} breaks turned their check red${skipped ? ` (${skipped} skipped here)` : ""}; files restored by sha256`);
  process.exit(missed);
}
