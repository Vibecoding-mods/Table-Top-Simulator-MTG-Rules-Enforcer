// Break-it for Treachery's Leader going first and best of three (tests/test_bridge_treachery_first.js,
// tests/test_bridge_match_bo3.js): each mutation switches one piece off (bridge/bridge.js, tools/engine-renderer.lua,
// tools/make-engine-copy.js), runs both tests, lists the checks that failed by name, then puts the file back and checks
// it by sha256. A mutation no check catches is printed as SURVIVED.
//   node tools/mutate-treachery-bo3.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_treachery_first.js", "tests/test_bridge_match_bo3.js"];
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua", C = "tools/make-engine-copy.js";

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["treachery: the Leader not read", B, "(treachery.leader || (t && TABLE_COLORS.includes(t.leader) ? t.leader : null))", "(treachery.leader || null)"],
  ["treachery: the Leader before the table's choice", B, "  return game?.tableFirst || game?.leader || matchFirst() || null;", "  return game?.leader || game?.tableFirst || matchFirst() || null;"],
  ["treachery: mtg treachery off ignored", B, "  game.leader = treachery.on ? (", "  game.leader = true ? ("],
  ["treachery: the host's Leader ignored", B, "  if (color) { Object.assign(treachery, { on: true, leader: color });", "  if (color) { Object.assign(treachery, { on: true });"],
  ["treachery: a team mode's goesFirst overruled", B, "    if (idx >= 0 && !cfg.players.some((p) => p.goesFirst)) cfg.firstPlayer = idx;", "    if (idx >= 0) cfg.firstPlayer = idx;"],
  ["treachery: no gameConfig without teams", B, "  return idx >= 0 ? { type: \"gameConfig\", firstPlayer: idx, players: [] } : null;", "  return null;"],
  ["treachery: the wrong seat", B, "  const idx = first ? (game.seatColors || []).indexOf(first) : -1;", "  const idx = first ? 0 : -1;"],
  ["treachery: no word when no Leader is found", B, "  else if (t && treachery.on) chat(\"[MTG] Treachery: no Leader identity card was found", "  else if (false) chat(\"[MTG] Treachery: no Leader identity card was found"],
  ["table: a hand not looked in", R, "    if Player[c] ~= nil and engineHoldsCard(Player[c], o) then return c end", "    if false then return c end"],
  ["table: the farthest mat", R, "  if bestD == nil or d < bestD then return c, d end", "  if bestD == nil or d > bestD then return c, d end"],
  ["table: any card named Leader", R, "  if name:find(\"Identity\", 1, true) == nil then return end", "  if false then return end"],
  ["table: any identity card is the Leader's", R, "  if found.leader == nil and name:find(\"Leader\", 1, true) ~= nil then found.leader", "  if found.leader == nil then found.leader"],
  ["table: no Treachery in the start", C, "  if engineTreacheryLeader ~= nil then start.treachery = engineTreacheryLeader() end\n", ""],
  ["table: mtg treachery not sent", C, "    engineSend(\"treachery\", { color = pl.color, text = rest })\n", ""],
  ["match: not Standard only", B, "  if (gameMode.mode !== \"standard\") return chat(\"[MTG] Best of three is for Standard 1v1", "  if (false) return chat(\"[MTG] Best of three is for Standard 1v1"],
  ["match: the winner chooses", B, "  const chooser = winner ? (winner === a ? b : a) : match.chooser", "  const chooser = winner ? winner : match.chooser"],
  ["match: play and draw swapped", B, "  match.first = play ? color : (color === a ? b : a);", "  match.first = play ? (color === a ? b : a) : color;"],
  ["match: an AI loser asked", B, "  if (!game.seats.has(chooser)) return matchChoice(chooser, true);\n", ""],
  ["match: three wins to take it", B, "const MATCH_WINS = 2, MATCH_GAMES = 5;", "const MATCH_WINS = 3, MATCH_GAMES = 5;"],
  ["match: after a draw the first seat chooses", B, " : match.chooser || (game.seats.has(a) ? a : b);", " : (game.seats.has(a) ? a : b);"],
  ["match: no end after five games", B, "  if (n >= MATCH_GAMES) {", "  if (false) {"],
  ["match: the choice not sent with the start", B, "function matchFirst() { return matchGame() && match.pair === matchPair() ? match.first : null; }", "function matchFirst() { return null; }"],
  ["match: no score in the status", B, "  const inMatch = game ? matchMarks(p) : [];", "  const inMatch = [];"],
  ["match: the game number one behind", B, "`GAME ${game.matchDone ? played : played + 1}`", "`GAME ${played}`"],
  ["match: a second answer counts", B, "  if (!game || match.asked !== color) return;", "  if (!game) return;"],
  ["match: another pair keeps the score", B, "  if (match.pair !== matchPair()) { matchReset(); match.pair = matchPair(); }", "  if (!match.pair) { matchReset(); match.pair = matchPair(); }"],
  ["match: any number of seats", B, "game.mode === \"standard\" && game.total === 2 &&", "game.mode === \"standard\" &&"],
  ["match: the question left open", B, "  if (match.asked === color) toTTS({ t: \"prompt\", color, promptId: null });\n", ""],
  ["match: the result not in the log", B, "  gameLogLine(`${winner ? `${matchName(winner)} wins game ${n}", "  void (`${winner ? `${matchName(winner)} wins game ${n}"],
  ["table: mtg match not sent", C, "    engineSend(\"match\", { color = pl.color, text = rest })\n", ""],
];

function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 900000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
      if (m && !/^test_/.test(m[1])) failed.push(m[1].split(": ").slice(0, 2).join(": ").slice(0, 100));
    }
    if (r.status !== 0 && !failed.length) failed.push(`${t} exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  }
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null; // (a label pattern: just those mutations)
const base = runTests();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let survived = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`?? ${label}: the code to break is not there once`); survived++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTests(); } finally { fs.writeFileSync(file, text); }
  const ok = sha(file) === before;
  if (!failed.length) survived++;
  console.log(`${failed.length ? "caught" : "SURVIVED"}: ${label}${failed.length ? ` -> ${[...new Set(failed)].slice(0, 2).join(" | ")}` : ""}${ok ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught, every file restored`);
process.exit(survived ? 1 : 0);
