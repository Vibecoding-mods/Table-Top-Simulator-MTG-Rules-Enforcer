// Break-it for best of three's game 1 roll choice (tests/test_bridge_bo3_roll_choice.js): each mutation switches one
// piece off (bridge/bridge.js matchRollFirst, matchRollWaits, holdStartForRoll, rollChoice, the start's hold, the
// answer's routing), runs the test and requires the named check to fail, then puts the file back and checks it by
// sha256.
//   node tools/mutate-bo3-roll-choice.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TEST = "tests/test_bridge_bo3_roll_choice.js";
const B = "bridge/bridge.js";

// [label, file, from, to, check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["the start not held", B, "    if (matchRollWaits()) holdStartForRoll(send);\n    else send();", "    send();", "ask: no start while the roll's winner chooses"],
  ["a person's win taken as the AI's", B, "first: person ? null : winner,", "first: winner,", "ask: Blue is asked Play / Draw on the match's panel"],
  ["the AI asked too", B, "first: person ? null : winner,", "first: null,", "AI: the AI plays and the game starts at once"],
  ["draw makes the winner go first", B, "roll.first = play ? roll.winner : matchOther(roll.winner);", "roll.first = roll.winner;", "draw: the gameConfig names White (the AI) first"],
  ["the held start never sent", B, "  roll.held = null;\n  if (send) send();\n", "  roll.held = null;\n", "draw: then the start"],
  ["no clock", B, "    rollChoice(true, true);\n  }, ROLL_CHOICE_SECONDS * 1000);", "  }, ROLL_CHOICE_SECONDS * 1000);", "clock: no answer, Blue plays and the game starts"],
  ["the answer ignored", B, "    if (pick === \"__play\" || pick === \"__draw\") rollChoice(pick === \"__play\");", "", "play: Blue first, then the start"],
  ["play and draw swapped", B, "rollChoice(pick === \"__play\");", "rollChoice(pick === \"__draw\");", "draw: the gameConfig names White (the AI) first"],
  ["the question left open", B, "  matchClose(roll.winner);\n", "", "draw: the question is closed"],
  ["the choice unsaid", B, "    chat(`[MTG] ${line}.`);\n    gameLogLine(line);", "    gameLogLine(line);", "draw: said"],
  ["the choice not in the log", B, "    chat(`[MTG] ${line}.`);\n    gameLogLine(line);", "    chat(`[MTG] ${line}.`);", "draw: in the log"],
  ["the table's first player ignored", B, "  if (!game || game.tableFirst || game.leader || matchFirst()) return false;", "  if (!game) return false;", "table: its first player, no roll, no question, the start at once"],
  ["the roll unsaid", B, "${person ? `${matchName(winner)} wins the roll and chooses to play or draw.` : `${matchName(winner)} goes first.`}", "${matchName(winner)} goes first.", "ask: said in chat"],
];

const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
function runTest() {
  const r = spawnSync(process.execPath, [TEST], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`) || l === `FAIL ${n}`) || l.slice(5, 90));
  if (r.status !== 0 && !failed.length) failed.push(`exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const base = runTest();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let missed = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to, name] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`NOT APPLIED ${label}: the code to break is not there once`); missed++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTest(); } finally { fs.writeFileSync(file, text); }
  if (sha(file) !== before) { console.log(`RESTORE FAILED: ${rel}`); process.exit(100); }
  const hit = failed.includes(name);
  if (!hit) missed++;
  console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.slice(0, 3).join(" | ") || "nothing failed"}`);
}
console.log(`${list.length - missed} of ${list.length} caught by name; files restored by sha256`);
process.exit(missed ? 1 : 0);
