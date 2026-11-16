// M6 step 8 (docs/m6-six-seat-spec.md §5): the table tells the bridge its seats, clockwise. ENGINE_TABLE_SEATS (a global,
// nil on the 4-player table; the 6-player table's profile sets its six) goes out as tableSeats with the load's hello,
// every later hello (tools/engine-renderer.lua engineHello) and each start (make-engine-copy.js engineStartGame). With
// none set nothing new is sent, so the bridge keeps its default four (bridge.js noteTableSeats, tests/test_bridge_claims.js).
//   node tests/test_table_seats.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
// what the table sent the bridge in that step, as its decoded messages
const sentOf = (r, mark) => fxOf(r, mark).filter((l) => /WebRequest\.custom/.test(l)).join(" ").split("\\").join("");
const SIX = '{ "White", "Red", "Yellow", "Green", "Blue", "Purple" }';
const SIX_JSON = '"tableSeats":["White","Red","Yellow","Green","Blue","Purple"]';

for (const six of [false, true]) {
  const label = six ? "six seats" : "4-player table";
  // (set before the Global script runs, as the 6-player table's profile would be; the load's hello goes out 30 frames
  // after onLoad, in the sim's own "load" record)
  const r = simulate({ save, seated: ["White", "Blue"], host: "White", prelude: six ? `ENGINE_TABLE_SEATS = ${SIX}` : "", steps: [
    q('engineHello(true) return "ok"', "again", 2),
    q('engineStartSentAt = nil engineChat("mtg start ai 1", Player.White) return "ok"', "start", 10),
  ] });
  ok(`${label}: no script errors`, !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const load = sentOf(r, "load"), again = sentOf(r, "again"), start = sentOf(r, "start");
  ok(`${label}: precondition, the load's hello went out`, /"t":"hello"/.test(load) && /"keepRewind":true/.test(load), load.slice(0, 300));
  ok(`${label}: precondition, the later hello says again`, /"t":"hello"/.test(again) && /"again":true/.test(again), again.slice(0, 300));
  ok(`${label}: precondition, the start went out`, /"t":"start"/.test(start), start.slice(0, 300));
  if (six) {
    ok("six seats: the load's hello carries them, clockwise", load.includes(SIX_JSON), load.slice(0, 400));
    ok("six seats: a later hello carries them", again.includes(SIX_JSON), again.slice(0, 400));
    ok("six seats: the start carries them, beside its seated players", start.includes(SIX_JSON) && /"seats":\["White","Blue"\]/.test(start), start.slice(0, 600));
  } else {
    ok("4-player table: no hello carries a seat list (the bridge's default four)", !/tableSeats/.test(load + again), (load + again).slice(0, 400));
    ok("4-player table: nor the start", !/tableSeats/.test(start), start.slice(0, 400));
  }
}

console.log(failed ? `\n${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
process.exit(failed ? 1 : 0);
