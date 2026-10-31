// Decks for the hand-play sweep (tools/handplay-sweep.sh): every keyword in tmp/kwdecks/keyword-cards.json, 15 per
// 40-card deck (+ Kenrith + 24 lands), and the everyday-mechanics decks (cards from the 2026-10-21 playtest and the
// gestures a player makes most: tap abilities, fetch lands, removal, counterspells, searches, discards, tokens,
// counters, two-faced cards, equipment, auras).
//   node tools/make-handplay-decks.js   -> tmp/handplay/hp-NN.json (mechanics first)
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const picks = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "kwdecks", "keyword-cards.json"), "utf8"));
const PER = Number(process.env.KW_PER || 15);
const LANDS = ["Command Tower", "Exotic Orchard", "City of Brass", "Mana Confluence"];
const BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const MECHANICS = [
  // tap abilities and fetch lands (turned with Q/E), mana creatures and rocks
  ["Hermit Druid", "Verdant Catacombs", "Evolving Wilds", "Prodigal Sorcerer", "Llanowar Elves", "Sol Ring", "Arcane Signet",
    // removal and counters (targets clicked), protection
    "Feed the Swarm", "Imp's Mischief", "Counterspell", "Swords to Plowshares", "Lightning Bolt", "Beast Within", "Lightning Greaves", "Heroic Intervention"],
  // searches, discards, library, tokens, counters, two-faced cards, equipment, auras, sacrifice, graveyard
  ["Demonic Tutor", "Cultivate", "Faithless Looting", "Brainstorm", "Ponder", "Raise the Alarm", "Hardened Scales",
    "Valakut Awakening // Valakut Stoneforge", "Bonecrusher Giant", "Bonesplitter", "Rancor", "Sakura-Tribe Elder", "Raise Dead", "Think Twice", "Wrath of God"],
];
const dir = path.join(ROOT, "tmp", "handplay");
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) if (/^deck-\d+\.json$/.test(f)) fs.unlinkSync(path.join(dir, f));
const groups = [...MECHANICS.map((m, i) => ({ label: `Mechanics ${i + 1}`, list: m.map((card) => [card, { card }]) }))];
const kws = Object.entries(picks).filter(([, p]) => p && p.card);
for (let i = 0; i < kws.length; i += PER) groups.push({ label: `Keywords ${i / PER + 1}`, list: kws.slice(i, i + PER) });
groups.forEach((g, k) => {
  const seen = new Set();
  const cards = [{ name: "Kenrith, the Returned King", count: 1 }];
  for (const [, v] of g.list) if (!seen.has(v.card)) { seen.add(v.card); cards.push({ name: v.card, count: 1 }); }
  for (const x of LANDS) cards.push({ name: x, count: 1 });
  const basics = 40 - cards.reduce((n, c) => n + c.count, 0);
  BASICS.forEach((b, j) => cards.push({ name: b, count: Math.floor(basics / 5) + (j < basics % 5 ? 1 : 0) }));
  const id = String(k + 1).padStart(2, "0");
  fs.writeFileSync(path.join(dir, `hp-${id}.json`), JSON.stringify({ id, label: `Hand-play ${g.label}`, commander: "Kenrith, the Returned King",
    format: "commander", cards, keywords: Object.fromEntries(g.list.map(([kw, v]) => [v.card, kw])) }, null, 1));
});
console.log(`${groups.length} decks of 40 (${MECHANICS.length} mechanics, ${groups.length - MECHANICS.length} keyword) -> tmp/handplay/`);
