// Makes CC0 candidates for two table sounds from Kenney's audio packs (docs/sounds.md, "Kenney CC0 candidates",
// 2026-11-15): `countered` (a spell countered; today's pick is the user's "If a spell is countered.ogg", source and
// licence unknown, so not cleared for the public repo) and `knockout` (a player loses; today's is ours, cleared). Two
// candidates each, for the user to hear and pick; nothing changes on the table until one is uploaded and its link
// pasted into engineSounds (tools/engine-renderer.lua).
// The recipe is make-treasure-sounds.js's (loudest 400 ms at -13 LUFS on the mp3, peak under -1 dBFS, at most 6 dB of
// limiting, cut at 1.75 s, 80 ms fade-out, padded to 2 s, libmp3lame 192 kbps, ID3v2.3), with no bursts:
// countered and knockout play one at a time. Fixed parameters, so a run on the same packs with the same ffmpeg makes
// the same files byte for byte.
//   node tools/make-kenney-sounds.js [packDir] [outDir] [uploadDir] [workDir]
//   defaults: assets/sounds/kenney-cc0/download, assets/sounds/tts, tmp/upload7, tmp/sounds-kenney-work (gitignored)
// packDir holds the two packs unzipped as digital-audio/ and sci-fi-sounds/ (kenney.nl/assets/digital-audio and
// kenney.nl/assets/sci-fi-sounds, both CC0). FFMPEG overrides the path to ffmpeg.exe.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const FF = process.env.FFMPEG || path.join(require("os").homedir(), "AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe");
const packDir = process.argv[2] || path.join(ROOT, "assets", "sounds", "kenney-cc0", "download");
const outDir = process.argv[3] || path.join(ROOT, "assets", "sounds", "tts");
const uploadDir = process.argv[4] || path.join(ROOT, "tmp", "upload7");
const work = process.argv[5] || path.join(ROOT, "tmp", "sounds-kenney-work");
for (const d of [outDir, uploadDir, work]) fs.mkdirSync(d, { recursive: true });

// [kind, candidate, pack file]
const CANDIDATES = [
  ["countered", "a", "digital-audio/Audio/phaserDown3.ogg"], // a falling phaser, 0.50 s: the spell fizzles out
  ["countered", "b", "digital-audio/Audio/lowDown.ogg"], // a low falling tone, 0.78 s
  ["knockout", "a", "sci-fi-sounds/Audio/explosionCrunch_004.ogg"], // a long crunching explosion, 1.98 s
  ["knockout", "b", "sci-fi-sounds/Audio/lowFrequency_explosion_000.ogg"], // a deep boom, 2.00 s
];

const RATE = 44100;
const TARGET_LUFS = -13;
const PEAK_MAX = -1;
const LIMIT_MAX = 6;
// cut at 1.75 s (the fade-out ends there), so every file is 2 s: the table pauses a clip at engineSoundLen (2 s by
// default) - 0.25 s, so a pick needs only its link pasted, no engineSoundLen entry
const MAX_SOUND = 1.75;

const ff = (args) => {
  const r = spawnSync(FF, ["-hide_banner", "-y", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || r.error || "").toString().split("\n").slice(-12).join("\n")}`);
  return r;
};
const decode = (file, af) => {
  const r = spawnSync(FF, ["-hide_banner", "-i", file, "-af", `aresample=${RATE}${af ? "," + af : ""}`, "-ac", "2", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${file}`);
  const n = r.stdout.length / 8;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = r.stdout.readFloatLE(i * 8); R[i] = r.stdout.readFloatLE(i * 8 + 4); }
  return { L, R };
};
const writeWav = (file, { L, R }) => {
  const n = L.length, out = Buffer.alloc(44 + n * 8);
  out.write("RIFF", 0, "latin1"); out.writeUInt32LE(36 + n * 8, 4); out.write("WAVEfmt ", 8, "latin1");
  out.writeUInt32LE(16, 16); out.writeUInt16LE(3, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 8, 28); out.writeUInt16LE(8, 32); out.writeUInt16LE(32, 34);
  out.write("data", 36, "latin1"); out.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { out.writeFloatLE(L[i], 44 + i * 8); out.writeFloatLE(R[i], 48 + i * 8); }
  fs.writeFileSync(file, out);
};
const dur = (s) => s.L.length / RATE;
const peakDb = (s) => { let p = 0; for (let i = 0; i < s.L.length; i++) p = Math.max(p, Math.abs(s.L[i]), Math.abs(s.R[i])); return 20 * Math.log10(p); };
// from the first sample over -60 dBFS to the end of the last 10 ms over -60 dBFS RMS
const trim = (s) => {
  const th = Math.pow(10, -60 / 20), n = s.L.length, W = RATE / 100;
  let a = 0;
  while (a < n && Math.abs(s.L[a]) <= th && Math.abs(s.R[a]) <= th) a++;
  let b = a;
  for (let w = a; w < n; w += W) {
    let sq = 0, c = 0;
    for (let i = w; i < Math.min(n, w + W); i++) { sq += s.L[i] * s.L[i] + s.R[i] * s.R[i]; c += 2; }
    if (Math.sqrt(sq / c) > th) b = Math.min(n, w + W);
  }
  return { L: s.L.slice(a, b), R: s.R.slice(a, b) };
};
const measure = (file) => {
  const e = spawnSync(FF, ["-hide_banner", "-i", file, "-af", "apad=pad_dur=1,ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const I = Number(((e.stderr.match(/I:\s*(-?[\d.]+) LUFS/g) || []).pop() || "").replace(/[^\d.-]/g, ""));
  const M = Math.max(...[...e.stderr.matchAll(/ M:\s*(-?[\d.]+)/g)].map((x) => Number(x[1])));
  const a = spawnSync(FF, ["-hide_banner", "-i", file, "-af", "astats=metadata=0", "-f", "null", "-"], { encoding: "utf8" });
  const peak = Number(((a.stderr.split("Overall")[1] || "").match(/Peak level dB: (-?[\d.]+)/) || [])[1]);
  return { M, I, peak };
};
const padFor = (d) => Math.max(2, Math.ceil((d + 0.25) * 10 - 1e-9) / 10);
const mp3 = (inWav, out, af, pad, title) => ff(["-i", inWav, "-af", `${af ? af + "," : ""}apad=whole_dur=${pad}`, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", String(RATE),
  "-id3v2_version", "3", "-metadata", `title=${title}`, out]);

// one sound levelled straight to its mp3 (make-treasure-sounds.js's level(), writing the final file)
function make(name, title, raw, out) {
  const rawWav = path.join(work, `${name}-raw.wav`);
  writeWav(rawWav, raw);
  const d = dur(raw), pad = padFor(d), rawPeak = peakDb(raw);
  let ceil = -1.4, m = null;
  let gain = Math.min(TARGET_LUFS - measure(rawWav).M, ceil + LIMIT_MAX - rawPeak);
  const chain = () => `volume=${gain.toFixed(2)}dB,alimiter=limit=${Math.pow(10, ceil / 20).toFixed(4)}:attack=1:release=40:level=disabled,afade=t=out:st=${(d - 0.08).toFixed(3)}:d=0.08`;
  for (let i = 0; i < 12; i++) {
    mp3(rawWav, out, chain(), pad, title);
    m = measure(out);
    if (m.peak >= PEAK_MAX) { ceil -= m.peak - PEAK_MAX + 0.05; continue; }
    if (Math.abs(m.M - TARGET_LUFS) <= 0.05) break;
    const want = gain + TARGET_LUFS - m.M, cap = ceil + LIMIT_MAX - rawPeak;
    if (want <= cap) gain = want;
    else if (gain >= cap - 0.005) break;
    else gain = cap;
  }
  return { sound: +d.toFixed(3), pad, gainDb: +gain.toFixed(2), ceilingDb: +ceil.toFixed(2), limitedDb: +Math.max(0, rawPeak + gain - ceil).toFixed(1), ...m };
}

const report = {};
for (const [kind, cand, file] of CANDIDATES) {
  const src = path.join(packDir, file);
  const name = `${kind}-kenney-${cand}`;
  const out = path.join(outDir, `mtg5-${name}.mp3`);
  const t = trim(decode(src, "lowpass=f=18600")), cut = Math.min(t.L.length, Math.round(MAX_SOUND * RATE));
  const info = make(name, `MTG effect ${kind}`, { L: t.L.slice(0, cut), R: t.R.slice(0, cut) }, out);
  const buf = fs.readFileSync(out);
  report[path.basename(out)] = { kind, from: file, ...info, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
  fs.copyFileSync(out, path.join(uploadDir, path.basename(out)));
}
console.log(JSON.stringify(report, null, 2));
