// Phasing and the agreed rewind against the real engine, headless, no TTS, three human seats. Every expected result here
// comes from the Comprehensive Rules, not from what the engine happens to do: a comparison of engine and table can't fail
// when both are wrong, and on 2026-11-01 both agreed the phased-out creatures were simply gone.
//   CR 702.26b  phased out: treated as though it doesn't exist. Not a zone change, so nothing leaves the battlefield.
//   CR 702.26d  it phases in during its controller's untap step, before anything untaps (CR 502.1, 502.3).
//   CR 702.26f  tokens stay too; counters stay; no enters or leaves triggers (CR 702.26g, Elvish Visionary draws nothing).
//   CR 702.26e  what is attached to it phases out with it, and they come back still attached.
// Then the rewind: all agree while a question is open, nothing happens until the button, then the game goes back at once.
// Needs a fresh test stack: tools/live-check.sh <node tag>.
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
// (--seats 4: four people, the most the table seats; the node's room takes 4)
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = Number(arg("seats", 3));
const VERBOSE = process.argv.includes("--verbose");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "" });
const FODDER = "Elvish Visionary", DISMISSAL = "Galadriel's Dismissal", AURA = "Bonesplitter", TOKENS = "Raise the Alarm";
const cards = [];
for (const [n, k] of [[FODDER, 39], [DISMISSAL, 25], [AURA, 15], [TOKENS, 20]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "phasing-check", deck: { name: "phasing-check", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };

const results = [];
const check = (ok, what) => { results.push({ ok: !!ok, what }); console.log(`${ok ? "pass" : "FAIL"}: ${what}`); };
let finished = false, started = false;
const finish = (why) => {
  if (finished) return;
  finished = true;
  if (why) console.log(`stopped: ${why}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${bad || why ? "FAILED" : "PASSED"}: ${results.length - bad} of ${results.length} checks${why ? ", did not finish" : ""}`);
  process.exit(bad || why ? 1 : 0);
};
setTimeout(() => finish("timed out"), Number(arg("timeout", 240)) * 1000);

const cname = (c) => c.identity?.name || "";
const zone = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner)?.cards || [];
const allCards = (g) => (g.zones || []).flatMap((z) => (z.cards || []).map((c) => ({ ...c, zone: z.zone })));
const findIn = (g, id) => allCards(g).find((c) => c.id === id);

const T = { phase: "wait", activeByTurn: {} };
const clients = [];
const by = (slot) => clients.find((c) => c.slot === slot);
const others = (slot) => clients.filter((c) => c.slot !== slot);

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-phasing-${i}-${Math.random().toString(36).slice(2, 6)}`;
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
      if (this.i === 0 && msg.room.max_players < SEATS && !this.maxSet) { this.maxSet = true; this.send({ type: "SetMaxPlayers", max_players: SEATS }); }
      if (!started && this.i === 0 && msg.room.status === "Lobby" && ready >= SEATS) { started = true; this.send({ type: "StartGame", format: "Commander" }); }
    } else if (msg.type === "GameStarted") this.slot = `player-${msg.player_order.indexOf(this.name)}`;
    else if (msg.type === "StateUpdate") this.onEnv(msg.state);
    else if (msg.type === "Error") console.log(`seat ${this.i} relay error`, msg.code, msg.message);
    else if (msg.type === "GameAborted") finish("the game aborted");
  }
  onEnv(env) {
    if (!env || !this.slot || env.forPlayer !== this.slot) return;
    if (env.kind === "state") this.board = { state: env.state, fp: env.fingerprint };
    else if (env.kind === "stateDelta") {
      if (!this.board || this.board.fp !== env.base) return this.send({ type: "RequestResync" });
      this.board = { state: delta.apply(this.board.state, env.patch), fp: env.fingerprint };
    } else if (env.kind === "prompt") {
      if (this.board) this.answer(env.prompt);
      else this.pending = env.prompt;
    } else if (env.kind === "fatal") finish(`engine fatal: ${env.message}`);
    else if (env.kind === "error") finish(`engine error: ${JSON.stringify(env.error)}`);
    if (this.board && this.pending) { const p = this.pending; this.pending = null; this.answer(p); }
    watchVote(this);
  }
  answer(p) {
    const g = this.g, input = p.input || {}, type = p.kind === "priority" ? "chooseAction" : input.type;
    if (g.turn) T.activeByTurn[g.turn] = g.activePlayerId;
    if (VERBOSE) console.log(`seat ${this.slot} t${g.turn} ${g.step} stack ${(g.stack || []).length}: ${type} ${T.phase}`);
    switch (type) {
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g, input);
      case "payManaCost":
        if (input.canConfirmFromPool) return this.respond(p, type, { type: "pay", auto: false });
        return this.respond(p, type, { type: "pay", auto: true });
      case "chooseBoardTargets": {
        const mine = input.candidates.find((c) => c.id === this.slot);
        const chosen = T.phase === "dismissal" && mine ? [mine] : input.candidates.slice(0, input.minTargets);
        return this.respond(p, type, { type: "boardTargets", chosen: chosen.map(({ kind, id }) => ({ kind, id })) });
      }
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: true });
      case "chooseCards": {
        const held = {};
        for (const c of input.cards) held[cname(c)] = (held[cname(c)] || 0) + 1;
        const ids = [...input.cards].sort((a, b) => held[cname(b)] - held[cname(a)]).slice(0, input.min || 0).map((c) => c.id);
        return this.respond(p, type, { type: "chooseCardsDecision", chosenCardIds: ids });
      }
      case "chooseFromSelection": return this.respond(p, type, { type: "selectionDecision", chosenIndices: T.phase === "dismissal" ? [input.options?.length ? input.options.length - 1 : 0] : [0] });
      case "chooseAttackers": return attackers(this, p, g, input);
      case "chooseBlockers": return this.respond(p, type, { type: "declareBlockers", assignments: [] });
      case "revealCards": return this.respond(p, type, { type: "revealCardsAcknowledged" });
      default:
        console.log(JSON.stringify(p).slice(0, 700));
        return finish(`unexpected question ${type}`);
    }
  }
}

// A's board after the set-up: two creatures (one tapped, one with counters and Equipment) and the tokens
const watched = () => [...T.bears, T.aura, ...T.tokens];

function afterPhaseOut(c, g) {
  for (const client of clients) {
    const seen = client.g;
    // hand privacy, as far as the engine goes: each seat is sent the size of another's hand and none of its cards
    // (whether TTS shows a hand to its owner only needs people at the table)
    for (const other of others(client.slot)) {
      const hand = zone(seen, "hand", other.slot), n = zoneCount(seen, "hand", other.slot);
      check(n > 0 && hand.every((x) => !cname(x)), `${client.slot} sees ${other.slot}'s hand as ${n} cards, ${hand.filter((x) => cname(x)).length} named`);
    }
    const list = watched().map((id) => findIn(seen, id));
    check(list.every((x) => x?.zone === "battlefield"), `${client.slot}: every phased card is still in the battlefield zone (CR 702.26b: no zone change)`);
    check(list.every((x) => x?.phasedOut), `${client.slot}: every one is flagged phased out`);
    check(!zone(seen, "graveyard", T.A).some((x) => watched().includes(x.id)) && !zone(seen, "exile", T.A).some((x) => watched().includes(x.id)), `${client.slot}: none reached the graveyard or exile`);
  }
  const countered = findIn(g, T.bears[0]);
  check(countered?.counters?.P1P1 === 2, `the +1/+1 counters stay (${JSON.stringify(countered?.counters)})`);
  check(findIn(g, T.bears[1])?.tapped === true, "the tapped creature stays tapped while phased out");
  check(findIn(g, T.aura)?.attachedTo === T.bears[0], "the Equipment stays attached (CR 702.26e)");
  check(T.tokens.length >= 1 && T.tokens.every((id) => findIn(g, id)?.identity?.isToken), `the ${T.tokens.length} token(s) still exist (CR 702.26f)`);
}

function afterPhaseIn(g) {
  const list = watched().map((id) => findIn(g, id));
  check(list.every((x) => x?.zone === "battlefield" && !x.phasedOut), "at the next untap step everything phased in (CR 702.26d)");
  check(findIn(g, T.bears[1])?.tapped === false, "the tapped creature untapped the same step: phasing comes first (CR 502.1, 502.3)");
  check(findIn(g, T.bears[0])?.counters?.P1P1 === 2, "the counters came back with it");
  check(findIn(g, T.aura)?.attachedTo === T.bears[0], "the Equipment came back attached (CR 702.26e)");
  check(T.tokens.every((id) => findIn(g, id)?.identity?.isToken), "the tokens came back (CR 702.26f)");
  check(T.libraryBefore - zoneCount(g, "library", T.A) === 1, `no enters trigger: only the turn's draw left the library (${T.libraryBefore} -> ${zoneCount(g, "library", T.A)}, CR 702.26g)`);
}
const zoneCount = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner)?.count ?? 0;

function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  // (once the button is pressed nobody answers: the game has to get there by itself, and stay to be looked at)
  if (T.phase === "agreed" || T.phase === "done") return;
  const main = /main/i.test(g.step || ""), empty = !(g.stack || []).length, acting = g.activePlayerId === c.slot;
  const fixed = g.stateFix;
  if (T.phase === "wait" && g.turn >= 3 && acting && main && empty) {
    const hand = zone(g, "hand", c.slot);
    const fodder = hand.filter((x) => cname(x) === FODDER).slice(0, 2), aura = hand.find((x) => cname(x) === AURA);
    if (fodder.length < 2 || !aura || !hand.some((x) => cname(x) === DISMISSAL) || !hand.some((x) => cname(x) === TOKENS)) return pass();
    T.A = c.slot;
    T.bears = fodder.map((x) => x.id);
    T.aura = aura.id;
    T.phase = "fix";
    console.log(`phasing seat ${T.A} on turn ${g.turn}`);
    c.directive({ type: "applyState", fixId: 601, ops: [...fodder.map((x) => ({ op: "move", card: x.id, zone: "battlefield" })),
      { op: "move", card: aura.id, zone: "battlefield" }, { op: "attach", card: aura.id, to: fodder[0].id },
      { op: "counters", card: fodder[0].id, kind: "P1P1", n: 2 }, { op: "tap", card: fodder[1].id, tapped: true },
      { op: "mana", player: c.slot, mana: "W W W W W W C C" }] });
    return;
  }
  if (T.phase === "fix" && c.slot === T.A) {
    if (!fixed || fixed.fixId !== 601) return pass();
    check(!!fixed.ok || fixed.applied === true, `the set-up went in (${JSON.stringify(fixed).slice(0, 100)})`);
    const cast = (input.actions || []).find((a) => a.type === "cast" && /Raise the Alarm/.test(a.label || a.description || ""));
    if (!cast) return finish("no cast action for Raise the Alarm");
    T.phase = "tokens";
    return c.respond(p, "chooseAction", { type: "act", actionId: cast.id });
  }
  if (T.phase === "tokens" && c.slot === T.A && acting && main && empty && zone(g, "battlefield", T.A).some((x) => x.identity?.isToken)) {
    T.tokens = zone(g, "battlefield", T.A).filter((x) => x.identity?.isToken).map((x) => x.id);
    const cast = (input.actions || []).find((a) => a.type === "cast" && /Galadriel/.test(a.label || a.description || ""));
    if (!cast) return finish("no cast action for Galadriel's Dismissal");
    T.phase = "dismissal";
    T.checkpoint = (g.checkpoints || []).at(-1);
    return c.respond(p, "chooseAction", { type: "act", actionId: cast.id });
  }
  if (T.phase === "dismissal" && c.slot === T.A && empty && findIn(g, T.bears[0])?.phasedOut) {
    // (each seat's board comes on its own, so A's question can get here ahead of the others': they read it a moment later)
    T.phase = "settling";
    setTimeout(() => {
      afterPhaseOut(c, c.g);
      T.libraryBefore = zoneCount(c.g, "library", T.A);
      T.phaseTurn = c.g.turn;
      T.phase = "untilUntap";
      pass();
    }, 300);
    return;
  }
  if (T.phase === "untilUntap" && c.slot === T.A && acting && g.turn !== T.phaseTurn && /upkeep|draw|main/i.test(g.step || "")) {
    if (!/main/i.test(g.step || "") || !empty) return pass();
    afterPhaseIn(g);
    T.phase = "toAttack";
    T.checkpointTurn = g.turn;
    return pass();
  }
  return pass();
}

// The rewind: asked and agreed while A holds the attackers question. It must wait, then the button sends it back.
function attackers(c, p, g, input) {
  const list = input.attackers || [];
  if (T.phase !== "toAttack" || c.slot !== T.A || !list.length) return c.respond(p, "chooseAttackers", { type: "declareAttackers", assignments: [] });
  T.phase = "voting";
  T.turnAt = g.turn;
  T.target = (g.checkpoints || []).filter((x) => x.turn === g.turn).at(0) || (g.checkpoints || []).at(-1);
  console.log(`rewind asked at the attackers question, to checkpoint ${T.target?.checkpointId} (${T.target?.step})`);
  others(T.A)[0].directive({ type: "requestRestore", checkpointId: T.target.checkpointId });
  // (the question stays open: the point of the test)
}

function watchVote(c) {
  const v = c.g.restoreVote;
  if (T.phase !== "voting" && T.phase !== "agreed") return;
  if (!v) return;
  if (v.status?.type === "pending" && (v.awaitingPlayerIds || []).includes(c.slot) && !T[`voted${c.slot}`]) {
    T[`voted${c.slot}`] = true;
    return c.directive({ type: "restoreVote", voteId: v.voteId, accept: true });
  }
  if (T.phase === "voting" && v.status?.type === "pending" && !(v.awaitingPlayerIds || []).length && !T.agreedAt) {
    T.agreedAt = Date.now();
    setTimeout(() => {
      const G = by(T.A).g;
      check(G.restoreVote?.status?.type === "pending" && /attack/i.test(G.step || ""), `agreed with a question open: nothing moved until the button (${G.restoreVote?.status?.type}, ${G.step})`);
      T.phase = "agreed";
      T.pressedAt = Date.now();
      others(T.A)[1].directive({ type: "restoreVote", voteId: v.voteId, accept: true });
    }, 2000);
    return;
  }
  if (T.phase === "agreed" && v.status?.type === "approved") {
    T.phase = "done";
    setTimeout(() => {
      const G = by(T.A).g;
      console.log(`rewound in ${Date.now() - T.pressedAt - 500} ms: turn ${G.turn} ${G.step}`);
      check(G.turn === T.target.turn && G.step === T.target.step, `the button took the game to the restore point (turn ${G.turn} ${G.step}, wanted turn ${T.target.turn} ${T.target.step})`);
      check(!zone(G, "battlefield", T.A).some((x) => x.isAttacking), "the abandoned attack left nothing behind");
      finish();
    }, 500);
  }
}

clients[0] = new Client(0);
