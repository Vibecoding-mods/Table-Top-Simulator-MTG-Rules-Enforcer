// The attack tax at the lethal minimum (docs/big-turns-2-spec.md item 3; the user's decision 5, 2026-11-16: "Pay for
// all" next to the lethal minimum). Attacking a taxed player (Ghostly Prison, Propaganda, Norn's Annex) with two or more
// creatures asks once: "Pay {X} for k" (the fewest that are lethal by any route, highest damage first), "Pay for all
// n", "Don't attack", Back. Then every payment Forge asks for an attacker of the plan answers by itself: auto-pay, pay
// from the pool, and once auto-pay can't finish, cancel that one and every later one at that defender. The checks:
//  - 40 life: 40 of 45 1/1s, 20 of 25 2/2s, 14 of 20 3/3s, 10 of 12 4/4s; a mixed pile takes the highest first, equal
//    damage the cheaper tax first
//  - the engine's damage numbers are read (a pump, double strike), and without them the card's power stands in
//  - poison (infect, the infect attackers first) and one commander's damage are routes too; a player who can't lose is offered "Pay for all"
//  - "Pay for k" sends only those k, first (so Forge asks their payments first) and highest first; "Pay for all" all; "Don't attack" none of them, the
//    others still go; Back asks the attack question again; a timeout keeps them home
//  - one attacker at a taxed player asks nothing new; two taxed players: two questions
//  - the payments: auto-pay, the pool, a cancel at the first that fails and every later one, then the chat line
//   node tests/test_bridge_attack_tax_lethal.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 600)}` : ""}\n`); } };

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const PLAYERS = ["player-0", "player-1", "player-2", "player-3"];
const PRISON = "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.";
function board(life = 40, more = {}) {
  return { turn: 5, step: "combatDeclareAttackers", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
    players: PLAYERS.map((id) => ({ id, life, manaPool: {} })),
    zones: PLAYERS.flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))), ...more };
}
const put = (gv, card) => { const z = gv.zones.find((x) => x.zone === "battlefield" && x.ownerId === card.controllerId); z.cards.push(card); z.count = z.cards.length; };
let cid = 1000;
// n creatures of one kind for Blue (player-0): [ids]
function creatures(gv, n, name, p, extra = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `engine-card-${++cid}`;
    put(gv, { id, identity: { name, isToken: !!extra.token }, types: ["Creature"], text: "", controllerId: "player-0", ownerId: "player-0", power: p, toughness: p, keywords: [], tapped: false, ...extra });
    ids.push(id);
  }
  return ids;
}
function setup(h, gv) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: gv }, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 3, total: 4, playerOrder: ["tts-Blue-ab12", "bot-1", "bot-2", "bot-3"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1", "player-2": "AI 2", "player-3": "AI 3" },
    slotColor: { "player-0": "Blue", "player-1": "White", "player-2": "Red", "player-3": "Yellow" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  return seat;
}
const tax = (d, cost = "{2}", ...names) => ({ defenderId: d, cost, sourceIds: (names.length ? names : ["Ghostly Prison"]).map((_, i) => `engine-card-9${i}`), sourceNames: names.length ? names : ["Ghostly Prison"] });
// the attack question as the engine sends it: attackers [{ id, targets, costs, damage }], targets [{ id, life?, ... }]
function attackInput(attackers, targets, { withDamage = true } = {}) {
  return { type: "chooseAttackers", unavailable: [], limits: [],
    attackers: attackers.map((a) => ({ attackerId: a.id, validTargetIds: a.targets, mustAttack: false, costs: a.costs || [], ...(withDamage && a.damage ? { damage: a.damage } : {}) })),
    attackTargets: targets.map((t) => ({ id: t.id, label: t.id, kind: t.kind || (t.id.startsWith("player-") ? "player" : "planeswalker"), ...t.more })) };
}
let pid = 500;
async function ask(h, seat, input) {
  h.B.onPrompt(seat, { promptId: ++pid, decidingPlayerId: "player-0", input });
  await h.flush();
  return seat.prompt;
}
// a plain pile: n attackers of power p at player-1 under Ghostly Prison, the engine saying p damage each
function pile(gv, n, p, extra = {}) {
  return creatures(gv, n, `Pile ${p}/${p}`, p).map((id) => ({ id, targets: ["player-1"], costs: [tax("player-1")], damage: [{ defenderId: "player-1", damage: p, poison: 0, ...extra }] }));
}
const T1 = (more = { life: 40, poisonLeft: 10, commanderLeft: [], canLose: true }) => [{ id: "player-1", more }];
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const optionLabels = (step) => (step?.ui?.options || []).map((o) => o.label);

(async () => {
  // ── the lethal minimum at 40 life ──
  for (const [n, p, k] of [[45, 1, 40], [25, 2, 20], [20, 3, 14], [12, 4, 10]]) {
    await run(async (h) => {
      const gv = board();
      const seat = setup(h, gv);
      const atk = pile(gv, n, p);
      const q = await ask(h, seat, attackInput(atk, T1()));
      const step = q.toOutput(["__allattack"])?.__next;
      ok(`lethal ${p}/${p}: the question names the tax and says each`, step?.ui.title === "Ghostly Prison (AI 1): {2} for each attacker", step?.ui.title);
      ok(`lethal ${p}/${p}: ${k} of ${n}`, step?.ui.text === `${k} of your ${n} attackers deal lethal damage to AI 1 (40 life) unblocked. Pay {${2 * k}} for those ${k}? The other ${n - k} stay home.`, step?.ui.text);
      ok(`lethal ${p}/${p}: the buttons`, JSON.stringify(optionLabels(step)) === JSON.stringify([`Pay {${2 * k}} for ${k}`, `Pay {${2 * n}} for all ${n}`, "Don't attack AI 1", "Back"]), JSON.stringify(optionLabels(step)));
      ok(`lethal ${p}/${p}: a timeout keeps them home`, step?.ui.onTimeout === "__none", step?.ui.onTimeout);
      const out = step.toOutput(["__lethal"]);
      ok(`lethal ${p}/${p}: Pay for ${k} sends ${k}`, out?.type === "declareAttackers" && out.assignments.length === k && out.assignments.every((a) => a.targetId === "player-1"), JSON.stringify(out).slice(0, 200));
      ok(`lethal ${p}/${p}: the plan is kept for the payments`, seat.taxPlan?.["player-1"]?.ids.length === k && JSON.stringify(seat.lastAttack) === JSON.stringify(out.assignments), JSON.stringify(seat.taxPlan));
    });
  }

  // ── a mixed pile: the highest damage first ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const small = pile(gv, 30, 1), big = pile(gv, 5, 5);
    const q = await ask(h, seat, attackInput([...small, ...big], T1()));
    const step = q.toOutput(["__allattack"]).__next;
    ok("mixed: 5 5/5s and 15 1/1s are the fewest lethal", /^20 of your 35 attackers deal lethal damage/.test(step.ui.text), step.ui.text);
    const out = step.toOutput(["__lethal"]);
    const sent = out.assignments.map((a) => a.attackerId);
    ok("mixed: the 5/5s go first", JSON.stringify(sent.slice(0, 5)) === JSON.stringify(big.map((a) => a.id)) && sent.length === 20, JSON.stringify(sent));
    const all = q.toOutput(["__allattack"]).__next.toOutput(["__all"]);
    ok("mixed: Pay for all sends all 35, highest first", all.assignments.length === 35 && all.assignments[0].attackerId === big[0].id, JSON.stringify(all.assignments.slice(0, 2)));
  });

  // ── the engine's numbers, not the card's power ──
  await run(async (h) => {
    const gv = board(10);
    const seat = setup(h, gv);
    const atk = pile(gv, 4, 2);
    atk[3].damage[0].damage = 10; // (pumped, double strike: what the engine worked out)
    const q = await ask(h, seat, attackInput(atk, T1({ life: 10, poisonLeft: 10, commanderLeft: [], canLose: true })));
    const step = q.toOutput(["__allattack"]).__next;
    ok("engine damage: one pumped attacker alone is lethal", step.ui.text === "1 of your 4 attackers deals lethal damage to AI 1 (10 life) unblocked. Pay {2} for that one? The other 3 stay home.", step.ui.text);
    const out = step.toOutput(["__lethal"]);
    ok("engine damage: it is the pumped one", out.assignments.length === 1 && out.assignments[0].attackerId === atk[3].id, JSON.stringify(out.assignments));
  });
  await run(async (h) => {
    const gv = board(6);
    const seat = setup(h, gv);
    const atk = pile(gv, 5, 2);
    const q = await ask(h, seat, attackInput(atk, [{ id: "player-1" }], { withDamage: false }));
    const step = q.toOutput(["__allattack"]).__next;
    ok("fallback: an engine with no damage numbers uses the power and the board's life", /^3 of your 5 attackers deal lethal damage to AI 1 \(6 life\)/.test(step.ui.text), step.ui.text);
  });

  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = pile(gv, 3, 2).map((x, i) => ({ ...x, costs: [tax("player-1", i === 0 ? "{3}" : "{2}")] }));
    const q = await ask(h, seat, attackInput(atk, T1({ life: 4, poisonLeft: 10, commanderLeft: [], canLose: true })));
    const out = q.toOutput(["__allattack"]).__next.toOutput(["__lethal"]);
    ok("ties: of equal damage the cheaper taxes go", JSON.stringify(out?.assignments?.map((a) => a.attackerId).sort()) === JSON.stringify(atk.slice(1).map((a) => a.id).sort()), JSON.stringify(out?.assignments ?? out));
  });
  // ── other routes ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = creatures(gv, 4, "Glistener Elf", 1).map((id) => ({ id, targets: ["player-1"], costs: [tax("player-1")], damage: [{ defenderId: "player-1", damage: 0, poison: 3 }] }));
    const q = await ask(h, seat, attackInput(atk, T1({ life: 40, poisonLeft: 6, commanderLeft: [], canLose: true })));
    const step = q.toOutput(["__allattack"]).__next;
    ok("poison: two infect attackers give lethal poison", step.ui.text === "2 of your 4 attackers give AI 1 lethal poison (6 poison counters to go) unblocked. Pay {4} for those 2? The other 2 stay home.", step.ui.text);
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const elves = creatures(gv, 2, "Glistener Elf", 1).map((id) => ({ id, targets: ["player-1"], costs: [tax("player-1")], damage: [{ defenderId: "player-1", damage: 0, poison: 3 }] }));
    const atk = [...pile(gv, 4, 3), ...elves];
    const q = await ask(h, seat, attackInput(atk, T1({ life: 40, poisonLeft: 6, commanderLeft: [], canLose: true })));
    const out = q.toOutput(["__allattack"]).__next.toOutput(["__lethal"]);
    ok("poison: the infect attackers go, not the bigger ones", JSON.stringify(out?.assignments?.map((a) => a.attackerId).sort()) === JSON.stringify(elves.map((a) => a.id).sort()), JSON.stringify(out?.assignments ?? out));
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = pile(gv, 6, 3);
    const cmd = creatures(gv, 1, "Atraxa, Praetors' Voice", 4)[0];
    atk.push({ id: cmd, targets: ["player-1"], costs: [tax("player-1")], damage: [{ defenderId: "player-1", damage: 4, poison: 0, commander: 4 }] });
    const q = await ask(h, seat, attackInput(atk, T1({ life: 40, poisonLeft: 10, commanderLeft: [{ commanderId: cmd, left: 4 }], canLose: true })));
    const step = q.toOutput(["__allattack"]).__next;
    ok("commander: one commander's damage is lethal alone", step.ui.text === "Atraxa, Praetors' Voice 4/4 deals lethal commander damage to AI 1 (4 commander damage to go) unblocked. Pay {2} for that one? The other 6 stay home.", step.ui.text);
    const out = step.toOutput(["__lethal"]);
    ok("commander: only the commander goes", out.assignments.length === 1 && out.assignments[0].attackerId === cmd, JSON.stringify(out.assignments));
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = pile(gv, 25, 2);
    const q = await ask(h, seat, attackInput(atk, T1({ life: 40, poisonLeft: 10, commanderLeft: [], canLose: false })));
    const step = q.toOutput(["__allattack"]).__next;
    ok("can't lose: no lethal minimum, Pay for all", step.ui.text === "AI 1 can't lose the game now. Pay {50} for all 25 attackers?" && JSON.stringify(optionLabels(step)) === JSON.stringify(["Pay {50} for all 25", "Don't attack AI 1", "Back"]), JSON.stringify([step.ui.text, optionLabels(step)]));
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = pile(gv, 5, 2);
    const q = await ask(h, seat, attackInput(atk, T1()));
    const step = q.toOutput(["__allattack"]).__next;
    ok("not lethal: said so, Pay for all", step.ui.text === "Your 5 attackers are not lethal to AI 1 (40 life) unblocked. Pay {10} for all 5?" && optionLabels(step)[0] === "Pay {10} for all 5", JSON.stringify([step.ui.text, optionLabels(step)]));
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = pile(gv, 20, 2);
    const q = await ask(h, seat, attackInput(atk, T1()));
    const step = q.toOutput(["__allattack"]).__next;
    ok("all needed: said so", step.ui.text === "All 20 of your attackers are needed: together they deal lethal damage to AI 1 (40 life) unblocked. Pay {40} for all 20?", step.ui.text);
  });

  // ── decline, Back, others still go, one attacker, two taxed players ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = pile(gv, 3, 2);
    const free = creatures(gv, 1, "Serra Angel", 4)[0];
    const q = await ask(h, seat, attackInput([...atk, { id: free, targets: ["player-2"] }], [...T1(), { id: "player-2", more: { life: 40 } }]));
    const all = q.toOutput(["__allattack"]);
    let out = all.__next.toOutput(["__none"]);
    ok("decline: none of them attack, the untaxed one still goes", out?.type === "declareAttackers" && JSON.stringify(out.assignments) === JSON.stringify([{ attackerId: free, targetId: "player-2" }]), JSON.stringify(out));
    ok("decline: no plan is kept", seat.taxPlan == null, JSON.stringify(seat.taxPlan));
    const paid = q.toOutput(["__allattack"]).__next.toOutput(["__all"]);
    ok("pay all: the plan's attackers are declared first, so their payments come first", JSON.stringify(paid?.assignments?.map((a) => a.attackerId)) === JSON.stringify([...atk.map((a) => a.id), free]), JSON.stringify(paid?.assignments));
    out = q.toOutput(["__allattack"]).__next.toOutput(["__back"]);
    ok("Back: the attack question again", out?.__next?.ui.title === "Choose attackers", JSON.stringify(out).slice(0, 200));
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = pile(gv, 1, 2);
    const q = await ask(h, seat, attackInput(atk, T1()));
    const out = q.toOutput(["__allattack"]);
    ok("one attacker: declared at once, its payment asks as before", out?.type === "declareAttackers" && out.assignments.length === 1 && seat.taxPlan == null, JSON.stringify(out));
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const at1 = pile(gv, 3, 2);
    const at2 = creatures(gv, 3, "Pile 2/2 b", 2).map((id) => ({ id, targets: ["player-2"], costs: [tax("player-2", "{1}", "Propaganda")], damage: [{ defenderId: "player-2", damage: 2, poison: 0 }] }));
    const q = await ask(h, seat, attackInput([...at1, ...at2], [...T1(), { id: "player-2", more: { life: 4, poisonLeft: 10, commanderLeft: [], canLose: true } }]));
    const first = q.toOutput(["__allattack"]).__next;
    ok("two taxed: the first defender asked", first.ui.title === "Ghostly Prison (AI 1): {2} for each attacker", first.ui.title);
    const second = first.toOutput(["__all"]).__next;
    ok("two taxed: then the second", second?.ui.title === "Propaganda (AI 2): {1} for each attacker" && /^2 of your 3 attackers deal lethal damage to AI 2 \(4 life\)/.test(second.ui.text), JSON.stringify(second?.ui).slice(0, 300));
    const out = second.toOutput(["__lethal"]);
    ok("two taxed: 3 at AI 1 and 2 at AI 2", out.assignments.filter((a) => a.targetId === "player-1").length === 3 && out.assignments.filter((a) => a.targetId === "player-2").length === 2, JSON.stringify(out.assignments));
    ok("two taxed: both plans kept", Object.keys(seat.taxPlan || {}).sort().join() === "player-1,player-2", JSON.stringify(seat.taxPlan));
  });

  // ── the payments ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = pile(gv, 25, 2);
    const q = await ask(h, seat, attackInput(atk, T1()));
    const out = q.toOutput(["__allattack"]).__next.toOutput(["__lethal"]);
    seat.prompt = null;
    const sent = out.assignments.map((a) => a.attackerId);
    const pay = async (cardId, canConfirmFromPool) => {
      const from = h.effects.length;
      h.B.onPrompt(seat, { promptId: ++pid, decidingPlayerId: "player-0", input: { type: "payManaCost", cardId, cardName: "Pile 2/2", manaCost: "{2}", canConfirmFromPool, actions: [] } });
      await h.flush();
      const relay = h.effects.slice(from).filter((e) => e.relay).map((e) => e.relay.state?.action?.output || e.relay).at(-1);
      return { relay, asked: seat.prompt?.promptId === pid };
    };
    let r = await pay(sent[0], false);
    ok("pay: the first attacker auto-pays by itself", r.relay?.type === "pay" && r.relay.auto === true && !r.asked, JSON.stringify(r));
    r = await pay(sent[0], true);
    ok("pay: then pays from the pool", r.relay?.type === "pay" && r.relay.auto === false && !r.asked, JSON.stringify(r));
    r = await pay(sent[1], false);
    ok("pay: the next one auto-pays", r.relay?.type === "pay" && r.relay.auto === true, JSON.stringify(r));
    r = await pay(sent[1], false);
    ok("pay: auto-pay couldn't finish: cancelled", r.relay?.type === "cancel" && !r.asked, JSON.stringify(r));
    r = await pay(sent[2], false);
    ok("pay: every later one at that defender is cancelled", r.relay?.type === "cancel" && !r.asked, JSON.stringify(r));
    const other = creatures(gv, 1, "Grizzly Bears", 2)[0];
    r = await pay(other, false);
    ok("pay: a payment for a creature not in the plan asks as before", r.asked && /^Pay \{2\}/.test(seat.prompt.ui.title), JSON.stringify(seat.prompt?.ui?.title));
    seat.prompt = null;
    const from = h.effects.length;
    h.B.onPrompt(seat, { promptId: ++pid, decidingPlayerId: "player-0", input: { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }] } });
    await h.flush();
    const said = h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
    ok("pay: priority says what the plan came to", said.includes("[MTG] Paid for 1 of 20 attackers at AI 1; the other 19 stay home."), JSON.stringify(said));
    ok("pay: and forgets the plan", seat.taxPlan == null, JSON.stringify(seat.taxPlan));
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = pile(gv, 3, 2);
    const q = await ask(h, seat, attackInput(atk, T1()));
    q.toOutput(["__allattack"]).__next.toOutput(["__all"]);
    gv.step = "combatDeclareBlockers";
    h.B.onPrompt(seat, { promptId: ++pid, decidingPlayerId: "player-0", input: { type: "payManaCost", cardId: atk[0].id, cardName: "Pile 2/2", manaCost: "{1}{G}", canConfirmFromPool: false, actions: [] } });
    await h.flush();
    ok("pay: a payment after the declaration's step asks as before", seat.prompt?.promptId === pid, JSON.stringify(seat.prompt?.ui?.title));
  });
  // ── No attacks with creatures that must attack asks nothing ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = pile(gv, 3, 2);
    const input = attackInput(atk, T1());
    for (const a of input.attackers) a.mustAttack = true;
    const q = await ask(h, seat, input);
    const out = q.toOutput(["__noattack"]);
    ok("No attacks: must-attack creatures go with no tax question", out?.type === "declareAttackers" && out.assignments.length === 3 && seat.taxPlan == null, JSON.stringify(out).slice(0, 200));
  });

  process.stdout.write(failed ? `${failed} attack-tax checks failed (${passed} passed)\n` : `all ${passed} attack-tax checks pass\n`);
  process.exit(failed ? 1 : 0);
})();
