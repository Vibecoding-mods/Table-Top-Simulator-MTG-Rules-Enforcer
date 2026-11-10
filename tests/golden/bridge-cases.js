// Scenarios for the bridge golden master: real engine prompts and boards (fixtures/, recorded from Forge by
// bridge/engine-test.js --dump) plus hand-built prompts for every type the bridge handles, with the answers a
// player would give. Each scenario runs on a fresh bridge (tests/bridge-harness.js) and its side effects are
// the output. Ids refer to cards on the fixture boards.
const path = require("path");
const F = (n) => require(path.join(__dirname, "fixtures", `${n}.json`));
const clone = (x) => JSON.parse(JSON.stringify(x));

const D1 = F("dump"), D2 = F("dump2"), D3 = F("noset");
const card = (board, id) => {
  for (const z of board.gameView.zones) for (const c of z.cards || []) if (c.id === id) return clone(c);
  throw new Error(`fixture card ${id} missing`);
};
// D2: Blue (player-0) vs AI (player-1), turn 11 upkeep. Ours: hand 43 35 75 77 97 94 74, battlefield 22 64 65 36,
// command 199. Theirs: battlefield 192 126 195 110 134 104 200 181, graveyard 196 107.
const H = (n) => card(D2.board, `engine-card-${n}`);
const myMain = (board) => { const b = clone(board); b.gameView.activePlayerId = "player-0"; b.gameView.step = "main1"; b.gameView.priorityPlayerId = "player-0"; b.gameView.stack = []; return b; };
const prompt = (type, input, extra = {}) => ({ promptId: 900, decidingPlayerId: "player-0", input: { type, ...input }, ...extra });

// a game with one seated player (Blue) against one AI (White), drawn by the table
function game(h, board = D2.board, opts = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: clone(board), fingerprint: null };
  Object.assign(seat, structuredClone(opts.seat || {})); // (a copy: a seat that forgets a record must not change the case for the next run)
  const g = { seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"], // engine usernames, by slot
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, ...(opts.game || {}) };
  h.B._setGame(g);
  return seat;
}

// answers: list of choices, given one after another (step-by-step prompts take several)
function promptCase(name, board, p, answers = [], opts = {}) {
  return { name, run: async (h) => {
    const seat = game(h, board, opts);
    h.B.onPrompt(seat, p);
    await h.flush();
    for (const a of answers) {
      h.effects.push({ answer: a });
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: p.promptId, choice: a }) });
      await h.flush();
    }
    return { open: seat.prompt ? { type: seat.prompt.type, ui: seat.prompt.ui } : null, endTurnAt: seat.endTurnAt ?? null,
      resolveStack: seat.resolveStack ? [...seat.resolveStack] : null, autoPayCard: seat.autoPayCard ?? null };
  } };
}

function intentCase(name, board, p, intents, opts = {}) {
  return { name, run: async (h) => {
    const seat = game(h, board, opts);
    if (p) { h.B.onPrompt(seat, p); await h.flush(); }
    for (const m of intents) {
      h.effects.push({ intent: m });
      h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", ...m }) });
      await h.flush();
    }
    return { open: seat.prompt ? { type: seat.prompt.type, picks: seat.prompt.picks } : null };
  } };
}

const cases = [];
const add = (c) => cases.push(c);

// ── real prompts from Forge ──
for (const [dn, d] of [["dump", D1], ["dump2", D2], ["noset", D3]]) {
  for (const [type, p] of Object.entries(d.prompts)) {
    add(promptCase(`real ${dn} ${type}: shown`, d.board, p, []));
    if (type === "chooseBoardTargets") add(promptCase(`real ${dn} ${type}: first target`, d.board, p, [[`${p.input.candidates[0].kind}|${p.input.candidates[0].id}`]]));
    if (type === "payManaCost") {
      add(promptCase(`real ${dn} ${type}: auto-pay`, d.board, p, [["__auto"]]));
      add(promptCase(`real ${dn} ${type}: tap first`, d.board, p, [[p.input.actions[0].id]]));
      add(promptCase(`real ${dn} ${type}: cancel`, d.board, p, [["__cancel"]]));
    }
    if (type === "mulligan") { add(promptCase(`real ${dn} mulligan: keep`, d.board, p, [["keep"]])); add(promptCase(`real ${dn} mulligan: mull`, d.board, p, [["mull"]])); }
    if (type === "chooseBoolean") { add(promptCase(`real ${dn} boolean: yes`, d.board, p, [["yes"]])); add(promptCase(`real ${dn} boolean: no`, d.board, p, [["no"]])); }
    if (type === "chooseCards") {
      add(promptCase(`real ${dn} chooseCards: pick first`, d.board, p, [[p.input.cards[0].id]]));
      add(promptCase(`real ${dn} chooseCards: too many refused`, d.board, p, [p.input.cards.map((c) => c.id).concat(["x"])]));
      add(promptCase(`real ${dn} chooseCards: empty table answer {}`, d.board, p, [{}]));
    }
    if (type === "revealCards") add(promptCase(`real ${dn} reveal: resolve`, d.board, p, [["ok"]]));
    if (type === "chooseAction") {
      add(promptCase(`real ${dn} chooseAction in my main`, myMain(d.board), p, []));
      add(promptCase(`real ${dn} chooseAction in my main: end turn`, myMain(d.board), p, [["__endturn"]]));
    }
  }
}

// ── chooseAction variants ──
const acts = [
  { id: "a-land", type: "playLand", cardId: "engine-card-74", label: "Play Fire-Belly Changeling" },
  { id: "a-cast1", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "normal" } },
  { id: "a-cast2", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur (WebSlinging)", mode: { type: "alternative", cost: "webSlinging" } },
  { id: "a-cast3", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "normal" } },
  { id: "a-back", type: "cast", cardId: "engine-card-97", label: "Cast Heated Debate", mode: { type: "backFaceLand" } },
  { id: "a-fore", type: "cast", cardId: "engine-card-43", label: "Cast Vraska's Fall", mode: { type: "foretellExile" } },
  { id: "a-abil", type: "activateAbility", cardId: "engine-card-200", description: "Ninjutsu {1}{B}" },
  { id: "a-undo", type: "undoMana", cardId: "engine-card-36" },
  { id: "tap:engine-card-94:0", type: "activateAbility", cardId: "engine-card-94", isManaAbility: true, description: "Add {R}", producedMana: [{ amount: 1, color: "R" }] },
  { id: "tap:engine-card-35:0", type: "activateAbility", cardId: "engine-card-35", isManaAbility: true, description: "Add {G}", producedMana: [{ amount: 1, color: "G" }] },
  { id: "tap:engine-card-35:1", type: "activateAbility", cardId: "engine-card-35", isManaAbility: true, description: "Add {B}", producedMana: [{ amount: 1, color: "B" }] },
  { id: "tap:engine-card-36:0", type: "activateManaAbility", cardId: "engine-card-36", isManaAbility: true, description: "Mountain", producedMana: [{ amount: 1, color: "R" }] },
];
const actionP = prompt("chooseAction", { actions: acts });
add(promptCase("chooseAction full list in my main", myMain(D2.board), actionP, []));
add(promptCase("chooseAction: pass", myMain(D2.board), actionP, [["__pass"]]));
add(promptCase("chooseAction: cast option 2", myMain(D2.board), actionP, [["a-cast2"]]));
add(promptCase("chooseAction: mana creature with two colours asks which", myMain(D2.board), actionP, [["__mana:engine-card-35"], ["tap:engine-card-35:1"]]));
add(promptCase("chooseAction: mana creature with one colour taps", myMain(D2.board), actionP, [["__mana:engine-card-94"]]));
{
  const b = myMain(D2.board); b.gameView.stack = [{ id: "s1", controllerId: "player-1", identity: { name: "Shock" } }];
  add(promptCase("chooseAction: opponent's spell on the stack offers resolve", b, actionP, [["__resolve"]]));
  const b2 = clone(D2.board); b2.gameView.stack = [{ id: "s1", controllerId: "player-0", identity: { name: "Shock" } }];
  add(promptCase("chooseAction: own spell on the stack, not my turn: passes by itself", b2, actionP, []));
  const b3 = clone(D2.board); b3.gameView.step = "combatDeclareBlockers";
  add(promptCase("chooseAction: ninjutsu stops after blockers", b3, actionP, []));
  add(promptCase("chooseAction: stop for combat switched on", b3, prompt("chooseAction", { actions: acts.slice(0, 2) }), [], { seat: { stops: new Set(["combat"]) } }));
  add(promptCase("chooseAction: nothing to do in my main passes", myMain(D2.board), prompt("chooseAction", { actions: [acts[11]] }), []));
  // (2026-10-23) mana tapped and not spent: asked, with "Untap Mountain (mana back)", which sends the engine's undo
  const floatR = myMain(D2.board); floatR.gameView.players.find((p) => p.id === "player-0").manaPool = { ...floatR.gameView.players.find((p) => p.id === "player-0").manaPool, R: 1 };
  add(promptCase("chooseAction: floating mana can be taken back", floatR, prompt("chooseAction", { actions: [acts[7], acts[11]] }), [["a-undo"]]));
  // (hp-05: the engine still lists an undo after an "unless you pay" cost spent the mana: no "mana back" with an empty pool)
  const spent = clone(D2.board); spent.gameView.activePlayerId = "player-1";
  add(promptCase("chooseAction: undo listed but the pool is empty: no stale mana back, passes", spent, prompt("chooseAction", { actions: [acts[7], acts[11]] }), []));
  add(promptCase("chooseAction: undo listed, empty pool, my main: no mana back option", myMain(D2.board), prompt("chooseAction", { actions: [acts[7], acts[11]] }), []));
  // (the pool read is the seat's own: an opponent's floating mana is no mana of yours to take back)
  const theirsFloat = myMain(D2.board); theirsFloat.gameView.players.find((p) => p.id === "player-1").manaPool = { ...theirsFloat.gameView.players.find((p) => p.id === "player-1").manaPool, R: 2 };
  add(promptCase("chooseAction: undo listed, only an opponent's mana floats: no mana back option", theirsFloat, prompt("chooseAction", { actions: [acts[7], acts[11]] }), []));
  // (a pool sent with no colours at all is an empty pool, not an unknown one)
  const noKeys = myMain(D2.board); noKeys.gameView.players.find((p) => p.id === "player-0").manaPool = {};
  add(promptCase("chooseAction: undo listed, pool {}: no mana back option", noKeys, prompt("chooseAction", { actions: [acts[7], acts[11]] }), []));
  add(promptCase("chooseAction: end turn held for this turn", myMain(D2.board), actionP, [], { seat: { endTurnAt: 11 } }));
  add(promptCase("chooseAction: resolve-the-stack keeps passing", b, actionP, [], { seat: { resolveStack: new Set(["s1"]) } }));
}

// added after the first mutation pass (each closes an edit that escaped)
{
  const t0 = myMain(D2.board); t0.gameView.turn = 0;
  add(promptCase("chooseAction: end turn held on turn 0 (0 is a real turn number)", t0, actionP, [], { seat: { endTurnAt: 0 } }));
  const dmg = myMain(D2.board); dmg.gameView.step = "combatDamage"; dmg.gameView.activePlayerId = "player-1";
  add(promptCase("chooseAction: ninjutsu stop in the combat damage step", dmg, actionP, []));
  const two = myMain(D2.board); two.gameView.stack = [{ id: "s1", controllerId: "player-1" }, { id: "s2", controllerId: "player-1" }];
  add(promptCase("chooseAction: resolve-the-stack stops when something new joins", two, actionP, [], { seat: { resolveStack: new Set(["s1"]) } }));
  add(promptCase("damage split auto: not enough for the first blocker", D2.board, prompt("chooseCombatDamageAssignment",
    { attackerId: "engine-card-75", blockerIds: ["engine-card-134", "engine-card-35"], defenderId: "player-1", totalDamage: 2, attackerHasDeathtouch: false }), [["auto"]]));
  add(promptCase("reveal: a face-down card has no picture", D2.board, prompt("revealCards", { presentation: { title: "Look" }, cards: [{ ...H(43), visibility: "hidden" }, H(75)] }), [["ok"]]));
  add(intentCase("choose up to 1 by drag (min 0)", D2.board, prompt("chooseCards", { min: 0, max: 1, cards: [H(43), H(35)], presentation: { title: "You may discard" } }), [{ kind: "discard", id: "engine-card-35" }]));
  // two copies of one card in hand: the engine offers one action; dragging the other copy uses it
  const dup = myMain(D2.board); const hz = dup.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0");
  hz.cards.push({ ...H(74), id: "engine-card-174" });
  add(intentCase("play: second copy uses the first copy's action", dup, actionP, [{ kind: "play", id: "engine-card-174" }]));
}

// 2026-10-26: discarding most of a hand (16 of 23 at cleanup): pick the cards to keep; one of seven stays as it was
{
  const hand7 = [43, 35, 75, 77, 97, 94, 74].map((n) => ({ ...H(n), zone: "hand" }));
  add(promptCase("discard most of the hand: choose the cards to keep", D2.board, prompt("chooseCards", { min: 5, max: 5, cards: hand7, presentation: { title: "Discard 5 cards" } }), [["engine-card-43", "engine-card-74"]]));
  add(promptCase("discard one of seven: choose the card to discard", D2.board, prompt("chooseCards", { min: 1, max: 1, cards: hand7, presentation: { title: "Discard a card" } }), [["engine-card-97"]]));
  add(promptCase("discard most of the hand, as a cost: Cancel still cancels", D2.board, prompt("chooseCards", { min: 2, max: 2, cancellable: true, cards: hand7.slice(0, 3), presentation: { title: "Discard 2 cards" } }), [["__cancel"]]));
  add(promptCase("discard half the hand (3 of 6): choose the cards to discard", D2.board, prompt("chooseCards", { min: 3, max: 3, cards: hand7.slice(0, 6), presentation: { title: "Discard 3 cards" } }), [["engine-card-43", "engine-card-35", "engine-card-75"]]));
  add(promptCase("most of the hand, not a discard: chosen as asked", D2.board, prompt("chooseCards", { min: 5, max: 5, cards: hand7, presentation: { title: "Put 5 cards on the bottom of your library" } }), [["engine-card-43", "engine-card-35", "engine-card-75", "engine-card-77", "engine-card-97"]]));
  add(intentCase("discard most of the hand: a card dragged to the graveyard is discarded", D2.board, prompt("chooseCards", { min: 5, max: 5, cards: hand7, presentation: { title: "Discard 5 cards" } }), [{ kind: "discard", id: "engine-card-35" }]));
}
// ── payment variants ──
const payP = prompt("payManaCost", { cardId: "engine-card-75", cardName: "Hurloon Minotaur", manaCost: "{1}{R}{R}", canConfirmFromPool: false,
  actions: [acts[11], { id: "undo:engine-card-64", type: "undoMana", cardId: "engine-card-64" }, { id: "tap:engine-card-65:0", type: "activateManaAbility", cardId: "engine-card-65", description: "Swamp" }] });
add(promptCase("pay: shown", myMain(D2.board), payP, []));
// (hp-17: auto-pay keeps the colours the hand needs: scavenge's {4}{B} took 4 of 5 Forests with 4 Plains untapped, and
// Bear Umbra's {2}{G}{G} was lost)
{
  const hp17 = myMain(D2.board);
  const hz = hp17.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0");
  hz.cards = [{ id: "engine-card-970", identity: { name: "Bear Umbra" }, types: ["Enchantment"], manaCost: "{2}{G}{G}", ownerId: "player-0", controllerId: "player-0", text: "" }];
  const src = (n, col) => ({ id: `tap:engine-card-${n}:0`, type: "activateManaAbility", cardId: `engine-card-${n}`, cost: "{T}", producedMana: [{ amount: 1, color: col }], description: col });
  const lands = [src(981, "G"), src(982, "G"), src(983, "G"), src(984, "G"), src(985, "G"), src(986, "W"), src(987, "W"), src(988, "W"), src(989, "W"), src(990, "B")];
  const payScav = (cost, acts) => prompt("payManaCost", { cardId: "engine-card-75", cardName: "Dreg Mangler", manaCost: cost, canConfirmFromPool: false, actions: acts });
  add(promptCase("hp-17: auto-pay: the coloured part first, from its only source", hp17, payScav("{4}{B}", lands), [["__auto"]]));
  const going = { seat: { smartPay: { card: "engine-card-75", sent: [] } } };
  add(promptCase("hp-17: auto-pay goes on with a Plains, not a Forest the hand needs", hp17, payScav("{4}", lands.filter((l) => l.cardId !== "engine-card-990")), [], going));
  add(promptCase("hp-17: auto-pay with only Forests left uses them", hp17, payScav("{1}", lands.slice(0, 5)), [], going));
  add(promptCase("hp-17: after its taps the pool covers it: confirmed by itself", hp17, { ...payScav("{4}{B}", lands), input: { ...payScav("{4}{B}", lands).input, canConfirmFromPool: true } }, [], going));
  add(promptCase("hp-17: a hybrid cost goes to Forge's auto-pay", hp17, payScav("{1}{W/B}", lands), [["__auto"]]));
  add(promptCase("hp-17: not enough plain sources: Forge's auto-pay", hp17, payScav("{4}{B}", [...lands.slice(0, 3), src(990, "B")]), [["__auto"]]));
  add(promptCase("hp-17: a source with a cost beyond {T} is left to Forge", hp17, payScav("{B}", [{ ...src(990, "B"), cost: "{T}, Pay 1 life" }]), [["__auto"]]));
  // (suite review 2026-11-05: each rule of the plan, one case each)
  add(promptCase("hp-17: an X cost goes to Forge's auto-pay", hp17, payScav("{X}{B}", lands), [["__auto"]]));
  add(promptCase("hp-17: a Phyrexian cost goes to Forge's auto-pay", hp17, payScav("{1}{B/P}", lands), [["__auto"]]));
  add(promptCase("hp-17: a source making two mana is left to Forge", hp17, payScav("{2}", [{ ...src(990, "C"), producedMana: [{ amount: 2, color: "C" }] }]), [["__auto"]]));
  add(promptCase("hp-17: a payment naming no card goes to Forge's auto-pay", hp17, { ...payScav("{B}", lands), input: { ...payScav("{B}", lands).input, cardId: "" } }, [["__auto"]]));
  // (the land beats a mana creature, the hand needing neither)
  const elves = clone(hp17);
  elves.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-991", identity: { name: "Llanowar Elves" }, types: ["Creature"], power: 1, toughness: 1, ownerId: "player-0", controllerId: "player-0", text: "" });
  elves.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards = [];
  add(promptCase("hp-17: a land is tapped before a mana creature", elves, payScav("{1}", [src(991, "G"), src(986, "W")]), [["__auto"]]));
  // (a basic before a dual land, the hand needing neither colour: the dual is two actions of one colour each)
  const savannah = [{ ...src(992, "G") }, { ...src(992, "W"), id: "tap:engine-card-992:1" }];
  add(promptCase("hp-17: a basic is tapped before a dual land", elves, payScav("{1}", [...savannah, src(981, "G")]), [["__auto"]]));
  // (the scarcest colour first: {W} only the dual makes, so the Forest pays {G})
  add(promptCase("hp-17: the colour fewest sources make is planned first", elves, payScav("{G}{W}", [...savannah, src(981, "G")]), [["__auto"]]));
  // (the pool's mana counts: {B} floating, so only the {1} is planned and the first source listed pays it; planning the
  // full {1}{B} would tap the Swamp first)
  const floatB = clone(hp17); floatB.gameView.players.find((p) => p.id === "player-0").manaPool = { ...floatB.gameView.players.find((p) => p.id === "player-0").manaPool, B: 1 };
  add(promptCase("hp-17: mana floating is spent first", floatB, payScav("{1}{B}", [src(986, "W"), src(990, "B")]), [["__auto"]]));
  // (the card being paid for is no card the hand still needs: its own {G}{G} doesn't keep the Forest)
  const self = clone(elves); self.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards = [{ id: "engine-card-75", identity: { name: "Dreg Mangler" }, types: ["Creature"], manaCost: "{G}{G}", ownerId: "player-0", controllerId: "player-0", text: "" }];
  add(promptCase("hp-17: the spell's own cost is not the hand's need", self, payScav("{1}", [src(981, "G"), src(986, "W")]), [["__auto"]]));
  add(promptCase("hp-17: under way, the rest can't be planned: Forge's auto-pay", hp17, payScav("{B}", lands.slice(0, 5)), [], going));
  add(promptCase("hp-17: under way, a tap sent already and offered again: Forge's auto-pay", hp17, payScav("{B}", lands), [], { seat: { smartPay: { card: "engine-card-75", sent: ["tap:engine-card-990:0"] } } }));
  add(promptCase("hp-17: under way for another card: asked", hp17, payScav("{B}", lands), [], { seat: { smartPay: { card: "engine-card-64", sent: [] } } }));
  // (round 2 of the 2026-11-05 break-it pass: each closes a mutant that escaped)
  // hand need is per card: {G}{G} is one card needing green, as {W} is one needing white, so the first listed pays
  const perCard = clone(elves); perCard.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards = [
    { id: "engine-card-971", identity: { name: "Bear Umbra" }, types: ["Enchantment"], manaCost: "{G}{G}", ownerId: "player-0", controllerId: "player-0", text: "" },
    { id: "engine-card-972", identity: { name: "Pacifism" }, types: ["Enchantment"], manaCost: "{W}", ownerId: "player-0", controllerId: "player-0", text: "" }];
  add(promptCase("hp-17: the hand's need counts cards, not mana symbols", perCard, payScav("{1}", [src(981, "G"), src(986, "W")]), [["__auto"]]));
  add(promptCase("hp-17: a {C} cost is planned from a colourless source", elves, payScav("{C}", [src(986, "W"), src(993, "C")]), [["__auto"]]));
  const floatC = clone(hp17); floatC.gameView.players.find((p) => p.id === "player-0").manaPool = { ...floatC.gameView.players.find((p) => p.id === "player-0").manaPool, C: 1 };
  add(promptCase("hp-17: under way with nothing left owed: no tap, Forge's auto-pay", floatC, payScav("{1}", lands), [], going));
  // (life can pay part of it, so the pool isn't confirmed by itself; nor does our auto-pay tap on with the pool enough)
  const floatB2 = clone(floatB);
  add(promptCase("hp-17: under way, the pool covers it but life could pay: asked, nothing tapped", floatB2, { ...payScav("{1}{B/P}", [...lands, { id: "pay-life", type: "payLife", amount: 2 }]),
    input: { ...payScav("{1}{B/P}", [...lands, { id: "pay-life", type: "payLife", amount: 2 }]).input, canConfirmFromPool: true, manaCost: "{B/P}" } }, [], going));
  const twice = (name, steps) => add({ name, run: async (h) => {
    const seat = game(h, hp17, going);
    const out = [];
    for (const p of steps) {
      const mark = h.effects.length;
      h.B.onPrompt(seat, p); await h.flush();
      out.push({ sent: h.effects.slice(mark).filter((e) => e.relay).map((e) => e.relay.state?.action ?? e.relay), open: seat.prompt?.type ?? null });
    }
    return out;
  } });
  // (each tap sent is remembered, not only the first: the same tap offered twice goes to Forge the second time)
  twice("hp-17: under way, a later tap offered again: Forge's auto-pay", [payScav("{B}", lands), payScav("{B}", lands)]);
  // (another question between: the next payment for the same card is asked, not tapped; Mirri's second activation)
  twice("hp-17: a question between forgets our auto-pay", [prompt("chooseBoolean", { presentation: { title: "Draw a card?" } }), payScav("{B}", lands)]);
  // (paid: the same card's next payment is asked)
  twice("hp-17: paid from the pool, the same card's next payment is asked", [{ ...payScav("{B}", lands), input: { ...payScav("{B}", lands).input, canConfirmFromPool: true } }, payScav("{B}", lands)]);
  // (relations review 2026-11-05: a pain land's painful ability is the last to pay generic, whichever Forge lists first)
  const wastesC = { id: "tap:engine-card-994:0", type: "activateManaAbility", cardId: "engine-card-994", cost: "{T}", isManaAbility: true, description: "{T}: Add {C}.", producedMana: [{ amount: 1, color: "C" }] };
  const wastesG = { ...wastesC, id: "tap:engine-card-994:1:G", description: "{T}: Add {B} or {G}. Llanowar Wastes deals 1 damage to you.", producedMana: [{ amount: 1, color: "G" }] };
  add(promptCase("hp-17: a pain land pays generic with its painless {C}, listed second", elves, payScav("{1}", [wastesG, wastesC]), [["__auto"]]));
  add(promptCase("hp-17: a pain land pays {G} with its painful ability when that is the only {G}", elves, payScav("{G}", [wastesC, wastesG]), [["__auto"]]));
  // (a rewind forgets it: the same card's payment asked again is asked, not tapped)
  add({ name: "hp-17: a rewind forgets our auto-pay under way", run: async (h) => {
    const seat = game(h, hp17, going);
    const at = (turn) => { const b = clone(hp17); b.gameView.turn = turn; return b; };
    seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: at(9) }); await h.flush();
    seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: at(8) }); await h.flush();
    const mark = h.effects.length;
    h.B.onPrompt(seat, payScav("{B}", lands)); await h.flush();
    return { smartPay: seat.smartPay ?? null, open: seat.prompt?.type ?? null, sent: h.effects.slice(mark).filter((e) => e.relay).map((e) => e.relay.state?.action ?? e.relay) };
  } });
}
add(promptCase("pay: pool covers it after auto-pay -> confirms itself", myMain(D2.board), { ...payP, input: { ...payP.input, canConfirmFromPool: true } }, [], { seat: { autoPayCard: "engine-card-75" } }));
add(promptCase("pay: pool covers it, no auto-pay -> asks", myMain(D2.board), { ...payP, input: { ...payP.input, canConfirmFromPool: true } }, [["__pool"]]));
// 2026-10-26: the player's own spell, just cast, with the pool covering it: paid from the pool without asking (Arena);
// another card's cost, or one cast long ago, still asks
add(promptCase("pay: pool covers your spell just cast -> pays itself", myMain(D2.board), { ...payP, input: { ...payP.input, canConfirmFromPool: true } }, [], { seat: { lately: { start: { id: "engine-card-75", at: Date.now() + 1e9 } } } }));
add({ name: "pay: cast from the priority question, the pool covers it -> paid without asking", run: async (h) => {
  const seat = game(h, myMain(D2.board));
  h.B.onPrompt(seat, actionP); await h.flush();
  h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["a-cast1"] }) }); await h.flush();
  const mark = h.effects.length;
  h.B.onPrompt(seat, { ...payP, promptId: 901, input: { ...payP.input, canConfirmFromPool: true } }); await h.flush();
  return { after: h.effects.slice(mark).map((e) => e.relay ? "relay " + JSON.stringify(e.relay.state.action) : e.tts ? "tts " + e.tts.t + " " + (e.tts.title || "") : Object.keys(e)[0]) };
} });
add(promptCase("pay: pool covers another card's cost -> asks", myMain(D2.board), { ...payP, input: { ...payP.input, canConfirmFromPool: true } }, [], { seat: { lately: { start: { id: "engine-card-64", at: Date.now() + 1e9 } } } }));
add(promptCase("pay: pool covers a spell cast a minute ago -> asks", myMain(D2.board), { ...payP, input: { ...payP.input, canConfirmFromPool: true } }, [], { seat: { lately: { start: { id: "engine-card-75", at: 0 } } } }));
add(promptCase("pay: auto-pay failed -> no auto button", myMain(D2.board), payP, [], { seat: { autoPayCard: "engine-card-75" } }));
add(promptCase("pay: hand tap remembered", myMain(D2.board), payP, [["tap:engine-card-36:0"]]));
// a five-colour land: each button ranked against what is still due (2 needed colour, 1 generic only, 0 no use)
{
  const brass = ["W", "U", "B", "R", "G"].map((c, i) => ({ id: `tap:engine-card-65:${i}`, type: "activateManaAbility", cardId: "engine-card-65",
    isManaAbility: true, description: "City of Brass", producedMana: [{ amount: 1, color: c }] }));
  add(promptCase("pay: five-colour land ranks its colours ({B})", myMain(D2.board), prompt("payManaCost", { cardId: "engine-card-75", cardName: "Feed the Swarm", manaCost: "{B}", canConfirmFromPool: false, actions: brass }), []));
  add(promptCase("pay: five-colour land ranks its colours ({2}{W/U}{B/P})", myMain(D2.board), prompt("payManaCost", { cardId: "engine-card-75", cardName: "X", manaCost: "{2}{W/U}{B/P}", canConfirmFromPool: false, actions: brass }), []));
}
// {U} already floating while paying {1}{U}{B}: City of Brass's {B} ranks above its {U} (a game looped 1,600 times
// tapping it for {U} again, 2026-10-22 review)
{
  const brass = ["W", "U", "B", "R", "G"].map((col) => ({ id: `tap:engine-card-65:0:${col}`, type: "activateManaAbility", cardId: "engine-card-65",
    isManaAbility: true, description: "City of Brass", producedMana: [{ amount: 1, color: col }] }));
  const board = myMain(D2.board);
  const me = board.gameView.players.find((p) => p.id === "player-0");
  me.manaPool = { U: 1 };
  const board2 = myMain(D2.board);
  board2.gameView.players.find((p) => p.id === "player-0").manaPool = { R: 2 };
  add(promptCase("pay: floating mana covers the generic part", board2, prompt("payManaCost", { cardId: "engine-card-75", cardName: "X", manaCost: "{2}{G}", canConfirmFromPool: false, actions: [
    { id: "tap:engine-card-96:0", type: "activateManaAbility", cardId: "engine-card-96", isManaAbility: true, description: "Forest", producedMana: [{ amount: 1, color: "G" }] },
    { id: "tap:engine-card-97:0", type: "activateManaAbility", cardId: "engine-card-97", isManaAbility: true, description: "Mountain", producedMana: [{ amount: 1, color: "R" }] }] }), []));
  add(promptCase("pay: mana already in the pool counts", board, prompt("payManaCost", { cardId: "engine-card-75", cardName: "Yuriko", manaCost: "{1}{U}{B}", canConfirmFromPool: false, actions: brass }), []));
}
// a Forest that is also a Swamp (Urborg) paying {B}{G} beside a Swamp: its {G} ranks higher (nothing else makes {G})
add(promptCase("pay: the colour only one land can make ranks first", myMain(D2.board), prompt("payManaCost", { cardId: "engine-card-75", cardName: "Assassin's Trophy", manaCost: "{B}{G}", canConfirmFromPool: false, actions: [
  { id: "tap:engine-card-96:0", type: "activateManaAbility", cardId: "engine-card-96", isManaAbility: true, description: "Forest", producedMana: [{ amount: 1, color: "B" }] },
  { id: "tap:engine-card-96:1", type: "activateManaAbility", cardId: "engine-card-96", isManaAbility: true, description: "Forest", producedMana: [{ amount: 1, color: "G" }] },
  { id: "tap:engine-card-11:0", type: "activateManaAbility", cardId: "engine-card-11", isManaAbility: true, description: "Swamp", producedMana: [{ amount: 1, color: "B" }] }] }), []));
// a card chosen to pay a cost offers Cancel (our Forge build, 2026-10-23); one that does not, none
add(promptCase("cost cards: Cancel takes the spell back", myMain(D2.board), prompt("chooseCards", { min: 1, max: 1, cancellable: true, cards: [H(43), H(35)], presentation: { title: "Discard a card" } }), [["__cancel"]]));
add(promptCase("cost cards: no Cancel when the engine offers none", myMain(D2.board), prompt("chooseCards", { min: 1, max: 1, cancellable: false, cards: [H(43), H(35)], presentation: { title: "Discard a card" } }), [["engine-card-43"]]));
// targets: fewer legal ones than needed (only Cancel helps); a target in a graveyard pictured for the card row
// 2026-10-27 (hp-07 hand test): Forge's AI hints in titles said plainly; a sacrifice names what is sacrificed
add(promptCase("targets: Sacrifice among lands asks for a land, not a target", myMain(D2.board), prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1,
  candidates: [{ kind: "card", id: "engine-card-64" }, { kind: "card", id: "engine-card-65" }], presentation: { title: "Sacrifice" } }), [["card|engine-card-64"]]));
add(promptCase("targets: Sacrifice among other permanents asks for a permanent", myMain(D2.board), prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1,
  candidates: [{ kind: "card", id: "engine-card-64" }, { kind: "card", id: "engine-card-134" }], presentation: { title: "Sacrifice" } }), [["card|engine-card-134"]]));
add(promptCase("targets: Sacrifice among creatures asks for a creature", myMain(D2.board), prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1,
  candidates: [{ kind: "card", id: "engine-card-134" }, { kind: "card", id: "engine-card-200" }], presentation: { title: "Sacrifice" } }), [["card|engine-card-200"]]));
add(promptCase("targets: Choose player to buff asks for players, no verb", myMain(D2.board), prompt("chooseBoardTargets", { minTargets: 0, maxTargets: 2,
  candidates: [{ kind: "player", id: "player-0" }, { kind: "player", id: "player-1" }], presentation: { title: "Choose player to buff" } }), [["player|player-1"]]));
add(promptCase("targets: Choose player to lose asks who loses life", myMain(D2.board), prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1,
  candidates: [{ kind: "player", id: "player-0" }, { kind: "player", id: "player-1" }], presentation: { title: "Choose player to lose" } }), [["player|player-1"]]));
add(promptCase("targets: fewer than needed says Cancel", myMain(D2.board), prompt("chooseBoardTargets", { minTargets: 2, maxTargets: 2, cancellable: true,
  candidates: [{ kind: "card", id: "engine-card-22" }], presentation: { title: "Destroy" } }), [["__cancel"]]));
{
  // Vraska's Fall moved from Blue's hand into Blue's graveyard (a card the harness has a picture for)
  const b = myMain(D2.board);
  const zs = b.gameView.zones;
  const hand = zs.find((z) => z.zone === "hand" && z.cards.some((c) => c.id === "engine-card-43"));
  const card = hand.cards.find((c) => c.id === "engine-card-43");
  hand.cards = hand.cards.filter((c) => c !== card);
  zs.find((z) => z.zone === "graveyard" && z.ownerId === hand.ownerId).cards.push(card);
  add({ ...promptCase("targets: a card in a graveyard has a picture", b, prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, cancellable: true,
    candidates: [{ kind: "card", id: "engine-card-43" }, { kind: "card", id: "engine-card-22" }], presentation: { title: "Return" } }), [["card|engine-card-43"]]),
    harness: { imageCache: { "vraska's fall": { face: "https://img.example/vraska.webp" }, "evolving wilds": { face: "https://img.example/wilds.webp" } } } });
}

// ── the other prompt types ──
add(promptCase("mulligan put-back: pick 1", D2.board, prompt("mulliganPutBack", { count: 1, handCardIds: ["engine-card-43", "engine-card-35", "engine-card-75"] }), [["engine-card-35"]]));
add(promptCase("mulligan put-back: wrong count refused", D2.board, prompt("mulliganPutBack", { count: 2, handCardIds: ["engine-card-43", "engine-card-35", "engine-card-75"] }), [["engine-card-35"]]));
add(promptCase("boolean with own labels", D2.board, prompt("chooseBoolean", { confirmLabel: "Pay 2 life", denyLabel: "Don't", presentation: { title: "Pay life?" } }, { sourceCard: H(77), sourceAbilityText: "Pay 2 life or it enters tapped." }), [["no"]]));
add(promptCase("number", D2.board, prompt("chooseNumber", { min: 0, max: 5, presentation: { title: "Choose X" } }), [["3"]]));
add(promptCase("selection: two of three", D2.board, prompt("chooseFromSelection", { minTotal: 1, maxTotal: 2, options: [{ label: "Mode B" }, { label: "Mode A" }, { label: "Mode C" }] }), [["0", "2"]]));
add(promptCase("colour", D2.board, prompt("chooseColor", { validColors: ["R", "G"], amount: 2 }), [["G"]]));
add(promptCase("dice", D2.board, prompt("diceRolled", { rolls: [{ playerId: "player-0", finalResults: [5], highlighted: true }, { playerId: "player-1", finalResults: [3] }] }), [["ok"]]));
// 2026-10-27: the engine labels each roll with the account name ("self-hosted-node-…-bot"): the table's names are said
add(promptCase("dice: labelled with account names, said with the table's names", D2.board, prompt("diceRolled", { rolls: [{ playerId: "player-0", label: "tts-Blue-ab12", finalResults: [9] }, { playerId: "player-1", label: "self-hosted-node-77-bot", finalResults: [18], highlighted: true }] }), [["ok"]]));
add(promptCase("reveal: AI's own warning is acknowledged silently", D2.board, prompt("revealCards", { presentation: { title: "AI can't play these cards well" }, cards: [] }), []));
add(promptCase("reveal: opponent's library with pictures", D2.board, prompt("revealCards", { presentation: { title: "AI 1 picked" }, ownerPlayerId: "player-1", zone: "library", cards: [H(43), H(75)] }), [["ok"]]));
const attackP = prompt("chooseAttackers", { attackers: [
  { attackerId: "engine-card-35", validTargetIds: ["player-1"], mustAttack: false },
  { attackerId: "engine-card-75", validTargetIds: ["player-1", "engine-card-200"], mustAttack: true },
  { attackerId: "engine-card-74", validTargetIds: [], mustAttack: false }] });
add(promptCase("attack: shown", D2.board, attackP, []));
add(promptCase("attack: all attack", D2.board, attackP, [["__allattack"]]));
add(promptCase("attack: no attacks keeps the must-attack one", D2.board, attackP, [["__noattack"]]));
add(promptCase("attack: one at the planeswalker", D2.board, attackP, [["engine-card-75|engine-card-200"]]));
add(promptCase("attack: none possible", D2.board, prompt("chooseAttackers", { attackers: [] }), [[]]));
// 2026-11-01: a refused attack says why (Kardur, Doomscourge: "Attack declaration invalid", 15 times, nothing else)
add(promptCase("attack: refused with nothing that must attack", D2.board, prompt("revealCards", { presentation: { title: "Attack declaration invalid" }, cards: [] }), []));
add({ name: "attack: refused, names who must attack", run: async (h) => {
  const seat = game(h, D2.board);
  h.B.sendTable(); await h.flush();
  h.B.onPrompt(seat, attackP); await h.flush();
  h.B.onPrompt(seat, prompt("revealCards", { presentation: { title: "Attack declaration invalid" }, cards: [] })); await h.flush();
  return { mustAttack: seat.mustAttack };
} });
// 2026-10-27: End turn pressed this turn skips the attack (the must-attack creature still attacks); another turn's doesn't
add(promptCase("attack: End turn this turn skips it", D2.board, attackP, [], { seat: { endTurnAt: D2.board.gameView.turn } }));
add(promptCase("attack: End turn from an earlier turn doesn't", D2.board, attackP, [], { seat: { endTurnAt: D2.board.gameView.turn - 1 } }));
const blockP = prompt("chooseBlockers", { error: "", attackers: [
  { attackerId: "engine-card-134", validBlockerIds: ["engine-card-35", "engine-card-75"], minBlockers: 1 },
  { attackerId: "engine-card-200", validBlockerIds: ["engine-card-75"], minBlockers: 2, mustBeBlocked: true }] });
add(promptCase("block: shown", D2.board, blockP, []));
add(promptCase("block: one blocker picked twice keeps the last", D2.board, blockP, [["engine-card-75|engine-card-134", "engine-card-75|engine-card-200"]]));
add(promptCase("block: no blocks", D2.board, blockP, [[]]));
const cards3 = [H(43), H(35), H(75)];
add(promptCase("scry 3: bottom one, order the other two", D2.board, prompt("scry", { zones: ["libraryTop", "libraryBottom"], cards: cards3, presentation: { title: "Scry 3" } }), [["engine-card-35"], ["engine-card-75"]]));
add(promptCase("scry 3: keep all, keep this order", D2.board, prompt("scry", { zones: ["libraryTop", "libraryBottom"], cards: cards3, presentation: { title: "Scry 3" } }), [[], ["__keep"]]));
// (an empty library: nothing to look at, so no question, hp-08 re-test #10 2026-10-28)
add(promptCase("scry 0: nothing to look at answers itself", D2.board, prompt("scry", { zones: ["libraryTop", "libraryBottom"], cards: [], presentation: { title: "Scry 0" } }), []));
add(promptCase("scry 1: one card to the bottom (the same question as more cards: the table shows it in the hand zone)", D2.board, prompt("scry", { zones: ["libraryTop", "libraryBottom"], cards: [H(43)], presentation: { title: "Scry 1" } }), [["engine-card-43"]]));
// mutate's "choose a card" between the mutating card and its target: which one goes on top (2026-10-24)
{
  const starrix = { ...H(43), identity: { ...H(43).identity, name: "Auspicious Starrix" }, text: "Mutate {5}{G}" };
  add(promptCase("mutate: the merge question says which creature goes on top", D2.board,
    prompt("chooseCards", { min: 1, max: 1, cards: [starrix, H(35)], presentation: { title: "Auspicious Starrix: choose a card" } }, { sourceCard: starrix }), [["engine-card-35"]]));
}
// scry the table's way (2026-10-24): the table answers "__tts" with the cards dragged onto the library (top card first)
// and the ones moved; any card it doesn't name stays on top
add(promptCase("scry 3 the table's way: two dragged on top in order, one to the bottom", D2.board, prompt("scry", { zones: ["libraryTop", "libraryBottom"], cards: cards3, presentation: { title: "Scry 3" } }),
  [["__tts", "top:engine-card-75", "top:engine-card-35", "move:engine-card-43"]]));
add(promptCase("scry 1 the table's way: dragged onto the library", D2.board, prompt("scry", { zones: ["libraryTop", "libraryBottom"], cards: [H(43)], presentation: { title: "Scry 1" } }), [["__tts", "top:engine-card-43"]]));
add(promptCase("surveil 2 the table's way: one into the graveyard, the other stays on top", D2.board, prompt("scry", { zones: ["libraryTop", "graveyard"], cards: [H(43), H(75)], presentation: { title: "Surveil 2" } }), [["__tts", "move:engine-card-43"]]));
add(promptCase("scry the table's way: unknown ids are ignored, a card named twice counts once", D2.board, prompt("scry", { zones: ["libraryTop", "libraryBottom"], cards: [H(43), H(75)], presentation: { title: "Scry 2" } }), [["__tts", "top:engine-card-75", "move:engine-card-75", "top:engine-card-999"]]));
add(promptCase("surveil 2: one to the graveyard", D2.board, prompt("scry", { zones: ["libraryTop", "graveyard"], cards: [H(43), H(75)], presentation: { title: "Surveil 2" } }), [["engine-card-43"]]));
add(promptCase("three destinations: place each, then order", D2.board, prompt("scry", { zones: ["libraryTop", "libraryBottom", "graveyard"], cards: cards3, presentation: { title: "Look at 3" } }),
  [["libraryTop"], ["graveyard"], ["libraryTop"], ["engine-card-75"]]));
const reorderP = prompt("reorder", { items: [{ id: "r1", card: H(43), oracle: "Destroy target creature or planeswalker." }, { id: "r2", card: H(77) }, { id: "r3", card: H(35) }], presentation: { title: "Order your triggers" } });
add(promptCase("reorder: pick in order", D2.board, reorderP, [["r3"], ["r1"]]));
add(promptCase("reorder: keep this order", D2.board, reorderP, [["__keep"]]));
// 2026-10-22 playtest: the order questions in plain words (triggers, the top of the library, the bottom)
const itemsP = (title, extra) => ({ ...prompt("reorder", { items: [{ id: "r1", card: H(43) }, { id: "r2", card: H(77) }, { id: "r3", card: H(35) }], presentation: { title } }), ...extra });
// (Forge names one of the triggers' cards as the source: a library card's text doesn't make it a library order)
add(promptCase("reorder words: triggers", D2.board, itemsP("Order triggered abilities", { sourceCard: { ...H(77), identity: { name: "Mirri's Guile" } }, sourceAbilityText: "At the beginning of your upkeep, you may look at the top three cards of your library, then put them back in any order." }), [["r2"], ["r1"]]));
// (mechanic run 2026-11-05 open items)
{
  // hp-18: graft on a land said "from this creature"
  const reborn = { id: "engine-card-960", identity: { name: "Llanowar Reborn" }, types: ["Land"], text: "Graft 1" };
  add(promptCase("hp-18: a land's graft question says this land", myMain(D2.board), prompt("chooseBoolean", { confirmLabel: "Yes", denyLabel: "No",
    presentation: { title: "Move a +1/+1 counter from this creature onto it?" } }, { sourceCard: reborn, sourceAbilityText: "Whenever another creature enters, you may move a +1/+1 counter from this creature onto it." }), [["no"]]));
  add(promptCase("hp-18: a creature's graft question keeps this creature", myMain(D2.board), prompt("chooseBoolean", { confirmLabel: "Yes", denyLabel: "No",
    presentation: { title: "Move a +1/+1 counter from this creature onto it?" } }, { sourceCard: { ...reborn, identity: { name: "Cytoplast Root-Kin" }, types: ["Creature"] }, sourceAbilityText: "Whenever another creature enters, you may move a +1/+1 counter from this creature onto it." }), [["no"]]));
  // hp-06 and hp-14: a face-down card you may see says so; alike tokens get power/toughness, then a number
  const tg = myMain(D2.board);
  tg.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push(
    { id: "engine-card-961", identity: { name: "Brainstorm" }, isFaceDown: true, types: ["Instant"], power: 2, toughness: 2, ownerId: "player-0", controllerId: "player-0", text: "" },
    { id: "engine-card-962", identity: { name: "Coruscation Mage", isToken: true }, types: ["Creature"], power: 2, toughness: 2, ownerId: "player-0", controllerId: "player-0", text: "" },
    { id: "engine-card-963", identity: { name: "Coruscation Mage", isToken: true }, types: ["Creature"], power: 1, toughness: 1, ownerId: "player-0", controllerId: "player-0", text: "" },
    { id: "engine-card-964", identity: { name: "Goblin", isToken: true }, types: ["Creature"], power: 1, toughness: 1, ownerId: "player-0", controllerId: "player-0", text: "" },
    { id: "engine-card-965", identity: { name: "Goblin", isToken: true }, types: ["Creature"], power: 1, toughness: 1, ownerId: "player-0", controllerId: "player-0", text: "" });
  add(promptCase("hp-06/hp-14: target labels: face down said, alike tokens told apart", tg, { ...prompt("chooseBoardTargets", { cancellable: true,
    candidates: ["engine-card-961", "engine-card-962", "engine-card-963", "engine-card-964", "engine-card-965"].map((id) => ({ id, kind: "card" })),
    chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Deal 1 damage" } }),
    sourceAbilityText: "When this creature enters, it deals 1 damage to any target.", sourceCard: { id: "engine-card-966", identity: { name: "Orcish Bowmasters" } } }, [["card|engine-card-961"]]));
  // hp-09: Ephemerate's return order read "Ephemerate: pick #1"
  add(promptCase("hp-09: an order of creatures coming back in words", D2.board, { ...prompt("reorder", { items: [{ id: "r1", card: H(43) }, { id: "r2", card: H(77) }], presentation: { title: "Ephemerate" } }),
    sourceAbilityText: "Exile target creature you control, then return it to the battlefield under its owner's control.", sourceCard: { ...H(35), identity: { name: "Ephemerate" } } }, [["r2"]]));
  // (suite review 2026-11-05) graft's words by the card's type as the board has it, and at a sentence's start too
  const root = myMain(D2.board);
  root.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-967", identity: { name: "Spirit Loop" }, types: ["Enchantment"], ownerId: "player-0", controllerId: "player-0", text: "" });
  add(promptCase("hp-18: an enchantment's question by its board types says this enchantment", root, prompt("chooseBoolean", { confirmLabel: "Yes", denyLabel: "No",
    presentation: { title: "This creature deals 1 damage to you. Move a +1/+1 counter from this creature onto it?" } }, { sourceCard: { id: "engine-card-967", identity: { name: "Spirit Loop" } } }), [["no"]]));
  // (an artifact land is said as a land; a source with no types known keeps Forge's words)
  add(promptCase("hp-18: an artifact land says this land", myMain(D2.board), prompt("chooseBoolean", { confirmLabel: "Yes", denyLabel: "No",
    presentation: { title: "Move a +1/+1 counter from this creature onto it?" } }, { sourceCard: { ...reborn, identity: { name: "Darksteel Citadel" }, types: ["Artifact", "Land"] } }), [["no"]]));
  add(promptCase("hp-18: a source with no types keeps this creature", myMain(D2.board), prompt("chooseBoolean", { confirmLabel: "Yes", denyLabel: "No",
    presentation: { title: "Move a +1/+1 counter from this creature onto it?" } }, { sourceCard: { id: "engine-card-959", identity: { name: "Graft" } } }), [["no"]]));
  // (hp-09: "return" and "battlefield" in two sentences is no coming back)
  add(promptCase("hp-09: return to the hand, then a sentence about the battlefield: goes", D2.board, { ...prompt("reorder", { items: [{ id: "r1", card: H(43) }, { id: "r2", card: H(77) }], presentation: { title: "Order" } }),
    sourceAbilityText: "Return up to two target cards from your graveyard to your hand. Then put a creature card onto the battlefield.", sourceCard: { ...H(35), identity: { name: "Graverobber" } } }, [["__keep"]]));
  // (relations review 2026-11-05: alike things with no power get numbers too; Forge's hidden view of a face-down card
  // reads "Face-down creature", two of them numbered)
  const alike = myMain(D2.board);
  alike.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards.push(
    { id: "engine-card-973", identity: { name: "Treasure", isToken: true }, types: ["Artifact"], ownerId: "player-1", controllerId: "player-1", text: "" },
    { id: "engine-card-974", identity: { name: "Treasure", isToken: true }, types: ["Artifact"], ownerId: "player-1", controllerId: "player-1", text: "" },
    { id: "engine-card-975", identity: { name: "Forest" }, types: ["Land"], ownerId: "player-1", controllerId: "player-1", text: "" },
    { id: "engine-card-976", identity: { name: "Forest" }, types: ["Land"], ownerId: "player-1", controllerId: "player-1", text: "" },
    { visibility: "hidden", id: "engine-card-977" }, { visibility: "hidden", id: "engine-card-978" });
  add(promptCase("labels: alike Treasures, Forests and hidden face-down cards are numbered", alike, { ...prompt("chooseBoardTargets", { cancellable: true,
    candidates: [973, 974, 975, 976, 977, 978].map((n) => ({ id: `engine-card-${n}`, kind: "card" })),
    chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Destroy" } }),
    sourceAbilityText: "Destroy target permanent.", sourceCard: { id: "engine-card-966", identity: { name: "Vindicate" } } }, [["card|engine-card-977"]]));
  // (power 0 is a power: two 0/1 Plants get their numbers; a face-down card you may not see gets no "(face down)", and
  // reads "Face-down creature", not its card id)
  const plants = myMain(D2.board);
  plants.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards.push(
    { id: "engine-card-968", identity: { name: "Plant", isToken: true }, types: ["Creature"], power: 0, toughness: 1, ownerId: "player-1", controllerId: "player-1", text: "" },
    { id: "engine-card-969", identity: { name: "Plant", isToken: true }, types: ["Creature"], power: 0, toughness: 1, ownerId: "player-1", controllerId: "player-1", text: "" },
    { id: "engine-card-970", isFaceDown: true, types: ["Creature"], power: 2, toughness: 2, ownerId: "player-1", controllerId: "player-1", text: "" });
  add(promptCase("hp-14/hp-06: 0-power tokens told apart; an unseen face-down card not called face down", plants, { ...prompt("chooseBoardTargets", { cancellable: true,
    candidates: ["engine-card-968", "engine-card-969", "engine-card-970"].map((id) => ({ id, kind: "card" })),
    chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Deal 1 damage" } }),
    sourceAbilityText: "When this creature enters, it deals 1 damage to any target.", sourceCard: { id: "engine-card-966", identity: { name: "Orcish Bowmasters" } } }, [["card|engine-card-968"]]));
}
// (hp-14: two Coruscation Mages, a 2/2 and a 1/1, one trigger each: ordered by themselves, as Arena does)
{
  const mage = (n, id, p) => ({ ...H(n), id, identity: { ...(H(n).identity || {}), name: "Coruscation Mage" }, name: "Coruscation Mage", power: p, toughness: p });
  const ping = "Whenever you cast a noncreature spell, this creature deals 1 damage to each opponent.";
  add(promptCase("reorder: identical triggers from two copies of one card: not asked", D2.board, { ...prompt("reorder", { items: [
    { id: "r1", card: mage(43, "engine-card-301", 2), oracle: ping }, { id: "r2", card: mage(77, "engine-card-302", 1), oracle: ping }],
    presentation: { title: "Order triggered abilities" } }) }, []));
  // (live: Forge's note names the spell that set it off, and that spell's own "target" is no target of the trigger)
  const noted = `${ping} [Card: Twinflame (168), Activator: tts-White-9gwe, SpellAbility: Choose any number of target creatures you control.]`;
  add(promptCase("reorder: identical triggers, Forge's note naming a targeting spell: not asked", D2.board, { ...prompt("reorder", { items: [
    { id: "r1", card: mage(43, "engine-card-301", 3), oracle: noted }, { id: "r2", card: mage(77, "engine-card-302", 1), oracle: noted }],
    presentation: { title: "Order triggered abilities" } }) }, []));
  const shock = "Whenever you cast a noncreature spell, this creature deals 1 damage to target opponent.";
  add(promptCase("reorder: identical triggers that target: still asked", D2.board, { ...prompt("reorder", { items: [
    { id: "r1", card: mage(43, "engine-card-301", 2), oracle: shock }, { id: "r2", card: mage(77, "engine-card-302", 1), oracle: shock }],
    presentation: { title: "Order triggered abilities" } }) }, [["__keep"]]));
  add(promptCase("reorder: two copies alike, but no trigger order: still asked", D2.board, { ...prompt("reorder", { items: [
    { id: "r1", card: mage(43, "engine-card-301", 2), oracle: ping }, { id: "r2", card: mage(77, "engine-card-302", 1), oracle: ping }],
    presentation: { title: "Put these in order" } }) }, [["__keep"]]));
  add(promptCase("reorder: two cards' triggers with the same words: still asked", D2.board, { ...prompt("reorder", { items: [
    { id: "r1", card: mage(43, "engine-card-301", 2), oracle: ping }, { id: "r2", card: { ...mage(77, "engine-card-302", 1), identity: { name: "Kessig Flamebreather" }, name: "Kessig Flamebreather" }, oracle: ping }],
    presentation: { title: "Order triggered abilities" } }) }, [["__keep"]]));
  add(promptCase("reorder: same card, different triggers: still asked", D2.board, { ...prompt("reorder", { items: [
    { id: "r1", card: mage(43, "engine-card-301", 2), oracle: ping }, { id: "r2", card: mage(77, "engine-card-302", 1), oracle: "When this creature enters, draw a card." }],
    presentation: { title: "Order triggered abilities" } }) }, [["__keep"]]));
}
add(promptCase("reorder words: back on top of the library", D2.board, itemsP("Mirri's Guile", { sourceCard: { ...H(77), identity: { name: "Mirri's Guile" } }, sourceAbilityText: "At the beginning of your upkeep, you may look at the top three cards of your library, then put them back in any order." }), [["r3"], ["r2"]]));
add(promptCase("reorder words: to the bottom", D2.board, itemsP("Abundance", { sourceCard: { ...H(77), identity: { name: "Abundance" }, text: "If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in any order." } }), [["__keep"]]));
add(promptCase("reorder words: a card's own order, not the library", D2.board, itemsP("Pestilence", { sourceCard: H(77), sourceAbilityText: "Put these in any order." }), [["r2"], ["r1"]]));
add(promptCase("reorder words: back on top, keep this order", D2.board, itemsP("Mirri's Guile", { sourceCard: { ...H(77), identity: { name: "Mirri's Guile" } }, sourceAbilityText: "Look at the top three cards of your library, then put them back in any order." }), [["__keep"]]));
add(promptCase("reorder: one item answers itself", D2.board, prompt("reorder", { items: [{ id: "r1", card: H(43) }] }), []));
add(promptCase("blocker order", D2.board, prompt("chooseDamageAssignmentOrder", { attackerId: "engine-card-200", blockerIds: ["engine-card-35", "engine-card-75"] }), [["engine-card-75"]]));
const dmgP = prompt("chooseCombatDamageAssignment", { attackerId: "engine-card-75", blockerIds: ["engine-card-134", "engine-card-35"], defenderId: "player-1", totalDamage: 7, attackerHasDeathtouch: false });
add(promptCase("damage split: auto", D2.board, dmgP, [["auto"]]));
add(promptCase("damage split: by hand", D2.board, dmgP, [["hand"], ["2"], ["1"]]));
add(promptCase("damage split: deathtouch auto", D2.board, { ...dmgP, input: { ...dmgP.input, attackerHasDeathtouch: true } }, [["auto"]]));
add(promptCase("damage: one blocker answers itself", D2.board, prompt("chooseCombatDamageAssignment", { attackerId: "engine-card-75", blockerIds: ["engine-card-134"], totalDamage: 2 }), []));
add(promptCase("chooseCards: library search (cards not on the board)", D2.board, prompt("chooseCards", { min: 0, max: 1, cards: [
  { id: "engine-card-501", identity: { name: "Forest" }, types: ["Land"] }, { id: "engine-card-502", identity: { name: "Llanowar Elves" }, types: ["Creature"], power: 1, toughness: 1 }],
  presentation: { title: "Search your library" } }), [["engine-card-502"]]));
add(promptCase("chooseCards: from a graveyard pile", D2.board, prompt("chooseCards", { min: 1, max: 1, cards: [card(D2.board, "engine-card-196"), card(D2.board, "engine-card-107")], presentation: { title: "Return" } }), [["engine-card-107"]]));
add(promptCase("game over", D2.board, prompt("gameOver", {}), []));
add(promptCase("unknown prompt type", D2.board, prompt("somethingNew", {}), []));
add(promptCase("priority kind passes", D2.board, { promptId: 901, kind: "priority" }, []));
add(promptCase("answer for an old prompt id is ignored", D2.board, prompt("chooseNumber", { min: 0, max: 5 }), [], {}));

// ── table gestures (intents) ──
const mainB = myMain(D2.board);
add(intentCase("play: castable card", mainB, actionP, [{ kind: "play", id: "engine-card-75" }]));
add(intentCase("play: a land in hand", mainB, actionP, [{ kind: "play", id: "engine-card-74" }]));
// a modal double-faced card (cast the spell or play the land): the player is asked; "Back" returns to the question
{
  const mdfcP = prompt("chooseAction", { actions: [
    { id: "a-mdfc-cast", type: "cast", cardId: "engine-card-43", label: "Cast Bala Ged Recovery", mode: { type: "normal" } },
    { id: "a-mdfc-land", type: "playLand", cardId: "engine-card-43", label: "Play Bala Ged Sanctuary", mode: { type: "normal" } },
    { id: "pass", type: "pass", label: "Pass priority" }] });
  add({ name: "play: a two-faced card asks cast or land; Back, then the land", run: async (h) => {
    const seat = game(h, mainB);
    h.B.onPrompt(seat, mdfcP); await h.flush();
    h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-43" }) }); await h.flush();
    const asked = seat.prompt?.ui?.options?.map((o) => o.label);
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["__back"] }) }); await h.flush();
    const back = seat.prompt?.ui?.title;
    h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-43" }) }); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["a-mdfc-land"] }) }); await h.flush();
    return { asked, back, open: seat.prompt ? seat.prompt.type : null };
  } });
}
// a card that can be cast or cycled: the cycling button has no label of its own (it was blank, 2026-10-22 sweep data)
add(intentCase("play: cast or cycle, the ability named by its text", mainB, prompt("chooseAction", { actions: [
  { id: "a-cast", type: "cast", cardId: "engine-card-43", label: "Cast Vraska's Fall", mode: { type: "normal" } },
  { id: "a-cycle", type: "activateAbility", cardId: "engine-card-43", description: "Cycling {2}" }] }), [{ kind: "play", id: "engine-card-43" }]));
add(intentCase("play: nothing offered for it -> refused with why", mainB, actionP, [{ kind: "play", id: "engine-card-77" }]));
// 2026-10-25: a card sacrificed at cleanup when cast at instant speed (Necromancy) asks first outside your main phase
{
  const NECRO = "You may cast Necromancy as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.";
  const necroB = (step, active = "player-0") => {
    const b = clone(D2.board);
    Object.assign(b.gameView, { activePlayerId: active, step, priorityPlayerId: "player-0", stack: [] });
    for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-43") c.text = NECRO;
    return b;
  };
  const necroP = prompt("chooseAction", { actions: [{ id: "a-necro", type: "cast", cardId: "engine-card-43", label: "Cast Necromancy", mode: { type: "normal" } },
    { id: "pass", type: "pass", label: "Pass priority" }] });
  const drag = (h) => h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-43" }) });
  const answer = (h, choice) => h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: [choice] }) });
  const sent = (h) => h.effects.map((e) => e.relay).filter((r) => r && r.type === "BroadcastState" && r.state?.kind === "response").map((r) => r.state.action);
  add({ name: "early sacrifice: cast in your draw step asks; Cast anyway casts", run: async (h) => {
    const seat = game(h, necroB("draw"));
    h.B.onPrompt(seat, necroP); await h.flush();
    drag(h); await h.flush();
    const asked = { title: seat.prompt?.ui?.title, options: seat.prompt?.ui?.options?.map((o) => o.label), sent: sent(h).length };
    answer(h, "a-necro"); await h.flush();
    return { asked, sent: sent(h) };
  } });
  add({ name: "early sacrifice: Wait goes back to your priority, nothing cast", run: async (h) => {
    const seat = game(h, necroB("draw"));
    h.B.onPrompt(seat, necroP); await h.flush();
    drag(h); await h.flush();
    answer(h, "__back"); await h.flush();
    return { back: seat.prompt?.ui?.title, sent: sent(h) };
  } });
  add({ name: "early sacrifice: in your main phase it is cast without asking", run: async (h) => {
    const seat = game(h, necroB("main1"));
    h.B.onPrompt(seat, necroP); await h.flush();
    drag(h); await h.flush();
    return { open: seat.prompt?.ui?.title || null, sent: sent(h) };
  } });
  add({ name: "early sacrifice: on someone else's turn it asks", run: async (h) => {
    const ob = necroB("main1", "player-1");
    ob.gameView.stack = [{ id: "stack-7", controllerId: "player-1", sourceId: "engine-card-500", identity: { name: "Shock" }, text: "Shock deals 2 damage to any target." }];
    const seat = game(h, ob);
    h.B.onPrompt(seat, necroP); await h.flush();
    drag(h); await h.flush();
    return { asked: seat.prompt?.ui?.title || null, sent: sent(h) };
  } });
  add({ name: "early sacrifice: a card without the clause is cast in the draw step without asking", run: async (h) => {
    const b = necroB("draw");
    for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-43") c.text = "Return target creature card from a graveyard to the battlefield under your control.";
    const seat = game(h, b);
    h.B.onPrompt(seat, necroP); await h.flush();
    drag(h); await h.flush();
    return { open: seat.prompt?.ui?.title || null, sent: sent(h) };
  } });
  // (dragged while it isn't your priority: the next priority decides) someone else's main phase, empty stack; your own
  // main phase with your own spell still on the stack: neither is sorcery speed
  const queuedAt = (b) => async (h) => {
    const seat = game(h, b);
    drag(h); await h.flush();
    h.B.onPrompt(seat, necroP); await h.flush();
    return { cast: sent(h).some((x) => x.output?.actionId === "a-necro") };
  };
  add({ name: "early sacrifice: queued, someone else's main phase: not cast", run: queuedAt(necroB("main1", "player-1")) });
  {
    const own = necroB("main1");
    own.gameView.stack = [{ id: "stack-8", controllerId: "player-0", sourceId: "engine-card-501", identity: { name: "Opt" }, text: "Scry 1. Draw a card." }];
    add({ name: "early sacrifice: queued, your main phase with your spell on the stack: not cast", run: queuedAt(own) });
  }
  add({ name: "early sacrifice: queued, your main phase, empty stack: cast", run: queuedAt(necroB("main1")) });
  add({ name: "early sacrifice: dragged without priority, it is not cast by itself at instant speed", run: async (h) => {
    const seat = game(h, necroB("draw"));
    drag(h); await h.flush();
    h.B.onPrompt(seat, necroP); await h.flush();
    return { queued: seat.queuedPlay || null, sent: sent(h), told: h.effects.filter((e) => e.tts && e.tts.t === "chat" && /not cast/.test(e.tts.text || "")).map((e) => e.tts.text) };
  } });
}
// 2026-10-25: a creature on the battlefield only a moment is pointed out in the chat (with what left alongside it)
{
  const moved = (board, id, to) => {
    const b = clone(board);
    let card = null;
    for (const z of b.gameView.zones) { const i = (z.cards || []).findIndex((c) => c.id === id); if (i >= 0) card = z.cards.splice(i, 1)[0]; }
    if (card) { card.types = card.types || ["Creature"]; b.gameView.zones.find((z) => z.zone === to && z.ownerId === "player-0").cards.push(card); }
    return b;
  };
  const chats = (h) => h.effects.filter((e) => e.tts && e.tts.t === "chat" && /only a moment/.test(e.tts.text || "")).map((e) => e.tts.text);
  const run = (wait, step) => async (h) => {
    const seat = game(h, D2.board);
    h.B.sendTable(); await h.flush();
    const on = moved(D2.board, "engine-card-75", "battlefield");
    seat.board = { state: on, fingerprint: null }; h.B.sendTable(); await h.flush();
    if (wait) { setTimeout(() => {}, wait); await h.flush(); }
    const off = moved(on, "engine-card-75", "graveyard");
    off.gameView.step = step;
    seat.board = { state: off, fingerprint: null }; h.B.sendTable(); await h.flush();
    return { chats: chats(h) };
  };
  add({ name: "flash: a creature that enters and dies at once is said in the chat", run: run(0, "cleanup") });
  // 2026-10-26: the shared log names no face-down card (the board comes from one seat's view, which may know it); turning
  // it face up is logged; a cast instant is "casts", an activated or triggered ability "uses ... ability"
  const logLines = (h) => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
  // 2026-10-27 (hp-07): casts and abilities paid from the pool resolved before a board showed them on the stack, and the
  // log said only "enters the battlefield"; a spell with buyback was logged as an ability; a searched card as a draw;
  // a discard to hand size as one line per card
  const handZone = (b) => b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0");
  const libZone = (b) => b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0");
  const boardAs = async (h, seat, b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
  const castThen = async (h, seat) => {
    h.B.onPrompt(seat, myMainAction()); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["a-cast1"] }) }); await h.flush();
  };
  const myMainAction = () => prompt("chooseAction", { actions: acts });
  add({ name: "log: a cast resolved before any board showed it is still logged", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    await castThen(h, seat);
    await boardAs(h, seat, moved(myMain(D2.board), "engine-card-75", "battlefield"));
    return { lines: logLines(h).slice(mark) };
  } });
  add({ name: "log: a cast seen on the stack is logged once", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    await castThen(h, seat);
    const onStack = myMain(D2.board);
    handZone(onStack).cards = handZone(onStack).cards.filter((c) => c.id !== "engine-card-75");
    onStack.gameView.stack = [{ id: "s1", sourceId: "engine-card-75", controllerId: "player-0", identity: { name: "Hurloon Minotaur" }, isPermanentSpell: true }];
    await boardAs(h, seat, onStack);
    await boardAs(h, seat, moved(myMain(D2.board), "engine-card-75", "battlefield"));
    return { lines: logLines(h).slice(mark) };
  } });
  add({ name: "log: a cast cancelled while paying is not logged", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    await castThen(h, seat);
    h.B.onPrompt(seat, { ...prompt("payManaCost", { cardId: "engine-card-75", cardName: "Hurloon Minotaur", manaCost: "{1}{R}{R}", canConfirmFromPool: false, actions: [] }), promptId: 901 }); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 901, choice: ["__cancel"] }) }); await h.flush();
    await boardAs(h, seat, myMain(D2.board));
    return { lines: logLines(h).slice(mark) };
  } });
  // (structural review 2026-10-27: Cancel forgot the log hint but not "the player started this": a later cost of that
  // card was paid from the pool without asking)
  // (structural review 2026-10-27: an instant cast and resolved between two boards is a cast, not also a discard)
  add({ name: "log: a spell cast and resolved into the graveyard between boards is one cast line", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    await castThen(h, seat);
    const b = moved(myMain(D2.board), "engine-card-75", "graveyard");
    for (const z of b.gameView.zones) if (z.ownerId === "player-0" && z.zone !== "library") z.count = z.cards.length;
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  add({ name: "pay: after a cancelled cast, a later cost of that card asks again", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    await castThen(h, seat);
    h.B.onPrompt(seat, { ...prompt("payManaCost", { cardId: "engine-card-75", cardName: "Hurloon Minotaur", manaCost: "{1}{R}{R}", canConfirmFromPool: false, actions: [] }), promptId: 901 }); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 901, choice: ["__cancel"] }) }); await h.flush();
    h.B.onPrompt(seat, { ...prompt("payManaCost", { cardId: "engine-card-75", cardName: "Hurloon Minotaur", manaCost: "{1}{R}{R}", canConfirmFromPool: true, actions: [] }), promptId: 902 }); await h.flush();
    return { open: seat.prompt ? seat.prompt.ui?.title : null, sent: h.effects.filter((e) => e.relay?.state?.kind === "response").map((e) => e.relay.state.action.output) };
  } });
  add({ name: "log: an ability no board showed is logged when priority comes back", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-wilds", type: "activateAbility", cardId: "engine-card-22", description: "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card." }] })); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["a-wilds"] }) }); await h.flush();
    const tapped = clone(myMain(D2.board));
    await boardAs(h, seat, tapped);
    const early = logLines(h).slice(mark);
    h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: acts }), promptId: 905 }); await h.flush();
    await boardAs(h, seat, moved(myMain(D2.board), "engine-card-22", "graveyard"));
    return { early, lines: logLines(h).slice(mark) };
  } });
  add({ name: "log: a spell still listed in the hand (buyback) is a cast", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    const b = myMain(D2.board);
    b.gameView.stack = [{ id: "s1", sourceId: "engine-card-43", controllerId: "player-0", identity: { name: "Constant Mists" }, sourceAbilityText: "Buyback—Sacrifice a land. Prevent all combat damage that would be dealt this turn.", isPermanentSpell: false }];
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  add({ name: "log: a card put into the hand after a look at the library is not a draw", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    h.B.onPrompt(seat, prompt("revealCards", { presentation: { title: "Look at these cards" }, ownerPlayerId: "player-0-view", zone: "library", cards: [H(43)] })); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["ok"] }) }); await h.flush();
    const mark = logLines(h).length;
    const b = myMain(D2.board);
    handZone(b).cards.push({ ...H(43), id: "engine-card-990" });
    handZone(b).count = handZone(b).cards.length;
    libZone(b).count = (libZone(b).count ?? 0) - 1;
    await boardAs(h, seat, b);
    const b2 = clone(b);
    handZone(b2).cards.push({ ...H(43), id: "engine-card-991" });
    handZone(b2).count = handZone(b2).cards.length;
    libZone(b2).count -= 1;
    await boardAs(h, seat, b2);
    return { lines: logLines(h).slice(mark) };
  } });
  add({ name: "log: several cards from the hand to the graveyard are one discard line", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    // (the player chose them in Forge's "Discard" question: an instant among them is discarded too)
    h.B.onPrompt(seat, prompt("chooseCards", { min: 3, max: 3, cards: [H(43), H(35), H(74)], presentation: { title: "Discard" } })); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["engine-card-43", "engine-card-35", "engine-card-74"] }) }); await h.flush();
    const mark = logLines(h).length;
    let b = myMain(D2.board);
    for (const id of ["engine-card-43", "engine-card-35", "engine-card-74"]) b = moved(b, id, "graveyard");
    for (const z of b.gameView.zones) if (z.ownerId === "player-0" && z.zone !== "library") z.count = z.cards.length;
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // (hp-05: a cleanup discard seen with the next turn is said before that turn's line)
  add({ name: "log: a cleanup discard seen with the next turn comes before its line", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    h.B.onPrompt(seat, prompt("chooseCards", { min: 2, max: 2, cards: [H(43), H(35)], presentation: { title: "Discard" } })); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["engine-card-43", "engine-card-35"] }) }); await h.flush();
    const mark = logLines(h).length;
    let b = myMain(D2.board);
    for (const id of ["engine-card-43", "engine-card-35"]) b = moved(b, id, "graveyard");
    for (const z of b.gameView.zones) if (z.ownerId === "player-0" && z.zone !== "library") z.count = z.cards.length;
    Object.assign(b.gameView, { turn: (b.gameView.turn || 1) + 1, activePlayerId: "player-1", step: "upkeep" });
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // (the new turn's player's own discard stays after its line)
  add({ name: "log: a discard by the new turn's player stays after its line", run: async (h) => {
    const before = myMain(D2.board); before.gameView.activePlayerId = "player-1";
    const seat = game(h, before);
    h.B.sendTable(); await h.flush();
    h.B.onPrompt(seat, prompt("chooseCards", { min: 2, max: 2, cards: [H(43), H(35)], presentation: { title: "Discard" } })); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["engine-card-43", "engine-card-35"] }) }); await h.flush();
    const mark = logLines(h).length;
    let b = clone(before);
    for (const id of ["engine-card-43", "engine-card-35"]) b = moved(b, id, "graveyard");
    for (const z of b.gameView.zones) if (z.ownerId === "player-0" && z.zone !== "library") z.count = z.cards.length;
    Object.assign(b.gameView, { turn: (b.gameView.turn || 1) + 1, activePlayerId: "player-0", step: "upkeep" });
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // stage 3 review 2026-10-27: an instant from a hand into a graveyard with no discard asked was most often cast and
  // resolved between boards (an AI's Lightning Bolt read "AI 1 discards"): the neutral line
  add({ name: "log: an instant into the graveyard with no discard asked is not called a discard", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    let b = myMain(D2.board);
    for (const id of ["engine-card-43", "engine-card-35"]) b = moved(b, id, "graveyard");
    for (const z of b.gameView.zones) if (z.ownerId === "player-0" && z.zone !== "library") z.count = z.cards.length;
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  add({ name: "log: a face-down card is not named; turning it face up is logged", run: async (h) => {
    const seat = game(h, D2.board);
    h.B.sendTable(); await h.flush();
    const down = moved(D2.board, "engine-card-75", "battlefield");
    for (const z of down.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-75") c.isFaceDown = true;
    seat.board = { state: down, fingerprint: null }; h.B.sendTable(); await h.flush();
    const up = clone(down);
    for (const z of up.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-75") c.isFaceDown = false;
    seat.board = { state: up, fingerprint: null }; h.B.sendTable(); await h.flush();
    return { lines: logLines(h) };
  } });
  // 2026-10-26: a deck's own picture link that the image host no longer has (404) is passed over for the bridge's lookup
  add({ name: "deck pictures: a dead link is not used, a live one is", run: async (h) => {
    const live = "https://img.klrmngr.com/display/front/a/b/abcdef01-live.webp";
    const dead = "https://img.klrmngr.com/display/front/d/e/dead0001-gone.webp";
    h.B.onTTS({ t: "decks", json: JSON.stringify({ seats: { Blue: { deckName: "Pics", commander: [{ n: "Neheb, the Eternal", f: live }],
      library: [{ n: "Hurloon Minotaur", f: dead }, { n: "Vraska's Fall", f: live }, { n: "Farseek", f: "https://steamusercontent-a.akamaihd.net/ugc/1647720103762682461/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/" }] } } }) });
    await h.flush();
    return { minotaur: h.B.imgOf({ identity: { name: "Hurloon Minotaur" } }) || null, fall: h.B.imgOf({ identity: { name: "Vraska's Fall" } }) || null,
      backAsFace: h.B.imgOf({ identity: { name: "Farseek" } }) || null };
  } });
  // 2026-10-26: Necromancy's return said only "enters the battlefield"; where it came back from is named
  add({ name: "log: a card returned from a graveyard or from exile says so", run: async (h) => {
    const seat = game(h, D2.board);
    h.B.sendTable(); await h.flush();
    const lines0 = logLines(h).length;
    // (196 is in the AI's graveyard: brought back under Blue)
    const back = moved(D2.board, "engine-card-196", "battlefield");
    for (const z of back.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-196") c.controllerId = "player-0";
    seat.board = { state: back, fingerprint: null }; h.B.sendTable(); await h.flush();
    const gone = moved(back, "engine-card-22", "exile");
    seat.board = { state: gone, fingerprint: null }; h.B.sendTable(); await h.flush();
    const flick = moved(gone, "engine-card-22", "battlefield");
    seat.board = { state: flick, fingerprint: null }; h.B.sendTable(); await h.flush();
    return { lines: logLines(h).slice(lines0) };
  } });
  // 2026-10-26: day and night are logged and sent with the board (nothing showed that Brutal Cathar made it day)
  add({ name: "day and night: logged when it changes, sent with the board", run: async (h) => {
    const seat = game(h, D2.board);
    const days = [];
    for (const d of ["neither", "day", "day", "night", undefined]) {
      const b = clone(D2.board);
      if (d !== undefined) b.gameView.dayTime = d;
      seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush();
      const last = h.effects.filter((e) => e.tts && e.tts.t === "table").pop();
      days.push(last ? (last.tts.day ?? "none") : "no table");
    }
    return { days, lines: logLines(h) };
  } });
  add({ name: "log: an instant is cast, an ability is used", run: async (h) => {
    const seat = game(h, D2.board);
    h.B.sendTable(); await h.flush();
    const b = clone(D2.board);
    const bfCard = b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0" && (z.cards || []).length).cards[0].id;
    b.gameView.stack = [
      { id: "stack-1", sourceId: "engine-card-9999", controllerId: "player-0", identity: { name: "Lightning Bolt" }, sourceAbilityText: "Lightning Bolt deals 3 damage to any target.", isPermanentSpell: false },
      { id: "stack-2", sourceId: bfCard, controllerId: "player-0", identity: { name: "Gilded Goose" }, sourceAbilityText: "{1}{G}, {T}: Create a Food token.", isPermanentSpell: false },
      { id: "stack-3", sourceId: "engine-card-9998", controllerId: "player-0", identity: { name: "Tenacious Underdog" }, sourceAbilityText: "When Tenacious Underdog dies, you draw a card.", isPermanentSpell: false }];
    seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush();
    return { lines: logLines(h) };
  } });
  // (closes a mutation escape: a creature spell whose text starts with a trigger is still a cast)
  add({ name: "log: a creature spell whose text starts with When is cast", run: async (h) => {
    const seat = game(h, D2.board);
    h.B.sendTable(); await h.flush();
    const b = clone(D2.board);
    b.gameView.stack = [{ id: "stack-1", sourceId: "engine-card-9997", controllerId: "player-0", identity: { name: "Mulldrifter" },
      sourceAbilityText: "When Mulldrifter enters, draw two cards.", isPermanentSpell: true }];
    seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush();
    return { lines: logLines(h) };
  } });
  add({ name: "flash: a creature that stayed a while is not", run: run(5000, "main2") });
}
add(intentCase("play: no priority prompt", D2.board, null, [{ kind: "play", id: "engine-card-75" }]));
add(intentCase("tapmana: one colour", mainB, actionP, [{ kind: "tapmana", id: "engine-card-94" }]));
// 2026-10-24: a spell dragged while it isn't your priority is cast at your next priority (Galadriel's Dismissal while
// blocking); a land isn't kept
add({ name: "queued play: dragged without priority, cast at the next priority", run: async (h) => {
  const seat = game(h, D2.board);
  h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-75" }) }); await h.flush();
  h.B.onPrompt(seat, prompt("chooseAction", { actions: acts })); await h.flush();
  return null;
} });
add({ name: "queued play: a land is refused, not kept", run: async (h) => {
  const b = clone(D2.board);
  for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-74") c.types = ["Land"];
  const seat = game(h, b);
  h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-74" }) }); await h.flush();
  return { queued: seat.queuedPlay || null };
} });
// 2026-10-24: someone else attacks and you hold an instant: you are asked in the declare attackers / blockers steps
{
  const attacked = (step) => { const b = clone(D2.board); b.gameView.activePlayerId = "player-1"; b.gameView.priorityPlayerId = "player-0"; b.gameView.step = step; b.gameView.stack = [];
    const bf = b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1" && (z.cards || []).length);
    if (bf) bf.cards[0].isAttacking = true; return b; };
  const instant = prompt("chooseAction", { actions: [{ id: "a-inst", type: "cast", cardId: "engine-card-43", label: "Cast Vraska's Fall", mode: { type: "normal" } }] });
  add(promptCase("combat stop: attacked, holding an instant, after attackers are declared", attacked("combatDeclareAttackers"), instant, []));
  add(promptCase("combat stop: attacked, holding an instant, after blockers", attacked("combatDeclareBlockers"), instant, []));
  add(promptCase("combat stop: not in the damage step", attacked("combatDamage"), instant, []));
}
add(intentCase("tapmana: two colours asks", mainB, actionP, [{ kind: "tapmana", id: "engine-card-35" }]));
add(intentCase("tapmana: not a source", mainB, actionP, [{ kind: "tapmana", id: "engine-card-75" }]));
// two buttons that would both say {G} (a pain land's own ability and a plain one another card grants) say how they differ
add(intentCase("tapmana: the same mana two ways, told apart", mainB, prompt("chooseAction", { actions: [...acts,
  { id: "tap:engine-card-64:0", type: "activateAbility", cardId: "engine-card-64", isManaAbility: true, description: "{T}: Add {C}.", producedMana: [{ amount: 1, color: "C" }] },
  { id: "tap:engine-card-64:1:G", type: "activateAbility", cardId: "engine-card-64", isManaAbility: true, description: "{T}: Add {B} or {G}. Llanowar Wastes deals 1 damage to you.", producedMana: [{ amount: 1, color: "G" }] },
  { id: "tap:engine-card-64:2", type: "activateAbility", cardId: "engine-card-64", isManaAbility: true, description: "{T}: Add {G}.", producedMana: [{ amount: 1, color: "G" }] }] }), [{ kind: "tapmana", id: "engine-card-64" }]));
// turning a card that has no mana ability uses its {T} ability (Hermit Druid, a fetch land); two of them ask which
const tapAbilP = prompt("chooseAction", { actions: [...acts,
  { id: "ab-druid", type: "activateAbility", cardId: "engine-card-22", description: "{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card." },
  { id: "ab-druidcast", type: "cast", cardId: "engine-card-22", label: "Cast Evolving Wilds", description: "{T}: (a cast is never a tap ability)" },
  { id: "ab-fetch1", type: "activateAbility", cardId: "engine-card-64", description: "{T}, Pay 1 life, Sacrifice: Search for a Swamp or Forest card." },
  { id: "ab-fetch2", type: "activateAbility", cardId: "engine-card-64", label: "Draw", description: "{1}: Scry 1." },
  { id: "ab-fetch3", type: "activateAbility", cardId: "engine-card-64", cost: "{T}", description: "Exile target card from a graveyard." }] });
add(intentCase("tapmana: a {T} ability without mana", mainB, tapAbilP, [{ kind: "tapmana", id: "engine-card-22" }]));
add(intentCase("tapmana: two {T} abilities ask which", mainB, tapAbilP, [{ kind: "tapmana", id: "engine-card-64" }]));
add(intentCase("tapmana: no {T} ability refused", mainB, tapAbilP, [{ kind: "tapmana", id: "engine-card-200" }]));
add(intentCase("sacrifice: nothing asks", mainB, actionP, [{ kind: "sacrifice", id: "engine-card-22" }]));
const sacP = prompt("chooseCards", { min: 1, max: 1, cards: [card(D2.board, "engine-card-22"), card(D2.board, "engine-card-64")], presentation: { title: "Sacrifice a permanent" } });
add(intentCase("sacrifice: answers a sacrifice question", mainB, sacP, [{ kind: "sacrifice", id: "engine-card-64" }]));
const discardP = prompt("chooseCards", { min: 2, max: 2, cards: [H(43), H(35), H(75)], presentation: { title: "Discard (2)" } });
add(intentCase("discard: two drags complete it", D2.board, discardP, [{ kind: "discard", id: "engine-card-43" }, { kind: "discard", id: "engine-card-43" }, { kind: "discard", id: "engine-card-75" }]));
add(intentCase("discard: card not offered", D2.board, discardP, [{ kind: "discard", id: "engine-card-77" }]));
add(intentCase("bottom: mulligan put-back by drag", D2.board, prompt("mulliganPutBack", { count: 1, handCardIds: ["engine-card-43", "engine-card-35"] }), [{ kind: "bottom", id: "engine-card-35" }]));
add(intentCase("unknown gesture refused", D2.board, actionP, [{ kind: "juggle", id: "engine-card-35" }]));

// Sylvan Library as Forge runs it (raw capture 2026-10-22): choose 2 drawn cards, order them (skipped: it changes
// nothing), then per card "Pay 4 {LIFE}?" (Pay / Decline, no card named) and after a No "Select a card from your
// hand" (which chosen card goes back). The second No is given by dragging a chosen card onto the library, which also
// answers its follow-up. Then a wrong drag, and Mystic Remora's "pay or sacrifice".
add({ name: "Sylvan Library: pay 4 life or put a chosen card back", run: async (h) => {
  const seat = game(h, myMain(D2.board));
  const card = (id) => ({ ...D2.board.gameView.zones.flatMap((z) => z.cards).find((c) => c.id === id), zone: "hand" });
  const src = { sourceCard: { id: "engine-card-501", identity: { name: "Sylvan Library" } } };
  const answer = async (a) => { h.effects.push({ answer: a }); h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: a }) }); await h.flush(); };
  const drag = async (m) => { h.effects.push({ intent: m }); h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", ...m }) }); await h.flush(); };
  const ask = async (type, input) => { h.B.onPrompt(seat, prompt(type, input, src)); await h.flush(); };
  await ask("chooseCards", { cards: ["engine-card-43", "engine-card-35", "engine-card-75"].map(card), min: 2, max: 2, presentation: { title: "Sylvan Library", description: "Choose a card " } });
  await answer(["engine-card-43", "engine-card-75"]);
  await ask("reorder", { items: [{ id: "engine-card-43", card: card("engine-card-43") }, { id: "engine-card-75", card: card("engine-card-75") }],
    presentation: { title: "Sylvan Library", description: "Arrange these cards in order." } });
  const pay = { confirmLabel: "Pay", denyLabel: "Decline",
    presentation: { title: "Pay 4 {LIFE}?", text: `otherwise: "${seat.username} puts a Card.ChosenCard from their hand on top of their library."` } };
  const which = { cards: ["engine-card-43", "engine-card-75"].map(card), min: 1, max: 1, presentation: { title: "Sylvan Library", description: "Select a card from your hand" } };
  await ask("chooseBoolean", pay); await answer(["no"]);
  await ask("chooseCards", which); await answer(["engine-card-75"]);
  await ask("chooseBoolean", pay);
  await drag({ kind: "sacrifice", id: "engine-card-43" }); // a chosen card, but to the graveyard: not an answer
  await drag({ kind: "bottom", id: "engine-card-35" }); // not one of the chosen cards: says which
  await drag({ kind: "bottom", id: "engine-card-43" }); // a chosen card onto the library: No, and it is the one that goes back
  await ask("chooseCards", which);
  // after a No, a choice among other cards is a new question, not "which card goes back"
  await ask("chooseBoolean", pay); await answer(["no"]);
  // a new trigger's fresh choice isn't taken for a follow-up
  await ask("chooseCards", { cards: ["engine-card-35", "engine-card-77"].map(card), min: 1, max: 1, presentation: { title: "Sylvan Library", description: "Choose a card " } });
  // the last card: Forge skips the "which card?" (only one can go back); next turn the trigger draws that card again,
  // and its "choose 2" is a new question (answering it as the follow-up, with one card, aborted a game)
  await ask("chooseCards", { cards: ["engine-card-43", "engine-card-75"].map(card), min: 2, max: 2, presentation: { title: "Sylvan Library", description: "Choose a card " } });
  await answer(["engine-card-43", "engine-card-75"]);
  await ask("chooseBoolean", pay); await answer(["no"]);
  await ask("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Use triggered ability of Sylvan Library?" } }); await answer(["yes"]);
  await ask("chooseCards", { cards: ["engine-card-43", "engine-card-35", "engine-card-75"].map(card), min: 2, max: 2, presentation: { title: "Sylvan Library", description: "Choose a card " } });
  // each guard on its own: right after a No, a two-card choice is new; after the next trigger, a one-card choice is too
  await answer(["engine-card-43", "engine-card-75"]);
  await ask("chooseBoolean", pay); await answer(["no"]);
  await ask("chooseCards", { cards: ["engine-card-43", "engine-card-75"].map(card), min: 2, max: 2, presentation: { title: "Sylvan Library", description: "Choose a card " } });
  await answer(["engine-card-43", "engine-card-75"]);
  await ask("chooseBoolean", pay); await answer(["no"]);
  await ask("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Use triggered ability of Sylvan Library?" } }); await answer(["yes"]);
  await ask("chooseCards", { cards: ["engine-card-43", "engine-card-75"].map(card), min: 1, max: 1, presentation: { title: "Sylvan Library", description: "Choose a card " } });
  h.B.onPrompt(seat, prompt("chooseBoolean", { confirmLabel: "Pay", denyLabel: "Decline",
    presentation: { title: "Pay {3}?", text: 'otherwise: "Sacrifices Mystic Remora (6)"' } }, { sourceCard: { id: "engine-card-502", identity: { name: "Mystic Remora" } } })); await h.flush();
  await drag({ kind: "sacrifice", id: "engine-card-502" }); // Mystic Remora dragged to the graveyard: sacrificed (No)
  return null;
} });
// 2026-10-27: "you may pay {1}{G}. If you do, <effect>": the effect is Yes's, the card's "If you didn't" sentence No's
add(promptCase("unless: a pay-to-do question labels Yes with the effect, No with the card's other branch", myMain(D2.board), prompt("chooseBoolean", { confirmLabel: "Pay", denyLabel: "Decline",
  presentation: { title: "Pay {1}{G}?", text: `otherwise: "Create a token that's a copy of Alesha, Who Laughs at Fate."` } },
  { sourceCard: { id: "engine-card-22", identity: { name: "Springheart Nantuko" }, text: "Landfall — Whenever a land you control enters, you may pay {1}{G} if Springheart Nantuko is attached to a creature you control. If you do, create a token that's a copy of that creature. If you didn't create a token this way, create a 1/1 green Insect creature token." } }), [["no"]]));
// the legend rule: which one stays, the token copy marked
{
  const leg = (n, extra) => ({ ...H(75), id: `engine-card-${n}`, zone: "battlefield", supertypes: ["Legendary"], ...extra });
  add(promptCase("legend rule: which one stays, the copy marked", myMain(D2.board), prompt("chooseCards", { min: 1, max: 1,
    cards: [leg(75), leg(175, { identity: { ...H(75).identity, isToken: true }, isCopy: true })], presentation: { title: "Choose a card" } }), [["engine-card-75"]]));
  // (altitude review 2026-10-27: Forge's own words are the description; the legend rule says so there)
  add(promptCase("legend rule: told by Forge's description", myMain(D2.board), prompt("chooseCards", { min: 1, max: 1,
    cards: [{ ...H(75), zone: "battlefield" }, { ...H(75), id: "engine-card-176", zone: "battlefield" }],
    presentation: { title: "Choose", description: "You have multiple legendary permanents named \"Hurloon Minotaur\" in play.\n\nChoose the one to stay on battlefield (the rest will be moved to graveyard)" } }), [["engine-card-75"]]));
  add(promptCase("choose a card: Forge's description is said when it says more", myMain(D2.board), prompt("chooseCards", { min: 1, max: 1,
    cards: [H(43), H(35)], presentation: { title: "Choose", description: "Choose a creature card to return to your hand" } }), [["engine-card-43"]]));
  add(promptCase("choose a card: a bare 'Choose a card' description is not repeated", myMain(D2.board), prompt("chooseCards", { min: 1, max: 1,
    cards: [H(43), H(35)], presentation: { title: "Choose", description: "Choose a card" } }), [["engine-card-43"]]));
  add(promptCase("legend rule: not for two different cards", myMain(D2.board), prompt("chooseCards", { min: 1, max: 1,
    cards: [leg(75), { ...H(43), zone: "battlefield", supertypes: ["Legendary"] }], presentation: { title: "Choose a card" } }), [["engine-card-43"]]));
  // (mechanic run rebuilt 2026-11-05: Mairsil cast from the command zone beside the one from the hand read "Mairsil 4/4 /
  // Mairsil 4/4": the commander, and the one that just entered, are said; the one already there is not)
  add({ name: "legend rule: the commander and the one just entered marked", run: async (h) => {
    const start = myMain(D2.board);
    const b = clone(start);
    const field = b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
    field.cards.push(leg(177));
    let cmd = b.gameView.zones.find((z) => z.zone === "command" && z.ownerId === "player-0");
    if (!cmd) { cmd = { zone: "command", ownerId: "player-0", cards: [] }; b.gameView.zones.push(cmd); }
    cmd.cards.push({ ...leg(178), zone: "command" });
    const seat = game(h, b);
    seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush();
    const p = prompt("chooseCards", { min: 1, max: 1, cards: [leg(177), leg(178)], presentation: { title: "Choose a card" } });
    h.B.onPrompt(seat, p); await h.flush();
    return seat.prompt ? seat.prompt.ui.options.map((o) => o.label) : null;
  } });
}
// a Phyrexian cost: "Pay 2 life" by name, before the taps
add(promptCase("pay: a Phyrexian cost offers Pay 2 life first", myMain(D2.board), prompt("payManaCost", { cardId: "engine-card-75", cardName: "Skrelv, Defector Mite", manaCost: "{W/P}", canConfirmFromPool: false,
  actions: [{ id: "tap:engine-card-65:0", type: "activateManaAbility", cardId: "engine-card-65", description: "Swamp" }, { id: "pay-life", type: "payLife", amount: 2 }] }), [["pay-life"]], { seat: { autoPayFailedFor: "engine-card-75" } }));
add({ name: "otherwiseText: the instruction, in the player's words", run: async (h) => {
  const seat = game(h, myMain(D2.board));
  const o = (t, card) => h.B.otherwiseText(seat, { presentation: { text: t } }, card);
  return [o('otherwise: "Sacrifices Mystic Remora (6)"'), o(`otherwise: "${seat.username} puts a Card.ChosenCard from their hand on top of their library."`, "Forest"),
    o(`otherwise: "${seat.username} puts a Card.ChosenCard on top of their library."`), o('otherwise: "Discards a card"'), o('otherwise: "Passes the turn"'),
    o("no otherwise here"), o(undefined)];
} });

// ── pure helpers over a grid of inputs ──
add({ name: "helpers", run: async (h) => {
  const B = h.B;
  game(h, D2.board);
  const out = {};
  const urls = [null, undefined, "", "https://steamusercontent-a.akamaihd.net/ugc/1647720103762682461/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/",
    "https://img.klrmngr.com/display/front/1/b/1b4bab87-4000-461d-8b58-d34928fee305.webp", "https://img.klrmngr.com/display/back/1/b/1b4bab87-4000-461d-8b58-d34928fee305.webp",
    "https://cards.scryfall.io/normal/front/1/b/1b4bab87-4000-461d-8b58-d34928fee305.jpg?1562", "https://cards.scryfall.io/large/back/a/b/ab12.png", "http://example.com/x.png"];
  out.shortUrl = urls.map((u) => [u, B.shortUrl(u)]);
  out.ttsImage = urls.map((u) => [u, B.ttsImage(u)]);
  out.payManaText = [{}, { producedMana: [{ amount: 1, color: "R" }] }, { producedMana: [{ amount: 2, color: "G" }, { amount: 1, color: "C" }] }, { id: "tap:x:0:W" }, { id: "tap:x:0" }, { id: "tap:x:U" }].map((a) => [a, B.payManaText(a)]);
  out.summarizeLands = B.summarizeLands([{ identity: { name: "Forest" }, tapped: true }, { identity: { name: "Forest" } }, { identity: { name: "Island" }, tapped: true }, {}]);
  const cl = (c) => { try { return B.cardLabel(c); } catch (e) { return `THREW ${e.constructor.name}`; } };
  out.cardLabel = [null, undefined, {}, { visibility: "hidden", identity: { name: "X" } }, H(75), { identity: { name: "A" }, power: 0, toughness: 0 },
    { identity: { name: "B" }, power: 2, toughness: 2, counters: { "+1/+1": 2, loyalty: 0 } },
    // (hp-05: Forge's counter keys in words, one and several)
    { identity: { name: "C" }, power: 6, toughness: 6, counters: { P1P1: 1, M1M1: 2 } }, { identity: { name: "D" }, counters: { Burden: 3, LOYALTY: 1 } }].map((c) => [c && c.identity ? c.identity.name : String(c), cl(c)]);
  out.displayText = [null, "", "tts-Blue-ab12 casts Shock targeting Self-hosted-node-77-bot", "TTS-BLUE-AB12 and tts-blue-ab12 again", "player-1 attacks", "plain"].map((t) => [t, B.displayText(t)]);
  out.nameOf = ["player-0", "player-1", "player-9", undefined].map((s) => [s, B.nameOf(s)]);
  const seat = h.B._getGame().seats.get("Blue");
  const why = (mod, id) => { const s = clone(D2.board); mod(s.gameView); seat.board = { state: s }; return B.whyNot(seat, id); };
  // (the land cases with the Mountain in the hand: in the fixture it is on the battlefield, which is no land play, hp-09)
  const toHand = (g, id) => { const bf = g.zones.find((z) => z.zone === "battlefield" && z.cards.some((c) => c.id === id)); const c = bf.cards.find((x) => x.id === id);
    bf.cards = bf.cards.filter((x) => x.id !== id); g.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards.push(c); };
  out.whyNot = [
    ["not my priority", why((g) => { g.priorityPlayerId = "player-1"; }, "engine-card-75")],
    ["land, not my turn", why((g) => { toHand(g, "engine-card-64"); g.priorityPlayerId = "player-0"; g.activePlayerId = "player-1"; }, "engine-card-64")],
    ["land, already played", why((g) => { toHand(g, "engine-card-64"); g.priorityPlayerId = "player-0"; g.activePlayerId = "player-0"; g.players[0].landsPlayedThisTurn = 1; }, "engine-card-64")],
    ["land, wrong step", why((g) => { toHand(g, "engine-card-64"); g.priorityPlayerId = "player-0"; g.activePlayerId = "player-0"; g.step = "upkeep"; }, "engine-card-64")],
    ["sorcery speed outside main", why((g) => { g.priorityPlayerId = "player-0"; g.activePlayerId = "player-0"; g.step = "upkeep"; }, "engine-card-75")],
    ["in main, can't cast", why((g) => { g.priorityPlayerId = "player-0"; g.activePlayerId = "player-0"; g.step = "main1"; g.stack = []; }, "engine-card-75")],
    ["unknown card", why((g) => { g.priorityPlayerId = "player-0"; }, "engine-card-999")],
    ["a land on the battlefield", why((g) => { g.priorityPlayerId = "player-0"; g.activePlayerId = "player-0"; g.step = "main1"; g.stack = []; }, "engine-card-64")],
    ["a permanent with no mana ability", why((g) => { g.priorityPlayerId = "player-0"; g.activePlayerId = "player-0"; g.step = "main1"; g.stack = [];
      g.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ ...H(75), id: "engine-card-998", text: "{2}: Regenerate this creature." }); }, "engine-card-998")],
  ];
  const steps = B.orderSteps("T", "hint", [{ id: "a", label: "A" }], (ids) => ids);
  out.orderStepsOne = steps;
  out.damageStepsAuto = B.damageSteps(5, [{ id: "x", label: "X", lethal: 3 }], (o) => o);
  out.prepareUi = B.prepareUi({ title: "tts-Blue-ab12 asks", options: [{ id: 1, label: "player-1" }] });
  return out;
} });

// ── the board message the table draws from ──
for (const [dn, d] of [["dump", D1], ["dump2", D2], ["noset", D3]]) {
  add({ name: `table: ${dn} first board, then the same board again`, run: async (h) => {
    game(h, d.board);
    h.B.sendTable(); await h.flush();
    h.effects.push({ mark: "second send, nothing changed" });
    h.B.sendTable(); await h.flush();
    return null;
  } });
}
// (2026-10-23, our Forge build) exile links and playable cards: a card exiled with a permanent until it leaves, one
// exiled for good with another, and a card Blue may play from exile (a playable row for Blue only, from Blue's view);
// then nothing playable any more: the list goes, and when the same card is playable again it is sent in full again
add({ name: "table: linked and playable exile", run: async (h) => {
  const seat = game(h, D2.board);
  const s = clone(D2.board);
  const host = s.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards[0];
  const ex = s.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-1") || (() => { const z = { zone: "exile", ownerId: "player-1", cards: [], count: 0 }; s.gameView.zones.push(z); return z; })();
  const hand = s.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0");
  const [a, b, p] = hand.cards.splice(0, 3);
  ex.cards.push({ ...a, ownerId: "player-1", exiledWith: host.id, returnsWhenHostLeaves: true },
    { ...b, ownerId: "player-1", exiledWith: host.id }, { ...p, ownerId: "player-1", mayPlay: true, isForetold: true });
  ex.count = ex.cards.length;
  for (const z of s.gameView.zones) if (z.zone === "command") for (const card of z.cards) card.mayPlay = true; // (a commander stays in its own spot)
  seat.board = { state: s, fingerprint: null };
  h.B.sendTable(); await h.flush();
  const none = clone(s);
  for (const card of none.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-1").cards) card.mayPlay = false;
  seat.board = { state: none, fingerprint: null };
  h.effects.push({ mark: "nothing playable any more" });
  h.B.sendTable(); await h.flush();
  seat.board = { state: s, fingerprint: null };
  h.effects.push({ mark: "playable again" });
  h.B.sendTable(); await h.flush();
  return null;
} });
// (hp-13 gap: the library's top card Blue may play (The Reality Chip), visible in Blue's view, is in Blue's playable row;
// a library card not marked playable isn't)
add({ name: "table: the library's playable top card", run: async (h) => {
  const seat = game(h, D2.board);
  const s = clone(D2.board);
  const lib = s.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0") || (() => { const z = { zone: "library", ownerId: "player-0", cards: [], count: 30 }; s.gameView.zones.push(z); return z; })();
  lib.cards = [{ id: "engine-card-921", identity: { name: "Enlightened Tutor" }, types: ["Instant"], ownerId: "player-0", controllerId: "player-0", text: "", mayPlay: true, visibility: "visible" },
    { id: "engine-card-922", identity: { name: "Plains" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "", visibility: "visible" }];
  seat.board = { state: s, fingerprint: null };
  h.B.sendTable(); await h.flush();
  // (the rows as the table got them: Blue's "playable" holds engine-card-921 only)
  const sent = h.effects.filter((e) => e.tts && e.tts.t === "table" && JSON.stringify(e.tts).includes('"playable"')).map((e) => e.tts.players.map((p) => [p.color, (p.playable || []).map((c) => c.id)]));
  return sent;
} });
// ── M7 manual fix by vote ──
const FIX_OPS = [
  { op: "move", card: "engine-card-196", zone: "battlefield" },
  { op: "move", card: "engine-card-43", zone: "library", position: "bottom" },
  { op: "tap", card: "engine-card-22", tapped: false },
  { op: "counters", card: "engine-card-64", kind: "P1P1", n: 2 },
  { op: "counters", card: "engine-card-65", kind: "LOYALTY", n: 1 },
  { op: "attach", card: "engine-card-36", to: "engine-card-64" },
  { op: "attach", card: "engine-card-36" },
  { op: "control", card: "engine-card-192", player: "Blue" },
  { op: "faceDown", card: "engine-card-126", value: true },
  { op: "life", player: "White", n: 31 },
  { op: "poison", player: "Blue", n: 4 },
  { op: "commanderDamage", player: "White", from: "engine-card-199", n: 14 },
  { op: "commanderDamage", player: "Blue", from: "White", n: 7 },
  { op: "createToken", script: "treasure", player: "Blue" }, { op: "createToken", script: "c_a_clue_draw", player: "Blue" },
  { op: "createToken", script: "1/1 green saproling", player: "White", tapped: true },
  { op: "mana", player: "Blue", mana: "W W U B R G C C" },
];
const fixMsg = (color, action, extra = {}) => ({ t: "fix", json: JSON.stringify({ color, action, ...extra }) });
const withFix = (fix, step = "main1") => {
  const b = myMain(D2.board); b.gameView.step = step; if (fix) b.gameView.stateFix = fix;
  for (const z of b.gameView.zones) for (const card of z.cards || []) if (card.id === "engine-card-36") card.subtypes = ["Equipment"];
  return b;
};
// vs AI: nobody to ask; the next empty-stack priority question is held, the changes go to the engine as one directive,
// the engine's answer (stateFix) ends it; a refusal goes back to editing; a question with a spell on the stack isn't held
// 2026-10-26: "Sacrifice Food Token?" right after using the Food's own ability is answered yes; without that it is asked
{
  const foodP = prompt("chooseAction", { actions: [{ id: "a-food", type: "activateAbility", cardId: "engine-card-22", description: "{2}, {T}, Sacrifice this token: You gain 3 life." }, { id: "pass", type: "pass" }] });
  const sacQ = () => ({ ...prompt("chooseBoolean", { presentation: { title: "Sacrifice Food Token?" } }), promptId: 901, sourceCard: { id: "engine-card-22", identity: { name: "Food Token" } } });
  const sent = (h) => h.effects.map((e) => e.relay).filter((r) => r && r.state?.kind === "response").map((r) => r.state.action);
  add({ name: "sacrifice confirm: after using that card's ability, answered yes", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, foodP); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["a-food"] }) }); await h.flush();
    h.B.onPrompt(seat, sacQ()); await h.flush();
    return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
  } });
  add({ name: "sacrifice confirm: not after using it (auto-pay's pick), asked", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, sacQ()); await h.flush();
    return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
  } });
  // 2026-10-27: Forge asked Dauthi Voidwalker's "Sacrifice Dauthi Voidwalker?" with no source card: matched by name
  const wildsP = prompt("chooseAction", { actions: [{ id: "a-wilds", type: "activateAbility", cardId: "engine-card-22", description: "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card." }, { id: "pass", type: "pass" }] });
  for (const [label, title] of [["its own name, no source card: answered yes", "Sacrifice Evolving Wilds?"], ["another card's name, no source card: asked", "Sacrifice Mountain?"]]) {
    add({ name: `sacrifice confirm: ${label}`, run: async (h) => {
      const seat = game(h, myMain(D2.board));
      h.B.onPrompt(seat, wildsP); await h.flush();
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["a-wilds"] }) }); await h.flush();
      h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { title } }), promptId: 901 }); await h.flush();
      return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
    } });
  }
  // 2026-10-27: a land the player tapped that costs life (Mana Confluence): its "pay 1 life?" is answered yes
  const tapP = (cost) => prompt("chooseAction", { actions: [{ id: "tap:engine-card-64:0", type: "activateAbility", cardId: "engine-card-64", isManaAbility: true, description: cost, producedMana: [{ amount: 1, color: "R" }] }, { id: "pass", type: "pass" }] });
  // (only when the tapped ability's own cost pays life: a plain land's tap doesn't answer a later "pay 1 life?")
  for (const [label, after, cost] of [["just tapped: answered yes", true, "{T}, Pay 1 life: Add one mana of any color."], ["not tapped by the player: asked", false, ""],
    ["tapped, but its cost pays no life: asked", true, "{T}: Add {R}."]]) {
    add({ name: `pay life to tap: ${label}`, run: async (h) => {
      const seat = game(h, myMain(D2.board));
      if (after) {
        h.B.onPrompt(seat, tapP(cost)); await h.flush();
        h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "tapmana", id: "engine-card-64" }) }); await h.flush();
      }
      h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { title: "Mountain: pay 1 life?" } }), promptId: 901 }); await h.flush();
      return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
    } });
  }
  // 2026-10-27: Pay on a "you may pay" question of your own card: the payment that follows comes from the pool by itself
  add({ name: "pay: after Pay on your own card's may-pay question, the pool pays without asking", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, prompt("chooseBoolean", { confirmLabel: "Pay", denyLabel: "Decline",
      presentation: { title: "Pay {1}{G}?", text: `otherwise: "Create a token that's a copy of Alesha."` } },
      { sourceCard: { id: "engine-card-22", identity: { name: "Springheart Nantuko" }, text: "Landfall — Whenever a land you control enters, you may pay {1}{G} if Springheart Nantuko is attached to a creature you control. If you do, create a token that's a copy of that creature. If you didn't create a token this way, create a 1/1 green Insect creature token." } })); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["yes"] }) }); await h.flush();
    h.B.onPrompt(seat, { ...prompt("payManaCost", { cardId: "engine-card-22", cardName: "Springheart Nantuko", manaCost: "{1}{G}", canConfirmFromPool: true, actions: [] }), promptId: 901 }); await h.flush();
    return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
  } });
}
// 2026-10-26: equipment dropped onto your creature: Equip, and its target question answered with that creature
{
  const eqP = prompt("chooseAction", { actions: [{ id: "a-eq", type: "activateAbility", cardId: "engine-card-36", description: "Equip {1} ({1}: Attach to target creature you control.)" }, { id: "pass", type: "pass" }] });
  const sent = (h) => h.effects.map((e) => e.relay).filter((r) => r && r.state?.kind === "response").map((r) => r.state.action);
  add({ name: "attach: equipment dropped on a creature equips it there", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, eqP); await h.flush();
    h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "attach", id: "engine-card-36", to: "engine-card-64" }) }); await h.flush();
    h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, chosenTargets: 0, presentation: { title: "Choose a target" },
      candidates: [{ id: "engine-card-64", kind: "card" }, { id: "engine-card-65", kind: "card" }] }), promptId: 901, sourceCard: { id: "engine-card-36", identity: { name: "Bonesplitter" } } }); await h.flush();
    return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
  } });
  add({ name: "attach: refused when it can't be equipped now", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "pass", type: "pass" }] })); await h.flush();
    h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "attach", id: "engine-card-36", to: "engine-card-64" }) }); await h.flush();
    return { sent: sent(h), told: h.effects.filter((e) => e.tts && (e.tts.t === "refused" || e.tts.t === "chat")).map((e) => e.tts.text || e.tts.reason || JSON.stringify(e.tts)).slice(0, 2) };
  } });
}
// 2026-10-26: mtg aideck replaces the list (typed again next game it was listed twice); several decks in one go
add({ name: "AI deck: chosen twice is listed once; two in one command", run: async (h) => {
  const say = (deck) => h.B.onTTS({ t: "aideck", json: JSON.stringify({ deck }) });
  say("ai_passive_lands"); say("ai_passive_lands"); await h.flush();
  say("ai_passive_lands ai_bigboard"); await h.flush();
  say("clear"); await h.flush();
  return { told: h.effects.filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text) };
} });
// 2026-10-26: a spell's optional second target (Fire, 1 to 2 targets, one chosen) can be skipped with Done
add({ name: "targets: an optional extra target is skipped with Done", run: async (h) => {
  const seat = game(h, myMain(D2.board));
  h.B.onPrompt(seat, prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 2, chosenTargets: 1, cancellable: true, presentation: { title: "Fire: choose 1 to 2 targets" },
    candidates: [{ id: "player-0", kind: "player" }, { id: "engine-card-75", kind: "card" }] }, { sourceCard: { identity: { name: "Fire" } } })); await h.flush();
  const ui = seat.prompt?.ui;
  h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: [] }) }); await h.flush();
  const sent = h.effects.map((e) => e.relay).filter((r) => r && r.state?.kind === "response").map((r) => r.state.action);
  return { title: ui?.title, min: ui?.min, max: ui?.max, sent };
} });
// 2026-10-26: called while the caller already holds priority with an empty stack: paused at once (mtg mana 99)
add({ name: "M7 manual fix vs AI: called during an open priority question pauses at once", run: async (h) => {
  const seat = game(h, withFix(null));
  h.B.onPrompt(seat, prompt("chooseAction", { actions: acts })); await h.flush();
  h.B.onTTS(fixMsg("Blue", "call")); await h.flush();
  const f = h.B._getGame().fix;
  return { state: f?.state || null, held: !!f?.held, open: seat.prompt ? seat.prompt.type : null };
} });
add({ name: "M7 manual fix vs AI: call, pause, done, apply", run: async (h) => {
  const seat = game(h, withFix(null));
  const send = async (m, note) => { h.effects.push({ step: note }); h.B.onTTS(m); await h.flush(); };
  const board = async (b) => { seat.board.state = b; h.B._getGame().lastTableSig = null; h.B.sendTable(); await h.flush(); };
  await send(fixMsg("Blue", "call"), "call");
  await board(withFix(null));
  const onStack = withFix(null); onStack.gameView.stack = [{ id: "s1", controllerId: "player-1", identity: { name: "Shock" } }];
  seat.board.state = onStack;
  h.effects.push({ step: "a question with a spell on the stack" }); h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush();
  seat.board.state = withFix(null);
  h.effects.push({ step: "a priority question with an empty stack" }); h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush();
  const held = !!h.B._getGame().fix?.held;
  await send(fixMsg("Blue", "done", { ops: FIX_OPS }), "done");
  const sentOps = h.effects.filter((e) => e.relay?.state?.directive?.type === "applyState").map((e) => e.relay.state.directive);
  await board(withFix({ fixId: 99, applied: true }));
  const stillApplying = h.B._getGame().fix?.state;
  await board(withFix({ fixId: 1, applied: false, message: "no card engine-card-196" }));
  const refusedState = h.B._getGame().fix?.state;
  const afterRefusal = h.B._getGame().fix?.state;
  h.effects.push({ step: "the engine asks again" }); h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush();
  await send(fixMsg("Blue", "done", { ops: FIX_OPS.slice(0, 1) }), "done again");
  const retrying = h.B._getGame().fix?.state; // (the old answer, fixId 1, isn't this one's)
  await board(withFix({ fixId: 2, applied: true }));
  h.effects.push({ step: "after it: questions are answered again" }); h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush();
  return { held, sentOps, stillApplying, refusedState, afterRefusal, retrying, fix: h.B._getGame().fix };
} });
add({ name: "M7 manual fix: what is refused", run: async (h) => {
  const seat = game(h, withFix(null));
  const send = async (m, note) => { h.effects.push({ step: note }); h.B.onTTS(m); await h.flush(); };
  await send(fixMsg("Blue", "vote", { accept: true }), "vote with nothing open");
  await send(fixMsg("Blue", "done", { ops: FIX_OPS }), "done with no fix");
  await send(fixMsg("Blue", "cancel"), "cancel with no fix");
  await send(fixMsg("Red", "call"), "not a player");
  seat.board.state.gameView.restoreVote = { voteId: 1, status: { type: "pending" }, awaitingPlayerIds: [] };
  await send(fixMsg("Blue", "call"), "during a rewind vote");
  seat.board.state = withFix(null);
  await send(fixMsg("Blue", "call"), "call");
  await send(fixMsg("Blue", "call"), "call twice");
  await send(fixMsg("Blue", "done", { ops: FIX_OPS }), "done before the pause");
  h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush();
  for (const [note, ops] of [["nothing", []], ["not a list", "x"], ["unknown op", [{ op: "explode", card: "engine-card-22" }]],
    ["missing field", [{ op: "tap", card: "engine-card-22" }]], ["unknown card", [{ op: "tap", card: "engine-card-5", tapped: true }]],
    ["unknown attach target", [{ op: "attach", card: "engine-card-36", to: "engine-card-5" }]],
    ["bad zone", [{ op: "move", card: "engine-card-22", zone: "stack" }]], ["negative life", [{ op: "life", player: "Blue", n: -1 }]],
    ["fraction", [{ op: "poison", player: "Blue", n: 1.5 }]], ["too big", [{ op: "life", player: "Blue", n: 1000 }]],
    ["mana not a symbol", [{ op: "mana", player: "Blue", mana: "X" }]], ["mana as a number", [{ op: "mana", player: "Blue", mana: 99 }]],
    ["mana symbols run together", [{ op: "mana", player: "Blue", mana: "WW" }]],
    ["unknown player", [{ op: "life", player: "Purple", n: 3 }]], ["tapped as text", [{ op: "tap", card: "engine-card-22", tapped: "yes" }]],
    ["library middle", [{ op: "move", card: "engine-card-22", zone: "library", position: "middle" }]],
    ["counter kind in lower case", [{ op: "counters", card: "engine-card-22", kind: "p1p1", n: 1 }]], ["card id a number", [{ op: "tap", card: 22, tapped: true }]],
    ["a land attached", [{ op: "attach", card: "engine-card-22", to: "engine-card-64" }]],
    ["an unknown token", [{ op: "createToken", script: "dragon of doom", player: "Blue" }]],
    ["commander damage from a colour without a commander", [{ op: "commanderDamage", player: "Blue", from: "Red", n: 3 }]],
    ["zero is fine, extra fields are dropped", [{ op: "life", player: "Blue", n: 0, junk: 1 }]]]) {
    await send(fixMsg("Blue", "done", { ops }), note);
  }
  await send(fixMsg("Blue", "cancel"), "cancel while applying");
  h.effects.push({ step: "watchdog: too soon" }); h.B.fixWatchdog(); await h.flush();
  const soon = h.B._getGame().fix.state;
  h.B._getGame().fix.appliedAt -= 20000;
  h.effects.push({ step: "watchdog: no answer in 20 s" }); h.B.fixWatchdog(); await h.flush();
  const late = h.B._getGame().fix.state;
  h.effects.push({ watchdog: [soon, late] });
  seat.board.state = withFix(null); seat.board.state.gameView.players.find((p) => p.id === "player-0").status = "lost";
  await send(fixMsg("Blue", "call"), "a player who is out");
  h.B._getGame().fromTable = false; seat.board.state = withFix(null);
  await send(fixMsg("Blue", "call"), "not a table game");
  return null;
} });
// two people: both votes, a decline at each, cancel giving the held question back
add({ name: "M7 manual fix with two players: votes, declines, cancel", run: async (h) => {
  const seat = game(h, withFix(null));
  const white = new h.B.Seat("White", "neheb_minotaur_commander");
  white.slot = "player-1"; white.board = { state: withFix(null), fingerprint: null };
  const g = h.B._getGame();
  g.seats.set("White", white); g.bots = 0; g.slotNames["player-1"] = "White";
  const send = async (m, note) => { h.effects.push({ step: note }); h.B.onTTS(m); await h.flush(); };
  const state = () => ({ state: g.fix?.state || null, waiting: g.fix?.waiting || null, held: !!g.fix?.held });
  const seen = [];
  await send(fixMsg("Blue", "call"), "Blue calls"); seen.push(state());
  await send(fixMsg("Blue", "vote", { accept: true }), "Blue's own vote isn't needed"); seen.push(state());
  await send(fixMsg("White", "vote", { accept: false }), "White declines"); seen.push(state());
  await send(fixMsg("Blue", "call"), "Blue calls again"); seen.push(state());
  h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush(); seen.push(state());
  await send(fixMsg("White", "vote", { accept: true }), "White agrees"); seen.push(state());
  await send(fixMsg("White", "done", { ops: FIX_OPS.slice(2, 4) }), "White is done"); seen.push(state());
  await send(fixMsg("White", "vote", { accept: true }), "White's own change list"); seen.push(state());
  await send(fixMsg("Blue", "vote", { accept: false }), "Blue declines the list"); seen.push(state());
  await send(fixMsg("White", "done", { ops: FIX_OPS.slice(9, 10) }), "White is done again"); seen.push(state());
  await send(fixMsg("Blue", "vote", { accept: true }), "Blue agrees"); seen.push(state());
  await send(fixMsg("White", "cancel"), "cancel while applying"); seen.push(state());
  seat.board.state = withFix({ fixId: 1, applied: false, message: "Grizzly Bears can't move to Battlefield" }); g.lastTableSig = null; h.B.sendTable(); await h.flush(); seen.push(state());
  h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush(); seen.push(state());
  await send(fixMsg("White", "cancel"), "White cancels"); seen.push(state());
  return { seen, openAfter: seat.prompt ? seat.prompt.type : null };
} });
// three people: every other player who is still in must agree (one yes isn't enough); a player who is out has no
// say; the question held is the first one (another seat's question meanwhile is answered as usual); a question
// panel still open on the table is closed when the engine is paused
add({ name: "M7 manual fix with three players", run: async (h) => {
  const seat = game(h, withFix(null));
  const g = h.B._getGame();
  const extra = (color, slot) => { const s = new h.B.Seat(color, "neheb_minotaur_commander"); s.slot = slot; s.board = { state: seat.board.state, fingerprint: null }; g.seats.set(color, s); g.slotColor[slot] = color; g.slotNames[slot] = color; return s; };
  const b3 = withFix(null);
  b3.gameView.players.push({ ...clone(b3.gameView.players[1]), id: "player-2", status: "playing" });
  seat.board.state = b3;
  const white = extra("White", "player-1"), red = extra("Red", "player-2");
  g.bots = 0;
  const send = async (m, note) => { h.effects.push({ step: note }); h.B.onTTS(m); await h.flush(); };
  const state = () => ({ state: g.fix?.state || null, waiting: g.fix?.waiting || null, held: g.fix?.held?.seat?.color || null });
  const seen = [];
  await send(fixMsg("Blue", "call"), "Blue calls"); seen.push(state());
  await send(fixMsg("White", "vote", { accept: true }), "White agrees"); seen.push(state());
  h.B.onPrompt(seat, prompt("chooseBoolean", { presentation: { title: "Draw a card?" } })); await h.flush();
  const panelBefore = !!seat.prompt;
  h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush(); seen.push(state());
  const panelAfter = !!seat.prompt;
  h.effects.push({ step: "Red's question while Blue's is held" }); h.B.onPrompt(red, { ...prompt("chooseAction", { actions: [] }), decidingPlayerId: "player-2" }); await h.flush(); seen.push(state());
  await send(fixMsg("Red", "vote", { accept: true }), "Red agrees"); seen.push(state());
  await send(fixMsg("Red", "cancel"), "Red cancels"); seen.push(state());
  b3.gameView.players.find((p) => p.id === "player-2").status = "lost";
  await send(fixMsg("Blue", "call"), "Blue calls with Red out"); seen.push(state());
  return { seen, panelBefore, panelAfter, white: !!white };
} });
// (Stage 3, 2026-10-23) an apply the engine refused without asking again ("not waiting for priority"), or never
// answered: the question it went out on is still the open one, so Done works again (it crashed on the missing
// question); a declined list clears the last refusal's message; no rewind under a fix; no fix after the game
add({ name: "M7 manual fix: an apply the engine never took, rewind and game over", run: async (h) => {
  const seat = game(h, withFix(null));
  const g = h.B._getGame();
  const send = async (m, note) => { h.effects.push({ step: note }); h.B.onTTS(m); await h.flush(); };
  const board = async (b) => { seat.board.state = b; g.lastTableSig = null; h.B.sendTable(); await h.flush(); };
  await send(fixMsg("Blue", "call"), "call");
  h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush();
  await send(fixMsg("Blue", "done", { ops: FIX_OPS.slice(9, 10) }), "done");
  await board(withFix({ fixId: 1, applied: false, message: "not waiting for priority" }));
  const afterRefusal = { state: g.fix.state, held: !!g.fix.held };
  await send(fixMsg("Blue", "done", { ops: FIX_OPS.slice(9, 10) }), "done again, no new question came");
  const retried = h.effects.filter((e) => e.relay?.state?.directive?.type === "applyState").length;
  g.fix.appliedAt -= 20000; h.B.fixWatchdog(); await h.flush();
  const afterWatchdog = { state: g.fix.state, held: !!g.fix.held };
  await send({ t: "rewind", json: JSON.stringify({ color: "Blue", checkpointId: 61 }) }, "rewind under a fix");
  await send(fixMsg("Blue", "cancel"), "cancel");
  // a declined list after a refusal: the old message goes
  const white = new h.B.Seat("White", "neheb_minotaur_commander");
  white.slot = "player-1"; white.board = { state: withFix(null), fingerprint: null };
  g.seats.set("White", white); g.bots = 0; g.slotNames["player-1"] = "White";
  await send(fixMsg("Blue", "call"), "two players: call");
  await send(fixMsg("White", "vote", { accept: true }), "agreed");
  h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush();
  await send(fixMsg("Blue", "done", { ops: FIX_OPS.slice(9, 10) }), "list");
  await send(fixMsg("White", "vote", { accept: true }), "applied");
  await board(withFix({ fixId: 3, applied: false, message: "refused" }));
  const refusedMessage = g.fix.message;
  await send(fixMsg("Blue", "done", { ops: FIX_OPS.slice(9, 10) }), "list again");
  await send(fixMsg("White", "vote", { accept: false }), "declined");
  const declinedMessage = g.fix.message;
  await send(fixMsg("Blue", "cancel"), "cancel");
  const over = withFix(null); over.gameView.gameOver = true; seat.board.state = over;
  await send(fixMsg("Blue", "call"), "after the game");
  return { afterRefusal, retried, afterWatchdog, refusedMessage, declinedMessage, fixAfter: g.fix };
} });
// tokens by colour and size (a blue 1/1 spirit is the flying one, not the colourless 1/1 spirit; a 3/3 beast not the
// 2/2), and commander damage counted per colour with partners: the first commander takes what the other hasn't dealt
add({ name: "M7 manual fix: token names and partners", run: async (h) => {
  const b = withFix(null);
  const white = b.gameView.players.find((p) => p.id === "player-1"), blue = b.gameView.players.find((p) => p.id === "player-0");
  white.commanderCasts = { "engine-card-200": 1, "engine-card-201": 0 };
  blue.commanderDamage = { "engine-card-200": 2, "engine-card-201": 3 };
  b.gameView.zones.find((z) => z.zone === "command" && z.ownerId === "player-1")?.cards.push({ id: "engine-card-201", identity: { name: "Partner Two" } })
    || b.gameView.zones.push({ zone: "command", ownerId: "player-1", cards: [{ id: "engine-card-201", identity: { name: "Partner Two" } }], count: 1 });
  const seat = game(h, b);
  h.B.onTTS(fixMsg("Blue", "call")); await h.flush();
  h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush();
  h.B.onTTS(fixMsg("Blue", "done", { ops: [{ op: "createToken", script: "1/1 blue spirit", player: "Blue" }, { op: "createToken", script: "3/3 green beast", player: "Blue" },
    { op: "createToken", script: "white 1/1 soldier", player: "Blue" }, { op: "commanderDamage", player: "Blue", from: "White", n: 10 }] })); await h.flush();
  return h.effects.filter((e) => e.relay?.state?.directive?.type === "applyState").map((e) => e.relay.state.directive.ops);
} });
// (2026-10-23) Auto-resolve: on other players' turns priority passes by itself, even with something to cast; your own
// turn asks as before; switched on while a "Resolve" waits on someone else's turn, that one goes at once
{
  const oppTurn = () => { const b = clone(D2.board); b.gameView.activePlayerId = "player-1"; b.gameView.step = "main1"; b.gameView.stack = [{ id: "s1", controllerId: "player-1", identity: { name: "Shock" } }]; return b; };
  add({ name: "auto-resolve: someone else's turn passes, your own asks, switching it on answers the waiting one", run: async (h) => {
    const seat = game(h, oppTurn());
    const ar = async (on, note) => { h.effects.push({ step: note }); h.B.onTTS({ t: "autoresolve", json: JSON.stringify({ color: "Blue", on }) }); await h.flush(); };
    h.effects.push({ step: "off: the opponent's spell stops you" }); h.B.onPrompt(seat, prompt("chooseAction", { actions: acts.slice(1, 3) })); await h.flush();
    const askedOff = !!seat.prompt;
    await ar(true, "switched on with the Resolve waiting");
    const afterOn = !!seat.prompt;
    h.effects.push({ step: "on: the next one passes" }); h.B.onPrompt(seat, prompt("chooseAction", { actions: acts.slice(1, 3) })); await h.flush();
    const onOpp = !!seat.prompt;
    seat.board.state = myMain(D2.board);
    h.effects.push({ step: "on, your own turn: asked" }); h.B.onPrompt(seat, prompt("chooseAction", { actions: acts.slice(1, 3) })); await h.flush();
    const onMine = !!seat.prompt;
    await ar(false, "off again");
    seat.board.state = oppTurn();
    h.effects.push({ step: "off: stops again" }); h.B.onPrompt(seat, prompt("chooseAction", { actions: acts.slice(1, 3) })); await h.flush();
    return { askedOff, afterOn, onOpp, onMine, offAgain: !!seat.prompt };
  } });
}
add({ name: "table: a card moves, only changed zones are sent", run: async (h) => {
  const seat = game(h, D2.board);
  h.B.sendTable(); await h.flush();
  const s = clone(D2.board);
  const hand = s.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0");
  const bf = s.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
  bf.cards.push(hand.cards.splice(hand.cards.findIndex((c) => c.id === "engine-card-75"), 1)[0]);
  seat.board = { state: s, fingerprint: null };
  h.effects.push({ mark: "Hurloon Minotaur moved to the battlefield" });
  h.B.sendTable(); await h.flush();
  return null;
} });
add({ name: "hello mid-game resends everything", run: async (h) => {
  const seat = game(h, D2.board, { game: { log: ["--- Blue's turn 2 ---", "Blue draws a card"] } });
  h.B.onPrompt(seat, prompt("chooseNumber", { min: 0, max: 3 })); await h.flush();
  h.B.onTTS({ t: "hello", json: "{}" }); await h.flush();
  return null;
} });
// (the table asks again while it has drawn nothing: the game again, the greeting not, hp-22 re-test 2026-10-28)
add({ name: "hello again resends everything without the greeting", run: async (h) => {
  const seat = game(h, D2.board, { game: { log: ["--- Blue's turn 2 ---", "Blue draws a card"] } });
  h.B.onPrompt(seat, prompt("chooseNumber", { min: 0, max: 3 })); await h.flush();
  h.B.onTTS({ t: "hello", json: JSON.stringify({ t: "hello", again: true }) }); await h.flush();
  return null;
} });
// (TTS's "game loaded" comes after the table's hello, whose answer was lost: the game again then; none without a game)
add({ name: "game loaded resends the running game", run: async (h) => {
  const seat = game(h, D2.board, { game: { log: ["--- Blue's turn 2 ---"] } });
  h.B.onPrompt(seat, prompt("chooseNumber", { min: 0, max: 3 })); await h.flush();
  const mark = h.effects.length;
  h.B.onTTSDebug({ messageID: 1 }); await h.flush();
  return h.effects.slice(mark).filter((e) => e.tts).map((e) => e.tts.t);
} });
add({ name: "game loaded with no game: nothing sent", run: async (h) => {
  const mark = h.effects.length;
  h.B.onTTSDebug({ messageID: 1 }); await h.flush();
  return h.effects.slice(mark).filter((e) => e.tts).map((e) => e.tts.t);
} });
add({ name: "reset restarts the Forge room", run: async (h) => {
  game(h, D2.board);
  h.B.onTTS({ t: "reset", json: "{}" }); await h.flush();
  return { game: h.B._getGame() === null };
} });
add({ name: "game started: names, colours, picture requests", run: async (h) => {
  const seat = game(h, D2.board, { game: { started: false, playerOrder: [], slotNames: {}, slotColor: {}, deckNames: new Set(["Forest", "Ghost", "Hurloon Minotaur"]) } });
  seat.onRelay({ type: "GameStarted", player_order: ["self-hosted-node-77-bot", seat.username], game_id: "g1", starting_life: 40 });
  await h.flush();
  const g = h.B._getGame();
  return { slotNames: g.slotNames, slotColor: g.slotColor, seatSlot: seat.slot };
} });
add({ name: "text board (not drawn by the table) for one seat", run: async (h) => {
  const seat = game(h, D2.board, { game: { fromTable: false } });
  seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(D2.board), fingerprint: "f1" });
  await h.flush();
  return null;
} });
// ── fixes from the correctness review (docs/reviews/code-analysis-bridge-2026-10-20.md); each case fails if its fix is undone ──
const chooseTwo = prompt("chooseCards", { min: 2, max: 2, cards: [H(43), H(35), H(75)], presentation: { title: "Choose two" } });
add(promptCase("F4 answer: the same card twice is refused", D2.board, chooseTwo, [["engine-card-43", "engine-card-43"]]));
add(promptCase("F4 answer: an id that isn't an option is refused", D2.board, reorderP, [["bogus"]]));
add(promptCase("F4 answer: cancel where it isn't allowed is refused", D2.board, chooseTwo, [["__cancel"]]));
add(promptCase("F4 answer: number out of range / not a number refused", D2.board, prompt("chooseNumber", { min: 0, max: 5 }), [["9"], ["x"], ["5"]]));
add(promptCase("F5 scry with one destination answers itself", D2.board, prompt("scry", { zones: ["graveyard"], cards: [H(43), H(75)], presentation: { title: "Mill 2" } }), []));
{
  const payOrSac = prompt("chooseBoolean", { presentation: { title: "Pay {1}?" } }, { sourceCard: card(D2.board, "engine-card-22"), sourceAbilityText: "Sacrifice this unless you pay {1}." });
  add(intentCase("F6 drag: a 'pay, or sacrifice' question isn't answered by a drag", mainB, payOrSac, [{ kind: "sacrifice", id: "engine-card-22" }]));
  const sacQ = prompt("chooseBoolean", { presentation: { title: "Sacrifice Evolving Wilds?" } }, { sourceCard: card(D2.board, "engine-card-22") });
  add(intentCase("F6 drag: the card asked about answers 'sacrifice it?' with yes", mainB, sacQ, [{ kind: "sacrifice", id: "engine-card-22" }]));
  add(intentCase("F6 drag: another card doesn't answer it", mainB, sacQ, [{ kind: "sacrifice", id: "engine-card-64" }]));
}
add({ name: "F1 a prompt missing its card list doesn't stop the bridge", run: async (h) => {
  const seat = game(h, D2.board);
  seat.onEnvelope({ kind: "prompt", forPlayer: "player-0", prompt: prompt("chooseCards", { min: 1, max: 1 }) }); // the relay's path
  await h.flush();
  return { alive: true };
} });
add(promptCase("F1 a selection option without a label doesn't stop the bridge", D2.board, prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "B" }, {}] }), [["0"]]));
add({ name: "F1 garbage and binary relay frames don't stop the bridge", run: async (h) => {
  const seat = game(h, D2.board);
  seat.ws.emit("message", "not json {");
  seat.ws.emit("message", new TextEncoder().encode(JSON.stringify({ type: "Error", code: "x", message: "binary frame read" })).buffer);
  await h.flush();
  return { alive: true };
} });
add({ name: "F1/F18 mtg deck: only Commander decks can be chosen", run: async (h) => {
  game(h, D2.board);
  h.B.onTTS({ t: "deck", json: JSON.stringify({ color: "Blue", deck: "index" }) });
  h.B.onTTS({ t: "deck", json: JSON.stringify({ color: "Blue", deck: "../bridge/forge-cards" }) });
  h.B.onTTS({ t: "aideck", json: JSON.stringify({ deck: "index" }) });
  await h.flush();
  return null;
} });
// "mtg aideck" wins over a deck lying in an empty seat (a harmless test AI got the player's other Commander deck)
add({ name: "AI deck: the one chosen with mtg aideck comes before a deck in an empty seat", run: async (h) => {
  const tableDeck = { deckName: "Table deck (Yuriko)", commanderName: "Yuriko, the Tiger's Shadow", deck: { cards: [], commanders: [] } };
  const seat = game(h, D2.board, { game: { bots: 1, total: 2, started: false, botsRequested: false, aiTableDecks: [tableDeck] }, seat: { joined: true, roomId: "room-1" } });
  h.B.onTTS({ t: "aideck", json: JSON.stringify({ deck: "ai_passive_lands" }) });
  await h.flush();
  frame(seat.ws, { type: "RoomUpdate", room: { room_id: "room-1", host: seat.username, status: "Lobby", max_players: 4,
    players: [{ username: seat.username, ready: true, connected: true }] } });
  await h.flush();
  const spawn = h.effects.map((e) => e.relay).find((r) => r && r.state?.payload?.type === "spawnBot");
  h.B.onTTS({ t: "aideck", json: JSON.stringify({ deck: "clear" }) });
  await h.flush();
  return { decks: (spawn?.state.payload.decks || []).map((d) => d.deckName) };
} });
add({ name: "F8 Scryfall unreachable: waits and backs off", harness: { scryfall: "down" }, run: async (h) => {
  const seat = game(h, D2.board, { game: { sentStatic: {} } });
  h.B.sendTable(); await h.flush(60);
  return { fetches: h.effects.filter((e) => e.fetch).length };
} });
add({ name: "F9 Scryfall busy: a token isn't remembered as having no picture", harness: { scryfall: "busy" }, run: async (h) => {
  const b = clone(D2.board);
  b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-777", identity: { name: "Insect Token", isToken: true }, types: ["Creature"], power: 1, toughness: 1, color: "G" });
  game(h, b);
  h.B.sendTable(); await h.flush(60);
  return { tokenCached: h.effects.some((e) => e.writeFile && /image-cache/.test(e.writeFile)) };
} });
add({ name: "F7 more players than the table has seats is refused", run: async (h) => {
  h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue", "White"], bots: 3, requireReady: false, fromTable: true }) });
  await h.flush();
  return { game: h.B._getGame() !== null };
} });
// ── M4.5 rewind by vote ──
const CPS = [
  { checkpointId: 61, turn: 10, step: "upkeep", activePlayerId: "player-1" }, { checkpointId: 62, turn: 10, step: "draw", activePlayerId: "player-1" },
  { checkpointId: 63, turn: 10, step: "main1", activePlayerId: "player-1" }, { checkpointId: 64, turn: 10, step: "combatDeclareAttackers", activePlayerId: "player-1" },
  { checkpointId: 65, turn: 10, step: "main2", activePlayerId: "player-1" }, { checkpointId: 66, turn: 10, step: "endOfTurn", activePlayerId: "player-1" },
  { checkpointId: 67, turn: 11, step: "upkeep", activePlayerId: "player-0" },
];
const withRewind = (vote) => { const b = clone(D2.board); b.gameView.checkpoints = clone(CPS); b.gameView.restoreVote = vote; return b; };
const voteOf = (status, awaiting = ["player-1"], by = "player-0") => ({ voteId: 5, checkpoint: CPS[0], requestedByPlayerId: by, awaitingPlayerIds: awaiting, status });
add({ name: "M4.5 rewind: restore points and the vote ride on the board update; each vote change is announced once", run: async (h) => {
  const seat = game(h, withRewind(null));
  h.B.sendTable(); await h.flush();
  for (const st of [{ type: "pending" }, { type: "pending" }, { type: "declined", playerId: "player-1" }, { type: "unavailable" }, undefined]) {
    seat.board.state = withRewind(voteOf(st));
    h.B._getGame().lastTableSig = null;
    h.B.sendTable(); await h.flush();
  }
  return null;
} });
// everyone voted yes, but a player is answering something other than a priority question: the vote names them (the
// table said "Waiting for ..." with no name for as long as that took, playtest 2026-10-24)
// the button once everyone has agreed: its yes reaches Forge only with nobody left to ask and the vote still open
add({ name: "M4.5 rewind go: the button sends a yes on an agreed vote, and only then", run: async (h) => {
  const seat = game(h, withRewind(null));
  const sent = [];
  seat.directive = (d) => sent.push(d);
  const press = () => h.B.onTTS({ t: "rewindGo", color: seat.color });
  press();
  seat.board.state = withRewind(voteOf({ type: "pending" }, ["player-1"]));
  press();
  seat.board.state = withRewind(voteOf({ type: "declined" }, []));
  press();
  seat.board.state = withRewind(voteOf({ type: "pending" }, []));
  press();
  await h.flush();
  return { sent };
} });
add({ name: "M4.5 rewind agreed: the vote says who it waits for and what they must answer", run: async (h) => {
  const seat = game(h, withRewind(null));
  h.B.sendTable(); await h.flush();
  for (const [st, busy] of [[{ type: "pending" }, true], [{ type: "approved" }, true], [{ type: "pending" }, false]]) {
    seat.prompt = busy ? { promptId: 9, type: "chooseFromSelection", ui: { title: "Unclaimed Territory: choose a creature type" } } : null;
    seat.board.state = withRewind(voteOf(st, []));
    h.B._getGame().lastTableSig = null;
    h.B.sendTable(); await h.flush();
  }
  seat.prompt = null;
  return null;
} });
add({ name: "M4.5 rewind request: a kept point is asked for; unknown points, an open vote and players who are out are refused", run: async (h) => {
  const seat = game(h, withRewind(null));
  const ask = async (id) => { h.effects.push({ ask: id }); h.B.onTTS({ t: "rewind", json: JSON.stringify({ color: "Blue", checkpointId: id }) }); await h.flush(); };
  await ask(63); await ask("63"); await ask(999); await ask(null);
  seat.board.state = withRewind(voteOf({ type: "pending" })); await ask(61);
  seat.board.state = withRewind(null); seat.board.state.gameView.players.find((p) => p.id === "player-0").status = "lost"; await ask(61);
  seat.board.state = withRewind(null); seat.board.state.gameView.players.find((p) => p.id === "player-0").status = "conceded"; await ask(61);
  h.B.onTTS({ t: "rewind", json: JSON.stringify({ color: "Red", checkpointId: 61 }) }); await h.flush();
  return null;
} });
add({ name: "M4.5 rewind vote: only an awaited player's vote is sent", run: async (h) => {
  const seat = game(h, withRewind(voteOf({ type: "pending" }, ["player-0"], "player-1")));
  const vote = async (accept) => { h.effects.push({ vote: accept }); h.B.onTTS({ t: "rewindVote", json: JSON.stringify({ color: "Blue", accept }) }); await h.flush(); };
  await vote(true); await vote(false);
  seat.board.state = withRewind(voteOf({ type: "pending" }, ["player-1"])); await vote(true);
  seat.board.state = withRewind(voteOf({ type: "approved" }, [])); await vote(true);
  seat.board.state = withRewind(null); await vote(true);
  return null;
} });
add({ name: "M4.5 after a rewind the question open before it is closed (an answer to it crashed Forge)", run: async (h) => {
  const seat = game(h, D2.board);
  const at = (turn, step) => { const b = clone(D2.board); b.gameView.turn = turn; b.gameView.step = step; return b; };
  const feed = async (b) => { seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: b }); await h.flush(); };
  await feed(at(8, "main1"));
  h.B.onPrompt(seat, prompt("chooseBoolean", { presentation: { title: "Draw a card?" } })); await h.flush();
  await feed(at(8, "main2")); await feed(at(9, "upkeep"));
  const openBefore = !!seat.prompt;
  await feed(at(8, "upkeep"));
  const afterTurnBack = !!seat.prompt;
  h.B.onPrompt(seat, prompt("chooseBoolean", { presentation: { title: "Draw a card?" } })); await h.flush();
  await feed(at(8, "main2"));
  const forwardKeeps = !!seat.prompt;
  await feed(at(8, "combatBegin")); // an extra combat phase: the step goes back, the game was NOT rewound
  const extraCombatKeeps = !!seat.prompt;
  // a rewind to an earlier point of the SAME step: only the restore points show it (later ones are dropped)
  const cpAt = (n) => { const b = at(8, "main1"); b.gameView.checkpoints = Array.from({ length: n }, (_, i) => ({ checkpointId: 100 + i, turn: 8, step: "main1", activePlayerId: "player-1" })); return b; };
  await feed(cpAt(5));
  h.B.onPrompt(seat, prompt("chooseBoolean", { presentation: { title: "Draw a card?" } })); await h.flush();
  await feed(cpAt(6)); // a new point: still forward
  const growingKeeps = !!seat.prompt;
  await feed(cpAt(3));
  const afterSameTurnRewind = !!seat.prompt;
  // a board without restore points in between must not make the next drop go unnoticed
  h.B.onPrompt(seat, prompt("chooseBoolean", { presentation: { title: "Draw a card?" } })); await h.flush();
  await feed(cpAt(0));
  await feed(cpAt(2));
  return { openBefore, afterTurnBack, forwardKeeps, extraCombatKeeps, growingKeeps, afterSameTurnRewind, afterGapThenDrop: !!seat.prompt };
} });
// ── M4.6 Treachery: concede, the host declares the winner ──
add({ name: "M4.6 concede: a playing seat concedes through the engine; out players and non-players are refused", run: async (h) => {
  const seat = game(h, D2.board);
  const send = async (m) => { h.effects.push({ send: m }); h.B.onTTS({ t: m.t, json: JSON.stringify(m) }); await h.flush(); };
  await send({ t: "concede", color: "Blue" });
  await send({ t: "concede", color: "Red" });
  seat.board.state.gameView.players.find((p) => p.id === "player-0").status = "conceded";
  await send({ t: "concede", color: "Blue" });
  return null;
} });
add({ name: "M4.6 winner: everyone else at the table concedes; AI seats are named; unknown colours refused", run: async (h) => {
  const seat = game(h, D2.board);
  const send = async (m) => { h.effects.push({ send: m }); h.B.onTTS({ t: m.t, json: JSON.stringify(m) }); await h.flush(); };
  await send({ t: "winner", color: "White", by: "Blue" }); // Blue concedes; White is the AI
  await send({ t: "winner", color: "Blue", by: "Blue" });   // nobody else at the table; the AI can't concede
  await send({ t: "winner", color: "Yellow", by: "Blue" });
  h.B._getGame().started = false;
  await send({ t: "winner", color: "Blue", by: "Blue" });
  return null;
} });
// ── M5: what the table's target, attack and block lines are drawn from ──
add({ name: "M5 lines: stack targets (player, card, spell), the attacked player, and who blocks whom", run: async (h) => {
  const b = clone(D2.board);
  const gv = b.gameView;
  const theirs = gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards;
  const mine = gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
  theirs[0].isAttacking = true; theirs[0].attackTargetId = "player-0";
  theirs[1].isAttacking = true; theirs[1].attackTargetId = mine[0].id; // a planeswalker or battle: a card id
  gv.combatAssignments = [{ blockerId: mine[1].id, attackerId: theirs[0].id }, { blockerId: mine[1].id, attackerId: theirs[1].id }];
  gv.stack = [
    { id: "stack-1", controllerId: "player-1", identity: { name: "Shock" }, text: "Shock deals 2 damage to any target.", sourceId: theirs[2].id,
      targets: [{ kind: "player", id: "player-0" }, { kind: "card", id: mine[2].id }, { kind: "spell", id: "stack-0" }, { kind: "player", id: "player-9" }] },
    { id: "stack-2", controllerId: "player-0", identity: { name: "Opt" }, text: "Scry 1.", sourceId: mine[3].id },
  ];
  game(h, b);
  h.B.sendTable(); await h.flush();
  const t = h.effects.find((e) => e.tts && e.tts.t === "table" && e.tts.players.every((p) => p.battlefield)).tts; // (later updates only "keep" zones)
  const bf = (c) => t.players.find((p) => p.color === c).battlefield;
  return { stack: t.stack.map((s) => ({ id: s.id, tg: s.tg })),
    attackers: bf("White").filter((c) => c.atk).map((c) => ({ id: c.id, atkT: c.atkT })),
    blockers: bf("Blue").filter((c) => c.blk).map((c) => ({ id: c.id, blkOf: c.blkOf })) };
} });
// a double-faced card's back on the table is its other face (from the picture cache), not the plain card back
// 2026-10-25: turns go clockwise as the seats sit (White, Red, Yellow, Blue); the AI players take the empty colours
// in between. Before, the order was who joined first with the AI last: White -> Yellow -> AI -> AI.
{
  const startWith = (humans, bots, joinOrder) => async (h) => {
    const seats = humans.map((c) => { const st = new h.B.Seat(c, "neheb_minotaur_commander"); st.joined = true; return st; });
    const botNames = Array.from({ length: bots }, (_, i) => `self-hosted-node-${i}-bot`);
    h.B._setGame({ seats: new Map(seats.map((st) => [st.color, st])), bots, total: humans.length + bots, playerOrder: [], slotNames: {}, slotColor: {},
      started: false, closing: false, fromTable: true, setupAt: 0, maxSet: true, botsRequested: true, sentStatic: {}, sentZones: {} });
    const names = [...joinOrder.map((c) => seats.find((st) => st.color === c).username), ...botNames];
    const room = { status: "Lobby", host: "self-hosted-node", max_players: 4, players: names.map((username) => ({ username, ready: true, connected: true })) };
    h.B.onRoomUpdate(seats[0], room);
    await h.flush();
    const start = h.effects.map((e) => e.relay).find((r) => r && r.type === "StartGame");
    const order = start?.seat_order || [];
    h.B.onGameStarted({ player_order: order, starting_life: 40, game_id: "g1" });
    await h.flush();
    const g = h.B._getGame();
    return { turns: order.map((_, i) => g.slotColor[`player-${i}`]), names: order.map((_, i) => g.slotNames[`player-${i}`]) };
  };
  add({ name: "seat order: White and Yellow + 2 AI go White, Red, Yellow, Blue", run: startWith(["White", "Yellow"], 2, ["Yellow", "White"]) });
  add({ name: "seat order: four players joined out of order go clockwise", run: startWith(["Blue", "White", "Yellow", "Red"], 0, ["Blue", "Yellow", "Red", "White"]) });
  add({ name: "seat order: Blue alone + 1 AI", run: startWith(["Blue"], 1, ["Blue"]) });
  // 2026-10-31: the relay takes StartGame only from the first human seated; White sent it with Blue seated first
  const startFrom = (humans, joinOrder, bots = 0) => async (h) => {
    const seats = humans.map((c) => { const st = new h.B.Seat(c, "neheb_minotaur_commander"); st.joined = true; st.sent = []; st.send = (m) => st.sent.push(m.type); return st; });
    h.B._setGame({ seats: new Map(seats.map((st) => [st.color, st])), bots, total: humans.length + bots, playerOrder: [], slotNames: {}, slotColor: {},
      started: false, closing: false, fromTable: true, setupAt: 0, maxSet: true, botsRequested: true, sentStatic: {}, sentZones: {} });
    const players = [...Array.from({ length: bots }, (_, i) => ({ username: `self-hosted-node-${i}-bot`, ready: true, connected: true, is_bot: true })),
      ...joinOrder.map((c) => ({ username: seats.find((st) => st.color === c).username, ready: true, connected: true, is_bot: false }))];
    h.B.onRoomUpdate(seats[0], { status: "Lobby", host: "self-hosted-node", max_players: 4, players });
    await h.flush();
    return { startedBy: seats.filter((st) => st.sent.includes("StartGame")).map((st) => st.color) };
  };
  add({ name: "start: sent by Blue when Blue is seated first", run: startFrom(["White", "Blue"], ["Blue", "White"]) });
  add({ name: "start: sent by White when White is seated first", run: startFrom(["White", "Blue"], ["White", "Blue"]) });
  add({ name: "start: an AI seated first is never the controller", run: startFrom(["White", "Blue"], ["Blue", "White"], 1) });
}
// 2026-10-25: in a hand it shows the plain back (TTS shows the other players a hand card's back: a daybound card in
// Yellow's hand showed its night side to everyone); on the battlefield its other face
add({ name: "table: a double-faced card's back is its other face", harness: { imageCache: { "hurloon minotaur": { face: "https://img.example/front.webp", back: "https://img.example/back.webp" } } }, run: async (h) => {
  const seat = game(h, D2.board);
  const backOf = (from) => {
    const sent = h.effects.slice(from).filter((e) => e.tts && e.tts.t === "table").flatMap((e) => Object.values(e.tts.cards || {}));
    const minotaur = sent.find((c) => c.n === "Hurloon Minotaur");
    return minotaur ? minotaur.b : "not sent";
  };
  h.B.sendTable(); await h.flush();
  const inHand = backOf(0);
  const mark = h.effects.length;
  const s = clone(D2.board);
  const hand = s.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0");
  const bf = s.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
  bf.cards.push(hand.cards.splice(hand.cards.findIndex((c) => c.id === "engine-card-75"), 1)[0]);
  seat.board = { state: s, fingerprint: null };
  h.B.sendTable(); await h.flush();
  return { inHand, onBattlefield: backOf(mark) };
} });
// 2026-10-26: a copy (Phantasmal Image as Kenrith) is marked as one: the legend rule asked which to keep and both
// looked alike
add({ name: "table: a copy of a card is marked cp", run: async (h) => {
  const s = clone(D2.board);
  const bf = s.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
  bf.cards.find((c) => c.id === "engine-card-22").isCopy = true;
  game(h, s);
  h.B.sendTable(); await h.flush();
  const sent = h.effects.filter((e) => e.tts && e.tts.t === "table").map((e) => JSON.stringify(e.tts)).join(" ");
  const of = (id) => (sent.match(new RegExp('"id":"' + id + '"[^}]*}')) || ["not sent"])[0];
  return { copy: of("engine-card-22"), other: of("engine-card-64") };
} });
// ── Friendly mulligans (SPEC "Friendly mulligans") ──
add({ name: "friendly: the table's count", run: async (h) => {
  const n = h.B._friendlyCount;
  return { none: n(undefined), nul: n(null), zero: n(0), one: n(1), two: n(2), three: n(3), minus: n(-1), half: n(1.5), text: n("1"), yes: n(true), table: n({ White: 2 }) };
} });
{
  // every mulligan question in turn: what the player saw, what went to the engine, what the table was told
  const askAll = async (h, seat, steps) => {
    const seen = [];
    let id = 950;
    for (const [count, answer] of steps) {
      id++;
      h.B.onPrompt(seat, { ...prompt("mulligan", { mulliganCount: count }), promptId: id }); await h.flush();
      const ui = h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.promptId === id).at(-1)?.tts;
      const mark = h.effects.length;
      h.B.onAnswer(seat.color, id, [answer]); await h.flush();
      const after = h.effects.slice(mark);
      seen.push({ count, answer, button: ui?.options?.find((o) => o.id === "mull")?.label, text: ui?.text ?? null,
        sent: JSON.stringify(after.filter((e) => e.relay)).match(/"output":\{[^}]*\}/)?.[0] ?? null,
        said: after.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text || e.tts.msg), log: after.filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines) });
    }
    return seen;
  };
  add({ name: "friendly: 2 players, 1 free", run: async (h) => {
    const seat = game(h, D2.board, { game: { friendly: 1 } });
    return askAll(h, seat, [[0, "mull"], [1, "mull"], [2, "keep"]]);
  } });
  add({ name: "friendly: 2 players, 2 free, the second is the last", run: async (h) => {
    const seat = game(h, D2.board, { game: { friendly: 2 } });
    return askAll(h, seat, [[0, "mull"], [1, "mull"], [2, "keep"]]);
  } });
  add({ name: "friendly: 4 players set to 1 is the rules' free one", run: async (h) => {
    const seat = game(h, D2.board, { game: { friendly: 1, total: 4 } });
    return askAll(h, seat, [[0, "mull"], [0, "mull"], [1, "keep"]]);
  } });
  add({ name: "friendly: 4 players set to 2 is 2 in all, the rules' one included", run: async (h) => {
    const seat = game(h, D2.board, { game: { friendly: 2, total: 4 } });
    return askAll(h, seat, [[0, "mull"], [0, "mull"], [1, "mull"], [2, "keep"]]);
  } });
  add({ name: "friendly: 3 players have the rules' free one too", run: async (h) => {
    const seat = game(h, D2.board, { game: { friendly: 1, total: 3 } });
    return askAll(h, seat, [[0, "mull"], [0, "mull"], [1, "keep"]]);
  } });
  add({ name: "friendly: the snapshot says the line was said", run: async (h) => {
    const seat = game(h, D2.board, { game: { friendly: 1, friendlyOver: true } });
    await askAll(h, seat, [[0, "mull"]]);
    return h.effects.filter((e) => e.writeFile).map((e) => e.bytes);
  } });
  add({ name: "friendly: none voted, the question is as it always was", run: async (h) => {
    const two = await askAll(h, game(h, D2.board, { game: { friendly: 0 } }), [[0, "mull"], [1, "mull"], [2, "keep"]]);
    const four = await askAll(h, game(h, D2.board, { game: { total: 4 } }), [[0, "mull"], [0, "keep"]]);
    return { two, four };
  } });
  add({ name: "friendly: counted per player", run: async (h) => {
    const seat = game(h, D2.board, { game: { friendly: 1 } });
    const other = new h.B.Seat("White", "neheb_minotaur_commander");
    other.slot = "player-1";
    other.board = { state: clone(D2.board), fingerprint: null };
    h.B._getGame().seats.set("White", other);
    await askAll(h, seat, [[0, "mull"]]);
    return askAll(h, other, [[0, "keep"]]);
  } });
  add({ name: "friendly: a timer's automatic answer carries the free cards", run: async (h) => {
    const seat = game(h, D2.board, { game: { friendly: 2, timer: { on: true, seconds: 90 } } });
    h.B.onPrompt(seat, { ...prompt("mulligan", { mulliganCount: 1 }), promptId: 960 }); await h.flush();
    h.B._timerExpired(seat, 960); await h.flush();
    h.B._stopTimer(seat, true);
    return { sent: JSON.stringify(h.effects.filter((e) => e.relay)).match(/"output":\{[^}]*\}/)?.[0] ?? null };
  } });
  add({ name: "friendly: a bridge restart between mulligans keeps the vote and the count", run: async (h) => {
    const file = process.env.MTG_RESUME_FILE;
    const seat = game(h, D2.board, { game: { friendly: 2, roomId: "r1", deckNames: new Set(), total: 2 } });
    await askAll(h, seat, [[0, "mull"]]);
    const saved = h.effects.filter((e) => e.writeFile).length;
    return { saved, count: seat.mullsTaken, resumed: await (async () => {
      const fsp = require("fs").promises;
      await fsp.writeFile(file, JSON.stringify({ savedAt: Date.now() - 3000, game: { bots: 1, total: 2, friendly: 2, friendlyOver: true, playerOrder: [], slotNames: {}, slotColor: {}, fromTable: true, deckNames: [] },
        seats: [{ color: "Blue", deckId: "neheb_minotaur_commander", username: "tts-Blue-abcd", slot: "player-0", roomId: "r1", mullsTaken: 1 }] }));
      h.B._setGame(null);
      const ok = h.B.resumeGame();
      const g = h.B._getGame();
      const st = g.seats.get("Blue");
      st.board = { state: clone(D2.board), fingerprint: null };
      const again = await askAll(h, st, [[1, "keep"]]);
      await fsp.unlink(file).catch(() => {});
      return { ok, friendly: g.friendly, over: g.friendlyOver, taken: st.mullsTaken, again };
    })() };
  } });
  add({ name: "friendly: Start reads the count and the game says so", run: async (h) => {
    const start = (m) => h.B.onTTS({ t: "start", seats: ["White", "Blue"], bots: 0, ...m });
    start({ friendly: 2 }); await h.flush();
    const g = h.B._getGame();
    const seat = g.seats.get("Blue"), other = g.seats.get("White");
    const mark = h.effects.length;
    seat.onRelay({ type: "GameStarted", player_order: [other.username, seat.username], game_id: "g1", starting_life: 40 });
    await h.flush();
    return { friendly: g.friendly, said: h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text || e.tts.msg).filter((t) => /friendly|mulligan/i.test(t)),
      log: h.effects.slice(mark).filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines) };
  } });
  add({ name: "friendly: a count of none says nothing at the start", run: async (h) => {
    h.B.onTTS({ t: "start", seats: ["White", "Blue"], bots: 0, friendly: 5 }); await h.flush();
    const g = h.B._getGame();
    const seat = g.seats.get("Blue"), other = g.seats.get("White");
    const mark = h.effects.length;
    seat.onRelay({ type: "GameStarted", player_order: [other.username, seat.username], game_id: "g1", starting_life: 40 });
    await h.flush();
    return { friendly: g.friendly, said: h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text || e.tts.msg).filter((t) => /friendly|mulligan/i.test(t)) };
  } });
  add({ name: "friendly: Start with a game running changes no count", run: async (h) => {
    const seat = game(h, D2.board, { game: { friendly: 1 }, seat: { roomId: "r1" } });
    h.B.onTTS({ t: "start", seats: ["Blue"], bots: 1, autoReset: true, friendly: 2 }); await h.flush();
    return { friendly: h.B._getGame().friendly, same: h.B._getGame().seats.get("Blue") === seat };
  } });
  add({ name: "friendly: the first turn ends them, said once", run: async (h) => {
    const board = (turn) => { const b = clone(D2.board); b.gameView.turn = turn; return b; };
    const seat = game(h, board(0), { game: { friendly: 1 } });
    const lines = () => h.effects.filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines).filter((l) => /Friendly/.test(l));
    const at = async (turn) => { seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: board(turn), fingerprint: `f${turn}` }); await h.flush(); return lines().length; };
    return { mulligans: await at(0), first: await at(1), second: await at(2), lines: lines() };
  } });
  add({ name: "friendly: no vote, no line on the first turn", run: async (h) => {
    const b = clone(D2.board); b.gameView.turn = 1;
    const seat = game(h, D2.board, { game: { friendly: 0 } });
    seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: b, fingerprint: "f1" }); await h.flush();
    return h.effects.filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines).filter((l) => /Friendly/.test(l));
  } });
}
// 2026-10-31: Saw in Half's tokens of a 2/2 are 1/1 with a base of 1/1: bp/bt carry the printed numbers, so the table's
// badge shows. Without printed numbers (a printed *, a copy Forge sends none for) there is no base: null, and the badge
// always shows (live 2026-11-08: an X/X token's base 6 hid its 6/6)
add({ name: "table: bp/bt are the printed numbers", run: async (h) => {
  const s = clone(D2.board);
  const bf = s.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
  const set = (id, f) => Object.assign(bf.cards.find((c) => c.id === id), f);
  set("engine-card-22", { power: "1", toughness: "1", basePower: 1, baseToughness: 1, printedPower: 2, printedToughness: 2, isCopy: true });
  set("engine-card-64", { power: "1", toughness: "1", basePower: 1, baseToughness: 1 });
  game(h, s);
  h.B.sendTable(); await h.flush();
  const sent = h.effects.filter((e) => e.tts && e.tts.t === "table").map((e) => e.tts);
  const stat = (id) => { for (const t of sent) { const st = t.cards?.[id]; if (st) return [st.bp, st.bt]; } return "not sent"; };
  return { printed: stat("engine-card-22"), none: stat("engine-card-64") };
} });
// ── Start from the table button: a leftover game is reset first; a restarting room is waited for ──
add({ name: "start (button): a leftover game is reset, the room restarted, then the game set up", run: async (h) => {
  game(h, D2.board); // the last game, still set up
  h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, requireReady: false, fromTable: true, autoReset: true }) });
  await h.flush();
  return { set: !!h.B._getGame(), seats: h.B._getGame() ? [...h.B._getGame().seats.keys()] : null };
} });
// (2026-10-23) the last game is over (won, or aborted by the relay): the room is back in its lobby, so no restart
for (const how of ["game over", "aborted"]) add({ name: `start (button) after ${how}: a finished game: no room restart`, run: async (h) => {
  const b = clone(D2.board); if (how === "game over") b.gameView.gameOver = true;
  game(h, b, how === "aborted" ? { game: { abortSaid: true } } : {});
  h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, requireReady: false, fromTable: true, autoReset: true }) });
  await h.flush();
  return { set: !!h.B._getGame(), restarted: h.effects.some((e) => e.execFile && e.execFile.includes("restart")) };
} });
// (2026-10-23) Start while the engine still has the game (the table was reloaded, or TTS closed): it comes back on the
// table, nothing is reset or restarted
add({ name: "start (button) while a game runs in the engine: a running game comes back", run: async (h) => {
  const seat = game(h, D2.board);
  seat.roomId = "room-1";
  h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, requireReady: false, fromTable: true, autoReset: true }) });
  await h.flush();
  return { same: h.B._getGame()?.seats.get("Blue") === seat, started: h.effects.some((e) => e.tts?.t === "started"),
    restarted: h.effects.some((e) => e.execFile && e.execFile.includes("restart")) };
} });
add({ name: "start (typed, no autoReset) with a game set up is refused as before", run: async (h) => {
  game(h, D2.board);
  h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, requireReady: false, fromTable: true }) });
  await h.flush();
  return null;
} });
add({ name: "start: the room isn't open yet (just restarted): asked for again every 2 s, then a clear message", run: async (h) => {
  h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, requireReady: false, fromTable: true }) });
  await h.flush(5);
  const seat = h.B._getGame().seats.get("Blue");
  const ws = h.sockets.at(-1);
  for (let k = 0; k < 17; k++) { ws.emit("message", JSON.stringify({ type: "RoomList", rooms: [] })); await h.flush(1); }
  return { lists: h.effects.filter((e) => e.relay && e.relay.type === "ListRooms").length, roomId: seat.roomId ?? null };
} });
// ── relay link recovery (reconnect, 2026-10-20) ──
const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));
// 2026-10-22: Forge crashes writing the result of a loss by drawing from an empty library; the relay says "aborted"
// (the evidence, verify 2026-11-09: the board came in with the library empty in the player's own draw step, noteOuts;
// since the suite review of 2026-11-09, only when an earlier board showed it empty before that draw step: one first
// seen empty in the draw step may be that draw's last card, drawn. This case's single board is no longer enough, the
// next one has the upkeep before it)
add({ name: "aborted: an empty library seen before the draw step is named as the reason, once", run: async (h) => {
  const board = clone(D2.board);
  for (const z of board.gameView.zones) if (z.zone === "library" && z.ownerId === "player-0") { z.count = 0; z.cards = []; }
  Object.assign(board.gameView, { step: "upkeep", activePlayerId: "player-0" });
  const seat = game(h, board);
  seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(board), fingerprint: "f-empty-upkeep" }); await h.flush();
  const draw = clone(board);
  draw.gameView.step = "draw";
  seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(draw), fingerprint: "f-empty" }); await h.flush();
  const ws = h.sockets.at(-1);
  frame(ws, { type: "GameAborted" });
  frame(ws, { type: "GameAborted" });
  await h.flush();
  return null;
} });
add({ name: "aborted: an empty library first seen in the draw step names no reason", run: async (h) => {
  const board = clone(D2.board);
  for (const z of board.gameView.zones) if (z.zone === "library" && z.ownerId === "player-0") { z.count = 0; z.cards = []; }
  Object.assign(board.gameView, { step: "draw", activePlayerId: "player-0" });
  const seat = game(h, board);
  seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(board), fingerprint: "f-empty" }); await h.flush();
  const ws = h.sockets.at(-1);
  frame(ws, { type: "GameAborted" });
  frame(ws, { type: "GameAborted" });
  await h.flush();
  return null;
} });
// 2026-10-27: a game won by poison (Blightsteel) ended with "White had to draw from an empty library": the loser's
// poison or life is the reason, whoever's library is empty
for (const [label, set] of [["12 poison", (p) => { p.counters = { ...(p.counters || {}), POISON: 12 }; }], ["life -3", (p) => { p.life = -3; }],
  ["21 commander damage", (p) => { p.commanderDamage = { "engine-card-199": 21 }; }]]) {
  add({ name: `aborted: a player at ${label} is named, not an empty library`, run: async (h) => {
    const board = clone(D2.board);
    for (const z of board.gameView.zones) if (z.zone === "library" && z.ownerId === "player-0") { z.count = 0; z.cards = []; }
    set(board.gameView.players.find((p) => p.id === "player-1"));
    game(h, board);
    frame(h.sockets.at(-1), { type: "GameAborted" });
    await h.flush();
    return null;
  } });
}
// the normal game over says why too (it said only "Game over.")
{
  const over = clone(D2.board);
  over.gameView.players.find((p) => p.id === "player-1").counters = { POISON: 10 };
  add(promptCase("game over: the loser's reason is said", over, prompt("gameOver", {}), []));
  add(promptCase("game over: no reason known, just game over", D2.board, prompt("gameOver", {}), []));
  // (hp-15 gap: said once in the game log, though the game-over question comes again)
  add({ name: "game over: in the game log once", run: async (h) => {
    const logLines = (hh) => hh.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
    const seat = game(h, over);
    seat.board = { state: over, fingerprint: null }; h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, { ...prompt("gameOver", {}), promptId: 980 }); await h.flush();
    h.B.onPrompt(seat, { ...prompt("gameOver", {}), promptId: 981 }); await h.flush();
    return logLines(h).slice(mark);
  } });
}
add({ name: "aborted: otherwise just aborted", run: async (h) => {
  game(h, D2.board);
  frame(h.sockets.at(-1), { type: "GameAborted" });
  await h.flush();
  return null;
} });
add({ name: "reconnect: a link that drops mid-game is reconnected, logged in again and resynced", run: async (h) => {
  const seat = game(h, D2.board, { seat: { roomId: "room-1" } }); // (a kept session needs no JoinRoom)
  const first = h.sockets.at(-1);
  first.emit("open"); // logs in, starts the heartbeat
  h.B.onPrompt(seat, prompt("chooseBoolean", { presentation: { title: "Draw a card?" } })); await h.flush(1);
  first.emit("close");
  h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["yes"] }) }); // while down
  await h.flush(); // the reconnect 1 s later opens a new socket
  const second = h.sockets.at(-1);
  second.emit("open");
  frame(second, { type: "AuthResult", success: true, reconnected: true });
  frame(first, { type: "StateUpdate", state: { kind: "prompt", forPlayer: "player-0", prompt: prompt("chooseBoolean", { presentation: { title: "late" } }) } }); // the old socket: ignored
  // (one timer at a time: a full flush would also run the new link's heartbeat into a timeout)
  // run timers in time order until a new socket appears or 1.5 s have passed; returns ms to the new socket or null
  const nextSocketWithin = async () => {
    const n = h.sockets.length, t0 = Date.now();
    for (let k = 0; k < 30 && h.sockets.length === n && Date.now() - t0 < 1500; k++) await h.flush(1);
    return h.sockets.length > n ? Date.now() - t0 : null;
  };
  first.emit("close"); // the old socket closing late starts no second reconnect
  const afterLateClose = await nextSocketWithin();
  second.emit("close"); // a second drop starts over at 1 s (the retry count was reset by the reconnect)
  const retryAfterMs = await nextSocketWithin();
  seat.close();
  await h.flush();
  return { afterLateClose, secondDropSockets: h.sockets.length, retryAfterMs, sameSocket: h.sockets.at(-1) === seat.ws, lostAt: seat.lostAt };
} });
// crash recovery: a game saved a few seconds ago is rejoined at startup as a reconnect (same username, slot, room:
// AuthResult reconnected -> RequestResync); one saved too long ago (the relay has given the seat away) is dropped
add({ name: "crash recovery: a bridge restarted mid-game rejoins it", run: async (h) => {
  const fs = require("fs");
  const file = process.env.MTG_RESUME_FILE;
  const snap = (savedAt) => JSON.stringify({ savedAt, game: { bots: 1, total: 2, playerOrder: ["ai", "tts-Blue-abcd"], slotNames: { "player-0": "AI 1", "player-1": "Blue" },
    slotColor: { "player-0": "White", "player-1": "Blue" }, fromTable: true, roomId: "room-9", deckNames: ["Forest"],
      turnOwners: { 1: "player-0", 2: "player-1", 3: "player-0" } },
    seats: [{ color: "Blue", deckId: "neheb_minotaur_commander", username: "tts-Blue-abcd", slot: "player-1", roomId: "room-9" }] });
  await fs.promises.writeFile(file, snap(Date.now() - 120000));
  const old = h.B.resumeGame();
  await fs.promises.writeFile(file, snap(Date.now() - 6000));
  const resumed = h.B.resumeGame();
  const g = h.B._getGame();
  const seat = g.seats.get("Blue");
  const sock = h.sockets.at(-1);
  sock.emit("open");
  frame(sock, { type: "AuthResult", success: true, reconnected: true });
  await h.flush(1);
  const relay = h.effects.filter((e) => e.relay).map((e) => e.relay);
  const sent = relay.map((x) => x.type);
  const login = relay.find((x) => x.type === "Authenticate") || {};
  // (2026-10-23) and the table gets the game again by itself: it sends no new "hello" when only the bridge restarted
  await h.flush();
  const redrawn = h.effects.some((e) => e.tts?.t === "started");
  seat.close();
  await fs.promises.unlink(file).catch(() => {});
  return { old, resumed, started: g.started, slot: seat.slot, room: seat.roomId, names: g.slotNames, sent, username: login.username, turnOwners: g.turnOwners, redrawn };
} });
add({ name: "reconnect: after a relay restart the seat is retaken with JoinRoom before the resync", run: async (h) => {
  const seat = game(h, D2.board, { seat: { roomId: "room-1" } });
  h.sockets.at(-1).emit("close");
  await h.flush();
  const s2 = h.sockets.at(-1);
  s2.emit("open");
  frame(s2, { type: "AuthResult", success: true, reconnected: false });
  // the node hasn't rebuilt the room yet: the rejoin is refused, then tried again 2 s later
  frame(s2, { type: "Error", code: "room_not_found", message: "Room not found" });
  frame(s2, { type: "Error", code: "game_not_in_progress", message: "no game" });
  const t0 = Date.now();
  // still refused 30 s in (the node is slow to come back): still inside the window, so tried again
  setTimeout(() => frame(s2, { type: "Error", code: "room_not_found", message: "Room not found" }), 30000);
  // run timers one at a time to just past the retry 2 s after it (pings at 20 s and 40 s come in between)
  for (let k = 0; k < 60 && Date.now() - t0 < 32000; k++) await h.flush(1);
  frame(s2, { type: "StateUpdate", state: { kind: "log", entry: {} } }); // back in the room
  frame(s2, { type: "Error", code: "room_not_found", message: "Room not found" }); // later: a real error again
  seat.close();
  await h.flush();
  return null;
} });
add({ name: "reconnect: retries 1, 2, 4, 8, 8... s and gives up inside the relay's 60 s window", run: async (h) => {
  const seat = game(h, D2.board);
  for (let k = 0; k < 20; k++) {
    const s = h.sockets.at(-1);
    if (!s.closedOnce) { s.closedOnce = true; h.effects.push({ relayDownAt: Date.now() - 1792500000000 }); s.emit("close"); }
    await h.flush(1);
  }
  return { sockets: h.sockets.length, lostAt: seat.lostAt };
} });
add({ name: "reconnect: a refused login while reconnecting is retried", run: async (h) => {
  const seat = game(h, D2.board);
  h.sockets.at(-1).emit("close"); await h.flush();
  const s2 = h.sockets.at(-1);
  s2.emit("open");
  frame(s2, { type: "AuthResult", success: false, error: "Username already taken" });
  await h.flush();
  const s3 = h.sockets.at(-1);
  s3.emit("open");
  frame(s3, { type: "AuthResult", success: true, reconnected: true });
  seat.close();
  await h.flush();
  return { sockets: h.sockets.length };
} });
// 2026-10-22 playtest: Command Tower's "Choose a color" while paying {1}{B} lists Black first, marked; not paying, as
// Forge gives them; a "Choose a color" after another question forgets the cost
add({ name: "colour while paying: the needed one first, marked", run: async (h) => {
  const seat = game(h, D2.board);
  h.B.onPrompt(seat, prompt("payManaCost", { manaCost: "{1}{B}", cardId: "engine-card-43", cardName: "Dark Confidant", actions: [], presentation: { title: "Pay {1}{B} for Dark Confidant" } }));
  await h.flush();
  h.B.onPrompt(seat, { ...prompt("chooseColor", { validColors: ["White", "Blue", "Black", "Red", "Green"], amount: 1, presentation: { title: "Choose a color" } }), promptId: 901, sourceCard: H(77) });
  await h.flush();
  const paying = seat.prompt.ui;
  h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { title: "Draw a card?" } }), promptId: 902 });
  await h.flush();
  h.B.onPrompt(seat, { ...prompt("chooseColor", { validColors: ["White", "Blue", "Black", "Red", "Green"], amount: 1, presentation: { title: "Choose a color" } }), promptId: 903 });
  await h.flush();
  return { paying, after: seat.prompt.ui };
} });
add({ name: "colour while paying a hybrid cost: both halves first", run: async (h) => {
  const seat = game(h, D2.board);
  h.B.onPrompt(seat, prompt("payManaCost", { manaCost: "{2}{R/G}", cardId: "engine-card-43", cardName: "X", actions: [], presentation: { title: "Pay {2}{R/G} for X" } }));
  await h.flush();
  h.B.onPrompt(seat, { ...prompt("chooseColor", { validColors: ["White", "Blue", "Black", "Red", "Green"], amount: 1, presentation: { title: "Choose a color" } }), promptId: 901 });
  await h.flush();
  return seat.prompt.ui.options;
} });
add(promptCase("plain title: triggered ability", D2.board, prompt("chooseBoolean", { presentation: { title: "Use triggered ability of Pestilence?" } }, { sourceCard: H(77), sourceAbilityText: "At the beginning of the end step, if no creatures are on the battlefield, sacrifice Pestilence. {B}: Pestilence deals 1 damage to each creature and each player. Activate only as a sorcery, and only once each turn." }), [["yes"]]));
add(promptCase("plain title: replacement effect, its text moves below", D2.board, prompt("chooseBoolean", { presentation: { title: "Apply replacement effect of Pestilence?\r\nIf you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in any order." } }, { sourceCard: H(77), sourceAbilityText: "If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in any order." }), [["no"]]));
add(promptCase("plain title: shuffle", D2.board, prompt("chooseBoolean", { presentation: { title: "Do you want to shuffle the library?" } }, { sourceCard: H(77) }), [["no"]]));
add(promptCase("plain title: a range of 1 to 3, and 2 exactly", D2.board, prompt("chooseCards", { min: 1, max: 3, cards: [H(43), H(35), H(75)], presentation: { title: "Exile" } }), [["engine-card-43"]]));
add(promptCase("plain title: 2 exactly", D2.board, prompt("chooseCards", { min: 2, max: 2, cards: [H(43), H(35), H(75)], presentation: { title: "Discard" } }), [["engine-card-43", "engine-card-35"]]));
// 2026-10-22 ease-of-use pass: Forge's wording in Arena's words (one case per shape the hand-play sweeps met)
add(promptCase("arena words: a player target", D2.board, prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, cancellable: false, candidates: [{ kind: "player", id: "player-0" }, { kind: "player", id: "player-1" }], presentation: { title: "Choose player to heal" } }, { sourceCard: H(77) }), [["player|player-0"]]));
add(promptCase("arena words: a hint title with two targets", D2.board, prompt("chooseBoardTargets", { minTargets: 0, maxTargets: 2, cancellable: true, candidates: [{ kind: "card", id: "engine-card-35" }, { kind: "card", id: "engine-card-75" }], presentation: { title: "Hostile" } }, { sourceCard: H(77) }), [["card|engine-card-35"]]));
add(promptCase("arena words: a sentence title stays", D2.board, prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, cancellable: false, candidates: [{ kind: "card", id: "engine-card-35" }], presentation: { title: "Choose target creature you control" } }, { sourceCard: H(77) }), [["card|engine-card-35"]]));
add(promptCase("arena words: counter kinds", D2.board, prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "P1P1" }, { label: "BURDEN" }], presentation: { title: "Pestilence" } }, { sourceCard: H(77) }), [["0"]]));
add(promptCase("arena words: choose one", D2.board, prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "Land" }, { label: "Nonland" }], presentation: { title: "Pestilence" } }, { sourceCard: H(77) }), [["1"]]));
add(promptCase("arena words: kicker, any you want", D2.board, prompt("chooseFromSelection", { minTotal: 0, maxTotal: 1, options: [{ label: "Kicker – {1}{C}" }], presentation: { title: "Pestilence" } }, { sourceCard: H(77) }), [["0"]]));
add(promptCase("arena words: Forge's keyword title", D2.board, prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "Flying" }, { label: "Lifelink" }], presentation: { title: "Choose a Choose keyword to grant" } }), [["0"]]));
add(promptCase("arena words: stop searching", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Cancel Search? Up to 2 more card(s) can be selected." } }), [["no"]]));
add(promptCase("arena words: commander to the command zone", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "If a commander is in a graveyard or in exile and that card was put there this turn, its owner may put it into the command zone." } }, { sourceCard: H(77) }), [["yes"]]));
add(promptCase("arena words: pay life", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Pay 1 life" } }, { sourceCard: H(77) }), [["yes"]]));
add(promptCase("arena words: a cost that isn't mana", D2.board, prompt("chooseBoolean", { confirmLabel: "Pay", denyLabel: "Decline", presentation: { title: "Pay Put a +1/+1 counter on CARDNAME?" } }, { sourceCard: H(77) }), [["yes"]]));
add(promptCase("arena words: sacrifice this token", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Sacrifice this token" } }), [["no"]]));
add(promptCase("arena words: cast it for free", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Do you want to play Vraska's Fall?" } }), [["yes"]]));
add(promptCase("arena words: draw a card, double space", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Do you want to draw a  card?" } }), [["yes"]]));
add(promptCase("arena words: Forge's lower-case question", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Draw two Cards" } }, { sourceCard: H(77) }), [["yes"]]));
add(promptCase("arena words: your own library, not player-view-0", D2.board, prompt("revealCards", { presentation: { title: "Look at these cards" }, ownerPlayerId: "player-view-0", zone: "library", cards: [H(43)] }), [["ok"]]));
add(promptCase("arena words: player-view in any text", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Do you want player-view-1 to gain control of Pestilence?" } }), [["no"]]));
add(promptCase("arena words: search your graveyard and exile", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Search your graveyard and exile?" } }, { sourceCard: H(77) }), [["yes"]]));
// Done with fewer cards than allowed, then Forge's "Cancel Search?": Done meant stop (answered without asking); from
// another card, or not right after, it is still asked
add({ name: "arena words: Cancel Search after Done is answered", run: async (h) => {
  const seat = game(h, D2.board);
  const cardsP = { ...prompt("chooseCards", { min: 0, max: 1, cards: [H(43), H(35)], presentation: { title: "Pestilence" } }), sourceCard: H(77) };
  const cancelP = (id, src) => ({ ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Cancel Search? Up to 1 more card(s) can be selected." } }), promptId: id, ...(src ? { sourceCard: src } : {}) });
  h.B.onPrompt(seat, cardsP); await h.flush();
  h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: [] }) }); await h.flush();
  h.B.onPrompt(seat, cancelP(901, H(77))); await h.flush();
  const after = seat.prompt ? seat.prompt.ui.title : null;
  h.B.onPrompt(seat, cancelP(902, H(77))); await h.flush(); // not right after a choice: asked
  const second = seat.prompt ? seat.prompt.ui.title : null;
  h.B.onPrompt(seat, { ...cardsP, promptId: 903 }); await h.flush();
  h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 903, choice: [] }) }); await h.flush();
  h.B.onPrompt(seat, cancelP(904, H(43))); await h.flush(); // another card asking: asked
  return { after, second, other: seat.prompt ? seat.prompt.ui.title : null };
} });
add(promptCase("arena words: a scry from a card gets no second heading", D2.board, prompt("scry", { zones: ["libraryTop", "libraryBottom"], cards: [H(43)], presentation: { title: "Scry" } }, { sourceCard: H(77) }), [["libraryBottom"]]));
add(promptCase("arena words: clash", D2.board, prompt("revealCards", { presentation: { title: "Blue reveals: Island. Mana Value= 0\nAI 1 reveals: Vraska's Fall. Mana Value= 4\nAI 1 wins!" }, ownerPlayerId: "player-view-0", zone: "library", cards: [H(43)] }, { sourceCard: H(77) }), [["ok"]]));
add(promptCase("arena words: clash, nobody wins", D2.board, prompt("revealCards", { presentation: { title: "Blue reveals: Island. Mana Value= 0\nAI 1 reveals: Island. Mana Value= 0\nNo Winner!" }, ownerPlayerId: "player-view-0", zone: "library", cards: [H(43)] }, { sourceCard: H(77) }), [["ok"]]));
add(promptCase("arena words: clash, top or bottom", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "put on top of library?" } }, { sourceCard: H(43) }), [["no"]]));
add(promptCase("arena words: cast for free or to hand", D2.board, prompt("chooseBoolean", { confirmLabel: "Cast", denyLabel: "Hand", presentation: { title: "Cast Vraska's Fall without paying its mana cost or put it into your hand?" } }), [["yes"]]));
add(promptCase("arena words: sacrifice this token names it", D2.board, prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Sacrifice this token" } }, { sourceCard: H(77) }), [["yes"]]));
add(promptCase("arena words: a payment without a card name", D2.board, prompt("payManaCost", { manaCost: "{3}", cardName: "", cardId: "engine-card-77", actions: [], presentation: { title: "Pay {3}" } }, { sourceCard: H(77) }), []));
add(promptCase("forced: one kind of counter is chosen without asking", D2.board, prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "P1P1" }], presentation: { title: "Pestilence" } }, { sourceCard: H(77) }), []));
add(promptCase("forced: one optional mode is still asked", D2.board, prompt("chooseFromSelection", { minTotal: 0, maxTotal: 1, options: [{ label: "Kicker – {2}" }], presentation: { title: "Pestilence" } }, { sourceCard: H(77) }), [["0"]]));
add(promptCase("forced: one colour is chosen without asking", D2.board, prompt("chooseColor", { validColors: ["Green"], amount: 1 }), []));
add(promptCase("arena words: offspring is a yes/no", D2.board, prompt("chooseNumber", { min: 0, max: 1, presentation: { title: "pay for Offspring? {2}" } }, { sourceCard: H(77) }), [["1"]]));
add(promptCase("arena words: multikicker says how many times, no endless Max", D2.board, prompt("chooseNumber", { min: 0, max: 2147483647, presentation: { title: "choose Amount for Multikicker: {2}" } }, { sourceCard: H(77) }), [["3"]]));
add(promptCase("arena words: casualty is a yes/no with its cost", D2.board, prompt("chooseNumber", { min: 0, max: 1, presentation: { title: "pay for Casualty? Sacrifice a creature with power 2 or greater" } }, { sourceCard: H(77) }), [["0"]]));
add(promptCase("arena words: a notice without cards goes to chat, not a question", D2.board, prompt("revealCards", { presentation: { title: "Blue picked AI 1" }, ownerPlayerId: "player-view-0", zone: "library", cards: [] }, { sourceCard: H(77) }), []));
add(promptCase("arena words: mode labels trimmed", D2.board, prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: " Sacrifice Pestilence." }, { label: " Pay {1}." }], presentation: { title: "Pestilence" } }, { sourceCard: H(77) }), [["1"]]));
add(promptCase("arena words: ward says what the payment is for", D2.board, prompt("chooseBoolean", { confirmLabel: "Pay {2}", denyLabel: "No", presentation: { title: "Pay {2}?" } }, { sourceCard: H(43), sourceAbilityText: "Ward {2} (Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)" }), [["yes"]]));
add(promptCase("arena words: a mode without its reminder text", D2.board, prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "Arrest — Detain target creature an opponent controls. (Until your next turn, that creature can't attack or block.)" }, { label: "Tax — Spells cost {1} more." }], presentation: { title: "Pestilence" } }, { sourceCard: H(77) }), [["0"]]));
add(promptCase("arena words: a vote notice in plain words", D2.board, prompt("revealCards", { presentation: { title: "AI 1 vote Vraska's Fall (141)\nCurrent Votes:{Vraska's Fall (141)=[Blue, AI 1]}" }, cards: [] }, { sourceCard: H(77) }), []));
add(promptCase("arena words: X for a card that says X", D2.board, prompt("chooseNumber", { min: 0, max: 3, presentation: { title: "Choose a value for X" } }, { sourceCard: H(77), sourceAbilityText: "Search your library for a creature card with mana value X or less." }), [["1"]]));
add(promptCase("arena words: a payment's No reads Don't pay", D2.board, prompt("chooseBoolean", { confirmLabel: "Pay {1}", denyLabel: "No", presentation: { title: "Pay {1}?" } }, { sourceCard: H(77) }), [["no"]]));
add(promptCase("arena words: a range from Forge reads up to", D2.board, prompt("chooseCards", { min: 0, max: 1, cards: [H(43), H(35)], presentation: { title: "Put into your hand" } }), [["engine-card-43"]]));
add({ name: "arena words: clash, you win (the engine names you by username)", run: async (h) => {
  const seat = game(h, D2.board);
  h.B.onPrompt(seat, prompt("revealCards", { presentation: { title: `${seat.username} reveals: Island. Mana Value= 3\nAI 1 reveals: Island. Mana Value= 0\n${seat.username} wins clash!` }, ownerPlayerId: "player-view-0", zone: "library", cards: [H(43)] }, { sourceCard: H(77) }));
  await h.flush();
  return seat.prompt.ui.text;
} });
add(promptCase("arena words: a number for a card", D2.board, prompt("chooseNumber", { min: 0, max: 5, presentation: { title: "Choose a value for Pestilence" } }, { sourceCard: H(77) }), [["2"]]));
add(promptCase("arena words: CARDNAME in a mode", D2.board, prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "Teamwork – Tap creatures other than CARDNAME" }, { label: "Smash" }], presentation: { title: "HULK SMASH!" } }, { sourceCard: H(77) }), [["0"]]));
add({ name: "reconnect: a silent link (nothing heard for 45 s) is closed and reconnected", run: async (h) => {
  const seat = game(h, D2.board);
  h.sockets.at(-1).emit("open");
  await h.flush(); // pings at 20 s and 40 s, dead at 60 s, reconnect 1 s later (the new socket never opens)
  h.sockets[0].emit("close"); // the dead socket's own close event arrives later: no second reconnect
  await h.flush();
  const n = h.sockets.length;
  seat.close();
  await h.flush();
  return { sockets: n };
} });
add({ name: "reconnect: frames keep a link alive; mtg reset (close) and a drop before the game never reconnect", run: async (h) => {
  const seat = game(h, D2.board);
  const ws = h.sockets.at(-1);
  ws.emit("open");
  for (let k = 0; k < 4; k++) { await h.flush(1); frame(ws, { type: "Pong" }); } // heard every 20 s: never silent
  const alive = h.sockets.length;
  seat.close();
  ws.emit("close");
  await h.flush();
  const afterReset = h.sockets.length;
  const s2 = game(h, D2.board, { game: { started: false } });
  s2.slot = null;
  h.sockets.at(-1).emit("close");
  await h.flush();
  return { alive, afterReset, beforeGame: h.sockets.length };
} });
add({ name: "bad json from TTS is logged", run: async (h) => { h.B.onTTS({ t: "answer", json: "{not json" }); await h.flush(); return null; } });

// ── stage 3 review 2026-10-27 (jr-programmer-suite on the hp-07 changes) ──
{
  const moved = (board, id, to) => {
    const b = clone(board);
    let card = null;
    for (const z of b.gameView.zones) { const i = (z.cards || []).findIndex((c) => c.id === id); if (i >= 0) card = z.cards.splice(i, 1)[0]; }
    if (card) { card.types = card.types || ["Creature"]; b.gameView.zones.find((z) => z.zone === to && z.ownerId === "player-0").cards.push(card); }
    return b;
  };
  const logLines = (h) => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
  const boardAs = async (h, seat, b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
  const answer = async (h, promptId, choice) => { h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId, choice }) }); await h.flush(); };
  const sent = (h) => h.effects.map((e) => e.relay).filter((r) => r && r.state?.kind === "response").map((r) => r.state.action.output);
  const asLand = (b) => { for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-74") c.types = ["Land"]; return b; };
  // (hp-06 #13: a foretell is logged without the card's name; another ability from the hand keeps its line)
  for (const label of ["Foretell (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)", "Channel — {1}{G}, Discard Hurloon Minotaur: Draw a card.",
    "Hurloon Minotaur: Suspend 2—{1}{B} (If you could begin to cast this card by putting it onto the stack from your hand, you may pay {1}{B} and exile it with two time counters on it.)",
    "Hurloon Minotaur: Unearth {R} ({R}: Return this card from your graveyard to the battlefield. It gains haste.)",
    "Hurloon Minotaur: Crew 1 (Tap any number of creatures you control with total power 1 or more: Hurloon Minotaur becomes an artifact creature until end of turn.)",
    // (hp-10: Saddle as crew: "saddles")
    "Hurloon Minotaur: Saddle 1 (Tap any number of other creatures you control with total power 1 or more: This Mount becomes saddled until end of turn. Saddle only as a sorcery.)",
    // (hp-10: a megamorph turn says nothing here: "is turned face up" says it)
    "Hurloon Minotaur: Megamorph {U} (Turn this face up any time for its morph cost.)",
    // (hp-11: Level up: "levels up")
    "Hurloon Minotaur: Level up {1}{G} ({1}{G}: Put a level counter on this. Level up only as a sorcery.)",
    // (hp-16 gap: Embalm, as the priority question offers it live: "embalms"; Eternalize the same)
    "Hurloon Minotaur: Embalm {3}{U}{U} ({3}{U}{U}, Exile this card from your graveyard: Create a token that's a copy of this card, except it's white, it has no mana cost, and it's a Zombie in addition to its other types. Embalm only as a sorcery.)",
    "Hurloon Minotaur: Eternalize {4}{B}{B} ({4}{B}{B}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie with no mana cost. Eternalize only as a sorcery.)",
    // (hp-17 gap: Renew and Scavenge, as the priority question offers them live: "renews", "scavenges")
    "Hurloon Minotaur: Renew — {2}{B}, Exile Hurloon Minotaur from your graveyard: Put a flying counter, a deathtouch counter, and a lifelink counter on target creature. Activate only as a sorcery.",
    "Hurloon Minotaur: Scavenge {4}{B} ({4}{B}, Exile this card from your graveyard: Put a number of +1/+1 counters equal to this card's power on target creature. Scavenge only as a sorcery.)",
    // (hp-18 gap: cycling and landcycling, as the priority question offers them live: "cycles")
    "Hurloon Minotaur: Plainscycling {1} ({1}, Discard this card: Search your library for a Plains card, reveal it, put it into your hand, then shuffle.)",
    "Hurloon Minotaur: Cycling {2} ({2}, Discard this card: Draw a card.)",
    // (hp-18 gap: Bloodrush, as the priority question offers it live: "bloodrushes")
    "Hurloon Minotaur: Bloodrush — {G}, Discard Hurloon Minotaur: Target attacking creature gets +1/+2 and gains deathtouch until end of turn.",
    // (hp-19 gap: Forecast, as the priority question offers it live: "forecasts")
    "Hurloon Minotaur: Forecast — {2}{U}, Reveal Hurloon Minotaur from your hand: Each player draws a card. (Activate only during your upkeep and only once each turn.)"]) {
    add({ name: `log: ${label.match(/Foretell|Channel|Suspend|Unearth|Crew|Saddle|Megamorph|Level up|Embalm|Eternalize|Renew|Scavenge|Plainscycling|Cycling|Bloodrush|Forecast/)[0]} from the hand`, run: async (h) => {
      const seat = game(h, myMain(D2.board));
      h.B.sendTable(); await h.flush();
      const mark = logLines(h).length;
      h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-x", type: "activateAbility", cardId: "engine-card-75", label, description: label, mode: { type: "normal" } }] })); await h.flush();
      await answer(h, 900, ["a-x"]);
      h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: [{ id: "pass", type: "pass", label: "Pass priority" }] }), promptId: 901 }); await h.flush();
      await boardAs(h, seat, myMain(D2.board));
      return logLines(h).slice(mark);
    } });
  }
  // (hp-02 #1 #3: an adventure resolving puts the card on an adventure; the creature cast from exile enters)
  add({ name: "log: an adventure, then the creature cast from exile", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    const withStomp = myMain(D2.board);
    withStomp.gameView.stack = [{ id: "engine-stack-90", sourceId: "engine-card-75", controllerId: "player-0", identity: { name: "Stomp" }, text: "Stomp deals 2 damage to any target." }];
    await boardAs(h, seat, withStomp);
    const mark = logLines(h).length;
    const exiled = moved(myMain(D2.board), "engine-card-75", "exile");
    await boardAs(h, seat, exiled);
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-cast", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "normal" } }] })); await h.flush();
    await answer(h, 900, ["a-cast"]);
    await boardAs(h, seat, moved(exiled, "engine-card-75", "battlefield"));
    return logLines(h).slice(mark);
  } });
  // (hp-17: a card whose ability its owner used from the hand, then in the graveyard with the hand level (the search's
  // card came in): discarded as the cost; with no such ability used, the neutral line)
  for (const used of [true, false]) {
    add({ name: `log: a card discarded for its own ability (${used ? "used" : "not used"})`, run: async (h) => {
      const seat = game(h, myMain(D2.board));
      h.B.sendTable(); await h.flush();
      const mark = logLines(h).length;
      if (used) {
        h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-tm", type: "activateAbility", cardId: "engine-card-43", label: "Transmute {1}{U}{U}", description: "Transmute {1}{U}{U}", mode: { type: "normal" } }] })); await h.flush();
        await answer(h, 900, ["a-tm"]);
      }
      let b = moved(myMain(D2.board), "engine-card-43", "graveyard");
      for (const z of b.gameView.zones) if (z.ownerId === "player-0" && z.zone === "hand") z.count = (z.count ?? z.cards.length) + 1;
      for (const z of b.gameView.zones) if (z.ownerId === "player-0" && z.zone === "library") z.count = (z.count ?? 30) - 1;
      await boardAs(h, seat, b);
      return { lines: logLines(h).slice(mark) };
    } });
  }
  // (hp-18: a card with phasing gone from the view phases out, and back phases in; a card without it, gone, leaves)
  add({ name: "log: phasing out and in", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    const start = myMain(D2.board);
    const bfz = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
    bfz(start).cards.push({ id: "engine-card-959", identity: { name: "Taniwha" }, types: ["Creature"], keywords: ["Trample", "Phasing"], ownerId: "player-0", controllerId: "player-0", text: "" },
      { id: "engine-card-958", identity: { name: "Grizzly Bears" }, types: ["Creature"], keywords: [], ownerId: "player-0", controllerId: "player-0", text: "" });
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    // (Forge sends a phased-out card flagged, where it was; a card that really left is gone from the list)
    const out = clone(start); bfz(out).cards = bfz(out).cards.filter((c) => c.id !== "engine-card-958");
    bfz(out).cards.find((c) => c.id === "engine-card-959").phasedOut = true;
    await boardAs(h, seat, out);
    await boardAs(h, seat, start);
    return { lines: logLines(h).slice(mark) };
  } });
  // (hp-18 gap: Taniwha's upkeep trigger, "all lands you control phase out", resolved: the lands gone from the view phase
  // out, and come back phasing in; the AI's land gone at the same time (no such trigger of its own) leaves)
  // (a phased-out card goes to the table flagged, face-down ones too; dragging one says why nothing happens)
  add({ name: "table: phased-out cards keep their place, flagged", run: async (h) => {
    const start = myMain(D2.board);
    const bfz = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
    bfz(start).cards.push({ id: "engine-card-961", identity: { name: "Grizzly Bears" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "", phasedOut: true, counters: { P1P1: 1 } },
      { id: "engine-card-962", identity: { name: "Grizzly Bears" }, isFaceDown: true, types: ["Creature"], power: 2, toughness: 2, ownerId: "player-0", controllerId: "player-0", text: "", phasedOut: true });
    const seat = game(h, start);
    await boardAs(h, seat, start);
    return { why: h.B.whyNot(seat, "engine-card-961") };
  } });
  // (table-map gaps, 2026-11-03: what Forge sends about a card or a player that the table showed nowhere.
  // Each case returns the last table update's words, card by card: kw = the status box, nt = hover and pile notes.)
  const zoneIn = (b, zn, o) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === o);
  // (a zone the last update left out, named in its keep list, is the one sent before)
  const said = (h) => {
    const zones = {};
    let last;
    for (const t of h.effects.map((e) => e.tts).filter((m) => m?.t === "table")) {
      last = t;
      for (const p of t.players) for (const z of ["battlefield", "graveyard", "exile"]) if (p[z]) zones[p.color + z] = p[z];
    }
    // (marks: the row's allMarks since trackMarks step 6, the old marks before)
    return (last?.players || []).map((p) => ({ color: p.color, marks: p.allMarks || null,
      cards: ["battlefield", "graveyard", "exile"].flatMap((z) => (zones[p.color + z] || []).filter((c) => c.kw || c.nt).map((c) => ({ z, id: c.id, kw: c.kw || null, nt: c.nt || null }))) }));
  };
  const gc = (id, name, o, more = {}) => ({ id, identity: { name }, types: ["Instant"], ownerId: o, controllerId: o, text: "", ...more });
  // flashback in a graveyard (printed, granted with Forge's cost, neither); madness, warp and plot in exile; counters
  // said in exile only (CR 122.2: a card that moved has none it had before, and Forge's leftover ones mean nothing)
  add({ name: "table: what a card in a graveyard or exile can still do", run: async (h) => {
    const b = myMain(D2.board);
    zoneIn(b, "graveyard", "player-0").cards.push(
      gc("engine-card-1201", "Faithless Looting", "player-0", { text: "Draw two cards, then discard two cards.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)", flashbackCost: "2 R" }),
      gc("engine-card-1202", "Lightning Bolt", "player-0", { flashbackCost: "1 U" }),
      gc("engine-card-1203", "Deep Analysis", "player-0", { text: "Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life.", flashbackCost: "1 U PayLife<3>" }),
      gc("engine-card-1204", "Opt", "player-0", { flashbackCost: "Discard<1/Card>" }),
      gc("engine-card-1206", "Think Twice", "player-0", { flashbackCost: "1 U PayLife<3>" }),
      gc("engine-card-1205", "Shock", "player-0", { counters: { Time: 2 }, isPlotted: true, isMadnessExiled: true }));
    zoneIn(b, "exile", "player-0").cards.push(
      gc("engine-card-1211", "Fiery Temper", "player-0", { text: "Fiery Temper deals 3 damage to any target.\nMadness {R} (If you discard this card, discard it into exile.)", isMadnessExiled: true, madnessCost: "R" }),
      gc("engine-card-1212", "Lightning Bolt", "player-0", { isMadnessExiled: true }),
      gc("engine-card-1213", "Starfield Shepherd", "player-0", { isWarpExiled: true }),
      gc("engine-card-1214", "Preordain", "player-0", { isPlotted: true }),
      gc("engine-card-1215", "Ancestral Vision", "player-0", { counters: { Time: 3, Void: 1, Fade: 0 } }),
      gc("engine-card-1216", "Ancestral Vision", "player-0", { counters: { Time: 1 } }),
      gc("engine-card-1217", "Opt", "player-0", { flashbackCost: "U" }));
    const seat = game(h, b);
    await boardAs(h, seat, b);
    return said(h);
  } });
  // a Saga's chapter and the next one, a Class's level and the next one's cost, Forge's combat sums, a stolen permanent
  add({ name: "table: sagas, classes, combat deaths and owners", run: async (h) => {
    const b = myMain(D2.board);
    b.gameView.step = "declareBlockers";
    const sagaCh = [{ chapters: [1], oracle: "Create a 1/1 white Soldier creature token." }, { chapters: [2, 3], oracle: "Put a +1/+1 counter on each creature you control.   It gains   flying until end of turn, and this sentence keeps on going well past ninety characters." }];
    const levels = [{ level: 1, oracle: "Creatures you control get +1/+0." }, { level: 2, oracle: "Draw a card.", cost: "{1}{W}" }, { level: 3, oracle: "Win.", cost: "{3}{W}" }];
    const bf = (id, name, more = {}) => ({ id, identity: { name }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "", ...more });
    zoneIn(b, "battlefield", "player-0").cards.push(
      bf("engine-card-1221", "History of Benalia", { types: ["Enchantment"], counters: { LORE: 1 }, finalChapter: 3, sagaChapters: sagaCh }),
      bf("engine-card-1222", "The Eldest Reborn", { types: ["Enchantment"], counters: { Lore: 3 }, finalChapter: 3, sagaChapters: sagaCh }),
      bf("engine-card-1223", "Urza's Saga", { types: ["Enchantment"], finalChapter: 3, sagaChapters: sagaCh }),
      bf("engine-card-1220", "Fall of the Thran", { types: ["Enchantment"], counters: { LORE: 2 }, finalChapter: 3, sagaChapters: sagaCh }),
      bf("engine-card-1224", "Barbarian Class", { types: ["Enchantment"], classLevel: 1, classLevels: levels }),
      bf("engine-card-1225", "Bard Class", { types: ["Enchantment"], classLevel: 3, classLevels: levels }),
      bf("engine-card-1226", "Grizzly Bears", { isAttacking: true, attackTargetId: "player-1", wouldDieInCombat: true }),
      bf("engine-card-1227", "Hill Giant", { isAttacking: true, attackTargetId: "player-1", wouldDieInCombat: false }),
      bf("engine-card-1228", "Elvish Mystic", { wouldDieInCombat: true }),
      bf("engine-card-1229", "Act of Treason's Bear", { ownerId: "player-1" }));
    zoneIn(b, "battlefield", "player-1").cards.push(
      { id: "engine-card-1231", identity: { name: "Wall of Stone" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "", wouldDieInCombat: true });
    zoneIn(b, "graveyard", "player-0").cards.push(gc("engine-card-1232", "Stolen Shock", "player-0", { ownerId: "player-1" }));
    b.gameView.combatAssignments = [{ blockerId: "engine-card-1231", attackerId: "engine-card-1226" }];
    const seat = game(h, b);
    await boardAs(h, seat, b);
    return said(h);
  } });
  // what a permanent chose, in words; a choice one seat's view lacks (made in secret) is said to nobody, as every
  // seat sees the same table
  add({ name: "table: choices are said only when every seat sees them", run: async (h) => {
    const b = myMain(D2.board);
    const ch = (id, name, choices) => ({ id, identity: { name }, types: ["Artifact"], ownerId: "player-0", controllerId: "player-0", text: "", choices });
    zoneIn(b, "battlefield", "player-0").cards.push(
      ch("engine-card-1241", "Caged Sun", [{ kind: "color", colors: ["R", "G"] }]),
      ch("engine-card-1240", "Painter's Servant", [{ kind: "color", colors: ["W", "U", "B", "C", "Q"] }]),
      ch("engine-card-1242", "Door of Destinies", [{ kind: "type", values: ["Elf"] }]),
      ch("engine-card-1243", "Pithing Needle", [{ kind: "namedCard", names: ["Sol Ring"] }]),
      ch("engine-card-1244", "Hidden Strings", [{ kind: "namedCard", names: ["Lightning Bolt"] }, { kind: "number", value: 0 }]),
      ch("engine-card-1245", "Siege-Gang Lieutenant", [{ kind: "mode", value: "Khans" }, { kind: "chosenCard", count: 1 }, { kind: "chosenCard", count: 2 }]),
      ch("engine-card-1246", "Curse of Opulence", [{ kind: "player", playerId: "player-1", name: "Engine Name" }, { kind: "player", playerId: "player-9", name: "Someone" }]),
      ch("engine-card-1247", "Oddity", [{ kind: "unknownKind", value: 3 }]));
    zoneIn(b, "graveyard", "player-0").cards.push(ch("engine-card-1248", "Gone Needle", [{ kind: "namedCard", names: ["Sol Ring"] }]));
    const seat = game(h, b);
    // a second person at the table (Red, player-1), whose view lacks Hidden Strings' named card and has its number
    const other = new h.B.Seat("Red", "neheb_minotaur_commander");
    other.slot = "player-1";
    const ob = clone(b);
    zoneIn(ob, "battlefield", "player-0").cards.find((c) => c.id === "engine-card-1244").choices = [{ kind: "number", value: 0 }];
    other.board = { state: ob, fingerprint: null };
    h.B._getGame().seats.set("Red", other);
    await boardAs(h, seat, b);
    const both = said(h);
    h.B._getGame().seats.delete("Red");
    Object.assign(h.B._getGame(), { lastTableSig: null, sentZones: {} });
    await boardAs(h, seat, b);
    return { both, alone: said(h) };
  } });
  // the player facts under a life total: counters, the Ring, speed, a turn someone else runs, an extra turn (while it is
  // theirs), prevention shields, hand size, and the player's keywords
  add({ name: "table: player marks", run: async (h) => {
    const b = myMain(D2.board);
    const [me, them] = b.gameView.players;
    Object.assign(me, { counters: { EXPERIENCE: 2, RADIATION: 3, TICKET: 0, poison: 1 }, ringLevel: 2, speed: 4, damagePrevention: 5, maxHandSize: 0,
      playerKeywords: ["Hexproof", "You can't lose the game.", "Protection:Player.Opponent:each of your opponents", "ETBReplacement:Other:Foo", "Your opponents can't cast spells during your turn and this is a long sentence."] });
    Object.assign(them, { counters: { experience: 1, radiation: 0 }, controlledBy: "player-0", isExtraTurn: true, unlimitedHandSize: true, maxHandSize: 3, ringLevel: 0, speed: 0, damagePrevention: 0 });
    const seat = game(h, b);
    await boardAs(h, seat, b);
    // (the whole label since trackMarks step 6: Blue's POISON 1 now leads it)
    const first = said(h).map((p) => p.marks);
    const theirs = clone(b); theirs.gameView.activePlayerId = "player-1";
    theirs.gameView.players[0].maxHandSize = 7;
    await boardAs(h, seat, theirs);
    return { first, theirTurn: said(h).map((p) => p.marks) };
  } });
  add({ name: "log: lands phased out by a trigger", run: async (h) => {
    const start = myMain(D2.board);
    const bfz = (b, o) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === o);
    const land = (id, name, o) => ({ id, identity: { name }, types: ["Land"], ownerId: o, controllerId: o, text: "" });
    bfz(start, "player-0").cards.push(land("engine-card-971", "Mountain", "player-0"), land("engine-card-972", "Forest", "player-0"));
    bfz(start, "player-1").cards.push(land("engine-card-973", "Plateau", "player-1"));
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const T = "At the beginning of your upkeep, all lands you control phase out.";
    const s = clone(start); s.gameView.stack = [{ id: "stack-tw", sourceId: "engine-card-959", controllerId: "player-0", identity: { name: "Taniwha" }, sourceAbilityText: T, text: T, isPermanentSpell: false }];
    await boardAs(h, seat, s);
    // (mutation pass: a land bounced while the trigger still waits on the stack returns to the hand; it phases nothing)
    const s2 = clone(s); bfz(s2, "player-0").cards = bfz(s2, "player-0").cards.filter((c) => c.id !== "engine-card-972");
    s2.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").count = (s2.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").count ?? 0) + 1;
    await boardAs(h, seat, s2);
    await boardAs(h, seat, s);
    const out = clone(start);
    for (const c of bfz(out, "player-0").cards) if (["engine-card-971", "engine-card-972"].includes(c.id)) c.phasedOut = true;
    bfz(out, "player-1").cards = bfz(out, "player-1").cards.filter((c) => c.id !== "engine-card-973");
    await boardAs(h, seat, out);
    const back = clone(start); bfz(back, "player-1").cards = bfz(back, "player-1").cards.filter((c) => c.id !== "engine-card-973");
    await boardAs(h, seat, back);
    return logLines(h).slice(mark);
  } });
  // (hp-26: Sensei's Divining Top's tap: a card drawn, Top on top of the library (the library level); without its record,
  // the same board reads as Top returned to the hand. As live: the ability seen on the stack first, its record dropped
  // there; and another of its abilities on the stack is not the one that puts it on top)
  const topDraw = "{T}: Draw a card, then put Sensei's Divining Top on top of its owner's library.";
  for (const [used, stackText] of [[true, null], [false, null], [true, topDraw], [true, "{1}: Look at the top three cards of your library, then put them back in any order."]]) {
    add({ name: `log: Sensei's Divining Top's draw (${used ? "used" : "no record"}${stackText ? `, ${stackText === topDraw ? "seen on the stack" : "another ability on the stack"}` : ""})`, run: async (h) => {      const seat = game(h, myMain(D2.board));
      const start = myMain(D2.board);
      const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
      zone(start, "library").count = 20;
      zone(start, "battlefield").cards.push({ id: "engine-card-951", identity: { name: "Sensei's Divining Top" }, types: ["Artifact"], ownerId: "player-0", controllerId: "player-0", text: "" });
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      if (used) (h.B._getGame().pendingPlays ??= []).push({ id: "engine-card-951", name: "Sensei's Divining Top", ctl: "player-0", kind: "ability",
        text: `Sensei's Divining Top: ${stackText || topDraw}`, at: Date.now(), promptId: -2 });
      if (stackText) {
        const onStack = clone(start);
        onStack.gameView.stack = [{ id: "stack-top", sourceId: "engine-card-951", controllerId: "player-0", identity: { name: "Sensei's Divining Top" }, sourceAbilityText: stackText, text: stackText, isPermanentSpell: false }];
        await boardAs(h, seat, onStack);
      }
      const b = clone(start);
      zone(b, "battlefield").cards = zone(b, "battlefield").cards.filter((c) => c.id !== "engine-card-951");
      const hz = zone(b, "hand"); hz.count = (hz.count ?? hz.cards.length) + 1;
      await boardAs(h, seat, b);
      return { lines: logLines(h).slice(mark) };
    } });
  }
  // (hp-26 mutation pass: Top's draw still on the stack while Top is bounced is not it put on top; nor Top leaving a
  // graveyard after its ability)
  for (const where of ["bounced, its ability still on the stack", "leaves the graveyard"]) {
    add({ name: `log: Sensei's Divining Top (${where})`, run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const start = myMain(D2.board);
      const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
      zone(start, "library").count = 20;
      zone(start, where.startsWith("bounced") ? "battlefield" : "graveyard").cards.push({ id: "engine-card-951", identity: { name: "Sensei's Divining Top" }, types: ["Artifact"], ownerId: "player-0", controllerId: "player-0", text: "" });
      start.gameView.stack = [{ id: "stack-top", sourceId: "engine-card-951", controllerId: "player-0", identity: { name: "Sensei's Divining Top" }, sourceAbilityText: topDraw, text: topDraw, isPermanentSpell: false }];
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const b = clone(start);
      for (const zn of ["battlefield", "graveyard"]) zone(b, zn).cards = zone(b, zn).cards.filter((c) => c.id !== "engine-card-951");
      if (where.startsWith("bounced")) { const hz = zone(b, "hand"); hz.count = (hz.count ?? hz.cards.length) + 1; }
      // (the draw from the library, the library level: Top was not put there, so it reads as no draw counted twice)
      else { b.gameView.stack = []; const hz = zone(b, "hand"); hz.count = (hz.count ?? hz.cards.length) + 1; }
      await boardAs(h, seat, b);
      return { lines: logLines(h).slice(mark) };
    } });
  }
  // (gap-04: a face-down cast is unnamed in the log, as the priority question offers it live: "Cast X (face down)";
  // the same card cast face up is named; one cast another way says which, by Forge's mode, gap-04's flashback)
  for (const [label, mode] of [["Cast Hurloon Minotaur (face down)", { type: "normal" }], ["Cast Hurloon Minotaur", { type: "normal" }],
    ["Cast Hurloon Minotaur (Flashback)", { type: "alternative", cost: "flashback" }], ["Cast Hurloon Minotaur (WebSlinging)", { type: "alternative", cost: "webSlinging" }]]) {
    add({ name: `log: ${label}`, run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      h.B.onPrompt(seat, prompt("chooseAction", { actions: [
        { id: "a-cast", type: "cast", cardId: "engine-card-75", label, mode },
        { id: "pass", type: "pass", label: "Pass priority" }] })); await h.flush();
      const opt = (seat.prompt?.ui?.options || []).find((o) => /Minotaur/.test(o.label));
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: seat.prompt?.promptId, choice: [opt?.id] }) }); await h.flush();
      const b = clone(start);
      for (const z of b.gameView.zones) if (z.cards) z.cards = z.cards.filter((c) => c.id !== "engine-card-75");
      b.gameView.stack = [{ id: "stack-fd", sourceId: "engine-card-75", controllerId: "player-0", identity: { name: "Hurloon Minotaur" }, sourceAbilityText: "", isPermanentSpell: true }];
      await boardAs(h, seat, b);
      return { option: opt?.label || null, lines: logLines(h).slice(mark) };
    } });
  }
  // (hp-14 gap: a creature cast from the top of the library (Augur of Autumn's coven) says so; by flashback from there
  // says only its mode)
  for (const mode of [{ type: "normal" }, { type: "alternative", cost: "flashback" }]) {
    add({ name: `log: a cast from the top of the library (${mode.type})`, run: async (h) => {
      const start = myMain(D2.board);
      for (const z of start.gameView.zones) if (z.cards) z.cards = z.cards.filter((c) => c.id !== "engine-card-75");
      const lib = start.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0");
      (lib.cards ??= []).unshift({ id: "engine-card-75", identity: { name: "Hurloon Minotaur" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      h.B.onPrompt(seat, prompt("chooseAction", { actions: [
        { id: "a-cast", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode },
        { id: "pass", type: "pass", label: "Pass priority" }] })); await h.flush();
      const opt = (seat.prompt?.ui?.options || []).find((o) => /Minotaur/.test(o.label));
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: seat.prompt?.promptId, choice: [opt?.id] }) }); await h.flush();
      const b = clone(start);
      for (const z of b.gameView.zones) if (z.cards) z.cards = z.cards.filter((c) => c.id !== "engine-card-75");
      b.gameView.stack = [{ id: "stack-lt", sourceId: "engine-card-75", controllerId: "player-0", identity: { name: "Hurloon Minotaur" }, sourceAbilityText: "", isPermanentSpell: true }];
      await boardAs(h, seat, b);
      return { option: opt?.label || null, lines: logLines(h).slice(mark) };
    } });
  }
  // (gap-04: regeneration, which Forge doesn't show: the shield's ability resolves, then Murder; the creature tapped,
  // still there. A creature that targets another's regeneration (Swarmyard's Rat); and no shield, a tap is no
  // regeneration)
  for (const [what, text, target] of [["own", "{B}: Regenerate Drudge Skeletons.", null], ["targeted", "{T}: Regenerate target Insect, Rat, Spider, or Squirrel.", true], ["no shield", null, null]]) {
    add({ name: `log: regeneration (${what})`, run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
      zone(start, "battlefield").cards.push({ id: "engine-card-952", identity: { name: "Drudge Skeletons" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "", tapped: false },
        { id: "engine-card-953", identity: { name: "Swarmyard" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "", tapped: false });
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const step = (f) => { const b = clone(start); f(b); return b; };
      if (text) await boardAs(h, seat, step((b) => { b.gameView.stack = [{ id: "stack-rg", sourceId: target ? "engine-card-953" : "engine-card-952", controllerId: "player-0",
        identity: { name: target ? "Swarmyard" : "Drudge Skeletons" }, sourceAbilityText: text, text, isPermanentSpell: false, targets: target ? [{ kind: "card", id: "engine-card-952" }] : [] }]; }));
      await boardAs(h, seat, step((b) => { b.gameView.stack = [{ id: "stack-mu", sourceId: "engine-card-9990", controllerId: "player-0", identity: { name: "Murder" }, sourceAbilityText: "Destroy target creature.", isPermanentSpell: false }]; }));
      await boardAs(h, seat, step((b) => { zone(b, "battlefield").cards.find((c) => c.id === "engine-card-952").tapped = true; }));
      return { lines: logLines(h).slice(mark) };
    } });
  }
  // (hp-05 gap: goad, which Forge doesn't show: Disrupt Decorum cast by the player (never seen on the stack), an AI's
  // "goad target creature" seen on the stack, a spell that doesn't goad; the badge on the card, gone on the goader's
  // next turn)
  for (const what of ["all you don't control", "target", "no goad"]) {
    add({ name: `log: goad (${what})`, run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const zone = (b, zn, o) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === o);
      const ape = { id: "engine-card-967", identity: { name: "Kird Ape" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" };
      const rats = { id: "engine-card-968", identity: { name: "Typhoid Rats" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" };
      const mine = { id: "engine-card-969", identity: { name: "Grizzly Bears" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" };
      zone(start, "battlefield", "player-1").cards.push(ape, rats);
      zone(start, "battlefield", "player-0").cards.push(mine);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const b = clone(start);
      if (what === "target") {
        const T = "{2}: Goad target creature.";
        const on = clone(start); on.gameView.stack = [{ id: "stack-gd", sourceId: "engine-card-968", controllerId: "player-1", identity: { name: "Typhoid Rats" }, sourceAbilityText: T, text: T, isPermanentSpell: false, targets: [{ kind: "card", id: "engine-card-969" }] }];
        await boardAs(h, seat, on);
      } else {
        const text = what === "no goad" ? "Draw two cards." : "Draw a card. Goad all creatures you don't control.";
        zone(b, "graveyard", "player-0").cards.push({ id: "engine-card-970", identity: { name: what === "no goad" ? "Divination" : "Disrupt Decorum" }, types: ["Sorcery"], ownerId: "player-0", controllerId: "player-0", text });
      }
      await boardAs(h, seat, b);
      // (the card as the table last got it: the latest table message that carries it)
      const kwOf = (id) => {
        const t = h.effects.filter((e) => e.tts && e.tts.t === "table" && JSON.stringify(e.tts).includes(`"id":"${id}"`)).pop()?.tts;
        const m = JSON.stringify(t || {}).match(new RegExp(`\\{[^{}]*"id":"${id}"[^{}]*\\}`));
        return m ? (JSON.parse(m[0]).kw || []).join(", ") : null;
      };
      const badges = [kwOf("engine-card-967"), kwOf("engine-card-968"), kwOf("engine-card-969")];
      // (the goader's next turn: gone)
      const next = clone(b); next.gameView.turn = (b.gameView.turn || 1) + 2; next.gameView.activePlayerId = what === "target" ? "player-1" : "player-0";
      await boardAs(h, seat, next);
      return { lines: logLines(h).slice(mark), badges, after: [kwOf("engine-card-967"), kwOf("engine-card-969")] };
    } });
  }
  // ("mtg skip <phase>", the player's request 2026-10-29: priority passed until that phase, which then stops whatever the
  // step stops say; an opponent's spell ends it; "mine" waits for the player's next turn; an unknown phase says the list)
  add({ name: "skip to a phase", run: async (h) => {
    const out = [];
    const at = (step, active = "player-0", turn = 5, stack = []) => { const b = myMain(D2.board); b.gameView.step = step; b.gameView.activePlayerId = active; b.gameView.turn = turn; b.gameView.stack = stack; return b; };
    const ask = async (seat, b, n) => { seat.board = { state: b, fingerprint: null }; h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: acts.slice(0, 2) }), promptId: n }); await h.flush(); return seat.prompt?.promptId === n ? `asked at ${b.gameView.step}` : `passed ${b.gameView.step}`; };
    for (const [phase, steps] of [["end", [["combatDeclareAttackers"], ["main2"], ["endOfTurn"]]], ["combat", [["main2"], ["upkeep", "player-1", 6], ["combatBegin", "player-1", 6]]],
      ["mine", [["upkeep", "player-1", 6], ["main1", "player-1", 6], ["upkeep", "player-0", 7]]],
      ["end", [["main2", "player-0", 5, [{ id: "engine-stack-91", sourceId: "engine-card-991", controllerId: "player-1", identity: { name: "Lightning Bolt" }, sourceAbilityText: "x" }]]]], ["nonsense", []],
      // (mutation pass: reached where nothing else would stop, the AI's combat; the same step it was set in isn't it)
      ["combat", [["combatBegin", "player-1", 6]]], ["main", [["main1", "player-0", 5], ["main1", "player-1", 6]]]]) {
      const seat = game(h, at("main1"));
      seat.board = { state: at("main1"), fingerprint: null };
      const mark = h.effects.length;
      h.B.onTTS({ t: "skipto", json: JSON.stringify({ t: "skipto", color: "Blue", phase }) }); await h.flush();
      const said = h.effects.slice(mark).filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text || e.tts.msg || JSON.stringify(e.tts)).join(" / ");
      const seen = [];
      let n = 980;
      for (const s of steps) seen.push(await ask(seat, at(...s), n++));
      out.push([phase, said.slice(0, 160), seen, seat.skipTo ? "still on" : "off"]);
    }
    // ("mtg skip off" ends it: the next main phase asks as usual)
    {
      const seat = game(h, at("main1"));
      seat.board = { state: at("combatDeclareAttackers"), fingerprint: null };
      h.B.onTTS({ t: "skipto", json: JSON.stringify({ t: "skipto", color: "Blue", phase: "end" }) }); await h.flush();
      h.B.onTTS({ t: "skipto", json: JSON.stringify({ t: "skipto", color: "Blue", phase: "off" }) }); await h.flush();
      out.push(["off", await ask(seat, at("main2"), 990)]);
    }
    return out;
  } });
  // (the Auto-resolve list, 2026-10-31: the table is told every change, one choice is on at a time, and a skip that ends by
  // itself says so; auto-resolve can't pass the stop a skip asked for)
  add({ name: "auto-resolve list: the table is told, one choice at a time", run: async (h) => {
    const at = (step, active = "player-0", turn = 5) => { const b = myMain(D2.board); b.gameView.step = step; b.gameView.activePlayerId = active; b.gameView.turn = turn; b.gameView.stack = []; return b; };
    const seat = game(h, at("main1"));
    seat.board = { state: at("main1"), fingerprint: null };
    const told = () => h.effects.filter((e) => e.tts && e.tts.t === "autostate").map((e) => [e.tts.color, e.tts.phase, e.tts.on]);
    const send = async (t, m) => { h.B.onTTS({ t, json: JSON.stringify({ t, color: "Blue", ...m }) }); await h.flush(); };
    const out = [];
    await send("autoresolve", { on: true }); out.push(["auto on", told().slice(-1)]);
    await send("skipto", { phase: "end" }); out.push(["skip takes over", told().slice(-1), seat.skipTo?.phase]);
    await send("autoresolve", { on: true }); out.push(["auto takes over", told().slice(-1), seat.skipTo]);
    await send("skipto", { phase: "nonsense" }); out.push(["unknown phase", told().length]);
    await send("skipto", { phase: "off" }); out.push(["skip off leaves auto on", told().slice(-1)]);
    await send("autoresolve", { on: false }); out.push(["auto off", told().slice(-1)]);
    await send("skipto", { phase: "end" });
    const n = told().length;
    // the opponent's end step: the skip stops there, and the table hears it once
    seat.board = { state: at("endOfTurn", "player-1", 6), fingerprint: null };
    h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: acts.slice(0, 2) }), promptId: 995 }); await h.flush();
    out.push(["reached", told().slice(n), !!seat.prompt, seat.skipTo]);
    // the same with auto-resolve on first: picking the skip turned it off, so the stop on their turn holds
    await send("autoresolve", { on: true }); await send("skipto", { phase: "end" });
    seat.prompt = null;
    seat.board = { state: at("end", "player-1", 8), fingerprint: null };
    h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: acts.slice(0, 2) }), promptId: 996 }); await h.flush();
    out.push(["stop holds on their turn", !!seat.prompt]);
    // a reloaded table gets it back
    await send("skipto", { phase: "combat" });
    const before = told().length;
    h.B.onTTS({ t: "hello", json: JSON.stringify({ t: "hello", again: true }) }); await h.flush();
    out.push(["after a reload", told().slice(before)]);
    return out;
  } });
  // (hp-11 gap: -1/-1 counters a permanent gains are said, as +1/+1 counters are)
  add({ name: "log: -1/-1 counters", run: async (h) => {
    const start = myMain(D2.board);
    const bf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards;
    bf(start).push({ id: "engine-card-932", identity: { name: "Tolarian Scholar" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "", counters: {} });
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    for (const n of [1, 3]) { const b = clone(start); bf(b).find((c) => c.id === "engine-card-932").counters = { M1M1: n }; await boardAs(h, seat, b); }
    return logLines(h).slice(mark);
  } });
  // (hp-11 gap: a creature token gone in the combat damage step dies; gone in a main phase it only leaves)
  for (const [step, types] of [["combatDamage", ["Artifact", "Creature"]], ["main2", ["Artifact", "Creature"]], ["combatDamage", ["Artifact"]]]) {
    add({ name: `log: a ${types.length > 1 ? "creature" : "noncreature"} token gone (${step})`, run: async (h) => {
      const start = myMain(D2.board);
      start.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-931", identity: { name: types.length > 1 ? "Phyrexian Mite Token" : "Treasure Token", isToken: true }, types, ownerId: "player-0", controllerId: "player-0", text: "" });
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const b = myMain(D2.board); b.gameView.step = step;
      await boardAs(h, seat, b);
      return logLines(h).slice(mark);
    } });
  }
  // (hp-11 gap: the city's blessing (Forge's hasCityBlessing) said once, when it comes)
  add({ name: "log: the city's blessing", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const b = clone(start); for (const p of b.gameView.players || []) if (p.id === "player-0") p.hasCityBlessing = true;
    await boardAs(h, seat, b);
    await boardAs(h, seat, clone(b));
    // (and poison counters, hp-11 gap: two, then one more, then one fewer)
    for (const n of [2, 3, 2]) { const c = clone(b); for (const p of c.gameView.players || []) if (p.id === "player-1") p.counters = { ...(p.counters || {}), POISON: n }; await boardAs(h, seat, c); }
    return logLines(h).slice(mark);
  } });
  // (hp-10 gap: blocks in the log, from Forge's combat assignments: one blocker, two on one attacker, nothing again)
  add({ name: "log: blocks", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    const bf = (b, o) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === o).cards;
    bf(start, "player-0").push({ id: "engine-card-923", identity: { name: "Cavalry Master" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" },
      { id: "engine-card-924", identity: { name: "Herald of Hoofbeats" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
    bf(start, "player-1").push({ id: "engine-card-925", identity: { name: "Fog Bank" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" },
      { id: "engine-card-926", identity: { name: "Wall of Air" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" },
      { id: "engine-card-927", identity: { name: "Coral Barrier" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const atk = clone(start);
    for (const c of bf(atk, "player-0")) if (c.id === "engine-card-923" || c.id === "engine-card-924") c.isAttacking = true;
    await boardAs(h, seat, atk);
    const blk = clone(atk);
    blk.gameView.combatAssignments = [{ attackerId: "engine-card-923", blockerId: "engine-card-925" }, { attackerId: "engine-card-924", blockerId: "engine-card-926" }, { attackerId: "engine-card-924", blockerId: "engine-card-927" }];
    await boardAs(h, seat, blk);
    await boardAs(h, seat, clone(blk));
    return logLines(h).slice(mark);
  } });
  // (hp-09 gap: an exerted permanent (Forge's exerted) carries a badge on the table; not exerted, none)
  add({ name: "table: an exerted permanent's badge", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    const bf = start.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
    bf.cards.push({ id: "engine-card-917", identity: { name: "Arena of Glory" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "", tapped: true, exerted: true },
      { id: "engine-card-918", identity: { name: "Mountain" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "", tapped: true });
    await boardAs(h, seat, start);
    // (the card as the table last got it: the latest table message that carries it)
    const of = (id) => {
      const t = h.effects.filter((e) => e.tts && e.tts.t === "table" && JSON.stringify(e.tts).includes(`"id":"${id}"`)).pop()?.tts;
      return (JSON.stringify(t || {}).match(new RegExp(`\\{[^{}]*"id":"${id}"[^{}]*\\}`)) || [null])[0];
    };
    return [of("engine-card-917"), of("engine-card-918")].map((x) => (x ? JSON.parse(x).kw || [] : null));
  } });
  // (hp-17 gap: a Case's solve trigger resolved: "is solved" once and "Solved" on the card; a trigger still on the stack
  // or another ability of the Case isn't)
  add({ name: "log: a Case is solved", run: async (h) => {
    const start = myMain(D2.board);
    const bf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
    bf(start).push({ id: "engine-card-30", identity: { name: "Case of the Locked Hothouse" }, types: ["Enchantment"], subtypes: ["Case"], ownerId: "player-0", controllerId: "player-0", text: "" });
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const T = "To solve — You control seven or more lands. (If unsolved, solve at the beginning of your end step.)";
    const trig = (text) => { const b = clone(start); b.gameView.stack = [{ id: "stack-cs", sourceId: "engine-card-30", controllerId: "player-0", identity: { name: "Case of the Locked Hothouse" }, sourceAbilityText: text, text, isPermanentSpell: false }]; return b; };
    await boardAs(h, seat, trig("You may play an additional land on each of your turns."));
    await boardAs(h, seat, clone(start));
    await boardAs(h, seat, trig(T));
    await boardAs(h, seat, trig(T));
    await boardAs(h, seat, clone(start));
    const t = h.effects.filter((e) => e.tts && e.tts.t === "table").pop()?.tts;
    const find = (o, id) => (o && typeof o === "object" ? (o.id === id ? o : Object.values(o).reduce((r, v) => r || find(v, id), null)) : null);
    return { lines: logLines(h).slice(mark), kw: find(t, "engine-card-30")?.kw || null };
  } });
  // (hp-14 gap: renown's trigger resolved: said once, "Renowned" on the card while it stays; gone after it leaves; a
  // second renown trigger, or one whose creature left first, says nothing)
  add({ name: "log: renowned", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    const T = "Renown 1 (When this creature deals combat damage to a player, if it isn't renowned, put a +1/+1 counter on it and it becomes renowned.)";
    const seeker = { id: "engine-card-961", identity: { name: "Relic Seeker" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: T, power: "2", toughness: "2" };
    const other = { id: "engine-card-962", identity: { name: "Topan Freeblade" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: T, power: "2", toughness: "2" };
    const board = (cards, stack) => { const b = clone(start); b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push(...cards.map(clone)); b.gameView.stack = stack || []; return b; };
    // (the card as the table last got it, found by walking that message: it carries a counters object)
    const find = (o, id) => (o && typeof o === "object" ? (o.id === id ? o : Object.values(o).reduce((r, v) => r || find(v, id), null)) : null);
    const trig = (src, name) => ({ id: `stack-rn-${src}`, sourceId: src, controllerId: "player-0", identity: { name }, sourceAbilityText: T, text: T, isPermanentSpell: false });
    const of = (id) => {
      const t = h.effects.filter((e) => e.tts && e.tts.t === "table" && JSON.stringify(e.tts).includes(`"id":"${id}"`)).pop()?.tts;
      const c = find(t, id);
      return c ? c.kw || [] : null;
    };
    await boardAs(h, seat, board([seeker, other]));
    const mark = logLines(h).length;
    await boardAs(h, seat, board([seeker, other], [trig("engine-card-961", "Relic Seeker")]));
    // (still on the stack a board later: not renowned yet)
    await boardAs(h, seat, board([seeker, other], [trig("engine-card-961", "Relic Seeker")]));
    const waiting = of("engine-card-961");
    await boardAs(h, seat, board([{ ...seeker, counters: { P1P1: 1 } }, other]));
    const shown =[of("engine-card-961"), of("engine-card-962")];
    await boardAs(h, seat, board([{ ...seeker, counters: { P1P1: 1 } }, other], [trig("engine-card-961", "Relic Seeker")]));
    await boardAs(h, seat, board([{ ...seeker, counters: { P1P1: 1 } }, other]));
    // (the Freeblade's trigger leaves the stack as it leaves the battlefield: not renowned)
    await boardAs(h, seat, board([{ ...seeker, counters: { P1P1: 1 } }, other], [trig("engine-card-962", "Topan Freeblade")]));
    await boardAs(h, seat, board([{ ...seeker, counters: { P1P1: 1 } }]));
    await boardAs(h, seat, board([seeker, other]));
    // (the Seeker leaves and comes back: a new object, not renowned)
    const g = board([other]); g.gameView.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-0").cards.push(clone(seeker));
    await boardAs(h, seat, g);
    await boardAs(h, seat, board([seeker, other]));
    return { waiting, shown, back: [of("engine-card-961"), of("engine-card-962")], log: logLines(h).slice(mark) };
  } });
  // (hp-13 gap: an ability word's trigger, "Battalion — Whenever ...", said by its word)
  add({ name: "log: an ability word's trigger", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    start.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-933", identity: { name: "Frontline Medic" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const T = "Battalion — Whenever Frontline Medic and at least two other creatures attack, creatures you control gain indestructible until end of turn.";
    const b = clone(start); b.gameView.stack = [{ id: "stack-bt", sourceId: "engine-card-933", controllerId: "player-0", identity: { name: "Frontline Medic" }, sourceAbilityText: T, text: T, isPermanentSpell: false }];
    await boardAs(h, seat, b);
    // (an ability word on an activated ability is no trigger: Shifting Woodland's "Delirium — {2}{G}{G}: ...")
    await boardAs(h, seat, clone(start));
    const D = "Delirium — {2}{G}{G}: Shifting Woodland becomes a copy of target permanent card in your graveyard until end of turn.";
    const d = clone(start); d.gameView.stack = [{ id: "stack-dl", sourceId: "engine-card-933", controllerId: "player-0", identity: { name: "Shifting Woodland" }, sourceAbilityText: D, text: D, isPermanentSpell: false }];
    await boardAs(h, seat, d);
    return logLines(h).slice(mark);
  } });
  // (hp-21 gap: a flavor word's trigger, "Allons-y! — Whenever ...", by its word; and a card from the library exiled
  // suspended with time counters, one without suspend beside it)
  add({ name: "log: a flavor word's trigger and a card exiled suspended", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    start.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-934", identity: { name: "The Tenth Doctor" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const T = "Allons-y! — Whenever you attack, exile cards from the top of your library until you exile a nonland card. Put three time counters on it. If it doesn't have suspend, it gains suspend.";
    const b = clone(start); b.gameView.stack = [{ id: "stack-al", sourceId: "engine-card-934", controllerId: "player-0", identity: { name: "The Tenth Doctor" }, sourceAbilityText: T, text: T, isPermanentSpell: false }];
    await boardAs(h, seat, b);
    const e = clone(start);
    e.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-0").cards.push(
      { id: "engine-card-935", identity: { name: "Diabolic Tutor" }, types: ["Sorcery"], ownerId: "player-0", controllerId: "player-0", text: "", counters: { Time: 3 }, keywords: ["Suspend"] },
      { id: "engine-card-936", identity: { name: "Island" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" },
      { id: "engine-card-937", identity: { name: "Rift Bolt" }, types: ["Sorcery"], ownerId: "player-0", controllerId: "player-0", text: "", counters: { Time: 1 }, keywords: ["Suspend 1—{R}"] },
      // (time counters without suspend: no suspend to say)
      { id: "engine-card-938", identity: { name: "Dust of Moments" }, types: ["Instant"], ownerId: "player-0", controllerId: "player-0", text: "", counters: { Time: 2 } });
    await boardAs(h, seat, e);
    return logLines(h).slice(mark);
  } });
  // (hp-21 gap: ingest's card from the AI's library: one line for the library's cards, a card more than it lost said apart)
  // (a plotted card and a spell off the stack exiled beside them are said as themselves)
  add({ name: "log: cards exiled from a library", run: async (h) => {
    const start = myMain(D2.board);
    start.gameView.stack = [{ id: "engine-stack-94", sourceId: "engine-card-944", controllerId: "player-1", identity: { name: "Ponder" }, sourceAbilityText: "Look at the top three cards of your library." }];
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const b = clone(start); b.gameView.stack = [];
    const lib = b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-1");
    lib.count = (lib.count ?? (lib.cards || []).length) - 5;
    b.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-1").cards.push(
      { id: "engine-card-944", identity: { name: "Ponder" }, types: ["Sorcery"], ownerId: "player-1", controllerId: "player-1", text: "" },
      { id: "engine-card-945", identity: { name: "Preordain" }, types: ["Sorcery"], ownerId: "player-1", controllerId: "player-1", text: "", isPlotted: true });
    b.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-1").cards.push(
      { id: "engine-card-941", identity: { name: "Island" }, types: ["Land"], ownerId: "player-1", controllerId: "player-1", text: "" },
      { id: "engine-card-942", identity: { name: "Island" }, types: ["Land"], ownerId: "player-1", controllerId: "player-1", text: "" },
      { id: "engine-card-943", identity: { name: "Opt" }, types: ["Instant"], ownerId: "player-1", controllerId: "player-1", text: "" });
    await boardAs(h, seat, b);
    return logLines(h).slice(mark);
  } });
  // (gap-04: Ward's trigger on the stack, its reminder starting "Whenever": said by its keyword)
  add({ name: "log: ward's trigger", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    const zone = (b, zn, o) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === o);
    zone(start, "battlefield", "player-1").cards.push({ id: "engine-card-966", identity: { name: "Hexing Squelcher" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const W = "Ward—Pay 2 life. (Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays 2 life.)";
    const b = clone(start); b.gameView.stack = [{ id: "stack-wd", sourceId: "engine-card-966", controllerId: "player-1", identity: { name: "Hexing Squelcher" }, sourceAbilityText: W, text: W, isPermanentSpell: false }];
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // (hp-20 gap: the same from a face-down (cloaked) creature, its name hidden ("?"): "a face-down permanent's ward")
  add({ name: "log: a face-down creature's ward trigger", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    start.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards.push({ id: "engine-card-948", identity: { name: "?" }, isFaceDown: true, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const W = "Ward {2} (Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)";
    const b = clone(start); b.gameView.stack = [{ id: "stack-fw", sourceId: "engine-card-948", controllerId: "player-1", identity: { name: "?" }, sourceAbilityText: W, text: W, isPermanentSpell: false }];
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // (gap-04 live: the player's own regeneration resolves before any board shows it on the stack; the shield by the
  // record, or by the target picked; a tap by its own {T} ability or by attacking is no regeneration. Mutation pass: a
  // "Regenerate target" record shields its target, not its own creature; a creature still tapped, or tapped again after
  // its shield was used, is no second regeneration)
  for (const what of ["own record", "target picked", "own tap ability", "attacking", "targeted record", "used shield"]) {
    add({ name: `log: regeneration live (${what})`, run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
      zone(start, "battlefield").cards.push({ id: "engine-card-952", identity: { name: "Drudge Skeletons" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "", tapped: false });
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const G = h.B._getGame();
      const rec = (text) => (G.pendingPlays ??= []).push({ id: "engine-card-952", name: "Drudge Skeletons", ctl: "player-0", kind: "ability", text, at: Date.now(), promptId: -3 });
      if (what === "target picked") {
        const p = { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-952" }], presentation: { title: "Swarmyard", targets: [] } }),
          sourceCard: { id: "engine-card-953", identity: { name: "Swarmyard" }, text: "x" }, sourceAbilityText: "{T}: Regenerate target Insect, Rat, Spider, or Squirrel.", promptId: 964 };
        h.B.onPrompt(seat, p); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 964, choice: ["card|engine-card-952"] }) }); await h.flush();
      } else rec(what === "targeted record" ? "Drudge Skeletons: {B}: Regenerate target creature." : "Drudge Skeletons: {B}: Regenerate Drudge Skeletons.");
      await boardAs(h, seat, clone(start));
      if (what === "own tap ability") rec("Drudge Skeletons: {T}: Add {B}.");
      const b = clone(start);
      const d = zone(b, "battlefield").cards.find((c) => c.id === "engine-card-952");
      d.tapped = true; if (what === "attacking") d.isAttacking = true;
      await boardAs(h, seat, b);
      // (the same board again: still tapped)
      await boardAs(h, seat, clone(b));
      if (what === "used shield") {
        const up = clone(start); await boardAs(h, seat, up);
        const again = clone(b); await boardAs(h, seat, again);
      }
      return { lines: logLines(h).slice(mark) };
    } });
  }
  // (hp-14 gap: the player's suspect trigger (Nelly Borca): its target picked, then resolved with no board showing it on
  // the stack, or after one did; suspected and goaded in the log, "Suspected" on the card until it leaves)
  for (const what of ["never on the stack", "on the stack first", "target leaves", "a second suspect"]) {
    add({ name: `log: suspect (${what})`, run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const zone = (b, zn, o) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === o);
      const T = "Vigilance\nWhenever Nelly Borca, Impulsive Accuser attacks, suspect target creature. Then goad all suspected creatures. (A suspected creature has menace and can't block.)";
      zone(start, "battlefield", "player-0").cards.push({ id: "engine-card-29", identity: { name: "Nelly Borca, Impulsive Accuser" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: T });
      zone(start, "battlefield", "player-1").cards.push({ id: "engine-card-89", identity: { name: "Garruk's Companion" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "Trample" },
        { id: "engine-card-90", identity: { name: "Elvish Warrior" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const p = { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-89" }], presentation: { title: "Hostile", targets: [] } }),
        sourceCard: { id: "engine-card-29", identity: { name: "Nelly Borca, Impulsive Accuser" }, text: T }, decidingPlayerId: "player-0", promptId: 965 };
      h.B.onPrompt(seat, p); await h.flush();
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 965, choice: ["card|engine-card-89"] }) }); await h.flush();
      if (what === "on the stack first") {
        const s = clone(start); s.gameView.stack = [{ id: "stack-sus", sourceId: "engine-card-29", controllerId: "player-0", identity: { name: "Nelly Borca, Impulsive Accuser" }, sourceAbilityText: T, text: T, isPermanentSpell: false, targets: [{ kind: "card", id: "engine-card-89" }] }];
        await boardAs(h, seat, s);
      }
      const after = clone(start);
      if (what === "target leaves") zone(after, "battlefield", "player-1").cards = zone(after, "battlefield", "player-1").cards.filter((c) => c.id !== "engine-card-89");
      await boardAs(h, seat, after);
      // (a second attack suspects the Warrior: "goad all suspected creatures" goads both)
      if (what === "a second suspect") {
        h.B.onPrompt(seat, { ...p, input: { ...p.input, candidates: [{ kind: "card", id: "engine-card-90" }] }, promptId: 968 }); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 968, choice: ["card|engine-card-90"] }) }); await h.flush();
        await boardAs(h, seat, clone(after));
      }
      const t = h.effects.filter((e) => e.tts && e.tts.t === "table").pop()?.tts;
      const find = (o, id) => (o && typeof o === "object" ? (o.id === id ? o : Object.values(o).reduce((r, v) => r || find(v, id), null)) : null);
      const kw = find(t, "engine-card-89")?.kw || null;
      return { lines: logLines(h).slice(mark), kw };
    } });
  }
  // (hp-14 gap: an Aura and its replicate copies (tokens) enter attached: said with what they are attached to; one
  // attached to a card the board doesn't show says nothing of it)
  add({ name: "log: Auras enter attached", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    const bf = (b, o) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === o).cards;
    bf(start, "player-1").push({ id: "engine-card-89", identity: { name: "Garruk's Companion" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
    bf(start, "player-0").push({ id: "engine-card-143", identity: { name: "Goblin Token", isToken: true }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const aura = (id, on, token) => ({ id, identity: { name: "Changing Loyalty", isToken: token }, types: ["Enchantment"], subtypes: ["Aura"], ownerId: "player-0", controllerId: "player-0", text: "", attachedTo: on });
    const b = clone(start);
    bf(b, "player-0").push(aura("engine-card-13", "engine-card-89", false), aura("engine-card-147", "engine-card-143", true), aura("engine-card-148", "engine-card-89", true), aura("engine-card-149", "engine-card-999", true));
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // (hp-14 gap: an arrival with other counters says them (Tangle Wire's fade counters), beside +1/+1 counters; loyalty,
  // which every planeswalker enters with, and an empty count, are not said)
  add({ name: "log: arrivals with counters", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const b = clone(start);
    const card = (id, name, types, counters) => ({ id, identity: { name }, types, ownerId: "player-0", controllerId: "player-0", text: "", counters });
    b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push(card("engine-card-971", "Tangle Wire", ["Artifact"], { Fade: 4 }),
      card("engine-card-972", "Aeon Engine", ["Creature"], { P1P1: 2, TIME: 1 }), card("engine-card-973", "Chandra, Torch of Defiance", ["Planeswalker"], { LOYALTY: 4 }),
      card("engine-card-974", "Vanishing Wurm", ["Creature"], { TIME: 0 }));
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // (hp-14 gap: Tangle Wire's fading takes a counter off, and its tapping trigger, resolved, makes a player tap: both said;
  // a tap with no such trigger resolving (a mana tap) says nothing; a counter gained says how many in all)
  add({ name: "log: fading and Tangle Wire's taps", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    const bf = (b, o) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === o).cards;
    const card = (id, name, types, o, extra) => ({ id, identity: { name }, types, ownerId: o, controllerId: o, text: "", tapped: false, ...extra });
    bf(start, "player-0").push(card("engine-card-971", "Tangle Wire", ["Artifact"], "player-0", { counters: { Fade: 4 } }), card("engine-card-975", "Aeon Engine", ["Artifact"], "player-0", { counters: { TIME: 1 } }),
      card("engine-card-980", "Blastoderm", ["Creature"], "player-0"));
    bf(start, "player-1").push(card("engine-card-976", "Taiga", ["Land"], "player-1"), card("engine-card-977", "Garruk's Companion", ["Creature"], "player-1"), card("engine-card-978", "Forest", ["Land"], "player-1"), card("engine-card-979", "Mountain", ["Land"], "player-1"));
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const T = "At the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on Tangle Wire.";
    const s = clone(start); s.gameView.stack = [{ id: "stack-tw", sourceId: "engine-card-971", controllerId: "player-0", identity: { name: "Tangle Wire" }, sourceAbilityText: T, text: T, isPermanentSpell: false }];
    await boardAs(h, seat, s);
    // (a mana tap while the trigger waits on the stack: not its tap)
    const s2 = clone(s); bf(s2, "player-1").find((c) => c.id === "engine-card-979").tapped = true;
    await boardAs(h, seat, s2);
    const b = clone(start);
    bf(b, "player-1").find((c) => c.id === "engine-card-979").tapped = true;
    for (const c of bf(b, "player-1")) if (c.id === "engine-card-976" || c.id === "engine-card-977") c.tapped = true;
    bf(b, "player-0").find((c) => c.id === "engine-card-971").counters = { Fade: 3 };
    bf(b, "player-0").find((c) => c.id === "engine-card-975").counters = { TIME: 3 };
    await boardAs(h, seat, b);
    // (a mana tap later, no trigger: nothing)
    const m = clone(b); bf(m, "player-1").find((c) => c.id === "engine-card-978").tapped = true;
    await boardAs(h, seat, m);
    // (fading with no counter left: its own trigger sacrifices it; the Aeon Engine, going with no such trigger, goes to
    // the graveyard)
    // (as Forge sends it live, the card named; and with its CARDNAME left in)
    const F = "At the beginning of your upkeep, remove a fade counter from Tangle Wire. If you can't, sacrifice Tangle Wire.";
    const B = "At the beginning of your upkeep, remove a fade counter from CARDNAME. If you can't, sacrifice CARDNAME.";
    // (and the Aeon Engine's own trigger beside it, which sacrifices nothing)
    const A = "At the beginning of your upkeep, put a time counter on it.";
    const f = clone(m); f.gameView.stack = [{ id: "stack-fd", sourceId: "engine-card-971", controllerId: "player-0", identity: { name: "Tangle Wire" }, sourceAbilityText: F, text: F, isPermanentSpell: false },
      { id: "stack-ae", sourceId: "engine-card-975", controllerId: "player-0", identity: { name: "Aeon Engine" }, sourceAbilityText: A, text: A, isPermanentSpell: false },
      { id: "stack-bd", sourceId: "engine-card-980", controllerId: "player-0", identity: { name: "Blastoderm" }, sourceAbilityText: B, text: B, isPermanentSpell: false }];
    await boardAs(h, seat, f);
    const g = clone(m);
    const gone = bf(g, "player-0").filter((c) => ["engine-card-971", "engine-card-975", "engine-card-980"].includes(c.id));
    g.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards = bf(g, "player-0").filter((c) => !gone.includes(c));
    g.gameView.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-0").cards.push(...gone);
    await boardAs(h, seat, g);
    return { lines: logLines(h).slice(mark) };
  } });
  // (hp-14 gap: King Macar's inspired: its target picked, then "you may exile target creature" asked: the target named;
  // asked with no pick, or after another card's pick, it stays "target creature")
  for (const what of ["picked", "no pick", "another card's pick"]) {
    add({ name: `hp-14 gap: a may question names its picked target (${what})`, run: async (h) => {
      const start = myMain(D2.board);
      start.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards.push({ id: "engine-card-89", identity: { name: "Garruk's Companion" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "Trample" });
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const T = "Inspired — Whenever King Macar, the Gold-Cursed becomes untapped, you may exile target creature. If you do, create a Gold token. (It's an artifact with \"Sacrifice this token: Add one mana of any color.\")";
      const src = { id: what === "another card's pick" ? "engine-card-16" : "engine-card-15", identity: { name: "King Macar, the Gold-Cursed" }, text: T };
      if (what !== "no pick") {
        h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-89" }], presentation: { title: "Hostile", targets: [] } }), sourceCard: src, promptId: 966 }); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 966, choice: ["card|engine-card-89"] }) }); await h.flush();
      }
      h.B.onPrompt(seat, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Use triggered ability of King Macar, the Gold-Cursed?", description: T, targets: [] } }),
        sourceCard: { ...src, id: "engine-card-15" }, sourceAbilityText: T, promptId: 967 }); await h.flush();
      return { title: seat.prompt?.ui?.title || null, options: (seat.prompt?.ui?.options || []).map((o) => o.label) };
    } });
  }
  // (hp-15 gap: lands put onto the battlefield together (Animist's Awakening): one line per player, tapped ones apart and
  // said tapped)
  add({ name: "log: lands put onto the battlefield together", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const b = clone(start);
    const land = (id, name, o, tapped) => ({ id, identity: { name }, types: ["Land"], ownerId: o, controllerId: o, text: "", tapped });
    b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push(land("engine-card-981", "Command Tower", "player-0", true),
      land("engine-card-982", "Forest", "player-0", true), land("engine-card-983", "Island", "player-0", false), land("engine-card-984", "Exotic Orchard", "player-0", true));
    b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards.push(land("engine-card-985", "Taiga", "player-1", false));
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // (hp-15 gap: Fatal Push's question says whether revolt is on: off at first; on once a permanent of the player's left
  // the battlefield this turn; an opponent's leaving doesn't count)
  for (const whose of ["mine", "theirs"]) {
    add({ name: `hp-15 gap: revolt on or off (${whose} left)`, run: async (h) => {
      const start = myMain(D2.board);
      const bf = (b, o) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === o).cards;
      bf(start, "player-0").push({ id: "engine-card-951", identity: { name: "Evolving Wilds" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" },
        { id: "engine-card-952", identity: { name: "Entity Tracker" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
      bf(start, "player-1").push({ id: "engine-card-953", identity: { name: "Llanowar Elves" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const FP = "Destroy target creature if it has mana value 2 or less.\nRevolt — Destroy that creature if it has mana value 4 or less instead if a permanent you controlled left the battlefield this turn. (You controlled it when it left.)";
      const ask = async (id) => {
        h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { cancellable: true, candidates: [{ id: "engine-card-952", kind: "card" }], chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Destroy" } }),
          sourceAbilityText: FP, promptId: id, sourceCard: { id: "engine-card-954", identity: { name: "Fatal Push" }, text: FP } }); await h.flush();
        return `${seat.prompt?.ui?.title} | ${seat.prompt?.ui?.text || null}`;
      };
      const before = await ask(970);
      const b = clone(start);
      const gone = whose === "mine" ? "engine-card-951" : "engine-card-953";
      for (const z of b.gameView.zones) if (z.zone === "battlefield") z.cards = z.cards.filter((c) => c.id !== gone);
      await boardAs(h, seat, b);
      const after = await ask(971);
      // (the next turn: off again)
      const n = clone(b); n.gameView.turn = (n.gameView.turn || 0) + 1;
      await boardAs(h, seat, n);
      return { before, after, nextTurn: await ask(972) };
    } });
  }
  // (hp-16 gap: For Mirrodin!'s Equipment attached to its Rebel a board after it entered, then moved by equip: each said;
  // the same attachment again, or unattached, says nothing)
  add({ name: "log: an Equipment attached", run: async (h) => {
    const start = myMain(D2.board);
    const bf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
    const card = (id, name, types, extra) => ({ id, identity: { name }, types, ownerId: "player-0", controllerId: "player-0", text: "", ...extra });
    bf(start).push(card("engine-card-139", "Kenrith, the Returned King", ["Creature"]), card("engine-card-3", "Hexplate Wallbreaker", ["Artifact"]), card("engine-card-143", "Rebel Token", ["Creature"], { identity: { name: "Rebel Token", isToken: true } }));
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const on = (host) => { const b = clone(start); const e = bf(b).find((c) => c.id === "engine-card-3"); if (host) e.attachedTo = host; else delete e.attachedTo; return b; };
    await boardAs(h, seat, on("engine-card-143"));
    await boardAs(h, seat, on("engine-card-143"));
    await boardAs(h, seat, on("engine-card-139"));
    await boardAs(h, seat, on(null));
    return logLines(h).slice(mark);
  } });
  // (hp-19 gap: a champion trigger by its keyword, not "champion a")
  add({ name: "log: champion's trigger", run: async (h) => {
    const start = myMain(D2.board);
    start.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-5", identity: { name: "Wanderwine Prophets" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const T = "Champion a Merfolk (When this permanent enters, sacrifice it unless you exile another Merfolk you control. When this permanent leaves the battlefield, return the exiled card to the battlefield under its owner's control.)";
    const b = clone(start); b.gameView.stack = [{ id: "stack-cp", sourceId: "engine-card-5", controllerId: "player-0", identity: { name: "Wanderwine Prophets" }, sourceAbilityText: T, text: T, isPermanentSpell: false }];
    await boardAs(h, seat, b);
    return logLines(h).slice(mark);
  } });
  // (hp-16 gap: Hero of Bladehold attacks: its battle cry by its two words; its Soldiers enter tapped and attacking, said
  // with their arrival, not as declared attackers)
  add({ name: "log: battle cry and tokens entering attacking", run: async (h) => {
    const start = myMain(D2.board);
    const bf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
    const BC = "Battle cry (Whenever this creature attacks, each other attacking creature gets +1/+0 until end of turn.)";
    bf(start).push({ id: "engine-card-17", identity: { name: "Hero of Bladehold" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: BC });
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const a = clone(start); const hero = bf(a).find((c) => c.id === "engine-card-17"); hero.isAttacking = true; hero.tapped = true;
    a.gameView.stack = [{ id: "stack-bc", sourceId: "engine-card-17", controllerId: "player-0", identity: { name: "Hero of Bladehold" }, sourceAbilityText: BC, text: BC, isPermanentSpell: false }];
    await boardAs(h, seat, a);
    const b = clone(a); b.gameView.stack = [];
    for (const id of ["engine-card-981", "engine-card-982"]) bf(b).push({ id, identity: { name: "Soldier Token", isToken: true }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "", isAttacking: true, tapped: true });
    await boardAs(h, seat, b);
    return logLines(h).slice(mark);
  } });
  // (hp-16 gap: Volatile Stormdrake's exchange: each new controller said; energy gained then paid; a board with neither
  // says nothing)
  add({ name: "log: control exchanged and energy", run: async (h) => {
    const start = myMain(D2.board);
    const bf = (b, o) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === o).cards;
    bf(start, "player-0").push({ id: "engine-card-947", identity: { name: "Volatile Stormdrake" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
    bf(start, "player-1").push({ id: "engine-card-45", identity: { name: "Precinct Captain" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const me = (b) => b.gameView.players.find((p) => p.id === "player-0");
    const x = clone(start);
    bf(x, "player-0").find((c) => c.id === "engine-card-947").controllerId = "player-1";
    bf(x, "player-1").find((c) => c.id === "engine-card-45").controllerId = "player-0";
    me(x).counters = { ENERGY: 4 };
    await boardAs(h, seat, x);
    const y = clone(x); me(y).counters = { ENERGY: 2 };
    await boardAs(h, seat, y);
    await boardAs(h, seat, clone(y));
    return logLines(h).slice(mark);
  } });
  // (hp-17 gap: an umbra destroyed instead of its creature (still there) says so; one that goes with its creature, or a
  // plain Aura whose creature stays, doesn't)
  for (const what of ["saves", "dies too", "plain aura"]) {
    add({ name: `log: umbra armor (${what})`, run: async (h) => {
      const start = myMain(D2.board);
      const bf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
      const gy = (b) => b.gameView.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-0").cards;
      const U = what === "plain aura" ? "Enchant creature\nEnchanted creature gets +2/+2." : "Enchant creature\nEnchanted creature gets +2/+2 and has trample.\nUmbra armor (If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura.)";
      bf(start).push({ id: "engine-card-29", identity: { name: "Elegy Acolyte" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" },
        { id: "engine-card-35", identity: { name: "Bear Umbra" }, types: ["Enchantment"], subtypes: ["Aura"], ownerId: "player-0", controllerId: "player-0", text: U, attachedTo: "engine-card-29" });
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const b = clone(start);
      const gone = bf(b).filter((c) => c.id === "engine-card-35" || (what === "dies too" && c.id === "engine-card-29"));
      b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards = bf(b).filter((c) => !gone.includes(c));
      gy(b).push(...gone.map((c) => { const x = clone(c); delete x.attachedTo; return x; }));
      await boardAs(h, seat, b);
      return logLines(h).slice(mark);
    } });
  }
  // (hp-17 gap: the monarch and the initiative, as Forge sends them (monarchId, initiativeHolderId): said when they change
  // hands, and flagged on the table's player rows)
  add({ name: "log: monarch and initiative", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const with_ = (m, i) => { const b = clone(start); if (m) b.gameView.monarchId = m; if (i) b.gameView.initiativeHolderId = i; return b; };
    await boardAs(h, seat, with_("player-0", null));
    await boardAs(h, seat, with_("player-0", null));
    await boardAs(h, seat, with_("player-1", "player-0"));
    const t = h.effects.filter((e) => e.tts && e.tts.t === "table").pop()?.tts;
    // (read from allMarks since trackMarks step 6)
    return { lines: logLines(h).slice(mark), rows: (t?.players || []).map((p) => ({ c: p.color, monarch: (p.allMarks || []).includes("MONARCH"), initiative: (p.allMarks || []).includes("INITIATIVE") })) };
  } });
  // (hp-18 gap: Buried Alive's search into the graveyard says so; with no search just before, the same board is a mill)
  for (const searched of [true, false]) {
    add({ name: `log: library to graveyard (${searched ? "searched" : "milled"})`, run: async (h) => {
      const start = myMain(D2.board);
      const lib = start.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0");
      lib.count = 20;
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const sky = { id: "engine-card-29", identity: { name: "Skyhunter Strike Force" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "", zone: "library" };
      if (searched) {
        const BA = "Search your library for up to three creature cards, put them into your graveyard, then shuffle.";
        h.B.onPrompt(seat, { ...prompt("chooseCards", { cancellable: false, min: 0, max: 3, cards: [sky, { ...sky, id: "engine-card-23", identity: { name: "Moseo, Vein's New Dean" } }], presentation: { description: "", targets: [], title: "Buried Alive" } }),
          sourceAbilityText: BA, sourceCard: { id: "engine-card-952", identity: { name: "Buried Alive" }, text: BA }, promptId: 974 }); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 974, choice: ["engine-card-29"] }) }); await h.flush();
      }
      const b = clone(start);
      b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0").count = 19;
      const { zone, ...card } = sky;
      b.gameView.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-0").cards.push(card);
      await boardAs(h, seat, b);
      return logLines(h).slice(mark);
    } });
  }
  // (hp-18 gap: Avatar's Wrath: permanents exiled together say so in one line, tokens gone together in one line, with
  // counts; one alone keeps its own line)
  for (const many of [true, false]) {
    add({ name: `log: exiled and tokens gone together (${many ? "many" : "one each"})`, run: async (h) => {
      const start = myMain(D2.board);
      const bf = (b, o) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === o).cards;
      const ex = (b, o) => { let z = b.gameView.zones.find((x) => x.zone === "exile" && x.ownerId === o); if (!z) { z = { zone: "exile", ownerId: o, cards: [], count: 0 }; b.gameView.zones.push(z); } return z.cards; };
      const card = (id, name, o, tok) => ({ id, identity: { name, isToken: !!tok }, types: ["Creature"], ownerId: o, controllerId: o, text: "" });
      const mine = many ? [card("engine-card-961", "Izoni, Thousand-Eyed", "player-0"), card("engine-card-962", "Moseo, Vein's New Dean", "player-0"), card("engine-card-963", "Insect Token", "player-0", true), card("engine-card-964", "Insect Token", "player-0", true)]
        : [card("engine-card-961", "Izoni, Thousand-Eyed", "player-0"), card("engine-card-963", "Insect Token", "player-0", true)];
      const theirs = many ? [card("engine-card-965", "Wind Drake", "player-1"), card("engine-card-966", "Survivor Token", "player-1", true)] : [];
      bf(start, "player-0").push(...mine); bf(start, "player-1").push(...theirs);
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const b = clone(start);
      const gone = new Set([...mine, ...theirs].map((c) => c.id));
      for (const o of ["player-0", "player-1"]) {
        const z = b.gameView.zones.find((x) => x.zone === "battlefield" && x.ownerId === o);
        z.cards = z.cards.filter((c) => !gone.has(c.id));
        ex(b, o).push(...[...mine, ...theirs].filter((c) => c.ownerId === o && !c.identity.isToken));
      }
      await boardAs(h, seat, b);
      return logLines(h).slice(mark);
    } });
  }
  // (hp-20 gap: Unexplained Absence resolved (into the graveyard): the AI's face-down card is a cloak; with no such spell
  // the same board keeps the plain line)
  for (const cloak of [true, false]) {
    add({ name: `log: a face-down card ${cloak ? "cloaked" : "put down"}`, run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const b = clone(start);
      b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards.push({ id: "engine-card-991", identity: { name: "?" }, isFaceDown: true, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
      const UA = "For each player, exile up to one target nonland permanent that player controls. For each permanent exiled this way, its controller cloaks the top card of their library.";
      b.gameView.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-0").cards.push({ id: "engine-card-992", identity: { name: cloak ? "Unexplained Absence" : "Opt" }, types: ["Instant"], ownerId: "player-0", controllerId: "player-0", text: cloak ? UA : "Scry 1. Draw a card." });
      await boardAs(h, seat, b);
      return logLines(h).slice(mark).filter((l) => /face down|cloak/i.test(l));
    } });
  }
  // (hp-20 gap: a reveal titled with the AI's engine account name (a face-down card leaving): the log line names it as
  // the table does)
  add({ name: "log: a reveal's raw player name", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const ai = h.B._getGame().playerOrder[1];
    h.B.onPrompt(seat, { ...prompt("revealCards", { zone: "graveyard", cards: [{ id: "engine-card-48", identity: { name: "Garruk's Companion" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" }],
      presentation: { title: `Face-down card leaves the ${ai}'s Battlefield:`, targets: [] } }), sourceCard: { id: "engine-card-959", identity: { name: "Go for the Throat" }, text: "Destroy target nonartifact creature." }, promptId: 976 }); await h.flush();
    return { lines: logLines(h).slice(mark), raw: ai.length > 0 && logLines(h).slice(mark).some((l) => l.includes(ai)) };
  } });
  // (hp-20 gap: a haunt: Blind Hunter, dying, haunts Sisay: its exile says so, Sisay shows "Haunted by Blind Hunter";
  // when Sisay dies, the mark goes)
  add({ name: "log: a haunt", run: async (h) => {
    const start = myMain(D2.board);
    const zone = (b, zn, o) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === o);
    const BH = "Haunt (When this creature dies, exile it haunting target creature.)\nWhen Blind Hunter enters or the creature it haunts dies, target player loses 2 life and you gain 2 life.";
    const hunter = { id: "engine-card-32", identity: { name: "Blind Hunter" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: BH };
    const sisay = { id: "engine-card-140", identity: { name: "Sisay, Weatherlight Captain" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" };
    zone(start, "battlefield", "player-1").cards.push(sisay);
    zone(start, "graveyard", "player-0").cards.push(hunter);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-140", kind: "card" }, { id: "engine-card-64", kind: "card" }], chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Hostile" } }),
      sourceCard: { id: "engine-card-32", identity: { name: "Blind Hunter" }, text: BH }, promptId: 977 }); await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 977, choice: ["card|engine-card-140"] }) }); await h.flush();
    const ex = clone(start); zone(ex, "graveyard", "player-0").cards = zone(ex, "graveyard", "player-0").cards.filter((c) => c.id !== "engine-card-32");
    (zone(ex, "exile", "player-0") || (ex.gameView.zones.push({ zone: "exile", ownerId: "player-0", cards: [], count: 0 }), zone(ex, "exile", "player-0"))).cards.push(clone(hunter));
    await boardAs(h, seat, ex);
    const find = (o, id) => (o && typeof o === "object" ? (o.id === id ? o : Object.values(o).reduce((r, v) => r || find(v, id), null)) : null);
    const kwNow = () => find(h.effects.filter((e) => e.tts && e.tts.t === "table").pop()?.tts, "engine-card-140")?.kw || null;
    const haunted = kwNow();
    const dead = clone(ex); zone(dead, "battlefield", "player-1").cards = zone(dead, "battlefield", "player-1").cards.filter((c) => c.id !== "engine-card-140");
    zone(dead, "graveyard", "player-1").cards.push(clone(sisay));
    await boardAs(h, seat, dead);
    const back = clone(ex); await boardAs(h, seat, back);
    return { lines: logLines(h).slice(mark), haunted, afterDeath: kwNow() };
  } });
  // (hp-21 gap: an enduring story (storied) said once when it comes, and both it and the city's blessing flagged on the
  // table's player rows)
  add({ name: "log: an enduring story", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const b = clone(start); const me = b.gameView.players.find((p) => p.id === "player-0"); me.hasEnduringStory = true; me.hasCityBlessing = true;
    await boardAs(h, seat, b);
    await boardAs(h, seat, clone(b));
    const t = h.effects.filter((e) => e.tts && e.tts.t === "table").pop()?.tts;
    // (read from allMarks since trackMarks step 6)
    return { lines: logLines(h).slice(mark), rows: (t?.players || []).map((p) => ({ c: p.color, blessed: (p.allMarks || []).includes("CITY'S BLESSING"), story: (p.allMarks || []).includes("ENDURING STORY") })) };
  } });
  // (hp-21 gap: cohort's counter on each creature: one line for those getting one each, with counts; another number apart)
  add({ name: "log: +1/+1 counters on several", run: async (h) => {
    const start = myMain(D2.board);
    const bf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
    const card = (id, name, tok) => ({ id, identity: { name, isToken: !!tok }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
    bf(start).push(card("engine-card-971", "Munda's Vanguard"), card("engine-card-972", "Goat Token", true), card("engine-card-973", "Goat Token", true), card("engine-card-974", "Scourge of the Throne"));
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const b = clone(start);
    for (const c of bf(b)) if (["engine-card-971", "engine-card-972", "engine-card-973"].includes(c.id)) c.counters = { P1P1: 1 }; else if (c.id === "engine-card-974") c.counters = { P1P1: 2 };
    await boardAs(h, seat, b);
    return logLines(h).slice(mark);
  } });
  // (hp-23: a land token is created)
  add({ name: "log: a land token is created", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    const start = myMain(D2.board);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    const b = clone(start);
    b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-952", identity: { name: "Everywhere", isToken: true }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" });
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // (hp-18: a land played with a +1/+1 counter (Graft) says it)
  add({ name: "log: a land played with a counter", run: async (h) => {
    const seat = game(h, asLand(myMain(D2.board)));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-play", type: "cast", cardId: "engine-card-74", label: "Play Fire-Belly Changeling", mode: { type: "normal" } }] })); await h.flush();
    await answer(h, 900, ["a-play"]);
    const b = asLand(moved(myMain(D2.board), "engine-card-74", "battlefield"));
    for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-74") c.counters = { P1P1: 1 };
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // (hp-16: a land play whose own enter trigger is on the stack: "plays" and "uses", not "casts" and "puts")
  add({ name: "log: a land play with its own trigger on the stack", run: async (h) => {
    const seat = game(h, asLand(myMain(D2.board)));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-play", type: "cast", cardId: "engine-card-74", label: "Play Fire-Belly Changeling", mode: { type: "normal" } }] })); await h.flush();
    await answer(h, 900, ["a-play"]);
    const b = asLand(moved(myMain(D2.board), "engine-card-74", "battlefield"));
    b.gameView.stack = [{ id: "stack-hide", sourceId: "engine-card-74", controllerId: "player-0", identity: { name: "Fire-Belly Changeling" },
      sourceAbilityText: "Hideaway 4 (When this permanent enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom of your library.)", text: "x" }];
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // Forge sends a land play as a "cast" (AvailableAction_cast for isLandAbility): it was logged "casts" and "plays"
  add({ name: "log: a land play, sent as a cast, is one line: plays", run: async (h) => {
    const seat = game(h, asLand(myMain(D2.board)));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-play", type: "cast", cardId: "engine-card-74", label: "Play Fire-Belly Changeling", mode: { type: "normal" } }] })); await h.flush();
    await answer(h, 900, ["a-play"]);
    await boardAs(h, seat, asLand(moved(myMain(D2.board), "engine-card-74", "battlefield")));
    return { lines: logLines(h).slice(mark), pending: (h.B._getGame().pendingPlays || []).length };
  } });
  // ninjutsu is an ability whose card is in the hand: the stack alone called it a cast; and an ability logged from the
  // record before a board showed it on the stack was logged again when one did
  // ("mtg hold": priority kept once with your own spell on the stack; without it, or with nothing to respond with, or a turn
  // later, it passes as before; "mtg hold off" takes it back)
  for (const [how, cmds, actions, later, empty] of [["held", [{}], true, false], ["not held", [], true, false], ["nothing to respond with", [{}], false, false],
    ["taken back", [{}, { on: false }], true, false], ["a turn later", [{}], true, true], ["an empty stack", [{}], true, false, true]]) {
    add({ name: `hold priority: ${how}`, run: async (h) => {
      const b = myMain(D2.board);
      const seat = game(h, b);
      seat.board = { state: b, fingerprint: null };
      for (const c of cmds) { h.B.onTTS({ t: "hold", json: JSON.stringify({ t: "hold", color: "Blue", ...c }) }); await h.flush(); }
      const on = clone(b);
      on.gameView.stack = [{ id: "engine-stack-71", sourceId: "engine-card-991", controllerId: "player-0", identity: { name: "Lightning Bolt" }, sourceAbilityText: "x" }];
      if (later) on.gameView.turn = (on.gameView.turn || 0) + 1;
      if (empty) { on.gameView.stack = []; on.gameView.step = "combatBegin"; }
      seat.board = { state: on, fingerprint: null };
      const list = actions ? [{ id: "a-fs", type: "cast", cardId: "engine-card-43", label: "Cast Flusterstorm" }] : [];
      h.B.onPrompt(seat, prompt("chooseAction", { actions: list })); await h.flush();
      const first = seat.prompt?.ui?.title ?? "passed";
      seat.prompt = null;
      h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: list }), promptId: 901 }); await h.flush();
      return [first, seat.prompt?.ui?.title ?? "passed"];
    } });
  }
  // (turn timers: each kind of question's answer at zero; the status lines; a manual fix waits; the bank)
  add({ name: "turn timers: the default answers", run: async (h) => {
    game(h, myMain(D2.board));
    const c = h.B._timeoutChoice;
    return [c({ mode: "single", options: [{ id: "__pass" }, { id: "__endturn" }, { id: "a1" }] }), c({ mode: "single", options: [{ id: "keep" }, { id: "mull" }] }),
      c({ mode: "single", options: [{ id: "__auto" }, { id: "tap:1" }, { id: "__cancel" }] }), c({ mode: "single", options: [{ id: "__auto" }, { id: "tap:1" }] }), c({ mode: "single", options: [{ id: "__keep" }, { id: "x" }] }),
      c({ mode: "single", options: [{ id: "auto" }, { id: "hand" }] }), c({ mode: "single", options: [{ id: "ok" }] }), c({ mode: "single", options: [{ id: "yes" }, { id: "no" }] }), c({ mode: "single", options: [{ id: "red" }, { id: "blue" }] }),
      c({ mode: "multi", min: 0, max: 3, options: [{ id: "__allattack" }, { id: "__noattack" }, { id: "a" }] }), c({ mode: "multi", min: 2, max: 2, options: [{ id: "__x" }, { id: "a" }, { id: "b" }, { id: "c" }] }), c({ mode: "number", min: 2, max: 9 }), c({ mode: "number", max: 9 })];
  } });
  add({ name: "turn timers: on, off, a timeout, a pause", run: async (h) => {
    const b = myMain(D2.board);
    const seat = game(h, b);
    seat.board = { state: b, fingerprint: null };
    const said = () => h.effects.filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text || e.tts.msg || "").filter((t) => /timer|time/i.test(t));
    const timer = (m) => h.B.onTTS({ t: "timer", json: JSON.stringify({ t: "timer", ...m }) });
    timer({ on: true, seconds: 90 }); await h.flush();
    const set1 = { ...h.B._getGame().timer };
    timer({ on: true, seconds: 5 }); await h.flush();
    const tooShort = h.B._getGame().timer.seconds;
    timer({ on: true }); await h.flush();
    const kept = h.B._getGame().timer.seconds;
    timer({ on: false }); await h.flush();
    const G = h.B._getGame();
    h.B.onPrompt(seat, prompt("mulligan", { mulliganCount: 0 })); await h.flush();
    const id = seat.prompt.promptId;
    const unarmed = seat.timerFrom == null;
    G.timer = { on: true, seconds: 90 };
    G.fix = { id: 1 };
    h.B._timerExpired(seat, id);
    const paused = seat.prompt?.promptId === id;
    const armed = seat.timerFrom != null;
    h.B._stopTimer(seat, true);
    G.fix = null;
    h.B._timerExpired(seat, id + 1);
    const wrongId = seat.prompt?.promptId === id;
    h.B._timerExpired(seat, id); await h.flush();
    const answered = seat.prompt?.promptId ?? null;
    const bank = seat.timeBank;
    h.B.onPrompt(seat, { ...prompt("mulligan", { mulliganCount: 0 }), promptId: 902 }); await h.flush();
    const firedByItself = seat.prompt?.promptId ?? null;
    h.B._stopTimer(seat, true);
    return { set1, tooShort, kept, unarmed, paused, armed, wrongId, answered, bank, firedByItself, said: said() };
  } });
  // (a board's AI hand over seven discarded at the end of its turn, an instant or sorcery among them; a cast between two
  // boards with no big hand stays the neutral line)
  for (const [how, before] of [["hand over seven", 9], ["hand of five", 5]]) {
    add({ name: `hp-26 gap: log: cleanup's discard (${how})`, run: async (h) => {
      const start = myMain(D2.board);
      const hand = (b) => b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-1");
      hand(start).count = before; start.gameView.activePlayerId = "player-1"; start.gameView.turn = 7;
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const b = clone(start); hand(b).count = before - 1; b.gameView.activePlayerId = "player-0"; b.gameView.turn = 8;
      b.gameView.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-1").cards.push({ id: "engine-card-946", identity: { name: "Deep Analysis" }, types: ["Sorcery"], ownerId: "player-1", controllerId: "player-1", text: "" });
      await boardAs(h, seat, b);
      return logLines(h).slice(mark);
    } });
  }
  // (hp-24 gap: Goblin Guide's land revealed and put into the hand reads as put there, not drawn)
  add({ name: "hp-24 gap: log: a revealed card put into the hand", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const text = "Whenever this creature attacks, defending player reveals the top card of their library. If it's a land card, that player puts it into their hand.";
    const look = { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75)] }), sourceAbilityText: text, sourceCard: { id: "engine-card-947", identity: { name: "Goblin Guide" }, text } };
    h.B.onPrompt(seat, look); await h.flush();
    await answer(h, look.promptId, ["ok"]);
    const mark = logLines(h).length;
    const b = clone(start);
    const lib = b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0"); lib.count = (lib.count ?? (lib.cards || []).length) - 1;
    const hand = b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0"); hand.count = (hand.count ?? (hand.cards || []).length) + 1;
    await boardAs(h, seat, b);
    return logLines(h).slice(mark);
  } });
  // (mechanic run 2026-11-05: a revealed card into the hand is named, but only when as many went as were revealed:
  // four revealed and one into the hand is still "a card")
  add({ name: "mechanic run: log: four revealed, one put into the hand", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const text = "Reveal the top four cards of your library. You may choose a land card among them and put that card into your hand. Put the rest into your graveyard.";
    const look = { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75), H(77), H(43), H(35)] }), sourceAbilityText: text, sourceCard: { id: "engine-card-949", identity: { name: "Satyr Wayfinder" }, text } };
    h.B.onPrompt(seat, look); await h.flush();
    await answer(h, look.promptId, ["ok"]);
    const mark = logLines(h).length;
    const b = clone(start);
    const lib = b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0"); lib.count = (lib.count ?? (lib.cards || []).length) - 1;
    const hand = b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0"); hand.count = (hand.count ?? (hand.cards || []).length) + 1;
    await boardAs(h, seat, b);
    return logLines(h).slice(mark);
  } });
  // (mechanic run hp-26 re-test 2026-11-05: the board that puts it in the hand inside the reveal's 2 s hold: the reveal
  // first, then the card by name; Dark Confidant's read "puts Mountain into their hand" above "reveals Mountain")
  add({ name: "mechanic run: log: a revealed card put into the hand, in one board", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const text = "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.";
    const look = { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75)] }), sourceAbilityText: text, sourceCard: { id: "engine-card-951", identity: { name: "Dark Confidant" }, text } };
    const mark = logLines(h).length;
    h.B.onPrompt(seat, look);
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: look.promptId, choice: ["ok"] }) });
    const b = clone(start);
    const lib = b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0"); lib.count = (lib.count ?? (lib.cards || []).length) - 1;
    const hand = b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0"); hand.count = (hand.count ?? (hand.cards || []).length) + 1;
    await boardAs(h, seat, b);
    return logLines(h).slice(mark);
  } });
  // (mechanic run hp-40 2026-11-05: a board still waiting to be sent when its priority passes by itself: Fire's prowess
  // trigger was on it, resolved before the next board, and the log never said it. Sent first, it is said; with no new
  // stack item the board waits as before)
  for (const [how, trig] of [["a new trigger", true], ["nothing new", false]]) {
    add({ name: `log: a priority passed by itself with a waiting board: ${how}`, run: async (h) => {
      const start = myMain(D2.board);
      start.gameView.stack = [{ id: "stack-8", controllerId: "player-0", sourceId: "engine-card-501", identity: { name: "Opt" }, text: "Scry 1. Draw a card." }];
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const b2 = clone(start);
      if (trig) b2.gameView.stack.push({ id: "stack-9", controllerId: "player-0", sourceId: "engine-card-75", identity: { name: "Hurloon Minotaur" }, isTrigger: true,
        sourceAbilityText: "Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)", text: "Prowess" });
      seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: b2 });
      h.B.onPrompt(seat, prompt("chooseAction", { actions: [] }));
      const b3 = clone(start); b3.gameView.stack = [];
      seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: b3 });
      await h.flush();
      return logLines(h).slice(mark);
    } });
  }
  // (and only the same player's library reveal, once: another player's reveal, a graveyard's, or one already said, then a
  // search of your own is still "a card")
  for (const [how, owner, zone, twice] of [["another player's", "player-1", "library", false], ["a graveyard's", "player-0", "graveyard", false], ["one already named", "player-0", "library", true]]) {
    add({ name: `mechanic run: log: a put after ${how} reveal`, run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const text = "Reveal the top card of your library. That player puts it into their hand.";
      const look = { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: owner, zone, cards: [H(75)] }), sourceAbilityText: text, sourceCard: { id: "engine-card-950", identity: { name: "Goblin Guide" }, text } };
      h.B.onPrompt(seat, look); await h.flush();
      await answer(h, look.promptId, ["ok"]);
      const mark = logLines(h).length;
      let b = clone(start);
      const step = () => { b = clone(b); const lib = b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0"); lib.count = (lib.count ?? (lib.cards || []).length) - 1;
        const hand = b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0"); hand.count = (hand.count ?? (hand.cards || []).length) + 1; return b; };
      if (twice) await boardAs(h, seat, step());
      seat.note("search", seat.slot);
      await boardAs(h, seat, step());
      return logLines(h).slice(mark);
    } });
  }
  // (hp-24 gap: a cast the log had said, cancelled while paying, says so; hp-23 gap: a player's own pick by a card)
  add({ name: "hp-24 gap: log: a said cast cancelled", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    (h.B._getGame().log ??= []).push("Blue casts Silvergill Adept");
    h.B.onPrompt(seat, prompt("payManaCost", { manaCost: "{4}{U}", cardId: "engine-card-948", cardName: "Silvergill Adept", actions: [] })); await h.flush();
    await answer(h, 900, ["__cancel"]);
    return logLines(h).slice(mark);
  } });
  for (const [how, title] of [["mine", "Blue picked AI 1"], ["another's", "Red picked Blue"]]) {
    add({ name: `hp-23 gap: log: a player chosen by a card (${how})`, run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const mark = logLines(h).length;
      h.B.onPrompt(seat, { ...prompt("revealCards", { presentation: { title, targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [] }), sourceCard: { id: "engine-card-949", identity: { name: "Incarnation Technique" }, text: "x" } }); await h.flush();
      return logLines(h).slice(mark);
    } });
  }
  // (hp-23 gap: a land taken from another player's library says whose; one beside an unrelated spell at that player, or
  // from your own library by a "target player" spell, doesn't)
  for (const [how, text, target] of [["from the AI's library", "Search target opponent's library for a land card.", "player-1"], ["a spell at the AI", "Target player discards a card.", "player-1"], ["your own library", "Search target player's library for a land card.", "player-0"]]) {
    add({ name: `hp-23 gap: log: a land put onto the battlefield (${how})`, run: async (h) => {
      const start = myMain(D2.board);
      start.gameView.stack = [{ id: "engine-stack-81", sourceId: "engine-card-956", controllerId: "player-0", identity: { name: "A Spell" }, sourceAbilityText: text, targets: [{ kind: "player", id: target }] }];
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const b = clone(start); b.gameView.stack = [];
      b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-957", identity: { name: "Urborg, Tomb of Yawgmoth" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" });
      await boardAs(h, seat, b);
      return logLines(h).slice(mark);
    } });
  }
  // (re-test 2026-10-31: a double-faced card's back face cast by its own name; a land played from exile; one that returns from
  // exile by an effect stays "returns")
  add({ name: "re-test: log: a back face cast, a land played from exile", run: async (h) => {
    const start = myMain(D2.board);
    const hand = start.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0");
    hand.cards.push({ id: "engine-card-961", identity: { name: "Valki, God of Lies" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", isDoubleFaced: true, text: "" });
    const ex = start.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-0");
    ex.cards.push({ id: "engine-card-962", identity: { name: "Plains" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" }, { id: "engine-card-963", identity: { name: "Island" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" });
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-t", type: "cast", cardId: "engine-card-961", label: "Cast Tibalt, Cosmic Impostor" }, { id: "a-p", type: "cast", cardId: "engine-card-962", label: "Play Plains" }] })); await h.flush();
    await answer(h, 900, ["a-t"]);
    const c = clone(start);
    c.gameView.stack = [{ id: "s1", sourceId: "engine-card-961", controllerId: "player-0", identity: { name: "Valki, God of Lies" } }];
    await boardAs(h, seat, c);
    (h.B._getGame().pendingPlays ??= []).push({ id: "engine-card-962", name: "Plains", ctl: "player-0", kind: "cast", at: Date.now(), promptId: -2 });
    const d = clone(start);
    const bf = d.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
    const dex = d.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-0");
    bf.cards.push(...dex.cards.filter((x) => /engine-card-96[23]/.test(x.id)));
    dex.cards = dex.cards.filter((x) => !/engine-card-96[23]/.test(x.id));
    await boardAs(h, seat, d);
    return logLines(h).slice(mark);
  } });
  // (hp-24 gap: commander ninjutsu, fortify and aura swap by name; what ninjutsu and aura swap send back reads as returned,
  // the hand level as one card went in and one came out; a card gone with no such swap still only leaves)
  for (const [how, description, card] of [["commander ninjutsu", "Commander Ninjutsu {U}{B} ({U}{B}, Return an unblocked attacker you control to hand: Put this card onto the battlefield.)", "engine-card-43"],
    ["aura swap", "Aura swap {2}{U} ({2}{U}: You may exchange this Aura with an Aura card in your hand.)", "engine-card-43"],
    ["fortify", "Fortify {3} ({3}: Attach to target land you control. Fortify only as a sorcery.)", "engine-card-43"]]) {
    add({ name: `hp-24 gap: log: ${how}`, run: async (h) => {
      const bf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
      const creature = (id, name) => ({ id, identity: { name }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
      const start = myMain(D2.board);
      bf(start).cards.push(creature("engine-card-956", "Dryad Sophisticate"));
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-kw", type: "activateAbility", cardId: card, description }] })); await h.flush();
      await answer(h, 900, ["a-kw"]);
      h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: [] }), promptId: 905 }); await h.flush();
      const after = clone(start);
      bf(after).cards = bf(after).cards.filter((c) => c.id !== "engine-card-956");
      bf(after).cards.push(creature("engine-card-957", "Yuriko, the Tiger's Shadow"));
      await boardAs(h, seat, after);
      return logLines(h).slice(mark);
    } });
  }
  for (const [how, kind, ctl, token] of [["another keyword's record", "fortify", "player-0", false], ["another player's record", "ninjutsu", "player-1", false], ["a token arriving", "ninjutsu", "player-0", true]]) {
    add({ name: `hp-24 gap: log: no swap from the hand (${how})`, run: async (h) => {
      const bf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
      const creature = (id, name, tok) => ({ id, identity: { name, isToken: tok }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
      const start = myMain(D2.board);
      bf(start).cards.push(creature("engine-card-956", "Dryad Sophisticate", false));
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      (h.B._getGame().pendingPlays ??= []).push({ id: "engine-card-959", name: "Some Card", ctl, kind, at: Date.now(), promptId: -2 });
      if (ctl === "player-0" && kind === "ninjutsu") seat.note("handSwap", "engine-card-959");
      const after = clone(start);
      bf(after).cards = bf(after).cards.filter((c) => c.id !== "engine-card-956");
      bf(after).cards.push(creature("engine-card-957", token ? "Goblin Token" : "Yuriko, the Tiger's Shadow", token));
      await boardAs(h, seat, after);
      return logLines(h).slice(mark);
    } });
  }
  add({ name: "log: an ability from the hand (ninjutsu) is logged as an ability, once", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-nin", type: "activateAbility", cardId: "engine-card-43", description: "Ninjutsu {1}{B}" }] })); await h.flush();
    await answer(h, 900, ["a-nin"]);
    h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: [] }), promptId: 905 }); await h.flush();
    await boardAs(h, seat, myMain(D2.board));
    const early = logLines(h).slice(mark);
    const onStack = myMain(D2.board);
    onStack.gameView.stack = [{ id: "s1", sourceId: "engine-card-43", controllerId: "player-0", identity: { name: "Vraska's Fall" }, sourceAbilityText: "Ninjutsu {1}{B}", isPermanentSpell: false }];
    await boardAs(h, seat, onStack);
    await boardAs(h, seat, myMain(D2.board));
    return { early, lines: logLines(h).slice(mark) };
  } });
  // (an early "casts" line hides only the spell: the card's own enter trigger after it is still said, keyword sweep)
  add({ name: "log: a cast said early leaves its card's enter trigger to be said", run: async (h) => {
    const visionary = { id: "engine-card-960", identity: { name: "Elvish Visionary" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" };
    const inHand = myMain(D2.board);
    inHand.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards.push(visionary);
    const seat = game(h, inHand);
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-cast", type: "cast", cardId: "engine-card-960", label: "Cast Elvish Visionary", mode: { type: "normal" } }] })); await h.flush();
    await answer(h, 900, ["a-cast"]);
    const entered = myMain(D2.board);
    entered.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-960", identity: { name: "Elvish Visionary" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
    await boardAs(h, seat, entered);
    const trigger = clone(entered);
    trigger.gameView.stack = [{ id: "s9", sourceId: "engine-card-960", controllerId: "player-0", identity: { name: "Elvish Visionary" }, sourceAbilityText: "When Elvish Visionary enters, draw a card.", isPermanentSpell: false }];
    await boardAs(h, seat, trigger);
    return { lines: logLines(h).slice(mark) };
  } });
  add({ name: "log: the stack names an ability from the hand by the player's own record", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-nin", type: "activateAbility", cardId: "engine-card-43", description: "Ninjutsu {1}{B}" }] })); await h.flush();
    await answer(h, 900, ["a-nin"]);
    const onStack = myMain(D2.board);
    onStack.gameView.stack = [{ id: "s1", sourceId: "engine-card-43", controllerId: "player-0", identity: { name: "Vraska's Fall" }, sourceAbilityText: "Ninjutsu {1}{B}", isPermanentSpell: false }];
    await boardAs(h, seat, onStack);
    return { lines: logLines(h).slice(mark) };
  } });
  // Cancel forgets only what it cancelled: an earlier ability not logged yet is still logged
  add({ name: "log: a cancelled cast leaves an earlier ability's line", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-wilds", type: "activateAbility", cardId: "engine-card-22", description: "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card." }, ...acts] })); await h.flush();
    await answer(h, 900, ["a-wilds"]);
    h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: acts }), promptId: 902 }); await h.flush();
    await answer(h, 902, ["a-cast1"]);
    h.B.onPrompt(seat, { ...prompt("payManaCost", { cardId: "engine-card-75", cardName: "Hurloon Minotaur", manaCost: "{1}{R}{R}", canConfirmFromPool: false, actions: [] }), promptId: 903 }); await h.flush();
    await answer(h, 903, ["__cancel"]);
    h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: acts }), promptId: 905 }); await h.flush();
    await boardAs(h, seat, moved(myMain(D2.board), "engine-card-22", "graveyard"));
    return { lines: logLines(h).slice(mark) };
  } });
  // a cancelled cast cast again: one "casts" line (the cancelled record is gone, not left to be said with the second)
  add({ name: "log: a cast cancelled and cast again is one cast line", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: acts })); await h.flush();
    await answer(h, 900, ["a-cast1"]);
    h.B.onPrompt(seat, { ...prompt("payManaCost", { cardId: "engine-card-75", cardName: "Hurloon Minotaur", manaCost: "{1}{R}{R}", canConfirmFromPool: false, actions: [] }), promptId: 901 }); await h.flush();
    await answer(h, 901, ["__cancel"]);
    h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: acts }), promptId: 902 }); await h.flush();
    await answer(h, 902, ["a-cast1"]);
    await boardAs(h, seat, moved(myMain(D2.board), "engine-card-75", "battlefield"));
    return { lines: logLines(h).slice(mark) };
  } });
  // two activations of one ability shown together on the stack: two lines, and nothing said again later
  add({ name: "log: the same ability twice on the stack is two lines, once", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    const wilds = { id: "a-wilds", type: "activateAbility", cardId: "engine-card-22", description: "{T}: Draw a card." };
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [wilds] })); await h.flush();
    await answer(h, 900, ["a-wilds"]);
    h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: [wilds] }), promptId: 902 }); await h.flush();
    await answer(h, 902, ["a-wilds"]);
    const two = myMain(D2.board);
    const item = (id) => ({ id, sourceId: "engine-card-22", controllerId: "player-0", identity: { name: "Evolving Wilds" }, sourceAbilityText: "{T}: Draw a card.", isPermanentSpell: false });
    two.gameView.stack = [item("s1"), item("s2")];
    await boardAs(h, seat, two);
    h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: [] }), promptId: 905 }); await h.flush();
    await boardAs(h, seat, myMain(D2.board));
    return { lines: logLines(h).slice(mark) };
  } });
  // a commander cast from the command zone (public already) and resolved between boards is logged as a cast (hp-07 #39)
  add({ name: "log: a commander cast from the command zone is one cast line", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    const mark = logLines(h).length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-cmd", type: "cast", cardId: "engine-card-199", label: "Cast commander", mode: { type: "normal" } }] })); await h.flush();
    await answer(h, 900, ["a-cmd"]);
    await boardAs(h, seat, moved(myMain(D2.board), "engine-card-199", "battlefield"));
    return { lines: logLines(h).slice(mark) };
  } });
  // a rewind undoes End turn: the redone turn's priority was answered by itself
  add({ name: "rewind: End turn pressed before a rewind in the same turn does not pass the redone turn", run: async (h) => {
    const at = (n) => { const b = myMain(D2.board); b.gameView.checkpoints = Array.from({ length: n }, (_, i) => ({ checkpointId: 100 + i, turn: b.gameView.turn, step: "main1", activePlayerId: "player-0" })); return b; };
    const seat = game(h, at(5));
    const feed = async (b) => { seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: b }); await h.flush(); };
    await feed(at(5));
    seat.endTurnAt = seat.board.state.gameView.turn;
    await feed(at(3));
    h.B.onPrompt(seat, prompt("chooseAction", { actions: acts })); await h.flush();
    return { endTurnAt: seat.endTurnAt ?? null, open: seat.prompt ? seat.prompt.ui?.title : null, sent: sent(h) };
  } });
  // a rewind is one log line, and the board it went back to is not told as plays (hp-07 #36)
  add({ name: "log: a rewind is one line, not the board difference told as plays", run: async (h) => {
    const at = (n, b0) => { const b = clone(b0); b.gameView.checkpoints = Array.from({ length: n }, (_, i) => ({ checkpointId: 100 + i, turn: b.gameView.turn, step: "main1", activePlayerId: "player-0" })); return b; };
    const seat = game(h, at(5, myMain(D2.board)));
    const feed = async (b) => { seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: b }); await h.flush(); h.B.sendTable(); await h.flush(); };
    await feed(at(5, moved(myMain(D2.board), "engine-card-75", "battlefield")));
    const mark = logLines(h).length;
    await feed(at(3, myMain(D2.board)));
    return { lines: logLines(h).slice(mark) };
  } });
  // a rewind to the newest restore point in the same turn: only Forge's approved vote shows it (hp-07 #36 re-test)
  add({ name: "rewind: to the newest point in the same turn, told by the approved vote", run: async (h) => {
    const at = (vote, b0) => { const b = clone(b0); b.gameView.checkpoints = Array.from({ length: 3 }, (_, i) => ({ checkpointId: 100 + i, turn: b.gameView.turn, step: "main1", activePlayerId: "player-0" })); b.gameView.restoreVote = vote; return b; };
    const approved = (id) => ({ voteId: id, status: { type: "approved" }, awaitingPlayerIds: [], requestedByPlayerId: "player-0" });
    const seat = game(h, at(approved(1), myMain(D2.board)));
    const feed = async (b) => { seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: b }); await h.flush(); h.B.sendTable(); await h.flush(); };
    await feed(at(approved(1), moved(myMain(D2.board), "engine-card-75", "battlefield")));
    const firstSeen = logLines(h).filter((l) => /Rewound/.test(l)).length;
    seat.endTurnAt = seat.board.state.gameView.turn;
    const mark = logLines(h).length;
    await feed(at(approved(2), myMain(D2.board)));
    return { firstSeen, lines: logLines(h).slice(mark), endTurnAt: seat.endTurnAt ?? null };
  } });
  // the end-of-game reason names who lost last, not a player out earlier
  add({ name: "game over: a player who lost earlier is not named", run: async (h) => {
    const seat = game(h, D2.board);
    const feed = async (b) => { seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: b }); await h.flush(); };
    const first = clone(D2.board);
    Object.assign(first.gameView.players.find((p) => p.id === "player-1"), { life: -3, status: "lost" });
    await feed(first);
    const last = clone(first);
    Object.assign(last.gameView.players.find((p) => p.id === "player-0"), { life: 0, status: "lost" });
    await feed(last);
    h.B.onPrompt(seat, prompt("gameOver", {})); await h.flush();
    return null;
  } });
  // another ability's "unless you pay" on the same card: the whole card's text does not tell this question's Yes and No
  add(promptCase("may pay: the card's other ability says unless you pay: Yes and No the plain way", myMain(D2.board),
    prompt("chooseBoolean", { confirmLabel: "Pay", denyLabel: "Decline", presentation: { title: "Pay {1}?", text: `otherwise: "Sacrifice Foo."` } },
      { sourceCard: { id: "engine-card-22", identity: { name: "Foo" }, text: "When Foo enters, you may pay {2}. If you do, draw a card. At the beginning of your upkeep, sacrifice Foo unless you pay {1}." } }), []));
  // Pay on someone else's card's question: the payment after it still asks (a tax is not your own play)
  add({ name: "pay: after Pay on another player's card's question, the payment still asks", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, prompt("chooseBoolean", { confirmLabel: "Pay", denyLabel: "Decline",
      presentation: { title: "Pay {1}?", text: `otherwise: "AI 1 draws a card."` } },
      { sourceCard: { id: "engine-card-950", controllerId: "player-1", identity: { name: "Rhystic Study" }, text: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}." } })); await h.flush();
    await answer(h, 900, ["yes"]);
    h.B.onPrompt(seat, { ...prompt("payManaCost", { cardId: "engine-card-950", cardName: "Rhystic Study", manaCost: "{1}", canConfirmFromPool: true, actions: [] }), promptId: 901 }); await h.flush();
    return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
  } });
  // a payment that names no card is never "the card just tapped for"
  add(promptCase("pay: a payment without a card is not taken for the card tapped for", myMain(D2.board),
    prompt("payManaCost", { cardId: "", manaCost: "{1}", canConfirmFromPool: true, actions: [] }), [], { seat: { tappedFor: "" } }));
  // Forge's description says what the pick does: two same-name legendaries do not make it the legend rule
  add(promptCase("legend rule: not when Forge's description says otherwise", myMain(D2.board), prompt("chooseCards", { min: 1, max: 1,
    cards: [{ ...H(75), zone: "battlefield", supertypes: ["Legendary"] }, { ...H(75), id: "engine-card-176", zone: "battlefield", supertypes: ["Legendary"] }],
    presentation: { title: "Choose", description: "Choose a creature to exile" } }), [["engine-card-75"]]));
  // only the COST of the ability just used is confirmed: an effect's "you may sacrifice" is the player's decision
  add({ name: "sacrifice confirm: the effect's own sacrifice (not its cost) asks", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-x", type: "activateAbility", cardId: "engine-card-22", description: "{T}: You may sacrifice Evolving Wilds. If you do, draw a card." }] })); await h.flush();
    await answer(h, 900, ["a-x"]);
    h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { title: "Sacrifice Evolving Wilds?" } }), promptId: 901 }); await h.flush();
    return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
  } });
  // a look at the library last turn says nothing about this turn's draw
  add({ name: "log: a draw on the turn after a look at the library is a draw", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.sendTable(); await h.flush();
    h.B.onPrompt(seat, prompt("revealCards", { presentation: { title: "Look at these cards" }, ownerPlayerId: "player-0-view", zone: "library", cards: [H(43)] })); await h.flush();
    await answer(h, 900, ["ok"]);
    const mark = logLines(h).length;
    const b = myMain(D2.board);
    b.gameView.turn += 1;
    const hand = b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0"), lib = b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0");
    hand.cards.push({ ...H(43), id: "engine-card-990" }); hand.count = hand.cards.length; lib.count = (lib.count ?? 0) - 1;
    await boardAs(h, seat, b);
    return { lines: logLines(h).slice(mark) };
  } });
  // keywords another card gave it are sent in words; its own and Forge's internal ones are not (hp-07 #31)
  add({ name: "table: granted keywords are sent in words", run: async (h) => {
    const b = clone(D2.board);
    for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-75") c.keywords = ["Toxic:1", "Hexproof:Red", "Landwalk:Swamp", "Protection:Card.Black:black", "ETBReplacement:Other:ChooseCT", "Toxic:1", "Chapter:3:DBSacrifice,DBDiscard,DBChangeZone", "MayFlashSac", "AlternateAdditionalCost:1:Sac"]; // (as Forge sent them live)
    game(h, b);
    h.B.sendTable(); await h.flush();
    const cards = h.effects.filter((e) => e.tts && e.tts.t === "table").flatMap((e) => (e.tts.players || []).flatMap((p) => Object.values(p).filter(Array.isArray).flat()));
    return { kw: cards.filter((c) => c && (c.id === "engine-card-75" || c.id === "engine-card-74")).map((c) => [c.id, c.kw ?? null]) };
  } });
  // Forge's live title has no "?" ("Sacrifice Dauthi Voidwalker", hp-07 #32 re-test): still the cost just paid
  add({ name: "sacrifice confirm: Forge's bare title (no ?) after its own ability is answered yes", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-d", type: "activateAbility", cardId: "engine-card-22", description: "{T}, Sacrifice Dauthi Voidwalker: Choose an exiled card an opponent owns with a void counter on it." }] })); await h.flush();
    await answer(h, 900, ["a-d"]);
    h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { targets: [], title: "Sacrifice Dauthi Voidwalker" } }, { sourceCard: { id: "engine-card-22", identity: { name: "Dauthi Voidwalker" } } }), promptId: 901 }); await h.flush();
    return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
  } });
  // "up to N" targets answered at once: Forge's one-at-a-time follow-ups are answered from the player's picks (hp-07 #38)
  {
    const tq = (promptId, chosenTargets) => ({ ...prompt("chooseBoardTargets", { minTargets: 0, maxTargets: 2, chosenTargets, candidates: [{ kind: "player", id: "player-0" }, { kind: "player", id: "player-1" }],
      presentation: { title: "Choose players to mill" } }, { sourceCard: { id: "engine-card-37", identity: { name: "Riverchurn Monument" } } }), promptId });
    const run = (picks, follow) => async (h) => {
      const seat = game(h, myMain(D2.board));
      h.B.onPrompt(seat, tq(900, 0)); await h.flush();
      await answer(h, 900, picks);
      for (const [k, n] of follow.entries()) { h.B.onPrompt(seat, tq(901 + k, n)); await h.flush(); }
      return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
    };
    add({ name: "targets: one pick of up to 2, Forge's 'another?' is answered Done", run: run(["player|player-1"], [1]) });
    add({ name: "targets: two picks, Forge takes one at a time: the second is sent, then Done", run: run(["player|player-0", "player|player-1"], [1, 2]) });
  }
  // ── hp-12 hand test 2026-10-27 (texts as Forge sent them live) ──
  const DEADEYE = "Soulbond (You may pair this creature with another unpaired creature when either enters. They remain paired for as long as you control both of them.)\nAs long as Deadeye Navigator is paired with another creature, each of those creatures has \"{1}{U}: Exile this creature, then return it to the battlefield under your control.\"";
  const ANAFENZA = "Whenever another nontoken creature you control enters, bolster 1. (Choose a creature with the least toughness among creatures you control and put a +1/+1 counter on it.)";
  const TITHING = "When Tithing Blade enters, each opponent sacrifices a creature.\nCraft with creature {4}{B} ({4}{B}, Exile this artifact, Exile a creature you control or a creature card from your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)";
  const pick = (name, text, min, max, cards) => prompt("chooseCards", { min, max, cards, presentation: { title: name } }, { sourceCard: { id: "engine-card-22", identity: { name }, text } });
  // #1 Soulbond's pairing, #10 Craft's exiled creature, #11 Bolster's creature: said what they are for
  add(promptCase("soulbond: the pairing question says it pairs", myMain(D2.board), pick("Deadeye Navigator", DEADEYE, 0, 1, [H(75), H(35)]), []));
  add(promptCase("craft: the exile question says it is for Craft", myMain(D2.board), pick("Tithing Blade", TITHING, 1, 1, [H(75), H(35)]), []));
  // (hp-12 re-test: Soulbond on another creature entering pairs that one, with the source as the choice)
  const DEADEYE_CARD = { ...H(75), identity: { ...H(75).identity, name: "Deadeye Navigator" } };
  const enterPick = (abilityText) => ({ ...pick("Deadeye Navigator", DEADEYE, 0, 1, [DEADEYE_CARD]), ...(abilityText ? { sourceAbilityText: abilityText } : {}) });
  add(promptCase("soulbond: another creature entered, named from Forge's note", myMain(D2.board),
    enterPick("Whenever another unpaired creature enters, you may pair it with Deadeye Navigator [Zone Changer: Apex Altisaur (12)]"), []));
  add(promptCase("soulbond: another creature entered, no note: the source isn't named as the one paired", myMain(D2.board), enterPick(null), []));
  // (as Forge sent it live: no note in the prompt; the trigger's stack item, still on the stack, has it)
  {
    const b = myMain(D2.board);
    b.gameView.stack = [{ id: "stack-8", identity: { name: "Lunarch Veteran" }, sourceId: "engine-card-31", controllerId: "player-0",
      sourceAbilityText: "Whenever another creature you control enters, you gain 1 life.", text: "Whenever another creature you control enters, you gain 1 life. [Zone Changer: Wrong Creature (9)]" },
    { id: "stack-9", identity: { name: "Deadeye Navigator" }, sourceId: "engine-card-22", controllerId: "player-0",
      sourceAbilityText: "When another unpaired creature you control enters, you may pair it with Deadeye Navigator",
      text: "When another unpaired creature you control enters, you may pair it with Deadeye Navigator [Zone Changer: Apex Altisaur (151)]" }];
    add(promptCase("soulbond: another creature entered, named from the trigger on the stack", b,
      { ...enterPick("When another unpaired creature you control enters, you may pair it with Deadeye Navigator") }, []));
  }
  // (as our Forge build sent them live: Improvise's taps are "mana abilities" with no cost, no mana and no ability
  // number; the spell's text names the kind. A spell without it keeps "Tap X")
  {
    const live = (text) => {
      const b = myMain(D2.board);
      for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-75") c.text = text;
      return promptCase(`pay: a live Improvise tap is named from the spell's text (${text ? "Improvise" : "no keyword"})`, b,
        prompt("payManaCost", { cardId: "engine-card-75", cardName: "Kappa Cannoneer", manaCost: "{5}{U}", canConfirmFromPool: false, actions: [
          { abilityIndex: 0, cardId: "engine-card-22", description: "Consuming Sepulcher", id: "tap:engine-card-22", isClassLevelUp: false, isManaAbility: true, type: "activateManaAbility" },
          { abilityIndex: 0, cardId: "engine-card-74", cost: "{T}", description: "Power Depot", id: "tap:engine-card-74:0", isClassLevelUp: false, isManaAbility: true, producedMana: [{ amount: 1, color: "C" }], type: "activateManaAbility" }] }), []);
    };
    add(live("Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)\nWard {4}"));
    add(live(""));
    // (the spell being paid for is on the stack, in no zone: its text is the one the table was sent while it was in
    // the hand)
    add({ name: "pay: an Improvise spell paid from the stack is named from its text sent earlier", run: async (h) => {
      const b = myMain(D2.board);
      for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-75") c.text = "Improvise (Your artifacts can help cast this spell.)";
      const seat = game(h, b);
      h.B.sendTable(); await h.flush();
      const later = clone(b);
      for (const z of later.gameView.zones) z.cards = (z.cards || []).filter((c) => c.id !== "engine-card-75");
      seat.board = { state: later, fingerprint: null };
      h.B.onPrompt(seat, prompt("payManaCost", { cardId: "engine-card-75", cardName: "Kappa Cannoneer", manaCost: "{5}{U}", canConfirmFromPool: false, actions: [
        { abilityIndex: 0, cardId: "engine-card-22", description: "Consuming Sepulcher", id: "tap:engine-card-22", isClassLevelUp: false, isManaAbility: true, type: "activateManaAbility" }] }));
      await h.flush();
      return { labels: seat.prompt?.ui?.options?.map((o) => o.label) || null };
    } });
  }
  // (hp-12 re-test: an Improvise tap read "Tap Consuming Sepulcher", like a mana ability)
  add(promptCase("pay: an Improvise tap says what it pays", myMain(D2.board), prompt("payManaCost", { cardId: "engine-card-75", cardName: "Kappa Cannoneer", manaCost: "{5}{U}", canConfirmFromPool: false,
    actions: [{ id: "tap:engine-card-22", type: "useResource", resource: "improvise", cardId: "engine-card-22", description: "Consuming Sepulcher" },
      { id: "untap:engine-card-74", type: "releaseResource", resource: "convoke", cardId: "engine-card-74" },
      { id: "use:engine-card-43", type: "useResource", resource: "newKind", cardId: "engine-card-43" }] }), []));
  add(promptCase("bolster: the question says which creature gets the counters", myMain(D2.board), pick("Anafenza, Kin-Tree Spirit", ANAFENZA, 1, 1, [H(75), H(35)]), []));
  // #11 a pick that must be made of the only card there is: answered
  add(promptCase("choose a card: one required pick of one card is answered", myMain(D2.board), pick("Anafenza, Kin-Tree Spirit", ANAFENZA, 1, 1, [{ ...H(75), zone: "battlefield", controllerId: "player-0" }]), []));
  // (suite review: a pick that can be cancelled - a cost's sacrifice - keeps its question; so does a card in a hand)
  add(promptCase("choose a card: one cancellable pick is still asked", myMain(D2.board), { ...pick("Village Rites", "As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.", 1, 1, [{ ...H(75), zone: "battlefield", controllerId: "player-0" }]), input: { ...pick("Village Rites", "", 1, 1, [{ ...H(75), zone: "battlefield", controllerId: "player-0" }]).input, cancellable: true } }, []));
  add(promptCase("choose a card: one card in a hand is still shown", myMain(D2.board), pick("Duress", "Target opponent reveals their hand. You choose a noncreature, nonland card from it.", 1, 1, [H(43)]), []));
  // #9 "Exile X?" after using X's own ability whose cost exiles it: yes
  add({ name: "exile confirm: Craft's own exile cost is answered yes", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "a-craft", type: "activateAbility", cardId: "engine-card-22", description: "Craft with creature {4}{B} ({4}{B}, Exile this artifact, Exile a creature you control or a creature card from your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)" }] })); await h.flush();
    await answer(h, 900, ["a-craft"]);
    h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { title: "Exile Tithing Blade?" } }, { sourceCard: { id: "engine-card-22", identity: { name: "Tithing Blade" } } }), promptId: 901 }); await h.flush();
    return { sent: sent(h), open: seat.prompt ? seat.prompt.ui?.title : null };
  } });
  // #12 the colour of a mana source just tapped reads like the bridge's own tap question
  add({ name: "mana colour: a source just tapped asks 'Tap X for which mana?' with mana symbols", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "tap:engine-card-22:0", type: "activateAbility", cardId: "engine-card-22", isManaAbility: true, description: "{T}: Add one mana of any color that a land an opponent controls could produce." }, ...acts] })); await h.flush();
    // (tapped on the table, as a player does: hover and E, the "tapmana" gesture)
    h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "tapmana", id: "engine-card-22" }) }); await h.flush();
    h.B.onPrompt(seat, { ...prompt("chooseColor", { validColors: ["Blue", "Red", "White"], amount: 1, presentation: { title: "choose a color" } }, { sourceCard: { id: "engine-card-22", identity: { name: "Exotic Orchard" } } }), promptId: 901 }); await h.flush();
    return { open: seat.prompt ? { title: seat.prompt.ui?.title, options: seat.prompt.ui?.options?.map((o) => o.label) } : null };
  } });
  // #2 Forge's internal "[Zone Changer: ...]" and "(Targeting: [[]])" are left out of what a player reads
  add(promptCase("text: Forge's internal trigger text is left out", myMain(D2.board),
    prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "Backup 1 (Targeting: [[]]) [Zone Changer: Archpriest of Shadows (1)]" }, { label: "Whenever another creature you control enters, you gain 1 life [Zone Changer: Lunarch Veteran (1)]" },
      { label: "Backup 1 (Targeting: [[Lunarch Veteran (31)]]) [Zone Changer: Archpriest of Shadows (1)]" }],
      presentation: { title: "Choose" } }, { sourceCard: { id: "engine-card-22", identity: { name: "Archpriest of Shadows" } } }), []));
  // (the stack item's text too: the pop-up beside a trigger read "... you control [Zone Changer: Deadeye Navigator (1)]",
  // hp-12 re-test 2026-10-27)
  add({ name: "text: Forge's internal trigger text is left out of the stack", run: async (h) => {
    const b = clone(D2.board);
    b.gameView.stack = [{ id: "stack-1", identity: { name: "Deadeye Navigator" }, sourceId: "engine-card-22", controllerId: "player-0",
      sourceAbilityText: "When Deadeye Navigator enters, you may pair Deadeye Navigator with another unpaired creature you control.",
      text: "When Deadeye Navigator enters, you may pair Deadeye Navigator with another unpaired creature you control [Zone Changer: Deadeye Navigator (1)]" },
    { id: "stack-2", identity: { name: "Consuming Sepulcher" }, sourceId: "engine-card-8", controllerId: "player-0",
      sourceAbilityText: "At the beginning of your upkeep, each opponent loses 1 life and you gain 1 life.",
      text: "At the beginning of your upkeep, each opponent loses 1 life and you gain 1 life. [Phase: White]" }];
    game(h, b);
    h.B.sendTable(); await h.flush();
    const t = h.effects.filter((e) => e.tts && e.tts.t === "table").map((e) => e.tts).pop();
    return { tx: (t?.stack || []).map((s) => s.tx) };
  } });
  // (a token that leaves the battlefield ceases to exist: two Angel tokens killed in fights said nothing, hp-12 re-test
  // 2026-10-27)
  add({ name: "log: a token that leaves the battlefield is said", run: async (h) => {
    game(h, myMain(D2.board));
    const before = clone(D2.board.gameView), after = clone(D2.board.gameView);
    const bf = before.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1");
    bf.cards = [...(bf.cards || []), { id: "engine-card-9901", controllerId: "player-1", types: ["Creature"], identity: { name: "Angel Token", isToken: true } }];
    // (a card gone from a graveyard - shuffled away, exiled face down - didn't leave the battlefield, suite review)
    const gy = before.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-1");
    if (gy) gy.cards = [...(gy.cards || []), { id: "engine-card-9902", controllerId: "player-1", types: ["Creature"], identity: { name: "Gone Creature" } }];
    return { lines: h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after) };
  } });
  // ── hp-25 hand test 2026-10-27: text changes ──
  {
    const SLEIGHT = "Change the text of target spell or permanent by replacing all instances of one color word with another. (For example, you may change \"target black spell\" to \"target blue spell.\") This effect lasts indefinitely.";
    const EVOLUTION = "Change the text of target spell or permanent by replacing all instances of one creature type with another. The new creature type can't be Wall. (This effect lasts indefinitely.)";
    const withTarget = (src, srcId, targetText, extra = {}) => {
      const b = myMain(D2.board);
      for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-75") Object.assign(c, { text: targetText }, extra);
      b.gameView.stack = [{ id: "stack-7", identity: { name: src }, sourceId: srcId, controllerId: "player-0", sourceAbilityText: "", text: `${src} - Change the text`, targets: [{ kind: "card", id: "engine-card-75" }] }];
      return b;
    };
    // T2/T3: the word replaced, then the new one, with the target's words first (T4)
    add({ name: "text change: colour words asked as 'replace which' then 'with which'", run: async (h) => {
      const seat = game(h, withTarget("Sleight of Mind", "engine-card-22", "First strike\nProtection from black"));
      const ask = (promptId) => ({ ...prompt("chooseColor", { validColors: ["White", "Blue", "Black", "Red", "Green"], amount: 1, presentation: { title: "choose a color" } },
        { sourceCard: { id: "engine-card-22", identity: { name: "Sleight of Mind" }, text: SLEIGHT }, sourceAbilityText: SLEIGHT }), promptId });
      h.B.onPrompt(seat, ask(900)); await h.flush();
      const first = { title: seat.prompt?.ui?.title, options: seat.prompt?.ui?.options?.map((o) => o.label) };
      await answer(h, 900, ["Black"]);
      h.B.onPrompt(seat, ask(901)); await h.flush();
      return { first, second: seat.prompt?.ui?.title };
    } });
    add({ name: "text change: a later question from the same card starts a new pair", run: async (h) => {
      const seat = game(h, withTarget("Sleight of Mind", "engine-card-22", "Protection from black"));
      const ask = (promptId) => ({ ...prompt("chooseColor", { validColors: ["White", "Blue", "Black", "Red", "Green"], amount: 1, presentation: { title: "choose a color" } },
        { sourceCard: { id: "engine-card-22", identity: { name: "Sleight of Mind" }, text: SLEIGHT }, sourceAbilityText: SLEIGHT }), promptId });
      h.B.onPrompt(seat, ask(900)); await h.flush();
      await answer(h, 900, ["Black"]);
      h.B.onPrompt(seat, ask(920)); await h.flush();
      return { later: seat.prompt?.ui?.title };
    } });
    // (a word question of another kind right after is a new pair, not the second of this one: suite review)
    add({ name: "text change: another kind of word right after starts a new pair", run: async (h) => {
      const seat = game(h, withTarget("Mind Bend", "engine-card-22", "Swampwalk; protection from black"));
      const MB = "Change the text of target permanent by replacing all instances of one color word with another or one basic land type with another.";
      const src = { sourceCard: { id: "engine-card-22", identity: { name: "Mind Bend" }, text: MB }, sourceAbilityText: MB };
      h.B.onPrompt(seat, { ...prompt("chooseColor", { validColors: ["White", "Blue", "Black", "Red", "Green"], amount: 1, presentation: { title: "choose a color" } }, src), promptId: 900 }); await h.flush();
      await answer(h, 900, ["Black"]);
      h.B.onPrompt(seat, { ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: ["Forest", "Island", "Swamp"].map((label) => ({ label })), presentation: { title: "choose a basic land" } }, src), promptId: 901 }); await h.flush();
      return { land: seat.prompt?.ui?.title };
    } });
    add({ name: "text change: creature types with the target's own first", run: async (h) => {
      const seat = game(h, withTarget("Artificial Evolution", "engine-card-22", "Other Goblins get +1/+1 and have mountainwalk.", { subtypes: ["Goblin"] }));
      h.B.onPrompt(seat, prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: ["Zombie", "Mount", "Advisor", "Goblin", "Ape", "Elf"].map((label) => ({ label })), presentation: { title: "choose a creature type" } },
        { sourceCard: { id: "engine-card-22", identity: { name: "Artificial Evolution" }, text: EVOLUTION }, sourceAbilityText: EVOLUTION }));
      await h.flush();
      return { title: seat.prompt?.ui?.title, options: seat.prompt?.ui?.options?.map((o) => o.label) };
    } });
    // T1: "Change color | Change type"
    add(promptCase("text change: which kind of word", myMain(D2.board), prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "Change color" }, { label: "Change type" }], presentation: { title: "choose one" } },
      { sourceCard: { id: "engine-card-22", identity: { name: "Mind Bend" }, text: "Change the text of target permanent by replacing all instances of one color word with another or one basic land type with another." } }), []));
    // T6: optional extra costs as payments
    for (const [label, name] of [["Entwine – {2}", "Spectral Shift"], ["Retrace – Discard a land card", "Glamerdye"], ["Buyback – {2}", "Whim of Volrath"]]) {
      add(promptCase(`optional cost: ${label.split(" ")[0]} said as a payment`, myMain(D2.board), prompt("chooseFromSelection", { minTotal: 0, maxTotal: 1, options: [{ label }], presentation: { title: name } },
        { sourceCard: { id: "engine-card-22", identity: { name } } }), []));
    }
    // T8 T9 T12: retrace's land, cipher's creature, Deadpool's exchange
    const pickOf = (name, text, title, cards, min = 1) => ({ ...prompt("chooseCards", { min, max: 1, cards, presentation: { title } }, { sourceCard: { id: "engine-card-22", identity: { name }, text } }) });
    // (as Forge sent it live: the ability text without Retrace, which is in the card's text; "Choose cards to discard")
    add(promptCase("retrace: the discard says it is for Retrace (live shape)", myMain(D2.board), { ...prompt("chooseCards", { min: 1, max: 1, cards: [H(75), H(35)], presentation: { title: "Glamerdye", description: "Choose cards to discard" } },
      { sourceCard: { id: "engine-card-22", identity: { name: "Glamerdye" }, text: "Change the text of target spell or permanent by replacing all instances of one color word with another.\nRetrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)" } }), sourceAbilityText: "Change the text of target spell or permanent by replacing all instances of one color word with another." }, []));
    add(promptCase("retrace: the discard says it is for Retrace", myMain(D2.board), pickOf("Glamerdye", "Change the text of target spell or permanent by replacing all instances of one color word with another.\nRetrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)", "choose a card from your hand", [H(75), H(35)]), []));
    add(promptCase("cipher: the creature question says it encodes", myMain(D2.board), pickOf("Trait Doctoring", "Change the text of target permanent by replacing all instances of one color word with another or one basic land type with another until end of turn.\nCipher (Then you may exile this spell card encoded on a creature you control.)", "choose a card", [H(75), H(35)]), []));
    add(promptCase("Deadpool: the exchange question says what it is for", myMain(D2.board), pickOf("Deadpool, Trading Card", "As Deadpool enters, you may exchange his text box and another creature's.\nAt the beginning of your upkeep, you lose 3 life.", "choose up to 1 card", [H(75), H(35)], 0), []));
    // T11 T17: "Use X?" says the ability's own "may ..."
    // (as Forge sent it live: the replacement's text as the title's second line, no ability text)
    add(promptCase("use: Deadpool's exchange said (live shape)", myMain(D2.board), prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { targets: [], title: "Apply replacement effect of Deadpool, Trading Card?\r\nAs Deadpool enters, you may exchange his text box and another creature's." } },
      { sourceCard: { id: "engine-card-22", identity: { name: "Deadpool, Trading Card" } } }), []));
    add(promptCase("use: Deadpool's exchange said", myMain(D2.board), prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Use Deadpool, Trading Card?" } },
      { sourceCard: { id: "engine-card-22", identity: { name: "Deadpool, Trading Card" } }, sourceAbilityText: "As Deadpool enters, you may exchange his text box and another creature's." }), []));
    add(promptCase("use: cipher's copy said", myMain(D2.board), prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Use Serra Angel?" } },
      { sourceCard: { id: "engine-card-22", identity: { name: "Serra Angel" } }, sourceAbilityText: "Whenever this creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost." }), []));
    // T7: Forge's <strike> marks in a label
    add(promptCase("text change: a changed word in an ability's label", myMain(D2.board), prompt("chooseAction", { actions: [{ id: "a-1", type: "activateAbility", cardId: "engine-card-22", cost: "{1}",
      description: "{1}: The next time a <strike>red</strike> green source of your choice would deal damage to you this turn, prevent that damage." }] }), []));
    // T5 and T0 T10 T13 on the table: the stack's card numbers; the changed text, printed name and cipher link
    add({ name: "text change: what the table gets", run: async (h) => {
      const b = myMain(D2.board);
      for (const z of b.gameView.zones) for (const c of z.cards || []) {
        if (c.id === "engine-card-192") Object.assign(c, { encodedOn: "engine-card-134" });
        if (c.id === "engine-card-134") Object.assign(c, { text: "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)", keywords: ["Landwalk:Island"],
          currentText: "Islandwalk <span style=\"color:gray;\">(This creature can't be blocked as long as defending player controls an <strike>Swamp</strike> Island.)</span>" });
        if (c.id === "engine-card-22") Object.assign(c, { printedName: "Volrath's Shapeshifter", currentText: "As Deadpool enters, you may exchange his text box and another creature's.\r\n\r\nAs Deadpool enters, you may exchange his text box and another creature's.\r\n\r\n{2}: Discard a card." });
      }
      b.gameView.stack = [{ id: "stack-6", identity: { name: "Artificial Evolution" }, sourceId: "engine-card-22", controllerId: "player-0", sourceAbilityText: "x",
        text: "Artificial Evolution (36) - Change the text of Goblin King (37) by replacing all instances of one creature type with another." }];
      game(h, b);
      h.B.sendTable(); await h.flush();
      const tables = h.effects.filter((e) => e.tts && e.tts.t === "table").map((e) => e.tts);
      const t = tables[tables.length - 1];
      const cards = tables.flatMap((x) => x.players || []).flatMap((p) => Object.values(p).filter(Array.isArray).flat());
      const pick = (id) => { const c = cards.find((x) => x && x.id === id); return c && { ct: c.ct ?? null, pn: c.pn ?? null, kw: c.kw ?? null }; };
      return { stack: (t?.stack || []).map((s) => s.tx), wraith: pick("engine-card-134"), shapeshifter: pick("engine-card-22"),
        encoded: (() => { const c = cards.find((x) => x && x.id === "engine-card-192"); return c && { ew: c.ew ?? null, enc: c.enc ?? null }; })() };
    } });
  }
  // a title that is a word of Object's own ("Constructor") is not a verb
  add({ name: "target title: Object's own words are no verbs", run: async (h) => ({ card: h.B.targetTitle("Constructor", "X", 1, 1), player: h.B.targetTitle("Choose player to constructor", "X", 1, 1) }) });
  // a face-down card's real types stay hidden (a foretold Instant, a manifested land)
  add({ name: "table: a face-down card's real types are not sent", run: async (h) => {
    const b = clone(D2.board);
    for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-43") { c.isFaceDown = true; c.isForetold = true; c.types = ["Instant"]; c.power = null; }
    // (a face-down creature at power 0, -2/-0, is still one)
    for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-74") { c.isFaceDown = true; c.types = ["Land"]; c.power = 0; c.toughness = 2; }
    game(h, b);
    h.B.sendTable(); await h.flush();
    const tables = h.effects.filter((e) => e.tts && e.tts.t === "table").map((e) => e.tts);
    const cards = tables.flatMap((t) => (t.players || []).flatMap((p) => Object.values(p).filter(Array.isArray).flat()));
    return { ty: cards.filter((c) => c && (c.id === "engine-card-43" || c.id === "engine-card-74")).map((c) => [c.id, c.fd ?? null, c.ty ?? null]) };
  } });
  // ── sweep question audit 2026-10-27: a bare "choose ..." says what it is for, from the ability's words ──
  {
    const KENRITH = "{R}: All creatures gain trample and haste until end of turn.\n{1}{G}: Put a +1/+1 counter on target creature.\n{2}{W}: Target player gains 5 life.\n{3}{U}: Target player draws a card.\n{4}{B}: Put target creature card from a graveyard onto the battlefield under its owner's control.";
    const src = (name, text) => ({ id: "engine-card-22", identity: { name }, text });
    const targets = (abilityText, title = "Pump") => ({ ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1,
      candidates: [{ kind: "card", id: "engine-card-64" }, { kind: "card", id: "engine-card-65" }], presentation: { title } }),
    sourceCard: src("Kenrith, the Returned King", KENRITH), ...(abilityText ? { sourceAbilityText: abilityText } : {}) });
    add(promptCase("purpose: Kenrith's counter target says what for", myMain(D2.board), targets("{1}{G}: Put a +1/+1 counter on target creature."), [["card|engine-card-64"]]));
    add(promptCase("purpose: Kenrith's reanimation target says what for", myMain(D2.board), targets("{4}{B}: Put target creature card from a graveyard onto the battlefield under its owner's control."), [["card|engine-card-64"]]));
    add(promptCase("purpose: a trigger's target, its 'When' left out", myMain(D2.board), targets("When this creature enters, destroy target artifact an opponent controls."), [["card|engine-card-64"]]));
    // (no ability text: the card's four target sentences say nothing about which one asks)
    add(promptCase("purpose: no ability text and several target sentences: unchanged", myMain(D2.board), targets(null), [["card|engine-card-64"]]));
    add(promptCase("purpose: two targets in one sentence: unchanged", myMain(D2.board), targets("Target creature fights another target creature."), [["card|engine-card-64"]]));
    add(promptCase("purpose: another target reads 'which other'", myMain(D2.board), targets("{2}, {T}: Destroy another target creature."), [["card|engine-card-64"]]));
    // (Forge's own sentence stays: only a bare "choose a target" is reworded)
    add(promptCase("purpose: a real target sentence: unchanged", myMain(D2.board), targets("{1}{G}: Put a +1/+1 counter on target creature.", "Choose target creature you control"), [["card|engine-card-64"]]));
    const cards = (name, abilityText, title, min = 1, text = abilityText) => ({ ...prompt("chooseCards", { min, max: 1, cards: [H(75), H(35)], presentation: { title } }),
      sourceCard: src(name, text), ...(abilityText ? { sourceAbilityText: abilityText } : {}) });
    add(promptCase("purpose: Demonic Tutor's search", myMain(D2.board), cards("Demonic Tutor", "Search your library for a card, put that card into your hand, then shuffle.", "Demonic Tutor"), [["engine-card-75"]]));
    add(promptCase("purpose: Evolving Wilds's search names the basic land", myMain(D2.board), cards("Evolving Wilds", "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.", "Evolving Wilds", 0), [["engine-card-75"]]));
    add(promptCase("purpose: Takenuma's channel return", myMain(D2.board), cards("Takenuma, Abandoned Mire", "Channel — {3}{B}, Discard Takenuma, Abandoned Mire: Mill three cards, then return a creature or planeswalker card from your graveyard to your hand.", "Takenuma, Abandoned Mire"), [["engine-card-75"]]));
    const CULTIVATE = "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.";
    add(promptCase("purpose: Cultivate's search, 'up to two' left out", myMain(D2.board), { ...cards("Cultivate", CULTIVATE, "Cultivate"), input: { ...cards("Cultivate", CULTIVATE, "Cultivate").input, min: 0, max: 2 } }, [["engine-card-75"]]));
    add(promptCase("purpose: Cultivate's second question, Forge's sentence: unchanged", myMain(D2.board), cards("Cultivate", CULTIVATE, "Choose a card to put onto the battlefield"), [["engine-card-75"]]));
    // (sweep hp-05: Angel of the Ruins's plainscycling, Sowing Mycospawn's enters trigger)
    add(promptCase("purpose: landcycling's search, from its reminder text", myMain(D2.board), cards("Angel of the Ruins", "Plainscycling {2} ({2}, Discard this card: Search your library for a Plains card, reveal it, put it into your hand, then shuffle.)", "Angel of the Ruins", 0), [["engine-card-75"]]));
    add(promptCase("purpose: an enters trigger's search", myMain(D2.board), cards("Sowing Mycospawn", "When this creature enters, search your library for a land card, put it onto the battlefield, then shuffle.", "Sowing Mycospawn", 0), [["engine-card-75"]]));
    // (a reminder's search is read only when the rules text has none: here the enters trigger's)
    add(promptCase("purpose: the rules text's search wins over a cycling reminder's", myMain(D2.board), cards("Some Giant", null, "Some Giant", 0,
      "When this creature enters, search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nForestcycling {2} ({2}, Discard this card: Search your library for a Forest card, reveal it, put it into your hand, then shuffle.)"), [["engine-card-75"]]));
    add(promptCase("purpose: an equip target from its reminder text", myMain(D2.board), targets("Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)"), [["card|engine-card-64"]]));
    add(promptCase("purpose: a discard with no such words: unchanged", myMain(D2.board), cards("Faithless Looting", "Draw two cards, then discard two cards.", "Faithless Looting"), [["engine-card-75"]]));
    add(promptCase("purpose: Tireless Provisioner's token", myMain(D2.board), { ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "Food" }, { label: "Treasure" }], presentation: { title: "Tireless Provisioner" } }),
      sourceCard: src("Tireless Provisioner", "Landfall — Whenever a land you control enters, create a Food token or a Treasure token. (Food is an artifact with \"{2}, {T}, Sacrifice this token: You gain 3 life\" and Treasure is an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")") }, [["1"]]));
    add(promptCase("purpose: modes that aren't tokens: unchanged", myMain(D2.board), { ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "Draw a card" }, { label: "Gain 3 life" }], presentation: { title: "Some Charm" } }),
      sourceCard: src("Some Charm", "Choose one —\n• Draw a card.\n• Gain 3 life.") }, [["0"]]));
    add(promptCase("purpose: one token among other choices: unchanged", myMain(D2.board), { ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "Treasure" }, { label: "Clue" }], presentation: { title: "Some Charm" } }),
      sourceCard: src("Some Charm", "Create a Treasure token. Investigate.") }, [["0"]]));
    add(promptCase("purpose: Forge's own token question: unchanged", myMain(D2.board), { ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: [{ label: "Food" }, { label: "Treasure" }], presentation: { title: "Choose a token to create" } }),
      sourceCard: src("Tireless Provisioner", "Whenever a land you control enters, create a Food token or a Treasure token.") }, [["1"]]));
    add({ name: "purpose: Command Tower tapped for a cost asks which mana", run: async (h) => {
      const seat = game(h, D2.board);
      h.B.onPrompt(seat, prompt("payManaCost", { manaCost: "{1}{B}", cardId: "engine-card-43", cardName: "Dark Confidant", actions: [], presentation: { title: "Pay {1}{B} for Dark Confidant" } }));
      await h.flush();
      h.B.onPrompt(seat, { ...prompt("chooseColor", { validColors: ["White", "Blue", "Black", "Red", "Green"], amount: 1, presentation: { title: "Choose a color" } }), promptId: 901,
        sourceCard: src("Command Tower", "{T}: Add one mana of any color in your commander's color identity.") });
      await h.flush();
      const tower = seat.prompt.ui;
      // (not paying: Forge's own colour question, as it was)
      h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { title: "Draw a card?" } }), promptId: 902 });
      await h.flush();
      h.B.onPrompt(seat, { ...prompt("chooseColor", { validColors: ["White", "Blue"], amount: 1, presentation: { title: "Choose a color" } }), promptId: 903,
        sourceCard: src("Command Tower", "{T}: Add one mana of any color in your commander's color identity.") });
      await h.flush();
      return { tower: [tower.title, tower.options.map((o) => o.label)], after: seat.prompt.ui.title };
    } });
    // ── the 22-deck sweep's audit 2026-10-28: the kinds the first fixes didn't cover (live texts from the sweep) ──
    add(promptCase("purpose: a search of an opponent's library, its list past commas", myMain(D2.board), cards("Eternal Dominion", "Search target opponent's library for an artifact, creature, enchantment, or land card. Put that card onto the battlefield under your control. Then that player shuffles.", "Eternal Dominion", 0), [["engine-card-75"]]));
    // (no "card" in the searched-for words: the search stops at the comma, not at a later "put that card")
    add(promptCase("purpose: a search without the word 'card' stops at its comma", myMain(D2.board), cards("Some Shrine Seeker", "Search your library for a Shrine, reveal it, put that card into your hand, then shuffle.", "Some Shrine Seeker", 0), [["engine-card-75"]]));
    add(promptCase("purpose: a search stops before 'reveal that card,'", myMain(D2.board), cards("Some Armorer", "Search your library for an Equipment, reveal that card, put it into your hand, then shuffle.", "Some Armorer", 0), [["engine-card-75"]]));
    add(promptCase("purpose: a gift keeps its own capitals", myMain(D2.board), { ...prompt("chooseFromSelection", { minTotal: 0, maxTotal: 1, options: [{ label: "Promise Gift – Gift something" }], presentation: { title: "Some Gift Spell" } }),
      sourceCard: src("Some Gift Spell", "Gift a Food (You may promise an opponent a gift as you cast this spell. If you do, they create a Food token before its other effects.)\nDraw a card.") }, [["0"]]));
    add(promptCase("purpose: hideaway's exile, from its reminder text", myMain(D2.board), cards("Mosswort Bridge", null, "Mosswort Bridge", 1,
      "Hideaway 4 (When this permanent enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom of your library.)\nThis land enters tapped.\n{T}: Add {G}."), [["engine-card-75"]]));
    add(promptCase("purpose: 'put one of them into your hand'", myMain(D2.board), cards("Some Impulse", "Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.", "Some Impulse"), [["engine-card-75"]]));
    const TANGLE = "At the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on Tangle Wire.";
    add(promptCase("purpose: Tangle Wire's taps, the count kept", myMain(D2.board), { ...cards("Tangle Wire", TANGLE, "Tangle Wire"), input: { ...cards("Tangle Wire", TANGLE, "Tangle Wire").input, min: 2, max: 2 } }, [["engine-card-75", "engine-card-35"]]));
    add(promptCase("purpose: proliferate's choice", myMain(D2.board), { ...cards("Vraska, Betrayal's Sting", "0: You draw a card and you lose 1 life. Proliferate.", "Vraska, Betrayal's Sting", 0), input: { ...cards("Vraska", "x", "x").input, min: 0, max: 2, presentation: { title: "Vraska, Betrayal's Sting" } } }, [["engine-card-75"]]));
    // (Analyze the Pollen: two searches, which one depends on the evidence: no answer)
    add(promptCase("purpose: two different searches: unchanged", myMain(D2.board), cards("Analyze the Pollen", "Search your library for a basic land card. If evidence was collected, instead search your library for a creature or land card. Reveal that card, put it into your hand, then shuffle.", "Analyze the Pollen", 0), [["engine-card-75"]]));
    const extra = (name, label, text) => ({ ...prompt("chooseFromSelection", { minTotal: 0, maxTotal: 1, options: [{ label }], presentation: { title: name } }), sourceCard: src(name, text) });
    add(promptCase("purpose: Gift is a promise to an opponent", myMain(D2.board), extra("Dawn's Truce", "Promise Gift – Gift something", "Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nYou and permanents you control gain hexproof until end of turn."), [["0"]]));
    add(promptCase("purpose: a hyphenated optional cost (Jump-start)", myMain(D2.board), extra("Quasiduplicate", "Jump-start – Discard a card", "Create a token that's a copy of target creature you control.\nJump-start"), [["0"]]));
    add(promptCase("purpose: an optional cost with no name (Collect evidence)", myMain(D2.board), extra("Analyze the Pollen", "Collect evidence 8", "As an additional cost to cast this spell, you may collect evidence 8."), [[]]));
    add(promptCase("purpose: Conspire said from its reminder text", myMain(D2.board), prompt("chooseNumber", { min: 0, max: 1, presentation: { title: "pay for Conspire? tap two untapped creature that shares a color with Rally the Galadhrims you control" } },
      { sourceCard: src("Rally the Galadhrim", "Create a token that's a copy of target creature you control.\nConspire (As you cast this spell, you may tap two untapped creatures you control that share a color with it. When you do, copy it and you may choose a new target for the copy.)") }), [["1"]]));
    // (re-run hp-20: Conspire's creatures to tap; the ability text Forge sends is the spell's effect)
    const RALLY = "Create a token that's a copy of target creature you control.\nConspire (As you cast this spell, you may tap two untapped creatures you control that share a color with it. When you do, copy it and you may choose a new target for the copy.)";
    const conspire = cards("Rally the Galadhrim", "Create a token that's a copy of target creature you control.", "Rally the Galadhrim", 2, RALLY);
    add(promptCase("purpose: Conspire's creatures to tap, from the keyword's reminder", myMain(D2.board), { ...conspire, input: { ...conspire.input, max: 2 } }, [["engine-card-75", "engine-card-35"]]));
    // (a search in another ability's rules text is no answer for this ability's question)
    add(promptCase("purpose: another ability's rules text: unchanged", myMain(D2.board), cards("Some Looter", "{T}: Draw a card, then discard a card.", "Some Looter", 1,
      "{T}: Draw a card, then discard a card.\n{2}, Sacrifice this: Search your library for a basic land card, put it onto the battlefield, then shuffle."), [["engine-card-75"]]));
    // ── hp-08 hand test 2026-10-28 ──
    // (#5: two triggers of one card, each oracle with Forge's note and longer than a button)
    add(promptCase("hp-08: trigger order labels without Forge's note, cut at a word", myMain(D2.board), { ...prompt("reorder", { items: [
      { id: "r1", card: H(43), oracle: "When Mulldrifter enters, draw two cards. [Zone Changer: Mulldrifter (5)]" },
      { id: "r2", card: H(77), oracle: "Evoke (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)" }],
      presentation: { title: "Order triggered abilities" } }) }, [["__keep"]]));
    // (#7 #3: a stack item's text and a dungeon room's, as the table's zoom shows them)
    add({ name: "hp-08: a stack item's text without Forge's [Card: ...] and [Room: ...] notes", run: async (h) => {
      const seat = game(h, D2.board);
      return [h.B.displayText("Cascade - Apex Devastator [Card: Apex Devastator, Activator: White, SpellAbility: Apex Devastator - Creature 10 / 10]"),
        h.B.displayText("Cave Entrance — Scry 1. (Leads to: Goblin Lair, Mine Tunnels) [Room: Cave Entrance]"),
        h.B.displayText("Draw two cards. [Zone Changer: Mull"), Boolean(seat)];
    } });
    // (#8: Ninjutsu's cost, before the colon of its reminder)
    add(promptCase("hp-08: ninjutsu's attacker to return", myMain(D2.board), cards("Nashi, Moon Sage's Scion",
      "Ninjutsu {3}{B} ({3}{B}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)", "Nashi, Moon Sage's Scion"), [["engine-card-75"]]));
    // (and "to your hand", as Forge's own text for Time Wipe has it: suite mutation pass)
    add(promptCase("hp-08: a creature you control to your hand", myMain(D2.board), cards("Time Wipe",
      "Return a creature you control to your hand, then destroy all creatures.", "Time Wipe"), [["engine-card-75"]]));
    // (#1 #9: venture's dungeon and its next room)
    const ACERERAK = "When Acererak the Archlich enters, if you haven't completed Tomb of Annihilation, return Acererak the Archlich to its owner's hand and venture into the dungeon.";
    const venture = (options, title) => ({ ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: options.map((label) => ({ label })), presentation: { title } }),
      sourceCard: src("Acererak the Archlich", ACERERAK), sourceAbilityText: ACERERAK });
    add(promptCase("hp-08: venture's dungeon", myMain(D2.board), venture(["Dungeon of the Mad Mage", "Lost Mine of Phandelver", "Tomb of Annihilation"], "Name a card"), [["1"]]));
    add(promptCase("hp-08: venture's next room", myMain(D2.board), venture(["Goblin Lair — Create a 1/1 red Goblin creature token.", "Mine Tunnels — Create a Treasure token."], "Acererak the Archlich"), [["0"]]));
    // (the dungeon in the command zone names the room question; a venturing card on the battlefield asks for every
    // dungeon's picture ahead)
    const withDungeon = () => {
      const b = myMain(D2.board);
      const dungeon = { id: "engine-card-300", identity: { name: "Lost Mine of Phandelver" }, types: ["Dungeon"], ownerId: "player-0", controllerId: "player-0", text: "Cave Entrance — Scry 1." };
      const cz = b.gameView.zones.find((z) => z.zone === "command" && z.ownerId === "player-0");
      if (cz) cz.cards.push(dungeon); else b.gameView.zones.push({ zone: "command", ownerId: "player-0", cards: [dungeon], count: 1 });
      b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-301", identity: { name: "Acererak the Archlich" },
        types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: ACERERAK, power: "5", toughness: "5" });
      return b;
    };
    add(promptCase("hp-08: venture's next room names the dungeon", withDungeon(), venture(["Goblin Lair — Create a 1/1 red Goblin creature token.", "Mine Tunnels — Create a Treasure token."], "Acererak the Archlich"), [["0"]]));
    add(promptCase("hp-08: the initiative's next room", myMain(D2.board), { ...venture(["Forge — Put two +1/+1 counters on target creature.", "Lost Well — Scry 2."], "Some Raider"),
      sourceCard: src("Some Raider", "When this creature enters, you take the initiative."), sourceAbilityText: "you take the initiative." }, [["1"]]));
    add(promptCase("hp-08: a venturing card's other choice: unchanged", myMain(D2.board), venture(["Draw a card.", "Goblin Lair — Create a 1/1 red Goblin creature token."], "Acererak the Archlich"), [["0"]]));
    add(promptCase("hp-08: a modal card that doesn't venture: unchanged", myMain(D2.board), { ...venture(["Goblin Lair — Create a token.", "Mine Tunnels — Create a Treasure."], "Some Charm"),
      sourceCard: src("Some Charm", "Choose one —\n• Create a token.\n• Create a Treasure."), sourceAbilityText: "Choose one." }, [["0"]]));
    add({ name: "purpose: Chrome Mox tapped for a cost asks which mana", run: async (h) => {
      const seat = game(h, D2.board);
      h.B.onPrompt(seat, prompt("payManaCost", { manaCost: "{1}{B}", cardId: "engine-card-43", cardName: "Dark Confidant", actions: [], presentation: { title: "Pay {1}{B} for Dark Confidant" } }));
      await h.flush();
      h.B.onPrompt(seat, { ...prompt("chooseColor", { validColors: ["Blue", "Black"], amount: 1, presentation: { title: "Choose a color" } }), promptId: 901,
        sourceCard: src("Chrome Mox", "Imprint — When Chrome Mox enters, you may exile a nonartifact card from your hand.\n{T}: Add one mana of any of the exiled card's colors.") });
      await h.flush();
      return [seat.prompt.ui.title, seat.prompt.ui.options.map((o) => o.label)];
    } });
    // ── hp-22 hand test 2026-10-28 (texts as Forge sent them live) ──
    // (#1: a Phyrexian cost with the pool covering it: the life is offered, not paid from the pool by itself)
    const phyrexian = prompt("payManaCost", { cardId: "engine-card-75", cardName: "Vraska, Betrayal's Sting", manaCost: "{4}{B}{B/P}", canConfirmFromPool: true,
      actions: [{ id: "pay-life", type: "payLife", amount: 2 }] });
    add(promptCase("hp-22: a Phyrexian cost just cast, pool covers it: asks, life offered", myMain(D2.board), phyrexian, [["pay-life"]],
      { seat: { lately: { start: { id: "engine-card-75", at: Date.now() + 1e9 } } } }));
    add(promptCase("hp-22: no life to pay, pool covers it: pays itself (unchanged)", myMain(D2.board), { ...phyrexian, input: { ...phyrexian.input, actions: [] } }, [],
      { seat: { lately: { start: { id: "engine-card-75", at: Date.now() + 1e9 } } } }));
    // (#2: Parley reveals each library's top card; Forge shows the opponent's twice, the second as "<card> - Revealing cards from")
    const PARLEY = "Parley — {T}: Each player reveals the top card of their library. For each nonland card revealed this way, add {G} and you gain 1 life. Then each player draws a card.";
    add({ name: "hp-22: Parley's reveals said as reveals, the same card shown again not asked", run: async (h) => {
      const seat = game(h, D2.board);
      const extra = { sourceCard: src("Selvala, Explorer Returned", PARLEY), sourceAbilityText: PARLEY };
      const seen = [];
      const show = async (id, title, owner, card, ex = extra) => {
        h.B.onPrompt(seat, { ...prompt("revealCards", { presentation: { title }, ownerPlayerId: owner, zone: "library", cards: [card] }, ex), promptId: id }); await h.flush();
        seen.push(seat.prompt?.promptId === id ? seat.prompt.ui.title : "answered itself");
        if (seat.prompt?.promptId === id) { h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: id, choice: ["ok"] }) }); await h.flush(); }
      };
      await show(901, "Look at these cards", "player-view-0", H(43));
      await show(902, "Look at these cards", "player-1", H(75));
      await show(903, "Selvala, Explorer Returned - Revealing cards from", "player-1", H(75));
      // (the same card shown by another card is asked)
      await show(904, "Look at these cards", "player-1", H(75), { sourceCard: src("Some Seer", "Look at the top card of target player's library.") });
      const log =h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      return { seen, log, searchNoted: !!seat.justDid("search", 60000) };
    } });
    add(promptCase("hp-22: an opponent's reveal shown alone", D2.board, prompt("revealCards", { presentation: { title: "Selvala, Explorer Returned - Revealing cards from" },
      ownerPlayerId: "player-1", zone: "library", cards: [H(75)] }, { sourceCard: src("Selvala, Explorer Returned", PARLEY), sourceAbilityText: PARLEY }), [["ok"]]));
    add(promptCase("hp-22: a look that may reveal one later: still a look", D2.board, prompt("revealCards", { presentation: { title: "Look at these cards" },
      ownerPlayerId: "player-view-0", zone: "library", cards: [H(43)] }, { sourceAbilityText: "Look at the top three cards of your library. You may reveal a creature card from among them and put it into your hand." }), [["ok"]]));
    add(promptCase("hp-22: a look at your library for a card that doesn't reveal: unchanged", D2.board, prompt("revealCards", { presentation: { title: "Look at these cards" },
      ownerPlayerId: "player-view-0", zone: "library", cards: [H(43)] }, { sourceAbilityText: "Look at the top card of your library." }), [["ok"]]));
    // (#3: a loyalty ability's target, a quoted ability left out; "up to one target")
    add(promptCase("hp-22: Vraska's -2 target says what for", myMain(D2.board), targets("-2: Target creature becomes a Treasure artifact with \"{T}, Sacrifice this artifact: Add one mana of any color\" and loses all other card types and abilities."), [["card|engine-card-64"]]));
    add(promptCase("hp-22: up to one target says what for", myMain(D2.board), { ...targets("Up to one target creature you control gains protection from each of your opponents until end of turn. Draw a card."),
      input: { ...targets("x").input, minTargets: 0 } }, [["card|engine-card-64"]]));
    // (#5: The Ur-Dragon's permanent card from the hand; #6: Tempt with Discovery's search, one per player)
    const UR = "Whenever one or more Dragons you control attack, draw that many cards, then you may put a permanent card from your hand onto the battlefield.";
    add(promptCase("hp-22: The Ur-Dragon's card to put onto the battlefield", myMain(D2.board), { ...cards("The Ur-Dragon", UR, "The Ur-Dragon"), input: { ...cards("The Ur-Dragon", UR, "The Ur-Dragon").input, min: 0 } }, [["engine-card-75"]]));
    // (live, the cards are in the hand and Forge says "Select a card from your hand": the title read "choose up to 1
    // card from your hand" with no purpose, hp-22 re-test 2026-10-28)
    const inHand = (c) => ({ ...c, zone: "hand" });
    const urLive = cards("The Ur-Dragon", UR, "The Ur-Dragon");
    add(promptCase("hp-22: The Ur-Dragon's card from the hand, as Forge asks it live", myMain(D2.board), { ...urLive, input: { ...urLive.input, min: 0, cards: urLive.input.cards.map(inHand), presentation: { title: "The Ur-Dragon", description: "Select a card from your hand", targets: [] } } }, [["engine-card-75"]]));
    const TEMPT = "Tempting offer — Search your library for a land card and put it onto the battlefield. Each opponent may search their library for a land card and put it onto the battlefield. For each opponent who searches a library this way, search your library for a land card and put it onto the battlefield. Then each player who searched a library this way shuffles.";
    add(promptCase("hp-22: Tempt with Discovery's search", myMain(D2.board), { ...cards("Tempt with Discovery", TEMPT, "Tempt with Discovery"), input: { ...cards("Tempt with Discovery", TEMPT, "Tempt with Discovery").input, min: 0 } }, [["engine-card-75"]]));
    add(promptCase("hp-22: two different searches: unchanged", myMain(D2.board), cards("Some Tutor", "Search your library for a land card. Then search your library for a creature card.", "Some Tutor"), [["engine-card-75"]]));
    // (#8: Recover's Pay is the return, its No the exile)
    add(promptCase("hp-22: Recover's yes and no", myMain(D2.board), prompt("chooseBoolean", { confirmLabel: "Pay", denyLabel: "Decline",
      presentation: { title: "Pay half your {LIFE}, rounded up?", text: "otherwise: \"Return Garza's Assassin (13) from the graveyard to its owner's hand. Exile Garza's Assassin (13) from the graveyard.\"" } },
      { sourceCard: src("Garza's Assassin", "Sacrifice Garza's Assassin: Destroy target nonblack creature.\nRecover—Pay half your life, rounded up. (When another creature is put into your graveyard from the battlefield, you may pay half your life, rounded up. If you do, return this card from your graveyard to your hand. Otherwise, exile this card.)"),
        sourceAbilityText: "Recover —Pay half your life, rounded up (When another creature is put into your graveyard from the battlefield, you may pay —Pay half your life, rounded up. If you do, return Garza's Assassin from your graveyard to your hand. Otherwise, exile Garza's Assassin.)" }), [["no"]]));
    // (#9 #10: a vote, its money vote's permanent, and Forge's "Money =[" in the votes notice)
    const DILEMMA = "Council's dilemma — Starting with you, each player votes for time or money. For each time vote, take an extra turn after this one. For each money vote, choose a permanent owned by the voter and gain control of it. Exile Expropriate.";
    const choose = (title, labels, rules, card) => ({ ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: labels.map((label) => ({ label })), presentation: { title } }),
      sourceCard: src(card, rules), sourceAbilityText: rules });
    add(promptCase("hp-22: Council's dilemma vote", myMain(D2.board), choose("Expropriate", ["Time", "Money "], DILEMMA, "Expropriate"), [["1"]]));
    add(promptCase("hp-22: Will of the council vote", myMain(D2.board), choose("Plea", ["Grace", "Condemnation"], "Will of the council — Starting with you, each player votes for grace or condemnation. If grace gets more votes, each player returns each creature card from their graveyard to the battlefield. If condemnation gets more votes or the vote is tied, destroy all creatures other than this one.", "Plea"), [["0"]]));
    add(promptCase("hp-22: the money vote's permanent", myMain(D2.board), cards("Expropriate", DILEMMA, "Expropriate"), [["engine-card-75"]]));
    add(promptCase("hp-22: the votes notice without Forge's space", D2.board, prompt("revealCards", { presentation: { title: "AI 1 vote Money\nCurrent Votes:{Money =[Blue, AI 1]}" }, cards: [] }, { sourceCard: H(77) }), []));
    // (#11: Tiered's modes with their names and extra costs, in the card's order)
    const TIERED = "• Cure — {0} — Target permanent gains hexproof and indestructible until end of turn.\r\n• Cura — {1} — Target permanent gains hexproof and indestructible until end of turn. You gain 3 life.\r\n• Curaga — {3}{W} — Permanents you control gain hexproof and indestructible until end of turn. You gain 6 life.";
    add(promptCase("hp-22: Tiered's modes", myMain(D2.board), choose("Restoration Magic", ["Target permanent gains hexproof and indestructible until end of turn.",
      "Target permanent gains hexproof and indestructible until end of turn. You gain 3 life. ", "Permanents you control gain hexproof and indestructible until end of turn. You gain 6 life. "], TIERED, "Restoration Magic"), [["2"]]));
    add(promptCase("hp-22: a modal card's bullets that aren't tiers: unchanged", myMain(D2.board), choose("Some Charm", ["Draw a card.", "Gain 3 life."], "Choose one —\n• Draw a card.\n• Gain 3 life.", "Some Charm"), [["1"]]));
    // (#7: a land put onto the battlefield by an effect is not played; an AI's from its hand is)
    add({ name: "hp-22: log: a land put onto the battlefield, a land played", run: async (h) => {
      const withLand = (b0, owner, from) => {
        const b = clone(b0);
        b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === owner).cards.push({ id: `engine-card-99${owner.slice(-1)}`, identity: { name: "Swamp" },
          types: ["Land"], ownerId: owner, controllerId: owner, text: "" });
        const z = b.gameView.zones.find((x) => x.zone === from && x.ownerId === owner);
        if (z) z.count = Math.max(0, (z.count ?? (z.cards || []).length) - 1);
        // (the AI's land from its hand is its land play, as Forge counts it; re-test 2026-10-28)
        if (owner === "player-1" && from === "hand") b.gameView.players.find((p) => p.id === owner).landsPlayedThisTurn = 1;
        return b;
      };
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      await feed(myMain(D2.board));
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const mark = lines().length;
      await feed(withLand(myMain(D2.board), "player-0", "library"));
      await feed(myMain(D2.board));
      // (a player's land from the hand with no play of theirs: The Ur-Dragon's)
      await feed(withLand(myMain(D2.board), "player-0", "hand"));
      await feed(myMain(D2.board));
      await feed(withLand(myMain(D2.board), "player-1", "hand"));
      await feed(myMain(D2.board));
      await feed(withLand(myMain(D2.board), "player-1", "library"));
      return lines().slice(mark);
    } });
    // ── hp-06 hand test 2026-10-28 ──
    // (#1: Connive's discard says what a nonland card does; another creature's connive names no card)
    const CONNIVE = "Whenever a player casts their second spell each turn, Ledger Shredder connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)";
    const conniveP = (name, text) => { const p = cards(name, text, "Discard"); return { ...p, input: { ...p.input, cards: p.input.cards.map((c) => ({ ...c, zone: "hand" })) } }; };
    add(promptCase("hp-06: Connive's discard says what a nonland card does", myMain(D2.board), conniveP("Ledger Shredder", CONNIVE), [["engine-card-75"]]));
    add(promptCase("hp-06: another creature's connive", myMain(D2.board), conniveP("Raffine, Scheming Seer", "Whenever you attack, target attacking creature connives X, where X is the number of attacking creatures."), [["engine-card-75"]]));
    add(promptCase("hp-06: a plain discard: no connive note", myMain(D2.board), conniveP("Faithless Looting", "Draw two cards, then discard two cards."), [["engine-card-75"]]));
    // (#2: Partner with's player choice names the partner and says it's a may)
    const fetchP = (text, title = "Choose player to fetch") => ({ ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1,
      candidates: [{ kind: "player", id: "player-0" }, { kind: "player", id: "player-1" }], presentation: { title, targets: [] } }),
    sourceCard: { id: "engine-card-22", identity: { name: "Alisaie Leveilleur" }, text } });
    const ALISAIE = "Partner with Alphinaud Leveilleur (When this creature enters, target player may put Alphinaud Leveilleur into their hand from their library, then shuffle.)\nFirst strike\nDualcast — The second spell you cast each turn costs {2} less to cast.";
    add(promptCase("hp-06: Partner with names the partner", myMain(D2.board), fetchP(ALISAIE), [["player|player-0"]]));
    add(promptCase("hp-06: a fetch without Partner with: unchanged", myMain(D2.board), fetchP("First strike"), [["player|player-0"]]));
    add(promptCase("hp-06: a Partner with card's other player question: unchanged", myMain(D2.board), fetchP(ALISAIE, "Choose player to draw"), [["player|player-0"]]));
    // (#3: the "Search your library?" that follows names the card)
    const searchYN = (ab) => ({ ...prompt("chooseBoolean", { presentation: { title: "Search your library?", targets: [] } }),
      sourceCard: { id: "engine-card-22", identity: { name: "Alisaie Leveilleur" }, text: ALISAIE }, ...(ab ? { sourceAbilityText: ab } : {}) });
    add(promptCase("hp-06: Partner with's search names the card", myMain(D2.board), searchYN(ALISAIE.split("\n")[0]), [["yes"]]));
    add(promptCase("hp-06: a search with no named card: unchanged", myMain(D2.board), searchYN("Search your library for a creature card, reveal it, put it into your hand, then shuffle."), [["yes"]]));
    // (#4: the named card isn't in the library: Forge shows it all; say the search found nothing, and the next card into
    // the hand is a draw, not the searched card)
    const libLook = (cardsShown) => ({ ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0-view", zone: "library", cards: cardsShown }),
      sourceCard: { id: "engine-card-22", identity: { name: "Alisaie Leveilleur" }, text: ALISAIE }, sourceAbilityText: ALISAIE.split("\n")[0] });
    add(promptCase("hp-06: Partner with's search found nothing", myMain(D2.board), libLook([H(43), H(75)]), [["ok"]]));
    add(promptCase("hp-06: Partner with's search: the card is there", myMain(D2.board), libLook([H(43), { ...H(75), identity: { ...H(75).identity, name: "Alphinaud Leveilleur" } }]), [["ok"]]));
    add({ name: "hp-06: a search that found nothing marks no searched card", run: async (h) => {
      const found = [], seat = game(h, myMain(D2.board));
      // (other ids the second time: the same cards shown again a moment later are acknowledged unasked)
      for (const shown of [[H(43), H(75)], [H(43), { ...H(75), id: "engine-card-77", identity: { ...H(75).identity, name: "Alphinaud Leveilleur" } }]]) {
        seat.forget("search");
        h.B.onPrompt(seat, libLook(shown)); await h.flush();
        found.push(Boolean(seat.justDid("search", 30000)));
      }
      return found;
    } });
    // (hp-14 gap: Mentor's target as Forge asks it live: "Buff", no ability text, the card's reminder read)
    add(promptCase("hp-14 gap: mentor's target", myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title: "Buff", targets: [] } }),
      sourceCard: { id: "engine-card-957", identity: { name: "Legion Warboss" }, text: "Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)\nAt the beginning of combat on your turn, create a 1/1 red Goblin creature token. That token gains haste until end of turn and attacks this combat if able." } }, [["card|engine-card-64"]]));
    // (hp-14 gap: Nelly's suspect target, its trigger's condition naming a card with a comma in its name; and Blood
    // Artist's, whose condition ends with a lowercase word before its comma)
    add(promptCase("hp-14 gap: suspect's target", myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title: "Hostile", targets: [] } }),
      sourceCard: { id: "engine-card-29", identity: { name: "Nelly Borca, Impulsive Accuser" }, text: "Vigilance\nWhenever Nelly Borca, Impulsive Accuser attacks, suspect target creature. Then goad all suspected creatures. (A suspected creature has menace and can't block.)" } }, [["card|engine-card-64"]]));
    for (const [title, ability] of [["Hostile", false], ["Hostile", true], ["Exile", true], ["Exile", false]]) {
      const T = "Inspired — Whenever King Macar, the Gold-Cursed becomes untapped, you may exile target creature. If you do, create a Gold token. (It's an artifact with \"Sacrifice this token: Add one mana of any color.\")";
      add(promptCase(`hp-14 gap: inspired's target${title === "Hostile" && !ability ? "" : ` (${title}${ability ? ", ability text" : ""})`}`, myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title, targets: [] } }),
        sourceCard: { id: "engine-card-15", identity: { name: "King Macar, the Gold-Cursed" }, text: T }, ...(ability ? { sourceAbilityText: T } : {}) }, [["card|engine-card-64"]]));
    }
    add(promptCase("hp-14 gap: a trigger's condition before a card name",myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "player", id: "player-1" }], presentation: { title: "Hostile", targets: [] } }),
      sourceCard: { id: "engine-card-30", identity: { name: "Blood Artist" }, text: "Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life." } }, [["player|player-1"]]));
    // (hp-10 gap: Splice as Forge asks it live: the Arcane cards in hand, under the spell's own name and text)
    {
      const kr = cards("Kodama's Reach", "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.", "Kodama's Reach", 0);
      add(promptCase("hp-10 gap: splice onto Arcane", myMain(D2.board), { ...kr, input: { ...kr.input, max: 2, cards: kr.input.cards.map((c) => ({ ...c, zone: "hand" })),
        presentation: { title: "Kodama's Reach", description: "Splice", targets: [] } } }, [["engine-card-75", "engine-card-35"]]));
    }
    // (hp-10 gap: Dig Through Time's two cards as Forge asks it live)
    {
      const dg = cards("Dig Through Time", "Look at the top seven cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.", "Dig Through Time", 2);
      add(promptCase("hp-10 gap: Dig Through Time's two", myMain(D2.board), { ...dg, input: { ...dg.input, min: 2, max: 2, cards: dg.input.cards.map((c) => ({ ...c, zone: "library" })),
        presentation: { title: "Dig Through Time", description: "Choose card(s) to put into hand", targets: [] } } }, [["engine-card-75", "engine-card-35"]]));
    }
    // (hp-10 gap: the cast line names what was spliced)
    add({ name: "hp-10 gap: log: a spliced cast", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      // (and another cast still unsaid before it: the splice is the asking card's, mutation pass)
      (h.B._getGame().pendingPlays ??= []).push({ id: "engine-card-74", name: "Opt", ctl: "player-0", kind: "cast", text: "Cast Opt", at: Date.now(), promptId: -6 },
        { id: "engine-card-75", name: "Kodama's Reach", ctl: "player-0", kind: "cast", text: "Cast Kodama's Reach", at: Date.now(), promptId: -5 });
      const kr = cards("Kodama's Reach", "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.", "Kodama's Reach", 0);
      const p = { ...kr, sourceCard: { ...kr.sourceCard, id: "engine-card-75" }, input: { ...kr.input, max: 2, cards: [{ ...H(35), zone: "hand" }, { ...H(43), zone: "hand" }], presentation: { title: "Kodama's Reach", description: "Splice", targets: [] } }, promptId: 970 };
      h.B.onPrompt(seat, p); await h.flush();
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 970, choice: ["engine-card-35", "engine-card-43"] }) }); await h.flush();
      const b = clone(start);
      for (const z of b.gameView.zones) if (z.cards) z.cards = z.cards.filter((c) => c.id !== "engine-card-75");
      b.gameView.stack = [{ id: "stack-kr", sourceId: "engine-card-75", controllerId: "player-0", identity: { name: "Kodama's Reach" }, sourceAbilityText: "Search your library ...", isPermanentSpell: false }];
      await boardAs(h, seat, b);
      return logLines(h).slice(mark);
    } });
    // (hp-09 gap: Arena of Glory's two mana abilities as Forge sent them live: the exert one says its other costs)
    add(promptCase("hp-09 gap: Arena of Glory's exert in a payment", myMain(D2.board), { ...prompt("payManaCost", { manaCost: "{2}{G}", cardName: "Jaheira, Friend of the Forest", cardId: "engine-card-75", actions: [
      { abilityIndex: 0, cardId: "engine-card-17", cost: "{T}", description: "Arena of Glory", id: "tap:engine-card-17:0", isManaAbility: true, producedMana: [{ amount: 1, color: "R" }], type: "activateManaAbility" },
      { abilityIndex: 1, cardId: "engine-card-17", cost: "{T}, {R}, Exert CARDNAME", description: "Arena of Glory", id: "tap:engine-card-17:1", isManaAbility: true, producedMana: [{ amount: 2, color: "R" }], type: "activateManaAbility" }],
      presentation: { title: "Pay {2}{G}" } }) }, [["tap:engine-card-17:1"]]));
    // (hp-08 gap, Flusterstorm's storm on the AI's Chart a Course, as Forge sent it live)
    {
      const FL = "Counter target instant or sorcery spell unless its controller pays {1}.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)";
      const copyCard = (n) => ({ id: `engine-card-14${n}`, identity: { name: "Flusterstorm" }, isCopy: true, controllerId: "player-0", ownerId: "player-0", text: FL, keywords: ["Storm"] });
      // the copies' order: all the same but Forge's numbers, kept without asking; two different ones asked, numbers out
      for (const [what, texts] of [["the same", ["Flusterstorm (145) - Counter Chart a Course (61) unless its controller pays {1}.", "Flusterstorm (146) - Counter Chart a Course (61) unless its controller pays {1}."]],
        ["different", ["Flusterstorm (145) - Counter Chart a Course (61) unless its controller pays {1}.", "Flusterstorm (146) - Counter Brainstorm (56) unless its controller pays {1}."]]]) {
        add(promptCase(`hp-08 gap: storm copies' order (${what})`, myMain(D2.board), { ...prompt("reorder", { items: texts.map((oracle, i) => ({ id: `sa-${i}`, card: copyCard(5 + i), oracle })),
          presentation: { title: "Order triggered abilities", targets: [] } }) }, [["__keep"]]));
      }
      // a copy's new target, asked with no card: named by the copy on the stack; its candidates the other copies, by card id
      const b = myMain(D2.board);
      b.gameView.stack = [{ id: "engine-stack-51", sourceId: "engine-card-961", controllerId: "player-1", identity: { name: "Chart a Course" }, sourceAbilityText: "Draw two cards. Then discard a card unless you attacked this turn." },
        { id: "engine-stack-67", sourceId: "engine-card-145", controllerId: "player-0", identity: { name: "Flusterstorm" }, sourceAbilityText: FL },
        { id: "engine-stack-68", sourceId: "engine-card-146", controllerId: "player-0", identity: { name: "Flusterstorm" }, sourceAbilityText: FL }];
      add(promptCase("hp-08 gap: a storm copy's new target", b, { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-145", kind: "card" }, { id: "engine-card-146", kind: "card" }],
        chosenTargets: 0, hostile: true, intent: "counter", maxTargets: 1, minTargets: 1, presentation: { title: "Counter", targets: [] } }) }, [["card|engine-card-145"]]));
      // the log: the copies are copies; under an "unless" counter Chart a Course isn't said countered; its discard is a discard
      add({ name: "hp-08 gap: log: storm copies, an unless counter, the AI's loot", run: async (h) => {
        const seat = game(h, myMain(D2.board));
        const feed = async (bd) => { seat.board = { state: bd, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const zone = (bd, zn, owner) => bd.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
        const withStack = (items) => { const bd = myMain(D2.board); zone(bd, "library", "player-1").count = 30; zone(bd, "hand", "player-1").count = 5; bd.gameView.stack = items; return bd; };
        const chart = { id: "engine-stack-51", sourceId: "engine-card-961", controllerId: "player-1", identity: { name: "Chart a Course" }, sourceAbilityText: "Draw two cards. Then discard a card unless you attacked this turn." };
        const flu = (n) => ({ id: `engine-stack-6${n}`, sourceId: `engine-card-14${n}`, controllerId: "player-0", identity: { name: "Flusterstorm" }, sourceAbilityText: FL, targets: [{ kind: "spell", id: "engine-stack-51" }] });
        await feed(withStack([chart]));
        const mark = lines().length;
        await feed(withStack([chart, flu(4)]));
        await feed(withStack([chart, flu(4), flu(5), flu(6)]));
        const after = withStack([]);
        zone(after, "library", "player-1").count = 28; zone(after, "hand", "player-1").count = 6;
        zone(after, "graveyard", "player-1").cards.push({ id: "engine-card-961", identity: { name: "Chart a Course" }, types: ["Sorcery"], ownerId: "player-1", controllerId: "player-1", text: "" },
          { id: "engine-card-962", identity: { name: "Island" }, types: ["Land"], ownerId: "player-1", controllerId: "player-1", text: "" });
        await feed(after);
        return lines().slice(mark);
      } });
      // (hp-15 gap: Reforge the Soul, "Each player discards their hand, then draws seven cards": every player's discard and
      // draw said, White's hand ending smaller than it was; "each opponent discards" counts the others only)
      for (const [what, text] of [["each player", "Each player discards their hand, then draws seven cards."], ["each opponent", "Each opponent discards their hand, then draws seven cards."]]) {
        add({ name: `hp-15 gap: log: ${what} discards and draws`, run: async (h) => {
          const seat = game(h, myMain(D2.board));
          const feed = async (bd) => { seat.board = { state: bd, fingerprint: null }; h.B.sendTable(); await h.flush(); };
          const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
          const zone = (bd, zn, owner) => bd.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
          const card = (id, name, o, types = ["Land"]) => ({ id, identity: { name }, types, ownerId: o, controllerId: o, text: "" });
          const counts = (bd, h0, l0, h1, l1) => { zone(bd, "hand", "player-0").count = h0; zone(bd, "library", "player-0").count = l0; zone(bd, "hand", "player-1").count = h1; zone(bd, "library", "player-1").count = l1; };
          const mine = what === "each player";
          // (each discards the cards shown, then draws: Blue 2 into 2 with a library of 2, the AI 2 into 7)
          const before = myMain(D2.board); counts(before, 2, 2, 2, 30);
          before.gameView.stack = [{ id: "engine-stack-70", sourceId: "engine-card-990", controllerId: "player-0", identity: { name: "Reforge the Soul" }, sourceAbilityText: text }];
          await feed(before);
          const mark = lines().length;
          const after = myMain(D2.board); counts(after, 2, mine ? 0 : 2, 7, 23);
          zone(after, "graveyard", "player-0").cards.push(card("engine-card-990", "Reforge the Soul", "player-0", ["Sorcery"]), ...(mine ? [card("engine-card-991", "Swamp", "player-0"), card("engine-card-992", "Thran Dynamo", "player-0", ["Artifact"])] : []));
          zone(after, "graveyard", "player-1").cards.push(card("engine-card-993", "Elvish Mystic", "player-1", ["Creature"]), card("engine-card-994", "Plains", "player-1"));
          await feed(after);
          return lines().slice(mark);
        } });
      }
      // (mutation pass: the player's own second cast of a same-named spell is a cast; an original and its copy seen in one
      // board are a cast and a copy)
      for (const what of ["a second cast", "original and copy at once"]) {
        add({ name: `hp-08 gap: log: copies or casts (${what})`, run: async (h) => {
          const seat = game(h, myMain(D2.board));
          const feed = async (bd) => { seat.board = { state: bd, fingerprint: null }; h.B.sendTable(); await h.flush(); };
          const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
          const bolt = (n) => ({ id: `engine-stack-7${n}`, sourceId: `engine-card-97${n}`, controllerId: "player-0", identity: { name: "Lightning Bolt" }, sourceAbilityText: "Lightning Bolt deals 3 damage to any target." });
          const withStack = (items) => { const bd = myMain(D2.board); bd.gameView.stack = items; return bd; };
          const rec = (n) => (h.B._getGame().pendingPlays ??= []).push({ id: `engine-card-97${n}`, name: "Lightning Bolt", ctl: "player-0", kind: "cast", text: "Cast Lightning Bolt", at: Date.now(), promptId: -4 });
          await feed(withStack([]));
          const mark = lines().length;
          if (what === "a second cast") { rec(1); await feed(withStack([bolt(1)])); rec(2); await feed(withStack([bolt(1), bolt(2)])); }
          else { rec(1); await feed(withStack([bolt(1), bolt(2)])); }
          return lines().slice(mark);
        } });
      }
      // Aven Interrupter's exiled spell, plotted (Forge's isPlotted); a plain exile beside it
      add({ name: "hp-08 gap: log: a spell exiled and plotted", run: async (h) => {
        const seat = game(h, myMain(D2.board));
        const feed = async (bd) => { seat.board = { state: bd, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const zone = (bd, zn, owner) => bd.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
        const start = myMain(D2.board);
        start.gameView.stack = [{ id: "engine-stack-79", sourceId: "engine-card-997", controllerId: "player-1", identity: { name: "Preordain" }, sourceAbilityText: "Scry 2, then draw a card." }];
        await feed(start);
        const mark = lines().length;
        const after = myMain(D2.board);
        zone(after, "exile", "player-1").cards.push({ id: "engine-card-997", identity: { name: "Preordain" }, types: ["Sorcery"], ownerId: "player-1", controllerId: "player-1", text: "", isPlotted: true, exiledWith: "engine-card-38" },
          { id: "engine-card-998", identity: { name: "Opt" }, types: ["Instant"], ownerId: "player-1", controllerId: "player-1", text: "" });
        await feed(after);
        return lines().slice(mark);
      } });
      // (hp-13 gap: a Treasure tapped by hand while paying: its "Sacrifice Treasure Token?" is answered; after auto-pay it
      // is still asked)
      for (const how of ["by hand", "auto-pay"]) {
        add({ name: `hp-13 gap: a Treasure tapped while paying (${how})`, run: async (h) => {
          const b2 = myMain(D2.board);
          b2.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-943", identity: { name: "Treasure Token", isToken: true }, types: ["Artifact"], ownerId: "player-0", controllerId: "player-0", text: "{T}, Sacrifice this token: Add one mana of any color." });
          const seat = game(h, b2);
          h.B.onPrompt(seat, { ...prompt("payManaCost", { manaCost: "{1}{R}{R}", cardName: "Return the Favor", cardId: "engine-card-75", actions: [{ id: "tap:engine-card-943:0:R", type: "activateAbility", cardId: "engine-card-943", description: "Treasure Token", cost: "{T}, Sacrifice CARDNAME" }], presentation: { title: "Pay {1}{R}{R}" } }), promptId: 971 }); await h.flush();
          h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 971, choice: [how === "by hand" ? "tap:engine-card-943:0:R" : "__auto"] }) }); await h.flush();
          h.B.onPrompt(seat, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Sacrifice Treasure Token?", targets: [] } }), sourceCard: { id: "engine-card-943", identity: { name: "Treasure Token" } }, promptId: 972 }); await h.flush();
          return seat.prompt?.promptId === 972 ? seat.prompt.ui.title : "answered";
        } });
      }
      // (hp-13 gap: "Undo mana from" a Treasure sacrificed while paying: gone from every zone, named as it was)
      add({ name: "hp-13 gap: undo mana from a sacrificed Treasure", run: async (h) => {
        const b2 = myMain(D2.board);
        b2.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-944", identity: { name: "Treasure Token", isToken: true }, types: ["Artifact"], ownerId: "player-0", controllerId: "player-0", text: "x" });
        const seat = game(h, b2);
        await boardAs(h, seat, b2);
        const gone = myMain(D2.board);
        seat.board = { state: gone, fingerprint: null };
        h.B.onPrompt(seat, { ...prompt("payManaCost", { manaCost: "{1}{R}{R}", cardName: "Return the Favor", cardId: "engine-card-75", actions: [{ id: "untap:engine-card-944", type: "undoMana", cardId: "engine-card-944" }], presentation: { title: "Pay {1}{R}{R}" } }), promptId: 973 }); await h.flush();
        return seat.prompt?.ui?.options?.map((o) => o.label);
      } });
      // Mana Confluence tapped while paying: its "pay 1 life?" is answered
      add({ name: "hp-08 gap: Mana Confluence tapped in a payment", run: async (h) => {
        const b2 = myMain(D2.board);
        b2.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-910", identity: { name: "Mana Confluence" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "{T}, Pay 1 life: Add one mana of any color." });
        const seat = game(h, b2);
        h.B.onPrompt(seat, { ...prompt("payManaCost", { manaCost: "{B}", cardName: "Vampiric Tutor", cardId: "engine-card-75", actions: [{ id: "tap:engine-card-910:0:B", type: "activateAbility", cardId: "engine-card-910", description: "Mana Confluence for {B}" }], presentation: { title: "Pay {B}" } }), promptId: 968 }); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 968, choice: ["tap:engine-card-910:0:B"] }) }); await h.flush();
        h.B.onPrompt(seat, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Pay 1 life?", targets: [] } }), sourceCard: { id: "engine-card-910", identity: { name: "Mana Confluence" } }, promptId: 969 }); await h.flush();
        return seat.prompt?.promptId === 969 ? seat.prompt.ui.title : "answered";
      } });
    }
    // (hp-08 gap: an AI's own sorcery into its graveyard on its own turn, one card down from its library: cast or
    // milled, neither said; on White's turn it is a mill; a land the same way is a mill; two cards are a mill)
    for (const [what, active, cardsIn] of [["AI's sorcery, its turn", "player-1", [["Sleight of Hand", "Sorcery"]]], ["AI's sorcery, White's turn", "player-0", [["Sleight of Hand", "Sorcery"]]],
      ["AI's land, its turn", "player-1", [["Island", "Land"]]], ["two cards, its turn", "player-1", [["Sleight of Hand", "Sorcery"], ["Opt", "Instant"]]]]) {
      add({ name: `hp-08 gap: log: an AI's graveyard card from its library (${what})`, run: async (h) => {
        const start = myMain(D2.board); start.gameView.activePlayerId = active;
        const seat = game(h, start);
        const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const zone = (b, zn, owner) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
        zone(start, "library", "player-1").count = 30;
        await feed(start);
        const mark = lines().length;
        const b = clone(start);
        zone(b, "library", "player-1").count = 30 - cardsIn.length;
        zone(b, "graveyard", "player-1").cards.push(...cardsIn.map(([name, type], i) => ({ id: `engine-card-99${i}`, identity: { name }, types: [type], ownerId: "player-1", controllerId: "player-1", text: "" })));
        await feed(b);
        return lines().slice(mark);
      } });
    }
    // (#6: a mill is one line; a card into a graveyard with no library change stays as it was)
    add({ name: "hp-06: log: a mill in one line", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (b, zn, owner) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
      const start = myMain(D2.board);
      const lib = zone(start, "library", "player-0");
      lib.count = 20;
      await feed(start);
      const mark = lines().length;
      const card = (n, name) => ({ id: `engine-card-96${n}`, identity: { name }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" });
      const milled = clone(start);
      zone(milled, "library", "player-0").count = 18;
      zone(milled, "graveyard", "player-0").cards.push(card(1, "Swamp"), card(2, "Reality Shift"));
      await feed(milled);
      const putThere = clone(milled);
      zone(putThere, "graveyard", "player-0").cards.push(card(3, "Island"));
      await feed(putThere);
      // (a draw with it: the card that left the library went to the hand, so the graveyard card is no mill)
      const drawToo = clone(putThere);
      zone(drawToo, "library", "player-0").count = 17;
      const hz = zone(drawToo, "hand", "player-0");
      const had = hz.count ?? hz.cards.length;
      hz.cards.push(card(4, "Plains"));
      hz.count = had + 1;
      zone(drawToo, "graveyard", "player-0").cards.push(card(5, "Forest"));
      await feed(drawToo);
      return lines().slice(mark);
    } });
    // (#7: Echo's trigger says it is echo; another trigger stays "uses ... ability")
    add({ name: "hp-06: log: echo's trigger", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const start = myMain(D2.board);
      await feed(start);
      const mark = lines().length;
      const bfCard = start.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards[0];
      const trig = (text) => ({ sourceId: bfCard.id, controllerId: "player-0", identity: bfCard.identity, sourceAbilityText: text, text });
      const echo = clone(start);
      echo.gameView.stack = [trig("At the beginning of your upkeep, if this permanent came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.")];
      await feed(echo);
      await feed(clone(start));
      // (hp-05: cumulative upkeep's trigger says its cost)
      const cumulative = clone(start);
      cumulative.gameView.stack = [trig("Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)")];
      await feed(cumulative);
      await feed(clone(start));
      // (suite review: a cost that isn't mana, and the keyword without its reminder)
      for (const text of ["Cumulative upkeep—Pay 2 life. (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)", "Cumulative upkeep {2}{U}"]) {
        const other = clone(start); other.gameView.stack = [trig(text)];
        await feed(other); await feed(clone(start));
      }
      const other = clone(start);
      other.gameView.stack = [trig("At the beginning of your upkeep, you gain 1 life.")];
      await feed(other);
      return lines().slice(mark);
    } });
    // (#8: Madness's cast says the cost and where it goes otherwise; another "play it?" stays)
    const playP = (ab) => ({ ...prompt("chooseBoolean", { presentation: { title: "Do you want to play Emrakul, the World Anew?", targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }),
      sourceCard: { id: "engine-card-22", identity: { name: "Emrakul, the World Anew" }, text: "Madness—Pay six {C}." }, ...(ab ? { sourceAbilityText: ab } : {}) });
    add(promptCase("hp-06: Madness's cast says its cost", myMain(D2.board), playP("Play Madness {C}{C}{C}{C}{C}{C}  - Emrakul, the World Anew"), [["yes"]]));
    add(promptCase("hp-06: another play question: unchanged", myMain(D2.board), playP("Cascade - Emrakul, the World Anew"), [["yes"]]));
    // (#9: "Cast it" starts the cast: the pool pays it by itself; "To graveyard" doesn't)
    for (const [label, pick, owner] of [["Cast it", "yes", "player-0"], ["To graveyard", "no", "player-0"], ["Cast it, an opponent's card", "yes", "player-1"]]) {
      add({ name: `hp-06: Madness ${label}, then the payment`, run: async (h) => {
        const seat = game(h, myMain(D2.board));
        const ask = playP("Play Madness {C}{C}{C}{C}{C}{C}  - Emrakul, the World Anew");
        h.B.onPrompt(seat, { ...ask, sourceCard: { ...ask.sourceCard, id: "engine-card-75", ownerId: owner } }); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: ask.promptId, choice: [pick] }) }); await h.flush();
        const pay = { ...payP, promptId: ask.promptId + 1, input: { ...payP.input, canConfirmFromPool: true } };
        h.B.onPrompt(seat, pay); await h.flush();
        return { open: seat.prompt ? seat.prompt.ui?.title : null };
      } });
    }
    // (#10: a player question with a verb we don't know says the card's "target player" sentence)
    const EMRAKUL = "When you cast this spell, gain control of all creatures target player controls.\nFlying, protection from spells and from permanents that were cast this turn\nWhen Emrakul, the World Anew leaves the battlefield, sacrifice all creatures you control.\nMadness—Pay six {C}.";
    const playerQ = (title, text) => ({ ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1,
      candidates: [{ kind: "player", id: "player-0" }, { kind: "player", id: "player-1" }], presentation: { title, targets: [] } }),
    sourceCard: { id: "engine-card-22", identity: { name: "Emrakul, the World Anew" }, text } });
    add(promptCase("hp-06: Emrakul's player: the card's sentence", myMain(D2.board), playerQ("Choose player to control", EMRAKUL), [["player|player-1"]]));
    add(promptCase("hp-06: a cost before the player sentence is left out", myMain(D2.board), playerQ("Choose player to draw", "{3}{U}: Target player draws a card."), [["player|player-1"]]));
    add(promptCase("hp-06: a known player verb: unchanged", myMain(D2.board), playerQ("Choose player to fetch", "Target player draws a card."), [["player|player-1"]]));
    add(promptCase("hp-06: two target-player sentences: unchanged", myMain(D2.board), playerQ("Choose player to control", "Target player sacrifices a creature. Target player discards a card."), [["player|player-1"]]));
    // (#11: +1/+1 counters a permanent gains are logged; one entering with them isn't)
    add({ name: "hp-06: log: +1/+1 counters gained", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const start = myMain(D2.board);
      await feed(start);
      const mark = lines().length;
      const bf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
      const one = clone(start); bf(one)[0].counters = { P1P1: 1 }; await feed(one);
      const three = clone(one); bf(three)[0].counters = { P1P1: 3 }; await feed(three);
      const fresh = clone(three); bf(fresh).push({ id: "engine-card-951", identity: { name: "Orc Army" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", counters: { P1P1: 1 }, text: "" }); await feed(fresh);
      return lines().slice(mark);
    } });
    // (#12: a keyword's way is named without its reminder sentence, its cost kept)
    add({ name: "hp-06: Foretell and Suspend ways without reminder text", run: async (h) => {
      const asked = [];
      for (const [id, label] of [
        ["a-fore", "Foretell (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)"],
        ["a-susp", "Hurloon Minotaur: Suspend 2—{1}{B} (If you could begin to cast this card by putting it onto the stack from your hand, you may pay {1}{B} and exile it with two time counters on it.)"],
        ["a-plain", "Plot (You may pay this card's plot cost and exile it.)"]]) {
        const seat = game(h, mainB);
        h.B.onPrompt(seat, prompt("chooseAction", { actions: [
          { id: "a-cast", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "normal" } },
          { id, type: "activateAbility", cardId: "engine-card-75", label, mode: { type: "normal" } },
          { id: "pass", type: "pass", label: "Pass priority" }] })); await h.flush();
        h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-75" }) }); await h.flush();
        asked.push(seat.prompt?.ui?.options?.map((o) => o.label));
      }
      return asked;
    } });
    // (hp-15: a split card's whole cast is named as its fuse)
    add({ name: "hp-15: fuse among a split card's ways", run: async (h) => {
      const b = clone(mainB);
      for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-75") c.identity = { ...c.identity, name: "Turn // Burn" };
      const seat = game(h, b);
      h.B.onPrompt(seat, prompt("chooseAction", { actions: [
        { id: "a-burn", type: "cast", cardId: "engine-card-75", label: "Cast Burn", mode: { type: "normal" } },
        { id: "a-fuse", type: "cast", cardId: "engine-card-75", label: "Cast Turn // Burn", mode: { type: "normal" } },
        { id: "a-turn", type: "cast", cardId: "engine-card-75", label: "Cast Turn", mode: { type: "normal" } },
        // (hp-17: the harness's "(MTMtE)" spelled out)
        { id: "a-mtmte", type: "cast", cardId: "engine-card-75", label: "Cast Starscream, Seeker Leader (MTMtE)", mode: { type: "alternative", cost: "more_than_meets_the_eye" } },
        { id: "pass", type: "pass", label: "Pass priority" }] })); await h.flush();
      h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-75" }) }); await h.flush();
      return seat.prompt?.ui?.options?.map((o) => o.label);
    } });
    // (#16: a reveal's title without Forge's trailing " - ")
    add(promptCase("hp-06: Explore's reveal title", myMain(D2.board), { ...prompt("revealCards", { presentation: { title: "Revealed for Explore - ", targets: [] }, ownerPlayerId: "player-0-view", zone: "library", cards: [H(75)] }),
      sourceCard: { id: "engine-card-22", identity: { name: "Map Token" }, text: "" } }, [["ok"]]));
    // (#17: Explore's graveyard question in words, with verbs on the buttons)
    add(promptCase("hp-06: Explore's graveyard question", myMain(D2.board), { ...prompt("chooseBoolean", { presentation: { title: "[Explore] Put Profane Tutor in your graveyard?", targets: [] }, confirmLabel: "Yes", denyLabel: "No" }),
      sourceCard: { id: "engine-card-22", identity: { name: "Map Token" }, text: "" } }, [["no"]]));
    // (hp-01 #2: a reveal that puts the card into your hand marks it as put, not drawn; Parley's reveal doesn't)
    add({ name: "hp-01: Hermit Druid's reveal marks the hand card as put", run: async (h) => {
      const marks = [], seat = game(h, myMain(D2.board));
      for (const [ids, ab] of [[[H(43)], "{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard."],
        [[{ ...H(75), id: "engine-card-78" }], "Each player reveals the top card of their library. For each nonland card revealed this way, you gain 1 life. Then each player draws a card."]]) {
        seat.forget("search");
        h.B.onPrompt(seat, { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0-view", zone: "library", cards: ids }),
          sourceCard: { id: "engine-card-22", identity: { name: "Hermit Druid" }, text: "" }, sourceAbilityText: ab }); await h.flush();
        marks.push(Boolean(seat.justDid("search", 30000)));
      }
      return marks;
    } });
    // (hp-01 #3: a search for a kind of card that isn't there says so; one that is there stays a look)
    const fetchLook = (cardsShown) => ({ ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0-view", zone: "library", cards: cardsShown }),
      sourceCard: { id: "engine-card-22", identity: { name: "Verdant Catacombs" }, text: "" }, sourceAbilityText: "{T}, Pay 1 life, Sacrifice Verdant Catacombs: Search your library for a Swamp or Forest card, put it onto the battlefield, then shuffle." });
    add(promptCase("hp-01: a fetch that finds no Swamp or Forest", myMain(D2.board), fetchLook([{ ...H(43), types: ["Land"], subtypes: ["Island"] }]), [["ok"]]));
    add(promptCase("hp-01: a fetch whose Forest is there", myMain(D2.board), fetchLook([{ ...H(43), id: "engine-card-79", types: ["Land"], subtypes: ["Forest"], supertypes: ["Basic"] }]), [["ok"]]));
    // (hp-02 #6: a search's look at your library isn't a reveal, though the ability reveals what it finds: nothing logged)
    add({ name: "hp-02: Cultivate's library look is no reveal", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const mark = h.effects.length;
      h.B.onPrompt(seat, { ...fetchLook([H(43), { ...H(75), id: "engine-card-81" }]), sourceCard: { id: "engine-card-22", identity: { name: "Cultivate" }, text: "" },
        sourceAbilityText: "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle." }); await h.flush();
      return h.effects.slice(mark).filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
    } });
    // (hp-02 #7: Forge's step in its description wins over the whole text's purpose)
    const CULT = "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.";
    const cultP = (desc) => { const p = cards("Cultivate", CULT, "Cultivate"); return { ...p, input: { ...p.input, presentation: { title: "Cultivate", targets: [], ...(desc ? { description: desc } : {}) } } }; };
    add(promptCase("hp-02: Cultivate's second step from Forge's description", myMain(D2.board), cultP("Select a card to put onto the battlefield"), [["engine-card-75"]]));
    add(promptCase("hp-02: no step in the description: the purpose stays", myMain(D2.board), cultP(null), [["engine-card-75"]]));
    // (hp-02 #8: Brainstorm's two cards back on top)
    add(promptCase("hp-02: Brainstorm's cards to put back", myMain(D2.board), { ...cards("Brainstorm", "Draw three cards, then put two cards from your hand on top of your library in any order.", "Brainstorm", 2),
      input: { ...cards("Brainstorm", "x", "Brainstorm", 2).input, max: 2, cards: [H(75), H(35)].map((c) => ({ ...c, zone: "hand" })), presentation: { title: "Brainstorm", description: "Select up to 2 cards from your hand", targets: [] } } }, [["engine-card-75", "engine-card-35"]]));
    // (hp-15 gap: then which goes on top is asked; the one clicked ends on top (sent last), or the order kept: the first
    // picked on top)
    for (const [what, second] of [["the second on top", ["engine-card-35"]], ["kept", ["__keep"]]]) {
      add(promptCase(`hp-15 gap: Brainstorm's put-back order (${what})`, myMain(D2.board), { ...cards("Brainstorm", "Draw three cards, then put two cards from your hand on top of your library in any order.", "Brainstorm", 2),
        input: { ...cards("Brainstorm", "x", "Brainstorm", 2).input, max: 2, cards: [H(75), H(35)].map((c) => ({ ...c, zone: "hand" })), presentation: { title: "Brainstorm", description: "Select up to 2 cards from your hand", targets: [] } } }, [["engine-card-75", "engine-card-35"], second]));
    }
    // (hp-03 #1: "a creature card from among them and put it into your hand")
    add(promptCase("hp-03: Growing Rites' creature from the top four", myMain(D2.board), { ...cards("Growing Rites of Itlimoc", "When Growing Rites of Itlimoc enters, look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.", "Growing Rites of Itlimoc", 0) }, [["engine-card-75"]]));
    // (hp-03 #2: a pick from your own library marks the next card into the hand as put, however long the pick took; a pick
    // from the hand doesn't)
    add({ name: "hp-03: a pick from your library marks it put", run: async (h) => {
      const marks = [];
      // (suite review: and not from an opponent's library)
      for (const [zoneName, owner] of [["library", "player-0"], ["hand", "player-0"], ["library", "player-1"]]) {
        const seat = game(h, myMain(D2.board));
        seat.forget("search");
        const p = cards("Growing Rites of Itlimoc", "x", "Growing Rites of Itlimoc", 0);
        const ask = { ...p, input: { ...p.input, cards: p.input.cards.map((c) => ({ ...c, zone: zoneName, ownerId: owner })) } };
        h.B.onPrompt(seat, ask); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: ask.promptId, choice: ["engine-card-75"] }) }); await h.flush();
        marks.push(Boolean(seat.justDid("search", 30000)));
      }
      return marks;
    } });
    // (hp-03 #3: a battlefield card under another name transformed; a face-down one turned up is said as before)
    add({ name: "hp-03: log: a card transforms", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const b1 = myMain(D2.board);
      const bf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
      bf(b1).push({ id: "engine-card-959", identity: { name: "Growing Rites of Itlimoc" }, types: ["Enchantment"], ownerId: "player-0", controllerId: "player-0", text: "" });
      await feed(b1);
      const mark = lines().length;
      const b2 = clone(b1); bf(b2).find((c) => c.id === "engine-card-959").identity = { name: "Itlimoc, Cradle of the Sun" };
      await feed(b2);
      // (suite review: turned face down, it is no new name: nothing said, the card not named again)
      const b3 = clone(b2); bf(b3).find((c) => c.id === "engine-card-959").isFaceDown = true;
      await feed(b3);
      return lines().slice(mark);
    } });
    // (suite review: a graveyard or exile card into the hand says where from; a graveyard card shuffled into the library
    // is not put into a hand; a chosen discard while the library grows is all said)
    add({ name: "suite review: log: zone changes around the hand and library", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
      const card = (n, name) => ({ id: `engine-card-98${n}`, identity: { name }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
      const out = [];
      const start = myMain(D2.board);
      zone(start, "library").count = 20;
      zone(start, "exile").cards.push(card(1, "Rancor"));
      zone(start, "graveyard").cards.push(card(2, "Elixir of Immortality"));
      await feed(start);
      let mark = lines().length;
      const toHand = clone(start); zone(toHand, "exile").cards.pop();
      const hz = zone(toHand, "hand"); hz.count = (hz.count ?? hz.cards.length) + 1;
      await feed(toHand);
      out.push(lines().slice(mark)); mark = lines().length;
      const shuffled = clone(toHand); zone(shuffled, "graveyard").cards.pop(); zone(shuffled, "library").count = 21;
      await feed(shuffled);
      out.push(lines().slice(mark));
      h.B.onPrompt(seat, prompt("chooseCards", { min: 2, max: 2, cards: [H(43), H(35)], presentation: { title: "Discard" } })); await h.flush();
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["engine-card-43", "engine-card-35"] }) }); await h.flush();
      mark = lines().length;
      let grown = clone(shuffled);
      for (const id of ["engine-card-43", "engine-card-35"]) grown = moved(grown, id, "graveyard");
      zone(grown, "hand").count = zone(grown, "hand").cards.length;
      zone(grown, "library").count = 22;
      await feed(grown);
      out.push(lines().slice(mark));
      // (a hand card put onto the battlefield while two graveyard cards come back: the hand shows +1, both are said)
      const two = clone(grown);
      zone(two, "graveyard").cards.push(card(3, "Raise Dead"), card(4, "Gravedigger"));
      await feed(two);
      mark = lines().length;
      const back = clone(two);
      zone(back, "graveyard").cards.splice(-2);
      zone(back, "battlefield").cards.push(card(5, "Lotus Field"));
      const bh = zone(back, "hand"); bh.count = (bh.count ?? bh.cards.length) + 1;
      await feed(back);
      out.push(lines().slice(mark));
      return out;
    } });
    // (hp-03 #4: Six's milled land card)
    add(promptCase("hp-03: Six's land from among the milled cards", myMain(D2.board), { ...prompt("chooseBoolean", { presentation: { title: "Search your graveyard and exile?", targets: [] } }),
      sourceCard: { id: "engine-card-22", identity: { name: "Six" }, text: "" }, sourceAbilityText: "Whenever Six attacks, mill three cards. You may put a land card from among them into your hand." }, [["yes"]]));
    add(promptCase("hp-03: Six's land pick", myMain(D2.board), cards("Six", "Whenever Six attacks, mill three cards. You may put a land card from among them into your hand.", "Six", 0), [["engine-card-75"]]));
    // (hp-02 #9: a graveyard card into the hand is logged; a graveyard card exiled with the hand unchanged isn't "into hand")
    add({ name: "hp-02: log: a graveyard card into the hand", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (b, zn, owner) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
      const b1 = myMain(D2.board); const hz = zone(b1, "hand", "player-0"); hz.count = hz.count ?? hz.cards.length;
      zone(b1, "graveyard", "player-0").cards.push({ id: "engine-card-958", identity: { name: "Rancor" }, types: ["Enchantment"], ownerId: "player-0", controllerId: "player-0", text: "" },
        { id: "engine-card-957", identity: { name: "Rampaging Baloths" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
      await feed(b1);
      const mark = lines().length;
      const b2 = clone(b1); const gy = zone(b2, "graveyard", "player-0"); gy.cards = gy.cards.filter((c) => c.id !== "engine-card-958");
      const h2 = zone(b2, "hand", "player-0"); h2.cards.push({ id: "engine-card-958", identity: { name: "Rancor" }, types: ["Enchantment"], ownerId: "player-0", controllerId: "player-0", text: "" }); h2.count = hz.count + 1;
      await feed(b2);
      // (the Baloths exiled while a draw grew the hand: the draw, not the Baloths, is what reached the hand)
      const b3 = clone(b2); const gy3 = zone(b3, "graveyard", "player-0"); gy3.cards = gy3.cards.filter((c) => c.id !== "engine-card-957");
      const lib3 = zone(b3, "library", "player-0"); lib3.count = (lib3.count ?? lib3.cards.length) - 1; zone(b3, "hand", "player-0").count = h2.count + 1;
      await feed(b3);
      return lines().slice(mark);
    } });
    // (hp-04 #2: two target sentences: the one your own creatures fit)
    add({ name: "hp-04: Bridgeworks Battle's own creature", run: async (h) => {
      const b = myMain(D2.board);
      const mineIds = b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.slice(0, 2).map((c) => c.id);
      const seat = game(h, b);
      h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: mineIds.map((id) => ({ kind: "card", id })), presentation: { title: "Buff", targets: [] } }),
        sourceCard: { id: "engine-card-22", identity: { name: "Bridgeworks Battle" }, text: "" }, sourceAbilityText: "Target creature you control gets +2/+2 until end of turn. Then it fights up to one target creature you don't control." }); await h.flush();
      const one = seat.prompt?.ui?.title;
      // (two sentences your creatures fit: no guess, the plain question)
      h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: mineIds.map((id) => ({ kind: "card", id })), presentation: { title: "Buff", targets: [] } }), promptId: 901,
        sourceCard: { id: "engine-card-22", identity: { name: "Twin Boost" }, text: "" }, sourceAbilityText: "Target creature you control gets +1/+1 until end of turn. Untap target creature you control." }); await h.flush();
      return [one, seat.prompt?.ui?.title];
    } });
    // (hp-09: a mutating spell's own target, as Forge asks it live ("Hostile", no ability text); once on the battlefield,
    // its trigger's target)
    add({ name: "hp-09: Gemrazer's mutate target, then its trigger's", run: async (h) => {
      const GEM = "Mutate {1}{G}{G} (If you cast this spell for its mutate cost, put it over or under target non-Human creature you own. They mutate into the creature on top plus all abilities from under it.)\nReach, trample\nWhenever this creature mutates, destroy target artifact or enchantment an opponent controls.";
      const titles = [];
      for (const where of ["hand", "battlefield"]) {
        const b = myMain(D2.board);
        const bfz = b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
        const ids = bfz.cards.slice(0, 1).map((c) => c.id);
        if (where === "battlefield") bfz.cards.push({ id: "engine-card-993", identity: { name: "Gemrazer" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: GEM });
        const seat = game(h, b);
        h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: ids.map((id) => ({ kind: "card", id })), presentation: { title: "Hostile", targets: [] } }),
          sourceCard: { id: "engine-card-993", identity: { name: "Gemrazer" }, text: GEM } }); await h.flush();
        titles.push(seat.prompt?.ui?.title);
      }
      return titles;
    } });
    // (hp-09: a mutate onto or under a creature, as Forge sends it: the host keeps its id, takes the top card's name and
    // lists the merged card, which is on the battlefield attached to it)
    add({ name: "hp-09: log: mutate onto and under", run: async (h) => {
      const out = [];
      for (const onTop of [true, false]) {
        const start = myMain(D2.board);
        const seat = game(h, start);
        const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const bfz = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
        const base = { types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" };
        bfz(start).cards.push({ ...base, id: "engine-card-994", identity: { name: "Eidolon of Blossoms" } });
        await feed(start);
        const mark = lines().length;
        const next = clone(start);
        const host = bfz(next).cards.find((c) => c.id === "engine-card-994");
        if (onTop) host.identity = { name: "Gemrazer" };
        host.mergedCardIds = ["engine-card-995"];
        bfz(next).cards.push({ ...base, id: "engine-card-995", identity: { name: "Gemrazer" }, attachedTo: "engine-card-994" });
        await feed(next);
        out.push(lines().slice(mark));
      }
      return out;
    } });
    // (hp-09: Tooth and Nail entwined, as Forge asks it live: the library half, then the hand half)
    const TN = "Choose one —\n• Search your library for up to two creature cards, reveal them, put them into your hand, then shuffle.\n• Put up to two creature cards from your hand onto the battlefield.\n\n Search your library for up to two creature cards, reveal them, put them into your hand, then shuffle. Put up to two creature cards from your hand onto the battlefield.";
    for (const [zoneName, desc] of [["library", "Select up to 2 cards"], ["hand", "Select up to 2 cards from your hand"]]) {
      const tn = cards("Tooth and Nail", TN, "Tooth and Nail");
      add(promptCase(`hp-09: Tooth and Nail's ${zoneName} half`, myMain(D2.board), { ...tn, input: { ...tn.input, min: 0, max: 2, cards: tn.input.cards.map((c) => ({ ...c, zone: zoneName })),
        presentation: { title: "Tooth and Nail", description: desc, targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-09: a spell whose text grows while it is cast (entwine) is one cast; an ability of the same card is its own line)
    add({ name: "hp-09: log: a spell's text changing is one cast", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      await feed(start);
      const mark = lines().length;
      const spell = (text) => ({ id: "stack-tn", sourceId: "engine-card-996", controllerId: "player-0", identity: { name: "Tooth and Nail" }, sourceAbilityText: text, text });
      const one = clone(start); one.gameView.stack = [spell("Search your library for up to two creature cards, reveal them, put them into your hand, then shuffle.")]; await feed(one);
      const both = clone(start); both.gameView.stack = [spell("Search your library for up to two creature cards, reveal them, put them into your hand, then shuffle. Put up to two creature cards from your hand onto the battlefield.")]; await feed(both);
      const trig = clone(both); trig.gameView.stack = [...both.gameView.stack, { ...spell("When you cast this spell, you gain 1 life."), id: "stack-tr" }]; await feed(trig);
      return lines().slice(mark);
    } });
    // (hp-09: a rebound spell exiled off the stack says it comes back; another card exiled stays "is exiled")
    add({ name: "hp-09: log: rebound", run: async (h) => {
      const out = [];
      // (and a rebound card exiled from the hand, not off the stack: plain)
      for (const [name, keywords, cast_] of [["Ephemerate", ["Rebound"], true], ["Swords to Plowshares", [], true], ["Ephemerate", ["Rebound"], false]]) {
        const start = myMain(D2.board);
        const seat = game(h, start);
        const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const cast = clone(start); if (cast_) cast.gameView.stack = [{ id: "stack-eph", sourceId: "engine-card-997", controllerId: "player-0", identity: { name }, sourceAbilityText: "", text: "" }];
        await feed(cast);
        const mark = lines().length;
        const done = clone(start);
        done.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-0").cards.push({ id: "engine-card-997", identity: { name }, types: ["Instant"], keywords, ownerId: "player-0", controllerId: "player-0", text: "" });
        await feed(done);
        out.push(lines().slice(mark));
      }
      return out;
    } });
    // (hp-09: Sunfall's order of the creatures it exiles is kept without asking; the same text over cards not on the
    // battlefield still asks)
    {
      const SUN = "Exile all creatures. Incubate X, where is the number of creatures exiled this way.";
      const bfIds = D2.board.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.slice(0, 2);
      add(promptCase("hp-09: Sunfall's exile order is not asked", myMain(D2.board), { ...prompt("reorder", { items: bfIds.map((c) => ({ id: c.id, card: c })),
        presentation: { title: "Sunfall", description: "Arrange these cards in order.", targets: [] } }), sourceAbilityText: SUN, sourceCard: { id: "engine-card-22", identity: { name: "Sunfall" }, text: SUN } }, []));
      add(promptCase("hp-09: an exile-all order over other cards still asks", myMain(D2.board), { ...itemsP("Sunfall"), sourceAbilityText: SUN, sourceCard: { id: "engine-card-22", identity: { name: "Sunfall" }, text: SUN } }, [["__keep"]]));
    }
    // (hp-19 gap: Celebration's target, the trigger's "if ..., " left out)
    const RBM = "Celebration — At the beginning of combat on your turn, if two or more nonland permanents entered the battlefield under your control this turn, target creature you control gets +1/+1 until end of turn.";
    add(promptCase("hp-19 gap: celebration's target", myMain(D2.board), { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-64", kind: "card" }, { id: "engine-card-75", kind: "card" }], chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "Buff" } }),
      sourceCard: { id: "engine-card-956", identity: { name: "Raging Battle Mouse" }, text: RBM } }, [["card|engine-card-64"]]));
    // (hp-19 gap: Kinship's reveal, as Forge asks it live; the same question from another card stays as it was)
    const KIN = "Kinship — At the beginning of your upkeep, you may look at the top card of your library. If it shares a creature type with Leaf-Crowned Elder, you may reveal it. If you do, you may play that card without paying its mana cost.";
    for (const [what, text] of [["kinship", KIN], ["other", "Reveal the top card of your library."]]) {
      add(promptCase(`hp-19 gap: a reveal question (${what})`, myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { targets: [], title: "Reveal cards to other players?" } }),
        sourceAbilityText: text, sourceCard: { id: "engine-card-957", identity: { name: "Leaf-Crowned Elder" }, text } }, [["yes"]]));
    }
    // (hp-19 gap: Endure's choice, as Forge asks it live: its rules sentence as the title, no ability text)
    add(promptCase("hp-19 gap: endure's choice", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline",
      presentation: { targets: [], title: "You may put 2 +1/+1 counters on Leaf-Crowned Elder. If you don't, create a 2/2 white Spirit creature token." } }),
      sourceCard: { id: "engine-card-955", identity: { name: "Leaf-Crowned Elder" }, text: "Kinship — At the beginning of your upkeep, you may look at the top card of your library." } }, [["yes"]]));
    // (hp-20 gap: Council's Judgment's vote, as Forge asks it live)
    add(promptCase("hp-20 gap: a council's vote", myMain(D2.board), { ...prompt("chooseFromSelection", { maxTotal: 1, minTotal: 1, presentation: { targets: [], title: "Council's Judgment" },
      options: [{ canRepeat: false, label: "Burning-Tree Emissary (106)", weight: 1 }, { canRepeat: false, label: "Centaur Courser (121)", weight: 1 }] }),
      sourceAbilityText: "Will of the Council — Starting with you, each player votes for a nonland permanent you don't control. Exile each permanent with the most votes or tied for most votes.",
      sourceCard: { id: "engine-card-959", identity: { name: "Council's Judgment" }, text: "x" } }, [["0"]]));
    // (mutation pass: endure 1 says "counter"; a selection where only one option names an additional cost keeps its own
    // words)
    add(promptCase("hp-19 gap: endure's choice (1)", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline",
      presentation: { targets: [], title: "You may put 1 +1/+1 counter on Leaf-Crowned Elder. If you don't, create a 1/1 white Spirit creature token." } }),
      sourceCard: { id: "engine-card-955", identity: { name: "Leaf-Crowned Elder" }, text: "Kinship" } }, [["yes"]]));
    add(promptCase("hp-19 gap: a selection with one additional cost", myMain(D2.board), { ...prompt("chooseFromSelection", { maxTotal: 1, minTotal: 1, presentation: { targets: [], title: "Some Spell" },
      options: [{ canRepeat: false, label: "Some Spell - Sorcery (Additional cost: {3})", weight: 1 }, { canRepeat: false, label: "Some Spell - Sorcery", weight: 1 }] }),
      sourceCard: { id: "engine-card-958", identity: { name: "Some Spell" }, text: "x" } }, [["1"]]));
    // (hp-19 gap: Champion's choice, as Forge asks it live: "Search your battlefield?")
    const CH19 = "Champion a Merfolk (When this permanent enters, sacrifice it unless you exile another Merfolk you control. When this permanent leaves the battlefield, return the exiled card to the battlefield under its owner's control.)";
    add(promptCase("hp-19 gap: champion's choice", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { targets: [], title: "Search your battlefield?" } }),
      sourceAbilityText: CH19, sourceCard: { id: "engine-card-5", identity: { name: "Wanderwine Prophets" }, text: CH19 } }, [["yes"]]));
    // (and its exile: the Merfolk of yours, under the card's own name as Forge titles it)
    add(promptCase("hp-19 gap: champion's exile", myMain(D2.board), { ...prompt("chooseCards", { cancellable: false, min: 0, max: 1,
      cards: ["engine-card-6", "engine-card-7"].map((id, i) => ({ id, identity: { name: i ? "Merrow Reejerey" : "Silvergill Adept" }, types: ["Creature"], subtypes: ["Merfolk"], ownerId: "player-0", controllerId: "player-0", zone: "battlefield", text: "" })),
      presentation: { description: "", targets: [], title: "Wanderwine Prophets" } }), sourceAbilityText: CH19, sourceCard: { id: "engine-card-5", identity: { name: "Wanderwine Prophets" }, text: CH19 } }, [["engine-card-6"]]));
    // (hp-19 gap: Silvergill Adept's additional cost, as Forge asks it live: the two costs, not two identical labels)
    add(promptCase("hp-19 gap: an additional cost to choose", myMain(D2.board), { ...prompt("chooseFromSelection", { maxTotal: 1, minTotal: 0, presentation: { targets: [], title: "Silvergill Adept" },
      options: [{ canRepeat: false, label: "Silvergill Adept - Creature 2 / 1 (Additional cost: Reveal a Merfolk card from your hand)", weight: 1 }, { canRepeat: false, label: "Silvergill Adept - Creature 2 / 1 (Additional cost: {3})", weight: 1 }] }),
      sourceCard: { id: "engine-card-954", identity: { name: "Silvergill Adept" }, text: "As an additional cost to cast this spell, reveal a Merfolk card from your hand or pay {3}.\nWhen Silvergill Adept enters, draw a card." } }, [["1"]]));
    // (hp-16 gap: Survival of the Fittest's discard cost, as Forge asks it live; a discard that is no cost (Faithless
    // Looting's) keeps its old words)
    {
      const hand = (id, name) => ({ id, identity: { name }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", zone: "hand", text: "" });
      const ask = (name, text) => add(promptCase(`hp-16 gap: ${name}'s discard`, myMain(D2.board), { ...prompt("chooseCards", { cancellable: true, min: 1, max: 1, cards: [hand("engine-card-15", "Chameleon, Master of Disguise")],
        presentation: { description: "Choose cards to discard", targets: [], title: name } }), sourceAbilityText: text, sourceCard: { id: "engine-card-946", identity: { name }, text } }, [["engine-card-15"]]));
      ask("Survival of the Fittest", "{G}, Discard a creature card: Search your library for a Creature card and put it into your hand. Then shuffle.");
      ask("Faithless Looting", "Draw two cards, then discard two cards.");
      // (Volatile Stormdrake's exchange, as Forge asks it live: "GainControl"; and an unknown run-together hint is no title)
      const SD = "Flying, hexproof from activated and triggered abilities\nWhen Volatile Stormdrake enters, exchange control of Volatile Stormdrake and target creature an opponent controls. If you do, you get {E}{E}{E}{E}, then sacrifice that creature unless you pay an amount of {E} equal to its mana value.";
      // (mutation pass: and GainControl over a card whose text says nothing of it: the hint's verb)
      for (const [title, text, what] of [["GainControl", SD, ""], ["SomeThing", "Flying", ""], ["GainControl", "Flying", ", no sentence"]]) {
        add(promptCase(`hp-16 gap: a run-together hint (${title}${what})`, myMain(D2.board), { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-64", kind: "card" }, { id: "engine-card-75", kind: "card" }], chosenTargets: 0, hostile: true, intent: "gainControl", maxTargets: 1, minTargets: 1, presentation: { targets: [], title } }),
          sourceCard: { id: "engine-card-947", identity: { name: "Volatile Stormdrake" }, text } }, [["card|engine-card-64"]]));
      }
      // (hp-18 gap: Avatar's Wrath's spared creature, as Forge asks it live)
      const AW = "Choose up to one target creature, then airbend all other creatures. (Exile them. While each one is exiled, its owner may cast it for {2} rather than its mana cost.)\nUntil your next turn, your opponents can't cast spells from anywhere other than their hands.\nExile Avatar's Wrath.";
      add(promptCase("hp-18 gap: Avatar's Wrath's spared creature", myMain(D2.board), { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-64", kind: "card" }, { id: "engine-card-75", kind: "card" }], chosenTargets: 0, maxTargets: 1, minTargets: 0, presentation: { targets: [], title: "Buff" } }),
        sourceAbilityText: AW, sourceCard: { id: "engine-card-953", identity: { name: "Avatar's Wrath" }, text: AW } }, [["card|engine-card-64"]]));
      // (hp-20 gap: Blind Hunter's haunt, as it dies (in the graveyard), over creatures; and its haunt trigger later, from
      // exile, over players: that one keeps "which player loses 2 life")
      const BH = "Haunt (When this creature dies, exile it haunting target creature.)\nWhen Blind Hunter enters or the creature it haunts dies, target player loses 2 life and you gain 2 life.";
      for (const [what, cands] of [["creature to haunt", [{ id: "engine-card-64", kind: "card" }, { id: "engine-card-75", kind: "card" }]], ["haunt trigger's player", [{ id: "player-1", kind: "player" }, { id: "player-0", kind: "player" }]]]) {
        add(promptCase(`hp-20 gap: Blind Hunter's ${what}`, myMain(D2.board), { ...prompt("chooseBoardTargets", { cancellable: false, candidates: cands, chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "Hostile" } }),
          sourceCard: { id: "engine-card-32", identity: { name: "Blind Hunter" }, text: BH } }, [[`${cands[0].kind}|${cands[0].id}`]]));
      }
      // (mutation pass: a haunt card's own enter trigger over creatures, the card on the battlefield: its sentence, no haunt)
      {
        const HZ = "Haunt (When this creature dies, exile it haunting target creature.)\nWhen Some Haunter enters or the creature it haunts dies, Some Haunter deals 2 damage to target creature.";
        const b = myMain(D2.board);
        b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-960", identity: { name: "Some Haunter" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: HZ });
        add(promptCase("hp-20 gap: a haunt card's enter trigger", b, { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-64", kind: "card" }, { id: "engine-card-75", kind: "card" }], chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "Hostile" } }),
          sourceCard: { id: "engine-card-960", identity: { name: "Some Haunter" }, text: HZ } }, [["card|engine-card-64"]]));
      }
      // (hp-17 gap: an Aura's target, as Forge asks it live ("Attach"): its "Enchant creature" line)
      const BU = "Enchant creature\nEnchanted creature gets +2/+2 and has trample.\nUmbra armor (If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura.)";
      add(promptCase("hp-17 gap: an Aura's target", myMain(D2.board), { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-64", kind: "card" }, { id: "engine-card-75", kind: "card" }], chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "Attach" } }),
        sourceCard: { id: "engine-card-948", identity: { name: "Bear Umbra" }, text: BU } }, [["card|engine-card-64"]]));
      // (hp-21 gap: time travel's card, as Forge asks it live)
      const TT = "Timey-Wimey — {7}: Timey-Wimey — {7}: Time travel three times. Activate only as a sorcery. (For each suspended card you own and each permanent you control with a time counter on it, you may add or remove a time counter. Then do it two more times.)";
      add(promptCase("hp-21 gap: time travel's card", myMain(D2.board), { ...prompt("chooseCards", { cancellable: false, min: 0, max: 1, cards: [{ ...hand("engine-card-31", "Gilded Goose"), zone: "exile", counters: { TIME: 3 } }],
        presentation: { description: "Choose a card", targets: [], title: "The Tenth Doctor" } }), sourceAbilityText: TT, sourceCard: { id: "engine-card-961", identity: { name: "The Tenth Doctor" }, text: "x" } }, [["engine-card-31"]]));
      // (and its add or remove, as Forge asks it live)
      add(promptCase("hp-21 gap: time travel's add or remove", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Add Counter", denyLabel: "Remove Counter",
        presentation: { targets: [], title: "choose what to do with 'Time' counter on Gilded Goose?" } }), sourceAbilityText: TT, sourceCard: { id: "engine-card-961", identity: { name: "The Tenth Doctor" }, text: "x" } }, [["no"]]));
      // (hp-21 gap: Forage as a cost, as Forge asks it live)
      add(promptCase("hp-21 gap: forage's cost", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { targets: [], title: "Forage" } }),
        sourceAbilityText: "{2}, Forage: Put a +1/+1 counter on each other Squirrel you control. (To forage, exile three cards from your graveyard or sacrifice a Food.)", sourceCard: { id: "engine-card-962", identity: { name: "Camellia, the Seedmiser" }, text: "x" } }, [["yes"]]));
      // (and the way to forage, as the harness asks it live, with the AddOrRemove buttons)
      add(promptCase("hp-21 gap: forage's way", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Add Counter", denyLabel: "Remove Counter", presentation: { targets: [], title: "Forage: sacrifice Food instead of exiling three cards?" } }),
        sourceAbilityText: "{2}, Forage: Put a +1/+1 counter on each other Squirrel you control. (To forage, exile three cards from your graveyard or sacrifice a Food.)", sourceCard: { id: "engine-card-962", identity: { name: "Camellia, the Seedmiser" }, text: "x" } }, [["yes"]]));
      // (hp-21 gap: Provoke's creature, as Forge asks it live ("Hostile"), then its "you may" on resolution naming that
      // creature from the trigger's targets on the stack, the pick being long gone)
      const PV = "Provoke (Whenever this creature attacks, you may have target creature defending player controls untap and block it if able.)";
      add(promptCase("hp-21 gap: provoke's creature", myMain(D2.board), { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-64", kind: "card" }], chosenTargets: 0, maxTargets: 1, minTargets: 1, hostile: true, intent: "hostile", presentation: { targets: [], title: "Hostile" } }),
        sourceCard: { id: "engine-card-963", identity: { name: "Goblin Grappler" }, text: PV, keywords: ["Provoke"], isAttacking: true } }, [["card|engine-card-64"]]));
      // (a provoke card's other target keeps its own sentence)
      add(promptCase("hp-21 gap: a provoke card's other target", myMain(D2.board), { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-64", kind: "card" }], chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "Deal damage" } }),
        sourceCard: { id: "engine-card-964", identity: { name: "Goblin Grappler" }, text: `${PV}\nWhen this creature enters, it deals 1 damage to target creature.` } }, [["card|engine-card-64"]]));
      // (with no target known, another card's trigger on the stack targeting a creature isn't taken for its own)
      for (const onStack of [true, false]) {
        const b = myMain(D2.board);
        b.gameView.stack = [{ id: "engine-stack-92", sourceId: "engine-card-965", controllerId: "player-1", identity: { name: "Fading Hope" }, sourceAbilityText: "Return target creature with mana value 3 or less to its owner's hand.", targets: [{ kind: "card", id: "engine-card-64" }] }];
        if (onStack) b.gameView.stack.unshift({ id: "engine-stack-91", sourceId: "engine-card-963", controllerId: "player-0", identity: { name: "Goblin Grappler" }, sourceAbilityText: PV, targets: [{ kind: "card", id: "engine-card-64" }] });
        add(promptCase(`hp-21 gap: provoke's you may (${onStack ? "its target on the stack" : "no target known"})`, b, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline",
          presentation: { description: PV, targets: [], title: "Use triggered ability of Goblin Grappler?" } }), sourceAbilityText: PV, sourceCard: { id: "engine-card-963", identity: { name: "Goblin Grappler" }, text: PV } }, [["yes"]]));
      }
      // (Enlist's attackers, as Forge asks it live: no source card, "Choose attackers to enlist")
      add(promptCase("hp-16 gap: enlist's attackers", myMain(D2.board), { ...prompt("chooseCards", { cancellable: false, min: 0, max: 1, cards: [{ ...hand("engine-card-39", "Yavimaya Steelcrusher"), zone: "battlefield" }],
        presentation: { description: "Choose attackers to enlist", targets: [], title: "Choose cards" } }) }, [["engine-card-39"]]));
      // (Chameleon's copy, as Forge asks it live: "Choose a card " over creatures you control, no ability text)
      const CH = "You may have Chameleon enter as a copy of a creature you control, except his name is Chameleon, Master of Disguise.\nMayhem {2}{U} (You may cast this card from your graveyard for {2}{U} if you discarded it this turn. Timing rules still apply.)";
      add(promptCase("hp-16 gap: Chameleon's copy", myMain(D2.board), { ...prompt("chooseCards", { cancellable: false, min: 1, max: 1, cards: [{ ...hand("engine-card-139", "Kenrith, the Returned King"), zone: "battlefield" }, { ...hand("engine-card-143", "Rebel Token"), zone: "battlefield" }],
        presentation: { description: "Choose a card ", targets: [], title: "Chameleon, Master of Disguise" } }), sourceCard: { id: "engine-card-15", identity: { name: "Chameleon, Master of Disguise" }, text: CH } }, [["engine-card-139"]]));
    }
    // (hp-15 gap: HULK SMASH! with teamwork, both modes, as Forge asks it live: every mode in the ability text, no blank
    // line; each target by the mode its candidates fit)
    {
      const HS = "Choose X. If this spell was cast using teamwork, choose both instead.\r\n• Destroy target noncreature artifact.\r\n• Target creature you control deals damage equal to its power to target creature an opponent controls.";
      const bd = myMain(D2.board);
      const put = (o, c) => bd.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === o).cards.push({ ownerId: o, controllerId: o, text: "", ...c });
      put("player-0", { id: "engine-card-937", identity: { name: "Thran Dynamo" }, types: ["Artifact"] });
      put("player-0", { id: "engine-card-938", identity: { name: "Bloom Tender" }, types: ["Creature"] });
      put("player-0", { id: "engine-card-939", identity: { name: "Kenrith, the Returned King" }, types: ["Creature"] });
      put("player-1", { id: "engine-card-940", identity: { name: "Savannah Lions" }, types: ["Creature"] });
      const t = (name, ids, title) => add(promptCase(`hp-15 gap: HULK SMASH!'s ${name}`, bd, { ...prompt("chooseBoardTargets", { cancellable: true, candidates: ids.map((id) => ({ id, kind: "card" })), chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title } }),
        sourceAbilityText: HS, sourceCard: { id: "engine-card-941", identity: { name: "HULK SMASH!" }, text: HS } }, [[`card|${ids[0]}`]]));
      t("artifact", ["engine-card-937"], "Destroy");
      t("creature of yours", ["engine-card-939", "engine-card-938"], "Buff");
      t("opponent's creature", ["engine-card-940"], "Damage");
      // (its teamwork cost, as Forge asks it live: the creatures to tap, said as teamwork, not crew)
      add(promptCase("hp-15 gap: teamwork's creatures to tap", bd, { ...prompt("chooseCards", { cancellable: true, min: 0, max: 1, cards: [{ id: "engine-card-939", identity: { name: "Kenrith, the Returned King" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", zone: "battlefield", power: "5", toughness: "5", text: "" }],
        presentation: { description: "Select creatures to tap (total power 4 or greater)", targets: [], title: "HULK SMASH!" } }), sourceAbilityText: HS,
        sourceCard: { id: "engine-card-941", identity: { name: "HULK SMASH!" }, text: "Teamwork 4 (As an additional cost to cast this spell, you may tap any number of creatures you control with total power 4 or more.)\nChoose one. If this spell was cast using teamwork, choose both instead.\n• Destroy target noncreature artifact.\n• Target creature you control deals damage equal to its power to target creature an opponent controls." } }, [["engine-card-939"]]));
      // (mutation pass: an artifact creature of yours fits "creature you control", not "noncreature artifact"; two modes
      // with the same target phrase are no answer, the question stays plain; one bullet alone is read without it)
      put("player-0", { id: "engine-card-943", identity: { name: "Steel Overseer" }, types: ["Artifact", "Creature"] });
      t("artifact creature of yours", ["engine-card-943"], "Buff");
      const TWO = "Choose one —\r\n• Destroy target creature an opponent controls.\r\n• Target creature an opponent controls gets -2/-2 until end of turn.";
      add(promptCase("hp-15 gap: two modes with one target phrase", bd, { ...prompt("chooseBoardTargets", { cancellable: true, candidates: [{ id: "engine-card-940", kind: "card" }], chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Hostile" } }),
        sourceAbilityText: TWO, sourceCard: { id: "engine-card-944", identity: { name: "Some Charm" }, text: TWO } }, [["card|engine-card-940"]]));
      const ONE = "• Destroy target artifact.";
      add(promptCase("hp-15 gap: a lone mode's bullet", bd, { ...prompt("chooseBoardTargets", { cancellable: true, candidates: [{ id: "engine-card-937", kind: "card" }], chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Destroy" } }),
        sourceAbilityText: ONE, sourceCard: { id: "engine-card-945", identity: { name: "Some Command" }, text: ONE } }, [["card|engine-card-937"]]));
      // (hp-17 gap: Gimli's Reckless Might's formidable, two targets in one sentence, no modes: the attacking creature of
      // yours, its condition left out)
      const GR = "Creatures you control have haste.\nFormidable — Whenever you attack, if creatures you control have total power 8 or greater, target attacking creature you control fights up to one target creature you don't control.";
      bd.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.find((c) => c.id === "engine-card-939").isAttacking = true;
      add(promptCase("hp-17 gap: formidable's attacker", bd, { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-939", kind: "card" }], chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Fight" } }),
        sourceCard: { id: "engine-card-949", identity: { name: "Gimli's Reckless Might" }, text: GR } }, [["card|engine-card-939"]]));
      // (mutation pass: a state word decides: a tapped creature fits "target tapped creature", not "target untapped
      // creature")
      const TU = "Choose one —\r\n• Destroy target tapped creature.\r\n• Target untapped creature gets +2/+2 until end of turn.";
      put("player-1", { id: "engine-card-950", identity: { name: "Tapped Bear" }, types: ["Creature"], tapped: true });
      add(promptCase("hp-17 gap: a state word picks the mode", bd, { ...prompt("chooseBoardTargets", { cancellable: true, candidates: [{ id: "engine-card-950", kind: "card" }], chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Hostile" } }),
        sourceAbilityText: TU, sourceCard: { id: "engine-card-951", identity: { name: "Some Charm" }, text: TU } }, [["card|engine-card-950"]]));
      // (and its second target, "up to one target creature you don't control", as Forge asks it live ("Fight"))
      add(promptCase("hp-17 gap: formidable's creature to fight", bd, { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-940", kind: "card" }], chosenTargets: 0, minTargets: 0, maxTargets: 1, presentation: { targets: [], title: "Fight" } }),
        sourceCard: { id: "engine-card-949", identity: { name: "Gimli's Reckless Might" }, text: GR } }, [["card|engine-card-940"]]));
      // (one mode only, no bullets: the sentence as before)
      add(promptCase("hp-15 gap: a single-mode target keeps its sentence", bd, { ...prompt("chooseBoardTargets", { cancellable: true, candidates: [{ id: "engine-card-937", kind: "card" }], chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Destroy" } }),
        sourceAbilityText: "Destroy target artifact.", sourceCard: { id: "engine-card-942", identity: { name: "Shatter" }, text: "Destroy target artifact." } }, [["card|engine-card-937"]]));
    }
    // (hp-15 gap: Miracle's trigger, as Forge asks it live: no ability text, "<card> - Miracle" as its description)
    add(promptCase("hp-15 gap: miracle's trigger", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { description: "Reforge the Soul - Miracle", targets: [], title: "Use triggered ability of Reforge the Soul?" } }),
      sourceCard: { id: "engine-card-4", identity: { name: "Reforge the Soul" }, text: "Each player discards their hand, then draws seven cards.\nMiracle {1}{R} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)" } }, [["yes"]]));
    add(promptCase("hp-15 gap: miracle's cast", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { targets: [], title: "Do you want to play Reforge the Soul?" } }),
      sourceAbilityText: "Reforge the Soul - Miracle",
      sourceCard: { id: "engine-card-4", identity: { name: "Reforge the Soul" }, controllerId: "player-0", text: "Each player discards their hand, then draws seven cards.\nMiracle {1}{R} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)" } }, [["yes"]]));
    // (hp-15 gap: the miracle cast in the log, by its way; "Don't cast" logs nothing)
    for (const answer of ["yes", "no"]) {
      add({ name: `hp-15 gap: log: a miracle cast (${answer})`, run: async (h) => {
        const start = myMain(D2.board);
        const seat = game(h, start);
        await boardAs(h, seat, start);
        const mark = logLines(h).length;
        h.B.onPrompt(seat, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { targets: [], title: "Do you want to play Reforge the Soul?" } }),
          sourceAbilityText: "Reforge the Soul - Miracle", promptId: 969,
          sourceCard: { id: "engine-card-75", identity: { name: "Reforge the Soul" }, controllerId: "player-0", text: "Each player discards their hand, then draws seven cards.\nMiracle {1}{R} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)" } }); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 969, choice: [answer] }) }); await h.flush();
        // ("Don't cast": the card stays in the hand, nothing is said on the next board either)
        // (then cast the usual way the same turn: no "(miracle)")
        if (answer === "no") {
          await boardAs(h, seat, clone(start));
          h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: [{ id: "a-cast", type: "cast", cardId: "engine-card-75", label: "Cast Reforge the Soul", mode: { type: "normal" } }, { id: "pass", type: "pass", label: "Pass priority" }] }), promptId: 973 }); await h.flush();
          const opt = (seat.prompt?.ui?.options || []).find((o) => /Reforge/.test(o.label));
          h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 973, choice: [opt?.id] }) }); await h.flush();
        }
        {
          const b = clone(start);
          for (const z of b.gameView.zones) if (z.cards) z.cards = z.cards.filter((c) => c.id !== "engine-card-75");
          b.gameView.stack = [{ id: "stack-mir", sourceId: "engine-card-75", controllerId: "player-0", identity: { name: "Reforge the Soul" }, sourceAbilityText: "", isPermanentSpell: false }];
          await boardAs(h, seat, b);
        }
        return logLines(h).slice(mark);
      } });
    }
    // (hp-15 gap: Varragoth's boast, as Forge asks it live: the player it targeted searches their own library)
    {
      const VB = "Boast —  {1}{B}: Target player searches their library for a card, then shuffles their library and puts that card on top of it.";
      const libCard = (id, name, types) => ({ id, identity: { name }, types, ownerId: "player-0", controllerId: "player-0", text: "", zone: "library" });
      add(promptCase("hp-15 gap: boast's search", myMain(D2.board), { ...prompt("chooseCards", { cancellable: false, min: 1, max: 1, cards: [libCard("engine-card-36", "Brainstorm", ["Instant"]), libCard("engine-card-14", "City of Brass", ["Land"])],
        presentation: { title: "Varragoth, Bloodsky Sire", description: "Select a card from your library", targets: [] } }), sourceAbilityText: VB, sourceCard: { id: "engine-card-61", identity: { name: "Varragoth, Bloodsky Sire" }, text: VB } }, [["engine-card-36"]]));
    }
    // (hp-15 gap: the order Animist's Awakening's lands go onto the battlefield is kept without asking, as Forge asks it
    // live; lands put back on top of the library (Ponder) are still asked, and so is a mix with a nonland card)
    {
      const AA = "Reveal the top X cards of your library. Put all land cards from among them onto the battlefield tapped and the rest on the bottom of your library in a random order. Spell mastery — If there are two or more instant and/or sorcery cards in your graveyard, untap those lands.";
      const PON = "Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card.";
      const land = (id, name) => ({ id, card: { id, identity: { name }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" } });
      const lands = [land("engine-card-9", "Command Tower"), land("engine-card-19", "Forest"), land("engine-card-35", "Exotic Orchard")];
      const p = (items, text, name) => ({ ...prompt("reorder", { items, presentation: { title: name, description: "Arrange these cards in order.", targets: [] } }), sourceAbilityText: text, sourceCard: { id: "engine-card-60", identity: { name }, text } });
      add(promptCase("hp-15 gap: Animist's Awakening's land order is not asked", myMain(D2.board), p(lands, AA, "Animist's Awakening"), []));
      add(promptCase("hp-15 gap: lands put back on the library are asked", myMain(D2.board), p(lands, PON, "Ponder"), [["__keep"]]));
      add(promptCase("hp-15 gap: a nonland among them is asked", myMain(D2.board), p([...lands, { id: "engine-card-36", card: { id: "engine-card-36", identity: { name: "Island Fish Jasconius" }, types: ["Creature"], text: "" } }], AA, "Animist's Awakening"), [["__keep"]]));
    }
    // (hp-09: rebound's cast at the upkeep, as Forge asks it live: no "(Original)")
    {
      const REB = "At the beginning of your next upkeep, you may cast Ephemerate (Original) without paying its mana cost.";
      add(promptCase("hp-09: rebound's cast question", myMain(D2.board), { ...prompt("chooseBoolean", { presentation: { title: "Use triggered ability of Ephemerate?", description: REB, targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }),
        sourceAbilityText: REB, sourceCard: { id: "engine-card-22", identity: { name: "Ephemerate" }, text: "Exile target creature you control, then return it to the battlefield under its owner's control.\nRebound" } }, [["yes"]]));
    }
    // (hp-09: after yes to rebound's free cast, Forge's "Do you want to play Ephemerate?" is the same cast; after no,
    // or for another card, it is asked)
    add({ name: "hp-09: rebound's cast is asked once", run: async (h) => {
      const REB = "At the beginning of your next upkeep, you may cast Ephemerate (Original) without paying its mana cost.";
      const out = [];
      for (const [answer, playName] of [["yes", "Ephemerate"], ["no", "Ephemerate"], ["yes", "Swords to Plowshares"]]) {
        const seat = game(h, myMain(D2.board));
        const ask = { ...prompt("chooseBoolean", { presentation: { title: "Use triggered ability of Ephemerate?", description: REB, targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }),
          sourceAbilityText: REB, sourceCard: { id: "engine-card-22", identity: { name: "Ephemerate" }, text: "x" } };
        h.B.onPrompt(seat, ask); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: ask.promptId, choice: [answer] }) }); await h.flush();
        const sentBefore = h.effects.length;
        h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { title: `Do you want to play ${playName}?`, targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }), promptId: ask.promptId + 1,
          sourceCard: { id: "engine-card-22", identity: { name: playName }, text: "x" } }); await h.flush();
        out.push({ answer, playName, asked: seat.prompt?.ui?.title || null, sent: h.effects.slice(sentBefore).filter((e) => JSON.stringify(e).includes("\"decision\"")) });
      }
      return out;
    } });
    // (hp-09: escape's cards to exile, as Forge asks it live: "Exile for cost" from the graveyard)
    {
      const URO = "When Uro enters, sacrifice it unless it escaped.\nWhenever Uro enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.\nEscape—{G}{G}{U}{U}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)";
      const uro = cards("Uro, Titan of Nature's Wrath", "x", "Uro, Titan of Nature's Wrath");
      add(promptCase("hp-09: Uro's escape cost", myMain(D2.board), { ...uro, sourceAbilityText: undefined, sourceCard: { ...uro.sourceCard, text: URO },
        input: { ...uro.input, min: 2, max: 2, cards: uro.input.cards.map((c) => ({ ...c, zone: "graveyard" })), presentation: { title: "Uro, Titan of Nature's Wrath", description: "Exile for cost", targets: [] } } }, [uro.input.cards.slice(0, 2).map((c) => c.id)]));
      // (a keyword before its reminder, Forge's "Tap for cost": Evendo's station)
      const EVE = "This land enters tapped.\n{T}: Add {G}.\nStation (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)\nSTATION 12+\n{G}, {T}: Add {G} for each creature you control.";
      const eve = cards("Evendo, Waking Haven", "x", "Evendo, Waking Haven");
      add(promptCase("hp-09: Evendo's station cost", myMain(D2.board), { ...eve, sourceAbilityText: undefined, sourceCard: { ...eve.sourceCard, text: EVE },
        input: { ...eve.input, min: 1, max: 1, presentation: { title: "Evendo, Waking Haven", description: "Tap for cost", targets: [] } } }, [["engine-card-75"]]));
      // (suite review: a range of cards has no "(choose N)"; the card's text from the board when the prompt has none)
      {
        const onBf = myMain(D2.board);
        onBf.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-974", identity: { name: "Evendo, Waking Haven" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: EVE });
        add(promptCase("hp-09: a cost pick of a range, the text from the board", onBf, { ...eve, sourceAbilityText: undefined, sourceCard: { id: "engine-card-974", identity: { name: "Evendo, Waking Haven" } },
          input: { ...eve.input, min: 1, max: 2, presentation: { title: "Evendo, Waking Haven", description: "Tap for cost", targets: [] } } }, [["engine-card-75"]]));
      }
      // (manifest dread's pick, as Forge asks it live; a plain manifest says only face down)
      for (const [label, ab] of [["manifest dread", "At the beginning of each opponent's upkeep, manifest dread. (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)"],
        ["manifest", "Manifest the top card of your library."]]) {
        const md = cards("Abhorrent Oculus", ab, "Abhorrent Oculus");
        add(promptCase(`hp-09: ${label}'s pick`, myMain(D2.board), { ...md, input: { ...md.input, min: 1, max: 1, cards: md.input.cards.map((c) => ({ ...c, zone: "library" })),
          presentation: { title: "Abhorrent Oculus", description: "Choose cards to manifest", targets: [] } } }, [["engine-card-75"]]));
      }
      // (an additional cost, no keyword: Abhorrent Oculus)
      const OCU = "As an additional cost to cast this spell, exile six cards from your graveyard.\nFlying\nAt the beginning of each opponent's upkeep, manifest dread. (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)";
      const ocu = cards("Abhorrent Oculus", "x", "Abhorrent Oculus");
      add(promptCase("hp-09: Abhorrent Oculus's additional cost", myMain(D2.board), { ...ocu, sourceAbilityText: undefined, sourceCard: { ...ocu.sourceCard, text: OCU },
        input: { ...ocu.input, min: 2, max: 2, cards: ocu.input.cards.map((c) => ({ ...c, zone: "graveyard" })), presentation: { title: "Abhorrent Oculus", description: "Exile for cost", targets: [] } } }, [ocu.input.cards.slice(0, 2).map((c) => c.id)]));
    }
    // (hp-09: cards exiled from a graveyard are one line; a battlefield card exiled is said as before)
    add({ name: "hp-09: log: graveyard cards exiled together", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
      const card = (n, name) => ({ id: `engine-card-99${n}`, identity: { name }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" });
      zone(start, "graveyard").cards.push(card(1, "Forest"), card(2, "Island"), card(3, "Plains"), card(4, "Swamp"));
      zone(start, "battlefield").cards.push(card(5, "Mountain"));
      await feed(start);
      const out = [];
      let mark = lines().length;
      const one = clone(start); zone(one, "exile").cards.push(zone(one, "graveyard").cards.pop()); await feed(one);
      out.push(lines().slice(mark)); mark = lines().length;
      const three = clone(one);
      for (let i = 0; i < 3; i++) zone(three, "exile").cards.push(zone(three, "graveyard").cards.pop());
      zone(three, "exile").cards.push(zone(three, "battlefield").cards.pop());
      await feed(three);
      out.push(lines().slice(mark));
      return out;
    } });
    // (hp-09: a face-down spell's creature off the stack enters; nothing named)
    add({ name: "hp-09: log: a face-down spell enters", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const onStack = clone(start); onStack.gameView.stack = [{ id: "stack-fd", sourceId: "engine-card-999", controllerId: "player-0", identity: { name: "?" }, sourceAbilityText: "", text: "", isPermanentSpell: true }];
      await feed(onStack);
      const mark = lines().length;
      const down = clone(start);
      down.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-999", identity: { name: "Hidden Morph" }, isFaceDown: true, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
      await feed(down);
      return lines().slice(mark);
    } });
    // (hp-10: Saddle's creatures to tap, as Forge asks it live: "saddle it", not "crew it")
    {
      const SAD = "Saddle 1 (Tap any number of other creatures you control with total power 1 or more: This Mount becomes saddled until end of turn. Saddle only as a sorcery.)";
      const sad = cards("The Gitrog, Ravenous Ride", SAD, "The Gitrog, Ravenous Ride", 0);
      add(promptCase("hp-10: Saddle's creatures to tap", myMain(D2.board), { ...sad, input: { ...sad.input, max: 2,
        presentation: { title: "The Gitrog, Ravenous Ride", description: "Select creatures to tap (total power 1 or greater)", targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-10: The Gitrog's "up to X land cards from your hand", as Forge asks it live)
    {
      const GIT = "Whenever The Gitrog, Ravenous Ride deals combat damage to a player, you may sacrifice a creature that saddled it this turn. If you do, draw X cards, then put up to X land cards from your hand onto the battlefield tapped, where X is the sacrificed creature's power.";
      const git = cards("The Gitrog, Ravenous Ride", GIT, "The Gitrog, Ravenous Ride", 0);
      add(promptCase("hp-10: The Gitrog's lands from the hand", myMain(D2.board), { ...git, input: { ...git.input, max: 2, cards: git.input.cards.map((c) => ({ ...c, zone: "hand" })),
        presentation: { title: "The Gitrog, Ravenous Ride", description: "Select up to 4 cards from your hand", targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-10: discover's exiled cards, as Forge shows them live ("Look at these cards", your library))
    add(promptCase("hp-10: discover's exiled cards", myMain(D2.board), { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75), H(35)] }),
      sourceCard: { id: "engine-card-22", identity: { name: "Chimil, the Inner Sun" }, text: "" },
      sourceAbilityText: "At the beginning of your end step, discover 5. (Exile cards from the top of your library until you exile a nonland card with mana value 5 or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)" }, [["ok"]]));
    // (hp-10: a megamorph turned face up is only "is turned face up"; a record that isn't a cast meeting the card's stack
    // item is an ability: a face-up trigger, an unearth)
    add({ name: "hp-10: log: megamorph face up, and a non-cast record on the stack", run: async (h) => {
      const out = [];
      for (const [kindLabel, withStack] of [["Gudul Lurker: Megamorph {U} (Turn this face up any time for its morph cost.)", false],
        ["Gudul Lurker: Megamorph {U} (Turn this face up any time for its morph cost.)", true], ["Gudul Lurker: Unearth {R} ({R}: Return this card from your graveyard to the battlefield.)", true]]) {
        const start = myMain(D2.board);
        const seat = game(h, start);
        const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const bfz = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
        bfz(start).cards.push({ id: "engine-card-985", identity: { name: "Gudul Lurker" }, isFaceDown: true, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
        await feed(start);
        const mark = lines().length;
        (h.B._getGame().pendingPlays ??= []).push({ id: "engine-card-985", name: "Gudul Lurker", ctl: "player-0", kind: /Megamorph/.test(kindLabel) ? "faceup" : "unearth", at: Date.now(), promptId: -2 });
        const up = clone(start); bfz(up).cards.find((c) => c.id === "engine-card-985").isFaceDown = false;
        if (withStack) up.gameView.stack = [{ id: "stack-gl", sourceId: "engine-card-985", controllerId: "player-0", identity: { name: "Gudul Lurker" }, sourceAbilityText: "When this creature is turned face up, draw a card.", text: "x" }];
        await feed(up);
        out.push(lines().slice(mark));
      }
      return out;
    } });
    // (hp-15: cascade's exiled cards, as Forge shows them live: "Cascade - <card>" as the ability text)
    add(promptCase("hp-15: cascade's exiled cards", myMain(D2.board), { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75), H(35)] }),
      sourceCard: { id: "engine-card-22", identity: { name: "Throes of Chaos" }, text: "" }, sourceAbilityText: "Cascade - Throes of Chaos" }, [["ok"]]));
    // (hp-15: cascade's hit, asked as Forge does live with no ability text, reads as a free cast; with no cascade before
    // it, the plain question)
    add({ name: "hp-15: cascade's hit is a free cast", run: async (h) => {
      const out = [];
      for (const cascaded of [true, false]) {
        const seat = game(h, myMain(D2.board));
        if (cascaded) {
          const look = { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75), H(35)] }),
            sourceCard: { id: "engine-card-22", identity: { name: "Throes of Chaos" }, text: "" }, sourceAbilityText: "Cascade - Throes of Chaos" };
          h.B.onPrompt(seat, look); await h.flush();
          h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: look.promptId, choice: ["ok"] }) }); await h.flush();
        }
        h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { title: "Do you want to play Marionette Apprentice?", targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }), promptId: 950 }); await h.flush();
        out.push([seat.prompt?.ui?.title, seat.prompt?.ui?.options?.map((o) => o.label)]);
      }
      return out;
    } });
    // (hp-23 gap: Ripple, as Forge asks it live: its reveal question, the reveal, the free cast of a namesake)
    {
      const RP = "Ripple 4 - Surging Dementia";
      const SD = { id: "engine-card-17", identity: { name: "Surging Dementia" }, text: "Ripple 4 (When you cast this spell, you may reveal the top four cards of your library. You may cast spells with the same name as this spell from among those cards without paying their mana costs. Put the rest on the bottom of your library.)\nTarget player discards a card." };
      add(promptCase("hp-23 gap: ripple's question", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { description: RP, targets: [], title: "Use triggered ability of Surging Dementia?" } }), sourceAbilityText: RP, sourceCard: SD }, [["yes"]]));
      add(promptCase("hp-23 gap: ripple's reveal", myMain(D2.board), { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75), H(35)] }), sourceAbilityText: RP, sourceCard: SD }, [["ok"]]));
      add({ name: "hp-23 gap: ripple's cast of a namesake", run: async (h) => {
        const start = myMain(D2.board);
        const seat = game(h, start);
        await boardAs(h, seat, start);
        const look = { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75), H(35)] }), sourceAbilityText: RP, sourceCard: SD };
        h.B.onPrompt(seat, look); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: look.promptId, choice: ["ok"] }) }); await h.flush();
        const ask = { ...prompt("chooseBoolean", { presentation: { title: "Do you want to play Surging Dementia?", targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }), promptId: 950, sourceCard: { ...SD, id: "engine-card-18" } };
        h.B.onPrompt(seat, ask); await h.flush();
        const asked = [seat.prompt?.ui?.title, seat.prompt?.ui?.options?.map((o) => o.label)];
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 950, choice: ["yes"] }) }); await h.flush();
        const mark = logLines(h).length;
        const b = clone(start);
        b.gameView.stack = [{ id: "engine-stack-97", sourceId: "engine-card-17", controllerId: "player-0", identity: { name: "Surging Dementia" }, sourceAbilityText: SD.text }];
        await boardAs(h, seat, b);
        const c = clone(b);
        c.gameView.stack = [{ id: "engine-stack-98", sourceId: "engine-card-18", controllerId: "player-0", identity: { name: "Surging Dementia" }, sourceAbilityText: SD.text }, ...b.gameView.stack];
        await boardAs(h, seat, c);
        return { asked, lines: logLines(h).slice(mark) };
      } });
      // (the rest go to the bottom, not "put on top"; a card that says nothing of the rest still asks the top)
      for (const [how, text] of [["ripple", SD.text], ["a top put-back", "Look at the top two cards of your library, then put them back in any order."]]) {
        add(promptCase(`hp-23 gap: the rest of a look (${how})`, myMain(D2.board), { ...prompt("reorder", { items: [{ id: "r1", card: H(43) }, { id: "r2", card: H(77) }], presentation: { description: "Arrange these cards in order.", targets: [], title: "Surging Dementia" } }), sourceCard: { ...SD, text } }, [["__keep"]]));
      }
    }
    // (hp-24 gap: Aura swap's Aura, as Forge asks it live; "Choose a card" under another ability keeps its own words)
    for (const [how, text] of [["aura swap", "Aura swap {2}{U} ({2}{U}: You may exchange this Aura with an Aura card in your hand.)"], ["another ability", "{2}{U}: Discard a card."]]) {
      add(promptCase(`hp-24 gap: choose a card (${how})`, myMain(D2.board), { ...prompt("chooseCards", { cancellable: false, min: 0, max: 1, cards: [{ ...H(75), zone: "hand" }], presentation: { description: "Choose a card", targets: [], title: "Arcanum Wings" } }),
        sourceAbilityText: text, sourceCard: { id: "engine-card-958", identity: { name: "Arcanum Wings" }, text: "x" } }, [[H(75).id]]));
    }
    // (re-test 2026-10-30: "any target", as Forge asks Lightning Bolt live; a storm copy's new target with your own older
    // spell under it: named by the newest; a copy not yet on the stack, offered by its card id, by its original's name)
    add(promptCase("re-test: any target", myMain(D2.board), { ...prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "player-1", kind: "player" }], chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "Choose a target" } }),
      sourceAbilityText: "Lightning Bolt deals 3 damage to any target.", sourceCard: { id: "engine-card-957", identity: { name: "Lightning Bolt" }, text: "Lightning Bolt deals 3 damage to any target." } }, [["player|player-1"]]));
    {
      const b = myMain(D2.board);
      b.gameView.stack = [{ id: "engine-stack-3", sourceId: "engine-card-958", controllerId: "player-0", identity: { name: "Lightning Bolt" } }, { id: "engine-stack-4", sourceId: "engine-card-959", controllerId: "player-0", identity: { name: "Flusterstorm" } }];
      add(promptCase("re-test: a storm copy over your own spell", b, prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "engine-card-999144", kind: "card" }, { id: "engine-stack-3", kind: "spell" }], chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "Counter" } }), [["spell|engine-stack-3"]]));
    }
    {
      // (re-test 2 2026-11-05: Flare of Duplication resolving, its copy of Bolt asking for a new target, named by the Bolt)
      const b = myMain(D2.board);
      b.gameView.stack = [{ id: "engine-stack-5", sourceId: "engine-card-958", controllerId: "player-0", identity: { name: "Lightning Bolt" } },
        { id: "engine-stack-6", sourceId: "engine-card-961", controllerId: "player-0", identity: { name: "Flare of Duplication" }, targets: [{ kind: "spell", id: "engine-stack-5" }] }];
      add(promptCase("re-test 2: a copy made by a resolving spell is named by the spell it copies", b, prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "player-1", kind: "player" }, { id: "player-0", kind: "player" }], chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "choose a player to damage" } }), [["player|player-1"]]));
      // (and as the real engine sent it: Flare with no targets, only its text, real table 2026-11-05)
      const r = myMain(D2.board);
      r.gameView.stack = [{ id: "engine-stack-2", sourceId: "engine-card-958", controllerId: "player-0", identity: { name: "Lightning Bolt" }, text: "Lightning Bolt deals 3 damage to AI 1." },
        { id: "engine-stack-3", sourceId: "engine-card-961", controllerId: "player-0", identity: { name: "Flare of Duplication" }, targets: [], text: "Copy Lightning Bolt (958)." }];
      add(promptCase("real table: a copy is named by the spell its maker's text copies", r, prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "player-1", kind: "player" }, { id: "player-0", kind: "player" }], chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "choose a player to damage" } }), [["player|player-1"]]));
    }
    // (hp-23 gap: Demonstrate's copy and Paradigm's, as Forge asks them live)
    add(promptCase("hp-23 gap: demonstrate's copy", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { targets: [], title: "Do you want to copy the spell Incarnation Technique?" } }),
      sourceAbilityText: "Demonstrate (When you cast this spell, you may copy it. If you do, choose an opponent to also copy it. Players may choose new targets for their copies.)", sourceCard: { id: "engine-card-966", identity: { name: "Incarnation Technique" }, text: "x" } }, [["yes"]]));
    add(promptCase("hp-23 gap: paradigm's copy", myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { description: "Paradigm (x)", targets: [], title: "Use triggered ability of Improvisation Capstone' Paradigm?" } }),
      sourceAbilityText: "Paradigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.)", sourceCard: { id: "engine-card-147", identity: { name: "Improvisation Capstone' Paradigm" }, text: "" } }, [["yes"]]));
    // (hp-23 gap: epic's copy asks with no card; its effect on the stack names it; with no such effect, no name)
    for (const withEffect of [true, false]) {
      const b = myMain(D2.board);
      if (withEffect) b.gameView.stack = [{ id: "engine-stack-86", sourceId: "engine-card-150", controllerId: "player-0", identity: { name: "Eternal Dominion (5)'s Effect" }, sourceAbilityText: "At the beginning of your upkeep, copy this spell except for its epic ability." }];
      add(promptCase(`hp-23 gap: epic's copy target (${withEffect ? "its effect on the stack" : "nothing on the stack"})`, b, prompt("chooseBoardTargets", { cancellable: false, candidates: [{ id: "player-1", kind: "player" }], chosenTargets: 0, maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "Choose player to fetch" } }), [["player|player-1"]]));
    }
    // (hp-23 gap: an opponent's searched card shown from their hand as its ability reveals it; a look that doesn't reveal stays private)
    for (const [how, text] of [["revealed", "Search your library for a land card, reveal it, put it into your hand, then shuffle."], ["a look", "Look at target player's hand."]]) {
      add({ name: `hp-23 gap: an opponent's card shown from their hand (${how})`, run: async (h) => {
        const seat = game(h, myMain(D2.board));
        const mark = logLines(h).length;
        h.B.onPrompt(seat, { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-1", zone: "hand", cards: [H(75)] }), sourceAbilityText: text, sourceCard: { id: "engine-card-151", identity: { name: "Sylvan Scrying" }, text } }); await h.flush();
        return logLines(h).slice(mark);
      } });
    }
    // (hp-23 gap: Paradigm's yes makes the cast question next the free copy)
    add({ name: "hp-23 gap: paradigm's cast question", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const ask = { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { description: "Paradigm (x)", targets: [], title: "Use triggered ability of Improvisation Capstone' Paradigm?" } }),
        sourceAbilityText: "Paradigm (Then exile this spell.)", sourceCard: { id: "engine-card-147", identity: { name: "Improvisation Capstone' Paradigm" }, text: "" } };
      h.B.onPrompt(seat, ask); await h.flush();
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: ask.promptId, choice: ["yes"] }) }); await h.flush();
      h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { title: "Do you want to play Improvisation Capstone?", targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }), promptId: 951 }); await h.flush();
      return [seat.prompt?.ui?.title, seat.prompt?.ui?.options?.map((o) => o.label)];
    } });
    // (hp-23 gap: a same-named spell by another player: a copy with their hand level, a cast with it down)
    for (const handDown of [false, true]) {
      add({ name: `hp-23 gap: log: another player's spell of one name (${handDown ? "from their hand" : "no card from their hand"})`, run: async (h) => {
        const start = myMain(D2.board);
        const mine = { id: "s1", sourceId: "card-s1", controllerId: "player-0", identity: { name: "Lightning Bolt" } };
        start.gameView.stack = [mine];
        const seat = game(h, start);
        await boardAs(h, seat, start);
        const mark = logLines(h).length;
        const b = clone(start);
        b.gameView.stack = [{ id: "s2", sourceId: "card-s2", controllerId: "player-1", identity: { name: "Lightning Bolt" } }, mine];
        if (handDown) { const hand = b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-1"); hand.count = (hand.count ?? (hand.cards || []).length) - 1; }
        await boardAs(h, seat, b);
        return logLines(h).slice(mark);
      } });
    }
    // (hp-23 gap: a tutor that puts its card on top, then a draw: a draw; one that puts it into the hand: put there)
    for (const [how, text] of [["on top", "Search your library for a card, then shuffle and put that card on top. You lose 2 life."], ["into the hand", "Search your library for a card, put that card into your hand, then shuffle."]]) {
      add({ name: `hp-23 gap: log: the card after a tutor (${how})`, run: async (h) => {
        const start = myMain(D2.board);
        const seat = game(h, start);
        await boardAs(h, seat, start);
        const look = { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75), H(35)] }), sourceAbilityText: text, sourceCard: { id: "engine-card-152", identity: { name: "A Tutor" }, text } };
        h.B.onPrompt(seat, look); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: look.promptId, choice: ["ok"] }) }); await h.flush();
        const mark = logLines(h).length;
        const b = clone(start);
        const lib = b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0"); lib.count = (lib.count ?? (lib.cards || []).length) - 1;
        const hand = b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0"); hand.count = (hand.count ?? (hand.cards || []).length) + 1;
        await boardAs(h, seat, b);
        return logLines(h).slice(mark);
      } });
    }
    // (hp-23 gap: exile-until cards are named once, by the reveal; a card it didn't show still gets the board's line)
    add({ name: "hp-23 gap: log: exile-until cards named once", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const shown = H(75);
      h.B.onPrompt(seat, { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [shown] }),
        sourceCard: { id: "engine-card-22", identity: { name: "Throes of Chaos" }, text: "" }, sourceAbilityText: "Cascade - Throes of Chaos" }); await h.flush();
      const b = clone(start);
      const lib = b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === "player-0"); lib.count = (lib.count ?? (lib.cards || []).length) - 2;
      b.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-0").cards.push({ ...shown, zone: "exile" },
        { id: "engine-card-955", identity: { name: "Island" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" });
      await boardAs(h, seat, b);
      return logLines(h).slice(mark);
    } });
    // (hp-23 gap: the log of a stack: an AI's demonstrate copy made under White's control, then changing hands; epic's and
    // paradigm's effects and the copies they make; Epic's and Paradigm's own lines; a target's discards while the spell
    // resolves; another player's land put onto the battlefield)
    add({ name: "hp-23 gap: log: copies and effects", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      await boardAs(h, seat, start);
      const mark = logLines(h).length;
      const spell = (id, ctl, name, extra = {}) => ({ id, sourceId: `card-${id}`, controllerId: ctl, identity: { name }, ...extra });
      const it = "Mill five cards.";
      const stepped = [];
      const put = async (stack, edit) => { const b = clone(start); b.gameView.stack = stack; edit?.(b); await boardAs(h, seat, b); stepped.push(logLines(h).slice(mark).length); };
      const orig = spell("s1", "player-0", "Incarnation Technique"), c1 = spell("s2", "player-0", "Incarnation Technique"), c2 = spell("s3", "player-0", "Incarnation Technique");
      await put([orig]); await put([orig, c1]); await put([orig, c1, c2]);
      await put([orig, c1, spell("s4", "player-1", "Incarnation Technique")]);
      await put([]);
      const ed = { id: "e1", sourceId: "card-e1", controllerId: "player-0", identity: { name: "Eternal Dominion (5)'s Effect" }, sourceAbilityText: "At the beginning of your upkeep, copy this spell except for its epic ability." };
      await put([ed]);
      await put([spell("e2", "player-0", "Eternal Dominion"), ed]);
      await put([]);
      const pd = { id: "p1", sourceId: "card-p1", controllerId: "player-0", identity: { name: "Improvisation Capstone' Paradigm" }, sourceAbilityText: "Paradigm (Then exile this spell. After ...)" };
      await put([pd]);
      await put([spell("p2", "player-0", "Improvisation Capstone"), pd]);
      await put([]);
      const lib = (b, o) => b.gameView.zones.find((z) => z.zone === "library" && z.ownerId === o);
      const zone = (b, zn, o) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === o);
      const dementia = { id: "d1", sourceId: "card-d1", controllerId: "player-0", identity: { name: "Surging Dementia" }, sourceAbilityText: "Target player discards a card.", targets: [{ kind: "player", id: "player-1" }] };
      const dominion = { id: "d2", sourceId: "engine-card-952", controllerId: "player-0", identity: { name: "Eternal Dominion" }, sourceAbilityText: "Search target opponent's library.", targets: [{ kind: "player", id: "player-1" }] };
      await put([dementia, dominion]);
      await put([dementia, dominion], (b) => {
        const hand = zone(b, "hand", "player-1"); hand.count = (hand.count ?? (hand.cards || []).length) - 1;
        zone(b, "graveyard", "player-1").cards.push({ id: "engine-card-951", identity: { name: "Explosive Vegetation" }, types: ["Sorcery"], ownerId: "player-1", controllerId: "player-1", text: "" });
      });
      await put([], (b) => {
        const hand = zone(b, "hand", "player-1"); hand.count = (hand.count ?? (hand.cards || []).length) - 1;
        zone(b, "graveyard", "player-1").cards.push({ id: "engine-card-951", identity: { name: "Explosive Vegetation" }, types: ["Sorcery"], ownerId: "player-1", controllerId: "player-1", text: "" });
        zone(b, "graveyard", "player-0").cards.push({ id: "engine-card-952", identity: { name: "Eternal Dominion" }, types: ["Sorcery"], ownerId: "player-0", controllerId: "player-0", text: "Search target opponent's library.\nEpic (For the rest of the game, you can't cast spells.)" });
        zone(b, "exile", "player-0").cards.push({ id: "engine-card-953", identity: { name: "Improvisation Capstone" }, types: ["Sorcery"], ownerId: "player-0", controllerId: "player-0", text: "Exile cards.\nParadigm (Then exile this spell.)" });
        zone(b, "battlefield", "player-0").cards.push({ id: "engine-card-954", identity: { name: "Gaea's Cradle" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" });
        zone(b, "battlefield", "player-0").cards.push({ id: "engine-card-955", identity: { name: "Island" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", tapped: true, text: "" });
      });
      return logLines(h).slice(mark);
    } });
    // (hp-21: Forge's "Choose a Protection" over colours)
    add(promptCase("hp-21: protection's colour", myMain(D2.board), { ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: ["white", "blue", "black"].map((l) => ({ label: l, canRepeat: false, weight: 1 })), presentation: { title: "Choose a Protection", targets: [] } }),
      sourceCard: { id: "engine-card-954", identity: { name: "Bathe in Light" }, text: "x" } }, [["1"]]));
    // (hp-26: Abundance's land or nonland, asked under the drawing card's name, as Forge sends it live)
    for (const labels of [["Land", "Nonland"], ["Land", "Creature"]]) {
      add(promptCase(`hp-26: Abundance's kind (${labels[1]})`, myMain(D2.board), { ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: labels.map((l) => ({ label: l, canRepeat: false, weight: 1 })), presentation: { title: "Abundance", targets: [] } }),
        sourceCard: { id: "engine-card-955", identity: { name: "Kenrith, the Returned King" }, text: "x" }, sourceAbilityText: "{3}{U}: Target player draws a card." }, [["1"]]));
    }
    // (hp-26: Sylvan Library's trigger, then Forge's own "Draw two Cards": answered by the Yes before it; after a No, or
    // from another card, asked)
    add({ name: "hp-26: Sylvan Library's draw asked once", run: async (h) => {
      const out = [];
      const SL = "At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.";
      for (const [first, otherId] of [["yes", null], ["no", null], ["yes", "engine-card-958"]]) {
        const seat = game(h, myMain(D2.board));
        const use = { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Use triggered ability of Sylvan Library?", targets: [] } }),
          sourceCard: { id: "engine-card-957", identity: { name: "Sylvan Library" }, text: SL }, sourceAbilityText: SL, promptId: 952 };
        h.B.onPrompt(seat, use); await h.flush();
        const asked = seat.prompt?.ui?.title;
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 952, choice: [first] }) }); await h.flush();
        const again = { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Draw two Cards", targets: [] } }),
          sourceCard: { id: otherId || "engine-card-957", identity: { name: "Sylvan Library" }, text: SL }, sourceAbilityText: SL, promptId: 953 };
        h.B.onPrompt(seat, again); await h.flush();
        out.push([first, otherId, asked, seat.prompt?.promptId === 953 ? seat.prompt.ui.title : "answered"]);
      }
      return out;
    } });
    // (hp-26 mutation pass: a tutor's top card marks no search, a Demonic Tutor's does; the line is kept for a table
    // reload; Abundance's mark is used once; Sylvan Library's next question that shares only some words is asked)
    add({ name: "hp-26: tutors, Abundance and may-yes edges", run: async (h) => {
      const out = {};
      for (const [name, text] of [["Worldly Tutor", "Search your library for a creature card, reveal it, then shuffle and put the card on top."],
        ["Demonic Tutor", "Search your library for a card, put that card into your hand, then shuffle."]]) {
        const seat = game(h, myMain(D2.board), { game: { log: ["--- Blue's turn 2 ---"] } });
        // (the ability text says it; the card's text stands in only without one)
        const p = { ...prompt("chooseCards", { min: 0, max: 1, cards: [{ ...H(75), zone: "library" }], presentation: { title: "Choose a card" } }),
          sourceCard: { id: "engine-card-956", identity: { name }, text: "x" }, sourceAbilityText: text, promptId: 954 };
        h.B.onPrompt(seat, p); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 954, choice: ["engine-card-75"] }) }); await h.flush();
        out[name] = [seat.lately?.search ? "search" : null, [...(h.B._getGame().log || [])]];
      }
      {
        const seat = game(h, myMain(D2.board));
        const K = { sourceCard: { id: "engine-card-955", identity: { name: "Kenrith, the Returned King" }, text: "x" }, sourceAbilityText: "{3}{U}: Target player draws a card." };
        const ask = { ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: ["Land", "Nonland"].map((l) => ({ label: l, canRepeat: false, weight: 1 })), presentation: { title: "Abundance", targets: [] } }), ...K, promptId: 955 };
        h.B.onPrompt(seat, ask); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 955, choice: ["1"] }) }); await h.flush();
        const look = (id) => ({ ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(id)] }), ...K, promptId: id === 75 ? 958 : 959 });
        // (another card's look in between: its own, private)
        h.B.onPrompt(seat, { ...look(43), sourceCard: { id: "engine-card-951", identity: { name: "Sensei's Divining Top" }, text: "x" }, sourceAbilityText: "{1}: Look at the top three cards of your library, then put them back in any order.", promptId: 960 }); await h.flush();
        const other = seat.prompt?.ui?.title;
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 960, choice: ["ok"] }) }); await h.flush();
        h.B.onPrompt(seat, look(75)); await h.flush();
        const first = seat.prompt?.ui?.title;
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: seat.prompt?.promptId, choice: ["ok"] }) }); await h.flush();
        h.B.onPrompt(seat, look(35)); await h.flush();
        out.abundance = [other, first, seat.prompt?.ui?.title];
      }
      {
        const seat = game(h, myMain(D2.board));
        const SL = "At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.";
        const src = { sourceCard: { id: "engine-card-957", identity: { name: "Sylvan Library" }, text: SL }, sourceAbilityText: SL };
        h.B.onPrompt(seat, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Use triggered ability of Sylvan Library?", targets: [] } }), ...src, promptId: 956 }); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 956, choice: ["yes"] }) }); await h.flush();
        h.B.onPrompt(seat, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Discard two cards", targets: [] } }), ...src, promptId: 957 }); await h.flush();
        out.someWords = seat.prompt?.promptId === 957 ? seat.prompt.ui.title : "answered";
        // (a question with no words of its own is asked)
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 957, choice: ["no"] }) }); await h.flush();
        h.B.onPrompt(seat, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Do you want to?", targets: [] } }), ...src, promptId: 961 }); await h.flush();
        out.noWords = seat.prompt?.promptId === 961 ? seat.prompt.ui.title : "answered";
      }
      {
        // (a replacement's "Apply replacement effect of X?" with its text on the next lines, as Forge sends it: Yes, then
        // the card's own restating of its "may" is answered)
        const seat = game(h, myMain(D2.board));
        const AB = "If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in any order.";
        const src = { sourceCard: { id: "engine-card-959", identity: { name: "Abundance" }, text: AB }, sourceAbilityText: AB };
        h.B.onPrompt(seat, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: `Apply replacement effect of Abundance?\r\n${AB}`, targets: [] } }), ...src, promptId: 962 }); await h.flush();
        const asked = seat.prompt?.ui?.title;
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 962, choice: ["yes"] }) }); await h.flush();
        h.B.onPrompt(seat, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Choose land or nonland", targets: [] } }), ...src, promptId: 963 }); await h.flush();
        out.replacement = [asked, seat.prompt?.promptId === 963 ? seat.prompt.ui.title : "answered"];
      }
      return out;
    } });
    // (hp-26: a tutor that puts the card on top, by Forge's live card texts: revealed by name, or not, and a plain search)
    for (const [name, text] of [["Worldly Tutor", "Search your library for a creature card, reveal it, then shuffle and put the card on top."],
      ["Mystical Tutor", "Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top."],
      ["Vampiric Tutor", "Search your library for a card, then shuffle and put that card on top. You lose 2 life."],
      ["Demonic Tutor", "Search your library for a card, put that card into your hand, then shuffle."]]) {
      add(promptCase(`hp-26: ${name}'s pick`, myMain(D2.board), { ...prompt("chooseCards", { min: 0, max: 1, cards: [{ ...H(75), zone: "library" }, { ...H(35), zone: "library" }], presentation: { title: "Choose a card" } }),
        sourceCard: { id: "engine-card-956", identity: { name }, text }, sourceAbilityText: text }, [["engine-card-75"]]));
    }
    // (hp-26: Abundance's reveal next, as Forge sends it live under the drawing card: by the kind chosen, and a look with no
    // choice before it is the plain look)
    add({ name: "hp-26: Abundance's reveal", run: async (h) => {
      const out = [];
      for (const pick of ["0", "1", null]) {
        const seat = game(h, myMain(D2.board));
        if (pick) {
          const ask = { ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: ["Land", "Nonland"].map((l) => ({ label: l, canRepeat: false, weight: 1 })), presentation: { title: "Abundance", targets: [] } }),
            sourceCard: { id: "engine-card-955", identity: { name: "Kenrith, the Returned King" }, text: "x" }, sourceAbilityText: "{3}{U}: Target player draws a card." };
          h.B.onPrompt(seat, ask); await h.flush();
          h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: ask.promptId, choice: [pick] }) }); await h.flush();
        }
        h.B.onPrompt(seat, { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75)] }),
          sourceCard: { id: "engine-card-955", identity: { name: "Kenrith, the Returned King" }, text: "x" }, sourceAbilityText: "{3}{U}: Target player draws a card.", promptId: 951 }); await h.flush();
        out.push([seat.prompt?.ui?.title, seat.lately?.search ? "search" : null]);
      }
      return out;
    } });
    // (hp-21: Radiance's long target sentence, as Forge sends it live)
    add(promptCase("hp-21: Radiance's target", myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title: "Buff", targets: [] } }),
      sourceCard: { id: "engine-card-954", identity: { name: "Bathe in Light" }, text: "x" },
      sourceAbilityText: "Radiance — Choose a color. Target creature and each other creature that shares a color with it gain protection from the chosen color until end of turn." }, [["card|engine-card-64"]]));
    // (hp-21: Amplify's cards to reveal, as Forge asks it live)
    {
      const kd = cards("Kilnmouth Dragon", "x", "Choose cards", 0);
      for (const zone of ["hand", "library"]) {
        add(promptCase(`hp-21: Amplify's cards (${zone})`, myMain(D2.board), { ...kd, sourceAbilityText: undefined,
          sourceCard: { ...kd.sourceCard, text: "Amplify 3 (As this creature enters, put three +1/+1 counters on it for each Dragon card you reveal in your hand.)\nFlying" },
          input: { ...kd.input, cards: kd.input.cards.map((c) => ({ ...c, zone })), presentation: { title: "Choose cards", targets: [] } } }, [["engine-card-75"]]));
      }
    }
    // (hp-21: a modal spell's target by its chosen mode, as Forge sends it live (the mode after the list))
    add(promptCase("hp-21: a modal spell's chosen-mode target", myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title: "Buff", targets: [] } }),
      sourceCard: { id: "engine-card-955", identity: { name: "Collective Resistance" }, text: "x" },
      sourceAbilityText: "Choose one or more —\r\n• Destroy target artifact.\r\n• Destroy target enchantment.\r\n• Target creature gains hexproof and indestructible until end of turn.\r\n\r\n Target creature gains hexproof and indestructible until end of turn." }, [["card|engine-card-64"]]));
    // (hp-21 gap: all three modes chosen (escalate), listed after the modes: each target by the mode its candidates fit)
    {
      const b = myMain(D2.board);
      b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-165", identity: { name: "Food Token", isToken: true }, types: ["Artifact"], ownerId: "player-0", controllerId: "player-0", text: "" },
        { id: "engine-card-16", identity: { name: "Rancor" }, types: ["Enchantment"], ownerId: "player-0", controllerId: "player-0", text: "" });
      const CR = "Choose one or more —\r\n• Destroy target artifact.\r\n• Destroy target enchantment.\r\n• Target creature gains hexproof and indestructible until end of turn.\r\n\r\nDestroy target artifact.\r\nDestroy target enchantment.\r\nTarget creature gains hexproof and indestructible until end of turn.";
      for (const [what, id] of [["artifact", "engine-card-165"], ["enchantment", "engine-card-16"]]) {
        add(promptCase(`hp-21 gap: escalate's ${what} target`, b, { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id }], presentation: { title: "Destroy", targets: [] } }),
          sourceCard: { id: "engine-card-955", identity: { name: "Collective Resistance" }, text: "x" }, sourceAbilityText: CR }, [[`card|${id}`]]));
      }
    }
    // (hp-26: Scroll Rack's cards from the hand, as Forge asks it live)
    {
      const sr = cards("Scroll Rack", "{1}, {T}: Exile any number of cards from your hand face down. Put that many cards from the top of your library into your hand. Then look at the exiled cards and put them on top of your library in any order.", "Scroll Rack", 0);
      add(promptCase("hp-26: Scroll Rack's cards", myMain(D2.board), { ...sr, input: { ...sr.input, max: 2, cards: sr.input.cards.map((c) => ({ ...c, zone: "hand" })), presentation: { title: "Scroll Rack", description: "Select cards from your hand", targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-24: Fateseal's pick, as Forge asks it live (the AI's engine name in Forge's description))
    {
      const fs1 = cards("Mesmeric Sliver", "When Mesmeric Sliver enters, you may fateseal 1.", "Mesmeric Sliver", 0);
      add(promptCase("hp-24: Fateseal's pick", myMain(D2.board), { ...fs1, input: { ...fs1.input, cards: fs1.input.cards.map((c) => ({ ...c, zone: "library", ownerId: "player-1" })),
        presentation: { title: "Mesmeric Sliver", description: "Choose card(s) to put on the bottom of self-hosted-node-77-bot library", targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-23: Sweep's lands to return, as Forge asks it live)
    {
      const bd = cards("Barrel Down Sokenzan", "Sweep — Return any number of Mountains you control to their owner's hand. Barrel Down Sokenzan deals damage to target creature equal to twice the number of Mountains returned this way.", "Barrel Down Sokenzan", 0);
      add(promptCase("hp-23: Sweep's lands", myMain(D2.board), { ...bd, input: { ...bd.input, max: 2, presentation: { title: "Barrel Down Sokenzan", description: "Select cards from your battlefield", targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-23: Join forces' mana, as Forge asks it live)
    add(promptCase("hp-23: Join forces' mana", myMain(D2.board), { ...prompt("chooseNumber", { min: 0, max: 99, presentation: { title: "Choose a value for amount of mana to pay", targets: [] } }),
      sourceCard: { id: "engine-card-953", identity: { name: "Minds Aglow" }, text: "x" },
      sourceAbilityText: "Join forces — Starting with you, each player may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way." }, [["3"]]));
    // (hp-20: Read ahead's chapter, as Forge asks it live; another "How many counters?" stays)
    for (const [label, text, title] of [["read ahead", "Read ahead (Choose a chapter and start with that many lore counters. Add one after your draw step. Skipped chapters don't trigger. Sacrifice after III.)\nI — Target opponent reveals their hand.", "How many counters?"],
      ["other", "Flying", "How many counters?"], ["read ahead, another number", "Read ahead (Choose a chapter and start with that many lore counters.)", "Choose a number"]]) {
      add(promptCase(`hp-20: How many counters (${label})`, myMain(D2.board), { ...prompt("chooseNumber", { min: 1, max: 3, presentation: { title, targets: [] } }),
        sourceCard: { id: "engine-card-956", identity: { name: "The Cruelty of Gix" }, text } }, [["2"]]));
    }
    // (hp-19: Harmonize's power to tap, as Forge asks it live)
    add(promptCase("hp-19: Harmonize's power to tap", myMain(D2.board), { ...prompt("chooseNumber", { min: 0, max: 6, presentation: { title: "Choose power of creature to tap", targets: [] } }),
      sourceCard: { id: "engine-card-957", identity: { name: "Nature's Rhythm" }, text: "x" }, sourceAbilityText: "Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle." }, [["2"]]));
    // (hp-19: a 0-to-1 number asked as a question is a yes/no; a 0-to-1 number without a question stays a number)
    for (const [t, max] of [["Tap creature?", 1], ["Choose a number", 1], ["How many?", 3]]) {
      add(promptCase(`hp-19: a 0-${max} number (${t})`, myMain(D2.board), { ...prompt("chooseNumber", { min: 0, max, presentation: { title: t, targets: [] } }),
        sourceCard: { id: "engine-card-957", identity: { name: "Nature's Rhythm" }, text: "x" } }, [["1"]]));
    }
    // (hp-18: the order of a played land's own enter effects, as Forge asks it live, is not asked; a real choice of one
    // with a non-enter option still is)
    for (const [label, opts] of [["enter effects", ["Llanowar Reborn enters tapped.", "Graft 1 (This permanent enters with a +1/+1 counter on it. Whenever another creature enters, you may move a +1/+1 counter from this permanent onto it.)"]],
      ["a real choice", ["Llanowar Reborn enters tapped.", "Draw a card."]]]) {
      add(promptCase(`hp-18: enter effects' order (${label})`, myMain(D2.board), { ...prompt("chooseFromSelection", { minTotal: 1, maxTotal: 1, options: opts.map((l) => ({ label: l, canRepeat: false, weight: 1 })), presentation: { title: "Choose", targets: [] } }),
        sourceCard: { id: "engine-card-960", identity: { name: "Llanowar Reborn" }, text: "x" }, sourceAbilityText: "Play land" }, [["0"]]));
    }
    // (hp-18: Riot's choice, as Forge asks it live (no ability text); a card without Riot stays a payment)
    for (const [label, text] of [["riot", "Riot (This creature enters with your choice of a +1/+1 counter or haste.)\nWeb-slinging {1}{R}"], ["no riot", "Flying"]]) {
      add(promptCase(`hp-18: Riot's choice (${label})`, myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Pay", denyLabel: "Decline",
        presentation: { title: "Pay Put a +1/+1 counter on CARDNAME?", text: "otherwise: \"Spider-Punk (7)  gains haste .\"", targets: [] } }),
        sourceCard: { id: "engine-card-961", identity: { name: "Spider-Punk" }, text } }, [["yes"]]));
    }
    // (hp-15: Fabricate's choice, as Forge asks it live; another "Pay Put ..." stays a payment)
    for (const [label, ab] of [["fabricate", "Fabricate 1 (When this creature enters, put a +1/+1 counter on it, or create a 1/1 colorless Servo artifact creature token.)"], ["a payment", "When this creature enters, you may put a +1/+1 counter on it unless ..."]]) {
      add(promptCase(`hp-15: Fabricate's choice (${label})`, myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Pay", denyLabel: "Decline",
        presentation: { title: "Pay Put a +1/+1 counter on CARDNAME?", text: "otherwise: \"tts-Blue-ab12 creates one 1/1 colorless Servo artifact creature token.\"", targets: [] } }),
        sourceCard: { id: "engine-card-970", identity: { name: "Marionette Apprentice" }, text: "x" }, sourceAbilityText: ab }, [["yes"]]));
    }
    // (hp-15: a cascade trigger beside its spell, as the table's stack had it live: one cast, one ability)
    add({ name: "hp-15: log: a cascade trigger is no second cast", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      await feed(start);
      const mark = lines().length;
      const both = clone(start);
      both.gameView.stack = [{ id: "engine-stack-25", sourceId: "engine-card-969", controllerId: "player-0", identity: { name: "Throes of Chaos" } },
        { id: "engine-stack-26", sourceId: "engine-card-969", controllerId: "player-0", identity: { name: "Throes of Chaos" }, sourceAbilityText: "Cascade - Throes of Chaos", text: "Cascade - Throes of Chaos" }];
      await feed(both);
      return lines().slice(mark);
    } });
    // (hp-15: Extort's yes/no, as Forge asks it live)
    {
      const EXT = "Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)";
      add(promptCase("hp-15: Extort's question", myMain(D2.board), { ...prompt("chooseBoolean", { presentation: { title: "Use triggered ability of Blind Obedience?", description: EXT, targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }),
        sourceCard: { id: "engine-card-968", identity: { name: "Blind Obedience" }, text: "x" }, sourceAbilityText: EXT }, [["yes"]]));
    }
    // (hp-15: Pay on your own Extort is your payment: it comes from the pool by itself; an opponent's card's still asks)
    for (const ctl of ["player-0", "player-1"]) {
      add({ name: `hp-15: Extort's Pay, then the payment (${ctl === "player-0" ? "yours" : "an opponent's"})`, run: async (h) => {
        const EXT = "Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)";
        const seat = game(h, myMain(D2.board));
        const ask = { ...prompt("chooseBoolean", { presentation: { title: "Use triggered ability of Blind Obedience?", description: EXT, targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }),
          sourceCard: { id: "engine-card-967", identity: { name: "Blind Obedience" }, controllerId: ctl, text: "x" }, sourceAbilityText: EXT };
        h.B.onPrompt(seat, ask); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: ask.promptId, choice: ["yes"] }) }); await h.flush();
        const pay = { ...payP, promptId: ask.promptId + 1, input: { ...payP.input, cardId: "engine-card-967", cardName: "Blind Obedience", manaCost: "{W/B}", canConfirmFromPool: true } };
        h.B.onPrompt(seat, pay); await h.flush();
        return { open: seat.prompt ? seat.prompt.ui?.title : null };
      } });
    }
    // (hp-15: Assist's helper, as Forge asks it live (the bot's engine name as the option))
    add(promptCase("hp-15: Assist's helper", myMain(D2.board), { ...prompt("chooseFromSelection", { minTotal: 0, maxTotal: 1, options: [{ label: "self-hosted-node-77-bot", canRepeat: false, weight: 1 }], presentation: { title: "Game Plan", targets: [] } }),
      sourceCard: { id: "engine-card-966", identity: { name: "Game Plan" }, text: "Assist (Another player can pay up to {5} of this spell's cost.)\nEach player shuffles their hand and graveyard into their library, then draws seven cards. Exile Game Plan." },
      sourceAbilityText: "Each player shuffles their hand and graveyard into their library, then draws seven cards. Exile Game Plan." }, [["0"]]));
    // (an Assist card's other selection, an optional cost, is no helper question)
    add(promptCase("hp-15: an Assist card's optional cost", myMain(D2.board), { ...prompt("chooseFromSelection", { minTotal: 0, maxTotal: 1, options: [{ label: "Kicker – {2}", canRepeat: false, weight: 1 }], presentation: { title: "Game Plan", targets: [] } }),
      sourceCard: { id: "engine-card-966", identity: { name: "Game Plan" }, text: "Assist (Another player can pay up to {5} of this spell's cost.)\nKicker {2}\nDraw a card." } }, [["0"]]));
    // (hp-16: Hideaway's look answers itself (its pick shows the cards); a plain "look at the top" still shows)
    for (const [label, ab] of [["hideaway", "Hideaway 4 (When this permanent enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom of your library.)"],
      ["a plain look", "When this permanent enters, look at the top four cards of your library, then put them back in any order."]]) {
      add(promptCase(`hp-16: a library look (${label})`, myMain(D2.board), { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-0", zone: "library", cards: [H(75), H(35)] }),
        sourceCard: { id: "engine-card-965", identity: { name: "Mosswort Bridge" }, text: "" }, sourceAbilityText: ab }, [["ok"]]));
    }
    // (hp-16: Awaken's land, as Forge asks it live)
    {
      const AW = "Awaken 6—{6}{U}{U}{U} (If you cast this spell for {6}{U}{U}{U}, also put six +1/+1 counters on target land you control and it becomes a 0/0 Elemental creature with haste. It's still a land.)";
      add(promptCase("hp-16: Awaken's land", myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title: "Buff", targets: [] } }),
        sourceCard: { id: "engine-card-963", identity: { name: "Part the Waterveil" }, text: `Take an extra turn after this one. Exile Part the Waterveil.\n${AW}` }, sourceAbilityText: AW }, [["card|engine-card-64"]]));
    }
    // (suite review: a Devour or Exploit card's other yes/no stays plain; Devour 1 says one counter; a dredge question
    // with no card stays Forge's)
    for (const [label, text, title] of [
      ["devour, another question", "Devour 2 (As this enters, you may sacrifice any number of creatures. This creature enters with twice that many +1/+1 counters on it.)", "Use triggered ability of Mycoloth?"],
      ["devour 1", "Devour 1 (As this enters, you may sacrifice any number of creatures. This creature enters with that many +1/+1 counters on it.)", "Do you want to sacrifice?"],
      ["exploit, another question", "Exploit (When this creature enters, you may sacrifice a creature.)\nWhen Sidisi exploits a creature, draw a card.", "Use triggered ability of Mycoloth?"]]) {
      add(promptCase(`suite review: keyword yes/no (${label})`, myMain(D2.board), { ...prompt("chooseBoolean", { presentation: { title, targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }),
        sourceCard: { id: "engine-card-978", identity: { name: "Mycoloth" }, text } }, [["yes"]]));
    }
    add(promptCase("suite review: keyword yes/no (dredge, no card)", myMain(D2.board), { ...prompt("chooseBoolean", { presentation: { title: "Apply replacement effect of Life from the Loam?\r\nLife from the Loam - Dredge 3", targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }) }, [["yes"]]));
    // (hp-17: Dredge's replacement, as Forge asks it live)
    add(promptCase("hp-17: Dredge's question", myMain(D2.board), { ...prompt("chooseBoolean", { presentation: { title: "Apply replacement effect of Life from the Loam?\r\nLife from the Loam - Dredge 3", targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }),
      sourceCard: { id: "engine-card-962", identity: { name: "Life from the Loam" }, text: "x" } }, [["yes"]]));
    // (suite review: Awaken's title over a purpose read from its reminder)
    {
      const AW2 = "Awaken 2—{3}{G} (If you cast this spell for {3}{G}, also put two +1/+1 counters on target land you control.)";
      add(promptCase("hp-16: Awaken over a purpose from its reminder", myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title: "Buff", targets: [] } }),
        sourceCard: { id: "engine-card-963", identity: { name: "Coastal Discovery" }, text: `Draw two cards.\n${AW2}` }, sourceAbilityText: AW2 }, [["card|engine-card-64"]]));
    }
    // (hp-16: Cipher's creature, as Forge asks it live)
    {
      const wm = cards("Whispering Madness", "Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.", "Whispering Madness");
      add(promptCase("hp-16: Cipher's creature", myMain(D2.board), { ...wm, input: { ...wm.input, presentation: { title: "Whispering Madness", description: "Choose a creature you control to encode ", targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-17: a dredge: three milled and the dredged card back to the hand, one mill line)
    add({ name: "hp-17: log: a dredge", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
      const card = (n, name) => ({ id: `engine-card-94${n}`, identity: { name }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" });
      zone(start, "library").count = 20;
      zone(start, "graveyard").cards.push({ ...card(0, "Life from the Loam"), types: ["Sorcery"] });
      await feed(start);
      const mark = lines().length;
      const next = clone(start);
      zone(next, "library").count = 17;
      zone(next, "graveyard").cards.pop();
      zone(next, "graveyard").cards.push(card(1, "Forest"), card(2, "Forest"), card(3, "Plains"));
      const hz = zone(next, "hand"); hz.count = (hz.count ?? hz.cards.length) + 1;
      await feed(next);
      return lines().slice(mark);
    } });
    // (hp-16: a mill of more than six cards is said by count; six or fewer, by name)
    add({ name: "hp-16: log: a big mill by count", run: async (h) => {
      const out = [];
      for (const n of [7, 6]) {
        const start = myMain(D2.board);
        const seat = game(h, start);
        const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
        zone(start, "library").count = 40;
        await feed(start);
        const mark = lines().length;
        const milled = clone(start);
        zone(milled, "library").count = 40 - n;
        for (let i = 0; i < n; i++) zone(milled, "graveyard").cards.push({ id: `engine-card-95${i}`, identity: { name: i === 0 ? "Relentless Rats" : "Swamp" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" });
        await feed(milled);
        out.push(lines().slice(mark));
      }
      return out;
    } });
    // (hp-16: a casualty copy beside its spell: one cast, one copy; the copy added later: a copy)
    add({ name: "hp-16: log: a spell's copy", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      await feed(start);
      const mark = lines().length;
      const sp = (id) => ({ id, sourceId: "engine-card-964", controllerId: "player-0", identity: { name: "Cut Your Losses" } });
      const one = clone(start); one.gameView.stack = [sp("engine-stack-1")]; await feed(one);
      const two = clone(start); two.gameView.stack = [sp("engine-stack-2"), sp("engine-stack-1")]; await feed(two);
      await feed(start);
      const both = clone(start); both.gameView.stack = [sp("engine-stack-3"), sp("engine-stack-4")]; await feed(both);
      return lines().slice(mark);
    } });
    // (hp-10: a discover from another player's library keeps Forge's title)
    add(promptCase("hp-10: discover from another's library", myMain(D2.board), { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-1", zone: "library", cards: [H(75)] }),
      sourceCard: { id: "engine-card-22", identity: { name: "Chimil, the Inner Sun" }, text: "" },
      sourceAbilityText: "At the beginning of your end step, discover 5. (Exile cards from the top of your library until you exile a nonland card with mana value 5 or less.)" }, [["ok"]]));
    // (hp-11: behold's pick, as Forge asks it live: "Behold", the card's text only; and behold without exile)
    for (const [label, text] of [["exiled", "As an additional cost to cast this spell, behold an Elf and exile it. (Exile an Elf you control or an Elf card from your hand.)\nWhenever you cast a creature spell, draw a card."],
      ["shown", "As an additional cost to cast this spell, behold a Dragon. (Choose a Dragon you control or reveal a Dragon card from your hand.)"]]) {
      const be = cards("Champions of the Perfect", "x", "Champions of the Perfect");
      add(promptCase(`hp-11: behold's pick (${label})`, myMain(D2.board), { ...be, sourceAbilityText: undefined, sourceCard: { ...be.sourceCard, text },
        input: { ...be.input, presentation: { title: "Champions of the Perfect", description: "Behold", targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-11: Sneak's cost bounces an attacker while the spell from the hand is on the stack: the hand is level, the
    // creature returns to it; a token gone the same way only leaves)
    add({ name: "hp-11: log: a bounce paid while a spell is cast", run: async (h) => {
      const out = [];
      for (const token of [false, true]) {
        const start = myMain(D2.board);
        const seat = game(h, start);
        const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const bfz = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
        bfz(start).cards.push({ id: "engine-card-984", identity: { name: "Champions of the Perfect", isToken: token }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
        await feed(start);
        const mark = lines().length;
        const next = clone(start);
        bfz(next).cards = bfz(next).cards.filter((c) => c.id !== "engine-card-984");
        next.gameView.stack = [{ id: "stack-sp", sourceId: "engine-card-983", controllerId: "player-0", identity: { name: "Splinter's Technique" }, sourceAbilityText: "", text: "" }];
        await feed(next);
        out.push(lines().slice(mark));
      }
      // (a creature cast from the hand and already on the battlefield beside the bounce: the hand is level, it returned;
      // a spell already on the stack before is no card from the hand now: a card gone with the hand level only leaves)
      for (const way of ["cast resolved", "old spell"]) {
        const start = myMain(D2.board);
        const seat = game(h, start);
        const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const bfz = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
        const old = { id: "stack-old", sourceId: "engine-card-981", controllerId: "player-0", identity: { name: "Spell" }, sourceAbilityText: "", text: "" };
        bfz(start).cards.push({ id: "engine-card-984", identity: { name: "Champions of the Perfect" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
        if (way === "old spell") start.gameView.stack = [old];
        await feed(start);
        const mark = lines().length;
        if (way === "cast resolved") (h.B._getGame().pendingPlays ??= []).push({ id: "engine-card-980", name: "Grizzly Bears", ctl: "player-0", kind: "cast", at: Date.now(), promptId: -2 });
        const next = clone(start);
        bfz(next).cards = bfz(next).cards.filter((c) => c.id !== "engine-card-984");
        if (way === "cast resolved") bfz(next).cards.push({ id: "engine-card-980", identity: { name: "Grizzly Bears" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
        await feed(next);
        out.push([way, ...lines().slice(mark)]);
      }
      return out;
    } });
    // (hp-11: a search cast by Sneak, as Forge sends it live: Sneak's reminder as the ability text, the search in the
    // card's text: the library look answers itself; a real ability text with no search still shows the look)
    {
      const SPL = "Sneak {1}{B} (You may cast this spell for {1}{B} if you also return an unblocked attacker you control to hand during the declare blockers step.)\nSearch your library for a card, put that card into your hand, then shuffle.";
      const look = { ...prompt("revealCards", { presentation: { title: "Look at these cards", targets: [] }, ownerPlayerId: "player-view-0", zone: "library", cards: [H(75), H(35)] }) };
      add(promptCase("hp-11: Sneak's search look", myMain(D2.board), { ...look, sourceCard: { id: "engine-card-22", identity: { name: "Splinter's Technique" }, text: SPL },
        sourceAbilityText: "Sneak {1}{B} (You may cast this spell for {1}{B} if you also return an unblocked attacker you control to hand during the declare blockers step.)" }, [["ok"]]));
      for (const zoneName of ["battlefield", "library"]) {
        const sp = cards("Splinter's Technique", "Sneak {1}{B} (You may cast this spell for {1}{B} if you also return an unblocked attacker you control to hand during the declare blockers step.)", "Splinter's Technique", 1, SPL);
        add(promptCase(`hp-11: Sneak's ${zoneName} pick`, myMain(D2.board), { ...sp, sourceCard: { ...sp.sourceCard, text: SPL }, input: { ...sp.input, cards: sp.input.cards.map((c) => ({ ...c, zone: zoneName })) } }, [["engine-card-75"]]));
      }
      add(promptCase("hp-11: a look with a real ability text", myMain(D2.board), { ...look, sourceCard: { id: "engine-card-22", identity: { name: "Splinter's Technique" }, text: SPL },
        sourceAbilityText: "Look at the top two cards of your library." }, [["ok"]]));
    }
    // (hp-11: a split card resolving under its half's name goes to the graveyard unsaid)
    add({ name: "hp-11: log: a split card's half resolves", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const cast = clone(start); cast.gameView.stack = [{ id: "stack-cut", sourceId: "engine-card-982", controllerId: "player-0", identity: { name: "Cut" }, sourceAbilityText: "Cut deals 4 damage to target creature.", text: "x" }];
      await feed(cast);
      const mark = lines().length;
      const done = clone(start);
      done.gameView.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-0").cards.push({ id: "engine-card-982", identity: { name: "Cut // Ribbons" }, types: ["Sorcery"], ownerId: "player-0", controllerId: "player-0", text: "" });
      await feed(done);
      return lines().slice(mark);
    } });
    // (hp-13: Bargain's sacrifice, as Forge asks it live ("Sacrifice", the cast spell's text); a "Sacrifice" from a card
    // without Bargain keeps the plain title)
    for (const [label, text] of [["bargain", "Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)\nSearch your library for a card, exile it face down, then shuffle."],
      ["no bargain", "Search your library for a card, exile it face down, then shuffle."]]) {
      add(promptCase(`hp-13: a sacrifice while cast (${label})`, myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title: "Sacrifice", targets: [] } }),
        sourceCard: { id: "engine-card-979", identity: { name: "Beseech the Mirror" }, text } }, [["card|engine-card-64"]]));
    }
    // (a Bargain card already on the battlefield asking a sacrifice: not its bargain)
    {
      const onBf = myMain(D2.board);
      onBf.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-979", identity: { name: "Bargain Golem" }, types: ["Artifact"], ownerId: "player-0", controllerId: "player-0", text: "Bargain" });
      add(promptCase("hp-13: a sacrifice from a Bargain card on the battlefield", onBf, { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title: "Sacrifice", targets: [] } }),
        sourceCard: { id: "engine-card-979", identity: { name: "Bargain Golem" }, text: "Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)\n{1}, Sacrifice a land: Draw a card." } }, [["card|engine-card-64"]]));
    }
    // (hp-13: Beseech the Mirror's free cast says it is free and that "no" puts the card in the hand)
    add(promptCase("hp-13: Beseech's free cast", myMain(D2.board), { ...prompt("chooseBoolean", { presentation: { title: "Do you want to play Gyre Sage?", targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }),
      sourceCard: { id: "engine-card-979", identity: { name: "Beseech the Mirror" }, text: "x" },
      sourceAbilityText: "Search your library for a card, exile it face down, then shuffle. If this spell was bargained, you may cast the exiled card without paying its mana cost if that spell's mana value is 4 or less. Put the exiled card into your hand if it wasn't cast this way." }, [["yes"]]));
    // (hp-13: Devour's yes/no, as Forge asks it live; a card without devour keeps the plain sacrifice question)
    for (const [label, text] of [["devour", "Devour 2 (As this enters, you may sacrifice any number of creatures. This creature enters with twice that many +1/+1 counters on it.)\nAt the beginning of your upkeep, create a 1/1 green Saproling creature token for each +1/+1 counter on Mycoloth."], ["plain", "Flying"],
      // (Exploit, as Forge has Sidisi's text live; a card that mentions exploiting without having Exploit stays plain)
      ["exploit", "Deathtouch\nExploit (When this creature enters, you may sacrifice a creature.)\nWhen Sidisi, Undead Vizier exploits a creature, you may search your library for a card, put it into your hand, then shuffle."],
      ["exploit mentioned only", "When a creature you control exploits a creature, draw a card."]]) {
      add(promptCase(`hp-13: a sacrifice yes/no (${label})`, myMain(D2.board), { ...prompt("chooseBoolean", { presentation: { title: "Do you want to sacrifice?", targets: [] }, confirmLabel: "Accept", denyLabel: "Decline" }),
        sourceCard: { id: "engine-card-978", identity: { name: "Mycoloth" }, text } }, [["yes"]]));
    }
    // (hp-13: of two searches, the one the offered cards all fit: a land among them leaves the basic-land search, no
    // creature; a creature and a land, the "creature or land" one; none fitting, the plain title)
    {
      const POL = "Search your library for a basic land card. If evidence was collected, instead search your library for a creature or land card. Reveal that card, put it into your hand, then shuffle.";
      const land = { ...H(43), id: "engine-card-976", types: ["Land"], supertypes: ["Basic"], subtypes: ["Forest"] };
      const art = { ...H(43), id: "engine-card-975", types: ["Artifact"] };
      for (const [label, offered] of [["basic lands", [land]], ["a creature and a land", [H(75), land]], ["an artifact", [art]]]) {
        const pc = cards("Analyze the Pollen", POL, "Analyze the Pollen", 0);
        add(promptCase(`hp-13: two searches: ${label}`, myMain(D2.board), { ...pc, input: { ...pc.input, cards: offered } }, [[offered[0].id]]));
      }
    }
    // (hp-06 gap: Traverse the Ulvenwald without delirium, as Forge asks it live: basic lands offered, which both its
    // searches fit: the narrower, "basic land")
    {
      const TR = "Search your library for a basic land card, reveal it, put it into your hand, then shuffle. Delirium — If there are four or more card types among cards in your graveyard, instead search your library for a creature or land card, reveal it, put it into your hand, then shuffle.";
      const forest = { ...H(43), id: "engine-card-977", types: ["Land"], supertypes: ["Basic"], subtypes: ["Forest"] };
      const tr = cards("Traverse the Ulvenwald", TR, "Traverse the Ulvenwald", 0);
      add(promptCase("hp-06 gap: Traverse the Ulvenwald's basic land", myMain(D2.board), { ...tr, input: { ...tr.input, cards: [forest],
        presentation: { title: "Traverse the Ulvenwald", description: "Select a card from your library", targets: [] } } }, [["engine-card-977"]]));
    }
    // (hp-13: an undying return says its +1/+1 counter; an exile return with none says none)
    add({ name: "hp-13: log: a return with a counter", run: async (h) => {
      const start = myMain(D2.board);
      const seat = game(h, start);
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
      const card = (n, name) => ({ id: `engine-card-97${n}`, identity: { name }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
      zone(start, "graveyard").cards.push(card(4, "Indoraptor, the Perfect Hybrid"));
      zone(start, "exile").cards.push(card(3, "Grizzly Bears"));
      await feed(start);
      const mark = lines().length;
      const back = clone(start);
      zone(back, "graveyard").cards.pop(); zone(back, "exile").cards.pop();
      zone(back, "battlefield").cards.push({ ...card(4, "Indoraptor, the Perfect Hybrid"), counters: { P1P1: 1 } }, card(3, "Grizzly Bears"));
      await feed(back);
      return lines().slice(mark);
    } });
    // (hp-13: Learn's discard to draw, as Forge asks it live)
    {
      const fd = cards("First Day of Class", "Whenever a creature you control enters this turn, put a +1/+1 counter on it and it gains haste until end of turn. Learn. (You may reveal a Lesson card you own from outside the game and put it into your hand, or discard a card to draw a card.)", "First Day of Class", 0);
      add(promptCase("hp-13: Learn's discard to draw", myMain(D2.board), { ...fd, input: { ...fd.input, cards: fd.input.cards.map((c) => ({ ...c, zone: "hand" })),
        presentation: { title: "First Day of Class", description: "Reveal a Lesson card you own from outside the game and put it into your hand, or discard a card to draw a card.", targets: [] } } }, [["engine-card-75"]]));
      // (suite review: Lessons from outside the game are no discard)
      add(promptCase("hp-13: Learn's Lessons from outside the game", myMain(D2.board), { ...fd, input: { ...fd.input, cards: fd.input.cards.map((c) => ({ ...c, zone: "sideboard" })),
        presentation: { title: "First Day of Class", description: "Reveal a Lesson card you own from outside the game and put it into your hand, or discard a card to draw a card.", targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-14: Strive's extra cost under the targets, as Forge asks it live; one target only: no note)
    for (const max of [8, 1]) {
      add(promptCase(`hp-14: Strive's targets (up to ${max})`, myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 0, maxTargets: max, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title: "Copy", targets: [] } }),
        sourceCard: { id: "engine-card-973", identity: { name: "Twinflame" }, text: "Strive — This spell costs {2}{R} more to cast for each target beyond the first.\nChoose any number of target creatures you control. For each of them, create a token that's a copy of that creature, except it has haste. Exile those tokens at the beginning of the next end step." } }, [["card|engine-card-64"]]));
    }
    // (hp-14: Support's targets, as Forge asks it live (no title, so "choose up to 2 targets"))
    add(promptCase("hp-14: Support's targets", myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 0, maxTargets: 2, candidates: [{ kind: "card", id: "engine-card-64" }, { kind: "card", id: "engine-card-65" }], presentation: { title: "Buff", targets: [] } }),
      sourceCard: { id: "engine-card-972", identity: { name: "Together Forever" }, text: "When Together Forever enters, support 2. (Put a +1/+1 counter on each of up to two target creatures.)\n{1}: Choose target creature with a counter on it. When that creature dies this turn, return that card to its owner's hand." } }, [["card|engine-card-64"]]));
    // (a support card's other one-target question stays its own)
    add(promptCase("hp-14: a Support card's other target", myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: "engine-card-64" }], presentation: { title: "Buff", targets: [] } }),
      sourceCard: { id: "engine-card-972", identity: { name: "Together Forever" }, text: "When Together Forever enters, support 2. (Put a +1/+1 counter on each of up to two target creatures.)\n{1}: Choose target creature with a counter on it." },
      sourceAbilityText: "{1}: Choose target creature with a counter on it. When that creature dies this turn, return that card to its owner's hand." }, [["card|engine-card-64"]]));
    // (a creature's support says "other")
    add(promptCase("hp-14: Support's targets, a creature's", myMain(D2.board), { ...prompt("chooseBoardTargets", { minTargets: 0, maxTargets: 2, candidates: [{ kind: "card", id: "engine-card-64" }, { kind: "card", id: "engine-card-65" }], presentation: { title: "Buff", targets: [] } }),
      sourceCard: { id: "engine-card-971", identity: { name: "Gladehart Cavalry" }, text: "When Gladehart Cavalry enters, support 6. (Put a +1/+1 counter on each of up to six other target creatures.)" } }, [["card|engine-card-64"]]));
    // (hp-13: collect evidence's cards, as Forge asks it live)
    {
      const ap = cards("Analyze the Pollen", "Search your library for a basic land card. If evidence was collected, instead search your library for a creature or land card. Reveal that card, put it into your hand, then shuffle.", "Analyze the Pollen", 0);
      add(promptCase("hp-13: collect evidence's cards", myMain(D2.board), { ...ap, input: { ...ap.input, max: 2, cards: ap.input.cards.map((c) => ({ ...c, zone: "graveyard" })),
        presentation: { title: "Analyze the Pollen", description: "Collect evidence 8", targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-10: Chrome Mox's imprint pick, as Forge asks it live)
    {
      const MOX = "Imprint — When Chrome Mox enters, you may exile a nonartifact, nonland card from your hand.";
      const mox = cards("Chrome Mox", MOX, "Chrome Mox");
      add(promptCase("hp-10: Chrome Mox's imprint", myMain(D2.board), { ...mox, input: { ...mox.input, min: 0, cards: mox.input.cards.map((c) => ({ ...c, zone: "hand" })),
        presentation: { title: "Chrome Mox", description: "Select a card from your hand", targets: [] } } }, [["engine-card-75"]]));
    }
    // (hp-04 #3: Crew's creatures to tap)
    add(promptCase("hp-04: Crew's creatures to tap", myMain(D2.board), { ...cards("Hedge Shredder", "Crew 1 (Tap any number of creatures you control with total power 1 or more: Hedge Shredder becomes an artifact creature until end of turn.)", "Hedge Shredder", 0),
      input: { ...cards("Hedge Shredder", "x", "Hedge Shredder", 0).input, max: 2 } }, [["engine-card-75"]]));
    // (hp-05: Kodama of the East Tree's permanent card "with equal or lesser mana value", as Forge asks it live)
    const KODAMA = "Whenever another permanent you control enters, if it wasn't put onto the battlefield with this ability, you may put a permanent card with equal or lesser mana value from your hand onto the battlefield.";
    const kodama = cards("Kodama of the East Tree", KODAMA, "Kodama of the East Tree");
    add(promptCase("hp-05: Kodama's card from the hand", myMain(D2.board), { ...kodama, input: { ...kodama.input, min: 0, cards: kodama.input.cards.map((c) => ({ ...c, zone: "hand" })),
      presentation: { title: "Kodama of the East Tree", description: "Select a card from your hand", targets: [] } } }, [["engine-card-75"]]));
    // (hp-05: a trigger seen with a permanent that just entered is said after the entry; with none entering, in place)
    add({ name: "hp-05: log: a trigger after the entry that caused it", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const start = myMain(D2.board);
      await feed(start);
      const mark = lines().length;
      const bfOf = (b) => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
      const src = bfOf(start)[0];
      const trig = { sourceId: src.id, controllerId: "player-0", identity: src.identity, sourceAbilityText: "Whenever another permanent you control enters, you may put a permanent card from your hand onto the battlefield.", text: "x" };
      const entry = clone(start);
      bfOf(entry).push({ ...clone(src), id: "engine-card-961", identity: { name: "Lizard Blades" }, types: ["Artifact"], counters: {} });
      entry.gameView.stack = [trig];
      await feed(entry);
      const resolved = clone(entry); resolved.gameView.stack = []; await feed(resolved);
      const alone = clone(resolved); alone.gameView.stack = [trig]; await feed(alone);
      // (a creature dying beside it is no entry: in place)
      const withBear = clone(resolved);
      bfOf(withBear).push({ ...clone(src), id: "engine-card-962", identity: { name: "Grizzly Bears" }, types: ["Creature"], counters: {} });
      await feed(withBear);
      const dies = clone(resolved);
      dies.gameView.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-0").cards.push({ ...clone(src), id: "engine-card-962", identity: { name: "Grizzly Bears" }, types: ["Creature"] });
      dies.gameView.stack = [trig];
      await feed(dies);
      // (the player's own activation beside an entry: in place)
      const own = clone(dies); own.gameView.stack = []; await feed(own);
      h.B._getGame().pendingPlays.push({ id: src.id, name: src.identity.name, ctl: "player-0", kind: "ability", at: Date.now(), promptId: 0 });
      const ownEntry = clone(own);
      bfOf(ownEntry).push({ ...clone(src), id: "engine-card-963", identity: { name: "Llanowar Elves" }, types: ["Creature"], counters: {} });
      ownEntry.gameView.stack = [{ ...trig, sourceAbilityText: "{4}, {T}: Proliferate." }];
      await feed(ownEntry);
      return lines().slice(mark);
    } });
    // (hp-05: a library card to the battlefield beside a graveyard card into the hand: no "from their library"; with no
    // graveyard card leaving, the hand's card is a draw as before)
    add({ name: "hp-05: log: a library card to the battlefield, a graveyard card to the hand", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
      const card = (n, name, types) => ({ id: `engine-card-97${n}`, identity: { name }, types, ownerId: "player-0", controllerId: "player-0", text: "" });
      const out = [];
      // (and a spell off the stack is no library card: a draw and the graveyard card both; a face-down exile card
      // leaving is no other source for the hand)
      for (const way of ["back", "draw", "stack", "facedown"]) {
        const start = myMain(D2.board);
        zone(start, "library").count = 20;
        if (way === "back" || way === "stack") zone(start, "graveyard").cards.push(card(1, "Lórien Revealed", ["Sorcery"]));
        if (way === "facedown") zone(start, "exile").cards.push({ ...card(3, "Delayed Blast Fireball", ["Instant"]), isFaceDown: true });
        if (way === "stack") start.gameView.stack = [{ id: "stack-1", sourceId: "engine-card-972", controllerId: "player-0", identity: { name: "Sowing Mycospawn" }, sourceAbilityText: "", text: "" }];
        await feed(start);
        const mark = lines().length;
        const next = clone(start);
        next.gameView.stack = [];
        zone(next, "library").count = 19;
        if (way === "back" || way === "stack") zone(next, "graveyard").cards.pop();
        if (way === "facedown") zone(next, "exile").cards.pop();
        const hz = zone(next, "hand");
        hz.count = (hz.count ?? hz.cards.length) + (way === "stack" ? 2 : 1);
        zone(next, "battlefield").cards.push(card(2, "Sowing Mycospawn", ["Creature"]));
        await feed(next);
        out.push(lines().slice(mark));
      }
      return out;
    } });
    // (hp-09: a draw seen with a nonland entry in a main phase is said after it; from the upkeep, or beside a land, first)
    add({ name: "hp-09: log: a draw after the entry that caused it", run: async (h) => {
      const out = [];
      for (const [step, types] of [["main1", ["Enchantment"]], ["upkeep", ["Enchantment"]], ["main1", ["Land"]]]) {
        const start = myMain(D2.board); start.gameView.step = step;
        const seat = game(h, start);
        const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const zone = (b, zn) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === "player-0");
        zone(start, "library").count = 20;
        await feed(start);
        const mark = lines().length;
        const next = clone(start); next.gameView.step = "main1";
        zone(next, "library").count = 19;
        const hz = zone(next, "hand"); hz.count = (hz.count ?? hz.cards.length) + 1;
        zone(next, "battlefield").cards.push({ id: "engine-card-991", identity: { name: types[0] === "Land" ? "Forest" : "Asceticism" }, types, ownerId: "player-0", controllerId: "player-0", text: "" });
        await feed(next);
        out.push(lines().slice(mark));
      }
      return out;
    } });
    // ── suite review 2026-10-28 (after hp-02) ──
    // (a search kind with a colour or "non" word isn't known: no "no ... in your library"; "up to two basic land cards"
    // found answers the look by itself; "... or a Gate card" is no single kind)
    for (const [label, ab, shown] of [
      ["green creature", "Search your library for a green creature card, put it onto the battlefield, then shuffle.", [{ ...H(43), id: "engine-card-82", types: ["Creature"] }]],
      ["up to two basic lands, one there", "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.", [{ ...H(43), id: "engine-card-83", types: ["Land"], subtypes: ["Forest"], supertypes: ["Basic"] }]],
      ["basic land or Gate", "Search your library for a basic land card or a Gate card, reveal it, put it into your hand, then shuffle.", [{ ...H(43), id: "engine-card-84", types: ["Land"], subtypes: ["Gate"] }]]]) {
      add(promptCase(`suite review: search kind: ${label}`, myMain(D2.board), { ...fetchLook(shown), sourceCard: { id: "engine-card-22", identity: { name: "Tutor" }, text: "" }, sourceAbilityText: ab }, [["ok"]]));
    }
    // (a discard its owner just chose, the hand level by a draw beside it: a discard, not a mill (connive, loot))
    add({ name: "suite review: log: connive's discard is no mill", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (b, zn, owner) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
      const start = myMain(D2.board); zone(start, "library", "player-0").count = 20;
      await feed(start);
      const mark = lines().length;
      seat.note("discard", "player-0");
      const after = clone(start); zone(after, "library", "player-0").count = 19;
      // (and a card from no seen zone beside it: the one card off the library was drawn, so that one isn't milled)
      zone(after, "graveyard", "player-0").cards.push({ id: "engine-card-963", identity: { name: "Forest" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" },
        { id: "engine-card-964", identity: { name: "Island" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" });
      await feed(after);
      return lines().slice(mark);
    } });
    // (a triggered ability another item targeted, its card into the graveyard: not "countered", only spells are)
    add({ name: "suite review: log: a targeted ability's card isn't countered", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const b1 = myMain(D2.board);
      b1.gameView.stack = [{ id: "engine-stack-96", sourceId: "engine-card-961", controllerId: "player-1", identity: { name: "Gravedigger" }, sourceAbilityText: "When Gravedigger enters, you may return target creature card from your graveyard to your hand.", text: "x" },
        { id: "engine-stack-97", sourceId: "engine-card-960", controllerId: "player-0", identity: { name: "Stifle" }, text: "x", targets: [{ kind: "spell", id: "engine-stack-96" }] }];
      await feed(b1);
      const mark = lines().length;
      const b2 = myMain(D2.board);
      b2.gameView.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-1").cards.push({ id: "engine-card-961", identity: { name: "Gravedigger" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
      await feed(b2);
      return lines().slice(mark);
    } });
    // (a split card cast by its half and exiled after isn't "on an adventure")
    add({ name: "suite review: log: a split card's half isn't an adventure", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const b1 = myMain(D2.board); b1.gameView.stack = [{ id: "engine-stack-95", sourceId: "engine-card-962", controllerId: "player-0", identity: { name: "Ribbons" }, text: "x" }];
      await feed(b1);
      const mark = lines().length;
      const b2 = myMain(D2.board); b2.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-0").cards.push({ id: "engine-card-962", identity: { name: "Cut // Ribbons" }, types: ["Sorcery"], ownerId: "player-0", controllerId: "player-0", text: "" });
      await feed(b2);
      return lines().slice(mark);
    } });
    // (an AI's land play and an effect's land between two boards: one play, one put, by the land-play count)
    add({ name: "suite review: log: one land play and one put by the count", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const b1 = myMain(D2.board); for (const p of b1.gameView.players) p.landsPlayedThisTurn = 0;
      await feed(b1);
      const mark = lines().length;
      const b2 = clone(b1); b2.gameView.players.find((p) => p.id === "player-1").landsPlayedThisTurn = 1;
      const bf = b2.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1");
      for (const n of [5, 6]) bf.cards.push({ id: `engine-card-96${n}`, identity: { name: "Swamp" }, types: ["Land"], ownerId: "player-1", controllerId: "player-1", text: "" });
      await feed(b2);
      return lines().slice(mark);
    } });
    // (hp-02 #4: "a card, put that card" is any card, no kind: Demonic Tutor read "no card, put that card in your library")
    add(promptCase("hp-02: Demonic Tutor's library look: no kind", myMain(D2.board), { ...fetchLook([{ ...H(43), id: "engine-card-80" }]), sourceCard: { id: "engine-card-22", identity: { name: "Demonic Tutor" }, text: "" },
      sourceAbilityText: "Search your library for a card, put that card into your hand, then shuffle." }, [["ok"]]));
    // (hp-01 #4: a spell target by its name and whose spell it is, not "engine-stack-56")
    add({ name: "hp-01: Counterspell's target is named", run: async (h) => {
      const b = myMain(D2.board);
      // (an ability's source is on the battlefield; an instant's card is in no zone though Forge gives it its text too)
      const onBf = b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards[0].id;
      b.gameView.stack = [{ id: "engine-stack-56", sourceId: "engine-card-975", controllerId: "player-1", identity: { name: "Relentless Rats" }, text: "Relentless Rats" },
        { id: "engine-stack-57", sourceId: onBf, controllerId: "player-0", identity: { name: "Prodigal Sorcerer" }, sourceAbilityText: "{T}: Prodigal Sorcerer deals 1 damage to any target.", text: "x" },
        { id: "engine-stack-58", sourceId: "engine-card-976", controllerId: "player-1", identity: { name: "Lightning Bolt" }, sourceAbilityText: "Lightning Bolt deals 3 damage to any target.", text: "x" }];
      const seat = game(h, b);
      h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "spell", id: "engine-stack-56" }, { kind: "spell", id: "engine-stack-57" }, { kind: "spell", id: "engine-stack-58" }], presentation: { title: "Choose a target to counter", targets: [] } }),
        sourceCard: { id: "engine-card-22", identity: { name: "Counterspell" }, text: "Counter target spell." } }); await h.flush();
      return seat.prompt?.ui?.options?.map((o) => o.label);
    } });
    // (hp-01 #6: a permanent spell countered is logged; an instant resolving into the graveyard isn't "countered")
    add({ name: "hp-01: log: a countered creature spell", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (b, zn, owner) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
      const withStack = (items) => { const b = myMain(D2.board); b.gameView.stack = items; return b; };
      const rats = { id: "engine-stack-70", sourceId: "engine-card-970", controllerId: "player-1", identity: { name: "Relentless Rats" }, text: "Relentless Rats" };
      const counter = { id: "engine-stack-71", sourceId: "engine-card-971", controllerId: "player-0", identity: { name: "Counterspell" }, text: "Counterspell", targets: [{ kind: "spell", id: "engine-stack-70" }] };
      const rats2 = { id: "engine-stack-72", sourceId: "engine-card-972", controllerId: "player-1", identity: { name: "Relentless Rats" }, text: "Relentless Rats" };
      await feed(withStack([rats, counter, rats2]));
      const mark = lines().length;
      // (the targeted Rats into the graveyard: countered; the other Rats, not targeted, into it too: not "countered")
      const after = withStack([]);
      zone(after, "graveyard", "player-1").cards.push({ id: "engine-card-970", identity: { name: "Relentless Rats" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" },
        { id: "engine-card-972", identity: { name: "Relentless Rats" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
      zone(after, "graveyard", "player-0").cards.push({ id: "engine-card-971", identity: { name: "Counterspell" }, types: ["Instant"], ownerId: "player-0", controllerId: "player-0", text: "" });
      await feed(after);
      return lines().slice(mark);
    } });
    // (gap-04: the commander replacement into the hand, as Forge asks it live under "Commander Effect", with the bounce
    // that moves it on the stack; with nothing on the stack, said as it can be)
    for (const bounce of [true, false]) {
      const b = myMain(D2.board);
      if (bounce) b.gameView.stack = [{ id: "engine-stack-90", sourceId: "engine-card-990", controllerId: "player-1", identity: { name: "Into the Roil" },
        sourceAbilityText: "Kicker {1}{U}\nReturn target nonland permanent to its owner's hand. If this spell was kicked, draw a card.", targets: [{ kind: "card", id: "engine-card-75" }] }];
      add(promptCase(`gap-04: commander into the hand${bounce ? "" : ", nothing on the stack"}`, b, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline",
        presentation: { targets: [], title: "Apply replacement effect of Commander Effect?\r\nIf a commander would be put into its owner's hand or library from anywhere, its owner may put it into the command zone instead." } }),
        sourceCard: { id: "engine-card-0", identity: { name: "Commander Effect" } } }, [["yes"]]));
    }
    // (hp-20 gap: the seat's commander returned by a cost (Spider-Sense's web-slinging) while Murder targets another
    // creature: the commander named, not Murder's target)
    {
      const b = myMain(D2.board);
      b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-139", identity: { name: "Kenrith, the Returned King" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" },
        { id: "engine-card-32", identity: { name: "Blind Hunter" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
      b.gameView.stack = [{ id: "engine-stack-22", sourceId: "engine-card-6", controllerId: "player-0", identity: { name: "Murder" }, sourceAbilityText: "Destroy target creature.", targets: [{ kind: "card", id: "engine-card-32" }] }];
      add(promptCase("hp-20 gap: commander returned by a cost", b, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline",
        presentation: { targets: [], title: "Apply replacement effect of Commander Effect?\r\nIf a commander would be put into its owner's hand or library from anywhere, its owner may put it into the command zone instead." } }),
        sourceCard: { id: "engine-card-0", identity: { name: "Commander Effect" } } }, [["yes"]], { seat: { commanderNames: ["Kenrith, the Returned King"] } }));
    }
    // (gap-04: Ward as Forge asks it live, with its "otherwise" sentence: a life cost against an ability, a mana cost
    // against a spell)
    for (const [cost, ward, target] of [["Pay 2 {LIFE}?", "Ward—Pay 2 life.", "Kenrith, the Returned King (40)'s ability"], ["Pay {2}?", "Ward {2}", "Murder"]]) {
      add(promptCase(`gap-04: ward (${ward})`, myMain(D2.board), { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline",
        presentation: { targets: [], title: cost, text: `otherwise: "Counter ${target} unless its controller pays {${cost.includes("LIFE") ? "PayLife<2>" : "2"}}."` } }),
        sourceCard: { id: "engine-card-965", identity: { name: "Hexing Squelcher" }, text: "x" },
        sourceAbilityText: `${ward} (Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays ${cost.includes("LIFE") ? "2 life" : "{2}"}.)` }, [["yes"]]));
    }
    // (hp-20 gap: the same ward from the AI's face-down (cloaked) creature: its name never shown, Forge flagging it face
    // down or only the board doing so; one of the player's own face-down cards keeps its name)
    for (const [what, fdFlag, owner] of [["flagged", true, "player-1"], ["board only", false, "player-1"], ["own card", true, "player-0"]]) {
      const b = myMain(D2.board);
      b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === owner).cards.push({ id: "engine-card-948", identity: { name: "?" }, isFaceDown: true, types: ["Creature"], ownerId: owner, controllerId: owner, text: "" });
      add(promptCase(`hp-20 gap: ward of a face-down creature (${what})`, b, { ...prompt("chooseBoolean", { confirmLabel: "Accept", denyLabel: "Decline",
        presentation: { targets: [], title: "Pay {2}?", text: `otherwise: "Counter Go for the Throat unless its controller pays {2}."` } }),
        sourceCard: { id: "engine-card-948", identity: { name: "Garruk's Companion" }, isFaceDown: fdFlag, controllerId: owner, text: "Trample" },
        sourceAbilityText: "Ward {2} (Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)" }, [["yes"]]));
    }
    // (gap-04: an instant under a counterspell is countered, under a copy spell it resolves; the counterspell's two
    // Treasures in one line, a single token as before)
    for (const [by, text] of [["An Offer You Can't Refuse", "Counter target noncreature spell. Its controller creates two Treasure tokens."],
      ["Twincast", "Copy target instant or sorcery spell. You may choose new targets for the copy."]]) {
      add({ name: `gap-04: log: an instant under ${by}`, run: async (h) => {
        const seat = game(h, myMain(D2.board));
        const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const zone = (b, zn, owner) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
        const withStack = (items) => { const b = myMain(D2.board); b.gameView.stack = items; return b; };
        const opt = { id: "engine-stack-80", sourceId: "engine-card-980", controllerId: "player-1", identity: { name: "Opt" }, sourceAbilityText: "Scry 1. Draw a card.", text: "Opt" };
        const over = { id: "engine-stack-81", sourceId: "engine-card-981", controllerId: "player-0", identity: { name: by }, sourceAbilityText: text, text: by, targets: [{ kind: "spell", id: "engine-stack-80" }] };
        await feed(withStack([opt, over]));
        const mark = lines().length;
        const after = withStack([]);
        zone(after, "graveyard", "player-1").cards.push({ id: "engine-card-980", identity: { name: "Opt" }, types: ["Instant"], ownerId: "player-1", controllerId: "player-1", text: "" });
        zone(after, "graveyard", "player-0").cards.push({ id: "engine-card-981", identity: { name: by }, types: ["Instant"], ownerId: "player-0", controllerId: "player-0", text: "" });
        const treasure = (id) => ({ id, identity: { name: "Treasure Token", isToken: true }, types: ["Artifact"], ownerId: "player-1", controllerId: "player-1", text: "" });
        zone(after, "battlefield", "player-1").cards.push(...(by === "Twincast" ? [treasure("engine-card-984")] : [treasure("engine-card-982"), treasure("engine-card-983")]));
        await feed(after);
        return lines().slice(mark);
      } });
    }
    // (gap-04 re-test: the player's own counterspell, never seen on the stack: its target picked; a sorcery and a
    // creature spell, and the same pick for a non-counter spell says nothing)
    for (const [what, text, kind] of [["sorcery", "Counter target noncreature spell. Its controller creates two Treasure tokens.", "Sorcery"],
      ["creature spell", "Counter target spell.", "Creature"], ["not a counterspell", "Copy target instant or sorcery spell.", "Sorcery"]]) {
      add({ name: `gap-04 re-test: log: the player's counterspell's target (${what})`, run: async (h) => {
        const seat = game(h, myMain(D2.board));
        const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
        const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
        const zone = (b, zn, owner) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
        const withStack = (items) => { const b = myMain(D2.board); b.gameView.stack = items; return b; };
        const div = { id: "engine-stack-85", sourceId: "engine-card-985", controllerId: "player-1", identity: { name: "Divination" }, sourceAbilityText: "Draw two cards.", text: "Divination", isPermanentSpell: kind === "Creature" };
        await feed(withStack([div]));
        const mark = lines().length;
        h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "spell", id: "engine-stack-85" }], presentation: { title: "x", targets: [] } }),
          sourceCard: { id: "engine-card-986", identity: { name: "An Offer You Can't Refuse" }, text }, sourceAbilityText: text, promptId: 967 }); await h.flush();
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 967, choice: ["spell|engine-stack-85"] }) }); await h.flush();
        const after = withStack([]);
        zone(after, "graveyard", "player-1").cards.push({ id: "engine-card-985", identity: { name: "Divination" }, types: [kind], ownerId: "player-1", controllerId: "player-1", text: "" });
        await feed(after);
        return lines().slice(mark);
      } });
    }
    // (hp-19 gap: Wash Away's cleave in the AI's main phase: the board after it already in the next turn; the countered
    // creature spell is said)
    add({ name: "hp-19 gap: log: a counter seen with the next turn", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (b, zn, owner) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
      const withStack = (items) => { const b = myMain(D2.board); b.gameView.stack = items; return b; };
      const sky = { id: "engine-stack-62", sourceId: "engine-card-40", controllerId: "player-1", identity: { name: "Daring Skyjek" }, sourceAbilityText: "", text: "Daring Skyjek", isPermanentSpell: true };
      await feed(withStack([sky]));
      const mark = lines().length;
      const WA = "Cleave {1}{U}{U} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)\nCounter target spell [that wasn't cast from its owner's hand].";
      h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { minTargets: 1, maxTargets: 1, candidates: [{ kind: "spell", id: "engine-stack-62" }], presentation: { title: "Counter", targets: [] } }),
        sourceCard: { id: "engine-card-22", identity: { name: "Wash Away" }, text: WA }, sourceAbilityText: WA, promptId: 975 }); await h.flush();
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 975, choice: ["spell|engine-stack-62"] }) }); await h.flush();
      const after = withStack([]); after.gameView.turn = (after.gameView.turn || 0) + 1;
      zone(after, "graveyard", "player-1").cards.push({ id: "engine-card-40", identity: { name: "Daring Skyjek" }, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" });
      await feed(after);
      return lines().slice(mark);
    } });
    // ── hp-22 re-test 2026-10-28 ──
    // (#16: any "[Name: ...]" note, a bracket inside it too; a loyalty cost stays)
    add({ name: "hp-22 re-test: Forge's notes of any name leave a text, loyalty costs stay", run: async (h) => {
      game(h, D2.board);
      return [h.B.displayText("Whenever one or more Dragons you control attack, draw that many cards. [Number Attackers: [The Ur-Dragon]]"),
        h.B.displayText("[-2]: Target creature becomes a Treasure."), h.B.displayText("[+1]: Draw a card. [Some Note: x]")];
    } });
    // (#17: turn 0, the mulligans, has a player marked active: not their turn)
    add({ name: "hp-22 re-test: turn 0 (mulligans) is nobody's turn", run: async (h) => {
      const seat = game(h, myMain(D2.board), { game: { turnOwners: {} } });
      const at = (turn, active) => { const b = myMain(D2.board); b.gameView.turn = turn; b.gameView.activePlayerId = active; b.gameView.priorityPlayerId = active; return b; };
      const nos = [];
      for (const [t, a] of [[0, "player-0"], [1, "player-1"], [2, "player-0"], [3, "player-1"]]) {
        seat.board = { state: at(t, a), fingerprint: null }; h.B.sendTable(); await h.flush();
        const last = h.effects.filter((e) => e.tts && e.tts.t === "table").pop();
        nos.push(`${t}:${last?.tts.activeTurnNo}`);
      }
      return nos;
    } });
    // (#18: a Treasure sacrificed goes to the graveyard, though the card is a creature there; an AI's land play by its
    // land-play count while a draw kept its hand as it was; an effect's land with the count unchanged is put there)
    add({ name: "hp-22 re-test: log: a Treasure sacrificed, an AI's land play with a draw, an effect's land", run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const feed = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const base = () => { const b = myMain(D2.board); for (const p of b.gameView.players) p.landsPlayedThisTurn = 0; return b; };
      const zone = (b, zn, owner) => b.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
      const rats = { id: "engine-card-981", identity: { name: "Relentless Rats" }, ownerId: "player-1", controllerId: "player-1", text: "" };
      const withTreasure = base();
      zone(withTreasure, "battlefield", "player-1").cards.push({ ...rats, types: ["Artifact"], subtypes: ["Treasure"] });
      await feed(withTreasure);
      const mark = lines().length;
      const sacrificed = base();
      zone(sacrificed, "graveyard", "player-1").cards.push({ ...rats, types: ["Creature"], subtypes: ["Rat"] });
      await feed(sacrificed);
      const swamp = (n) => ({ id: `engine-card-97${n}`, identity: { name: "Swamp" }, types: ["Land"], ownerId: "player-1", controllerId: "player-1", text: "" });
      const lessInHand = (b) => { const hz = zone(b, "hand", "player-1"); if (hz) hz.count = Math.max(0, (hz.count ?? (hz.cards || []).length) - 1); };
      // (an effect's land from the AI's hand with no land played yet: the count, 0, says no play)
      const fromHand = clone(sacrificed);
      zone(fromHand, "battlefield", "player-1").cards.push(swamp(1));
      lessInHand(fromHand);
      await feed(fromHand);
      const played = clone(fromHand);
      zone(played, "battlefield", "player-1").cards.push(swamp(2));
      played.gameView.players.find((p) => p.id === "player-1").landsPlayedThisTurn = 1;
      await feed(played);
      const put = clone(played);
      zone(put, "battlefield", "player-1").cards.push(swamp(3));
      lessInHand(put);
      await feed(put);
      // (the next turn's land play, seen with the turn change: its count starts again at 0)
      const nextTurn = clone(put);
      nextTurn.gameView.turn = (nextTurn.gameView.turn ?? 0) + 1;
      zone(nextTurn, "battlefield", "player-1").cards.push(swamp(4));
      await feed(nextTurn);
      return lines().slice(mark);
    } });
  }
}

// ── the rebuilt decks' hand test (2026-11-04) ──
add(promptCase("rebuilt #7: a coin flip is said of its player", D2.board, prompt("revealCards", { presentation: { title: "You win the flip." }, cards: [] }, { sourceCard: H(77) }), []));
add(promptCase("rebuilt #7: an opponent's reveal said once as theirs", D2.board, prompt("revealCards", { presentation: { title: "Chaos Warp - Revealing cards from" }, ownerPlayerId: "player-1", zone: "library", cards: [H(43)] }, { sourceCard: H(77) }), [["ok"]]));
{
  const MAIRSIL_TEXT = "As Mairsil, the Pretender enters, you may exile an artifact or creature card from your hand or graveyard and put a cage counter on it.";
  add(promptCase("rebuilt #14: Mairsil's pick names both zones", D2.board, prompt("chooseCards", { presentation: { title: "Choose" }, cards: [H(43)], min: 0, max: 1 }, { sourceCard: { ...H(77), identity: { ...H(77).identity, name: "Mairsil, the Pretender" }, text: MAIRSIL_TEXT }, sourceAbilityText: MAIRSIL_TEXT }), [[]]));
  const b = clone(D2.board);
  for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-22") Object.assign(c, { identity: { ...c.identity, name: "Mairsil, the Pretender" }, text: MAIRSIL_TEXT });
  add(promptCase("rebuilt #6: a question with no card, by the card on the board that asks it", b, prompt("chooseBoolean", { presentation: { title: "Exile an artifact or creature card from your hand or graveyard and put a cage counter on it?" } }), [["no"]]));
  const m = myMain(D2.board);
  for (const z of m.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-64" || c.id === "engine-card-65") c.identity = { ...c.identity, name: "Mairsil, the Pretender" };
  add(promptCase("rebuilt #12: the same ability on two permanents of one name, both offered", m, prompt("chooseAction", { actions: [
    { id: "a-m1", type: "activateAbility", cardId: "engine-card-64", description: "{T}: Destroy target tapped creature." },
    { id: "a-m2", type: "activateAbility", cardId: "engine-card-65", description: "{T}: Destroy target tapped creature." }] }), [["a-m2"]]));
  add(promptCase("rebuilt #16: Ponder's look is in the log", D2.board, prompt("reorder", { presentation: { title: "Reorder" }, items: [{ id: "engine-card-43", card: H(43) }, { id: "engine-card-75", card: H(75) }, { id: "engine-card-77", card: H(77) }] },
    { sourceCard: { ...H(77), identity: { ...H(77).identity, name: "Ponder" } }, sourceAbilityText: "Look at the top three cards of your library, then put them back in any order. You may shuffle." }), [["engine-card-75"], ["engine-card-43"], ["engine-card-77"]]));
  add(promptCase("rebuilt #2: a card revealed for a cost is in the log", D2.board, prompt("chooseCards", { presentation: { title: "Reveal for cost" }, cards: [H(43), H(75)], min: 1, max: 1 },
    { sourceCard: { ...H(77), identity: { ...H(77).identity, name: "Foreboding Ruins" }, text: "As Foreboding Ruins enters, you may reveal a Swamp or Mountain card from your hand. If you don't, it enters tapped." } }), [["engine-card-75"]]));
  add(promptCase("rebuilt #2 re-test: Forge's shape, the step in the description", D2.board, prompt("chooseCards", { presentation: { title: "Choose", description: "Reveal for cost" }, cards: [H(43), H(75)], min: 1, max: 1 },
    { sourceCard: { ...H(77), identity: { ...H(77).identity, name: "Foreboding Ruins" }, text: "As Foreboding Ruins enters, you may reveal a Swamp or Mountain card from your hand. If you don't, it enters tapped." } }), [["engine-card-75"]]));
  add({ name: "rebuilt #7: a reveal shown to two seats is logged once", run: async (h) => {
    const seat = game(h, D2.board);
    const reveal = (id) => prompt("revealCards", { presentation: { title: "Chaos Warp - Revealing cards from" }, ownerPlayerId: "player-1", zone: "library", cards: [H(43)] }, { promptId: id, sourceCard: H(77) });
    const other = new h.B.Seat("Yellow", "neheb_minotaur_commander");
    other.slot = "player-2";
    other.board = { state: clone(D2.board), fingerprint: null };
    h.B._getGame().seats.set("Yellow", other);
    h.B.onPrompt(seat, reveal(901)); await h.flush();
    h.B.onPrompt(other, reveal(902)); await h.flush();
    h.B._getGame().seats.delete("Yellow");
    return { log: h.B._getGame().log };
  } });
  // (re-test: the reveal comes mid-spell, before the board that shows the spell's first move; said after that board's
  // lines, or alone 2 s later when no board brings any)
  for (const board of [true, false]) {
    add({ name: `rebuilt #7 re-test: a reveal said after what its spell did first${board ? "" : ", or alone"}`, run: async (h) => {
      const seat = game(h, myMain(D2.board));
      const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
      const zone = (bd, zn, owner) => bd.gameView.zones.find((z) => z.zone === zn && z.ownerId === owner);
      const island = { id: "engine-card-970", identity: { name: "Island" }, types: ["Land"], ownerId: "player-1", controllerId: "player-1", text: "" };
      const before = myMain(D2.board);
      zone(before, "battlefield", "player-1").cards.push(island);
      seat.board = { state: before, fingerprint: null }; h.B.sendTable(); await h.flush();
      const mark = lines().length;
      h.B.onPrompt(seat, prompt("revealCards", { presentation: { title: "Chaos Warp - Revealing cards from" }, ownerPlayerId: "player-1", zone: "library", cards: [{ ...H(43), identity: { ...H(43).identity, name: "Island" } }] },
        { sourceCard: { ...H(77), identity: { ...H(77).identity, name: "Chaos Warp" } } }));
      if (board) {
        const after = myMain(D2.board);
        zone(after, "library", "player-1").count = (zone(before, "library", "player-1").count || 0) + 1;
        after.gameView.events = [{ seq: 900, id: "ev-900", cardId: "engine-card-970", from: "Battlefield", to: "Library", ownerId: "player-1", cause: "ChangeZone", causeName: "Chaos Warp" }];
        seat.board = { state: after, fingerprint: null }; h.B.sendTable();
      }
      await h.flush();
      return lines().slice(mark);
    } });
  }
  add({ name: "rebuilt #7 re-test: a held reveal dies with its game", run: async (h) => {
    const seat = game(h, D2.board);
    const lines = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
    const mark = lines().length;
    h.B.onPrompt(seat, prompt("revealCards", { presentation: { title: "Chaos Warp - Revealing cards from" }, ownerPlayerId: "player-1", zone: "library", cards: [H(43)] }, { sourceCard: H(77) }));
    const next = { seats: new Map([["Blue", seat]]), bots: 1, total: 2, slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} };
    h.B._setGame(next);
    await h.flush();
    return { lines: lines().slice(mark), newLog: next.log || [] };
  } });
  add({ name: "rebuilt #4: a fix's repeated tokens counted, a before a vowel an", run: async (h) => {
    const seat = game(h, withFix(null));
    h.B.onTTS(fixMsg("Blue", "call")); await h.flush();
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush();
    const t = (script) => ({ op: "createToken", script, player: "Blue" });
    h.B.onTTS(fixMsg("Blue", "done", { ops: [t("treasure"), t("treasure"), t("treasure"), t("eldrazi spawn")] })); await h.flush();
    return h.effects.filter((e) => /Changes:/.test(e.tell?.text || e.told?.text || JSON.stringify(e))).map((e) => JSON.stringify(e).match(/Changes:[^"\\]*/)?.[0]);
  } });
  const f = myMain(D2.board);
  for (const z of f.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-75") c.text = "You may sacrifice a nontoken red creature rather than pay this spell's mana cost.\nCopy target instant or sorcery spell.";
  add(intentCase("rebuilt #18: a static alternative cost under the plain label is asked, not merged", f, prompt("chooseAction", { actions: [
    { id: "a-n", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "normal" } },
    { id: "a-alt", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "staticAlternative" } }] }), [{ kind: "play", id: "engine-card-75" }]));
  add(intentCase("rebuilt #18: the priority row says what the alternative cost is", f, prompt("chooseAction", { actions: [
    { id: "a-n", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "normal" } },
    { id: "a-alt", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "staticAlternative" } }] }), []));
  // (cleave is a second spell in a normal mode: the harness names it in the label, and the drop asks which, keyword sweep 2026-11-05)
  add(intentCase("sweep: a cleave cast is asked beside the plain one", f, prompt("chooseAction", { actions: [
    { id: "a-n", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "normal" } },
    { id: "a-cl", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur (Cleave)", mode: { type: "normal" } }] }), [{ kind: "play", id: "engine-card-75" }]));
}

// Review 2026-11-05 (docs/core-moves-cleanup-plan.md): a timeout or Cancel on a sub-question under priority (A "how do
// you play it?", B "cast it now?", C "which ability?", D "which mana?") goes back to priority and puts the card back
// (refused); the timer then passes. Before: A cast the first way, B cast Necromancy, C used the first ability, D tapped
// the first colour, and Cancel on C/D sent no refused. Also the extra-turn header read from Forge's isExtraTurn.
{
  const subActs = [
    { id: "a-cast1", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "normal" } },
    { id: "a-cast2", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur (WebSlinging)", mode: { type: "alternative", cost: "webSlinging" } },
    { id: "tap:engine-card-35:0", type: "activateAbility", cardId: "engine-card-35", isManaAbility: true, description: "Add {G}", producedMana: [{ amount: 1, color: "G" }] },
    { id: "tap:engine-card-35:1", type: "activateAbility", cardId: "engine-card-35", isManaAbility: true, description: "Add {B}", producedMana: [{ amount: 1, color: "B" }] },
    { id: "ab-fetch1", type: "activateAbility", cardId: "engine-card-64", description: "{T}, Pay 1 life, Sacrifice: Search for a Swamp or Forest card." },
    { id: "ab-fetch3", type: "activateAbility", cardId: "engine-card-64", cost: "{T}", description: "Exile target card from a graveyard." },
    { id: "a-necro", type: "cast", cardId: "engine-card-43", label: "Cast Necromancy", mode: { type: "normal" } },
  ];
  // (Necromancy outside a sorcery's time: our main phase with an opponent's Shock on the stack)
  const necroBoard = () => {
    const b = myMain(D2.board);
    b.gameView.stack = [{ id: "s1", controllerId: "player-1", identity: { name: "Shock" } }];
    for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-43") {
      c.identity.name = "Necromancy"; c.types = ["Enchantment"];
      c.text = "You may cast Necromancy as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.";
    }
    return b;
  };
  const responses = (h) => h.effects.map((e) => e.relay).filter((r) => r && r.state?.kind === "response").map((r) => r.state.action);
  const sub = (name, board, gesture, finish) => add({ name: `review askUnder: ${name}`, run: async (h) => {
    const seat = game(h, board);
    h.B.onPrompt(seat, prompt("chooseAction", { actions: subActs })); await h.flush();
    h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", ...gesture }) }); await h.flush();
    const asked = seat.prompt?.ui?.title ?? null, onTimeout = seat.prompt?.ui?.onTimeout ?? null;
    const n0 = h.effects.length;
    if (finish === "timeout") { h.B._getGame().timer = { on: true, seconds: 90 }; h.B._timerExpired(seat, seat.prompt.promptId); }
    else h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: seat.prompt.promptId, choice: [finish] }) });
    await h.flush();
    h.B._stopTimer(seat, true);
    return { asked, onTimeout, responses: responses(h), refused: h.effects.slice(n0).filter((e) => e.tts?.t === "refused").map((e) => e.tts.id),
      openAfter: seat.prompt?.ui?.title ?? null };
  } });
  sub("A timeout passes, the card goes back", myMain(D2.board), { kind: "play", id: "engine-card-75" }, "timeout");
  sub("B timeout passes, Necromancy is not cast", necroBoard(), { kind: "play", id: "engine-card-43" }, "timeout");
  sub("C timeout passes, no ability used", myMain(D2.board), { kind: "tapmana", id: "engine-card-64" }, "timeout");
  // (C and D's Cancel is an option of its own since 2026-11-06, id "__back": it was the panel's Cancel, "__cancel")
  sub("C Cancel puts the card back", myMain(D2.board), { kind: "tapmana", id: "engine-card-64" }, "__back");
  sub("D timeout passes, nothing tapped", myMain(D2.board), { kind: "tapmana", id: "engine-card-35" }, "timeout");
  sub("D Cancel puts the land back", myMain(D2.board), { kind: "tapmana", id: "engine-card-35" }, "__back");
  add({ name: "review askUnder: timeoutChoice takes a question's onTimeout, then Back", run: async (h) => {
    game(h, myMain(D2.board));
    const c = h.B._timeoutChoice;
    return [c({ mode: "single", onTimeout: "__cancel", options: [{ id: "a1" }, { id: "__cancel" }] }),
      c({ mode: "single", options: [{ id: "a1" }, { id: "a2" }, { id: "__back" }] }), c({ mode: "single", options: [{ id: "__pass" }, { id: "__back" }] })];
  } });
  // (Time Warp cast on the AI in Blue's turn 5: turn 6 is the AI's extra turn, 7 its normal one; the turn owners guess
  // had them the other way round)
  add({ name: "review trackMarks: the extra-turn header is Forge's isExtraTurn", run: async (h) => {
    const owners = { 1: "player-0", 2: "player-1", 3: "player-0", 4: "player-1", 5: "player-0", 6: "player-1", 7: "player-1" };
    game(h, D2.board, { game: { turnOwners: owners, turnsTaken: { "player-0": 3, "player-1": 4 } } });
    const gvAt = (turn, active, extra) => {
      const g = clone(D2.board.gameView);
      g.turn = turn; g.activePlayerId = active; g.step = "upkeep"; g.stack = [];
      for (const p of g.players) { if (extra === undefined) delete p.isExtraTurn; else p.isExtraTurn = p.id === active && extra; }
      return g;
    };
    const header = (a, b) => h.B.logEvents(h.B.logSnapshot(a), h.B.logSnapshot(b), b).filter((l) => l.startsWith("---"));
    return { turn6: header(gvAt(5, "player-0", false), gvAt(6, "player-1", true)), turn7: header(gvAt(6, "player-1", true), gvAt(7, "player-1", false)),
      noFieldGuess: header(gvAt(6, "player-1"), gvAt(7, "player-1")) };
  } });

  // askUnder photographs (2026-11-06, docs/core-moves-cleanup-plan.md "1. askUnder" step 1): moves made one after
  // another on one priority question (#900). After each: what the engine got (with the prompt id), which cards were put
  // back, every question sent to the panel (its id, step, title, options, Cancel flag) and what is open after.
  const view = (ui, promptId) => ({ promptId: promptId ?? null, title: ui?.title ?? null, options: (ui?.options || []).map((o) => String(o.id)), cancel: !!ui?.cancel });
  const moves = (name, board, list) => add({ name: `askUnder: ${name}`, run: async (h) => {
    const seat = game(h, board);
    h.B.onPrompt(seat, prompt("chooseAction", { actions: subActs })); await h.flush();
    const out = [];
    for (const mv of list) {
      const n0 = h.effects.length;
      if (mv === "timeout") { h.B._getGame().timer = { on: true, seconds: 90 }; h.B._timerExpired(seat, seat.prompt.promptId); }
      else if (mv.prompt) {
        // (endTurn: "End turn" holds, so the bridge passes the new question itself; promptKind: Forge's "priority" kind)
        if (mv.endTurn) seat.endTurnAt = seat.board.state.gameView.turn;
        h.B.onPrompt(seat, prompt("chooseAction", { actions: subActs }, { promptId: mv.prompt, ...(mv.promptKind ? { kind: mv.promptKind } : {}) }));
      }
      else if (mv.tts) h.B.onTTS({ t: mv.tts, json: JSON.stringify({ color: "Blue", ...mv.body }) });
      // (a board from the engine at that turn: one turn lower than the board before is a rewind, checkRestored)
      else if (mv.boardTurn != null) {
        const b = clone(seat.board.state); b.gameView.turn = mv.boardTurn;
        seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: b });
      }
      else if (mv.answerTo) h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: mv.answerTo, choice: [mv.choice] }) });
      else if (mv.answer) h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: seat.prompt?.promptId ?? 900, choice: [mv.answer] }) });
      else h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", ...mv }) });
      await h.flush();
      const fx = h.effects.slice(n0);
      out.push({ move: mv,
        responses: fx.map((e) => e.relay?.state).filter((s) => s?.kind === "response").map((s) => ({ promptId: s.promptId, action: s.action })),
        refused: fx.filter((e) => e.tts?.t === "refused").map((e) => e.tts.id),
        shown: fx.filter((e) => e.tts?.t === "prompt").map((e) => ({ ...view(e.tts, e.tts.promptId), step: e.tts.step ?? null })),
        open: seat.prompt ? view(seat.prompt.ui, seat.prompt.promptId) : null });
    }
    h.B._stopTimer(seat, true);
    return out;
  } });
  const play = (id) => ({ kind: "play", id }), tap = (id) => ({ kind: "tapmana", id }), pick = (answer) => ({ answer });
  // the way back from each sub-question, then the priority question's own answer
  moves("A Back, then Pass", myMain(D2.board), [play("engine-card-75"), pick("__back"), pick("__pass")]);
  moves("B Wait, then Pass", necroBoard(), [play("engine-card-43"), pick("__back"), pick("__pass")]);
  moves("C Cancel, then Pass", myMain(D2.board), [tap("engine-card-64"), pick("__back"), pick("__pass")]);
  moves("D Cancel, then Pass", myMain(D2.board), [tap("engine-card-35"), pick("__back"), pick("__pass")]);
  moves("E (Mana: tap X) timeout", myMain(D2.board), [pick("__mana:engine-card-35"), "timeout"]);
  moves("E (Mana: tap X) a colour", myMain(D2.board), [pick("__mana:engine-card-35"), pick("tap:engine-card-35:1")]);
  moves("E (Mana: tap X) Back, then Pass", myMain(D2.board), [pick("__mana:engine-card-35"), pick("__back"), pick("__pass")]);
  // the engine asks a new question while a sub-question is open (a reconnect asks again)
  moves("A open, the engine asks again", myMain(D2.board), [play("engine-card-75"), { prompt: 901 }]);
  moves("C open, the engine asks again", myMain(D2.board), [tap("engine-card-64"), { prompt: 901 }]);
  moves("E open, the engine asks again", myMain(D2.board), [pick("__mana:engine-card-35"), { prompt: 901 }]);
  // (jr suite 2026-11-06) the engine asking the SAME question again (#900, a relay reconnect re-sends what is pending):
  // the sub-question is closed too, its card goes back, and the priority question is asked afresh
  moves("A open, the engine asks #900 again", myMain(D2.board), [play("engine-card-75"), { prompt: 900 }, pick("__pass")]);
  // (round 4, 2026-11-06) a re-send keeps the open question's step (showPrompt): an answer that isn't an option, and
  // a reloaded table (hello, resendToTable), re-send the sub-question with its own step, not as the question under it;
  // then Back and Pass still work. Before, both re-sends had no step.
  moves("A open, a wrong answer and a reloaded table re-send it with its step", myMain(D2.board),
    [play("engine-card-75"), pick("not-an-option"), { tts: "hello", body: { again: true } }, pick("__back"), pick("__pass")]);
  // (two questions the bridge answers itself, "End turn" holding, leave seat.prompt as it was: the card goes back once)
  add({ name: "askUnder: A open, two questions passed by End turn: the card goes back once", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    h.B.onPrompt(seat, prompt("chooseAction", { actions: subActs })); await h.flush();
    h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-75" }) }); await h.flush();
    seat.endTurnAt = seat.board.state.gameView.turn;
    const n0 = h.effects.length;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: subActs }, { promptId: 901 })); await h.flush();
    h.B.onPrompt(seat, prompt("chooseAction", { actions: subActs }, { promptId: 902 })); await h.flush();
    h.B._stopTimer(seat, true);
    return { refused: h.effects.slice(n0).filter((e) => e.tts?.t === "refused").map((e) => e.tts.id),
      responses: h.effects.slice(n0).map((e) => e.relay?.state).filter((s) => s?.kind === "response").map((s) => s.promptId),
      under: seat.prompt?.under ?? null };
  } });
  // a second gesture while a sub-question is open (review 2026-11-05, "Missed")
  moves("A open, a second card dragged", myMain(D2.board), [play("engine-card-75"), play("engine-card-43")]);
  moves("A open, Q/E, Cancel, then Back", myMain(D2.board), [play("engine-card-75"), tap("engine-card-35"), pick("__back"), pick("__back")]);
  moves("A open, Q/E, then a timeout", myMain(D2.board), [play("engine-card-75"), tap("engine-card-35"), "timeout"]);
  moves("C open, a two-way card dragged", myMain(D2.board), [tap("engine-card-64"), play("engine-card-75")]);
  moves("E open, a card dragged", myMain(D2.board), [pick("__mana:engine-card-35"), play("engine-card-43")]);
  moves("E open, Q/E on a two-colour land", myMain(D2.board), [pick("__mana:engine-card-35"), tap("engine-card-35")]);
  // (review 2026-11-06) the refuse rule covers every gesture kind: a sacrifice drag (the fetch land's ability sacrifices
  // it) and an equipment drag
  moves("A open, a sacrifice drag", myMain(D2.board), [play("engine-card-75"), { kind: "sacrifice", id: "engine-card-64" }]);
  moves("A open, an attach drag", myMain(D2.board), [play("engine-card-75"), { kind: "attach", id: "engine-card-22", to: "engine-card-65" }]);
  // a sub-question closed by anything but its own answer gives its card back and leaves the panel: the engine asking
  // again with Forge's "priority" kind; End turn passing the new question (a late Back and Pass on #900 then do nothing);
  // mtg skip; auto-resolve on someone else's turn
  moves("A open, a priority-kind question", myMain(D2.board), [play("engine-card-75"), { prompt: 901, promptKind: "priority" }]);
  moves("A open, End turn passes #901, then Back and Pass on #900", myMain(D2.board),
    [play("engine-card-75"), { prompt: 901, endTurn: true }, { answerTo: 900, choice: "__back" }, { answerTo: 900, choice: "__pass" }]);
  moves("A open, mtg skip end", myMain(D2.board), [play("engine-card-75"), { tts: "skipto", body: { phase: "end" } }]);
  {
    const theirs = myMain(D2.board);
    theirs.gameView.activePlayerId = "player-1";
    theirs.gameView.stack = [{ id: "s1", controllerId: "player-1", identity: { name: "Shock" } }]; // (a stop: their spell)
    moves("A open on their turn, auto-resolve on", theirs, [play("engine-card-75"), { tts: "autoresolve", body: { on: true } }]);
  }
  // (jr suite 2026-11-06) a rewind while a sub-question is open: the card goes back and the question leaves the panel
  // (checkRestored's close; a board, not a new question, so onPrompt's close does not run). The board at turn 11 first
  // only records the turn; turn 10 then is the rewind. C (Q/E) too: its card was turned at the key press
  moves("A open, the game is rewound", myMain(D2.board), [{ boardTurn: 11 }, play("engine-card-75"), { boardTurn: 10 }, pick("__back")]);
  moves("C open, the game is rewound", myMain(D2.board), [{ boardTurn: 11 }, tap("engine-card-64"), { boardTurn: 10 }]);
  // (a board that goes forward is no rewind: the sub-question stays open, its card stays out)
  moves("A open, a board one turn later", myMain(D2.board), [{ boardTurn: 11 }, play("engine-card-75"), { boardTurn: 12 }]);
}

// Bridge batch 2026-11-05 (night)
{
  const moved = (board, id, to) => {
    const b = clone(board);
    let c = null;
    for (const z of b.gameView.zones) { const i = (z.cards || []).findIndex((x) => x.id === id); if (i >= 0) c = z.cards.splice(i, 1)[0]; }
    if (c) b.gameView.zones.find((z) => z.zone === to && z.ownerId === "player-0").cards.push(c);
    return b;
  };
  // (each prompt's engine time and message-building time go in the bridge log: tmp/slow-tail/logs.md)
  add({ name: "bridge log: a prompt says the engine's own time and its emit time", run: async (h) => {
    const seat = game(h, myMain(D2.board));
    seat.onEnvelope({ kind: "prompt", forPlayer: "player-0", engineMs: 37, emitMs: 2, prompt: prompt("chooseAction", { actions: acts }) }); await h.flush();
    seat.onEnvelope({ kind: "prompt", forPlayer: "player-0", prompt: { ...prompt("chooseAction", { actions: acts }), promptId: 901 } }); await h.flush();
    h.B._stopTimer(seat, true);
    return h.effects.filter((e) => /prompt #/.test(e.log || "")).map((e) => e.log);
  } });
  // (M5 effects, docs/m5-effects-design.md section 5: the board after a resend is a jump, the table plays no effects
  // for it; the flag goes with that one board only, and a board skipped as identical keeps it for the next)
  add({ name: "effects jump: the board after a resend says jump, the next one not", run: async (h) => {
    const seat = game(h, D2.board);
    const jumps = () => h.effects.filter((e) => e.tts?.t === "table").map((e) => e.tts.jump ?? false);
    h.B.sendTable(); await h.flush();
    h.B.onTTS({ t: "hello", json: JSON.stringify({ t: "hello", again: true }) }); await h.flush();
    const b = moved(D2.board, "engine-card-75", "battlefield");
    seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush();
    const afterResend = jumps();
    // (a board skipped as the same as the last: the flag waits for the next one that goes out)
    h.B._getGame().fxJump = true;
    h.B.sendTable(); await h.flush();
    const skipped = jumps().length === afterResend.length;
    seat.board = { state: moved(b, "engine-card-43", "battlefield"), fingerprint: null }; h.B.sendTable(); await h.flush();
    return { afterResend, skipped, all: jumps() };
  } });
  // (message size, tmp/json-decode/impact.md: a library search of more cards than the table's row holds sends each
  // picture once, in `cards`; seven or fewer keep theirs, the row shows them)
  const libCards = (n) => Array.from({ length: n }, (_, i) => ({ id: `engine-card-${7001 + i}`, identity: { name: `Library Card ${i + 1}` },
    types: ["Creature"], ownerId: "player-0", controllerId: "player-0", zone: "library", text: "" }));
  for (const n of [8, 7]) {
    add({ name: `message size: a library search of ${n} cards, pictures in options ${n > 7 ? "left out" : "kept"}`, run: async (h) => {
      const seat = game(h, myMain(D2.board));
      for (const c of libCards(n)) h.B.imgOf(c); // (the pictures known, as for a deck on the table)
      await h.flush();
      h.B.onPrompt(seat, prompt("chooseCards", { min: 0, max: 1, cards: libCards(n), presentation: { title: "Search your library for a creature card" } },
        { sourceCard: { id: "engine-card-9100", identity: { name: "Worldly Tutor" } } })); await h.flush();
      const sent = h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.librarySearch).pop()?.tts;
      return { optionPictures: (sent?.options || []).filter((o) => o.img).length, labels: (sent?.options || []).map((o) => o.label),
        cardPictures: Object.values(sent?.cards || {}).filter((c) => c.f).length, slim: (sent?.librarySearch || []).length };
    } });
  }
  // (the restore points, sent in a board only when they changed, for a table whose hello says keepRewind; a resend and
  // an older table get them in full)
  add({ name: "message size: unchanged restore points are left out, keepRewind, for a table that says so", run: async (h) => {
    const cp = (id, step) => ({ checkpointId: id, step, turn: 11 });
    const at = (points) => { const b = myMain(D2.board); b.gameView.checkpoints = points; return b; };
    const seat = game(h, at([cp(5, "main1")]));
    const boards = () => h.effects.filter((e) => e.tts?.t === "table").map((e) => ({ rewind: e.tts.rewind ? e.tts.rewind.points.map((p) => p.id) : "absent", keep: e.tts.keepRewind ?? false }));
    const send = async (b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
    h.B.onTTS({ t: "hello", json: JSON.stringify({ t: "hello", stamp: "x", keepRewind: true }) }); await h.flush();
    await send(at([cp(5, "main1")]));
    await send(moved(at([cp(5, "main1")]), "engine-card-75", "battlefield"));
    await send(moved(at([cp(6, "main2"), cp(5, "main1")]), "engine-card-75", "battlefield"));
    await send(moved(moved(at([cp(6, "main2"), cp(5, "main1")]), "engine-card-75", "battlefield"), "engine-card-43", "battlefield"));
    const told = boards();
    h.B.onTTS({ t: "hello", json: JSON.stringify({ t: "hello", stamp: "x" }) }); await h.flush();
    await send(moved(at([cp(6, "main2"), cp(5, "main1")]), "engine-card-43", "battlefield"));
    await send(moved(moved(at([cp(6, "main2"), cp(5, "main1")]), "engine-card-43", "battlefield"), "engine-card-35", "battlefield"));
    return { told, olderTable: boards().slice(told.length) };
  } });
  // Fix from hand (docs/m7-manual-fix-spec.md §12; tmp/fix-from-hand-table.md, tmp/fix-from-hand-protocol.md): the kind
  // picked on the table, Done with free plays and a note, the ops sent with slots, the lines voted on, a free play's
  // question while applying, and what the engine dropped
  {
    const wait = async (h, ms) => { setTimeout(() => {}, ms); await h.flush(); };
    const handOps = [
      { op: "move", card: "engine-card-43", zone: "graveyard" },
      { op: "freeLand", card: "engine-card-74", player: "Blue" },
      { op: "freeActivate", card: "engine-card-22", player: "Blue" },
      { op: "freeCast", card: "engine-card-75", player: "Blue" },
    ];
    const pausedFix = async (h) => {
      const seat = game(h, withFix(null));
      const send = async (m, note) => { h.effects.push({ step: note }); h.B.onTTS(m); await h.flush(); };
      await send(fixMsg("Blue", "call"), "call");
      h.B.onPrompt(seat, prompt("chooseAction", { actions: [] })); await h.flush();
      return { seat, send, g: h.B._getGame() };
    };
    const tableFix = (h) => h.effects.filter((e) => e.tts?.t === "table" && e.tts.fix).map((e) => ({ state: e.tts.fix.state, kind: e.tts.fix.kind ?? null }));
    add({ name: "fix from hand: kind, free plays and a note, applied, a dropped play said", run: async (h) => {
      const { seat, send, g } = await pausedFix(h);
      await send(fixMsg("Blue", "kind", { kind: "hand" }), "kind: hand");
      await send(fixMsg("Blue", "kind", { kind: "board" }), "a second, different kind");
      await send(fixMsg("Blue", "done", { kind: "hand", ops: handOps, notes: [{ color: "Blue", text: "  Teferi's Protection should have resolved first  " }, { color: "Nobody", text: "x" }, { color: "Blue", text: "   " }] }), "done");
      const directive = h.effects.filter((e) => e.relay?.state?.directive?.type === "applyState").map((e) => e.relay.state.directive);
      const lines = g.fix?.lines;
      // (a free play's target question while applying goes to the player as usual)
      h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { min: 1, max: 1, candidates: [{ kind: "card", id: "engine-card-192" }], presentation: { title: "Choose target creature" } }), promptId: 950 }); await h.flush();
      const asked = seat.prompt?.ui?.title ?? null;
      seat.board.state = withFix({ fixId: g.fix.applyId, applied: true, dropped: [{ index: 3, card: "engine-card-75", reason: "not played: a choice was cancelled, or there was no legal target or a cost that could be paid" }] });
      g.lastTableSig = null; h.B.sendTable(); await h.flush();
      return { directive, lines, asked, kinds: tableFix(h), fixAfter: g.fix ?? null,
        said: h.effects.filter((e) => e.tts?.t === "chat" && /Not played|chose|Manual fix applied/.test(e.tts.text)).map((e) => e.tts.text),
        log: (g.log || []).slice(-2), notesLogged: h.effects.filter((e) => /note/.test(e.log || e.appendFile && e.text || "")).length };
    } });
    add({ name: "fix from hand: free plays refused before the vote", run: async (h) => {
      const { send, g } = await pausedFix(h);
      const tries = [
        [{ op: "freeCast", card: "engine-card-22", player: "Blue" }], // (on the battlefield, not in the hand)
        [{ op: "freeLand", card: "engine-card-192", player: "Blue" }], // (an opponent's card)
        [{ op: "freeCast", card: "engine-card-75", player: "White" }], // (an AI seat)
        [{ op: "freeActivate", card: "engine-card-192", player: "Blue" }], // (an opponent's permanent)
        [{ op: "freeCast", card: "engine-card-75" }], // (no player)
      ];
      for (const ops of tries) await send(fixMsg("Blue", "done", { kind: "hand", ops }), "done");
      return { state: g.fix?.state, told: h.effects.filter((e) => e.tts?.t === "chat" && e.tts.color === "Blue").map((e) => e.tts.text).slice(-tries.length) };
    } });
    // (the 20 s watchdog counted from the apply and fired while a player was still picking a free play's target)
    add({ name: "fix from hand: the watchdog waits while a free play's question is open", run: async (h) => {
      const { seat, send, g } = await pausedFix(h);
      await send(fixMsg("Blue", "done", { kind: "hand", ops: handOps.slice(3) }), "done");
      const at = [];
      const check = async (note) => { h.B.fixWatchdog(); await h.flush(); at.push(`${note}: ${g.fix?.state ?? "over"}`); };
      await wait(h, 5000);
      h.B.onPrompt(seat, { ...prompt("chooseBoardTargets", { min: 1, max: 1, candidates: [{ kind: "card", id: "engine-card-192" }], presentation: { title: "Choose target creature" } }), promptId: 950 }); await h.flush();
      await wait(h, 35000); await check("40 s, the target question open");
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 950, choice: ["card|engine-card-192"] }) }); await h.flush();
      await wait(h, 15000); await check("15 s after the answer");
      await wait(h, 6000); await check("21 s after the answer, nothing open");
      // (control: an apply with no question at all is still given up after 20 s)
      g.fix = null;
      const b = await (async () => { await send(fixMsg("Blue", "call"), "call again"); h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: [] }), promptId: 960 }); await h.flush(); })();
      void b;
      await send(fixMsg("Blue", "done", { kind: "hand", ops: handOps.slice(3) }), "done again");
      await wait(h, 21000); await check("control: 21 s, no question");
      return at;
    } });
    // (a turn timer runs for a free play's question, as for any other: the game is the engine's again while it applies;
    // in the other fix states every clock waits)
    add({ name: "fix from hand: a free play's question is timed", run: async (h) => {
      const { seat, send, g } = await pausedFix(h);
      g.timer = { on: true, seconds: 90 };
      await send(fixMsg("Blue", "done", { kind: "hand", ops: handOps.slice(3) }), "done");
      h.B.onPrompt(seat, { ...prompt("chooseBoolean", { presentation: { title: "Pay the kicker?" } }), promptId: 950 }); await h.flush();
      h.B._timerExpired(seat, 950); await h.flush();
      const answered = seat.prompt?.promptId ?? null;
      h.B._stopTimer(seat, true);
      return { answered, sent: h.effects.map((e) => e.relay).filter((r) => r && r.state?.kind === "response").map((r) => r.state.action) };
    } });
    // (a fix of a free land only: the engine's next question is a priority one with an empty stack, and it can be read
    // before the board that ends the fix (that board waits for scheduleTable): it is held, then asked once the fix ends)
    add({ name: "fix from hand: an empty-stack question during the apply reaches the player once the fix ends", run: async (h) => {
      const { seat, send, g } = await pausedFix(h);
      await send(fixMsg("Blue", "done", { kind: "hand", ops: [handOps[1]] }), "done");
      seat.board.state = withFix({ fixId: g.fix.applyId, applied: true });
      h.B.onPrompt(seat, { ...prompt("chooseAction", { actions: [] }), promptId: 970 });
      const during = { state: g.fix?.state ?? null, open: seat.prompt?.promptId ?? null };
      g.lastTableSig = null; h.B.sendTable(); await h.flush();
      // (with nothing to do it is passed: the pass is the sign it was asked)
      return { during, after: { fix: g.fix ?? null, open: seat.prompt?.promptId ?? null },
        answered: h.effects.filter((e) => e.relay?.state?.kind === "response" && e.relay.state.promptId === 970).map((e) => e.relay.state.action) };
    } });
    // (Done says the kind when the bridge has none: the table's own pick, from before a bridge restart. A hand card to the
    // graveyard is worded as a fix from hand's, and the kind is kept for the rest of the fix)
    add({ name: "fix from hand: Done's own kind, when no kind was picked through the bridge", run: async (h) => {
      const { send, g } = await pausedFix(h);
      await send(fixMsg("Blue", "done", { kind: "hand", ops: [handOps[0]] }), "done, kind hand");
      return { lines: g.fix?.lines ?? null, kind: g.fix?.kind ?? null };
    } });
    // (two players, a board fix: a face-down card in exile shows only on its owner's board, and a hidden entry on the
    // caller's; the change is worded from the board that shows it)
    add({ name: "board fix: a card the caller's board shows hidden is worded from the board that shows it", run: async (h) => {
      const { seat, send, g } = await pausedFix(h);
      const white = new h.B.Seat("White", "neheb_minotaur_commander");
      white.slot = "player-1";
      const wb = withFix(null);
      const foretold = { ...H(75), id: "engine-card-302", ownerId: "player-1", controllerId: "player-1", isFaceDown: true, identity: { ...H(75).identity, name: "Saw It Coming" } };
      for (const z of wb.gameView.zones) if (z.zone === "exile" && z.ownerId === "player-1") z.cards = [foretold];
      for (const z of seat.board.state.gameView.zones) if (z.zone === "exile" && z.ownerId === "player-1") z.cards = [{ visibility: "hidden", id: "engine-card-302" }];
      white.board = { state: wb, fingerprint: null };
      g.seats.set("White", white);
      g.slotNames["player-1"] = "White";
      await send(fixMsg("Blue", "kind", { kind: "board" }), "kind: board");
      await send(fixMsg("Blue", "done", { kind: "board", ops: [{ op: "move", card: "engine-card-302", zone: "hand" }] }), "done");
      return { state: g.fix?.state ?? null, lines: g.fix?.lines ?? null };
    } });
    // (two players at the table: each board shows only its own seat's hand, so White's pick is checked and worded from
    // White's board when Blue presses Done; it was "No such card" from Blue's)
    add({ name: "fix from hand: picks from two players' hands, Done pressed by one of them", run: async (h) => {
      const { seat, send, g } = await pausedFix(h);
      const white = new h.B.Seat("White", "neheb_minotaur_commander");
      white.slot = "player-1";
      const wb = withFix(null);
      const counter = { ...H(75), id: "engine-card-301", ownerId: "player-1", controllerId: "player-1", identity: { ...H(75).identity, name: "Counterspell" } };
      for (const z of wb.gameView.zones) {
        if (z.zone === "hand" && z.ownerId === "player-0") z.cards = [];
        if (z.zone === "hand" && z.ownerId === "player-1") z.cards = [counter];
      }
      white.board = { state: wb, fingerprint: null };
      g.seats.set("White", white);
      g.slotNames["player-1"] = "White";
      await send(fixMsg("White", "kind", { kind: "hand" }), "kind: hand, by White");
      // (White's card as Blue's free play: refused, a card is played only from its owner's hand)
      await send(fixMsg("Blue", "done", { kind: "hand", ops: [{ op: "freeCast", card: "engine-card-301", player: "Blue" }] }), "done: White's card for Blue");
      const refusedFirst = g.fix?.state ?? null;
      await send(fixMsg("Blue", "done", { kind: "hand", ops: [{ op: "freeCast", card: "engine-card-75", player: "Blue" }, { op: "freeCast", card: "engine-card-301", player: "White" }] }), "done, by Blue");
      const review = { refusedFirst, state: g.fix?.state ?? null, lines: g.fix?.lines ?? null, waiting: g.fix?.waiting ?? null };
      // (a kind picked during the vote: refused, the game isn't paused for one then)
      await send(fixMsg("White", "kind", { kind: "board" }), "kind during the vote");
      review.kindAfter = g.fix?.kind ?? null;
      await send(fixMsg("White", "vote", { accept: true }), "White agrees");
      const directive = h.effects.filter((e) => e.relay?.state?.directive?.type === "applyState").map((e) => e.relay.state.directive);
      // (the engine dropped White's play: said by the name only White's board shows)
      seat.board.state = withFix({ fixId: g.fix?.applyId, applied: true, dropped: [{ index: 1, card: "engine-card-301", reason: "not played: a choice was cancelled, or there was no legal target or a cost that could be paid" }] });
      white.board.state = { ...wb, gameView: { ...wb.gameView, stateFix: seat.board.state.gameView.stateFix } };
      g.lastTableSig = null; h.B.sendTable(); await h.flush();
      return { review, directive, fixAfter: g.fix ?? null,
        said: h.effects.filter((e) => e.tts?.t === "chat" && /Not played|Changes|No such card|isn't in/.test(e.tts.text)).map((e) => e.tts.text) };
    } });
  }
}

// trackMarks photographs (2026-11-06, docs/core-moves-cleanup-plan.md "2. trackMarks" step 1): the marks under each
// player's life total as the table's player rows carry them, and the log lines when each one changes.
{
  const logLines = (h) => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines);
  const boardAs = async (h, seat, b) => { seat.board = { state: b, fingerprint: null }; h.B.sendTable(); await h.flush(); };
  // (each mark field a row has, with its value; a field the row leaves out is left out here too)
  const MARK_FIELDS = ["poison", "energy", "monarch", "initiative", "blessed", "story", "marks", "allMarks"];
  const rows = (h) => (h.effects.filter((e) => e.tts && e.tts.t === "table").pop()?.tts.players || [])
    .map((p) => ({ c: p.color, ...Object.fromEntries(MARK_FIELDS.filter((k) => k in p).map((k) => [k, p[k]])) }));
  const pl = (b, id) => b.gameView.players.find((p) => p.id === id);
  // (a dungeon in Blue's command zone, in the room Forge's note names)
  const inRoom = (b, room) => {
    const cz = b.gameView.zones.find((z) => z.zone === "command" && z.ownerId === "player-0");
    cz.cards = cz.cards.filter((c) => c.id !== "engine-card-310");
    if (room) cz.cards.push({ id: "engine-card-310", identity: { name: "Lost Mine of Phandelver" }, types: ["Dungeon"], ownerId: "player-0", controllerId: "player-0", text: `[Room: ${room}]` });
    return b;
  };
  // every mark set: Blue with the upper-case counters, White with the lower-case ones (Forge may spell them either way)
  const everyMark = () => {
    const b = myMain(D2.board);
    Object.assign(pl(b, "player-0"), { counters: { POISON: 3, ENERGY: 2, EXPERIENCE: 2, RADIATION: 1, TICKET: 4 }, hasCityBlessing: true, hasEnduringStory: true,
      ringLevel: 3, speed: 2, controlledBy: "player-1", isExtraTurn: true, damagePrevention: 1, maxHandSize: 5, playerKeywords: ["Hexproof"] });
    Object.assign(pl(b, "player-1"), { counters: { poison: 1, energy: 5, experience: 1 }, hasCityBlessing: true, hasEnduringStory: true,
      ringLevel: 1, speed: 1, isExtraTurn: true, unlimitedHandSize: true, playerKeywords: ["You can't lose the game."] });
    b.gameView.monarchId = "player-0"; b.gameView.initiativeHolderId = "player-1";
    return b;
  };
  add({ name: "trackMarks: every mark on both players' rows", run: async (h) => {
    const b = everyMark();
    const seat = game(h, b);
    await boardAs(h, seat, b);
    const all = rows(h);
    // (the monarch and the initiative change hands; Blue's poison and blessing gone, White's energy at 0)
    const swapped = clone(b); swapped.gameView.monarchId = "player-1"; swapped.gameView.initiativeHolderId = "player-0";
    pl(swapped, "player-0").counters.POISON = 0; pl(swapped, "player-0").hasCityBlessing = false; pl(swapped, "player-1").counters.energy = 0;
    await boardAs(h, seat, swapped);
    const changed = rows(h);
    // (and none at all)
    const none = myMain(D2.board);
    await boardAs(h, seat, none);
    return { all, changed, none: rows(h) };
  } });
  // the log, board by board: everything changes on one board (with a dungeon room), then changes back and on, then the
  // same board again, then the monarch and the initiative held by nobody
  add({ name: "trackMarks: every mark changes on one board (the log)", run: async (h) => {
    const start = inRoom(myMain(D2.board), "Cave Entrance");
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const boards = [];
    const step = async (b) => { const n = logLines(h).length; await boardAs(h, seat, b); boards.push(logLines(h).slice(n)); };
    const b1 = inRoom(clone(start), "Goblin Lair");
    for (const [id, n] of [["player-0", [2, 3]], ["player-1", [1, 1]]]) Object.assign(pl(b1, id), { counters: { POISON: n[0], ENERGY: n[1] }, hasCityBlessing: true, hasEnduringStory: true });
    b1.gameView.monarchId = "player-0"; b1.gameView.initiativeHolderId = "player-1";
    await step(b1);
    const b2 = inRoom(clone(b1), "Temple of Dumathoin");
    pl(b2, "player-0").counters = { POISON: 1, ENERGY: 1 }; pl(b2, "player-0").hasCityBlessing = false;
    pl(b2, "player-1").counters = { POISON: 4, ENERGY: 1 };
    b2.gameView.monarchId = "player-1"; b2.gameView.initiativeHolderId = "player-0";
    await step(b2);
    await step(clone(b2));
    const b3 = clone(b2); delete b3.gameView.monarchId; delete b3.gameView.initiativeHolderId;
    await step(b3);
    // (energy alone back up, and a room alone)
    const b4 = clone(b3); pl(b4, "player-1").counters.ENERGY = 6;
    await step(b4);
    await step(inRoom(clone(b4), "Mine Tunnels"));
    return boards;
  } });
  // a game whose first board already has every mark says nothing about them; the next change is said
  add({ name: "trackMarks: the first board's marks are not said", run: async (h) => {
    const b = everyMark();
    const seat = game(h, b);
    const boards = [];
    const step = async (x) => { const n = logLines(h).length; await boardAs(h, seat, x); boards.push(logLines(h).slice(n)); };
    await step(b);
    await step(clone(b));
    const more = clone(b); pl(more, "player-1").counters.energy = 7;
    await step(more);
    return boards;
  } });
  // the log between two boards made by hand: a mark the earlier board has no record of (no player row then)
  add({ name: "trackMarks: logEvents with a player the earlier board did not have", run: async (h) => {
    const b = everyMark();
    game(h, b);
    const before = clone(b); before.gameView.players = before.gameView.players.filter((p) => p.id === "player-0");
    return h.B.logEvents(h.B.logSnapshot(before.gameView), h.B.logSnapshot(b.gameView), b.gameView).filter((l) => !l.startsWith("---"));
  } });
  // the text board (a game the table does not draw): its player rows carry poison only
  add({ name: "trackMarks: the text board's player rows", run: async (h) => {
    const b = everyMark();
    const seat = game(h, b, { game: { fromTable: false } });
    seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(b), fingerprint: "f1" });
    await h.flush();
    return (h.effects.filter((e) => e.tts && e.tts.t === "view").pop()?.tts.view.players || []).map((p) => ({ name: p.name, poison: p.poison, marks: p.marks ?? null }));
  } });
  // (round 2, review 2026-11-06) Time Warp on yourself: Forge sets isExtraTurn on the new active player at each turn
  // start and leaves it on the others, so Blue's flag is still set in the AI's turn 7. The header says "(extra turn)"
  // and the label EXTRA TURN only on turn 6, Blue's extra turn.
  add({ name: "trackMarks: Time Warp on yourself, the flag stays on in the next player's turn", run: async (h) => {
    const at = (turn, active, blueFlag) => {
      const b = clone(D2.board);
      Object.assign(b.gameView, { turn, activePlayerId: active, priorityPlayerId: active, step: "upkeep", stack: [] });
      pl(b, "player-0").isExtraTurn = blueFlag; pl(b, "player-1").isExtraTurn = false;
      return b;
    };
    const first = at(5, "player-0", false);
    const seat = game(h, first);
    await boardAs(h, seat, first);
    const out = [];
    for (const [turn, active, flag] of [[6, "player-0", true], [7, "player-1", true], [8, "player-0", false]]) {
      const n = logLines(h).length;
      await boardAs(h, seat, at(turn, active, flag));
      out.push({ turn, headers: logLines(h).slice(n).filter((l) => l.startsWith("---")), labels: rows(h).map((r) => [r.c, r.allMarks || []]) });
    }
    return out;
  } });
  // (round 2) a player counter shows only as a positive number: "0", true, "x" or -1 show nothing (as the table's own
  // poison and energy did), 2 shows
  add({ name: "trackMarks: a counter that isn't a positive number shows nothing", run: async (h) => {
    const b = myMain(D2.board);
    pl(b, "player-0").counters = { POISON: "0", ENERGY: true, EXPERIENCE: -1, RADIATION: "x", TICKET: 2 };
    pl(b, "player-1").counters = { poison: -2, energy: 3 };
    const seat = game(h, b);
    await boardAs(h, seat, b);
    return rows(h);
  } });
  // (jr suite 2026-11-06) the Ring, speed and prevention follow the same rule as the counters: a positive number only
  // ("3", true and -1 show nothing; before, "3" and true showed, "RING TEMPTED true"); and a controller that isn't a
  // known seat's id, even one that isn't text, is named as it is and the board still goes out
  add({ name: "trackMarks: the Ring, speed, prevention and a controller that aren't plain", run: async (h) => {
    const b = myMain(D2.board);
    Object.assign(pl(b, "player-0"), { ringLevel: "3", speed: true, damagePrevention: -1, controlledBy: 5 });
    Object.assign(pl(b, "player-1"), { ringLevel: 2, speed: 1, damagePrevention: 4, controlledBy: "player-9" });
    const seat = game(h, b);
    await boardAs(h, seat, b);
    return rows(h);
  } });
  // (step 7, 2026-11-06) the log says the Ring, speed and a turn run by another player, board by board (Forge's fields
  // ringLevel, speed, controlledBy: InteractiveSnapshotExtractor). The Ring once, twice at once, then a count that went
  // down (said nothing); speed from 0, up, to 4, down, to 0 (said nothing); control taken, then given back
  add({ name: "trackMarks: the Ring, speed and a turn run by another player in the log", run: async (h) => {
    const start = myMain(D2.board);
    const seat = game(h, start);
    await boardAs(h, seat, start);
    const boards = [];
    let b = start;
    const step = async (blue, ai) => {
      b = clone(b); Object.assign(pl(b, "player-0"), blue); Object.assign(pl(b, "player-1"), ai);
      const n = logLines(h).length; await boardAs(h, seat, b); boards.push(logLines(h).slice(n));
    };
    await step({ ringLevel: 1 }, { speed: 1 });
    await step({ ringLevel: 3 }, { speed: 2 });
    await step({}, {});
    await step({ controlledBy: "player-1" }, { speed: 4 });
    await step({ ringLevel: 2, controlledBy: null }, { speed: 3 });
    await step({}, { speed: 0 });
    return { boards, labels: rows(h).map((r) => [r.c, r.allMarks || []]) };
  } });
  // (step 7; jr suite 2026-11-06, Forge's order) Mindslaver: Forge hands Blue's turn to the AI as the turn passes to
  // Blue (PhaseHandler's cleanup end: the next player first, then ControlPlayerEffect's addController), so the first
  // board under control is Blue's turn 6, and gives it back as the turn passes on after Blue's cleanup. Mid-turn, a
  // spell on the stack keeps it a turn's control. The control lines, the labels and the turn headers in order
  const ctlAt = (turn, active, step, ctl, stack = []) => {
    const b = clone(D2.board);
    Object.assign(b.gameView, { turn, activePlayerId: active, priorityPlayerId: active, step, stack: clone(stack).map(({ zone, ...s }) => s) });
    // (each item's source card where it is while the item resolves: a fetch land sacrificed; Blue's Phyrexian Arena,
    // whose upkeep trigger UPKEEP is, on every board)
    const put = (zone, owner, id, name, types, text) => b.gameView.zones.find((z) => z.zone === zone && z.ownerId === owner).cards
      .push({ id, identity: { name }, types, ownerId: owner, controllerId: owner, text });
    put("battlefield", "player-0", "engine-card-976", "Phyrexian Arena", ["Enchantment"], "At the beginning of your upkeep, you draw a card and you lose 1 life.");
    for (const s of stack) if (s.zone === "graveyard") put("graveyard", s.controllerId, s.sourceId, s.identity.name, ["Land"], s.sourceAbilityText);
    for (const [id, by] of Object.entries(ctl || {})) pl(b, id).controlledBy = by;
    return b;
  };
  const ctlRun = async (h, first, boards) => {
    const seat = game(h, first, { game: { turnOwners: { 1: "player-1", 2: "player-0", 3: "player-1", 4: "player-0" } } });
    await boardAs(h, seat, first);
    const out = [];
    for (const [turn, active, step, ctl, stack] of boards) {
      const n = logLines(h).length;
      await boardAs(h, seat, ctlAt(turn, active, step, ctl, stack));
      out.push({ turn, step, lines: logLines(h).slice(n), labels: rows(h).map((r) => [r.c, r.allMarks || []]) });
    }
    return out;
  };
  // (a fetch land's ability on the stack, as Forge keeps it there while it resolves; the search is what Opposition
  // Agent takes over)
  const FETCH = (ctl) => [{ zone: "graveyard", id: "stack-agent-1", sourceId: "engine-card-975", controllerId: ctl, ownerId: ctl, identity: { name: "Polluted Delta" },
    text: "Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.", isTrigger: false, isPermanentSpell: false, targets: [],
    sourceAbilityText: "{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle." }];
  const UPKEEP = (ctl) => [{ id: "stack-upkeep-1", sourceId: "engine-card-976", controllerId: ctl, ownerId: ctl, identity: { name: "Phyrexian Arena" },
    text: "You draw a card and you lose 1 life.", isTrigger: true, isPermanentSpell: false, targets: [],
    sourceAbilityText: "At the beginning of your upkeep, you draw a card and you lose 1 life." }];
  add({ name: "trackMarks: Mindslaver, the turn run by another player and the headers", run: async (h) => ctlRun(h, ctlAt(5, "player-1", "main2"), [
    [5, "player-1", "cleanup", null], [6, "player-0", "upkeep", { "player-0": "player-1" }], [6, "player-0", "main1", { "player-0": "player-1" }, FETCH("player-0")],
    [6, "player-0", "cleanup", { "player-0": "player-1" }], [7, "player-1", "upkeep", null]]) });
  // (verifier finding 1, 2026-11-06) Forge also hands a player over for a moment, on any player's turn: Opposition
  // Agent's "control while searching" (ChangeZoneEffect:1075) and a spell cast under another's control (PlayEffect,
  // MagicStack.resolveStack), only while an ability resolves, so with it on the stack. That is no turn run by another
  // player: "Blue controls AI 1 for now", the label CONTROLLED BY BLUE. Blue holds Opposition Agent; AI 1 cracks a
  // fetch land in its own main phase, then in Blue's turn
  add({ name: "trackMarks: Opposition Agent, a search controlled on either player's turn", run: async (h) => ctlRun(h, ctlAt(5, "player-1", "main1"), [
    [5, "player-1", "main1", { "player-1": "player-0" }, FETCH("player-1")], [5, "player-1", "main1", null],
    [6, "player-0", "main1", { "player-1": "player-0" }, FETCH("player-1")], [6, "player-0", "main1", null]]) });
  // (the same, where the turn passes: the first board of AI 1's turn is the search, an upkeep trigger's, so it begins
  // with the turn; and a search in its end step whose control is gone only on the next turn's board. Neither is a turn's)
  add({ name: "trackMarks: Opposition Agent, a search controlled as a turn begins and ends", run: async (h) => ctlRun(h, ctlAt(4, "player-0", "main2"), [
    [5, "player-1", "upkeep", { "player-1": "player-0" }, FETCH("player-1")], [5, "player-1", "draw", null],
    [5, "player-1", "end", { "player-1": "player-0" }, FETCH("player-1")], [6, "player-0", "upkeep", null]]) });
  // (and Mindslaver whose first board under control has an upkeep trigger on the stack: said plainly then, a turn's once
  // a board shows it with the stack empty, and its end said as a turn's)
  add({ name: "trackMarks: Mindslaver seen first with a trigger on the stack", run: async (h) => ctlRun(h, ctlAt(5, "player-1", "main2"), [
    [6, "player-0", "upkeep", { "player-0": "player-1" }, UPKEEP("player-0")], [6, "player-0", "draw", { "player-0": "player-1" }],
    [7, "player-1", "upkeep", null]]) });
  // (step 7) the plan's case: four players, Blue casts Time Warp on AI 1 in its turn 5. Turn 6 is AI 1's extra turn,
  // turn 7 its normal one (Forge's flag, set at each turn start), turn 8 AI 2's. The guess from turn order had turns 6
  // and 7 the other way round; a board without the flag is a plain turn
  add({ name: "trackMarks: Time Warp on another player, four players, the headers", run: async (h) => {
    const ids = ["player-0", "player-1", "player-2", "player-3"];
    const at = (turn, active, flag) => {
      const b = clone(D2.board);
      const ai = pl(b, "player-1");
      b.gameView.players = [pl(b, "player-0"), ai, { ...clone(ai), id: "player-2" }, { ...clone(ai), id: "player-3" }];
      Object.assign(b.gameView, { turn, activePlayerId: active, priorityPlayerId: active, step: "upkeep", stack: [] });
      for (const p of b.gameView.players) { if (flag === undefined) delete p.isExtraTurn; else p.isExtraTurn = p.id === active && flag; }
      return b;
    };
    const first = at(5, "player-0", false);
    const seat = game(h, first, { game: { total: 4, bots: 3, slotNames: { "player-0": "Blue", "player-1": "AI 1", "player-2": "AI 2", "player-3": "AI 3" },
      slotColor: { "player-0": "Blue", "player-1": "White", "player-2": "Red", "player-3": "Yellow" }, turnOwners: { 1: ids[0], 2: ids[1], 3: ids[2], 4: ids[3] } } });
    await boardAs(h, seat, first);
    const out = [];
    for (const [turn, active, flag] of [[6, ids[1], true], [7, ids[1], false], [8, ids[2], false], [9, ids[3], undefined], [10, ids[3], undefined]]) {
      const n = logLines(h).length;
      await boardAs(h, seat, at(turn, active, flag));
      out.push({ turn, headers: logLines(h).slice(n).filter((l) => l.startsWith("---")), labels: rows(h).filter((r) => (r.allMarks || []).length).map((r) => [r.c, r.allMarks]) });
    }
    return out;
  } });
}

module.exports = cases;
