// Break-it for the snapshot shared between viewers (engine1124-snapviewers: forge-harness SnapshotViewersTest):
// InteractiveSnapshotExtractor keeping each battlefield card's JSON once per snapshot round, kept by the viewer's view
// of its choices, face-down cards and mutate piles built per viewer as before. Each mutation switches one piece off,
// compiles only the edited file over the harness jar, runs SnapshotViewersTest and requires the named check to fail;
// the file is put back and checked by sha256. Needs a patched engine tree with its jar (engine/test-harness-local.sh
// builds both).
// (Not a mutation: the guard that builds a card the viewer may play from outside its hand per viewer. That set is the
// viewer's external zones, graveyard and exile, so no battlefield card is ever in it: the guard can't be reached.)
//   node tools/mutate-snapshot-viewers.js <engine tree> [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const X = "forge-harness/src/main/java/forge/harness/host/InteractiveSnapshotExtractor.java";
const SV = "SnapshotViewersTest";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["a card's choices not part of what it is kept by", X, "        if (known == null || !known[0].equals(choices)) {", "        if (known == null) {", SV, "bytes: a secret type shown to one viewer only"],
  ["face-down cards shared", X, "        if (card.isFaceDown() || card.hasMergedCard()) {", "        if (card.hasMergedCard()) {", SV, "bytes: a face-down creature redacted for the others, shown to its controller"],
  ["mutate piles shared", X, "        if (card.isFaceDown() || card.hasMergedCard()) {", "        if (card.isFaceDown()) {", SV, "bytes: a mutate pile, its member riding the top card"],
  ["the kept JSON written as a string", X, "                    out.jsonValue(value.json());", "                    out.value(value.json());", SV, "bytes: a mixed board, each viewer and a spectator in one round, the same as building each alone"],
  ["cards kept across rounds", X, "        private final Map<Card, String[]> cards = new IdentityHashMap<>();", "        private static final Map<Card, String[]> cards = new IdentityHashMap<>();", SV, "bytes: the board changes between rounds, the next round sees the change"],
  ["the switch ignored: every viewer builds every card", X, "        final SnapshotRound round = shareCards ? ROUND.get() : null;", "        final SnapshotRound round = null;", SV, "shared: in one round each battlefield card is built once, not once per viewer"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-snapviewers-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[5]))];
const runTest = (cls, extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), `forge.harness.host.${cls}`], { cwd: TREE, encoding: "utf8", timeout: 900000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith(`FAIL ${cls}`));
  if (r.status !== 0 && !lines.length) return [`CRASH exit ${r.status}${r.error ? ` (${r.error.code})` : ""}`]; // (a class that cannot start, or times out, prints no FAIL line: the baseline is red and no mutant is caught by it)
  return lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`) || l === `FAIL ${n}`) || l.slice(5, 80));
};
for (const cls of [SV]) {
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
