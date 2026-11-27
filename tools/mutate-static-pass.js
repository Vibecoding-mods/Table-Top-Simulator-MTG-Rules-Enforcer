// Break-it for one replacement lookahead per run (engine1124-staticpass: forge-harness StaticPassTest):
// ReplacementHandler's single CR 614.12 lookahead for a card moving to the battlefield, split by layer. Each mutation
// switches one piece off, compiles only the edited file over the harness jar, runs StaticPassTest and requires the named
// check to fail; the file is put back and checked by sha256. Needs a patched engine tree with its jar
// (engine/test-harness-local.sh builds both).
// (Not a mutation: the guard that keeps a move a replacement itself made on the per-layer path. With no other choices
// for its layer, the cause's shortcut isn't taken and one lookahead finds the same lists, so dropping the guard changes
// nothing there; with other choices, the shortcut's layer.equals would throw on a scan with no layer. No card in the
// pool gives one entering card two replacements in one layer that move it: docs/handoff/static-pass-report.md.)
//   node tools/mutate-static-pass.js <engine tree> [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const R = "forge/forge-game/src/main/java/forge/game/replacement/ReplacementHandler.java";
const BB = "StaticPassTest";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["a lookahead for each layer still", R, "        final Map<ReplacementLayer, List<ReplacementEffect>> byLayer = lookaheadPerRun && ReplacementType.Moved.equals(event)", "        final Map<ReplacementLayer, List<ReplacementEffect>> byLayer = false && ReplacementType.Moved.equals(event)", BB, "passes: a card entering the battlefield runs 4 static passes, not 12"],
  ["no layer gets its list", R, "                    : run(event, runParams, layer, decider, byLayer.getOrDefault(layer, Lists.newArrayList()));", "                    : run(event, runParams, layer, decider, Lists.newArrayList());", BB, "same: Clone under Authority of the Consuls, Grumgully, Doubling Season, Rest in Peace and Leyline of the Void"],
  ["every layer gets the Other layer's list", R, "                    : run(event, runParams, layer, decider, byLayer.getOrDefault(layer, Lists.newArrayList()));", "                    : run(event, runParams, layer, decider, byLayer.getOrDefault(ReplacementLayer.Other, Lists.newArrayList()));", BB, "same: Clone under Authority of the Consuls, Grumgully, Doubling Season, Rest in Peace and Leyline of the Void"],
  ["the Copy layer's list for all", R, "                    : run(event, runParams, layer, decider, byLayer.getOrDefault(layer, Lists.newArrayList()));", "                    : run(event, runParams, layer, decider, byLayer.getOrDefault(ReplacementLayer.Copy, Lists.newArrayList()));", BB, "same: Clone under Authority of the Consuls, Grumgully, Doubling Season, Rest in Peace and Leyline of the Void"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-staticpass-"));
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
for (const cls of [BB]) {
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
