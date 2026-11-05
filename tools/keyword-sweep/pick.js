// Picks a test card for each keyword the sweep covers, from Forge's own card scripts (manabrew/forge/forge-gui/res/
// cardsfolder): the cheapest card of one colour or none with that keyword on a K: line, an instant, sorcery or
// creature, ties broken by the shortest script (the fewest other abilities to get in the way). Writes
// tests/keyword-sweep.json, the steps tests/live_events_check.js runs with --sweep.
//   node tools/keyword-sweep/pick.js
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const CARDS = path.join(ROOT, "manabrew", "forge", "forge-gui", "res", "cardsfolder");

// key: the step's name; k: the keyword as Forge's K: line starts; how: "cast" from the hand, or the action to pick by
// its label; from: where the card is put first; word: what the log must say for the keyword to have been named
const KEYWORDS = [
  { key: "flashback", k: "Flashback", how: "Flashback", from: "graveyard", word: "flashback" },
  { key: "unearth", k: "Unearth", how: "Unearth", from: "graveyard", word: "unearth" },
  { key: "embalm", k: "Embalm", how: "Embalm", from: "graveyard", word: "embalm" },
  { key: "eternalize", k: "Eternalize", how: "Eternalize", from: "graveyard", word: "eternaliz" },
  { key: "scavenge", k: "Scavenge", how: "Scavenge", from: "graveyard", word: "scaveng" },
  // (a plain cast from the graveyard: Forge's action names no keyword for these two)
  { key: "retrace", k: "Retrace", how: "cast", from: "graveyard", word: "retrace" },
  { key: "jumpstart", k: "Jump-start", how: "cast", from: "graveyard", word: "jump.?start" },
  { key: "disturb", k: "Disturb", how: "Disturb", from: "graveyard", word: "disturb" },
  { key: "encore", k: "Encore", how: "Encore", from: "graveyard", word: "encore" },
  { key: "landcycling", k: "TypeCycling", how: "\\w*cycling", word: "cycl" },
  { key: "evoke", k: "Evoke", how: "Evoke", word: "evoke" },
  { key: "dash", k: "Dash", how: "Dash", word: "dash" },
  { key: "blitz", k: "Blitz", how: "Blitz", word: "blitz" },
  { key: "cascade", k: "Cascade", how: "cast", word: "cascade" },
  { key: "rebound", k: "Rebound", how: "cast", word: "rebound" },
  { key: "buyback", k: "Buyback", how: "cast", word: "buyback|returns to" },
  { key: "casualty", k: "Casualty", how: "cast", word: "casualty|sacrificed", token: true },
  { key: "transmute", k: "Transmute", how: "Transmute", word: "transmute|discards" },
  // (the second batch, 2026-11-03)
  { key: "cycling", k: "Cycling", how: "Cycling", word: "cycl" },
  // (escape exiles other cards from the graveyard: three hand cards go there first)
  { key: "escape", k: "Escape", how: "Escape", from: "graveyard", word: "escape", graveFill: 3 },
  { key: "kicker", k: "Kicker", how: "cast", word: "kick" },
  { key: "overload", k: "Overload", how: "Overload", word: "overload" },
  { key: "bestow", k: "Bestow", how: "Bestow", word: "bestow", token: true },
  { key: "emerge", k: "Emerge", how: "Emerge", word: "emerge", token: true },
  { key: "levelup", k: "Level up", how: "Level up", from: "battlefield", word: "levels up" },
  { key: "reinforce", k: "Reinforce", how: "Reinforce", word: "reinforce", token: true },
  { key: "storm", k: "Storm", how: "cast", word: "storm|copies" },
  { key: "entwine", k: "Entwine", how: "cast", word: "entwine" },
  { key: "awaken", k: "Awaken", how: "Awaken", word: "awaken", needs: "Mountain" },
  // (cast face down for {3}, whatever the card costs)
  { key: "morph", k: "Morph", how: "face down", word: "face-down", mana: "C C C" },
  { key: "impending", k: "Impending", how: "Impending", word: "impending" },
  { key: "prototype", k: "Prototype", how: "Prototype", word: "prototype" },
  { key: "offspring", k: "Offspring", how: "cast", word: "offspring" },
  { key: "cleave", k: "Cleave", how: "Cleave", word: "cleave" },
];

const COLOURS = { W: "W", U: "U", B: "B", R: "R", G: "G" };
function parse(file) {
  const t = fs.readFileSync(file, "utf8");
  const get = (k) => (new RegExp(`^${k}:(.*)$`, "m").exec(t) || [])[1]?.trim();
  return { name: get("Name"), cost: get("ManaCost") || "", types: get("Types") || "", text: t, size: t.length, faces: (t.match(/^ALTERNATE/m) ? 2 : 1) };
}
// "2 U U" -> its mana value and the mana the test pays it with (generic as that colour)
function costOf(cost) {
  const parts = cost.split(/\s+/).filter(Boolean);
  if (!parts.length || parts.some((p) => !/^(\d+|[WUBRGC])$/.test(p))) return null;
  const colours = new Set(parts.filter((p) => COLOURS[p]));
  if (colours.size > 1) return null;
  const c = [...colours][0] || "C";
  const pips = parts.flatMap((p) => (/^\d+$/.test(p) ? Array(Number(p)).fill(c) : [p]));
  return { mv: pips.length, mana: pips.join(" ") };
}

const all = [];
for (const dir of fs.readdirSync(CARDS).filter((d) => fs.statSync(path.join(CARDS, d)).isDirectory())) for (const f of fs.readdirSync(path.join(CARDS, dir))) if (f.endsWith(".txt")) all.push(path.join(CARDS, dir, f));
const out = [];
for (const kw of KEYWORDS) {
  const line = new RegExp(`^K:${kw.k.replace(/[-]/g, "\\-")}(:|$)`, "m");
  const found = [];
  for (const file of all) {
    const c = parse(file);
    if (!c.name || c.faces > 1 || !line.test(c.text) || !/\b(Instant|Sorcery|Creature)\b/.test(c.types)) continue;
    // (the keyword's own cost, for a card cast or used by it: "K:Flashback:1 R" -> 1 R)
    const kwCost = new RegExp(`^K:${kw.k.replace(/[-]/g, "\\-")}:([^:\\n]*)`, "m").exec(c.text)?.[1] || "";
    // (the mana of it only: escape's "R ExileFromGrave<2/Card.Other>" is R)
    const cost = costOf(c.cost), more = costOf(kwCost.replace(/<[^>]*>/g, "").split(/\s+/).filter((p) => /^(\d+|[WUBRGC])$/.test(p)).join(" "));
    if (!cost) continue;
    found.push({ name: c.name, mv: cost.mv, size: c.size, mana: [cost.mana, more?.mana || ""].join(" ").trim() });
  }
  found.sort((a, b) => a.mv - b.mv || a.size - b.size);
  const pick = found[0];
  if (!pick) { process.stdout.write(`no card for ${kw.key}\n`); continue; }
  out.push({ key: kw.key, cast: pick.name, ...(kw.how !== "cast" ? { ability: kw.how } : {}), mana: kw.mana || pick.mana, ...(kw.from ? { fromZone: kw.from } : {}), word: kw.word,
    ...(kw.token ? { token: true } : {}), ...(kw.graveFill ? { graveFill: kw.graveFill } : {}), ...(kw.needs ? { needs: kw.needs, needsZone: "battlefield" } : {}) });
  process.stdout.write(`${kw.key.padEnd(12)} ${pick.name} (${pick.mana}), ${found.length} with the keyword\n`);
}
fs.writeFileSync(path.join(ROOT, "tests", "keyword-sweep.json"), JSON.stringify({ steps: out }, null, 2) + "\n");
