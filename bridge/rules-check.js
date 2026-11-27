// Commander rules checklist (PLAN.md M0.5), played headless against Forge through the relay, no TTS involved.
//   node rules-check.js --game tax     1v1 vs a passive AI: Rograkh (free commander) + burn aimed at it.
//       Checks: the commander-zone replacement is offered when it dies / is put into the library, the commander
//       ends up in the command zone, and commander tax goes up by {2} per earlier cast.
//   node rules-check.js --game exile   same, with exile spells (Swords, Path, Journey, O-Ring): the choice is offered
//       when the commander would be exiled.   --game library: Oust, Excommunicate, Unexpectedly Absent (library).
//   node rules-check.js --game keywords  Aftermath (Cut, then Ribbons from the graveyard), Fuse (Turn // Burn fused),
//       Enrage (Apex Altisaur fights), Fight (Bridgeworks Battle), Spree (Return the Favor copying our own spell).
//   node rules-check.js --game fix  manual fix (M7, our Forge build): at turn 4, in our main phase with an empty stack,
//       the question is held and an applyState list is sent (life, poison, a hand card onto the battlefield, a
//       permanent into the graveyard, counters, tapped); then a list with a missing card, which must be refused and
//       leave the board as it was.  --game exile also records the exile links our Forge build sends.
//   node rules-check.js --game sac  a sacrifice that pays for mana (Ashnod's Altar, Phyrexian Tower) can be cancelled:
//       while paying for a spell, the Altar is used; its "choose a creature to sacrifice" offers Cancel, which goes back
//       to paying with the creature still there (our Forge build, 2026-10-23).
//   node rules-check.js --game costcancel  any other cost can be cancelled (our Forge build, 2026-10-23): Fling's
//       "sacrifice a creature" and Tormenting Voice's "discard a card" offer Cancel; after Cancel the spell is back in
//       hand, the creature still on the battlefield, nothing discarded and the lands untapped again.
//   node rules-check.js --game eminence  Edgar Markov stays in the command zone (never cast); each Vampire spell cast must
//       make a 1/1 Vampire token (eminence works from the command zone).
//   node rules-check.js --game filter  Skycloud Expanse ({1},{T}: Add {W}{U}) with Islands: with 3 untapped lands
//       (one of them Skycloud) Rhystic Study ({2}{U}) can be paid, so it must be offered, and auto-pay must pay it
//       (playtest 2026-10-24: Red held Rhystic Study with Cliffs, Skycloud and Reef and was never offered it).
//   node rules-check.js --game dungeon  rewind during a dungeon (docs/planechase-dungeon-engine-spec.md §2.4, D3): Veteran
//       Dungeoneers are made in hand by manual fix and cast to venture into Lost Mine of Phandelver; three rewinds read
//       dungeonState (and Cloister Gargoyle's +3/+0, which shows a completed dungeon) before and after: a venture after
//       the restore point (the room must go back), a first venture after it (the dungeon must go), a completion after
//       it (the dungeon must come back in its room and leave the completed list); a fourth goes back to applyState's own
//       restore point after a completion before it and a new dungeon after it (the completion must stay, the dungeon
//       go). Then, in the same turn, the opponent gets Keen-Eared Sentry (one venture a turn): the venture undone by
//       the rewind must not count, so the next one enters Cave Entrance and the one after it is stopped.
//   node rules-check.js --game cmddmg  4 players vs 3 passive AIs: Kogla (7/6) + ramp hits one player three times.
//       Checks: 21 commander damage from one commander knocks a player out (with life still above 0),
//       turn order skips the eliminated player, priority passes in seat order around the table.
// Needs the stack from ../stack/compose.yml running and the TTS bridge idle (it shares the room).
const fs = require("fs");
const path = require("path");
const delta = require("./state-delta");

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const GAME = arg("game", "tax");
const RELAY = arg("relay", "ws://127.0.0.1:9443");
const KEY = arg("key", "tts-local");
const ROOM = arg("room", "tts-commander");
const MINUTES = Number(arg("minutes", 25));
const SEATS = GAME === "cmddmg" ? 4 : 2;
// tax / exile / library: one free-ish commander and removal aimed at it; the deck decides where it goes
const DECK_ID = { dungeon: "test_rules_dungeon", audit: "test_rules_audit", filter2: "test_rules_filter2", filter: "test_rules_filter", eminence: "test_rules_eminence", costcancel: "test_rules_costcancel", sac: "test_rules_sac", fix: "test_rules_tax", rewind: "test_rules_tax", concede: "test_rules_tax", cmddmg: "test_rules_cmddmg", exile: "test_rules_exile", library: "test_rules_library", keywords: "test_rules_keywords" }[GAME] || "test_rules_tax";
const TAXLIKE = GAME !== "dungeon" && GAME !== "audit" && GAME !== "cmddmg" && GAME !== "keywords" && GAME !== "sac" && GAME !== "costcancel" && GAME !== "eminence" && GAME !== "filter" && GAME !== "filter2";
// keywords: situational cards the table-driven games didn't get to (see `kwPlan`): what each needs is set up here
const KW_TARGETS = { Aftermath: /Ribbons/, Fuse: /Turn.*Burn|Burn.*Turn|fuse/i, Enrage: /Apex Altisaur/, Fight: /Bridgeworks Battle/, Spree: /Return the Favor/ };
// KW_ONLY=Fuse,Spree: check only these (the tutors then fetch them first)
for (const k of Object.keys(KW_TARGETS)) if (process.env.KW_ONLY && !process.env.KW_ONLY.split(",").includes(k)) delete KW_TARGETS[k];
const BOT_DECK = process.env.RC_BOT || "ai_passive_rograkh";
const { presetFile } = require("./presets");
const USERNAME = `tts-rules-${Math.random().toString(36).slice(2, 7)}`;
const OUT = path.join(__dirname, "..", "tmp", `rules-check-${GAME}.json`);

function loadPreset(id) {
  const p = JSON.parse(fs.readFileSync(presetFile(id), "utf8"));
  const toCard = (e) => ({ identity: { name: e.name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [],
    supertypes: [], colorIdentity: [], text: "", uris: {} });
  const cards = [];
  let commander = null;
  for (const e of p.cards) {
    if (p.commander && e.name === p.commander && !commander) { commander = toCard(e); continue; }
    for (let k = 0; k < (e.count || 1); k++) cards.push(toCard(e));
  }
  const deck = { name: p.label, cards, sideboard: [], format: "commander" };
  if (commander) deck.commanders = [commander];
  return { deckName: p.label, deck, commanderName: p.commander || null };
}
const COMMANDER = loadPreset(DECK_ID).commanderName;

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

// ── what we observe ──
const obs = {
  game: GAME, order: [], replacementPrompts: [], commanderCasts: [], commanderMoves: [], payPrompts: [],
  turns: [], priority: [], eliminations: [], errors: [], notes: [],
};
let slot = null, board = null, finished = false, lastAct = null;
const failed = new Set();
const picked = new Map(); // "turn:actionId" -> times chosen: an action the engine keeps undoing (no legal target) is
// dropped for the turn after 3 tries, instead of being picked again forever
let payTries = { card: null, n: 0 };
let victim = null;        // cmddmg: the player Kogla keeps hitting
let lastCmdZone = null, lastTurnKey = null, lastPrioKey = null;

const ws = new WebSocket(RELAY);
const send = (m) => ws.send(JSON.stringify(m));
const broadcast = (state) => send({ type: "BroadcastState", state });
let roomId = null, joined = false, started = false;

ws.addEventListener("open", () => send({ type: "Authenticate", username: USERNAME, password: KEY, service: false, client_platform: "unknown", engine_gate: "unknown", client_version: "3.56.0" }));
ws.addEventListener("close", () => { if (!finished) { log("relay closed"); finish(); } });
ws.addEventListener("message", (ev) => {
  const raw = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8");
  const msg = JSON.parse(raw);
  if (msg.type === "AuthResult") { if (!msg.success) { log("auth failed", msg.error); return finish(); } send({ type: "ListRooms" }); }
  else if (msg.type === "RoomList" && !roomId) {
    const room = msg.rooms.find((r) => r.room_name === ROOM);
    if (!room) { log(`room ${ROOM} not found`); return finish(); }
    roomId = room.room_id;
    send({ type: "JoinRoom", room_id: roomId, observe: false, as_bot: false });
  } else if (msg.type === "RoomUpdate" && msg.room.room_id === roomId) {
    const room = msg.room;
    if (room.players.some((p) => p.username === USERNAME) && !joined) {
      joined = true;
      const mine = loadPreset(DECK_ID);
      send({ type: "SetDeckSelection", deck_name: mine.deckName, deck: mine.deck, commander_name: mine.commanderName });
      send({ type: "SetReady", ready: true });
      const bots = Array.from({ length: SEATS - 1 }, () => loadPreset(BOT_DECK));
      broadcast({ kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId: `rules-${Date.now()}`, roomId,
        payload: { type: "spawnBot", deck: bots[0], decks: bots, forgeAi: true } });
    }
    const ready = room.players.filter((p) => p.ready && p.connected).length;
    if (joined && !started && room.status === "Lobby" && ready >= SEATS) { started = true; send({ type: "StartGame", format: "Commander" }); }
  } else if (msg.type === "GameStarted") {
    slot = `player-${msg.player_order.indexOf(USERNAME)}`;
    obs.order = msg.player_order.map((_, i) => `player-${i}`);
    log(`game ${GAME} started, we are ${slot}, ${SEATS} seats`);
  } else if (msg.type === "StateUpdate") onEnvelope(msg.state);
  else if (msg.type === "Error") log("relay error", msg.code, msg.message);
  else if (msg.type === "GameAborted") { log("game aborted"); finish(); }
});

function onEnvelope(env) {
  if (!env || !slot) return;
  const forUs = env.forPlayer === slot;
  if (env.kind === "state" && forUs) { board = { state: env.state, fp: env.fingerprint }; onBoard(); }
  else if (env.kind === "stateDelta" && forUs) {
    if (!board || board.fp !== env.base) { send({ type: "RequestResync" }); return; }
    board = { state: delta.apply(board.state, env.patch), fp: env.fingerprint };
    onBoard();
  } else if (env.kind === "prompt" && forUs) {
    // RC_STALE=1: does a priority question arrive while our board still shows a stack? (main-phase skip, 2026-10-26)
    if (process.env.RC_STALE && env.prompt?.input?.type === "chooseAction") log(`prompt in ${gv().step} active=${gv().activePlayerId === slot} stack=${(gv().stack || []).length} ${(gv().stack || []).map((x) => x.identity?.name).join(",")}`);
    answer(env.prompt);
  }
  else if (env.kind === "error" && forUs) { obs.errors.push(JSON.stringify(env.error).slice(0, 300)); if (lastAct) failed.add(lastAct); }
  else if (env.kind === "fatal") { obs.errors.push(`fatal: ${env.message}`); finish(); }
}

const gv = () => board?.state?.gameView || {};
const zones = () => gv().zones || [];
function findCard(pred) {
  for (const z of zones()) for (const c of z.cards || []) if (pred(c, z)) return { card: c, zone: z };
  return null;
}
const myCommander = () => findCard((c, z) => z.ownerId === slot && c.identity?.name === COMMANDER)
  || (gv().stack || []).find((s) => s.identity?.name === COMMANDER && s.controllerId === slot) && { zone: { zone: "stack" } };
const playerOf = (id) => (gv().players || []).find((p) => p.id === id);

function onBoard() {
  const g = gv();
  // where our commander is, each time it moves
  const cm = myCommander();
  const where = cm ? cm.zone.zone : "?";
  if (where !== lastCmdZone) { obs.commanderMoves.push({ turn: g.turn, from: lastCmdZone, to: where }); lastCmdZone = where; }
  // turn order and statuses
  const tk = `${g.turn}`;
  if (tk !== lastTurnKey && g.activePlayerId) {
    lastTurnKey = tk;
    obs.turns.push({ turn: g.turn, active: g.activePlayerId, statuses: Object.fromEntries((g.players || []).map((p) => [p.id, p.status])) });
    log(`turn ${g.turn}: ${g.activePlayerId}` + (process.env.RC_CHECKPOINTS ? ` checkpoints=${(g.checkpoints || []).length} rec=${g.snapshotRecording} last=${JSON.stringify((g.checkpoints || []).slice(-2))} vote=${JSON.stringify(g.restoreVote)}` : ""));
  }
  if (GAME === "rewind") rewindStep(g);
  if (GAME === "fix") fixSeen(g);
  if (GAME === "audit") auditSeen(g);
  if (GAME === "dungeon") dgSeen(g);
  // exile links (our Forge build): every card seen with exiledWith / mayPlay / isForetold
  for (const z of g.zones || []) for (const c of z.cards || []) {
    if ((c.exiledWith || c.mayPlay || c.isForetold) && !obs.exileLinks.some((e) => e.id === c.id && e.zone === z.zone)) {
      obs.exileLinks.push({ id: c.id, name: c.identity?.name, zone: z.zone, owner: z.ownerId, exiledWith: c.exiledWith || null,
        returns: !!c.returnsWhenHostLeaves, mayPlay: !!c.mayPlay, foretold: !!c.isForetold, turn: g.turn });
      log(`exile link: ${JSON.stringify(obs.exileLinks.at(-1))}`);
    }
  }
  // concede (Treachery's way out, PLAN M4.6): at turn 4 our seat concedes; the engine must mark it and end the game
  if (GAME === "concede" && !obs.conceded && g.turn >= 4) {
    obs.conceded = { turn: g.turn };
    broadcast({ kind: "directive", fromPlayer: slot, directive: { type: "concede" } });
    log("concede sent");
  }
  if (GAME === "concede" && obs.conceded) obs.afterConcede = { status: playerOf(slot)?.status, gameOver: !!g.gameOver, winner: g.winnerId ?? null, turn: g.turn };
  // priority holder changes within a step
  const pk = `${g.turn}|${g.step}|${(g.stack || []).length}|${g.priorityPlayerId}`;
  if (pk !== lastPrioKey && g.priorityPlayerId) {
    lastPrioKey = pk;
    obs.priority.push({ turn: g.turn, step: g.step, stack: (g.stack || []).map((s) => s.id).join(","), holder: g.priorityPlayerId, active: g.activePlayerId,
      alive: (g.players || []).filter((p) => p.status !== "lost" && p.status !== "conceded").map((p) => p.id) });
  }
  // eliminations, with life and commander damage at that moment
  for (const p of g.players || []) {
    if (p.status && p.status !== "playing" && !obs.eliminations.some((e) => e.player === p.id)) {
      obs.eliminations.push({ player: p.id, status: p.status, turn: g.turn, life: p.life, commanderDamage: p.commanderDamage || {} });
      log(`${p.id} is out (${p.status}) at life ${p.life}, commander damage ${JSON.stringify(p.commanderDamage || {})}`);
    }
  }
  if (g.gameOver) finish();
}

function respond(prompt, type, output) {
  broadcast({ kind: "response", fromPlayer: slot, promptId: prompt.promptId ?? 0, action: { type, output } });
}

let dbg = 0;
function answer(prompt) {
  if (GAME === "rewind" && obs.rewind?.holding) { obs.rewind.held = (obs.rewind.held || 0) + 1; return; }
  if (GAME === "fix" && fixAsk(prompt)) return;
  if (GAME === "audit" && auditFix(prompt)) return;
  if (GAME === "dungeon" && dgAnswer(prompt)) return;
  if (process.env.RC_DEBUG && dbg++ < Number(process.env.RC_DEBUG)) log("prompt", prompt.kind, prompt.input?.type, JSON.stringify((prompt.input?.actions || []).map((a) => a.label)).slice(0, 200), "cmd:", JSON.stringify(myCommander()?.zone?.zone));
  if (prompt.kind === "priority") return respond(prompt, "chooseAction", { type: "pass" });
  const input = prompt.input || {};
  const type = input.type;
  const g = gv();
  const cm = myCommander();
  switch (type) {
    case "mulligan": return respond(prompt, type, { type: "mulliganDecision", keep: true });
    case "mulliganPutBack": return respond(prompt, type, { type: "mulliganPutBackDecision", cardIds: input.handCardIds.slice(0, input.count) });
    case "chooseAction": {
      const acts = (input.actions || []).filter((a) => !failed.has(`${g.turn}:${a.id}`) && a.type !== "undoMana" && !a.isManaAbility);
      const cmdId = cm?.card?.id;
      // keywords: never play the land face of Bridgeworks Battle (it is the Fight card)
      let land = acts.find((a) => /^play /i.test(a.label || "") && !(GAME === "keywords" && /Bridgeworks/.test(a.label || "")));
      if (GAME === "filter2") {
        const have = new Set((g.zones || []).filter((z) => z.zone === "battlefield" && z.ownerId === slot).flatMap((z) => z.cards || []).map((c) => c.identity?.name));
        land = ["Swiftwater Cliffs", "Skycloud Expanse", "Shivan Reef"].filter((n) => !have.has(n)).map((n) => acts.find((a) => (a.label || "") === `Play ${n}`)).find(Boolean) || null;
      }
      const castCmd = acts.find((a) => a.type === "cast" && a.cardId === cmdId && cm.zone.zone === "command");
      let pick = land || (GAME === "eminence" || GAME === "filter" || GAME === "filter2" ? null : castCmd);
      if (!pick && (GAME === "filter" || GAME === "filter2") && g.activePlayerId === slot && /main/i.test(g.step || "") && !(g.stack || []).length) {
        const mine = (g.zones || []).filter((z) => z.zone === "battlefield" && z.ownerId === slot).flatMap((z) => z.cards || []);
        const untapped = mine.filter((c) => (c.types || []).includes("Land") && !c.tapped).map((c) => c.identity?.name);
        const SPELL = GAME === "filter2" ? /^Gale, Waterdeep Prodigy/ : /^Rhystic Study/;
        const inHand = (g.zones || []).some((z) => z.zone === "hand" && z.ownerId === slot && (z.cards || []).some((c) => SPELL.test(c.identity?.name || "")));
        const cast = acts.find((a) => a.type === "cast" && SPELL.test(String(a.label || "").replace(/^Cast /, "")));
        const sky = untapped.filter((n) => n === "Skycloud Expanse").length;
        const isl = untapped.length - sky;
        // the mana those lands make: each Island 1, each Skycloud turns 1 into 2; a Skycloud needs 1 from somewhere
        const mana = isl > 0 ? isl + Math.min(sky, isl + sky - 1) : 0;
        const key = `${g.turn}`;
        if (inHand && sky > 0 && !obs.flt.seen[key]) {
          obs.flt.seen[key] = true;
          obs.flt.checks.push({ turn: g.turn, untapped, mana, offered: !!cast });
          log(`filter: turn ${g.turn} lands ${untapped.join(", ")} (${mana} mana): Rhystic Study ${cast ? "offered" : "NOT offered"}`);
        }
        const exact = GAME !== "filter2" || (untapped.length === 3 && ["Swiftwater Cliffs", "Skycloud Expanse", "Shivan Reef"].every((n) => untapped.includes(n)));
        if (cast && mana >= 3 && exact && !obs.flt.casting) { pick = cast; obs.flt.casting = { turn: g.turn, untapped }; }
      }
      if (!pick && GAME === "eminence") {
        pick = acts.find((a) => a.type === "cast" && a.cardId !== cmdId);
        if (pick) obs.em.casts.push({ turn: g.turn, card: pick.label, commanderAt: cm?.zone.zone, tokensBefore: emTokens() });
      }
      // tax: aim burn at our own commander whenever it's on the battlefield (a spell that fails to pay is skipped
      // for the rest of the turn through `failed`)
      if (!pick && TAXLIKE && cm?.zone.zone === "battlefield") pick = acts.find((a) => a.type === "cast" && a.cardId !== cmdId);
      if (!pick && GAME === "cmddmg") pick = acts.find((a) => a.type === "cast" && a.cardId !== cmdId);
      if (!pick && GAME === "keywords") pick = kwPlan(acts, g);
      if (!pick && GAME === "audit") pick = auditPick(acts, g);
      if (!pick && GAME === "sac") pick = acts.find((a) => a.type === "cast");
      if (GAME === "costcancel") {
        ccCheck();
        const step = obs.cc.find((c) => !c.cancelled && !c.gaveUp);
        if (!pick && step && cm?.zone.zone === "battlefield") {
          pick = acts.find((a) => a.type === "cast" && new RegExp(step.card).test(a.label || ""));
          if (pick) { step.before = ccState(step.card); step.casting = true; log(`costcancel: casting ${step.card}: ${JSON.stringify(step.before)}`); }
        }
        if (!step) setTimeout(finish, 1000);
      }
      if (pick) {
        lastAct = `${g.turn}:${pick.id}`;
        picked.set(lastAct, (picked.get(lastAct) || 0) + 1);
        if (picked.get(lastAct) >= 3) { failed.add(lastAct); obs.notes.push(`gave up on ${pick.label} (turn ${g.turn}): undone 3 times`); }
        if (pick === castCmd) obs.commanderCasts.push({ turn: g.turn, castsBefore: playerOf(slot)?.commanderCasts || {} });
        return respond(prompt, type, { type: "act", actionId: pick.id });
      }
      return respond(prompt, type, { type: "pass" });
    }
    case "payManaCost": {
      if (GAME === "sac") {
        if (obs.sac.cancelled && !obs.sac.next) {
          obs.sac.next = { type: "payManaCost", card: input.cardName, commanderAt: cm?.zone.zone };
          log(`sac: back to paying for ${input.cardName}; the commander is on the ${cm?.zone.zone}`);
          setTimeout(finish, 4000);
        }
        const sacAct = !obs.sac.tried && cm?.zone.zone === "battlefield" && (input.actions || []).find((a) => /Ashnod's Altar|Phyrexian Tower/.test(`${a.description || ""} ${a.label || ""}`));
        if (sacAct) {
          obs.sac.tried = { turn: g.turn, card: input.cardName, act: sacAct.description || sacAct.label || sacAct.id };
          log(`sac: paying for ${input.cardName} with ${obs.sac.tried.act}`);
          return respond(prompt, type, { type: "act", actionId: sacAct.id });
        }
      }
      // auto-pay fills the pool, then the engine asks to confirm (the bridge does the same for players)
      if (input.canConfirmFromPool) return respond(prompt, type, { type: "pay", auto: false });
      if (payTries.card !== input.cardId) {
        payTries = { card: input.cardId, n: 0 };
        obs.payPrompts.push({ turn: g.turn, card: input.cardName, isCommander: input.cardId === cm?.card?.id, cost: input.manaCost ?? null });
      }
      payTries.n++;
      if (payTries.n === 1) return respond(prompt, type, { type: "pay", auto: true });
      const tap = (input.actions || []).find((a) => a.type !== "undoMana");
      if (tap && payTries.n < 12) return respond(prompt, type, { type: "act", actionId: tap.id });
      if (lastAct) failed.add(lastAct);
      obs.notes.push(`couldn't pay ${input.manaCost} for ${input.cardName}`);
      return respond(prompt, type, { type: "cancel" });
    }
    case "chooseBoardTargets": {
      if (GAME === "costcancel" && input.intent === "sacrifice") {
        const step = obs.cc.find((c) => c.casting && !c.cancelled);
        if (step && ccCancel(step, prompt, type, input)) return;
      }
      if (GAME === "sac" && obs.sac.tried && !obs.sac.cancelled) {
        obs.sac.prompt = { title: input.presentation?.title, intent: input.intent, cancellable: !!input.cancellable, commanderAt: cm?.zone.zone };
        log(`sac: ${JSON.stringify(obs.sac.prompt)}`);
        if (input.cancellable) { obs.sac.cancelled = true; return respond(prompt, type, { type: "cancel" }); }
      }
      let chosen;
      if (TAXLIKE) {
        const mine = input.candidates.find((c) => c.id === cm?.card?.id);
        chosen = mine ? [mine] : input.candidates.slice(0, Math.max(1, input.minTargets));
      } else {
        chosen = input.minTargets === 0 ? [] : input.candidates.slice(0, input.minTargets);
      }
      return respond(prompt, type, { type: "boardTargets", chosen: chosen.map(({ kind, id }) => ({ kind, id })) });
    }
    case "chooseBoolean":
      if (/commander/i.test(`${input.presentation?.title || ""} ${prompt.sourceAbilityText || ""}`)) {
        obs.replacementPrompts.push({ turn: g.turn, title: input.presentation?.title, commanderAt: cm?.zone.zone });
      }
      return respond(prompt, type, { type: "decision", value: true });
    case "chooseCards": {
      if (GAME === "costcancel") {
        const step = obs.cc.find((c) => c.casting && !c.cancelled);
        if (step && ccCancel(step, prompt, type, input)) return;
      }
      // keywords: a tutor's search takes a target card first
      // (the targets not cast yet first)
      const kwLeft = Object.values(KW_TARGETS).filter((re) => !obs.kwCasts.some((c) => re.test(`${c.label} ${JSON.stringify(c.mode || {})}`)));
      const hit = (c) => kwLeft.some((re) => re.test(c.identity?.name || ""));
      const want = GAME === "keywords" ? input.cards.filter((c) => /Cut|Turn|Apex Altisaur|Bridgeworks|Return the Favor/.test(c.identity?.name || ""))
        .sort((a, b) => hit(b) - hit(a)) : [];
      const k = Math.max(input.min || 0, want.length || GAME === "keywords" ? Math.min(1, input.max || 1) : 0);
      const chosen = [...want, ...input.cards.filter((c) => !want.includes(c))].slice(0, k);
      if (GAME === "keywords") obs.kwFetched.push({ turn: g.turn, title: input.presentation?.title || "", names: chosen.map((c) => c.identity?.name) });
      const ids = chosen.map((c) => c.id);
      return respond(prompt, type, { type: "chooseCardsDecision", chosenCardIds: ids });
    }
    case "chooseNumber": return respond(prompt, type, { type: "numberDecision", chosenNumber: input.min });
    case "chooseFromSelection": {
      if (GAME === "dungeon") {
        // Forge's dungeon question is its "Name a card" option prompt (chooseSingleCardFace); the room question lists rooms
        const labels = (input.options || []).map((o) => o.label ?? JSON.stringify(o));
        obs.dg.prompts.push({ turn: g.turn, title: input.presentation?.title || "", source: prompt.sourceAbilityText || "", options: labels });
        log(`dungeon: asked "${input.presentation?.title}" ${JSON.stringify(labels)}`);
        // (Dark Pool over Storeroom: Storeroom's +1/+1 counter could land on Cloister Gargoyle and blur the +3/+0 reading)
        const lm = labels.findIndex((l) => /^(Lost Mine of Phandelver|Dark Pool)/.test(l));
        if (lm >= 0) return respond(prompt, type, { type: "selectionDecision", chosenIndices: [lm] });
      }
      const k = Math.min(Math.max(input.minTotal, 1), input.maxTotal, input.options.length);
      return respond(prompt, type, { type: "selectionDecision", chosenIndices: [...Array(k).keys()] });
    }
    case "chooseAttackers": {
      const kogla = input.attackers.find((a) => a.attackerId === cm?.card?.id);
      if (GAME !== "cmddmg" || !kogla) return respond(prompt, type, { type: "declareAttackers", assignments: [] });
      const alive = (g.players || []).filter((p) => p.id !== slot && p.status === "playing").map((p) => p.id);
      if (!victim || !alive.includes(victim)) victim = alive.find((id) => kogla.validTargetIds.includes(id)) || null;
      if (!victim) return respond(prompt, type, { type: "declareAttackers", assignments: [] });
      return respond(prompt, type, { type: "declareAttackers", assignments: [{ attackerId: kogla.attackerId, targetId: victim }] });
    }
    case "chooseBlockers": return respond(prompt, type, { type: "declareBlockers", assignments: [] });
    case "chooseDamageAssignmentOrder": return respond(prompt, type, { type: "damageAssignmentOrderDecision", orderedBlockerIds: input.blockerIds });
    case "chooseCombatDamageAssignment": {
      const to = input.blockerIds[0] || input.defenderId;
      return respond(prompt, type, { type: "combatDamageAssignmentDecision", assignments: [{ assigneeId: to, damage: input.totalDamage }] });
    }
    case "reorder": return respond(prompt, type, { type: "reorderDecision", orderedIds: input.items.map((i) => i.id) });
    case "scry": {
      const top = Math.max(0, input.zones.indexOf("libraryTop"));
      return respond(prompt, type, { type: "scryDecision", zoneCardIds: input.zones.map((_, i) => (i === top ? input.cards.map((c) => c.id) : [])) });
    }
    case "chooseColor": return respond(prompt, type, { type: "colorDecision", chosenColors: { [input.validColors[0]]: input.amount } });
    case "revealCards": return respond(prompt, type, { type: "revealCardsAcknowledged" });
    case "diceRolled": return respond(prompt, type, { type: "diceRolledAcknowledged" });
    case "gameOver": return finish();
    default: obs.notes.push(`unhandled prompt ${type}`);
  }
}

// keywords: what to cast now. Return the Favor only while our own spell is on the stack (it copies it); Turn // Burn
// only fused (it waits in hand until the engine offers that); Ribbons (from the graveyard, after Cut) as soon as it is offered; then ramp,
// tutors and creatures so the rest can be found and paid for (never Gamble: its random discard can throw the target away).
obs.kwCasts = [];
obs.kwOffers = [];
obs.kwFetched = [];
function kwPlan(acts, g) {
  const casts = acts.filter((a) => a.type === "cast" || a.type === "activateAbility");
  // Return the Favor copies an instant or sorcery: ours on the stack means Shock or Opt
  const ourSpellOnStack = (g.stack || []).some((x) => x.controllerId === slot && /Shock|Opt/.test(JSON.stringify(x)));
  const by = (re) => casts.find((a) => re.test(`${a.label || ""} ${a.description || ""} ${JSON.stringify(a.mode || {})}`));
  // what the engine offers for the split card, once per turn (how a fused cast is labelled)
  const tb = acts.filter((a) => /Turn|Burn/.test(`${a.label || ""} ${a.description || ""}`));
  const tbKey = tb.map((a) => a.label).join("|");
  if (tb.length && obs.kwOffers.at(-1)?.key !== tbKey) obs.kwOffers.push({ turn: g.turn, key: tbKey, mana: (playerOf(slot)?.battlefield || []).length, offers: tb.map((a) => ({ type: a.type, label: a.label, description: a.description, mode: a.mode })) });
  let pick = ourSpellOnStack ? by(/Return the Favor/) : null;
  if (!pick && !(g.stack || []).length) {
    pick = by(/fuse/i) || by(/Ribbons/) || by(/Cut\b/) || by(/Apex Altisaur/) || by(/Bridgeworks Battle/)
      || by(/Tutor|Imperial Seal/) || casts.find((a) => a.type === "cast" && !/Return the Favor|Shock|Opt|Gamble|Cast (Turn|Burn)$|Tanglespan/.test(a.label || ""));
    // something on the stack for Return the Favor to copy: a cheap spell of ours when it's in hand
    if (!pick && casts.some((a) => /Return the Favor/.test(a.label || ""))) pick = by(/Shock|Opt/);
  }
  if (pick) obs.kwCasts.push({ turn: g.turn, label: pick.label || pick.description, mode: pick.mode || null });
  return pick;
}

// rewind: at turn 8 ask the engine to go back to the upkeep of turn 6 (one human seat, so no vote is needed: it
// applies at once), then check that the game really is back there: same turn, step, life, commander casts, zones.
obs.rewind = { fingerprints: {}, requested: null, back: null };
function fingerprint(g) {
  return JSON.stringify({ players: (g.players || []).map((p) => [p.id, p.life, p.commanderCasts]),
    // which cards, not just how many (hidden ones count by number: the library's order isn't visible to us)
    zones: (g.zones || []).map((z) => [z.ownerId ?? z.owner, z.zone ?? z.kind, z.count ?? null, (z.cards || []).map((c) => c.id ?? null).sort()]) });
}
// draws (new cards in our hand, by turn) before and after the rewind, and duplicates: a card id in two zones, or more
// copies of a name than the deck has (playtest 2026-10-25: "rewind sometimes duplicates a card or changes the draw order")
function rewindDraws(g) {
  const R = obs.rewind;
  const hand = (g.zones || []).filter((z) => z.zone === "hand" && z.ownerId === slot).flatMap((z) => z.cards || []);
  const now = new Set(hand.map((c) => c.id));
  const key = R.back ? "after" : "before";
  R.draws = R.draws || { before: {}, after: {} };
  // (a card that was in the hand before and came back, a cast that could not be paid, is not a draw)
  R.ever = R.ever || { before: new Set(), after: new Set() };
  for (const c of hand) if (R.lastHand && !R.lastHand.has(c.id) && !R.ever[key].has(c.id)) ((R.draws[key][g.turn] = R.draws[key][g.turn] || []).push(c.identity?.name || c.id));
  for (const c of hand) R.ever[key].add(c.id);
  R.lastHand = now;
  const seen = new Map();
  const names = {};
  for (const z of g.zones || []) for (const c of z.cards || []) {
    if (z.ownerId !== slot && c.ownerId !== slot) continue;
    if (seen.has(c.id) && seen.get(c.id) !== z.zone) (R.dupes = R.dupes || []).push(`${c.identity?.name} in ${seen.get(c.id)} and ${z.zone} (turn ${g.turn})`);
    seen.set(c.id, z.zone);
    if (!c.identity?.isToken) names[c.identity?.name] = (names[c.identity?.name] || 0) + 1;
  }
  const deck = JSON.parse(fs.readFileSync(presetFile(DECK_ID), "utf8")).cards;
  for (const [n, k] of Object.entries(names)) {
    const allowed = deck.filter((e) => e.name === n).reduce((a, e) => a + (e.count || 1), 0);
    if (n && n !== "undefined" && k > allowed) (R.dupes = R.dupes || []).push(`${k} ${n} seen, the deck has ${allowed} (turn ${g.turn})`);
  }
}
function rewindStep(g) {
  const R = obs.rewind;
  rewindDraws(g);
  if (R.back && R.lastHand && !R.handReset) { R.handReset = true; for (const c of (g.zones || []).filter((z) => z.zone === "hand" && z.ownerId === slot).flatMap((z) => z.cards || [])) R.ever.after.add(c.id); R.lastHand = new Set((g.zones || []).filter((z) => z.zone === "hand" && z.ownerId === slot).flatMap((z) => z.cards || []).map((c) => c.id)); }
  const at = `${g.turn}|${g.step}`;
  if (!R.requested && !R.fingerprints[at]) R.fingerprints[at] = fingerprint(g); // first state seen at each step
  if (!R.requested && g.turn >= 8) {
    const cp = (g.checkpoints || []).find((c) => c.turn === 6 && c.step === "upkeep");
    R.requested = { atTurn: g.turn, checkpoint: cp || null, available: (g.checkpoints || []).map((c) => `${c.turn}/${c.step}`), lastId: (g.checkpoints || []).at(-1)?.checkpointId ?? null };
    if (cp) broadcast({ kind: "directive", fromPlayer: slot, directive: { type: "requestRestore", checkpointId: cp.checkpointId } });
    // answer nothing until the rewound board is seen: an answer to a question from before the restore crashed Forge
    // ("unsupported action kind: choose_action" while it waited for a target)
    if (cp) R.holding = true;
    log(`rewind: asked for ${JSON.stringify(cp)}`);
  } else if (R.requested && !R.back && g.turn < R.requested.atTurn) {
    R.holding = false;
    R.back = { turn: g.turn, step: g.step, same: fingerprint(g) === R.fingerprints[at], vote: g.restoreVote, fp: fingerprint(g), was: R.fingerprints[at] };
    const ids = (g.checkpoints || []).map((c) => c.checkpointId);
    R.back.checkpoints = { n: ids.length, first: ids[0] ?? null, last: ids.at(-1) ?? null, before: R.requested.lastId };
    log(`rewind: back at turn ${g.turn} ${g.step}, state ${R.back.same ? "matches" : "differs"}; checkpoints now ${JSON.stringify(R.back.checkpoints)}`);
  }
  if (R.back && g.turn >= R.requested.atTurn + 2) finish();
}

// manual fix (M7): the first of our main-phase questions at turn 4+ with an empty stack is held (not answered) and
// the change list goes to the engine; its answer comes back as gameView.stateFix, then the engine asks again
obs.exileLinks = [];
obs.fix = { sent: [], results: [], before: null, after: null, badBefore: null, badAfter: null };
const zoneCards = (g, kind, owner) => (g.zones || []).find((z) => z.zone === kind && z.ownerId === owner)?.cards || [];
function fixSnapshot(g) {
  const opp = (g.players || []).find((p) => p.id !== slot);
  const me = playerOf(slot);
  const where = {};
  for (const z of g.zones || []) for (const c of z.cards || []) where[c.id] = { zone: z.zone, tapped: !!c.isTapped || !!c.tapped, counters: c.counters || null };
  return { cmdDamage: me?.commanderDamage || {}, treasures: zoneCards(g, "battlefield", slot).filter((c) => /Treasure/.test(c.identity?.name || "")).length,
    library: (g.zones || []).find((z) => z.zone === "library" && z.ownerId === slot)?.count ?? null, life: me?.life, colorless: (me?.manaPool || {}).C || 0, poison: opp?.poison ?? opp?.counters?.poison ?? (opp?.playerCounters || {}).poison ?? null, opp: opp, where };
}
function fixAsk(prompt) {
  const g = gv();
  const F = obs.fix;
  if (prompt.input?.type !== "chooseAction" || (g.stack || []).length) return false;
  if (!F.plan && g.turn >= 4 && g.activePlayerId === slot && /main/i.test(g.step || "")) {
    // (a permanent: Forge leaves an instant or sorcery where it is, and the fix is then refused)
    const hand = zoneCards(g, "hand", slot).filter((c) => c.identity?.name !== COMMANDER && (c.types || []).some((ty) => /Land|Creature|Artifact|Enchantment|Planeswalker|Battle/i.test(ty)));
    const field = zoneCards(g, "battlefield", slot).filter((c) => c.identity?.name !== COMMANDER);
    const opp = (g.players || []).find((p) => p.id !== slot);
    if (!hand.length || field.length < 2) return false;
    const toBottom = zoneCards(g, "hand", slot).find((c) => c.id !== hand[0].id && c.identity?.name !== COMMANDER);
    const oppCommander = Object.keys(opp.commanderCasts || {})[0] || null;
    F.plan = { toField: hand[0].id, toGrave: field[0].id, countered: field[1].id, opp: opp.id, toBottom: toBottom?.id || null, oppCommander,
      treasures: zoneCards(g, "battlefield", slot).filter((c) => /Treasure/.test(c.identity?.name || "")).length,
      library: (g.zones || []).find((z) => z.zone === "library" && z.ownerId === slot)?.count ?? null };
    F.before = fixSnapshot(g);
    const ops = [
      { op: "life", player: slot, n: 31 }, { op: "poison", player: opp.id, n: 3 },
      { op: "move", card: hand[0].id, zone: "battlefield" }, { op: "move", card: field[0].id, zone: "graveyard" },
      { op: "counters", card: field[1].id, kind: "P1P1", n: 2 }, { op: "tap", card: field[1].id, tapped: true },
      { op: "createToken", script: "c_a_treasure_sac", player: slot },
      // (2026-10-26) mana that stays until spent: seven colourless, checked again in a later step
      { op: "mana", player: slot, mana: "C C C C C C C" },
      ...(toBottom ? [{ op: "move", card: toBottom.id, zone: "library", position: "bottom" }] : []),
      ...(oppCommander ? [{ op: "commanderDamage", player: slot, from: oppCommander, n: 4 }] : []),
    ];
    F.sent.push({ fixId: 101, ops });
    broadcast({ kind: "directive", fromPlayer: slot, directive: { type: "applyState", fixId: 101, ops } });
    log(`fix: sent ${JSON.stringify(ops)}`);
    F.holding = 101;
    return true;
  }
  if (F.holding) return true; // (held until the engine's answer is seen)
  if (F.plan && !F.badSent && F.results.some((r) => r.fixId === 101)) {
    F.badBefore = fixSnapshot(g);
    // an instant onto the battlefield when we hold one (Forge leaves it in the hand: the list must be refused), else a
    // card that doesn't exist
    const spell = zoneCards(g, "hand", slot).find((c) => (c.types || []).some((ty) => /Instant|Sorcery/i.test(ty)));
    F.badKind = spell ? `${spell.identity?.name} onto the battlefield` : "a missing card";
    const ops = [{ op: "life", player: slot, n: 5 }, spell ? { op: "move", card: spell.id, zone: "battlefield" } : { op: "tap", card: "engine-card-999999", tapped: true }];
    F.sent.push({ fixId: 102, ops });
    F.badSent = true;
    F.holding = 102;
    broadcast({ kind: "directive", fromPlayer: slot, directive: { type: "applyState", fixId: 102, ops } });
    log(`fix: sent a list with ${F.badKind}`);
    return true;
  }
  return false;
}
// audit: the Forge scripts fixed by docs/reviews/forge-remembered-audit.md, each used at least twice. Every main phase of
// ours: mana by manual fix, and audited cards in the graveyard or exile back to hand, so spells are really cast again.
const AUDIT_CARDS = ["Aetherling", "Anurid Brushhopper", "Archfiend's Vessel", "Argent Sphinx", "Djinn of the Fountain", "Dubious Challenge", "Fleeting Spirit", "Ghost Council of Orzhova", "Hikari, Twilight Guardian",
  "Immortal Obligation", "Inscribed Tablet", "Jeskai Infiltrator", "Kaya, Geist Hunter", "Lukamina, Moon Druid", "Mazemind Tome", "Meandering Towershell", "Mnemonic Betrayal", "Nezahal, Primal Tide", "Norin the Wary",
  "Primeval Spawn", "Saltskitter", "Shoreline Scout", "Sunfall", "Conqueror's Galleon", "Thieves' Auction"];
const auditName = (text) => AUDIT_CARDS.find((n) => String(text || "").includes(n));
obs.audit = { used: {}, stacked: {}, seen: {}, manaTurn: -1, holding: null, id: 200, perTurn: {}, auctions: [] };
function auditFix(prompt) {
  const g = gv(), A = obs.audit;
  if (prompt.input?.type !== "chooseAction" || (g.stack || []).length) return false;
  if (A.holding) return true;
  if (A.manaTurn === g.turn || g.activePlayerId !== slot || !/main/i.test(g.step || "")) return false;
  A.manaTurn = g.turn;
  const back = [...zoneCards(g, "graveyard", slot), ...zoneCards(g, "exile", slot)].filter((c) => AUDIT_CARDS.includes(c.identity?.name) && (A.stacked[c.identity.name] || 0) < 3);
  const foe = obs.order.find((p) => p !== slot);
  const victim = zoneCards(g, "battlefield", foe).find((c) => (c.types || []).includes("Creature") && !c.identity?.isToken);
  const ops = [{ op: "mana", player: slot, mana: Array(16).fill("W U B R G").join(" ") }, ...back.map((c) => ({ op: "move", card: c.id, zone: "hand" })), ...(victim ? [{ op: "move", card: victim.id, zone: "graveyard" }] : [])];
  A.holding = ++A.id;
  broadcast({ kind: "directive", fromPlayer: slot, directive: { type: "applyState", fixId: A.holding, ops } });
  return true;
}
function auditSeen(g) {
  const r = g.stateFix, A = obs.audit;
  // (what truly reached the stack, by its own stack id: a pick that was undone doesn't count)
  for (const it of g.stack || []) if (!A.seen[it.id]) {
    A.seen[it.id] = true;
    const n = auditName(it.identity?.name);
    if (n && it.controllerId === slot) A.stacked[n] = (A.stacked[n] || 0) + 1;
  }
  if (r && r.fixId === A.holding) { if (!r.applied) obs.notes.push(`audit fix refused: ${JSON.stringify(r).slice(0, 120)}`); A.holding = null; }
}
function auditPick(acts, g) {
  const A = obs.audit;
  if (g.activePlayerId !== slot || !/main/i.test(g.step || "") || (g.stack || []).length) return null;
  const tally = (a, what) => { const n = auditName(what) || "other"; A.used[n] = (A.used[n] || 0) + 1; return a; };
  const fresh = (a) => { const k = `${g.turn}:${a.cardId}:${a.abilityIndex ?? "cast"}`; A.perTurn[k] = (A.perTurn[k] || 0) + 1; return A.perTurn[k] <= 2; };
  const label = (a) => a.label || a.description || cname(a.cardId);
  const allSeen = g.turn >= 14;
  const cast = acts.filter((a) => a.type === "cast").sort((x, y) => (A.stacked[auditName(label(x))] || 0) - (A.stacked[auditName(label(y))] || 0))
    .find((a) => !/Thieves' Auction/.test(label(a)) || (allSeen && zoneCards(g, "battlefield", slot).some((c) => c.identity?.name === COMMANDER)));
  if (cast && fresh(cast)) { if (/Thieves' Auction/.test(label(cast))) A.auctions.push({ turn: g.turn }); return tally(cast, label(cast)); }
  const ability = acts.find((a) => a.type === "activateAbility" && (auditName(cname(a.cardId)) || /draws a card/i.test(label(a))) && !/Kenrith/.test(cname(a.cardId) + "x") || (a.type === "activateAbility" && /draws a card/i.test(label(a)) && zoneCards(g, "hand", slot).length < 5));
  if (ability && fresh(ability)) return tally(ability, cname(ability.cardId));
  return null;
}
function cname(id) { return (gv().zones || []).flatMap((z) => z.cards || []).find((c) => c.id === id)?.identity?.name || ""; }
function fixSeen(g) {
  const F = obs.fix;
  if (F.after && !F.manaLater && g.step !== F.afterStep && g.turn === F.afterTurn) {
    F.manaLater = { step: g.step, colorless: (playerOf(slot)?.manaPool || {}).C || 0, cast: (g.stack || []).length > 0 };
    log(`fix: in ${g.step} the pool has ${F.manaLater.colorless} colourless`);
  }
  const r = g.stateFix;
  if (r && !F.results.some((x) => x.fixId === r.fixId)) {
    F.results.push({ ...r, turn: g.turn, step: g.step });
    log(`fix: engine answered ${JSON.stringify(r)}`);
    if (r.fixId === 101) { F.after = fixSnapshot(g); F.afterStep = g.step; F.afterTurn = g.turn; }
    if (r.fixId === 102) { F.badAfter = fixSnapshot(g); setTimeout(finish, 15000); }
    if (F.holding === r.fixId) F.holding = null;
  }
}

obs.sac = { tried: null, prompt: null, cancelled: false, next: null };

// costcancel: the two spells in turn; each one's cost question is cancelled and the board compared before / after
obs.cc = [{ card: "Fling", cost: "sacrifice" }, { card: "Tormenting Voice", cost: "discard" }];
function ccState(name) {
  const g = gv();
  const mine = (zone) => (g.zones || []).filter((z) => z.ownerId === slot && z.zone === zone).flatMap((z) => z.cards || []);
  return { inHand: mine("hand").filter((c) => c.identity?.name === name).length, hand: mine("hand").length,
    graveyard: mine("graveyard").length, commanderAt: myCommander()?.zone.zone,
    untapped: mine("battlefield").filter((c) => (c.types || []).includes("Land") && !c.tapped).length, stack: (g.stack || []).length,
    pool: JSON.stringify(playerOf(slot)?.manaPool || {}) };
}
function ccCancel(step, prompt, type, input) {
  step.prompt = { type, title: input.presentation?.title, intent: input.intent ?? null, cancellable: !!input.cancellable };
  log(`costcancel: ${step.card} asks ${JSON.stringify(step.prompt)}`);
  if (!input.cancellable) { step.gaveUp = true; return false; }
  step.cancelled = true;
  respond(prompt, type, { type: "cancel" });
  return true;
}
// (at our next question, once the engine has rolled the spell back)
function ccCheck() {
  for (const st of obs.cc) if (st.cancelled && !st.after) { st.after = ccState(st.card); log(`costcancel: after Cancel: ${JSON.stringify(st.after)}`); }
}

obs.flt = { seen: {}, checks: [], casting: null, paid: null };
setInterval(() => {
  if (GAME !== "filter" && GAME !== "filter2") return;
  const g = gv();
  const onBf = (g.zones || []).some((z) => z.zone === "battlefield" && z.ownerId === slot && (z.cards || []).some((c) => /^(Rhystic Study|Gale, Waterdeep Prodigy)/.test(c.identity?.name || "")));
  if (onBf && !obs.flt.paid) { obs.flt.paid = { turn: g.turn }; log("filter: Rhystic Study resolved"); }
  if (obs.flt.paid || obs.flt.checks.filter((c) => c.mana >= 3).length >= 3) setTimeout(finish, 1500);
}, 1000);

// eminence: Vampire tokens on our battlefield, after each cast
obs.em = { casts: [], maxTokens: 0 };
function emTokens() {
  return (gv().zones || []).filter((z) => z.zone === "battlefield").flatMap((z) => z.cards || [])
    .filter((c) => c.controllerId === slot || c.ownerId === slot).filter((c) => c.identity?.isToken && /Vampire/.test(c.identity?.name || "")).length;
}
setInterval(() => {
  if (GAME !== "eminence") return;
  obs.em.maxTokens = Math.max(obs.em.maxTokens, emTokens());
  const resolved = obs.em.casts.filter((c) => c.commanderAt === "command").length;
  if (resolved >= 3 && obs.em.maxTokens >= 3) finish();
}, 1000);

// dungeon: the stages, run in order in our own main phases. A "fix" stage makes cards by manual fix (Veteran Dungeoneer:
// "When Veteran Dungeoneer enters, venture into the dungeon", Forge's script) and casts them; a stage with `cp` first
// keeps the newest restore point (taken before any of its ventures) with the room the board shows then; one with
// `cpFix` keeps the point the fix itself records (applyState's restore point, taken before its ops). A "restore"
// stage goes back to a kept point and compares the board after with the board when the point was kept.
const DG_VD = "Veteran Dungeoneer";
const dgMana = (n) => ({ op: "mana", player: slot, mana: Array(n).fill("W").join(" ") });
const dgMake = (name, zone, player = slot) => ({ op: "createCard", name, player, zone });
const dgOpponent = () => (gv().players || []).find((p) => p.id !== slot)?.id;
const DG_FIRST_ROOMS = ["", "Cave Entrance", "Goblin Lair", "Mine Tunnels"];
const DG_STAGES = [
  { name: "first venture", cp: "B", ops: () => [dgMana(4), dgMake(DG_VD, "hand")], casts: 1, done: (g) => !!myDungeon(g)?.room },
  { name: "second venture", cp: "A", newTurn: true, ops: () => [dgMana(4), dgMake(DG_VD, "hand")], casts: 1,
    done: (g) => !!myDungeon(g)?.room && myDungeon(g).room !== obs.dg.cps.A.view.dungeon?.room },
  { restore: "A", check: "a venture after the restore point: the room goes back",
    ok: (was, now) => !!was.dungeon && now.dungeon?.name === was.dungeon.name && now.dungeon?.room === was.dungeon.room },
  { restore: "B", check: "a first venture after the restore point: the dungeon goes", ok: (was, now) => !was.dungeon && !now.dungeon },
  { name: "three ventures", ops: () => [dgMana(12), dgMake("Cloister Gargoyle", "battlefield"), dgMake(DG_VD, "hand"), dgMake(DG_VD, "hand"), dgMake(DG_VD, "hand")],
    casts: 3, done: (g) => !!myDungeon(g)?.room && !DG_FIRST_ROOMS.includes(myDungeon(g).room) },
  { name: "completion", cp: "C", newTurn: true, ops: () => [dgMana(4), dgMake(DG_VD, "hand")], casts: 1,
    done: (g) => !myDungeon(g) && dgGargoyle(g) === obs.dg.cps.C.view.gargoyle + 3 },
  { restore: "C", check: "a completion after the restore point: the dungeon comes back in its room and leaves the completed list (Cloister Gargoyle loses its +3/+0)",
    ok: (was, now) => !!was.dungeon && now.dungeon?.name === was.dungeon.name && now.dungeon?.room === was.dungeon.room && now.gargoyle === was.gargoyle },
  // the other direction: a completion before the point must survive the rewind. A point that kept the live completed
  // list (not a copy) would come back empty, and Cloister Gargoyle would lose its +3/+0.
  { name: "completion again", ops: () => [dgMana(4), dgMake(DG_VD, "hand")], casts: 1, done: (g) => !myDungeon(g) && dgGargoyle(g) === 3 },
  { name: "second dungeon", cpFix: "D", newTurn: true, ops: () => [dgMana(4), dgMake(DG_VD, "hand")], casts: 1,
    done: (g) => !!myDungeon(g)?.room && dgGargoyle(g) === 3 },
  { restore: "D", check: "a completion before the restore point survives it and a dungeon entered after it goes (applyState's own restore point; Cloister Gargoyle keeps its +3/+0)",
    ok: (was, now, cp) => cp.fixRecorded && !was.dungeon && was.gargoyle === 3 && !now.dungeon && now.gargoyle === 3 },
  // same turn as the restore: the venture before it (second dungeon) must not count, or the opponent's Keen-Eared
  // Sentry ("each opponent can't venture into the dungeon more than once each turn") blocks this one
  { name: "venture after the rewind", ops: () => [dgMana(4), dgMake("Keen-Eared Sentry", "battlefield", dgOpponent()), dgMake(DG_VD, "hand")], casts: 1, done: () => true },
  { name: "second venture this turn", ops: () => [dgMana(4), dgMake(DG_VD, "hand")], casts: 1, done: () => true },
];
obs.dg = { stage: 0, cps: {}, prompts: [], results: [], holding: null, lastTurn: -1, fixId: 300, voteSeen: 0 };
function myDungeon(g) { return (g.players || []).find((p) => p.id === slot)?.dungeonState || null; }
function dgGargoyle(g) { const c = zoneCards(g, "battlefield", slot).find((x) => x.identity?.name === "Cloister Gargoyle"); return c ? Number(c.power) : null; }
function dgVD(g) { return zoneCards(g, "battlefield", slot).filter((c) => c.identity?.name === DG_VD).length + (g.stack || []).filter((s) => s.identity?.name === DG_VD).length; }
function dgView(g) { return { turn: g.turn, step: g.step, dungeon: myDungeon(g), gargoyle: dgGargoyle(g), completedDungeons: playerOf(slot)?.completedDungeons ?? "not in the view" }; }
function dgNext(g, result) {
  const D = obs.dg, st = DG_STAGES[D.stage];
  D.results.push({ stage: st.name || `restore ${st.restore}`, ...result });
  log(`dungeon: ${st.name || `restore ${st.restore}`}: ${JSON.stringify(result)}`);
  D.lastTurn = g.turn;
  D.stage++;
  if (D.stage >= DG_STAGES.length) setTimeout(finish, 3000);
}
function dgSeen(g) {
  const D = obs.dg, st = DG_STAGES[D.stage];
  if (!st) return;
  const v = g.restoreVote;
  if (D.holding === "restore" && v && v.voteId > D.voteSeen && v.status?.type !== "pending") {
    D.holding = null;
    D.voteSeen = v.voteId;
    const was = D.cps[st.restore].view, now = dgView(g);
    const cp = D.cps[st.restore];
    dgNext(g, { vote: v.status?.type, checkpoint: cp.checkpoint, fixRecorded: cp.fixRecorded, before: st.before, was, now, pass: v.status?.type === "approved" && st.ok(was, now, cp) });
    return;
  }
  const r = g.stateFix;
  if (D.holding === "fix" && r && r.fixId === D.fixId) {
    D.holding = null;
    st.fixed = r;
    if (!r.applied) { obs.notes.push(`dungeon fix refused: ${JSON.stringify(r).slice(0, 160)}`); dgNext(g, { refused: r }); return; }
    if (st.cpFix) {
      const newest = (g.checkpoints || []).at(-1) || null;
      D.cps[st.cpFix] = { checkpoint: newest, view: st.pre, fixRecorded: !!newest && newest.checkpointId > st.cpPrior };
      log(`dungeon: keeping the fix's restore point ${st.cpFix} = ${JSON.stringify(D.cps[st.cpFix])}`);
    }
  }
}
function dgAnswer(prompt) {
  const D = obs.dg, g = gv(), st = DG_STAGES[D.stage];
  if (D.holding) return true; // (no answers while a fix or a rewind is on its way: a stale answer crashed Forge once)
  if (prompt.input?.type !== "chooseAction") return false;
  const ours = g.activePlayerId === slot && /main/i.test(g.step || "") && !(g.stack || []).length;
  // a stage is settled at our next empty-stack question, once the room's own ability has resolved too
  if (st && st.fixed && !(g.stack || []).length && dgVD(g) >= st.vdBase + st.casts && st.done(g)) return dgNext(g, { pre: st.pre, now: dgView(g) }), dgAnswer(prompt);
  if (st && ours && st.restore && !st.before) {
    const cp = D.cps[st.restore].checkpoint;
    st.before = dgView(g);
    D.holding = "restore";
    broadcast({ kind: "directive", fromPlayer: slot, directive: { type: "requestRestore", checkpointId: cp.checkpointId } });
    log(`dungeon: rewind to ${JSON.stringify(cp)} from ${JSON.stringify(st.before)}`);
    return true;
  }
  if (st && ours && st.ops && !st.sent && (!st.newTurn || g.turn > D.lastTurn)) {
    if (st.cp) D.cps[st.cp] = { checkpoint: (g.checkpoints || []).at(-1) || null, view: dgView(g) };
    st.sent = { turn: g.turn };
    st.pre = dgView(g);
    st.cpPrior = (g.checkpoints || []).at(-1)?.checkpointId ?? -1;
    st.vdBase = dgVD(g);
    D.holding = "fix";
    broadcast({ kind: "directive", fromPlayer: slot, directive: { type: "applyState", fixId: ++D.fixId, ops: st.ops() } });
    log(`dungeon: ${st.name}: fix ${D.fixId}` + (st.cp ? `, keeping restore point ${st.cp} = ${JSON.stringify(D.cps[st.cp])}` : ""));
    return true;
  }
  if (st && st.fixed && ours && dgVD(g) < st.vdBase + st.casts) {
    const cast = (prompt.input.actions || []).find((a) => a.type === "cast" && new RegExp(DG_VD).test(a.label || "") && !failed.has(`${g.turn}:${a.id}`));
    if (cast) { lastAct = `${g.turn}:${cast.id}`; respond(prompt, "chooseAction", { type: "act", actionId: cast.id }); return true; }
  }
  respond(prompt, "chooseAction", { type: "pass" });
  return true;
}

// ── verdicts ──
function verdicts() {
  const v = [];
  const pass = (name, ok, detail) => v.push({ check: name, result: ok === null ? "NOT REACHED" : ok ? "PASS" : "FAIL", detail });
  if (TAXLIKE && GAME !== "rewind" && GAME !== "concede") {
    const deaths = obs.commanderMoves.filter((m) => m.from === "battlefield");
    pass("Commander-zone choice offered when the commander leaves", obs.replacementPrompts.length ? obs.replacementPrompts.length >= deaths.length : (deaths.length ? false : null),
      `${obs.replacementPrompts.length} offers for ${deaths.length} times it left the battlefield`);
    const wrong = obs.commanderMoves.filter((m, i) => m.from === "battlefield" && !["command", "stack"].includes(m.to)
      && !(obs.commanderMoves[i + 1] && obs.commanderMoves[i + 1].to === "command"));
    pass("Commander ends up in the command zone", deaths.length ? wrong.length === 0 : null, JSON.stringify(obs.commanderMoves));
    const counts = obs.commanderCasts.map((c) => Object.values(c.castsBefore).reduce((a, b) => a + (b || 0), 0));
    const rising = counts.length >= 3 && counts.every((n, i) => n === i);
    pass("Commander tax: casts counted 0, 1, 2... (tax 0, {2}, {4})", counts.length >= 3 ? rising : null, `casts before each cast: ${counts.join(", ")}; pay prompts for it: ${JSON.stringify(obs.payPrompts.filter((p) => p.isCommander).map((p) => p.cost ?? p.title))}`);
  } else if (GAME !== "dungeon") {
    const elim = obs.eliminations.find((e) => e.player !== slot);
    const cd = elim ? Math.max(0, ...Object.values(elim.commanderDamage)) : 0;
    pass("21 commander damage knocks a player out (life still above 0)", elim ? cd >= 21 && elim.life > 0 : null, elim ? `out at life ${elim.life}, commander damage ${cd}` : "nobody went out");
    // turn order: after the elimination, the next active players skip the eliminated one and keep seat order
    const after = elim ? obs.turns.filter((t) => t.turn > elim.turn) : [];
    const skipped = after.length ? after.every((t) => t.active !== elim.player) : null;
    pass("Turn order skips the eliminated player", skipped, after.slice(0, 6).map((t) => `${t.turn}:${t.active}`).join(" "));
    // turn 0 is the setup moment before the first real turn (its "active" player isn't the one who starts)
    const real = obs.turns.filter((t) => t.turn > 0);
    const seq = real.map((t) => t.active);
    let orderOk = true;
    for (let i = 1; i < real.length; i++) {
      const alive = obs.order.filter((id) => real[i].statuses[id] === "playing" || id === seq[i]);
      const prev = obs.order.indexOf(seq[i - 1]);
      const expect = [...obs.order.slice(prev + 1), ...obs.order.slice(0, prev + 1)].find((id) => alive.includes(id));
      if (expect !== seq[i] && real[i].turn === real[i - 1].turn + 1) { orderOk = false; obs.notes.push(`turn order: after ${seq[i - 1]} expected ${expect}, got ${seq[i]} (turn ${real[i].turn})`); }
    }
    pass("Turns go around the table in seat order", real.length > 4 ? orderOk : null, `${real.length} turns`);
    // priority: within one step and the same stack, the next holder is the next living player in seat order
    let checked = 0, bad = 0;
    for (let i = 1; i < obs.priority.length; i++) {
      const a = obs.priority[i - 1], b = obs.priority[i];
      if (a.turn !== b.turn || a.step !== b.step || a.stack !== b.stack) continue;
      const k = obs.order.indexOf(a.holder);
      const expect = [...obs.order.slice(k + 1), ...obs.order.slice(0, k + 1)].find((id) => b.alive.includes(id));
      checked++;
      if (expect !== b.holder) { bad++; if (bad <= 5) obs.notes.push(`priority: after ${a.holder} expected ${expect}, got ${b.holder} (turn ${b.turn} ${b.step})`); }
    }
    // one seat only sees the board when priority comes back to it, so this is usually NOT REACHED here;
    // bridge/priority-check.js checks it with four scripted seats
    pass("Priority passes in seat order", checked ? bad === 0 : null, `${checked} passes seen, ${bad} out of order`);
  }
  if (GAME === "keywords") {
    for (const [kw, re] of Object.entries(KW_TARGETS)) {
      const hit = obs.kwCasts.find((c) => re.test(`${c.label} ${JSON.stringify(c.mode || {})}`));
      pass(`${kw} cast through the engine`, hit ? true : null, hit ? `turn ${hit.turn}: ${hit.label}` : "not cast");
    }
  }
  if (GAME === "concede") {
    const a = obs.afterConcede;
    pass("Concede: the player is marked conceded", a ? a.status === "conceded" : null, JSON.stringify(a));
    pass("Concede: the game ends with the other player winning", a ? a.gameOver && a.winner && a.winner !== slot : null, "");
  }
  if (GAME === "rewind") {
    const R = obs.rewind;
    pass("Rewind: checkpoint for the upkeep of turn 6 offered", R.requested ? !!R.requested.checkpoint : null, JSON.stringify(R.requested?.available?.slice(-6) || []));
    pass("Rewind: the game goes back to it", R.back ? R.back.turn === 6 : (R.requested ? false : null), JSON.stringify(R.back && { turn: R.back.turn, step: R.back.step }));
    // the bridge's rewind detection relies on this (bridge.js checkRestored): later restore points are dropped
    pass("Rewind: restore points after the one it went back to are dropped", R.back && R.requested?.checkpoint ? R.back.checkpoints.last != null && R.back.checkpoints.last <=R.requested.checkpoint.checkpointId && R.back.checkpoints.last < R.requested.lastId : null,
      JSON.stringify(R.back?.checkpoints || {}));
    pass("Rewind: life, commander casts and zones are as they were", R.back ? R.back.same : null, R.back && !R.back.same ? `now ${R.back.fp} was ${R.back.was}`.slice(0, 300) : "");
    const D = R.draws || { before: {}, after: {} };
    const turns = Object.keys(D.after).filter((t) => D.before[t]);
    pass("Rewind: the same cards are drawn again after it", turns.length ? turns.every((t) => JSON.stringify(D.before[t]) === JSON.stringify(D.after[t])) : null, JSON.stringify(turns.map((t) => ({ turn: t, before: D.before[t], after: D.after[t] }))));
    pass("Rewind: no card is duplicated", R.back ? !(R.dupes || []).length : null, (R.dupes || []).slice(0, 4).join("; "));
  }
  // after a rewind the answer to the question that was open before it is refused as stale: expected
  if (GAME === "rewind" || GAME === "dungeon") obs.errors = obs.errors.filter((e) => !/stalePrompt/.test(e));
  if (GAME === "dungeon") {
    const D = obs.dg;
    const res = (name) => D.results.find((r) => r.stage === name);
    const first = res("first venture");
    pass("Dungeon: the first venture enters Lost Mine of Phandelver, Cave Entrance", first ? first.now?.dungeon?.name === "Lost Mine of Phandelver" && first.now.dungeon.room === "Cave Entrance" : null, JSON.stringify(first?.now?.dungeon || first || {}));
    const roomQ = D.prompts.filter((p) => !p.options.some((o) => /Lost Mine of Phandelver/.test(o)));
    pass("Dungeon: a branch asks which room next", roomQ.length ? roomQ.some((p) => p.options.length === 2) : null, JSON.stringify(roomQ.slice(0, 2)));
    const done = res("completion");
    pass("Dungeon: completing it removes the dungeon (Cloister Gargoyle gets +3/+0)", done ? !!done.now && !done.now.dungeon && done.now.gargoyle === 3 : null, JSON.stringify(done?.now || done || {}));
    for (const st of DG_STAGES.filter((s) => s.restore)) {
      const r = res(`restore ${st.restore}`);
      pass(`Dungeon rewind: ${st.check}`, r ? r.pass : null, r ? JSON.stringify({ vote: r.vote, fixRecorded: r.fixRecorded, was: { dungeon: r.was.dungeon, gargoyle: r.was.gargoyle }, before: { dungeon: r.before?.dungeon, gargoyle: r.before?.gargoyle }, after: { turn: r.now.turn, step: r.now.step, dungeon: r.now.dungeon, gargoyle: r.now.gargoyle } }) : "");
    }
    // the precondition first: without a working Sentry the venture check below would pass whatever the count said
    const after = res("venture after the rewind"), again = res("second venture this turn");
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    pass("Dungeon: Keen-Eared Sentry stops a second venture in a turn (precondition for the next check)", again?.now ? same(again.pre.dungeon, again.now.dungeon) : null, JSON.stringify(again ? { pre: again.pre?.dungeon, now: again.now?.dungeon, refused: again.refused } : {}));
    pass("Dungeon rewind: a venture before the restore point is not counted after it (the next venture enters Cave Entrance)", after?.now ? after.now.dungeon?.room === "Cave Entrance" : null, JSON.stringify(after ? { pre: after.pre?.dungeon, now: after.now?.dungeon, refused: after.refused } : {}));
  }
  if (GAME === "fix") {
    const F = obs.fix;
    const ok = F.results.find((r) => r.fixId === 101), bad = F.results.find((r) => r.fixId === 102);
    const a = F.after, p = F.plan;
    pass("Fix: the engine applies the list", ok ? ok.applied === true : null, JSON.stringify(ok || {}));
    pass("Fix: life set", a ? a.life === 31 : null, `life ${a?.life}`);
    pass("Fix: poison set", a ? a.poison === 3 : null, `poison ${a?.poison} (${JSON.stringify(a?.opp?.counters || a?.opp?.playerCounters || {}).slice(0, 80)})`);
    pass("Fix: hand card onto the battlefield", a ? a.where[p.toField]?.zone === "battlefield" : null, JSON.stringify(a?.where[p?.toField] || {}));
    pass("Fix: permanent into the graveyard", a ? a.where[p.toGrave]?.zone === "graveyard" : null, JSON.stringify(a?.where[p?.toGrave] || {}));
    pass("Fix: counters and tapped", a ? (a.where[p.countered]?.counters?.P1P1 || 0) === (F.before?.where?.[p.countered]?.counters?.P1P1 || 0) + 2 && !!a.where[p.countered]?.tapped : null, // (P1P1 up by exactly 2, counters being {name: n}: engine-interface-reference CardDto)
 JSON.stringify(a?.where[p?.countered] || {}));
    pass("Fix: a Treasure token made", a ? a.treasures === p.treasures + 1 : null, `treasures ${p?.treasures} -> ${a?.treasures}`);
    pass("Fix: a hand card to the library bottom", a && p.toBottom ? a.where[p.toBottom] === undefined && a.library === p.library + 1 : null, `library ${p?.library} -> ${a?.library}`);
    pass("Fix: mana added (seven colourless)", a ? a.colorless >= 7 : null, `colourless ${a?.colorless}`);
    pass("Fix: the mana stays into a later step", F.manaLater ? F.manaLater.colorless > 0 : null, JSON.stringify(F.manaLater || {}));
    pass("Fix: commander damage set", a && p.oppCommander ? a.cmdDamage[p.oppCommander] === 4 : null, JSON.stringify(a?.cmdDamage || {}));
    pass(`Fix: a list with ${F.badKind || "a bad change"} is refused`, bad ? bad.applied === false : null, JSON.stringify(bad || {}));
    pass("Fix: ...and nothing of it is applied", F.badAfter ? F.badAfter.life === F.badBefore.life : null, `life ${F.badBefore?.life} -> ${F.badAfter?.life}`);
  }
  if (GAME === "filter" || GAME === "filter2") {
    const enough = obs.flt.checks.filter((c) => c.mana >= 3);
    pass("Filter land: Rhystic Study offered whenever the lands can pay {2}{U}", enough.length ? enough.every((c) => c.offered) : null, JSON.stringify(enough.slice(0, 3)));
    pass("Filter land: auto-pay pays it (Rhystic Study resolves)", obs.flt.casting ? !!obs.flt.paid : null, JSON.stringify({ casting: obs.flt.casting, paid: obs.flt.paid }));
  }
  if (GAME === "eminence") {
    const fromCommand = obs.em.casts.filter((c) => c.commanderAt === "command");
    pass("Eminence: Vampire spells cast while Edgar is in the command zone", fromCommand.length > 0 ? true : null, `${fromCommand.length} casts: ${fromCommand.slice(0, 4).map((c) => c.card).join(", ")}`);
    pass("Eminence: each one made a 1/1 Vampire token", fromCommand.length ? obs.em.maxTokens >= Math.min(3, fromCommand.length) : null, `${obs.em.maxTokens} Vampire tokens seen for ${fromCommand.length} casts`);
  }
  if (GAME === "costcancel") {
    for (const st of obs.cc) {
      pass(`Cost cancel: ${st.card}'s ${st.cost} question offers Cancel`, st.prompt ? st.prompt.cancellable : null, JSON.stringify(st.prompt || {}));
      const b = st.before, a = st.after;
      pass(`Cost cancel: ${st.card} is back in hand, nothing lost, lands untapped`, a && b ? a.inHand === b.inHand && a.hand === b.hand
        && a.graveyard === b.graveyard && a.commanderAt === "battlefield" && a.untapped === b.untapped && a.pool === b.pool && a.stack === 0 : null, JSON.stringify({ before: b, after: a }));
    }
  }
  if (GAME === "sac") {
    const S = obs.sac;
    pass("Sac for mana: the sacrifice question offers Cancel", S.prompt ? S.prompt.cancellable : null, JSON.stringify(S.prompt || S.tried || {}));
    pass("Sac for mana: Cancel goes back to paying", S.cancelled ? !!S.next : null, JSON.stringify(S.next || {}));
    pass("Sac for mana: the creature is still on the battlefield", S.next ? S.next.commanderAt === "battlefield" : null, JSON.stringify(S.next || {}));
  }
  if (GAME === "exile") {
    const linked = obs.exileLinks.filter((e) => e.exiledWith);
    pass("Exile links: a card exiled with a permanent is reported", obs.exileLinks.length ? linked.length > 0 : null, JSON.stringify(obs.exileLinks.slice(0, 4)));
  }
  if (GAME === "audit") {
    for (const n of AUDIT_CARDS) pass(`Audit: ${n} on the stack twice or more`, (obs.audit.stacked[n] || 0) >= 2 ? true : null, `${obs.audit.stacked[n] || 0} times`);
    pass("Audit: Thieves' Auction with a commander out, and the game carried on", obs.audit.auctions.length ? obs.turns[obs.turns.length - 1].turn > obs.audit.auctions[0].turn : null, JSON.stringify(obs.audit.auctions));
  }
  pass("No engine errors or rejected answers", obs.errors.length === 0, obs.errors.slice(0, 3).join(" | "));
  return v;
}

function finish() {
  if (finished) return;
  finished = true;
  const v = verdicts();
  fs.writeFileSync(OUT, JSON.stringify({ verdicts: v, obs }, null, 1));
  console.log(`\nRules check (${GAME}):`);
  for (const r of v) console.log(`  ${r.result.padEnd(11)} ${r.check}  -- ${r.detail}`);
  if (obs.notes.length) console.log("  notes:", obs.notes.slice(0, 10).join("; "));
  console.log(`  details: ${OUT}`);
  try { send({ type: "LeaveRoom" }); ws.close(); } catch {}
  setTimeout(() => process.exit(0), 300);
}

// stop once the checks are settled
setInterval(() => {
  fs.writeFileSync(OUT.replace(".json", "-live.json"), JSON.stringify(obs, null, 1));
  if (TAXLIKE && obs.commanderCasts.length >= 4) finish();
  if (GAME === "dungeon" && obs.turns.length && obs.turns[obs.turns.length - 1].turn > 30) { obs.notes.push(`dungeon: stuck at stage ${obs.dg.stage}`); finish(); }
  if (GAME === "keywords" && (Object.values(KW_TARGETS).every((re) => obs.kwCasts.some((c) => re.test(`${c.label} ${JSON.stringify(c.mode || {})}`))) || (obs.turns.length && obs.turns[obs.turns.length - 1].turn > 120))) finish();
  if (GAME === "cmddmg" && obs.eliminations.some((e) => e.player !== slot) && obs.turns.length > 0
    && obs.turns[obs.turns.length - 1].turn >= (obs.eliminations[0].turn + SEATS + 1)) finish();
}, 2000);
setTimeout(() => { log(`time limit ${MINUTES} min`); finish(); }, MINUTES * 60_000);
process.on("SIGINT", finish);
