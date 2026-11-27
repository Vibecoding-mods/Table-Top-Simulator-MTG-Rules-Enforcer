// Break-it for Gift spells whose targets depend on the gift (engine1128-gift: forge-harness common.GiftTargetsTest).
// Long River's Pull ("counter target creature spell; if the gift was promised, instead counter target spell") and
// Into the Flood Maw were never offered with only the gift's kind of target: ActionSpace.hasValidTargets read the
// target count before the cast, the gift not promised. Now a Gift spell whose targets don't fit is tried again as if
// the gift were promised, on a copy made the card's cast ability for the check and put back after; the action offered
// is the spell as it was, so its cast still asks the gift. Each mutation compiles only the edited file over the harness
// jar, runs GiftTargetsTest and requires the named check to fail; the file is put back and checked by sha256.
// (Not mutations: dropping the "has a gift" or the "already promised" guard, since a spell with no gift gains nothing
// from the second try: plain aSpellWithoutGiftIsNotOfferedWithoutTargets checks the outcome.)
//   node tools/mutate-gift-targets.js <engine tree> [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const AS = "forge-harness/src/main/java/forge/harness/common/ActionSpace.java";
const GT = "GiftTargetsTest";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["no second try with the gift", AS, "        return targetsFit(sa) || targetsFitWithGift(sa);", "        return targetsFit(sa);", GT, "switch longRiversPullOfferedForANoncreatureSpell"],
  ["the copy not promised", AS, "        promised.addOptionalCost(OptionalCost.PromiseGift);\n", "", GT, "switch longRiversPullOfferedForANoncreatureSpell"],
  ["the copy not the card's cast ability", AS, "        host.setCastSA(promised);\n", "", GT, "switch intoTheFloodMawOfferedForANoncreaturePermanent"],
  ["the card's cast ability not put back", AS, "            host.setCastSA(castSA);\n", "", GT, "residue theCardsCastAbilityIsPutBack"],
  ["the offered spell promised itself", AS, "        final SpellAbility promised = sa.copy();", "        final SpellAbility promised = sa;", GT, "ask theOfferedSpellStillAsksTheGift"],
  ["both gift choices needed", AS, "        return targetsFit(sa) || targetsFitWithGift(sa);", "        return targetsFit(sa) && (targetsFitWithGift(sa) || !sa.isSpell());", GT, "more wearDownOfferedWithOneTarget"],
  ["the gift try always fits", AS, "            return targetsFit(promised);", "            return true;", GT, "switch longRiversPullNotOfferedWithNoSpell"],
  ["a minimum of one target always", AS, "                final int minTargets = current.getMinTargets();", "                final int minTargets = Math.max(1, current.getMinTargets());", GT, "extra valleyRallyOfferedWithNoGiftTarget"],
  ["spells on the stack not counted as targets", AS, "boolean hasEnoughCandidates = candidates.size() + stackCandidates.size() >= minTargets;", "boolean hasEnoughCandidates = candidates.size() >= minTargets;", GT, "switch longRiversPullOfferedForACreatureSpell"],
  ["one target too few counted", AS, "boolean hasEnoughCandidates = candidates.size() + stackCandidates.size() >= minTargets;", "boolean hasEnoughCandidates = candidates.size() + stackCandidates.size() + 1 >= minTargets;", GT, "plain aSpellWithoutGiftIsNotOfferedWithoutTargets"],
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
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), `forge.harness.common.${cls}`], { cwd: TREE, encoding: "utf8", timeout: 900000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith(`FAIL ${cls}`));
  if (r.status !== 0 && !lines.length) return [`CRASH exit ${r.status}${r.error ? ` (${r.error.code})` : ""}`]; // (a class that cannot start, or times out, prints no FAIL line: the baseline is red and no mutant is caught by it)
  return lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`) || l === `FAIL ${n}`) || l.slice(5, 80));
};
for (const cls of [GT]) {
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
