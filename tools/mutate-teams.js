// Break-it for the Two-Headed Giant bridge and table tests (tests/test_bridge_teams.js, tests/test_table_teams.js): each
// mutation switches one piece of the team code off, runs both tests, lists the checks that failed by name, then puts
// the file back and checks it by sha256. A mutation no check catches is printed as SURVIVED.
//   node tools/mutate-teams.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_teams.js", "tests/test_table_teams.js"];

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["teamsOf: a bad team kept as given", "bridge/teams.js", "out[c] = n === 1 || n === 2 ? n : DEFAULT_TEAMS[c];", "out[c] = n;"],
  ["teamsProblem: any number of players", "bridge/teams.js", "if (total !== 4) return", "if (false) return"],
  ["teamsProblem: no wrap round the table", "bridge/teams.js", " || Math.abs(at(a) - at(b)) === TEAM_COLORS.length - 1;", ";"],
  ["teamsProblem: partners anywhere", "bridge/teams.js", "if (!nextTo(...s[1])) return", "if (false) return"],
  ["gameConfig: everyone on team 1", "bridge/teams.js", "team: teams[colors[i]] }", "team: 1 }"],
  ["boardTeams: any rule", "bridge/teams.js", "if (!rules || rules.rule !== \"sharedLife\") return null;", "if (!rules) return null;"],
  ["teamOf: just the player", "bridge/teams.js", "if (pub?.teamRules?.rule !== \"sharedLife\" || p.teamNumber == null) return [p];", "return [p];"],
  ["withTeamDamage: own damage only", "bridge/teams.js", "  if (team.length < 2) return p;\n", "  return p;\n"],
  ["teamsField: no winners", "bridge/teams.js", "...(pub.gameOver && won ? { won } : {})", "...{}"],
  ["teamLifeTip: none", "bridge/teams.js", "return team.length > 1 ? `Team life:", "return false ? `Team life:"],
  ["poisonLabel: no limit", "bridge/teams.js", "return lim && /^POISON \\d+$/.test(label)", "return false && /^POISON \\d+$/.test(label)"],
  ["start: no gameConfig sent", "bridge/bridge.js", "if (game.teams) controllerOf(room, seats).send(", "if (false) controllerOf(room, seats).send("],
  ["start: teams not checked", "bridge/bridge.js", "const teamProblem = teams && teams2hg.teamsProblem(teams, total);", "const teamProblem = null;"],
  ["revealed: partners count as others", "bridge/bridge.js", "s.slot !== by && !mates.has(s.slot));", "s.slot !== by);"],
  ["teamHand: never sent", "bridge/bridge.js", "return cards.length ? { teamHand:", "return false ? { teamHand:"],
  ["concede: said for the player alone", "bridge/bridge.js", "chat(mates.length ? `[MTG] ${color} conceded for the team", "chat(false ? `[MTG] ${color} conceded for the team"],
  ["end words: the winner, not the team", "bridge/bridge.js", "const won = team ? teams2hg.teamWinWords(", "const won = false ? teams2hg.teamWinWords("],
  ["table: no partner stand-ins", "tools/engine-renderer.lua", "    if g ~= nil and #(pl.teamHand or {}) > 0 and Player[by] ~= nil and Player[by].seated then", "    if false then"],
  ["table: no team tag on the phase bar", "tools/engine-renderer.lua", "  if side == nil then return \"\" end\n  local mine = false", "  if true then return \"\" end\n  local mine = false"],
  ["table: only the winner wins", "tools/engine-renderer.lua", "  if won ~= nil then\n    for _, c in ipairs(won) do if c == viewer then return true end end", "  if false then\n    for _, c in ipairs(won) do if c == viewer then return true end end"],
  ["table: the banner names the winner", "tools/engine-renderer.lua", "  if won ~= nil then return string.upper(engineTeamWords(won)) .. \" WIN THE GAME\" end", ""],
  ["table: mtg mode ffa keeps the teams", "tools/engine-renderer.lua", "    ENGINE_TEAMS = nil\n    broadcastToAll", "    broadcastToAll"],
  ["table: mtg team ignored", "tools/engine-renderer.lua", "  ENGINE_TEAMS[seat] = tonumber(n)\n", ""],
  ["table: Start sends no teams", "tools/engine-renderer.lua", "function engineTeamsSent() return ENGINE_TEAMS end", "function engineTeamsSent() return nil end"],
  ["table: concede asks for the player alone", "tools/make-engine-copy.js", "pl.broadcast(team ~= nil and (\"[MTG] Concede for your team", "pl.broadcast(false and (\"[MTG] Concede for your team"],
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

const base = runTests();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let survived = 0;
for (const [label, rel, from, to] of MUTATIONS) {
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
console.log(survived ? `${survived} of ${MUTATIONS.length} survived` : `all ${MUTATIONS.length} caught, every file restored`);
process.exit(survived ? 1 : 0);
