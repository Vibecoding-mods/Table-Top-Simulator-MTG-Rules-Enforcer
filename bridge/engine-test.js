// Engine round-trip latency test (SPEC.md §6, test 2 / milestone M2).
// Joins the local Forge room as one seat, fills the rest with Forge AI bots,
// auto-plays its own seat, and times every response → next engine message.
//   node engine-test.js [--seats 2] [--turns 8] [--deck neheb_minotaur_commander] [--minutes 10] [--full] [--format standard]
// --format standard: a Standard game (docs/game-modes-spec.md §3): StartGame "Standard" (the relay's 20 life), every
// deck a Standard one with its sideboard and no commander, this seat's default deck standard_dimir_aggro and the bots'
// the other three built-in Standard decks.
// --mode 2hg|2v2|juggernaut: a team game (docs/game-modes-spec.md §4-§6) for four seats: the teams go to the node as
// gameConfig before StartGame (bridge/teams.js gameConfig, as the bridge sends them), the seats sat White, Red, Yellow,
// Blue in join order (this seat first), so White + Red against Yellow + Blue; --jugg <colour> (default White, this seat)
// is the Juggernaut with its default settings (--jugg-cmd 42, --jugg-order after). At the end it logs every player's life
// and result and which side won (teamsField).
// --full: don't announce a client version, so the relay sends whole states instead of change-only patches.
// Needs the stack from ../stack/compose.yml running. Node 22+ (built-in WebSocket).
const fs = require("fs");
const delta = require("./state-delta");
const path = require("path");

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const RELAY = arg("relay", "ws://127.0.0.1:9443");
const KEY = arg("key", "tts-local");
const ROOM = arg("room", "tts-commander");
const SEATS = Number(arg("seats", 2));
const MAX_TURNS = Number(arg("turns", 8));
const MINUTES = Number(arg("minutes", 10));
const FORMAT = arg("format", "commander") === "standard" ? "standard" : "commander";
const STD = FORMAT === "standard";
const ROOM_FORMAT = STD ? "Standard" : "Commander";
const DECK_ID = arg("deck", STD ? "standard_dimir_aggro" : "neheb_minotaur_commander");
const BOT_DECK_IDS = STD ? ["standard_rakdos_ingris", "standard_mono_green_landfall", "standard_orzhov_soul_sisters"]
  : ["ashling_limitless_commander", "ramses_commander", "real_teval_commander"];
const { presetFile } = require("./presets");
const FULL = process.argv.includes("--full");
const teams = require("./teams");
const TEAM_MODE = arg("mode", "");
if (TEAM_MODE && !teams.TEAM_MODES[TEAM_MODE]) throw new Error(`--mode ${TEAM_MODE}: use 2hg, 2v2 or juggernaut`);
if (TEAM_MODE && SEATS !== 4) throw new Error(`--mode ${TEAM_MODE} needs --seats 4`);
const JUGG = TEAM_MODE === "juggernaut" ? teams.juggOf({ color: arg("jugg", "White"), cmd: arg("jugg-cmd", 21), order: arg("jugg-order", "first") }) : null;
const SEAT_COLORS = teams.seatColorsFor(SEATS); // (the six-seat table's colours past four seats)
const BOTS = Number(arg("bots", SEATS - 1)); // Forge AI seats to request; 0 when other test clients fill the table
const TAG = arg("tag", "");
const DUMP = arg("dump", ""); // write last board + one sample of each prompt type here
const promptSamples = {};
const CLIENT_VERSION = "3.56.0"; // >= 3.17.0 tells the relay we apply stateDelta patches
const USERNAME = `tts-test-${Math.random().toString(36).slice(2, 7)}`;

function loadPreset(id) {
  const p = JSON.parse(fs.readFileSync(presetFile(id), "utf8"));
  const toCard = (e) => ({
    identity: process.env.NOSET ? { name: e.name, setCode: "", cardNumber: "" } : { name: e.name, setCode: e.set || "", cardNumber: String(e.cardNumber || "") },
    manaCost: e.manaCost || "", cmc: e.cmc || 0, types: e.types || [], subtypes: e.subtypes || [],
    supertypes: e.supertypes || [], colorIdentity: e.colorIdentity || [], text: e.text || "",
    uris: {},
  });
  const cards = [];
  let commander = null;
  if (STD && p.format !== "standard") throw new Error(`--format standard: ${id} is not a Standard deck`);
  for (const e of p.cards) {
    if (p.commander && e.name === p.commander && !commander) { commander = toCard(e); continue; }
    for (let k = 0; k < (e.count || 1); k++) cards.push(toCard(e));
  }
  const sideboard = STD ? (p.sideboard || []).flatMap((e) => Array.from({ length: e.count || 1 }, () => toCard(e))) : [];
  const deck = { name: p.label, cards, sideboard, format: FORMAT };
  if (commander && !STD) deck.commanders = [commander];
  if (STD) return { deckName: p.label, deck, commanderName: null };
  return { deckName: p.label, deck, commanderName: p.commander || null };
}

const now = () => performance.now();
const t0 = now();
const log = (...a) => console.log(`[${((now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

const samples = []; // one per response we send
let pending = null; // { sentAt, promptType, promptId }
let slot = null;
let turn = 0;
let promptsSeen = 0;
let lastPayCard = null;
let actsThisPrompt = 0;
let finished = false;
let exitCode = 0; // (Standard checks below set it to 1)
let firstActive = null; // the player whose turn 1 it was (Standard: their library at turn 2 shows the first draw rule)
let gameOverSeen = false;
let firstDrawChecked = false; // (only when this seat started: the bots may mulligan)
let board = null; // { state, fingerprint }
const deltaStats = { full: 0, patches: 0, resyncs: 0, mismatches: 0, applyMs: [] };
const failedActions = new Set();

const ws = new WebSocket(RELAY);
const send = (msg) => ws.send(JSON.stringify(msg));
const broadcast = (state) => send({ type: "BroadcastState", state });

ws.addEventListener("open", () => {
  log(`connected to ${RELAY} as ${USERNAME}`);
  send({ type: "Authenticate", username: USERNAME, password: KEY, service: false, client_platform: "unknown", engine_gate: "unknown", ...(FULL ? {} : { client_version: CLIENT_VERSION }) });
});
ws.addEventListener("close", () => { if (!finished) { log("relay closed the connection"); finish(1); } });
ws.addEventListener("error", (e) => log("websocket error", e.message || ""));

let roomId = null;
let joined = false;
let started = false;

ws.addEventListener("message", (ev) => {
  const raw = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8");
  const msg = JSON.parse(raw);
  switch (msg.type) {
    case "AuthResult":
      if (!msg.success) { log("auth failed:", msg.error); return finish(1); }
      log("authenticated");
      send({ type: "ListRooms" });
      break;
    case "RoomList": {
      if (roomId) break;
      const room = msg.rooms.find((r) => r.room_name === ROOM);
      if (!room) { log(`room "${ROOM}" not found; rooms:`, msg.rooms.map((r) => r.room_name)); return finish(1); }
      roomId = room.room_id;
      log(`joining ${ROOM} (${roomId}), status ${room.status}, ${room.players.length}/${room.max_players} seated`);
      send({ type: "JoinRoom", room_id: roomId, observe: false, as_bot: false });
      break;
    }
    case "RoomUpdate": {
      const room = msg.room;
      if (room.room_id !== roomId) break;
      const me = room.players.find((p) => p.username === USERNAME);
      if (me && !joined) {
        joined = true;
        const mine = loadPreset(DECK_ID);
        send({ type: "SetDeckSelection", deck_name: mine.deckName, deck: mine.deck, commander_name: mine.commanderName });
        // (the relay only takes StartGame's format in an "Any" room; the node's room is Commander, so the format is set
        // first: SetFormat picks the relay's starting life and the node's Forge variant, and un-readies the people)
        if (room.format !== ROOM_FORMAT) send({ type: "SetFormat", format: ROOM_FORMAT });
        send({ type: "SetReady", ready: true });
        const bots = Array.from({ length: BOTS }, (_, i) => BOT_DECK_IDS[i % BOT_DECK_IDS.length]).map(loadPreset); // decks repeat past 3 bots (M6)
        log(`deck "${mine.deckName}" set; ${bots.length ? `asking node for ${bots.length} Forge AI bot(s)` : "waiting for other test clients"}`);
        if (bots.length) broadcast({
          kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId: `tts-${Date.now()}`, roomId,
          payload: { type: "spawnBot", deck: bots[0], decks: bots, forgeAi: true },
        });
      }
      const ready = room.players.filter((p) => p.ready && p.connected).length;
      if (joined && !started && room.status === "Lobby" && ready >= SEATS) {
        started = true;
        log(`all ${SEATS} seats ready: ${room.players.map((p) => p.username).join(", ")}; starting`);
        const order = room.players.map((p) => p.username);
        if (TEAM_MODE) {
          const t = JUGG ? teams.juggTeams(JUGG.color) : { ...teams.DEFAULT_TEAMS };
          const problem = teams.teamsProblem(t, order.length, TEAM_MODE);
          if (problem) { log(`teams refused: ${problem}`); return finish(1); }
          const payload = teams.gameConfig(t, order, SEAT_COLORS, TEAM_MODE, JUGG, STD);
          log(`${TEAM_MODE}: ${order.map((u, i) => `${SEAT_COLORS[i]}=${u}`).join(", ")}; gameConfig ${JSON.stringify(payload)}`);
          broadcast({ kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId: `tts-${Date.now()}-teams`, roomId, payload });
        }
        send({ type: "StartGame", format: STD ? "Standard" : "Commander", ...(TEAM_MODE ? { seat_order: order } : {}) });
      }
      break;
    }
    case "GameStarted":
      slot = `player-${msg.player_order.indexOf(USERNAME)}`;
      log(`game started: ${msg.game_id}, we are ${slot}, order ${msg.player_order.join(" → ")}, life ${msg.starting_life}`);
      if (STD && msg.starting_life !== 20) { log(`FAIL: Standard started at ${msg.starting_life} life, not 20`); exitCode = 1; }
      break;
    case "StateUpdate":
      onEnvelope(msg.state, raw.length);
      break;
    case "Error":
      log("relay error:", msg.code, msg.message);
      break;
    case "GameAborted":
      log("game aborted by relay");
      finish(1);
      break;
  }
});

function onEnvelope(env, bytes) {
  if (!env || !slot) return;
  const forUs = env.forPlayer === slot;
  // The first engine message addressed to us after a response closes that response's timing.
  if (pending && forUs && (env.kind === "state" || env.kind === "stateDelta" || env.kind === "prompt" || env.kind === "error")) {
    samples.push({
      n: samples.length + 1, turn, prompt: pending.promptType, reply: env.kind,
      rtt_ms: now() - pending.sentAt, engine_ms: env.engineMs ?? "", emit_ms: env.emitMs ?? "", bytes,
    });
    pending = null;
  }
  switch (env.kind) {
    case "state":
      if (forUs) { deltaStats.full++; board = { state: env.state, fingerprint: env.fingerprint ?? null }; onBoard(bytes); }
      break;
    case "stateDelta":
      if (!forUs) break;
      if (!board || board.fingerprint !== env.base) { deltaStats.resyncs++; send({ type: "RequestResync" }); break; }
      {
        const a = now();
        const next = delta.apply(board.state, env.patch);
        deltaStats.applyMs.push(now() - a);
        deltaStats.patches++;
        if (delta.fingerprint(next) !== env.fingerprint) deltaStats.mismatches++;
        board = { state: next, fingerprint: env.fingerprint };
        onBoard(bytes);
      }
      break;
    case "prompt":
      if (env.forPlayer === slot) answer(env.prompt);
      break;
    case "error":
      if (forUs) { log("engine rejected our response:", JSON.stringify(env.error)); if (lastAct) failedActions.add(lastAct); }
      break;
    case "fatal":
      log("engine fatal:", env.message);
      finish(1);
      break;
  }
}

// Standard (spec §3.1): nothing in a command zone, no commander casts (tax) or commander damage, at any point
function stdFail(why) { if (exitCode === 0 || !stdFail.seen?.has(why)) log(`FAIL: ${why}`); (stdFail.seen ??= new Set()).add(why); exitCode = 1; }
function stdBoardChecks() {
  const gv = board.state?.gameView || {};
  for (const z of gv.zones || []) if (z.zone === "command" && z.count) stdFail(`${z.ownerId} has ${z.count} card(s) in the command zone`);
  for (const p of gv.players || []) {
    if (Object.keys(p.commanderCasts || {}).length) stdFail(`${p.id} has commander casts ${JSON.stringify(p.commanderCasts)}`);
    if (Object.keys(p.commanderDamage || {}).length) stdFail(`${p.id} has commander damage ${JSON.stringify(p.commanderDamage)}`);
  }
}

// the end of the game: who won, on which turn, and everyone's life and status (Standard: one player left, the winner)
function reportEnd() {
  const gv = board?.state?.gameView || {};
  const players = gv.players || [];
  const deckOf = (id) => {
    if (id === slot) return DECK_ID;
    const seen = shownCards.get(id) || new Set();
    let best = "unknown deck", most = 0;
    for (const d of new Set(BOT_DECK_IDS)) {
      const n = JSON.parse(fs.readFileSync(presetFile(d), "utf8")).cards.filter((c) => seen.has(c.name)).length;
      if (n > most) { most = n; best = d; }
    }
    return best;
  };
  log(`game over on turn ${gv.turn}: winner ${gv.winnerId ?? "none"}${gv.winnerId ? ` (${gv.winnerId === slot ? "this test seat" : "Forge AI"}, ${deckOf(gv.winnerId)})` : ""}`);
  for (const p of players) log(`  ${p.id} (${deckOf(p.id)}): life ${p.life}, poison ${p.counters?.POISON ?? 0}, ${p.status}`);
  if (STD) {
    const left = players.filter((p) => p.status !== "lost");
    if (!gv.gameOver) stdFail("game over prompt but the board says the game is not over");
    if (!gv.winnerId) stdFail("no winner");
    else if (left.length !== 1 || left[0].id !== gv.winnerId) stdFail(`winner ${gv.winnerId} but still playing: ${left.map((p) => p.id).join(", ")}`);
  }
}

// the non-basic cards each player has shown (outside library and hand), kept all game: the bots' decks are named by
// them at the end (the node seats the bots in its own order, and a player who loses a free-for-all leaves with their cards)
const shownCards = new Map();
function noteShown() {
  for (const z of board.state?.gameView?.zones || []) {
    if (z.zone === "library" || z.zone === "hand") continue;
    for (const c of z.cards || []) if (c.identity?.name && !(c.supertypes || []).includes("Basic")) {
      if (!shownCards.has(c.ownerId)) shownCards.set(c.ownerId, new Set());
      shownCards.get(c.ownerId).add(c.identity.name);
    }
  }
}

function onBoard(bytes) {
  noteShown();
  const t = board.state?.gameView?.turn ?? turn;
  if (t !== turn) {
    turn = t;
    log(`turn ${turn} (last message ${(bytes / 1024).toFixed(1)} KB, board ${(JSON.stringify(board.state).length / 1024).toFixed(0)} KB)`);
    // (Standard, spec §3.1: 20 life; a 60-card library is 53 after the opening hand, so at turn 2 the 1v1 starting
    // player still has 53 (no first draw) and in a free-for-all everyone who has had a turn has 52)
    // (a team game too: the Juggernaut's extra draw shows as a library one card shorter each of its turns)
    if (STD || TEAM_MODE) {
      const gv = board.state?.gameView || {};
      const lib = (id) => (gv.zones || []).find((z) => z.zone === "library" && z.ownerId === id)?.count;
      log(`  ${(gv.players || []).map((p) => `${p.id}: life ${p.life}, library ${lib(p.id)}, hand ${(gv.zones || []).find((z) => z.zone === "hand" && z.ownerId === p.id)?.count ?? "?"}`).join("; ")}`);
      if (STD) {
        if (turn === 1) {
          firstActive = gv.activePlayerId;
          for (const p of gv.players || []) if (p.life !== 20) stdFail(`${p.id} starts turn 1 at ${p.life} life, not 20`);
        }
        // (we always keep 7, so only our own library is sure: 53 at turn 2 in 1v1 (103.8a), 52 in a free-for-all (103.8c))
        if (turn === 2 && firstActive === slot) {
          const want = SEATS === 2 ? 53 : 52;
          if (lib(slot) !== want) stdFail(`we started; our library at turn 2 is ${lib(slot)}, not ${want} (first draw rule)`);
          else firstDrawChecked = true, log(`  first draw rule ok: ${slot} started, library ${want} at turn 2`);
        } else if (turn === 2) log(`  ${firstActive} started (library ${lib(firstActive)} at turn 2: ${SEATS === 2 ? 53 : 52} if it kept 7)`);
      }
    }
  }
  if (STD) stdBoardChecks();
  if (turn > MAX_TURNS) finish(0);
}

let lastAct = null;
function respond(prompt, type, output) {
  pending = { sentAt: now(), promptType: type, promptId: prompt.promptId };
  broadcast({ kind: "response", fromPlayer: slot, promptId: prompt.promptId ?? 0, action: { type, output } });
}

function answer(prompt) {
  promptsSeen++;
  if (DUMP) promptSamples[prompt.input?.type || prompt.kind] ??= prompt;
  if (prompt.kind === "priority") return respond(prompt, "chooseAction", { type: "pass" });
  const input = prompt.input || {};
  const type = input.type;
  if (type !== "payManaCost") lastPayCard = null;
  if (type !== "chooseAction") actsThisPrompt = 0;
  switch (type) {
    case "mulligan": return respond(prompt, type, { type: "mulliganDecision", keep: true });
    case "mulliganPutBack": return respond(prompt, type, { type: "mulliganPutBackDecision", cardIds: input.handCardIds.slice(0, input.count) });
    case "chooseAction": {
      const acts = (input.actions || []).filter((a) => !failedActions.has(`${turn}:${a.id}`) && a.type !== "undoMana");
      const land = acts.find((a) => /^play /i.test(a.label || ""));
      const spell = acts.find((a) => a.type === "cast");
      const pick = land || (actsThisPrompt < 3 && Math.random() < 0.6 ? spell : null);
      if (pick) { actsThisPrompt++; lastAct = `${turn}:${pick.id}`; return respond(prompt, type, { type: "act", actionId: pick.id }); }
      actsThisPrompt = 0;
      return respond(prompt, type, { type: "pass" });
    }
    case "payManaCost": {
      if (lastPayCard === input.cardId) { lastPayCard = null; if (lastAct) failedActions.add(lastAct); return respond(prompt, type, { type: "cancel" }); }
      lastPayCard = input.cardId;
      return respond(prompt, type, { type: "pay", auto: true });
    }
    case "chooseBoardTargets": {
      const k = Math.min(input.maxTargets, Math.max(input.minTargets, 1), input.candidates.length);
      if (k === 0 && input.cancellable) return respond(prompt, type, { type: "cancel" });
      return respond(prompt, type, { type: "boardTargets", chosen: input.candidates.slice(0, k).map(({ kind, id }) => ({ kind, id })) });
    }
    case "chooseBoolean": return respond(prompt, type, { type: "decision", value: true });
    case "chooseCards": return respond(prompt, type, { type: "chooseCardsDecision", chosenCardIds: input.cards.slice(0, input.min).map((c) => c.id) });
    case "chooseNumber": return respond(prompt, type, { type: "numberDecision", chosenNumber: input.min });
    case "chooseFromSelection": {
      const k = Math.min(Math.max(input.minTotal, 1), input.maxTotal, input.options.length);
      return respond(prompt, type, { type: "selectionDecision", chosenIndices: [...Array(k).keys()] });
    }
    case "chooseAttackers":
      return respond(prompt, type, {
        type: "declareAttackers",
        assignments: input.attackers.filter((a) => a.validTargetIds.length).map((a) => ({ attackerId: a.attackerId, targetId: a.validTargetIds[0] })),
      });
    case "chooseBlockers": return respond(prompt, type, { type: "declareBlockers", assignments: [] });
    case "chooseDamageAssignmentOrder": return respond(prompt, type, { type: "damageAssignmentOrderDecision", orderedBlockerIds: input.blockerIds });
    case "chooseCombatDamageAssignment": {
      const to = input.blockerIds[0] || input.defenderId;
      return respond(prompt, type, { type: "combatDamageAssignmentDecision", assignments: [{ assigneeId: to, damage: input.totalDamage }] });
    }
    case "reorder": return respond(prompt, type, { type: "reorderDecision", orderedIds: input.items.map((i) => i.id) });
    case "scry": {
      const top = Math.max(0, input.zones.indexOf("libraryTop"));
      return respond(prompt, type, { type: "scryDecision", zoneCardIds: input.zones.map((_, i) => (i === top ? input.cards.map((c) => c.id) : [])) });
    }
    case "chooseColor": return respond(prompt, type, { type: "colorDecision", chosenColors: { [input.validColors[0]]: input.amount } });
    case "revealCards": return respond(prompt, type, { type: "revealCardsAcknowledged" });
    case "diceRolled": return respond(prompt, type, { type: "diceRolledAcknowledged" });
    case "gameOver": gameOverSeen = true; reportEnd(); return finish(0);
    default:
      log(`unhandled prompt type "${type}":`, JSON.stringify(prompt).slice(0, 300));
  }
}

function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]; }
function stats(label, vals) {
  const s = vals.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (!s.length) return `${label}: no samples`;
  return `${label}: n=${s.length} p50=${pct(s, 50).toFixed(1)} p95=${pct(s, 95).toFixed(1)} p99=${pct(s, 99).toFixed(1)} max=${s[s.length - 1].toFixed(1)} ms`;
}

// the end of a game: each player's life, status and team, the winner and the winning side (bridge/teams.js teamsField)
function result() {
  const gv = board?.state?.gameView;
  if (!gv) return "no board";
  const slotColor = Object.fromEntries((gv.players || []).map((p, i) => [p.id, SEAT_COLORS[Number(String(p.id).split("-")[1])] || `seat${i}`]));
  const t = teams.teamsField(gv, slotColor, TEAM_MODE || null).teams;
  const rows = (gv.players || []).map((p) => `${slotColor[p.id]} (${p.id}): life ${p.life}, ${p.status}, team ${p.teamNumber ?? "-"}` +
    `, cmd damage ${JSON.stringify(p.commanderDamage || {})}`);
  return [`gameOver ${!!gv.gameOver}, winner ${gv.winnerId ? slotColor[gv.winnerId] : "none"}, teamRules ${JSON.stringify(gv.teamRules || null)}`,
    ...rows, t ? `sides ${JSON.stringify(t.sides)}${t.juggernaut ? `, Juggernaut ${t.juggernaut}` : ""}, won ${JSON.stringify(t.won || null)}` : "no teams"].join("\n  ");
}

function finish(code) {
  if (finished) return;
  finished = true;
  console.log(`Result:\n  ${result()}`);
  const out = path.join(__dirname, `latency-engine-${SEATS}p${FULL ? "-full" : ""}${TAG ? "-" + TAG : ""}.csv`);
  const cols = ["n", "turn", "prompt", "reply", "rtt_ms", "engine_ms", "emit_ms", "bytes"];
  fs.writeFileSync(out, cols.join(",") + "\n" + samples.map((s) => cols.map((c) => (typeof s[c] === "number" ? +s[c].toFixed?.(2) || s[c] : s[c])).join(",")).join("\n") + "\n");
  const rtt = samples.map((s) => s.rtt_ms);
  const engine = samples.map((s) => s.engine_ms).filter((v) => v !== "");
  const hop = samples.filter((s) => s.engine_ms !== "").map((s) => s.rtt_ms - s.engine_ms - (s.emit_ms || 0));
  const kb = samples.map((s) => s.bytes / 1024);
  console.log([
    "",
    `Mode: ${FULL ? "full states (no client version)" : "change-only patches (client " + CLIENT_VERSION + ")"}`,
    `  full states ${deltaStats.full}, patches applied ${deltaStats.patches}, resyncs ${deltaStats.resyncs}, fingerprint mismatches ${deltaStats.mismatches}` +
      (deltaStats.applyMs.length ? `, patch apply avg ${(deltaStats.applyMs.reduce((a, b) => a + b, 0) / deltaStats.applyMs.length).toFixed(2)} ms` : ""),
    `Engine round trip, ${SEATS} seats, ${samples.length} responses over ${turn} turns, ${promptsSeen} prompts`,
    stats("Response → next engine message", rtt),
    stats("  of which engine work (engineMs)", engine),
    stats("  of which relay hop + serialise", hop),
    `  message size: avg ${(kb.reduce((a, b) => a + b, 0) / (kb.length || 1)).toFixed(1)} KB, max ${Math.max(0, ...kb).toFixed(1)} KB`,
    "Targets (SPEC §6): click → engine accepts < 80 ms; click → state shown < 150 ms",
    `CSV: ${out}`,
  ].join("\n"));
  if (STD && !gameOverSeen) stdFail("the game did not reach game over");
  if (STD) log(exitCode ? "Standard checks: FAILED (above)" : `Standard checks: passed (20 life, no commander${firstDrawChecked ? ", first draw rule" : ""}, one winner)`);
  if (DUMP) fs.writeFileSync(DUMP, JSON.stringify({ slot, board: board?.state, prompts: promptSamples }, null, 1));
  // (no SetFormat back: the relay sets an emptied room to "Any", where StartGame picks the format again)
  try { send({ type: "LeaveRoom" }); ws.close(); } catch {}
  setTimeout(() => process.exit(Math.max(code, exitCode)), 300);
}

setTimeout(() => { log(`time limit ${MINUTES} min reached`); finish(0); }, MINUTES * 60_000);
process.on("SIGINT", () => finish(0));
