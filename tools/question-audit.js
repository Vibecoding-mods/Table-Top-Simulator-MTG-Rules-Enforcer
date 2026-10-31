// Question audit: every question the table was asked in recorded games (a bridge's MTG_RECORD stream, e.g. the
// headless sweep's tmp/tts-stream-headless.jsonl), grouped by deck, with the wording that has meant a bug before
// flagged: a bare "choose a card" / "choose one" / "choose any you want", "Use X?", Forge's own marks (HTML tags,
// "[Zone Changer: ...]", "(Targeting: ...)", card numbers "Name (37)", CARDNAME, player-view-N), empty or
// "Choice N" labels, two options with the same label. A review list for a person, not a test.
// Games are named by a "Test deck NN" chat line, or else in order from an optional list of the decks played (the
// headless sweep says no deck name: tmp/sweep-decks.txt, one game per "started").
//   node tools/question-audit.js [stream.jsonl] [sinceEpochMs] [deckList.txt] > tmp/question-audit.md
const fs = require("fs");
const file = process.argv[2] || "tmp/tts-stream-headless.jsonl";
const since = Number(process.argv[3] || 0);
const deckNames = process.argv[4] ? fs.readFileSync(process.argv[4], "utf8").split(/\s+/).filter(Boolean).map((d) => require("path").basename(d, ".json")) : [];
let games = 0;
// ("Roaming Throne: choose a creature type" is the card's own question, as Arena asks it: not flagged)
const FLAGS = [
  [/: choose (?:a card|one|up to \d+(?: cards?)?|\d+ cards?|a target|a color|a basic land)$/i, "bare 'choose ...': say what it is for"],
  [/choose any you want$/i, "'choose any you want'"],
  [/^Use .+\?$|: use .+\?$/i, "'Use X?': say what it does"],
  [/<\/?[a-z][^>]*>/i, "HTML in the text"],
  [/\[Zone Changer:|\(Targeting:|\[Phase:/i, "Forge's internal notes"],
  // (two digits at least: "Demonic Tutor (1)" is a pick count, "Goblin King (37)" Forge's card number)
  [/[A-Za-z] \(\d{2,}\)/, "a Forge card number"],
  [/CARDNAME|NICKNAME|player-view-\d/, "an unreplaced placeholder"],
  [/^Choice \d+$/, "a 'Choice N' label"],
];
const decks = new Map(); // deck -> Map(title -> { n, options, flags })
let deck = "(before any deck)";
const lines = fs.readFileSync(file, "utf8").split("\n");
for (const line of lines) {
  if (!line) continue;
  let rec;
  try { rec = JSON.parse(line); } catch { continue; }
  if (rec.at < since || !rec.msg) continue;
  let m;
  try { m = JSON.parse(rec.msg.json || "{}"); } catch { continue; }
  if (m.t === "started") { deck = deckNames[games] || `game ${games + 1}`; games++; continue; }
  if (m.t === "chat") {
    const j = String(m.text || "").match(/Test deck (\d+)/);
    if (j) deck = `Test deck ${j[1]}`;
    continue;
  }
  if (m.t !== "prompt" || !m.title) continue;
  const title = String(m.title);
  const options = (m.options || []).map((o) => String(o.label ?? ""));
  const flags = new Set();
  for (const [re, why] of FLAGS) {
    if (re.test(title) || options.some((o) => re.test(o)) || re.test(String(m.text || ""))) flags.add(why);
  }
  if (options.some((o) => !o.trim())) flags.add("an empty label");
  const seen = new Set();
  // (only among buttons: two Swamps to tap or two Soldier tokens to attack with are normal)
  if (["modal", "choice", "yesno", "color"].includes(m.kind)) for (const o of options) { if (seen.has(o) && !/^(Island|Forest|Swamp|Mountain|Plains|Wastes)\b/.test(o)) flags.add(`two options read '${o.slice(0, 40)}'`); seen.add(o); }
  const key = title.replace(/#\d+/g, "#");
  if (!decks.has(deck)) decks.set(deck, new Map());
  const d = decks.get(deck);
  const e = d.get(key) || { n: 0, options: options.slice(0, 8), more: Math.max(0, options.length - 8), flags: new Set(), kind: m.kind };
  e.n++;
  for (const f of flags) e.flags.add(f);
  d.set(key, e);
}
const out = ["# Question audit", "", `Source: ${file}${since ? ` since ${new Date(since).toISOString()}` : ""}`, ""];
let flagged = 0;
for (const [name, d] of decks) {
  const rows = [...d.entries()].filter(([t]) => !/^Your priority$|^Choose attackers$|^Declare blockers$|^Choose blockers$|^Keep this hand\?$/.test(t));
  const bad = rows.filter(([, e]) => e.flags.size);
  flagged += bad.length;
  out.push(`## ${name}: ${rows.length} kinds of question, ${bad.length} flagged`, "");
  for (const [t, e] of [...bad, ...rows.filter(([, x]) => !x.flags.size)]) {
    out.push(`- ${e.flags.size ? "**FLAG** " : ""}"${t}" x${e.n} [${e.kind || "?"}]: ${e.options.join(" | ")}${e.more ? ` | ... (+${e.more})` : ""}${e.flags.size ? `\n  - ${[...e.flags].join("; ")}` : ""}`);
  }
  out.push("");
}
out.splice(3, 0, `${flagged} flagged question kinds in ${decks.size} decks.`, "");
console.log(out.join("\n"));
