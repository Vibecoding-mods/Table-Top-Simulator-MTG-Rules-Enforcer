// Accomplishments the bridge keeps for each player, by Steam ID (the table's Player.steam_id), in a small JSON file of
// its own beside the GIF favourites: %APPDATA%/MTG-TTS/accomplishments.json on the host's PC. Forge's own achievements
// need its desktop profile, which a headless engine doesn't have. This file never reads or writes any other file there
// (gif-keys.json above all).
//   { version: 1, players: { "<steam id>": { "<accomplishment id>": { name, text, count, first, last } } } }
const ACCOMPLISHMENTS = {
  "forced-tie": { name: "Stalemate", text: "Played a game to a forced tie: nobody could lose, and three full rounds went by without progress." },
};
const WHO_MAX = 2000; // players kept; the one who earned least recently goes first

// the key a player's accomplishments are kept under: a Steam ID (digits), else null (a colour is no lasting key)
function steamKey(steam) {
  const s = String(steam ?? "");
  return /^\d{5,20}$/.test(s) ? s : null;
}
const stamp = (now) => new Date(now()).toISOString().slice(0, 10);
const okEntry = (e) => e && typeof e === "object" && Number.isInteger(e.count) && e.count > 0;

// opts: store { read() -> object|null, write(object) } (null: kept in memory only), now, log
function createAccomplishments(opts = {}) {
  const log = opts.log || (() => {});
  const now = opts.now || (() => Date.now());
  let all = null; // steam id -> { id -> entry }
  function load() {
    if (all) return all;
    all = new Map();
    let saved = null;
    try { saved = opts.store ? opts.store.read() : null; } catch (e) { log(`accomplishments: can't read them (${(e && (e.code || e.name)) || "unreadable"})`); }
    const players = saved && typeof saved === "object" && saved.players && typeof saved.players === "object" ? saved.players : {};
    for (const [who, got] of Object.entries(players)) {
      if (!steamKey(who) || !got || typeof got !== "object") continue;
      const kept = {};
      for (const [id, e] of Object.entries(got)) if (Object.hasOwn(ACCOMPLISHMENTS, id) && okEntry(e)) kept[id] = { ...ACCOMPLISHMENTS[id], count: e.count, first: String(e.first || ""), last: String(e.last || "") };
      if (Object.keys(kept).length) all.set(who, kept);
    }
    return all;
  }
  function save() {
    if (!opts.store) return;
    try { opts.store.write({ version: 1, players: Object.fromEntries(all) }); } catch (e) { log(`accomplishments: can't save them (${(e && (e.code || e.name)) || "error"})`); }
  }
  return {
    // one more of accomplishment id for the player: the entry after it, or null (no Steam ID, an unknown id)
    earn(steam, id) {
      const who = steamKey(steam);
      if (!who || !Object.hasOwn(ACCOMPLISHMENTS, id)) return null;
      const m = load();
      const got = m.get(who) || {};
      const day = stamp(now);
      const e = got[id] ? { ...got[id], count: got[id].count + 1, last: day } : { ...ACCOMPLISHMENTS[id], count: 1, first: day, last: day };
      got[id] = e;
      m.delete(who);
      m.set(who, got);
      while (m.size > WHO_MAX) m.delete(m.keys().next().value);
      save();
      return { id, ...e };
    },
    // the player's accomplishments: [{ id, name, text, count, first, last }]
    list(steam) {
      const who = steamKey(steam);
      const got = who ? load().get(who) || {} : {};
      return Object.entries(got).map(([id, e]) => ({ id, ...e }));
    },
  };
}

module.exports = { createAccomplishments, steamKey, ACCOMPLISHMENTS };
