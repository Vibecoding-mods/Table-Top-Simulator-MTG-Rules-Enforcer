// A planar deck's order question (bridge.js onPrompt "reorder"): Norn's Seedcore, Pools of Becoming, The Fertile Lands
// of Saulvinia and Spatial Merging put revealed planes and phenomena "on the bottom of your planar deck in any order".
// The harness asks that as a plain reorder ("Arrange these cards in order.", titled with the source's name), and the
// bridge's words read the library only: Norn's Seedcore's question said "click the one that goes first" (goes where?),
// and Pools of Becoming's, whose text also puts a hand on the bottom of a library, was answered without asking, as a
// library's bottom is. A planar deck is ten or so cards, so that order is the next planes': it is asked, in planar-deck
// words. Forge moves the cards to the bottom one by one in the answer's order (DigUntilEffect, ChangeZoneAllEffect at
// position -1), so the first one ends nearest the top: "click the one that comes up first". A library's bottom is
// still kept without asking.
//   node tests/test_bridge_planar_order.js
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

const SEEDCORE = "When you planeswalk to Norn's Seedcore, chaos ensues.\nWhenever chaos ensues, reveal cards from the top of your planar deck until you reveal a plane card. Planeswalk to it, except don't planeswalk away from any plane. Put the rest of the revealed cards on the bottom of your planar deck in any order.";
const POOLS = "At the beginning of your end step, put the cards in your hand on the bottom of your library in any order, then draw that many cards.\nWhenever chaos ensues, reveal the top three cards of your planar deck. Each of the revealed cards' {CHAOS} abilities triggers. Then put the revealed cards on the bottom of your planar deck in any order.";
const MERGING = "When you encounter Spatial Merging, reveal cards from the top of your planar deck until you reveal two plane cards. Simultaneously planeswalk to both of them. Put all other cards revealed this way on the bottom of your planar deck in any order.";
const plane = (n, name, type = "Plane") => ({ id: `engine-card-${n}`, identity: { name }, types: [type], ownerId: "player-0", controllerId: "player-0", text: `${name}'s text.` });
const card = (n, name) => ({ id: `engine-card-${n}`, identity: { name }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
const ORDER = (promptId, src, text, cards) => ({ promptId, decidingPlayerId: "player-0", sourceCard: { id: "engine-card-90", identity: { name: src }, types: ["Plane"], text },
  input: { type: "reorder", presentation: { title: src, description: "Arrange these cards in order." }, items: cards.map((c) => ({ id: c.id, card: c })) } });

(async () => {
  const three = [plane(1, "Interplanar Tunnel", "Phenomenon"), plane(2, "Chaotic Aether", "Phenomenon"), plane(3, "Mutual Epiphany", "Phenomenon")];
  // ── Norn's Seedcore ──
  await run(async (h) => {
    const { seat, calls } = setup(h);
    h.B.onPrompt(seat, ORDER(901, "Norn's Seedcore", SEEDCORE, three)); await h.flush();
    ok("seedcore: asked, not answered for the player", calls.length === 0 && seat.prompt?.promptId === 901, `${calls.length} answers`);
    same("seedcore: the question says the planar deck's bottom and which comes up first", seat.prompt?.ui?.title, "Norn's Seedcore: these go to the bottom of your planar deck: click the one that comes up first");
    ok("seedcore: the hint says the order is the next planes'", /planar deck/.test(seat.prompt?.ui?.text || "") && /comes up first/.test(seat.prompt?.ui?.text || "") && /Keep this order/.test(seat.prompt?.ui?.text || ""), seat.prompt?.ui?.text);
    ok("seedcore: each card offered", ["engine-card-1", "engine-card-2", "engine-card-3"].every((id) => (seat.prompt?.ui?.options || []).some((o) => o.id === id)), JSON.stringify(seat.prompt?.ui?.options));
    await answer(h, 901, "engine-card-3");
    same("seedcore: the next pick says next", seat.prompt?.ui?.title, "Norn's Seedcore: these go to the bottom of your planar deck: click the one that comes up next");
    await answer(h, 901, "engine-card-1");
    same("seedcore: the answer in the order clicked (the first nearest the top)", calls.at(-1)?.out?.orderedIds, ["engine-card-3", "engine-card-1", "engine-card-2"]);
  });
  // ── Pools of Becoming: its planar reorder is asked, its hand's library bottom still isn't ──
  await run(async (h) => {
    const { seat, calls } = setup(h);
    h.B.onPrompt(seat, ORDER(902, "Pools of Becoming", POOLS, three)); await h.flush();
    ok("pools: the planar deck's order is asked", calls.length === 0 && seat.prompt?.promptId === 902, `${calls.length} answers: ${JSON.stringify(calls[0]?.out)}`);
    same("pools: in planar-deck words", seat.prompt?.ui?.title, "Pools of Becoming: these go to the bottom of your planar deck: click the one that comes up first");
  });
  await run(async (h) => {
    const { seat, calls } = setup(h);
    const hand = [card(11, "Grizzly Bears"), card(12, "Hill Giant")];
    h.B.onPrompt(seat, ORDER(903, "Pools of Becoming", POOLS, hand)); await h.flush();
    same("pools: the hand to the library's bottom is kept without asking, as before", calls.map((c) => c.out?.orderedIds), [["engine-card-11", "engine-card-12"]]);
  });
  // ── Spatial Merging, a phenomenon: the same words ──
  await run(async (h) => {
    const { seat } = setup(h);
    h.B.onPrompt(seat, ORDER(904, "Spatial Merging", MERGING, three.slice(0, 2))); await h.flush();
    same("merging: in planar-deck words", seat.prompt?.ui?.title, "Spatial Merging: these go to the bottom of your planar deck: click the one that comes up first");
  });
  // ── a mixed list (a plane among other cards) isn't a planar deck's ──
  await run(async (h) => {
    const { seat } = setup(h);
    h.B.onPrompt(seat, ORDER(905, "Norn's Seedcore", SEEDCORE, [three[0], card(13, "Grizzly Bears")])); await h.flush();
    ok("mixed: not the planar deck's words", !/planar deck/.test(seat.prompt?.ui?.title || ""), seat.prompt?.ui?.title);
  });

  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} planar order checks pass\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_planar_order: ${e.stack}\n`); process.exit(1); });
