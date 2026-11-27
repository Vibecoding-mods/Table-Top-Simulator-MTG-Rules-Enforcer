// The ban list refresh (docs/format-banlist-spec.md §4.2, test 3 of §8; no network: fetch stubbed, the worker's
// download run in-process, and once in a real worker thread against a local HTTP server): Scryfall's metadata compared
// with the cache, the download gunzipped as a stream and reduced, written to a temp file and renamed, the content hash
// deciding whether anyone is told, every failure (offline, 429 with and without Retry-After, 500, a truncated gzip, a
// file that ends mid-card) leaving the cache as it was, the wait while a game runs, the daily throttle, and the timer
// never starting a second refresh while one runs.
//   node tests/test_bridge_legality_refresh.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const http = require("http");
const crypto = require("crypto");
const L = require("../bridge/legality.js");
const W = require("../bridge/legality-worker.js");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 600)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const FIXTURE = fs.readFileSync(path.join(__dirname, "golden", "fixtures", "oracle-sample.jsonl"), "utf8");
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "legality-cache.json"), "utf8"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legality-refresh-"));
const sha = (f) => { try { return crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"); } catch { return null; } };
const DL = "https://data.scryfall.io/oracle-cards/oracle-cards-20261119.jsonl.gz";
const T0 = Date.parse("2026-11-19T12:00:00Z");

// a world: the clock, Scryfall's answers, what was asked, what was said
function world({ updatedAt = "2026-11-19T10:00:00.000+00:00", body = zlib.gzipSync(FIXTURE), meta, metaStatus = 200, metaHeaders = {}, dlStatus = 200, cache = null, busy = false, offline = false } = {}) {
  const w = { now: T0, asked: [], logs: [], downloads: 0, busy, changed: [] };
  const cacheFile = path.join(dir, `cache-${crypto.randomBytes(4).toString("hex")}.json`);
  if (cache) fs.writeFileSync(cacheFile, JSON.stringify(cache));
  w.cacheFile = cacheFile;
  w.fetch = async (url, o = {}) => {
    w.asked.push(String(url));
    if (offline) throw new TypeError("fetch failed");
    if (String(url) === L.META_URL) {
      w.metaHeaders = o.headers;
      if (metaStatus !== 200) return new Response("no", { status: metaStatus, headers: metaHeaders });
      return Response.json(meta || { object: "bulk_data", type: "oracle_cards", updated_at: updatedAt, jsonl_download_uri: DL, download_uri: DL.replace(".jsonl.gz", ".json") });
    }
    w.downloads++;
    w.headers = o.headers;
    if (dlStatus !== 200) return new Response("no", { status: dlStatus });
    return new Response(body, { status: 200 });
  };
  L._reset();
  L.configure({ cacheFile, minCards: 1, forgeFile: path.join(dir, "no-forge.json"), fetch: w.fetch, now: () => w.now, log: (s) => w.logs.push(s), busy: () => w.busy,
    runWorker: (job) => W.downloadAndReduce({ ...job, fetch: w.fetch }) });
  L.onLegalityChanged((l, summary) => w.changed.push({ hash: l.hash, summary }));
  return w;
}
const older = (updatedAt = "2026-11-18T10:01:54.000+00:00", edit) => { const c = JSON.parse(JSON.stringify(GOLDEN)); c.updatedAt = updatedAt; if (edit) { edit(c); c.hash = L.hashOf(c.keys, c.formats, c.cards); } return c; };
const tmpLeft = (w) => fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(w.cacheFile)) && f.endsWith(".tmp"));

(async () => {
  try {
    // ── the same day: nothing downloaded ──
    let w = world({ updatedAt: "2026-11-18T10:01:54.000+00:00", cache: older() });
    let r = await L.refreshLegality({ force: true });
    same("same updated_at: no download", [w.downloads, r.changed], [0, false]);
    same("same updated_at: the summary says up to date", r.summary, "Ban lists: up to date (Scryfall, 2026-11-18).");
    same("same updated_at: the request names us and asks for JSON", [w.asked, w.metaHeaders?.["User-Agent"]?.startsWith("mtg-tts-bridge"), (w.metaHeaders?.Accept || "").startsWith("application/json")], [[L.META_URL], true, true]); // (the headers the request SENT, not the constant it was given: dropping Accept from HEADERS passed; 2026-11-27)

    // ── newer, with changed lists: downloaded, reduced, renamed, told once ──
    w = world({ cache: older("2026-11-18T10:01:54.000+00:00", (c) => { c.formats.modern.banned = c.formats.modern.banned.filter((n) => n !== "Up the Beanstalk"); c.cards["up the beanstalk"] = c.cards["up the beanstalk"].replace(/^(.{6})b/, "$1l"); }) });
    r = await L.refreshLegality({ force: true });
    same("newer: downloaded once", [w.downloads, w.asked[1]], [1, DL]);
    same("newer: the hash changed", r.changed, true);
    same("newer: the summary counts the changed format", r.summary, "Ban lists updated (Scryfall, 2026-11-19): Modern +1 banned.");
    same("newer: the listeners are told once, with the new data and the summary", w.changed, [{ hash: GOLDEN.hash, summary: r.summary }]);
    let saved = JSON.parse(fs.readFileSync(w.cacheFile, "utf8"));
    same("newer: the cache is the reduced download", [saved.hash, saved.updatedAt, saved.stats], [GOLDEN.hash, "2026-11-19T10:00:00.000+00:00", GOLDEN.stats]);
    same("newer: loadLegality has the new data", [L.loadLegality().status("modern", "Up the Beanstalk"), L.loadLegality().date], ["b", "2026-11-19"]);
    same("newer: no temp file left", tmpLeft(w), []);
    same("newer: the download sends the same headers", [w.headers?.["User-Agent"]?.startsWith("mtg-tts-bridge"), (w.headers?.Accept || "").startsWith("application/json")], [true, true]);

    // ── newer, same lists: the cache updated, nobody told ──
    w = world({ cache: older() });
    r = await L.refreshLegality({ force: true });
    same("same hash: downloaded, not changed, nobody told", [w.downloads, r.changed, w.changed.length], [1, false, 0]);
    same("same hash: the cache keeps the newer date", JSON.parse(fs.readFileSync(w.cacheFile, "utf8")).updatedAt, "2026-11-19T10:00:00.000+00:00");

    // ── no cache yet (first run): downloaded ──
    w = world();
    r = await L.refreshLegality();
    same("first run: downloaded and changed", [w.downloads, r.changed, L.loadLegality().source], [1, true, "scryfall"]);

    // ── Scryfall's JSON array file when there's no jsonl_download_uri ──
    w = world({ meta: { updated_at: "2026-11-19T10:00:00Z", download_uri: "https://data.scryfall.io/oracle-cards/x.json" }, body: Buffer.from(`[\n${FIXTURE.split("\n").filter(Boolean).join(",\n")}\n]\n`) });
    r = await L.refreshLegality();
    same("array file: read through download_uri, same data", [w.asked[1], L.loadLegality().hash], ["https://data.scryfall.io/oracle-cards/x.json", GOLDEN.hash]);

    // ── failures leave the cache as it was ──
    const failures = [
      ["offline", { offline: true }, /couldn't reach Scryfall \(fetch failed\)/],
      ["500", { metaStatus: 500 }, /HTTP 500/],
      ["the download 503", { dlStatus: 503 }, /HTTP 503/],
      ["a truncated gzip", { body: zlib.gzipSync(FIXTURE).subarray(0, 300) }, /broke off/],
      ["a file that ends mid-card", { body: Buffer.from(FIXTURE.slice(0, FIXTURE.lastIndexOf("Emrakul") + 30)) }, /ended mid-card/],
      ["an answer with no download", { meta: { updated_at: "2026-11-19T10:00:00Z" } }, /no download/],
      ["an empty file", { body: Buffer.from("\n\n") }, /no cards/],
    ];
    for (const [what, opts, said] of failures) {
      w = world({ ...opts, cache: older() });
      const before = sha(w.cacheFile);
      r = await L.refreshLegality({ force: true });
      same(`failure (${what}): the cache untouched`, sha(w.cacheFile), before);
      ok(`failure (${what}): said, and nothing changed`, !r.changed && said.test(r.summary) && w.changed.length === 0, r.summary);
      same(`failure (${what}): logged`, w.logs.filter((s) => /refresh failed/.test(s)).length, 1);
      same(`failure (${what}): no temp file left`, tmpLeft(w), []);
    }

    // ── 429: waits the Retry-After, else an hour ──
    w = world({ metaStatus: 429, metaHeaders: { "Retry-After": "120" }, cache: older() });
    r = await L.refreshLegality({ force: true });
    ok("429: said", /429/.test(r.summary) && !r.changed, r.summary);
    w.asked.length = 0;
    w.now += 60 * 1000;
    r = await L.refreshLegality({ force: true });
    ok("429: inside the Retry-After nothing is asked, even forced", w.asked.length === 0 && /asked to wait/.test(r.summary), `${w.asked} ${r.summary}`);
    w.now += 61 * 1000;
    await L.refreshLegality({ force: true });
    same("429: after the Retry-After it asks again", w.asked.length, 1);
    w = world({ metaStatus: 429, cache: older() });
    await L.refreshLegality({ force: true });
    w.asked.length = 0;
    w.now += 59 * 60 * 1000;
    await L.refreshLegality({ force: true });
    same("429 without Retry-After: an hour", w.asked.length, 0);
    w.now += 2 * 60 * 1000;
    await L.refreshLegality({ force: true });
    same("429 without Retry-After: after the hour it asks again", w.asked.length, 1);

    // ── never mid-game ──
    w = world({ busy: true, cache: older() });
    r = await L.refreshLegality({ force: true });
    ok("mid-game: nothing asked, the check waits", w.asked.length === 0 && /waits for its end/.test(r.summary) && !r.changed, `${w.asked} ${r.summary}`);
    w.busy = false;
    r = await L.refreshLegality();
    same("mid-game: after the game the check runs", [w.downloads, r.changed], [1, false]);

    // ── a game that starts during the download keeps the lists it started with ──
    w = world({ cache: older() });
    L.configure({ runWorker: async (job) => { const d = await W.downloadAndReduce({ ...job, fetch: w.fetch }); w.busy = true; return d; } });
    r = await L.refreshLegality({ force: true });
    ok("game started mid-download: the cache stays, the check waits, no temp file left",
      r.waiting && !r.changed && L.loadLegality().updatedAt === "2026-11-18T10:01:54.000+00:00" && w.changed.length === 0 && tmpLeft(w).length === 0, `${JSON.stringify(r)} ${tmpLeft(w)}`);

    // ── a download cut short never replaces a good cache ──
    w = world({ cache: older(), body: zlib.gzipSync(FIXTURE.split("\n").slice(0, 2).join("\n") + "\n") });
    r = await L.refreshLegality({ force: true });
    ok("short download: refused, the cache stays, no temp file left",
      r.failed && /only \d+ cards/.test(r.summary) && L.loadLegality().updatedAt === "2026-11-18T10:01:54.000+00:00" && tmpLeft(w).length === 0, `${JSON.stringify(r)} ${tmpLeft(w)}`);
    w.now += 61 * 60 * 1000;
    w.asked.length = 0;
    await L.refreshLegality();
    same("short download: the next hourly check tries again (not a day later)", w.asked.length > 0, true);
    w = world({ cache: null });
    L.configure({ minCards: 10000 });
    r = await L.refreshLegality({ force: true });
    ok("short download: with no cache, a few cards are still not a whole download", r.failed && /only \d+ cards/.test(r.summary) && L.loadLegality().source === null, JSON.stringify(r));

    // ── once a day unless forced ──
    w = world({ updatedAt: "2026-11-18T10:01:54.000+00:00", cache: older() });
    await L.refreshLegality();
    w.asked.length = 0;
    w.now += 23 * 3600 * 1000;
    r = await L.refreshLegality();
    ok("daily: a second unforced check within the day asks nothing", w.asked.length === 0 && /checked today/.test(r.summary), `${w.asked} ${r.summary}`);
    await L.refreshLegality({ force: true });
    same("daily: a forced check asks now", w.asked.length, 1);
    w.asked.length = 0;
    w.now += 25 * 3600 * 1000;
    await L.refreshLegality();
    same("daily: a day later the unforced check asks", w.asked.length, 1);

    // ── the edges the 2026-11-24 module mutation pass found unchecked (tools/mutate-bridge-modules.js) ──
    w = world({ updatedAt: "2026-11-18T10:01:54.000+00:00", cache: older() });
    await L.refreshLegality();
    w.asked.length = 0;
    w.now += 24 * 3600 * 1000;
    await L.refreshLegality();
    same("edges: daily: exactly a day later the unforced check asks", w.asked.length, 1);
    w = world({ cache: older("2026-11-12T12:00:00.000+00:00") });
    same("edges: a list exactly a week old is not old yet", L.loadLegality().old, false);
    w = world({ cache: older("2026-11-12T11:59:59.999+00:00") });
    same("edges: a moment past the week it is", L.loadLegality().old, true);
    w = world({ cache: older("2026-11-18T10:01:54.000+00:00", (c) => {
      const i = c.keys.indexOf("pauper");
      c.keys.splice(i, 1);
      for (const k of Object.keys(c.cards)) c.cards[k] = c.cards[k].slice(0, i) + c.cards[k].slice(i + 1);
    }) });
    same("edges: a format whose key the data dropped is not had, though its list is there", [L.loadLegality().has("pauper"), L.loadLegality().has("modern")], [false, true]);
    w = world({ cache: older(), body: zlib.gzipSync(FIXTURE.split("\n").filter((l) => !l.includes("\"name\":\"Sol Ring\"")).join("\n")) });
    r = await L.refreshLegality({ force: true });
    ok("edges: a download a card shorter than the cache is taken (only a fifth fewer is refused)", !r.failed && L.loadLegality().updatedAt === "2026-11-19T10:00:00.000+00:00", JSON.stringify(r));
    w = world({ cache: older() });
    L.configure({ runWorker: async (job) => { const d = await W.downloadAndReduce({ ...job, fetch: w.fetch }); w.busy = true; return d; } });
    await L.refreshLegality();
    w.busy = false;
    L.configure({ runWorker: (job) => W.downloadAndReduce({ ...job, fetch: w.fetch }) });
    w.asked.length = 0;
    await L.refreshLegality();
    ok("edges: a check a game cut short runs again after it, within the day", w.asked.length > 0, JSON.stringify(w.asked));
    w = world({ cache: older() });
    L.configure({ runWorker: async () => { const e = new Error("429 Too Many Requests"); e.status = 429; throw e; } });
    r = await L.refreshLegality({ force: true });
    w.asked.length = 0;
    w.now += 60 * 1000;
    r = await L.refreshLegality({ force: true });
    ok("edges: the download's own 429 waits an hour too", w.asked.length === 0 && /asked to wait/.test(r.summary), `${w.asked} ${r.summary}`);

    // ── never two at once ──
    w = world({ cache: older() });
    const a = L.refreshLegality({ force: true }), b = L.refreshLegality({ force: true });
    same("two at once: the second shares the first", a === b, true);
    await Promise.all([a, b]);
    same("two at once: one metadata request, one download", [w.asked.filter((u) => u === L.META_URL).length, w.downloads], [1, 1]);

    // ── the timer ──
    w = world({ updatedAt: "2026-11-18T10:01:54.000+00:00", cache: older() });
    let stop = L.startLegalityTimer({ everyMs: 5 });
    await new Promise((res) => setTimeout(res, 60));
    stop();
    same("timer: ticks many times, checks once a day", w.asked.length, 1);
    w = world({ busy: true, cache: older() });
    stop = L.startLegalityTimer({ everyMs: 5 });
    await new Promise((res) => setTimeout(res, 40));
    same("timer: nothing while a game runs", w.asked.length, 0);
    w.busy = false;
    await new Promise((res) => setTimeout(res, 40));
    stop();
    await new Promise((res) => setTimeout(res, 20));
    same("timer: the check runs once the game is over, once", [w.asked.filter((u) => u === L.META_URL).length, w.downloads], [1, 1]);
    w = world({ cache: older() });
    let release;
    const slow = new Promise((res) => { release = res; });
    const wf = w.fetch;
    L.configure({ fetch: async (u, o) => { if (String(u) !== L.META_URL) await slow; return wf(u, o); }, runWorker: (job) => W.downloadAndReduce({ ...job, fetch: async (u, o) => { await slow; return wf(u, o); } }) });
    stop = L.startLegalityTimer({ everyMs: 5 });
    await new Promise((res) => setTimeout(res, 40));
    stop();
    release();
    await new Promise((res) => setTimeout(res, 40));
    same("timer: a tick while a refresh runs starts no second", w.asked.filter((u) => u === L.META_URL).length, 1);

    // ── the real worker thread, against a local server ──
    const gz = zlib.gzipSync(FIXTURE);
    const server = http.createServer((req, res) => {
      if (req.url === "/meta") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ updated_at: "2026-11-19T10:00:00Z", jsonl_download_uri: `http://127.0.0.1:${server.address().port}/cards.jsonl.gz` })); return; }
      res.writeHead(200, { "Content-Type": "application/gzip" });
      res.end(gz);
    });
    await new Promise((res) => server.listen(0, "127.0.0.1", res));
    const port = server.address().port;
    L._reset();
    const cacheFile = path.join(dir, "thread-cache.json");
    L.configure({ cacheFile, minCards: 1, forgeFile: path.join(dir, "no-forge.json"), now: () => T0, log: () => {}, busy: () => false,
      fetch: (u, o) => fetch(String(u) === L.META_URL ? `http://127.0.0.1:${port}/meta` : u, o) });
    const { runWorker } = L._defaults(); // (a fresh bridge's: a worker_threads Worker running bridge/legality-worker.js)
    ok("thread: the default runs a worker thread", runWorker === L.runInWorkerThread, runWorker.name);
    L.configure({ runWorker });
    r = await L.refreshLegality({ force: true });
    server.close();
    same("thread: downloaded, gunzipped and reduced in the worker", [r.changed, L.loadLegality().hash, L.loadLegality().source], [true, GOLDEN.hash, "scryfall"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `FAIL test_bridge_legality_refresh: ${failed} failed, ${passed} passed` : `PASS test_bridge_legality_refresh: ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_legality_refresh: crashed: ${e.stack}`); process.exit(1); });
