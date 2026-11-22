// Big-board timing against the real engine, headless, no TTS, two seats (like a goldfish game: bots=0, both seats
// remote). Grows one seat's battlefield in steps (tokens, Treasures, lands) and times every priority question:
// engineMs on the prompt is the engine's whole time for that click (Forge's rules work plus the board snapshots);
// engineMs on the first board update of the same click is Forge's work plus the first snapshot only.
// Prints one line per step (cards on the battlefield, clicks, mean and max ms) and, with --json <file>, the samples.
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_bigboard_bench.js.
// --steps "0,20,40,60,80,100" battlefield sizes to measure, --clicks <n> priority questions per step (default 24).
const fs = require("fs");
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 2;
const STEPS = String(arg("steps", "0,20,40,60,80,100")).split(",").map(Number);
const CLICKS = Number(arg("clicks", 24));
const JSON_OUT = arg("json", "");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const cards = [];
for (const [n, k] of [["Forest", 60], ["Grizzly Bears", 39]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "bigboard-bench", deck: { name: "bigboard-bench", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };
// one batch of 20: what a token deck leaves out late in a game
const BATCH = [...Array(8).fill("w_1_1_soldier"), ...Array(6).fill("c_a_treasure_sac"), ...Array(3).fill("g_1_1_saproling"), ...Array(2).fill("c_a_clue_draw"), "Forest"];
// --real: before the tokens, the permanents of the 2026-11-20 Kykar game that got slow (spell triggers, statics), and
// its spent spells in the graveyard
const REAL = process.argv.includes("--real");
const REAL_BATTLEFIELD = ["Kykar, Wind's Fury", "Young Pyromancer", "Monastery Mentor", "Storm-Kiln Artist", "Third Path Iconoclast",
  "Jeskai Ascendancy", "Impact Tremors", "Arcane Bombardment", "Stormchaser's Talent", "Greater Auramancy", "Ghostly Prison",
  "Ral, Storm Conduit", "Jin-Gitaxias, Progress Tyrant", "Sanar, Unfinished Genius", "Mindsplice Apparatus", "Strionic Resonator",
  "Skullclamp", "Sol Ring", "Fellwar Stone", "Talisman of Creativity", "Talisman of Progress", "Karn's Bastion", "Training Center",
  "Steam Vents", "Hallowed Fountain", "Adarkar Wastes", "Riverpyre Verge", "Floodfarm Verge", "Island", "Plains", "Mountain"];
const REAL_GRAVEYARD = ["Sink into Stupor", "Wear // Tear", "Akroma's Will", "Brainstorm", "Frantic Search", "Galvanic Iteration",
  "Solve the Equation", "Idyllic Tutor", "Empty the Warrens", "Anthropological Mission", "Whirlwind of Thought", "Time Warp",
  "Temporal Mastery", "Replenish", "Reiterate", "Gamble", "Flawless Maneuver", "Crackle with Power", "Counterspell", "Generous Gift"];
const REAL_TOKENS = ["r_1_1_goblin", "w_1_1_spirit_flying", "w_1_1_monk_prowess", "r_1_1_elemental", "c_a_treasure_sac"];

let finished = false, started = false;
const rows = [], samples = [], fingerprints = { seen: 0, checked: 0, wrong: 0 };
const finish = (why) => {
  if (finished) return;
  finished = true;
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ rows, samples }, null, 1));
  if (why) process.stdout.write(`stopped: ${why}\n`);
  process.stdout.write(`fingerprints: ${fingerprints.checked} checked, ${fingerprints.wrong} wrong\n`);
  const bad = why || fingerprints.wrong || !fingerprints.checked;
  process.stdout.write(`${bad ? "FAILED" : "PASSED"}: ${rows.length} of ${STEPS.length} steps measured\n`);
  process.exit(bad ? 1 : 0);
};
setTimeout(() => finish(`timed out in state ${S.state}`), Number(arg("timeout", 600)) * 1000);

const zone = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner)?.cards || [];
const battlefield = (g) => (g.zones || []).filter((x) => x.zone === "battlefield").reduce((n, z) => n + (z.cards || []).length, 0);
const empty = (g) => !(g.stack || []).length;

// S.state: grow -> fix -> measure -> (grow | done)
const S = { state: "grow", C: null, step: 0, fixId: 700, clicks: [], firstState: null, sentAt: 0, otherPrompts: 0, measureAt: 0 };
// --hold: the other seat answers each priority as the table's harmless bot does with a held pass (bridge HarmlessSeat)
const HOLD = process.argv.includes("--hold");
const clients = [];

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-bench-${i}-${Math.random().toString(36).slice(2, 6)}`;
    this.ws = new WebSocket(RELAY);
    this.ws.addEventListener("open", () => this.send({ type: "Authenticate", username: this.name, password: KEY, service: false, client_platform: "unknown", engine_gate: "unknown", client_version: "3.56.0" }));
    this.ws.addEventListener("message", (ev) => this.onMsg(JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"))));
  }
  get g() { return this.board?.state?.gameView || {}; }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  respond(p, type, output) {
    S.firstState = null;
    S.sentAt = Date.now();
    this.send({ type: "BroadcastState", state: { kind: "response", fromPlayer: this.slot, promptId: p.promptId ?? 0, action: { type, output } } });
  }
  directive(directive) { this.send({ type: "BroadcastState", state: { kind: "directive", fromPlayer: this.slot, directive } }); }
  onMsg(msg) {
    if (msg.type === "AuthResult") this.send({ type: "ListRooms" });
    else if (msg.type === "RoomList" && !this.roomId) {
      const room = msg.rooms.find((r) => r.room_name === ROOM);
      if (!room) return finish(`room ${ROOM} not found`);
      this.roomId = room.room_id;
      this.send({ type: "JoinRoom", room_id: this.roomId, observe: false, as_bot: false });
    } else if (msg.type === "RoomUpdate" && msg.room.room_id === this.roomId) {
      if (!this.joined && msg.room.players.some((p) => p.username === this.name)) {
        this.joined = true;
        this.send({ type: "SetDeckSelection", deck_name: DECK.deckName, deck: DECK.deck, commander_name: DECK.commanderName });
        this.send({ type: "SetReady", ready: true });
        if (this.i + 1 < SEATS) clients[this.i + 1] = new Client(this.i + 1);
      }
      const ready = msg.room.players.filter((p) => p.ready && p.connected).length;
      if (!started && this.i === 0 && msg.room.status === "Lobby" && ready >= SEATS) { started = true; this.send({ type: "StartGame", format: "Commander" }); }
    } else if (msg.type === "GameStarted") this.slot = `player-${msg.player_order.indexOf(this.name)}`;
    else if (msg.type === "StateUpdate") this.onEnv(msg.state);
    else if (msg.type === "Error") process.stdout.write(`seat ${this.i} relay error ${msg.code} ${msg.message}\n`);
    else if (msg.type === "GameAborted") finish("the game aborted");
  }
  onEnv(env) {
    if (!env || !this.slot || env.forPlayer !== this.slot) return;
    if (env.kind === "state" || env.kind === "stateDelta") {
      if (S.firstState == null && env.engineMs != null) S.firstState = env.engineMs;
      if (env.kind === "state") this.board = { state: env.state, fp: env.fingerprint };
      else {
        if (!this.board || this.board.fp !== env.base) return this.send({ type: "RequestResync" });
        this.board = { state: delta.apply(this.board.state, env.patch), fp: env.fingerprint };
      }
      // every 5th update: the engine's fingerprint must be the hash of the board this seat now holds
      if (env.fingerprint && ++fingerprints.seen % 5 === 0) {
        fingerprints.checked++;
        if (delta.fingerprint(this.board.state) !== env.fingerprint) fingerprints.wrong++;
      }
    } else if (env.kind === "prompt") {
      if (env.prompt?.input?.type === "chooseAction" || env.prompt?.kind === "priority") note(this, env);
      if (this.board) this.answer(env.prompt);
      else this.pending = env.prompt;
    } else if (env.kind === "fatal") finish(`engine fatal: ${env.message}`);
    else if (env.kind === "error") finish(`engine error: ${JSON.stringify(env.error)}`);
    if (this.board && this.pending) { const p = this.pending; this.pending = null; this.answer(p); }
  }
  answer(p) {
    const g = this.g, input = p.input || {}, type = p.kind === "priority" ? "chooseAction" : input.type;
    switch (type) {
      case "gameOver": return finish("the game ended");
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g);
      case "payManaCost": return this.respond(p, type, { type: "pay", auto: true });
      case "chooseBoardTargets": return this.respond(p, type, { type: "boardTargets", chosen: input.candidates.slice(0, input.minTargets).map(({ kind, id }) => ({ kind, id })) });
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: false });
      case "chooseCards": return this.respond(p, type, { type: "chooseCardsDecision", chosenCardIds: (input.cards || []).slice(0, input.min || 0).map((c) => c.id) });
      case "chooseFromSelection": return this.respond(p, type, { type: "selectionDecision", chosenIndices: [0] });
      case "chooseAttackers": return this.respond(p, type, { type: "declareAttackers", assignments: [] });
      case "chooseBlockers": return this.respond(p, type, { type: "declareBlockers", assignments: [] });
      case "revealCards": return this.respond(p, type, { type: "revealCardsAcknowledged" });
      case "chooseNumber": return this.respond(p, type, { type: "numberDecision", chosenNumber: input.min ?? 0 });
      case "reorder": return this.respond(p, type, { type: "reorderDecision", orderedIds: (input.items || []).map((x) => x.id) });
      case "scry": return this.respond(p, type, { type: "scryDecision", zoneCardIds: (input.zones || []).map(() => []) });
      default:
        process.stdout.write(`${JSON.stringify(p).slice(0, 700)}\n`);
        return finish(`unexpected question ${type}`);
    }
  }
}

// one priority question while measuring: the engine's time for it, and for the click's first board update
// (only the measured seat's questions are clicks; the other seat's are counted: what a held pass saves)
function note(c, env) {
  if (S.state !== "measure") return;
  if (c.slot !== S.C) { S.otherPrompts++; return; }
  if (env.engineMs == null) return;
  const sample = { step: S.step, cards: battlefield(clients[0].g), engineMs: env.engineMs, firstStateMs: S.firstState, wallMs: Date.now() - S.sentAt };
  S.clicks.push(sample);
  samples.push(sample);
}

function startMeasure() { S.state = "measure"; S.clicks = []; S.otherPrompts = 0; S.measureAt = Date.now(); }

const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

function priority(c, p, g) {
  if (HOLD && S.C && c.slot !== S.C) return c.respond(p, "chooseAction", { type: "pass", until: { playerId: c.slot, phase: "cleanup", throughCombat: true }, exhaustStack: true });
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), acting = g.activePlayerId === c.slot;
  if (S.state === "grow" && acting && main && empty(g)) {
    S.C = S.C || c.slot;
    if (c.slot !== S.C) return pass();
    const want = STEPS[S.step], have = zone(g, "battlefield", S.C).length;
    const ops = [];
    if (REAL && !S.realDone) {
      S.realDone = true;
      for (const name of REAL_BATTLEFIELD) ops.push({ op: "createCard", name, player: S.C, zone: "battlefield" });
      for (const name of REAL_GRAVEYARD) ops.push({ op: "createCard", name, player: S.C, zone: "graveyard" });
    }
    const tokens = REAL ? REAL_TOKENS : BATCH, onField = have + ops.filter((o) => o.zone === "battlefield").length;
    for (let i = 0; i < Math.max(0, want - onField); i++) ops.push({ op: "createCard", name: tokens[i % tokens.length], player: S.C, zone: "battlefield" });
    S.fixId++;
    S.state = "fix";
    if (!ops.length) { startMeasure(); return pass(); }
    return c.directive({ type: "applyState", fixId: S.fixId, ops });
  }
  if (S.state === "fix") {
    if (g.stateFix?.fixId !== S.fixId) return pass();
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`);
    startMeasure();
    return pass();
  }
  if (S.state === "measure" && S.clicks.length >= CLICKS) {
    const xs = S.clicks.map((s) => s.engineMs), fs1 = S.clicks.map((s) => s.firstStateMs).filter((x) => x != null);
    const row = { step: S.step, cards: battlefield(g), clicks: xs.length, otherPrompts: S.otherPrompts, perClickMs: Math.round((Date.now() - S.measureAt) / xs.length), meanMs: mean(xs), maxMs: Math.max(...xs), firstStateMeanMs: mean(fs1), wallMeanMs: mean(S.clicks.map((s) => s.wallMs)) };
    rows.push(row);
    process.stdout.write(`battlefield ${String(row.cards).padStart(3)} cards: ${row.clicks} clicks, engine mean ${row.meanMs} ms, max ${row.maxMs} ms; first board update mean ${row.firstStateMeanMs} ms; round trip mean ${row.wallMeanMs} ms; other seat asked ${row.otherPrompts}x; ${row.perClickMs} ms per click overall\n`);
    S.step++;
    if (S.step >= STEPS.length) return finish();
    S.state = "grow";
  }
  return pass();
}

clients[0] = new Client(0);
