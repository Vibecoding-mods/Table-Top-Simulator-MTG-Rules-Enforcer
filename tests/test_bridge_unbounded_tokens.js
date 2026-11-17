// Big turns 2 in the bridge (docs/big-turns-2-spec.md items 1 and 2, decision 8): a pile of tokens the engine stopped
// counting at its cap (CardDto.unbounded) and the draws the engine makes at its limits (the view's drawReason).
//  - a card's unbounded flag goes to the table as inf, and only when set
//  - the log says "creates infinitely many X tokens (the engine stops counting at 500)" for a pile with inf, a count
//    otherwise
//  - the game-over words say why the engine drew the game: chosen, unanswered, noPerson, heap, stuckLoop; a winner, a
//    tie or an unknown reason keep their own words
//  - the table's turn timer leaves the engine's runaway question unanswered (the engine counts a miss as Keep going),
//    and still answers any other question
//   node tests/test_bridge_unbounded_tokens.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const blank = (more = {}) => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
  players: [{ id: "player-0", life: 20, manaPool: {}, status: "playing" }, { id: "player-1", life: 20, manaPool: {}, status: "playing" }],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))), ...more });
const put = (b, zone, card, ownerId = "player-0") => { const z = b.zones.find((x) => x.zone === zone && x.ownerId === ownerId); z.cards.push(card); z.count = z.cards.length; };
const soldier = (n, extra = {}) => ({ id: `engine-card-${n}`, identity: { name: "Soldier Token", isToken: true }, types: ["Creature"], subtypes: ["Soldier"],
  controllerId: "player-0", ownerId: "player-0", power: "1", toughness: "1", ...extra });

function setup(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: blank() }, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  return seat;
}
const logOf = (h, before, after) => h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after, h.B.engineFacts(undefined));

(async () => {
  // ── the table's card ──
  {
    const h = harness.load();
    setup(h);
    ok("card: an unbounded token is inf", h.B.tableCard(soldier(1, { unbounded: true }), { zone: "battlefield" }).inf === true);
    ok("card: a plain token has no inf", !("inf" in h.B.tableCard(soldier(2), { zone: "battlefield" })));
    harness.restore();
  }
  // ── the log ──
  {
    const h = harness.load();
    setup(h);
    const before = blank(), many = blank(), few = blank();
    for (let i = 0; i < 6; i++) put(many, "battlefield", soldier(10 + i, { unbounded: true }));
    for (let i = 0; i < 3; i++) put(few, "battlefield", soldier(30 + i));
    same("log: a pile past the cap is infinitely many", logOf(h, before, many), ["Blue creates infinitely many Soldier tokens (the engine stops counting at 500)"]);
    same("log: a pile under the cap is counted", logOf(h, before, few), ["Blue creates 3 Soldier tokens"]);
    const one = blank();
    put(one, "battlefield", soldier(40, { unbounded: true }));
    same("log: one more onto an infinite pile is infinitely many too", logOf(h, before, one), ["Blue creates infinitely many Soldier tokens (the engine stops counting at 500)"]);
    harness.restore();
  }
  // ── why the engine drew the game ──
  {
    const h = harness.load();
    setup(h);
    const over = (drawReason, more = {}) => blank({ gameOver: true, drawReason, ...more });
    same("end words: End in a draw", h.B.gameEndWords(over("chosen")), "a draw: a player ended the game at the engine's limit");
    same("end words: two unanswered", h.B.gameEndWords(over("unanswered")), "a draw: the engine's limit question went unanswered twice this turn");
    same("end words: nobody to ask", h.B.gameEndWords(over("noPerson")), "a draw: the engine's limit, with no player to ask");
    same("end words: the heap", h.B.gameEndWords(over("heap")), "a draw: the engine was running out of memory");
    same("end words: a stuck loop", h.B.gameEndWords(over("stuckLoop")), "a draw: a loop the engine couldn't stop, and nobody answered");
    same("end words: an unknown reason is a plain draw", h.B.gameEndWords(over("somethingNew")), "a draw");
    same("end words: no reason is a plain draw", h.B.gameEndWords(over(undefined)), "a draw");
    same("end words: not over, no words", h.B.gameEndWords(blank({ drawReason: "chosen" })), null);
    const won = over("chosen", { winnerId: "player-0", players: [{ id: "player-0", status: "won" }, { id: "player-1", status: "conceded" }] });
    ok("end words: a winner keeps the win", /Blue wins/.test(h.B.gameEndWords(won) || ""), h.B.gameEndWords(won));
    same("end words: a forced tie is the tie's", h.B.gameEndWords(over("tieForced", { tieOffer: { status: { type: "forced" }, roundsToForce: 3 } })), "a forced tie: 3 rounds without progress");
    harness.restore();
  }
  // ── the turn timer and the runaway question ──
  {
    const h = harness.load();
    const seat = setup(h);
    h.B._getGame().timer = { on: true, seconds: 30 };
    h.B.onPrompt(seat, { promptId: 701, decidingPlayerId: "player-0", sourceCard: null,
      input: { type: "chooseBoolean", presentation: { title: "This turn passed the engine's limit", description: "x", targets: [] }, confirmLabel: "Keep going", denyLabel: "End in a draw" } });
    await h.settle();
    let from = h.effects.length;
    h.B._timerExpired(seat, 701);
    await h.settle();
    const fx = h.effects.slice(from);
    ok("timer: the runaway question is left to the engine", seat.prompt?.promptId === 701 && !fx.some((e) => e.relay), JSON.stringify(fx.map((e) => e.relay || e.tts?.text)));
    ok("timer: the player is told no answer counts as Keep going", fx.some((e) => e.tts?.t === "chat" && /no answer counts as Keep going/.test(e.tts.text)), JSON.stringify(fx.map((e) => e.tts?.text)));
    h.B._stopTimer(seat, true);
    from = h.effects.length;
    h.B.onPrompt(seat, { promptId: 702, decidingPlayerId: "player-0", sourceCard: null,
      input: { type: "chooseBoolean", presentation: { title: "Draw a card?", description: "", targets: [] } } });
    await h.flush();
    h.B._timerExpired(seat, 702);
    await h.flush();
    ok("timer: any other question still takes its default answer", h.effects.slice(from).some((e) => e.relay), JSON.stringify(h.effects.slice(from).map((e) => e.relay || e.tts?.text)));
    h.B._stopTimer(seat, true);
    harness.restore();
  }
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
