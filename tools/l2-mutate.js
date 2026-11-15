// Mutation check for the Two-Headed Giant level 2 engine tests (forge-harness SharedTurnsTest): each mutation below
// breaks one shared-team-turns rule in the engine source, and the run passes only if every check listed for it FAILS
// under that mutation (and the unmutated "none" run fails nothing beyond the known-failing list). Proves each test
// fails by name when its rule is broken. The edits are pinned to the merged level 2 engine (engine/forge.patch and
// engine/manabrew.patch, 2026-11-15): a mutation whose text is no longer found is reported as STALE and fails the run;
// update its from/to when the engine moves, never drop it.
// An edit's file is under the Forge tree, or under the Manabrew tree when it starts with forge-harness/.
// Each run goes through the test classes in TESTS (SharedTurnsTest, SharedTurnsDevTest, SharedCombatTest); an
// expect name is a check name, or Class.check when two classes share a name.
// usage: node tools/l2-mutate.js --engine <manabrew tree> [--base 85bc8c3d] [--image engine1116-teams2] [--only name,...]
// Runs one container (2 CPUs); go through tmp/slot.js on a shared machine. Docker mode runs SharedTurnsTest only and
// can't mutate forge-harness files, so it reports a mutation that needs either as NEEDS-LOCAL.
//    or: node tools/l2-mutate.js --local <manabrew tree> [--only name,...]
// --local needs no Docker: it uses the jar engine/test-harness-local.sh built in that tree, edits each mutated Forge file
// in place, compiles only the edited files over the jar, runs the test class, and puts every file back by its sha256
// (the original bytes are written back and the hash checked; it stops if a file doesn't match).
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const ENGINE = arg("engine", null);
const BASE = arg("base", "85bc8c3d");
const IMAGE = arg("image", "engine1116-teams2");
const LOCAL = arg("local", null);
const ONLY = arg("only", "") ? arg("only").split(",") : null;
const KNOWN = path.join(__dirname, "..", "docs", "2hg-level2-known-failing.txt");
if (!ENGINE && !LOCAL) { console.error("usage: node tools/l2-mutate.js --engine <manabrew tree> | --local <manabrew tree>"); process.exit(2); }

const PH = "forge-game/src/main/java/forge/game/phase/PhaseHandler.java";
const COMBAT = "forge-game/src/main/java/forge/game/combat/Combat.java";
const AU = "forge-game/src/main/java/forge/game/ability/AbilityUtils.java";
const STACK = "forge-game/src/main/java/forge/game/zone/MagicStack.java";
const SAE = "forge-game/src/main/java/forge/game/ability/SpellAbilityEffect.java";
const CU = "forge-game/src/main/java/forge/game/combat/CombatUtil.java";
const MBIC = "forge-harness/src/main/java/forge/harness/host/ManaBrewInteractiveController.java";
const TESTS = ["SharedTurnsTest", "SharedTurnsDevTest", "SharedCombatTest"];
const MUTATIONS = [
  { name: "none", edits: [], expect: [] },
  { name: "isPlayerTurn-player-only", edits: [[PH, "return player.equals(playerTurn) || isSharedTeamTurns() && playerTurn != null && !playerTurn.isOpponentOf(player);", "return player.equals(playerTurn);"]],
    expect: ["isPlayerTurnCoversThePartner", "eachPartnerMayPlayALand"] },
  { name: "active-team-is-first-seat", edits: [[PH, "        team.add(first);\n        if (!isSharedTeamTurns()) {", "        team.add(first);\n        if (true) {"]],
    expect: ["isPlayerTurnCoversThePartner", "theTeamUntapsTogether", "theTeamDrawsTogether", "theTeamDiscardsToHandSize", "eachPlayersUpkeepTriggersForEachMember", "eachPlayersDrawStepTriggersForEachMember", "bothPartnersCreaturesAttackTogether", "fastForwardStopsOnThePartnersSlot"] },
  { name: "next-turn-next-seat", edits: [[PH, "if (!isSharedTeamTurns() || next == null) {", "if (true) {"]],
    expect: ["nextTurnGoesToTheOtherTeam", "aPartnersExtraTurnIsTheTeams"] },
  { name: "extra-turn-one-member", edits: [[PH, "        for (final Player member : getTeamInTurnOrder(nextPlayer)) {\n            member.setExtraTurn(isExtraTurn);", "        for (final Player member : java.util.List.of(nextPlayer)) {\n            member.setExtraTurn(isExtraTurn);"]],
    expect: ["aPartnersExtraTurnIsTheTeams"] },
  { name: "skip-turn-one-member", edits: [[PH, "        for (final Player member : getTeamInTurnOrder(nextPlayer)) {\n            final Map<AbilityKey, Object> repRunParams = AbilityKey.mapFromAffected(member);\n            repRunParams.put(AbilityKey.ExtraTurn, isExtraTurn);",
    "        for (final Player member : java.util.List.of(nextPlayer)) {\n            final Map<AbilityKey, Object> repRunParams = AbilityKey.mapFromAffected(member);\n            repRunParams.put(AbilityKey.ExtraTurn, isExtraTurn);"]],
    expect: ["aPartnerSkippingATurnSkipsTheTeams"] },
  { name: "skip-step-one-member", edits: [[PH, "            for (final Player member : getActiveTeam()) {\n                final Map<AbilityKey, Object> repRunParams = AbilityKey.mapFromAffected(member);\n                repRunParams.put(AbilityKey.Phase, phase);",
    "            for (final Player member : java.util.List.of(playerTurn)) {\n                final Map<AbilityKey, Object> repRunParams = AbilityKey.mapFromAffected(member);\n                repRunParams.put(AbilityKey.Phase, phase);"]],
    expect: ["aPartnerSkippingAStepSkipsTheTeams"] },
  { name: "starting-team-draws", edits: [[PH, "if (!game.getRules().hasSharedTeamLife() || playerTurn.isExtraTurn()) {", "if (true) {"]],
    expect: ["startingTeamSkipsOnlyTurnOnesDraw"] },
  { name: "draw-first-seat-only", edits: [[PH, "                    for (final Player member : getActiveTeam()) {\n                        member.drawCard();", "                    for (final Player member : java.util.List.of(playerTurn)) {\n                        member.drawCard();"]],
    expect: ["theTeamDrawsTogether"] },
  { name: "discard-first-seat-only", edits: [[PH, "                    for (final Player member : getActiveTeam()) {\n                        discardToHandSize(member);", "                    for (final Player member : java.util.List.of(playerTurn)) {\n                        discardToHandSize(member);"]],
    expect: ["theTeamDiscardsToHandSize"] },
  { name: "untap-first-seat-only", edits: [["forge-game/src/main/java/forge/game/phase/Untap.java", "        for (final Player member : team) {\n            doUntap(member);", "        for (final Player member : java.util.List.of(team.get(0))) {\n            doUntap(member);"]],
    expect: ["theTeamUntapsTogether"] },
  { name: "phase-trigger-first-seat-only", edits: [[PH, "        for (final Player member : getActiveTeam()) {\n            teamStepPlayer = isSharedTeamTurns() ? member : null;",
    "        for (final Player member : java.util.List.of(playerTurn)) {\n            teamStepPlayer = isSharedTeamTurns() ? member : null;"]],
    expect: ["eachPlayersUpkeepTriggersForEachMember", "eachPlayersDrawStepTriggersForEachMember", "yourUpkeepTriggersForThePartner", "aPartnersExtraStepIsTheTeams"] },
  { name: "each-upkeep-fires-per-member", edits: [["forge-game/src/main/java/forge/game/trigger/Trigger.java", "if (!game.getRules().hasSharedTeamTurns() || !(p instanceof Player) || refersToTriggeredPlayer()) {", "if (true) {"]],
    expect: ["eachUpkeepTriggersOnce"] },
  { name: "partner-not-asked-to-attack", edits: [[PH, "                    for (final Player member : getAttackDeclarers()) {", "                    for (final Player member : java.util.List.of(playerTurn)) {"]],
    expect: ["bothPartnersCreaturesAttackTogether", "whenYouAttackTriggersForThePartner"] },
  { name: "must-attack-first-seat-only", edits: [["forge-game/src/main/java/forge/game/combat/AttackConstraints.java", "        if (combat.isSharedTeamAttack()) {", "        if (false) {"]],
    expect: ["aPartnersMustAttackBindsTheCombinedAttack"] },
  { name: "attacking-player-is-first-seat", edits: [[COMBAT, "if (isSharedTeamAttack() && attacker != null && isAttackingPlayer(attacker.getController())) {", "if (false) {"]],
    expect: ["attackingPlayerOfACreatureIsItsController", "attackingTeamAssignsDamageFirst"] },
  { name: "when-you-attack-first-seat-only", edits: [["forge-game/src/main/java/forge/game/trigger/TriggerAttackersDeclared.java", "if (combat == null || !combat.isSharedTeamAttack() || !hasParam(\"AttackingPlayer\")) {", "if (true) {"]],
    expect: ["whenYouAttackTriggersForThePartner"] },
  { name: "partner-not-asked-to-block", edits: [[PH, "    private boolean isTeammateAttacked(final Player p) {\n        if (!game.getRules().hasSharedTeamLife()) {", "    private boolean isTeammateAttacked(final Player p) {\n        if (true) {"]],
    expect: ["theDefendingTeamBlocksTogether"] },
  { name: "mulligans-from-first-seat", edits: [["forge-game/src/main/java/forge/game/mulligan/MulliganService.java", "int offset = whoCanMulligan.indexOf(firstPlayer);", "int offset = 0;"]],
    expect: ["theStartingTeamDeclaresMulligansFirst"] },
  { name: "pregame-from-first-seat", edits: [["forge-game/src/main/java/forge/game/GameAction.java", "        Player takesAction = first;\n        Player newFirst = first;", "        Player takesAction = game.getPlayers().get(0);\n        Player newFirst = first;"]],
    expect: ["theStartingTeamTakesPregameActionsFirst"] },
  { name: "active-player-is-whole-team", edits: [[AU, "} else if (defined.equals(\"ActivePlayer\")) {\n            players.add(game.getPhaseHandler().getActivePlayerFor(sa, card.getController()));", "} else if (defined.equals(\"ActivePlayer\")) {\n            players.addAll(game.getPhaseHandler().getActiveTeam());"]],
    expect: ["theActivePlayerIsOnePlayerOfTheActiveTeam"] },
  { name: "defending-player-is-first-defender", edits: [
    ["forge-game/src/main/java/forge/game/combat/CombatUtil.java", "runParams.put(AbilityKey.DefendingPlayer, combat.getDefenderPlayerByAttacker(c));", "runParams.put(AbilityKey.DefendingPlayer, combat.getDefendingPlayers().iterator().next());"],
    [AU, "players.add(game.getCombat().getDefendingPlayerRelatedTo(card));", "players.add(game.getCombat().getDefendingPlayers().iterator().next());"]],
    expect: ["defendingPlayerIsThePlayerItAttacks"] },
  { name: "extra-step-not-the-teams", edits: [[PH, "if (extraPhases.containsKey(phase)) {", "if (extraPhases.containsKey(phase) && !isSharedTeamTurns()) {"]],
    expect: ["aPartnersExtraStepIsTheTeams"] },
  // tracks B and C (merged 2026-11-15)
  { name: "team-priority-off", edits: [[PH, "        if (isSharedTeamTurns()) {\n            // CR 805.5b", "        if (false) {\n            // CR 805.5b"]],
    expect: ["theTeamPassesOnceBothMembersPass"] },
  { name: "primary-not-asked-to-order", edits: [[STACK, "for (SpellAbility sa : primary.getController().orderSimultaneousSa(teamSAs)) {", "for (SpellAbility sa : teamSAs) {"]],
    expect: ["SharedTurnsTest.thePrimaryPlayerOrdersTheTeamsTriggers", "SharedTurnsDevTest.thePrimaryPlayerOrdersTheTeamsTriggers"] },
  { name: "partner-orders-the-teams-triggers", edits: [[STACK, "final Player primary = game.getPhaseHandler().getPrimaryPlayer(team.get(0));", "final Player primary = team.get(team.size() - 1);"]],
    expect: ["SharedTurnsTest.thePrimaryPlayerOrdersTheTeamsTriggers", "SharedTurnsDevTest.thePrimaryPlayerOrdersTheTeamsTriggers"] },
  { name: "triggers-ordered-per-player", edits: [[STACK, "        if (game.getRules().hasSharedTeamTurns()) {\n            final List<List<Player>> teams", "        if (false) {\n            final List<List<Player>> teams"]],
    expect: ["SharedTurnsTest.thePrimaryPlayerOrdersTheTeamsTriggers", "theActiveTeamOrdersAllItsTriggersFirst", "SharedTurnsDevTest.thePrimaryPlayerOrdersTheTeamsTriggers"] },
  { name: "active-team-triggers-not-first", edits: [[STACK, "            for (List<Player> team : teams) {\n                result |= chooseOrderOfTeamSimultaneousStackEntry(team, false);", "            for (List<Player> team : Lists.reverse(teams)) {\n                result |= chooseOrderOfTeamSimultaneousStackEntry(team, false);"]],
    expect: ["theActiveTeamOrdersAllItsTriggersFirst", "theActiveTeamsTriggersGoOnTheStackFirst"] },
  { name: "active-player-always-first-seat", edits: [[PH, "        if (!isSharedTeamTurns() || playerTurn == null) {\n            return playerTurn;\n        }\n        if (teamStepPlayer != null) {", "        if (true) {\n            return playerTurn;\n        }\n        if (teamStepPlayer != null) {"]],
    expect: ["eachPlayersEndStepCountsThatPlayersLands"] },
  { name: "once-per-team-off", edits: [[SAE, "if (players.isEmpty() || !players.getFirst().getGame().getRules().hasSharedTeamTurns()) {", "if (true) {"]],
    expect: ["oneEffectSkippingBothOpponentsTurnsSkipsOneTeamTurn", "oneEffectSkippingBothUntapsSkipsOneUntapStep"] },
  { name: "add-turn-per-player", edits: [["forge-game/src/main/java/forge/game/ability/effects/AddTurnEffect.java", "for (final Player p : oncePerTeam(getTargetPlayers(sa))) {", "for (final Player p : getTargetPlayers(sa)) {"]],
    expect: ["oneEffectGivingBothPartnersATurnGivesOneTeamTurn"] },
  { name: "skip-phase-per-player", edits: [["forge-game/src/main/java/forge/game/ability/effects/SkipPhaseEffect.java", "for (final Player player : oncePerTeam(getTargetPlayers(sa))) {", "for (final Player player : getTargetPlayers(sa)) {"]],
    expect: ["oneEffectSkippingBothUntapsSkipsOneUntapStep"] },
  { name: "skip-turn-per-player", edits: [["forge-game/src/main/java/forge/game/ability/effects/SkipTurnEffect.java", "for (final Player player : oncePerTeam(getTargetPlayers(sa))) {", "for (final Player player : getTargetPlayers(sa)) {"]],
    expect: ["oneEffectSkippingBothOpponentsTurnsSkipsOneTeamTurn"] },
  { name: "team-block-validated-per-player", edits: [[CU, "        final List<Card> blockers = combat.isSharedTeamAttack()\n", "        final List<Card> blockers = false\n"]],
    expect: [] },
  { name: "team-block-checks-first-member-only", edits: [[PH, "            for (final Player member : team) {\n                invalid = CombatUtil.validateBlocks(combat, member);", "            for (final Player member : List.of(team.get(0))) {\n                invalid = CombatUtil.validateBlocks(combat, member);"]],
    expect: ["theTeamsBlockIsCheckedForTheSecondDefenderToo"] },
  { name: "team-block-not-re-asked", edits: [[PH, "if (invalid == null || refused >= MAX_REFUSED_TEAM_DECLARATIONS) {", "if (true) {"]],
    expect: ["aRefusedTeamBlockIsAskedAgainThenStands"] },
  { name: "team-attack-not-re-asked", edits: [[PH, "if (!success && isSharedTeamTurns() && combat.getRefusedTeamAttacks() >= MAX_REFUSED_TEAM_DECLARATIONS) {", "if (!success && isSharedTeamTurns()) {"]],
    expect: ["aRefusedTeamAttackIsAskedAgainThenTakesTheLegalAttack"] },
  { name: "level1-block-prompt-own-attackers", edits: [[MBIC, "final boolean teamAttackers = teamBlock || game.getRules().hasSharedTeamLife();", "final boolean teamAttackers = teamBlock;"]],
    expect: ["aLevelOneDefenderBlocksForItsPartnerInThePrompt"] },
  { name: "coveted-jewel-first-seat", edits: [["forge-game/src/main/java/forge/game/trigger/TriggerAttackerUnblockedOnce.java", "        for (final Player p : combat.getAttackingPlayers()) {\n            final List<GameEntity> defenders", "        for (final Player p : combat.getAttackingPlayers().subList(0, 1)) {\n            final List<GameEntity> defenders"]],
    expect: ["anUnblockedPartnerGetsCovetedJewel"] },
];

const known = fs.existsSync(KNOWN) ? fs.readFileSync(KNOWN, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean) : [];
const todo = MUTATIONS.filter((m) => !ONLY || ONLY.includes(m.name));
let stale = 0;
const output = LOCAL ? runLocal() : runDocker();

function runDocker() {
  const work = path.join(ENGINE, "tmp", "l2-mut");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, "mut"), { recursive: true });
  const forge = path.join(ENGINE, "forge");
  const git = (...a) => spawnSync("git", ["-C", forge, ...a], { encoding: "utf8" }).stdout;
  const changed = (git("diff", "--name-only", BASE, "--", "*.java") + git("ls-files", "--others", "--exclude-standard", "--", "*.java"))
    .split(/\r?\n/).filter((l) => l && !l.includes("/src/test/"));
  fs.writeFileSync(path.join(work, "forgelist.txt"), changed.join("\n") + "\n");
  for (const m of todo) {
    if (m.edits.some(([file]) => file.startsWith("forge-harness/"))) { console.log(`NEEDS-LOCAL ${m.name}: it edits forge-harness`); continue; }
    const dir = path.join(work, "mut", m.name);
    fs.mkdirSync(dir, { recursive: true });
    const files = {};
    for (const [file, from, to] of m.edits) {
      const src = files[file] ?? fs.readFileSync(path.join(forge, file), "utf8").replace(/\r\n/g, "\n");
      if (!src.includes(from)) { console.log(`STALE ${m.name}: text not found in ${file}`); stale++; continue; }
      files[file] = src.replace(from, to);
    }
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), text);
    }
  }
  const r = spawnSync("docker", ["run", "--rm", "--cpus", "2", "-v", `${path.join(ENGINE, "forge-harness")}:/src:ro`, "-v", `${forge}:/forge:ro`,
    "-v", `${path.join(work, "forgelist.txt")}:/forgelist.txt:ro`, "-v", `${path.join(work, "mut")}:/mut:ro`, "-v", `${path.join(__dirname, "l2-mutate.sh")}:/l2-mutate.sh:ro`,
    "--entrypoint", "sh", `mtg-harness-test:${IMAGE}`, "/l2-mutate.sh", "SharedTurnsTest"], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  return r.stdout.replace(/^(### .+)$/gm, "$1\n#### SharedTurnsTest");
}

function runLocal() {
  const tree = path.resolve(LOCAL);
  const forge = path.join(tree, "forge");
  const jar = path.join(tree, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
  if (!fs.existsSync(jar)) { console.error(`no ${jar}: run engine/test-harness-local.sh first`); process.exit(2); }
  const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l2-mut-"));
  const tests = path.join(tmp, "test");
  fs.mkdirSync(tests);
  const testSources = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith(".java")) testSources.push(f); } };
  walk(path.join(tree, "forge-harness", "src", "test", "java"));
  const javac = (out, cp, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", cp, ...files], { encoding: "utf8" });
  const tc = javac(tests, jar, testSources);
  if (tc.status !== 0) { console.error(tc.stdout, tc.stderr); process.exit(1); }
  const saved = new Map();
  const restore = () => {
    for (const [abs, { bytes, hash }] of saved) {
      fs.writeFileSync(abs, bytes);
      if (sha(fs.readFileSync(abs)) !== hash) { console.error(`RESTORE FAILED: ${abs} does not match its sha256 ${hash}`); process.exit(3); }
    }
    saved.clear();
  };
  const bail = () => { restore(); process.exit(130); };
  process.on("SIGINT", bail);
  process.on("SIGTERM", bail);
  let out = "";
  try {
    for (const m of todo) {
      out += `### ${m.name}\n`;
      const texts = {};
      for (const [file, from, to] of m.edits) {
        const abs = file.startsWith("forge-harness/") ? path.join(tree, file) : path.join(forge, file);
        if (!(abs in texts)) {
          const bytes = fs.readFileSync(abs);
          saved.set(abs, { bytes, hash: sha(bytes) });
          texts[abs] = { crlf: bytes.includes("\r\n"), text: bytes.toString("utf8").replace(/\r\n/g, "\n") };
        }
        if (!texts[abs].text.includes(from)) { console.log(`STALE ${m.name}: text not found in ${file}`); stale++; continue; }
        texts[abs].text = texts[abs].text.replace(from, to);
      }
      const edited = Object.keys(texts);
      for (const abs of edited) fs.writeFileSync(abs, texts[abs].crlf ? texts[abs].text.replace(/\n/g, "\r\n") : texts[abs].text);
      const mut = path.join(tmp, "mut", m.name);
      fs.mkdirSync(mut, { recursive: true });
      const mc = edited.length ? javac(mut, jar, edited) : { status: 0 };
      restore();
      if (mc.status !== 0) { out += `COMPILE-ERROR\n${(mc.stdout + mc.stderr).split("\n").slice(0, 5).join("\n")}\n`; continue; }
      let failures = 0;
      for (const cls of TESTS) {
        const run = spawnSync("java", ["-cp", [mut, tests, jar].join(path.delimiter), `forge.harness.host.${cls}`],
          { cwd: tree, encoding: "utf8", timeout: 900000, maxBuffer: 1 << 26 });
        const lines = `${run.stdout}${run.stderr}`.split(/\r?\n/).filter((l) => /^(ok|FAIL) /.test(l));
        out += `#### ${cls}\n${lines.join("\n")}\n`;
        failures += lines.filter((l) => l.startsWith("FAIL ") && !/^FAIL \w+Test: /.test(l)).length;
      }
      console.error(`ran ${m.name}: ${failures} failed`);
    }
  } finally {
    restore();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}
const runs = {};
let current = null;
for (const line of output.split(/\r?\n/)) {
  const head = /^### (.+)$/.exec(line);
  if (head) { current = runs[head[1]] = { failed: [], passed: [], error: null, cls: "SharedTurnsTest" }; continue; }
  if (!current) continue;
  const cls = /^#### (\w+)$/.exec(line);
  if (cls) { current.cls = cls[1]; continue; }
  if (line === "COMPILE-ERROR") current.error = "compile error";
  if (/^(ok|FAIL) \w+Test: /.test(line)) continue;
  const m = /^(ok|FAIL) (?:cr\S+ )?(\w+)(?::|$)/.exec(line);
  if (m) current[m[1] === "ok" ? "passed" : "failed"].push(`${current.cls}.${m[2]}`);
}
const short = (n) => n.replace(/^\w+\./, "");
const hit = (list, n) => list.includes(n) || (!n.includes(".") && list.some((x) => short(x) === n));
let bad = stale;
for (const m of todo) {
  const run = runs[m.name];
  if (!run || run.error || run.passed.length + run.failed.length === 0) { console.log(`FAIL ${m.name}: ${run?.error || "no results"}`); bad++; continue; }
  if (m.name === "none") {
    const extra = run.failed.filter((n) => !known.includes(n) && !known.includes(short(n)));
    const fixed = known.filter((n) => hit(run.passed, n));
    console.log(`${extra.length ? "FAIL" : "ok"} none: fails ${JSON.stringify(run.failed)}${extra.length ? `, not in the known-failing list: ${extra}` : ""}${fixed.length ? `; known-failing now pass (take them off the list): ${fixed}` : ""}`);
    if (extra.length) bad++;
    continue;
  }
  if (m.expect.length === 0) { console.log(`FAIL ${m.name}: no check is expected to catch it; fails ${JSON.stringify(run.failed)}`); bad++; continue; }
  const missed = m.expect.filter((n) => !hit(run.failed, n));
  console.log(`${missed.length ? "FAIL" : "ok"} ${m.name}: fails ${JSON.stringify(run.failed)}${missed.length ? `; still passing, so blind to it: ${missed}` : ""}`);
  if (missed.length) bad++;
}
console.log(bad ? `FAILED: ${bad} mutation(s)` : `PASSED: every mutation caught by name (${todo.length} runs)`);
process.exit(bad ? 1 : 0);
