// Golden master for the six-seat table's Global script (docs/m6-six-seat-spec.md step 14): the six-seat Workshop table
// built in engine mode (tools/make-engine-copy.js with its profile and the 4-player file as the tracker source, as
// tests/test_table_six.js builds it), the six-seat game the bridge sent (tests/golden/fixtures/table-stream-6p.json,
// pinned on the bridge side by tests/test_bridge_six_golden.js) replayed on the fake TTS with White seated as the
// host, and every step compared with tests/golden/table_golden_6p.json. Fails by step and action, as
// tests/test_table_golden.js does; a script error or a refused put fails whatever the recording says.
// The Workshop tables aren't in this repository: without them the test says SKIP. --record writes the golden from the
// table as it is (read the diff first, as for the four-seat golden).
//   node tests/test_table_golden_six.js [--record]      (MTG_WORKSHOP_DIR: where 2293586471.json and 2296042369.json are)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { simulate } = require("./lua/run-sim");

const ROOT = path.join(__dirname, "..");
const WS = process.env.MTG_WORKSHOP_DIR || path.join(process.env.USERPROFILE || process.env.HOME || "", "Documents", "My Games", "Tabletop Simulator", "Mods", "Workshop");
const FOUR = path.join(WS, "2296042369.json"), SIX = path.join(WS, "2293586471.json");
const GOLDEN = path.join(__dirname, "golden", "table_golden_6p.json");
const STREAM = path.join(__dirname, "golden", "fixtures", "table-stream-6p.json");
const RECORD = process.argv.includes("--record");

if (!fs.existsSync(FOUR) || !fs.existsSync(SIX)) {
  console.log(`SKIP: the Workshop tables aren't in ${WS} (subscribe to 2296042369 and 2293586471, or set MTG_WORKSHOP_DIR)`);
  process.exit(0);
}

function buildSix() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-six-golden-"));
  const out = path.join(tmp, "six.json");
  const profile = require(path.join(ROOT, "tools", "table-profile.js")).profilePath("2293586471");
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "make-engine-copy.js"), SIX, out, "--profile", profile, "--tracker-source", FOUR], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`the six-seat build failed: ${(r.stdout.split("\n").filter((l) => /^FAIL/.test(l)).join(" | ") || r.stderr).slice(0, 300)}`);
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

// The game as the table plays it: White's Start with five AI players, the bridge's messages, then the game's clear
const click = (lua) => ({ lua, mark: `click: ${lua}` });
function steps() {
  const s6 = JSON.parse(fs.readFileSync(STREAM, "utf8"));
  return [click("engineAutoPace.White = false"), click('engineChat("mtg start ai 5 builtin", Player.White)'),
    ...s6.map((m) => ({ msg: { t: m.t, json: m.json } })),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 90, mark: "clear (mtg reset)" }];
}

let save;
try { save = buildSix(); } catch (e) { console.log(`FAIL build: ${String(e.message).split("\n")[0]}`); process.exit(1); }
const got = { name: "6p", ...simulate({ save, seated: ["White"], host: "White", steps: steps() }) };
let failed = 0;
// a script error is never an expected output, and every put the table makes is let in (as tests/test_table_golden.js)
if (got.errors.length) { failed++; console.log(`FAIL 6p: the script raised errors ${JSON.stringify(got.errors.slice(0, 2))}`); }
const refused = got.steps.flatMap((s) => (s.fx || []).filter((l) => /"putObject refused/.test(l)).map((l) => `${s.step.slice(0, 60)}: ${l}`));
if (refused.length) { failed++; console.log(`FAIL 6p: a put the table made was refused: ${refused.slice(0, 2).join(" || ")}`); }
if (RECORD) {
  if (failed) { console.log("not recorded: fix the failures above first"); process.exit(1); }
  fs.writeFileSync(GOLDEN, JSON.stringify([{ name: got.name, errors: got.errors, steps: got.steps }], null, 1));
  console.log(`recorded ${got.steps.length} steps to ${path.relative(process.cwd(), GOLDEN)}`);
  process.exit(0);
}
if (!fs.existsSync(GOLDEN)) { console.log(`FAIL 6p: no recording yet (${path.relative(process.cwd(), GOLDEN)}): run with --record on a machine with the Workshop tables, after reading what it draws`); process.exit(1); }
const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"))[0];
for (let i = 0; i < Math.max(want.steps.length, got.steps.length); i++) {
  const a = want.steps[i], b = got.steps[i];
  if (JSON.stringify(a) === JSON.stringify(b)) continue;
  failed++;
  const fa = (a && a.fx) || [], fb = (b && b.fx) || [];
  let k = 0;
  while (k < Math.max(fa.length, fb.length) && fa[k] === fb[k]) k++;
  console.log(`FAIL 6p: step ${a ? a.step : "?"}, action #${k}\n    want ${String(fa[k] ?? JSON.stringify(a && a.value)).slice(0, 300)}\n    got  ${String(fb[k] ?? JSON.stringify(b && b.value)).slice(0, 300)}`);
  break; // later steps follow from this one
}
console.log(failed ? "\nthe six-seat game differs" : `the six-seat game matches (${got.steps.length} steps)`);
process.exit(failed ? 1 : 0);
