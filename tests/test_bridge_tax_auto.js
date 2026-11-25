// The Taxes setting (bridge.js taxAuto, setTaxAuto, taxAnswer; the table's Taxes button, engine-renderer.lua
// engineTaxDraw; the user, 2026-11-22: "Add auto yes or no to tax question in the top left ui"). Another player's
// "unless you pay" question (Smothering Tithe's "Pay {2}?" for Blue, the AI's Tithe) answered by the player's setting:
//  - ask (the default, and "ask" again): shown as before
//  - "no": answered No unseen, one chat line saying so; nothing shown
//  - "pay": answered Pay unseen, and the payment that follows for that card made with Auto-pay; a payment Auto-pay
//    can't make is shown, said why; a later payment for another card is shown as usual
//  - your own card's question (Mystic Remora's upkeep "Pay {1}? No: sacrifice") is never answered by it
//  - a question already open when the setting changes is answered at once
//  - the table's hello carries the settings: a restarted bridge takes them up
//   node tests/test_bridge_tax_auto.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };

const BLUE = "tts-Blue-ab12", AI = "self-hosted-node-77-bot";
const TITHE = "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.";
const REMORA = "At the beginning of your upkeep, sacrifice Mystic Remora unless you pay {1}.";
const titheCard = { id: "engine-card-101", controllerId: "player-1", identity: { name: "Smothering Tithe" }, text: TITHE };
const remoraCard = { id: "engine-card-103", controllerId: "player-0", identity: { name: "Mystic Remora" }, text: REMORA };

function setup(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: { turn: 4, step: "draw", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [], zones: [],
    players: [{ id: "player-0", manaPool: {} }, { id: "player-1", manaPool: {} }] } } };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: [BLUE, AI],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  const calls = [];
  const respond = seat.respond.bind(seat);
  seat.respond = (promptId, type, out) => { calls.push({ promptId, type, out }); return respond(promptId, type, out); };
  return { seat, calls };
}
const payAsk = (id, card = titheCard, otherwise = "AI 1 creates a Treasure token.", ability = TITHE, cost = "{2}") => ({ promptId: id, decidingPlayerId: "player-0", sourceCard: card,
  sourceAbilityText: ability, input: { type: "chooseBoolean", confirmLabel: "Pay", denyLabel: "Decline", presentation: { title: `Pay ${cost}?`, text: `otherwise: "${otherwise}"` } } });
const payment = (id, cardName = "Smothering Tithe", cost = "{2}", cardId = titheCard.id) => ({ promptId: id, decidingPlayerId: "player-0",
  input: { type: "payManaCost", manaCost: cost, cardName, cardId, actions: [{ id: "tap:engine-card-7", type: "activateManaAbility", cardId: "engine-card-7", description: "Island for {U}" },
    { id: "tap:engine-card-8", type: "activateManaAbility", cardId: "engine-card-8", description: "Island for {U}" }] } });
const send = async (h, t, m) => { h.B.onTTS({ t, json: JSON.stringify(m) }); await h.flush(); };
const shown = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.promptId != null).map((e) => e.tts);
const chats = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);

(async () => {
  // 1. no setting: the question is shown, nothing answered
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    ok("ask (default): Tithe's question is shown", shown(h).some((p) => p.promptId === 500), JSON.stringify(shown(h)));
    ok("ask (default): nothing answered", calls.length === 0, JSON.stringify(calls));
    harness.restore();
  }
  // 2. never pay: answered No unseen, said once
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    await send(h, "taxauto", { color: "Blue", mode: "no" });
    const mark = h.effects.length;
    h.B.onPrompt(seat, payAsk(501)); await h.flush();
    ok("never pay: answered No", calls.length === 1 && calls[0].promptId === 501 && calls[0].out?.type === "decision" && calls[0].out.value === false, JSON.stringify(calls));
    ok("never pay: nothing shown", !shown(h, mark).some((p) => p.promptId === 501), JSON.stringify(shown(h, mark)));
    ok("never pay: one chat line names the card and the answer", chats(h, mark).filter((t) => /Taxes \(auto\)/.test(t)).length === 1
      && chats(h, mark).some((t) => /Smothering Tithe/.test(t) && /No/.test(t)), JSON.stringify(chats(h, mark)));
    ok("never pay: the setting is said in chat", chats(h).some((t) => /Taxes: never pay/.test(t)), JSON.stringify(chats(h)));
    harness.restore();
  }
  // 3. always pay: Pay unseen, then that card's payment with Auto-pay; another card's payment shown
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    await send(h, "taxauto", { color: "Blue", mode: "pay" });
    const mark = h.effects.length;
    h.B.onPrompt(seat, payAsk(502)); await h.flush();
    ok("always pay: answered Pay", calls.length === 1 && calls[0].out?.type === "decision" && calls[0].out.value === true, JSON.stringify(calls));
    h.B.onPrompt(seat, payment(503)); await h.flush();
    ok("always pay: the payment for Tithe made with Auto-pay", calls.length === 2 && calls[1].promptId === 503 && calls[1].out?.type === "pay" && calls[1].out.auto === true, JSON.stringify(calls));
    ok("always pay: neither shown", !shown(h, mark).some((p) => p.promptId === 502 || p.promptId === 503), JSON.stringify(shown(h, mark)));
    h.B.onPrompt(seat, payment(504, "Lightning Bolt", "{R}", "engine-card-90")); await h.flush();
    ok("always pay: a later payment for another card is shown", shown(h, mark).some((p) => p.promptId === 504) && calls.length === 2, JSON.stringify(calls));
    harness.restore();
  }
  // 4. always pay, but Tithe's payment comes for a different card first: that one is shown (the Pay's payment is only its own)
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    await send(h, "taxauto", { color: "Blue", mode: "pay" });
    h.B.onPrompt(seat, payAsk(510)); await h.flush();
    const mark = h.effects.length;
    h.B.onPrompt(seat, payment(511, "Counterspell", "{U}{U}", "engine-card-91")); await h.flush();
    ok("always pay: a payment naming another card is not auto-paid", calls.length === 1 && shown(h, mark).some((p) => p.promptId === 511), JSON.stringify(calls));
    harness.restore();
  }
  // 5. your own card's question: never answered by the setting
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    await send(h, "taxauto", { color: "Blue", mode: "no" });
    const mark = h.effects.length;
    h.B.onPrompt(seat, payAsk(520, remoraCard, "Sacrifice Mystic Remora.", REMORA, "{1}")); await h.flush();
    ok("own card: Mystic Remora's upkeep question is shown", shown(h, mark).some((p) => p.promptId === 520) && calls.length === 0, JSON.stringify(calls));
    harness.restore();
  }
  // 6. back to ask: shown again
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    await send(h, "taxauto", { color: "Blue", mode: "no" });
    await send(h, "taxauto", { color: "Blue", mode: "ask" });
    h.B.onPrompt(seat, payAsk(530)); await h.flush();
    ok("ask again: shown, not answered", shown(h).some((p) => p.promptId === 530) && calls.length === 0, JSON.stringify(calls));
    ok("ask again: said in chat", chats(h).some((t) => /Taxes: ask me each time/.test(t)), JSON.stringify(chats(h)));
    harness.restore();
  }
  // 7. a question already open when the setting changes: answered at once, its panel closed
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    h.B.onPrompt(seat, payAsk(540)); await h.flush();
    const mark = h.effects.length;
    await send(h, "taxauto", { color: "Blue", mode: "no" });
    ok("open question: answered No at once", calls.length === 1 && calls[0].promptId === 540 && calls[0].out?.value === false, JSON.stringify(calls));
    ok("open question: its panel closed", h.effects.slice(mark).some((e) => e.tts?.t === "prompt" && e.tts.color === "Blue" && e.tts.promptId == null) && seat.prompt == null,
      JSON.stringify(h.effects.slice(mark).map((e) => e.tts?.t)));
    harness.restore();
  }
  // 8. the table's hello carries the settings (a restarted bridge)
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    await send(h, "hello", { stamp: "x", tax: { Blue: "no" } });
    h.B.onPrompt(seat, payAsk(550)); await h.flush();
    ok("hello: the table's setting is taken up", calls.length === 1 && calls[0].out?.value === false, JSON.stringify(calls));
    await send(h, "hello", { stamp: "x", tax: { Blue: "bogus" } });
    h.B.onPrompt(seat, payAsk(551)); await h.flush();
    ok("hello: a value it doesn't know is ask", calls.length === 1 && shown(h).some((p) => p.promptId === 551), JSON.stringify(calls));
    harness.restore();
  }
  // 9. always pay: the Auto-pay is for the payment right after the Pay only; another question between ends it
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    await send(h, "taxauto", { color: "Blue", mode: "pay" });
    h.B.onPrompt(seat, payAsk(560)); await h.flush();
    h.B.onPrompt(seat, { promptId: 561, decidingPlayerId: "player-0", input: { type: "chooseAction", actions: [{ id: "a-1", type: "cast", cardId: "engine-card-5", label: "Cast Counterspell" }] } }); await h.flush();
    const mark = h.effects.length;
    h.B.onPrompt(seat, payment(562)); await h.flush();
    ok("always pay: a Tithe payment after another question is shown", shown(h, mark).some((p) => p.promptId === 562) && !calls.some((c) => c.promptId === 562), JSON.stringify(calls));
    harness.restore();
  }
  // 10. the edges the 2026-11-24 mutation pass found unchecked (tools/mutate-bridge.js "tx ...")
  // (never pay: a later payment for that card is not made by Auto-pay)
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    await send(h, "taxauto", { color: "Blue", mode: "no" });
    h.B.onPrompt(seat, payAsk(570)); await h.flush();
    const mark = h.effects.length;
    h.B.onPrompt(seat, payment(571)); await h.flush();
    ok("never pay: a later Tithe payment is shown, not auto-paid", shown(h, mark).some((p) => p.promptId === 571) && !calls.some((c) => c.promptId === 571), JSON.stringify(calls));
    harness.restore();
  }
  // (a question asked for a player Blue controls, Mindslaver's: that player's choice, never Blue's setting)
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    const gv = seat.board.state.gameView;
    gv.players = [{ id: "player-0", manaPool: {} }, { id: "player-1", manaPool: {}, controlledBy: "player-0" }, { id: "player-2", manaPool: {} }];
    const tithe2 = { ...titheCard, controllerId: "player-2" };
    seat.actingFor = { p: "player-1", card: tithe2.id, turn: 4 };
    await send(h, "taxauto", { color: "Blue", mode: "no" });
    const mark = h.effects.length;
    h.B.onPrompt(seat, payAsk(575, tithe2)); await h.flush();
    ok("controlled player: the tax question is shown", shown(h, mark).some((p) => p.promptId === 575) && !calls.some((c) => c.promptId === 575), JSON.stringify(calls));
    harness.restore();
  }
  // (the board's controller over the question's: a Tithe Blue has taken is Blue's own, never answered by the setting)
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    seat.board.state.gameView.zones = [{ zone: "battlefield", ownerId: "player-1", cards: [{ ...titheCard, controllerId: "player-0" }] }];
    await send(h, "taxauto", { color: "Blue", mode: "no" });
    const mark = h.effects.length;
    h.B.onPrompt(seat, payAsk(578)); await h.flush();
    ok("stolen Tithe: the board says it is Blue's, the question is shown", shown(h, mark).some((p) => p.promptId === 578) && !calls.some((c) => c.promptId === 578), JSON.stringify(calls));
    harness.restore();
  }
  // (always pay: the payment named only by its card id is still the Pay's)
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    await send(h, "taxauto", { color: "Blue", mode: "pay" });
    h.B.onPrompt(seat, payAsk(580)); await h.flush();
    const p = payment(581); delete p.input.cardName;
    h.B.onPrompt(seat, p); await h.flush();
    ok("always pay: a payment with only the card id is auto-paid", calls.some((c) => c.promptId === 581 && c.out?.auto === true), JSON.stringify(calls));
    harness.restore();
  }
  // (another player's "you may pay {1}. If you do, ..." is a choice to buy something, not a tax: shown)
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    await send(h, "taxauto", { color: "Blue", mode: "pay" });
    const mark = h.effects.length;
    const BUY = "Whenever you cast a spell, you may pay {1}. If you do, draw a card.";
    h.B.onPrompt(seat, payAsk(585, { ...titheCard, identity: { name: "Some Bazaar" }, text: BUY }, "nothing", BUY, "{1}")); await h.flush();
    ok("pay-for: another player's 'If you do' is shown", shown(h, mark).some((p) => p.promptId === 585) && !calls.some((c) => c.promptId === 585), JSON.stringify(calls));
    harness.restore();
  }
  process.stdout.write(failed ? `FAILED: ${passed} passed, ${failed} failed\n` : `PASSED: ${passed} passed, 0 failed\n`);
  process.exit(failed ? 1 : 0);
})();
