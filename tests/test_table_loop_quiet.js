// "No responses for this loop" on the table (the bridge's loopQuietShow and loopQuietFor; the user 2026-11-17).
// tools/engine-renderer.lua: while another seat repeats a loop the bridge shows the seat a panel under the question id
// "__loopquiet" with one option, "No responses for this loop (Blue repeating ×1000)" (__quiet): the corner's big button
// reads "No responses" and its press answers __quiet under that id. Once pressed the panel is "No responses during
// Blue's loop" with Stop (__quietstop), answered under the same id. In a priority question __quiet is the corner's third
// button, "No responses" with the whole label as its tooltip, unless "Resolve N×" (__group) is offered, which comes first;
// its line in the Choices panel is purple, as the third button.
//   node tests/test_table_loop_quiet.js
// (RENDERER_LUA=<a copy> builds the table from a copy: tools/mutate-loop-quiet.js breaks one so a check fails by name.)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

function saveWith() {
  if (process.env.TABLE_SAVE) return JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8"));
  const save = buildSave();
  if (!process.env.RENDERER_LUA) return save;
  // (the built Global is the table's own script, then the renderer, then make-engine-copy's tables after it)
  const real = fs.readFileSync(path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8");
  if (!save.LuaScript.includes(real)) throw new Error("the built table doesn't hold tools/engine-renderer.lua as is");
  save.LuaScript = save.LuaScript.split(real).join(fs.readFileSync(process.env.RENDERER_LUA, "utf8"));
  return save;
}
const save = saveWith();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark) => ({ lua, mark });
const stepOf = (r, mark) => r.steps.find((s) => s.step === mark) || {};
// what the table sent the bridge in a step (the answer's JSON, unescaped: it is escaped twice on the way out)
const sentOf = (r, mark) => (stepOf(r, mark).fx || []).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");

const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "White" }, ai: [] });
const PRELUDE = 'engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"';
const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) }, frames: 5 });
const run = (steps) => simulate({ save, steps: [q(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, ...steps] });
const LABEL = "No responses for this loop (White repeating ×1000)";
// the panels, as loopQuietShow sends them
const OFFER = ask({ promptId: "__loopquiet", kind: "loop", mode: "single", min: 1, max: 1, title: "White repeats a loop ×1000 (Kiki-Jiki, Mirror Breaker)",
  text: "You may respond when you get priority, and that stops it. Or pass on it: your priority passes are answered for you for the rest of this loop.", options: [{ id: "__quiet", label: LABEL }] });
const QUIET = ask({ promptId: "__loopquiet", kind: "loop", mode: "single", min: 1, max: 1, title: "No responses during White's loop",
  text: "Your priority passes are answered for you until it ends (your own triggers still go on the stack). Stop (or \"mtg stop\") asks your next priority, to respond.", options: [{ id: "__quietstop", label: "Stop" }] });
// the priority question with the button, as onPrompt sends it (group: "Resolve 2×" offered too)
const PRIORITY = (id, group = false) => ask({ promptId: id, kind: "priority", title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Resolve" },
  ...(group ? [{ id: "__group", label: "Resolve 2× Zealous Conscripts" }] : []), { id: "__resolve", label: "Resolve all (2)" }, { id: "__endturn", label: "End turn" },
  { id: "__quiet", label: LABEL }, { id: "prompt-action-0", cardId: "engine-card-40", label: "Cast Lightning Bolt" }] });
const corner = (mark) => q('local g = function(id, a) return tostring(UI.getAttribute(id, a)) end return g("eng_big_Blue", "text") .. "|" .. g("eng_big2_Blue", "text") .. "|" .. g("eng_big3_Blue", "active") .. "|" .. g("eng_big3_Blue", "text") .. "|" .. g("eng_big3_Blue", "tooltip")', mark);

{
  const r = run([
    OFFER, { frames: 60 }, corner("offer"),
    q('onMtgBig(Player.Blue, nil, "eng_big_Blue") return "clicked"', "press offer"),
    QUIET, { frames: 60 }, corner("quiet"),
    q('onMtgBig(Player.Blue, nil, "eng_big_Blue") return "clicked"', "press stop"),
    PRIORITY(900), { frames: 60 }, corner("priority"),
    q('onMtgBig3(Player.Blue, nil, "eng_big3_Blue") return "clicked"', "press third"),
    PRIORITY(901, true), { frames: 60 }, corner("group"),
  ]);
  const v = (m) => String(stepOf(r, m).value).split("|");
  ok("loop quiet: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("offer: the big button reads No responses, no third", v("offer")[0] === "No responses" && v("offer")[2] !== "true", String(stepOf(r, "offer").value));
  ok("offer: its press answers __quiet under __loopquiet", sentOf(r, "press offer").includes('"choice":["__quiet"]') && sentOf(r, "press offer").includes('"promptId":"__loopquiet"'), sentOf(r, "press offer").slice(0, 300));
  ok("pressed: the big button is Stop", v("quiet")[0] === "Stop" && v("quiet")[2] !== "true", String(stepOf(r, "quiet").value));
  ok("pressed: Stop answers __quietstop under __loopquiet", sentOf(r, "press stop").includes('"choice":["__quietstop"]') && sentOf(r, "press stop").includes('"promptId":"__loopquiet"'), sentOf(r, "press stop").slice(0, 300));
  ok("priority: the third button is No responses, the whole label its tooltip", v("priority")[0] === "Resolve" && v("priority")[1] === "Resolve all (2)" && v("priority")[2] === "true"
    && v("priority")[3] === "No responses" && v("priority")[4] === LABEL, String(stepOf(r, "priority").value));
  ok("priority: pressing it answers __quiet", sentOf(r, "press third").includes('"choice":["__quiet"]') && sentOf(r, "press third").includes('"promptId":900'), sentOf(r, "press third").slice(0, 300));
  ok("priority: Resolve N× comes first", v("group")[2] === "true" && v("group")[4] === "Resolve 2× Zealous Conscripts", String(stepOf(r, "group").value));
}
// (the Choices panel's line purple, as the third button: optionColor)
{
  const r = simulate({ save, steps: [q('return tostring(optionColor({ mode = "single", options = { { id = "__pass" }, { id = "__quiet" } } }, 2, false) == ENGINE_GROUP_COLOR)', "purple")] });
  ok("Choices panel: the line is purple", stepOf(r, "purple").value === "true", String(stepOf(r, "purple").value) + " " + (r.errors || []).slice(0, 2).join(" | "));
}

console.log(`${failed ? "FAILED: " : "PASSED: "}${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
