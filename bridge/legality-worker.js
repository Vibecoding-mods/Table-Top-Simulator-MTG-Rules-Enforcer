// The ban list download (docs/format-banlist-spec.md §4.2): Scryfall's oracle_cards file, gunzipped as a stream, one
// card a line through legality.js's reduceOracleLine, written to `outFile` in the cache shape. Run in a worker thread
// (legality.js runInWorkerThread) so the bridge's event loop never waits on the ~160 MB file; the tests call
// downloadAndReduce in-process with a stubbed fetch. A file that ends mid-card, a broken gzip stream or an HTTP error
// throws, and nothing is written.
const fs = require("fs");
const zlib = require("zlib");
const readline = require("readline");
const { Readable, PassThrough } = require("stream");
const { isMainThread, parentPort, workerData } = require("worker_threads");
const legality = require("./legality.js");

// the body as a stream of text: gunzipped when it starts with gzip's magic bytes (a .gz file, not fetch's own decoding)
function textStream(body) {
  const src = body && typeof body.getReader === "function" ? Readable.fromWeb(body) : Readable.from(body);
  const out = new PassThrough();
  let decided = false, gz = null;
  const fail = (e) => out.destroy(e);
  src.on("error", fail);
  src.on("data", (chunk) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (!decided) {
      decided = true;
      if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
        gz = zlib.createGunzip();
        gz.on("error", fail);
        gz.pipe(out);
      }
    }
    if (gz) { if (!gz.write(buf)) { src.pause(); gz.once("drain", () => src.resume()); } }
    else if (!out.write(buf)) { src.pause(); out.once("drain", () => src.resume()); }
  });
  src.on("end", () => (gz ? gz.end() : out.end()));
  return out;
}

async function downloadAndReduce({ url, headers, outFile, updatedAt, fetch = global.fetch }) {
  const r = await fetch(url, { headers });
  if (r.status === 429) {
    const sec = Number(r.headers?.get?.("retry-after"));
    throw Object.assign(new Error("429 Too Many Requests"), { status: 429, waitMs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : 3600 * 1000 });
  }
  if (!r.ok || !r.body) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  const input = textStream(r.body);
  let broken = null;
  input.on("error", (e) => { broken = e; });
  const out = legality.newReduction();
  let lastBad = false;
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const t = line.trim();
      if (!t || t === "[" || t === "]") continue;
      const skippedBefore = out.skipped;
      legality.reduceOracleLine(t, out);
      lastBad = out.skipped > skippedBefore;
    }
  } catch (e) { broken = broken || e; }
  if (broken) throw new Error(`the download broke off: ${broken.message}`);
  if (lastBad) throw new Error("the file ended mid-card");
  if (!out.kept) throw new Error("no cards in the file");
  const cache = legality.finishReduction(out, { updatedAt });
  fs.writeFileSync(outFile, JSON.stringify(cache));
  return { ok: true, hash: cache.hash, stats: cache.stats };
}

if (!isMainThread && parentPort) {
  downloadAndReduce(workerData)
    .then((m) => parentPort.postMessage(m))
    .catch((e) => parentPort.postMessage({ ok: false, error: e.message, status: e.status, waitMs: e.waitMs }));
}

module.exports = { downloadAndReduce, textStream };
