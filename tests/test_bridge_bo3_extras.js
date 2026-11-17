// Best of three's extras for Standard (docs/game-modes-spec.md §3.6; the parts cloud/treachery-bo3 left unbuilt):
//  1. Game 1's first player: a random roll (two d20, again on a tie), in chat and the log, and on the table (the board's
//     matchRoll, which the table shows once on its banner); the winner of the roll chooses to play or draw (an AI plays).
//     Not when the table names
//     a first player; later games keep the loser's play-or-draw choice.
//  2. The game number in the phase bar: the board's match, "GAME 2 OF 3" ("GAME 4 OF 5" once draws stretch it).
//  3. Sideboarding between games: each human player with a sideboard (a deck's 15, read from its file or list) is asked
//     on the prompt panel: Keep deck / Swap cards / Reset to registered / Concede match. A swap picks cards to take out,
//     then cards to bring in; the bridge checks it (60 or more in the main deck, at most 15 in the sideboard) and the
//     next game's deck is the swapped one. The next game waits until every human player is done.
//  4. "Concede match": mtg match concede twice within 15 s during a game (the game is conceded too), or the option on a
//     between-games question with a Yes / No; the other player wins the match.
// No TTS save needed.
//   node tests/test_bridge_bo3_extras.js
// (BRIDGE_PATH=<a copy> loads a copy instead: tools/mutate-bo3-extras.js breaks one so a check fails by name.)
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const logLines = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines);
const prompts = (h, color, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "prompt" && e.tts.color === color).map((e) => e.tts);
const lastQ = (h, from = 0) => prompts(h, "Blue", from).filter((p) => p.promptId != null).at(-1);
const ids = (q) => (q?.options || []).map((o) => o.id);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };

const SLOTS = { "player-0": "White", "player-1": "Blue" };
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
// Blue's Standard deck: 15 cards ×4 and a sideboard of 15 (5 cards ×3)
const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, uris: {} });
const MAIN = ["Island", "Swamp", "Opt", "Duress", "Cut Down", "Go for the Throat", "Memory Deluge", "Sheoldred, the Apocalypse", "Gix's Command", "Fatal Push",
  "Thoughtseize", "Bloodtithe Harvester", "Fable of the Mirror-Breaker", "Bitter Reunion", "Make Disappear"];
const SIDE = ["Negate", "Duress Plus", "Unlicensed Hearse", "Pithing Needle", "Essence Scatter"];
const DECK = () => ({ deckName: "Dimir test", commanderName: null,
  deck: { name: "Dimir test", format: "standard", commanders: [], cards: MAIN.flatMap((n) => [n, n, n, n]).map(card), sideboard: SIDE.flatMap((n) => [n, n, n]).map(card) } });
// a Standard 1v1: Blue seated with that deck, White a Forge AI ("AI 1")
function newGame(h, { deck = DECK(), tableFirst = null } = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-1";
  seat.heartbeat = () => {};
  seat.respond = () => {};
  seat.sent = [];
  seat.send = (m) => seat.sent.push(m);
  seat.deck = deck;
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: [seat.username, "Forge AI"], slotNames: { "player-0": "AI 1", "player-1": "Blue" },
    slotColor: { ...SLOTS }, seatColors: ["White", "Blue"], startOrder: ["Forge AI", seat.username], started: true, closing: false, fromTable: true, mode: "standard", sentStatic: {}, sentZones: {}, aiTableDecks: [], aiTableColors: [], forgeSeats: [],
    ...(tableFirst ? { tableFirst } : {}) });
  return seat;
}
function board({ winner = null, conceded = null, over = false } = {}) {
  return { turn: 6, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [], combatAssignments: [], gameOver: over, winnerId: winner,
    players: Object.keys(SLOTS).map((id) => ({ id, life: over && winner && id !== winner && !conceded ? 0 : 20, manaPool: {}, status: over ? (id === winner ? "playing" : id === conceded ? "conceded" : "lost") : "playing" })),
    zones: Object.keys(SLOTS).flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: zone === "library" ? 40 : 0 }))) };
}
async function ends(h, seat, opts) {
  seat.board = { state: { gameView: board({ ...opts, over: true }) }, fingerprint: null };
  h.B.sendTable(); await h.flush();
  h.B.onPrompt(seat, { promptId: 900 + Math.floor(Math.random() * 99), decidingPlayerId: seat.slot, input: { type: "gameOver" } });
  await h.flush();
}
const playing = async (h, seat) => { seat.board = { state: { gameView: board() }, fingerprint: null }; h.B.sendTable(); await h.flush(); };
const say = async (h, text) => { h.B.onTTS({ t: "match", color: "Blue", text }); await h.flush(); };
const choose = async (h, choice) => { h.B.onTTS({ t: "answer", color: "Blue", promptId: "__match", choice: Array.isArray(choice) ? choice : [choice] }); await h.flush(); };
const tableOf = (h) => h.effects.filter((e) => e.tts?.t === "table").at(-1)?.tts;
// the deck the seat sends the engine when it joins the next game's room
function joins(h, seat) {
  h.B.onRoomUpdate(seat, { players: [{ username: seat.username, is_bot: false }], max_players: 2 });
  const sel = seat.sent.find((m) => m.type === "SetDeckSelection");
  return sel ? { main: sel.deck.cards.map((c) => c.identity.name), side: (sel.deck.sideboard || []).map((c) => c.identity.name) } : null;
}
const countOf = (list, n) => list.filter((x) => x === n).length;
// Math.random as a list of d20 rolls (each roll r: (r - 1) / 20)
function rolls(list) { const real = Math.random; let i = 0; Math.random = () => (i < list.length ? (list[i++] - 1) / 20 + 0.001 : real()); return () => { Math.random = real; }; }
const on = async (h) => { h.B._gameMode.mode = "standard"; await say(h, "bo3"); };

(async () => {
  // ── 1. game 1's roll: Blue wins it and chooses (the room ready, the question, Play; tests/test_bridge_bo3_roll_choice.js
  // has the rest of the choice)
  await run(async (h) => {
    await on(h);
    let n = h.effects.length;
    let seat = newGame(h);
    Object.assign(h.B._getGame(), { startSent: false, botsRequested: true, maxSet: true });
    seat.joined = true;
    const back = rolls([14, 7]);
    h.B.onRoomUpdate(seat, { room_id: "room-1", status: "Lobby", max_players: 2,
      players: [{ username: seat.username, ready: true, connected: true }, { username: "Forge AI", ready: true, connected: true, is_bot: true }] });
    back();
    await h.settle();
    await choose(h, "__play");
    const cfg = seat.sent.filter((m) => m.state?.payload?.type === "gameConfig").map((m) => m.state.payload).at(-1);
    same("roll: the roll's winner, Blue, chooses to play: Blue (seat 1) goes first", cfg, { type: "gameConfig", firstPlayer: 1, players: [] });
    ok("roll: said in chat with both numbers", chats(h, n).some((c) => /^\[MTG\] Game 1: a roll for who goes first: Blue 14, AI 1 7\. Blue wins the roll and chooses to play or draw\.$/.test(c)), chats(h, n).join(" | "));
    ok("roll: said in the log", logLines(h, n).some((l) => /^Roll for game 1: Blue 14, AI 1 7: Blue wins the roll$/.test(l)) || h.B._getGame().log?.some((l) => /Roll for game 1: Blue 14, AI 1 7: Blue wins the roll/.test(l)), JSON.stringify(h.B._getGame().log || logLines(h, n)));
    const again = h.B._startConfig();
    await h.flush();
    ok("roll: asked once a game (the start config again keeps it, rolls nothing more)", again?.firstPlayer === 1 && chats(h, n).filter((c) => /a roll for who goes first/.test(c)).length === 1, JSON.stringify(again) + chats(h, n).join(" | "));
    await playing(h, seat);
    const t = tableOf(h);
    ok("roll: on the table, the board's matchRoll", t?.matchRoll && /^BLUE WINS THE ROLL \(14–7\)$/.test(t.matchRoll.text) && t.matchRoll.seq > 0, JSON.stringify(t?.matchRoll));
    same("phase bar: game 1 of 3", t?.match, "GAME 1 OF 3");
  });
  await run(async (h) => {
    await on(h);
    let n = h.effects.length;
    newGame(h);
    const back = rolls([9, 9, 3, 18]);
    const cfg = h.B._startConfig();
    back();
    await h.flush();
    ok("roll: a tie is rolled again (9–9, then AI 1 18)", cfg?.firstPlayer === 0 && chats(h, n).some((c) => /Blue 3, AI 1 18\. AI 1 goes first\./.test(c)), JSON.stringify(cfg) + chats(h, n).join(" | "));
  });
  await run(async (h) => {
    await on(h);
    let n = h.effects.length;
    newGame(h, { tableFirst: "Blue" });
    same("roll: the table's own first player wins, no roll", [h.B._startConfig()?.firstPlayer, chats(h, n).some((c) => /a roll for who goes first/.test(c))], [1, false]);
  });
  await run(async (h) => {
    h.B._gameMode.mode = "standard";
    const seat = newGame(h);
    same("roll: no match, no roll and no game number", [h.B._startConfig(), (await playing(h, seat), tableOf(h)?.match ?? null)], [null, null]);
  });

  // ── 2 and 3. the game number; sideboarding
  await run(async (h) => {
    await on(h);
    let seat = newGame(h);
    let back = rolls([5, 12]);
    h.B._startConfig(); back();
    same("deck: game 1 sends the registered deck", (() => { const d = joins(h, seat); return [d.main.length, d.side.length]; })(), [60, 15]);
    // game 1: AI 1 wins; Blue, who lost, chooses play or draw, then sideboards
    let n = h.effects.length;
    await ends(h, seat, { winner: "player-0" });
    ok("sideboard: the loser's play or draw first", ids(lastQ(h, n)).join() === "__play,__draw,__concede", JSON.stringify(ids(lastQ(h, n))));
    n = h.effects.length;
    await choose(h, "__play");
    let q = lastQ(h, n);
    ok("sideboard: then the sideboard question, for game 2", /^Game 2: sideboard\?$/.test(q?.title || "") && ids(q).join() === "__sb_keep,__sb_swap,__concede", `${q?.title} ${JSON.stringify(ids(q))}`);
    ok("sideboard: it says the counts", /Main deck 60, sideboard 15/.test(q?.text || ""), q?.text);
    ok("sideboard: the next game waits for it", /Blue/.test(h.B._matchWaiting() || ""), h.B._matchWaiting());
    // swap: Opt ×2 out, Negate ×2 in
    n = h.effects.length;
    await choose(h, "__sb_swap");
    q = lastQ(h, n);
    ok("swap: the cards to take out, all 60, pick any number", q?.mode === "multi" && q.min === 0 && q.max === 60 && q.options.length === 60 && /take out/i.test(q.title), `${q?.mode} ${q?.min}-${q?.max} ${q?.options?.length} ${q?.title}`);
    const outIds = q.options.filter((o) => /^Opt\b/.test(o.label)).slice(0, 2).map((o) => o.id);
    n = h.effects.length;
    await choose(h, outIds);
    q = lastQ(h, n);
    ok("swap: then the cards to bring in, the 15 of the sideboard", q?.mode === "multi" && q.options.length === 15 && /bring in/i.test(q.title) && /2 out/.test(q.title + q.text), `${q?.title} ${q?.text} ${q?.options?.length}`);
    const inIds = q.options.filter((o) => /^Negate\b/.test(o.label)).slice(0, 2).map((o) => o.id);
    n = h.effects.length;
    await choose(h, inIds);
    ok("swap: done, said: what went out and in, the counts", chats(h, n).some((c) => /^\[MTG\] Blue sideboarded for game 2: out Opt ×2; in Negate ×2 \(main deck 60, sideboard 15\)\.$/.test(c)), chats(h, n).join(" | "));
    ok("swap: the table hears only that Blue is done, no cards and no counts (a sideboard is hidden)", (() => { const pub = h.effects.slice(n).filter((e) => e.tts?.t === "chat" && !e.tts.color).map((e) => e.tts.text); return pub.some((c) => /^\[MTG\] Blue is done sideboarding for game 2\.$/.test(c)) && !pub.some((c) => /Opt|Negate|main deck|sideboard 1/.test(c)); })(), JSON.stringify(h.effects.slice(n).filter((e) => e.tts?.t === "chat").map((e) => [e.tts.color, e.tts.text])));
    ok("swap: Blue alone is told the detail", h.effects.slice(n).some((e) => e.tts?.t === "chat" && e.tts.color === "Blue" && /out Opt ×2; in Negate ×2/.test(e.tts.text)));
    same("swap: nobody waited for any more", h.B._matchWaiting(), null);
    // game 2 starts with the swapped deck
    seat = newGame(h);
    let d = joins(h, seat);
    same("swap: game 2's deck has the swap", [d.main.length, d.side.length, countOf(d.main, "Opt"), countOf(d.main, "Negate"), countOf(d.side, "Opt"), countOf(d.side, "Negate")], [60, 15, 2, 2, 2, 1]);
    await playing(h, seat);
    same("phase bar: game 2 of 3", tableOf(h)?.match, "GAME 2 OF 3");
    // game 2: Blue wins; the winner sideboards too (no play or draw: the AI plays); a swap that breaks the rules is refused
    n = h.effects.length;
    await ends(h, seat, { winner: "player-1" });
    q = lastQ(h, n);
    ok("sideboard: the winner is asked too, with Reset to registered after a swap", /^Game 3: sideboard\?$/.test(q?.title || "") && ids(q).join() === "__sb_keep,__sb_swap,__sb_reset,__concede", `${q?.title} ${JSON.stringify(ids(q))}`);
    await choose(h, "__sb_swap");
    q = lastQ(h);
    await choose(h, q.options.filter((o) => /^Island\b/.test(o.label)).slice(0, 3).map((o) => o.id));
    q = lastQ(h);
    n = h.effects.length;
    await choose(h, q.options.filter((o) => /^Pithing Needle\b/.test(o.label)).slice(0, 1).map((o) => o.id));
    ok("check: 3 out and 1 in (main 58) refused, said why", chats(h, n).some((c) => /^\[MTG\] That swap leaves 58 cards in your main deck: it needs 60 or more\. Nothing was changed\./.test(c)), chats(h, n).join(" | "));
    ok("check: and asked again", /^Game 3: sideboard\?$/.test(lastQ(h, n)?.title || ""), lastQ(h, n)?.title);
    ok("check: still waited for", /Blue/.test(h.B._matchWaiting() || ""));
    // the start refused while sideboarding
    h.B._setGame(null);
    n = h.effects.length;
    h.B.startGame(["Blue"], 1);
    await h.flush();
    ok("wait: a start while Blue sideboards is refused, says who", chats(h, n).some((c) => /^\[MTG\] Not started: Blue is still sideboarding for game 3/.test(c)) && h.B._getGame() == null, chats(h, n).join(" | "));
    // reset to registered
    seat = newGame(h);
    n = h.effects.length;
    await choose(h, "__sb_reset");
    ok("reset: back to the registered deck, said", chats(h, n).some((c) => /^\[MTG\] Blue goes back to the registered deck for game 3 \(main deck 60, sideboard 15\)\.$/.test(c)), chats(h, n).join(" | "));
    d = joins(h, seat);
    same("reset: game 3's deck is the registered one", [countOf(d.main, "Opt"), countOf(d.main, "Negate")], [4, 0]);
    await playing(h, seat);
    same("phase bar: game 3 of 3", tableOf(h)?.match, "GAME 3 OF 3");
    // a draw stretches the match: game 4 of 5
    await ends(h, seat, {});
    await choose(h, "__play");
    await choose(h, "__sb_keep");
    seat = newGame(h);
    await playing(h, seat);
    same("phase bar: after a draw, game 4 of 5", tableOf(h)?.match, "GAME 4 OF 5");
  });
  // a 61-card main deck: 2 out, 1 in leaves 16 in the sideboard (main 60): refused; 1 out, 2 in (main 62, side 14) is fine
  await run(async (h) => {
    await on(h);
    const deck = DECK(); deck.deck.cards.push(card("Island"));
    let seat = newGame(h, { deck });
    joins(h, seat);
    await ends(h, seat, { winner: "player-1" });
    await choose(h, "__sb_swap");
    await choose(h, lastQ(h).options.slice(0, 2).map((o) => o.id));
    let n = h.effects.length;
    await choose(h, lastQ(h).options.slice(0, 1).map((o) => o.id));
    ok("check: 2 out, 1 in (main 60, sideboard 16) refused", chats(h, n).some((c) => /^\[MTG\] That swap leaves 16 cards in your sideboard: at most 15\. Nothing was changed\./.test(c)), chats(h, n).join(" | "));
    await choose(h, "__sb_swap");
    await choose(h, lastQ(h).options.slice(0, 1).map((o) => o.id));
    n = h.effects.length;
    await choose(h, lastQ(h).options.slice(0, 2).map((o) => o.id));
    ok("check: 1 out, 2 in (main 62, sideboard 14) is fine", chats(h, n).some((c) => /\(main deck 62, sideboard 14\)\.$/.test(c)), chats(h, n).join(" | "));
  });
  // a deck with no sideboard: no sideboard question
  await run(async (h) => {
    await on(h);
    const deck = DECK(); deck.deck.sideboard = [];
    const seat = newGame(h, { deck });
    joins(h, seat);
    let n = h.effects.length;
    await ends(h, seat, { winner: "player-1" });
    ok("no sideboard: nothing to ask, nobody waited for", !prompts(h, "Blue", n).some((p) => /sideboard/i.test(p.title || "")) && h.B._matchWaiting() == null, JSON.stringify(prompts(h, "Blue", n).map((p) => p.title)));
  });

  // ── 4. concede the match (in game 2: game 1 went to Blue)
  await run(async (h) => {
    await on(h);
    let seat = newGame(h);
    joins(h, seat);
    await ends(h, seat, { winner: "player-1" });
    await choose(h, "__sb_keep");
    seat = newGame(h);
    const dirs = [];
    seat.directive = (d) => dirs.push(d);
    await playing(h, seat);
    let n = h.effects.length;
    await say(h, "concede");
    ok("concede: asks to confirm first", chats(h, n).some((c) => /^\[MTG\] Concede the match\? AI 1 wins it\. Type  mtg match concede  again within 15 seconds to confirm\./.test(c)) && !dirs.length, chats(h, n).join(" | "));
    n = h.effects.length;
    await say(h, "concede");
    ok("concede: the game is conceded too", dirs.some((d) => d.type === "concede"), JSON.stringify(dirs));
    ok("concede: the other player wins the match, in chat and the log", chats(h, n).some((c) => /^\[MTG\] MATCH WON: AI 1 wins the match \(Blue conceded the match\)\.$/.test(c)) && logLines(h, n).some((l) => /^MATCH WON: AI 1 wins the match \(Blue conceded the match\)\.$/.test(l)), chats(h, n).join(" | "));
    n = h.effects.length;
    await ends(h, seat, { winner: "player-0", conceded: "player-1" });
    ok("concede: the game's end afterwards asks nothing", !prompts(h, "Blue", n).some((p) => p.promptId === "__match"), JSON.stringify(prompts(h, "Blue", n).map((p) => p.title)));
    seat = newGame(h);
    await playing(h, seat);
    same("concede: the next game is game 1 of a new match", tableOf(h)?.match, "GAME 1 OF 3");
  });
  await run(async (h) => {
    await on(h);
    const seat = newGame(h);
    joins(h, seat);
    await ends(h, seat, { winner: "player-0" });
    let n = h.effects.length;
    await choose(h, "__concede");
    const q = lastQ(h, n);
    ok("concede between games: a Yes / No first", ids(q).join() === "__concede_yes,__concede_no" && /Concede the match/.test(q?.title || ""), `${q?.title} ${JSON.stringify(ids(q))}`);
    await choose(h, "__concede_no");
    ok("concede between games: No goes back to the question", ids(lastQ(h)).join() === "__play,__draw,__concede", JSON.stringify(ids(lastQ(h))));
    await choose(h, "__concede");
    n = h.effects.length;
    await choose(h, "__concede_yes");
    ok("concede between games: Yes ends the match", chats(h, n).some((c) => /^\[MTG\] MATCH WON: AI 1 wins the match \(Blue conceded the match\)\.$/.test(c)) && h.B._matchWaiting() == null, chats(h, n).join(" | "));
    ok("concede between games: the question closes", prompts(h, "Blue", n).some((p) => p.promptId == null));
  });
  await run(async (h) => {
    h.B._gameMode.mode = "standard";
    newGame(h);
    let n = h.effects.length;
    await say(h, "concede");
    ok("concede: no match on, says so", chats(h, n).some((c) => /no best-of-three match/i.test(c)), chats(h, n).join(" | "));
  });

  // New game while Blue sideboards keeps the game (the question can still be answered); mtg reset gives the sideboarding up
  await run(async (h) => {
    await on(h);
    const seat = newGame(h);
    h.B._startConfig(); joins(h, seat);
    await ends(h, seat, { winner: "player-0" });
    await choose(h, "__play");
    let n = h.effects.length;
    h.B.onTTS({ t: "start", color: "Blue", seats: ["Blue"], bots: 1, autoReset: true, fromTable: true });
    await h.flush();
    ok("start while sideboarding: refused, says who", chats(h, n).some((c) => /^\[MTG\] Not started: Blue is still sideboarding for game 2/.test(c)), chats(h, n).join(" | "));
    ok("start while sideboarding: the game is kept, so the question can be answered", h.B._getGame() != null);
    n = h.effects.length;
    await choose(h, "__sb_keep");
    ok("start while sideboarding: Keep deck is taken", h.B._matchWaiting() == null, h.B._matchWaiting());
  });
  await run(async (h) => {
    await on(h);
    const seat = newGame(h);
    h.B._startConfig(); joins(h, seat);
    await ends(h, seat, { winner: "player-0" });
    await choose(h, "__play");
    ok("reset: Blue is waited for", h.B._matchWaiting() != null);
    h.B.onTTS({ t: "reset", color: "Blue" });
    await h.flush();
    ok("reset: gives the sideboarding up, nobody is waited for", h.B._matchWaiting() == null, h.B._matchWaiting());
  });

  console.log(failed ? `FAILED: ${failed} of ${failed + passed}` : `PASSED: ${passed} checks`);
  process.exit(failed ? 1 : 0);
})();
