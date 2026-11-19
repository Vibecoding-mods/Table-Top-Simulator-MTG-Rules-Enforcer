// The ban list data (docs/format-banlist-spec.md §4, §6.3): per format, whether each card is legal, banned,
// restricted or not legal. Source order (§4.4): Scryfall's bulk oracle_cards, reduced into a cache under tmp/ by
// bridge/legality-worker.js; else Forge's own format files (bridge/forge-legality.json, tools/build-forge-card-index.js
// --legality); else nothing. Pure apart from reading those two files: the download runs in the worker, and the tests
// swap the worker, the fetch, the files and the clock through configure().
//   loadLegality()              -> { source, date, hash, status(format, name), list(format), has(format) }
//   refreshLegality({ force })  -> Promise<{ changed, summary }>
//   onLegalityChanged(cb)       cb(loadLegality(), summary) after a refresh that changed the hash
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Scryfall's legality keys we offer (§3.1). casualcommander and casual60 have no list: has() is false for them.
// Not oldschool: Scryfall's Old School data calls Black Lotus and Ancestral Recall not legal and has 323 legal cards in
// all (checked 2026-11-18), and Forge has no list for it, so has("oldschool") is false and the table skips it.
const KEYS = ["commander", "duel", "paupercommander", "predh", "standard", "pioneer", "modern", "legacy", "vintage", "pauper",
  "premodern", "historic", "timeless", "alchemy"];
const WORDS = { commander: "Commander", duel: "Duel Commander", paupercommander: "Pauper Commander", predh: "PreDH", standard: "Standard",
  pioneer: "Pioneer", modern: "Modern", legacy: "Legacy", vintage: "Vintage", pauper: "Pauper", premodern: "Premodern",
  oldschool: "Old School", historic: "Historic", timeless: "Timeless", alchemy: "Alchemy" };
const LETTER = { legal: "l", banned: "b", restricted: "r", not_legal: "n" };
// what isn't a card a deck can hold (oracle_cards lists them too)
const NOT_CARDS = new Set(["token", "double_faced_token", "emblem", "art_series", "vanguard"]);
// the layouts Forge names "A // B"; every other multi-face card goes by its front face (a DFC, an adventure, a flip card)
const BOTH_HALVES = new Set(["split", "aftermath"]);
const META_URL = "https://api.scryfall.com/bulk-data/oracle-cards";
const HEADERS = { Accept: "application/json;q=0.9,*/*;q=0.8", "User-Agent": "mtg-tts-bridge/0.1" };
const DAY_MS = 24 * 3600 * 1000;
const OLD_MS = 7 * DAY_MS;

// the bridge's name normalisation (bridge.js normName)
const normName = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'")
  .replace(/\s+/g, " ").trim().toLowerCase();
const frontFace = (s) => String(s || "").split(" // ")[0];

// ───── the reduction: oracle_cards lines -> the cache shape (§4.3) ─────
function newReduction() {
  const formats = {};
  for (const k of KEYS) formats[k] = { banned: new Set(), restricted: new Set() };
  return { keys: KEYS.slice(), formats, cards: new Map(), full: new Set(), identity: new Map(), read: 0, kept: 0, skipped: 0 };
}
// One JSONL line (or one line of Scryfall's JSON array file, with its "[", "]" and trailing commas) into `out`.
// Returns true when a card was kept.
function reduceOracleLine(line, out) {
  let text = String(line).trim();
  if (text.endsWith(",")) text = text.slice(0, -1);
  if (!text || text === "[" || text === "]") return false;
  out.read++;
  let card;
  try { card = JSON.parse(text); } catch { out.skipped++; return false; }
  if (!card || typeof card !== "object" || typeof card.name !== "string" || !card.legalities || typeof card.legalities !== "object") { out.skipped++; return false; }
  if (NOT_CARDS.has(card.layout)) return false;
  const status = out.keys.map((k) => LETTER[card.legalities[k]] || "n").join("");
  const listName = BOTH_HALVES.has(card.layout) ? card.name : frontFace(card.name);
  out.keys.forEach((k, i) => {
    if (status[i] === "b") out.formats[k].banned.add(listName);
    else if (status[i] === "r") out.formats[k].restricted.add(listName);
  });
  const full = normName(card.name);
  out.cards.set(full, status);
  out.full.add(full);
  const faces = [frontFace(card.name), ...(Array.isArray(card.card_faces) ? card.card_faces.map((f) => f && f.name) : [])];
  for (const f of faces) { const n = normName(f); if (n && !out.full.has(n)) out.cards.set(n, status); }
  if (Array.isArray(card.color_identity)) out.identity.set(full, card.color_identity.join(""));
  out.kept++;
  return true;
}
// the content hash: the lists and the per-card statuses, in a fixed order (not the date: Scryfall's file changes daily)
function hashOf(keys, formats, cards) {
  const h = crypto.createHash("sha1");
  h.update(JSON.stringify(keys));
  for (const k of keys) h.update(JSON.stringify([k, formats[k]?.banned || [], formats[k]?.restricted || []]));
  for (const n of Object.keys(cards).sort()) h.update(`${n}\t${cards[n]}\n`);
  return h.digest("hex");
}
// the cache object (§4.3) from a finished reduction
function finishReduction(out, meta = {}) {
  const formats = {};
  for (const k of out.keys) formats[k] = { banned: [...out.formats[k].banned].sort(), restricted: [...out.formats[k].restricted].sort() };
  const cards = {};
  for (const n of [...out.cards.keys()].sort()) cards[n] = out.cards.get(n);
  const identity = {};
  for (const n of [...out.identity.keys()].sort()) identity[n] = out.identity.get(n);
  return { source: "scryfall", updatedAt: meta.updatedAt || null, hash: hashOf(out.keys, formats, cards), keys: out.keys.slice(), formats, cards, identity,
    stats: { read: out.read, kept: out.kept, skipped: out.skipped } };
}

// ───── settings (the tests swap them) ─────
const defaults = () => {
  const home = require("./home.js");
  return {
    cacheFile: home.tmp("legality-cache.json"),
    forgeFile: path.join(__dirname, "forge-legality.json"),
    fetch: (...a) => global.fetch(...a),
    runWorker: runInWorkerThread,
    now: () => Date.now(),
    log: () => {},
    busy: () => false, // a game is running: a refresh waits for its end (§4.2.5)
  };
};
let cfg = null;
const settings = () => (cfg ??= defaults());
function configure(o) { cfg = { ...settings(), ...o }; current = null; return cfg; }

// ───── loading (§4.4) ─────
let current = null;
// a parsed file in the cache shape, or null (logged) when it is missing or doesn't hold together
function readData(file, what) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {
    if (e.code !== "ENOENT") settings().log(`ban lists: ${what} ${path.basename(file)} unreadable (${e.message}), not used`);
    return null;
  }
  const ok = j && Array.isArray(j.keys) && j.keys.every((k) => typeof k === "string") && j.formats && typeof j.formats === "object"
    && j.cards && typeof j.cards === "object" && Object.values(j.cards).every((s) => typeof s === "string" && s.length === j.keys.length);
  if (!ok) { settings().log(`ban lists: ${what} ${path.basename(file)} has the wrong shape, not used`); return null; }
  return j;
}
const dayOf = (iso) => (typeof iso === "string" && /^\d{4}-\d\d-\d\d/.test(iso) ? iso.slice(0, 10) : null);
function view(data, source) {
  const keys = data ? data.keys : [];
  const has = (k) => !!data && keys.includes(k) && !!data.formats[k];
  const date = data ? dayOf(source === "scryfall" ? data.updatedAt : data.date) : null;
  return {
    source: data ? source : null,
    date,
    hash: data ? data.hash || hashOf(keys, data.formats, data.cards) : null,
    old: source === "scryfall" && !!date && settings().now() - Date.parse(data.updatedAt) > OLD_MS,
    has,
    status(format, name) {
      if (!has(format)) return null;
      const i = keys.indexOf(format);
      for (const n of [normName(name), normName(frontFace(name))]) {
        const s = Object.hasOwn(data.cards, n) ? data.cards[n] : null;
        if (s) return s[i];
      }
      return null;
    },
    list(format) {
      if (!has(format)) return { banned: [], restricted: [] };
      return { banned: (data.formats[format].banned || []).slice(), restricted: (data.formats[format].restricted || []).slice() };
    },
    missing() { return KEYS.filter((k) => !has(k)); },
    updatedAt: data && source === "scryfall" ? data.updatedAt : null,
  };
}
function loadLegality() {
  if (current) return current;
  const s = settings();
  const cache = readData(s.cacheFile, "the cache");
  if (cache) return (current = view(cache, "scryfall"));
  const forge = readData(s.forgeFile, "Forge's list");
  if (forge) return (current = view(forge, "forge"));
  return (current = view(null, null));
}

// "Scryfall, 2026-11-18", "Scryfall, 2026-11-02 (old: offline?)", "Forge, 2026-09-21", "none"
function sourceWords(l = loadLegality()) {
  if (!l.source) return "none";
  return `${l.source === "scryfall" ? "Scryfall" : "Forge"}${l.date ? `, ${l.date}` : ""}${l.old ? " (old: offline?)" : ""}`;
}

// ───── the change summary (§4.2.6) ─────
function changeSummary(before, after) {
  const parts = [];
  for (const k of KEYS) {
    if (!after.has(k)) continue;
    const a = after.list(k), b = before.list(k);
    const diff = (x, y) => { const ys = new Set(y); const xs = new Set(x); return [x.filter((n) => !ys.has(n)).length, y.filter((n) => !xs.has(n)).length]; };
    const [banAdd, banGone] = diff(a.banned, b.banned), [resAdd, resGone] = diff(a.restricted, b.restricted);
    const bits = [];
    if (banAdd || banGone) bits.push(`${[banAdd ? `+${banAdd}` : "", banGone ? `-${banGone}` : ""].filter(Boolean).join(" ")} banned`);
    if (resAdd || resGone) bits.push(`${[resAdd ? `+${resAdd}` : "", resGone ? `-${resGone}` : ""].filter(Boolean).join(" ")} restricted`);
    if (bits.length) parts.push(`${WORDS[k]} ${bits.join(", ")}`);
  }
  return `Ban lists updated (${sourceWords(after)})${parts.length ? `: ${parts.join(", ")}` : ": card statuses changed"}.`;
}

// ───── the refresh (§4.2) ─────
const listeners = [];
function onLegalityChanged(cb) { listeners.push(cb); }
let running = null; // the refresh under way: a second call shares it (never two at once)
let retryAt = 0; // after a 429 or a failure: not before (a forced refresh too)
let lastCheck = 0;

async function checkOnce({ force }) {
  const s = settings();
  if (s.busy()) return { changed: false, summary: "Ban lists: a game is running; the check waits for its end.", waiting: true };
  if (s.now() < retryAt) return { changed: false, summary: `Ban lists: Scryfall asked to wait; next try after ${new Date(retryAt).toISOString().slice(11, 16)} UTC (${sourceWords()}).` };
  if (!force && lastCheck && s.now() - lastCheck < DAY_MS) return { changed: false, summary: `Ban lists: checked today (${sourceWords()}).` };
  lastCheck = s.now();
  const fail = (why, waitMs) => {
    retryAt = s.now() + (waitMs || 0);
    s.log(`ban lists: refresh failed (${why}); the cache stays as it was`);
    return { changed: false, summary: `Ban lists: couldn't reach Scryfall (${why}); still ${sourceWords()}.`, failed: true };
  };
  const wait429 = (r) => { const sec = Number(r.headers?.get?.("retry-after")); return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 3600 * 1000; };
  let meta;
  try {
    const r = await s.fetch(META_URL, { headers: HEADERS });
    if (r.status === 429) return fail("429 Too Many Requests", wait429(r));
    if (!r.ok) return fail(`HTTP ${r.status}`);
    meta = await r.json();
  } catch (e) { return fail(e.message || String(e)); }
  const url = meta && (meta.jsonl_download_uri || meta.download_uri);
  if (!meta || typeof meta.updated_at !== "string" || typeof url !== "string") return fail("no download in Scryfall's answer");
  const before = loadLegality();
  if (before.source === "scryfall" && before.updatedAt === meta.updated_at) return { changed: false, summary: `Ban lists: up to date (${sourceWords(before)}).` };
  const tmpFile = `${s.cacheFile}.${process.pid}.tmp`;
  let done;
  try {
    done = await s.runWorker({ url, headers: HEADERS, outFile: tmpFile, updatedAt: meta.updated_at });
  } catch (e) { try { fs.unlinkSync(tmpFile); } catch { /* none written */ } return fail(e.message || String(e), e.status === 429 ? e.waitMs || 3600 * 1000 : 0); }
  const fresh = readData(tmpFile, "the download");
  if (!fresh || !done || fresh.hash !== done.hash || !Object.keys(fresh.cards).length) {
    try { fs.unlinkSync(tmpFile); } catch { /* gone */ }
    return fail("the reduced file didn't check out");
  }
  fs.mkdirSync(path.dirname(s.cacheFile), { recursive: true });
  fs.renameSync(tmpFile, s.cacheFile);
  current = null;
  const after = loadLegality();
  if (after.hash === before.hash) return { changed: false, summary: `Ban lists: up to date (${sourceWords(after)}).` };
  const summary = changeSummary(before, after);
  s.log(summary);
  for (const cb of listeners) { try { cb(after, summary); } catch (e) { s.log(`ban lists: a listener failed: ${e.message}`); } }
  return { changed: true, summary };
}
function refreshLegality({ force = false } = {}) {
  if (running) return running;
  running = checkOnce({ force }).finally(() => { running = null; });
  return running;
}

// The daily check (§4.2.2): one tick an hour; a check is due a day after the last one, waits while a game runs, and a
// tick never starts a second while one is under way. Returns a stop function.
function startLegalityTimer({ everyMs = 3600 * 1000 } = {}) {
  const tick = () => { if (!running && !settings().busy()) refreshLegality().catch((e) => settings().log(`ban lists: ${e.message}`)); };
  const t = setInterval(tick, everyMs);
  if (t.unref) t.unref();
  setImmediate(tick);
  return () => clearInterval(t);
}

// the worker thread (bridge/legality-worker.js): download, gunzip as a stream, reduce, write the file
function runInWorkerThread(job) {
  const { Worker } = require("worker_threads");
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, "legality-worker.js"), { workerData: job });
    w.once("message", (m) => (m && m.ok ? resolve(m) : reject(Object.assign(new Error(m?.error || "worker failed"), { status: m?.status, waitMs: m?.waitMs }))));
    w.once("error", reject);
    w.once("exit", (code) => { if (code) reject(new Error(`worker exited ${code}`)); });
  });
}

// the bridge's "banlist" message (to the table): the format's data, its counts, and the formats with no list
function banlistMessage(format, l = loadLegality()) {
  const li = l.list(format);
  return { t: "banlist", format, source: l.source, date: l.date, counts: { banned: li.banned.length, restricted: li.restricted.length }, missing: l.missing() };
}
function banlistNamesMessage(format, l = loadLegality()) {
  const li = l.list(format);
  return { t: "banlistNames", format, source: l.source, date: l.date, banned: li.banned, restricted: li.restricted };
}

function _reset() { current = null; running = null; retryAt = 0; lastCheck = 0; listeners.length = 0; }

module.exports = { KEYS, WORDS, normName, newReduction, reduceOracleLine, finishReduction, hashOf, loadLegality, refreshLegality, onLegalityChanged,
  startLegalityTimer, configure, sourceWords, changeSummary, banlistMessage, banlistNamesMessage, runInWorkerThread, META_URL, HEADERS, _reset, _defaults: defaults };
