// Makes the table's Treasure-made sound (docs/sounds.md, "Treasure"): `treasure` (Treasure tokens created) from "Sack of
// Gold" by Amarikah (CC0, OpenGameArt; the user's pick of 2026-11-13, replacing the first day's purchase jingle), with
// its bursts x2 x3 x4 x6 x8. `treasurespend` has no files of its own since then: it plays the death sound (the user:
// "permanent removal sound for treasure spent"), so its links in tools/engine-renderer.lua are death's.
// Every step has fixed parameters (no randomness, no measured value that isn't the output of an earlier fixed step), so
// a run on the same source with the same ffmpeg makes the same files, byte for byte (the sha256s in docs/sounds.md).
//   node tools/make-treasure-sounds.js [srcDir] [outDir] [uploadDir] [workDir]
//   defaults: assets/sounds/treasure2, assets/sounds/tts, tmp/upload5, tmp/sounds-treasure-work (all gitignored)
// srcDir holds gold_sack.wav. FFMPEG overrides the path to ffmpeg.exe.
//
// The recipe (docs/sounds.md):
// - decoded to 44.1 kHz stereo and low-passed at 18.6 kHz (libmp3lame at 192 kbps keeps nothing above it, so what is
//   levelled is what the mp3 keeps); trimmed from the first sample over -60 dBFS to the end of the last 10 ms over
//   -60 dBFS RMS;
// - levelled by loudness, on the mp3: its loudest 400 ms (EBU R128 momentary) at -13 LUFS, about the median of the
//   table's other single sounds (-11.0 to -15.0, median -12.6), with peaks limited to stay under -1 dBFS, but never by
//   more than LIMIT_MAX (a sound whose loudness is all in a few hits stays quieter instead of losing its hits); then an
//   80 ms fade-out;
// - the bursts: N copies stacked about 110 ms apart with the same fixed timing jitter as the 2026-11-11 bursts, each
//   1 dB quieter than the one before, leaning alternately left and right, each pitched a little (PITCH) so the pile
//   doesn't comb; then scaled so the mp3's peak is under -1 dBFS (no limiter);
// - TTS's recipe: padded with silence to at least 2 s (longer when the sound needs it: the table pauses a clip 0.25 s
//   before its length, so a file is at least the sound + 0.25 s), libmp3lame 192 kbps, 44.1 kHz, ID3v2.3, title
//   "MTG effect <name>". Files are named mtg3-* (the mtg2-treasure* names are the first day's uploads).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const FF = process.env.FFMPEG || "C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe";
const srcDir = process.argv[2] || path.join(ROOT, "assets", "sounds", "treasure2");
const outDir = process.argv[3] || path.join(ROOT, "assets", "sounds", "tts");
const uploadDir = process.argv[4] || path.join(ROOT, "tmp", "upload5");
const work = process.argv[5] || path.join(ROOT, "tmp", "sounds-treasure-work");
for (const d of [outDir, uploadDir, work]) fs.mkdirSync(d, { recursive: true });

const RATE = 44100;
const TARGET_LUFS = -13; // the loudest 400 ms (EBU R128 momentary), on the mp3
const PEAK_MAX = -1; // dBFS, on the mp3
const LIMIT_MAX = 6; // dB of limiting at most, on a sound's loudest peak (bighit had 5.8, the most of the 2026-11-12 sounds)
const BURSTS = [2, 3, 4, 6, 8];
const JITTER = [0, 0.18, -0.12, 0.22, -0.2, 0.1, -0.06, 0.15, -0.24, 0.05, 0.2, -0.15]; // (the 2026-11-11 bursts' table)
const PITCH = [0, 0.6, -0.5, 1.1, -0.9, 0.3, -1.3, 0.9]; // semitones, the k-th copy

const ff = (args) => {
  const r = spawnSync(FF, ["-hide_banner", "-y", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || r.error || "").toString().split("\n").slice(-12).join("\n")}`);
  return r;
};
// a file as 44.1 kHz stereo float samples, through the extra filters af
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
// a file's loudness (EBU R128: M, the loudest 400 ms, and I, integrated; LUFS) and sample peak (dBFS). (Padded with a
// second of silence first: R128 measures in 400 ms blocks; silent blocks are gated out of I)
const measure = (file) => {
  const e = spawnSync(FF, ["-hide_banner", "-i", file, "-af", "apad=pad_dur=1,ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const I = Number(((e.stderr.match(/I:\s*(-?[\d.]+) LUFS/g) || []).pop() || "").replace(/[^\d.-]/g, ""));
  const M = Math.max(...[...e.stderr.matchAll(/ M:\s*(-?[\d.]+)/g)].map((x) => Number(x[1])));
  const a = spawnSync(FF, ["-hide_banner", "-i", file, "-af", "astats=metadata=0", "-f", "null", "-"], { encoding: "utf8" });
  const peak = Number(((a.stderr.split("Overall")[1] || "").match(/Peak level dB: (-?[\d.]+)/) || [])[1]);
  return { M, I, peak };
};
// the file length for a sound of d s: 2 s, or the sound + 0.25 s rounded up to 0.1 s (the table pauses 0.25 s early)
const padFor = (d) => Math.max(2, Math.ceil((d + 0.25) * 10 - 1e-9) / 10);
const mp3 = (inWav, out, af, pad, title) => ff(["-i", inWav, "-af", `${af ? af + "," : ""}apad=whole_dur=${pad}`, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", String(RATE),
  "-id3v2_version", "3", "-metadata", `title=${title}`, out]);

// one sound levelled: gain and limiter ceiling corrected on the mp3 until its loudest 400 ms is at TARGET_LUFS (to
// 0.05) with its peak under PEAK_MAX. -> the levelled samples (for the bursts) and what was done
function level(name, raw) {
  const rawWav = path.join(work, `${name}-raw.wav`);
  writeWav(rawWav, raw);
  const d = dur(raw), pad = padFor(d), test = path.join(work, `${name}-test.mp3`);
  const rawPeak = peakDb(raw);
  let ceil = -1.4, m = null;
  let gain = Math.min(TARGET_LUFS - measure(rawWav).M, ceil + LIMIT_MAX - rawPeak);
  const chain = () => `volume=${gain.toFixed(2)}dB,alimiter=limit=${Math.pow(10, ceil / 20).toFixed(4)}:attack=1:release=40:level=disabled,afade=t=out:st=${(d - 0.08).toFixed(3)}:d=0.08`;
  for (let i = 0; i < 12; i++) {
    mp3(rawWav, test, chain(), pad, `MTG effect ${name}`);
    m = measure(test);
    if (m.peak >= PEAK_MAX) { ceil -= m.peak - PEAK_MAX + 0.05; continue; }
    if (Math.abs(m.M - TARGET_LUFS) <= 0.05) break;
    // (never more than LIMIT_MAX of limiting: a sound whose loudness is all in its hits stays quieter instead)
    const want = gain + TARGET_LUFS - m.M, cap = ceil + LIMIT_MAX - rawPeak;
    if (want <= cap) gain = want;
    else if (gain >= cap - 0.005) break;
    else gain = cap;
  }
  const lev = path.join(work, `${name}.wav`);
  ff(["-i", rawWav, "-af", chain(), "-c:a", "pcm_f32le", lev]);
  return { samples: decode(lev), wav: lev, sound: d, gain, ceil, limited: Math.max(0, peakDb(raw) + gain - ceil), measured: m };
}

// n levelled copies stacked: the k-th at k gaps (with JITTER), 1 dB quieter each, leaning left and right
function stack(copies, gapMs) {
  const starts = [];
  let t = 0;
  for (let k = 0; k < copies.length; k++) { starts.push(Math.round(t * RATE)); t += (gapMs / 1000) * (1 + JITTER[(k + 1) % JITTER.length]); }
  const total = Math.max(...copies.map((c, k) => starts[k] + c.L.length));
  const L = new Float32Array(total), R = new Float32Array(total);
  copies.forEach((c, k) => {
    const g = Math.pow(10, -k / 20), lean = k === 0 ? 0 : (k % 2 ? 0.15 : -0.15);
    for (let i = 0; i < c.L.length; i++) { L[starts[k] + i] += c.L[i] * g * (1 - lean); R[starts[k] + i] += c.R[i] * g * (1 + lean); }
  });
  return { L, R };
}
// a burst written: scaled so the mp3's peak is under PEAK_MAX
function burstMp3(name, s, out) {
  const wav = path.join(work, `${name}.wav`);
  writeWav(wav, s);
  const d = dur(s), pad = padFor(d);
  let scale = Math.min(0, PEAK_MAX - 0.3 - peakDb(s)), m = null;
  for (let i = 0; i < 10; i++) {
    mp3(wav, out, `volume=${scale.toFixed(2)}dB`, pad, `MTG effect ${name}`);
    m = measure(out);
    if (m.peak < PEAK_MAX) break;
    scale -= m.peak - PEAK_MAX + 0.05;
  }
  return { sound: d, pad, scale, measured: m };
}

const report = {};
const done = (file, info) => {
  const buf = fs.readFileSync(file);
  report[path.basename(file)] = { ...info, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
  fs.copyFileSync(file, path.join(uploadDir, path.basename(file)));
};
const LP = "lowpass=f=18600";

// treasure: the sack of gold
const sack = level("treasure", trim(decode(path.join(srcDir, "gold_sack.wav"), LP)));
const out1 = path.join(outDir, "mtg3-treasure.mp3");
mp3(sack.wav, out1, "", padFor(sack.sound), "MTG effect treasure");
done(out1, { sound: +sack.sound.toFixed(3), pad: padFor(sack.sound), gainDb: +sack.gain.toFixed(2), ceilingDb: +sack.ceil.toFixed(2), limitedDb: +sack.limited.toFixed(1), ...measure(out1) });
const pitched = PITCH.map((st, k) => {
  if (st === 0) return sack.samples;
  const f = path.join(work, `treasure-pitch${k}.wav`);
  ff(["-i", sack.wav, "-af", `asetrate=${Math.round(RATE * Math.pow(2, st / 12))},aresample=${RATE}`, "-c:a", "pcm_f32le", f]);
  return decode(f);
});
for (const n of BURSTS) {
  const out = path.join(outDir, `mtg3-treasure-x${n}.mp3`);
  const b = burstMp3(`treasure-x${n}`, stack(pitched.slice(0, n), 110), out);
  done(out, { sound: +b.sound.toFixed(3), pad: b.pad, scaleDb: +b.scale.toFixed(2), ...b.measured });
}
console.log(JSON.stringify(report, null, 2));
