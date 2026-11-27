// Break-it proofs for Standard mode (docs/game-modes-spec.md §3.5): each rule of the mode broken on purpose, one at a
// time, in a COPY (the bridge's in bridge/bridge.mutant.js, the table's in a built save under tmp/table-build), and
// the test that guards it must fail BY NAME: tests/test_bridge_standard.js for the bridge, tests/test_table_standard.js
// for the table. The sources are never edited; each mutant is written fresh from the pristine text, and both are
// checked by sha256 after the run.
//   node tools/mutate-standard.js            (MUT_ONLY=<regex>: only the mutations whose name matches)
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { buildSave } = require("../tests/golden/table-run");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "bridge", "bridge.js");
const MUTANT = path.join(ROOT, "bridge", "bridge.mutant.js"); // (next to the real one: its data paths resolve the same)
const SAVE_FILE = path.join(ROOT, "tmp", "table-build", "mutant-standard.json");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const pristine = fs.readFileSync(SRC, "utf8");
const PRISTINE_SHA = sha(pristine);
const save = buildSave();
const pristineLua = save.LuaScript;
const LUA_SHA = sha(pristineLua);

// [name, from, to, the test (by name) that must fail]
const BRIDGE = [
  ["60-card minimum off by one", "if (cards.length < 60)", "if (cards.length < 59)", "check: 59 cards is not a Standard deck"],
  ["sideboard limit 16", "if (sideboard.length > 15)", "if (sideboard.length > 16)", "ai seat: a Standard list with 16 sideboard cards is refused"],
  ["copies counted in the main deck only", "for (const n of [...cards, ...sideboard]) counts[n]", "for (const n of cards) counts[n]", "ai seat: 4 in the deck + 1 in the sideboard is 5 copies"],
  ["5 copies allowed", "const lim = f.limits[n] ?? 4;", "const lim = f.limits[n] ?? 5;", "check: 5 copies of a card are refused"],
  ["basic lands limited to 4","if (basic(n) || lim === \"any\") return null;","if (lim === \"any\") return null;","check: any number of basic lands"],
  ["\"any number\" cards limited to 4","const lim = f.limits[n] ?? 4;","const lim = f.limits[n] === \"any\" ? 4 : f.limits[n] ?? 4;","check: a card that says any number may have more than 4"],
  ["a card's own number counted with the sideboard","return (own ? inMain[n] || 0 : k) > lim","return k > lim","check: a card's own number (DeckLimit) counts the main deck only"],
  ["banned cards not checked", "const banned = names.filter((n) => f.banned.has(n));", "const banned = [];", "check: a banned card is refused, said as banned"],
  ["sets not checked", "const outside = names.filter((n) => !f.banned.has(n) && !f.legal.has(n));", "const outside = [];", "check: a card from a set not in Standard's list is refused, by name"],
  ["a commander allowed", "if (commanders.length) problems.push(`Standard has no commander", "if (false) problems.push(`Standard has no commander", "check: a card on the command zone (a commander line) is refused in Standard"],
  ["format data missing passes", "if (!f) return [\"the bridge has no Standard card list", "if (!f) return []; if (false) return [\"the bridge has no Standard card list", "check: without forge-formats.json nothing is ready for Standard"],
  ["names not the engine's", "cards = cards.map(canon), commanders = commanders.map(canon), sideboard = sideboard.map(canon);", "", "mode: mtg aideck lists the legal Standard decks in Standard, and only those"],
  ["rotated Standard presets offered", "  if (mode !== \"standard\") return ids;\n  return ids.filter", "  return ids;\n  return ids.filter", "ai seat: an old Standard preset that has rotated out is refused"],
  ["StartGame always Commander", "format: MODES[game.mode || \"commander\"].format", "format: \"Commander\"", "start 1v1: StartGame asks for Standard (the relay's 20 life; Forge's Constructed)"],
  ["no mode means the last mode", ": modeOf(m?.mode) || \"commander\";", ": modeOf(m?.mode) || gameMode.mode;", "mode: hello without a mode is Commander (a reloaded table)"],
  ["the table not told the mode", "const modeField = () => (game?.mode === \"standard\" ? { mode: \"standard\" } : {});", "const modeField = () => ({});", "start 1v1: the table is told it is a Standard game"],
  ["Standard deck sent without its sideboard","sideboard: (r.sideboard || []).map(card), format: \"standard\"","sideboard: [], format: \"standard\"","ai seat: a legal Standard list is taken with its sideboard and no commander"],
  ["Standard deck sent as Commander","sideboard: (r.sideboard || []).map(card), format: \"standard\", commanders: [] }","sideboard: (r.sideboard || []).map(card), format: \"commander\", commanders: [] }","start 1v1: Blue's deck goes as a Standard deck, no commander"],
  ["Commander decks for the AI in Standard", "const defaultDecksOf = (mode) => (mode === \"standard\" ? STANDARD_DECKS : DEFAULT_DECKS);", "const defaultDecksOf = (mode) => DEFAULT_DECKS;", "start 1v1: the Forge AI plays the next built-in Standard deck, with its sideboard"],
  ["a Commander-checked deck ready for Standard", "const readyFor = (c, rules = \"commander\") => !!readyDecks[c] && (readyDecks[c].rules || readyDecks[c].mode || \"commander\") === rules;", "const readyFor = (c, rules = \"commander\") => !!readyDecks[c];", "start: a deck checked for Commander must be readied again for Standard"],
  ["free-for-all said as 1v1", "players > 2 ? `Standard, free-for-all (${players})`", "players > 2 ? \"Standard, 1v1\"", "start 4 players: said as Standard, free-for-all (4)"],
  ["mtg aideck's Commander decks kept in Standard", ".filter((d) => (d.deck.format || \"commander\") === MODES[mode].deck);", ";", "start with Commander AI choices in Standard: built-in Standard decks instead"],
  ["mtg deck's Standard choice kept in Commander", "presetsFor(mode).includes(deckChoice[c])", "(!std || presetsFor(\"standard\").includes(deckChoice[c]))", "start in Commander: a Standard deck chosen with mtg deck gives way to a Commander one"],
  ["the resume file loses the mode","      ...modeField(), // (a Standard game stays one","      // (a Standard game stays one","resume: a Standard game's save says Standard"],
];
const TABLE = [
  ["anyone sets the mode", "elseif not isHost then pl.broadcast(\"[MTG] Only the host can change the game mode", "elseif false then pl.broadcast(\"[MTG] Only the host can change the game mode", "mtg mode: only the host changes it"],
  ["Standard never sent with decks", "local msg = { seats = seats, request = mine, mode = engineModeSent() }", "local msg = { seats = seats, request = mine }", "Standard: the deck check says Standard"],
  ["Standard never sent with a start", "friendly = engineFriendly, mode = engineModeSent(), teams = ", "friendly = engineFriendly, teams = ", "Standard: the start says Standard"],
  ["a mode change mid-game drops the game's READYs", "if not running then for k in pairs(engineReadyState) do engineReadyState[k] = nil end end", "for k in pairs(engineReadyState) do engineReadyState[k] = nil end", "mode changed in a game: for the next one, the game's READYs kept"],
  ["the format message not sent", "engineSend(\"format\", { color = pl and pl.color or nil, format = f.key, mode = f.mode, banned = r.banned, restricted = r.restricted })", "", "mtg mode standard: sent to the bridge"],
  ["trackers left on the table","o.setPosition(p + Vector(0, -15, 0))\n          o.setInvisibleTo(engineEveryone())","o.setInvisibleTo(engineEveryone())","Standard: every commander damage tracker under the table, hidden, locked, its spot on it"],
  ["trackers not put back", "if x ~= nil and y ~= nil and z ~= nil then o.setPosition(Vector(x, y, z)) o.setLock(parts[4] == \"true\") end", "", "Commander again: the trackers back where they were, shown, with their own lock"],
  ["tax labels not blanked", "local label = std and \"\" or tostring(o.getVar(\"val\") or 0)", "local label = tostring(o.getVar(\"val\") or 0)", "Standard: the tax labels blank"],
  ["tax labels rewritten on load", "if not std and was ~= true then return end", "", "load: the tax labels left alone (no change of mode)"],
  ["life stays 40", "engineModeLife(mode == \"standard\" and 20 or 40)", "engineModeLife(40)", "Standard: the life counters at 20"],
  ["the game's mode ignored", "engineRunningMode = m.mode or \"commander\"", "engineRunningMode = \"commander\"", "a Standard game running: the game's mode decides"],
  // (not here: engineClear's engineRunningMode = nil. engineModeNow already reads the next games' mode once there is no
  // table, so leaving it set changes nothing a test can see: an equivalent mutant)
  ["the button always says Casual Commander", "function engineFormatLabel() return \"Format\\n\" .. engineFormatNow().name end", "function engineFormatLabel() return \"Format\\nCasual Commander\" end", "mode button: says Standard"],
];

const only = process.env.MUT_ONLY ? new RegExp(process.env.MUT_ONLY) : null;
const results = [];
const runOne = (kind, name, from, to, want, text, write, test, env) => {
  const n = text.split(from).length - 1;
  if (n !== 1) { results.push({ kind, name, result: `NOT APPLIED (found ${n}x)` }); console.log(`NOT APPLIED (found ${n}x)  ${kind}: ${name}`); return; }
  write(text.replace(from, () => to));
  let fails = [];
  try { execFileSync(process.execPath, [path.join(ROOT, "tests", test)], { env: { ...process.env, ...env }, stdio: "pipe" }); }
  catch (e) { fails = String(e.stdout).split("\n").filter((l) => l.startsWith("FAIL ")); if (!fails.length) fails = [`(crashed) ${String(e.stderr).split("\n").find((l) => l.trim()) || ""}`]; }
  const byName = fails.some((l) => l.startsWith(`FAIL ${want}`));
  const result = byName ? "caught by name" : fails.length ? "caught, not by name" : "ESCAPED";
  results.push({ kind, name, result, want, fails: fails.map((l) => l.slice(0, 160)) });
  console.log(`${byName ? "caught " : fails.length ? "OTHER  " : "ESCAPED"}  ${kind}: ${name}${byName ? "" : `   want "${want}"${fails.length ? `, got ${fails[0].slice(0, 120)}` : ""}`}`);
};
try {
  for (const [name, from, to, want] of BRIDGE.filter(([n]) => !only || only.test(n)))
    runOne("bridge", name, from, to, want, pristine, (t) => fs.writeFileSync(MUTANT, t), "test_bridge_standard.js", { BRIDGE_PATH: MUTANT });
  for (const [name, from, to, want] of TABLE.filter(([n]) => !only || only.test(n)))
    runOne("table", name, from, to, want, pristineLua, (t) => fs.writeFileSync(SAVE_FILE, JSON.stringify({ ...save, LuaScript: t })), "test_table_standard.js", { TABLE_SAVE: SAVE_FILE });
} finally {
  try { fs.unlinkSync(MUTANT); } catch {}
  try { fs.unlinkSync(SAVE_FILE); } catch {}
}
if (sha(fs.readFileSync(SRC, "utf8")) !== PRISTINE_SHA) throw new Error("bridge/bridge.js changed during the run");
if (sha(buildSave().LuaScript) !== LUA_SHA) throw new Error("the table's sources changed during the run");
const applied = results.filter((r) => !r.result.startsWith("NOT"));
const named = applied.filter((r) => r.result === "caught by name");
console.log(`\n${applied.length} mutations, ${named.length} caught by name, ${applied.length - named.length} not; ${results.length - applied.length} not applied; sources unchanged (sha256)`);
fs.writeFileSync(path.join(ROOT, "tmp", "mutate-standard.json"), JSON.stringify(results, null, 1));
process.exit(named.length === results.length ? 0 : 1);
