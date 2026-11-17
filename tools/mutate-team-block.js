// Break-it for Two-Headed Giant's joint team block and shared-turn defaults (tests/test_bridge_2hg_team_block.js,
// tests/test_table_2hg_team_block.js, tests/test_bridge_2hg_level2.js): each mutation switches one piece off, runs the
// tests, and must make the check it names fail by name; then the file is put back and checked by sha256. A mutation
// whose named check still passes is printed as SURVIVED (docs/game-modes-spec.md §5.12).
//   node tools/mutate-team-block.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_2hg_team_block.js", "tests/test_table_2hg_team_block.js", "tests/test_bridge_2hg_level2.js"];

// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["Agree sends no blocks", "bridge/bridge.js", "assignments: JSON.parse(JSON.stringify(jb.agree)) };", "assignments: [] };",
    "agree: Blue's Agree sends currentAssignments back unchanged"],
  ["Agree sends the picks instead", "bridge/bridge.js", "if (jb?.agree && a.includes(\"__agree\")) return", "if (false) return",
    "agree: Blue's Agree sends currentAssignments back unchanged"],
  ["no Agree button", "bridge/bridge.js", "options: [...(jb.agree ? [{ id: \"__agree\", label: \"Agree\" }] : []), ...pairs]", "options: [...pairs]",
    "agree: one Agree, first, on every ask that has currentAssignments"],
  ["pre-fill missing (bridge)", "bridge/bridge.js", "for (const p of pairs) if (jb.on.has(p.id)) p.on = true;", "",
    "pre-fill: Yellow's revise round has her Bears on the Bears"],
  ["pre-fill missing (table)", "tools/engine-renderer.lua", "      if o.on == true then engineSelected[m.color] = engineSelected[m.color] or {} engineSelected[m.color][i] = true end\n", "",
    "pre-fill: her own block is picked already"],
  ["title ignored", "bridge/bridge.js", "ui = { title: jb.title ? displayText(jb.title) : \"Choose blockers\",", "ui = { title: \"Choose blockers\",",
    "title: a revise round says who changed what"],
  ["team lines dropped", "bridge/bridge.js", "...(lines.length ? [\"The team's block:\", ...teams2hg.jointBlockLines(lines, named)] : [])", "...[]",
    "lines: the team's block, one line per attacker"],
  ["partner's name not coloured", "bridge/teams.js", "if (hex && p.name && out.includes(said))", "if (false)",
    "lines: the partner's name in their seat colour"],
  ["change notice dropped", "bridge/bridge.js", "        chat(`[MTG] ${blockNews.line}`, seat.color);\n", "",
    "notice: each change is one chat line to each defender"],
  ["change notice logged per defender", "bridge/bridge.js", "tableNotice(`teamblock|${blockNews.line}`, seat.color, blockNews.line);", "gameLogLine(blockNews.line);",
    "notice: the game log has each change once, not once per defender"],
  ["805.2 notice not reworded (an older engine's)", "bridge/teams.js", "line: `${settle[1]} decides (team leader)` };", "line: t };",
    "teamBlockNotice: an older engine's cap reads the same"],
  ["the engine's new cap wording not read", "bridge/teams.js", "const settle = /^(.+?) decides \\(team leader\\)\\.?$/.exec(t) || ", "const settle = ",
    "cap: the 805.2 notice reads '<Primary> decides (team leader)', to both"],
  ["the cap wording read anywhere in a line", "bridge/teams.js", "const settle = /^(.+?) decides \\(team leader\\)\\.?$/.exec(t)", "const settle = /^(.+?) decides/.exec(t)",
    "teamBlockNotice: 'decides' alone is not the cap"],
  ["old prompt broken (every prompt a joint block)", "bridge/teams.js", "if (!input || ![\"title\", \"reviseRound\", \"currentAssignments\", \"teamBlockLines\"].some((k) => input[k] != null)) return null;", "if (!input) return null;",
    "free-for-all: no Agree, no pre-fill, no joint, no timeout answer"],
  ["only the attackers at the defender", "bridge/bridge.js", "      for (const at of input.attackers) for (const b of at.validBlockerIds) pairs.push(",
    "      for (const at of input.attackers.filter((x) => byId[x.attackerId]?.attackTargetId === (forP || seat.slot))) for (const b of at.validBlockerIds) pairs.push(",
    "every attacker: Yellow may block the Juggernaut attacking Blue, Blue the Bears attacking Yellow"],
  ["corner never Agree", "tools/engine-renderer.lua", "if agree ~= nil and engineJointUnchanged(color, p) then", "if false then",
    "corner: the big button is Agree while nothing changed"],
  ["corner Agree after a change too", "tools/engine-renderer.lua", "    if tostring(o.id):sub(1, 2) ~= \"__\" and (sel[i] == true) ~= (o.on == true) then return false end\n", "",
    "change: a changed pick makes the big button Done"],
  ["panel not opened", "tools/engine-renderer.lua", "    if m.promptId ~= nil and m.joint ~= nil then handled = false end\n", "",
    "panel: a joint block opens the panel"],
  ["no Waiting for the partner", "tools/engine-renderer.lua", "    if kind == \"block\" and q.joint ~= nil then return \"Waiting for \" .. engineNameOf(c) .. \"...\" end\n", "",
    "waiting: the partner's corner says Waiting for Yellow"],
  ["Level 1 by default", "tools/engine-renderer.lua", "ENGINE_TEAM_TURNS = \"shared\"\n", "ENGINE_TEAM_TURNS = nil\n",
    "default: Two-Headed Giant is one turn for each team"],
  ["trigger order not the team leader's words", "bridge/teams.js", "(you are the team leader). The one", "(you are the team's first seat). The one",
    "triggers: the primary player is told she orders them as the team leader"],
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
