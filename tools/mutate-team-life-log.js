// Break-it for the team's life line (tests/test_bridge_team_life_log.js; bridge.js logEvents): each mutation switches one
// piece off in a COPY of bridge.js (bridge/bridge.mutant.js, loaded through BRIDGE_PATH), runs the test and requires the
// named check to fail. bridge.js is never written: its sha256 is checked before and after each run, and the copy is
// removed.
// (Not mutations: the cause from one partner's parts instead of the partners' together, and commander damage from the
// first partner only. In every case here one partner's parts are all the parts, and the partner with commander damage is
// listed first, so neither change could be seen.)
//   node tools/mutate-team-life-log.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REAL = path.join(ROOT, "bridge", "bridge.js");
const COPY = path.join(ROOT, "bridge", "bridge.mutant.js");
const TEST = path.join(ROOT, "tests", "test_bridge_team_life_log.js");
const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
// [label, from (must occur once), to, the check that must fail]
const MUTATIONS = [
  ["partners never merged", "    if (same.length < 2) { out.push(lifeLine([row.p], row.before, row.l, row.parts)); continue; }", "    if (true) { out.push(lifeLine([row.p], row.before, row.l, row.parts)); continue; }", "2HG: a shared loss is one team line, its cause kept"],
  ["every changed player merged, team or not", "    const mates = me ? teams2hg.teamOf(me, pub).map((q) => q.id) : [row.p];", "    const mates = lifeRows.map((r) => r.p);", "free-for-all: a line a player"],
  ["partners merged though their rows differ", "    const same = lifeRows.filter((r) => mates.includes(r.p) && r.before === row.before && r.l === row.l);", "    const same = lifeRows.filter((r) => mates.includes(r.p));", "2HG: partners whose rows don't show the same change keep their own lines"],
  ["the team line without its cause", "    out.push(lifeLine(same.map((r) => r.p), row.before, row.l, all.length && sumOf(all) === row.l - row.before ? all : one ? one.parts : []));", "    out.push(lifeLine(same.map((r) => r.p), row.before, row.l, []));", "2HG: a shared loss is one team line, its cause kept"],
  ["only the first partner named", "    return `${ids.map(who).join(\" + \")}: ${before}", "    return `${who(ids[0])}: ${before}", "3HG: a shared loss is one line for the three partners"],
  ["a merged partner written again", "    if (merged.has(row.p)) continue;\n", "", "2HG: a shared loss is one team line, its cause kept"],
];
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const pristine = sha(REAL);
const check = () => { if (sha(REAL) !== pristine) { console.log("REAL FILE CHANGED: bridge/bridge.js"); process.exit(100); } };
const run = (mutant) => {
  const env = { ...process.env };
  if (mutant) env.BRIDGE_PATH = COPY; else delete env.BRIDGE_PATH;
  const r = spawnSync(process.execPath, [TEST], { encoding: "utf8", env });
  const names = String(r.stdout).split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5));
  if (r.status !== 0 && !names.length) names.push(`exit ${r.status} ${String(r.stderr).slice(0, 200)}`);
  return names;
};
const src = fs.readFileSync(REAL, "utf8");
if (run(false).length) { console.log("BASELINE FAILS"); process.exit(1); }
fs.writeFileSync(COPY, src);
const same = run(true);
fs.rmSync(COPY, { force: true });
if (same.length) { console.log(`UNCHANGED COPY FAILS: ${same.join(" | ")}`); process.exit(1); }
let caught = 0, missed = 0;
for (const [label, from, to, name] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  const n = src.split(from).length - 1;
  if (n !== 1) { missed++; console.log(`NOT APPLIED (${n} matches) ${label}`); continue; }
  let failed;
  try { fs.writeFileSync(COPY, src.replace(from, () => to)); failed = run(true); }
  finally { fs.rmSync(COPY, { force: true }); check(); }
  if (failed.some((l) => l.startsWith(`${name}:`))) { caught++; console.log(`caught   ${label}: ${failed.map((l) => l.split(": got")[0].slice(0, 80)).join(" | ")}`); }
  else { missed++; console.log(`MISSED   ${label}: ${failed.map((l) => l.slice(0, 90)).join(" | ") || "nothing failed"}`); }
}
console.log(`${caught} of ${caught + missed} caught by name; bridge.js unchanged (sha256), the copy removed`);
process.exit(missed ? 1 : 0);
