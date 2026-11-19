// Break-it for the ban list data (docs/format-banlist-spec.md §8.6, piece A): each mutant switches one piece of
// bridge/legality.js, bridge/legality-worker.js or the bridge's "banlist" handling off, runs the test that covers it
// (tests/test_bridge_legality.js or tests/test_bridge_legality_refresh.js) and requires the named check to fail. A
// mutant the test only crashes on counts as missed. Every file is put back and checked by sha256.
// (Not mutants: the timer tick's own "not while running" and "not while a game runs" guards, since refreshLegality
// checks both itself; writing the download straight over the cache instead of a temp file, and leaving the temp file
// after a worker failure, since the worker writes only once the whole file has read well: no failure leaves one.)
//   node tools/mutate-legality.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const LEG = "bridge/legality.js", WRK = "bridge/legality-worker.js", BR = "bridge/bridge.js";
const T1 = "test_bridge_legality", T3 = "test_bridge_legality_refresh";
// [label, file, from, to, test, check that must fail]
const MUTANTS = [
  ["faces not indexed", LEG, "  for (const f of faces) { const n = normName(f); if (n && !out.full.has(n)) out.cards.set(n, status); }\n", "", T1, "reduce: a double-faced card under its full name and each face"],
  ["a face overwrites another card's full name", LEG, "if (n && !out.full.has(n)) out.cards.set(n, status);", "if (n) out.cards.set(n, status);", T1, "reduce: a full name is never overwritten by another card's face"],
  ["restricted read as banned", LEG, "restricted: \"r\", not_legal", "restricted: \"b\", not_legal", T1, "reduce: Vintage's restricted list"],
  ["a missing key read as legal", LEG, "LETTER[card.legalities[k]] || \"n\"", "LETTER[card.legalities[k]] || \"l\"", T1, "reduce: a key missing from a card's legalities is not legal"],
  ["tokens kept", LEG, "  if (NOT_CARDS.has(card.layout)) return false;\n", "", T1, "reduce: no token among the cards"],
  ["a line that isn't JSON not counted", LEG, "  try { card = JSON.parse(text); } catch { out.skipped++; return false; }", "  try { card = JSON.parse(text); } catch { return false; }", T1, "reduce: lines read, cards kept, lines skipped (a line that isn't JSON, a card with no legalities; a token is no card, not a skip)"],
  ["a split card listed by its front half", LEG, "const listName = BOTH_HALVES.has(card.layout) ? card.name : frontFace(card.name);", "const listName = frontFace(card.name);", T1, "reduce: a banned split card is listed as 'A // B'"],
  ["a DFC listed by its full name", LEG, "const listName = BOTH_HALVES.has(card.layout) ? card.name : frontFace(card.name);", "const listName = card.name;", T1, "reduce: a banned list keeps an adventure's and a DFC's front face, a split card's both halves"],
  ["the array file's commas kept", LEG, "  if (text.endsWith(\",\")) text = text.slice(0, -1);\n", "", T1, "reduce: Scryfall's array file (download_uri: '[', a card a line with a comma, ']') reads the same"],
  ["the date in the hash", LEG, "hash: hashOf(out.keys, formats, cards), keys:", "hash: hashOf(out.keys, formats, { ...cards, _: meta.updatedAt || \"\" }), keys:", T1, "hash: the date is not in the hash"],
  ["the card statuses not hashed", LEG, "  for (const n of Object.keys(cards).sort()) h.update(`${n}\\t${cards[n]}\\n`);\n", "", T1, "hash: one card's status changed (no list changed) changes the hash"],
  ["the fallback order swapped", LEG, "  const cache = readData(s.cacheFile, \"the cache\");\n  if (cache) return (current = view(cache, \"scryfall\"));\n  const forge = readData(s.forgeFile, \"Forge's list\");\n  if (forge) return (current = view(forge, \"forge\"));",
    "  const forge = readData(s.forgeFile, \"Forge's list\");\n  if (forge) return (current = view(forge, \"forge\"));\n  const cache = readData(s.cacheFile, \"the cache\");\n  if (cache) return (current = view(cache, \"scryfall\"));", T1, "load: the cache first"],
  ["a corrupt cache not logged", LEG, "    if (e.code !== \"ENOENT\") settings().log(", "    if (false) settings().log(", T1, "load: the corrupt cache is logged"],
  ["the cache's shape not checked", LEG, "  if (!ok) { settings().log(", "  if (!j) { settings().log(", T1, "load: a cache whose status strings don't fit its keys falls back"],
  ["no front-face lookup", LEG, "for (const n of [normName(name), normName(slashes(name)), normName(frontFace(slashes(name)))]) {", "for (const n of [normName(name), normName(slashes(name))]) {", T1, "status: a split card by 'A // B', a half, or 'A // something'"],
  ["names not lower-cased", LEG, ".replace(/\\s+/g, \" \").trim().toLowerCase(); // (Æ", ".replace(/\\s+/g, \" \").trim(); // (Æ", T1, "status: case and spacing don't matter"],
  ["an unknown format read as not legal", LEG, "      if (!has(format)) return null;\n      const i = keys.indexOf(format);", "      if (!has(format)) return \"n\";\n      const i = keys.indexOf(format);", T1, "status: an unknown format, or one with no list, is null"],
  ["old data not said", LEG, "const OLD_MS = 7 * DAY_MS;", "const OLD_MS = 70 * DAY_MS;", T1, "words: older than 7 days says so"],
  ["list hands out the data itself", LEG, "return { banned: (data.formats[format].banned || []).slice(),", "return { banned: (data.formats[format].banned || []),", T1, "list: a copy (the caller can't change the data)"],
  ["the summary leaves out what was removed", LEG, "banGone ? `-${banGone}` : \"\"", "\"\"", T1, "summary: counts per changed format"],
  ["the missing formats not sent", LEG, "counts: { banned: li.banned.length, restricted: li.restricted.length }, missing: l.missing() };", "counts: { banned: li.banned.length, restricted: li.restricted.length }, missing: [] };", T1, "message: banlist from Forge's file says which formats have no list"],
  ["the same updated_at downloaded again", LEG, "  if (before.source === \"scryfall\" && before.updatedAt === meta.updated_at) return", "  if (false) return", T3, "same updated_at: no download"],
  ["the hash not compared", LEG, "  if (after.hash === before.hash) return { changed: false,", "  if (false) return { changed: false,", T3, "same hash: downloaded, not changed, nobody told"],
  ["the listeners not told", LEG, "  for (const cb of listeners) { try { cb(after, summary); }", "  for (const cb of []) { try { cb(after, summary); }", T3, "newer: the listeners are told once, with the new data and the summary"],
  ["a broken gzip accepted", WRK, "  if (broken) throw new Error(`the download broke off: ${broken.message}`);\n", "", T3, "failure (a truncated gzip): said, and nothing changed"], // (the card floor also keeps the cache; the reason given is what's checked)
  ["a file ending mid-card accepted", WRK, "  if (lastBad) throw new Error(\"the file ended mid-card\");\n", "", T3, "failure (a file that ends mid-card): the cache untouched"],
  ["the download's status not checked", WRK, "  if (!r.ok || !r.body) throw", "  if (!r.body) throw", T3, "failure (the download 503): said, and nothing changed"],
  ["no gunzip", WRK, "      if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {", "      if (false) {", T3, "newer: the hash changed"],
  ["Retry-After ignored", LEG, "  const wait429 = (r) => { const sec = Number(r.headers?.get?.(\"retry-after\")); return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 3600 * 1000; };", "  const wait429 = () => 3600 * 1000;", T3, "429: after the Retry-After it asks again"],
  ["no wait after a 429", LEG, "  if (s.now() < retryAt) return", "  if (false) return", T3, "429: inside the Retry-After nothing is asked, even forced"],
  ["a 429 without Retry-After waits nothing", LEG, "return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 3600 * 1000; };", "return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0; };", T3, "429 without Retry-After: an hour"],
  ["mid-game refresh allowed", LEG, "  if (s.busy()) return", "  if (false) return", T3, "mid-game: nothing asked, the check waits"],
  ["no daily throttle", LEG, "  if (!force && lastCheck && s.now() - lastCheck < DAY_MS) return", "  if (false) return", T3, "daily: a second unforced check within the day asks nothing"],
  ["two refreshes at once", LEG, "  if (running) return running;\n", "", T3, "two at once: the second shares the first"],
  ["the timer never ticks", LEG, "  const t = setInterval(tick, everyMs);\n  if (t.unref) t.unref();\n  setImmediate(tick);", "  const t = setInterval(() => {}, everyMs);\n  if (t.unref) t.unref();", T3, "timer: ticks many times, checks once a day"],
  ["the download on the main thread", LEG, "    runWorker: runInWorkerThread,", "    runWorker: (job) => require(\"./legality-worker.js\").downloadAndReduce(job),", T3, "thread: the default runs a worker thread"],
  ["an older table's hello sent banlist", BR, "if (!m.again && tableKnowsFormats(m)) sendBanlist(banlistFormat(m));", "if (!m.again) sendBanlist(banlistFormat(m));", T1, "bridge: an older table's hello (no format) and a repeat hello send none"],
  ["hello's own format not used", BR, "if (!m.again && tableKnowsFormats(m)) sendBanlist(banlistFormat(m));", "if (!m.again && tableKnowsFormats(m)) sendBanlist();", T1, "bridge: hello with a format sends banlist once"],
  ["{format} answered with banlist, not the names", BR, "  toTTS(legality.banlistNamesMessage(format));\n}", "  sendBanlist(format);\n}", T1, "bridge: {format} answers banlistNames"],
  ["the refresh request ignored", BR, "  if (m.refresh) {\n    chat(\"[MTG] Ban lists: checking Scryfall ...\", m.color);", "  if (false) {\n    chat(\"[MTG] Ban lists: checking Scryfall ...\", m.color);", T1, "bridge: refresh tells the host it checks, then that the lists are up to date"],
  ["a change not said to the table", BR, "function onBanlistChanged(l, summary) { chat(`[MTG] ${summary}`); if (tableHasFormats) sendBanlist(); }", "function onBanlistChanged(l, summary) { }", T1, "bridge: a refresh that changed the lists says so to everyone"],
  // (the review fixes of 2026-11-18)
  ["a changed list not resent to a table that knows formats", BR, "      if (tableKnowsFormats(m)) tableHasFormats = true;\n", "", T1, "bridge: a refresh that changed the lists resends banlist to a table that knows formats (hello, resend, answer)"],
  ["a changed list sent to an older table", BR, "if (tableHasFormats) sendBanlist(); }", "sendBanlist(); }", T1, "bridge: a changed refresh sends an older table (no format in its hello) only the answer"],
  ["Æ not spelled Ae", LEG, ".replace(/æ/gi, \"ae\")", "", T1, "status: an 'Æ' name is found by Scryfall's 'Ae' spelling"],
  ["Arena's 'A /// B' not read", LEG, "normName(slashes(name)), normName(frontFace(slashes(name)))", "normName(frontFace(name))", T1, "status: a split card as Arena writes it ('A /// B'), or 'A/B', or 'A / B'"],
  ["a failed check waits a day", LEG, "    lastCheck = 0; // (tried again at the next hourly tick, not a day later)\n", "", T3, "short download: the next hourly check tries again (not a day later)"],
  ["a short download replaces the cache", LEG, "  if (kept < (s.minCards ?? MIN_CARDS) || kept < before.cardCount * 0.8)", "  if (false)", T3, "short download: refused, the cache stays, no temp file left"],
  ["no card floor without a cache", LEG, "kept < (s.minCards ?? MIN_CARDS) || ", "", T3, "short download: with no cache, a few cards are still not a whole download"],
  ["a game started mid-download gets the new lists", LEG, "  if (s.busy()) { drop(); lastCheck = 0;", "  if (false) { drop(); lastCheck = 0;", T3, "game started mid-download: the cache stays, the check waits, no temp file left"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const run = (test) => {
  const r = spawnSync(process.execPath, ["--max-old-space-size=4096", path.join(ROOT, "tests", `${test}.js`)], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  const out = `${r.stdout}${r.stderr}`;
  return { out, crashed: /crashed:/.test(out) || (r.status !== 0 && !/^FAIL /m.test(out)) || r.signal != null, fails: out.split("\n").filter((l) => l.startsWith("FAIL ")) };
};
for (const t of new Set(MUTANTS.map((m) => m[4]))) {
  const r = run(t);
  if (r.fails.length || r.crashed) { console.log(`BASELINE FAILS: ${t}\n${r.out.slice(-800)}`); process.exit(1); }
}
let missed = 0, ran = 0;
for (const [label, file, from, to, test, name] of MUTANTS) {
  if (only && !only.test(label)) continue;
  ran++;
  const f = path.join(ROOT, file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8");
  if (src.split(from).length - 1 !== 1) { missed++; console.log(`NOT APPLIED ${label}`); continue; }
  let r;
  try {
    fs.writeFileSync(f, src.replace(from, () => to));
    r = run(test);
  } finally {
    fs.writeFileSync(f, orig);
    if (sha(f) !== h) { console.log(`RESTORE FAILED: ${file}`); process.exit(100); }
  }
  const hit = !r.crashed && r.fails.some((l) => l.startsWith(`FAIL ${name}:`) || l === `FAIL ${name}`);
  if (!hit) missed++;
  console.log(`${hit ? "caught  " : r.crashed ? "CRASHED " : "MISSED  "} ${label}${hit ? "" : `: ${r.fails.slice(0, 3).join(" | ").slice(0, 300) || r.out.slice(-200)}`}`);
}
console.log(`mutate-legality :: ${ran - missed} of ${ran} caught by name; files restored by sha256`);
process.exit(missed ? 1 : 0);
