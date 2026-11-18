// The Mairsil hand test's text and log bugs (docs/HAND-TEST-MAIRSIL.md, "Text and log", 2026-11-18), each a line or a
// question the live table showed wrong. The words are the real ones: Forge's (tmp/eb-1125/forge: lblTapOrUntapTarget
// "Tap or untap {0}?", the harness's chooseCardsPile labels "-- Pile 1 (2 cards) -- <names>"), the cards' texts and the
// game log of that game (bridge/game-log.txt). One check per bug, named by its number:
//   #2  Pestermite's "may" asked as "tap or untap X?" (Yes / No), then Forge's "Tap or untap X?" (Tap / Untap)
//   #8  a token's trigger line cut at the comma in its name
//   #11 "... exiled from White's graveyard by Dimir Doppelganger with Abyssal Persecutor"
//   #17 names with commas in a list; Disrupt Decorum's goad and Insurrection's control lines one name at a time, and its
//       control returns with no cause
//   #19 Donate's stack text "White gains control of (nothing)" before its targets
//   #22 a copy in a choice by the copied name only
//   #24 Forge's object number in a title
//   #27 Deadpool's swap on entering in no log, "Chose 1 card" on it
//   #29 Fact or Fiction's piles as cut text
//   #30 Cryptic Command's "tap all creatures your opponents control" and a spell's new controller in no log
//   #33 "Pay Reveal a Swamp or Mountain card from your hand"
// (#3 and #23 are the table's: tests/test_table_mairsil_text.js)
//   node tests/test_bridge_mairsil_text.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 600)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
  players: [{ id: "player-0", life: 40, manaPool: {} }, { id: "player-1", life: 40, manaPool: {} }],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
const put = (b, zone, card, ownerId = card.ownerId || "player-0") => { const z = b.zones.find((x) => x.zone === zone && x.ownerId === ownerId); z.cards.push(card); z.count = z.cards.length; };
const id = (n) => `engine-card-${n}`;
const card = (n, name, types, extra = {}) => ({ id: id(n), identity: { name, ...(extra.token ? { isToken: true } : {}) }, types, controllerId: extra.ctl || "player-0", ownerId: extra.owner || extra.ctl || "player-0",
  ...(types.includes("Creature") ? { power: extra.p ?? 2, toughness: extra.t ?? 2 } : {}), text: extra.text || "", ...(extra.more || {}) });
const board = (fill) => { const b = blank(); fill(b); return b; };

function setup(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1", "player-2": "AI 2" }, slotColor: { "player-0": "Blue", "player-1": "White", "player-2": "Red" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  return seat;
}
// a run of boards through the log in one bridge (the game kept between them), each board's lines
function logRun(boards) {
  const h = harness.load();
  try {
    setup(h);
    const out = [];
    for (let i = 1; i < boards.length; i++) {
      const [after, events] = Array.isArray(boards[i]) ? boards[i] : [boards[i], []];
      const before = Array.isArray(boards[i - 1]) ? boards[i - 1][0] : boards[i - 1];
      out.push(h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after, h.B.engineFacts(events)));
    }
    return out;
  } finally { harness.restore(); }
}
const between = (before, after, events = []) => logRun([before, [after, events]])[0];
let seq = 10;
const ev = (cardId, from, to, extra = {}) => ({ seq: ++seq, cardId, from, to, ownerId: extra.ownerId || "player-0", ...extra });
// one question as the table shows it (the seat's open question), and the answer the table's pick sends
function ask(gv, prompt, pick) {
  const h = harness.load();
  try {
    const seat = setup(h);
    seat.respond = function respond(promptId, type, output) { this.sentOut = { type, output }; };
    seat.board = { state: { gameView: gv }, fingerprint: null };
    if (prompt.lastShown) seat.lastShown = { ...prompt.lastShown, at: Date.now() };
    h.B.onPrompt(seat, { promptId: 7, decidingPlayerId: "player-0", ...prompt });
    const ui = seat.prompt?.ui;
    let sent = null;
    if (ui && pick != null) {
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: seat.prompt.promptId, choice: [String(ui.options[pick].id)] }) });
      sent = seat.sentOut || null;
    }
    return { ui, sent, label: seat.prompt?.ui ? null : "no question" };
  } finally { harness.restore(); }
}
const shown = (r) => r.ui && { title: r.ui.title, options: (r.ui.options || []).map((o) => o.label) };
// the table message for one board
async function tableFor(gv) {
  const h = harness.load();
  try {
    const seat = setup(h);
    seat.board = { state: { gameView: gv }, fingerprint: null };
    h.B.sendTable(); await h.flush();
    return h.effects.filter((e) => e.tts?.t === "table").map((e) => e.tts).at(-1);
  } finally { harness.restore(); }
}

(async () => {
  const MAIRSIL_TEXT = "When Mairsil, the Pretender enters, you may exile an artifact or creature card from your hand or graveyard and put a cage counter on it.";

  // ── #8 a token's trigger, its name with a comma ──
  {
    const tok = card(20, "Mairsil, the Pretender", ["Creature"], { token: true, p: 4, t: 4, text: MAIRSIL_TEXT });
    const before = board((b) => put(b, "battlefield", tok));
    const after = board((b) => { put(b, "battlefield", tok); b.stack = [{ id: "engine-stack-1", sourceId: tok.id, controllerId: "player-0", ownerId: "player-0", identity: { name: "Mairsil, the Pretender", isToken: true },
      isTrigger: true, sourceAbilityText: MAIRSIL_TEXT, targets: [], text: `Mairsil, the Pretender (20) - ${MAIRSIL_TEXT}` }]; });
    const lines = between(before, after);
    ok("#8 a token's trigger line goes on after the comma in its name", lines.some((l) => l.startsWith("Mairsil, the Pretender token's ability triggers (Blue): you may exile an artifact or creature card")), JSON.stringify(lines));
  }

  // ── #11 exiled by a card that became a copy of it ──
  {
    const DIMIR = "{1}{U}{B}: Exile target creature card from a graveyard. Dimir Doppelganger becomes a copy of that card, except it has this ability.";
    const ap = (more = {}) => card(31, "Abyssal Persecutor", ["Creature"], { p: 6, t: 6, more });
    const before = board((b) => { put(b, "battlefield", card(30, "Dimir Doppelganger", ["Creature"], { p: 0, t: 2, text: DIMIR })); put(b, "graveyard", ap()); });
    const after = board((b) => {
      put(b, "battlefield", card(30, "Abyssal Persecutor", ["Creature"], { p: 6, t: 6, text: DIMIR, more: { printedName: "Dimir Doppelganger", isCopy: true } }));
      put(b, "exile", ap({ exiledWith: id(30) }));
    });
    const lines = between(before, after, [ev(id(31), "Graveyard", "Exile", { cause: "ChangeZone", causeName: "Dimir Doppelganger", causeCardId: id(30) })]);
    ok("#11 exiled by the card that became its copy: said once, by the name it had", lines.includes("Abyssal Persecutor is exiled from Blue's graveyard by Dimir Doppelganger") && !lines.some((l) => / with Abyssal Persecutor/.test(l)), JSON.stringify(lines));
  }

  // ── #17 lists: names with commas, many names ──
  {
    const h = harness.load();
    let few, plain;
    try { few = h.B.fewNames(["Body Double", "Deadpool, Trading Card", "Kiki-Jiki, Mirror Breaker"]); plain = h.B.fewNames(["Body Double", "Clone", "Craw Wurm"]); } finally { harness.restore(); }
    same("#17 a list with a comma in a name is joined with semicolons", few, "Body Double; Deadpool, Trading Card; Kiki-Jiki, Mirror Breaker");
    same("#17 a list with no comma in a name keeps its commas", plain, "Body Double, Clone, Craw Wurm");
    // Buried Alive's three cards, as the log said them
    const lib = [card(40, "Body Double", ["Creature"]), card(41, "Deadpool, Trading Card", ["Creature"]), card(42, "Kiki-Jiki, Mirror Breaker", ["Creature"])];
    const before = board((b) => { b.zones.find((z) => z.zone === "library" && z.ownerId === "player-0").count = 50; });
    const after = board((b) => { for (const c of lib) put(b, "graveyard", c); b.zones.find((z) => z.zone === "library" && z.ownerId === "player-0").count = 47; });
    const lines = between(before, after, lib.map((c) => ev(c.id, "Library", "Graveyard", { cause: "ChangeZone", causeName: "Buried Alive" })));
    ok("#17 Buried Alive's line tells its three cards apart", lines.some((l) => l.includes("Body Double; Deadpool, Trading Card; Kiki-Jiki, Mirror Breaker")), JSON.stringify(lines));
  }
  // the AI's creatures, for Disrupt Decorum and Insurrection
  const theirs = (extra = {}) => [...[50, 51, 52, 53, 54].map((n) => card(n, "Craw Wurm", ["Creature"], { ctl: extra.ctl || "player-1", owner: "player-1", p: 6, t: 4 })),
    card(55, "Grizzly Bears", ["Creature"], { ctl: extra.ctl || "player-1", owner: "player-1" }), card(56, "Grizzly Bears", ["Creature"], { ctl: extra.ctl || "player-1", owner: "player-1" }),
    card(57, "Neheb, the Worthy", ["Creature"], { ctl: extra.ctl || "player-1", owner: "player-1", p: 2, t: 2 })];
  {
    const DECORUM = "Goad all creatures you don't control. (Until your next turn, those creatures attack each combat if able and attack a player other than you if able.)";
    const spell = card(60, "Disrupt Decorum", ["Sorcery"], { text: DECORUM });
    const before = board((b) => { for (const c of theirs()) put(b, "battlefield", c, "player-1"); b.stack = [{ id: "engine-stack-9", sourceId: spell.id, controllerId: "player-0", ownerId: "player-0", identity: { name: "Disrupt Decorum" }, sourceAbilityText: DECORUM, targets: [], text: DECORUM }]; put(b, "hand", { ...spell }); });
    const after = board((b) => { for (const c of theirs()) put(b, "battlefield", c, "player-1"); put(b, "graveyard", { ...spell }); });
    const lines = between(before, after, [ev(spell.id, "Stack", "Graveyard")]);
    ok("#17 Disrupt Decorum's goad: counted, by count, comma names apart",
      lines.includes("8 creatures (Craw Wurm ×5; Grizzly Bears ×2; Neheb, the Worthy) are goaded by Blue: they attack each combat, a player other than Blue if able, until Blue's next turn"), JSON.stringify(lines));
  }
  {
    const INS = "Untap all creatures and gain control of them until end of turn. They gain haste until end of turn.";
    const spell = card(61, "Insurrection", ["Sorcery"], { text: INS });
    const b0 = board((b) => { for (const c of theirs()) put(b, "battlefield", c, "player-1"); b.stack = [{ id: "engine-stack-8", sourceId: spell.id, controllerId: "player-0", ownerId: "player-0", identity: { name: "Insurrection" }, sourceAbilityText: INS, targets: [], text: INS }]; });
    const b1 = board((b) => { for (const c of theirs({ ctl: "player-0" })) put(b, "battlefield", c, "player-1"); put(b, "graveyard", { ...spell }); });
    const b2 = board((b) => { b.turn = 4; b.activePlayerId = "player-1"; for (const c of theirs()) put(b, "battlefield", c, "player-1"); put(b, "graveyard", { ...spell }); });
    const [took, back] = logRun([b0, [b1, [ev(spell.id, "Stack", "Graveyard")]], b2]);
    const gains = (ls) => ls.filter((l) => / gains control of /.test(l));
    same("#17 Insurrection's control: one line, by count, its cause", gains(took), ["Blue gains control of 8 permanents: Craw Wurm ×5; Grizzly Bears ×2; Neheb, the Worthy from AI 1 (Insurrection)"]);
    same("#17 Insurrection's end: one line back, by what ended", gains(back), ["AI 1 gains control of 8 permanents: Craw Wurm ×5; Grizzly Bears ×2; Neheb, the Worthy from Blue (Insurrection ends)"]);
  }

  // ── #19 a control spell's stack text before its targets ──
  {
    const DONATE = "Target player gains control of target permanent you control.";
    const gv = board((b) => { b.stack = [{ id: "casting-1", sourceId: id(70), controllerId: "player-0", ownerId: "player-0", identity: { name: "Donate" }, sourceAbilityText: DONATE, targets: [], isCasting: true,
      text: "Donate (70) - Blue gains control of (nothing)." }]; put(b, "hand", card(70, "Donate", ["Sorcery"], { text: DONATE })); });
    const t = await tableFor(gv);
    same("#19 Donate on the stack before its targets: its own words, not \"Blue gains control of (nothing)\"", (t?.stack || []).map((s) => s.tx), [DONATE]);
  }

  // ── #22 a copy in a choice ──
  {
    const h = harness.load();
    let label;
    try { label = h.B.cardLabel({ id: id(80), identity: { name: "Craw Wurm" }, printedName: "Phantasmal Image", isCopy: true, power: 6, toughness: 4 }); } finally { harness.restore(); }
    same("#22 a copy's choice label names the card it is", label, "Craw Wurm (Phantasmal Image) 6/4");
  }

  // ── #2 Pestermite's two questions ──
  const PEST = "When Pestermite enters, you may tap or untap target permanent.";
  const pestBoard = () => board((b) => {
    put(b, "battlefield", card(90, "Pestermite", ["Creature"], { p: 2, t: 1, text: `Flash\nFlying\n${PEST}` }));
    put(b, "battlefield", card(91, "Mairsil, the Pretender", ["Creature"], { p: 4, t: 4 }));
    b.stack = [{ id: "engine-stack-3", sourceId: id(90), controllerId: "player-0", ownerId: "player-0", identity: { name: "Pestermite" }, isTrigger: true, sourceAbilityText: PEST, targets: [{ kind: "card", id: id(91) }], text: `Pestermite (90) - ${PEST}` }];
  });
  const pestSrc = { id: id(90), identity: { name: "Pestermite" }, types: ["Creature"], controllerId: "player-0" };
  {
    const may = ask(pestBoard(), { sourceCard: pestSrc, sourceAbilityText: PEST, input: { type: "chooseBoolean", confirmLabel: "Yes", denyLabel: "No", presentation: { title: "Use triggered ability of Pestermite?" } } }, 0);
    const which = ask(pestBoard(), { sourceCard: pestSrc, sourceAbilityText: PEST, input: { type: "chooseBoolean", confirmLabel: "Tap", denyLabel: "Untap", presentation: { title: "Tap or untap Mairsil, the Pretender?" } } }, 1);
    same("#2 Pestermite's may: asked as using its ability, its target named", shown(may), { title: "Pestermite: use its ability (tap or untap Mairsil, the Pretender)?", options: ["Use it", "Don't"] });
    same("#2 Pestermite's may: Use it is a yes", may.sent, { type: "chooseBoolean", output: { type: "decision", value: true } });
    same("#2 Forge's tap-or-untap question after it: Tap / Untap, its own title", shown(which), { title: "Pestermite: tap or untap Mairsil, the Pretender?", options: ["Tap", "Untap"] });
    ok("#2 the two questions read differently", shown(may)?.title !== shown(which)?.title);
  }

  // ── #24 Forge's object number in a title ──
  {
    const gv = board((b) => {
      put(b, "battlefield", card(100, "Perplexing Chimera", ["Enchantment", "Creature"], { p: 3, t: 3 }));
      b.stack = [{ id: "engine-stack-4", sourceId: id(177), controllerId: "player-1", ownerId: "player-1", identity: { name: "Murderous Compulsion" }, sourceAbilityText: "Destroy target tapped creature.", targets: [], text: "Murderous Compulsion (177) - Destroy target tapped creature." }];
    });
    const r = ask(gv, { sourceCard: { id: id(100), identity: { name: "Perplexing Chimera" }, types: ["Enchantment", "Creature"], controllerId: "player-0" },
      sourceAbilityText: "Whenever an opponent casts a spell, you may exchange control of Perplexing Chimera and that spell. If you do, you may choose new targets for the spell.",
      input: { type: "chooseBoolean", confirmLabel: "Yes", denyLabel: "No", presentation: { title: "Change targets of Murderous Compulsion (177)?" } } });
    ok("#24 no object number in the title", r.ui && !/\(177\)/.test(r.ui.title) && /Murderous Compulsion\?$/.test(r.ui.title), r.ui?.title);
  }

  // ── #33 Foreboding Ruins' reveal ──
  {
    const RUINS = "As Foreboding Ruins enters, you may reveal a Swamp or Mountain card from your hand. If you don't, Foreboding Ruins enters tapped.\n{T}: Add {B} or {R}.";
    const gv = board((b) => put(b, "hand", card(110, "Foreboding Ruins", ["Land"], { text: RUINS })));
    const r = ask(gv, { sourceCard: { id: id(110), identity: { name: "Foreboding Ruins" }, types: ["Land"], controllerId: "player-0", text: RUINS },
      input: { type: "chooseBoolean", confirmLabel: "Yes", denyLabel: "No", presentation: { title: "Pay Reveal a Swamp or Mountain card from your hand?", text: "otherwise: \"Foreboding Ruins enters tapped.\"" } } });
    ok("#33 the reveal is asked as itself, no \"Pay Reveal\"", r.ui && !/pay reveal/i.test(JSON.stringify(shown(r))) && /reveal a Swamp or Mountain card from your hand\?$/.test(r.ui.title)
      && r.ui.options[0].label === "Reveal a Swamp or Mountain card from your hand", JSON.stringify(shown(r)));
  }

  // ── #29 Fact or Fiction's piles ──
  {
    const FOF = "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.";
    const r = ask(board(() => {}), { sourceCard: { id: id(120), identity: { name: "Fact or Fiction" }, types: ["Instant"], controllerId: "player-0", text: FOF }, sourceAbilityText: FOF,
      lastShown: { src: "Fact or Fiction", names: ["Diabolic Tutor", "Cryptic Command", "Volrath's Shapeshifter", "Thought Scour", "Necrotic Ooze"] },
      input: { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, presentation: { title: "Fact or Fiction" },
        options: [{ label: "-- Pile 1 (2 cards) -- Necrotic Ooze Thought Scour" }, { label: "-- Pile 2 (3 cards) -- Diabolic Tutor Cryptic Command Volrath's Shapeshifter" }] } }, 1);
    same("#29 the piles by their cards' names", shown(r), { title: "Fact or Fiction: put which pile into your hand?",
      options: ["Pile 1: Necrotic Ooze, Thought Scour", "Pile 2: Diabolic Tutor, Cryptic Command, Volrath's Shapeshifter"] });
    same("#29 the pile picked is sent by its number", r.sent, { type: "chooseFromSelection", output: { type: "selectionDecision", chosenIndices: [1] } });
  }

  // ── #30 Cryptic Command's tap, a spell's new controller ──
  {
    const CRYPTIC = "Choose two — • Counter target spell. • Return target permanent to its owner's hand. • Tap all creatures your opponents control. • Draw a card.";
    const spell = card(130, "Cryptic Command", ["Instant"], { text: CRYPTIC });
    const ai = [card(131, "Craw Wurm", ["Creature"], { ctl: "player-1", owner: "player-1" }), card(132, "Craw Wurm", ["Creature"], { ctl: "player-1", owner: "player-1" }), card(133, "Serra Angel", ["Creature"], { ctl: "player-1", owner: "player-1" })];
    const before = board((b) => { for (const c of ai) put(b, "battlefield", c, "player-1"); put(b, "battlefield", card(134, "Abyssal Persecutor", ["Creature"]));
      b.stack = [{ id: "engine-stack-5", sourceId: spell.id, controllerId: "player-0", ownerId: "player-0", identity: { name: "Cryptic Command" }, sourceAbilityText: "Return target permanent to its owner's hand. Tap all creatures your opponents control.",
        targets: [{ kind: "card", id: id(134) }], text: "Cryptic Command (130) - Return target permanent to its owner's hand. Tap all creatures your opponents control." }]; });
    const after = board((b) => { for (const c of ai) put(b, "battlefield", { ...c, tapped: true }, "player-1"); put(b, "hand", card(134, "Abyssal Persecutor", ["Creature"])); put(b, "graveyard", { ...spell }); });
    const lines = between(before, after, [ev(id(134), "Battlefield", "Hand"), ev(spell.id, "Stack", "Graveyard")]);
    ok("#30 Cryptic Command's tap of the opponents' creatures is logged", lines.includes("Cryptic Command taps AI 1's Craw Wurm ×2, Serra Angel"), JSON.stringify(lines));

    const CHIMERA = "Whenever an opponent casts a spell, you may exchange control of Perplexing Chimera and that spell. If you do, you may choose new targets for the spell.";
    const chim = (ctl) => card(140, "Perplexing Chimera", ["Enchantment", "Creature"], { ctl, owner: "player-0", p: 3, t: 3, text: CHIMERA });
    const impetus = (ctl) => ({ id: "engine-stack-6", sourceId: id(141), controllerId: ctl, ownerId: "player-1", identity: { name: "Coercive Impetus" }, sourceAbilityText: "Enchant creature", targets: [{ kind: "card", id: id(142) }], text: "Coercive Impetus (141) - Enchant creature" });
    const wurm = card(142, "Craw Wurm", ["Creature"], { ctl: "player-0" });
    const b0 = board((b) => { put(b, "battlefield", chim("player-0")); put(b, "battlefield", wurm);
      b.stack = [impetus("player-1"), { id: "engine-stack-7", sourceId: id(140), controllerId: "player-0", ownerId: "player-0", identity: { name: "Perplexing Chimera" }, isTrigger: true, sourceAbilityText: CHIMERA, targets: [], text: `Perplexing Chimera (140) - ${CHIMERA}` }]; });
    const b1 = board((b) => { put(b, "battlefield", chim("player-1"), "player-0"); put(b, "battlefield", wurm); b.stack = [impetus("player-0")]; });
    const swap = between(b0, b1);
    ok("#30 the spell the Chimera gave is logged with its new controller", swap.includes("Blue gains control of Coercive Impetus (a spell on the stack) from AI 1 (Perplexing Chimera)"), JSON.stringify(swap));
  }

  // ── #27 Deadpool's swap as it enters ──
  {
    const DEADPOOL = "As Deadpool enters, you may exchange his text box and another creature's.\nAt the beginning of your upkeep, you lose 3 life.\n{3}, Sacrifice this creature: Each other player draws a card.";
    const PERSECUTOR = "Flying, trample\nYou can't win the game and your opponents can't lose the game.";
    const dp = (more) => card(150, "Deadpool, Trading Card", ["Creature"], { p: 5, t: 3, more });
    const before = board((b) => { put(b, "hand", dp({ text: DEADPOOL })); put(b, "battlefield", card(151, "Abyssal Persecutor", ["Creature"], { p: 6, t: 6, text: PERSECUTOR })); });
    const after = board((b) => { put(b, "battlefield", dp({ text: DEADPOOL, currentText: PERSECUTOR, choices: [{ kind: "chosenCard", count: 1 }] }));
      put(b, "battlefield", card(151, "Abyssal Persecutor", ["Creature"], { p: 6, t: 6, text: PERSECUTOR, more: { currentText: DEADPOOL } })); });
    const lines = between(before, after, [ev(id(150), "Stack", "Battlefield")]);
    ok("#27 Deadpool's swap on entering is logged", lines.includes("Deadpool, Trading Card exchanges text boxes with Abyssal Persecutor as it enters"), JSON.stringify(lines));
    // the swap known, the table's card says with whom, not "Chose 1 card"
    const h = harness.load();
    let t;
    try {
      const seat = setup(h);
      h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after, null);
      seat.board = { state: { gameView: after }, fingerprint: null };
      h.B.sendTable(); await h.flush();
      t = JSON.stringify(h.effects.filter((e) => e.tts).map((e) => e.tts));
    } finally { harness.restore(); }
    ok("#27 Deadpool's choice reads as the swap, not \"Chose 1 card\"", t.includes("Exchanged text boxes with Abyssal Persecutor") && !t.includes("Chose 1 card"), t.match(/.{0,300}Deadpool.{0,300}/)?.[0] || t.slice(0, 400));
    // and when it has gone and comes back with a choice of its own, the swap isn't remembered for it
    const gone = board((b) => { put(b, "graveyard", dp({ text: DEADPOOL })); put(b, "battlefield", card(151, "Abyssal Persecutor", ["Creature"], { p: 6, t: 6, text: PERSECUTOR })); });
    const back = board((b) => { put(b, "battlefield", dp({ text: DEADPOOL, currentText: DEADPOOL, choices: [{ kind: "chosenCard", count: 1 }] })); put(b, "battlefield", card(151, "Abyssal Persecutor", ["Creature"], { p: 6, t: 6, text: PERSECUTOR })); });
    const h2 = harness.load();
    let t2;
    try {
      const seat = setup(h2);
      for (const [x, y] of [[before, after], [after, gone], [gone, back]]) h2.B.logEvents(h2.B.logSnapshot(x), h2.B.logSnapshot(y), y, null);
      seat.board = { state: { gameView: back }, fingerprint: null };
      h2.B.sendTable(); await h2.flush();
      t2 = JSON.stringify(h2.effects.filter((e) => e.tts).map((e) => e.tts));
    } finally { harness.restore(); }
    ok("#27 a Deadpool that left and came back is no longer said to have swapped", t2.includes("Chose 1 card") && !t2.includes("Exchanged text boxes"), t2.match(/.{0,200}Deadpool.{0,200}/)?.[0] || t2.slice(0, 300));
  }

  // ── break-it additions (jr suite 2026-11-18): each check below failed to fail when the code it watches was broken ──
  // #17 the same join rule in the other lists: a long list's first names, the sideboard swap, a counted attack
  {
    const h = harness.load();
    let long, swap, tok, cost;
    try {
      long = h.B.fewNames(["A", "B", "C", "D", "E", "F", "G", "Deadpool, Trading Card", "I", "J", "K"]);
      swap = h.B.swapWords(["Island", "Island", "Deadpool, Trading Card"]);
      tok = h.B.tokensCounted(["Deadpool, Trading Card", "Soldier token", "Soldier token"]);
      cost = h.B.yesNoWords("Pay Reveal a Swamp or Mountain card from your hand?", "Foreboding Ruins", {});
    } finally { harness.restore(); }
    same("#17 a long list's first names are joined by the same rule", long, "A; B; C; D; E; F; G; Deadpool, Trading Card ... and 3 more");
    same("#17 a sideboard swap's names, counted, joined by the same rule", swap, "Island ×2; Deadpool, Trading Card");
    same("#17 an attack's names, tokens counted, joined by the same rule", tok, "Deadpool, Trading Card; 2 Soldier tokens");
    same("#33 a yes/no question that pays a reveal is asked as the reveal", cost.slice(0, 3), ["Reveal a Swamp or Mountain card from your hand?", "Yes", "No"]);
  }
  // #17 suspect: two names, one with a comma in it
  {
    const SUSPECT = "Suspect target creature. Suspect another target creature.";
    const spell = card(160, "Case of the Stashed Skeleton", ["Enchantment"], { text: SUSPECT });
    const pair = [card(161, "Body Double", ["Creature"], { ctl: "player-1", owner: "player-1" }), card(162, "Deadpool, Trading Card", ["Creature"], { ctl: "player-1", owner: "player-1" })];
    const before = board((b) => { for (const c of pair) put(b, "battlefield", c, "player-1");
      b.stack = [{ id: "engine-stack-20", sourceId: spell.id, controllerId: "player-0", ownerId: "player-0", identity: { name: "Case of the Stashed Skeleton" }, sourceAbilityText: SUSPECT,
        targets: pair.map((c) => ({ kind: "card", id: c.id })), text: `Case of the Stashed Skeleton (160) - ${SUSPECT}` }]; });
    const after = board((b) => { for (const c of pair) put(b, "battlefield", c, "player-1"); put(b, "graveyard", { ...spell }); });
    const lines = between(before, after, [ev(spell.id, "Stack", "Graveyard")]);
    ok("#17 two suspected creatures, one with a comma, are told apart", lines.includes("Body Double; Deadpool, Trading Card are suspected: menace, and can't block"), JSON.stringify(lines));
  }
  // #30 "untap all" says untaps, only for what it turned; "tap all" leaves out what was tapped already and what it targeted
  {
    const ai = (n, name, tapped) => card(n, name, ["Creature"], { ctl: "player-1", owner: "player-1", more: { tapped } });
    const MASS = "Untap all creatures.";
    const spell = card(170, "Awakening Wave", ["Instant"], { text: MASS });
    const stack = (text, targets = []) => [{ id: "engine-stack-21", sourceId: spell.id, controllerId: "player-0", ownerId: "player-0", identity: { name: spell.identity.name }, sourceAbilityText: text, targets, text: `Awakening Wave (170) - ${text}` }];
    const field = (b, tappedBefore, list) => { for (const [n, name, wasTapped] of list) put(b, "battlefield", ai(n, name, tappedBefore ? wasTapped : !wasTapped), "player-1"); };
    // untap: three were tapped, one was untapped already
    const list = [[171, "Craw Wurm", true], [172, "Craw Wurm", true], [173, "Serra Angel", true], [174, "Llanowar Elves", false]];
    const b0 = board((b) => { field(b, true, list); b.stack = stack(MASS); });
    const b1 = board((b) => { for (const [n, name] of list) put(b, "battlefield", ai(n, name, false), "player-1"); put(b, "graveyard", { ...spell }); });
    const lines = between(b0, b1, [ev(spell.id, "Stack", "Graveyard")]);
    ok("#30 Awakening Wave's untap is logged as untapping, not the creature already untapped", lines.includes("Awakening Wave untaps AI 1's Craw Wurm ×2, Serra Angel"), JSON.stringify(lines));
    // tap: a creature the spell targeted is its own line's, and one tapped already isn't turned
    const TAP = "Tap target creature. Tap all other creatures your opponents control.";
    const t0 = board((b) => { for (const [n, name, , t] of [[181, "Craw Wurm", 0, false], [182, "Craw Wurm", 0, false], [183, "Serra Angel", 0, false], [184, "Llanowar Elves", 0, true]]) put(b, "battlefield", ai(n, name, t), "player-1"); b.stack = stack(TAP, [{ kind: "card", id: id(181) }]); });
    const t1 = board((b) => { for (const [n, name] of [[181, "Craw Wurm"], [182, "Craw Wurm"], [183, "Serra Angel"], [184, "Llanowar Elves"]]) put(b, "battlefield", ai(n, name, true), "player-1"); put(b, "graveyard", { ...spell }); });
    const tl = between(t0, t1, [ev(spell.id, "Stack", "Graveyard")]);
    ok("#30 'tap all' names only what it turned: not the creature it targeted, not one tapped already", tl.some((l) => l === "Awakening Wave taps AI 1's Craw Wurm, Serra Angel"), JSON.stringify(tl));
  }
  // #30 a spell whose controller stays the same says nothing about control
  {
    const wurm = card(190, "Craw Wurm", ["Creature"], { ctl: "player-0" });
    const sp = (ctl) => ({ id: "engine-stack-22", sourceId: id(191), controllerId: ctl, ownerId: "player-1", identity: { name: "Coercive Impetus" }, sourceAbilityText: "Enchant creature", targets: [{ kind: "card", id: id(190) }], text: "Coercive Impetus (191) - Enchant creature" });
    const same0 = between(board((b) => { put(b, "battlefield", wurm); b.stack = [sp("player-1")]; }), board((b) => { put(b, "battlefield", wurm); b.stack = [sp("player-1")]; }));
    ok("#30 a spell on the stack under the same controller: no control line", !same0.some((l) => /gains control/.test(l)), JSON.stringify(same0));
  }
  // #17 control: the cause given back is named only for what that card was taken by, and not once it is back
  {
    const INS = "Untap all creatures and gain control of them until end of turn. They gain haste until end of turn.";
    const spell = card(200, "Insurrection", ["Sorcery"], { text: INS });
    const blank3 = () => { const b = blank(); b.players.push({ id: "player-2", life: 40, manaPool: {} }); b.zones.push(...ZONES.map((zone) => ({ zone, ownerId: "player-2", cards: [], count: 0 }))); return b; };
    const at = (ctl, fill = () => {}) => { const b = blank3(); put(b, "battlefield", card(201, "Craw Wurm", ["Creature"], { ctl, owner: "player-1", p: 6, t: 4 }), "player-1"); fill(b); return b; };
    const stolen = [at("player-1", (b) => { b.stack = [{ id: "engine-stack-23", sourceId: spell.id, controllerId: "player-0", ownerId: "player-0", identity: { name: "Insurrection" }, sourceAbilityText: INS, targets: [], text: INS }]; }),
      [at("player-0", (b) => put(b, "graveyard", { ...spell })), [ev(spell.id, "Stack", "Graveyard")]]];
    const gains = (ls) => ls.filter((l) => / gains control of /.test(l));
    // taken by Insurrection, then handed on to a third player by something no log saw: that is not Insurrection ending
    const [, passed] = logRun([...stolen, at("player-2")]);
    same("#17 control that moves on to a third player is not 'Insurrection ends'", gains(passed), ["AI 2 gains control of Craw Wurm from Blue"]);
    // taken, given back (named), taken again by something no log saw, and back again: that last return has no cause to name
    const [, back, again, backAgain] = logRun([...stolen, at("player-1"), at("player-0"), at("player-1")]);
    same("#17 the return is named for Insurrection", gains(back), ["AI 1 gains control of Craw Wurm from Blue (Insurrection ends)"]);
    same("#17 once it is back, a later return is not named for Insurrection again", [gains(again), gains(backAgain)], [["Blue gains control of Craw Wurm from AI 1"], ["AI 1 gains control of Craw Wurm from Blue"]]);
  }
  // #29 Fact or Fiction's piles: a name that is the start of a longer one, an empty pile, a pile nobody has seen the cards of
  {
    const FOF = "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.";
    const piles = (names, a, b) => shown(ask(board(() => {}), { sourceCard: { id: id(121), identity: { name: "Fact or Fiction" }, types: ["Instant"], controllerId: "player-0", text: FOF }, sourceAbilityText: FOF,
      lastShown: { src: "Fact or Fiction", names }, input: { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, presentation: { title: "Fact or Fiction" }, options: [{ label: a }, { label: b }] } }, 0));
    same("#29 the longest known name is taken first: Vampire Nighthawk, not Vampire", piles(["Vampire", "Vampire Nighthawk", "Island"], "-- Pile 1 (2 cards) -- Vampire Nighthawk Island", "-- Pile 2 (0 cards) --")?.options,
      ["Pile 1: Vampire Nighthawk, Island", "Pile 2: no cards"]);
    same("#29 a pile whose cards were never seen is counted", piles([], "-- Pile 1 (2 cards) --", "-- Pile 2 (1 card) --")?.options, ["Pile 1: 2 face-down cards", "Pile 2: a face-down card"]);
  }
  // #24 a number in parentheses after something that isn't a card's name is the number it is
  {
    const r = ask(board((b) => put(b, "hand", card(210, "Island", ["Land"]))), { sourceCard: { id: id(211), identity: { name: "Perplexing Chimera" }, types: ["Creature"], controllerId: "player-0" },
      input: { type: "chooseBoolean", confirmLabel: "Yes", denyLabel: "No", presentation: { title: "Exile cards from the top of your library (3)?" } } });
    ok("#24 a count in parentheses after no card's name stays", r.ui && /\(3\)/.test(r.ui.title), r.ui?.title);
  }

  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} Mairsil text checks pass\n`);
  process.exit(failed ? 1 : 0);
})();
