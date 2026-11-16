// The rejoin prompt, the bridge's side (the user, 2026-11-16: after last night's disconnects "people didn't know if they
// would be able to get back into the table"). bridge.js tells the table each step of a seat's way back; the table shows
// it on that player's screen (tools/engine-renderer.lua engineRejoin, tests/test_rejoin_prompt.js).
// 1. A link that drops mid-game: "lost ... Reconnecting...", "reconnected to the engine.", then, once the engine's board
//    for the seat is in again, { t: "rejoin", color, state: "back" } (Seat.backIn), with the time it took in the log.
//    A frame on the old socket, a log entry or a drop before the game never says "back".
// 2. A relay restart whose room refuses the seat past the rejoin window (RECONNECT_GIVE_UP_MS): a plain "couldn't get
//    back into the game ... Type "mtg reset"" once, not "Relay: Room not found".
// 3. A bridge restart that resumes a saved game: "The bridge restarted: rejoining the game..."; the game is sent to the
//    table as soon as every seat's board is in (not 3 s on), once; with a seat whose board never comes, at 3 s as before.
//   node tests/test_bridge_rejoin.js
const fs = require("fs");
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));
const tts = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts).map((e) => e.tts);
const chats = (h, from = 0) => tts(h, from).filter((m) => m.t === "chat").map((m) => m.text);
const logs = (h, from = 0) => h.effects.slice(from).filter((e) => e.log).map((e) => e.log);
const BOARD = { gameView: { turn: 3, step: "main1", activePlayerId: "player-0", players: [{ id: "player-0", life: 40 }, { id: "player-1", life: 40 }], zones: [] } };

function setup(h, extra = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.roomId = "room-1";
  seat.board = { state: structuredClone(BOARD), fingerprint: "f0" };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, ...extra });
  return seat;
}
// run timers one at a time until cond() or ms of virtual time pass
async function until(h, cond, ms) {
  const t0 = Date.now();
  for (let k = 0; k < 200 && !cond() && Date.now() - t0 < ms; k++) await h.flush(1);
}

(async () => {
  // 1. a dropped link, back in once the board comes
  {
    const h = harness.load();
    const seat = setup(h);
    const first = h.sockets.at(-1);
    first.emit("open");
    const mark = h.effects.length;
    first.emit("close");
    await h.settle(); ok("drop: everyone is told the seat is reconnecting", chats(h, mark).includes("[MTG] Blue lost the engine connection. Reconnecting..."), chats(h, mark).join(" | "));
    await until(h, () => h.sockets.length > 1, 3000);
    const second = h.sockets.at(-1);
    second.emit("open");
    frame(second, { type: "AuthResult", success: true, reconnected: true });
    await h.settle(); ok("drop: then that it reconnected", chats(h, mark).includes("[MTG] Blue reconnected to the engine."), chats(h, mark).join(" | "));
    await h.settle(); ok("drop: no 'back' before the board is in", !tts(h, mark).some((m) => m.t === "rejoin"), JSON.stringify(tts(h, mark).filter((m) => m.t === "rejoin")));
    frame(second, { type: "StateUpdate", state: { kind: "log", entry: {} } });
    frame(first, { type: "StateUpdate", state: { kind: "state", forPlayer: "player-0", state: structuredClone(BOARD), fingerprint: "old" } });
    await h.settle(); ok("drop: a log entry or the old socket's board is no 'back'", !tts(h, mark).some((m) => m.t === "rejoin"), JSON.stringify(tts(h, mark).filter((m) => m.t === "rejoin")));
    const b2 = structuredClone(BOARD); b2.gameView.players[0].life = 39;
    frame(second, { type: "StateUpdate", state: { kind: "state", forPlayer: "player-0", state: b2, fingerprint: "f1" } });
    await h.settle();
    const back = tts(h, mark).filter((m) => m.t === "rejoin");
    await h.settle(); ok("drop: the board in again says 'back' to the table, for that seat", back.length === 1 && back[0].color === "Blue" && back[0].state === "back", JSON.stringify(back));
    await h.settle(); ok("drop: the log says how long it took", logs(h, mark).some((l) => /^Blue: back in the game \d+\.\d s after the link dropped$/.test(l)), logs(h, mark).slice(-4).join(" | "));
    frame(second, { type: "StateUpdate", state: { kind: "state", forPlayer: "player-0", state: structuredClone(BOARD), fingerprint: "f2" } });
    await h.settle(); ok("drop: said once (the next board says nothing more)", tts(h, mark).filter((m) => m.t === "rejoin").length === 1, tts(h, mark).filter((m) => m.t === "rejoin").length);
    seat.close();
    await h.flush();
    harness.restore();
  }
  // 1b. a board delta also counts; a table not drawing the game (fromTable false) is sent nothing
  {
    const h = harness.load();
    const seat = setup(h, { fromTable: false });
    h.sockets.at(-1).emit("close");
    await until(h, () => h.sockets.length > 1, 3000);
    const s2 = h.sockets.at(-1);
    s2.emit("open");
    frame(s2, { type: "AuthResult", success: true, reconnected: true });
    const mark = h.effects.length;
    frame(s2, { type: "StateUpdate", state: { kind: "stateDelta", forPlayer: "player-0", base: "f0", patch: [], fingerprint: "f1" } });
    await h.settle(); ok("delta: a delta on the board is back in (logged)", logs(h, mark).some((l) => /^Blue: back in the game/.test(l)) && seat.rejoining == null, logs(h, mark).join(" | "));
    await h.settle(); ok("delta: no rejoin message to a table that doesn't draw the game", !tts(h, mark).some((m) => m.t === "rejoin"), JSON.stringify(tts(h, mark)));
    seat.close();
    await h.flush();
    harness.restore();
  }
  // 1c. the give-up after a minute ends the rejoin: a board much later says no 'back'
  {
    const h = harness.load();
    const seat = setup(h);
    for (let k = 0; k < 20; k++) {
      const s = h.sockets.at(-1);
      if (!s.closedOnce) { s.closedOnce = true; s.emit("close"); }
      await h.flush(1);
    }
    await h.settle(); ok("give up: said (couldn't reconnect ... mtg reset)", chats(h).some((t) => /^\[MTG\] Blue couldn't reconnect to the engine within a minute.*mtg reset/.test(t)), chats(h).slice(-2).join(" | "));
    await h.settle(); ok("give up: the seat is not rejoining any more", seat.rejoining == null, seat.rejoining);
    seat.close();
    harness.restore();
  }
  // 2. a relay restart: the room refuses the seat past the window
  {
    const h = harness.load();
    const seat = setup(h);
    h.sockets.at(-1).emit("close");
    await until(h, () => h.sockets.length > 1, 3000);
    const s2 = h.sockets.at(-1);
    s2.emit("open");
    frame(s2, { type: "AuthResult", success: true, reconnected: false });
    frame(s2, { type: "Error", code: "room_not_found", message: "Room not found" });
    await h.settle();
    const mid = chats(h);
    await h.settle(); ok("window: inside it, a refusal is tried again quietly", !mid.some((t) => /Relay:|couldn't get back/.test(t)), mid.join(" | "));
    const t0 = Date.now();
    await until(h, () => Date.now() - t0 >= 56000, 60000);
    await h.settle();
    const mark = h.effects.length;
    frame(s2, { type: "Error", code: "room_not_found", message: "Room not found" });
    frame(s2, { type: "Error", code: "game_not_in_progress", message: "no game" });
    await h.settle();
    const said = chats(h, mark);
    await h.settle(); ok("window: past it, said plainly what to do", said.length === 1 && said[0] === '[MTG] Blue couldn\'t get back into the game: the engine no longer holds that seat. Type "mtg reset" to start over.', said.join(" | "));
    await h.settle(); ok("window: not 'Relay: Room not found'", !said.some((t) => /Relay:/.test(t)), said.join(" | "));
    await h.settle(); ok("window: the log says it gave up", logs(h, mark).some((l) => /^Blue: rejoin refused \(room_not_found\) after 55 s of tries; gave up$/.test(l)), logs(h, mark).join(" | "));
    await h.settle(); ok("window: the second refusal is logged only", logs(h, mark).some((l) => l === "Blue: rejoin refused (game_not_in_progress) again"), logs(h, mark).join(" | "));
    await h.settle(); ok("window: the rejoin is over (no 'back' later)", seat.rejoining == null && seat.rejoinUntil == null, `${seat.rejoining} ${seat.rejoinUntil}`);
    seat.close();
    await h.flush();
    harness.restore();
  }
  // 3. a bridge restart resumes the saved game: sent to the table once every seat's board is in
  const snap = (seats) => JSON.stringify({ savedAt: Date.now() - 4000, game: { bots: 0, total: 2, playerOrder: seats.map((s) => s.username),
    slotNames: { "player-0": "Blue", "player-1": "Red" }, slotColor: { "player-0": "Blue", "player-1": "Red" }, fromTable: true, roomId: "room-9", deckNames: [] }, seats });
  const SEATS = [{ color: "Blue", deckId: "neheb_minotaur_commander", username: "tts-Blue-abcd", slot: "player-0", roomId: "room-9" },
    { color: "Red", deckId: "neheb_minotaur_commander", username: "tts-Red-abcd", slot: "player-1", roomId: "room-9" }];
  const login = (h, i) => { const s = h.sockets[i]; s.emit("open"); frame(s, { type: "AuthResult", success: true, reconnected: true }); return s; };
  const boardTo = (s, slot) => frame(s, { type: "StateUpdate", state: { kind: "state", forPlayer: slot, state: structuredClone(BOARD), fingerprint: "r" } });
  const started = (h, from = 0) => tts(h, from).filter((m) => m.t === "started").length;
  {
    const h = harness.load();
    await fs.promises.writeFile(process.env.MTG_RESUME_FILE, snap(SEATS));
    const mark = h.effects.length;
    await h.settle(); ok("resume: (resumed)", h.B.resumeGame() === true);
    await h.settle(); ok("resume: everyone is told the bridge is rejoining", chats(h, mark).includes("[MTG] The bridge restarted: rejoining the game..."), chats(h, mark).join(" | "));
    const sb = login(h, 0), sr = login(h, 1);
    boardTo(sb, "player-0");
    await h.settle(); ok("resume: one seat's board in: not sent yet", started(h, mark) === 0, started(h, mark));
    boardTo(sr, "player-1");
    await h.settle(); ok("resume: every seat's board in: the game is sent to the table at once (no 3 s wait)", started(h, mark) === 1 && Date.now() - 1792500000000 < 3000, `${started(h, mark)} at ${Date.now() - 1792500000000} ms`);
    await h.settle();
    const back = tts(h, mark).filter((m) => m.t === "rejoin").map((m) => m.color).sort();
    await h.settle(); ok("resume: each seat is said back", JSON.stringify(back) === '["Blue","Red"]', JSON.stringify(back));
    for (let k = 0; k < 12; k++) await h.flush(1); // past the 3 s timer
    await h.settle(); ok("resume: and not sent a second time by the 3 s timer", started(h, mark) === 1, started(h, mark));
    for (const s of h.B._getGame().seats.values()) s.close();
    await h.flush();
    harness.restore();
  }
  {
    const h = harness.load();
    await fs.promises.writeFile(process.env.MTG_RESUME_FILE, snap(SEATS));
    const mark = h.effects.length;
    h.B.resumeGame();
    const sb = login(h, 0);
    login(h, 1);
    boardTo(sb, "player-0"); // Red's board never comes
    await until(h, () => started(h, mark) > 0, 3500);
    await h.settle(); ok("resume: a seat's board missing: sent at 3 s, as before", started(h, mark) === 1 && Date.now() - 1792500000000 >= 3000, `${started(h, mark)} at ${Date.now() - 1792500000000} ms`);
    for (const s of h.B._getGame().seats.values()) s.close();
    await h.flush();
    harness.restore();
  }
  await fs.promises.unlink(process.env.MTG_RESUME_FILE).catch(() => {});
  console.log(failed ? `\n${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
})();
