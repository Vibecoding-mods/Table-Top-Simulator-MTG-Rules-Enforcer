// Grades tests/test_gifs_golden.js (the bridge/gifs.js golden master) with tools/mutate-golden-lib.js: each mutation
// below is a plausible careless change, weighted to the host allowlist, the key's safety, the hour limit and the
// favourites file; the golden must go red on it by name.
//   node tools/mutate-gifs-golden.js [label pattern]
// First pass 2026-11-24: 38 of 43 caught (11.6%, SOUND). Of the 5 escapes, 4 are argued equivalent below and marked
// so; the fifth (the host pattern unanchored at the start: "xmedia.giphy.com") was a real hole, closed with rows.
// Second pass, after the gifs.js cleanup: 41 of 42 caught (2.4%); the escape (state() counting before the prune) was
// closed with a state() row after the hour runs out.
const path = require("path");
const { runMutations } = require("./mutate-golden-lib");

const ROOT = path.join(__dirname, "..");

// [label, from, to, equivalent?]: `from` must occur exactly once in gifs.js
const MUTATIONS = [
  ["mediaLink: host pattern unanchored at the end", "const MEDIA_HOST = /^(?:media\\d?|i)\\.giphy\\.com$/;", "const MEDIA_HOST = /^(?:media\\d?|i)\\.giphy\\.com/;"],
  ["mediaLink: host pattern unanchored at the start", "const MEDIA_HOST = /^(?:media\\d?|i)\\.giphy\\.com$/;", "const MEDIA_HOST = /(?:media\\d?|i)\\.giphy\\.com$/;"],
  ["mediaLink: http allowed", "if (url.protocol !== \"https:\" || !MEDIA_HOST", "if (!/^https?:$/.test(url.protocol) || !MEDIA_HOST"],
  ["mediaLink: port not checked", " || url.port || url.username", " || url.username"],
  ["mediaLink: user/password not checked", " || url.username || url.password) return null;", ") return null;"],
  ["mediaLink: '..' not checked", " || p.includes(\"..\") || ", " || "],
  ["mediaLink: extension case-sensitive", "p.toLowerCase().endsWith(e)", "p.endsWith(e)"],
  ["mediaLink: query kept", "return `https://${url.hostname}${p}`;", "return url.href;"],
  ["cleanWords: no length cap", "if (s.length > WORDS_MAX) s = s.slice(0, WORDS_MAX).trim();", ""],
  // (equivalent: at exactly 50 the cut keeps all 50 and the string is already trimmed)
  ["cleanWords: > becomes >= (EQUIVALENT)", "if (s.length > WORDS_MAX) s", "if (s.length >= WORDS_MAX) s", true],
  ["cleanTitle: quotes kept", "/[\\u0000-\\u001f\\u007f<>\"'&\\\\]/g", "/[\\u0000-\\u001f\\u007f<>&\\\\]/g"],
  ["cleanTitle: no ellipsis cut", "(s.length > TITLE_MAX ? s.slice(0, TITLE_MAX - 1).trimEnd() + \"…\" : s)", "s.slice(0, TITLE_MAX)"],
  ["cleanRating: case kept", "? String(r).toLowerCase() : DEFAULT_RATING", "? String(r) : DEFAULT_RATING"],
  ["cleanPage: no upper clamp", "Math.min(MAX_PAGE, Math.max(0, Math.floor(Number(p)) || 0))", "Math.max(0, Math.floor(Number(p)) || 0)"],
  ["num: no 4096 cap", "? Math.min(n, 4096) : null", "? n : null"],
  // (equivalent: num is private and every caller writes num(x) || fallback, so 0 and null both take the fallback)
  ["num: 0 allowed (EQUIVALENT)", "Number.isFinite(n) && n > 0 ?", "Number.isFinite(n) && n >= 0 ?", true],
  ["item: big threshold >=", "Number(o.mp4_size) > 2000000", "Number(o.mp4_size) >= 2000000"],
  ["item: id length unchecked", "!/^[A-Za-z0-9]{1,64}$/.test(d.id)) return null;", "!/^[A-Za-z0-9]+$/.test(d.id)) return null;"],
  ["parse: no 8 cap", ".filter(Boolean).slice(0, PER_PAGE);", ".filter(Boolean);"],
  ["problem: 403 not a refused key", "if (status === 401 || status === 403)", "if (status === 401)"],
  ["validKey: 15 characters accepted", "/^[A-Za-z0-9]{16,64}$/.test(k)", "/^[A-Za-z0-9]{15,64}$/.test(k)"],
  ["readStore: logs the error's message (key text)", "log(`${what}: can't read them (${(e && (e.code || e.name)) || \"unreadable\"})`)", "log(`${what}: can't read them (${(e && e.message) || \"unreadable\"})`)"],
  ["readStore: a failed read throws on", "catch (e) { log(`${what}: can't read them", "catch (e) { if (what) throw e; log(`${what}: can't read them"],
  ["search: the player's call not counted", "    if (req.who) whoList(req.who, t).push(t);\n", ""],
  ["state: used counted before the prune", "    const resting = restingFor(t); // (prunes the hour's calls first)\n    const out = { credit: giphy.credit, limit: hourLimit, used: calls.length, restingMin: Math.ceil(resting / 60000) };", "    const used = calls.length;\n    const out = { credit: giphy.credit, limit: hourLimit, used, restingMin: Math.ceil(restingFor(t) / 60000) };"],
  ["search: logs e.message (the link, with the key)", "log(`gif search: ${(e && e.name) || \"error\"}", "log(`gif search: ${(e && e.message) || \"error\"}"],
  ["setKey: cache not cleared", "    cache.clear();\n", "\n"],
  ["setKey: key not trimmed", "const k = String(key ?? \"\").trim();", "const k = String(key ?? \"\");"],
  ["state: whole key shown", "{ set: true, ends: k[p].slice(-4) }", "{ set: true, ends: k[p] }"],
  ["restingFor: >= becomes >", "if (calls.length >= hourLimit) return", "if (calls.length > hourLimit) return"],
  ["prune: <= becomes <", "calls[0] <= t - HOUR_MS", "calls[0] < t - HOUR_MS"],
  ["cache: day boundary < becomes <=", "if (hit && t - hit.at < CACHE_MS)", "if (hit && t - hit.at <= CACHE_MS)"],
  ["cache: key case-sensitive", "|${words.toLowerCase()}`;", "|${words}`;"],
  ["cache: an error is cached", "    if (!res.ok) {\n      const p = ad.problem(res.status);", "    if (!res.ok) {\n      cache.set(ck, { at: t, items: [], total: null });\n      const p = ad.problem(res.status);"],
  ["search: call counted after the fetch (order)", "    calls.push(t);\n    if (req.who)", "    if (req.who)"],
  // (equivalent: at exactly the gap the wait it returns is last + gap - t = 0, and search treats 0 as "go")
  ["whoWait: gap < becomes <= (EQUIVALENT)", "t - list[list.length - 1] < WHO_GAP_MS", "t - list[list.length - 1] <= WHO_GAP_MS", true],
  // (equivalent: a cap of 0 differs from 1 only on an empty list, where list[0] is undefined, the wait NaN, and
  // NaN > 0 is false, so the search goes either way; with one call or more both caps refuse with the same wait)
  ["whoWait: share floor dropped (EQUIVALENT)", "Math.max(1, Math.floor(hourLimit * WHO_SHARE))", "Math.floor(hourLimit * WHO_SHARE)", true],
  ["429: rest not taken", "if (p.rest) { restUntil = Math.max(restUntil, t + REST_429_MS); return", "if (p.rest) { return"],
  ["favWho: 4-digit Steam ID accepted", "/^\\d{5,20}$/.test(s)", "/^\\d{4,20}$/.test(s)"],
  ["stillLink: proxy '..' not checked", "PROXY_LINK.test(u) && !u.includes(\"..\") ? u", "PROXY_LINK.test(u) ? u"],
  ["favs load: duplicates kept", ".filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i).slice(0, max);", ".slice(0, max);"],
  ["favs star: full check > instead of >=", "if (l.length >= max) return { ok: false, full: true", "if (l.length > max) return { ok: false, full: true"],
  ["favs star: who not moved to the end", "    m.delete(who); // (re-added last", "    // (re-added last"],
  ["favs star: new star goes last", "      l.unshift(it);", "      l.push(it);"],
  ["favs page: last page not clamped", "const pg = Math.min(last, Math.max(0, Math.floor(Number(p)) || 0));", "const pg = Math.max(0, Math.floor(Number(p)) || 0);"],
  // (a cut that lands on a space leaves one at the end: the "49 w's then tail" row)
  ["cleanWords: trim after the cut dropped", "s = s.slice(0, WORDS_MAX).trim();", "s = s.slice(0, WORDS_MAX);"],
];

runMutations(path.join(ROOT, "bridge", "gifs.js"), path.join(ROOT, "tests", "test_gifs_golden.js"), MUTATIONS, process.argv[2]);
