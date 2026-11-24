// "Repeat ×N", the shortcut for an optional loop (bridge.js loopNote, loopSig, loopAsk, loopCands, loopMap, loopFind,
// loopOfferFor, loopBegin, loopStep, loopEnd, loopShow, loopPicker; CR 732.2; docs/stress-catalog.md #2, the user
// 2026-11-16). Kiki-Jiki, Mirror Breaker + Zealous Conscripts as Forge asks it: Blue activates Kiki-Jiki (priority,
// then its target), passes with the ability on the stack, targets Kiki-Jiki with the token Conscripts' trigger (a new
// token, a new card id, each pass), passes again, and is back at priority on the same board (Kiki-Jiki untapped, the
// token not counted). An action's id is its place in the list ("prompt-action-1"), so it moves as the list grows.
// The checks:
//  - no offer before a pass; after one, "Repeat ×N" right after End turn; the how-many question (×1, ×10, ×100, ×1000,
//    How many…, Back); Back and How many… 0 go back to the priority question; a timeout goes back too
//  - ×2: the first answer at once, each later question answered unseen with its ids mapped (the action's new place, the
//    token's new id), the board checked at each pass's end, one line to everyone at the start and at the end
//  - the panel's "Repeating 1/2" with Stop while it runs; Stop and "mtg stop" end it and clear the panel
//  - it stops, said, and the question is asked as usual: another question; a target gone; the action gone; the board
//    not the same at a pass's end; another player's spell on the stack (their trigger isn't one); another seat playing
//    something; the step changing; the engine's runaway question; the game ending
//  - "mtg repeat <n>" (repeatloop): n at once, more than 1,000 clipped and said, no n asks how many; no pass yet, not
//    your priority, already repeating: said
//  - a rewind (clearFollowUps) forgets it; another turn's answers are never a pass
//   node tests/test_bridge_repeat_loop.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}\n`); } };

const KIKI_TEXT = "{T}: Create a token that's a copy of target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step.";
const CONSCRIPTS_TEXT = "When Zealous Conscripts enters, gain control of target permanent until end of turn. Untap that permanent. It gains haste until end of turn.";
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const card = (id, name, extra = {}) => ({ id, controllerId: "player-0", ownerId: "player-0", identity: { name, ...(extra.token ? { isToken: true } : {}) }, types: ["Creature"],
  tapped: !!extra.tapped, text: extra.text || "" });
// Blue's battlefield: Kiki-Jiki (tapped or not), Zealous Conscripts, the tokens made so far; AI 1's Forest
function board({ kikiTapped = false, tokens = 0, stack = [], step = "main1", turn = 5, conscripts = true, extra = [] } = {}) {
  const mine = [card("engine-card-10", "Kiki-Jiki, Mirror Breaker", { tapped: kikiTapped, text: KIKI_TEXT }), ...(conscripts ? [card("engine-card-11", "Zealous Conscripts", { text: CONSCRIPTS_TEXT })] : []),
    ...Array.from({ length: tokens }, (_, k) => card(`engine-card-${20 + k}`, "Zealous Conscripts", { token: true, text: CONSCRIPTS_TEXT })), ...extra];
  const zones = ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, count: 0,
    cards: zone !== "battlefield" ? [] : ownerId === "player-0" ? mine : [{ id: "engine-card-30", controllerId: "player-1", ownerId: "player-1", identity: { name: "Forest" }, types: ["Land"], tapped: false }] })));
  return { turn, step, activePlayerId: "player-0", priorityPlayerId: "player-0", stack,
    players: [{ id: "player-0", life: 40, manaPool: {} }, { id: "player-1", life: 40, manaPool: {} }], zones };
}
const kikiAbility = { id: "engine-stack-50", sourceId: "engine-card-10", controllerId: "player-0", identity: { name: "Kiki-Jiki, Mirror Breaker" },
  sourceAbilityText: KIKI_TEXT, targets: [{ kind: "card", id: "engine-card-11" }], text: `Kiki-Jiki, Mirror Breaker (10) - ${KIKI_TEXT}` };
const conscriptsTrigger = (tok) => ({ id: `engine-stack-${60 + tok}`, sourceId: `engine-card-${20 + tok}`, controllerId: "player-0", identity: { name: "Zealous Conscripts", isToken: true },
  isTrigger: true, sourceAbilityText: CONSCRIPTS_TEXT, targets: [{ kind: "card", id: "engine-card-10" }], text: `Zealous Conscripts (${20 + tok}) - ${CONSCRIPTS_TEXT}` });
const BOLT = { id: "engine-stack-900", sourceId: "engine-card-900", controllerId: "player-1", identity: { name: "Lightning Bolt" }, isPermanentSpell: false,
  sourceAbilityText: "Lightning Bolt deals 3 damage to any target.", targets: [{ kind: "player", id: "player-0" }], text: "Lightning Bolt (900) - Lightning Bolt deals 3 damage to any target." };
const kikiAct = (id) => ({ id, type: "activateAbility", cardId: "engine-card-10", description: KIKI_TEXT, cost: "{T}" });
const opt = (id) => ({ id, type: "cast", cardId: "engine-card-5", label: "Cast Opt", mode: { type: "normal" } });

function setup(h, { white = false } = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.stops = new Set();
  seat.board = { state: { gameView: board() }, fingerprint: null };
  const seats = new Map([["Blue", seat]]);
  let other = null;
  if (white) {
    other = new h.B.Seat("White", "neheb_minotaur_commander");
    other.slot = "player-1";
    other.stops = new Set();
    other.board = { state: { gameView: board() }, fingerprint: null };
    seats.set("White", other);
  }
  h.B._setGame({ seats, bots: white ? 0 : 1, total: 2, playerOrder: ["tts-Blue-ab12", white ? "tts-White-cd34" : "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": white ? "White" : "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  const calls = [];
  const respond = seat.respond.bind(seat);
  seat.respond = (promptId, type, out) => { calls.push({ promptId, type, out }); return respond(promptId, type, out); };
  return { seat, other, calls };
}
let pid = 500;
const shownIds = (h, mark) => h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.color === "Blue" && e.tts.promptId != null).map((e) => e.tts.promptId);
const chats = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const optIds = (seat) => (seat.prompt?.ui?.options || []).map((o) => o.id);
const say = async (h, t, p, color = "Blue") => { h.B.onTTS({ t, json: JSON.stringify({ color, ...p }) }); await h.flush(); };
const answer = (h, promptId, choice, color = "Blue") => say(h, "answer", { promptId, choice: [choice] }, color);
// one question to Blue on this board; its id
async function ask(h, seat, gv, input, extra = {}) {
  seat.board.state.gameView = gv;
  const id = ++pid;
  h.B.onPrompt(seat, { promptId: id, decidingPlayerId: "player-0", input, ...extra });
  await h.flush();
  return id;
}
const prio = (h, seat, gv, actions) => ask(h, seat, gv, { type: "chooseAction", actions, presentation: { title: "Your priority" } });
const kikiTarget = (h, seat, tok, cands = ["engine-card-11"]) => ask(h, seat, board({ kikiTapped: true, tokens: tok }),
  { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, candidates: cands.map((id) => ({ id, kind: "card" })), cancellable: true, presentation: { title: "Choose target nonlegendary creature you control" } },
  { sourceCard: { id: "engine-card-10", identity: { name: "Kiki-Jiki, Mirror Breaker" } }, sourceAbilityText: KIKI_TEXT });
const trigTarget = (h, seat, tok, title = "Choose target permanent") => ask(h, seat, board({ kikiTapped: true, tokens: tok + 1, stack: [conscriptsTrigger(tok)] }),
  { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, presentation: { title },
    candidates: ["engine-card-10", "engine-card-11", ...Array.from({ length: tok + 1 }, (_, k) => `engine-card-${20 + k}`), "engine-card-30"].map((id) => ({ id, kind: "card" })) },
  { sourceCard: { id: `engine-card-${20 + tok}`, identity: { name: "Zealous Conscripts", isToken: true } }, sourceAbilityText: CONSCRIPTS_TEXT });
// The actions at a priority: Opt first once a token is out (so Kiki-Jiki's moves to prompt-action-1), Kiki-Jiki's while untapped
const acts = (tok, kiki = true) => [...(tok ? [opt("prompt-action-0")] : []), ...(kiki ? [kikiAct(`prompt-action-${tok ? 1 : 0}`)] : [])];
// One pass by hand from the priority on the empty board with `tok` tokens out; the priority after it, asked
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
// One pass while repeating (each question as Forge asks it); the ids asked. stopAt: a step's question replaced
async function loopPass(h, seat, tok, change = {}) {
  const ids = [];
  ids.push(await (change.t1 ? change.t1() : kikiTarget(h, seat, tok)));
  if (!seat.loop) return ids;
  ids.push(await prio(h, seat, board({ kikiTapped: true, tokens: tok, stack: change.stack2 || [kikiAbility] }), [opt("prompt-action-0")]));
  if (!seat.loop) return ids;
  ids.push(await (change.t2 ? change.t2() : trigTarget(h, seat, tok)));
  if (!seat.loop) return ids;
  ids.push(await prio(h, seat, board({ kikiTapped: true, tokens: tok + 1, stack: [conscriptsTrigger(tok)], ...(change.step3 ? { step: change.step3 } : {}) }), [opt("prompt-action-0")]));
  if (!seat.loop) return ids;
  ids.push(await prio(h, seat, change.end || board({ tokens: tok + 1 }), change.endActs || acts(tok + 1)));
  return ids;
}
const lastOut = (calls) => calls[calls.length - 1]?.out;
// (a case that throws is one failure, and the next cases still run)
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } catch (e) { ok("a case ran without throwing", false, e.stack); return null; } finally { harness.restore(); } };
// A loop started ×n from a hand pass; what the start sent
async function started(h, seat, n = 2) {
  const p = await handPass(h, seat, 0);
  await say(h, "repeatloop", { n });
  return p;
}

(async () => {
  // 1. no offer before a pass; after one, Repeat ×N after End turn
  await run(async (h) => {
    const { seat } = setup(h);
    await prio(h, seat, board(), acts(0));
    ok("offer: none before any pass", !optIds(seat).includes("__loop"), optIds(seat).join(","));
    seat.prompt = null;
    seat.loopLog = null;
    const p = await handPass(h, seat, 0);
    const o = optIds(seat);
    ok("offer: after one pass back to the same board, Repeat ×N", seat.prompt?.promptId === p && o.includes("__loop"), o.join(","));
    ok("offer: right after End turn", o.indexOf("__loop") === o.indexOf("__endturn") + 1, o.join(","));
    ok("offer: its label", (seat.prompt.ui.options.find((x) => x.id === "__loop") || {}).label === "Repeat ×N", JSON.stringify(seat.prompt.ui.options));
    ok("offer: named by the card it played", seat.loopOffer?.name === "Kiki-Jiki, Mirror Breaker" && seat.loopOffer.steps.length === 5, JSON.stringify(seat.loopOffer && { n: seat.loopOffer.name, s: seat.loopOffer.steps.length }));
    // the how-many question; Back returns
    await answer(h, p, "__loop");
    const ids = optIds(seat).join(",");
    ok("picker: ×1, ×10, ×100, ×1000, How many…, Back", ids === "__loop:1,__loop:10,__loop:100,__loop:1000,__loop:some,__back", ids);
    ok("picker: its title names the loop", /Repeat Kiki-Jiki, Mirror Breaker how many more times\?/.test(seat.prompt?.ui?.title || ""), seat.prompt?.ui?.title);
    ok("picker: a turn timer takes Back", h.B._timeoutChoice(seat.prompt.ui)[0] === "__back", JSON.stringify(h.B._timeoutChoice(seat.prompt.ui)));
    await answer(h, p, "__back");
    ok("picker: Back returns to the priority question, nothing sent", seat.prompt?.promptId === p && optIds(seat).includes("__loop") && !seat.loop, optIds(seat).join(","));
    // How many…: 0 (a timer's answer) goes back too
    await answer(h, p, "__loop");
    await answer(h, p, "__loop:some");
    ok("how many: 0 to 1000 starting at 10, a timer answers 0", seat.prompt?.ui?.mode === "number" && seat.prompt.ui.min === 0 && seat.prompt.ui.max === 1000 && seat.prompt.ui.default === 10
      && h.B._timeoutChoice(seat.prompt.ui)[0] === "0", JSON.stringify(seat.prompt?.ui));
    await answer(h, p, 0);
    ok("how many: 0 goes back to the priority question", seat.prompt?.promptId === p && optIds(seat).includes("__loop") && !seat.loop, optIds(seat).join(","));
    await answer(h, p, "__loop");
    await answer(h, p, "__loop:some");
    await answer(h, p, 7);
    ok("how many: 7 starts ×7", seat.loop?.total === 7, JSON.stringify(seat.loop && seat.loop.total));
  });
  // 2. ×2 by the button: answered unseen, ids mapped, the board checked, said at start and end
  await run(async (h) => {
    const { seat, calls } = setup(h);
    const p = await handPass(h, seat, 0);
    await answer(h, p, "__loop");
    const mark = h.effects.length, c0 = calls.length;
    await answer(h, p, "__loop:10");
    ok("×10: the first answer is Kiki-Jiki's action at its new place", calls.length === c0 + 1 && calls[c0].promptId === p && lastOut(calls)?.type === "act" && lastOut(calls).actionId === "prompt-action-1",
      JSON.stringify(calls.slice(c0)));
    ok("×10: said to everyone", chats(h, mark).some((t) => t === "[MTG] Blue repeats a loop ×10 (Kiki-Jiki, Mirror Breaker). Anyone may respond when they get priority, and that stops it."), JSON.stringify(chats(h, mark)));
    const panel = h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.color === "Blue").map((e) => e.tts);
    ok("×10: the panel shows Repeating 1/10 with Stop, after the priority question is closed", panel.length >= 2 && panel[panel.length - 2].promptId === null && panel[panel.length - 1].promptId === "__loop"
      && panel[panel.length - 1].title === "Repeating 1/10" && panel[panel.length - 1].options?.[0]?.id === "__loopstop", JSON.stringify(panel));
    if (seat.loop) seat.loop.total = 2; // (two passes are enough to see it)
    const m2 = h.effects.length, c1 = calls.length;
    const ids1 = await loopPass(h, seat, 1);
    ok("×2: pass 1's questions all answered", calls.length === c1 + 5 && seat.loop?.done === 1, JSON.stringify(calls.slice(c1).map((c) => c.out)));
    ok("×2: Kiki-Jiki's target the same Conscripts", JSON.stringify(calls[c1].out) === JSON.stringify({ type: "boardTargets", chosen: [{ kind: "card", id: "engine-card-11" }] }), JSON.stringify(calls[c1].out));
    ok("×2: the priorities between passed", calls[c1 + 1].out.type === "pass" && calls[c1 + 3].out.type === "pass", JSON.stringify([calls[c1 + 1].out, calls[c1 + 3].out]));
    ok("×2: the new token's trigger targets Kiki-Jiki", JSON.stringify(calls[c1 + 2].out) === JSON.stringify({ type: "boardTargets", chosen: [{ kind: "card", id: "engine-card-10" }] }), JSON.stringify(calls[c1 + 2].out));
    ok("×2: the pass's end starts the next: Kiki-Jiki's action at its place", calls[c1 + 4].out.type === "act" && calls[c1 + 4].out.actionId === "prompt-action-1", JSON.stringify(calls[c1 + 4].out));
    ok("×2: nothing shown during the pass", !shownIds(h, m2).some((x) => ids1.includes(x)), JSON.stringify(shownIds(h, m2)));
    const m3 = h.effects.length;
    const ids2 = await loopPass(h, seat, 2);
    const last = ids2[ids2.length - 1];
    ok("×2: done, the last priority is asked", !seat.loop && seat.prompt?.promptId === last, JSON.stringify({ loop: !!seat.loop, open: seat.prompt?.promptId, last }));
    ok("×2: said once at the end", chats(h, m3).filter((t) => /repeated the loop/.test(t)).length === 1 && chats(h, m3).includes("[MTG] Blue repeated the loop 2× (Kiki-Jiki, Mirror Breaker)."), JSON.stringify(chats(h, m3)));
    ok("×2: the last priority offers it again", optIds(seat).includes("__loop"), optIds(seat).join(","));
  });
  // 3. mtg repeat <n>: at once; clipped at 1,000; no n asks how many
  await run(async (h) => {
    const { seat, calls } = setup(h);
    const p = await handPass(h, seat, 0);
    const mark = h.effects.length;
    await say(h, "repeatloop", { n: 5000 });
    ok("mtg repeat 5000: clipped to 1000 and said", seat.loop?.total === 1000 && chats(h, mark).includes("[MTG] Repeat: at most 1000 times; repeating 1000."), JSON.stringify(chats(h, mark)));
    ok("mtg repeat: the priority question answered and closed", lastOut(calls)?.actionId === "prompt-action-1" && calls[calls.length - 1].promptId === p && seat.prompt === null, JSON.stringify(lastOut(calls)));
    const m2 = h.effects.length;
    await say(h, "repeatloop", { n: 3 });
    ok("mtg repeat while repeating: said", chats(h, m2).some((t) => /a loop is already repeating \(0 of 1000 done\)/.test(t)), JSON.stringify(chats(h, m2)));
  });
  await run(async (h) => {
    const { seat } = setup(h);
    const p = await handPass(h, seat, 0);
    await say(h, "repeatloop", {});
    ok("mtg repeat (no n): the how-many question", seat.prompt?.promptId === p && optIds(seat).includes("__loop:some") && !seat.loop, optIds(seat).join(","));
  });
  await run(async (h) => {
    const { seat } = setup(h);
    let mark = h.effects.length;
    await say(h, "repeatloop", { n: 3 });
    ok("mtg repeat, not your priority: said", chats(h, mark).includes("[MTG] Repeat: wait for your priority; a loop repeats from it."), JSON.stringify(chats(h, mark)));
    await prio(h, seat, board(), acts(0));
    mark = h.effects.length;
    await say(h, "repeatloop", { n: 3 });
    ok("mtg repeat, no pass yet: said how", chats(h, mark).some((t) => /^\[MTG\] Repeat: no loop to repeat yet\. Play one pass of the loop by hand/.test(t)) && !seat.loop, JSON.stringify(chats(h, mark)));
  });
  // 4. stops: each said, the question asked as usual
  const stopCase = async (name, change, why, { white = false, after, asked = true } = {}) => run(async (h) => {
    const { seat, other } = setup(h, { white });
    await started(h, seat, 3);
    const mark = h.effects.length;
    if (after) await after(h, seat, other);
    const ids = after ? [] : await loopPass(h, seat, 1, change(h, seat));
    const said = chats(h, mark);
    ok(`stop ${name}: ended`, !seat.loop, JSON.stringify(seat.loop && { i: seat.loop.i, done: seat.loop.done }));
    ok(`stop ${name}: said why`, said.some((t) => t === `[MTG] Blue's loop stopped after ${why[0]} of 3 (Kiki-Jiki, Mirror Breaker): ${why[1]}.`), JSON.stringify(said));
    if (!after && asked === true) ok(`stop ${name}: the question is asked`, seat.prompt?.promptId === ids[ids.length - 1], JSON.stringify({ open: seat.prompt?.promptId, ids }));
    // (the runaway question keeps the engine's own 90-second clock, and the harness runs every timer: it is shown, then
    // closed as Keep going when that clock runs out)
    if (!after && asked === "shown") {
      const last = ids[ids.length - 1];
      ok(`stop ${name}: the question is shown`, h.effects.slice(mark).some((e) => e.tts?.t === "prompt" && e.tts.promptId === last), JSON.stringify({ ids }));
      ok(`stop ${name}: unanswered, it closes as Keep going`, chats(h, mark).some((c) => /seconds for that question ran out: no answer counts as Keep going/.test(c)), JSON.stringify(chats(h, mark)));
    }
  });
  await stopCase("another question", (h, seat) => ({ t2: () => trigTarget(h, seat, 1, "Choose target creature") }), [0, 'the question changed ("Choose target creature")']);
  await stopCase("a target gone", (h, seat) => ({ t1: () => kikiTarget(h, seat, 1, ["engine-card-20"]) }), [0, "Zealous Conscripts isn't there to choose"]);
  await stopCase("the action gone", () => ({ endActs: [opt("prompt-action-0")] }), [1, "Kiki-Jiki, Mirror Breaker can't be played now"]);
  await stopCase("the board changed", () => ({ end: board({ tokens: 2, conscripts: false }) }), [0, "the board isn't the one the pass started from"]);
  await stopCase("another player's spell", () => ({ stack2: [kikiAbility, BOLT] }), [0, "AI 1 put Lightning Bolt on the stack"]);
  await stopCase("the step changed", () => ({ step3: "main2" }), [0, "the step changed"], { asked: false }); // (asked as usual: a priority with only your own trigger passes)
  // (another player's trigger is no response: the pass goes on)
  await run(async (h) => {
    const { seat } = setup(h);
    await started(h, seat, 3);
    const theirs = { ...conscriptsTrigger(5), id: "engine-stack-77", controllerId: "player-1", identity: { name: "Rhystic Study" }, sourceAbilityText: "Landfall — you may draw a card unless that player pays {1}." }; // (told by isTrigger alone: no "When" in its words)
    await loopPass(h, seat, 1, { stack2: [kikiAbility, theirs] });
    ok("another player's trigger: the pass goes on", seat.loop?.done === 1, JSON.stringify(seat.loop && seat.loop.done));
  });
  await stopCase("another seat plays something", null, [0, "White responded"], { white: true, after: async (h, seat, other) => {
    other.board.state.gameView = board({ kikiTapped: true, stack: [kikiAbility] });
    other.lastRawPrompt = { promptId: 9000, decidingPlayerId: "player-1", input: { type: "chooseAction", actions: [{ id: "prompt-action-0", type: "cast", cardId: "engine-card-40", label: "Cast Lightning Bolt" }] } };
    other.respond(9000, "chooseAction", { type: "act", actionId: "prompt-action-0" });
    await h.flush();
  } });
  // (another seat's mana ability is no response)
  await run(async (h) => {
    const { seat, other } = setup(h, { white: true });
    await started(h, seat, 3);
    other.lastRawPrompt = { promptId: 9001, decidingPlayerId: "player-1", input: { type: "chooseAction", actions: [{ id: "prompt-action-0", type: "activateAbility", isManaAbility: true, cardId: "engine-card-30" }] } };
    other.respond(9001, "chooseAction", { type: "act", actionId: "prompt-action-0" });
    ok("another seat's mana ability: it goes on", !!seat.loop, "ended");
  });
  await stopCase("the runaway question", (h, seat) => ({ t2: () => ask(h, seat, board({ kikiTapped: true, tokens: 2 }),
    { type: "chooseBoolean", presentation: { title: "This turn passed the engine's limit", description: "x" }, confirmLabel: "Keep going", denyLabel: "End in a draw" }) }), [0, "the engine's runaway limit asks first"], { asked: "shown" });
  await stopCase("the game ended", (h, seat) => ({ t2: () => ask(h, seat, { ...board({ tokens: 2 }), gameOver: true, winnerId: "player-0" }, { type: "gameOver" }) }), [0, "the game ended"], { asked: false }); // (the game-over question shows nothing to answer)
  await stopCase("mtg stop", null, [0, "you typed mtg stop"], { after: async (h) => { await say(h, "stopchain", {}); } });
  await stopCase("Stop on the panel", null, [0, "you pressed Stop"], { after: async (h) => { await answer(h, "__loop", "__loopstop"); } });
  // (Stop and mtg stop clear the panel and ask the next priority with something on the stack)
  await run(async (h) => {
    const { seat } = setup(h);
    await started(h, seat, 3);
    const mark = h.effects.length;
    await answer(h, "__loop", "__loopstop");
    const panel = h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.color === "Blue");
    ok("Stop: the panel is cleared", panel.length === 1 && panel[0].tts.promptId === null, JSON.stringify(panel));
    ok("Stop: the next priority with a stack is asked", seat.stopChain === true, String(seat.stopChain));
    await kikiTarget(h, seat, 1);
    ok("Stop: the next question is asked as usual", seat.prompt != null && !seat.loop, JSON.stringify(seat.prompt?.ui?.title));
  });
  // 5. a rewind forgets it; another turn's answers are no pass
  await run(async (h) => {
    const { seat } = setup(h);
    await started(h, seat, 3);
    seat.clearFollowUps();
    ok("rewind: the repeat and its log are forgotten", seat.loop == null && seat.loopLog == null && seat.loopOffer == null, JSON.stringify([seat.loop, seat.loopLog, seat.loopOffer].map((x) => x == null)));
  });
  await run(async (h) => {
    const { seat } = setup(h);
    const p1 = await prio(h, seat, board(), acts(0));
    await answer(h, p1, "prompt-action-0");
    const t1 = await kikiTarget(h, seat, 0);
    if (seat.prompt?.promptId === t1) await answer(h, t1, "card|engine-card-11");
    await prio(h, seat, board({ turn: 6, tokens: 1 }), acts(1));
    ok("another turn: no offer", !optIds(seat).includes("__loop"), optIds(seat).join(","));
  });
  // 5b. what is no pass: a cast taken back, two activations with nothing resolved, an answer the log can't place
  await run(async (h) => {
    const { seat } = setup(h);
    const p1 = await prio(h, seat, board(), acts(0));
    await answer(h, p1, "prompt-action-0");
    const t1 = await kikiTarget(h, seat, 0);
    await answer(h, t1, "__cancel");
    await prio(h, seat, board(), acts(0));
    ok("no pass: a cast taken back offers nothing", seat.prompt && !optIds(seat).includes("__loop"), optIds(seat).join(","));
  });
  await run(async (h) => {
    const { seat } = setup(h);
    const p1 = await prio(h, seat, board(), acts(0));
    await answer(h, p1, "prompt-action-0");
    const t1 = await kikiTarget(h, seat, 0);
    if (seat.prompt?.promptId === t1) await answer(h, t1, "card|engine-card-11");
    await prio(h, seat, board(), acts(0));
    ok("no pass: back to the board with nothing resolved offers nothing", seat.prompt && !optIds(seat).includes("__loop"), optIds(seat).join(","));
  });
  await run(async (h) => {
    const { seat } = setup(h);
    // (a pass that resolved something and also took a cast back: Opt's target asked and cancelled while the trigger waits)
    const p1 = await prio(h, seat, board(), acts(0));
    await answer(h, p1, "prompt-action-0");
    const t1 = await kikiTarget(h, seat, 0);
    if (seat.prompt?.promptId === t1) await answer(h, t1, "card|engine-card-11");
    await prio(h, seat, board({ kikiTapped: true, stack: [kikiAbility] }), [opt("prompt-action-0")]);
    const c = await ask(h, seat, board({ kikiTapped: true, tokens: 1, stack: [conscriptsTrigger(0)] }), { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, cancellable: true,
      candidates: [{ id: "player-1", kind: "player" }], presentation: { title: "Choose target player" } }, { sourceCard: { id: "engine-card-5", identity: { name: "Opt" } } });
    seat.respond(c, "chooseBoardTargets", { type: "cancel" });
    const t2 = await trigTarget(h, seat, 0);
    if (seat.prompt?.promptId === t2) await answer(h, t2, "card|engine-card-10");
    await prio(h, seat, board({ kikiTapped: true, tokens: 1, stack: [conscriptsTrigger(0)] }), [opt("prompt-action-0")]);
    await prio(h, seat, board({ tokens: 1 }), acts(1));
    ok("no pass: a pass with a cast taken back in it offers nothing", seat.prompt && !optIds(seat).includes("__loop"), optIds(seat).join(","));
  });
  await run(async (h) => {
    const { seat } = setup(h);
    await handPass(h, seat, 0);
    seat.respond(99999, "chooseBoolean", { type: "boolean", value: true });
    const p = await prio(h, seat, board({ tokens: 1 }), acts(1));
    ok("no pass: an answer to a question not the last one asked starts the log again", seat.prompt?.promptId === p && !optIds(seat).includes("__loop") && seat.loopLog == null,
      JSON.stringify({ o: optIds(seat), n: seat.loopLog?.list?.length }));
  });
  // 5c. the panel: every 10th pass at least, not between
  await run(async (h) => {
    const { seat } = setup(h);
    await started(h, seat, 20);
    const mark = h.effects.length;
    for (let k = 1; k <= 10 && seat.loop; k++) await loopPass(h, seat, k);
    const titles = h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.promptId === "__loop").map((e) => e.tts.title);
    ok("panel: the 10th pass shows Repeating 11/20", seat.loop?.done === 10 && titles.includes("Repeating 11/20"), JSON.stringify({ done: seat.loop?.done, titles }));
    ok("panel: not every pass within the moment", !titles.includes("Repeating 5/20"), JSON.stringify(titles));
  });
  // 5d. a pass that ends with mana abilities (Kykar sacrificing the Spirit the pass made, for {R}; the user's Hullbreaker
  // Horror + Sol Ring loop, 2026-11-24): the priorities after them are on the same board, as tokens don't count, and
  // nothing resolved since; the pass began before them, and it repeats with the sacrifice in it
  await run(async (h) => {
    const { seat, calls } = setup(h);
    const sacAct = (id) => ({ id, type: "activateAbility", isManaAbility: true, cardId: "engine-card-12", description: "Sacrifice a Spirit: Add {R}.", cost: "Sac<1/Spirit>" });
    const kykar = card("engine-card-12", "Kykar, Wind's Fury");
    const withK = (o) => { const gv = board(o); gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push(kykar); return gv; };
    const spirit = (id) => card(id, "Spirit", { token: true });
    // two Spirits to pick from (a single one is picked by the table itself); their ids new each pass
    const sacPick = (a, b) => ask(h, seat, withK({ extra: [spirit(a), spirit(b)] }), { type: "chooseCards", min: 1, max: 1, cancellable: true, presentation: { title: "Kykar, Wind's Fury: choose a creature to sacrifice" },
      cards: [{ id: a }, { id: b }] }, { sourceCard: { id: "engine-card-12", identity: { name: "Kykar, Wind's Fury" } } });
    // the hand pass on Kykar's board, then the token sacrificed for mana
    const p1 = await prio(h, seat, withK({}), acts(0));
    await answer(h, p1, "prompt-action-0");
    const t1 = await kikiTarget(h, seat, 0);
    await answer(h, t1, "card|engine-card-11");
    await prio(h, seat, withK({ kikiTapped: true, stack: [kikiAbility] }), [opt("prompt-action-0")]);
    const t2 = await trigTarget(h, seat, 0);
    await answer(h, t2, "card|engine-card-10");
    await prio(h, seat, withK({ kikiTapped: true, tokens: 1, stack: [conscriptsTrigger(0)] }), [opt("prompt-action-0")]);
    const p2 = await prio(h, seat, withK({ tokens: 1 }), [...acts(1), sacAct("prompt-action-2")]);
    ok("mana at the end: Repeat ×N before the sacrifice", optIds(seat).includes("__loop"), optIds(seat).join(","));
    await answer(h, p2, "__mana:engine-card-12");
    const s1 = await sacPick("engine-card-40", "engine-card-41");
    await answer(h, s1, "engine-card-40");
    const p3 = await prio(h, seat, withK({}), acts(0));
    ok("mana at the end: still Repeat ×N after the sacrifice (the pass began at the Kiki-Jiki activation)",
      seat.prompt?.promptId === p3 && optIds(seat).includes("__loop") && seat.loopOffer?.steps.length === 7 && seat.loopOffer.name === "Kiki-Jiki, Mirror Breaker + Kykar, Wind's Fury",
      JSON.stringify({ o: optIds(seat), n: seat.loopOffer?.name, s: seat.loopOffer?.steps.length }));
    await say(h, "repeatloop", { n: 1 });
    ok("mana at the end: the repeat starts with the Kiki-Jiki activation", seat.loop && JSON.stringify(lastOut(calls)) === JSON.stringify({ type: "act", actionId: "prompt-action-0" }), JSON.stringify(lastOut(calls)));
    await kikiTarget(h, seat, 0);
    await prio(h, seat, withK({ kikiTapped: true, stack: [kikiAbility] }), [opt("prompt-action-0")]);
    await trigTarget(h, seat, 0);
    await prio(h, seat, withK({ kikiTapped: true, tokens: 1, stack: [conscriptsTrigger(0)] }), [opt("prompt-action-0")]);
    await prio(h, seat, withK({ tokens: 1 }), [...acts(1), sacAct("prompt-action-2")]);
    ok("mana at the end: the repeat sacrifices too", JSON.stringify(lastOut(calls)) === JSON.stringify({ type: "act", actionId: "prompt-action-2" }), JSON.stringify(lastOut(calls)));
    await sacPick("engine-card-42", "engine-card-43");
    ok("mana at the end: this pass's first Spirit is the one sacrificed", JSON.stringify(lastOut(calls)) === JSON.stringify({ type: "chooseCardsDecision", chosenCardIds: ["engine-card-42"] }), JSON.stringify(lastOut(calls)));
  });
  // 5e. the engine's runaway question in the middle of a pass (Keep going, the user's Kykar test 2026-11-24: Repeat ×53
  // stopped at once, "the question changed", as it waited for that question again): it is no step of the pass
  await run(async (h) => {
    const { seat, calls } = setup(h);
    const p1 = await prio(h, seat, board(), acts(0));
    await answer(h, p1, "prompt-action-0");
    const t1 = await kikiTarget(h, seat, 0);
    await answer(h, t1, "card|engine-card-11");
    await prio(h, seat, board({ kikiTapped: true, stack: [kikiAbility] }), [opt("prompt-action-0")]);
    const t2 = await trigTarget(h, seat, 0);
    await answer(h, t2, "card|engine-card-10");
    const r = await ask(h, seat, board({ kikiTapped: true, tokens: 1, stack: [conscriptsTrigger(0)] }),
      { type: "chooseBoolean", presentation: { title: "This turn passed the engine's limit", description: "x", targets: [] }, confirmLabel: "Keep going", denyLabel: "End in a draw" },
      { sourceCard: { id: "engine-card-20", identity: { name: "Zealous Conscripts", isToken: true } } });
    await answer(h, r, "yes");
    ok("runaway mid-pass: Keep going answered", calls.some((c) => c.promptId === r && c.out?.value === true), JSON.stringify(calls.find((c) => c.promptId === r)));
    await prio(h, seat, board({ kikiTapped: true, tokens: 1, stack: [conscriptsTrigger(0)] }), [opt("prompt-action-0")]);
    await prio(h, seat, board({ tokens: 1 }), acts(1));
    ok("runaway mid-pass: the pass is offered without it", optIds(seat).includes("__loop") && seat.loopOffer?.steps.length === 5, JSON.stringify({ o: optIds(seat), s: seat.loopOffer?.steps.map((e) => e.type) }));
    await say(h, "repeatloop", { n: 2 });
    const mark = h.effects.length;
    await loopPass(h, seat, 1);
    ok("runaway mid-pass: the repeat's first pass goes through", !!seat.loop && seat.loop.done === 1, JSON.stringify({ done: seat.loop?.done, said: chats(h, mark) }));
  });
  // 6. the pieces: loopMap keeps an id that is the same thing, follows a card's action, and names what is gone
  await run(async (h) => {
    const B = h.B;
    ok("pieces are exported", typeof B._loopMap === "function" && typeof B._loopCands === "function" && typeof B._loopSig === "function", Object.keys(B).filter((k) => /loop/i.test(k)).join(","));
    const gv = board({ tokens: 1 });
    const rec = B._loopCands({ actions: acts(0) }, board()), cur = B._loopCands({ actions: acts(1) }, gv);
    ok("map: an action follows its card to its new place", JSON.stringify(B._loopMap({ type: "act", actionId: "prompt-action-0" }, rec, cur)) === JSON.stringify({ out: { type: "act", actionId: "prompt-action-1" } }));
    ok("map: no action of that card: gone, by its name", JSON.stringify(B._loopMap({ type: "act", actionId: "prompt-action-0" }, rec, B._loopCands({ actions: [opt("prompt-action-0")] }, gv))) === JSON.stringify({ gone: "Kiki-Jiki, Mirror Breaker" }));
    ok("map: words that are no id are kept", JSON.stringify(B._loopMap({ type: "pass", exhaustStack: true }, rec, cur)) === JSON.stringify({ out: { type: "pass", exhaustStack: true } }));
    const tokRec = B._loopCands({ candidates: [{ id: "engine-card-20", kind: "card" }, { id: "engine-card-11", kind: "card" }] }, board({ tokens: 1 }));
    const tokCur = B._loopCands({ candidates: [{ id: "engine-card-21", kind: "card" }, { id: "engine-card-11", kind: "card" }] }, { ...board({ tokens: 0, extra: [card("engine-card-21", "Zealous Conscripts", { token: true })] }) });
    ok("map: a token made this pass stands in for last pass's", JSON.stringify(B._loopMap({ chosen: [{ kind: "card", id: "engine-card-20" }] }, tokRec, tokCur)) === JSON.stringify({ out: { chosen: [{ kind: "card", id: "engine-card-21" }] } }), JSON.stringify(B._loopMap({ chosen: [{ kind: "card", id: "engine-card-20" }] }, tokRec, tokCur)));
    ok("map: a nontoken card only as itself", JSON.stringify(B._loopMap({ chosen: [{ kind: "card", id: "engine-card-11" }] }, tokRec, B._loopCands({ candidates: [{ id: "engine-card-20", kind: "card" }, { id: "engine-card-21", kind: "card" }] }, board({ tokens: 2 })))) === JSON.stringify({ gone: "Zealous Conscripts" }));
    ok("sig: tokens and life don't count, a tap does", B._loopSig(board(), "player-0") === B._loopSig(board({ tokens: 3 }), "player-0") && B._loopSig(board(), "player-0") !== B._loopSig(board({ kikiTapped: true }), "player-0"));
  });

  console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
