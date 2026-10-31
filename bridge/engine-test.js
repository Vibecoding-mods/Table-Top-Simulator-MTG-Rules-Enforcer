// Engine round-trip latency test (SPEC.md §6, test 2 / milestone M2).
// Joins the local Forge room as one seat, fills the rest with Forge AI bots,
// auto-plays its own seat, and times every response → next engine message.
//   node engine-test.js [--seats 2] [--turns 8] [--deck neheb_minotaur_commander] [--minutes 10] [--full]
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
const DECK_ID = arg("deck", "neheb_minotaur_commander");
const BOT_DECK_IDS = ["ashling_limitless_commander", "ramses_commander", "real_teval_commander"];
const { presetFile } = require("./presets");
const FULL = process.argv.includes("--full");
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
  for (const e of p.cards) {
    if (p.commander && e.name === p.commander && !commander) { commander = toCard(e); continue; }
    for (let k = 0; k < (e.count || 1); k++) cards.push(toCard(e));
  }
  const deck = { name: p.label, cards, sideboard: [], format: "commander" };
  if (commander) deck.commanders = [commander];
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
        send({ type: "StartGame", format: "Commander" });
      }
      break;
    }
    case "GameStarted":
      slot = `player-${msg.player_order.indexOf(USERNAME)}`;
      log(`game started: ${msg.game_id}, we are ${slot}, order ${msg.player_order.join(" → ")}, life ${msg.starting_life}`);
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

function onBoard(bytes) {
  const t = board.state?.gameView?.turn ?? turn;
  if (t !== turn) { turn = t; log(`turn ${turn} (last message ${(bytes / 1024).toFixed(1)} KB, board ${(JSON.stringify(board.state).length / 1024).toFixed(0)} KB)`); }
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
    case "gameOver": log("game over"); return finish(0);
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

function finish(code) {
  if (finished) return;
  finished = true;
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
  if (DUMP) fs.writeFileSync(DUMP, JSON.stringify({ slot, board: board?.state, prompts: promptSamples }, null, 1));
  try { send({ type: "LeaveRoom" }); ws.close(); } catch {}
  setTimeout(() => process.exit(code), 300);
}

setTimeout(() => { log(`time limit ${MINUTES} min reached`); finish(0); }, MINUTES * 60_000);
process.on("SIGINT", () => finish(0));
