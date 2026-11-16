// "mtg clear deck" (tools/engine-renderer.lua engineClearDeck, make-engine-copy.js engineChat), on the fake TTS: a
// seated player's own deck on their library spot and the cards on their commander spots are removed by the script;
// another seat's deck, an engine card and the Identity cards stay; refused during an engine game; a wrong word gets
// the usage. (The user, 2026-11-13: "players still can't delete their decks before a game starts".)
//   node tests/test_table_clear_deck.js
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark) => ({ lua, mark });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const told = (r, mark) => ((r.steps.find((s) => s.step === mark) || {}).fx || []).filter((l) => /broadcast/.test(l)).join(" | ");

// (the commander zones: the 4-player table's profile, TABLE_PROFILE.tax in the built script)
const PROFILE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tools", "profiles", "2296042369.json"), "utf8"));
const taxOf = (c) => PROFILE.seat[c].commandZones[0].guid;

// a deck on each of White's and Blue's library spots, a card on White's first commander spot, an engine card and an
// Identity card there too; returns their GUIDs as a Lua table __t
const setup = `__t = {}
local function card(name, gm, pos)
  local o = spawnObjectData({ data = { Name = "Card", Nickname = name, GMNotes = gm or "", CardID = 100, CustomDeck = { ["1"] = { FaceURL = "f", BackURL = "b", NumWidth = 1, NumHeight = 1 } },
    Transform = { posX = pos.x, posY = pos.y, posZ = pos.z, rotX = 0, rotY = 0, rotZ = 0, scaleX = 1, scaleY = 1, scaleZ = 1 } }, position = pos })
  return o
end
local function deck(color)
  local z = data[color].libraryZone.getPosition()
  local o = spawnObjectData({ data = { Name = "Deck", Nickname = color .. " deck", DeckIDs = { 100, 101 }, CustomDeck = { ["1"] = { FaceURL = "f", BackURL = "b", NumWidth = 1, NumHeight = 1 } },
    ContainedObjects = {}, Transform = { posX = z.x, posY = z.y, posZ = z.z, rotX = 0, rotY = 0, rotZ = 180, scaleX = 1, scaleY = 1, scaleZ = 1 } }, position = z })
  return o
end
__t.white = deck("White")
__t.blue = deck("Blue")
local a = getObjectFromGUID("${taxOf("White")}").getPosition()
__t.cmdr = card("Thantis", nil, Vector(a.x, a.y + 0.5, a.z))
__t.eng = card("Engine card", "engine:c1", Vector(a.x + 0.5, a.y + 0.5, a.z))
__t.ident = card("Identity W", nil, Vector(a.x - 0.5, a.y + 0.5, a.z))
return "ok"`;
const alive = (mark) => q(`local s = {} for _, k in ipairs({ "white", "blue", "cmdr", "eng", "ident" }) do s[#s + 1] = k .. "=" .. tostring(__t[k] ~= nil and not __t[k].isDestroyed()) end return table.concat(s, ",")`, mark);

const r = simulate({ save: buildSave(), seated: ["Blue", "White"], host: "Blue", steps: [
  q(setup, "setup"), alive("before"),
  q('return tostring(engineChat("mtg clear", Player.White))', "no word"), alive("after no word"),
  q('local real = engineTable engineTable = function() return {} end engineChat("mtg clear deck", Player.White) engineTable = real return "ok"', "in game"), alive("after in game"),
  q('return tostring(engineChat("mtg clear deck", Player.White))', "white clears"), alive("after white"),
  q('engineChat("mtg clear deck", Player.White) return "ok"', "again"),
] });

ok("clear deck: the script ran", !r.errors.length, r.errors.slice(0, 2).join(" | "));
ok("clear deck: everything there to begin with", valueOf(r, "before") === "white=true,blue=true,cmdr=true,eng=true,ident=true", valueOf(r, "before"));
ok("clear deck: 'mtg clear' alone gives the usage and removes nothing", /mtg clear deck/.test(told(r, "no word")) && valueOf(r, "after no word") === valueOf(r, "before"), told(r, "no word") + " / " + valueOf(r, "after no word"));
ok("clear deck: refused during an engine game", /Not during a game/.test(told(r, "in game")) && valueOf(r, "after in game") === valueOf(r, "before"), told(r, "in game") + " / " + valueOf(r, "after in game"));
ok("clear deck: White's deck and commander gone; Blue's deck, the engine card and the Identity card stay", valueOf(r, "after white") === "white=false,blue=true,cmdr=false,eng=true,ident=true", valueOf(r, "after white"));
ok("clear deck: White is told how many were removed", /Removed your deck and commander \(2 objects\)/.test(told(r, "white clears")), told(r, "white clears"));
ok("clear deck: a second time says there is nothing", /No deck or commander on your seat/.test(told(r, "again")), told(r, "again"));

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
