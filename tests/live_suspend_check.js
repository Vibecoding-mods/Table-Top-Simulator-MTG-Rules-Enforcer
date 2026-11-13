// Suspend against the real engine, headless, no TTS: one human seat C and one Forge AI T (decks of Mountains).
//   CR 702.62a: C suspends Rift Bolt from its hand for {R}: exiled with 1 time counter.
//   CR 702.62b/c: at the beginning of C's upkeep a time counter is removed; when the last is removed, C may cast it
//   without paying its mana cost. C casts it, targeting T: T loses 3 life.
//   And T's own Rift Bolt, put in T's exile with 1 time counter by the set-up: the AI's suspend cast, the same way.
// --record <file> writes every board and question C got from the set-up to the end, with C's answers, for the bridge
// test (tests/golden/fixtures/suspend-live.json, used by tests/test_bridge_claims.js: the log's "from suspend" lines
// on the engine's own boards; the table's log missed it live 2026-11-13).
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_suspend_check.js.
const fs = require("fs");
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local";
const RECORD = arg("record", null);
const VERBOSE = process.argv.includes("--verbose");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const COMMANDER = "Rograkh, Son of Rohgahh";
const deckOf = (label) => ({ deckName: label, deck: { name: label, cards: Array.from({ length: 99 }, () => card("Mountain")), sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER });
const DECK = deckOf("suspend-check"), AI_DECK = deckOf("suspend-check-ai");
const BOLT = "Rift Bolt";

const results = [];
const check = (ok, what) => { results.push({ ok: !!ok, what }); process.stdout.write(`${ok ? "pass" : "FAIL"}: ${what}\n`); return !!ok; };
let finished = false, started = false, botsAsked = false;
const finish = (why) => {
  if (finished) return;
  finished = true;
  if (why) process.stdout.write(`stopped: ${why}\n`);
  if (RECORD && S.record.length) fs.writeFileSync(RECORD, JSON.stringify({ human: S.C, ai: S.T, record: S.record }));
  const bad = results.filter((r) => !r.ok).length;
  process.stdout.write(`${bad || why ? "FAILED" : "PASSED"}: ${results.length - bad} of ${results.length} checks${why ? ", did not finish" : ""}\n`);
  process.exit(bad || why ? 1 : 0);
};
setTimeout(() => finish(`timed out in state ${S.state}`), Number(arg("timeout", 300)) * 1000);

const cname = (c) => c.identity?.name || "";
const zone = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner)?.cards || [];
const allCards = (g) => (g.zones || []).flatMap((z) => (z.cards || []).map((c) => ({ ...c, zone: z.zone })));
const findIn = (g, id) => allCards(g).find((c) => c.id === id);
const named = (g, z, owner, name) => zone(g, z, owner).find((x) => cname(x) === name);
const lifeOf = (g, slot) => (g.players || []).find((p) => p.id === slot)?.life;

// S.state: setup -> fix -> counters -> suspend -> wait -> done
const S = { state: "setup", C: null, T: null, fixId: 970, record: [], boltId: null, aiBoltId: null, asked: [], lifeT: null, lifeC: null, aiCast: false, cCast: false };
let client = null;

class Client {
  constructor() {
    this.name = `tts-suspend-${Math.random().toString(36).slice(2, 6)}`;
    this.ws = new WebSocket(RELAY);
    this.ws.addEventListener("open", () => this.send({ type: "Authenticate", username: this.name, password: KEY, service: false, client_platform: "unknown", engine_gate: "unknown", client_version: "3.56.0" }));
    this.ws.addEventListener("message", (ev) => this.onMsg(JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"))));
  }
  get g() { return this.board?.state?.gameView || {}; }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  respond(p, type, output) {
    if (RECORD && S.state !== "setup" && S.state !== "fix" && S.state !== "counters") S.record.push({ answer: { promptId: p.promptId ?? 0, type, output } });
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
      }
      if (this.joined && !botsAsked) {
        botsAsked = true;
        // (as the bridge asks for a Forge AI: onRoomUpdate)
        this.send({ type: "BroadcastState", state: { kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId: `tts-${Date.now()}`, roomId: this.roomId,
          payload: { type: "spawnBot", deck: AI_DECK, decks: [AI_DECK], forgeAi: true } } });
      }
      const ready = msg.room.players.filter((p) => p.ready && p.connected).length;
      if (!started && msg.room.status === "Lobby" && ready >= 2) { started = true; this.send({ type: "StartGame", format: "Commander" }); }
    } else if (msg.type === "GameStarted") {
      this.slot = `player-${msg.player_order.indexOf(this.name)}`;
      S.C = this.slot;
      S.T = `player-${msg.player_order.findIndex((u) => u !== this.name)}`;
      process.stdout.write(`C ${S.C}, T ${S.T} (${msg.player_order.join(", ")})\n`);
    } else if (msg.type === "StateUpdate") this.onEnv(msg.state);
    else if (msg.type === "Error") process.stdout.write(`relay error ${msg.code} ${msg.message}\n`);
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
      if (RECORD && S.state !== "setup" && S.state !== "fix" && S.state !== "counters") S.record.push({ board: JSON.parse(JSON.stringify(this.board.state)) });
      observe(this.g);
    } else if (env.kind === "prompt") {
      if (RECORD && S.state !== "setup" && S.state !== "fix" && S.state !== "counters") S.record.push({ prompt: env.prompt });
      if (this.board) this.answer(env.prompt);
      else this.pending = env.prompt;
    } else if (env.kind === "fatal") finish(`engine fatal: ${env.message}`);
    else if (env.kind === "error") finish(`engine error: ${JSON.stringify(env.error)}`);
    if (this.board && this.pending) { const p = this.pending; this.pending = null; this.answer(p); }
  }
  answer(p) {
    const g = this.g, input = p.input || {}, type = p.kind === "priority" ? "chooseAction" : input.type;
    if (VERBOSE) process.stdout.write(`t${g.turn} ${g.step} active ${g.activePlayerId}: ${type} ${JSON.stringify(input.presentation || p.title || "").slice(0, 160)} (${S.state})\n`);
    if (S.state === "wait" && type !== "chooseAction") S.asked.push({ type, title: input.presentation?.title || p.title || "", source: p.sourceCard?.identity?.name || "" });
    switch (type) {
      case "gameOver": return finish("the game ended");
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g, input);
      case "payManaCost": return this.respond(p, type, input.canConfirmFromPool ? { type: "pay", auto: false } : { type: "pay", auto: true });
      case "chooseBoardTargets": {
        const want = input.candidates.find((c) => c.id === S.T);
        const chosen = want ? [want] : input.candidates.slice(0, input.minTargets);
        return this.respond(p, type, { type: "boardTargets", chosen: chosen.map(({ kind, id }) => ({ kind, id })) });
      }
      // (the suspend cast's "may" is a yes: cast it)
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

function observe(g) {
  if (S.state !== "wait") return;
  if (S.aiBoltId && !S.aiCast && (g.stack || []).some((s) => s.sourceId === S.aiBoltId && !s.isTrigger)) { S.aiCast = true; process.stdout.write(`T casts its ${BOLT} on turn ${g.turn}\n`); }
  if (S.boltId && !S.cCast && (g.stack || []).some((s) => s.sourceId === S.boltId && !s.isTrigger)) { S.cCast = true; process.stdout.write(`C casts its ${BOLT} on turn ${g.turn}\n`); }
}

function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), empty = !(g.stack || []).length, mine = g.activePlayerId === S.C;
  if (S.state === "setup" && mine && main && empty && g.priorityPlayerId === S.C) {
    S.state = "fix";
    c.directive({ type: "applyState", fixId: S.fixId, ops: [
      { op: "createCard", name: BOLT, player: S.C, zone: "hand" },
      { op: "createCard", name: BOLT, player: S.T, zone: "exile" },
      { op: "mana", player: S.C, mana: "R" }] });
    return;
  }
  if (S.state === "fix") {
    if (g.stateFix?.fixId !== S.fixId) return pass();
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`);
    S.boltId = named(g, "hand", S.C, BOLT)?.id;
    S.aiBoltId = named(g, "exile", S.T, BOLT)?.id;
    if (!S.boltId || !S.aiBoltId) return finish(`set-up incomplete: ${S.boltId} ${S.aiBoltId}`);
    S.state = "counters";
    c.directive({ type: "applyState", fixId: S.fixId + 1, ops: [{ op: "counters", card: S.aiBoltId, kind: "TIME", n: 1 }] });
    return;
  }
  if (S.state === "counters") {
    if (g.stateFix?.fixId !== S.fixId + 1) return pass();
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`counters refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`);
    const act = (input.actions || []).find((a) => a.cardId === S.boltId && /suspend/i.test(`${a.type} ${a.label || ""} ${a.description || ""}`));
    if (!act) return finish(`no suspend action: ${JSON.stringify((input.actions || []).filter((a) => a.cardId === S.boltId)).slice(0, 600)}`);
    S.state = "wait";
    S.lifeT = lifeOf(g, S.T);
    S.lifeC = lifeOf(g, S.C);
    S.suspendTurn = g.turn;
    return c.respond(p, "chooseAction", { type: "act", actionId: act.id });
  }
  if (S.state === "wait") {
    const bolt = findIn(g, S.boltId), aiBolt = findIn(g, S.aiBoltId);
    const doneC = bolt?.zone === "graveyard" && S.cCast, doneT = aiBolt?.zone === "graveyard" && S.aiCast;
    if ((doneC && doneT && empty) || g.turn > S.suspendTurn + 3) { S.state = "done"; return judge(g); }
  }
  return pass();
}

function judge(g) {
  check(S.cCast, `C's suspended ${BOLT} is cast from exile (CR 702.62c)`);
  check(findIn(g, S.boltId)?.zone === "graveyard", `and resolves into C's graveyard`);
  check(lifeOf(g, S.T) <= S.lifeT - 3, `T took its 3 (${S.lifeT} -> ${lifeOf(g, S.T)})`);
  check(S.aiCast, `T's ${BOLT}, with 1 time counter in exile, is cast by the AI at its upkeep`);
  check(lifeOf(g, S.C) <= S.lifeC - 3, `C took T's 3 (${S.lifeC} -> ${lifeOf(g, S.C)})`);
  process.stdout.write(`C's questions while waiting: ${JSON.stringify(S.asked)}\n`);
  finish();
}

client = new Client();
