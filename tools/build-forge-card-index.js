// Builds bridge/forge-cards.json: every card name Forge knows, so `mtg ready` can check decks before a game.
// Reads the card scripts inside the running engine container (rerun after updating the Manabrew image).
//   node build-forge-card-index.js [container]
// With --formats, builds bridge/forge-formats.json instead (docs/game-modes-spec.md §3.3): each named format's legal
// card names, ban list and restricted list, from a local Forge checkout's own format and edition files (no container).
//   node build-forge-card-index.js --formats [--res <forge>/forge-gui/res] [--only Standard,Pioneer]
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
      else { const n = /^K:DeckLimit:(\d+)\s*$/m.exec(t); if (n) out[name] = Number(n[1]); }
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
  // (only the cards some built format allows: the bridge needs no others)
  const allowed = new Set(Object.values(formats).flatMap((f) => f.legal));
  const limits = {};
  for (const [n, v] of Object.entries(copyLimits(path.join(res, "cardsfolder")))) { const c = index[norm(n)] || n; if (allowed.has(c)) limits[c] = v; }
  console.log(`copy limits other than 4: ${Object.entries(limits).map(([n, v]) => `${n} (${v})`).join(", ") || "none"}`);
  const out = path.join(root, "bridge", "forge-formats.json");
  fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), forge: commit, copyLimits: limits, formats }, null, 1) + "\n");
  console.log(`-> ${out}`);
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

if (require.main === module) { if (process.argv.includes("--formats")) buildFormats(); else buildIndex(); }
module.exports = { sections, readFormat, legalNames, CARD_LINE, PRINTING_SECTIONS };
