// The instant sound remake (2026-11-19, docs/sounds.md "Instant remake"): the 2026-11-12 instant (mtg2-instant.mp3), then
// three pops, a slice and a sizzle, all made here from ffmpeg generators (no third-party audio), and the 2026-11-14
// "twice as strong" step (+6.02 dB, limiter at -1 dBFS) for mtg5-instant.mp3. The user picked B-sizzle of the takes below.
//   node tools/make-instant-sound.js   (writes tmp/instant-tail/ and tmp/upload8/mtg5-instant.mp3)
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const FF = path.join(require("os").homedir(), "AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe");
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "assets", "sounds", "tts", "mtg2-instant.mp3");
const OUT = path.join(ROOT, "tmp", "instant-tail");
fs.mkdirSync(OUT, { recursive: true });
const ff = (args) => { const r = spawnSync(FF, ["-hide_banner", "-y", ...args], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr.split("\n").slice(-8).join("\n")); };

// slice: white noise through a band that sweeps up 2.5k -> 9k Hz over 0.14 s, 4 ms attack, fast decay ("shing")
ff(["-f", "lavfi", "-i", "anoisesrc=color=white:a=0.9:d=0.16:r=44100:seed=11",
  "-af", "highpass=f=2500,lowpass=f=11000,volume='min(1,t/0.004)*exp(-t*22)':eval=frame,aformat=channel_layouts=stereo",
  "-c:a", "pcm_s16le", `${OUT}/slice.wav`]);
// a ringing edge under the slice: a short metallic partial pair
const ring = "0.25*min(1,t/0.003)*exp(-t*28)*(sin(2*PI*3520*t)+0.6*sin(2*PI*5270*t))";
ff(["-f", "lavfi", "-i", `aevalsrc=exprs='${ring}|${ring}':s=44100:d=0.16`, "-c:a", "pcm_s16le", `${OUT}/ring.wav`]);
// pop: sine dropping 1100 -> 260 Hz in 50 ms, 2 ms attack, plus a 6 ms click
const pop = "0.8*min(1,t/0.002)*exp(-t*38)*sin(2*PI*(260*t+(1100-260)*0.02*(1-exp(-t/0.02))))";
ff(["-f", "lavfi", "-i", `aevalsrc=exprs='${pop}|${pop}':s=44100:d=0.14`, "-c:a", "pcm_s16le", `${OUT}/pop.wav`]);

const AT = 700; // ms: the instant's tail fades out at about 0.75 s
const mix = (name, parts) => {
  const inputs = ["-i", SRC];
  const legs = [];
  parts.forEach(([file, gain, delay], i) => {
    inputs.push("-i", `${OUT}/${file}`);
    legs.push(`[${i + 1}:a]volume=${gain},adelay=${delay}|${delay}[p${i}]`);
  });
  const labels = ["[0:a]", ...parts.map((_, i) => `[p${i}]`)].join("");
  ff([...inputs, "-filter_complex", `${legs.join(";")};${labels}amix=inputs=${parts.length + 1}:normalize=0:duration=first,apad=whole_dur=2[m]`,
    "-map", "[m]", "-t", "2", "-c:a", "libmp3lame", "-b:a", "192k", `${OUT}/${name}.mp3`]);
};
mix("instant-slice", [["slice.wav", 0.55, AT], ["ring.wav", 0.6, AT]]);
mix("instant-pop", [["pop.wav", 0.7, AT]]);
mix("instant-slice-pop", [["slice.wav", 0.5, AT - 40], ["ring.wav", 0.5, AT - 40], ["pop.wav", 0.6, AT + 60]]);
console.log(fs.readdirSync(OUT).join(" "));
// triple pop (the user 2026-11-19: "2 is the best, add a triple pop at the end"): three pops 90 ms apart
mix("instant-triple-pop", [["pop.wav", 0.7, AT], ["pop.wav", 0.6, AT + 90], ["pop.wav", 0.5, AT + 180]]);
// the same, quicker (70 ms apart) with the last one a touch louder, as a finish
mix("instant-triple-pop-quick", [["pop.wav", 0.6, AT], ["pop.wav", 0.6, AT + 70], ["pop.wav", 0.75, AT + 140]]);
// the user: "add the slide [slice] at the end of both": the slice and its ring after the last pop
mix("instant-triple-pop-slice", [["pop.wav", 0.7, AT], ["pop.wav", 0.6, AT + 90], ["pop.wav", 0.5, AT + 180], ["slice.wav", 0.55, AT + 290], ["ring.wav", 0.6, AT + 290]]);
mix("instant-triple-pop-quick-slice", [["pop.wav", 0.6, AT], ["pop.wav", 0.6, AT + 70], ["pop.wav", 0.75, AT + 140], ["slice.wav", 0.55, AT + 240], ["ring.wav", 0.6, AT + 240]]);
// the user: "add a bang or crack or sizzle at the end": each one after the slice, on both triple pops
// bang: a low thump (95 -> 45 Hz) under a short dark noise burst
const thump = "0.9*min(1,t/0.003)*exp(-t*14)*sin(2*PI*(45*t+(95-45)*0.04*(1-exp(-t/0.04))))";
ff(["-f", "lavfi", "-i", `aevalsrc=exprs='${thump}|${thump}':s=44100:d=0.35`, "-f", "lavfi", "-i", "anoisesrc=color=pink:a=0.9:d=0.2:r=44100:seed=21",
  "-filter_complex", "[1:a]lowpass=f=1600,aeval='val(0)*min(1,t/0.002)*exp(-t*28)',aformat=channel_layouts=stereo[n];[0:a][n]amix=inputs=2:normalize=0:duration=longest[m]",
  "-map", "[m]", "-c:a", "pcm_s16le", `${OUT}/bang.wav`]);
// crack: a sharp broadband snap and a smaller one 25 ms later
ff(["-f", "lavfi", "-i", "anoisesrc=color=white:a=1:d=0.12:r=44100:seed=33",
  "-af", "highpass=f=900,aeval='val(0)*(min(1,t/0.0008)*exp(-t*90)+0.5*gte(t,0.025)*exp(-(t-0.025)*120))',aformat=channel_layouts=stereo",
  "-c:a", "pcm_s16le", `${OUT}/crack.wav`]);
// sizzle: bright noise, crackling (random on/off grains), fading over 0.5 s
ff(["-f", "lavfi", "-i", "anoisesrc=color=white:a=0.8:d=0.5:r=44100:seed=44",
  "-af", "highpass=f=4000,aeval='val(0)*min(1,t/0.01)*exp(-t*6)*(0.3+0.7*gt(abs(sin(floor(t*220)*78.233)),0.5))',aformat=channel_layouts=stereo",
  "-c:a", "pcm_s16le", `${OUT}/sizzle.wav`]);
const A = [["pop.wav", 0.7, AT], ["pop.wav", 0.6, AT + 90], ["pop.wav", 0.5, AT + 180], ["slice.wav", 0.55, AT + 290], ["ring.wav", 0.6, AT + 290]];
const B = [["pop.wav", 0.6, AT], ["pop.wav", 0.6, AT + 70], ["pop.wav", 0.75, AT + 140], ["slice.wav", 0.55, AT + 240], ["ring.wav", 0.6, AT + 240]];
for (const [base, parts, end] of [["A", A, AT + 420], ["B", B, AT + 370]]) {
  mix(`${base}-bang`, [...parts, ["bang.wav", 0.6, end]]);
  mix(`${base}-crack`, [...parts, ["crack.wav", 0.6, end]]);
  mix(`${base}-sizzle`, [...parts, ["sizzle.wav", 0.45, end]]);
}

// the pick: B-sizzle, made as loud as the live mtg4 sounds
fs.mkdirSync(path.join(ROOT, "tmp", "upload8"), { recursive: true });
ff(["-i", `${OUT}/B-sizzle.mp3`, "-af", "lowpass=f=18600,volume=6.02dB,alimiter=limit=0.891:attack=1:release=40:level=disabled,apad=whole_dur=2",
  "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", "-id3v2_version", "3", "-metadata", "title=mtg5-instant", path.join(ROOT, "tmp", "upload8", "mtg5-instant.mp3")]);
