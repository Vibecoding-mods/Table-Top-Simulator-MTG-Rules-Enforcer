// A conceded player comes back on a rewind, against the real engine, headless, no TTS, three human seats (so one
// concession doesn't end the game). engine1114-rejoin.
//   A (the first seat to reach its main phase with an empty stack) notes the newest restore point; X, another seat,
//   concedes: the engine shows X "conceded" and X's permanents leave with X (CR 800.4a). A asks to rewind to that point;
//   the third seat R agrees and A presses again. After the rewind every seat shows X "playing" with the life and zone
//   counts of the point, X is awaited in a new vote, and X is asked to act again and takes a turn.
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_rejoin_check.js.
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 3;
const VERBOSE = process.argv.includes("--verbose");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const cards = [];
for (const [n, k] of [["Mountain", 60], ["Grizzly Bears", 39]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "rejoin-check", deck: { name: "rejoin-check", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };

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

const zoneOf = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner) || {};
const count = (g, z, owner) => { const x = zoneOf(g, z, owner); return x.count ?? (x.cards || []).length; };
const playerOf = (g, slot) => (g.players || []).find((p) => p.id === slot) || {};
const empty = (g) => !(g.stack || []).length;
const looks = (g, slot) => `${playerOf(g, slot).status} life ${playerOf(g, slot).life} battlefield ${count(g, "battlefield", slot)} hand ${count(g, "hand", slot)} library ${count(g, "library", slot)} graveyard ${count(g, "graveyard", slot)}`;

// (the engine takes a concede from a seat not being asked anything while it waits for an answer, and shows it with the
// next state, so A answers after the concede and the seats play on until A sees X "conceded")
// S.state: setup -> conceded -> rewind -> voted -> pressed -> restored -> back -> done
const S = { state: "setup", A: null, X: null, R: null };
const clients = [];
const by = (slot) => clients.find((x) => x.slot === slot);

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-rejoin-${i}-${Math.random().toString(36).slice(2, 6)}`;
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
      watch(this);
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
      case "chooseAction": return priority(this, p, g);
      case "payManaCost": return this.respond(p, type, input.canConfirmFromPool ? { type: "pay", auto: false } : { type: "pay", auto: true });
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

function priority(c, p, g) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  // (a land a turn, so the conceding player has permanents to lose and get back)
  const land = (p.input?.actions || []).find((a) => a.type === "playLand" || /^play/i.test(a.label || ""));
  if (S.state === "setup" && land && g.activePlayerId === c.slot && empty(g)) return c.respond(p, "chooseAction", { type: "act", actionId: land.id });
  if (S.state === "setup" && g.turn >= 4 && g.activePlayerId === c.slot && /main/i.test(g.step || "") && empty(g)) {
    const others = clients.map((x) => x.slot).filter((s) => s !== c.slot);
    const X = others.find((s) => count(g, "battlefield", s) > 0);
    S.target = (g.checkpoints || []).at(-1);
    if (!X || !S.target) return pass();
    S.A = c.slot; S.X = X; S.R = others.find((s) => s !== X);
    S.before = looks(g, X);
    check(playerOf(g, X).status === "playing", `before: ${X} is playing (${S.before})`);
    S.state = "conceded";
    process.stdout.write(`${X} concedes; point ${S.target.checkpointId} (turn ${S.target.turn} ${S.target.step})\n`);
    by(X).directive({ type: "concede" });
    return setTimeout(pass, 500);
  }
  if (S.state === "back" && c.slot === S.X) {
    S.xAsked = true;
    if (g.activePlayerId === S.X) {
      check(true, `${S.X} is asked to act again, on their own turn ${g.turn} (${g.step})`);
      S.state = "done";
      return finish();
    }
  }
  if (["rewind", "voted", "pressed", "restored"].includes(S.state)) { c.held = pass; return; }
  return pass();
}

function release() { for (const x of clients) if (x.held) { const h = x.held; x.held = null; h(); } }

function watch(c) {
  const g = c.g, v = g.restoreVote;
  if (S.state === "conceded" && c.slot === S.A && playerOf(g, S.X).status === "conceded") {
    check(count(g, "battlefield", S.X) === 0, `after the concession ${S.X}'s permanents are gone (${looks(g, S.X)})`);
    S.state = "rewind";
    c.directive({ type: "requestRestore", checkpointId: S.target.checkpointId });
    return;
  }
  if (!v) return;
  if (VERBOSE && JSON.stringify(v) !== c.lastVote) { c.lastVote = JSON.stringify(v); process.stdout.write(`  vote seen by ${c.slot} (${S.state}): ${c.lastVote.slice(0, 300)}\n`); }
  if (S.state === "rewind" && v.status?.type === "pending" && c.slot === S.R && (v.awaitingPlayerIds || []).includes(S.R)) {
    check(!(v.awaitingPlayerIds || []).includes(S.X), `the conceded ${S.X} is not awaited in the rewind vote (${JSON.stringify(v.awaitingPlayerIds)})`);
    S.state = "voted";
    return c.directive({ type: "restoreVote", voteId: v.voteId, accept: true });
  }
  if (S.state === "voted" && c.slot === S.A && v.status?.type === "pending" && !(v.awaitingPlayerIds || []).length) {
    S.state = "pressed";
    return c.directive({ type: "restoreVote", voteId: v.voteId, accept: true });
  }
  if ((S.state === "voted" || S.state === "pressed") && v.status?.type === "approved" && c.slot === S.A) {
    S.state = "restored";
    for (const x of clients) x.held = null; // (the rewind closes every open prompt and asks again)
    setTimeout(() => {
      for (const x of clients) check(looks(x.g, S.X) === S.before, `after the rewind ${x.slot} sees ${S.X} as at the point: ${looks(x.g, S.X)}`);
      check(by(S.A).g.turn === S.target.turn, `the rewind went back to turn ${S.target.turn} (${by(S.A).g.turn} ${by(S.A).g.step})`);
      S.state = "vote2";
      by(S.R).directive({ type: "requestRestore", checkpointId: (by(S.R).g.checkpoints || []).at(-1)?.checkpointId });
    }, 800);
    return;
  }
  if (S.state === "vote2" && c.slot === S.R && v.status?.type === "pending" && v.requestedByPlayerId === S.R) {
    check((v.awaitingPlayerIds || []).includes(S.X), `${S.X} is awaited in the next vote (${JSON.stringify(v.awaitingPlayerIds)})`);
    S.state = "back";
    by(S.X).directive({ type: "restoreVote", voteId: v.voteId, accept: false });
    setTimeout(release, 300);
  }
}

clients[0] = new Client(0);
