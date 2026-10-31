// Builds a save from a base save plus objects exported from the live table (tmp/export/<guid>.json, each from
// obj.getJSON()). Card-image numbers of 1,000,000 and up are renumbered from 2000 (TTS snapshot cost grows with the
// number). Objects found under the table are lifted back on top, spread out so decks don't land on each other.
// usage: node tools/add-exported-objects.js <base.json> <export dir> <out.json>
const fs = require("fs"), path = require("path");
const [base, dir, out] = process.argv.slice(2);
const save = JSON.parse(fs.readFileSync(base, "utf8"));
const remap = new Map(); let next = 2000;
// start above the numbers already in use (an export that was renumbered before keeps its own; never reuse one)
{
  const seen = (o) => { for (const k of Object.keys(o.CustomDeck || {})) if (+k < 1000000 && +k >= next) next = +k + 1; (o.ContainedObjects || []).forEach(seen); Object.values(o.States || {}).forEach(seen); };
  save.ObjectStates.forEach(seen);
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) seen(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  if (next >= 3000) console.warn('warning: picture numbers reach the engine range (3000+)');
}
const key = (k) => { k = Number(k); if (k < 1000000) return k; if (!remap.has(k)) remap.set(k, next++); return remap.get(k); };
const fix = (o) => {
  if (o.CustomDeck) { const cd = {}; for (const [k, v] of Object.entries(o.CustomDeck)) cd[key(k)] = v; o.CustomDeck = cd; }
  if (o.CardID != null) o.CardID = key(Math.floor(o.CardID / 100)) * 100 + (o.CardID % 100);
  if (o.DeckIDs) o.DeckIDs = o.DeckIDs.map((id) => key(Math.floor(id / 100)) * 100 + (id % 100));
  if (o.States) Object.values(o.States).forEach(fix);
  (o.ContainedObjects || []).forEach(fix);
};
const have = new Set(save.ObjectStates.map((o) => o.GUID));
let lifted = 0; const names = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const o = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (have.has(o.GUID)) continue;
  fix(o);
  if (o.Transform.posY < -5) { o.Transform.posY = 2 + lifted * 0.5; o.Transform.posX += 6 * (lifted % 3); lifted++; }
  save.ObjectStates.push(o);
  names.push(`${o.Name} '${String(o.Nickname || "").split("\n")[0]}'${o.Name === "Deck" ? ` (${o.ContainedObjects.length})` : ""}`);
}
save.SaveName = "MTG 4 player table - ENGINE MODE + your decks";
fs.writeFileSync(out, JSON.stringify(save, null, 2));
console.log(`added ${names.length} (${lifted} lifted from under the table, ${remap.size} picture numbers renumbered): ${names.join(", ")}`);
