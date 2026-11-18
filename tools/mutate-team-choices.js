// Break-it for the 2HG team choices (engine1127-teamchoices: forge-harness TeamChoiceTest): with shared team turns
// "the active player" (CR 805.9) and, with no creature named, "attacking player" (CR 805.10c) and "defending player"
// (CR 805.10e) are one player
// the controller of the spell or ability chooses as its effect is applied, asked once a resolution; with no controller
// in the game the active team's leader (805.2) chooses; an AI keeps the default. Each mutation switches one piece off,
// compiles only the edited file over the harness jar, runs TeamChoiceTest and requires the named check to fail; the
// file is put back and checked by sha256. Needs a patched engine tree with its jar (engine/test-harness-local.sh).
// (Not mutations: the ActivePlayer reference reading the ability's activator rather than its host's controller, since
// no check here has those differ; and the early return without shared team turns, since the active team is then one
// player and nobody would be asked anyway: levelOneHasOneActivePlayer checks the outcome.)
//   node tools/mutate-team-choices.js <engine tree> [label pattern]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const G = "forge/forge-game/src/main/java/forge/game/";
const PH = G + "phase/PhaseHandler.java", AU = G + "ability/AbilityUtils.java";
const TC = "TeamChoiceTest";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["nobody is asked", PH, "        if (chooser != null && !chooser.getController().isAI()) {", "        if (false) {", TC, "cr805.9 aNonactiveControllerChoosesTheActivePlayer"],
  ["a resolution never opens its choices", AU, "        final boolean choices = ph != null && sa.getParent() == null && ph.beginTeamChoices(sa);", "        final boolean choices = false;", TC, "cr805.9 aNonactiveControllerChoosesTheActivePlayer"],
  ["the whole table offered as the active player", PH, "        for (final Player p : getActiveTeam()) {\n            if (p.isInGame()) {\n                team.add(p);", "        for (final Player p : game.getPlayers()) {\n            if (p.isInGame()) {\n                team.add(p);", TC, "cr805.9 aNonactiveControllerChoosesTheActivePlayer"],
  ["an active controller always names itself (as before)", PH, "        if (!(cause instanceof SpellAbility)) {\n            return fallback;", "        if (cause != null) {\n            return fallback;", TC, "cr805.9 anActiveControllerMayNameThePartner"],
  ["each reference asks again", PH, "        if (before != null && candidates.contains(before)) {", "        if (false) {", TC, "cr805.9 oneAskForEveryReferenceInTheEffect"],
  ["a choice kept after its resolution", PH, "        teamChoices.remove(root);", "", TC, "cr805.9 aNewResolutionAsksAgain"],
  ["the table not told", PH, "        made.put(kind, pick);\n        if (chooser != null) {", "        made.put(kind, pick);\n        if (false) {", TC, "cr805.9 theTeamIsToldTheChoice"],
  ["the chooser told too", PH, "\" as the defending player (rule 805.10e)\"), chooser);", "\" as the defending player (rule 805.10e)\"), null);", TC, "cr805.9 theTeamIsToldTheChoice"],
  ["asked before the effect is applied", PH, "        final Map<String, Player> made = teamChoices.get(sa.getRootAbility());", "        final Map<String, Player> made = teamChoices.getOrDefault(sa.getRootAbility(), new HashMap<>());", TC, "cr805.9 nobodyIsAskedBeforeTheEffectIsApplied"],
  ["an AI asked like a person", PH, "        if (chooser != null && !chooser.getController().isAI()) {", "        if (chooser != null) {", TC, "cr805.9 anAiControllerKeepsTheFirstSeat"],
  ["a step's own player ignored", PH, "        if (teamStepPlayer != null) {\n            return teamStepPlayer;", "        if (false) {\n            return teamStepPlayer;", TC, "cr805.9 aStepTriggerNamesItsOwnPlayer"],
  ["no defending choice (as before)", AU, "        if (attacked != null || !game.getRules().hasSharedTeamTurns() || !(sa instanceof SpellAbility)) {", "        if (true) {", TC, "cr805.10e aControllerChoosesTheDefendingPlayer"],
  ["an attacker's own defender ignored", AU, "        final Player attacked = combat.getDefendingPlayerRelatedTo(card);", "        final Player attacked = null;", TC, "cr805.10e anAttackingCreatureNamesItsDefender"],
  ["the defending default not the team's leader", AU, "                game.getPhaseHandler().getPrimaryPlayer(defenders.get(0)),", "                defenders.get(defenders.size() - 1),", TC, "cr805.10e anAiControllerKeepsTheDefendingLeader"],
  ["a player out of the game offered", AU, "            if (p.isInGame() && !game.getPhaseHandler().isPlayerTurn(p)) {", "            if (!game.getPhaseHandler().isPlayerTurn(p)) {", TC, "cr805.10e aLoneDefenderIsNotAsked"],
  ["no attacking choice (as before)", AU, "        if (card == null || !combat.isSharedTeamAttack() || !(sa instanceof SpellAbility)) {", "        if (true) {", TC, "cr805.10c aControllerChoosesTheAttackingPlayer"],
  ["the attacking notice reads as the defending one", PH, "\"attacking\".equals(kind)\n                    ? \" as the attacking player (rule 805.10c)\"", "false\n                    ? \" as the attacking player (rule 805.10c)\"", TC, "cr805.10c aControllerChoosesTheAttackingPlayer"],
  ["an attacker's own controller ignored", AU, "            if (combat.isAttacking(card)) {\n                return combat.getAttackingPlayerOf(card);\n            }\n", "", TC, "cr805.10c anAttackingCreatureNamesItsController"],
  ["the attacking default not the first seat", AU, "                combat.getAttackingPlayer(), \"Choose the attacking player", "                attackers.get(attackers.size() - 1), \"Choose the attacking player", TC, "cr805.10c anAiControllerKeepsTheAttackingFirstSeat"],
  ["a player out of the game offered as an attacker", AU, "        for (final Player p : combat.getAttackingPlayers()) {\n            if (p.isInGame()) {", "        for (final Player p : combat.getAttackingPlayers()) {\n            if (true) {", TC, "cr805.10c aLoneAttackerIsNotAsked"],
  ["with no controller nobody decides", PH, "        final Player chooser = controller != null && controller.isInGame() ? controller : getPrimaryPlayer(playerTurn);", "        final Player chooser = controller != null && controller.isInGame() ? controller : null;", TC, "cr805.2 withNoControllerTheTeamLeaderDecides"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-teamchoices-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[5]))];
const runTest = (cls, extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), `forge.harness.host.${cls}`], { cwd: TREE, encoding: "utf8", timeout: 900000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith(`FAIL ${cls}`));
  return lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`) || l === `FAIL ${n}`) || l.slice(5, 80));
};
for (const cls of [TC]) {
  const base = runTest(cls, null);
  if (base.length) { console.log(`BASELINE FAILS (${cls}): ${base.join(", ")}`); process.exit(1); }
}
let missed = 0, ran = 0;
try {
  MUTATIONS.forEach(([label, file, from, to, cls, name], i) => {
    if (only && !only.test(label)) return;
    ran++;
    const f = path.join(TREE, file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8").replace(/\r\n/g, "\n");
    const crlf = orig.includes("\r\n");
    if (src.split(from).length - 1 !== 1) { missed++; console.log(`NOT APPLIED ${label}`); return; }
    const out = path.join(tmp, `m${i}`);
    fs.mkdirSync(out);
    let failed = null;
    try {
      const next = src.replace(from, () => to);
      fs.writeFileSync(f, crlf ? next.replace(/\n/g, "\r\n") : next);
      const c = javac(out, [f]);
      failed = c.status === 0 ? runTest(cls, out) : [`COMPILE ERROR ${c.stderr.split("\n")[0]}`];
    } finally {
      fs.writeFileSync(f, orig);
      if (sha(f) !== h) { console.log(`RESTORE FAILED: ${file}`); process.exit(100); }
    }
    const hit = failed.includes(name);
    if (!hit) missed++;
    console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.join(" | ") || "nothing failed"}`);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`${ran - missed} of ${ran} caught by name; files restored by sha256`);
process.exit(missed);
