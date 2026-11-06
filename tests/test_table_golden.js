// Golden-master test for the table's Global script: rebuilds it from the current sources, replays the recorded
// games on the fake TTS and compares every step with tests/golden/table_golden.json. Fails by game and step.
//   node tests/test_table_golden.js          (TABLE_SAVE=<save.json> tests a given save instead of a fresh build)
const fs = require("fs");
const path = require("path");
const { runAll, buildSave } = require("./golden/table-run");

const want = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "table_golden.json"), "utf8"));
let save;
try { save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave(); }
catch (e) { console.log(`FAIL build: ${String(e.message).split("\n")[0]}`); process.exit(1); }
const got = runAll(save);
let failed = 0;
for (const w of want) {
  const g = got.find((x) => x.name === w.name);
  if (!g) { failed++; console.log(`FAIL ${w.name}: game missing`); continue; }
  // a script error is never an expected output: the Auto-resolve click's error was recorded as one (2026-10-23)
  if (g.errors.length) { failed++; console.log(`FAIL ${w.name}: the script raised errors ${JSON.stringify(g.errors.slice(0, 2))}`); continue; }
  if (JSON.stringify(w.errors) !== JSON.stringify(g.errors)) { failed++; console.log(`FAIL ${w.name}: script errors ${JSON.stringify(g.errors.slice(0, 2))} (recorded: ${w.errors.length})`); continue; }
  for (let i = 0; i < Math.max(w.steps.length, g.steps.length); i++) {
    const a = w.steps[i], b = g.steps[i];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    failed++;
    const fa = (a && a.fx) || [], fb = (b && b.fx) || [];
    let k = 0;
    while (k < Math.max(fa.length, fb.length) && fa[k] === fb[k]) k++;
    console.log(`FAIL ${w.name}: step ${a ? a.step : "?"}, action #${k}\n    want ${String(fa[k] ?? JSON.stringify(a && a.value)).slice(0, 300)}\n    got  ${String(fb[k] ?? JSON.stringify(b && b.value)).slice(0, 300)}`);
    break; // later steps follow from this one
  }
}
// (breakit 2026-11-06) every put the table makes is let in: the fake TTS asks tryObjectEnterContainer and refuses a
// locked deck as TTS does. Only the fix-from-hand step that plays a PLAYER's drop onto a pile expects a refusal.
for (const g of got) {
  const refused = g.steps.filter((s) => !s.step.includes('onObjectDrop("Blue", o)'))
    .flatMap((s) => (s.fx || []).filter((l) => /"putObject refused/.test(l)).map((l) => `${s.step.slice(0, 60)}: ${l}`));
  if (refused.length) { failed++; console.log(`FAIL ${g.name}: a put the table made was refused: ${refused.slice(0, 2).join(" || ")}`); }
}
console.log(failed ? `\n${failed} of ${want.length} games differ` : `all ${want.length} games match (${want.reduce((n, g) => n + g.steps.length, 0)} steps)`);
process.exit(failed ? 1 : 0);
