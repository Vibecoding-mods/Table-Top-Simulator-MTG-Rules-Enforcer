// A Siege battle against the real engine, headless, no TTS: one human seat C and two Forge AIs (decks of basics).
//   CR 310.11 / 310.8: C casts Invasion of Ikoria (X = 2): it enters with defense counters, C chooses an opponent as
//   its protector, and its enter trigger searches C's library for a non-Human creature card with MV 2 or less.
//   CR 508.1b / 310.10: on C's next turn C attacks the battle with two Colossal Dreadmaws; the damage removes its
//   defense counters, and with none left it is defeated (CR 704.5v): C may cast it transformed without paying its mana
//   cost (CR 310.11c) and gets Zilortha, Apex of Ikoria.
// --record <file> writes every board and question C got from the cast to the end, with C's answers, for the bridge
// test (tests/golden/fixtures/battle-live.json, used by tests/test_bridge_claims.js: what the table says about a
// battle on the engine's own boards and questions; a real game 2026-11-14 found Invasion of Ikoria confusing).
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_battle_check.js.
const fs = require("fs");
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local";
const RECORD = arg("record", null);
const VERBOSE = process.argv.includes("--verbose");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const deckOf = (label, land, commander) => ({ deckName: label, deck: { name: label, cards: Array.from({ length: 99 }, () => card(land)), sideboard: [], format: "commander", commanders: [card(commander)] }, commanderName: commander });
const DECK = deckOf("battle-check", "Forest", "Ghalta, Primal Hunger");
const AI_DECK = deckOf("battle-check-ai", "Mountain", "Rograkh, Son of Rohgahh");
const BATTLE = "Invasion of Ikoria", BACK = "Zilortha, Apex of Ikoria", FETCH = "Grizzly Bears", BIG = "Colossal Dreadmaw";

const results = [];
const check = (ok, what) => { results.push({ ok: !!ok, what }); process.stdout.write(`${ok ? "pass" : "FAIL"}: ${what}\n`); return !!ok; };
let finished = false, started = false, botsAsked = false;
const finish = (why) => {
  if (finished) return;
  finished = true;
  if (why) process.stdout.write(`stopped: ${why}\n`);
  if (RECORD && S.record.length) fs.writeFileSync(RECORD, JSON.stringify({ human: S.C, ais: S.ais, record: S.record }));
  const bad = results.filter((r) => !r.ok).length;
  process.stdout.write(`${bad || why ? "FAILED" : "PASSED"}: ${results.length - bad} of ${results.length} checks${why ? ", did not finish" : ""}\n`);
  process.exit(bad || why ? 1 : 0);
};
setTimeout(() => finish(`timed out in state ${S.state}`), Number(arg("timeout", 300)) * 1000);

const cname = (c) => c.identity?.name || "";
const allCards = (g) => (g.zones || []).flatMap((z) => (z.cards || []).map((c) => ({ ...c, zone: z.zone, zoneOwner: z.ownerId })));
const findIn = (g, id) => allCards(g).find((c) => c.id === id);
const named = (g, z, owner, name) => allCards(g).find((x) => x.zone === z && x.zoneOwner === owner && cname(x) === name);

// S.state: setup -> fix -> cast -> wait -> attack -> defeat -> done
const S = { state: "setup", C: null, ais: [], fixId: 980, record: [], battleId: null, asked: [], castTurn: null, attacked: false, protector: null };
const recording = () => RECORD && !["setup", "fix"].includes(S.state);
let client = null;

class Client {
  constructor() {
    this.name = `tts-battle-${Math.random().toString(36).slice(2, 6)}`;
    this.ws = new WebSocket(RELAY);
    this.ws.addEventListener("open", () => this.send({ type: "Authenticate", username: this.name, password: KEY, service: false, client_platform: "unknown", engine_gate: "unknown", client_version: "3.56.0" }));
    this.ws.addEventListener("message", (ev) => this.onMsg(JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"))));
  }
  get g() { return this.board?.state?.gameView || {}; }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  respond(p, type, output) {
    if (recording()) S.record.push({ answer: { promptId: p.promptId ?? 0, type, output } });
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
      // (two Forge AIs, one spawnBot with both decks as the bridge asks: a battle's protector is chosen among the opponents)
      if (this.joined && !botsAsked) {
        botsAsked = true;
        this.send({ type: "BroadcastState", state: { kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId: `tts-${Date.now()}`, roomId: this.roomId,
          payload: { type: "spawnBot", deck: AI_DECK, decks: [AI_DECK, AI_DECK], forgeAi: true } } });
      }
      const ready = msg.room.players.filter((p) => p.ready && p.connected).length;
      if (VERBOSE) process.stdout.write(`room ${msg.room.status}: ${JSON.stringify(msg.room.players.map((p) => [p.username, p.ready, p.connected]))}\n`);
      if (!started && msg.room.status === "Lobby" && ready >= 3) { started = true; this.send({ type: "StartGame", format: "Commander" }); }
    } else if (msg.type === "GameStarted") {
      this.slot = `player-${msg.player_order.indexOf(this.name)}`;
      S.C = this.slot;
      S.ais = msg.player_order.map((u, i) => `player-${i}`).filter((p) => p !== this.slot);
      process.stdout.write(`C ${S.C}, AIs ${S.ais.join(", ")} (${msg.player_order.join(", ")})\n`);
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
      if (recording()) S.record.push({ board: JSON.parse(JSON.stringify(this.board.state)) });
    } else if (env.kind === "prompt") {
      if (recording()) S.record.push({ prompt: env.prompt });
      if (this.board) this.answer(env.prompt);
      else this.pending = env.prompt;
    } else if (env.kind === "fatal") finish(`engine fatal: ${env.message}`);
    else if (env.kind === "error") finish(`engine error: ${JSON.stringify(env.error)}`);
    if (this.board && this.pending) { const p = this.pending; this.pending = null; this.answer(p); }
  }
  answer(p) {
    const g = this.g, input = p.input || {}, type = p.kind === "priority" ? "chooseAction" : input.type;
    const title = input.presentation?.title || p.title || "";
    if (VERBOSE) process.stdout.write(`t${g.turn} ${g.step} active ${g.activePlayerId}: ${type} ${JSON.stringify(title).slice(0, 160)} (${S.state})\n`);
    if (type !== "chooseAction" && S.state !== "setup" && S.state !== "fix") {
      S.asked.push({ type, title, source: p.sourceCard?.identity?.name || "", options: (input.options || []).map((o) => o.label), text: p.sourceAbilityText || "" });
      process.stdout.write(`asked ${type} "${title}" ${JSON.stringify((input.options || []).map((o) => o.label)).slice(0, 300)} src ${p.sourceCard?.identity?.name || ""} :: ${String(p.sourceAbilityText || "").slice(0, 200)}\n`);
    }
    switch (type) {
      case "gameOver": return finish("the game ended");
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g, input);
      case "payManaCost": return this.respond(p, type, input.canConfirmFromPool ? { type: "pay", auto: false } : { type: "pay", auto: true });
      case "chooseBoardTargets": return this.respond(p, type, { type: "boardTargets", chosen: (input.candidates || []).slice(0, input.minTargets || 0).map(({ kind, id }) => ({ kind, id })) });
      // (the search and the cast transformed are yeses)
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: true });
      case "chooseCards": {
        const want = (input.cards || []).find((c) => cname(c) === FETCH);
        return this.respond(p, type, { type: "chooseCardsDecision", chosenCardIds: want ? [want.id] : (input.cards || []).slice(0, input.min || 0).map((c) => c.id) });
      }
      case "chooseFromSelection": {
        // (the protector: the first opponent offered, remembered by name)
        if ((input.options || []).length && S.state === "wait" && !S.protectorAsked) S.protectorAsked = String(input.options[0].label || "");
        return this.respond(p, type, { type: "selectionDecision", chosenIndices: [0] });
      }
      case "chooseAttackers": {
        const as = S.state === "attack" && S.battleId ? (input.attackers || []).filter((a) => (a.validTargetIds || []).includes(S.battleId)).map((a) => ({ attackerId: a.attackerId, targetId: S.battleId })) : [];
        if (as.length) { S.attacked = true; process.stdout.write(`attack targets ${JSON.stringify(input.attackTargets || []).slice(0, 400)}\n`); }
        return this.respond(p, type, { type: "declareAttackers", assignments: as });
      }
      case "chooseBlockers": return this.respond(p, type, { type: "declareBlockers", assignments: [] });
      case "revealCards": return this.respond(p, type, { type: "revealCardsAcknowledged" });
      case "chooseNumber": return this.respond(p, type, { type: "numberDecision", chosenNumber: S.state === "wait" ? Math.max(Number(input.min) || 0, Math.min(2, Number(input.max ?? 2))) : Number(input.min) || 0 });
      case "reorder": return this.respond(p, type, { type: "reorderDecision", orderedIds: (input.items || []).map((x) => x.id) });
      case "scry": return this.respond(p, type, { type: "scryDecision", zoneCardIds: (input.zones || []).map(() => []) });
      case "chooseDamageAssignmentOrder": return this.respond(p, type, { type: "damageAssignmentOrderDecision", orderedBlockerIds: input.blockerIds || [] });
      case "chooseCombatDamageAssignment": {
        const to = input.defenderId || (input.blockerIds || [])[0];
        return this.respond(p, type, { type: "combatDamageAssignmentDecision", assignments: to ? [{ assigneeId: to, damage: input.totalDamage }] : [] });
      }
      default:
        process.stdout.write(`${JSON.stringify(p).slice(0, 700)}\n`);
        return finish(`unexpected question ${type}`);
    }
  }
}

function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), empty = !(g.stack || []).length, mine = g.activePlayerId === S.C;
  if (S.state === "setup" && mine && main && empty && g.priorityPlayerId === S.C) {
    S.state = "fix";
    c.directive({ type: "applyState", fixId: S.fixId, ops: [
      { op: "createCard", name: BATTLE, player: S.C, zone: "hand" },
      { op: "createCard", name: FETCH, player: S.C, zone: "library" },
      { op: "createCard", name: BIG, player: S.C, zone: "battlefield" },
      { op: "createCard", name: BIG, player: S.C, zone: "battlefield" },
      { op: "mana", player: S.C, mana: "G G C C" }] });
    return;
  }
  if (S.state === "fix") {
    if (g.stateFix?.fixId !== S.fixId) return pass();
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`);
    const inv = named(g, "hand", S.C, BATTLE);
    if (!inv) return finish("set-up incomplete: no Invasion of Ikoria in hand");
    S.battleId = inv.id;
    const act = (input.actions || []).find((a) => a.cardId === S.battleId);
    if (!act) return finish(`no cast action: ${JSON.stringify(input.actions || []).slice(0, 600)}`);
    S.state = "wait";
    S.castTurn = g.turn;
    if (RECORD) S.record.push({ board: JSON.parse(JSON.stringify(c.board.state)) }, { prompt: p });
    return c.respond(p, "chooseAction", { type: "act", actionId: act.id });
  }
  if (S.state === "wait") {
    const b = findIn(g, S.battleId);
    if (b?.zone === "battlefield" && empty) {
      S.protector = b.protectorId || null;
      process.stdout.write(`battle on the battlefield: protector ${b.protectorId}, counters ${JSON.stringify(b.counters)}, types ${JSON.stringify(b.types)}\n`);
      S.state = "attack";
    } else if (g.turn > S.castTurn + 1) return finish(`the battle never resolved: ${JSON.stringify(b || null).slice(0, 300)}`);
  }
  if (S.state === "attack") {
    const zil = allCards(g).find((x) => cname(x) === BACK && x.zone === "battlefield");
    if (zil && empty) { S.state = "done"; return judge(g, zil); }
    if (g.turn > S.castTurn + 7) return finish("the battle was not defeated in time");
  }
  return pass();
}

function judge(g, zil) {
  check(!!S.protector && S.ais.includes(S.protector), `the battle's protector is an opponent (${S.protector})`);
  check(S.attacked, "C attacked the battle");
  check(zil.controllerId === S.C || zil.zoneOwner === S.C, `${BACK} is C's after the battle is defeated`);
  process.stdout.write(`C's questions: ${JSON.stringify(S.asked)}\n`);
  finish();
}

client = new Client();
