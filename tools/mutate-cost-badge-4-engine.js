// Break-it for the engine's cost badge, phase 4 (forge-harness CostBadgeTest): what a way costs besides mana and the
// tie-break of the cheapest way. Each mutation switches one piece of PlayCost (or its hook in the snapshot) off, compiles only the edited file over the harness jar, runs the test class
// and requires the named check to fail; the file is put back and checked by sha256.
// Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-cost-badge-4-engine.js <engine tree> [label pattern]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const H = "forge-harness/src/main/java/forge/harness/host/";
const P = H + "PlayCost.java";
const X = H + "InteractiveSnapshotExtractor.java";
// [label, file (in the tree), from, to, check that must fail]
const MUTATIONS = [
  ["the extra words dropped", P, "        return words.isEmpty() ? null : String.join(\", \", words);", "        return null;", "extra: escape's exiled cards are named"],
  ["the mana part counted as extra", P, "            if (!(part instanceof CostPartMana)) {", "            if (true) {", "extra: a plain flashback names nothing more"],
  ["the extra not sent for the way cast now", X, "dto.playCostExtra = play.pick.extra;", "dto.playCostExtra = null;", "extra: a flashback paid with sacrifices alone reads {0} with the sacrifices named"],
  ["an other way's extra not sent", P, "            return new SpellCostDto(name, cost(), printed, mode, extra);", "            return new SpellCostDto(name, cost(), printed, mode, null);", "cheapest: a tie in mana value goes to the way with no other cost, the other listed with its life"],
  ["mana value not first", P, "        if (a.mana.getCMC() != b.mana.getCMC()) {", "        if (false) {", "cheapest: the tie-break, by the ways themselves"],
  ["no tie-break by parts", P, "            return a.parts < b.parts;", "            return false;", "cheapest: the tie-break, by the ways themselves"],
  ["no tie-break by life", P, "        return a.life < b.life;", "        return false;", "cheapest: the tie-break, by the ways themselves"],
  ["a tie goes to the last way", P, "        return a.life < b.life;", "        return a.life <= b.life;", "cheapest: the tie-break, by the ways themselves"],
  ["more parts preferred", P, "            return a.parts < b.parts;", "            return a.parts > b.parts;", "cheapest: a tie in mana value goes to the way with no other cost, the other listed with its life"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-cost4-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
const runTest = (extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), "forge.harness.host.CostBadgeTest"], { cwd: TREE, encoding: "utf8", timeout: 600000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith("FAIL CostBadgeTest"));
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
