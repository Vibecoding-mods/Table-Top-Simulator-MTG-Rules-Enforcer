// Break-it for the table polish (docs/handoff/table-polish-report.md): the schemes at the oversized card's shape
// (tools/engine-renderer.lua engineZoneScale, ENGINE_SCHEME, engineSchemes; tests/test_table_archenemy_view.js) and the
// infinity sign behind one switch (ENGINE_INF, engineInfText, engineCompact, engineLifeLook, the token badge;
// tests/test_table_inf_glyph.js). Each mutation changes the renderer, runs both tests and requires the named check to
// fail; the file is put back and checked by sha256.
//   node tools/mutate-table-polish.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const R = "tools/engine-renderer.lua";
const TESTS = ["tests/test_table_archenemy_view.js", "tests/test_table_inf_glyph.js"];
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const SHAPE = "shape: the scheme set in motion, the ongoing row and the deck at the oversized card's size; planes 1.5; others as before";
// [label, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["only the scheme set in motion large", "  if zone == \"schemenow\" or zone == \"scheme\" or zone == \"schemedeck\" then return ENGINE_SCHEME.scale end", "  if zone == \"schemenow\" then return ENGINE_SCHEME.scale end", SHAPE],
  ["the scheme at a normal card's size", "y = 2.4, scale = 1.4 }", "y = 2.4, scale = 1 }", SHAPE],
  ["the plane's size changed with the schemes'", "  if zone == \"plane\" then return 1.5 end", "  if zone == \"plane\" then return ENGINE_SCHEME.scale end", SHAPE],
  ["a spawned card left at scale 1", "    if zs ~= 1 then obj.setScale(Vector(zs, 1, zs)) end", "", "shape: a card spawned in a zone takes its size (place)"],
  ["an existing card not resized", "  local wantScale = engineZoneScale(meta and meta.zone)", "  local wantScale = 1", "shape: a card already there is resized to its zone's size each board"],
  ["schemes turned as planes are", "  local rot = Vector(0, g.rotY, 0)\n  local nowCard", "  local rot = Vector(0, g.rotY + 90, 0)\n  local nowCard", "shape: schemes are never turned as a plane is (upright, the archenemy's seat's rotation)"],
  ["the row too tight for the scheme size", "row = 3.4, rowStart = 4.4", "row = 3.1, rowStart = 4.4", "shape: the row's schemes keep a gap at that size"],
  ["the row against the scheme set in motion", "row = 3.4, rowStart = 4.4", "row = 3.4, rowStart = 3.3", "shape: the row and the deck stay clear of the scheme set in motion"],
  ["the switch ignored", "  return ENGINE_INF.ascii and ENGINE_INF.fallback or ENGINE_INF.glyph", "  return ENGINE_INF.glyph", "fallback: INF"],
  ["the cap's sign a literal again", "  if n >= ENGINE_HUGE then return engineInfText() elseif", "  if n >= ENGINE_HUGE then return \"∞\" elseif", "fallback: the cap reads INF, minus it -INF"],
  ["the token badge a literal again", "\"grp\", \"x\" .. engineInfText(), BADGE.black,", "\"grp\", \"x∞\", BADGE.black,", "badge: the token stack of infinitely many reads \"x\" .. engineInfText()"],
  ["the sign counted as three letters", "  local letters = #label - (string.find(label, ENGINE_INF.glyph, 1, true) and (#ENGINE_INF.glyph - 1) or 0)", "  local letters = #label", "default: the life counter at the cap: one letter, the counter's own font"],
  ["the fallback the default", "ENGINE_INF = { glyph = \"∞\", fallback = \"INF\", ascii = false }", "ENGINE_INF = { glyph = \"∞\", fallback = \"INF\", ascii = true }", "default: the sign"],
];
const NAMES = [...new Set(MUTATIONS.map((m) => m[3]))];
function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const l of out.split("\n")) if (l.startsWith("FAIL ")) failed.push(NAMES.find((n) => l.startsWith(`FAIL ${n}:`) || l === `FAIL ${n}`) || l.slice(5, 100));
    if (r.status !== 0 && !failed.length) failed.push(`${t} exit ${r.status}`);
  }
  return failed;
}
const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const base = runTests();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let missed = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
const file = path.join(ROOT, R);
for (const [label, from, to, name] of list) {
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`NOT APPLIED ${label}`); missed++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTests(); } finally { fs.writeFileSync(file, text); }
  if (sha(file) !== before) { console.log(`RESTORE FAILED: ${R}`); process.exit(100); }
  const hit = failed.includes(name);
  if (!hit) missed++;
  console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.slice(0, 3).join(" | ") || "nothing failed"}`);
}
console.log(`${list.length - missed} of ${list.length} caught by name; files restored by sha256`);
process.exit(missed ? 1 : 0);
