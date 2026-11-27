// Break-it for the AI's cheap assault estimate past the combat deadline (Forge AiAttackController.cheapAssault;
// BigBoardFixesTest's "cheap assault" checks; docs/handoff/cheap-assault-report.md). Each mutation switches one rule
// off (or makes it reckless), compiles only the edited file over the harness jar, runs the test class and requires the
// named check to fail; the file is put back and checked by sha256.
// Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-cheap-assault.js <engine tree> [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const A = "forge/forge-ai/src/main/java/forge/ai/AiAttackController.java";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["trample ignored", A, "            if (a.hasKeyword(Keyword.TRAMPLE)) {\n                tramplers.add(entry);", "            if (false) {\n                tramplers.add(entry);", "BigBoardFixesTest", "cheap assault: trample counts what is past every blocker's toughness, each capped at the biggest trampler"],
  ["a blocker's toughness not capped at the biggest trampler", A, "            held += Math.min(t[0], biggestHit) * t[1];", "            held += (long) t[0] * t[1];", "BigBoardFixesTest", "cheap assault: trample counts what is past every blocker's toughness, each capped at the biggest trampler"],
  ["one blocker per trampler (gang blocks ignored)", A, "            held += Math.min(t[0], biggestHit) * t[1];", "            held = Math.max(held, Math.min(t[0], biggestHit));", "BigBoardFixesTest", "cheap assault: a trampler gang-blocked lets through only what is past all its blockers"],
  ["menace takes one block", A, "            final int need = a.hasKeyword(Keyword.MENACE) ? 2 : 1;", "            final int need = 1;", "BigBoardFixesTest", "cheap assault: menace takes two blockers"],
  ["half a block stops nothing", A, "                anyBlock.add(new long[] {g[0] / 2, 1});", "                anyBlock.add(g);", "BigBoardFixesTest", "cheap assault: menace takes two blockers"],
  ["blocks by damage, not damage per block", A, "(x, y) -> Long.compare(y[0] * x[1], x[0] * y[1])", "(x, y) -> Long.compare(y[0], x[0])", "BigBoardFixesTest", "cheap assault: menace takes two blockers"],
  ["no evasion read from the blockers", A, "                    || !anyBinBlocks(bins, a)) {", "                    ) {", "BigBoardFixesTest", "cheap assault: can't be blocked, shadow and protection from the blockers' colour are unblocked"],
  ["can't be blocked ignored", A, "            if (unblockable(a, unblockableHosts, unblockableRules) || ", "            if (", "BigBoardFixesTest", "cheap assault: can't be blocked, shadow and protection from the blockers' colour are unblocked"],
  ["shadow ignored", A, "(shadow && (bin & 64) == 0)", "false", "BigBoardFixesTest", "cheap assault: can't be blocked, shadow and protection from the blockers' colour are unblocked"],
  ["protection from any colour", A, "            if (protection == 64 || (colors & protection) != 0) {", "            if (protection != 0) {", "BigBoardFixesTest", "cheap assault: protection from another colour than the blockers' is no evasion"],
  ["double strike ignored", A, "(a.hasKeyword(Keyword.DOUBLE_STRIKE) ? 2 : 1)", "1", "BigBoardFixesTest", "cheap assault: double strike deals twice"],
  ["infect counted as damage", A, "            if (a.hasKeyword(Keyword.INFECT)) {\n                continue;\n            }\n", "", "BigBoardFixesTest", "cheap assault: infect counts nothing toward life"],
  ["reach ignored", A, "            final boolean air = b.hasKeyword(Keyword.FLYING) || b.hasKeyword(Keyword.REACH);", "            final boolean air = b.hasKeyword(Keyword.FLYING);", "BigBoardFixesTest", "cheap assault: flyers against reach are blocked"],
  ["half the life is lethal", A, "        final boolean lethal = unblocked >= (long) defendingOpponent.getLife() + lifeBack;", "        final boolean lethal = unblocked * 2 >= (long) defendingOpponent.getLife() + lifeBack;", "BigBoardFixesTest", "cheap assault: trample counts what is past every blocker's toughness, each capped at the biggest trampler"],
  ["the old estimate's all-in on a wide board", A, "        (lethal ? CHEAP_LETHAL : CHEAP_SAFE).incrementAndGet();\n        return lethal;", "        (lethal ? CHEAP_LETHAL : CHEAP_SAFE).incrementAndGet();\n        return true;", "BigBoardFixesTest", "cheap assault: a 6x120 board that isn't lethal gets no assault"],
  ["a blocker-side rule counted as can't be blocked", A, "|| st.hasParam(\"ValidBlocker\")\n", "\n", "BigBoardFixesTest", "cheap assault: can't be blocked, shadow and protection from the blockers' colour are unblocked"],
  ["every creature taken for its own rule's host", A, "        if (hosts.contains(a)) {\n            return a.isCreature();", "        if (true) {\n            return a.isCreature();", "BigBoardFixesTest", "cheap assault: a 6x120 board that isn't lethal gets no assault"],
  ["the self rules not read", A, "                    hosts.add(host);", "                    rules.size();", "BigBoardFixesTest", "cheap assault: a 6x120 board lethal by trample and evasion is attacked with everything"],
  ["can block any number read as one block", A, "            final int blocks = b.canBlockAny() ? cap : (int) Math.min(cap, 1L + Math.max(0, b.canBlockAdditional()));", "            final int blocks = 1 + b.canBlockAdditional();", "BigBoardFixesTest", "cheap assault: a blocker that can block any number blocks them all"],
  ["lifelink blockers' gain ignored", A, "        final boolean lethal = unblocked >= (long) defendingOpponent.getLife() + lifeBack;", "        final boolean lethal = unblocked >= (long) defendingOpponent.getLife();", "BigBoardFixesTest", "cheap assault: a lifelink blocker's gain counts against lethal"],
  ["lifelink gain not counted", A, "                lifeBack += (long) power * (strikesTwice ? 2 : 1);", "                lifeBack += 0;", "BigBoardFixesTest", "cheap assault: a lifelink blocker's gain counts against lethal"],
  ["a first striker's kill ignored", A, "            if (firstStrikePower < Math.max(1, t[3])) {", "            if (true) {", "BigBoardFixesTest", "cheap assault: a first striker that kills a trampler stops all of it"],
  ["only the defender's own can't-lose read (2HG)", A, "        for (Player p : defendingOpponent.sharedLifeTeam()) {", "        for (Player p : new forge.game.player.PlayerCollection(defendingOpponent)) {", "BigBoardFixesTest", "cheap assault: with shared team life a partner who can't lose keeps the team from losing"],
  ["a first striker's power not read", A, "                firstStrikePower = Math.max(firstStrikePower, power);", "                firstStrikePower = -1;", "BigBoardFixesTest", "cheap assault: a first striker that kills a trampler stops all of it"],
  ["the defender's partner can't block (2HG)", A, "        for (Player p : defender.getYourTeam()) {\n            defenders.addAll(getPlayersPossibleBlockers(p));", "        for (Player p : new forge.game.player.PlayerCollection(defender)) {\n            defenders.addAll(getPlayersPossibleBlockers(p));", "BigBoardFixesTest", "cheap assault: with shared team life the defender's partner blocks too"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-cheap-assault-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[5]))];
const runTest = (cls, extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), `forge.harness.host.${cls}`], { cwd: TREE, encoding: "utf8", timeout: 900000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith(`FAIL ${cls}`));
  const out = lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`)) || l.slice(5, 80));
  if (r.status !== 0 && !out.length) out.push(`exit ${r.status}`);
  return out;
};
for (const cls of [...new Set(MUTATIONS.map((m) => m[4]))]) {
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
    console.log(`${hit ? "caught  " : "MISSED  "} ${label} (${cls}): ${failed.join(" | ") || "nothing failed"}`);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`${ran - missed} of ${ran} caught by name; files restored by sha256`);
process.exit(missed);
