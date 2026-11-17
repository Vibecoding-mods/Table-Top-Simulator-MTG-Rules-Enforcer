// The stress catalog's second batch, the bridge's items (the peer list of 2026-11-17, A to G):
//  A. Copies' targets: Storm, Thousand-Year Storm and the like ask "You may choose new targets for the copy" once per
//     copy. The first asks "Keep targets for all ×N" / "Choose each"; keeping answers the next copies unseen with the
//     copied spell's targets, one chat line; a copy whose targets differ or another question stops it.
//  B. Pick-many questions: "All (N)" and "None" when any number may be picked, none to all, and past 100 options
//     "All <name> (k)" for each name k options share; each answers as the picks it stands for.
//  C. Scry and surveil past 5 cards: the question (the table's two-zone layout, or scryPlaceSteps's one per card)
//     offers "All on top" and "All on the bottom (N)" (or into the graveyard) first; 5 or fewer as before.
//  E. The effects hover: past the 3 marks the "+N MORE EFFECTS" box lists 20 texts, then "... and N more".
//  F. Combat damage: one pick at most 999,999 (an attacker of 2^30 power), what is left still goes to the last one.
//  G. The largest state of each game in GET /stats ("largest" now, "games" once each ends) and said once in the log.
//   node tests/test_bridge_stress_catalog2.js
// (BRIDGE_PATH=<a copy> loads a copy instead: tools/mutate-stress-catalog2.js breaks one so a check fails by name.)
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

function setup(h, gvExtra = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: { turn: 4, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [], zones: [],
    players: [{ id: "player-0", manaPool: {} }, { id: "player-1", manaPool: {} }], ...gvExtra } }, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  const calls = [];
  const respond = seat.respond.bind(seat);
  seat.respond = (promptId, type, out) => { calls.push({ promptId, type, out }); return respond(promptId, type, out); };
  return { seat, calls };
}
const gvOf = (seat) => seat.board.state.gameView;
const shown = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.promptId != null).map((e) => e.tts);
const chats = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const ids = (p) => (p?.options || []).map((o) => o.id);
const answer = async (h, promptId, choice) => { h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId, choice: Array.isArray(choice) ? choice : [choice] }) }); await h.flush(); };

// A. Flusterstorm on the AI's Chart a Course, as hp-08 saw it (tests/golden/bridge-cases.js): the storm trigger
// resolving, the original on the stack targeting Chart a Course, a storm count of 4 (three copies)
const FL = "Counter target instant or sorcery spell unless its controller pays {1}.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)";
const chart = { id: "engine-stack-51", sourceId: "engine-card-961", controllerId: "player-1", identity: { name: "Chart a Course" }, sourceAbilityText: "Draw two cards. Then discard a card unless you attacked this turn.", targets: [] };
const bolt = { id: "engine-stack-52", sourceId: "engine-card-962", controllerId: "player-1", identity: { name: "Lightning Bolt" }, sourceAbilityText: "Lightning Bolt deals 3 damage to any target.", targets: [{ kind: "player", id: "player-0" }] };
const flu = (n, targets = [{ kind: "spell", id: "engine-stack-51" }]) => ({ id: `engine-stack-6${n}`, sourceId: `engine-card-14${n}`, controllerId: "player-0", identity: { name: "Flusterstorm" }, sourceAbilityText: FL, targets });
const stormTrig = { id: "engine-stack-70", sourceId: "engine-card-140", controllerId: "player-0", identity: { name: "Flusterstorm" }, isTrigger: true,
  sourceAbilityText: "Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)", targets: [] };
const copyAsk = (id, cands = ["engine-card-961", "engine-card-962"]) => ({ promptId: id, decidingPlayerId: "player-0",
  input: { type: "chooseBoardTargets", cancellable: true, candidates: cands.map((c) => ({ id: c, kind: "card" })), chosenTargets: 0, hostile: true, intent: "counter", maxTargets: 1, minTargets: 1, presentation: { title: "Counter", targets: [] } } });
const priority = (id) => ({ promptId: id, decidingPlayerId: "player-0", input: { type: "chooseAction", actions: [{ id: "a-1", type: "cast", cardId: "engine-card-5", label: "Cast Counterspell" }] } });
const kept = { type: "boardTargets", chosen: [{ kind: "card", id: "engine-card-961" }] };

(async () => {
  // A1. three copies: the first asks keep / choose each, keeping answers it and the next two unseen, one chat line
  {
    const h = harness.load();
    const { seat, calls } = setup(h, { stormCount: 4, stack: [chart, bolt, flu(0), stormTrig] });
    h.B.onPrompt(seat, copyAsk(200)); await h.flush();
    const first = shown(h).pop();
    same("A copies: the first copy asks keep or choose each", ids(first), ["__keepall", "__each"]);
    ok("A copies: the keep button counts the copies", first?.options?.[0]?.label === "Keep targets for all ×3", first?.options?.[0]?.label);
    ok("A copies: the question names the spell", /^3 copies of Flusterstorm: keep their targets\?$/.test(first?.title || ""), first?.title);
    await answer(h, 200, "__keepall");
    same("A copies: keeping answers this copy with the original's target", calls.map((c) => c.out), [kept]);
    gvOf(seat).stack = [chart, bolt, flu(0), stormTrig, flu(1)];
    const mark = h.effects.length;
    h.B.onPrompt(seat, copyAsk(201)); await h.flush();
    gvOf(seat).stack = [chart, bolt, flu(0), stormTrig, flu(1), flu(2)];
    h.B.onPrompt(seat, copyAsk(202)); await h.flush();
    same("A copies: the next two copies are answered unseen", calls.map((c) => [c.promptId, c.out]), [[200, kept], [201, kept], [202, kept]]);
    ok("A copies: nothing more is shown", shown(h, mark).length === 0, JSON.stringify(shown(h, mark)));
    same("A copies: one chat line at the end", chats(h, mark), ["[MTG] You kept the targets of 3 copies of Flusterstorm."]);
    ok("A copies: the run is over", seat.keepTargets == null);
    harness.restore();
  }
  // A2. "Choose each": this copy's own target question, then the next copy asks again
  {
    const h = harness.load();
    const { seat, calls } = setup(h, { stormCount: 3, stack: [chart, bolt, flu(0), stormTrig] });
    h.B.onPrompt(seat, copyAsk(210)); await h.flush();
    await answer(h, 210, "__each");
    const pick = shown(h).pop();
    ok("A choose each: the copy's target question comes", ids(pick).includes("card|engine-card-961") && ids(pick).includes("card|engine-card-962"), JSON.stringify(ids(pick)));
    ok("A choose each: the copy is named by its own spell, not the spell it targets", /^Copy of Flusterstorm: /.test(pick?.title || ""), pick?.title);
    await answer(h, 210, "card|engine-card-962");
    same("A choose each: the target picked is sent", calls.map((c) => c.out), [{ type: "boardTargets", chosen: [{ kind: "card", id: "engine-card-962" }] }]);
    gvOf(seat).stack = [chart, bolt, flu(0), stormTrig, flu(1, [{ kind: "spell", id: "engine-stack-52" }])];
    const mark = h.effects.length;
    h.B.onPrompt(seat, copyAsk(211)); await h.flush();
    ok("A choose each: the next copy is asked", shown(h, mark).length === 1 && calls.length === 1, JSON.stringify(shown(h, mark).map(ids)));
    harness.restore();
  }
  // A3. a copy whose original target is gone stops the run: asked as usual, said why
  {
    const h = harness.load();
    const { seat, calls } = setup(h, { stormCount: 4, stack: [chart, bolt, flu(0), stormTrig] });
    h.B.onPrompt(seat, copyAsk(220)); await h.flush();
    await answer(h, 220, "__keepall");
    const mark = h.effects.length;
    h.B.onPrompt(seat, copyAsk(221, ["engine-card-962"])); await h.flush();
    ok("A differ: a copy that can't keep the target is asked", calls.length === 1 && shown(h, mark).length === 1, JSON.stringify(calls.map((c) => c.promptId)));
    same("A differ: said once, why", chats(h, mark), ["[MTG] You kept the targets of 1 copy of Flusterstorm. Stopped early (the copies' targets differ): the rest are asked as usual."]);
    harness.restore();
  }
  // A4. a priority before the copies are done ends it, said why
  {
    const h = harness.load();
    const { seat } = setup(h, { stormCount: 4, stack: [chart, bolt, flu(0), stormTrig] });
    h.B.onPrompt(seat, copyAsk(230)); await h.flush();
    await answer(h, 230, "__keepall");
    const mark = h.effects.length;
    h.B.onPrompt(seat, priority(231)); await h.flush();
    ok("A priority: the run ends at a priority", seat.keepTargets == null && /Stopped early \(you have priority\)/.test(chats(h, mark).join("\n")), chats(h, mark).join(" | "));
    harness.restore();
  }
  // A5. one copy (a storm count of 2, Twincast): nothing offered, the target question as before
  {
    const h = harness.load();
    const { seat } = setup(h, { stormCount: 2, stack: [chart, bolt, flu(0), stormTrig] });
    h.B.onPrompt(seat, copyAsk(240)); await h.flush();
    ok("A one copy: no keep question", !ids(shown(h).pop()).includes("__keepall"), JSON.stringify(ids(shown(h).pop())));
    harness.restore();
  }
  // A6. Thousand-Year Storm's trigger, no count: "Keep targets for all copies", kept until another question
  {
    const h = harness.load();
    const tys = { id: "engine-stack-71", sourceId: "engine-card-150", controllerId: "player-0", identity: { name: "Thousand-Year Storm" }, isTrigger: true,
      sourceAbilityText: "Whenever you cast an instant or sorcery spell, copy it for each other instant and sorcery spell you've cast before it this turn. You may choose new targets for the copies.", targets: [] };
    const shock = { id: "engine-stack-63", sourceId: "engine-card-163", controllerId: "player-0", identity: { name: "Shock" }, sourceAbilityText: "Shock deals 2 damage to any target.", targets: [{ kind: "player", id: "player-1" }] };
    const { seat, calls } = setup(h, { stack: [shock, tys] });
    const ask = (id) => ({ promptId: id, decidingPlayerId: "player-0", input: { type: "chooseBoardTargets", cancellable: true, candidates: [{ id: "player-0", kind: "player" }, { id: "player-1", kind: "player" }],
      chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { title: "Choose a target", targets: [] } } });
    h.B.onPrompt(seat, ask(250)); await h.flush();
    ok("A Thousand-Year Storm: no count, all copies", shown(h).pop()?.options?.[0]?.label === "Keep targets for all copies", JSON.stringify(shown(h).pop()?.options));
    await answer(h, 250, "__keepall");
    h.B.onPrompt(seat, ask(251)); await h.flush();
    h.B.onPrompt(seat, ask(252)); await h.flush();
    const mark = h.effects.length;
    same("A Thousand-Year Storm: each copy keeps Shock's target", calls.map((c) => c.out.chosen), [[{ kind: "player", id: "player-1" }], [{ kind: "player", id: "player-1" }], [{ kind: "player", id: "player-1" }]]);
    h.B.onPrompt(seat, priority(253)); await h.flush();
    same("A Thousand-Year Storm: the priority ends it, all kept", chats(h, mark), ["[MTG] You kept the targets of 3 copies of Shock."]);
    harness.restore();
  }

  // B. a pick-many question as Forge asks it (chooseCards): Living Death's "exile any number of creature cards"
  const card = (n, name, extra = {}) => ({ id: `engine-card-${n}`, identity: { name }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", ...extra });
  const pickAsk = (id, cards, min, max, title = "Choose cards to exile") => ({ promptId: id, decidingPlayerId: "player-0", sourceCard: { id: "engine-card-1", identity: { name: "Living Death" }, text: "" },
    input: { type: "chooseCards", cards, min, max, presentation: { title } } });
  const five = ["Grizzly Bears", "Serra Angel", "Llanowar Elves", "Hill Giant", "Shivan Dragon"].map((n, i) => card(300 + i, n));
  for (const [what, min, max, want] of [["any number", 0, 5, ["__pickall", "__picknone"]], ["1 or more", 1, 5, []], ["up to 3", 0, 3, []], ["exactly 2", 2, 2, []]]) {
    const h = harness.load();
    const { seat } = setup(h);
    h.B.onPrompt(seat, pickAsk(300, five, min, max)); await h.flush();
    const q = shown(h).pop();
    same(`B quick (${what}): the quick buttons`, ids(q).filter((x) => x.startsWith("__")), want);
    if (want.includes("__pickall")) ok(`B quick (${what}): All says how many`, q.options[0].label === "All (5)", q.options[0].label);
    harness.restore();
  }
  for (const [what, choice, want] of [["All", "__pickall", five.map((c) => c.id)], ["None", "__picknone", []]]) {
    const h = harness.load();
    const { seat, calls } = setup(h);
    h.B.onPrompt(seat, pickAsk(301, five, 0, 5)); await h.flush();
    await answer(h, 301, choice);
    same(`B quick: ${what} sends its picks`, [...(calls[0]?.out?.chosenCardIds || ["(nothing sent)"])].sort(), [...want].sort());
    harness.restore();
  }
  // 120 Goblin tokens, 3 Elves and a Dragon: All Goblin (120), All Llanowar Elves (3); one alone gets none
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    const cards = [...Array.from({ length: 120 }, (_, i) => card(400 + i, "Goblin", { identity: { name: "Goblin", isToken: true }, power: 1, toughness: 1 })),
      card(600, "Llanowar Elves"), card(601, "Llanowar Elves"), card(602, "Llanowar Elves"), card(603, "Shivan Dragon")];
    h.B.onPrompt(seat, pickAsk(302, cards, 0, 124)); await h.flush();
    const q = shown(h).pop();
    const quick = (q?.options || []).filter((o) => String(o.id).startsWith("__")).map((o) => o.label);
    same("B names: past 100 options, All of each name shared", quick, ["All (124)", "None", "All Goblin (120)", "All Llanowar Elves (3)"]);
    await answer(h, 302, (q.options.find((o) => o.label === "All Goblin (120)") || {}).id);
    const sent = calls[0]?.out?.chosenCardIds || [];
    ok("B names: All Goblin sends the 120 Goblins", sent.length === 120 && sent.every((x) => Number(x.slice(12)) < 520), `${sent.length} sent`);
    harness.restore();
  }
  {
    const h = harness.load();
    const { seat } = setup(h);
    const cards = Array.from({ length: 60 }, (_, i) => card(700 + i, i < 40 ? "Goblin" : "Elf"));
    h.B.onPrompt(seat, pickAsk(303, cards, 0, 60)); await h.flush();
    ok("B names: 100 options or fewer get no name buttons", !ids(shown(h).pop()).some((x) => x.startsWith("__pickname:")), JSON.stringify(ids(shown(h).pop()).filter((x) => x.startsWith("__"))));
    harness.restore();
  }
  // a name run larger than the most that may be picked gets no button: 120 Goblins, up to 50
  {
    const h = harness.load();
    const { seat } = setup(h);
    const cards = [...Array.from({ length: 120 }, (_, i) => card(800 + i, "Goblin")), card(990, "Elf"), card(991, "Elf")];
    h.B.onPrompt(seat, pickAsk(304, cards, 0, 50)); await h.flush();
    same("B names: a run over the most allowed gets none", (shown(h).pop()?.options || []).filter((o) => String(o.id).startsWith("__")).map((o) => o.label), ["All Elf (2)"]);
    harness.restore();
  }

  // blockers (each option a pair) get no All: as golden's "block: shown", three pairs that may all be picked
  {
    const h = harness.load();
    const { seat } = setup(h);
    h.B.onPrompt(seat, { promptId: 305, decidingPlayerId: "player-0", input: { type: "chooseBlockers", error: "", attackers: [
      { attackerId: "engine-card-134", validBlockerIds: ["engine-card-35", "engine-card-75"], minBlockers: 1 },
      { attackerId: "engine-card-200", validBlockerIds: ["engine-card-76"], minBlockers: 1 }] } }); await h.flush();
    const q = shown(h).pop();
    ok("B blockers: no All or None for the block pairs", (q?.options || []).length >= 3 && !ids(q).some((x) => x.startsWith("__pick")), JSON.stringify(ids(q)));
    harness.restore();
  }
  // C. scry 8 (two zones, the table's layout), surveil 8, and a three-zone look at 8 (one question per card)
  const lib = (n) => Array.from({ length: n }, (_, i) => card(500 + i, `Card ${i + 1}`));
  const scryAsk = (id, n, zones, title) => ({ promptId: id, decidingPlayerId: "player-0", sourceCard: { id: "engine-card-2", identity: { name: "Lens of Clarity" }, text: "" },
    input: { type: "scry", zones, cards: lib(n), presentation: { title } } });
  for (const [what, zones, title, quickWant, choice, want] of [
    ["scry 8, all on the bottom", ["libraryTop", "libraryBottom"], "Scry 8", ["All on top", "All on the bottom (8)"], "__allin:libraryBottom", [[], lib(8).map((c) => c.id)]],
    ["surveil 8, all into the graveyard", ["libraryTop", "graveyard"], "Surveil 8", ["All on top", "All into the graveyard (8)"], "__allin:graveyard", [[], lib(8).map((c) => c.id)]],
    ["three zones, all on the bottom", ["libraryTop", "libraryBottom", "graveyard"], "Look at 8", ["All on top", "All on the bottom (8)", "All into the graveyard (8)"], "__allin:libraryBottom", [[], lib(8).map((c) => c.id), []]]]) {
    const h = harness.load();
    const { seat, calls } = setup(h);
    h.B.onPrompt(seat, scryAsk(310, 8, zones, title)); await h.flush();
    const q = shown(h).pop();
    same(`C ${what}: the first question offers them all at once`, (q?.options || []).filter((o) => String(o.id).startsWith("__allin:")).map((o) => o.label), quickWant);
    await answer(h, 310, choice);
    same(`C ${what}: sent at once`, calls[0]?.out?.zoneCardIds, want);
    harness.restore();
  }
  // all on top: then the order (Keep this order keeps the library's)
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    h.B.onPrompt(seat, scryAsk(311, 8, ["libraryTop", "libraryBottom"], "Scry 8")); await h.flush();
    await answer(h, 311, "__allin:libraryTop");
    const order = shown(h).pop();
    ok("C all on top: the order is asked next", ids(order).includes("__keep"), JSON.stringify(ids(order)));
    await answer(h, 311, "__keep");
    same("C all on top: every card on top, in order", calls[0]?.out?.zoneCardIds, [lib(8).map((c) => c.id), []]);
    harness.restore();
  }
  // 5 cards or fewer: as before, no quick buttons; the second card of a three-zone look has none either
  {
    const h = harness.load();
    const { seat } = setup(h);
    h.B.onPrompt(seat, scryAsk(312, 5, ["libraryTop", "libraryBottom"], "Scry 5")); await h.flush();
    ok("C scry 5: no quick buttons", !ids(shown(h).pop()).some((x) => x.startsWith("__allin:")), JSON.stringify(ids(shown(h).pop())));
    h.B.onPrompt(seat, scryAsk(313, 8, ["libraryTop", "libraryBottom", "graveyard"], "Look at 8")); await h.flush();
    await answer(h, 313, "libraryBottom");
    ok("C three zones: the second card's question has none", !ids(shown(h).pop()).some((x) => x.startsWith("__allin:")) && /Card 2/.test(shown(h).pop()?.title || ""), `${shown(h).pop()?.title} ${JSON.stringify(ids(shown(h).pop()))}`);
    harness.restore();
  }

  // E. the effects hover: 25 effects (22 past the marks) list 20 then "... and 2 more"; 23 (20 past) list all 20
  {
    const h = harness.load();
    const effects = (n) => Array.from({ length: n }, (_, i) => ({ id: `effect-${i}`, name: `Effect ${i + 1}`, text: `Text ${i + 1}.`, emblem: false, untilEndOfTurn: false }));
    const tip = (n) => ((h.B._effectMarks({ effects: effects(n) }, { zones: [] })[3] || "").split("\t")[1] || "").split("\n");
    const many = tip(25), exact = tip(23);
    harness.restore();
    ok("E effects: 22 past the marks list 20, then ... and 2 more", many.length === 21 && many[19] === "Effect 23: Text 23." && many[20] === "... and 2 more", JSON.stringify(many.slice(-3)));
    ok("E effects: 20 past the marks list all 20, nothing more said", exact.length === 20 && exact[19] === "Effect 23: Text 23.", JSON.stringify(exact.slice(-2)));
  }
  // F. combat damage: 2^30 power at two blockers
  {
    const h = harness.load();
    const big = 1073741824;
    const assignees = [{ id: "engine-card-11", label: "Grizzly Bears", lethal: 2 }, { id: "engine-card-12", label: "Hill Giant", lethal: 3 }];
    let sent = null;
    const step = h.B.damageSteps(big, assignees, (out) => { sent = out; return { type: "done" }; });
    ok("F damage: one pick at most 999,999", step.ui?.max === 999999 && h.B.DAMAGE_PICK_MAX === 999999, JSON.stringify(step.ui && { max: step.ui.max }));
    step.toOutput([String(big)]);
    same("F damage: a pick over it is clipped, the rest goes to the last one", sent, [{ assigneeId: "engine-card-11", damage: 999999 }, { assigneeId: "engine-card-12", damage: big - 999999 }]);
    const small = h.B.damageSteps(5, assignees, (out) => out);
    ok("F damage: a small attacker's pick as before", small.ui?.max === 5, JSON.stringify(small.ui?.max));
    harness.restore();
  }
  // G. the largest state: three boards, the middle one largest; kept in GET /stats, said once in the log as the game ends
  {
    const h = harness.load();
    const { seat } = setup(h);
    const bf = (n) => ({ zone: "battlefield", ownerId: "player-0", cards: Array.from({ length: n }, (_, i) => ({ id: `engine-card-${900 + i}`, identity: { name: "Goblin", isToken: true } })) });
    const gvAt = (turn, n, stack = 0, hand = 3) => ({ turn, zones: [bf(n), { zone: "hand", ownerId: "player-0", cards: Array.from({ length: hand }, (_, i) => ({ id: `engine-card-${800 + i}` })) }, { zone: "library", ownerId: "player-0", count: 50 }],
      stack: Array.from({ length: stack }, (_, i) => ({ id: `engine-stack-${i}` })) });
    h.B._noteBoard(gvAt(3, 10));
    h.B._noteBoard(gvAt(7, 600, 12, 45));
    h.B._noteBoard(gvAt(9, 20));
    const now = h.B._ttsStats.largest;
    same("G largest: this game's so far, the biggest board", now && { size: now.size, cards: now.cards, battlefield: now.battlefield, stack: now.stack, hand: now.hand, turn: now.turn },
      { size: 707, cards: 695, battlefield: 600, stack: 12, hand: 45, turn: 7 });
    const logs = () => h.effects.filter((e) => e.log && /largest state/.test(e.log)).map((e) => e.log);
    h.B._saveLargest(); h.B._saveLargest();
    const games = h.B._ttsStats.games || [];
    ok("G largest: kept in the games list once the game ends", games.length >= 1 && games[games.length - 1].size === 707 && games[games.length - 1].turn === 7, JSON.stringify(games.slice(-1)));
    ok("G largest: said once in the log", logs().length === 1 && /707 \(695 cards, 600 on the battlefield, 12 on the stack, the biggest hand 45\) on turn 7/.test(logs()[0]), JSON.stringify(logs()));
    ok("G largest: the next game starts from nothing", h.B._ttsStats.largest == null);
    harness.restore();
    void seat;
  }

  console.log(failed ? `FAILED: ${failed} of ${failed + passed}` : `PASSED: ${passed} checks`);
  process.exit(failed ? 1 : 0);
})();
