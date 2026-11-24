// Records bridge/accomplishments.js's current behaviour on every case in tests/golden/accomplishments-run.js (steamKey on a grid,
// sessions on a frozen clock with a recording store and log).
//   node tools/capture_accomplishments_golden.js            -> tests/golden/accomplishments_golden.json
//   node tools/capture_accomplishments_golden.js --check    -> runs twice and fails unless both runs are byte-identical
const fs = require("fs");
const path = require("path");
const { runAll } = require("../tests/golden/accomplishments-run");

const OUT = path.join(__dirname, "..", "tests", "golden", "accomplishments_golden.json");

(async () => {
  const a = JSON.stringify(await runAll(), null, 1);
  const b = JSON.stringify(await runAll(), null, 1);
  if (a !== b) {
    fs.writeFileSync(OUT + ".run1", a); fs.writeFileSync(OUT + ".run2", b);
    console.error("NOT DETERMINISTIC: the two runs differ (see .run1 / .run2)");
    process.exit(1);
  }
  if (process.argv.includes("--check")) { console.log("deterministic: two runs identical"); return; }
  fs.writeFileSync(OUT, a + "\n");
  const rows = JSON.parse(a);
  const thrown = rows.filter((r) => r.threw).map((r) => `${r.name}: ${r.threw.type} ${r.threw.message}`);
  console.log(`recorded ${rows.length} cases -> ${path.relative(process.cwd(), OUT)} (${(a.length / 1024).toFixed(0)} KB); ${thrown.length} record a throw${thrown.length ? ":\n  " + thrown.join("\n  ") : ""}`);
})();
