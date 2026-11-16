// A repeated yes/no (bridge.js offerRepeat, repeatRun, repeatStops, repeatFits, repeatEnd; the user, 2026-11-15: "I and
// my opponent had to answer No to 'pay {2}' multiple times. We should have a yes/no (x) times"). Smothering Tithe's
// "Pay {2}?" for each card Blue draws, as Forge asks it: one trigger on the stack per card, each asking "Pay {2}?" as it
// resolves, Blue's priority in between (bridge-live.log 2026-11-15: prompt #1957 Tithe, #1958 priority, #1970 Tithe...).
// Forge's stack words name the payer: "[Player: x]" for a draw trigger (TriggerDrawn.getImportantStackObjects),
// "[Card: ..., Activator: x, ...]" for a cast trigger (Rhystic Study). The checks:
//  - N >= 2 of the same question waiting: "No ×N" and "How many…" (no "Yes ×N" for a payment); one waiting: neither
//  - "No ×3": this one answered No, the priorities between passed, the next two answered No unseen, one chat line
//  - "How many…": a number from 1 to N starting at N; 0 and N+1 refused; 2 of 3 answers two, the third is asked
//  - stops: a new stack item, another question, a new step; the rest asked as usual, said once
//  - another player's trigger under it isn't counted; Rhystic Study's Activator; a "may" offers "Yes ×N" too
//  - a rewind (clearFollowUps) forgets the run
//   node tests/test_bridge_repeat_yesno.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };

const BLUE = "tts-Blue-ab12", AI = "self-hosted-node-77-bot";
const TITHE = "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")";
const RHYSTIC = "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.";
const titheCard = { id: "engine-card-101", controllerId: "player-1", identity: { name: "Smothering Tithe" }, text: TITHE };
const rhysticCard = (ctl) => ({ id: "engine-card-102", controllerId: ctl, identity: { name: "Rhystic Study" }, text: RHYSTIC });
// one Tithe trigger on the stack, its payer named as Forge does
const tithe = (n, payer = BLUE) => ({ id: `engine-stack-${n}`, sourceId: titheCard.id, controllerId: "player-1", identity: { name: "Smothering Tithe" }, isTrigger: true,
  sourceAbilityText: TITHE, targets: [], text: `${TITHE} [Player: ${payer}]` });
const rhystic = (n, ctl, activator, spell = "Opt") => ({ id: `engine-stack-${n}`, sourceId: "engine-card-102", controllerId: ctl, identity: { name: "Rhystic Study" }, isTrigger: true,
  sourceAbilityText: RHYSTIC, targets: [], text: `${RHYSTIC} [Card: ${spell} (250), Activator: ${activator}, SpellAbility: ${spell}]` });
const bolt = { id: "engine-stack-90", sourceId: "engine-card-90", controllerId: "player-1", identity: { name: "Lightning Bolt" }, sourceAbilityText: "Lightning Bolt deals 3 damage to any target.", isPermanentSpell: false, targets: [{ kind: "player", id: "player-0" }], text: "Lightning Bolt (90) - Lightning Bolt deals 3 damage to any target." };

function setup(h, stack) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: { turn: 4, step: "draw", activePlayerId: "player-0", priorityPlayerId: "player-0", stack, zones: [], players: [{ id: "player-0", manaPool: {} }, { id: "player-1", manaPool: {} }] } }, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: [BLUE, AI],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  const calls = [];
  // (the real respond too: it keeps each yes or no for the log, game.answers)
  const respond = seat.respond.bind(seat);
  seat.respond = (promptId, type, out) => { calls.push({ promptId, type, out }); return respond(promptId, type, out); };
  return { seat, calls };
}
const stackOf = (seat, stack) => { seat.board.state.gameView.stack = stack; };
// Forge's "Pay {2}?" as the harness sends it (confirm "Pay", deny "Decline", the "otherwise" text: tests/golden/bridge-cases.js)
const payAsk = (id, card = titheCard, otherwise = "AI 1 creates a Treasure token.", ability = TITHE) => ({ promptId: id, decidingPlayerId: "player-0", sourceCard: card, sourceAbilityText: ability,
  input: { type: "chooseBoolean", confirmLabel: "Pay", denyLabel: "Decline", presentation: { title: card === titheCard ? "Pay {2}?" : "Pay {1}?", text: `otherwise: "${otherwise}"` } } });
const mayAsk = (id) => ({ promptId: id, decidingPlayerId: "player-0", sourceCard: rhysticCard("player-0"), sourceAbilityText: RHYSTIC,
  input: { type: "chooseBoolean", presentation: { title: "Do you want to draw a card?" } } });
const priority = (id) => ({ promptId: id, decidingPlayerId: "player-0", input: { type: "chooseAction", actions: [{ id: "a-1", type: "cast", cardId: "engine-card-5", label: "Cast Counterspell" }] } });
const answer = async (h, promptId, choice) => { h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId, choice: [choice] }) }); await h.flush(); };
const shown = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.promptId != null).map((e) => e.tts);
const chats = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const ids = (p) => (p?.options || []).map((o) => o.id).join(",");
const labelOf = (p, id) => (p?.options || []).find((o) => o.id === id)?.label;

(async () => {
  // 1. three Tithe triggers for Blue: the buttons
  {
    const h = harness.load();
    const { seat } = setup(h, [tithe(3), tithe(2), tithe(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    const p = shown(h).pop();
    ok("three waiting: Yes, No, No ×3, How many… (no Yes ×3: Yes is a payment)", ids(p) === "yes,no,__repeat:no,__repeat:some", ids(p));
    ok("three waiting: the shortcut reads No ×3", labelOf(p, "__repeat:no") === "No ×3", labelOf(p, "__repeat:no"));
    ok("three waiting: the text says how many wait", /3 of these are waiting \(Smothering Tithe\)/.test(p?.text || ""), p?.text);
    harness.restore();
  }
  // 2. one waiting: the plain question
  {
    const h = harness.load();
    const { seat } = setup(h, [tithe(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    ok("one waiting: only Yes and No", ids(shown(h).pop()) === "yes,no", ids(shown(h).pop()));
    harness.restore();
  }
  // 3. No ×3: all three answered, the priorities between passed, one chat line
  {
    const h = harness.load();
    const { seat, calls } = setup(h, [tithe(3), tithe(2), tithe(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    const mark = h.effects.length;
    await answer(h, 500, "__repeat:no");
    ok("No ×3: this one is answered No", calls.length === 1 && calls[0].promptId === 500 && calls[0].out.value === false, JSON.stringify(calls));
    stackOf(seat, [tithe(3), tithe(2)]);
    h.B.onPrompt(seat, priority(501)); await h.flush();
    ok("No ×3: Blue's priority between them passes by itself", calls.length === 2 && calls[1].promptId === 501 && calls[1].out.type === "pass", JSON.stringify(calls.slice(1)));
    h.B.onPrompt(seat, payAsk(502)); await h.flush();
    ok("No ×3: the second is answered No unseen", calls.length === 3 && calls[2].promptId === 502 && calls[2].out.value === false, JSON.stringify(calls.slice(2)));
    stackOf(seat, [tithe(3)]);
    h.B.onPrompt(seat, priority(503)); await h.flush();
    h.B.onPrompt(seat, payAsk(504)); await h.flush();
    ok("No ×3: the third too", calls.length === 5 && calls[4].promptId === 504 && calls[4].out.value === false, JSON.stringify(calls.slice(3)));
    ok("No ×3: none of them was shown", !shown(h, mark).some((p) => [501, 502, 503, 504].includes(p.promptId)), shown(h, mark).map((p) => p.promptId).join(","));
    const said = chats(h, mark);
    ok("No ×3: one chat line says it", said.length === 1 && said[0] === "[MTG] You answered No to Smothering Tithe's \"Pay {2}?\" 3 times.", JSON.stringify(said));
    ok("No ×3: the run is over", seat.repeatAnswer == null, JSON.stringify(seat.repeatAnswer));
    // (each answer kept for the log as Blue's own "pay" answer: unlessNews says "Blue doesn't pay {2}" for each)
    const kept = h.B._getGame().answers?.get(titheCard.id) || [];
    ok("No ×3: each answer kept for the log", kept.length === 3 && kept.every((a) => a.kind === "pay" && a.value === false && a.slot === "player-0"), JSON.stringify(kept));
    stackOf(seat, []);
    h.B.onPrompt(seat, priority(505)); await h.flush();
    ok("No ×3: the priority after them is Blue's as usual", shown(h, mark).some((p) => p.promptId === 505), shown(h, mark).map((p) => p.promptId).join(","));
    harness.restore();
  }
  // 4. How many…: 1 to 3, starting at 3; 0 and 4 refused; 2 answers two, the third is asked
  {
    const h = harness.load();
    const { seat, calls } = setup(h, [tithe(3), tithe(2), tithe(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    await answer(h, 500, "__repeat:some");
    const num = seat.prompt?.ui;
    ok("how many: a number from 1 to 3", num?.mode === "number" && num.min === 1 && num.max === 3, JSON.stringify(num));
    ok("how many: it starts at all of them", num?.default === 3, num?.default);
    ok("how many: it says what it answers", num?.title === "Smothering Tithe: answer No to how many of these 3?", num?.title);
    ok("how many: nothing answered yet", calls.length === 0, JSON.stringify(calls));
    await answer(h, 500, "0");
    ok("how many: 0 is refused, the number asked again", calls.length === 0 && seat.prompt?.ui?.mode === "number", JSON.stringify(calls));
    await answer(h, 500, "4");
    ok("how many: 4 (more than wait) is refused", calls.length === 0 && seat.prompt?.ui?.mode === "number", JSON.stringify(calls));
    ok("how many: the refusal says the range", chats(h).some((t) => /Pick a number from 1 to 3\./.test(t)), JSON.stringify(chats(h)));
    const mark = h.effects.length;
    await answer(h, 500, "2");
    ok("how many: 2 answers this one No", calls.length === 1 && calls[0].promptId === 500 && calls[0].out.value === false, JSON.stringify(calls));
    stackOf(seat, [tithe(3), tithe(2)]);
    h.B.onPrompt(seat, priority(501)); await h.flush();
    h.B.onPrompt(seat, payAsk(502)); await h.flush();
    ok("how many: and the second", calls.length === 3 && calls[2].promptId === 502 && calls[2].out.value === false, JSON.stringify(calls));
    ok("how many: said once, 2 times", JSON.stringify(chats(h, mark)) === JSON.stringify(["[MTG] You answered No to Smothering Tithe's \"Pay {2}?\" 2 times."]), JSON.stringify(chats(h, mark)));
    stackOf(seat, [tithe(3)]);
    h.B.onPrompt(seat, priority(503)); await h.flush();
    ok("how many: the priority after the run is asked (an opponent's trigger on the stack)", shown(h, mark).some((p) => p.promptId === 503), shown(h, mark).map((p) => p.promptId).join(","));
    await answer(h, 503, "__pass");
    h.B.onPrompt(seat, payAsk(504)); await h.flush();
    const third = shown(h, mark).pop();
    ok("how many: the third is asked as usual (one left: Yes and No only)", third?.promptId === 504 && ids(third) === "yes,no", `${third?.promptId} ${ids(third)}`);
    harness.restore();
  }
  // 5. stops: a new stack item before the next one
  {
    const h = harness.load();
    const { seat, calls } = setup(h, [tithe(3), tithe(2), tithe(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    const mark = h.effects.length;
    await answer(h, 500, "__repeat:no");
    stackOf(seat, [tithe(3), tithe(2), bolt]);
    h.B.onPrompt(seat, priority(501)); await h.flush();
    ok("new stack item: Blue's priority is asked", shown(h, mark).some((p) => p.promptId === 501) && !calls.some((c) => c.promptId === 501), JSON.stringify(calls));
    ok("new stack item: said once, with why", JSON.stringify(chats(h, mark)) === JSON.stringify(["[MTG] You answered No to Smothering Tithe's \"Pay {2}?\" once. Stopped early (Lightning Bolt went on the stack): the rest are asked as usual."]), JSON.stringify(chats(h, mark)));
    await answer(h, 501, "__pass");
    stackOf(seat, [tithe(3), tithe(2)]);
    h.B.onPrompt(seat, payAsk(502)); await h.flush();
    ok("new stack item: the next Tithe is asked as usual", shown(h, mark).some((p) => p.promptId === 502) && !calls.some((c) => c.promptId === 502), JSON.stringify(calls));
    harness.restore();
  }
  // 6. stops: another question first
  {
    const h = harness.load();
    const { seat, calls } = setup(h, [tithe(3), tithe(2), tithe(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    const mark = h.effects.length;
    await answer(h, 500, "__repeat:no");
    stackOf(seat, [tithe(3), tithe(2)]);
    h.B.onPrompt(seat, { promptId: 501, decidingPlayerId: "player-0", sourceCard: { id: "engine-card-77", controllerId: "player-1", identity: { name: "Mind Rot" } },
      input: { type: "chooseBoolean", presentation: { title: "Reveal your hand?" } } }); await h.flush();
    ok("other question: it is asked", shown(h, mark).some((p) => p.promptId === 501) && calls.length === 1, JSON.stringify(calls));
    ok("other question: the run ends, said once", JSON.stringify(chats(h, mark)) === JSON.stringify(["[MTG] You answered No to Smothering Tithe's \"Pay {2}?\" once. Stopped early (another question came first): the rest are asked as usual."]) && seat.repeatAnswer == null, JSON.stringify(chats(h, mark)));
    harness.restore();
  }
  // 7. stops: the step changed
  {
    const h = harness.load();
    const { seat, calls } = setup(h, [tithe(3), tithe(2), tithe(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    await answer(h, 500, "__repeat:no");
    stackOf(seat, [tithe(3), tithe(2)]);
    seat.board.state.gameView.step = "main1";
    h.B.onPrompt(seat, priority(501)); await h.flush();
    ok("new step: the priority is asked", !calls.some((c) => c.promptId === 501), JSON.stringify(calls));
    ok("new step: said with why", chats(h).some((t) => /once\. Stopped early \(the step changed\)/.test(t)), JSON.stringify(chats(h)));
    harness.restore();
  }
  // 8. another player's trigger under Blue's isn't counted (each opponent drew: Tithe asks each its own)
  {
    const h = harness.load();
    const { seat } = setup(h, [tithe(4, "tts-Red-zz99"), tithe(3), tithe(2), tithe(1)]);
    h.B._getGame().playerOrder = [BLUE, AI, "tts-Red-zz99"];
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    ok("another payer: only Blue's three count", labelOf(shown(h).pop(), "__repeat:no") === "No ×3", ids(shown(h).pop()));
    stackOf(seat, [tithe(3), tithe(2, "tts-Red-zz99"), tithe(1)]);
    h.B.onPrompt(seat, payAsk(501)); await h.flush();
    ok("another payer: one between breaks the run (one of Blue's on top)", ids(shown(h).pop()) === "yes,no", ids(shown(h).pop()));
    harness.restore();
  }
  // 9. Rhystic Study: the payer by its Activator; Blue cast two spells
  {
    const h = harness.load();
    const { seat } = setup(h, [rhystic(2, "player-1", BLUE, "Shock"), rhystic(1, "player-1", BLUE)]);
    h.B.onPrompt(seat, payAsk(500, rhysticCard("player-1"), "AI 1 draws a card.", RHYSTIC)); await h.flush();
    const p = shown(h).pop();
    ok("Rhystic Study: two of Blue's: No ×2", labelOf(p, "__repeat:no") === "No ×2" && ids(p) === "yes,no,__repeat:no,__repeat:some", ids(p));
    harness.restore();
  }
  {
    const h = harness.load();
    const { seat } = setup(h, [rhystic(2, "player-1", "tts-Red-zz99", "Shock"), rhystic(1, "player-1", BLUE)]);
    h.B._getGame().playerOrder = [BLUE, AI, "tts-Red-zz99"];
    h.B.onPrompt(seat, payAsk(500, rhysticCard("player-1"), "AI 1 draws a card.", RHYSTIC)); await h.flush();
    ok("Rhystic Study: Red's spell's trigger under Blue's isn't Blue's question", ids(shown(h).pop()) === "yes,no", ids(shown(h).pop()));
    harness.restore();
  }
  // 10. a "may" with no payment (Blue's own Rhystic Study, AI 1 cast two spells and didn't pay): Yes ×2 too, and How
  // many… asks the number and then Yes or No
  {
    const h = harness.load();
    const { seat, calls } = setup(h, [rhystic(2, "player-0", AI, "Shock"), rhystic(1, "player-0", AI)]);
    h.B.onPrompt(seat, mayAsk(500)); await h.flush();
    const p = shown(h).pop();
    ok("may: Yes, No, No ×2, Yes ×2, How many…", ids(p) === "yes,no,__repeat:no,__repeat:yes,__repeat:some", ids(p));
    await answer(h, 500, "__repeat:some");
    ok("may: how many, 1 to 2", seat.prompt?.ui?.mode === "number" && seat.prompt.ui.min === 1 && seat.prompt.ui.max === 2 && seat.prompt.ui.default === 2, JSON.stringify(seat.prompt?.ui));
    await answer(h, 500, "2");
    ok("may: then Yes or No", ids(seat.prompt?.ui) === "yes,no" && /answer these 2 Yes or No\?$/.test(seat.prompt.ui.title), `${ids(seat.prompt?.ui)} ${seat.prompt?.ui?.title}`);
    const mark = h.effects.length;
    await answer(h, 500, "yes");
    ok("may: Yes answers this one", calls.length === 1 && calls[0].out.value === true, JSON.stringify(calls));
    stackOf(seat, [rhystic(2, "player-0", AI, "Shock")]);
    h.B.onPrompt(seat, priority(501)); await h.flush();
    h.B.onPrompt(seat, mayAsk(502)); await h.flush();
    ok("may: and the next one Yes", calls.length === 3 && calls[2].promptId === 502 && calls[2].out.value === true, JSON.stringify(calls));
    ok("may: said once", JSON.stringify(chats(h, mark)) === JSON.stringify(["[MTG] You answered Yes to Rhystic Study's \"Do you want to draw a card?\" 2 times."]), JSON.stringify(chats(h, mark)));
    harness.restore();
  }
  // 10b. a trigger with a target is its own question (each may name another target the player hasn't seen)
  {
    const h = harness.load();
    const aimed = (n) => ({ ...rhystic(n, "player-0", AI), targets: [{ kind: "player", id: "player-1" }] });
    const { seat } = setup(h, [aimed(2), aimed(1)]);
    h.B.onPrompt(seat, mayAsk(500)); await h.flush();
    ok("targets: triggers with targets offer no ×N", ids(shown(h).pop()) === "yes,no", ids(shown(h).pop()));
    harness.restore();
  }
  // 10c. a priority for a player Blue controls (Mindslaver) is never passed unseen: the run ends there
  {
    const h = harness.load();
    const { seat, calls } = setup(h, [tithe(3), tithe(2), tithe(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    await answer(h, 500, "__repeat:no");
    stackOf(seat, [tithe(3), tithe(2)]);
    const gv = seat.board.state.gameView;
    gv.players[1].controlledBy = "player-0";
    gv.priorityPlayerId = "player-1";
    h.B.onPrompt(seat, priority(501)); await h.flush();
    ok("controlled player: AI 1's priority under Blue's control is asked, not passed", !calls.some((c) => c.promptId === 501) && shown(h).some((p) => p.promptId === 501), JSON.stringify(calls));
    ok("controlled player: the run ends, said why", seat.repeatAnswer == null && chats(h).some((t) => /once\. Stopped early \(you have priority for AI 1\)/.test(t)), JSON.stringify(chats(h)));
    harness.restore();
  }
  // 10d. the payer by Player when both Player and Activator are named; a payment naming no payer isn't counted
  {
    const h = harness.load();
    const both = (n) => ({ ...tithe(n), text: `${TITHE} [Player: ${BLUE}, Activator: ${AI}]` });
    const { seat } = setup(h, [both(2), both(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    ok("payer: Player is read before Activator", labelOf(shown(h).pop(), "__repeat:no") === "No ×2", ids(shown(h).pop()));
    harness.restore();
  }
  {
    const h = harness.load();
    const bare = (n) => ({ ...tithe(n), text: TITHE });
    const { seat } = setup(h, [bare(2), bare(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    ok("payer: a payment whose stack words name no payer isn't counted", ids(shown(h).pop()) === "yes,no", ids(shown(h).pop()));
    harness.restore();
  }
  // 11. a rewind forgets the run
  {
    const h = harness.load();
    const { seat } = setup(h, [tithe(3), tithe(2), tithe(1)]);
    h.B.onPrompt(seat, payAsk(500)); await h.flush();
    await answer(h, 500, "__repeat:no");
    ok("rewind: (the run is on)", seat.repeatAnswer?.left === 2, JSON.stringify(seat.repeatAnswer));
    seat.clearFollowUps();
    ok("rewind: clearFollowUps forgets it", seat.repeatAnswer == null, JSON.stringify(seat.repeatAnswer));
    harness.restore();
  }

  process.stdout.write(failed ? `\n${failed} failed, ${passed} passed\n` : `PASSED: ${passed} passed, 0 failed\n`);
  process.exit(failed ? 1 : 0);
})();
