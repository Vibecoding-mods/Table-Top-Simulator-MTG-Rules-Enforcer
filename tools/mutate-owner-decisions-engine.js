// Break-it for the owner's engine decisions of 2026-11-17 (docs/handoff/owner-decisions-1117-report.md): the team-block
// cap's notice "<Primary> decides (team leader)" (Forge PhaseHandler; SharedCombatTest) and the restore points' thinning
// that keeps each turn's first (ManaBrewInteractiveSession.thinCheckpoints; BigBoardFixesTest, StressCapsTest). Each
// mutation compiles only the edited file over the harness jar, runs the named test class and requires the named check
// to fail; the file is put back and checked by sha256.
// Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-owner-decisions-engine.js <engine tree> [label pattern]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const S = "forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveSession.java";
const PH = "forge/forge-game/src/main/java/forge/game/phase/PhaseHandler.java";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["the old cap notice", PH, "primary.getName() + \" decides (team leader)\"", "primary.getName() + \" settles the team's blocks (rule 805.2)\"", "SharedCombatTest", "cr805.2 thePrimarySettlesTheBlocksAtTheCap"],
  ["the cap notice names the partner, not the primary", PH, "primary.getName() + \" decides (team leader)\"", "order.get(order.size() - 1).getName() + \" decides (team leader)\"", "SharedCombatTest", "cr805.2 thePrimarySettlesTheBlocksAtTheCap"],
  ["plain oldest first again", S, "            final Checkpoint victim = thinVictim(checkpoints, keep);", "            final Checkpoint victim = checkpoints.peekFirst();", "BigBoardFixesTest", "checkpoints: past the cap the oldest turns' in-between ones go first, the current turn's last"],
  ["plain oldest first again (the session)", S, "            final Checkpoint victim = thinVictim(checkpoints, keep);", "            final Checkpoint victim = checkpoints.peekFirst();", "StressCapsTest", "restorePointsAreCappedAt40KeepingTheTurnsFirst"],
  ["plain oldest first again (the cap of the session)", S, "            final Checkpoint victim = thinVictim(checkpoints, keep);", "            final Checkpoint victim = checkpoints.peekFirst();", "BigBoardFixesTest", "checkpoints: the session keeps no more than the cap"],
  ["a turn's first taken for an in-between", S, "            if (c.turn != current && previous != null && previous.turn == c.turn && c != keep) {", "            if (c.turn != current && (previous == null || previous.turn == c.turn) && c != keep) {", "BigBoardFixesTest", "checkpoints: past the cap the oldest turns' in-between ones go first, the current turn's last"],
  ["the current turn's points before an older turn's first", S, "            if (c.turn != current && previous != null && previous.turn == c.turn && c != keep) {", "            if (previous != null && previous.turn == c.turn && c != keep) {", "BigBoardFixesTest", "checkpoints: past the turns' firsts the oldest turns go"],
  ["the older turns' firsts never dropped", S, "            if (c.turn != current && c != keep) {\n                return c;", "            if (false) {\n                return c;", "BigBoardFixesTest", "checkpoints: past the turns' firsts the oldest turns go"],
  ["the newest may go", S, "            } else if (c != newest && c != keep) {", "            } else if (c != keep) {", "BigBoardFixesTest", "checkpoints: past the turns' firsts the oldest turns go"],
  ["the vote's point thinned (the rule)", S, "            if (c.turn != current && previous != null && previous.turn == c.turn && c != keep) {", "            if (c.turn != current && previous != null && previous.turn == c.turn) {", "BigBoardFixesTest", "checkpoints: a pending vote's point is never thinned"],
  ["the vote's point thinned (the session)", S, "restoreVote != null && restoreVote.status == RestoreVoteStatus.PENDING ? restoreVote.checkpoint : null);", "null);", "StressCapsTest", "aPendingRewindVotesPointIsNeverThinned"],
  ["the size cap dropped", S, "        while (checkpoints.size() > cap) {\n            final Checkpoint victim", "        while (checkpoints.size() > cap + 1) {\n            final Checkpoint victim", "BigBoardFixesTest", "checkpoints: the session keeps no more than the cap"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-owner-"));
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
