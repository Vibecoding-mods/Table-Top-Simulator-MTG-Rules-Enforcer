// Forge's own events against the real engine, headless, no TTS, three human seats: each card below does one thing, and
// the feed (GameViewDto.events) and the log told from it must say that thing. The expected results are what the card
// does by the rules, not what the engine happens to send, and every board seen is replayed through the bridge's real log.
//   CR 701.21  sacrifice   CR 701.8  destroy   CR 701.13  mill   CR 701.25  surveil   CR 121.1  draw   CR 701.23  search
//   CR 701.9   discard     CR 305.1  a land is played            CR 111.8   a token elsewhere than the battlefield ceases
// Hidden information: a card going from a library to a hand is never named to anyone in the feed.
// Needs a fresh test stack: tools/live-check.sh <node tag> tests/live_events_check.js.
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 3;
const VERBOSE = process.argv.includes("--verbose");

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const HELPER = { bear: "Elvish Visionary", sword: "Bonesplitter", dredger: "Darkblast" };
const STEPS = [
  { key: "land", play: "Mountain" },
  { key: "sacrifice", cast: "Village Rites", mana: "B", token: true },
  { key: "destroy", cast: "Disenchant", mana: "W W", needs: HELPER.sword, target: "helper" },
  { key: "mill", cast: "Thought Scour", mana: "U", target: "self" },
  { key: "surveil", cast: "Consider", mana: "U" },
  { key: "tutor", cast: "Demonic Tutor", mana: "B B" },
  { key: "discard", cast: "Faithless Looting", mana: "R" },
  { key: "bounce", cast: "Unsummon", mana: "U", needs: HELPER.bear, target: "helper" },
  { key: "tokenDies", cast: "Doom Blade", mana: "B B", token: true, target: "token" },
  { key: "tokenExiled", cast: "Swords to Plowshares", mana: "W", token: true, target: "token" },
  // (each move made by a mechanic carries the mechanic as its cause, SPEC §4a: explore's reveals, dredge's mill)
  { key: "explore", cast: "Jadelight Ranger", mana: "G G G" },
  { key: "dredge", cast: "Think Twice", mana: "U U", needs: HELPER.dredger, needsZone: "graveyard" },
];
const cards = [];
for (const [n, k] of [["Mountain", 20], ...STEPS.filter((s) => s.cast).map((s) => [s.cast, 7]), [HELPER.bear, 9], [HELPER.sword, 8], [HELPER.dredger, 7]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "events-check", deck: { name: "events-check", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };

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
const realTimeout = setTimeout;
realTimeout(() => finish(`timed out, done: ${Object.keys(T.done).join(" ")}`), Number(arg("timeout", 240)) * 1000);

const cname = (c) => c.identity?.name || "";
const zone = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner)?.cards || [];
const allCards = (g) => (g.zones || []).flatMap((z) => (z.cards || []).map((c) => ({ ...c, zone: z.zone })));
const findIn = (g, id) => allCards(g).find((c) => c.id === id);

const T = { done: {}, step: null, fixId: 700, boards: [], sizes: [] };
const clients = [];

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-events-${i}-${Math.random().toString(36).slice(2, 6)}`;
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
      if (this.slot === "player-0") {
        T.boards.push(JSON.parse(JSON.stringify(this.g)));
        T.sizes.push({ kind: env.kind, bytes: JSON.stringify(env.kind === "state" ? env.state : env.patch).length, events: JSON.stringify(this.g.events || []).length });
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
    if (VERBOSE) process.stdout.write(`seat ${this.slot} t${g.turn} ${g.step} stack ${(g.stack || []).length}: ${type} ${T.step?.key || ""} ${T.step?.state || ""}\n`);
    const mine = T.step?.seat === this.slot;
    switch (type) {
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g, input);
      case "payManaCost":
        if (input.canConfirmFromPool) return this.respond(p, type, { type: "pay", auto: false });
        return this.respond(p, type, { type: "pay", auto: true });
      case "chooseBoardTargets": {
        const want = mine ? input.candidates.find((c) => c.id === T.step.targetId) : null;
        const chosen = want ? [want] : input.candidates.slice(0, input.minTargets);
        return this.respond(p, type, { type: "boardTargets", chosen: chosen.map(({ kind, id }) => ({ kind, id })) });
      }
      // (dredge only in its own step: a Darkblast milled or surveiled early would otherwise replace another step's draws)
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: !/dredge/i.test(JSON.stringify(input)) || (mine && T.step.key === "dredge") });
      case "chooseCards": {
        const n = mine && T.step.key === "tutor" ? Math.max(input.min || 0, 1) : input.min || 0;
        return this.respond(p, type, { type: "chooseCardsDecision", chosenCardIds: input.cards.slice(0, n).map((c) => c.id) });
      }
      case "chooseFromSelection": return this.respond(p, type, { type: "selectionDecision", chosenIndices: [0] });
      case "chooseAttackers": return this.respond(p, type, { type: "declareAttackers", assignments: [] });
      case "chooseBlockers": return this.respond(p, type, { type: "declareBlockers", assignments: [] });
      case "revealCards": return this.respond(p, type, { type: "revealCardsAcknowledged" });
      case "scry": {
        // (surveil: every card it looks at into the graveyard, which is the case the feed has to tell from a mill)
        const moved = (input.cards || []).map((c) => c.id);
        return this.respond(p, type, { type: "scryDecision", zoneCardIds: (input.zones || []).map((z) => z === "graveyard" ? moved : []) });
      }
      default:
        process.stdout.write(`${JSON.stringify(p).slice(0, 700)}\n`);
        return finish(`unexpected question ${type}`);
    }
  }
}

// (by the card it plays, whatever the action's type is called)
const landAction = (c, g, input, name) => {
  const held = zone(g, "hand", c.slot).filter((x) => cname(x) === name).map((x) => x.id);
  return (input.actions || []).find((a) => held.includes(a.cardId));
};

function begin(c, p, g, input, step) {
  const hand = zone(g, "hand", c.slot);
  T.step = { ...step, seat: c.slot, state: "fix", from: T.boards.length, turn: g.turn };
  if (step.play) {
    const land = landAction(c, g, input, step.play);
    T.step.state = "cast";
    T.step.cardId = land.cardId;
    return c.respond(p, "chooseAction", { type: "act", actionId: land.id });
  }
  T.step.cardId = hand.find((x) => cname(x) === step.cast).id;
  const helper = step.needs ? hand.find((x) => cname(x) === step.needs) : null;
  if (helper) T.step.helper = helper.id;
  if (step.target === "helper") T.step.targetId = helper.id;
  if (step.target === "self") T.step.targetId = c.slot;
  T.step.fixId = ++T.fixId;
  c.directive({ type: "applyState", fixId: T.step.fixId, ops: [
    ...(helper ? [{ op: "move", card: helper.id, zone: step.needsZone || "battlefield" }] : []),
    ...(step.token ? [{ op: "createToken", script: "r_1_1_goblin", player: c.slot }] : []),
    { op: "mana", player: c.slot, mana: step.mana }] });
}

function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), empty = !(g.stack || []).length, acting = g.activePlayerId === c.slot, s = T.step;
  if (s?.seat === c.slot && s.state === "fix") {
    if (g.stateFix?.fixId !== s.fixId) return pass();
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 200)}`);
    if (s.token) {
      const tokens = zone(g, "battlefield", c.slot).filter((x) => x.identity?.isToken);
      s.tokenId = tokens.at(-1)?.id;
      if (s.target === "token") s.targetId = s.tokenId;
    }
    const cast = (input.actions || []).find((a) => a.type === "cast" && a.cardId === s.cardId);
    if (!cast) return finish(`no cast action for ${s.cast}: ${JSON.stringify((input.actions || []).map((a) => a.label)).slice(0, 300)}`);
    s.state = "cast";
    return c.respond(p, "chooseAction", { type: "act", actionId: cast.id });
  }
  if (s?.seat === c.slot && s.state === "cast" && empty && (s.play ? findIn(g, s.cardId)?.zone === "battlefield" : !zone(g, "hand", c.slot).some((x) => x.id === s.cardId))) {
    s.to = T.boards.length;
    T.done[s.key] = s;
    T.step = null;
    process.stdout.write(`${s.key} by ${s.seat} on turn ${g.turn}\n`);
    if (STEPS.every((x) => T.done[x.key])) return realTimeout(judge, 300);
  }
  if (!T.step && acting && main && empty && !finishedAll()) {
    const hand = zone(g, "hand", c.slot).map(cname);
    const step = STEPS.find((x) => !T.done[x.key] && hand.includes(x.play || x.cast) && (!x.needs || hand.includes(x.needs))
      && (!x.play || landAction(c, g, input, x.play)));
    if (step) return begin(c, p, g, input, step);
  }
  return pass();
}
const finishedAll = () => STEPS.every((x) => T.done[x.key]);

// the feed for a step: every entry on the boards it covers, new ones only
const feedOf = (s) => {
  const seen = new Set(), out = [];
  for (const b of T.boards.slice(s.from, Math.max(s.to, s.from + 1))) for (const e of b.events || []) if (!seen.has(e.seq)) { seen.add(e.seq); out.push(e); }
  const first = (T.boards[s.from - 1]?.events || []).at(-1)?.seq ?? 0;
  return out.filter((e) => e.seq > first);
};

function judge() {
  const D = T.done, on = (k, f) => feedOf(D[k]).filter(f);
  const lib = (e) => e.from === "Library";
  check(on("land", (e) => e.cardId === D.land.cardId && e.from === "Hand" && e.to === "Battlefield" && e.how === "played").length === 1, "a land from the hand is played");
  check(on("sacrifice", (e) => e.cardId === D.sacrifice.tokenId && e.from === "Battlefield" && e.how === "sacrificed").length === 1, "Village Rites: the token is sacrificed");
  check(on("sacrifice", (e) => lib(e) && e.to === "Hand" && e.how === "draw").length === 2, "Village Rites: two draws");
  check(on("destroy", (e) => e.cardId === D.destroy.helper && e.from === "Battlefield" && e.to === "Graveyard" && e.how === "destroyed").length === 1, "Disenchant destroys the artifact");
  check(on("mill", (e) => lib(e) && e.to === "Graveyard" && e.how === "mill" && e.cardId && e.ownerId === D.mill.seat).length === 2, "Thought Scour mills two, named");
  check(on("mill", (e) => lib(e) && e.to === "Graveyard" && e.cause === "Mill" && e.causeName === "Thought Scour").length === 2, "and Thought Scour's mill is the cause");
  check(on("mill", (e) => lib(e) && e.to === "Hand" && e.how === "draw").length === 1, "Thought Scour draws one");
  check(on("surveil", (e) => lib(e) && e.to === "Graveyard" && e.how === "surveil" && e.cardId).length === 1, "Consider's surveil isn't a mill");
  check(on("surveil", (e) => lib(e) && e.to === "Graveyard" && e.how === "surveil" && e.cause === "Surveil" && e.causeName === "Consider").length === 1, "and Consider's surveil is the cause");
  check(on("surveil", (e) => lib(e) && e.to === "Graveyard" && e.how !== "surveil").length === 0, "and nothing else was milled");
  check(on("explore", (e) => lib(e) && (e.to === "Graveyard" || e.to === "Hand") && e.cause === "Explore" && e.causeName === "Jadelight Ranger").length === 2, "Jadelight Ranger explores twice, each reveal moved by the explore");
  check(on("explore", (e) => lib(e) && e.how === "mill").length === 0, "and explore mills nothing");
  check(on("dredge", (e) => lib(e) && e.to === "Graveyard" && e.how === "mill" && e.cause === "Darkblast - Dredge 3").length === 3, "Darkblast's dredge mills three, dredge the cause");
  // (any Darkblast: a surveil or mill may have put another copy there first, and the dredge may pick that one)
  check(on("dredge", (e) => e.cardId && e.from === "Graveyard" && e.to === "Hand" && e.cause === "Darkblast - Dredge 3").length === 1, "and Darkblast returns to the hand by its dredge");
  check(on("dredge", (e) => lib(e) && e.to === "Hand" && e.how === "draw").length === 0, "and Think Twice's draw was replaced");
  check(on("tutor", (e) => lib(e) && e.to === "Hand" && !e.how).length === 1, "Demonic Tutor: a card to the hand that wasn't drawn");
  check(on("discard", (e) => e.from === "Hand" && e.to === "Graveyard" && e.how === "discard" && e.cardId).length === 2, "Faithless Looting discards two, named");
  check(on("discard", (e) => lib(e) && e.to === "Hand" && e.how === "draw").length === 2, "Faithless Looting draws two");
  if (!check(on("bounce", (e) => e.cardId === D.bounce.helper && e.from === "Battlefield" && e.to === "Hand").length === 1, "Unsummon returns the creature")) process.stdout.write(`bounce: helper ${D.bounce.helper}, feed ${JSON.stringify(feedOf(D.bounce))}\n`);
  check(on("tokenDies", (e) => e.cardId === D.tokenDies.tokenId && e.from === "Battlefield" && e.to === "Graveyard" && e.how === "destroyed").length === 1, "Doom Blade destroys the token, which goes to the graveyard first (CR 111.8)");
  check(on("tokenExiled", (e) => e.cardId === D.tokenExiled.tokenId && e.from === "Battlefield" && e.to === "Exile").length === 1, "Swords exiles the token");
  check(T.boards.flatMap((b) => b.events || []).some((e) => lib(e) && e.to === "Hand" && e.how === "draw"), "the turn's draws are on the feed");

  // nobody is told what moved from a library to a hand, the player's own seat or anyone else's
  for (const client of clients) check(!(client.g.events || []).some((e) => lib(e) && e.to === "Hand" && e.cardId), `${client.slot}: no library-to-hand entry names its card`);
  const same = clients.every((c) => JSON.stringify(c.g.events?.slice(0, -2)) === JSON.stringify(clients[0].g.events?.slice(0, -2)));
  check(same, "every seat is told the same feed");

  const heavy = [...T.sizes].sort((a, b) => b.bytes - a.bytes)[0], deltas = T.sizes.filter((x) => x.kind === "stateDelta");
  process.stdout.write(`feed size: ${Math.max(...T.sizes.map((x) => x.events))} bytes at most; largest message ${heavy.bytes} (${heavy.kind}); mean delta ${Math.round(deltas.reduce((n, x) => n + x.bytes, 0) / (deltas.length || 1))}\n`);

  // the same boards through the bridge's log (the harness freezes the clock, so this comes last)
  const harness = require("./bridge-harness");
  const h = harness.load();
  const COLORS = { "player-0": "White", "player-1": "Red", "player-2": "Yellow" };
  const seats = Object.entries(COLORS).map(([slot, color]) => { const s = new h.B.Seat(color, "x"); s.slot = slot; return [color, s]; });
  h.B._setGame({ seats: new Map(seats), bots: 0, total: 3, playerOrder: [], slotNames: COLORS, slotColor: COLORS, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  const lines = [];
  let prev = null;
  T.boards.forEach((b, i) => {
    const cur = h.B.logSnapshot(b), facts = h.B.engineFacts(b.events);
    if (prev) for (const l of h.B.logEvents(prev, cur, b, facts)) lines.push({ i, l });
    prev = cur;
  });
  const said = (k, re) => lines.filter((x) => x.i >= D[k].from - 1 && x.i <= D[k].to + 1 && re.test(x.l)).length;
  const who = (k) => COLORS[D[k].seat];
  check(said("land", new RegExp(`^${who("land")} plays Mountain`)) === 1, "log: the land is played");
  check(said("sacrifice", /Goblin.* is sacrificed/) === 1, "log: the token is sacrificed");
  check(said("sacrifice", new RegExp(`^${who("sacrifice")} draws two cards|^${who("sacrifice")} draws 2 cards`)) === 1, "log: two cards drawn");
  check(said("destroy", /^Bonesplitter is destroyed/) === 1, "log: the artifact is destroyed");
  check(said("mill", new RegExp(`^${who("mill")} mills `)) === 1, "log: the mill");
  check(said("tutor", new RegExp(`^${who("tutor")} puts a card from their library into their hand`)) === 1, "log: the search");
  // (only the move's own board: another step's draw or mill may sit right beside it)
  const atBoard = (k, is) => {
    const seq = feedOf(D[k]).find(is)?.seq;
    const i = T.boards.findIndex((b) => (b.events || []).some((e) => e.seq === seq));
    const said = lines.filter((x) => x.i === i).map((x) => x.l);
    process.stdout.write(`${k}'s board says: ${JSON.stringify(said)}\n`);
    return said;
  };
  const atSurveil = atBoard("surveil", (e) => e.how === "surveil");
  check(atSurveil.some((l) => new RegExp(`^${who("surveil")} surveils, putting .* into their graveyard`).test(l)) && !atSurveil.some((l) => /\bmills\b/.test(l)), "log: the surveil is said, no mill");
  const atExplore = atBoard("explore", (e) => e.cause === "Explore");
  check(atExplore.some((l) => /Jadelight Ranger explores/.test(l)) && !atExplore.some((l) => /\bmills\b/.test(l)), "log: the explore is said, no mill");
  check(said("dredge", new RegExp(`^${who("dredge")} dredges Darkblast instead of drawing \\(dredge 3\\), milling `)) === 1, "log: the dredge, in one line");
  check(said("dredge", /Darkblast is put into .* hand/) === 0, "log: and Darkblast's return isn't said again");
  const atSearch = atBoard("tutor", (e) => e.from === "Library" && e.to === "Hand" && !e.how);
  check(atSearch.some((l) => l.includes("from their library into their hand")) && !atSearch.some((l) => /\bdraws\b/.test(l)), "log: and no draw on the search's board");
  check(said("discard", new RegExp(`^${who("discard")} discards `)) === 1, "log: the discards on one line");
  check(said("bounce", new RegExp(`^Elvish Visionary returns to ${who("bounce")}'s hand`)) === 1, "log: the bounce");
  check(said("tokenDies", /Goblin.* dies/) === 1, "log: the token dies");
  check(said("tokenExiled", /Goblin.* is exiled/) === 1, "log: the token is exiled");
  if (VERBOSE) for (const { i, l } of lines) process.stdout.write(`${i}: ${l}\n`);
  finish();
}

clients[0] = new Client(0);
