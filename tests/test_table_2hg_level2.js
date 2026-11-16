// Two-Headed Giant Level 2 on the table (shared team turns, CR 805 + 810; docs/game-modes-spec.md §5.6; tools/engine-renderer.lua
// engineMyTurn / engineTeamTurnWords / engineTurnPartners / engineTeamPriorityHint, engineTeamChat's "mtg 2hg turns"):
// the engine's protocol fixture (tests/golden/fixtures/2hg-level2-protocol.json) replayed through the bridge
// (tests/bridge-harness.js), and the boards the bridge sent played on the fake TTS (tests/lua/tts-sim.lua) with all
// four seats taken. Checked: the host's level switch and the Start it sends, the phase bar and banner say the team's
// turn to both partners and to the other team, the partner sees who of the team is deciding, combat sides are the
// team's, the ability panel's "only as a sorcery" and "not your priority" read the team, and none of it in a Level 1
// game (the same boards without the bridge's activeTeam).
//   node tests/test_table_2hg_level2.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");
const harness = require("./bridge-harness");
const FIX = require("./golden/fixtures/2hg-level2-protocol.json");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const SLOTS = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" };

// The bridge's boards for the fixture: one table message per board pair, by the fixture's record index of the pair's second board
async function bridgeBoards() {
  const h = harness.load();
  try {
    const seats = new Map();
    for (const [slot, color] of Object.entries(SLOTS)) {
      const s = new h.B.Seat(color, "neheb_minotaur_commander");
      s.slot = slot;
      s.heartbeat = () => {};
      seats.set(slot, s);
    }
    h.B._setGame({ seats: new Map([...seats.values()].map((s) => [s.color, s])), bots: 0, total: 4, playerOrder: [...seats.values()].map((s) => s.username),
      slotNames: { ...SLOTS }, slotColor: { ...SLOTS }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
    const out = {};
    for (let i = 0; i < FIX.record.length; i++) {
      const e = FIX.record[i];
      if (!e.board) continue;
      for (const slot of e.seats) seats.get(slot).board = { state: clone(e.board), fingerprint: null };
      if (!e.seats.includes("player-3")) continue;
      const n0 = h.effects.length;
      h.B.sendTable(); await h.flush();
      const m = h.effects.slice(n0).filter((x) => x.tts?.t === "table").map((x) => x.tts).pop();
      if (m) out[i] = m;
    }
    return out;
  } finally { harness.restore(); }
}

const STARTED = JSON.stringify({ t: "started", colors: { ...SLOTS }, names: { ...SLOTS }, ai: [] });
const q = (code, mark, frames) => ({ lua: code, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => r.steps.find((s) => s.step === mark)?.value;
const fxOf = (r, mark) => r.steps.find((s) => s.step === mark)?.fx || [];
const chatsOf = (r, mark) => fxOf(r, mark).filter((l) => /broadcast/.test(l)).join(" | ");
const sim = (steps) => simulate({ save, seated: ["White", "Red", "Yellow", "Blue"], host: "White", steps });
const board = (m) => ({ msg: { t: "table", json: JSON.stringify(m) }, frames: 30 });
// (the fake TTS names each seated player Player<colour>)
// the phase bar and hint line of each colour, "White=...||Red=...": the corner redrawn with no question open
const corners = 'local out = {} for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do enginePrompts[c] = nil engineUpdateCorner(c, nil) '
  + 'out[#out + 1] = c .. "=" .. tostring(UI.getValue("eng_phase_" .. c)) .. " ## " .. tostring(UI.getValue("eng_hint_" .. c)) end return table.concat(out, "||")';
const cornerOf = (s, c) => (String(s).split("||").find((x) => x.startsWith(`${c}=`)) || "").slice(c.length + 1);
// a Level 1 copy of a bridge board: what the bridge sends in a "sharedLife" game (no activeTeam, no shared turns)
const level1 = (m) => { const x = clone(m); delete x.activeTeam; if (x.teams) delete x.teams.turns; return x; };

(async () => {
  const B = await bridgeBoards();
  ok("precondition: the bridge sent the shared-turn boards", B[2]?.activeTeam && B[25]?.activeTeam && B[62], JSON.stringify(Object.keys(B)));

  // ── the host's level switch and the Start it sends ──
  {
    const r = sim([
      q('engineChat("mtg 2hg turns own", Player.Red) return tostring(ENGINE_TEAM_TURNS)', "not host"),
      q('engineChat("mtg mode 2hg", Player.White) engineChat("mtg 2hg turns shared", Player.White) return tostring(ENGINE_TEAM_TURNS) .. " " .. engineTeamsLabel()', "shared"),
      q('engineChat("mtg 2hg turns", Player.White) return "x"', "ask"),
      q('engineStartSentAt = nil engineChat("mtg start", Player.White) return "started"', "start", 10),
      q('engineChat("mtg mode standard", Player.White) engineChat("mtg mode 2v2", Player.White) engineStartSentAt = nil engineChat("mtg start", Player.White) return tostring(engineTeamTurnsSent())', "start 2v2", 10),
      q('engineChat("mtg mode commander", Player.White) engineChat("mtg mode 2hg", Player.White) engineChat("mtg 2hg turns own", Player.White) engineStartSentAt = nil engineChat("mtg start", Player.White) return tostring(ENGINE_TEAM_TURNS)', "own", 10),
    ]);
    const sent = (mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
    ok("level: no errors", !r.errors.length, r.errors.join(" | "));
    ok("level: only the host sets it", valueOf(r, "not host") === "nil" && /Only the host/.test(chatsOf(r, "not host")), `${valueOf(r, "not host")} ${chatsOf(r, "not host")}`);
    ok("level: mtg 2hg turns shared sets one turn for each team", valueOf(r, "shared") === "shared Teams\n2HG team turns" && /one turn for each team: partners take their turn together/.test(chatsOf(r, "shared")), `${valueOf(r, "shared")} ${chatsOf(r, "shared")}`);
    ok("level: mtg 2hg turns alone says the setting and how", /Two-Headed Giant turns: one turn for each team\. Use:  mtg 2hg turns shared/.test(chatsOf(r, "ask")), chatsOf(r, "ask"));
    ok("level: the Start carries teamTurns shared with the 2HG teams", /"t":"start"/.test(sent("start")) && /"teamTurns":"shared"/.test(sent("start")) && /"teamMode":"2hg"/.test(sent("start")), sent("start").slice(0, 500));
    ok("level: a 2v2 Start sends no teamTurns", valueOf(r, "start 2v2") === "nil" && !/"teamTurns"/.test(sent("start 2v2")), `${valueOf(r, "start 2v2")} ${sent("start 2v2").slice(0, 300)}`);
    ok("level: mtg 2hg turns own goes back to own turns, and its Start sends none", valueOf(r, "own") === "nil" && !/"teamTurns"/.test(sent("own")), `${valueOf(r, "own")} ${sent("own").slice(0, 300)}`);
  }

  // ── the boards: whose turn, who is deciding, combat sides, the ability panel ──
  const combat = (tbl) => `local t = JSON.decode(${JSON.stringify(JSON.stringify(tbl))}) local out = {} for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do `
    + 'out[#out + 1] = c .. "=" .. tostring(engineCombatSide(c, t)) end return table.concat(out, " ")';
  // (the Bears attack Yellow and the Juggernaut Blue: with the Bears taken out only Blue is attacked, and Yellow still
  // defends, the attack being at her team)
  const juggOnly = (m) => { const x = clone(m); for (const p of x.players) for (const c of p.battlefield || []) if (c.id === "engine-card-29") { delete c.atk; delete c.atkT; } return x; };
  const why = 'local a = { eff = "Draw a card. Activate only as a sorcery." } '
    + 'return tostring(engineAbWhy("Red", nil, a, nil, false)) .. " ## " .. tostring(engineAbWhy("Red", nil, a, {}, true)) .. " ## " .. tostring(engineAbWhy("Yellow", nil, a, {}, true))';
  const steps = (L1) => {
    const f = (m) => (L1 ? level1(m) : m);
    return [
      q("engineAutoPace.White = false engineAutoPace.Red = false engineAutoPace.Yellow = false engineAutoPace.Blue = false return 'ok'", "prelude"),
      { msg: { t: "started", json: STARTED } },
      board(f(B[2])),
      q(corners, "turn 1 upkeep"),
      board(f(B[4])), board(f(B[8])), board(f(B[14])),
      q(corners, "red has priority"),
      q(why.replace("return", "local tt = engineTable() tt.step = \"main1\" tt.priority = \"Red\" tt.stack = {} return"), "why red"),
      q(why.replace("return", "engineTable().priority = \"White\" return"), "why white deciding"),
      board(f(B[25])), board(f(B[27])),
      q('return tostring(UI.getValue("eng_banner_Blue")) .. " ## " .. tostring(UI.getValue("eng_banner_White"))', "banner turn 2"),
      q(corners, "turn 2"),
      board(f(B[48])),
      // (White is asked her part of the team's attack: Red's line says so, docs/2hg-level2-combat.md)
      { msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "White", promptId: 19, kind: "attack", title: "Choose attackers", mode: "multi", min: 0, max: 2,
        options: [{ id: "__allattack", label: "All attack" }, { id: "engine-card-29|player-2", label: "Grizzly Bears → Yellow" }] }) }, frames: 10 },
      q('engineUpdateCorner("Red", nil) return tostring(UI.getValue("eng_hint_Red"))', "red while white declares"),
      q('enginePrompts.White = nil return "ok"', "clear white"),
      board(f(B[62])),
      q(combat(f(B[62])), "combat"),
      q(combat(juggOnly(f(B[62]))), "combat jugg only"),
      q('return tostring(engineMyTurn(engineTable(), "Red")) .. " " .. tostring(engineMyTurn(engineTable(), "White")) .. " " .. tostring(engineMyTurn(engineTable(), "Blue"))', "my turn"),
    ];
  };
  const r = sim(steps(false));
  ok("boards: no errors", !r.errors.length, r.errors.join(" | "));
  const c1 = valueOf(r, "turn 1 upkeep");
  ok("phase bar: the active player sees the team's turn", /YOUR TEAM'S TURN/.test(cornerOf(c1, "White")), cornerOf(c1, "White"));
  ok("phase bar: the partner sees it as her turn too", /YOUR TEAM'S TURN/.test(cornerOf(c1, "Red")) && !/WHITE'S TURN/.test(cornerOf(c1, "Red")), cornerOf(c1, "Red"));
  ok("phase bar: the other team sees the team's turn", /TEAM PLAYERWHITE \+ PLAYERRED'S TURN/.test(cornerOf(c1, "Yellow")) && /TEAM PLAYERWHITE \+ PLAYERRED'S TURN/.test(cornerOf(c1, "Blue")), cornerOf(c1, "Yellow"));
  ok("priority: the partner sees who of the team is deciding", /## Team PlayerWhite \+ PlayerRed has priority: PlayerWhite is deciding$/.test(cornerOf(c1, "Red")), cornerOf(c1, "Red"));
  ok("priority: the other team waits for the team", /## Waiting for Team PlayerWhite \+ PlayerRed \(PlayerWhite is deciding\)\.\.\.$/.test(cornerOf(c1, "Yellow")), cornerOf(c1, "Yellow"));
  const c2 = valueOf(r, "red has priority");
  ok("priority: when the partner decides, the lead sees it", /## Team PlayerWhite \+ PlayerRed has priority: PlayerRed is deciding$/.test(cornerOf(c2, "White")), cornerOf(c2, "White"));
  const w1 = String(valueOf(r, "why red")).split(" ## ");
  ok("ability panel: the partner's sorcery-speed ability is not 'only as a sorcery' in the team's main phase", w1[1] && !/Only as a sorcery/.test(w1[1]), w1.join(" | "));
  ok("ability panel: the other team's still is", /Only as a sorcery/.test(w1[2] || ""), w1.join(" | "));
  const w2 = String(valueOf(r, "why white deciding")).split(" ## ");
  ok("ability panel: 'not your priority' names the partner deciding", w2[0] === "Not your priority yet (your partner PlayerWhite is deciding)", w2[0]);
  const ban = String(valueOf(r, "banner turn 2")).split(" ## ");
  ok("banner: the new turn is the team's, to both teams", ban[0] === "YOUR TEAM'S TURN" && ban[1] === "TEAM PLAYERYELLOW + PLAYERBLUE'S TURN", ban.join(" | "));
  const c3 = valueOf(r, "turn 2");
  ok("phase bar: turn 2 is Yellow + PlayerBlue's, Blue (not the lead) on her turn", /YOUR TEAM'S TURN/.test(cornerOf(c3, "Blue")) && /TEAM PLAYERYELLOW \+ PLAYERBLUE'S TURN/.test(cornerOf(c3, "Red")), `${cornerOf(c3, "Blue")} || ${cornerOf(c3, "Red")}`);
  ok("combat: the partner sees who is declaring the team's attack", valueOf(r, "red while white declares") === "PlayerWhite is declaring attackers for your team...", String(valueOf(r, "red while white declares")));
  ok("combat: both partners attack, both defenders block", valueOf(r, "combat") === "White=attack Red=attack Yellow=block Blue=block", String(valueOf(r, "combat")));
  ok("combat: an attack at the partner is the whole team's to block", valueOf(r, "combat jugg only") === "White=attack Red=attack Yellow=block Blue=block", String(valueOf(r, "combat jugg only")));
  ok("turn: the team's turn is both partners', not the other team's", valueOf(r, "my turn") === "true true false", String(valueOf(r, "my turn")));

  // ── the same boards as a Level 1 game: as before ──
  const r1 = sim(steps(true));
  ok("level 1: no errors", !r1.errors.length, r1.errors.join(" | "));
  const d1 = valueOf(r1, "turn 1 upkeep");
  ok("level 1: the partner sees the active player's turn with the team tag", /WHITE'S TURN/.test(cornerOf(d1, "Red")) && /\(YOUR TEAM\)/.test(cornerOf(d1, "Red")) && !/YOUR TEAM'S TURN/.test(cornerOf(d1, "Red")), cornerOf(d1, "Red"));
  ok("level 1: waiting is for the one player", /## Waiting for PlayerWhite\.\.\.$/.test(cornerOf(d1, "Red")), cornerOf(d1, "Red"));
  ok("level 1: the partner's sorcery-speed ability waits for her own turn", /Only as a sorcery/.test(String(valueOf(r1, "why red")).split(" ## ")[1] || ""), String(valueOf(r1, "why red")));
  ok("level 1: no team declaring line", !/declaring attackers/.test(String(valueOf(r1, "red while white declares"))), String(valueOf(r1, "red while white declares")));
  ok("level 1: the partner's turn is not hers", valueOf(r1, "my turn") === "false true false", String(valueOf(r1, "my turn")));
  ok("level 1: an attack at the partner alone is not the other partner's to block", valueOf(r1, "combat jugg only") === "White=attack Red=nil Yellow=nil Blue=block", String(valueOf(r1, "combat jugg only")));

  console.log(`${failed ? "FAIL" : "PASS"} test_table_2hg_level2: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_table_2hg_level2: ${e.stack}`); process.exit(1); });
