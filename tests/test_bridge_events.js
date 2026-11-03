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
const ev = (seq, from, to, cardId, how, ownerId = "player-0") => ({ seq, ...(cardId ? { cardId } : {}), ...(from ? { from } : {}), to, ownerId, ...(how ? { how } : {}) });
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
  same("token: sacrificed", gone(TOKEN(), [ev(11, "Battlefield", "Graveyard", id(5), "sacrificed")]), ["Goblin Token is sacrificed"]);
  same("token: dies", gone(TOKEN(), [ev(11, "Battlefield", "Graveyard", id(5), "destroyed")]), ["Goblin Token dies"]);
  same("token: exiled", gone(TOKEN(), [ev(11, "Battlefield", "Exile", id(5))]), ["Goblin Token is exiled"]);
  same("bounced: back to a hand no fuller than before (a discard beside it)",
    between(board((b) => { put(b, "battlefield", BEAR()); count(b, "hand", 3); }), board((b) => count(b, "hand", 3)), [ev(11, "Battlefield", "Hand", id(1))]),
    ["Grizzly Bears returns to Blue's hand"]);
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
  same("discards: one line for several",
    between(board((b) => lib(50, 5)(b)), board((b) => { lib(50, 3)(b); put(b, "graveyard", BEAR()); put(b, "graveyard", SWORD()); }),
      [ev(11, "Hand", "Graveyard", id(1), "discard"), ev(12, "Hand", "Graveyard", id(2), "discard")]),
    ["Blue discards Grizzly Bears, Bonesplitter"]);
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
    ["Grizzly Bears is put into Blue's graveyard"]);
  same("from the hand: into the graveyard without a discard isn't one",
    between(board((b) => lib(50, 4)(b)), board((b) => { lib(50)(b); put(b, "graveyard", BEAR()); }), [ev(11, "Hand", "Graveyard", id(1))]),
    ["Grizzly Bears is put into Blue's graveyard"]);

  // lands: played, or put there
  same("land: played from the hand", between(board(lib(50, 4)), board((b) => { lib(50)(b); put(b, "battlefield", LAND()); }), [ev(11, "Hand", "Battlefield", id(3), "played")]),
    ["Blue plays Mountain"]);
  same("land: put from the hand by an effect is not a land play",
    between(board(lib(50, 4)), board((b) => { lib(50)(b); put(b, "battlefield", LAND()); }), [ev(11, "Hand", "Battlefield", id(3))]),
    ["Blue puts Mountain onto the battlefield"]);
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
    same("feed: one move per card, first zone to last, keeping how it left", m, { from: "Battlefield", to: "Exile", how: "sacrificed" });
    same("feed: a single lost entry is lost", F([ev(13, "Hand", "Exile", id(2))]), null);
  }

  process.stdout.write(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
