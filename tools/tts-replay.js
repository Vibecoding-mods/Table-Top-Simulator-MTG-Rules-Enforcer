// Replays recorded bridge→TTS messages (MTG_RECORD file) into the loaded game at their original pace, through the
// same External Editor custom-message path the bridge uses. For stutter hunting only.
// usage: node tools/tts-replay.js <record.jsonl> <fromIndex> [count]
const fs = require("fs"), net = require("net");
const [file, from, count] = process.argv.slice(2);
const all = fs.readFileSync(file, "utf8").trim().split("\n").map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
const list = all.slice(+from, count ? +from + +count : undefined);
const send = (msg) => new Promise((res) => { const s = net.connect(39999, "127.0.0.1", () => s.end(JSON.stringify({ messageID: 2, customMessage: msg }))); s.on("close", res); s.on("error", res); });
(async () => {
  const t0 = list[0].at, start = Date.now();
  for (const m of list) {
    const wait = m.at - t0 - (Date.now() - start);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await send(m.msg);
  }
  console.log(`replayed ${list.length} messages in ${((Date.now() - start) / 1000).toFixed(0)} s`);
})();
