// Big turns (docs/big-turns.md): what the bridge does for a huge run of triggers alike and for the engine's runaway
// limit. Live 2026-11-15 ~23:06: 75 Scute Swarm landfall triggers took 73.5 s, about one second each, two priority
// prompts per trigger (Blue's and Yellow's, each passed by the bridge in 0 ms); then Second Harvest hit the limit and
// the game ended in a draw nobody was asked about. The checks:
//  - held pass (heldPass): a priority the bridge passes by itself while the top of the stack is one run of the same
//    untargeted trigger, five or more (a spell under it too), is passed with exhaustStack (the engine then passes it
//    itself for up to 20 resolutions, or to the run's end after a minute); a spell on top, a run of four, a targeted
//    run: a plain pass
//  - "Resolve all" / "Resolve N×" / "End turn" pressed over such a run pass held, a plain "Resolve" doesn't; the run's
//    count and the cap of passes count the triggers a held pass resolved (heldResolved)
//  - one chat line for a run longer than one hold, once a turn
//  - "mtg stop" (stopchain): the next priority with something on the stack is asked, whatever would pass it; an empty
//    stack forgets it; a "×N" yes/no run ends at once; the table's "mtg stop" sends stopchain
//  - the engine's runaway question: its words and buttons as sent, no "×N" buttons, a chat line to everyone after
//   node tests/test_bridge_big_turns.js
const harness = require("./bridge-harness");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}\n`); } };

const LANDFALL = "Landfall — Whenever a land you control enters, create a token that's a copy of Scute Swarm.";
const PING = "Whenever another creature enters, this creature deals 1 damage to target opponent.";
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const blank = (stack, more = {}) => ({ turn: 7, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack,
  players: [{ id: "player-0", life: 40, manaPool: {} }, { id: "player-1", life: 40, manaPool: {} }],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))), ...more });
let sid = 0;
const trig = (src, name, text, extra = {}) => ({ id: `engine-stack-${++sid}`, sourceId: src, controllerId: extra.by || "player-0", ownerId: extra.by || "player-0",
  identity: { name, isToken: true }, isTrigger: true, sourceAbilityText: text, targets: extra.targets || [], text: `${name} (${src.replace(/\D/g, "")}) - ${text}` });
const scutes = (n) => Array.from({ length: n }, (_, i) => trig(`engine-card-${100 + i}`, "Scute Swarm", LANDFALL));
const BOLT = { id: "engine-stack-900", sourceId: "engine-card-900", controllerId: "player-1", ownerId: "player-1", identity: { name: "Lightning Bolt" },
  sourceAbilityText: "Lightning Bolt deals 3 damage to any target.", isPermanentSpell: false, targets: [{ kind: "player", id: "player-0" }], text: "Lightning Bolt (900) - Lightning Bolt deals 3 damage to any target." };

function setup(h, gv) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: gv }, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  seat.stops = new Set();
  return seat;
}
let pid = 100;
// one priority question with this stack; what came of it
async function prio(h, seat, stack, { actions = [], more = {}, input = {} } = {}) {
  seat.board.state.gameView = blank(stack, more);
  const from = h.effects.length;
  const prompt = { promptId: ++pid, decidingPlayerId: "player-0", input: { type: "chooseAction", actions, presentation: { title: "Your priority" }, ...input } };
  h.B.onPrompt(seat, prompt);
  await h.flush();
  const fx = h.effects.slice(from);
  const outs = fx.filter((e) => e.relay).map((e) => JSON.stringify(e.relay));
  return { id: prompt.promptId, passed: outs.some((o) => o.includes("\"pass\"")), held: outs.some((o) => o.includes("\"exhaustStack\":true")),
    asked: seat.prompt?.promptId === prompt.promptId ? seat.prompt.ui?.title ?? null : null,
    options: seat.prompt?.promptId === prompt.promptId ? (seat.prompt.ui?.options || []).map((o) => o.label) : [],
    said: fx.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text), outs };
}
const answer = async (h, promptId, choice) => { h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId, choice: [choice] }) }); await h.flush(); };
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };

(async () => {
  // ── held pass on Arena-style passing (nothing to do, your own triggers) ──
  await run(async (h) => {
    const seat = setup(h, blank([]));
    let r = await prio(h, seat, scutes(30));
    ok("held pass: a whole stack of one trigger alike passes with exhaustStack", r.passed && r.held && r.asked === null, JSON.stringify(r));
    ok("held pass: a run longer than one hold is said once, with mtg stop", r.said.length === 1 && /30 Scute Swarm triggers resolve back to back.*mtg stop/.test(r.said[0]), JSON.stringify(r.said));
    r = await prio(h, seat, scutes(30)); // (a run past the 20 that chats: with the dedupe gone it would say it again; 10 was silent either way; 2026-11-27)
    ok("held pass: the same run again that turn is not said twice", r.held && !r.said.length, JSON.stringify(r.said));
    r = await prio(h, seat, scutes(20), { more: { turn: 8 } }); // (the edge: 20 is not more than HELD_RESOLUTIONS)
    ok("held pass: a run of 20 or fewer says nothing", r.held && !r.said.length, JSON.stringify(r.said));
    const spell = { ...BOLT, controllerId: "player-0", targets: [], isPermanentSpell: false, sourceAbilityText: "" };
    r = await prio(h, seat, [spell, ...scutes(5)]);
    ok("held pass: a run on top of the spell under it: held (the engine stops at the spell)", r.passed && r.held, JSON.stringify(r));
    r = await prio(h, seat, [...scutes(5), spell]);
    ok("held pass: a spell on top of a run: a plain pass", r.passed && !r.held, JSON.stringify(r));
    r = await prio(h, seat, [spell, ...scutes(4)]);
    ok("held pass: a run of four on top of a spell: a plain pass", r.passed && !r.held, JSON.stringify(r));
    r = await prio(h, seat, scutes(4));
    ok("held pass: a run of four: a plain pass", r.passed && !r.held, JSON.stringify(r));
    r = await prio(h, seat, scutes(5));
    ok("held pass: a run of five: held", r.passed && r.held, JSON.stringify(r));
    const pings = Array.from({ length: 6 }, (_, i) => trig(`engine-card-${50 + i}`, "Goblin", PING, { targets: [{ kind: "player", id: "player-1" }] }));
    r = await prio(h, seat, pings);
    ok("held pass: a targeted run: a plain pass", r.passed && !r.held, JSON.stringify(r));
  });
  // an opponent's run with nothing to answer it with: passed held too (Yellow's half of the live game's prompts)
  await run(async (h) => {
    const seat = setup(h, blank([]));
    const theirs = scutes(25).map((s) => ({ ...s, controllerId: "player-1", ownerId: "player-1" }));
    const r = await prio(h, seat, theirs, { more: { activePlayerId: "player-1" } });
    ok("held pass: an opponent's run, nothing to answer with: held", r.passed && r.held, JSON.stringify(r));
  });
  // ── presses ──
  await run(async (h) => {
    const seat = setup(h, blank([]));
    const COUNTER = { id: "cast:1802", type: "cast", cardId: "engine-card-1802", label: "Cast Counterspell", mode: { type: "normal" } };
    // asked: an opponent's run and a spell in hand
    const theirs = scutes(30).map((s) => ({ ...s, controllerId: "player-1", ownerId: "player-1" }));
    let r = await prio(h, seat, theirs, { actions: [COUNTER], more: { activePlayerId: "player-1" } });
    ok("presses: precondition, asked over AI 1's 30 triggers", r.asked === "Your priority", JSON.stringify(r));
    let from = h.effects.length;
    await answer(h, r.id, "__pass");
    ok("presses: a plain Resolve is one pass, not held", h.effects.slice(from).some((e) => e.relay && JSON.stringify(e.relay).includes("\"pass\""))
      && !h.effects.slice(from).some((e) => e.relay && JSON.stringify(e.relay).includes("exhaustStack")), JSON.stringify(h.effects.slice(from).filter((e) => e.relay)));
    r = await prio(h, seat, theirs, { actions: [COUNTER], more: { activePlayerId: "player-1" } });
    from = h.effects.length;
    await answer(h, r.id, "__resolve");
    ok("presses: Resolve all over a whole-stack run passes held", h.effects.slice(from).some((e) => e.relay && JSON.stringify(e.relay).includes("\"exhaustStack\":true")), JSON.stringify(h.effects.slice(from).filter((e) => e.relay)));
    // 20 resolved by the engine, then it asks again: the passes count them
    r = await prio(h, seat, theirs.slice(0, 10), { actions: [COUNTER], more: { activePlayerId: "player-1" } });
    ok("presses: Resolve all goes on after the engine asks again", r.passed && r.held && !!seat.resolveStack, JSON.stringify(r));
    // (the press itself is not counted, as before: 19 held after it and this one)
    ok("presses: the 20 the held pass resolved count as passes", seat.resolveStack?.passes === 20, JSON.stringify(seat.resolveStack?.passes));
  });
  await run(async (h) => {
    const seat = setup(h, blank([]));
    const COUNTER = { id: "cast:1802", type: "cast", cardId: "engine-card-1802", label: "Cast Counterspell", mode: { type: "normal" } };
    const mine = scutes(30);
    // (your own run is asked over with mtg hold on and a spell to cast)
    seat.hold = 7;
    let r = await prio(h, seat, mine, { actions: [COUNTER] });
    ok("presses: precondition, Resolve 30× Scute Swarm offered", r.asked === "Your priority" && r.options.includes("Resolve 30× Scute Swarm"), JSON.stringify(r.options));
    await answer(h, r.id, "__group");
    ok("presses: Resolve 30× passes held", seat.resolveStack?.held instanceof Set && seat.resolveStack.held.size === 30, JSON.stringify(seat.resolveStack && [...(seat.resolveStack.held || [])].length));
    r = await prio(h, seat, mine.slice(0, 10), { actions: [COUNTER] });
    ok("presses: Resolve 30× counts the 20 resolved: 9 left after this pass", r.passed && seat.resolveStack?.left === 9, JSON.stringify({ r, left: seat.resolveStack?.left }));
    r = await prio(h, seat, mine.slice(0, 1), { actions: [COUNTER] });
    ok("presses: and the run's last one still passes", r.passed && seat.resolveStack?.left === 0, JSON.stringify({ passed: r.passed, left: seat.resolveStack?.left }));
  });
  await run(async (h) => {
    const seat = setup(h, blank([]));
    seat.endTurnAt = 7;
    const r = await prio(h, seat, scutes(30), { actions: [{ id: "cast:1", type: "cast", cardId: "engine-card-1", label: "Cast Opt", mode: { type: "normal" } }] });
    ok("presses: End turn over a whole-stack run passes held", r.passed && r.held, JSON.stringify(r));
  });
  // ── mtg stop ──
  await run(async (h) => {
    const seat = setup(h, blank(scutes(30)));
    seat.endTurnAt = 7;
    h.B.onTTS({ t: "stopchain", json: JSON.stringify({ color: "Blue" }) });
    await h.flush();
    ok("stop: said, with how soon", h.effects.some((e) => e.tts?.t === "chat" && /Stop: your next priority with something on the stack is asked \(within 20 triggers, or when a run resolved at once is done\)/.test(e.tts.text)));
    let r = await prio(h, seat, scutes(10));
    ok("stop: the next priority with a stack is asked, End turn on", r.asked === "Your priority" && !r.passed, JSON.stringify(r));
    ok("stop: and says so", r.said.some((x) => /Stopped \(mtg stop\)/.test(x)), JSON.stringify(r.said));
    await answer(h, r.id, "__pass");
    r = await prio(h, seat, scutes(9));
    ok("stop: once only, End turn passes again after it", r.passed && r.asked === null, JSON.stringify(r));
  });
  await run(async (h) => {
    const seat = setup(h, blank([]));
    seat.resolveStack = h.B._startResolving(blank(scutes(30)), "player-0", false);
    h.B.onTTS({ t: "stopchain", json: JSON.stringify({ color: "Blue" }) });
    await h.flush();
    ok("stop: Resolve all ends at once", seat.resolveStack === null);
    let r = await prio(h, seat, [], { actions: [{ id: "cast:1", type: "cast", cardId: "engine-card-1", label: "Cast Opt", mode: { type: "normal" } }], more: { activePlayerId: "player-1" } });
    ok("stop: an empty stack forgets it", !seat.stopChain && r.passed, JSON.stringify(r));
    seat.endTurnAt = 7;
    r = await prio(h, seat, scutes(5));
    ok("stop: forgotten, End turn passes the next run", r.passed, JSON.stringify(r));
  });
  // ── the engine's runaway question ──
  await run(async (h) => {
    const seat = setup(h, blank(scutes(30)));
    const body = "5,001 triggers have fired this turn, past the engine's limit of 5,000. Every one of them is real and the game is slower with each. Keep going allows as many again (2 more times this turn after this). End in a draw ends the game now: the rules' result when a loop can't be stopped.";
    const prompt = { promptId: 555, decidingPlayerId: "player-0", sourceCard: null,
      input: { type: "chooseBoolean", presentation: { title: "This turn passed the engine's limit", description: body, targets: [] }, confirmLabel: "Keep going", denyLabel: "End in a draw" } };
    h.B.onPrompt(seat, prompt);
    await h.settle();
    const ui = seat.prompt?.ui || {};
    ok("runaway: asked with the engine's title", ui.title === "This turn passed the engine's limit", JSON.stringify(ui));
    ok("runaway: the engine's words under it", ui.text === body, JSON.stringify(ui.text));
    ok("runaway: the engine's two buttons and nothing else", JSON.stringify((ui.options || []).map((o) => o.label)) === JSON.stringify(["Keep going", "End in a draw"]), JSON.stringify(ui.options));
    const from = h.effects.length;
    await answer(h, 555, "no");
    const outs = h.effects.slice(from).filter((e) => e.relay).map((e) => JSON.stringify(e.relay));
    ok("runaway: End in a draw answers No", outs.some((o) => o.includes("\"value\":false")), JSON.stringify(outs));
    ok("runaway: everyone is told why the game is a draw", h.effects.slice(from).some((e) => e.tts?.t === "chat" && !e.tts.color && /Blue ended the game in a draw at the engine's limit/.test(e.tts.text)),
      JSON.stringify(h.effects.slice(from).filter((e) => e.tts?.t === "chat")));
  });
  await run(async (h) => {
    const seat = setup(h, blank([]));
    h.B.onPrompt(seat, { promptId: 556, decidingPlayerId: "player-0", sourceCard: null,
      input: { type: "chooseBoolean", presentation: { title: "This turn passed the engine's limit", description: "x", targets: [] }, confirmLabel: "Keep going", denyLabel: "End in a draw" } });
    await h.settle();
    const from = h.effects.length;
    await answer(h, 556, "yes");
    ok("runaway: Keep going answers Yes and says so", h.effects.slice(from).some((e) => e.relay && JSON.stringify(e.relay).includes("\"value\":true"))
      && h.effects.slice(from).some((e) => e.tts?.t === "chat" && /kept the turn going past the engine's limit/.test(e.tts.text)), JSON.stringify(h.effects.slice(from).map((e) => e.relay || e.tts?.text)));
  });
  await run(async (h) => {
    const seat = setup(h, blank([]));
    h.B.onPrompt(seat, { promptId: 557, decidingPlayerId: "player-0", sourceCard: null,
      input: { type: "chooseBoolean", presentation: { title: "This turn passed the engine's limit", description: "x", targets: [] }, confirmLabel: "Keep going", denyLabel: "End in a draw" } });
    await h.settle();
    ok("runaway: the question stays up before the engine's clock runs out", seat.prompt?.promptId === 557, JSON.stringify(seat.prompt?.promptId));
    let from = h.effects.length;
    await h.flush();
    const fx = h.effects.slice(from);
    ok("runaway: the question closes on the table when the engine's 90 s run out", seat.prompt == null && fx.some((e) => e.tts?.t === "prompt" && e.tts.color === "Blue" && e.tts.promptId === null), JSON.stringify(fx.map((e) => e.tts?.t)));
    ok("runaway: the player is told no answer counts as Keep going", fx.some((e) => e.tts?.t === "chat" && e.tts.color === "Blue" && /90 seconds for that question ran out: no answer counts as Keep going/.test(e.tts.text)), JSON.stringify(fx.map((e) => e.tts?.text)));
    from = h.effects.length;
    await answer(h, 557, "no");
    ok("runaway: a click after it closed sends the engine nothing", !h.effects.slice(from).some((e) => e.relay), JSON.stringify(h.effects.slice(from).map((e) => e.relay)));
  });
  await run(async (h) => {
    const seat = setup(h, blank([]));
    h.B.onPrompt(seat, { promptId: 558, decidingPlayerId: "player-0", sourceCard: null,
      input: { type: "chooseBoolean", presentation: { title: "Draw a card?", description: "", targets: [] } } });
    await h.flush();
    ok("runaway: any other question stays up", seat.prompt?.promptId === 558, JSON.stringify(seat.prompt?.promptId));
  });
  await run(async (h) => {
    const seat = setup(h, blank([]));
    h.B.onPrompt(seat, { promptId: 559, decidingPlayerId: "player-0", sourceCard: null,
      input: { type: "chooseBoolean", presentation: { title: "This turn passed the engine's limit", description: "x", targets: [] }, confirmLabel: "Keep going", denyLabel: "End in a draw" } });
    await h.settle();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 559, choice: ["yes"] }) });
    await h.settle();
    h.B.onPrompt(seat, { promptId: 560, decidingPlayerId: "player-0", sourceCard: null,
      input: { type: "chooseBoolean", presentation: { title: "Draw a card?", description: "", targets: [] } } });
    await h.flush();
    ok("runaway: an answered question's clock leaves the next question up", seat.prompt?.promptId === 560, JSON.stringify(seat.prompt?.promptId));
  });
  // ── the table's "mtg stop" ──
  {
    const say = (text, mark) => ({ lua: `local sent = {} local was = engineSend engineSend = function(t, p) sent[#sent + 1] = { t = t, p = p } end local v = engineChat(${JSON.stringify(text)}, Player.Blue) engineSend = was return JSON.encode({ v = tostring(v), sent = sent })`, mark });
    const r = simulate({ save: buildSave(), steps: [say("mtg stop", "stop"), say("mtg help", "help")] });
    const step = (m) => r.steps.find((s) => s.step === m) || {};
    let got = {};
    try { got = JSON.parse(step("stop").value); } catch { /* checked below */ }
    ok("table: the script loaded without errors", !r.errors.length, r.errors.slice(0, 2).join(" | "));
    ok("table: mtg stop sends stopchain with the colour", (got.sent || []).some((x) => x.t === "stopchain" && x.p?.color === "Blue"), JSON.stringify(got));
    ok("table: mtg stop's chat line is hidden", got.v === "false", got.v);
    ok("table: mtg help lists mtg stop", (step("help").fx || []).some((l) => /mtg stop - stop a long run of triggers/.test(l)), (step("help").fx || []).join(" | ").slice(0, 300));
  }
  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
