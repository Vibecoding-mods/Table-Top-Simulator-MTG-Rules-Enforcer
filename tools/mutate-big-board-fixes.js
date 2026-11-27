// Break-it for the big-board fixes (forge-harness BigBoardFixesTest, engine1117-bigboard): each mutation switches one
// piece off (Forge's GameActionUtil in-play land skip and GameAction's pass count, ComputerUtilMana's payment budget,
// AiBlockController's chump blocks past the deadline, the session's checkpoint cap), compiles only the
// edited file over the harness jar, runs the test class and requires the named check to fail; the file is put back and
// checked by sha256. Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-big-board-fixes.js <engine tree> [label pattern]
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
const S = H + "ManaBrewInteractiveSession.java";
const G = "forge/forge-game/src/main/java/forge/game/";
const U = G + "GameActionUtil.java", A = G + "GameAction.java";
const M = "forge/forge-ai/src/main/java/forge/ai/ComputerUtilMana.java", K = "forge/forge-ai/src/main/java/forge/ai/AiBlockController.java";
// [label, file (in the tree), from, to, check that must fail]
const MUTATIONS = [
  ["actions: the in-play land skip off", U, "if (skipInPlayLandAlternatives && sa.isLandAbility() && source.isInPlay()) {", "if (false) {", "actions: no static pass for an in-play land's play ability"],
  ["actions: every land play skipped, in play or not", U, "if (skipInPlayLandAlternatives && sa.isLandAbility() && source.isInPlay()) {", "if (skipInPlayLandAlternatives && sa.isLandAbility()) {", "actions: a land in the graveyard still offers its play from there"],
  ["passes: not counted", A, "        staticPasses++;\n", "", "actions: no static pass for an in-play land's play ability"],
  ["pay: the static checks never held", M, "                    ai.getGame().getAction().setHoldCheckingStaticAbilities(true);\n", "", "pay: past the deadline the payment is made with the static checks held, then one pass"],
  ["pay: the hold not released", M, "                ai.getGame().getAction().setHoldCheckingStaticAbilities(false);\n", "", "pay: past the deadline the payment is made with the static checks held, then one pass"],
  ["pay: no pass after the held payment", M, "                ai.getGame().getAction().setHoldCheckingStaticAbilities(false);\n                ai.getGame().getAction().checkStaticAbilities();\n", "                ai.getGame().getAction().setHoldCheckingStaticAbilities(false);\n", "pay: past the deadline the payment is made with the static checks held, then one pass"],
  ["pay: the deadline taken as passed at once", M, "System.currentTimeMillis() >= budget.deadline", "true", "pay: within the deadline every mana ability runs its static pass as before"],
  ["block: no chump blocks past the deadline", K, "            makeChumpBlocksPastDeadline(combat, ai.getCreaturesInPlay());\n", "", "block: past the deadline a lethal attack is chump-blocked"],
  ["block: chump blocks when not lethal", K, "            if (damage < ai.getLife()) {\n                break;\n            }\n", "", "block: past the deadline an attack that isn't lethal gets no forced blocks"],
  ["checkpoints: the cap not by size", S, "return (int) Math.max(1, Math.min(MAX_CHECKPOINTS, CHECKPOINT_BUDGET_BYTES / perCheckpoint));", "return MAX_CHECKPOINTS;", "checkpoints: the cap falls with the cards in the game"],
  ["checkpoints: bytes per card in thousands", S, "CHECKPOINT_BYTES_PER_CARD = 27 * 1024;", "CHECKPOINT_BYTES_PER_CARD = 27 * 1000;", "checkpoints: the cap falls with the cards in the game"],
  ["checkpoints: the newest dropped", S, "        return first != null && first != newest && first != keep ? first : null;", "        return newest != keep ? newest : null;", "checkpoints: past the turns' firsts the oldest turns go"],
  ["checkpoints: the session not capped", S, "        thinCheckpoints(checkpoints, checkpointCap(cardsInZones(game)),\n", "        thinCheckpoints(checkpoints, 1000,\n", "checkpoints: the session keeps no more than the cap"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-bigboard-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
const runTest = (extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), "forge.harness.host.BigBoardFixesTest"], { cwd: TREE, encoding: "utf8", timeout: 600000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith("FAIL BigBoardFixesTest"));
  return lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`)) || l.slice(5, 80));
};
const base = runTest(null);
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
      failed = c.status === 0 ? runTest(out) : [`COMPILE ERROR ${c.stderr.split("\n")[0]}`];
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
