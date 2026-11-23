// "You may put a land card from your hand onto the battlefield tapped" (Zimone and Dina; bridge.js yesNoWords): Forge
// asks "Search your hand?", which the bridge said as "Look in your hand for a card?", not saying it is the land. Reported
// in a friend game, 2026-11-22, as the land "wasn't letting" a player put it in; the engine itself put it in (live check
// the same day). Now the question names what it does; any other "Search your hand?" reads as before.
//   node tests/test_bridge_hand_land_question.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };

const ZIMONE = "{T}, Sacrifice another creature: Draw a card. You may put a land card from your hand onto the battlefield tapped. If you control eight or more lands, repeat this process once.";
const zimone = { id: "engine-card-226", controllerId: "player-0", identity: { name: "Zimone and Dina" }, text: ZIMONE };

function setup(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: { turn: 4, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [], zones: [],
    players: [{ id: "player-0", manaPool: {} }, { id: "player-1", manaPool: {} }] } } };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  return seat;
}
const ask = (id, ability, card = zimone, title = "Search your hand?") => ({ promptId: id, decidingPlayerId: "player-0", sourceCard: card, sourceAbilityText: ability,
  input: { type: "chooseBoolean", confirmLabel: "Accept", denyLabel: "Decline", presentation: { title, targets: [] } } });
const shownTitle = async (p) => {
  const h = harness.load();
  const seat = setup(h);
  h.B.onPrompt(seat, p); await h.flush();
  const t = h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.promptId === p.promptId).map((e) => e.tts)[0];
  harness.restore();
  return t;
};

(async () => {
  const z = await shownTitle(ask(700, ZIMONE));
  ok("Zimone: the question names the land and the battlefield", /put a land card from your hand onto the battlefield tapped\?/i.test(z?.title || ""), JSON.stringify(z && z.title));
  ok("Zimone: still a yes/no", (z?.options || []).length === 2, JSON.stringify(z && z.options));
  ok("Zimone: not the old wording", !/look in your hand/i.test(z?.title || ""), JSON.stringify(z && z.title));
  // (untapped when the card says nothing of tapped: Burgeoning's "put a land card from your hand onto the battlefield")
  const plain = await shownTitle(ask(701, "Whenever an opponent plays a land, you may put a land card from your hand onto the battlefield.", { id: "engine-card-300", controllerId: "player-0", identity: { name: "Burgeoning" } }));
  ok("Burgeoning: names the land, no 'tapped'", /put a land card from your hand onto the battlefield\?/i.test(plain?.title || "") && !/tapped/i.test(plain?.title || ""), JSON.stringify(plain && plain.title));
  // (an ability that doesn't put a card from the hand onto the battlefield: as before)
  const other = await shownTitle(ask(702, "Look at your hand and choose a card.", { id: "engine-card-301", controllerId: "player-0", identity: { name: "Some Card" } }));
  ok("other: the old wording stays", /look in your hand for a card\?/i.test(other?.title || ""), JSON.stringify(other && other.title));
  // (a graveyard search stays as it was even when the text names the hand elsewhere)
  const gy = await shownTitle(ask(703, ZIMONE, zimone, "Search your graveyard?"));
  ok("graveyard search: not taken for the hand's land", /look in your graveyard for a card\?/i.test(gy?.title || ""), JSON.stringify(gy && gy.title));
  process.stdout.write(failed ? `FAILED: ${passed} passed, ${failed} failed\n` : `PASSED: ${passed} passed, 0 failed\n`);
  process.exit(failed ? 1 : 0);
})();
