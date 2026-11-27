// Break-it for the snapshot's cached combat statics (forge-harness CombatStatics, InteractiveSnapshotExtractor's
// combatFlags; tests SnapshotSpeedTest and CardStateFlagsTest): each mutation switches one piece off, compiles only the
// edited file over the harness jar, runs both test classes and requires the named check to fail; the file is put back
// and checked by sha256. Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-snapshot-speed.js <engine tree> [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const H = "forge-harness/src/main/java/forge/harness/host/";
const C = H + "CombatStatics.java", X = H + "InteractiveSnapshotExtractor.java";
const MIXED = "same flags: a mixed board, each viewer and each player's turn";
// [label, file (in the tree), from, to, check that must fail]
const MUTATIONS = [
  ["can't-block statics not read", C, "            if (StaticAbilityCantAttackBlock.applyCantBlockAbility(stAb, blocker)) {", "            if (false) {", MIXED],
  ["can't block alone ignored", C, "            return CombatUtil.canBlock(blocker, true);\n", "            return true;\n", "same flags: can't block alone, alone and with a partner"],
  ["can't-attack statics not read", C, "            if (cantAttackApplies(stAb, attacker, defender)) {", "            if (false) {", MIXED],
  ["a defender attacks despite Rolling Stones' absence", C, "        return !canAttackDefender(card, target);\n", "        return false;\n", "same flags: defenders without and with Rolling Stones"],
  ["Rolling Stones ignored", C, "            if (StaticAbilityCantAttackBlock.applyCanAttackDefenderAbility(stAb, card, target)) {", "            if (false) {", "same flags: defenders without and with Rolling Stones"],
  ["Peacekeeper ignored", C, "        if (attacker.isDetained()) {\n            return true;\n        }\n        for (final StaticAbility stAb : cantAttack) {", "        if (attacker.isDetained()) {\n            return true;\n        }\n        for (final StaticAbility stAb : java.util.List.<StaticAbility>of()) {", "same flags: Peacekeeper stops every attack"],
  ["must-attack's turn rule dropped", C, "                if (e instanceof Player attackPl && phases.isPlayerTurn(attackPl)) {\n                    continue;\n                }\n", "", MIXED],
  ["must-attack for every creature", C, "            if (!stAb.matchesValidParam(\"ValidCreature\", attacker)) {", "            if (false) {", MIXED],
  ["the statics' conditions not checked", C, " || !stAb.checkConditions()) {", ") {", MIXED],
  ["the scan kept across rounds", C, "    static CombatStatics of(final Game game) {\n        final CombatStatics out = new CombatStatics(game);\n",
    "    private static final java.util.Map<Game, CombatStatics> KEPT = new java.util.WeakHashMap<>();\n    static CombatStatics of(final Game game) {\n        final CombatStatics kept = KEPT.get(game);\n        if (kept != null) {\n            return kept;\n        }\n        final CombatStatics out = new CombatStatics(game);\n        KEPT.put(game, out);\n", "theNextWaitSeesWhatChanged"],
  ["the scan made per creature", X, "            if (statics == null || statics.game() != game) {", "            if (true) {", "scan: one static scan for a round of 1,000 creatures"],
  ["Forge's per-creature attack scan back", X, "            if (statics.canAttackNextTurn(card, defender)) {", "            if (CombatUtil.canAttackNextTurn(card, defender)) {", "timing: 3,000 tokens' flags take under 7x the time of 1,000 (linear, not quadratic)"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-snap-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const runTests = (extra) => {
  const failed = [];
  for (const cls of ["SnapshotSpeedTest", "CardStateFlagsTest"]) {
    const r = spawnSync("java", ["-Xmx3g", "-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), `forge.harness.host.${cls}`], { cwd: TREE, encoding: "utf8", timeout: 600000 });
    for (const l of `${r.stdout}${r.stderr}`.split("\n")) {
      if (!l.startsWith("FAIL ") || l.startsWith(`FAIL ${cls}`)) continue;
      const name = MUTATIONS.map((m) => m[4]).find((n) => l.startsWith(`FAIL ${n}:`));
      failed.push(name || l.slice(5).split(":")[0]);
    }
  }
  return failed;
};
const base = runTests(null);
if (base.length) { console.log(`BASELINE FAILS: ${base.join(", ")}`); process.exit(1); }
let missed = 0, ran = 0;
try {
  MUTATIONS.forEach(([label, file, from, to, name], i) => {
    if (only && !only.test(label)) return;
    ran++;
    const f = path.join(TREE, file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8").replace(/\r\n/g, "\n");
    const crlf = orig.includes("\r\n");
    if (src.split(from).length - 1 !== 1) { missed++; console.log(`NOT APPLIED ${label}`); return; }
    const out = path.join(tmp, `m${i}`);
    fs.mkdirSync(out);
    let failed = null;
    try {
      const next = src.replace(from, to);
      fs.writeFileSync(f, crlf ? next.replace(/\n/g, "\r\n") : next);
      const c = javac(out, [f]);
      failed = c.status === 0 ? runTests(out) : [`COMPILE ERROR ${c.stderr.split("\n")[0]}`];
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
