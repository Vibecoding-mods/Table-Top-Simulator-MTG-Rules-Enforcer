// Break-it for the block declaration's budget (engine1124-blockbudget: forge-harness BlockBudgetTest): the pump-cost
// memo for one real block declaration (ComputerUtilCombat), and the chump pass past the deadline (AiBlockController)
// with each attacker's damage and each blocker's value worked out once. Each mutation switches one piece off, compiles
// only the edited file over the harness jar, runs BlockBudgetTest and requires the named check to fail; the file is
// put back and checked by sha256. Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
// (Not mutations: keying the memo by the ability alone, since an ability is only ever checked for its own card's
// controller; and the chump pass's attacker order, since the lethal board's 40 attackers are alike and no check could
// see it. docs/handoff/ai-block-budget-report.md.)
//   node tools/mutate-ai-block-budget.js <engine tree> [label pattern]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const AI = "forge/forge-ai/src/main/java/forge/ai/";
const CU = AI + "ComputerUtilCombat.java", K = AI + "AiBlockController.java";
const BT = "BlockBudgetTest";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["the memo never started", CU, "        if (!pumpCostMemo || PUMP_COSTS.get() != null) {\n            return false;\n        }", "        if (true) {\n            return false;\n        }", BT, "pump costs: in one declaration each pump ability's cost is checked once for a player"],
  ["the memo kept after the declaration", CU, "        if (began) {\n            PUMP_COSTS.remove();\n        }", "", BT, "pump costs: outside a declaration nothing is kept"],
  ["the memo answers no", CU, "        return known.computeIfAbsent(ability, a -> new java.util.HashMap<>()).computeIfAbsent(payer, p -> {\n            pumpCostChecks++;\n            return ComputerUtilCost.canPayCost(ability, p, false);\n        });", "        return known.computeIfAbsent(ability, a -> new java.util.HashMap<>()).computeIfAbsent(payer, p -> {\n            pumpCostChecks++;\n            return !ComputerUtilCost.canPayCost(ability, p, false);\n        });", BT, "same blocks: pumpers at 6 life, with and without the memo"],
  ["the declaration's memo not begun", K, "        final boolean began = ComputerUtilCombat.beginPumpCosts();", "        final boolean began = false;", BT, "pump costs: in one declaration each pump ability's cost is checked once for a player"],
  ["no chump pass past the deadline", K, "            if (AiController.evalDeadlinePassed(ai)) {\n                makeChumpBlocksPastDeadline(combat, ai.getCreaturesInPlay());\n            }", "", BT, "lethal: past the deadline 40 attackers at 6 life leave no blocker free that could save the AI"],
  ["chump blocks when not lethal", K, "            if (damage < ai.getLife()) {\n                break;\n            }", "", BT, "lethal: past the deadline an attack that isn't lethal gets no forced blocks"],
  ["the chump pass stops at the first block", K, "                    free.remove(blocker);", "                    free.clear();", BT, "lethal: past the deadline 40 attackers at 6 life leave no blocker free that could save the AI"],
  ["the chump pass works out values in its sort again", K, "        free.sort((a, b) -> Integer.compare(value.get(a), value.get(b)));", "        free.sort((a, b) -> { chumpEvaluations += 2; return Integer.compare(ComputerUtilCard.evaluateCreature(a), ComputerUtilCard.evaluateCreature(b)); });", BT, "chump pass: each attacker's damage and each blocker's value worked out once"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-blockbudget-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[5]))];
const runTest = (cls, extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), `forge.harness.host.${cls}`], { cwd: TREE, encoding: "utf8", timeout: 900000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith(`FAIL ${cls}`));
  return lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`) || l === `FAIL ${n}`) || l.slice(5, 80));
};
for (const cls of [BT]) {
  const base = runTest(cls, null);
  if (base.length) { console.log(`BASELINE FAILS (${cls}): ${base.join(", ")}`); process.exit(1); }
}
let missed = 0, ran = 0;
try {
  MUTATIONS.forEach(([label, file, from, to, cls, name], i) => {
    if (only && !only.test(label)) return;
    ran++;
    const f = path.join(TREE, file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8").replace(/\r\n/g, "\n");
    const crlf = orig.includes("\r\n");
    if (src.split(from).length - 1 !== 1) { missed++; console.log(`NOT APPLIED ${label}`); return; }
    const out = path.join(tmp, `m${i}`);
    fs.mkdirSync(out);
    let failed = null;
    try {
      const next = src.replace(from, () => to);
      fs.writeFileSync(f, crlf ? next.replace(/\n/g, "\r\n") : next);
      const c = javac(out, [f]);
      failed = c.status === 0 ? runTest(cls, out) : [`COMPILE ERROR ${c.stderr.split("\n")[0]}`];
    } finally {
      fs.writeFileSync(f, orig);
      if (sha(f) !== h) { console.log(`RESTORE FAILED: ${file}`); process.exit(100); }
    }
    const hit = failed.includes(name);
    if (!hit) missed++;
    console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.join(" | ") || "nothing failed"}`);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`${ran - missed} of ${ran} caught by name; files restored by sha256`);
process.exit(missed);
