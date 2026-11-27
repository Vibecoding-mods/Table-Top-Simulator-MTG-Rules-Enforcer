// Break-it for the six-seat table golden (tests/test_table_golden_six.js): each mutation breaks one six-seat piece of
// the table's script or its build (tools/engine-renderer.lua hello, tools/make-engine-copy.js start), runs the test,
// requires it to FAIL, then puts the file back and checks it by sha256.
//   node tools/mutate-table-golden-six.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TEST = "tests/test_table_golden_six.js";
const R = "tools/engine-renderer.lua", M = "tools/make-engine-copy.js";

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["table: hello without the six seats", R, "  if ENGINE_TABLE_SEATS ~= nil then m.tableSeats = ENGINE_TABLE_SEATS end\n  if engineRulesInto", "  if engineRulesInto"],
  ["table: hello with the four seats", R, "m.tableSeats = ENGINE_TABLE_SEATS end\n  if engineRulesInto", "m.tableSeats = { \"White\", \"Red\", \"Yellow\", \"Blue\" } end\n  if engineRulesInto"],
  ["build: the six seats not set", M, "  if (SEATS.length !== 4) save.LuaScript += `\\nENGINE_TABLE_SEATS = TABLE_PROFILE.seats`;", "  void 0;"],
  ["build: start without the six seats", M, "  if ENGINE_TABLE_SEATS ~= nil then start.tableSeats = ENGINE_TABLE_SEATS end\n", ""],
];

function runTest() {
  const r = spawnSync(process.execPath, [TEST], { cwd: ROOT, encoding: "utf8", timeout: 1200000, maxBuffer: 1 << 26 });
  const out = (r.stdout || "") + (r.stderr || "");
  return { status: r.status, fails: out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(0, 120)) };
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const base = runTest();
console.log(base.status === 0 ? "baseline: green" : `BASELINE FAILS: ${base.fails.join(" | ")}`);
if (base.status !== 0) process.exit(1);
let missed = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`NOT APPLIED ${label}: the code to break is not there once`); missed++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let res;
  try { res = runTest(); } finally { fs.writeFileSync(file, text); }
  if (sha(file) !== before) { console.log(`RESTORE FAILED: ${rel}`); process.exit(100); }
  const hit = res.status !== 0 && res.fails.length > 0;
  if (!hit) missed++;
  console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${res.fails.slice(0, 2).join(" | ") || "nothing failed (exit " + res.status + ")"}`);
}
console.log(`${list.length - missed} of ${list.length} caught; files restored by sha256`);
process.exit(missed ? 1 : 0);
