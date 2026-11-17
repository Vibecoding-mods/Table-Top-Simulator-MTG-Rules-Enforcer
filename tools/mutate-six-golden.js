// Break-it for the six-seat game through the bridge (tests/test_bridge_six_golden.js): each mutation switches one piece
// of the bridge's six-seat path off (bridge/bridge.js's table seats, colours, names and table message, bridge/teams.js
// seatColorsFor, bridge/engine-test.js), runs the test and requires the named check to fail (a name ending in ":" is
// a prefix: the golden's "message N (type)"), then puts the file back and checks it by sha256.
//   node tools/mutate-six-golden.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TEST = "tests/test_bridge_six_golden.js";
const B = "bridge/bridge.js", T = "bridge/teams.js", E = "bridge/engine-test.js";

// [label, file, from, to, check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["teams: six seats get the four-seat colours", T, "(Number(n) > TEAM_COLORS.length ? SIX_COLORS", "(false ? SIX_COLORS", "engine-test colours: six seats are the six-seat table's, clockwise"],
  ["teams: five seats get all six", T, "SIX_COLORS.slice(0, Math.min(Number(n), SIX_COLORS.length))", "SIX_COLORS.slice()", "engine-test colours: five seats, the first five of six"],
  ["engine-test: the four colours again", E, "const SEAT_COLORS = teams.seatColorsFor(SEATS);", "const SEAT_COLORS = [\"White\", \"Red\", \"Yellow\", \"Blue\"];", "engine-test colours: engine-test.js takes them by seat count"],
  ["bridge: the table's six seats not taken", B, "  const said = tableSeatsOf(asList(m?.tableSeats));", "  const said = null;", "start: the bridge starts the six-seat game"],
  ["bridge: at most four seats", B, "const MAX_TABLE_SEATS = 6;", "const MAX_TABLE_SEATS = 4;", "start: the bridge starts the six-seat game"],
  ["bridge: the AI players take the free colours from the end", B, "mapped[username] || freeColors.shift() || null;", "mapped[username] || freeColors.pop() || null;", "start: the six seats' colours, clockwise"],
  ["bridge: every AI player is AI 1", B, "seat ? seat.color : `AI ${++ai}`;", "seat ? seat.color : `AI ${ai + 1}`;", "start: the AI players' names"],
  ["bridge: a card's controller by name, not colour", B, "    att: c.attachedTo || null, tok: !!c.identity.isToken, sick: !!c.summoningSick, ctl: game.slotColor[c.controllerId] || null,", "    att: c.attachedTo || null, tok: !!c.identity.isToken, sick: !!c.summoningSick, ctl: game.slotNames[c.controllerId] || null,", "stream: every player, controller, attacker and active seat is a six-seat colour"],
  ["bridge: the active seat by name", B, "t: \"table\", turn: pub.turn, step: pub.step, active: game.slotColor[pub.activePlayerId] || null,", "t: \"table\", turn: pub.turn, step: pub.step, active: game.slotNames[pub.activePlayerId] || null,", "stream: every player, controller, attacker and active seat is a six-seat colour"],
  ["bridge: the step left out of the table message", B, "t: \"table\", turn: pub.turn, step: pub.step, active:", "t: \"table\", turn: pub.turn, active:", "golden: message"],
];

const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
function runTest() {
  const r = spawnSync(process.execPath, [TEST], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}${n.endsWith(":") || n === "golden: message" ? "" : ":"}`)) || l.slice(5, 90));
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
