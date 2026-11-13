// Builds the "engine mode" copy of the group's table with the security issues removed
// (table-review/COMPATIBILITY.md, "Must-fix before connecting the bridge").
// The original workshop file is only read, never written.
//   node make-engine-copy.js [source.json] [dest.json]
const fs = require("fs");
const path = require("path");

const TTS = path.join(process.env.USERPROFILE, "Documents", "My Games", "Tabletop Simulator");
const SRC = process.argv[2] || path.join(TTS, "Mods", "Workshop", "2296042369.json");
const DEST = process.argv[3] || path.join(TTS, "Saves", "MTG 4 player table - ENGINE MODE.json");
const TAG = "-- [engine copy]";

const save = JSON.parse(fs.readFileSync(SRC, "utf8"));
const report = [];

// Every object, including ones inside bags and alternate states.
function* allObjects(list) {
  for (const o of list || []) {
    yield o;
    yield* allObjects(o.ContainedObjects);
    yield* allObjects(Object.values(o.States || {}));
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
  `      spawnObjectJSON({ json = engineCopyStripScripts(obj) }) ${TAG} scripts from the server are removed`);
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

save.SaveName = "MTG 4 player table - ENGINE MODE";
// background: Ariande's Hideaway skybox (assets/ariande-skybox-4096.jpg), uploaded to Steam Cloud so every player
// sees it (a file:// picture would show only on the host's PC)
save.SkyURL = "https://steamusercontent-a.akamaihd.net/ugc/18285858995376011531/FC6BD5C748CC76B4AE3958D3AD6FCCE2BEFB4892/";
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
    for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do
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
  engineSend("start", { stamp = engineStamp(), seats = seats, bots = bots, requireReady = true, aiSeats = aiSeats, autoReset = true, friendly = engineFriendly })
end

-- All "mtg ..." chat commands. Returns false (hide the line) when handled, nil otherwise.
function engineChat(message, pl)
  local lower = string.lower(message)
  if not lower:match("^%s*mtg%f[%A]") then return nil end
  -- (a position capture and a trim, not "(.-)%s*$": that lazy match raised "pattern too complex" in TTS once the
  -- text passed ~55 characters, tmp/pattern-trap/audit.md)
  local cmd, restAt = lower:match("^%s*mtg%s*(%a*)%s*()")
  local rest = (lower:sub(restAt):gsub("%s+$", ""))
  local isHost = pl.host or pl.admin or pl.promoted
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
  elseif cmd == "start" then
    engineStartGame(pl, rest)
  elseif cmd == "undo" then
    -- rewind by vote: "mtg undo" lists the restore points, "mtg undo 3" asks to go back to the third
    local pts = (engineRewind and engineRewind.points) or {}
    local k = tonumber(rest:match("^(%d+)") or "")
    if #pts == 0 then pl.broadcast("[MTG] No restore points yet (they come with a running engine game).")
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
    -- the table's particle effects (docs/particle-fx-spec.md): shared, so the host's switch; saved with the game
    if rest == "on" or rest == "low" or rest == "off" then
      if not isHost then pl.broadcast("[MTG] Only the host can change the table's particle effects (everyone sees them).")
      else engineSetFxMode(rest, pl.steam_name) end
    else pl.broadcast("[MTG] Table particle effects: " .. tostring(engineFxMode) .. ". Type  mtg fx on ,  mtg fx low  (a wipe's wave without each card's own effect, no bolts) or  mtg fx off  (host).", {1, 0.85, 0.4}) end
  elseif cmd == "concede" then
    -- out for good, so it asks once more: "mtg concede" twice within 15 seconds
    engineConcedeAsk = engineConcedeAsk or {}
    local at = engineConcedeAsk[pl.color]
    if at ~= nil and os.clock() - at < 15 then
      engineConcedeAsk[pl.color] = nil
      engineSend("concede", { color = pl.color })
    else
      engineConcedeAsk[pl.color] = os.clock()
      pl.broadcast("[MTG] Concede the game? You are out for good. Type  mtg concede  again within 15 seconds to confirm.", {1, 0.6, 0.3})
    end
  elseif cmd == "winner" then
    -- Treachery: the roles decide who wins; the host names the winner and everyone else at the table concedes
    if not isHost then pl.broadcast("[MTG] Only the host can declare the winner.") return false end
    local who = nil
    for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do if c:lower() == rest then who = c end end
    if who == nil then pl.broadcast("[MTG] Use:  mtg winner white|red|yellow|blue") return false end
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
  elseif cmd == "planechase" or cmd == "planes" then
    -- Planechase for the next games (host): mtg planechase on|off; mtg planes random [N] / mtg planes <name>; <name>
    -- (the bridge checks the names against Forge's planes, docs/planechase-dungeon-engine-spec.md P1)
    if not isHost then pl.broadcast("[MTG] Only the host can set up Planechase.") return false end
    if cmd == "planechase" then engineSend("planechase", { color = pl.color, on = rest ~= "off" })
    else engineSend("planes", { color = pl.color, text = rest }) end
  elseif cmd == "art" then
    -- the players' own card pictures (a deck line "1 Sol Ring #https://..."), on or off for everyone (host):
    -- mtg art off / mtg art on (the bridge's customArt, docs/custom-art-spec.md)
    if not isHost then pl.broadcast("[MTG] Only the host can switch custom card art (everyone sees the same pictures).") return false end
    if rest == "on" or rest == "off" then engineSend("art", { color = pl.color, on = rest == "on" })
    else pl.broadcast("[MTG] Use:  mtg art off  (everyone sees the normal card pictures) or  mtg art on  (the pictures players linked in their deck lists)") end
  elseif cmd == "vote" then
    if rest == "yes" or rest == "no" then engineSend("rewindVote", { color = pl.color, accept = rest == "yes" })
    else pl.broadcast("[MTG] Use:  mtg vote yes  or  mtg vote no") end
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
    pl.broadcast("[MTG] Commands:\\n mtg ready / mtg ready all (host) - check decks\\n mtg commander - hover your commander first\\n mtg start [ai N] - start the engine game, optionally with N Forge AI players\\n mtg ai <colour> harmless|forge [deck] / mtg ai <colour> off (host) - who plays an empty seat, every game\\n mtg friendly 0|1|2 - free mulligans each, for everyone (the rules' free one included)\\n mtg reset - put the imported decks back once the game is over (host: also mid-game)\\n mtg undo [N] - rewind (the others vote); mtg vote yes/no\\n mtg fix - pause the game to put the board right (the others vote); mtg fix yes/no/done/cancel; mtg fix token <what> [for <colour>]; mtg fix note <text> - what should have happened, for the log; mtg mana <n> - n mana of each colour until the end of the turn (a fix in one line)\\n mtg debug <scenario> - a test board (20 lands out, the scenario's cards in hand); mtg debug list / off\\n mtg planechase on|off (host) - Planechase in the next games; mtg planes random [N] / mtg planes <name>; <name> - the planar decks\\n mtg art off|on (host) - the players' own card pictures (1 Sol Ring #https://... in the deck list) or the normal ones, for everyone\\n mtg skip <upkeep|draw|main|combat|blockers|damage|main2|end|mine|off> - pass priority until that phase (an opponent's spell stops it)\\n mtg hold - keep priority once after something goes on the stack, to respond to your own spell (also the Hold button)\\n mtg timer [seconds] / mtg timer off (host) - turn timers for everyone\\n mtg concede - leave the game; mtg winner <colour> (host, Treachery)\\n mtg engine on/off\\n mtg effects on/off - your own; mtg sounds on/off (host: shared), mtg sounds test <knockout|wipe|bighit|death|exile|countered|playerhit|damage|lifegain|treasure|treasurespend|sorcery|instant|counter> [N] (N at once); mtg animations on/off (host) - also under Settings\\n mtg fx on/low/off (host) - the table's particle effects")
  end
  return false
end

-- ───── Step 2: "mtg ready" — read imported decks so the bridge can check them against the engine ─────
local COMMAND_ZONES = { White = {"908f60", "ce8ea5"}, Red = {"9d380e", "16aed3"}, Yellow = {"baffa9", "dc9c6d"}, Blue = {"0c0c5e", "3b2d18"} }
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
  return { n = cardName(d.Nickname), f = face, b = back }
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
    seats[color] = entry
  end
  readyRequest = readyRequest + 1
  local mine = readyRequest
  engineSend("decks", { seats = seats, request = mine })
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
local engineOutbox, engineSending = {}, false
local function enginePump()
  if engineSending or #engineOutbox == 0 then return end -- (TTS's Lua errors on table.remove of an empty list)
  local msg = table.remove(engineOutbox, 1)
  engineSending = true
  local done = false
  local function sent(failed)
    if done then return end -- (the answer and the watchdog can both arrive)
    done = true
    if failed then sendExternalMessage(msg) end
    engineSending = false
    enginePump()
  end
  -- a request that never answers (bridge stuck) would hold every later message: after 5 s send it the old way
  Wait.time(function() sent(true) end, 5)
  local ok = pcall(function()
    WebRequest.custom(ENGINE_BRIDGE_URL, "POST", true, JSON.encode(msg), { ["Content-Type"] = "application/json" }, function(req)
      sent(req.is_error)
    end)
  end)
  if not ok then sent(true) end
end
function engineSend(t, payload)
  payload = payload or {}
  payload.t = t
  engineOutbox[#engineOutbox + 1] = { t = t, json = JSON.encode(payload) }
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
guard("Get basic land", "function deckRampW", ["deckRampW", "deckRampU", "deckRampR", "deckRampB", "deckRampG", "deckRampWa"], { global: true });
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
  `function engineLifeChange(p) sL(p.life, p.delta) self.editButton({ index = 1, width = 760, height = 440, font_size = 420, color = { 0, 0, 0, 0.75 }, font_color = (p.delta or 0) < 0 and { 1, 0.3, 0.25 } or { 0.35, 1, 0.45 } }) if engineLifeColour ~= nil then Wait.stop(engineLifeColour) end engineLifeColour = Wait.time(function() engineLifeColour = nil self.editButton({ index = 1, label = '', width = 0, height = 0, font_size = 400, color = back, font_color = font1 }) end, 3.1) end ${TAG}\nfunction sL(l,n)\n`, 4);
// The hand counters count the hand's objects every second, and caught cards the table was re-laying out ("1 card" with
// eight in hand while a question was open, hp-07 2026-10-27): in an engine game they show the engine's count.
patchScripts("Hand counter: the engine's count", "local ncards = #player.getHandObjects()",
  `local ncards = Global.call('engineHandCount', { color = colStr }) or #player.getHandObjects() ${TAG}`, 8);
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
guard("Treachery identity token buttons", "function getToken", ["getToken", "getToken1", "getToken2"], { min: 10 });
guard("Treachery identity token buttons", "function green(obj,ply)", ["red"]);

// Dungeons (wired to the engine later): room clicks may stay as a manual marker, but no token spawning
guard("Dungeon tokens", "function spawnTokens", ["spawnTokens"], { silent: true, min: 5 });

// No save Note: TTS shows it on screen over the table.

// Hand counters relabel themselves every second even when the count is the same (8 counters = 8 UI rebuilds a
// second all game). Only relabel when the number changes.
{
  let n = 0;
  for (const o of allObjects(save.ObjectStates)) {
    const L = o.LuaScript || '';
    if (!L.includes('Wait.time(updateCardCount,1,999999)')) continue;
    const before = L;
    o.LuaScript = L.replace('  for ind=0,nButs do', '  if lab == lastLab then return end ' + TAG + ' unchanged count: no relabel\n  lastLab = lab\n  for ind=0,nButs do');
    if (o.LuaScript !== before) n++;
  }
  report.push((n === 8 ? 'OK  ' : 'FAIL') + ' hand counters relabel only on change (' + n + ')');
  if (n !== 8) process.exitCode = 1;
}


// Manual-play clutter the engine replaces (the user's red boxes, 2026-10-18): the counter / dice / keyword /
// commander-damage / dungeon / turn-order columns on both long sides, plus Treachery and Planechase next to White.
// Only objects on the table surface (y > -1): the Encoder modules stored under the table stay.
const SLIM = [
  "b93b40", "ae12d3", "ad044a", "7a0067", "cd83de", "c5ea55", "b8b8df", "def0af", "c2df33", // Encoder modules
  "222541", "5a7db4",                                                         // 2nd importer, Bruh Button (the Pirate Cannon and the
                                                                               // first-player die stay: hidden in engine mode, 2026-10-21)
  "809133", "29f427", "57b8f3", "9df6a3",                                      // turn timers
  "eb479b", "a3e6a8", "a7a029", "4c02f8", "9c553c", "cb1610",                   // unnamed 3D bundles under the table
];
const CLUTTER_BOXES = [
  { x: [-56, -44], z: [-8.5, 32] }, // beside Yellow/Red
  { x: [44, 56], z: [-26, 8.5] },   // beside White/Blue
];
// Status pieces (docs/status-objects-spec.md, 2026-11-11): the clutter's pieces for a player status come back, parked
// under the table, and the table puts one on a player's mat while their marks say it (engineStatusPieces in
// engine-renderer.lua). `mark`: the bridge's PLAYER_MARKS label it shows, alone or followed by a count ("POISON 3");
// `perSeat`: more than one player can have it at once, so each seat has its own copy (White keeps the original, the
// others are copies under new GUIDs); `fade`: a model or token, made see-through with its tint's alpha (a card's alpha
// doesn't do that: every piece is also invisible to every colour while parked); `count`: the count is drawn on it.
// Their scripts go (spec "Scripts", first option): Day // Night's, The Ring's and Undercity's buttons would change what
// the engine owns, and the counters' only draw a 0 the table now draws itself.
const STATUS_SEATS = ["White", "Red", "Yellow", "Blue"];
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
{
  const removed = [];
  save.ObjectStates = save.ObjectStates.filter((o) => {
    if (STATUS_KEEP.has(o.GUID)) return true; // (kept, parked below)
    const t = o.Transform || {};
    // also: both "Drafting tools" bags and the "Pie's MTG Enablers" bag (user request, 2026-10-18)
    // also: modules and extras that make Unity's clean-up pauses longer and that nothing in engine mode uses
    // (2026-10-18, research report "TTS stutter unload pause reduction"; the Encoder, πScry, πMenu and "Is it a token?"
    // stay because the table's own script calls them directly)
    const hit = ["5c8648", "098c38", "2d3496", ...SLIM].includes(o.GUID) || t.posY > -1 && CLUTTER_BOXES.some((b) => t.posX >= b.x[0] && t.posX <= b.x[1] && t.posZ >= b.z[0] && t.posZ <= b.z[1]);
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
