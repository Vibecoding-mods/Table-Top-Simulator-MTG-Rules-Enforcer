// Break-it for the dependency scans (engine1124-depscans: forge-harness DependencyScanTest): GameAction's CR 613.8
// dependency detection working out each static's battlefield filter and conditions once per search, skipping a static
// that applies to nothing, and keeping the results while the static applied in between changed nothing. Each mutation
// switches one piece off, compiles only the edited file over the harness jar, runs DependencyScanTest and requires the
// named check to fail; the file is put back and checked by sha256. Needs a patched engine tree with its jar
// (engine/test-harness-local.sh builds both).
//   node tools/mutate-dependency-scans.js <engine tree> [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const G = "forge/forge-game/src/main/java/forge/game/GameAction.java";
const DS = "DependencyScanTest";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["the cache kept after a static that changed something", G, "                if (scans != null && affectedHere != null && !(nothingForPlayers && affectedHere.isEmpty())) {\n                    scans.clear();", "                if (scans != null && affectedHere != null && !(nothingForPlayers && affectedHere.isEmpty())) {\n                    scans.affected.size();", DS, "same: Levitation and Sephara's indestructible for fliers, then Gravity Sphere (a layer 6 dependency on flying)"],
  ["the cache dropped after every static", G, "                if (scans != null && affectedHere != null && !(nothingForPlayers && affectedHere.isEmpty())) {", "                if (scans != null) {", DS, "scans: a pass whose layer 6 statics all affect nothing scans each once"],
  ["the rescan after the other taken from the cache", G, "                    CardCollectionView affectedAfterOther = StaticAbilityContinuous.getAffectedCards(stAb, preList);", "                    CardCollectionView affectedAfterOther = scans != null ? scans.affected(stAb, preList) : StaticAbilityContinuous.getAffectedCards(stAb, preList);", DS, "same: Gravity Sphere first, then Levitation and Sephara"],
  ["a static that affects nothing still applied and rescanned", G, "            return cards.isEmpty() && stAb.hasParam(\"Affected\")", "            return false && cards.isEmpty() && stAb.hasParam(\"Affected\")", DS, "scans: a pass whose layer 6 statics all affect nothing scans each once"],
  ["conditions not checked before applying the other", G, "            return applies.computeIfAbsent(stAb, st -> st.appliesBefore(layer));", "            return true;", DS, "same: Sephara, then Toby's flying for tokens off with two tokens and on with four"],
  ["the other applied to the first static's cards", G, "                    affectedOther = StaticAbilityContinuous.applyContinuousAbility(otherStAb, new CardCollection(cards), layer);", "                    affectedOther = StaticAbilityContinuous.applyContinuousAbility(otherStAb, new CardCollection(affectedHere), layer);", DS, "same: Gravity Sphere first, then Levitation and Sephara"],
  ["the switch ignored: always the old scan for each pair", G, "            final DependencyScans scans = dependencyScanCache ? new DependencyScans() : null;", "            final DependencyScans scans = null;", DS, "scans: a pass after a tap, Titania's Song over 33 layer 6 statics, at most half the scans"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-depscans-"));
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
for (const cls of [DS]) {
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
