// Priority order around a 4-player table (PLAN.md M0.5), headless: four scripted seats in one process, no AI.
// Every seat plays a land in its own main phase and casts a cheap spell now and then, so the stack fills too.
// Each priority question is logged in arrival order; within one step and one stack, the next seat asked must
// be the next player in turn order after the one before.
//   node priority-check.js [--turns 12]
const fs = require("fs");
const path = require("path");
const delta = require("./state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9443"), KEY = arg("key", "tts-local"), ROOM = arg("room", "tts-commander");
const TURNS = Number(arg("turns", 12));
const SEATS = 4;
const { presetFile } = require("./presets");
const OUT = path.join(__dirname, "..", "tmp", "priority-check.json");
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

function loadPreset(id) {
  const p = JSON.parse(fs.readFileSync(presetFile(id), "utf8"));
  const toCard = (e) => ({ identity: { name: e.name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", uris: {} });
  const cards = [];
  let commander = null;
  for (const e of p.cards) {
    if (p.commander && e.name === p.commander && !commander) { commander = toCard(e); continue; }
    for (let k = 0; k < (e.count || 1); k++) cards.push(toCard(e));
  }
  return { deckName: p.label, deck: { name: p.label, cards, sideboard: [], format: "commander", commanders: commander ? [commander] : [] }, commanderName: p.commander };
}
const DECK = loadPreset("test_rules_tax"); // Rograkh + burn: free commander, cheap spells for the stack

const events = []; // { seat, turn, step, stack, active }
let order = null, finished = false, started = false;
const clients = [];

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-prio-${i}-${Math.random().toString(36).slice(2, 6)}`;
    this.slot = null; this.board = null; this.joined = false; this.casts = 0;
    this.ws = new WebSocket(RELAY);
    this.ws.addEventListener("open", () => this.send({ type: "Authenticate", username: this.name, password: KEY, service: false, client_platform: "unknown", engine_gate: "unknown", client_version: "3.56.0" }));
    this.ws.addEventListener("message", (ev) => this.onMsg(JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"))));
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  respond(p, type, output) { this.send({ type: "BroadcastState", state: { kind: "response", fromPlayer: this.slot, promptId: p.promptId ?? 0, action: { type, output } } }); }
  onMsg(msg) {
    if (msg.type === "AuthResult") this.send({ type: "ListRooms" });
    else if (msg.type === "RoomList" && !this.roomId) {
      const room = msg.rooms.find((r) => r.room_name === ROOM);
      if (!room) { log("room not found"); return finish(); }
      this.roomId = room.room_id;
      this.send({ type: "JoinRoom", room_id: this.roomId, observe: false, as_bot: false });
    } else if (msg.type === "RoomUpdate" && msg.room.room_id === this.roomId) {
      if (!this.joined && msg.room.players.some((p) => p.username === this.name)) {
        this.joined = true;
        this.send({ type: "SetDeckSelection", deck_name: DECK.deckName, deck: DECK.deck, commander_name: DECK.commanderName });
        this.send({ type: "SetReady", ready: true });
      }
      const ready = msg.room.players.filter((p) => p.ready && p.connected).length;
      if (process.env.PC_DEBUG && this.i === 0) log(`room ${msg.room.status} host=${msg.room.host} ready ${ready}/${msg.room.players.length}`);
      // the room's controller starts the game: its host, or the first seat that joined (the host is the node service)
      if (!started && msg.room.status === "Lobby" && ready >= SEATS && (msg.room.host === this.name || this.i === 0)) { started = true; this.send({ type: "StartGame", format: "Commander" }); }
    } else if (msg.type === "GameStarted") {
      this.slot = `player-${msg.player_order.indexOf(this.name)}`;
      order = msg.player_order.map((_, k) => `player-${k}`);
      if (this.i === 0) log(`started, order ${order.join(" ")}`);
    } else if (msg.type === "StateUpdate") this.onEnv(msg.state);
    else if (msg.type === "Error") log(`seat ${this.i} relay error`, msg.code, msg.message);
  }
  onEnv(env) {
    if (!env || !this.slot || env.forPlayer !== this.slot) return;
    if (env.kind === "state") this.board = { state: env.state, fp: env.fingerprint };
    else if (env.kind === "stateDelta") {
      if (!this.board || this.board.fp !== env.base) { this.send({ type: "RequestResync" }); return; }
      this.board = { state: delta.apply(this.board.state, env.patch), fp: env.fingerprint };
    } else if (env.kind === "prompt") this.answer(env.prompt);
    else if (env.kind === "fatal") { log("fatal", env.message); finish(); }
  }
  answer(p) {
    const gv = this.board?.state?.gameView || {};
    const input = p.input || {};
    const type = p.kind === "priority" ? "priority" : input.type;
    if (type === "priority" || type === "chooseAction") {
      events.push({ seat: this.slot, turn: gv.turn, step: gv.step, stack: (gv.stack || []).map((s) => s.id).join(","), active: gv.activePlayerId, priority: gv.priorityPlayerId });
      if ((gv.turn || 0) > TURNS) return finish();
    }
    if (type === "priority") return this.respond(p, "chooseAction", { type: "pass" });
    switch (type) {
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": {
        const acts = (input.actions || []).filter((a) => a.type !== "undoMana" && !a.isManaAbility);
        const land = acts.find((a) => /^play /i.test(a.label || ""));
        // now and then a cheap spell at the opponent, so priority also goes around with something on the stack
        const spell = this.casts < 6 && (gv.turn % 3 === this.i % 3) ? acts.find((a) => a.type === "cast") : null;
        const pick = land || spell;
        if (pick) { if (pick === spell) this.casts++; return this.respond(p, type, { type: "act", actionId: pick.id }); }
        return this.respond(p, type, { type: "pass" });
      }
      case "payManaCost":
        if (input.canConfirmFromPool) return this.respond(p, type, { type: "pay", auto: false });
        if (this.payFor === input.cardId) { this.payFor = null; return this.respond(p, type, { type: "cancel" }); }
        this.payFor = input.cardId;
        return this.respond(p, type, { type: "pay", auto: true });
      case "chooseBoardTargets": {
        const other = input.candidates.find((c) => c.kind === "player" && c.id !== this.slot) || input.candidates[0];
        return this.respond(p, type, { type: "boardTargets", chosen: input.minTargets ? [{ kind: other.kind, id: other.id }] : [] });
      }
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: true });
      case "chooseCards": return this.respond(p, type, { type: "chooseCardsDecision", chosenCardIds: input.cards.slice(0, input.min).map((c) => c.id) });
      case "chooseAttackers": return this.respond(p, type, { type: "declareAttackers", assignments: [] });
      case "chooseBlockers": return this.respond(p, type, { type: "declareBlockers", assignments: [] });
      case "scry": return this.respond(p, type, { type: "scryDecision", zoneCardIds: input.zones.map((z, k) => (k === Math.max(0, input.zones.indexOf("libraryTop")) ? input.cards.map((c) => c.id) : [])) });
      case "chooseNumber": return this.respond(p, type, { type: "numberDecision", chosenNumber: input.min });
      case "chooseFromSelection": return this.respond(p, type, { type: "selectionDecision", chosenIndices: [0] });
      case "revealCards": return this.respond(p, type, { type: "revealCardsAcknowledged" });
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "gameOver": return finish();
      default: log(`seat ${this.i}: unhandled ${type}`);
    }
  }
}

function finish() {
  if (finished) return;
  finished = true;
  let checked = 0, bad = 0;
  const notes = [];
  for (let k = 1; k < events.length; k++) {
    const a = events[k - 1], b = events[k];
    if (a.turn !== b.turn || a.step !== b.step || a.stack !== b.stack || a.seat === b.seat) continue;
    const j = order.indexOf(a.seat);
    const expect = order[(j + 1) % order.length];
    checked++;
    if (expect !== b.seat) { bad++; if (notes.length < 8) notes.push(`turn ${b.turn} ${b.step} [${b.stack}]: after ${a.seat} expected ${expect}, got ${b.seat}`); }
  }
  // who is asked first in a step: the active player when the stack is empty
  let firstChecked = 0, firstBad = 0;
  for (let k = 0; k < events.length; k++) {
    const e = events[k], prev = events[k - 1];
    if (prev && prev.turn === e.turn && prev.step === e.step) continue;
    if (e.stack) continue;
    firstChecked++;
    if (e.seat !== e.active) { firstBad++; if (notes.length < 12) notes.push(`turn ${e.turn} ${e.step}: first asked ${e.seat}, active ${e.active}`); }
  }
  const verdicts = [
    { check: "Priority passes to the next player in turn order", result: checked ? (bad ? "FAIL" : "PASS") : "NOT REACHED", detail: `${checked} passes, ${bad} out of order` },
    { check: "The active player gets priority first in each step", result: firstChecked ? (firstBad ? "FAIL" : "PASS") : "NOT REACHED", detail: `${firstChecked} steps, ${firstBad} wrong` },
  ];
  fs.writeFileSync(OUT, JSON.stringify({ verdicts, order, events, notes }, null, 1));
  console.log("\nPriority check:");
  for (const v of verdicts) console.log(`  ${v.result.padEnd(11)} ${v.check}  -- ${v.detail}`);
  if (notes.length) console.log("  notes:", notes.join("; "));
  console.log(`  details: ${OUT}`);
  for (const c of clients) { try { c.send({ type: "LeaveRoom" }); c.ws.close(); } catch {} }
  setTimeout(() => process.exit(0), 300);
}

for (let i = 0; i < SEATS; i++) setTimeout(() => clients.push(new Client(i)), i * 400);
setTimeout(() => { log("time limit"); finish(); }, Number(arg("minutes", 15)) * 60_000);
