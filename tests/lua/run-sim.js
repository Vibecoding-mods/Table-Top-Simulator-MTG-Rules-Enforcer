// Runs the table's Global script (from a save) on fengari with the fake TTS (tts-sim.lua) and returns what it did.
//   const { simulate } = require("./run-sim");  simulate({ save, seated, steps, prelude })
// steps: [{ msg: { t, json } } | { frames: n } | { lua: "code" } | { mark: "label" }]
// prelude: Lua run before the Global script loads (sets a global the script keeps: `x = x or default`)
// stop(steps, errors): called after each recorded step; true ends the run there (the golden's first-fail mode)
const fs = require("fs");
const path = require("path");
require("./moonsharp-patterns"); // (fails on the patterns TTS fails on)
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

function simulate({ save, seated = ["Blue"], host = "Blue", steps = [], framesPerMsg = 6, prelude = "", stop = null }) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const errors = [];
  const run = (code, name) => {
    if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name || "=sim")) !== lua.LUA_OK) {
      const e = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return { error: `does not compile: ${e}` }; // reported by step, not thrown
    }
    if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
      const e = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return { error: e };
    }
    const v = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : null;
    lua.lua_pop(L, 1);
    return { value: v };
  };
  const setGlobalString = (name, s) => { lua.lua_pushstring(L, to_luastring(s)); lua.lua_setglobal(L, to_luastring(name)); };

  const simSrc = fs.readFileSync(path.join(__dirname, "tts-sim.lua"), "utf8");
  const r0 = run(simSrc, "=tts-sim");
  if (r0.error) throw new Error(`tts-sim: ${r0.error}`); // the sim itself must load
  // the save's objects (without their scripts, which aren't run) go in through JSON
  const slim = { ObjectStates: save.ObjectStates.map(({ LuaScript, LuaScriptState, XmlUI, ...o }) => o), XmlUI: save.XmlUI || "" };
  setGlobalString("__saveJson", JSON.stringify(slim));
  setGlobalString("__script", save.LuaScript);
  run(`__sim.load(JSON.decode(__saveJson)) __saveJson = nil __sim.script = __script
    __sim.host = ${JSON.stringify(host)}
    ${seated.map((c) => `__sim.seated[${JSON.stringify(c)}] = true`).join(" ")}`, "=setup");
  const fx = () => {
    const r = run(`local out = __fx __fx = {} return JSON.encode(out)`, "=fx");
    if (r.error) errors.push(`recording the step's effects: ${r.error}`); // (2026-11-27: a failed encode used to lose them quietly)
    return JSON.parse(r.value || "[]");
  };
  // a button label real TTS draws see-through (so not at all), and a UI.setValue on a Button (ignored by real TTS)
  const drift = () => driftCheck(run(`local out = {}
    for _, h in ipairs(__sim.hiddenLabels) do out[#out + 1] = "button label " .. string.format("%q", h.label) .. " on " .. h.guid .. " has a see-through background: real TTS hides it" end
    for _, id in ipairs(__sim.buttonValues) do out[#out + 1] = "UI.setValue on a Button (" .. id .. "): real TTS ignores it, set its text attribute" end
    for _, b in ipairs(__sim.badXml) do out[#out + 1] = "screen UI text that real TTS can't parse when it rebuilds the UI (" .. b .. "): write <textcolor color=\\"#hex\\">, engineXmlRich" end
    __sim.hiddenLabels = {} __sim.buttonValues = {} __sim.badXml = {}
    return table.concat(out, "; ")`, "=drift"));
  const driftCheck = (r) => { if (r.error) errors.push(`reading the sim's drift list: ${r.error}`); return r.value; };
  const out = [];
  const record =(label, extra) => { const e = fx(); out.push({ step: label, ...(extra || {}), fx: e }); };

  if (prelude) { const p = run(prelude, "=prelude"); if (p.error) errors.push(`prelude: ${p.error}`); }
  const loaded = run(save.LuaScript, "=Global");
  if (loaded.error) errors.push(`Global script: ${loaded.error}`);
  // TTS calls onLoad, and the older lowercase onload (the base table script uses that one)
  const onLoad = run(`local st = ${JSON.stringify(save.LuaScriptState || "")} if onLoad then onLoad(st) end if onload then onload(st) end __sim.frames(30)`, "=onLoad");
  if (onLoad.error) errors.push(`onLoad: ${onLoad.error}`);
  const unseenAtLoad = drift();
  if (unseenAtLoad) errors.push(`onLoad: ${unseenAtLoad}`);
  record("load", onLoad.error ? { error: onLoad.error } : undefined);

  for (let i = 0; i < steps.length; i++) {
    if (stop && stop(out, errors)) break;
    const s = steps[i];
    let r = {};
    if (s.msg) {
      setGlobalString("__msgT", s.msg.t);
      setGlobalString("__msgJson", s.msg.json);
      r = run(`onExternalMessage({ t = __msgT, json = __msgJson }) __sim.frames(${s.frames ?? framesPerMsg})`, "=msg");
    } else if (s.lua) r = run(`local __r = (function() ${s.lua} end)() __sim.frames(${s.frames ?? framesPerMsg}) return __r`, "=step");
    else if (s.frames) r = run(`__sim.frames(${s.frames})`, "=frames");
    if (r.error) errors.push(`step ${i} (${s.msg ? s.msg.t : s.mark || "lua"}): ${r.error}`);
    // (a screen-UI set by a long id that has a short one changes nothing in TTS: engineUI was missed, tts-sim.lua)
    const long = run(`local t = __sim.longIds __sim.longIds = {} return table.concat(t, ", ")`, "=longIds").value;
    if (long) errors.push(`step ${i} (${s.msg ? s.msg.t : s.mark || "lua"}): screen UI set by its long id (not through engineUI): ${long.slice(0, 200)}`);
    // (what real TTS would not show: tts-sim.lua's model, pinned by tests/test_tts_sim_contract.js)
    const unseen = drift();
    if (unseen) errors.push(`step ${i} (${s.msg ? s.msg.t : s.mark || "lua"}): ${unseen}`);
    if (s.mark) { record(s.mark, r.error ? { error: r.error } : (r.value ? { value: r.value } : undefined)); continue; }
    record(`${i} ${s.msg ? s.msg.t : s.lua ? "lua" : "frames"}`, r.error ? { error: r.error } : (r.value ? { value: r.value } : undefined));
  }
  return { steps: out, errors };
}

module.exports = { simulate };
