// Builds test decks that together hold one card for every Magic keyword (docs/keywords-by-card-count.md): for each
// keyword the most-played Commander-legal card Forge knows. 61 keyword cards per deck + a five-colour commander and
// 38 lands. Writes tmp/kwdecks/kwdeck-NN.json (Manabrew preset format) and tmp/kwdecks/keyword-cards.json.
//   node tools/make-keyword-decks.js
const https = require("https"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const get = (u) => new Promise((res, rej) => https.get(u, { headers: { "User-Agent": "mtg-tts/1.0", Accept: "application/json" } }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on("error", rej));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const known = new Set(Object.values(require(path.join(ROOT, "bridge", "forge-cards.json")).index));
const COMMANDER = "Kenrith, the Returned King";
const LANDS = ["Command Tower", "Exotic Orchard", "City of Brass", "Mana Confluence"];
const BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
(async () => {
  const md = fs.readFileSync(path.join(ROOT, "docs", "keywords-by-card-count.md"), "utf8");
  const rows = [...md.matchAll(/^\| \d+ \| (.+?) \| (.+?) \| (\d+) \| (\d+) \|$/gm)].map((m) => ({ kw: m[1], kind: m[2], commander: +m[4] })).filter((r) => r.commander > 0);
  const out = fs.existsSync(path.join(ROOT, "tmp", "kwdecks", "keyword-cards.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "kwdecks", "keyword-cards.json"), "utf8")) : {};
  const used = new Set(Object.values(out).filter(Boolean).map((x) => x.card));
  for (const r of rows) {
    if (out[r.kw] !== undefined) continue;
    const q = (r.kind === "Ability word" ? `o:"${r.kw.toLowerCase()} —"` : `keyword:"${r.kw}"`) + " legal:commander -t:basic";
    let pick = null, failed = false; // (failed: the last try got an error, not an answer)
    for (let tries = 0; tries < 4 && !pick; tries++) {
      await sleep(700 + tries * 3000);
      failed = false;
      try {
        const res = await get(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=edhrec`);
        // (a 404 is Scryfall's "no card matches": a real null. A 429 or 5xx is not an answer; it was cached as "no card"
        // for good and the keyword vanished from every deck, 2026-11-27)
        if (res.object === "error") { if (res.status === 404) break; failed = true; continue; }
        for (const c of res.data || []) {
          const name = c.name.split(" // ")[0];
          if (known.has(name) && !used.has(name) && name !== COMMANDER) { pick = { card: name, kind: r.kind, type: c.type_line }; break; }
        }
        if (!pick) break;
      } catch { failed = true; }
    }
    if (!pick && failed) { process.stdout.write("?"); continue; } // (not cached: the next run asks again)
    out[r.kw] = pick;
    if (pick) used.add(pick.card);
    fs.mkdirSync(path.join(ROOT, "tmp", "kwdecks"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "tmp", "kwdecks", "keyword-cards.json"), JSON.stringify(out, null, 1));
    process.stdout.write(pick ? "." : "x");
  }
  const picks = Object.entries(out).filter(([, v]) => v);
  // spells only in the 61 slots; keyword lands go in too (they count as spells here, the deck still gets 38 lands)
  const per = 61, decks = [];
  for (let i = 0; i < picks.length; i += per) decks.push(picks.slice(i, i + per));
  decks.forEach((list, d) => {
    const cards = [{ name: COMMANDER, count: 1 }, ...list.map(([, v]) => ({ name: v.card, count: 1 })), ...LANDS.map((n) => ({ name: n, count: 1 }))];
    const basics = 100 - cards.length;
    BASICS.forEach((b, i) => cards.push({ name: b, count: Math.floor(basics / 5) + (i < basics % 5 ? 1 : 0) }));
    const id = `kwdeck-${String(d + 1).padStart(2, "0")}`;
    fs.writeFileSync(path.join(ROOT, "tmp", "kwdecks", `${id}.json`), JSON.stringify({ id, label: `Keyword deck ${d + 1}`, commander: COMMANDER, format: "commander", cards,
      keywords: Object.fromEntries(list.map(([k, v]) => [v.card, k])) }, null, 1));
  });
  console.log(`\n${picks.length} keywords with a card, ${Object.values(out).filter((v) => !v).length} without; ${decks.length} decks`);
})();
