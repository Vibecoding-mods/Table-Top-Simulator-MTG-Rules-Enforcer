// Screenshots of the Arena-style effects during a live game (for a collage / visual check): watches what the bridge
// sends the table (tmp/tts-stream.jsonl) and takes a TTS-window screenshot (tools/tts-shot.ps1) the first time each
// kind of moment happens. Never runs Lua in TTS (each such call pauses TTS ~360 ms).
//   node tools/effect-shots.js [minutes=40] [outDir=tmp/collage]
const fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const MIN = Number(process.argv[2] || 40);
const OUT = path.join(ROOT, process.argv[3] || "tmp/collage");
fs.mkdirSync(OUT, { recursive: true });
const F = path.join(ROOT, "tmp", "tts-stream.jsonl");
let pos = fs.statSync(F).size;
let carry = Buffer.alloc(0); // (the unfinished last line of what was read)
const shots = {}; // kind -> count
const want = { turn: 1, playable: 1, target: 2, attack: 2, block: 1, life: 2, badge: 2, death: 2, popup: 1, gameover: 1, choice: 1 };
const prev = { life: {}, bf: {}, turn: null, active: null };
const queue = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function shoot(kind, note, delayMs) {
  if ((shots[kind] || 0) >= (want[kind] || 1) || queue.some((q) => q.kind === kind)) return;
  queue.push({ kind, note, at: Date.now() + delayMs });
}
async function flush() {
  queue.sort((a, b) => a.at - b.at);
  while (queue.length && queue[0].at <= Date.now()) {
    const q = queue.shift();
    if ((shots[q.kind] || 0) >= (want[q.kind] || 1)) continue;
    shots[q.kind] = (shots[q.kind] || 0) + 1;
    const file = path.join(OUT, `${q.kind}-${shots[q.kind]}.jpg`);
    let taken = false;
    try { execFileSync("powershell", ["-NoProfile", "-File", path.join(ROOT, "tools", "tts-shot.ps1"), file], { stdio: "ignore" }); taken = fs.existsSync(file); } catch { }
    // (no TTS window: not counted as a shot, so the kind is tried again at its next trigger, and not logged as one)
    if (!taken) { shots[q.kind]--; console.log(new Date().toISOString().slice(11, 19), q.kind, q.note, "-> NO SHOT (tts-shot.ps1 failed)"); continue; }
    console.log(new Date().toISOString().slice(11, 19), q.kind, q.note, "->", path.basename(file));
  }
}
function onMessage(m) {
  if (m.t === "table") {
    const t = JSON.parse(m.json);
    if (prev.turn !== null && t.turn !== prev.turn && t.active) shoot("turn", `${t.active}'s turn`, 450);
    prev.turn = t.turn;
    if (t.gameOver) shoot("gameover", `winner ${t.winner}`, 3300);
    for (const pl of t.players || []) {
      if (pl.life != null && prev.life[pl.color] != null && pl.life !== prev.life[pl.color]) shoot("life", `${pl.color} ${prev.life[pl.color]} -> ${pl.life}`, 500);
      if (pl.life != null) prev.life[pl.color] = pl.life;
      if (pl.battlefield) {
        const now = new Set(pl.battlefield.map((c) => c.id));
        const gone = Object.keys(prev.bf).filter((id) => prev.bf[id] === pl.color && !now.has(id));
        if (gone.some((id) => (pl.graveyard || []).some((c) => c.id === id))) shoot("death", `${pl.color} lost ${gone.length}`, 900);
        for (const id of Object.keys(prev.bf)) if (prev.bf[id] === pl.color) delete prev.bf[id];
        for (const c of pl.battlefield) prev.bf[c.id] = pl.color;
        if (pl.battlefield.some((c) => c.atk)) shoot("attack", `${pl.color} attacks`, 400);
        if (pl.battlefield.some((c) => c.blk)) shoot("block", `${pl.color} blocks`, 400);
        if (pl.battlefield.some((c) => (c.dmg || 0) > 0 || c.ctr || (c.p != null && c.bp != null && String(c.p) !== String(c.bp)))) shoot("badge", `${pl.color} badge`, 500);
      }
    }
    if ((t.stack || []).some((s) => (s.tg || []).length)) shoot("target", "a spell or ability with targets", 400);
    else if ((t.stack || []).length) shoot("popup", "something on the stack", 400);
  } else if (m.t === "prompt") {
    const p = JSON.parse(m.json);
    if (p.color !== "White" || !p.promptId) return;
    if (p.kind === "priority" && (p.options || []).some((o) => o.cardId)) shoot("playable", "cards you can play glow green", 700);
    if (p.kind === "target") shoot("target", p.title, 600);
    if (p.kind === "attack") shoot("attack", "choosing attackers", 600);
    if (p.kind === "yesno" || p.kind === "choice" || p.kind === "modal") shoot("choice", p.title, 600);
  }
}
(async () => {
  const end = Date.now() + MIN * 60000;
  while (Date.now() < end) {
    await sleep(250);
    const size = fs.statSync(F).size;
    if (size > pos) {
      const fd = fs.openSync(F, "r"); const buf = Buffer.alloc(size - pos); fs.readSync(fd, buf, 0, buf.length, pos); fs.closeSync(fd); pos = size;
      // (a line still being written is kept for the next round, not parsed in halves and lost)
      const all = Buffer.concat([carry, buf]);
      const cut = all.lastIndexOf(10) + 1;
      carry = all.subarray(cut);
      for (const line of all.subarray(0, cut).toString("utf8").split("\n")) { try { const x = JSON.parse(line); if (x.msg) onMessage(x.msg); } catch { } }
    }
    await flush();
    if (Object.keys(want).every((k) => (shots[k] || 0) >= want[k])) break;
    if (shots.gameover) { await sleep(500); await flush(); break; }
  }
  console.log("done", JSON.stringify(shots));
})();
