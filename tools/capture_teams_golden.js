// Records bridge/teams.js's current behaviour on every case in tests/golden/teams-run.js: each export's return value,
// any throw (type and message), callback calls, argument changes and aliasing, plus the public surface.
//   node tools/capture_teams_golden.js            -> tests/golden/teams_golden.json
//   node tools/capture_teams_golden.js --check    -> runs twice and fails unless both runs are byte-identical
const fs = require("fs");
const path = require("path");
const { runAll, thrown } = require("../tests/golden/teams-run");

const OUT = path.join(__dirname, "..", "tests", "golden", "teams_golden.json");

const a = JSON.stringify(runAll(), null, 1);
const b = JSON.stringify(runAll(), null, 1);
if (a !== b) {
  fs.writeFileSync(OUT + ".run1", a); fs.writeFileSync(OUT + ".run2", b);
  console.error("NOT DETERMINISTIC: the two runs differ (see .run1 / .run2)");
  process.exit(1);
}
if (process.argv.includes("--check")) { console.log("deterministic: two runs identical"); process.exit(0); }
fs.writeFileSync(OUT, a + "\n");
const rows = JSON.parse(a);
const t = thrown(rows);
console.log(`recorded ${rows.length} cases -> ${path.relative(process.cwd(), OUT)} (${(a.length / 1024).toFixed(0)} KB); ${t.length} record a throw${t.length ? ":\n  " + t.join("\n  ") : ""}`);
