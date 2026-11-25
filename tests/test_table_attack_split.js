// "Attack all split evenly" on the table (the user 2026-11-25; the bridge's __allsplit, test_bridge_attack_split.js).
// tools/engine-renderer.lua: in the attack question with nothing picked the corner reads No attacks / All attack, and
// when the bridge offers __allsplit the third button beside them reads "Attack all split evenly", green as All attack;
// its press answers __allsplit. A creature picked hides it (Attack (1) / No attacks), and so does a question without
// it. A "Resolve N×" group after it is purple again. Its line in the Choices panel is green.
//   node tests/test_table_attack_split.js
// (RENDERER_LUA=<a copy> builds the table from a copy, as test_table_loop_quiet.js.)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

function saveWith() {
  if (process.env.TABLE_SAVE) return JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8"));
  const save = buildSave();
  if (!process.env.RENDERER_LUA) return save;
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
const sentOf = (r, mark) => (stepOf(r, mark).fx || []).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");

const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "White" }, ai: [] });
const PRELUDE = 'engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"';
const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) }, frames: 5 });
const run = (steps) => simulate({ save, steps: [q(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, ...steps] });
const pairs = Array.from({ length: 11 }, (_, k) => ({ id: `engine-card-${3001 + k}|player-1`, label: `Zombie Token 2/2 #${k + 1} → White` }));
const ATTACK = (id, split = true) => ask({ promptId: id, kind: "attack", title: "Choose attackers", mode: "multi", min: 0, max: pairs.length, keepOrder: true,
  options: [{ id: "__allattack", label: "All attack" }, ...(split ? [{ id: "__allsplit", label: "Attack all split evenly" }] : []), { id: "__noattack", label: "No attacks" }, ...pairs] });
const PRIORITY = (id) => ask({ promptId: id, kind: "priority", title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Resolve" },
  { id: "__group", label: "Resolve 2× Zealous Conscripts" }, { id: "__resolve", label: "Resolve all (2)" }, { id: "__endturn", label: "End turn" }] });
const corner = (mark) => q('local g = function(id, a) return tostring(UI.getAttribute(id, a)) end return g("eng_big_Blue", "text") .. "|" .. g("eng_big2_Blue", "text") .. "|" .. g("eng_big3_Blue", "active") .. "|" .. g("eng_big3_Blue", "text") .. "|" .. tostring(g("eng_big3_Blue", "color") == ENGINE_COMBAT.attackOn) .. "|" .. tostring(g("eng_big3_Blue", "color") == ENGINE_GROUP_COLOR)', mark);

{
  const r = run([
    ATTACK(900), { frames: 60 }, corner("split"),
    q('onMtgBig3(Player.Blue, nil, "eng_big3_Blue") return "clicked"', "press split"),
    ATTACK(901), { frames: 60 },
    q('enginePick("Blue", 4) return "picked"', "pick"), { frames: 10 }, corner("picked"),
    ATTACK(902, false), { frames: 60 }, corner("none"),
    ATTACK(903), { frames: 60 }, corner("split again"),
    PRIORITY(904), { frames: 60 }, corner("group"),
  ]);
  const v = (m) => String(stepOf(r, m).value).split("|");
  ok("attack split: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("split: No attacks, All attack, and the third button Attack all split evenly", v("split")[0] === "No attacks" && v("split")[1] === "All attack" && v("split")[2] === "true"
    && v("split")[3] === "Attack all split evenly", String(stepOf(r, "split").value));
  ok("split: the third button is green, as All attack", v("split")[4] === "true", String(stepOf(r, "split").value));
  ok("split: its press answers __allsplit", sentOf(r, "press split").includes('"choice":["__allsplit"]') && sentOf(r, "press split").includes('"promptId":900'), sentOf(r, "press split").slice(0, 300));
  ok("picked: Attack (1) / No attacks, no third button", v("picked")[0] === "Attack (1)" && v("picked")[1] === "No attacks" && v("picked")[2] !== "true", String(stepOf(r, "picked").value));
  ok("not offered: no third button", v("none")[0] === "No attacks" && v("none")[1] === "All attack" && v("none")[2] !== "true", String(stepOf(r, "none").value));
  ok("offered again: the third button is back", v("split again")[2] === "true" && v("split again")[3] === "Attack all split evenly", String(stepOf(r, "split again").value));
  ok("a group after it: purple again", v("group")[2] === "true" && v("group")[3] === "2× Zealous Conscripts" && v("group")[5] === "true", String(stepOf(r, "group").value));
}
// (the Choices panel's line green, as All attack: optionColor)
{
  const r = simulate({ save, steps: [q('return tostring(optionColor({ kind = "attack", mode = "multi", options = { { id = "__allattack" }, { id = "__allsplit" } } }, 2, false) == ENGINE_COMBAT.attackOn)', "green")] });
  ok("Choices panel: the line is green", stepOf(r, "green").value === "true", String(stepOf(r, "green").value) + " " + (r.errors || []).slice(0, 2).join(" | "));
}

console.log(`${failed ? "FAILED: " : "PASSED: "}${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
