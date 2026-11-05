// Runs every bridge scenario on a fresh, sandboxed bridge and returns [{ name, effects, result }].
// A scenario that throws records the error by name instead of stopping the run.
const harness = require("../bridge-harness");

async function runAll() {
  const cases = require("./bridge-cases");
  const out = [];
  for (const c of cases) {
    const h = harness.load(c.harness || {});
    let result;
    try { result = await c.run(h); } catch (e) { result = { threw: `${e.constructor.name}: ${e.message}` }; }
    out.push({ name: c.name, effects: JSON.parse(JSON.stringify(h.effects)), result: result === undefined ? null : JSON.parse(JSON.stringify(result)) });
  }
  harness.restore();
  return out;
}

// Scenarios that ended in a programming error (a ReferenceError, TypeError...). One was recorded as the expected
// result on 2026-11-05 and the test went on passing while the real table's Flare of Duplication drop failed, so the
// capture refuses them and the test fails on them, whatever the golden file says.
function codeErrors(results) {
  return results.filter((r) => /^(Reference|Type|Syntax|Range)Error\b/.test(r.result?.threw || "")).map((r) => `${r.name}: ${r.result.threw}`);
}

module.exports = { runAll, codeErrors };
