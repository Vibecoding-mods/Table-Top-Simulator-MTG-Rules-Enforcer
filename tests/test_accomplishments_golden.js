// Golden-master test for bridge/accomplishments.js: replays every case in tests/golden/accomplishments-run.js and compares against
// tests/golden/accomplishments_golden.json. Fails by case name with the recorded and the live row.   node tests/test_accomplishments_golden.js
const fs = require("fs");
const path = require("path");

const GOLDEN = path.join(__dirname, "golden", "accomplishments_golden.json");

(async () => {
  let got;
  try {
    got = JSON.parse(JSON.stringify(await require("./golden/accomplishments-run").runAll()));
  } catch (e) {
    // (a module that no longer loads, or a scenario that crashes the runner, is a named failure, not a crash)
    console.log(`FAIL load: bridge/accomplishments.js or the runner threw ${e?.constructor?.name}: ${e?.message}`);
    process.exit(1);
  }
  const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  const byName = new Map(got.map((g) => [g.name, g]));
  let failed = 0;
  for (const w of want) {
    const g = byName.get(w.name);
    if (!g) { failed++; console.log(`FAIL ${w.name}: case missing`); continue; }
    if (JSON.stringify(w) === JSON.stringify(g)) continue;
    failed++;
    let where = "";
    if (Array.isArray(w.effects) && Array.isArray(g.effects)) {
      const n = Math.max(w.effects.length, g.effects.length);
      for (let i = 0; i < n; i++) if (JSON.stringify(w.effects[i]) !== JSON.stringify(g.effects[i])) { where = ` at effect #${i}\n    want ${String(JSON.stringify(w.effects[i])).slice(0, 400)}\n    got  ${String(JSON.stringify(g.effects[i])).slice(0, 400)}`; break; }
    }
    console.log(`FAIL ${w.name}${where || `\n    want ${JSON.stringify(w).slice(0, 400)}\n    got  ${JSON.stringify(g).slice(0, 400)}`}`);
  }
  for (const g of got) if (!want.some((w) => w.name === g.name)) { failed++; console.log(`FAIL ${g.name}: new case not in the golden file (re-capture)`); }
  console.log(failed ? `\n${failed} of ${want.length} cases differ` : `all ${want.length} cases match`);
  process.exit(failed ? 1 : 0);
})();
