// What a seat may play and what it may only look at, against the real engine, headless, no TTS, two human seats.
// Expected results come from the cards' own text (Forge's scripts, read 2026-11-09), not from what the engine does:
//   Courser of Kruphix: "Play with the top card of your library revealed. You may play lands from the top of your
//   library." Its top card is shown to both players, a nonland one is playable for nobody, a land only for its owner.
//   (2026-11-08 20:23 game: the revealed top card was playable for both, and every scry threw it across the table.)
//   Revelation: "Players play with their hands revealed." Each hand is shown to the other seat, playable by neither.
// The seat that first reaches its main phase is C (Courser's and Revelation's controller), the other T.
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_reveal_check.js.
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 2;
const VERBOSE = process.argv.includes("--verbose");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const COURSER = "Courser of Kruphix", REVELATION = "Revelation", BEARS = "Grizzly Bears", LAND = "Forest";
const cards = [];
for (const [n, k] of [["Mountain", 60], ["Raging Goblin", 39]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "reveal-check", deck: { name: "reveal-check", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };

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
const top = (g) => zone(g, "library", S.C)[0];
const said = (c) => (c ? `${cname(c) || "?"} ${c.visibility}${c.mayPlay ? " mayPlay" : ""}` : "nothing");

// S.state: setup -> fix -> bears -> forest -> done
const S = { state: "setup", C: null, T: null, fixId: 800 };
const clients = [];
const by = (slot) => clients.find((x) => x.slot === slot);

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-reveal-${i}-${Math.random().toString(36).slice(2, 6)}`;
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

// a set-up step: the directive, then wait for C's next priority after it applied (the other seat's view a moment later)
function fix(c, ops, next) {
  S.fixId++;
  S.state = next;
  c.directive({ type: "applyState", fixId: S.fixId, ops });
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
    return fix(c, [
      { op: "createCard", name: COURSER, player: S.C, zone: "battlefield" },
      { op: "createCard", name: REVELATION, player: S.C, zone: "battlefield" },
      { op: "createCard", name: BEARS, player: S.C, zone: "hand" },
      { op: "createCard", name: LAND, player: S.C, zone: "hand" }], "fix");
  }
  if (c.slot !== S.C) return pass();
  if (S.state === "fix") {
    if (!applied(c, g, pass)) return;
    const bears = zone(g, "hand", S.C).find((x) => cname(x) === BEARS);
    if (!bears) return finish("Grizzly Bears didn't reach the hand");
    S.bears = bears.id;
    return fix(c, [{ op: "move", card: bears.id, zone: "library" }], "bears");
  }
  if (S.state === "bears") {
    if (!applied(c, g, pass)) return;
    S.state = "wait";
    return setTimeout(() => {
      const mine = top(c.g), theirs = top(by(S.T).g);
      check(mine?.id === S.bears && mine.visibility === "visible", `Courser: its owner sees the nonland top card (${said(mine)})`);
      check(mine && !mine.mayPlay, `Courser: a nonland top card isn't playable for its owner (${said(mine)})`);
      check(theirs?.id === S.bears && theirs.visibility === "visible", `Courser: the other seat sees it too (${said(theirs)})`);
      check(theirs && !theirs.mayPlay, `Courser: and may not play it (${said(theirs)})`);
      // Revelation: each hand in the other seat's view, shown, not playable
      const cHand = zone(by(S.T).g, "hand", S.C), tHand = zone(c.g, "hand", S.T);
      check(cHand.length > 0 && cHand.every((x) => x.visibility === "visible" && cname(x)), `Revelation: ${S.T} sees ${S.C}'s hand (${cHand.length} cards)`);
      check(tHand.length > 0 && tHand.every((x) => x.visibility === "visible" && cname(x)), `Revelation: ${S.C} sees ${S.T}'s hand (${tHand.length} cards)`);
      check(!cHand.some((x) => x.mayPlay) && !tHand.some((x) => x.mayPlay), "Revelation: a shown hand card isn't playable for the other seat");
      const land = zone(c.g, "hand", S.C).find((x) => cname(x) === LAND);
      if (!land) return finish("the Forest didn't stay in the hand");
      S.land = land.id;
      fix(c, [{ op: "move", card: land.id, zone: "library" }], "forest");
      pass();
    }, 1500);
  }
  if (S.state === "forest") {
    if (!applied(c, g, pass)) return;
    S.state = "wait";
    return setTimeout(() => {
      const mine = top(c.g), theirs = top(by(S.T).g);
      check(mine?.id === S.land && mine.mayPlay === true, `Courser: a land on top is playable for its owner (${said(mine)})`);
      check(theirs?.id === S.land && theirs.visibility === "visible" && !theirs.mayPlay, `Courser: shown to the other seat, not playable there (${said(theirs)})`);
      S.state = "done";
      finish();
    }, 1500);
  }
  if (S.state === "wait") return;
  return pass();
}

clients[0] = new Client(0);
