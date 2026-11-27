// Break-it for the cost badge, phase 2, in the bridge and on the table (tests/test_bridge_cost_badge_2.js): each
// mutation switches one piece off (bridge/bridge.js costNow / cardNotes / tableCard, tools/engine-renderer.lua
// engineCostChange and its callers), runs the test and requires the named check to fail, then puts the file back and
// checks it by sha256. The engine's pieces: tools/mutate-cost-badge-2-engine.js.
//   node tools/mutate-cost-badge-2.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TEST = "tests/test_bridge_cost_badge_2.js";
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua";

// [label, file, from, to, check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["bridge: playCost not read", B, "  if (row && !c.effectiveManaCost && c.playCost) {", "  if (false) {", "flashback: the row's Faithless Looting costs {2}{R} by flashback, printed {R}"],
  ["bridge: playCost on the public piles too", B, "  if (row && !c.effectiveManaCost && c.playCost) {", "  if (!c.effectiveManaCost && c.playCost) {", "graveyard pile: the public entry carries no play cost"],
  ["bridge: playCost over effectiveManaCost", B, "  if (row && !c.effectiveManaCost && c.playCost) {", "  if (row && c.playCost) {", "effective cost first: the engine's effectiveManaCost wins over playCost"],
  ["bridge: the way not sent", B, "...(em ? { em: em } : {})", "...{}", "escape: the row's Ox of Agonas costs {R}{R} by escape"],
  ["bridge: a permission named as a way", B, "mode && mode !== \"may play\" && mode !== \"free\" ? playWay(mode) : null", "mode ? playWay(mode) : null", "free: a free cast reads {0}, with no way named"],
  ["bridge: plotted not put in words", B, "mode === \"plotted\" ? \"plot\" : mode", "mode", "plot: the row's plotted card costs {0} by plot"],
  ["bridge: the same cost badged", B, "return c.playCost !== printed ? { ec:", "return true ? { ec:", "may play: a permission at the printed cost has no badge"],
  ["bridge: a foretold card's printed cost not read", B, "  const printed = c.playCostPrinted || (c.manaCost", "  const printed = (c.manaCost", "foretell: its hover text says the cost now against its face's printed cost"],
  ["bridge: a foretold card's words unsaid", B, "    if (now.ec) nt.push(`Costs ${now.ec} now", "    if (false) nt.push(`Costs ${now.ec} now", "foretell: its hover text says the cost now against its face's printed cost"],
  ["bridge: a face-down row card badged", B, "    ...(c.isFaceDown ? {} : costNow(c, zone, row)),", "    ...costNow(c, zone, row),", "foretell: the face-down row card has no badge fields"],
  ["bridge: the row not passed on", B, "    ...(c.isFaceDown ? {} : costNow(c, zone, row)),", "    ...(c.isFaceDown ? {} : costNow(c, zone)),", "flashback: the row's Faithless Looting costs {2}{R} by flashback, printed {R}"],
  ["table: the way not in the words", R, "(type(em) == \"string\" and em ~= \"\" and (\" by \" .. em) or \"\")", "\"\"", "table: flashback's words"],
  ["table: an empty way said", R, "(type(em) == \"string\" and em ~= \"\" and (\" by \" .. em) or \"\")", "(type(em) == \"string\" and (\" by \" .. em) or \"\")", "table: an empty way is no way"],
  ["table: the badge's tooltip drops em", R, "  local ch = engineCostChange(c.mc, c.ec, c.em)\n  if ch == nil then return parts end", "  local ch = engineCostChange(c.mc, c.ec)\n  if ch == nil then return parts end", "table: the cost badge's tooltip passes em too"],
  ["table: description drops em", R, "    local ch = engineCostChange(c.mc, c.ec, c.em)\n    if ch ~= nil then s = s", "    local ch = engineCostChange(c.mc, c.ec)\n    if ch ~= nil then s = s", "table: description passes em to engineCostChange"],
];

const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
function runTest() {
  const r = spawnSync(process.execPath, [TEST], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`)) || l.slice(5, 90));
  if (r.status !== 0 && !failed.length) failed.push(`exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const base = runTest();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let missed = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to, name] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`NOT APPLIED ${label}: the code to break is not there once`); missed++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTest(); } finally { fs.writeFileSync(file, text); }
  if (sha(file) !== before) { console.log(`RESTORE FAILED: ${rel}`); process.exit(100); }
  const hit = failed.includes(name);
  if (!hit) missed++;
  console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.slice(0, 3).join(" | ") || "nothing failed"}`);
}
console.log(`${list.length - missed} of ${list.length} caught by name; files restored by sha256`);
process.exit(missed ? 1 : 0);
