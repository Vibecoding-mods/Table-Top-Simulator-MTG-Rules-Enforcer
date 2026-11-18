// Headless six-seat games on the harness (docs/m6-six-seat-spec.md §7 step 15, "headless 6 seats twice"): the host plus
// five Forge AI seats in one Commander game, started and played through ManaBrewEngineAdapter, the node's own engine
// entry (engine/checks/HeadlessGameServer.java, a line-per-command wrapper over it). The relay and node images are not
// needed: this is the harness equivalent of `bridge/engine-test.js --seats 6`, with its auto-play answers.
// Per game it logs every turn's active player, checks the turn order goes round the seats in order (the seat after the
// last turn's, skipping players who have lost), reports engine errors, and a stall: no new state and no new question
// for --stall seconds is "stuck priority" with the priority player and step. Ends at game over or after --turns turns.
// --record <file>: every state the host sees (its view) and every question, in order, for the bridge (tools/m6-stream.js).
//   node tools/headless-six.js <engine tree with its harness jar> [--games 2] [--turns 15] [--seed 1] [--stall 120]
//     [--record tmp/six-game.json] [--log tmp/headless-six.json] [--archenemy] [--seats 4]
// --archenemy: an Archenemy game (cloud/archenemy-six): Purple, an AI seat, the archenemy at double the format's life
// (80), first, with the first 20 schemes of bridge/forge-schemes.json (ARCH_SCHEMES); the other five one team at 40.
// The same game the bridge asks for (tools/m6-stream.js --archenemy), so its recording drives the bridge's golden.
// The archenemy's opponents take one turn together (teamRules "teamTurns", CR 904.2 and 805; cloud/archenemy-team-turns):
// the turn order check then wants the archenemy, the team (its first seat the active player), the archenemy, ...
// --seats 4: the four-seat table (White, Red, Yellow, Blue; with --archenemy, Blue the archenemy against three).
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const TREE = path.resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : path.join(os.homedir(), "engine"));
const GAMES = Number(arg("games", 2));
const MAX_TURNS = Number(arg("turns", 15));
const SEED = Number(arg("seed", 1));
const STALL = Number(arg("stall", 120)) * 1000;
const RECORD = arg("record", null);
const LOG = arg("log", path.join(ROOT, "tmp", "headless-six.json"));
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const DECK_DIRS = [path.join(ROOT, "decks"), path.join(TREE, "public", "preset_decks"), path.join(ROOT, "manabrew", "public", "preset_decks")];
// the host's deck and the five AI decks: the built-in Commander decks (engine-test.js's, and two more for six seats)
const DECKS = ["neheb_minotaur_commander", "ashling_limitless_commander", "ramses_commander", "real_teval_commander",
  "hearthhull_world_shaper_commander", "ironsmith_commander_elven_empire"];
const SEATS = Number(arg("seats", 6));
// the six-seat table's seats, clockwise (spec §2.1), or the four-seat table's
const NAMES = SEATS === 4 ? ["White", "Red", "Yellow", "Blue"] : ["White", "Red", "Yellow", "Green", "Blue", "Purple"];

const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function deckOf(id) {
  const f = DECK_DIRS.map((d) => path.join(d, `${id}.json`)).find((x) => fs.existsSync(x));
  if (!f) throw new Error(`no deck ${id} in ${DECK_DIRS.join(", ")}`);
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  const deck = [];
  for (const e of p.cards) for (let k = 0; k < (e.count || 1); k++) deck.push({ name: e.name, setCode: e.set || undefined, collectorNumber: e.cardNumber ? String(e.cardNumber) : undefined });
  return { deck, commanderNames: p.commander ? [p.commander] : [] };
}

const ARCH = process.argv.includes("--archenemy");
const ARCH_SEAT = NAMES.length - 1;
const ARCH_SCHEMES = (() => { const j = require(path.join(ROOT, "bridge", "forge-schemes.json")); return [...j.schemes, ...(j.ongoing || [])].slice(0, 20); })();
function request(game) {
  const players = NAMES.map((name, i) => ({ name, ...deckOf(DECKS[i]), ai: i > 0, bot: i > 0,
    ...(ARCH ? (i === ARCH_SEAT ? { team: 1, startingLife: 80, goesFirst: true, schemes: ARCH_SCHEMES.map((n) => ({ name: n })) } : { team: 2 }) : {}) }));
  return {
    gameId: `headless-${SEATS}-${game}`, variant: "Commander", startingLife: 40, seed: SEED + game, snapshotRecording: false,
    ...(ARCH ? { archenemy: true, teamRules: "teamTurns" } : {}), players,
  };
}

function server() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "headless-six-"));
  const c = spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", tmp, "-cp", JAR, path.join(ROOT, "engine", "checks", "HeadlessGameServer.java")], { encoding: "utf8" });
  if (c.status !== 0) throw new Error(`HeadlessGameServer doesn't compile: ${c.stderr}`);
  const p = spawn("java", ["-Xmx6g", "-cp", [tmp, JAR].join(path.delimiter), "forge.harness.host.HeadlessGameServer", "forge/forge-gui/"], { cwd: TREE, stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: p.stdout });
  const waiting = [];
  lines.on("line", (l) => { const w = waiting.shift(); if (w) w(JSON.parse(l)); });
  const stderr = [];
  p.stderr.on("data", (d) => { stderr.push(String(d)); if (stderr.length > 400) stderr.splice(0, 200); });
  const ask = (line) => new Promise((resolve) => { waiting.push(resolve); p.stdin.write(`${line}\n`); });
  const ready = new Promise((resolve) => waiting.push(resolve));
  return { ask, ready, stderr, quit: () => { try { p.stdin.write("quit\n"); } catch {} setTimeout(() => p.kill(), 2000); } };
}

// engine-test.js's answers (bridge/engine-test.js answer()), with a seeded random choice
function answerOf(prompt, st) {
  const input = prompt.input || {};
  const type = input.type;
  const r = (output) => ({ type, output });
  if (prompt.kind === "priority") return { type: "chooseAction", output: { type: "pass" } };
  if (type !== "payManaCost") st.lastPayCard = null;
  if (type !== "chooseAction") st.actsThisPrompt = 0;
  switch (type) {
    // (unlike engine-test.js, which always keeps: a hand of fewer than two or more than five lands goes back, twice at
    // most, so the host plays a game rather than passing a landless one, headless-six game 1 of 2026-11-17)
    case "mulligan": {
      const ids = new Set(input.handCardIds || []);
      const hand = ((st.view?.zones || []).find((z) => z.zone === "hand" && z.ownerId === "player-0")?.cards || []).filter((c) => ids.has(c.id));
      const lands = hand.filter((c) => (c.types || []).includes("Land")).length;
      const keep = st.mulligans >= 2 || !hand.length || (lands >= 2 && lands <= 5);
      if (!keep) st.mulligans++;
      return r({ type: "mulliganDecision", keep });
    }
    case "mulliganPutBack": return r({ type: "mulliganPutBackDecision", cardIds: input.handCardIds.slice(0, input.count) });
    case "chooseAction": {
      const acts = (input.actions || []).filter((a) => !st.failed.has(`${st.turn}:${a.id}`) && a.type !== "undoMana");
      const land = acts.find((a) => /^play /i.test(a.label || ""));
      const spell = acts.find((a) => a.type === "cast");
      const pick = land || (st.actsThisPrompt < 3 && st.random() < 0.6 ? spell : null);
      if (pick) { st.actsThisPrompt++; st.lastAct = `${st.turn}:${pick.id}`; return r({ type: "act", actionId: pick.id }); }
      st.actsThisPrompt = 0;
      return r({ type: "pass" });
    }
    case "payManaCost": {
      if (st.lastPayCard === input.cardId) { st.lastPayCard = null; if (st.lastAct) st.failed.add(st.lastAct); return r({ type: "cancel" }); }
      st.lastPayCard = input.cardId;
      return r({ type: "pay", auto: true });
    }
    case "chooseBoardTargets": {
      const k = Math.min(input.maxTargets, Math.max(input.minTargets, 1), input.candidates.length);
      if (k === 0 && input.cancellable) return r({ type: "cancel" });
      return r({ type: "boardTargets", chosen: input.candidates.slice(0, k).map(({ kind, id }) => ({ kind, id })) });
    }
    case "chooseBoolean": return r({ type: "decision", value: true });
    case "chooseCards": return r({ type: "chooseCardsDecision", chosenCardIds: input.cards.slice(0, input.min).map((c) => c.id) });
    case "chooseNumber": return r({ type: "numberDecision", chosenNumber: input.min });
    case "chooseFromSelection": {
      const k = Math.min(Math.max(input.minTotal, 1), input.maxTotal, input.options.length);
      return r({ type: "selectionDecision", chosenIndices: [...Array(k).keys()] });
    }
    case "chooseAttackers":
      return r({ type: "declareAttackers", assignments: input.attackers.filter((a) => a.validTargetIds.length).map((a) => ({ attackerId: a.attackerId, targetId: a.validTargetIds[0] })) });
    case "chooseBlockers": return r({ type: "declareBlockers", assignments: [] });
    case "chooseDamageAssignmentOrder": return r({ type: "damageAssignmentOrderDecision", orderedBlockerIds: input.blockerIds });
    case "chooseCombatDamageAssignment": {
      const to = input.blockerIds[0] || input.defenderId;
      return r({ type: "combatDamageAssignmentDecision", assignments: [{ assigneeId: to, damage: input.totalDamage }] });
    }
    case "reorder": return r({ type: "reorderDecision", orderedIds: input.items.map((i) => i.id) });
    case "scry": {
      const top = Math.max(0, input.zones.indexOf("libraryTop"));
      return r({ type: "scryDecision", zoneCardIds: input.zones.map((_, i) => (i === top ? input.cards.map((c) => c.id) : [])) });
    }
    case "chooseColor": return r({ type: "colorDecision", chosenColors: { [input.validColors[0]]: input.amount } });
    case "revealCards": return r({ type: "revealCardsAcknowledged" });
    case "diceRolled": return r({ type: "diceRolledAcknowledged" });
    default: return null;
  }
}

// The turn order check: the active player of each new turn should be the next seat after the last one, in the players'
// order, skipping players who have lost (an extra turn is the same player again, and is said so, not counted wrong).
// team: id -> the engine's teamNumber in a shared-turn game ("teamTurns", "sharedTurns"), else null: the next turn is then
// the next team's, its first seat after the last turn's team the active player
function nextSeat(order, from, lost, team = null) {
  const i = order.indexOf(from);
  const mine = team ? team.get(from) : null;
  for (let k = 1; k <= order.length; k++) {
    const id = order[(i + k) % order.length];
    if (lost.has(id) || (mine != null && team.get(id) === mine)) continue;
    return id;
  }
  return null;
}

async function playGame(s, game) {
  const st = { mulligans: 0, view: null, turn: 0, failed: new Set(), actsThisPrompt: 0, lastPayCard: null, lastAct: null, random: rng(SEED * 7919 + game) };
  const out = { game, seed: SEED + game, turns: [], problems: [], prompts: 0, unhandled: [], end: null, ms: 0 };
  const rec = [];
  const t0 = Date.now();
  const h = await s.ask(`start ${JSON.stringify(request(game))}`);
  if (h.status !== "ok") { out.problems.push(`start: ${h.value.split("\n")[0]}`); return { out, rec }; }
  let lastPrompt = null, lastRev = null, lastChange = Date.now(), view = null, order = null, lastActive = null, lastTurn = 0, lastRead = 0, lastSig = null;
  for (;;) {
    const err = await s.ask("error");
    if (err.value) { out.problems.push(`engine error: ${err.value.split("\n").slice(0, 3).join(" | ")}`); break; }
    // (the state revision counts snapshot checkpoints only, which a game without recording never makes: the view is
    // read again at each new question and every half second, and kept when it changed)
    const rev = (await s.ask("revision")).value;
    if (rev !== lastRev || Date.now() - lastRead > 500 || lastRead === 0) {
      lastRev = rev; lastRead = Date.now();
      const snap = await s.ask("snapshot 0");
      if (snap.status === "ok" && snap.value && snap.value !== lastSig) {
        lastSig = snap.value; lastChange = Date.now();
        view = JSON.parse(snap.value); st.view = view;
        if (RECORD) rec.push({ kind: "state", board: { gameView: view } });
        const players = view.players || [];
        order ??= players.map((p) => p.id);
        const lost = new Set(players.filter((p) => p.status && p.status !== "playing").map((p) => p.id));
        if (view.turn && view.turn !== lastTurn) {
          const active = view.activePlayerId;
          // (only from the turn just before: the view is read every half second, and a quick turn can pass unseen)
          const shared = ["teamTurns", "sharedTurns"].includes(view.teamRules?.rule);
          const team = shared ? new Map(players.map((p) => [p.id, p.teamNumber ?? null])) : null;
          const want = lastActive && view.turn === lastTurn + 1 ? nextSeat(order, lastActive, lost, team) : null;
          const turn = { turn: view.turn, active: NAMES[order.indexOf(active)] || active, life: players.map((p) => p.life) };
          // (a shared-turn game: the whole team whose turn it is, the active player first)
          if (shared) {
            const mine = team.get(active);
            turn.team = mine == null ? [turn.active] : order.filter((id) => team.get(id) === mine && !lost.has(id)).map((id) => NAMES[order.indexOf(id)] || id);
            turn.team = [turn.active, ...turn.team.filter((n) => n !== turn.active)];
          }
          if (lastActive && view.turn !== lastTurn + 1) turn.after = `turn ${lastTurn} (turns between unseen)`;
          if (want && active !== want) {
            if (active === lastActive) turn.extra = true;
            else out.problems.push(`seat order: turn ${view.turn} went to ${turn.active}, not ${NAMES[order.indexOf(want)] || want} after ${NAMES[order.indexOf(lastActive)]}`);
          }
          out.turns.push(turn);
          lastTurn = view.turn; lastActive = active; st.turn = view.turn;
        }
        if (view.gameOver) {
          out.end = { gameOver: true, winner: NAMES[order.indexOf(view.winnerId)] || view.winnerId || null, turn: view.turn };
          break;
        }
        if (view.turn > MAX_TURNS) { out.end = { gameOver: false, stoppedAtTurn: view.turn }; break; }
      }
    }
    const p = await s.ask("prompt");
    if (p.value && p.value !== lastPrompt) {
      lastPrompt = p.value; lastChange = Date.now(); lastRead = 0;
      const prompt = JSON.parse(p.value);
      if (RECORD) rec.push({ kind: "prompt", prompt });
      if ((prompt.input || {}).type === "gameOver") { out.end ??= { gameOver: true, turn: view && view.turn }; break; }
      // (the hand at the mulligan: a view read now, the last one may be from before the deal)
      if ((prompt.input || {}).type === "mulligan") { const fresh = await s.ask("snapshot 0"); if (fresh.status === "ok" && fresh.value) st.view = JSON.parse(fresh.value); }
      const a = answerOf(prompt, st);
      out.prompts++;
      if (!a) { out.unhandled.push((prompt.input || {}).type || prompt.kind); out.problems.push(`unhandled question ${(prompt.input || {}).type}: ${p.value.slice(0, 200)}`); break; }
      const sub = await s.ask(`submit ${JSON.stringify(a)}`);
      if (sub.status !== "ok") out.problems.push(`submit refused: ${sub.value.split("\n")[0]}`);
      continue;
    }
    // (the engine says the game is over before a view shows it: the last view is read, and kept, once more; the
    // game-over question the bridge says the end with is the node's, which the harness doesn't publish)
    if ((await s.ask("over")).value === "true") {
      const last = await s.ask("snapshot 0");
      if (last.status === "ok" && last.value) { view = JSON.parse(last.value); if (RECORD && last.value !== lastSig) rec.push({ kind: "state", board: { gameView: view } }); }
      out.end ??= { gameOver: true, winner: order && view?.winnerId ? NAMES[order.indexOf(view.winnerId)] : null, turn: view && view.turn };
      break;
    }
    if (Date.now() - lastChange > STALL) {
      out.problems.push(`stuck priority: no new state or question for ${STALL / 1000} s at turn ${view && view.turn}, step ${view && view.step}, priority ${view && (NAMES[order.indexOf(view.priorityPlayerId)] || view.priorityPlayerId)}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  out.ms = Date.now() - t0;
  out.permanents = Object.fromEntries((view?.players || []).map((p, i) => [NAMES[i], ((view.zones || []).find((z) => z.zone === "battlefield" && z.ownerId === p.id)?.cards || []).length]));
  out.mulligans = st.mulligans;
  out.status = Object.fromEntries((view?.players || []).map((p, i) => [NAMES[i], `${p.status}${p.lossReason ? ` (${p.lossReason})` : ""} ${p.life}`]));
  await s.ask("end");
  return { out, rec };
}

(async () => {
  if (!fs.existsSync(JAR)) { console.log(`no harness jar at ${JAR} (engine/test-harness-local.sh builds it)`); process.exit(2); }
  const s = server();
  const ready = await s.ready;
  if (ready.status !== "ready") { console.log("the server didn't start"); process.exit(2); }
  const results = [];
  const recs = [];
  for (let g = 1; g <= GAMES; g++) {
    const { out, rec } = await playGame(s, g);
    results.push(out); recs.push(rec);
    console.log(`game ${g}: ${out.turns.length} turns, ${out.prompts} host answers, ${(out.ms / 1000).toFixed(0)} s, end ${JSON.stringify(out.end)}`);
    console.log(`  host mulligans ${out.mulligans}; permanents at the end ${JSON.stringify(out.permanents)}; life ${JSON.stringify(out.turns.at(-1)?.life)}`);
    console.log(`  players at the end ${JSON.stringify(out.status)}`);
    console.log(`  turn order: ${out.turns.map((t) => `${t.turn}:${t.team ? t.team.join("+") : t.active}${t.extra ? "(extra)" : ""}`).join(" ")}`);
    for (const pr of out.problems) console.log(`  PROBLEM ${pr}`);
  }
  s.quit();
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, JSON.stringify(results, null, 1));
  if (RECORD) fs.writeFileSync(RECORD, JSON.stringify(recs[0]));
  const bad = results.reduce((n, r) => n + r.problems.length, 0);
  console.log(bad ? `${bad} problem(s) in ${GAMES} games` : `${GAMES} games, no problems`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log(`FAIL headless-six: ${e.stack}`); process.exit(2); });
