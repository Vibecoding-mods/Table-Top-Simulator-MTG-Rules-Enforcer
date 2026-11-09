// Extra turns against the real engine, headless, no TTS, two human seats.
//   PlayerDto.extraTurnCount is every extra turn queued for that player (Forge's own field counts only the unbroken run
//   at the bottom of its queue). Time Walk then Nexus of Fate queues [normal, C, T]: both players show 1.
//   A rewind to before Time Walk takes the queue back (2026-11-07 harness fix): both show 0, and the next turn is the
//   other player's normal turn.
// The seat that first reaches its main phase is C (Time Walk), the other T (Nexus of Fate).
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_extra_turn_check.js.
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 2;
const VERBOSE = process.argv.includes("--verbose");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const WALK = "Time Walk", NEXUS = "Nexus of Fate";
const cards = [];
for (const [n, k] of [["Mountain", 60], ["Grizzly Bears", 39]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "extra-turn-check", deck: { name: "extra-turn-check", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };

const results = [];
const check = (ok, what) => { results.push({ ok: !!ok, what }); process.stdout.write(`${ok ? "pass" : "FAIL"}: ${what}\n`); return !!ok; };
let finished = false, started = false;
const finish = (why) => {
  if (finished) return;
  finished = true;
  if (why) process.stdout.write(`stopped: ${why}\n`);
  const bad = results.filter((r) => !r.ok).length;
  process.stdout.write(`${bad || why ? "FAILED" : "PASSED"}: ${results.length - bad} of ${results.length} checks${why ? ", did not finish" : ""}\n`);
  process.exit(bad || why ? 1 : 0);
};
setTimeout(() => finish(`timed out in state ${S.state}`), Number(arg("timeout", 240)) * 1000);

const cname = (c) => c.identity?.name || "";
const zone = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner)?.cards || [];
const playerOf = (g, slot) => (g.players || []).find((p) => p.id === slot) || {};
const counts = (g) => `${S.C} ${playerOf(g, S.C).extraTurnCount ?? "?"}, ${S.T} ${playerOf(g, S.T).extraTurnCount ?? "?"}`;
const empty = (g) => !(g.stack || []).length;

// S.state: setup -> fix -> walk -> nexus -> rewind -> voted -> pressed -> next -> done
const S = { state: "setup", C: null, T: null, fixId: 700 };
const clients = [];
const by = (slot) => clients.find((x) => x.slot === slot);

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-xturn-${i}-${Math.random().toString(36).slice(2, 6)}`;
    this.ws = new WebSocket(RELAY);
    this.ws.addEventListener("open", () => this.send({ type: "Authenticate", username: this.name, password: KEY, service: false, client_platform: "unknown", engine_gate: "unknown", client_version: "3.56.0" }));
    this.ws.addEventListener("message", (ev) => this.onMsg(JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"))));
  }
  get g() { return this.board?.state?.gameView || {}; }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  respond(p, type, output) { this.send({ type: "BroadcastState", state: { kind: "response", fromPlayer: this.slot, promptId: p.promptId ?? 0, action: { type, output } } }); }
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
      if (env.kind === "state") this.board = { state: env.state, fp: env.fingerprint };
      else {
        if (!this.board || this.board.fp !== env.base) return this.send({ type: "RequestResync" });
        this.board = { state: delta.apply(this.board.state, env.patch), fp: env.fingerprint };
      }
      watchVote(this);
    } else if (env.kind === "prompt") {
      if (this.board) this.answer(env.prompt);
      else this.pending = env.prompt;
    } else if (env.kind === "fatal") finish(`engine fatal: ${env.message}`);
    else if (env.kind === "error") finish(`engine error: ${JSON.stringify(env.error)}`);
    if (this.board && this.pending) { const p = this.pending; this.pending = null; this.answer(p); }
  }
  answer(p) {
    const g = this.g, input = p.input || {}, type = p.kind === "priority" ? "chooseAction" : input.type;
    if (VERBOSE) process.stdout.write(`seat ${this.slot} t${g.turn} ${g.step} active ${g.activePlayerId}: ${type} (${S.state})\n`);
    switch (type) {
      case "gameOver": return finish("the game ended");
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g, input);
      case "payManaCost": return this.respond(p, type, input.canConfirmFromPool ? { type: "pay", auto: false } : { type: "pay", auto: true });
      case "chooseBoardTargets": {
        const want = input.candidates.find((c) => c.id === (this.slot === S.C ? S.C : S.T));
        return this.respond(p, type, { type: "boardTargets", chosen: (want ? [want] : input.candidates.slice(0, input.minTargets)).map(({ kind, id }) => ({ kind, id })) });
      }
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: true });
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

function castFromHand(c, p, input, g, name) {
  const inHand = zone(g, "hand", c.slot).find((x) => cname(x) === name);
  const cast = inHand && (input.actions || []).find((a) => a.cardId === inHand.id && a.type === "cast");
  if (!cast) return finish(`${c.slot} can't cast ${name}: ${JSON.stringify((input.actions || []).map((a) => a.label)).slice(0, 400)}`);
  return c.respond(p, "chooseAction", { type: "act", actionId: cast.id });
}

function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), acting = g.activePlayerId === c.slot;
  if (S.state === "setup" && acting && main && empty(g)) {
    S.C = c.slot;
    S.T = clients.map((x) => x.slot).find((s) => s !== c.slot);
    S.state = "fix";
    S.fixId++;
    c.directive({ type: "applyState", fixId: S.fixId, ops: [
      { op: "createCard", name: WALK, player: S.C, zone: "hand" },
      { op: "createCard", name: NEXUS, player: S.T, zone: "hand" },
      { op: "mana", player: S.C, mana: "U C" },
      { op: "mana", player: S.T, mana: "U U C C C C C" }] });
    return;
  }
  if (S.state === "fix" && c.slot === S.C) {
    if (g.stateFix?.fixId !== S.fixId) return pass();
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`);
    check(counts(g) === `${S.C} 0, ${S.T} 0`, `no extra turns before Time Walk (${counts(g)})`);
    S.turn = g.turn;
    S.target = (g.checkpoints || []).at(-1);
    if (!S.target) return finish("no checkpoint to rewind to");
    S.state = "walk";
    return castFromHand(c, p, input, g, WALK);
  }
  if (S.state === "walk" && empty(g) && zone(g, "graveyard", S.C).some((x) => cname(x) === WALK)) {
    if (c.slot === S.C) return pass();
    check(counts(g) === `${S.C} 1, ${S.T} 0`, `Time Walk queues one turn for ${S.C} (${counts(g)})`);
    S.state = "nexus";
    return castFromHand(c, p, input, g, NEXUS);
  }
  if (S.state === "nexus" && empty(g) && by(S.T) && !zone(by(S.T).g, "hand", S.T).some((x) => cname(x) === NEXUS) && c.slot === S.C) {
    check(counts(g) === `${S.C} 1, ${S.T} 1`, `then Nexus of Fate: queue [normal, ${S.C}, ${S.T}] counts both players, not just the bottom run (${counts(g)})`);
    check(counts(by(S.T).g) === `${S.C} 1, ${S.T} 1`, `${S.T} sees the same counts (${counts(by(S.T).g)})`);
    S.state = "rewind";
    process.stdout.write(`rewind to checkpoint ${S.target.checkpointId} (turn ${S.target.turn} ${S.target.step})\n`);
    c.directive({ type: "requestRestore", checkpointId: S.target.checkpointId });
    return;
  }
  if (S.state === "next" && g.turn === S.restoredTurn + 1 && c.slot === g.activePlayerId) {
    check(g.activePlayerId === S.T, `after the rewind the next turn is ${S.T}'s, not Time Walk's (${g.activePlayerId})`);
    check(!playerOf(g, g.activePlayerId).isExtraTurn, "and it is not an extra turn");
    check(counts(g) === `${S.C} 0, ${S.T} 0`, `nothing is queued (${counts(g)})`);
    S.state = "done";
    return finish();
  }
  if (S.state === "restored") { c.held = pass; return; }
  if (S.state === "rewind" || S.state === "voted" || S.state === "pressed") return;
  return pass();
}

function watchVote(c) {
  const v = c.g.restoreVote;
  if (VERBOSE && v && JSON.stringify(v) !== c.lastVote) { c.lastVote = JSON.stringify(v); process.stdout.write(`  vote seen by ${c.slot} (${S.state}): ${c.lastVote.slice(0, 300)}
`); }
  if (!v || !["rewind", "voted", "pressed"].includes(S.state)) return;
  if (S.state === "rewind" && v.status?.type === "pending" && (v.awaitingPlayerIds || []).includes(c.slot)) {
    S.state = "voted";
    return c.directive({ type: "restoreVote", voteId: v.voteId, accept: true });
  }
  if (S.state === "voted" && c.slot === S.C && v.status?.type === "pending" && !(v.awaitingPlayerIds || []).length) {
    S.state = "pressed";
    return c.directive({ type: "restoreVote", voteId: v.voteId, accept: true });
  }
  if ((S.state === "voted" || S.state === "pressed") && v.status?.type === "approved" && c.slot === S.C) {
    S.state = "restored";
    setTimeout(() => {
      const g = by(S.C).g;
      check(g.turn === S.target.turn, `the rewind went back to turn ${S.target.turn} (${g.turn} ${g.step})`);
      check(counts(g) === `${S.C} 0, ${S.T} 0`, `after the rewind no extra turn is queued (${counts(g)})`);
      check(counts(by(S.T).g) === `${S.C} 0, ${S.T} 0`, `${S.T} sees the same (${counts(by(S.T).g)})`);
      S.restoredTurn = g.turn;
      S.state = "next";
      for (const x of clients) if (x.held) { const h = x.held; x.held = null; h(); }
    }, 800);
  }
}

clients[0] = new Client(0);
