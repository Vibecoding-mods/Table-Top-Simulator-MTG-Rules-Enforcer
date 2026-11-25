// Sacrifice X for mana (bridge.js sacGroups, sacPicker, sacStart, sacRunStep; the user, 2026-11-18: "For things that can
// be sacrificed for mana like creatures or treasures that repeat do sac x for mana"). The engine's actions as our Forge
// build sends them (ManaBrewInteractiveSession publishManaPaymentPrompt / publishPriorityPrompt): a payment's
// { type: "activateManaAbility", id: "tap:<card>:<mana ability>:<colour>", description: <card name>, cost }, a
// priority's { type: "activateAbility", id: "tap:<card>:<question position>:<colour>", description: <ability text>,
// isManaAbility, cost }, Treasure's cost "{T}, Sacrifice this token" (tests/golden/fixtures/scenario-checks.json). The checks:
//  - paying: 2+ alike Treasures get one "Sacrifice X Treasure Token for mana (1 to N)" before the taps, N = what the
//    cost still takes; one Treasure, a cost of one mana, other names and another card's sacrifice get none
//  - the colour asked once (the cost's colours first, "(needed)"), then how many; one colour (Eldrazi Spawn's {C}) asks
//    only how many; a colour that can pay only one sacrifices one at once
//  - the run: the first answers the question, the next ones the payments that follow, unseen; each "Sacrifice Treasure
//    Token?" is answered; the pool pays the rest; a card gone ends it, said once
//  - priority: "Mana: sacrifice X Treasure Token (1 to N)" before the cards' own Mana: buttons, on the first on the board;
//    the run goes on through the priority questions that follow; more than six: ×1-×5, all, and How many…
//  - Back returns to the question under it; a "choose a color" of the card just used takes the run's colour; a rewind
//    forgets the run
//  - (review of 58e810e) a yes/no or colour question the run doesn't answer, or a second "Sacrifice ...?" for the same
//    card, goes to the player and ends the run, said once; the card just used offered again (the engine didn't take
//    it) ends the run, said once, paying and at priority
//   node tests/test_bridge_sac_x_mana.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };

const TREASURE_TEXT = "{T}, Sacrifice this token: Add one mana of any color.";
const SPAWN_TEXT = "Sacrifice this creature: Add {C}.";
const COLOURS = ["W", "U", "B", "R", "G"];
const card = (id, name, text, types = ["Artifact"], token = true) => ({ id, identity: { name, isToken: token }, types, ownerId: "player-0", controllerId: "player-0", text });
const treasure = (n) => card(`engine-card-${n}`, "Treasure Token", TREASURE_TEXT);
const swamp = card("engine-card-40", "Swamp", "({T}: Add {B}.)", ["Land"], false);
// a payment's actions for one card, one per colour, as publishManaPaymentPrompt sends them
const payActs = (c, cost = "{T}, Sacrifice this token", cols = COLOURS) => cols.map((col) => ({ type: "activateManaAbility", id: `tap:${c.id}:0:${col}`, cardId: c.id, abilityIndex: 0,
  description: c.identity.name, isManaAbility: true, isClassLevelUp: false, cost, producedMana: [{ color: col, amount: 1 }] }));
const swampAct = { type: "activateManaAbility", id: `tap:${swamp.id}:0`, cardId: swamp.id, abilityIndex: 0, description: "Swamp", isManaAbility: true, isClassLevelUp: false, cost: "{T}", producedMana: [{ color: "B", amount: 1 }] };
// a priority's mana actions: the index is the action's position in the question, so it shifts between questions
const prioActs = (cards, from = 3, text = TREASURE_TEXT, cost = "{T}, Sacrifice this token", cols = COLOURS) => cards.flatMap((c, k) => cols.map((col) => ({ type: "activateAbility",
  id: `tap:${c.id}:${from + k}:${col}`, cardId: c.id, abilityIndex: from + k, description: text, isManaAbility: true, isClassLevelUp: false, cost, producedMana: [{ color: col, amount: 1 }] })));

function setup(h, battlefield, pool = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: { turn: 4, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
    zones: [{ zone: "battlefield", ownerId: "player-0", cards: battlefield }, { zone: "hand", ownerId: "player-0", cards: [] }],
    players: [{ id: "player-0", manaPool: pool }, { id: "player-1", manaPool: {} }] } }, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  const calls = [];
  const respond = seat.respond.bind(seat);
  seat.respond = (promptId, type, out) => { calls.push({ promptId, type, out }); return respond(promptId, type, out); };
  return { seat, calls };
}
const pay = (id, cost, actions, extra = {}) => ({ promptId: id, decidingPlayerId: "player-0",
  input: { type: "payManaCost", manaCost: cost, cardName: "Phyrexian Obliterator", cardId: "engine-card-75", actions, presentation: { title: `Pay ${cost}` }, ...extra } });
// (with a spell to cast: a main phase whose only actions are mana abilities is passed for the player, as before)
const priority = (id, actions) => ({ promptId: id, decidingPlayerId: "player-0", input: { type: "chooseAction",
  actions: [...actions, { type: "cast", id: "prompt-action-9", cardId: "engine-card-715", mode: { type: "normal" }, label: "Cast Delver of Secrets" }] } });
const confirmSac = (id, c) => ({ promptId: id, decidingPlayerId: "player-0", sourceCard: { id: c.id, identity: { name: c.identity.name } },
  input: { type: "chooseBoolean", confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: `Sacrifice ${c.identity.name}?`, targets: [] } } });
const answer = async (h, promptId, choice) => { h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId, choice: [choice] }) }); await h.flush(); };
const shown = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "prompt" && e.tts.promptId != null).map((e) => e.tts);
const chats = (h, mark = 0) => h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const ids = (p) => (p?.options || []).map((o) => o.id).join(",");
const labels = (p) => (p?.options || []).map((o) => o.label).join(" | ");
const opt = (p, id) => (p?.options || []).find((o) => o.id === id);

(async () => {
  // 1. paying {2}{B} with three Treasures and a Swamp: the option, where it is, what it says
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92), treasure(93)];
    const { seat } = setup(h, [swamp, ...t]);
    h.B.onPrompt(seat, pay(600, "{2}{B}", [swampAct, ...t.flatMap((c) => payActs(c))])); await h.flush();
    const p = shown(h).pop();
    const o = opt(p, "__sacx:g0");
    ok("paying: one Sacrifice X option for the three", o?.label === "Sacrifice X Treasure Token for mana (1 to 3)", labels(p));
    ok("paying: it comes after Auto-pay and before the taps", p?.options[1]?.id === "__sacx:g0" && p.options[0].id === "__auto" && p.options[2].id === swampAct.id, ids(p));
    ok("paying: it sits on the first Treasure on the board", o?.cardId === "engine-card-91", o?.cardId);
    ok("paying: it ranks as a needed colour", o?.rank === 2, o?.rank);
    ok("paying: the Treasures' own taps are still offered", (p?.options || []).filter((x) => String(x.id).startsWith("tap:engine-card-9")).length === 15, ids(p));
    harness.restore();
  }
  // 2. the colour, then how many, then the run through the payments that follow
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92), treasure(93)];
    const { seat, calls } = setup(h, [swamp, ...t]);
    h.B.onPrompt(seat, pay(600, "{2}{B}", [swampAct, ...t.flatMap((c) => payActs(c))])); await h.flush();
    await answer(h, 600, "__sacx:g0");
    const col = seat.prompt?.ui;
    ok("colour: asked once, the cost's colour first and marked", col?.title === "Treasure Token: sacrifice them for which mana?" && col.options[0].id === "__sacx:c:B" && col.options[0].label === "{B} (needed)", `${col?.title} ${labels(col)}`);
    ok("colour: every colour the Treasures make, then Back", ids(col) === "__sacx:c:B,__sacx:c:W,__sacx:c:U,__sacx:c:R,__sacx:c:G,__back", ids(col));
    ok("colour: it says what is still owed", /^\{2\}\{B\} still to pay\. /.test(col?.text || ""), col?.text);
    ok("colour: nothing answered yet", calls.length === 0, JSON.stringify(calls));
    await answer(h, 600, "__sacx:c:B");
    const cnt = seat.prompt?.ui;
    ok("how many: 1 to 3 (all three), and Back", ids(cnt) === "__sacx:1,__sacx:2,__sacx:3,__back" && labels(cnt) === "×1 | ×2 | ×3 (all) | Back", labels(cnt));
    ok("how many: titled by the card and the colour", cnt?.title === "Treasure Token: sacrifice how many for {B}?", cnt?.title);
    ok("how many: nothing answered yet", calls.length === 0, JSON.stringify(calls));
    await answer(h, 600, "__sacx:3");
    ok("run: the first Treasure on the board is sacrificed for {B}", calls.length === 1 && calls[0].promptId === 600 && calls[0].out.type === "act" && calls[0].out.actionId === "tap:engine-card-91:0:B", JSON.stringify(calls));
    ok("run: two are left", JSON.stringify(seat.sacRun?.left) === JSON.stringify(["engine-card-92", "engine-card-93"]), JSON.stringify(seat.sacRun));
    // Forge confirms each sacrifice
    const mark = h.effects.length;
    h.B.onPrompt(seat, confirmSac(601, t[0])); await h.flush();
    ok("run: Forge's Sacrifice Treasure Token? is answered yes", calls.length === 2 && calls[1].promptId === 601 && calls[1].out.value === true, JSON.stringify(calls.slice(1)));
    seat.board.state.gameView.zones[0].cards = [swamp, t[1], t[2]];
    seat.board.state.gameView.players[0].manaPool = { B: 1 };
    h.B.onPrompt(seat, pay(602, "{2}{B}", [swampAct, ...t.slice(1).flatMap((c) => payActs(c))])); await h.flush();
    ok("run: the second, unseen, on the next payment", calls.length === 3 && calls[2].promptId === 602 && calls[2].out.actionId === "tap:engine-card-92:0:B", JSON.stringify(calls.slice(2)));
    h.B.onPrompt(seat, confirmSac(603, t[1])); await h.flush();
    seat.board.state.gameView.zones[0].cards = [swamp, t[2]];
    seat.board.state.gameView.players[0].manaPool = { B: 2 };
    h.B.onPrompt(seat, pay(604, "{2}{B}", [swampAct, ...payActs(t[2])])); await h.flush();
    ok("run: and the third", calls.length === 5 && calls[4].promptId === 604 && calls[4].out.actionId === "tap:engine-card-93:0:B", JSON.stringify(calls.slice(3)));
    h.B.onPrompt(seat, confirmSac(605, t[2])); await h.flush();
    seat.board.state.gameView.zones[0].cards = [swamp];
    seat.board.state.gameView.players[0].manaPool = { B: 3 };
    h.B.onPrompt(seat, pay(606, "{2}{B}", [swampAct], { canConfirmFromPool: true })); await h.flush();
    ok("run: the pool pays the cost once it is covered", calls.length === 7 && calls[6].promptId === 606 && calls[6].out.type === "pay" && calls[6].out.auto === false, JSON.stringify(calls.slice(5)));
    ok("run: none of the run's questions was shown", !shown(h, mark).some((p) => [601, 602, 603, 604, 605, 606].includes(p.promptId)), shown(h, mark).map((p) => p.promptId).join(","));
    ok("run: over", seat.sacRun == null, JSON.stringify(seat.sacRun));
    harness.restore();
  }
  // 3. the cap: {1}{B} with four Treasures takes two; a colour that pays only the {1} sacrifices one at once
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92), treasure(93), treasure(94)];
    const { seat, calls } = setup(h, t);
    h.B.onPrompt(seat, pay(610, "{1}{B}", t.flatMap((c) => payActs(c)))); await h.flush();
    ok("cap: no more than the cost takes", opt(shown(h).pop(), "__sacx:g0")?.label === "Sacrifice X Treasure Token for mana (1 to 2)", labels(shown(h).pop()));
    await answer(h, 610, "__sacx:g0");
    await answer(h, 610, "__sacx:c:B");
    ok("cap: {B} asks 1 or 2", ids(seat.prompt?.ui) === "__sacx:1,__sacx:2,__back", ids(seat.prompt?.ui));
    await answer(h, 610, "__back");
    ok("cap: Back from how many goes back to the payment", seat.prompt?.ui?.title === "Pay {1}{B} for Phyrexian Obliterator" && opt(seat.prompt.ui, "__sacx:g0"), seat.prompt?.ui?.title);
    await answer(h, 610, "__sacx:g0");
    await answer(h, 610, "__sacx:c:W");
    ok("cap: {W} can pay only the {1}: one sacrificed at once", calls.length === 1 && calls[0].out.actionId === "tap:engine-card-91:0:W", JSON.stringify(calls));
    ok("cap: nothing left to run", JSON.stringify(seat.sacRun?.left) === "[]", JSON.stringify(seat.sacRun));
    harness.restore();
  }
  // 4. none offered: one Treasure; a cost of one mana; two names; another card's sacrifice
  {
    const cases = [
      ["one Treasure", [treasure(91)], "{2}{B}", (b) => payActs(b[0])],
      ["a cost of one mana", [treasure(91), treasure(92)], "{B}", (b) => b.flatMap((c) => payActs(c))],
      ["Treasure and Gold", [treasure(91), card("engine-card-95", "Gold Token", "Sacrifice this artifact: Add one mana of any color.")], "{2}{B}",
        (b) => [...payActs(b[0]), ...payActs(b[1], "Sacrifice this artifact")]],
      ["another card's sacrifice (Ashnod's Altar)", [card("engine-card-96", "Ashnod's Altar", "Sacrifice a creature: Add {C}{C}.", ["Artifact"], false), card("engine-card-97", "Ashnod's Altar", "Sacrifice a creature: Add {C}{C}.", ["Artifact"], false)], "{4}",
        (b) => b.flatMap((c) => payActs(c, "Sacrifice a creature", ["C"]))],
    ];
    for (const [what, bf, cost, acts] of cases) {
      const h = harness.load();
      const { seat } = setup(h, bf);
      h.B.onPrompt(seat, pay(620, cost, acts(bf))); await h.flush();
      ok(`none: ${what}`, !ids(shown(h).pop()).includes("__sacx"), labels(shown(h).pop()));
      harness.restore();
    }
  }
  // 5. Gold (no tap in its cost) groups too; Eldrazi Spawn's one colour asks only how many
  {
    const h = harness.load();
    const g = [card("engine-card-95", "Gold Token", "Sacrifice this artifact: Add one mana of any color."), card("engine-card-96", "Gold Token", "Sacrifice this artifact: Add one mana of any color.")];
    const { seat } = setup(h, g);
    h.B.onPrompt(seat, pay(630, "{3}", g.flatMap((c) => payActs(c, "Sacrifice this artifact")))); await h.flush();
    ok("Gold: grouped", opt(shown(h).pop(), "__sacx:g0")?.label === "Sacrifice X Gold Token for mana (1 to 2)", labels(shown(h).pop()));
    harness.restore();
  }
  {
    const h = harness.load();
    const s = [91, 92, 93].map((n) => card(`engine-card-${n}`, "Eldrazi Spawn Token", SPAWN_TEXT, ["Creature"]));
    const { seat, calls } = setup(h, s);
    h.B.onPrompt(seat, pay(640, "{4}", s.flatMap((c) => payActs(c, "Sacrifice this creature", ["C"])))); await h.flush();
    await answer(h, 640, "__sacx:g0");
    ok("Spawn: one colour, so only how many", seat.prompt?.ui?.title === "Eldrazi Spawn Token: sacrifice how many for {C}?" && ids(seat.prompt.ui) === "__sacx:1,__sacx:2,__sacx:3,__back", `${seat.prompt?.ui?.title} ${ids(seat.prompt?.ui)}`);
    await answer(h, 640, "__sacx:2");
    ok("Spawn: the first for {C}", calls.length === 1 && calls[0].out.actionId === "tap:engine-card-91:0:C", JSON.stringify(calls));
    harness.restore();
  }
  // 6. a card gone mid-run ends it, said once, and the payment is asked
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92), treasure(93)];
    const { seat, calls } = setup(h, t);
    h.B.onPrompt(seat, pay(650, "{3}", t.flatMap((c) => payActs(c)))); await h.flush();
    await answer(h, 650, "__sacx:g0");
    await answer(h, 650, "__sacx:c:R");
    await answer(h, 650, "__sacx:3");
    const mark = h.effects.length;
    seat.board.state.gameView.zones[0].cards = [t[2]];
    h.B.onPrompt(seat, pay(651, "{3}", payActs(t[2]))); await h.flush();
    ok("gone: the payment is asked", calls.length === 1 && shown(h, mark).some((p) => p.promptId === 651), JSON.stringify(calls));
    ok("gone: said once", JSON.stringify(chats(h, mark)) === JSON.stringify(["[MTG] Treasure Token: 2 more couldn't be sacrificed for mana; the rest is yours to pay."]), JSON.stringify(chats(h, mark)));
    ok("gone: the run is over", seat.sacRun == null, JSON.stringify(seat.sacRun));
    harness.restore();
  }
  // 7. priority: the option, the colour (none marked), the run through the next priority, then the board as usual
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92), treasure(93)];
    const { seat, calls } = setup(h, [t[1], t[0], t[2]]);
    h.B.onPrompt(seat, priority(700, prioActs(t))); await h.flush();
    const p = shown(h).pop();
    const at = (p?.options || []).findIndex((o) => o.id === "__sacx:g0");
    ok("priority: Mana: sacrifice X Treasure Token (1 to 3)", opt(p, "__sacx:g0")?.label === "Mana: sacrifice X Treasure Token (1 to 3)", labels(p));
    ok("priority: before the cards' own Mana: buttons", at > 0 && p.options[at + 1]?.id.startsWith("__mana:") && !p.options.slice(0, at).some((o) => o.id.startsWith("__mana:")), ids(p));
    ok("priority: on the first Treasure on the board", opt(p, "__sacx:g0")?.cardId === "engine-card-92", opt(p, "__sacx:g0")?.cardId);
    await answer(h, 700, "__sacx:g0");
    ok("priority: the colour, in the engine's order, none marked needed", labels(seat.prompt?.ui) === "{W} | {U} | {B} | {R} | {G} | Back", labels(seat.prompt?.ui));
    ok("priority: no cost to name", seat.prompt?.ui?.text === "The same mana from each one.", seat.prompt?.ui?.text);
    await answer(h, 700, "__sacx:c:R");
    await answer(h, 700, "__sacx:2");
    ok("priority: the first for {R}", calls.length === 1 && calls[0].promptId === 700 && calls[0].out.actionId === "tap:engine-card-92:4:R", JSON.stringify(calls));
    h.B.onPrompt(seat, confirmSac(701, t[1])); await h.flush();
    ok("priority: its sacrifice answered", calls.length === 2 && calls[1].out.value === true, JSON.stringify(calls.slice(1)));
    seat.board.state.gameView.zones[0].cards = [t[0], t[2]];
    seat.board.state.gameView.players[0].manaPool = { R: 1 };
    const mark = h.effects.length;
    h.B.onPrompt(seat, priority(702, prioActs([t[0], t[2]], 1))); await h.flush();
    ok("priority: the second on the next priority, by its new position", calls.length === 3 && calls[2].promptId === 702 && calls[2].out.actionId === "tap:engine-card-91:1:R", JSON.stringify(calls.slice(2)));
    h.B.onPrompt(seat, confirmSac(703, t[0])); await h.flush();
    seat.board.state.gameView.zones[0].cards = [t[2]];
    seat.board.state.gameView.players[0].manaPool = { R: 2 };
    h.B.onPrompt(seat, priority(704, prioActs([t[2]], 1))); await h.flush();
    ok("priority: after the run the priority is asked", calls.length === 4 && shown(h, mark).some((x) => x.promptId === 704), JSON.stringify(calls.slice(3)));
    ok("priority: one Treasure left: no Sacrifice X", !ids(shown(h, mark).pop()).includes("__sacx"), ids(shown(h, mark).pop()));
    harness.restore();
  }
  // 8. more than six: ×1-×5, all, How many…; a number from 1 to 8
  {
    const h = harness.load();
    const t = [91, 92, 93, 94, 95, 96, 97, 98].map(treasure);
    const { seat, calls } = setup(h, t);
    h.B.onPrompt(seat, priority(710, prioActs(t))); await h.flush();
    await answer(h, 710, "__sacx:g0");
    await answer(h, 710, "__sacx:c:G");
    ok("eight: ×1 to ×5, ×8 (all), How many…, Back", labels(seat.prompt?.ui) === "×1 | ×2 | ×3 | ×4 | ×5 | ×8 (all) | How many… | Back", labels(seat.prompt?.ui));
    await answer(h, 710, "__sacx:some");
    const num = seat.prompt?.ui;
    ok("eight: a number from 1 to 8, starting at 8", num?.mode === "number" && num.min === 1 && num.max === 8 && num.default === 8, JSON.stringify(num));
    await answer(h, 710, "9");
    ok("eight: 9 is refused", calls.length === 0 && seat.prompt?.ui?.mode === "number", JSON.stringify(calls));
    await answer(h, 710, "7");
    ok("eight: 7 starts the run", calls.length === 1 && calls[0].out.actionId === "tap:engine-card-91:3:G" && seat.sacRun?.left.length === 6, `${JSON.stringify(calls)} ${JSON.stringify(seat.sacRun)}`);
    harness.restore();
  }
  // 9. Back from the colour; a "choose a color" of the card just used; a rewind forgets the run
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92)];
    const { seat, calls } = setup(h, t);
    h.B.onPrompt(seat, pay(720, "{2}", t.flatMap((c) => payActs(c)))); await h.flush();
    await answer(h, 720, "__sacx:g0");
    await answer(h, 720, "__back");
    ok("back: from the colour to the payment", seat.prompt?.ui?.title === "Pay {2} for Phyrexian Obliterator" && calls.length === 0, seat.prompt?.ui?.title);
    await answer(h, 720, "__sacx:g0");
    await answer(h, 720, "__sacx:c:U");
    await answer(h, 720, "__sacx:2");
    h.B.onPrompt(seat, { promptId: 721, decidingPlayerId: "player-0", sourceCard: { id: "engine-card-91", identity: { name: "Treasure Token" }, text: TREASURE_TEXT },
      input: { type: "chooseColor", validColors: ["White", "Blue", "Black", "Red", "Green"], amount: 1, presentation: { title: "Choose a color" } } }); await h.flush();
    ok("colour question: the run's colour", calls.length === 2 && calls[1].promptId === 721 && JSON.stringify(calls[1].out) === JSON.stringify({ type: "colorDecision", chosenColors: { Blue: 1 } }), JSON.stringify(calls.slice(1)));
    ok("rewind: (the run is on)", seat.sacRun?.left.length === 1, JSON.stringify(seat.sacRun));
    seat.clearFollowUps();
    ok("rewind: clearFollowUps forgets it", seat.sacRun == null, JSON.stringify(seat.sacRun));
    harness.restore();
  }
  // 10. another question in between ends the run
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92)];
    const { seat } = setup(h, t);
    h.B.onPrompt(seat, pay(730, "{2}", t.flatMap((c) => payActs(c)))); await h.flush();
    await answer(h, 730, "__sacx:g0");
    await answer(h, 730, "__sacx:c:W");
    await answer(h, 730, "__sacx:2");
    h.B.onPrompt(seat, { promptId: 731, decidingPlayerId: "player-0", input: { type: "chooseCards", cards: [], min: 0, max: 0, presentation: { title: "Choose" } } }); await h.flush();
    ok("other question: the run ends", seat.sacRun == null, JSON.stringify(seat.sacRun));
    harness.restore();
  }

  // 11. (review of 58e810e) a yes/no or colour question the run doesn't answer goes to the player and ends the run, said
  // once: the next payment is asked, nothing more sacrificed. Forge's "Sacrifice this token" with no source card and no
  // name in it; another card's colour question; a second "Sacrifice ...?" for the same card
  const startRun = async (h, seat, t) => {
    h.B.onPrompt(seat, pay(740, "{3}", t.flatMap((c) => payActs(c)))); await h.flush();
    await answer(h, 740, "__sacx:g0");
    await answer(h, 740, "__sacx:c:R");
    await answer(h, 740, "__sacx:3");
  };
  const unanswered = [
    ["a nameless Sacrifice question", { promptId: 741, decidingPlayerId: "player-0", input: { type: "chooseBoolean", confirmLabel: "Accept", denyLabel: "Decline", presentation: { title: "Sacrifice this token" } } }],
    ["another card's colour question", { promptId: 741, decidingPlayerId: "player-0", sourceCard: { id: "engine-card-55", identity: { name: "Birds of Paradise" }, text: "" },
      input: { type: "chooseColor", validColors: ["White", "Blue", "Red"], amount: 1, presentation: { title: "Choose a color" } } }],
  ];
  for (const [what, ask] of unanswered) {
    const h = harness.load();
    const t = [treasure(91), treasure(92), treasure(93)];
    const { seat, calls } = setup(h, t);
    await startRun(h, seat, t);
    const mark = h.effects.length;
    h.B.onPrompt(seat, ask); await h.flush();
    ok(`unanswered (${what}): it is the player's`, calls.length === 1 && seat.prompt?.promptId === 741, JSON.stringify(calls));
    ok(`unanswered (${what}): the run ends, said once`, seat.sacRun == null
      && JSON.stringify(chats(h, mark)) === JSON.stringify(["[MTG] Treasure Token: another question came first; 2 more couldn't be sacrificed for mana; the rest is yours to pay."]), `${JSON.stringify(seat.sacRun)} ${JSON.stringify(chats(h, mark))}`);
    await answer(h, 741, ask.input.type === "chooseBoolean" ? "no" : "White");
    seat.board.state.gameView.zones[0].cards = [t[1], t[2]];
    h.B.onPrompt(seat, pay(742, "{3}", t.slice(1).flatMap((c) => payActs(c)))); await h.flush();
    ok(`unanswered (${what}): after the player's answer the next payment is asked, nothing sacrificed`, calls.length === 2 && seat.prompt?.promptId === 742, JSON.stringify(calls));
    harness.restore();
  }
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92), treasure(93)];
    const { seat, calls } = setup(h, t);
    await startRun(h, seat, t);
    h.B.onPrompt(seat, confirmSac(741, t[0])); await h.flush();
    h.B.onPrompt(seat, confirmSac(742, t[0])); await h.flush();
    ok("a second Sacrifice question for the same card is the player's, the run ends", calls.length === 2 && calls[1].promptId === 741 && seat.prompt?.promptId === 742 && seat.sacRun == null, `${JSON.stringify(calls)} ${JSON.stringify(seat.sacRun)}`);
    harness.restore();
  }
  // 12. (review of 58e810e) the engine didn't take the first activation: the same payment back with that Treasure still
  // offered ends the run, said once; nothing more is sacrificed
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92), treasure(93)];
    const { seat, calls } = setup(h, t);
    await startRun(h, seat, t);
    const mark = h.effects.length;
    h.B.onPrompt(seat, pay(743, "{3}", t.flatMap((c) => payActs(c)))); await h.flush();
    ok("refused: the payment back with the first still offered is asked, nothing sacrificed", calls.length === 1 && seat.prompt?.promptId === 743, JSON.stringify(calls));
    ok("refused: the run ends, said once", seat.sacRun == null
      && JSON.stringify(chats(h, mark)) === JSON.stringify(["[MTG] Treasure Token: the engine didn't take the last one; 3 more couldn't be sacrificed for mana; the rest is yours to pay."]), `${JSON.stringify(seat.sacRun)} ${JSON.stringify(chats(h, mark))}`);
    harness.restore();
  }
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92), treasure(93)];
    const { seat, calls } = setup(h, t);
    h.B.onPrompt(seat, priority(750, prioActs(t))); await h.flush();
    await answer(h, 750, "__sacx:g0");
    await answer(h, 750, "__sacx:c:R");
    await answer(h, 750, "__sacx:2");
    h.B.onPrompt(seat, priority(751, prioActs(t, 1))); await h.flush();
    ok("refused at priority: the priority back with the first still offered is asked", calls.length === 1 && seat.prompt?.promptId === 751 && seat.sacRun == null, `${JSON.stringify(calls)} ${JSON.stringify(seat.sacRun)}`);
    harness.restore();
  }

  // a run of one (x1 while paying): the pool that then covers the cost pays it, as after a tap by hand (sacStart's
  // tappedFor: the run's later steps set it too, so only a run of one depends on sacStart's)
  {
    const h = harness.load();
    const t = [treasure(91), treasure(92), treasure(93)];
    const { seat, calls } = setup(h, [swamp, ...t]);
    h.B.onPrompt(seat, pay(620, "{2}{B}", [swampAct, ...t.flatMap((c) => payActs(c))])); await h.flush();
    await answer(h, 620, "__sacx:g0");
    await answer(h, 620, "__sacx:c:B");
    await answer(h, 620, "__sacx:1");
    h.B.onPrompt(seat, confirmSac(621, t[0])); await h.flush();
    seat.board.state.gameView.zones[0].cards = [swamp, t[1], t[2]];
    seat.board.state.gameView.players[0].manaPool = { B: 3 };
    h.B.onPrompt(seat, pay(622, "{2}{B}", [swampAct, ...t.slice(1).flatMap((c) => payActs(c))], { canConfirmFromPool: true })); await h.flush();
    ok("run of one: the pool then pays the cost", calls.at(-1)?.promptId === 622 && calls.at(-1).out.type === "pay" && calls.at(-1).out.auto === false, JSON.stringify(calls));
    harness.restore();
  }

  process.stdout.write(failed ? `\n${failed} failed, ${passed} passed\n` : `PASSED: ${passed} passed, 0 failed\n`);
  process.exit(failed ? 1 : 0);
})();
