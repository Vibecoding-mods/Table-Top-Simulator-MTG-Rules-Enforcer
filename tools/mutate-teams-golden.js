// Grades tests/test_teams_golden.js (the bridge/teams.js golden master) with tools/mutate-golden-lib.js: each mutation
// below is a plausible careless change, and the golden must go red on it by name.
//   node tools/mutate-teams-golden.js [label pattern]
// First pass 2026-11-24: 33 of 35 caught (5.7% escaped, SOUND); the two escapes (an `in` for hasOwnProperty, the
// commander limit sent only above 21) were closed with new rows and are caught now.
const path = require("path");
const { runMutations } = require("./mutate-golden-lib");

const ROOT = path.join(__dirname, "..");

// [label, from, to, equivalent?]: `from` must occur exactly once in teams.js. equivalent: argued to change no
// outcome (reported apart, not graded)
const MUTATIONS = [
  ["teamsOf: 1 <= n <= 2 instead of exactly 1 or 2", "out[c] = n === 1 || n === 2 ? n : DEFAULT_TEAMS[c];", "out[c] = n >= 1 && n <= 2 ? n : DEFAULT_TEAMS[c];"],
  ["seatColorsFor: > becomes >=", "Number(n) > TEAM_COLORS.length ?", "Number(n) >= TEAM_COLORS.length ?"],
  ["teamModeOf: own property becomes `in`", "(Object.prototype.hasOwnProperty.call(TEAM_MODES, raw) ? raw : \"2hg\")", "(raw in TEAM_MODES ? raw : \"2hg\")"],
  ["juggOf: missing value no longer skipped", "if (r[k] != null && Number.isInteger(n)", "if (Number.isInteger(n)"],
  ["juggOf: lower bound exclusive", "Number.isInteger(n) && n >= lo && n <= hi", "Number.isInteger(n) && n > lo && n <= hi"],
  ["juggOf: upper bound exclusive", "n >= lo && n <= hi) out[k] = n;", "n >= lo && n < hi) out[k] = n;"],
  ["juggLife: ?? becomes ||", "jugg.life ?? (std ? 40 : 80)", "jugg.life || (std ? 40 : 80)"],
  ["gameConfig: commander limit sent only above 21", "...(jugg.cmd !== 21 ? { commanderDamageToLose", "...(jugg.cmd > 21 ? { commanderDamageToLose"],
  ["teamsProblem: no wrap round the table", " || Math.abs(at(a) - at(b)) === TEAM_COLORS.length - 1;", ";"],
  ["boardTeams: teamNumber 0 read as none", "if (p.teamNumber == null && !ownLifeTeams(rules.rule)) continue;", "if (!p.teamNumber && !ownLifeTeams(rules.rule)) continue;"],
  ["teamOf: teamNumber 0 read as none", "if (!sharesLife(pub) || p.teamNumber == null) return [p];", "if (!sharesLife(pub) || !p.teamNumber) return [p];"],
  ["teamKey: ?? becomes ||", "const teamKey = (p) => p.teamNumber ?? `alone:${p.id}`;", "const teamKey = (p) => p.teamNumber || `alone:${p.id}`;"],
  ["turnPlayerIds: activeTeamIds trusted without the active player", "if (Array.isArray(pub.activeTeamIds) && pub.activeTeamIds.includes(a)) return", "if (Array.isArray(pub.activeTeamIds)) return"],
  ["teamRefusalWords: word boundary dropped", "/^(Attack|Block) declaration invalid\\b:?\\s*(.*)$/i", "/^(Attack|Block) declaration invalid:?\\s*(.*)$/i"],
  ["jointBlock: Agree returns the prompt's own list (alias)", "agree: Array.isArray(input.currentAssignments) ? JSON.parse(JSON.stringify(input.currentAssignments)) : null,", "agree: Array.isArray(input.currentAssignments) ? input.currentAssignments : null,"],
  ["teamBlockNotice: .trim() dropped", "const t = String(text || \"\").trim();", "const t = String(text || \"\");"],
  ["schemeDeckProblem: > becomes >=", "filter(([, k]) => k > ARCH_COPIES)", "filter(([, k]) => k >= ARCH_COPIES)"],
  ["archOf: scheme names not trimmed", "out.schemes = r.schemes.map((n) => n.trim());", "out.schemes = r.schemes.slice();"],
  ["withTeamDamage: no Number()", "total[cid] = (total[cid] || 0) + (Number(n) || 0);", "total[cid] = (total[cid] || 0) + n;"],
  ["poisonLabel: $ anchor dropped", "/^POISON \\d+$/.test(label)", "/^POISON \\d+/.test(label)"],
  ["setupOf: shared turns for any team mode", "turns: mode === \"2hg\" && m?.teamTurns === \"shared\" ? \"shared\" : null };", "turns: m?.teamTurns === \"shared\" ? \"shared\" : null };"],
  ["turnPartners: a player is their own partner", "if (!sharesTurns(pub) || a == null || b == null || a === b) return false;", "if (!sharesTurns(pub) || a == null || b == null) return false;"],
  ["teamsField: won shown before the game is over", "...(pub.gameOver && won ? { won } : {}) } };\n}\n\n// Archenemy", "...(won ? { won } : {}) } };\n}\n\n// Archenemy"],
  ["archTeamsField: sides always archenemy first", "const sideList = colors[0] === archColor ? [[archColor], others] : [others, [archColor]];", "const sideList = [[archColor], others];"],
  ["teamBlockLines: duplicates kept", "if (!a.blockerId || !a.attackerId || seen.has(key) || controllerOf(a.blockerId) !== partner) return false;", "if (!a.blockerId || !a.attackerId || controllerOf(a.blockerId) !== partner) return false;"],
  ["sharesLife: Level 2 dropped", "const sharesLife = (pub) => pub?.teamRules?.rule === \"sharedLife\" || pub?.teamRules?.rule === \"sharedTurns\";", "const sharesLife = (pub) => pub?.teamRules?.rule === \"sharedLife\";"],
  ["teamWinWords: length < 2 for 'wins'", "${won.length === 1 ? \"wins\" : \"win\"}", "${won.length < 2 ? \"wins\" : \"win\"}"],
  ["juggPerks: draw >= 0", "if (jugg.draw > 0) {", "if (jugg.draw >= 0) {"],
  ["gameConfig: archenemy loses goesFirst", "startingLife: archLife(std), goesFirst: true, schemes:", "startingLife: archLife(std), schemes:"],
  ["teamAttackLines: has() instead of get() (a decl no longer fills a board attack's missing target)", "if (a.attackerId && !at.get(a.attackerId)) at.set", "if (a.attackerId && !at.has(a.attackerId)) at.set"],
  ["teamAttackLines: controller only (owner fallback dropped)", "if (c.isAttacking && (c.controllerId || c.ownerId) === partner)", "if (c.isAttacking && c.controllerId === partner)"],
  ["jointBlock: reviseRound 0 accepted", "Number.isInteger(input.reviseRound) && input.reviseRound > 0", "Number.isInteger(input.reviseRound) && input.reviseRound >= 0"],
  ["jointBlockLines: arrow only with spaces dropped", "String(line).split(\" -> \").join(\" → \")", "String(line).split(\"->\").join(\"→\")"],
  ["teamModeProblem: Standard words swapped", "const words = (k) => (k === \"standard\" ? \"Standard\" : \"Commander\");", "const words = (k) => (k === \"commander\" ? \"Commander\" : \"Standard\");"],
  ["juggOf: order check case-insensitive", "if (r.order === \"after\") out.order = \"after\";", "if (String(r.order).toLowerCase() === \"after\") out.order = \"after\";"],
  // (equivalent: turnPartners is symmetric in a and b, so swapping them at turnPartnerOf's call site changes nothing)
  ["turnPartnerOf: arguments swapped (EQUIVALENT)", "find((p) => turnPartners(pub, id, p.id))", "find((p) => turnPartners(pub, p.id, id))", true],
];

runMutations(path.join(ROOT, "bridge", "teams.js"), path.join(ROOT, "tests", "test_teams_golden.js"), MUTATIONS, process.argv[2]);
