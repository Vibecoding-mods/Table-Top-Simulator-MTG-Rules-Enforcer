// Break-it for the deck check per format (tests/test_bridge_formats.js; docs/format-banlist-spec.md §3, §5, §6.3, §7,
// §12): each mutation switches one rule off in a COPY of its file and runs the test, which must fail the check the
// mutation names (a crash, or another check failing instead, is a survivor). bridge/bridge.js is copied to
// bridge/bridge.mutant.js (BRIDGE_PATH); bridge/format-rules.js to bridge/format-rules.mutant.js (FORMAT_RULES_PATH),
// with a bridge copy that requires it. The real files are never written: their sha256 is checked before and after each
// run, and the copies are removed.
//   node tools/mutate-format-rules.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEST = "tests/test_bridge_formats.js";
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const B = "bridge/bridge.js", F = "bridge/format-rules.js";
const BRIDGE_COPY = path.join(ROOT, "bridge", "bridge.mutant.js"), RULES_COPY = path.join(ROOT, "bridge", "format-rules.mutant.js");
// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  // ── bridge/format-rules.js ──
  ["shape: not exactly 100 allowed", F, "if (total !== 100) problems.push", "if (total > 100) problems.push", "commander: 99 cards is a problem (§12.3)"],
  ["shape: not singleton", F, "counts.get(n) > (typeof limit(n) === \"number\" ? limit(n) : 1));", "counts.get(n) > (typeof limit(n) === \"number\" ? limit(n) : 4));", "commander: two of a non-basic card is a problem (§12.3)"],
  ["shape: a card's own limit ignored in singleton", F, "const extra = names.filter((n) => !isBasic(n) && limit(n) !== \"any\" && counts.get(n) > (typeof limit(n) === \"number\" ? limit(n) : 1));", "const extra = names.filter((n) => !isBasic(n) && counts.get(n) > 1);", "commander: a card's own limit (any number, 7)"],
  ["shape: 56 cards allowed", F, "if (cards.length < 60) problems.push", "if (cards.length < 56) problems.push", "modern: a commander and 56 cards"],
  ["shape: 16 in the sideboard allowed", F, "if (sideboard.length > 15) problems.push", "if (sideboard.length > 16) problems.push", "modern: 16 in the sideboard, 5 copies across both"],
  ["shape: 4 copies counted in the main deck only", F, "const k = own ? inMain.get(n) || 0 : counts.get(n);", "const k = inMain.get(n) || 0;", "modern: 16 in the sideboard, 5 copies across both"],
  ["shape: a commander allowed in a 60-card format", F, "if (commanders.length) problems.push(`${f.name} has no commander", "if (false) problems.push(`${f.name} has no commander", "modern: a commander and 56 cards"],
  ["restricted: also said as over 4", F, "!isBasic(n) && limit(n) !== \"any\" && !restrictedHere(n)).map", "!isBasic(n) && limit(n) !== \"any\").map", "vintage: a restricted card is not also said as over 4"],
  ["restricted: 4 copies allowed", F, "st.get(n) === \"r\" && counts.get(n) > 1);", "st.get(n) === \"r\" && counts.get(n) > 4);", "vintage: 4× a restricted card, Restricted on"],
  ["restricted: the switch ignored", F, "if (opts.restricted !== false && f.restricted === \"copy\") {", "if (f.restricted === \"copy\") {", "vintage: Restricted off, 4 is the normal limit"],
  ["restricted: Duel's counts the 99", F, "[...new Set(commanders)].filter((n) => st.get(n) === \"r\")", "[...new Set([...commanders, ...cards])].filter((n) => st.get(n) === \"r\")", "duel: a restricted card in the 99 is fine"],
  ["restricted: Duel's switch ignored", F, "if (opts.restricted !== false && f.restricted === \"commander\") {", "if (f.restricted === \"commander\") {", "duel: Restricted off lets it be the commander"],
  ["restricted: Duel's kind is copies", F, "{ key: \"duel\", name: \"Duel Commander\", mode: \"commander\", shape: \"commander\", list: true, restricted: \"commander\",", "{ key: \"duel\", name: \"Duel Commander\", mode: \"commander\", shape: \"commander\", list: true, restricted: \"copy\",", "formats: the restricted kinds"],
  ["banned: the switch ignored", F, "if (banned.length && opts.banned !== false) problems.push", "if (banned.length) problems.push", "commander: banned off lets only the banned card through (§12.2)"],
  ["banned off: not-legal cards let through too", F, "if (outside.length) problems.push", "if (outside.length && opts.banned !== false) problems.push", "commander: banned off lets only the banned card through (§12.2)"],
  ["lists: a Casual format checked", F, "const status = f.list && typeof opts.status === \"function\"", "const status = typeof opts.status === \"function\"", "casual 60: the shape only, no list"],
  ["lists: an unknown name not said", F, "if (unknown.length) warnings.push", "if (false) warnings.push", "commander: a name with no data is a warning"],
  ["lists: no data not said", F, "if (f.list && !status) warnings.push", "if (false) warnings.push", "modern: no data at all is said, only the shape checked"],
  ["words: Pauper's reason", F, "restricted: null, reason: \"not a common\" },", "restricted: null, reason: \"not from its sets\" },", "notLegalReason: §5.3's words"],
  ["words: 9 names before 'more'", F, "const few = (list) => `${list.slice(0, 8).join(\", \")}${list.length > 8", "const few = (list) => `${list.slice(0, 9).join(\", \")}${list.length > 9", "few: 8 names, then how many more"],
  ["words: the restricted switch not named", F, "restrictedHit ? \"turn restricted cards off (Restricted cards button)\" : null", "null", "vintage: the closing line names the data and the switch"],
  ["words: the closing line always", F, "if (bannedHit || restrictedHit) {", "if (true) {", "commander: no banned or restricted problem, no closing line"],
  ["words: a format key with spaces", F, ".toLowerCase().replace(/[\\s_-]+/g, \"\");", ".toLowerCase();", "formatKey: as typed or sent"],
  // ── bridge/bridge.js ──
  ["format: not read", B, "  const fk = formatRules.formatKey(m?.format);\n  const k = fk", "  const fk = null;\n  const k = fk", "format: Modern is a 60-card format"],
  ["format: the message not handled", B, "      onFormat(m);\n", "", "format: Modern is a 60-card format"],
  ["format: the banned switch not read", B, "const banned = !f || m.banned !== false,", "const banned = true,", "format: the switches as sent"],
  ["format: Casual Commander kept as a format", B, "const f = fk && fk !== formatRules.DEFAULT_FORMAT ? fk : null;", "const f = fk || null;", "format Casual Commander: no format"],
  ["check: the format's problems dropped", B, "  if (fc) problems.push(...fc.problems);\n", "", "alert golden: modern"],
  ["check: the format's warnings dropped", B, "  const warnings = [...(fc?.warnings || [])];", "  const warnings = [];", "ready: no data for the format is said, and not 'legal'"],
  ["check: Casual warnings in a named Commander format", B, "if (!std && !fr && asList(entry.library).length && total !== 100) warnings.push", "if (!std && asList(entry.library).length && total !== 100) warnings.push", "alert golden: commander"],
  ["check: the rules not recorded", B, "    ...(fr ? { rules: `${fr.format}|${fr.banned}|${fr.restricted}|${fc.hash}` } : {}) };", "    };", "ready: the deck's rules"],
  ["check: the closing line left out", B, "${footer ? `\\n${footer}` : \"\"}", "", "alert: Modern's lines, §5.2's order"],
  ["check: the banned cards let through not said", B, "const allowed = fc.allowedBanned.length ?", "const allowed = false ?", "ready: banned off names the banned card it let through"],
  ["check: 'legal' said with no data", B, "const legal = F.list && !fc.warnings.length ?", "const legal = F.list ?", "ready: no data for the format is said, and not 'legal'"],
  ["data: has() ignored", B, "(typeof l.has !== \"function\" || l.has(f.key))", "true", "ready: no data for the format is said, and not 'legal'"],
  ["data: no Forge fallback for Standard", B, "  if (f.key === \"standard\") {\n    const s = forgeFormat(\"Standard\");", "  if (false) {\n    const s = forgeFormat(\"Standard\");", "ready: Standard with no ban list data falls back to Forge's list"],
  ["start: the switches not compared", B, "(readyDecks[c].rules || readyDecks[c].mode || \"commander\") === rules;", "(readyDecks[c].rules || readyDecks[c].mode || \"commander\").split(\"|\")[0] === String(rules).split(\"|\")[0];", "start: the same format with a switch changed"],
  ["start: the mode's rules, not the format's", B, "const deckRules = mode === gameMode.mode ? rulesKey() : mode;", "const deckRules = mode;", "start: a deck checked for Commander, the format now Modern"],
  ["start: other rules not said", B, "  if (stale.length) {\n", "  if (false) {\n", "start: a deck checked for Commander, the format now Modern"],
  ["start: an older list not said", B, "return rulesWords(k) === rulesWords(deckRules) ?", "return false ?", "start: the same rules with an older list"],
  ["start: a Casual deck under a format not said", B, "readyDecks[c] && (formatGame || rulesOf(readyDecks[c].rules))", "readyDecks[c] && rulesOf(readyDecks[c].rules)", "start: a Casual Commander deck, the format now Duel Commander"],
  ["start: the format's words not said", B, "  if (notReady.length && formatGame) {\n", "  if (false) {\n", "start: no deck checked, the format's words"],
  ["start: the game has no rules", B, "mode, ...(formatGame ? { rules: deckRules } : {}),", "mode,", "game: its rules"],
  ["start: AI decks not said", B, "if (formatGame && bots > aiTable.length &&", "if (false &&", "game: AI decks said not checked against the list, once"],
  ["resume: the rules not saved", B, "      ...(game.rules ? { rules: game.rules } : {}), // (a format's game keeps its rules", "      // (", "resume: the save has the rules"],
  ["game over: the format not named", B, "${game?.rules ? ` (${rulesWords(game.rules)})` : \"\"}", "", "game over: the game log's line names the format"],
  ["refresh: the list not taken", B, "  legality = l || null;\n  legalStandard.clear();", "  legalStandard.clear();", "refresh: the deck with the new ban is dropped"],
  ["refresh: a failing deck kept", B, "    delete readyDecks[c];\n    dropped.push(c);", "    dropped.push(c);", "refresh: the deck with the new ban is dropped"],
  ["refresh: a passing deck not given the new hash", B, "{ d.rules = `${r.format}|${r.banned}|${r.restricted}|${fc.hash}`; continue; }", "continue;", "refresh: the deck without it keeps its READY, under the new hash"],
  ["refresh: no red report", B, "  if (dropped.length) toTTS({ t: \"deckReport\", request: -1,", "  if (false) toTTS({ t: \"deckReport\", request: -1,", "refresh: a red report for it"],
  ["refresh: a Casual deck checked", B, "    const d = readyDecks[c], r = rulesOf(d.rules);\n    if (!r) continue;", "    const d = readyDecks[c], r = rulesOf(d.rules) || { format: \"commander\", banned: true, restricted: true };", "refresh: a Casual Commander deck stays ready"],
  ["sideboarding: not re-checked", B, "    if (fbad.length) {", "    if (false) {", "sideboarding: a swap bringing in a card banned since is refused"],
  ["ai list: not checked under the format", B, "const problems = fr ? deckFormatCheck(fr, main, cmd, side).problems : standardProblems(main, cmd, side);", "const problems = standardProblems(main, cmd, side);", "ai list: checked under the format"],
  ["presets: not filtered by the format", B, "  if (gameMode.format && formatRules.formatOf(gameMode.format).mode === mode) {\n    const key = rulesKey();", "  if (false) {\n    const key = rulesKey();", "presets: the format's check filters them"],
];

const pattern = process.argv.slice(2).find((a) => !a.startsWith("--"));
const only = pattern ? new RegExp(pattern, "i") : null;
const pristine = Object.fromEntries([B, F].map((f) => [f, sha(path.join(ROOT, f))]));
const checkPristine = () => {
  for (const [f, h] of Object.entries(pristine)) if (sha(path.join(ROOT, f)) !== h) { console.log(`REAL FILE CHANGED: ${f}`); process.exit(100); }
};
const clean = () => { fs.rmSync(BRIDGE_COPY, { force: true }); fs.rmSync(RULES_COPY, { force: true }); };
// the copies for one mutation of `file` (null: unchanged copies); the test's environment
function writeCopies(file, mutated) {
  const bridge = fs.readFileSync(path.join(ROOT, B), "utf8");
  if (file === F) {
    fs.writeFileSync(RULES_COPY, mutated ?? fs.readFileSync(path.join(ROOT, F), "utf8"));
    fs.writeFileSync(BRIDGE_COPY, bridge.replace('require("./format-rules")', 'require("./format-rules.mutant")'));
    return { BRIDGE_PATH: BRIDGE_COPY, FORMAT_RULES_PATH: RULES_COPY };
  }
  fs.writeFileSync(BRIDGE_COPY, mutated ?? bridge);
  return { BRIDGE_PATH: BRIDGE_COPY };
}
const runTest = (extra) => {
  const env = { ...process.env };
  delete env.BRIDGE_PATH; delete env.FORMAT_RULES_PATH; delete env.UPDATE;
  Object.assign(env, extra || {});
  const r = spawnSync(process.execPath, [path.join(ROOT, TEST)], { encoding: "utf8", timeout: 600000, maxBuffer: 1 << 26, env });
  const failed = [];
  for (const line of String(r.stdout).split("\n")) if (/^FAIL /.test(line)) failed.push(line.slice(5, 120));
  const crashed = /^CRASH /m.test(String(r.stdout)) || (r.status !== 0 && !failed.length);
  if (crashed) failed.unshift(`(crashed) ${String(r.stdout).split("\n").find((l) => l.startsWith("CRASH")) || `exit ${r.status} ${String(r.stderr).slice(0, 200)}`}`);
  return { failed, crashed };
};
// (the test must pass on the real files first, and on unchanged copies: a copy that fails by itself proves nothing)
{
  const base = runTest(null);
  if (base.failed.length) { console.log(`BASELINE FAILS: ${base.failed.join(" | ")}`); process.exit(1); }
  for (const f of [B, F]) {
    let r;
    try { r = runTest(writeCopies(f, null)); } finally { clean(); checkPristine(); }
    if (r.failed.length) { console.log(`UNCHANGED COPY FAILS (${f}): ${r.failed.join(" | ")}`); process.exit(1); }
  }
}
let survived = 0, caught = 0;
for (const [label, file, from, to, want] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`NOT APPLIED (${n} matches) ${label}`); survived++; continue; }
  let r;
  try { r = runTest(writeCopies(file, src.replace(from, () => to))); } finally { clean(); checkPristine(); }
  const named = !r.crashed && r.failed.some((f) => f.startsWith(want.slice(0, 110)));
  if (named) { caught++; console.log(`caught   ${label}: ${want}${r.failed.length > 1 ? ` (+${r.failed.length - 1})` : ""}`); }
  else { survived++; console.log(`SURVIVED ${label}${r.failed.length ? ` (failed instead: ${r.failed.slice(0, 2).join(" | ")})` : ""}`); }
}
console.log(`${caught} caught, ${survived} survived; the real files unchanged (sha256), the copies removed`);
process.exit(survived ? 1 : 0);
