// Small keyword decks for the follow-up rounds: the keywords not yet played (docs/keyword-test-results.md), 15 per
// deck + Kenrith + 24 lands = 40 cards, so a game draws most of the deck.
//   node tools/make-keyword-decks-small.js <round>  -> tmp/kwsmall/r<round>-NN.json
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const round = process.argv[2] || "1";
const picks = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "kwdecks", "keyword-cards.json"), "utf8"));
const md = fs.readFileSync(path.join(ROOT, "docs", "keyword-test-results.md"), "utf8");
// KW_DONE_MD=a.md,b.md: more reports whose "played" rows count as done (the re-check rounds write their own)
const mds = [md, ...(process.env.KW_DONE_MD || "").split(",").filter(Boolean).map((f) => fs.readFileSync(f, "utf8"))];
const done = new Set(mds.flatMap((t) => [...t.matchAll(/^\| (.+?) \| .+? \| played \|/gm)].map((m) => m[1])));
const todo = Object.entries(picks).filter(([kw, p]) => p && !done.has(kw));
const PER = Number(process.env.KW_PER || 15); // keyword cards per 40-card deck
const LANDS = ["Command Tower", "Exotic Orchard", "City of Brass", "Mana Confluence"];
// KW_TUTORS=1: ten tutors in every deck, so the keyword cards get found (the driver searches for them first)
const TUTORS = process.env.KW_TUTORS ? ["Demonic Tutor", "Diabolic Tutor", "Grim Tutor", "Vampiric Tutor", "Imperial Seal", "Worldly Tutor",
  "Enlightened Tutor", "Mystical Tutor", "Gamble", "Eladamri's Call"] : [];
const BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const dir = path.join(ROOT, "tmp", "kwsmall");
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) if (f.startsWith(`r${round}-`)) fs.unlinkSync(path.join(dir, f));
let n = 0;
for (let i = 0; i < todo.length; i += PER) {
  const list = todo.slice(i, i + PER);
  const cards = [{ name: "Kenrith, the Returned King", count: 1 }, ...list.map(([, v]) => ({ name: v.card, count: 1 })), ...TUTORS.map((x) => ({ name: x, count: 1 })), ...LANDS.map((x) => ({ name: x, count: 1 }))];
  const basics = 40 - cards.length;
  BASICS.forEach((b, k) => cards.push({ name: b, count: Math.floor(basics / 5) + (k < basics % 5 ? 1 : 0) }));
  n++;
  const id = `r${round}-${String(n).padStart(2, "0")}`;
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, label: `Keyword small ${id}`, commander: "Kenrith, the Returned King", format: "commander", cards,
    keywords: Object.fromEntries(list.map(([k, v]) => [v.card, k])) }, null, 1));
}
console.log(`round ${round}: ${todo.length} keywords to go, ${n} decks of 40`);
