// Break-it for live check 1's table fixes (docs/handoff/live-check-1-fixes-report.md; tests/test_table_live_check_1.js):
// the GIF frame off the marks strip, FROM EXILE, the planned attack line. Each mutation switches one piece off, runs the
// test, and must make the check it names fail by name; then the file is put back and checked by sha256. A mutation
// whose named check still passes is printed as SURVIVED.
//   node tools/mutate-live-check-1.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_table_live_check_1.js"];
const R = "tools/engine-renderer.lua", B = "bridge/bridge.js";

// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["the frame ignores the marks strip", R, "      local free = not engineMarksStripHit(strip, p, half)\n", "      local free = true\n",
    "frame: 4-player White's GIF frame is clear of the marks strip under the life counter"],
  ["the strip one box deep", R, "z2 = F.top + F.boxes * (380 + F.gap) / F.perLocal,", "z2 = F.top + (380 + F.gap) / F.perLocal,",
    "frame: 4-player White's GIF frame is clear of the marks strip under the life counter"],
  ["the strip on the wrong side of the counter", R, "  local xa, xb = sign * -F.inner / F.perLocal, sign * (F.max - F.inner) / F.perLocal\n", "  local xa, xb = -sign * -F.inner / F.perLocal, -sign * (F.max - F.inner) / F.perLocal\n",
    "strip: 4-player White's marks strip, where the boxes go, under the counter on the mat's inner corner"],
  ["the button x not negated", R, "  local bx, h = -l.x, half * s.k\n", "  local bx, h = l.x, half * s.k\n",
    "strip: 4-player White's marks strip, where the boxes go, under the counter on the mat's inner corner"],
  ["every spot taken: back to the first spot, on the strip", R, "  return offStrip or first\n", "  return first\n",
    "frame: with every spot taken, the frame still keeps off the marks strip"],
  ["no FROM EXILE", R, "  if c.og == \"graveyard\" or c.og == \"exile\" then\n", "  if c.og == \"graveyard\" then\n",
    "exile: a playable row card from exile says FROM EXILE, its hover where it is cast from"],
  ["the hover never says why", R, "    if type(c.ogw) == \"string\" and c.ogw ~= \"\" then tip = tip .. \": \" .. c.ogw end\n", "",
    "exile: its hover says why when the bridge knows"],
  ["the bridge sends no og for exile", B, "...(row && zone === \"exile\" && !c.isFaceDown ? { og: \"exile\",", "...(false ? { og: \"exile\",",
    "bridge: an adventure creature castable from exile is in the row with og exile"],
  ["the bridge sends no why", B, "{ og: \"exile\", ...(exileWhy(c) ? { ogw: exileWhy(c) } : {}) }", "{ og: \"exile\" }",
    "bridge: a card another let be played says why (ogw)"],
  ["a foretold card labelled for everyone", B, "...(row && zone === \"exile\" && !c.isFaceDown ? { og: \"exile\",", "...(row && zone === \"exile\" ? { og: \"exile\",",
    "bridge: a foretold card (face down to the others) has no og: its label is a button everyone may see"],
  ["the planned line thin again", R, "planned = { color = {1, 0.75, 0.8}, thickness = 0.1651 } }", "planned = { color = {1, 0.75, 0.8}, thickness = 0.1201 } }",
    "line: the planned line is about a block line's width"],
  ["the planned line as wide as the attack line", R, "planned = { color = {1, 0.75, 0.8}, thickness = 0.1651 } }", "planned = { color = {1, 0.75, 0.8}, thickness = 0.2201 } }",
    "line: its width is its own (lines are told apart by width)"],
  ["halfway to white again", R, "{ (1 + 3 * rgb[1]) / 4, (1 + 3 * rgb[2]) / 4, (1 + 3 * rgb[3]) / 4 }", "{ (1 + rgb[1]) / 2, (1 + rgb[2]) / 2, (1 + rgb[3]) / 2 }",
    "line: a quarter towards white, not halfway (White's own stays white)"],
  ["the high arc again", R, "plannedStyle(pa[3]), 0.3)", "plannedStyle(pa[3]), 0.5)",
    "line: drawn solid on a block line's arc (engineDrawLines' call)"],
];
function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
      if (m && !/^test_/.test(m[1])) failed.push(m[1]);
    }
    if (r.status !== 0 && !failed.length) failed.push(`${t} exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  }
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null; // (a label pattern: just those mutations)
const base = runTests();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let survived = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to, want] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`?? ${label}: the code to break is not there once`); survived++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTests(); } finally { fs.writeFileSync(file, text); }
  const restored = sha(file) === before;
  const named = failed.some((f) => f === want || f.startsWith(`${want}:`));
  if (!named || !restored) survived++;
  console.log(`${named ? "caught" : "SURVIVED"}: ${label} -> ${named ? want : `(wanted "${want}") ${failed.map((f) => f.slice(0, 90)).join(" | ") || "nothing failed"}`}${restored ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught by their named check, every file restored by sha256`);
process.exit(survived ? 1 : 0);
