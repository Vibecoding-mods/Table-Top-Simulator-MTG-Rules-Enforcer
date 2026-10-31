// Records what the table's Global script does in the recorded games (tests/golden/table-run.js), built from the
// current sources, into tests/golden/table_golden.json. Runs twice and refuses unless both runs are identical.
//   node tools/capture_table_golden.js [--check]
const fs = require("fs");
const path = require("path");
const { runAll, buildSave } = require("../tests/golden/table-run");

const OUT = path.join(__dirname, "..", "tests", "golden", "table_golden.json");
const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const a = JSON.stringify(runAll(save), null, 1);
const b = JSON.stringify(runAll(save), null, 1);
if (a !== b) { fs.writeFileSync(OUT + ".run1", a); fs.writeFileSync(OUT + ".run2", b); console.error("NOT DETERMINISTIC: the two runs differ"); process.exit(1); }
if (process.argv.includes("--check")) { console.log("deterministic: two runs identical"); process.exit(0); }
fs.writeFileSync(OUT, a + "\n");
const r = JSON.parse(a);
console.log(`recorded ${r.length} games, ${r.reduce((n, g) => n + g.steps.length, 0)} steps, ${r.reduce((n, g) => n + g.steps.reduce((k, s) => k + s.fx.length, 0), 0)} table actions -> ${path.relative(process.cwd(), OUT)} (${(a.length / 1024).toFixed(0)} KB)`);
