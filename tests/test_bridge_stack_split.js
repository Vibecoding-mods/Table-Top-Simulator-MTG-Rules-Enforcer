// A token stack does NOT split by itself any more (the user 2026-11-27: "its still auto spliting on normal attacks";
// it split since decision 7, 2026-11-16). All attack, or "whom?" picked for each token, asks "whom?" once for the
// whole stack (attackWhom), with One by one; spreading a swing is the "Attack all split evenly" button
// (tests/test_bridge_attack_split.js). The checks:
//  - 20 Zombie tokens, All attack: one "whom?" question, every token at the player picked; the same with "whom?"
//    picked for each token; One by one is offered
//  - 500 tokens: one question, quickly
//  - a stack clicked at one player stays there; a single token is asked whom
//  - a non-token creature with the stack: still asked, and the stack is not spread
//  - the log: one line per player for a stack spread by the split button
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
  // ── 20 tokens, All attack: one question, no spreading ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 20);
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: OPP }))));
    const step = q.toOutput(["__allattack"])?.__next;
    ok("no split: All attack asks whom once for the stack", step?.ui?.title === "Attack whom with 20 creatures?", String(JSON.stringify(step?.ui?.title ?? step)).slice(0, 200));
    ok("no split: One by one is offered", (step?.ui?.options || []).some((o) => o.id === "__each"), JSON.stringify(step?.ui?.options));
    const out = step?.toOutput(["player|player-2"]);
    ok("no split: every token at the player picked", out?.type === "declareAttackers" && JSON.stringify(shares(out)) === JSON.stringify({ "player-2": 20 }), JSON.stringify(shares(out)));
    const viaWhom = q.toOutput(ids.map((id) => `${id}|?`))?.__next;
    ok("no split: whom? picked for each token asks once too", viaWhom?.ui?.title === "Attack whom with 20 creatures?", String(JSON.stringify(viaWhom?.ui?.title ?? viaWhom)).slice(0, 200));
  });
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 500, "Scute Swarm", 1);
    for (const c of gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards) c.inf = true;
    const t = Date.now();
    const q = await ask(h, seat, attackInput(gv, ids.map((id) => ({ id, targets: OPP }))));
    const step = q.toOutput(["__allattack"])?.__next;
    const out = step?.toOutput(["player|player-3"]);
    ok("infinite: 500 asked once, all at the player picked", JSON.stringify(shares(out)) === JSON.stringify({ "player-3": 500 }), JSON.stringify(shares(out)));
    ok("infinite: quickly", Date.now() - t < 5000, `${Date.now() - t} ms`);
  });
  // ── kept ──
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
  // ── a creature with the stack ──
  await run(async (h) => {
    const gv = board(FOUR);
    const seat = setup(h, gv);
    const ids = tokens(gv, 6);
    const angel = tokens(gv, 1, "Serra Angel", 4, false)[0];
    const q = await ask(h, seat, attackInput(gv, [...ids, angel].map((id) => ({ id, targets: OPP }))));
    let step = q.toOutput(["__allattack"])?.__next;
    ok("mixed: asked whom", /^Attack whom with /.test(step?.ui?.title || ""), JSON.stringify(step?.ui?.title));
    let out = step;
    for (let i = 0; i < 10 && out?.__next === undefined && out?.type !== "declareAttackers" && out?.toOutput; i++) out = out.toOutput(["player|player-2"]);
    while (out?.__next) out = out.__next.toOutput(["player|player-2"]);
    ok("mixed: nothing spread, all at the player picked", out?.type === "declareAttackers" && JSON.stringify(shares(out)) === JSON.stringify({ "player-2": 7 }), JSON.stringify(shares(out)));
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
