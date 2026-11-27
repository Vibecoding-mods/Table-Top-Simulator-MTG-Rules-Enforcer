// Break-it for what a way costs besides mana, in the bridge (tests/test_bridge_cost_badge_4.js): each mutation
// switches one piece off (bridge/bridge.js spellCostNotes, bridge/table-map.js), runs the test and requires the named
// check to fail, then puts the file back and checks it by sha256. The engine's pieces: tools/mutate-cost-badge-4-engine.js.
//   node tools/mutate-cost-badge-4.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TEST = "tests/test_bridge_cost_badge_4.js";
const B = "bridge/bridge.js", M = "bridge/table-map.js";

// [label, file, from, to, check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["the way cast now: its extra not said", B, "  if (c.playCostExtra) {\n", "  if (false) {\n", "escape: the exiled cards said with the way"],
  ["the way not named in the extra", B, "${w ? `${w[0].toUpperCase()}${w.slice(1)} also costs` : \"Casting it also costs\"}", "Casting it also costs", "escape: the exiled cards said with the way"],
  ["a permission's extra said as a way", B, "${w ? `${w[0].toUpperCase()}${w.slice(1)} also costs` : \"Casting it also costs\"}", "${c.playCostMode} also costs", "free: no way named"],
  ["Forge's capital kept mid-sentence", B, "  out.push(`${w ? `${w[0].toUpperCase()}${w.slice(1)} also costs` : \"Casting it also costs\"}: ${lowerFirst(c.playCostExtra)}.`);", "  out.push(`${w ? `${w[0].toUpperCase()}${w.slice(1)} also costs` : \"Casting it also costs\"}: ${c.playCostExtra}.`);", "flashback {0}: the sacrifices said"],
  ["an other way's extra not said", B, "    return `${half}${s.cost}${w ? ` by ${w}` : \"\"}${plus(s.extra)}`;", "    return `${half}${s.cost}${w ? ` by ${w}` : \"\"}`;", "tie: the other way with its life"],
  ["an empty extra said as an and", B, "  const plus = (extra) => (extra ? `, and ${lowerFirst(extra)}` : \"\");", "  const plus = (extra) => `, and ${lowerFirst(extra)}`;", "no extra: the other way without an and"],
  ["a half's extra not said", B, "(printed ${s.printed || \"no mana cost\"})${plus(s.extra)}`);", "(printed ${s.printed || \"no mana cost\"})`);", "hand: a half's extra after its cost"],
  ["the extra on the public pile", B, "  if (!row || !c.playCost) return out;", "  if (!c.playCost) return out;", "pile: the public graveyard entry says no extra"],
  ["table-map: playCostExtra not mapped", M, "  playCostExtra: {", "  playCostExtraGone: {", "table-map: playCostExtra goes to the hover"],
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
