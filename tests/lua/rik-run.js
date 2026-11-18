// Runs rikrassen's MTG importer script (an object script in TTS) alone on fengari with the fake TTS (tts-sim.lua) and
// calls its real M.deck, with WebRequest stubbed: GETs answered from a table, POSTs recorded, not sent. Used by
// tests/test_table_rik_deckcheck.js.
//   const { runDeck } = require("./rik-run");  runDeck(script, { url, data, ... }, { color, answers: { [url]: answer } })
const fs = require("fs");
const path = require("path");
require("./moonsharp-patterns"); // (fails on the patterns TTS fails on)
const { lua, lauxlib, lualib, to_luastring } = require("fengari");

// rikrassen's script alone on the fake TTS, its `api` module (M.deck) reached through one line added here only;
// `answers`: url -> web answer; any other GET fails as no answer. -> { gets, posts: [{url, body}], said, next, error }
function runDeck(script, data, { color = "White", answers = {} } = {}) {
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
  run(`__answers = JSON.decode(__answers) __gets = {} __posts = {}
    WebRequest.get = function(url, cb)
      __gets[#__gets + 1] = url
      local a = __answers[url]
      Wait.frames(function() cb(a or { is_done = true, is_error = true, error = "Cannot connect to destination host", text = "" }) end, 2)
      return {}
    end
    WebRequest.custom = function(url, method, download, body, headers, cb)
      __posts[#__posts + 1] = { url = url, method = method, body = body }
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
  const r = run("__next = false __rikApi.deck(__color, JSON.decode(__data), function() __next = true end) __sim.frames(30) return 'ok'", "=deck");
  if (r.error) return { error: r.error };
  const out = run(`local said = {}
    for _, l in ipairs(__fx) do if l:find("broadcastToColor", 1, true) then said[#said + 1] = l end end
    return JSON.encode({ gets = __gets, posts = __posts, said = said, next = __next })`, "=out");
  if (out.error) return { error: out.error };
  const res = JSON.parse(out.value);
  res.posts = (res.posts || []).map((p) => ({ url: p.url, method: p.method, body: JSON.parse(p.body) }));
  return res;
}

module.exports = { runDeck };
