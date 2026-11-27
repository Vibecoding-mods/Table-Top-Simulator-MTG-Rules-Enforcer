// Break-it for the tie offer's golden scenarios (tests/test_bridge_golden.js, the "tie offer: ..." cases in
// tests/golden/bridge-cases.js): each mutation switches one piece of bridge.js's tie code off in a COPY
// (bridge/bridge.mutant.js, loaded through BRIDGE_PATH), runs the bridge golden and requires the named scenario to
// fail. bridge.js is never written: its sha256 is checked before and after each run, and the copy is removed.
//   node tools/mutate-tie-golden.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REAL = path.join(ROOT, "bridge", "bridge.js");
const COPY = path.join(ROOT, "bridge", "bridge.mutant.js");
const TEST = path.join(ROOT, "tests", "test_bridge_golden.js");
const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const OFFER = "tie offer: a player who can't lose, the offer to every seat, the harmless bot accepts";
const AGREED = "tie offer: accepted by everyone, the game a draw";
const KEEP = "tie offer: Keep playing, the forced-tie rule said, a late vote told no tie is open";
const ROUNDS = "tie offer: three rounds without progress, the count started over once, then a forced tie";
const STALE = "tie offer: Stalemate at a forced tie, for everyone with a Steam ID, once a game, then mtg accomplishments";
// [label, from (must occur once), to, the scenario that must fail]
const MUTATIONS = [
  ["the offer not said", "    say(`${tieLockWords(s)}, so the game may never end. A tie is offered.", "    if (false) say(`${tieLockWords(s)}, so the game may never end. A tie is offered.", OFFER],
  ["the harmless bot doesn't accept", "      h.directive({ type: \"tieVote\", voteId: t.voteId, accept: true });", "      h.directive({ type: \"tieVote\", voteId: t.voteId, accept: false });", OFFER],
  ["a vote sent the wrong way", "  seat.directive({ type: \"tieVote\", voteId: t.voteId, accept: !!accept });", "  seat.directive({ type: \"tieVote\", voteId: t.voteId, accept: !accept });", AGREED],
  ["the draw not said", "    say(\"Everyone accepted the tie: the game is a draw.\");", "", AGREED],
  ["the no not said", "    say(`${s.declinedBy || \"A player\"} declined the tie.", "    if (false) say(`${s.declinedBy || \"A player\"} declined the tie.", KEEP],
  ["a late vote not refused", "  if (!t || t.status?.type !== \"pending\") return chat(\"[MTG] No tie offer is open.\", color);", "  if (!t) return chat(\"[MTG] No tie offer is open.\", color);", KEEP],
  ["no warning each round", "  } else if (s.status === \"declined\" && s.rounds > was.rounds) {", "  } else if (false) {", ROUNDS],
  ["progress not said", "    say(`Progress: the tie count starts over (0 of ${s.toForce} rounds).`);", "", ROUNDS],
  ["the forced tie not said", "    say(`${s.toForce} rounds without progress: the game is a forced tie.`);", "", ROUNDS],
  ["no Stalemate at a forced tie", "    forcedTieEarned(s);\n", "", STALE],
  ["Stalemate for the locked player only", "const STALEMATE_EARNED_BY = \"everyone\";", "const STALEMATE_EARNED_BY = \"locked\";", STALE],
  ["Stalemate more than once a game", "  if (!game || game.tieEarned) return;", "  if (!game) return;", STALE],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const pristine = sha(REAL);
const checkPristine = () => { if (sha(REAL) !== pristine) { console.log("REAL FILE CHANGED: bridge/bridge.js"); process.exit(100); } };
const runGolden = (mutant) => {
  const env = { ...process.env };
  if (mutant) env.BRIDGE_PATH = COPY; else delete env.BRIDGE_PATH;
  const r = spawnSync(process.execPath, ["--max-old-space-size=8192", TEST], { encoding: "utf8", timeout: 1800000, maxBuffer: 1 << 28, env });
  const failed = String(r.stdout).split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5).split(":")[0] + (l.slice(5).includes(": ") ? "" : ""));
  const names = String(r.stdout).split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5));
  if (r.status !== 0 && !names.length) names.push(`exit ${r.status} ${String(r.stderr).slice(0, 200)}`);
  return names;
};
const src = fs.readFileSync(REAL, "utf8");
const base = runGolden(false);
if (base.length) { console.log(`BASELINE FAILS: ${base.slice(0, 3).join(" | ")}`); process.exit(1); }
fs.writeFileSync(COPY, src);
const same = runGolden(true);
fs.rmSync(COPY, { force: true });
if (same.length) { console.log(`UNCHANGED COPY FAILS: ${same.slice(0, 3).join(" | ")}`); process.exit(1); }
let caught = 0, missed = 0;
for (const [label, from, to, scenario] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  const n = src.split(from).length - 1;
  if (n !== 1) { missed++; console.log(`NOT APPLIED (${n} matches) ${label}`); continue; }
  let failed;
  try { fs.writeFileSync(COPY, src.replace(from, () => to)); failed = runGolden(true); }
  finally { fs.rmSync(COPY, { force: true }); checkPristine(); }
  const hit = failed.some((l) => l.startsWith(`${scenario}:`));
  const others = failed.filter((l) => !l.startsWith("tie offer:")).length;
  if (hit) { caught++; console.log(`caught   ${label}: ${failed.filter((l) => l.startsWith("tie offer:")).map((l) => l.split(":").slice(0, 2).join(":")).join(" | ")}${others ? ` (+${others} other scenarios)` : ""}`); }
  else { missed++; console.log(`MISSED   ${label}: ${failed.map((l) => l.slice(0, 90)).join(" | ") || "nothing failed"}`); }
}
console.log(`${caught} of ${caught + missed} caught by name; bridge.js unchanged (sha256), the copy removed`);
process.exit(missed ? 1 : 0);
