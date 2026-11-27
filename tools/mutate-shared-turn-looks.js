// Break-it for the shared team turn's looks (2HG Level 2: tests/test_table_shared_turn.js, tests/test_bridge_2hg_level2.js):
// each mutation switches one piece off (the TTS turn colour in tools/engine-renderer.lua, the game log's turn header in
// bridge/bridge.js), runs both tests, lists the checks that failed by name, then puts the file back and checks it by
// sha256. A mutation no check catches is printed as SURVIVED.
//   node tools/mutate-shared-turn-looks.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_table_shared_turn.js", "tests/test_bridge_2hg_level2.js"];
const R = "tools/engine-renderer.lua";
const B = "bridge/bridge.js";
const OWNER_ONE = "`${nameOf(activeId)}'s`);";

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["turn colour: the active player only", R, "  for _, c in ipairs(m.activeTeam or {}) do\n    if Player[c] ~= nil and Player[c].seated then return c end\n  end\n", ""],
  ["turn colour: the partner even when the active player is seated", R, "  if Player[m.active] ~= nil and Player[m.active].seated then return m.active end\n", ""],
  ["turn colour: an unseated partner", R, "    if Player[c] ~= nil and Player[c].seated then return c end", "    if Player[c] ~= nil then return c end"],
  ["turn colour: the key without the team", R, "  return tostring(m.active) .. (m.activeTeam ~= nil and (\"+\" .. table.concat(m.activeTeam, \"+\")) or \"\")", "  return tostring(m.active)"],
  ["turn colour: set every board", R, "  if m.active ~= nil and engineTurnKey(m) ~= lastTurnSet then\n", "  if m.active ~= nil then\n"],
  ["turn colour: the colour not used", R, "      pcall(function() Turns.enable = true Turns.turn_color = turnColor end)", "      pcall(function() Turns.enable = true Turns.turn_color = m.active end)"],
  ["log header: the first seat only", B, "out.push(`--- ${turnOwnerWords(cur.active, pub)} turn", "out.push(`--- ${who(cur.active)}'s turn"],
  // (outside a shared turn the board's team named anyway: Level 1's partners each take their own turn)
  ["log header: the board's team in Level 1 too", B, OWNER_ONE,
    "(gv?.players ? `${teams2hg.teamWords(gv.players.filter((p) => p.teamNumber != null && p.teamNumber === gv.players.find((q) => q.id === activeId)?.teamNumber).map((p) => nameOf(p.id)))}'s` : " + OWNER_ONE.slice(0, -2) + "));"],
];

function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
      if (m && !/^test_/.test(m[1])) failed.push(m[1].slice(0, 110));
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
for (const [label, rel, from, to] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`?? ${label}: the code to break is not there once`); survived++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTests(); } finally { fs.writeFileSync(file, text); }
  const ok = sha(file) === before;
  if (!failed.length) survived++;
  console.log(`${failed.length ? "caught" : "SURVIVED"}: ${label}${failed.length ? ` -> ${failed.join(" | ")}` : ""}${ok ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught, every file restored`);
process.exit(survived ? 1 : 0);
