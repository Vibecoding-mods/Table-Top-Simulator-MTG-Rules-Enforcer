// A library's "put them back in any order" question (bridge.js onPrompt "reorder", onTop): Ponder, Sensei's Divining
// Top and Dig's "the rest on top in any order". Forge lists the cards top card first (Player.getTopXCardsFromLibrary,
// RearrangeTopOfLibraryEffect) and moves the answer's cards to the top one by one, so the answer's LAST card ends on
// top. The bridge showed the list turned round as well as the answer, so "Keep this order" put the library upside
// down: after Brainstorm put Cryptic Command then Diabolic Tutor on top, Ponder showed "Island, Diabolic Tutor, Cryptic
// Command" as top card first, the kept order drew the Island, and Fact or Fiction revealed Diabolic Tutor, Cryptic
// Command (Mairsil hand test #28). Shown in Forge's order, only the answer turned round. Triggers keep their order.
//   node tests/test_bridge_library_order.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [], combatAssignments: [],
  players: [{ id: "player-0", life: 40, manaPool: {}, status: "playing" }, { id: "player-1", life: 40, manaPool: {}, status: "playing" }],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ["library", "hand", "graveyard", "exile", "battlefield", "command"].map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
function setup(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: blank() }, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  const calls = [];
  const respond = seat.respond.bind(seat);
  seat.respond = (promptId, type, out) => { calls.push({ promptId, type, out }); return respond(promptId, type, out); };
  return { seat, calls };
}
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const answer = async (h, promptId, choice) => { h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId, choice: [choice] }) }); await h.flush(); };

const PONDER = "Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.";
const TOP = "Look at the top three cards of your library, then put them back in any order.";
const card = (n, name, types = ["Instant"]) => ({ id: `engine-card-${n}`, identity: { name }, types, ownerId: "player-0", controllerId: "player-0", text: "" });
const ORDER = (promptId, src, text, cards, ability = text) => ({ promptId, decidingPlayerId: "player-0", sourceAbilityText: ability,
  sourceCard: { id: "engine-card-90", identity: { name: src }, types: ["Sorcery"], text },
  input: { type: "reorder", presentation: { title: src, description: "Arrange these cards in order." }, items: cards.map((c) => ({ id: c.id, card: c })) } });
// Forge's moves (RearrangeTopOfLibraryEffect: moveToLibrary(next, 0) for each in the answer's order): the top card first
const library = (top, orderedIds) => { const lib = [...top]; for (const id of orderedIds) { lib.splice(lib.indexOf(id), 1); lib.unshift(id); } return lib; };
const labels = (seat) => (seat.prompt?.ui?.options || []).filter((o) => o.id !== "__keep").map((o) => o.label);

(async () => {
  // the library before Ponder, top card first, as Forge lists it: Brainstorm's two on top
  const three = [card(1, "Cryptic Command"), card(2, "Diabolic Tutor", ["Sorcery"]), card(3, "Island", ["Land"])];
  const topIds = three.map((c) => c.id);
  // ── Ponder: shown top card first, "Keep this order" leaves the library as it was ──
  await run(async (h) => {
    const { seat, calls } = setup(h);
    h.B.onPrompt(seat, ORDER(801, "Ponder", PONDER, three)); await h.flush();
    ok("ponder: asked", calls.length === 0 && seat.prompt?.promptId === 801, `${calls.length} answers`);
    same("ponder: the question is the top card's", seat.prompt?.ui?.title, "Ponder: click the card to put on top");
    same("ponder: the cards shown top card first, as the library is", labels(seat), ["Cryptic Command", "Diabolic Tutor", "Island"]);
    same("ponder: Keep this order names them top card first", seat.prompt?.ui?.options?.[0]?.label, "Keep this order: Cryptic Command, Diabolic Tutor, Island");
    await answer(h, 801, "__keep");
    same("ponder: Keep this order leaves the library as it was (Cryptic Command still on top)", library(topIds, calls.at(-1)?.out?.orderedIds || []), topIds);
  });
  // ── Ponder: the cards clicked end top card first ──
  await run(async (h) => {
    const { seat, calls } = setup(h);
    h.B.onPrompt(seat, ORDER(802, "Ponder", PONDER, three)); await h.flush();
    await answer(h, 802, "engine-card-3");
    same("ponder: the next pick is number 2 from the top", seat.prompt?.ui?.title, "Ponder: click the card to put next (number 2 from the top)");
    await answer(h, 802, "engine-card-1");
    same("ponder: the clicked order is the library's, top card first", library(topIds, calls.at(-1)?.out?.orderedIds || []), ["engine-card-3", "engine-card-1", "engine-card-2"]);
  });
  // ── Sensei's Divining Top: the same ──
  await run(async (h) => {
    const { seat, calls } = setup(h);
    h.B.onPrompt(seat, ORDER(803, "Sensei's Divining Top", TOP, three)); await h.flush();
    same("top: the cards shown top card first", labels(seat), ["Cryptic Command", "Diabolic Tutor", "Island"]);
    await answer(h, 803, "__keep");
    same("top: Keep this order leaves the library as it was", library(topIds, calls.at(-1)?.out?.orderedIds || []), topIds);
  });
  // ── triggers: the first in the list resolves first, kept as Forge lists them ──
  await run(async (h) => {
    const { seat, calls } = setup(h);
    const p = { promptId: 804, decidingPlayerId: "player-0",
      input: { type: "reorder", presentation: { title: "Order triggered abilities", description: "Choose trigger resolution order" },
        items: [{ id: "sa-0", card: card(11, "Soul Warden", ["Creature"]), oracle: "You gain 1 life." }, { id: "sa-1", card: card(12, "Impact Tremors", ["Enchantment"]), oracle: "Impact Tremors deals 1 damage to each opponent." }] } };
    h.B.onPrompt(seat, p); await h.flush();
    same("triggers: shown in Forge's order", (seat.prompt?.ui?.options || []).filter((o) => o.id !== "__keep").map((o) => o.id), ["sa-0", "sa-1"]);
    await answer(h, 804, "__keep");
    same("triggers: Keep this order sends Forge's order", calls.at(-1)?.out?.orderedIds, ["sa-0", "sa-1"]);
  });

  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} library order checks pass\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_library_order: ${e.stack}\n`); process.exit(1); });
