// Records the bridge's current behaviour on every scenario in tests/golden/bridge-cases.js:
// everything it sends TTS and the engine, logs, writes and requests, plus each scenario's return value.
//   node tools/capture_bridge_golden.js            -> tests/golden/bridge_golden.json
//   node tools/capture_bridge_golden.js --check    -> runs twice and fails unless both runs are byte-identical
const fs = require("fs");
const path = require("path");
const { runAll, codeErrors } = require("../tests/golden/bridge-run");

const OUT = path.join(__dirname, "..", "tests", "golden", "bridge_golden.json");

(async () => {
  const a = JSON.stringify(await runAll(), null, 1);
  const b = JSON.stringify(await runAll(), null, 1);
  if (a !== b) {
    fs.writeFileSync(OUT + ".run1", a); fs.writeFileSync(OUT + ".run2", b);
    console.error("NOT DETERMINISTIC: the two runs differ (see .run1 / .run2)");
    process.exit(1);
  }
  const crashed = codeErrors(JSON.parse(a));
  if (crashed.length) {
    console.error(`NOT RECORDED: ${crashed.length} scenario(s) crashed with a programming error:\n  ${crashed.join("\n  ")}`);
    process.exit(1);
  }
  if (process.argv.includes("--check")) { console.log("deterministic: two runs identical"); return; }
  fs.writeFileSync(OUT, a + "\n");
  const n = JSON.parse(a).length;
  console.log(`recorded ${n} scenarios -> ${path.relative(process.cwd(), OUT)} (${(a.length / 1024).toFixed(0)} KB)`);
})();
