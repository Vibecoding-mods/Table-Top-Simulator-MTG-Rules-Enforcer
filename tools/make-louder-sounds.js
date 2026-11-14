// Makes every table sound twice as strong (+6.02 dB, double the amplitude), from the exact files the links play.
// The user's ask, 2026-11-13: "raise all sound effects by double".
//   node tools/make-louder-sounds.js [gainDb] [tag]      defaults 6.02 and mtg4
// Source: for each link in engineSounds (tools/engine-renderer.lua), the uploaded file itself, from TTS's Steam Cloud
// folder (Steam/userdata/<id>/286160/remote/<LINK HASH>_<name>.mp3), so nothing is downloaded and nothing is guessed.
// Out: assets/sounds/<tag>/<tag>-<sound>.mp3 (gitignored like the rest of assets/), the recipe of docs/sounds.md:
// low-passed at 18.6 kHz (what the limiter sees is what the mp3 keeps), the gain, a limiter at -1 dBFS for the peaks the
// gain pushes over, padded to at least 2 s (TTS loads no shorter clip), libmp3lame 192k with an ID3 title (TTS rejects
// VLC mp3s). Prints each file's peak and RMS before and after, and writes <tag>/manifest.json: key -> { source, out }.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const FF = process.env.FFMPEG || path.join(os.homedir(), "AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe");
const gainDb = Number(process.argv[2] || 6.02);
const tag = process.argv[3] || "mtg4";
const root = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "tools", "engine-renderer.lua"), "utf8");
const block = renderer.slice(renderer.indexOf("engineSounds = engineSounds or {"));
const table = block.slice(0, block.indexOf("\n}") + 2);
const links = {};
for (const m of table.matchAll(/^\s*(\w+) = "(https:\/\/steamusercontent[^"]+)"/gm)) links[m[1]] = m[2];
const steam = "C:/Program Files (x86)/Steam/userdata";
const cloud = fs.readdirSync(steam).map((u) => path.join(steam, u, "286160", "remote")).filter((d) => fs.existsSync(d));
const files = cloud.flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f)));
const out = path.join(root, "assets", "sounds", tag);
fs.mkdirSync(out, { recursive: true });
function level(file) {
  const r = spawnSync(FF, ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const peak = /max_volume: (-?[\d.]+) dB/.exec(r.stderr), rms = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr);
  return `peak ${peak ? peak[1] : "?"} rms ${rms ? rms[1] : "?"}`;
}
const done = {}, manifest = {};
let fail = 0;
for (const [key, link] of Object.entries(links)) {
  const hash = link.replace(/\/$/, "").split("/").pop();
  const src = files.find((f) => path.basename(f).startsWith(hash + "_"));
  if (!src) { console.log(`MISSING ${key}: no cloud file for ${hash}`); fail++; continue; }
  const name = path.basename(src).slice(hash.length + 1).replace(/^mtg\d?-/, "").replace(/\.mp3$/, "");
  const dst = path.join(out, `${tag}-${name}.mp3`);
  manifest[key] = { source: path.basename(src), out: path.basename(dst) };
  if (done[dst]) continue; // (treasurespend plays death's own files)
  done[dst] = true;
  const af = `lowpass=f=18600,volume=${gainDb}dB,alimiter=limit=0.891:attack=1:release=40:level=disabled,apad=whole_dur=2`;
  const r = spawnSync(FF, ["-hide_banner", "-y", "-i", src, "-af", af, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100",
    "-id3v2_version", "3", "-metadata", `title=${tag}-${name}`, dst], { encoding: "utf8" });
  if (r.status !== 0) { console.log(`FAIL ${key}: ${r.stderr.split("\n").slice(-3).join(" ")}`); fail++; continue; }
  console.log(`${path.basename(dst)}: ${level(src)} -> ${level(dst)}`);
}
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`${Object.keys(manifest).length} keys, ${Object.keys(done).length} files in ${out}${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
