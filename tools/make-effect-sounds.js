// Makes the table's counter and knockout sounds (docs/sounds.md, 2026-11-11) from nothing but ffmpeg's own generators:
// no downloaded or third-party audio, so the clips are this project's work (public domain, LICENSE). The noise seeds are
// fixed, so a run gives the same files, byte for byte (the sha256s in docs/sounds.md).
//   node tools/make-effect-sounds.js [outDir] [workDir]   defaults: assets/sounds/tts, tmp/sounds-work (both gitignored)
// FFMPEG overrides the path to ffmpeg.exe.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const FF = process.env.FFMPEG || "C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe";
const outDir = process.argv[2] || path.join(ROOT, "assets", "sounds", "tts");
const work = process.argv[3] || path.join(ROOT, "tmp", "sounds-work");
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const ff = (args) => {
  const r = spawnSync(FF, ["-hide_banner", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || r.error || "").toString().split("\n").slice(-12).join("\n")}`);
};
// astats' Overall peak and RMS (dBFS) and the container's duration (s)
const stats = (file) => {
  const r = spawnSync(FF, ["-hide_banner", "-i", file, "-af", "astats=metadata=0", "-f", "null", "-"], { encoding: "utf8" });
  const overall = r.stderr.split("Overall")[1] || "";
  const num = (re) => Number((overall.match(re) || [])[1]);
  const d = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return { peak: num(/Peak level dB: (-?[\d.]+)/), rms: num(/RMS level dB: (-?[\d.]+)/), dur: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : NaN };
};

// counter: a soft "placed" tick, then two rising bell notes (E6, B6 75 ms later), 0.62 s. Each note: the fundamental
// and a quieter inharmonic partial (x2.76, a bell's colour) that dies faster; 3 ms attack, exponential decay.
// (The expressions sit inside '...' in the filter graph, so their commas need no escaping.)
const note = (f, at, decay) => `(gte(t,${at})*min(1,(t-${at})/0.003)*exp(-(t-${at})*${decay})*(sin(2*PI*${f}*(t-${at}))+0.22*sin(2*PI*${(f * 2.76).toFixed(2)}*(t-${at}))*exp(-(t-${at})*14)))`;
const counterExpr = `0.5*${note(1318.5, 0, 11)}+0.42*${note(1975.5, 0.075, 9)}`;
ff(["-f", "lavfi", "-i", `aevalsrc=exprs='${counterExpr}|${counterExpr}':s=44100:d=0.62`,
  "-f", "lavfi", "-i", "anoisesrc=color=white:a=0.6:d=0.012:r=44100:seed=7",
  "-filter_complex", "[1:a]highpass=f=2500,afade=t=out:st=0:d=0.012,aformat=channel_layouts=stereo[click];[0:a][click]amix=inputs=2:normalize=0:duration=longest[m]",
  "-map", "[m]", "-c:a", "pcm_s16le", path.join(work, "counter-raw.wav")]);

// knockout: an explosion (the user's note: "knockout = an explosion"), 1.6 s: a crack (bright pink noise, 0.18 s), the
// body (brown noise through two 700 Hz lowpasses, exponential decay) and a sub thump (a sine falling 80 -> 30 Hz).
// The mix is scaled down so the raw file can't clip; the levelling below sets the loudness.
const thump = "exp(-t*3.2)*min(1,t/0.004)*sin(2*PI*(30*t+50/7*(1-exp(-7*t))))";
ff(["-f", "lavfi", "-i", "anoisesrc=color=pink:a=0.9:d=0.2:r=44100:seed=11",
  "-f", "lavfi", "-i", "anoisesrc=color=brown:a=1:d=1.6:r=44100:seed=23",
  "-f", "lavfi", "-i", `aevalsrc=exprs='${thump}':s=44100:d=1.6`,
  "-filter_complex",
  "[0:a]highpass=f=900,afade=t=out:st=0:d=0.18:curve=exp,volume=0.8,aformat=channel_layouts=stereo[crack];" +
  "[1:a]lowpass=f=700,lowpass=f=700,highpass=f=35,afade=t=in:st=0:d=0.01,afade=t=out:st=0.04:d=1.56:curve=exp,volume=2.4,aformat=channel_layouts=stereo[body];" +
  "[2:a]volume=0.9,aformat=channel_layouts=stereo[sub];" +
  "[crack][body][sub]amix=inputs=3:normalize=0:duration=longest,volume=0.4[m]",
  "-map", "[m]", "-c:a", "pcm_s16le", path.join(work, "knockout-raw.wav")]);

// Levelled like the user's six (docs/sounds.md): -20 dBFS RMS over the sound, peaks limited to -1.4 dBFS, an 80 ms
// fade-out. Then the recipe TTS's music player loads: padded to 2 s, libmp3lame 192 kbps 44.1 kHz, ID3v2.3, a title
// starting "MTG effect".
const out = {};
for (const name of ["counter", "knockout"]) {
  const raw = path.join(work, `${name}-raw.wav`);
  const s = stats(raw);
  const lev = path.join(work, `${name}.wav`);
  ff(["-i", raw, "-af", `volume=${(-20 - s.rms).toFixed(2)}dB,alimiter=limit=0.85:attack=1:release=40:level=disabled,afade=t=out:st=${(s.dur - 0.08).toFixed(3)}:d=0.08`, "-c:a", "pcm_s16le", lev]);
  const mp3 = path.join(outDir, `mtg2-${name}.mp3`);
  ff(["-i", lev, "-af", "apad=whole_dur=2", "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", "-id3v2_version", "3", "-metadata", `title=MTG effect ${name}`, mp3]);
  out[name] = { file: mp3, sound: s.dur, levelled: stats(lev), mp3: stats(mp3), bytes: fs.statSync(mp3).size, sha256: crypto.createHash("sha256").update(fs.readFileSync(mp3)).digest("hex") };
}
console.log(JSON.stringify(out, null, 2));
