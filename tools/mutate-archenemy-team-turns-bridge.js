// Break-it for Archenemy's team turns in the bridge (docs/handoff/archenemy-team-turns-report.md; CR 904.2):
// tests/test_bridge_archenemy_team_turns.js (the four-seat game), tests/test_bridge_archenemy.js and
// tests/test_bridge_six_golden.js (the six-seat game). Each mutation switches one piece off, runs the tests, and must make
// the check it names fail by name; then the file is put back and checked by sha256. A mutation whose named check still
// passes is printed as SURVIVED.
//   node tools/mutate-archenemy-team-turns-bridge.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_archenemy_team_turns.js", "tests/test_bridge_archenemy.js", "tests/test_bridge_six_golden.js"];

// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["Archenemy asks for each player's own turns", "bridge/teams.js", "  archenemy: { rule: \"teamTurns\", name: \"Archenemy\", gameMode: null },", "  archenemy: { rule: \"teams\", name: \"Archenemy\", gameMode: null },",
    "start: the engine is asked for teamTurns in an Archenemy game"],
  ["teamTurns not a shared-turn board", "bridge/teams.js", "const sharesTurns = (pub) => pub?.teamRules?.rule === \"sharedTurns\" || pub?.teamRules?.rule === \"teamTurns\";", "const sharesTurns = (pub) => pub?.teamRules?.rule === \"sharedTurns\";",
    "turns: on the three's turns every board has all three"],
  ["the archenemy's turn a team of one", "bridge/bridge.js", "teams2hg.sharesTurns(pub) && teams2hg.turnPlayerIds(pub).length > 1 ?", "teams2hg.sharesTurns(pub) ?",
    "turns: on Blue's turns no activeTeam on any board (the table says BLUE'S TURN)"],
  ["teamTurns boards without teams", "bridge/teams.js", "const ownLifeTeams = (rule) => rule === \"teams\" || rule === \"teamTurns\";", "const ownLifeTeams = (rule) => rule === \"teams\";",
    "board: the teams, the three against Blue, their turns shared"],
  ["the teams not said shared turns", "bridge/teams.js", " ...(t.rule === \"teamTurns\" ? { turns: \"shared\" } : {}),", "",
    "board: the teams, the three against Blue, their turns shared"],
  ["the setup words say own turns", "bridge/teams.js", "(${std ? 20 : 40} life each, one turn together).", "(${std ? 20 : 40} life each, their own turns).",
    "setup: Blue at double life against the three, who take one turn together"],
  ["teamTurns read as shared life", "bridge/teams.js", "const sharesLife = (pub) => pub?.teamRules?.rule === \"sharedLife\" || pub?.teamRules?.rule === \"sharedTurns\";", "const sharesLife = (pub) => [\"sharedLife\", \"sharedTurns\", \"teamTurns\"].includes(pub?.teamRules?.rule);",
    "teamTurns: each player's own life (no shared life, no team poison)"],
];
function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
      if (m && !/^test_/.test(m[1])) failed.push(m[1]);
    }
    if (r.status !== 0 && !failed.length) failed.push(`${t} exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  }
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null; // (a label pattern: just those mutations)
const base = runTests();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let survived = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to, want] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`?? ${label}: the code to break is not there once`); survived++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTests(); } finally { fs.writeFileSync(file, text); }
  const restored = sha(file) === before;
  const named = failed.some((f) => f === want || f.startsWith(`${want}:`));
  if (!named || !restored) survived++;
  console.log(`${named ? "caught" : "SURVIVED"}: ${label} -> ${named ? want : `(wanted "${want}") ${failed.map((f) => f.slice(0, 90)).join(" | ") || "nothing failed"}`}${restored ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught by their named check, every file restored by sha256`);
process.exit(survived ? 1 : 0);
