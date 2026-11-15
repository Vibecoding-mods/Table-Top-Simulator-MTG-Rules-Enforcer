// Mutation check for the Two-Headed Giant level 2 engine tests (forge-harness SharedTurnsTest): each mutation below
// breaks one shared-team-turns rule in the engine source, and the run passes only if every check listed for it FAILS
// under that mutation (and the unmutated "none" run fails nothing beyond the known-failing list). Proves each test
// fails by name when its rule is broken. The edits are pinned to the WIP engine commit (forge 7d586b47): a mutation
// whose text is no longer found is reported, not skipped silently; update its from/to when the engine moves.
// usage: node tools/l2-mutate.js --engine <manabrew tree> [--base 85bc8c3d] [--image engine1116-teams2] [--only name,...]
// Runs one container (2 CPUs); go through tmp/slot.js on a shared machine.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const ENGINE = arg("engine", null);
const BASE = arg("base", "85bc8c3d");
const IMAGE = arg("image", "engine1116-teams2");
const ONLY = arg("only", "") ? arg("only").split(",") : null;
const KNOWN = path.join(__dirname, "..", "docs", "2hg-level2-known-failing.txt");
if (!ENGINE) { console.error("usage: node tools/l2-mutate.js --engine <manabrew tree>"); process.exit(2); }

const PH = "forge-game/src/main/java/forge/game/phase/PhaseHandler.java";
const COMBAT = "forge-game/src/main/java/forge/game/combat/Combat.java";
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
  { name: "phase-trigger-first-seat-only", edits: [[PH, "            for (final Player member : getActiveTeam()) {\n                final Map<AbilityKey, Object> runParams = AbilityKey.mapFromPlayer(member);\n                game.getTriggerHandler().runTrigger(TriggerType.Phase, runParams, false);",
    "            for (final Player member : java.util.List.of(playerTurn)) {\n                final Map<AbilityKey, Object> runParams = AbilityKey.mapFromPlayer(member);\n                game.getTriggerHandler().runTrigger(TriggerType.Phase, runParams, false);"]],
    expect: ["eachPlayersUpkeepTriggersForEachMember", "eachPlayersDrawStepTriggersForEachMember", "yourUpkeepTriggersForThePartner"] },
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
];

const known = fs.existsSync(KNOWN) ? fs.readFileSync(KNOWN, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean) : [];
const work = path.join(ENGINE, "tmp", "l2-mut");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, "mut"), { recursive: true });
const forge = path.join(ENGINE, "forge");
const git = (...a) => spawnSync("git", ["-C", forge, ...a], { encoding: "utf8" }).stdout;
const changed = (git("diff", "--name-only", BASE, "--", "*.java") + git("ls-files", "--others", "--exclude-standard", "--", "*.java"))
  .split(/\r?\n/).filter((l) => l && !l.includes("/src/test/"));
fs.writeFileSync(path.join(work, "forgelist.txt"), changed.join("\n") + "\n");
const todo = MUTATIONS.filter((m) => !ONLY || ONLY.includes(m.name));
let stale = 0;
for (const m of todo) {
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
const runs = {};
let current = null;
for (const line of r.stdout.split(/\r?\n/)) {
  const head = /^### (.+)$/.exec(line);
  if (head) { current = runs[head[1]] = { failed: [], passed: [], error: null }; continue; }
  if (!current) continue;
  if (line === "COMPILE-ERROR") current.error = "compile error";
  const m = /^(ok|FAIL) cr\S+ (\w+)/.exec(line);
  if (m) current[m[1] === "ok" ? "passed" : "failed"].push(m[2]);
}
let bad = stale;
for (const m of todo) {
  const run = runs[m.name];
  if (!run || run.error || run.passed.length + run.failed.length === 0) { console.log(`FAIL ${m.name}: ${run?.error || "no results"}`); bad++; continue; }
  if (m.name === "none") {
    const extra = run.failed.filter((n) => !known.includes(n));
    const fixed = known.filter((n) => run.passed.includes(n));
    console.log(`${extra.length ? "FAIL" : "ok"} none: fails ${JSON.stringify(run.failed)}${extra.length ? `, not in the known-failing list: ${extra}` : ""}${fixed.length ? `; known-failing now pass (take them off the list): ${fixed}` : ""}`);
    if (extra.length) bad++;
    continue;
  }
  const missed = m.expect.filter((n) => !run.failed.includes(n));
  console.log(`${missed.length ? "FAIL" : "ok"} ${m.name}: fails ${JSON.stringify(run.failed)}${missed.length ? `; still passing, so blind to it: ${missed}` : ""}`);
  if (missed.length) bad++;
}
console.log(bad ? `FAILED: ${bad} mutation(s)` : `PASSED: every mutation caught by name (${todo.length} runs)`);
process.exit(bad ? 1 : 0);
