// engineBoardDiff (tools/engine-renderer.lua), the one comparison of each board with the board before it that the
// draw/mill holder and the mill stand-ins both read, on the fake TTS. The recorded games in the table golden have no
// discard beside a mill and no untap held for a seated player, so these two are pinned here.
//   node tests/test_table_board_diff.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };

// two boards for Blue: a card in hand, a tapped land, a library of 30; then the hand card discarded, two cards milled
// (library 28) and the land untapped on a new turn
const lua = `
local c = function(id, more) local t = { id = id, name = id } for k, v in pairs(more or {}) do t[k] = v end return t end
local m1 = { turn = 3, active = "Red", players = { { color = "Blue", library = 30, hand = { c("h1") }, battlefield = { c("land", { tap = true }) }, graveyard = {}, exile = {}, command = {} } } }
local m2 = { turn = 4, active = "Blue", players = { { color = "Blue", library = 28, hand = {}, battlefield = { c("land") }, graveyard = { c("h1"), c("m1"), c("m2") }, exile = {}, command = {} } } }
local out = {}
engineBoardDiff(m1)
out.first = engineBoardDiffs.Blue == nil and "none" or "some"
out.firstTapped = engineBoardSeen.Blue.tapped.land == true
engineBoardDiff(m2)
local d = engineBoardDiffs.Blue
local fresh = {}
for _, x in ipairs(d and d.fresh or {}) do fresh[#fresh + 1] = x.id end
out.drop, out.fresh, out.prevTapped, out.newTapped = d and d.drop, table.concat(fresh, ","), d and d.prev.tapped.land == true, engineBoardSeen.Blue.tapped.land == true
out.prevHand = d and d.prev.hand.h1 == true
engineBoardDiff(m2)
out.again = engineBoardNew == false and next(engineBoardDiffs) == nil
return JSON.encode(out)`;
const r = simulate({ save, steps: [{ lua, mark: "diff" }] });
ok("the script ran", !r.errors.length, r.errors.slice(0, 2).join(" | "));
const v = JSON.parse(r.steps.find((s) => s.step === "diff")?.value || "{}");
ok("the first board has nothing to compare with", v.first === "none", JSON.stringify(v));
ok("the library lost two", v.drop === 2, JSON.stringify(v));
ok("a card from the hand is not new in the graveyard: only the two milled are", v.fresh === "m1,m2", JSON.stringify(v));
ok("the board before remembers the hand", v.prevHand === true, JSON.stringify(v));
ok("a tapped land is remembered as tapped (the untap holder reads it)", v.firstTapped === true && v.prevTapped === true, JSON.stringify(v));
ok("an untapped land is not", v.newTapped === false, JSON.stringify(v));
ok("a re-render of the same board compares nothing", v.again === true, JSON.stringify(v));
console.log(failed ? `\n${failed} failed, ${passed} passed` : `all ${passed} passed`);
process.exit(failed ? 1 : 0);
