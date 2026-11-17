// The ability sweep's follow-ups (docs/ability-sweep-spec.md), each from the spec's own examples with Forge's shapes:
//  INV-1 a life loss names its source: the engine's damage entries (engine1112's feed: source, player, amount, combat)
//        name what the boards can't (Galvanic Blast's metalcraft 4, an X spell, a trigger that came and went between two
//        boards); without the feed, or with a source it can't name, the line stays bare (no guessing); the board-read
//        cases (Lightning Bolt, Impact Tremors, Sovereign's Bite) as before.
//  INV-8 a targeted spell's cast line names its target: a spell on the stack too (Counterspell at the AI's Lightning
//        Bolt read "Blue casts Counterspell"); creatures, players, two targets, the AI's casts as before.
//  Finding 5: Fact or Fiction's split says the cards picked are pile 1 and who chooses, with no library-search hint
//        (the cards are revealed ones, not a library's); Forge's three pile titles.
//  Finding 8: an edict's sacrifice names the spell (Forge's cause on the move).
//   node tests/test_bridge_ability_sweep2.js
// (BRIDGE_PATH=<a copy> loads a copy instead: tools/mutate-ability-sweep2.js breaks one so a check fails by name.)
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
const put = (b, zone, c, ownerId = "player-0") => { const z = b.zones.find((x) => x.zone === zone && x.ownerId === ownerId); z.cards.push(c); z.count = z.cards.length; };
const card = (n, name, types, extra = {}) => ({ id: `engine-card-${n}`, identity: { name }, types, controllerId: "player-0", ...extra });
const id = (n) => `engine-card-${n}`;
const board = (fill, me = 40, ai = 40) => { const b = blank(); b.players = [{ id: "player-0", life: me }, { id: "player-1", life: ai }]; fill(b); return b; };
function setup(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  return seat;
}
// two boards and Forge's events between them -> the log lines
const between = (before, after, events) => {
  const h = harness.load();
  setup(h);
  try { return h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after, h.B.engineFacts(events)); } finally { harness.restore(); }
};
const move = (seq, from, to, cardId, ownerId = "player-0", extra = {}) => ({ seq, cardId, from, to, ownerId, ...extra });
const hit = (seq, src, player, amount, combat = false) => ({ seq, kind: "damage", sourceCardId: src, targetPlayerId: player, amount, combat, to: "Damage" });
// a stack item as Forge sends it
const item = (sid, src, name, text, targets, extra = {}) => ({ controllerId: "player-0", id: sid, identity: { name }, isPermanentSpell: false, ownerId: "player-0",
  sourceAbilityText: text, sourceId: id(src), targets, text: `${name} (${src}) - ${text}`, ...extra });
const AT_AI = [{ id: "player-1", kind: "player", intent: "hostile" }];
const lifeLines = (lines) => lines.filter((l) => / life \(/.test(l));

(async () => {
  // ── INV-1: a life loss names its source
  {
    // Galvanic Blast at AI 1 with metalcraft: its words say 2, the engine dealt 4 (the spec's kw-02 example)
    const GB = "Galvanic Blast deals 2 damage to any target.\nMetalcraft — Galvanic Blast deals 4 damage instead if you control three or more artifacts.";
    const cast = board((b) => b.stack.push(item("engine-stack-1", 50, "Galvanic Blast", GB, AT_AI)), 40, 38);
    const done = board((b) => put(b, "graveyard", card(50, "Galvanic Blast", ["Instant"])), 40, 34);
    same("INV-1 Galvanic Blast's metalcraft 4: the engine's damage entry names it", lifeLines(between(cast, done, [move(11, "Stack", "Graveyard", id(50)), hit(12, id(50), "player-1", 4)])),
      ["AI 1: 38 -> 34 life (-4, damage from Galvanic Blast)"]);
    same("INV-1 Galvanic Blast without the feed's damage: bare, no guess at 2 or 4", lifeLines(between(cast, done, [move(11, "Stack", "Graveyard", id(50))])), ["AI 1: 38 -> 34 life (-4)"]);
    // Fireball with X = 5
    const FB = "Fireball deals X damage divided as you choose among any number of targets. Fireball costs {1} more to cast for each target beyond the first.";
    same("INV-1 an X spell: the engine's amount, named",
      lifeLines(between(board((b) => b.stack.push(item("engine-stack-2", 51, "Fireball", FB, AT_AI))), board((b) => put(b, "graveyard", card(51, "Fireball", ["Sorcery"])), 40, 35),
        [move(11, "Stack", "Graveyard", id(51)), hit(12, id(51), "player-1", 5)])),
      ["AI 1: 40 -> 35 life (-5, damage from Fireball)"]);
    // Impact Tremors' triggers that came and went between two boards (none seen on a stack), three of them
    const TREMORS = card(53, "Impact Tremors", ["Enchantment"], { text: "Whenever a creature you control enters, Impact Tremors deals 1 damage to each opponent." });
    const quiet = (ai) => board((b) => put(b, "battlefield", TREMORS), 40, ai);
    same("INV-1 triggers between two boards: each entry, counted",
      lifeLines(between(quiet(40), quiet(37), [hit(11, id(53), "player-1", 1), hit(12, id(53), "player-1", 1), hit(13, id(53), "player-1", 1)])),
      ["AI 1: 40 -> 37 life (-3, damage from Impact Tremors ×3)"]);
    same("INV-1 two sources between two boards: both", lifeLines(between(board((b) => { put(b, "battlefield", TREMORS); put(b, "battlefield", card(54, "Goblin Bombardment", ["Enchantment"])); }),
      board((b) => { put(b, "battlefield", TREMORS); put(b, "battlefield", card(54, "Goblin Bombardment", ["Enchantment"])); }, 40, 37), [hit(11, id(53), "player-1", 1), hit(12, id(54), "player-1", 2)])),
      ["AI 1: 40 -> 37 life (-3, damage from Impact Tremors; damage from Goblin Bombardment)"]);
    same("INV-1 a combat entry says combat damage", lifeLines(between(board((b) => put(b, "battlefield", card(55, "Hill Giant", ["Creature"]))), board((b) => put(b, "battlefield", card(55, "Hill Giant", ["Creature"])), 40, 37),
      [hit(11, id(55), "player-1", 3, true)])), ["AI 1: 40 -> 37 life (-3, combat damage from Hill Giant)"]);
    same("INV-1 a source the bridge has never seen: bare", lifeLines(between(quiet(40), quiet(38), [hit(11, id(99), "player-1", 2)])), ["AI 1: 40 -> 38 life (-2)"]);
    same("INV-1 the entries don't add up to the loss (a loss of another kind too): bare", lifeLines(between(quiet(40), quiet(36), [hit(11, id(53), "player-1", 1)])), ["AI 1: 40 -> 36 life (-4)"]);
    same("INV-1 an entry at the other player isn't this one's", lifeLines(between(quiet(40), board((b) => put(b, "battlefield", TREMORS), 39, 40), [hit(11, id(53), "player-1", 1)])), ["Blue: 40 -> 39 life (-1)"]);
    // the board-read cases as before: Lightning Bolt's words, Sovereign's Bite's drain, a trigger seen on the stack
    same("INV-1 Lightning Bolt, by its words (no feed)",
      lifeLines(between(board((b) => b.stack.push(item("engine-stack-3", 56, "Lightning Bolt", "Lightning Bolt deals 3 damage to any target.", AT_AI))), board((b) => put(b, "graveyard", card(56, "Lightning Bolt", ["Instant"])), 40, 37),
        [move(11, "Stack", "Graveyard", id(56))])), ["AI 1: 40 -> 37 life (-3, damage from Lightning Bolt)"]);
    same("INV-1 Sovereign's Bite's drain, both lines",
      lifeLines(between(board((b) => b.stack.push(item("engine-stack-4", 57, "Sovereign's Bite", "Target player loses 3 life and you gain 3 life.", [{ id: "player-1", kind: "player" }]))),
        board((b) => put(b, "graveyard", card(57, "Sovereign's Bite", ["Sorcery"])), 43, 37), [move(11, "Stack", "Graveyard", id(57))])),
      ["Blue: 40 -> 43 life (+3, Sovereign's Bite)", "AI 1: 40 -> 37 life (-3, Sovereign's Bite)"]);
    same("INV-1 the board's own reading wins over the feed (one line, not both)",
      lifeLines(between(board((b) => b.stack.push(item("engine-stack-3", 56, "Lightning Bolt", "Lightning Bolt deals 3 damage to any target.", AT_AI))), board((b) => put(b, "graveyard", card(56, "Lightning Bolt", ["Instant"])), 40, 37),
        [move(11, "Stack", "Graveyard", id(56)), hit(12, id(56), "player-1", 3)])), ["AI 1: 40 -> 37 life (-3, damage from Lightning Bolt)"]);
  }

  // ── INV-8: a targeted spell's cast line names its target
  {
    const WURM = card(70, "Craw Wurm", ["Creature"], { controllerId: "player-1" });
    const BEAR = card(71, "Grizzly Bears", ["Creature"]);
    const castLine = (fill, it) => between(board((b) => { fill(b); }), board((b) => { fill(b); b.stack.push(...it); }), []).filter((l) => / casts /.test(l));
    const AI_BOLT = { ...item("engine-stack-22", 62, "Lightning Bolt", "Lightning Bolt deals 3 damage to any target.", [{ id: "player-0", kind: "player" }]), controllerId: "player-1", ownerId: "player-1" };
    same("INV-8 Counterspell at the AI's Lightning Bolt names the spell",
      between(board((b) => b.stack.push(AI_BOLT)), board((b) => b.stack.push(AI_BOLT, item("engine-stack-23", 63, "Counterspell", "Counter target spell.", [{ id: "engine-stack-22", kind: "spell" }]))), []).filter((l) => /Counterspell/.test(l)),
      ["Blue casts Counterspell targeting Lightning Bolt"]);
    same("INV-8 Swords to Plowshares at a creature", castLine((b) => put(b, "battlefield", WURM, "player-1"),
      [item("engine-stack-20", 60, "Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power.", [{ id: id(70), kind: "card" }])]), ["Blue casts Swords to Plowshares targeting Craw Wurm"]);
    same("INV-8 Prey Upon's two targets", castLine((b) => { put(b, "battlefield", BEAR); put(b, "battlefield", WURM, "player-1"); },
      [item("engine-stack-20", 60, "Prey Upon", "Target creature you control fights target creature you don't control.", [{ id: id(71), kind: "card" }, { id: id(70), kind: "card" }])]), ["Blue casts Prey Upon targeting Grizzly Bears and Craw Wurm"]);
    same("INV-8 the AI's spell at a player", castLine(() => {}, [AI_BOLT]), ["AI 1 casts Lightning Bolt targeting Blue"]);
    same("INV-8 a spell with no target says none", castLine(() => {}, [item("engine-stack-24", 64, "Divination", "Draw two cards.", [])]), ["Blue casts Divination"]);
  }

  // ── finding 8: an edict's sacrifice names the spell
  {
    const WURM = card(70, "Craw Wurm", ["Creature"], { controllerId: "player-1" });
    same("finding 8: Diabolic Edict's sacrifice names it",
      between(board((b) => { put(b, "battlefield", WURM, "player-1"); b.stack.push(item("engine-stack-5", 63, "Diabolic Edict", "Target player sacrifices a creature.", [{ id: "player-1", kind: "player" }])); }),
        board((b) => { put(b, "graveyard", WURM, "player-1"); put(b, "graveyard", card(63, "Diabolic Edict", ["Instant"])); }),
        [move(11, "Battlefield", "Graveyard", id(70), "player-1", { how: "sacrificed", cause: "Sacrifice", causeName: "Diabolic Edict", causeCardId: id(63) }), move(12, "Stack", "Graveyard", id(63))]).filter((l) => /sacrificed/.test(l)),
      ["Craw Wurm is sacrificed (Diabolic Edict)"]);
  }

  // ── finding 5: Fact or Fiction's split
  {
    const FOF = "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put all cards from the pile of your choice into your hand and the other into your graveyard.";
    const cards = ["Island", "Opt", "Counterspell", "Brainstorm", "Ponder"].map((n, i) => ({ id: id(30 + i), identity: { name: n }, types: ["Instant"], ownerId: "player-1", controllerId: "player-1" }));
    for (const [title, pile, tail] of [["Divide cards into two piles", "pile 1", "AI 1 chooses one pile next\\."], ["Select cards for the left pile", "the left pile", "Then the piles are used as they are\\."], ["Select cards for a face down pile", "the face-down pile", "AI 1 chooses one pile next\\."]]) {
      const h = harness.load();
      const seat = setup(h);
      seat.board = { state: { gameView: { turn: 4, step: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", zones: [], players: [{ id: "player-0" }, { id: "player-1" }],
        stack: [{ id: "engine-stack-1", sourceId: id(9), controllerId: "player-1", identity: { name: "Fact or Fiction" }, sourceAbilityText: FOF }] } } };
      h.B.onPrompt(seat, { promptId: 5, decidingPlayerId: "player-0", sourceCard: { id: id(9), identity: { name: "Fact or Fiction" }, controllerId: "player-1", text: FOF }, sourceAbilityText: FOF,
        input: { type: "chooseCards", cards, min: 0, max: 5, presentation: { title } } });
      await h.flush();
      const p = h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.promptId != null).pop()?.tts;
      harness.restore();
      ok(`finding 5 (${title}): the title says the picks make ${pile}`, p?.title === `Fact or Fiction: split 5 cards into two piles: pick the cards for ${pile}`, p?.title);
      ok(`finding 5 (${title}): the text says the rest is the other pile and who chooses`, new RegExp(`^The cards you pick are ${pile}; the rest are the other pile \\(either may be empty\\)\\. ${tail}`).test(p?.text || ""), p?.text);
      ok(`finding 5 (${title}): no library search (the cards are revealed ones)`, !/right-click your library/.test(p?.text || "") && p?.librarySearch == null, p?.text);
    }
  }

  // the splitter is the spell's controller (Steam Augury, Choose Your Demise: Separator You, Chooser Opponent): an opponent chooses
  {
    const FOF = "Reveal the top five cards. Separate them into two piles. An opponent chooses one.";
    const cards = ["Island", "Opt"].map((n, i) => ({ id: id(30 + i), identity: { name: n }, types: ["Instant"], ownerId: "player-0", controllerId: "player-0" }));
    const h = harness.load();
    const seat = setup(h);
    seat.board = { state: { gameView: { turn: 4, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", zones: [], players: [{ id: "player-0" }, { id: "player-1" }],
      stack: [{ id: "engine-stack-1", sourceId: id(9), controllerId: "player-0", identity: { name: "Steam Augury" }, sourceAbilityText: FOF }] } } };
    h.B.onPrompt(seat, { promptId: 5, decidingPlayerId: "player-0", sourceCard: { id: id(9), identity: { name: "Steam Augury" }, controllerId: "player-0", text: FOF }, sourceAbilityText: FOF,
      input: { type: "chooseCards", cards, min: 0, max: 2, presentation: { title: "Divide cards into two piles" } } });
    await h.flush();
    const p = h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.promptId != null).pop()?.tts;
    harness.restore();
    ok("finding 5: when the controller splits, an opponent chooses", /An opponent chooses one pile next\./.test(p?.text || ""), p?.text);
  }

  console.log(failed ? `FAILED: ${failed} of ${failed + passed}` : `PASSED: ${passed} checks`);
  process.exit(failed ? 1 : 0);
})();
