// Break-it for the engine's Three-Headed Giant checks (forge-harness ThreeHeadedGiantTest): each mutation makes one piece
// of the team code a two-player one (or undoes the revise-round title fix), compiles only the edited file over the
// harness jar, runs the test class and requires the named check to fail; the file is put back and checked by sha256.
// Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-3hg-engine.js <engine tree>
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const G = "forge/forge-game/src/main/java/forge/game/";
const H = "forge-harness/src/main/java/forge/harness/host/";
// [label, file (in the tree), from, to, check that must fail]
const MUTATIONS = [
  ["the revise title names every partner, not the one who changed", H + "ManaBrewInteractiveController.java",
    "(changer != null && !changer.equals(defender) ? changer.getName() : partnerNames)", "partnerNames", "aRevisePromptNamesThePartnerWhoChanged"],
  ["who changed the team's block is never recorded", G + "phase/PhaseHandler.java", "                combat.setTeamBlockChangedBy(member);\n", "", "theDefendingTeamOfThreeBlocksAsOneDecision"],
  ["only the team's first defender is asked again", G + "phase/PhaseHandler.java",
    "if (mate != member && latest.containsKey(mate)) {", "if (mate != member && latest.containsKey(mate) && mate == team.get(0)) {", "theDefendingTeamOfThreeBlocksAsOneDecision"],
  ["life and poison are shared with two of the team only", G + "player/Player.java",
    "        if (game.getRules().hasSharedTeamLife()) {\n            return getYourTeam();\n        }",
    "        if (game.getRules().hasSharedTeamLife()) {\n            PlayerCollection two = new PlayerCollection();\n            for (Player q : getYourTeam()) { if (two.size() < 2) two.add(q); }\n            return two;\n        }",
    "damageToOneHeadIsTheWholeTeams"],
  ["a loss takes one teammate along, not the whole team", G + "GameAction.java",
    "                    mate.loseWithTeammate(p);\n", "                    if (mate.getTeamMates(false).indexOf(p) == 0) mate.loseWithTeammate(p);\n", "aConcessionConcedesForAllThree"],
  ["poison to lose is 2HG's 15 whatever the team size", H + "ManaBrewEngineAdapter.java",
    "? request.getPoisonToLose() : 15 + 5 * (heads - 2));", "? request.getPoisonToLose() : 15);", "theRequestGivesThreeHeads45LifeAnd20Poison"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-3hg-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const runTest = (extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), "forge.harness.host.ThreeHeadedGiantTest"], { cwd: TREE, encoding: "utf8", timeout: 600000 });
  return `${r.stdout}${r.stderr}`.split("\n").filter((l) => /^FAIL cr/.test(l)).map((l) => l.split(" ")[2].replace(/:$/, ""));
};
const base = runTest(null);
if (base.length) { console.log(`BASELINE FAILS: ${base.join(", ")}`); process.exit(1); }
let missed = 0;
try {
  MUTATIONS.forEach(([label, file, from, to, name], i) => {
    const f = path.join(TREE, file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8").replace(/\r\n/g, "\n");
    const crlf = orig.includes("\r\n");
    if (src.split(from).length - 1 !== 1) { missed++; console.log(`NOT APPLIED ${label}`); return; }
    const out = path.join(tmp, `m${i}`);
    fs.mkdirSync(out);
    let failed = null;
    try {
      const next = src.replace(from, to);
      fs.writeFileSync(f, crlf ? next.replace(/\n/g, "\r\n") : next);
      const c = javac(out, [f]);
      failed = c.status === 0 ? runTest(out) : [`COMPILE ERROR ${c.stderr.split("\n")[0]}`];
    } finally {
      fs.writeFileSync(f, orig);
      if (sha(f) !== h) { console.log(`RESTORE FAILED: ${file}`); process.exit(100); }
    }
    const hit = failed.includes(name);
    if (!hit) missed++;
    console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.join(", ") || "nothing failed"}`);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`${MUTATIONS.length - missed} of ${MUTATIONS.length} caught by name; files restored by sha256`);
process.exit(missed);
