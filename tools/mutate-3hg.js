// Break-it for Three-Headed Giant in the bridge (tests/test_bridge_3hg.js, and with --golden the golden master's 3HG
// scenarios): each mutation switches one piece of the 3HG code off, runs the tests, lists the checks that failed by
// name, then puts the file back and checks it by sha256. A mutation no check catches is printed as SURVIVED.
//   node tools/mutate-3hg.js [--golden] [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
// (the golden master too, with --golden: the new 3HG scenarios must change by name; it needs a large heap)
const TESTS = [["tests/test_bridge_3hg.js", []], ...(process.argv.includes("--golden") ? [["tests/test_bridge_golden.js", ["--max-old-space-size=8192"]]] : [])];

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["TEAM_MODES: 3HG on any table", "bridge/teams.js", "gameMode: null, seats: 6 },", "gameMode: null },"],
  ["TEAM_MODES: 3HG in Commander only", "bridge/teams.js", "\"3hg\": { rule: \"sharedLife\", name: \"Three-Headed Giant\", gameMode: null,", "\"3hg\": { rule: \"sharedLife\", name: \"Three-Headed Giant\", gameMode: \"commander\","],
  ["teamModeProblem: a mode for either game mode refused", "bridge/teams.js", "  if (t.gameMode == null) return null;\n", ""],
  ["setupOf: 3HG's teams as sent", "bridge/teams.js", "return { teams: { ...THREE_TEAMS }, mode: \"3hg\"", "return { teams: teamsOf(m.teams) || {}, mode: \"3hg\""],
  ["setupOf: 3HG with shared turns", "bridge/teams.js", "mode: \"3hg\", jugg: null, turns: null };", "mode: \"3hg\", jugg: null, turns: m?.teamTurns === \"shared\" ? \"shared\" : null };"],
  ["THREE_TEAMS: alternating seats", "bridge/teams.js", "{ White: 1, Red: 1, Yellow: 1, Green: 2, Blue: 2, Purple: 2 }", "{ White: 1, Red: 2, Yellow: 1, Green: 2, Blue: 1, Purple: 2 }"],
  ["teamsProblem: 3HG with any count", "bridge/teams.js", "if (mode === \"3hg\") return total === SIX_COLORS.length ? null :", "if (mode === \"3hg\") return true ? null :"],
  ["setupWords: 2HG's life said", "bridge/teams.js", "(shared life: ${std ? 45 : 120} a team, poison 20;", "(shared life: ${std ? 30 : 80} a team, poison 20;"],
  ["start: the seat count not checked", "bridge/bridge.js", "  if (seatsWanted && TABLE_COLORS.length !== seatsWanted) {", "  if (false) {"],
];

const pattern = process.argv.slice(2).find((a) => !a.startsWith("--"));
const only = pattern ? new RegExp(pattern, "i") : null;
const runTests = () => {
  const failed = [];
  for (const [t, nodeArgs] of TESTS) {
    const r = spawnSync(process.execPath, [...nodeArgs, path.join(ROOT, t)], { encoding: "utf8", timeout: 1200000, maxBuffer: 1 << 26 });
    for (const line of r.stdout.split("\n")) if (/^FAIL /.test(line) && !/^FAIL test_/.test(line)) failed.push(line.slice(5, 90));
    if (r.status !== 0 && !failed.length) failed.push(`${t} exit ${r.status}`);
  }
  return failed;
};
const base = runTests();
if (base.length) { console.log(`BASELINE FAILS: ${base.join(" | ")}`); process.exit(1); }
let survived = 0, caught = 0;
for (const [label, file, from, to] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  const f = path.join(ROOT, file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8");
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`NOT APPLIED (${n} matches) ${label}`); survived++; continue; }
  let failed;
  try { fs.writeFileSync(f, src.replace(from, to)); failed = runTests(); }
  finally { fs.writeFileSync(f, orig); if (sha(f) !== h) { console.log(`RESTORE FAILED: ${file}`); process.exit(100); } }
  if (failed.length) { caught++; console.log(`caught   ${label}: ${failed.slice(0, 3).join(" | ")}${failed.length > 3 ? ` (+${failed.length - 3})` : ""}`); }
  else { survived++; console.log(`SURVIVED ${label}`); }
}
console.log(`${caught} caught, ${survived} survived; files restored by sha256`);
process.exit(survived ? 1 : 0);
