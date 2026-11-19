// Builds bridge/forge-cards.json: every card name Forge knows, so `mtg ready` can check decks before a game.
// Reads the card scripts inside the running engine container (rerun after updating the Manabrew image).
//   node build-forge-card-index.js [container]
// With --formats, builds bridge/forge-formats.json instead (docs/game-modes-spec.md §3.3): each named format's legal
// card names, ban list and restricted list, from a local Forge checkout's own format and edition files (no container).
//   node build-forge-card-index.js --formats [--res <forge>/forge-gui/res] [--only Standard,Pioneer]
// With --legality, builds bridge/forge-legality.json, the offline ban list fallback (see buildLegality).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Same normalisation the bridge applies to names read from TTS cards.
const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'")
  .replace(/\s+/g, " ").trim().toLowerCase();
const option = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };

// ───────── formats (--formats) ─────────
// The edition sections Forge reads as printings (CardEdition.EditionSectionWithCollectorNumbers): a card in any other
// section ("special guests", "dual basic", the booster sheets) is no printing in that set, so it makes nothing legal.
const PRINTING_SECTIONS = new Set(["cards", "special slot", "precon product", "borderless", "etched", "showcase", "full art", "extended art",
  "alternate art", "retro frame", "buy a box", "promo", "prerelease promo", "bundle", "box topper", "jumpstart", "rebalanced", "eternal",
  "conjured", "scheme", "printsheets"]);
// A card line as Forge's CardEdition.Reader.CARD_PATTERN reads it: "[collector number] [rarity] name [@artist] [${params}]"
const CARD_LINE = /^(?:(.?[0-9A-Z-]+\S*[A-Z]*)\s)?(?:([SCURML])\s)?([^@$]+?)(?: @[^$]*)?(?: \$\{.+\})?$/;

// "[section]" blocks of a Forge text file: { name: [lines] }, names lower-cased as Forge's FileSection does
function sections(text) {
  const out = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[(.+)\]$/.exec(line);
    if (head) { cur = head[1].trim().toLowerCase(); (out[cur] ??= []); continue; }
    if (cur && line && !line.startsWith("#")) out[cur].push(line);
  }
  return out;
}
// a format file's "Key:value" lines; the lists are split as Forge's GameFormat reader splits them
function readFormat(text) {
  const kv = {};
  for (const line of sections(text).format || []) { const i = line.indexOf(":"); if (i > 0) kv[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  const list = (s, sep) => (s ? s.split(sep).map((x) => x.trim()).filter(Boolean) : []);
  return { name: kv.name, sets: list(kv.sets, ","), banned: list(kv.banned, ";"), restricted: list(kv.restricted, ";"),
    additional: list(kv.additional, ";"), rarities: list(kv.rarities, ",") };
}
// set code (upper case) -> the card names of its printings
function readEditions(dir) {
  const bySet = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".txt"))) {
    const s = sections(fs.readFileSync(path.join(dir, f), "utf8"));
    const code = (s.metadata || []).map((l) => /^Code=(.+)$/i.exec(l)?.[1]).find(Boolean);
    if (!code) continue;
    const names = bySet.get(code.trim().toUpperCase()) || new Set();
    for (const [sec, lines] of Object.entries(s)) {
      if (!PRINTING_SECTIONS.has(sec)) continue;
      for (const l of lines) { const m = CARD_LINE.exec(l); if (m && m[3].trim()) names.add(m[3].trim()); }
    }
    bySet.set(code.trim().toUpperCase(), names);
  }
  return bySet;
}
// The legal names of format `fmt` as the bridge looks them up (forge-cards.json's names: a back face or a split half
// typed in an edition file maps to the card), plus what Forge's file says. A card in a listed set and not banned is
// legal (GameFormat.buildFilter: printed in an allowed set, then the ban list); rarities are left to the reader.
function legalNames(fmt, bySet, index) {
  const canon = (n) => index[norm(n)] || n;
  const banned = new Set(fmt.banned.map(canon));
  const legal = new Set();
  const missing = fmt.sets.filter((c) => !bySet.has(c.toUpperCase()));
  for (const code of fmt.sets) for (const n of bySet.get(code.toUpperCase()) || []) { const c = canon(n); if (!banned.has(c)) legal.add(c); }
  for (const n of fmt.additional) legal.add(canon(n));
  return { sets: fmt.sets, missingSets: missing, banned: [...banned].sort(), restricted: fmt.restricted.map(canon).sort(),
    rarities: fmt.rarities, legal: [...legal].sort((a, b) => a.localeCompare(b)) };
}
// Cards whose own rules change the 4-copy limit, as Forge's DeckFormat reads them: "K:A deck can have any number of
// cards named CARDNAME." (canHaveAnyNumberOf) -> "any"; "K:DeckLimit:N" (canHaveSpecificNumberInDeck) -> N. From every
// script in cardsfolder (its subfolders too), by the script's first Name.
function copyLimits(cardsDir) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith(".txt")) continue;
      const t = fs.readFileSync(p, "utf8");
      if (!t.includes("A deck can have any number") && !t.includes("DeckLimit")) continue;
      const name = /^Name:(.+)$/m.exec(t)?.[1].trim();
      if (!name) continue;
      if (/^K:A deck can have any number of cards named CARDNAME\.\s*$/m.test(t)) out[name] = "any";
      // ("K:DeckLimit:7:A deck can have up to seven cards named CARDNAME.": the reminder after the number)
      else { const n = /^K:DeckLimit:(\d+)(?::|\s*$)/m.exec(t); if (n) out[name] = Number(n[1]); }
    }
  };
  walk(cardsDir);
  return out;
}
function buildFormats() {
  const root = path.join(__dirname, "..");
  const res = path.resolve(option("res", path.join(root, "manabrew", "forge", "forge-gui", "res")));
  const only = option("only", "Standard").split(",").map((x) => x.trim()).filter(Boolean);
  const index = JSON.parse(fs.readFileSync(path.join(root, "bridge", "forge-cards.json"), "utf8")).index;
  const bySet = readEditions(path.join(res, "editions"));
  let commit = null;
  try { commit = execFileSync("git", ["-C", res, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
  const formats = {};
  for (const name of only) {
    const file = path.join(res, "formats", "Sanctioned", `${name}.txt`);
    const fmt = readFormat(fs.readFileSync(file, "utf8"));
    if (!fmt.sets.length) throw new Error(`${name}: no Sets line (every set legal): not supported, the list would be every card`);
    formats[fmt.name || name] = legalNames(fmt, bySet, index);
    const f = formats[fmt.name || name];
    console.log(`${fmt.name || name}: ${f.sets.length} sets${f.missingSets.length ? ` (no edition file: ${f.missingSets.join(", ")})` : ""}, ${f.legal.length} legal names, ${f.banned.length} banned`);
    if (f.missingSets.length) process.exitCode = 1;
  }
  // (every card's: the format checks use them for every format, not only the formats built here. Keeping only
  // Standard's left Relentless Rats, Seven Dwarves and Nazgûl out, so a Commander or Modern deck of them was refused)
  const limits = {};
  for (const [n, v] of Object.entries(copyLimits(path.join(res, "cardsfolder")))) limits[index[norm(n)] || n] = v;
  console.log(`copy limits other than 4: ${Object.entries(limits).map(([n, v]) => `${n} (${v})`).join(", ") || "none"}`);
  const out = path.join(root, "bridge", "forge-formats.json");
  fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), forge: commit, copyLimits: limits, formats }, null, 1) + "\n");
  console.log(`-> ${out}`);
}

// ───────── the ban list fallback (--legality) ─────────
// bridge/forge-legality.json (docs/format-banlist-spec.md §4.4): Forge's format files in the shape of the Scryfall cache
// bridge/legality.js reads (§4.3), so the bridge has lists offline before its first download. Per Scryfall format key,
// one status letter per card: l legal, b banned, r restricted, n not legal. A format file with no Sets line allows every
// set (Commander); a Rarities line keeps only printings of those rarities (Pauper: L, C). Timeless and Alchemy are in
// Forge's archive, one file a list update: the newest is read.
//   node build-forge-card-index.js --legality [--res <forge>/forge-gui/res] [--date YYYY-MM-DD]
const FORGE_LISTS = { standard: "Sanctioned/Standard.txt", pioneer: "Sanctioned/Pioneer.txt", modern: "Sanctioned/Modern.txt",
  legacy: "Sanctioned/Legacy.txt", vintage: "Sanctioned/Vintage.txt", pauper: "Sanctioned/Pauper.txt", historic: "Sanctioned/Historic.txt",
  commander: "Casual/Commander.txt", predh: "Casual/PreDH.txt", premodern: "Casual/Premodern.txt",
  timeless: "Archived/Timeless/", alchemy: "Archived/Alchemy/" };
// set code -> Map(card name -> Set of rarity letters), the printing sections only (as readEditions)
function readPrintings(dir) {
  const bySet = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".txt"))) {
    const s = sections(fs.readFileSync(path.join(dir, f), "utf8"));
    const code = (s.metadata || []).map((l) => /^Code=(.+)$/i.exec(l)?.[1]).find(Boolean);
    if (!code) continue;
    const key = code.trim().toUpperCase();
    const names = bySet.get(key) || new Map();
    for (const [sec, lines] of Object.entries(s)) {
      if (!PRINTING_SECTIONS.has(sec)) continue;
      for (const l of lines) {
        const m = CARD_LINE.exec(l);
        if (!m || !m[3].trim()) continue;
        const n = m[3].trim();
        if (!names.has(n)) names.set(n, new Set());
        if (m[2]) names.get(n).add(m[2]);
      }
    }
    bySet.set(key, names);
  }
  return bySet;
}
function buildLegality() {
  const root = path.join(__dirname, "..");
  const res = path.resolve(option("res", path.join(root, "manabrew", "forge", "forge-gui", "res")));
  const index = JSON.parse(fs.readFileSync(path.join(root, "bridge", "forge-cards.json"), "utf8")).index;
  const canon = (n) => index[norm(n)] || n;
  const bySet = readPrintings(path.join(res, "editions"));
  // (the date shown with the lists: the Forge pin's, --date, when the checkout has local commits on top)
  let date = option("date", null);
  if (!date) try { date = execFileSync("git", ["-C", res, "log", "-1", "--format=%cs"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
  const keys = Object.keys(FORGE_LISTS);
  const formats = {}, legal = {};
  for (const k of keys) {
    let file = path.join(res, "formats", FORGE_LISTS[k]);
    if (file.endsWith(path.sep) || FORGE_LISTS[k].endsWith("/")) file = path.join(file, fs.readdirSync(file).filter((x) => x.endsWith(".txt")).sort().pop());
    const fmt = readFormat(fs.readFileSync(file, "utf8"));
    const rarities = new Set(fmt.rarities.map((r) => r.toUpperCase()));
    const sets = fmt.sets.length ? fmt.sets.map((c) => c.toUpperCase()) : [...bySet.keys()];
    const names = new Set();
    for (const code of sets) for (const [n, r] of bySet.get(code) || []) if (!rarities.size || [...r].some((x) => rarities.has(x))) names.add(canon(n));
    for (const n of fmt.additional) names.add(canon(n));
    legal[k] = names;
    formats[k] = { banned: [...new Set(fmt.banned.map(canon))].sort(), restricted: [...new Set(fmt.restricted.map(canon))].sort() };
    console.log(`${k}: ${path.relative(path.join(res, "formats"), file)}, ${names.size} printed names, ${formats[k].banned.length} banned, ${formats[k].restricted.length} restricted`);
  }
  const banned = Object.fromEntries(keys.map((k) => [k, new Set(formats[k].banned)]));
  const restricted = Object.fromEntries(keys.map((k) => [k, new Set(formats[k].restricted)]));
  const cards = {};
  for (const n of Object.keys(index).sort()) {
    const c = index[n];
    cards[n] = keys.map((k) => (banned[k].has(c) ? "b" : restricted[k].has(c) ? "r" : legal[k].has(c) ? "l" : "n")).join("");
  }
  const { hashOf } = require(path.join(root, "bridge", "legality.js"));
  const out = path.join(root, "bridge", "forge-legality.json");
  fs.writeFileSync(out, JSON.stringify({ source: "forge", date, built: new Date().toISOString(), keys, formats, cards, hash: hashOf(keys, formats, cards) }) + "\n");
  console.log(`${Object.keys(cards).length} names -> ${out}`);
}

// ───────── card names (the default) ─────────
function buildIndex() {
  const CONTAINER = process.argv[2] || "stack-forge-room-1";
  const DIR = "/build/forge/forge-gui/res/cardsfolder";
  // One line per card script: "<split 0|1>\t<face name>\t<face name>..."
  const awk = `FNR==1{if(n)print s "\\t" out; n=0; out=""; s=0}
/^Name:/{sub(/^Name:/,""); sub(/\\r$/,""); out=out (n?"\\t":"") $0; n++}
/^AlternateMode:[ ]*Split/{s=1}
END{if(n)print s "\\t" out}`;
  const raw = execFileSync("docker", ["exec", CONTAINER, "sh", "-c",
    `cd ${DIR} && find . -name '*.txt' -print0 | xargs -0 awk '${awk.replace(/'/g, "'\\''")}'`],
    { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });

  const index = {}; // normalised name (any face, or "A // B") → name to send the engine
  let cards = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [split, ...faces] = line.split("\t").filter((x, i) => i === 0 || x);
    if (!faces.length) continue;
    cards++;
    // Forge finds split cards by their full name and double-faced/adventure cards by the front face.
    const canonical = split === "1" && faces.length > 1 ? faces.join(" // ") : faces[0];
    for (const key of [canonical, faces.join(" // "), ...faces]) {
      const k = norm(key);
      if (!(k in index) || key === faces[0]) index[k] = canonical; // a front-face name wins over a back face elsewhere
    }
  }
  const out = path.join(__dirname, "..", "bridge", "forge-cards.json");
  fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), cards, index }));
  console.log(`${cards} cards, ${Object.keys(index).length} lookup names → ${out}`);
}

if (require.main === module) { if (process.argv.includes("--legality")) buildLegality(); else if (process.argv.includes("--formats")) buildFormats(); else buildIndex(); }
module.exports = { sections, readFormat, legalNames, CARD_LINE, PRINTING_SECTIONS };
