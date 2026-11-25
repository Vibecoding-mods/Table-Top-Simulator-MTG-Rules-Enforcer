// The whole-golden adversary (tools/mutate-table.js) still fits today's table script: every edit applies exactly once,
// changes something and leaves a script that parses. 41 of its 162 edits went stale unseen before 2026-11-24; this
// gate fails by name on the first that does again (repair it in tools/mutate-table.js).
//   node tests/test_mutate_table_anchors.js
const path = require("path");
const { spawnSync } = require("child_process");

const r = spawnSync(process.execPath, [path.join(__dirname, "..", "tools", "mutate-table.js"), "--check"], { encoding: "utf8" });
const out = String(r.stdout || "") + String(r.stderr || "");
if (r.status !== 0) {
  for (const l of out.split("\n").filter((x) => /STALE/.test(x))) console.log(`FAIL ${l.trim()}`);
  if (!/STALE/.test(out)) console.log(`FAIL the mutation tool's preflight did not run: ${out.split("\n").find((l) => l.trim()) || `exit ${r.status}`}`);
  process.exit(1);
}
console.log(`PASSED: ${out.trim().split("\n").pop()}`);
