// Golden-master test for bridge/teams.js: replays every case in tests/golden/teams-run.js and compares against
// tests/golden/teams_golden.json (return value, throw, callback calls, argument changes, aliasing, public surface).
// Fails by case name with the recorded and the live row.   node tests/test_teams_golden.js
const fs = require("fs");
const path = require("path");

const GOLDEN = path.join(__dirname, "golden", "teams_golden.json");
let got;
try {
  got = require("./golden/teams-run").runAll();
} catch (e) {
  // (a module that no longer loads is a named failure, not a crash)
  console.log(`FAIL load: bridge/teams.js or the runner threw ${e?.constructor?.name}: ${e?.message}`);
  process.exit(1);
}
const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
const byName = new Map(got.map((g) => [g.name, g]));
let failed = 0;
for (const w of want) {
  const g = byName.get(w.name);
  if (!g) { failed++; console.log(`FAIL ${w.name}: case missing`); continue; }
  const a = JSON.stringify(w), b = JSON.stringify(g);
  if (a === b) continue;
  failed++;
  console.log(`FAIL ${w.name}\n    want ${a.slice(0, 500)}\n    got  ${b.slice(0, 500)}`);
}
for (const g of got) if (!want.some((w) => w.name === g.name)) { failed++; console.log(`FAIL ${g.name}: new case not in the golden file (re-capture)`); }

// ── relations: checks over two calls that need no recorded answer (they hold whatever the right answer is) ──
let rel = 0;
const check = (name, cond, why) => { rel++; if (!cond) { failed++; console.log(`FAIL relation: ${name}${why ? `: ${why}` : ""}`); } };
try {
  const T = require("../bridge/teams");
  const C4 = T.TEAM_COLORS;
  // Equivalence: which team is "1" doesn't matter. Over every split of the four seats, a split starts exactly when the
  // same split with the team numbers swapped does (teamsProblem's "team 1 side by side leaves team 2 side by side too")
  const splits = [];
  for (let m = 0; m < 16; m++) splits.push(Object.fromEntries(C4.map((c, i) => [c, (m >> i) & 1 ? 2 : 1])));
  for (const mode of ["2hg", "2v2"]) {
    const verdicts = splits.map((t) => T.teamsProblem(t, 4, mode) === null);
    // (precondition: some splits start and some don't, or the relation below holds vacuously)
    check(`${mode}: some splits start and some are refused`, verdicts.includes(true) && verdicts.includes(false), JSON.stringify(verdicts));
    splits.forEach((t, i) => {
      const swapped = Object.fromEntries(C4.map((c) => [c, 3 - t[c]]));
      check(`${mode}: split ${JSON.stringify(t)} starts exactly when its swap does`, verdicts[i] === (T.teamsProblem(swapped, 4, mode) === null));
    });
  }
  // Complete: every seat of a start the checks let through has a team in the engine's gameConfig (the six-seat table's
  // Green seat in a four-seat mode had none). Each mode on each table size its TEAM_MODES entry allows.
  const sixUsers = T.SIX_COLORS.map((c) => `u-${c}`);
  const starts = [["2hg", { teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 } }], ["2v2", { teams: { White: 1, Red: 2, Yellow: 1, Blue: 2 } }], ["juggernaut", { juggernaut: { color: "Red" } }],
    ["archenemy", { archenemy: { color: "Yellow" } }], ["3hg", {}]];
  for (const [mode, extra] of starts) {
    for (const colors of [C4, T.SIX_COLORS]) {
      const seats = T.TEAM_MODES[mode].seats;
      if (seats && seats !== colors.length) continue;
      const s = T.setupOf({ teamMode: mode, ...extra }, colors);
      const cfg = T.gameConfig(s.teams, sixUsers.slice(0, colors.length), colors, s.mode, s.jugg, false, s.turns, s.arch ? { color: s.arch.color, names: [] } : null);
      const lacking = cfg.players.filter((p) => p.team !== 1 && p.team !== 2).map((p) => p.username);
      check(`${mode} on ${colors.length} seats: every player has a team`, lacking.length === 0, `no team: ${lacking.join(", ")}`);
    }
  }
  // (precondition: the loop above ran for every mode)
  check("complete: every mode was checked on some table", starts.every(([m]) => [C4, T.SIX_COLORS].some((cs) => !T.TEAM_MODES[m].seats || T.TEAM_MODES[m].seats === cs.length)));
} catch (e) {
  failed++;
  console.log(`FAIL relations: threw ${e?.constructor?.name}: ${e?.message}`);
}
console.log(failed ? `\n${failed} failed (${want.length} cases, ${rel} relation checks)` : `all ${want.length} cases match; ${rel} relation checks hold`);
process.exit(failed ? 1 : 0);
