// Break-it for the cost badge's halves and ways in the bridge (tests/test_bridge_cost_badge_3.js): each mutation
// switches one piece off (bridge/bridge.js costNow, spellCostNotes, cardNotes), runs the test and requires the named
// check to fail, then puts the file back and checks it by sha256. The engine's pieces: tools/mutate-cost-badge-2-engine.js.
//   node tools/mutate-cost-badge-3.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TEST = "tests/test_bridge_cost_badge_3.js";
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua";

// [label, file, from, to, check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["a half gets the badge", B, "    if (c.playCostName) return {};\n", "", "aftermath: a taxed half has no badge (the picture has a cost for each half)"],
  ["the halves and ways not said", B, "  nt.push(...spellCostNotes(c, row));\n", "", "split in hand: each half's cost now in the hover"],
  ["an unchanged half said", B, "    if (s && s.cost && s.cost !== s.printed) out.push(", "    if (s && s.cost) out.push(", "adventure in hand: only the changed half said"],
  ["the half cast not said", B, "  if (c.playCostName) {\n    const w = way(c.playCostMode);", "  if (false) {\n    const w = way(c.playCostMode);", "aftermath: the hover says the half, its cost and the way"],
  ["the half's printed cost not said", B, "${c.playCostPrinted && c.playCostPrinted !== c.playCost ? ` (printed ${c.playCostPrinted})` : \"\"}", "", "aftermath: the hover says the half, its cost and the way"],
  ["the other ways not said", B, "  if (others.length) out.push(", "  if (false) out.push(", "cheapest: the other way in the hover"],
  ["the other half not named", B, "    const half = c.playCostName || (s.name && s.name !== c.identity?.name) ? `${s.name} ` : \"\";", "    const half = false ? `${s.name} ` : \"\";", "halves: the half cast and the other half"],
  ["the whole card named among the others", B, "    const half = c.playCostName || (s.name && s.name !== c.identity?.name) ? `${s.name} ` : \"\";", "    const half = true ? `${s.name} ` : \"\";", "cheapest: the other way in the hover"],
  ["an other way's way not said", B, "    return `${half}${s.cost}${w ? ` by ${w}` : \"\"}${plus(s.extra)}`;", "    return `${half}${s.cost}${plus(s.extra)}`;", "others: a dearer way said with its way"],
  ["a permission said as a way", B, "  const way = (m) => (m && m !== \"may play\" && m !== \"free\" ? playWay(m) : null);", "  const way = (m) => (m ? playWay(m) : null);", "cheapest: the other way in the hover"],
  ["the ways on the public pile", B, "  if (!row || !c.playCost) return out;", "  if (!c.playCost) return out;", "pile: the public graveyard entry has no other ways"],
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
