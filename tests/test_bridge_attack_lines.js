// Planned attack lines (the user 2026-11-16: "add targeting lines used for defenders to show who you're targeting
// before attacks"). The steps after the attack question ("whom?", the attack tax) carry the attack planned so far as
// ui.plan, "attackerId|targetId" sorted, the attack question's own option ids; the table draws them dashed
// (test_table_attack_lines.js). The checks:
//  - the attack question itself has no plan (its picks are the table's own, drawn from its selection)
//  - "whom?" after All attack: the split token stack token by token, 7/7/6 is not asked (2/3/2 here with a creature
//    left), the creature still at "whom?" is not in it; a creature picked at a player is
//  - one by one: each step's plan has the earlier answers
//  - Back: the attack question again, no plan
//  - the attack tax: the plan has every assignment; after "Don't attack" at the first defender, the next defender's
//    step leaves those attackers out; after "Pay for k" only the k
//   node tests/test_bridge_attack_lines.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 600)}` : ""}\n`); } };

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
function board(players) {
  return { turn: 5, step: "combatDeclareAttackers", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
    players: players.map((id) => ({ id, life: 40, manaPool: {} })),
    zones: players.flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) };
}
const put = (gv, card) => { const z = gv.zones.find((x) => x.zone === "battlefield" && x.ownerId === card.controllerId); z.cards.push(card); z.count = z.cards.length; };
let cid = 3000;
function creatures(gv, n, name = "Zombie Token", p = 2, token = true) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `engine-card-${++cid}`;
    put(gv, { id, identity: { name, isToken: token }, types: ["Creature"], text: "", controllerId: "player-0", ownerId: "player-0", power: p, toughness: p, keywords: [], tapped: false });
    ids.push(id);
  }
  return ids;
}
const NAMES = ["Blue", "AI 1", "AI 2", "AI 3"];
const COLORS = ["Blue", "White", "Red", "Yellow"];
function setup(h, gv) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: gv }, fingerprint: null };
  const ids = gv.players.map((p) => p.id);
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: ids.length - 1, total: ids.length, playerOrder: ["tts-Blue-ab12", ...ids.slice(1).map((_, i) => `bot-${i + 1}`)],
    slotNames: Object.fromEntries(ids.map((id, i) => [id, NAMES[i]])), slotColor: Object.fromEntries(ids.map((id, i) => [id, COLORS[i]])),
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  return seat;
}
const prison = (d) => ({ defenderId: d, cost: "{2}", sourceIds: ["engine-card-90"], sourceNames: ["Ghostly Prison"] });
function attackInput(gv, attackers) {
  return { type: "chooseAttackers", unavailable: [], limits: [],
    attackers: attackers.map((a) => ({ attackerId: a.id, validTargetIds: a.targets, mustAttack: false, costs: a.costs || [] })),
    attackTargets: gv.players.filter((p) => p.id !== "player-0").map((p) => ({ id: p.id, label: p.id, kind: "player", life: 40, poisonLeft: 10, commanderLeft: [], canLose: true })) };
}
let pid = 900;
async function ask(h, seat, input) {
  h.B.onPrompt(seat, { promptId: ++pid, decidingPlayerId: "player-0", input });
  await h.flush();
  return seat.prompt;
}
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const FOUR = ["player-0", "player-1", "player-2", "player-3"];
const OPP = ["player-1", "player-2", "player-3"];
const count = (plan) => { const n = {}; for (const v of plan || []) { const t = v.split("|")[1]; n[t] = (n[t] || 0) + 1; } return n; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  // ── All attack: the split stack in the plan, the creature still at "whom?" not ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const zombies = creatures(gv, 6);
    const angel = creatures(gv, 1, "Serra Angel", 4, false)[0];
    const q = await ask(h, seat, attackInput(gv, [...zombies, angel].map((id) => ({ id, targets: OPP }))));
    ok("question: the attack question itself has no plan", q?.ui && q.ui.plan === undefined, JSON.stringify(q?.ui?.plan));
    const step = q.toOutput(["__allattack"])?.__next;
    ok("whom: the step after All attack carries the plan", Array.isArray(step?.ui?.plan), JSON.stringify(step?.ui).slice(0, 300));
    ok("whom: the split stack is in it, 2, 2 and 2 from the attacker's left", same(count(step?.ui?.plan), { "player-1": 2, "player-2": 2, "player-3": 2 }), JSON.stringify(count(step?.ui?.plan)));
    ok("whom: the creature still at whom? is not", !(step?.ui?.plan || []).some((v) => v.startsWith(`${angel}|`)), JSON.stringify(step?.ui?.plan));
    ok("whom: the plan is attacker|target ids, sorted", same(step?.ui?.plan, [...(step?.ui?.plan || [])].sort()) && (step?.ui?.plan || []).every((v) => /^engine-card-\d+\|player-\d$/.test(v)), JSON.stringify(step?.ui?.plan));
    const back = step.toOutput(["__back"])?.__next;
    ok("back: the attack question again, with no plan", back?.ui?.title === "Choose attackers" && back.ui.plan === undefined, JSON.stringify(back?.ui?.plan) + " " + back?.ui?.title);
  });
  // ── a creature picked at a player, the rest asked one by one ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const [a, b, c] = creatures(gv, 3, "Grizzly Bears", 2, false).map((id, i) => { const card = gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.find((x) => x.id === id); card.identity.name = ["Bear A", "Bear B", "Bear C"][i]; return id; });
    const q = await ask(h, seat, attackInput(gv, [a, b, c].map((id) => ({ id, targets: OPP }))));
    const step = q.toOutput([`${a}|player-3`, `${b}|?`, `${c}|?`])?.__next;
    ok("picked: the creature picked at a player is in the plan, the two at whom? are not", same(step?.ui?.plan, [`${a}|player-3`]), JSON.stringify(step?.ui?.plan));
    const each = step.toOutput(["__each"])?.__next;
    const second = each.toOutput(["player|player-1"])?.__next;
    ok("one by one: the next step's plan has the answer before it", same(second?.ui?.plan, [`${a}|player-3`, `${b}|player-1`].sort()), JSON.stringify(second?.ui?.plan));
    const out = second.toOutput(["player|player-2"]);
    ok("one by one: then the attack is declared as planned", out?.type === "declareAttackers" && out.assignments.length === 3, JSON.stringify(out).slice(0, 200));
  });
  // ── the attack tax ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = creatures(gv, 4, "Grizzly Bears", 2, false);
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: OPP, costs: [prison("player-1"), prison("player-2")] }))));
    const pick = [`${ids[0]}|player-1`, `${ids[1]}|player-1`, `${ids[2]}|player-2`, `${ids[3]}|player-2`];
    const tax1 = q.toOutput(pick)?.__next;
    ok("tax: the tax question carries the whole plan", /for each attacker/.test(tax1?.ui?.title || "") && same(tax1?.ui?.plan, [...pick].sort()), `${tax1?.ui?.title} ${JSON.stringify(tax1?.ui?.plan)}`);
    const tax2 = tax1.toOutput(["__none"])?.__next;
    const firstD = tax1.ui.options.find((o) => o.id === "__none").label;
    const gone = firstD.includes("AI 1") ? [ids[0], ids[1]] : [ids[2], ids[3]];
    ok("tax: after Don't attack, the next defender's step leaves those attackers out", tax2?.ui?.plan && tax2.ui.plan.length === 2 && !tax2.ui.plan.some((v) => gone.includes(v.split("|")[0])), `${firstD} ${JSON.stringify(tax2?.ui?.plan)}`);
    const back = tax2.toOutput(["__back"])?.__next;
    ok("tax: Back goes to the attack question, no plan", back?.ui?.title === "Choose attackers" && back.ui.plan === undefined, back?.ui?.title);
    const paid = tax1.toOutput(["__all"])?.__next;
    ok("tax: after Pay for all, the next defender's step still has all four", same(paid?.ui?.plan, [...pick].sort()), JSON.stringify(paid?.ui?.plan));
  });
  // ── sorted, whatever order the picks came in ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = creatures(gv, 3, "Grizzly Bears", 2, false);
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: OPP }))));
    const step = q.toOutput([`${ids[2]}|player-1`, `${ids[0]}|player-2`, `${ids[1]}|?`])?.__next;
    ok("sorted: picks given last-first come out sorted", same(step?.ui?.plan, [`${ids[0]}|player-2`, `${ids[2]}|player-1`]), JSON.stringify(step?.ui?.plan));
  });

  process.stdout.write(`${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`ERROR ${e.stack}\n`); process.exit(1); });
