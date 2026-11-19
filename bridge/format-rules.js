// The deck check per format (docs/format-banlist-spec.md §3, §5; piece B). Pure: the ban list data comes in as a status
// function (bridge/legality.js's loadLegality().status, piece A; or Forge's own Standard list), so this file reads no
// file and asks no network.
//
// FORMATS: the table's Format button, in its order (tools/engine-renderer.lua, piece C), one entry a key (Old School is
// left out: Scryfall's data for it is not the format's, and Forge has no list, so bridge/legality.js has none):
//   key, name (the button's word and the alert's), mode ("commander" | "standard": the game mode it plays, MODES in
//   bridge.js), shape ("commander": exactly 100 and singleton, problems; "casual": today's Commander warnings; "sixty":
//   60+, 15 sideboard, 4 copies), list (false: a Casual format, no ban list checked), restricted (null; "copy": one copy
//   of a restricted card, Vintage, Timeless; "commander": not as a commander, Duel Commander's use of it),
//   reason (§5.3's words for a card that isn't legal there).
const FORMATS = [
  { key: "casualcommander", name: "Casual Commander", mode: "commander", shape: "casual", list: false, restricted: null, reason: null },
  { key: "commander", name: "Commander", mode: "commander", shape: "commander", list: true, restricted: null, reason: "not a tournament card" },
  { key: "duel", name: "Duel Commander", mode: "commander", shape: "commander", list: true, restricted: "commander", reason: "not a tournament card" },
  { key: "paupercommander", name: "Pauper Commander", mode: "commander", shape: "commander", list: true, restricted: null, reason: "not a common, or an uncommon commander" },
  { key: "predh", name: "PreDH", mode: "commander", shape: "commander", list: true, restricted: null, reason: "not from its sets" },
  { key: "casual60", name: "Casual 60-card", mode: "standard", shape: "sixty", list: false, restricted: null, reason: null },
  { key: "standard", name: "Standard", mode: "standard", shape: "sixty", list: true, restricted: null, reason: "not from its sets" },
  { key: "pioneer", name: "Pioneer", mode: "standard", shape: "sixty", list: true, restricted: null, reason: "not from its sets" },
  { key: "modern", name: "Modern", mode: "standard", shape: "sixty", list: true, restricted: null, reason: "not from its sets" },
  { key: "legacy", name: "Legacy", mode: "standard", shape: "sixty", list: true, restricted: null, reason: "not a tournament card" },
  { key: "vintage", name: "Vintage", mode: "standard", shape: "sixty", list: true, restricted: "copy", reason: "not a tournament card" },
  { key: "pauper", name: "Pauper", mode: "standard", shape: "sixty", list: true, restricted: null, reason: "not a common" },
  { key: "premodern", name: "Premodern", mode: "standard", shape: "sixty", list: true, restricted: null, reason: "not from its sets" },
  { key: "historic", name: "Historic", mode: "standard", shape: "sixty", list: true, restricted: null, reason: "not on MTG Arena" },
  { key: "timeless", name: "Timeless", mode: "standard", shape: "sixty", list: true, restricted: "copy", reason: "not on MTG Arena" },
  { key: "alchemy", name: "Alchemy", mode: "standard", shape: "sixty", list: true, restricted: null, reason: "not on MTG Arena" },
];
const DEFAULT_FORMAT = "casualcommander";
const BY_KEY = new Map(FORMATS.map((f) => [f.key, f]));
// a format key as sent or typed (" Modern"), or null
const formatKey = (x) => { const k = String(x ?? "").trim().toLowerCase().replace(/[\s_-]+/g, ""); return BY_KEY.has(k) ? k : null; };
const formatOf = (key) => BY_KEY.get(formatKey(key) || DEFAULT_FORMAT);
// the format's name in words ("Duel Commander"), the default's for an unknown key
const formatWords = (key) => formatOf(key).name;
// §5.3's reason for a card not legal in the format ("not from its sets"), or null for a Casual format
const notLegalReason = (key) => formatOf(key).reason;

const few = (list) => `${list.slice(0, 8).join(", ")}${list.length > 8 ? `, and ${list.length - 8} more` : ""}`;
const countOf = (list) => { const m = new Map(); for (const n of list) m.set(n, (m.get(n) || 0) + 1); return m; };

// The problems of a deck under a format and its two switches. cards: the deck without its commander(s), commanders,
// sideboard (60-card formats): engine names. opts:
//   banned, restricted: true when ENFORCED (the table's switches; on by default)
//   status(formatKey, name) -> "l" | "b" | "r" | "n" | null (null: the data hasn't the card, a newer one: a warning, not
//     a block), or none at all (no data for the format: only the shape is checked, said as a warning)
//   isBasic(name), limit(name) -> a card's own copy limit (a number, "any", or undefined: the format's own)
//   source, date: the data the status came from, for the closing line
// -> { problems: [lines, in §5.2's order: shape, banned, restricted, not legal], warnings: [lines], allowedBanned:
//   [names the host's "banned off" let through], footer: the "Ban list: ..." line for an alert with a banned or
//   restricted problem, else "" }
function formatProblems(key, opts, cards, commanders = [], sideboard = []) {
  const f = formatOf(key);
  const isBasic = opts.isBasic || (() => false);
  const limit = opts.limit || (() => undefined);
  const problems = [], warnings = [];
  const all = [...commanders, ...cards, ...sideboard];
  const counts = countOf(all);
  const names = [...counts.keys()];
  const status = f.list && typeof opts.status === "function" ? (n) => opts.status(f.key, n) : null;
  // a restricted card in a 4-of format: one copy (Restricted on), else the format's normal limit
  const copyRestricted = f.restricted === "copy" && opts.restricted !== false && status;
  const restrictedHere = (n) => copyRestricted && status(n) === "r";
  // ── the deck's shape ──
  if (f.shape === "commander") {
    const total = cards.length + commanders.length;
    if (total !== 100) problems.push(`${total} cards: ${f.name} decks are exactly 100 cards, the commander included`);
    const extra = names.filter((n) => !isBasic(n) && limit(n) !== "any" && counts.get(n) > (typeof limit(n) === "number" ? limit(n) : 1));
    if (extra.length) problems.push(`more than one copy of: ${few(extra.map((n) => `${counts.get(n)}× ${n}`))} (${f.name} decks are singleton; basic lands excepted)`);
  } else if (f.shape === "sixty") {
    if (commanders.length) problems.push(`${f.name} has no commander: take ${few(commanders)} off your command zone (or put it in your deck)`);
    if (cards.length < 60) problems.push(`${cards.length} cards in your deck: ${f.name} decks have at least 60`);
    if (sideboard.length > 15) problems.push(`${sideboard.length} cards in the sideboard: at most 15`);
    const inMain = countOf(cards);
    const over = names.filter((n) => !isBasic(n) && limit(n) !== "any" && !restrictedHere(n)).map((n) => {
      const own = typeof limit(n) === "number";
      const k = own ? inMain.get(n) || 0 : counts.get(n);
      return k > (own ? limit(n) : 4) ? `${k}× ${n}` : null;
    }).filter(Boolean);
    if (over.length) problems.push(`more than 4 copies of: ${few(over)} (basic lands excepted)`);
  }
  // ── the lists ──
  let allowedBanned = [];
  let footer = "";
  if (f.list && !status) warnings.push(`no ban list data for ${f.name} yet: only the deck's shape was checked`);
  if (status) {
    const st = new Map(names.map((n) => [n, status(n)]));
    const banned = names.filter((n) => st.get(n) === "b");
    if (banned.length && opts.banned !== false) problems.push(`banned in ${f.name}: ${few(banned)}`);
    else allowedBanned = banned;
    let restrictedHit = false;
    if (opts.restricted !== false && f.restricted === "copy") {
      const many = names.filter((n) => st.get(n) === "r" && counts.get(n) > 1);
      if (many.length) { problems.push(`restricted in ${f.name} (1 copy each): ${few(many.map((n) => `${counts.get(n)}× ${n}`))}`); restrictedHit = true; }
    }
    if (opts.restricted !== false && f.restricted === "commander") {
      const asCommander = [...new Set(commanders)].filter((n) => st.get(n) === "r");
      if (asCommander.length) { problems.push(`restricted in ${f.name} (not as your commander): ${few(asCommander)}`); restrictedHit = true; }
    }
    const outside = names.filter((n) => st.get(n) === "n");
    if (outside.length) problems.push(`not legal in ${f.name} (${f.reason}): ${few(outside)}`);
    const unknown = names.filter((n) => st.get(n) == null);
    if (unknown.length) warnings.push(`not on the ${f.name} list (a newer card?), so not checked: ${few(unknown)}`);
    const bannedHit = banned.length && opts.banned !== false;
    if (bannedHit || restrictedHit) {
      const from = [opts.source, opts.date].filter(Boolean).join(", ");
      const can = [bannedHit ? "allow banned cards (Banned cards button)" : null, restrictedHit ? "turn restricted cards off (Restricted cards button)" : null].filter(Boolean);
      footer = `${from ? `Ban list: ${from}. ` : ""}The host can ${can.join(", or ")}.`;
    }
  }
  return { problems, warnings, allowedBanned, footer };
}

module.exports = { FORMATS, DEFAULT_FORMAT, formatKey, formatOf, formatWords, notLegalReason, formatProblems, few };
