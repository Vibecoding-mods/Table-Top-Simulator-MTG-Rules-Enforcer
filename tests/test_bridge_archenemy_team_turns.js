// Archenemy's team turns on the four-seat table (CR 904.2 and 805; docs/handoff/archenemy-team-turns-report.md): a real
// engine game, tools/headless-six.js --archenemy --seats 4 (Blue, an AI seat, the archenemy against White, Red and
// Yellow, teamRules "teamTurns"), turns 1 to 9, replayed through the sandboxed bridge with the table's Archenemy start
// (tools/m6-stream.js --seats 4) and checked message by message against its recording. The six-seat game is
// tests/test_bridge_six_golden.js's. Checked: the start says the three take one turn together and asks the engine for
// teamTurns; the board's teams say the turns are shared; the turns go Blue, then the three together (White, their
// first seat after Blue, the active player, and the board's activeTeam all three), then Blue; on Blue's turns no
// activeTeam (the table says "BLUE'S TURN"); each of the three keeps their own life; a scheme only on Blue's turns.
//   node tests/test_bridge_archenemy_team_turns.js [--record]
const fs = require("fs");
const path = require("path");

const FIX = path.join(__dirname, "golden", "fixtures");
const RELAY = path.join(FIX, "four-seat-relay-archenemy.json");
const STREAM = path.join(FIX, "table-stream-4p-archenemy.json");
const FOUR = ["White", "Red", "Yellow", "Blue"];
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

(async () => {
  const { stream, unpack, archStart } = require("../tools/m6-stream");
  const T = require("../bridge/teams");
  same("start: the engine is asked for teamTurns in an Archenemy game", T.gameConfig(T.archTeams("Blue", FOUR), ["a", "b", "c", "d"], FOUR, "archenemy", null, false, null, { color: "Blue", names: [] }).teamRules, "teamTurns");
  let r;
  try { r = await stream(unpack(JSON.parse(fs.readFileSync(RELAY, "utf8"))), 99, archStart("Blue"), FOUR); } catch (e) { ok("start: the bridge starts the four-seat Archenemy game", false, String(e.message).slice(0, 300)); return done(); }
  ok("start: the bridge starts the four-seat Archenemy game", true);
  if (process.argv.includes("--record")) { fs.writeFileSync(STREAM, JSON.stringify(r.out)); process.stdout.write(`recorded ${r.out.length} messages to ${path.relative(process.cwd(), STREAM)}\n`); }
  same("bridge: no error logged", r.errors, []);
  ok("setup: Blue at double life against the three, who take one turn together", (r.startChats || []).some((c) => /^\[MTG\] Archenemy: Blue \(80 life, goes first, 20 chosen schemes\) vs White \+ Red \+ Yellow \(40 life each, one turn together\)\./.test(c)), (r.startChats || []).join(" | "));
  const tables = r.out.filter((m) => m.t === "table").map((m) => JSON.parse(m.json));
  const first = tables.find((t) => (t.players || []).length);
  same("board: the four players", first && first.players.map((p) => p.color), FOUR);
  const rows = Object.fromEntries((first?.players || []).map((p) => [p.color, p]));
  same("board: Blue the archenemy at 80, the three at 40", FOUR.map((c) => [c, rows[c]?.life, !!rows[c]?.arch]), FOUR.map((c) => [c, c === "Blue" ? 80 : 40, c === "Blue"]));
  const teams = tables.find((t) => t.teams)?.teams;
  same("board: the teams, the three against Blue, their turns shared", teams, { rule: "teams", mode: "archenemy", sides: [["White", "Red", "Yellow"], ["Blue"]], turns: "shared", archenemy: "Blue" });
  const turns = [];
  for (const t of tables) if (t.turn >= 1 && t.active && (!turns.length || turns.at(-1).turn !== t.turn)) turns.push({ turn: t.turn, active: t.active, team: t.activeTeam || null });
  // (the recording's turn 4 is an extra turn of Blue's, from a card; the turn after it is still the three's)
  same("turns: Blue first, then the three together, each turn in turn (an extra turn Blue's again)", turns.map((t) => `${t.turn}:${t.team ? t.team.join("+") : t.active}`),
    ["1:Blue", "2:White+Red+Yellow", "3:Blue", "4:Blue", "5:White+Red+Yellow", "6:Blue", "7:White+Red+Yellow", "8:Blue", "9:White+Red+Yellow"]);
  ok("turns: on the three's turns the active player is White, their first seat after Blue", turns.filter((t) => t.team).every((t) => t.active === "White"), JSON.stringify(turns));
  ok("turns: on Blue's turns no activeTeam on any board (the table says BLUE'S TURN)", tables.filter((t) => t.active === "Blue").every((t) => t.activeTeam == null), "a Blue board with an activeTeam");
  ok("turns: on the three's turns every board has all three", tables.filter((t) => t.turn >= 1 && t.active === "White").every((t) => JSON.stringify(t.activeTeam) === JSON.stringify(["White", "Red", "Yellow"])), "a team board without all three");
  const lives = tables.filter((t) => (t.players || []).length).map((t) => Object.fromEntries(t.players.map((p) => [p.color, p.life])));
  ok("life: each of the three keeps their own (not one shared total)", lives.some((l) => new Set([l.White, l.Red, l.Yellow]).size > 1), JSON.stringify(lives.at(-1)));
  // (each scheme set in motion, on the board where its schemeNow seq first appears)
  const inMotion = [];
  for (const t of tables) if (t.schemeNow?.seq >= 1 && !inMotion.some((x) => x.seq === t.schemeNow.seq)) inMotion.push({ seq: t.schemeNow.seq, turn: t.turn, active: t.active });
  ok("schemes: set in motion on Blue's turns only", inMotion.length >= 3 && inMotion.every((x) => x.active === "Blue"), JSON.stringify(inMotion));
  const want = JSON.parse(fs.readFileSync(STREAM, "utf8"));
  const diff = r.out.findIndex((m, i) => !want[i] || want[i].json !== m.json || want[i].t !== m.t);
  ok("golden: every message as recorded", diff < 0 && r.out.length === want.length, diff >= 0 ? `message ${diff} (${r.out[diff].t}) differs` : `${r.out.length} messages, ${want.length} recorded`);
  return done();
})().catch((e) => { process.stdout.write(`FAIL test_bridge_archenemy_team_turns: ${e.stack}\n`); process.exit(1); });

function done() {
  process.stdout.write(`${failed ? "FAIL" : "PASS"} test_bridge_archenemy_team_turns: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}
