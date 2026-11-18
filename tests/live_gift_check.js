// Gift targets against the real engine, headless, no TTS, two human seats. Long River's Pull ({U}{U}): "Gift a card.
// Counter target creature spell. If the gift was promised, instead counter target spell." With only a noncreature spell
// on the stack it has a legal target once the gift is promised (CR 702.174: the gift is chosen as the spell is cast,
// CR 601.2b, before targets, 601.2c), so it must be offered then. T casts Divination; C must be offered Long River's
// Pull, promise the gift, target Divination and counter it; T, the gift's only possible recipient, draws one card
// (and not Divination's two).
// (engine1128-gift: before it, ActionSpace read the ungifted target count and never offered the spell.)
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_gift_check.js.
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 2;
const VERBOSE = process.argv.includes("--verbose");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const PULL = "Long River's Pull", SPELL = "Divination";
const cards = [];
for (const [n, k] of [["Forest", 60], ["Grizzly Bears", 39]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "gift-check", deck: { name: "gift-check", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };

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

const cname = (c) => c.identity?.name || c.name || "";
const zone = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner)?.cards || [];
const empty = (g) => !(g.stack || []).length;
const label = (a) => a.label || a.description || "";

// S.state: setup -> fix -> cast -> respond -> gift -> target -> resolve -> done
const S = { state: "setup", C: null, T: null, fixId: 700, tHand: null, giftOffered: null };
const clients = [];
const by = (slot) => clients.find((x) => x.slot === slot);

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-gift-${i}-${Math.random().toString(36).slice(2, 6)}`;
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
    if (VERBOSE) process.stdout.write(`seat ${this.slot} t${g.turn} ${g.step} active ${g.activePlayerId}: ${type} (${S.state}) ${JSON.stringify(input).slice(0, 300)}\n`);
    switch (type) {
      case "gameOver": return finish("the game ended");
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g);
      case "payManaCost": return this.respond(p, type, input.canConfirmFromPool ? { type: "pay", auto: false } : { type: "pay", auto: true });
      case "chooseBoardTargets": return targets(this, p, input);
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: false });
      case "chooseCards": return this.respond(p, type, { type: "chooseCardsDecision", chosenCardIds: (input.cards || []).slice(0, input.min || 0).map((c) => c.id) });
      case "chooseFromSelection": return selection(this, p, input);
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

function selection(c, p, input) {
  const labels = (input.options || []).map((o) => o.label || "");
  if (c.slot === S.C && S.state === "respond") {
    process.stdout.write(`C's cast choice: ${JSON.stringify(labels)}\n`);
    const gift = labels.findIndex((l) => /gift|promise/i.test(l));
    check(gift >= 0, `the cast asks whether to promise the gift: ${JSON.stringify(labels)}`);
    if (gift < 0) return finish("no gift option");
    S.state = "gift";
    return c.respond(p, "chooseFromSelection", { type: "selectionDecision", chosenIndices: [gift] });
  }
  return c.respond(p, "chooseFromSelection", { type: "selectionDecision", chosenIndices: input.minTotal ? [0] : [] });
}

function targets(c, p, input) {
  const cands = input.candidates || [];
  if (c.slot === S.C && (S.state === "gift" || S.state === "respond")) {
    process.stdout.write(`C's targets: ${JSON.stringify(cands).slice(0, 500)}\n`);
    const top = (c.g.stack || [])[0] || {};
    const ids = new Set([top.id, top.cardId, top.card?.id, top.sourceCardId].filter((x) => x != null).map(String));
    const pick = cands.find((x) => ids.has(String(x.id))) || cands.find((x) => /stack|spell/i.test(x.kind || "")) ;
    check(pick, `Divination on the stack is a legal target with the gift promised: ${JSON.stringify(pick || cands).slice(0, 200)}`);
    if (!pick) return finish("no Divination target");
    S.state = "target";
    return c.respond(p, "chooseBoardTargets", { type: "boardTargets", chosen: [{ kind: pick.kind, id: pick.id }] });
  }
  return c.respond(p, "chooseBoardTargets", { type: "boardTargets", chosen: cands.slice(0, input.minTargets).map(({ kind, id }) => ({ kind, id })) });
}

function priority(c, p, g) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), acting = g.activePlayerId === c.slot;
  const actions = p.input?.actions || [];
  if (S.state === "setup" && acting && main && empty(g)) {
    S.T = c.slot;
    S.C = clients.map((x) => x.slot).find((s) => s !== c.slot);
    S.state = "fix";
    S.fixId++;
    const ops = [{ op: "createCard", name: SPELL, player: S.T, zone: "hand" }, { op: "createCard", name: PULL, player: S.C, zone: "hand" }];
    for (let i = 0; i < 3; i++) ops.push({ op: "createCard", name: "Island", player: S.T, zone: "battlefield" });
    for (let i = 0; i < 2; i++) ops.push({ op: "createCard", name: "Island", player: S.C, zone: "battlefield" });
    return c.directive({ type: "applyState", fixId: S.fixId, ops });
  }
  if (S.state === "fix" && c.slot === S.T) {
    if (g.stateFix?.fixId !== S.fixId) return pass();
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`);
    const cast = actions.find((a) => new RegExp(SPELL).test(label(a)));
    if (!cast) return finish(`no action casts ${SPELL}: ${JSON.stringify(actions.map(label))}`);
    S.state = "cast";
    return c.respond(p, "chooseAction", { type: "act", actionId: cast.id });
  }
  if (S.state === "cast" && c.slot === S.C && (g.stack || []).length) {
    S.tHand = zone(by(S.T).g, "hand", S.T).length;
    const offered = actions.find((a) => /Long River/.test(label(a)));
    process.stdout.write(`C's actions with ${SPELL} on the stack: ${JSON.stringify(actions.map(label))}\n`);
    check(offered, `${PULL} is offered against a noncreature spell (the gift makes its target legal)`);
    if (!offered) return finish(`${PULL} not offered`);
    S.state = "respond";
    return c.respond(p, "chooseAction", { type: "act", actionId: offered.id });
  }
  if ((S.state === "target" || S.state === "gift") && empty(g)) {
    S.state = "wait";
    return setTimeout(() => {
      const tg = by(S.T).g;
      const grave = zone(tg, "graveyard", S.T).map(cname), cgrave = zone(c.g, "graveyard", S.C).map(cname);
      const hand = zone(tg, "hand", S.T).length;
      process.stdout.write(`T's graveyard: ${JSON.stringify(grave)}; C's graveyard: ${JSON.stringify(cgrave)}; T's hand ${S.tHand} -> ${hand}\n`);
      check(grave.includes(SPELL), `${SPELL} was countered into T's graveyard`);
      check(cgrave.includes(PULL), `${PULL} resolved into C's graveyard`);
      check(hand === S.tHand + 1, `T drew the gift's one card, not Divination's two (hand ${S.tHand} -> ${hand})`);
      S.state = "done";
      finish();
    }, 1500);
  }
  if (S.state === "wait") return;
  return pass();
}

clients[0] = new Client(0);
