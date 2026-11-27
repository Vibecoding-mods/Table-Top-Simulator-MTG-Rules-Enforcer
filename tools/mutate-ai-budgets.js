// Break-it for the AI budgets (engine1117-aibudgets): the attack declaration's defender choice and assault check, the
// combat predictions without chump blocks, the payment's own budget (forge-harness BigBoardFixesTest), and the 500-Clue
// held check measured against the unshared path in the same run (ManaSourcesTest). Each mutation switches one piece
// off, compiles only the edited file over the harness jar, runs its test class and requires the named check to fail;
// the file is put back and checked by sha256. Needs a patched engine tree with its jar (engine/test-harness-local.sh
// builds both).
//   node tools/mutate-ai-budgets.js <engine tree> [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const AI = "forge/forge-ai/src/main/java/forge/ai/";
const AA = AI + "AiAttackController.java", AC = AI + "AiController.java", CU = AI + "ComputerUtil.java", K = AI + "AiBlockController.java";
const M = AI + "ComputerUtilMana.java", GM = "forge/forge-game/src/main/java/forge/game/Game.java";
const AS = "forge-harness/src/main/java/forge/harness/common/ActionSpace.java";
const BB = "BigBoardFixesTest", MS = "ManaSourcesTest";
const CLUES = "theHeldCheckOn500CluesIsUnderATenthOfTheUnsharedPath";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["defender: no cheap choice past the deadline", AA, "            if (AiController.evalDeadlinePassed(ai)) {\n                return lowestLife(opponents);\n            }\n            final int life", "            final int life", BB, "attack: past the deadline the defender is the lowest-life opponent, with no combat prediction"],
  ["defender: the cheap choice the highest life", AA, "if (best == null || opp.getLife() < best.getLife()) {", "if (best == null || opp.getLife() > best.getLife()) {", BB, "attack: past the deadline the defender is the lowest-life opponent, with no combat prediction"],
  ["defender: the deadline not halved for it", AA, "        if (!ai.getController().isAI()) {\n            return choosePreferredDefenderScored", "        if (true) {\n            return choosePreferredDefenderScored", BB, "attack: the defender choice runs on half of the budget left, then puts the deadline back"],
  ["defender: the deadline not put back", AA, "            aic.restoreCombatDeadline(outer);\n", "", BB, "attack: the defender choice runs on half of the budget left, then puts the deadline back"],
  ["halving: the deadline unchanged", AC, "            combatDeadline = now + (outer - now) / 2;\n", "", BB, "attack: halving the deadline gives half of what is left"],
  ["halving: a passed deadline moved to now", AC, "if (outer != Long.MAX_VALUE && outer > now) {", "if (outer != Long.MAX_VALUE) {", BB, "attack: halving the deadline gives half of what is left"],
  ["halving: not counted", AC, "            COMBAT_SHARES.incrementAndGet();\n", "", BB, "attack: the defender choice runs on half of the budget left, then puts the deadline back"],
  ["predictions: not counted", CU, "            COMBAT_PREDICTIONS.incrementAndGet();\n", "", BB, "attack: within the deadline the defender choice predicts each opponent's combat, as before"],
  ["assault: the full check past the deadline", AA, "        if (AiController.evalDeadlinePassed(ai)) {\n            return cheapAssault();\n        }\n\n        if (ai.isCardInPlay(\"Beastmaster Ascension\")", "\n        if (ai.isCardInPlay(\"Beastmaster Ascension\")", BB, "attack: past the deadline a lethal assault is made with no assault checks"],
  ["assault: the cheap one always made", AA, "        final boolean lethal = unblocked >= (long) defendingOpponent.getLife() + lifeBack;", "        final boolean lethal = true;", BB, "attack: past the deadline an assault that isn't lethal isn't made"],
  ["assault: the cheap one never made", AA, "        final boolean lethal = unblocked >= (long) defendingOpponent.getLife() + lifeBack;", "        final boolean lethal = false;", BB, "attack: past the deadline a lethal assault is made with no assault checks"],
  ["assault: flyers taken as ground", AA, "final long[] entry = {hit, need, a.hasKeyword(Keyword.FLYING) ? 1 : 0, a.getNetToughness()};", "final long[] entry = {hit, need, 0, a.getNetToughness()};", BB, "cheap assault: flyers against reach are blocked"],
  ["assault: checks not counted", AA, "        return ASSAULT_CHECKS.get();", "        return 0;", BB, "attack: within the deadline the assault is weighed and the AI attacks as before"],
  ["predictions: chump blocks again", K, "        assignBlockers(combat, possibleBlockers);\n    }\n\n    /** The real block declaration", "        assignBlockers(combat, possibleBlockers);\n        if (AiController.evalDeadlinePassed(ai)) {\n            makeChumpBlocksPastDeadline(combat, possibleBlockers);\n        }\n    }\n\n    /** The real block declaration", BB, "block: a combat prediction past the deadline makes no chump blocks"],
  ["declaration: no chump blocks", AC, "            block.declareBlockers(combat);", "            block.assignBlockersForCombat(combat);", BB, "block: past the deadline a lethal attack is chump-blocked"],
  ["pay: the combat budget", M, "ai.getGame().getAIPayTimeoutMs())", "ai.getGame().getAITimeout() * 1000L)", BB, "pay: past the payment budget, within the combat one, the static checks are held"],
  ["pay: the budget as long as combat's", GM, "    public int AI_PAY_TIMEOUT_MS = 2000;", "    public int AI_PAY_TIMEOUT_MS = 5000;", BB, "pay: the payment has its own budget, shorter than combat's"],
  ["pay: the budget ignores AI_TIMEOUT", GM, "        return Math.min(AI_PAY_TIMEOUT_MS, AI_TIMEOUT * 1000L);", "        return AI_PAY_TIMEOUT_MS;", BB, "pay: past the deadline the payment is made with the static checks held, then one pass"],
  ["clues: the battlefield memo always rebuilt", AS, "        return memo == null ? buildBattlefieldSources(player) : memo.computeIfAbsent(player, ActionSpace::buildBattlefieldSources);", "        return buildBattlefieldSources(player);", MS, CLUES],
  ["clues: no static scope", AS, "        final boolean ownsStatics = shareManaSources && StaticSourceScope.begin();", "        final boolean ownsStatics = false;", MS, CLUES],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-aibudgets-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[5]))];
const runTest = (cls, extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), `forge.harness.host.${cls}`], { cwd: TREE, encoding: "utf8", timeout: 900000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith(`FAIL ${cls}`));
  if (r.status !== 0 && !lines.length) return [`CRASH exit ${r.status}${r.error ? ` (${r.error.code})` : ""}`]; // (a class that cannot start, or times out, prints no FAIL line: the baseline is red and no mutant is caught by it)
  return lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`) || l === `FAIL ${n}`) || l.slice(5, 80));
};
for (const cls of [BB, MS]) {
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
