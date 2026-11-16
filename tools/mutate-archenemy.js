// Break-it for Archenemy in the bridge (tests/test_bridge_archenemy.js; docs/team-turns-archenemy-plan.md step 8): each
// mutation switches one piece of the Archenemy code off, runs the test, lists the checks that failed by name, then puts
// the file back and checks it by sha256. A mutation no check catches is printed as SURVIVED. The table's chat lines
// (tools/make-engine-copy.js) are not here: their tests need the TTS save.
//   node tools/mutate-archenemy.js [--golden] [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
// (the golden master too, with --golden: the new Archenemy scenarios must change by name; it needs a large heap)
const TESTS = [["tests/test_bridge_archenemy.js", []], ...(process.argv.includes("--golden") ? [["tests/test_bridge_golden.js", ["--max-old-space-size=8192"]]] : [])];

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["TEAM_MODES: Archenemy in Commander only", "bridge/teams.js", "archenemy: { rule: \"teams\", name: \"Archenemy\", gameMode: null }", "archenemy: { rule: \"teams\", name: \"Archenemy\", gameMode: \"commander\" }"],
  ["teamModeProblem: a mode for either game mode refused", "bridge/teams.js", "  if (t.gameMode === null) return null;\n", ""],
  ["setupOf: Archenemy's teams as sent", "bridge/teams.js", "return { teams: juggTeams(arch.color), mode: \"archenemy\", jugg: null, turns: null, arch };", "return { teams: teamsOf(m.teams), mode: \"archenemy\", jugg: null, turns: null, arch };"],
  ["archOf: any colour", "bridge/teams.js", "if (TEAM_COLORS.indexOf(r.color) >= 0) out.color = r.color;", "if (r.color) out.color = r.color;"],
  ["archLife: Standard 80 too", "bridge/teams.js", "const archLife = (std) => (std ? 40 : 80);", "const archLife = (std) => 80;"],
  ["scheme deck: any size", "bridge/teams.js", "  if (names.length < ARCH_SCHEMES) return", "  if (false) return"],
  ["scheme deck: any number of copies", "bridge/teams.js", ".filter(([, k]) => k > ARCH_COPIES)", ".filter(([, k]) => k > 9)"],
  ["teamsProblem: Archenemy checked as Two-Headed Giant", "bridge/teams.js", "  if (mode === \"archenemy\") return total >= 2 ? null :", "  if (false) return total >= 2 ? null :"],
  ["gameConfig: no archenemy flag", "bridge/teams.js", "...(mode === \"archenemy\" ? { archenemy: true } : {})", "...{}"],
  ["gameConfig: the archenemy a plain player", "bridge/teams.js", "if (mode === \"archenemy\") return arch && colors[i] === arch.color ?", "if (mode === \"archenemy\") return false ?"],
  ["gameConfig: the archenemy not first", "bridge/teams.js", "startingLife: archLife(std), goesFirst: true, schemes:", "startingLife: archLife(std), schemes:"],
  ["gameConfig: no schemes sent", "bridge/teams.js", "schemes: [...(arch.names || [])] }", "schemes: [] }"],
  ["teamsField: no archenemy named", "bridge/teams.js", "...(mode === \"archenemy\" && archColor ? { archenemy: archColor } : {})", "...{}"],
  ["setupWords: Undo off not said", "bridge/teams.js", " Undo is off in Archenemy games.`;\n  }", "`;\n  }"],
  ["mtg archenemy: the colour ignored", "bridge/bridge.js", "Object.assign(archenemy, { on: true, color });", "Object.assign(archenemy, { on: true });"],
  ["mtg schemes: \"2 <name>\" counted once", "bridge/bridge.js", "    const k = q ? Number(q[1]) : 1;\n", "    const k = 1;\n"],
  ["mtg schemes: unknown names let through", "bridge/bridge.js", "  if (unknown.length) return chat(`[MTG] Not schemes Forge knows:", "  if (false) return chat(`[MTG] Not schemes Forge knows:"],
  ["mtg schemes: the deck unchecked", "bridge/bridge.js", "  if (problem) return chat(`[MTG] Not a scheme deck:", "  if (false) return chat(`[MTG] Not a scheme deck:"],
  ["withArchenemy: the switch ignored", "bridge/bridge.js", "  if (!archenemy.on) return setup;\n", "  return setup;\n"],
  ["withArchenemy: a table start without the host's list", "bridge/bridge.js", "schemes: setup.arch.schemes || archenemy.names } };", "schemes: setup.arch.schemes } };"],
  ["start: the switch not applied", "bridge/bridge.js", "(withArchenemy(teams2hg.setupOf(m))));", "(teams2hg.setupOf(m)));"],
  ["start: an archenemy not in the game let through", "bridge/bridge.js", "if (!(total === TABLE_COLORS.length || seatList.includes(a.color) || preset.includes(a.color))) {", "if (false) {"],
  ["start: the scheme deck unchecked", "bridge/bridge.js", "    if (problem) { chat(`[MTG] Not started: Archenemy: ${problem}.`); return; }\n", ""],
  ["start: the game not an Archenemy game", "bridge/bridge.js", "...(archGame ? { arch: archGame } : {}),", ""],
  ["start: gameConfig without the archenemy", "bridge/bridge.js", "game.teamTurns || null, game.arch || null) } });", "game.teamTurns || null) } });"],
  ["board: the archenemy not passed to teamsField", "bridge/bridge.js", "game.teamMode, game.arch?.color || null), //", "game.teamMode), //"],
  ["undo: asked of the engine in an Archenemy game", "bridge/bridge.js", "  if (game.arch) return chat(`[MTG] ${ARCH_NO_UNDO}`, color);\n", ""],
  ["undo: the board doesn't say why", "bridge/bridge.js", "...(game?.arch ? { off: ARCH_NO_UNDO } : {})", "...{}"],
];

const pattern = process.argv.slice(2).find((a) => !a.startsWith("--"));
const only = pattern ? new RegExp(pattern, "i") : null;
const runTests = () => {
  const failed = [];
  for (const [t, nodeArgs] of TESTS) {
    const r = spawnSync(process.execPath, [...nodeArgs, path.join(ROOT, t)], { encoding: "utf8", timeout: 1200000, maxBuffer: 1 << 26 });
    for (const line of r.stdout.split("\n")) if (/^FAIL /.test(line) && !/^FAIL test_/.test(line)) failed.push(line.slice(5, 90));
    if (r.status !== 0 && !failed.length) failed.push(`${t} exit ${r.status}`);
  }
  return failed;
};
const base = runTests();
if (base.length) { console.log(`BASELINE FAILS: ${base.join(" | ")}`); process.exit(1); }
let survived = 0, caught = 0;
for (const [label, file, from, to] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  const f = path.join(ROOT, file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8");
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`NOT APPLIED (${n} matches) ${label}`); survived++; continue; }
  let failed;
  try { fs.writeFileSync(f, src.replace(from, to)); failed = runTests(); }
  finally { fs.writeFileSync(f, orig); if (sha(f) !== h) { console.log(`RESTORE FAILED: ${file}`); process.exit(100); } }
  if (failed.length) { caught++; console.log(`caught   ${label}: ${failed.slice(0, 3).join(" | ")}${failed.length > 3 ? ` (+${failed.length - 3})` : ""}`); }
  else { survived++; console.log(`SURVIVED ${label}`); }
}
console.log(`${caught} caught, ${survived} survived; files restored by sha256`);
process.exit(survived ? 1 : 0);
