// The infinity sign on the table, in one place (tools/engine-renderer.lua ENGINE_INF / engineInfText): the token stack's
// "x∞" badge and engineCompact's "∞" / "-∞" at the engine's cap (the life counter, the counter and P/T badges).
// TTS's object-button font hasn't been seen to draw "∞" (U+221E) on a real table, so ENGINE_INF.ascii switches every
// one of them to "INF" at once. This runs the renderer's own functions on fengari, both ways. No TTS save needed.
//   node tests/test_table_inf_glyph.js
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const SRC = fs.readFileSync(path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const fn = (name) => {
  const a = SRC.indexOf(`\nfunction ${name}(`);
  const b = a < 0 ? -1 : SRC.indexOf("\nend\n", a);
  if (a < 0 || b < 0) { console.log(`FAIL test_table_inf_glyph: ${name} is gone from engine-renderer.lua`); process.exit(1); }
  return SRC.slice(a, b + 5);
};
const line = (start) => {
  const a = SRC.indexOf(`\n${start}`);
  if (a < 0) { console.log(`FAIL test_table_inf_glyph: "${start}" is gone`); process.exit(1); }
  return SRC.slice(a + 1, SRC.indexOf("\n", a + 1) + 1);
};
const LUA = [line("ENGINE_INF = {"), fn("engineInfText"), line("ENGINE_HUGE = "), line("ENGINE_COMPACT_UNITS = "), fn("engineCompact"), line("ENGINE_LIFE_FONT = "), fn("engineLifeLook")].join("\n");
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(LUA)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
  console.log(`FAIL test_table_inf_glyph: the table code doesn't load: ${lua.lua_tojsstring(L, -1)}`); process.exit(1);
}
const q = (src) => {
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
  if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
  const v = lua.lua_isnil(L, -1) ? null : lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  return v;
};
const look = (n) => q(`local l = engineLifeLook(${n}) return l.label .. "|" .. l.letters .. "|" .. l.font .. "|" .. tostring(l.compacted)`);

// the sign as it is (the default)
same("default: the sign", q("return engineInfText()"), "∞");
same("default: the cap reads ∞, minus it -∞", [q("return engineCompact(1073741824)"), q("return engineCompact(-1073741824)")], ["∞", "-∞"]);
same("default: the life counter at the cap: one letter, the counter's own font", look(1073741824), "∞|1|1000|true");
same("default: minus the cap: two letters", look(-1073741824), "-∞|2|1000|true");
same("default: numbers under the cap unchanged", [q("return engineCompact(12345)"), q("return engineCompact(40)")], ["12.3K", "40"]);

// the fallback, one switch
q("ENGINE_INF.ascii = true return nil");
same("fallback: INF", q("return engineInfText()"), "INF");
same("fallback: the cap reads INF, minus it -INF", [q("return engineCompact(1073741824)"), q("return engineCompact(-1073741824)")], ["INF", "-INF"]);
same("fallback: the life counter counts its letters (3 fit the counter's font)", look(1073741824), "INF|3|1000|true");
same("fallback: -INF is four letters, a smaller font", look(-1073741824), "-INF|4|750|true");
same("fallback: numbers under the cap unchanged", [q("return engineCompact(12345)"), q("return engineCompact(999)")], ["12.3K", "999"]);
q("ENGINE_INF.ascii = false return nil");
same("back: the sign again", q("return engineCompact(1073741824)"), "∞");

// every place the table draws it goes through the one function
ok("badge: the token stack of infinitely many reads \"x\" .. engineInfText()", /if c\.groupInf then parts\[#parts \+ 1\] = \{ "grp", "x" \.\. engineInfText\(\), BADGE\.black,/.test(SRC));
const code = SRC.split("\n").filter((l) => !/^\s*--/.test(l)).map((l) => l.replace(/--.*$/, ""));
const loose = code.filter((l) => l.includes("∞") && !/^ENGINE_INF = \{ glyph = "∞"/.test(l) );
ok("source: no other ∞ in the table's code (comments aside)", loose.length === 0, loose.join(" | "));
ok("source: the default is the sign, not the fallback (switch only once a real table shows a box)", /^ENGINE_INF = \{ glyph = "∞", fallback = "INF", ascii = false \}$/m.test(SRC));

console.log(`${failed ? "FAIL" : "PASS"} test_table_inf_glyph: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
