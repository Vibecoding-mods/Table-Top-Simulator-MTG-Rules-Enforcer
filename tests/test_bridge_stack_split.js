// One stack per defending player (docs/big-turns-2-spec.md item 4; the user's decision 7, 2026-11-16: attacks split
// into one stack per defending player automatically, no menu step). A token stack still waiting for "whom?" (All attack,
// or "whom?" picked) is declared split among the players: seat order from the attacker's left, floor(N/k) each and the
// first N mod k one more, a token barred from one player sent to the next; with shared life (2HG, 3HG) a team is one
// share. The checks:
//  - 20 Zombie tokens at three players: 7, 7 and 6, from the attacker's left, and nothing asked
//  - a token that can't attack one player goes to the next, even when that share is full; a 2/2 and a 3/3 stack of one
//    name are two stacks; an infinite pile of 500 splits too
//  - a stack clicked at one player, a single token, a stack that can attack only one player: not split
//  - a non-token creature with several targets is still asked "whom?", with the split stack already sent
//  - shared life: one share per team, the partner with no tax; a team game of two teams: no split (one team to attack)
//  - with Ghostly Prison on one player, that player's share gets its own tax question
//  - the log: "Blue attacks AI 1 with 7 Zombie tokens, AI 2 with 7, AI 3 with 6"; a target gone from the board keeps
//    its own lines
//  (the table drawing the three shares as three stacks is checked in test_table_claims.js, "token stacks: a stack split")
//   node tests/test_bridge_stack_split.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 600)}` : ""}\n`); } };

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
function board(players, more = {}) {
  return { turn: 5, step: "combatDeclareAttackers", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
    players: players.map((id) => ({ id, life: 40, manaPool: {} })),
    zones: players.flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))), ...more };
}
const put = (gv, card) => { const z = gv.zones.find((x) => x.zone === "battlefield" && x.ownerId === card.controllerId); z.cards.push(card); z.count = z.cards.length; };
let cid = 2000;
function tokens(gv, n, name = "Zombie Token", p = 2, token = true) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `engine-card-${++cid}`;
    put(gv, { id, identity: { name, isToken: token }, types: ["Creature"], text: "", controllerId: "player-0", ownerId: "player-0", power: p, toughness: p, keywords: [], tapped: false });
    ids.push(id);
  }
  return ids;
}
const NAMES = ["Blue", "AI 1", "AI 2", "AI 3", "AI 4", "AI 5"];
const COLORS = ["Blue", "White", "Red", "Yellow", "Green", "Purple"];
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
    attackers: attackers.map((a) => ({ attackerId: a.id, validTargetIds: a.targets, mustAttack: false, costs: a.costs || [], ...(a.damage ? { damage: a.damage } : {}) })),
    attackTargets: gv.players.filter((p) => p.id !== "player-0").map((p) => ({ id: p.id, label: p.id, kind: "player", life: 40, poisonLeft: 10, commanderLeft: [], canLose: true })) };
}
let pid = 700;
async function ask(h, seat, input) {
  h.B.onPrompt(seat, { promptId: ++pid, decidingPlayerId: "player-0", input });
  await h.flush();
  return seat.prompt;
}
const shares = (out) => { const n = {}; for (const a of out?.assignments || []) n[a.targetId] = (n[a.targetId] || 0) + 1; return n; };
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const FOUR = ["player-0", "player-1", "player-2", "player-3"];
const OPP = ["player-1", "player-2", "player-3"];

(async () => {
  // ── 20 into three players ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 20);
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: OPP }))));
    const out = q.toOutput(["__allattack"]);
    ok("split: All attack declares at once, no whom question", out?.type === "declareAttackers", JSON.stringify(out).slice(0, 200));
    ok("split: 7, 7 and 6 from the attacker's left", JSON.stringify(shares(out)) === JSON.stringify({ "player-1": 7, "player-2": 7, "player-3": 6 }), JSON.stringify(shares(out)));
    const viaWhom = q.toOutput(ids.map((id) => `${id}|?`));
    ok("split: 'whom?' picked for each token splits them too", JSON.stringify(shares(viaWhom)) === JSON.stringify({ "player-1": 7, "player-2": 7, "player-3": 6 }), JSON.stringify(shares(viaWhom)));
  });
  await run(async (h) => {
    const gv = board(FOUR, { activePlayerId: "player-2" });
    gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-2").cards = [];
    const seat = setup(h, gv);
    seat.slot = "player-2";
    const ids = tokens(gv, 4);
    for (const z of gv.zones) for (const c of z.cards) c.controllerId = "player-2";
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: ["player-0", "player-1", "player-3"] }))));
    const out = q.toOutput(["__allattack"]);
    ok("split: seat order starts at the attacker's left (AI 2 attacking: AI 3, Blue, AI 1)",
      JSON.stringify(out.assignments.map((a) => a.targetId)) === JSON.stringify(["player-3", "player-3", "player-0", "player-1"]), JSON.stringify(out.assignments.map((a) => a.targetId)));
  });
  // ── a token barred from one player; an infinite pile ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 6);
    const q = await ask(h, seat, attackInput(gv, ids.map((id, i) => ({ id, targets: i < 3 ? ["player-2", "player-3"] : OPP }))));
    const out = q.toOutput(["__allattack"]);
    const at = Object.fromEntries(out.assignments.map((a) => [a.attackerId, a.targetId]));
    ok("barred: a token that can't attack AI 1 goes to the next", ids.slice(0, 3).every((id) => at[id] !== "player-1"), JSON.stringify(at));
    ok("barred: the shares stay 2, 2 and 2", JSON.stringify(shares(out)) === JSON.stringify({ "player-2": 2, "player-3": 2, "player-1": 2 }) || Object.values(shares(out)).every((n) => n === 2), JSON.stringify(shares(out)));
  });
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 4);
    const q = await ask(h, seat, attackInput(gv, ids.map((id, i) => ({ id, targets: i ? ["player-2", "player-3"] : OPP }))));
    const out = q.toOutput(["__allattack"]);
    ok("barred: a token whose players' shares are full still goes, to the first it can attack", out?.type === "declareAttackers" && JSON.stringify(shares(out)) === JSON.stringify({ "player-1": 1, "player-2": 2, "player-3": 1 }), JSON.stringify(out?.assignments ?? out).slice(0, 300));
  });
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const small = tokens(gv, 3, "Zombie Token", 2);
    const big = tokens(gv, 3, "Zombie Token", 3);
    const q = await ask(h, seat, attackInput(gv, [...small, ...big].map((id) => ({ id, targets: OPP }))));
    const out = q.toOutput(["__allattack"]);
    const at = Object.fromEntries((out?.assignments || []).map((a) => [a.attackerId, a.targetId]));
    ok("sizes: a 2/2 stack and a 3/3 stack of one name split apart, one of each per player", JSON.stringify(big.map((id) => at[id]).sort()) === JSON.stringify(OPP) && JSON.stringify(small.map((id) => at[id]).sort()) === JSON.stringify(OPP), JSON.stringify(at));
  });
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 500, "Scute Swarm", 1);
    for (const c of gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards) c.inf = true;
    const t = Date.now();
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: OPP }))));
    const out = q.toOutput(["__allattack"]);
    ok("infinite: a pile of 500 splits 167, 167 and 166", JSON.stringify(shares(out)) === JSON.stringify({ "player-1": 167, "player-2": 167, "player-3": 166 }), JSON.stringify(shares(out)));
    ok("infinite: quickly", Date.now() - t < 5000, `${Date.now() - t} ms`);
  });
  // ── not split ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 5);
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: OPP }))));
    const out = q.toOutput(ids.map((id) => `${id}|player-3`));
    ok("kept: a stack sent at one player stays there", JSON.stringify(shares(out)) === JSON.stringify({ "player-3": 5 }), JSON.stringify(shares(out)));
  });
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const one = tokens(gv, 1);
    const q = await ask(h, seat, attackInput(gv, one.map((id) => ({ id, targets: OPP }))));
    const out = q.toOutput(["__allattack"]);
    ok("kept: a single token is asked whom", out?.__next?.ui.title?.startsWith("Attack whom with Zombie Token"), JSON.stringify(out?.__next?.ui?.title ?? out));
  });
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 4);
    const pw = "engine-card-1999";
    put(gv, { id: pw, identity: { name: "Jace Beleren" }, types: ["Planeswalker"], controllerId: "player-1", ownerId: "player-1", counters: { LOYALTY: 3 } });
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: ["player-1", pw] }))));
    const out = q.toOutput(["__allattack"]);
    ok("kept: a stack that can attack one player only (and a planeswalker) is asked whom", out?.__next?.ui.title === "Attack whom with 4 creatures?", JSON.stringify(out?.__next?.ui?.title ?? out));
  });
  // ── a creature still asked ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 6);
    const angel = tokens(gv, 1, "Serra Angel", 4, false)[0];
    const q = await ask(h, seat, attackInput(gv, [...ids, angel].map((id) => ({ id, targets: OPP }))));
    const step = q.toOutput(["__allattack"])?.__next;
    ok("mixed: the creature is asked whom, alone", step?.ui.title === "Attack whom with Serra Angel 4/4?", JSON.stringify(step?.ui?.title));
    const out = step.toOutput(["player|player-2"]);
    ok("mixed: then the split stack and the creature go", out?.type === "declareAttackers" && JSON.stringify(shares(out)) === JSON.stringify({ "player-1": 2, "player-2": 3, "player-3": 2 }), JSON.stringify(shares(out)));
  });
  // ── teams ──
  await run(async (h) => {
    const SIX = ["player-0", "player-1", "player-2", "player-3", "player-4", "player-5"];
    const gv = board(SIX, { teamRules: { rule: "sharedLife", poisonToLose: 15 } });
    gv.players.forEach((p, i) => { p.teamNumber = Math.floor(i / 2) + 1; });
    const seat = setup(h, gv);
    const ids = tokens(gv, 10);
    const opp = SIX.slice(1).filter((p) => p !== "player-1");
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: opp, costs: [prison("player-2")] }))));
    const out = q.toOutput(["__allattack"]);
    ok("shared life: one share per team, the partner with no tax", JSON.stringify(shares(out)) === JSON.stringify({ "player-3": 5, "player-4": 5 }), JSON.stringify(shares(out)));
  });
  await run(async (h) => {
    const gv = board(FOUR, { teamRules: { rule: "sharedLife", poisonToLose: 15 } });
    gv.players.forEach((p, i) => { p.teamNumber = i < 2 ? 1 : 2; });
    const seat = setup(h, gv);
    const ids = tokens(gv, 6);
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: ["player-2", "player-3"] }))));
    const out = q.toOutput(["__allattack"]);
    ok("2HG: one team to attack, nothing to split: asked whom", out?.__next?.ui.title === "Attack whom with 6 creatures?", JSON.stringify(out?.__next?.ui?.title ?? out));
  });
  await run(async (h) => {
    // (Archenemy: the archenemy attacks each opponent on their own, no shared life)
    const gv = board(FOUR, { teamRules: { rule: "teams" } });
    gv.players.forEach((p, i) => { p.teamNumber = i === 0 ? 1 : 2; });
    const seat = setup(h, gv);
    const ids = tokens(gv, 9);
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: OPP }))));
    const out = q.toOutput(["__allattack"]);
    ok("Archenemy: the archenemy's stack splits 3, 3, 3", JSON.stringify(shares(out)) === JSON.stringify({ "player-1": 3, "player-2": 3, "player-3": 3 }), JSON.stringify(shares(out)));
  });
  // ── with a tax ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 20);
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: OPP, costs: [prison("player-1")], damage: OPP.map((d) => ({ defenderId: d, damage: 2, poison: 0 })) }))));
    const step = q.toOutput(["__allattack"])?.__next;
    ok("tax: the taxed player's share gets its own question", step?.ui.title === "Ghostly Prison (AI 1): {2} for each attacker" && step.ui.text === "Your 7 attackers are not lethal to AI 1 (40 life) unblocked. Pay {14} for all 7?", JSON.stringify(step?.ui).slice(0, 300));
    const out = step.toOutput(["__all"]);
    ok("tax: then all three shares go", JSON.stringify(shares(out)) === JSON.stringify({ "player-1": 7, "player-2": 7, "player-3": 6 }), JSON.stringify(shares(out)));
  });
  // ── the log ──
  await run(async (h) => {
    setup(h, board(FOUR));
    const before = board(FOUR);
    const ids = tokens(before, 20);
    const after = JSON.parse(JSON.stringify(before));
    after.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.forEach((c, i) => { c.isAttacking = true; c.attackTargetId = OPP[i < 7 ? 0 : i < 14 ? 1 : 2]; });
    const lines = h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after);
    ok("log: one line for the split stack", lines.includes("Blue attacks AI 1 with 7 Zombie tokens, AI 2 with 7, AI 3 with 6"), JSON.stringify(lines));
    const angel = { id: "engine-card-2999", identity: { name: "Serra Angel" }, types: ["Creature"], controllerId: "player-0", ownerId: "player-0" };
    const before2 = JSON.parse(JSON.stringify(before));
    put(before2, { ...angel });
    const mixed = JSON.parse(JSON.stringify(after));
    put(mixed, { ...angel, isAttacking: true, attackTargetId: "player-1" });
    const lines2 = h.B.logEvents(h.B.logSnapshot(before2), h.B.logSnapshot(mixed), mixed);
    ok("log: with a creature among them, one line per player as before", JSON.stringify(lines2.filter((l) => /^Blue attacks /.test(l))) === JSON.stringify(["Blue attacks AI 1 with 7 Zombie tokens, Serra Angel", "Blue attacks AI 2 with 7 Zombie tokens", "Blue attacks AI 3 with 6 Zombie tokens"]), JSON.stringify(lines2));
    ok("log: precondition, 20 tokens", ids.length === 20);
    const gone = JSON.parse(JSON.stringify(before));
    gone.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.forEach((c, i) => { c.isAttacking = true; c.attackTargetId = i < 10 ? "player-1" : "engine-card-77777"; });
    const lines3 = h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(gone), gone);
    ok("log: a stack at a target the board no longer has keeps its own lines", lines3.includes("Blue attacks AI 1 with 10 Zombie tokens") && !lines3.some((l) => /null/.test(l)), JSON.stringify(lines3));
  });

  process.stdout.write(failed ? `${failed} stack-split checks failed (${passed} passed)\n` : `all ${passed} stack-split checks pass\n`);
  process.exit(failed ? 1 : 0);
})();
