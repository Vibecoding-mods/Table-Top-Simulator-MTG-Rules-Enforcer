// The six-seat game through the bridge (docs/m6-six-seat-spec.md steps 14-15): a headless six-seat game on the harness
// (tools/headless-six.js: White plus five Forge AI players, turn 1 to 15) replayed through a sandboxed bridge as the
// six-seat table's game (tools/m6-stream.js), and what the bridge sends the table compared, message by message, with
// the recording tests/golden/fixtures/table-stream-6p.json. Input: tests/golden/fixtures/six-seat-relay.json, the
// relay's states and White's questions in that game, packed (a first state, then each state as its changes).
// Also the six-seat facts the stream must keep: the seat order and colours, every player at a six-seat colour, every
// card's controller coloured, commander damage by colour, the turn order going round the six, AI names; and
// engine-test.js's seat colours for six seats. A failure says the message's index and type, or the check's name.
//   node tests/test_bridge_six_golden.js            (--record writes the stream fixture from the bridge as it is)
const fs = require("fs");
const path = require("path");

const FIX = path.join(__dirname, "golden", "fixtures");
const RELAY = path.join(FIX, "six-seat-relay.json");
const STREAM = path.join(FIX, "table-stream-6p.json");
const SIX = ["White", "Red", "Yellow", "Green", "Blue", "Purple"];
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

(async () => {
  // ── engine-test.js on six seats: its end report named the fourth seat Blue and the last two "seat4" / "seat5" ──
  const teams = require("../bridge/teams");
  same("engine-test colours: six seats are the six-seat table's, clockwise", typeof teams.seatColorsFor === "function" ? teams.seatColorsFor(6) : null, SIX);
  same("engine-test colours: five seats, the first five of six", typeof teams.seatColorsFor === "function" ? teams.seatColorsFor(5) : null, SIX.slice(0, 5));
  same("engine-test colours: four seats or fewer, the four-seat table's", typeof teams.seatColorsFor === "function" ? [2, 3, 4].map((n) => teams.seatColorsFor(n)) : null,
    [["White", "Red", "Yellow", "Blue"], ["White", "Red", "Yellow", "Blue"], ["White", "Red", "Yellow", "Blue"]]);
  const et = fs.readFileSync(path.join(__dirname, "..", "bridge", "engine-test.js"), "utf8");
  ok("engine-test colours: engine-test.js takes them by seat count", /const SEAT_COLORS = teams\.seatColorsFor\(SEATS\);/.test(et), "SEAT_COLORS is not teams.seatColorsFor(SEATS)");

  // ── the recorded game through the bridge ──
  if (!fs.existsSync(RELAY)) { ok("fixture: six-seat-relay.json exists", false, RELAY); return done(); }
  const { stream, unpack } = require("../tools/m6-stream");
  const rec = unpack(JSON.parse(fs.readFileSync(RELAY, "utf8")));
  let r;
  try { r = await stream(rec, 99); } catch (e) { ok("start: the bridge starts the six-seat game", false, String(e.message).slice(0, 300)); return done(); }
  ok("start: the bridge starts the six-seat game", true);
  if (process.argv.includes("--record")) { fs.writeFileSync(STREAM, JSON.stringify(r.out)); process.stdout.write(`recorded ${r.out.length} messages to ${path.relative(process.cwd(), STREAM)}\n`); }
  same("start: the seat order is White then the five AI players", r.order.map((u) => (u.startsWith("tts-") ? u.split("-")[1] : "AI")), ["White", "AI", "AI", "AI", "AI", "AI"]);
  same("start: the six seats' colours, clockwise", Object.values(r.colors), SIX);
  same("start: the AI players' names", Object.values(r.names), ["White", "AI 1", "AI 2", "AI 3", "AI 4", "AI 5"]);
  same("bridge: no error logged", r.errors, []);
  const tables = r.out.filter((m) => m.t === "table").map((m) => JSON.parse(m.json));
  ok("stream: the bridge drew the game (table messages)", tables.length > 20, `${tables.length} table messages`);
  const bad = new Set();
  let cards = 0;
  for (const t of tables) {
    for (const p of t.players || []) {
      if (!SIX.includes(p.color)) bad.add(`player colour ${p.color}`);
      for (const k of Object.keys(p.cmdDamage || {})) if (!SIX.includes(k)) bad.add(`commander damage from ${k}`);
      for (const c of p.battlefield || []) { cards++; if (!SIX.includes(c.ctl)) bad.add(`a card's controller ${c.ctl}`); }
    }
    if (t.active != null && !SIX.includes(t.active)) bad.add(`active ${t.active}`);
  }
  same("stream: every player, controller, attacker and active seat is a six-seat colour", [...bad], []);
  ok("stream: cards on the battlefields were checked", cards > 50, `${cards} cards`);
  const first = tables.find((t) => (t.players || []).length);
  same("stream: the first board has the six players", first && first.players.map((p) => p.color), SIX);
  // the turn order the table was told: each new turn's active seat the next of the six (nobody lost before turn 15)
  const turns = [];
  for (const t of tables) if (t.turn >= 1 && t.active && (!turns.length || turns.at(-1).turn !== t.turn)) turns.push({ turn: t.turn, active: t.active });
  const wrong = turns.slice(1).filter((t, i) => t.turn === turns[i].turn + 1 && t.active !== SIX[(SIX.indexOf(turns[i].active) + 1) % 6]);
  same("stream: the turns go round the six seats in order", wrong, []);
  ok("stream: turns 1 to 15 were drawn", turns.length >= 15 && turns.at(-1).turn >= 15, JSON.stringify(turns.map((t) => t.turn)));
  const log = r.out.filter((m) => m.t === "gamelog").flatMap((m) => JSON.parse(m.json).lines || []);
  ok("stream: the log names the AI seats as AI 1 to AI 5", [1, 2, 3, 4, 5].every((n) => log.some((l) => l.includes(`AI ${n}`))), log.slice(0, 3).join(" | "));

  // ── the golden: the stream as recorded, message by message ──
  if (!fs.existsSync(STREAM)) { ok("golden: table-stream-6p.json exists", false, STREAM); return done(); }
  const want = JSON.parse(fs.readFileSync(STREAM, "utf8"));
  let diff = -1;
  for (let i = 0; i < Math.max(want.length, r.out.length); i++) {
    const a = want[i], b = r.out[i];
    if (!a || !b || a.t !== b.t || a.json !== b.json) { diff = i; break; }
  }
  if (diff >= 0) {
    const a = want[diff], b = r.out[diff];
    const at = (x, y) => { let k = 0; while (k < Math.min(x.length, y.length) && x[k] === y[k]) k++; return k; };
    const k = a && b ? at(a.json, b.json) : 0;
    ok(`golden: message ${diff} (${(a || b).t}) as recorded`, false, `\n    want ${a ? a.json.slice(Math.max(0, k - 80), k + 160) : "(none)"}\n    got  ${b ? b.json.slice(Math.max(0, k - 80), k + 160) : "(none)"}`);
  } else ok("golden: every message as recorded", true);
  same("golden: as many messages as recorded", r.out.length, want.length);
  done();
})().catch((e) => { process.stdout.write(`FAIL test_bridge_six_golden: ${e.stack}\n`); process.exit(1); });

function done() {
  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} six-seat checks pass\n`);
  process.exit(failed ? 1 : 0);
}
