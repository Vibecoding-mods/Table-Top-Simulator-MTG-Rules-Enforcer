// Three-Headed Giant on the table (docs/game-modes-spec.md §8; tools/engine-renderer.lua engineTeamChat's "mtg mode
// 3hg", engineSixSeats, engineTeamsLabel, onMtgSetupTeams, engineSetGameMode): the table's team code alone, run on
// fengari with a few stand-ins (no TTS save needed): the mode on the six-seat table only, its teams the table's sides,
// what is sent with Start (teamMode "3hg"), the Teams button's cycle with 3HG on the six-seat table only, mtg team
// refused, a game-mode switch keeping it, and the four-seat modes as before.
//   node tests/test_table_3hg.js
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const RENDERER = fs.readFileSync(path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// the renderer's team block (ENGINE_TEAMS ... up to the Archenemy button) and engineSetGameMode, as written
const from = RENDERER.indexOf("\nENGINE_TEAMS = nil");
const to = RENDERER.indexOf("\n-- The Archenemy button beside it");
const gm = RENDERER.indexOf("\nfunction engineSetGameMode(");
const gmEnd = RENDERER.indexOf("\nend\n", gm) + 5;
if (from < 0 || to < 0 || gm < 0) { console.log("FAIL test_table_3hg: the renderer's team code moved (ENGINE_TEAMS = nil / the Archenemy button / engineSetGameMode)"); process.exit(1); }
const STUBS = `
TABLE_PROFILE = { spots = { teams = { 0, 0, 0 } } }
function Vector(x, y, z) return { x, y, z } end
ENGINE_GAME_MODE = "commander"
ENGINE_TABLE_SEATS = nil
said = {}
function broadcastToAll(t) said[#said + 1] = "all: " .. t end
function engineNameOf(c) return c end
function engineSetupButtons() end
function engineSend() end
function engineModeLife() end
engineReadyState = {}
engineTable = nil
host = { color = "Blue", steam_name = "Host", broadcast = function(t) said[#said + 1] = "host: " .. t end }
Player = { Blue = host }
function engineChat(text, pl)
  local cmd, rest = text:match("^mtg%s+(%a*)%s*(.-)%s*$")
  return engineTeamChat(cmd or "", rest or "", pl, true)
end
function lastSaid() return said[#said] or "" end
function teamsOf() local t = {} for c, n in pairs(ENGINE_TEAMS or {}) do t[#t + 1] = c .. "=" .. n end table.sort(t) return table.concat(t, ",") end
`;
function freshLua() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const code = STUBS + RENDERER.slice(from, to) + RENDERER.slice(gm, gmEnd);
  if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    throw new Error(`the team code doesn't load: ${lua.lua_tojsstring(L, -1)}`);
  }
  return (expr) => {
    if (lauxlib.luaL_loadstring(L, to_luastring(`return ${expr}`)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
    const v = lua.lua_isnil(L, -1) ? null : lua.lua_tojsstring(L, -1);
    lua.lua_pop(L, 1);
    return v;
  };
}
const SIX = '{ "White", "Red", "Yellow", "Green", "Blue", "Purple" }';
const SIDES = "Blue=2,Green=2,Purple=2,Red=1,White=1,Yellow=1";

// ── the four-seat table ──
let q = freshLua();
q('engineChat("mtg mode 3hg", host)');
ok("four-seat table: mtg mode 3hg refused, saying the six-seat table", q("ENGINE_TEAM_MODE") === null && /^host: \[MTG\] Three-Headed Giant is played on the six-seat table \(three a side\); this table has 4 seats\./.test(q("lastSaid()")), q("lastSaid()"));
same("four-seat table: the Teams button cycles as before (2HG, Juggernaut, none)", [1, 2, 3].map(() => { q('onMtgSetupTeams(nil, "Blue")'); return q("ENGINE_TEAM_MODE"); }), ["2hg", "juggernaut", null]);
q('(function() ENGINE_GAME_MODE = "standard" end)()');
same("four-seat table, Standard: the Teams button cycles as before (2v2, none)", [1, 2].map(() => { q('onMtgSetupTeams(nil, "Blue")'); return q("ENGINE_TEAM_MODE"); }), ["2v2", null]);

// a seat list that isn't six (a table that names four seats): still not the six-seat table
q = freshLua();
q('(function() ENGINE_TABLE_SEATS = { "White", "Red", "Yellow", "Blue" } end)()');
q('engineChat("mtg mode 3hg", host)');
ok("a four-seat seat list: not six seats, 3hg refused", q("tostring(engineSixSeats())") === "false" && q("ENGINE_TEAM_MODE") === null && /this table has 4 seats/.test(q("lastSaid()")), q("lastSaid()"));

// ── the six-seat table ──
q = freshLua();
q(`(function() ENGINE_TABLE_SEATS = ${SIX} end)()`);
ok("six-seat table: engineSixSeats", q("tostring(engineSixSeats())") === "true");
q('engineChat("mtg mode 3hg", host)');
ok("mtg mode 3hg: the mode and the teams by side", q("ENGINE_TEAM_MODE") === "3hg" && q("teamsOf()") === SIDES, `${q("ENGINE_TEAM_MODE")} ${q("teamsOf()")}`);
ok("mtg mode 3hg: said to everyone, the sides and the numbers", /^all: \[MTG\] Host set the next games to Three-Headed Giant: White \+ Red \+ Yellow vs Green \+ Blue \+ Purple\. Each side of the table is a team of three: they share life \(120 a team in Commander, 45 in Standard\), poison \(20\)/.test(q("lastSaid()")), q("lastSaid()"));
ok("Start sends teamMode 3hg and the six teams", q("engineTeamModeSent()") === "3hg" && q("(function() local n = 0 for _ in pairs(engineTeamsSent()) do n = n + 1 end return tostring(n) end)()") === "6", `${q("engineTeamModeSent()")}`);
ok("Start sends no Juggernaut and no team turns with 3HG", q("engineJuggSent()") === null && q("engineTeamTurnsSent()") === null);
same("the Teams button's label", q("engineTeamsLabel()"), "Teams\n3HG");
q('engineChat("mtg team green 1", host)');
ok("mtg team in 3HG: refused, the teams are the sides", /In Three-Headed Giant the teams are the table's sides/.test(q("lastSaid()")) && q("teamsOf()") === SIDES, q("lastSaid()"));
q('engineSetGameMode("standard", host)');
ok("a switch to Standard keeps 3HG (either game mode)", q("ENGINE_TEAM_MODE") === "3hg" && q("teamsOf()") === SIDES && q('tostring(ENGINE_TEAM_GAME_MODE["3hg"])') === "nil", `${q("ENGINE_TEAM_MODE")} ${q('tostring(ENGINE_TEAM_GAME_MODE["3hg"])')}`);
q('engineChat("mtg mode 2v2", host)');
ok("mtg mode 2v2 after 3HG: the four-seat teams again", q("ENGINE_TEAM_MODE") === "2v2" && q("teamsOf()") === "Blue=2,Red=1,White=1,Yellow=2", q("teamsOf()"));
q('engineSetGameMode("commander", host)');
ok("a switch to Commander still drops 2v2, said", q("ENGINE_TEAM_MODE") === null && /Teams set back to None: 2v2 is played in Standard only/.test(said(q)), said(q));
function said(qq) { return qq('table.concat(said, " | ")'); }
q = freshLua();
q(`(function() ENGINE_TABLE_SEATS = ${SIX} end)()`);
same("six-seat table, Commander: the Teams button offers 3HG before none", [1, 2, 3, 4].map(() => { q('onMtgSetupTeams(nil, "Blue")'); return q("ENGINE_TEAM_MODE"); }), ["2hg", "juggernaut", "3hg", null]);
q('(function() ENGINE_GAME_MODE = "standard" end)()');
same("six-seat table, Standard: 2v2, then 3HG, then none", [1, 2, 3].map(() => { q('onMtgSetupTeams(nil, "Blue")'); return q("ENGINE_TEAM_MODE"); }), ["2v2", "3hg", null]);

console.log(`${failed ? "FAIL" : "PASS"} test_table_3hg: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
