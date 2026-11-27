// Plays debug scenarios (scenarios/*.json) on the real engine, headless, with the sandboxed bridge in the loop, and
// records what happened for tests/test_bridge_scenario_checks.js (tests/golden/fixtures/scenario-checks.json).
// A two-player Commander game through ManaBrewEngineAdapter (engine/checks/HeadlessGameServer.java): Blue (player-0,
// the host) against one Forge AI. At Blue's first main phase with nothing on the stack, the engine's board and question
// go into the bridge (tests/bridge-harness.js), Blue types "mtg debug <name>", and the bridge's own applyState goes to
// the engine, as the relay would carry it. Then, for a scenario with a spell to cast (CAST), Blue casts it (the engine's
// own cast action and auto pay) and every question after it goes through the bridge: what the bridge shows Blue is
// answered by its first CLICK option (as a click on the table), what the bridge answers by itself is sent as it is,
// until the bridge shows Blue a question it doesn't answer itself with the stack empty. Recorded: the boards and
// questions the bridge was given, the clicks, and the answers the bridge sent.
//   node tools/check-scenarios.js <engine tree with its harness jar> [scenario ...]
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");
const harness = require("../tests/bridge-harness");
// (the real timer and clock: the harness fakes both while the bridge is loaded)
const REAL = { setTimeout, now: Date.now };

const ROOT = path.join(__dirname, "..");
const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const DECK_DIRS = [path.join(ROOT, "decks"), path.join(TREE, "public", "preset_decks"), path.join(ROOT, "manabrew", "public", "preset_decks")];
const OUT = path.join(ROOT, "tests", "golden", "fixtures", "scenario-checks.json");
// per scenario: the spell Blue casts after the setup, and which option Blue clicks on the bridge's questions after it;
// table "2hg": a Two-Headed Giant game (White, the host, and Red against Yellow and Blue, shared team turns), and
// until: the question the bridge must show (no cast: the host passes until it comes)
const PLAN = {
  "hand-overflow": {},
  "repeat-yesno": { cast: "Hordeling Outburst", click: ["__repeat:no"] },
  "repeat-yesno-pay": { cast: "Harmonize", click: ["__repeat:no"] },
  // (Two-Headed Giant at level 2, White the host and Red, Yellow and Blue Forge AI: White passes its turn, no attacks,
  // until the bridge shows the team block; White agrees, and the combat goes on to its damage)
  "team-block-live": { table: "2hg", until: "chooseBlockers", click: ["__agree"] },
  // (scenarios/LIVE-CHECKS.md: each live check's scenario. untilTurn: play on, through the bridge, until that turn
  // begins; snapshots: the engine records restore points, as a real game does; arch4: an Archenemy game on four seats,
  // White the archenemy with the first 20 schemes of bridge/forge-schemes.json)
  // (key: boards kept only where the checks read them, the setup, every question shown, the first board with a card
  // the engine stopped counting, and the last; the other steps keep their question's type and the answer sent. A
  // runaway loop's thousand boards of 500 tokens would be 400 MB)
  "live-rewind": { snapshots: true, untilTurn: 8, key: true },
  "live-archenemy": { table: "arch4", untilTurn: 2, key: true },
  "live-art": { cast: "Raise the Alarm", key: true },
  "live-runaway": { cast: "Polyraptor", untilUnbounded: true, key: true },
  "live-also-costs": { key: true },
};
const NAMES = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(PLAN);
process.env.MTG_SCENARIO_DIR = path.join(ROOT, "scenarios");

// the other answers before the setup, as tools/headless-six.js gives them (the AI's turn: no blocks, its orders kept)
const BEFORE = {
  diceRolled: () => ({ type: "diceRolledAcknowledged" }),
  chooseBlockers: () => ({ type: "declareBlockers", assignments: [] }),
  reorder: (i) => ({ type: "reorderDecision", orderedIds: i.items.map((x) => x.id) }),
  chooseNumber: (i) => ({ type: "numberDecision", chosenNumber: i.min }),
  chooseColor: (i) => ({ type: "colorDecision", chosenColors: { [i.validColors[0]]: i.amount } }),
  chooseFromSelection: (i) => ({ type: "selectionDecision", chosenIndices: [...Array(Math.min(Math.max(i.minTotal, 1), i.maxTotal, i.options.length)).keys()] }),
  chooseDamageAssignmentOrder: (i) => ({ type: "damageAssignmentOrderDecision", orderedBlockerIds: i.blockerIds }),
  scry: (i) => ({ type: "scryDecision", zoneCardIds: i.zones.map((_, k) => (k === Math.max(0, i.zones.indexOf("libraryTop")) ? i.cards.map((c) => c.id) : [])) }),
};
function deckOf(id) {
  const f = DECK_DIRS.map((d) => path.join(d, `${id}.json`)).find((x) => fs.existsSync(x));
  if (!f) throw new Error(`no deck ${id}`);
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  const deck = [];
  for (const e of p.cards) for (let k = 0; k < (e.count || 1); k++) deck.push({ name: e.name, setCode: e.set || undefined, collectorNumber: e.cardNumber ? String(e.cardNumber) : undefined });
  return { deck, commanderNames: p.commander ? [p.commander] : [] };
}
function server() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-scenarios-"));
  const c = spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", tmp, "-cp", JAR, path.join(ROOT, "engine", "checks", "HeadlessGameServer.java")], { encoding: "utf8" });
  if (c.status !== 0) throw new Error(`HeadlessGameServer doesn't compile: ${c.stderr}`);
  const p = spawn("java", ["-Xmx4g", "-cp", [tmp, JAR].join(path.delimiter), "forge.harness.host.HeadlessGameServer", "forge/forge-gui/"], { cwd: TREE, stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: p.stdout });
  const waiting = [];
  lines.on("line", (l) => { let o; try { o = JSON.parse(l); } catch { return; } const w = waiting.shift(); if (w) w(o); }); // (a non-JSON line is the JVM's noise)
  let err = "";
  p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
  // (the JVM dying mid-scenario: an ask() would wait forever)
  p.on("exit", (c) => { if (waiting.length) { console.error(`the engine server exited ${c} mid-scenario:\n${err}`); process.exit(1); } });
  p.on("error", (e) => { console.error(`the engine server didn't start: ${e.message}`); process.exit(1); });
  const ask = (line) => new Promise((resolve) => { waiting.push(resolve); p.stdin.write(`${line}\n`); });
  const ready = new Promise((resolve) => waiting.push(resolve));
  return { ask, ready, quit: () => { try { p.stdin.write("quit\n"); } catch {} REAL.setTimeout(() => p.kill(), 2000); } };
}
const sleep = (ms) => new Promise((r) => REAL.setTimeout(r, ms));
const handOf = (gv, slot) => (gv.zones || []).find((z) => z.zone === "hand" && z.ownerId === slot) || { cards: [], count: 0 };

async function play(s, name) {
  const plan = PLAN[name] || {};
  const rec = { scenario: name, scenarioFile: JSON.parse(fs.readFileSync(path.join(ROOT, "scenarios", `${name}.json`), "utf8")), steps: [], problems: [] };
  const T2 = plan.table === "2hg", A4 = plan.table === "arch4";
  const HOST = T2 || A4 ? "White" : "Blue";
  const SCHEMES = (() => { const j = require(path.join(ROOT, "bridge", "forge-schemes.json")); return [...j.schemes, ...(j.ongoing || [])].slice(0, 20); })();
  const players = T2 || A4
    ? [["White", "neheb_minotaur_commander", false, 1], ["Red", "ashling_limitless_commander", true, T2 ? 1 : 2], ["Yellow", "ramses_commander", true, 2], ["Blue", "real_teval_commander", true, 2]]
      .map(([n, d, ai, team]) => ({ name: n, ...deckOf(d), team, ...(ai ? { ai: true, bot: true } : {}),
        ...(A4 && n === "White" ? { startingLife: 80, goesFirst: true, schemes: SCHEMES.map((x) => ({ name: x })) } : {}) }))
    : [{ name: "Blue", ...deckOf("neheb_minotaur_commander") }, { name: "AI", ...deckOf("ashling_limitless_commander"), ai: true, bot: true }];
  const h0 = await s.ask(`start ${JSON.stringify({ gameId: `check-${name}`, variant: "Commander", startingLife: 40, seed: 7, snapshotRecording: !!plan.snapshots,
    ...(T2 ? { teamRules: "sharedTurns" } : {}), ...(A4 ? { teamRules: "teams", archenemy: true } : {}), players })}`);
  if (h0.status !== "ok") { rec.problems.push(`start: ${h0.value.split("\n")[0]}`); return rec; }
  const view = async () => { const v = await s.ask("snapshot 0"); return v.status === "ok" && v.value ? JSON.parse(v.value) : null; };
  const promptNow = async () => { const p = await s.ask("prompt"); return p.value ? JSON.parse(p.value) : null; };
  const submit = async (a) => { const r = await s.ask(`submit ${JSON.stringify(a)}`); if (r.status !== "ok") rec.problems.push(`submit refused: ${r.value.split("\n")[0]}`); };
  // the next question for Blue that isn't the last one answered (the engine asks only Blue: the AI answers itself)
  let lastId = null;
  const next = async (ms = 60000) => {
    const t0 = REAL.now();
    while (REAL.now() - t0 < ms) {
      const err = await s.ask("error");
      if (err.value) { rec.problems.push(`engine error: ${err.value.split("\n")[0]}`); return null; }
      const p = await promptNow();
      if (p && p.promptId !== lastId) { lastId = p.promptId; return p; }
      // (the game over: an end, not a problem; the last board kept)
      if ((await s.ask("over")).value === "true") { rec.over = true; return null; }
      await sleep(20);
    }
    rec.problems.push("no new question in time");
    return null;
  };
  const h = harness.load();
  try {
    const seat = new h.B.Seat(HOST, "neheb_minotaur_commander");
    seat.slot = "player-0";
    seat.heartbeat = () => {};
    // (playerOrder: the engine's player names, as the relay's usernames in a real game: the bridge reads the payer of a
    // trigger on the stack from Forge's "[Player: Blue]", stackPayer)
    const T2GAME = { playerOrder: ["White", "Red", "Yellow", "Blue"], bots: 3, total: 4,
      slotNames: { "player-0": "White", "player-1": "AI 1", "player-2": "AI 2", "player-3": "AI 3" }, slotColor: { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" },
      teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2hg", teamTurns: "shared" };
    const A4GAME = { ...T2GAME, teams: { White: 1, Red: 2, Yellow: 2, Blue: 2 }, teamMode: "archenemy", teamTurns: null, arch: { color: "White", schemes: SCHEMES } };
    h.B._setGame({ seats: new Map([[HOST, seat]]), bots: 1, total: 2, playerOrder: ["Blue", "AI"], slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
      ...(T2 ? T2GAME : A4 ? A4GAME : {}), started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
    const toBridge = async (p) => {
      const gv = await view();
      seat.board = { state: { gameView: gv }, fingerprint: null };
      const n0 = h.effects.length;
      // (the engine's runaway question has the bridge's own expiry timer, and the harness's flush runs every timer at
      // once: only the first few here, so the click comes before it, as a player's would)
      h.B.onPrompt(seat, p); await h.flush(String(p.input?.presentation?.title || "") === "This turn passed the engine's limit" ? 2 : 400);
      const shown = h.effects.slice(n0).filter((e) => e.tts?.t === "prompt" && e.tts.color === HOST && e.tts.promptId != null).map((e) => e.tts).pop() || null;
      const sent = h.effects.slice(n0).map((e) => e.relay?.state).filter((x) => x?.kind === "response" && x.promptId === p.promptId).map((x) => x.action).pop() || null;
      return { gv, shown, sent };
    };
    // ── to Blue's first main phase, nothing on the stack: keep the hand, pass ──
    let p;
    for (;;) {
      p = await next();
      if (!p) return rec;
      const gv = await view();
      const type = p.input?.type;
      // (Archenemy: a board with a scheme in a command zone, its set-in-motion trigger on the stack before the setup,
      // kept for the bridge: tests/test_bridge_scenario_checks.js sends it first, as the table's seat would have had it)
      if ((gv.zones || []).some((z) => z.zone === "command" && (z.cards || []).some((c) => (c.types || []).includes("Scheme"))) && !rec.schemeBoards) rec.schemeBoards = [{ gameView: gv }];
      if (type === "mulligan") { await submit({ type, output: { type: "mulliganDecision", keep: true } }); continue; }
      if (type === "chooseAction" && gv.activePlayerId === "player-0" && gv.step === "main1" && !(gv.stack || []).length) break;
      if (type === "chooseAction") { await submit({ type, output: { type: "pass" } }); continue; }
      if (type === "mulliganPutBack") { await submit({ type, output: { type: "mulliganPutBackDecision", cardIds: p.input.handCardIds.slice(0, p.input.count) } }); continue; }
      // (the AI's turn shows Blue what it reveals, and asks a "may" now and then: seen, and no)
      if (type === "revealCards") { await submit({ type, output: { type: "revealCardsAcknowledged" } }); continue; }
      if (type === "chooseBoolean") { await submit({ type, output: { type: "decision", value: false } }); continue; }
      if (type === "chooseCards") { await submit({ type, output: { type: "chooseCardsDecision", chosenCardIds: p.input.cards.slice(0, p.input.min).map((c) => c.id) } }); continue; }
      const plain = BEFORE[type] && BEFORE[type](p.input);
      if (plain) { await submit({ type, output: plain }); continue; }
      rec.problems.push(`before the setup, an unexpected question: ${type}`); return rec;
    }
    // ── the setup: "mtg debug <name>" through the bridge, its applyState to the engine ──
    const before = await toBridge(p);
    const n0 = h.effects.length;
    h.B.onTTS({ t: "debug", json: JSON.stringify({ color: HOST, scenario: name }) }); await h.flush();
    const directive = h.effects.slice(n0).map((e) => e.relay?.state?.directive).find((d) => d?.type === "applyState");
    rec.chats = h.effects.slice(n0).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
    if (!directive) { rec.problems.push(`the bridge sent no applyState: ${rec.chats.join(" | ")}`); return rec; }
    rec.ops = directive.ops;
    rec.steps.push({ kind: "setup", board: { gameView: before.gv }, prompt: p });
    await submit({ kind: "apply_state", fixId: directive.fixId, ops: directive.ops });
    let after = null;
    for (let t = 0; t < 300 && !after; t++) { const gv = await view(); if (gv?.stateFix?.fixId === directive.fixId) after = gv; else await sleep(50); }
    if (!after) { rec.problems.push("the engine never answered the applyState"); return rec; }
    if (!after.stateFix.applied) { rec.problems.push(`refused: ${after.stateFix.message || JSON.stringify(after.stateFix)}`); return rec; }
    rec.steps.push({ kind: "applied", board: { gameView: after } });
    if (!plan.cast && !plan.until && !plan.untilTurn) return rec;
    // ── the cast: the engine's own cast action, auto pay; then every question through the bridge ──
    if (plan.cast) {
      p = await next();
      const act = (p?.input?.actions || []).find((a) => a.type === "cast" && new RegExp(`^Cast ${plan.cast}\\b`, "i").test(a.label || ""));
      if (!act) { rec.problems.push(`no "Cast ${plan.cast}" action: ${(p?.input?.actions || []).map((a) => a.label).join(" | ")}`); return rec; }
      await submit({ type: "chooseAction", output: { type: "act", actionId: act.id } });
      rec.steps.push({ kind: "cast", prompt: p, actionId: act.id });
    } else lastId = null; // (until: the setup's own priority question is asked again, and goes through the bridge)
    let reached = false; // (until: the question was shown and answered; then on to the end of that combat step)
    const clicks = [...(plan.click || [])];
    for (let k = 0; k < (plan.until || plan.untilTurn || plan.untilUnbounded ? 1500 : 60); k++) {
      p = await next();
      if (!p && rec.over) break;
      if (!p) return rec;
      const { gv, shown, sent } = await toBridge(p);
      const step = { kind: "bridge", board: { gameView: gv }, prompt: p, shown: shown ? { title: shown.title, options: (shown.options || []).map((o) => o.label) } : null };
      // (the end: the run said in chat and the stack empty, or Blue asked for priority with nothing on the stack)
      const ranOut = h.effects.some((e) => e.tts?.t === "chat" && / answered (?:No|Yes) to /.test(e.tts.text || "")) && !(gv.stack || []).length;
      // (until: the end is the first priority question after the combat's damage, the stack empty)
      const untilDone = plan.until && reached && !(gv.stack || []).length && p.input?.type === "chooseAction" && !/^combatDeclare/.test(gv.step || "");
      // (untilTurn: that turn has begun; untilUnbounded: a card the engine stopped counting is on the battlefield, and
      // the stack empty or the engine's runaway question answered)
      const turnDone = plan.untilTurn && gv.turn >= plan.untilTurn;
      const anyUnbounded = (gv.zones || []).some((z) => (z.cards || []).some((c) => c.unbounded));
      if (anyUnbounded && !rec.sawUnbounded) step.firstUnbounded = true;
      if (anyUnbounded) rec.sawUnbounded = true;
      // (key: a step answered by the bridge alone, and not the first unbounded board, keeps no board and a short prompt)
      if (plan.key && !shown && !step.firstUnbounded) { delete step.board; step.prompt = { promptId: p.promptId, input: { type: p.input?.type, presentation: p.input?.presentation } }; }
      const unbDone = plan.untilUnbounded && rec.sawUnbounded && (!(gv.stack || []).length || rec.runawayAnswered);
      const end = plan.until ? untilDone : plan.untilTurn ? turnDone : plan.untilUnbounded ? unbDone : (ranOut || (shown && !(gv.stack || []).length && p.input?.type === "chooseAction"));
      if (end) { step.end = true; step.board = { gameView: gv }; if (sent) step.sent = sent; rec.steps.push(step); break; }
      if (sent) { step.sent = sent; rec.steps.push(step); await submit(sent); continue; }
      if (!shown) { rec.problems.push(`question ${p.input?.type} neither shown nor answered by the bridge`); rec.steps.push(step); return rec; }
      // (a click on the table: the planned option when there is one, else the first; a priority question passes)
      const ids = (h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.promptId === p.promptId).pop()?.tts.options || []).map((o) => o.id);
      // (an attack question: no attacks, so the host's blockers stay untapped)
      const pick = clicks.length && ids.includes(clicks[0]) ? clicks.shift() : p.input?.type === "chooseAction" ? (ids.find((i) => /pass/i.test(i)) || ids[0])
        : p.input?.type === "chooseAttackers" && ids.includes("__noattack") ? "__noattack" : ids[0];
      if (plan.until && p.input?.type === plan.until) reached = true;
      if (String(p.input?.presentation?.title || "") === "This turn passed the engine's limit") { rec.runawayAnswered = true; (rec.runaway ??= []).push({ title: shown.title, options: (shown.options || []).map((o) => o.label), click: pick }); }
      step.click = pick;
      const n1 = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: HOST, promptId: p.promptId, choice: [pick] }) }); await h.flush();
      const ans = h.effects.slice(n1).map((e) => e.relay?.state).filter((x) => x?.kind === "response" && x.promptId === p.promptId).map((x) => x.action).pop();
      step.sent = ans || null;
      step.chats = h.effects.slice(n1).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
      rec.steps.push(step);
      if (!ans) { rec.problems.push(`the click ${pick} sent no answer`); return rec; }
      await submit(ans);
    }
    rec.chatsAfter = h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text).filter((t) => / answered /.test(t));
    rec.chatsAll = h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
    if (plan.until) {
      if (!reached) rec.problems.push(`the bridge never showed ${plan.until}`);
      if (rec.over) rec.overSaid = h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text).slice(-3);
    }
    rec.final = { gameView: await view() };
    if (rec.over && !plan.until) rec.problems.push("the game ended");
    return rec;
  } finally { harness.restore(); await s.ask("end"); }
}

(async () => {
  if (!fs.existsSync(JAR)) { console.log(`no harness jar at ${JAR}`); process.exit(2); }
  const s = server();
  await s.ready;
  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  let bad = 0;
  for (const name of NAMES) {
    const rec = await play(s, name);
    out[name] = rec;
    const hand = rec.steps.find((x) => x.kind === "applied") ? handOf(rec.steps.find((x) => x.kind === "applied").board.gameView, "player-0").count : null;
    console.log(`${name}: ${rec.steps.length} steps, hand after the setup ${hand}; ${rec.problems.length ? rec.problems.join(" | ") : "no problems"}`);
    for (const st of rec.steps.filter((x) => x.kind === "bridge")) console.log(`  ${st.prompt.input?.type} ${st.shown ? `shown "${st.shown.title}" [${st.shown.options.join(" / ")}]` : "answered by the bridge"}${st.click ? ` click ${st.click}` : ""} -> ${JSON.stringify(st.sent?.output || null).slice(0, 80)}`);
    for (const c of rec.chatsAfter || []) console.log(`  chat: ${c}`);
    bad += rec.problems.length;
  }
  s.quit();
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`${bad ? `${bad} problem(s)` : "no problems"} -> ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes)`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log(`FAIL check-scenarios: ${e.stack}`); process.exit(2); });
