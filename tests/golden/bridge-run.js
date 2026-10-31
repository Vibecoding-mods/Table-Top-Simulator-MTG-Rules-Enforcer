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

module.exports = { runAll };
