// Break-it for Archenemy on the six-seat table (docs/handoff/archenemy-six-report.md): bridge/teams.js setupOf /
// archOf / archTeams / setupWords, bridge/bridge.js's start and  mtg archenemy, tools/engine-renderer.lua's setup button
// and scheme spots, tools/m6-stream.js's Archenemy start. Each mutation changes one file, runs the tests and requires
// the named check to fail; the file is put back and checked by sha256.
//   node tools/mutate-archenemy-six.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const T = "bridge/teams.js", B = "bridge/bridge.js", R = "tools/engine-renderer.lua", M = "tools/m6-stream.js";
const TESTS = ["tests/test_bridge_archenemy.js", "tests/test_table_archenemy_view.js", "tests/test_bridge_six_golden.js"];
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["the six-seat refusal back", B, "    const off = a.sticky ? ARCH_SWITCH_OFF : \"\";\n", "    const off = a.sticky ? ARCH_SWITCH_OFF : \"\";\n    if (TABLE_COLORS.length !== teams2hg.TEAM_COLORS.length) { chat(`[MTG] Not started: Archenemy is played on the 4-player table for now.${off}`); return; }\n", "six seats: Purple, an AI seat, alone against the five"],
  ["setupOf's teams the four seats'", T, "    return { teams: archTeams(arch.color, colors), mode: \"archenemy\"", "    return { teams: archTeams(arch.color), mode: \"archenemy\"", "setupOf: a six-seat table's Archenemy start covers its six seats"],
  ["archOf knows only the four seats", T, "  if (colors.indexOf(r.color) >= 0) out.color = r.color;", "  if (TEAM_COLORS.indexOf(r.color) >= 0) out.color = r.color;", "archOf: Purple is a seat on the six-seat table"],
  ["the bridge's start without the table's seats", B, "withArchenemy(teams2hg.setupOf(m, TABLE_COLORS))", "withArchenemy(teams2hg.setupOf(m))", "six seats: Purple, an AI seat, alone against the five"],
  ["mtg archenemy knows only the four seats", B, "  const color = TABLE_COLORS.find((c) => c.toLowerCase() === text.toLowerCase());", "  const color = teams2hg.TEAM_COLORS.find((c) => c.toLowerCase() === text.toLowerCase());", "six seats: mtg archenemy purple is a seat there"],
  ["the switch's teams the four seats'", B, "teams2hg.archTeams(archenemy.color, TABLE_COLORS)", "teams2hg.archTeams(archenemy.color)", "six seats, the switch on: the start is Purple's Archenemy game"],
  ["the setup words name the four seats", T, "    const others = Object.keys(teams).filter((c) => c !== arch.color);", "    const others = TEAM_COLORS.filter((c) => c !== arch.color);", "setupWords: the five others named on six seats"],
  ["the refusal says four seats", B, "or fill all ${({ 4: \"four\", 6: \"six\" })[TABLE_COLORS.length] || TABLE_COLORS.length} seats.${off}`);", "or fill all four seats.${off}`);", "six seats: an archenemy colour not in the game is refused, saying to fill the six seats"],
  ["the button on the 4-player table only", R, "      if engineArchLabel ~= nil then\n        SETUP.drawn.arch = true", "      if engineArchLabel ~= nil and not engineSixSeats() then\n        SETUP.drawn.arch = true", "button: drawn on the setup tile beside Teams, on either table"],
  ["the button goes round the four seats", R, "function engineArchSeats() return engineSixSeats() and ENGINE_TABLE_SEATS or ENGINE_ARCH_SEATS end", "function engineArchSeats() return ENGINE_ARCH_SEATS end", "six seats: the button goes round the six seats, then off"],
  ["six seats: the schemes between two seats", R, "(six and g.mat.x or g.mat.x * ENGINE_SCHEME.toward)", "g.mat.x * ENGINE_SCHEME.toward", "six seats: the scheme set in motion in front of the archenemy's own seat (the mat's x), toward the middle strip"],
  ["six seats: the row toward the edge", R, "  local way = (six and g.mat.x * g.right.x > 0) and -1 or 1", "  local way = 1", "six seats: the ongoing row toward the table's centre line"],
  ["the stream's Archenemy start dropped", M, "fromTable: true, ...extra })", "fromTable: true })", "archenemy setup: said, Purple at double life against the five at 40"],
];
const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 900000, env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=6144" } });
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
for (const [label, rel, from, to, name] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`NOT APPLIED ${label}`); missed++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTests(); } finally { fs.writeFileSync(file, text); }
  if (sha(file) !== before) { console.log(`RESTORE FAILED: ${rel}`); process.exit(100); }
  const hit = failed.includes(name);
  if (!hit) missed++;
  console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.slice(0, 3).join(" | ") || "nothing failed"}`);
}
console.log(`${list.length - missed} of ${list.length} caught by name; files restored by sha256`);
process.exit(missed ? 1 : 0);
