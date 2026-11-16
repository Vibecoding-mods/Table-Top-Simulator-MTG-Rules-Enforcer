// Archenemy on the table, the parts that need no TTS save (tools/engine-renderer.lua): the archenemy marked on the
// phase bar (engineTeamTurnTag) and in gold on their mat (engineTeamLooks), and the Undo tab saying why Undo is off
// in a scheme game (engineSidePrompt, the board's rewind.off from bridge.js rewindState). Each function is taken from
// engine-renderer.lua as it is and run in fengari with stubs for what it calls; the full table tests need the TTS save.
//   node tests/test_table_archenemy_lua.js
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const SRC = fs.readFileSync(path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };
// a check whose Lua may throw: the error fails it by name
const check = (name, f) => { let got; try { got = f(); } catch (e) { return ok(name, false, `threw ${e.message}`); } return ok(name, got.pass, got.why); };

// a top-level function's text, from "function name(" to the first "end" at the start of a line
function fn(name) {
  const start = SRC.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`no function ${name} in engine-renderer.lua`);
  const end = SRC.indexOf("\nend\n", start + 1);
  return SRC.slice(start + 1, end + 5);
}

// runs Lua code that returns a string, after the stubs and the named functions
function run(code, names) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const prelude = `
    ENGINE_MODE = true
    Player = { White = { host = true }, Red = {}, Yellow = {}, Blue = {} }
    engineBrowse = {}
    engineRewind = nil
    engineTeamShown = nil
    engineModeNow = function() return "commander" end
    engineNameOf = function(c) return c end
    TL = { lines = nil }
    function TL.matLine(c, k) return c .. "=" .. k end
    function TL.setLines(l) TL.lines = table.concat(l, ",") end
    function TL.clear() TL.lines = "cleared" end
    function TL.panel() return nil end
    function TL.put() end
  `;
  const all = prelude + "\n" + names.map(fn).join("\n") + "\n" + `local function body() ${code} end return tostring(body())`;
  if (lauxlib.luaL_dostring(L, to_luastring(all)) !== 0) throw new Error(lua.lua_tojsstring(L, -1));
  return lua.lua_tojsstring(L, -1);
}

const TEAM = ["engineTeamWords", "engineTeamOf", "engineTeamTurnTag"];
const board = (active, extra = "") => `{ active = "${active}", teams = { rule = "teams", mode = "archenemy", archenemy = "Blue", sides = { { "White", "Red", "Yellow" }, { "Blue" } }${extra} } }`;

// ── (3) the archenemy marked: the phase bar ──
const tag = (b, viewer) => run(`return engineTeamTurnTag(${b}, "${viewer}")`, TEAM);
check("phase bar: the archenemy's turn says (ARCHENEMY)", () => { const t = tag(board("Blue"), "White"); return { pass: /\(ARCHENEMY\)/.test(t), why: t }; });
check("phase bar: the archenemy sees (YOU, THE ARCHENEMY)", () => { const t = tag(board("Blue"), "Blue"); return { pass: /\(YOU, THE ARCHENEMY\)/.test(t), why: t }; });
check("phase bar: an opponent's turn is their team's", () => { const t = tag(board("Red"), "White"); return { pass: /\(YOUR TEAM\)/.test(t) && !/ARCHENEMY/.test(t), why: t }; });
check("phase bar: a Juggernaut game is unchanged", () => { const t = tag('{ active = "Blue", teams = { rule = "teams", juggernaut = "Blue", sides = { { "White", "Red", "Yellow" }, { "Blue" } } } }', "White"); return { pass: /\(JUGGERNAUT\)/.test(t), why: t }; });

// ── (3) the archenemy marked: the gold on the mat ──
const LOOKS = ["engineTeamLooks"];
const looks = (teams) => run(`engineTeamLooks({ teams = ${teams}, players = {} }) return TL.lines`, LOOKS);
const lines = looks('{ rule = "teams", mode = "archenemy", archenemy = "Blue", sides = { { "White", "Red", "Yellow" }, { "Blue" } } }');
ok("mat: the archenemy's mat is gold (3), the others their team's tint", lines === "White=1,Red=1,Yellow=1,Blue=3", lines);
const two = looks('{ rule = "teams", mode = "archenemy", archenemy = "White", sides = { { "White" }, { "Blue" } } }');
ok("mat: a 2-player Archenemy game marks the archenemy too", two === "White=3,Blue=2", two);
const jugg = looks('{ rule = "teams", juggernaut = "Red", sides = { { "White", "Yellow", "Blue" }, { "Red" } } }');
ok("mat: a Juggernaut game is unchanged", jugg === "White=1,Yellow=1,Blue=1,Red=3", jugg);

// ── (2) the Undo tab ──
const PROMPT = ["engineSidePrompt"];
const tab = (rewind) => run(`engineBrowse.White = "undo" engineRewind = ${rewind} return engineSidePrompt("White").text`, PROMPT);
const OFF = "Undo isn't available in Archenemy games: the schemes in play can't be rewound yet.";
ok("Undo tab: a scheme game says why Undo is off", tab(`{ points = {}, off = "${OFF}" }`) === OFF, tab(`{ points = {}, off = "${OFF}" }`));
ok("Undo tab: another game with no points says none yet", tab("{ points = {} }") === "No restore points yet.", tab("{ points = {} }"));
ok("Undo tab: with points, pick one", /^Pick a moment/.test(tab('{ points = { { label = "Turn 2" } } }')));

console.log(`${failed ? "FAIL" : "PASS"} test_table_archenemy_lua: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
