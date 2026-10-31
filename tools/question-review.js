// Ease-of-use review of every question the hand-play sweep met (tools/handplay.js records what the player saw for
// each one: the instruction line, the corner buttons, the card row, and the Engine panel if it had to open). Groups
// them by shape (card names and numbers taken out), counts them and flags friction against Arena's style: short
// imperative titles ("Discard a card."), plain buttons ("Keep", "Done"), the question answered where you play.
//   node tools/question-review.js [autoplay json files...]   (default: tmp/coverage/autoplay-hp-*.json)
// Writes tmp/handplay/questions.md.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
let files = process.argv.slice(2);
if (!files.length) files = fs.readdirSync(path.join(ROOT, "tmp", "coverage")).filter((f) => /^autoplay-hp-\d+\.json$/.test(f)).map((f) => path.join("tmp", "coverage", f));

const JARGON = [/priority/i, /triggered ability/i, /replacement effect/i, /\(taken \d/, /pick #/, /Source:/, /tts-\w+-/, /player-\d/,
  /\{LIFE\}/, /Card\.\w/, /ChosenCard/, /\r/, /\bnull\b/, /undefined/, /\bValid\b/, /SpellAbility/, /\bSelect\b/, /engine/i, /\[object/];
const shape = (t, src) => String(t ?? "")
  .replace(src ? new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : /$^/, "<card>")
  .replace(/\{[^}]+\}/g, "{x}").replace(/\d+/g, "N").replace(/\s+/g, " ").trim();

const groups = new Map();
let total = 0;
for (const f of files) {
  let r;
  try { r = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/^[^{]*/, "")); } catch { continue; }
  const deck = path.basename(f, ".json").replace("autoplay-", "");
  for (const q of r.questions || []) {
    total++;
    if (q.type === "chooseAction") continue; // the priority stop: buttons only, reviewed separately below
    const key = `${q.type} | ${shape(q.title, q.src)}`;
    const g = groups.get(key) || { key, n: 0, panel: 0, row: 0, decks: new Set(), ex: [] };
    g.n++; if (q.panel) g.panel++; if (q.row) g.row++; g.decks.add(deck);
    if (g.ex.length < 3) g.ex.push({ deck, ...q });
    groups.set(key, g);
  }
}
const flags = (q) => {
  const out = [];
  if (q.panel) out.push("needed the Engine panel");
  const shown = [q.title, q.hint, q.rowtitle, q.rowsub, q.text, q.big, q.big2, ...(q.btns || []), ...(q.rowbtns || []), ...(q.opts || [])].filter(Boolean).join(" ");
  for (const j of JARGON) if (j.test(shown)) out.push(`jargon ${j}`);
  if (String(q.title || "").length > 55) out.push(`long title (${String(q.title).length})`);
  if (String(q.text || "").length > 170) out.push(`long text (${String(q.text).length})`);
  if ((q.n || 0) > 8) out.push(`${q.n} choices`);
  for (const b of [...(q.btns || []), ...(q.rowbtns || []), q.big, q.big2].filter(Boolean)) if (String(b).length > 38) { out.push(`long button "${String(b).slice(0, 50)}"`); break; }
  return [...new Set(out)];
};
const lines = [`# Questions the hand-play sweep met (${new Date().toISOString().slice(0, 16).replace("T", " ")})`, "",
  `${total} questions in ${files.length} games, ${groups.size} shapes (not counting the priority stop). Sorted: friction first, then how often.`, ""];
const rows = [...groups.values()].map((g) => ({ g, f: [...new Set(g.ex.flatMap(flags))] })).sort((a, b) => (b.f.length > 0) - (a.f.length > 0) || b.g.n - a.g.n);
for (const { g, f } of rows) {
  lines.push(`## ${g.key}  (${g.n}x, panel ${g.panel}, row ${g.row}; ${[...g.decks].slice(0, 6).join(" ")})`);
  if (f.length) lines.push(`**Friction:** ${f.join("; ")}`);
  for (const q of g.ex.slice(0, 2)) {
    lines.push(`- ${q.deck} t${q.turn}${q.src ? ` [${q.src}]` : ""}: title "${q.title}"`);
    if (q.hint && q.hint.trim()) lines.push(`  - instruction line: "${q.hint}"`);
    if (q.big || q.big2) lines.push(`  - corner: [${q.big ?? ""}] [${q.big2 ?? ""}]`);
    if (q.row) lines.push(`  - card row: "${q.rowtitle ?? ""}" / "${q.rowsub ?? ""}" buttons ${JSON.stringify(q.rowbtns || [])}`);
    if (q.panel) lines.push(`  - panel: "${q.title ?? ""}" text "${String(q.text ?? "").slice(0, 200)}" buttons ${JSON.stringify(q.btns || [])}`);
    if (!q.panel && !q.row) lines.push(`  - options: ${JSON.stringify(q.opts)}`);
  }
  lines.push("");
}
// the priority stop: which corner labels and instruction lines players see
const prio = new Map();
for (const f of files) {
  let r; try { r = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/^[^{]*/, "")); } catch { continue; }
  for (const q of r.questions || []) if (q.type === "chooseAction") { const k = `[${q.big ?? ""}] [${q.big2 ?? ""}] "${(q.hint || "").trim()}"`; prio.set(k, (prio.get(k) || 0) + 1); }
}
lines.push("## Priority stop: corner buttons and instruction line", "");
for (const [k, n] of [...prio].sort((a, b) => b[1] - a[1]).slice(0, 25)) lines.push(`- ${n}x ${k}`);
fs.writeFileSync(path.join(ROOT, "tmp", "handplay", "questions.md"), lines.join("\n"));
console.log(`${total} questions, ${groups.size} shapes, ${rows.filter((r) => r.f.length).length} with friction -> tmp/handplay/questions.md`);
