// The rejoin prompt, the table's side (tools/engine-renderer.lua engineRejoin; the bridge's side is
// tests/test_bridge_rejoin.js). A player on their way back sees on their own screen (the middle banner,
// eng_result_<colour>) "Rejoining: the table is updating for you..." with the step, then "You're back in"; a way back
// that fails says "Couldn't rejoin" (the bridge's chat says what to do). Everyone else: "<colour> is rejoining..." and
// "<colour> is back." Covered: a TTS drop and the seat taken again (and a player connecting while a seat is empty),
// the engine link dropping (the bridge's REAL chat lines, produced here by the bridge itself, so a reworded line fails
// here by name), a bridge restart, a give-up, a rewind to before a concession; and no game: nothing.
// Boards are made up in the bridge's shape: Yellow and Blue seated, White and Red AIs.
//   node tests/test_rejoin_prompt.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");
const harness = require("./bridge-harness");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}\n`); } };
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
const json = (r, mark) => { try { return JSON.parse(String(valueOf(r, mark))); } catch (e) { return {}; } };
// what a colour was told (broadcastToColor), as one text
const toldTo = (r, mark, color) => fxOf(r, mark).filter((l) => l.includes('"broadcastToColor"') && l.includes(`"${color}"`)).join(" | ");
const tlogs = (r) => r.steps.flatMap((st) => (st.fx || []).filter((l) => /WebRequest\.custom/.test(l) && /tlog/.test(l))).join(" ").split("\\").join("");

// ── the bridge's own lines, from the bridge ──
async function bridgeLines() {
  const h = harness.load();
  const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));
  const seat = new h.B.Seat("Yellow", "neheb_minotaur_commander");
  seat.slot = "player-2";
  seat.roomId = "room-1";
  seat.board = { state: { gameView: { turn: 2, players: [], zones: [] } }, fingerprint: "f0" };
  h.B._setGame({ seats: new Map([["Yellow", seat]]), bots: 2, total: 4, playerOrder: [], slotNames: { "player-2": "Yellow" }, slotColor: { "player-2": "Yellow" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  const msgs = () => h.effects.filter((e) => e.tts).map((e) => e.tts);
  h.sockets.at(-1).emit("close");
  for (let k = 0; k < 5 && h.sockets.length < 2; k++) await h.flush(1);
  const s2 = h.sockets.at(-1);
  s2.emit("open");
  frame(s2, { type: "AuthResult", success: true, reconnected: true });
  frame(s2, { type: "StateUpdate", state: { kind: "state", forPlayer: "player-2", state: { gameView: { turn: 2, players: [], zones: [] } }, fingerprint: "f1" } });
  await h.settle();
  const out = { lost: null, reconnected: null, back: null, gaveUp: null, restarted: null };
  for (const m of msgs()) {
    if (m.t === "chat" && /lost the engine connection/.test(m.text)) out.lost ??= m;
    if (m.t === "chat" && /reconnected to the engine/.test(m.text)) out.reconnected ??= m;
    if (m.t === "rejoin") out.back ??= m;
  }
  // the give-up after a minute
  for (let k = 0; k < 40; k++) { const s = h.sockets.at(-1); if (!s.closedOnce) { s.closedOnce = true; s.emit("close"); } await h.flush(1); }
  await h.settle();
  out.gaveUp = msgs().find((m) => m.t === "chat" && /couldn't reconnect/.test(m.text)) || null;
  seat.close();
  await h.flush();
  harness.restore();
  // the bridge restart's line
  const h2 = harness.load();
  await require("fs").promises.writeFile(process.env.MTG_RESUME_FILE, JSON.stringify({ savedAt: Date.now() - 2000, game: { bots: 2, total: 4, playerOrder: [], slotNames: {}, slotColor: {}, fromTable: true, deckNames: [] },
    seats: [{ color: "Yellow", deckId: "neheb_minotaur_commander", username: "tts-Yellow-abcd", slot: "player-2", roomId: "r" }] }));
  h2.B.resumeGame();
  await h2.settle();
  out.restarted = h2.effects.filter((e) => e.tts).map((e) => e.tts).find((m) => m.t === "chat" && /bridge restarted/.test(m.text)) || null;
  for (const s of h2.B._getGame().seats.values()) s.close();
  await h2.flush();
  harness.restore();
  await require("fs").promises.unlink(process.env.MTG_RESUME_FILE).catch(() => {});
  return out;
}

const cards = {
  "engine-card-601": { n: "Llanowar Elves", f: "https://example.invalid/elves.jpg", b: "", tl: "Creature — Elf Druid", ty: ["Creature"] },
  "engine-card-602": { n: "Counterspell", f: "https://example.invalid/counter.jpg", b: "", tl: "Instant", ty: ["Instant"] },
  "engine-card-603": { n: "Forest", f: "https://example.invalid/forest.jpg", b: "", tl: "Basic Land — Forest", ty: ["Land"] },
};
function board(turn = 2, yellowStatus = "playing") {
  const pl = (color, slot, hand, status = "playing") => ({
    color, slot, name: color === "White" ? "AI 1" : color === "Red" ? "AI 2" : color, ai: color === "White" || color === "Red", life: 40, status, pool: {},
    cmdDamage: {}, tax: [], library: 50, handCount: hand ? hand.length : 3, hand: hand ? hand.map((id) => ({ s: 1, id, ctl: color })) : null,
    battlefield: [], graveyard: [], exile: [], command: [],
  });
  return { msg: { t: "table", json: JSON.stringify({ t: "table", turn, step: "main1", active: "Blue", activeTurnNo: 1, priority: "Blue", gameOver: false, winner: null,
    players: [pl("White", "player-0"), pl("Red", "player-1"), pl("Yellow", "player-2", yellowStatus === "playing" ? ["engine-card-601", "engine-card-602"] : [], yellowStatus), pl("Blue", "player-3", ["engine-card-603"])],
    stack: [], cards }) }, frames: 60 };
}
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" },
  names: { "player-0": "AI 1", "player-1": "AI 2", "player-2": "Yellow", "player-3": "Blue" }, ai: ["White", "Red"] });
const prelude = q('engineAutoPace.Yellow = false engineAutoPace.Blue = false engineChat("mtg start ai 2", Player.Blue) return "ok"', "prelude");
const game = [prelude, { msg: { t: "started", json: STARTED } }, board()];
const chat = (m) => ({ msg: { t: "chat", json: JSON.stringify(m) }, frames: 6 });
// Yellow's banner: shown?, its text
const BANNER = (c = "Yellow") => `return JSON.encode({ on = tostring(engineUI.getAttribute("eng_result_${c}", "active")), text = tostring(engineUI.getValue("eng_result_${c}")) })`;
const shown = (r, mark, re) => { const b = json(r, mark); return b.on === "true" && re.test(String(b.text)); };

(async () => {
  const lines = await bridgeLines();
  ok("bridge: (its lines were produced)", lines.lost && lines.reconnected && lines.back && lines.gaveUp && lines.restarted, JSON.stringify(lines));

  // ── 1. TTS drop: away and back in the seat ──
  {
    const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [...game,
      q('onPlayerDisconnect(Player.Yellow) __sim.seated.Yellow = nil return "ok"', "away", 70),
      // someone connects as a spectator while Yellow's seat is empty
      q('onPlayerConnect(Player.Grey) return "ok"', "grey connects", 2),
      q('__sim.seated.Yellow = true onPlayerConnect(Player.Yellow) onPlayerChangeColor("Yellow") return "ok"', "back", 20),
      q(BANNER(), "banner back"),
      q("return 'ok'", "hold", 200),
      q(BANNER(), "banner done"),
      q("return 'ok'", "later", 200),
      q(BANNER(), "banner later"),
    ] });
    ok("tts: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
    const grey = fxOf(r, "grey connects").filter((l) => /Player\.broadcast/.test(l)).join(" | ");
    ok("tts: a player connecting while a seat is empty is told the game kept it and where to sit", /"Grey".*If you were playing, sit at your colour \(Yellow\) to rejoin/.test(grey), grey);
    ok("tts: Yellow connecting in their seat is told the table is updating", /"Yellow".*Rejoining: the table is updating for you/.test(fxOf(r, "back").filter((l) => /Player\.broadcast/.test(l)).join(" | ")), fxOf(r, "back").filter((l) => /broadcast/.test(l)).join(" | "));
    ok("tts: back in the seat, Yellow's screen says Rejoining (redrawing)", shown(r, "banner back", /^Rejoining: the table is updating for you\.\.\.\nredrawing your hand and board$/), valueOf(r, "banner back"));
    ok("tts: Blue is told Yellow is rejoining", /Yellow is rejoining\.\.\./.test(toldTo(r, "back", "Blue")), toldTo(r, "back", "Blue"));
    ok("tts: Yellow isn't told 'Yellow is rejoining'", !/Yellow is rejoining/.test(toldTo(r, "back", "Yellow")), toldTo(r, "back", "Yellow"));
    ok("tts: then 'You're back in' on Yellow's screen", shown(r, "banner done", /^You're back in$/), valueOf(r, "banner done"));
    ok("tts: and Blue is told Yellow is back", /Yellow is back\./.test(toldTo(r, "hold", "Blue")), toldTo(r, "hold", "Blue"));
    ok("tts: the banner goes away", json(r, "banner later").on === "false", valueOf(r, "banner later"));
    ok("tts: the table log has how long the seat was out and the prompt up", /Yellow was out of the seat \d+\.\d s/.test(tlogs(r)) && /Yellow back in \(tts\), the prompt up \d+\.\d s/.test(tlogs(r)), tlogs(r).slice(0, 600));
  }

  // ── 2. the engine link: the bridge's real lines, then its "back" ──
  {
    const msg = (m) => ({ msg: { t: m.t, json: JSON.stringify(m) }, frames: 6 });
    const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [...game,
      { ...msg(lines.lost), mark: "lost" }, q(BANNER(), "b1"),
      { ...msg(lines.reconnected) }, q(BANNER(), "b2"),
      { ...msg(lines.back) }, q(BANNER(), "b3"),
      board(3), q("return 'ok'", "settle", 20), q(BANNER(), "b4"),
    ] });
    ok("relay: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
    ok("relay: lost: step 1 of 3 on Yellow's screen", shown(r, "b1", /^Rejoining: the table is updating for you\.\.\.\n1 of 3: reconnecting to the engine$/), valueOf(r, "b1"));
    ok("relay: reconnected: step 2 of 3", shown(r, "b2", /\n2 of 3: resyncing the game$/), valueOf(r, "b2"));
    ok("relay: back: step 3 of 3", shown(r, "b3", /\n3 of 3: redrawing your hand and board$/), valueOf(r, "b3"));
    ok("relay: after the board, 'You're back in'", shown(r, "b4", /^You're back in$/), valueOf(r, "b4"));
    const blue = r.steps.flatMap((s) => (s.fx || []).filter((l) => l.includes('"broadcastToColor"') && l.includes('"Blue"'))).join(" | ");
    ok("relay: Blue is told rejoining, then back, once each", (blue.match(/Yellow is rejoining/g) || []).length === 1 && (blue.match(/Yellow is back\./g) || []).length === 1, blue);
    ok("relay: the bridge's chat line still shows as before", r.steps.some((s) => (s.fx || []).some((l) => l.includes("lost the engine connection. Reconnecting..."))), "");
  }
  // "back" with no board after it (the same board isn't sent again): back in anyway
  {
    const msg = (m) => ({ msg: { t: m.t, json: JSON.stringify(m) }, frames: 6 });
    const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [...game,
      msg(lines.lost), msg(lines.reconnected), msg(lines.back), q("return 'ok'", "wait", 200), q(BANNER(), "b"),
    ] });
    ok("relay, no board: back in all the same", !r.errors.length && shown(r, "b", /^You're back in$/), `${r.errors[0] || ""} ${valueOf(r, "b")}`);
  }
  // ── 3. a give-up ──
  {
    const msg = (m) => ({ msg: { t: m.t, json: JSON.stringify(m) }, frames: 6 });
    const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [...game,
      msg(lines.lost), msg(lines.gaveUp), q(BANNER(), "b"), q("return 'ok'", "later", 120), q(BANNER(), "b later"),
    ] });
    ok("give up: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
    ok("give up: Yellow's screen says it couldn't rejoin, see the chat", shown(r, "b", /^Couldn't rejoin\nsee the chat for what to do$/), valueOf(r, "b"));
    ok("give up: no 'You're back in' after it", !/back in/.test(String(json(r, "b later").text)), valueOf(r, "b later"));
  }
  // ── 4. a bridge restart: every human seat ──
  {
    const msg = (m) => ({ msg: { t: m.t, json: JSON.stringify(m) }, frames: 6 });
    const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [...game,
      msg(lines.restarted), q(BANNER("Yellow"), "y"), q(BANNER("Blue"), "b"), q(BANNER("White"), "w"),
    ] });
    ok("restart: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
    ok("restart: Yellow and Blue each see step 1 of 3", shown(r, "y", /\n1 of 3: reconnecting to the engine$/) && shown(r, "b", /\n1 of 3: reconnecting to the engine$/), `${valueOf(r, "y")} ${valueOf(r, "b")}`);
    ok("restart: no banner for an AI seat", json(r, "w").on !== "true", valueOf(r, "w"));
  }
  // ── 5. a rewind to before Yellow's concession ──
  {
    const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [...game,
      board(4, "conceded"), q(BANNER(), "out"),
      { ...board(3, "playing"), mark: "rewound" }, q(BANNER(), "b"),
      q("return 'ok'", "hold", 60), q(BANNER(), "done"),
    ] });
    ok("rewind: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
    ok("rewind: (no banner while out)", json(r, "out").on !== "true" || !/Rejoining/.test(json(r, "out").text), valueOf(r, "out"));
    ok("rewind: brought back, Yellow's screen says Rejoining (redrawing)", shown(r, "b", /^Rejoining: the table is updating for you\.\.\.\nredrawing your hand and board$/), valueOf(r, "b"));
    ok("rewind: then 'You're back in'", shown(r, "done", /^You're back in$/), valueOf(r, "done"));
    const blue = r.steps.flatMap((s) => (s.fx || []).filter((l) => l.includes('"broadcastToColor"') && l.includes('"Blue"'))).join(" | ");
    ok("rewind: Blue isn't told twice (the bridge says 'is back in the game')", !/Yellow is rejoining|Yellow is back\./.test(blue), blue);
  }
  // ── 6. no game: nothing ──
  {
    const msg = (m) => ({ msg: { t: m.t, json: JSON.stringify(m) }, frames: 6 });
    const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [msg(lines.lost), msg(lines.back), q('onPlayerConnect(Player.Grey) return "ok"', "c"), q(BANNER(), "b")] });
    ok("no game: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
    ok("no game: no banner, nobody told of a rejoin", json(r, "b").on !== "true" && !r.steps.some((s) => (s.fx || []).some((l) => /is rejoining|Rejoining:|sit at your colour/.test(l))), valueOf(r, "b"));
  }
  console.log(failed ? `\n${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
})();
