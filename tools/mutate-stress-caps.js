// Break-it for the stress caps (tests/test_bridge_stress_caps.js, tests/test_table_stress_caps.js; docs/stress-catalog.md
// top 10, the non-engine items): each mutation switches one piece off in a COPY of its file (bridge/bridge.mutant.js,
// loaded through BRIDGE_PATH; tmp/engine-renderer.mutant.lua, through RENDERER_LUA), runs that file's test and lists the
// checks that failed by name. The real files are never written: their sha256 is checked before and after each run, and
// the copies are removed. A mutation no check catches is printed as SURVIVED.
//   node tools/mutate-stress-caps.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
// file -> { copy: where its mutant goes, env: the variable that points the test at it, test }
const FILES = {
  "bridge/bridge.js": { copy: path.join(ROOT, "bridge", "bridge.mutant.js"), env: "BRIDGE_PATH", test: "tests/test_bridge_stress_caps.js" },
  "tools/engine-renderer.lua": { copy: path.join(ROOT, "tmp", "engine-renderer.mutant.lua"), env: "RENDERER_LUA", test: "tests/test_table_stress_caps.js" },
};
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua";
// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["number: the picker back at 20", B, "const NUMBER_PICK_MAX = 999;", "const NUMBER_PICK_MAX = 20;"],
  ["number: a clipped max not said", B, "        if (ui.mode === \"number\" && ui.max < input.max) {", "        if (false) {"],
  ["fewNames: never cut", B, "const fewNames = (list, n = FEW_NAMES) => (list.length > n ?", "const fewNames = (list, n = FEW_NAMES) => (false ?"],
  ["byCount: the mill's list uncut", B, "const byCount = (names) => fewNames(countedNames(names));",
    "const byCount = (names) => joinNames(countedNames(names));"],
  ["discard: the list uncut", B, "  discard: (w, names) => `${w} discards ${fewNames(names)}`,", "  discard: (w, names) => `${w} discards ${names.join(\", \")}`,"],
  ["exile from a graveyard: the list uncut", B, "  graveyard: (w, names, k) => `${fewNames(names)} ${names.length === 1", "  graveyard: (w, names, k) => `${names.join(\", \")} ${names.length === 1"],
  ["effects hover: every text listed", B, "${tips.slice(0, EFFECT_HOVER).join(\"\\n\")}", "${tips.join(\"\\n\")}"],
  ["compact: never compact", R, "  if a < 10000 then return tostring(v) end", "  if true then return tostring(v) end"],
  ["compact: no ∞ at the cap", R, "  if n >= ENGINE_HUGE then return engineInfText() elseif", "  if false then return engineInfText() elseif"],
  ["life: the font never smaller", R, "or math.floor(ENGINE_LIFE_FONT.font * ENGINE_LIFE_FONT.letters / letters)", "or ENGINE_LIFE_FONT.font"],
  ["life: the compact label not written", R, "    if tostring(main.label) ~= look.label then edit.label = look.label end", ""],
  ["life: the exact life not in the hover", R, "    want = \"Life: \" .. (math.abs(n) < 1e15", "    want = \"\" .. (math.abs(n) < 1e15"],
  ["life: the font not put back", R, "  if (tonumber(main.font_size) or font) ~= font then edit.font_size = font end", ""],
  ["badge: +1/+1 counters uncompact", R, "(plus > 0 and \"+\" or \"\") .. engineCompact(plus) .. \"/\" .. (plus > 0 and \"+\" or \"\") .. engineCompact(plus)", "(plus > 0 and \"+\" or \"\") .. plus .. \"/\" .. (plus > 0 and \"+\" or \"\") .. plus"],
  ["badge: power/toughness uncompact", R, "engineCompact(c.p) .. \"/\" .. engineCompact(t and (t - dmg) or c.t)", "tostring(c.p) .. \"/\" .. tostring(t and (t - dmg) or c.t)"],
  ["pool text: the symbols repeated past 6", R, "        if n > ENGINE_POOL_REP then parts", "        if false then parts"],
  ["pool chip: no 999+", R, "  local label = k .. (n > ENGINE_POOL_CHIP_MAX and", "  local label = k .. (false and"],
  ["pool chip: the font never smaller", R, "  return label, math.min(fit.font, math.floor(fit.w / (#label * 0.583)))", "  return label, fit.font"],
  ["stack: never folded", R, "    local under = math.max(0, total[who] - ENGINE_STACK_SHOW)", "    local under = 0"],
  ["stack: the kept ones not moved past the fold", R, "    else out.spot[i] = seenN[who] - under + (under > 0 and 1 or 0) end", "    else out.spot[i] = seenN[who] - under end"],
  ["stack: no +N more card", R, "  for who, more in pairs(stackFold.more) do", "  for who, more in pairs({}) do"],
  ["stack: the folded ones still drawn", R, "    if stackFold.folded[i] and not onTableSrc then", "    if false then"],
  ["stack: the status line uncut", R, "    s = s .. \"\\nStack (top first): \" .. engineFewNames(names)", "    s = s .. \"\\nStack (top first): \" .. table.concat(names, \", \")"],
  ["fan: auras 1.0 apart however many", R, "engineFanStep(hosts[c.att], ENGINE_FAN.attach)", "1.0"],
  ["fan: linked cards 0.35 apart however many", R, "          local step = engineFanStep(linkedOf[c.ew], ENGINE_FAN.linked)", "          local step = 0.35"],
  ["fan: the step never squeezed", R, "  if count <= fan.show then return fan.step end", "  if true then return fan.step end"],
  ["number row: - and + by 1 always", R, "    local step = engineNumberWide(p) and (st.step or 1) or 1", "    local step = 1"],
  ["number row: Max never turns to Min", R, "        { id = \"num:step\", text = \"Step \" .. engineNumberNextStep(step) }, v >= hi and", "        { id = \"num:step\", text = \"Step \" .. engineNumberNextStep(step) }, false and"],
  ["number row: no Step button", R, "{ id = \"num:step\", text = \"Step \" .. engineNumberNextStep(step) }, v >= hi", "{ id = \"num:min\", text = \"Min\" }, v >= hi"],
  ["number row: never wide", R, "((p.max or 0) - (p.min or 0)) > ENGINE_NUMBER_WIDE end", "((p.max or 0) - (p.min or 0)) > 99999 end"],
  ["boundary: Min shown only past the most", R, "engineNumberNextStep(step) }, v >= hi and", "engineNumberNextStep(step) }, v > hi and"],
  ["boundary: engineFewNames cuts at exactly 8", R, "  if #list <= n then return table.concat(list, \", \") end", "  if #list < n then return table.concat(list, \", \") end"],
  ["boundary: the chip says 999+ at 999", R, "(n > ENGINE_POOL_CHIP_MAX and", "(n >= ENGINE_POOL_CHIP_MAX and"],
  ["boundary: fewNames cuts at exactly 8", B, "(list.length > n ?", "(list.length >= n ?"],
  ["boundary: a max of exactly 999 said clipped", B, "ui.max < input.max) {", "ui.max <= input.max) {"],
  ["boundary: the stack folds at 8", R, "math.max(0, total[who] - ENGINE_STACK_SHOW)", "math.max(0, total[who] - ENGINE_STACK_SHOW + 1)"],
  ["compact: 10,000 left as is", R, "  if a < 10000 then return tostring(v) end", "  if a <= 10000 then return tostring(v) end"],
  ["compact: the decimal kept at .0", R, "(dec ~= 0 and (", "(dec >= 0 and ("],
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
