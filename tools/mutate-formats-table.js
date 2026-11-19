// Break-it proofs for the table's formats and ban lists (docs/format-banlist-spec.md §8 test 4 and 6, piece C): each
// rule broken on purpose, one at a time, in a COPY of the built table script (tmp/table-build/mutant-formats.json), and
// every check named for it in tests/test_table_formats.js must fail BY NAME. The sources are never edited: each mutant
// is written fresh from the pristine built text, and the sources are checked by sha256 after the run.
//   node tools/mutate-formats-table.js            (MUT_ONLY=<regex>: only the mutations whose name matches)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { buildSave } = require("../tests/golden/table-run");

const ROOT = path.join(__dirname, "..");
const SAVE_FILE = path.join(ROOT, "tmp", "table-build", "mutant-formats.json");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const save = buildSave();
const pristineLua = save.LuaScript;
const LUA_SHA = sha(pristineLua);

// [name, from, to, the checks (by name: the start of a FAIL line) that must each fail]
const MUTANTS = [
  ["the default is Commander", 'ENGINE_FORMAT = "casualcommander"', 'ENGINE_FORMAT = "commander"', ["load: Casual Commander"]],
  ["Casual Commander sends its rules", 'if ENGINE_FORMAT ~= "casualcommander" then\n    local r = engineBanRules()', "if true then\n    local r = engineBanRules()", ["Casual Commander: hello and decks carry no format"]],
  ["the change not said", 'broadcastToAll("[MTG] " .. tostring(who) .. " set the format"', 'print("[MTG] " .. tostring(who) .. " set the format"', ["Format button: a click goes to the next format"]],
  ["the format message not sent", 'engineSend("format", { color = pl and pl.color or nil, format = f.key, mode = f.mode, banned = r.banned, restricted = r.restricted })', "", ["Format button: a click goes to the next format"]],
  ["the button always says Casual Commander", 'function engineFormatLabel() return "Format\\n" .. engineFormatNow().name end', 'function engineFormatLabel() return "Format\\nCasual Commander" end', ["Format button: says the format"]],
  ["a right-click goes forward", "engineFormatStep(alt and -1 or 1)", "engineFormatStep(1)", ["Format button: forward twice, then a right-click goes back"]],
  ["the button stops at the ends", "at = (at - 1 + step) % n + 1", "at = math.max(1, math.min(n, at + step))", ["Format button: a right-click on the first format goes round"]],
  ["typed names: the key only", "if w == f.key or w == engineFormatWord(f.name) then return f end", "if w == f.key then return f end", ["mtg format <name>: by its name"]],
  ["typed names: no other names", "for _, a in ipairs(f.also or {}) do if w == a then return f end end", "", ["mtg format <other name>: casual"]],
  ["typed names: spaces kept", 'local out, keep = {}, "abcdefghijklmnopqrstuvwxyz0123456789"', 'local out, keep = {}, "abcdefghijklmnopqrstuvwxyz0123456789 "', ["mtg format <name>: by its name"]],
  ["the button doesn't skip a format with no list", "if not (f.list and ENGINE_BANLIST.missing[f.key]) then return f end", "if true then return f end", ["a format the bridge has no list for: the button skips it"]],
  ["a format with no list taken typed", "if f.list and ENGINE_BANLIST.missing[key] then", "if false then", ["a format the bridge has no list for: refused typed"]],
  ["no Banned cards switch", 'if f.list then\n    out[#out + 1] = { click = "onMtgSetupBanned"', 'if false then\n    out[#out + 1] = { click = "onMtgSetupBanned"', ["a format with a list: the Banned cards switch shows"]],
  ["anyone changes the format", 'if not isHost then pl.broadcast("[MTG] Only the host can change the format.", { 1, 0.65, 0.2 }) return true end\n    local g', "local g", ["host only: the Format button refused", "host only: mtg format refused"]],
  ["anyone flips a switch", 'if not isHost then pl.broadcast("[MTG] Only the host can change the format.", { 1, 0.65, 0.2 }) return true end\n    engineSetBanRule', "engineSetBanRule", ["host only: the Banned cards switch refused", "host only: the Restricted cards switch refused"]],
  ["anyone refreshes the lists", 'if not isHost then pl.broadcast("[MTG] Only the host can refresh the ban lists.", { 1, 0.65, 0.2 }) return true end', "", ["host only: mtg banlist refresh refused"]],
  ["READY kept on a change", "if not running then for k in pairs(engineReadyState) do engineReadyState[k] = nil end end\n  local f = engineFormatNow()", "local f = engineFormatNow()",
    ["READY cleared by a format change", "Banned cards switch: off", "Restricted cards switch: off"]],
  ["Restricted shown for every listed format", 'if f.restricted ~= nil then out[#out + 1] = { click = "onMtgSetupRestricted"', 'if true then out[#out + 1] = { click = "onMtgSetupRestricted"', ["Modern: 60-card (20 life), Banned cards enforced, no Restricted switch", "back to Modern"]],
  ["the Banned cards label never changes", 'return "Banned cards\\n" .. (engineBanRules().banned and "Not allowed" or "Allowed")', 'return "Banned cards\\nNot allowed"', ["Banned cards switch: off", "back to Modern"]],
  ["restricted switched in a format without the list", 'if which == "restricted" and f.restricted == nil then', "if false then", ["mtg restricted in a format without a restricted list"]],
  ["decks without the rules", "if engineRulesInto ~= nil then engineRulesInto(msg) end", "", ["Modern: decks, start and hello carry"]],
  ["start without the rules", "if engineRulesInto ~= nil then engineRulesInto(start) end", "", ["Modern: decks, start and hello carry"]],
  ["hello without the rules", "if engineRulesInto ~= nil then engineRulesInto(m) end", "", ["Modern: decks, start and hello carry"]],
  ["one pair of switches for every format", "if ENGINE_BAN_RULES[key] == nil then ENGINE_BAN_RULES[key] = { banned = true, restricted = true } end\n  return ENGINE_BAN_RULES[key]",
    "ENGINE_BAN_RULES.all = ENGINE_BAN_RULES.all or { banned = true, restricted = true }\n  return ENGINE_BAN_RULES.all", ["Vintage: both switches enforced"]],
  ["a format's switches reset on a change", "ENGINE_FORMAT = key\n  engineFormatChanged(pl)", "ENGINE_FORMAT = key\n  ENGINE_BAN_RULES[key] = nil\n  engineFormatChanged(pl)", ["back to Modern: its own switch kept"]],
  ["the Restricted label never changes", 'return "Restricted\\n" .. (on and "1 copy" or "Normal limit")', 'return "Restricted\\n1 copy"', ["Restricted cards switch: off"]],
  ["a switched-off switch not yellow", "b.house and SETUP.color.wait or SETUP.color.idle", "SETUP.color.idle", ["a switch turned off shows yellow"]],
  ["the missing formats never cleared", "ENGINE_BANLIST.missing = {}\n    for _, k in ipairs(m.missing)", "for _, k in ipairs(m.missing)", ["the bridge's next banlist names no missing format"]],
  ["Duel Commander's Restricted said as copies", 'if engineFormatNow().restricted == "commander" then return "Restricted\\n" .. (on and "Not as commander" or "Allowed") end', "", ["Duel Commander: the Restricted switch"]],
  ["the heal counts one button too many", "+ (SETUP.drawn.fmt or 0) then return false end", "+ (SETUP.drawn.fmt or 0) + 1 then return false end", ["engineSetupIntact: the tile with the format buttons is whole", "no redraw loop"]],
  ["the format buttons not counted by the heal", "SETUP.drawn.fmt = SETUP.drawn.fmt + 1", "", ["a wiped format button: drawn again at the next heal"]],
  ["the count not on the label", '(L ~= nil and tostring(L.banned or 0) or "?")', '"?"', ["Banned list button: the bridge's count on its label"]],
  ["the label not in the redraw signature", ' .. ":" .. engineBanlistLabel()\nend', "\nend", ["Banned list button: the bridge's count on its label"]],
  ["the Banned list line to everyone", 'broadcastToColor("[MTG] " .. text, color, { 1, 0.85, 0.4 })\n  if f.list and (L == nil', 'broadcastToAll("[MTG] " .. text, { 1, 0.85, 0.4 })\n  if f.list and (L == nil', ["Banned list button: anyone, a line to the presser only"]],
  ["the names never asked for", 'then engineSend("banlist", { color = color, format = f.key }) end', "then end", ["Banned list button: the Notebook has no list yet"]],
  ["the names not sorted", "  table.sort(banned)\n", "", ["Notebook: the tab 'Banned list' added"]],
  ["the tab never added", "      Notes.addNotebookTab(tab)\n", "", ["Notebook: the tab 'Banned list' added"]],
  ["the tab never rewritten", "      Notes.editNotebookTab(tab)\n", "", ["Notebook: a changed list rewrites the same tab"]],
  ["the tab not found by its title", "if t.title == tab.title and found == nil then found = t end", "", ["Notebook: a changed list rewrites the same tab"]],
  ["what the tab holds not kept", '  ENGINE_BANLIST.tab = engineBanlistTabKey(f.key, L)\n', "", ["Notebook written: the Banned list button no longer asks the bridge"]],
  ["the names don't update the count", "  ENGINE_BANLIST.lists[f.key] = L\n", "", ["Banned list label follows the names"]],
  ["another format's names written", "if f == nil or f.key ~= ENGINE_FORMAT then return end", "if f == nil then return end", ["Notebook: another format's names are not written"]],
  ["mtg format without the rules", 'pl.broadcast("[MTG] Format: " .. engineFormatWords(f) .. ". Formats: "', 'pl.broadcast("[MTG] Format: " .. f.name .. ". Formats: "', ["mtg format: the format, its rules and the list"]],
  ["a bad name not said", `if g == nil then pl.broadcast("[MTG] No format called '" .. rest .. "'. Type  mtg format  for the list.", { 1, 0.65, 0.2 }) return true end`, "if g == nil then return true end", ["mtg format <bad name>: said"]],
  ["refresh never sent", "engineSend(\"banlist\", { color = pl.color, refresh = true })", "", ["mtg banlist refresh (host): asks the bridge"]],
  ["a problem report read as ready", 'engineReadyState[c] = ok[c] and "ready" or "problem"', 'engineReadyState[c] = "ready"', ["a format problem: the deckReport turns the seat's button FIX DECK"]],
  ["the format's game mode not applied", "  engineSetGameMode(f.mode)\n  engineSetupButtons()\nend", "  engineSetupButtons()\nend", ["a 60-card format drops 2HG", "Modern: 60-card (20 life)"]],
  ["the setup buttons drawn in a game", "if not running and not over then\n      SETUP.drawn.friendly = true", "if true then\n      SETUP.drawn.friendly = true", ["in a game: the Format, switch and Banned list buttons are hidden"]],
  ["one font for every name", "return longest > 14 and math.max(140, math.floor(220 * 14 / longest)) or 220", "return 220", ["a long format name gets a smaller font"]],
];

const only = process.env.MUT_ONLY ? new RegExp(process.env.MUT_ONLY) : null;
const results = [];
fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
try {
  for (const [name, from, to, wants] of MUTANTS.filter(([n]) => !only || only.test(n))) {
    const n = pristineLua.split(from).length - 1;
    if (n !== 1) { results.push({ name, result: `NOT APPLIED (found ${n}x)` }); console.log(`NOT APPLIED (found ${n}x)  ${name}`); continue; }
    fs.writeFileSync(SAVE_FILE, JSON.stringify({ ...save, LuaScript: pristineLua.replace(from, () => to) }));
    let fails = [];
    try { execFileSync(process.execPath, [path.join(ROOT, "tests", "test_table_formats.js")], { env: { ...process.env, TABLE_SAVE: SAVE_FILE }, stdio: "pipe" }); }
    catch (e) { fails = String(e.stdout).split("\n").filter((l) => l.startsWith("FAIL ")); if (!fails.length) fails = [`(crashed) ${String(e.stderr).split("\n").find((l) => l.trim()) || ""}`]; }
    const missed = wants.filter((w) => !fails.some((l) => l.startsWith(`FAIL ${w}`)));
    const result = !missed.length ? "caught by name" : fails.length ? "caught, not by name" : "ESCAPED";
    results.push({ name, result, wants, missed, fails: fails.map((l) => l.slice(0, 160)) });
    console.log(`${!missed.length ? "caught " : fails.length ? "OTHER  " : "ESCAPED"}  ${name}${missed.length ? `   missed "${missed.join('", "')}"${fails.length ? `, got ${fails[0].slice(0, 120)}` : ""}` : ""}`);
  }
} finally {
  try { fs.unlinkSync(SAVE_FILE); } catch {}
}
if (sha(buildSave().LuaScript) !== LUA_SHA) throw new Error("the table's sources changed during the run");
const applied = results.filter((r) => !r.result.startsWith("NOT"));
const named = applied.filter((r) => r.result === "caught by name");
console.log(`\n${applied.length} mutations, ${named.length} caught by name, ${applied.length - named.length} not; ${results.length - applied.length} not applied; sources unchanged (sha256)`);
fs.writeFileSync(path.join(ROOT, "tmp", "mutate-formats-table.json"), JSON.stringify(results, null, 1));
process.exit(named.length === results.length ? 0 : 1);
