// Golden-master test for bridge/bridge.js: replays every scenario and compares against tests/golden/bridge_golden.json.
// Fails by scenario name, with the first differing side effect.   node tests/test_bridge_golden.js
const fs = require("fs");
const path = require("path");
const { runAll } = require("./golden/bridge-run");

const GOLDEN = path.join(__dirname, "golden", "bridge_golden.json");

(async () => {
  const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  const got = await runAll();
  const byName = new Map(got.map((g) => [g.name, g]));
  let failed = 0;
  for (const w of want) {
    const g = byName.get(w.name);
    if (!g) { failed++; console.log(`FAIL ${w.name}: scenario missing`); continue; }
    const a = JSON.stringify(w), b = JSON.stringify(g);
    if (a === b) continue;
    failed++;
    const n = Math.max(w.effects.length, g.effects.length);
    let where = "result";
    for (let i = 0; i < n; i++) {
      if (JSON.stringify(w.effects[i]) !== JSON.stringify(g.effects[i])) {
        where = `effect #${i}\n    want ${String(JSON.stringify(w.effects[i])).slice(0, 400)}\n    got  ${String(JSON.stringify(g.effects[i])).slice(0, 400)}`;
        break;
      }
    }
    if (where === "result") where += `\n    want ${String(JSON.stringify(w.result)).slice(0, 400)}\n    got  ${String(JSON.stringify(g.result)).slice(0, 400)}`;
    console.log(`FAIL ${w.name}: ${where}`);
  }
  for (const g of got) if (!want.some((w) => w.name === g.name)) { failed++; console.log(`FAIL ${g.name}: new scenario not in the golden file (re-capture)`); }
  console.log(failed ? `\n${failed} of ${want.length} scenarios differ` : `all ${want.length} scenarios match`);
  process.exit(failed ? 1 : 0);
})();
