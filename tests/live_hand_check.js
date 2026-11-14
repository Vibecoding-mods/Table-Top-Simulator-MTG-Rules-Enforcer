// A picked starting hand against the real engine, headless, no TTS, two human seats (H, who picks, and O), both with
// the default Neheb, the Worthy preset (manabrew/public/preset_decks, the deck the bridge gives a seat with no deck of
// its own). What it shows (docs/companion-app-spec.md §10.3):
//   1. Forge's real keep-or-mulligan question: its shape, the 7 dealt cards; the library is hidden from the seat (a count,
//      no cards), so the bridge can't move the deck's own copies by id.
//   2. An applyState sent while that question is open is refused ("not waiting for priority"): the harness takes no
//      change before the deal or at the question, so stacking the opening hand needs an engine change.
//   3. Kept, then at H's first priority with nothing on the stack, the bridge's own handOps (bridge.js) turned into the
//      fix's ops by its own fixOps: Forge applies them, the hand is the picked cards plus the dealt ones kept (7 in all),
//      the dealt cards pushed out are at the bottom of the library (its count up by as many), and play goes on.
// The picks: a card H was dealt (the deck's own, stays), Counterspell (not in the deck: added), and Lightning Bolt
// (in the deck: stays if dealt, else added, its own copy left in the library).
// Needs a fresh test stack: tools/live-check.sh exile tests/live_hand_check.js
const delta = require("../bridge/state-delta");
const { readPreset } = require("../bridge/presets");
const harness = require("./bridge-harness");

// the bridge's functions, loaded once and the outside world given back at once (only pure helpers are used after)
const B = harness.load().B;
harness.restore();

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 2;
const VERBOSE = process.argv.includes("--verbose");

// the preset as the bridge's loadPreset builds it (bridge.js loadPreset)
function presetDeck(id) {
  const p = readPreset(id);
  const toCard = (e) => ({ identity: { name: e.name, setCode: e.set || "", cardNumber: String(e.cardNumber || "") }, manaCost: e.manaCost || "", cmc: e.cmc || 0,
    types: e.types || [], subtypes: e.subtypes || [], supertypes: e.supertypes || [], colorIdentity: e.colorIdentity || [], text: e.text || "", uris: {} });
  const cards = [];
  let commander = null;
  for (const e of p.cards) {
    if (p.commander && e.name === p.commander && !commander) { commander = toCard(e); continue; }
    for (let k = 0; k < (e.count || 1); k++) cards.push(toCard(e));
  }
  return { deckName: p.label, deck: { name: p.label, cards, sideboard: [], format: p.format || "commander", ...(commander ? { commanders: [commander] } : {}) }, commanderName: p.commander || null };
}
const DECK = presetDeck("neheb_minotaur_commander");
const DECK_NAMES = DECK.deck.cards.map((c) => c.identity.name);

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
setTimeout(() => finish(`timed out in state ${S.state}`), Number(arg("timeout", 180)) * 1000);

const cname = (c) => c.identity?.name || "";
const zoneOf = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner) || { cards: [], count: 0 };
const names = (cards) => cards.map(cname);
const sorted = (xs) => [...xs].sort();

// S.state: mulligan -> probed -> kept -> fixing -> done
const S = { state: "mulligan", H: null, fixId: 9100 };
const clients = [];

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-hand-${i}-${Math.random().toString(36).slice(2, 6)}`;
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
      if (this === S.hc) watchFix(this);
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
    const pass = () => this.respond(p, "chooseAction", { type: "pass" });
    switch (type) {
      case "gameOver": return finish("the game ended");
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.i === 0 ? mulligan(this, p, g, input) : this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction":
        if (this.i === 0) return priority(this, p, g);
        return pass();
      case "payManaCost": return this.respond(p, type, { type: "pay", auto: true });
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: false });
      case "chooseCards": return this.respond(p, type, { type: "chooseCardsDecision", chosenCardIds: (input.cards || []).slice(0, input.min || 0).map((c) => c.id) });
      case "chooseFromSelection": return this.respond(p, type, { type: "selectionDecision", chosenIndices: [0] });
      case "chooseAttackers": return this.respond(p, type, { type: "declareAttackers", assignments: [] });
      case "chooseBlockers": return this.respond(p, type, { type: "declareBlockers", assignments: [] });
      case "revealCards": return this.respond(p, type, { type: "revealCardsAcknowledged" });
      default:
        process.stdout.write(`${JSON.stringify(p).slice(0, 700)}\n`);
        return finish(`unexpected question ${type}`);
    }
  }
}

function mulligan(c, p, g, input) {
  if (S.state !== "mulligan") return c.respond(p, "mulligan", { type: "mulliganDecision", keep: true });
  S.H = c.slot; S.hc = c;
  process.stdout.write(`Forge's mulligan question (H ${c.slot}): ${JSON.stringify({ promptId: p.promptId, kind: p.kind, input: { ...input, handCardIds: `[${(input.handCardIds || []).length} ids]` } })}\n`);
  const hand = zoneOf(g, "hand", c.slot), lib = zoneOf(g, "library", c.slot);
  check(input.type === "mulligan" && (input.handCardIds || []).length === 7 && input.mulliganCount === 0, `the question: type mulligan, 7 dealt card ids, mulliganCount 0 (${input.type}, ${(input.handCardIds || []).length}, ${input.mulliganCount})`);
  check(hand.cards.length === 7 && sorted(hand.cards.map((x) => x.id)).join() === sorted(input.handCardIds || []).join(), `the board's hand is those 7 cards (${names(hand.cards).join(", ")})`);
  check(lib.count === DECK_NAMES.length - 7 && lib.cards.length === 0, `the library is hidden: a count (${lib.count}, ${DECK_NAMES.length} - 7) and no cards (${lib.cards.length})`);
  S.dealt = hand.cards.map((x) => ({ id: x.id, name: cname(x) }));
  // (2) a change while the question is open
  S.state = "probed";
  S.probeFix = ++S.fixId;
  S.mulliganPrompt = p;
  c.directive({ type: "applyState", fixId: S.probeFix, ops: [{ op: "createCard", name: "Counterspell", player: c.slot, zone: "hand" }] });
  setTimeout(() => {
    const f = c.g.stateFix;
    check(f && f.fixId === S.probeFix && f.applied !== true && /not waiting for priority/.test(String(f.message || "")), `an applyState at the mulligan question is refused: ${JSON.stringify(f)}`);
    check(names(zoneOf(c.g, "hand", c.slot).cards).join() === S.dealt.map((x) => x.name).join(), "and the hand is still the dealt one");
    S.state = "kept";
    c.respond(S.mulliganPrompt, "mulligan", { type: "mulliganDecision", keep: true });
  }, 2500);
}

function priority(c, p, g) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  if (S.state !== "kept" || (g.stack || []).length) return pass();
  // (3) the bridge's own change list, from the board as it is now
  S.state = "fixing";
  S.pick = [S.dealt[2].name, "Counterspell", "Lightning Bolt"];
  B._setGame({ seats: new Map(), slotColor: { [c.slot]: "Blue", [clients.find((x) => x !== c).slot]: "Red" }, slotNames: { [c.slot]: "Blue", [clients.find((x) => x !== c).slot]: "Red" }, started: true, fromTable: true });
  const list = B.handOps(S.pick, "Blue", g);
  const r = B.fixOps(list, g, true);
  if (r.error) return finish(`fixOps refused the bridge's own list: ${r.error}`);
  S.handBefore = zoneOf(g, "hand", c.slot).cards.map((x) => ({ id: x.id, name: cname(x) }));
  S.libBefore = zoneOf(g, "library", c.slot).count;
  S.under = list.filter((o) => o.op === "move").map((o) => o.card);
  S.added = list.filter((o) => o.op === "createCard").map((o) => o.name);
  const kept = S.handBefore.filter((x) => !S.under.includes(x.id));
  S.want = sorted([...kept.map((x) => x.name), ...S.added]);
  process.stdout.write(`first priority: turn ${g.turn} ${g.step}, active ${g.activePlayerId}; picks ${S.pick.join(", ")}; ops ${JSON.stringify(r.ops)}\n`);
  check(S.added.includes("Counterspell") && !S.added.includes(S.dealt[2].name), `the dealt pick stays, Counterspell (not in the deck) is added (${S.added.join(", ")})`);
  S.fix = ++S.fixId;
  S.fixPrompt = p;
  c.directive({ type: "applyState", fixId: S.fix, ops: r.ops });
}

function watchFix(c) {
  const f = c.g.stateFix;
  if (S.state !== "fixing" || !f || f.fixId !== S.fix) return;
  S.state = "done";
  check(f.applied === true, `the fix applied: ${JSON.stringify(f)}`);
  setTimeout(() => {
    const g = c.g, hand = zoneOf(g, "hand", c.slot).cards, lib = zoneOf(g, "library", c.slot);
    check(hand.length === 7, `the hand is 7 cards (${hand.length}: ${names(hand).join(", ")})`);
    check(sorted(names(hand)).join("|") === S.want.join("|"), `the hand is the picked cards plus the dealt ones kept (${S.want.join(", ")})`);
    check(S.pick.every((n) => names(hand).includes(n)), `every picked card is in the hand (${S.pick.join(", ")})`);
    check(!hand.some((x) => S.under.includes(x.id)), "the dealt cards pushed out are gone from the hand");
    check(lib.count === S.libBefore + S.under.length, `the library holds them: ${S.libBefore} + ${S.under.length} = ${lib.count}`);
    const kept = S.handBefore.filter((x) => !S.under.includes(x.id)).map((x) => x.id);
    check(kept.every((id) => hand.some((x) => x.id === id)), "the dealt cards kept are the same cards (same ids, the deck's own)");
    if (VERBOSE) process.stdout.write(`hand order now: ${names(hand).join(", ")}\n`);
    finish();
  }, 1500);
}

clients[0] = new Client(0);
