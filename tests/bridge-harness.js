// Loads bridge/bridge.js with the outside world replaced, for the golden-master capture and test.
// Recorded instead of done: messages to TTS, to the relay, Scryfall requests, disk writes, docker calls, log lines.
// Frozen: the clock, randomness and timers (timers run in virtual-time order by flush()).
// Each load() is a fresh copy of the bridge module, so scenarios don't share state.
const fs = require("fs");
const path = require("path");
const net = require("net");
const cp = require("child_process");

// BRIDGE_PATH: load another copy (the mutation pass edits a copy, never the live bridge)
// resolved, so the key matches require.cache (a path given with / slashes would never be reloaded fresh)
const BRIDGE = require.resolve(path.resolve(process.env.BRIDGE_PATH || path.join(__dirname, "..", "bridge", "bridge.js")));
const real = {
  readFileSync: fs.readFileSync, writeFile: fs.writeFile, appendFile: fs.appendFile, writeFileSync: fs.writeFileSync, mkdir: fs.mkdir, rename: fs.rename, unlink: fs.unlink,
  connect: net.connect, execFile: cp.execFile, log: console.log, setTimeout, setImmediate, setInterval, clearTimeout, clearInterval,
  dateNow: Date.now, perfNow: performance.now.bind(performance), random: Math.random, WebSocket: global.WebSocket, fetch: global.fetch,
};

// scryfall: "up" (answers everything), "down" (no network: every request rejects), "busy" (HTTP 503)
function load({ imageCache = {}, scryfall = "up" } = {}) {
  const effects = [];
  const timers = [];
  let clock = 0, seq = 0;
  const queue = (fn, ms, kind) => { timers.push({ fn, at: clock + (Number(ms) || 0), n: seq++, kind }); return seq; };
  global.setTimeout = (fn, ms) => queue(fn, ms, "timeout");
  global.setImmediate = (fn) => queue(fn, 0, "immediate");
  global.setInterval = (fn, ms) => { effects.push({ interval: Number(ms) }); return 0; };
  global.clearTimeout = global.clearInterval = () => {};
  Date.now = () => 1792500000000 + clock;
  performance.now = () => 1000 + clock;
  let seed = 7;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sockets = [];
  global.WebSocket = class {
    constructor(url) { this.url = url; this.readyState = 1; this.listeners = {}; sockets.push(this); effects.push({ wsOpen: url }); }
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
    // a scenario delivers a relay frame (or an event) to the bridge
    emit(ev, data) { for (const fn of this.listeners[ev] || []) fn({ data }); }
    send(d) { effects.push({ relay: JSON.parse(d) }); }
    close() { effects.push({ wsClose: true }); }
  };
  // Scryfall answers deterministically: every name is found, with an id made from the name ("Ghost" is not found,
  // so the not-found path is exercised too); token searches find nothing.
  const fakeId = (name) => {
    const h = require("crypto").createHash("md5").update(String(name)).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  };
  const okJson = (data) => ({ ok: true, status: 200, json: async () => data, arrayBuffer: async () => new ArrayBuffer(0) });
  global.fetch = async (url, o = {}) => {
    const u = String(url);
    const body = o.body ? JSON.parse(o.body) : undefined;
    effects.push({ fetch: u, method: o.method || "GET", body });
    if (scryfall === "down") throw new TypeError("fetch failed");
    if (scryfall === "busy") return { ok: false, status: 503, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    if (u.includes("/cards/collection")) {
      const ids = body?.identifiers || [];
      return okJson({ data: ids.filter((i) => i.name !== "Ghost").map((i) => ({ id: fakeId(i.name), name: i.name })),
        not_found: ids.filter((i) => i.name === "Ghost") });
    }
    if (u.includes("/cards/named")) return okJson({ id: fakeId(decodeURIComponent(u.split("exact=")[1] || "")), name: "named" });
    if (u.includes("/cards/search")) return okJson({ data: [] });
    // the image host: a link with "dead" in it is gone (404), any other is there (deck picture check, 2026-10-26)
    if (u.includes("img.klrmngr.com")) return { ok: !u.includes("dead"), status: u.includes("dead") ? 404 : 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  net.connect = (port, host, cb) => {
    const sock = {
      handlers: {},
      on(ev, fn) { this.handlers[ev] = fn; return this; },
      setTimeout() { return this; },
      destroy() {},
      end(data) {
        const m = JSON.parse(data).customMessage;
        effects.push({ tts: JSON.parse(m.json) });
        queue(() => this.handlers.close && this.handlers.close(), 0, "close");
      },
    };
    queue(cb, 0, "connect");
    return sock;
  };
  fs.readFileSync = (p, ...a) => (String(p).endsWith("image-cache-klrmngr.json") ? JSON.stringify(imageCache) : real.readFileSync(p, ...a));
  const cbOf = (args) => args.find((f) => typeof f === "function");
  fs.writeFile = (p, d, ...rest) => { effects.push({ writeFile: path.basename(String(p)), bytes: String(d).length }); const cb = cbOf(rest); if (cb) cb(null); };
  fs.writeFileSync = (p, d) => { effects.push({ writeFileSync: path.basename(String(p)), bytes: String(d).length }); };
  fs.appendFile = (p, d, ...rest) => { effects.push({ appendFile: path.basename(String(p)), text: String(d).replace(/^\[\d\d:\d\d:\d\d\]/, "[time]") }); const cb = cbOf(rest); if (cb) cb(null); };
  fs.rename = (a, b, cb) => { effects.push({ rename: [path.basename(String(a)), path.basename(String(b))] }); if (cb) cb(null); };
  fs.unlink = (p, cb) => { effects.push({ unlink: path.basename(String(p)) }); if (cb) cb(null); };
  fs.mkdir = (p, o, cb) => { if (typeof o === "function") o(null); else if (cb) cb(null); };
  cp.execFile = (f, args, cb) => { effects.push({ execFile: [f, ...args.map((a) => (path.isAbsolute(a) ? path.basename(a) : a))] }); if (cb) cb(null); };
  // (stack traces lose their file paths and line numbers, which differ between copies and edits of the file)
  console.log = (...a) => effects.push({ log: a.map(String).join(" ").replace(/^\[\s*[\d.]+s\]\s*/, "")
    .replace(/\(?(?:[A-Za-z]:)?[\\/][^\s()]*?\.js:\d+:\d+\)?/g, "<file>").replace(/node:internal[^\s)]*/g, "<node>") });
  delete process.env.MTG_RECORD;
  // (the saved game for crash recovery: never the live bridge's file)
  process.env.MTG_RESUME_FILE = path.join(require("os").tmpdir(), "mtg-bridge-game-test.json");
  process.env.MTG_TRACE = "1";
  delete require.cache[BRIDGE];
  const B = require(BRIDGE);

  async function flush(limit = 400) {
    for (let k = 0; k < limit; k++) {
      await new Promise((r) => real.setImmediate(r)); // let awaited fetches settle
      if (!timers.length) { await new Promise((r) => real.setImmediate(r)); if (!timers.length) return; }
      timers.sort((a, b) => a.at - b.at || a.n - b.n);
      const t = timers.shift();
      clock = Math.max(clock, t.at);
      t.fn();
    }
    effects.push({ flushLimit: limit });
  }
  return { B, effects, flush, sockets };
}

function restore() {
  Object.assign(fs, { readFileSync: real.readFileSync, writeFile: real.writeFile, appendFile: real.appendFile, writeFileSync: real.writeFileSync, mkdir: real.mkdir, rename: real.rename, unlink: real.unlink });
  net.connect = real.connect;
  cp.execFile = real.execFile;
  console.log = real.log;
  Object.assign(global, { setTimeout: real.setTimeout, setImmediate: real.setImmediate, setInterval: real.setInterval, clearTimeout: real.clearTimeout, clearInterval: real.clearInterval, WebSocket: real.WebSocket, fetch: real.fetch });
  Date.now = real.dateNow;
  performance.now = real.perfNow;
  Math.random = real.random;
}

module.exports = { load, restore };
