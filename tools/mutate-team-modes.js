// Break-it for 2v2 (Standard only) and Juggernaut (Commander only) (tests/test_bridge_team_modes.js, tests/test_table_team_modes.js): each
// mutation switches one piece of the team-mode code off, runs both tests, lists the checks that failed by name, then
// puts the file back and checks it by sha256. A mutation no check catches is printed as SURVIVED. The Two-Headed Giant
// pieces they share are tools/mutate-teams.js's.
//   node tools/mutate-team-modes.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_team_modes.js", "tests/test_table_team_modes.js"];

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["setupOf: Juggernaut's teams as sent", "bridge/teams.js", "return { teams: juggTeams(jugg.color), mode: \"juggernaut\", jugg, turns: null };", "return { teams: teamsOf(m.teams), mode: \"juggernaut\", jugg, turns: null };"],
  ["teamModeOf: every mode is 2HG", "bridge/teams.js", "typeof raw === \"string\" && Object.prototype.hasOwnProperty.call(TEAM_MODES, raw) ? raw : \"2hg\"", "\"2hg\""],
  ["TEAM_MODES: 2v2 shares life", "bridge/teams.js", "\"2v2\": { rule: \"teams\",", "\"2v2\": { rule: \"sharedLife\","],
  ["juggOf: any colour", "bridge/teams.js", "if (TEAM_COLORS.includes(r.color)) out.color = r.color;", "if (r.color) out.color = r.color;"],
  ["juggOf: no limits", "bridge/teams.js", "if (r[k] != null && Number.isInteger(n) && n >= lo && n <= hi) out[k] = n;", "if (r[k] != null) out[k] = n;"],
  ["juggOf: order always first", "bridge/teams.js", "if (r.order === \"after\") out.order = \"after\";", ""],
  ["juggLife: Standard 80 too", "bridge/teams.js", "jugg.life ?? (std ? 40 : 80)", "jugg.life ?? 80"],
  ["juggTeams: Juggernaut with the three", "bridge/teams.js", "const juggTeams = (color) => Object.fromEntries(TEAM_COLORS.map((c) => [c, c === color ? 1 : 2]));", "const juggTeams = (color) => Object.fromEntries(TEAM_COLORS.map((c) => [c, 2]));"],
  ["juggPerks: no extra draw", "bridge/teams.js", "  if (jugg.draw > 0) {\n", "  if (false) {\n"],
  ["juggPerks: no extra land", "bridge/teams.js", "  if (jugg.land > 0) lines.push(", "  if (false) lines.push("],
  ["juggPerks: no turn order", "bridge/teams.js", "  if (jugg.order === \"after\") {\n    lines.push(", "  if (false) {\n    lines.push("],
  ["juggPerks: the turn order skips extra turns too", "bridge/teams.js", "ValidPlayer$ You | ExtraTurn$ False | Skip$ True", "ValidPlayer$ You | Skip$ True"],
  ["teamsProblem: Juggernaut with any count", "bridge/teams.js", "if (mode === \"juggernaut\") return total === 4 ? null :", "if (mode === \"juggernaut\") return true ? null :"],
  ["teamsProblem: 2v2 with any count", "bridge/teams.js", "if (total !== 4) return `2v2 needs", "if (false) return `2v2 needs"],
  ["teamsProblem: 2v2 with any split", "bridge/teams.js", "return s[1].length === 2 && s[2].length === 2 ? null : `2v2 needs", "return true ? null : `2v2 needs"],
  ["gameConfig: 2v2 shares life", "bridge/teams.js", "\"sharedTurns\" : TEAM_MODES[teamModeOf(mode)].rule;", "\"sharedTurns\" : \"sharedLife\";"],
  ["gameConfig: the Juggernaut a plain player", "bridge/teams.js", "if (mode !== \"juggernaut\" || !jugg || colors[i] !== jugg.color) return p;", "return p;"],
  ["gameConfig: the Juggernaut not first", "bridge/teams.js", "commanderDamageToLose: jugg.cmd } : {}), goesFirst: true };", "commanderDamageToLose: jugg.cmd } : {}) };"],
  ["gameConfig: no commander limit", "bridge/teams.js", "...(jugg.cmd !== 21 ? { commanderDamageToLose: jugg.cmd } : {})", "...{}"],
  ["boardTeams: the lone Juggernaut dropped", "bridge/teams.js", "if (p.teamNumber == null && !ownLifeTeams(rules.rule)) continue;", "if (p.teamNumber == null) continue;"],
  ["teamsField: no Juggernaut named", "bridge/teams.js", "...(lone ? { juggernaut: lone[0] } : {})", "...{}"],
  ["teamsField: the lone winner's side not found", "bridge/teams.js", "(winner.teamNumber != null || ownLifeTeams(t.rule))", "(winner.teamNumber != null)"],
  ["start: the mode not passed on", "bridge/bridge.js", "[teams, mode || \"2hg\", jugg, turns, arch || null]", "[teams, \"2hg\", jugg, turns, arch || null]"],
  ["table: 2v2 not a mode", "tools/engine-renderer.lua", "(rest == \"2hg\" or rest == \"2v2\" or rest == \"juggernaut\" or rest == \"ffa\")", "(rest == \"2hg\" or rest == \"juggernaut\" or rest == \"ffa\")"],
  ["table: Juggernaut keeps the old teams", "tools/engine-renderer.lua", "    ENGINE_TEAM_MODE = \"juggernaut\"\n    ENGINE_TEAMS = engineJuggTeams()\n", "    ENGINE_TEAM_MODE = \"juggernaut\"\n    ENGINE_TEAMS = ENGINE_TEAMS or {}\n"],
  ["table: Juggernaut's teams kept after the colour moves", "tools/engine-renderer.lua", "    if playing then ENGINE_TEAMS = engineJuggTeams() end\n", ""],
  ["table: Juggernaut settings unchecked", "tools/engine-renderer.lua", "and math.floor(tonumber(value)) == tonumber(value) and tonumber(value) >= ENGINE_JUGG_LIMITS[key][1] and tonumber(value) <= ENGINE_JUGG_LIMITS[key][2] then", "then"],
  ["table: mtg team moves the Juggernaut's teams", "tools/engine-renderer.lua", "  if ENGINE_TEAM_MODE == \"juggernaut\" then pl.broadcast(\"[MTG] In Juggernaut the teams follow", "  if false then pl.broadcast(\"[MTG] In Juggernaut the teams follow"],
  ["table: Start sends no mode", "tools/engine-renderer.lua", "function engineTeamModeSent() return ENGINE_TEAMS ~= nil and ENGINE_TEAM_MODE or nil end", "function engineTeamModeSent() return nil end"],
  ["table: Start sends no Juggernaut", "tools/engine-renderer.lua", "function engineJuggSent() return (ENGINE_TEAMS ~= nil and ENGINE_TEAM_MODE == \"juggernaut\") and ENGINE_JUGG or nil end", "function engineJuggSent() return nil end"],
  ["teamModeProblem: every team mode in every game mode", "bridge/teams.js", "  if (t.gameMode === gameMode) return null;\n", "  return null;\n"],
  ["TEAM_MODES: 2v2 in Commander", "bridge/teams.js", "\"2v2\": { rule: \"teams\", name: \"2v2\", gameMode: \"standard\", seats: 4 }", "\"2v2\": { rule: \"teams\", name: \"2v2\", gameMode: \"commander\", seats: 4 }"],
  ["TEAM_MODES: Juggernaut in Standard", "bridge/teams.js", "juggernaut: { rule: \"teams\", name: \"Juggernaut\", gameMode: \"commander\", seats: 4 }", "juggernaut: { rule: \"teams\", name: \"Juggernaut\", gameMode: \"standard\", seats: 4 }"],
  ["start: the game mode not checked", "bridge/bridge.js", "(teams2hg.teamModeProblem(teamMode, mode) || teams2hg.teamsProblem(", "(teams2hg.teamsProblem("],
  ["start: a Standard 2v2 said as free-for-all", "bridge/bridge.js", "${teams ? \"Standard\" : modeWords(mode, total)}", "${modeWords(mode, total)}"],
  ["table: no refusal for the wrong game mode", "tools/engine-renderer.lua", "  if refusal ~= nil then pl.broadcast(", "  if false then pl.broadcast("],
  ["table: every team mode in every game mode", "tools/engine-renderer.lua", "  if want == nil or want == ENGINE_GAME_MODE then return nil end\n", "  if true then return nil end\n"],
  ["table: 2v2 in Commander", "tools/engine-renderer.lua", "ENGINE_TEAM_GAME_MODE = { [\"2hg\"] = \"commander\", [\"2v2\"] = \"standard\",", "ENGINE_TEAM_GAME_MODE = { [\"2hg\"] = \"commander\", [\"2v2\"] = \"commander\","],
  ["table: a game-mode switch keeps the teams", "tools/engine-renderer.lua", "  if ENGINE_TEAMS ~= nil and ENGINE_TEAM_GAME_MODE[ENGINE_TEAM_MODE] ~= mode then\n", "  if false then\n"],
  ["table: teams dropped without a word", "tools/engine-renderer.lua", "    broadcastToAll(\"[MTG] Teams set back to None: \"", "    (function() end)(\"[MTG] Teams set back to None: \""],
  ["table: the Standard button cycles to 2HG", "tools/engine-renderer.lua", "ENGINE_GAME_MODE == \"standard\" and { [\"2v2\"] = \"ffa\" }", "ENGINE_GAME_MODE == \"standard\" and { [\"2v2\"] = \"2hg\" }"],
  ["table: the Commander button keeps 2v2", "tools/engine-renderer.lua", "or { [\"2hg\"] = \"juggernaut\", juggernaut = \"ffa\" }", "or { [\"2hg\"] = \"2v2\", [\"2v2\"] = \"juggernaut\", juggernaut = \"ffa\" }"],
  ["table: the Standard button starts at 2HG", "tools/engine-renderer.lua", "(m == nil and (ENGINE_GAME_MODE == \"standard\" and \"2v2\" or \"2hg\")", "(m == nil and \"2hg\""],
  ["table: the button's label says None", "tools/engine-renderer.lua", "  if m == \"juggernaut\" then return \"Juggernaut\\n\" .. ENGINE_JUGG.color end\n", ""],
  ["table: no Juggernaut tag", "tools/engine-renderer.lua", "  if t.teams.juggernaut ~= nil and t.active == t.teams.juggernaut then\n", "  if false then\n"],
  ["table: a lone winner's banner says WIN", "tools/engine-renderer.lua", "(#won == 1 and \" WINS THE GAME\" or \" WIN THE GAME\")", "\" WIN THE GAME\""],
  ["table: no gold for the Juggernaut", "tools/engine-renderer.lua", "    if not shared and #side == 1 and (side[1] == m.teams.juggernaut or side[1] == m.teams.archenemy) then k = 3 end\n", "    if not shared and #side == 1 and side[1] == m.teams.archenemy then k = 3 end\n"],
  ["table: a teams game draws only pairs", "tools/engine-renderer.lua", "    if #side == 2 or not shared then\n", "    if #side == 2 then\n"],
  ["table: a teams game gets the life panel", "tools/engine-renderer.lua", "  local shared = sides ~= nil and m.teams.rule ~= \"teams\"\n", "  local shared = sides ~= nil\n"],
  ["table: concede for the team in 2v2", "tools/make-engine-copy.js", "board ~= nil and not (board.teams and board.teams.rule == \"teams\") and engineTeamOf(board, pl.color)", "board ~= nil and engineTeamOf(board, pl.color)"],
  ["table: Start sends no mode (message)", "tools/make-engine-copy.js", "    teamMode = engineTeamModeSent ~= nil and engineTeamModeSent() or nil, juggernaut", "    juggernaut"],
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
    if (r.status !== 0 && !/^\s*FAIL/m.test(out)) failed.push(`CRASH: ${t} exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
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
  const caught = failed.some((f) => !f.startsWith("CRASH: ")); // (a test that crashed or timed out is no check catching it)
  if (!caught) survived++;
  console.log(`${caught ? "caught" : "SURVIVED"}: ${label}${failed.length ? ` -> ${failed.join(" | ")}` : ""}${ok ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught, every file restored`);
process.exit(survived ? 1 : 0);
