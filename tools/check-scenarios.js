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
// per scenario: the spell Blue casts after the setup, and which option Blue clicks on the bridge's questions after it
const PLAN = {
  "hand-overflow": {},
  "repeat-yesno": { cast: "Hordeling Outburst", click: ["__repeat:no"] },
  "repeat-yesno-pay": { cast: "Harmonize", click: ["__repeat:no"] },
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
  lines.on("line", (l) => { const w = waiting.shift(); if (w) w(JSON.parse(l)); });
  p.stderr.on("data", () => {});
  const ask = (line) => new Promise((resolve) => { waiting.push(resolve); p.stdin.write(`${line}\n`); });
  const ready = new Promise((resolve) => waiting.push(resolve));
  return { ask, ready, quit: () => { try { p.stdin.write("quit\n"); } catch {} REAL.setTimeout(() => p.kill(), 2000); } };
}
const sleep = (ms) => new Promise((r) => REAL.setTimeout(r, ms));
const handOf = (gv, slot) => (gv.zones || []).find((z) => z.zone === "hand" && z.ownerId === slot) || { cards: [], count: 0 };

async function play(s, name) {
  const plan = PLAN[name] || {};
  const rec = { scenario: name, scenarioFile: JSON.parse(fs.readFileSync(path.join(ROOT, "scenarios", `${name}.json`), "utf8")), steps: [], problems: [] };
  const h0 = await s.ask(`start ${JSON.stringify({ gameId: `check-${name}`, variant: "Commander", startingLife: 40, seed: 7, snapshotRecording: false,
    players: [{ name: "Blue", ...deckOf("neheb_minotaur_commander") }, { name: "AI", ...deckOf("ashling_limitless_commander"), ai: true, bot: true }] })}`);
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
      await sleep(20);
    }
    rec.problems.push("no new question in time");
    return null;
  };
  const h = harness.load();
  try {
    const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
    seat.slot = "player-0";
    seat.heartbeat = () => {};
    // (playerOrder: the engine's player names, as the relay's usernames in a real game: the bridge reads the payer of a
    // trigger on the stack from Forge's "[Player: Blue]", stackPayer)
    h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["Blue", "AI"], slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
      started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
    const toBridge = async (p) => {
      const gv = await view();
      seat.board = { state: { gameView: gv }, fingerprint: null };
      const n0 = h.effects.length;
      h.B.onPrompt(seat, p); await h.flush();
      const shown = h.effects.slice(n0).filter((e) => e.tts?.t === "prompt" && e.tts.color === "Blue" && e.tts.promptId != null).map((e) => e.tts).pop() || null;
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
    h.B.onTTS({ t: "debug", json: JSON.stringify({ color: "Blue", scenario: name }) }); await h.flush();
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
    if (!plan.cast) return rec;
    // ── the cast: the engine's own cast action, auto pay; then every question through the bridge ──
    p = await next();
    const act = (p?.input?.actions || []).find((a) => a.type === "cast" && new RegExp(`^Cast ${plan.cast}\\b`, "i").test(a.label || ""));
    if (!act) { rec.problems.push(`no "Cast ${plan.cast}" action: ${(p?.input?.actions || []).map((a) => a.label).join(" | ")}`); return rec; }
    await submit({ type: "chooseAction", output: { type: "act", actionId: act.id } });
    rec.steps.push({ kind: "cast", prompt: p, actionId: act.id });
    const clicks = [...(plan.click || [])];
    for (let k = 0; k < 60; k++) {
      p = await next();
      if (!p) return rec;
      const { gv, shown, sent } = await toBridge(p);
      const step = { kind: "bridge", board: { gameView: gv }, prompt: p, shown: shown ? { title: shown.title, options: (shown.options || []).map((o) => o.label) } : null };
      // (the end: the run said in chat and the stack empty, or Blue asked for priority with nothing on the stack)
      const ranOut = h.effects.some((e) => e.tts?.t === "chat" && / answered (?:No|Yes) to /.test(e.tts.text || "")) && !(gv.stack || []).length;
      if (ranOut || (shown && !(gv.stack || []).length && p.input?.type === "chooseAction")) { step.end = true; if (sent) step.sent = sent; rec.steps.push(step); break; }
      if (sent) { step.sent = sent; rec.steps.push(step); await submit(sent); continue; }
      if (!shown) { rec.problems.push(`question ${p.input?.type} neither shown nor answered by the bridge`); rec.steps.push(step); return rec; }
      // (a click on the table: the planned option when there is one, else the first; a priority question passes)
      const ids = (h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.promptId === p.promptId).pop()?.tts.options || []).map((o) => o.id);
      const pick = clicks.length && ids.includes(clicks[0]) ? clicks.shift() : p.input?.type === "chooseAction" ? (ids.find((i) => /pass/i.test(i)) || ids[0]) : ids[0];
      step.click = pick;
      const n1 = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: p.promptId, choice: [pick] }) }); await h.flush();
      const ans = h.effects.slice(n1).map((e) => e.relay?.state).filter((x) => x?.kind === "response" && x.promptId === p.promptId).map((x) => x.action).pop();
      step.sent = ans || null;
      step.chats = h.effects.slice(n1).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
      rec.steps.push(step);
      if (!ans) { rec.problems.push(`the click ${pick} sent no answer`); return rec; }
      await submit(ans);
    }
    rec.chatsAfter = h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text).filter((t) => / answered /.test(t));
    rec.final = { gameView: await view() };
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
