// Two-Headed Giant Level 2 (shared team turns, CR 805 and 810.2) against the real engine, headless, no TTS: four human
// seats, the room controller sends the node a gameConfig (teams 1, 1, 2, 2 in join order, teamRules "sharedTurns", as
// bridge/teams.js gameConfig does for a start with teamTurns "shared") before StartGame. Checked on the engine's boards
// and questions:
//   - the view says sharedTurns, teams 1, 1, 2, 2, partners share one life total;
//   - turn 1, the starting team's: its first seat L is the active player, its partner M is asked in L's main phase and
//     both may play a land in that one turn (805.4c); both hands are still 7 (the starting team skips its first draw,
//     810.6); turn 2 is the other team's (805.4), its first seat O1 active, and both its players drew (805.4b);
//   - turn 3, by fix ops: one creature for each player. L and M each get their own chooseAttackers question in the
//     same combat and both creatures attack (805.10a, one combined attack);
//   - the joint block (805.10d, 805.2; docs/handoff/team-block-report.md): O1 (primary) is asked first and blocks, then
//     O2, who adds a block; that change is told to both defenders in a no-card notice and O1 is asked again (reviseRound
//     1, title, currentAssignments, teamBlockLines); O1 answers unchanged (Agree) and the block ends there;
//   - turn 4, the other team's: both play a land, then a rewind to the turn's main phase brings back the turn, the team
//     on it, the lands and hands, and each partner's land play;
//   - then a fix op puts O1 at 0 life and the whole team loses together.
// Needs a fresh test stack: LIVE_TIMEOUT=420 bash tools/live-check.sh <node tag> tests/live_2hg_level2_check.js
const delta = require("../bridge/state-delta");
const teams2hg = require("../bridge/teams");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", SEATS = 4;
const VERBOSE = process.argv.includes("--verbose");
const TEAM_OF_SEAT = [1, 1, 2, 2];

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const cards = [];
for (const [n, k] of [["Mountain", 60], ["Grizzly Bears", 39]]) for (let i = 0; i < k; i++) cards.push(card(n));
const COMMANDER = "Rograkh, Son of Rohgahh";
const DECK = { deckName: "2hg-l2-check", deck: { name: "2hg-l2-check", cards, sideboard: [], format: "commander", commanders: [card(COMMANDER)] }, commanderName: COMMANDER };
// the creatures the turn 3 fix makes, by role: L and M attack, O1 and O2 block
const CREATURE = { L: "Grizzly Bears", M: "Hill Giant", O1: "Wall of Wood", O2: "Centaur Courser" };

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
setTimeout(() => finish(`timed out in state ${S.state} (turn ${clients[0]?.g?.turn ?? "?"} ${clients[0]?.g?.step ?? "?"})`), Number(arg("timeout", 420)) * 1000);

const cname = (c) => c?.identity?.name || "";
const zoneOf = (g, z, owner) => (g.zones || []).find((x) => x.zone === z && x.ownerId === owner) || { cards: [], count: 0 };
const handCount = (g, slot) => zoneOf(g, "hand", slot).count ?? zoneOf(g, "hand", slot).cards.length;
const mountains = (g, slot) => zoneOf(g, "battlefield", slot).cards.filter((x) => cname(x) === "Mountain").length;
const playerOf = (g, slot) => (g.players || []).find((p) => p.id === slot) || {};
const lives = (g) => (g.players || []).map((p) => `${p.id} ${p.life}`).join(", ");
const empty = (g) => !(g.stack || []).length;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pairs = (list) => (list || []).map((a) => `${a.blockerId}|${a.attackerId}`).sort();
const findCard = (g, id) => { for (const z of g.zones || []) { const x = (z.cards || []).find((y) => y.id === id); if (x) return x; } return null; };

// S.state: setup -> t1 -> t2 -> fix3 -> combat -> t4 -> rewind -> voted -> pressed -> restored -> replay -> kill -> over
// L, M: the starting team (L its first seat); O1, O2: the other team (O1 its first seat, the primary player)
const S = { state: "setup", fixId: 950, epoch: 0, seen: {}, hand: {}, landTurn: {}, landFixed: {}, cr: {}, atk: [], blk: [], notices: [] };
const clients = [];
const by = (slot) => clients.find((x) => x && x.slot === slot);
const teamOfSlot = (slot) => TEAM_OF_SEAT[Number(String(slot).replace("player-", ""))];
const nameOf = (slot) => by(slot)?.name || slot;

class Client {
  constructor(i) {
    this.i = i;
    this.name = `tts-2hg2-${i}-${Math.random().toString(36).slice(2, 6)}`;
    try { this.ws = new WebSocket(RELAY); } catch (e) { finish(`relay ${RELAY} unreachable: ${e.message}`); return; }
    this.ws.addEventListener("open", () => this.send({ type: "Authenticate", username: this.name, password: KEY, service: false, client_platform: "unknown", engine_gate: "unknown", client_version: "3.56.0" }));
    this.ws.addEventListener("message", (ev) => this.onMsg(JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"))));
    this.ws.addEventListener("error", () => finish(`relay ${RELAY} unreachable or failed (seat ${i}, state ${S.state})`));
    this.ws.addEventListener("close", () => finish(`the relay closed seat ${i}'s connection in state ${S.state}`));
  }
  get g() { return this.board?.state?.gameView || {}; }
  send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }
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
        // the teams first, from the room controller, as the bridge sends them for "mtg 2hg turns shared"
        // (bridge/teams.js gameConfig with turns "shared"), then the start in join order
        const order = clients.map((c) => c.name);
        const config = teams2hg.gameConfig({ White: 1, Red: 1, Yellow: 2, Blue: 2 }, order, teams2hg.TEAM_COLORS, "2hg", null, false, "shared");
        check(config.teamRules === "sharedTurns" && same(config.players.map((p) => p.team), TEAM_OF_SEAT),
          `the gameConfig sent is the bridge's Level 2 one (teamRules ${config.teamRules}, teams ${config.players.map((p) => p.team).join(",")})`);
        this.send({ type: "BroadcastState", state: { kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId: `2hg2-${Date.now()}`, roomId: this.roomId, payload: config } });
        this.send({ type: "StartGame", format: "Commander", seat_order: order });
      }
    } else if (msg.type === "GameStarted") {
      this.slot = `player-${msg.player_order.indexOf(this.name)}`;
      if (this.i === 0) check(msg.player_order.every((u, k) => u === clients[k].name), `the seats are in join order (${msg.player_order.join(", ")})`);
    } else if (msg.type === "StateUpdate") this.onEnv(msg.state);
    else if (msg.type === "Error") process.stdout.write(`seat ${this.i} relay error ${msg.code} ${msg.message}\n`);
    else if (msg.type === "GameAborted") finish(`the game aborted in state ${S.state}`);
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
    } else if (env.kind === "fatal") finish(`engine fatal in state ${S.state}: ${env.message}`);
    else if (env.kind === "error") finish(`engine error in state ${S.state}: ${JSON.stringify(env.error)}`);
    if (this.board && this.pending) { const p = this.pending; this.pending = null; this.answer(p); }
  }
  answer(p) {
    if (finished) return;
    const g = this.g, input = p.input || {}, type = p.kind === "priority" ? "chooseAction" : input.type;
    if (VERBOSE) process.stdout.write(`seat ${this.slot} t${g.turn} ${g.step} active ${g.activePlayerId}: ${type} (${S.state}) ${input.title || input.presentation?.title || ""}\n`);
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
      case "chooseAttackers": return attackers(this, p, g, input);
      case "chooseBlockers": return blockers(this, p, g, input);
      case "revealCards": {
        // (a notice is a revealCards with no cards; its words are the presentation's title, as bridge.js reads them)
        if (!(input.cards || []).length) {
          const text = String(input.presentation?.title || input.presentation?.text || input.title || "");
          S.notices.push({ slot: this.slot, turn: g.turn, text });
          process.stdout.write(`notice to ${this.slot} (turn ${g.turn} ${g.step}): ${text}\n`);
        }
        return this.respond(p, type, { type: "revealCardsAcknowledged" });
      }
      case "chooseNumber": return this.respond(p, type, { type: "numberDecision", chosenNumber: input.min ?? 0 });
      case "reorder": return this.respond(p, type, { type: "reorderDecision", orderedIds: (input.items || []).map((x) => x.id) });
      case "scry": return this.respond(p, type, { type: "scryDecision", zoneCardIds: (input.zones || []).map(() => []) });
      default:
        process.stdout.write(`${JSON.stringify(p).slice(0, 700)}\n`);
        return finish(`unexpected question ${type} in state ${S.state}`);
    }
  }
}

// ── boards ──
function onBoard(c) {
  const g = c.g;
  if (!S.firstSeen && c.i === 0 && (g.players || []).length === SEATS && g.turn >= 1) {
    S.firstSeen = true;
    check(g.teamRules?.rule === "sharedTurns" && teams2hg.sharesTurns(g), `the view says Two-Headed Giant Level 2: teamRules.rule sharedTurns (${JSON.stringify(g.teamRules)})`);
    check(g.players.map((p) => p.teamNumber).join(",") === "1,1,2,2", `teams 1, 1, 2, 2 by seat (${g.players.map((p) => p.teamNumber).join(",")})`);
    const life = (s) => playerOf(g, s).life;
    check(life("player-0") === life("player-1") && life("player-2") === life("player-3") && life("player-0") > 0, `partners share one life total (${lives(g)})`);
  }
  // a fix's prompt held until the board shows the fix's result (see fix)
  if (c.heldFix && S.fixWait?.slot === c.slot && g.stateFix?.fixId === S.fixWait.fixId) { const h = c.heldFix; c.heldFix = null; c.answer(h); }
  watchVote(c);
  if (g.gameOver) gameOver(c);
}

// A fix (applyState directive) from c, which holds a priority prompt: the engine asks c again once it is applied, and
// then(c, p, g, input) goes on from there.
function fix(c, ops, what, then) {
  S.fixId++;
  S.fixWait = { slot: c.slot, fixId: S.fixId, what, then };
  c.directive({ type: "applyState", fixId: S.fixId, ops });
}

// ── priority ──
function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  if (S.fixWait) {
    if (c.slot !== S.fixWait.slot) return pass();
    if (g.stateFix?.fixId !== S.fixWait.fixId) { c.heldFix = p; return; }
    const w = S.fixWait;
    S.fixWait = null;
    if (!g.stateFix.ok && g.stateFix.applied !== true) return finish(`fix refused (${w.what}): ${JSON.stringify(g.stateFix).slice(0, 300)}`);
    return w.then(c, p, g, input);
  }
  // (the rewind: no priority answered from the request until the boards after it are checked)
  if (["rewind", "voted", "pressed"].includes(S.state)) return;
  if (S.state === "restored") { c.held = p; return; }
  const main = g.step === "main1";

  if (S.state === "setup") {
    if (!(main && empty(g) && g.activePlayerId === c.slot)) return pass();
    S.T1 = g.turn;
    S.L = c.slot;
    const n = Number(c.slot.replace("player-", ""));
    S.M = `player-${n + 1}`;
    S.O1 = n === 0 ? "player-2" : "player-0";
    S.O2 = n === 0 ? "player-3" : "player-1";
    S.role = { [S.L]: "L", [S.M]: "M", [S.O1]: "O1", [S.O2]: "O2" };
    process.stdout.write(`starting team ${S.L} + ${S.M}, other team ${S.O1} + ${S.O2}; turn ${S.T1}\n`);
    check(c.slot === "player-0" || c.slot === "player-2", `the starting player is a team's first seat (${c.slot})`);
    S.state = "t1";
  }
  const k = g.turn - S.T1;

  // a stall guard: the combat must have happened before the other team's next turn
  if (k >= 3 && S.state === "combat") {
    check(false, `the joint attack and block happened in turn ${S.T1 + 2} (attack asks ${S.atk.join(", ") || "none"}, block asks ${S.blk.map((b) => b.slot).join(", ") || "none"})`);
    return finish(`no joint combat in turn ${S.T1 + 2}`);
  }

  // turn 1: the starting team's one turn
  if (S.state === "t1" && k === 0) {
    if (main && empty(g) && (c.slot === S.L || c.slot === S.M) && firstAt(c, g)) {
      S.hand[`${g.turn}|${c.slot}`] = handCount(g, c.slot);
      if (c.slot === S.L) {
        check(g.activePlayerId === S.L, `turn ${g.turn}: the active player is the starting team's first seat ${S.L} (${g.activePlayerId})`);
        teamOnTurn(g, [S.L, S.M], `turn ${g.turn}`);
        check(handCount(g, S.L) === 7, `the starting team skips its first draw: ${S.L} holds 7 in main 1 (${handCount(g, S.L)})`);
      } else {
        check(g.activePlayerId === S.L, `turn ${g.turn}: partner ${S.M} is asked in main 1 while ${S.L} is the active player (the team's turn, not ${S.M}'s own) (${g.activePlayerId})`);
        check(teams2hg.isTurnOf(g, S.M), `the bridge reads turn ${g.turn} as ${S.M}'s too (isTurnOf)`);
        check(handCount(g, S.M) === 7, `the starting team skips its first draw: partner ${S.M} holds 7 too (${handCount(g, S.M)})`);
      }
    }
    if (main && empty(g) && (c.slot === S.L || c.slot === S.M) && S.landTurn[c.slot] !== g.turn) return playLand(c, p, g, input, `in the team's turn ${g.turn}`);
    return pass();
  }
  if (S.state === "t1" && k === 1) S.state = "t2";

  // turn 2: the other team's
  if (S.state === "t2" && k === 1) {
    if (main && empty(g) && (c.slot === S.O1 || c.slot === S.O2) && firstAt(c, g)) {
      if (c.slot === S.O1) {
        check(g.activePlayerId === S.O1, `the next turn goes to the other team: turn ${g.turn}'s active player is ${S.O1}, not ${S.M} (${g.activePlayerId})`);
        teamOnTurn(g, [S.O1, S.O2], `turn ${g.turn}`);
        check(handCount(g, S.O1) === 8, `the other team draws on its first turn: ${S.O1} holds 8 (${handCount(g, S.O1)})`);
        check(S.landTurn[S.L] === S.T1 && S.landTurn[S.M] === S.T1 && mountains(g, S.L) === 1 && mountains(g, S.M) === 1,
          `each partner played a land in the one team turn ${S.T1} (${S.L} ${mountains(g, S.L)} Mountain in turn ${S.landTurn[S.L]}, ${S.M} ${mountains(g, S.M)} in turn ${S.landTurn[S.M]})`);
      } else {
        check(g.activePlayerId === S.O1, `turn ${g.turn}: partner ${S.O2} is asked in main 1 while ${S.O1} is the active player (${g.activePlayerId})`);
        check(handCount(g, S.O2) === 8, `both of the team draw in the team's draw step (805.4b): ${S.O2} holds 8 (${handCount(g, S.O2)})`);
      }
    }
    if (main && empty(g) && (c.slot === S.O1 || c.slot === S.O2) && S.landTurn[c.slot] !== g.turn) return playLand(c, p, g, input, `in the team's turn ${g.turn}`);
    return pass();
  }
  if (S.state === "t2" && k === 2) {
    check(S.landTurn[S.O1] === S.T1 + 1 && S.landTurn[S.O2] === S.T1 + 1, `both of the other team played a land in their turn ${S.T1 + 1} (turns ${S.landTurn[S.O1]}, ${S.landTurn[S.O2]})`);
    S.state = "fix3";
  }

  // turn 3: one creature each, then the joint attack and block
  if (S.state === "fix3" && k === 2) {
    if (!(main && empty(g) && c.slot === S.L)) return pass();
    check(g.activePlayerId === S.L, `turn ${g.turn} is the starting team's again (${g.activePlayerId})`);
    S.state = "fixing3";
    return fix(c, Object.entries(CREATURE).map(([role, name]) => ({ op: "createCard", name, player: S[role], zone: "battlefield" })), "the turn 3 creatures", (c2, p2, g2) => {
      for (const [role, name] of Object.entries(CREATURE)) {
        const x = zoneOf(g2, "battlefield", S[role]).cards.find((y) => cname(y) === name);
        if (!x) return finish(`the fix made no ${name} for ${S[role]}`);
        S.cr[S[role]] = x.id;
      }
      S.atkName = { [S.cr[S.L]]: CREATURE.L, [S.cr[S.M]]: CREATURE.M };
      S.state = "combat";
      return c2.respond(p2, "chooseAction", { type: "pass" });
    });
  }
  if (S.state === "combat" && k === 2) {
    if (S.atk.length && !S.atkChecked) {
      S.atkChecked = true;
      const atk = (slot) => findCard(g, S.cr[slot]);
      check(same(S.atk, [S.L, S.M]), `both attacking partners got their own chooseAttackers question in the same combat, first seat first (${S.atk.join(", ")})`);
      check(atk(S.L)?.isAttacking && atk(S.M)?.isAttacking, `one combined attack: ${CREATURE.L} (${S.L}) and ${CREATURE.M} (${S.M}) are both attacking (${!!atk(S.L)?.isAttacking}, ${!!atk(S.M)?.isAttacking})`);
    }
    if (S.blk.length && !S.blkChecked) {
      S.blkChecked = true;
      const asks = S.blk.map((b) => `${b.slot}${b.round ? ` (revise ${b.round})` : ""}`).join(", ");
      check(S.blk.length === 3, `agreeing ended the joint block: 3 block questions in all, O1, O2, O1 again (${asks})`);
      const want = [`${S.cr[S.O1]}|${S.cr[S.L]}`, `${S.cr[S.O2]}|${S.cr[S.M]}`].sort();
      check(same(pairs(g.combatAssignments), want), `the team's block stands: ${CREATURE.O1} on ${CREATURE.L} and ${CREATURE.O2} on ${CREATURE.M} (${JSON.stringify(g.combatAssignments || [])})`);
      const change = (slot) => S.notices.some((n) => n.slot === slot && teams2hg.teamBlockNotice(n.text)?.kind === "change" && n.text.includes(`${CREATURE.O2} now blocks ${CREATURE.M}`));
      check(change(S.O1) && change(S.O2), `the partner's change is told to both defenders in a no-card notice ("…: ${CREATURE.O2} now blocks ${CREATURE.M}.") (${S.O1} ${change(S.O1)}, ${S.O2} ${change(S.O2)})`);
      const settle = S.notices.filter((n) => teams2hg.teamBlockNotice(n.text)?.kind === "settle");
      check(!settle.length, `an agreed block needs no settling: no "decides (team leader)" notice (${settle.map((n) => n.text).join(" | ") || "none"})`);
      S.state = "t4";
    }
    return pass();
  }

  // turn 4: the other team's again: both play a land, then the rewind to its main phase
  if (S.state === "t4" && k === 3) {
    if (main && empty(g) && c.slot === S.O1 && firstAt(c, g)) {
      check(g.activePlayerId === S.O1 && teams2hg.turnPlayerIds(g).join(",") === `${S.O1},${S.O2}`, `turn ${g.turn} is the other team's again (${g.activePlayerId}; on the turn ${teams2hg.turnPlayerIds(g).join(", ")})`);
      S.before = turnState(g);
    }
    if (main && empty(g) && (c.slot === S.O1 || c.slot === S.O2) && S.landTurn[c.slot] !== g.turn) return playLand(c, p, g, input, `in the team's turn ${g.turn}`);
    if (main && empty(g) && c.slot === S.O2 && S.landTurn[S.O1] === g.turn && S.landTurn[S.O2] === g.turn) {
      const cps = (g.checkpoints || []).filter((x) => x.turn === g.turn);
      S.target = cps.find((x) => x.step === "main1") || cps[0];
      if (!S.target) return finish(`no rewind point in turn ${g.turn} (${JSON.stringify((g.checkpoints || []).map((x) => `${x.turn} ${x.step}`))})`);
      if (!S.before) return finish(`${S.O1} was never asked in main 1 of turn ${g.turn}`);
      check(mountains(g, S.O1) === S.before.lands[S.O1] + 1 && mountains(g, S.O2) === S.before.lands[S.O2] + 1, `before the rewind both of the team played a land in turn ${g.turn} (${S.O1} ${mountains(g, S.O1)}, ${S.O2} ${mountains(g, S.O2)})`);
      S.state = "rewind";
      process.stdout.write(`${S.O2} asks to rewind to checkpoint ${S.target.checkpointId} (turn ${S.target.turn} ${S.target.step})\n`);
      c.directive({ type: "requestRestore", checkpointId: S.target.checkpointId });
      return; // (the question stays open: the restore takes the open priority prompt)
    }
    return pass();
  }

  // after the rewind: each partner's land play is back
  if (S.state === "replay" && k === 3) {
    if (main && empty(g) && (c.slot === S.O1 || c.slot === S.O2) && S.landTurn[c.slot] !== `r${g.turn}`) {
      return playLand(c, p, g, input, `again after the rewind in turn ${g.turn}`, `r${g.turn}`);
    }
    if (main && empty(g) && c.slot === S.O2 && S.landTurn[S.O1] === `r${g.turn}` && S.landTurn[S.O2] === `r${g.turn}`) {
      S.state = "kill";
      S.losers = [S.O1, S.O2];
      process.stdout.write(`fix: ${S.O1}'s life to 0\n`);
      return fix(c, [{ op: "life", player: S.O1, n: 0 }], "life 0", (c2, p2, g2) => {
        S.lifeAfter = lives(g2);
        return c2.respond(p2, "chooseAction", { type: "pass" });
      });
    }
    return pass();
  }
  if (S.state === "replay" && k > 3) {
    check(false, `after the rewind both of ${S.O1} + ${S.O2} played a land again in turn ${S.T1 + 3}`);
    return finish("the turn after the rewind ended without both land plays");
  }
  return pass();
}

// the first main 1 question of c in this turn (and since the last rewind)
function firstAt(c, g) {
  const key = `${S.epoch}|${g.turn}|${c.slot}`;
  if (S.seen[key]) return false;
  S.seen[key] = true;
  return true;
}

// the players on the turn, as the view says them: activeTeamIds when the engine sends it (proposed in
// tests/golden/fixtures/2hg-level2-protocol.json, not written by the engine as of team-block), and the bridge's reading
function teamOnTurn(g, team, when) {
  const ids = teams2hg.turnPlayerIds(g);
  check(same(ids, team), `${when}: the bridge reads both ${team.join(" + ")} as on the turn (turnPlayerIds ${ids.join(", ")})`);
  if (Array.isArray(g.activeTeamIds)) check(same([...g.activeTeamIds].sort(), [...team].sort()), `${when}: the view's activeTeamIds is the team (${g.activeTeamIds.join(", ")})`);
  else if (!S.noActiveTeamSaid) { S.noActiveTeamSaid = true; process.stdout.write("note: the view has no activeTeamIds; the team on the turn is read from activePlayerId and teamNumber\n"); }
}

// c plays a Mountain from hand (one is made in its hand first when it holds none); mark: what S.landTurn records
function playLand(c, p, g, input, when, mark = g.turn) {
  const handIds = new Set(zoneOf(g, "hand", c.slot).cards.filter((x) => cname(x) === "Mountain").map((x) => x.id));
  const key = `${S.epoch}|${g.turn}|${c.slot}`;
  if (!handIds.size) {
    if (S.landFixed[key]) return finish(`${c.slot} still holds no Mountain after the fix (turn ${g.turn})`);
    S.landFixed[key] = true;
    return fix(c, [{ op: "createCard", name: "Mountain", player: c.slot, zone: "hand" }], `a Mountain for ${c.slot}`, (c2, p2, g2, i2) => playLand(c2, p2, g2, i2, when, mark));
  }
  const land = (input.actions || []).find((a) => handIds.has(a.cardId));
  if (!check(land, `${c.slot} (${S.role[c.slot]}) may play a land ${when} (active ${g.activePlayerId})`)) {
    process.stdout.write(`  actions: ${JSON.stringify((input.actions || []).map((a) => `${a.type} ${a.label || ""}`)).slice(0, 400)}\n`);
    S.landTurn[c.slot] = mark;
    return c.respond(p, "chooseAction", { type: "pass" });
  }
  S.landTurn[c.slot] = mark;
  return c.respond(p, "chooseAction", { type: "act", actionId: land.id });
}

// what the rewind must bring back
function turnState(g) {
  return { turn: g.turn, step: g.step, active: g.activePlayerId, onTurn: teams2hg.turnPlayerIds(g).join(","), rule: g.teamRules?.rule,
    lands: Object.fromEntries(clients.map((x) => [x.slot, mountains(g, x.slot)])), hands: Object.fromEntries(clients.map((x) => [x.slot, handCount(g, x.slot)])) };
}

// ── the joint attack ──
function attackers(c, p, g, input) {
  const none = () => c.respond(p, "chooseAttackers", { type: "declareAttackers", assignments: [] });
  if (S.state !== "combat" || g.turn !== S.T1 + 2 || (c.slot !== S.L && c.slot !== S.M)) return none();
  S.atk.push(c.slot);
  const mine = S.cr[c.slot], partner = c.slot === S.L ? S.M : S.L;
  const list = input.attackers || [];
  const entry = list.find((a) => a.attackerId === mine);
  check(entry, `${c.slot}'s chooseAttackers offers its own ${S.atkName[mine]} (${list.map((a) => a.attackerId).join(", ")})`);
  check(!list.some((a) => a.attackerId === S.cr[partner]), `${c.slot}'s chooseAttackers leaves partner ${partner}'s creature to ${partner}`);
  if (!entry) return none();
  const want = c.slot === S.L ? S.O1 : S.O2;
  const targetId = (entry.validTargetIds || []).includes(want) ? want : (entry.validTargetIds || [])[0];
  return c.respond(p, "chooseAttackers", { type: "declareAttackers", assignments: [{ attackerId: mine, targetId }] });
}

// ── the joint block: O1 blocks, O2 adds a block (a change), O1 is asked again and agrees ──
function blockers(c, p, g, input) {
  const send = (assignments) => c.respond(p, "chooseBlockers", { type: "declareBlockers", assignments });
  if (S.state !== "combat" || g.turn !== S.T1 + 2) return send([]);
  const jb = teams2hg.jointBlock(input);
  const n = S.blk.length + 1;
  S.blk.push({ slot: c.slot, round: jb?.round || null });
  const atkIds = (input.attackers || []).map((a) => a.attackerId);
  const lines = jb?.lines || [];
  process.stdout.write(`block ask ${n} to ${c.slot}: title ${JSON.stringify(input.title ?? null)}, reviseRound ${input.reviseRound ?? "-"}, currentAssignments ${JSON.stringify(input.currentAssignments ?? null)}, lines ${JSON.stringify(lines)}\n`);
  const own = S.cr[c.slot];
  if (n === 1) {
    check(c.slot === S.O1, `the defending team is asked primary first: block question 1 goes to ${S.O1} (${c.slot})`);
    check(atkIds.includes(S.cr[S.L]) && atkIds.includes(S.cr[S.M]), `the primary may block either attacker, the one at the partner too (${atkIds.join(", ")})`);
    check(jb && /^Block with /.test(jb.title || "") && jb.round == null, `round 1's prompt is a joint block: title "Block with <partner>", no reviseRound (${JSON.stringify(input.title ?? null)}, ${input.reviseRound ?? "none"})`);
    S.firstBlock = [{ blockerId: own, attackerId: S.cr[S.L] }];
    return send(S.firstBlock);
  }
  if (n === 2) {
    check(c.slot === S.O2, `then the partner: block question 2 goes to ${S.O2} (${c.slot})`);
    check(jb && /^Block with /.test(jb.title || "") && jb.round == null, `the partner's round 1 prompt: title "Block with <partner>", no reviseRound (${JSON.stringify(input.title ?? null)})`);
    check(lines.some((l) => l.includes(CREATURE.L) && l.includes(CREATURE.O1)), `the partner's teamBlockLines show the primary's block (${CREATURE.O1} on ${CREATURE.L}) (${JSON.stringify(lines)})`);
    check(same(pairs(g.combatAssignments), [`${S.cr[S.O1]}|${S.cr[S.L]}`]), `while the partner is asked the board's combatAssignments hold the primary's block (${JSON.stringify(g.combatAssignments || [])})`);
    return send([{ blockerId: own, attackerId: S.cr[S.M] }]);
  }
  if (n === 3) {
    check(c.slot === S.O1, `the partner changed the team's block, so the primary ${S.O1} is asked again (${c.slot})`);
    check(jb?.round === 1, `the re-ask is revise round 1 (reviseRound ${input.reviseRound ?? "none"})`);
    check(/changed the blocks\. Agree or change\?$/.test(jb?.title || ""), `the revise title is "<partner> changed the blocks. Agree or change?" (${JSON.stringify(input.title ?? null)})`);
    check(same(pairs(jb?.agree), pairs(S.firstBlock)), `currentAssignments carry the primary's own blocks (${JSON.stringify(input.currentAssignments ?? null)})`);
    check(lines.some((l) => l.includes(CREATURE.M) && l.includes(CREATURE.O2)) && lines.some((l) => l.includes(CREATURE.L) && l.includes(CREATURE.O1)),
      `the revise teamBlockLines show the whole team's block (${JSON.stringify(lines)})`);
    // Agree: currentAssignments sent back unchanged
    return send(jb?.agree || S.firstBlock);
  }
  check(false, `no block question after the primary agreed (question ${n} to ${c.slot}, reviseRound ${input.reviseRound ?? "none"})`);
  return send(jb?.agree || []);
}

// ── the rewind (as tests/live_extra_turn_check.js and tests/live_phasing_check.js: requestRestore, every other seat
// votes yes, then a press once nobody is awaited) ──
function watchVote(c) {
  const v = c.g.restoreVote;
  if (!v || !["rewind", "voted", "pressed"].includes(S.state)) return;
  if (VERBOSE && JSON.stringify(v) !== c.lastVote) { c.lastVote = JSON.stringify(v); process.stdout.write(`  vote seen by ${c.slot} (${S.state}): ${c.lastVote.slice(0, 300)}\n`); }
  if (["declined", "unavailable"].includes(v.status?.type)) return finish(`the rewind vote ended ${v.status.type} (${JSON.stringify(v).slice(0, 300)})`);
  if (v.status?.type === "pending" && (v.awaitingPlayerIds || []).includes(c.slot) && !S[`voted${c.slot}`]) {
    S[`voted${c.slot}`] = true;
    S.state = "voted";
    return c.directive({ type: "restoreVote", voteId: v.voteId, accept: true });
  }
  if (S.state === "voted" && c.slot === S.O2 && v.status?.type === "pending" && !(v.awaitingPlayerIds || []).length) {
    S.state = "pressed";
    return c.directive({ type: "restoreVote", voteId: v.voteId, accept: true });
  }
  if ((S.state === "voted" || S.state === "pressed") && v.status?.type === "approved" && c.slot === S.O2) {
    S.state = "restored";
    for (const x of clients) { x.held = null; x.heldFix = null; } // (the rewind closes every open prompt and asks again)
    setTimeout(() => {
      // (the point is main 1's first question, where S.before was read; a point earlier in the turn is before the
      // draw, so only the lands are compared then)
      const atBefore = S.target.step === S.before.step;
      if (!atBefore) process.stdout.write(`note: the rewind point is ${S.target.step}, not ${S.before.step}: hands not compared\n`);
      for (const x of clients) {
        const now = turnState(x.g);
        check(now.turn === S.target.turn && now.step === S.target.step, `after the rewind ${x.slot} is back at turn ${S.target.turn} ${S.target.step} (${now.turn} ${now.step})`);
        check(now.active === S.O1 && now.onTurn === `${S.O1},${S.O2}` && now.rule === "sharedTurns", `after the rewind ${x.slot} sees the same team on the turn: ${S.O1} active, ${S.O1} + ${S.O2} on it, sharedTurns (${now.active}; ${now.onTurn}; ${now.rule})`);
        check(same(now.lands, S.before.lands) && (!atBefore || same(now.hands, S.before.hands)), `after the rewind ${x.slot} sees the lands${atBefore ? " and hands" : ""} as at the point (lands ${JSON.stringify(now.lands)} want ${JSON.stringify(S.before.lands)}; hands ${JSON.stringify(now.hands)} want ${JSON.stringify(S.before.hands)})`);
      }
      S.epoch++;
      S.state = "replay";
      for (const x of clients) if (x.held) { const h = x.held; x.held = null; x.answer(h); }
    }, 1000);
  }
}

// ── the end: the whole team loses together ──
function gameOver(c) {
  if (S.state === "over" || finished) return;
  const g = c.g;
  if (S.state !== "kill") return finish(`the game ended early in state ${S.state} (winner ${g.winnerId}, ${lives(g)})`);
  S.state = "over";
  const status = (slot) => playerOf(g, slot).status;
  check(S.losers.every((s) => status(s) === "lost"), `${S.O1} at 0 life: both of ${S.O1} + ${S.O2} lost together (${S.losers.map((s) => `${s} ${status(s)}`).join(", ")}; life ${S.lifeAfter || lives(g)})`);
  check([S.L, S.M].every((s) => status(s) !== "lost") && teamOfSlot(g.winnerId) === teamOfSlot(S.L), `the other team won (${S.L} ${status(S.L)}, ${S.M} ${status(S.M)}; winner ${g.winnerId})`);
  return finish();
}

clients[0] = new Client(0);
