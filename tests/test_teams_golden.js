// Golden-master test for bridge/teams.js: replays every case in tests/golden/teams-run.js and compares against
// tests/golden/teams_golden.json (return value, throw, callback calls, argument changes, aliasing, public surface).
// Fails by case name with the recorded and the live row.   node tests/test_teams_golden.js
const fs = require("fs");
const path = require("path");

const GOLDEN = path.join(__dirname, "golden", "teams_golden.json");
let got;
try {
  got = require("./golden/teams-run").runAll();
} catch (e) {
  // (a module that no longer loads is a named failure, not a crash)
  console.log(`FAIL load: bridge/teams.js or the runner threw ${e?.constructor?.name}: ${e?.message}`);
  process.exit(1);
}
const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
const byName = new Map(got.map((g) => [g.name, g]));
let failed = 0;
for (const w of want) {
  const g = byName.get(w.name);
  if (!g) { failed++; console.log(`FAIL ${w.name}: case missing`); continue; }
  const a = JSON.stringify(w), b = JSON.stringify(g);
  if (a === b) continue;
  failed++;
  console.log(`FAIL ${w.name}\n    want ${a.slice(0, 500)}\n    got  ${b.slice(0, 500)}`);
}
for (const g of got) if (!want.some((w) => w.name === g.name)) { failed++; console.log(`FAIL ${g.name}: new case not in the golden file (re-capture)`); }
console.log(failed ? `\n${failed} of ${want.length} cases differ` : `all ${want.length} cases match`);
process.exit(failed ? 1 : 0);
