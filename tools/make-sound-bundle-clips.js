// Prepares the clips of the route B sound bundle, mtg-sounds.unity3d (docs/m5-assetbundle-build.md section 4): one
// trigger effect per engineSounds key, each playing the very sound that key's link plays through the music player
// (route A), so switching routes changes how a sound is played, never what is heard.
//   node tools/make-sound-bundle-clips.js [assetsDir] [unityProject]
//   defaults: assets (this checkout's, gitignored) and C:/Users/you/mtg-unity/Tabletop-Simulator-Modding
// Then the Unity build (MtgSoundsBuild.Build in the Unity project's Assets/Editor) makes the bundle from what this
// writes: <unityProject>/Assets/MTG/Sounds/<clip>.wav and sounds.tsv. FFMPEG overrides the path to ffmpeg.exe.
//
// - The keys and their links: the engineSounds table in tools/engine-renderer.lua. Keys sharing a link share a clip
//   (treasurespend* are death's links: one clip, two trigger effects).
// - Each link's file: the uploaded mp3 in assets/sounds/tts (mtg2-<kind>[-xN].mp3; mtg3- for treasure and sorcery,
//   docs/sounds.md), checked against the sha256 docs/sounds.md records for that file where it records one (a
//   mismatch stops the run: the file is not the one uploaded). The 2026-11-11 files (damage, exile, lifegain, wipe
//   and their 2026-11-11 bursts) have no recorded hash; they are the only copies of those names on disk.
// - The clip: the mp3 decoded to 44.1 kHz 16-bit WAV (channels kept: the bursts lean left and right), the music
//   player's silence padding cut off (everything after the last sample over -60 dBFS), plus 20 ms of silence. Unity
//   compresses it (Vorbis) when it imports it. No gain, no filter: the level is the uploaded file's.
// - sounds.tsv: name, clip, seconds, source file, sha256, link, one row per engineSounds key, in the table's order
//   (the link: what SOUNDS.md, and the test that holds the bundle to the table, compare with engineSounds).
// A run on the same files with the same ffmpeg writes the same clips, byte for byte.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const FF = process.env.FFMPEG || "C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe";
const assets = process.argv[2] || path.join(ROOT, "assets");
const unity = process.argv[3] || "C:/Users/you/mtg-unity/Tabletop-Simulator-Modding";
const outDir = path.join(unity, "Assets", "MTG", "Sounds");
const RATE = 44100;
const FLOOR = Math.pow(10, -60 / 20); // the padding cut: the last sample over -60 dBFS ends the sound
const TAIL = 0.02; // seconds of silence kept after it

// engineSounds' keys and links, in the table's order
function soundTable() {
  const src = fs.readFileSync(path.join(ROOT, "tools", "engine-renderer.lua"), "utf8");
  const at = src.indexOf("\nengineSounds = engineSounds or {");
  if (at < 0) throw new Error("no engineSounds table in tools/engine-renderer.lua");
  const end = src.indexOf("\n}", at);
  const rows = [];
  for (const line of src.slice(at, end).split("\n")) {
    const m = line.match(/^\s*([a-z0-9_]+) = "(https?:\/\/[^"]+)"/);
    if (m) rows.push({ name: m[1], link: m[2] });
  }
  if (rows.length === 0) throw new Error("engineSounds has no links");
  return rows;
}
// docs/sounds.md's recorded files: name -> { sha, secs } (a table row starting with the file's name)
function recorded() {
  const out = {};
  for (const line of fs.readFileSync(path.join(ROOT, "docs", "sounds.md"), "utf8").split("\n")) {
    const m = line.match(/^\| (mtg[23]-[a-z0-9-]+\.mp3)[ |]/);
    if (!m) continue;
    const shas = line.match(/`([0-9a-f]{64})`/g);
    const secs = line.split("|")[2]?.match(/(\d+\.\d+) s/);
    if (shas) out[m[1]] = { sha: shas[shas.length - 1].slice(1, -1), secs: secs ? Number(secs[1]) : null };
  }
  return out;
}
// the uploaded file of a key: mtg2-death-x4.mp3 for death_x4; mtg3- for treasure* and sorcery (the remade one)
function fileOf(name) {
  const base = name.replace(/_x(\d+)$/, "-x$1");
  const pre = /^treasure|^sorcery$/.test(name) ? "mtg3-" : "mtg2-";
  return pre + base + ".mp3";
}
// a file kept under another name (docs/sounds.md "Sorcery remake": the uploaded mtg3-sorcery.mp3 is the work folder's
// mtg2-sorcery-new.mp3; the sha256 check still holds it to the uploaded one)
const ELSEWHERE = { "mtg3-sorcery.mp3": ["test/mtg2-sorcery-new.mp3"] };
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
// decoded to interleaved 16-bit samples; -> { pcm: Buffer, ch }
function decode(file) {
  const probe = spawnSync(FF, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const ch = /\b(stereo)\b/.test(probe.stderr || "") ? 2 : 1;
  const r = spawnSync(FF, ["-hide_banner", "-i", file, "-ar", String(RATE), "-ac", String(ch), "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${file}`);
  return { pcm: r.stdout, ch };
}
// the sound without its padding: up to the last frame with a sample over FLOOR, then TAIL of silence
function trim({ pcm, ch }) {
  const frames = pcm.length / (2 * ch);
  let last = 0;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < ch; c++) if (Math.abs(pcm.readInt16LE((f * ch + c) * 2)) / 32768 > FLOOR) last = f;
  }
  const keep = last + 1 + Math.round(TAIL * RATE);
  const out = Buffer.alloc(keep * ch * 2);
  pcm.copy(out, 0, 0, Math.min(pcm.length, (last + 1) * ch * 2));
  return { pcm: out, ch, secs: keep / RATE };
}
function writeWav(file, { pcm, ch }) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

function main() {
  const rows = soundTable();
  const docs = recorded();
  const tts = path.join(assets, "sounds", "tts");
  fs.mkdirSync(outDir, { recursive: true });
  // (each run writes every clip again; a clip no longer in the table goes afterwards, with its .meta: the Unity build
  // would otherwise import it. The others keep their .meta, so the prefab's references to them stay the same)
  const before = fs.readdirSync(outDir).filter((f) => /\.wav$/.test(f));
  const clipOf = {}; // link -> { clip, secs, file, sha }
  const lines = ["# name\tclip\tseconds\tsource\tsha256\tlink"];
  const notes = [];
  for (const { name, link } of rows) {
    if (clipOf[link] === undefined) {
      const file = fileOf(name);
      const full = [path.join(tts, file), ...(ELSEWHERE[file] || []).map((f) => path.join(assets, "sounds", f))].find((f) => fs.existsSync(f));
      if (full === undefined) throw new Error(`${name}: no ${file} in ${tts}`);
      const sha = sha256(full);
      const doc = docs[file];
      if (doc && doc.sha !== sha) throw new Error(`${name}: ${file} is not the uploaded file (sha256 ${sha}, docs/sounds.md ${doc.sha})`);
      if (!doc) notes.push(`${file}: no sha256 in docs/sounds.md`);
      const t = trim(decode(full));
      if (doc && doc.secs != null && Math.abs(t.secs - TAIL - doc.secs) > 0.12) notes.push(`${file}: ${(t.secs - TAIL).toFixed(2)} s of sound, docs/sounds.md says ${doc.secs} s`);
      writeWav(path.join(outDir, name + ".wav"), t);
      clipOf[link] = { clip: name, secs: t.secs, file, sha };
    }
    const c = clipOf[link];
    lines.push([name, c.clip, c.secs.toFixed(3), c.file, c.sha, link].join("\t"));
  }
  const keep = new Set(Object.values(clipOf).map((c) => c.clip + ".wav"));
  for (const f of before) {
    if (keep.has(f)) continue;
    fs.rmSync(path.join(outDir, f));
    fs.rmSync(path.join(outDir, f + ".meta"), { force: true });
  }
  fs.writeFileSync(path.join(outDir, "sounds.tsv"), lines.join("\n") + "\n");
  console.log(`${rows.length} trigger effects, ${Object.keys(clipOf).length} clips -> ${outDir}`);
  for (const n of notes) console.log("note: " + n);
}
main();
