// A Standard sideboard for a deck imported on the table (docs/handoff/open-after-1124.md: "a deck imported on the table
// has no sideboard"), the table's side, on fengari with stand-ins for TTS (no save needed). The Card Importer puts a
// list's sideboard in the Notebook, so the player imports the sideboard as a deck of its own and puts it on their
// graveyard spot; "mtg ready" sends it with the deck (tools/make-engine-copy.js engineSendDecks, entry.sideboard). The
// checks:
//  - a deck on the graveyard spot goes as the seat's sideboard, each card's name and pictures as the library's;
//  - one card there is a sideboard of one; nothing there: no sideboard field; the table's library stand-ins and an
//    engine card on the spot are never sent;
//  - the library and the commander are sent as before;
//  - a game start puts it away with the imported deck (stashImported: below the table, hidden from everyone), and the
//    game's end puts it back (restoreStash); "mtg clear deck" removes it with the deck (engineClearDeck);
//  - engineSideboardObject: the deck or card on the spot, never the engine's own or an Identity card.
//   node tests/test_table_sideboard_imported.js
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
const COPY = fs.readFileSync(path.join(ROOT, "tools", "make-engine-copy.js"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const fail = (why) => { process.stdout.write(`FAIL test_table_sideboard_imported: ${why}\n`); process.exit(1); };
const between = (src, start, endAt) => { const a = src.indexOf(start); const b = a < 0 ? -1 : src.indexOf(endAt, a); if (a < 0 || b < 0) fail(`"${start.slice(0, 40)}" is gone`); return src.slice(a, b); };
// (make-engine-copy.js holds the table's Lua in a JS template literal: its backslashes are doubled)
const DECKS_LUA = between(COPY, "local COMMAND_ZONES = TABLE_PROFILE.tax", "\nfunction engineMarkCommander(").replace(/\\\\/g, "\\");
const fn = (name) => between(SRC, `\nfunction ${name}(`, "\nend\n") + "\nend\n";
const local = (name) => between(SRC, `\nlocal function ${name}(`, "\nend\n") + "\nend\n";

const STUBS = `
local vmt = {}
vmt.__add = function(a, b) return Vector(a.x + b.x, a.y + b.y, a.z + b.z) end
function Vector(x, y, z) return setmetatable({ x = x, y = y, z = z }, vmt) end
JSON = { encode = function(t) return t end }
SENT = nil
function engineSend(t, p) SENT = { t = t, p = p } end
function broadcastToColor() end
function engineModeSent() return "standard" end
Wait = { time = function() end, frames = function() end }
TABLE_PROFILE = { tax = { Blue = {} } }
Player = { Blue = { getHandObjects = function() return HAND end } }
HAND = {}
OBJECTS = {}
function getObjects() return OBJECTS end
REG = {}
function getObjectFromGUID(g) return REG[g] end
-- a card's data as TTS gives it, in a deck's ContainedObjects (its pictures in the deck's CustomDeck, by CardID / 100)
function cardData(name, id, gm) return { Nickname = name, CardID = id * 100, GMNotes = gm, GUID = "g" .. id } end
function deckOf(name, cards, gm)
  local d = { ContainedObjects = cards, CustomDeck = {} }
  for _, c in ipairs(cards) do d.CustomDeck[math.floor(c.CardID / 100)] = { FaceURL = "https://face/" .. c.Nickname, BackURL = "https://back" } end
  local pos = Vector(10, 1, -20)
  GUIDS = (GUIDS or 0) + 1
  local o = { type = "Deck", gone = false, vis = nil, guid = "d" .. GUIDS }
  o.getGUID = function() return o.guid end
  REG[o.guid] = o
  o.getName = function() return name end
  o.getGMNotes = function() return gm or "" end
  o.getData = function() return d end
  o.getQuantity = function() return #cards end
  o.takeObject = function() end
  o.getPosition = function() return pos end
  o.getRotation = function() return Vector(0, 180, 0) end
  o.getLock = function() return false end
  o.setLock = function() end
  o.setPosition = function(p) pos = p end
  o.setRotation = function() end
  o.getObjects = function() return {} end
  o.setInvisibleTo = function(v) o.vis = v end
  o.destruct = function() o.gone = true end
  o.isDestroyed = function() return o.gone end
  return o
end
function cardObj(name, gm)
  local o = deckOf(name, {}, gm)
  o.type = "Card"
  o.getData = function() return { Nickname = name, CustomDeck = { [7] = { FaceURL = "https://face/" .. name, BackURL = "https://back" } }, CardID = 700 } end
  return o
end
ZONE = { Blue = { lib = nil, gy = nil } }
data = { Blue = { libraryZone = { zone = "lib" }, graveyard = { zone = "gy" } } }
function getDeckFromZone(z) return z.zone == "lib" and ZONE.Blue.lib or ZONE.Blue.gy end
function engineEveryone() return { "White", "Blue" } end
TAX_LABELS = { Blue = {} }
engineTable = nil
`;
const RENDER = [fn("engineSideboardObject"), "local stashed = {}", local("stashObject"), local("stashImported"), local("restoreStash"), fn("engineClearDeck")].join("\n");
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const code = `${STUBS}\n${DECKS_LUA}\n${RENDER}\nSTASH, RESTORE = stashImported, restoreStash`;
if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) fail(`the table code doesn't load: ${lua.lua_tojsstring(L, -1)}`);
const q = (src) => {
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
  if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
  const v = lua.lua_isnil(L, -1) ? null : lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  return v;
};
// the seats payload engineSendDecks sends, as plain lists: library names, sideboard names (or "none"), and the first
// sideboard card's pictures
const SEND = `engineSendDecks({ "Blue" }, "Blue") local e = SENT.p.seats.Blue local lib, sb = {}, {}
  for _, c in ipairs(e.library) do lib[#lib + 1] = c.n end
  if e.sideboard == nil then sb = nil else for _, c in ipairs(e.sideboard) do sb[#sb + 1] = c.n end end
  local f = e.sideboard and e.sideboard[1] or {}
  return table.concat(lib, ",") .. "|" .. (sb and table.concat(sb, ",") or "none") .. "|" .. tostring(f.f) .. "|" .. tostring(f.b)`;
const MAIN = `ZONE.Blue.lib = deckOf("Dimir", { cardData("Opt", 1), cardData("Island", 2), cardData("Library card", 3, "libcard") }) `;

same("sideboard: a deck on the graveyard spot goes as the seat's sideboard, with the cards' pictures",
  q(`${MAIN} ZONE.Blue.gy = deckOf("Dimir sideboard", { cardData("Negate", 11), cardData("Duress", 12), cardData("Negate", 13) }) ${SEND}`),
  "Opt,Island|Negate,Duress,Negate|https://face/Negate|https://back");
same("sideboard: one card there is a sideboard of one", q(`${MAIN} ZONE.Blue.gy = cardObj("Negate") ${SEND}`), "Opt,Island|Negate|https://face/Negate|https://back");
same("sideboard: nothing there, no sideboard field (the deck as before)", q(`${MAIN} ZONE.Blue.gy = nil ${SEND}`), "Opt,Island|none|nil|nil");
same("sideboard: the table's library stand-ins and engine cards in it are never sent",
  q(`${MAIN} ZONE.Blue.gy = deckOf("SB", { cardData("Negate", 11), cardData("Library card", 14, "libcard"), cardData("Grizzly Bears", 15, "engine:engine-card-9") }) ${SEND}`),
  "Opt,Island|Negate|https://face/Negate|https://back");
same("sideboard: an engine deck on the spot is not a sideboard", q(`${MAIN} ZONE.Blue.gy = deckOf("trash", { cardData("Negate", 11) }, "engine:trash") ${SEND}`), "Opt,Island|none|nil|nil");
same("sideboard: engineSideboardObject, the deck or card there, never the engine's or an Identity card",
  q(`local r = {} ZONE.Blue.gy = deckOf("SB", { cardData("Negate", 11) }) r[1] = engineSideboardObject("Blue") ~= nil
    ZONE.Blue.gy = cardObj("Negate") r[2] = engineSideboardObject("Blue") ~= nil
    ZONE.Blue.gy = cardObj("Traitor Identity") r[3] = engineSideboardObject("Blue") ~= nil
    ZONE.Blue.gy = deckOf("x", {}, "enginetrash") r[4] = engineSideboardObject("Blue") ~= nil
    ZONE.Blue.gy = nil r[5] = engineSideboardObject("Blue") ~= nil
    return tostring(r[1]) .. tostring(r[2]) .. tostring(r[3]) .. tostring(r[4]) .. tostring(r[5])`),
  "truetruefalsefalsefalse");
same("stash: a game start puts the sideboard away with the deck (below the table, hidden from everyone), the end back",
  q(`${MAIN} SB = deckOf("SB", { cardData("Negate", 11) }) ZONE.Blue.gy = SB
    STASH({ "Blue" }) local down, hidden = SB.getPosition().y < -5, SB.vis ~= nil and #SB.vis == 2
    RESTORE() return tostring(down) .. tostring(hidden) .. tostring(SB.getPosition().y > 0) .. tostring(SB.vis ~= nil and #SB.vis == 0)`),
  "truetruetruetrue");
same("clear deck: mtg clear deck removes the sideboard with the deck", q(`${MAIN} SB = deckOf("SB", { cardData("Negate", 11) }) ZONE.Blue.gy = SB local n = engineClearDeck("Blue") return tostring(n) .. tostring(SB.gone)`), "2true");
process.stdout.write(`${failed ? "FAIL" : "PASS"} test_table_sideboard_imported: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
