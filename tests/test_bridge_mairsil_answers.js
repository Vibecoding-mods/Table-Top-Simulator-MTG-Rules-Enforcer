// The Mairsil hand test's answer bugs on the bridge's side (docs/HAND-TEST-MAIRSIL.md, "Answers and panels"), on the
// faked bridge (tests/bridge-harness.js):
//  4. A card choice from the hand and a graveyard (Mairsil's cage) names its graveyard cards as pileChoices, so the
//     table lets them be dragged out of the pile to choose them, and its text says how; a drag-out answers it.
//  16. Reanimate's pick reaches Forge as the target; only "__cancel" (the panel's Cancel) cancels: the bridge was not
//     what turned the table's answer into a cancel.
//   node tests/test_bridge_mairsil_answers.js
const harness = require("./bridge-harness");

const F = require("./golden/fixtures/dump2.json");
const clone = (x) => JSON.parse(JSON.stringify(x));
let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };

function fresh(edit) {
  const h = harness.load();
  const b = clone(F.board);
  Object.assign(b.gameView, { activePlayerId: "player-0", priorityPlayerId: "player-0", step: "main1", stack: [] });
  if (edit) edit(b.gameView);
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: b, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  return { h, seat };
}
const asked = (h, seat, input, more = {}) => { h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input, ...more }); return h.flush(); };
const zone = (gv, name, owner = "player-0") => gv.zones.find((z) => z.zone === name && z.ownerId === owner).cards;
const card = (id, name, extra = {}) => ({ id, identity: { name }, types: ["Creature"], power: 2, toughness: 2, ownerId: "player-0", controllerId: "player-0", ...extra });
const relayed = (h, from = 0) => JSON.stringify(h.effects.slice(from).filter((e) => e.relay));
const MAIRSIL = { id: "engine-card-1990", identity: { name: "Mairsil, the Pretender" },
  text: "When Mairsil, the Pretender enters, you may exile an artifact or creature card from your hand or graveyard and put a cage counter on it.\nMairsil, the Pretender has all activated abilities of all cards you own in exile with cage counters on them. You may activate each of those abilities only once each turn." };

(async () => {
  // ── 4: Mairsil's cage choice, one card in the hand and one in the graveyard ──
  {
    const ant = card("engine-card-1991", "Agitator Ant"), kiki = card("engine-card-1992", "Kiki-Jiki, Mirror Breaker");
    const { h, seat } = fresh((gv) => { zone(gv, "hand").push(ant); zone(gv, "graveyard").push(kiki); });
    await asked(h, seat, { type: "chooseCards", min: 0, max: 1, presentation: { title: "Mairsil, the Pretender", description: "Select a card from your hand and graveyard" },
      cards: [{ ...ant, zone: "hand" }, { ...kiki, zone: "graveyard" }] }, { sourceCard: MAIRSIL, sourceAbilityText: MAIRSIL.text.split("\n")[0] });
    const ui = seat.prompt?.ui;
    const sentUi = h.effects.filter((e) => e.tts && e.tts.t === "prompt").pop()?.tts;
    ok("4 mairsil: precondition, the choice was asked", !!ui && ui.options?.length === 2, JSON.stringify(ui && ui.options));
    ok("4 mairsil: the graveyard card (only) is a pile choice", JSON.stringify(ui?.pileChoices) === JSON.stringify(["engine-card-1992"]), JSON.stringify(ui?.pileChoices));
    ok("4 mairsil: the table gets it with the question", JSON.stringify(sentUi?.pileChoices) === JSON.stringify(["engine-card-1992"]), JSON.stringify(sentUi && sentUi.pileChoices));
    ok("4 mairsil: the text says both ways (a glowing card, or drag it out of the pile)", /^Click a glowing card, or right-click the graveyard\/exile → Search and drag the card out/.test(ui?.text || ""), ui?.text);
    ok("4 mairsil: it is no library search", ui?.librarySearch === undefined);
    // dragging the graveyard card out of its pile answers the choice with it (the table's "choose" intent)
    const from = h.effects.length;
    h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "choose", id: "engine-card-1992" }) }); await h.flush();
    ok("4 mairsil: the drag-out answers the choice with that card", /"chosenCardIds":\["engine-card-1992"\]/.test(relayed(h, from)), relayed(h, from).slice(0, 300));
    harness.restore();
  }
  {
    // (every card in the hand: no pile choice, the text as before)
    const ant = card("engine-card-1993", "Agitator Ant");
    const { h, seat } = fresh((gv) => zone(gv, "hand").push(ant));
    await asked(h, seat, { type: "chooseCards", min: 0, max: 1, presentation: { title: "Mairsil, the Pretender", description: "Select a card from your hand and graveyard" },
      cards: [{ ...ant, zone: "hand" }] }, { sourceCard: MAIRSIL, sourceAbilityText: MAIRSIL.text.split("\n")[0] });
    ok("4 mairsil: hand only, no pile choices and no drag-out text", seat.prompt?.ui?.pileChoices === undefined && !/drag the card out/.test(seat.prompt?.ui?.text || ""), JSON.stringify(seat.prompt?.ui && [seat.prompt.ui.pileChoices, seat.prompt.ui.text]));
    harness.restore();
  }
  {
    // (a hand card by Forge's own zone, its id also in a stale graveyard list, beside a real graveyard card: only the
    // graveyard card is a pile choice; the golden's real discard question, dump2, has such a stale id)
    const ant = card("engine-card-1997", "Agitator Ant"), kiki = card("engine-card-1998", "Kiki-Jiki, Mirror Breaker"), helm = card("engine-card-1999", "Helm of the Host");
    const { h, seat } = fresh((gv) => { zone(gv, "hand").push(ant, helm); zone(gv, "graveyard").push(ant, kiki); });
    await asked(h, seat, { type: "chooseCards", min: 0, max: 1, presentation: { title: "Mairsil, the Pretender", description: "Select a card from your hand and graveyard" },
      cards: [{ ...ant, zone: "hand" }, { ...helm, zone: "hand" }, { ...kiki, zone: "graveyard" }] }, { sourceCard: MAIRSIL, sourceAbilityText: MAIRSIL.text.split("\n")[0] });
    ok("4 mairsil: a hand card (Forge's zone) is no pile choice even when a graveyard list names it", JSON.stringify(seat.prompt?.ui?.pileChoices) === JSON.stringify(["engine-card-1998"]), JSON.stringify(seat.prompt?.ui?.pileChoices));
    harness.restore();
  }
  // ── 16: Reanimate's target, answered with the pick and with Cancel ──
  for (const [choice, want, name] of [[["card|engine-card-1995"], /"type":"boardTargets","chosen":\[\{"kind":"card","id":"engine-card-1995"\}\]/, "the pick reaches Forge as the target"],
    [["__cancel"], /"type":"cancel"/, "only the panel's Cancel cancels"]]) {
    const bear = card("engine-card-1995", "Bazaar Trader");
    const { h, seat } = fresh((gv) => zone(gv, "graveyard").push(bear));
    await asked(h, seat, { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, chosenTargets: 0, cancellable: true, intent: "hostile",
      candidates: [{ kind: "card", id: "engine-card-1995" }], presentation: { title: "Hostile", targets: [] } },
    { sourceCard: { id: "engine-card-1996", identity: { name: "Reanimate" }, text: "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value." },
      sourceAbilityText: "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value." });
    const from = h.effects.length;
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice }) }); await h.flush();
    ok(`16 reanimate: ${name}`, want.test(relayed(h, from)), relayed(h, from).slice(0, 300));
    harness.restore();
  }
  console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
