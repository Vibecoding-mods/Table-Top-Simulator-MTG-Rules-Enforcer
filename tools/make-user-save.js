// Brings a player's own save (their decks on the table) onto the current engine table: the table's scripts, screen UI
// and objects come from the freshly built ENGINE MODE save; the player's own objects (anything the engine save doesn't
// have: imported decks, commanders, tokens...) and the save's own settings (name, lighting, notes) are kept.
// The engine's runtime "MTG game setup" tile is left out (the table makes its own). A backup of the old file is kept.
//   node tools/make-engine-copy.js                      (first: the current engine save)
//   node tools/make-user-save.js [user.json] [engine.json]
// Why (2026-10-24): the group played on "Mock MTGA 4 player" (TS_Save_1), built that morning, so none of the day's
// fixes were on the table (grey Scoop, overlapping banners, no Auto-resolve, white pictures once the bridge changed).
const fs = require("fs");
const path = require("path");

const SAVES = path.join(process.env.USERPROFILE || "", "Documents", "My Games", "Tabletop Simulator", "Saves");
const USER = process.argv[2] || path.join(SAVES, "TS_Save_1.json");
const ENGINE = process.argv[3] || path.join(SAVES, "MTG 4 player table - ENGINE MODE.json");
const BACKUP_DIR = path.join(__dirname, "..", "tmp", "backup");

const user = JSON.parse(fs.readFileSync(USER, "utf8"));
const engine = JSON.parse(fs.readFileSync(ENGINE, "utf8"));
const engineGuids = new Set(engine.ObjectStates.map((o) => o.GUID));
const isSetupTile = (o) => o.Name === "BlockSquare" && o.Nickname === "MTG game setup";
const own = user.ObjectStates.filter((o) => !engineGuids.has(o.GUID) && !isSetupTile(o));

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const backup = path.join(BACKUP_DIR, `${path.basename(USER, ".json")}-${stamp}.json`);
fs.copyFileSync(USER, backup);

const out = { ...user };
for (const k of ["LuaScript", "LuaScriptState", "XmlUI", "CustomUIAssets"]) if (k in engine) out[k] = engine[k];
out.ObjectStates = [...engine.ObjectStates, ...own];
fs.writeFileSync(USER, JSON.stringify(out, null, 2));

console.log(`kept ${own.length} of your objects: ${own.map((o) => `${o.Name} "${String(o.Nickname || "").split("\n")[0]}"`).join(", ")}`);
console.log(`backup: ${backup}`);
console.log(`wrote ${USER} (${out.ObjectStates.length} objects, save name "${out.SaveName}")`);
