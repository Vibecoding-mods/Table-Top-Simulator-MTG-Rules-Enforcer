// The log told from Forge's own events (GameViewDto.events) rather than worked out from two boards. Every expected line
// here is what happened by the rules: each case is one the boards alone get wrong or can't tell, so it fails if the log
// goes back to guessing. Only one seat is at the table in each case, the board is fed straight to the log.
//   node tests/test_bridge_events.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
const put = (b, zone, card, ownerId = "player-0") => { const z = b.zones.find((x) => x.zone === zone && x.ownerId === ownerId); z.cards.push(card); z.count = z.cards.length; };
const count = (b, zone, n, ownerId = "player-0") => { b.zones.find((x) => x.zone === zone && x.ownerId === ownerId).count = n; };
const card = (n, name, types, extra = {}) => ({ id: `engine-card-${n}`, identity: { name, ...(extra.token ? { isToken: true } : {}) }, types, controllerId: "player-0" });
const BEAR = (n = 1) => card(n, "Grizzly Bears", ["Creature"]);
const SWORD = (n = 2) => card(n, "Bonesplitter", ["Artifact"]);
const LAND = (n = 3) => card(n, "Mountain", ["Land"]);
const BOLT = (n = 4) => card(n, "Lightning Bolt", ["Instant"]);
const TOKEN = (n = 5) => card(n, "Goblin Token", ["Creature"], { token: true });
const SPELL = { id: "stack-1", sourceId: "engine-card-9", identity: { name: "Lightning Bolt" }, controllerId: "player-1" };

function setup(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  return seat;
}
// two boards and what Forge says happened between them, out comes the log. The library count is set by the case.
const between = (before, after, events) => {
  const h = harness.load();
  setup(h);
  const facts = h.B.engineFacts(events);
  return h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after, facts);
};
const ev = (seq, from, to, cardId, how, ownerId = "player-0", cause = {}) => ({ seq, ...(cardId ? { cardId } : {}), ...(from ? { from } : {}), to, ownerId, ...(how ? { how } : {}), ...cause });
const board = (fill) => { const b = blank(); fill(b); return b; };
const id = (n) => `engine-card-${n}`;

(async () => {
  // what leaves the battlefield says how, which no board shows
  same("sacrificed: a creature with no stack to say so is sacrificed, not dead",
    between(board((b) => put(b, "battlefield", BEAR())), board((b) => put(b, "graveyard", BEAR())), [ev(11, "Battlefield", "Graveyard", id(1), "sacrificed")]),
    ["Grizzly Bears is sacrificed"]);
  same("destroyed: a noncreature permanent is destroyed, not 'goes to the graveyard'",
    between(board((b) => put(b, "battlefield", SWORD())), board((b) => put(b, "graveyard", SWORD())), [ev(11, "Battlefield", "Graveyard", id(2), "destroyed")]),
    ["Bonesplitter is destroyed"]);
  same("destroyed: a creature destroyed dies",
    between(board((b) => put(b, "battlefield", BEAR())), board((b) => put(b, "graveyard", BEAR())), [ev(11, "Battlefield", "Graveyard", id(1), "destroyed")]),
    ["Grizzly Bears dies"]);
  same("moved: put into a graveyard by no rule named stays plain",
    between(board((b) => put(b, "battlefield", SWORD())), board((b) => put(b, "graveyard", SWORD())), [ev(11, "Battlefield", "Graveyard", id(2))]),
    ["Bonesplitter goes to the graveyard"]);

  // the Rust engine and an older Forge send an empty list for good: the log has to go on working from the boards
  same("no feed: an empty list still logs the draw", between(board((b) => { count(b, "hand", 3); count(b, "library", 50); }), board((b) => { count(b, "hand", 4); count(b, "library", 49); }), []), ["Blue draws a card"]);
  // a rewind's board is the log's new start: it says nothing, and what Forge moved before it isn't told after it
  {
    const h = harness.load();
    setup(h);
    const g = h.B._getGame();
    const pub = (events, fill) => Object.assign(board(fill), { events });
    g.logPrev = null;
    const restored = [ev(11, "Battlefield", "Graveyard", id(1), "sacrificed"), ev(12, "Battlefield", "Graveyard", id(2), "destroyed")];
    h.B.updateLog(pub(restored, (b) => { put(b, "battlefield", BEAR()); put(b, "battlefield", SWORD()); }));
    same("rewind: the board it went back to reads the ring to its end", g.eventSeq, 12);
    same("rewind: and logs nothing", g.log ?? [], []);
    h.B.updateLog(pub([...restored, ev(13, "Battlefield", "Graveyard", id(1), "sacrificed")], (b) => { put(b, "graveyard", BEAR()); put(b, "battlefield", SWORD()); }));
    same("rewind: the next move is a fact, and only it", g.log, ["Grizzly Bears is sacrificed"]);
  }

  // a card gone from every public zone: the boards can't tell where to
  const gone = (c, events, after = () => {}) => between(board((b) => put(b, "battlefield", c)), board(after), events);
  same("token: sacrificed", gone(TOKEN(), [ev(11, "Battlefield", "Graveyard", id(5), "sacrificed")]), ["Goblin token is sacrificed"]);
  same("token: dies", gone(TOKEN(), [ev(11, "Battlefield", "Graveyard", id(5), "destroyed")]), ["Goblin token dies"]);
  same("token: exiled", gone(TOKEN(), [ev(11, "Battlefield", "Exile", id(5))]), ["Goblin token is exiled"]);
  // (a bounced token: sweep's Everywhere read "leaves the battlefield", mechanic run hp-23)
  same("token: returned to the hand", gone(TOKEN(), [ev(11, "Battlefield", "Hand", id(5))]), ["Goblin token returns to Blue's hand and ceases to exist"]);
  same("token: no event, no guess of the hand", gone(TOKEN(), []), ["Goblin token leaves the battlefield"]);
  // (the token's owner's hand, not the seat's: an opponent's token bounced, suite review 2026-11-05)
  same("token: an opponent's token returned to its owner's hand",
    between(board((b) => put(b, "battlefield", { ...TOKEN(), controllerId: "player-1" }, "player-1")), board(() => {}), [ev(11, "Battlefield", "Hand", id(5), null, "player-1")]),
    ["Goblin token returns to AI 1's hand and ceases to exist"]);
  same("bounced: back to a hand no fuller than before (a discard beside it)",
    between(board((b) => { put(b, "battlefield", BEAR()); count(b, "hand", 3); }), board((b) => count(b, "hand", 3)), [ev(11, "Battlefield", "Hand", id(1))]),
    ["Grizzly Bears returns to Blue's hand"]);
  same("bounced, no feed: two permanents gone and the hand one fuller: only one went there",
    between(board((b) => { put(b, "battlefield", BEAR()); put(b, "battlefield", SWORD()); count(b, "hand", 3); }), board((b) => count(b, "hand", 4)), []),
    ["Grizzly Bears returns to Blue's hand", "Bonesplitter leaves the battlefield"]);
  same("face down: a face-down permanent gone says only that it left, never what it was",
    between(board((b) => { put(b, "battlefield", { ...BEAR(), isFaceDown: true }); count(b, "hand", 3); }), board((b) => count(b, "hand", 4)), [ev(11, "Battlefield", "Hand", null)]),
    ["A face-down card leaves the battlefield"]);
  same("tucked: into the library, not the hand, the hand one fuller by a draw",
    between(board((b) => { put(b, "battlefield", BEAR()); count(b, "hand", 3); count(b, "library", 50); }),
      board((b) => { count(b, "hand", 4); count(b, "library", 50); }),
      [ev(11, "Battlefield", "Library", id(1)), ev(12, "Library", "Hand", null, "draw")]),
    ["Blue draws a card", "Grizzly Bears is put into Blue's library"]);

  // the hand and the library
  const lib = (n, hand = 3) => (b) => { count(b, "hand", hand); count(b, "library", n); };
  same("draw: said", between(board(lib(50)), board(lib(49, 4)), [ev(11, "Library", "Hand", null, "draw")]), ["Blue draws a card"]);
  same("draw: two", between(board(lib(50)), board(lib(48, 5)), [ev(11, "Library", "Hand", null, "draw"), ev(12, "Library", "Hand", null, "draw")]), ["Blue draws 2 cards"]);
  same("search: a card from the library that wasn't drawn isn't a draw", between(board(lib(50)), board(lib(49, 4)), [ev(11, "Library", "Hand")]), ["Blue puts a card from their library into their hand"]);
  same("draw and discard level: the hand doesn't grow and a draw still happened",
    between(board((b) => { lib(50)(b); put(b, "hand", BEAR()); }), board((b) => { lib(49)(b); put(b, "graveyard", BEAR()); }),
      [ev(11, "Library", "Hand", null, "draw"), ev(12, "Hand", "Graveyard", id(1), "discard")]),
    ["Blue draws a card", "Blue discards Grizzly Bears"]);
  same("discard then draw, as Forge did them (Fable's chapter II, rebuilt re-test)",
    between(board((b) => { lib(50)(b); put(b, "hand", BEAR()); put(b, "hand", SWORD()); }), board((b) => { lib(48)(b); put(b, "graveyard", BEAR()); put(b, "graveyard", SWORD()); }),
      [ev(11, "Hand", "Graveyard", id(1), "discard"), ev(12, "Hand", "Graveyard", id(2), "discard"), ev(13, "Library", "Hand", null, "draw"), ev(14, "Library", "Hand", null, "draw")]),
    ["Blue discards Grizzly Bears, Bonesplitter", "Blue draws 2 cards"]);
  same("and each player's in their own order (AI 1 draws first)",
    between(board((b) => { lib(50)(b); lib(50)(b); count(b, "hand", 3, "player-1"); count(b, "library", 50, "player-1"); put(b, "hand", BEAR()); }),
      board((b) => { lib(49)(b); count(b, "hand", 4, "player-1"); count(b, "library", 49, "player-1"); put(b, "graveyard", BEAR()); }),
      [ev(11, "Library", "Hand", null, "draw", "player-1"), ev(12, "Hand", "Graveyard", id(1), "discard"), ev(13, "Library", "Hand", null, "draw")]),
    ["AI 1 draws a card", "Blue discards Grizzly Bears", "Blue draws a card"]);
  // (by each one's FIRST: a draw before the discard puts the draws first, however many follow; a discard before the
  // draw, the discard first)
  same("draw, discard, draw: the draws first",
    between(board((b) => { lib(50)(b); put(b, "hand", BEAR()); }), board((b) => { lib(48)(b); put(b, "graveyard", BEAR()); }),
      [ev(11, "Library", "Hand", null, "draw"), ev(12, "Hand", "Graveyard", id(1), "discard"), ev(13, "Library", "Hand", null, "draw")]),
    ["Blue draws 2 cards", "Blue discards Grizzly Bears"]);
  same("discard, draw, discard: the discards first",
    between(board((b) => { lib(50)(b); put(b, "hand", BEAR()); put(b, "hand", SWORD()); }), board((b) => { lib(49)(b); put(b, "graveyard", BEAR()); put(b, "graveyard", SWORD()); }),
      [ev(11, "Hand", "Graveyard", id(1), "discard"), ev(12, "Library", "Hand", null, "draw"), ev(13, "Hand", "Graveyard", id(2), "discard")]),
    ["Blue discards Grizzly Bears, Bonesplitter", "Blue draws a card"]);
  same("discards: one line for several",
    between(board((b) => lib(50, 5)(b)), board((b) => { lib(50, 3)(b); put(b, "graveyard", BEAR()); put(b, "graveyard", SWORD()); }),
      [ev(11, "Hand", "Graveyard", id(1), "discard"), ev(12, "Hand", "Graveyard", id(2), "discard")]),
    ["Blue discards Grizzly Bears, Bonesplitter"]);
  // (the last turn's cleanup discard, seen on the next turn's first board, goes above that turn's header and keeps it:
  // the insert at the top moved the attack's place and the header was cut in its stead, live check 2026-11-07, "White
  // discards Blasphemous Act", "", "AI 1 draws a card")
  const nextTurn = (b) => { b.turn = 4; b.step = "draw"; b.activePlayerId = "player-1"; b.priorityPlayerId = "player-1"; };
  same("cleanup discard on the next turn's board: above the header, which stays",
    between(board((b) => { lib(50, 8)(b); count(b, "hand", 3, "player-1"); count(b, "library", 50, "player-1"); put(b, "hand", BEAR()); }),
      board((b) => { nextTurn(b); lib(50, 7)(b); count(b, "hand", 4, "player-1"); count(b, "library", 49, "player-1"); put(b, "graveyard", BEAR()); }),
      [ev(11, "Hand", "Graveyard", id(1), "discard"), ev(12, "Library", "Hand", null, "draw", "player-1")]),
    ["Blue discards Grizzly Bears", "--- AI 1's turn 1 ---", "AI 1 draws a card"]);
  {
    // (and with an attack on the same board: the attack goes in its own place, the header stays)
    const atk = { ...BEAR(6), controllerId: "player-1" };
    same("cleanup discard on the next turn's board with an attack: the header and the attack both kept",
      between(board((b) => { lib(50, 8)(b); count(b, "hand", 3, "player-1"); count(b, "library", 50, "player-1"); put(b, "hand", BEAR()); put(b, "battlefield", atk, "player-1"); }),
        board((b) => { nextTurn(b); b.step = "declareAttackers"; lib(50, 7)(b); count(b, "hand", 4, "player-1"); count(b, "library", 49, "player-1"); put(b, "graveyard", BEAR()); put(b, "battlefield", { ...atk, isAttacking: true, tapped: true }, "player-1"); }),
        [ev(11, "Hand", "Graveyard", id(1), "discard"), ev(12, "Library", "Hand", null, "draw", "player-1")]),
      ["Blue discards Grizzly Bears", "--- AI 1's turn 1 ---", "AI 1 attacks with Grizzly Bears", "AI 1 draws a card"]);
  }
  same("milled: named by Forge with the hand as it was",
    between(board(lib(50)), board((b) => { lib(49)(b); put(b, "graveyard", BEAR()); }), [ev(11, "Library", "Graveyard", id(1))]),
    ["Blue mills Grizzly Bears"]);
  same("milled: a name that was on the stack is still milled",
    between(board((b) => { lib(50)(b); put(b, "graveyard", BOLT(9)); b.stack = [SPELL]; }),
      board((b) => { lib(49)(b); put(b, "graveyard", BOLT(9)); put(b, "graveyard", BOLT()); b.stack = [SPELL]; }),
      [ev(11, "Library", "Graveyard", id(4))]),
    ["Blue mills Lightning Bolt"]);
  same("milled, Forge not naming the card: counted all the same",
    between(board(lib(50)), board((b) => { lib(49)(b); put(b, "graveyard", BEAR()); }), [ev(11, "Library", "Graveyard")]),
    ["Blue mills Grizzly Bears"]);
  same("surveil, Forge not naming the card: not counted as a mill",
    between(board(lib(50)), board((b) => { lib(49)(b); put(b, "graveyard", BEAR()); }), [ev(11, "Library", "Graveyard", null, "surveil")]),
    ["Grizzly Bears is put into Blue's graveyard"]);
  same("exiled from the library, the library no smaller for a card going back",
    between(board(lib(50)), board((b) => { lib(50)(b); put(b, "exile", BEAR()); }), [ev(11, "Library", "Exile", id(1)), ev(12, "Hand", "Library")]),
    ["Grizzly Bears is exiled from Blue's library"]);
  same("exiled from the library, Forge not naming the card: counted all the same",
    between(board(lib(50)), board((b) => { lib(49)(b); put(b, "exile", BEAR()); }), [ev(11, "Library", "Exile")]),
    ["Grizzly Bears is exiled from Blue's library"]);
  same("exiled from the hand beside a mill: only the mill came from the library",
    between(board(lib(50, 4)), board((b) => { lib(49)(b); put(b, "graveyard", BEAR()); put(b, "exile", SWORD()); }),
      [ev(11, "Library", "Graveyard", id(1)), ev(12, "Hand", "Exile", id(2))]),
    ["Blue mills Grizzly Bears", "Bonesplitter is exiled"]);
  same("surveil: into the graveyard by surveil isn't a mill",
    between(board(lib(50)), board((b) => { lib(49)(b); put(b, "graveyard", BEAR()); }), [ev(11, "Library", "Graveyard", id(1), "surveil")]),
    ["Blue surveils, putting Grizzly Bears into their graveyard"]);

  // what moved a card out of a library, by Forge's cause: each mechanic worded as the move it made, its name a label
  const into = (...cards) => (b) => { lib(50 - cards.length)(b); for (const c of cards) put(b, "graveyard", c); };
  const DARK = (n = 6) => card(n, "Darkblast", ["Instant"]);
  same("surveil: by its cause alone, before Forge marks how",
    between(board(lib(50)), board(into(BEAR())), [ev(11, "Library", "Graveyard", id(1), null, "player-0", { cause: "Surveil", causeName: "Consider" })]),
    ["Blue surveils, putting Grizzly Bears into their graveyard"]);
  same("mill: Forge's mill, by a mill effect, is a mill",
    between(board(lib(50)), board(into(BEAR())), [ev(11, "Library", "Graveyard", id(1), "mill", "player-0", { cause: "Mill", causeName: "Thought Scour" })]),
    ["Blue mills Grizzly Bears"]);
  same("mill: by a mill effect alone, before Forge marks how",
    between(board(lib(50)), board(into(BEAR())), [ev(11, "Library", "Graveyard", id(1), null, "player-0", { cause: "Mill", causeName: "Thought Scour" })]),
    ["Blue mills Grizzly Bears"]);
  same("put: into the graveyard by an effect that isn't a mill isn't one",
    between(board(lib(50)), board(into(BEAR())), [ev(11, "Library", "Graveyard", id(1), null, "player-0", { cause: "Dig", causeName: "Grisly Salvage" })]),
    ["Blue puts Grizzly Bears into their graveyard from their library"]);
  same("explore: the revealed card into the graveyard is the explore's, not a mill",
    between(board(lib(50)), board(into(BEAR())), [ev(11, "Library", "Graveyard", id(1), null, "player-0", { cause: "Explore", causeName: "Jadelight Ranger" })]),
    ["Jadelight Ranger explores: Blue puts Grizzly Bears into their graveyard"]);
  same("explore: a land revealed goes to the hand, said with the explore",
    between(board(lib(50)), board(lib(49, 4)), [ev(11, "Library", "Hand", null, null, "player-0", { cause: "Explore", causeName: "Jadelight Ranger" })]),
    ["Blue puts a card from their library into their hand (Jadelight Ranger explores)"]);
  {
    const dredged = { cause: "Darkblast - Dredge 3" };
    const milled3 = (b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", SWORD()); put(b, "graveyard", LAND()); };
    same("dredge: the mill and the card back in one line, instead of a draw",
      between(board((b) => { lib(50)(b); put(b, "graveyard", DARK()); }), board((b) => { lib(47, 4)(b); milled3(b); }),
        [ev(11, "Library", "Graveyard", id(1), "mill", "player-0", dredged), ev(12, "Library", "Graveyard", id(2), "mill", "player-0", dredged),
          ev(13, "Library", "Graveyard", id(3), "mill", "player-0", dredged), ev(14, "Graveyard", "Hand", id(6), null, "player-0", dredged)]),
      ["Blue dredges Darkblast instead of drawing (dredge 3), milling Grizzly Bears, Bonesplitter, Mountain"]);
    same("dredge: with a draw beside it, each said",
      between(board((b) => { lib(50)(b); put(b, "graveyard", DARK()); }), board((b) => { lib(46, 5)(b); milled3(b); }),
        [ev(11, "Library", "Hand", null, "draw"), ev(12, "Library", "Graveyard", id(1), "mill", "player-0", dredged), ev(13, "Library", "Graveyard", id(2), "mill", "player-0", dredged),
          ev(14, "Library", "Graveyard", id(3), "mill", "player-0", dredged), ev(15, "Graveyard", "Hand", id(6), null, "player-0", dredged)]),
      ["Blue draws a card", "Blue dredges Darkblast instead of drawing (dredge 3), milling Grizzly Bears, Bonesplitter, Mountain"]);
  }
  same("two kinds at once: each its own line",
    between(board(lib(50)), board(into(BEAR(), SWORD())), [ev(11, "Library", "Graveyard", id(1), "mill", "player-0", { cause: "Mill", causeName: "Thought Scour" }),
      ev(12, "Library", "Graveyard", id(2), "surveil", "player-0", { cause: "Surveil", causeName: "Consider" })]),
    ["Blue mills Grizzly Bears", "Blue surveils, putting Bonesplitter into their graveyard"]);
  same("a graveyard card back to the hand by anything else is still said",
    between(board((b) => { lib(50)(b); put(b, "graveyard", DARK()); }), board(lib(50, 4)), [ev(11, "Graveyard", "Hand", id(6), null, "player-0", { cause: "ChangeZone", causeName: "Raise Dead" })]),
    ["Darkblast is put into Blue's hand from the graveyard"]);
  same("from the hand: into the graveyard without a discard isn't one",
    between(board((b) => lib(50, 4)(b)), board((b) => { lib(50)(b); put(b, "graveyard", BEAR()); }), [ev(11, "Hand", "Graveyard", id(1))]),
    ["Grizzly Bears is put into Blue's graveyard"]);

  // lands: played, or put there
  same("land: played from the hand", between(board(lib(50, 4)), board((b) => { lib(50)(b); put(b, "battlefield", LAND()); }), [ev(11, "Hand", "Battlefield", id(3), "played")]),
    ["Blue plays Mountain"]);
  same("land: put from the hand by an effect is not a land play",
    between(board(lib(50, 4)), board((b) => { lib(50)(b); put(b, "battlefield", LAND()); }), [ev(11, "Hand", "Battlefield", id(3))]),
    ["Blue puts Mountain onto the battlefield"]);
  // (twenty lands put at once read "Mountain, Mountain, Mountain, ..." on the real table, a debug setup 2026-11-05)
  const many = [80, 81, 82, 83, 84, 85, 86].map((n) => LAND(n)).concat([card(87, "Island", ["Land"])]);
  same("land: many put at once are counted by name",
    between(board(lib(50, 8)), board((b) => { lib(50)(b); for (const l of many) put(b, "battlefield", l); }), many.map((l, i) => ev(11 + i, "Hand", "Battlefield", l.id))),
    ["Blue puts Mountain ×7, Island onto the battlefield"]);
  // (an AI's land used to be guessed a play from its land count going up: Forge's word beats the guess)
  const aiLand = () => ({ ...LAND(), controllerId: "player-1" });
  const aiFill = (hand, land) => (b) => { count(b, "hand", hand, "player-1"); if (land) put(b, "battlefield", aiLand(), "player-1"); };
  same("land: an AI's land put from the hand by an effect is not a land play",
    between(board(aiFill(4)), board(aiFill(3, true)), [ev(11, "Hand", "Battlefield", id(3), null, "player-1")]),
    ["AI 1 puts Mountain onto the battlefield"]);
  same("land: an AI's land played is one",
    between(board(aiFill(4)), board(aiFill(3, true)), [ev(11, "Hand", "Battlefield", id(3), "played", "player-1")]),
    ["AI 1 plays Mountain"]);
  same("land: played from a graveyard",
    between(board((b) => put(b, "graveyard", LAND())), board((b) => put(b, "battlefield", LAND())), [ev(11, "Graveyard", "Battlefield", id(3), "played")]),
    ["Blue plays Mountain from Blue's graveyard"]);
  same("land: put from a graveyard stays a return",
    between(board((b) => put(b, "graveyard", LAND())), board((b) => put(b, "battlefield", LAND())), [ev(11, "Graveyard", "Battlefield", id(3))]),
    ["Mountain returns to the battlefield from Blue's graveyard (Blue)"]);
  same("land: played from exile",
    between(board((b) => put(b, "exile", LAND())), board((b) => put(b, "battlefield", LAND())), [ev(11, "Exile", "Battlefield", id(3), "played")]),
    ["Blue plays Mountain from exile"]);

  same("spell: off the stack with no board showing it there was cast",
    between(board(lib(50, 4)), board((b) => { lib(50)(b); put(b, "graveyard", BOLT()); }), [ev(11, "Stack", "Graveyard", id(4))]),
    ["Blue casts Lightning Bolt"]);

  // engineFacts itself
  {
    const h = harness.load();
    setup(h);
    const F = h.B.engineFacts;
    same("feed: an engine with no events is no facts, the boards are read instead", F(undefined), null);
    h.B._getGame().eventSeq = undefined;
    same("feed: the first board has nothing to compare with", F([ev(4, "Hand", "Graveyard", id(1))]), null);
    same("feed: and marks where it read to", h.B._getGame().eventSeq, 4);
    ok("feed: only what's new", !F([ev(4, "Hand", "Graveyard", id(1)), ev(5, "Hand", "Exile", id(2))]).moves.has(id(1)));
    same("feed: behind the ring, entries were lost: no facts", F([ev(9, "Hand", "Exile", id(2))]), null);
    same("feed: and it catches up", h.B._getGame().eventSeq, 9);
    same("feed: an empty list says nothing, so the boards are read", F([]), null);
    same("feed: and it keeps the place it had", h.B._getGame().eventSeq, 9);
    h.B._getGame().eventSeq = undefined;
    same("feed: an empty ring on a game's first board marks the start", [F([]), h.B._getGame().eventSeq], [null, 0]);
    ok("feed: so the game's first move is a fact", F([ev(1, "Hand", "Exile", id(2))])?.moves.has(id(2)));
    h.B._getGame().eventSeq = 9;
    ok("feed: and the next new entry reads on", F([ev(9, "Hand", "Exile", id(2)), ev(10, "Hand", "Exile", id(1))])?.moves.has(id(1)));
    h.B._getGame().eventSeq = 9;
    const m = F([ev(10, "Battlefield", "Graveyard", id(1), "sacrificed"), ev(11, "Graveyard", "Exile", id(1))]).moves.get(id(1));
    same("feed: one move per card, first zone to last, keeping how it left", m, { from: "Battlefield", to: "Exile", how: "sacrificed", through: "Graveyard" });
    same("feed: a single lost entry is lost", F([ev(13, "Hand", "Exile", id(2))]), null);
    h.B._getGame().eventSeq = 11;
    same("feed: and the cause of its first move",
      F([ev(12, "Library", "Graveyard", id(1), "mill", "player-0", { cause: "Mill", causeName: "Glimpse the Unthinkable" }), ev(13, "Graveyard", "Exile", id(1), null, "player-0", { cause: "ChangeZone", causeName: "Bojuka Bog" })]).moves.get(id(1)),
      { from: "Library", to: "Exile", how: "mill", through: "Graveyard", cause: "Mill", causeName: "Glimpse the Unthinkable" });
  }

  // exile, said by its kind (exileKind, EXILE_WORDS)
  same("exile: from another player's graveyard, said as theirs",
    between(board((b) => put(b, "graveyard", BEAR(), "player-1")), board((b) => put(b, "exile", BEAR(), "player-1")),
      [ev(11, "Graveyard", "Exile", id(1), null, "player-1", { cause: "ChangeZone", causeName: "Bojuka Bog" })]),
    ["Grizzly Bears is exiled from AI 1's graveyard"]);
  {
    const EPH = { ...card(8, "Ephemerate", ["Instant"]), keywords: ["Rebound"] };
    const onStack = { id: "stack-2", sourceId: id(8), identity: { name: "Ephemerate" }, controllerId: "player-0" };
    same("exile: rebound is its caster's to cast again, not its owner's",
      between(board((b) => { b.stack = [onStack]; }), board((b) => put(b, "exile", EPH, "player-1")),
        [ev(11, "Stack", "Exile", id(8), null, "player-1")]),
      ["Ephemerate is exiled with rebound: Blue may cast it at their next upkeep"]);
  }
  same("exile: no feed, two cards exiled and one gone from the library: only one came from it",
    between(board(lib(50)), board((b) => { lib(49)(b); put(b, "exile", BEAR()); put(b, "exile", SWORD()); }), []),
    ["Grizzly Bears is exiled from Blue's library", "Bonesplitter is exiled"]);

  // a move made to pay a cost ("Cost:<keyword or cost part>", EngineEventLog): the move's own line, the cost its label
  const EAGLES = (n = 7) => card(n, "Eagles of the North", ["Creature"]);
  const paid = (k, causeName) => ({ cause: `Cost:${k}`, causeName });
  same("cost: cycling's discard says cycling",
    between(board((b) => { lib(50)(b); put(b, "hand", EAGLES()); }), board((b) => { lib(49)(b); put(b, "graveyard", EAGLES()); }),
      [ev(11, "Hand", "Graveyard", id(7), "discard", "player-0", paid("Cycling", "Eagles of the North")), ev(12, "Library", "Hand", null, "draw")]),
    ["Blue discards Eagles of the North (cycling)", "Blue draws a card"]);
  same("cost: a sacrifice paid for another card names it",
    between(board((b) => put(b, "battlefield", BEAR())), board((b) => put(b, "graveyard", BEAR())),
      [ev(11, "Battlefield", "Graveyard", id(1), "sacrificed", "player-0", paid("Sacrifice", "Fling"))]),
    ["Grizzly Bears is sacrificed (to pay for Fling)"]);
  same("cost: a card paying for itself with no keyword says nothing more",
    between(board((b) => put(b, "battlefield", TOKEN())), board((b) => put(b, "graveyard", TOKEN())),
      [ev(11, "Battlefield", "Graveyard", id(5), "sacrificed", "player-0", paid("Sacrifice", "Goblin Token"))]),
    ["Goblin token is sacrificed"]);
  same("cost: a token sacrificed for another card names it, though it is gone from every zone",
    gone(TOKEN(), [ev(11, "Battlefield", "Graveyard", id(5), "sacrificed", "player-0", paid("Sacrifice", "Village Rites"))]),
    ["Goblin token is sacrificed (to pay for Village Rites)"]);
  // (Kykar hand test #2: a token sacrificed to another card's mana ability paid for mana, not for that card; live cause
  // "Cost:Sacrifice", causeName the mana source)
  {
    const KYKAR = { ...card(30, "Kykar, Wind's Fury", ["Creature"]), text: "Flying\nWhenever you cast a noncreature spell, create a 1/1 white Spirit creature token with flying.\nSacrifice a Spirit: Add {R}." };
    const BOMB = { ...card(32, "Goblin Bombardment", ["Enchantment"]), text: "Sacrifice a creature: Goblin Bombardment deals 1 damage to any target." };
    const SPIRIT = card(31, "Spirit Token", ["Creature"], { token: true });
    same("cost: a token sacrificed to another card's mana ability is sacrificed for mana",
      between(board((b) => { put(b, "battlefield", KYKAR); put(b, "battlefield", SPIRIT); }), board((b) => put(b, "battlefield", KYKAR)),
        [ev(11, "Battlefield", "Graveyard", id(31), "sacrificed", "player-0", paid("Sacrifice", "Kykar, Wind's Fury"))]),
      ["Spirit token is sacrificed for mana (Kykar, Wind's Fury)"]);
    same("cost: a sacrifice to a card whose sacrifice makes no mana still says what it paid for",
      between(board((b) => { put(b, "battlefield", BOMB); put(b, "battlefield", SPIRIT); }), board((b) => put(b, "battlefield", BOMB)),
        [ev(11, "Battlefield", "Graveyard", id(31), "sacrificed", "player-0", paid("Sacrifice", "Goblin Bombardment"))]),
      ["Spirit token is sacrificed (to pay for Goblin Bombardment)"]);
  }
  same("cost: delve's cards, one line apart from a plain exile from the same graveyard",
    between(board((b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", SWORD()); put(b, "graveyard", LAND()); }),
      board((b) => { put(b, "exile", BEAR()); put(b, "exile", SWORD()); put(b, "exile", LAND()); }),
      [ev(11, "Graveyard", "Exile", id(1), null, "player-0", paid("Delve", "Treasure Cruise")), ev(12, "Graveyard", "Exile", id(2), null, "player-0", paid("Delve", "Treasure Cruise")),
        ev(13, "Graveyard", "Exile", id(3), null, "player-0", { cause: "ChangeZone", causeName: "Bojuka Bog" })]),
    ["Grizzly Bears, Bonesplitter are exiled from Blue's graveyard (delve for Treasure Cruise)", "Mountain is exiled from Blue's graveyard"]);
  same("cost: escape's exile says escape",
    between(board((b) => put(b, "graveyard", BEAR())), board((b) => put(b, "exile", BEAR())),
      [ev(11, "Graveyard", "Exile", id(1), null, "player-0", paid("Escape", "Uro, Titan of Nature's Wrath"))]),
    ["Grizzly Bears is exiled from Blue's graveyard (escape for Uro, Titan of Nature's Wrath)"]);

  // another player's keyword activation, with no action of ours to say it: by the stack item's text (Forge's real
  // unearth text, keyword sweep 2026-11-03)
  const COURIER = card(6, "Combat Courier", ["Creature"]);
  const used = (text) => between(board((b) => put(b, "graveyard", COURIER, "player-1")),
    board((b) => { put(b, "graveyard", COURIER, "player-1"); b.stack.push({ id: "stack-2", sourceId: id(6), identity: { name: "Combat Courier" }, controllerId: "player-1", sourceAbilityText: text }); }), []);
  same("stack: another player's unearth says unearths", used("Unearth {U} ({U}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)"), ["AI 1 unearths Combat Courier"]);
  same("stack: and an ability with no keyword stays an ability", used("{1}, Exile this card from your graveyard: Draw a card."), ["AI 1 uses Combat Courier's ability"]);
  same("stack: another player's reinforce says reinforces with", used("Reinforce 1— {1}{W} ({1}{W}, Discard this card: Put a +1/+1 counter on target creature.)"), ["AI 1 reinforces with Combat Courier"]);

  // a spell cast with extra costs: the harness's optionalCosts, Forge's OptionalCost names (keyword sweep 2026-11-03)
  const extra = (optionalCosts) => between(board(() => {}), board((b) => b.stack.push({ id: "stack-4", sourceId: id(9), identity: { name: "Llanowar Elite" }, controllerId: "player-1",
    isPermanentSpell: true, ...(optionalCosts ? { optionalCosts } : {}) })), []);
  same("stack: a kicked spell says kicked", extra(["Kicker1"]), ["AI 1 casts Llanowar Elite (kicked)"]);
  same("stack: both kickers, kicked twice", extra(["Kicker1", "Kicker2"]), ["AI 1 casts Llanowar Elite (kicked twice)"]);
  same("stack: an entwined spell says entwined", extra(["Entwine"]), ["AI 1 casts Llanowar Elite (entwined)"]);
  same("stack: two kinds of extra cost, both said", extra(["Bargain", "Kicker1"]), ["AI 1 casts Llanowar Elite (bargained, kicked)"]);
  same("stack: an extra cost said elsewhere or not at all adds nothing", extra(["Retrace", "Buyback", "Generic", "ReduceW"]), ["AI 1 casts Llanowar Elite"]);
  same("stack: and with none, the plain cast", extra(), ["AI 1 casts Llanowar Elite"]);
  same("stack: another player's prototype cast says prototype", extra(["Prototype"]), ["AI 1 casts Llanowar Elite (prototype)"]);
  {
    // (our own prototype cast is already named "(prototype)" by notePlay: said once)
    const hp = harness.load();
    const seat = setup(hp);
    const ASM = card(88, "Autonomous Assembler", ["Artifact", "Creature"]);
    const before = board((b) => put(b, "hand", ASM));
    seat.board = { state: { gameView: before } };
    hp.B.notePlay(seat, { cardId: id(88), type: "cast", label: "Cast Autonomous Assembler (Prototype)", mode: { type: "normal" } }, "Autonomous Assembler", 0);
    const after = board((b) => b.stack.push({ id: "stack-8", sourceId: id(88), identity: { name: "Autonomous Assembler" }, controllerId: "player-0", optionalCosts: ["Prototype"] }));
    same("stack: our own prototype cast says prototype once", hp.B.logEvents(hp.B.logSnapshot(before), hp.B.logSnapshot(after), after, hp.B.engineFacts([])), ["Blue casts Autonomous Assembler (prototype)"]);
  }
  same("stack: another player's cleave cast says cleave", extra(["Cleave"]), ["AI 1 casts Llanowar Elite (cleave)"]);
  {
    // (our own cleave cast, by the harness's label "Cast Dig Up (Cleave)": said once, keyword sweep 2026-11-05)
    const hp = harness.load();
    const seat = setup(hp);
    const DIG = card(89, "Dig Up", ["Sorcery"]);
    const before = board((b) => put(b, "hand", DIG));
    seat.board = { state: { gameView: before } };
    hp.B.notePlay(seat, { cardId: id(89), type: "cast", label: "Cast Dig Up (Cleave)", mode: { type: "normal" } }, "Dig Up", 0);
    const after = board((b) => b.stack.push({ id: "stack-8", sourceId: id(89), identity: { name: "Dig Up" }, controllerId: "player-0", optionalCosts: ["Cleave"] }));
    same("stack: our own cleave cast says cleave once", hp.B.logEvents(hp.B.logSnapshot(before), hp.B.logSnapshot(after), after, hp.B.engineFacts([])), ["Blue casts Dig Up (cleave)"]);
  }
  // (the board before the kicker is chosen shows the spell mid-cast, with no extra costs yet: said once it lands)
  const ELITE = (sid, more) => ({ id: sid, sourceId: id(9), identity: { name: "Llanowar Elite" }, controllerId: "player-1", isPermanentSpell: true, ...more });
  same("stack: a spell still being cast is not said yet",
    between(board(() => {}), board((b) => b.stack.push(ELITE("casting-25463", { isCasting: true }))), []), []);
  same("stack: and once it lands, said with its extra costs",
    between(board((b) => b.stack.push(ELITE("casting-25463", { isCasting: true }))), board((b) => b.stack.push(ELITE("engine-stack-24", { optionalCosts: ["Kicker1"] }))), []),
    ["AI 1 casts Llanowar Elite (kicked)"]);
  const GRIP = (sid) => ({ id: sid, sourceId: id(9), identity: { name: "Dream's Grip" }, controllerId: "player-1", sourceAbilityText: "Tap target permanent.", optionalCosts: ["Kicker1"] });
  same("stack: a copy of a kicked spell is said once kicked, on the cast",
    between(board(() => {}), board((b) => { b.stack.push(GRIP("stack-4")); b.stack.push(GRIP("stack-5")); }), []), ["AI 1 casts Dream's Grip (kicked)", "AI 1 copies Dream's Grip"]);

  // every keyword the sweep found by its stack text (Forge's own strings, keyword sweep 2026-11-03), and its cost's label
  for (const [kw, text, line] of [
    ["Embalm", "Embalm {W} ({W}, Exile this card from your graveyard: Create a token that's a copy of this card, except it's a white Zombie Cat with no mana cost. Embalm only as a sorcery.)", "embalms"],
    ["Eternalize", "Eternalize {4}{U}{U} ({4}{U}{U}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie with no mana cost. Eternalize only as a sorcery.)", "eternalizes"],
    ["Encore", "Encore {3}{R} ({3}{R}, Exile this card from your graveyard: For each opponent, create a token copy that attacks that opponent this turn if able. They gain haste. Sacrifice them at the beginning of the next end step. Activate only as a sorcery.)", "encores"],
    ["Scavenge", "Scavenge {5}{G} ({5}{G}, Exile this card from your graveyard: Put a number of +1/+1 counters equal to this card's power on target creature. Scavenge only as a sorcery.)", "scavenges"],
  ]) {
    same(`stack: another player's ${kw.toLowerCase()} says ${line}`, used(text), [`AI 1 ${line} Combat Courier`]);
    same(`cost: ${kw.toLowerCase()}'s exile says it`, between(board((b) => put(b, "graveyard", BEAR())), board((b) => put(b, "exile", BEAR())),
      [ev(11, "Graveyard", "Exile", id(1), null, "player-0", paid(kw, "Grizzly Bears"))]), [`Grizzly Bears is exiled from Blue's graveyard (${kw.toLowerCase()})`]);
  }
  const SPELL6 = card(6, "Combat Courier", ["Creature"]);
  same("stack: another player's transmute says transmutes",
    between(board((b) => put(b, "hand", SPELL6, "player-1")), board((b) => { put(b, "hand", SPELL6, "player-1"); b.stack.push({ id: "stack-2", sourceId: id(6), identity: { name: "Combat Courier" }, controllerId: "player-1",
      sourceAbilityText: "Transmute {1}{U}{U} ({1}{U}{U}, Discard this card: Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Transmute only as a sorcery.)" }); }), []),
    ["AI 1 transmutes Combat Courier"]);
  same("cost: transmute's discard says transmute",
    between(board((b) => { lib(50)(b); put(b, "hand", EAGLES()); }), board((b) => { lib(50)(b); put(b, "graveyard", EAGLES()); }),
      [ev(11, "Hand", "Graveyard", id(7), "discard", "player-0", paid("Transmute", "Eagles of the North"))]),
    ["Blue discards Eagles of the North (transmute)"]);
  same("cost: reinforce's discard says reinforce",
    between(board((b) => { lib(50)(b); put(b, "hand", EAGLES()); }), board((b) => { lib(50)(b); put(b, "graveyard", EAGLES()); }),
      [ev(11, "Hand", "Graveyard", id(7), "discard", "player-0", paid("Reinforce", "Eagles of the North"))]),
    ["Blue discards Eagles of the North (reinforce)"]);
  same("stack: evoke's sacrifice trigger says evoke",
    between(board((b) => put(b, "battlefield", COURIER, "player-1")), board((b) => { put(b, "battlefield", COURIER, "player-1"); b.stack.push({ id: "stack-2", sourceId: id(6), identity: { name: "Combat Courier" }, controllerId: "player-1",
      sourceAbilityText: "Evoke (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)" }); }), []),
    ["Combat Courier's evoke triggers (AI 1)"]);
  for (const [kw, text] of [
    ["offspring", "Offspring {2} (You may pay an additional {2} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)"],
    ["squad", "Squad {2} (As an additional cost to cast this spell, you may pay {2} any number of times. When this creature enters, create that many tokens that are copies of it.)"],
  ]) same(`stack: ${kw}'s trigger says ${kw}`,
    between(board((b) => put(b, "battlefield", COURIER, "player-1")), board((b) => { put(b, "battlefield", COURIER, "player-1"); b.stack.push({ id: "stack-2", sourceId: id(6), identity: { name: "Combat Courier" }, controllerId: "player-1", sourceAbilityText: text }); }), []),
    [`Combat Courier's ${kw} triggers (AI 1)`]);

  // a spell back in the hand from the stack: buyback's move has no cause, Remand's has its own (keyword sweep)
  const MUSE = { id: "stack-3", sourceId: id(7), identity: { name: "Whispers of the Muse" }, controllerId: "player-1", sourceAbilityText: "Draw a card." };
  // (the feed's draw names its cause, so this engine names causes)
  const back = (cause, causes = true) => between(board((b) => b.stack.push(MUSE)), board(() => {}),
    [...(causes ? [ev(11, "Library", "Hand", null, "draw", "player-1", { cause: "Draw" })] : []), ev(causes ? 12 : 11, "Stack", "Hand", id(7), null, "player-1", cause)]).filter((l) => /Whispers/.test(l));
  same("stack: buyback's spell returns to its hand (buyback)", back({}), ["Whispers of the Muse returns to AI 1's hand (buyback)"]);
  same("stack: one sent back by an effect is no buyback", back({ cause: "ChangeZone", causeName: "Remand" }), ["Whispers of the Muse returns to AI 1's hand"]);
  same("stack: and from an engine that names no causes, no buyback is guessed", back({}, false), ["Whispers of the Muse returns to AI 1's hand"]);
  // the same stack item taken for an ability while its card is still in the graveyard (the casting board of a retrace),
  // then for a spell: no second line
  const CRIME = card(8, "Raven's Crime", ["Sorcery"]);
  const crime = { id: "casting-479", sourceId: id(8), identity: { name: "Raven's Crime" }, controllerId: "player-1", sourceAbilityText: "Target player discards a card.", isCasting: true };
  same("stack: a retrace spell mid-cast, its card still in the graveyard, is no ability used",
    between(board((b) => put(b, "graveyard", CRIME, "player-1")), board((b) => { put(b, "graveyard", CRIME, "player-1"); b.stack.push(crime); }), []), []);
  same("stack: an item under its own stack id is not new again",
    between(board((b) => { put(b, "graveyard", CRIME, "player-1"); b.stack.push(crime); }), board((b) => b.stack.push(crime)), []), []);

  // a cast from the graveyard, by the card's own keyword (Forge's action names none), or by where it was
  const castFrom = (keywords, act = { cardId: id(8), type: "cast", label: "Cast Raven's Crime", mode: { type: "normal" } }) => {
    const h = harness.load();
    const seat = setup(h);
    seat.board = { state: { gameView: board((b) => put(b, "graveyard", { ...card(8, "Raven's Crime", ["Sorcery"]), keywords })) } };
    h.B.notePlay(seat, act, "Raven's Crime", 0);
    return h.B._getGame().pendingPlays.map((e) => e.name);
  };
  same("cast: an ability used from the graveyard keeps its plain name", castFrom(["Retrace"], { cardId: id(8), type: "activateAbility", description: "Unearth {B} (...)" }), ["Raven's Crime"]);
  same("cast: retrace from the graveyard says retrace", castFrom(["Retrace"]), ["Raven's Crime (retrace)"]);
  {
    // one keyword reader: the word, then no more letters (Flashback is not Flash; "Suspend 1—{R}" is Suspend)
    const hk = harness.load().B.hasKeyword;
    same("keyword: Flashback is not Flash, Suspend with its cost is Suspend, Jump-start whole",
      [hk({ keywords: ["Flashback:1 R"] }, "Flash"), hk({ keywords: ["Flash"] }, "Flash"), hk({ keywords: ["Suspend 1—{R}"] }, "Suspend"),
        hk({ keywords: ["Jump-start"] }, "Jump-start"), hk({ keywords: ["Jump"] }, "Jump-start"), hk({}, "Flash")],
      [false, true, true, true, false, false]);
    harness.restore();
  }
  same("cast: jump-start says jump-start", castFrom(["Jump-start"]), ["Raven's Crime (jump-start)"]);
  same("cast: and with no such keyword, from their graveyard", castFrom(["Flying"]), ["Raven's Crime from their graveyard"]);
  same("cast: another word in brackets on a normal cast is no way of casting", castFrom(["Flying"], { cardId: id(8), type: "cast", label: "Cast Raven's Crime (Adventure)", mode: { type: "normal" } }), ["Raven's Crime from their graveyard"]);
  same("cast: a prototype cast says prototype", castFrom(["Prototype:1 W:2:2"], { cardId: id(8), type: "cast", label: "Cast Raven's Crime (Prototype)", mode: { type: "normal" } }), ["Raven's Crime (prototype)"]);

  // the rebuilt decks' hand test (2026-11-04): Mairsil, Fable, copies, Treasures
  const FABLE = card(10, "Fable of the Mirror-Breaker", ["Enchantment"]);
  const onStack = (src, text, extra = {}) => ({ id: "stack-5", sourceId: src.id, identity: { name: src.identity.name }, controllerId: "player-0", sourceAbilityText: text, ...extra });
  const trig = (src, text, extra) => between(board((b) => put(b, "battlefield", src)), board((b) => { put(b, "battlefield", src); b.stack.push(onStack(src, text, extra)); }), []);
  same("#8: a Saga's chapter triggers, by its numeral", trig(FABLE, "I — Create a 2/2 red Goblin Shaman creature token."), ["Fable of the Mirror-Breaker's chapter I triggers (Blue)"]);
  same("#8: two chapters of one ability", trig(FABLE, "I, II — Draw a card."), ["Fable of the Mirror-Breaker's chapter I, II triggers (Blue)"]);
  same("#8: a delayed trigger by Forge's own ending", trig(FABLE, "Sacrifice Goblin Shaman at the beginning of the next end step."), ["Fable of the Mirror-Breaker's ability triggers (Blue)"]);
  same("#8: and any trigger the engine marks as one", trig(FABLE, "Draw a card.", { isTrigger: true }), ["Fable of the Mirror-Breaker's ability triggers (Blue)"]);
  same("#8: an activation ending like a delayed trigger stays used", trig(FABLE, "{1}, {T}: Create a token that's a copy of another target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step."),
    ["Blue uses Fable of the Mirror-Breaker's ability"]);
  same("#8: an ability the engine doesn't mark stays used", trig(FABLE, "Draw a card."), ["Blue uses Fable of the Mirror-Breaker's ability"]);
  same("#8: a keyword's trigger keeps its keyword when marked", trig(FABLE, "Evoke (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)", { isTrigger: true }), ["Fable of the Mirror-Breaker's evoke triggers (Blue)"]);

  const TREASURE = (n) => ({ ...card(n, "Treasure Token", ["Artifact"], { token: true }), text: "{T}, Sacrifice this artifact: Add one mana of any color." });
  same("#3: Treasures sacrificed for their own mana, one line",
    between(board((b) => { put(b, "battlefield", TREASURE(20)); put(b, "battlefield", TREASURE(21)); put(b, "battlefield", TREASURE(22)); }), board(() => {}),
      [20, 21, 22].map((n, i) => ev(11 + i, "Battlefield", "Graveyard", id(n), "sacrificed", "player-0", { cause: "Cost:Sacrifice", causeName: "Treasure Token" }))),
    ["Treasure token ×3 are sacrificed for mana"]);
  same("#3: a Treasure an effect made its player sacrifice is not 'for mana'",
    gone(TREASURE(20), [ev(11, "Battlefield", "Graveyard", id(20), "sacrificed", "player-0", { cause: "Sacrifice", causeName: "Innocent Blood" })]), ["Treasure token is sacrificed"]);
  same("#3: nor one an unnamed effect made them sacrifice",
    gone(TREASURE(20), [ev(11, "Battlefield", "Graveyard", id(20), "sacrificed", "player-0", { cause: "Sacrifice" })]), ["Treasure token is sacrificed"]);
  same("#3: and from an engine that names no causes, a Treasure's sacrifice is taken for its mana",
    gone(TREASURE(20), [ev(11, "Battlefield", "Graveyard", id(20), "sacrificed")]), ["Treasure token is sacrificed for mana"]);
  same("#3: a sacrifice with no reason stays its own line",
    between(board((b) => { put(b, "battlefield", BEAR(1)); put(b, "battlefield", { ...BEAR(6), identity: { name: "Hill Giant" } }); }), board((b) => { put(b, "graveyard", BEAR(1)); put(b, "graveyard", { ...BEAR(6), identity: { name: "Hill Giant" } }); }),
      [ev(11, "Battlefield", "Graveyard", id(1), "sacrificed"), ev(12, "Battlefield", "Graveyard", id(6), "sacrificed")]),
    ["Grizzly Bears is sacrificed", "Hill Giant is sacrificed"]);

  const MAIRSIL = card(30, "Mairsil, the Pretender", ["Creature"]);
  const DRAGON = card(31, "Ancient Copper Dragon", ["Creature"]);
  same("#1: a card caged by Mairsil says so",
    between(board((b) => { put(b, "battlefield", MAIRSIL); put(b, "graveyard", DRAGON); }), board((b) => { put(b, "battlefield", MAIRSIL); put(b, "exile", { ...DRAGON, exiledWith: id(30), counters: { CAGE: 1 } }); }),
      [ev(11, "Graveyard", "Exile", id(31))]),
    ["Ancient Copper Dragon is exiled from Blue's graveyard with Mairsil, the Pretender (a cage counter)"]);
  const BLADE = card(33, "Tithing Blade", ["Artifact"]);
  same("craft: a card exiled to pay its own cost is not exiled with itself",
    between(board((b) => put(b, "battlefield", BLADE)), board((b) => put(b, "exile", { ...BLADE, exiledWith: id(33) })), [ev(11, "Battlefield", "Exile", id(33))]),
    ["Tithing Blade is exiled"]);
  same("#1: and one that comes back says until",
    between(board((b) => { put(b, "battlefield", MAIRSIL); put(b, "battlefield", BEAR(1), "player-1"); }), board((b) => { put(b, "battlefield", MAIRSIL); put(b, "exile", { ...BEAR(1), exiledWith: id(30), returnsWhenHostLeaves: true }, "player-1"); }),
      [ev(11, "Battlefield", "Exile", id(1), null, "player-1")]),
    ["Grizzly Bears is exiled with Mairsil, the Pretender, until Mairsil, the Pretender leaves the battlefield"]);
  const ASSASSIN = { ...card(32, "Royal Assassin", ["Creature"]), exiledWith: id(30), text: "{T}: Destroy target tapped creature." };
  same("#17: an ability from a caged card names the card",
    between(board((b) => { put(b, "battlefield", MAIRSIL); put(b, "exile", ASSASSIN); }), board((b) => { put(b, "battlefield", MAIRSIL); put(b, "exile", ASSASSIN); b.stack.push(onStack(MAIRSIL, "{T}: Destroy target tapped creature.")); }), []),
    ["Blue uses Mairsil, the Pretender's ability (Royal Assassin's)"]);
  const LOOSE = { ...ASSASSIN, exiledWith: undefined };
  same("#17: a card in exile not caged by it lends it nothing",
    between(board((b) => { put(b, "battlefield", MAIRSIL); put(b, "exile", LOOSE); }), board((b) => { put(b, "battlefield", MAIRSIL); put(b, "exile", LOOSE); b.stack.push(onStack(MAIRSIL, "{T}: Destroy target tapped creature.")); }), []),
    ["Blue uses Mairsil, the Pretender's ability"]);

  const MTOKEN = (n) => ({ ...card(n, "Mairsil, the Pretender", ["Creature"], { token: true }) });
  same("#5: two token copies of a legend", between(board(() => {}), board((b) => { put(b, "battlefield", MTOKEN(40)); put(b, "battlefield", MTOKEN(41)); }), []),
    ["Blue creates 2 Mairsil, the Pretender tokens"]);
  const CLONE = { ...card(42, "Bloodline Keeper", ["Creature"]), printedName: "Clone" };
  same("#10: a copy enters by its own name", between(board((b) => put(b, "hand", card(42, "Clone", ["Creature"]))), board((b) => put(b, "battlefield", CLONE)), [ev(11, "Stack", "Battlefield", id(42))]),
    ["Clone enters the battlefield as Bloodline Keeper (Blue)"]);
  same("#10: and dies as what it was", between(board((b) => put(b, "battlefield", CLONE)), board((b) => put(b, "graveyard", card(42, "Clone", ["Creature"]))), [ev(11, "Battlefield", "Graveyard", id(42), "destroyed")]),
    ["Bloodline Keeper (Clone) dies"]);
  const DOUBLE = { ...card(45, "Mairsil, the Pretender", ["Creature"]), printedName: "Spark Double" };
  same("#10 re-test: a copy back from a graveyard by its own name",
    between(board((b) => put(b, "graveyard", card(45, "Spark Double", ["Creature"]))), board((b) => put(b, "battlefield", DOUBLE)), [ev(11, "Graveyard", "Battlefield", id(45))]),
    ["Spark Double returns to the battlefield from Blue's graveyard as Mairsil, the Pretender (Blue)"]);
  same("#10 re-test: and from exile",
    between(board((b) => put(b, "exile", card(45, "Spark Double", ["Creature"]))), board((b) => put(b, "battlefield", DOUBLE)), [ev(11, "Exile", "Battlefield", id(45))]),
    ["Spark Double returns to the battlefield from exile as Mairsil, the Pretender (Blue)"]);
  const PARTNER = "Partner with Ich-Tekik, Salvage Splicer (When this creature enters, target player may put Ich-Tekik into their hand from their library, then shuffle.)";
  same("re-test: a trigger whose token is gone (the legend rule) is no cast",
    between(board((b) => put(b, "battlefield", MTOKEN(40))), board((b) => { put(b, "battlefield", MTOKEN(40)); b.stack.push(onStack(card(41, "Zndrsplt, Eye of Wisdom", ["Creature"]), PARTNER, { isTrigger: true })); }), []),
    ["Zndrsplt, Eye of Wisdom's partner with triggers (Blue)"]);
  const NIV = { ...card(46, "Niv-Mizzet, Visionary", ["Creature"]), controllerId: "player-1" };
  const NIV_SPELL = { id: "stack-7", sourceId: id(46), identity: { name: "Niv-Mizzet, Visionary" }, controllerId: "player-1" };
  const DENIAL = { id: "stack-8", sourceId: id(47), identity: { name: "Arcane Denial" }, controllerId: "player-0", sourceAbilityText: "Counter target spell.", targets: [{ kind: "spell", id: "stack-7" }] };
  same("re-test: a commander countered goes to the command zone, and says so",
    between(board((b) => { b.stack.push(DENIAL, NIV_SPELL); }), board((b) => { put(b, "command", NIV, "player-1"); put(b, "graveyard", card(47, "Arcane Denial", ["Instant"])); }),
      [ev(11, "Stack", "Graveyard", id(47)), ev(12, "Stack", "Command", id(46), null, "player-1")]),
    ["Niv-Mizzet, Visionary is countered and returns to the command zone"]);
  // (Forge's own stack ids, which it never gives twice; its feed has no cast from the command zone)
  const NIV_LANDED = { ...NIV_SPELL, id: "engine-stack-41" }, NIV_AGAIN = { ...NIV_SPELL, id: "engine-stack-48" };
  const DENIAL_ON = { ...DENIAL, id: "engine-stack-44", targets: [{ kind: "spell", id: "engine-stack-41" }] };
  const RECAST_FEED = [ev(11, "Stack", "Graveyard", id(47)), ev(12, "Stack", "Graveyard", id(46), null, "player-1"), ev(13, "Graveyard", "Command", id(46), null, "player-1")];
  same("re-test 2: a commander countered and recast before the next board says both",
    between(board((b) => { b.stack.push(DENIAL_ON, NIV_LANDED); }), board((b) => { b.stack.push(NIV_AGAIN); put(b, "graveyard", card(47, "Arcane Denial", ["Instant"])); }), RECAST_FEED),
    ["Niv-Mizzet, Visionary is countered and returns to the command zone", "AI 1 casts Niv-Mizzet, Visionary"]);
  same("and the same from a feed that has its cast too",
    between(board((b) => { b.stack.push(DENIAL_ON, NIV_LANDED); }), board((b) => { b.stack.push(NIV_AGAIN); put(b, "graveyard", card(47, "Arcane Denial", ["Instant"])); }),
      [...RECAST_FEED, ev(14, "Command", "Stack", id(46), null, "player-1")]),
    ["Niv-Mizzet, Visionary is countered and returns to the command zone", "AI 1 casts Niv-Mizzet, Visionary"]);
  same("and with no feed, countered and cast, not where it went",
    between(board((b) => { b.stack.push(DENIAL_ON, NIV_LANDED); }), board((b) => { b.stack.push(NIV_AGAIN); put(b, "graveyard", card(47, "Arcane Denial", ["Instant"])); }), null),
    ["Niv-Mizzet, Visionary is countered", "AI 1 casts Niv-Mizzet, Visionary"]);
  same("and one bounced and recast is just cast again",
    between(board((b) => { b.stack.push(NIV_LANDED); }), board((b) => { b.stack.push(NIV_AGAIN); }),
      [ev(11, "Stack", "Hand", id(46), null, "player-1"), ev(12, "Hand", "Stack", id(46), null, "player-1")]),
    ["Niv-Mizzet, Visionary returns to AI 1's hand", "AI 1 casts Niv-Mizzet, Visionary"]);
  same("and one still on the stack under its own id is no new cast",
    between(board((b) => { b.stack.push(DENIAL_ON, NIV_LANDED); }), board((b) => { b.stack.push(NIV_LANDED); }), RECAST_FEED),
    []);
  same("and one seen again while still being cast is cast again too",
    between(board((b) => { b.stack.push(DENIAL_ON, NIV_LANDED); }), board((b) => { b.stack.push({ ...NIV_SPELL, id: "casting-10009" }); put(b, "graveyard", card(47, "Arcane Denial", ["Instant"])); }), RECAST_FEED),
    ["Niv-Mizzet, Visionary is countered and returns to the command zone", "AI 1 casts Niv-Mizzet, Visionary"]);
  same("and one landing from its cast (casting- to engine-stack-) is no second cast",
    between(board((b) => { b.stack.push({ ...NIV_SPELL, id: "casting-10003" }); }), board((b) => { b.stack.push(NIV_LANDED); }), []),
    []);
  same("and one never targeted just went home (no line from the stack)",
    between(board((b) => { b.stack.push(NIV_SPELL); }), board((b) => put(b, "command", NIV, "player-1")), [ev(12, "Stack", "Command", id(46), null, "player-1")]),
    []);
  const RA = "{T}: Destroy target tapped creature.", BK = "{T}: Create a 2/2 black Vampire creature token with flying.";
  const ASSN = (t, ct) => ({ ...card(48, "Royal Assassin", ["Creature"]), text: t, ...(ct ? { currentText: ct } : {}) });
  const KEEP = (t, ct) => ({ ...card(49, "Bloodline Keeper", ["Creature"]), text: t, ...(ct ? { currentText: ct } : {}) });
  const WORDS = { id: "stack-9", sourceId: id(50), identity: { name: "Exchange of Words" }, controllerId: "player-0", sourceAbilityText: "Exchange the text boxes of two target creatures." };
  // (each reads with its own name in the other's text, so only the spell tells it was a swap)
  same("#11 re-test: two text boxes swapped by a spell",
    between(board((b) => { put(b, "battlefield", ASSN(RA)); put(b, "battlefield", KEEP(`${BK}\n{B}: Transform Bloodline Keeper.`)); b.stack.push(WORDS); }),
      board((b) => { put(b, "battlefield", ASSN(RA, `${BK}\r\n{B}: Transform Royal Assassin.\r\n`)); put(b, "battlefield", KEEP(BK, RA)); put(b, "graveyard", card(50, "Exchange of Words", ["Instant"])); }), [ev(11, "Stack", "Graveyard", id(50))]),
    ["Royal Assassin and Bloodline Keeper exchange text boxes (Exchange of Words)"]);
  // (Forge's changed text ends its lines "\r\n": read as the plain text it equals)
  same("#11 re-test: or seen by each reading as the other did",
    between(board((b) => { put(b, "battlefield", ASSN(RA)); put(b, "battlefield", KEEP(BK)); }), board((b) => { put(b, "battlefield", ASSN(RA, `${BK}\r\n`)); put(b, "battlefield", KEEP(BK, RA)); }), []),
    ["Royal Assassin and Bloodline Keeper exchange text boxes"]);
  same("#11 re-test: not while the swap is still on the stack",
    between(board((b) => { put(b, "battlefield", ASSN(RA)); put(b, "battlefield", KEEP(BK)); b.stack.push(WORDS); }),
      board((b) => { put(b, "battlefield", ASSN(RA, "Flying")); put(b, "battlefield", KEEP(BK, "Trample")); b.stack.push(WORDS); }), []),
    []);
  same("#11 re-test: three texts changed are no one swap",
    between(board((b) => { put(b, "battlefield", ASSN(RA)); put(b, "battlefield", KEEP(BK)); put(b, "battlefield", { ...BEAR(51), text: "" }); b.stack.push(WORDS); }),
      board((b) => { put(b, "battlefield", ASSN(RA, BK)); put(b, "battlefield", KEEP(BK, RA)); put(b, "battlefield", { ...BEAR(51), text: "", currentText: "Flying" }); put(b, "graveyard", card(50, "Exchange of Words", ["Instant"])); }),
      [ev(11, "Stack", "Graveyard", id(50))]),
    []);
  // (real TTS 2026-11-05: Forge sends the emptied text as currentText "", which read as "unchanged" and hid the swap)
  const ELF = (ct) => ({ ...card(52, "Llanowar Elves", ["Creature"]), text: "{T}: Add {G}.", ...(ct != null ? { currentText: ct } : {}) });
  same("#11 real table: a swap with a creature that had no text",
    between(board((b) => { put(b, "battlefield", { ...BEAR(51), text: "" }); put(b, "battlefield", ELF()); }),
      board((b) => { put(b, "battlefield", { ...BEAR(51), text: "", currentText: "{T}: Add {G}." }); put(b, "battlefield", ELF("")); }), []),
    ["Grizzly Bears and Llanowar Elves exchange text boxes"]);
  // (a word changed by a spell that targeted the permanent: mechanic run hp-25 2026-11-05, Mind Bend was in no log)
  const WRAITH = (ct) => ({ ...card(53, "Bog Wraith", ["Creature"]), text: "Swampwalk", ...(ct != null ? { currentText: ct } : {}) });
  const BEND = { id: "stack-10", sourceId: id(54), identity: { name: "Mind Bend" }, controllerId: "player-0", targets: [{ kind: "card", id: id(53) }],
    sourceAbilityText: "Change the text of target permanent by replacing all instances of one color word with another or one basic land type with another." };
  same("text change: the word, as it was and is, by the spell",
    between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push(BEND); }), board((b) => { put(b, "battlefield", WRAITH("Islandwalk")); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); }), [ev(13, "Stack", "Graveyard", id(54))]),
    ["Bog Wraith's text changes: Swampwalk → Islandwalk (Mind Bend)"]);
  // (live texts, mechanic run hp-25 re-test: Forge's own "(was Goblin)" note, a colour word inside two reminder lines,
  // a land type with its reminder, and a rewrite too big to name)
  const KING = (ct) => ({ ...card(53, "Goblin King", ["Creature"]), text: "Other Goblins get +1/+1 and have mountainwalk.", ...(ct != null ? { currentText: ct } : {}) });
  const KNIGHT_TX = (c) => `First strike (This creature deals combat damage before creatures without first strike.)\nProtection from ${c} (This creature can't be blocked, targeted, dealt damage, or enchanted by anything ${c}.)`;
  const KNIGHT = (ct) => ({ ...card(53, "White Knight", ["Creature"]), text: KNIGHT_TX("black"), ...(ct != null ? { currentText: ct } : {}) });
  const WRAITH_TX = (t, a) => `${t}walk (This creature can't be blocked as long as defending player controls ${a} ${t}.)`;
  const WRAITH2 = (ct) => ({ ...card(53, "Bog Wraith", ["Creature"]), text: WRAITH_TX("Swamp", "a"), ...(ct != null ? { currentText: ct } : {}) });
  for (const [what, before, after, line] of [
    ["Forge's own note", KING(), KING("Other <strike>Goblin</strike> Elf creatures get +1/+1 and have mountainwalk."), "Goblin King's text changes: Goblin → Elf (Mind Bend)"],
    ["Forge's note as the table shows it", KING(), KING("Other Elf (was Goblin) creatures get +1/+1 and have mountainwalk."), "Goblin King's text changes: Goblin → Elf (Mind Bend)"],
    ["a colour word, twice", KNIGHT(), KNIGHT(KNIGHT_TX("red")), "White Knight's text changes: black → red (Mind Bend)"],
    ["a colour word, its reminder gone (live)", KNIGHT(), KNIGHT("First strike, protection from red"), "White Knight's text changes: black → red (Mind Bend)"],
    ["a land type and its walk", WRAITH2(), WRAITH2(WRAITH_TX("Island", "an")), "Bog Wraith's text changes: Swampwalk → Islandwalk (Mind Bend)"],
    ["an article that changes with the word", WRAITH2("{T}, Sacrifice a Swamp: Add {B}{B}."), WRAITH2("{T}, Sacrifice an Island: Add {B}{B}."), "Bog Wraith's text changes: Swamp → Island (Mind Bend)"],
    ["a land type twice in one line, its family read once", WRAITH2("Swampwalk, Swamp cycling"), WRAITH2("Islandwalk, Island cycling"), "Bog Wraith's text changes: Swamp → Island (Mind Bend)"],
    ["a landwalk, its reminder reworded (live)", WRAITH2(), WRAITH2("Islandwalk (This creature is unblockable as long as defending player controls an Island.)"), "Bog Wraith's text changes: Swampwalk → Islandwalk (Mind Bend)"],
    ["a rewrite too big to name", KNIGHT(), KNIGHT("Flying, vigilance, deathtouch, lifelink and haste."), "White Knight's text changes (Mind Bend)"],
  ]) {
    same(`text change: ${what}`,
      between(board((b) => { put(b, "battlefield", before); b.stack.push(BEND); }), board((b) => { put(b, "battlefield", after); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); }), [ev(13, "Stack", "Graveyard", id(54))]),
      [line]);
  }
  // (a target with no such word: Glamerdye on a Forest, Forge only dropping its reminder, mechanic run hp-25)
  const FOREST = (ct) => ({ ...card(53, "Forest", ["Land"]), text: "({T}: Add {G}.)", ...(ct != null ? { currentText: ct } : {}) });
  same("text change: a target with no such word, its reminder dropped",
    between(board((b) => { put(b, "battlefield", FOREST()); b.stack.push(BEND); }), board((b) => { put(b, "battlefield", FOREST("")); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); }), [ev(13, "Stack", "Graveyard", id(54))]),
    ["Mind Bend changes nothing in Forest's text"]);
  same("text change: a target whose text stays as it was",
    between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push(BEND); }), board((b) => { put(b, "battlefield", WRAITH()); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); }), [ev(13, "Stack", "Graveyard", id(54))]),
    ["Mind Bend changes nothing in Bog Wraith's text"]);
  // (suite review 2026-11-05: a countered Mind Bend read "Mind Bend changes nothing in Bog Wraith's text" under its "is
  // countered")
  const COUNTER = { id: "stack-11", sourceId: id(55), identity: { name: "Counterspell" }, controllerId: "player-1", sourceAbilityText: "Counter target spell.", targets: [{ kind: "spell", id: "stack-10" }] };
  same("text change: a countered spell changes nothing and says only that it is countered",
    between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push(BEND, COUNTER); }),
      board((b) => { put(b, "battlefield", WRAITH()); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); put(b, "graveyard", card(55, "Counterspell", ["Instant"]), "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(55), null, "player-1"), ev(12, "Stack", "Graveyard", id(54))]),
    ["Mind Bend is countered"]);
  same("text change: one that resolved under a counterspell aimed elsewhere still says it changed nothing",
    between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push(BEND, { ...COUNTER, targets: [{ kind: "spell", id: "stack-99" }] }); }),
      board((b) => { put(b, "battlefield", WRAITH()); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); put(b, "graveyard", card(55, "Counterspell", ["Instant"]), "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(55), null, "player-1"), ev(12, "Stack", "Graveyard", id(54))]),
    ["Mind Bend changes nothing in Bog Wraith's text"]);
  // (a spell aimed at it that is no counterspell, a copy: it resolves, so it still says it changed nothing)
  const TWINCAST = { ...COUNTER, identity: { name: "Twincast" }, sourceAbilityText: "Copy target instant or sorcery spell. You may choose new targets for the copy." };
  same("text change: targeted by a spell that copies it, not a counter, still says it changed nothing",
    between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push(BEND, TWINCAST); }),
      board((b) => { put(b, "battlefield", WRAITH()); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); put(b, "graveyard", card(55, "Twincast", ["Instant"]), "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(55), null, "player-1"), ev(12, "Stack", "Graveyard", id(54))]),
    ["Mind Bend changes nothing in Bog Wraith's text"]);

  // a spell countered by one the AI cast and resolved between two boards, which no board showed on the stack: Forge
  // moves the countered spell first, then the counterspell as it finishes. Craw Wurm under the AI's Counterspell read
  // "AI 1 casts Counterspell" and nothing of the Wurm, keyword sweep kw-14 (both runs)
  const WURM = { id: "engine-stack-30", sourceId: id(70), identity: { name: "Craw Wurm" }, controllerId: "player-0" };
  const BOLT_UP = { id: "engine-stack-31", sourceId: id(71), identity: { name: "Lightning Bolt" }, controllerId: "player-0", sourceAbilityText: "Lightning Bolt deals 3 damage to any target.", targets: [{ kind: "card", id: id(1) }] };
  const answer = (n, name, text) => ({ ...card(n, name, ["Instant"]), controllerId: "player-1", text });
  const COUNTERSPELL = answer(72, "Counterspell", "Counter target spell.");
  const DISSIPATE = answer(73, "Dissipate", "Counter target spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.");
  const REMAND = answer(74, "Remand", "Counter target spell. If that spell is countered this way, put it into its owner's hand instead of into that player's graveyard. Draw a card.");
  const UNSUB = answer(75, "Unsubstantiate", "Return target spell or creature to its owner's hand.");
  const MURDER = answer(76, "Murder", "Destroy target creature.");
  const WURM_CARD = card(70, "Craw Wurm", ["Creature"]), BOLT_CARD = card(71, "Lightning Bolt", ["Instant"]);
  // (the AI's hand one card down: its answer came from there; the Bolt's Bears on the battlefield before)
  const answered = (spell, fill, events) => between(board((b) => { if (spell === BOLT_UP) put(b, "battlefield", BEAR()); b.stack.push(spell); count(b, "hand", 7, "player-1"); }),
    board((b) => { count(b, "hand", 6, "player-1"); fill(b); }), events);
  same("kw-14: a creature spell countered by the AI between two boards is countered",
    answered(WURM, (b) => { put(b, "graveyard", WURM_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(70)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell", "Craw Wurm is countered"]);
  same("kw-14: and an instant the same way",
    answered(BOLT_UP, (b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", BOLT_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell", "Lightning Bolt is countered"]);
  same("kw-14: an instant that left the stack after the AI's counterspell resolved, not countered",
    answered(BOLT_UP, (b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", BOLT_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(72), null, "player-1"), ev(12, "Stack", "Graveyard", id(71)), ev(13, "Battlefield", "Graveyard", id(1), "destroyed")]),
    ["Grizzly Bears dies", "AI 1 casts Counterspell"]);
  same("kw-14: an instant that fizzled, its target killed by the AI between two boards, is not countered",
    answered(BOLT_UP, (b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", BOLT_CARD); put(b, "graveyard", MURDER, "player-1"); },
      [ev(11, "Battlefield", "Graveyard", id(1), "destroyed"), ev(12, "Stack", "Graveyard", id(76), null, "player-1"), ev(13, "Stack", "Graveyard", id(71))]),
    ["Grizzly Bears dies", "AI 1 casts Murder"]);
  same("kw-14: and one that fizzled with no other spell seen is not countered either",
    between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push(BOLT_UP); }), board((b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", BOLT_CARD); }),
      [ev(11, "Battlefield", "Graveyard", id(1), "sacrificed"), ev(12, "Stack", "Graveyard", id(71))]),
    ["Grizzly Bears is sacrificed"]);
  // (the Negate another player's: Forge's AI counters no spell of its own team's, CounterAi)
  const NEGATE_MINE = { ...card(77, "Negate", ["Instant"]), text: "Counter target noncreature spell." };
  same("kw-14: a counterspell that was itself countered counters nothing, and is countered",
    answered(WURM, (b) => { put(b, "battlefield", WURM_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); put(b, "graveyard", NEGATE_MINE); },
      [ev(11, "Stack", "Graveyard", id(72), null, "player-1"), ev(12, "Stack", "Graveyard", id(77)), ev(13, "Stack", "Battlefield", id(70))]),
    ["Blue casts Negate", "Craw Wurm enters the battlefield (Blue)", "AI 1 casts Counterspell", "Counterspell is countered"]);
  // (and one with a spell before it that resolved: the countered Counterspell took nothing off, so the Opt that left
  // first resolved; it read "Opt is countered" with the countered counter's own targets read, mutation pass 2026-11-06)
  const OPT_MINE = { ...card(79, "Opt", ["Instant"]), text: "Scry 1.\nDraw a card." };
  same("kw-14: a countered counterspell takes nothing off, the spell before it resolved",
    answered(WURM, (b) => { put(b, "battlefield", WURM_CARD); put(b, "graveyard", OPT_MINE); put(b, "graveyard", COUNTERSPELL, "player-1"); put(b, "graveyard", NEGATE_MINE); },
      [ev(11, "Stack", "Graveyard", id(79)), ev(12, "Stack", "Graveyard", id(72), null, "player-1"), ev(13, "Stack", "Graveyard", id(77)), ev(14, "Stack", "Battlefield", id(70))]),
    ["Blue casts Opt", "Blue casts Negate", "Craw Wurm enters the battlefield (Blue)", "AI 1 casts Counterspell", "Counterspell is countered"]);
  same("kw-14: a creature spell straight from the stack into the graveyard, no counterspell seen (an ability's), is countered",
    between(board((b) => b.stack.push(WURM)), board((b) => put(b, "graveyard", WURM_CARD)), [ev(11, "Stack", "Graveyard", id(70))]),
    ["Craw Wurm is countered"]);
  same("kw-14: but not one that entered first (evoke, the legend rule)",
    between(board((b) => b.stack.push(WURM)), board((b) => put(b, "graveyard", WURM_CARD)), [ev(11, "Stack", "Battlefield", id(70)), ev(12, "Battlefield", "Graveyard", id(70), "sacrificed")]),
    []);
  same("kw-14: nor a double-faced card's sorcery face, which resolves into the graveyard",
    between(board((b) => b.stack.push({ ...WURM, identity: { name: "Tibalt's Trickery" } })), board((b) => put(b, "graveyard", WURM_CARD)), [ev(11, "Stack", "Graveyard", id(70))]),
    []);
  same("kw-14: a commander countered by the AI between two boards says so",
    between(board((b) => { b.stack.push({ ...WURM, sourceId: id(46), identity: { name: "Niv-Mizzet, Visionary" } }); count(b, "hand", 7, "player-1"); }),
      board((b) => { put(b, "command", { ...card(46, "Niv-Mizzet, Visionary", ["Creature"]) }); count(b, "hand", 6, "player-1"); put(b, "graveyard", COUNTERSPELL, "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(46)), ev(12, "Graveyard", "Command", id(46)), ev(13, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell", "Niv-Mizzet, Visionary is countered and returns to the command zone"]);
  const AURA = { id: "engine-stack-32", sourceId: id(78), identity: { name: "Pacifism" }, controllerId: "player-0", targets: [{ kind: "card", id: id(1) }] };
  same("kw-14: nor an Aura spell that fizzled, its creature gone",
    between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push(AURA); }), board((b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", { ...card(78, "Pacifism", ["Enchantment"]), subtypes: ["Aura"] }); }),
      [ev(11, "Battlefield", "Graveyard", id(1), "sacrificed"), ev(12, "Stack", "Graveyard", id(78))]),
    ["Grizzly Bears is sacrificed"]);
  same("kw-14: a spell exiled by a counter (Dissipate) is countered and exiled",
    answered(WURM, (b) => { put(b, "exile", WURM_CARD); put(b, "graveyard", DISSIPATE, "player-1"); },
      [ev(11, "Stack", "Exile", id(70)), ev(12, "Stack", "Graveyard", id(73), null, "player-1")]),
    ["AI 1 casts Dissipate", "Craw Wurm is countered and exiled"]);
  same("kw-14: and so under a Dissipate seen on the stack",
    between(board((b) => b.stack.push(WURM, { id: "engine-stack-33", sourceId: id(73), identity: { name: "Dissipate" }, controllerId: "player-1", sourceAbilityText: DISSIPATE.text, targets: [{ kind: "spell", id: WURM.id }] })),
      board((b) => { put(b, "exile", WURM_CARD); put(b, "graveyard", DISSIPATE, "player-1"); }),
      [ev(11, "Stack", "Exile", id(70)), ev(12, "Stack", "Graveyard", id(73), null, "player-1")]),
    ["Craw Wurm is countered and exiled"]);
  // (the feed names causes, as live: a draw's; Forge gives no move off the stack a cause, so buyback is the spell's own return)
  const DRAWN = (seq) => ev(seq, "Library", "Hand", null, "draw", "player-1", { cause: "Draw" });
  same("kw-14: a spell sent back to its hand by Remand is countered and returns there, no buyback",
    answered(BOLT_UP, (b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", REMAND, "player-1"); },
      [ev(11, "Stack", "Hand", id(71)), DRAWN(12), ev(13, "Stack", "Graveyard", id(74), null, "player-1")]),
    ["AI 1 draws a card", "AI 1 casts Remand", "Lightning Bolt is countered and returns to Blue's hand"]);
  same("kw-14: and so under a Remand seen on the stack",
    between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push(BOLT_UP, { id: "engine-stack-34", sourceId: id(74), identity: { name: "Remand" }, controllerId: "player-1", sourceAbilityText: REMAND.text, targets: [{ kind: "spell", id: BOLT_UP.id }] }); }),
      board((b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", REMAND, "player-1"); }),
      [ev(11, "Stack", "Hand", id(71)), DRAWN(12), ev(13, "Stack", "Graveyard", id(74), null, "player-1")]),
    ["Lightning Bolt is countered and returns to Blue's hand", "AI 1 draws a card"]);
  same("kw-14: one returned to its hand by a spell that doesn't counter (Unsubstantiate) just returns, no buyback",
    answered(BOLT_UP, (b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", UNSUB, "player-1"); },
      [DRAWN(11), ev(12, "Stack", "Hand", id(71)), ev(13, "Stack", "Graveyard", id(75), null, "player-1")]),
    ["AI 1 draws a card", "AI 1 casts Unsubstantiate", "Lightning Bolt returns to Blue's hand"]);
  same("kw-14: a text change countered by a counterspell no board showed says only that it is countered",
    between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push(BEND); }),
      board((b) => { put(b, "battlefield", WRAITH()); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); put(b, "graveyard", COUNTERSPELL, "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(54)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell", "Mind Bend is countered"]);
  // a counter cast another way, whose stack item has only that way's words (Forge's alternative-cost spell ability), on
  // the player's own spell: White's cleaved Wash Away and web-slinging Spider-Sense on its own Divinations read no "is
  // countered", keyword sweep kw-20 (re-run and run 3a). The texts are Forge's: the cleave ability's description, the
  // web-slinging one's (CardFactoryUtil), and the stack words (CounterEffect after the card's own "<name> (<id>) - ").
  const WA_TEXT = "Cleave {1}{U}{U} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)\nCounter target spell [that wasn't cast from its owner's hand].";
  const SS_TEXT = "Web-slinging {U} (You may cast this spell for {U} if you also return a tapped creature you control to its owner's hand.)\nCounter target instant spell, sorcery spell, or triggered ability.";
  const CLEAVE_WAY = "Cleave {1}{U}{U} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)";
  const WEB_WAY = "Web-Slinging {U} (You may cast this spell for {U} if you also return a tapped creature you control to its owner’s hand.)";
  const DIV = { id: "engine-stack-40", sourceId: id(80), identity: { name: "Divination" }, controllerId: "player-0", sourceAbilityText: "Draw two cards.", text: "Divination (80) - Draw two cards." };
  const DIV_CARD = card(80, "Divination", ["Instant"]);
  const own = (n, name, text) => ({ ...card(n, name, ["Instant"]), text });
  const ownStack = (n, name, sat, text) => ({ id: `engine-stack-${n}`, sourceId: id(n), identity: { name }, controllerId: "player-0", sourceAbilityText: sat, text, targets: [{ kind: "spell", id: DIV.id }] });
  const ownCounter = (counter, cardOf, events) => between(board((b) => b.stack.push(DIV, counter)), board((b) => { put(b, "graveyard", DIV_CARD); put(b, "graveyard", cardOf); }), events);
  same("kw-20: the player's own spell under its own cleaved Wash Away, both seen on the stack, is countered",
    ownCounter(ownStack(81, "Wash Away", CLEAVE_WAY, "Wash Away (81) - Counter Divination (80)."), own(81, "Wash Away", WA_TEXT),
      [ev(11, "Stack", "Graveyard", id(80)), ev(12, "Stack", "Graveyard", id(81))]),
    ["Divination is countered"]);
  same("kw-20: and under its own web-slinging Spider-Sense, whose stack words say only how it was cast",
    ownCounter(ownStack(82, "Spider-Sense", WEB_WAY, "Spider-Sense (Web-Slinging)"), own(82, "Spider-Sense", SS_TEXT),
      [ev(11, "Stack", "Graveyard", id(80)), ev(12, "Stack", "Graveyard", id(82))]),
    ["Divination is countered"]);
  same("kw-20: and with no feed, the same",
    ownCounter(ownStack(82, "Spider-Sense", WEB_WAY, "Spider-Sense (Web-Slinging)"), own(82, "Spider-Sense", SS_TEXT), null),
    ["Divination is countered"]);
  same("kw-20: a spell cast another way that targets a spell and doesn't counter it: the spell resolves",
    ownCounter(ownStack(83, "Twincast", "Overload {4}{U} (You may cast this spell for its overload cost. If you do, change \"target\" in its text to \"each\".)", "Twincast (83) - Copy Divination (80)."),
      own(83, "Twincast", "Overload {4}{U} (...)\nCopy target instant or sorcery spell."), [ev(11, "Stack", "Graveyard", id(83)), ev(12, "Stack", "Graveyard", id(80))]),
    []);
  same("kw-20: the player's own cleaved Wash Away cast and resolved between two boards, by the feed's order",
    between(board((b) => b.stack.push(DIV)), board((b) => { put(b, "graveyard", DIV_CARD); put(b, "graveyard", own(81, "Wash Away", WA_TEXT)); }),
      [ev(11, "Stack", "Graveyard", id(80)), ev(12, "Stack", "Graveyard", id(81))]),
    ["Blue casts Wash Away", "Divination is countered"]);
  // (the player's own counter never seen on the stack: its target noted as picked, by the card's text when the ability's
  // is only the way it was cast; no feed, so only the pick tells)
  for (const [name, way, text] of [["Wash Away", CLEAVE_WAY, WA_TEXT], ["Spider-Sense", WEB_WAY, SS_TEXT], ["Twincast", CLEAVE_WAY, "Copy target instant or sorcery spell."]]) {
    const h = harness.load();
    const seat = setup(h);
    const g = h.B._getGame();
    const withDiv = board((b) => b.stack.push(DIV));
    seat.board = { state: { gameView: withDiv }, fingerprint: null };
    h.B.updateLog(withDiv);
    h.B.onPrompt(seat, { promptId: 970, decidingPlayerId: "player-0", input: { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, candidates: [{ kind: "spell", id: DIV.id }], presentation: { title: "x", targets: [] } },
      sourceCard: { id: id(84), identity: { name }, text }, sourceAbilityText: way });
    await h.flush();
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 970, choice: [`spell|${DIV.id}`] }) });
    await h.flush();
    h.B.updateLog(board((b) => { put(b, "graveyard", DIV_CARD); put(b, "graveyard", own(84, name, text)); }));
    same(`kw-20: the player's own ${name} cast another way, never seen on the stack: ${name === "Twincast" ? "no counter" : "Divination is countered"}`,
      (g.log || []).filter((l) => /Divination/.test(l)), name === "Twincast" ? [] : ["Divination is countered"]);
    harness.restore();
  }
  // what left the stack before a spell or permanent with counter words, which countered none of it (suite review
  // 2026-11-06: each read a false "is countered"; the verifier's probes a to e)
  const BOLT_ME = { ...BOLT_UP, targets: [{ kind: "player", id: "player-1" }] };
  same("a: a permanent with counter words resolving after the player's Bolt counters nothing (Voidmage Prodigy)",
    answered(BOLT_ME, (b) => { put(b, "graveyard", BOLT_CARD); put(b, "battlefield", { ...answer(85, "Voidmage Prodigy", "Sacrifice a Wizard: Counter target spell.\nMorph {U}"), types: ["Creature"] }, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Battlefield", id(85), null, "player-1")]),
    ["Voidmage Prodigy enters the battlefield (AI 1)"]);
  for (const [name, text] of [["Mystic Snake", "Flash\nWhen Mystic Snake enters, counter target spell."], ["Spellstutter Sprite", "Flash\nFlying\nWhen Spellstutter Sprite enters, counter target spell with mana value X or less, where X is the number of Faeries you control."], ["Glen Elendra Archmage", "Flying\n{U}, Sacrifice Glen Elendra Archmage: Counter target noncreature spell.\nPersist"]])
    same(`a: and so ${name}`,
      answered(BOLT_ME, (b) => { put(b, "graveyard", BOLT_CARD); put(b, "battlefield", { ...answer(85, name, text), types: ["Creature"] }, "player-1"); },
        [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Battlefield", id(85), null, "player-1")]),
      [`${name} enters the battlefield (AI 1)`]);
  same("b: a Mana Leak paid counters nothing, the AI's Opt before it resolved",
    answered(WURM, (b) => { put(b, "battlefield", WURM_CARD); put(b, "graveyard", answer(86, "Opt", "Scry 1.\nDraw a card."), "player-1"); put(b, "graveyard", answer(87, "Mana Leak", "Counter target spell unless its controller pays {3}."), "player-1"); },
      [ev(11, "Stack", "Graveyard", id(86), null, "player-1"), ev(12, "Stack", "Graveyard", id(87), null, "player-1"), ev(13, "Stack", "Battlefield", id(70))]),
    ["Craw Wurm enters the battlefield (Blue)", "AI 1 casts Opt", "AI 1 casts Mana Leak"]);
  same("b: and so with the player's Opt before it, which the AI may counter",
    answered(WURM, (b) => { put(b, "graveyard", OPT_MINE); put(b, "battlefield", WURM_CARD); put(b, "graveyard", answer(87, "Mana Leak", "Counter target spell unless its controller pays {3}."), "player-1"); },
      [ev(11, "Stack", "Graveyard", id(79)), ev(12, "Stack", "Graveyard", id(87), null, "player-1"), ev(13, "Stack", "Battlefield", id(70))]),
    ["Blue casts Opt", "Craw Wurm enters the battlefield (Blue)", "AI 1 casts Mana Leak"]);
  for (const [name, text] of [["Disallow", "Counter target spell, activated ability, or triggered ability. (Mana abilities can't be targeted.)"], ["Tale's End", "Counter target activated ability, triggered ability, or legendary spell."]])
    same(`c: ${name} after the AI's own Bolt resolved counters nothing of it`,
      between(board((b) => { put(b, "battlefield", BEAR()); count(b, "hand", 7, "player-1"); }),
        board((b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", answer(88, "Lightning Bolt", "Lightning Bolt deals 3 damage to any target."), "player-1"); put(b, "graveyard", answer(89, name, text), "player-1"); count(b, "hand", 5, "player-1"); }),
        [ev(11, "Stack", "Graveyard", id(88), null, "player-1"), ev(12, "Battlefield", "Graveyard", id(1), "destroyed"), ev(13, "Stack", "Graveyard", id(89), null, "player-1")]),
      ["Grizzly Bears dies", "AI 1 casts Lightning Bolt", `AI 1 casts ${name}`]);
  same("c: nor after the player's Bolt no board showed (it may have countered the Bears' trigger)",
    between(board((b) => { put(b, "battlefield", BEAR()); count(b, "hand", 7, "player-1"); }),
      board((b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", BOLT_CARD); put(b, "graveyard", answer(89, "Disallow", "Counter target spell, activated ability, or triggered ability."), "player-1"); count(b, "hand", 6, "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Battlefield", "Graveyard", id(1), "destroyed"), ev(13, "Stack", "Graveyard", id(89), null, "player-1")]),
    ["Grizzly Bears dies", "Blue casts Lightning Bolt", "AI 1 casts Disallow"]);
  same("c: but a Disallow on the player's Bolt seen on the stack counters it",
    answered(BOLT_ME, (b) => { put(b, "graveyard", BOLT_CARD); put(b, "graveyard", answer(89, "Disallow", "Counter target spell, activated ability, or triggered ability."), "player-1"); },
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Graveyard", id(89), null, "player-1")]),
    ["AI 1 casts Disallow", "Lightning Bolt is countered"]);
  // (Disallow seen on the stack, on an ability, the player's Bolt seen over it: the Bolt left first and resolved; a seen
  // counter has its targets, never the spell before it, mutation pass 2026-11-06)
  const DISALLOW_TEXT = "Counter target spell, activated ability, or triggered ability.";
  same("c: a Disallow seen on the stack takes only its own targets, not the spell that left before it",
    between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push({ id: "engine-stack-35", sourceId: id(89), identity: { name: "Disallow" }, controllerId: "player-1", sourceAbilityText: DISALLOW_TEXT, targets: [] }, BOLT_ME); }),
      board((b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", BOLT_CARD); put(b, "graveyard", answer(89, "Disallow", DISALLOW_TEXT), "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Graveyard", id(89), null, "player-1")]),
    []);
  const WHISPERS = { id: "engine-stack-36", sourceId: id(90), identity: { name: "Whispers of the Muse" }, controllerId: "player-0", sourceAbilityText: "Draw a card." };
  same("d: a buyback spell back in its hand stays a buyback with Venser resolving after it",
    answered(WHISPERS, (b) => { put(b, "battlefield", { ...answer(91, "Venser, Shaper Savant", "Flash\nWhen Venser, Shaper Savant enters, return target spell or permanent to its owner's hand."), types: ["Creature"] }, "player-1"); },
      [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw" }), ev(12, "Stack", "Hand", id(90)), ev(13, "Stack", "Battlefield", id(91), null, "player-1")]),
    ["Whispers of the Muse returns to Blue's hand (buyback)", "Venser, Shaper Savant enters the battlefield (AI 1)", "Blue draws a card"]);
  same("e: two of the AI's counters on one spell: the top one counters it, the one under it fizzles",
    answered(DIV, (b) => { put(b, "graveyard", DIV_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); put(b, "graveyard", answer(77, "Negate", "Counter target noncreature spell."), "player-1"); },
      [ev(11, "Stack", "Graveyard", id(80)), ev(12, "Stack", "Graveyard", id(77), null, "player-1"), ev(13, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell", "AI 1 casts Negate", "Divination is countered"]);
  // (a counter cast another way, seen on the stack, itself countered back to a hand: what it would have countered
  // resolved. Forge's stack words "Counter Divination" still showed, and read "Divination is countered", suite review
  // 2026-11-06: so such a counter goes by its card, and its card is in no public zone)
  const WA_AI = { ...ownStack(81, "Wash Away", CLEAVE_WAY, "Wash Away (81) - Counter Divination (80)."), controllerId: "player-1" };
  same("kw-20: a cleaved Wash Away countered back to its hand by the player's Remand counters nothing",
    between(board((b) => b.stack.push(DIV, WA_AI)), board((b) => { put(b, "graveyard", DIV_CARD); put(b, "graveyard", own(74, "Remand", REMAND.text)); }),
      [ev(11, "Stack", "Hand", id(81), null, "player-1"), ev(12, "Stack", "Graveyard", id(74)), ev(13, "Stack", "Graveyard", id(80))]),
    ["Blue casts Remand", "Wash Away is countered and returns to AI 1's hand"]);
  // a spell countered into its library, which no board shows (Memory Lapse, Spell Crumple, Hinder): read nothing
  for (const [name, text, where] of [["Memory Lapse", "Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard.", "on top of"],
    ["Spell Crumple", "Counter target spell. If that spell is countered this way, put it on the bottom of its owner's library instead of into that player's graveyard. Put Spell Crumple on the bottom of its owner's library.", "on the bottom of"],
    ["Hinder", "Counter target spell. If that spell is countered this way, put that card on the top or bottom of its owner's library instead of into that player's graveyard.", "into"]]) {
    const lapse = answer(92, name, text);
    // (Spell Crumple goes into its library too, unseen there, so only one seen on the stack is told: see the gap below)
    const crumple = name === "Spell Crumple";
    if (!crumple)
      same(`library: a spell countered by ${name} no board showed is put ${where} its owner's library`,
        answered(WURM, (b) => put(b, "graveyard", lapse, "player-1"), [ev(11, "Stack", "Library", id(70)), ev(12, "Stack", "Graveyard", id(92), null, "player-1")]),
        [`AI 1 casts ${name}`, `Craw Wurm is countered and put ${where} Blue's library`]);
    same(`library: and under a ${name} seen on the stack`,
      between(board((b) => b.stack.push(WURM, { id: "engine-stack-37", sourceId: id(92), identity: { name }, controllerId: "player-1", sourceAbilityText: text, targets: [{ kind: "spell", id: WURM.id }] })),
        board((b) => { if (!crumple) put(b, "graveyard", lapse, "player-1"); }), [ev(11, "Stack", "Library", id(70)), ev(12, "Stack", crumple ? "Library" : "Graveyard", id(92), null, "player-1")]),
      [`Craw Wurm is countered and put ${where} Blue's library`]);
  }
  same("library: a spell put back into its library by no counter says nothing of being countered",
    between(board((b) => b.stack.push(WURM)), board(() => {}), [ev(11, "Stack", "Library", id(70))]), []);
  // a spell countered at the end of a turn, the next board in the next turn: both lines are the old turn's
  same("turn: a spell countered by the AI at the end of the turn reads above the new turn's header",
    answered(WURM, (b) => { b.turn = 4; b.activePlayerId = "player-1"; put(b, "graveyard", WURM_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(70)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell", "Craw Wurm is countered", "--- AI 1's turn 1 ---"]);
  same("turn: one no board showed, countered on the board of the new turn, still reads after its counter's cast",
    between(board((b) => count(b, "hand", 7, "player-1")),
      board((b) => { b.turn = 4; b.activePlayerId = "player-1"; put(b, "graveyard", BOLT_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); count(b, "hand", 6, "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["--- AI 1's turn 1 ---", "Blue casts Lightning Bolt", "AI 1 casts Counterspell", "Lightning Bolt is countered"]);
  // (a counter cast from a graveyard, flashback's, goes into exile as it resolves: it counters all the same. On an
  // instant: a creature spell straight into a graveyard reads as countered by itself, see counteredOff)
  same("a counterspell that resolved into exile (flashback) counters its spell",
    answered(BOLT_UP, (b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", BOLT_CARD); put(b, "exile", COUNTERSPELL, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Exile", id(72), null, "player-1")]),
    ["Counterspell is exiled", "Lightning Bolt is countered"]);
  // (a spell that exiles a spell doesn't counter it, Mindbreak Trap: seen on the stack or not, the spell is only exiled)
  const TRAP_TEXT = "If an opponent cast three or more spells this turn, you may pay {0} rather than pay this spell's mana cost.\nExile any number of target spells.";
  same("a spell exiled by Mindbreak Trap no board showed is not countered",
    answered(BOLT_UP, (b) => { put(b, "battlefield", BEAR()); put(b, "exile", BOLT_CARD); put(b, "graveyard", answer(95, "Mindbreak Trap", TRAP_TEXT), "player-1"); },
      [ev(11, "Stack", "Exile", id(71)), ev(12, "Stack", "Graveyard", id(95), null, "player-1")]),
    ["Lightning Bolt is exiled", "AI 1 casts Mindbreak Trap"]);
  same("nor one under a Mindbreak Trap seen on the stack",
    between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push(BOLT_UP, { id: "engine-stack-38", sourceId: id(95), identity: { name: "Mindbreak Trap" }, controllerId: "player-1", sourceAbilityText: "Exile any number of target spells.", targets: [{ kind: "spell", id: BOLT_UP.id }] }); }),
      board((b) => { put(b, "battlefield", BEAR()); put(b, "exile", BOLT_CARD); put(b, "graveyard", answer(95, "Mindbreak Trap", TRAP_TEXT), "player-1"); }),
      [ev(11, "Stack", "Exile", id(71)), ev(12, "Stack", "Graveyard", id(95), null, "player-1")]),
    ["Lightning Bolt is exiled"]);
  // (a permanent spell with counter words, itself countered by an ability, did nothing: the player's Opt that left
  // before it resolved)
  same("a permanent spell with counter words, itself countered, counters nothing (Mystic Snake)",
    between(board((b) => count(b, "hand", 7, "player-1")),
      board((b) => { put(b, "graveyard", OPT_MINE); put(b, "graveyard", { ...answer(94, "Mystic Snake", "Flash\nWhen Mystic Snake enters, counter target spell."), types: ["Creature"] }, "player-1"); count(b, "hand", 6, "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(79)), ev(12, "Stack", "Graveyard", id(94), null, "player-1")]),
    ["Blue casts Opt", "AI 1 casts Mystic Snake", "Mystic Snake is countered"]);
  // (the team rule goes by who controls the spell: the AI's own cast of the player's card, Commandeer's or a spell cast
  // from another's library, is the AI's, and no counter of the AI's takes it)
  same("the AI's counter takes no spell the AI controls, whoever owns its card",
    answered({ ...BOLT_ME, controllerId: "player-1" }, (b) => { put(b, "graveyard", BOLT_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell"]);
  // (a counter of up to two: the spell just before it resolved onto the battlefield, so it countered nothing of what
  // left before that, the player's Opt)
  same("a counter of up to two stops at a spell that resolved onto the battlefield",
    between(board((b) => count(b, "hand", 7, "player-1")),
      board((b) => { put(b, "graveyard", OPT_MINE); put(b, "battlefield", BEAR()); put(b, "graveyard", answer(93, "Double Negative", "Counter up to two target spells."), "player-1"); count(b, "hand", 6, "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(79)), ev(12, "Stack", "Battlefield", id(1)), ev(13, "Stack", "Graveyard", id(93), null, "player-1")]),
    ["Blue casts Opt", "Grizzly Bears enters the battlefield (Blue)", "AI 1 casts Double Negative"]);
  same("turn: and one countered and sent back by Remand",
    answered(BOLT_UP, (b) => { b.turn = 4; b.activePlayerId = "player-1"; put(b, "battlefield", BEAR()); put(b, "graveyard", REMAND, "player-1"); },
      [ev(11, "Stack", "Hand", id(71)), ev(12, "Stack", "Graveyard", id(74), null, "player-1")]),
    ["AI 1 casts Remand", "Lightning Bolt is countered and returns to Blue's hand", "--- AI 1's turn 1 ---"]);
  // (its target gone before it resolved: nothing about the text, and no crash)
  // (a throw is returned as a marker, so this fails by name and the checks after it still run)
  let goneLines;
  try {
    goneLines = between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push(BEND); }), board((b) => { put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); }),
      [ev(11, "Battlefield", "Hand", id(53)), ev(12, "Stack", "Graveyard", id(54))]).filter((l) => /text/.test(l));
  } catch (e) { goneLines = [`THREW ${e.constructor.name}: ${e.message}`]; }
  same("text change: a target gone from play says nothing of its text", goneLines, []);
  same("text change: not while the spell is still on the stack",
    between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push(BEND); }), board((b) => { put(b, "battlefield", WRAITH("Islandwalk")); b.stack.push(BEND); }), []),
    []);
  same("text change: not a permanent the spell didn't target",
    between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push({ ...BEND, targets: [] }); }), board((b) => { put(b, "battlefield", WRAITH("Islandwalk")); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); }), [ev(13, "Stack", "Graveyard", id(54))]),
    []);
  same("text change: not a spell that changes no text",
    between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push({ ...BEND, sourceAbilityText: "Target creature gains flying until end of turn." }); }), board((b) => { put(b, "battlefield", WRAITH("Swampwalk\nFlying")); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); }), [ev(13, "Stack", "Graveyard", id(54))]),
    []);
  // (venture: the dungeon's room is a note on its text; mechanic run hp-08 2026-11-05 read only the room's "+1 life")
  const DUNGEON = (room) => ({ ...card(60, "Dungeon of the Mad Mage", ["Dungeon"]), text: `Yawning Portal — You gain 1 life. [Room: ${room}]` });
  same("venture: entering a dungeon names its room", between(board(() => {}), board((b) => put(b, "command", DUNGEON("Yawning Portal"))), []),
    ["Blue ventures into Yawning Portal (Dungeon of the Mad Mage)"]);
  same("venture: the next room", between(board((b) => put(b, "command", DUNGEON("Yawning Portal"))), board((b) => put(b, "command", DUNGEON("Dungeon Level"))), []),
    ["Blue ventures into Dungeon Level (Dungeon of the Mad Mage)"]);
  same("venture: the same room is no line", between(board((b) => put(b, "command", DUNGEON("Dungeon Level"))), board((b) => put(b, "command", DUNGEON("Dungeon Level"))), []),
    []);
  // (live, mechanic run hp-08 re-test: no "[Room: ...]" note on the dungeon; the room is its ability on the stack,
  // "Yawning Portal — You gain 1 life.  (Leads to: Dungeon Level)", said once even with the note too)
  const ROOM = (text) => ({ id: "stack-11", sourceId: id(60), identity: { name: "Dungeon of the Mad Mage" }, controllerId: "player-0", isTrigger: true, sourceAbilityText: text });
  const BARE = () => ({ ...card(60, "Dungeon of the Mad Mage", ["Dungeon"]), text: "" });
  same("venture: the room by its ability on the stack", between(board(() => {}), board((b) => { put(b, "command", BARE()); b.stack.push(ROOM("Yawning Portal — You gain 1 life.  (Leads to: Dungeon Level)")); }), []),
    ["Blue ventures into Yawning Portal (Dungeon of the Mad Mage)"]);
  same("venture: a room by its 'Leads to' alone, no dungeon card seen", between(board(() => {}), board((b) => b.stack.push(ROOM("Yawning Portal — You gain 1 life.  (Leads to: Dungeon Level)"))), []),
    ["Blue ventures into Yawning Portal (Dungeon of the Mad Mage)"]);
  same("venture: a last room, no 'Leads to', by its dungeon", between(board((b) => put(b, "command", BARE())), board((b) => { put(b, "command", BARE()); b.stack.push(ROOM("Mad Wizard's Lair — Draw three cards and reveal them. You may cast one of them without paying its mana cost.")); }), []),
    ["Blue ventures into Mad Wizard's Lair (Dungeon of the Mad Mage)"]);
  same("venture: said once with the room note too", between(board(() => {}), board((b) => { put(b, "command", DUNGEON("Yawning Portal")); b.stack.push(ROOM("Yawning Portal — You gain 1 life.  (Leads to: Dungeon Level)")); }), []),
    ["Blue ventures into Yawning Portal (Dungeon of the Mad Mage)"]);
  same("venture: an ability word's trigger is no room", between(board(() => {}), board((b) => b.stack.push({ ...ROOM("Battalion — Whenever this creature and at least two other creatures attack, draw a card."), identity: { name: "Frontline Medic" }, sourceId: id(61) })), []),
    ["Frontline Medic's battalion triggers (Blue)"]);
  same("#11 re-test: two texts changed otherwise are no swap",
    between(board((b) => { put(b, "battlefield", ASSN(RA)); put(b, "battlefield", KEEP(BK)); }), board((b) => { put(b, "battlefield", ASSN(RA, "Flying")); put(b, "battlefield", KEEP(BK, RA)); }), []),
    []);
  same("#5 re-test: one copy token says token", between(board(() => {}), board((b) => put(b, "battlefield", MTOKEN(40))), []),
    ["Blue creates a Mairsil, the Pretender token"]);
  same("#10: a face-down creature dies by the card the graveyard shows",
    between(board((b) => put(b, "battlefield", { ...BEAR(1), isFaceDown: true })), board((b) => put(b, "graveyard", BEAR(1))), [ev(11, "Battlefield", "Graveyard", id(1), "destroyed")]),
    ["Grizzly Bears dies"]);
  same("#10: a transformed card dies by its face", between(board((b) => put(b, "battlefield", card(43, "Reflection of Kiki-Jiki", ["Creature"]))), board((b) => put(b, "graveyard", card(43, "Fable of the Mirror-Breaker", ["Enchantment"]))), [ev(11, "Battlefield", "Graveyard", id(43), "destroyed")]),
    ["Reflection of Kiki-Jiki dies"]);

  const ELECTRO = card(44, "Electro, Assaulting Battery", ["Creature"]);
  same("#9: a leave trigger after the death that caused it",
    between(board((b) => put(b, "battlefield", ELECTRO)), board((b) => { put(b, "graveyard", ELECTRO); b.stack.push(onStack(ELECTRO, "When Electro leaves the battlefield, you may pay {X}.")); }), [ev(11, "Battlefield", "Graveyard", id(44), "destroyed")]),
    ["Electro, Assaulting Battery dies", "Electro, Assaulting Battery's ability triggers (Blue)"]);
  same("#9: a trigger after a grouped line, which keeps its place",
    between(board((b) => { put(b, "battlefield", TREASURE(20)); put(b, "battlefield", TREASURE(21)); put(b, "battlefield", ELECTRO); }),
      board((b) => { put(b, "battlefield", ELECTRO); b.stack.push(onStack(ELECTRO, "Whenever you cast an instant or sorcery spell, add {R}.")); }),
      [20, 21].map((n, i) => ev(11 + i, "Battlefield", "Graveyard", id(n), "sacrificed", "player-0", { cause: "Cost:Sacrifice", causeName: "Treasure Token" }))),
    ["Treasure token ×2 are sacrificed for mana", "Electro, Assaulting Battery's ability triggers (Blue)"]);
  same("#9: a chapter after its lore counter",
    between(board((b) => put(b, "battlefield", { ...FABLE, counters: { LORE: 1 } })), board((b) => { put(b, "battlefield", { ...FABLE, counters: { LORE: 2 } }); b.stack.push(onStack(FABLE, "II — Draw a card.")); }), []),
    ["Fable of the Mirror-Breaker gets a lore counter (2 in all)", "Fable of the Mirror-Breaker's chapter II triggers (Blue)"]);

  {
    const h = harness.load();
    setup(h);
    const g = h.B._getGame();
    // (Forge's isExtraTurn on the active player; no guess from turn order since trackMarks step 7, 2026-11-06)
    const at = (turn, active, extra) => Object.assign(blank(), { turn, activePlayerId: active,
      ...(extra === undefined ? {} : { players: ["player-0", "player-1"].map((id) => ({ id, isExtraTurn: id === active && extra })) }) });
    g.turnOwners = { 1: "player-0", 2: "player-1", 3: "player-1" };
    same("#15: a turn Forge flags is an extra turn", h.B.logEvents(h.B.logSnapshot(at(2, "player-1", false)), h.B.logSnapshot(at(3, "player-1", true)), at(3, "player-1", true))[0].includes("(extra turn)"), true);
    same("#15: a turn after the player's own that Forge doesn't flag is not", h.B.logEvents(h.B.logSnapshot(at(2, "player-1", true)), h.B.logSnapshot(at(3, "player-1", false)), at(3, "player-1", false))[0].includes("extra"), false);
    same("#15: nor one on a board without the flag", h.B.logEvents(h.B.logSnapshot(at(2, "player-1")), h.B.logSnapshot(at(3, "player-1")), at(3, "player-1"))[0].includes("extra"), false);
    g.turnOwners = { 1: "player-0", 2: "player-1" };
    same("#15: and a turn after another player's is not", h.B.logEvents(h.B.logSnapshot(at(1, "player-0", false)), h.B.logSnapshot(at(2, "player-1", false)), at(2, "player-1", false))[0].includes("extra"), false);
  }

  // re-test 2's log bugs (docs/HAND-TEST-REBUILT.md "Still wrong", a to i)
  {
    const SHAMAN = (extra = {}) => ({ ...card(50, "Goblin Shaman Token", ["Creature"], { token: true }), ...extra });
    same("a: the attack before what its trigger made in the same board",
      between(board((b) => put(b, "battlefield", SHAMAN())), board((b) => { put(b, "battlefield", SHAMAN({ isAttacking: true })); put(b, "battlefield", TREASURE(51)); }), []),
      ["Blue attacks with Goblin Shaman token", "Blue creates a Treasure token"]);
    same("a: an attack alone is still said",
      between(board((b) => put(b, "battlefield", SHAMAN())), board((b) => put(b, "battlefield", SHAMAN({ isAttacking: true }))), []), ["Blue attacks with Goblin Shaman token"]);
    same("d: a token Forge names \"... Token\" is \"a ... token\"",
      between(board(() => {}), board((b) => put(b, "battlefield", TREASURE(52))), []), ["Blue creates a Treasure token"]);
    same("d: a token whose name starts with a vowel is \"an\"",
      between(board(() => {}), board((b) => put(b, "battlefield", card(52, "Eldrazi Spawn Token", ["Creature"], { token: true }))), []), ["Blue creates an Eldrazi Spawn token"]);
    same("d: two of them, counted",
      between(board(() => {}), board((b) => { put(b, "battlefield", TREASURE(52)); put(b, "battlefield", TREASURE(53)); }), []), ["Blue creates 2 Treasure tokens"]);
    same("d: a copy token keeps the copied card's name",
      between(board(() => {}), board((b) => put(b, "battlefield", card(54, "Mairsil, the Pretender", ["Creature"], { token: true }))), []), ["Blue creates a Mairsil, the Pretender token"]);
    same("a keyword trigger with a capital and a !: For Mirrodin! whole",
      trig(card(55, "Hexplate Wallbreaker", ["Artifact"]), "For Mirrodin! (When this Equipment enters, create a 2/2 red Rebel creature token, then attach this to it.)", { isTrigger: true }),
      ["Hexplate Wallbreaker's For Mirrodin! triggers (Blue)"]);
    same("f: a name ending in s takes an apostrophe alone",
      trig(card(55, "Exchange of Words", ["Instant"]), "Draw a card.", { isTrigger: true }), ["Exchange of Words' ability triggers (Blue)"]);
    same("f: and other names 's",
      trig(card(56, "Goblin Guide", ["Creature"]), "Draw a card.", { isTrigger: true }), ["Goblin Guide's ability triggers (Blue)"]);

    // g: an ability that went on the stack and resolved between two boards, named from the feed's cause
    const ARCH = { ...card(57, "Archmage Emeritus", ["Creature"]), controllerId: "player-1" };
    const drew = (events, extra = () => {}) => between(
      board((b) => { put(b, "battlefield", ARCH, "player-1"); count(b, "hand", 3, "player-1"); count(b, "library", 50, "player-1"); }),
      board((b) => { put(b, "battlefield", ARCH, "player-1"); count(b, "hand", 4, "player-1"); count(b, "library", 49, "player-1"); extra(b); }), events);
    const drawBy = (src, cause = "Draw") => [ev(11, "Library", "Hand", null, "draw", "player-1", { cause, causeName: src, causeCardId: id(57) })];
    same("g: an unseen trigger's draw names the trigger first", drew(drawBy("Archmage Emeritus")), ["Archmage Emeritus' ability resolves (AI 1)", "AI 1 draws a card"]);
    same("g: one the board showed on the stack is not said again",
      drew(drawBy("Archmage Emeritus"), (b) => b.stack.push({ id: "stack-9", sourceId: id(57), identity: { name: "Archmage Emeritus" }, controllerId: "player-1", sourceAbilityText: "Draw a card." })).filter((l) => /resolves/.test(l)), []);
    same("g: a cost is no ability resolving", drew(drawBy("Archmage Emeritus", "Cost:Sacrifice")), ["AI 1 draws a card"]);
    same("g: nor a replacement (its cause is the effect's text)", drew(drawBy("Archmage Emeritus", "Darkblast - Dredge 3")).filter((l) => /resolves/.test(l)), []);
    same("g: nor a draw with no cause", drew([ev(11, "Library", "Hand", null, "draw", "player-1")]), ["AI 1 draws a card"]);
    const SHAMAN_T = { ...card(57, "Goblin Shaman Token", ["Creature"], { token: true }), controllerId: "player-1" };
    // (an enters trigger after the entry that set it off: Eidolon of Blossoms' read before "Asceticism enters", hp-09 run)
    const EIDO = { ...card(58, "Eidolon of Blossoms", ["Enchantment", "Creature"]), text: "Constellation — Whenever Eidolon of Blossoms or another enchantment you control enters, draw a card." };
    const ench = (src, text) => between(
      board((b) => { put(b, "battlefield", { ...src, text }); count(b, "hand", 3); count(b, "library", 50); }),
      board((b) => { put(b, "battlefield", { ...src, text }); put(b, "battlefield", card(59, "Asceticism", ["Enchantment"])); count(b, "hand", 4); count(b, "library", 49); }),
      [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeName: src.identity.name, causeCardId: src.id })]);
    same("g: an enters trigger resolves after the entry", ench(EIDO, EIDO.text), ["Asceticism enters the battlefield (Blue)", "Eidolon of Blossoms' ability resolves (Blue)", "Blue draws a card"]);
    same("g: a cast trigger is not moved after it", ench(EIDO, "Whenever you cast an enchantment spell, draw a card.").slice(0, 2), ["Eidolon of Blossoms' ability resolves (Blue)", "Asceticism enters the battlefield (Blue)"]);
    same("g: a token's ability is the token's, in the log's own words",
      between(board((b) => { put(b, "battlefield", SHAMAN_T, "player-1"); count(b, "hand", 3, "player-1"); count(b, "library", 50, "player-1"); }),
        board((b) => { put(b, "battlefield", SHAMAN_T, "player-1"); count(b, "hand", 4, "player-1"); count(b, "library", 49, "player-1"); }),
        drawBy("Goblin Shaman Token")), ["Goblin Shaman token's ability resolves (AI 1)", "AI 1 draws a card"]);
    // (and its trigger seen on the stack: "Goblin Shaman Token's ability triggers" on the real table, 2026-11-05)
    const shamanTrig = { id: "stack-9", sourceId: id(57), identity: { name: "Goblin Shaman Token" }, controllerId: "player-1", isTrigger: true,
      sourceAbilityText: "Whenever this creature attacks, create a tapped Treasure token." };
    same("a token's trigger on the stack is the token's, in the log's own words",
      between(board((b) => put(b, "battlefield", SHAMAN_T, "player-1")), board((b) => { put(b, "battlefield", SHAMAN_T, "player-1"); b.stack = [shamanTrig]; }), []),
      ["Goblin Shaman token's ability triggers (AI 1)"]);
    same("g: a card moved by its own ability is no other ability resolving",
      drew([ev(11, "Library", "Hand", id(57), "draw", "player-1", { cause: "Draw", causeName: "Archmage Emeritus", causeCardId: id(57) })]).filter((l) => /resolves/.test(l)), []);
    const OPT = card(59, "Opt", ["Instant"]);
    same("g: a source off the battlefield (a spell gone to the graveyard) is not an ability",
      between(board((b) => { put(b, "graveyard", OPT, "player-1"); count(b, "hand", 3, "player-1"); count(b, "library", 50, "player-1"); }),
        board((b) => { put(b, "graveyard", OPT, "player-1"); count(b, "hand", 4, "player-1"); count(b, "library", 49, "player-1"); }),
        [ev(11, "Library", "Hand", null, "draw", "player-1", { cause: "Draw", causeName: "Opt", causeCardId: id(59) })]).filter((l) => /resolves/.test(l)), []);

    // i: a spell that resolved in the turn just ended, on the board that began the next, before the next turn's header
    const TOP = { ...card(58, "Sensei's Divining Top", ["Artifact"]), controllerId: "player-1" };
    const turnOf = (turn, active) => (b) => Object.assign(b, { turn, activePlayerId: active, priorityPlayerId: active });
    const topLines = between(
      board((b) => { turnOf(3, "player-1")(b); b.stack.push({ id: "stack-7", sourceId: id(58), identity: { name: "Sensei's Divining Top" }, controllerId: "player-1" }); }),
      board((b) => { turnOf(4, "player-0")(b); put(b, "battlefield", TOP, "player-1"); }), []);
    ok("i: the old turn's resolution, then the new turn's header", topLines[0] === "Sensei's Divining Top enters the battlefield (AI 1)" && /^--- Blue's turn/.test(topLines[1] || ""), JSON.stringify(topLines));
    const topThenDraw = between(
      board((b) => { turnOf(3, "player-1")(b); count(b, "hand", 3); count(b, "library", 50); b.stack.push({ id: "stack-7", sourceId: id(58), identity: { name: "Sensei's Divining Top" }, controllerId: "player-1" }); }),
      board((b) => { turnOf(4, "player-0")(b); count(b, "hand", 4); count(b, "library", 49); put(b, "battlefield", TOP, "player-1"); }), []);
    ok("i: the header goes just after the old turn's lines, before the new turn's own", topThenDraw[0] === "Sensei's Divining Top enters the battlefield (AI 1)"
      && /^--- Blue's turn/.test(topThenDraw[1] || "") && topThenDraw.length === 3, JSON.stringify(topThenDraw));
    const castThisTurn = (() => {
      const hi = harness.load();
      const seat = setup(hi);
      const MY_TOP = card(58, "Sensei's Divining Top", ["Artifact"]);
      const before = board((b) => { turnOf(3, "player-1")(b); put(b, "hand", MY_TOP); });
      const after = board((b) => { turnOf(4, "player-0")(b); put(b, "battlefield", MY_TOP); });
      seat.board = { state: { gameView: before } };
      hi.B.notePlay(seat, { cardId: id(58), type: "cast", label: "Cast Sensei's Divining Top", mode: { type: "normal" } }, "Sensei's Divining Top", 0);
      return hi.B.logEvents(hi.B.logSnapshot(before), hi.B.logSnapshot(after), after, hi.B.engineFacts([]));
    })();
    ok("i: a spell cast in the new turn itself stays under its header", /^--- Blue's turn/.test(castThisTurn[0] || "") && castThisTurn.length > 1, JSON.stringify(castThisTurn));
    const newTurn = between(board(turnOf(3, "player-1")), board((b) => { turnOf(4, "player-0")(b); put(b, "battlefield", TOP, "player-1"); }), []);
    ok("i: a card that wasn't on the stack stays after the header", /^--- Blue's turn/.test(newTurn[0] || ""), JSON.stringify(newTurn));

    // c: Treasures paid one click a board: one line, rewritten
    const h = harness.load();
    setup(h);
    const g = h.B._getGame();
    const T = [60, 61, 62].map(TREASURE);
    const pubWith = (left, events) => board((b) => { for (const t of left) put(b, "battlefield", t); b.events = events; });
    const sac = (seq, n) => ev(seq, "Battlefield", "Graveyard", id(n), "sacrificed", "player-0", { cause: "Cost:Sacrifice", causeName: "Treasure Token" });
    h.B.updateLog(pubWith(T, []));
    h.B.updateLog(pubWith(T.slice(1), [sac(11, 60)]));
    h.B.updateLog(pubWith(T.slice(2), [sac(12, 61)]));
    same("c: two clicks, one line", g.log, ["Treasure token ×2 are sacrificed for mana"]);
    await h.flush();
    const reset = h.effects.filter((e) => e.tts?.t === "gamelog").at(-1)?.tts;
    same("c: the table's log is sent again with the line rewritten", [reset?.reset, reset?.lines?.at(-1)], [true, "Treasure token ×2 are sacrificed for mana"]);
    h.B.updateLog(pubWith([], [sac(13, 62)]));
    same("c: a third click joins the same line", g.log, ["Treasure token ×3 are sacrificed for mana"]);
    const T2 = [64, 65, 66, 67].map(TREASURE);
    h.B.updateLog(board((b) => { for (const t of T2) put(b, "battlefield", t); put(b, "battlefield", BEAR(63)); b.events = []; }));
    h.B.updateLog(board((b) => { for (const t of T2.slice(1)) put(b, "battlefield", t); put(b, "battlefield", BEAR(63)); b.events = [sac(14, 64)]; }));
    same("c: another line between: a new line", g.log.slice(-1), ["Treasure token is sacrificed for mana"]);
    const seatC = [...g.seats.values()][0];
    seatC.board = { state: { gameView: blank() }, fingerprint: null };
    h.B.onPrompt(seatC, { promptId: 401, decidingPlayerId: "player-0", sourceCard: { identity: { name: "Ancient Copper Dragon" } }, input: { type: "revealCards", cards: [], presentation: { title: "Blue rolled 4" } } });
    h.B.updateLog(board((b) => { for (const t of T2.slice(2)) put(b, "battlefield", t); put(b, "battlefield", BEAR(63)); b.events = [sac(15, 65)]; }));
    same("c: a line said elsewhere between: not joined", g.log.slice(-3), ["Treasure token is sacrificed for mana", "Blue rolls 4 (Ancient Copper Dragon)", "Treasure token is sacrificed for mana"]);
    const GOB = (n) => card(n, "Goblin Token", ["Creature"], { token: true });
    h.B.updateLog(board((b) => { put(b, "battlefield", T2[3]); put(b, "battlefield", BEAR(63)); put(b, "battlefield", GOB(68)); b.events = [sac(16, 66)]; }));
    same("c: a board saying something else first: not joined", g.log.slice(-2), ["Blue creates a Goblin token", "Treasure token is sacrificed for mana"]);
    const bearSac = (seq, n) => ev(seq, "Battlefield", "Graveyard", id(n), "sacrificed", "player-0", { cause: "Cost:Sacrifice", causeName: "Village Rites" });
    h.B.updateLog(board((b) => { put(b, "battlefield", T2[3]); put(b, "battlefield", GOB(68)); put(b, "battlefield", GOB(69)); b.events = []; }));
    h.B.updateLog(board((b) => { put(b, "battlefield", T2[3]); put(b, "battlefield", GOB(68)); b.events = [bearSac(17, 69)]; }));
    h.B.updateLog(board((b) => { put(b, "battlefield", T2[3]); b.events = [bearSac(18, 68)]; }));
    same("c: other sacrifices are not joined", g.log.slice(-2), ["Goblin token is sacrificed (to pay for Village Rites)", "Goblin token is sacrificed (to pay for Village Rites)"]);
    // (real TTS, 2026-11-05: the last click lands on the board that shows the cast)
    const T3 = [70, 71].map(TREASURE);
    const INSP_C = card(72, "Inspiration", ["Instant"]);
    const INSP = { id: "stack-7", sourceId: id(72), identity: { name: "Inspiration" }, controllerId: "player-0" };
    h.B.updateLog(board((b) => { for (const t of T3) put(b, "battlefield", t); put(b, "hand", INSP_C); b.events = []; }));
    h.B.updateLog(board((b) => { put(b, "battlefield", T3[1]); put(b, "hand", INSP_C); b.events = [sac(19, 70)]; }));
    h.B.updateLog(board((b) => { b.stack = [INSP]; b.events = [sac(20, 71)]; }));
    same("c: the click that lands with the cast joins too, before the cast", g.log.slice(-2), ["Treasure token ×2 are sacrificed for mana", "Blue casts Inspiration"]);
    harness.restore();

    // b: a die roll in the log, said of its roller
    const h2 = harness.load();
    const seat = setup(h2);
    seat.board = { state: { gameView: blank() }, fingerprint: null };
    const roll = (title, n) => h2.B.onPrompt(seat, { promptId: n, decidingPlayerId: "player-0", sourceCard: { identity: { name: "Ancient Copper Dragon" } }, input: { type: "revealCards", cards: [], presentation: { title } } });
    roll("Blue rolled 6", 301);
    roll("AI 1 rolled 17", 302);
    roll("Something else happened", 303);
    roll("Goblin rolled 3", 304);
    roll("Blue rolled 3 and 5", 305);
    same("b: a die roll is the roller's, not \"saw\"", h2.B._getGame().log, ["Blue rolls 6 (Ancient Copper Dragon)", "AI 1 rolls 17 (Ancient Copper Dragon)",
      "Blue saw: Ancient Copper Dragon: Something else happened", "Blue saw: Ancient Copper Dragon: Goblin rolled 3", "Blue rolls 3 and 5 (Ancient Copper Dragon)"]);
    harness.restore();
  }

  // bridge fix batch 2026-11-07 (keyword sweep and live checks, tmp/kw-runs/SUMMARY.md)
  {
    // persist's return names its -1/-1 counter, as undying's names its +1/+1 (kw-10: "Kitchen Finks returns to the
    // battlefield from White's graveyard (White)")
    const FINKS = card(40, "Kitchen Finks", ["Creature"]);
    same("persist: the return names its -1/-1 counter",
      between(board((b) => put(b, "graveyard", FINKS)), board((b) => put(b, "battlefield", { ...FINKS, counters: { M1M1: 1 } })), [ev(11, "Graveyard", "Battlefield", id(40))]),
      ["Kitchen Finks returns to the battlefield from Blue's graveyard with a -1/-1 counter (Blue)"]);
    // forage's exile, its cost, goes before the draw it paid for, and names its card once (live check 11: "White draws a
    // card", then "Island, Island, Island are exiled from White's graveyard (to pay for Treetop Sentries) with Treetop
    // Sentries")
    const SENTRIES = card(41, "Treetop Sentries", ["Creature"]);
    const ISLES = [42, 43, 44].map((n) => card(n, "Island", ["Land"]));
    const forage = { cause: "Cost:Forage", causeName: "Treetop Sentries", causeCardId: id(41) };
    same("forage: the cost's exile first, then the draw, the card named once",
      between(board((b) => { lib(50)(b); put(b, "battlefield", SENTRIES); for (const c of ISLES) put(b, "graveyard", c); }),
        board((b) => { lib(49, 4)(b); put(b, "battlefield", SENTRIES); for (const c of ISLES) put(b, "exile", { ...c, exiledWith: id(41) }); }),
        [...ISLES.map((c, k) => ev(11 + k, "Graveyard", "Exile", c.id, null, "player-0", forage)), ev(14, "Library", "Hand", null, "draw")]),
      ["Island, Island, Island are exiled from Blue's graveyard (to pay for Treetop Sentries)", "Blue draws a card"]);
    // empower: the Jace token's loyalty, made and then added to (kw-07: the second Empower said nothing, the table showed
    // Loyalty 4; the first named no loyalty)
    const JACE = card(45, "Jace Token", ["Planeswalker"], { token: true });
    same("empower: the new Jace token names its loyalty",
      between(board(() => {}), board((b) => put(b, "battlefield", { ...JACE, counters: { LOYALTY: 2 } })), [ev(11, null, "Battlefield", id(45))]),
      ["Blue creates a Jace token with 2 loyalty counters"]);
    same("empower: loyalty put on an existing token is said, with the total",
      between(board((b) => put(b, "battlefield", { ...JACE, counters: { LOYALTY: 2 } })), board((b) => put(b, "battlefield", { ...JACE, counters: { LOYALTY: 4 } })), []),
      ["Jace token gets 2 loyalty counters (4 in all)"]);
    // (not a planeswalker's own loyalty cost: its ability's line says that)
    const WALKER = { ...card(46, "Jace Beleren", ["Planeswalker"]), counters: { LOYALTY: 3 } };
    same("loyalty: a planeswalker's own +ability is no extra line",
      between(board((b) => put(b, "battlefield", WALKER)), board((b) => { put(b, "battlefield", { ...WALKER, counters: { LOYALTY: 5 } }); b.stack = [{ id: "stack-9", sourceId: id(46), identity: { name: "Jace Beleren" }, controllerId: "player-0", sourceAbilityText: "+2: Each player draws a card." }]; }), []),
      ["Blue uses Jace Beleren's ability"]);
    // tribute not paid: the creature enters with no counters, which no line said (kw-22)
    const RAVAGER = { ...card(47, "Nessian Wilds Ravager", ["Creature"]), text: "Tribute 6 (As this creature enters, an opponent of your choice may put six +1/+1 counters on it.)\nWhen this creature enters, if tribute wasn't paid, you may have it fight another target creature." };
    same("tribute: unpaid is said",
      between(board(() => {}), board((b) => put(b, "battlefield", RAVAGER)), [ev(11, "Stack", "Battlefield", id(47))]),
      ["Nessian Wilds Ravager enters the battlefield (Blue)", "Tribute wasn't paid for Nessian Wilds Ravager"]);
    same("tribute: paid, the counters say it",
      between(board(() => {}), board((b) => put(b, "battlefield", { ...RAVAGER, counters: { P1P1: 6 } })), [ev(11, "Stack", "Battlefield", id(47))]),
      ["Nessian Wilds Ravager enters the battlefield with 6 +1/+1 counters (Blue)"]);
    // detain: the target, once the trigger resolved (kw-21: "Lyev Skyknight's ability triggers (White)" only)
    const KNIGHT = card(48, "Lyev Skyknight", ["Creature"]);
    const WALL = { ...card(49, "Wall of Omens", ["Creature"]), controllerId: "player-1" };
    const DETAIN = { id: "stack-8", sourceId: id(48), identity: { name: "Lyev Skyknight" }, controllerId: "player-0", isTrigger: true,
      sourceAbilityText: "When Lyev Skyknight enters, detain target nonland permanent an opponent controls. (Until your next turn, that permanent can't attack or block and its activated abilities can't be activated.)", targets: [{ kind: "card", id: id(49) }] };
    same("detain: its permanent is said detained",
      between(board((b) => { put(b, "battlefield", KNIGHT); put(b, "battlefield", WALL, "player-1"); b.stack = [DETAIN]; }), board((b) => { put(b, "battlefield", KNIGHT); put(b, "battlefield", WALL, "player-1"); }), []),
      ["Wall of Omens is detained: until Blue's next turn it can't attack or block, and its activated abilities can't be activated"]);
    // living weapon's trigger by its whole keyword (kw-16: "Batterskull's living triggers"; Forge writes "Living Weapon")
    const SKULL = card(50, "Batterskull", ["Artifact"]);
    same("living weapon: the trigger by its two words",
      between(board((b) => put(b, "battlefield", SKULL)), board((b) => { put(b, "battlefield", SKULL); b.stack = [{ id: "stack-10", sourceId: id(50), identity: { name: "Batterskull" }, controllerId: "player-0",
        sourceAbilityText: "Living Weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)" }]; }), []),
      ["Batterskull's living weapon triggers (Blue)"]);
  }
  // grandeur's card into the hand by name: the revealed card it stopped at, the last one (kw-25: "White reveals Island,
  // Divination from their library (Page, Loose Leaf)", then "White puts a card from their library into their hand")
  {
    const h = harness.load();
    const seat = setup(h);
    seat.board = { state: { gameView: blank() }, fingerprint: null };
    const lookAt = { promptId: 401, decidingPlayerId: "player-0", sourceCard: { id: id(51), identity: { name: "Page, Loose Leaf" } },
      sourceAbilityText: "Grandeur — Discard another card named Page, Loose Leaf: Reveal cards from the top of your library until you reveal an instant or sorcery card. Put that card into your hand and the rest on the bottom of your library in a random order.",
      input: { type: "revealCards", zone: "library", ownerPlayerId: "player-0", cards: [card(52, "Island", ["Land"]), card(53, "Divination", ["Sorcery"])], presentation: { title: "Page, Loose Leaf - Revealing cards from" } } };
    h.B.onPrompt(seat, lookAt); await h.flush(1);
    seat.note("search", seat.slot);
    const lines = h.B.logEvents(h.B.logSnapshot(board(lib(50))), h.B.logSnapshot(board(lib(49, 4))), board(lib(49, 4)), h.B.engineFacts([ev(11, "Library", "Hand", null, null)]));
    ok("grandeur: the card put into the hand is the one it stopped at", lines.includes("Blue puts Divination from their library into their hand") || lines.some((l) => /Divination/.test(l) && /into their hand/.test(l)), JSON.stringify(lines));
    harness.restore();
  }

  // checker round 2026-11-07
  // Fathom Trawl (DigUntil Amount$ 3): the three nonland cards found can be anywhere among those revealed, so not the
  // last three; named only by the cards that reached the hand on its owner's own board, else counted
  {
    const TRAWL = "Reveal cards from the top of your library until you reveal three nonland cards. Put the nonland cards revealed this way into your hand, then put the rest of the revealed cards on the bottom of your library in any order.";
    const shown = [card(61, "Island", ["Land"]), card(62, "Opt", ["Instant"]), card(63, "Island", ["Land"]), card(64, "Brainstorm", ["Instant"]), card(65, "Forest", ["Land"]), card(66, "Divination", ["Sorcery"])];
    const trawl = async (hand) => {
      const h = harness.load();
      const seat = setup(h);
      seat.board = { state: { gameView: board((b) => { for (const c of hand) put(b, "hand", c); }) }, fingerprint: null };
      h.B.onPrompt(seat, { promptId: 402, decidingPlayerId: "player-0", sourceCard: { id: id(60), identity: { name: "Fathom Trawl" } }, sourceAbilityText: TRAWL,
        input: { type: "revealCards", zone: "library", ownerPlayerId: "player-0", cards: shown, presentation: { title: "Fathom Trawl - Revealing cards from" } } });
      await h.flush(1);
      const lines = h.B.logEvents(h.B.logSnapshot(board(lib(50))), h.B.logSnapshot(board(lib(47, 6))), board(lib(47, 6)),
        h.B.engineFacts([ev(11, "Library", "Hand", null, null), ev(12, "Library", "Hand", null, null), ev(13, "Library", "Hand", null, null)]));
      harness.restore();
      return lines.filter((l) => /into their hand/.test(l));
    };
    same("fathom trawl: its three not named as the last three revealed, counted when the hand isn't seen", await trawl([]), ["Blue puts 3 cards from their library into their hand"]);
    same("fathom trawl: named by the cards now in its owner's hand", await trawl([shown[1], shown[3], shown[5]]), ["Blue puts Opt, Brainstorm, Divination into their hand"]);
  }
  // detain "up to two target" (Azorius Justiciar, Lyev Decree, Archon of the Triumvirate), and not one countered
  {
    const JUSTICIAR = card(67, "Azorius Justiciar", ["Creature"]);
    const WALL = { ...card(68, "Wall of Omens", ["Creature"]), controllerId: "player-1" }, GIANT = { ...card(69, "Hill Giant", ["Creature"]), controllerId: "player-1" };
    const trig = (targets) => ({ id: "stack-30", sourceId: id(67), identity: { name: "Azorius Justiciar" }, controllerId: "player-0", isTrigger: true,
      sourceAbilityText: "When Azorius Justiciar enters, detain up to two target creatures your opponents control. (Until your next turn, those creatures can't attack or block and their activated abilities can't be activated.)",
      targets: targets.map((t) => ({ kind: "card", id: t })) });
    const field = (b) => { put(b, "battlefield", JUSTICIAR); put(b, "battlefield", WALL, "player-1"); put(b, "battlefield", GIANT, "player-1"); };
    same("detain up to two: both said",
      between(board((b) => { field(b); b.stack = [trig([id(68), id(69)])]; }), board(field), []),
      ["Wall of Omens, Hill Giant are detained: until Blue's next turn they can't attack or block, and their activated abilities can't be activated"]);
    same("detain up to two, one chosen: it is said",
      between(board((b) => { field(b); b.stack = [trig([id(68)])]; }), board(field), []),
      ["Wall of Omens is detained: until Blue's next turn it can't attack or block, and its activated abilities can't be activated"]);
    const DECREE = { id: "stack-31", sourceId: id(70), identity: { name: "Lyev Decree" }, controllerId: "player-0",
      sourceAbilityText: "Detain up to two target creatures your opponents control. (Until your next turn, those creatures can't attack or block and their activated abilities can't be activated.)", targets: [{ kind: "card", id: id(68) }] };
    const COUNTER = { id: "stack-32", sourceId: id(71), identity: { name: "Counterspell" }, controllerId: "player-1", sourceAbilityText: "Counter target spell.", targets: [{ kind: "spell", id: "stack-31" }] };
    const countered = between(board((b) => { field(b); b.stack = [DECREE, COUNTER]; }),
      board((b) => { field(b); put(b, "graveyard", card(70, "Lyev Decree", ["Sorcery"])); put(b, "graveyard", { ...card(71, "Counterspell", ["Instant"]), controllerId: "player-1" }, "player-1"); }), []);
    ok("detain: a countered one detains nothing", countered.includes("Lyev Decree is countered") && !countered.some((l) => /detained/.test(l)), JSON.stringify(countered));
    // (jr suite 2026-11-07) the same for goad and suspect: what is countered did nothing (the one list they all read,
    // `resolved`); the same spell not countered still says it, so the check can't pass by saying nothing at all
    for (const [name, text, re] of [["Disrupt Decorum", "Goad target creature an opponent controls.", /goaded/], ["Case of the Stashed Skeleton", "Suspect target creature.", /suspected/]]) {
      const SPELL = { id: "stack-34", sourceId: id(81), identity: { name }, controllerId: "player-0", sourceAbilityText: text, targets: [{ kind: "card", id: id(68) }] };
      const COUNTER2 = { ...COUNTER, id: "stack-35", targets: [{ kind: "spell", id: "stack-34" }] };
      const done = (b) => { field(b); put(b, "graveyard", card(81, name, ["Sorcery"])); };
      const hit = between(board((b) => { field(b); b.stack = [SPELL, COUNTER2]; }), board((b) => { done(b); put(b, "graveyard", { ...card(71, "Counterspell", ["Instant"]), controllerId: "player-1" }, "player-1"); }), []);
      const free = between(board((b) => { field(b); b.stack = [SPELL]; }), board(done), []);
      ok(`${re.source}: precondition, not countered it is said`, free.some((l) => re.test(l)), JSON.stringify(free));
      ok(`${re.source}: a countered one is not said`, hit.includes(`${name} is countered`) && !hit.some((l) => re.test(l)), JSON.stringify(hit));
    }
  }
  // loyalty: an AI planeswalker's own +1 that no board showed is no extra line; a rise that can't be its ability is
  // (Chandra, Torch of Defiance's abilities as Forge writes them: CostPutCounter "+1", CostRemoveCounter "-3")
  {
    const CHANDRA_TEXT = "+1: Exile the top card of your library. You may cast that card. If you don't, Chandra, Torch of Defiance deals 2 damage to each opponent.\n+1: Add {R}{R}.\n-3: Chandra, Torch of Defiance deals 4 damage to target creature.\n-7: You get an emblem with \"Whenever you cast a spell, this emblem deals 5 damage to any target.\"";
    const CHANDRA = (loy) => ({ ...card(72, "Chandra, Torch of Defiance", ["Planeswalker"]), controllerId: "player-1", text: CHANDRA_TEXT, counters: { LOYALTY: loy } });
    const aiTurn = (b) => { b.activePlayerId = "player-1"; b.priorityPlayerId = "player-1"; };
    const at = (loy, fill = () => {}) => board((b) => { put(b, "battlefield", CHANDRA(loy), "player-1"); fill(b); });
    same("loyalty: an AI's +1 no board showed is its own ability, no line", between(at(4, aiTurn), at(5, aiTurn), []), []);
    same("loyalty: a rise on another player's turn is said", between(at(4), at(5), []), ["Chandra, Torch of Defiance gets a loyalty counter (5 in all)"]);
    same("loyalty: a rise no +N cost fits is said", between(at(4, aiTurn), at(6, aiTurn), []), ["Chandra, Torch of Defiance gets 2 loyalty counters (6 in all)"]);
    // (jr suite 2026-11-07) the timing's other two parts: outside its controller's main phase, and with a spell gone from
    // the stack on the same board (a proliferate's), the rise is an effect's and said
    const combat = (b) => { aiTurn(b); b.step = "combatDeclareAttackers"; };
    same("loyalty: a +1-sized rise in combat is said", between(at(4, combat), at(5, combat), []), ["Chandra, Torch of Defiance gets a loyalty counter (5 in all)"]);
    const PROLIF = { id: "stack-41", sourceId: id(82), identity: { name: "Steady Progress" }, controllerId: "player-1", sourceAbilityText: "Proliferate. Draw a card." };
    const gone = between(at(4, (b) => { aiTurn(b); b.stack = [PROLIF]; }), at(5, (b) => { aiTurn(b); put(b, "graveyard", { ...card(82, "Steady Progress", ["Instant"]), controllerId: "player-1" }, "player-1"); }), []);
    ok("loyalty: a +1-sized rise with a spell gone from the stack is said", gone.includes("Chandra, Torch of Defiance gets a loyalty counter (5 in all)"), JSON.stringify(gone));
    {
      // (a second rise in the same turn: a planeswalker activates once a turn, so this one is an effect's)
      const h = harness.load();
      setup(h);
      const step = (a, b) => h.B.logEvents(h.B.logSnapshot(a), h.B.logSnapshot(b), b, null);
      const first = step(at(4, aiTurn), at(5, aiTurn)), second = step(at(5, aiTurn), at(6, aiTurn));
      same("loyalty: the first +1 of a turn is the ability", first, []);
      same("loyalty: a second +1 that turn is said", second, ["Chandra, Torch of Defiance gets a loyalty counter (6 in all)"]);
      harness.restore();
    }
    {
      // (the player's own activation, its record taken: its "uses" line says it, no loyalty line, though no board showed it
      // and nothing in its text fits)
      const h = harness.load();
      setup(h);
      const JACE = (loy) => ({ ...card(73, "Jace Beleren", ["Planeswalker"]), counters: { LOYALTY: loy } });
      h.B._getGame().pendingPlays = [{ id: id(73), name: "Jace Beleren", ctl: "player-0", kind: "ability", text: "", at: Date.now(), promptId: 0 }];
      const lines = h.B.logEvents(h.B.logSnapshot(board((b) => put(b, "battlefield", JACE(3)))), h.B.logSnapshot(board((b) => put(b, "battlefield", JACE(5)))), board((b) => put(b, "battlefield", JACE(5))), null);
      ok("loyalty: the player's own activation record is no loyalty line", !lines.some((l) => /loyalty counter/.test(l)), JSON.stringify(lines));
      harness.restore();
    }
  }
  // forage order: a group moves above the draw by its own first move, not any cost of its player's before the draw (a
  // Treasure sacrificed to pay, then the draw, then delve's exiles: the delve line stays after the draw)
  {
    const TREASURE = card(74, "Treasure Token", ["Artifact"], { token: true });
    const CRUISE = card(75, "Treasure Cruise", ["Sorcery"]);
    const GY = [76, 77, 78].map((n) => card(n, "Island", ["Land"]));
    const lines = between(board((b) => { lib(50)(b); put(b, "battlefield", TREASURE); for (const c of GY) put(b, "graveyard", c); }),
      board((b) => { lib(49, 4)(b); for (const c of GY) put(b, "exile", c); }),
      [ev(11, "Battlefield", "Graveyard", id(74), "sacrificed", "player-0", { cause: "Cost:Sacrifice", causeName: "Treasure Token", causeCardId: id(74) }),
        ev(12, "Library", "Hand", null, "draw"),
        ...GY.map((c, k) => ev(13 + k, "Graveyard", "Exile", c.id, null, "player-0", { cause: "Cost:Delve", causeName: "Treasure Cruise", causeCardId: id(75) }))]);
    const drawAt = lines.indexOf("Blue draws a card"), delveAt = lines.findIndex((l) => /^Island, Island, Island are exiled from Blue's graveyard/.test(l));
    ok("forage order: a delve after the draw stays after it, though a Treasure was sacrificed to pay before it", drawAt >= 0 && delveAt > drawAt, JSON.stringify(lines));
  }
  // tribute: declined while counters arrive from another source (Master Biomancer's), told by Forge's own "if tribute
  // wasn't paid" trigger, made only when it wasn't
  {
    const RAVAGER = { ...card(79, "Nessian Wilds Ravager", ["Creature"]), text: "Tribute 6 (As this creature enters, an opponent of your choice may put six +1/+1 counters on it.)\nWhen this creature enters, if tribute wasn't paid, you may have it fight another target creature." };
    const NOT_PAID = { id: "stack-33", sourceId: id(79), identity: { name: "Nessian Wilds Ravager" }, controllerId: "player-0", isTrigger: true,
      sourceAbilityText: "When Nessian Wilds Ravager enters, if tribute wasn't paid, you may have Nessian Wilds Ravager fight another target creature." };
    const BIO = card(80, "Master Biomancer", ["Creature"]);
    same("tribute: unpaid with Master Biomancer's counters, its trigger on the stack, is said",
      between(board((b) => put(b, "battlefield", BIO)), board((b) => { put(b, "battlefield", BIO); put(b, "battlefield", { ...RAVAGER, counters: { P1P1: 2 } }); b.stack = [NOT_PAID]; }), [ev(11, "Stack", "Battlefield", id(79))]).filter((l) => /Tribute/.test(l)),
      ["Tribute wasn't paid for Nessian Wilds Ravager"]);
    same("tribute: paid with Master Biomancer's, no trigger, not said",
      between(board((b) => put(b, "battlefield", BIO)), board((b) => { put(b, "battlefield", BIO); put(b, "battlefield", { ...RAVAGER, counters: { P1P1: 8 } }); }), [ev(11, "Stack", "Battlefield", id(79))]).filter((l) => /Tribute/.test(l)),
      []);
    {
      // (its trigger seen a board later, and said once)
      const h = harness.load();
      setup(h);
      const step = (a, b) => h.B.logEvents(h.B.logSnapshot(a), h.B.logSnapshot(b), b, null);
      const on = (fill = () => {}) => board((b) => { put(b, "battlefield", BIO); put(b, "battlefield", { ...RAVAGER, counters: { P1P1: 2 } }); fill(b); });
      const a = step(board((b) => put(b, "battlefield", BIO)), on()), b2 = step(on(), on((b) => { b.stack = [NOT_PAID]; })), c = step(on((b) => { b.stack = [NOT_PAID]; }), on());
      same("tribute: the trigger a board later says it then, once", [a, b2, c].map((ls) => ls.filter((l) => /Tribute/.test(l))), [[], ["Tribute wasn't paid for Nessian Wilds Ravager"], []]);
      // (jr suite 2026-11-07) "forgotten as it leaves": the same card dies and comes back, its tribute unpaid again, and
      // it is said again
      const gone = board((b) => { put(b, "battlefield", BIO); put(b, "graveyard", RAVAGER); });
      const back = board((b) => { put(b, "battlefield", BIO); put(b, "battlefield", RAVAGER); });
      const d = step(on(), gone), e = step(gone, back);
      same("tribute: a card that left and came back unpaid is said again", [d, e].map((ls) => ls.filter((l) => /Tribute/.test(l))), [[], ["Tribute wasn't paid for Nessian Wilds Ravager"]]);
      harness.restore();
    }
    {
      // (the player's own trigger asking its question before any board shows it: noted at the question)
      const h = harness.load();
      const seat = setup(h);
      seat.board = { state: { gameView: blank() }, fingerprint: null };
      h.B.onPrompt(seat, { promptId: 403, decidingPlayerId: "player-0", sourceCard: { id: id(79), identity: { name: "Nessian Wilds Ravager" } }, sourceAbilityText: NOT_PAID.sourceAbilityText,
        input: { type: "chooseBoolean", confirmLabel: "Yes", denyLabel: "No", presentation: { title: "Use triggered ability of Nessian Wilds Ravager?" } } });
      await h.flush(1);
      const lines = h.B.logEvents(h.B.logSnapshot(board((b) => put(b, "battlefield", BIO))), h.B.logSnapshot(board((b) => { put(b, "battlefield", BIO); put(b, "battlefield", { ...RAVAGER, counters: { P1P1: 2 } }); })),
        board((b) => { put(b, "battlefield", BIO); put(b, "battlefield", { ...RAVAGER, counters: { P1P1: 2 } }); }), h.B.engineFacts([ev(11, "Stack", "Battlefield", id(79))]));
      same("tribute: its trigger's question noted, then said on its arrival", lines.filter((l) => /Tribute/.test(l)), ["Tribute wasn't paid for Nessian Wilds Ravager"]);
      // (jr suite 2026-11-07) the same trigger's question again (a second target question, a rewind's replay) while the
      // card stays: said once, not again on the next board
      h.B.onPrompt(seat, { promptId: 404, decidingPlayerId: "player-0", sourceCard: { id: id(79), identity: { name: "Nessian Wilds Ravager" } }, sourceAbilityText: NOT_PAID.sourceAbilityText,
        input: { type: "chooseBoolean", confirmLabel: "Yes", denyLabel: "No", presentation: { title: "Use triggered ability of Nessian Wilds Ravager?" } } });
      await h.flush(1);
      const stays = board((b) => { put(b, "battlefield", BIO); put(b, "battlefield", { ...RAVAGER, counters: { P1P1: 2 } }); });
      const again = h.B.logEvents(h.B.logSnapshot(stays), h.B.logSnapshot(stays), stays, null);
      same("tribute: asked again after it was said, not said again", again.filter((l) => /Tribute/.test(l)), []);
      harness.restore();
    }
  }

  process.stdout.write(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
