// Break-it for the human's Auto payment on big boards (engine1124-autopay: forge-harness AutoPayBudgetTest): AutoPay's
// own budget (Game.getAIPayTimeoutMs, the AI payment's 2 s), past which the rest of the payment holds the static checks
// and one pass runs when it ends, in the Auto click (floatManaForCost) and the payment without a prompt
// (payManaCostWithTrace). Each mutation switches one piece off, compiles only the edited file over the harness jar,
// runs AutoPayBudgetTest and requires the named check to fail; the file is put back and checked by sha256. Needs a
// patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-autopay.js <engine tree> [label pattern]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const A = "forge-harness/src/main/java/forge/harness/common/AutoPay.java";
const AT = "AutoPayBudgetTest";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["the budget never holds", A, "            if (payBudget && !held && System.currentTimeMillis() >= deadline && !payer.getGame().getAction().isHoldingStaticAbilities()) {", "            if (false && payBudget && !held && System.currentTimeMillis() >= deadline && !payer.getGame().getAction().isHoldingStaticAbilities()) {", AT, "held: past the budget the Auto payment holds the static checks, then one pass"],
  ["held from the first tap within the budget", A, "            if (payBudget && !held && System.currentTimeMillis() >= deadline && !payer.getGame().getAction().isHoldingStaticAbilities()) {", "            if (payBudget && !held && !payer.getGame().getAction().isHoldingStaticAbilities()) {", AT, "held: within the budget each mana ability runs its static pass, as before"],
  ["never released", A, "                payer.getGame().getAction().setHoldCheckingStaticAbilities(false);\n                payer.getGame().getAction().checkStaticAbilities();", "                payer.getGame().getAction().checkStaticAbilities();", AT, "held: the static checks are not left held after the payment"],
  ["no pass when the payment ends", A, "                payer.getGame().getAction().setHoldCheckingStaticAbilities(false);\n                payer.getGame().getAction().checkStaticAbilities();", "                payer.getGame().getAction().setHoldCheckingStaticAbilities(false);", AT, "held: past the budget the Auto payment holds the static checks, then one pass"],
  ["the Auto click not budgeted", A, "            budget.beforeActivation();\n            if (!floatManaFromSource(chosen.spellAbility, effect)) {", "            if (!floatManaFromSource(chosen.spellAbility, effect)) {", AT, "held: past the budget the Auto payment holds the static checks, then one pass"],
  ["the payment without a prompt not budgeted", A, "            budget.beforeActivation();\n            payer.getGame().getStack().addAndUnfreeze(chosen.spellAbility);", "            payer.getGame().getStack().addAndUnfreeze(chosen.spellAbility);", AT, "held: the payment without a prompt (AutoPay.payManaCost) holds past the budget too, then one pass"],
  ["holds not counted", A, "                held = true;\n                holds++;", "                held = true;", AT, "held: past the budget the Auto payment holds the static checks, then one pass"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-autopay-"));
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
for (const cls of [AT]) {
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
