// Picture and name check for every card the engine knows (bridge/forge-cards.json).
// Asks Scryfall's collection API in batches of 75 (about 10 requests a second, backing off on 429) and records,
// per card: the Scryfall id, layout, EDHREC rank, release date and the picture URLs the table would use.
// Then samples the image server to confirm the URLs load.
//   node tools/check-card-images.js            -> tmp/card-check.json + docs/card-image-check.md
// Also fills bridge/image-cache-klrmngr.json, so games don't have to look these up while you play.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "bridge", "forge-cards.json"), "utf8")).index;
const names = [...new Set(Object.values(index))].sort();
const OUT = path.join(ROOT, "tmp", "card-check.json");
const REPORT = path.join(ROOT, "docs", "card-image-check.md");
const CACHE = path.join(ROOT, "bridge", "image-cache-klrmngr.json");
const UA = { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "mtg-tts-bridge/0.1" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const img = (side, id) => `https://img.klrmngr.com/display/${side}/${id[0]}/${id[1]}/${id}.webp`;

async function collection(batch) {
  // (only a rate limit, a server error or a dropped connection is waited out, and not for ever: a 400/404/422 answers the
  // same to the same body, and retrying it looped for ever, 2026-11-27)
  for (let wait = 1000, attempt = 1; ; wait = Math.min(wait * 2, 60000), attempt++) {
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST", headers: UA, body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
    }).catch((e) => ({ ok: false, status: e.message, dropped: true }));
    if (res.ok) return res.json();
    if (!(res.dropped || res.status === 429 || res.status >= 500) || attempt >= 10) throw new Error(`Scryfall answered ${res.status} to a batch of ${batch.length} names (attempt ${attempt}): ${batch.slice(0, 3).join(", ")} ...`);
    console.log(`  Scryfall ${res.status}; waiting ${wait / 1000} s`);
    await sleep(wait);
  }
}

(async () => {
  const result = {};
  const notFound = [];
  const t0 = Date.now();
  for (let i = 0; i < names.length; i += 75) {
    const batch = names.slice(i, i + 75);
    const body = await collection(batch);
    const byName = {};
    for (const c of body.data || []) {
      byName[norm(c.name)] = c;
      for (const f of c.card_faces || []) byName[norm(f.name)] ??= c;
    }
    for (const n of batch) {
      const c = byName[norm(n)] || byName[norm(n.split(" // ")[0])];
      if (!c) { notFound.push(n); continue; }
      const faces = c.card_faces || [];
      result[n] = {
        id: c.id, layout: c.layout, edhrec: c.edhrec_rank ?? null, released: c.released_at, set: c.set,
        type: c.type_line, faces: faces.map((f) => f.name),
        front: img("front", c.id), back: faces.length > 1 && faces[1].image_uris ? img("back", c.id) : null,
      };
    }
    if ((i / 75) % 40 === 0) console.log(`${Math.min(i + 75, names.length)}/${names.length} (${notFound.length} not found)`);
    await sleep(110);
  }
  fs.writeFileSync(OUT, JSON.stringify(result));

  // sample the image server: the URL shape the table uses has to actually serve pictures
  const all = Object.entries(result);
  const sample = [];
  for (let k = 0; k < 200; k++) sample.push(all[Math.floor((k + 0.5) * all.length / 200)]);
  const dfcs = all.filter(([, v]) => v.back).slice(0, 25);
  const broken = [];
  for (const [n, v] of [...sample, ...dfcs]) {
    for (const u of [v.front, v.back].filter(Boolean)) {
      const r = await fetch(u, { method: "HEAD" }).catch(() => ({ status: "error" }));
      if (r.status !== 200) broken.push(`${n}: ${u} -> ${r.status}`);
      await sleep(40);
    }
  }

  // fill the bridge's picture cache (front name, full name and back-face name)
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch {}
  for (const [n, v] of all) {
    const entry = { face: v.front, back: v.back };
    cache[norm(n)] ??= entry;
    if (v.faces[0]) cache[norm(v.faces[0])] ??= entry;
    if (v.faces[1] && v.back) cache[norm(v.faces[1])] ??= { face: v.back, back: v.front };
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));

  const layouts = {};
  for (const [, v] of all) layouts[v.layout] = (layouts[v.layout] || 0) + 1;
  const md = [
    "# Card picture and name check", "",
    `Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC over every card the engine knows: ${names.length} names, ${Math.round((Date.now() - t0) / 1000)} s.`, "",
    `- **Found on Scryfall:** ${all.length}`,
    `- **Not found:** ${notFound.length}${notFound.length ? " (listed below; these cards would show the card back)" : ""}`,
    `- **Image server sample:** ${sample.length} cards + ${dfcs.length} double-faced backs checked, ${broken.length} broken`, "",
    "## Layouts", "", "| Layout | Cards |", "|---|---|",
    ...Object.entries(layouts).sort((a, b) => b[1] - a[1]).map(([l, n]) => `| ${l} | ${n} |`), "",
    "## Not found", "", ...(notFound.length ? notFound.map((n) => `- ${n}`) : ["None."]), "",
    "## Broken pictures in the sample", "", ...(broken.length ? broken.map((b) => `- ${b}`) : ["None."]), "",
  ].join("\n");
  fs.writeFileSync(REPORT, md);
  console.log(`done: ${all.length} found, ${notFound.length} not found, ${broken.length} broken in sample -> ${path.relative(ROOT, REPORT)}`);
})();
