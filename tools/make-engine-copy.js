// Builds the "engine mode" copy of the group's table with the security issues removed
// (table-review/COMPATIBILITY.md, "Must-fix before connecting the bridge").
// The original workshop file is only read, never written.
//   node make-engine-copy.js [source.json] [dest.json] [--profile tools/profiles/<id>.json] [--tracker-source <4p.json>]
// The table's profile (its seats, their objects, what to remove: tools/table-profile.js) is read from the source itself;
// --profile names the file it must match, so a profile can't be put on the wrong table (the two tables reuse GUIDs for
// different seats, docs/m6-six-seat-spec.md §2.1). Default source: the 4-player table.
// Another table (the 6-player one) also reads the host's own 4-player Workshop file, --tracker-source (default: where
// TTS keeps it): its commander-damage trackers and its backdrop come from there (M6 steps 12-13). Only read, never
// written, and never in the repo: the repo is public and the table is someone else's work.
const fs = require("fs");
const path = require("path");
const tableProfile = require("./table-profile");

const TTS = path.join(process.env.USERPROFILE || require("os").homedir(), "Documents", "My Games", "Tabletop Simulator");
const ARGS = process.argv.slice(2);
// (a flag's value: what follows it, "" when nothing does; null when the flag isn't given)
const VALUE_FLAGS = ["--profile", "--tracker-source"];
const flag = (name) => { const at = ARGS.indexOf(name); return at >= 0 ? ARGS[at + 1] || "" : null; };
const PROFILE_FILE = flag("--profile");
const POS = ARGS.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(ARGS[i - 1]));
const FOUR_ID = "2296042369";
const SRC = POS[0] || path.join(TTS, "Mods", "Workshop", `${FOUR_ID}.json`);
const TRACKER_SOURCE = flag("--tracker-source") || path.join(TTS, "Mods", "Workshop", `${FOUR_ID}.json`);
const TAG = "-- [engine copy]";

const save = JSON.parse(fs.readFileSync(SRC, "utf8"));
const report = [];

// The profile, from the source; a --profile file must be the same, byte for byte
const PROFILE = (() => {
  const { profile, errors } = tableProfile.extract(save);
  if (!profile) { console.log(`FAIL table profile: ${errors.join("; ")}\n\nNot written: the table's profile is incomplete.`); process.exit(1); }
  if (PROFILE_FILE != null) {
    const given = fs.existsSync(PROFILE_FILE) ? fs.readFileSync(PROFILE_FILE, "utf8").replace(/\r\n/g, "\n") : null;
    if (given !== tableProfile.profileText(profile)) {
      console.log(`FAIL table profile: ${PROFILE_FILE || "(no file)"} is not this table's (node tools/table-profile.js <the table> writes it)\n\nNot written.`);
      process.exit(1);
    }
  }
  report.push(`OK   table profile ${profile.id}: ${profile.seats.length} seats, clockwise ${profile.seats.join(" -> ")}${profile.notFound.length ? ` (not on this table: ${profile.notFound.join("; ")})` : ""}`);
  return profile;
})();
const SEATS = PROFILE.seats;
const DEST = POS[1] || path.join(TTS, "Saves", `${PROFILE.saveName}.json`);
// A patch for a tool this table doesn't have: said, not failed
const skip = (label, why) => report.push(`SKIP ${label} (${why})`);

// Every object, including ones inside bags and alternate states.
function* allObjects(list) {
  for (const o of list || []) {
    yield o;
    yield* allObjects(o.ContainedObjects);
    yield* allObjects(Object.values(o.States || {}));
  }
}

// ───────────── Another table: the 4-player table's commander damage and backdrop (M6 steps 12-13) ─────────────
// The 6-player table has no commander-damage trackers (its bags hold an older script, colour from the Name), so it gets
// the 4-player table's: one tracker's object copied from the host's own 4-player Workshop file, once per row of the
// profile's cmdDamageMade (Description = the attacker, which the script tints itself by; locked; at 0), before the
// patches below, so they are gated as the 4-player ones are. The source must be the 4-player table with its trackers
// and their script exactly the one this code knows (sha1 0fdc193a): without it, FAIL, never the bags' script instead.
// The backdrop (the user, 2026-11-15: "the same backdrop as the 4-player engine table"): the skybox below is set for
// every table; Lighting and Sky are taken from the same file. The table's own surface (TableURL) stays.
const TRACKER_SCRIPT_SHA1 = "0fdc193a";
// (TTS's own player colours, Color.fromString: the 4-player trackers' ColorDiffuse is their attacker's)
const PLAYER_TINT = { White: [1, 1, 1], Red: [0.856, 0.1, 0.094], Yellow: [0.905, 0.898, 0.172], Green: [0.192, 0.701, 0.168],
  Blue: [0.118, 0.53, 1], Purple: [0.627, 0.125, 0.941] };
if (PROFILE.id !== FOUR_ID) {
  const fail = (what) => { report.push(`FAIL ${what}`); process.exitCode = 1; };
  const sha1 = (s) => require("crypto").createHash("sha1").update(String(s)).digest("hex").slice(0, 8);
  const four = fs.existsSync(TRACKER_SOURCE) ? JSON.parse(fs.readFileSync(TRACKER_SOURCE, "utf8")) : null;
  const fourProfile = four && tableProfile.extract(four).profile;
  if (!four) fail(`tracker source: ${TRACKER_SOURCE} isn't there (the host's 4-player Workshop file, ${FOUR_ID}: --tracker-source <file>)`);
  else if (!fourProfile || fourProfile.id !== FOUR_ID || !fourProfile.cmdDamage) fail(`tracker source: ${TRACKER_SOURCE} isn't the 4-player table with its commander-damage trackers`);
  else {
    save.Lighting = JSON.parse(JSON.stringify(four.Lighting));
    save.Sky = four.Sky;
    report.push(`OK   backdrop: the 4-player table's Lighting and Sky (the skybox below; the table's own surface)`);
    if (PROFILE.cmdDamageMade) {
      const byGuid = new Map(four.ObjectStates.map((o) => [o.GUID, o]));
      const theirs = Object.values(fourProfile.cmdDamage).flatMap((row) => Object.values(row)).map((g) => byGuid.get(g));
      const scripts = [...new Set(theirs.map((o) => sha1(o.LuaScript)))];
      if (scripts.length !== 1 || scripts[0] !== TRACKER_SCRIPT_SHA1) fail(`commander damage trackers: the 4-player table's trackers' script is ${scripts.join(", ")}, not ${TRACKER_SCRIPT_SHA1}`);
      else {
        const used = new Set([...allObjects(save.ObjectStates), ...allObjects(four.ObjectStates)].map((o) => o.GUID));
        const clash = PROFILE.cmdDamageMade.filter((t) => used.has(t.guid)).map((t) => `${t.victim}:${t.attacker} ${t.guid}`);
        const untinted = [...new Set(PROFILE.cmdDamageMade.filter((t) => !PLAYER_TINT[t.attacker]).map((t) => t.attacker))];
        if (clash.length) fail(`commander damage trackers: GUIDs already on a table: ${clash.join(", ")}`);
        else if (untinted.length) fail(`commander damage trackers: no player colour for ${untinted.join(", ")}`);
        else {
          const src = theirs[0];
          for (const t of PROFILE.cmdDamageMade) {
            const o = JSON.parse(JSON.stringify(src));
            o.GUID = t.guid;
            o.Description = t.attacker;
            o.Locked = true;
            o.Transform = { ...src.Transform, posX: t.x, posZ: t.z, rotY: t.rotY };
            const [r, g, b] = PLAYER_TINT[t.attacker];
            o.ColorDiffuse = { r, g, b };
            o.LuaScriptState = "[0]";
            save.ObjectStates.push(o);
          }
          report.push(`OK   commander damage trackers made from the 4-player table's (${src.GUID}, script ${TRACKER_SCRIPT_SHA1}): ${PROFILE.cmdDamageMade.length}`);
        }
      }
    }
  }
}

// Replace `find` with `replace` in every script that contains it; `expect` = minimum number of scripts changed.
function patchScripts(label, find, replace, expect = 1, { global = false } = {}) {
  let n = 0;
  const targets = global ? [save] : [...allObjects(save.ObjectStates)];
  for (const o of targets) {
    if (typeof o.LuaScript !== "string") continue;
    // Some scripts use Windows line endings; match either form.
    for (const [f, r] of [[find, replace], [find.replace(/\n/g, "\r\n"), replace.replace(/\n/g, "\r\n")]]) {
      if (o.LuaScript.includes(f)) { o.LuaScript = o.LuaScript.split(f).join(r); n++; break; }
    }
  }
  report.push(`${n >= expect ? "OK  " : "FAIL"} ${label} (${n} script${n === 1 ? "" : "s"})`);
  if (n < expect) process.exitCode = 1;
}

function removeObjects(label, guid) {
  let n = 0;
  const strip = (list) => {
    if (!list) return list;
    const kept = list.filter((o) => (o.GUID === guid ? (n++, false) : true));
    for (const o of kept) o.ContainedObjects = strip(o.ContainedObjects);
    return kept;
  };
  save.ObjectStates = strip(save.ObjectStates);
  report.push(`${n ? "OK  " : "FAIL"} ${label} (${n} removed)`);
  if (!n) process.exitCode = 1;
}

// 1. Global: hard-coded auto-promote for one Steam account
patchScripts("Global: remove the 'promote me' permission for Steam ID 76561197968157267",
  `  if message=='promote me' and pl.steam_id=='76561197968157267' then
    if not(pl.promoted or pl.admin) then
      pl.promote()
    end
    pl.changeColor('Black')
    return false
  end
`, `  ${TAG} removed a hard-coded auto-promote for one Steam account
`, 1, { global: true });

// 2. Smart mulligan: hidden button (one Steam ID) + Global's weighted re-shuffle
removeObjects("Remove hidden smart-mulligan button object", "dc2d88");
patchScripts("Global: disable smartMulligan re-shuffle",
  "        if smartMulligan then   -- ensure 2-5 lands in hand",
  `        if false then   ${TAG} smart mulligan (re-shuffles until 2-5 lands) disabled`, 1, { global: true });

// 3. Easy Modules: any player could replace the Encoder / Card Importer with code downloaded from GitHub
patchScripts("Easy Modules: disable 'force encoder update/temporary'",
  "if string.find(message,'^force encoder') ~= nil then",
  `if false and string.find(message,'^force encoder') ~= nil then ${TAG} remote code download disabled`);
patchScripts("Easy Modules: disable 'force importer update/temporary'",
  "if string.find(message, '^force importer') ~= nil then",
  `if false and string.find(message, '^force importer') ~= nil then ${TAG} remote code download disabled`);
patchScripts("Easy Modules: disable self-update",
  "function SelfUpdateCheck(webRequest)",
  `function SelfUpdateCheck(webRequest) do return end ${TAG} self-update disabled`);

// 4. Encoder: auto-download of a menu module, and the "Update" menu that replaces every module's code
patchScripts("Encoder: no automatic menu-module download",
  `WebRequest.get(URLS['BASIC_MENU'],self,"getMenuModule")`,
  `broadcastToAll("No menu module found (auto-download disabled in this copy).") ${TAG}`);
patchScripts("Encoder: disable 'Update' (downloads and runs new code)",
  "function callVersionCheck()\n",
  `function callVersionCheck()\n  do broadcastToAll("Updates are disabled in the engine copy of this table.") return end ${TAG}\n`);

// 5. Encoder modules that replace their own code from GitHub (Phasing, Color Module)
patchScripts("Phasing + Color Module: disable updateModule",
  "function updateModule(wr)\n  enc = Global.getVar('Encoder')",
  `function updateModule(wr)\n  do return end ${TAG} self-update disabled\n  enc = Global.getVar('Encoder')`, 2);

// 6. rikrassen importer: spawns whatever object JSON its server returns (scripts included)
patchScripts("rikrassen importer: strip scripts from server-spawned objects",
  "      spawnObjectJSON({ json = obj })",
  `      spawnObjectJSON({ json = engineCopyStripScripts(obj), callback_function = function(o) deckcheckRikTagSpawned(player.color, reqType, o) end }) ${TAG} scripts from the server are removed; a DeckCheck deck gets its tag (tools/deckcheck-rik.lua)`);
patchScripts("rikrassen importer: add the script stripper",
  "--- @param resp WebRequestInstance\n--- @param player PlayerInstance",
  `${TAG} remove Lua/XML from objects the importer server sends, so only cards and images are spawned
function engineCopyStripScripts(json)
  local ok, obj = pcall(JSON.decode, json)
  if not ok or type(obj) ~= "table" then return "{}" end
  local function strip(o)
    if type(o) ~= "table" then return end
    o.LuaScript = nil; o.LuaScriptState = nil; o.XmlUI = nil
    for _, c in ipairs(o.ContainedObjects or {}) do strip(c) end
    for _, s in pairs(o.States or {}) do strip(s) end
  end
  strip(obj)
  return JSON.encode(obj)
end

--- @param resp WebRequestInstance
--- @param player PlayerInstance`);
patchScripts("rikrassen importer: disable check_version (downloads importer code)",
  "function M.check_version(base_url, asset_base_url, cb)",
  `function M.check_version(base_url, asset_base_url, cb) do return end ${TAG}`);
// rikrassen importer: DeckCheck deck links (docs/deckcheck-spec.md, "rikrassen's importer"). Its server refuses
// deckcheck.co, so M.deck hands such a link to deckcheckRikDeck (tools/deckcheck-rik.lua, put in below with
// tools/deckcheck.lua), which reads the deck from DeckCheck and posts it to the server as a decklist instead.
patchScripts("rikrassen importer: DeckCheck links",
  "  data.hand = hand\n  postJSON(BaseURL .. '/build', data, function(resp)\n    callback(resp, player, 'deck', next)\n  end)\n",
  `  data.hand = hand
  local function post() ${TAG} (a DeckCheck link is posted as a decklist once read: tools/deckcheck-rik.lua)
    postJSON(BaseURL .. '/build', data, function(resp)
      callback(resp, player, 'deck', next)
    end)
  end
  if deckcheckRikDeck(color, data, post) then return end
  post()
`);
patchScripts("rikrassen importer: help names DeckCheck",
  "  - archidekt.com\n  - decks.tcgplayer.com\n",
  "  - archidekt.com\n  - deckcheck.co\n  - decks.tcgplayer.com\n");
{
  // (the script is a luabundle that ends with `return __bundle_require("__root")`: the functions go just before it)
  const lua = ["deckcheck.lua", "deckcheck-rik.lua"].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n\n");
  const END = 'return __bundle_require("__root")';
  let n = 0;
  for (const o of allObjects(save.ObjectStates)) {
    if (typeof o.LuaScript !== "string" || !o.LuaScript.includes("if deckcheckRikDeck(color, data, post) then return end")) continue;
    const at = o.LuaScript.lastIndexOf(END);
    if (at < 0 || o.LuaScript.slice(at + END.length).trim() !== "") continue;
    const nl = o.LuaScript.includes("\r\n") ? "\r\n" : "\n";
    o.LuaScript = o.LuaScript.slice(0, at) + `${TAG} DeckCheck links (tools/deckcheck.lua, tools/deckcheck-rik.lua)${nl}${lua.replace(/\r?\n/g, nl)}${nl}${nl}` + o.LuaScript.slice(at);
    n++;
  }
  report.push(`${n >= 1 ? "OK  " : "FAIL"} rikrassen importer: DeckCheck functions added (${n} script${n === 1 ? "" : "s"})`);
  if (n < 1) process.exitCode = 1;
}

// 7. Card Importer: DeckCheck deck links (docs/deckcheck-spec.md, "Import"), next to Archidekt and Moxfield. The
// link goes to fetchDeckCheckDeck (tools/deckcheck-import.lua, appended with tools/deckcheck.lua below), which spawns
// through the importer's own spawnDeckEntries; the spawned deck carries qTbl.gmNotes (the DeckCheck tag) in its GM notes.
patchScripts("Card Importer: DeckCheck links",
  "      if qTbl.url:find('archidekt%.com') then\n",
  `      if qTbl.url:lower():find('deckcheck.co/', 1, true) then ${TAG} DeckCheck (tools/deckcheck-import.lua)
        qTbl.mode='Deck'
        fetchDeckCheckDeck(qTbl.url, qTbl)
        return true
      end
      if qTbl.url:find('archidekt%.com') then\n`);
patchScripts("Card Importer: a spawned deck keeps the import's GM notes",
  `            Description=qTbl.full or "Deck",\n`,
  `            Description=qTbl.full or "Deck",\n            GMNotes=qTbl.gmNotes, ${TAG} (the DeckCheck tag; nil for every other import)\n`);
patchScripts("Card Importer: help names DeckCheck",
  "Scryfall deck <url>           Import deck (Archidekt, Moxfield, legacy sites)",
  "Scryfall deck <url>           Import deck (Archidekt, Moxfield, DeckCheck, legacy sites)");
patchScripts("Card Importer: 'not supported' names DeckCheck",
  "Use Archidekt/Moxfield or paste a deck list.",
  "Use Archidekt, Moxfield or DeckCheck, or paste a deck list.");
{
  const lua = ["deckcheck.lua", "deckcheck-import.lua"].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n\n");
  let n = 0;
  for (const o of allObjects(save.ObjectStates)) {
    if (typeof o.LuaScript === "string" && o.LuaScript.includes("fetchDeckCheckDeck(qTbl.url, qTbl)")) {
      o.LuaScript += `\n\n${lua}`;
      n++;
    }
  }
  report.push(`${n >= 1 ? "OK  " : "FAIL"} Card Importer: DeckCheck functions added (${n} script${n === 1 ? "" : "s"})`);
  if (n < 1) process.exitCode = 1;
}

save.SaveName = PROFILE.saveName;
// background: Ariande's Hideaway skybox (assets/ariande-skybox-4096.jpg), uploaded to Steam Cloud so every player
// sees it (a file:// picture would show only on the host's PC). Since 2026-11-13 the floor is pulled 1.5x closer
// (tools/warp-skybox.py, assets/ariande-skybox-4096-floor15.jpg, sha256 ce0f24a5...; the link downloaded back and
// matched); the unwarped one was ugc/18285858995376011531/FC6BD5C748CC76B4AE3958D3AD6FCCE2BEFB4892/
save.SkyURL = "https://steamusercontent-a.akamaihd.net/ugc/15166805931125466029/A699B821ACFA350FD8DE708796C23D2B0803FEF3/";
// ───────────── Step 1: ENGINE MODE switch (PLAN.md M4) ─────────────
// `mtg engine on|off` in chat (host/promoted). Off = the table works exactly as before.
// On = every manual rules helper below does nothing and says so, because the engine runs the game.

// Insert a guard as the first statement of each named function, in every script containing `marker`.
function guard(label, marker, names, { silent = false, ret = "", global = false, min = 1, exclude = null, call = null, fixOpen = false } = {}) {
  const targets = global ? [save] : [...allObjects(save.ObjectStates)];
  label = label.replace(/'/g, "");
  // call: instead of refusing, hand the click to the engine (e.g. the Draw button takes a held draw)
  // fixOpen: the object works as usual while a manual fix is being edited (M7: life and commander-damage counters)
  const on = fixOpen ? "Global.getVar('ENGINE_MODE') and not Global.getVar('ENGINE_FIX_EDIT')" : "Global.getVar('ENGINE_MODE')";
  const body = call ? (global ? `if ENGINE_MODE then return ${call} end` : `if ${on} then return ${call} end`) : global
    ? `if ENGINE_MODE then ${silent ? "" : `engineBlocked('${label}') `}return${ret ? " " + ret : ""} end`
    : `if ${on} then ${silent ? "" : `Global.call('engineBlocked', '${label}') `}return${ret ? " " + ret : ""} end`;
  const counts = {};
  for (const o of targets) {
    if (typeof o.LuaScript !== "string" || !o.LuaScript.includes(marker)) continue;
    if (exclude && o.LuaScript.includes(exclude)) continue;
    for (const name of names) {
      const re = new RegExp(`^([ \\t]*(?:local[ \\t]+)?function[ \\t]+${name.replace(/\./g, "\\.")}[ \\t]*\\([^)]*\\))`, "m");
      if (re.test(o.LuaScript)) {
        const before = o.LuaScript;
        o.LuaScript = o.LuaScript.replace(re, `$1 ${body} ${TAG}`);
        if (o.LuaScript !== before) counts[name] = (counts[name] || 0) + 1;
      }
    }
  }
  const missing = names.filter((n) => !counts[n]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const ok = total >= min && (min === 0 || missing.length === 0);
  report.push(`${ok ? "OK  " : "FAIL"} gate ${label}: ${total} function(s)${missing.length ? ` — not found: ${missing.join(", ")}` : ""}`);
  if (!ok) process.exitCode = 1;
}

// Global: switch, blocked-message helper, enabler-bag lock
patchScripts("Global: hook 'mtg engine' chat command before other chat handling",
  "function onChat(message, pl)\n",
  `function onChat(message, pl)\n  local engineReply = engineChat(message, pl) if engineReply ~= nil then return engineReply end ${TAG}\n  if ENGINE_MODE then return end ${TAG} turn chat commands are the engine's job\n`,
  1, { global: true });
// The profile as one Lua global (the renderer's per-table data, so no new main-chunk locals). Each table is written in
// the profile's own order: Lua's pairs follows the order a table was built in.
{
  const list = (a) => `{ ${a.map((x) => (typeof x === "string" ? JSON.stringify(x) : String(x))).join(", ")} }`;
  const map = (o, val) => `{ ${Object.entries(o).map(([k, v]) => `${k} = ${val(v)}`).join(", ")} }`;
  const by = (f) => Object.fromEntries(SEATS.map((c) => [c, f(PROFILE.seat[c])]));
  // every seat's button of one kind, west to east (then south to north): the order the renderer's list always had
  const row = (role) => SEATS.map((c) => PROFILE.seat[c][role]).sort((a, b) => a.x - b.x || a.z - b.z).map((o) => o.guid);
  save.LuaScript += `

${TAG} the table's profile (tools/table-profile.js, docs/m6-six-seat-spec.md §2.2): its seats clockwise, each seat's life
-- tracker, commander-damage trackers (victim -> attacker -> GUID; on the 6-player table the ones this build made) and
-- commander zones, the Start tile's spot, the west strip's Format / Free mulligans / Teams buttons' spots (and the east strip's format switches), the
-- table's own Untap / Reveal / Draw / Mill / Scry buttons and Mulligan tiles (every seat's) and the Draw buttons alone
TABLE_PROFILE = {
  id = ${JSON.stringify(PROFILE.id)},
  seats = ${list(SEATS)},
  life = ${map(by((s) => s.lifeTracker.guid), JSON.stringify)},
  cmdDamage = ${map(PROFILE.cmdDamage || {}, (row) => map(row, JSON.stringify))},
  tax = ${map(by((s) => s.commandZones.map((z) => z.guid)), list)},
  start = ${list(PROFILE.start)},
  spots = ${map(PROFILE.spots, list)},
  buttons = ${list(["untapButton", "revealButton", "drawButton", "millButton", "scryButton", "mulliganButton"].flatMap(row))},
  draw = ${list(row("drawButton"))},
}`;
  // the bridge's default is the 4-player table's four, so only another table names its seats (engineHello, bridge noteTableSeats)
  if (SEATS.length !== 4) save.LuaScript += `\nENGINE_TABLE_SEATS = TABLE_PROFILE.seats`;
}
save.LuaScript += `

${TAG} ===================== ENGINE MODE =====================
-- Off by default on every load: the table's own tools work as in the original (the engine code stays loaded:
-- its hotkey, rewind hold and profiler run either way).
ENGINE_MODE = false
local engineBlockedAt = {}

-- Called by any gated button/tool; one message per tool every few seconds.
function engineBlocked(what)
  local now = os.clock()
  if engineBlockedAt[what] and now - engineBlockedAt[what] < 3 then return end
  engineBlockedAt[what] = now
  broadcastToAll("[MTG] Engine mode is on: '" .. tostring(what) .. "' is handled by the rules engine.", {1, 0.65, 0.2})
end

function setEngineMode(on)
  ENGINE_MODE = on and true or false
  Turns.pass_turns = not ENGINE_MODE -- TTS's own end-turn button; the engine decides turns
  if ENGINE_MODE then
    broadcastToAll("[MTG] Engine mode ON: manual rules buttons, hotkeys and tools are off. The rules engine runs the game.", {0.4, 1, 0.5})
  else
    broadcastToAll("[MTG] Engine mode OFF: the table works as normal.", {1, 1, 1})
  end
  if engineSetupButtons ~= nil then pcall(engineSetupButtons) end -- the Ready / Start buttons come and go with it
  enginePromoteSeated()
end

-- Every seated player is promoted (TTS's own host-like permissions: delete, move and lock anything), engine mode on or
-- off, so a player can set up, clear their own deck or fix the table without the host. The original table did this with
-- its Auto Player Promoter (cd83de, which promotes everyone on load and on join), and the engine copy removes that
-- object (table-profile.js ENCODER_MODULES); promoting only while engine mode was on left every friend unpromoted from
-- a load or a reset (engine mode off) to the next Start, and their Delete and moves on their own decks did nothing
-- (the user, 2026-11-13 and 2026-11-23: "people can't move or delete their cards before game starts", before and after
-- New game). Only players the table promoted are demoted again, when they leave their seat. A player the host
-- promoted stays promoted. The list survives a reload (onSave in engine-renderer.lua). They do not get the host-only
-- "mtg" commands (engineIsHost). A player who disconnects is dropped from the list the next time this runs
-- while they are back and not promoted.
-- (The user, 2026-11-14: "allow the other players the same privileges the host has when the engine is on".)
ENGINE_PROMOTED = {} -- steam_id -> true: promoted by this table, not by the host
-- who may use the host-only "mtg" commands: the host, or a player the host promoted or made admin; never one this
-- table promoted (enginePromoteSeated). The one test, for engineChat here and engineGif.chat in engine-renderer.lua.
function engineIsHost(pl)
  return pl.host or ((pl.admin or pl.promoted) and not (ENGINE_PROMOTED or {})[tostring(pl.steam_id)])
end
function enginePromoteSeated()
  for _, pl in ipairs(Player.getPlayers()) do
    local sid = tostring(pl.steam_id)
    local want = pl.seated and data[pl.color] ~= nil
    if want and not (pl.host or pl.admin or pl.promoted) then
      pl.promote() -- (TTS's promote() toggles; the guard above makes it a promote)
      ENGINE_PROMOTED[sid] = true
    elseif not want and ENGINE_PROMOTED[sid] then
      if pl.promoted and not pl.host then pl.promote() end -- (a toggle: only while promoted)
      ENGINE_PROMOTED[sid] = nil
    end
  end
end

-- Starts an engine game with the seated players (and "ai N" Forge AI players). "mtg start" (host) and the Start
-- button in the middle of the table (anyone, once every seated player is ready) both come here.
function engineStartGame(pl, rest, cleared)
  rest = rest or ""
  -- cards of an earlier engine game still out (it ended, or the table was reloaded mid-game): its "Library" stand-in
  -- would be read as the player's deck. Clear them (engine mode stays on), then start a moment later; the bridge
  -- resets its side of that game too (autoReset).
  for _, o in ipairs(getObjects()) do
    local gm = tostring(o.getGMNotes())
    -- (the hidden trash deck is fine, and so are the effect and sound bundles: the table's, engineIsBundleObject)
    if gm:find("^engine:") and gm ~= "engine:trash" and not (engineIsBundleObject ~= nil and engineIsBundleObject(gm)) then
      if cleared then
        pl.broadcast("[MTG] Cards from the last engine game are still on the table. Type  mtg reset , wait for 'Forge room restarted', then  mtg start  again.", {1, 0.6, 0.3})
        return false
      end
      engineKeepEngineMode = true
      engineClear()
      Wait.frames(function() engineStartGame(pl, rest, true) end, 45)
      return false
    end
  end
  local seats = {}
  for _, c in ipairs(getSeatedPlayers()) do if data[c] then seats[#seats + 1] = c end end
  local bots = tonumber(rest:match("(%d+)") or "0")
  -- a deck (with its commander) put in an EMPTY seat's library zone is played by one of the AI players
  local aiSeats, read = {}, {}
  for _, c in ipairs(seats) do read[#read + 1] = c end
  -- "mtg start ai N builtin": the AI players use built-in decks (mtg aideck), not decks in empty seats
  if bots > 0 and not rest:find("builtin") then
    local seated = {}
    for _, c in ipairs(seats) do seated[c] = true end
    for _, c in ipairs(TABLE_PROFILE.seats) do
      local zone = data[c] and data[c].libraryZone
      if not seated[c] and zone ~= nil and getDeckFromZone(zone) ~= nil and #aiSeats < bots then
        aiSeats[#aiSeats + 1] = c
        read[#read + 1] = c
      end
    end
  end
  -- online game: the host's upload carries every other player (TTS has no dedicated server)
  local remote = 0
  for _, c in ipairs(getSeatedPlayers()) do if not Player[c].host then remote = remote + 1 end end
  if remote > 0 then
    broadcastToAll("[MTG] Online game: the host's internet upload carries every player. Host needs at least 5 Mbps upload (10+ recommended), a wired connection and no VPN. If anyone sees choppy movement or slow buttons, let whoever has the best upload host.", {1, 0.85, 0.4})
  end
  -- always read the decks that are on the table now, so an older "ready" deck can't sneak into this game
  -- (two presses of Start, or the button and "mtg start", in one moment sent two starts: the second restarted the
  -- engine room under the first and the game never began, playtest 2026-10-25)
  if engineStartSentAt ~= nil and os.clock() - engineStartSentAt < 5 then return false end
  engineStartSentAt = os.clock()
  engineSendDecks(read, pl.color)
  local start = { stamp = engineStamp(), seats = seats, bots = bots, requireReady = true, aiSeats = aiSeats, autoReset = true, friendly = engineFriendly, mode = engineModeSent(), teams = engineTeamsSent ~= nil and engineTeamsSent() or nil,
    teamMode = engineTeamModeSent ~= nil and engineTeamModeSent() or nil, juggernaut = engineJuggSent ~= nil and engineJuggSent() or nil,
    teamTurns = engineTeamTurnsSent ~= nil and engineTeamTurnsSent() or nil }
  -- (the format and its two switches: nothing for Casual Commander, docs/format-banlist-spec.md §6.4)
  if engineRulesInto ~= nil then engineRulesInto(start) end
  -- (the table's seats, clockwise, when it isn't the 4-player table: engineHello, tools/engine-renderer.lua)
  if ENGINE_TABLE_SEATS ~= nil then start.tableSeats = ENGINE_TABLE_SEATS end
  -- (the seated players' Steam IDs: the bridge keeps a forced tie's accomplishment by them)
  if engineSteamIds ~= nil then start.steam = engineSteamIds(seats) end
  -- (Treachery: who holds the Leader's identity card, who then goes first; nothing without identity cards)
  if engineTreacheryLeader ~= nil then start.treachery = engineTreacheryLeader() end
  engineSend("start", start)
end

-- All "mtg ..." chat commands. Returns false (hide the line) when handled, nil otherwise.
function engineChat(message, pl)
  local lower = string.lower(message)
  if not lower:match("^%s*mtg%f[%A]") then return nil end
  -- (a position capture and a trim, not "(.-)%s*$": that lazy match raised "pattern too complex" in TTS once the
  -- text passed ~55 characters, tmp/pattern-trap/audit.md)
  local cmd, restAt = lower:match("^%s*mtg%s*(%a*)%s*()")
  local rest = (lower:sub(restAt):gsub("%s+$", ""))
  -- (a player the table promoted for engine mode, enginePromoteSeated, is not a host here: engineIsHost)
  local isHost = engineIsHost(pl)
  -- (the team modes' "mtg mode 2hg|2v2|juggernaut|ffa", "mtg team ...", "mtg juggernaut ..." and "mtg 2hg turns ...": engineTeamChat, engine-renderer.lua)
  if engineTeamChat ~= nil and engineTeamChat(cmd, rest, pl, isHost) then return false end
  -- (the format, its two switches and its ban list: "mtg format", "mtg banned", "mtg restricted", "mtg banlist": engineFormatChat)
  if engineFormatChat ~= nil and engineFormatChat(cmd, rest, pl, isHost) then return false end
  -- engine mode, starting a game, friendly mulligans and clearing a finished one: anyone, seated or not (playtest
  -- 2026-10-25: "allow non host to turn the engine on and off and to start games"; 2026-11-10: "allow anyone to
  -- click engine on/off and start too"); ending a running game stays the host's
  if cmd == "engine" then
    if rest == "on" then setEngineMode(true)
    elseif rest == "off" and engineTable ~= nil and engineTable() ~= nil then
      -- mid-game the engine's cards would stay while the table's own tools came back: end the game instead
      pl.broadcast("[MTG] An engine game is running. Type  mtg reset  to end it (that also turns engine mode off).")
    elseif rest == "off" then setEngineMode(false)
    else pl.broadcast("[MTG] Engine mode is " .. (ENGINE_MODE and "ON" or "OFF") .. ". Use: mtg engine on | mtg engine off")
    end
  elseif cmd == "friendly" then
    local n = tonumber(rest)
    if n == 0 or n == 1 or n == 2 then engineSetFriendly(n, pl)
    else pl.broadcast("[MTG] Use: mtg friendly 0 | 1 | 2  (free mulligans each, for everyone)") end
  elseif cmd == "ready" then
    if rest == "all" then
      if not isHost then pl.broadcast("[MTG] Only the host can check everyone's decks.") return false end
      local seats = {}
      for _, c in ipairs(getSeatedPlayers()) do if data[c] then seats[#seats + 1] = c end end
      engineSendDecks(seats, pl.color)
    else
      engineSendDecks({ pl.color }, pl.color)
    end
  elseif cmd == "commander" then
    engineMarkCommander(pl)
  elseif cmd == "clear" then
    -- "mtg clear deck": your own deck and commander off your seat, by the script (players whose Delete did nothing)
    if rest ~= "deck" then pl.broadcast("[MTG] Type  mtg clear deck  to remove your own deck and commander from your seat.") return false end
    local n, why = engineClearDeck(pl.color)
    if n == nil then pl.broadcast("[MTG] " .. why)
    elseif n == 0 then pl.broadcast("[MTG] No deck or commander on your seat.")
    else pl.broadcast("[MTG] Removed your deck and commander (" .. n .. (n == 1 and " object" or " objects") .. "). Load a new one any time.") end
  elseif cmd == "start" then
    engineStartGame(pl, rest)
  elseif cmd == "undo" then
    -- rewind by vote: "mtg undo" lists the restore points, "mtg undo 3" asks to go back to the third
    local pts = (engineRewind and engineRewind.points) or {}
    local k = tonumber(rest:match("^(%d+)") or "")
    if #pts == 0 then pl.broadcast((engineRewind and engineRewind.off) and ("[MTG] " .. engineRewind.off) or "[MTG] No restore points yet (they come with a running engine game).")
    elseif k ~= nil then
      if not engineAskRewind(pl.color, k) then pl.broadcast("[MTG] No point " .. k .. ". Type  mtg undo  for the list.") end
    else
      local lines = {}
      for i, pt in ipairs(pts) do lines[#lines + 1] = "  " .. i .. ": " .. pt.label end
      pl.broadcast("[MTG] Rewind to (the other players vote):\\n" .. table.concat(lines, "\\n") .. "\\nType  mtg undo N  or use the Undo... button.")
    end
  elseif cmd == "effects" then
    -- M5: a player's own screen effects (banners, turn banner, stack pop-up, the table effects' panels) on or off
    -- (also: Settings → My effects)
    engineEffectsOff[pl.color] = (rest == "off") or nil
    if enginePopRefresh ~= nil then enginePopRefresh() end
    pl.broadcast("[MTG] Your screen effects (banners, turn banner, stack pop-up and table effects): " .. (engineEffectsOff[pl.color] and "off" or "on") .. ". Type  mtg effects on  or  mtg effects off  (or Settings) to change.", {1, 0.85, 0.4})
  elseif cmd == "sounds" then
    -- M5 step 4: the table's sounds are shared, so on/off is the host's switch (engineSetSounds; Settings → My sounds
    -- too); "mtg sounds test <kind>" (host) plays that pick now, any of engineSoundKinds (knockout, wipe, bighit, death,
    -- exile, countered, playerhit, damage, lifegain, treasure, treasurespend, sorcery, instant, counter); "mtg sounds test <kind> N" plays the burst a count of N picks (death 5: x4)
    local kind, count = rest:match("^test%s+(%a+)%s*(%d*)$")
    count = tonumber(count) or 1
    local known = false
    for _, k in ipairs(engineSoundKinds) do if k == kind then known = true end end
    if kind ~= nil then
      if not pl.host then pl.broadcast("[MTG] Only the host can test the table's sounds (everyone hears them).")
      elseif not known then pl.broadcast("[MTG] The sounds are: " .. table.concat(engineSoundKinds, ", ") .. ".")
      elseif engineSounds[kind] == nil then pl.broadcast("[MTG] No sound picked for " .. kind .. " yet (engineSounds." .. kind .. ", docs/m5-effects-design.md section 6).")
      elseif engineSoundPlay(kind, true, count) then pl.broadcast("[MTG] Playing the " .. kind .. " sound" .. (count > 1 and (" for " .. count .. " at once") or "") .. ".")
      else pl.broadcast("[MTG] The " .. kind .. " sound didn't play (table sounds off, the players' own music is playing, or the pick isn't found).") end
    elseif rest == "on" or rest == "off" then engineSetSounds(pl, rest == "on")
    else pl.broadcast("[MTG] Table sounds: " .. (engineSoundsMuted and "off" or "on") .. ". Type  mtg sounds on  or  mtg sounds off  (host), or  mtg sounds test <kind> [N]  with one of " .. table.concat(engineSoundKinds, ", ") .. ".", {1, 0.85, 0.4}) end
  elseif cmd == "animations" then
    -- the table's shared animations (attack swings, mills, the graveyard flash): the host's switch (Settings too)
    if not pl.host then pl.broadcast("[MTG] Only the host can turn the table's animations on or off (everyone sees them).")
    else engineSetAnimations(rest ~= "off", pl.steam_name) end
  elseif cmd == "fx" then
    -- the table's particle effects (docs/particle-fx-spec.md): shared, so the host's switch; saved with the game.
    -- "mtg fx test <kind> [colour] [W|U|B|R|G|C|M]" (host): one effect now (engineFxTest), for the two-player check
    -- (docs/two-player-check.md): at the card under the host's pointer, else at the colour's seat, else the host's;
    -- wave sweeps from that seat in the colour key (B when none)
    local test = rest:match("^test%s*(.*)$")
    if test ~= nil then
      local kinds = engineFxTestKinds ~= nil and engineFxTestKinds() or {}
      local kind, seat, key = nil, nil, nil
      for w in test:gmatch("%a+") do
        if kind == nil then kind = w
        elseif #w == 1 and ("wubrgcm"):find(w, 1, true) then key = w:upper()
        else seat = w:sub(1, 1):upper() .. w:sub(2) end -- (engineFxTest says when it is no seat's colour)
      end
      local known = false
      for _, k in ipairs(kinds) do if k == kind then known = true end end
      if not isHost then pl.broadcast("[MTG] Only the host can test the table's particle effects (everyone sees them).")
      elseif not known then pl.broadcast("[MTG] Type  mtg fx test <effect> [colour]  with one of: " .. table.concat(kinds, ", ") .. ". Point at a card first to play it there.")
      else
        local o = pl.getHoverObject()
        -- (an engine object's GM notes are "engine:<its id>"; one that isn't a card, a rig say, falls back to the seat)
        local id = seat == nil and o ~= nil and tostring(o.getGMNotes()):match("^engine:(.+)$") or nil
        local at = seat or pl.color
        local said
        if kind == "wave" then said = engineFxTest("wave", at, key or "B")
        else
          said = id and engineFxTest(kind, id)
          if not id or said == "no such card or colour on the table" then said = engineFxTest(kind, at) end
        end
        pl.broadcast("[MTG] fx test " .. kind .. ": " .. tostring(said) .. ".", {1, 0.85, 0.4})
      end
    elseif rest == "on" or rest == "low" or rest == "off" then
      if not isHost then pl.broadcast("[MTG] Only the host can change the table's particle effects (everyone sees them).")
      else engineSetFxMode(rest, pl.steam_name) end
    else pl.broadcast("[MTG] Table particle effects: " .. tostring(engineFxMode) .. ". Type  mtg fx on ,  mtg fx low  (a wipe's wave without each card's own effect, no bolts) or  mtg fx off  (host); mtg fx test <effect> [colour]  plays one now (host).", {1, 0.85, 0.4}) end
  elseif cmd == "concede" then
    -- out for good, so it asks once more: "mtg concede" twice within 15 seconds
    engineConcedeAsk = engineConcedeAsk or {}
    local at = engineConcedeAsk[pl.color]
    if at ~= nil and os.clock() - at < 15 then
      engineConcedeAsk[pl.color] = nil
      engineSend("concede", { color = pl.color })
    else
      engineConcedeAsk[pl.color] = os.clock()
      -- (Two-Headed Giant: a player concedes for the team, 810.8b; not in 2v2 or Juggernaut, rule "teams", where the
      -- team plays on)
      -- (engineTable: the renderer's last board; its local lastTable is declared after this chunk)
      local board = engineTable ~= nil and engineTable() or nil
      local team = engineTeamOf ~= nil and board ~= nil and not (board.teams and board.teams.rule == "teams") and engineTeamOf(board, pl.color) or nil
      -- (a Three-Headed Giant team is three: "all", not "both")
      pl.broadcast(team ~= nil and ("[MTG] Concede for your team (" .. engineTeamWords(team) .. ")? You are " .. (#team > 2 and "all" or "both") .. " out for good. Type  mtg concede  again within 15 seconds to confirm.")
        or "[MTG] Concede the game? You are out for good. Type  mtg concede  again within 15 seconds to confirm.", {1, 0.6, 0.3})
    end
  elseif cmd == "winner" then
    -- Treachery: the roles decide who wins; the host names the winner and everyone else at the table concedes
    if not isHost then pl.broadcast("[MTG] Only the host can declare the winner.") return false end
    local who = nil
    for _, c in ipairs(TABLE_PROFILE.seats) do if c:lower() == rest then who = c end end
    if who == nil then pl.broadcast("[MTG] Use:  mtg winner " .. table.concat(TABLE_PROFILE.seats, "|"):lower()) return false end
    engineSend("winner", { color = who, by = pl.color })
  elseif cmd == "autoresolve" then
    -- on other players' turns, pass priority by itself (also the Auto-resolve button)
    engineSetAutoResolve(pl.color, rest ~= "off")
    pl.broadcast("[MTG] Auto-resolve " .. (rest ~= "off" and "on" or "off") .. ".", {1, 0.85, 0.4})
  elseif cmd == "skip" then
    -- pass priority until a phase ("mtg skip end", "mtg skip combat", "mtg skip mine", "mtg skip off"): the bridge
    -- passes until then; an opponent's spell stops it (2026-10-29)
    engineSend("skipto", { color = pl.color, phase = rest })
  elseif cmd == "hold" then
    -- keep priority once this turn after something goes on the stack (also the Hold button); "mtg hold off"
    engineSend("hold", { color = pl.color, on = rest ~= "off" })
  elseif cmd == "stop" then
    -- stop a long run of triggers at your next priority (the bridge passes them back to back, docs/big-turns.md)
    engineSend("stopchain", { color = pl.color })
  elseif cmd == "repeat" then
    -- repeat the loop you just played once by hand, N more times ("mtg repeat 100"; no number: the how-many question),
    -- at your priority back on the same board (the bridge's "Repeat ×N", rule 732.2)
    engineSend("repeatloop", { color = pl.color, n = tonumber(rest) })
  elseif cmd == "refresh" then
    -- your hand, your open question and your panels drawn again, and the game asked for again (after a lag-out, or a
    -- question that never showed: engineSeatBack in engine-renderer.lua)
    if engineRefreshSeat ~= nil then engineRefreshSeat(pl.color) end
  elseif cmd == "timer" then
    -- turn timers for everyone (host): mtg timer [seconds] / mtg timer off
    if not isHost then pl.broadcast("[MTG] Only the host can set the turn timers.") return false end
    engineSend("timer", { on = rest ~= "off", seconds = tonumber(rest) })
  elseif cmd == "fix" then
    -- manual fix by vote (PLAN M7): mtg fix / mtg fix yes|no / done / cancel / life|poison|counters ...
    if rest == "" then engineSend("fix", { color = pl.color, action = "call" })
    elseif rest == "yes" or rest == "no" then engineSend("fix", { color = pl.color, action = "vote", accept = rest == "yes" })
    elseif rest == "done" then engineFixDone(pl.color)
    elseif rest == "cancel" then engineSend("fix", { color = pl.color, action = "cancel" })
    -- mtg fix note <text>: the text as typed, not lowered (it goes to the log)
    elseif rest == "note" or rest:find("^note%s") then engineFixSet(pl.color, "note " .. (message:sub(message:match("^%s*[Mm][Tt][Gg]%s*[Ff][Ii][Xx]%s+[Nn][Oo][Tt][Ee]%s*()") or #message + 1):gsub("%s+$", "")))
    else engineFixSet(pl.color, rest) end
  elseif cmd == "mana" then
    -- mtg mana <n> [for <colour>]: the manual fix in one line (pause, n of each colour until the end of the turn,
    -- Done); against the AI it applies at once, other players vote as for any fix (2026-10-26, testing with 99 mana)
    local k = tonumber(rest:match("^(%d+)") or "")
    if k == nil or k < 1 or k > 99 then pl.broadcast("[MTG] Use:  mtg mana <1-99> [for <colour>]  (that many of each colour, until the end of the turn)") return false end
    engineAutoMana = engineAutoMana or {}
    engineAutoMana[pl.color] = { rest = rest, at = os.clock() }
    engineSend("fix", { color = pl.color, action = "call" })
  elseif cmd == "debug" then
    -- mtg debug <scenario> / list / off: a test board from scenarios/<name>.json (lands out, named cards in hand),
    -- set up through the manual fix now, or at your first priority in the next game (the bridge reads the file)
    engineSend("debug", { color = pl.color, scenario = rest })
  elseif cmd == "hand" then
    -- mtg hand <card>, <card> ... / off / (nothing: what is waiting): a picked starting hand for your next game
    -- against the AI, debug tools on (the bridge checks the names and the game, docs/companion-app-spec.md 10.3)
    engineSend("hand", { color = pl.color, text = rest })
  elseif cmd == "planechase" or cmd == "planes" then
    -- Planechase for the next games (host): mtg planechase on|off; mtg planes random [N] / mtg planes <name>; <name>
    -- (the bridge checks the names against Forge's planes, docs/planechase-dungeon-engine-spec.md P1)
    if not isHost then pl.broadcast("[MTG] Only the host can set up Planechase.") return false end
    if cmd == "planechase" then engineSend("planechase", { color = pl.color, on = rest ~= "off" })
    else engineSend("planes", { color = pl.color, text = rest }) end
  elseif cmd == "match" then
    -- best of three (host: bo3 / bo1; anyone: mtg match, the score; mtg match concede)
    if not isHost and rest ~= "" and rest ~= "concede" then pl.broadcast("[MTG] Only the host can set best of three.") return false end
    engineSend("match", { color = pl.color, text = rest })
  elseif cmd == "treachery" then
    -- Treachery's Leader goes first (host): mtg treachery on / off / leader <colour>; mtg treachery says the setting
    if not isHost and rest ~= "" then pl.broadcast("[MTG] Only the host can change who goes first in Treachery.") return false end
    engineSend("treachery", { color = pl.color, text = rest })
  elseif cmd == "archenemy" or cmd == "schemes" then
    -- Archenemy for the next games (host): mtg archenemy <colour> / off; mtg schemes random / mtg schemes <name>; <name>
    -- (the bridge checks the colour and the names against Forge's schemes, docs/team-turns-archenemy-plan.md §2.7)
    if not isHost and rest ~= "" then pl.broadcast("[MTG] Only the host can set up Archenemy.") return false end
    if cmd == "archenemy" then
      engineSend("archenemy", { color = pl.color, text = rest })
      if engineArchNoted ~= nil then engineArchNoted(rest) engineSetupButtons() end
    else engineSend("schemes", { color = pl.color, text = rest }) end
  elseif cmd == "mode" then
    -- the next games' mode (host): mtg mode standard / mtg mode commander (docs/game-modes-spec.md §3.4), now the Standard
    -- or the Casual Commander format (engineSetModeFormat); "mtg mode" says it
    if rest == "" then pl.broadcast("[MTG] Game mode: " .. (ENGINE_GAME_MODE == "standard" and "60-card" or "Commander") .. ", format " .. engineFormatNow().name .. (ENGINE_TEAMS ~= nil and engineTeamsText ~= nil and (", " .. (ENGINE_TEAM_NAMES[ENGINE_TEAM_MODE or "2hg"] or "Two-Headed Giant") .. " (" .. engineTeamsText() .. ")") or "") .. ". The host changes it:  mtg format <name>  (or the Format button;  mtg format  lists them), or  mtg mode standard  /  mtg mode commander ; teams:  mtg mode 2hg,  mtg mode 2v2,  mtg mode juggernaut,  mtg mode 3hg  (the six-seat table)  or  mtg mode ffa  (or the Teams button).")
    elseif not isHost then pl.broadcast("[MTG] Only the host can change the game mode (everyone plays it).")
    elseif rest == "standard" or rest == "commander" then engineSetModeFormat(rest, pl)
    else pl.broadcast("[MTG] Use:  mtg mode standard  (60-card decks, 20 life, no commander) or  mtg mode commander") end
  elseif cmd == "art" then
    -- the players' own card pictures (a deck line "1 Sol Ring #https://..."), on or off for everyone (host):
    -- mtg art off / mtg art on (the bridge's customArt, docs/custom-art-spec.md)
    -- (and anyone's own: mtg art token <name> <link> for their tokens, mtg art back <card> <link> for a two-faced card's
    -- back; the bridge's onArtSet checks the link)
    if rest:sub(1, 5) == "token" or rest:sub(1, 4) == "back" then
      engineSend("artset", { color = pl.color, steam = pl.steam_id, text = message:sub(restAt) }) -- (as typed: a link keeps its capitals)
      return false
    end
    if not isHost then pl.broadcast("[MTG] Only the host can switch custom card art (everyone sees the same pictures).") return false end
    if rest == "on" or rest == "off" then engineSend("art", { color = pl.color, on = rest == "on" })
    else pl.broadcast("[MTG] Use:  mtg art off  (everyone sees the normal card pictures) or  mtg art on  (the pictures players linked in their deck lists)") end
  elseif cmd == "vote" then
    if rest == "yes" or rest == "no" then engineSend("rewindVote", { color = pl.color, accept = rest == "yes" })
    else pl.broadcast("[MTG] Use:  mtg vote yes  or  mtg vote no") end
  elseif cmd == "tie" then
    -- the tie offer when a player can't lose (the Tie / Keep playing pop-up): mtg tie yes / mtg tie no
    if rest == "yes" or rest == "no" then engineSend("tieVote", { color = pl.color, accept = rest == "yes", steam = engineSteamOf ~= nil and engineSteamOf(pl.color) or "" })
    -- (and alone, the open offer's words again: its strip may be closed, engineTieDraw)
    elseif rest == "" and ENGINE_TIE_LAST ~= nil and engineTieWords ~= nil then pl.broadcast("[MTG] " .. engineTieWords(ENGINE_TIE_LAST, false))
    else pl.broadcast("[MTG] Use:  mtg tie yes  (accept the tie)  or  mtg tie no  (keep playing)") end
  elseif cmd == "accomplishments" then
    engineSend("accomplishments", { color = pl.color, steam = engineSteamOf ~= nil and engineSteamOf(pl.color) or "" })
  elseif cmd == "glow" then
    if engineToggleGlow ~= nil then pl.broadcast("[MTG] Green glow on playable cards and usable permanents: " .. engineToggleGlow(pl.color)) end
  elseif cmd == "aideck" then
    if not isHost then pl.broadcast("[MTG] Only the host can choose the AI decks.") return false end
    engineSend("aideck", { deck = rest })
  elseif cmd == "ai" then
    -- mtg ai <colour> harmless|forge [deck] / <colour> off / clear / list: who plays an empty seat (the bridge's
    -- aiSeatChoice; the companion page sets the same, with a pasted deck list too)
    if not isHost then pl.broadcast("[MTG] Only the host can set the AI seats.") return false end
    engineSend("aiseat", { text = rest })
  elseif cmd == "reset" then
    local running = engineTable ~= nil and engineTable() or nil
    if not (isHost or running == nil or running.gameOver) then
      pl.broadcast("[MTG] Only the host can end a game that is still going.") return false
    end
    engineSend("reset", {})
    if ENGINE_MODE then engineClear() end -- don't wait for the bridge's "clear" (it may be down)
  else
    pl.broadcast("[MTG] Commands:\\n${[
      " mtg ready / mtg ready all (host) - check decks",
      " mtg format [name] (host) - the next games' format: Casual Commander (the default), Commander, Duel Commander, Pauper Commander, PreDH, Casual 60-card, Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Premodern, Old School, Historic, Timeless, Alchemy (also the Format button; mtg mode standard|commander picks Standard or Casual Commander)",
      " mtg banned on|off, mtg restricted on|off (host) - the format's banned cards not allowed / allowed (house rule), its restricted cards 1 copy / the normal limit; mtg banlist - its banned cards (the Notebook's Banned list tab); mtg banlist refresh (host) - the bridge checks for a newer list now",
      " mtg mode 2hg / 2v2 / juggernaut / 3hg / ffa (host) - Two-Headed Giant or Juggernaut (one against three) in Commander, 2v2 (White + Red vs Yellow + Blue) in Standard, Three-Headed Giant (the six-seat table's sides, three a team) in either, or free-for-all; mtg 2hg turns shared / own (host; mtg 3hg turns ... the same) - one turn for each team, attacking and blocking together, or each player's own turn (also the Team turns button); mtg team <colour> 1|2 (host) - move a seat;mtg juggernaut <colour> / life|hand|draw|land <n> / cmd 21|42 / order first|after (host) - the Juggernaut",
      " mtg commander - hover your commander first",
      " mtg clear deck - remove your own deck and commander from your seat (not during a game)",
      " mtg start [ai N] - start the engine game, optionally with N Forge AI players",
      " mtg ai <colour> harmless|forge [deck] / mtg ai <colour> off (host) - who plays an empty seat, every game",
      " mtg friendly 0|1|2 - free mulligans each, for everyone (the rules' free one included)",
      " mtg reset - put the imported decks back once the game is over (host: also mid-game)",
      " mtg undo [N] - rewind (the others vote); mtg vote yes/no",
      " mtg tie yes/no - answer a tie offer (a player who can't lose); mtg accomplishments - yours (a forced tie earns Stalemate)",
      " mtg fix - pause the game to put the board right (the others vote); mtg fix yes/no/done/cancel; mtg fix token <what> [for <colour>]; mtg fix note <text> - what should have happened, for the log; mtg mana <n> - n mana of each colour until the end of the turn (a fix in one line)",
      " mtg debug <scenario> - a test board (20 lands out, the scenario's cards in hand); mtg debug list / off",
      " mtg hand <card>, <card> ... (debug tools on, against the AI) - your next game's starting hand, the rest dealt from your deck; mtg hand off",
      " mtg planechase on|off (host) - Planechase in the next games; mtg planes random [N] / mtg planes <name>; <name> - the planar decks",
      " mtg match bo3|bo1 (host) - best of three in Standard 1v1: the loser of each game chooses play or draw, then each player sideboards; mtg match says the score; mtg match concede - give up the match",
      " mtg treachery on|off|leader <colour> (host) - Treachery: the Leader goes first (found from the table's identity cards, or named)",
      " mtg archenemy <colour>|off (host) - Archenemy in the next games: that seat (a player or an AI) against everyone else; mtg schemes random / mtg schemes <name>; <name> - the scheme deck (20 or more, 2 of each at most)",
      " mtg art token <token name> <link> - your picture for your tokens of that name; mtg art back <card> <link> - your two-faced card's back; mtg art token / back clear",
      " mtg art off|on (host) - the players' own card pictures (1 Sol Ring #https://... in the deck list) or the normal ones, for everyone",
      " mtg skip <upkeep|draw|main|combat|blockers|damage|main2|end|mine|off> - pass priority until that phase (an opponent's spell stops it)",
      " mtg hold - keep priority once after something goes on the stack, to respond to your own spell (also the Hold button)",
      " mtg stop - stop a long run of triggers resolving by itself: your next priority with something on the stack is asked; it also stops a Repeat ×N",
      " mtg repeat <n> - after one pass of a loop by hand, back to the same board, repeat it n more times (up to 1000; also the Repeat ×N button); anyone may respond, and that stops it",
      " mtg refresh - your hand, your question and your panels drawn again (after a lag-out, or a question that never showed)",
      " mtg timer [seconds] / mtg timer off (host) - turn timers for everyone",
      " mtg concede - leave the game; mtg winner <colour> (host, Treachery)",
      " mtg engine on/off",
      " mtg effects on/off - your own; mtg sounds on/off (host: shared), mtg sounds test <knockout|wipe|bighit|death|exile|countered|playerhit|damage|lifegain|treasure|treasurespend|sorcery|instant|counter> [N] (N at once); mtg animations on/off (host) - also under Settings",
      " mtg fx on/low/off (host) - the table's particle effects; mtg fx test <effect> [colour] (host) - play one now, at the card you point at",
      " mtg gif <words> / mtg gif off - your GIF frame (once the host has a GIPHY key); mtg gifs hide/show - on your screen; mtg gifs still - a GIF is a white square for you; mtg gif help - every GIF command",
    ].join("\\n")}")
  end
  return false
end

-- ───── Step 2: "mtg ready" — read imported decks so the bridge can check them against the engine ─────
local COMMAND_ZONES = TABLE_PROFILE.tax
local commanderPick = {} -- color -> { [guid] = true }, chosen with "mtg commander"
local readyRequest = 0

local function cardName(nick)
  local first = tostring(nick or ""):match("^[^\\n]*") or ""
  return (first:gsub("%s+$", ""))
end

-- Name plus the card's own images, so the engine's copy of the card looks the same on the table.
-- Cards inside an imported deck carry no images of their own: the deck holds them, keyed by CardID / 100.
local function cardInfo(d, deckImages)
  local face, back
  for _, cd in pairs(d.CustomDeck or {}) do face, back = cd.FaceURL, cd.BackURL break end
  if face == nil and deckImages ~= nil and d.CardID ~= nil then
    local key = math.floor(d.CardID / 100)
    local cd = deckImages[key] or deckImages[tostring(key)]
    if cd ~= nil then face, back = cd.FaceURL, cd.BackURL end
  end
  -- (a two-faced card's second state, the importer's back face: its name and picture, docs/custom-art-spec.md "DFC")
  local s2 = d.States and (d.States["2"] or d.States[2]) or nil
  local n2, f2 = nil, nil
  if s2 ~= nil then
    n2 = cardName(s2.Nickname)
    for _, cd in pairs(s2.CustomDeck or {}) do f2 = cd.FaceURL break end
    if f2 == nil and deckImages ~= nil and s2.CardID ~= nil then
      local cd2 = deckImages[math.floor(s2.CardID / 100)] or deckImages[tostring(math.floor(s2.CardID / 100))]
      if cd2 ~= nil then f2 = cd2.FaceURL end
    end
  end
  return { n = cardName(d.Nickname), f = face, b = back, n2 = n2, f2 = f2 }
end


-- Treachery identity cards live in the command zone too; they are hidden roles and never leave the table.
local function isIdentity(o) return tostring(o.getName()):find("Identity") ~= nil end

-- Imported cards a player already drew into their hand still belong to their deck.
local function handCards(color)
  local out = {}
  for _, o in ipairs(Player[color].getHandObjects() or {}) do
    if o.type == "Card" and not isIdentity(o) and not tostring(o.getGMNotes()):find("^engine:") then out[#out + 1] = o end
  end
  return out
end

local function commandersFor(color)
  local out = {}
  for guid in pairs(commanderPick[color] or {}) do
    local o = getObjectFromGUID(guid)
    if o ~= nil and o.type == "Card" then out[#out + 1] = cardInfo(o.getData()) end
  end
  if #out > 0 then return out end
  local anchors = {}
  for _, g in ipairs(COMMAND_ZONES[color] or {}) do
    local a = getObjectFromGUID(g)
    if a ~= nil then anchors[#anchors + 1] = a.getPosition() end
  end
  for _, o in ipairs(getObjects()) do
    if o.type == "Card" and not isIdentity(o) then
      local p = o.getPosition()
      for _, a in ipairs(anchors) do
        local dx, dz = p.x - a.x, p.z - a.z
        -- only cards on the table: decks put away under it during a game (y far below) aren't commanders
        if dx * dx + dz * dz < 6.25 and p.y > a.y - 3 then out[#out + 1] = cardInfo(o.getData()) break end
      end
    end
  end
  return out
end

function engineSendDecks(colors, requester)
  local seats = {}
  for _, color in ipairs(colors) do
    local entry = { library = {}, commander = commandersFor(color), deckName = "" }
    local zone = data[color] and data[color].libraryZone
    local deck = zone and getDeckFromZone(zone)
    if deck ~= nil then
      entry.deckName = deck.getName()
      local dd = deck.getData()
      -- (the table's own library stand-ins: when a game ends they can fall onto the deck as it comes back and merge into
      -- it. Counted, they made "the engine doesn't know 9 cards: Library card" and a FIX DECK nobody could fix,
      -- playtest 2026-10-24: they are taken out instead)
      for _, c in ipairs(dd.ContainedObjects or {}) do
        if c.GMNotes == "libcard" then
          if deck.getQuantity() > 1 then
            deck.takeObject({ guid = c.GUID, position = deck.getPosition() + Vector(0, 3, 0), smooth = false, callback_function = function(x) x.destruct() end })
          end
        else
          entry.library[#entry.library + 1] = cardInfo(c, dd.CustomDeck)
        end
      end
    end
    for _, o in ipairs(handCards(color)) do entry.library[#entry.library + 1] = cardInfo(o.getData()) end
    -- (a Standard sideboard: a second deck, or one card, on the seat's graveyard spot before the game; the Card Importer
    -- puts a list's sideboard in the Notebook, so the player imports it as a deck of its own and puts it there. Sent with
    -- the deck, the bridge checks it and tells its owner only; best of three sideboards with it. Never an engine card)
    local gy = data[color] and data[color].graveyard
    local side = gy and getDeckFromZone(gy)
    if side ~= nil and tostring(side.getGMNotes()):sub(1, 6) ~= "engine" then
      entry.sideboard = {}
      local sd = side.getData()
      if side.type == "Card" then entry.sideboard[1] = cardInfo(sd)
      else
        for _, c in ipairs(sd.ContainedObjects or {}) do
          if c.GMNotes ~= "libcard" and tostring(c.GMNotes or ""):sub(1, 6) ~= "engine" then entry.sideboard[#entry.sideboard + 1] = cardInfo(c, sd.CustomDeck) end
        end
      end
    end
    seats[color] = entry
  end
  readyRequest = readyRequest + 1
  local mine = readyRequest
  local msg = { seats = seats, request = mine, mode = engineModeSent() }
  if engineRulesInto ~= nil then engineRulesInto(msg) end -- (the format and its switches: nothing for Casual Commander)
  engineSend("decks", msg)
  broadcastToColor("[MTG] Checking deck" .. (#colors > 1 and "s" or "") .. " with the rules engine...", requester, {0.8, 0.8, 0.8})
  Wait.time(function()
    if readyRequest == mine then
      broadcastToColor("[MTG] No answer from the bridge. Is it running?  node mtg-tts\\\\bridge\\\\bridge.js", requester, {1, 0.4, 0.4})
    end
  end, 4)
end

function engineMarkCommander(pl)
  local o = hoveredObjs[pl.color]
  if o == nil or o.isDestroyed() or o.type ~= "Card" then
    pl.broadcast("[MTG] Keep your mouse over your commander card, press Enter and type: mtg commander")
    return
  end
  commanderPick[pl.color] = commanderPick[pl.color] or {}
  local guid, name = o.getGUID(), cardName(o.getName())
  if commanderPick[pl.color][guid] then
    commanderPick[pl.color][guid] = nil
    pl.broadcast("[MTG] " .. name .. " is no longer marked as your commander.")
  else
    commanderPick[pl.color][guid] = true
    pl.broadcast("[MTG] " .. name .. " marked as your commander (do the same for a partner).")
  end
end

-- TTS only passes flat messages intact, so payloads travel as JSON strings both ways: { t, json }.
-- Messages to the bridge go as background web requests: sendExternalMessage blocks the game for ~80 ms each
-- time (felt as a freeze after every click). If the web request fails, the old way still delivers it.
ENGINE_BRIDGE_URL = "http://127.0.0.1:48787/msg"
-- One at a time, in order: background requests can overtake each other (a "start" arrived before the decks it
-- needed), so the next message goes only once the previous one was delivered.
-- Each message has a number (q), counted per table load (sid): the 5 s watchdog below sends a message again the old way
-- when its web request hasn't answered, and on a host frame hitch the web request had been delivered all along, so the
-- bridge got it twice (bridge-live.log 2026-11-14 22:29 game: Blue's "play Boseiju" at 2505.5 s by web and again at
-- 2511.7 s by the old way; a White "discard Island" twice too). A second copy of an answer to a step-by-step question (same
-- question id, next step) answered the next step too. The bridge drops a number it has already had from this load
-- (bridge.js seenFromTable). The web request carries it in two headers, so its body
-- stays the message itself; the old way carries it beside t and json.
engineLink = { sid = tostring(os.time()) .. "-" .. tostring(math.random(100000, 999999)), seq = 0 }
local engineOutbox, engineSending = {}, false
local function enginePump()
  if engineSending or #engineOutbox == 0 then return end -- (TTS's Lua errors on table.remove of an empty list)
  local item = table.remove(engineOutbox, 1)
  local msg = item.msg
  engineSending = true
  local done = false
  local function sent(failed)
    if done then return end -- (the answer and the watchdog can both arrive)
    done = true
    if failed then sendExternalMessage({ t = msg.t, json = msg.json, sid = engineLink.sid, q = item.q }) end
    engineSending = false
    enginePump()
  end
  -- a request that never answers (bridge stuck) would hold every later message: after 5 s send it the old way
  Wait.time(function() sent(true) end, 5)
  local ok = pcall(function()
    WebRequest.custom(ENGINE_BRIDGE_URL, "POST", true, JSON.encode(msg), { ["Content-Type"] = "application/json", ["X-Mtg-Sid"] = engineLink.sid, ["X-Mtg-Seq"] = tostring(item.q) }, function(req)
      sent(req.is_error)
    end)
  end)
  if not ok then sent(true) end
end
function engineSend(t, payload)
  payload = payload or {}
  payload.t = t
  engineLink.seq = engineLink.seq + 1
  engineOutbox[#engineOutbox + 1] = { msg = { t = t, json = JSON.encode(payload) }, q = engineLink.seq }
  enginePump()
end

-- Messages from the bridge (External Editor API).
function onExternalMessage(m)
  local ok, err = pcall(engineOnMessage, m)
  if not ok then print("[MTG] table update failed (" .. tostring(type(m) == "table" and m.t or "?") .. "): " .. tostring(err)) end
end
function engineOnMessage(m)
  if type(m) ~= "table" then return end
  if type(m.json) == "string" then
    -- engineJsonDecode (tools/engine-json.lua): the same tables as JSON.decode, whose cost grows with the square of
    -- the size (25 KB froze the table ~1-2 s, 56 KB 7-19 s; tmp/json-decode/bench.md). JSON.decode stays as the fallback.
    local ok, d = pcall(engineJsonDecode, m.json)
    if not ok or type(d) ~= "table" then
      print("[MTG] fast JSON decode failed (" .. tostring(d) .. "): using JSON.decode")
      ok, d = pcall(JSON.decode, m.json)
    end
    if not ok or type(d) ~= "table" then return end
    m = d
  end
  if m.t == "chat" then
    if m.color ~= nil and Player[m.color] ~= nil and Player[m.color].seated then
      broadcastToColor(m.text, m.color, {1, 0.85, 0.4})
    else
      broadcastToAll(m.text, {1, 0.85, 0.4})
    end
  elseif m.t == "picked" then
    if enginePickById ~= nil then enginePickById(m.color, m.id) end
  elseif m.t == "deckReport" then
    if m.request == readyRequest then readyRequest = readyRequest + 1 end -- answered: cancel the "no answer" warning
    if engineDeckReport ~= nil then engineDeckReport(m) end -- the Ready buttons
  elseif m.t == "started" then engineStarted(m)
  elseif m.t == "table" then engineRender(m)
  elseif m.t == "prompt" then engineOnPrompt(m)
  elseif m.t == "clear" then engineClear()
  elseif m.t == "autostate" then engineOnAutoState(m)
  elseif m.t == "refused" then engineRefused(m)
  elseif m.t == "log" then broadcastToAll(m.text, {0.7, 0.7, 0.7})
  elseif m.t == "gamelog" then engineOnLog(m)
  elseif m.t == "texts" then engineOnTexts(m)
  end
end

-- Pie's MTG Enablers bag (cascade, tutors, Oath, Jodah, ...): items go straight back in while engine mode is on.
function onObjectLeaveContainer(container, obj)
  if ENGINE_MODE and container ~= nil and container.getGUID() == "4f3387" then
    engineBlocked("Enabler tools")
    Wait.frames(function() if obj ~= nil and not obj.isDestroyed() then container.putObject(obj) end end, 1)
  end
end
`;

// Step 3: the renderer (cards, trackers, prompt panel), kept in its own Lua file.
// The decoder for the bridge's messages (engineJsonDecode) goes first, also its own file: its backslashes would need
// doubling in a template literal.
save.LuaScript += "\n\n" + fs.readFileSync(path.join(__dirname, "engine-json.lua"), "utf8");
// (the DeckCheck tag reader and label words, for the bracket and threat label beside each commander zone: the same
// file the Card Importer gets, step 7)
save.LuaScript += "\n\n" + fs.readFileSync(path.join(__dirname, "deckcheck.lua"), "utf8");
save.LuaScript += "\n\n" + fs.readFileSync(path.join(__dirname, "engine-renderer.lua"), "utf8");

// Global: table buttons, hotkeys, typed numbers, zone context menus, rules context tools
// The table's buttons ask the engine: Draw takes a held draw, Mill held mills, Untap held untaps, Mulligan answers
// the mulligan question; at any other time they explain why not (engineTableButton in engine-renderer.lua).
guard("Draw", "function playerDraw", ["playerDraw"], { global: true, call: "engineTableButton('draw', playerColor)" });
guard("Scry", "function playerScry", ["playerScry"], { global: true, call: "engineTableButton('scry', playerColor)" });
guard("Mill", "function playerMill", ["playerMill"], { global: true, call: "engineTableButton('mill', playerColor)" });
guard("Untap", "function playerUntap", ["playerUntap"], { global: true, call: "engineTableButton('untap', playerColor)" });
guard("Mulligan", "function playerMulligan", ["playerMulligan"], { global: true, call: "engineTableButton('mulligan', playerColor)" });
guard("Reveal", "function revealFan", ["revealFan"], { global: true, call: "engineTableButton('reveal', ply)" });
guard("Reveal stack", "function revealStack", ["revealStack"], { global: true });
guard("Typed numbers on table buttons", "function onObjectNumberTyped", ["onObjectNumberTyped"], { global: true, ret: "true", silent: true });
guard("Hotkeys", "function onScriptingButtonDown", ["onScriptingButtonDown"], { global: true });
guard("Zone context menus", "function onObjectEnterZone", ["onObjectEnterZone", "onObjectLeaveZone"], { global: true, silent: true });
guard("Get basic land", "function deckRampW", ["deckRampW", "deckRampU", "deckRampR", "deckRampB", "deckRampG", ...(PROFILE.features.wastes ? ["deckRampWa"] : [])], { global: true });
if (!PROFILE.features.wastes) skip("gate Get basic land: deckRampWa", "this table has no Wastes button");
guard("Make token copy", "function cardToken", ["cardToken"], { global: true });
guard("Cascade", "function cardCascade", ["cardCascade", "deckCascade"], { global: true });
guard("Random discard", "function randomDiscard", ["randomDiscard"], { global: true });
guard("Reveal until type", "function deckSeachType", ["deckSeachType"], { global: true });

// Trackers: life, commander damage, commander tax, energy/poison/experience, mana/suspend/card counters
// clicking the counter itself (its big button, `option`) picks that player when you're choosing what to attack or target
// M5 step 2: the engine's life changes on the counter's own change line ("-3" red / "+2" green for 3 s), then that
// line back as it was (Global.setLife; obj.call passes one table, sL takes two values). The line is a 0-size button,
// and TTS doesn't draw a 0-size button's text (checked live 2026-10-22): it gets a size and a dark backing while it
// shows, and goes back to 0 afterwards so it never sits over the counter catching clicks.
patchScripts("Life counter: engineLifeChange", "function sL(l,n)\n",
  `function engineLifeChange(p) sL(p.life, p.delta) self.editButton({ index = 1, width = 760, height = 440, font_size = 420, color = { 0, 0, 0, 0.75 }, font_color = (p.delta or 0) < 0 and { 1, 0.3, 0.25 } or { 0.35, 1, 0.45 } }) if engineLifeColour ~= nil then Wait.stop(engineLifeColour) end engineLifeColour = Wait.time(function() engineLifeColour = nil self.editButton({ index = 1, label = '', width = 0, height = 0, font_size = 400, color = back, font_color = font1 }) end, 3.1) end ${TAG}\nfunction sL(l,n)\n`, SEATS.length);
// The hand counters count the hand's objects every second, and caught cards the table was re-laying out ("1 card" with
// eight in hand while a question was open, hp-07 2026-10-27): in an engine game they show the engine's count.
patchScripts("Hand counter: the engine's count", "local ncards = #player.getHandObjects()",
  `local ncards = Global.call('engineHandCount', { color = colStr }) or #player.getHandObjects() ${TAG}`, 2 * SEATS.length);
guard("Life counter click", "function resetLife", ["option"], { call: "Global.call('engineLifeTrackerClick', { guid = self.getGUID(), color = c })", fixOpen: true });
guard("Life counter", "function resetLife", ["click_changeValue", "resetLife", "onNumberTyped"], { fixOpen: true });
guard("Life chat commands", "function resetLife", ["onChat"], { silent: true });
// CardCustom (a player's secret number) is not engine state, so it is left alone.
// ("noencode=true" appears only in CardCustom among the counter scripts.)
guard("Counters", "function add_subtract", ["add_subtract"], { min: 5, exclude: "noencode=true", fixOpen: true });
guard("Counters", "function add_subtract", ["reset_val", "onNumberTyped"], { min: 5, exclude: "noencode=true", fixOpen: true });
guard("Counter chat reset", "function add_subtract", ["onChat"], { silent: true, min: 2 });

// Turns
guard("Turn skipper", "function assignColor", ["onPlayerTurn", "onDrop"], { silent: true });
patchScripts("Pirate cannon: who-goes-first die no longer sets the turn",
  "if thisObj.getName()=='goes first!' then",
  `if thisObj.getName()=='goes first!' and not Global.getVar('ENGINE_MODE') then ${TAG} the engine picks the first player`);

// Card overlays (Easy Modules, keywords, token, phasing, face-down, menu flip)
guard("Card buttons (P/T, counters, control, face, copies)", "_MTG_Simplified_UNIFIED", [
  "ReceiveChangeActiveFace", "ReceiveReimportOrChangeActiveFace", "ReceiveGemClick", "ReceiveOwnershipClick", "ReceiveControllerClick",
  "ReceiveCounterClick", "ReceiveTenCounterClick", "ReceivePlaneswalkerClickSlot1", "ReceivePlaneswalkerClickSlot2",
  "ReceivePlaneswalkerClickSlot3", "ReceivePlaneswalkerClickSlot4", "ReceivePowerClick", "ReceiveToughnessClick",
  "ReceiveToughnessZeroClick", "ReceivePowTouClick", "ReceivePlusOneClick", "ReceiveTenPlusOneClick",
  "MakeExactCopy", "ReImport", "EmblemsAndTokens"]);
guard("Keyword counters", "function toggleKeywordsMenu", ["toggleStatus"]);
guard("Token marker", "function toggleToken", ["toggleToken"]);
guard("Phasing", "function unPhased", ["phaseOut", "unPhased"]);
guard("Face-down", "function genericFlipUp", ["toggleFaceDown", "changeMode", "contextMorph", "contextDisguise", "contextGenericFlipUp"]);
guard("Face-down context menus", "function genericFlipUp", ["onObjectEnterZone", "onObjectLeaveZone"], { silent: true });
guard("Flip from card menu", "function piFlipMenu", ["piFlipMenu"]);

// Card importer: import decks before turning engine mode on
guard("Card importer (import decks before turning engine mode on)", "function parseImporterChatArgs", ["onChat", "ENC", "eRespawn"]);

// Day/Night, the Ring
guard("Day/Night", "function switchState", ["switchState"], { min: 2 });
guard("Day/Night card transforms", "function switchState", ["onStateChange"], { silent: true, min: 2 });
guard("The Ring", "function upDown", ["press1", "press2", "press3", "press4", "upDown"]);

// Deck tools (they live in the enabler bag, but guard them anyway)
guard("Deck search tools", "function changeDeckDir", ["onCollisionEnter"], { min: 4 });
guard("Get deck data", "function fixDeckText", ["onCollisionEnter"]);

// Treachery (honour-system layer): identity token buttons would create cards the engine doesn't know about
if (PROFILE.features.treachery) {
  guard("Treachery identity token buttons", "function getToken", ["getToken", "getToken1", "getToken2"], { min: 10 });
  guard("Treachery identity token buttons", "function green(obj,ply)", ["red"]);
} else skip("gate Treachery identity token buttons (x2)", "this table has no Treachery cards");

// Dungeons (wired to the engine later): room clicks may stay as a manual marker, but no token spawning
guard("Dungeon tokens", "function spawnTokens", ["spawnTokens"], { silent: true, min: 5 });

// No save Note: TTS shows it on screen over the table.

// Hand counters relabel themselves every second even when the count is the same (two a seat: 8 UI rebuilds a second
// all game on four seats). Only relabel when the number changes.
{
  let n = 0;
  for (const o of allObjects(save.ObjectStates)) {
    const L = o.LuaScript || '';
    if (!L.includes('Wait.time(updateCardCount,1,999999)')) continue;
    const before = L;
    o.LuaScript = L.replace('  for ind=0,nButs do', '  if lab == lastLab then return end ' + TAG + ' unchanged count: no relabel\n  lastLab = lab\n  for ind=0,nButs do');
    if (o.LuaScript !== before) n++;
  }
  report.push((n === 2 * SEATS.length ? 'OK  ' : 'FAIL') + ' hand counters relabel only on change (' + n + ')');
  if (n !== 2 * SEATS.length) process.exitCode = 1;
}


// Manual-play clutter the engine replaces (the user's red boxes, 2026-10-18): the counter / dice / keyword /
// commander-damage / dungeon / turn-order columns on both long sides, plus Treachery and Planechase next to White.
// Only objects on the table surface (y > -1): the Encoder modules stored under the table stay.
// Also the profile's remove list, wherever they lie (tools/table-profile.js says why each): Encoder modules, the 2nd
// importer, the Bruh Button, the turn timers, the 3D bundles under the table and the Drafting tools / Enablers bags (the
// Pirate Cannon and the first-player die stay: hidden in engine mode, 2026-10-21). The profile's clutter boxes: on the
// 4-player table beside Yellow/Red and beside White/Blue; on the 6-player table its two end columns, which also take
// the two Drop-On-Card Counter bags, whose tokens put an ungated onNumberTyped onto a card (M6 step 13).
const REMOVE = new Set(PROFILE.remove);
const CLUTTER_BOXES = PROFILE.clutterBoxes;
// Status pieces (docs/status-objects-spec.md, 2026-11-11): the clutter's pieces for a player status come back, parked
// under the table, and the table puts one on a player's mat while their marks say it (engineStatusPieces in
// engine-renderer.lua). `mark`: the bridge's PLAYER_MARKS label it shows, alone or followed by a count ("POISON 3");
// `perSeat`: more than one player can have it at once, so each seat has its own copy (White keeps the original, the
// others are copies under new GUIDs); `fade`: a model or token, made see-through with its tint's alpha (a card's alpha
// doesn't do that: every piece is also invisible to every colour while parked); `count`: the count is drawn on it.
// Their scripts go (spec "Scripts", first option): Day // Night's, The Ring's and Undercity's buttons would change what
// the engine owns, and the counters' only draw a 0 the table now draws itself.
const STATUS_SEATS = SEATS;
const STATUS_PIECES = [
  { mark: "MONARCH", guid: "8963ec", fade: true },          // the crown
  { mark: "MONARCH", guid: "197ab6" },                      // The Monarch card, under it
  { mark: "INITIATIVE", guid: "2db63a" },                   // Undercity
  { mark: "CITY'S BLESSING", guid: "cb418b", perSeat: true },
  { mark: "RING TEMPTED", guid: "d9fcbc", perSeat: true },  // The Ring
  { mark: "POISON", guid: "94b67a", perSeat: true, fade: true, count: true },
  { mark: "ENERGY", guid: "da1b48", perSeat: true, fade: true, count: true },
  { mark: "EXPERIENCE", guid: "576ccd", perSeat: true, fade: true, count: true },
];
const DAY_NIGHT = "4e8c7b"; // Day, its second state Night: table-wide, in the middle of the table
const STATUS_PARK_Y = -30;  // under the table top, as the Pirate Cannon in engine mode
const STATUS_KEEP = new Set([...STATUS_PIECES.map((p) => p.guid), DAY_NIGHT]);
// Mana counters (2026-11-24, the user: "use these objects from the og table to rep floating mana"): the counter in each
// of the original's six mana-counter bags at the -x end (an infinite bag; the counter is its one contained object),
// one copy per seat per colour, parked under the table like the status pieces; the table puts them on the life counter
// where the floating-mana chips were (engineManaCounters in engine-renderer.lua). The bags themselves go with the
// clutter. Both tables have these six bags under the same GUIDs (checked 2026-11-24 on 2296042369 and 2293586471).
// The gold hourglass beside them is the Suspend counter, not mana: left out.
const MANA_BAGS = { W: "389c4d", U: "7ae211", B: "887dd2", R: "b991d5", G: "daebb2", C: "52e44b" };
const MANA_SOURCE = Object.fromEntries(Object.entries(MANA_BAGS).map(([k, g]) => [k, save.ObjectStates.find((o) => o.GUID === g)]));
{
  const removed = [];
  save.ObjectStates = save.ObjectStates.filter((o) => {
    if (STATUS_KEEP.has(o.GUID)) return true; // (kept, parked below)
    const t = o.Transform || {};
    // also: both "Drafting tools" bags and the "Pie's MTG Enablers" bag (user request, 2026-10-18)
    // also: modules and extras that make Unity's clean-up pauses longer and that nothing in engine mode uses
    // (2026-10-18, research report "TTS stutter unload pause reduction"; the Encoder, πScry, πMenu and "Is it a token?"
    // stay because the table's own script calls them directly)
    const hit = REMOVE.has(o.GUID) || t.posY > -1 && CLUTTER_BOXES.some((b) => t.posX >= b.x[0] && t.posX <= b.x[1] && t.posZ >= b.z[0] && t.posZ <= b.z[1]);
    if (hit) removed.push(`${(o.Nickname || o.Name || "").replace(/\[\/?[a-z]+\]/gi, "").split("\n")[0]} (${o.GUID})`);
    return !hit;
  });
  report.push(`${removed.length ? "OK  " : "FAIL"} side clutter removed (${removed.length}): ${removed.join(", ")}`);
  if (!removed.length) process.exitCode = 1;
}
// The status pieces, parked: at their own spot under the table, locked, faded, without scripts; a seat's copy under a
// GUID made from the original's and the seat's (the same in every build, so a save that already has it isn't given a
// second one), checked against every GUID in the table. The Global script gets the list it moves them by.
{
  // (the original's GUIDs too, the clutter's included: none of them is given out again)
  const used = new Set([...allObjects(save.ObjectStates), ...allObjects(JSON.parse(fs.readFileSync(SRC, "utf8")).ObjectStates)].map((o) => o.GUID));
  const byGuid = new Map(save.ObjectStates.map((o) => [o.GUID, o]));
  const kept = [], problems = [];
  const r2 = (n) => Math.round(Number(n) * 1000) / 1000;
  const park = (o) => {
    for (const s of [o, ...Object.values(o.States || {})]) {
      s.Transform = { ...s.Transform, posY: STATUS_PARK_Y };
      s.Locked = true;
      s.LuaScript = ""; s.LuaScriptState = ""; s.XmlUI = "";
    }
  };
  const fade = (o) => { o.ColorDiffuse = { ...(o.ColorDiffuse || { r: 1, g: 1, b: 1 }), a: 0 }; };
  const copyGuid = (guid, seat) => {
    for (let salt = 0; salt < 50; salt++) {
      const g = require("crypto").createHash("sha1").update(`${guid}:${seat}${salt ? `:${salt}` : ""}`).digest("hex").slice(0, 6);
      if (!used.has(g)) { used.add(g); return g; }
    }
    throw new Error(`no free GUID for ${guid} ${seat}`);
  };
  const lua = [];
  for (const p of STATUS_PIECES) {
    const o = byGuid.get(p.guid);
    if (!o) { problems.push(`${p.mark} piece ${p.guid} not in the table`); continue; }
    const t = o.Transform;
    const objs = [];
    (p.perSeat ? STATUS_SEATS : [null]).forEach((seat, i) => {
      let x = o;
      if (i > 0) {
        x = JSON.parse(JSON.stringify(o));
        x.GUID = copyGuid(o.GUID, seat);
        x.Transform = { ...x.Transform, posZ: t.posZ + i * 1.2 }; // (beside the original, under the table)
        save.ObjectStates.push(x);
      }
      park(x);
      if (p.fade) fade(x);
      objs.push(`{ g = ${JSON.stringify(x.GUID)}, x = ${r2(x.Transform.posX)}, z = ${r2(x.Transform.posZ)}${seat ? `, seat = "${seat}"` : ""} }`);
      kept.push(`${String(o.Nickname || o.Name).replace(/\[\/?[a-z]+\]/gi, "").split("\n")[0]}${seat ? ` ${seat}` : ""} (${x.GUID})`);
    });
    lua.push(`  { mark = ${JSON.stringify(p.mark)}, y = ${r2(t.posY)}, scale = { ${r2(t.scaleX)}, ${r2(t.scaleY)}, ${r2(t.scaleZ)} }${p.fade ? ", fade = true" : ""}${p.count ? ", count = true" : ""},\n    objs = { ${objs.join(", ")} } },`);
  }
  const day = byGuid.get(DAY_NIGHT);
  const night = day && Object.values(day.States || {})[0];
  let dayLua = "";
  if (!day || !night || Object.keys(day.States).join() !== "2") problems.push(`Day // Night ${DAY_NIGHT} with its Night state 2 not in the table`);
  else {
    const t = day.Transform;
    park(day);
    kept.push(`Day // Night (${day.GUID}, Night ${night.GUID})`);
    dayLua = `ENGINE_DAY_NIGHT = { states = { ${JSON.stringify(day.GUID)}, ${JSON.stringify(night.GUID)} }, y = ${r2(t.posY)}, scale = { ${r2(t.scaleX)}, ${r2(t.scaleY)}, ${r2(t.scaleZ)} }, x = ${r2(t.posX)}, z = ${r2(t.posZ)} }\n`;
  }
  save.LuaScript += `\n\n${TAG} status pieces (docs/status-objects-spec.md): which object shows which mark, per seat, and where it\n-- parks; written by make-engine-copy from the objects it kept (engineStatusPieces in engine-renderer.lua moves them)\nENGINE_STATUS_PIECES = {\n${lua.join("\n")}\n}\n${dayLua}`;
  report.push(`${problems.length ? "FAIL" : "OK  "} status pieces kept, parked under the table (${kept.length}): ${problems.length ? problems.join("; ") : kept.join(", ")}`);
  if (problems.length) process.exitCode = 1;

  // The mana counters: every seat's copy under a new GUID (the counter's own is inside the +x bag of the source too),
  // parked as the status pieces are, faded, flat (turned 0), out of the drag-select box, a seat's six in a row along
  // x from its bag's spot under the table. Their script goes: its click and typed numbers would change a value the
  // engine owns.
  const manaLua = [], manaKept = [], manaProblems = [];
  for (const [k, bag] of Object.entries(MANA_SOURCE)) {
    const src = bag && (bag.ContainedObjects || [])[0];
    if (!src || !/Mana Counter$/.test(String(src.Nickname))) { manaProblems.push(`${k} mana counter bag ${MANA_BAGS[k]} not in the table`); continue; }
    const objs = [];
    STATUS_SEATS.forEach((seat, i) => {
      const x = JSON.parse(JSON.stringify(src));
      x.GUID = copyGuid(src.GUID, seat);
      x.Transform = { ...x.Transform, posX: bag.Transform.posX + i * 1.5, posZ: bag.Transform.posZ, rotX: 0, rotY: 0, rotZ: 0 };
      x.DragSelectable = false;
      park(x);
      fade(x);
      save.ObjectStates.push(x);
      objs.push(`{ g = ${JSON.stringify(x.GUID)}, x = ${r2(x.Transform.posX)}, z = ${r2(x.Transform.posZ)}, seat = "${seat}" }`);
      manaKept.push(`${k} ${seat} (${x.GUID})`);
    });
    manaLua.push(`  ${k} = { scale = ${r2(src.Transform.scaleX)}, y = ${STATUS_PARK_Y},\n    objs = { ${objs.join(", ")} } },`);
  }
  save.LuaScript += `\n${TAG} mana counters (2026-11-24): each colour's counter from the original table, one per seat, and where it\n-- parks (y); written by make-engine-copy (engineManaCounters in engine-renderer.lua moves them)\nENGINE_MANA_PIECES = {\n${manaLua.join("\n")}\n}\n`;
  report.push(`${manaProblems.length ? "FAIL" : "OK  "} mana counters kept, parked under the table (${manaKept.length}): ${manaProblems.length ? manaProblems.join("; ") : manaKept.join(", ")}`);
  if (manaProblems.length) process.exitCode = 1;
}

// Leftover check: nothing that downloads-and-runs code should remain reachable.
const leftovers = [];
for (const o of [save, ...allObjects(save.ObjectStates)]) {
  const s = o.LuaScript || "";
  if (/steam_id\s*==\s*'76561197968157267'/.test(s)) leftovers.push(`${o.Nickname || o.GUID || "Global"}: Steam ID check`);
}
report.push(leftovers.length ? `FAIL leftovers: ${leftovers.join("; ")}` : "OK   no hard-coded Steam ID checks left");
if (leftovers.length) process.exitCode = 1;

console.log(report.join("\n"));
if (process.exitCode) { console.log("\nNot written: a patch did not apply."); process.exit(1); }
fs.writeFileSync(DEST, JSON.stringify(save, null, 2));
const png = SRC.replace(/\.json$/, ".png");
if (fs.existsSync(png)) fs.copyFileSync(png, DEST.replace(/\.json$/, ".png"));
console.log(`\nWrote ${DEST}`);
