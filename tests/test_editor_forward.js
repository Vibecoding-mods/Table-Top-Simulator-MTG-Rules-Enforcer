// Tests for bridge/editor-forward.js (SPEC.md §8, tmp/editor-forward/research.md): sharing TTS's editor port with the
// VSCode/Atom plugin. Headless: fake plugin and fake TTS sockets on random free ports; never 39998/39999, never the
// running bridge or TTS; the save backup runs on temp files only.
//   node tests/test_editor_forward.js
// (EDITOR_FORWARD_MODULE=<path> runs the same checks against another copy of the module: mutation testing)
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const MOD = process.env.EDITOR_FORWARD_MODULE ? path.resolve(process.env.EDITOR_FORWARD_MODULE) : "../bridge/editor-forward";
const { createEditorForwarder, makeSaveBackup, BRIDGE_EXEC_BASE, TABLE_CHECK_LUA } = require(MOD);

let failed = 0, passed = 0;
const ok = (name, cond, detail) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${detail !== undefined ? `\n    got ${JSON.stringify(detail).slice(0, 300)}` : ""}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await sleep(5); }
  return pred();
}
const RESERVED = new Set([39998, 39999]);
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => (RESERVED.has(p) ? freePort().then(resolve, reject) : resolve(p)));
    });
    s.on("error", reject);
  });
}
// a fake listener that reads one JSON per connection until the sender closes (TTS's framing)
function fakeListener(port, { stuck = false, host = "127.0.0.1" } = {}) {
  const got = [];
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    if (stuck) { sock.pause(); return; } // accepts, never reads, never closes
    const chunks = [];
    sock.on("data", (c) => chunks.push(c));
    sock.on("end", () => { got.push(Buffer.concat(chunks).toString("utf8")); sock.end(); });
    sock.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    got, json: () => got.map((t) => JSON.parse(t)),
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  })));
}
function sendTo(port, text, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.connect(port, host, () => s.end(text));
    s.on("close", resolve);
    s.on("error", () => resolve());
  });
}
const startF = (f) => new Promise((r) => f.start((e) => r(e)));
const closeF = (f) => new Promise((r) => f.close(() => r()));
const prints = (plugin) => plugin.json().filter((m) => m.messageID === 2).map((m) => m.message);

async function main() {
  const logs = [];
  const log = (s) => logs.push(s);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editor-forward-test-"));

  // ── off by default ──
  {
    const f = createEditorForwarder({ env: {}, log });
    ok("off: not enabled without a port", f.enabled === false);
    for (const id of [0, 1, 2, 3, 4, 5, 6, 7]) ok(`off: bridge handles messageID ${id}`, f.offer({ messageID: id, returnID: 1, customMessage: {} }, "{}") === true);
    ok("off: start opens nothing", (await startF(f)) === undefined && f.stats().queued === 0 && f.stats().forwarded === 0);
    await closeF(f);
    ok("off: port 0 is off", createEditorForwarder({ env: { MTG_EDITOR_FORWARD_PORT: "0" }, log }).enabled === false);
    ok("off: a non-number is off", createEditorForwarder({ env: { MTG_EDITOR_FORWARD_PORT: "nonsense" }, log }).enabled === false);
    const e = createEditorForwarder({ env: { MTG_EDITOR_FORWARD_PORT: "40123", MTG_EDITOR_COMMAND_PORT: "40124" }, log });
    ok("env: MTG_EDITOR_FORWARD_PORT turns it on", e.enabled === true && e.forwardPort === 40123 && e.commandPort === 40124);
  }
  // ── loop guard: a port that is the bridge's or TTS's own ──
  {
    ok("loop guard: forwarding to the bridge's own port stays off", createEditorForwarder({ env: {}, forwardPort: 39998, log }).enabled === false);
    ok("loop guard: forwarding to TTS's port stays off", createEditorForwarder({ env: {}, forwardPort: 39999, log }).enabled === false);
    const h = createEditorForwarder({ env: {}, forwardPort: 40111, commandPort: 39999, log });
    ok("loop guard: a command port on TTS's port is refused", h.enabled === true && h.commandPort === 0);
    ok("loop guard: command port equal to the forward port is refused", createEditorForwarder({ env: {}, forwardPort: 40111, commandPort: 40111, log }).commandPort === 0);
  }
  ok("the table check is tts-push-global.js's", TABLE_CHECK_LUA.includes('gm:find("^engine:")') && TABLE_CHECK_LUA.includes('gsub("\\n.*", "")') && TABLE_CHECK_LUA.includes("libcard"));

  // ── routing per messageID, TTS -> plugin ──
  {
    const pp = await freePort();
    const plugin = await fakeListener(pp);
    const f = createEditorForwarder({ env: {}, forwardPort: pp, log });
    const sent = [];
    const offer = (m) => { const t = JSON.stringify(m); sent.push(t); return f.offer(m, t); };
    ok("route 0 (object pushed): plugin only", offer({ messageID: 0, scriptStates: [{ guid: "abc" }] }) === false);
    ok("route 1 (game loaded): bridge too", offer({ messageID: 1, scriptStates: [] }) === true);
    ok("route 2 (print): bridge too", offer({ messageID: 2, message: "hello" }) === true);
    ok("route 3 (error): bridge too", offer({ messageID: 3, error: "boom", guid: "-1" }) === true);
    ok("route 4 with t (our table): bridge only", offer({ messageID: 4, customMessage: { t: "hello" } }) === true);
    ok("route 4 without t (the plugin's helper): plugin only", offer({ messageID: 4, customMessage: { type: "guids", content: "[]" } }) === false);
    ok("route 4 with a non-string t: plugin only", offer({ messageID: 4, customMessage: { t: 3 } }) === false);
    ok("route 5 in the bridge's range: bridge only", offer({ messageID: 5, returnID: BRIDGE_EXEC_BASE + 1, returnValue: 1 }) === true);
    ok("route 5 late answer in the bridge's range: bridge only", offer({ messageID: 5, returnID: BRIDGE_EXEC_BASE + 999, returnValue: 1 }) === true);
    ok("route 5 below the bridge's range: plugin only", offer({ messageID: 5, returnID: 7, returnValue: 2 }) === false);
    ok("route 5 with no returnID: plugin only", offer({ messageID: 5, returnValue: 3 }) === false);
    ok("route 6 (game saved): plugin only", offer({ messageID: 6, savePath: "x" }) === false);
    ok("route 7 (object created): plugin only", offer({ messageID: 7, guid: "def" }) === false);
    ok("route unknown ID: both", offer({ messageID: 99 }) === true);
    await until(() => plugin.got.length >= 11);
    await sleep(100);
    const ids = plugin.json().map((m) => `${m.messageID}${m.returnID != null ? `/${m.returnID}` : ""}`);
    ok("plugin gets 0,1,2,3,4,4,5/7,5,6,7,99 in order, not our table's 4 or the bridge's 5", JSON.stringify(ids) === JSON.stringify(["0", "1", "2", "3", "4", "4", "5/7", "5", "6", "7", "99"]), ids);
    ok("plugin gets the raw text unchanged", plugin.got[2] === sent[2], plugin.got[2]);
    ok("non-object messages: bridge handles, nothing thrown", f.offer(null) === true && f.offer("x") === true);
    const before = plugin.got.length;
    f.offer({ messageID: 2, message: "no text" });
    ok("offer without text serializes the message", await until(() => plugin.got.length > before) && JSON.parse(plugin.got[plugin.got.length - 1]).message === "no text");
    ok("stats count the forwards", f.stats().forwarded >= 11, f.stats());
    await closeF(f); await plugin.close();
  }

  // ── IPv6: the plugin listens on "localhost", which may be ::1 only ──
  {
    const pp = await freePort(), cp = await freePort(), tp = await freePort();
    const plugin = await fakeListener(pp, { host: "::1" }), tts = await fakeListener(tp);
    const f = createEditorForwarder({ env: {}, forwardPort: pp, commandPort: cp, ttsPort: tp, log });
    ok("ipv6: the command port opens", (await startF(f)) === undefined);
    f.offer({ messageID: 2, message: "v6" }, JSON.stringify({ messageID: 2, message: "v6" }));
    ok("ipv6: a plugin on ::1 only still gets messages", await until(() => prints(plugin).includes("v6")), plugin.got);
    f.offer({ messageID: 2, message: "v6b" }, JSON.stringify({ messageID: 2, message: "v6b" }));
    ok("ipv6: and keeps getting them", await until(() => prints(plugin).includes("v6b")));
    await sendTo(cp, JSON.stringify({ messageID: 0 }), "::1");
    ok("ipv6: commands sent to ::1 reach TTS", await until(() => tts.got.length === 1));
    await sendTo(cp, JSON.stringify({ messageID: 0 }), "127.0.0.1");
    ok("ipv4: commands sent to 127.0.0.1 reach TTS", await until(() => tts.got.length === 2));
    await closeF(f); await plugin.close(); await tts.close();
  }

  // ── plugin commands -> TTS: exec, Get Scripts, custom, junk ──
  {
    const pp = await freePort(), cp = await freePort(), tp = await freePort();
    const plugin = await fakeListener(pp), tts = await fakeListener(tp);
    const f = createEditorForwarder({ env: {}, forwardPort: pp, commandPort: cp, ttsPort: tp, gameRunning: () => true, log });
    await startF(f);
    const exec = JSON.stringify({ messageID: 3, returnID: 5, guid: "-1", script: "return 1+1" });
    await sendTo(cp, exec);
    ok("exec: relayed to TTS unchanged", await until(() => tts.got.length === 1) && tts.got[0] === exec, tts.got);
    ok("exec: its answer goes to the plugin only", f.offer({ messageID: 5, returnID: 5, returnValue: 2 }, "") === false);
    ok("exec: the plugin gets it", await until(() => plugin.json().some((m) => m.messageID === 5 && m.returnID === 5 && m.returnValue === 2)), plugin.got);
    await sendTo(cp, JSON.stringify({ messageID: 3, returnID: BRIDGE_EXEC_BASE + 5, script: "" }));
    ok("exec in the bridge's range: still relayed, and logged", await until(() => tts.got.length === 2) && logs.some((s) => /in the bridge's range/.test(s)));
    await sendTo(cp, JSON.stringify({ messageID: 0 }));
    ok("get scripts during a game: relayed", await until(() => tts.got.length === 3) && tts.json()[2].messageID === 0);
    ok("get scripts: its answer (ID 1) goes to the plugin only (no table redraw)", f.offer({ messageID: 1, scriptStates: [] }, JSON.stringify({ messageID: 1, scriptStates: [] })) === false);
    ok("get scripts: the next ID 1 is a real load again", f.offer({ messageID: 1, scriptStates: [] }, "{}") === true);
    await sendTo(cp, "this is not json");
    await sendTo(cp, "");
    await sleep(100);
    ok("unreadable or empty commands: dropped and logged, nothing relayed", tts.got.length === 3 && logs.some((s) => /unreadable command/.test(s)));
    const custom = JSON.stringify({ messageID: 2, customMessage: { command: "x" } });
    await sendTo(cp, custom);
    ok("custom message from the plugin: relayed as sent", await until(() => tts.got.length === 4) && tts.got[3] === custom);
    await closeF(f);
    const refused = await new Promise((r) => { const s = net.connect(cp, "127.0.0.1"); s.on("connect", () => { s.destroy(); r(false); }); s.on("error", () => r(true)); });
    ok("close: the command port is released", refused);
    await plugin.close(); await tts.close();
  }

  // ── Save & Play: only when it can't wipe the table ──
  {
    const pp = await freePort(), tp = await freePort();
    const plugin = await fakeListener(pp), tts = await fakeListener(tp);
    const events = [];
    let running = false, table = { value: "" }, checks = 0, backupFails = false;
    const mk = (extra) => freePort().then(async (cp) => {
      const f = createEditorForwarder({
        env: {}, forwardPort: pp, commandPort: cp, ttsPort: tp, log, checkTimeoutMs: 1000,
        gameRunning: () => running,
        checkTable: async () => { checks++; events.push("check"); return typeof table === "function" ? table() : table; },
        backupSave: async () => { if (backupFails) throw new Error("disk full"); events.push("backup"); return "C:/fake/backup.json"; },
        ...extra,
      });
      await startF(f);
      return { f, cp };
    });
    const save = JSON.stringify({ messageID: 1, scriptStates: [{ guid: "-1", script: "x" }] });
    const blockedWith = async (re, n0) => until(() => prints(plugin).slice(n0).some((m) => /Save & Play blocked/.test(m) && re.test(m)), 4000);

    const { f, cp } = await mk();
    let n0 = prints(plugin).length;
    running = true;
    await sendTo(cp, save);
    ok("save & play during a game: the plugin is told why", await blockedWith(/a game is running/, n0), prints(plugin));
    ok("save & play during a game: the table isn't even checked", checks === 0);
    running = false;
    table = { value: "Deck 'Sideboard' (100 cards)" };
    n0 = prints(plugin).length;
    await sendTo(cp, save);
    ok("save & play with the player's deck out: blocked, naming it", await blockedWith(/player's own cards or decks.*Sideboard/, n0), prints(plugin));
    for (const [what, t] of [["timed out", { timeout: true }], ["errored", { error: "TTS not reachable" }], ["no answer", null]]) {
      table = t; n0 = prints(plugin).length;
      await sendTo(cp, save);
      ok(`save & play when the check ${what}: blocked`, await blockedWith(/couldn't check the table/, n0), prints(plugin).slice(n0));
    }
    table = () => { throw new Error("boom"); }; n0 = prints(plugin).length;
    await sendTo(cp, save);
    ok("save & play when the check throws: blocked", await blockedWith(/couldn't check the table first \(boom\)/, n0), prints(plugin).slice(n0));
    table = () => new Promise(() => {}); n0 = prints(plugin).length;
    await sendTo(cp, save);
    ok("save & play when the check never answers: blocked after the timeout", await blockedWith(/couldn't check the table/, n0), prints(plugin).slice(n0));
    table = () => { running = true; return { value: "" }; }; n0 = prints(plugin).length;
    await sendTo(cp, save);
    ok("save & play when a game starts during the check: blocked", await blockedWith(/game started/, n0), prints(plugin).slice(n0));
    running = false;
    table = { value: "" }; backupFails = true; n0 = prints(plugin).length;
    await sendTo(cp, save);
    ok("save & play when the backup fails: blocked", await blockedWith(/couldn't back up the save first \(disk full\)/, n0), prints(plugin).slice(n0));
    await sleep(50);
    ok("no blocked Save & Play reached TTS", tts.got.length === 0, tts.got.length);
    ok("each block is logged and counted", f.stats().blocked === 9 && logs.filter((s) => /Save & Play blocked/.test(s)).length >= 9, f.stats());

    backupFails = false; events.length = 0;
    await sendTo(cp, JSON.stringify({ messageID: 0 })); // a Get Scripts pending...
    await until(() => tts.got.length === 1);
    await sendTo(cp, save);
    ok("save & play on a clear table: relayed intact", await until(() => tts.got.length === 2) && tts.got[1] === save, tts.got.length);
    ok("save & play: checked, then backed up, before relaying", JSON.stringify(events) === JSON.stringify(["check", "backup"]), events);
    ok("save & play clears a pending Get Scripts: its reload reaches the bridge", f.offer({ messageID: 1 }, "{}") === true);

    table = () => new Promise((r) => setTimeout(() => r({ value: "" }), 150)); n0 = prints(plugin).length;
    const both = Promise.all([sendTo(cp, save), sleep(20).then(() => sendTo(cp, save))]);
    await both;
    ok("two Save & Plays at once: the second is refused", await blockedWith(/still being checked/, n0), prints(plugin).slice(n0));
    ok("two Save & Plays at once: the first goes through", await until(() => tts.got.length === 3, 5000), tts.got.length);
    await closeF(f);

    const g = await mk({ checkTable: undefined });
    n0 = prints(plugin).length;
    await sendTo(g.cp, save);
    ok("save & play with no table check given: blocked", await blockedWith(/can't check the table/, n0), prints(plugin).slice(n0));
    await closeF(g.f);
    const h = await mk({ gameRunning: () => { throw new Error("no"); } });
    n0 = prints(plugin).length;
    await sendTo(h.cp, save);
    ok("save & play when gameRunning throws: blocked", await blockedWith(/a game is running/, n0), prints(plugin).slice(n0));
    await closeF(h.f);
    const k = await mk({ gameRunning: undefined });
    n0 = prints(plugin).length;
    await sendTo(k.cp, save);
    ok("save & play with no gameRunning given: blocked", await blockedWith(/a game is running/, n0), prints(plugin).slice(n0));
    await closeF(k.f);
    await sleep(50);
    ok("still only the one good Save & Play reached TTS", tts.got.length === 3, tts.got.length);
    await plugin.close(); await tts.close();
  }

  // ── the save backup (temp files only) ──
  {
    const src = path.join(tmp, "TS_Save_1.json");
    fs.writeFileSync(src, '{"SaveName":"Mock"}');
    const dir = path.join(tmp, "backup");
    const backup = makeSaveBackup(src, dir);
    const a = await backup(), b = await backup();
    ok("backup: copies the save, named after it", path.basename(a).startsWith("TS_Save_1-") && fs.readFileSync(a, "utf8") === '{"SaveName":"Mock"}', a);
    ok("backup: never overwrites an earlier copy", a !== b && fs.existsSync(a) && fs.existsSync(b), [a, b]);
    let err = null;
    try { await makeSaveBackup(path.join(tmp, "missing.json"), dir)(); } catch (e) { err = e; }
    ok("backup: a missing save rejects (so Save & Play is blocked)", err && err.code === "ENOENT", err && err.code);
  }

  // ── Get Scripts answer window expires ──
  {
    let clock = 1000000;
    const pp = await freePort(), cp = await freePort(), tp = await freePort();
    const plugin = await fakeListener(pp), tts = await fakeListener(tp);
    const f = createEditorForwarder({ env: {}, forwardPort: pp, commandPort: cp, ttsPort: tp, now: () => clock, log });
    await startF(f);
    await sendTo(cp, JSON.stringify({ messageID: 0 }));
    await until(() => tts.got.length === 1);
    clock += 5001;
    ok("get scripts: an ID 1 after 5 s is a real load", f.offer({ messageID: 1 }, "{}") === true);
    await sendTo(cp, JSON.stringify({ messageID: 0 }));
    await until(() => tts.got.length === 2);
    clock += 4999;
    ok("get scripts: an ID 1 within 5 s is its answer", f.offer({ messageID: 1 }, "{}") === false);
    await closeF(f); await plugin.close(); await tts.close();
  }

  // ── a plugin that isn't listening: no crash, no delay ──
  {
    const pp = await freePort(); // nothing listens here, on either address
    const f = createEditorForwarder({ env: {}, forwardPort: pp, downMs: 300, timeoutMs: 300, log });
    // (limits are loose on purpose: other work shares this PC; a blocking send would cost seconds, not milliseconds)
    const msgs = Array.from({ length: 1000 }, (_, i) => { const m = { messageID: 2, message: `p${i}` }; return [m, JSON.stringify(m)]; });
    const t0 = performance.now();
    for (const [m, t] of msgs) f.offer(m, t);
    const took = performance.now() - t0;
    let maxLag = 0, last = performance.now();
    const ticker = setInterval(() => { const t = performance.now(); maxLag = Math.max(maxLag, t - last - 5); last = t; }, 5);
    ok("plugin down: 1000 offers take under 500 ms", took < 500, took);
    ok("plugin down: the queue is capped", f.stats().queued <= 200, f.stats());
    ok("plugin down: noticed and logged once", await until(() => f.stats().pluginUp === false, 4000) && logs.filter((s) => s.includes(`not listening on ${pp}`)).length === 1, f.stats());
    await sleep(100);
    clearInterval(ticker);
    ok("plugin down: the event loop never stalls over 500 ms afterwards", maxLag < 500, maxLag);
    ok("plugin down: messages are dropped, not kept", f.stats().queued === 0 && f.stats().dropped >= 999, f.stats());
    const g = createEditorForwarder({ env: {}, forwardPort: pp, downMs: 60000, timeoutMs: 300, log: () => {} });
    g.offer({ messageID: 2 }, "{}");
    await until(() => g.stats().pluginUp === false);
    const d0 = g.stats().dropped;
    g.offer({ messageID: 2 }, "{}");
    ok("plugin down: within the back-off a message is dropped at once, with no new connection", g.stats().dropped === d0 + 1 && g.stats().queued === 0, g.stats());
    await closeF(g);
    const plugin = await fakeListener(pp);
    await sleep(350);
    f.offer({ messageID: 2, message: "back" }, JSON.stringify({ messageID: 2, message: "back" }));
    ok("plugin up again: messages reach it", await until(() => prints(plugin).includes("back"), 3000), plugin.got);
    ok("plugin up again: logged", await until(() => f.stats().pluginUp === true));
    await closeF(f); await plugin.close();
  }

  // ── a plugin that accepts but never reads: the timeout moves on ──
  {
    const pp = await freePort();
    const stuck = await fakeListener(pp, { stuck: true });
    const f = createEditorForwarder({ env: {}, forwardPort: pp, timeoutMs: 150, maxQueue: 50, log });
    for (let i = 0; i < 3; i++) f.offer({ messageID: 2 }, JSON.stringify({ messageID: 2, i }));
    ok("stuck plugin: each send gives up and the queue drains", await until(() => f.stats().queued === 0 && !f.stats().forwarded && f.stats().dropped >= 3, 3000), f.stats());
    for (let i = 0; i < 500; i++) f.offer({ messageID: 2 }, "{}");
    ok("stuck plugin: the queue never passes maxQueue", f.stats().queued <= 50, f.stats());
    await closeF(f); await stuck.close();
  }

  // ── large messages ──
  {
    const pp = await freePort(), cp = await freePort(), tp = await freePort();
    const plugin = await fakeListener(pp), tts = await fakeListener(tp);
    const f = createEditorForwarder({ env: {}, forwardPort: pp, commandPort: cp, ttsPort: tp, timeoutMs: 2000, gameRunning: () => false, checkTable: async () => ({ value: "" }), backupSave: async () => "x", log });
    await startF(f);
    const big = JSON.stringify({ messageID: 1, scriptStates: [{ guid: "-1", script: "-- é\n" + "x".repeat(8 * 1024 * 1024) }] });
    ok("large: an 8 MB game-loaded copy is still the bridge's", f.offer(JSON.parse(big), big) === true);
    ok("large: the plugin gets all 8 MB intact", await until(() => plugin.got.length === 1, 5000) && plugin.got[0] === big, plugin.got.map((g) => g.length));
    const save = JSON.stringify({ messageID: 1, scriptStates: [{ guid: "-1", script: "y".repeat(20 * 1024 * 1024) }] });
    await sendTo(cp, save);
    ok("large: a 20 MB Save & Play reaches TTS intact", await until(() => tts.got.length === 1, 8000) && tts.got[0] === save, tts.got.map((g) => g.length));
    await closeF(f);
    const g = createEditorForwarder({ env: {}, forwardPort: pp, commandPort: cp, ttsPort: tp, maxCommandBytes: 1024 * 1024, log });
    await startF(g);
    await sendTo(cp, JSON.stringify({ messageID: 2, customMessage: { x: "z".repeat(2 * 1024 * 1024) } }));
    await sleep(200);
    ok("large: a command over maxCommandBytes is dropped and logged", tts.got.length === 1 && logs.some((s) => /bytes dropped/.test(s)));
    await closeF(g); await plugin.close(); await tts.close();
  }

  // ── a command port already in use: reported, no crash ──
  {
    const cp = await freePort();
    const holder = await fakeListener(cp);
    const f = createEditorForwarder({ env: {}, forwardPort: await freePort(), commandPort: cp, listenHosts: ["127.0.0.1"], log });
    const err = await startF(f);
    ok("busy command port: start reports it, nothing thrown", err && err.code === "EADDRINUSE" && logs.some((s) => s.includes(`command port ${cp} unavailable`)), err && err.code);
    await closeF(f); await holder.close();
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} editor-forward checks failed (${passed} passed)` : `all ${passed} editor-forward checks pass`);
  process.exit(failed ? 1 : 0);
}
const guard = setTimeout(() => { console.log(`FAIL the test run hung (${passed} passed, ${failed} failed so far)`); process.exit(1); }, 90000);
guard.unref();
main().catch((e) => { console.log(`FAIL threw: ${e.stack}`); process.exit(1); });
