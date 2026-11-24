// Grades tests/test_accomplishments_golden.js (the bridge/accomplishments.js golden master) with
// tools/mutate-golden-lib.js: each mutation below is a plausible careless change; the golden must go red by name.
//   node tools/mutate-accomplishments-golden.js [label pattern]
// First pass 2026-11-24: 20 of 20 caught (0%, suspicious), so 8 more were added along the dimensions it had not varied:
// 25 of 28 (10.7%, SOUND). Of the 3 escapes, one was an equivalent mutant as written (now reads a missing store), one
// was a hole (0/false first and last; closed with a row) and one is argued equivalent below.
const path = require("path");
const { runMutations } = require("./mutate-golden-lib");

const ROOT = path.join(__dirname, "..");

// [label, from, to, equivalent?]: `from` must occur exactly once in accomplishments.js
const MUTATIONS = [
  ["steamKey: 4 digits accepted", "/^\\d{5,20}$/.test(s) ? s : null;", "/^\\d{4,20}$/.test(s) ? s : null;"],
  ["steamKey: 21 digits accepted", "/^\\d{5,20}$/.test(s) ? s : null;", "/^\\d{5,21}$/.test(s) ? s : null;"],
  ["steamKey: unanchored", "/^\\d{5,20}$/.test(s) ? s : null;", "/\\d{5,20}/.test(s) ? s : null;"],
  ["steamKey: a colour kept as the key", "/^\\d{5,20}$/.test(s) ? s : null;", "/^\\d{5,20}$/.test(s) ? s : s || null;"],
  ["stamp: local date instead of UTC", "new Date(now()).toISOString().slice(0, 10)", "new Date(now()).toLocaleDateString(\"sv-SE\", { timeZone: \"America/New_York\" })"],
  ["okEntry: count 0 kept", "Number.isInteger(e.count) && e.count > 0", "Number.isInteger(e.count) && e.count >= 0"],
  ["okEntry: count not checked as an integer", "Number.isInteger(e.count) && e.count > 0", "Number(e.count) > 0"],
  ["load: bad Steam IDs kept", "if (!steamKey(who) || !got || typeof got !== \"object\") continue;", "if (!got || typeof got !== \"object\") continue;"],
  ["load: unknown ids kept", "if (ACCOMPLISHMENTS[id] && okEntry(e))", "if (okEntry(e))"],
  ["load: the file's own name kept (not today's)", "kept[id] = { ...ACCOMPLISHMENTS[id], count: e.count,", "kept[id] = { ...ACCOMPLISHMENTS[id], ...e, count: e.count,"],
  ["load: first/last not made strings", "first: String(e.first || \"\"), last: String(e.last || \"\") };", "first: e.first, last: e.last };"],
  ["load: read error's message logged", "log(`accomplishments: can't read them (${(e && (e.code || e.name)) || \"unreadable\"})`)", "log(`accomplishments: can't read them (${(e && e.message) || \"unreadable\"})`)"],
  ["earn: count not added", "count: got[id].count + 1, last: day }", "count: got[id].count, last: day }"],
  ["earn: first moved to today", "{ ...got[id], count: got[id].count + 1, last: day }", "{ ...got[id], count: got[id].count + 1, first: day, last: day }"],
  ["earn: who not moved to the end", "      m.delete(who);\n      m.set(who, got);", "      m.set(who, got);"],
  ["earn: cap > becomes >=", "while (m.size > WHO_MAX)", "while (m.size >= WHO_MAX)"],
  ["earn: not saved", "      save();\n      return { id, ...e };", "      return { id, ...e };"],
  ["earn: returns the stored entry itself (alias)", "return { id, ...e };", "e.id = id; return e;"],
  ["list: stored entries returned (alias)", "return Object.entries(got).map(([id, e]) => ({ id, ...e }));", "return Object.entries(got).map(([id, e]) => Object.assign(e, { id }));"],
  ["save: version dropped", "opts.store.write({ version: 1, players:", "opts.store.write({ players:"],
  // (added after a first pass caught all 20: the dimensions that pass did not vary)
  ["load: not memoized (read every call)", "    if (all) return all;\n", ""],
  ["load: memory-only store read anyway", "saved = opts.store ? opts.store.read() : null;", "saved = opts.store.read();"],
  ["load: first/last by ?? (0 and false kept)", "first: String(e.first || \"\"), last: String(e.last || \"\") };", "first: String(e.first ?? \"\"), last: String(e.last ?? \"\") };"],
  // (EQUIVALENT: a string or number entry gives only digit keys or none to Object.entries, and no accomplishment id
  // is a digit string, so nothing is kept either way; an array is an object already)
  ["load: a player entry not an object still read (EQUIVALENT)", "if (!steamKey(who) || !got || typeof got !== \"object\") continue;", "if (!steamKey(who) || !got) continue;", true],
  ["earn: the cap evicts the newest", "while (m.size > WHO_MAX) m.delete(m.keys().next().value);", "while (m.size > WHO_MAX) m.delete([...m.keys()].at(-2));"],
  ["earn: unknown id checked after the load (order)", "      if (!who || !ACCOMPLISHMENTS[id]) return null;\n      const m = load();", "      const m = load();\n      if (!who || !ACCOMPLISHMENTS[id]) return null;"],
  ["save: write error's message logged", "log(`accomplishments: can't save them (${(e && (e.code || e.name)) || \"error\"})`)", "log(`accomplishments: can't save them (${(e && e.message) || \"error\"})`)"],
  ["save: a write error thrown on", "try { opts.store.write({ version: 1, players: Object.fromEntries(all) }); } catch (e) {", "try { opts.store.write({ version: 1, players: Object.fromEntries(all) }); } catch (e) { throw e;"],
];

runMutations(path.join(ROOT, "bridge", "accomplishments.js"), path.join(ROOT, "tests", "test_accomplishments_golden.js"), MUTATIONS, process.argv[2]);
