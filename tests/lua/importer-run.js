// Runs the Card Importer's script (an object script in TTS) alone on fengari with the fake TTS (tts-sim.lua), with the
// web answered from a table, and says what it asked for, said and spawned. Used by tests/test_table_deckcheck.js.
//   const { runImporter } = require("./importer-run");  runImporter(script, "Importer deck <link>", { [url]: answer })
const fs = require("fs");
const path = require("path");
require("./moonsharp-patterns"); // (fails on the patterns TTS fails on)
const { lua, lauxlib, lualib, to_luastring } = require("fengari");

// The importer's script alone on the fake TTS (as its own object's script in TTS). `answers`: url -> a web answer
// { response_code, text, is_error, error }; any other url fails as no answer. 30 s of frames after the message (the
// importer spawns a card every 0.2 s: a 100-card deck takes 20). -> { requests, said, decks, error }
function runImporter(script, message, answers = {}) {
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
  run(`__sim.seated.White = true __sim.host = "White"
    __answers = JSON.decode(__answers) __requests = {}
    WebRequest.custom = function(url, method, download, body, headers, cb)
      __requests[#__requests + 1] = url
      local a = __answers[url]
      Wait.frames(function() cb(a or { is_error = true, error = "Cannot connect to destination host", text = "" }) end, 2)
      return {}
    end`, "=web");
  const loaded = run(script, "=importer");
  if (loaded.error) return { error: `importer script: ${loaded.error}` };
  run("if onLoad then onLoad('') end __sim.frames(5) __fx = {}", "=onLoad");
  run("__requests = {}", "=reset");
  setString("__msg", message);
  const r = run("onChat(__msg, Player.White) __sim.frames(1800) return 'ok'", "=chat");
  if (r.error) return { error: r.error };
  const out = run(`local decks = {}
    for _, o in ipairs(getObjects()) do
      if o.type == "Deck" then
        local d = o.getData()
        local names = {}
        for i, c in ipairs(d.ContainedObjects or {}) do names[i] = tostring(c.Nickname):gsub("\\n.*", "") end
        decks[#decks + 1] = { gm = o.getGMNotes(), desc = o.getDescription(), n = #(d.ContainedObjects or {}), names = names }
      end
    end
    local said = {}
    for _, l in ipairs(__fx) do if l:find("Player.broadcast", 1, true) then said[#said + 1] = l end end
    return JSON.encode({ requests = __requests, said = said, decks = decks })`, "=out");
  if (out.error) return { error: out.error };
  return JSON.parse(out.value);
}

module.exports = { runImporter };
