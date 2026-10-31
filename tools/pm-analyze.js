// Summarises a PresentMon CSV for TTS: frame-time percentiles, long frames, and (optionally) the bridge messages that
// were sent to TTS just before each long frame.   node tools/pm-analyze.js tmp/pm-game.csv [startEpochMs] [stream.jsonl]
const fs = require("fs");
const [file, startMs, stream] = process.argv.slice(2);
const L = fs.readFileSync(file, "utf8").trim().split("\n");
const h = L[0].replace(/^﻿/, "").split(",");
const col = (n) => h.indexOf(n);
const T = col("TimeInMs"), FT = col("MsBetweenPresents"), CPU = col("MsCPUBusy"), GPU = col("MsGPUBusy");
const rows = L.slice(1).map((l) => l.split(",")).map((r) => ({ t: +r[T], ft: +r[FT], cpu: +r[CPU], gpu: +r[GPU] })).filter((r) => !isNaN(r.ft));
const fts = rows.map((r) => r.ft).sort((a, b) => a - b);
const pct = (p) => fts[Math.min(fts.length - 1, Math.floor(fts.length * p))].toFixed(1);
const secs = (rows[rows.length - 1].t - rows[0].t) / 1000;
console.log(`${rows.length} frames in ${secs.toFixed(0)} s (${(rows.length / secs).toFixed(0)} fps); frame time median ${pct(0.5)} ms, p99 ${pct(0.99)} ms, max ${fts[fts.length - 1].toFixed(0)} ms`);
console.log(`long frames: >50 ms ${fts.filter((x) => x > 50).length}, >100 ms ${fts.filter((x) => x > 100).length}, >250 ms ${fts.filter((x) => x > 250).length}`);
const long = rows.filter((r) => r.ft > 50);
let msgs = [];
if (startMs && stream && fs.existsSync(stream)) msgs = fs.readFileSync(stream, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.at >= +startMs - 2000);
for (const r of long.slice(0, 40)) {
  const at = +startMs + r.t;
  const near = msgs.filter((m) => m.at <= at && m.at >= at - r.ft - 300).map((m) => `${m.msg.t}(${m.msg.json.length}B)`);
  console.log(`  t=${(r.t / 1000).toFixed(1)}s frame ${r.ft.toFixed(0)} ms (CPU busy ${isNaN(r.cpu) ? "?" : r.cpu.toFixed(0)}, GPU busy ${isNaN(r.gpu) ? "?" : r.gpu.toFixed(0)})${near.length ? " after: " + near.join(", ") : ""}`);
}
