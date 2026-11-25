// Runs rikrassen's MTG importer script (an object script in TTS) alone on fengari with the fake TTS (tts-sim.lua) and
// calls its real M.deck, with WebRequest stubbed: GETs answered from a table, POSTs recorded, not sent. Used by
// tests/test_table_rik_deckcheck.js.
//   const { runDeck } = require("./rik-run");  runDeck(script, { url, data, ... }, { color, answers: { [url]: answer } })
const fs = require("fs");
const path = require("path");
require("./moonsharp-patterns"); // (fails on the patterns TTS fails on)
const { lua, lauxlib, lualib, to_luastring } = require("fengari");

// rikrassen's script alone on the fake TTS, its `api` module (M.deck) reached through one line added here only;
// `answers`: url -> web answer; any other GET fails as no answer. `build`: the server's /build answer (ndjson text),
// handed to the importer's callback; without it a POST gets no answer. `first`: a request the same seat makes before
// `data`, in the same table (spawned then lists both imports' objects, in order); `overlap`: `first` is still waiting
// for its answers when `data` is asked (both in one frame). -> { gets, posts: [{url, body}], said, next,
// spawned: [{type, gm}], error }
function runDeck(script, data, { color = "White", answers = {}, build = null, first = null, overlap = false } = {}) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const run = (code, name) => {
    if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name)) !== lua.LUA_OK) { const e = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return { error: `does not compile: ${e}` }; }
    if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) { const e = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return { error: e }; }
    const v = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : null;
    lua.lua_pop(L, 1);
    return { value: v };
  };
  const setString = (name, s) => { lua.lua_pushstring(L, to_luastring(s)); lua.lua_setglobal(L, to_luastring(name)); };
  const r0 = run(fs.readFileSync(path.join(__dirname, "tts-sim.lua"), "utf8"), "=tts-sim");
  if (r0.error) throw new Error(`tts-sim: ${r0.error}`);
  setString("__answers", JSON.stringify(answers));
  setString("__data", JSON.stringify(data));
  if (build !== null) setString("__build", build);
  run(`__answers = JSON.decode(__answers) __gets = {} __posts = {}
    -- (real TTS hands the callback a WebRequest USERDATA, not a table: type(wr) == "userdata"; a check for "table" read
    -- every DeckCheck answer as no connection, live 2026-11-18. The answers here say so too.)
    __ud = setmetatable({}, { __mode = "k" })
    local __rawtype = type
    type = function(v) if __ud[v] then return "userdata" end return __rawtype(v) end
    WebRequest.get = function(url, cb)
      __gets[#__gets + 1] = url
      local a = __answers[url]
      local w = a or { is_done = true, is_error = true, error = "Cannot connect to destination host", text = "" }
      __ud[w] = true
      Wait.frames(function() cb(w) end, 2)
      return {}
    end
    WebRequest.custom = function(url, method, download, body, headers, cb)
      __posts[#__posts + 1] = { url = url, method = method, body = body }
      if __build ~= nil then Wait.frames(function() cb({ is_done = true, text = __build }) end, 2) end
      return {}
    end
    local hand = { position = { x = 0, y = 1, z = -30 }, forward = { x = 0, y = 0, z = 1 }, right = { x = 1, y = 0, z = 0 } }
    Player = { White = { color = "White", getHandTransform = function() return hand end },
      Grey = { color = "Grey", getHandTransform = function() return nil end } }`, "=web");
  const END = 'return __bundle_require("__root")';
  if (!script.includes(END)) return { error: "the script doesn't end with the luabundle's return" };
  const loaded = run(script.replace(END, `__rikApi = __bundle_require("api")\n${END}`), "=rikrassen");
  if (loaded.error) return { error: `importer script: ${loaded.error}` };
  run("if onLoad then onLoad('') end __sim.frames(5) __fx = {} __gets = {} __posts = {}", "=onLoad");
  setString("__color", color);
  if (first !== null) {
    setString("__first", JSON.stringify(first));
    const f0 = run(overlap ? "__rikApi.deck(__color, JSON.decode(__first), function() end) return 'ok'"
      : "__rikApi.deck(__color, JSON.decode(__first), function() end) __sim.frames(30) __fx = {} __gets = {} __posts = {} return 'ok'", "=first");
    if (f0.error) return { error: `first request: ${f0.error}` };
  }
  const r = run("__next = false __rikApi.deck(__color, JSON.decode(__data), function() __next = true end) __sim.frames(30) return 'ok'", "=deck");
  if (r.error) return { error: r.error };
  const out = run(`local said = {}
    for _, l in ipairs(__fx) do if l:find("broadcastToColor", 1, true) then said[#said + 1] = l end end
    local spawned = {}
    for _, o in ipairs(getObjects()) do spawned[#spawned + 1] = { type = o.type, gm = o.getGMNotes() } end
    return JSON.encode({ gets = __gets, posts = __posts, said = said, next = __next, spawned = spawned })`, "=out");
  if (out.error) return { error: out.error };
  const res = JSON.parse(out.value);
  res.posts = (res.posts || []).map((p) => ({ url: p.url, method: p.method, body: JSON.parse(p.body) }));
  return res;
}

module.exports = { runDeck };
