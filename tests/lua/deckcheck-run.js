// Loads tools/deckcheck.lua on fengari behind the fake TTS's JSON (tts-sim.lua: null decodes to nil, as in TTS) and
// calls its functions from JS. Used by tests/test_deckcheck.js and tools/deckcheck-smoke.js.
//   const dc = require("./lua/deckcheck-run")(); dc.lua("return deckcheckId(...)")
const fs = require("fs");
const path = require("path");
require("./moonsharp-patterns"); // (fails on the patterns TTS fails on)
const { lua, lauxlib, lualib, to_luastring } = require("fengari");

const ROOT = path.join(__dirname, "..", "..");

// The documented response shape (docs/deckcheck-spec.md), checked on the raw decoded JSON and on what
// deckcheckEntries made of it: a list of problems, empty when it matches
function shapeProblems(raw, info) {
  const p = [];
  const isInt = (v) => Number.isInteger(v);
  const intOrNull = (v) => v === null || v === undefined || isInt(v);
  if (!raw || typeof raw !== "object") return ["the response is not a JSON object"];
  for (const k of ["name", "format", "publicUrl"]) if (typeof raw[k] !== "string") p.push(`${k} is not a string`);
  if (!intOrNull(raw.bracket)) p.push("bracket is not an integer or null");
  if (!intOrNull(raw.threatIndex)) p.push("threatIndex is not an integer or null");
  if (isInt(raw.threatIndex) && (raw.threatIndex < 0 || raw.threatIndex > 96)) p.push("threatIndex is outside 0..96");
  if (raw.dti != null && (typeof raw.dti !== "object" || !intOrNull(raw.dti.score) || !intOrNull(raw.dti.maxScore))) p.push("dti is not {score, maxScore}");
  const boards = raw.boards;
  if (!boards || typeof boards !== "object") p.push("boards is not an object");
  let cards = 0;
  for (const b of ["commanders", "mainboard"]) {
    const c = boards && boards[b] && boards[b].cards;
    if (c == null) continue; // (a missing board is allowed)
    if (typeof c !== "object" || Array.isArray(c)) { p.push(`boards.${b}.cards is not an object keyed by deckCardId`); continue; }
    for (const [key, e] of Object.entries(c)) {
      cards++;
      if (!e || !isInt(e.quantity)) p.push(`boards.${b}.cards[${key}].quantity is not an integer`);
      const card = e && e.card;
      if (!card || typeof card !== "object") { p.push(`boards.${b}.cards[${key}].card is missing`); continue; }
      for (const f of ["name", "scryfallId", "setCode", "collectorNumber"]) if (typeof card[f] !== "string") p.push(`boards.${b}.cards[${key}].card.${f} is not a string`);
    }
  }
  if (cards === 0) p.push("no cards in boards.commanders or boards.mainboard");
  if (!info) p.push("deckcheckEntries returned nil");
  else {
    if (typeof info.name !== "string" || !info.name) p.push("deckcheckEntries: no name");
    if (!Array.isArray(info.entries) || info.entries.length === 0) p.push("deckcheckEntries: no entries");
    for (const e of info.entries || []) if (typeof e.scryfall_id !== "string" || !isInt(e.count) || e.count < 1) p.push(`deckcheckEntries: bad entry ${JSON.stringify(e)}`);
  }
  return p;
}

module.exports = function load(file = process.env.DECKCHECK_LUA || path.join(ROOT, "tools", "deckcheck.lua")) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const run = (code, name) => {
    if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name || "=deckcheck")) !== lua.LUA_OK) {
      const e = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); throw new Error(`does not compile: ${e}`);
    }
    if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) { const e = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); throw new Error(e); }
    const v = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : null;
    lua.lua_pop(L, 1);
    return v;
  };
  const setString = (name, s) => { lua.lua_pushstring(L, to_luastring(s)); lua.lua_setglobal(L, to_luastring(name)); };
  run(fs.readFileSync(path.join(__dirname, "tts-sim.lua"), "utf8"), "=tts-sim");
  run(fs.readFileSync(file, "utf8"), "=deckcheck");
  const enc = (expr) => { const v = run(`local v = ${expr} if v == nil then return "null" end return JSON.encode(v)`, "=call"); return JSON.parse(v); };
  return {
    lua: run,
    enc,
    // a JS string passed in as a Lua global (no quoting trouble)
    str: (name, s) => setString(name, s),
    // deckcheckEntries on a JSON text, decoded the way TTS does
    entries: (text) => { setString("__in", text); return enc("deckcheckEntries(JSON.decode(__in))"); },
    id: (url) => { setString("__in", url); return enc("deckcheckId(__in)"); },
    error: (status, bodyText) => {
      setString("__in", bodyText == null ? "" : bodyText);
      return enc(`deckcheckError(${status == null ? "nil" : Number(status)}, __in ~= "" and JSON.decode(__in) or nil)`);
    },
  };
};
module.exports.shapeProblems = shapeProblems;
