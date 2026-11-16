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

(async () => {
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
  const reachV = async (host, port) => L.decideServer(L.serverSetting(JSON.stringify({ host, port }), null, null), await probes.tcpReach(host, port, 1500), L.Game.none("no game"));
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
    r = await run("{ \"host\": \"ws://127.0.0.1\" }");
    ok("companion: a server.json problem is said at start and on the engine light", r.out.includes("Own server: server.json:") && r.text.includes("without ws://"), `${r.out.slice(0, 300)} ${r.text.slice(0, 300)}`);
    r = await run(null);
    ok("companion: no server.json: the engine light is this computer's again", !r.out.includes("Own server") && !r.text.includes("Your server"), r.out.slice(0, 300));
  } finally {
    await relay.close();
    fs.rmSync(home, { recursive: true, force: true });
  }

  console.log(`${failed ? "FAIL" : "PASS"} test_companion_server: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_companion_server: ${e.stack}`); process.exit(1); });

// ── break-it: each case breaks the wiring in place, runs this test and requires the named check to fail ──
function breakit() {
  const Cases = [
    ["controller.js", "the login goes to another port than server.json's (never the live 9443: a break must not reach a real relay)",
      "await probes.relayLogin(own ? L.serverUrl(own) :", "await probes.relayLogin(own ? L.serverUrl({ ...own, port: own.port + 1 }) :", "companion: the engine light is the server's login, green"],
    ["controller.js", "the login uses this package's key, not the server's",
      "own && own.key ? own.key : this.relayKey", "this.relayKey", "companion: the engine light is the server's login, green"],
    ["controller.js", "steps 1-2 run the container engine even with a server",
      "case Step.Docker: ok = this.server ? this.serverNotNeeded(Step.Docker) : await this.doDocker(); break;", "case Step.Docker: ok = await this.doDocker(); break;", "own server: steps 1-2 not needed (green), nothing asked of the container engine", "selftest"],
    ["controller.js", "the bridge isn't told the server's relay and key",
      "return { MTG_RELAY: L.serverUrl(s), ...(s.key ? { MTG_KEY: s.key } : {}) };", "return {};", "own server: the bridge gets the server's relay and key", "selftest"],
    ["controller.js", "Stop everything stops the container engine's containers with a server too",
      "if (!this.server && this.engine.cli && this.rows[Step.Docker].v.light === Light.Green) await", "if (this.engine.cli && this.rows[Step.Docker].v.light === Light.Green) await", "own server: Stop everything stops the bridge only", "selftest"],
    ["controller.js", "the watcher asks the container engine with a server",
      "const f = this.server ? null : await this.engine.detect();", "const f = await this.engine.detect();", "own server: the watcher asks no container engine either", "selftest"],
    ["companion.js", "server.json is never read",
      "probes.exists(layout.serverFile) ? probes.readText(layout.serverFile) : null", "null", "companion: says it uses the own server at start"],
    ["companion.js", "--server is ignored",
      "probes.readText(layout.serverFile) : null, opt(\"server\"), process.env.MTG_SERVER_KEY)", "probes.readText(layout.serverFile) : null, null, process.env.MTG_SERVER_KEY)", "companion: --server's port beats server.json's"],
    ["companion.js", "a server.json problem isn't said at start",
      ": `Own server: ${server.problem}`);", ": \"\");", "companion: a server.json problem is said at start"],
  ];
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  let missed = 0;
  const base = spawnSync(process.execPath, [__filename], { encoding: "utf8", timeout: 600000 });
  if (base.status !== 0) { console.log(`the test fails unbroken: fix that first\n${base.stdout}`); process.exit(1); }
  const st = spawnSync(process.execPath, [path.join(C, "companion.js"), "--selftest"], { encoding: "utf8", timeout: 600000 });
  if (st.status !== 0) { console.log(`the selftest fails unbroken: fix that first\n${st.stdout}`); process.exit(1); }
  for (const [file, what, find, repl, name, by = "test"] of Cases) {
    const f = path.join(C, file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8");
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
  console.log(`${Cases.length - missed} of ${Cases.length} breaks turned their check red; files restored by sha256`);
  process.exit(missed);
}
