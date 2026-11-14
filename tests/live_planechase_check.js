// Planechase against the real engine, headless, no TTS: one human seat H with 12 planes and three passive Forge AIs
// with none (docs/planechase-dungeon-engine-spec.md, the live spike). Expected results come from the rules and from
// Forge's own text, not from what the engine does:
//   CR 901.9 / Forge's Planar Dice effect: "{X}: Roll the planar dice. X is equal to the number of times you have
//   previously taken this action this turn." Only the active player, in a main phase, with an empty stack, so H is
//   offered a roll then and never at another time; the first roll of a turn costs {0} (no payment asked), then {1}, {2}.
//   Planechase.planarDecks (our Forge build): a player with no planes is dealt some from the pool, round-robin, so every
//   AI has a planar deck; the first plane comes from the starting player's deck.
//   CR 901.6: the planes are controlled by the active player (PhaseHandler moves them at each turn).
//   CR 901.10 (Forge's Game.onPlayerLost): when a player leaves the game, the planes they own leave with them, and the
//   planar controller (the active player) planeswalks from their own planar deck.
// A plane's owner isn't on the board (the plane card's ownerId is the command zone's player), so it is worked out from
// the planar decks' sizes: a planeswalk puts the old plane at the bottom of its owner's deck (+1) and takes the new one
// from its owner's (-1). Every plane's owner is learned by planeswalking to it with the debug op, in H's first turn.
// The cases: A, on H's turn the owner of the plane in play loses (H planeswalks from H's deck); B, on an AI's turn
// another AI owns the plane in play and loses (that AI planeswalks from its dealt deck).
// Each case's plane is put in play by the debug op, whose "player" is chosen to keep two engine traps out of the way
// (both seen live 2026-11-13, docs/engine-changes.md section 2):
//   - Forge keeps the planes in play in the list of the player who planeswalked (Player.currentPlanes, which IS
//     Game.activePlanes). When the plane's owner leaves, Game.onPlayerLost's 901.10 loop removes the plane from the
//     planar controller's list while iterating Game.activePlanes: a ConcurrentModificationException, and the game
//     aborts, if that list is the planar controller's own. In a real game the list holder walked from their own deck,
//     so it is the leaver's list; here the op's player must not be the planar controller of the case.
//   - The harness hands priority to the op's player (applyState's lastPlayer -> PhaseHandler.setPriority, which sets
//     pFirstPriority too). If that player then leaves, "everyone passed" (pFirstPriority == nextPlayer) never comes
//     again: the priority goes round for ever (the runaway cap ends the game as a draw). So it isn't the leaver either.
//   Case A (H's turn): the op's player is another AI; case B (an AI's turn): H.
// --raw sets both cases up in the trap shapes instead (case A: H walks; case B: the AI that will leave walks) and
// expects the op to give the plane to the active player at once: an engine with the planechase-fix-1113 changes
// (Forge's 901.10 loop on a copy, planar ops leaving priority where it was, the op walking as the owner and then
// giving control to the active player) passes it; engine1113 aborts or loops.
// The op also leaves the plane under its owner's control (Player.planeswalkTo sets none; 901.6's move to the active
// player comes at the next turn), so the controller checks skip a turn with a debug planeswalk in it.
// Needs a fresh test stack: tools/live-check.sh exile tests/live_planechase_check.js (exile = engine1113, which holds the
// harness; LIVE_TIMEOUT=600, as the AIs play whole turns).
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", AIS = 3;
const VERBOSE = process.argv.includes("--verbose"), RAW = process.argv.includes("--raw");

const card = (name, types = []) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types, subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const COMMANDER = "Rograkh, Son of Rohgahh";
// planes with no "when you planeswalk to" trigger, so a probe planeswalk asks nothing (Forge's scripts, read 2026-11-13)
const PLANES = ["Krosa", "Llanowar", "The Great Forest", "Naya", "Turri Island", "Murasa", "Feeding Grounds", "Tazeem",
  "Velis Vel", "The Hippodrome", "Glen Elendra", "Bant"];
const deckOf = (label, planes) => ({ deckName: label, deck: { name: label, cards: Array.from({ length: 99 }, () => card("Mountain")), sideboard: [], format: "commander",
  commanders: [card(COMMANDER)], ...(planes ? { planes: planes.map((n) => card(n, ["Plane"])) } : {}) }, commanderName: COMMANDER });
const DECK = deckOf("planechase-check", PLANES), AI_DECK = deckOf("planechase-check-ai", null);

const results = [];
const check = (ok, what) => { results.push({ ok: !!ok, what }); process.stdout.write(`${ok ? "pass" : "FAIL"}: ${what}\n`); return !!ok; };
const note = (what) => process.stdout.write(`note: ${what}\n`);
let finished = false, started = false, botsAsked = false;
const finish = (why) => {
  if (finished) return;
  finished = true;
  if (why) process.stdout.write(`stopped: ${why}\n`);
  note(`plane owners learned: ${JSON.stringify(S.owner)}`);
  note(`rolls seen: ${JSON.stringify(S.rollsSeen)}`);
  const bad = results.filter((r) => !r.ok).length;
  process.stdout.write(`${bad || why ? "FAILED" : "PASSED"}: ${results.length - bad} of ${results.length} checks${why ? ", did not finish" : ""}\n`);
  process.exit(bad || why ? 1 : 0);
};
setTimeout(() => finish(`timed out in state ${S.state}`), Number(arg("timeout", 600)) * 1000);

const cname = (c) => c?.identity?.name || "";
const allCards = (g) => (g.zones || []).flatMap((z) => (z.cards || []).map((c) => ({ ...c, zone: z.zone })));
const nameOfId = (g, id) => cname(allCards(g).find((c) => c.id === id)) || null;
const planeIds = (g) => (g.planar?.planeIds || []).map(String);
const planeName = (g) => nameOfId(g, planeIds(g)[0]);
const counts = (g) => ({ ...(g.planar?.deckCounts || {}) });
const outs = (g) => (g.players || []).filter((p) => p.status && p.status !== "playing").map((p) => p.id);
const alive = (g, slot) => !outs(g).includes(slot);
// the planar die's action, as the bridge finds it (planarActions)
const isRoll = (g, a) => a.type === "activateAbility" && (nameOfId(g, a.cardId) === "Planar Dice" || /\broll the planar dic?e\b/i.test(String(a.description || a.label || "")));
const costOf = (s) => String(s ?? "").replace(/[{}\s]/g, "");

// S.state: setup -> mana -> roll -> probe -> caseA -> caseA-kill -> toB -> caseB-walk -> caseB-kill -> end
const S = { state: "setup", H: null, AI: [], fixId: 1300, owner: {}, track: null, rolls: 0, pay: {}, rollSeq: null, rollsSeen: [],
  offTiming: [], ctlWrong: [], opTurns: new Set(), rollCounts: new Set(), before: null, target: null, victim: null, payTries: 0 };
let client = null;

class Client {
  constructor() {
    this.name = `tts-planechase-${Math.random().toString(36).slice(2, 6)}`;
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
        // (as the bridge asks for Forge AIs: onRoomUpdate, one spawnBot with every bot's deck)
        const decks = Array.from({ length: AIS }, () => AI_DECK);
        this.send({ type: "BroadcastState", state: { kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId: `tts-${Date.now()}`, roomId: this.roomId,
          payload: { type: "spawnBot", deck: decks[0], decks, forgeAi: true } } });
      }
      const ready = msg.room.players.filter((p) => p.ready && p.connected).length;
      if (!started && msg.room.status === "Lobby" && ready >= 1 + AIS) { started = true; this.send({ type: "StartGame", format: "Commander" }); }
    } else if (msg.type === "GameStarted") {
      this.slot = `player-${msg.player_order.indexOf(this.name)}`;
      S.H = this.slot;
      S.AI = msg.player_order.map((u, i) => (u === this.name ? null : `player-${i}`)).filter(Boolean);
      process.stdout.write(`H ${S.H}, AIs ${S.AI.join(" ")} (${msg.player_order.join(", ")})\n`);
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
    if (VERBOSE) process.stdout.write(`t${g.turn} ${g.step} active ${g.activePlayerId}: ${type} ${JSON.stringify(input.presentation || p.title || "").slice(0, 160)} (${S.state})\n`);
    switch (type) {
      case "gameOver": return finish("the game ended");
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g, input);
      case "payManaCost": {
        if (S.state === "roll" && S.pay[S.rolls] === undefined) S.pay[S.rolls] = input.manaCost ?? "";
        if (input.canConfirmFromPool) return this.respond(p, type, { type: "pay", auto: false });
        S.payTries++;
        if (S.payTries === 1) return this.respond(p, type, { type: "pay", auto: true });
        const tap = (input.actions || []).find((a) => a.type !== "undoMana");
        if (tap && S.payTries < 12) return this.respond(p, type, { type: "act", actionId: tap.id });
        return finish(`couldn't pay ${input.manaCost} for ${input.cardName}`);
      }
      case "chooseBoardTargets": return this.respond(p, type, { type: "boardTargets", chosen: input.candidates.slice(0, input.minTargets).map(({ kind, id }) => ({ kind, id })) });
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: false });
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

// Every board H gets: a change of plane, and whose decks grew and shrank (see the top). A board with a player newly out
// is a 901.10 one (the leaver's plane leaves the game, not to a deck), checked by the cases themselves.
function observe(g) {
  if (!g.planar) return;
  const id = planeIds(g)[0] || null, c = counts(g), out = outs(g);
  const r = g.planar.lastRoll;
  if (r && !S.rollsSeen.some((x) => x.seq === r.seq)) S.rollsSeen.push({ seq: r.seq, by: r.playerId, result: r.result, turn: g.turn });
  if (!S.track) { S.track = { id, counts: c, out }; return; }
  if (id && id !== S.track.id && out.length === S.track.out.length) {
    const d = Object.keys(c).map((k) => [k, c[k] - (S.track.counts[k] ?? c[k])]);
    const plus = d.filter(([, v]) => v === 1), minus = d.filter(([, v]) => v === -1), other = d.filter(([, v]) => v && Math.abs(v) !== 1);
    const name = nameOfId(g, id), oldName = nameOfId(g, S.track.id) || S.track.name;
    if (!other.length && plus.length === 1 && minus.length === 1) {
      S.owner[name] = minus[0][0];
      if (oldName) S.owner[oldName] ??= plus[0][0];
    } else if (!other.length && !plus.length && !minus.length && oldName && S.owner[oldName]) S.owner[name] = S.owner[oldName];
  }
  S.track = { id, name: nameOfId(g, id) || (id === S.track.id ? S.track.name : null), counts: c, out };
}

function fix(c, ops, next) {
  S.fixId++;
  if (!RAW && ops.some((o) => o.op === "planeswalk")) S.opTurns.add(c.g.turn);
  S.state = next;
  c.directive({ type: "applyState", fixId: S.fixId, ops });
}
function applied(g, pass) {
  if (g.stateFix?.fixId !== S.fixId) { pass(); return false; }
  if (!g.stateFix.ok && g.stateFix.applied !== true) { finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`); return false; }
  return true;
}
// a plane of `slot`'s that isn't in play (so still in their planar deck)
const planeOf = (g, slot) => PLANES.find((n) => S.owner[n] === slot && n !== planeName(g)) || null;

function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), mine = g.activePlayerId === S.H, empty = !(g.stack || []).length;
  const rolls = (input.actions || []).filter((a) => isRoll(g, a));
  // standing checks, at every priority question H gets
  if (rolls.length && !(mine && main && empty)) S.offTiming.push(`t${g.turn} ${g.step} active ${g.activePlayerId} stack ${(g.stack || []).length}`);
  if (g.planar && g.planar.controllerId !== g.activePlayerId && !S.opTurns.has(g.turn)) S.ctlWrong.push(`t${g.turn} ${g.step}: ${g.planar.controllerId} for ${g.activePlayerId}`);
  if (mine && main && empty && !Number(g.planar?.dieRollsThisTurn)) S.rollCounts.add(rolls.length); // (the free roll: a later one may be unaffordable)

  if (S.state === "setup") {
    if (!(mine && main && empty)) return pass();
    const n = counts(g);
    check(planeIds(g).length === 1, `one plane in play at the start (${planeIds(g).map((id) => nameOfId(g, id)).join(", ")})`);
    check([S.H, ...S.AI].every((s) => n[s] > 0), `every player has a planar deck, the AIs with none brought dealt some (${JSON.stringify(n)})`);
    const total = Object.values(n).reduce((a, b) => a + b, 0);
    check(total === PLANES.length - 1, `the 12 planes are all dealt: ${total} in decks and 1 in play`);
    // the first plane came from the starting player's deck: theirs is the one short
    const low = Math.min(...Object.values(n)), short = Object.keys(n).filter((k) => n[k] === low);
    if (check(short.length === 1, `one planar deck is one short, the first plane's owner (${short.join(", ")})`)) S.owner[planeName(g)] = short[0];
    S.track = { id: planeIds(g)[0], name: planeName(g), counts: n, out: outs(g) };
    return fix(c, Array.from({ length: 4 }, () => ({ op: "createCard", name: "Mountain", player: S.H, zone: "battlefield" })), "mana");
  }
  if (c.slot !== S.H) return pass();
  if (S.state === "mana") {
    if (!applied(g, pass)) return;
    S.state = "roll";
  }
  if (S.state === "roll") {
    if (!empty) return pass(); // a chaos trigger: let it resolve
    if (!(mine && main)) return finish(`H's main phase ended before its three rolls (${g.step})`);
    if (S.rolls > 0) {
      const r = g.planar?.lastRoll;
      check(r && r.seq !== S.rollSeq && r.playerId === S.H && /^(planeswalk|chaos|blank)$/.test(String(r.result)), `roll ${S.rolls}: recorded for H (${JSON.stringify(r)})`);
      const want = S.rolls - 1, paid = S.pay[S.rolls];
      check(want === 0 ? paid === undefined || costOf(paid) === "0" || costOf(paid) === "" : costOf(paid) === String(want),
        `roll ${S.rolls} costs {${want}} (${paid === undefined ? "no payment asked" : `asked to pay ${paid}`})`);
    }
    if (S.rolls === 3) {
      check(Number(g.planar?.dieRollsThisTurn) === 3, `three rolls taken this turn (${g.planar?.dieRollsThisTurn})`);
      S.state = "probe";
    } else {
      check(Number(g.planar?.dieRollsThisTurn) === S.rolls, `before roll ${S.rolls + 1} the die says ${S.rolls} taken (${g.planar?.dieRollsThisTurn})`);
      if (!check(rolls.length > 0, `roll ${S.rolls + 1} is offered in H's main phase with an empty stack (${rolls.length} roll actions)`)) return finish("no roll offered");
      S.rollSeq = g.planar?.lastRoll?.seq ?? null;
      S.rolls++;
      S.payTries = 0;
      return c.respond(p, "chooseAction", { type: "act", actionId: rolls[0].id });
    }
  }
  if (S.state === "probing") {
    if (!applied(g, pass)) return;
    check(planeName(g) === S.target, `the debug op planeswalked to ${S.target} (${planeName(g)}, owner ${S.owner[S.target] || "unknown"})`);
    S.state = "probe";
  }
  if (S.state === "probe") {
    if (!(mine && main && empty)) return mine && main ? pass() : finish(`H's turn ended before the owners were learned (${JSON.stringify(S.owner)})`);
    const next = PLANES.find((n) => !S.owner[n] && n !== planeName(g));
    if (next && !S.AI.every((s) => planeOf(g, s))) { S.target = next; return fix(c, [{ op: "planeswalk", player: S.H, name: next }], "probing"); }
    if (!check(S.AI.every((s) => planeOf(g, s)), `a plane of every AI's is known (${JSON.stringify(S.owner)})`)) return finish("owners unknown");
    S.victim = S.AI[0];
    S.target = planeOf(g, S.victim);
    return fix(c, [{ op: "planeswalk", player: RAW ? S.H : S.AI[1], name: S.target }], "caseA");
  }
  if (S.state === "caseA") {
    if (!applied(g, pass)) return;
    check(planeName(g) === S.target, `case A: ${S.target} (${S.victim}'s) in play on H's turn (${planeName(g)})`);
    if (RAW) check(g.planar.controllerId === S.H, `case A set-up: the op gave ${S.target} to H, the active player (${g.planar.controllerId})`);
    else note(`case A set-up: the op left ${S.target} with ${g.planar.controllerId}'s control (901.6 would say H)`);
    S.before = { counts: counts(g), id: planeIds(g)[0] };
    return fix(c, [{ op: "life", player: S.victim, n: 0 }], "caseA-kill");
  }
  if (S.state === "caseA-kill") {
    if (!applied(g, pass)) return;
    S.state = "wait";
    return setTimeout(() => {
      const h = c.g, n = counts(h);
      check(!alive(h, S.victim), `case A: ${S.victim} is out of the game (${outs(h).join(", ")})`);
      check(!planeIds(h).includes(S.before.id) && planeIds(h).length === 1, `case A, 901.10: ${S.target} left the game with its owner; one plane in play (${planeIds(h).map((id) => nameOfId(h, id)).join(", ")})`);
      check(n[S.H] === S.before.counts[S.H] - 1, `case A: H, the planar controller, planeswalked from H's own deck (${S.before.counts[S.H]} -> ${n[S.H]})`);
      check(h.planar.controllerId === S.H, `case A: the new plane is H's to control (${h.planar.controllerId})`);
      if (planeName(h)) S.owner[planeName(h)] = S.H;
      S.track = { id: planeIds(h)[0], name: planeName(h), counts: n, out: outs(h) };
      S.state = "toB";
      pass();
    }, 1500);
  }
  if (S.state === "toB") {
    const j = g.activePlayerId;
    if (mine || !empty || !alive(g, j) || !S.AI.includes(j)) return pass();
    const m = S.AI.find((s) => s !== j && alive(g, s) && (S.owner[planeName(g)] === s || planeOf(g, s)));
    if (!m) return finish(`case B: no living AI but ${j} with a known plane (${JSON.stringify(S.owner)})`);
    S.victim = m;
    S.target = S.owner[planeName(g)] === m ? planeName(g) : planeOf(g, m);
    S.walker = j;
    if (planeName(g) === S.target) { S.state = "caseB-walk"; S.fixId++; g = { ...g, stateFix: { fixId: S.fixId, ok: true } }; }
    else return fix(c, [{ op: "planeswalk", player: RAW ? m : S.H, name: S.target }], "caseB-walk");
  }
  if (S.state === "caseB-walk") {
    if (!applied(g, pass)) return;
    if (g.activePlayerId !== S.walker) return finish(`case B: ${S.walker}'s turn ended during the set-up`);
    check(planeName(g) === S.target, `case B: ${S.target} (${S.victim}'s) in play on ${S.walker}'s turn (${planeName(g)})`);
    if (RAW) check(g.planar.controllerId === S.walker, `case B set-up: ${S.target} is ${S.walker}'s, the active player's, to control (${g.planar.controllerId})`);
    else note(`case B set-up: ${S.target} under ${g.planar.controllerId}'s control (901.6 would say ${S.walker})`);
    S.before = { counts: counts(g), id: planeIds(g)[0] };
    return fix(c, [{ op: "life", player: S.victim, n: 0 }], "caseB-kill");
  }
  if (S.state === "caseB-kill") {
    if (!applied(g, pass)) return;
    S.state = "wait";
    return setTimeout(() => {
      const h = c.g, n = counts(h);
      check(!alive(h, S.victim), `case B: ${S.victim} is out of the game (${outs(h).join(", ")})`);
      check(!planeIds(h).includes(S.before.id) && planeIds(h).length === 1, `case B, 901.10: ${S.target} left the game with its owner; one plane in play (${planeIds(h).map((id) => nameOfId(h, id)).join(", ")})`);
      check(n[S.walker] === S.before.counts[S.walker] - 1, `case B: ${S.walker}, the active player, planeswalked from the deck it was dealt (${S.before.counts[S.walker]} -> ${n[S.walker]})`);
      check(n[S.H] === S.before.counts[S.H], `case B: H's planar deck is untouched (${S.before.counts[S.H]} -> ${n[S.H]})`);
      check(h.planar.controllerId === S.walker, `case B: the new plane is ${S.walker}'s to control (${h.planar.controllerId})`);
      S.state = "end";
      pass();
    }, 1500);
  }
  if (S.state === "end") {
    // the game goes on after both (another priority question reached H)
    note(`the game went on after both 901.10 cases (t${g.turn} ${g.step})`);
    check(!S.offTiming.length, `no roll offered outside H's own main phase with an empty stack (${S.offTiming.slice(0, 4).join("; ") || "none"})`);
    check(!S.ctlWrong.length, `the planes were always the active player's to control (${S.ctlWrong.slice(0, 4).join("; ") || "always"})`);
    check(S.rollCounts.size > 0 && ![...S.rollCounts].includes(0), `in H's main phase with an empty stack and no roll yet, the die was always offered (roll actions offered: ${[...S.rollCounts].join(", ")})`);
    const aiRolls = S.rollsSeen.filter((r) => r.by !== S.H);
    note(`AI rolls seen: ${aiRolls.length ? aiRolls.map((r) => `${r.by} t${r.turn} ${r.result}`).join(", ") : "none"}`);
    S.state = "done";
    return finish();
  }
  if (S.state === "wait") return;
  return pass();
}

client = new Client();
