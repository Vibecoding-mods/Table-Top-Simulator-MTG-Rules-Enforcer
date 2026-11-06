// The fake TTS's string library fails where TTS's does (tests/lua/moonsharp-patterns.js): the first length that
// raises "pattern too complex", for each shape measured on live TTS 2026-11-06 (tmp/pattern-trap/rule.md).
//   node tests/test_moonsharp_patterns.js
require("./lua/moonsharp-patterns");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const LIVE = { // label: [first n that raised on live TTS, or 0 for "fine at 400", the string, the call]
  cap: [99, 'string.rep("a", n)', 'l:match("^([^:]*):")'],
  nocap: [199, 'string.rep("a", n)', 'l:match("^[^:]*:")'],
  nocapfind: [199, 'string.rep("a", n)', 'l:find("^[^:]*:")'],
  unanch: [99, 'string.rep("a", n)', 'l:match("([^:]*):")'],
  capOK: [0, 'string.rep("a", n)', '(l .. ":"):match("^([^:]*):")'],
  short: [100, 'string.rep("a", n)', 'l:match("^([^:]+):%s*(.+)$")'],
  dotstar: [0, 'string.rep("a", n)', 'l:match("^(.*)$")'],
  dotstarX: [99, 'string.rep("a", n)', 'l:match("^(.*)X")'],
  mid: [0, 'string.rep("a", n)', '(l .. ":" .. l):match("^([^:]*):(.*)$")'],
  lazy: [99, 'string.rep("a", n)', 'l:match("^(.-)%s+for")'],
  trimEnd: [0, 'string.rep("ab ", n) .. "x"', 'l:gsub("%s+$", "")'],
  trimEndBig: [200, '"x" .. string.rep(" ", n) .. "x"', 'l:gsub("%s+$", "")'],
  trimStart: [0, 'string.rep(" ", n) .. "x"', 'l:gsub("^%s+", "")'],
  bal: [0, 'string.rep("(", n)', 'l:gsub("%b()", "")'],
  gmS: [0, 'string.rep("ab ", n)', 'for w in l:gmatch("%S+") do end'],
  gmLines: [0, 'string.rep("abc\\n", n)', 'for w in l:gmatch("([^\\n]*)\\n") do end'],
  gmLong: [0, 'string.rep("a", n) .. "\\n"', 'for w in l:gmatch("([^\\n]*)\\n") do end'],
  gmTail: [99, '"x\\n" .. string.rep("a", n)', 'for w in l:gmatch("([^\\n]*)\\n") do end'],
  gsubCls: [0, 'string.rep("a b", n)', 'l:gsub("[^%w]", "_")'],
  frontier: [0, 'string.rep("untapped ", n)', 'l:gsub("%f[%a]tapped%f[%A]", "")'],
};

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const firstRaise = (mk, call) => {
  const code = `for n = 1, 400 do local l = ${mk} local ok, e = pcall(function() ${call} end)
    if not ok then return tostring(e):find("pattern too complex", 1, true) and n or ("other: " .. tostring(e)) end end return 0`;
  if (lauxlib.luaL_dostring(L, to_luastring(code)) !== lua.LUA_OK) return `error: ${lua.lua_tojsstring(L, -1)}`;
  const v = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return v;
};
let failed = 0;
for (const [label, [want, mk, call]] of Object.entries(LIVE)) {
  const got = firstRaise(mk, call);
  if (String(got) !== String(want)) { failed++; console.log(`FAIL ${label}: live TTS ${want || "fine at 400"}, fake ${got === "0" ? "fine at 400" : got}`); }
}
const n = Object.keys(LIVE).length;
console.log(failed ? `FAILED: ${failed} of ${n}` : `PASSED: ${n} of ${n} shapes fail at the length live TTS does`);
process.exit(failed ? 1 : 0);
