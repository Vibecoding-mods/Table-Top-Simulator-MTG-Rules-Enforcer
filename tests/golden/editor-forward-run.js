// Golden-master runner for bridge/editor-forward.js. The module is loaded with a fake `net` and a fake `fs` (only for
// its own require calls), so every connection it opens, every byte it sends, every server it listens with, every
// backup copy it makes and every log line is recorded, on a frozen clock and a frozen Date. Covers offer()'s routing
// table (every messageID, both sides of BRIDGE_EXEC_BASE and of getScriptsMs), the plugin-down drop, the queue cap,
// the port clash checks, the command listener (each command, garbage, too big) and every reason Save & Play is
// refused, plus makeSaveBackup's names. No default path (the player's Documents folder, the repo's tmp/) is ever
// called or recorded: the repo is public. Shared by tools/capture_editor_forward_golden.js and
// tests/test_editor_forward_golden.js.
const path = require("path");
const Module = require("module");
const realFs = require("fs");
const { enc } = require("./teams-run");

const MOD = path.join(__dirname, "..", "..", "bridge", "editor-forward.js");
const T0 = 1792500000000;
const tick = () => new Promise((r) => setImmediate(r));
async function flush(n = 30) { for (let i = 0; i < n; i++) await tick(); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the fakes: net and fs, recording into rec ──
function fakeNet(rec, plan) {
  const { EventEmitter } = require("events");
  const servers = [];
  return {
    servers,
    connect(port, host, onConnect) {
      const sock = new EventEmitter();
      let timeoutFn = null;
      const mode = plan.connect(port, host);
      rec.push({ connect: `${host}:${port}`, mode });
      sock.setTimeout = (ms, fn) => { timeoutFn = fn; rec.push({ setTimeout: ms }); };
      sock.end = (text) => { rec.push({ sent: `${host}:${port}`, text: String(text) }); setImmediate(() => sock.emit("close", false)); };
      sock.destroy = () => { rec.push({ destroy: `${host}:${port}` }); setImmediate(() => sock.emit("close", true)); };
      setImmediate(() => {
        if (mode === "ok") onConnect && onConnect();
        else if (mode === "timeout") timeoutFn && timeoutFn();
        else { const e = new Error(`connect ${mode} ${host}:${port}`); e.code = mode; sock.emit("error", e); sock.emit("close", true); }
      });
      return sock;
    },
    createServer(handler) {
      const { EventEmitter } = require("events");
      const s = new EventEmitter();
      s.handler = handler;
      s.listen = (port, host, cb) => {
        const why = plan.listen(port, host);
        rec.push({ listen: `${host}:${port}`, ok: !why });
        setImmediate(() => { if (why) { const e = new Error(`listen ${why} ${host}:${port}`); e.code = why; s.emit("error", e); } else { s.port = port; s.host = host; servers.push(s); cb && cb(); } });
      };
      s.close = (cb) => { rec.push({ serverClose: `${s.host}:${s.port}` }); setImmediate(() => cb && cb()); };
      return s;
    },
  };
}
// a plugin connection to the command listener: chunks then end (or nothing more after a destroy)
function pluginSends(server, chunks, rec) {
  const { EventEmitter } = require("events");
  const sock = new EventEmitter();
  sock.setTimeout = (ms) => rec.push({ commandSocketTimeout: ms });
  sock.destroy = () => { rec.push({ commandSocketDestroyed: 1 }); sock.dead = true; };
  server.handler(sock);
  for (const c of chunks) { if (sock.dead) break; sock.emit("data", Buffer.from(c)); }
  if (!sock.dead) sock.emit("end");
}
function fakeFs(rec, files) {
  return {
    constants: realFs.constants,
    promises: {
      async mkdir(d, o) { rec.push({ mkdir: d, recursive: !!o?.recursive }); if (files.mkdirFails) { const e = new Error("EACCES mkdir"); e.code = "EACCES"; throw e; } },
      async copyFile(from, to, flag) {
        rec.push({ copyFile: [from, to], excl: flag === realFs.constants.COPYFILE_EXCL });
        if (!files.has(from)) { const e = new Error(`ENOENT: no such file '${from}'`); e.code = "ENOENT"; throw e; }
        if (files.has(to)) { const e = new Error("EEXIST"); e.code = "EEXIST"; throw e; }
        files.add(to);
      },
    },
  };
}

// load editor-forward.js with these fakes for its own `net` and `fs`
function load(net, fs) {
  const orig = Module._load;
  Module._load = function (req, parent, ...rest) {
    if (parent && parent.filename === MOD) { if (req === "net") return net; if (req === "fs") return fs; }
    return orig.call(this, req, parent, ...rest);
  };
  try { delete require.cache[MOD]; return require(MOD); } finally { Module._load = orig; delete require.cache[MOD]; }
}

// a frozen Date for makeSaveBackup's stamp (local fields, so the time zone does not matter)
function withDate(fields, fn) {
  const Real = Date;
  class Fixed extends Real { constructor(...a) { if (a.length) super(...a); else super(...fields); } static now() { return new Real(...fields).getTime(); } }
  global.Date = Fixed;
  return Promise.resolve().then(fn).finally(() => { global.Date = Real; });
}

const SAVE = path.join("SAVEDIR", "TS_Save_1.json"), BACKUPS = path.join("BACKUPDIR", "backup");

async function scenario(name, o, steps) {
  const rec = [];
  const plan = { connect: o.connect || (() => "ok"), listen: o.listen || (() => null) };
  const net = fakeNet(rec, plan);
  const files = new Set(o.files || [SAVE]);
  if (o.mkdirFails) files.mkdirFails = true;
  const F = load(net, fakeFs(rec, files));
  const c = { t: T0, rec, net, F, files };
  const opts = { env: o.env || {}, log: (l) => rec.push({ log: l }), now: () => c.t, gameRunning: o.gameRunning, checkTable: o.checkTable, ...o.opts };
  if (!("backupSave" in (o.opts || {}))) opts.backupSave = F.makeSaveBackup(SAVE, BACKUPS);
  let ef;
  try { ef = F.createEditorForwarder(opts); } catch (e) { return { name, threw: { type: e?.constructor?.name, message: e?.message }, effects: rec }; }
  c.ef = ef;
  rec.push({ created: { enabled: ef.enabled, forwardPort: ef.forwardPort, commandPort: ef.commandPort } });
  for (const [label, fn] of steps) {
    let r;
    try { r = { result: enc(await fn(c)) }; } catch (e) { r = { threw: { type: e?.constructor?.name, message: String(e?.message) } }; }
    await flush();
    rec.push({ step: label, ...r, stats: ef.stats() });
  }
  return { name, effects: rec };
}

const offer = (msg, text) => (c) => c.ef.offer(msg, text);
const cmd = (obj, i = 0) => (c) => { const s = c.net.servers[i]; if (!s) return "no server"; pluginSends(s, [typeof obj === "string" ? obj : JSON.stringify(obj)], c.rec); return "sent"; };
const at = (ms) => (c) => { c.t = T0 + ms; return ms; };

async function runAll() {
  const out = [];
  const B = 1000000000;
  // ── the module's surface and constants (TABLE_CHECK_LUA's text pinned: it decides what Save & Play may wipe)
  {
    const F = load(fakeNet([], { connect: () => "ok", listen: () => null }), fakeFs([], new Set()));
    out.push({ name: "surface", result: enc(Object.keys(F).sort().map((k) => [k, typeof F[k], typeof F[k] === "function" ? F[k].length : F[k]])) });
  }
  const S = [];
  const sc = (...a) => S.push(a);

  // ── off, and the ports ──
  sc("off: no forward port", {}, [["offer print", offer({ messageID: 2, message: "hi" })], ["offer custom", offer({ messageID: 4, customMessage: { x: 1 } })], ["start", (c) => new Promise((r) => c.ef.start(r)).then(() => "started")]]);
  for (const [k, env, opts] of [["env forward port", { MTG_EDITOR_FORWARD_PORT: "40001" }, {}], ["env both", { MTG_EDITOR_FORWARD_PORT: "40001", MTG_EDITOR_COMMAND_PORT: "40002" }, {}],
    ["option wins over env", { MTG_EDITOR_FORWARD_PORT: "40001" }, { forwardPort: 40005 }], ["option 0 wins over env (??)", { MTG_EDITOR_FORWARD_PORT: "40001" }, { forwardPort: 0 }],
    ["port 65535", {}, { forwardPort: 65535 }], ["port 65536", {}, { forwardPort: 65536 }], ["port 1", {}, { forwardPort: 1 }], ["port -1", {}, { forwardPort: -1 }], ["port float", {}, { forwardPort: 40001.5 }],
    ["port string", {}, { forwardPort: "40001" }], ["port junk", {}, { forwardPort: "x" }], ["forward = bridge's", {}, { forwardPort: 39998 }], ["forward = TTS's", {}, { forwardPort: 39999 }],
    ["forward = custom tts in port", {}, { forwardPort: 41000, ttsInPort: 41000 }], ["command = forward", {}, { forwardPort: 40001, commandPort: 40001 }], ["command = TTS", {}, { forwardPort: 40001, commandPort: 39999 }],
    ["command = bridge", {}, { forwardPort: 40001, commandPort: 39998 }], ["command without forward", {}, { commandPort: 40002 }], ["bad tts ports fall back", {}, { forwardPort: 40001, ttsPort: "x", ttsInPort: 0 }]]) {
    sc(`ports: ${k}`, { env, opts }, [["start", (c) => new Promise((r) => c.ef.start((e) => r(e ? e.code : "ok")))]]);
  }

  // ── offer's routing table ──
  const route = [
    ["0 object pushed", { messageID: 0, scriptStates: [] }], ["1 game loaded (no Get Scripts)", { messageID: 1, scriptStates: [] }], ["2 print", { messageID: 2, message: "hi" }], ["3 error", { messageID: 3, error: "x" }],
    ["4 our table's", { messageID: 4, customMessage: { t: "hello" } }], ["4 t not a string", { messageID: 4, customMessage: { t: 5 } }], ["4 no customMessage", { messageID: 4 }], ["4 customMessage null", { messageID: 4, customMessage: null }],
    ["5 bridge's returnID", { messageID: 5, returnID: B, returnValue: 1 }], ["5 bridge's returnID as string", { messageID: 5, returnID: String(B + 3) }], ["5 just below", { messageID: 5, returnID: B - 1 }],
    ["5 plugin's", { messageID: 5, returnID: 1 }], ["5 no returnID", { messageID: 5 }], ["6 game saved", { messageID: 6 }], ["7 object created", { messageID: 7, guid: "abc" }], ["8 unknown", { messageID: 8 }],
    ["string id", { messageID: "2" }], ["no id", { x: 1 }], ["null", null], ["string", "text"], ["array", [1, 2]],
  ];
  sc("routing: every messageID", { opts: { forwardPort: 40001 } }, route.map(([k, m]) => [k, offer(m)]));
  sc("routing: the text as received is sent, else JSON", { opts: { forwardPort: 40001 } }, [["text given", offer({ messageID: 2, message: "a" }, "{\"messageID\":2,\"message\":\"a\"}  ")], ["empty text", offer({ messageID: 2, message: "b" }, "")], ["text not a string", offer({ messageID: 2, message: "c" }, 5)]]);
  sc("routing: a throwing message is the bridge's", { opts: { forwardPort: 40001 } }, [["getter throws", offer(Object.defineProperty({}, "messageID", { get() { throw new Error("bad getter"); } }))]]);

  // ── Get Scripts: the next game loaded within getScriptsMs is the plugin's alone ──
  sc("get scripts window", { opts: { forwardPort: 40001, commandPort: 40002, getScriptsMs: 5000 } }, [["start", (c) => new Promise((r) => c.ef.start(r)).then(() => c.net.servers.length)],
    ["plugin asks Get Scripts", cmd({ messageID: 0 })], ["+5000", at(5000)], ["game loaded at the edge: plugin only", offer({ messageID: 1 })], ["next game loaded: both", offer({ messageID: 1 })],
    ["asks again", cmd({ messageID: 0 })], ["+5001 after", at(10001)], ["game loaded too late: both", offer({ messageID: 1 })]]);

  // ── the plugin down: every host refused, drops for downMs ──
  sc("plugin down then up", { connect: (p, h) => (globalThis.__up ? "ok" : "ECONNREFUSED"), opts: { forwardPort: 40001, downMs: 5000 } },
    [["print 1", offer({ messageID: 2, message: "1" })], ["print 2 while down", offer({ messageID: 2, message: "2" })], ["+4999", at(4999)], ["print 3 still dropped", offer({ messageID: 2, message: "3" })],
      ["+5000 and up", (c) => { globalThis.__up = true; return at(5000)(c); }], ["print 4 goes", offer({ messageID: 2, message: "4" })], ["print 5 to the host that worked", offer({ messageID: 2, message: "5" })], ["reset", () => { delete globalThis.__up; }]]);
  sc("IPv6 only: the second host, then sticky", { connect: (p, h) => (h === "::1" ? "ok" : "ECONNREFUSED"), opts: { forwardPort: 40001 } }, [["a", offer({ messageID: 2, message: "a" })], ["b", offer({ messageID: 2, message: "b" })]]);
  sc("EADDRNOTAVAIL counts as refused", { connect: (p, h) => (h === "::1" ? "ok" : "EADDRNOTAVAIL"), opts: { forwardPort: 40001 } }, [["a", offer({ messageID: 2, message: "a" })]]);
  sc("another error is not refused (no host change, nothing forwarded)", { connect: () => "ECONNRESET", opts: { forwardPort: 40001 } }, [["a", offer({ messageID: 2, message: "a" })], ["b", offer({ messageID: 2, message: "b" })]]);
  sc("timeout drops the message", { connect: () => "timeout", opts: { forwardPort: 40001, timeoutMs: 1234 } }, [["a", offer({ messageID: 2, message: "a" })]]);
  sc("plugin down with messages queued: the queue is dropped too", { connect: () => "ECONNREFUSED", opts: { forwardPort: 40001 } },
    [["three at once", (c) => { for (let i = 0; i < 3; i++) c.ef.offer({ messageID: 2, message: `d${i}` }); return c.ef.stats(); }]]);
  sc("close with messages queued", { opts: { forwardPort: 40001 } },
    [["three then close", (c) => { for (let i = 0; i < 3; i++) c.ef.offer({ messageID: 2, message: `c${i}` }); c.ef.close(); return c.ef.stats(); }]]);
  sc("queue cap drops the oldest", { opts: { forwardPort: 40001, maxQueue: 3 } }, [["six at once", (c) => { for (let i = 0; i < 6; i++) c.ef.offer({ messageID: 2, message: `q${i}` }); return c.ef.stats(); }]]);
  sc("custom hosts", { opts: { forwardPort: 40001, hosts: ["10.0.0.9"] }, connect: () => "ECONNREFUSED" }, [["a", offer({ messageID: 2, message: "a" })]]);

  // ── the command listener ──
  sc("commands relayed as sent", { opts: { forwardPort: 40001, commandPort: 40002 } }, [["start", (c) => new Promise((r) => c.ef.start(r)).then(() => c.net.servers.map((s) => `${s.host}:${s.port}`))],
    ["0 get scripts", cmd({ messageID: 0 })], ["2 custom", cmd({ messageID: 2, customMessage: { a: 1 } })], ["3 exec", cmd({ messageID: 3, returnID: 7, script: "return 1" })],
    ["3 exec in the bridge's range", cmd({ messageID: 3, returnID: B, script: "x" })], ["9 unknown", cmd({ messageID: 9 })], ["padded", cmd("   {\"messageID\":2}  \n")], ["blank", cmd("   ")],
    ["garbage", cmd("{not json")], ["json null", cmd("null")], ["json number", cmd("5")], ["second listener too", cmd({ messageID: 2 }, 1)], ["start again does nothing", (c) => new Promise((r) => c.ef.start(r)).then(() => c.net.servers.length)]]);
  sc("command in two chunks and too big", { opts: { forwardPort: 40001, commandPort: 40002, maxCommandBytes: 20 } }, [["start", (c) => new Promise((r) => c.ef.start(r))],
    ["chunks", (c) => { pluginSends(c.net.servers[0], ["{\"messageID\"", ":2}"], c.rec); }], ["exactly 20 bytes", (c) => { pluginSends(c.net.servers[0], ["{\"messageID\":2,\"a\":1}".slice(0, 20)], c.rec); }],
    ["21 bytes dropped", (c) => { pluginSends(c.net.servers[0], ["{\"messageID\":2,\"ab\":1}"], c.rec); }]]);
  sc("listen fails on IPv6 only", { listen: (p, h) => (h === "::1" ? "EAFNOSUPPORT" : null), opts: { forwardPort: 40001, commandPort: 40002 } }, [["start", (c) => new Promise((r) => c.ef.start((e) => r(e ? e.code : "ok"))).then((x) => [x, c.net.servers.length])]]);
  sc("listen fails on the first host", { listen: (p, h) => (h === "127.0.0.1" ? "EADDRINUSE" : null), opts: { forwardPort: 40001, commandPort: 40002 } }, [["start", (c) => new Promise((r) => c.ef.start((e) => r(e ? e.code : "ok"))).then((x) => [x, c.net.servers.length])]]);
  sc("listen fails everywhere", { listen: () => "EADDRINUSE", opts: { forwardPort: 40001, commandPort: 40002 } }, [["start", (c) => new Promise((r) => c.ef.start((e) => r(e ? e.code : "ok"))).then((x) => [x, c.net.servers.length])]]);
  sc("close stops everything", { opts: { forwardPort: 40001, commandPort: 40002 } }, [["start", (c) => new Promise((r) => c.ef.start(r))], ["close", (c) => new Promise((r) => c.ef.close(() => r("closed")))],
    ["offer after close", offer({ messageID: 2, message: "late" })], ["close again", (c) => new Promise((r) => c.ef.close(() => r("closed again")))]]);
  sc("close before start", { opts: { forwardPort: 40001 } }, [["close", (c) => new Promise((r) => c.ef.close(() => r("closed")))]]);

  // ── Save & Play: every reason it is refused, and the one way it goes ──
  const sp = (label) => [label, cmd({ messageID: 1, scriptStates: [] })];
  const started = ["start", (c) => new Promise((r) => c.ef.start(r))];
  const P = { forwardPort: 40001, commandPort: 40002, checkTimeoutMs: 30 };
  sc("save&play: no gameRunning given (unknown = running)", { opts: P }, [started, sp("save & play")]);
  sc("save&play: game running", { opts: P, gameRunning: () => true }, [started, sp("save & play")]);
  sc("save&play: gameRunning throws (= running)", { opts: P, gameRunning: () => { throw new Error("x"); } }, [started, sp("save & play")]);
  sc("save&play: no table check", { opts: P, gameRunning: () => false }, [started, sp("save & play")]);
  sc("save&play: check rejects", { opts: P, gameRunning: () => false, checkTable: () => Promise.reject(new Error("exec down")) }, [started, sp("save & play")]);
  sc("save&play: check throws", { opts: P, gameRunning: () => false, checkTable: () => { throw new Error("sync throw"); } }, [started, sp("save & play")]);
  sc("save&play: check answers an error", { opts: P, gameRunning: () => false, checkTable: async () => ({ error: "TTS busy" }) }, [started, sp("save & play")]);
  sc("save&play: check answers nothing", { opts: P, gameRunning: () => false, checkTable: async () => null }, [started, sp("save & play")]);
  sc("save&play: check times out", { opts: { ...P, checkTimeoutMs: 5 }, gameRunning: () => false, checkTable: () => new Promise(() => {}) }, [started, ["save & play", async (c) => { cmd({ messageID: 1 })(c); await wait(40); }]]);
  sc("save&play: the player's cards on the table", { opts: P, gameRunning: () => false, checkTable: async () => ({ value: "Deck 'Atraxa' (100 cards); " + "x".repeat(400) }) }, [started, sp("save & play")]);
  sc("save&play: a game starts during the check", { opts: P, gameRunning: (() => { let n = 0; return () => n++ > 0; })(), checkTable: async () => ({ value: "" }) }, [started, sp("save & play")]);
  sc("save&play: the save is missing", { opts: P, files: [], gameRunning: () => false, checkTable: async () => ({ value: "" }) }, [started, sp("save & play")]);
  sc("save&play: backup folder can't be made", { opts: P, mkdirFails: true, gameRunning: () => false, checkTable: async () => ({ value: "" }) }, [started, sp("save & play")]);
  sc("save&play: safe, backed up, relayed; its game loaded goes to both", { opts: P, gameRunning: () => false, checkTable: async () => ({ value: "" }) }, [started, ["get scripts first", cmd({ messageID: 0 })], sp("save & play"),
    ["the reload's game loaded", offer({ messageID: 1 })], sp("again: a second backup name")]);
  sc("save&play: two at once", { opts: P, gameRunning: () => false, checkTable: () => new Promise((r) => setTimeout(() => r({ value: "" }), 10)) }, [started, ["both", async (c) => { cmd({ messageID: 1 })(c); cmd({ messageID: 1, n: 2 })(c); await wait(30); }]]);
  sc("save&play: value 0 / false counts as none", { opts: P, gameRunning: () => false, checkTable: async () => ({ value: 0 }) }, [started, sp("save & play")]);
  sc("save&play: backupSave throws", { opts: { ...P, backupSave: async () => { throw new Error("disk full"); } }, gameRunning: () => false, checkTable: async () => ({ value: "" }) }, [started, sp("save & play")]);
  sc("relay to TTS times out / errors (logged)", { connect: (p) => (p === 39999 ? "timeout" : "ok"), opts: { forwardPort: 40001, commandPort: 40002, ttsTimeoutMs: 77 } }, [started, ["custom", cmd({ messageID: 2 })]]);
  sc("relay to TTS refused (logged)", { connect: (p) => (p === 39999 ? "ECONNREFUSED" : "ok"), opts: { forwardPort: 40001, commandPort: 40002, ttsHost: "127.0.0.2" } }, [started, ["custom", cmd({ messageID: 2 })]]);

  // (a Save & Play's backup is named by the clock: frozen for every scenario)
  for (const a of S) out.push(await withDate([2026, 10, 24, 9, 5, 7], () => scenario(...a)));

  // ── makeSaveBackup: names, never overwriting, the 100 limit ──
  const backups = [
    ["first name", [SAVE], 0], ["taken: -1", [SAVE, path.join(BACKUPS, "TS_Save_1-2026-11-24-09-05-07.json")], 0],
    ["taken: 0..2", [SAVE, ...[0, 1, 2].map((i) => path.join(BACKUPS, `TS_Save_1-2026-11-24-09-05-07${i ? `-${i}` : ""}.json`))], 0],
    ["all 100 taken", [SAVE, ...Array.from({ length: 100 }, (_, i) => path.join(BACKUPS, `TS_Save_1-2026-11-24-09-05-07${i ? `-${i}` : ""}.json`))], 0],
    ["save missing", [], 0], ["other name, not .json", [path.join("SAVEDIR", "My Table.sav")], 1],
  ];
  for (const [k, files, which] of backups) {
    const rec = [];
    const fsx = new Set(files);
    const F = load(fakeNet(rec, { connect: () => "ok", listen: () => null }), fakeFs(rec, fsx));
    const from = which ? path.join("SAVEDIR", "My Table.sav") : SAVE;
    let r;
    try { r = { result: await withDate([2026, 10, 24, 9, 5, 7], () => F.makeSaveBackup(from, BACKUPS)()) }; } catch (e) { r = { threw: { type: e?.constructor?.name, message: e?.message } }; }
    // (the 100-name run's copy attempts are many: their count, then the last)
    const copies = rec.filter((x) => x.copyFile);
    out.push({ name: `makeSaveBackup: ${k}`, ...r, mkdir: rec.filter((x) => x.mkdir), copies: copies.length, lastCopy: copies[copies.length - 1] || null });
  }
  {
    const rec = [];
    const F = load(fakeNet(rec, { connect: () => "ok", listen: () => null }), fakeFs(rec, new Set([SAVE])));
    let r;
    try { r = { result: await withDate([2026, 0, 2, 3, 4, 5], () => F.makeSaveBackup(SAVE, BACKUPS)()) }; } catch (e) { r = { threw: { type: e?.constructor?.name, message: e?.message } }; }
    out.push({ name: "makeSaveBackup: single digits padded", ...r });
  }
  const seen = new Map();
  for (const r of out) { const n = (seen.get(r.name) || 0) + 1; seen.set(r.name, n); if (n > 1) r.name += ` #${n}`; }
  return out;
}

module.exports = { runAll };
