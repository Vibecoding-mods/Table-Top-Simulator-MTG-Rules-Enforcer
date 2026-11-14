// A picked starting hand ("mtg hand", the companion page's Starting hand; bridge setPickedHand, takePickedHands,
// handPrompt, handOps): set, cleared and refused; dropped by a game with another person or with debug tools off; the
// dealt hand kept at the engine's real mulligan question; and at the first priority the one debug fix that makes the
// hand the picked one, in the order the cards end up in. Real data: Blue's deck is the default Neheb, the Worthy preset
// (manabrew/public/preset_decks, the deck the bridge gives a seat with no deck of its own), the board and the mulligan
// prompt are the golden's dump2, recorded from Forge (Blue's hand: Vraska's Fall, Venomous Changeling, Hurloon Minotaur,
// Pestilence, Heated Debate, Simian Spirit Guide, Fire-Belly Changeling).
//   node tests/test_bridge_hand.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const clone = (x) => JSON.parse(JSON.stringify(x));
const D2 = require("./golden/fixtures/dump2.json");
const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const relay = (h) => h.effects.map((e) => e.relay).filter(Boolean);
const applies = (h) => relay(h).filter((r) => r.state?.directive?.type === "applyState").map((r) => r.state.directive);
const responses = (h) => relay(h).filter((r) => r.state?.kind === "response").map((r) => r.state.action?.output ?? r.state.action);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const post = async (h, m) => { const r = h.B.onToolsPost(m); await h.flush(); return r; };
const say = async (h, color, text) => { h.B.onTTS({ t: "hand", json: JSON.stringify({ color, text }) }); await h.flush(); };
const PASS = { actions: [{ id: "pass", type: "pass" }] };
const prompt = (type, input = {}, id = 900) => ({ promptId: id, decidingPlayerId: "player-0", input: { type, ...input } });
// the engine's mulligan question as Forge sent it (dump2's), its hand ids made the board's hand
const HAND = ["engine-card-43", "engine-card-35", "engine-card-75", "engine-card-77", "engine-card-97", "engine-card-94", "engine-card-74"];
const mulligan = () => { const p = clone(D2.prompts.mulligan); p.input.handCardIds = HAND.slice(); return p; };

// a started table game: Blue (a person) vs AI White, or with Red too
function started(h, { red = false, pick = null } = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: clone(D2.board), fingerprint: null };
  Object.assign(seat.board.state.gameView, { stack: [] });
  const seats = new Map([["Blue", seat]]);
  if (red) { const r = new h.B.Seat("Red", "neheb_minotaur_commander"); r.slot = "player-2"; r.board = clone(seat.board); seats.set("Red", r); }
  h.B._setGame({ seats, bots: 1, total: red ? 3 : 2, playerOrder: [], slotNames: { "player-0": "Blue", "player-1": "AI 1", "player-2": "Red" },
    slotColor: { "player-0": "Blue", "player-1": "White", ...(red ? { "player-2": "Red" } : {}) }, started: true, closing: false, fromTable: true,
    sentStatic: {}, sentZones: {}, ...(pick ? { handPick: { Blue: { names: pick } } } : {}) });
  return seat;
}

(async () => {
  // ── refused, and what each says ──
  await run(async (h) => {
    same("debug tools off: refused, saying how to switch them on", (await post(h, { kind: "hand", color: "Blue", names: ["Lightning Bolt"] })),
      { ok: false, message: "Debug tools are off: the host switches them on first (companion page, Table tools)." });
    h.B.setDebugTools(true);
    same("more than 7: refused, saying fewer deal the rest", (await post(h, { kind: "hand", color: "Blue", names: Array(8).fill("Mountain") })).message,
      "A hand is 7 cards: name 7 at most (that was 8). Name fewer and the rest are dealt at random from the deck.");
    same("none named: refused", (await post(h, { kind: "hand", color: "Blue", names: [" ", ""] })).message, "Name at least one card (Clear takes the picked hand away).");
    same("names not a list: refused as none", (await post(h, { kind: "hand", color: "Blue", names: "Lightning Bolt" })).message, "Name at least one card (Clear takes the picked hand away).");
    same("a name the engine doesn't know: refused, naming it", (await post(h, { kind: "hand", color: "Blue", names: ["Lightning Bolt", "Lightnin Blot"] })).message, 'The engine has no card called "Lightnin Blot".');
    same("not a seat colour: refused", (await post(h, { kind: "hand", color: "Green", names: ["Shock"] })).message, "Green isn't a seat colour.");
    same("clear with nothing waiting: said", (await post(h, { kind: "hand", color: "Blue", clear: true })), { ok: true, message: "No picked hand was waiting for Blue." });
    same("nothing refused was kept", h.B.toolsState().hand.seats.map((s) => s.waiting), [null, null, null, null]);
  });
  await run(async (h) => {
    h.B.setDebugTools(true);
    started(h, { red: true });
    same("another person in the game: refused, a picked hand is for games against the AI", (await post(h, { kind: "hand", color: "Blue", names: ["Shock"] })),
      { ok: false, message: "Red is playing too: a picked hand is for games against the AI only." });
  });

  // ── set from the page: said to the table, shown on the page with the deck's own cards and the added ones ──
  await run(async (h) => {
    h.B.setDebugTools(true);
    const r = (await post(h, { kind: "hand", color: "Blue", names: [" lightning bolt", "Vraska's Fall", "Counterspell"] }));
    same("set: the answer", r, { ok: true, message: "Picked hand for Blue's next game: Lightning Bolt, Vraska's Fall, Counterspell, and 4 more dealt at random from the deck. Not in Neheb, the Worthy (the deck Blue plays), so added to the game: Counterspell." });
    same("set: said to the whole table, with when they come", chats(h).at(-1),
      "[MTG] Debug: Blue's next game (against the AI) starts with a picked hand: Lightning Bolt, Vraska's Fall, Counterspell, and 4 more dealt at random from the deck. Not in Neheb, the Worthy (the deck Blue plays), so added to the game: Counterspell. They come at the first priority, turn 1's upkeep (the engine deals the opening hand itself and takes no change at the keep-or-mulligan question, so the dealt hand is kept by itself).");
    const blue = h.B.toolsState().hand.seats.find((s) => s.color === "Blue");
    same("GET: the hand waiting, Forge's spelling, in order; the added card", [blue.waiting, blue.added], [["Lightning Bolt", "Vraska's Fall", "Counterspell"], ["Counterspell"]]);
    same("GET: the deck the seat plays, where from", [blue.deck, blue.source, h.B.toolsState().hand.max], ["Neheb, the Worthy", "default", 7]);
    ok("GET: the deck's card names, once each, sorted, the commander apart", blue.cards.length === 75 && blue.cards.includes("Lightning Bolt") && blue.cards.includes("Mountain") && !blue.cards.includes("Neheb, the Worthy")
      && blue.cards.join("|") === [...blue.cards].sort().join("|"), `${blue.cards.length}: ${blue.cards.slice(0, 5)}`);
    same("two of a card the deck has 14 of: both its own", (await post(h, { kind: "hand", color: "Blue", names: ["Mountain", "Mountain"] })) && h.B.toolsState().hand.seats.find((s) => s.color === "Blue").added, []);
    same("clear: answered, said to the table, gone from the page", [(await post(h, { kind: "hand", color: "Blue", clear: true })).message, chats(h).at(-1), h.B.toolsState().hand.seats.find((s) => s.color === "Blue").waiting],
      ["Picked hand for Blue cleared.", "[MTG] Picked hand for Blue cleared: the next game deals as usual.", null]);
    (await post(h, { kind: "hand", color: "Blue", names: ["Shock"] }));
    h.B.setDebugTools(false); await h.flush();
    same("debug tools off: a waiting hand is dropped, said", [chats(h).at(-1), h.B.toolsState().hand.seats.find((s) => s.color === "Blue").waiting], ["[MTG] Picked hand for Blue dropped: debug tools are off.", null]);
  });

  // ── a deck chosen with mtg deck (decks/rebuilt_niv.json, rebuilt from the 2026-11-03 game logs): its own cards ──
  await run(async (h) => {
    h.B.setDebugTools(true);
    h.B.onTTS({ t: "deck", json: JSON.stringify({ color: "Blue", deck: "rebuilt_niv" }) }); await h.flush();
    const r = await post(h, { kind: "hand", color: "Blue", names: ["Archmage of Runes", "Island", "Island", "Lightning Bolt", "Niv-Mizzet, Visionary"] });
    same("mtg deck's deck: named, the cards it lacks (the commander is never in the library) added",
      r.message, "Picked hand for Blue's next game: Archmage of Runes, Island, Island, Lightning Bolt, Niv-Mizzet, Visionary, and 2 more dealt at random from the deck. Not in Rebuilt: Niv-Mizzet (from the 2026-11-03 logs) (the deck Blue plays), so added to the game: Lightning Bolt, Niv-Mizzet, Visionary.");
    const blue = h.B.toolsState().hand.seats.find((s) => s.color === "Blue");
    same("GET: that deck, from mtg deck; its names suggested", [blue.deck, blue.source, blue.cards.includes("Archmage of Runes"), blue.cards.includes("Niv-Mizzet, Visionary"), blue.added],
      ["Rebuilt: Niv-Mizzet (from the 2026-11-03 logs)", "preset", true, false, ["Lightning Bolt", "Niv-Mizzet, Visionary"]]);
  });

  // ── chat: mtg hand ──
  await run(async (h) => {
    same("split: commas, but not inside a card's own name; a semicolon always splits", h.B.splitHandText("lightning bolt, neheb, the worthy, shock; opt,"),
      ["lightning bolt", "neheb, the worthy", "shock", "opt"]);
    same("split: a name that isn't a card is kept whole for the refusal", h.B.splitHandText("sol rnig, shock"), ["sol rnig", "shock"]);
    await say(h, "Blue", "shock");
    same("chat, debug tools off: refused to the player", chats(h).at(-1), "[MTG] Debug tools are off: the host switches them on first (companion page, Table tools).");
    h.B.setDebugTools(true);
    await say(h, "Blue", "lightning bolt, neheb, the worthy");
    ok("chat: set, the commander's comma kept, said to the table", /^\[MTG\] Debug: Blue's next game \(against the AI\) starts with a picked hand: Lightning Bolt, Neheb, the Worthy, and 5 more dealt at random from the deck\. Not in Neheb, the Worthy \(the deck Blue plays\), so added to the game: Neheb, the Worthy\. /.test(chats(h).at(-1)), chats(h).at(-1));
    await say(h, "Blue", "");
    ok("chat: plain 'mtg hand' says what is waiting", /^\[MTG\] Picked hand waiting for your next game: Lightning Bolt, Neheb, the Worthy, and 5 more/.test(chats(h).at(-1)), chats(h).at(-1));
    await say(h, "Blue", "off");
    same("chat: off clears it, said to the table and to the player", chats(h).slice(-2), ["[MTG] Picked hand for Blue cleared: the next game deals as usual.", "[MTG] Picked hand for Blue cleared."]);
    await say(h, "Blue", "");
    same("chat: nothing waiting: how to use it", chats(h).at(-1), "[MTG] No picked hand. Debug tools on, against the AI:  mtg hand <card>, <card> ...  (up to 7; the rest dealt at random), mtg hand off.");
  });

  // ── the next game takes it: one person and debug tools on, else dropped (said) ──
  await run(async (h) => {
    h.B.setDebugTools(true);
    (await post(h, { kind: "hand", color: "Blue", names: ["Lightning Bolt", "Counterspell"] }));
    h.B.startGame(["Blue"], 1, false, true);
    await h.flush();
    same("start: taken into this game, gone from the waiting list", [h.B._getGame().handPick, h.B.toolsState().hand.seats.find((s) => s.color === "Blue").waiting],
      [{ Blue: { names: ["Lightning Bolt", "Counterspell"] } }, null]);
    ok("start: said, with the deck the seat plays", chats(h).includes("[MTG] Blue's picked hand: Lightning Bolt, Counterspell, and 5 more dealt at random from the deck. Not in Neheb, the Worthy (the deck Blue plays), so added to the game: Counterspell. They come at the first priority, turn 1's upkeep (the engine deals the opening hand itself and takes no change at the keep-or-mulligan question, so the dealt hand is kept by itself)."), JSON.stringify(chats(h).slice(-3)));
  });
  await run(async (h) => {
    h.B.setDebugTools(true);
    (await post(h, { kind: "hand", color: "Blue", names: ["Shock"] }));
    h.B.startGame(["Blue", "Red"], 1, false, true);
    await h.flush();
    same("start with another person: dropped, said", [h.B._getGame().handPick, chats(h).filter((t) => /Picked hand for Blue dropped/.test(t))],
      [undefined, ["[MTG] Picked hand for Blue dropped: Red is playing too, and a picked hand is for games against the AI only."]]);
  });
  await run(async (h) => {
    h.B.setDebugTools(true);
    (await post(h, { kind: "hand", color: "Blue", names: ["Shock"] }));
    h.B.startGame(["Blue"], 1, false, false); // (not the table's game: a test's autoplay)
    same("a game the table didn't start: the hand keeps waiting", [h.B._getGame().handPick, h.B.toolsState().hand.seats.find((s) => s.color === "Blue").waiting], [undefined, ["Shock"]]);
  });

  // ── in the game: kept at the mulligan question, made the picked hand at the first priority ──
  await run(async (h) => {
    h.B.setDebugTools(true);
    const seat = started(h, { pick: ["Lightning Bolt", "Pestilence", "Counterspell"] });
    h.B.onPrompt(seat, mulligan()); await h.flush();
    same("the engine's mulligan question: kept by itself, never shown", [responses(h).at(-1), seat.prompt], [{ type: "mulliganDecision", keep: true }, null]);
    h.B.onPrompt(seat, prompt("chooseAction", PASS, 901)); await h.flush();
    const a = applies(h);
    same("first priority: one applyState", a.length, 1);
    // Pestilence was dealt: it stays; Lightning Bolt and Counterspell are added, the last two dealt cards go under
    same("the changes, in order: a dealt card under the library for each card added, then the added ones as picked", a[0]?.ops, [
      { op: "move", card: "engine-card-94", zone: "library", position: "bottom" },
      { op: "move", card: "engine-card-74", zone: "library", position: "bottom" },
      { op: "createCard", name: "Lightning Bolt", player: "player-0", zone: "hand" },
      { op: "createCard", name: "Counterspell", player: "player-0", zone: "hand" }]);
    same("said as the debug setup, each change", chats(h).find((t) => t.startsWith('[MTG] Debug "picked hand"')),
      '[MTG] Debug "picked hand": Blue\'s dealt Simian Spirit Guide: to the bottom of the library; Blue\'s dealt Fire-Belly Changeling: to the bottom of the library; Blue gets Lightning Bolt (hand); Blue gets Counterspell (hand).');
    same("once: the pick is used up", h.B._getGame().handPick, {});
    // the engine's answer
    const b = clone(D2.board);
    const hand = b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0");
    hand.cards = hand.cards.filter((c) => !["engine-card-94", "engine-card-74"].includes(c.id));
    hand.cards.push({ ...clone(hand.cards[0]), id: "engine-card-300", identity: { name: "Lightning Bolt" } }, { ...clone(hand.cards[0]), id: "engine-card-301", identity: { name: "Counterspell" } });
    hand.count = hand.cards.length;
    b.gameView.stateFix = { fixId: a[0]?.fixId, applied: true };
    seat.board.state = b; h.B._getGame().lastTableSig = null; h.B.sendTable(); await h.flush();
    same("applied: the fix is over", h.B._getGame().fix, null);
    h.B.onPrompt(seat, prompt("chooseAction", PASS, 902)); await h.flush();
    same("the next priority changes nothing more", applies(h).length, 1);
  });
  await run(async (h) => {
    h.B.setDebugTools(true);
    const seat = started(h, { pick: ["Pestilence", "Vraska's Fall"] });
    h.B.onPrompt(seat, prompt("chooseAction", PASS, 901)); await h.flush();
    same("every picked card dealt: nothing to change, said", [applies(h).length, chats(h).at(-1), h.B._getGame().handPick], [0, "[MTG] Blue's picked hand was dealt as it is.", {}]);
  });
  await run(async (h) => {
    h.B.setDebugTools(true);
    const seat = started(h, { pick: Array(7).fill("Shock") });
    h.B.onPrompt(seat, prompt("chooseAction", PASS, 901)); await h.flush();
    same("7 picked, none dealt: the whole dealt hand goes under, 7 added", (applies(h)[0]?.ops || []).map((o) => o.op === "move" ? o.card : o.name), [...HAND, ...Array(7).fill("Shock")]);
  });
  await run(async (h) => {
    h.B.setDebugTools(true);
    const seat = started(h, { pick: ["Shock"] });
    seat.board.state.gameView.stack = [{ id: "engine-stack-1", controllerId: "player-1", identity: { name: "Lightning Bolt" } }];
    h.B.onPrompt(seat, prompt("chooseAction", PASS, 901)); await h.flush();
    same("something on the stack: it waits", [applies(h).length, !!h.B._getGame().handPick.Blue], [0, true]);
  });
  await run(async (h) => {
    // never in a game without one: the mulligan question is the player's
    const seat = started(h);
    h.B.onPrompt(seat, mulligan()); await h.flush();
    same("no picked hand: the mulligan question is asked as usual", [responses(h).length, seat.prompt?.ui?.title], [0, "Keep this hand?"]);
    h.B.onPrompt(seat, prompt("chooseAction", PASS, 901)); await h.flush();
    same("no picked hand: no change at the first priority", applies(h).length, 0);
  });
  await run(async (h) => {
    h.B.setDebugTools(true);
    const seat = started(h, { pick: ["Shock"] });
    h.B.setDebugTools(false);
    h.B.onPrompt(seat, mulligan()); await h.flush();
    same("debug tools switched off in the game: the pick is dropped, the mulligan question asked", [chats(h).includes("[MTG] Picked hand for Blue dropped: debug tools are off."), responses(h).length, seat.prompt?.ui?.title], [true, 0, "Keep this hand?"]);
  });

  process.stdout.write(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL crashed: ${e && e.stack}`); process.exit(1); });
