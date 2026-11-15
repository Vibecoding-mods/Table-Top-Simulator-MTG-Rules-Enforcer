// Dungeons and the initiative against the real engine, headless, no TTS: one human seat H and three passive Forge AIs
// (docs/planechase-dungeon-engine-spec.md §2.4, the fields the table's dungeon card reads: dungeonState {name, room,
// cardId, rooms}, completedDungeons, initiativeHolderId). Expected results come from the printed dungeons and the rules:
//   Lost Mine of Phandelver: Cave Entrance (Scry 1) -> Goblin Lair or Mine Tunnels; Goblin Lair -> Storeroom or Dark
//   Pool; Mine Tunnels (Create a Treasure token) -> Dark Pool or Fungi Cavern; Storeroom, Dark Pool, Fungi Cavern ->
//   Temple of Dumathoin (Draw a card), the last room. Completing it (CR 309.7) takes the dungeon out of the game.
//   Undercity: Secret Entrance -> Forge or Lost Well; Lost Well (Scry 2) -> Arena or Stash.
//   CR 725: taking the initiative ventures into Undercity; the holder ventures into Undercity at their upkeep; combat
//   damage to the holder takes it (and ventures again).
// The ventures are Veteran Dungeoneer ("When Veteran Dungeoneer enters, venture into the dungeon"), made by a fix op in
// hand with its mana in the pool, and cast; the initiative is Seasoned Dungeoneer's ("When Seasoned Dungeoneer enters,
// you take the initiative"). Each room question is answered by the room's name, not its place, and the room the state
// then names must be that one.
// --save <file> writes the boards' real dungeonState / completedDungeons / initiativeHolderId (for goldens).
// Needs a fresh test stack: LIVE_TIMEOUT=600 bash tools/live-check.sh <tag> tests/live_dungeon_check.js
const fs = require("fs");
const delta = require("../bridge/state-delta");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg("relay", "ws://127.0.0.1:9444"), ROOM = arg("room", "tts-test"), KEY = "tts-local", AIS = 3;
const VERBOSE = process.argv.includes("--verbose"), SAVE = arg("save", null);

const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", power: "", toughness: "" });
const COMMANDER = "Rograkh, Son of Rohgahh";
const deckOf = (label) => ({ deckName: label, deck: { name: label, cards: Array.from({ length: 99 }, () => card("Mountain")), sideboard: [], format: "commander",
  commanders: [card(COMMANDER)] }, commanderName: COMMANDER });
const DECK = deckOf("dungeon-check"), AI_DECK = deckOf("dungeon-check-ai");
const LOST = "Lost Mine of Phandelver", UNDER = "Undercity";
const LOST_ROOMS = { "Cave Entrance": ["Goblin Lair", "Mine Tunnels"], "Goblin Lair": ["Storeroom", "Dark Pool"], "Mine Tunnels": ["Dark Pool", "Fungi Cavern"],
  Storeroom: ["Temple of Dumathoin"], "Dark Pool": ["Temple of Dumathoin"], "Fungi Cavern": ["Temple of Dumathoin"], "Temple of Dumathoin": [] };

const results = [], saved = [];
const check = (ok, what) => { results.push({ ok: !!ok, what }); process.stdout.write(`${ok ? "pass" : "FAIL"}: ${what}\n`); return !!ok; };
const note = (what) => process.stdout.write(`note: ${what}\n`);
let finished = false, started = false, botsAsked = false;
const finish = (why) => {
  if (finished) return;
  finished = true;
  if (why) process.stdout.write(`stopped: ${why}\n`);
  note(`room questions: ${JSON.stringify(S.asked)}`);
  if (SAVE) fs.writeFileSync(SAVE, JSON.stringify(saved, null, 1));
  const bad = results.filter((r) => !r.ok).length;
  process.stdout.write(`${bad || why ? "FAILED" : "PASSED"}: ${results.length - bad} of ${results.length} checks${why ? ", did not finish" : ""}\n`);
  process.exit(bad || why ? 1 : 0);
};
setTimeout(() => finish(`timed out in state ${S.state}`), Number(arg("timeout", 600)) * 1000);

const cname = (c) => c?.identity?.name || "";
const zoneCards = (g, zone, owner) => (g.zones || []).filter((z) => z.zone === zone && (!owner || z.ownerId === owner)).flatMap((z) => z.cards || []);
const me = (g) => (g.players || []).find((p) => p.id === S.H) || {};
const ds = (g) => me(g).dungeonState || null;
const room = (g) => (ds(g)?.name ? ds(g).room || "" : null);
const roomOf = (g, name) => (ds(g)?.rooms || []).find((r) => r.name === name) || null;
const done = (g) => me(g).completedDungeons || [];
const keep = (what, g) => saved.push({ what, turn: g.turn, step: g.step, dungeonState: ds(g), completedDungeons: me(g).completedDungeons ?? null, initiativeHolderId: g.initiativeHolderId ?? null,
  command: zoneCards(g, "command", S.H).map((c) => ({ id: c.id, name: cname(c), types: c.types, text: c.text })) });
const sameList = (a, b) => JSON.stringify([...(a || [])].map(String)) === JSON.stringify([...(b || [])].map(String));

// S.state: setup -> v1 .. v4 (Veteran Dungeoneer each) -> init (Seasoned Dungeoneer) -> upkeep -> steal -> attack -> end
// S.want: the room to answer the next room question with
const S = { state: "setup", H: null, AI: [], fixId: 400, asked: [], want: null, cast: null, castTries: 0, turn0: null, pre: null, payTries: 0 };

class Client {
  constructor() {
    this.name = `tts-dungeon-${Math.random().toString(36).slice(2, 6)}`;
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
      const r = msg.rooms.find((x) => x.room_name === ROOM);
      if (!r) return finish(`room ${ROOM} not found`);
      this.roomId = r.room_id;
      this.send({ type: "JoinRoom", room_id: this.roomId, observe: false, as_bot: false });
    } else if (msg.type === "RoomUpdate" && msg.room.room_id === this.roomId) {
      if (!this.joined && msg.room.players.some((p) => p.username === this.name)) {
        this.joined = true;
        this.send({ type: "SetDeckSelection", deck_name: DECK.deckName, deck: DECK.deck, commander_name: DECK.commanderName });
        this.send({ type: "SetReady", ready: true });
      }
      if (this.joined && !botsAsked) {
        botsAsked = true;
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
      process.stdout.write(`H ${S.H}, AIs ${S.AI.join(" ")}\n`);
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
    } else if (env.kind === "prompt") {
      if (this.board) this.answer(env.prompt);
      else this.pending = env.prompt;
    } else if (env.kind === "fatal") finish(`engine fatal: ${env.message}`);
    else if (env.kind === "error") finish(`engine error: ${JSON.stringify(env.error)}`);
    if (this.board && this.pending) { const p = this.pending; this.pending = null; this.answer(p); }
  }
  answer(p) {
    const g = this.g, input = p.input || {}, type = p.kind === "priority" ? "chooseAction" : input.type;
    if (VERBOSE) process.stdout.write(`t${g.turn} ${g.step} active ${g.activePlayerId}: ${type} ${JSON.stringify(input.presentation || p.title || "").slice(0, 200)} (${S.state})\n`);
    switch (type) {
      case "gameOver": return finish("the game ended");
      case "diceRolled": return this.respond(p, type, { type: "diceRolledAcknowledged" });
      case "mulligan": return this.respond(p, type, { type: "mulliganDecision", keep: true });
      case "chooseAction": return priority(this, p, g, input);
      case "payManaCost": {
        if (input.canConfirmFromPool) return this.respond(p, type, { type: "pay", auto: false });
        S.payTries++;
        if (S.payTries === 1) return this.respond(p, type, { type: "pay", auto: true });
        return finish(`couldn't pay ${input.manaCost} for ${input.cardName}`);
      }
      case "chooseFromSelection": return choose(this, p, g, input);
      case "chooseBoardTargets": return this.respond(p, type, { type: "boardTargets", chosen: input.candidates.slice(0, Math.max(input.minTargets, 0)).map(({ kind, id }) => ({ kind, id })) });
      case "chooseBoolean": return this.respond(p, type, { type: "decision", value: false });
      // (a library search, Secret Entrance's basic land: take one, or Forge asks "Cancel Search?" again and again)
      case "chooseCards": return this.respond(p, type, { type: "chooseCardsDecision", chosenCardIds: (input.cards || []).slice(0, Math.max(input.min || 0, /library/i.test(String(input.presentation?.description || "")) ? 1 : 0)).map((c) => c.id) });
      case "chooseAttackers": {
        const att = S.state === "attack" ? (input.attackers || []).find((a) => a.attackerId === S.attacker && (a.validTargetIds || []).includes(S.victim)) : null;
        if (S.state === "attack") note(`attackers offered: ${JSON.stringify((input.attackers || []).map((a) => a.attackerId))}; Seasoned Dungeoneer ${S.attacker}`);
        return this.respond(p, type, { type: "declareAttackers", assignments: att ? [{ attackerId: att.attackerId, targetId: S.victim }] : [] });
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

// The dungeon question ("Name a card": the dungeons) and the room questions ("<Room> — <effect>" labels).
function choose(c, p, g, input) {
  const labels = (input.options || []).map((o) => String(o.label ?? ""));
  const title = String(input.presentation?.title || "");
  S.asked.push({ turn: g.turn, state: S.state, title, labels, in: room(g) });
  const pick = (re) => { const i = labels.findIndex((l) => re.test(l)); return c.respond(p, "chooseFromSelection", { type: "selectionDecision", chosenIndices: [i >= 0 ? i : 0] }); };
  if (labels.length === 1 && labels[0] === UNDER) {
    check(S.state === "init" || S.state === "upkeep" || S.state === "attack", `only the initiative's venture asks with Undercity alone (${S.state})`);
    return pick(/./);
  }
  if (labels.some((l) => l === LOST)) {
    check(labels.includes(LOST) && labels.includes("Tomb of Annihilation") && labels.includes("Dungeon of the Mad Mage") && !labels.includes(UNDER),
      `the first venture asks which dungeon: the three, not Undercity (${labels.join(", ")})`);
    return pick(new RegExp(`^${LOST}$`));
  }
  const names = labels.map((l) => l.split(" — ")[0].trim());
  const here = room(g), from = here ? roomOf(g, here) : null;
  if (from) check(sameList(names, from.next), `the room question in ${here} lists the state's next rooms (${names.join(", ")} vs ${(from.next || []).join(", ")})`);
  if (S.want && names.includes(S.want)) return pick(new RegExp(`^${S.want.replace(/[!?.]/g, "\\$&")}\\b`));
  note(`room question not planned for: ${JSON.stringify(labels)}`);
  return pick(/./);
}

function fix(c, ops, next) {
  S.fixId++;
  S.state = next;
  c.directive({ type: "applyState", fixId: S.fixId, ops });
}
function applied(g, pass) {
  if (g.stateFix?.fixId !== S.fixId) { pass(); return false; }
  if (!g.stateFix.ok && g.stateFix.applied !== true) { finish(`set-up refused: ${JSON.stringify(g.stateFix).slice(0, 300)}`); return false; }
  return true;
}
const castFix = (name) => [{ op: "mana", player: S.H, mana: "W W W W W" }, { op: "createCard", name, player: S.H, zone: "hand" }];
// cast `name` from hand (once), then wait for an empty stack; true while still busy
function castAndSettle(c, p, g, input, name) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  if (!S.cast) {
    const a = (input.actions || []).find((x) => x.type === "cast" && String(x.label || x.description || "").includes(name));
    if (!a) { if (++S.castTries > 3) finish(`no cast of ${name} offered (${JSON.stringify((input.actions || []).map((x) => x.label)).slice(0, 300)})`); else pass(); return true; }
    S.cast = { name, turn: g.turn };
    S.payTries = 0;
    c.respond(p, "chooseAction", { type: "act", actionId: a.id });
    return true;
  }
  if ((g.stack || []).length) { pass(); return true; }
  if (!zoneCards(g, "battlefield", S.H).some((x) => cname(x) === name)) { pass(); return true; }
  S.cast = null;
  S.castTries = 0;
  return false;
}

const LOST_STEPS = [
  { state: "v1", want: null, room: "Cave Entrance" },
  { state: "v2", want: "Mine Tunnels", room: "Mine Tunnels" },
  { state: "v3", want: "Fungi Cavern", room: "Fungi Cavern" },
  { state: "v4", want: null, room: null },
];

function priority(c, p, g, input) {
  const pass = () => c.respond(p, "chooseAction", { type: "pass" });
  const main = /main/i.test(g.step || ""), mine = g.activePlayerId === S.H, empty = !(g.stack || []).length;
  if (c.slot !== S.H) return pass();
  if (S.state === "setup") {
    if (!(mine && main && empty)) return pass();
    S.turn0 = g.turn;
    check(!ds(g)?.name && !done(g).length, `no dungeon at the start (${JSON.stringify(ds(g))}, completed ${JSON.stringify(done(g))})`);
    S.step = 0;
    S.want = LOST_STEPS[0].want;
    return fix(c, castFix("Veteran Dungeoneer"), "v");
  }
  if (S.state === "v") {
    if (!S.cast && !applied(g, pass)) return;
    const st = LOST_STEPS[S.step];
    if (!mine) return finish(`H's turn ended during ${st.state}`);
    if (castAndSettle(c, p, g, input, "Veteran Dungeoneer")) return;
    keep(st.state, g);
    if (st.room) {
      const d = ds(g), cmd = zoneCards(g, "command", S.H).find((x) => cname(x) === LOST);
      check(d?.name === LOST && d.room === st.room, `${st.state}: H is in ${LOST}, ${st.room} (${JSON.stringify({ name: d?.name, room: d?.room })})`);
      if (S.step === 0) {
        check(cmd && d?.cardId === cmd.id && (cmd.types || []).includes("Dungeon"), `the dungeon card is in H's command zone with the state's cardId (${cmd?.id} ${JSON.stringify(cmd?.types)} vs ${d?.cardId})`);
        const got = Object.fromEntries((d?.rooms || []).map((r) => [r.name, r.next || []]));
        check(JSON.stringify(Object.keys(got).sort()) === JSON.stringify(Object.keys(LOST_ROOMS).sort()), `the state lists the dungeon's seven rooms (${Object.keys(got).join(", ")})`);
        check(Object.keys(LOST_ROOMS).every((k) => sameList(got[k], LOST_ROOMS[k])), `each room leads where the printed dungeon says (${JSON.stringify(got)})`);
        check(/scry 1/i.test(roomOf(g, "Cave Entrance")?.text || "") && /treasure/i.test(roomOf(g, "Mine Tunnels")?.text || "") && /draw a card/i.test(roomOf(g, "Temple of Dumathoin")?.text || ""),
          `the rooms carry their effects (${JSON.stringify((d?.rooms || []).map((r) => `${r.name}: ${r.text}`))})`);
      }
      if (st.room === "Mine Tunnels") {
        const bf = zoneCards(g, "battlefield").filter((x) => x.controllerId === S.H || x.ownerId === S.H);
        check(bf.some((x) => /^Treasure/.test(cname(x))), `Mine Tunnels made H a Treasure (H's permanents: ${bf.map(cname).join(", ")})`);
      }
    } else {
      check(!ds(g)?.name, `v4: Temple of Dumathoin is the last room: the dungeon is completed and gone (${JSON.stringify(ds(g))})`);
      check(sameList(done(g), [LOST]), `completedDungeons names it (${JSON.stringify(done(g))})`);
      check(!zoneCards(g, "command", S.H).some((x) => cname(x) === LOST), "the dungeon card has left H's command zone");
      const bad = S.asked.filter((a) => a.state === "v" && a.in === "Fungi Cavern");
      check(!bad.length, `no room question from Fungi Cavern, it leads to one room only (${JSON.stringify(bad)})`);
    }
    S.step++;
    if (S.step < LOST_STEPS.length) { S.want = LOST_STEPS[S.step].want; return fix(c, castFix("Veteran Dungeoneer"), "v"); }
    S.want = null;
    return fix(c, castFix("Seasoned Dungeoneer"), "init");
  }
  if (S.state === "init") {
    if (!S.cast && !applied(g, pass)) return;
    if (!mine) return finish("H's turn ended before Seasoned Dungeoneer resolved");
    if (castAndSettle(c, p, g, input, "Seasoned Dungeoneer")) return;
    keep("initiative", g);
    note(`Seasoned Dungeoneer's text: ${JSON.stringify(zoneCards(g, "battlefield", S.H).find((x) => cname(x) === "Seasoned Dungeoneer")?.text)}`);
    check(g.initiativeHolderId === S.H, `Seasoned Dungeoneer: H takes the initiative (${g.initiativeHolderId})`);
    check(ds(g)?.name === UNDER && room(g) === "Secret Entrance", `taking the initiative ventures into Undercity, Secret Entrance (${JSON.stringify({ name: ds(g)?.name, room: room(g) })})`);
    check(sameList(roomOf(g, "Secret Entrance")?.next, ["Forge", "Lost Well"]), `Secret Entrance leads to Forge or Lost Well (${JSON.stringify(roomOf(g, "Secret Entrance")?.next)})`);
    check(sameList(done(g), [LOST]), `the completed list keeps ${LOST} (${JSON.stringify(done(g))})`);
    S.want = "Lost Well";
    S.state = "upkeep";
    return pass();
  }
  if (S.state === "upkeep") {
    if (!(mine && main && empty) || g.turn === S.turn0) return pass();
    keep("upkeep", g);
    check(room(g) === "Lost Well", `the holder's upkeep ventures into Undercity: H is in Lost Well, the room picked (${room(g)})`);
    check(S.asked.some((a) => a.state === "upkeep" && a.in === "Secret Entrance"), "the upkeep venture asked H which room");
    S.victim = S.AI.find((s) => (g.players || []).find((x) => x.id === s)?.status === "playing") || S.AI[0];
    return fix(c, [{ op: "initiative", player: S.victim }], "steal");
  }
  if (S.state === "steal") {
    if (!applied(g, pass)) return;
    check(g.initiativeHolderId === S.victim, `the debug op gives ${S.victim} the initiative (${g.initiativeHolderId})`);
    check(room(g) === "Lost Well", `H stays in Lost Well when it loses the initiative (${room(g)})`);
    S.attacker = zoneCards(g, "battlefield", S.H).find((x) => cname(x) === "Seasoned Dungeoneer")?.id;
    S.want = "Stash";
    S.state = "attack";
    return pass();
  }
  if (S.state === "attack") {
    if (!mine) return finish("H's turn ended before the attack's damage");
    if (!/end|second|main2|postcombat/i.test(g.step || "") || !empty) return pass();
    keep("steal", g);
    check(g.initiativeHolderId === S.H, `combat damage to ${S.victim} takes the initiative back (${g.initiativeHolderId})`);
    check(room(g) === "Stash", `taking it ventures again: Lost Well -> Stash, the room picked (${room(g)})`);
    S.state = "end";
    return finish();
  }
  return pass();
}

new Client();
