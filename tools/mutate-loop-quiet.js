// Break-it for "No responses for this loop" (tests/test_bridge_loop_quiet.js, tests/test_table_loop_quiet.js): each
// mutation switches one piece off in a COPY of its file (bridge/bridge.mutant.js, loaded through BRIDGE_PATH;
// tmp/engine-renderer.mutant.lua, through RENDERER_LUA), runs that file's test and lists the checks that failed by name.
// The real files are never written: their sha256 is checked before and after each run, and the copies are removed. A
// mutation no check catches is printed as SURVIVED.
//   node tools/mutate-loop-quiet.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
// file -> { copy: where its mutant goes, env: the variable that points the test at it, test }
const FILES = {
  "bridge/bridge.js": { copy: path.join(ROOT, "bridge", "bridge.mutant.js"), env: "BRIDGE_PATH", test: "tests/test_bridge_loop_quiet.js" },
  "tools/engine-renderer.lua": { copy: path.join(ROOT, "tmp", "engine-renderer.mutant.lua"), env: "RENDERER_LUA", test: "tests/test_table_loop_quiet.js" },
};
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua";
// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["passes: never passed unseen", B, "      if (!forP && loopQuietLive(seat)) {", "      if (false) {"],
  ["passes: a controlled player's passed too", B, "      if (!forP && loopQuietLive(seat)) {", "      if (loopQuietLive(seat)) {"],
  ["live: the step change ignored", B, "if (q.by.loop === q.lp && gv.turn === q.lp.turn && gv.step === q.lp.step) return q;", "if (q.by.loop === q.lp && gv.turn === q.lp.turn) return q;"],
  ["live: a loop gone kept", B, "if (q.by.loop === q.lp && gv.turn === q.lp.turn && gv.step === q.lp.step) return q;", "if (gv.turn === q.lp.turn && gv.step === q.lp.step) return q;"],
  ["for: offered with no loop", B, "  for (const s of game.seats.values()) if (s.loop) return s;\n  return null;", "  for (const s of game.seats.values()) if (s.loop) return s;\n  return [...game.seats.values()].find((s) => s !== seat) || null;"],
  ["label: not the loop's words", B, "const loopQuietLabel = (by) => `No responses for this loop (${nameOf(by.slot)} repeating ×${by.loop.total})`;", "const loopQuietLabel = (by) => `No responses`;"],
  ["priority: no button", B, "      const quietBy = forP ? null : loopQuietFor(seat);", "      const quietBy = null;"],
  ["priority: the button not after End turn", B, "        ui.options.splice(ui.options.findIndex((o) => o.id === \"__endturn\") + 1, 0, { id: \"__quiet\"", "        ui.options.push({ id: \"__quiet\""],
  ["priority: its press sends nothing", B, "(a[0] === \"__quiet\" ? (loopQuietOn(seat), { type: \"pass\" }) : base(a))", "(a[0] === \"__quiet\" ? (loopQuietOn(seat), null) : base(a))"],
  ["on: not said", B, "  chat(`[MTG] ${nameOf(seat.slot)}: no responses during ${nameOf(by.slot)}'s loop.`);", ""],
  ["on: no panel after", B, "  setImmediate(() => guarded(\"loop quiet panel\", () => loopQuietShow(seat)));", ""],
  ["off: Stop doesn't ask the next priority", B, "  seat.loopQuiet = null;\n  seat.stopChain = true;", "  seat.loopQuiet = null;"],
  ["off: Stop leaves it on", B, "  seat.loopQuiet = null;\n  seat.stopChain = true;", "  seat.stopChain = true;"],
  ["answer: the panel's buttons ignored", B, "      if (m.promptId === LOOP_QUIET_PROMPT) {", "      if (false) {"],
  ["answer: a stale press keeps the panel", B, "pick === \"__quietstop\" && loopQuietOff(seat))) loopQuietShow(seat);", "pick === \"__quietstop\" && loopQuietOff(seat))) {}"],
  ["mtg stop: leaves it on", B, "      if (loopQuietOff(seat)) { chat(", "      if (false) { chat("],
  ["end: the others not told", B, "if (s !== seat) loopQuietShow(s); // (its loopQuietLive", "if (false) loopQuietShow(s); // (its loopQuietLive"],
  ["show: never at the start", B, "  if (game) for (const s of game.seats.values()) if (s !== seat) loopQuietShow(s);\n}", "\n}"],
  ["show: sent again unchanged", B, "  if (key === (seat.quietShown ?? null)) return;", ""],
  ["show: over a question", B, "  if (seat.prompt || seat.loop) return;\n  const q = loopQuietLive(seat)", "  if (seat.loop) return;\n  const q = loopQuietLive(seat)"],
  ["close: the panel not back after a question", B, "  seat.quietShown = null;\n  loopQuietShow(seat);\n}", "}"],
  ["rewind: kept", B, "\"loop\", \"loopLog\", \"loopOffer\", \"loopQuiet\"];", "\"loop\", \"loopLog\", \"loopOffer\"];"],
  ["table: no third button", R, "or o.id == \"__loop\" or o.id == \"__quiet\") then group, groupTip", "or o.id == \"__loop\") then group, groupTip"],
  ["table: the third button's whole label", R, "      if p.options[group].id == \"__quiet\" then groupLabel = \"No responses\" end\n", ""],
  ["table: the big button's whole label", R, "    if p.options[1].id == \"__quiet\" then bigLabel = \"No responses\" end\n", ""],
  ["table: the Choices line not purple", R, "or o.id == \"__quiet\" then return ENGINE_GROUP_COLOR end", "or o.id == \"__never\" then return ENGINE_GROUP_COLOR end"],
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
for (const [label, file, from, to] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  const spec = FILES[file], src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`NOT APPLIED (${n} matches) ${label}`); survived++; continue; }
  let failed;
  try { fs.writeFileSync(spec.copy, src.replace(from, () => to)); failed = runTest(spec, true); }
  finally { fs.rmSync(spec.copy, { force: true }); checkPristine(); }
  if (failed.length) { caught++; console.log(`caught   ${label}: ${failed.slice(0, 3).join(" | ")}${failed.length > 3 ? ` (+${failed.length - 3})` : ""}`); }
  else { survived++; console.log(`SURVIVED ${label}`); }
}
console.log(`${caught} caught, ${survived} survived; the real files unchanged (sha256), the copies removed`);
process.exit(survived ? 1 : 0);
