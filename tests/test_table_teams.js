// Two-Headed Giant on the table (docs/game-modes-spec.md §5.5-5.6, Level 1; tools/engine-renderer.lua engineTeamChat,
// engineTeamHands, engineTeamTurnTag, engineWonBy / engineWinsWords): the host's "mtg mode 2hg" and "mtg team", the
// teams sent with Start, a partner's hand laid look-only in the other partner's second hand zone (and a stand-in
// dragged out snaps back, playing nothing), the phase bar's team, and the team's win. Boards are made up here in the
// bridge's shape (bridge/teams.js teamsField, bridge.js teamHandOf): Yellow and Blue seated partners against two AIs.
//   node tests/test_table_teams.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };

const cards = {
  "engine-card-501": { n: "Llanowar Elves", f: "https://example.invalid/elves.jpg", b: "", tl: "Creature — Elf Druid", ty: ["Creature"] },
  "engine-card-502": { n: "Counterspell", f: "https://example.invalid/counter.jpg", b: "", tl: "Instant", ty: ["Instant"] },
};
const full = (id) => ({ id, ...cards[id], ctl: null });
const SIDES = [["White", "Red"], ["Yellow", "Blue"]];
function board(extra = {}, rows = {}) {
  const pl = (color, slot) => ({
    color, slot, name: color === "White" ? "AI 1" : color === "Red" ? "AI 2" : color, ai: color === "White" || color === "Red", life: 30, status: "playing", pool: {},
    cmdDamage: {}, tax: [], library: 50, handCount: 1, hand: null, battlefield: [], graveyard: [], exile: [], command: [], ...(rows[color] || {}),
  });
  return JSON.stringify({ t: "table", turn: 2, step: "main1", active: "White", activeTurnNo: 1, priority: "White", gameOver: false, winner: null,
    players: [pl("White", "player-0"), pl("Red", "player-1"), pl("Yellow", "player-2"), pl("Blue", "player-3")], stack: [], cards,
    teams: { poison: 15, sides: SIDES }, ...extra });
}
// Blue holds the Elves, Yellow the Counterspell; each partner's row carries the other's look (teamHand / teamBy)
const HANDS = {
  Yellow: { hand: [{ s: 1, id: "engine-card-502", ctl: "Yellow" }], teamHand: [full("engine-card-502")], teamBy: "Blue" },
  Blue: { hand: [{ s: 1, id: "engine-card-501", ctl: "Blue" }], teamHand: [full("engine-card-501")], teamBy: "Yellow" },
};
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" },
  names: { "player-0": "AI 1", "player-1": "AI 2", "player-2": "Yellow", "player-3": "Blue" }, ai: ["White", "Red"] });
const q = (code, mark, frames) => ({ lua: code, mark, ...(frames != null ? { frames } : {}) });
const fxOf = (r, mark) => r.steps.find((s) => s.step === mark)?.fx || [];
const valueOf = (r, mark) => r.steps.find((s) => s.step === mark)?.value;
const sim = (steps) => simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps });
// where the object with that engine id lies: "<n> hand|hand2|elsewhere" for colour c's hand zones
const where = (id, c) => `local n, o = 0, nil for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then n = n + 1 o = x end end ` +
  `if o == nil then return "none" end local function inZ(i) for _, h in ipairs(Player.${c}.getHandObjects(i)) do if h == o then return true end end return false end ` +
  `return n .. " " .. (inZ(1) and "hand" or inZ(2) and "hand2" or "elsewhere")`;
const chats = (r, mark) => fxOf(r, mark).filter((l) => /broadcast/.test(l)).join(" | ");

// ── the host's commands and the start message ──
{
  const r = sim([
    q('engineChat("mtg team red 2", Player.Blue) return tostring(ENGINE_TEAMS)', "team before mode"),
    q('engineChat("mtg mode 2hg", Player.Yellow) return tostring(ENGINE_TEAMS)', "not host"),
    q('engineChat("mtg mode 2hg", Player.Blue) local t = ENGINE_TEAMS return t and (t.White .. t.Red .. t.Yellow .. t.Blue) or "nil"', "mode 2hg"),
    q('engineChat("mtg team red 2", Player.Blue) engineChat("mtg team yellow 1", Player.Blue) local t = ENGINE_TEAMS return t.White .. t.Red .. t.Yellow .. t.Blue', "moved"),
    q('engineChat("mtg team green 1", Player.Blue) return "x"', "bad colour"),
    q('engineChat("mtg team red 2", Player.Blue) engineChat("mtg team yellow 2", Player.Blue) engineStartSentAt = nil engineChat("mtg start ai 2", Player.Blue) return "started"', "start", 10),
    q('engineChat("mtg mode ffa", Player.Blue) return tostring(ENGINE_TEAMS)', "ffa"),
    q('engineStartSentAt = nil engineChat("mtg start ai 2", Player.Blue) return "again"', "start ffa", 10),
  ]);
  ok("commands: no errors", !r.errors.length, r.errors.join(" | "));
  ok("commands: a team before 2HG is refused", valueOf(r, "team before mode") === "nil" && /type  mtg mode 2hg  \(Commander\) or  mtg mode 2v2  \(Standard\) first/.test(chats(r, "team before mode")), chats(r, "team before mode"));
  ok("commands: only the host sets 2HG", valueOf(r, "not host") === "nil" && /Only the host/.test(chats(r, "not host")), chats(r, "not host"));
  ok("commands: 2hg sets the long sides, White + Red vs Yellow + Blue", valueOf(r, "mode 2hg") === "1122" && /White \+ Red vs Yellow \+ Blue/.test(chats(r, "mode 2hg")), `${valueOf(r, "mode 2hg")} ${chats(r, "mode 2hg")}`);
  ok("commands: mtg team moves one seat", valueOf(r, "moved") === "1212" && /put Yellow on team 1: White \+ Yellow vs Red \+ Blue/.test(chats(r, "moved")), `${valueOf(r, "moved")} ${chats(r, "moved")}`);
  ok("commands: an unknown colour says how", /Use:  mtg team/.test(chats(r, "bad colour")), chats(r, "bad colour"));
  const sent = (mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  ok("start: the teams go with Start", /"t":"start"/.test(sent("start")) && /"teams":\{[^}]*"Red":2/.test(sent("start")) && /"White":1/.test(sent("start")), sent("start").slice(0, 400));
  ok("commands: ffa ends it", valueOf(r, "ffa") === "nil" && /free-for-all/.test(chats(r, "ffa")), chats(r, "ffa"));
  ok("start: a free-for-all Start sends no teams", /"t":"start"/.test(sent("start ffa")) && !/"teams"/.test(sent("start ffa")), sent("start ffa").slice(0, 400));
}

// ── the partners' hands, the phase bar, the end ──
{
  const drop = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:team:Yellow:engine-card-501" then o = x end end if o == nil then return "none" end ' +
    'local m = data.Yellow.playmat.getPosition() o.setPosition(Vector(m.x, 1.5, m.z)) onObjectDrop("Yellow", o) __sim.frames(30) ' +
    'local inH = false for _, h in ipairs(Player.Yellow.getHandObjects(2)) do if h == o then inH = true end end return inH and "back" or "out"';
  const check = 'local out = {} for _, pr in ipairs(engineSelfCheck().problems or {}) do if tostring(pr):find("50[12]") or tostring(pr):find("Elves", 1, true) or tostring(pr):find("Counterspell", 1, true) then out[#out + 1] = tostring(pr) end end return #out == 0 and "none" or table.concat(out, " || ")';
  const r = sim([
    // (the stand-ins: the fallback when the TTS teams can't be set, engineTtsTeams false; the teams are checked below)
    q('engineTtsTeams = function() return false end engineAutoPace.Yellow = false engineAutoPace.Blue = false engineChat("mtg start ai 2", Player.Blue) return "ok"', "prelude"),
    { msg: { t: "started", json: STARTED } },
    { msg: { t: "table", json: board({}, HANDS) }, frames: 90 },
    q(where("engine-card-501", "Blue"), "blue's own"),
    q(where("team:Yellow:engine-card-501", "Yellow"), "yellow sees"),
    q(where("team:Blue:engine-card-502", "Blue"), "blue sees"),
    q('local n = 0 for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:team:Yellow:engine-card-501" then n = n + #(x.getDescription() or "") end end return tostring(n)', "note"),
    q('engineConcedeAsk = nil engineChat("mtg concede", Player.Blue) return "asked"', "concede ask"),
    q(check, "check"),
    // (TTS lays a hand out itself: a stand-in shifted inside the second hand zone stays where TTS put it on the next board)
    q('local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:team:Yellow:engine-card-501" then o = x end end if o == nil then return "none" end ' +
      'local p = o.getPosition() o.setPosition(Vector(p.x + 0.3, p.y, p.z)) __sim.frames(2) local inH = false for _, h in ipairs(Player.Yellow.getHandObjects(2)) do if h == o then inH = true end end ' +
      'if not inH then return "left the zone" end __fx = {} engineRender(engineTable()) __sim.frames(30) local n = 0 for _, l in ipairs(__fx) do if l:find("obj:" .. o.getGUID() .. " ", 1, true) and l:find("setPosition", 1, true) then n = n + 1 end end return tostring(n)', "relaid"),
    q('__fx = {} ' + drop, "drop", 10),
    q('engineUpdateCorner("Blue", nil) local b = tostring(UI.getValue("eng_phase_Blue")) engineUpdateCorner("Yellow", nil) return b .. " || " .. tostring(UI.getValue("eng_phase_Yellow"))', "corner white"),
    { msg: { t: "table", json: board({ active: "Blue", priority: "Blue" }, HANDS) }, frames: 30 },
    q('engineUpdateCorner("Yellow", nil) return tostring(UI.getValue("eng_phase_Yellow"))', "corner blue"),
    { msg: { t: "table", json: board({}, { Yellow: { hand: [{ s: 1, id: "engine-card-502", ctl: "Yellow" }] }, Blue: { hand: [{ s: 1, id: "engine-card-501", ctl: "Blue" }] } }) }, frames: 90 },
    q(where("team:Yellow:engine-card-501", "Yellow"), "gone"),
    q('local m = { winner = "Blue", teams = { sides = { { "White", "Red" }, { "Yellow", "Blue" } }, won = { "Yellow", "Blue" } } } ' +
      'return tostring(engineWonBy(m, "Yellow")) .. " " .. tostring(engineWonBy(m, "Blue")) .. " " .. tostring(engineWonBy(m, "White")) .. " " .. engineWinsWords(m)', "won"),
    q('local m = { winner = "Blue" } return tostring(engineWonBy(m, "Yellow")) .. " " .. tostring(engineWonBy(m, "Blue")) .. " " .. engineWinsWords(m)', "won ffa"),
  ]);
  ok("hands: no errors", !r.errors.length, r.errors.join(" | "));
  ok("hands: Blue's own card stays in Blue's hand", valueOf(r, "blue's own") === "1 hand", String(valueOf(r, "blue's own")));
  ok("hands: Yellow sees Blue's card in Yellow's second hand zone", valueOf(r, "yellow sees") === "1 hand2", String(valueOf(r, "yellow sees")));
  ok("hands: Blue sees Yellow's card in Blue's second hand zone", valueOf(r, "blue sees") === "1 hand2", String(valueOf(r, "blue sees")));
  ok("concede: the question says it is for the team", /Concede for your team \(PlayerYellow \+ PlayerBlue\)\?/.test(chats(r, "concede ask")), chats(r, "concede ask"));
  ok("hands: the stand-in says it is the partner's, look only", Number(valueOf(r, "note")) > 0, String(valueOf(r, "note")));
  ok("hands: a stand-in TTS laid out in the hand zone stays there on the next board", valueOf(r, "relaid") === "0", String(valueOf(r, "relaid")));
  ok("hands: the table check expects the stand-ins", valueOf(r, "check") === "none", String(valueOf(r, "check")));
  const sentDrop = fxOf(r, "drop").filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  ok("hands: a stand-in dragged onto the mat plays nothing and goes back", valueOf(r, "drop") === "back" && !/"kind":"play"/.test(sentDrop), `${valueOf(r, "drop")} ${sentDrop.slice(0, 200)}`);
  const corner = String(valueOf(r, "corner white"));
  ok("phase bar: the other team's turn names the team", /\(TEAM AI 1 \+ AI 2\)/.test(corner.split(" || ")[0]) && /\(TEAM AI 1 \+ AI 2\)/.test(corner.split(" || ")[1]), corner);
  ok("phase bar: your partner's turn says your team", /\(YOUR TEAM\)/.test(String(valueOf(r, "corner blue"))), String(valueOf(r, "corner blue")));
  ok("hands: no teamHand, no stand-in", valueOf(r, "gone") === "none", String(valueOf(r, "gone")));
  ok("end: both partners win; the banner names the team", valueOf(r, "won") === "true true false PLAYERYELLOW + PLAYERBLUE WIN THE GAME", String(valueOf(r, "won")));
  ok("end: free-for-all unchanged", valueOf(r, "won ffa") === "false true PLAYERBLUE WINS THE GAME", String(valueOf(r, "won ffa")));
}

// ── the partners on one TTS team (docs/2hg-shared-hand-spec.md, the user 2026-11-24): each sees the other's real hand,
// so no stand-ins; the other team's seats (AIs here, unseated) untouched; off at the game's end, a reset, and in 2v2 ──
{
  const teamsOf = (mark) => q('return Player.White.team .. " " .. Player.Red.team .. " " .. Player.Yellow.team .. " " .. Player.Blue.team', mark);
  const sides2v2 = JSON.parse(board({}, HANDS));
  sides2v2.teams = { rule: "teams", sides: SIDES };
  const r = sim([
    q('engineAutoPace.Yellow = false engineAutoPace.Blue = false engineChat("mtg start ai 2", Player.Blue) return "ok"', "prelude"),
    { msg: { t: "started", json: STARTED } },
    { msg: { t: "table", json: board({}, HANDS) }, frames: 90 },
    teamsOf("on"),
    q(where("team:Yellow:engine-card-501", "Yellow"), "no stand-in"),
    q(where("engine-card-501", "Blue"), "own card"),
    q('__fx = {} engineRender(engineTable()) __sim.frames(5) local n = 0 for _, l in ipairs(__fx) do if l:find("Player.team", 1, true) then n = n + 1 end end return tostring(n)', "again"),
    { msg: { t: "table", json: board({ gameOver: true, winner: "Blue" }, HANDS) }, frames: 30 },
    teamsOf("over"),
    { msg: { t: "table", json: board({}, HANDS) }, frames: 30 },
    q('engineCountersReset() return "reset"', "reset"),
    teamsOf("after reset"),
    { msg: { t: "table", json: JSON.stringify(sides2v2) }, frames: 30 },
    teamsOf("2v2"),
  ]);
  ok("tts teams: no errors", !r.errors.length, r.errors.join(" | "));
  ok("tts teams: the seated partners on one team, the other side's seats untouched", valueOf(r, "on") === "None None Clubs Clubs", String(valueOf(r, "on")));
  ok("tts teams: no stand-in of the partner's hand", valueOf(r, "no stand-in") === "none", String(valueOf(r, "no stand-in")));
  ok("tts teams: the partner's own card still in their hand", valueOf(r, "own card") === "1 hand", String(valueOf(r, "own card")));
  ok("tts teams: not set again on the next board", valueOf(r, "again") === "0", String(valueOf(r, "again")));
  ok("tts teams: off when the game is over", valueOf(r, "over") === "None None None None", String(valueOf(r, "over")));
  ok("tts teams: off after a reset", valueOf(r, "after reset") === "None None None None", String(valueOf(r, "after reset")));
  ok("tts teams: never in 2v2 (own-life teams keep hands private)", valueOf(r, "2v2") === "None None None None", String(valueOf(r, "2v2")));
}

console.log(`${failed ? "FAIL" : "PASS"} test_table_teams: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
