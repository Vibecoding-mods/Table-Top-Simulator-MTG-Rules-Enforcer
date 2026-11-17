// Break-it for the ability sweep's follow-ups (tests/test_bridge_ability_sweep2.js; docs/ability-sweep-spec.md INV-1,
// INV-8, findings 5 and 8): each mutation switches one rule off in a COPY of bridge/bridge.js (bridge/bridge.mutant.js,
// loaded through BRIDGE_PATH), runs the test and needs the check it names among the ones that fail. The real file is never
// written: its sha256 is checked before and after each run, and the copy is removed.
//   node tools/mutate-ability-sweep2.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const FILES = { "bridge/bridge.js": { copy: path.join(ROOT, "bridge", "bridge.mutant.js"), env: "BRIDGE_PATH", test: "tests/test_bridge_ability_sweep2.js" } };
const B = "bridge/bridge.js";
// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["INV-1: the feed's damage entries ignored", B, "    const dealt = (damage.loss[p] || []).length ? damage.loss[p] : (l < before && fedLoss(p, new Set([...pain.map((t) => t.name), ...paid.map((x) => x.name)]))) || [];", "    const dealt = damage.loss[p] || [];", "INV-1 Galvanic Blast's metalcraft 4: the engine's damage entry names it"],
  ["INV-1: the feed added to the board's own reading", B, "    const dealt = (damage.loss[p] || []).length ? damage.loss[p] : (l < before && fedLoss(p, new Set([...pain.map((t) => t.name), ...paid.map((x) => x.name)]))) || [];", "    const dealt = [...(damage.loss[p] || []), ...((l < before && fedLoss(p, new Set([...pain.map((t) => t.name), ...paid.map((x) => x.name)]))) || [])];", "INV-1 the board's own reading wins over the feed (one line, not both)"],
  ["INV-1: combat entries said as plain damage", B, "${d.combat ? \"combat damage\" : \"damage\"} from ${fedName(d.src)}", "damage from ${fedName(d.src)}", "INV-1 a combat entry says combat damage"],
  ["INV-1: a source with no name named anyway", B, "    if (!list.length || list.some((d) => !d.src || !fedName(d.src))) return null;", "    if (!list.length) return null;", "INV-1 a source the bridge has never seen: bare"],
  ["INV-1: another player's entries counted", B, "    const list = (facts?.damage || []).filter((d) => d.slot === p);", "    const list = (facts?.damage || []).filter((d) => d.slot);", "INV-1 an entry at the other player isn't this one's"],
  ["INV-8: a spell's spell targets left out", B, "...(s?.tg || []).map((x) => `spell|${x}`), ", "", "INV-8 Counterspell at the AI's Lightning Bolt names the spell"],
  ["finding 5: the pile titles not read", B, "      const pileOf = PILE_TITLES[String(input.presentation?.title || \"\").trim()];", "      const pileOf = null;", "finding 5 (Divide cards into two piles): the title says the picks make pile 1"],
  ["finding 5: the library search kept for a split", B, "      if (!pileOf) {\n        // Cards that aren't in any zone", "      if (true) {\n        // Cards that aren't in any zone", "finding 5 (Divide cards into two piles): no library search (the cards are revealed ones)"],
  ["finding 5: who chooses not said", B, "${ctl === seat.slot ? \"An opponent chooses\" : `${nameOf(ctl)} chooses`} one pile next.", "An opponent chooses one pile next.", "finding 5 (Divide cards into two piles): the text says the rest is the other pile and who chooses"],
  ["finding 5: a face-down pile read as pile 1", B, "\"Select cards for a face down pile\": \"the face-down pile\"", "\"Select cards for a face down pile\": \"pile 1\"", "finding 5 (Select cards for a face down pile): the title says the picks make the face-down pile"],
];

const pattern = process.argv.slice(2).find((a) => !a.startsWith("--"));
const only = pattern ? new RegExp(pattern, "i") : null;
const pristine = Object.fromEntries(Object.keys(FILES).map((f) => [f, sha(path.join(ROOT, f))]));
const checkPristine = () => {
  for (const [f, h] of Object.entries(pristine)) if (sha(path.join(ROOT, f)) !== h) { console.log(`REAL FILE CHANGED: ${f}`); process.exit(100); }
};
const runTest = (spec, mutant) => {
  const env = { ...process.env };
  if (mutant) env[spec.env] = spec.copy; else delete env[spec.env];
  const r = spawnSync(process.execPath, [path.join(ROOT, spec.test)], { encoding: "utf8", timeout: 1200000, maxBuffer: 1 << 26, env });
  const failed = [];
  for (const line of String(r.stdout).split("\n")) if (/^FAIL /.test(line)) failed.push(line.slice(5, 100));
  if (r.status !== 0 && !failed.length) failed.push(`${spec.test} exit ${r.status} ${String(r.stderr).slice(0, 200)}`);
  return failed;
};
// (the tests must pass on the real files first, and on an unchanged copy: a copy that fails by itself proves nothing)
for (const f of new Set(MUTATIONS.filter(([l]) => !only || only.test(l)).map((m) => m[1]))) {
  const spec = FILES[f];
  const base = runTest(spec, false);
  if (base.length) { console.log(`BASELINE FAILS (${f}): ${base.join(" | ")}`); process.exit(1); }
  fs.mkdirSync(path.dirname(spec.copy), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), spec.copy);
  const same = runTest(spec, true);
  fs.rmSync(spec.copy, { force: true });
  if (same.length) { console.log(`UNCHANGED COPY FAILS (${f}): ${same.join(" | ")}`); process.exit(1); }
}
let survived = 0, caught = 0;
for (const [label, file, from, to, want] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  const spec = FILES[file], src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`NOT APPLIED (${n} matches) ${label}`); survived++; continue; }
  let failed;
  try { fs.writeFileSync(spec.copy, src.replace(from, () => to)); failed = runTest(spec, true); }
  finally { fs.rmSync(spec.copy, { force: true }); checkPristine(); }
  const named = failed.some((f) => f.startsWith(want.slice(0, 90)));
  if (named) { caught++; console.log(`caught   ${label}: ${want}${failed.length > 1 ? ` (+${failed.length - 1})` : ""}`); }
  else { survived++; console.log(`SURVIVED ${label}${failed.length ? ` (failed instead: ${failed.slice(0, 2).join(" | ")})` : ""}`); }
}
console.log(`${caught} caught, ${survived} survived; the real files unchanged (sha256), the copies removed`);
process.exit(survived ? 1 : 0);
