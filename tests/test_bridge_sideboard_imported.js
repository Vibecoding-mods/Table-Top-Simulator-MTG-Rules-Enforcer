// A Standard sideboard for a deck imported on the table (docs/handoff/open-after-1124.md: "a deck imported on the table
// has no sideboard, so in a real game nobody is asked to sideboard"), the bridge's side. The table sends the deck on the
// seat's graveyard spot as entry.sideboard ("mtg ready", tools/make-engine-copy.js engineSendDecks;
// tests/test_table_sideboard_imported.js); bridge.js checkDeck reads it in Standard. The checks:
//  - a 60-card deck with a 15-card sideboard (decks/standard_dimir_aggro.json's lists): ready for Standard, the ready
//    line says the sideboard's count to its owner only, the log names no sideboard card;
//  - the deck the seat sends the engine has the sideboard; in a best of three, after game 1 the owner is asked "Game 2:
//    sideboard?" with "Main deck 60, sideboard 15", and a swap brings a sideboard card in for game 2;
//  - the sideboard is checked with the deck: 16 cards (at most 15), a fifth copy across the two (4 of a card), a card
//    the engine doesn't know (named), a card not legal in Standard; each not ready, said why;
//  - no sideboard: the ready line as before, no sideboard; Commander: a deck on the graveyard spot is left alone (ready
//    as before, no sideboard field);
//  - a foreign printing in the sideboard is looked up with the deck's (foreignToAsk).
//   node tests/test_bridge_sideboard_imported.js
// (BRIDGE_PATH=<a copy> loads a copy instead: tools/mutate-sideboard-imported.js breaks one so a check fails by name.)
const harness = require("./bridge-harness");
const LIST = require("../decks/standard_dimir_aggro.json");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const expand = (list) => list.flatMap((e) => Array(e.count || 1).fill(e.name));
const MAIN = expand(LIST.cards), SIDE = expand(LIST.sideboard);
// (names only: a picture link that isn't Scryfall's reads as the player's own art, and its lines follow the ready line)
const ttsCard = (n) => ({ n });
const entry = (main = MAIN, side = SIDE) => ({ deckName: "Dimir", commander: [], library: main.map(ttsCard), ...(side ? { sideboard: side.map(ttsCard) } : {}) });
const chatsTo = (h, from, color) => h.effects.slice(from).filter((e) => e.tts?.t === "chat" && e.tts.color === color).map((e) => e.tts.text);
const chatsAll = (h, from) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => ({ color: e.tts.color || null, text: e.tts.text }));
const logs = (h, from) => h.effects.slice(from).filter((e) => typeof e.log === "string").map((e) => e.log);
async function decks(h, seats, mode = "standard") {
  const n = h.effects.length;
  h.B.onTTS({ t: "decks", json: JSON.stringify({ seats, request: 1, mode }) }); await h.flush(200000);
  return n;
}

(async () => {
  // ── ready, said to its owner only ──
  await run(async (h) => {
    const n = await decks(h, { Blue: entry() });
    const mine = chatsTo(h, n, "Blue");
    ok("ready: a 60-card deck with the 15 on the graveyard spot is ready for Standard, the sideboard counted", mine.some((c) => /^\[MTG\] Blue \(Dimir\): ready for Standard\. 60 cards; .* Sideboard: 15 cards \(from your graveyard spot\)/.test(c)), mine.join(" | "));
    ok("private: the sideboard is said to Blue only, never to the table", chatsAll(h, n).filter((c) => /Sideboard/.test(c.text)).every((c) => c.color === "Blue"), JSON.stringify(chatsAll(h, n)));
    ok("private: the log counts it and names no sideboard card", logs(h, n).some((l) => /deck ready for Standard: 60 cards, sideboard 15/.test(l)) && !logs(h, n).some((l) => SIDE.some((s) => l.includes(s) && !MAIN.includes(s))), logs(h, n).filter((l) => /deck/.test(l)).join(" | "));
    same("ready: the bridge keeps the sideboard with the deck", [h.B._readyDecks.Blue?.cards.length, h.B._readyDecks.Blue?.sideboard?.length], [60, 15]);
  });

  // ── the deck the engine gets, and sideboarding in a best of three ──
  await run(async (h) => {
    h.B._gameMode.mode = "standard";
    await decks(h, { Blue: entry() });
    h.B.onTTS({ t: "match", color: "Blue", text: "bo3" }); await h.flush();
    const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
    seat.slot = "player-1"; seat.heartbeat = () => {}; seat.respond = () => {}; seat.sent = []; seat.send = (m) => seat.sent.push(m);
    const SLOTS = { "player-0": "White", "player-1": "Blue" };
    h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: [seat.username, "Forge AI"], slotNames: { "player-0": "AI 1", "player-1": "Blue" },
      slotColor: { ...SLOTS }, seatColors: ["White", "Blue"], startOrder: ["Forge AI", seat.username], started: true, closing: false, fromTable: true, mode: "standard",
      sentStatic: {}, sentZones: {}, aiTableDecks: [], aiTableColors: [] });
    const real = Math.random; let k = 0; Math.random = () => ([4, 11][k++] ?? 10) / 20 - 0.01;
    h.B._startConfig(); Math.random = real;
    h.B.onRoomUpdate(seat, { players: [{ username: seat.username, is_bot: false }], max_players: 2 });
    const sel = seat.sent.find((m) => m.type === "SetDeckSelection");
    same("engine: the deck Blue sends for game 1 has its sideboard", [sel?.deck.cards.length, (sel?.deck.sideboard || []).length, (sel?.deck.sideboard || []).map((c) => c.identity.name).sort()], [60, 15, [...SIDE].sort()]);
    // game 1: AI 1 wins; Blue chooses play or draw, then is asked to sideboard
    const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
    const over = { turn: 6, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [], combatAssignments: [], gameOver: true, winnerId: "player-0",
      players: Object.keys(SLOTS).map((id) => ({ id, life: id === "player-0" ? 20 : 0, manaPool: {}, status: id === "player-0" ? "playing" : "lost" })),
      zones: Object.keys(SLOTS).flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: zone === "library" ? 40 : 0 }))) };
    seat.board = { state: { gameView: over }, fingerprint: null };
    h.B.sendTable(); await h.flush();
    h.B.onPrompt(seat, { promptId: 901, decidingPlayerId: seat.slot, input: { type: "gameOver" } }); await h.flush();
    h.B.onTTS({ t: "answer", color: "Blue", promptId: "__match", choice: ["__play"] }); await h.flush();
    const qs = h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.color === "Blue" && e.tts.promptId != null).map((e) => e.tts);
    const q = qs.at(-1);
    ok("sideboarding: Blue is asked to sideboard for game 2, with the counts", /^Game 2: sideboard\?$/.test(q?.title || "") && /Main deck 60, sideboard 15/.test(q?.text || ""), `${q?.title} ${q?.text}`);
    // a swap: one Kaito out, one Day of Black Sun in
    const answer = async (choice) => { h.B.onTTS({ t: "answer", color: "Blue", promptId: "__match", choice }); await h.flush(); };
    await answer(["__sb_swap"]);
    const outQ = h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.color === "Blue").map((e) => e.tts).at(-1);
    const outId = (outQ?.options || []).find((o) => /^Kaito, Bane of Nightmares/.test(o.label))?.id;
    await answer([outId]);
    const inQ = h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.color === "Blue").map((e) => e.tts).at(-1);
    const inId = (inQ?.options || []).find((o) => /^Day of Black Sun/.test(o.label))?.id;
    await answer([inId]);
    seat.joined = false; seat.sent = [];
    h.B.onRoomUpdate(seat, { players: [{ username: seat.username, is_bot: false }], max_players: 2 });
    const sel2 = seat.sent.find((m) => m.type === "SetDeckSelection");
    const names = (sel2?.deck.cards || []).map((c) => c.identity.name);
    same("sideboarding: game 2's deck has the swap (a Kaito out, a Day of Black Sun in)", [names.length, names.filter((x) => x === "Kaito, Bane of Nightmares").length, names.filter((x) => x === "Day of Black Sun").length, (sel2?.deck.sideboard || []).length],
      [60, MAIN.filter((x) => x === "Kaito, Bane of Nightmares").length - 1, 1, 15]);
  });

  // ── checked with the deck ──
  const notReady = async (name, side, re) => run(async (h) => {
    const n = await decks(h, { Blue: entry(MAIN, side) });
    const mine = chatsTo(h, n, "Blue");
    ok(name, mine.some((c) => /: not ready for Standard\./.test(c) && re.test(c)) && !h.B._readyDecks.Blue, mine.join(" | "));
  });
  await notReady("checked: a 16-card sideboard is refused (at most 15)", [...SIDE, "Duress"], /16 cards in the sideboard: at most 15/);
  await notReady("checked: a fifth copy across deck and sideboard is refused (4 of a card)", [...SIDE.slice(0, 14), "Kaito, Bane of Nightmares"], /5× Kaito, Bane of Nightmares/);
  await notReady("checked: a sideboard card the engine doesn't know is named", [...SIDE.slice(0, 14), "Totally Fake Card"], /doesn't know 1 card\(s\): Totally Fake Card/);
  await notReady("checked: a sideboard card not legal in Standard is refused", [...SIDE.slice(0, 14), "Brainstorm"], /Brainstorm/);

  // ── no sideboard, and Commander ──
  await run(async (h) => {
    const n = await decks(h, { Blue: entry(MAIN, null) });
    const mine = chatsTo(h, n, "Blue");
    ok("none: no deck on the graveyard spot, the ready line as before", mine.some((c) => /: ready for Standard\. 60 cards; every card is known to the engine and legal in Standard\.(\n|$)/.test(c) && !/Sideboard/.test(c)), mine.join(" | "));
    same("none: no sideboard kept", h.B._readyDecks.Blue?.sideboard, []);
  });
  await run(async (h) => {
    const cmd = { deckName: "Neheb", commander: [ttsCard("Neheb, the Worthy")], library: [...Array(99)].map((_, i) => ttsCard(i % 2 ? "Mountain" : "Swamp")), sideboard: SIDE.map(ttsCard) };
    const n = await decks(h, { Blue: cmd }, "commander");
    const mine = chatsTo(h, n, "Blue");
    ok("commander: a deck on the graveyard spot is left alone (ready as before, no sideboard)", mine.some((c) => /: ready\. 99 cards \+ commander Neheb, the Worthy/.test(c)) && !mine.some((c) => /Sideboard/.test(c)) && h.B._readyDecks.Blue?.sideboard === undefined, mine.join(" | "));
  });

  // ── a foreign printing in the sideboard is looked up with the deck's ──
  await run(async (h) => {
    const n = await decks(h, { Blue: entry(MAIN, [...SIDE.slice(0, 14), "Negación Inventada"]) });
    ok("foreign: a sideboard card the engine doesn't know by name is looked up on Scryfall first", chatsAll(h, n).some((c) => /^\[MTG\] Looking up 1 card name\(s\) the engine doesn't know on Scryfall/.test(c.text)), JSON.stringify(chatsAll(h, n).map((c) => c.text)));
  });

  process.stdout.write(`${failed ? "FAIL" : "PASS"} test_bridge_sideboard_imported: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_sideboard_imported: ${e.stack}\n`); process.exit(1); });
