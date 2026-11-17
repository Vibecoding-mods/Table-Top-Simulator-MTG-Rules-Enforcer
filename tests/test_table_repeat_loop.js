// A loop's "Repeat ×N" on the table (the bridge's loopOfferFor, loopShow; rule 732.2, the user 2026-11-16).
// tools/engine-renderer.lua: engineUpdateCorner gives "Repeat ×N" (__loop) the corner's third button, as "Resolve N×"
// (__group) and "No ×3" (__repeat:no); its press answers __loop. While the loop repeats the bridge shows "Repeating k/N"
// under the question id "__loop" with one option, Stop: the corner's big button, and its press answers under that id.
// tools/make-engine-copy.js: "mtg repeat <n>" sends repeatloop with the colour and n (none without a number), and
// "mtg help" lists it.
//   node tests/test_table_repeat_loop.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark) => ({ lua, mark });
const stepOf = (r, mark) => r.steps.find((s) => s.step === mark) || {};
// what the table sent the bridge in a step (the answer's JSON, unescaped: it is escaped twice on the way out)
const sentOf = (r, mark) => (stepOf(r, mark).fx || []).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");

const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
const PRELUDE = 'engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"';
const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) }, frames: 5 });
const run = (steps) => simulate({ save, steps: [q(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, ...steps] });
// the bridge's priority question with the offer, as onPrompt sends it
const PRIORITY = (id, loop = true) => ask({ promptId: id, kind: "priority", title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, { id: "__endturn", label: "End turn" },
  ...(loop ? [{ id: "__loop", label: "Repeat ×N" }] : []), { id: "prompt-action-1", cardId: "engine-card-10", label: "Kiki-Jiki, Mirror Breaker: Create a token that's a copy of target nonlegendary creature", ab: "Create a token" }] });
// the progress panel, as loopShow sends it
const PROGRESS = (k, n) => ask({ promptId: "__loop", kind: "loop", title: `Repeating ${k}/${n}`, mode: "single", min: 1, max: 1,
  text: 'Kiki-Jiki, Mirror Breaker. Anyone may respond when they get priority, and that stops it. Stop (or "mtg stop") ends it now.', options: [{ id: "__loopstop", label: "Stop" }] });
const corner = (mark) => q('local g = function(id, a) return tostring(UI.getAttribute(id, a)) end return g("eng_big_Blue", "text") .. "|" .. g("eng_big2_Blue", "text") .. "|" .. g("eng_big3_Blue", "active") .. "|" .. g("eng_big3_Blue", "text")', mark);

{
  const r = run([
    PRIORITY(800, false), { frames: 60 }, corner("plain"),
    PRIORITY(801), { frames: 60 }, corner("offered"),
    q('onMtgBig3(Player.Blue, nil, "eng_big3_Blue") return "clicked"', "press"),
    PROGRESS(1, 100), { frames: 60 }, corner("progress"),
    q('onMtgBig(Player.Blue, nil, "eng_big_Blue") return "clicked"', "stop"),
    PROGRESS(37, 1000), { frames: 60 }, corner("progress 37"),
  ]);
  const v = (m) => String(stepOf(r, m).value).split("|");
  ok("repeat loop: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("plain priority: no third corner button", v("plain")[0].startsWith("Next") && v("plain")[2] !== "true", String(stepOf(r, "plain").value));
  ok("offered: the corner's third button is Repeat ×N, beside Next and End turn", v("offered")[0].startsWith("Next") && v("offered")[1] === "End turn" && v("offered")[2] === "true" && v("offered")[3] === "Repeat ×N",
    String(stepOf(r, "offered").value));
  ok("offered: pressing it answers __loop", sentOf(r, "press").includes('"choice":["__loop"]') && sentOf(r, "press").includes('"promptId":801'), sentOf(r, "press").slice(0, 300));
  ok("progress: the big button is Stop, no third", v("progress")[0] === "Stop" && v("progress")[2] !== "true", String(stepOf(r, "progress").value));
  ok("progress: Stop answers __loopstop under the __loop id", sentOf(r, "stop").includes('"choice":["__loopstop"]') && sentOf(r, "stop").includes('"promptId":"__loop"'), sentOf(r, "stop").slice(0, 300));
  ok("progress: a new count shows Stop again", v("progress 37")[0] === "Stop", String(stepOf(r, "progress 37").value));
  // (the panel's title is the count: read from the prompt the table keeps)
  const title = run([PROGRESS(37, 1000), { frames: 60 }, q('return tostring((enginePrompts.Blue or {}).title)', "title")]);
  ok("progress: the table keeps Repeating 37/1000 as the question", stepOf(title, "title").value === "Repeating 37/1000", String(stepOf(title, "title").value));
}
// ── the table's "mtg repeat" ──
{
  const say = (text, mark) => ({ lua: `local sent = {} local was = engineSend engineSend = function(t, p) sent[#sent + 1] = { t = t, p = p } end local v = engineChat(${JSON.stringify(text)}, Player.Blue) engineSend = was return JSON.encode({ v = tostring(v), sent = sent })`, mark });
  const r = simulate({ save: buildSave(), steps: [say("mtg repeat 100", "n"), say("mtg repeat", "none"), say("MTG Repeat 7 ", "case"), say("mtg help", "help")] });
  const got = (m) => { try { return JSON.parse(stepOf(r, m).value); } catch { return {}; } };
  ok("chat: the script loaded without errors", !r.errors.length, r.errors.slice(0, 2).join(" | "));
  ok("chat: mtg repeat 100 sends repeatloop with the colour and 100", (got("n").sent || []).some((x) => x.t === "repeatloop" && x.p?.color === "Blue" && x.p?.n === 100), JSON.stringify(got("n")));
  ok("chat: mtg repeat's line is hidden", got("n").v === "false", got("n").v);
  ok("chat: mtg repeat with no number sends no n", (got("none").sent || []).some((x) => x.t === "repeatloop" && x.p?.color === "Blue" && x.p?.n == null), JSON.stringify(got("none")));
  ok("chat: any case, trailing spaces", (got("case").sent || []).some((x) => x.t === "repeatloop" && x.p?.n === 7), JSON.stringify(got("case")));
  ok("chat: mtg help lists mtg repeat", (stepOf(r, "help").fx || []).some((l) => /mtg repeat <n> - after one pass of a loop by hand/.test(l)), (stepOf(r, "help").fx || []).join(" | ").slice(0, 300));
}

console.log(`${failed ? "FAILED: " : "PASSED: "}${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
