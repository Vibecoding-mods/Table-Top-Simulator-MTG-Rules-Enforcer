// GIF frames, the bridge side (docs/gif-frames-spec.md): the GIPHY adapter (bridge/gifs.js) and the bridge's gif_*
// messages and gif-key tool (bridge/bridge.js, "GIF frames" block).
// The GIPHY answer is tests/fixtures/gifs/giphy-search.docs-shape.json: written from GIPHY's API docs, NOT recorded
// (the host had no key yet). These tests check our reading of the documented shape; re-record the fixture with a real
// key before trusting them about GIPHY itself.
//   node tests/test_bridge_gifs.js
const path = require("path");
const fs = require("fs");
const G = require("../bridge/gifs");
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${typeof why === "string" ? why : JSON.stringify(why)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "gifs", "giphy-search.docs-shape.json"), "utf8"));
const KEY = "AbCdEf0123456789AbCdEf0123456789"; // (made up: 32 letters and digits, the shape of a GIPHY key)

// a fetch that answers GIPHY's search with the fixture (or a status), counting calls
function fakeFetch(status = 200, body = FIX) {
  const f = async (url) => { f.calls.push(String(url)); if (status === "down") throw new TypeError("fetch failed"); return { ok: status === 200, status, json: async () => body }; };
  f.calls = [];
  return f;
}
function gifsWith(o = {}) {
  let t = 1792500000000;
  const fetch = o.fetch || fakeFetch();
  const g = G.createGifs({ fetch, now: () => t, hourLimit: o.hourLimit, store: o.store, envKey: o.envKey });
  return { g, fetch, tick: (ms) => { t += ms; } };
}

(async () => {
  // ── the adapter on the documented answer
  {
    const u = new URL(G.giphy.searchUrl(KEY, "mind blown & more", 2, "pg-13"));
    same("url: GIPHY's search endpoint over https", [u.protocol, u.host, u.pathname], ["https:", "api.giphy.com", "/v1/gifs/search"]);
    same("url: key, words, 8 a page, the page's offset, rating", ["api_key", "q", "limit", "offset", "rating"].map((k) => u.searchParams.get(k)), [KEY, "mind blown & more", "8", "16", "pg-13"]);

    const { items, total } = G.giphy.parse(FIX);
    same("parse: the playable items, in order (no mp4 and another host's link dropped)", items.map((i) => i.id), ["26ufdipQqU2lhNA4g", "3o7abKhOpu0NwenH3O", "13CoXDiaCcCoyk"]);
    ok("parse: total_count read", total === 1234, total);
    const [a, b, c] = items;
    same("parse: the original mp4, its query taken off", a.mp4, "https://media2.giphy.com/media/26ufdipQqU2lhNA4g/giphy.mp4");
    same("parse: the 480w still (.jpg) when the answer has it", a.still, "https://media2.giphy.com/media/26ufdipQqU2lhNA4g/480w_s.jpg");
    same("parse: the thumb is the small still as a .jpg through the proxy", a.thumb, "https://wsrv.nl/?url=media2.giphy.com/media/26ufdipQqU2lhNA4g/200w_s.gif&w=160&h=160&fit=inside&output=jpg");
    same("parse: size from original (strings in the docs)", [a.w, a.h, b.w, b.h], [200, 200, 480, 360]);
    same("parse: no 480w still: the original still through the proxy at 480", b.still, "https://wsrv.nl/?url=media0.giphy.com/media/3o7abKhOpu0NwenH3O/giphy_s.gif&w=480&h=480&fit=inside&output=jpg");
    same("parse: a title loses what breaks the table's XML", b.title, "Happy Spongebob Squarepants yay");
    same("parse: an original over 2 MB: the 200-high clip instead", c.mp4, "https://media1.giphy.com/media/13CoXDiaCcCoyk/200.mp4");
    same("parse: garbage answers give nothing", [G.giphy.parse(null).items, G.giphy.parse({ data: "x" }).items, G.giphy.parse({ data: [null, 5, { id: "a b" }] }).items], [[], [], []]);
    same("parse: never more than 8", G.giphy.parse({ data: Array.from({ length: 12 }, () => FIX.data[0]) }).items.length, 8);
  }

  // ── links, words and ratings
  {
    const L = (u) => G.mediaLink(u, [".mp4"]);
    ok("link: GIPHY media hosts pass", ["https://media.giphy.com/media/x/giphy.mp4", "https://media4.giphy.com/media/x/200.mp4", "https://i.giphy.com/x.mp4"].every((u) => L(u)));
    ok("link: http refused", L("http://media.giphy.com/media/x/giphy.mp4") === null);
    ok("link: another host refused (even one ending in giphy.com)", L("https://evil.example.com/media/x/giphy.mp4") === null && L("https://media.giphy.com.evil.example/x.mp4") === null && L("https://notgiphy.com/x.mp4") === null);
    ok("link: a port or a user refused", L("https://media.giphy.com:8443/x/giphy.mp4") === null && L("https://u:p@media.giphy.com/x/giphy.mp4") === null);
    ok("link: the wrong file type refused (also hidden in the query)", L("https://media.giphy.com/media/x/giphy.gif") === null && L("https://media.giphy.com/media/x/giphy.gif?x=.mp4") === null);
    ok("link: odd characters in the path refused", L("https://media.giphy.com/media/x%22y/giphy.mp4") === null && L("https://media.giphy.com/media/x'y/giphy.mp4") === null);
    same("words: one line, spaces collapsed", G.cleanWords("  cat\n\tdance \u0007 party  "), "cat dance party");
    same("words: 50 characters at most", G.cleanWords("x".repeat(70)).length, 50);
    same("rating: g, pg and pg-13 kept; r and nonsense fall back to pg-13", ["g", "PG", "pg-13", "r", "", null].map(G.cleanRating), ["g", "pg", "pg-13", "pg-13", "pg-13", "pg-13"]);
    same("page: whole, 0 to 50", [-3, 2.7, "4", 999, NaN].map(G.cleanPage), [0, 2, 4, 50, 0]);
    same("rest text: minutes, rounded up, at least one", [G.restText(1000), G.restText(61000), G.restText(3600000)], ["GIF search is resting for 1 minute.", "GIF search is resting for 2 minutes.", "GIF search is resting for 60 minutes."]);
  }

  // ── keys
  {
    const { g, fetch } = gifsWith();
    const r = await g.search({ q: "cat" });
    ok("no key: told how to get one, nothing fetched", /developers\.giphy\.com/.test(r.error) && fetch.calls.length === 0, r);
    ok("no key: hasKey false", g.hasKey("giphy") === false);
    const bad = g.setKey("giphy", "not a key!");
    ok("key: a malformed one is refused", bad.ok === false && !bad.message.includes("not a key"), bad);
    ok("key: an unknown provider is refused", g.setKey("klipy", KEY).ok === false);
    const good = g.setKey("giphy", `  ${KEY}  `);
    ok("key: a good one is kept, the message never repeats it", good.ok === true && !good.message.includes(KEY), good);
    const st = g.state();
    ok("state: set, its last four, never the key", st.giphy.set === true && st.giphy.ends === "6789" && !JSON.stringify(st).includes(KEY), st);
    ok("key: removed with an empty one", g.setKey("giphy", "").ok === true && g.hasKey() === false && g.state().giphy.set === false);
    // the store: written on set, read once
    let saved = null;
    const store = { read: () => saved, write: (k) => { saved = JSON.parse(JSON.stringify(k)); } };
    gifsWith({ store }).g.setKey("giphy", KEY);
    same("store: the key is written as { giphy }", saved, { giphy: KEY });
    ok("store: a new bridge reads it", gifsWith({ store }).g.hasKey("giphy") === true);
    saved = { giphy: "short" };
    ok("store: a malformed saved key is ignored", gifsWith({ store }).g.hasKey("giphy") === false);
    ok("env: a key from the environment counts when none is saved", gifsWith({ store, envKey: KEY }).g.hasKey("giphy") === true);
    const broken = { read: () => { throw new Error("disk"); }, write: () => { throw new Error("read-only"); } };
    const gb = gifsWith({ store: broken }).g;
    ok("store: an unreadable store means no key, no crash", gb.hasKey() === false);
    ok("store: an unwritable store says so", /Couldn't save/.test(gb.setKey("giphy", KEY).message));
  }

  // ── searching: cache, hour limit, the provider's refusals
  {
    const { g, fetch, tick } = gifsWith({ hourLimit: 3 });
    g.setKey("giphy", KEY);
    const r1 = await g.search({ q: "Cat", page: 0, rating: "pg" });
    ok("search: items, the credit, the words and page used", r1.items?.length === 3 && r1.credit === "Powered By GIPHY" && r1.words === "Cat" && r1.page === 0 && r1.rating === "pg", r1);
    ok("search: the call carries the key, words and rating", fetch.calls.length === 1 && fetch.calls[0].includes(`api_key=${KEY}`) && fetch.calls[0].includes("q=Cat") && fetch.calls[0].includes("rating=pg&"), fetch.calls);
    const r2 = await g.search({ q: "  cat ", page: 0, rating: "pg" });
    ok("cache: the same words (any case and spacing) cost no call", r2.cached === true && fetch.calls.length === 1);
    await g.search({ q: "cat", page: 1, rating: "pg" });
    await g.search({ q: "cat", page: 0, rating: "g" });
    ok("cache: another page or rating is another call", fetch.calls.length === 3, fetch.calls.length);
    const r5 = await g.search({ q: "dog" });
    ok("hour limit: past it, resting for the minutes left, no call", /resting for 60 minutes/.test(r5.error || "") && fetch.calls.length === 3, r5);
    ok("hour limit: a cached search still answers", (await g.search({ q: "cat", page: 0, rating: "pg" })).items.length === 3);
    ok("state: the calls used and the rest", g.state().used === 3 && g.state().restingMin === 60, g.state());
    tick(3600 * 1000 + 1);
    ok("hour limit: an hour later it searches again", (await g.search({ q: "dog" })).items?.length === 3 && fetch.calls.length === 4);
    tick(24 * 3600 * 1000);
    await g.search({ q: "dog" });
    ok("cache: a day later the words are asked again", fetch.calls.length === 5, fetch.calls.length);
    ok("search: empty words refused without a call", /Type some words/.test((await g.search({ q: "  " })).error) && fetch.calls.length === 5);
  }
  {
    const f429 = fakeFetch(429);
    const { g, tick } = gifsWith({ fetch: f429 });
    g.setKey("giphy", KEY);
    const r = await g.search({ q: "a" });
    ok("429: GIPHY's own limit rests the search 15 minutes", /resting for 15 minutes/.test(r.error || ""), r);
    await g.search({ q: "b" });
    ok("429: no call while resting", f429.calls.length === 1);
    tick(15 * 60 * 1000 + 1);
    await g.search({ q: "b" });
    ok("429: asked again after the rest", f429.calls.length === 2);
  }
  {
    const errs = {};
    for (const s of [401, 403, 414, 500, "down"]) {
      const { g } = gifsWith({ fetch: fakeFetch(s) });
      g.setKey("giphy", KEY);
      errs[s] = (await g.search({ q: "a" })).error;
    }
    ok("401/403: the key was refused, check it in the companion", /key was refused/.test(errs[401]) && /key was refused/.test(errs[403]), errs);
    ok("414: fewer words", /Fewer words/.test(errs[414]), errs);
    ok("500: the status named", /answered 500/.test(errs[500]), errs);
    ok("network down: couldn't reach GIPHY", /couldn't reach GIPHY/.test(errs.down), errs);
    ok("no error repeats the key", !Object.values(errs).some((e) => String(e).includes(KEY)));
  }

  // ── the bridge: gif_* messages and the gif-key tool (bridge.js "GIF frames" block)
  {
    const h = harness.load();
    const tts = () => h.effects.filter((e) => e.tts).map((e) => e.tts);
    const B = h.B;
    B.onTTS({ t: "gif_hello", json: "{}" });
    await h.flush();
    const c0 = tts().find((m) => m.t === "gif_config");
    ok("bridge: hello without a key: frames off, told why", c0 && c0.on === false && /developers\.giphy\.com/.test(c0.why), c0);
    B.onTTS({ t: "hello", json: JSON.stringify({ stamp: "dev" }) });
    await h.flush();
    ok("bridge: the table's hello without a key: no gif_config (nothing new for a table without one)", tts().filter((m) => m.t === "gif_config").length === 1, tts().map((m) => m.t));
    const r = B.onToolsPost({ kind: "gif-key", provider: "giphy", key: KEY });
    await h.flush();
    ok("bridge: the gif-key tool saves it", r.ok === true && !r.message.includes(KEY), r);
    const c1 = tts().filter((m) => m.t === "gif_config").pop();
    ok("bridge: the table is told its frames are on", c1 && c1.on === true && c1.credit === "Powered By GIPHY", c1);
    B.onTTS({ t: "hello", json: JSON.stringify({ stamp: "dev", again: true }) });
    await h.flush();
    ok("bridge: the table's hello with a key: told its frames are on", tts().filter((m) => m.t === "gif_config" && m.on).length === 2, tts().map((m) => m.t));
    const ts = B.toolsState();
    ok("bridge: GET /tools shows the key is set, never the key", ts.gifs?.giphy?.set === true && !JSON.stringify(ts).includes(KEY), ts.gifs);
    const f = fakeFetch();
    global.fetch = f;
    B.onTTS({ t: "gif_search", json: JSON.stringify({ color: "Blue", q: "cat", page: 1, rating: "g", req: 7, first: true }) });
    await h.flush();
    const res = tts().find((m) => m.t === "gif_results");
    ok("bridge: a search answers that colour, with its req and first", res && res.color === "Blue" && res.req === 7 && res.first === true && res.page === 1 && res.items.length === 3 && res.error === null, res);
    ok("bridge: the search went to GIPHY with the table's rating", f.calls.length === 1 && f.calls[0].includes("rating=g&") && f.calls[0].includes("offset=8"), f.calls);
    const n = tts().length;
    B.onTTS({ t: "gif_search", json: JSON.stringify({ color: "Grey", q: "cat" }) });
    B.onTTS({ t: "gif_search", json: JSON.stringify({ q: "cat" }) });
    await h.flush();
    ok("bridge: a spectator's or a colourless search gets nothing", tts().length === n && f.calls.length === 1);
    B.onTTS({ t: "gif_pick", json: JSON.stringify({ color: "Blue", id: "26ufdipQqU2lhNA4g", title: "Mind <Blown>" }) });
    await h.flush();
    const lines = h.effects.filter((e) => e.appendFile === "table-log.log").map((e) => e.text);
    ok("bridge: a pick is one table-log line", lines.filter((l) => /Blue\s+shows a GIF: Mind Blown/.test(l)).length === 1, lines);
    ok("bridge: searches and the hello aren't table-log lines", !lines.some((l) => /gif_search|gif_hello|gif_pick/.test(l)), lines);
    ok("bridge: the key is in no log, file or table message", !JSON.stringify(h.effects).includes(KEY));
    const bad = B.onToolsPost({ kind: "gif-key", key: "x" });
    ok("bridge: a bad key is refused and the table not told", bad.ok === false && tts().filter((m) => m.t === "gif_config").length === 3, bad);
    // a search that throws after its first await is logged, never an unhandled rejection (Node would end the bridge)
    const realSearch = B._gifs.search;
    B._gifs.search = async () => { await null; throw new Error("boom in search"); };
    let rejected = null;
    const unhandled = (e) => { rejected = e; };
    process.on("unhandledRejection", unhandled);
    const n2 = tts().length;
    let settled = "pending";
    try { await B.onGifMessage({ t: "gif_search", color: "Blue", q: "cat", req: 8 }); settled = "resolved"; } catch (e) { settled = `rejected: ${e.message}`; }
    await h.flush(); await h.flush();
    process.off("unhandledRejection", unhandled);
    B._gifs.search = realSearch;
    ok("bridge: a search that throws is caught and logged, the bridge goes on", settled === "resolved" && rejected === null && tts().length === n2
      && JSON.stringify(h.effects).includes("ERROR in gif search: boom in search"), { settled, rejected: rejected && rejected.message });
    harness.restore();
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL crashed: ${e.stack}`); process.exit(1); });
