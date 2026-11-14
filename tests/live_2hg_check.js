// Two-Headed Giant (Level 1) against the real engine, headless, no TTS: four human seats, the room controller sends the
// node a gameConfig (teams 1, 1, 2, 2 in join order, teamRules sharedLife) before StartGame, as bridge/teams.js does.
// Checked on the engine's own boards: the teams and the 2HG Commander numbers (80 life, poison 15, 42 commander damage);
// a partner's hand shown to the partner and to nobody else; the team's first seat starts and the team's turns come
// back to back; the starting team skips both first draws and the other team draws; then, by fix ops at the other
// team's turn: life lost by one player is the team's, poison is the team's (14 doesn't lose), one commander's damage
// adds up over the team (41 doesn't lose, 42 does) and the whole team loses together.
// Needs a fresh test stack: bash tools/live-check.sh 2hg tests/live_2hg_check.js
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 4;
const VERBOSE = process.argv.includes("--verbose");
const TEAM_OF_SEAT = [1, 1, 2, 2];

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const cards = [];
for (const [n, k] of [["Mountain", 60], ["Grizzly Bears", 39]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "2hg-check", deck: { name: "2hg-check", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };

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
setTimeout(() => finish(`timed out in state ${S.state}`), Number(arg("timeout", 420)) * 1000);

const zoneOf = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner) || { cards: [], count: 0 };
const playerOf = (g, slot) => (g.players || []).find((p) => p.id === slot) || {};
const lives = (g) => (g.players || []).map((p) => `${p.id} ${p.life}`).join(", ");
const poisons = (g) => (g.players || []).map((p) => `${p.id} ${p.counters?.poison || 0}`).join(", ");
const named = (cs) => cs.filter((c) => c.identity?.name).length;

// S.state: setup -> turns (watching turns 1-3) -> life -> poison -> cmd41 -> cmd42 -> over
const S = { state: "setup", turns: {}, handAtMain: {}, fixId: 900 };
const clients = [];
const bySlot = (slot) => clients.find((x) => x && x.slot === slot);
const teamOfSlot = (slot) => TEAM_OF_SEAT[Number(String(slot).replace("player-", ""))];

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-2hg-${i}-${Math.random().toString(36).slice(2, 6)}`;
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
        if (this.i === 0 && (msg.room.max_players ?? 4) < SEATS) this.send({ type: "SetMaxPlayers", max_players: SEATS });
        this.send({ type: "SetDeckSelection", deck_name: DECK.deckName, deck: DECK.deck, commander_name: DECK.commanderName });
        this.send({ type: "SetReady", ready: true });
        if (this.i + 1 < SEATS) clients[this.i + 1] = new Client(this.i + 1);
      }
      const ready = msg.room.players.filter((p) => p.ready && p.connected).length;
      if (!started && this.i === 0 && msg.room.status === "Lobby" && ready >= SEATS) {
        started = true;
        // the teams first (bridge/teams.js gameConfig), from the room controller, then the start in join order
        const order = clients.map((c) => c.name);
        this.send({ type: "BroadcastState", state: { kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId: `2hg-${Date.now()}`, roomId: this.roomId,
          payload: { type: "gameConfig", teamRules: "sharedLife", players: order.map((u, k) => ({ username: u, team: TEAM_OF_SEAT[k] })) } } });
        this.send({ type: "StartGame", format: "Commander", seat_order: order });
      }
    } else if (msg.type === "GameStarted") {
      this.slot = `player-${msg.player_order.indexOf(this.name)}`;
      if (this.i === 0) check(msg.player_order.every((u, k) => u === clients[k].name), `the seats are in join order (${msg.player_order.join(", ")})`);
    } else if (msg.type === "StateUpdate") this.onEnv(msg.state);
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
      onBoard(this);
    } else if (env.kind === "prompt") {
      if (this.board) this.answer(env.prompt);
      else this.pending = env.prompt;
    } else if (env.kind === "fatal") finish(`engine fatal: ${env.message}`);
    else if (env.kind === "error") finish(`engine error: ${JSON.stringify(env.error)}`);
    if (this.board && this.pending) { const p = this.pending; this.pending = null; this.answer(p); }
  }
  answer(p) {
    const g = this.g, input = p.input || {}, type = p.kind === "priority" ? "chooseAction" : input.type;
    if (VERBOSE) process.stdout.write(`seat ${this.slot} t${g.turn} ${g.step} active ${g.activePlayerId}: ${type} (${S.state}) ${p.title || ""}\n`);
    switch (type) {
      case "gameOver": return gameOver(this);
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g, input);
      case "payManaCost": return this.respond(p, type, { type: "pay", auto: true });
      case "chooseBoardTargets": return this.respond(p, type, { type: "boardTargets", chosen: input.candidates.slice(0, input.minTargets).map(({ kind, id }) => ({ kind, id })) });
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

// the first boards: teams, numbers, hands
function onBoard(c) {
  const g = c.g;
  if (!S.firstSeen && c.i === 0 && (g.players || []).length === SEATS && g.turn >= 1) {
    S.firstSeen = true;
    check(g.teamRules?.rule === "sharedLife" && g.teamRules?.poisonToLose === 15 && g.teamRules?.commanderDamageToLose === 42,
      `the view says 2HG Commander: shared life, poison 15, commander damage 42 (${JSON.stringify(g.teamRules)})`);
    check(g.players.map((p) => p.teamNumber).join(",") === "1,1,2,2", `teams 1, 1, 2, 2 by seat (${g.players.map((p) => p.teamNumber).join(",")})`);
    check(g.players.every((p) => p.life === 80), `every player starts at the team's 80 (${lives(g)})`);
  }
  if (!S.handsSeen && clients.every((x) => x?.board) && clients.every((x) => (x.g.players || []).length === SEATS)) {
    S.handsSeen = true;
    for (const x of clients) {
      const mate = clients.find((y) => y !== x && teamOfSlot(y.slot) === teamOfSlot(x.slot));
      const foe = clients.find((y) => teamOfSlot(y.slot) !== teamOfSlot(x.slot));
      const mateHand = zoneOf(x.g, "hand", mate.slot), foeHand = zoneOf(x.g, "hand", foe.slot);
      check(mateHand.count > 0 && named(mateHand.cards) === mateHand.count, `${x.slot} sees partner ${mate.slot}'s whole hand (${named(mateHand.cards)} of ${mateHand.count} named)`);
      check(foeHand.count > 0 && named(foeHand.cards) === 0, `${x.slot} sees none of opponent ${foe.slot}'s hand (${named(foeHand.cards)} of ${foeHand.count} named)`);
    }
  }
  if (g.gameOver) gameOver(c);
}

function gameOver(c) {
  const g = c.g;
  if (S.state !== "cmd42") return finish(`the game ended early in state ${S.state} (winner ${g.winnerId}, ${lives(g)})`);
  const losers = g.players.filter((p) => teamOfSlot(p.id) === S.hitTeam), winners = g.players.filter((p) => teamOfSlot(p.id) !== S.hitTeam);
  check(losers.every((p) => p.status === "lost"), `42 from one commander over the team: both of team ${S.hitTeam} lost (${losers.map((p) => `${p.id} ${p.status}`).join(", ")})`);
  check(winners.every((p) => p.status !== "lost") && teamOfSlot(g.winnerId) !== S.hitTeam, `the other team won (${winners.map((p) => `${p.id} ${p.status}`).join(", ")}; winner ${g.winnerId})`);
  S.state = "over";
  return finish();
}

function fix(c, ops) {
  S.fixId++;
  c.directive({ type: "applyState", fixId: S.fixId, ops });
}

function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = g.step === "main1", acting = g.activePlayerId === c.slot;
  if (S.state === "setup") S.state = "turns";
  if (S.state === "turns" && acting && main && !S.turns[g.turn]) {
    S.turns[g.turn] = c.slot;
    S.handAtMain[g.turn] = zoneOf(g, "hand", c.slot).count;
    if (g.turn === 1) check(c.slot === "player-0" || c.slot === "player-2", `the starting player is a team's first seat (${c.slot})`);
    if (g.turn === 2) {
      check(teamOfSlot(S.turns[2]) === teamOfSlot(S.turns[1]), `turn 2 is the starting player's partner (${S.turns[1]}, then ${S.turns[2]})`);
      check(S.handAtMain[1] === 7 && S.handAtMain[2] === 7, `both players of the starting team skip their first draw (hands ${S.handAtMain[1]}, ${S.handAtMain[2]})`);
    }
    if (g.turn === 3) {
      check(teamOfSlot(S.turns[3]) !== teamOfSlot(S.turns[1]), `turn 3 is the other team's (${S.turns[3]})`);
      check(S.handAtMain[3] === 8, `the other team draws on its first turn (hand ${S.handAtMain[3]})`);
      // the starting team takes the hits; the other team's first seat's commander deals them
      S.hitTeam = teamOfSlot(S.turns[1]);
      S.hit = g.players.filter((q) => teamOfSlot(q.id) === S.hitTeam).map((q) => q.id);
      S.cmd = zoneOf(g, "command", S.turns[3]).cards.find((x) => x.identity?.name === COMMANDER)?.id;
      if (!S.cmd) return finish(`no commander in ${S.turns[3]}'s command zone`);
      S.state = "life";
      S.fixer = c.slot;
      return fix(c, [{ op: "life", player: S.hit[0], n: 77 }]);
    }
    return pass();
  }
  if (c.slot === S.fixer && ["life", "poison", "cmd41", "cmd42"].includes(S.state)) {
    if (g.stateFix?.fixId !== S.fixId) return pass();
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`fix refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`);
    const life = (id) => playerOf(g, id).life, poison = (id) => playerOf(g, id).counters?.poison || 0;
    if (S.state === "life") {
      const others = g.players.filter((q) => !S.hit.includes(q.id));
      check(life(S.hit[0]) === 77 && life(S.hit[1]) === 77 && others.every((q) => q.life === 80), `3 life lost by ${S.hit[0]} is the team's: ${lives(g)}`);
      S.state = "poison";
      return fix(c, [{ op: "poison", player: S.hit[1], n: 14 }]);
    }
    if (S.state === "poison") {
      check(poison(S.hit[0]) === 14 && poison(S.hit[1]) === 14, `poison given to ${S.hit[1]} is the team's: ${poisons(g)}`);
      check(g.players.every((q) => q.status === "playing"), "14 poison doesn't lose");
      S.state = "cmd41";
      return fix(c, [{ op: "commanderDamage", player: S.hit[0], from: S.cmd, n: 20 }, { op: "commanderDamage", player: S.hit[1], from: S.cmd, n: 21 }]);
    }
    if (S.state === "cmd41") {
      check(g.players.every((q) => q.status === "playing"), `41 from one commander over the team doesn't lose (${S.hit[0]} 20, ${S.hit[1]} 21)`);
      S.state = "cmd42";
      fix(c, [{ op: "commanderDamage", player: S.hit[0], from: S.cmd, n: 21 }]);
      return;
    }
    if (S.state === "cmd42") return pass();
  }
  return pass();
}

clients[0] = new Client(0);
