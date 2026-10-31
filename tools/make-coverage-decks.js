// Builds test decks for the representative-card games: most popular cards first (EDHREC rank), with the newest
// sets mixed in, and every card layout the table has to draw (double-faced, split, adventure, flip, meld, saga,
// class, ...) represented early. Reads tmp/card-check.json (tools/check-card-images.js).
//   node tools/make-coverage-decks.js [decks=10] -> tmp/coverage/deck-01.json ... (Manabrew preset format)
// Each deck: a five-colour commander, 34 basics + 4 popular lands, 61 spells, singleton.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const N = Number(process.argv[2] || 10);
const cards = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "card-check.json"), "utf8"));
const OUT = path.join(ROOT, "tmp", "coverage");
fs.mkdirSync(OUT, { recursive: true });

const COMMANDER = "Kenrith, the Returned King";
const SKIP_LAYOUTS = new Set(["planar", "scheme", "vanguard", "token", "double_faced_token", "emblem", "art_series", "augment", "host", "reversible_card"]);
const BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const isBasic = (n) => BASICS.includes(n) || /^Snow-Covered /.test(n) || n === "Wastes";
const legalish = ([name, v]) => !SKIP_LAYOUTS.has(v.layout) && !/^A-/.test(name) && !isBasic(name) && name !== COMMANDER
  && !/\b(Conspiracy|Dungeon|Attraction|Contraption|Stickers?)\b/.test(v.type || "");

const pool = Object.entries(cards).filter(legalish);
const byRank = [...pool].sort((a, b) => (a[1].edhrec ?? 1e9) - (b[1].edhrec ?? 1e9) || String(b[1].released).localeCompare(String(a[1].released)));
const newest = [...pool].filter(([, v]) => v.edhrec != null).sort((a, b) => String(b[1].released).localeCompare(String(a[1].released)) || a[1].edhrec - b[1].edhrec);
const isLand = (v) => /\bLand\b/.test(v.type || "") && !/\/\//.test(v.type || "");

// one queue per rare layout (most popular first), so every deck carries some of each
const layoutQueues = {};
for (const e of byRank) if (e[1].layout !== "normal") (layoutQueues[e[1].layout] ||= []).push(e);

const used = new Set();
const take = (list, pred = () => true) => {
  for (const e of list) if (!used.has(e[0]) && pred(e[1])) { used.add(e[0]); return e; }
  return null;
};

const decks = [];
for (let d = 0; d < N; d++) {
  const spells = [];
  const lands = [];
  // 1. one of each rare layout (while the layout lasts)
  for (const [layout, q] of Object.entries(layoutQueues)) {
    for (let k = 0; k < 1; k++) { const e = take(q, (v) => !isLand(v) || layout !== "normal"); if (e) spells.push(e); }
  }
  // 2. four popular non-basic lands
  for (let k = 0; k < 4; k++) { const e = take(byRank, isLand); if (e) lands.push(e); }
  // 3. fill to 61 spells: two popular for each newest
  while (spells.length < 61) {
    const e = spells.length % 3 === 2 ? take(newest, (v) => !isLand(v)) : take(byRank, (v) => !isLand(v));
    if (!e) break;
    spells.push(e);
  }
  const entry = ([name, v]) => ({ name, count: 1, types: String(v.type || "").split(" — ")[0].split(" ").filter(Boolean), cmc: 0, text: "" });
  const deck = {
    id: `coverage-${String(d + 1).padStart(2, "0")}`,
    label: `Coverage deck ${d + 1}`,
    commander: COMMANDER,
    cards: [
      { name: COMMANDER, count: 1, types: ["Legendary", "Creature"], cmc: 0, text: "" },
      ...spells.slice(0, 61).map(entry),
      ...lands.map(entry),
      ...BASICS.map((b, i) => ({ name: b, count: i < 4 ? 7 : 6, types: ["Basic", "Land"], cmc: 0, text: "" })),
    ],
    layouts: [...new Set(spells.map(([, v]) => v.layout))],
  };
  const total = deck.cards.reduce((a, c) => a + c.count, 0);
  if (total !== 100) throw new Error(`deck ${d + 1} has ${total} cards`);
  fs.writeFileSync(path.join(OUT, `deck-${String(d + 1).padStart(2, "0")}.json`), JSON.stringify(deck, null, 1));
  decks.push(`${deck.id}: ${spells.length} spells (${deck.layouts.join(", ")}), top: ${spells.slice(0, 3).map(([n]) => n).join(", ")}`);
}
console.log(decks.join("\n"));
