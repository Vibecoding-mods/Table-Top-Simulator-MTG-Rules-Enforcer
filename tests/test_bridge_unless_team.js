// "Unless you pay" questions in team games (Two-Headed Giant Level 1 and 2, 2v2 / Teams): whose question is a tax the
// Taxes setting may answer (bridge.js taxAnswer; the tax mark in the chooseBoolean case, teammateOf).
//  - an opponent's (Rhystic Tutor's "Unless any player pays {2}", Smothering Tithe's "Pay {2}?"): another player's tax,
//    answered by the setting as in a free-for-all
//  - a teammate's (the partner's Rhystic Tutor asks every player, the partner too): never a tax. Always pay would
//    otherwise pay {2} to stop the partner's own tutor; it is shown and asked
//  - your own (Mystic Remora's upkeep): shown, as before
//  - outside a team game the same player's card is an opponent's: a tax, as before
// The questions are the engine's own shape: ManaBrewInteractiveController.payCostToPreventEffect -> title from
// describePayCost ("Pay {2}?"), text `otherwise: "<stack description>"`, Pay / Decline (ManaBrewInteractiveSession
// publishBooleanPrompt); the card texts are Forge's scripts (cardsfolder rhystic_tutor.txt: UnlessPayer$ Player, so
// every player is asked; smothering_tithe, mystic_remora); Rhystic Tutor's otherwise is ChangeZoneEffect's hidden-origin
// stack description ("<name> searches their library for a card, puts it into their hand, then shuffles.").
//   node tests/test_bridge_unless_team.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };

const TUTOR = "Unless any player pays {2}, search your library for a card, put that card into your hand, then shuffle.";
const TITHE = "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.";
const REMORA = "At the beginning of your upkeep, sacrifice Mystic Remora unless you pay {1}.";
const USERS = ["tts-Blue-ab12", "tts-Red-cd34", "tts-White-ef56", "tts-Yellow-gh78"];
// Blue (player-0) and Red (player-1) are a team; White (player-2) and Yellow (player-3) the other
const card = (id, ctl, name, text) => ({ id, controllerId: ctl, ownerId: ctl, identity: { name }, text });
const partnerTutor = card("engine-card-201", "player-1", "Rhystic Tutor", TUTOR);
const foeTutor = card("engine-card-202", "player-2", "Rhystic Tutor", TUTOR);
const foeTithe = card("engine-card-203", "player-3", "Smothering Tithe", TITHE);
const myRemora = card("engine-card-204", "player-0", "Mystic Remora", REMORA);
const searches = (who) => `${who} searches their library for a card, puts it into their hand, then shuffles.`;

// rule: the board's teamRules.rule ("sharedLife" 2HG Level 1, "sharedTurns" Level 2, "teams" 2v2), or null: no teams
function setup(h, rule) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  const players = [0, 1, 2, 3].map((i) => ({ id: `player-${i}`, manaPool: {}, ...(rule ? { teamNumber: i < 2 ? 1 : 2 } : {}) }));
  seat.board = { state: { gameView: { turn: 5, step: "main1", activePlayerId: "player-1", priorityPlayerId: "player-0", stack: [], zones: [],
    players, ...(rule ? { teamRules: { rule, poisonToLose: rule === "teams" ? 10 : 15 } } : {}) } } };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 0, total: 4, playerOrder: USERS,
    slotNames: { "player-0": "Blue", "player-1": "Red", "player-2": "White", "player-3": "Yellow" },
    slotColor: { "player-0": "Blue", "player-1": "Red", "player-2": "White", "player-3": "Yellow" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  const calls = [];
  const respond = seat.respond.bind(seat);
  seat.respond = (promptId, type, out) => { calls.push({ promptId, type, out }); return respond(promptId, type, out); };
  return { seat, calls };
}
const payAsk = (id, src, otherwise, cost) => ({ promptId: id, decidingPlayerId: "player-0", sourceCard: src, sourceAbilityText: src.text,
  input: { type: "chooseBoolean", confirmLabel: "Pay", denyLabel: "Decline", presentation: { title: `Pay ${cost}?`, text: `otherwise: "${otherwise}"`, targets: [] } } });
const send = async (h, t, m) => { h.B.onTTS({ t, json: JSON.stringify(m) }); await h.flush(); };
const shownIds = (h, mark) => h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.promptId != null).map((e) => e.tts.promptId);
const answered = (calls, id) => calls.find((c) => c.promptId === id);

// one question for Blue with the Taxes setting at mode: { shown, answer (true Pay / false No / undefined none) }
async function ask(rule, mode, q) {
  const h = harness.load();
  try {
    const { seat, calls } = setup(h, rule);
    if (mode) await send(h, "taxauto", { color: "Blue", mode });
    const mark = h.effects.length;
    h.B.onPrompt(seat, q); await h.flush();
    const a = answered(calls, q.promptId);
    return { shown: shownIds(h, mark).includes(q.promptId), answer: a ? a.out?.value : undefined, tax: seat.prompt?.tax || null };
  } finally { harness.restore(); }
}

(async () => {
  const MODES = [["2HG Level 1", "sharedLife"], ["2HG Level 2", "sharedTurns"], ["2v2 / Teams", "teams"]];
  let n = 300;
  for (const [label, rule] of MODES) {
    // the partner's Rhystic Tutor: never another player's tax
    for (const mode of ["pay", "no"]) {
      const r = await ask(rule, mode, payAsk(++n, partnerTutor, searches(USERS[1]), "{2}"));
      ok(`${label}: teammate's unless-pay (Taxes ${mode}) is shown, not answered`, r.shown && r.answer === undefined, JSON.stringify(r));
    }
    {
      const r = await ask(rule, null, payAsk(++n, partnerTutor, searches(USERS[1]), "{2}"));
      ok(`${label}: teammate's unless-pay is not marked a tax`, r.shown && r.tax === null, JSON.stringify(r));
    }
    // an opponent's: another player's tax, answered by the setting
    {
      const r = await ask(rule, "pay", payAsk(++n, foeTutor, searches(USERS[2]), "{2}"));
      ok(`${label}: opponent's unless-pay (Taxes pay) is answered Pay`, !r.shown && r.answer === true, JSON.stringify(r));
    }
    {
      const r = await ask(rule, "no", payAsk(++n, foeTithe, "Yellow creates a Treasure token.", "{2}"));
      ok(`${label}: opponent's tax (Taxes no) is answered No`, !r.shown && r.answer === false, JSON.stringify(r));
    }
    {
      const r = await ask(rule, null, payAsk(++n, foeTutor, searches(USERS[2]), "{2}"));
      ok(`${label}: opponent's unless-pay (Taxes ask) is shown and marked a tax`, r.shown && r.answer === undefined && r.tax?.card === foeTutor.id, JSON.stringify(r));
    }
    // your own: shown
    {
      const r = await ask(rule, "no", payAsk(++n, myRemora, "Sacrifices Mystic Remora (204).", "{1}"));
      ok(`${label}: own unless-pay (Taxes no) is shown, not answered`, r.shown && r.answer === undefined, JSON.stringify(r));
    }
  }
  // the same player's card outside a team game is an opponent's: a tax, as before
  {
    const r = await ask(null, "pay", payAsk(++n, partnerTutor, searches(USERS[1]), "{2}"));
    ok("free-for-all: another player's unless-pay (Taxes pay) is answered Pay", !r.shown && r.answer === true, JSON.stringify(r));
  }
  // a team game whose board names no team for a player (one alone on a side, the Juggernaut: the engine sends no
  // teamNumber): two such players are two sides, not teammates, so the other's question is a tax
  {
    const h = harness.load();
    try {
      const { seat, calls } = setup(h, "teams");
      for (const p of seat.board.state.gameView.players) if (p.id === "player-0" || p.id === "player-1") delete p.teamNumber;
      await send(h, "taxauto", { color: "Blue", mode: "pay" });
      h.B.onPrompt(seat, payAsk(++n, partnerTutor, searches(USERS[1]), "{2}")); await h.flush();
      ok("teams: two players with no team number are not teammates (Taxes pay answers)", answered(calls, n)?.out?.value === true, JSON.stringify(calls));
    } finally { harness.restore(); }
  }
  process.stdout.write(failed ? `FAILED: ${passed} passed, ${failed} failed\n` : `PASSED: ${passed} passed, 0 failed\n`);
  process.exit(failed ? 1 : 0);
})();
