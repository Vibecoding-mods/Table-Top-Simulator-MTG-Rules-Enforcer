// "Attack all split evenly" (the user 2026-11-25: "When someone has more than 10 creatures add another button next to
// attack all called 'attack all split evenly' that split a full swing evenly"). The bridge's attack question offers
// __allsplit right after All attack once more than 10 creatures can attack (attackSplitEvenly). The checks:
//  - hidden at 10 creatures that can attack (one more with no target doesn't count), shown at 11, right after All attack
//  - every creature that can attack is sent, spread over the players: counts differ by at most one, the power balanced
//  - a creature that can attack only one player goes there; only players, never a planeswalker (one that can attack
//    only a planeswalker goes to it); must-attack creatures are in; nothing asks "whom?"; the same answer every time
//  - Two-Headed Giant: only the players the engine offers
//  - a limit stops it with "Attack all split evenly" named; the attack tax is still asked
//  - the chat line: "[MTG] Split evenly: 4 at AI 1 (8 power), ..."
//   node tests/test_bridge_attack_split.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 600)}` : ""}\n`); } };

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const PLAYERS = ["player-0", "player-1", "player-2", "player-3"];
const OPP = ["player-1", "player-2", "player-3"];
const PW = "engine-card-77";
function board() {
  const gv = { turn: 5, step: "combatDeclareAttackers", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
    players: PLAYERS.map((id) => ({ id, life: 40, manaPool: {} })),
    zones: PLAYERS.flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) };
  put(gv, { id: PW, identity: { name: "Teferi, Hero of Dominaria" }, types: ["Planeswalker"], text: "", controllerId: "player-2", ownerId: "player-2", loyalty: 4, tapped: false });
  return gv;
}
const put = (gv, card) => { const z = gv.zones.find((x) => x.zone === "battlefield" && x.ownerId === card.controllerId); z.cards.push(card); z.count = z.cards.length; };
let cid = 5000;
// one creature per power in `powers`, for Blue (player-0): [ids]
function creatures(gv, powers, name = "Bear") {
  return powers.map((p) => {
    const id = `engine-card-${++cid}`;
    put(gv, { id, identity: { name: `${name} ${cid}` }, types: ["Creature"], text: "", controllerId: "player-0", ownerId: "player-0", power: p, toughness: p, keywords: [], tapped: false });
    return id;
  });
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
// the attack question as the engine sends it; a: [{ id, targets?, must?, costs? }] (targets: the three players and Teferi)
function attackInput(a, limits = []) {
  return { type: "chooseAttackers", unavailable: [], limits,
    attackers: a.map((x) => ({ attackerId: x.id, validTargetIds: x.targets || [...OPP, PW], mustAttack: !!x.must, costs: x.costs || [] })),
    attackTargets: [...OPP.map((id) => ({ id, label: id, kind: "player", life: 40, poisonLeft: 10, commanderLeft: [], canLose: true })), { id: PW, label: "Teferi", kind: "planeswalker" }] };
}
let pid = 700;
async function ask(h, seat, input) {
  h.B.onPrompt(seat, { promptId: ++pid, decidingPlayerId: "player-0", input });
  await h.flush();
  return seat.prompt;
}
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const ids = (gv, powers) => creatures(gv, powers).map((id) => ({ id }));
const powerOf = (gv, id) => gv.zones.flatMap((z) => z.cards).find((c) => c.id === id)?.power || 0;
// per player: { n, power } of a declaration
function tally(gv, out) {
  const t = {};
  for (const a of out.assignments) { t[a.targetId] ??= { n: 0, power: 0 }; t[a.targetId].n++; t[a.targetId].power += powerOf(gv, a.attackerId); }
  return t;
}
const spread = (xs) => Math.max(...xs) - Math.min(...xs);
const chats = async (h, from) => (await h.flush(), h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text));

(async () => {
  // ── when it is offered ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const ten = ids(gv, Array(10).fill(2));
    const idle = creatures(gv, [5]).map((id) => ({ id, targets: [] }));
    const q = await ask(h, seat, attackInput([...ten, ...idle]));
    ok("10 that can attack: not offered (one with no target doesn't count)", !q.ui.options.some((o) => o.id === "__allsplit"), JSON.stringify(q.ui.options.slice(0, 3)));
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const q = await ask(h, seat, attackInput(ids(gv, Array(11).fill(2))));
    ok("11 that can attack: offered right after All attack", q.ui.options[0].id === "__allattack" && q.ui.options[1].id === "__allsplit"
      && q.ui.options[1].label === "Attack all split evenly" && q.ui.options[2].id === "__noattack", JSON.stringify(q.ui.options.slice(0, 3)));
  });

  // ── 11 alike: 4/4/3, players only, no "whom?" ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = ids(gv, Array(11).fill(2));
    const q = await ask(h, seat, attackInput(atk));
    const from = h.effects.length;
    const out = q.toOutput(["__allsplit"]);
    ok("split: sent at once, no whom? question", out?.type === "declareAttackers" && !out.__next, JSON.stringify(out?.__next?.ui?.title ?? out).slice(0, 200));
    ok("split: every creature is sent", out?.assignments?.length === 11 && new Set(out.assignments.map((a) => a.attackerId)).size === 11, JSON.stringify(out?.assignments));
    ok("split: players only, never the planeswalker", out?.assignments?.every((a) => OPP.includes(a.targetId)), JSON.stringify(out?.assignments));
    const t = tally(gv, out);
    ok("split: counts differ by at most one (4, 4, 3)", OPP.every((p) => t[p]) && spread(OPP.map((p) => t[p].n)) <= 1, JSON.stringify(t));
    ok("split: the chat line says the split", JSON.stringify(await chats(h, from)) === JSON.stringify(["[MTG] Split evenly: 4 at AI 1 (8 power), 4 at AI 2 (8 power), 3 at AI 3 (6 power)."]), JSON.stringify(await chats(h, from)));
    const again = q.toOutput(["__allsplit"]);
    ok("split: the same answer every time", JSON.stringify(again.assignments) === JSON.stringify(out.assignments), JSON.stringify(again.assignments));
  });

  // ── the power balanced ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = ids(gv, [9, 8, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1]);
    const q = await ask(h, seat, attackInput(atk));
    const out = q.toOutput(["__allsplit"]);
    const t = tally(gv, out);
    ok("power: 4 each", OPP.every((p) => t[p]?.n === 4), JSON.stringify(t));
    ok("power: the totals balanced (17 each)", OPP.every((p) => t[p]?.power === 17), JSON.stringify(t));
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    // (one big creature and many small: the big one's player takes fewer power, never more creatures than one over)
    const atk = ids(gv, [20, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const out = (await ask(h, seat, attackInput(atk))).toOutput(["__allsplit"]);
    const t = tally(gv, out);
    ok("power: counts still differ by at most one with one big creature", spread(OPP.map((p) => t[p]?.n || 0)) <= 1, JSON.stringify(t));
    const big = out.assignments.find((a) => a.attackerId === atk[0].id).targetId;
    ok("power: the big creature's player has the fewest of the rest", t[big].n === Math.min(...OPP.map((p) => t[p].n)), JSON.stringify(t));
  });

  // ── restricted creatures ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const only3 = ids(gv, [9, 9]).map((x) => ({ ...x, targets: ["player-3"] }));
    const onlyPw = ids(gv, [3]).map((x) => ({ ...x, targets: [PW] }));
    const must = ids(gv, [4]).map((x) => ({ ...x, must: true }));
    const rest = ids(gv, [5, 5, 4, 4, 3, 3, 2, 2, 1]);
    const q = await ask(h, seat, attackInput([...rest, ...only3, ...onlyPw, ...must]));
    ok("restricted: offered (13 can attack)", q.ui.options[1]?.id === "__allsplit", JSON.stringify(q.ui.options.slice(0, 3)));
    const out = q.toOutput(["__allsplit"]);
    ok("restricted: no whom? step", out?.type === "declareAttackers", JSON.stringify(out?.__next?.ui?.title ?? out).slice(0, 200));
    const to = Object.fromEntries((out.assignments || []).map((a) => [a.attackerId, a.targetId]));
    ok("restricted: one that can attack only AI 3 goes there", only3.every((x) => to[x.id] === "player-3"), JSON.stringify(only3.map((x) => to[x.id])));
    ok("restricted: one that can attack only a planeswalker goes to it", to[onlyPw[0].id] === PW, String(to[onlyPw[0].id]));
    ok("restricted: the others never go to the planeswalker", Object.entries(to).filter(([id]) => id !== onlyPw[0].id).every(([, t]) => OPP.includes(t)), JSON.stringify(to));
    ok("restricted: the must-attack creature is sent, at a player", OPP.includes(to[must[0].id]), String(to[must[0].id]));
    const t = tally(gv, out);
    ok("restricted: 12 at players, 4 each", OPP.every((p) => t[p]?.n === 4), JSON.stringify(t));
  });

  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    // (ten big ones first would fill AI 1 before the small one that can attack only AI 1: it takes its place first)
    const small = ids(gv, [1]).map((x) => ({ ...x, targets: ["player-1"] }));
    const out = (await ask(h, seat, attackInput([...ids(gv, Array(10).fill(5)), ...small]))).toOutput(["__allsplit"]);
    const t = tally(gv, out);
    ok("restricted: a small one that can attack only AI 1 still leaves the counts within one", out.assignments.find((a) => a.attackerId === small[0].id)?.targetId === "player-1"
      && spread(OPP.map((p) => t[p]?.n || 0)) <= 1, JSON.stringify(t));
  });

  // ── Two-Headed Giant: only the players the engine offers ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = ids(gv, Array(11).fill(1)).map((x) => ({ ...x, targets: ["player-1", "player-3"] }));
    const out = (await ask(h, seat, attackInput(atk))).toOutput(["__allsplit"]);
    const t = tally(gv, out);
    ok("team: only the offered players, 6 and 5", Object.keys(t).sort().join(",") === "player-1,player-3" && spread([t["player-1"].n, t["player-3"].n]) === 1, JSON.stringify(t));
  });

  // ── a limit stops it ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = ids(gv, Array(11).fill(2));
    const q = await ask(h, seat, attackInput(atk, [{ max: 2, defenderId: "player-1", sourceId: "engine-card-88", sourceName: "Crawlspace" }]));
    const from = h.effects.length;
    const out = q.toOutput(["__allsplit"]);
    ok("limit: nothing sent, the question again", out?.__next?.ui?.title === "Choose attackers", JSON.stringify(out).slice(0, 200));
    ok("limit: the stop names Attack all split evenly", /^"Attack all split evenly" would break a limit, so nothing was sent\. Crawlspace: no more than 2 creatures can attack AI 1 each combat\. You chose 4\./.test(out?.__next?.ui?.note || ""), out?.__next?.ui?.note);
    const said = await chats(h, from);
    ok("limit: said in chat, no split line", said.length === 1 && said[0].startsWith("[MTG] \"Attack all split evenly\" would break a limit"), JSON.stringify(said));
  });
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const atk = ids(gv, Array(11).fill(2));
    const q = await ask(h, seat, attackInput(atk, [{ max: 2, defenderId: "player-1", sourceId: "engine-card-88", sourceName: "Crawlspace" }]));
    const out = q.toOutput(["__allattack"])?.__next?.toOutput(["player|player-1"]);
    ok("limit: All attack keeps its own name", /^"All attack" would break a limit/.test(out?.__next?.ui?.note || ""), out?.__next?.ui?.note ?? JSON.stringify(out).slice(0, 200));
  });

  // ── the attack tax is still asked ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const tax = { defenderId: "player-1", cost: "{2}", sourceIds: ["engine-card-90"], sourceNames: ["Ghostly Prison"] };
    const atk = ids(gv, Array(12).fill(2)).map((x) => ({ ...x, costs: [tax] }));
    const q = await ask(h, seat, attackInput(atk));
    const from = h.effects.length;
    const step = q.toOutput(["__allsplit"])?.__next;
    ok("tax: the tax question follows", step?.ui?.title === "Ghostly Prison (AI 1): {2} for each attacker", step?.ui?.title ?? "none");
    ok("tax: no chat line before it is sent", !(await chats(h, from)).some((l) => l.includes("Split evenly")), JSON.stringify(await chats(h, from)));
    const out = step?.toOutput(["__all"]);
    ok("tax: Pay for all sends the split", out?.type === "declareAttackers" && out.assignments.length === 12 && seat.taxPlan?.["player-1"]?.ids.length === 4, JSON.stringify(out ?? null).slice(0, 200));
    ok("tax: the chat line once sent", (await chats(h, from)).includes("[MTG] Split evenly: 4 at AI 1 (8 power), 4 at AI 2 (8 power), 4 at AI 3 (8 power)."), JSON.stringify(await chats(h, from)));
  });

  // ── All attack is unchanged: whom? is still asked ──
  await run(async (h) => {
    const gv = board();
    const seat = setup(h, gv);
    const out = (await ask(h, seat, attackInput(ids(gv, Array(11).fill(2))))).toOutput(["__allattack"]);
    ok("All attack: still asks whom", /^Attack whom/.test(out?.__next?.ui?.title || ""), out?.__next?.ui?.title ?? JSON.stringify(out).slice(0, 200));
  });

  process.stdout.write(`${failed ? "FAILED: " : ""}${passed} attack-split checks pass${failed ? `, ${failed} fail` : ""}\n`);
  process.exit(failed ? 1 : 0);
})();
