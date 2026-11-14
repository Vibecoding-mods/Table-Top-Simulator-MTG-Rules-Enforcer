// GIF search for the table's GIF frames (docs/gif-frames-spec.md, route M: the provider's MP4 link on a Custom Tile).
// One adapter per provider (GIPHY only; KLIPY stays out until its terms are read), all returning the same items:
//   { id, title, mp4, still, thumb, w, h }
//   mp4    the moving picture the frame shows (a Custom Tile's ImageURL plays and loops an .mp4 in TTS, verified live)
//   still  a .jpg the frame holds once the clip has played (an Object UI Image takes a .jpg, never an .mp4: "Xml UI
//          only supports Texture2D", verified live 2026-11-13)
//   thumb  a small .jpg for the search panel's results (the same Object UI rule)
//   w, h   the clip's size, for the frame's shape
// The search runs here, never in the table's Lua: the key would have to be in the table script, and the table script
// goes to friends and into release packages. The key lives on the host's PC only (keyFile, outside the repo and the
// package), typed into the companion's Table tools and handed over by POST /tools {kind: "gif-key"}.
// Answers are cached (the same words within a day cost no call) and the provider's hour limit is counted: past it the
// player is told "GIF search is resting for N minutes".
// Pure apart from what createGifs is given (fetch, clock, key store), so tests drive it without a network.
const PER_PAGE = 8;
const MAX_PAGE = 50; // (GIPHY's offset tops out at 4999; 50 pages of 8 is plenty for a table)
const WORDS_MAX = 50; // GIPHY: "the length of the search query exceeds 50 characters" is HTTP 414
const RATINGS = ["g", "pg", "pg-13"];
const DEFAULT_RATING = "pg-13"; // the user's choice, 2026-11-13
const CACHE_MS = 24 * 3600 * 1000;
const CACHE_MAX = 300;
const HOUR_MS = 3600 * 1000;
const HOUR_LIMIT = 100; // a new GIPHY key is a beta key: 100 calls an hour (developers.giphy.com/docs/api)
const REST_429_MS = 15 * 60 * 1000; // the provider said "too many requests" before our own count did
const FETCH_MS = 8000;
const TITLE_MAX = 80;
const PROVIDERS = ["giphy"];

// the words as sent: one line, no control characters, spaces collapsed, at most WORDS_MAX characters
function cleanWords(q) {
  let s = String(q ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > WORDS_MAX) s = s.slice(0, WORDS_MAX).trim();
  return s;
}
const cleanRating = (r) => (RATINGS.includes(String(r ?? "").toLowerCase()) ? String(r).toLowerCase() : DEFAULT_RATING);
const cleanPage = (p) => Math.min(MAX_PAGE, Math.max(0, Math.floor(Number(p)) || 0));
// a title the table can show and log: one line, no characters that break its XML or Lua tables, TITLE_MAX at most
function cleanTitle(t) {
  const s = String(t ?? "").replace(/[\u0000-\u001f\u007f<>"'&\\]/g, " ").replace(/\s+/g, " ").trim();
  return (s.length > TITLE_MAX ? s.slice(0, TITLE_MAX - 1).trimEnd() + "…" : s) || "GIF";
}

// A GIPHY media link the table may load: https, a GIPHY media host, a plain path ending in one of exts. Returned
// without its query (GIPHY adds ?cid=...&rid=...; TTS reads the format from the link, and the link alone serves the
// same file). null for anything else, so a provider answer can never put another host's link on the table.
const MEDIA_HOST = /^(?:media\d?|i)\.giphy\.com$/;
const SAFE_PATH = /^\/[A-Za-z0-9/_.-]+$/;
function mediaLink(u, exts) {
  let url;
  try { url = new URL(String(u ?? "")); } catch { return null; }
  if (url.protocol !== "https:" || !MEDIA_HOST.test(url.hostname) || url.port || url.username || url.password) return null;
  const p = url.pathname;
  if (!SAFE_PATH.test(p) || p.includes("..") || !exts.some((e) => p.toLowerCase().endsWith(e))) return null;
  return `https://${url.hostname}${p}`;
}
// a GIPHY still (a .gif, which TTS can't load) as a .jpg through wsrv.nl, the public image proxy the table already uses
// for card pictures; size: the longer side in pixels
function viaProxy(link, size) {
  const m = mediaLink(link, [".gif", ".jpg", ".webp"]);
  if (!m) return null;
  return `https://wsrv.nl/?url=${m.slice("https://".length)}&w=${size}&h=${size}&fit=inside&output=jpg`;
}
const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, 4096) : null; };

// ───────── GIPHY (developers.giphy.com/docs/api: GET api.giphy.com/v1/gifs/search; the GIF and Images objects) ─────────
const giphy = {
  credit: "Powered By GIPHY", // required where the API is used (their API docs); the search panel shows it
  searchUrl(key, words, page, rating) {
    const q = new URLSearchParams({ api_key: key, q: words, limit: String(PER_PAGE), offset: String(page * PER_PAGE), rating, lang: "en" });
    return `https://api.giphy.com/v1/gifs/search?${q}`;
  },
  // one GIF Object -> an item, or null when it has nothing the table can play. The documented renditions: original
  // { width, height, mp4, mp4_size, ... }, fixed_height { mp4, ... }, downsized_small { mp4 }, the stills
  // (fixed_width_still, original_still: { url } of a .gif). "480w_still" ({ url } of a .jpg) is in real answers but not
  // in the schema page, so it is used when present and the proxy covers its absence. All sizes are strings.
  item(d) {
    if (!d || typeof d !== "object" || typeof d.id !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(d.id)) return null;
    const im = d.images && typeof d.images === "object" ? d.images : {};
    const o = im.original || {};
    // the original clip unless it is big (every player downloads it), then the 200-pixel-high one
    const big = Number(o.mp4_size) > 2000000;
    const mp4 = mediaLink(big ? null : o.mp4, [".mp4"]) || mediaLink(im.fixed_height?.mp4, [".mp4"])
      || mediaLink(im.downsized_small?.mp4, [".mp4"]) || mediaLink(o.mp4, [".mp4"]);
    if (!mp4) return null;
    const stillGif = im.original_still?.url || im.fixed_width_still?.url || im.fixed_height_still?.url;
    const still = mediaLink(im["480w_still"]?.url, [".jpg"]) || viaProxy(stillGif, 480);
    const thumb = viaProxy(im.fixed_width_still?.url || im.fixed_height_still?.url || stillGif, 160) || still;
    if (!still || !thumb) return null;
    const w = num(o.width) || num(im.fixed_height?.width) || 1, h = num(o.height) || num(im.fixed_height?.height) || 1;
    return { id: d.id, title: cleanTitle(d.title), mp4, still, thumb, w, h };
  },
  // the answer's body -> { items, total } (pagination.total_count; missing on some answers)
  parse(body) {
    const data = Array.isArray(body?.data) ? body.data : [];
    const items = data.map((d) => giphy.item(d)).filter(Boolean).slice(0, PER_PAGE);
    const total = Number(body?.pagination?.total_count);
    return { items, total: Number.isFinite(total) ? total : null };
  },
  // an HTTP status other than 200 -> what the player is told ("rest": the hour limit is spent)
  problem(status) {
    if (status === 401 || status === 403) return { error: "The GIPHY key was refused: check it in the companion (Table tools)." };
    if (status === 429) return { rest: true };
    if (status === 414) return { error: "Fewer words, please (50 characters at most)." };
    return { error: `GIF search failed (GIPHY answered ${status}).` };
  },
};
const ADAPTERS = { giphy };

const restText = (ms) => { const n = Math.max(1, Math.ceil(ms / 60000)); return `GIF search is resting for ${n} minute${n === 1 ? "" : "s"}.`; };
const NO_KEY = "GIF frames need a GIPHY key: the host makes one, free, at developers.giphy.com (the steps: Get a GIPHY key, in the companion page's Table tools) and saves it there.";

// opts: fetch (as global fetch), now () -> ms, store { read() -> object|null, write(object) } for the keys (null: kept in
// memory only), envKey (a key from the environment, used when none is saved), hourLimit, log
function createGifs(opts = {}) {
  const now = opts.now || (() => Date.now());
  const log = opts.log || (() => {});
  const hourLimit = Number(opts.hourLimit) > 0 ? Number(opts.hourLimit) : HOUR_LIMIT;
  let keys = null; // provider -> key, read once from the store
  const calls = []; // provider call times (ms) within the last hour
  let restUntil = 0;
  const cache = new Map(); // "provider|rating|page|words" -> { at, items, total }

  function loadKeys() {
    if (keys) return keys;
    keys = {};
    let saved = null;
    try { saved = opts.store ? opts.store.read() : null; } catch (e) { log(`gif keys: can't read them (${e.message})`); }
    for (const p of PROVIDERS) {
      const k = saved && typeof saved[p] === "string" ? saved[p] : "";
      if (validKey(k)) keys[p] = k;
    }
    if (!keys.giphy && validKey(opts.envKey)) keys.giphy = opts.envKey;
    return keys;
  }
  function validKey(k) { return typeof k === "string" && /^[A-Za-z0-9]{16,64}$/.test(k); }
  const hasKey = (provider = "giphy") => !!loadKeys()[provider];

  // the companion's field: a key to keep, or "" to remove it. The message never repeats the key.
  function setKey(provider, key) {
    if (!PROVIDERS.includes(provider)) return { ok: false, message: `Unknown GIF provider "${String(provider).slice(0, 20)}".` };
    const k = String(key ?? "").trim();
    if (k && !validKey(k)) return { ok: false, message: "That doesn't look like a GIPHY key (16 to 64 letters and digits)." };
    loadKeys();
    if (k) keys[provider] = k; else delete keys[provider];
    cache.clear();
    if (opts.store) {
      try { opts.store.write({ ...keys }); } catch (e) { return { ok: false, message: `Couldn't save the key on this PC (${e.message}).` }; }
    }
    log(`gif keys: ${provider} key ${k ? "saved" : "removed"}`);
    return { ok: true, message: k ? "GIPHY key saved on this PC. The table's GIF frames are on." : "GIPHY key removed. The table's GIF frames go away." };
  }

  function prune(t) { while (calls.length && calls[0] <= t - HOUR_MS) calls.shift(); }
  // how long until a call may go out (0: now)
  function restingFor(t) {
    prune(t);
    if (restUntil > t) return restUntil - t;
    if (calls.length >= hourLimit) return calls[0] + HOUR_MS - t;
    return 0;
  }

  // GET /tools: never the key itself, only that one is set and its last four characters
  function state() {
    const k = loadKeys();
    const t = now();
    const out = { credit: giphy.credit, limit: hourLimit, used: (prune(t), calls.length), restingMin: Math.ceil(restingFor(t) / 60000) };
    for (const p of PROVIDERS) out[p] = k[p] ? { set: true, ends: k[p].slice(-4) } : { set: false };
    return out;
  }

  // { provider, q, page, rating } -> { items, credit, total, words, page, rating, cached } or { error }
  async function search(req = {}) {
    const provider = PROVIDERS.includes(req.provider) ? req.provider : "giphy";
    const ad = ADAPTERS[provider];
    const words = cleanWords(req.q), page = cleanPage(req.page), rating = cleanRating(req.rating);
    const base = { credit: ad.credit, words, page, rating };
    if (!hasKey(provider)) return { ...base, error: NO_KEY };
    if (!words) return { ...base, error: "Type some words to search for." };
    const t = now();
    const ck = `${provider}|${rating}|${page}|${words.toLowerCase()}`;
    const hit = cache.get(ck);
    if (hit && t - hit.at < CACHE_MS) return { ...base, items: hit.items, total: hit.total, cached: true };
    const wait = restingFor(t);
    if (wait > 0) return { ...base, error: restText(wait) };
    calls.push(t);
    let res, body;
    try {
      const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(FETCH_MS) : undefined;
      res = await opts.fetch(ad.searchUrl(loadKeys()[provider], words, page, rating), { headers: { Accept: "application/json" }, signal });
      if (res.ok) body = await res.json();
    } catch (e) {
      log(`gif search: ${e.message}`);
      return { ...base, error: "GIF search couldn't reach GIPHY. Try again in a moment." };
    }
    if (!res.ok) {
      const p = ad.problem(res.status);
      log(`gif search: HTTP ${res.status}`);
      if (p.rest) { restUntil = Math.max(restUntil, t + REST_429_MS); return { ...base, error: restText(REST_429_MS) }; }
      return { ...base, error: p.error };
    }
    const { items, total } = ad.parse(body);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(ck, { at: t, items, total });
    return { ...base, items, total };
  }

  return { search, setKey, hasKey, state, NO_KEY };
}

module.exports = { createGifs, giphy, cleanWords, cleanTitle, cleanRating, cleanPage, mediaLink, viaProxy, restText,
  PER_PAGE, RATINGS, DEFAULT_RATING, HOUR_LIMIT, CACHE_MS, WORDS_MAX };
