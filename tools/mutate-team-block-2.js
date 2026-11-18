// Break-it for Three-Headed Giant's joint team block in the bridge (tests/test_bridge_3hg_team_block.js, a team of three
// on the six-seat table; docs/handoff/team-block-2-report.md): each mutation switches one piece off, runs the test, and
// must make the check it names fail by name; then the file is put back and checked by sha256. A mutation whose named
// check still passes is printed as SURVIVED.
//   node tools/mutate-team-block-2.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_3hg_team_block.js"];

// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["only the first other player named in colour", "bridge/bridge.js", "const named = Object.keys(game?.slotNames || {}).filter((s) => s !== blockWho).map(",
    "const named = Object.keys(game?.slotNames || {}).filter((s) => s !== blockWho).slice(0, 1).map(",
    "lines: both partners named, each in their seat colour"],
  ["title ignored", "bridge/bridge.js", "ui = { title: jb.title ? displayText(jb.title) : \"Choose blockers\",", "ui = { title: \"Choose blockers\",",
    "title: round 1 names both partners"],
  ["the round not told to the table", "bridge/bridge.js", "joint: jb.round || 0,", "joint: 0,",
    "joint: the table is told the round"],
  ["Agree sends the picks instead", "bridge/bridge.js", "if (jb?.agree && a.includes(\"__agree\")) return", "if (false) return",
    "sent: Agree sends currentAssignments back, a pick as picked"],
  ["change notice not in chat", "bridge/bridge.js", "        chat(`[MTG] ${blockNews.line}`, seat.color);\n", "",
    "notice: each change one chat line to each of the three defenders"],
  ["change notice logged per defender", "bridge/bridge.js", "tableNotice(`teamblock|${blockNews.line}`, seat.color, blockNews.line);", "gameLogLine(blockNews.line);",
    "notice: the game log has each change once for the team, not once per defender"],
  ["change notice never acknowledged", "bridge/bridge.js",
    "        tableNotice(`teamblock|${blockNews.line}`, seat.color, blockNews.line);\n        seat.respond(prompt.promptId, type, { type: \"revealCardsAcknowledged\" });\n",
    "        tableNotice(`teamblock|${blockNews.line}`, seat.color, blockNews.line);\n",
    "notice: printed, never asked (acknowledged at once, nothing shown) to each of the three"],
  ["805.2 notice not reworded", "bridge/teams.js", "line: `${settle[1]} decides (team leader)` };", "line: t };",
    "cap: the primary's notice reads 'Green decides (team leader)' to all three"],
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
