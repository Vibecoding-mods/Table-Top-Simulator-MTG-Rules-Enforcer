// Counts how many distinct cards (by Oracle text) have each Magic keyword, using Scryfall's keyword catalogs and
// search totals. Writes docs/keywords-by-card-count.md.  node tools/keyword-counts.js
const https = require("https"), fs = require("fs");
const get = (u) => new Promise((res, rej) => https.get(u, { headers: { "User-Agent": "mtg-tts/1.0", Accept: "application/json" } }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on("error", rej));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Scryfall allows ~10 requests/s but rate-limits bursts of large result pages: go slowly and retry
async function total(q) {
  for (let tries = 0; tries < 5; tries++) {
    await sleep(600 + tries * 4000);
    try {
      const r = await get("https://api.scryfall.com/cards/search?q=" + encodeURIComponent(q));
      if (r.object === 'list') return r.total_cards || 0;
      if (r.object === 'error' && r.status === 404) return 0;
    } catch {}
  }
  return -1;
}
// results are kept in tmp/keyword-cache.json: a rerun only looks up what failed before
const CACHE = "tmp/keyword-cache.json";
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
(async () => {
  const kinds = { "keyword-abilities": "Keyword ability", "keyword-actions": "Keyword action", "ability-words": "Ability word" };
  const rows = [];
  for (const [cat, label] of Object.entries(kinds)) {
    const c = await get(`https://api.scryfall.com/catalog/${cat}`);
    for (const kw of c.data) {
      const q = cat === "ability-words" ? `o:"${kw.toLowerCase()} —"` : `keyword:"${kw}"`;
      const hit = cache[q];
      const n = hit && hit.n >= 0 ? hit.n : await total(q);
      const commander = hit && hit.n >= 0 && hit.commander >= 0 ? hit.commander : n > 0 ? await total(q + ' legal:commander') : 0;
      cache[q] = { n, commander };
      fs.writeFileSync(CACHE, JSON.stringify(cache));
      rows.push({ kw, label, n, commander });
      process.stdout.write(".");
    }
  }
  rows.sort((a, b) => b.n - a.n);
  const out = ["# Magic keywords by number of cards", "", `Source: Scryfall search totals (distinct cards by Oracle text), ${new Date().toISOString().slice(0, 10)}. "Commander" counts only cards legal in Commander.`, "",
    "| # | Keyword | Kind | Cards | Commander-legal |", "|---|---|---|---|---|",
    ...rows.filter((r) => r.n > 0).map((r, i) => `| ${i + 1} | ${r.kw} | ${r.label} | ${r.n} | ${r.commander} |`),
    "", `Lookups that failed: ${rows.filter((r) => r.n < 0).map((r) => r.kw).join(", ") || "none"}`, `Keywords with no cards found: ${rows.filter((r) => r.n === 0).map((r) => r.kw).join(", ") || "none"}`];
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/keywords-by-card-count.md", out.join("\n") + "\n");
  console.log(`\n${rows.length} keywords; top: ${rows.slice(0, 10).map((r) => `${r.kw} ${r.n}`).join(", ")}`);
})();
