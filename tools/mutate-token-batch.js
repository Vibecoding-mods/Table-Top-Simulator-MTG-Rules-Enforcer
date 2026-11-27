// Break-it for the token batch (engine1122-tokenbatch: forge-harness TokenBatchTest): Forge's TokenEffectBase batch of one
// effect's tokens of one kind (the static checks held after the first, one pass after) and ReplacementHandler's
// MovedBatch (the enter-the-battlefield replacement check skipped for the rest when none applied to the first). Each
// mutation switches one piece off, compiles only the edited file over the harness jar, runs TokenBatchTest and requires
// the named check to fail; the file is put back and checked by sha256. Needs a patched engine tree with its jar
// (engine/test-harness-local.sh builds both).
// (Not a mutation here: ReplacementHandler's replacersFound count, which stops a batch when a replacement was found for
// the first token but didn't replace it, such as a declined optional one. No card in the pool gives an entering token
// an optional replacement from another permanent, so no check can reach it: docs/handoff/token-quadratic-report.md.)
//   node tools/mutate-token-batch.js <engine tree> [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const G = "forge/forge-game/src/main/java/forge/game/";
const T = G + "ability/effects/TokenEffectBase.java", R = G + "replacement/ReplacementHandler.java";
const BB = "TokenBatchTest";
// [label, file (in the tree), from, to, test class, check that must fail]
const MUTATIONS = [
  ["no batch", T, "            final boolean batchable = !clone && prototype.getCopiedPermanent() == null && !sa.hasParam(\"AttachedTo\")", "            final boolean batchable = false && !clone && prototype.getCopiedPermanent() == null && !sa.hasParam(\"AttachedTo\")", BB, "passes: the static passes of one effect don't grow with the tokens it makes"],
  ["the rest not held", T, "                    game.getAction().setHoldCheckingStaticAbilities(true);\n                    held = true;", "                    held = true;", BB, "passes: the static passes of one effect don't grow with the tokens it makes"],
  ["no pass after the batch", T, "                        game.getAction().checkStaticAbilities();\n                        // (each one's entry", "                        // (each one's entry", BB, "layers: after the batch every token has the anthems, the lord and their keywords"],
  ["the hold not released", T, "                    game.getAction().setHoldCheckingStaticAbilities(false);\n                    try {", "                    try {", BB, "hold: the static checks are not held after the effect"],
  ["tokens made with counters batched", T, "                    && !sa.hasParam(\"WithCountersType\") && cellAmount > 1", "                    && cellAmount > 1", BB, "not batched: tokens made with counters each get them"],
  ["the lookahead not skipped", R, "        if (batch != null && batch.nothingApplies()) {\n            return ReplacementResult.NotReplaced;\n        }", "        if (false) {\n            return ReplacementResult.NotReplaced;\n        }", BB, "passes: the replacement lookahead runs for the first token of a kind only"],
  ["the updated event's check decides too", R, "        final boolean decides = batch != null && !batch.checked;", "        final boolean decides = batch != null;", BB, "replacements: a replacement that applies to the first token applies to each, none batched"],
  ["lookahead checks not counted", R, "            MOVED_CHECKS.incrementAndGet();\n", "", BB, "passes: the replacement lookahead runs for the first token of a kind only"],
  ["the entries not taken again after the pass", T, "                        for (final Card token : heldTokens) {\n                            if (token.getZone() != null) {\n                                token.getZone().refreshAddedLKI(token);\n                            }\n                        }\n", "", BB, "triggers: under a +3/+3 anthem each 1/1 token triggers Elemental Bond and Garruk's Uprising"],
  ["the hold not released on an exception", T, "                    game.getAction().setHoldCheckingStaticAbilities(false);\n                    try {", "                    try {", BB, "exception: one thrown mid-batch is the one that comes out, the hold released"],
  ["a batch inside a hold", T, " && cellAmount > 1 && !game.getAction().isHoldingStaticAbilities();", " && cellAmount > 1;", BB, "not batched: an effect while the static checks are already held"],
  ["no pass after the batch (Humility)", T, "                        game.getAction().checkStaticAbilities();\n                        // (each one's entry", "                        // (each one's entry", BB, "layers: Humility applies to every batched token"],
  ["batched tokens not counted", T, "                    TOKENS_BATCHED.addAndGet(cellAmount - i);\n", "", BB, "layers: after the batch every token has the anthems, the lord and their keywords"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-tokenbatch-"));
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
