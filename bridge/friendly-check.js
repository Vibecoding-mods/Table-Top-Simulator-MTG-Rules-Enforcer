// Friendly mulligans against the real engine, headless, no TTS: seat 0 takes --mulls mulligans, answering each with
// --free as freeCards, then keeps; the other seats keep. Checks how many cards the engine asks seat 0 to put on the
// bottom and the hand it ends with. Needs a fresh room: restart the test relay and node between runs.
//   node bridge/friendly-check.js --relay ws://127.0.0.1:9444 --room tts-test --seats 2 --free 2 --mulls 2 --bottom 0
//   (--free none sends no freeCards at all: what Manabrew's own client and a game with no vote send)
const fs = require("fs");
const delta = require("./state-delta");
const { presetFile } = require("./presets");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = arg("key", "tts-local");
const SEATS = Number(arg("seats", 2)), MULLS = Number(arg("mulls", 1)), BOTTOM = Number(arg("bottom", 0));
const FREE = arg("free", "none") === "none" ? null : Number(arg("free"));

function loadDeck() {
  const p = JSON.parse(fs.readFileSync(presetFile("test_rules_tax"), "utf8"));
  const card = (e) => ({ identity: { name: e.name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "" });
  const cards = [];
  let commander = null;
  for (const e of p.cards) {
    if (p.commander && e.name === p.commander && !commander) { commander = card(e); continue; }
    for (let k = 0; k < (e.count || 1); k++) cards.push(card(e));
  }
  return { deckName: p.label, deck: { name: p.label, cards, sideboard: [], format: "commander", commanders: commander ? [commander] : [] }, commanderName: p.commander };
}
const DECK = loadDeck();

let finished = false, started = false;
const asked = [], putBack = [];
const finish = (ok, why) => {
  if (finished) return;
  finished = true;
  console.log(`${ok ? "PASS" : "FAIL"} seats ${SEATS}, free ${FREE}, ${MULLS} mulligans: ${why} (asked with counts ${asked.join(",")}; put back ${putBack.join(",") || "nothing"})`);
  process.exit(ok ? 0 : 1);
};
setTimeout(() => finish(false, "timed out"), 90000);

const clients = [];
class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-friendly-${i}-${Math.random().toString(36).slice(2, 6)}`;
    this.taken = 0;
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
      if (!room) return finish(false, `room ${ROOM} not found`);
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
      if (this.i === 0 && msg.room.max_players < SEATS && !this.maxSet) { this.maxSet = true; this.send({ type: "SetMaxPlayers", max_players: SEATS }); }
      if (!started && this.i === 0 && msg.room.status === "Lobby" && ready >= SEATS) { started = true; this.send({ type: "StartGame", format: "Commander" }); }
    } else if (msg.type === "GameStarted") this.slot = `player-${msg.player_order.indexOf(this.name)}`;
    else if (msg.type === "StateUpdate") this.onEnv(msg.state);
    else if (msg.type === "Error") console.log(`seat ${this.i} relay error`, msg.code, msg.message);
    else if (msg.type === "GameAborted") finish(false, "the game aborted");
  }
  onEnv(env) {
    if (!env || !this.slot || env.forPlayer !== this.slot) return;
    if (env.kind === "state") this.board = { state: env.state, fp: env.fingerprint };
    else if (env.kind === "stateDelta") {
      if (!this.board || this.board.fp !== env.base) return this.send({ type: "RequestResync" });
      this.board = { state: delta.apply(this.board.state, env.patch), fp: env.fingerprint };
    } else if (env.kind === "prompt") this.answer(env.prompt);
    else if (env.kind === "fatal") finish(false, `engine fatal: ${env.message}`);
    else if (env.kind === "error") finish(false, `engine error: ${JSON.stringify(env.error)}`);
  }
  answer(p) {
    const type = p.kind === "priority" ? "priority" : p.input?.type;
    if (type === "diceRolled") return this.respond(p, type, { type: "diceRolledAcknowledged" });
    if (type === "mulligan") {
      if (this.i !== 0) return this.respond(p, type, { type: "mulliganDecision", keep: true });
      asked.push(p.input.mulliganCount);
      const keep = this.taken >= MULLS;
      if (!keep) this.taken++;
      return this.respond(p, type, { type: "mulliganDecision", keep, ...(FREE == null ? {} : { freeCards: FREE }) });
    }
    if (type === "mulliganPutBack") {
      if (this.i === 0) putBack.push(p.input.count);
      return this.respond(p, type, { type: "mulliganPutBackDecision", cardIds: p.input.handCardIds.slice(0, p.input.count) });
    }
    // the mulligans are over: seat 0's hand says what the engine did
    const me = clients[0];
    const gv = me.board?.state?.gameView;
    if (gv && (gv.turn || 0) >= 1 && this.taken != null && me.taken === MULLS) {
      const zone = gv.zones.find((z) => z.zone === "hand" && z.ownerId === me.slot);
      const size = zone?.cards?.length ?? zone?.count;
      const want = 7 - BOTTOM;
      const bottomed = putBack.reduce((a, b) => a + b, 0);
      // (the active player has drawn nothing yet on turn 1 only if they are first; a drawn card is allowed for)
      const ok = bottomed === BOTTOM && (size === want || (size === want + 1 && gv.activePlayerId === me.slot && gv.step !== "upkeep"));
      return finish(ok, `hand ${size}, wanted ${want}; ${bottomed} on the bottom, wanted ${BOTTOM}`);
    }
    if (type === "priority") return this.respond(p, "chooseAction", { type: "pass" });
    if (type === "chooseAction") return this.respond(p, type, { type: "pass" });
    console.log(`seat ${this.i}: unexpected question ${type}`);
  }
}
clients[0] = new Client(0);
