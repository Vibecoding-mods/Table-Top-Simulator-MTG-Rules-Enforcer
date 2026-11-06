// A headless Tabletop Simulator for full engine games: the table's Global script runs on fengari with the fake TTS
// (tts-sim.lua) behind the same External Editor API the bridge talks to. A second bridge pointed at it plays real
// Forge games with no TTS window (and without touching the real table):
//   node tests/lua/headless-tts.js [--save file] [--in 39989] [--bridge-in 39988] [--bridge-http 48788] [--seated Blue]
//   node bridge/bridge.js --tts-in 39988 --tts-out 39989 --debug-port 48788
// It listens for the bridge's messages (customMessage → onExternalMessage, Lua exec → return value), runs frames at
// ~60 per second, sends the table's web requests to the bridge's /msg, and forwards prints and errors.
// Not modelled: physics, other objects' scripts, rendering (see tts-sim.lua). Lua 5.3, not MoonSharp.
const fs = require("fs");
const net = require("net");
const http = require("http");
const path = require("path");
require("./moonsharp-patterns"); // (fails on the patterns TTS fails on)
const { lua, lauxlib, lualib, to_luastring } = require("fengari");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const SAVE = arg("save", path.join(process.env.USERPROFILE || "", "Documents", "My Games", "Tabletop Simulator", "Saves", "MTG 4 player table - ENGINE MODE + your decks.json"));
const LISTEN = Number(arg("in", 39989));          // the bridge's --tts-out
const BRIDGE_IN = Number(arg("bridge-in", 39988)); // the bridge's --tts-in (prints, errors, exec results)
const BRIDGE_HTTP = Number(arg("bridge-http", 48788));
const SEATED = String(arg("seated", "Blue")).split(",");
const log = (...a) => console.log(`[headless ${new Date().toISOString().slice(11, 19)}]`, ...a);

const save = JSON.parse(fs.readFileSync(SAVE, "utf8"));
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
function run(code, name) {
  if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name || "=headless")) !== lua.LUA_OK) {
    const e = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return { error: `does not compile: ${e}` };
  }
  if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) { const e = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return { error: e }; }
  const v = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : null;
  lua.lua_pop(L, 1);
  return { value: v };
}
const setString = (name, s) => { lua.lua_pushstring(L, to_luastring(s)); lua.lua_setglobal(L, to_luastring(name)); };

// to the bridge: { messageID: 2 print | 3 error | 5 exec result }
function toBridge(msg) {
  const sock = net.connect(BRIDGE_IN, "127.0.0.1", () => sock.end(JSON.stringify(msg)));
  sock.on("error", () => {});
}
const printErr = (where, e) => { log(`${where}: ${e}`); toBridge({ messageID: 3, guid: "-1", error: String(e), message: where }); };

// load: the fake TTS, the save's objects, the table's Global script, onLoad
const r0 = run(fs.readFileSync(path.join(__dirname, "tts-sim.lua"), "utf8"), "=tts-sim");
if (r0.error) throw new Error(`tts-sim: ${r0.error}`);
setString("__saveJson", JSON.stringify({ ObjectStates: save.ObjectStates.map(({ LuaScript, LuaScriptState, XmlUI, ...o }) => o), XmlUI: save.XmlUI || "" }));
setString("__script", save.LuaScript);
run(`__sim.load(JSON.decode(__saveJson)) __saveJson = nil __sim.script = __script __sim.liveWeb = true __sim.host = ${JSON.stringify(SEATED[0])}
  ${SEATED.map((c) => `__sim.seated[${JSON.stringify(c)}] = true`).join(" ")}`, "=setup");
const g = run(save.LuaScript, "=Global");
if (g.error) printErr("Global script", g.error);
run(`ENGINE_BRIDGE_URL = "http://127.0.0.1:${BRIDGE_HTTP}/msg"`, "=url");
const ld = run(`local st = ${JSON.stringify(save.LuaScriptState || "")} if onLoad then onLoad(st) end if onload then onload(st) end`, "=onLoad");
if (ld.error) printErr("onLoad", ld.error);

// what the script did: prints and broadcasts go to the bridge's console; errors as errors
function drainFx() {
  const r = run("local out = __fx __fx = {} return JSON.encode(out)", "=fx");
  // (a bad string in one frame's output is logged, not fatal: it took the whole headless table down, 2026-10-22)
  let lines = [];
  try { lines = JSON.parse(r.value || "[]"); } catch (e) { log(`unreadable frame output: ${e.message}`); }
  for (const line of lines) {
    if (/^f\d+ "(print|broadcastToAll|broadcastToColor|printToAll|Player\.broadcast)"/.test(line)) toBridge({ messageID: 2, message: line.replace(/^f\d+ /, "") });
    else if (/^f\d+ "ERROR/.test(line)) printErr("script", line);
  }
}
// the table's web requests (its messages to the bridge): sent for real, answered back into the script
function drainWeb() {
  const r = run("return __sim.takeWeb()", "=web");
  for (const w of JSON.parse(r.value || "[]")) {
    const u = new URL(w.url);
    const req = http.request({ host: "127.0.0.1", port: Number(u.port) || 80, path: u.pathname, method: w.method || "POST",
      headers: { "Content-Type": "application/json", Host: `127.0.0.1:${u.port}` } }, (res) => {
      res.resume();
      res.on("end", () => queue.push(() => run(`__sim.webDone(${w.id}, ${res.statusCode >= 400})`, "=webDone")));
    });
    req.on("error", () => queue.push(() => run(`__sim.webDone(${w.id}, true)`, "=webDone")));
    req.end(w.body || "");
  }
}

// everything that touches the Lua state runs on the frame loop, one at a time
const queue = [];
function tick() {
  while (queue.length) queue.shift()();
  const f = run("__sim.frames(1)", "=frame");
  if (f.error) printErr("frame", f.error);
  drainFx();
  drainWeb();
}
setInterval(tick, 16);

// the External Editor API, as TTS serves it to the bridge
net.createServer((sock) => {
  const chunks = [];
  sock.on("data", (c) => chunks.push(c));
  sock.on("end", () => {
    let msg;
    try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { return log(`unreadable message: ${e.message}`); }
    if (msg.messageID === 2 && msg.customMessage) {
      queue.push(() => {
        setString("__msgT", String(msg.customMessage.t || ""));
        setString("__msgJson", String(msg.customMessage.json || ""));
        const r = run("onExternalMessage({ t = __msgT, json = __msgJson })", "=message");
        if (r.error) printErr("onExternalMessage", r.error);
      });
    } else if (msg.messageID === 3) {
      queue.push(() => {
        const r = run(`local __v = (function() ${msg.script} end)() if __v == nil then return nil end if type(__v) == "table" then return JSON.encode(__v) end return tostring(__v)`, "=exec");
        if (r.error) printErr("exec", r.error);
        toBridge({ messageID: 5, returnID: msg.returnID, returnValue: r.error ? null : r.value });
      });
    }
  });
  sock.on("error", () => {});
}).listen(LISTEN, "127.0.0.1", () => {
  log(`listening on ${LISTEN} (bridge: --tts-in ${BRIDGE_IN} --tts-out ${LISTEN} --debug-port ${BRIDGE_HTTP}); seated ${SEATED.join(",")}`);
  // like a freshly loaded game: tell the bridge
  queue.push(() => run(`engineSend("hello", {})`, "=hello"));
});
