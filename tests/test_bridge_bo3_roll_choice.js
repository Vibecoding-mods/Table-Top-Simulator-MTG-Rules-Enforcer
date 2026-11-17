// Best of three, game 1 (docs/game-modes-spec.md §3.6: "game 1, a random pick (shown in the log), and the winner of the
// pick chooses"): the roll's winner chooses to play or draw. The bridge rolls when the room is ready to start; a human
// winner is asked Play / Draw on the table's prompt panel (the match's MATCH_PROMPT, as the loser's question after a
// game), and the start waits for the answer: the gameConfig's firstPlayer and StartGame go out then. No answer within
// ROLL_CHOICE_SECONDS plays (said in chat). An AI winner plays at once, as an AI loser does. A late answer, another
// room update while waiting, or a reset while waiting starts nothing twice. No TTS save needed.
//   node tests/test_bridge_bo3_roll_choice.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const logLines = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines);
const prompts = (h, color, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "prompt" && e.tts.color === color).map((e) => e.tts);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, uris: {} });
const DECK = () => ({ deckName: "Dimir test", commanderName: null,
  deck: { name: "Dimir test", format: "standard", commanders: [], cards: Array.from({ length: 60 }, (_, i) => card(i % 2 ? "Island" : "Swamp")), sideboard: [] } });
// a Standard 1v1 being set up: Blue seated, White a Forge AI (named by its colour until the game starts); the room not started yet
function newGame(h, { tableFirst = null } = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-1";
  seat.heartbeat = () => {};
  seat.respond = () => {};
  seat.sent = [];
  seat.send = (m) => seat.sent.push(m);
  seat.deck = DECK();
  seat.joined = true;
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: [], slotNames: {}, slotColor: {}, seatColors: ["White", "Blue"],
    started: false, closing: false, fromTable: true, mode: "standard", sentStatic: {}, sentZones: {}, aiTableDecks: [], aiTableColors: [], forgeSeats: [],
    botsRequested: true, maxSet: true, ...(tableFirst ? { tableFirst } : {}) });
  return seat;
}
// the room ready to start: Blue and the Forge AI both in and ready
const ready = (h, seat) => h.B.onRoomUpdate(seat, { room_id: "room-1", status: "Lobby", max_players: 2,
  players: [{ username: seat.username, ready: true, connected: true }, { username: "Forge AI", ready: true, connected: true, is_bot: true }] });
const starts = (seat) => seat.sent.filter((m) => m.type === "StartGame");
const config = (seat) => seat.sent.filter((m) => m.state?.payload?.type === "gameConfig").map((m) => m.state.payload).at(-1) || null;
const choose = async (h, choice) => { h.B.onTTS({ t: "answer", color: "Blue", promptId: "__match", choice: [choice] }); await h.settle(); };
// Math.random as a list of d20 rolls (each roll r: (r - 1) / 20)
function rolls(list) { const real = Math.random; let i = 0; Math.random = () => (i < list.length ? (list[i++] - 1) / 20 + 0.001 : real()); return () => { Math.random = real; }; }
const on = async (h) => { h.B._gameMode.mode = "standard"; h.B.onTTS({ t: "match", color: "Blue", text: "bo3" }); await h.settle(); };
// the seat order the start sends: the clockwise order; the index of a colour in seatColors is its firstPlayer
const BLUE = 1, WHITE = 0;

(async () => {
  // ── Blue wins the roll and is asked
  await run(async (h) => {
    await on(h);
    const seat = newGame(h);
    const n = h.effects.length;
    const back = rolls([14, 7]);
    ready(h, seat);
    back();
    await h.settle();
    same("ask: no start while the roll's winner chooses", starts(seat).length, 0);
    const q = prompts(h, "Blue", n).filter((p) => p.promptId != null).at(-1);
    ok("ask: Blue is asked Play / Draw on the match's panel", q?.promptId === "__match" && (q.options || []).map((o) => o.id).join() === "__play,__draw", JSON.stringify(q));
    ok("ask: the question says the roll", /^Game 1: you won the roll \(14–7\)\. Play or draw\?$/.test(q?.title || ""), q?.title);
    ok("ask: said in chat", chats(h, n).includes("[MTG] Game 1: a roll for who goes first: Blue 14, White 7. Blue wins the roll and chooses to play or draw."), chats(h, n).join(" | "));
    ok("ask: said in the log", logLines(h, n).includes("Roll for game 1: Blue 14, White 7: Blue wins the roll"), JSON.stringify(logLines(h, n)));
    // another room update while waiting: no start, no new roll, no second question
    const asked = prompts(h, "Blue", n).filter((p) => p.promptId != null).length;
    ready(h, seat);
    await h.settle();
    same("ask: another room update starts nothing and asks nothing more", [starts(seat).length, prompts(h, "Blue", n).filter((p) => p.promptId != null).length, chats(h, n).filter((c) => /a roll for who goes first/.test(c)).length], [0, asked, 1]);
    // Blue draws: AI 1 goes first, the start goes out now
    const m = h.effects.length;
    await choose(h, "__draw");
    same("draw: the gameConfig names White (the AI) first", config(seat)?.firstPlayer, WHITE);
    same("draw: then the start", starts(seat).length, 1);
    ok("draw: the gameConfig before StartGame", seat.sent.findIndex((x) => x.state?.payload?.type === "gameConfig") < seat.sent.findIndex((x) => x.type === "StartGame"), JSON.stringify(seat.sent.map((x) => x.type)));
    ok("draw: said", chats(h, m).includes("[MTG] Blue chooses to draw: White goes first in game 1."), chats(h, m).join(" | "));
    ok("draw: in the log", logLines(h, m).includes("Blue chooses to draw: White goes first in game 1"), JSON.stringify(logLines(h, m)));
    ok("draw: the question is closed", prompts(h, "Blue", m).some((p) => p.promptId == null), JSON.stringify(prompts(h, "Blue", m)));
    // a second answer, and the clock running out after it, start nothing more
    await choose(h, "__play");
    for (let k = 0; k < 40; k++) await h.settle();
    same("draw: a second answer or the clock later starts nothing more", [starts(seat).length, config(seat)?.firstPlayer], [1, WHITE]);
  });
  await run(async (h) => {
    await on(h);
    const seat = newGame(h);
    const back = rolls([14, 7]);
    ready(h, seat);
    back();
    await h.settle();
    await choose(h, "__play");
    same("play: Blue first, then the start", [config(seat)?.firstPlayer, starts(seat).length], [BLUE, 1]);
  });
  // ── no answer: Blue plays when the clock runs out
  await run(async (h) => {
    await on(h);
    const seat = newGame(h);
    const back = rolls([14, 7]);
    ready(h, seat);
    back();
    await h.settle();
    const n = h.effects.length;
    await h.flush();
    same("clock: no answer, Blue plays and the game starts", [config(seat)?.firstPlayer, starts(seat).length], [BLUE, 1]);
    ok("clock: said", chats(h, n).some((c) => /^\[MTG\] Blue didn't choose within \d+ seconds: Blue plays \(goes first in game 1\)\.$/.test(c)), chats(h, n).join(" | "));
    ok("clock: the question is closed", prompts(h, "Blue", n).some((p) => p.promptId == null), JSON.stringify(prompts(h, "Blue", n)));
    await choose(h, "__draw");
    same("clock: an answer after it changes nothing", [config(seat)?.firstPlayer, starts(seat).length], [BLUE, 1]);
  });
  // ── the AI (White) wins the roll: it plays, no question, the start goes out at once
  await run(async (h) => {
    await on(h);
    const seat = newGame(h);
    const n = h.effects.length;
    const back = rolls([5, 12]);
    ready(h, seat);
    back();
    await h.settle();
    same("AI: the AI plays and the game starts at once", [config(seat)?.firstPlayer, starts(seat).length], [WHITE, 1]);
    ok("AI: no question", prompts(h, "Blue", n).filter((p) => p.promptId != null).length === 0, JSON.stringify(prompts(h, "Blue", n)));
    ok("AI: said as before", chats(h, n).includes("[MTG] Game 1: a roll for who goes first: Blue 5, White 12. White goes first."), chats(h, n).join(" | "));
  });
  // ── the table's own first player: no roll, no question
  await run(async (h) => {
    await on(h);
    const seat = newGame(h, { tableFirst: "White" });
    const n = h.effects.length;
    ready(h, seat);
    await h.settle();
    same("table: its first player, no roll, no question, the start at once", [config(seat)?.firstPlayer, starts(seat).length, chats(h, n).some((c) => /a roll/.test(c)), prompts(h, "Blue", n).filter((p) => p.promptId != null).length], [WHITE, 1, false, 0]);
  });
  // ── best of one: no roll, no question
  await run(async (h) => {
    h.B._gameMode.mode = "standard";
    const seat = newGame(h);
    const n = h.effects.length;
    ready(h, seat);
    await h.settle();
    same("bo1: no roll, the start at once with no gameConfig", [config(seat), starts(seat).length, chats(h, n).some((c) => /a roll/.test(c))], [null, 1, false]);
  });
  // ── a reset while waiting: the clock starts nothing in the next game
  await run(async (h) => {
    await on(h);
    const seat = newGame(h);
    const back = rolls([14, 7]);
    ready(h, seat);
    back();
    await h.settle();
    h.B._setGame(null);
    await h.flush();
    same("reset: the clock starts nothing once the game is gone", starts(seat).length, 0);
  });

  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} roll choice checks pass\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_bo3_roll_choice: ${e.stack}\n`); process.exit(1); });
