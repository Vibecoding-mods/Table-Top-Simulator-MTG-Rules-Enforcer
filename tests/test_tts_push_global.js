// tools/tts-push-global.js, the push that can wipe the live table (2026-10-18), against a fake bridge (/exec) and a fake
// TTS editor port, both on spare ports of 127.0.0.1. The live ports (39999, 48787) are refused by tests/no-live-ports.js
// for the whole run, so nothing here can reach a real game. Covers the refusal guard: the player's own cards stop it,
// a check that can't run stops it, --force skips the check; then what is sent: Global, --patched, --objects.
//   node tests/test_tts_push_global.js
require("./no-live-ports");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const http = require("http");
const push = require("../tools/tts-push-global");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${typeof why === "string" ? why : JSON.stringify(why)}` : ""}\n`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tts-push-"));
const save = {
  LuaScript: "function onLoad() end -- global", XmlUI: "<Panel/>",
  ObjectStates: [
    { GUID: "aaa111", Nickname: "Life counter", LuaScript: "-- [engine copy]\nfunction engineLifeChange() end" },
    { GUID: "bbb222", Name: "Bag", LuaScript: "-- plain", ContainedObjects: [{ GUID: "ccc333", Name: "Card", LuaScript: "-- inside" }] },
  ],
};
const file = path.join(tmp, "table.json");
fs.writeFileSync(file, JSON.stringify(save));

// the fake bridge: POST /exec answers what `answer` says; `seen` keeps the Lua it was sent
function fakeBridge() {
  const b = { answer: { value: "" }, seen: [] };
  b.server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => { b.seen.push({ path: req.url, method: req.method, body }); res.end(typeof b.answer === "string" ? b.answer : JSON.stringify(b.answer)); });
  });
  return new Promise((done) => b.server.listen(0, "127.0.0.1", () => { b.port = b.server.address().port; done(b); }));
}
// the fake TTS editor port: each connection's bytes, as one message
function fakeTts() {
  const t = { got: [] };
  t.server = net.createServer((s) => { let data = ""; s.on("data", (d) => (data += d)); s.on("end", () => { t.got.push(data); s.end(); }); });
  return new Promise((done) => t.server.listen(0, "127.0.0.1", () => { t.port = t.server.address().port; done(t); }));
}
const spare = () => new Promise((done) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => done(p)); }); });
const settle = () => new Promise((r) => setTimeout(r, 50));

(async () => {
  ok("setup: the tool's ports are the live ones, which this run refuses", push.BRIDGE_PORT === 48787 && push.TTS_PORT === 39999 && require("./no-live-ports").LIVE_PORTS.includes(39999) && require("./no-live-ports").LIVE_PORTS.includes(48787));
  const bridge = await fakeBridge(), tts = await fakeTts();
  const go = async (args, answer) => {
    if (answer !== undefined) bridge.answer = answer;
    const out = [], err = [];
    const code = await push.main(args, { bridgePort: bridge.port, ttsPort: tts.port, log: (s) => out.push(s), error: (s) => err.push(s) });
    await settle();
    return { code, out: out.join("\n"), err: err.join("\n") };
  };

  // ── the guard
  {
    const before = tts.got.length;
    const r = await go([file], { value: "Deck 'My commander deck' (100 cards)" });
    ok("guard: the player's own cards on the table stop it (exit 3), naming them", r.code === 3 && /My commander deck/.test(r.err) && /--force/.test(r.err), r);
    ok("guard: ... and nothing reaches TTS", tts.got.length === before, tts.got.length);
    ok("guard: the check sent is the tool's own Lua, to /exec", bridge.seen.at(-1).path === "/exec" && bridge.seen.at(-1).method === "POST" && bridge.seen.at(-1).body === push.CHECK);
  }
  {
    const before = tts.got.length;
    const r = await go([file], { error: "no table connected" });
    ok("guard: a check that answers an error stops it (exit 2)", r.code === 2 && /couldn't check the table/.test(r.err), r);
    const r2 = await go([file], { timeout: true });
    ok("guard: a check that timed out stops it (exit 2)", r2.code === 2 && /timeout/.test(r2.err), r2);
    const r3 = await go([file], "not json");
    ok("guard: a reply that isn't JSON stops it (exit 2)", r3.code === 2 && /bad reply/.test(r3.err), r3);
    const port = await spare();
    const err = [];
    const code = await push.main([file], { bridgePort: port, ttsPort: tts.port, log: () => {}, error: (s) => err.push(s) });
    ok("guard: no bridge at all stops it (exit 2)", code === 2 && /couldn't check the table/.test(err.join("\n")), [code, err]);
    await settle();
    ok("guard: none of those reached TTS", tts.got.length === before, tts.got.length);
  }
  {
    const seen = bridge.seen.length;
    const r = await go([file, "--force"], { value: "Deck 'x'" });
    ok("--force: skips the check (no /exec) and pushes", r.code === 0 && bridge.seen.length === seen && tts.got.length > 0, r);
  }

  // ── what is sent
  {
    const r = await go([file], { value: "" });
    const msg = JSON.parse(tts.got.at(-1));
    ok("push: an empty table pushes (exit 0) and says so", r.code === 0 && /pushed Global \(\d+ chars\)/.test(r.out), r);
    ok("push: Global only by default, with its UI", msg.messageID === 1 && msg.scriptStates.length === 1 && msg.scriptStates[0].guid === "-1" && msg.scriptStates[0].script === save.LuaScript && msg.scriptStates[0].ui === "<Panel/>", msg);
  }
  {
    await go([file, "--patched"], { value: "" });
    const msg = JSON.parse(tts.got.at(-1));
    ok("--patched: Global and every object script make-engine-copy patched, nothing else", JSON.stringify(msg.scriptStates.map((x) => x.guid)) === JSON.stringify(["-1", "aaa111"]), msg.scriptStates.map((x) => x.guid));
  }
  {
    await go([file, "--patched", "--objects=ccc333,aaa111"], { value: "" });
    const msg = JSON.parse(tts.got.at(-1));
    ok("--objects: a contained object's script too, each guid once", JSON.stringify(msg.scriptStates.map((x) => x.guid)) === JSON.stringify(["-1", "aaa111", "ccc333"]), msg.scriptStates.map((x) => x.guid));
  }
  {
    const before = tts.got.length;
    const r = await go([file, "--objects=zzz999"], { value: "" });
    ok("--objects: a guid not in the file stops it (exit 4), nothing sent", r.code === 4 && /zzz999/.test(r.err) && tts.got.length === before, r);
  }
  {
    const port = await spare();
    const err = [];
    const code = await push.main([file, "--force"], { bridgePort: bridge.port, ttsPort: port, log: () => {}, error: (s) => err.push(s) });
    ok("TTS not listening: exit 1, said, and not called pushed", code === 1 && /TTS not reachable/.test(err.join("\n")), [code, err]);
  }

  ok("live ports: never tried", require("./no-live-ports").attempts().length === 0, require("./no-live-ports").attempts());
  bridge.server.close();
  tts.server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
