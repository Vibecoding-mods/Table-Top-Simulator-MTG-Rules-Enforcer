// Mindslaver on a Forge AI, and the harmless AI, against the real engine, headless, no TTS: one human seat C and one
// Forge AI T playing decks/ai_passive_lands.json (the harmless bot of the hand tests).
//   The harmless AI never casts a spell or activates an ability, even with Counterspell, Shock and Llanowar Elves in
//   hand and the mana for them (release check 2026-11-10: it countered a spell a scenario put in its hand).
//   CR 722.1/722.2 on a Forge AI: in the turn C controls, every one of T's questions comes to C (none is answered by
//   Forge's AI), and C's own priority in that turn is a question of C's own: the board names C as the priority player
//   and C may cast Reflect Damage in the blockers step and with T's Shock on the stack (release check: the table passed
//   C's own priority there by itself).
// --record <file> writes the boards and questions C got in the controlled turn, for the bridge test
// (tests/golden/fixtures/mindslaver-ai-live.json, used by tests/test_bridge_claims.js).
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_mindslaver_ai_check.js.
const fs = require("fs");
const path = require("path");
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local";
const RECORD = arg("record", null);
const VERBOSE = process.argv.includes("--verbose");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "slaver-ai-check", deck: { name: "slaver-ai-check", cards: Array.from({ length: 99 }, () => card("Mountain")), sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };
// the harmless AI's deck as the bridge sends it (loadPreset)
const PASSIVE = (() => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "decks", "ai_passive_lands.json"), "utf8"));
  const cards = [];
  for (const e of p.cards) if (e.name !== p.commander) for (let k = 0; k < (e.count || 1); k++) cards.push(card(e.name));
  return { deckName: p.label, deck: { name: p.label, cards, sideboard: [], format: "commander", commanders: [card(p.commander)] }, commanderName: p.commander };
})();
const SLAVER = "Mindslaver", REFLECT = "Reflect Damage", BOLT = "Lightning Bolt", GIANT = "Hill Giant", SHOCK = "Shock", COUNTER = "Counterspell", ELVES = "Llanowar Elves";

const results = [];
const check = (ok, what) => { results.push({ ok: !!ok, what }); process.stdout.write(`${ok ? "pass" : "FAIL"}: ${what}\n`); return !!ok; };
let finished = false, started = false, botsAsked = false;
const finish = (why) => {
  if (finished) return;
  finished = true;
  if (why) process.stdout.write(`stopped: ${why}\n`);
  if (RECORD && S.record.length) fs.writeFileSync(RECORD, JSON.stringify(S.record));
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
const playerOf = (g, slot) => (g.players || []).find((p) => p.id === slot) || {};

// S.state: setup -> fix -> bolt -> slaver -> wait (the controlled turn, then T's own) -> done
const S = { state: "setup", C: null, T: null, fixId: 950, controlledTurn: null, record: [], own: [], ruled: [], tStack: [], ctlStack: [], attacked: false, shockCast: false };
let client = null;

class Client {
  constructor() {
    this.name = `tts-slaverai-${Math.random().toString(36).slice(2, 6)}`;
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
      }
      if (this.joined && !botsAsked) {
        botsAsked = true;
        // (as the bridge asks for a Forge AI: onRoomUpdate)
        this.send({ type: "BroadcastState", state: { kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId: `tts-${Date.now()}`, roomId: this.roomId,
          payload: { type: "spawnBot", deck: PASSIVE, decks: [PASSIVE], forgeAi: true } } });
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
      observe(this.g);
    } else if (env.kind === "prompt") {
      if (this.board) this.answer(env.prompt);
      else this.pending = env.prompt;
    } else if (env.kind === "fatal") finish(`engine fatal: ${env.message}`);
    else if (env.kind === "error") finish(`engine error: ${JSON.stringify(env.error)}`);
    if (this.board && this.pending) { const p = this.pending; this.pending = null; this.answer(p); }
  }
  answer(p) {
    const g = this.g, input = p.input || {}, type = p.kind === "priority" ? "chooseAction" : input.type;
    const controlled = S.controlledTurn != null && g.turn === S.controlledTurn && playerOf(g, S.T).controlledBy === S.C;
    if (VERBOSE) process.stdout.write(`t${g.turn} ${g.step} active ${g.activePlayerId} priority ${g.priorityPlayerId}: ${type} decider ${p.decidingPlayerId} (${S.state})\n`);
    if (controlled && type !== "diceRolled") {
      const entry = { step: g.step, type, decider: p.decidingPlayerId, priority: g.priorityPlayerId, stack: (g.stack || []).map((s) => `${cname(s)}:${s.controllerId}`),
        reflect: (input.actions || []).some((a) => a.type === "cast" && a.cardId === S.reflectId) };
      (g.priorityPlayerId === S.C && type === "chooseAction" ? S.own : S.ruled).push(entry);
      if (RECORD && type === "chooseAction" && (g.step === "combatDeclareBlockers" || (g.stack || []).length)) S.record.push({ board: this.board.state, prompt: p });
    }
    switch (type) {
      case "gameOver": return finish("the game ended");
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g, input);
      case "payManaCost": return this.respond(p, type, input.canConfirmFromPool ? { type: "pay", auto: false } : { type: "pay", auto: true });
      case "chooseBoardTargets": {
        let want = null;
        if (S.state === "bolt") want = input.candidates.find((c) => c.id === S.giantId);
        if (S.state === "slaver") want = input.candidates.find((c) => c.id === S.T);
        if (S.state === "wait" && controlled) want = input.candidates.find((c) => c.id === S.C);
        const chosen = want ? [want] : input.candidates.slice(0, input.minTargets);
        return this.respond(p, type, { type: "boardTargets", chosen: chosen.map(({ kind, id }) => ({ kind, id })) });
      }
      // (Mindslaver's sacrifice is a yes)
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: true });
      case "chooseCards": return this.respond(p, type, { type: "chooseCardsDecision", chosenCardIds: (input.cards || []).slice(0, input.min || 0).map((c) => c.id) });
      case "chooseFromSelection": return this.respond(p, type, { type: "selectionDecision", chosenIndices: [0] });
      case "chooseAttackers": {
        const giant = (input.attackers || []).find((a) => a.attackerId === S.giantId);
        if (controlled && giant && (giant.validTargetIds || []).includes(S.C)) {
          S.attacked = true;
          return this.respond(p, type, { type: "declareAttackers", assignments: [{ attackerId: S.giantId, targetId: S.C }] });
        }
        return this.respond(p, type, { type: "declareAttackers", assignments: [] });
      }
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

// every spell or ability T put on the stack while nobody controlled it, and in the controlled turn (only what C cast
// for T may be there), and T's lands when that turn starts and after it
const tLands = (g) => zone(g, "battlefield", S.T).filter((c) => (c.types || []).includes("Land")).map((c) => c.id).sort().join(",");
function observe(g) {
  if (!S.T || S.state === "setup" || S.state === "fix") return;
  if (S.controlledTurn != null && g.turn === S.controlledTurn + 1 && S.landsAfter == null) S.landsAfter = tLands(g);
  if (playerOf(g, S.T).controlledBy === S.C) {
    if (g.activePlayerId === S.T && S.controlledTurn == null) { S.controlledTurn = g.turn; S.landsBefore = tLands(g); process.stdout.write(`${S.C} controls ${S.T}'s turn ${g.turn}\n`); }
    // (keyed by the source card: a spell being cast shows as casting-N, then on the stack as engine-stack-N)
    for (const s of g.stack || []) if (s.controllerId === S.T && !S.ctlStack.some((x) => x.source === (s.sourceId || s.id))) S.ctlStack.push({ id: s.id, source: s.sourceId || s.id, name: cname(s) });
    return;
  }
  for (const s of g.stack || []) if (s.controllerId === S.T && !S.tStack.some((x) => x.source === (s.sourceId || s.id))) S.tStack.push({ id: s.id, source: s.sourceId || s.id, name: cname(s), turn: g.turn });
}

function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), empty = !(g.stack || []).length, mine = g.activePlayerId === S.C;
  const castOf = (id) => (input.actions || []).find((a) => a.cardId === id && a.type === "cast");
  if (S.state === "setup" && mine && main && empty && g.priorityPlayerId === S.C) {
    S.state = "fix";
    c.directive({ type: "applyState", fixId: S.fixId, ops: [
      { op: "createCard", name: SLAVER, player: S.C, zone: "battlefield" },
      ...[1, 2, 3, 4].map(() => ({ op: "createCard", name: "Wastes", player: S.C, zone: "battlefield" })),
      { op: "createCard", name: REFLECT, player: S.C, zone: "hand" },
      { op: "createCard", name: BOLT, player: S.C, zone: "hand" },
      // (floating mana empties at cleanup, so T's turn needs lands: Reflect Damage's {3}{R}{W} from Plains and
      // Mountains, whichever of them Mindslaver's {4} takes)
      ...["Plains", "Mountain"].flatMap((name) => [1, 2, 3, 4, 5, 6].map(() => ({ op: "createCard", name, player: S.C, zone: "battlefield" }))),
      { op: "mana", player: S.C, mana: "R" },
      { op: "createCard", name: GIANT, player: S.T, zone: "battlefield" },
      { op: "createCard", name: COUNTER, player: S.T, zone: "hand" },
      { op: "createCard", name: SHOCK, player: S.T, zone: "hand" },
      { op: "createCard", name: ELVES, player: S.T, zone: "hand" },
      ...["Island", "Island", "Island", "Mountain", "Mountain", "Forest", "Forest"].map((name) => ({ op: "createCard", name, player: S.T, zone: "battlefield" }))] });
    return;
  }
  if (S.state === "fix") {
    if (g.stateFix?.fixId !== S.fixId) return pass();
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`);
    S.slaverId = named(g, "battlefield", S.C, SLAVER)?.id;
    S.reflectId = named(g, "hand", S.C, REFLECT)?.id;
    S.boltId = named(g, "hand", S.C, BOLT)?.id;
    S.giantId = named(g, "battlefield", S.T, GIANT)?.id;
    S.counterId = named(g, "hand", S.T, COUNTER)?.id;
    if (!S.slaverId || !S.reflectId || !S.boltId || !S.giantId) return finish("set-up incomplete");
    const bolt = castOf(S.boltId);
    if (!bolt) return finish(`no cast action for ${BOLT}`);
    S.state = "bolt";
    return c.respond(p, "chooseAction", { type: "act", actionId: bolt.id });
  }
  if (S.state === "bolt" && empty && findIn(g, S.boltId)?.zone !== "hand") {
    check(!S.tStack.length, `the harmless AI answers ${BOLT} at its ${GIANT} with nothing (${JSON.stringify(S.tStack)})`);
    const act = (input.actions || []).find((a) => a.cardId === S.slaverId && a.type === "activateAbility");
    if (!act) return finish(`no Mindslaver ability: ${JSON.stringify(input.actions || []).slice(0, 600)}`);
    S.state = "slaver";
    return c.respond(p, "chooseAction", { type: "act", actionId: act.id });
  }
  if (S.state === "slaver" && empty && findIn(g, S.slaverId)?.zone === "graveyard") S.state = "wait";
  const controlled = S.controlledTurn != null && g.turn === S.controlledTurn && playerOf(g, S.T).controlledBy === S.C;
  if (S.state === "wait" && controlled && g.priorityPlayerId === S.T && g.step === "main2" && empty && !S.shockCast) {
    const shock = named(g, "hand", S.T, SHOCK);
    const cast = shock && castOf(shock.id);
    if (cast) { S.shockCast = true; return c.respond(p, "chooseAction", { type: "act", actionId: cast.id }); }
  }
  if (S.state === "wait" && S.controlledTurn != null && g.turn > S.controlledTurn + 1 && mine) {
    S.state = "done";
    return judge(g);
  }
  return pass();
}

function judge(g) {
  check(S.controlledTurn != null, `${S.C} takes control of ${S.T}'s turn (controlledBy on ${S.T})`);
  check(S.attacked, `${S.C} is asked ${S.T}'s attack and attacks with ${S.T}'s ${GIANT}`);
  check(S.shockCast, `${S.C} casts ${S.T}'s ${SHOCK} in ${S.T}'s second main phase`);
  check(S.ruled.length > 0 && S.ruled.every((x) => x.decider === S.C), `every question of ${S.T}'s in the controlled turn came to ${S.C} (${S.ruled.length})`);
  check(S.ctlStack.length === 1 && S.ctlStack[0].name === SHOCK, `in that turn ${S.T} cast only what ${S.C} cast for it (${JSON.stringify(S.ctlStack)})`);
  check(S.landsBefore != null && S.landsBefore === S.landsAfter, `and played no land of its own (${S.C} played none for it)`);
  const blockers = S.own.filter((x) => x.step === "combatDeclareBlockers");
  check(blockers.length > 0, `${S.C} gets its own priority in the blockers step, the board naming ${S.C} the priority player (${JSON.stringify(S.own.map((x) => x.step))})`);
  check(blockers.some((x) => x.reflect), `there ${S.C} may cast ${REFLECT} (${JSON.stringify(blockers)})`);
  const onShock = S.own.filter((x) => x.stack.some((s) => s.startsWith(`${SHOCK}:`)));
  check(onShock.length > 0 && onShock.some((x) => x.reflect), `${S.C} gets its own priority with ${S.T}'s ${SHOCK} on the stack and may cast ${REFLECT} (${JSON.stringify(onShock)})`);
  check(!S.tStack.length, `the harmless AI put nothing on the stack on its own turns (${JSON.stringify(S.tStack)})`);
  const tHand = zone(g, "hand", S.T);
  check(!tHand.some((x) => x.visibility === "visible"), `${S.C} no longer sees ${S.T}'s hand afterwards`);
  const tBattle = zone(g, "battlefield", S.T).map(cname);
  check(!tBattle.includes(ELVES), `the harmless AI never cast its ${ELVES} (battlefield: ${tBattle.filter((n) => !/^(Island|Mountain|Forest|Plains)$/.test(n)).join(", ")})`);
  check(!zone(g, "graveyard", S.T).some((x) => cname(x) === COUNTER), `its ${COUNTER} never went to its graveyard (graveyard: ${zone(g, "graveyard", S.T).map(cname).join(", ")})`);
  finish();
}

client = new Client();
