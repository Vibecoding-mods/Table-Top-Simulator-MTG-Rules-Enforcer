// Golden-master runner for bridge/gifs.js. Two parts:
//  1. the pure functions (cleanWords, cleanTitle, cleanRating, cleanPage, mediaLink, viaProxy, restText, favItem,
//     favWho, giphy.searchUrl / item / parse / problem) on a grid heavy on the ugly end: null, wrong types, unicode,
//     control characters, both sides of every length and size boundary, lookalike hosts, ports, users, "..".
//  2. createGifs and createFavs scenarios on a frozen clock, a recording fetch and a recording key/favourites store:
//     every call's answer, every fetch (url and options), every store read and write (exact objects), every log line.
// A throw is recorded as its type and message. Shared by tools/capture_gifs_golden.js and tests/test_gifs_golden.js.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { enc } = require("./teams-run");

const MOD = path.join(__dirname, "..", "..", "bridge", "gifs.js");
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "gifs", "giphy-search.docs-shape.json"), "utf8"));
const KEY = "AbCdEf0123456789AbCdEf0123456789"; // (made up: the shape of a GIPHY key)
const KEY2 = "ZyXw98765432ZyXw";
const T0 = 1792500000000;

const call = (fn) => { try { return { result: enc(fn()) }; } catch (e) { return { threw: { type: e?.constructor?.name || typeof e, message: String(e?.message ?? e) } }; } };
async function acall(fn) { try { return { result: enc(await fn()) }; } catch (e) { return { threw: { type: e?.constructor?.name || typeof e, message: String(e?.message ?? e) } }; } }

function pureRows(G) {
  const rows = [];
  const add = (name, fn) => rows.push({ name, ...call(fn) });
  const long = "x".repeat(49), w50 = "y".repeat(50), w51 = "z".repeat(51);
  const words = [undefined, null, "", " ", "cat", "  mind   blown  ", "a\tb\nc\u0000d\u007fe", 0, 42, false, ["a", "b"], { toString: () => "obj" }, long, w50, w51, `${"w".repeat(49)} tail`,
    "ünïcödé 🎉 gif", "\u0085 sep", "a".repeat(200)];
  words.forEach((q, i) => add(`cleanWords #${i} ${JSON.stringify(q)?.slice(0, 30)}`, () => G.cleanWords(q)));
  const titles = [undefined, null, "", "   ", "Happy <b>yay</b> & \"q\" 'x' \\ end", "line1\nline2", "t".repeat(79), "t".repeat(80), "t".repeat(81), `${"t".repeat(78)} x yz`, `${"t".repeat(78)}    after`, 0, 12, "🎉".repeat(50), "\u0000\u001f"];
  titles.forEach((t, i) => add(`cleanTitle #${i} ${JSON.stringify(t)?.slice(0, 30)}`, () => G.cleanTitle(t)));
  for (const r of [undefined, null, "", "g", "G", "pg", "PG", "pg-13", "PG-13", "r", "R", " pg", 0, ["pg"]]) add(`cleanRating ${JSON.stringify(r)}`, () => G.cleanRating(r));
  for (const p of [undefined, null, "", "0", 0, 1, "3", 2.9, -1, -0.5, 49, 50, 51, 1e9, NaN, Infinity, -Infinity, "x", [2], true]) add(`cleanPage ${JSON.stringify(p)}${Number.isNaN(p) ? "NaN" : ""}${p === Infinity ? "Inf" : p === -Infinity ? "-Inf" : ""}`, () => G.cleanPage(p));
  const links = ["https://media.giphy.com/media/x/giphy.mp4", "https://media0.giphy.com/media/x/giphy.mp4", "https://media9.giphy.com/media/x/200.mp4", "https://media10.giphy.com/media/x/200.mp4",
    "https://i.giphy.com/x.mp4", "https://j.giphy.com/x.mp4", "https://giphy.com/x.mp4", "https://MEDIA.GIPHY.COM/media/x/giphy.mp4", "https://media.giphy.com/media/x/GIPHY.MP4",
    "http://media.giphy.com/media/x/giphy.mp4", "https://media.giphy.com:443/media/x/giphy.mp4", "https://media.giphy.com:8443/x/giphy.mp4", "https://u@media.giphy.com/x/giphy.mp4", "https://u:p@media.giphy.com/x/giphy.mp4",
    "https://evil.example.com/media/x/giphy.mp4", "https://media.giphy.com.evil.example/x.mp4", "https://notgiphy.com/x.mp4", "https://media.giphy.com/media/x/giphy.gif", "https://media.giphy.com/media/x/giphy.gif?x=.mp4",
    "https://media.giphy.com/media/x/giphy.mp4?cid=abc&rid=giphy.mp4", "https://media.giphy.com/media/x/giphy.mp4#frag", "https://media.giphy.com/media/../x/giphy.mp4", "https://media.giphy.com/media/%2e%2e/x/giphy.mp4",
    "https://media.giphy.com/media/a..b/giphy.mp4", "https://media.giphy.com/media/x y/giphy.mp4", "https://media.giphy.com/media/x/gi%70hy.mp4", "https://media.giphy.com/", "https://media.giphy.com",
    "https://media.giphy.com/.mp4", "//media.giphy.com/x.mp4", "media.giphy.com/x.mp4", "", null, undefined, 5, "javascript:alert(1)", "https://xmedia.giphy.com/x.mp4", "https://evil-i.giphy.com/x.mp4", "https://media.media2.giphy.com/x.mp4","https://media.giphy.com./x.mp4", "https://media.giphy.com/x.mp4\n"];
  for (const exts of [[".mp4"], [".jpg"], [".gif", ".jpg", ".webp"], []]) links.forEach((u, i) => add(`mediaLink ${exts.join("")} #${i} ${String(u).slice(0, 60)}`, () => G.mediaLink(u, exts)));
  add("mediaLink no exts argument", () => G.mediaLink("https://media.giphy.com/x.mp4"));
  for (const [u, s] of [["https://media.giphy.com/media/x/giphy_s.gif", 480], ["https://media.giphy.com/media/x/200w_s.gif", 160], ["https://media.giphy.com/media/x/s.webp", 160], ["https://media.giphy.com/media/x/s.jpg", 160],
    ["https://media.giphy.com/media/x/s.png", 160], ["https://evil.example.com/x.gif", 160], [null, 160], ["https://media.giphy.com/media/x/s.gif?a=1", undefined], ["https://media.giphy.com/media/x/s.gif", "9"]]) add(`viaProxy ${u} ${s}`, () => G.viaProxy(u, s));
  for (const ms of [0, 1, 59999, 60000, 60001, 119999, 120000, 900000, -5, NaN, 3600000]) add(`restText ${ms}`, () => G.restText(ms));
  add("giphy.credit", () => G.giphy.credit);
  for (const [k, w, p, r] of [[KEY, "cat", 0, "pg-13"], [KEY, "mind blown & more", 2, "g"], [KEY, "a=b?c#d", 50, "pg"], ["", "", 0, ""], [KEY, "ünï 🎉", 1, "pg-13"]]) add(`giphy.searchUrl ${w} ${p}`, () => G.giphy.searchUrl(k, w, p, r));
  for (const s of [200, 400, 401, 403, 404, 414, 429, 500, 503, 0, undefined, "401"]) add(`giphy.problem ${JSON.stringify(s)}`, () => G.giphy.problem(s));
  // items: the fixture's, then each documented piece broken in turn
  const base = FIX.data[0];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  FIX.data.forEach((d, i) => add(`giphy.item fixture #${i}`, () => G.giphy.item(d)));
  const variants = {
    null: null, string: "x", noId: { ...base, id: undefined }, numId: { ...base, id: 5 }, spaceId: { ...base, id: "a b" }, id64: { ...base, id: "a".repeat(64) }, id65: { ...base, id: "a".repeat(65) }, idEmpty: { ...base, id: "" },
    noImages: { id: "abc" }, imagesString: { id: "abc", images: "x" },
    big: (() => { const d = clone(base); d.images.original.mp4_size = "2000001"; return d; })(), at2mb: (() => { const d = clone(base); d.images.original.mp4_size = "2000000"; return d; })(),
    bigNoSmall: (() => { const d = clone(base); d.images.original.mp4_size = "9000000"; delete d.images.fixed_height; delete d.images.downsized_small; return d; })(),
    foreignMp4: (() => { const d = clone(base); d.images.original.mp4 = "https://evil.example.com/x.mp4"; return d; })(),
    noMp4Anywhere: (() => { const d = clone(base); for (const k of Object.keys(d.images)) if (d.images[k]) delete d.images[k].mp4; return d; })(),
    no480: (() => { const d = clone(base); delete d.images["480w_still"]; return d; })(),
    noStills: (() => { const d = clone(base); for (const k of ["480w_still", "original_still", "fixed_width_still", "fixed_height_still"]) delete d.images[k]; return d; })(),
    onlyFixedHeightStill: (() => { const d = clone(base); for (const k of ["480w_still", "original_still", "fixed_width_still"]) delete d.images[k]; return d; })(),
    foreign480: (() => { const d = clone(base); d.images["480w_still"] = { url: "https://evil.example.com/s.jpg" }; return d; })(),
    sizes0: (() => { const d = clone(base); d.images.original.width = "0"; d.images.original.height = "-3"; return d; })(),
    sizesHuge: (() => { const d = clone(base); d.images.original.width = "99999"; d.images.original.height = "4096.4"; return d; })(),
    sizesMissing: (() => { const d = clone(base); delete d.images.original.width; delete d.images.original.height; if (d.images.fixed_height) { delete d.images.fixed_height.width; delete d.images.fixed_height.height; } return d; })(),
    sizesHalf: (() => { const d = clone(base); d.images.original.width = "0.5"; d.images.original.height = "1.5"; return d; })(),
    titleBad: { ...base, title: "<script>\"x\"</script>\n" }, titleNone: { ...base, title: undefined },
  };
  for (const [k, d] of Object.entries(variants)) add(`giphy.item ${k}`, () => G.giphy.item(d));
  for (const [k, b] of Object.entries({ fixture: FIX, null: null, dataString: { data: "x" }, junk: { data: [null, 5, { id: "a b" }] }, twelve: { data: Array.from({ length: 12 }, () => base) },
    totalString: { data: [base], pagination: { total_count: "77" } }, totalBad: { data: [base], pagination: { total_count: "x" } }, totalNull: { data: [base], pagination: { total_count: null } }, noPagination: { data: [base] },
    totalInf: { data: [], pagination: { total_count: Infinity } } })) add(`giphy.parse ${k}`, () => G.giphy.parse(b));
  // favourites: an item from the table, and who it is kept under
  const it = G.giphy.item(base);
  const favs = { good: it, proxyStill: { ...it, still: "https://wsrv.nl/?url=media2.giphy.com/media/x/s.gif&w=480&h=480&fit=inside&output=jpg" },
    proxyDotDot: { ...it, still: "https://wsrv.nl/?url=media2.giphy.com/media/../s.gif&w=480&h=480&fit=inside&output=jpg" }, proxyOtherHost: { ...it, still: "https://wsrv.nl/?url=evil.example.com/s.gif&w=480&h=480&fit=inside&output=jpg" },
    proxyPng: { ...it, still: "https://wsrv.nl/?url=media2.giphy.com/x/s.gif&w=480&h=480&fit=inside&output=png" }, proxyW5: { ...it, still: "https://wsrv.nl/?url=media2.giphy.com/x/s.gif&w=12345&h=480&fit=inside&output=jpg" },
    noThumb: { ...it, thumb: undefined }, badThumb: { ...it, thumb: "https://evil.example.com/t.jpg" }, badMp4: { ...it, mp4: "https://evil.example.com/x.mp4" }, noStill: { ...it, still: null },
    badId: { ...it, id: "x/y" }, numId: { ...it, id: 7 }, badSize: { ...it, w: "abc", h: -1 }, bigSize: { ...it, w: 5000, h: "4096" }, title: { ...it, title: "<a>" }, extra: { ...it, key: KEY, secret: 1 },
    null: null, string: "x", stillQuery: { ...it, still: "https://media2.giphy.com/media/x/480w_s.jpg?cid=1" } };
  for (const [k, v] of Object.entries(favs)) add(`favItem ${k}`, () => G.favItem(v));
  for (const [s, c] of [["76561198000000000", "White"], ["1234", "Red"], ["12345", "Red"], ["1".repeat(20), "Red"], ["1".repeat(21), "Red"], [76561198000000000, "Blue"], [null, "Green"], [undefined, "Yellow"],
    ["", "Pink"], [" 76561198000000000", "Red"], ["abc", "Te-al 9"], [null, "VeryLongColourNameHere"], [null, null], [null, undefined], ["123456", ""], [null, "<x>"]]) add(`favWho ${JSON.stringify(s)} ${JSON.stringify(c)}`, () => G.favWho(s, c));
  const consts = {};
  for (const k of ["PER_PAGE", "RATINGS", "DEFAULT_RATING", "HOUR_LIMIT", "CACHE_MS", "WORDS_MAX", "FAV_MAX"]) consts[k] = G[k];
  rows.unshift({ name: "surface", result: enc(Object.keys(G).sort().map((k) => [k, typeof G[k], typeof G[k] === "function" ? G[k].length : null])), consts: enc(consts) });
  return rows;
}

// a fetch that answers by the words in the link: a status, a body, a throw, or the fixture
function makeFetch(rec, plan = {}) {
  return async (url, init) => {
    const u = new URL(String(url));
    const q = u.searchParams.get("q");
    rec.push({ fetch: String(url), headers: enc(init?.headers), signal: init?.signal ? typeof init.signal : null });
    const p = plan[q];
    if (p === "down") { const e = new TypeError(`fetch failed for ${url}`); e.cause = { code: "ECONNREFUSED" }; throw e; }
    if (p === "downPlain") throw new Error(`boom ${url}`);
    if (p === "badJson") return { ok: true, status: 200, json: async () => { throw new SyntaxError(`Unexpected token in ${url}`); } };
    if (typeof p === "number") return { ok: false, status: p, json: async () => ({}) };
    if (p && typeof p === "object") return { ok: true, status: 200, json: async () => p };
    return { ok: true, status: 200, json: async () => FIX };
  };
}
// a key or favourites store: what read gives, whether read / write throw, every call recorded
function makeStore(rec, tag, o = {}) {
  let saved = o.saved === undefined ? null : JSON.parse(JSON.stringify(o.saved));
  return {
    read() { rec.push({ [`${tag}.read`]: 1 }); if (o.readThrows) { const e = o.readThrows === "syntax" ? new SyntaxError(`Unexpected token ${KEY}`) : Object.assign(new Error(`EACCES ${KEY}`), { code: "EACCES" }); throw e; } return saved; },
    write(obj) { rec.push({ [`${tag}.write`]: enc(obj) }); if (o.writeThrows) throw new Error("disk full"); saved = JSON.parse(JSON.stringify(obj)); },
  };
}

// a scenario: steps run in order, each [label, (ctx) => value], with the clock moved by ctx.tick(ms)
function gifScenarios(G) {
  const S = [];
  const sc = (name, o, steps) => S.push({ name, o, steps });
  const s = (q, extra = {}) => (c) => c.g.search({ q, ...extra });
  const tick = (ms) => (c) => { c.t += ms; return c.t - T0; };
  sc("no key at all", {}, [["hasKey", (c) => c.g.hasKey()], ["state", (c) => c.g.state()], ["search", s("cat")], ["NO_KEY", (c) => c.g.NO_KEY]]);
  sc("env key used when none saved", { envKey: KEY }, [["hasKey", (c) => c.g.hasKey("giphy")], ["state", (c) => c.g.state()], ["search", s("cat")]]);
  sc("env key too short refused", { envKey: "short1234" }, [["hasKey", (c) => c.g.hasKey()]]);
  sc("env key 16 chars ok", { envKey: "a".repeat(16) }, [["hasKey", (c) => c.g.hasKey()]]);
  sc("env key 15 chars refused", { envKey: "a".repeat(15) }, [["hasKey", (c) => c.g.hasKey()]]);
  sc("env key 64 ok / 65 refused", { envKey: "b".repeat(65) }, [["hasKey 65", (c) => c.g.hasKey()]]);
  sc("env key 64 chars ok", { envKey: "b".repeat(64) }, [["hasKey 64", (c) => c.g.hasKey()]]);
  sc("saved key wins over env", { envKey: KEY, keyStore: { saved: { giphy: KEY2 } } }, [["state", (c) => c.g.state()], ["search", s("dog")]]);
  sc("saved key invalid falls back to env", { envKey: KEY, keyStore: { saved: { giphy: "bad key!" } } }, [["state", (c) => c.g.state()]]);
  sc("saved key not a string", { keyStore: { saved: { giphy: 12345678901234567890 } } }, [["hasKey", (c) => c.g.hasKey()]]);
  sc("store read throws with a code (logged, key not quoted)", { keyStore: { readThrows: "code" }, envKey: KEY }, [["hasKey", (c) => c.g.hasKey()], ["hasKey again (read once)", (c) => c.g.hasKey()]]);
  sc("store read throws SyntaxError (name logged)", { keyStore: { readThrows: "syntax" } }, [["hasKey", (c) => c.g.hasKey()]]);
  sc("store gives a non-object", { keyStore: { saved: "x" } }, [["hasKey", (c) => c.g.hasKey()]]);
  sc("setKey paths", { keyStore: {} }, [["unknown provider", (c) => c.g.setKey("klipy", KEY)], ["long unknown provider", (c) => c.g.setKey("x".repeat(40), KEY)], ["bad key", (c) => c.g.setKey("giphy", "not a key")],
    ["spaces trimmed", (c) => c.g.setKey("giphy", `  ${KEY}  `)], ["state", (c) => c.g.state()], ["null key removes", (c) => c.g.setKey("giphy", null)], ["state after remove", (c) => c.g.state()],
    ["empty removes again", (c) => c.g.setKey("giphy", "")], ["set again", (c) => c.g.setKey("giphy", KEY2)], ["hasKey", (c) => c.g.hasKey()]]);
  sc("setKey with no store", {}, [["set", (c) => c.g.setKey("giphy", KEY)], ["hasKey", (c) => c.g.hasKey()]]);
  sc("setKey store write throws", { keyStore: { writeThrows: true } }, [["set", (c) => c.g.setKey("giphy", KEY)], ["hasKey (kept in memory)", (c) => c.g.hasKey()]]);
  sc("setKey clears the cache", { envKey: KEY }, [["first", s("cat")], ["cached", s("cat")], ["set", (c) => c.g.setKey("giphy", KEY2)], ["refetched", s("cat")]]);
  sc("search words, page and rating as sent", { envKey: KEY }, [["blank words", s("   ")], ["control chars", s("a\nb", { page: "3", rating: "PG" })], ["long words", s("q".repeat(60), { page: 99, rating: "r" })],
    ["provider unknown goes to giphy", s("cat", { provider: "klipy", page: -2 })]]);
  sc("cache: same words other case, then the day boundary", { envKey: KEY }, [["first", s("Mind Blown")], ["same lower", s("mind blown")], ["other page", s("mind blown", { page: 1 })], ["other rating", s("mind blown", { rating: "g" })],
    ["+day-1ms", tick(24 * 3600 * 1000 - 1)], ["still cached", s("MIND BLOWN")], ["+1ms", tick(1)], ["expired", s("mind blown")]]);
  sc("hour limit 3: the fourth rests, then the hour boundary", { envKey: KEY, hourLimit: 3 }, [["a", s("a")], ["b", s("b")], ["c", s("c")], ["d rests", s("d")], ["cached a still works", s("a")], ["state", (c) => c.g.state()],
    ["+1h-1ms", tick(3600 * 1000 - 1)], ["d still rests", s("d")], ["+1ms", tick(1)], ["state after the hour, before a search", (c) => c.g.state()], ["d goes", s("d")], ["state", (c) => c.g.state()]]);
  sc("hourLimit bad values", { envKey: KEY, hourLimit: "x" }, [["state", (c) => c.g.state()]]);
  sc("hourLimit 0 is the default", { envKey: KEY, hourLimit: 0 }, [["state", (c) => c.g.state()]]);
  sc("who: gap and share", { envKey: KEY, hourLimit: 10 }, [["w1", s("w1", { who: "Red" })], ["+1999", tick(1999)], ["w2 too soon", s("w2", { who: "Red" })], ["other player fine", s("b2", { who: "Blue" })],
    ["+1", tick(1)], ["w2 now", s("w2", { who: "Red" })], ["+2000", tick(2000)], ["w3", s("w3", { who: "Red" })], ["+2000", tick(2000)], ["w4", s("w4", { who: "Red" })], ["+2000", tick(2000)], ["w5 share spent", s("w5", { who: "Red" })],
    ["cached w1 still fine", s("w1", { who: "Red" })], ["no who is fine", s("w5")], ["+1h", tick(3600 * 1000)], ["w6 after the hour", s("w6", { who: "Red" })]]);
  sc("who: share at least 1 with a limit of 1", { envKey: KEY, hourLimit: 1 }, [["a", s("a", { who: "Red" })], ["+5000", tick(5000)], ["b rests (table limit first)", s("b", { who: "Red" })]]);
  sc("who: share at hourLimit 2 is 1", { envKey: KEY, hourLimit: 2 }, [["a", s("a", { who: "Red" })], ["+5000", tick(5000)], ["b share", s("b", { who: "Red" })], ["c other", s("c", { who: "Blue" })]]);
  sc("HTTP answers", { envKey: KEY, plan: { k401: 401, k403: 403, k414: 414, k500: 500, k404: 404 } }, [["401", s("k401")], ["403", s("k403")], ["414", s("k414")], ["500", s("k500")], ["404", s("k404")], ["500 not cached", s("k500")]]);
  sc("429 rests 15 minutes", { envKey: KEY, plan: { busy: 429 } }, [["busy", s("busy")], ["other rests", s("cat")], ["state", (c) => c.g.state()], ["+15m-1", tick(15 * 60000 - 1)], ["still", s("cat")], ["+1", tick(1)], ["goes", s("cat")]]);
  sc("network down / bad json (logs never the link)", { envKey: KEY, plan: { down: "down", plain: "downPlain", bad: "badJson" } }, [["down", s("down")], ["plain", s("plain")], ["bad json", s("bad")], ["state (calls counted)", (c) => c.g.state()]]);
  const usable = FIX.data[0];
  sc("answers that change shape", { envKey: KEY, plan: { none: { data: [{ id: "x y" }, null] }, empty: { data: [] }, nodata: { meta: {} }, one: { data: [usable], pagination: { total_count: 1 } } } }, [["none usable (logged)", s("none")], ["empty (not logged)", s("empty")], ["no data", s("nodata")], ["one", s("one")]]);
  sc("cache holds 300", { envKey: KEY, hourLimit: 10000 }, [["bulk: fill 301", async (c) => { for (let i = 0; i < 301; i++) await c.g.search({ q: `w${i}` }); return c.rec.length; }], ["w0 refetched", s("w0")], ["w2 cached", s("w2")], ["w1 evicted after w0 came back", s("w1")]]);
  return S;
}

function favScenarios(G) {
  const it = G.giphy.item(FIX.data[0]);
  const items = FIX.data.map((d) => G.giphy.item(d)).filter(Boolean);
  const mk = (i) => ({ ...it, id: `id${i}`, title: `Item ${i}` });
  const S = [];
  const sc = (name, o, steps) => S.push({ name, o, steps });
  sc("empty, memory only", {}, [["page", (c) => c.f.page("R", 0)], ["list", (c) => c.f.list("R")], ["MAX", (c) => c.f.MAX], ["unstar unknown", (c) => c.f.star("R", { id: "zz" }, false)]]);
  sc("load cleans the file", { favStore: { saved: { version: 1, players: { A: [it, it, { ...it, mp4: "https://evil.example.com/x.mp4" }, null, "x", items[1]], B: "notalist", C: [], D: [{ id: "bad id" }] } } } },
    [["A", (c) => c.f.list("A")], ["B", (c) => c.f.list("B")], ["C", (c) => c.f.list("C")], ["D", (c) => c.f.list("D")]]);
  sc("load: players not an object", { favStore: { saved: { players: "x" } } }, [["A", (c) => c.f.list("A")]]);
  sc("load: read throws", { favStore: { readThrows: "code" } }, [["A", (c) => c.f.list("A")], ["star still works", (c) => c.f.star("A", it, true)]]);
  sc("load: more than max kept to max", { max: 3, favStore: { saved: { players: { A: [mk(1), mk(2), mk(3), mk(4), mk(5)] } } } }, [["A", (c) => c.f.list("A").map((x) => x.id)]]);
  sc("star, unstar, full, bad item", { max: 2, favStore: {} }, [["star 1", (c) => c.f.star("R", mk(1), true)], ["star 1 again", (c) => c.f.star("R", mk(1), true)], ["star 2", (c) => c.f.star("R", mk(2), true)],
    ["star 3 full", (c) => c.f.star("R", mk(3), true)], ["list", (c) => c.f.list("R").map((x) => x.id)], ["bad item", (c) => c.f.star("R", { id: "x y" }, true)], ["null item", (c) => c.f.star("R", null, true)],
    ["unstar 1", (c) => c.f.star("R", { id: "id1" }, false)], ["unstar 2 (empties)", (c) => c.f.star("R", mk(2), false)], ["list", (c) => c.f.list("R")], ["unstar null item", (c) => c.f.star("R", null, false)]]);
  sc("pages", { favStore: {} }, [["bulk: star 17", (c) => { for (let i = 0; i < 17; i++) c.f.star("R", mk(i), true); return c.f.list("R").length; }],
    ...[undefined, null, -1, 0, 1, 2, 3, 99, "1", 1.7, NaN].map((p) => [`page ${String(p)}`, (c) => c.f.page("R", p)])]);
  sc("page on exactly 8", { favStore: {} }, [["bulk: star 8", (c) => { for (let i = 0; i < 8; i++) c.f.star("R", mk(i), true); return 8; }], ["page 1", (c) => c.f.page("R", 1)]]);
  sc("who order: re-added last, oldest evicted past 500", { favStore: {} }, [["bulk: star 501 players", (c) => { for (let i = 0; i < 501; i++) c.f.star(`w${i}`, it, true); return [c.f.list("w0").length, c.f.list("w1").length, c.f.list("w500").length]; }],
    ["bulk: w1 stars again, w2 is now oldest", (c) => { c.f.star("w1", mk(9), true); c.f.star("x", it, true); return [c.f.list("w1").length, c.f.list("w2").length]; }]]);
  sc("write throws (logged, answer ok)", { favStore: { writeThrows: true } }, [["star", (c) => c.f.star("R", it, true)], ["list", (c) => c.f.list("R").length]]);
  sc("max option bad", { max: "x" }, [["MAX", (c) => c.f.MAX]]);
  return S;
}

async function runScenario(G, kind, S) {
  const rec = [];
  const c = { t: T0, rec };
  const log = (l) => rec.push({ log: l });
  const o = S.o;
  if (kind === "gifs") {
    c.g = G.createGifs({ fetch: makeFetch(rec, o.plan), now: () => c.t, store: o.keyStore ? makeStore(rec, "keys", o.keyStore) : undefined, envKey: o.envKey, hourLimit: o.hourLimit, log });
  } else {
    c.f = G.createFavs({ store: o.favStore ? makeStore(rec, "favs", o.favStore) : undefined, log, max: o.max });
  }
  for (const [label, fn] of S.steps) {
    const at = rec.length;
    const r = await acall(() => fn(c));
    // (a bulk step's records are many: kept as their count and a sha256 of them all, so every one is still pinned)
    if (label.startsWith("bulk")) { const mine = rec.splice(at); rec.push({ bulk: mine.length, sha256: crypto.createHash("sha256").update(JSON.stringify(mine)).digest("hex") }); }
    rec.push({ step: label, ...r });
  }
  return { name: `${kind}: ${S.name}`, effects: rec };
}

async function runAll() {
  delete require.cache[require.resolve(MOD)];
  const G = require(MOD);
  const out = pureRows(G);
  for (const S of gifScenarios(G)) out.push(await runScenario(G, "gifs", S));
  for (const S of favScenarios(G)) out.push(await runScenario(G, "favs", S));
  // the key must appear in no log line of any scenario (gifs.js's own claim: never e.message, only codes)
  const leaks = out.filter((r) => (r.effects || []).some((e) => e.log && (e.log.includes(KEY) || e.log.includes(KEY2)))).map((r) => r.name);
  out.push({ name: "no log line holds a key", result: leaks });
  // (two cases of one name would hide one of them from the test's lookup by name)
  const seen = new Map();
  for (const r of out) { const n = (seen.get(r.name) || 0) + 1; seen.set(r.name, n); if (n > 1) r.name += ` #${n}`; }
  return out;
}

module.exports = { runAll };
