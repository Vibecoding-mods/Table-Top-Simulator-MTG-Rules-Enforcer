// Break-it for the joint team block's re-ask order with teams of three (docs/handoff/team-block-2-report.md; Forge
// PhaseHandler declareJointBlockers / askJointBlocker; ThreeHeadedGiantTest's "threes" checks on the six-seat 3HG game).
// Each mutation compiles only the edited file over the harness jar, runs the test class and requires the named check to
// fail; the file is put back and checked by sha256.
// Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-team-block-2-engine.js <engine tree> [label pattern]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const PH = "forge/forge-game/src/main/java/forge/game/phase/PhaseHandler.java";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["the next re-ask not the first stale one in turn order", PH, "                    if (stale.contains(member)) {\n                        next = member;\n                        break;", "                    if (stale.contains(member) && false) {\n                        next = member;\n                        break;", "ThreeHeadedGiantTest", "cr805.10d threes reasksAfterTwoChangesGoInTurnOrder"],
  ["a partner who hasn't answered yet counted as answered", PH, "                if (mate != member && latest.containsKey(mate)) {", "                if (mate != member) {", "ThreeHeadedGiantTest", "cr805.10d threes aFirstAnswerTellsNobody"],
  ["one re-ask more before the cap", PH, "                if (round > MAX_TEAM_BLOCK_REVISIONS) {", "                if (round > MAX_TEAM_BLOCK_REVISIONS + 1) {", "ThreeHeadedGiantTest", "cr805.10d threes theCapAfterFourReasksLetsThePrimaryDecide"],
  ["an answer that changes nothing re-asks the others", PH, "        if (!Sets.newHashSet(after).equals(Sets.newHashSet(before))) {\n            boolean partnerAnswered", "        if (true) {\n            boolean partnerAnswered", "ThreeHeadedGiantTest", "cr805.10d threes aMiddlePartnersChangeReasksOnlyWhoAnswered"],
  ["a re-asked partner stays stale", PH, "        stale.remove(member);\n        latest.put(member, after);", "        latest.put(member, after);", "ThreeHeadedGiantTest", "cr805.10d threes aMiddlePartnersChangeReasksOnlyWhoAnswered"],
  ["the partner who changed not named", PH, "                combat.setTeamBlockChangedBy(member);\n", "", "ThreeHeadedGiantTest", "cr805.10d threes aChangeInAReviseRoundReasksTheOtherTwoInTurnOrder"],
  ["only the first stale partner re-asked", PH, "                if (!stale.contains(mate)) {\n                        stale.add(mate);", "                if (stale.isEmpty()) {\n                        stale.add(mate);", "ThreeHeadedGiantTest", "cr805.10d threes aChangeInAReviseRoundReasksTheOtherTwoInTurnOrder"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-team-block-2-"));
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
