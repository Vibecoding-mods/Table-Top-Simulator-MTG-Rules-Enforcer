// Break-it for the shared-turn long tail in Two-Headed Giant Level 2 (forge-harness LongTailTest, engine1127-longtail):
// "until your next turn", delayed triggers, an extra combat, a concession mid-turn (CR 800.4a), a partner leaving
// mid-turn in team turns (a design choice: 2HG teams leave together, CR 810.8b), CR 800.4m, and teams of three.
// Each mutation reverts one fix or switches off one hunk the checks lean on, compiles only
// the edited file over the harness jar, runs LongTailTest and requires every check it names to fail by name; the file
// is put back and checked by sha256. Every LongTailTest check is named by at least one mutation (the script refuses to
// run otherwise). Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-long-tail.js <engine tree> [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const G = "forge/forge-game/src/main/java/forge/game/";
const PH = G + "phase/PhaseHandler.java";
const LT = "LongTailTest";
const TR = G + "trigger/Trigger.java", TH = G + "trigger/TriggerHandler.java";
const KEEP_FROM = "                delayedTriggers.remove(deltrig);\n                runSingleTrigger(deltrig, runParams);", KEEP_TO = "                runSingleTrigger(deltrig, runParams);";
const TEAM_RUN_FROM = "        if (!game.getRules().hasSharedTeamTurns() || !(p instanceof Player) || refersToTriggeredPlayer()) {", TEAM_RUN_TO = "        if (true) {";
const C = {
  until: "cr805.4 untilYourNextTurnLastsUntilTheTeamsNextTurn",
  partnerUntil: "cr805.4 aPartnersUntilYourNextTurnEndsWhenTheTeamsTurnBegins",
  gonePartner: "cr800.4m aGonePartnersUntilYourNextTurnLastsToTheTeamsNextTurn",
  goneDefender: "cr800.4m aGoneDefendersUntilYourNextTurnEndsAtItsTeamsTurn",
  goneTeam: "cr800.4m aGoneTeamsUntilYourNextTurnEndsAtItsSeat",
  endStep: "cr805.4d theNextEndStepTriggersOnceForTheTeam",
  yourUpkeep: "cr805.4d yourNextUpkeepIsTheTeamsNextUpkeep",
  nextUpkeep: "cr805.4d theNextUpkeepTriggersOnceInTheOtherTeamsTurn",
  extraCombat: "cr805.8 aPartnersExtraCombatIsTheTeams",
  teamConcedes: "cr800.4a theActiveTeamConcedingMidTurnPassesTheTurnOn",
  partnerLeaves: "teamTurns aPartnerLeavingMidTurnLeavesTheTurnToTheOther",
  firstSeatLeaves: "teamTurns theFirstSeatLeavingMidTurnLeavesTheTurnToThePartner",
  threeUntap: "threes cr805.4 aTeamOfThreeUntapsAndDrawsTogether",
  threeTurns: "threes cr805.4 theTurnAlternatesBetweenTeamsOfThree",
  threeLands: "threes cr805.4c eachOfThreeMayPlayALand",
  threePriority: "threes cr805.5b priorityGoesRoundAllThreeBeforeTheOtherTeam",
  threeAttacks: "threes cr805.10a allThreeDeclareAttacksInOneCombat",
  threeTeams: "cr805.4 threeTeamsOfTwoTakeTurnsInOrder",
};
// [label, file (in the tree), from, to, test class, checks that must all fail]
const MUTATIONS = [
  ["\"until your next turn\" ends for the first seat only", PH, "                    for (final Player member : getActiveTeam()) {\n                        game.getCleanup().executeUntil(member);\n                    }", "                    game.getCleanup().executeUntil(playerTurn);", LT, [C.until, C.partnerUntil]],
  ["\"until your next turn\" ends for every player each turn", PH, "                    for (final Player member : getActiveTeam()) {\n                        game.getCleanup().executeUntil(member);", "                    for (final Player member : game.getPlayers()) {\n                        game.getCleanup().executeUntil(member);", LT, [C.until]],
  ["a gone partner's effects end as the turn passes her seat (as before)", PH, "            if (p.hasLost() && (!isSharedTeamTurns() || !hasTeammateInGame(p))) {", "            if (p.hasLost()) {", LT, [C.gonePartner]],
  ["a gone teammate's effects never ended (the team-turn pass off)", PH, "        if (isSharedTeamTurns() && playerTurn != null) {\n            for (final Player p : game.getRegisteredPlayers()) {", "        if (false) {\n            for (final Player p : game.getRegisteredPlayers()) {", LT, [C.gonePartner, C.goneDefender]],
  ["a whole gone team's effects never ended (the seat walk skips every gone player under shared turns)", PH, "            if (p.hasLost() && (!isSharedTeamTurns() || !hasTeammateInGame(p))) {", "            if (p.hasLost() && !isSharedTeamTurns()) {", LT, [C.goneTeam]],
  ["a step runs for the first seat only", PH, "        for (final Player member : getActiveTeam()) {\n            teamStepPlayer = isSharedTeamTurns() ? member : null;", "        for (final Player member : getActiveTeam().subList(0, 1)) {\n            teamStepPlayer = isSharedTeamTurns() ? member : null;", LT, [C.yourUpkeep]],
  ["a delayed trigger kept after it fires", TH, KEEP_FROM, KEEP_TO, LT, [C.endStep]],
  ["a delayed step trigger fires on each member's run (team run check off, trigger kept)", [TR, TH], [TEAM_RUN_FROM, KEEP_FROM], [TEAM_RUN_TO, KEEP_TO], LT, [C.endStep, C.nextUpkeep]],
  ["no extra phases", PH, "            if (extraPhases.containsKey(phase)) {\n                extraPhase = extraPhases.get(phase).pop();", "            if (false && extraPhases.containsKey(phase)) {\n                extraPhase = extraPhases.get(phase).pop();", LT, [C.extraCombat]],
  ["only the first seat declares attacks", PH, "                    for (final Player member : getAttackDeclarers()) {", "                    for (final Player member : getAttackDeclarers().subList(0, 1)) {", LT, [C.extraCombat, C.threeAttacks]],
  ["a gone player kept on the active team (as before)", PH, "            team.removeIf(p -> !p.isInGame());", "", LT, [C.firstSeatLeaves]],
  ["a gone partner kept on the active team (the team walked over every seat, gone players not dropped)", PH, ["            team.removeIf(p -> !p.isInGame());", "        for (int i = 0; i < game.getPlayers().size(); i++) {\n            p = game.getNextPlayerAfter(p);"], ["", "        for (int i = 0; i < game.getPlayers().size(); i++) {\n            p = game.getRegisteredPlayers().get((game.getRegisteredPlayers().indexOf(p) + 1) % game.getRegisteredPlayers().size());"], LT, [C.partnerLeaves, C.firstSeatLeaves]],
  ["the next turn goes to the next player, not the next team", PH, "        for (int i = 0; i < game.getPlayers().size() && !next.isOpponentOf(p); i++) {", "        for (int i = 0; i < 0; i++) {", LT, [C.teamConcedes, C.threeTurns, C.threeTeams]],
  ["a team is two players at most", PH, "        for (int i = 0; i < game.getPlayers().size(); i++) {\n            p = game.getNextPlayerAfter(p);", "        for (int i = 0; i < 1; i++) {\n            p = game.getNextPlayerAfter(p);", LT, [C.threeUntap, C.threeTurns, C.threePriority, C.threeAttacks]],
  ["the partners' turn is not theirs", PH, "        return player.equals(playerTurn) || isSharedTeamTurns() && playerTurn != null && !playerTurn.isOpponentOf(player);", "        return player.equals(playerTurn);", LT, [C.threeLands]],
];
const unnamed = Object.values(C).filter((n) => !MUTATIONS.some((m) => m[5].includes(n)));
if (unnamed.length) { console.log(`checks no mutation names: ${unnamed.join(", ")}`); process.exit(1); }

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-longtail-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.flatMap((m) => m[5]))];
const runTest = (cls, extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), `forge.harness.host.${cls}`], { cwd: TREE, encoding: "utf8", timeout: 900000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith(`FAIL ${cls}`));
  return lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`) || l === `FAIL ${n}`) || l.slice(5, 80));
};
for (const cls of [LT]) {
  const base = runTest(cls, null);
  if (base.length) { console.log(`BASELINE FAILS (${cls}): ${base.join(", ")}`); process.exit(1); }
}
let missed = 0, ran = 0;
try {
  MUTATIONS.forEach(([label, file, from, to, cls, names], i) => {
    if (only && !only.test(label)) return;
    ran++;
    const froms = [].concat(from), tos = [].concat(to);
    const files = Array.isArray(file) ? file : froms.map(() => file);
    const byFile = new Map();
    froms.forEach((x, k) => { if (!byFile.has(files[k])) byFile.set(files[k], []); byFile.get(files[k]).push([x, tos[k]]); });
    const kept = [...byFile.keys()].map((rel) => { const f = path.join(TREE, rel), orig = fs.readFileSync(f); return { rel, f, orig, h: sha(f), src: orig.toString("utf8").replace(/\r\n/g, "\n"), crlf: orig.includes("\r\n") }; });
    if (kept.some((k) => byFile.get(k.rel).some(([x]) => k.src.split(x).length - 1 !== 1))) { missed++; console.log(`NOT APPLIED ${label}`); return; }
    const out = path.join(tmp, `m${i}`);
    fs.mkdirSync(out);
    let failed = null;
    try {
      for (const k of kept) {
        const next = byFile.get(k.rel).reduce((acc, [x, y]) => acc.replace(x, () => y), k.src);
        fs.writeFileSync(k.f, k.crlf ? next.replace(/\n/g, "\r\n") : next);
      }
      const c = javac(out, kept.map((k) => k.f));
      failed = c.status === 0 ? runTest(cls, out) : [`COMPILE ERROR ${c.stderr.split("\n")[0]}`];
    } finally {
      for (const k of kept) {
        fs.writeFileSync(k.f, k.orig);
        if (sha(k.f) !== k.h) { console.log(`RESTORE FAILED: ${k.rel}`); process.exit(100); }
      }
    }
    const hit = names.every((n) => failed.includes(n));
    if (!hit) missed++;
    console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.join(" | ") || "nothing failed"}`);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`${ran - missed} of ${ran} caught by name; files restored by sha256`);
process.exit(missed);
