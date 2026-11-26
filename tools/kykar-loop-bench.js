// Where the time of a long loop goes, measured headless (no relay, no node, no TTS): the Kykar + Hullbreaker Horror +
// Sol Ring + Sensei's Divining Top + Third Path Iconoclast loop of tmp/stress/kykar-loop.js, played by Blue against a
// Forge AI through ManaBrewEngineAdapter (engine/checks/HeadlessGameServer.java) in a harness-test image, with --tokens
// extra Soldier tokens on Blue's side from the start. For each question Blue gets it times:
//   game: from the answer sent to the next question (the game thread: Forge, the AI, the question built),
//   snap: one snapshot for Blue plus one for observers (the node builds both twice a question: at the new revision and
//         with the question, java_backend.rs run_hosted_engine_game_inner),
// and the game thread is sampled every 2 ms ("profile": idle / ai / harness:<method> / forge:*).
//   node tools/kykar-loop-bench.js [--image mtg-harness-test:<tag>] [--tokens 150] [--token <script>] [--passes 10] [--held]
//     [--cards "Monastery Mentor,..."] [--opponent person]
// --held: a priority with the stack's top items one run of the same trigger (or the whole stack a run of five or
// more, as the stress driver did) is passed with exhaustStack, to time a held pass. --cards: more cards on Blue's
// battlefield. --opponent person: the second seat is a person (every one of its questions answered here like Blue's,
// its passes held the same way) instead of a Forge AI, so the engine may batch a held run (StackMerge: only when
// every player still in the game holds). Prints JSON at the end.
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const IMAGE = arg("image", "mtg-harness-test:eb-07211d1b4974");
const TOKENS = Number(arg("tokens", 150));
const PASSES = Number(arg("passes", 10));
const HELD = process.argv.includes("--held");
const TOKEN = arg("token", "c_1_1_a_soldier");
const CARDS = String(arg("cards", "")).split(",").map((x) => x.trim()).filter(Boolean);
const PERSON = arg("opponent", "ai") === "person";
const ROOT = path.join(__dirname, "..");
const now = () => Number(process.hrtime.bigint()) / 1e6;

function deckOf(id) {
  const f = require("../bridge/presets").presetFile(id);
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  const deck = [];
  for (const e of p.cards) for (let k = 0; k < (e.count || 1); k++) deck.push({ name: e.name, setCode: e.set || undefined, collectorNumber: e.cardNumber ? String(e.cardNumber) : undefined });
  return { deck, commanderNames: p.commander ? [p.commander] : [] };
}

function server() {
  const checks = path.join(ROOT, "engine", "checks");
  const jar = "/build/forge-harness/target/forge-harness-jar-with-dependencies.jar";
  const sh = `mkdir -p /tmp/c && javac -nowarn -encoding UTF-8 -proc:none -d /tmp/c -cp ${jar} /checks/HeadlessGameServer.java && cd /build && exec java -Xmx3g -cp /tmp/c:${jar} forge.harness.host.HeadlessGameServer forge/forge-gui/`;
  const p = spawn("docker", ["run", "-i", "--rm", "--cpus", "2", "-v", `${checks}:/checks:ro`, "--entrypoint", "sh", IMAGE, "-c", sh],
    { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const lines = readline.createInterface({ input: p.stdout });
  const waiting = [];
  lines.on("line", (l) => { const w = waiting.shift(); if (w) w(JSON.parse(l)); });
  let err = "";
  p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
  p.on("exit", (c) => { if (waiting.length) { console.error(`server exited ${c}: ${err}`); process.exit(1); } });
  const ask = (line) => new Promise((resolve) => { waiting.push(resolve); p.stdin.write(`${line}\n`); });
  const ready = new Promise((resolve) => waiting.push(resolve));
  return { ask, ready, quit: () => { try { p.stdin.write("quit\n"); } catch {} setTimeout(() => p.kill(), 2000); } };
}

const BEFORE = {
  diceRolled: () => ({ type: "diceRolledAcknowledged" }),
  chooseBlockers: () => ({ type: "declareBlockers", assignments: [] }),
  chooseAttackers: () => ({ type: "declareAttackers", assignments: [] }),
  reorder: (i) => ({ type: "reorderDecision", orderedIds: i.items.map((x) => x.id) }),
  chooseNumber: (i) => ({ type: "numberDecision", chosenNumber: i.min }),
  revealCards: () => ({ type: "revealCardsAcknowledged" }),
  chooseBoolean: () => ({ type: "decision", value: false }),
  chooseCards: (i) => ({ type: "chooseCardsDecision", chosenCardIds: i.cards.slice(0, i.min).map((c) => c.id) }),
  mulligan: () => ({ type: "mulliganDecision", keep: true }),
  mulliganPutBack: (i) => ({ type: "mulliganPutBackDecision", cardIds: i.handCardIds.slice(0, i.count) }),
  scry: (i) => ({ type: "scryDecision", zoneCardIds: i.zones.map((_, k) => (k === Math.max(0, i.zones.indexOf("libraryTop")) ? i.cards.map((c) => c.id) : [])) }),
};

async function main() {
  const s = server();
  await s.ready;
  const SLOT = "player-0";
  const h = await s.ask(`start ${JSON.stringify({ gameId: "kykar-bench", variant: "Commander", startingLife: 40, seed: 7,
    players: [{ name: "Blue", ...deckOf("kykar_winds_fury") }, PERSON ? { name: "Yellow", ...deckOf("ashling_limitless_commander") } : { name: "AI", ...deckOf("ashling_limitless_commander"), ai: true, bot: true }] })}`);
  if (h.status !== "ok") throw new Error(`start: ${h.value}`);
  const view = async () => { const v = await s.ask(`snapshot 0`); return v.status === "ok" && v.value ? JSON.parse(v.value) : null; };
  let lastId = null, sentAt = 0;
  const next = async () => {
    for (;;) {
      const p = await s.ask("prompt");
      if (p.value) { const q = JSON.parse(p.value); if (q.promptId !== lastId) { lastId = q.promptId; return q; } }
      const e = await s.ask("error");
      if (e.value) throw new Error(`engine error: ${e.value.split("\n").slice(0, 6).join(" | ")}`);
      if ((await s.ask("over")).value === "true") return null;
    }
  };
  const submit = async (type, output) => { sentAt = now(); const r = await s.ask(`submit ${JSON.stringify({ type, output })}`); if (r.status !== "ok") throw new Error(`refused: ${r.value}`); };
  let p, gv;
  for (;;) {
    p = await next();
    if (!p) throw new Error("the game ended before the setup");
    gv = await view();
    const type = p.input?.type;
    if (type === "chooseAction" && p.decidingPlayerId === SLOT && gv.activePlayerId === SLOT && gv.step === "main1" && !(gv.stack || []).length) break;
    if (type === "chooseAction") { await submit(type, { type: "pass" }); continue; }
    if (BEFORE[type]) { await submit(type, BEFORE[type](p.input)); continue; }
    throw new Error(`before the setup: ${type}`);
  }
  const hand = (gv.zones || []).find((z) => z.zone === "hand" && z.ownerId === SLOT)?.cards || [];
  const ops = [
    ...["Island", "Island", "Mountain", "Plains", "Kykar, Wind's Fury", "Hullbreaker Horror", "Sol Ring", "Third Path Iconoclast", ...CARDS].map((name) => ({ op: "createCard", name, zone: "battlefield", player: SLOT })),
    ...["Sensei's Divining Top", "Crackle with Power"].map((name) => ({ op: "createCard", name, zone: "hand", player: SLOT })),
    ...hand.map((c) => ({ op: "move", card: c.id, zone: "library", position: "bottom" })),
    ...Array.from({ length: TOKENS }, () => ({ op: "createToken", script: TOKEN, player: SLOT })),
  ];
  await s.ask(`submit ${JSON.stringify({ kind: "apply_state", fixId: 1, ops })}`);
  for (let t = 0; t < 600; t++) { gv = await view(); if (gv?.stateFix?.fixId === 1) break; await new Promise((r) => setTimeout(r, 50)); }
  if (!gv?.stateFix?.applied) throw new Error(`setup refused: ${JSON.stringify(gv?.stateFix)}`);

  const bf = () => (gv.zones || []).filter((z) => z.zone === "battlefield").flatMap((z) => z.cards || []).filter((c) => (c.controllerId || c.ownerId) === SLOT);
  const named = (n) => bf().find((c) => c.identity?.name === n);
  const inHand = (n) => ((gv.zones || []).find((z) => z.zone === "hand" && z.ownerId === SLOT)?.cards || []).some((c) => c.identity?.name === n);
  const tokens = () => bf().filter((c) => c.identity?.isToken).length;
  await s.ask("profile");
  const rows = [];
  let passes = -1, passStart = 0, held = 0;
  const passLog = [];
  lastId = null;
  for (;;) {
    p = await next();
    if (!p) break;
    const game = sentAt ? now() - sentAt : 0;
    const t0 = now();
    gv = await view();
    const t1 = now();
    await s.ask("snapshot -1");
    const snap = t1 - t0 + (now() - t1);
    const input = p.input || {};
    const type = input.type;
    rows.push({ type, game, snap, stack: (gv.stack || []).length });
    const stack = gv.stack || [];
    const act = (a) => submit("chooseAction", { type: "act", actionId: a.id });
    if (String(input.presentation?.title || "") === "This turn passed the engine's limit") { await submit(type, { type: "decision", value: true }); continue; }
    if (type === "chooseAction" && stack.length) {
      const key = (x) => `${x.controllerId}|${x.identity?.name}|${x.sourceAbilityText || ""}`;
      let top = 0;
      while (top < stack.length && key(stack[stack.length - 1 - top]) === key(stack[stack.length - 1])) top++;
      const run = HELD && top >= 5;
      if (run) held++;
      await submit(type, run ? { type: "pass", exhaustStack: true } : { type: "pass" });
      continue;
    }
    if (type === "chooseAction" && p.decidingPlayerId !== SLOT) { await submit(type, { type: "pass" }); continue; }
    if (type === "chooseAction" && gv.activePlayerId === SLOT && /main/.test(gv.step || "")) {
      const acts = input.actions || [];
      const sac = acts.find((x) => /Sacrifice a Spirit/i.test(x.description || x.label || ""));
      if (sac) { await act(sac); continue; }
      const sol = named("Sol Ring");
      if (sol && !sol.tapped) { const a = acts.find((x) => x.id.startsWith(`tap:${sol.id}:`)); if (a) { await act(a); continue; } }
      if (inHand("Sensei's Divining Top")) {
        if (passes >= 0) passLog.push({ pass: passes, ms: now() - passStart, prompts: rows.length, tokens: tokens() });
        passes++;
        if (passes >= PASSES) break;
        passStart = now();
        const a = acts.find((x) => x.type === "cast" && /Sensei's Divining Top/.test(x.label || ""));
        if (a) { await act(a); continue; }
      }
      if (inHand("Sol Ring")) { const a = acts.find((x) => x.type === "cast" && /Sol Ring/.test(x.label || "")); if (a) { await act(a); continue; } }
      throw new Error(`stuck: ${acts.map((a) => a.label).join(" | ").slice(0, 600)}`);
    }
    if (type === "payManaCost") { await submit(type, { type: "pay", auto: !input.canConfirmFromPool }); continue; }
    if (type === "chooseFromSelection") {
      const opts = input.options || [];
      const i = opts.findIndex((o) => /nonland permanent/i.test(o.label || o.text || JSON.stringify(o)));
      await submit(type, { type: "selectionDecision", chosenIndices: [i >= 0 ? i : 0] });
      continue;
    }
    if (type === "chooseBoardTargets") {
      const cands = input.candidates || [];
      const all = (gv.zones || []).flatMap((z) => z.cards || []);
      const name = (c) => all.find((x) => x.id === c.id)?.identity?.name;
      if (/^Sacrifice/i.test(String(input.presentation?.title || ""))) { const k = Math.max(1, Number(input.minTargets) || 0); await submit(type, { type: "boardTargets", chosen: cands.slice(0, k).map((c) => ({ kind: c.kind, id: c.id })) }); continue; }
      const want = cands.find((c) => name(c) === "Sol Ring") || cands.find((c) => name(c) === "Sensei's Divining Top") || cands[0];
      await submit(type, { type: "boardTargets", chosen: want ? [{ kind: want.kind, id: want.id }] : [] });
      continue;
    }
    if (type === "chooseAction") { await submit(type, { type: "pass" }); continue; }
    if (BEFORE[type]) { await submit(type, BEFORE[type](input)); continue; }
    throw new Error(`unhandled ${type}`);
  }
  const prof = JSON.parse((await s.ask("profile")).value);
  s.quit();
  const sum = (k, f = () => true) => rows.filter(f).reduce((a, r) => a + r[k], 0);
  const out = {
    tokens: TOKENS, token: TOKEN, cards: CARDS, opponent: PERSON ? "person" : "ai", passes: passLog.length, held, prompts: rows.length,
    promptsPerPass: rows.length / Math.max(1, passes),
    msPerPass: passLog.length ? passLog.slice(1).reduce((a, x) => a + x.ms, 0) / Math.max(1, passLog.length - 1) : null,
    gameMs: Math.round(sum("game")), snapMs: Math.round(sum("snap")),
    gameMsPerPrompt: +(sum("game") / rows.length).toFixed(1), snapMsPerPrompt: +(sum("snap") / rows.length).toFixed(1),
    byType: Object.fromEntries([...new Set(rows.map((r) => r.type))].map((t) => [t, { n: rows.filter((r) => r.type === t).length,
      game: Math.round(sum("game", (r) => r.type === t)), snap: Math.round(sum("snap", (r) => r.type === t)) }])),
    profile: { samples: prof.samples, buckets: Object.fromEntries(Object.entries(prof.buckets).sort((a, b) => b[1] - a[1]).slice(0, 30)), top: prof.top },
  };
  console.log(JSON.stringify(out, null, 1));
  setTimeout(() => process.exit(0), 2500);
}
main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
