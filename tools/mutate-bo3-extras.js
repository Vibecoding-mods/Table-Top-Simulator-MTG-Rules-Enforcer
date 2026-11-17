// Break-it for best of three's extras (tests/test_bridge_bo3_extras.js, tests/test_table_bo3_extras_lua.js): each mutation
// switches one rule off in a COPY of its file (bridge/bridge.mutant.js through BRIDGE_PATH; tmp/engine-renderer.mutant.lua
// through RENDERER_LUA; tmp/make-engine-copy.mutant.js through ENGINE_COPY_JS), runs that file's test and needs the check
// it names among the ones that fail. The real files are never written: their sha256 is checked before and after each
// run, and the copies are removed.
//   node tools/mutate-bo3-extras.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const FILES = {
  "bridge/bridge.js": { copy: path.join(ROOT, "bridge", "bridge.mutant.js"), env: "BRIDGE_PATH", test: "tests/test_bridge_bo3_extras.js" },
  "tools/engine-renderer.lua": { copy: path.join(ROOT, "tmp", "engine-renderer.mutant.lua"), env: "RENDERER_LUA", test: "tests/test_table_bo3_extras_lua.js" },
  "tools/make-engine-copy.js": { copy: path.join(ROOT, "tmp", "make-engine-copy.mutant.js"), env: "ENGINE_COPY_JS", test: "tests/test_table_bo3_extras_lua.js" },
};
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua", C = "tools/make-engine-copy.js";
// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["roll: not rolled", B, "return game?.tableFirst || game?.leader || matchFirst() || matchRollFirst() || null;", "return game?.tableFirst || game?.leader || matchFirst() || null;", "roll: the roll's winner, Blue, chooses to play: Blue (seat 1) goes first"],
  ["roll: a tie not rolled again", B, "  do r = order.map(matchDie); while (r[0] === r[1]);", "  r = order.map(matchDie);", "roll: a tie is rolled again (9\u20139, then AI 1 18)"],
  ["roll: the loser goes first", B, "const winner = r[0] > r[1] ? order[0] : order[1];", "const winner = r[0] > r[1] ? order[1] : order[0];", "roll: the roll's winner, Blue, chooses to play: Blue (seat 1) goes first"],
  ["roll: rolled again each time asked", B, "  if (game.matchRoll) return game.matchRoll.first;\n", "", "roll: asked once a game (the start config again keeps it, rolls nothing more)"],
  ["roll: not on the board", B, "    ...(game.matchRoll ? { matchRoll: { seq: game.matchRoll.seq, text: game.matchRoll.text } } : {}),\n", "", "roll: on the table, the board's matchRoll"],
  ["phase bar: always of 3", B, "  return `GAME ${n} OF ${n > 3 ? MATCH_GAMES : 3}`;", "  return `GAME ${n} OF 3`;", "phase bar: after a draw, game 4 of 5"],
  ["phase bar: not on the board", B, "    ...(matchGameWords() ? { match: matchGameWords() } : {}),\n", "", "phase bar: game 1 of 3"],
  ["swap: not used in the next game", B, "  return { deckName: m.deckName, commanderName: m.commanderName, deck: { ...d.deck, cards: [...m.main], sideboard: [...m.side] } };", "  return d;", "swap: game 2's deck has the swap"],
  ["check: the main deck's 60 not checked", B, "    const bad = main.length < MAIN_MIN ?", "    const bad = false ?", "check: 3 out and 1 in (main 58) refused, said why"],
  ["check: the sideboard's 15 not checked", B, "      : side.length > SIDE_MAX ?", "      : false ?", "check: 2 out, 1 in (main 60, sideboard 16) refused"],
  ["sideboard: only the loser sideboards", B, "if (game.seats.has(c) && match.decks?.pair === matchPair() && match.decks.by[c]?.side.length) match.waiting.add(c);", "if (game.seats.has(c) && c === chooser && match.decks?.pair === matchPair() && match.decks.by[c]?.side.length) match.waiting.add(c);", "sideboard: the winner is asked too, with Reset to registered after a swap"],
  ["sideboard: a deck with none asked anyway", B, "if (game.seats.has(c) && match.decks?.pair === matchPair() && match.decks.by[c]?.side.length) match.waiting.add(c);", "if (game.seats.has(c) && match.decks?.pair === matchPair() && match.decks.by[c]) match.waiting.add(c);", "no sideboard: nothing to ask, nobody waited for"],
  ["sideboard: not asked after play or draw", B, "  if (wasAsked && match.waiting.has(color)) askSideboard(color);\n", "", "sideboard: then the sideboard question, for game 2"],
  ["sideboard: no Reset to registered", B, "...(changed ? [{ id: \"__sb_reset\", label: \"Reset to registered\" }] : [])", "...(false ? [{ id: \"__sb_reset\", label: \"Reset to registered\" }] : [])", "sideboard: the winner is asked too, with Reset to registered after a swap"],
  ["reset: the deck not put back", B, "      d.main = [...d.reg.main]; d.side = [...d.reg.side];\n", "", "reset: game 3's deck is the registered one"],
  ["wait: a start while sideboarding", B, "  if (sideboarding) { chat(", "  if (false) { chat(", "wait: a start while Blue sideboards is refused, says who"],
  ["concede: no confirmation", B, "    if (at && Date.now() - at < 15000) { delete match.concedeAsk[m.color]; return concedeMatch(m.color); }", "    { delete match.concedeAsk[m.color]; return concedeMatch(m.color); }", "concede: asks to confirm first"],
  ["concede: the game not conceded", B, "if (seat && gv && !gv.gameOver && isPlaying(gv, seat.slot)) seat.directive({ type: \"concede\" });", "if (false) seat.directive({ type: \"concede\" });", "concede: the game is conceded too"],
  ["concede: the match not ended", B, "  gameLogLine(line);\n  matchReset();\n}", "  gameLogLine(line);\n}", "concede: the next game is game 1 of a new match"],
  ["concede: the game's end afterwards counted", B, "  game.matchDone = true; // (the game's end that follows counts for nothing and asks nothing)\n", "", "concede: the game's end afterwards asks nothing"],
  ["concede between games: no Yes / No", B, "    if (pick === \"__concede\") return askConcede(color, () => askPlayDraw(color));", "    if (pick === \"__concede\") return concedeMatch(color);", "concede between games: a Yes / No first"],
  ["concede between games: No concedes too", B, "    if (pick === \"__concede_yes\") return concedeMatch(color);\n    return back();", "    return concedeMatch(color);", "concede between games: No goes back to the question"],
  ["phase bar: the tag not put on the bar", R, "  day = day .. engineMatchTag(t) -- (best of three: GAME 2 OF 3)\n", "", "phase bar: the tag is put on the bar"],
  ["phase bar: the tag's words", R, "  return \"      <b><color=#FFD27A>\" .. tostring(t.match) .. \"</color></b>\"", "  return \"      \" .. tostring(t.match)", "phase bar: the game number after the turn"],
  ["roll: shown on every board", R, "  if roll == nil or roll.seq == nil or roll.seq == engineMatchRollSeen then return end", "  if roll == nil or roll.seq == nil then return end", "roll: once (the next board with the same roll shows nothing)"],
  ["roll: shown on a jump board", R, "  if m.jump or roll.text == nil then return end", "  if roll.text == nil then return end", "roll: a jump board (a rewind, a reload) only records it"],
  ["roll: the banner never called", R, "  pcall(engineMatchRollBanner, m) -- (best of three: game 1's roll, the bridge's matchRoll)\n", "", "roll: called with the board"],
  ["chat: mtg match concede the host's only", C, "if not isHost and rest ~= \"\" and rest ~= \"concede\" then", "if not isHost and rest ~= \"\" then", "chat: anyone may type mtg match concede, the settings stay the host's"],
  ["chat: no help line", C, "; mtg match concede - give up the match", ";", "chat: the help line names mtg match concede"],
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
