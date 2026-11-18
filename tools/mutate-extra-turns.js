// Break-it for the extra-turn badge's cap (tests/test_table_extra_turns_lua.js; docs/stress-catalog.md #21): each
// mutation switches one piece off in a COPY of tools/engine-renderer.lua (tmp/engine-renderer.mutant.lua, loaded
// through RENDERER_LUA), runs the test and lists the checks that failed by name. The real file is never written: its
// sha256 is checked before and after each run, and the copy is removed. A mutation no check catches is printed as
// SURVIVED.
//   node tools/mutate-extra-turns.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "tools", "engine-renderer.lua");
const COPY = path.join(ROOT, "tmp", "engine-renderer.mutant.lua");
const TEST = path.join(ROOT, "tests", "test_table_extra_turns_lua.js");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const CAP = '(n > 99 and "EXTRA TURNS 99+" or ("EXTRA TURN " .. tostring(n) .. "x"))';
// [label, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["no cap: EXTRA TURN nx at any count", CAP, '("EXTRA TURN " .. tostring(n) .. "x")'],
  ["the cap at 999, not 99", '(n > 99 and "EXTRA TURNS 99+"', '(n > 999 and "EXTRA TURNS 99+"'],
  ["boundary: 99 itself capped", '(n > 99 and "EXTRA TURNS 99+"', '(n >= 99 and "EXTRA TURNS 99+"'],
  ["past 99 the label stays EXTRA TURN 99x", 'and "EXTRA TURNS 99+" or', 'and "EXTRA TURN 99x" or'],
  ["the hover's count capped too", 'local tip = tostring(pl.name or pl.color) .. " has " .. tostring(n) ..', 'local tip = tostring(pl.name or pl.color) .. " has " .. tostring(math.min(n, 99)) ..'],
  ["a hover change alone not edited (the label the same past 99)", "if now ~= nil and now.label == label and now.tooltip == tip then return end", "if now ~= nil and now.label == label then return end"],
];

const pattern = process.argv.slice(2).find((a) => !a.startsWith("--"));
const only = pattern ? new RegExp(pattern, "i") : null;
const pristine = sha(FILE);
const checkPristine = () => { if (sha(FILE) !== pristine) { console.log("REAL FILE CHANGED: tools/engine-renderer.lua"); process.exit(100); } };
const runTest = (mutant) => {
  const env = { ...process.env };
  if (mutant) env.RENDERER_LUA = COPY; else delete env.RENDERER_LUA;
  const r = spawnSync(process.execPath, [TEST], { encoding: "utf8", timeout: 600000, maxBuffer: 1 << 26, env });
  const failed = [];
  for (const line of String(r.stdout).split("\n")) if (/^FAIL /.test(line)) failed.push(line.slice(5, 110));
  if (r.status !== 0 && !failed.length) failed.push(`exit ${r.status} ${String(r.stderr).slice(0, 200)}`);
  return failed;
};
// (the test must pass on the real file first, and on an unchanged copy: a copy that fails by itself proves nothing)
const base = runTest(false);
if (base.length) { console.log(`BASELINE FAILS: ${base.join(" | ")}`); process.exit(1); }
fs.mkdirSync(path.dirname(COPY), { recursive: true });
fs.copyFileSync(FILE, COPY);
const same = runTest(true);
fs.rmSync(COPY, { force: true });
if (same.length) { console.log(`UNCHANGED COPY FAILS: ${same.join(" | ")}`); process.exit(1); }
let survived = 0, caught = 0;
const src = fs.readFileSync(FILE, "utf8");
for (const [label, from, to] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`NOT APPLIED (${n} matches) ${label}`); survived++; continue; }
  let failed;
  try { fs.writeFileSync(COPY, src.replace(from, () => to)); failed = runTest(true); }
  finally { fs.rmSync(COPY, { force: true }); checkPristine(); }
  if (failed.length) { caught++; console.log(`caught   ${label}: ${failed.slice(0, 3).join(" | ")}${failed.length > 3 ? ` (+${failed.length - 3})` : ""}`); }
  else { survived++; console.log(`SURVIVED ${label}`); }
}
console.log(`${caught} caught, ${survived} survived; the real file unchanged (sha256), the copy removed`);
process.exit(survived ? 1 : 0);
