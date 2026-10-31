// Report for the hand-play sweep: reads tmp/coverage/autoplay-hp-NN.json (tools/handplay.js output) for each deck and
// writes tmp/handplay/report.md: each gesture kind (tried / the engine got it / refused with a reason / missed),
// every missed gesture with what the table told the player, table-vs-engine mismatches, Lua errors, stuck questions,
// and which keyword cards were cast by dragging them.
//   node tools/handplay-report.js [deck files...]   (default: every tmp/handplay/hp-*.json)
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
let decks = process.argv.slice(2);
if (!decks.length) decks = fs.readdirSync(path.join(ROOT, "tmp", "handplay")).filter((f) => /^hp-\d+\.json$/.test(f)).map((f) => `tmp/handplay/${f}`);
const kinds = {}, missed = [], problems = [], errors = [], stuck = [], kwRows = [];
let games = 0;
for (const d of decks) {
  const deck = JSON.parse(fs.readFileSync(path.join(ROOT, d), "utf8"));
  const n = path.basename(d, ".json");
  let r = null;
  try { r = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "coverage", `autoplay-${n}.json`), "utf8").replace(/^[^{]*/, "")); } catch { }
  if (!r) { stuck.push(`${n}: no result (the game didn't run)`); continue; }
  games++;
  for (const [k, g] of Object.entries(r.gestures || {})) {
    const s = (kinds[k] ||= { tried: 0, ok: 0, refused: 0 });
    s.tried += g.tried; s.ok += g.ok; s.refused += g.refused || 0;
  }
  for (const f of r.failed || []) missed.push({ deck: n, ...f });
  for (const p of r.problems || []) problems.push(`${n}: ${p}`);
  for (const e of r.errors || []) errors.push(`${n}: ${e}`);
  for (const s of r.stuck || []) stuck.push(`${n}: ${s}`);
  const cast = new Set(r.castByDrag || []);
  for (const [card, kw] of Object.entries(deck.keywords || {})) kwRows.push({ deck: n, kw, card, cast: [...cast].some((c) => c.startsWith(card.split(" // ")[0])) });
}
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const out = [`# Hand-play sweep (${new Date().toISOString().slice(0, 16).replace("T", " ")})`, "",
  `${games} of ${decks.length} decks played. A gesture counts as **got it** when the engine did what the gesture meant within 4 s; **refused** when it didn't but the table told the player why (no mana, no legal target...); **missed** otherwise.`, "",
  "| Gesture | Tried | Got it | Refused (said why) | Missed |", "|---|---|---|---|---|"];
for (const [k, s] of Object.entries(kinds).sort()) out.push(`| ${k} | ${s.tried} | ${s.ok} (${pct(s.ok, s.tried)}) | ${s.refused} | ${s.tried - s.ok - s.refused} |`);
const realMiss = missed.filter((m) => !m.refused);
out.push("", `## Missed gestures (${realMiss.length})`, "");
for (const m of realMiss.slice(0, 80)) out.push(`- ${m.deck} turn ${m.turn}, **${m.kind}**: ${m.what} -> ${m.state} (gesture: ${m.did})${m.told ? ` (table said: ${m.told})` : ""}`);
out.push("", `## Refused, with a reason (${missed.length - realMiss.length})`, "");
for (const m of missed.filter((x) => x.refused).slice(0, 40)) out.push(`- ${m.deck} turn ${m.turn}, ${m.kind}: ${m.what} (${m.told})`);
out.push("", `## Table vs engine mismatches (${problems.length})`, "", ...problems.slice(0, 40).map((p) => `- ${p}`));
out.push("", `## Lua errors (${errors.length})`, "", ...errors.slice(0, 20).map((p) => `- ${p}`));
out.push("", `## Stuck (${stuck.length})`, "", ...stuck.map((p) => `- ${p}`));
const castN = kwRows.filter((r) => r.cast).length;
out.push("", `## Keyword cards cast by dragging: ${castN} of ${kwRows.length}`, "", "Not cast (not drawn, no mana, or missed; see above):", "",
  kwRows.filter((r) => !r.cast).map((r) => `${r.kw} (${r.card})`).join(", "));
fs.writeFileSync(path.join(ROOT, "tmp", "handplay", "report.md"), out.join("\n") + "\n");
console.log(out.slice(0, 6 + Object.keys(kinds).length).join("\n"));
console.log(`missed ${realMiss.length}, refused ${missed.length - realMiss.length}, mismatches ${problems.length}, errors ${errors.length}, stuck ${stuck.length}; keyword cards cast by drag ${castN}/${kwRows.length}`);
