// Break-it for the stress catalog's second batch (tests/test_bridge_stress_catalog2.js, tests/test_table_stress_catalog2_lua.js;
// the peer list of 2026-11-17, A to G): each mutation switches one piece off in a COPY of its file
// (bridge/bridge.mutant.js, loaded through BRIDGE_PATH; tmp/engine-renderer.mutant.lua, through RENDERER_LUA), runs
// that file's test, and needs the check it names among the ones that fail. The real files are never written: their
// sha256 is checked before and after each run, and the copies are removed. A mutation whose check doesn't fail is
// printed as SURVIVED.
//   node tools/mutate-stress-catalog2.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
// file -> { copy: where its mutant goes, env: the variable that points the test at it, test }
const FILES = {
  "bridge/bridge.js": { copy: path.join(ROOT, "bridge", "bridge.mutant.js"), env: "BRIDGE_PATH", test: "tests/test_bridge_stress_catalog2.js" },
  "tools/engine-renderer.lua": { copy: path.join(ROOT, "tmp", "engine-renderer.mutant.lua"), env: "RENDERER_LUA", test: "tests/test_table_stress_catalog2_lua.js" },
};
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua";
// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["A: no keep question", B, "  if (!ck || !ck.keep || !ck.many) return { ui, toOutput };", "  if (true) return { ui, toOutput };", "A copies: the first copy asks keep or choose each"],
  ["A: the next copies asked again", B, "  if (kt && copyKeep && keepFits(kt, copyKeep, gv)) {", "  if (false) {", "A copies: the next two copies are answered unseen"],
  ["A: targets that differ kept anyway", B, "  return ck.name === kt.name && ck.keep != null && ck.keep.join() === kt.keep.join() && gv.turn === kt.turn && gv.step === kt.step;", "  return ck.name === kt.name && gv.turn === kt.turn && gv.step === kt.step;", "A differ: a copy that can't keep the target is asked"],
  ["A: the storm trigger counted as a copy", B, " && x.identity?.name === name && !isAbilityOnStack(x, gv)).length;", " && x.identity?.name === name).length;", "A copies: the keep button counts the copies"],
  ["A: a storm copy named by the spell it targets", B, "const copiesTarget = newest && (!newestText || /\\bcopy target\\b/i.test(newestText));", "const copiesTarget = newest;", "A choose each: the copy is named by its own spell, not the spell it targets"],
  ["A: no chat line at the end", B, "  chat(`[MTG] You kept the targets of ${kt.done === 1", "  void (`[MTG] You kept the targets of ${kt.done === 1", "A copies: one chat line at the end"],
  ["A: a priority doesn't end it", B, "      if (seat.keepTargets) keepEnd(seat, \"you have priority\");\n", "", "A priority: the run ends at a priority"],
  ["A: Thousand-Year Storm's copies not seen", B, "/\\bcopy it for each\\b|\\bcopies of (?:it|that spell) for each\\b/i.test(", "/^$/.test(", "A Thousand-Year Storm: no count, all copies"],
  ["B: no All or None", B, "  if (min === 0 && max >= n) quick.push(", "  if (false) quick.push(", "B quick (any number): the quick buttons"],
  ["B: All and None for any question", B, "  if (min === 0 && max >= n) quick.push(", "  if (true) quick.push(", "B quick (1 or more): the quick buttons"],
  ["B: a quick button sent as itself", B, "    if (quick) picks.splice(0, 1, ...quick);", "", "B quick: All sends its picks"],
  ["B: no name buttons", B, "  if (n > QUICK_NAMES_AT) {", "  if (false) {", "B names: past 100 options, All of each name shared"],
  ["B: name buttons at 100 or fewer", B, "const QUICK_NAMES_AT = 100;", "const QUICK_NAMES_AT = 10;", "B names: 100 options or fewer get no name buttons"],
  ["B: a name run over the most allowed offered", B, "if (k >= 2 && k < n && k >= min && k <= max)", "if (k >= 2 && k < n && k >= min)", "B names: a run over the most allowed gets none"],
  ["B: blockers get All", B, "  if (type !== \"chooseBlockers\" && type !== \"chooseAttackers\") addQuickPicks(ui);", "  addQuickPicks(ui);", "B blockers: no All or None for the block pairs"],
  ["C: no quick buttons", B, "(n > SCRY_QUICK_AT ? zones.map(", "(false ? zones.map(", "C scry 8, all on the bottom: the first question offers them all at once"],
  ["C: quick buttons from 5 cards", B, "const SCRY_QUICK_AT = 5;", "const SCRY_QUICK_AT = 4;", "C scry 5: no quick buttons"],
  ["C: the two-zone All ignored", B, "(allIn ? allIn === moveZone : a.includes(c.id))", "a.includes(c.id)", "C scry 8, all on the bottom: sent at once"],
  ["C: the three-zone All taken as one card", B, "all ? Object.fromEntries(cards.map((x) => [x.id, all])) : { ...placed, [c.id]: a[0] }", "{ ...placed, [c.id]: a[0] }", "C three zones, all on the bottom: sent at once"],
  ["C: every card's question offers All", B, "...(Object.keys(placed).length ? [] : scryAllOptions(zones, cards.length))", "...scryAllOptions(zones, cards.length)", "C three zones: the second card's question has none"],
  ["E: the hover back at 8", B, "const EFFECT_HOVER = 20;", "const EFFECT_HOVER = 8;", "E effects: 22 past the marks list 20, then ... and 2 more"],
  ["F: the damage pick unclipped", B, "max: Math.min(left, DAMAGE_PICK_MAX), kind: \"number\",", "max: left, kind: \"number\",", "F damage: one pick at most 999,999"],
  ["F: the damage answer unclipped", B, "Math.min(left, DAMAGE_PICK_MAX, Number(v[0]) || 0)", "Math.min(left, Number(v[0]) || 0)", "F damage: a pick over it is clipped, the rest goes to the last one"],
  ["G: the largest not kept", B, "  ttsStats.largest = game.largest;\n", "", "G largest: this game's so far, the biggest board"],
  ["G: a library not counted", B, ": Number(z.count) || 0;\n    cards += n;", ": 0;\n    cards += n;", "G largest: this game's so far, the biggest board"],
  ["G: said every time", B, "  if (!game?.largest || game.largestSaved) return;", "  if (!game?.largest) return;", "G largest: said once in the log"],
  ["G: not kept in the games list", B, "  ttsStats.games = [...(ttsStats.games || []).slice(-(LARGEST_GAMES - 1)), {", "  void [...(ttsStats.games || []).slice(-(LARGEST_GAMES - 1)), {", "G largest: kept in the games list once the game ends"],
  ["D: every hand card laid out", R, "    elseif shown >= ENGINE_HAND_SHOW then folded = folded + 1", "    elseif false then folded = folded + 1", "D 60 cards: 40 laid out in the hand, one +20 more card"],
  ["D: 41 laid out", R, "    elseif shown >= ENGINE_HAND_SHOW then folded = folded + 1", "    elseif shown > ENGINE_HAND_SHOW then folded = folded + 1", "D 60 cards: the hand's first 40 by the engine's order"],
  ["D: no more card", R, "  if folded > 0 then\n    local id = \"hand:more:\" .. color", "  if false then\n    local id = \"hand:more:\" .. color", "D 60 cards: 40 laid out in the hand, one +20 more card"],
  ["D: the more card a hand card", R, "Vector(0, g.rotY, 0), seen, nil, { zone = \"handmore\", color = color })", "Vector(0, g.rotY, 0), seen, color, { zone = \"handmore\", color = color })", "D the more card is no hand card (it sits beside the library)"],
  ["D: a big draw all at once", R, "      if spawned > ENGINE_HAND_SPAWNS then waiting = true", "      if false then waiting = true", "D a big draw: 12 new hand cards spawned this frame, one redraw asked"],
  ["D: no redraw for the rest", R, "  if waiting and not engineHandRedrawDue then", "  if false then", "D a big draw: 12 new hand cards spawned this frame, one redraw asked"],
  ["D: the Engine panel not opened", R, "  engineBrowse[color] = nil\n  engineShown[color] = \"pin\"", "  engineBrowse[color] = nil\n  engineShown[color] = nil", "D the more card opens the Engine panel on its answers"],
  ["C: a quick button laid out as a card", R, "  return tostring(o.id):sub(1, 2) ~= \"__\"", "  return true", "C a quick button is no scry card"],
  ["C: the held cards unfiltered", R, "if engineScryCard(o) and not st.gone[o.id] then held[o.id] = true end", "if not st.gone[o.id] then held[o.id] = true end", "C the hand zone holds the cards, not the quick buttons"],
  ["F: no scan limit", R, "      if steps > ENGINE_NUMBER_SCAN then break end\n", "", "F past 100,000 numbers nothing more is looked at"],
  ["F: the typed number not first", R, "then list[1] = { index = typed, label = tostring(typed) } else typed = nil end", "then typed = nil else typed = nil end", "F a number typed in a huge range comes first"],
  ["F: a typed number out of range offered", R, "if typed ~= nil and typed >= lo and typed <= hi then list[1]", "if typed ~= nil and typed >= lo then list[1]", "F a number out of range isn't offered"],
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
