// The screen UI's size budget (M6, docs/m6-six-seat-spec.md §6.1): the table built from the sources, run on the fake TTS
// with 1 to 6 seats, engine mode on (a game started) and off. TTS sends the whole screen XML to every player, and with
// two players at about 64 KB the second player's buttons stopped working (2026-10-23), so the code warns above 60,000.
// Seats 5 and 6 (Green, Purple) borrow Blue's and Red's table data on the 4-player table: the panel builders use only
// the colour's name, so their bytes are the 6-player table's. Each shrink has its own check, named, so a change that
// undoes one fails by that name; tests/golden/ui-size.json holds the bytes per seat count (a ratchet: +200 fails).
//   node tests/test_ui_budget.js            (--write records ui-size.json from this run)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const LIMIT = 60000, GROW = 200;
const GOLDEN = path.join(__dirname, "golden", "ui-size.json");
const save = buildSave();
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
const prefix = [{ lua: "data.Green = data.Green or data.Blue data.Purple = data.Purple or data.Red" },
  { lua: 'engineChat("mtg start ai 1", Player.Blue)' }, ...s1.slice(0, 40).map((m) => ({ msg: { t: m.t, json: m.json } }))];
const ORDER = ["Blue", "White", "Red", "Yellow", "Green", "Purple"];
const q = (lua, mark) => ({ lua, mark });
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;

const sizes = {};
let six = null;
for (let n = 1; n <= 6; n++) {
  const steps = [...prefix, q('return tostring(engineXmlSize) .. " " .. tostring(ENGINE_MODE)', "on"), q("return UI.getXml()", "xml on")];
  if (n === 6) steps.push(
    // a click on a short id reaches its handler with the long id
    q('local real, got = onMtgToggle, "none" onMtgToggle = function(p, v, id) got = p.color .. " " .. id end E(Player.Purple, "-1", engineUiId("eng_toggle_Purple")) onMtgToggle = real return got', "click"),
    q('return engineUiId("eng_opt_Blue_1")', "code before"),
    q("setEngineMode(false)", "engine off", 10),
    q('return tostring(engineXmlSize) .. " " .. tostring(ENGINE_MODE)', "off"), q("return UI.getXml()", "xml off"),
    q('return engineUiId("eng_opt_Blue_1")', "code after"));
  const r = simulate({ save, seated: ORDER.slice(0, n), steps });
  ok(`${n} seats: the table runs without errors`, r.errors.length === 0, r.errors.slice(0, 2).join(" | "));
  const [bytes, mode] = String(valueOf(r, "on")).split(" ");
  ok(`${n} seats: engine mode is on for the measure`, mode === "true", valueOf(r, "on"));
  const len = Buffer.byteLength(String(valueOf(r, "xml on") || ""), "utf8"); // (UTF-8 bytes, as Lua counts them)
  ok(`${n} seats: the size is the XML's`, Number(bytes) === len, `${bytes} vs ${len}`);
  sizes[n] = Number(bytes);
  if (n === 6) six = r;
}
console.log(`screen UI bytes, engine on: ${Object.entries(sizes).map(([n, b]) => `${n}: ${b}`).join(", ")}`);

const xml = String(valueOf(six, "xml on") || "");
const ours = xml.slice(xml.indexOf("</Defaults>"));
const offBytes = Number(String(valueOf(six, "off")).split(" ")[0]);
const off = String(valueOf(six, "xml off") || "");
console.log(`six seats, engine off (between games): ${offBytes}`);

ok("budget: six seats under 60 KB with engine mode on", sizes[6] < LIMIT, `${sizes[6]} bytes`);
ok("budget: six seats under 60 KB with engine mode off", offBytes > 0 && offBytes < LIMIT, `${offBytes} bytes`);
// one check per shrink (2026-11-16, docs/m6-ui-size.md §8)
ok("short ids: no eng_ id left in the screen XML", !/ id="eng_/.test(xml), (xml.match(/ id="eng_[^"]*"/g) || []).slice(0, 3).join(" "));
ok("one handler: every eng_ event calls E", !/ on[A-Z]\w*="onMtg/.test(xml), (xml.match(/ on[A-Z]\w*="onMtg\w*"/g) || []).slice(0, 3).join(" "));
ok("one handler: E hands the handler the long id", valueOf(six, "click") === "Purple eng_toggle_Purple", valueOf(six, "click"));
ok("short ids: a code stays its element's after a rebuild", valueOf(six, "code before") === valueOf(six, "code after") && /^[a-z][0-9a-z]*$/.test(String(valueOf(six, "code before"))), `${valueOf(six, "code before")} / ${valueOf(six, "code after")}`);
ok("short classes: no m<number> class left (a code can be m1, never m10 at this size)", !/ class="m\d\d+"/.test(xml), (xml.match(/ class="m\d\d+"/g) || []).slice(0, 3).join(" "));
ok("self-closing: no empty element pair in our part", !/<(\w+)((?:\s+[\w_]+="[^"]*")*)\s*><\/\1>/.test(ours), (ours.match(/<(\w+)((?:\s+[\w_]+="[^"]*")*)\s*><\/\1>/) || [""])[0].slice(0, 120));
// (engineXmlJoin's own line breaks between the table's XML, the classes and ours: at most two)
ok("line breaks: none between our elements", (xml.match(/\n/g) || []).length <= 2, `${(xml.match(/\n/g) || []).length} line breaks`);
ok("table panels: Reveal-until-type and Cascade out in engine mode", !xml.includes('id="SearchTypePanel"') && !xml.includes('id="GetValuePanel"'), "still there");
ok("table panels: back with engine mode off", off.includes('id="SearchTypePanel"') && off.includes('id="GetValuePanel"'), "missing");
ok("table panels: the rest of the table's UI kept", xml.includes('class="MenuBar"') && off.includes('class="MenuBar"') && xml.split("<Defaults>").length === 2, "lost or doubled");

if (process.argv.includes("--write")) {
  fs.writeFileSync(GOLDEN, JSON.stringify({ note: "screen UI bytes by seats, engine mode on (tests/test_ui_budget.js)", engineOn: sizes, sixEngineOff: offBytes }, null, 1) + "\n");
  console.log(`recorded ${path.relative(process.cwd(), GOLDEN)}`);
} else {
  const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  for (const n of Object.keys(want.engineOn)) ok(`ratchet: ${n} seats no bigger than recorded (+${GROW})`, sizes[n] <= want.engineOn[n] + GROW, `${sizes[n]} vs ${want.engineOn[n]}`);
  ok(`ratchet: six seats, engine off, no bigger than recorded (+${GROW})`, offBytes <= want.sixEngineOff + GROW, `${offBytes} vs ${want.sixEngineOff}`);
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
