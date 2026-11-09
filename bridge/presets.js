// Deck presets: ours in decks/ (AI, test and rules-check decks), then Manabrew's own in manabrew/public/preset_decks.
// An id found in both is ours.
const fs = require("fs");
const path = require("path");
const home = require("./home"); // (decks/ and manabrew/ under MTG_HOME when it is set)

const DIRS = [home.data("decks"), home.data("manabrew", "public", "preset_decks")];

function presetFile(id) {
  for (const d of DIRS) {
    const f = path.join(d, `${id}.json`);
    if (fs.existsSync(f)) return f;
  }
  return path.join(DIRS[0], `${id}.json`); // (reading it then fails with a clear "no such file")
}

function readPreset(id) { return JSON.parse(fs.readFileSync(presetFile(id), "utf8")); }

// every preset id, sorted
function presetIds() {
  const ids = new Set();
  for (const d of DIRS) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const f of names) if (f.endsWith(".json") && f !== "index.json") ids.add(f.slice(0, -5));
  }
  return [...ids].sort();
}

module.exports = { presetFile, readPreset, presetIds, PRESET_DIRS: DIRS };
