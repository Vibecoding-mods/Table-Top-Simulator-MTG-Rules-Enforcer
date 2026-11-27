// Break-it for Archenemy's team turns (docs/handoff/archenemy-team-turns-report.md): CR 904.2, the archenemy's opponents
// take one turn together with each player's own life (teamRules "teamTurns": Forge's shared team turns, CR 805, without
// shared life), and 805.10d's blocks for a teammate under shared team turns (GameRules.hasTeamBlocks, and the AI's).
// Each mutation compiles only the edited file over the harness jar, runs ArchenemyTest and requires the named check to
// fail; the file is put back and checked by sha256. Needs a patched engine tree with its jar (engine/test-harness-local.sh
// builds both).
//   node tools/mutate-archenemy-team-turns.js <engine tree> [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const H = "forge-harness/src/main/java/forge/harness/host/";
const AD = H + "ManaBrewEngineAdapter.java", AR = H + "Archenemy.java", EX = H + "InteractiveSnapshotExtractor.java";
const GR = "forge/forge-game/src/main/java/forge/game/GameRules.java";
const CU = "forge/forge-game/src/main/java/forge/game/combat/CombatUtil.java";
const PH = "forge/forge-game/src/main/java/forge/game/phase/PhaseHandler.java";
const AI = "forge/forge-ai/src/main/java/forge/ai/";
const A = "ArchenemyTest";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["teamTurns without shared team turns", AD, "            rules.setSharedTeamTurns(true);\n            return;", "            return;", A, "cr904_2 theOpponentsTakeOneTurnTogether"],
  ["teamTurns with shared life too", AD, "            rules.setSharedTeamTurns(true);\n            return;", "            rules.setSharedTeamTurns(true);\n            rules.setSharedTeamLife(true);\n            return;", A, "cr904_2 eachOpponentKeepsTheirOwnLife"],
  ["teamTurns with teams not sitting together", AD, "            if (!teamsSitTogether(request, sizes)) {\n                throw new IllegalArgumentException(\"teamTurns", "            if (false) {\n                throw new IllegalArgumentException(\"teamTurns", A, "teamTurns aTeamThatDoesNotSitTogetherIsRefused"],
  ["Archenemy with shared turns and life accepted", AR, "if (!archenemies.isEmpty() && ManaBrewEngineAdapter.isSharedLife(request.getTeamRules())) {", "if (false) {", A, "teamTurns archenemyWithSharedTurnsIsRefused"],
  ["the board says teams, not teamTurns", EX, "rules.hasSharedTeamLife() ? \"sharedTurns\" : \"teamTurns\"", "rules.hasSharedTeamLife() ? \"sharedTurns\" : \"teams\"", A, "teamTurns theBoardSaysTeamTurns"],
  ["the next turn the next player's, not the next team's", PH, "        if (!isSharedTeamTurns() || next == null) {\n            return next;", "        if (true || next == null) {\n            return next;", A, "cr904_2 theOpponentsTakeOneTurnTogether"],
  ["team blocks only with shared life", GR, "        return sharedTeamLife || sharedTeamTurns;", "        return sharedTeamLife;", A, "cr805_10d aDefenderMayBlockForATeammate"],
  ["the block check back to shared life only", CU, "defendingPlayer.getGame().getRules().hasTeamBlocks() && !attacked.isOpponentOf(defendingPlayer)", "defendingPlayer.getGame().getRules().hasSharedTeamLife() && !attacked.isOpponentOf(defendingPlayer)", A, "cr805_10d aDefenderMayBlockForATeammate"],
  ["the AI's blocking team only itself", AI + "ComputerUtilCombat.java", "        if (ai.getGame().getRules().hasTeamBlocks()) {\n            return ai.getYourTeam();", "        if (ai.getGame().getRules().hasSharedTeamLife()) {\n            return ai.getYourTeam();", A, "cr805_10d theAiBlocksForATeammate"],
  ["the AI's block order leaves a teammate's attackers out", AI + "AiBlockController.java", "} else if (defender instanceof Player p && ComputerUtilCombat.blockingTeam(ai).contains(p)) {", "} else if (defender instanceof Player p && ai.sharedLifeTeam().contains(p)) {", A, "cr805_10d theAiBlocksForATeammate"],
  ["the AI's attack counts no teammate's blockers", AI + "AiAttackController.java", "        if (!defender.getGame().getRules().hasTeamBlocks()) {\n            return getPlayersPossibleBlockers(defender);", "        if (!defender.getGame().getRules().hasSharedTeamLife()) {\n            return getPlayersPossibleBlockers(defender);", A, "cr805_10d theAiCountsATeammatesBlockers"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-archenemy-team-turns-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[5]))];
const runTest = (cls, extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), `forge.harness.host.${cls}`], { cwd: TREE, encoding: "utf8", timeout: 900000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith(`FAIL ${cls}`));
  const out = lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`)) || l.slice(5, 80));
  if (r.status !== 0 && !out.length) out.push(`exit ${r.status}`);
  return out;
};
for (const cls of [...new Set(MUTATIONS.map((m) => m[4]))]) {
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
    console.log(`${hit ? "caught  " : "MISSED  "} ${label} (${cls}): ${failed.join(" | ") || "nothing failed"}`);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`${ran - missed} of ${ran} caught by name; files restored by sha256`);
process.exit(missed);
