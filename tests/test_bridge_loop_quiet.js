// "No responses for this loop" (bridge.js loopQuietFor, loopQuietLive, loopQuietShow, loopQuietOn, loopQuietOff; the
// user 2026-11-17). While Blue repeats a loop ×N (test_bridge_repeat_loop.js's Kiki-Jiki + Zealous Conscripts), White,
// the other human seat, is offered a button that answers its priority passes for the rest of that loop. The checks:
//  - the offer: on White's panel once the repeat starts, "No responses for this loop (Blue repeating ×3)" under the
//    question id "__loopquiet"; in White's priority question right after End turn; never to Blue, never with no loop,
//    never to an AI seat (it has no seat)
//  - pressed: White's priority passed, said to everyone ("White: no responses during Blue's loop."), the panel "No
//    responses during Blue's loop" with Stop; White's later priorities passed unseen (with something to respond with);
//    White's own trigger's question still asked; the panel back once a question is answered, never sent again unchanged,
//    never over an open question; the loop goes
//    on; a priority for a player White controls is asked
//  - it ends: Blue's loop ending or stopping (and the panel cleared), the step changing, White's Stop (the next
//    priority with a stack asked), White's "mtg stop" (said), a rewind; the panel's button pressed once it's over
//    clears the panel
//   node tests/test_bridge_loop_quiet.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}\n`); } };

const KIKI_TEXT = "{T}: Create a token that's a copy of target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step.";
const CONSCRIPTS_TEXT = "When Zealous Conscripts enters, gain control of target permanent until end of turn. Untap that permanent. It gains haste until end of turn.";
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const card = (id, name, extra = {}) => ({ id, controllerId: "player-0", ownerId: "player-0", identity: { name, ...(extra.token ? { isToken: true } : {}) }, types: ["Creature"],
  tapped: !!extra.tapped, text: extra.text || "" });
function board({ kikiTapped = false, tokens = 0, stack = [], step = "main1", turn = 5 } = {}) {
  const mine = [card("engine-card-10", "Kiki-Jiki, Mirror Breaker", { tapped: kikiTapped, text: KIKI_TEXT }), card("engine-card-11", "Zealous Conscripts", { text: CONSCRIPTS_TEXT }),
    ...Array.from({ length: tokens }, (_, k) => card(`engine-card-${20 + k}`, "Zealous Conscripts", { token: true, text: CONSCRIPTS_TEXT }))];
  const zones = ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, count: 0,
    cards: zone !== "battlefield" ? [] : ownerId === "player-0" ? mine : [{ id: "engine-card-30", controllerId: "player-1", ownerId: "player-1", identity: { name: "Forest" }, types: ["Land"], tapped: false }] })));
  return { turn, step, activePlayerId: "player-0", priorityPlayerId: "player-0", stack,
    players: [{ id: "player-0", life: 40, manaPool: {} }, { id: "player-1", life: 40, manaPool: {} }], zones };
}
const kikiAbility = { id: "engine-stack-50", sourceId: "engine-card-10", controllerId: "player-0", identity: { name: "Kiki-Jiki, Mirror Breaker" },
  sourceAbilityText: KIKI_TEXT, targets: [{ kind: "card", id: "engine-card-11" }], text: `Kiki-Jiki, Mirror Breaker (10) - ${KIKI_TEXT}` };
const conscriptsTrigger = (tok) => ({ id: `engine-stack-${60 + tok}`, sourceId: `engine-card-${20 + tok}`, controllerId: "player-0", identity: { name: "Zealous Conscripts", isToken: true },
  isTrigger: true, sourceAbilityText: CONSCRIPTS_TEXT, targets: [{ kind: "card", id: "engine-card-10" }], text: `Zealous Conscripts (${20 + tok}) - ${CONSCRIPTS_TEXT}` });
const kikiAct = (id) => ({ id, type: "activateAbility", cardId: "engine-card-10", description: KIKI_TEXT, cost: "{T}" });
const opt = (id) => ({ id, type: "cast", cardId: "engine-card-5", label: "Cast Opt", mode: { type: "normal" } });
const bolt = (id = "prompt-action-0") => ({ id, type: "cast", cardId: "engine-card-40", label: "Cast Lightning Bolt", mode: { type: "normal" } });

// Blue and White, both human; White's seat absent with { ai: true } (an AI seat has no Seat)
function setup(h, { ai = false } = {}) {
  const mk = (color, slot) => {
    const s = new h.B.Seat(color, "neheb_minotaur_commander");
    s.slot = slot;
    s.stops = new Set();
    s.board = { state: { gameView: board() }, fingerprint: null };
    return s;
  };
  const seat = mk("Blue", "player-0"), white = ai ? null : mk("White", "player-1");
  const seats = new Map([["Blue", seat], ...(white ? [["White", white]] : [])]);
  h.B._setGame({ seats, bots: ai ? 1 : 0, total: 2, playerOrder: ["tts-Blue-ab12", ai ? "self-hosted-node-77-bot" : "tts-White-cd34"],
    slotNames: { "player-0": "Blue", "player-1": ai ? "AI 1" : "White" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  const calls = [];
  for (const s of [seat, white].filter(Boolean)) {
    const respond = s.respond.bind(s);
    s.respond = (promptId, type, out) => { calls.push({ color: s.color, promptId, type, out }); return respond(promptId, type, out); };
  }
  return { seat, white, calls };
}
let pid = 500;
const chats = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const panels = (h, color, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.color === color).map((e) => e.tts);
const quietPanels = (h, color, mark = 0) => panels(h, color, mark).filter((p) => p.promptId === "__loopquiet");
const optIds = (s) => (s.prompt?.ui?.options || []).map((o) => o.id);
const say = async (h, t, p, color = "Blue") => { h.B.onTTS({ t, json: JSON.stringify({ color, ...p }) }); await h.flush(); };
const answer = (h, promptId, choice, color = "Blue") => say(h, "answer", { promptId, choice: [choice] }, color);
async function ask(h, s, gv, input, extra = {}) {
  s.board.state.gameView = gv;
  const id = ++pid;
  h.B.onPrompt(s, { promptId: id, decidingPlayerId: s.slot, input, ...extra });
  await h.flush();
  return id;
}
const prio = (h, s, gv, actions) => ask(h, s, gv, { type: "chooseAction", actions, presentation: { title: "Your priority" } });
const kikiTarget = (h, seat, tok) => ask(h, seat, board({ kikiTapped: true, tokens: tok }),
  { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, candidates: [{ id: "engine-card-11", kind: "card" }], cancellable: true, presentation: { title: "Choose target nonlegendary creature you control" } },
  { sourceCard: { id: "engine-card-10", identity: { name: "Kiki-Jiki, Mirror Breaker" } }, sourceAbilityText: KIKI_TEXT });
const trigTarget = (h, seat, tok) => ask(h, seat, board({ kikiTapped: true, tokens: tok + 1, stack: [conscriptsTrigger(tok)] }),
  { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, presentation: { title: "Choose target permanent" },
    candidates: ["engine-card-10", "engine-card-11", ...Array.from({ length: tok + 1 }, (_, k) => `engine-card-${20 + k}`), "engine-card-30"].map((id) => ({ id, kind: "card" })) },
  { sourceCard: { id: `engine-card-${20 + tok}`, identity: { name: "Zealous Conscripts", isToken: true } }, sourceAbilityText: CONSCRIPTS_TEXT });
const acts = (tok, kiki = true) => [...(tok ? [opt("prompt-action-0")] : []), ...(kiki ? [kikiAct(`prompt-action-${tok ? 1 : 0}`)] : [])];
async function handPass(h, seat, tok) {
  const p1 = await prio(h, seat, board({ tokens: tok }), acts(tok));
  await answer(h, p1, `prompt-action-${tok ? 1 : 0}`);
  const t1 = await kikiTarget(h, seat, tok);
  if (seat.prompt?.promptId === t1) await answer(h, t1, "card|engine-card-11");
  await prio(h, seat, board({ kikiTapped: true, tokens: tok, stack: [kikiAbility] }), [opt("prompt-action-0")]);
  const t2 = await trigTarget(h, seat, tok);
  if (seat.prompt?.promptId === t2) await answer(h, t2, "card|engine-card-10");
  await prio(h, seat, board({ kikiTapped: true, tokens: tok + 1, stack: [conscriptsTrigger(tok)] }), [opt("prompt-action-0")]);
  return prio(h, seat, board({ tokens: tok + 1 }), acts(tok + 1));
}
// One pass while repeating, White's priority (Bolt in hand) asked over Kiki-Jiki's ability between; the id White got
async function loopPass(h, seat, white, tok, { whiteGv } = {}) {
  await kikiTarget(h, seat, tok);
  const w = white && seat.loop ? await prio(h, white, whiteGv || board({ kikiTapped: true, tokens: tok, stack: [kikiAbility] }), [bolt()]) : null;
  if (!seat.loop) return w;
  await prio(h, seat, board({ kikiTapped: true, tokens: tok, stack: [kikiAbility] }), [opt("prompt-action-0")]);
  if (!seat.loop) return w;
  await trigTarget(h, seat, tok);
  if (!seat.loop) return w;
  await prio(h, seat, board({ kikiTapped: true, tokens: tok + 1, stack: [conscriptsTrigger(tok)] }), [opt("prompt-action-0")]);
  if (!seat.loop) return w;
  await prio(h, seat, board({ tokens: tok + 1 }), acts(tok + 1));
  return w;
}
const lastOf = (calls, color) => calls.filter((c) => c.color === color).pop();
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } catch (e) { ok("a case ran without throwing", false, e.stack); return null; } finally { harness.restore(); } };
// Blue's loop ×n under way
async function started(h, seat, n = 3) {
  await handPass(h, seat, 0);
  await say(h, "repeatloop", { n });
}
// White presses the button in its priority question over Kiki-Jiki's ability
async function quietByPriority(h, white) {
  const w = await prio(h, white, board({ kikiTapped: true, stack: [kikiAbility] }), [bolt()]);
  await answer(h, w, "__quiet", "White");
  return w;
}
const QUIET_LABEL = "No responses for this loop (Blue repeating ×3)";

(async () => {
  // 1. the offer
  await run(async (h) => {
    const { seat, white } = setup(h);
    // (no loop: no button)
    await prio(h, white, board({ kikiTapped: true, stack: [kikiAbility] }), [bolt()]);
    ok("offer: none with no loop", !optIds(white).includes("__quiet"), optIds(white).join(","));
    white.prompt = null;
    const mark = h.effects.length;
    await started(h, seat, 3);
    const wp = quietPanels(h, "White", mark);
    ok("offer: White's panel once the repeat starts", wp.length === 1 && wp[0].options?.length === 1 && wp[0].options[0].id === "__quiet" && wp[0].options[0].label === QUIET_LABEL,
      JSON.stringify(wp));
    ok("offer: the panel's title names the loop", wp[0]?.title === "Blue repeats a loop ×3 (Kiki-Jiki, Mirror Breaker)", wp[0]?.title);
    ok("offer: never to Blue", quietPanels(h, "Blue", mark).length === 0, JSON.stringify(quietPanels(h, "Blue", mark)));
    const w = await prio(h, white, board({ kikiTapped: true, stack: [kikiAbility] }), [bolt()]);
    const o = optIds(white);
    ok("offer: in White's priority question, right after End turn", white.prompt?.promptId === w && o.indexOf("__quiet") === o.indexOf("__endturn") + 1, o.join(","));
    ok("offer: its label", (white.prompt?.ui?.options || []).find((x) => x.id === "__quiet")?.label === QUIET_LABEL, JSON.stringify(white.prompt?.ui?.options));
  });
  await run(async (h) => {
    const { seat } = setup(h, { ai: true });
    const mark = h.effects.length;
    await started(h, seat, 3);
    ok("offer: an AI seat gets nothing", panels(h, "White", mark).length === 0, JSON.stringify(panels(h, "White", mark)));
    ok("offer: Blue's own panel is its progress", quietPanels(h, "Blue", mark).length === 0 && panels(h, "Blue", mark).some((p) => p.promptId === "__loop"), JSON.stringify(panels(h, "Blue", mark)));
  });
  // 2. pressed in the priority question: passed, said, the panel; then passed unseen
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    await started(h, seat, 3);
    const mark = h.effects.length;
    const w = await quietByPriority(h, white);
    const c = lastOf(calls, "White");
    ok("pressed: White's priority passed", c?.promptId === w && c.out?.type === "pass", JSON.stringify(c));
    ok("pressed: said to everyone", chats(h, mark).includes("[MTG] White: no responses during Blue's loop."), JSON.stringify(chats(h, mark)));
    const wp = quietPanels(h, "White", mark);
    ok("pressed: the panel says it, with Stop", wp.length && wp[wp.length - 1].title === "No responses during Blue's loop" && wp[wp.length - 1].options?.[0]?.id === "__quietstop"
      && panels(h, "White", mark).pop()?.promptId === "__loopquiet", JSON.stringify(panels(h, "White", mark)));
    ok("pressed: the loop goes on", !!seat.loop, "ended");
    const m2 = h.effects.length, c0 = calls.length;
    const w2 = await loopPass(h, seat, white, 1);
    const c2 = calls.slice(c0).find((x) => x.color === "White");
    ok("quiet: White's next priority passes unseen", c2?.promptId === w2 && c2.out?.type === "pass" && white.prompt == null, JSON.stringify({ c2, open: white.prompt?.promptId }));
    ok("quiet: the loop counts the pass", seat.loop?.done === 1, JSON.stringify(seat.loop && seat.loop.done));
    ok("quiet: a priority passed unseen leaves the panel as it is", panels(h, "White", m2).length === 0, JSON.stringify(panels(h, "White", m2)));
    // White's own trigger's question is asked
    const t = await ask(h, white, board({ kikiTapped: true, tokens: 2, stack: [kikiAbility] }), { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, presentation: { title: "Choose target creature" },
      candidates: [{ id: "engine-card-10", kind: "card" }] }, { sourceCard: { id: "engine-card-31", identity: { name: "Fiery Tantrum" } }, sourceAbilityText: "Whenever a creature enters, choose target creature." });
    ok("quiet: White's own trigger's question is asked", white.prompt?.promptId === t && !!white.loopQuiet, JSON.stringify({ open: white.prompt?.promptId, t }));
    // (answered: the panel is back at once, with the same words)
    const m3 = h.effects.length;
    await answer(h, t, "card|engine-card-10", "White");
    const again = panels(h, "White", m3);
    ok("quiet: the panel comes back once the question is answered", again.length >= 2 && again[again.length - 1].promptId === "__loopquiet" && again[again.length - 1].title === "No responses during Blue's loop",
      JSON.stringify(again));
  });
  // (pressed on the panel: the same)
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    await started(h, seat, 3);
    const mark = h.effects.length;
    await answer(h, "__loopquiet", "__quiet", "White");
    ok("panel press: on, said", !!white.loopQuiet && chats(h, mark).includes("[MTG] White: no responses during Blue's loop."), JSON.stringify(chats(h, mark)));
    ok("panel press: the panel says it", quietPanels(h, "White", mark).pop()?.title === "No responses during Blue's loop", JSON.stringify(quietPanels(h, "White", mark)));
    const c0 = calls.length;
    const w = await prio(h, white, board({ kikiTapped: true, stack: [kikiAbility] }), [bolt()]);
    ok("panel press: White's priority passes unseen", calls.slice(c0).some((x) => x.color === "White" && x.promptId === w && x.out?.type === "pass") && white.prompt == null, JSON.stringify(calls.slice(c0)));
  });
  // (unchanged and nothing asked between: not sent again at Blue's panel refresh, every 10th pass)
  await run(async (h) => {
    const { seat, white } = setup(h);
    await started(h, seat, 20);
    await answer(h, "__loopquiet", "__quiet", "White");
    const m2 = h.effects.length;
    for (let k = 1; k <= 10 && seat.loop; k++) await loopPass(h, seat, null, k);
    ok("panel: Blue's refresh came (10 passes)", seat.loop?.done === 10 && panels(h, "Blue", m2).some((p) => p.title === "Repeating 11/20"), JSON.stringify({ done: seat.loop?.done }));
    ok("panel: not sent again while nothing changed", quietPanels(h, "White", m2).length === 0 && !!white.loopQuiet, JSON.stringify(quietPanels(h, "White", m2)));
  });
  // (never over a question: White's open question at the start keeps the panel off; answered, the button comes)
  await run(async (h) => {
    const { seat, white } = setup(h);
    const t = await ask(h, white, board(), { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, presentation: { title: "Choose target creature" },
      candidates: [{ id: "engine-card-10", kind: "card" }] }, { sourceCard: { id: "engine-card-31", identity: { name: "Fiery Tantrum" } }, sourceAbilityText: "Whenever a creature enters, choose target creature." });
    const mark = h.effects.length;
    await started(h, seat, 20);
    for (let k = 1; k <= 10 && seat.loop; k++) await loopPass(h, seat, null, k);
    ok("over a question: no panel while White's question is open", white.prompt?.promptId === t && quietPanels(h, "White", mark).length === 0, JSON.stringify(quietPanels(h, "White", mark)));
    const m2 = h.effects.length;
    await answer(h, t, "card|engine-card-10", "White");
    ok("over a question: answered, the button comes", panels(h, "White", m2).pop()?.options?.[0]?.id === "__quiet", JSON.stringify(panels(h, "White", m2)));
  });
  // (a priority for a player White controls is asked)
  await run(async (h) => {
    const { seat, white } = setup(h);
    await started(h, seat, 3);
    await answer(h, "__loopquiet", "__quiet", "White");
    const gv = board({ kikiTapped: true, stack: [kikiAbility] });
    gv.players.push({ id: "player-2", life: 40, manaPool: {}, controlledBy: "player-1" });
    gv.priorityPlayerId = "player-2";
    white.board.state.gameView = gv;
    const id = ++pid;
    h.B.onPrompt(white, { promptId: id, decidingPlayerId: "player-2", input: { type: "chooseAction", actions: [bolt()], presentation: { title: "Your priority" } } });
    await h.flush();
    ok("controlled player: its priority is asked", white.prompt?.promptId === id, JSON.stringify({ open: white.prompt?.promptId, id }));
  });
  // 3. it ends
  await run(async (h) => {
    const { seat, white } = setup(h);
    await started(h, seat, 3);
    await answer(h, "__loopquiet", "__quiet", "White");
    const mark = h.effects.length;
    await answer(h, "__loop", "__loopstop");
    ok("loop end: White's no-responses ends", !seat.loop && white.loopQuiet == null, JSON.stringify({ loop: !!seat.loop, q: !!white.loopQuiet }));
    const last = panels(h, "White", mark).pop();
    ok("loop end: White's panel is cleared", last && last.promptId === null, JSON.stringify(panels(h, "White", mark)));
    const w = await prio(h, white, board({ kikiTapped: true, stack: [kikiAbility] }), [bolt()]);
    ok("loop end: White's next priority is asked, no button", white.prompt?.promptId === w && !optIds(white).includes("__quiet"), optIds(white).join(","));
  });
  await run(async (h) => {
    const { seat, white } = setup(h);
    await started(h, seat, 2);
    await answer(h, "__loopquiet", "__quiet", "White");
    await loopPass(h, seat, null, 1);
    await loopPass(h, seat, null, 2);
    ok("loop done: all passes done, White's no-responses ends", !seat.loop && white.loopQuiet == null, JSON.stringify({ loop: !!seat.loop, q: !!white.loopQuiet }));
  });
  await run(async (h) => {
    const { seat, white } = setup(h);
    await started(h, seat, 3);
    await answer(h, "__loopquiet", "__quiet", "White");
    const w = await prio(h, white, board({ kikiTapped: true, stack: [kikiAbility], step: "main2" }), [bolt()]);
    ok("step changed: White's priority is asked", white.prompt?.promptId === w && white.loopQuiet == null, JSON.stringify({ open: white.prompt?.promptId, w, q: !!white.loopQuiet }));
  });
  await run(async (h) => {
    const { seat, white } = setup(h);
    await started(h, seat, 3);
    await answer(h, "__loopquiet", "__quiet", "White");
    const mark = h.effects.length;
    await answer(h, "__loopquiet", "__quietstop", "White");
    ok("Stop: off at once", white.loopQuiet == null && white.stopChain === true, JSON.stringify({ q: !!white.loopQuiet, sc: white.stopChain }));
    ok("Stop: the button is offered again", quietPanels(h, "White", mark).pop()?.options?.[0]?.id === "__quiet", JSON.stringify(quietPanels(h, "White", mark)));
    // (nothing to respond with: the next priority with a stack is asked all the same)
    const w = await prio(h, white, board({ kikiTapped: true, stack: [kikiAbility] }), []);
    ok("Stop: White's next priority is asked", white.prompt?.promptId === w, JSON.stringify({ open: white.prompt?.promptId, w }));
    ok("Stop: the loop goes on until White responds", !!seat.loop, "ended");
    await answer(h, w, "__pass", "White");
  });
  await run(async (h) => {
    const { seat, white } = setup(h);
    await started(h, seat, 3);
    await answer(h, "__loopquiet", "__quiet", "White");
    const mark = h.effects.length;
    await say(h, "stopchain", {}, "White");
    ok("mtg stop: off, said", white.loopQuiet == null && white.stopChain === true
      && chats(h, mark).includes("[MTG] Stop: your next priority with something on the stack is asked; responding stops the loop."), JSON.stringify(chats(h, mark)));
    ok("mtg stop: Blue's loop goes on", !!seat.loop, "ended");
  });
  await run(async (h) => {
    const { seat, white } = setup(h);
    await started(h, seat, 3);
    await answer(h, "__loopquiet", "__quiet", "White");
    white.clearFollowUps();
    ok("rewind: forgotten", white.loopQuiet == null, "kept");
    seat.clearFollowUps();
    const mark = h.effects.length;
    await answer(h, "__loopquiet", "__quiet", "White");
    ok("over: the button pressed once the loop is gone does nothing and clears the panel", white.loopQuiet == null && panels(h, "White", mark).pop()?.promptId === null,
      JSON.stringify({ q: !!white.loopQuiet, p: panels(h, "White", mark) }));
  });
  // (Blue's loop gone with no end said, Blue's rewind: White's next priority is asked)
  await run(async (h) => {
    const { seat, white } = setup(h);
    await started(h, seat, 3);
    await answer(h, "__loopquiet", "__quiet", "White");
    seat.clearFollowUps();
    const w = await prio(h, white, board({ kikiTapped: true, stack: [kikiAbility] }), [bolt()]);
    ok("loop gone: White's next priority is asked", white.prompt?.promptId === w && white.loopQuiet == null, JSON.stringify({ open: white.prompt?.promptId, w, q: !!white.loopQuiet }));
  });
  // (White responding with the button not pressed stops Blue's loop as before)
  await run(async (h) => {
    const { seat, white } = setup(h);
    await started(h, seat, 3);
    const w = await prio(h, white, board({ kikiTapped: true, stack: [kikiAbility] }), [bolt()]);
    await answer(h, w, "prompt-action-0", "White");
    ok("respond: White's Bolt stops Blue's loop", !seat.loop, "still repeating");
  });

  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
