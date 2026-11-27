// Break-it for the planes' owners from the engine (forge-harness PlanechaseTest, engine1117-planarowners): each
// mutation switches one piece of Planechase.planarState's ownerIds off, compiles only the edited file over the harness
// jar, runs the test class and requires the named check to fail; the file is put back and checked by sha256.
// Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-planar-owners-engine.js <engine tree> [label pattern]
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
const P = H + "Planechase.java";
// [label, file (in the tree), from, to, check that must fail]
const MUTATIONS = [
  ["no owners sent", P, "            state.put(\"ownerIds\", ownerIds);\n", "", "planarStateNamesEachPlanesOwner"],
  ["the owner not noted", P, "                    ownerIds.put(SnapshotExtractor.javaCardId(plane), \"player-\" + SnapshotExtractor.playerIndex(game, plane.getOwner()));\n", "", "planarStateNamesEachPlanesOwner"],
  ["the controller as the owner", P, "SnapshotExtractor.playerIndex(game, plane.getOwner()));", "SnapshotExtractor.playerIndex(game, plane.getController()));", "planarStateNamesEachPlanesOwner"],
  ["an empty map sent", P, "        if (!ownerIds.isEmpty()) {\n            state.put(\"ownerIds\", ownerIds);", "        if (true) {\n            state.put(\"ownerIds\", ownerIds);", "planarStateHasNoOwnersBeforeThePlanes"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-planar-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
const runTest = (extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), "forge.harness.host.PlanechaseTest"], { cwd: TREE, encoding: "utf8", timeout: 600000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith("FAIL PlanechaseTest"));
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
