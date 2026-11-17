// The TTS turn colour in a shared team turn (2HG Level 2, tools/engine-renderer.lua engineTurnColor, engineTurnKey and
// the turn-colour lines of the board's apply): the active player's when seated, else the seated partner's in the team's
// turn (the board's activeTeam), so an AI's team turn still lights the human partner; outside a shared turn the one
// player as before. Run on fengari with stand-ins for Player and Turns, no TTS save needed.
//   node tests/test_table_shared_turn.js
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const RENDERER = fs.readFileSync(path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const cut = (start, endMark) => {
  const a = RENDERER.indexOf(start);
  const b = a < 0 ? -1 : RENDERER.indexOf(endMark, a);
  if (a < 0 || b < 0) { console.log(`FAIL test_table_shared_turn: the renderer's code moved (${start.trim().slice(0, 40)})`); process.exit(1); }
  return RENDERER.slice(a, b + endMark.length);
};
const FUNCS = cut("\nfunction engineTurnColor(", "\nend\n") + cut("\nfunction engineTurnKey(", "\nend\n");
// (the apply's turn-colour lines: from their comment to the block's end)
const APPLY = cut("  -- (TTS's turn colour:", "\n    end\n  end\n").replace(/^.*\n.*\n/, "");
const CODE = `
seated = {}
Player = setmetatable({}, { __index = function(_, c) return { color = c, seated = seated[c] == true } end })
Turns = { enable = false, turn_color = "" }
sets = 0
setmetatable(Turns, nil)
lastTurnSet = nil
${FUNCS}
function applyTurn(m)
${APPLY.replace(/Turns\.turn_color = turnColor/, "Turns.turn_color = turnColor sets = sets + 1")}
end
`;
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(CODE)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
  console.log(`FAIL test_table_shared_turn: the code doesn't load: ${lua.lua_tojsstring(L, -1)}`); process.exit(1);
}
const q = (src) => {
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
  const v = lua.lua_isnil(L, -1) ? null : lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  return v;
};
const seat = (...cs) => q(`seated = {} ${cs.map((c) => `seated["${c}"] = true`).join(" ")} return nil`);
const turn = (board) => { q(`applyTurn(${board}) return nil`); return q("return Turns.turn_color"); };

// Level 1 (no activeTeam): the one player, as before
seat("White", "Red", "Yellow", "Blue");
same("level 1: White's turn shows White", turn('{ active = "White" }'), "White");
same("level 1: Yellow's turn shows Yellow", turn('{ active = "Yellow" }'), "Yellow");
seat("Red", "Yellow");
same("level 1: an AI's turn leaves the colour (no team turn)", turn('{ active = "White" }'), "Yellow");
same("engineTurnColor: level 1 AI active is nobody", q('return engineTurnColor({ active = "White" })'), null);

// Level 2 (activeTeam): the team's
seat("White", "Red", "Yellow", "Blue");
same("level 2: the team's turn with White seated shows White (the active player first)", turn('{ active = "White", activeTeam = { "White", "Red" } }'), "White");
seat("Red", "Blue");
same("level 2: AI Yellow's team turn shows the human partner Blue", turn('{ active = "Yellow", activeTeam = { "Yellow", "Blue" } }'), "Blue");
same("level 2: the next team turn, White an AI: Red", turn('{ active = "White", activeTeam = { "White", "Red" } }'), "Red");
same("engineTurnColor: the seated partner", q('return engineTurnColor({ active = "White", activeTeam = { "White", "Red" } })'), "Red");
seat();
same("engineTurnColor: nobody of the team seated is nobody", q('return engineTurnColor({ active = "White", activeTeam = { "White", "Red" } })'), null);
same("engineTurnKey: the team in the key", q('return engineTurnKey({ active = "White", activeTeam = { "White", "Red" } })'), "White+White+Red");
same("engineTurnKey: level 1 just the player", q('return engineTurnKey({ active = "White" })'), "White");

// the same turn again doesn't set it again (a player who moved TTS's turn by hand keeps it until the turn changes)
seat("Red", "Blue");
q('Turns.turn_color = "Blue" sets = 0 lastTurnSet = nil return nil');
turn('{ active = "White", activeTeam = { "White", "Red" } }');
q('Turns.turn_color = "Blue" return nil');
same("the same team turn again: not set again", turn('{ active = "White", activeTeam = { "White", "Red" } }'), "Blue");
same("…set once", q("return tostring(sets)"), "1");

console.log(`${failed ? "FAIL" : "PASS"} test_table_shared_turn: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
