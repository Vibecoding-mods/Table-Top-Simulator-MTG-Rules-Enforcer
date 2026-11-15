// Hideaway against the real engine, headless, no TTS, two human seats. Expected results come from the rules, not from
// what the engine does: CR 702.75a, Hideaway N: "look at the top N cards of your library. Exile one of them face down
// and put the rest on the bottom ... in a random order"; CR 406.3: a face-down card in exile may be looked at by the
// player who exiled it when the effect allows it, and hideaway's rules (702.75b) let that player look at it for as long
// as it remains exiled. So: the land's controller (C) sees the hidden card's name, the other seat (T) doesn't, and both
// see that a face-down card lies under Mosswort Bridge (the link, exiledWith, is public).
// (2026-11-14 game: Red played Mosswort Bridge, hid Carnage Tyrant, and couldn't see it on the table.)
// --dump <file>: both seats' boards after the hideaway, as JSON (to feed the bridge by hand).
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_hideaway_check.js.
const fs = require("fs");
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 2;
const VERBOSE = process.argv.includes("--verbose");
const DUMP = arg("dump", "");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const BRIDGE = "Mosswort Bridge";
const cards = [];
for (const [n, k] of [["Forest", 60], ["Grizzly Bears", 39]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "hideaway-check", deck: { name: "hideaway-check", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };

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
const empty = (g) => !(g.stack || []).length;
const said = (c) => (c ? JSON.stringify({ id: c.id, n: cname(c), vis: c.visibility, fd: c.isFaceDown, ew: c.exiledWith, mayPlay: c.mayPlay, mayLook: c.canFaceDownBeShownTo }) : "nothing");

// S.state: setup -> fix -> play -> hidden -> done
const S = { state: "setup", C: null, T: null, fixId: 900 };
const clients = [];
const by = (slot) => clients.find((x) => x.slot === slot);

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-hideaway-${i}-${Math.random().toString(36).slice(2, 6)}`;
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

function applied(c, g, pass) {
  if (g.stateFix?.fixId !== S.fixId) { pass(); return false; }
  if (!g.stateFix.ok && g.stateFix.applied !== true) { finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`); return false; }
  return true;
}

function priority(c, p, g) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), acting = g.activePlayerId === c.slot;
  if (S.state === "setup" && acting && main && empty(g)) {
    S.C = c.slot;
    S.T = clients.map((x) => x.slot).find((s) => s !== c.slot);
    S.state = "fix";
    S.fixId++;
    return c.directive({ type: "applyState", fixId: S.fixId, ops: [{ op: "createCard", name: BRIDGE, player: S.C, zone: "hand" }] });
  }
  if (c.slot !== S.C) return pass();
  if (S.state === "fix") {
    if (!applied(c, g, pass)) return;
    const play = (p.input?.actions || []).find((a) => /Mosswort Bridge/.test(a.label || a.description || ""));
    if (!play) return finish(`no action plays Mosswort Bridge: ${JSON.stringify((p.input?.actions || []).map((a) => a.label || a.description))}`);
    S.state = "play";
    return c.respond(p, "chooseAction", { type: "act", actionId: play.id });
  }
  if (S.state === "play" && empty(g) && zone(g, "battlefield", S.C).some((x) => cname(x) === BRIDGE)) {
    S.state = "wait";
    return setTimeout(() => {
      const land = zone(c.g, "battlefield", S.C).find((x) => cname(x) === BRIDGE);
      const mine = zone(c.g, "exile", S.C), theirs = zone(by(S.T).g, "exile", S.C);
      process.stdout.write(`C's exile: ${mine.map(said).join(" ")}\nT's exile: ${theirs.map(said).join(" ")}\n`);
      const hidMine = mine.find((x) => x.isFaceDown || x.visibility === "hidden");
      const hidTheirs = theirs.find((x) => x.id === hidMine?.id);
      check(hidMine, "the hideaway card is in C's exile, face down");
      check(hidMine && cname(hidMine) && cname(hidMine) !== "?", `its controller sees its name (CR 702.75, 406.3): ${said(hidMine)}`);
      check(hidMine && hidMine.exiledWith === land?.id, `C's view links it to Mosswort Bridge: ${said(hidMine)}`);
      check(hidTheirs && !cname(hidTheirs), `the other seat doesn't see its name: ${said(hidTheirs)}`);
      if (DUMP) fs.writeFileSync(DUMP, JSON.stringify({ C: S.C, T: S.T, land: land?.id, hidden: hidMine?.id, views: { [S.C]: c.g, [S.T]: by(S.T).g } }, null, 1));
      S.state = "done";
      finish();
    }, 1500);
  }
  if (S.state === "wait") return;
  return pass();
}

clients[0] = new Client(0);
