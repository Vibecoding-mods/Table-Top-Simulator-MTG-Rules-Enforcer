// Bug-hunting autoplay for the engine table: plays White like a person would (drag lands and spells onto the
// battlefield, drag discards to the graveyard, use the panel for everything else), runs tools/tts-check.lua
// after every few actions, and reports TTS errors, stuck prompts and table/engine mismatches.
//   node tts-autoplay2.js [stopAtGameTurn] [maxSteps]
const fs = require("fs"), path = require("path");
const C = process.env.AP_COLOR || "White"; // the seat it plays
const BRIDGE_PORT = process.env.BRIDGE_PORT || 48787; // 48788 for the headless TTS (tests/lua/headless-tts.js)
const STOP = Number(process.argv[2] || 14), MAX = Number(process.argv[3] || 600);
const tools = __dirname;
const exec = async (lua) => {
  const r = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/exec`, { method: "POST", body: lua, signal: AbortSignal.timeout(60000) }).then((x) => x.json());
  for (const l of r.console || []) if (l.includes("ERROR")) report.errors.push(l.slice(0, 300));
  return r.value;
};
const state = () => fetch(`http://127.0.0.1:${BRIDGE_PORT}/state`).then((x) => x.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { recent: [], steps: 0, drags: 0, refused: 0, errors: [], problems: [], stuck: [], prompts: {}, lastTurn: 0 };
const rnd = (a, b) => a + Math.random() * (b - a);

let lastProblems = new Map(), reported = new Set();
const tries = {}; // "turn:cardId" -> drags of that card this turn
async function check(tag) {
  // a player takes held draws/mills/untaps by hand; do that first so the table matches the engine
  const released = await exec(`return tostring(engineReleasePending ~= nil and engineReleasePending("${C}", "all"))`);
  if (released === "true") await sleep(1200); // the released cards are moved/spawned over the next frames
  const v = await exec(fs.readFileSync(path.join(tools, "tts-check.lua"), "utf8"));
  if (!v) return;
  const r = JSON.parse(v);
  // A mismatch counts only when the next check still sees it: right after a move the table can be mid-way (a
  // dragged card waits where it was dropped while the engine asks how to pay; a pile is redrawn within a second).
  // The ones that cleared by themselves are counted in report.transient.
  const key = (p) => p.replace(/\s*\[obj=.*$/, "").replace(/ at \([^)]*\)/, "");
  const now = new Map((r.problems || []).map((p) => [key(p), p]));
  for (const [k, p] of now) if (lastProblems.has(k) && !reported.has(k)) { reported.add(k); report.problems.push(`turn ${r.turn} ${r.step} [${tag}]: ${p}`); }
  for (const k of lastProblems.keys()) if (!now.has(k) && !reported.has(k)) report.transient = (report.transient || 0) + 1;
  lastProblems = now;
  if (report.problems.length && !report.firstProblemAt) { report.firstProblemAt = `turn ${r.turn} ${r.step} [${tag}] after: ${report.recent.join(" > ")}`; }
  return r;
}

async function drag(cardId, area) {
  const where = area === "graveyard" ? `local g = data.${C}.graveyard.getPosition() local pos = Vector(g.x, 1.5, g.z)`
    : C === "White" ? `local pos = Vector(${rnd(6, 33).toFixed(1)}, 1.5, ${rnd(-21, -8).toFixed(1)})`
    // other seats: from the hand toward the table centre, onto that player's battlefield
    : `local h = Player["${C}"].getHandTransform().position local d = Vector(-h.x, 0, -h.z):normalized() local pos = h + d * ${rnd(11, 17).toFixed(1)} + Vector(0, 1.5, 0)`;
  report.drags++;
  return exec(`${where} local o = simFind(function(o) return o.getGMNotes() == "engine:${cardId}" end)
if o == nil then return "missing" end simDrop("${C}", o, pos) return "dropped"`);
}

(async () => {
  await exec(fs.readFileSync(path.join(tools, "tts-sim.lua"), "utf8"));
  await exec(`local old = engineRender function engineRender(m) debugTable = m lastTableTurn = m.turn return old(m) end return "hooked"`);
  let lastPid = null, lastTitle = null, samePid = 0, idle = 0;
  for (let step = 0; step < MAX; step++) {
    const st = await state();
    const w = (st.seats || []).find((s) => s.color === C);
    if (!st.started || !w) { console.log("game not running"); break; }
    report.lastTurn = w.turn;
    if (w.turn > STOP) break;
    const ttsPrompt = JSON.parse((await exec(`local p = enginePrompts.${C} if not p then return "null" end
local o = {} for i, x in ipairs(p.options or {}) do o[i] = x.label end
return JSON.encode({ id = p.promptId, title = p.title, mode = p.mode, min = p.min, max = p.max, options = o })`)) || "null");
    if (!ttsPrompt) { if (JSON.parse((await exec(`return JSON.encode({ over = debugTable and debugTable.gameOver or false })`)) || "{}").over) { console.log("game over"); break; } if (++idle % 20 === 0) await check("idle"); if (idle > 120) { report.stuck.push(`no prompt for 60s at turn ${w.turn} ${w.step}`); break; } await sleep(500); continue; }
    idle = 0;
    if (ttsPrompt.id === lastPid || ttsPrompt.title === lastTitle) { if (++samePid === 6) report.stuck.push(`prompt "${ttsPrompt.title}" repeated 6 times (turn ${w.turn} ${w.step})`); }
    else { samePid = 0; }
    lastPid = ttsPrompt.id; lastTitle = ttsPrompt.title;
    report.steps++;
    report.recent.push(`${w.turn}:${(w.rawPrompt?.input?.type)||ttsPrompt.title}`); if (report.recent.length > 8) report.recent.shift();
    const raw = w.rawPrompt?.input || {};
    report.prompts[raw.type || ttsPrompt.title] = (report.prompts[raw.type || ttsPrompt.title] || 0) + 1;
    const click = (i) => exec(`onMtgClick(Player.${C}, nil, "o|${C}|${i}") return "ok"`);
    // (priority questions all share one title, so "the same question again" is normal there: when it looks stuck,
    // end the turn rather than fall through to the last option, an ability it then fired forever, e.g. Kenrith's)
    if (raw.type === "chooseAction" && samePid >= 2) { await click(2); await sleep(400); continue; }
    if (raw.type === "chooseAction" && samePid < 2) {
      const acts = (raw.actions || []).filter((a) => a.type === "cast");
      const land = acts.find((a) => /^play /i.test(a.label || ""));
      const want = (process.env.KW_CARDS || "").split("|").filter(Boolean);
      const spell = acts.find((a) => !/^play /i.test(a.label || "") && want.some((w) => String(a.label || "").includes(w)))
        || acts.find((a) => !/^play /i.test(a.label || "")); // the deck's keyword cards first
      if (land) { await drag(land.cardId, "battlefield"); await sleep(600); continue; }
      const isWanted = spell && want.some((w) => String(spell.label || "").includes(w));
      // a card the engine lists but that can't resolve now (Return the Favor with nothing to copy) was dragged
      // again and again: at most two tries per card per turn
      const tryKey = `${w.turn}:${spell && spell.cardId}`;
      if (spell && (tries[tryKey] || 0) < 2 && (isWanted || Math.random() < 0.7)) { tries[tryKey] = (tries[tryKey] || 0) + 1; await drag(spell.cardId, "battlefield"); await sleep(600); continue; }
      await click(Math.random() < 0.35 ? 2 : 1); // End turn sometimes, otherwise Pass
    } else if (raw.type === "chooseCards" && /discard/i.test(`${ttsPrompt.title} ${ttsPrompt.text || ""}`) && samePid < 2) {
      // a discard by dragging, also for spells whose own text says discard (Cathartic Reunion, Faithless Looting)
      for (const c of (raw.cards || []).slice(0, Math.max(1, raw.min || 1))) { await drag(c.id, "graveyard"); await sleep(300); }
    } else if (ttsPrompt.mode === "single") {
      await click(samePid >= 3 ? ttsPrompt.options.length : 1); // last option (usually Cancel) when stuck
    } else if (ttsPrompt.mode === "multi") {
      // KW_CARDS (the deck's keyword cards, "|"-separated): a search or any card choice takes those first
      const want = (process.env.KW_CARDS || "").split("|").filter(Boolean);
      const wanted = ttsPrompt.options.map((l, i) => [String(l || ""), i + 1]).filter(([l]) => want.some((w) => l.startsWith(w))).map(([, i]) => i);
      const k = Math.max(ttsPrompt.min || 0, wanted.length ? Math.min(1, ttsPrompt.max || 1) : 0);
      const order = [...wanted, ...ttsPrompt.options.map((_, i) => i + 1).filter((i) => !wanted.includes(i))];
      let lua = ""; for (const j of order.slice(0, k)) lua += `onMtgClick(Player.${C}, nil, "o|${C}|${j}") `;
      await exec(lua + `onMtgClick(Player.${C}, nil, "confirm|${C}") return "ok"`);
    } else if (ttsPrompt.mode === "number") {
      await exec(`onMtgClick(Player.${C}, nil, "n|${C}|${ttsPrompt.min}") return "ok"`);
    }
    await sleep(400);
    await check(`step ${step}`);
  }
  await sleep(1500);
  const final = await check("end");
  report.final = final?.counts;
  console.log(JSON.stringify(report, null, 1));
})();
