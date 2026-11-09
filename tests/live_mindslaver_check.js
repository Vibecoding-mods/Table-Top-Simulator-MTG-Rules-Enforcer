// Mindslaver and a Star Trek card against the real engine, headless, no TTS, two human seats.
//   CR 722.1/722.2  controlling another player: the controller makes every choice and decision that player would make,
//   and may see what that player can see (their hand). Mindslaver: "You control target player during that player's
//   next turn."  Live check 9 (2026-11-06) found the controlled player's questions still going to that player.
//   Borg Queen, Perfection Manifest (TRK, 2026-11 Forge update): "When NICKNAME enters, assimilate target creature card
//   from an opponent's graveyard" (put it onto the battlefield under your control with a +1/+1 counter; it's a Borg
//   artifact creature and loses all other creature types).
// The seat that first reaches its main phase is the controller C, the other the target T.
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_mindslaver_check.js.
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 2;
const VERBOSE = process.argv.includes("--verbose");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const SLAVER = "Mindslaver", QUEEN = "Borg Queen, Perfection Manifest", BEAR = "Grizzly Bears";
const cards = [];
for (const [n, k] of [["Mountain", 60], [SLAVER, 20], [BEAR, 19]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "mindslaver-check", deck: { name: "mindslaver-check", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };

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
const allCards = (g) => (g.zones || []).flatMap((z) => (z.cards || []).map((c) => ({ ...c, zone: z.zone })));
const findIn = (g, id) => allCards(g).find((c) => c.id === id);
const playerOf = (g, slot) => (g.players || []).find((p) => p.id === slot) || {};

// S.state: setup -> fix -> queen -> slaver -> wait -> done
const S = { state: "setup", C: null, T: null, fixId: 900, prompts: [], controlledTurn: null, sawHand: false, played: null };
const clients = [];

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-slaver-${i}-${Math.random().toString(36).slice(2, 6)}`;
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
      observe(this);
    } else if (env.kind === "prompt") {
      if (this.board) this.answer(env.prompt);
      else this.pending = env.prompt;
    } else if (env.kind === "fatal") finish(`engine fatal: ${env.message}`);
    else if (env.kind === "error") finish(`engine error: ${JSON.stringify(env.error)}`);
    if (this.board && this.pending) { const p = this.pending; this.pending = null; this.answer(p); }
  }
  answer(p) {
    const g = this.g, input = p.input || {}, type = p.kind === "priority" ? "chooseAction" : input.type;
    S.prompts.push({ to: this.slot, decider: p.decidingPlayerId, turn: g.turn, active: g.activePlayerId, step: g.step, type, controlled: S.T ? playerOf(g, S.T).controlledBy || null : null, cardIds: (input.actions || []).map((a) => a.cardId).filter(Boolean) });
    if (VERBOSE) process.stdout.write(`seat ${this.slot} t${g.turn} ${g.step} active ${g.activePlayerId}: ${type} (${S.state})\n`);
    switch (type) {
      case "gameOver": return finish("the game ended");
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g, input);
      case "payManaCost": return this.respond(p, type, input.canConfirmFromPool ? { type: "pay", auto: false } : { type: "pay", auto: true });
      case "chooseBoardTargets": {
        let want = null;
        if (this.slot === S.C && S.state === "queen") want = input.candidates.find((c) => c.id === S.bearId);
        if (this.slot === S.C && S.state === "slaver") want = input.candidates.find((c) => c.id === S.T);
        if (VERBOSE) process.stdout.write(`  targets (${S.state}): ${JSON.stringify(input.candidates).slice(0, 400)}\n`);
        const chosen = want ? [want] : input.candidates.slice(0, input.minTargets);
        return this.respond(p, type, { type: "boardTargets", chosen: chosen.map(({ kind, id }) => ({ kind, id })) });
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

function observe(c) {
  const g = c.g;
  if (!S.T || c.slot !== S.C) return;
  const by = playerOf(g, S.T).controlledBy;
  if (by === S.C && g.activePlayerId === S.T && S.controlledTurn == null) {
    S.controlledTurn = g.turn;
    process.stdout.write(`${S.C} controls ${S.T}'s turn ${g.turn}\n`);
  }
  if (S.controlledTurn != null && g.turn === S.controlledTurn && by === S.C) {
    const hand = zone(g, "hand", S.T);
    if (hand.some((x) => x.visibility === "visible" && cname(x))) S.sawHand = true;
    S.handIds = new Set(hand.map((x) => x.id));
  }
}

function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), empty = !(g.stack || []).length, acting = g.activePlayerId === c.slot;
  if (S.state === "setup" && acting && main && empty) {
    S.C = c.slot;
    S.T = clients.map((x) => x.slot).find((s) => s !== c.slot);
    S.state = "fix";
    S.fixId++;
    c.directive({ type: "applyState", fixId: S.fixId, ops: [
      { op: "createCard", name: SLAVER, player: S.C, zone: "battlefield" },
      { op: "createCard", name: QUEEN, player: S.C, zone: "hand" },
      { op: "createCard", name: BEAR, player: S.T, zone: "graveyard" },
      // Mindslaver's {4} from lands: floating mana isn't offered for an ability that also sacrifices its source
      ...[1, 2, 3, 4].map(() => ({ op: "createCard", name: "Wastes", player: S.C, zone: "battlefield" })),
      { op: "mana", player: S.C, mana: "B B C C C C" }] });
    return;
  }
  if (S.state === "fix" && c.slot === S.C) {
    if (g.stateFix?.fixId !== S.fixId) return pass();
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`);
    const queen = zone(g, "hand", S.C).find((x) => cname(x) === QUEEN);
    const bear = zone(g, "graveyard", S.T).find((x) => cname(x) === BEAR);
    check(queen, `${QUEEN} (an upcoming TRK card) is made by name in the native engine`);
    if (!queen || !bear) return finish(`set-up incomplete: queen ${!!queen}, bear ${!!bear}`);
    S.queenId = queen.id;
    S.slaverId = zone(g, "battlefield", S.C).find((x) => cname(x) === SLAVER)?.id;
    S.bearId = bear.id;
    const cast = (input.actions || []).find((a) => a.cardId === queen.id && a.type === "cast");
    if (!cast) return finish(`no cast action for ${QUEEN}: ${JSON.stringify(input.actions).slice(0, 400)}`);
    S.state = "queen";
    return c.respond(p, "chooseAction", { type: "act", actionId: cast.id });
  }
  if (S.state === "queen" && c.slot === S.C && empty && findIn(g, S.queenId)?.zone === "battlefield") {
    const bear = zone(g, "battlefield", S.C).find((x) => cname(x) === BEAR);
    if (check(bear, "Borg Queen assimilates the Bears from the opponent's graveyard onto its controller's battlefield")) {
      check(bear.controllerId === S.C, "the assimilated Bears are under the Queen's controller");
      check((bear.types || []).includes("Artifact") && (bear.types || []).includes("Creature"), `they are an artifact creature (${JSON.stringify(bear.types)})`);
      check((bear.subtypes || []).includes("Borg") && !(bear.subtypes || []).includes("Bear"), `they are a Borg and no longer a Bear (${JSON.stringify(bear.subtypes)})`);
      check(Object.entries(bear.counters || {}).some(([k, v]) => /p1p1|\+1\/\+1/i.test(k) && v === 1),`with a +1/+1 counter (${JSON.stringify(bear.counters)})`);
    } else process.stdout.write(`  C battlefield: ${zone(g, "battlefield", S.C).map(cname).join(", ")}; T graveyard: ${zone(g, "graveyard", S.T).map(cname).join(", ")}\n`);
    const act = (input.actions || []).find((a) => a.cardId === S.slaverId && a.type === "activateAbility");
    if (!act) return finish(`no Mindslaver ability: slaver ${S.slaverId} ${JSON.stringify(findIn(g, S.slaverId) || null).slice(0, 300)}; pool ${JSON.stringify(playerOf(g, S.C).manaPool || null)}; actions ${JSON.stringify(input.actions || []).slice(0, 900)}`);
    S.state = "slaver";
    return c.respond(p, "chooseAction", { type: "act", actionId: act.id });
  }
  if (S.state === "slaver" && empty && findIn(g, S.slaverId)?.zone === "graveyard") S.state = "wait";
  if (S.state === "wait" && c.slot === S.C && S.controlledTurn != null && g.turn === S.controlledTurn && g.activePlayerId === S.T && main && empty && !S.played) {
    const handIds = new Set(zone(g, "hand", S.T).map((x) => x.id));
    const land = (input.actions || []).find((a) => a.type === "cast" && handIds.has(a.cardId) && cname(findIn(g, a.cardId) || {}) === "Mountain");
    if (land) {
      S.played = land.cardId;
      return c.respond(p, "chooseAction", { type: "act", actionId: land.id });
    }
  }
  if (S.state === "wait" && S.controlledTurn != null && g.turn > S.controlledTurn && c.slot === S.T && !playerOf(g, S.T).controlledBy) {
    S.state = "done";
    setTimeout(() => judge(clients.find((x) => x.slot === S.C).g), 300);
  }
  return pass();
}

function judge(gC) {
  const ct = S.controlledTurn;
  check(ct != null, `${S.C} takes control of ${S.T}'s turn (controlledBy on ${S.T})`);
  const inTurn = S.prompts.filter((x) => x.turn === ct && x.active === S.T);
  const toC = inTurn.filter((x) => x.to === S.C && x.type === "chooseAction");
  const toT = inTurn.filter((x) => x.to === S.T);
  check(toC.length > 0, `${S.C} gets priority questions in ${S.T}'s controlled turn (${toC.length})`);
  check(inTurn.some((x) => x.to === S.C && x.cardIds.some((id) => S.handIds?.has(id))), `and is offered ${S.T}'s own hand cards`);
  check(toT.length === 0, `${S.T} is asked nothing in its controlled turn (${toT.length}: ${JSON.stringify(toT.slice(0, 3))})`);
  check(S.sawHand, `${S.C} sees ${S.T}'s hand during the controlled turn`);
  if (check(S.played, `${S.C} plays a land from ${S.T}'s hand`)) {
    const at = findIn(gC, S.played);
    check(at?.zone === "battlefield" && at.controllerId === S.T && at.ownerId === S.T, `the land is on ${S.T}'s battlefield, under ${S.T} (${JSON.stringify({ zone: at?.zone, ctl: at?.controllerId })})`);
  }
  check(!zone(gC, "hand", S.T).some((x) => x.visibility === "visible"), `${S.C} no longer sees ${S.T}'s hand afterwards`);
  check(S.prompts.some((x) => x.to === S.T && x.turn > ct && x.type === "chooseAction"), `${S.T} decides for itself again after the controlled turn`);
  const misrouted = S.prompts.filter((x) => x.decider !== x.to && x.type !== "diceRolled");
  check(!misrouted.length, `every decision went to the seat it names (${misrouted.length}: ${JSON.stringify(misrouted.slice(0, 3))})`);
  finish();
}

clients[0] = new Client(0);
