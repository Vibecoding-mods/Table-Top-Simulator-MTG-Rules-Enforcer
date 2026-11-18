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

  // one spell's draws split over two boards by a question between them (the spell still on the stack in the first): one
  // line. Village Rites' "draw two cards" read "draws a card" twice when a Darkblast in the graveyard asked "dredge?"
  // between the draws, live_events_check 2026-11-09. Events as EngineEventLog sends them (markCause: the ApiType name,
  // the host's name and id).
  {
    const RITES = card(20, "Village Rites", ["Instant"]);
    const onStack = { id: "stack-20", sourceId: id(20), identity: { name: "Village Rites" }, controllerId: "player-0", text: "As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards." };
    const draw = (seq, n, by = { cause: "Draw", causeName: "Village Rites", causeCardId: id(20) }) => ev(seq, "Library", "Hand", id(n), "draw", "player-0", by);
    const run = async (boards) => {
      const h = harness.load();
      setup(h);
      const g = h.B._getGame();
      // (a string between the boards: a line said in between, as an answer's own line is)
      for (const step of boards) {
        if (typeof step === "string") { h.B.gameLogLine(step); continue; }
        const [events, fill] = step;
        h.B.updateLog(Object.assign(board(fill), { events }));
      }
      await h.flush();
      const sentLogs = h.effects.filter((e) => e.tts && e.tts.t === "gamelog").map((e) => e.tts);
      const file = h.effects.filter((e) => e.appendFile === "game-log.txt").flatMap((e) => e.text.split("\n")).filter((l) => l && !/ === Game: /.test(l)).map((l) => l.replace(/^\[time\] /, ""));
      harness.restore();
      return { log: g.log ?? [], last: sentLogs.at(-1), file };
    };
    const at = (hand, lib, stack, gy = []) => (b) => { count(b, "hand", hand); count(b, "library", lib); b.stack = stack; for (const c of gy) put(b, "graveyard", c); };
    const first = [[], at(3, 50, [onStack])];
    const mid = [[draw(11, 31)], at(4, 49, [onStack])];
    const split = await run([first, mid, [[draw(11, 31), draw(12, 32), ev(13, "Stack", "Graveyard", id(20), null)], at(5, 48, [], [RITES])]]);
    ok("draws split by a question: one line for the spell's two", split.log.includes("Blue draws 2 cards") && !split.log.includes("Blue draws a card"), JSON.stringify(split.log));
    ok("draws split by a question: the table's log is sent again", split.last && split.last.reset === true && split.last.lines.includes("Blue draws 2 cards"), JSON.stringify(split.last));
    same("draws split by a question: game-log.txt says the joined line again, in place of the first", split.file,
      ["Blue draws a card", "Blue draws 2 cards (in place of \"Blue draws a card\")"]);
    // (and a new line on the board that joins it comes after the joined line, as in the table's log)
    const splitAndBear = await run([first, mid, [[draw(11, 31), draw(12, 32), ev(13, "Stack", "Graveyard", id(20), null)], (b) => { at(5, 48, [], [RITES])(b); put(b, "battlefield", BEAR()); }]]);
    same("draws split by a question, a creature with them: the joined line before the new one in game-log.txt", splitAndBear.file,
      ["Blue draws a card", "Blue draws 2 cards (in place of \"Blue draws a card\")", ...splitAndBear.log.slice(splitAndBear.log.indexOf("Blue draws 2 cards") + 1)]);
    ok("draws split by a question, a creature with them: a line after the joined one", splitAndBear.file.length > 2, JSON.stringify(splitAndBear.file));
    // (three draws over three boards, two questions between them: one line again)
    const three = await run([first, mid, [[draw(11, 31), draw(12, 32)], at(5, 48, [onStack])], [[draw(12, 32), draw(13, 33), ev(14, "Stack", "Graveyard", id(20), null)], at(6, 47, [], [RITES])]]);
    ok("draws split by two questions: one line for the three", three.log.includes("Blue draws 3 cards") && !three.log.some((l) => /^Blue draws (?:a card|2 cards)$/.test(l)), JSON.stringify(three.log));
    // (a line said between the two boards came after the first draw: two lines, in their order)
    const said = await run([first, mid, "Blue chooses Island (Village Rites)", [[draw(11, 31), draw(12, 32), ev(13, "Stack", "Graveyard", id(20), null)], at(5, 48, [], [RITES])]]);
    const firstDraw = said.log.indexOf("Blue draws a card");
    ok("draws with a line said between: not joined, and in their order", !said.log.includes("Blue draws 2 cards") && firstDraw >= 0 && said.log.indexOf("Blue chooses Island (Village Rites)") > firstDraw && said.log.lastIndexOf("Blue draws a card") > firstDraw, JSON.stringify(said.log));
    // (and a board of its own lines after the first, with none of the spell's draws: the line is not joined later)
    const withBear = (f) => (b) => { f(b); put(b, "battlefield", BEAR()); };
    const bearDies = ev(12, "Battlefield", "Graveyard", id(1), "destroyed");
    const between2 = await run([[[], withBear(at(3, 50, [onStack]))], [[draw(11, 31)], withBear(at(4, 49, [onStack]))], [[draw(11, 31), bearDies], at(4, 49, [onStack], [BEAR()])],
      [[draw(11, 31), bearDies, draw(13, 32), ev(14, "Stack", "Graveyard", id(20), null)], at(5, 48, [], [BEAR(), RITES])]]);
    ok("draws with another board's lines between: that board's line is logged", between2.log.includes("Grizzly Bears dies"), JSON.stringify(between2.log));
    ok("draws with another board's lines between: not joined", !between2.log.includes("Blue draws 2 cards") && between2.log.filter((l) => l === "Blue draws a card").length === 2, JSON.stringify(between2.log));
    // (dredged instead: the second draw is replaced, the card comes from the graveyard; one card drawn, said so)
    const DARK = card(40, "Darkblast", ["Instant"]);
    const dredged = await run([first, [[draw(11, 31)], at(4, 49, [onStack], [DARK])],
      [[draw(11, 31), ev(12, "Library", "Graveyard", id(33), "mill", "player-0", { cause: "Darkblast - Dredge 1" }), ev(13, "Graveyard", "Hand", id(40), null, "player-0", { cause: "Darkblast - Dredge 1" }), ev(14, "Stack", "Graveyard", id(20), null)],
        at(5, 47, [], [RITES, card(33, "Island", ["Land"])])]]);
    ok("dredged instead: the one draw stays one card", dredged.log.includes("Blue draws a card") && !dredged.log.includes("Blue draws 2 cards"), JSON.stringify(dredged.log));
    // (two draws of the same card's, the first already resolved: two lines)
    const twice = await run([first, [[draw(11, 31)], at(4, 49, [])], [[draw(11, 31), draw(12, 32)], at(5, 48, [])]]);
    ok("draws of a spell already off the stack: not joined", twice.log.filter((l) => l === "Blue draws a card").length === 2, JSON.stringify(twice.log));
    // (a board whose draws had two causes, the spell's last: its line isn't the spell's, so not joined)
    const plainDraw = (seq, n) => ev(seq, "Library", "Hand", id(n), "draw");
    const mixed = await run([first, [[plainDraw(11, 30), draw(12, 31)], at(5, 48, [onStack])], [[plainDraw(11, 30), draw(12, 31), draw(13, 32), ev(14, "Stack", "Graveyard", id(20), null)], at(6, 47, [], [RITES])]]);
    ok("draws of two causes in one board: not joined to the next", mixed.log.includes("Blue draws 2 cards") && mixed.log.includes("Blue draws a card") && !mixed.log.includes("Blue draws 3 cards"), JSON.stringify(mixed.log));
    // (a draw step's draw has no cause card: never joined)
    const plain = (seq, n) => ev(seq, "Library", "Hand", id(n), "draw");
    const steps = await run([[[], at(3, 50, [onStack])], [[plain(11, 31)], at(4, 49, [onStack])], [[plain(11, 31), plain(12, 32)], at(5, 48, [onStack])]]);
    ok("draws with no cause card: not joined", steps.log.filter((l) => l === "Blue draws a card").length === 2, JSON.stringify(steps.log));
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
    ["Darkblast is put into Blue's hand from the graveyard (Raise Dead)"]);
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
    same("feed: one move per card, first zone to last, keeping how it left (and its owner, Forge's)", m, { from: "Battlefield", to: "Exile", how: "sacrificed", through: "Graveyard", owner: "player-0" });
    same("feed: a single lost entry is lost", F([ev(13, "Hand", "Exile", id(2))]), null);
    h.B._getGame().eventSeq = 11;
    same("feed: and the cause of its first move",
      F([ev(12, "Library", "Graveyard", id(1), "mill", "player-0", { cause: "Mill", causeName: "Glimpse the Unthinkable" }), ev(13, "Graveyard", "Exile", id(1), null, "player-0", { cause: "ChangeZone", causeName: "Bojuka Bog" })]).moves.get(id(1)),
      { from: "Library", to: "Exile", how: "mill", through: "Graveyard", cause: "Mill", causeName: "Glimpse the Unthinkable", owner: "player-0" });
  }

  // exile, said by its kind (exileKind, EXILE_WORDS)
  same("exile: from another player's graveyard, said as theirs",
    between(board((b) => put(b, "graveyard", BEAR(), "player-1")), board((b) => put(b, "exile", BEAR(), "player-1")),
      [ev(11, "Graveyard", "Exile", id(1), null, "player-1", { cause: "ChangeZone", causeName: "Bojuka Bog" })]),
    ["Grizzly Bears is exiled from AI 1's graveyard by Bojuka Bog"]);
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
    // (verify 2026-11-07) a card with a sacrifice for mana and another sacrifice too (Transmogrant Altar's token ability)
    // may have been paid either way: said as paying for it
    const ALTAR = { ...card(33, "Transmogrant Altar", ["Artifact"]), text: "{B}, {T}, Sacrifice a creature: Add {C}{C}{C}.\n{2}, {T}, Sacrifice a creature: Create a 3/3 colorless Zombie artifact creature token. Activate only as a sorcery." };
    same("cost: a sacrifice to a card with a mana sacrifice and another sacrifice says what it paid for",
      between(board((b) => { put(b, "battlefield", ALTAR); put(b, "battlefield", SPIRIT); }), board((b) => put(b, "battlefield", ALTAR)),
        [ev(11, "Battlefield", "Graveyard", id(31), "sacrificed", "player-0", paid("Sacrifice", "Transmogrant Altar"))]),
      ["Spirit token is sacrificed (to pay for Transmogrant Altar)"]);
    // (and the mana source only on the board after: Kykar came down and was used between two boards)
    same("cost: a mana source on the later board only still makes it for mana",
      between(board((b) => put(b, "battlefield", SPIRIT)), board((b) => put(b, "battlefield", KYKAR)),
        [ev(11, "Battlefield", "Graveyard", id(31), "sacrificed", "player-0", paid("Sacrifice", "Kykar, Wind's Fury"))]),
      ["Kykar, Wind's Fury enters the battlefield (Blue)", "Spirit token is sacrificed for mana (Kykar, Wind's Fury)"]);
  }
  same("cost: delve's cards, one line apart from a plain exile from the same graveyard",
    between(board((b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", SWORD()); put(b, "graveyard", LAND()); }),
      board((b) => { put(b, "exile", BEAR()); put(b, "exile", SWORD()); put(b, "exile", LAND()); }),
      [ev(11, "Graveyard", "Exile", id(1), null, "player-0", paid("Delve", "Treasure Cruise")), ev(12, "Graveyard", "Exile", id(2), null, "player-0", paid("Delve", "Treasure Cruise")),
        ev(13, "Graveyard", "Exile", id(3), null, "player-0", { cause: "ChangeZone", causeName: "Bojuka Bog" })]),
    ["Grizzly Bears, Bonesplitter are exiled from Blue's graveyard (delve for Treasure Cruise)", "Mountain is exiled from Blue's graveyard by Bojuka Bog"]);
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
  same("stack: and an ability with no keyword stays an ability", used("{1}, Exile this card from your graveyard: Draw a card."), ["AI 1 uses Combat Courier's ability: draw a card"]);
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
  // a card exiled from the hand to pay a cost says what it paid for: Fury's evoke, "Exile a red card from your hand", read
  // only "Sneak Attack is exiled" (live game 2026-11-11 21:58; the cause as the harness writes it, EngineEventLog costName:
  // the ability's keyword, then its alternative cost, then the cost part's class)
  {
    const FURY = { id: "engine-stack-30", sourceId: id(300), identity: { name: "Fury" }, controllerId: "player-1", isPermanentSpell: true,
      sourceAbilityText: "Double strike", text: "Fury (300) - Fury" };
    const pitch = (cause) => between(board((b) => { count(b, "hand", 5, "player-1"); }),
      board((b) => { count(b, "hand", 3, "player-1"); b.stack.push(FURY); put(b, "exile", { ...card(301, "Sneak Attack", ["Enchantment"]), controllerId: "player-1" }, "player-1"); }),
      [ev(11, "Hand", "Stack", id(300), null, "player-1"), ev(12, "Hand", "Exile", id(301), null, "player-1", cause)]);
    same("exiled from the hand: an evoke cost names the spell it paid for",
      pitch({ cause: "Cost:Evoke", causeName: "Fury", causeCardId: id(300) }), ["AI 1 casts Fury", "AI 1 exiles Sneak Attack from their hand to cast Fury (evoke)"]);
    same("exiled from the hand: a cost with no keyword, by the cost part, still names the spell",
      pitch({ cause: "Cost:Exile", causeName: "Fury", causeCardId: id(300) }), ["AI 1 casts Fury", "AI 1 exiles Sneak Attack from their hand to cast Fury"]);
    same("exiled from the hand: by an effect, not a cost, is no cost's line: it names the effect's card",
      pitch({ cause: "ChangeZone", causeName: "Fury", causeCardId: id(300) }), ["AI 1 casts Fury", "Sneak Attack is exiled by Fury"]);
  }
  // what a resolved item did comes before what was put on the stack after it: Fury's damage killed four creatures and then
  // the AI activated Jace, all in one board, and the deaths read after "AI 1 activates Jace Beleren's +2" (live game
  // 2026-11-11 22:00:16, White's "Resolve" #57)
  {
    const FURY_ETB = { id: "engine-stack-31", sourceId: id(300), identity: { name: "Fury" }, controllerId: "player-1", isTrigger: true,
      sourceAbilityText: "When Fury enters, it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers.", text: "Fury (300) - Fury deals 4 damage divided as you choose." };
    const JACE = (loyalty) => ({ ...card(310, "Jace Beleren", ["Planeswalker"]), controllerId: "player-1", counters: { LOYALTY: loyalty } });
    const JACE_UP = { id: "engine-stack-32", sourceId: id(310), identity: { name: "Jace Beleren" }, controllerId: "player-1",
      sourceAbilityText: "+2: Each player draws a card.", text: "Jace Beleren (310) - Each player draws a card." };
    const victims = [card(311, "Prodigal Pyromancer", ["Creature"]), card(312, "Llanowar Elves", ["Creature"])];
    same("order: the deaths a resolved trigger caused come before the next activation",
      between(board((b) => { b.stack.push(FURY_ETB); put(b, "battlefield", JACE(1), "player-1"); for (const v of victims) put(b, "battlefield", v); }),
        board((b) => { b.stack.push(JACE_UP); put(b, "battlefield", JACE(3), "player-1"); for (const v of victims) put(b, "graveyard", v); }),
        victims.map((v, i) => ev(11 + i, "Battlefield", "Graveyard", v.id, "destroyed"))),
      ["Prodigal Pyromancer dies", "Llanowar Elves dies", "AI 1 activates Jace Beleren's +2 (loyalty 1 -> 3): each player draws a card"]);
    same("order: a spell cast in answer to one still on the stack stays where it was",
      between(board((b) => { b.stack.push(FURY_ETB); for (const v of victims) put(b, "battlefield", v); }),
        board((b) => { b.stack.push(FURY_ETB, { ...SPELL, id: "engine-stack-33" }); put(b, "graveyard", victims[0]); put(b, "battlefield", victims[1]); }),
        [ev(11, "Battlefield", "Graveyard", victims[0].id, "sacrificed")]),
      ["AI 1 casts Lightning Bolt", "Prodigal Pyromancer is sacrificed"]);
  }
  // cipher: the encoded creature's trigger casts a copy of the exiled card. Forge gives the copy a card of its own and no
  // copy flag, so it read "White casts Last Thoughts" (keyword sweep kw-17, 2026-11-06; boards as the table got them:
  // the trigger "engine-stack-14" from Grizzly Bears engine-card-230, then "engine-stack-15" Last Thoughts from engine-card-236)
  {
    const CIPHER = "Whenever Grizzly Bears deals combat damage to a player, its controller may cast a copy of Last Thoughts without paying its mana cost.";
    const encoded = (b) => { put(b, "battlefield", BEAR(230)); put(b, "exile", card(229, "Last Thoughts", ["Sorcery"])); b.step = "combatDamage"; };
    same("stack: a cipher copy is a copy, not a cast",
      between(board((b) => { encoded(b); b.stack.push({ id: "engine-stack-14", sourceId: id(230), identity: { name: "Grizzly Bears" }, controllerId: "player-0", isTrigger: true,
        sourceAbilityText: CIPHER, text: `Grizzly Bears (230) - ${CIPHER}` }); }),
      board((b) => { encoded(b); b.stack.push({ id: "engine-stack-15", sourceId: id(236), identity: { name: "Last Thoughts" }, controllerId: "player-0",
        sourceAbilityText: "Draw a card.", text: "Last Thoughts (236) - Blue draws a card. " }); }), []),
      ["Blue copies Last Thoughts"]);
  }

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
  same("#8: a delayed trigger by Forge's own ending", trig(FABLE, "Sacrifice Goblin Shaman at the beginning of the next end step."), ["Fable of the Mirror-Breaker's ability triggers (Blue): sacrifice Goblin Shaman at the beginning of the next end step"]);
  same("#8: and any trigger the engine marks as one", trig(FABLE, "Draw a card.", { isTrigger: true }), ["Fable of the Mirror-Breaker's ability triggers (Blue): draw a card"]);
  same("#8: an activation ending like a delayed trigger stays used", trig(FABLE, "{1}, {T}: Create a token that's a copy of another target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step."),
    ["Blue uses Fable of the Mirror-Breaker's ability: create a token that's a copy of another target nonlegendary creature you control, except..."]);
  same("#8: an ability the engine doesn't mark stays used", trig(FABLE, "Draw a card."), ["Blue uses Fable of the Mirror-Breaker's ability: draw a card"]);
  same("#8: a keyword's trigger keeps its keyword when marked", trig(FABLE, "Evoke (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)", { isTrigger: true }), ["Fable of the Mirror-Breaker's evoke triggers (Blue)"]);

  const TREASURE = (n) => ({ ...card(n, "Treasure Token", ["Artifact"], { token: true }), text: "{T}, Sacrifice this artifact: Add one mana of any color." });
  same("#3: Treasures sacrificed for their own mana, one line",
    between(board((b) => { put(b, "battlefield", TREASURE(20)); put(b, "battlefield", TREASURE(21)); put(b, "battlefield", TREASURE(22)); }), board(() => {}),
      [20, 21, 22].map((n, i) => ev(11 + i, "Battlefield", "Graveyard", id(n), "sacrificed", "player-0", { cause: "Cost:Sacrifice", causeName: "Treasure Token" }))),
    ["Treasure token ×3 are sacrificed for mana"]);
  same("#3: a Treasure an effect made its player sacrifice is not 'for mana'",
    gone(TREASURE(20), [ev(11, "Battlefield", "Graveyard", id(20), "sacrificed", "player-0", { cause: "Sacrifice", causeName: "Innocent Blood" })]), ["Treasure token is sacrificed (Innocent Blood)"]);
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
    ["Blue uses Mairsil, the Pretender's ability (Royal Assassin's): destroy target tapped creature"]);
  const LOOSE = { ...ASSASSIN, exiledWith: undefined };
  same("#17: a card in exile not caged by it lends it nothing",
    between(board((b) => { put(b, "battlefield", MAIRSIL); put(b, "exile", LOOSE); }), board((b) => { put(b, "battlefield", MAIRSIL); put(b, "exile", LOOSE); b.stack.push(onStack(MAIRSIL, "{T}: Destroy target tapped creature.")); }), []),
    ["Blue uses Mairsil, the Pretender's ability: destroy target tapped creature"]);

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
    ["Niv-Mizzet, Visionary is countered by Arcane Denial and returns to the command zone"]);
  // (Forge's own stack ids, which it never gives twice; its feed has no cast from the command zone)
  const NIV_LANDED = { ...NIV_SPELL, id: "engine-stack-41" }, NIV_AGAIN = { ...NIV_SPELL, id: "engine-stack-48" };
  const DENIAL_ON = { ...DENIAL, id: "engine-stack-44", targets: [{ kind: "spell", id: "engine-stack-41" }] };
  const RECAST_FEED = [ev(11, "Stack", "Graveyard", id(47)), ev(12, "Stack", "Graveyard", id(46), null, "player-1"), ev(13, "Graveyard", "Command", id(46), null, "player-1")];
  same("re-test 2: a commander countered and recast before the next board says both",
    between(board((b) => { b.stack.push(DENIAL_ON, NIV_LANDED); }), board((b) => { b.stack.push(NIV_AGAIN); put(b, "graveyard", card(47, "Arcane Denial", ["Instant"])); }), RECAST_FEED),
    ["Niv-Mizzet, Visionary is countered by Arcane Denial and returns to the command zone", "AI 1 casts Niv-Mizzet, Visionary"]);
  same("and the same from a feed that has its cast too",
    between(board((b) => { b.stack.push(DENIAL_ON, NIV_LANDED); }), board((b) => { b.stack.push(NIV_AGAIN); put(b, "graveyard", card(47, "Arcane Denial", ["Instant"])); }),
      [...RECAST_FEED, ev(14, "Command", "Stack", id(46), null, "player-1")]),
    ["Niv-Mizzet, Visionary is countered by Arcane Denial and returns to the command zone", "AI 1 casts Niv-Mizzet, Visionary"]);
  same("and with no feed, countered and cast, not where it went",
    between(board((b) => { b.stack.push(DENIAL_ON, NIV_LANDED); }), board((b) => { b.stack.push(NIV_AGAIN); put(b, "graveyard", card(47, "Arcane Denial", ["Instant"])); }), null),
    ["Niv-Mizzet, Visionary is countered by Arcane Denial", "AI 1 casts Niv-Mizzet, Visionary"]);
  same("and one bounced and recast is just cast again",
    between(board((b) => { b.stack.push(NIV_LANDED); }), board((b) => { b.stack.push(NIV_AGAIN); }),
      [ev(11, "Stack", "Hand", id(46), null, "player-1"), ev(12, "Hand", "Stack", id(46), null, "player-1")]),
    ["Niv-Mizzet, Visionary returns to AI 1's hand", "AI 1 casts Niv-Mizzet, Visionary"]);
  same("and one still on the stack under its own id is no new cast",
    between(board((b) => { b.stack.push(DENIAL_ON, NIV_LANDED); }), board((b) => { b.stack.push(NIV_LANDED); }), RECAST_FEED),
    []);
  same("and one seen again while still being cast is cast again too",
    between(board((b) => { b.stack.push(DENIAL_ON, NIV_LANDED); }), board((b) => { b.stack.push({ ...NIV_SPELL, id: "casting-10009" }); put(b, "graveyard", card(47, "Arcane Denial", ["Instant"])); }), RECAST_FEED),
    ["Niv-Mizzet, Visionary is countered by Arcane Denial and returns to the command zone", "AI 1 casts Niv-Mizzet, Visionary"]);
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
    ["Mind Bend is countered by Counterspell"]);
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
    ["AI 1 casts Counterspell", "Craw Wurm is countered by Counterspell"]);
  same("kw-14: and an instant the same way",
    answered(BOLT_UP, (b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", BOLT_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell", "Lightning Bolt is countered by Counterspell"]);
  // (the Bolt resolved, and its Bears died after it left the stack: of its damage, Kykar #11)
  same("kw-14: an instant that left the stack after the AI's counterspell resolved, not countered",
    answered(BOLT_UP, (b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", BOLT_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(72), null, "player-1"), ev(12, "Stack", "Graveyard", id(71)), ev(13, "Battlefield", "Graveyard", id(1), "destroyed")]),
    ["Lightning Bolt deals 3 damage to Grizzly Bears", "Grizzly Bears dies", "AI 1 casts Counterspell"]);
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
    ["Blue casts Negate", "Craw Wurm enters the battlefield (Blue)", "AI 1 casts Counterspell", "Counterspell is countered by Negate"]);
  // (and one with a spell before it that resolved: the countered Counterspell took nothing off, so the Opt that left
  // first resolved; it read "Opt is countered" with the countered counter's own targets read, mutation pass 2026-11-06)
  const OPT_MINE = { ...card(79, "Opt", ["Instant"]), text: "Scry 1.\nDraw a card." };
  same("kw-14: a countered counterspell takes nothing off, the spell before it resolved",
    answered(WURM, (b) => { put(b, "battlefield", WURM_CARD); put(b, "graveyard", OPT_MINE); put(b, "graveyard", COUNTERSPELL, "player-1"); put(b, "graveyard", NEGATE_MINE); },
      [ev(11, "Stack", "Graveyard", id(79)), ev(12, "Stack", "Graveyard", id(72), null, "player-1"), ev(13, "Stack", "Graveyard", id(77)), ev(14, "Stack", "Battlefield", id(70))]),
    ["Blue casts Opt", "Blue casts Negate", "Craw Wurm enters the battlefield (Blue)", "AI 1 casts Counterspell", "Counterspell is countered by Negate"]);
  same("kw-14: a creature spell straight from the stack into the graveyard, no counterspell seen (an ability's), is countered",
    between(board((b) => b.stack.push(WURM)), board((b) => put(b, "graveyard", WURM_CARD)), [ev(11, "Stack", "Graveyard", id(70))]),
    ["Craw Wurm is countered"]);
  same("kw-14: but not one that entered first (evoke, the legend rule)",
    between(board((b) => b.stack.push(WURM)), board((b) => put(b, "graveyard", WURM_CARD)), [ev(11, "Stack", "Battlefield", id(70)), ev(12, "Battlefield", "Graveyard", id(70), "sacrificed")]),
    []);
  // (a sorcery face's stack item has its spell text, as every instant's and sorcery's does in Forge's feed: Counterspell's
  // came as sourceAbilityText with sp set, live check 2026-11-12; the words here stand for any sorcery face's)
  same("kw-14: nor a double-faced card's sorcery face, which resolves into the graveyard",
    between(board((b) => b.stack.push({ ...WURM, identity: { name: "Tibalt's Trickery" }, sourceAbilityText: "Draw two cards." })),
      board((b) => put(b, "graveyard", WURM_CARD)), [ev(11, "Stack", "Graveyard", id(70))]),
    []);
  // (but a permanent face, which has no spell text, straight into the graveyard was countered: Valki cast as Tibalt,
  // Cosmic Impostor under the AI's Counterspell, in the engine's own shape (no targets, Forge's stack words), read no
  // "is countered" while Fury's did, live check 2026-11-12)
  {
    const TIBALT = { id: "engine-stack-3", sourceId: id(67), identity: { name: "Tibalt, Cosmic Impostor" }, controllerId: "player-0", text: "Tibalt, Cosmic Impostor", targets: [] };
    const FURY = { id: "engine-stack-22", sourceId: id(68), identity: { name: "Fury" }, controllerId: "player-0", text: "Fury (Evoked)", targets: [] };
    const CS_ON = (on) => ({ id: "engine-stack-7", sourceId: id(72), identity: { name: "Counterspell" }, controllerId: "player-1", sourceAbilityText: "Counter target spell.", text: `Counter ${on}.`, targets: [] });
    const countered = (spell, gyCard) => between(board((b) => b.stack.push(spell, CS_ON(spell.identity.name))),
      board((b) => { put(b, "graveyard", gyCard); put(b, "graveyard", COUNTERSPELL, "player-1"); }),
      [ev(11, "Stack", "Graveyard", spell.sourceId), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]);
    const t = countered(TIBALT, card(67, "Valki, God of Lies", ["Creature"]));
    same("countered: a modal DFC's permanent face countered says so, by the face cast", t, ["Tibalt, Cosmic Impostor is countered by Counterspell"]);
    same("countered: and the lines name its card as countered (the table's ctrd)", t.countered, [id(67)]);
    const f = countered(FURY, card(68, "Fury", ["Creature"]));
    same("countered: Fury, as live", f, ["Fury is countered by Counterspell"]);
    same("countered: its card named too", f.countered, [id(68)]);
    // (and by the face cast when the counterspell's target is known: White's own Counterspell on its Tibalt read "Valki,
    // God of Lies is countered by Counterspell", live check batch 2 2026-11-12)
    const aimed = between(board((b) => b.stack.push(TIBALT, { ...CS_ON("Tibalt, Cosmic Impostor"), targets: [{ kind: "spell", id: "engine-stack-3" }] })),
      board((b) => { put(b, "graveyard", card(67, "Valki, God of Lies", ["Creature"])); put(b, "graveyard", COUNTERSPELL, "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(67)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]);
    same("countered: a modal DFC's face countered by a targeted counterspell, by the face cast", aimed, ["Tibalt, Cosmic Impostor is countered by Counterspell"]);
    same("countered: a spell that resolved names nothing", between(board((b) => b.stack.push(FURY)), board((b) => put(b, "battlefield", card(68, "Fury", ["Creature"]))),
      [ev(11, "Stack", "Battlefield", id(68))]).countered, []);
  }
  same("kw-14: a commander countered by the AI between two boards says so",
    between(board((b) => { b.stack.push({ ...WURM, sourceId: id(46), identity: { name: "Niv-Mizzet, Visionary" } }); count(b, "hand", 7, "player-1"); }),
      board((b) => { put(b, "command", { ...card(46, "Niv-Mizzet, Visionary", ["Creature"]) }); count(b, "hand", 6, "player-1"); put(b, "graveyard", COUNTERSPELL, "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(46)), ev(12, "Graveyard", "Command", id(46)), ev(13, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell", "Niv-Mizzet, Visionary is countered by Counterspell and returns to the command zone"]);
  const AURA = { id: "engine-stack-32", sourceId: id(78), identity: { name: "Pacifism" }, controllerId: "player-0", targets: [{ kind: "card", id: id(1) }] };
  same("kw-14: nor an Aura spell that fizzled, its creature gone",
    between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push(AURA); }), board((b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", { ...card(78, "Pacifism", ["Enchantment"]), subtypes: ["Aura"] }); }),
      [ev(11, "Battlefield", "Graveyard", id(1), "sacrificed"), ev(12, "Stack", "Graveyard", id(78))]),
    ["Grizzly Bears is sacrificed"]);
  same("kw-14: a spell exiled by a counter (Dissipate) is countered and exiled",
    answered(WURM, (b) => { put(b, "exile", WURM_CARD); put(b, "graveyard", DISSIPATE, "player-1"); },
      [ev(11, "Stack", "Exile", id(70)), ev(12, "Stack", "Graveyard", id(73), null, "player-1")]),
    ["AI 1 casts Dissipate", "Craw Wurm is countered by Dissipate and exiled"]);
  same("kw-14: and so under a Dissipate seen on the stack",
    between(board((b) => b.stack.push(WURM, { id: "engine-stack-33", sourceId: id(73), identity: { name: "Dissipate" }, controllerId: "player-1", sourceAbilityText: DISSIPATE.text, targets: [{ kind: "spell", id: WURM.id }] })),
      board((b) => { put(b, "exile", WURM_CARD); put(b, "graveyard", DISSIPATE, "player-1"); }),
      [ev(11, "Stack", "Exile", id(70)), ev(12, "Stack", "Graveyard", id(73), null, "player-1")]),
    ["Craw Wurm is countered by Dissipate and exiled"]);
  // (the feed names causes, as live: a draw's; Forge gives no move off the stack a cause, so buyback is the spell's own return)
  const DRAWN = (seq) => ev(seq, "Library", "Hand", null, "draw", "player-1", { cause: "Draw" });
  same("kw-14: a spell sent back to its hand by Remand is countered and returns there, no buyback",
    answered(BOLT_UP, (b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", REMAND, "player-1"); },
      [ev(11, "Stack", "Hand", id(71)), DRAWN(12), ev(13, "Stack", "Graveyard", id(74), null, "player-1")]),
    ["AI 1 draws a card", "AI 1 casts Remand", "Lightning Bolt is countered by Remand and returns to Blue's hand"]);
  same("kw-14: and so under a Remand seen on the stack",
    between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push(BOLT_UP, { id: "engine-stack-34", sourceId: id(74), identity: { name: "Remand" }, controllerId: "player-1", sourceAbilityText: REMAND.text, targets: [{ kind: "spell", id: BOLT_UP.id }] }); }),
      board((b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", REMAND, "player-1"); }),
      [ev(11, "Stack", "Hand", id(71)), DRAWN(12), ev(13, "Stack", "Graveyard", id(74), null, "player-1")]),
    ["Lightning Bolt is countered by Remand and returns to Blue's hand", "AI 1 draws a card"]);
  same("kw-14: one returned to its hand by a spell that doesn't counter (Unsubstantiate) just returns, no buyback",
    answered(BOLT_UP, (b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", UNSUB, "player-1"); },
      [DRAWN(11), ev(12, "Stack", "Hand", id(71)), ev(13, "Stack", "Graveyard", id(75), null, "player-1")]),
    ["AI 1 draws a card", "AI 1 casts Unsubstantiate", "Lightning Bolt returns to Blue's hand"]);
  same("kw-14: a text change countered by a counterspell no board showed says only that it is countered",
    between(board((b) => { put(b, "battlefield", WRAITH()); b.stack.push(BEND); }),
      board((b) => { put(b, "battlefield", WRAITH()); put(b, "graveyard", card(54, "Mind Bend", ["Instant"])); put(b, "graveyard", COUNTERSPELL, "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(54)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell", "Mind Bend is countered by Counterspell"]);
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
    ["Blue casts Wash Away", "Divination is countered by Wash Away"]);
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
    ["AI 1 casts Disallow", "Lightning Bolt is countered by Disallow"]);
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
    ["AI 1 casts Counterspell", "AI 1 casts Negate", "Divination is countered by Negate"]);
  // (a counter cast another way, seen on the stack, itself countered back to a hand: what it would have countered
  // resolved. Forge's stack words "Counter Divination" still showed, and read "Divination is countered", suite review
  // 2026-11-06: so such a counter goes by its card, and its card is in no public zone)
  const WA_AI = { ...ownStack(81, "Wash Away", CLEAVE_WAY, "Wash Away (81) - Counter Divination (80)."), controllerId: "player-1" };
  same("kw-20: a cleaved Wash Away countered back to its hand by the player's Remand counters nothing",
    between(board((b) => b.stack.push(DIV, WA_AI)), board((b) => { put(b, "graveyard", DIV_CARD); put(b, "graveyard", own(74, "Remand", REMAND.text)); }),
      [ev(11, "Stack", "Hand", id(81), null, "player-1"), ev(12, "Stack", "Graveyard", id(74)), ev(13, "Stack", "Graveyard", id(80))]),
    ["Blue casts Remand", "Wash Away is countered by Remand and returns to AI 1's hand"]);
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
        [`AI 1 casts ${name}`, `Craw Wurm is countered by ${name} and put ${where} Blue's library`]);
    same(`library: and under a ${name} seen on the stack`,
      between(board((b) => b.stack.push(WURM, { id: "engine-stack-37", sourceId: id(92), identity: { name }, controllerId: "player-1", sourceAbilityText: text, targets: [{ kind: "spell", id: WURM.id }] })),
        board((b) => { if (!crumple) put(b, "graveyard", lapse, "player-1"); }), [ev(11, "Stack", "Library", id(70)), ev(12, "Stack", crumple ? "Library" : "Graveyard", id(92), null, "player-1")]),
      [`Craw Wurm is countered by ${name} and put ${where} Blue's library`]);
  }
  same("library: a spell put back into its library by no counter says nothing of being countered",
    between(board((b) => b.stack.push(WURM)), board(() => {}), [ev(11, "Stack", "Library", id(70))]), []);
  // a spell countered at the end of a turn, the next board in the next turn: both lines are the old turn's
  same("turn: a spell countered by the AI at the end of the turn reads above the new turn's header",
    answered(WURM, (b) => { b.turn = 4; b.activePlayerId = "player-1"; put(b, "graveyard", WURM_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(70)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["AI 1 casts Counterspell", "Craw Wurm is countered by Counterspell", "--- AI 1's turn 1 ---"]);
  same("turn: one no board showed, countered on the board of the new turn, still reads after its counter's cast",
    between(board((b) => count(b, "hand", 7, "player-1")),
      board((b) => { b.turn = 4; b.activePlayerId = "player-1"; put(b, "graveyard", BOLT_CARD); put(b, "graveyard", COUNTERSPELL, "player-1"); count(b, "hand", 6, "player-1"); }),
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Graveyard", id(72), null, "player-1")]),
    ["--- AI 1's turn 1 ---", "Blue casts Lightning Bolt", "AI 1 casts Counterspell", "Lightning Bolt is countered by Counterspell"]);
  // (a counter cast from a graveyard, flashback's, goes into exile as it resolves: it counters all the same. On an
  // instant: a creature spell straight into a graveyard reads as countered by itself, see counteredOff)
  same("a counterspell that resolved into exile (flashback) counters its spell",
    answered(BOLT_UP, (b) => { put(b, "battlefield", BEAR()); put(b, "graveyard", BOLT_CARD); put(b, "exile", COUNTERSPELL, "player-1"); },
      [ev(11, "Stack", "Graveyard", id(71)), ev(12, "Stack", "Exile", id(72), null, "player-1")]),
    ["Counterspell is exiled", "Lightning Bolt is countered by Counterspell"]);
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
    ["AI 1 casts Remand", "Lightning Bolt is countered by Remand and returns to Blue's hand", "--- AI 1's turn 1 ---"]);
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
  // (Forge's own dungeonState names the room, docs/planechase-dungeon-engine-spec.md D5/D6: the card by its id, or by its
  // name and owner from an engine that sends no id; the text guess stays the fallback)
  const players = (b, p0 = {}, p1 = {}) => { b.players = [{ id: "player-0", ...p0 }, { id: "player-1", ...p1 }]; return b; };
  const MAD = (room, extra = {}) => ({ dungeonState: { name: "Dungeon of the Mad Mage", room, cardId: id(60), ...extra } });
  same("dungeonState: the room from Forge's state alone", between(players(board(() => {})), players(board((b) => put(b, "command", BARE())), MAD("Yawning Portal")), []),
    ["Blue ventures into Yawning Portal (Dungeon of the Mad Mage)"]);
  same("dungeonState: the next room", between(players(board((b) => put(b, "command", BARE())), MAD("Yawning Portal")), players(board((b) => put(b, "command", BARE())), MAD("Dungeon Level")), []),
    ["Blue ventures into Dungeon Level (Dungeon of the Mad Mage)"]);
  same("dungeonState: by name and owner when there is no card id", between(players(board(() => {})), players(board((b) => put(b, "command", BARE())), { dungeonState: { name: "Dungeon of the Mad Mage", room: "Yawning Portal" } }), []),
    ["Blue ventures into Yawning Portal (Dungeon of the Mad Mage)"]);
  same("dungeonState: another player's dungeon of that name is not this one", between(players(board(() => {})), players(board((b) => put(b, "command", BARE())), {}, { dungeonState: { name: "Dungeon of the Mad Mage", room: "Yawning Portal" } }), []),
    []);
  same("dungeonState: no room yet is no line", between(players(board(() => {})), players(board((b) => put(b, "command", BARE())), MAD("")), []),
    []);
  same("dungeonState: said once with the room's ability on the stack", between(players(board(() => {})), players(board((b) => { put(b, "command", BARE()); b.stack.push(ROOM("Yawning Portal — You gain 1 life.  (Leads to: Dungeon Level)")); }), MAD("Yawning Portal")), []),
    ["Blue ventures into Yawning Portal (Dungeon of the Mad Mage)"]);
  same("dungeonState: Forge's room over a stale note", between(players(board((b) => put(b, "command", DUNGEON("Yawning Portal"))), MAD("Yawning Portal")), players(board((b) => put(b, "command", DUNGEON("Yawning Portal"))), MAD("Dungeon Level")), []),
    ["Blue ventures into Dungeon Level (Dungeon of the Mad Mage)"]);
  const LOST = () => ({ ...card(62, "Lost Mine of Phandelver", ["Dungeon"]), text: "" });
  same("completedDungeons: a completion is said with the count", between(players(board((b) => put(b, "command", LOST())), { dungeonState: { name: "Lost Mine of Phandelver", room: "Temple of Dumathoin", cardId: id(62) }, completedDungeons: [] }),
    players(board(() => {}), { completedDungeons: ["Lost Mine of Phandelver"] }), []),
    ["Blue completes Lost Mine of Phandelver (1 dungeon completed)"]);
  same("completedDungeons: completes, then ventures into the next dungeon on one board", between(players(board((b) => put(b, "command", LOST())), { dungeonState: { name: "Lost Mine of Phandelver", room: "Temple of Dumathoin", cardId: id(62) }, completedDungeons: ["Tomb of Annihilation"] }),
    players(board((b) => put(b, "command", BARE())), { ...MAD("Yawning Portal"), completedDungeons: ["Tomb of Annihilation", "Lost Mine of Phandelver"] }), []),
    ["Blue completes Lost Mine of Phandelver (2 dungeons completed)", "Blue ventures into Yawning Portal (Dungeon of the Mad Mage)"]);
  same("completedDungeons: the same list is no line", between(players(board(() => {}), { completedDungeons: ["Lost Mine of Phandelver"] }), players(board(() => {}), { completedDungeons: ["Lost Mine of Phandelver"] }), []),
    []);
  same("completedDungeons: a shorter list (a rewind) is no line", between(players(board(() => {}), { completedDungeons: ["Lost Mine of Phandelver"] }), players(board(() => {}), { completedDungeons: [] }), []),
    []);
  // (Planechase, docs/planechase-dungeon-engine-spec.md P8: the plane from Forge's planar block; its card goes to the
  // active player's command zone each turn, which is no move; one die line from lastRoll, whoever's seat saw it)
  const PLANE = (n, name, owner = "player-0") => ({ ...card(n, name, ["Plane"]), ownerId: owner, controllerId: owner, text: "" });
  const PHEN = (n, name) => ({ ...card(n, name, ["Phenomenon"]), ownerId: "player-0", text: "" });
  const planar = (b, ids, extra = {}) => { b.planar = { controllerId: "player-0", planeIds: ids, dieRollsThisTurn: 0, deckCounts: {}, ...extra }; return b; };
  same("planar: the first plane is no line", between(board(() => {}), planar(board((b) => put(b, "command", PLANE(70, "Akoum"))), [id(70)]), []), []);
  same("planar: a planeswalk names both planes", between(planar(board((b) => put(b, "command", PLANE(70, "Turri Island"))), [id(70)]),
    planar(board((b) => put(b, "command", PLANE(71, "Akoum"))), [id(71)]), []), ["Blue planeswalks to Akoum (from Turri Island)"]);
  same("planar: a phenomenon is encountered", between(planar(board((b) => put(b, "command", PLANE(70, "Turri Island"))), [id(70)]),
    planar(board((b) => put(b, "command", PHEN(72, "Interplanar Tunnel"))), [id(72)]), []), ["Blue encounters Interplanar Tunnel"]);
  same("planar: the plane moving to the next player's command zone is no move", between(planar(board((b) => put(b, "command", PLANE(70, "Akoum"))), [id(70)]),
    planar(board((b) => put(b, "command", PLANE(70, "Akoum", "player-1"), "player-1")), [id(70)], { controllerId: "player-1" }), []), []);
  same("planar: a roll is said once, from lastRoll", between(planar(board((b) => put(b, "command", PLANE(70, "Akoum"))), [id(70)]),
    planar(board((b) => put(b, "command", PLANE(70, "Akoum"))), [id(70)], { dieRollsThisTurn: 1, lastRoll: { playerId: "player-0", result: "chaos", seq: 1 } }), []),
    ["Blue rolls the planar die: chaos"]);
  same("planar: the same roll again is no line", between(planar(board((b) => put(b, "command", PLANE(70, "Akoum"))), [id(70)], { lastRoll: { playerId: "player-0", result: "blank", seq: 1 } }),
    planar(board((b) => put(b, "command", PLANE(70, "Akoum"))), [id(70)], { lastRoll: { playerId: "player-0", result: "blank", seq: 1 } }), []), []);
  same("planar: a roll's planeswalk: the roll, then the planeswalk", between(planar(board((b) => put(b, "command", PLANE(70, "Turri Island"))), [id(70)]),
    planar(board((b) => put(b, "command", PLANE(71, "Akoum"))), [id(71)], { lastRoll: { playerId: "player-0", result: "planeswalk", seq: 2 } }), []),
    ["Blue rolls the planar die: planeswalk", "Blue planeswalks to Akoum (from Turri Island)"]);
  // (a plane's chaos trigger by its word, with what it does: Akoum's read "Akoum's ability triggers (AI 1): destroy ...")
  const CHAOS = { id: "engine-stack-30", sourceId: id(70), controllerId: "player-1", ownerId: "player-1", identity: { name: "Akoum" }, isTrigger: true, targets: [],
    text: "Akoum (70) - Whenever chaos ensues, destroy target creature that isn't enchanted.", sourceAbilityText: "Whenever chaos ensues, destroy target creature that isn't enchanted." };
  same("planar: a chaos trigger is said as chaos", between(planar(board((b) => put(b, "command", PLANE(70, "Akoum", "player-1"), "player-1")), [id(70)], { controllerId: "player-1" }),
    planar(board((b) => { put(b, "command", PLANE(70, "Akoum", "player-1"), "player-1"); b.stack = [CHAOS]; }), [id(70)], { controllerId: "player-1" }), []),
    ["Akoum's chaos triggers (AI 1): destroy target creature that isn't enchanted"]);
  // (rule 901.10: a player leaving the game takes the planes they own with them, and the planar controller planeswalks
  // from their own planar deck. The plane card's ownerId is its command zone's player, so the owner is the player who
  // planeswalked to it, or Forge's own ownerId on one of its triggers on the stack. Boards in order, one bridge.)
  const along = (boards) => {
    const h = harness.load();
    setup(h);
    const lines = [];
    let prev = null;
    for (const b of boards) {
      const snap = h.B.logSnapshot(b);
      if (prev) lines.push(...h.B.logEvents(prev, snap, b, h.B.engineFacts([])));
      prev = snap;
    }
    return lines;
  };
  const out1 = (b) => players(b, {}, { status: "lost" });
  const walk = (ctl, plane = PLANE(70, "Akoum", ctl)) => planar(players(board((b) => put(b, "command", plane, ctl))), [plane.id], { controllerId: ctl });
  const toNaya = () => planar(out1(board((x) => put(x, "command", PLANE(71, "Naya")))), [id(71)]);
  same("901.10: AI 1's plane leaves with AI 1, and Blue planeswalks from Blue's deck",
    along([board(() => {}), walk("player-1"), walk("player-0"), toNaya()]), ["Akoum leaves the game with AI 1; Blue planeswalks to Naya"]);
  same("901.10: a plane of Blue's when AI 1 leaves is an ordinary planeswalk (Pompeii's damage, then its planeswalk)",
    along([board(() => {}), walk("player-0"), toNaya()]), ["Blue planeswalks to Naya (from Akoum)"]);
  same("901.10: the owner from Forge's ownerId on the plane's trigger, over who walked to it",
    along([board(() => {}), walk("player-0"), (() => { const b = walk("player-0"); b.stack = [{ ...CHAOS, controllerId: "player-0" }]; return b; })(), toNaya()]),
    ["Akoum's chaos triggers (Blue): destroy target creature that isn't enchanted", "Akoum leaves the game with AI 1; Blue planeswalks to Naya"]);
  // (the owners are kept in the resume file: a bridge restarted between AI 1's planeswalk and its leaving says it the same)
  {
    const h = harness.load();
    setup(h);
    let prev = null;
    for (const b of [board(() => {}), walk("player-1")]) { const s = h.B.logSnapshot(b); if (prev) h.B.logEvents(prev, s, b, h.B.engineFacts([])); prev = s; }
    const fsm = require("fs");
    const w0 = fsm.writeFile;
    let snapText = null;
    fsm.writeFile = (p, d, ...rest) => { if (/mtg-bridge-game-test\.json\.tmp$/.test(String(p))) snapText = String(d); return w0(p, d, ...rest); };
    h.B.saveResume(); await h.flush();
    fsm.writeFile = w0;
    harness.restore();
    const h2 = harness.load();
    await fsm.promises.writeFile(process.env.MTG_RESUME_FILE, snapText || "{}");
    const resumed = h2.B.resumeGame();
    await fsm.promises.unlink(process.env.MTG_RESUME_FILE).catch(() => {});
    const before = walk("player-0"), after = toNaya();
    same("901.10 after a bridge restart: the plane's owner came back with the game", resumed ? h2.B.logEvents(h2.B.logSnapshot(before), h2.B.logSnapshot(after), after, h2.B.engineFacts([])) : "not resumed",
      ["Akoum leaves the game with AI 1; Blue planeswalks to Naya"]);
    harness.restore();
  }
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
    ["Electro, Assaulting Battery dies", "Electro, Assaulting Battery's ability triggers (Blue): you may pay {X}"]);
  same("#9: a trigger after a grouped line, which keeps its place",
    between(board((b) => { put(b, "battlefield", TREASURE(20)); put(b, "battlefield", TREASURE(21)); put(b, "battlefield", ELECTRO); }),
      board((b) => { put(b, "battlefield", ELECTRO); b.stack.push(onStack(ELECTRO, "Whenever you cast an instant or sorcery spell, add {R}.")); }),
      [20, 21].map((n, i) => ev(11 + i, "Battlefield", "Graveyard", id(n), "sacrificed", "player-0", { cause: "Cost:Sacrifice", causeName: "Treasure Token" }))),
    ["Treasure token ×2 are sacrificed for mana", "Electro, Assaulting Battery's ability triggers (Blue): add {R}"]);
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
    // whom an attack is at (live check 2026-11-11: "White attacks with Hero of Bladehold" when it attacked Jace)
    {
      const HERO = (extra = {}) => ({ ...card(53, "Hero of Bladehold", ["Creature"]), ...extra });
      const BEARS = (extra = {}) => ({ ...BEAR(55), ...extra });
      const JACE = { ...card(54, "Jace Beleren", ["Planeswalker"]), controllerId: "player-1", counters: { LOYALTY: 3 } };
      const fight = (attacking, more = () => {}) => board((b) => { put(b, "battlefield", JACE, "player-1"); for (const c of attacking) put(b, "battlefield", c); more(b); });
      same("attack: a planeswalker attacked is named, with its controller",
        between(fight([HERO()]), fight([HERO({ isAttacking: true, attackTargetId: id(54) })]), []), ["Blue attacks Jace Beleren (AI 1) with Hero of Bladehold"]);
      // (the board says its two players, as Forge's does: with no players at all, any count rule passes)
      const two = (b) => { b.players = ["player-0", "player-1"].map((p) => ({ id: p })); };
      // (named in a game of two as well: "White attacks with Soldier token" and "AI 1 attacks with Craw Wurm" didn't say
      // at whom, live game 2026-11-11 21:36)
      same("attack: the only other player of two is named too",
        between(fight([HERO()], two), fight([HERO({ isAttacking: true, attackTargetId: "player-1" })], two), []), ["Blue attacks AI 1 with Hero of Bladehold"]);
      same("attack: and the AI's attack names the table's player",
        between(fight([{ ...BEAR(56), controllerId: "player-1" }], two), fight([{ ...BEAR(56), controllerId: "player-1", isAttacking: true, attackTargetId: "player-0" }], two), []), ["AI 1 attacks Blue with Grizzly Bears"]);
      same("attack: at the player and at the planeswalker, one line each",
        between(fight([HERO(), BEARS()]), fight([HERO({ isAttacking: true, attackTargetId: id(54) }), BEARS({ isAttacking: true, attackTargetId: "player-1" })]), []),
        ["Blue attacks Jace Beleren (AI 1) with Hero of Bladehold", "Blue attacks AI 1 with Grizzly Bears"]);
      const three = (b) => { b.players = ["player-0", "player-1", "player-2"].map((p) => ({ id: p })); };
      same("attack: in a game of three, the player attacked is named",
        between(fight([HERO()], three), fight([HERO({ isAttacking: true, attackTargetId: "player-1" })], three), []), ["Blue attacks AI 1 with Hero of Bladehold"]);
    }
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
      trig(card(55, "Exchange of Words", ["Instant"]), "Draw a card.", { isTrigger: true }), ["Exchange of Words' ability triggers (Blue): draw a card"]);
    same("f: and other names 's",
      trig(card(56, "Goblin Guide", ["Creature"]), "Draw a card.", { isTrigger: true }), ["Goblin Guide's ability triggers (Blue): draw a card"]);

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
      ["Goblin Shaman token's ability triggers (AI 1): create a tapped Treasure token"]);
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
    // (game-log.txt can't take a line back: each joined line is written again, saying which it stands for)
    await h.flush();
    same("c: the file says each joined line again in place of the last", h.effects.filter((e) => e.appendFile === "game-log.txt").flatMap((e) => e.text.split(/(?<=\n)/)).slice(1),
      ["[time] Treasure token is sacrificed for mana\n", "[time] Treasure token ×2 are sacrificed for mana (in place of \"Treasure token is sacrificed for mana\")\n",
        "[time] Treasure token ×3 are sacrificed for mana (in place of \"Treasure token ×2 are sacrificed for mana\")\n"]);
    const T2 =[64, 65, 66, 67].map(TREASURE);
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
      ["Blue activates Jace Beleren's +2 (loyalty 3 -> 5): each player draws a card"]);
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
    same("fathom trawl: a hand holding more of those revealed than went is counted, not named", await trawl([shown[1], shown[2], shown[3], shown[5]]), ["Blue puts 3 cards from their library into their hand"]);
    // Kykar #10: Fact or Fiction's five revealed (Forge's own reveal title), the pile of two taken to the hand, the
    // other three to the graveyard (Forge's "PeekAndReveal" moves, the ability probe's)
    const FOF = "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.";
    const five = shown.slice(1);
    const h = harness.load();
    const seat = setup(h);
    seat.board = { state: { gameView: board((b) => { put(b, "hand", five[0]); put(b, "hand", five[2]); }) }, fingerprint: null };
    h.B.onPrompt(seat, { promptId: 403, decidingPlayerId: "player-0", sourceCard: { id: id(247), identity: { name: "Fact or Fiction" } }, sourceAbilityText: FOF,
      input: { type: "revealCards", zone: "library", ownerPlayerId: "player-0", cards: five, presentation: { title: "Fact or Fiction - Revealing cards from" } } });
    await h.flush(1);
    const peek = (seq, n, to) => ev(seq, "Library", to, id(n), null, "player-0", { cause: "PeekAndReveal", causeCardId: id(247), causeName: "Fact or Fiction" });
    const fofLines = h.B.logEvents(h.B.logSnapshot(board(lib(50))), h.B.logSnapshot(board(lib(45, 5))), board(lib(45, 5)),
      h.B.engineFacts([peek(11, 62, "Hand"), peek(12, 63, "Graveyard"), peek(13, 64, "Hand"), peek(14, 65, "Graveyard"), peek(15, 66, "Graveyard")]));
    harness.restore();
    same("Kykar #10: Fact or Fiction's pile is named by the cards now in its owner's hand", fofLines,
      ["Blue reveals Opt, Island, Brainstorm, Forest, Divination from their library (Fact or Fiction)", "Blue puts Opt, Brainstorm into their hand"]);
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
    ok("detain: a countered one detains nothing", countered.includes("Lyev Decree is countered by Counterspell") &&!countered.some((l) => /detained/.test(l)), JSON.stringify(countered));
    // (jr suite 2026-11-07) the same for goad and suspect: what is countered did nothing (the one list they all read,
    // `resolved`); the same spell not countered still says it, so the check can't pass by saying nothing at all
    for (const [name, text, re] of [["Disrupt Decorum", "Goad target creature an opponent controls.", /goaded/], ["Case of the Stashed Skeleton", "Suspect target creature.", /suspected/]]) {
      const SPELL = { id: "stack-34", sourceId: id(81), identity: { name }, controllerId: "player-0", sourceAbilityText: text, targets: [{ kind: "card", id: id(68) }] };
      const COUNTER2 = { ...COUNTER, id: "stack-35", targets: [{ kind: "spell", id: "stack-34" }] };
      const done = (b) => { field(b); put(b, "graveyard", card(81, name, ["Sorcery"])); };
      const hit = between(board((b) => { field(b); b.stack = [SPELL, COUNTER2]; }), board((b) => { done(b); put(b, "graveyard", { ...card(71, "Counterspell", ["Instant"]), controllerId: "player-1" }, "player-1"); }), []);
      const free = between(board((b) => { field(b); b.stack = [SPELL]; }), board(done), []);
      ok(`${re.source}: precondition, not countered it is said`, free.some((l) => re.test(l)), JSON.stringify(free));
      ok(`${re.source}: a countered one is not said`, hit.includes(`${name} is countered by Counterspell`) &&!hit.some((l) => re.test(l)), JSON.stringify(hit));
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

  // the Kykar hand test's log bugs (docs/HAND-TEST-KYKAR.md), each from Forge's own shapes as the ability probe and the
  // Kykar probe recorded them on an engine of their own (stack items, prompts, actions, cards, events)
  {
    const life = (b, a, c) => { b.players = [{ id: "player-0", life: a }, { id: "player-1", life: c }]; return b; };
    const opp = (c) => ({ ...c, controllerId: "player-1" });
    // (a bridge of its own for a case that answers questions first; run(seat, h) gives the lines)
    const fresh = (fn) => { const h = harness.load(); const seat = setup(h); try { return fn(h, seat); } finally { harness.restore(); } };
    const logOf = (h, a, b, events = []) => h.B.logEvents(h.B.logSnapshot(a), h.B.logSnapshot(b), b, h.B.engineFacts(events));
    const tableLog = (h) => [...(h.B._getGame().log || [])]; // (the game log's lines: the table's are sent later)

    // #25: Big Score's words start "As an additional cost", which read as a trigger's "As": Twincast's copy of it read
    // "White uses Big Score's ability", and the counter on it said nothing
    const BIG_TEXT = "As an additional cost to cast this spell, discard a card. Draw two cards and create two Treasure tokens. (They're artifacts with \"{T}, Sacrifice this token: Add one mana of any color.\")";
    const BIG = (sid, src) => ({ controllerId: "player-0", id: sid, identity: { name: "Big Score", isToken: false }, isCasting: false, isPermanentSpell: false, ownerId: "player-0",
      sourceAbilityText: BIG_TEXT, sourceId: id(src), targets: [], text: "Big Score (203) - Draw two cards and create two Treasure tokens. " });
    const TWIN = { controllerId: "player-0", id: "engine-stack-4", identity: { name: "Twincast", isToken: false }, isCasting: false, isPermanentSpell: false, ownerId: "player-0",
      sourceAbilityText: "Copy target instant or sorcery spell. You may choose new targets for the copy.", sourceId: id(206), targets: [], text: "Twincast (207) - Copy Big Score (203)." };
    same("Kykar #25: Twincast's copy of Big Score is a copy of a spell, not an ability",
      between(board((b) => b.stack.push(BIG("engine-stack-1", 201), TWIN)),
        board((b) => { b.stack.push(BIG("engine-stack-1", 201), BIG("engine-stack-5", 209)); put(b, "graveyard", card(206, "Twincast", ["Instant"])); }), [ev(11, "Stack", "Graveyard", id(206))]),
      ["Blue copies Big Score"]);
    const FIERCE = { controllerId: "player-0", id: "engine-stack-2", identity: { name: "Fierce Guardianship" }, isPermanentSpell: false, ownerId: "player-0",
      sourceAbilityText: "Counter target noncreature spell.", sourceId: id(210), targets: [], text: "Fierce Guardianship (210) - Counter." };
    same("Kykar #25: Big Score under the player's own Fierce Guardianship is countered, and by it",
      fresh((h) => {
        const g = h.B._getGame();
        g.counterTargets = new Set(["engine-stack-1"]); g.counterTurn = 3; // (the player's own pick, noted by onPrompt)
        return logOf(h, board((b) => b.stack.push(BIG("engine-stack-1", 201), FIERCE)),
          board((b) => { put(b, "graveyard", card(201, "Big Score", ["Sorcery"])); put(b, "graveyard", card(210, "Fierce Guardianship", ["Instant"])); }),
          [ev(11, "Stack", "Graveyard", id(201)), ev(12, "Stack", "Graveyard", id(210))]);
      }),
      ["Big Score is countered by Fierce Guardianship"]);

    // #8: the player's Counterspell names its target (Forge's stack names no spell's target: the player's pick does),
    // and what it countered says by what
    const MARBLE = { controllerId: "player-1", id: "engine-stack-20", identity: { name: "Marble Diamond" }, isPermanentSpell: true, ownerId: "player-1", sourceId: id(229), targets: [], text: "Marble Diamond" };
    const CS = { controllerId: "player-0", id: "engine-stack-21", identity: { name: "Counterspell" }, isPermanentSpell: false, ownerId: "player-0",
      sourceAbilityText: "Counter target spell.", sourceId: id(240), targets: [], text: "Counterspell (243) - Counter." };
    const counterPick = (seat) => {
      seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 85, sourceAbilityText: "Counter target spell.", sourceCard: { id: id(240), identity: { name: "Counterspell" }, text: "Counter target spell." },
        input: { cancellable: true, candidates: [{ id: "engine-stack-20", kind: "spell" }], chosenTargets: 0, hostile: true, intent: "counter", maxTargets: 1, minTargets: 1, presentation: { targets: [], title: "Counter" }, type: "chooseBoardTargets" } };
      seat.respond(85, "chooseBoardTargets", { type: "boardTargets", chosen: [{ kind: "spell", id: "engine-stack-20" }] });
    };
    same("Kykar #8: the player's Counterspell names the spell it targets, then that spell is countered by it",
      fresh((h, seat) => {
        counterPick(seat);
        const a = board((b) => b.stack.push(MARBLE)), b1 = board((b) => b.stack.push(MARBLE, CS));
        const c = board((b) => { put(b, "graveyard", opp(card(229, "Marble Diamond", ["Artifact"])), "player-1"); put(b, "graveyard", card(240, "Counterspell", ["Instant"])); });
        return [...logOf(h, a, b1), ...logOf(h, b1, c, [ev(11, "Stack", "Graveyard", id(229), null, "player-1"), ev(12, "Stack", "Graveyard", id(240))])];
      }),
      ["Blue casts Counterspell targeting Marble Diamond", "Marble Diamond is countered by Counterspell"]);

    // #3: Skullclamp's equip, Forge's own stack item for it (its target a Spirit token)
    const CLAMP = { ...card(223, "Skullclamp", ["Artifact"]), text: "Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}" };
    const SPIRIT = card(211, "Spirit Token", ["Creature"], { token: true });
    const EQUIP = { controllerId: "player-0", id: "engine-stack-9", identity: { name: "Skullclamp", isToken: false }, isPermanentSpell: false, ownerId: "player-0", sourceId: id(223),
      sourceAbilityText: "Equip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)", text: "Skullclamp (222) -  Attach to Spirit Token (212)",
      targets: [{ id: id(211), intent: "hostile", kind: "card", oracle: "Skullclamp (222) -  Attach to Spirit Token (212)" }] };
    same("Kykar #3: an equip says what it equips",
      between(board((b) => { put(b, "battlefield", CLAMP); put(b, "battlefield", SPIRIT); }), board((b) => { put(b, "battlefield", CLAMP); put(b, "battlefield", SPIRIT); b.stack.push(EQUIP); }), []),
      ["Blue equips Spirit token with Skullclamp"]);

    // #4: a pain land's coloured tap, at priority and while paying, names itself on the life line
    const WASTES = { ...card(202, "Adarkar Wastes", ["Land"]), text: "{T}: Add {C}.\n{T}: Add {W} or {U}. Adarkar Wastes deals 1 damage to you." };
    const FORGE = { ...card(204, "Battlefield Forge", ["Land"]), text: "{T}: Add {C}.\n{T}: Add {R} or {W}. Battlefield Forge deals 1 damage to you." };
    const lands = (b, tapped) => { put(b, "battlefield", { ...WASTES, tapped }); put(b, "battlefield", { ...FORGE, tapped }); };
    const painTap = (fill, answer) => fresh((h, seat) => {
      const before = life(board((b) => lands(b, false)), 38, 40);
      seat.board = { state: { gameView: before } };
      fill(seat);
      answer(seat);
      return logOf(h, before, life(board((b) => lands(b, true)), 37, 40));
    });
    same("Kykar #4: a pain land tapped for colour at priority names itself on its life line",
      painTap((seat) => { seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 22, input: { type: "chooseAction", actions: [
        { abilityIndex: 8, cardId: id(202), cost: "{T}", description: "{T}: Add {C}.", id: "tap:engine-card-202:8", isClassLevelUp: false, isManaAbility: true, producedMana: [{ amount: 1, color: "C" }], type: "activateAbility" },
        { abilityIndex: 9, cardId: id(202), cost: "{T}", description: "{T}: Add {W} or {U}. Adarkar Wastes deals 1 damage to you.", id: "tap:engine-card-202:9:W", isClassLevelUp: false, isManaAbility: true, producedMana: [{ amount: 1, color: "W" }], type: "activateAbility" }] } }; },
      (seat) => seat.respond(22, "chooseAction", { type: "act", actionId: "tap:engine-card-202:9:W" })),
      ["Blue: 38 -> 37 life (-1, damage from Adarkar Wastes)"]);
    same("Kykar #4: and while paying, Forge's payment action",
      painTap((seat) => { seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 57, input: { type: "payManaCost", cardName: "Reflect Damage", manaCost: "{3}{W}{R}", actions: [
        { abilityIndex: 0, cardId: id(204), cost: "{T}", description: "Battlefield Forge", id: "tap:engine-card-204:0", isClassLevelUp: false, isManaAbility: true, producedMana: [{ amount: 1, color: "C" }], type: "activateManaAbility" },
        { abilityIndex: 1, cardId: id(204), cost: "{T}", description: "Battlefield Forge", id: "tap:engine-card-204:1:R", isClassLevelUp: false, isManaAbility: true, producedMana: [{ amount: 1, color: "R" }], type: "activateManaAbility" }] } }; },
      (seat) => seat.respond(57, "payManaCost", { type: "act", actionId: "tap:engine-card-204:1:R" })),
      ["Blue: 38 -> 37 life (-1, damage from Battlefield Forge)"]);
    same("Kykar #4: its colourless tap deals nothing, and the loss stays bare",
      painTap((seat) => { seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 57, input: { type: "payManaCost", actions: [
        { abilityIndex: 0, cardId: id(204), cost: "{T}", description: "Battlefield Forge", id: "tap:engine-card-204:0", isClassLevelUp: false, isManaAbility: true, producedMana: [{ amount: 1, color: "C" }], type: "activateManaAbility" }] } }; },
      (seat) => seat.respond(57, "payManaCost", { type: "act", actionId: "tap:engine-card-204:0" })),
      ["Blue: 38 -> 37 life (-1)"]);

    // #11: Niv-Mizzet's pings, Forge's trigger with its target: at a creature, and at a player
    const NIV = card(215, "Niv-Mizzet, Parun", ["Creature"]);
    const WURM = opp({ ...card(216, "Craw Wurm", ["Creature"]), power: "6" });
    const PING = (sid, t) => ({ controllerId: "player-0", id: sid, identity: { name: "Niv-Mizzet, Parun", isToken: false }, isCasting: false, isPermanentSpell: false, isTrigger: true, ownerId: "player-0",
      sourceAbilityText: "Whenever you draw a card, Niv-Mizzet, Parun deals 1 damage to any target.", sourceId: id(215),
      targets: [{ id: t, intent: "hostile", kind: t.startsWith("player-") ? "player" : "card", oracle: "Whenever you draw a card, Niv-Mizzet, Parun deals 1 damage to any target." }],
      text: `Whenever you draw a card, Niv-Mizzet, Parun deals 1 damage to any target. (Targeting: [[${t === id(216) ? "Craw Wurm (218)" : "abl-probe-1-jiwh"}]]) [Player: abl-probe-0-v5go]` });
    const nivBoard = (fill) => life(board((b) => { put(b, "battlefield", NIV); fill(b); }), 40, 40);
    same("Kykar #11: Niv-Mizzet's ping at a creature says so",
      between(nivBoard((b) => { put(b, "battlefield", WURM, "player-1"); b.stack.push(PING("engine-stack-11", id(216))); }), nivBoard((b) => put(b, "battlefield", { ...WURM, damage: 1 }, "player-1")), []),
      ["Niv-Mizzet, Parun deals 1 damage to Craw Wurm"]);
    same("Kykar #11: and at a player, on the life line",
      between(nivBoard((b) => b.stack.push(PING("engine-stack-15", "player-1"))), life(board((b) => put(b, "battlefield", NIV)), 40, 39), []),
      ["AI 1: 40 -> 39 life (-1, damage from Niv-Mizzet, Parun)"]);
    same("Kykar #11: two pings at one player resolved between two boards, both",
      between(nivBoard((b) => b.stack.push(PING("engine-stack-15", "player-1"), PING("engine-stack-16", "player-1"))), life(board((b) => put(b, "battlefield", NIV)), 40, 38), []),
      ["AI 1: 40 -> 38 life (-2, damage from Niv-Mizzet, Parun ×2)"]);
    same("Kykar #11: one of two pings resolved, the other still on the stack: the one",
      between(nivBoard((b) => { put(b, "battlefield", WURM, "player-1"); b.stack.push(PING("engine-stack-15", "player-1"), PING("engine-stack-16", id(216))); }),
        life(board((b) => { put(b, "battlefield", NIV); put(b, "battlefield", { ...WURM, damage: 1 }, "player-1"); b.stack.push(PING("engine-stack-15", "player-1")); }), 40, 40), []),
      ["Niv-Mizzet, Parun deals 1 damage to Craw Wurm"]);

    // (Explosion as Forge sent it once cast: its damage and its draw both target AI 1, one hit of 2, Kykar probe)
    const EXPLOSION = { controllerId: "player-0", faceIndex: 0, id: "engine-stack-6", identity: { cardNumber: "287", isToken: false, name: "Explosion", setCode: "TDC" }, isCasting: false,
      isPermanentSpell: false, ownerId: "player-0", sourceAbilityText: "Explosion deals X damage to any target. Target player draws X cards.", sourceId: id(206),
      targets: [{ id: "player-1", intent: "hostile", kind: "player" }, { id: "player-1", intent: "draw", kind: "player" }],
      text: "Explosion (206) - Explosion (206) deals 2 damage to abl-probe-1-tbxq. abl-probe-1-tbxq draws two cards. (X=2)" };
    same("Kykar #11: Explosion's damage and draw at one player is one hit, on the life line",
      between(life(board((b) => b.stack.push(EXPLOSION)), 40, 40), life(board((b) => put(b, "graveyard", card(206, "Expansion // Explosion", ["Instant"]))), 40, 38), [ev(11, "Stack", "Graveyard", id(206))])
        .filter((l) => /life/.test(l)),
      ["AI 1: 40 -> 38 life (-2, damage from Explosion)"]);

    // #26: Drogskol Reaver's double-strike lifelink attack, each damage step's boards as Forge sent them
    const REAVER = (extra) => ({ ...card(218, "Drogskol Reaver", ["Creature"]), power: "3", toughness: "5", keywords: ["Flying", "Double Strike", "Lifelink"], tapped: true,
      isAttacking: true, attackingPlayerId: "player-1", attackTargetId: "player-1", ...extra });
    const GAIN = { controllerId: "player-0", id: "engine-stack-31", identity: { name: "Drogskol Reaver", isToken: false }, isPermanentSpell: false, isTrigger: true, ownerId: "player-0",
      sourceAbilityText: "Whenever you gain life, draw a card.", sourceId: id(218), targets: [], text: "Whenever you gain life, draw a card. [Player: abl-probe-0-v5go, Gained Amount: 3]" };
    const combatAt = (step, a, c, fill = () => {}) => life(board((b) => { b.step = step; put(b, "battlefield", REAVER()); fill(b); }), a, c);
    same("Kykar #26: double strike's first-strike damage and its lifelink, by the attacker",
      between(combatAt("combatDeclareBlockers", 39, 38), combatAt("combatFirstStrikeDamage", 42, 35, (b) => b.stack.push(GAIN)), []),
      ["Blue: 39 -> 42 life (+3, lifelink from Drogskol Reaver)", "AI 1: 38 -> 35 life (-3, combat damage from Drogskol Reaver)", "Drogskol Reaver's ability triggers (Blue): draw a card"]);
    same("Kykar #26: and its regular damage",
      between(combatAt("combatFirstStrikeDamage", 41, 35), combatAt("combatDamage", 44, 32), []),
      ["Blue: 41 -> 44 life (+3, lifelink from Drogskol Reaver)", "AI 1: 35 -> 32 life (-3, combat damage from Drogskol Reaver)"]);
    same("Kykar #26: a first striker given double strike deals its regular damage too, one with first strike alone not",
      between(life(board((b) => { b.step = "combatFirstStrikeDamage"; put(b, "battlefield", REAVER({ keywords: ["Flying", "First Strike", "Double Strike", "Lifelink"] }));
        put(b, "battlefield", { ...card(219, "Elite Vanguard", ["Creature"]), power: "2", keywords: ["First Strike"], isAttacking: true, attackingPlayerId: "player-1", attackTargetId: "player-1", tapped: true }); }), 41, 35),
        life(board((b) => { b.step = "combatDamage"; put(b, "battlefield", REAVER({ keywords: ["Flying", "First Strike", "Double Strike", "Lifelink"] }));
          put(b, "battlefield", { ...card(219, "Elite Vanguard", ["Creature"]), power: "2", keywords: ["First Strike"], isAttacking: true, attackingPlayerId: "player-1", attackTargetId: "player-1", tapped: true }); }), 44, 32), []),
      ["Blue: 41 -> 44 life (+3, lifelink from Drogskol Reaver)", "AI 1: 35 -> 32 life (-3, combat damage from Drogskol Reaver)"]);
    same("Kykar #26: a blocked attacker deals the player nothing, and a loss beside it stays bare",
      between(combatAt("combatDeclareBlockers", 39, 38, (b) => { put(b, "battlefield", opp(card(230, "Wall of Wood", ["Creature"])), "player-1"); b.combatAssignments = [{ attackerId: id(218), blockerId: id(230) }]; }),
        combatAt("combatFirstStrikeDamage", 42, 35, (b) => { put(b, "battlefield", opp(card(230, "Wall of Wood", ["Creature"])), "player-1"); b.combatAssignments = [{ attackerId: id(218), blockerId: id(230) }]; }), []),
      ["Blue: 39 -> 42 life (+3, lifelink from Drogskol Reaver)", "AI 1: 38 -> 35 life (-3)"]);

    // #6 / #24 and Circle of Protection: a source chosen, said, and what became of its damage
    const SOURCE_PICK = (seat, n, by, text, cards, pick) => {
      seat.board = { state: { gameView: board(() => {}) } };
      seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: n, sourceAbilityText: text, sourceCard: { id: id(by[0]), identity: { name: by[1] }, text },
        input: { cancellable: false, cards: [{ id: id(234), identity: { name: "--CARDS IN THE COMMAND ZONE:--", setCode: "???" } }, { id: id(235), identity: { name: "--PERMANENTS:--", setCode: "???" } }, ...cards],
          max: 1, min: 1, presentation: { description: "Choose a source ", targets: [], title: by[1] }, type: "chooseCards" } };
      seat.respond(n, "chooseCards", { type: "chooseCardsDecision", chosenCardIds: [pick] });
    };
    const GIANT = (extra = {}) => opp({ ...card(229, "Hill Giant", ["Creature"]), power: "3", ...extra });
    const REFLECT = "The next time a source of your choice would deal damage this turn, that damage is dealt to that source's controller instead.";
    same("Kykar #6: Reflect Damage's choice is said, and Hill Giant's combat damage is dealt to its controller instead",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
        const at = (step, a, c) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", GIANT({ isAttacking: true, attackingPlayerId: "player-0", attackTargetId: "player-0", tapped: true }), "player-1"); }), a, c);
        return [...tableLog(h), ...logOf(h, at("combatDeclareBlockers", 38, 404), at("combatDamage", 38, 401))];
      }),
      ["Blue chooses Hill Giant (Reflect Damage)", "Hill Giant's combat damage is dealt to AI 1 instead (Reflect Damage)", "AI 1: 404 -> 401 life (-3, damage from Hill Giant, redirected by Reflect Damage)"]);
    const PYRO = opp({ ...card(238, "Prodigal Pyromancer", ["Creature"]), power: "1" });
    const PYRO_PING = { controllerId: "player-1", id: "engine-stack-40", identity: { name: "Prodigal Pyromancer", isToken: false }, isPermanentSpell: false, ownerId: "player-1",
      sourceAbilityText: "{T}: Prodigal Pyromancer deals 1 damage to any target.", sourceId: id(238), text: "Prodigal Pyromancer (239) - Prodigal Pyromancer (239) deals 1 damage to abl-probe-0-db10.",
      targets: [{ id: "player-0", intent: "hostile", kind: "player", oracle: "Prodigal Pyromancer (239) - Prodigal Pyromancer (239) deals 1 damage to abl-probe-0-db10." }] };
    const COP = "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.";
    same("Circle of Protection: Red's choice is said, and the ping it prevents says so (ability sweep)",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 71, [237, "Circle of Protection: Red"], COP, [PYRO], id(238));
        return [...tableLog(h), ...logOf(h, life(board((b) => { put(b, "battlefield", PYRO, "player-1"); b.stack.push(PYRO_PING); }), 38, 40),
          life(board((b) => put(b, "battlefield", { ...PYRO, tapped: true }, "player-1")), 38, 40))];
      }),
      ["Blue chooses Prodigal Pyromancer (Circle of Protection: Red)", "Prodigal Pyromancer's damage to Blue is prevented (Circle of Protection: Red)"]);
    same("Kykar #24: Deflecting Palm's prevention deals that much to the source's controller",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 90, [260, "Deflecting Palm"], "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, Deflecting Palm deals that much damage to that source's controller.", [PYRO], id(238));
        return [...tableLog(h), ...logOf(h, life(board((b) => { put(b, "battlefield", PYRO, "player-1"); b.stack.push(PYRO_PING); }), 38, 40),
          life(board((b) => put(b, "battlefield", { ...PYRO, tapped: true }, "player-1")), 38, 39))];
      }),
      ["Blue chooses Prodigal Pyromancer (Deflecting Palm)", "Prodigal Pyromancer's damage to Blue is prevented (Deflecting Palm)", "Deflecting Palm deals 1 damage to AI 1", "AI 1: 40 -> 39 life (-1, damage from Deflecting Palm)"]);
    same("a source chosen on an earlier turn shields nothing now",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 71, [237, "Circle of Protection: Red"], COP, [PYRO], id(238));
        const later = (fill) => { const b = life(board(fill), 38, 40); b.turn = 4; return b; };
        return logOf(h, later((b) => { put(b, "battlefield", PYRO, "player-1"); b.stack.push(PYRO_PING); }), later((b) => put(b, "battlefield", { ...PYRO, tapped: true }, "player-1")));
      }),
      []);

    // #7 and #21: "unless that player pays" and "you may pay", Forge's triggers with its "Activator" (the AI's username
    // here is "self-hosted-node-77-bot", player 1), told by the draws Forge says they made
    const UNLESS = (sid, n, name, text, src) => ({ controllerId: "player-0", id: sid, identity: { name, isToken: false }, isPermanentSpell: false, isTrigger: true, ownerId: "player-0",
      sourceAbilityText: text, sourceId: id(src), targets: [], text: `${text} [Card: Opt (250), Activator: self-hosted-node-77-bot, SpellAbility: Scry 1. Draw a card.]` });
    const SENTINEL_TEXT = "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is Esper Sentinel's power.";
    const RHYSTIC_TEXT = "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.";
    const SENTINEL = { ...card(244, "Esper Sentinel", ["Artifact", "Creature"]), power: "1" }, RHYSTIC = card(245, "Rhystic Study", ["Enchantment"]);
    const watchers = (fill = () => {}) => board((b) => { put(b, "battlefield", SENTINEL); put(b, "battlefield", RHYSTIC); count(b, "library", 50); fill(b); });
    const both = (b) => b.stack.push(UNLESS("engine-stack-26", 1, "Esper Sentinel", SENTINEL_TEXT, 244), UNLESS("engine-stack-27", 1, "Rhystic Study", RHYSTIC_TEXT, 245));
    const drew = (b) => { count(b, "library", 49); count(b, "hand", 1); };
    same("Kykar #7: Rhystic Study drew, so unpaid; Esper Sentinel drew nothing, so paid, its {X} by its power",
      between(watchers(both), watchers(drew), [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(245), causeName: "Rhystic Study" })]),
      ["AI 1 pays {1} (Esper Sentinel)", "AI 1 doesn't pay {1} (Rhystic Study)", "Blue draws a card"]);
    same("Kykar #7: Rhystic Study unpaid and its draw declined: Forge asks the draw only once the payment was declined",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 101, sourceAbilityText: RHYSTIC_TEXT, sourceCard: { id: id(245), identity: { name: "Rhystic Study" }, text: RHYSTIC_TEXT },
          input: { confirmLabel: "Accept", denyLabel: "Decline", presentation: { targets: [], title: "Do you want to draw a  card?" }, type: "chooseBoolean" } };
        seat.respond(101, "chooseBoolean", { type: "decision", value: false });
        return logOf(h, watchers((b) => b.stack.push(UNLESS("engine-stack-27", 1, "Rhystic Study", RHYSTIC_TEXT, 245))), watchers(), [ev(11, "Stack", "Graveyard", id(250), null, "player-1")]);
      }).filter((l) => /Rhystic/.test(l)),
      ["AI 1 doesn't pay {1}, and Blue declines (Rhystic Study)"]);
    const MENTOR_TEXT = "Whenever another creature you control with power 2 or less enters, you may pay {1}. If you do, draw a card.";
    const MENTOR = (sid) => ({ controllerId: "player-0", id: sid, identity: { name: "Mentor of the Meek", isToken: false }, isPermanentSpell: false, isTrigger: true, ownerId: "player-0",
      sourceAbilityText: MENTOR_TEXT, sourceId: id(226), targets: [], text: `${MENTOR_TEXT} [Zone Changer: Soldier Token (233)]` });
    const mentorBoard = (fill) => board((b) => { put(b, "battlefield", card(226, "Mentor of the Meek", ["Creature"])); count(b, "library", 50); fill(b); });
    same("Kykar #21: Mentor of the Meek's two triggers, one paid for (its draw) and one not",
      between(mentorBoard((b) => b.stack.push(MENTOR("engine-stack-40"), MENTOR("engine-stack-41"))), mentorBoard(drew),
        [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(226), causeName: "Mentor of the Meek" })]),
      ["Blue pays {1} (Mentor of the Meek)", "Blue doesn't pay {1} (Mentor of the Meek)", "Blue draws a card"]);

    // #21: Slip Out the Back's counter, then its phasing, in the card's order
    const SLIP = { controllerId: "player-0", id: "engine-stack-50", identity: { name: "Slip Out the Back", isToken: false }, isPermanentSpell: false, ownerId: "player-0", sourceId: id(225),
      sourceAbilityText: "Put a +1/+1 counter on target creature. It phases out. (Treat it and anything attached to it as though they don't exist until your next turn.)", targets: [], text: "Slip Out the Back (227) - abl-probe-0-v5go   phase out." };
    same("Kykar #21: Slip Out the Back's counter is said before the phasing",
      between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push(SLIP); }), board((b) => { put(b, "battlefield", { ...BEAR(), counters: { P1P1: 1 }, phasedOut: true }); put(b, "graveyard", card(225, "Slip Out the Back", ["Instant"])); }),
        [ev(11, "Stack", "Graveyard", id(225))]),
      ["Grizzly Bears gets a +1/+1 counter", "Grizzly Bears phases out"]);

    // #12: a card on another player's battlefield goes to its owner's library, Forge's card owner (Chaos Warp)
    same("Kykar #12: AI 1's Hill Giant under Blue's control is put into AI 1's library",
      between(board((b) => put(b, "battlefield", { ...card(228, "Hill Giant", ["Creature"]), ownerId: "player-1" })), board(() => {}),
        [ev(11, "Battlefield", "Library", id(228), null, "player-1", { cause: "ChangeZone", causeCardId: id(251), causeName: "Chaos Warp" })]),
      ["Hill Giant is put into AI 1's library (Chaos Warp)"]);

    // #19: a Clue destroyed (Forge's "destroyed", Shatter's), and a token's ability whose token paid for it is no cast
    const CLUE = opp(card(222, "Clue Token", ["Artifact"], { token: true }));
    same("Kykar #19: a Clue token destroyed is destroyed",
      between(board((b) => put(b, "battlefield", CLUE, "player-1")), board(() => {}),
        [ev(11, "Battlefield", "Graveyard", id(222), "destroyed", "player-1", { cause: "Destroy", causeCardId: id(224), causeName: "Shatter" })]),
      ["Clue token is destroyed by Shatter"]);
    const CRACK = { controllerId: "player-1", id: "engine-stack-60", identity: { name: "Clue Token", isToken: true }, isPermanentSpell: false, ownerId: "player-1", sourceId: id(222),
      sourceAbilityText: "{2}, Sacrifice this artifact: Draw a card.", targets: [], text: "Clue Token (222) - abl-probe-1-jiwh draws a card." };
    same("Kykar #19: AI 1's Clue, sacrificed to pay for its ability, is an ability",
      between(board((b) => put(b, "battlefield", CLUE, "player-1")), board((b) => b.stack.push(CRACK)),
        [ev(11, "Battlefield", "Graveyard", id(222), "sacrificed", "player-1", { cause: "Cost:Sacrifice", causeCardId: id(222), causeName: "Clue Token" })]),
      ["AI 1 uses Clue token's ability: draw a card", "Clue token is sacrificed"]);

    // #13: a planeswalker's ability says which, and the loyalty it cost; and a commander killed says so before it returns
    // (Ral Zarek's -2 as Forge sent it: its counters keyed "Loyalty", its stack item with its target; Rograkh killed by
    // Chandra's -3, the commander's way home)
    const RAL = (loy) => ({ ...card(201, "Ral Zarek", ["Planeswalker"]), counters: { Loyalty: loy } });
    const GIANT_204 = opp({ ...card(204, "Hill Giant", ["Creature"]), power: "3" });
    const RAL_MINUS = { controllerId: "player-0", faceIndex: 0, id: "engine-stack-3", identity: { cardNumber: "216", isToken: false, name: "Ral Zarek", setCode: "RVR" }, isCasting: false, isDoubleFaced: false,
      isPermanentSpell: false, ownerId: "player-0", sourceAbilityText: "-2: Ral Zarek deals 3 damage to any target.", sourceId: id(201),
      targets: [{ id: id(204), intent: "hostile", kind: "card", oracle: "Ral Zarek (203) - Ral Zarek (203) deals 3 damage to Hill Giant (204)." }], text: "Ral Zarek (203) - Ral Zarek (203) deals 3 damage to Hill Giant (204)." };
    same("Kykar #13: Ral Zarek's -2 says which, its loyalty, and its target, Forge's \"Loyalty\" counters",
      between(board((b) => { put(b, "battlefield", RAL(4)); put(b, "battlefield", GIANT_204, "player-1"); }), board((b) => { put(b, "battlefield", RAL(2)); put(b, "battlefield", GIANT_204, "player-1"); b.stack.push(RAL_MINUS); }), []),
      ["Blue activates Ral Zarek's -2 (loyalty 4 -> 2) targeting Hill Giant: it deals 3 damage to any target"]);
    same("Kykar #13: a commander killed on the battlefield dies, then returns to the command zone",
      between(board((b) => put(b, "battlefield", card(199, "Rograkh, Son of Rohgahh", ["Creature"]))), board((b) => put(b, "command", card(199, "Rograkh, Son of Rohgahh", ["Creature"]))),
        [ev(11, "Battlefield", "Graveyard", id(199)), ev(12, "Graveyard", "Command", id(199))]),
      ["Rograkh, Son of Rohgahh dies and returns to the command zone"]);
    // #22 and #14: a free cast says so, one split half is that half (Forge's actions)
    same("Kykar #22: Flawless Maneuver cast free by its own words says so",
      fresh((h, seat) => {
        const fm = { ...card(231, "Flawless Maneuver", ["Instant"]), text: "Creatures you control gain indestructible until end of turn.\nIf you control a commander, you may cast this spell without paying its mana cost." };
        const a = board((b) => put(b, "hand", fm));
        seat.board = { state: { gameView: a } };
        h.B.notePlay(seat, { cardId: id(231), id: "prompt-action-20", label: "Cast Flawless Maneuver", mode: { type: "staticAlternative" }, type: "cast" }, "Flawless Maneuver", 0);
        return logOf(h, a, board((b) => b.stack.push({ controllerId: "player-0", id: "engine-stack-70", identity: { name: "Flawless Maneuver" }, isPermanentSpell: false, sourceId: id(231),
          sourceAbilityText: "Creatures you control gain indestructible until end of turn. (If you control a commander, you may cast this spell without paying its mana cost.)", targets: [], text: "Flawless Maneuver (234) - Creatures you control gain indestructible until end of turn." })));
      }),
      ["Blue casts Flawless Maneuver without paying its mana cost"]);
    same("Kykar #14: casting the Explosion half of Expansion // Explosion is Explosion",
      fresh((h, seat) => {
        const a = board((b) => put(b, "hand", card(221, "Expansion // Explosion", ["Instant"])));
        seat.board = { state: { gameView: a } };
        h.B.notePlay(seat, { cardId: id(221), id: "prompt-action-12", label: "Cast Explosion", mode: { type: "normal" }, type: "cast" }, "Expansion // Explosion", 0);
        return logOf(h, a, board((b) => b.stack.push({ controllerId: "player-0", id: "engine-stack-71", identity: { name: "Explosion" }, isPermanentSpell: false, sourceId: id(221),
          sourceAbilityText: "Explosion deals X damage to any target. Target player draws X cards.", targets: [], text: "Explosion (223) -   (X=0)" })));
      }),
      ["Blue casts Explosion"]);

    // #26: Akroma's Will's keywords on the creatures, and an Arcane Denial left with nothing to counter
    const AKROMA = { controllerId: "player-0", id: "engine-stack-80", identity: { name: "Akroma's Will" }, isPermanentSpell: false, ownerId: "player-0", sourceId: id(240), targets: [], text: "Akroma's Will (240) - ",
      sourceAbilityText: "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Creatures you control gain flying, vigilance, and double strike until end of turn.\n• Creatures you control gain lifelink, indestructible, and protection from each color until end of turn." };
    const KYKAR = (kw) => ({ ...card(209, "Kykar, Wind's Fury", ["Creature"]), keywords: kw });
    same("Kykar #26: the keywords Akroma's Will gave are said",
      between(board((b) => { put(b, "battlefield", KYKAR(["Flying"])); b.stack.push(AKROMA); }),
        board((b) => { put(b, "battlefield", KYKAR(["Flying", "Vigilance", "Double Strike"])); put(b, "graveyard", card(240, "Akroma's Will", ["Instant"])); }), [ev(11, "Stack", "Graveyard", id(240))]),
      ["Kykar, Wind's Fury gains vigilance, double strike (Akroma's Will)"]);
    const DENIAL = { controllerId: "player-1", id: "engine-stack-81", identity: { name: "Arcane Denial" }, isPermanentSpell: false, ownerId: "player-1", sourceId: id(241), targets: [], text: "Arcane Denial (241) - Counter.",
      sourceAbilityText: "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep." };
    same("Kykar #26: an Arcane Denial with no spell left to counter does nothing, and says so",
      between(board((b) => b.stack.push(DENIAL)), board((b) => put(b, "graveyard", opp(card(241, "Arcane Denial", ["Instant"])), "player-1")), [ev(11, "Stack", "Graveyard", id(241), null, "player-1")]),
      ["Arcane Denial does nothing: the spell it targeted is gone"]);

    // ability sweep: Diabolic Edict's sacrifice gives its cause; Pyroclasm's survivor; Icy Manipulator's tap
    same("Diabolic Edict's sacrifice says what made it (ability sweep)",
      between(board((b) => put(b, "battlefield", opp(card(229, "Hill Giant", ["Creature"])), "player-1")), board((b) => put(b, "graveyard", opp(card(229, "Hill Giant", ["Creature"])), "player-1")),
        [ev(11, "Battlefield", "Graveyard", id(229), "sacrificed", "player-1", { cause: "Sacrifice", causeCardId: id(253), causeName: "Diabolic Edict" })]),
      ["Hill Giant is sacrificed (Diabolic Edict)"]);
    const PYROCLASM = { controllerId: "player-0", id: "engine-stack-90", identity: { name: "Pyroclasm" }, isPermanentSpell: false, ownerId: "player-0", sourceId: id(277),
      sourceAbilityText: "Pyroclasm deals 2 damage to each creature.", targets: [], text: "Pyroclasm (295) - Deals 2 damage to each creature." };
    same("Pyroclasm's survivor took its 2 damage, and the dead die (ability sweep)",
      between(board((b) => { put(b, "battlefield", KYKAR([])); put(b, "battlefield", BEAR()); b.stack.push(PYROCLASM); }),
        board((b) => { put(b, "battlefield", { ...KYKAR([]), damage: 2 }); put(b, "graveyard", BEAR()); put(b, "graveyard", card(277, "Pyroclasm", ["Sorcery"])); }),
        [ev(11, "Stack", "Graveyard", id(277)), ev(12, "Battlefield", "Graveyard", id(1))]),
      ["Pyroclasm deals 2 damage to Kykar, Wind's Fury", "Grizzly Bears dies"]);
    const ICY = { controllerId: "player-0", id: "engine-stack-91", identity: { name: "Icy Manipulator", isToken: false }, isPermanentSpell: false, ownerId: "player-0", sourceId: id(281),
      sourceAbilityText: "{1}, {T}: Tap target artifact, creature, or land.", text: "Icy Manipulator (281) - Tap Adarkar Wastes (203).", targets: [{ id: id(202), intent: "hostile", kind: "card", oracle: "Icy Manipulator (281) - Tap Adarkar Wastes (203)." }] };
    same("Icy Manipulator's tap says what it tapped (ability sweep)",
      between(board((b) => { put(b, "battlefield", { ...card(281, "Icy Manipulator", ["Artifact"]), tapped: true }); put(b, "battlefield", WASTES); b.stack.push(ICY); }),
        board((b) => { put(b, "battlefield", { ...card(281, "Icy Manipulator", ["Artifact"]), tapped: true }); put(b, "battlefield", { ...WASTES, tapped: true }); }), []),
      ["Icy Manipulator taps Adarkar Wastes"]);
    const MUTAVAULT = { controllerId: "player-0", id: "engine-stack-92", identity: { name: "Mutavault", isToken: false }, isPermanentSpell: false, ownerId: "player-0", sourceId: id(268), targets: [],
      sourceAbilityText: "{1}: Mutavault becomes a 2/2 creature with all creature types until end of turn. It's still a land.", text: "Mutavault (282) - Mutavault (282) has base power and toughness 2/2  and becomes a creature until end of turn." };
    same("Mutavault's animation says it became a creature (ability sweep)",
      between(board((b) => { put(b, "battlefield", card(268, "Mutavault", ["Land"])); b.stack.push(MUTAVAULT); }), board((b) => put(b, "battlefield", card(268, "Mutavault", ["Land", "Creature"]))), []),
      ["Mutavault becomes a creature"]);

    // ---- the checker's round (2026-11-07): a wrong line is worse than a bare one. Each case a line dfcb659 wrote wrong,
    // or a guard no test held; each now says only what the boards, the feed or the player's own answers make certain.
    const ACT = "self-hosted-node-77-bot";
    const TRIG = (sid, src, name, text, ctl = "player-0", extra = {}) => ({ controllerId: ctl, id: sid, identity: { name, isToken: false }, isPermanentSpell: false, isTrigger: true, ownerId: ctl,
      sourceAbilityText: text, sourceId: id(src), targets: [], text, ...extra });
    const SPL = (sid, src, name, text, ctl = "player-0", extra = {}) => ({ controllerId: ctl, id: sid, identity: { name, isToken: false }, isPermanentSpell: false, ownerId: ctl,
      sourceAbilityText: text, sourceId: id(src), targets: [], text: `${name} (${src}) - ${text}`, ...extra });
    const CAST_EV = [ev(11, "Hand", "Graveyard", id(399), null, "player-1")]; // (some event in the window, as a real one has)
    const HG = (extra = {}) => GIANT({ isAttacking: true, attackingPlayerId: "player-0", attackTargetId: "player-0", tapped: true, ...extra }); // (AI 1's attacker at Blue)

    // #1 unless / may pay: a payment said only from a draw seen or not, or the payer's own answer
    const EXTORT = "Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)";
    const GUARDS = card(300, "Basilica Guards", ["Creature"]);
    const extortAt = (fill, a, c) => life(board((b) => { put(b, "battlefield", GUARDS); fill(b); }), a, c);
    same("checker: an extort paid is no 'doesn't pay' (its drain is no draw)",
      between(extortAt((b) => b.stack.push(TRIG("engine-stack-1", 300, "Basilica Guards", EXTORT)), 40, 40), extortAt(() => {}, 41, 39), CAST_EV),
      ["Blue: 40 -> 41 life (+1, Basilica Guards)", "AI 1: 40 -> 39 life (-1, Basilica Guards)"]);
    same("checker: an extort the player answered 'Pay {W/B}?' yes to is paid, by that answer",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 5, sourceAbilityText: EXTORT, sourceCard: { id: id(300), identity: { name: "Basilica Guards" } }, input: { presentation: { title: "Pay {W/B}?" }, type: "chooseBoolean" } };
        seat.respond(5, "chooseBoolean", { type: "decision", value: true });
        return logOf(h, extortAt((b) => b.stack.push(TRIG("engine-stack-1", 300, "Basilica Guards", EXTORT)), 40, 40), extortAt(() => {}, 41, 39), CAST_EV);
      }),
      ["Blue pays {W/B} (Basilica Guards)", "Blue: 40 -> 41 life (+1, Basilica Guards)", "AI 1: 40 -> 39 life (-1, Basilica Guards)"]);
    const SOUL = "Whenever an opponent casts a creature spell, Soul Barrier deals 2 damage to that player unless they pay {2}.";
    same("checker: Soul Barrier's damage taken is no 'pays' (damage is no draw)",
      between(life(board((b) => { put(b, "battlefield", card(301, "Soul Barrier", ["Enchantment"])); b.stack.push(TRIG("engine-stack-2", 301, "Soul Barrier", SOUL, "player-0", { text: `${SOUL} [Card: Grizzly Bears (9), Activator: ${ACT}, SpellAbility: Grizzly Bears]` })); }), 40, 40),
        life(board((b) => put(b, "battlefield", card(301, "Soul Barrier", ["Enchantment"]))), 40, 38), CAST_EV),
      ["AI 1: 40 -> 38 life (-2)"]);
    const CHAN = "Whenever an opponent casts their first spell each turn, counter that spell unless that player pays {1}.";
    same("checker: Chancellor of the Annex's counter unpaid is no 'pays' (a counter is no draw)",
      between(board((b) => { put(b, "battlefield", card(302, "Chancellor of the Annex", ["Creature"])); b.stack.push(SPL("engine-stack-3", 303, "Opt", "Scry 1. Draw a card.", "player-1"), TRIG("engine-stack-4", 302, "Chancellor of the Annex", CHAN, "player-0", { text: `${CHAN} [Card: Opt (303), Activator: ${ACT}, SpellAbility: Opt]` })); }),
        board((b) => { put(b, "battlefield", card(302, "Chancellor of the Annex", ["Creature"])); put(b, "graveyard", opp(card(303, "Opt", ["Instant"])), "player-1"); }),
        [ev(11, "Stack", "Graveyard", id(303), null, "player-1")]),
      []);
    same("checker: two Rhystic Study triggers, both unpaid, the first draw declined: no 'pays'",
      fresh((h, seat) => {
        const ask = (n, v) => { seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: n, sourceAbilityText: RHYSTIC_TEXT, sourceCard: { id: id(245), identity: { name: "Rhystic Study" }, text: RHYSTIC_TEXT },
          input: { presentation: { title: "Do you want to draw a  card?" }, type: "chooseBoolean" } }; seat.respond(n, "chooseBoolean", { type: "decision", value: v }); };
        ask(101, false); ask(102, true);
        const w = (fill) => board((b) => { put(b, "battlefield", RHYSTIC); count(b, "library", 50); fill(b); });
        return logOf(h, w((b) => b.stack.push(UNLESS("engine-stack-27", 1, "Rhystic Study", RHYSTIC_TEXT, 245), UNLESS("engine-stack-28", 1, "Rhystic Study", RHYSTIC_TEXT, 245))),
          w((b) => { count(b, "library", 49); count(b, "hand", 1); }), [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(245), causeName: "Rhystic Study" })]);
      }),
      ["AI 1 doesn't pay {1} (Rhystic Study)", "AI 1 doesn't pay {1}, and Blue declines (Rhystic Study)", "Blue draws a card"]);
    const answer = (seat, n, title, v) => { seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: n, sourceAbilityText: RHYSTIC_TEXT, sourceCard: { id: id(245), identity: { name: "Rhystic Study" }, text: RHYSTIC_TEXT },
      input: { presentation: { title }, type: "chooseBoolean" } }; seat.respond(n, "chooseBoolean", { type: "decision", value: v }); };
    const rhyW = (fill) => board((b) => { put(b, "battlefield", RHYSTIC); count(b, "library", 50); fill(b); });
    same("Rhystic Study's draw answers that don't match the draws seen say nothing",
      fresh((h, seat) => {
        answer(seat, 103, "Do you want to draw a  card?", false); answer(seat, 104, "Do you want to draw a  card?", true);
        return logOf(h, rhyW((b) => b.stack.push(UNLESS("engine-stack-27", 1, "Rhystic Study", RHYSTIC_TEXT, 245), UNLESS("engine-stack-28", 1, "Rhystic Study", RHYSTIC_TEXT, 245))), rhyW(() => {}), CAST_EV);
      }),
      []);
    same("a card's answers are used up by its trigger: the next one, unasked and not drawn, was paid",
      fresh((h, seat) => {
        answer(seat, 105, "Do you want to draw a  card?", false);
        const one = (sid) => logOf(h, rhyW((b) => b.stack.push(UNLESS(sid, 1, "Rhystic Study", RHYSTIC_TEXT, 245))), rhyW(() => {}), CAST_EV);
        return [...one("engine-stack-27"), ...one("engine-stack-29")];
      }),
      ["AI 1 doesn't pay {1}, and Blue declines (Rhystic Study)", "AI 1 pays {1} (Rhystic Study)"]);
    same("the payer's own answers said only when every trigger that left was answered",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 106, sourceAbilityText: MENTOR_TEXT, sourceCard: { id: id(226), identity: { name: "Mentor of the Meek" } }, input: { presentation: { title: "Pay {1}?" }, type: "chooseBoolean" } };
        seat.respond(106, "chooseBoolean", { type: "decision", value: true });
        return logOf(h, mentorBoard((b) => b.stack.push(MENTOR("engine-stack-40"), MENTOR("engine-stack-41"))), mentorBoard(drew),
          [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(226), causeName: "Mentor of the Meek" })]);
      }),
      ["Blue draws a card"]);
    same("checker: a Mentor of the Meek trigger with no feed for its window says no payment",
      between(mentorBoard((b) => b.stack.push(MENTOR("engine-stack-40"))), mentorBoard(drew), []),
      ["Blue draws a card"]);
    const AI_RHYSTIC = (extra = {}) => TRIG("engine-stack-60", 245, "Rhystic Study", RHYSTIC_TEXT, "player-1", { text: `${RHYSTIC_TEXT} [Card: Opt (250), Activator: tts-Blue-ab12, SpellAbility: Opt]`, ...extra });
    const aiRhystic = (fill = () => {}) => board((b) => { put(b, "battlefield", opp(RHYSTIC), "player-1"); fill(b); });
    same("checker: AI 1's Rhystic Study, Blue's own 'Pay {1}?' yes: Blue pays",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 9, sourceAbilityText: RHYSTIC_TEXT, sourceCard: { id: id(245), identity: { name: "Rhystic Study" } }, input: { presentation: { title: "Pay {1}?" }, type: "chooseBoolean" } };
        seat.respond(9, "chooseBoolean", { type: "decision", value: true });
        return logOf(h, aiRhystic((b) => b.stack.push(AI_RHYSTIC())), aiRhystic(), CAST_EV);
      }),
      ["Blue pays {1} (Rhystic Study)"]);
    same("checker: AI 1's Rhystic Study not drawn, no answer of Blue's: its draw was AI 1's to decline, nothing said",
      between(aiRhystic((b) => b.stack.push(AI_RHYSTIC())), aiRhystic(), CAST_EV),
      []);

    // #2 the fizzle line: only a single-target counterspell, alone on the stack, its target gone
    const CRYPTIC = "Choose two —\n• Counter target spell.\n• Return target permanent to its owner's hand.\n• Tap all creatures your opponents control.\n• Draw a card.";
    same("checker: Cryptic Command's bounce and draw does not 'do nothing'",
      between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push(SPL("engine-stack-50", 370, "Cryptic Command", CRYPTIC, "player-1", { text: "Cryptic Command (370) - Return Grizzly Bears (1) to its owner's hand. Draw a card." })); count(b, "hand", 3); }),
        board((b) => { put(b, "graveyard", opp(card(370, "Cryptic Command", ["Instant"])), "player-1"); count(b, "hand", 4); }),
        [ev(11, "Battlefield", "Hand", id(1), null, "player-0", { cause: "ChangeZone", causeCardId: id(370), causeName: "Cryptic Command" }), ev(12, "Stack", "Graveyard", id(370), null, "player-1")]),
      ["Grizzly Bears returns to Blue's hand (Cryptic Command)"]);
    const DIMIR = "Choose one —\n• Counter target sorcery spell.\n• Destroy target creature with power 2 or less.\n• Look at the top three cards of target player's library, then put one back and the rest into that player's graveyard.";
    same("checker: Dimir Charm's kill mode does not 'do nothing'",
      between(board((b) => { put(b, "battlefield", opp(BEAR()), "player-1"); b.stack.push(SPL("engine-stack-51", 371, "Dimir Charm", DIMIR)); }),
        board((b) => { put(b, "graveyard", opp(BEAR()), "player-1"); put(b, "graveyard", card(371, "Dimir Charm", ["Instant"])); }),
        [ev(11, "Battlefield", "Graveyard", id(1), "destroyed", "player-1", { cause: "Destroy", causeCardId: id(371), causeName: "Dimir Charm" }), ev(12, "Stack", "Graveyard", id(371))]),
      ["Grizzly Bears is destroyed by Dimir Charm"]);
    same("checker: a Counterspell that countered the spell beside it does not 'do nothing'",
      between(board((b) => b.stack.push(SPL("engine-stack-30", 350, "Kozilek's Return", "When you cast this spell, copy it.\nKozilek's Return deals 2 damage to each creature.", "player-1"), SPL("engine-stack-31", 351, "Counterspell", "Counter target spell."))),
        board((b) => { put(b, "graveyard", opp(card(350, "Kozilek's Return", ["Instant"])), "player-1"); put(b, "graveyard", card(351, "Counterspell", ["Instant"])); }),
        [ev(11, "Stack", "Graveyard", id(350), null, "player-1"), ev(12, "Stack", "Graveyard", id(351))]),
      []);
    same("Lost in the Mist alone, its spell gone, still bounced its other target: it does not 'do nothing'",
      between(board((b) => { put(b, "battlefield", opp(BEAR()), "player-1"); b.stack.push(SPL("engine-stack-33", 353, "Lost in the Mist", "Counter target spell. Return target permanent to its owner's hand.")); }),
        board((b) => { count(b, "hand", 1, "player-1"); put(b, "graveyard", card(353, "Lost in the Mist", ["Instant"])); }),
        [ev(11, "Battlefield", "Hand", id(1), null, "player-1", { cause: "ChangeZone", causeCardId: id(353), causeName: "Lost in the Mist" }), ev(12, "Stack", "Graveyard", id(353))])
        .filter((l) => /does nothing/.test(l)),
      []);
    same("checker: Disallow alone, its target maybe an ability no board shows, does not 'do nothing'",
      between(board((b) => b.stack.push(SPL("engine-stack-32", 352, "Disallow", "Counter target spell, activated ability, or triggered ability.", "player-1"))),
        board((b) => put(b, "graveyard", opp(card(352, "Disallow", ["Instant"])), "player-1")), [ev(11, "Stack", "Graveyard", id(352), null, "player-1")]),
      []);

    // #3 divided damage: no amount per target; a target that died gets none from "deals N"
    const ELECTRO = "Electrolyze deals 2 damage divided as you choose among one or two targets.\nDraw a card.";
    const SPIRIT_T = opp(card(310, "Spirit Token", ["Creature"], { token: true })), SAP_T = opp(card(311, "Saproling Token", ["Creature"], { token: true }));
    same("checker: Electrolyze's 1 and 1 at two tokens is no '2 damage' at each",
      between(board((b) => { put(b, "battlefield", SPIRIT_T, "player-1"); put(b, "battlefield", SAP_T, "player-1"); count(b, "library", 50); count(b, "hand", 3);
        b.stack.push(SPL("engine-stack-7", 312, "Electrolyze", ELECTRO, "player-0", { targets: [{ kind: "card", id: id(310) }, { kind: "card", id: id(311) }] })); }),
        board((b) => { put(b, "graveyard", card(312, "Electrolyze", ["Instant"])); count(b, "library", 49); count(b, "hand", 4); }),
        [ev(11, "Stack", "Graveyard", id(312)), ev(12, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(312), causeName: "Electrolyze" }),
          ev(13, "Battlefield", "Graveyard", id(310), "destroyed", "player-1"), ev(14, "Battlefield", "Graveyard", id(311), "destroyed", "player-1")]),
      ["Blue draws a card", "Spirit token dies", "Saproling token dies"]);
    same("checker: Forked Bolt's 1 at a token and 1 at AI 1: no amount, the life line bare",
      between(life(board((b) => { put(b, "battlefield", SPIRIT_T, "player-1");
        b.stack.push(SPL("engine-stack-8", 313, "Forked Bolt", "Forked Bolt deals 2 damage divided as you choose among one or two targets.", "player-0", { targets: [{ kind: "card", id: id(310) }, { kind: "player", id: "player-1" }] })); }), 40, 40),
        life(board((b) => put(b, "graveyard", card(313, "Forked Bolt", ["Sorcery"]))), 40, 39),
        [ev(11, "Stack", "Graveyard", id(313)), ev(12, "Battlefield", "Graveyard", id(310), "destroyed", "player-1")]),
      ["Spirit token dies", "AI 1: 40 -> 39 life (-1)"]);
    const ARC = "Arc Trail deals 2 damage to any target and 1 damage to another target.";
    same("Arc Trail's 2 and 1 at two creatures that died: no amount",
      between(board((b) => { put(b, "battlefield", opp(BEAR()), "player-1"); put(b, "battlefield", opp(card(390, "Llanowar Elves", ["Creature"])), "player-1");
        b.stack.push(SPL("engine-stack-79", 392, "Arc Trail", ARC, "player-0", { targets: [{ kind: "card", id: id(1) }, { kind: "card", id: id(390) }] })); }),
        board((b) => { put(b, "graveyard", opp(BEAR()), "player-1"); put(b, "graveyard", opp(card(390, "Llanowar Elves", ["Creature"])), "player-1"); put(b, "graveyard", card(392, "Arc Trail", ["Sorcery"])); }),
        [ev(11, "Stack", "Graveyard", id(392)), ev(12, "Battlefield", "Graveyard", id(1), "destroyed", "player-1"), ev(13, "Battlefield", "Graveyard", id(390), "destroyed", "player-1")]),
      ["Grizzly Bears dies", "Llanowar Elves dies"]);
    same("a Shock at a blocked attacker resolved across a combat damage step: its rise is not the Shock's alone",
      between(board((b) => { b.step = "combatDeclareBlockers"; b.activePlayerId = "player-1"; put(b, "battlefield", { ...card(306, "Wall of Wood", ["Creature"]), power: "1" }); put(b, "battlefield", HG(), "player-1");
        b.combatAssignments = [{ attackerId: id(229), blockerId: id(306) }]; b.stack.push(SPL("engine-stack-80", 393, "Shock", "Shock deals 2 damage to any target.", "player-0", { targets: [{ kind: "card", id: id(229) }] })); }),
        board((b) => { b.step = "combatDamage"; b.activePlayerId = "player-1"; put(b, "battlefield", { ...card(306, "Wall of Wood", ["Creature"]), power: "1", damage: 3 }); put(b, "battlefield", HG({ damage: 3 }), "player-1");
          put(b, "graveyard", card(393, "Shock", ["Instant"])); }), [ev(11, "Stack", "Graveyard", id(393))]),
      []);
    const BOLT_AT = (t) => SPL("engine-stack-6", 308, "Lightning Bolt", "Lightning Bolt deals 3 damage to any target.", "player-1", { targets: [{ kind: "card", id: t }] });
    same("checker: a Bolt's target killed by another card's effect is not the Bolt's",
      between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push(BOLT_AT(id(1))); }),
        board((b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", opp(card(308, "Lightning Bolt", ["Instant"])), "player-1"); }),
        [ev(11, "Stack", "Graveyard", id(308), null, "player-1"), ev(12, "Battlefield", "Graveyard", id(1), "destroyed", "player-0", { cause: "Destroy", causeCardId: id(330), causeName: "Murder" })]),
      ["Grizzly Bears is destroyed by Murder"]);
    same("checker: an AI's Bolt at a planeswalker, a blocker damaged in combat the same window: the Bolt names no creature",
      between(board((b) => { b.step = "combatDeclareBlockers"; put(b, "battlefield", card(306, "Wall of Wood", ["Creature"])); put(b, "battlefield", { ...card(307, "Jace Beleren", ["Planeswalker"]), counters: { Loyalty: 5 } });
        b.stack.push(SPL("engine-stack-6", 308, "Lightning Bolt", "Lightning Bolt deals 3 damage to any target.", "player-1", { text: "Lightning Bolt (308) - Lightning Bolt deals 3 damage to Jace Beleren (307)." })); }),
        board((b) => { b.step = "combatDamage"; put(b, "battlefield", { ...card(306, "Wall of Wood", ["Creature"]), damage: 3 }); put(b, "battlefield", { ...card(307, "Jace Beleren", ["Planeswalker"]), counters: { Loyalty: 2 } });
          put(b, "graveyard", opp(card(308, "Lightning Bolt", ["Instant"])), "player-1"); }),
        [ev(11, "Stack", "Graveyard", id(308), null, "player-1")]),
      []);

    // #4 source shields: only the exact kinds, for the chooser, an attacker that dealt damage
    same("checker: Circle of Protection's shield is Blue's; Hill Giant attacking Blue's Jace is not prevented",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 71, [237, "Circle of Protection: Red"], COP, [GIANT()], id(229));
        const at = (step, loy) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", { ...card(307, "Jace Beleren", ["Planeswalker"]), counters: { Loyalty: loy } });
          put(b, "battlefield", HG({ attackTargetId: id(307) }), "player-1"); }), 38, 40);
        return [...tableLog(h), ...logOf(h, at("combatDeclareBlockers", 5), at("combatDamage", 2))];
      }),
      ["Blue chooses Hill Giant (Circle of Protection: Red)"]);
    const BEACON = "{T}: The next time a source of your choice would deal damage to you this turn, that damage is dealt to Beacon of Destiny instead.";
    same("checker: Beacon of Destiny's redirect is to itself, never 'dealt to AI 1 instead', AI 1's loss beside it bare",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 72, [320, "Beacon of Destiny"], BEACON, [GIANT()], id(229));
        const at = (step, dmg, ai) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", { ...card(320, "Beacon of Destiny", ["Creature"]), power: "1", ...(dmg ? { damage: dmg } : {}) });
          put(b, "battlefield", HG(), "player-1"); }), 38, ai);
        return [...tableLog(h), ...logOf(h, at("combatDeclareBlockers", 0, 40), at("combatDamage", 3, 37))];
      }),
      ["Blue chooses Hill Giant (Beacon of Destiny)", "AI 1: 40 -> 37 life (-3)"]);
    same("checker: Reflect Damage on an attacker killed before damage redirects nothing",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 73, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
        const a = life(board((b) => { b.step = "combatDeclareBlockers"; b.activePlayerId = "player-1"; put(b, "battlefield", HG(), "player-1"); }), 38, 40);
        const c = life(board((b) => { b.step = "combatDamage"; b.activePlayerId = "player-1"; put(b, "graveyard", GIANT(), "player-1"); }), 38, 37);
        return [...tableLog(h), ...logOf(h, a, c, [ev(11, "Battlefield", "Graveyard", id(229), "destroyed", "player-1", { cause: "Destroy", causeCardId: id(330), causeName: "Murder" })])];
      }),
      ["Blue chooses Hill Giant (Reflect Damage)", "Hill Giant is destroyed by Murder", "AI 1: 40 -> 37 life (-3)"]);
    const SELF_PING = { ...PYRO_PING, targets: [{ id: "player-1", intent: "hostile", kind: "player" }] };
    same("a prevention shield is its chooser's: the source's ping at another player is that player's loss",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 71, [237, "Circle of Protection: Red"], COP, [PYRO], id(238));
        return logOf(h, life(board((b) => { put(b, "battlefield", PYRO, "player-1"); b.stack.push(SELF_PING); }), 38, 40), life(board((b) => put(b, "battlefield", { ...PYRO, tapped: true }, "player-1")), 38, 39));
      }),
      ["AI 1: 40 -> 39 life (-1, damage from Prodigal Pyromancer)"]);
    same("a shield is used up: the source's second ping that turn is Blue's loss",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 71, [237, "Circle of Protection: Red"], COP, [PYRO], id(238));
        const ping = (sid, a) => life(board((b) => { put(b, "battlefield", PYRO, "player-1"); b.stack.push({ ...PYRO_PING, id: sid }); }), a, 40);
        const after = (a) => life(board((b) => put(b, "battlefield", { ...PYRO, tapped: true }, "player-1")), a, 40);
        return [...logOf(h, ping("engine-stack-40", 38), after(38)), ...logOf(h, ping("engine-stack-41", 38), after(37))];
      }),
      ["Prodigal Pyromancer's damage to Blue is prevented (Circle of Protection: Red)", "Blue: 38 -> 37 life (-1, damage from Prodigal Pyromancer)"]);

    same("a redirect the boards don't show (the source's controller lost nothing) is not said",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
        const at = (step) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", HG(), "player-1"); }), 38, 40);
        const ping = (a, c) => life(board((b) => { put(b, "battlefield", PYRO, "player-1"); }), a, c);
        SOURCE_PICK(seat, 62, [231, "Reflect Damage"], REFLECT, [PYRO], id(238));
        return [...logOf(h, at("combatDeclareBlockers"), at("combatDamage")), ...logOf(h, life(board((b) => { put(b, "battlefield", PYRO, "player-1"); b.stack.push(PYRO_PING); }), 38, 40), ping(38, 40))];
      }),
      []);
    same("a prevention the boards don't show (its chooser lost the source's damage) is not said",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 71, [237, "Circle of Protection: Red"], COP, [GIANT()], id(229));
        SOURCE_PICK(seat, 72, [237, "Circle of Protection: Red"], COP, [PYRO], id(238));
        const two = (step, a) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", HG(), "player-1");
          put(b, "battlefield", opp({ ...card(388, "Goblin Piker", ["Creature"]), power: "2", isAttacking: true, attackingPlayerId: "player-0", attackTargetId: "player-0", tapped: true }), "player-1"); }), a, 40);
        return [...logOf(h, two("combatDeclareBlockers", 38), two("combatDamage", 33)),
          ...logOf(h, life(board((b) => { put(b, "battlefield", PYRO, "player-1"); b.stack.push(PYRO_PING); }), 33, 40), life(board((b) => put(b, "battlefield", { ...PYRO, tapped: true }, "player-1")), 32, 40))];
      }),
      ["Blue: 38 -> 33 life (-5)", "Blue: 33 -> 32 life (-1)"]);
    same("Deflecting Palm's damage back is said only when its controller lost it",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 90, [260, "Deflecting Palm"], "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, Deflecting Palm deals that much damage to that source's controller.", [PYRO], id(238));
        return logOf(h, life(board((b) => { put(b, "battlefield", PYRO, "player-1"); b.stack.push(PYRO_PING); }), 38, 40), life(board((b) => put(b, "battlefield", { ...PYRO, tapped: true }, "player-1")), 38, 40));
      }),
      ["Prodigal Pyromancer's damage to Blue is prevented (Deflecting Palm)"]);

    // #5 no single-candidate fallback: a loss nothing explains stays bare
    same("checker: AI 1's Shock with no target known kills Bears; AI 1's own 2 lost (a shock land) stays bare",
      between(life(board((b) => { put(b, "battlefield", BEAR()); b.stack.push(SPL("engine-stack-5", 304, "Shock", "Shock deals 2 damage to any target.", "player-1", { text: "Shock (304) - Shock deals 2 damage to Grizzly Bears (1)." })); }), 40, 40),
        life(board((b) => { put(b, "graveyard", BEAR()); put(b, "graveyard", opp(card(304, "Shock", ["Instant"])), "player-1"); put(b, "battlefield", opp(card(305, "Steam Vents", ["Land"])), "player-1"); }), 40, 38),
        [ev(11, "Stack", "Graveyard", id(304), null, "player-1"), ev(12, "Hand", "Battlefield", id(305), null, "player-1"), ev(13, "Battlefield", "Graveyard", id(1), "destroyed")]),
      ["Grizzly Bears dies", "AI 1 puts Steam Vents onto the battlefield", "AI 1: 40 -> 38 life (-2)"]);
    const GUTTER = "Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.";
    const gutter = (fill, c) => life(board((b) => { put(b, "battlefield", card(380, "Guttersnipe", ["Creature"])); fill(b); }), 40, c);
    same("an 'each opponent' trigger is each opponent's loss, once per trigger",
      [...between(gutter((b) => b.stack.push(TRIG("engine-stack-70", 380, "Guttersnipe", GUTTER)), 40), gutter(() => {}, 38), CAST_EV),
        ...between(gutter((b) => b.stack.push(TRIG("engine-stack-70", 380, "Guttersnipe", GUTTER), TRIG("engine-stack-71", 380, "Guttersnipe", GUTTER)), 40), gutter(() => {}, 36), CAST_EV)],
      ["AI 1: 40 -> 38 life (-2, damage from Guttersnipe)", "AI 1: 40 -> 36 life (-4, damage from Guttersnipe ×2)"]);

    // #6 each source its own amount
    const PYRO_MINE = card(238, "Prodigal Pyromancer", ["Creature"]);
    same("checker: a Niv-Mizzet ping and a Prodigal Pyromancer ping at one creature: 1 each, not 2 from one",
      between(board((b) => { put(b, "battlefield", NIV); put(b, "battlefield", PYRO_MINE); put(b, "battlefield", WURM, "player-1");
        b.stack.push(PING("engine-stack-11", id(216)), SPL("engine-stack-12", 238, "Prodigal Pyromancer", "{T}: Prodigal Pyromancer deals 1 damage to any target.", "player-0", { targets: [{ kind: "card", id: id(216) }] })); }),
        board((b) => { put(b, "battlefield", NIV); put(b, "battlefield", { ...PYRO_MINE, tapped: true }); put(b, "battlefield", { ...WURM, damage: 2 }, "player-1"); }), []),
      ["Niv-Mizzet, Parun deals 1 damage to Craw Wurm", "Prodigal Pyromancer deals 1 damage to Craw Wurm"]);
    same("two pings at one creature that took 3: the sum is not theirs, nothing said",
      between(board((b) => { put(b, "battlefield", NIV); put(b, "battlefield", WURM, "player-1"); b.stack.push(PING("engine-stack-11", id(216)), PING("engine-stack-13", id(216))); }),
        board((b) => { put(b, "battlefield", NIV); put(b, "battlefield", { ...WURM, damage: 3 }, "player-1"); }), []),
      []);

    // #7 a keyword gained is said with the source only when that source's words name it
    same("checker: Lightning Helix resolved, Bears gained haste from something else: not Helix's",
      between(life(board((b) => { put(b, "battlefield", { ...BEAR(), keywords: [] }); b.stack.push({ ...SPL("engine-stack-9", 314, "Lightning Helix", "Lightning Helix deals 3 damage to any target and you gain 3 life."), targets: [{ kind: "player", id: "player-1" }] }); }), 40, 40),
        life(board((b) => { put(b, "battlefield", { ...BEAR(), keywords: ["Haste"] }); put(b, "graveyard", card(314, "Lightning Helix", ["Instant"])); }), 43, 37),
        [ev(11, "Stack", "Graveyard", id(314))]).filter((l) => /haste/i.test(l)),
      []);
    same("a resolved Plummet names flying but gives nothing: a creature's flying is not Plummet's",
      between(board((b) => { put(b, "battlefield", { ...BEAR(), keywords: [] }); put(b, "battlefield", opp({ ...card(381, "Serra Angel", ["Creature"]), keywords: ["Flying"] }), "player-1");
        b.stack.push(SPL("engine-stack-72", 382, "Plummet", "Destroy target creature with flying.")); }),
        board((b) => { put(b, "battlefield", { ...BEAR(), keywords: ["Flying"] }); put(b, "graveyard", opp(card(381, "Serra Angel", ["Creature"])), "player-1"); put(b, "graveyard", card(382, "Plummet", ["Instant"])); }),
        [ev(11, "Battlefield", "Graveyard", id(381), "destroyed", "player-1", { cause: "Destroy", causeCardId: id(382), causeName: "Plummet" }), ev(12, "Stack", "Graveyard", id(382))]).filter((l) => /\bgains?\b.*Plummet/.test(l)),
      []);

    const JUMP = { ...SPL("engine-stack-77", 389, "Jump", "Target creature gains flying until end of turn."), targets: [{ kind: "card", id: id(1) }] };
    const ELF = (kw) => ({ ...card(390, "Llanowar Elves", ["Creature"]), keywords: kw });
    same("a targeted gift's keyword is its target's alone; the same keyword on another creature is not its",
      between(board((b) => { put(b, "battlefield", { ...BEAR(), keywords: [] }); put(b, "battlefield", ELF([])); b.stack.push(JUMP); }),
        board((b) => { put(b, "battlefield", { ...BEAR(), keywords: ["Flying"] }); put(b, "battlefield", ELF(["Flying"])); put(b, "graveyard", card(389, "Jump", ["Instant"])); }), [ev(11, "Stack", "Graveyard", id(389))]),
      ["Grizzly Bears gains flying (Jump)"]);
    same("a 'creatures you control' gift is its controller's creatures' alone",
      between(board((b) => { put(b, "battlefield", KYKAR(["Flying"])); put(b, "battlefield", opp(ELF([])), "player-1"); b.stack.push(AKROMA); }),
        board((b) => { put(b, "battlefield", KYKAR(["Flying", "Vigilance"])); put(b, "battlefield", opp(ELF(["Vigilance"])), "player-1"); put(b, "graveyard", card(240, "Akroma's Will", ["Instant"])); }), [ev(11, "Stack", "Graveyard", id(240))]),
      ["Kykar, Wind's Fury gains vigilance (Akroma's Will)"]);

    same("an untargeted Whirlwind names flying but gives nothing: a creature's flying is not Whirlwind's",
      between(board((b) => { put(b, "battlefield", { ...BEAR(), keywords: [] }); b.stack.push(SPL("engine-stack-78", 391, "Whirlwind", "Destroy all creatures without flying.")); }),
        board((b) => { put(b, "battlefield", { ...BEAR(), keywords: ["Flying"] }); put(b, "graveyard", card(391, "Whirlwind", ["Sorcery"])); }), [ev(11, "Stack", "Graveyard", id(391))])
        .filter((l) => /Whirlwind/.test(l)),
      []);

    same("Flawless Maneuver's indestructible is not the haste a creature gained beside it",
      between(board((b) => { put(b, "battlefield", KYKAR([])); b.stack.push(SPL("engine-stack-81", 231, "Flawless Maneuver", "Creatures you control gain indestructible until end of turn.")); }),
        board((b) => { put(b, "battlefield", KYKAR(["Indestructible", "Haste"])); put(b, "graveyard", card(231, "Flawless Maneuver", ["Instant"])); }), [ev(11, "Stack", "Graveyard", id(231))]),
      ["Kykar, Wind's Fury gains indestructible (Flawless Maneuver)"]);

    // #8 a commander's way home by Forge's moves
    same("checker: a planeswalker commander at 0 loyalty returns, not 'is destroyed'",
      between(board((b) => put(b, "battlefield", { ...card(198, "Ral Zarek", ["Planeswalker"]), counters: { Loyalty: 1 } })), board((b) => put(b, "command", card(198, "Ral Zarek", ["Planeswalker"]))),
        [ev(11, "Battlefield", "Graveyard", id(198)), ev(12, "Graveyard", "Command", id(198))]),
      ["Ral Zarek returns to the command zone"]);
    same("a commander exiled is exiled, then returns",
      between(board((b) => put(b, "battlefield", card(199, "Rograkh, Son of Rohgahh", ["Creature"]))), board((b) => put(b, "command", card(199, "Rograkh, Son of Rohgahh", ["Creature"]))),
        [ev(11, "Battlefield", "Exile", id(199), "exiled", "player-0", { cause: "ChangeZone", causeCardId: id(340), causeName: "Swords to Plowshares" }), ev(12, "Exile", "Command", id(199))]),
      ["Rograkh, Son of Rohgahh is exiled and returns to the command zone"]);

    // #9 stale state: picks by their words, a cancel or a new cast forgets them; pain for its own board
    same("checker: a pick for one half of a split card names nothing on the other half's cast",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 85, sourceCard: { id: id(221), identity: { name: "Expansion // Explosion" } },
          input: { candidates: [{ id: id(229), kind: "card" }], chosenTargets: 0, type: "chooseBoardTargets", presentation: { title: "Explosion" } } };
        seat.respond(85, "chooseBoardTargets", { type: "boardTargets", chosen: [{ kind: "card", id: id(229) }] });
        return logOf(h, board((b) => put(b, "battlefield", GIANT(), "player-1")),
          board((b) => { put(b, "battlefield", GIANT(), "player-1"); b.stack.push(SPL("engine-stack-73", 221, "Expansion", "Copy target instant or sorcery spell with mana value 4 or less.")); }));
      }),
      ["Blue casts Expansion"]);
    const pickThen = (then) => fresh((h, seat) => {
      counterPick(seat);
      then(h, seat);
      return logOf(h, board((b) => b.stack.push(MARBLE)), board((b) => b.stack.push(MARBLE, CS)));
    });
    same("a cancelled cast's pick is forgotten", pickThen((h, seat) => seat.respond(86, "chooseBoardTargets", { type: "cancel" })), ["Blue casts Counterspell"]);
    same("a new cast of the card forgets its earlier pick",
      pickThen((h, seat) => h.B.notePlay(seat, { cardId: id(240), id: "prompt-action-30", label: "Cast Counterspell", mode: { type: "normal" }, type: "cast" }, "Counterspell", 0)),
      ["Blue casts Counterspell"]);
    same("and with neither, the pick is named", pickThen(() => {}), ["Blue casts Counterspell targeting Marble Diamond"]);
    const ELECTRO_ASK = (seat, n, chosen, pick) => {
      seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: n, sourceAbilityText: ELECTRO, sourceCard: { id: id(312), identity: { name: "Electrolyze" }, text: ELECTRO },
        input: { cancellable: true, candidates: [{ id: id(310), kind: "card" }, { id: id(311), kind: "card" }], chosenTargets: chosen, hostile: true, maxTargets: 2, minTargets: 1, presentation: { targets: [], title: "Electrolyze" }, type: "chooseBoardTargets" } };
      seat.respond(n, "chooseBoardTargets", { type: "boardTargets", chosen: [{ kind: "card", id: pick }] });
    };
    same("a follow-up pick adds to the first: both targets named",
      fresh((h, seat) => {
        ELECTRO_ASK(seat, 87, 0, id(310)); ELECTRO_ASK(seat, 88, 1, id(311));
        const toks = (b) => { put(b, "battlefield", SPIRIT_T, "player-1"); put(b, "battlefield", SAP_T, "player-1"); };
        return logOf(h, board(toks), board((b) => { toks(b); b.stack.push(SPL("engine-stack-74", 312, "Electrolyze", ELECTRO)); }));
      }),
      ["Blue casts Electrolyze targeting Spirit token and Saproling token"]);
    same("the life line's sum check: a part that doesn't add up to the change leaves the line bare",
      [...between(gutter((b) => b.stack.push(TRIG("engine-stack-70", 380, "Guttersnipe", GUTTER)), 40), gutter(() => {}, 35), CAST_EV),
        ...between(combatAt("combatFirstStrikeDamage", 41, 35), combatAt("combatDamage", 46, 32), [])],
      ["AI 1: 40 -> 35 life (-5)", "Blue: 41 -> 46 life (+5)", "AI 1: 35 -> 32 life (-3, combat damage from Drogskol Reaver)"]);
    same("checker: a pain tap in a window whose life rose (+2 net) is not said, nor carried to a later loss",
      fresh((h, seat) => {
        const before = life(board((b) => put(b, "battlefield", WASTES)), 38, 40);
        seat.board = { state: { gameView: before } };
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 22, input: { type: "chooseAction", actions: [
          { cardId: id(202), cost: "{T}", description: "{T}: Add {W} or {U}. Adarkar Wastes deals 1 damage to you.", id: "tap:w", isManaAbility: true, producedMana: [{ amount: 1, color: "W" }], type: "activateAbility" }] } };
        seat.respond(22, "chooseAction", { type: "act", actionId: "tap:w" });
        const mid = life(board((b) => put(b, "battlefield", { ...WASTES, tapped: true })), 40, 40);
        return [...logOf(h, before, mid), ...logOf(h, mid, life(board((b) => put(b, "battlefield", { ...WASTES, tapped: true })), 39, 40))];
      }),
      ["Blue: 38 -> 40 life (+2)", "Blue: 40 -> 39 life (-1)"]);
    same("a pain tap is its player's: AI 1's loss beside it stays bare",
      fresh((h, seat) => {
        const before = life(board((b) => put(b, "battlefield", WASTES)), 38, 40);
        seat.board = { state: { gameView: before } };
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 22, input: { type: "chooseAction", actions: [
          { cardId: id(202), cost: "{T}", description: "{T}: Add {W} or {U}. Adarkar Wastes deals 1 damage to you.", id: "tap:w", isManaAbility: true, producedMana: [{ amount: 1, color: "W" }], type: "activateAbility" }] } };
        seat.respond(22, "chooseAction", { type: "act", actionId: "tap:w" });
        return logOf(h, before, life(board((b) => put(b, "battlefield", { ...WASTES, tapped: true })), 37, 39));
      }),
      ["Blue: 38 -> 37 life (-1, damage from Adarkar Wastes)", "AI 1: 40 -> 39 life (-1)"]);

    // #10 a bite's damage is its creature's: nothing named
    same("checker: Rabid Bite names no source (the damage is the creature's)",
      between(board((b) => { put(b, "battlefield", { ...BEAR(), power: "2" }); put(b, "battlefield", WURM, "player-1");
        b.stack.push(SPL("engine-stack-52", 372, "Rabid Bite", "Target creature you control deals damage equal to its power to target creature or planeswalker you don't control.", "player-0", { targets: [{ kind: "card", id: id(1) }, { kind: "card", id: id(216) }] })); }),
        board((b) => { put(b, "battlefield", { ...BEAR(), power: "2" }); put(b, "battlefield", { ...WURM, damage: 2 }, "player-1"); put(b, "graveyard", card(372, "Rabid Bite", ["Sorcery"])); }),
        [ev(11, "Stack", "Graveyard", id(372))]),
      []);

    // #11 a goad spell countered before any board showed it goads nothing
    same("checker: Disrupt Decorum countered unseen goads nothing",
      between(board((b) => { put(b, "battlefield", GIANT(), "player-1"); count(b, "hand", 7, "player-1"); }),
        board((b) => { put(b, "battlefield", GIANT(), "player-1"); put(b, "graveyard", { ...card(360, "Disrupt Decorum", ["Sorcery"]), text: "Goad all creatures you don't control." });
          put(b, "graveyard", opp({ ...card(361, "Counterspell", ["Instant"]), text: "Counter target spell." }), "player-1"); count(b, "hand", 6, "player-1"); }),
        [ev(11, "Stack", "Graveyard", id(360)), ev(12, "Stack", "Graveyard", id(361), null, "player-1")]),
      ["Blue casts Disrupt Decorum", "AI 1 casts Counterspell", "Disrupt Decorum is countered by Counterspell"]);

    // guards no test held (the checker's escaped mutants)
    same("a spell granting a quoted '{T}:' ability is cast, its colon no cost",
      between(board(() => {}), board((b) => b.stack.push(SPL("engine-stack-75", 383, "Banishing Knack", "Until end of turn, target creature gains \"{T}: Return target nonland permanent to its owner's hand.\"", "player-1"))), []),
      ["AI 1 casts Banishing Knack"]);
    const VANGUARD = { ...card(219, "Elite Vanguard", ["Creature"]), power: "2", isAttacking: true, attackingPlayerId: "player-1", attackTargetId: "player-1", tapped: true };
    const GIANT_MINE = { ...card(384, "Hill Giant", ["Creature"]), power: "3", isAttacking: true, attackingPlayerId: "player-1", attackTargetId: "player-1", tapped: true };
    same("an attacker blocked on the board before stays blocked though its blocker is gone: the other's damage alone",
      between(life(board((b) => { b.step = "combatDeclareBlockers"; put(b, "battlefield", VANGUARD); put(b, "battlefield", GIANT_MINE); put(b, "battlefield", opp(card(230, "Wall of Wood", ["Creature"])), "player-1");
        b.combatAssignments = [{ attackerId: id(384), blockerId: id(230) }]; }), 40, 40),
        life(board((b) => { b.step = "combatDamage"; put(b, "battlefield", VANGUARD); put(b, "battlefield", GIANT_MINE); put(b, "graveyard", opp(card(230, "Wall of Wood", ["Creature"])), "player-1"); }), 40, 38), [])
        .filter((l) => /life/.test(l)),
      ["AI 1: 40 -> 38 life (-2, combat damage from Elite Vanguard)"]);
    same("of two counterspells resolved, which countered the spell is unknown: no 'by'",
      between(board((b) => b.stack.push(MARBLE, CS, SPL("engine-stack-22", 385, "Negate", "Counter target noncreature spell."))),
        board((b) => { put(b, "graveyard", opp(card(229, "Marble Diamond", ["Artifact"])), "player-1"); put(b, "graveyard", card(240, "Counterspell", ["Instant"])); put(b, "graveyard", card(385, "Negate", ["Instant"])); }),
        [ev(11, "Stack", "Graveyard", id(229), null, "player-1"), ev(12, "Stack", "Graveyard", id(240)), ev(13, "Stack", "Graveyard", id(385))]),
      ["Marble Diamond is countered"]);
    same("a planeswalker cast and activated between two boards says its ability's cost",
      between(board((b) => put(b, "battlefield", GIANT_204, "player-1")), board((b) => { put(b, "battlefield", RAL(2)); put(b, "battlefield", GIANT_204, "player-1"); b.stack.push(RAL_MINUS); }),
        [ev(11, "Hand", "Battlefield", id(201))]).filter((l) => /Ral Zarek's/.test(l)),
      ["Blue activates Ral Zarek's -2 targeting Hill Giant: it deals 3 damage to any target"]);
    same("a cast by another static alternative cost (Force of Will's) is not 'without paying its mana cost'",
      fresh((h, seat) => {
        const fow = { ...card(386, "Force of Will", ["Instant"]), text: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell." };
        const a = board((b) => put(b, "hand", fow));
        seat.board = { state: { gameView: a } };
        h.B.notePlay(seat, { cardId: id(386), id: "prompt-action-31", label: "Cast Force of Will", mode: { type: "staticAlternative" }, type: "cast" }, "Force of Will", 0);
        return logOf(h, a, board((b) => b.stack.push(SPL("engine-stack-76", 386, "Force of Will", fow.text))));
      }),
      ["Blue casts Force of Will"]);
    same("a creature sacrificed by its own trigger names no cause",
      between(board((b) => put(b, "battlefield", card(387, "Ball Lightning", ["Creature"]))), board((b) => put(b, "graveyard", card(387, "Ball Lightning", ["Creature"]))),
        [ev(11, "Battlefield", "Graveyard", id(387), "sacrificed", "player-0", { cause: "Sacrifice", causeCardId: id(387), causeName: "Ball Lightning" })]),
      ["Ball Lightning is sacrificed"]);

    // ---- the checker's round 3 (ed3f74e): lines it still wrote wrong, and guards no test held
    // (boards one after another as updateLog takes them: each snapshot is the next one's prev, the picks kept on it)
    const chain = (h, first, ...steps) => {
      let prev = h.B.logSnapshot(first);
      return steps.flatMap(([b, evs = []]) => { const cur = h.B.logSnapshot(b, prev); const lines = h.B.logEvents(prev, cur, b, h.B.engineFacts(evs)); prev = cur; return lines; });
    };
    // (a/b) one damage item at a creature names only its own amount, the rise exactly that
    const BEAR3 = { ...BEAR(), power: "3" };
    const BITE = (sid) => SPL(sid, 372, "Rabid Bite", "Target creature you control deals damage equal to its power to target creature or planeswalker you don't control.", "player-0", { targets: [{ kind: "card", id: id(1) }, { kind: "card", id: id(216) }] });
    const BITE_GONE = (b) => { put(b, "graveyard", card(372, "Rabid Bite", ["Sorcery"])); };
    same("checker r3: Pyroclasm's 2 beside Rabid Bite's 3 at Craw Wurm is no 'Pyroclasm deals 5'",
      between(board((b) => { put(b, "battlefield", BEAR3); put(b, "battlefield", WURM, "player-1"); b.stack.push(SPL("engine-stack-90", 277, "Pyroclasm", "Pyroclasm deals 2 damage to each creature."), BITE("engine-stack-91")); }),
        board((b) => { put(b, "battlefield", { ...BEAR3, damage: 2 }); put(b, "battlefield", { ...WURM, damage: 5 }, "player-1"); put(b, "graveyard", card(277, "Pyroclasm", ["Sorcery"])); BITE_GONE(b); }),
        [ev(11, "Stack", "Graveyard", id(372)), ev(12, "Stack", "Graveyard", id(277))]),
      ["Pyroclasm deals 2 damage to Grizzly Bears"]);
    same("checker r3: a Bolt beside Rabid Bite at Craw Wurm, marked 6, is no 'Bolt deals 6'",
      between(board((b) => { put(b, "battlefield", BEAR3); put(b, "battlefield", WURM, "player-1"); b.stack.push({ ...SPL("engine-stack-92", 308, "Lightning Bolt", "Lightning Bolt deals 3 damage to any target."), targets: [{ kind: "card", id: id(216) }] }, BITE("engine-stack-93")); }),
        board((b) => { put(b, "battlefield", BEAR3); put(b, "battlefield", { ...WURM, damage: 6 }, "player-1"); put(b, "graveyard", card(308, "Lightning Bolt", ["Instant"])); BITE_GONE(b); }),
        [ev(11, "Stack", "Graveyard", id(372)), ev(12, "Stack", "Graveyard", id(308))]),
      []);
    same("and a Bolt alone at Craw Wurm, marked 3, is the Bolt's 3",
      between(board((b) => { put(b, "battlefield", WURM, "player-1"); b.stack.push({ ...SPL("engine-stack-92", 308, "Lightning Bolt", "Lightning Bolt deals 3 damage to any target."), targets: [{ kind: "card", id: id(216) }] }); }),
        board((b) => { put(b, "battlefield", { ...WURM, damage: 3 }, "player-1"); put(b, "graveyard", card(308, "Lightning Bolt", ["Instant"])); }), [ev(11, "Stack", "Graveyard", id(308))]),
      ["Lightning Bolt deals 3 damage to Craw Wurm"]);
    // (c) "each creature" only by the plain words
    same("checker r3: Fiery Cannonade's 'each creature that isn't a Pirate' is not the 2 a fight put on a Pirate (its own amount, so only the words tell)",
      between(board((b) => { put(b, "battlefield", { ...card(380, "Fathom Fleet Captain", ["Creature"]), power: "2" });
        b.stack.push(SPL("engine-stack-94", 381, "Fiery Cannonade", "Fiery Cannonade deals 2 damage to each creature that isn't a Pirate."), SPL("engine-stack-95", 382, "Prey Upon", "Target creature you control fights target creature you don't control.", "player-1")); }),
        board((b) => { put(b, "battlefield", { ...card(380, "Fathom Fleet Captain", ["Creature"]), power: "2", damage: 2 }); put(b, "graveyard", card(381, "Fiery Cannonade", ["Instant"])); put(b, "graveyard", opp(card(382, "Prey Upon", ["Sorcery"])), "player-1"); }),
        [ev(11, "Stack", "Graveyard", id(382), null, "player-1"), ev(12, "Stack", "Graveyard", id(381))]),
      []);
    same("checker r3: Sizzle's 'each opponent' is no creature's: Blue's Wurm's 3 from elsewhere is not Sizzle's",
      between(life(board((b) => { put(b, "battlefield", card(410, "Craw Wurm", ["Creature"])); b.stack.push(SPL("engine-stack-90", 411, "Sizzle", "Sizzle deals 3 damage to each opponent.")); }), 40, 40),
        life(board((b) => { put(b, "battlefield", { ...card(410, "Craw Wurm", ["Creature"]), damage: 3 }); put(b, "graveyard", card(411, "Sizzle", ["Sorcery"])); }), 40, 37),
        [ev(11, "Stack", "Graveyard", id(411))]),
      ["AI 1: 40 -> 37 life (-3, damage from Sizzle)"]);
    // (and two of Pestilence's activations, one stack entry: each creature twice, each player twice, the sums add up)
    const PEST = "{B}: Pestilence deals 1 damage to each creature and each player.";
    const PEST_AT = (sid) => SPL(sid, 397, "Pestilence", PEST);
    const pest = (fill, dmg, l) => life(board((b) => { put(b, "battlefield", card(397, "Pestilence", ["Enchantment"])); put(b, "battlefield", { ...WURM, ...(dmg ? { damage: dmg } : {}) }, "player-1"); fill(b); }), l, l);
    same("two Pestilence activations in one entry: 1 and 1 at each creature",
      between(pest((b) => b.stack.push(PEST_AT("engine-stack-96"), PEST_AT("engine-stack-97")), 0, 40), pest(() => {}, 2, 38), CAST_EV),
      ["Pestilence deals 1 damage to Craw Wurm", "Pestilence deals 1 damage to Craw Wurm", "Blue: 40 -> 38 life (-2)", "AI 1: 40 -> 38 life (-2)"]);
    const PYRE = "Whenever a player casts a spell, Weird Pyre deals 1 damage to each player.";
    const pyre = (fill, l) => life(board((b) => { put(b, "battlefield", card(399, "Weird Pyre", ["Enchantment"])); fill(b); }), l, l);
    same("two 'each player' triggers in one entry: each player's loss, once for each",
      between(pyre((b) => b.stack.push(TRIG("engine-stack-96", 399, "Weird Pyre", PYRE), TRIG("engine-stack-97", 399, "Weird Pyre", PYRE)), 40), pyre(() => {}, 38), CAST_EV),
      ["Blue: 40 -> 38 life (-2, damage from Weird Pyre ×2)", "AI 1: 40 -> 38 life (-2, damage from Weird Pyre ×2)"]);
    // (d) the payer's own answer, checked against the draws Forge says it made
    same("checker r3: Blue's 'Pay {1}?' yes to AI 1's Rhystic Study, then AI 1's draw by it: no 'Blue pays'",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 9, sourceAbilityText: RHYSTIC_TEXT, sourceCard: { id: id(245), identity: { name: "Rhystic Study" } }, input: { presentation: { title: "Pay {1}?" }, type: "chooseBoolean" } };
        seat.respond(9, "chooseBoolean", { type: "decision", value: true });
        const w = (fill) => aiRhystic((b) => { count(b, "library", 50, "player-1"); fill(b); });
        return logOf(h, w((b) => b.stack.push(AI_RHYSTIC())), w((b) => { count(b, "library", 49, "player-1"); count(b, "hand", 1, "player-1"); }),
          [ev(11, "Library", "Hand", null, "draw", "player-1", { cause: "Draw", causeCardId: id(245), causeName: "Rhystic Study" })]);
      }),
      ["AI 1 draws a card"]);
    same("a 'Pay {1}?' yes to Mentor of the Meek with no draw by it in the feed: no 'pays'",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 107, sourceAbilityText: MENTOR_TEXT, sourceCard: { id: id(226), identity: { name: "Mentor of the Meek" } }, input: { presentation: { title: "Pay {1}?" }, type: "chooseBoolean" } };
        seat.respond(107, "chooseBoolean", { type: "decision", value: true });
        return logOf(h, mentorBoard((b) => b.stack.push(MENTOR("engine-stack-40"))), mentorBoard(() => {}), CAST_EV);
      }),
      []);
    const REMORA = "Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.";
    same("checker r3: Blue's 'Pay {1}?' yes to Mystic Remora's cumulative upkeep is not AI 1's payment of {4}",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 30, sourceAbilityText: "At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.",
          sourceCard: { id: id(400), identity: { name: "Mystic Remora" } }, input: { presentation: { title: "Pay {1}?" }, type: "chooseBoolean" } };
        seat.respond(30, "chooseBoolean", { type: "decision", value: true });
        const w = (fill) => board((b) => { put(b, "battlefield", card(400, "Mystic Remora", ["Enchantment"])); count(b, "library", 50); fill(b); });
        return logOf(h, w((b) => b.stack.push(TRIG("engine-stack-70", 400, "Mystic Remora", REMORA, "player-0", { text: `${REMORA} [Card: Opt (401), Activator: ${ACT}, SpellAbility: Opt]` }))),
          w((b) => { count(b, "library", 49); count(b, "hand", 1); }), [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(400), causeName: "Mystic Remora" })]);
      }),
      ["AI 1 doesn't pay {4} (Mystic Remora)", "Blue draws a card"]);
    same("one Rhystic Study trigger, two draws by it in the feed (another came and went): one 'doesn't pay'",
      between(rhyW((b) => b.stack.push(UNLESS("engine-stack-27", 1, "Rhystic Study", RHYSTIC_TEXT, 245))), rhyW((b) => { count(b, "library", 48); count(b, "hand", 2); }),
        [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(245), causeName: "Rhystic Study" }), ev(12, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(245), causeName: "Rhystic Study" })])
        .filter((l) => /Rhystic/.test(l)),
      ["AI 1 doesn't pay {1} (Rhystic Study)"]);
    same("an 'unless' whose words name no Activator has no payer: nothing said of a payment",
      between(aiRhystic((b) => { count(b, "library", 50, "player-1"); b.stack.push(TRIG("engine-stack-61", 245, "Rhystic Study", RHYSTIC_TEXT, "player-1")); }),
        aiRhystic((b) => { count(b, "library", 49, "player-1"); count(b, "hand", 1, "player-1"); }),
        [ev(11, "Library", "Hand", null, "draw", "player-1", { cause: "Draw", causeCardId: id(245), causeName: "Rhystic Study" })]).filter((l) => /pay/.test(l)),
      []);
    // (e) a redirect only when the player it was aimed at lost no more than the rest aimed there
    same("checker r3: Reflect Damage on Hill Giant, Blue lost its 3 and AI 1 paid 3 elsewhere: no redirect said",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 74, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
        const at = (step, a, c) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", HG(), "player-1"); }), a, c);
        return [...tableLog(h), ...logOf(h, at("combatDeclareBlockers", 38, 404), at("combatDamage", 35, 401))];
      }),
      ["Blue chooses Hill Giant (Reflect Damage)", "Blue: 38 -> 35 life (-3)", "AI 1: 404 -> 401 life (-3)"]);
    // (f) a loyalty cost only for a planeswalker
    same("checker r3: an artifact's '0: Draw a card.' is an ability, no loyalty cost",
      between(board((b) => put(b, "battlefield", card(390, "Weird Thing", ["Artifact"]))), board((b) => { put(b, "battlefield", card(390, "Weird Thing", ["Artifact"])); b.stack.push(SPL("engine-stack-96", 390, "Weird Thing", "0: Draw a card.")); }), []),
      ["Blue uses Weird Thing's ability: draw a card"]);
    // (g) a pick for a play no board showed on the stack: only one made while casting it. The harness's real shapes: a
    // target prompt is cancellable exactly while a spell is cast or an ability activated; a trigger's has no words and
    // isn't cancellable; a permanent spell's cast has no words; a spell's words are Forge's, not the Oracle's.
    const CHUPA_ETB = "When Ravenous Chupacabra enters, destroy target creature an opponent controls.";
    const CHUPA = { ...card(395, "Ravenous Chupacabra", ["Creature"]), text: CHUPA_ETB };
    const askTargets = (seat, c, words, n, picks, casting = true, extra = {}) => {
      for (const [k, p] of picks.entries()) {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: n + k, ...(words ? { sourceAbilityText: words } : {}), sourceCard: { id: c.id, identity: c.identity },
          input: { cancellable: casting, candidates: [{ id: p, kind: "card" }], chosenTargets: 0, intent: "destroy", maxTargets: 1, minTargets: 1, type: "chooseBoardTargets", presentation: { title: "Choose a target" }, ...extra } };
        seat.respond(n + k, "chooseBoardTargets", { type: "boardTargets", chosen: [{ kind: "card", id: p }] });
      }
    };
    const pendingPick = (seat, h, c, words, n, pick, casting = true) => {
      h.B.notePlay(seat, { cardId: c.id, id: `prompt-action-${n}`, label: `Cast ${c.identity.name}`, mode: { type: "normal" }, type: "cast" }, c.identity.name, 0);
      askTargets(seat, c, words, n, [pick].flat(), casting);
    };
    same("checker r3: a creature cast unseen, its enter trigger's pick made and resolved: the cast names no target",
      fresh((h, seat) => {
        const a = board((b) => { put(b, "hand", CHUPA); put(b, "battlefield", GIANT(), "player-1"); });
        seat.board = { state: { gameView: a } };
        pendingPick(seat, h, CHUPA, undefined, 91, id(229), false);
        return logOf(h, a, board((b) => { put(b, "battlefield", CHUPA); put(b, "graveyard", GIANT(), "player-1"); }),
          [ev(11, "Battlefield", "Graveyard", id(229), "destroyed", "player-1", { cause: "Destroy", causeCardId: id(395), causeName: "Ravenous Chupacabra" })]).filter((l) => /casts/.test(l));
      }),
      ["Blue casts Ravenous Chupacabra"]);
    same("and a trigger's pick asked with the card's very words is still no casting pick",
      fresh((h, seat) => {
        const a = board((b) => { put(b, "hand", CHUPA); put(b, "battlefield", GIANT(), "player-1"); });
        seat.board = { state: { gameView: a } };
        pendingPick(seat, h, CHUPA, CHUPA_ETB, 89, id(229), false);
        return logOf(h, a, board((b) => { put(b, "battlefield", CHUPA); put(b, "graveyard", GIANT(), "player-1"); }), CAST_EV).filter((l) => /casts/.test(l));
      }),
      ["Blue casts Ravenous Chupacabra"]);
    same("and an instant cast unseen, picked while casting it, names its target",
      fresh((h, seat) => {
        const SHOCK_T = "Shock deals 2 damage to any target.", shock = { ...card(396, "Shock", ["Instant"]), text: SHOCK_T };
        const a = board((b) => { put(b, "hand", shock); put(b, "battlefield", opp(BEAR()), "player-1"); });
        seat.board = { state: { gameView: a } };
        pendingPick(seat, h, shock, SHOCK_T, 93, id(1));
        return logOf(h, a, board((b) => { put(b, "graveyard", shock); put(b, "graveyard", opp(BEAR()), "player-1"); }),
          [ev(11, "Stack", "Graveyard", id(396)), ev(12, "Battlefield", "Graveyard", id(1), "destroyed", "player-1")]).filter((l) => /casts/.test(l));
      }),
      ["Blue casts Shock targeting Grizzly Bears"]);
    // (the source-shield guards: a partial prevention is none; a blocked attacker aims nothing; a lifelink prevented gains nothing)
    same("checker r3: Healing Grace's 3 of a 6-power Wurm's 6 is no 'is prevented'",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 75, [402, "Healing Grace"], "Prevent the next 3 damage that would be dealt to any target this turn by a source of your choice. You gain 3 life.", [opp({ ...card(403, "Craw Wurm", ["Creature"]), power: "6" })], id(403));
        const g = opp({ ...card(403, "Craw Wurm", ["Creature"]), power: "6", isAttacking: true, attackingPlayerId: "player-0", attackTargetId: "player-0", tapped: true });
        const at = (step) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", g, "player-1"); }), 38, 40);
        return [...tableLog(h), ...logOf(h, at("combatDeclareBlockers"), at("combatDamage"))];
      }),
      ["Blue chooses Craw Wurm (Healing Grace)"]);
    const WALL_B = card(414, "Wall of Wood", ["Creature"]);
    const ATK = (n, name, power, kw = []) => opp({ ...card(n, name, ["Creature"]), power, keywords: kw, isAttacking: true, attackingPlayerId: "player-0", attackTargetId: "player-0", tapped: true });
    same("checker r3: Circle of Protection on an unblocked Hill Giant, a blocked Craw Wurm beside it, Blue still lost 3: no 'is prevented'",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 76, [412, "Circle of Protection: Red"], COP, [GIANT()], id(229));
        const at = (step, a) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", HG(), "player-1"); put(b, "battlefield", ATK(413, "Craw Wurm", "6"), "player-1");
          put(b, "battlefield", WALL_B); b.combatAssignments = [{ attackerId: id(413), blockerId: id(414) }]; }), a, 40);
        return [...tableLog(h), ...logOf(h, at("combatDeclareBlockers", 38), at("combatDamage", 35))];
      }),
      ["Blue chooses Hill Giant (Circle of Protection: Red)", "Blue: 38 -> 35 life (-3)"]);
    same("a lifelink attacker's damage prevented gains nothing: the gain is the blocked lifelinker's alone",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 77, [412, "Circle of Protection: Red"], COP, [GIANT()], id(229));
        const at = (step, c) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", HG({ keywords: ["Lifelink"] }), "player-1");
          put(b, "battlefield", ATK(398, "Child of Night", "2", ["Lifelink"]), "player-1"); put(b, "battlefield", WALL_B); b.combatAssignments = [{ attackerId: id(398), blockerId: id(414) }]; }), 38, c);
        return [...tableLog(h), ...logOf(h, at("combatDeclareBlockers", 40), at("combatDamage", 42))];
      }),
      ["Blue chooses Hill Giant (Circle of Protection: Red)", "Hill Giant's combat damage to Blue is prevented (Circle of Protection: Red)", "AI 1: 40 -> 42 life (+2, lifelink from Child of Night)"]);
    same("a combat damage step on an earlier turn is no attacker's damage on this one",
      between(life(board((b) => { b.step = "combatDeclareBlockers"; b.activePlayerId = "player-1"; put(b, "battlefield", HG(), "player-1"); }), 38, 40),
        (() => { const b = life(board((x) => { x.step = "main2"; x.activePlayerId = "player-1"; put(x, "battlefield", GIANT(), "player-1"); }), 35, 40); b.turn = 4; return b; })(), [])
        .filter((l) => /life/.test(l)),
      ["Blue: 38 -> 35 life (-3)"]);
    // (a pick used once: the card's next item with the same words, picked for by no one, names nothing)
    const PYRO_T = "{T}: Prodigal Pyromancer deals 1 damage to any target.";
    same("a player's pick goes on its stack item once: the same ability's next item names nothing",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 94, sourceAbilityText: PYRO_T, sourceCard: { id: id(238), identity: { name: "Prodigal Pyromancer" } },
          input: { candidates: [{ id: id(216), kind: "card" }], chosenTargets: 0, type: "chooseBoardTargets", presentation: { title: "Prodigal Pyromancer" } } };
        seat.respond(94, "chooseBoardTargets", { type: "boardTargets", chosen: [{ kind: "card", id: id(216) }] });
        const w = (dmg, fill = () => {}) => board((b) => { put(b, "battlefield", PYRO_MINE); put(b, "battlefield", { ...WURM, ...(dmg ? { damage: dmg } : {}) }, "player-1"); fill(b); });
        const b1 = w(0, (b) => b.stack.push(SPL("engine-stack-98", 238, "Prodigal Pyromancer", PYRO_T))), c = w(1), d = w(1, (b) => b.stack.push(SPL("engine-stack-99", 238, "Prodigal Pyromancer", PYRO_T)));
        return chain(h, w(0), [b1], [c], [d]);
      }),
      ["Blue uses Prodigal Pyromancer's ability targeting Craw Wurm: it deals 1 damage to any target", "Prodigal Pyromancer deals 1 damage to Craw Wurm", "Blue uses Prodigal Pyromancer's ability: it deals 1 damage to any target"]);
    // (a planeswalker commander destroyed is destroyed, never "dies")
    same("a planeswalker commander destroyed is destroyed, then returns",
      between(board((b) => put(b, "battlefield", { ...card(198, "Ral Zarek", ["Planeswalker"]), counters: { Loyalty: 3 } })), board((b) => put(b, "command", card(198, "Ral Zarek", ["Planeswalker"]))),
        [ev(11, "Battlefield", "Graveyard", id(198), "destroyed", "player-0", { cause: "Destroy", causeCardId: id(330), causeName: "Vindicate" }), ev(12, "Graveyard", "Command", id(198))]),
      ["Ral Zarek is destroyed and returns to the command zone"]);
    // (a targeted gift's target known by the player's pick alone)
    const JUMP_T = "Target creature gains flying until end of turn.";
    same("a targeted gift whose target is the player's pick: that creature's keyword is its",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 95, sourceAbilityText: JUMP_T, sourceCard: { id: id(389), identity: { name: "Jump" } },
          input: { candidates: [{ id: id(1), kind: "card" }], chosenTargets: 0, type: "chooseBoardTargets", presentation: { title: "Jump" } } };
        seat.respond(95, "chooseBoardTargets", { type: "boardTargets", chosen: [{ kind: "card", id: id(1) }] });
        const a = board((b) => put(b, "battlefield", { ...BEAR(), keywords: [] })), b1 = board((b) => { put(b, "battlefield", { ...BEAR(), keywords: [] }); b.stack.push(SPL("engine-stack-100", 389, "Jump", JUMP_T)); });
        const c = board((b) => { put(b, "battlefield", { ...BEAR(), keywords: ["Flying"] }); put(b, "graveyard", card(389, "Jump", ["Instant"])); });
        return chain(h, a, [b1], [c, [ev(11, "Stack", "Graveyard", id(389))]]);
      }),
      ["Blue casts Jump targeting Grizzly Bears", "Grizzly Bears gains flying (Jump)"]);

    // (round 3's mutation pass: guards each escaped mutant showed no test held)
    same("an X spell's amount is Forge's filled-in words, with no '(X=N)' note",
      between(board((b) => { put(b, "battlefield", WURM, "player-1"); b.stack.push(SPL("engine-stack-101", 420, "Banefire", "Banefire deals X damage to any target. If X is 5 or more, this spell can't be countered and the damage can't be prevented.", "player-0",
        { targets: [{ kind: "card", id: id(216) }], text: "Banefire (420) - Banefire (420) deals 4 damage to Craw Wurm (216)." })); }),
        board((b) => { put(b, "battlefield", { ...WURM, damage: 4 }, "player-1"); put(b, "graveyard", card(420, "Banefire", ["Sorcery"])); }), [ev(11, "Stack", "Graveyard", id(420))]),
      ["Banefire deals 4 damage to Craw Wurm"]);
    same("a spell whose creature deals the damage is no source: 'Target creature you control deals 2 damage'",
      between(board((b) => { put(b, "battlefield", BEAR3); put(b, "battlefield", WURM, "player-1");
        b.stack.push(SPL("engine-stack-102", 421, "Weird Sling", "Target creature you control deals 2 damage to target creature you don't control.", "player-0", { targets: [{ kind: "card", id: id(1) }, { kind: "card", id: id(216) }] })); }),
        board((b) => { put(b, "battlefield", BEAR3); put(b, "battlefield", { ...WURM, damage: 2 }, "player-1"); put(b, "graveyard", card(421, "Weird Sling", ["Sorcery"])); }), [ev(11, "Stack", "Graveyard", id(421))]),
      []);
    same("a pick sent twice is one target: the ping's 1 at Craw Wurm is said",
      fresh((h, seat) => {
        const ask = (n, chosen) => { seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: n, sourceAbilityText: PYRO_T, sourceCard: { id: id(238), identity: { name: "Prodigal Pyromancer" } },
          input: { candidates: [{ id: id(216), kind: "card" }], chosenTargets: chosen, type: "chooseBoardTargets", presentation: { title: "Prodigal Pyromancer" } } };
          seat.respond(n, "chooseBoardTargets", { type: "boardTargets", chosen: [{ kind: "card", id: id(216) }] }); };
        ask(96, 0); ask(97, 1);
        const w = (dmg, fill = () => {}) => board((b) => { put(b, "battlefield", PYRO_MINE); put(b, "battlefield", { ...WURM, ...(dmg ? { damage: dmg } : {}) }, "player-1"); fill(b); });
        return chain(h, w(0), [w(0, (b) => b.stack.push(SPL("engine-stack-103", 238, "Prodigal Pyromancer", PYRO_T)))], [w(1)]);
      }),
      ["Blue uses Prodigal Pyromancer's ability targeting Craw Wurm: it deals 1 damage to any target", "Prodigal Pyromancer deals 1 damage to Craw Wurm"]);
    same("a land a creature only on the later board took no wipe's damage for sure (it may have become one after)",
      between(board((b) => { put(b, "battlefield", card(268, "Mutavault", ["Land"])); b.stack.push(SPL("engine-stack-90", 277, "Pyroclasm", "Pyroclasm deals 2 damage to each creature.")); }),
        board((b) => { put(b, "battlefield", { ...card(268, "Mutavault", ["Land", "Creature"]), damage: 2 }); put(b, "graveyard", card(277, "Pyroclasm", ["Sorcery"])); }), [ev(11, "Stack", "Graveyard", id(277))])
        .filter((l) => /Pyroclasm/.test(l)),
      []);
    same("a Bolt's target sacrificed (no cause in the feed) is not the Bolt's",
      between(board((b) => { put(b, "battlefield", opp(BEAR()), "player-1"); b.stack.push({ ...SPL("engine-stack-104", 308, "Lightning Bolt", "Lightning Bolt deals 3 damage to any target."), targets: [{ kind: "card", id: id(1) }] }); }),
        board((b) => { put(b, "graveyard", opp(BEAR()), "player-1"); put(b, "graveyard", card(308, "Lightning Bolt", ["Instant"])); }),
        [ev(11, "Stack", "Graveyard", id(308)), ev(12, "Battlefield", "Graveyard", id(1), "sacrificed", "player-1")]).filter((l) => /Bolt/.test(l)),
      []);
    same("a lifelink pinger's ping at a player who lost nothing gains nothing: its controller's +1 from elsewhere stays bare",
      between(life(board((b) => { put(b, "battlefield", { ...PYRO_MINE, keywords: ["Lifelink"] }); b.stack.push(SPL("engine-stack-105", 238, "Prodigal Pyromancer", PYRO_T, "player-0", { targets: [{ kind: "player", id: "player-1" }] })); }), 40, 40),
        life(board((b) => put(b, "battlefield", { ...PYRO_MINE, keywords: ["Lifelink"], tapped: true })), 41, 40), []),
      ["Blue: 40 -> 41 life (+1)"]);
    same("a prevention whose 'If damage is prevented this way' gains life deals nothing back",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 98, [423, "Weird Ward"], "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, you gain that much life.", [PYRO], id(238));
        return [...tableLog(h), ...logOf(h, life(board((b) => { put(b, "battlefield", PYRO, "player-1"); b.stack.push(PYRO_PING); }), 38, 40), life(board((b) => put(b, "battlefield", { ...PYRO, tapped: true }, "player-1")), 39, 39))];
      }),
      ["Blue chooses Prodigal Pyromancer (Weird Ward)", "Prodigal Pyromancer's damage to Blue is prevented (Weird Ward)", "Blue: 38 -> 39 life (+1)", "AI 1: 40 -> 39 life (-1)"]);
    same("a redirect of a ping only when the player it was aimed at lost nothing",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 99, [231, "Reflect Damage"], REFLECT, [PYRO], id(238));
        return [...tableLog(h), ...logOf(h, life(board((b) => { put(b, "battlefield", PYRO, "player-1"); b.stack.push(PYRO_PING); }), 38, 40), life(board((b) => put(b, "battlefield", { ...PYRO, tapped: true }, "player-1")), 37, 39))];
      }),
      ["Blue chooses Prodigal Pyromancer (Reflect Damage)", "Blue: 38 -> 37 life (-1)", "AI 1: 40 -> 39 life (-1)"]);
    same("a spell that taps nothing it targets says no tap: its target tapped by something else",
      between(board((b) => { put(b, "battlefield", BEAR()); b.stack.push({ ...SPL("engine-stack-106", 424, "Weird Surge", "Target creature gets +2/+2 until end of turn. Untap all lands you control."), targets: [{ kind: "card", id: id(1) }] }); }),
        board((b) => { put(b, "battlefield", { ...BEAR(), tapped: true }); put(b, "graveyard", card(424, "Weird Surge", ["Instant"])); }), [ev(11, "Stack", "Graveyard", id(424))]).filter((l) => /taps|untaps/.test(l)),
      []);
    same("a spell granting a quoted 'Counter target spell' ability is no counterspell that did nothing",
      between(board((b) => b.stack.push(SPL("engine-stack-107", 425, "Weird Gift", "Creatures you control gain \"Sacrifice this creature: Counter target spell.\" until end of turn."))),
        board((b) => put(b, "graveyard", card(425, "Weird Gift", ["Instant"]))), [ev(11, "Stack", "Graveyard", id(425))]).filter((l) => /does nothing/.test(l)),
      []);
    same("a counter ability alone on the stack is not said to do nothing (the fizzle line is a spell's)",
      between(board((b) => { put(b, "battlefield", card(426, "Weird Snare", ["Enchantment"])); b.stack.push(TRIG("engine-stack-108", 426, "Weird Snare", "Counter target spell.")); }),
        board((b) => put(b, "battlefield", card(426, "Weird Snare", ["Enchantment"]))), [ev(11, "Hand", "Graveyard", id(399), null, "player-1")]).filter((l) => /does nothing/.test(l)),
      []);
    const SENT_AI = opp(SENTINEL);
    const aiSentinel = (sid) => TRIG(sid, 244, "Esper Sentinel", SENTINEL_TEXT, "player-1", { text: `${SENTINEL_TEXT} [Card: Opt (250), Activator: tts-Blue-ab12, SpellAbility: Opt]` });
    const sentAnswer = (seat, n, v) => { seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: n, sourceAbilityText: SENTINEL_TEXT, sourceCard: { id: id(244), identity: { name: "Esper Sentinel" } }, input: { presentation: { title: "Pay {1}?" }, type: "chooseBoolean" } };
      seat.respond(n, "chooseBoolean", { type: "decision", value: v }); };
    const sentW = (fill) => board((b) => { put(b, "battlefield", SENT_AI, "player-1"); count(b, "library", 50, "player-1"); fill(b); });
    same("Blue's 'Pay {1}?' yes to AI 1's Esper Sentinel, no draw: Blue pays its {X} by its power",
      fresh((h, seat) => { sentAnswer(seat, 110, true); return logOf(h, sentW((b) => b.stack.push(aiSentinel("engine-stack-109"))), sentW(() => {}), CAST_EV); }),
      ["Blue pays {1} (Esper Sentinel)"]);
    same("with no feed for the window, the payer's own answer is all there is: it is said",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 115, sourceAbilityText: MENTOR_TEXT, sourceCard: { id: id(226), identity: { name: "Mentor of the Meek" } }, input: { presentation: { title: "Pay {1}?" }, type: "chooseBoolean" } };
        seat.respond(115, "chooseBoolean", { type: "decision", value: true });
        return logOf(h, mentorBoard((b) => b.stack.push(MENTOR("engine-stack-40"))), mentorBoard(drew), []);
      }),
      ["Blue pays {1} (Mentor of the Meek)", "Blue draws a card"]);
    same("Blue's 'Pay {1}?' no to AI 1's Esper Sentinel and no draw (AI 1's library empty): Blue doesn't pay, the no is the decision",
      fresh((h, seat) => { sentAnswer(seat, 116, false); return logOf(h, sentW((b) => b.stack.push(aiSentinel("engine-stack-109"))), sentW(() => {}), CAST_EV); }),
      ["Blue doesn't pay {1} (Esper Sentinel)"]);
    same("and the yes when AI 1 drew by it (a mandatory draw unless paid): no 'Blue pays'",
      fresh((h, seat) => {
        sentAnswer(seat, 111, true);
        return logOf(h, sentW((b) => b.stack.push(aiSentinel("engine-stack-109"))), sentW((b) => { count(b, "library", 49, "player-1"); count(b, "hand", 1, "player-1"); }),
          [ev(11, "Library", "Hand", null, "draw", "player-1", { cause: "Draw", causeCardId: id(244), causeName: "Esper Sentinel" })]).filter((l) => /pay/.test(l));
      }),
      []);
    same("a 'Pay {1}?' no to Mentor of the Meek, then its draw in the feed: no 'doesn't pay'",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 112, sourceAbilityText: MENTOR_TEXT, sourceCard: { id: id(226), identity: { name: "Mentor of the Meek" } }, input: { presentation: { title: "Pay {1}?" }, type: "chooseBoolean" } };
        seat.respond(112, "chooseBoolean", { type: "decision", value: false });
        return logOf(h, mentorBoard((b) => b.stack.push(MENTOR("engine-stack-40"))), mentorBoard(drew),
          [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(226), causeName: "Mentor of the Meek" })]).filter((l) => /pay/.test(l));
      }),
      []);
    const RAL_ULT = { ...RAL_MINUS, id: "engine-stack-110", sourceAbilityText: "-7: Flip five coins. Target opponent skips their next X turns, where X is the number of coins that came up heads.", targets: [{ id: "player-1", intent: "hostile", kind: "player" }], text: "Ral Zarek (203) - Flip five coins." };
    same("a planeswalker activated to 0 and gone to the graveyard between two boards: its cost by its type",
      between(board(() => {}), board((b) => { put(b, "graveyard", card(201, "Ral Zarek", ["Planeswalker"])); b.stack.push(RAL_ULT); }), [ev(11, "Battlefield", "Graveyard", id(201))]).filter((l) => /Ral Zarek's/.test(l)),
      ["Blue activates Ral Zarek's -7 targeting AI 1: flip five coins"]);
    same("a planeswalker's ability with a mana cost, not a loyalty one, is an ability",
      between(board((b) => put(b, "battlefield", RAL(4))), board((b) => { put(b, "battlefield", RAL(4)); b.stack.push({ ...RAL_ULT, sourceAbilityText: "{1}: Ral Zarek gains hexproof until end of turn.", targets: [] }); }), [])
        .filter((l) => /Ral Zarek's/.test(l)),
      ["Blue uses Ral Zarek's ability: it gains hexproof until end of turn"]);
    same("a planeswalker activated and returned to its owner's hand: its cost by its loyalty last seen",
      between(board((b) => put(b, "battlefield", RAL(4))), board((b) => { count(b, "hand", 1); b.stack.push({ ...RAL_ULT, sourceAbilityText: "-2: Ral Zarek deals 3 damage to any target." }); }), []).filter((l) => /Ral Zarek's/.test(l)),
      ["Blue activates Ral Zarek's -2 targeting AI 1: it deals 3 damage to any target"]);
    // (an activation no board showed on the stack: the pick is its own only when made while activating it)
    const pendingAct = (pickWords, casting) => fresh((h, seat) => {
      const w = (dmg, tapped) => board((b) => { put(b, "battlefield", { ...PYRO_MINE, tapped }); put(b, "battlefield", { ...WURM, ...(dmg ? { damage: dmg } : {}) }, "player-1"); });
      const a = w(0, false);
      seat.board = { state: { gameView: a } };
      h.B.notePlay(seat, { cardId: id(238), id: "prompt-action-41", description: PYRO_T, type: "activateAbility" }, "Prodigal Pyromancer", 3);
      askTargets(seat, PYRO_MINE, pickWords, 114, [id(216)], casting);
      seat.priorityPromptId = 9;
      return logOf(h, a, w(1, true)).filter((l) => /uses/.test(l));
    });
    same("an activation seen only once paid for names the pick made while activating it", pendingAct(PYRO_T, true), ["Blue uses Prodigal Pyromancer's ability targeting Craw Wurm: it deals 1 damage to any target"]);
    same("and not a pick of the card's trigger (no words, not cancellable)", pendingAct(undefined, false), ["Blue uses Prodigal Pyromancer's ability: it deals 1 damage to any target"]);

    // ---- the checker's round 4 (62733b5)
    // (A) one card's triggers merged into one entry, from two opponents' spells: two Activators, no payer said
    same("checker r4: Esper Sentinel's triggers from AI 1's and AI 2's spells in one entry name no payer",
      fresh((h) => {
        const g = h.B._getGame(); g.playerOrder.push("self-hosted-node-78-bot"); g.slotNames["player-2"] = "AI 2"; g.slotColor["player-2"] = "Red"; g.total = 3; g.bots = 2;
        const ESP = { ...SENTINEL, power: "1" };
        const w = (fill) => board((b) => { put(b, "battlefield", ESP); count(b, "library", 50); fill(b); });
        return logOf(h, w((b) => b.stack.push(TRIG("engine-stack-91", 244, "Esper Sentinel", SENTINEL_TEXT, "player-0", { text: `${SENTINEL_TEXT} [Card: Opt (421), Activator: ${ACT}, SpellAbility: Opt]` }),
            TRIG("engine-stack-92", 244, "Esper Sentinel", SENTINEL_TEXT, "player-0", { text: `${SENTINEL_TEXT} [Card: Shock (422), Activator: self-hosted-node-78-bot, SpellAbility: Shock]` }))),
          w(drew), [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(244), causeName: "Esper Sentinel" })]);
      }),
      ["Blue draws a card"]);
    same("and two from one opponent's spells in one entry: that opponent, once each",
      between(watchers((b) => b.stack.push(UNLESS("engine-stack-26", 1, "Esper Sentinel", SENTINEL_TEXT, 244), UNLESS("engine-stack-25", 1, "Esper Sentinel", SENTINEL_TEXT, 244))), watchers(drew),
        [ev(11, "Library", "Hand", null, "draw", "player-0", { cause: "Draw", causeCardId: id(244), causeName: "Esper Sentinel" })]).filter((l) => /pay/.test(l)),
      ["AI 1 doesn't pay {1} (Esper Sentinel)", "AI 1 pays {1} (Esper Sentinel)"]);
    // (B) each sub-ability's targets asked apart, from 0 each: Arc Trail's two, Decimate's four
    const ARC_REAL = "Arc Trail deals 2 damage to any target and 1 damage to any other target.";
    const ARC_C = { ...card(423, "Arc Trail", ["Sorcery"]), text: ARC_REAL }, ELVES = opp(card(424, "Llanowar Elves", ["Creature"]));
    const arcCtx = (fill) => board((b) => { put(b, "battlefield", opp(BEAR()), "player-1"); put(b, "battlefield", ELVES, "player-1"); fill(b); });
    same("checker r4: Arc Trail's two target prompts, each its sub-ability's: both targets named",
      fresh((h, seat) => {
        const a = arcCtx((b) => put(b, "hand", ARC_C));
        seat.board = { state: { gameView: a } };
        pendingPick(seat, h, ARC_C, ARC_REAL, 120, [id(1), id(424)]);
        return logOf(h, a, arcCtx((b) => b.stack.push(SPL("engine-stack-93", 423, "Arc Trail", ARC_REAL))));
      }),
      ["Blue casts Arc Trail targeting Grizzly Bears and Llanowar Elves"]);
    same("and the same cast unseen on any stack names both too",
      fresh((h, seat) => {
        const a = arcCtx((b) => put(b, "hand", ARC_C));
        seat.board = { state: { gameView: a } };
        pendingPick(seat, h, ARC_C, ARC_REAL, 122, [id(1), id(424)]);
        return logOf(h, a, board((b) => { put(b, "graveyard", ARC_C); put(b, "graveyard", opp(BEAR()), "player-1"); put(b, "graveyard", ELVES, "player-1"); }),
          [ev(11, "Stack", "Graveyard", id(423)), ev(12, "Battlefield", "Graveyard", id(1), "destroyed", "player-1"), ev(13, "Battlefield", "Graveyard", id(424), "destroyed", "player-1")]).filter((l) => /casts/.test(l));
      }),
      ["Blue casts Arc Trail targeting Grizzly Bears and Llanowar Elves"]);
    same("a trigger's two picks with no words are no casting picks: the second does not add to the first",
      fresh((h, seat) => {
        askTargets(seat, ARC_C, undefined, 124, [id(1), id(424)], false);
        const p = h.B._getGame().picked.get(id(423));
        return p.ids;
      }),
      ["card|engine-card-424"]);
    same("a trigger's pick, then a casting one with the same words: the casting pick alone",
      fresh((h, seat) => {
        askTargets(seat, ARC_C, ARC_REAL, 160, [id(1)], false);
        askTargets(seat, ARC_C, ARC_REAL, 161, [id(424)], true);
        const p = h.B._getGame().picked.get(id(423));
        return [p.ids, p.casting];
      }),
      [["card|engine-card-424"], true]);
    same("a casting pick, then a trigger's with the same (no) words: the trigger's alone, no casting pick left",
      fresh((h, seat) => {
        const aura = card(425, "Pacifism", ["Enchantment"]);
        askTargets(seat, aura, undefined, 162, [id(1)], true);
        askTargets(seat, aura, undefined, 163, [id(424)], false);
        const p = h.B._getGame().picked.get(id(425));
        return [p.ids, p.casting];
      }),
      [["card|engine-card-424"], false]);
    same("two casting picks of one card with different words (two of its abilities): the second alone",
      fresh((h, seat) => {
        askTargets(seat, ARC_C, "{1}: Tap target creature.", 164, [id(1)], true);
        askTargets(seat, ARC_C, "{2}: Destroy target creature.", 165, [id(424)], true);
        return h.B._getGame().picked.get(id(423)).ids;
      }),
      ["card|engine-card-424"]);
    // (a cost's sacrifice, asked as board targets with intent "sacrifice", is no target)
    const SPLINTERS_T = "Destroy target creature.";
    same("a sacrifice for a spell's cost, asked as board targets, is not named as its target",
      fresh((h, seat) => {
        const bs = { ...card(428, "Bone Splinters", ["Sorcery"]), text: `As an additional cost to cast this spell, sacrifice a creature.\n${SPLINTERS_T}` };
        const a = board((b) => { put(b, "hand", bs); put(b, "battlefield", ELF([])); put(b, "battlefield", opp(BEAR()), "player-1"); });
        seat.board = { state: { gameView: a } };
        pendingPick(seat, h, bs, SPLINTERS_T, 126, id(1));
        askTargets(seat, bs, SPLINTERS_T, 127, [id(390)], true, { intent: "sacrifice", presentation: { title: "Sacrifice" } });
        return logOf(h, a, board((b) => { b.stack.push(SPL("engine-stack-111", 428, "Bone Splinters", SPLINTERS_T)); put(b, "graveyard", ELF([])); put(b, "battlefield", opp(BEAR()), "player-1"); }),
          [ev(11, "Battlefield", "Graveyard", id(390), "sacrificed", "player-0", { cause: "Cost:Sacrifice", causeCardId: id(428), causeName: "Bone Splinters" })]).filter((l) => /casts/.test(l));
      }),
      ["Blue casts Bone Splinters targeting Grizzly Bears"]);
    // (an edict's target prompt has intent "sacrifice" too, from its api, but asks for a player: publishTargetPrompt's
    // "Choose player to sacrifice"; the victim's choice of what to sacrifice is publishSacrificePrompt's, "Sacrifice",
    // only cards, and is no target. Checker round 5, r4-edict-target)
    const EDICT_T = "Target player sacrifices a creature.";
    const EDICT = { ...card(429, "Diabolic Edict", ["Instant"]), text: EDICT_T };
    const edictAsk = (seat, c, n, words, casting = true) => {
      seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: n, sourceAbilityText: words, sourceCard: { id: c.id, identity: c.identity },
        input: { type: "chooseBoardTargets", cancellable: casting, candidates: [{ id: "player-0", kind: "player" }, { id: "player-1", kind: "player" }], chosenTargets: 0, hostile: true,
          intent: "sacrifice", minTargets: 1, maxTargets: 1, presentation: { title: "Choose player to sacrifice" } } };
      seat.respond(n, "chooseBoardTargets", { type: "boardTargets", chosen: [{ kind: "player", id: "player-1" }] });
    };
    const victimSacs = (seat, c, n, words) => {
      seat.lastRawPrompt = { decidingPlayerId: "player-1", promptId: n, sourceAbilityText: words, sourceCard: { id: c.id, identity: c.identity },
        input: { type: "chooseBoardTargets", cancellable: false, candidates: [{ id: id(1), kind: "card" }], chosenTargets: 0, hostile: true,
          intent: "sacrifice", minTargets: 1, maxTargets: 1, presentation: { title: "Sacrifice" } } };
      seat.respond(n, "chooseBoardTargets", { type: "boardTargets", chosen: [{ kind: "card", id: id(1) }] });
    };
    same("checker r5: Diabolic Edict cast and gone before any board names the player it targeted, not the victim's pick",
      fresh((h, seat) => {
        const a = board((b) => { put(b, "hand", EDICT); put(b, "battlefield", opp(BEAR()), "player-1"); });
        seat.board = { state: { gameView: a } };
        h.B.notePlay(seat, { cardId: EDICT.id, id: "prompt-action-170", label: "Cast Diabolic Edict", mode: { type: "normal" }, type: "cast" }, "Diabolic Edict", 0);
        edictAsk(seat, EDICT, 170, EDICT_T);
        victimSacs(seat, EDICT, 171, EDICT_T);
        return logOf(h, a, board((b) => { put(b, "graveyard", EDICT); put(b, "graveyard", opp(BEAR()), "player-1"); }),
          [ev(11, "Stack", "Graveyard", id(429)), ev(12, "Battlefield", "Graveyard", id(1), "sacrificed", "player-1", { cause: "Sacrifice", causeCardId: id(429), causeName: "Diabolic Edict" })]).filter((l) => /casts/.test(l));
      }),
      ["Blue casts Diabolic Edict targeting AI 1"]);
    same("and Diabolic Edict seen on the stack names it too",
      fresh((h, seat) => {
        const a = board((b) => { put(b, "hand", EDICT); put(b, "battlefield", opp(BEAR()), "player-1"); });
        seat.board = { state: { gameView: a } };
        h.B.notePlay(seat, { cardId: EDICT.id, id: "prompt-action-172", label: "Cast Diabolic Edict", mode: { type: "normal" }, type: "cast" }, "Diabolic Edict", 0);
        edictAsk(seat, EDICT, 172, EDICT_T);
        return logOf(h, a, board((b) => { put(b, "battlefield", opp(BEAR()), "player-1"); b.stack.push(SPL("engine-stack-113", 429, "Diabolic Edict", EDICT_T)); })).filter((l) => /casts/.test(l));
      }),
      ["Blue casts Diabolic Edict targeting AI 1"]);
    same("and Liliana of the Veil's -2 names the player it targets",
      fresh((h, seat) => {
        const LIL_T = "-2: Target player sacrifices a creature.";
        const lil = { ...card(430, "Liliana of the Veil", ["Planeswalker"]), counters: { Loyalty: 3 } };
        const a = board((b) => { put(b, "battlefield", lil); put(b, "battlefield", opp(BEAR()), "player-1"); });
        seat.board = { state: { gameView: a } };
        h.B.notePlay(seat, { cardId: lil.id, id: "prompt-action-173", description: LIL_T, type: "activateAbility" }, "Liliana of the Veil", 0);
        edictAsk(seat, lil, 173, LIL_T);
        return logOf(h, a, board((b) => { put(b, "battlefield", { ...lil, counters: { Loyalty: 1 } }); put(b, "battlefield", opp(BEAR()), "player-1");
          b.stack.push(SPL("engine-stack-114", 430, "Liliana of the Veil", LIL_T)); })).filter((l) => /Liliana/.test(l));
      }),
      ["Blue activates Liliana of the Veil's -2 (loyalty 3 -> 1) targeting AI 1: target player sacrifices a creature"]);
    same("a victim's choice of what to sacrifice, alone, is no pick",
      fresh((h, seat) => {
        victimSacs(seat, EDICT, 174, EDICT_T);
        return h.B._getGame().picked?.has(EDICT.id) ?? false;
      }),
      false);
    // (C) a permanent spell's cast pick has no words: an Aura's target, unseen or on the stack
    const PAC = { ...card(425, "Pacifism", ["Enchantment"]), text: "Enchant creature\nEnchanted creature can't attack or block." };
    same("checker r4: Pacifism cast and resolved before any board names what it targeted",
      fresh((h, seat) => {
        const a = board((b) => { put(b, "hand", PAC); put(b, "battlefield", opp(BEAR()), "player-1"); });
        seat.board = { state: { gameView: a } };
        pendingPick(seat, h, PAC, undefined, 130, id(1));
        return logOf(h, a, board((b) => { put(b, "battlefield", { ...PAC, attachedTo: id(1) }); put(b, "battlefield", opp(BEAR()), "player-1"); }), [ev(11, "Stack", "Battlefield", id(425))]).filter((l) => /casts/.test(l));
      }),
      ["Blue casts Pacifism targeting Grizzly Bears"]);
    same("checker r4: Pacifism seen on the stack names what it targets",
      fresh((h, seat) => {
        const a = board((b) => { put(b, "hand", PAC); put(b, "battlefield", opp(BEAR()), "player-1"); });
        seat.board = { state: { gameView: a } };
        pendingPick(seat, h, PAC, undefined, 140, id(1));
        const st = { controllerId: "player-0", id: "engine-stack-94", identity: { name: "Pacifism", isToken: false }, isPermanentSpell: true, ownerId: "player-0", sourceId: id(425), targets: [], text: "Pacifism - Enchant creature" };
        return logOf(h, a, board((b) => { put(b, "battlefield", opp(BEAR()), "player-1"); b.stack.push(st); }));
      }),
      ["Blue casts Pacifism targeting Grizzly Bears"]);
    same("and a wordless pick not made while casting (a trigger's) names nothing on a permanent spell on the stack",
      fresh((h, seat) => {
        askTargets(seat, PAC, undefined, 142, [id(1)], false);
        const st = { controllerId: "player-0", id: "engine-stack-94", identity: { name: "Pacifism", isToken: false }, isPermanentSpell: true, ownerId: "player-0", sourceId: id(425), targets: [], text: "Pacifism - Enchant creature" };
        return logOf(h, board((b) => put(b, "battlefield", opp(BEAR()), "player-1")), board((b) => { put(b, "battlefield", opp(BEAR()), "player-1"); b.stack.push(st); }));
      }),
      ["Blue casts Pacifism"]);
    // (an instant whose prompt words are Forge's, not its Oracle text: Into the Roil's, without its kicker line)
    const ROIL_PROMPT = "Return target nonland permanent to its owner's hand. If this spell was kicked, draw a card.";
    same("checker r4: Into the Roil cast and resolved before any board names its target (Forge's words, not the Oracle's)",
      fresh((h, seat) => {
        const roil = { ...card(426, "Into the Roil", ["Instant"]), text: `Kicker {1}{U} (You may pay an additional {1}{U} as you cast this spell.)\n${ROIL_PROMPT}` };
        const a = board((b) => { put(b, "hand", roil); put(b, "battlefield", GIANT(), "player-1"); });
        seat.board = { state: { gameView: a } };
        pendingPick(seat, h, roil, ROIL_PROMPT, 150, id(229));
        return logOf(h, a, board((b) => { put(b, "graveyard", roil); put(b, "hand", GIANT(), "player-1"); }),
          [ev(11, "Stack", "Graveyard", id(426)), ev(12, "Battlefield", "Hand", id(229), null, "player-1")]).filter((l) => /casts/.test(l));
      }),
      ["Blue casts Into the Roil targeting Hill Giant"]);

    // ── suite review of the merge, 2026-11-09: a line the boards can't back is left bare ──
    // (blocks: an attacker is unblocked only once the blocks are known; review B #1)
    const WALL = (extra = {}) => ({ ...card(414, "Wall of Stone", ["Creature"]), power: "0", ...extra });
    const giantAt = (step, giant, wall) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", giant, "player-1"); put(b, "battlefield", wall); }), 38, 40);
    same("suite: a Circle's attacker blocked where no board shows the blocks isn't 'prevented'",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 76, [412, "Circle of Protection: Red"], COP, [GIANT()], id(229));
        return [...tableLog(h), ...logOf(h, giantAt("combatDeclareAttackers", HG(), WALL()), giantAt("main2", GIANT({ tapped: true }), WALL({ damage: 3 })))];
      }),
      ["Blue chooses Hill Giant (Circle of Protection: Red)"]);
    same("suite: and with no shield, a loss across blocks no board showed names no attacker",
      fresh((h) => logOf(h, giantAt("combatDeclareAttackers", HG(), WALL()), (() => { const b = giantAt("main2", GIANT({ tapped: true }), WALL()); b.players[0].life = 35; return b; })())),
      ["Blue: 38 -> 35 life (-3)"]);
    same("suite: nor one the player blocked on the board that asked the blocks, which shows none",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 77, [412, "Circle of Protection: Red"], COP, [GIANT()], id(229));
        const a = giantAt("combatDeclareBlockers", HG(), WALL());
        seat.board = { state: { gameView: a } };
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 78, input: { type: "chooseBlockers" } };
        seat.respond(78, "chooseBlockers", { type: "declareBlockers", assignments: [{ attackerId: id(229), blockerId: id(414) }] });
        return [...tableLog(h), ...logOf(h, a, giantAt("main2", GIANT({ tapped: true }), WALL({ damage: 3 })))];
      }),
      ["Blue chooses Hill Giant (Circle of Protection: Red)"]);
    same("suite: an unblocked one, on the board that asked the blocks, is still 'prevented'",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 79, [412, "Circle of Protection: Red"], COP, [GIANT()], id(229));
        const a = giantAt("combatDeclareBlockers", HG(), WALL());
        seat.board = { state: { gameView: a } };
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 80, input: { type: "chooseBlockers" } };
        seat.respond(80, "chooseBlockers", { type: "declareBlockers", assignments: [] });
        return [...tableLog(h), ...logOf(h, a, giantAt("main2", GIANT({ tapped: true }), WALL()))];
      }),
      ["Blue chooses Hill Giant (Circle of Protection: Red)", "Hill Giant's combat damage to Blue is prevented (Circle of Protection: Red)"]);
    same("suite: blocks declared on an earlier turn block nothing now",
      fresh((h, seat) => {
        const old = giantAt("combatDeclareBlockers", HG(), WALL()); old.turn = 1;
        seat.board = { state: { gameView: old } };
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 81, input: { type: "chooseBlockers" } };
        seat.respond(81, "chooseBlockers", { type: "declareBlockers", assignments: [{ attackerId: id(229), blockerId: id(414) }] });
        SOURCE_PICK(seat, 82, [412, "Circle of Protection: Red"], COP, [GIANT()], id(229));
        return logOf(h, giantAt("combatDeclareBlockers", HG(), WALL()), giantAt("main2", GIANT({ tapped: true }), WALL()));
      }),
      ["Hill Giant's combat damage to Blue is prevented (Circle of Protection: Red)"]);
    // (Deflecting Palm's damage back in combat: the attacker's power on both boards, else bare; review A #2)
    const PALM = "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, Deflecting Palm deals that much damage to that source's controller.";
    same("suite: Deflecting Palm's combat damage back is said while the attacker's power is the same on both boards",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 83, [260, "Deflecting Palm"], PALM, [GIANT()], id(229));
        const at = (step, ai, pw) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", HG({ power: pw }), "player-1"); }), 38, ai);
        return logOf(h, at("combatDeclareBlockers", 40, "3"), at("combatDamage", 37, "3"));
      }),
      ["Hill Giant's combat damage to Blue is prevented (Deflecting Palm)", "Deflecting Palm deals 3 damage to AI 1", "AI 1: 40 -> 37 life (-3, damage from Deflecting Palm)"]);
    same("suite: and not with a pump between the boards (a Giant Growth: 6 back, the board before says 3)",
      fresh((h, seat) => {
        SOURCE_PICK(seat, 84, [260, "Deflecting Palm"], PALM, [GIANT()], id(229));
        const at = (step, ai, pw) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", HG({ power: pw }), "player-1"); }), 38, ai);
        return logOf(h, at("combatDeclareBlockers", 40, "3"), at("combatDamage", 34, "6")).filter((l) => /Deflecting Palm deals/.test(l));
      }),
      []);
    // (a pain land's damage by the shared reading: none under a condition; review A #1, B #5)
    const TOMB = { ...card(207, "Tomb of Urami", ["Land"]), text: "{T}: Add {B}. Tomb of Urami deals 1 damage to you if you don't control an Ogre." };
    same("suite: Tomb of Urami's tap names nothing on a loss beside it (its damage is under a condition)",
      fresh((h, seat) => {
        const before = life(board((b) => put(b, "battlefield", TOMB)), 38, 40);
        seat.board = { state: { gameView: before } };
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 23, input: { type: "chooseAction", actions: [
          { abilityIndex: 0, cardId: id(207), cost: "{T}", description: "Tomb of Urami", id: "tap:engine-card-207:0", isManaAbility: true, producedMana: [{ amount: 1, color: "B" }], type: "activateAbility" }] } };
        seat.respond(23, "chooseAction", { type: "act", actionId: "tap:engine-card-207:0" });
        return logOf(h, before, life(board((b) => put(b, "battlefield", { ...TOMB, tapped: true })), 37, 40));
      }),
      ["Blue: 38 -> 37 life (-1)"]);
    // (a pain tap is used by the first board that shows the land tapped: a board logged from before the tap keeps it; review B #4)
    same("suite: a pain tap waits for the board that shows its land tapped",
      fresh((h, seat) => {
        const before = life(board((b) => put(b, "battlefield", WASTES)), 38, 40);
        seat.board = { state: { gameView: before } };
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 24, input: { type: "chooseAction", actions: [
          { cardId: id(202), cost: "{T}", description: "{T}: Add {W} or {U}. Adarkar Wastes deals 1 damage to you.", id: "tap:w", isManaAbility: true, producedMana: [{ amount: 1, color: "W" }], type: "activateAbility" }] } };
        seat.respond(24, "chooseAction", { type: "act", actionId: "tap:w" });
        const stale = life(board((b) => put(b, "battlefield", WASTES)), 37, 40);
        return [...logOf(h, before, stale), ...logOf(h, stale, life(board((b) => put(b, "battlefield", { ...WASTES, tapped: true })), 36, 40))];
      }),
      ["Blue: 38 -> 37 life (-1)", "Blue: 37 -> 36 life (-1, damage from Adarkar Wastes)"]);
    same("suite: and a board without the land drops it",
      fresh((h, seat) => {
        const before = life(board((b) => put(b, "battlefield", WASTES)), 38, 40);
        seat.board = { state: { gameView: before } };
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 25, input: { type: "chooseAction", actions: [
          { cardId: id(202), cost: "{T}", description: "{T}: Add {W} or {U}. Adarkar Wastes deals 1 damage to you.", id: "tap:w", isManaAbility: true, producedMana: [{ amount: 1, color: "W" }], type: "activateAbility" }] } };
        seat.respond(25, "chooseAction", { type: "act", actionId: "tap:w" });
        const gone = life(board(() => {}), 38, 40);
        return [...logOf(h, before, gone), ...logOf(h, gone, life(board((b) => put(b, "battlefield", { ...WASTES, tapped: true })), 37, 40))].filter((l) => /life/.test(l));
      }),
      ["Blue: 38 -> 37 life (-1)"]);
    // (a "you may pay" yes with no feed for the window and no card drawn may be a failed payment: not said; review B #6)
    same("suite: with no feed, a 'Pay {1}?' yes and nothing drawn isn't 'pays'",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 117, sourceAbilityText: MENTOR_TEXT, sourceCard: { id: id(226), identity: { name: "Mentor of the Meek" } }, input: { presentation: { title: "Pay {1}?" }, type: "chooseBoolean" } };
        seat.respond(117, "chooseBoolean", { type: "decision", value: true });
        return logOf(h, mentorBoard((b) => b.stack.push(MENTOR("engine-stack-40"))), mentorBoard(() => {}), []).filter((l) => /pay/.test(l));
      }),
      []);
    // ({X} by the source's own power only when the words name it: "enchanted creature's power" is another card's; review A #3)
    const AURA_TEXT = "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is enchanted creature's power.";
    const AURA = { ...card(246, "Watchful Aura", ["Enchantment", "Creature"]), power: "3" };
    const auraW = (fill = () => {}) => board((b) => { put(b, "battlefield", AURA); count(b, "library", 50); fill(b); });
    same("suite: an {X} by another card's power stays {X}",
      between(auraW((b) => b.stack.push(UNLESS("engine-stack-28", 1, "Watchful Aura", AURA_TEXT, 246))), auraW(), CAST_EV),
      ["AI 1 pays {X} (Watchful Aura)"]);
    same("suite: and Esper Sentinel's, by its own name, is its power",
      between(watchers((b) => b.stack.push(UNLESS("engine-stack-26", 1, "Esper Sentinel", SENTINEL_TEXT, 244))), watchers(), CAST_EV),
      ["AI 1 pays {1} (Esper Sentinel)"]);
    // (a source the boards show with no name, face down: no power is read for it, and nothing breaks)
    // (a throw is returned as a line, so the check fails by its name and the checks after it still run)
    same("suite: an {X} trigger from a source with no name stays {X}",
      (() => { try {
        return between(board((b) => { put(b, "battlefield", { ...AURA, identity: {} }); count(b, "library", 50); b.stack.push(UNLESS("engine-stack-29", 1, "Watchful Aura", SENTINEL_TEXT, 246)); }),
          board((b) => { put(b, "battlefield", { ...AURA, identity: {} }); count(b, "library", 50); }), CAST_EV);
      } catch (e) { return [`threw: ${e.message}`]; } })(),
      ["AI 1 pays {X} (Watchful Aura)"]);
    // (an answer of no yes-or-no shape is no answer; review B #10)
    same("suite: a chooseBoolean answer with no true or false isn't kept",
      fresh((h, seat) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: 118, sourceAbilityText: MENTOR_TEXT, sourceCard: { id: id(226), identity: { name: "Mentor of the Meek" } }, input: { presentation: { title: "Pay {1}?" }, type: "chooseBoolean" } };
        seat.respond(118, "chooseBoolean", { type: "decision" });
        return h.B._getGame().answers?.get(id(226)) ?? null;
      }),
      null);
    // (the only counterspell resolved, but an ability that counters resolved beside it: either may have; review B #7)
    const PRODIGY_AB = { controllerId: "player-1", id: "engine-stack-22", identity: { name: "Voidmage Prodigy" }, isPermanentSpell: false, ownerId: "player-1",
      sourceAbilityText: "Sacrifice a Wizard: Counter target spell.", sourceId: id(241), targets: [], text: "Voidmage Prodigy (241) - Counter target spell." };
    const CS_AI = { ...CS, controllerId: "player-1", ownerId: "player-1" };
    const marbleGone = () => board((b) => { put(b, "graveyard", opp(card(229, "Marble Diamond", ["Artifact"])), "player-1"); put(b, "graveyard", opp(card(240, "Counterspell", ["Instant"])), "player-1"); put(b, "battlefield", opp(card(241, "Voidmage Prodigy", ["Creature"])), "player-1"); });
    const marbleEv = [ev(11, "Stack", "Graveyard", id(229), null, "player-1"), ev(12, "Stack", "Graveyard", id(240), null, "player-1")];
    same("suite: a spell countered with a Counterspell and a counter ability resolved together names neither",
      between(board((b) => { put(b, "battlefield", opp(card(241, "Voidmage Prodigy", ["Creature"])), "player-1"); b.stack.push(MARBLE, CS_AI, PRODIGY_AB); }), marbleGone(), marbleEv).filter((l) => /countered/.test(l)),
      ["Marble Diamond is countered"]);
    same("suite: and with the Counterspell alone, it names it",
      between(board((b) => { put(b, "battlefield", opp(card(241, "Voidmage Prodigy", ["Creature"])), "player-1"); b.stack.push(MARBLE, CS_AI); }), marbleGone(), marbleEv).filter((l) => /countered/.test(l)),
      ["Marble Diamond is countered by Counterspell"]);

    // Kykar re-test 2026-11-09 (docs/HAND-TEST-KYKAR.md "Re-test", bridge log and tts-stream of that game)
    // #12 again, the engine's real shape: a battlefield card's ownerId is its controller's (InteractiveSnapshotExtractor),
    // Forge's event the true owner
    same("re-test #12: AI 1's Serra Angel on Blue's battlefield (ownerId Blue's, as Forge sends it) goes to AI 1's library",
      between(board((b) => put(b, "battlefield", { ...card(301, "Serra Angel", ["Creature"]), ownerId: "player-0" })), board(() => {}),
        [ev(11, "Battlefield", "Library", id(301), null, "player-1", { cause: "ChangeZone", causeCardId: id(302), causeName: "Chaos Warp" })]),
      ["Serra Angel is put into AI 1's library (Chaos Warp)"]);
    // new bug 9: the owner by where it was seen before, with no feed: Assimilate the Wounded's Grizzly Bears out of AI 1's
    // graveyard onto Blue's battlefield, then bounced to AI 1's hand
    same("re-test bug 9: a card stolen from a graveyard keeps its owner on the battlefield, and returns to that hand",
      fresh((h) => {
        const inGy = board((b) => { put(b, "graveyard", opp(card(303, "Grizzly Bears", ["Creature"])), "player-1"); count(b, "hand", 3, "player-1"); });
        const onBf = board((b) => { put(b, "battlefield", { ...card(303, "Grizzly Bears", ["Creature"]), ownerId: "player-0" }); count(b, "hand", 3, "player-1"); });
        const back = board((b) => count(b, "hand", 4, "player-1"));
        logOf(h, inGy, onBf, null);
        return logOf(h, onBf, back, null).filter((l) => /Grizzly/.test(l));
      }),
      ["Grizzly Bears returns to AI 1's hand"]);
    // new bug 9 / #12: and seen on the stack first (its source's owner), a stolen card's status says whose it is
    same("re-test bug 9: a card first seen on the battlefield keeps what it showed first",
      fresh((h) => {
        h.B.logSnapshot(board((b) => put(b, "battlefield", opp({ ...card(304, "Hill Giant", ["Creature"]), ownerId: "player-1" }), "player-1")));
        h.B.logSnapshot(board((b) => put(b, "battlefield", { ...card(304, "Hill Giant", ["Creature"]), ownerId: "player-0" })));
        return h.B._getGame().owners?.get(id(304)) ?? null;
      }),
      "player-1");
    same("re-test bug 9: a card seen in its owner's graveyard is theirs, whatever the battlefield said before",
      fresh((h) => {
        h.B.logSnapshot(board((b) => put(b, "battlefield", { ...card(305, "Hill Giant", ["Creature"]), ownerId: "player-0" })));
        h.B.logSnapshot(board((b) => put(b, "graveyard", opp(card(305, "Hill Giant", ["Creature"])), "player-1")));
        h.B.logSnapshot(board((b) => put(b, "battlefield", { ...card(305, "Hill Giant", ["Creature"]), ownerId: "player-0" })));
        return h.B._getGame().owners?.get(id(305)) ?? null;
      }),
      "player-1");
    // (verify 2026-11-09: the owner from a stack item and from Forge's event, over a battlefield seen first)
    same("verify: a stolen card's ability on the stack names its owner",
      fresh((h) => {
        h.B.logSnapshot(board((b) => { put(b, "battlefield", { ...card(306, "Prodigal Pyromancer", ["Creature"]), ownerId: "player-0" });
          b.stack.push({ controllerId: "player-0", id: "engine-stack-97", identity: { name: "Prodigal Pyromancer" }, ownerId: "player-1", sourceId: id(306), sourceAbilityText: "{T}: Prodigal Pyromancer deals 1 damage to any target.", targets: [], text: "Prodigal Pyromancer (306) - deals 1 damage" }); }));
        return h.B._getGame().owners?.get(id(306)) ?? null;
      }),
      "player-1");
    same("verify: and Forge's event names it",
      fresh((h) => {
        h.B.logSnapshot(Object.assign(board((b) => put(b, "battlefield", { ...card(307, "Hill Giant", ["Creature"]), ownerId: "player-0" })),
          { events: [ev(11, "Graveyard", "Battlefield", id(307), null, "player-1")] }));
        return h.B._getGame().owners?.get(id(307)) ?? null;
      }),
      "player-1");
    same("verify: a stolen card says whose it is (Owned by)",
      fresh((h) => {
        h.B._getGame().owners = new Map([[id(308), "player-1"]]);
        return (h.B.tableCard({ ...card(308, "Serra Angel", ["Creature"]), ownerId: "player-0" }, { zone: "battlefield" }).kw || []).filter((k) => /^Owned by/.test(k));
      }),
      ["Owned by AI 1"]);
    // #6 again: Reflect Damage, Deflecting Palm and a Circle on one combat's damage, the "which applies first?" question in
    // the middle of it: the first board of the damage step shows no loss yet, the next the whole of it (bridge log 15:00 run)
    {
      const ATK = (n, name, power) => opp({ ...card(n, name, ["Creature"]), power: String(power), isAttacking: true, attackingPlayerId: "player-0", attackTargetId: "player-0", tapped: true });
      const PALM = "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, Deflecting Palm deals that much damage to that source's controller.";
      const combat = (step, a, c) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", ATK(229, "Hill Giant", 3), "player-1"); put(b, "battlefield", ATK(1, "Grizzly Bears", 2), "player-1"); put(b, "battlefield", ATK(311, "Gray Ogre", 2), "player-1"); }), a, c);
      const shields = (seat) => {
        SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
        SOURCE_PICK(seat, 62, [260, "Deflecting Palm"], PALM, [opp(BEAR())], id(1));
        SOURCE_PICK(seat, 63, [237, "Circle of Protection: Red"], COP, [opp(card(311, "Gray Ogre", ["Creature"]))], id(311));
      };
      // (Forge's "Choose" over the shields' sentences, answered on the damage board: the question that splits the damage)
      const REFLECT_L = "The next time a source of your choice would deal damage this turn, that damage is dealt to that source's controller instead.";
      const ORDER = (h, seat, gv, labels = [REFLECT_L, "The next time the chosen source deals damage to you, prevent that damage."], choice = "0") => {
        seat.board = { state: { gameView: gv } };
        h.B.onPrompt(seat, { promptId: 990, decidingPlayerId: "player-0", input: { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, options: labels.map((label) => ({ label })) } });
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 990, choice: [choice] }) });
      };
      // (the two boards of the damage step with the question answered between them; c: the second board)
      const split = (h, seat, c, first = combat("combatDamage", 38, 378)) => {
        const a = combat("combatDeclareBlockers", 38, 378);
        const l1 = logOf(h, a, first);
        ORDER(h, seat, first);
        return [...l1, ...logOf(h, first, c)];
      };
      same("re-test #6: a redirect and Palm's damage back said on the board that shows them, after a question in the damage",
        fresh((h, seat) => { shields(seat); return split(h, seat, combat("combatDamage", 38, 373)); }),
        ["Grizzly Bears' combat damage to Blue is prevented (Deflecting Palm)", "Gray Ogre's combat damage to Blue is prevented (Circle of Protection: Red)",
          "Hill Giant's combat damage is dealt to AI 1 instead (Reflect Damage)", "Deflecting Palm deals 2 damage to AI 1",
          "AI 1: 378 -> 373 life (-5, damage from Hill Giant, redirected by Reflect Damage; damage from Deflecting Palm)"]);
      // (merge 2026-11-09: the real game's two questions, tmp/table-log.log 16:00:15: #317 "Choose" over the three shields'
      // sentences, answered Reflect Damage first, then #318 over the two preventions, answered Circle of Protection: Red
      // first; the last answer is the step's orderAnswer)
      same("merge: the real #6 order, two questions (Reflect Damage first, then the Circle), still says the redirect",
        fresh((h, seat) => {
          shields(seat);
          const PALM_L = "The next time the chosen source deals damage to you, prevent that damage.", COP_RL = "The next time the chosen red source deals damage to you, prevent that damage.";
          const a = combat("combatDeclareBlockers", 38, 378), b = combat("combatDamage", 38, 378);
          const l1 = logOf(h, a, b);
          seat.board = { state: { gameView: b } };
          h.B.onPrompt(seat, { promptId: 317, decidingPlayerId: "player-0", input: { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, options: [REFLECT_L, COP_RL, PALM_L].map((label) => ({ label })) } });
          const titled = seat.prompt?.ui?.title;
          const named = (seat.prompt?.ui?.options || []).map((o) => o.label.slice(0, o.label.indexOf(": The next")));
          h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 317, choice: ["0"] }) });
          const firstAfter317 = h.B._getGame().orderAnswer?.first;
          h.B.onPrompt(seat, { promptId: 318, decidingPlayerId: "player-0", input: { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, options: [COP_RL, PALM_L].map((label) => ({ label })) } });
          h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 318, choice: ["0"] }) });
          return [titled, ...named, firstAfter317, h.B._getGame().orderAnswer?.first, ...l1, ...logOf(h, b, combat("combatDamage", 38, 373))];
        }),
        ["Which applies first?", "Reflect Damage", "Circle of Protection: Red", "Deflecting Palm", "Reflect Damage", "Circle of Protection: Red",
          "Grizzly Bears' combat damage to Blue is prevented (Deflecting Palm)", "Gray Ogre's combat damage to Blue is prevented (Circle of Protection: Red)",
          "Hill Giant's combat damage is dealt to AI 1 instead (Reflect Damage)", "Deflecting Palm deals 2 damage to AI 1",
          "AI 1: 378 -> 373 life (-5, damage from Hill Giant, redirected by Reflect Damage; damage from Deflecting Palm)"]);
      same("re-test #6: the question was answered (precondition of the cases below)",
        fresh((h, seat) => { shields(seat); split(h, seat, combat("combatDamage", 38, 378)); return h.B._getGame().orderAnswer; }),
        { turn: 3, step: "combatDamage", first: "Reflect Damage" });
      same("re-test #6: a later loss that isn't all of it stays bare",
        fresh((h, seat) => { shields(seat); return split(h, seat, combat("combatDamage", 38, 374)).filter((l) => /AI 1/.test(l)); }),
        ["AI 1: 378 -> 374 life (-4)"]);
      same("verify: nor one of more than all of it",
        fresh((h, seat) => { shields(seat); return split(h, seat, combat("combatDamage", 38, 372)).filter((l) => /AI 1/.test(l)); }),
        ["AI 1: 378 -> 372 life (-6)"]);
      same("verify: nor with no order question answered between the boards",
        fresh((h, seat) => {
          shields(seat);
          const a = combat("combatDeclareBlockers", 38, 378), b = combat("combatDamage", 38, 378), c = combat("combatDamage", 38, 373);
          return [...logOf(h, a, b), ...logOf(h, b, c)].filter((l) => /AI 1/.test(l));
        }),
        ["AI 1: 378 -> 373 life (-5)"]);
      same("verify: nor on the next board in main 2 (owed-next-turn-step)",
        fresh((h, seat) => { shields(seat); return split(h, seat, combat("main2", 38, 373)).filter((l) => /AI 1/.test(l)); }),
        ["AI 1: 378 -> 373 life (-5)"]);
      same("verify: nor on a board of the step logged after a later one (another seat's, a redraw)",
        fresh((h, seat) => {
          shields(seat);
          split(h, seat, combat("combatDamage", 38, 378));
          return logOf(h, combat("combatEnd", 38, 378), combat("combatDamage", 38, 373)).filter((l) => /AI 1/.test(l));
        }),
        ["AI 1: 378 -> 373 life (-5)"]);
      // (the verifier's stale Reflect Damage: no loss on the damage board, then Blue's Lightning Bolt at AI 1 for exactly
      // the 3 owed, in the same step: the Bolt's)
      const BOLT_AT = { controllerId: "player-0", id: "engine-stack-96", identity: { name: "Lightning Bolt" }, isPermanentSpell: false, ownerId: "player-0", sourceId: id(333),
        sourceAbilityText: "Lightning Bolt deals 3 damage to any target.", text: "Lightning Bolt (333) - Lightning Bolt deals 3 damage to any target.", targets: [{ kind: "player", id: "player-1" }] };
      const giantOnly = (step, a, c, fill = () => {}) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", ATK(229, "Hill Giant", 3), "player-1"); fill(b); }), a, c);
      same("verify: an amount owed is not said for a loss another part explains (owed-stale-bolt)",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          const b = giantOnly("combatDamage", 38, 40), bs = giantOnly("combatDamage", 38, 40, (x) => x.stack.push(BOLT_AT));
          const l1 = logOf(h, giantOnly("combatDeclareBlockers", 38, 40), b);
          ORDER(h, seat, b);
          return [...l1, ...logOf(h, b, bs), ...logOf(h, bs, giantOnly("combatDamage", 38, 37, (x) => put(x, "graveyard", card(333, "Lightning Bolt", ["Instant"]))), [ev(13, "Stack", "Graveyard", id(333))])];
        }),
        ["Blue casts Lightning Bolt targeting AI 1", "AI 1: 40 -> 37 life (-3, damage from Lightning Bolt)"]);
      same("verify: nor beside a pain land's damage of that player's",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          const land = (t) => opp({ ...card(334, "Adarkar Wastes", ["Land"]), tapped: t });
          const b = giantOnly("combatDamage", 38, 40, (x) => put(x, "battlefield", land(false), "player-1"));
          const l1 = logOf(h, giantOnly("combatDeclareBlockers", 38, 40, (x) => put(x, "battlefield", land(false), "player-1")), b);
          ORDER(h, seat, b);
          h.B._getGame().painTaps = [{ slot: "player-1", id: id(334), name: "Adarkar Wastes", n: 1, at: Date.now() }];
          return [...l1, ...logOf(h, b, giantOnly("combatDamage", 38, 37, (x) => put(x, "battlefield", land(true), "player-1")))].filter((l) => /AI 1/.test(l));
        }),
        ["AI 1: 40 -> 37 life (-3)"]);
      // (a loss on the damage board itself of less than all of it: nothing said, and nothing kept for the next board)
      same("verify: a redirect's part lost on the damage board is neither said nor kept",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          const b = giantOnly("combatDamage", 38, 38);
          const l1 = logOf(h, giantOnly("combatDeclareBlockers", 38, 40), b);
          ORDER(h, seat, b);
          return [...l1, ...logOf(h, b, giantOnly("combatDamage", 38, 35))].filter((l) => /AI 1/.test(l));
        }),
        ["AI 1: 40 -> 38 life (-2)", "AI 1: 38 -> 35 life (-3)"]);
      // (a Reflect Damage that never applied, nothing lost through its step, another shield first: kept for the next
      // time, a second combat of the turn; one whose loss can't be told is used up)
      const again = (h, ai) => logOf(h, giantOnly("combatDeclareBlockers", 38, 40), giantOnly("combatDamage", 38, ai)).filter((l) => /AI 1/.test(l));
      same("verify: a redirect's shield that never applied redirects the next time",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          const b = giantOnly("combatDamage", 38, 40);
          logOf(h, giantOnly("combatDeclareBlockers", 38, 40), b);
          logOf(h, b, giantOnly("combatEnd", 38, 40));
          return again(h, 37);
        }),
        ["Hill Giant's combat damage is dealt to AI 1 instead (Reflect Damage)", "AI 1: 40 -> 37 life (-3, damage from Hill Giant, redirected by Reflect Damage)"]);
      same("verify: one whose player lost life it can't be told from is used up",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          const b = giantOnly("combatDamage", 38, 40);
          logOf(h, giantOnly("combatDeclareBlockers", 38, 40), b);
          logOf(h, b, giantOnly("combatDamage", 38, 37));
          return again(h, 37);
        }),
        ["AI 1: 40 -> 37 life (-3)"]);
      same("verify: and so is one partly lost on the damage board itself",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          logOf(h, giantOnly("combatDeclareBlockers", 38, 40), giantOnly("combatDamage", 38, 38));
          return again(h, 37);
        }),
        ["AI 1: 40 -> 37 life (-3)"]);
      same("verify: an order answer of another step (main 1) is not the damage's",
        fresh((h, seat) => {
          shields(seat);
          ORDER(h, seat, combat("main1", 38, 378));
          const a = combat("combatDeclareBlockers", 38, 378), b = combat("combatDamage", 38, 378), c = combat("combatDamage", 38, 373);
          return [...logOf(h, a, b), ...logOf(h, b, c)].filter((l) => /AI 1/.test(l));
        }),
        ["AI 1: 378 -> 373 life (-5)"]);
      same("verify: nor one of an order question about something else (tokens doubled)",
        fresh((h, seat) => {
          shields(seat);
          const a = combat("combatDeclareBlockers", 38, 378), b = combat("combatDamage", 38, 378), c = combat("combatDamage", 38, 373);
          const l1 = logOf(h, a, b);
          seat.board = { state: { gameView: b } };
          const TWICE = "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.";
          h.B.onPrompt(seat, { promptId: 991, decidingPlayerId: "player-0", input: { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, options: [{ label: TWICE }, { label: TWICE }] } });
          h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 991, choice: ["0"] }) });
          return [...l1, ...logOf(h, b, c)].filter((l) => /AI 1/.test(l));
        }),
        ["AI 1: 378 -> 373 life (-5)"]);
      same("verify r2: and one about something else after the damage's, in its step, leaves the damage's answer (n-order-damage)",
        fresh((h, seat) => {
          shields(seat);
          const a = combat("combatDeclareBlockers", 38, 378), b = combat("combatDamage", 38, 378), c = combat("combatDamage", 38, 373);
          const l1 = logOf(h, a, b);
          ORDER(h, seat, b);
          const TWICE = "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.";
          h.B.onPrompt(seat, { promptId: 992, decidingPlayerId: "player-0", input: { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, options: [{ label: TWICE }, { label: TWICE }] } });
          h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 992, choice: ["0"] }) });
          return [...l1, ...logOf(h, b, c)].filter((l) => /AI 1/.test(l));
        }),
        ["Hill Giant's combat damage is dealt to AI 1 instead (Reflect Damage)", "Deflecting Palm deals 2 damage to AI 1",
          "AI 1: 378 -> 373 life (-5, damage from Hill Giant, redirected by Reflect Damage; damage from Deflecting Palm)"]);
      // (verify round 2)
      const COP_L = "The next time the chosen red source deals damage to you, prevent that damage.";
      const reflectAndCop = (h, seat, choice, ai) => {
        SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
        SOURCE_PICK(seat, 63, [237, "Circle of Protection: Red"], COP, [GIANT()], id(229));
        const b = giantOnly("combatDamage", 38, 40);
        const l1 = logOf(h, giantOnly("combatDeclareBlockers", 38, 40), b);
        ORDER(h, seat, b, [REFLECT_L, COP_L], choice);
        return [...l1, ...logOf(h, b, giantOnly("combatDamage", 38, ai))].filter((l) => /AI 1/.test(l));
      };
      same("verify r2: Circle of Protection put first on the same attacker: an exact loss is not the redirect (r2-cop-first-bare)",
        fresh((h, seat) => reflectAndCop(h, seat, "1", 37)), ["AI 1: 40 -> 37 life (-3)"]);
      same("verify r2: and Reflect Damage put first, it is",
        fresh((h, seat) => reflectAndCop(h, seat, "0", 37)),
        ["Hill Giant's combat damage is dealt to AI 1 instead (Reflect Damage)", "AI 1: 40 -> 37 life (-3, damage from Hill Giant, redirected by Reflect Damage)"]);
      // (a shield put first other than Reflect Damage: by no card on the field (unknown), or Blue's Energy Field, a card
      // but not a source chosen this turn; with the answer it left, the precondition)
      const FIELD_L = "Prevent all damage that would be dealt to you by sources you don't control.";
      const FIELD = { ...card(341, "Energy Field", ["Enchantment"]), text: FIELD_L };
      const otherFirst = (h, seat, onField) => {
        SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
        const fill = (x) => { if (onField) put(x, "battlefield", FIELD); };
        const b = giantOnly("combatDamage", 38, 40, fill);
        const l1 = logOf(h, giantOnly("combatDeclareBlockers", 38, 40, fill), b);
        ORDER(h, seat, b, [REFLECT_L, FIELD_L], "1");
        const answer = h.B._getGame().orderAnswer;
        return [answer, ...l1, ...logOf(h, b, giantOnly("combatDamage", 38, 37, fill))].filter((l) => typeof l !== "string" || /AI 1/.test(l));
      };
      same("verify r2: a shield put first that names no card (unknown) says nothing",
        fresh((h, seat) => otherFirst(h, seat, false)),
        [{ turn: 3, step: "combatDamage", first: null }, "AI 1: 40 -> 37 life (-3)"]);
      same("verify r2: nor one put first that is a card but no source chosen this turn (n2-first-other)",
        fresh((h, seat) => otherFirst(h, seat, true)),
        [{ turn: 3, step: "combatDamage", first: "Energy Field" }, "AI 1: 40 -> 37 life (-3)"]);
      // (the answer itself Reflect Damage first, only its turn the one before)
      same("verify r2: an order answer of an earlier turn is not this one's (r2-asked-turn)",
        fresh((h, seat) => {
          shields(seat);
          const a = combat("combatDeclareBlockers", 38, 378), b = combat("combatDamage", 38, 378), c = combat("combatDamage", 38, 373);
          const l1 = logOf(h, a, b);
          ORDER(h, seat, b);
          const answer = h.B._getGame().orderAnswer;
          answer.turn = 2;
          return [answer.first, ...l1, ...logOf(h, b, c)].filter((l) => /AI 1|Reflect/.test(l));
        }),
        ["Reflect Damage", "AI 1: 378 -> 373 life (-5)"]);
      same("verify r2: a shield that redirected on the damage board is used up (r2-owed-used-said)",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          const first = logOf(h, giantOnly("combatDeclareBlockers", 38, 40), giantOnly("combatDamage", 38, 37)).filter((l) => /AI 1/.test(l));
          return [...first, ...again(h, 34).map((l) => l.replace("40 -> 34", "40 -> 34"))];
        }),
        ["Hill Giant's combat damage is dealt to AI 1 instead (Reflect Damage)", "AI 1: 40 -> 37 life (-3, damage from Hill Giant, redirected by Reflect Damage)", "AI 1: 40 -> 34 life (-6)"]);
      same("verify r2: and one owed beside another known part, unsaid, is used up too (r2-latesaid-used-alone)",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          const land = (t) => opp({ ...card(334, "Adarkar Wastes", ["Land"]), tapped: t });
          const b = giantOnly("combatDamage", 38, 40, (x) => put(x, "battlefield", land(false), "player-1"));
          logOf(h, giantOnly("combatDeclareBlockers", 38, 40, (x) => put(x, "battlefield", land(false), "player-1")), b);
          ORDER(h, seat, b);
          h.B._getGame().painTaps = [{ slot: "player-1", id: id(334), name: "Adarkar Wastes", n: 1, at: Date.now() }];
          logOf(h, b, giantOnly("combatDamage", 38, 37, (x) => put(x, "battlefield", land(true), "player-1")));
          return again(h, 37);
        }),
        ["AI 1: 40 -> 37 life (-3)"]);
      // (AI 1's lifelinking Prodigal Pyromancer pings Blue on that board: AI 1's change has a gain part, so the -3 is not
      // the 3 owed alone)
      same("verify r2: nor beside a gain of that player's (r2-alone-gain)",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          const PING = opp({ ...card(338, "Prodigal Pyromancer", ["Creature"]), power: "1", keywords: ["Lifelink"] });
          const STACKED = { controllerId: "player-1", id: "engine-stack-98", identity: { name: "Prodigal Pyromancer" }, isPermanentSpell: false, ownerId: "player-1", sourceId: id(338),
            sourceAbilityText: "{T}: Prodigal Pyromancer deals 1 damage to any target.", text: "Prodigal Pyromancer (338) - Prodigal Pyromancer deals 1 damage to any target.", targets: [{ kind: "player", id: "player-0" }] };
          const b = giantOnly("combatDamage", 38, 40, (x) => { put(x, "battlefield", PING, "player-1"); x.stack.push(STACKED); });
          const l1 = logOf(h, giantOnly("combatDeclareBlockers", 38, 40, (x) => put(x, "battlefield", PING, "player-1")), b);
          ORDER(h, seat, b);
          return [...l1, ...logOf(h, b, giantOnly("combatDamage", 37, 37, (x) => put(x, "battlefield", { ...PING, tapped: true }, "player-1")))].filter((l) => /life|instead/.test(l));
        }),
        ["Blue: 38 -> 37 life (-1, damage from Prodigal Pyromancer)", "AI 1: 40 -> 37 life (-3)"]);
      same("verify r2: nor beside life that player paid on that board (r2-other-nopaid)",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          const CASTING = { controllerId: "player-1", id: "engine-stack-99", identity: { name: "Mondrak, Glory Dominus" }, isPermanentSpell: true, isCasting: true, ownerId: "player-1", sourceId: id(339), text: "Mondrak, Glory Dominus" };
          const b = giantOnly("combatDamage", 38, 40);
          const l1 = logOf(h, giantOnly("combatDeclareBlockers", 38, 40), b);
          ORDER(h, seat, b);
          h.B._getGame().lifePays = [{ slot: "player-1", n: 2, name: "Mondrak, Glory Dominus", card: id(339), at: Date.now() }];
          return [...l1, ...logOf(h, b, giantOnly("combatDamage", 38, 37, (x) => x.stack.push(CASTING)))].filter((l) => /AI 1|instead/.test(l));
        }),
        ["AI 1: 40 -> 37 life (-3)"]);
      same("verify: a first strike's split, the next board the regular damage, stays bare",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 61, [231, "Reflect Damage"], REFLECT, [GIANT()], id(229));
          const fs = (step, c) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", { ...ATK(229, "Hill Giant", 3), keywords: ["First Strike"] }, "player-1"); }), 38, c);
          const b = fs("combatFirstStrikeDamage", 40);
          const l1 = logOf(h, fs("combatDeclareBlockers", 40), b);
          ORDER(h, seat, b);
          return [...l1, ...logOf(h, b, fs("combatDamage", 37))].filter((l) => /AI 1/.test(l));
        }),
        ["AI 1: 40 -> 37 life (-3)"]);
      same("re-test #6: nor is it kept past the step",
        fresh((h, seat) => {
          shields(seat);
          const a = combat("combatDeclareBlockers", 38, 378), b = combat("combatDamage", 38, 378), c = combat("combatEnd", 38, 378), d = combat("combatEnd", 38, 373);
          return [...logOf(h, a, b), ...logOf(h, b, c), ...logOf(h, c, d)].filter((l) => /AI 1/.test(l));
        }),
        ["AI 1: 378 -> 373 life (-5)"]);
      same("re-test #6: Palm's damage back unsaid when the attacker's power changed between the boards (a pump unseen)",
        fresh((h, seat) => {
          SOURCE_PICK(seat, 62, [260, "Deflecting Palm"], PALM, [opp(BEAR())], id(1));
          const at = (step, pw, c) => life(board((b) => { b.step = step; b.activePlayerId = "player-1"; put(b, "battlefield", ATK(1, "Grizzly Bears", pw), "player-1"); }), 38, c);
          return logOf(h, at("combatDeclareBlockers", 2, 40), at("combatDamage", 4, 36)).filter((l) => /AI 1|Palm deals/.test(l));
        }),
        ["AI 1: 40 -> 36 life (-4)"]);
      same("re-test #6: all of it on the damage board itself is said there, as before",
        fresh((h, seat) => {
          shields(seat);
          return logOf(h, combat("combatDeclareBlockers", 38, 378), combat("combatDamage", 38, 373)).filter((l) => /AI 1/.test(l));
        }),
        ["Hill Giant's combat damage is dealt to AI 1 instead (Reflect Damage)", "Deflecting Palm deals 2 damage to AI 1",
          "AI 1: 378 -> 373 life (-5, damage from Hill Giant, redirected by Reflect Damage; damage from Deflecting Palm)"]);
    }
    // new bug 3: Pyroclasm on many same-named tokens, one line (the live game: one grouped line and about 50 more)
    {
      const SPIRIT = (n) => card(n, "Spirit Token", ["Creature"], { token: true });
      const before = (dead) => board((b) => { put(b, "battlefield", KYKAR([])); for (let i = 0; i < 5; i++) put(b, "battlefield", SPIRIT(320 + i)); if (dead) put(b, "battlefield", BEAR()); b.stack.push(PYROCLASM); });
      const after = (dead) => board((b) => { put(b, "battlefield", { ...KYKAR([]), damage: 2 }); for (let i = 0; i < 5; i++) put(b, "battlefield", { ...SPIRIT(320 + i), damage: 2 }); if (dead) put(b, "graveyard", BEAR()); put(b, "graveyard", card(277, "Pyroclasm", ["Sorcery"])); });
      same("re-test bug 3: Pyroclasm's survivors in one line, the same tokens counted, and the dead die",
        between(before(true), after(true), [ev(11, "Stack", "Graveyard", id(277)), ev(12, "Battlefield", "Graveyard", id(1))]),
        ["Pyroclasm deals 2 damage to Kykar, Wind's Fury; Spirit token ×5", "Grizzly Bears dies"]);
      same("re-test bug 3: and every creature hit is 'each creature' with how many",
        between(before(false), after(false), [ev(11, "Stack", "Graveyard", id(277))]),
        ["Pyroclasm deals 2 damage to each creature (6)"]);
      // (Akroma's Will and Flawless Maneuver: "Spirit token, Spirit token, ..." some 50 times, new bug 7)
      const kw = (k) => board((b) => { put(b, "battlefield", KYKAR(k)); for (let i = 0; i < 5; i++) put(b, "battlefield", { ...SPIRIT(320 + i), keywords: k }); if (!k.length) b.stack.push(AKROMA); else put(b, "graveyard", card(240, "Akroma's Will", ["Instant"])); });
      same("re-test bug 7: the creatures a spell gave keywords, the same names counted",
        between(kw([]), kw(["Vigilance"]), [ev(11, "Stack", "Graveyard", id(240))]),
        ["Kykar, Wind's Fury; Spirit token ×5 gain vigilance (Akroma's Will)"]);
    }
    // new bug 6: an Aura gone after its creature, by Forge's order, is said after it
    {
      const WURM6 = { ...card(330, "Craw Wurm", ["Creature"]) };
      const PAC = { ...card(329, "Pacifism", ["Enchantment"]), subtypes: ["Aura"], attachedTo: id(330) };
      same("re-test bug 6: Craw Wurm dies, then its Pacifism goes to the graveyard",
        between(board((b) => { put(b, "battlefield", PAC); put(b, "battlefield", WURM6); }), board((b) => { put(b, "graveyard", PAC); put(b, "graveyard", WURM6); }),
          [ev(11, "Battlefield", "Graveyard", id(330)), ev(12, "Battlefield", "Graveyard", id(329))]),
        ["Craw Wurm dies", "Pacifism goes to the graveyard"]);
      same("re-test bug 6: an Aura gone first stays first",
        between(board((b) => { put(b, "battlefield", PAC); put(b, "battlefield", WURM6); }), board((b) => { put(b, "graveyard", PAC); put(b, "graveyard", WURM6); }),
          [ev(11, "Battlefield", "Graveyard", id(329)), ev(12, "Battlefield", "Graveyard", id(330))]),
        ["Pacifism goes to the graveyard", "Craw Wurm dies"]);
      // Make It So: "Untap target permanent you control. Target player draws two cards." (Forge's script, the mode chosen)
      const BASTION = card(331, "Karn's Bastion", ["Land"]);
      const MIS = { controllerId: "player-0", id: "engine-stack-95", identity: { name: "Make It So" }, isPermanentSpell: false, ownerId: "player-0", sourceId: id(332),
        sourceAbilityText: "Untap target permanent you control. Target player draws two cards.", text: "Make It So (332) - Untap Karn's Bastion (331). AI 1 draws two cards.",
        targets: [{ id: id(331), kind: "card" }, { id: "player-1", kind: "player" }] };
      const mis = (done) => board((b) => { put(b, "battlefield", { ...BASTION, tapped: !done }); count(b, "library", done ? 48 : 50, "player-1"); count(b, "hand", done ? 2 : 0, "player-1"); if (done) put(b, "graveyard", card(332, "Make It So", ["Sorcery"])); else b.stack.push(MIS); });
      same("re-test bug 6: Make It So's untap is said before the draw it puts after it",
        between(mis(false), mis(true), [ev(11, "Library", "Hand", null, "draw", "player-1", { cause: "Draw", causeCardId: id(332), causeName: "Make It So" }),
          ev(12, "Library", "Hand", null, "draw", "player-1", { cause: "Draw", causeCardId: id(332), causeName: "Make It So" }), ev(13, "Stack", "Graveyard", id(332))]),
        ["Make It So untaps Karn's Bastion", "AI 1 draws 2 cards"]);
      // (verify 2026-11-09: only a draw that is the spell's by Forge, and the board's only player to draw)
      const drawBy = (seq, p, cardN, name) => ev(seq, "Library", "Hand", null, "draw", p, { cause: "Draw", causeCardId: id(cardN), causeName: name });
      same("verify: a draw of another card's is not moved after the untap",
        between(mis(false), mis(true), [drawBy(11, "player-1", 336, "Howling Mine"), drawBy(12, "player-1", 336, "Howling Mine"), ev(13, "Stack", "Graveyard", id(332))]),
        ["AI 1 draws 2 cards", "Make It So untaps Karn's Bastion"]);
      const both = (done) => { const b = mis(done); count(b, "library", done ? 39 : 40); count(b, "hand", done ? 1 : 0); return b; };
      same("verify: nor with two players drawing on that board",
        between(both(false), both(true), [drawBy(11, "player-0", 336, "Howling Mine"), drawBy(12, "player-1", 332, "Make It So"), drawBy(13, "player-1", 332, "Make It So"), ev(14, "Stack", "Graveyard", id(332))]),
        ["Blue draws a card", "AI 1 draws 2 cards", "Make It So untaps Karn's Bastion"]);
    }
  }

  // the game log on disk (live check 2026-11-11: no game-log.txt anywhere; only Forge's "log" envelopes, which the node
  // never sends, wrote it): each line the table's log gets, in order, a joined line written again
  {
    const h = harness.load();
    setup(h);
    const file = () => h.effects.filter((e) => e.appendFile === "game-log.txt").flatMap((e) => e.text.split(/(?<=\n)/));
    h.B.gameLogLine("Blue's debug setup \"x\": Blue gets Opt (hand)");
    const bears = (where) => board((b) => { put(b, where, BEAR()); count(b, "library", 50); });
    h.B.updateLog(bears("hand"));
    h.B.updateLog(bears("battlefield"));
    same("game log file: a header once, then each line as the table's log has it", file(),
      ["[time] === Game: Blue, AI 1 ===\n", "[time] Blue's debug setup \"x\": Blue gets Opt (hand)\n", "[time] Grizzly Bears enters the battlefield (Blue)\n"]);
    h.effects.length = 0;
    h.B.gameLogLine("Blue concedes");
    same("game log file: no second header", file(), ["[time] Blue concedes\n"]);
    // (Forge's own "log" envelope, which our node doesn't send today, goes to the same file)
    h.effects.length = 0;
    [...h.B._getGame().seats.values()][0].onEnvelope({ kind: "log", entry: { entryType: "action", message: "Blue casts Opt" } });
    same("game log file: a Forge log entry is written there too", file(), ["[time] (Forge, action) Blue casts Opt\n"]);
    harness.restore();
  }
  // (fs.appendFile calls run on libuv's thread pool and finish in any order: here the write started last finishes
  // first. The file must still read in order, the header first, a joined line's "in place of" after the line it joins)
  {
    const h = harness.load();
    setup(h);
    const fs = require("fs");
    const inFlight = [], disk = [];
    fs.appendFile = (p, d, ...rest) => { if (/game-log\.txt$/.test(String(p))) inFlight.push({ text: String(d), cb: rest.find((f) => typeof f === "function") }); };
    const settle = () => { while (inFlight.length) { const w = inFlight.pop(); disk.push(w.text); if (w.cb) w.cb(null); } };
    const T = [70, 71].map((n) => ({ ...card(n, "Treasure Token", ["Artifact"], { token: true }), text: "{T}, Sacrifice this artifact: Add one mana of any color." }));
    const sac = (seq, n) => ev(seq, "Battlefield", "Graveyard", id(n), "sacrificed", "player-0", { cause: "Cost:Sacrifice", causeName: "Treasure Token" });
    h.B.gameLogLine("one");
    h.B.gameLogLine("two");
    h.B.updateLog(board((b) => { for (const t of T) put(b, "battlefield", t); b.events = []; }));
    h.B.updateLog(board((b) => { put(b, "battlefield", T[1]); b.events = [sac(11, 70)]; }));
    h.B.updateLog(board((b) => { b.events = [sac(12, 71)]; }));
    h.B.gameLogLine("three");
    settle();
    const lines = disk.join("").split("\n").filter(Boolean).map((l) => l.replace(/^\[\d\d:\d\d:\d\d\] /, ""));
    same("game log file: in order when the writes finish out of order", lines,
      ["=== Game: Blue, AI 1 ===", "one", "two", "Treasure token is sacrificed for mana",
        "Treasure token ×2 are sacrificed for mana (in place of \"Treasure token is sacrificed for mana\")", "three"]);
    harness.restore();
  }

  process.stdout.write(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
