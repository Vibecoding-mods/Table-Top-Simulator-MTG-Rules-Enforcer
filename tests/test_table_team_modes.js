// 2v2 (Standard only) and Juggernaut (Commander only) on the table (docs/game-modes-spec.md §4.1, §6; tools/engine-renderer.lua
// engineTeamChat, engineTeamsLabel / onMtgSetupTeams, engineTeamTurnTag, engineWinsWords, engineTeamLooks;
// make-engine-copy.js's Start and concede): the host's "mtg mode 2v2|juggernaut" and "mtg juggernaut ...", what Start
// sends, the Teams button on the setup tile, the phase bar's Juggernaut, a lone winner's banner, a 2v2 concede that is
// the player's own, and the team tint without Two-Headed Giant's team life panel. Boards in the bridge's shape
// (bridge/teams.js teamsField, rule "teams").
//   node tests/test_table_team_modes.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };

function board(teams, extra = {}) {
  const pl = (color, slot) => ({
    color, slot, name: color === "White" || color === "Red" ? `AI ${color}` : color, ai: color === "White" || color === "Red", life: 40, status: "playing", pool: {},
    cmdDamage: {}, tax: [], library: 50, handCount: 1, hand: null, battlefield: [], graveyard: [], exile: [], command: [],
  });
  return JSON.stringify({ t: "table", turn: 2, step: "main1", active: "White", activeTurnNo: 1, priority: "White", gameOver: false, winner: null,
    players: [pl("White", "player-0"), pl("Red", "player-1"), pl("Yellow", "player-2"), pl("Blue", "player-3")], stack: [], cards: {}, teams, ...extra });
}
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" },
  names: { "player-0": "AI White", "player-1": "AI Red", "player-2": "Yellow", "player-3": "Blue" }, ai: ["White", "Red"] });
const q = (code, mark, frames) => ({ lua: code, mark, ...(frames != null ? { frames } : {}) });
const fxOf = (r, mark) => r.steps.find((s) => s.step === mark)?.fx || [];
const valueOf = (r, mark) => r.steps.find((s) => s.step === mark)?.value;
const sim = (steps) => simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps });
const chats = (r, mark) => fxOf(r, mark).filter((l) => /broadcast/.test(l)).join(" | ");
const sent = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
const T = 'local t = ENGINE_TEAMS return t and (t.White .. t.Red .. t.Yellow .. t.Blue) .. " " .. tostring(ENGINE_TEAM_MODE) or "nil"';
const label = 'local tile for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then tile = o end end local out = "none" ' +
  'for _, b in ipairs((tile and tile.getButtons()) or {}) do if b.click_function == "onMtgSetupTeams" then out = b.label end end return out';

// ── the host's commands, the button and Start ──
{
  const r = sim([
    q('setEngineMode(true) return "on"', "engine on", 30),
    q(label, "button none"),
    q('engineChat("mtg mode 2v2", Player.Yellow) ' + T, "not host"),
    q('engineChat("mtg mode 2v2", Player.Blue) ' + T, "2v2 in commander", 5),
    q('engineChat("mtg mode standard", Player.Blue) engineChat("mtg mode 2v2", Player.Blue) ' + T, "2v2", 5),
    q(label, "button 2v2"),
    q('engineChat("mtg team red 2", Player.Blue) engineChat("mtg team yellow 1", Player.Blue) ' + T, "2v2 moved"),
    q('engineStartSentAt = nil engineChat("mtg start ai 2", Player.Blue) return "started"', "start 2v2", 10),
    q('engineChat("mtg juggernaut blue", Player.Blue) engineChat("mtg juggernaut cmd 42", Player.Blue) engineChat("mtg juggernaut order after", Player.Blue) ' +
      'engineChat("mtg juggernaut land 1", Player.Blue) engineChat("mtg juggernaut life 70", Player.Blue) ' + T, "settings before"),
    q('engineChat("mtg juggernaut cmd 30", Player.Blue) engineChat("mtg juggernaut hand 99", Player.Blue) return ENGINE_JUGG.cmd .. " " .. ENGINE_JUGG.hand', "bad settings"),
    q('engineChat("mtg mode juggernaut", Player.Blue) ' + T, "jugg in standard", 5),
    q('engineChat("mtg mode 2hg", Player.Blue) ' + T, "2hg in standard", 5),
    q('engineChat("mtg mode commander", Player.Blue) ' + T, "standard to commander", 5),
    q('engineChat("mtg mode juggernaut", Player.Blue) ' + T, "juggernaut", 5),
    q(label, "button jugg"),
    q('engineChat("mtg team red 1", Player.Blue) ' + T, "team in jugg"),
    q('engineChat("mtg juggernaut yellow", Player.Blue) ' + T, "jugg moved"),
    q('engineStartSentAt = nil engineChat("mtg start ai 2", Player.Blue) return "started"', "start jugg", 10),
    q('onMtgSetupTeams(nil, "Blue") ' + T, "click to ffa", 5),
    q('onMtgSetupTeams(nil, "Blue") ' + T, "click to 2hg", 5),
    q('onMtgSetupTeams(nil, "Blue") ' + T, "click to jugg", 5),
    q('onMtgSetupTeams(nil, "Yellow") ' + T, "click not host", 5),
    q('onMtgSetupTeams(nil, "Blue") onMtgSetupTeams(nil, "Blue") ' + T, "click jugg to 2hg", 5),
    q('engineChat("mtg mode standard", Player.Blue) ' + T, "commander to standard", 5),
    q('onMtgSetupTeams(nil, "Blue") ' + T, "std click to 2v2", 5),
    q('onMtgSetupTeams(nil, "Blue") ' + T, "std click to ffa", 5),
    q('engineChat("mtg mode commander", Player.Blue) ' + T, "ffa to commander", 5),
  ]);
  ok("commands: no errors", !r.errors.length, r.errors.join(" | "));
  ok("commands: the Teams button on the setup tile, None at first", valueOf(r, "button none") === "Teams\nNone", JSON.stringify(valueOf(r, "button none")));
  ok("commands: only the host sets a team mode", valueOf(r, "not host") === "nil" && /Only the host/.test(chats(r, "not host")), chats(r, "not host"));
  ok("modes: 2v2 is refused in Commander, saying Standard allows it", valueOf(r, "2v2 in commander") === "nil" && /2v2 is played in Standard only, and the game mode is Commander\. Switch with  mtg mode standard/.test(chats(r, "2v2 in commander")), `${valueOf(r, "2v2 in commander")} ${chats(r, "2v2 in commander")}`);
  ok("commands: 2v2 sets the long sides and says what it is", valueOf(r, "2v2") === "1122 2v2" && /2v2: White \+ Red vs Yellow \+ Blue\. Standard decks; each player has their own life \(20\)/.test(chats(r, "2v2")), `${valueOf(r, "2v2")} ${chats(r, "2v2")}`);
  ok("commands: the button follows the mode (2v2)", valueOf(r, "button 2v2") === "Teams\n2v2", JSON.stringify(valueOf(r, "button 2v2")));
  ok("commands: mtg team moves a seat in 2v2", valueOf(r, "2v2 moved") === "1212 2v2", String(valueOf(r, "2v2 moved")));
  const s2 = sent(r, "start 2v2");
  ok("start 2v2: the teams, the mode and Standard go with Start, no Juggernaut", /"t":"start"/.test(s2) && /"teamMode":"2v2"/.test(s2) && /"mode":"standard"/.test(s2) && /"Red":2/.test(s2) && !/"juggernaut"/.test(s2), s2.slice(0, 500));
  ok("commands: Juggernaut settings kept outside Juggernaut, with a note", valueOf(r, "settings before") === "1212 2v2" && /set the Juggernaut: Blue: 70 life, 10 cards, 1 extra card each draw step, 1 extra land play, out at 42 commander damage, a turn after every challenger's\. \(for Juggernaut games/.test(chats(r, "settings before")), chats(r, "settings before"));
  ok("commands: a bad setting is refused and says how", valueOf(r, "bad settings") === "42 10" && /Use:  mtg juggernaut/.test(chats(r, "bad settings")), `${valueOf(r, "bad settings")} ${chats(r, "bad settings")}`);
  ok("modes: Juggernaut is refused in Standard, saying Commander allows it", valueOf(r, "jugg in standard") === "1212 2v2" && /Juggernaut is played in Commander only, and the game mode is Standard\. Switch with  mtg mode commander/.test(chats(r, "jugg in standard")), chats(r, "jugg in standard"));
  ok("modes: Two-Headed Giant is refused in Standard", valueOf(r, "2hg in standard") === "1212 2v2" && /Two-Headed Giant is played in Commander only/.test(chats(r, "2hg in standard")), chats(r, "2hg in standard"));
  ok("modes: Standard to Commander drops 2v2 and says so", valueOf(r, "standard to commander") === "nil" && /Teams set back to None: 2v2 is played in Standard only, not Commander\./.test(chats(r, "standard to commander")), `${valueOf(r, "standard to commander")} ${chats(r, "standard to commander")}`);
  ok("commands: Juggernaut puts the Juggernaut alone against the three", valueOf(r, "juggernaut") === "2221 juggernaut" && /Juggernaut: Blue \(Juggernaut\) vs White \+ Red \+ Yellow/.test(chats(r, "juggernaut")), `${valueOf(r, "juggernaut")} ${chats(r, "juggernaut")}`);
  ok("commands: the button names the Juggernaut", valueOf(r, "button jugg") === "Juggernaut\nBlue", JSON.stringify(valueOf(r, "button jugg")));
  ok("commands: mtg team is refused in Juggernaut", valueOf(r, "team in jugg") === "2221 juggernaut" && /teams follow the Juggernaut/.test(chats(r, "team in jugg")), chats(r, "team in jugg"));
  ok("commands: mtg juggernaut <colour> moves the Juggernaut and the teams", valueOf(r, "jugg moved") === "2212 juggernaut", String(valueOf(r, "jugg moved")));
  const sj = sent(r, "start jugg");
  ok("start juggernaut: the mode and the settings go with Start", /"teamMode":"juggernaut"/.test(sj) && /"juggernaut":\{/.test(sj) && /"color":"Yellow"/.test(sj) && /"cmd":42/.test(sj) && /"order":"after"/.test(sj) && /"life":70/.test(sj) && /"land":1/.test(sj), sj.slice(0, 600));
  ok("button: Juggernaut -> free-for-all", valueOf(r, "click to ffa") === "nil", String(valueOf(r, "click to ffa")));
  ok("button: free-for-all -> Two-Headed Giant", valueOf(r, "click to 2hg") === "1122 2hg", String(valueOf(r, "click to 2hg")));
  ok("button (Commander): Two-Headed Giant -> Juggernaut, no 2v2", valueOf(r, "click to jugg") === "2212 juggernaut", String(valueOf(r, "click to jugg")));
  ok("button (Commander): Juggernaut -> free-for-all -> Two-Headed Giant", valueOf(r, "click jugg to 2hg") === "1122 2hg", String(valueOf(r, "click jugg to 2hg")));
  ok("modes: Commander to Standard drops Two-Headed Giant and says so", valueOf(r, "commander to standard") === "nil" && /Teams set back to None: Two-Headed Giant is played in Commander only, not Standard\./.test(chats(r, "commander to standard")), `${valueOf(r, "commander to standard")} ${chats(r, "commander to standard")}`);
  ok("button (Standard): free-for-all -> 2v2", valueOf(r, "std click to 2v2") === "1122 2v2", String(valueOf(r, "std click to 2v2")));
  ok("button (Standard): 2v2 -> free-for-all, no Two-Headed Giant or Juggernaut", valueOf(r, "std click to ffa") === "nil", String(valueOf(r, "std click to ffa")));
  ok("modes: a game-mode switch with no teams says nothing about teams", !/Teams set back/.test(chats(r, "ffa to commander")) && /set the format: Casual Commander/.test(chats(r, "ffa to commander")), chats(r, "ffa to commander"));
  ok("button: only the host", valueOf(r, "click not host") === "2212 juggernaut" && /Only the host/.test(chats(r, "click not host")), chats(r, "click not host"));
}

// ── a running game: the phase bar, the concede question, the end, the tint ──
{
  const JUGG = { rule: "teams", mode: "juggernaut", sides: [["White", "Red", "Yellow"], ["Blue"]], juggernaut: "Blue" };
  const V2 = { rule: "teams", mode: "2v2", sides: [["White", "Yellow"], ["Red", "Blue"]] };
  const lines = 'local out = {} for _, l in ipairs(Global.getVectorLines() or {}) do if engineTeamTL.isLine(l) then out[#out + 1] = string.format("%.2f", l.color[1]) end end table.sort(out) return #out .. " " .. table.concat(out, ",")';
  const panels = 'local n = 0 for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do for _, b in ipairs(data[c].playmat.getButtons() or {}) do if b.click_function == "engineTeamNoop" then n = n + 1 end end end return tostring(n)';
  const r = sim([
    q('setEngineMode(true) engineAutoPace.Yellow = false engineAutoPace.Blue = false engineChat("mtg start ai 2", Player.Blue) return "ok"', "prelude"),
    { msg: { t: "started", json: STARTED } },
    { msg: { t: "table", json: board(JUGG, { active: "Blue", priority: "Blue" }) }, frames: 60 },
    q('engineUpdateCorner("Blue", nil) local b = tostring(UI.getValue("eng_phase_Blue")) engineUpdateCorner("Yellow", nil) return b .. " || " .. tostring(UI.getValue("eng_phase_Yellow"))', "corner jugg"),
    q(lines, "jugg lines"),
    q(panels, "jugg panels"),
    { msg: { t: "table", json: board(V2) }, frames: 60 },
    q(lines, "2v2 lines"),
    q(panels, "2v2 panels"),
    q('engineUpdateCorner("Yellow", nil) return tostring(UI.getValue("eng_phase_Yellow"))', "corner 2v2"),
    q('engineUpdateCorner("Red", nil) return tostring(UI.getValue("eng_phase_Red"))', "corner 2v2 other team"),
    q('engineConcedeAsk = nil engineChat("mtg concede", Player.Blue) return "asked"', "concede ask"),
    q('local m = { winner = "Blue", teams = { rule = "teams", sides = { { "White", "Red", "Yellow" }, { "Blue" } }, won = { "Blue" } } } ' +
      'return tostring(engineWonBy(m, "Blue")) .. " " .. tostring(engineWonBy(m, "Yellow")) .. " " .. engineWinsWords(m) .. " | " .. string.upper(engineNameOf("Blue"))', "jugg won"),
    q('local m = { winner = "Red", teams = { rule = "teams", sides = { { "White", "Red", "Yellow" }, { "Blue" } }, won = { "White", "Red", "Yellow" } } } ' +
      'return tostring(engineWonBy(m, "Yellow")) .. " " .. tostring(engineWonBy(m, "Blue")) .. " " .. engineWinsWords(m) .. " | " .. string.upper(engineNameOf("White") .. " + " .. engineNameOf("Red") .. " + " .. engineNameOf("Yellow"))', "three won"),
    { msg: { t: "table", json: board(undefined) }, frames: 30 },
    q(lines, "ffa lines"),
  ]);
  ok("game: no errors", !r.errors.length, r.errors.join(" | "));
  const corner = String(valueOf(r, "corner jugg"));
  ok("phase bar: the Juggernaut's turn", /\(YOU, THE JUGGERNAUT\)/.test(corner.split(" || ")[0]) && /\(JUGGERNAUT\)/.test(corner.split(" || ")[1]) && !/YOU, THE/.test(corner.split(" || ")[1]), corner);
  ok("tint juggernaut: a line round all four mats, the Juggernaut's gold (1.00) once, the three's", valueOf(r, "jugg lines") === "4 0.25,0.25,0.25,1.00", String(valueOf(r, "jugg lines")));
  ok("tint juggernaut: no team life panel", valueOf(r, "jugg panels") === "0", String(valueOf(r, "jugg panels")));
  ok("tint 2v2: a line round all four mats in the two teams' colours", valueOf(r, "2v2 lines") === "4 0.25,0.25,0.80,0.80", String(valueOf(r, "2v2 lines")));
  ok("tint 2v2: no team life panel (each player has their own life)", valueOf(r, "2v2 panels") === "0", String(valueOf(r, "2v2 panels")));
  ok("phase bar 2v2: the other team's turn names the team", /\(TEAM AI WHITE \+ PLAYERYELLOW\)|\(YOUR TEAM\)/.test(String(valueOf(r, "corner 2v2"))), String(valueOf(r, "corner 2v2")));
  // (Yellow is White's teammate, so that one says YOUR TEAM; Red is on the other side and must see the team named)
  ok("phase bar 2v2: a viewer on the other team sees the team named, not YOUR TEAM", /\(TEAM [^)]+\)/.test(String(valueOf(r, "corner 2v2 other team"))) && !/YOUR TEAM/.test(String(valueOf(r, "corner 2v2 other team"))), String(valueOf(r, "corner 2v2 other team")));
  ok("concede 2v2: the player's own, not the team's", /Concede the game\? You are out for good/.test(chats(r, "concede ask")) && !/for your team/.test(chats(r, "concede ask")), chats(r, "concede ask"));
  ok("end: the Juggernaut alone WINS", /^true false (.+) WINS THE GAME \| \1$/.test(String(valueOf(r, "jugg won"))), String(valueOf(r, "jugg won")));
  ok("end: the three WIN together", /^true false (.+) WIN THE GAME \| \1$/.test(String(valueOf(r, "three won"))), String(valueOf(r, "three won")));
  ok("tint: gone in a free-for-all board", valueOf(r, "ffa lines") === "0 ", JSON.stringify(valueOf(r, "ffa lines")));
}

console.log(`${failed ? "FAIL" : "PASS"} test_table_team_modes: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
