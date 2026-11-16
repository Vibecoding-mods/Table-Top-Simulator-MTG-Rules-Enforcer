// Triggers alike grouped in what the bridge shows (the owner, 2026-11-15: "we should consolidate the triggers down: if
// 20 pop up at once, cut it down to 2"): bridge.js stackGroups (the table's stack), countedTriggers (the game log's
// trigger lines) and triggerBlocks (the trigger order question). Forge still resolves every trigger; only what is
// shown is grouped. The words are Forge's: Soul Warden's and Smothering Tithe's texts as the repeat test and
// tests/golden/bridge-cases.js have them, Scute Swarm's landfall as tmp/table-log.log's "Resolve 25× Scute Swarm" game
// (2026-11-15) put it on the stack, Forge's stack line "<card> (<n>) - <words>". The checks:
//  - the table's stack: a run of one trigger alike is one item with its count (x) and its other sources (srcs), the
//    run's bottom item's id; spells, targeted abilities, runs of one and runs split by something else stay apart
//  - the run's id stays while it resolves from the top, its count going down
//  - the log: 18 Soul Warden triggers read once, "×18"; a keyword's trigger too; different ones apart; an echo line,
//    which has no "triggers (", counted at its end
//  - the order question: 18 Soul Wardens and 2 Tithes interleaved are 2 choices; a pick puts its whole block first,
//    in Forge's order; "Keep this order" keeps each block together; one block is answered by itself; triggers that
//    target are still asked one by one; tokens of two sizes are one block under the card's name
//   node tests/test_bridge_trigger_groups.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const SW = "Whenever another creature enters, you gain 1 life.";
const TITHE = "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")";
const LANDFALL = "Landfall — Whenever a land you control enters, create a token that's a copy of Scute Swarm.";
const PING = "Whenever another creature enters, this creature deals 1 damage to target opponent.";
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
  players: [{ id: "player-0", life: 40, manaPool: {} }, { id: "player-1", life: 40, manaPool: {} }],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
const put = (b, zone, card, ownerId = "player-0") => { const z = b.zones.find((x) => x.zone === zone && x.ownerId === ownerId); z.cards.push(card); z.count = z.cards.length; };
const perm = (n, name, text, extra = {}) => ({ id: `engine-card-${n}`, identity: { name, ...(extra.token ? { isToken: true } : {}) }, types: ["Creature"], power: extra.p ?? 1, toughness: extra.t ?? 1, controllerId: "player-0", ownerId: "player-0", text });
// one trigger on the stack, as Forge sends it
let sid = 0;
const trig = (src, name, text, extra = {}) => ({ id: `engine-stack-${++sid}`, sourceId: src, controllerId: "player-0", ownerId: "player-0", identity: { name, ...(extra.token ? { isToken: true } : {}) },
  isTrigger: true, sourceAbilityText: text, targets: extra.targets || [], text: `${name} (${src.replace(/\D/g, "")}) - ${text}` });
const BOLT = { id: "engine-stack-900", sourceId: "engine-card-900", controllerId: "player-1", ownerId: "player-1", identity: { name: "Lightning Bolt" }, sourceAbilityText: "Lightning Bolt deals 3 damage to any target.",
  isPermanentSpell: false, targets: [{ kind: "player", id: "player-0" }], text: "Lightning Bolt (900) - Lightning Bolt deals 3 damage to any target." };

function setup(h, gv) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: gv }, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  const calls = [];
  const respond = seat.respond.bind(seat);
  seat.respond = (promptId, type, out) => { calls.push({ promptId, type, out }); return respond(promptId, type, out); };
  return { seat, calls };
}
const tables = (h) => h.effects.filter((e) => e.tts?.t === "table").map((e) => e.tts);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const answer = async (h, promptId, choice) => { h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId, choice: [choice] }) }); await h.flush(); };
const shownItems = (stack) => stack.map((s) => [s.n, s.x || 1, (s.srcs || []).length]);

(async () => {
  // ── the table's stack ──
  // Forge's stack bottom first: the AI's Bolt, 18 Soul Warden triggers (18 Soul Wardens), 2 Tithe triggers (one Tithe),
  // two alike pings that target, a Soul Warden trigger again over them
  const wardens = Array.from({ length: 18 }, (_, k) => perm(100 + k, "Soul Warden", SW));
  const tithe = { ...perm(200, "Smothering Tithe", TITHE), types: ["Enchantment"], power: undefined, toughness: undefined };
  const pinger = perm(300, "Electrostatic Pummeler", PING);
  const bigStack = () => {
    sid = 0;
    return [BOLT, ...wardens.map((c) => trig(c.id, "Soul Warden", SW)), trig(tithe.id, "Smothering Tithe", TITHE), trig(tithe.id, "Smothering Tithe", TITHE),
      trig(pinger.id, "Electrostatic Pummeler", PING, { targets: [{ kind: "player", id: "player-1" }] }), trig(pinger.id, "Electrostatic Pummeler", PING, { targets: [{ kind: "player", id: "player-1" }] }),
      trig(wardens[0].id, "Soul Warden", SW)];
  };
  const gvWith = (stack) => { const gv = blank(); for (const c of [...wardens, tithe, pinger]) put(gv, "battlefield", c); gv.stack = stack; return gv; };
  await run(async (h) => {
    const stack = bigStack();
    setup(h, gvWith(stack));
    h.B.sendTable(); await h.flush();
    const t = tables(h).at(-1);
    same("stack: 24 items shown as 6 (Bolt, Soul Warden ×18, Tithe ×2, the two targeted pings apart, the Soul Warden over them)", shownItems(t?.stack || []),
      [["Lightning Bolt", 1, 0], ["Soul Warden", 18, 17], ["Smothering Tithe", 2, 0], ["Electrostatic Pummeler", 1, 0], ["Electrostatic Pummeler", 1, 0], ["Soul Warden", 1, 0]]);
    const sw = (t?.stack || [])[1] || {};
    same("stack: the run's id is its bottom item's, its source that item's", [sw.id, sw.src], [stack[1].id, wardens[0].id]);
    same("stack: the run's other sources, each once", sw.srcs, wardens.slice(1).map((c) => c.id));
    ok("stack: the run's words are the trigger's, Forge's number gone", sw.tx === SW, sw.tx);
    ok("stack: a run of one has no count", !("x" in ((t?.stack || [])[0] || {})) && !("x" in ((t?.stack || [])[5] || {})), JSON.stringify(t?.stack?.[0]));
    ok("stack: the targeted pings keep their targets", (t?.stack || [])[3]?.tg?.length === 1 && (t?.stack || [])[4]?.tg?.length === 1, JSON.stringify(t?.stack?.[3]));
  });
  // the top resolving: the run keeps its id, one fewer
  await run(async (h) => {
    const stack = bigStack().slice(0, 19); // (Bolt and the 18 Soul Warden triggers: the top one resolves)
    const { seat } = setup(h, gvWith(stack));
    h.B.sendTable(); await h.flush();
    seat.board.state.gameView = gvWith(stack.slice(0, 18));
    h.B.sendTable(); await h.flush();
    const [a, b] = tables(h).slice(-2).map((t) => t.stack[1]);
    same("resolving: the same id, 18 then 17", [a?.id, a?.x, b?.id, b?.x], [stack[1].id, 18, stack[1].id, 17]);
  });
  // a run of two from one card: counted, no other sources
  await run(async (h) => {
    sid = 0;
    setup(h, gvWith([trig(tithe.id, "Smothering Tithe", TITHE), trig(tithe.id, "Smothering Tithe", TITHE)]));
    h.B.sendTable(); await h.flush();
    const s = tables(h).at(-1)?.stack || [];
    same("one card's two triggers: one item ×2, no srcs", [s.length, s[0]?.x, "srcs" in (s[0] || {})], [1, 2, false]);
  });

  // ── the game log ──
  await run(async (h) => {
    setup(h, blank());
    const before = blank(), after = blank();
    const swarms = Array.from({ length: 5 }, (_, k) => perm(400 + k, "Scute Swarm", LANDFALL.replace(/^Landfall — /, "Landfall — "), { token: k > 0 }));
    for (const b of [before, after]) for (const c of [...wardens.slice(0, 4), ...swarms]) put(b, "battlefield", c);
    put(after, "battlefield", perm(50, "Grizzly Bears", ""));
    put(after, "battlefield", { id: "engine-card-60", identity: { name: "Forest" }, types: ["Land"], controllerId: "player-0", ownerId: "player-0" });
    sid = 0;
    after.stack = [...wardens.slice(0, 4).map((c) => trig(c.id, "Soul Warden", SW)), ...swarms.map((c, k) => trig(c.id, "Scute Swarm", LANDFALL, { token: k > 0 })), trig(tithe.id, "Smothering Tithe", TITHE)];
    put(after, "battlefield", tithe);
    put(before, "battlefield", tithe);
    const lines = h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after, h.B.engineFacts([]));
    const trigLines = lines.filter((l) => / triggers/.test(l));
    same("log: each trigger alike said once, counted, in the place of the first", trigLines, [
      "Soul Warden's ability triggers ×4 (Blue): you gain 1 life",
      "Scute Swarm's landfall triggers (Blue)",
      "Scute Swarm token's landfall triggers ×4 (Blue)",
      "Smothering Tithe's ability triggers (Blue): that player may pay {2}"]);
    ok("log: Soul Warden ×4 in one line", trigLines.filter((l) => l.startsWith("Soul Warden's")).length === 1 && /triggers ×4 \(Blue\)/.test(trigLines.find((l) => l.startsWith("Soul Warden's")) || ""), JSON.stringify(trigLines));
    ok("log: the Swarm tokens' landfall in one line, ×4", trigLines.filter((l) => /token's landfall triggers ×4 \(Blue\)/i.test(l)).length === 1, JSON.stringify(trigLines));
    ok("log: the Swarm card's own landfall apart, no count", trigLines.some((l) => /^Scute Swarm's landfall triggers \(Blue\)/.test(l)), JSON.stringify(trigLines));
    ok("log: Tithe once, no count", trigLines.filter((l) => l.startsWith("Smothering Tithe's")).length === 1 && !/×/.test(trigLines.find((l) => l.startsWith("Smothering Tithe's")) || "×"), JSON.stringify(trigLines));
    ok("log: 4 trigger lines in all, not 10", trigLines.length === 4, JSON.stringify(trigLines));
  });

  // a line with no "triggers (": the count at its end (two Karmic Guides' echo, Forge's echo words as hp-06 read them)
  await run(async (h) => {
    setup(h, blank());
    const ECHO = "At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.";
    const guides = [perm(70, "Karmic Guide", ECHO), perm(71, "Karmic Guide", ECHO)];
    const before = blank(), after = blank();
    for (const b of [before, after]) { b.step = "upkeep"; for (const c of guides) put(b, "battlefield", c); }
    sid = 0;
    after.stack = guides.map((c) => trig(c.id, "Karmic Guide", ECHO));
    const lines = h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after, h.B.engineFacts([]));
    same("log: two echo triggers, one line with the count at its end", lines.filter((l) => /echo/.test(l)), ["Karmic Guide's echo: pay its echo cost, or it is sacrificed ×2"]);
  });

  // ── the trigger order question ──
  const item = (id, card, oracle) => ({ id, card: { id: card.id, identity: card.identity, types: card.types, power: card.power, toughness: card.toughness }, oracle });
  const ORDER = (items) => ({ promptId: 900, decidingPlayerId: "player-0", input: { type: "reorder", items, presentation: { title: "Order triggered abilities" } } });
  // 18 Soul Wardens and 2 Tithes, interleaved as Forge may list them
  const mixed = () => {
    const out = wardens.map((c, k) => item(`t${k}`, c, SW));
    out.splice(5, 0, item("tt1", tithe, TITHE));
    out.splice(12, 0, item("tt2", tithe, TITHE));
    return out;
  };
  await run(async (h) => {
    const { seat } = setup(h, blank());
    h.B.onPrompt(seat, ORDER(mixed())); await h.flush();
    const opts = seat.prompt?.ui?.options || [];
    same("order: 20 triggers are 2 choices and Keep", opts.map((o) => o.id), ["__keep", "t0", "tt1"]);
    ok("order: Soul Warden's block counted", /^Soul Warden 1\/1 ×18: /.test(opts[1]?.label || ""), opts[1]?.label);
    ok("order: Tithe's block counted", /^Smothering Tithe ×2: /.test(opts[2]?.label || ""), opts[2]?.label);
    ok("order: Keep lists the two blocks", /^Keep this order: Soul Warden 1\/1 ×18: .*, Smothering Tithe ×2: /.test(opts[0]?.label || ""), opts[0]?.label);
  });
  await run(async (h) => {
    const { seat, calls } = setup(h, blank());
    h.B.onPrompt(seat, ORDER(mixed())); await h.flush();
    await answer(h, 900, "tt1");
    const got = calls.at(-1)?.out?.orderedIds || [];
    same("order: picking Tithe puts both Tithes first, then the 18 Soul Wardens in Forge's order (one click: the last block goes by itself)",
      [calls.length, got], [1, ["tt1", "tt2", ...wardens.map((c, k) => `t${k}`)]]);
  });
  await run(async (h) => {
    const { seat, calls } = setup(h, blank());
    h.B.onPrompt(seat, ORDER(mixed())); await h.flush();
    await answer(h, 900, "__keep");
    same("order: Keep this order keeps each block together, where its first one was", calls.at(-1)?.out?.orderedIds, [...wardens.map((c, k) => `t${k}`), "tt1", "tt2"]);
    same("order: every trigger is in the answer once", [...(calls.at(-1)?.out?.orderedIds || [])].sort(), mixed().map((i) => i.id).sort());
  });
  // one block and nothing else: answered by itself (a token's triggers of two sizes too)
  await run(async (h) => {
    const { seat, calls } = setup(h, blank());
    const big = perm(500, "Scute Swarm", LANDFALL, { token: true, p: 1, t: 1 }), bigger = perm(501, "Scute Swarm", LANDFALL, { token: true, p: 2, t: 2 });
    h.B.onPrompt(seat, ORDER([item("s1", big, LANDFALL), item("s2", bigger, LANDFALL), item("s3", big, LANDFALL)])); await h.flush();
    same("order: one block is answered by itself, Forge's order", [calls.length, calls[0]?.out?.orderedIds], [1, ["s1", "s2", "s3"]]);
  });
  await run(async (h) => {
    const { seat } = setup(h, blank());
    const small = perm(500, "Scute Swarm", LANDFALL, { token: true }), big = perm(501, "Scute Swarm", LANDFALL, { token: true, p: 3, t: 3 });
    h.B.onPrompt(seat, ORDER([item("s1", small, LANDFALL), item("s2", big, LANDFALL), item("w1", wardens[0], SW)])); await h.flush();
    const opts = seat.prompt?.ui?.options || [];
    ok("order: tokens of two sizes are one block under the card's name", /^Scute Swarm ×2: /.test(opts[1]?.label || "") && opts.length === 3, JSON.stringify(opts.map((o) => o.label)));
  });
  // triggers that target: asked one by one, as before
  await run(async (h) => {
    const { seat } = setup(h, blank());
    h.B.onPrompt(seat, ORDER([item("p1", pinger, PING), item("p2", pinger, PING), item("w1", wardens[0], SW), item("w2", wardens[1], SW)])); await h.flush();
    same("order: targeting triggers apart, the Soul Wardens one block", (seat.prompt?.ui?.options || []).map((o) => o.id), ["__keep", "p1", "p2", "w1"]);
  });

  console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
