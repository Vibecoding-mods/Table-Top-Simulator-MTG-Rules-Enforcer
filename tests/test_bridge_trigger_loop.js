// The trigger-loop shortcut (bridge.js tloopTrack, tloopFound, tloopOffer, tloopOwn, tloopPasses, tloopPriorityOffer,
// tloopPanel, tloopEnd; the user 2026-11-23: "if the same triggers trigger multiple times in a loop add the x triggers so
// that many happens without doing it manually. Give the opponents a button to accept x amount within the total or all
// triggers"). Blue has Sanguine Bond + Exquisite Blood; each pass puts Sanguine Bond's trigger on the stack (Blue picks
// its target), then Exquisite Blood's. White, the other human seat, has a Bolt to respond with. The checks:
//  - found: no offer on the first two passes; on the third, Blue's target question is first "… keep triggering: run the
//    loop how many times?" with ×10/×100/×1000/All/How many…/Answer as usual; never to White (not White's loop)
//  - ×10: said to everyone; the target question is asked once more; its answer given again on the next passes unseen;
//    Blue's own priority over the loop passed
//  - White: the panel "Blue's loop ×10: accept it?" (Accept ×10 / Accept fewer… / No); "Accept ×10" passes White's
//    priority over the loop's triggers, unseen; "Accept fewer…" 2 ends the run after 2 passes; No: White asked as usual;
//    "Accept the loop…" in White's priority question when a question is open
//  - it ends: the passes done (said, with the count), a foreign spell on the stack, the step changing, "mtg stop", the
//    question's options changing; not offered again in the same step; "Answer as usual" asks as usual
//  - an AI's loop: White's priority gets "Pass for this loop…" and ×10 passes it 10 passes of the loop
//   node tests/test_bridge_trigger_loop.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}\n`); } };

const BOND = "Whenever you gain life, target opponent loses that much life.";
const BLOOD = "Whenever an opponent loses life, you gain that much life.";
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const perm = (id, name, ctl, text) => ({ id, controllerId: ctl, ownerId: ctl, identity: { name }, types: ["Enchantment"], tapped: false, text });
// (loopBy: whose Sanguine Bond and Exquisite Blood; player-1 for the AI's loop)
function board({ stack = [], step = "main1", turn = 5, loopBy = "player-0" } = {}) {
  const loopCards = [perm("engine-card-10", "Sanguine Bond", loopBy, BOND), perm("engine-card-11", "Exquisite Blood", loopBy, BLOOD)];
  const zones = ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, count: 0,
    cards: zone !== "battlefield" ? [] : loopCards.filter((c) => c.controllerId === ownerId) })));
  return { turn, step, activePlayerId: "player-0", priorityPlayerId: "player-0", stack,
    players: [{ id: "player-0", life: 40, manaPool: {} }, { id: "player-1", life: 40, manaPool: {} }], zones };
}
const item = (id, src, name, text, ctl) => ({ id, sourceId: src, controllerId: ctl, identity: { name }, isTrigger: true, sourceAbilityText: text, text: `${name} - ${text}` });
const bond = (i, ctl = "player-0") => item(`engine-stack-${100 + i}`, "engine-card-10", "Sanguine Bond", BOND, ctl);
const blood = (i, ctl = "player-0") => item(`engine-stack-${300 + i}`, "engine-card-11", "Exquisite Blood", BLOOD, ctl);
const bolt = () => ({ id: "prompt-action-0", type: "cast", cardId: "engine-card-40", label: "Cast Lightning Bolt", mode: { type: "normal" } });

function setup(h, { ai = false } = {}) {
  const mk = (color, slot) => {
    const s = new h.B.Seat(color, "neheb_minotaur_commander");
    s.slot = slot;
    s.stops = new Set();
    s.board = { state: { gameView: board() }, fingerprint: null };
    return s;
  };
  // (ai: White plays the AI's loop as player-0's opponent, the loop's controller an AI at player-1 with no seat)
  const seat = ai ? null : mk("Blue", "player-0");
  const white = mk("White", ai ? "player-0" : "player-1");
  const seats = new Map([...(seat ? [["Blue", seat]] : []), ["White", white]]);
  h.B._setGame({ seats, bots: ai ? 1 : 0, total: 2, playerOrder: ["tts-Blue-ab12", "tts-White-cd34"],
    slotNames: ai ? { "player-0": "White", "player-1": "AI 1" } : { "player-0": "Blue", "player-1": "White" },
    slotColor: ai ? { "player-0": "White" } : { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  const calls = [];
  for (const s of [seat, white].filter(Boolean)) {
    const respond = s.respond.bind(s);
    s.respond = (promptId, type, out) => { calls.push({ color: s.color, promptId, type, out }); return respond(promptId, type, out); };
  }
  return { seat, white, calls };
}
let pid = 700;
const chats = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const panels = (h, color, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.color === color).map((e) => e.tts);
const optIds = (s) => (s.prompt?.ui?.options || []).map((o) => o.id);
const say = async (h, t, p, color) => { h.B.onTTS({ t, json: JSON.stringify({ color, ...p }) }); await h.flush(); };
const answer = (h, promptId, choice, color = "Blue") => say(h, "answer", { promptId, choice: [choice] }, color);
async function ask(h, s, gv, input, extra = {}) {
  s.board.state.gameView = gv;
  const id = ++pid;
  h.B.onPrompt(s, { promptId: id, decidingPlayerId: s.slot, input, ...extra });
  await h.flush();
  return id;
}
const prio = (h, s, gv, actions = [bolt()]) => ask(h, s, gv, { type: "chooseAction", actions, presentation: { title: "Your priority" } });
const TARGET_TITLE = "Sanguine Bond: choose target opponent";
const bondTarget = (h, seat, i, { cands = ["player-1"], step } = {}) => ask(h, seat, board({ stack: [bond(i)], step }),
  { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, candidates: cands.map((id) => ({ id, kind: "player" })), presentation: { title: "Choose target opponent" } },
  { sourceCard: { id: "engine-card-10", identity: { name: "Sanguine Bond" } }, sourceAbilityText: BOND });
const answered = (calls, id) => calls.find((c) => c.promptId === id);
// One pass: Blue's target question (answered by hand when it is asked), White's priority over each trigger. Returns the
// ids { t, w1, w2 }.
async function pass(h, seat, white, i, { pick = true, step } = {}) {
  const t = await bondTarget(h, seat, i, { step });
  if (pick && seat.prompt?.promptId === t) await answer(h, t, "player|player-1");
  const w1 = white ? await prio(h, white, board({ stack: [bond(i)], step })) : null;
  if (white?.prompt?.promptId === w1) { await answer(h, w1, "__pass", "White"); }
  const w2 = white ? await prio(h, white, board({ stack: [blood(i)], step })) : null;
  if (white?.prompt?.promptId === w2) { await answer(h, w2, "__pass", "White"); }
  return { t, w1, w2 };
}
// Two passes by hand, then the third's target question (the offer); its id
async function toOffer(h, seat, white) {
  await pass(h, seat, white, 0);
  await pass(h, seat, white, 1);
  return bondTarget(h, seat, 2);
}
// The offer answered ×n (n a button id's tail), the target question then answered by hand
async function begin(h, seat, white, choice = "__tl:10") {
  const t = await toOffer(h, seat, white);
  await answer(h, t, choice);
  if (seat.prompt) await answer(h, seat.prompt.promptId, "player|player-1");
  return t;
}
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } catch (e) { ok("a case ran without throwing", false, e.stack); return null; } finally { harness.restore(); } };

(async () => {
  // the pass shape: White's "__pass" must be a real option, or the pass helper answers nothing
  await run(async (h) => {
    const { white } = setup(h);
    await prio(h, white, board({ stack: [bond(0)] }));
    ok("setup: White's priority has __pass", optIds(white).includes("__pass"), optIds(white).join(","));
  });

  // 1. found, offered on the third pass to the controller only
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    const a = await pass(h, seat, white, 0);
    ok("found: pass 1 asks the target as usual", seat.prompt === null && answered(calls, a.t)?.out?.chosen?.[0]?.id === "player-1", JSON.stringify(answered(calls, a.t)));
    const b = await pass(h, seat, white, 1);
    ok("found: pass 2 too", !!answered(calls, b.t) && !chats(h).some((c) => /loop/i.test(c)), chats(h).join(" | "));
    ok("found: White not offered anything on pass 2", !panels(h, "White").some((p) => p.promptId === "__tloop"));
    const t = await bondTarget(h, seat, 2);
    ok("found: pass 3 asks the run first", seat.prompt?.promptId === t && seat.prompt.ui.title === "Sanguine Bond → Exquisite Blood keep triggering: run the loop how many times?", seat.prompt?.ui?.title);
    ok("found: the run's buttons", optIds(seat).join(",") === "__tl:10,__tl:100,__tl:1000,__tl:all,__tl:some,__tl:no", optIds(seat).join(","));
    ok("found: the text counts the passes so far", /^3 times so far this step\./.test(seat.prompt?.ui?.text || ""), seat.prompt?.ui?.text);
    ok("found: nothing answered yet", !answered(calls, t));
  });

  // 2. ×10: the question once more, then the same answer unseen; Blue's own priority over the loop passed
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    const mark = h.effects.length;
    const t = await toOffer(h, seat, white);
    await answer(h, t, "__tl:10");
    ok("×10: said to everyone", chats(h, mark).includes("[MTG] Blue runs the loop ×10 (Sanguine Bond → Exquisite Blood). The others are asked to accept it, or fewer; anyone may respond when they get priority, and that stops it."),
      chats(h, mark).join(" | "));
    ok("×10: the target question asked once more", seat.prompt?.ui?.title === TARGET_TITLE && !answered(calls, t), seat.prompt?.ui?.title);
    await answer(h, seat.prompt.promptId, "player|player-1");
    ok("×10: answered by hand", answered(calls, t)?.out?.chosen?.[0]?.id === "player-1", JSON.stringify(answered(calls, t)));
    const t4 = await bondTarget(h, seat, 3);
    ok("×10: pass 4's target answered unseen", seat.prompt === null && answered(calls, t4)?.out?.chosen?.[0]?.id === "player-1", JSON.stringify(answered(calls, t4)));
    const p = await prio(h, seat, board({ stack: [blood(3)] }));
    ok("×10: Blue's own priority over the loop passed", seat.prompt === null && answered(calls, p)?.out?.type === "pass", JSON.stringify(answered(calls, p)));
    // (the question's options change: the run ends, the question asked)
    const t5 = await bondTarget(h, seat, 4, { cands: ["player-2"] });
    ok("options changed: asked", seat.prompt?.promptId === t5 && !answered(calls, t5));
    ok("options changed: said", chats(h, mark).some((c) => /^\[MTG\] The loop stopped after \d+ times \(Sanguine Bond → Exquisite Blood\): its question changed\.$/.test(c)), chats(h, mark).join(" | "));
  });

  // 3. White: the panel, Accept ×10 passes its priority unseen
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    const mark = h.effects.length;
    await begin(h, seat, white);
    const wp = panels(h, "White", mark).filter((p) => p.promptId === "__tloop");
    ok("White: the panel", wp.length === 1 && wp[0].title === "Blue's loop ×10: accept it?" && wp[0].options.map((o) => o.id).join(",") === "__tl:all,__tl:some,__tl:no"
      && wp[0].options[0].label === "Accept ×10", JSON.stringify(wp));
    ok("Blue: no panel", !panels(h, "Blue", mark).some((p) => p.promptId === "__tloop"));
    await say(h, "answer", { promptId: "__tloop", choice: ["__tl:all"] }, "White");
    ok("White: accept said", chats(h, mark).includes("[MTG] White accepts the loop ×10."), chats(h, mark).join(" | "));
    ok("White: the panel cleared", panels(h, "White", mark).pop()?.promptId === null);
    const w = await prio(h, white, board({ stack: [bond(3)] }));
    ok("White: priority over the loop passed unseen", white.prompt === null && answered(calls, w)?.out?.type === "pass", JSON.stringify(answered(calls, w)));
    // (a foreign spell on the stack: White's next priority asked, the end said)
    const w2 = await prio(h, white, board({ stack: [bond(3), { id: "engine-stack-900", sourceId: "engine-card-50", controllerId: "player-0", identity: { name: "Lightning Bolt" }, text: "Lightning Bolt" }] }));
    ok("foreign spell: White asked", white.prompt?.promptId === w2 && !answered(calls, w2));
    ok("foreign spell: said", chats(h, mark).some((c) => c === "[MTG] The loop stopped after once (Sanguine Bond → Exquisite Blood): Lightning Bolt (Blue) went on the stack."), chats(h, mark).join(" | "));
  });

  // 4. Accept fewer… 2: the run ends after 2 passes
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    const mark = h.effects.length;
    await begin(h, seat, white);
    await say(h, "answer", { promptId: "__tloop", choice: ["__tl:some"] }, "White");
    const num = panels(h, "White", mark).pop();
    ok("fewer: the number question", num?.promptId === "__tloop" && num.mode === "number" && num.max === 10 && num.title === "Accept Blue's loop how many times? (1 to 10)", JSON.stringify(num));
    await say(h, "answer", { promptId: "__tloop", choice: ["2"] }, "White");
    ok("fewer: said", chats(h, mark).includes("[MTG] White accepts the loop ×2 (of 10)."), chats(h, mark).join(" | "));
    const a = await pass(h, seat, white, 3, { pick: false });
    ok("fewer: pass 1 unseen for both", !!answered(calls, a.t) && !!answered(calls, a.w1) && answered(calls, a.w1).out.type === "pass", JSON.stringify([answered(calls, a.t), answered(calls, a.w1)]));
    const b = await pass(h, seat, white, 4, { pick: false });
    ok("fewer: pass 2's target unseen", !!answered(calls, b.t));
    const t = await bondTarget(h, seat, 5);
    ok("fewer: after 2 passes the target asked", seat.prompt?.promptId === t && !answered(calls, t));
    ok("fewer: the end said", chats(h, mark).includes("[MTG] The loop ran 2 times (Sanguine Bond → Exquisite Blood)."), chats(h, mark).join(" | "));
    await answer(h, t, "player|player-1");
    const t2 = await bondTarget(h, seat, 6);
    ok("fewer: not offered again this step", seat.prompt?.promptId === t2 && seat.prompt.ui.title === TARGET_TITLE, seat.prompt?.ui?.title);
  });

  // 5. White says No: asked as usual; the run goes on for Blue
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    const mark = h.effects.length;
    await begin(h, seat, white);
    await say(h, "answer", { promptId: "__tloop", choice: ["__tl:no"] }, "White");
    ok("No: said", chats(h, mark).includes("[MTG] White doesn't accept the loop: they are asked at their priority as usual."), chats(h, mark).join(" | "));
    const w = await prio(h, white, board({ stack: [bond(3)] }));
    ok("No: White asked", white.prompt?.promptId === w && !answered(calls, w));
    ok("No: no Accept button after", !optIds(white).includes("__tlaccept"), optIds(white).join(","));
  });
  // (No in the priority question: said, back to the priority, the button gone)
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    const mark = h.effects.length;
    await begin(h, seat, white);
    const w = await prio(h, white, board({ stack: [bond(3)] }));
    await answer(h, w, "__tlaccept", "White");
    await answer(h, white.prompt.promptId, "__tl:no", "White");
    ok("No (priority): said", chats(h, mark).includes("[MTG] White doesn't accept the loop: they are asked at their priority as usual."), chats(h, mark).join(" | "));
    ok("No (priority): back to the priority, not passed", !answered(calls, w) && white.prompt?.ui?.options?.some((o) => o.id === "__pass"), optIds(white).join(","));
    const w2 = await prio(h, white, board({ stack: [blood(3)] }));
    ok("No (priority): no Accept button after", white.prompt?.promptId === w2 && !optIds(white).includes("__tlaccept"), optIds(white).join(","));
  });
  // (two of the same trigger on the stack at once, Soul's Attendant for two creatures entering, then more one at a time:
  // a batch, never a loop)
  await run(async (h) => {
    const { seat } = setup(h);
    const three = [bond(0), bond(1)];
    for (let k = 2; k >= 1; k--) {
      const t = await ask(h, seat, board({ stack: three.slice(0, k) }), { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, candidates: [{ id: "player-1", kind: "player" }], presentation: { title: "Choose target opponent" } },
        { sourceCard: { id: "engine-card-10", identity: { name: "Sanguine Bond" } }, sourceAbilityText: BOND });
      ok(`batch: question ${3 - k} asked as usual`, seat.prompt?.promptId === t && seat.prompt.ui.title === TARGET_TITLE, seat.prompt?.ui?.title);
      if (seat.prompt) await answer(h, t, "player|player-1");
    }
    await answer(h, await bondTarget(h, seat, 2), "player|player-1");
    const t = await bondTarget(h, seat, 3);
    ok("batch: two more after it, still no offer", seat.prompt?.promptId === t && seat.prompt.ui.title === TARGET_TITLE, seat.prompt?.ui?.title);
  });
  // (White's question from a loop card, White not its controller: no offer)
  await run(async (h) => {
    const { seat, white } = setup(h);
    await pass(h, seat, white, 0);
    await pass(h, seat, white, 1);
    await bondTarget(h, seat, 2);
    await ask(h, white, board({ stack: [bond(2)] }), { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, candidates: [{ id: "player-0", kind: "player" }], presentation: { title: "Choose target opponent" } },
      { sourceCard: { id: "engine-card-10", identity: { name: "Sanguine Bond" } }, sourceAbilityText: BOND });
    ok("offer: never to a player not the loop's", white.prompt?.ui?.title === TARGET_TITLE, white.prompt?.ui?.title);
  });

  // 6. Accept the loop… in White's priority question (a question open when the run starts)
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    await begin(h, seat, white);
    const w = await prio(h, white, board({ stack: [bond(3)] }));
    const ids = optIds(white);
    ok("priority: Accept the loop… after End turn", ids.indexOf("__tlaccept") === ids.indexOf("__endturn") + 1 && white.prompt.ui.options.find((o) => o.id === "__tlaccept").label === "Accept Blue's loop ×10…", ids.join(","));
    await answer(h, w, "__tlaccept", "White");
    ok("priority: the accept question under it", optIds(white).join(",") === "__tl:all,__tl:some,__tl:no,__back" || optIds(white).includes("__tl:all"), optIds(white).join(","));
    await answer(h, white.prompt.promptId, "__tl:all", "White");
    ok("priority: accepted, passed", white.prompt === null && answered(calls, w)?.out?.type === "pass", JSON.stringify(answered(calls, w)));
    const w2 = await prio(h, white, board({ stack: [blood(3)] }));
    ok("priority: the next passed unseen", answered(calls, w2)?.out?.type === "pass");
  });

  // 7. it ends: the step changing; mtg stop; Answer as usual
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    const mark = h.effects.length;
    await begin(h, seat, white);
    const t = await bondTarget(h, seat, 3, { step: "combat" });
    ok("step: asked in the new step", seat.prompt?.promptId === t && !answered(calls, t));
    ok("step: said", chats(h, mark).some((c) => /^\[MTG\] The loop stopped after .*: the step changed\.$/.test(c)), chats(h, mark).join(" | "));
  });
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    const mark = h.effects.length;
    await begin(h, seat, white);
    await say(h, "stopchain", {}, "Blue");
    ok("mtg stop: said", chats(h, mark).some((c) => /^\[MTG\] The loop stopped after .*: Blue typed mtg stop\.$/.test(c)), chats(h, mark).join(" | "));
    const t = await bondTarget(h, seat, 3);
    ok("mtg stop: asked", seat.prompt?.promptId === t && seat.prompt.ui.title === TARGET_TITLE && !answered(calls, t), seat.prompt?.ui?.title);
  });
  await run(async (h) => {
    const { seat, white, calls } = setup(h);
    const t = await toOffer(h, seat, white);
    await answer(h, t, "__tl:no");
    ok("as usual: the question asked", seat.prompt?.ui?.title === TARGET_TITLE && !h.B._getGame().tloop, seat.prompt?.ui?.title);
    await answer(h, seat.prompt.promptId, "player|player-1");
    const t2 = await bondTarget(h, seat, 3);
    ok("as usual: not offered again this step", seat.prompt?.promptId === t2 && seat.prompt.ui.title === TARGET_TITLE);
  });

  // 8. an AI's loop: White's priority gets "Pass for this loop…"
  await run(async (h) => {
    const { white, calls } = setup(h, { ai: true });
    const mark = h.effects.length;
    // (no isTrigger here: a trigger known by its "Whenever" text)
    const ai = (i, mk) => { const s = mk(i, "player-1"); delete s.isTrigger; return s; };
    for (let i = 0; i < 2; i++) {
      for (const mk of [bond, blood]) {
        const w = await prio(h, white, board({ stack: [ai(i, mk)], loopBy: "player-1" }));
        ok(`AI loop: pass ${i + 1} asked as usual`, !optIds(white).includes("__tlaccept"), optIds(white).join(","));
        await answer(h, w, "__pass", "White");
      }
    }
    const w = await prio(h, white, board({ stack: [ai(2, bond)], loopBy: "player-1" }));
    const opt = white.prompt?.ui?.options?.find((o) => o.id === "__tlaccept");
    ok("AI loop: Pass for this loop…", opt?.label === "Pass for this loop…", optIds(white).join(","));
    await answer(h, w, "__tlaccept", "White");
    ok("AI loop: the buttons", ["__tl:10", "__tl:100", "__tl:1000", "__tl:all", "__tl:some"].every((id) => optIds(white).includes(id)), optIds(white).join(","));
    await answer(h, white.prompt.promptId, "__tl:10", "White");
    ok("AI loop: passed", answered(calls, w)?.out?.type === "pass", JSON.stringify(answered(calls, w)));
    ok("AI loop: said", chats(h, mark).includes("[MTG] White passes for AI 1's loop until it ends (Sanguine Bond → Exquisite Blood).") && chats(h, mark).includes("[MTG] White accepts the loop ×10."), chats(h, mark).join(" | "));
    let unseen = 0;
    for (let i = 3; i < 16; i++) {
      const id = await prio(h, white, board({ stack: [ai(i, bond)], loopBy: "player-1" }));
      if (answered(calls, id)?.out?.type === "pass") unseen++;
      else break;
    }
    ok("AI loop: ×10 passes 10 passes of the loop, then asks", unseen === 10 && white.prompt !== null, `${unseen} passed`);
  });

  process.stdout.write(failed ? `test_bridge_trigger_loop: ${failed} FAILED, ${passed} passed\n` : `test_bridge_trigger_loop: all ${passed} passed\n`);
  process.exit(failed ? 1 : 0);
})();
