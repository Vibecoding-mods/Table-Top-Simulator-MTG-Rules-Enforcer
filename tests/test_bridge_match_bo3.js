// Best of three for Standard (docs/game-modes-spec.md §3.6): mtg match bo3 (host); each game's result and the match
// score in the game log and chat; the score under each player's life (their mark boxes: MATCH 1-0, GAME 2) in the
// status; after a game the loser chooses play or draw (a question on the table's own prompt panel, "Play" / "Draw"; an
// AI loser plays), and the next game's start sends that seat as gameConfig.firstPlayer; the first to 2 wins takes the
// match, a draw counts for neither, at most 5 games. Not built (the spec's later parts): sideboarding, "Concede match",
// game 1's random pick (the engine's own roll decides game 1). No TTS save needed.
//   node tests/test_bridge_match_bo3.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const chatsTo = (h, color, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat" && e.tts.color === color).map((e) => e.tts.text);
const logLines = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines);
const prompts = (h, color, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "prompt" && e.tts.color === color).map((e) => e.tts);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };

const SLOTS = { "player-0": "White", "player-1": "Blue" };
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
// a Standard 1v1: Blue seated, White a Forge AI ("AI 1")
function newGame(h, { mode = "standard", total = 2 } = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-1";
  seat.heartbeat = () => {};
  seat.respond = () => {};
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total, playerOrder: [seat.username, "Forge AI"], slotNames: { "player-0": "AI 1", "player-1": "Blue" },
    slotColor: { ...SLOTS }, seatColors: ["White", "Blue"], startOrder: ["Forge AI", seat.username], started: true, closing: false, fromTable: true, mode, sentStatic: {}, sentZones: {} });
  return seat;
}
function board({ winner = null, conceded = null, over = false } = {}) {
  return { turn: 6, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [], combatAssignments: [], gameOver: over, winnerId: winner,
    players: Object.keys(SLOTS).map((id) => ({ id, life: over && winner && id !== winner && !conceded ? 0 : 20, manaPool: {},
      status: over ? (id === winner ? "playing" : id === conceded ? "conceded" : winner ? "lost" : "lost") : "playing" })),
    zones: Object.keys(SLOTS).flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: zone === "library" ? 40 : 0 }))) };
}
// a game played out: the board, then the engine's game-over question to the seated player
async function ends(h, seat, opts) {
  seat.board = { state: { gameView: board({ ...opts, over: true }) }, fingerprint: null };
  h.B.sendTable(); await h.flush();
  h.B.onPrompt(seat, { promptId: 900 + Math.floor(Math.random() * 99), decidingPlayerId: seat.slot, input: { type: "gameOver" } });
  await h.flush();
}
const say = async (h, text) => { h.B.onTTS({ t: "match", color: "Blue", text }); await h.flush(); };
const choose = async (h, id) => { h.B.onTTS({ t: "answer", color: "Blue", promptId: "__match", choice: [id] }); await h.flush(); };
const tableOf = (h) => h.effects.filter((e) => e.tts?.t === "table").at(-1)?.tts;
const marksOf = (m, color) => m?.players?.find((p) => p.color === color)?.allMarks || [];

(async () => {
  await run(async (h) => {
    // the setting
    h.B._gameMode.mode = "commander";
    await say(h, "bo3");
    ok("mtg match bo3 in Commander: refused, Standard only", chats(h).some((c) => /Best of three is for Standard/.test(c)) && !chats(h).some((c) => /Best of three on/.test(c)), chats(h).join(" | "));
    h.B._gameMode.mode = "standard";
    let n = h.effects.length;
    await say(h, "bo3");
    ok("mtg match bo3 in Standard: on", chats(h, n).some((c) => /^\[MTG\] Best of three on for the next games: the first to win 2 games wins the match/.test(c)), chats(h, n).join(" | "));
    n = h.effects.length;
    await say(h, "");
    ok("mtg match: says the setting and the score", chats(h, n).some((c) => /^\[MTG\] Best of three: on\. No games played yet\./.test(c)), chats(h, n).join(" | "));

    // game 1: White (the AI) wins, Blue conceded
    let seat = newGame(h);
    n = h.effects.length;
    await ends(h, seat, { winner: "player-0", conceded: "player-1" });
    ok("game 1: the result and the score in the log", logLines(h, n).some((l) => /^AI 1 wins game 1 \(Blue conceded\. AI 1 wins\)\. Match: AI 1 1–0 Blue\.$/.test(l)), logLines(h, n).join(" | "));
    ok("game 1: and in chat", chats(h, n).some((c) => /^\[MTG\] AI 1 wins game 1\. Match: AI 1 1–0 Blue\./.test(c)), chats(h, n).join(" | "));
    const q = prompts(h, "Blue", n).at(-1);
    ok("game 1: Blue, who lost, is asked play or draw", q && q.promptId === "__match" && JSON.stringify(q.options.map((o) => o.label)) === '["Play","Draw"]' && /Game 2/.test(q.title || ""), JSON.stringify(q));
    seat.board = { state: { gameView: board({ winner: "player-0", conceded: "player-1", over: true }) }, fingerprint: null };
    h.B.sendTable(); await h.flush();
    same("status: the score under each life total", [marksOf(tableOf(h), "White").filter((l) => /^MATCH/.test(l)), marksOf(tableOf(h), "Blue").filter((l) => /^MATCH/.test(l))], [["MATCH 1–0"], ["MATCH 0–1"]]);
    n = h.effects.length;
    await choose(h, "__draw");
    ok("choice: Blue draws, so AI 1 plays first", chats(h, n).some((c) => /^\[MTG\] Blue chooses to draw: AI 1 goes first in game 2\. Press New game when you're ready\./.test(c)), chats(h, n).join(" | "));
    ok("choice: the question closes", prompts(h, "Blue", n).some((p) => p.promptId == null), JSON.stringify(prompts(h, "Blue", n)));
    n = h.effects.length;
    await choose(h, "__play");
    ok("choice: a second answer is ignored", !chats(h, n).some((c) => /chooses/.test(c)), chats(h, n).join(" | "));

    // game 2 starts: the first player goes with the start
    seat = newGame(h);
    same("game 2: firstPlayer is the seat chosen (AI 1, seat 0)", h.B._startConfig(), { type: "gameConfig", firstPlayer: 0, players: [] });
    seat.board = { state: { gameView: board() }, fingerprint: null };
    h.B.sendTable(); await h.flush();
    same("game 2: the status says the score and the game", marksOf(tableOf(h), "Blue").filter((l) => /^MATCH|^GAME/.test(l)), ["MATCH 0–1", "GAME 2"]);
    // game 2: Blue wins
    n = h.effects.length;
    await ends(h, seat, { winner: "player-1" });
    ok("game 2: Blue wins it, 1–1", logLines(h, n).some((l) => /^Blue wins game 2 \(AI 1 is at 0 life\. Blue wins\)\. Match: AI 1 1–1 Blue\.$/.test(l) || /^Blue wins game 2 .*Match: AI 1 1–1 Blue\.$/.test(l)), logLines(h, n).join(" | "));
    ok("game 2: the AI, who lost, plays", chats(h, n).some((c) => /^\[MTG\] AI 1 chooses to play: AI 1 goes first in game 3\./.test(c)) && !prompts(h, "Blue", n).some((p) => p.promptId === "__match"), chats(h, n).join(" | "));
    seat = newGame(h);
    same("game 3: the AI's choice goes with the start", h.B._startConfig(), { type: "gameConfig", firstPlayer: 0, players: [] });
    // game 3: a draw counts for neither
    n = h.effects.length;
    await ends(h, seat, {});
    ok("game 3: a draw counts for neither", logLines(h, n).some((l) => /^Game 3 is a draw\. Match: AI 1 1–1 Blue\.$/.test(l)), logLines(h, n).join(" | "));
    ok("game 3: after a draw the last chooser chooses again (the AI: plays)", chats(h, n).some((c) => /AI 1 chooses to play: AI 1 goes first in game 4/.test(c)), chats(h, n).join(" | "));
    // game 4: Blue wins the match
    seat = newGame(h);
    n = h.effects.length;
    await ends(h, seat, { winner: "player-1" });
    ok("game 4: Blue wins the match 2–1", logLines(h, n).some((l) => /^MATCH WON: Blue wins the match 2–1\.$/.test(l)) && chats(h, n).some((c) => /^\[MTG\] MATCH WON: Blue wins the match 2–1\./.test(c)), logLines(h, n).join(" | "));
    ok("game 4: nobody is asked play or draw", !prompts(h, "Blue", n).some((p) => p.promptId === "__match") && !chats(h, n).some((c) => /chooses to/.test(c)), chats(h, n).join(" | "));
    seat = newGame(h);
    same("after the match: a new match, no first player", h.B._startConfig(), null);
    seat.board = { state: { gameView: board() }, fingerprint: null };
    h.B.sendTable(); await h.flush();
    same("after the match: the next game is game 1 of a new match", marksOf(tableOf(h), "Blue").filter((l) => /^MATCH|^GAME/.test(l)), ["MATCH 0–0", "GAME 1"]);
  });

  // at most five games: the score after the fifth decides
  await run(async (h) => {
    h.B._gameMode.mode = "standard";
    await say(h, "bo3");
    let seat = newGame(h);
    await ends(h, seat, { winner: "player-1" });
    for (let k = 0; k < 3; k++) { seat = newGame(h); await ends(h, seat, {}); if (k < 2) await choose(h, "__play"); }
    seat = newGame(h);
    const n = h.effects.length;
    await ends(h, seat, {});
    ok("five games: the score decides", logLines(h, n).some((l) => /^The match ends after 5 games: Blue wins the match 1–0\.$/.test(l)), logLines(h, n).join(" | "));
  });

  // off, another mode, another pair
  await run(async (h) => {
    h.B._gameMode.mode = "standard";
    let seat = newGame(h);
    let n = h.effects.length;
    await ends(h, seat, { winner: "player-1" });
    ok("best of one (the default): no match line, no question", !logLines(h, n).some((l) => /Match:/.test(l)) && !prompts(h, "Blue", n).some((p) => p.promptId === "__match"), logLines(h, n).join(" | "));
    await say(h, "bo3");
    seat = newGame(h, { mode: "commander" });
    n = h.effects.length;
    await ends(h, seat, { winner: "player-1" });
    ok("a Commander game isn't a match game", !logLines(h, n).some((l) => /Match:/.test(l)), logLines(h, n).join(" | "));
    seat = newGame(h, { total: 3 });
    n = h.effects.length;
    await ends(h, seat, { winner: "player-1" });
    ok("a three-player game isn't a match game", !logLines(h, n).some((l) => /Match:/.test(l)), logLines(h, n).join(" | "));
    // (another pair of seats: a new match, game 1 again)
    seat = newGame(h);
    await ends(h, seat, { winner: "player-1" });
    seat = newGame(h);
    h.B._getGame().slotColor = { "player-0": "Red", "player-1": "Blue" };
    h.B._getGame().seatColors = ["Red", "Blue"];
    n = h.effects.length;
    await ends(h, seat, { winner: "player-1" });
    ok("another pair of seats: a new match", logLines(h, n).some((l) => /^Blue wins game 1 .*Match: AI 1 0–1 Blue\.$/.test(l)), logLines(h, n).join(" | "));
    await say(h, "bo1");
    seat = newGame(h);
    n = h.effects.length;
    await ends(h, seat, { winner: "player-1" });
    ok("mtg match bo1: off again", !logLines(h, n).some((l) => /Match:/.test(l)), logLines(h, n).join(" | "));
  });

  // the table's chat passes it on
  const COPY = require("fs").readFileSync(require("path").join(__dirname, "..", "tools", "make-engine-copy.js"), "utf8");
  ok("table: mtg match reaches the bridge", /elseif cmd == "match" then[\s\S]{0,300}engineSend\("match", \{ color = pl\.color, text = rest \}\)/.test(COPY), "make-engine-copy.js engineChat");

  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_match_bo3: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_match_bo3: ${e.stack}`); process.exit(1); });
