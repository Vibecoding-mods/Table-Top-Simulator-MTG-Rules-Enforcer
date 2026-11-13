-- [engine copy] ===================== ENGINE RENDERER (PLAN M4 step 3) =====================
-- Draws the rules engine's game on this table: cards in each player's zones (same card format as the
-- Card Importer), life / commander damage / commander tax trackers, the active turn, and a prompt panel.
-- Everything here only runs after "mtg start"; the table is untouched until then.

local ENGINE_BACK = "https://steamusercontent-a.akamaihd.net/ugc/1647720103762682461/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/"
local LIFE_TRACKERS = { White = "23e485", Red = "448880", Yellow = "37e533", Blue = "395037" }
-- Commander damage trackers sit on the victim's side, one per attacking colour.
local CMD_DAMAGE = {
  White  = { Blue = "b748df", Yellow = "0f6598", Red = "6b6e1f" },
  Blue   = { White = "bfcf4a", Red = "8d172a", Yellow = "f43e61" },
  Yellow = { Red = "906d4b", White = "484c38", Blue = "45331a" },
  Red    = { Yellow = "d5907a", Blue = "95eb63", White = "4bfa09" },
}
local TAX_LABELS = { White = {"908f60", "ce8ea5"}, Red = {"9d380e", "16aed3"}, Yellow = {"baffa9", "dc9c6d"}, Blue = {"0c0c5e", "3b2d18"} }

-- Battlefield grid on each playmat (same spacing as the table's own tools): 10 cards per row, row 0 is the
-- edge nearest the table centre, row 4 the edge nearest the player.
local SURFACE_Y = 1.15 -- table top; cards are placed at this height, not at the height of the zone objects
local function onTable(v, lift) return Vector(v.x, SURFACE_Y + (lift or 0), v.z) end

local GRID = { colStep = 2.4, colStart = 10.75, rowStep = 3.2, rowStart = -8, perRow = 10 }
-- (lands: the centre of the mat's lower box, the mana zone, measured on the real table 2026-11-10: the box runs from
-- 3.46 past the mat's centre to its near edge at 10.375, so a card's 3.06 fits with room; row 3 lay above it)
local ROWS = { creature = 0, other = 2, land = 4.7 }

local engineObjs = {}     -- engine card id -> object
local engineSpawning = {} -- engine card id -> true while its object is being spawned
local enginePlanned = {}  -- engine card id -> planned position (for attachments)
local engineInHand = {}   -- engine card id -> true while the card sits in a player's hand
local engineFace = {}     -- engine card id -> face and back image URLs the object was spawned with (engineFaceKey)
local engineMeta = {}     -- engine card id -> { zone = "hand"|"battlefield"|"command"|..., color = owner/controller colour }
local engineManual = {}   -- engine card id -> position the player arranged it at on their battlefield
engineManualPlay = {} -- engine card id -> true while engineManual only holds a card being cast where it was dropped
local engineHeld = {}     -- engine card id -> os.clock() while a dragged card waits for the engine's answer
local lastTurnSet = nil
local stashed = {}        -- imported deck objects moved aside while the engine plays: guid -> {pos, rot, lock}
local lastTable = nil
local renderQueued = false
local engineColors = {}   -- colour -> true for every colour the engine is playing (humans and AI)

-- ───────── geometry ─────────
local function seatGeometry(color)
  local d = data[color]
  if d == nil or d.playmat == nil or d.libraryZone == nil then return nil end
  local lib = d.libraryZone
  local g = {
    mat = d.playmat.getPosition(), right = d.playmat.getTransformRight(), fwd = d.playmat.getTransformForward(),
    lib = lib.getPosition(), libFwd = lib.getTransformForward(),
    grave = d.graveyard and d.graveyard.getPosition() or lib.getPosition(),
  }
  local hand = Player[color].getHandTransform()
  g.rotY = (hand and hand.rotation.y or d.playmat.getRotation().y) + 180 -- readable for that player
  g.handPos = hand and hand.position or nil
  return g
end

local function gridPos(g, col, row)
  return onTable(g.mat + g.right * (col * -GRID.colStep + GRID.colStart) + g.fwd * (row * GRID.rowStep + GRID.rowStart), 0)
end

-- ───────── card objects ─────────
local function nickname(c)
  if c.n == nil then return "Face-down card" end
  -- (a two-faced card names both its faces, the one it shows first: docs/card-other-side-spec.md)
  return c.n .. (c.n2 and (" // " .. c.n2) or "") .. "\n" .. (c.tl or "") .. "\n" .. tostring(c.cmc or 0) .. "CMC"
end

COMES_BACK = "Comes back when the card that exiled it leaves."
local function description(c)
  -- (its text as changed by Mind Bend, Exchange of Words, Deadpool, Volrath's Shapeshifter: the changed text, and the
  -- printed card under its new name, hp-25 2026-10-27)
  local s = c.ct and ("[b]Text changed:[/b]\n" .. c.ct) or (c.tx or "")
  if c.pn then s = "[b]" .. c.pn .. "[/b], as " .. tostring(c.n) .. "\n" .. s end
  if c.p ~= nil and c.t ~= nil then s = s .. "\n[b]" .. tostring(c.p) .. "/" .. tostring(c.t) .. "[/b]" end
  if c.ew and c.rl then s = s .. "\n[i]" .. COMES_BACK .. "[/i]" end
  -- (what it can still do from a graveyard or exile, and its counters there: flashback, madness, warp, plot, suspend's
  -- time counters, from the bridge's cardNotes)
  for _, line in ipairs(c.nt or {}) do s = s .. (s == "" and "" or "\n") .. "[i]" .. tostring(line) .. "[/i]" end
  -- (what it costs now, when the engine says it isn't its printed cost: the cost badge's words, there too for a hand
  -- TTS might draw no badge on, docs/cost-badge-spec.md)
  if c.ec ~= nil then
    local ch = engineCostChange(c.mc, c.ec)
    if ch ~= nil then s = s .. (s == "" and "" or "\n") .. "[b]" .. ch.text .. "[/b]" end
  end
  return (s:gsub('"', "'"))
end

-- TTS caches card images by CustomDeck number for the whole save, so two different pictures under the same number
-- show the same image (engine cards once all used 1, which the table's "The Ring" emblem also uses). Each picture
-- gets its own number, counting up from 3000 (above the importer's small numbers).
-- The numbers must stay SMALL: TTS's save/rewind snapshot costs time in proportion to a card's number (measured
-- 2026-10-19: number 1 = 0 ms, 999999 = 2.5 ms, 12517809 = 25 ms per card per snapshot). The old hash numbers
-- (1-20 million) made every rewind snapshot take 2.7 s with ~100 engine cards on the table.
local ENGINE_KEY_BASE = 3000
local engineKeys, engineKeyNext = nil, ENGINE_KEY_BASE
local function seedEngineKeys()
  engineKeys = {}
  -- numbers already used by engine cards in this save keep their picture, so a reloaded game never shows a wrong one
  for _, o in ipairs(getObjects()) do
    if (o.type == "Card" or o.type == "Deck") and (tostring(o.getGMNotes()):find("^engine") or o.getGMNotes() == "libcard") then
      for k, cd in pairs(o.getData().CustomDeck or {}) do
        k = tonumber(k)
        if k ~= nil and k >= ENGINE_KEY_BASE and k < 1000000 then
          engineKeys[tostring(cd.FaceURL) .. "|" .. tostring(cd.BackURL)] = k
          if k >= engineKeyNext then engineKeyNext = k + 1 end
        end
      end
    end
  end
end
function engineDeckKey(face, back)
  if engineKeys == nil then seedEngineKeys() end
  local str = tostring(face) .. "|" .. tostring(back)
  local k = engineKeys[str]
  if k == nil then
    k = engineKeyNext
    engineKeyNext = engineKeyNext + 1
    engineKeys[str] = k
  end
  return k
end

local function deckEntry(face, back)
  return { FaceURL = face, BackURL = back, NumWidth = 1, NumHeight = 1, BackIsHidden = true, UniqueBack = false, Type = 0 }
end

-- A LOCKED deck silently refuses putObject (measured 2026-10-19). Unlock it, put, and lock it again a frame later,
-- once the LAST put into it has landed: a put made while an earlier one's re-lock was still to come found the deck
-- unlocked, scheduled no re-lock of its own, and was refused when that re-lock came first (the trash, 2026-11-06).
enginePutsPending = {} -- deck guid -> { n = puts still landing, relock = it was locked before the first }
function enginePutInDeck(deck, obj)
  if deck == nil or deck.isDestroyed() or obj == nil or obj.isDestroyed() then return end
  local guid = deck.getGUID()
  local p = enginePutsPending[guid]
  if p == nil then
    p = { n = 0, relock = deck.getLock() }
    enginePutsPending[guid] = p
  end
  if p.relock then deck.setLock(false) end
  obj.setLock(false)
  deck.putObject(obj)
  p.n = p.n + 1
  Wait.frames(function()
    p.n = p.n - 1
    if p.n > 0 then return end
    if enginePutsPending[guid] == p then enginePutsPending[guid] = nil end
    if p.relock and deck ~= nil and not deck.isDestroyed() then deck.setLock(true) end
  end, 1)
end

-- Removing objects without the pause: TTS spends ~360 ms in the frame after EVERY destruct() (measured 2026-10-19
-- with PresentMon: one card 358 ms, five in one frame 1807 ms, locked or not, wherever it is; putting a card into a
-- bag costs the same), but a card merged into a DECK with putObject costs nothing. So engine cards that leave the
-- table are merged into a trash deck in a table corner, invisible to everyone and not grabbable. (It must sit on the
-- table: unlocked for the merge, a deck under the table is pushed back up.) Every TRASH_MAX cards the trash is
-- thrown away (one pause) and a new one starts; the game's end clears the rest.
local TRASH_SPOT, TRASH_MAX = Vector(52, 1.5, 33), 300
local engineTrash, trashQueue, trashSpawning = nil, {}, false
function engineEveryone()
  local all = Player.getAvailableColors()
  all[#all + 1] = "Grey"
  all[#all + 1] = "Black"
  return all
end
local function hideTrash(o)
  o.interactable = false
  o.setInvisibleTo(engineEveryone())
end
local function feedTrash()
  local t = engineTrash
  if t == nil or t.isDestroyed() then return end
  for _, o in ipairs(trashQueue) do
    if o ~= nil and not o.isDestroyed() then enginePutInDeck(t, o) end
  end
  trashQueue = {}
end
engineDebugDispose = false -- true: print every engine card the table removes (hunting "missing object" problems)
function engineDispose(o)
  if o == nil or o.isDestroyed() then return end
  if engineDebugDispose and tostring(o.getGMNotes()):find("^engine:") then
    print("[engine] remove " .. tostring(o.getGMNotes()) .. " (" .. (tostring(o.getName()):match("^[^\n]*") or "") .. ")")
  end
  if o.type ~= "Card" and o.type ~= "Deck" then o.destruct() return end
  o.setGMNotes("enginetrash") -- no longer an engine card: the spawn/destroy/container watchers leave it alone
  o.highlightOff()
  o.clearContextMenu()
  hideTrash(o)
  o.setLock(true)
  o.setPosition(TRASH_SPOT + Vector(0, 3, 0))
  trashQueue[#trashQueue + 1] = o
  if engineTrash ~= nil and not engineTrash.isDestroyed() and engineTrash.getQuantity() >= TRASH_MAX then
    engineTrash.destruct() -- one pause per TRASH_MAX cards instead of one per card
    engineTrash = nil
  end
  if engineTrash ~= nil and not engineTrash.isDestroyed() then feedTrash() return end
  if trashSpawning then return end
  trashSpawning = true
  local k = engineDeckKey(ENGINE_BACK, ENGINE_BACK)
  local flat = { posX = 0, posY = 0, posZ = 0, rotX = 0, rotY = 0, rotZ = 0, scaleX = 1, scaleY = 1, scaleZ = 1 }
  local card = { Name = "Card", Nickname = "Trash", GMNotes = "enginetrash", CardID = k * 100, CustomDeck = { [k] = deckEntry(ENGINE_BACK, ENGINE_BACK) }, Transform = flat }
  spawnObjectData({ data = { Name = "Deck", Nickname = "Engine trash", GMNotes = "engine:trash", Locked = true,
    DeckIDs = { k * 100, k * 100 }, CustomDeck = { [k] = deckEntry(ENGINE_BACK, ENGINE_BACK) }, ContainedObjects = { card, card }, Transform = flat },
    position = TRASH_SPOT, callback_function = function(d)
      trashSpawning = false
      hideTrash(d)
      engineTrash = d
      feedTrash()
    end })
end

local FLAT = { posX = 0, posY = 0, posZ = 0, rotX = 0, rotY = 0, rotZ = 0, scaleX = 1, scaleY = 1, scaleZ = 1 }
-- The one builder of an engine card's data (what TTS spawns). how: nil, a card on its own (locked, tagged "engine");
-- "inside", a member of a graveyard or exile pile deck; "search", a member of the library deck during a search, with
-- the plain back like the library's other cards. A member is neither locked nor tagged (the deck is locked).
local function engineCardData(c, how)
  local hidden = c.n == nil
  local face, back = hidden and ENGINE_BACK or (c.f or ENGINE_BACK), how == "search" and ENGINE_BACK or (c.b or ENGINE_BACK)
  local key = engineDeckKey(face, back)
  local own = how == nil
  local d = {
    Name = "Card", Nickname = nickname(c), Description = description(c), GMNotes = "engine:" .. tostring(c.id),
    Transform = FLAT, CardID = key * 100, Locked = own or nil, Tags = own and { "engine" } or nil,
    CustomDeck = { [key] = deckEntry(face, back) },
  }
  -- A two-faced card on its own has a second TTS state, its other face (c.o2), to read and cast by
  -- (docs/card-other-side-spec.md): behind it the plain back where state 1 has it (a hand: other players see only the
  -- Magic back, either state), else state 1's face (its back is the other face, so flipping either shows the other).
  -- Changing state is looking: the engine's card stays as it is. A member of a pile or the library has one state.
  if own and not hidden and c.o2 ~= nil and c.o2 ~= face then
    local back2 = back == c.o2 and face or back
    local key2 = engineDeckKey(c.o2, back2)
    d.States = { ["2"] = { Name = "Card", Nickname = d.Nickname, Description = d.Description, GMNotes = d.GMNotes, Transform = FLAT,
      CardID = key2 * 100, Locked = d.Locked, Tags = { "engine" }, CustomDeck = { [key2] = deckEntry(c.o2, back2) } } }
  end
  return d
end

local function firstLine(s) return (tostring(s or ""):match("^[^\n]*") or "") end
-- Is object o still the picture of board card c? Its name line as c's, or c's own name: the other face's name (n2)
-- arriving after the card was drawn renames it, it doesn't replace it. A two-faced card drawn before its other side was
-- known (or taken out of a pile, where cards have one state) is replaced to get its second state.
function engineSameCard(o, c)
  local line = firstLine(o.getName())
  if line ~= firstLine(nickname(c)) and line ~= tostring(c.n) then return false end
  if c.o2 ~= nil and c.o2 ~= c.f and c.n ~= nil and o.getStateId() == -1 then return false end
  return true
end

-- seen: a board's render (its `seen` table), whose hand lists are asked once each and kept in engineHandCache until
-- the next render. A render places each card once, so no card's hand changes before it is asked about; asking TTS
-- again for every hand card made a hand of n cards cost n getHandObjects lists of n (slow tail, docs/slow-tail-2026-11.md).
local function isInHand(o, color, index, seen)
  local hand
  if seen ~= nil then
    if engineHandCache == nil or engineHandCache.seen ~= seen then engineHandCache = { seen = seen, lists = {} } end
    local key = color .. "|" .. tostring(index or 1)
    hand = engineHandCache.lists[key]
    if hand == nil then hand = Player[color].getHandObjects(index or 1) or {} engineHandCache.lists[key] = hand end
  else hand = Player[color].getHandObjects(index or 1) or {} end
  for _, h in ipairs(hand) do if h == o then return true end end
  return false
end

-- Put engine card `c` at pos/rot (or into `handColor`'s hand). Spawns it the first time.
-- A seated player may drag their own battlefield and command-zone cards; everything else stays locked.
-- Keeps obj as the only object carrying engine id `id` (pile and library decks are rebuilt often).
local function keepOnly(id, obj)
  local gm = "engine:" .. id
  for _, o in ipairs(getObjects()) do
    if o ~= obj and tostring(o.getGMNotes()) == gm then engineDispose(o) end
  end
end

-- Cards an open question asks someone to click (a target, an attacker to block, a card to choose, a planeswalker to
-- attack): unlocked while it is open, even the AI's. TTS reports no click on a locked object, and the AI's cards are
-- always locked, so its creatures couldn't be targeted or blocked by clicking (2026-10-22 playtest).
engineClickable = {}
local function isFree(meta)
  return meta ~= nil and (meta.zone == "battlefield" or meta.zone == "command" or meta.zone == "playable") and meta.color ~= nil
    and Player[meta.color] ~= nil and Player[meta.color].seated
end

engineOps = {} -- what the last frames asked TTS to do (profiling)
local function op(name) engineOps[name] = (engineOps[name] or 0) + 1 end

-- Counters, damage and changed power/toughness show as a small label on the card (phase 3).
engineBadge = {} -- engine card id -> label currently on its card
enginePhaseTint = {} -- engine card id -> true while its card is dimmed as phased out
engineGroupShown = {} -- engine card id -> the "xN" count its badge last showed (a group that grows flashes gold)

local COUNTER_NAMES = { P1P1 = "+1/+1", M1M1 = "-1/-1", LOYALTY = "Loyalty", POISON = "Poison", SHIELD = "Shield",
  STUN = "Stun", LORE = "Lore", OIL = "Oil", CHARGE = "Charge", TIME = "Time", FADE = "Fade", AGE = "Age", DEFENSE = "Defense" }
function engineNoop() end
-- M5 step 2, Arena's layout: power/toughness bottom right (blue when raised, red when lowered or damaged: the
-- toughness shown is what is left after damage), loyalty/defense there for planeswalkers and battles, +1/+1 and
-- -1/-1 counters as a dark-blue tag top right with other counters under it, "xN" top left on a group of tokens.
-- One string per card (engineBadge) decides whether anything changed; then its buttons are drawn again.
local BADGE = { pt = { 0.62, 0.3, 1.18 }, ctr = { 0.6, 0.3, -1.12 }, grp = { -0.62, 0.3, -1.12 }, cp = { -0.55, 0.3, 1.18 }, cpBg = { 0.42, 0.18, 0.55, 0.95 },
  kw = { 0, 0.3, 0.1 }, kwBg = { 0.05, 0.32, 0.12, 0.95 }, tb = { 0, 0.29, 0.74 }, tbBg = { 0.95, 0.92, 0.84, 0.98 },
  poBg = { 0.1, 0.16, 0.42, 0.95 }, poTint = { 0.38, 0.42, 0.62 }, room = { 0, 0.3, 0.55 }, roomBg = { 0.36, 0.2, 0.05, 0.95 },
  black = { 0, 0, 0, 0.85 }, grew = { 0.8, 0.55, 0.05, 0.95 }, up = { 0.1, 0.35, 0.8, 0.95 }, down = { 0.62, 0.08, 0.08, 0.95 }, ctrBg = { 0.06, 0.16, 0.42, 0.95 } }
local function badgeParts(c)
  local parts = {}
  -- words to lines of at most max characters, onto the end of lines
  local function wrapInto(lines, words, max)
    local cur = ""
    for _, w in ipairs(words) do
      if cur ~= "" and #cur + #w + 1 > max then lines[#lines + 1] = cur cur = w else cur = cur == "" and w or (cur .. " " .. w) end
    end
    if cur ~= "" then lines[#lines + 1] = cur end
    return lines
  end
  -- a dungeon's room, where it leads and the dungeons completed, the bridge's words (dungeonLabel), the room's text as
  -- its tooltip (docs/planechase-dungeon-engine-spec.md D7)
  if type(c.dg) == "string" and c.dg ~= "" then parts[#parts + 1] = { "room", c.dg, BADGE.roomBg, type(c.dgt) == "string" and c.dgt or "" } end
  if (c.groupN or 1) > 1 then parts[#parts + 1] = { "grp", "x" .. c.groupN, BADGE.black } end
  -- a copy of another card (Phantasmal Image as Kenrith): which of two alike is the copy (legend rule, playtest 2026-10-26)
  if c.cp then parts[#parts + 1] = { "cp", "COPY", BADGE.cpBg } end
  -- its text as changed (Mind Bend's "islandwalk", Deadpool's exchanged text box): a box over the card's own text box,
  -- wrapped to the card's width, at most 4 lines here and the whole text in its tooltip (hp-25 2026-10-27); it stops
  -- under the type line, which no text change touches (Llanowar Elves' "(no text)" hid "Creature - Elf Druid", 2026-11-05)
  if c.ct then
    local lines = {}
    for para in (tostring(c.ct) .. "\n"):gmatch("([^\n]*)\n") do
      local words = {}
      for w in para:gmatch("%S+") do words[#words + 1] = w end
      wrapInto(lines, words, 28)
    end
    if #lines > 4 then
      local cut = {}
      for k = 1, 3 do cut[k] = lines[k] end
      cut[4] = "... (point at it for the rest)"
      lines = cut
    end
    parts[#parts + 1] = { "tb", table.concat(lines, "\n"), BADGE.tbBg, "Text changed: " .. tostring(c.ct), { 0.08, 0.06, 0.04 } }
  end
  -- One status box per card: phased out (it stays where it was, not in any pile; dimmed in updateBadge, and it counts as
  -- not there until it phases in), what changed about it (kw: "Hexproof from red" from Skrelv, hp-07 #31) and its own
  -- always-on keywords (ow). Over the art, its bottom edge just above the type line, growing upward: every status shows,
  -- wrapped card-wide, and none of it covers the text box. Attached cards sit beside the card, clear of it; the ability
  -- buttons are the other box, from the card's top, above this one where they meet. (2026-11-02: "Hexproof +5 more", and
  -- a PHASED OUT box over the text.)
  local status = {}
  for _, list in ipairs({ c.kw or {}, c.ow or {} }) do
    for _, s in ipairs(list) do status[#status + 1] = s end
  end
  if c.po or #status > 0 then
    local words = {}
    for k, s in ipairs(status) do
      local item = k < #status and (s .. ",") or s
      if #item <= 20 then words[#words + 1] = item else for w in item:gmatch("%S+") do words[#words + 1] = w end end
    end
    local lines = wrapInto(c.po and { "PHASED OUT" } or {}, words, 20)
    parts[#parts + 1] = { "kw", table.concat(lines, "\n"), c.po and BADGE.poBg or BADGE.kwBg, table.concat(status, ", ") }
  end
  local dmg = tonumber(c.dmg or 0) or 0
  local ctr, special, names = {}, nil, {}
  for k in pairs(c.ctr or {}) do names[#names + 1] = k end
  table.sort(names)
  local plus = 0
  for _, k in ipairs(names) do
    local n, up = tonumber(c.ctr[k]) or 0, string.upper(k)
    if up == "P1P1" then plus = plus + n
    elseif up == "M1M1" then plus = plus - n
    elseif up == "LOYALTY" or up == "DEFENSE" then special = tostring(n)
    else ctr[#ctr + 1] = n .. " " .. (COUNTER_NAMES[up] or (string.upper(k:sub(1, 1)) .. string.lower(k:sub(2)))) end
  end
  if plus ~= 0 then table.insert(ctr, 1, (plus > 0 and "+" or "") .. plus .. "/" .. (plus > 0 and "+" or "") .. plus) end
  if #ctr > 0 then parts[#parts + 1] = { "ctr", table.concat(ctr, "\n"), BADGE.ctrBg } end
  if c.p ~= nil and c.t ~= nil then
    -- bp/bt: the numbers on the card's picture, nil when it shows none (an X/X token's */*, a Tarmogoyf) or isn't
    -- known: then the badge always says the numbers, black, or down when damaged, never up (a 6/6 Dinosaur Beast
    -- showed none)
    local p, t, bp, bt = tonumber(c.p), tonumber(c.t), tonumber(c.bp), tonumber(c.bt)
    local known = c.bp ~= nil and c.bt ~= nil
    -- (a nil base is a change: tostring(nil) is "nil")
    local changed = tostring(c.p) ~= tostring(c.bp) or tostring(c.t) ~= tostring(c.bt)
    if changed or dmg > 0 then
      local lower = dmg > 0 or (p and bp and p < bp) or (t and bt and t < bt)
      parts[#parts + 1] = { "pt", tostring(c.p) .. "/" .. tostring(t and (t - dmg) or c.t), lower and BADGE.down or (known and BADGE.up or BADGE.black) }
    end
  elseif special ~= nil then parts[#parts + 1] = { "pt", special, BADGE.black } end
  return parts
end
local function badgeText(c)
  local out = {}
  for _, b in ipairs(badgeParts(c)) do out[#out + 1] = b[1] .. "=" .. b[2] .. "=" .. table.concat(b[3], ",") .. ((b[1] == "kw" and c.tap) and "=tapped" or "") end
  return table.concat(out, ";")
end
-- The cost badge (docs/cost-badge-spec.md, 2026-11-11): what a card in a hand, a command zone, a playable row or a
-- revealed strip costs now, when the engine says it isn't its printed cost (the bridge's ec beside the printed mc:
-- Forge's own sum of every reduction, increase and the commander tax). A counter like the table's other counters (their
-- box colour, a white number) covers the generic pip with the whole new generic amount ("3", never "+1"); a thin rim
-- under it says cheaper (green) or dearer (red). A change to a coloured symbol (Emerald Medallion's {G} off) is a chip
-- left of the pips ("-G"). Display only: the payment question says what is paid. Never on the battlefield (the counters
-- box sits there). Places: the pips' centres along the title bar, the rightmost at x, one step apart, at z; the counter
-- a little left of the pip's centre so its rim stops at the next pip. Estimates from a real card's proportions (63 x 88
-- mm on a 2.19 x 3.06 card, 480 button units to a local unit), to calibrate on the real table with tools/tts-shot.ps1.
BADGE.cost = { x = 0.85, step = 0.125, y = 0.3, z = -1.28, pip = 0.115, w = 80, h = 80, per = 30, rim = 8, dx = -0.03, fs = 64,
  chipW = 40, chipPer = 30, chipH = 66, chipFs = 52, gap = 0.02, unit = 480 }
BADGE.less, BADGE.more = { 0.15, 0.62, 0.2, 0.95 }, { 0.75, 0.12, 0.1, 0.95 }
ENGINE_COST_ZONES = { hand = true, command = true, playable = true, revealed = true }
-- A mana cost's symbols, "{2}{R}{W/P}" -> { "2", "R", "W/P" } (upper case). Plain find, no pattern: MoonSharp's.
function engineCostPips(s)
  local out, i = {}, 1
  s = tostring(s or "")
  while true do
    local a = string.find(s, "{", i, true)
    if a == nil then break end
    local b = string.find(s, "}", a + 1, true)
    if b == nil then break end
    out[#out + 1] = string.upper(string.sub(s, a + 1, b - 1))
    i = b + 1
  end
  return out
end
-- The printed cost mc against the cost now ec: nil when they say the same (or either is missing), else { generic = the
-- new generic sum or nil when it didn't change, hadGeneric = the printed cost has a generic pip, pips = how many
-- symbols the printed cost has, chip = "-G" / "+BB" / "-W/U +R" or nil, dir = "less" or "more" (dearer anywhere wins),
-- text = the hover words }. Generic is the {N} symbols only: X, hybrid ({2/W}, {W/U}), Phyrexian and {C} are symbols.
function engineCostChange(mc, ec)
  if type(mc) ~= "string" or type(ec) ~= "string" or ec == "" or mc == ec then return nil end
  local function split(s)
    local r = { generic = 0, has = false, sym = {}, n = 0 }
    for _, p in ipairs(engineCostPips(s)) do
      r.n = r.n + 1
      if string.find(p, "^%d+$") then r.generic = r.generic + tonumber(p) r.has = true
      else r.sym[p] = (r.sym[p] or 0) + 1 end
    end
    return r
  end
  local a, b = split(mc), split(ec)
  if b.n == 0 then return nil end
  local out, more, less = { pips = a.n, hadGeneric = a.has }, false, false
  if a.generic ~= b.generic then
    out.generic = b.generic
    if b.generic > a.generic then more = true else less = true end
  end
  local keys, chip = {}, {}
  for k in pairs(a.sym) do keys[#keys + 1] = k end
  for k in pairs(b.sym) do if a.sym[k] == nil then keys[#keys + 1] = k end end
  table.sort(keys)
  for _, k in ipairs(keys) do
    local d = (b.sym[k] or 0) - (a.sym[k] or 0)
    if d ~= 0 then
      chip[#chip + 1] = (d > 0 and "+" or "-") .. (#k == 1 and string.rep(k, math.abs(d)) or (k .. (math.abs(d) > 1 and ("x" .. math.abs(d)) or "")))
      if d > 0 then more = true else less = true end
    end
  end
  if not more and not less then return nil end
  out.chip = #chip > 0 and table.concat(chip, " ") or nil
  out.dir = more and "more" or "less"
  out.text = "Costs " .. ec .. " now (printed " .. (mc ~= "" and mc or "no mana cost") .. ")"
  return out
end
-- The cost badge's buttons for card c, in drawing order: { name, label, colour, tooltip, font colour, { x, y, z, w, h,
-- fs } }. The rim first, a little below the counter, which is drawn over it; the chip last.
function engineCostParts(c)
  local ch = engineCostChange(c.mc, c.ec)
  if ch == nil then return {} end
  local B = BADGE.cost
  local parts = {}
  local first = B.x - B.step * (ch.pips - 1) -- (the leftmost pip's centre)
  local left = first - B.pip / 2 -- (the left edge of what the badge covers so far: the chip goes left of it)
  if ch.generic ~= nil then
    -- (over the generic pip, or where one would be: left of the first symbol of a cost with none, Thalia on {R})
    local slot = ch.hadGeneric and first or (first - B.step)
    local label = tostring(ch.generic)
    local w = B.w + B.per * (#label - 1)
    local x = slot + B.dx - (w - B.w) / 2 / B.unit -- (wider to the left: its right edge stays short of the next pip)
    parts[#parts + 1] = { "costRim", "", ch.dir == "more" and BADGE.more or BADGE.less, ch.text, nil, { x = x, y = B.y - 0.01, z = B.z, w = w + 2 * B.rim, h = B.h + 2 * B.rim, fs = 10 } }
    parts[#parts + 1] = { "cost", label, BADGE.ctrBg, ch.text, { 1, 1, 1 }, { x = x, y = B.y, z = B.z, w = w, h = B.h, fs = B.fs } }
    left = math.min(left, x - (w / 2 + B.rim) / B.unit)
  end
  if ch.chip ~= nil then
    local w = B.chipW + B.chipPer * #ch.chip
    local dearer = string.find(ch.chip, "+", 1, true) ~= nil
    parts[#parts + 1] = { "costChip", ch.chip, dearer and BADGE.more or BADGE.less, ch.text, { 1, 1, 1 }, { x = left - B.gap - w / 2 / B.unit, y = B.y, z = B.z, w = w, h = B.chipH, fs = B.chipFs } }
  end
  return parts
end
-- The one string that says whether the cost badge changed (updateBadge's engineBadge)
function engineCostText(c)
  local out = {}
  for _, b in ipairs(engineCostParts(c)) do out[#out + 1] = b[1] .. "=" .. b[2] .. "=" .. table.concat(b[3], ",") .. "=" .. string.format("%.3f", b[6].x) end
  return table.concat(out, ";")
end
function engineCostDraw(o, c)
  for _, b in ipairs(engineCostParts(c)) do
    local g = b[6]
    o.createButton({ click_function = "engineNoop", function_owner = Global, label = b[2], position = { g.x, g.y, g.z }, rotation = { 0, 0, 0 },
      width = g.w, height = g.h, font_size = g.fs, color = b[3], font_color = b[5] or { 1, 1, 1 }, tooltip = b[4] or "" })
  end
end
local function updateBadge(o, c, zone)
  if o == nil or o.isDestroyed() then return end
  if zone == "battlefield" and c.po then
    if o.getColorTint().r > 0.6 then o.setColorTint(BADGE.poTint) end
    enginePhaseTint[c.id] = true
  elseif enginePhaseTint[c.id] then
    enginePhaseTint[c.id] = nil
    o.setColorTint({ 1, 1, 1 })
  end
  -- (a face-down permanent has badges too, drawn on the side that faces up, its back: one pumped or damaged said nothing.
  -- Its base is the rules' 2/2, bridge tableCard, so a plain morph has none. "=under" in the text redraws it with the next board after a flip.)
  -- (a card in a hand, a command zone, a playable row or a revealed strip shows only its cost badge, and none while its
  -- owner has it turned over: engineCostParts; a dungeon in the command zone shows its room badge instead)
  local room = zone == "command" and type(c.dg) == "string" and c.dg ~= ""
  local costZone = ENGINE_COST_ZONES[zone] == true and not engineFlipped[c.id] and not room
  local text = (zone == "battlefield" or room) and badgeText(c) or (costZone and engineCostText(c)) or ""
  if text ~= "" and (c.fd == true) ~= (engineFlipped[c.id] == true) then text = text .. "=under" end
  -- (the card's ability buttons are drawn with its badges: one set of buttons per card, engineAbilityButtons)
  local ab = engineAbilitySig ~= nil and engineAbilitySig(c) or ""
  if engineBadge[c.id] == text .. "#" .. ab then return end
  local had = engineBadge[c.id] ~= nil and engineBadge[c.id] ~= "" and engineBadge[c.id] ~= "#"
  engineBadge[c.id] = text .. "#" .. ab
  if had then o.clearButtons() end
  if ab ~= "" then Wait.frames(function() if not o.isDestroyed() and engineBadge[c.id] == text .. "#" .. ab then engineAbilityButtons(o, c) end end, 1) end
  -- a group of identical tokens that just grew ("x2" -> "x3") shows its count in gold for a moment: a new token that
  -- joins a group adds no card, and a player looked for it in vain (Grist's Insect, 2026-10-22 playtest)
  local grew = (c.groupN or 1) > (engineGroupShown[c.id] or 1)
  engineGroupShown[c.id] = c.groupN or 1
  if text == "" then return end
  if costZone then engineCostDraw(o, c) return end
  for k, b in ipairs(badgeParts(c)) do
    if b[1] == "grp" and grew then
      local mark = text .. "#" .. ab
      Wait.time(function() if engineBadge[c.id] == mark and not o.isDestroyed() then o.editButton({ index = k - 1, color = BADGE.black }) end end, 1.5)
    end
    local lines, longest = 1, 0
    for line in (b[2] .. "\n"):gmatch("([^\n]*)\n") do longest = math.max(longest, #line) lines = lines + 1 end
    lines = lines - 1
    local pos = BADGE[b[1]]
    local kwb, tbb = b[1] == "kw" or b[1] == "room", b[1] == "tb"
    -- (the status box: smaller, card-wide at most, its bottom edge fixed, growing upward; the changed text box: smaller
    -- still, card-wide, centred on the card's text box)
    local fs, lineH = tbb and 64 or kwb and 90 or 180, tbb and 78 or kwb and 102 or 165
    local h = tbb and math.max(390, 80 + lineH * lines) or kwb and (60 + lineH * lines) or (180 + lineH * lines)
    -- (a tall counter list grows downward from the top-right corner)
    local where, turn = { pos[1], pos[2], pos[3] + (b[1] == "ctr" and 0.13 * (lines - 1) or kwb and -h / 2000 or 0) }, { 0, 0, 0 }
    -- (a tapped card turns its status box back so it reads the right way up, as engineAbilityButtons does)
    if kwb and c.tap then where, turn = { -where[3], pos[2], 0 }, { 0, -90, 0 } end
    -- (on the back of a card lying face down: turned over with it, so it sits at the same corner as seen from above; the
    -- card's flip about its length reverses a turn about its upright, so a tapped one's status box turns back the other
    -- way: -90 read upside down there)
    if text:sub(-6) == "=under" then where, turn = { -where[1], -where[2], where[3] }, { turn[1], 0 - turn[2], turn[3] + 180 } end
    o.createButton({ click_function = "engineNoop", function_owner = Global, label = b[2],
      position = where, rotation = turn, width = tbb and 880 or kwb and math.min(1000, math.max(340, 50 * longest + 100)) or math.max(340, 112 * longest),
      -- (the changed text box covers the printed one from under the type line to above the power/toughness)
      height = h, font_size = fs,
      color = (b[1] == "grp" and grew) and BADGE.grew or b[3], font_color = b[5] or { 1, 1, 1 }, tooltip = b[4] or "" })
  end
end

engineFlipped = {} -- engine card id -> true while its owner has flipped it over on the table (looks only)

local ATTACH_SCALE = 0.5
-- The one way an object becomes engine card <id>'s object on the table (docs/core-moves-cleanup-plan.md §3): spawned
-- for board card c (place), or taken over with c nil (a card pulled out of a pile or a search, what is left of a pile
-- deck). The face it shows is recorded, so the next board doesn't mistake it for a changed card and replace it (a
-- tutored card was once thrown away and respawned): a spawned card's from c, a taken one's from the card's details.
-- opts.held: the player just took it; the next boards wait a moment for the engine to say where it goes.
-- opts.zone, opts.lock: a spawned card, drawn as it lies there (its badges, its lock, half size when attached).
function engineCardEntry(id, obj, c, opts)
  opts = opts or {}
  engineObjs[id] = obj
  engineSpawning[id] = nil
  engineFace[id] = engineFaceKey(c or engineStatic[id] or {})
  -- (a taken card is out of its pile; a spawned one was out when place asked for it, and a pile that took it in
  -- meanwhile has marked it again: the late callback must not undo that, or the pile counts and sweeps miss it)
  if c == nil and engineInPile ~= nil then engineInPile[id] = nil end
  if opts.held then engineHeld[id] = os.clock() end
  -- a new object has no badges or buttons yet: drawn again here for a spawned card, on the next board for one taken
  -- over (the text it had when it went into a pile drew nothing, and a reanimated Serra Angel had no status box)
  engineBadge[id] = nil
  engineStackGlow[id] = nil -- (its glow too: the board's on the next board, an open question's on the next frame)
  if c ~= nil then
    updateBadge(obj, c, opts.zone)
    obj.setLock(opts.lock == true)
    if opts.zone == "attached" or opts.zone == "linked" or opts.zone == "revealed" then obj.setScale(Vector(ATTACH_SCALE, 1, ATTACH_SCALE))
    elseif opts.zone == "plane" then obj.setScale(Vector(1.5, 1, 1.5)) end -- (a plane in play: larger, place)
  end
  if engineGlowLate ~= nil then engineGlowLate(id) end
end

-- A spawn callback from an earlier game ("mtg reset" while it spawned, gen = engineGen when the spawn was asked): true,
-- and the caller touches nothing. The reset's sweep put the object in the trash already (registering it wrote a trashed
-- object into the next game's bookkeeping and locked it, an error once the trash had merged it); one the sweep missed
-- (still "engine:<id>") goes now. Card spawns (place) and the library deck.
function engineSpawnStale(gen, obj, id)
  if gen == engineGen then return false end
  if obj ~= nil and not obj.isDestroyed() and tostring(obj.getGMNotes()) == "engine:" .. id then engineDispose(obj) end
  return true
end

local function place(c, pos, rot, seen, handColor, meta)
  if c == nil or c.id == nil then return end
  if engineFlipped[c.id] then
    if meta ~= nil and (meta.zone == "battlefield" or meta.zone == "command") then
      rot = Vector(rot.x, rot.y, (rot.z + 180) % 360)
    else engineFlipped[c.id] = nil end
  end
  seen[c.id] = true
  enginePlanned[c.id] = pos
  if meta ~= nil then engineMeta[c.id] = meta end
  local free = isFree(meta) or engineClickable[c.id] == true
  if engineHeld[c.id] ~= nil then
    local decided = meta ~= nil and meta.zone ~= "hand" and meta.zone ~= "command"
    if not decided and os.clock() - engineHeld[c.id] < 3 and engineObjs[c.id] ~= nil then return end -- still waiting
    engineHeld[c.id] = nil
  end
  local o = engineObjs[c.id]
  if o ~= nil and (o.isDestroyed() or not engineSameCard(o, c) or (c.f ~= nil and engineFace[c.id] ~= engineFaceKey(c))) then
    -- the card changed identity (transformed, turned face up, ...) or its back (a double-faced card shows the plain
    -- back in a hand and its other face elsewhere): replace it
    if not o.isDestroyed() then engineDispose(o) end
    engineObjs[c.id], o = nil, nil
  end
  if o == nil then
    if engineSpawning[c.id] then return end
    engineSpawning[c.id] = true
    engineInPile[c.id] = nil -- (placed on its own: in no pile deck now, though it may have left one without being taken out)
    if handColor ~= nil then engineInHand[c.id] = true end
    op("spawn")
    -- (a held mill comes off the library face down and turns face up onto its spot, a moment after the one before)
    local arrive = meta ~= nil and meta.zone == "heldmill" and meta.from ~= nil and not engineAnimOff
    local gen = engineGen
    spawnObjectData({ data = engineCardData(c), position = arrive and meta.from or pos, rotation = arrive and Vector(rot.x, rot.y, 180) or rot, callback_function = function(obj)
      if engineSpawnStale(gen, obj, c.id) then return end -- (from before an "mtg reset" while the board was spawning)
      -- (only while the mill is still held, when the card arrives and again when it turns over: one let go while it
      -- spawned or waited its turn (the library clicked, a question naming it, a slow spawn) went to the fan anyway and
      -- hung there beside its copy in the pile, or short of an empty graveyard, until the next board, 2026-11-11)
      local heldMill = meta ~= nil and meta.zone == "heldmill"
      local function stillHeld() return heldMill and heldInList((enginePending[meta.color] or {}).mill or {}, c.id) end
      if arrive and stillHeld() then
        Wait.time(function()
          if obj ~= nil and not obj.isDestroyed() and engineObjs[c.id] == obj and stillHeld() then obj.setRotationSmooth(rot, false, true) obj.setPositionSmooth(pos, false, true) end
        end, math.max(0.01, ((meta.k or 1) - 1) * MILL_GAP))
      end
      -- (unlocked on the hand position: a card spawned there joins that hand)
      engineCardEntry(c.id, obj, c, { zone = meta and meta.zone, lock = handColor == nil and not free })
      -- let go already: the board is drawn again, which sends it where the card is now (into its pile, enginePileStrays,
      -- or onto the graveyard's spot); one redraw for every card of the mill that arrives in the same frame
      if heldMill and not stillHeld() and not engineMillRedrawDue then
        engineMillRedrawDue = true
        Wait.frames(function() engineMillRedrawDue = nil if lastTable ~= nil then engineRender(lastTable) end end, 1)
      end
    end })
    return
  end
  -- (its type line as it is now: Vraska's -2 made Relentless Rats a Treasure artifact, and the card still read
  -- "Creature — Rat", hp-22 #4 2026-10-28)
  if o.getName() ~= nickname(c) then op("name") o.setName(nickname(c)) end
  if o.getDescription() ~= description(c) then op("desc") o.setDescription(description(c)) end
  local wantScale = (meta and (meta.zone == "attached" or meta.zone == "linked" or meta.zone == "revealed")) and ATTACH_SCALE or (meta and meta.zone == "plane") and 1.5 or 1
  if math.abs(o.getScale().x - wantScale) > 0.01 then op("scale") o.setScale(Vector(wantScale, 1, wantScale)) end
  if handColor ~= nil then
    engineInHand[c.id] = true
    if not isInHand(o, handColor, meta and meta.hand2 and 2 or 1, seen) then o.setLock(false) o.setPosition(pos) o.setRotation(rot) end
    -- (its cost badge, each board: one string compare when nothing changed)
    updateBadge(o, c, meta and meta.zone)
    return
  end
  if engineInHand[c.id] then
    -- TTS keeps re-laying-out hand cards, so a smooth move never leaves the hand: jump out first.
    engineInHand[c.id] = nil
    o.setLock(not free)
    o.setPosition(pos)
    o.setRotation(rot)
    -- (a cost badge doesn't leave the hand with its card: a spell cast showed its cost on the stack)
    if tostring(engineBadge[c.id] or ""):find("^cost") then updateBadge(o, c, meta and meta.zone) end
    return
  end
  if o.getLock() ~= (not free) then op("lock") o.setLock(not free) end
  -- (an attacking card swinging at its target: the board update leaves it alone until it is back, engineCombatLunge)
  if engineAnimUntil ~= nil and (engineAnimUntil[c.id] or 0) > os.clock() then updateBadge(o, c, meta and meta.zone) return end
  local cur, curRot = o.getPosition(), o.getRotation()
  local dr = math.abs(((curRot.y - rot.y + 540) % 360) - 180) + math.abs(((curRot.z - rot.z + 540) % 360) - 180)
  -- compare on the table plane: a card resting a little lower than planned must not be "moved" (that would
  -- interrupt its tap/untap rotation every redraw)
  local moved = (cur.x - pos.x) ^ 2 + (cur.z - pos.z) ^ 2 > 0.0025 or math.abs(cur.y - pos.y) > 0.4
  if moved then op("move") o.setPositionSmooth(pos, false, false) end
  if dr > 1 then op("rotate") o.setRotationSmooth(rot, false, false) end
  updateBadge(o, c, meta and meta.zone)
end

-- The id of a stand-in in <color>'s playable row or second hand zone for another player's hand card <id>; dragged onto
-- the battlefield it plays the real card (onObjectDrop reads the real id back out of it).
function engineCastId(color, id) return "cast:" .. tostring(color) .. ":" .. tostring(id) end
-- An object of its own for card c: its details, under the id given (a stand-in, a revealed card), with one hover line
function engineStandIn(c, id, note)
  local r = {}
  for key, v in pairs(c) do r[key] = v end
  r.id = id
  r.nt = { note }
  return r
end
-- The hand of a player another seat controls (Mindslaver's turn: White plays AI 1's turn), in the controller's second
-- hand zone, which only that player sees; its cards are the controller's to drag (Kykar re-test new bug 1). The bridge
-- sends it as ctlHand with the controller's colour, ctlBy. Each id is placed once (enginePlayableRows): a controlled
-- player who is seated keeps the cards in their own hand, and the controller gets stand-ins, cast:<controller>:<id>,
-- which play the real card when dragged onto the battlefield (one id in two hands would jump between them on every
-- board), unless the controller's playable row already has that stand-in.
function engineCtlHands(m, seen)
  local any = false
  for _, pl in ipairs(m.players or {}) do if pl.ctlBy ~= nil and #(pl.ctlHand or {}) > 0 then any = true end end
  if not any then return end
  local _, castOf, inHand = enginePlayableRows(m)
  for _, pl in ipairs(m.players or {}) do
    local by = pl.ctlBy
    local g = by and seatGeometry(by)
    if g ~= nil and #(pl.ctlHand or {}) > 0 and Player[by] ~= nil and Player[by].seated then
      local side = Player[by].getHandTransform(2)
      local base = side and side.position or (g.handPos or g.mat)
      for _, c in ipairs(pl.ctlHand) do
        local stand = engineCastId(by, c.id)
        if inHand[c.id] == by then
          place(c, base + Vector(0, 1, 0), Vector(0, g.rotY, 0), seen, by, { zone = "hand", color = by, hand2 = true })
        elseif castOf[stand] == nil then
          local r = engineStandIn(c, stand, "In " .. engineNameOf(pl.color) .. "'s hand (you control them): drag it onto the battlefield to play it")
          place(r, base + Vector(0, 1, 0), Vector(0, g.rotY, 0), seen, by, { zone = "playable", color = by, hand2 = true })
        end
      end
    end
  end
end

local function hasType(c, t)
  for _, x in ipairs(c.ty or {}) do if x == t then return true end end
  return false
end

-- ───────── doing it yourself: draws, mills and untaps wait for the player (SPEC §10a) ─────────
-- The engine draws, mills and untaps the moment the rules say so. On the table those moves wait for the player:
-- the drawn card stays on top of the library until you click the library, drag it or press Draw; milled cards
-- until you drag them or press Mill; your permanents stay tapped until you press Untap. With "Auto" on in your
-- panel draws and untaps go by themselves after AUTO_DELAY and mills aren't held at all. Anything a decision needs
-- is released at once.
enginePending = {}  -- colour -> { draw = { ids }, mill = { ids }, untap = { [id] = true } }
-- colour -> false: that player turned Auto off. Auto is on by default (2026-10-22): draws and untaps held on the
-- table finish by themselves after AUTO_DELAY (Arena has no holding; a held mill fanned beside the library and a
-- tutored card waiting on top of it looked like glitches to the player), and mills go straight to the graveyard
-- (detectPending, 2026-11-11). Click the library / pile to take them sooner.
engineAutoPace = {}
function engineAutoOn(color) return engineAutoPace[color] ~= false end
local AUTO_DELAY = 2
local autoPaceToken = {} -- colour -> number of the newest auto-release timer (only that one may fire)
paceArmed = {} -- colour -> true once that player had a decision after the opening hand (mulligans are not draws)

local function pendingOf(color)
  enginePending[color] = enginePending[color] or { draw = {}, mill = {}, untap = {} }
  return enginePending[color]
end

function enginePendingCount(color)
  local p = enginePending[color]
  if p == nil then return 0, 0, 0 end
  local u = 0
  for _ in pairs(p.untap) do u = u + 1 end
  return #p.draw, #p.mill, u
end

local function idSet(list)
  local set = {}
  for _, c in ipairs(list or {}) do set[c.id] = true end
  return set
end

-- The one comparison of each board with the board before it, for every player: how many cards the library lost and
-- which graveyard cards are new (nowhere public and not in the hand before). The holder of draws and mills
-- (detectPending) and the mill stand-ins (engineMillDetect) both read it; each kept its own copy of the previous board
-- before, and the copies were taken from different boards (the holder's only while the player was seated).
engineBoardSeen = {}  -- colour -> { hand = {id=true}, handN, lib, public = {id=true}, tapped = {id=true}, turn } of the newest board
engineBoardDiffs = {} -- colour -> { prev, drop, fresh = {card, ...} }: the newest board against the one before
engineBoardNew = false -- whether the board being rendered is a new one (a re-render of the same board detects nothing)
engineBoardLast = nil
function engineBoardDiff(m)
  engineBoardNew = m ~= engineBoardLast
  if not engineBoardNew then engineBoardDiffs = {} return end
  engineBoardLast = m
  local diffs = {}
  for _, pl in ipairs(m.players or {}) do
    local color = pl.color
    if color ~= nil then
      local public = {}
      for _, z in ipairs({ "battlefield", "graveyard", "exile", "command" }) do
        for _, c in ipairs(pl[z] or {}) do public[c.id] = true end
      end
      for _, sItem in ipairs(m.stack or {}) do if sItem.src then public[sItem.src] = true end end
      local tapped = {}
      for _, c in ipairs(pl.battlefield or {}) do if c.tap then tapped[c.id] = true end end
      local prev = engineBoardSeen[color]
      if prev ~= nil then
        local fresh = {}
        for _, c in ipairs(pl.graveyard or {}) do
          if not prev.public[c.id] and not prev.hand[c.id] then fresh[#fresh + 1] = c end
        end
        diffs[color] = { prev = prev, drop = (prev.lib or 0) - (pl.library or 0), fresh = fresh }
      end
      engineBoardSeen[color] = { hand = idSet(pl.hand), handN = #(pl.hand or {}), lib = pl.library or 0, public = public, tapped = tapped, turn = m.turn }
    end
  end
  engineBoardDiffs = diffs
end

-- Holds back the newest board's draws, mills and untaps (engineBoardDiff) for seated players.
local function detectPending(m)
  if not engineBoardNew then return end
  for _, pl in ipairs(m.players or {}) do
    local color = pl.color
    if color ~= nil and Player[color] ~= nil and Player[color].seated and pl.hand ~= nil then
      local diff = engineBoardDiffs[color]
      local prev = diff and diff.prev
      local p = pendingOf(color)
      local handSet = engineBoardSeen[color].hand
      -- forget held cards the engine has moved on since (cast, discarded, shuffled away, ...)
      local keep = {}
      for _, id in ipairs(p.draw) do if handSet[id] then keep[#keep + 1] = id end end
      p.draw = keep
      local gy = idSet(pl.graveyard)
      keep = {}
      for _, id in ipairs(p.mill) do if gy[id] then keep[#keep + 1] = id end end
      p.mill = keep
      local tappedNow = engineBoardSeen[color].tapped
      local bf = idSet(pl.battlefield)
      for id in pairs(p.untap) do if not bf[id] or tappedNow[id] then p.untap[id] = nil end end

      if prev ~= nil and paceArmed[color] then
        local libDrop = diff.drop
        -- draws: new cards in hand, the hand grew by as many, and the library shrank
        local newHand = {}
        for _, c in ipairs(pl.hand) do if not prev.hand[c.id] and not prev.public[c.id] then newHand[#newHand + 1] = c.id end end
        local grew = #pl.hand - (prev.handN or 0)
        local drawn = math.min(#newHand, math.max(0, libDrop), math.max(0, grew))
        for i = #newHand - drawn + 1, #newHand do p.draw[#p.draw + 1] = newHand[i] end
        if drawn > 0 then
          engineTableLog(color, "drew " .. drawn .. ": held on the library " .. ((engineAutoOn ~= nil and engineAutoOn(color)) and "(Auto takes it)" or "until the library or Draw is clicked (Auto off)"))
        end
        libDrop = libDrop - drawn
        -- a question already open about these very cards means the player needs them in hand now: the engine sends
        -- the question ~50 ms before the board that draws them (Sylvan Library's "choose 2 cards drawn this turn";
        -- they stayed on the library and the question couldn't be answered on the table, 2026-10-22 playtest)
        local q = enginePrompts[color]
        if q ~= nil and q.promptId ~= nil and #p.draw > 0 then
          local held = {}
          for _, id in ipairs(p.draw) do held[id] = true end
          for _, o in ipairs(q.options or {}) do
            if held[(tostring(o.cardId or o.id or ""):gsub("^card|", ""))] then p.draw = {} break end
          end
        end
        -- mills: new cards in the graveyard that weren't anywhere public before, while the library shrank. Held only
        -- for a player doing it themselves (Auto off). With Auto on they fly face up from the library into the graveyard
        -- as an AI's do (engineMillDetect): held, each one hung face up in the air a quarter of the way to the graveyard
        -- until Auto let it go 2 s later (and longer while boards kept coming), which read as a mill animation stuck
        -- half-way that only a click finished (the player, 2026-11-11).
        if not engineAutoOn(color) then
          for _, c in ipairs(diff.fresh) do
            if libDrop <= 0 then break end
            p.mill[#p.mill + 1] = c.id
            libDrop = libDrop - 1
          end
        end
        -- a big mill (more than 5) goes straight into the graveyard deck: 20 loose face-up cards would be 20 live
        -- objects, each one making Unity's clean-up pauses longer
        if #p.mill > 5 then p.mill = {} end
        -- untaps: your own permanents the engine untapped as your turn began (Forge rarely stops in the untap step
        -- itself, so "a new turn and it is yours" is the sign)
        -- (not for a player who pressed READY: their Untap button is out of the way, so untapping happens at once)
        if m.active == color and m.turn ~= prev.turn and not (engineReadyState ~= nil and engineReadyState[color] == "ready") then
          for _, c in ipairs(pl.battlefield or {}) do
            if prev.tapped[c.id] and not c.tap then p.untap[c.id] = true end
          end
        end
        local d, mi, u = enginePendingCount(color)
        if (d + mi + u) > 0 and engineAutoOn(color) then
          autoPaceToken[color] = (autoPaceToken[color] or 0) + 1
          local mine, batch = autoPaceToken[color], p
          Wait.time(function()
            if autoPaceToken[color] == mine and enginePending[color] == batch then engineReleasePending(color, "all") end
          end, AUTO_DELAY)
        end
      end
    end
  end
end

function engineExileSpot(d) return d.libraryZone.getPosition() + d.libraryZone.getTransformForward() * 4.16 end
function engineHeldTapped(id)
  for _, p in pairs(enginePending) do if p.untap[id] then return true end end
  return false
end

local function heldIn(list, id)
  for _, x in ipairs(list) do if x == id then return true end end
  return false
end

-- Identical tokens (same name, controller, tapped state, counters, power/toughness, damage, nothing attached) are
-- drawn as ONE card with an "xN" label, like Arena, once there are ENGINE_GROUP_MIN of them; fewer lie side by side
-- (playtest 2026-10-25: "split tokens until it hits five, then stack"). Every live object makes Unity's periodic
-- clean-up pass slower, and token-heavy boards were the worst case. The first token of a group stands for all of
-- them: clicking it to attack sends the whole stack (engineGroupMembers), and in an attack, block or target question
-- the box beside it splits the stack so each token can be picked (engineSplit, until the question closes).
-- The Arena way (docs/token-stacks-spec.md, the user 2026-11-06): one stack per kind, no size cap. In combat a kind's
-- tokens are drawn as one stack per part they play, the board's or the open question's (engineCombatSubs): the ones
-- picked to attack (by target), those blocking (by attacker), each attacker blocked. So picking one token out of a
-- stack of 20 draws a stack of 19 and a card of 1, two objects, never the 20 a split lays out.
ENGINE_GROUP_MIN = 5
engineGroupOf = {} -- engine card id -> representative id while it is drawn as part of a group
engineGroupKey = {} -- representative id -> its group's key (the kind's: a split splits every stack of the kind)
engineGroupList = {} -- representative id -> the ids of its stack in board order, the representative first
engineSubDrawn = {} -- engine card id of a token in a group -> the combat part its stack was drawn with ("" for none)
engineCombatHeld = {} -- colour -> { kind, ids }: the picks of its combat answer, drawn until the next board
engineSplit = {} -- group key -> the colour whose question split it
function engineTokenKey(c)
  local ctr = {}
  for k, v in pairs(c.ctr or {}) do ctr[#ctr + 1] = k .. v end
  table.sort(ctr)
  -- (kw too: the first token's status box speaks for the stack, so a new Goblin doesn't call the old five summoning sick)
  return table.concat({ tostring(c.n), tostring(c.ctl), tostring(c.tap), tostring(c.p), tostring(c.t), tostring(c.dmg or 0), table.concat(ctr, ","), tostring(c.fd), tostring(c.po), table.concat(c.kw or {}, ",") }, "|")
end
-- the ids of the stack this card leads, in board order (just its own for a card that leads none)
function engineGroupMembers(id)
  local out = {}
  for _, m in ipairs(engineGroupList[id] or { id }) do out[#out + 1] = m end
  return out
end
function groupTokens(list, seen, hosts)
  local out, byKey, count = {}, {}, {}
  local groupable = function(c) return c.tok and c.att == nil and not (hosts and hosts[c.id]) end
  local subs = engineCombatSubs ~= nil and engineCombatSubs() or {}
  for _, c in ipairs(list) do
    if groupable(c) then local key = engineTokenKey(c) count[key] = (count[key] or 0) + 1 end
  end
  for _, c in ipairs(list) do
    local key = groupable(c) and engineTokenKey(c) or nil
    if key ~= nil and count[key] >= ENGINE_GROUP_MIN and engineSplit[key] == nil then
      -- (whether a kind stacks is its whole count's call; the combat parts only cut it into stacks)
      local sub = subs[c.id] or ""
      engineSubDrawn[c.id] = sub
      local rep = byKey[key .. "#" .. sub]
      if rep == nil then
        byKey[key .. "#" .. sub] = c
        c.groupN = 1
        engineGroupOf[c.id] = nil
        engineGroupKey[c.id] = key
        engineGroupList[c.id] = { c.id }
        out[#out + 1] = c
      else
        rep.groupN = rep.groupN + 1
        engineGroupOf[c.id] = rep.id
        engineGroupKey[c.id] = nil -- (it led a stack on an earlier draw)
        engineGroupList[c.id] = nil
        local l = engineGroupList[rep.id]
        l[#l + 1] = c.id
        seen[c.id] = true -- part of the group: no object of its own
        local o = engineObjs[c.id]
        if o ~= nil then
          if not o.isDestroyed() then engineDispose(o) end
          engineObjs[c.id] = nil
        end
      end
    else
      engineGroupOf[c.id] = nil
      engineGroupKey[c.id] = nil
      engineGroupList[c.id] = nil
      engineSubDrawn[c.id] = nil
      c.groupN = nil -- (a redraw of the same board after a split: this card led the stack last time)
      out[#out + 1] = c
    end
  end
  return out
end

local ATTACH = { scale = 0.5, extraCols = 0.6 } -- auras/equipment: half size, beside their host
local function layoutRow(g, cards, row, seen, color, hosts)
  local n = #cards
  if n == 0 then return end
  local width = 0
  for _, c in ipairs(cards) do width = width + 1 + ((hosts and hosts[c.id]) and ATTACH.extraCols or 0) end
  local step = width > GRID.perRow and GRID.perRow / width or 1 -- squeeze long rows
  local col = 0
  for i, c in ipairs(cards) do
    -- a permanent that changed controller (Volatile Stormdrake's exchange, a steal) goes to its new controller's
    -- side: the spot its old controller arranged it at is on the other side of the table
    local was = engineMeta[c.id]
    if was ~= nil and was.color ~= nil and was.color ~= color then engineManual[c.id] = nil end
    -- a LAND played by dragging it here lands in the mana box: the spot it was dropped on only held it while it was
    -- played (playtest 2026-10-26: "it appears in the middle of the battlefield instead of the lower mana box"). Any
    -- other card stays where it was dropped (2026-11-10: "I also don't want any other cards to snap to the play mat"),
    -- like a permanent you moved yourself on your mat.
    if engineManualPlay[c.id] then
      if row == ROWS.land then engineManual[c.id] = nil end
      engineManualPlay[c.id] = nil
    end
    local pos = engineManual[c.id] or gridPos(g, col * step, row)
    col = col + 1 + ((hosts and hosts[c.id]) and ATTACH.extraCols or 0)
    place(c, pos, Vector(0, g.rotY + ((c.tap or engineHeldTapped(c.id)) and 90 or 0), c.fd and 180 or 0), seen, nil, { zone = "battlefield", color = color })
  end
end

-- ───────── trackers ─────────
-- M5 step 2: a life change shows as a red "-N" / green "+N" under the counter's number for 3 s (the counter's own
-- change line, see make-engine-copy "engineLifeChange"); changes within those 3 s add up, so a combat with five
-- attackers shows one "-14". Only changes during a game: the first board of a game just sets the number.
engineLifeSeen = {} -- colour -> { life = last life the engine reported, base = life before the change on show, at = os.clock() }
local function setLife(color, life)
  local o = getObjectFromGUID(LIFE_TRACKERS[color] or "")
  if o == nil or life == nil then return end
  local seen = engineLifeSeen[color]
  engineLifeSeen[color] = seen or { life = life }
  if seen ~= nil and seen.life ~= life then
    if seen.at == nil or os.clock() - seen.at > 3 then seen.base = seen.life end
    seen.at, seen.life = os.clock(), life
    o.setVar("count", life)
    if o.getVar("engineLifeChange") ~= nil then o.call("engineLifeChange", { life = life, delta = life - seen.base })
    else o.call("sL", life) end
    o.call("updateSave")
    return
  end
  if o.getVar("count") == life then return end
  o.setVar("count", life)
  o.call("sL", life)
  o.call("updateSave")
end

local function setCounterVal(guid, val)
  local o = getObjectFromGUID(guid)
  if o == nil or o.getVar("val") == val then return end
  o.setVar("val", val)
  o.call("updateVal")
  o.call("updateSave")
end

local function setTax(guid, tax)
  local o = getObjectFromGUID(guid)
  if o == nil or o.getVar("val") == tax then return end
  o.setVar("val", tax)
  for i = 0, 9 do pcall(function() o.editButton({ index = i, label = tostring(tax) }) end) end
end

local function updateTrackers(m)
  for _, pl in ipairs(m.players or {}) do
    local color = pl.color
    if color ~= nil then
      setLife(color, pl.life)
      if enginePlayerCounters ~= nil then pcall(enginePlayerCounters, getObjectFromGUID(LIFE_TRACKERS[color] or ""), pl) end
      if engineExtraTurnBadge ~= nil then pcall(engineExtraTurnBadge, getObjectFromGUID(LIFE_TRACKERS[color] or ""), pl) end
      for from, guid in pairs(CMD_DAMAGE[color] or {}) do setCounterVal(guid, (pl.cmdDamage or {})[from] or 0) end
      for i, guid in ipairs(TAX_LABELS[color] or {}) do setTax(guid, (pl.tax or {})[i] or 0) end
    end
  end
  if engineStatusPieces ~= nil then pcall(engineStatusPieces, m) end -- (the pieces for the marks: under the last box)
  if m.active ~= nil and m.active ~= lastTurnSet then
    lastTurnSet = m.active
    if Player[m.active] ~= nil and Player[m.active].seated and Turns.turn_color ~= m.active then
      pcall(function() Turns.enable = true Turns.turn_color = m.active end)
    end
  end
end

-- ───────── render ─────────
local function keepStashed()
  for guid, st in pairs(stashed) do
    local o = getObjectFromGUID(guid)
    if o ~= nil and o.getPosition().y > -5 then o.setLock(true) o.setPosition(st.pos + Vector(0, -15, 0)) end
  end
end

engineStackGlow = {} -- engine card id -> "stack" / "atk" / "blk": the glow it has when no question is open
engineBaseGlow = {}  -- object -> colour of that glow
BASE_GLOW = { stack = {0.75, 0.35, 1}, atk = {1, 0.12, 0.08}, blk = {0.15, 0.45, 1}, playable = {0.35, 1, 0.45} }
-- A player's counters other than life (poison, energy) and their other marks as small green boxes in the corner of
-- their mat under their life counter, while there are any (Skrelv's toxic gave the AI poison and nothing showed it,
-- playtest 2026-10-27; energy was sent and shown nowhere, structural review the same day). Buttons of the counter
-- object, found again by their tooltip.
ENGINE_COUNTERS_TIP = "Poison (ten and that player loses), energy and the other player counters, the monarch (draws at their end step), the initiative, the city's blessing, an enduring story, the Ring's temptations, speed, a turn run by another player, an extra turn, damage prevention, hand size, and what protects or binds the player"
engineCountersShown = {} -- counter object guid -> the label it shows (redrawn only on a change)
-- (the label goes with the game: it stayed on the normal table after a reset, stage 3 review 2026-10-27)
-- (the extra-turn number beside the life counter goes too, engineExtraTurnBadge; from the last button down, as a
-- removal moves the ones after it)
function engineCountersReset()
  for _, guid in pairs(LIFE_TRACKERS) do
    local o = getObjectFromGUID(guid)
    local buttons = (o and o.getButtons()) or {}
    for i = #buttons, 1, -1 do
      if buttons[i].tooltip == ENGINE_COUNTERS_TIP or engineExtraTurnTip(buttons[i].tooltip) then o.removeButton(i - 1) end
    end
  end
  engineCountersShown = {}
  if engineStatusParkAll ~= nil then pcall(engineStatusParkAll) end -- (the status pieces go back under the table)
end
-- Where the marks go: one small box a mark, stacked down the inner corner of the player's mat under the heart
-- (2026-11-10, the user: "have it [in the] corner of your playmat under your heart"; "you can add multiple boxes if
-- need be instead of cramming everything in one box"; before, one label ran along the strip between the counters and
-- the mats, live check 9). The battlefield grid leaves the inner end of every row empty (column 0 is GRID.colStart
-- 10.75 from the mat's centre, a tapped card reaching 12.28; the mat's inner edge is 18.5 out), so the boxes keep to
-- that strip: each box's inner edge `inner` button units towards the middle from the counter's centre (world 1.04 from
-- the middle line, the mat's edge at 0.9), at most `max` wide (to 6.94, the tapped card at 7.12); the first box's top
-- edge at local `top` (world 5.26 from the middle line, the mat's edge at 5.03), the next `gap` under it. A box is
-- drawn at the largest of `fonts` its mark fits in; a mark too long even at the smallest is cut, ending "...". Past
-- `boxes` marks, the last box says "+n MORE". perLocal: button units in one local unit of the tracker, measured on the
-- live crop (a 4500-wide label was 11.75 world units on a tracker scaled 1.258).
ENGINE_MARKS_FIT = { inner = 940, max = 2250, boxes = 10, gap = 60, perLocal = 480, fonts = { 300, 260, 220, 190, 165, 150 }, top = 2.1 }
-- the box a mark needs at font f: as wide as its letters (no floor: the shortest real mark, "RAD 1", is 1175 at 300)
function engineMarksWidth(text, f)
  return math.floor((175 * #text + 300) * f / 300 + 0.5)
end
-- a mark cut to what one box holds at font f, ending "...", at a whole character
function engineMarksCut(m, f)
  local n = math.floor((ENGINE_MARKS_FIT.max * 300 / f - 300) / 175) - 3
  -- (not inside a character: the byte after the cut is no UTF-8 continuation byte)
  while n > 0 and (m:byte(n + 1) or 0) >= 128 and (m:byte(n + 1) or 0) < 192 do n = n - 1 end
  return m:sub(1, n) .. "..."
end
-- the marks' boxes, in order: { text, font, width, height } each; past `boxes` marks the last one is "+n MORE"
function engineMarksBoxes(parts)
  local fitIn = ENGINE_MARKS_FIT
  local fonts, list = fitIn.fonts, parts
  if #parts > fitIn.boxes then
    list = {}
    for i = 1, fitIn.boxes - 1 do list[i] = parts[i] end
    list[fitIn.boxes] = "+" .. tostring(#parts - fitIn.boxes + 1) .. " MORE"
  end
  local out = {}
  for i, m in ipairs(list) do
    local f = fonts[#fonts]
    for _, try in ipairs(fonts) do
      if engineMarksWidth(m, try) <= fitIn.max then f = try break end
    end
    if engineMarksWidth(m, f) > fitIn.max then m = engineMarksCut(m, f) end
    out[i] = { text = m, font = f, width = engineMarksWidth(m, f), height = math.floor(380 * f / 300 + 0.5) }
  end
  return out
end
-- Which way along a tracker's label is away from the middle of the table, in button x: +1, -1, or 0 for a tracker on
-- the middle line. TTS draws a button's +x on its reader's right (the tracker's own "+20" is at +x and shows on its
-- owner's right), which is world (-cos ry, 0, sin ry) for a tracker turned ry about y.
function engineMarksOutward(o)
  local p, r = o.getPosition(), o.getRotation()
  local a = math.rad(r.y or 0)
  local s = -(p.x or 0) * math.cos(a) + (p.z or 0) * math.sin(a)
  if s > 0.01 then return 1 elseif s < -0.01 then return -1 end
  return 0
end
function enginePlayerCounters(o, pl)
  if o == nil then return end
  local parts = {}
  -- (the whole label, worded and ordered by the bridge: bridge PLAYER_MARKS; it is left out when there is no mark. The
  -- old fields' fallback went in docs/core-moves-cleanup-plan.md "2. trackMarks" step 6; a row that isn't a list draws
  -- nothing)
  if type(pl.allMarks) == "table" then
    for _, m in ipairs(pl.allMarks) do parts[#parts + 1] = tostring(m) end
  end
  local boxes = engineMarksBoxes(parts)
  local texts = {}
  for i, b in ipairs(boxes) do texts[i] = b.text end
  local label = table.concat(texts, "\n")
  local at = {}
  for i, b in ipairs(o.getButtons() or {}) do if b.tooltip == ENGINE_COUNTERS_TIP then at[#at + 1] = i - 1 end end
  -- (unchanged and still there: the tracker's own onload clears its buttons, stage 3 review 2026-10-27)
  if engineCountersShown[o.getGUID()] == label and #at == #boxes then return end
  engineCountersShown[o.getGUID()] = label
  -- (boxes no longer needed go, from the last down as a removal moves the ones after it; the rest are edited in place)
  for i = #at, #boxes + 1, -1 do o.removeButton(at[i]) end
  -- (down the mat's inner corner under the heart: each box's inner edge `inner` towards the middle, the first box's top
  -- edge at `top`, the next `gap` under it; ENGINE_MARKS_FIT)
  local fitIn = ENGINE_MARKS_FIT
  local sign = engineMarksOutward(o)
  if sign == 0 then sign = 1 end
  local top = fitIn.top
  for i, b in ipairs(boxes) do
    local look = { label = b.text, width = b.width, height = b.height, font_size = b.font,
      position = { sign * (b.width / 2 - fitIn.inner) / fitIn.perLocal, 0.05, top + b.height / 2 / fitIn.perLocal } }
    top = top + (b.height + fitIn.gap) / fitIn.perLocal
    if at[i] ~= nil then
      look.index = at[i]
      o.editButton(look)
    else
      look.click_function, look.function_owner, look.rotation, look.tooltip = "engineNoop", Global, { 0, 0, 0 }, ENGINE_COUNTERS_TIP
      look.color, look.font_color = { 0.04, 0.2, 0.05, 0.92 }, { 0.45, 1, 0.45 }
      o.createButton(look)
    end
  end
end
-- The extra turns a player has coming (the bridge's extraTurns, Forge's extra turn count, the ones still to come: it
-- drops as each begins) as a label beside the life counter, counted from 1: one is "EXTRA TURN", two "EXTRA TURN 2x",
-- n "EXTRA TURN nx" (2026-11-12, the user; it was a lone number, the count + 1, so one extra turn read "2", live check
-- batch 1 item 4; docs/extra-turn-counter-spec.md); none at 0 or with no count (an engine from before it). Across the
-- counter's top-left lobe, the side away from its [R]: centred at local z -1.45, its right edge at x 0.55 (the [R] from
-- 0.61) and growing to the left, at most to -2 (a commander-damage icon from -2.13 on two seats), at the largest of
-- `fonts` it fits in (engineMarksWidth, as the marks boxes); at its largest, 175 for one extra turn, 222 high, its box (z -1.68..-1.22) stays
-- clear of the life number's button (to -1.08) and the -20 under it (from -0.95), checked in
-- tests/test_table_claims.js "extra-turn badge fit". The hover text names the count, "AI 1 has 2 extra turns coming",
-- and finds the button again (engineExtraTurnTip)
function engineExtraTurnTip(t)
  return type(t) == "string" and t:sub(-7) == " coming" and t:find(" extra turn", 1, true) ~= nil
end
function engineExtraTurnBadge(o, pl)
  if o == nil then return end
  local n = type(pl.extraTurns) == "number" and math.floor(pl.extraTurns) or 0
  local at, now
  for i, b in ipairs(o.getButtons() or {}) do if engineExtraTurnTip(b.tooltip) then at, now = i - 1, b end end
  if n < 1 then
    if at ~= nil then o.removeButton(at) end
    return
  end
  local label = n == 1 and "EXTRA TURN" or ("EXTRA TURN " .. tostring(n) .. "x")
  local tip = tostring(pl.name or pl.color) .. " has " .. tostring(n) .. (n == 1 and " extra turn" or " extra turns") .. " coming"
  if now ~= nil and now.label == label and now.tooltip == tip then return end
  local right, left, fonts = 0.55, -2, { 175, 150, 135, 120 }
  local f = fonts[#fonts]
  for _, try in ipairs(fonts) do
    if engineMarksWidth(label, try) <= (right - left) * 480 then f = try break end
  end
  local w = engineMarksWidth(label, f)
  local look = { label = label, tooltip = tip, width = w, height = math.floor(380 * f / 300 + 0.5), font_size = f,
    position = { right - w / 960, 0.06, -1.45 } }
  if at ~= nil then
    look.index = at
    o.editButton(look)
  else
    look.click_function, look.function_owner, look.rotation = "engineNoop", Global, { 0, 0, 0 }
    look.color, look.font_color = { 0.95, 0.72, 0.15, 0.95 }, { 0.12, 0.06, 0 }
    o.createButton(look)
  end
end
-- ───────── status pieces (docs/status-objects-spec.md, 2026-11-11) ─────────
-- The original table's piece for a player status (the monarch's crown, Undercity for the initiative, the city's
-- blessing, The Ring, the poison / energy / experience counters) lies on a player's mat while their marks say it, just
-- under the last marks box (2026-11-10, the user: "if the box says monarch the crown spawns in on their mat. Also have
-- relevant objects hidden under the table with opacity at 0"); Day // Night lies in the middle of the table while the
-- engine says day or night. make-engine-copy keeps the pieces parked under the table (y -30), locked, faded, without
-- their scripts, and writes ENGINE_STATUS_PIECES (each piece's mark, its object per seat or its one object, where it
-- parks) and ENGINE_DAY_NIGHT. Moved, never spawned (live-spawning many objects crashed TTS); a piece is moved only
-- when where it goes, or its count, changes. Parked when the game's counters go (engineCountersReset: a reset, a
-- rematch), when engine mode goes off, on load, and, while no game runs, any piece no board put out.
-- gap: world units between the last marks box and a piece, and between pieces; side: the margin each side of the
-- strip (and before the mat's near edge, `matHalf` from its centre: the mat zone is 20.75 deep); parkY / above: the
-- parked depth and the depth above which a piece counts as out; day: Day // Night's spot, x 0 and `edge + gap` towards
-- White and Red from the middle (the middle tile's edge at 0.75, the mats' gap |x| < 0.9, so at most `width` wide),
-- readable from that side
ENGINE_STATUS_FIT = { gap = 0.3, side = 0.3, matHalf = 10.375, parkY = -30, above = -20, day = { edge = 0.75, gap = 0.2, width = 1.5, rotY = 180 } }
engineStatusShown = {} -- object guid (or "day") -> how it is shown (spot, turn, size, count); nil while parked
engineStatusUnit = {}  -- object guid -> its footprint { x, z } at scale 1, read once (getBoundsNormalized)
-- the count a mark gives a piece: "" for the mark alone ("MONARCH"), "3" for "POISON 3"; nil when it isn't the piece's
function engineStatusMatch(mark, want)
  if mark == want then return "" end
  if mark:sub(1, #want + 1) == want .. " " then return mark:sub(#want + 2) end
  return nil
end
-- the object entry of piece p for seat `color` (its seat's own copy, or the one object)
function engineStatusObj(p, color)
  for _, e in ipairs(p.objs or {}) do if e.seat == nil or e.seat == color then return e end end
  return nil
end
-- every object the table moves, each piece's per seat and Day // Night, as one list (made once): { key (its name in
-- engineStatusShown), guids (Day // Night has one a state), fade, count, x / z (where it parks) }
function engineStatusList()
  if engineStatusItems == nil then
    engineStatusItems = {}
    for _, p in ipairs(type(ENGINE_STATUS_PIECES) == "table" and ENGINE_STATUS_PIECES or {}) do
      for _, e in ipairs(p.objs or {}) do
        engineStatusItems[#engineStatusItems + 1] = { key = e.g, guids = { e.g }, fade = p.fade, count = p.count, x = e.x, z = e.z }
      end
    end
    local d = ENGINE_DAY_NIGHT
    if type(d) == "table" then engineStatusItems[#engineStatusItems + 1] = { key = "day", guids = d.states, x = d.x, z = d.z } end
  end
  return engineStatusItems
end
function engineStatusObject(item)
  for _, g in ipairs(item.guids) do
    local o = getObjectFromGUID(g)
    if o ~= nil then return o end
  end
  return nil
end
-- an object's footprint { x, z } at scale 1, by GUID (nil when there is no such object)
function engineStatusFootprint(g, o)
  if engineStatusUnit[g] == nil then
    o = o or getObjectFromGUID(g)
    if o == nil then return nil end
    local b, s = o.getBoundsNormalized().size, o.getScale()
    engineStatusUnit[g] = { x = b.x / math.max(s.x, 0.01), z = b.z / math.max(s.z, 0.01) }
  end
  return engineStatusUnit[g]
end
-- parked: under the table at its own spot, locked, hidden as at opacity 0: invisible to every colour (what hides a
-- card) and, for a model or token, its tint's alpha 0; no count on it. Day // Night goes back to Day first, so the
-- saved table normally has Day on top (one swap, only when it is on Night)
function engineStatusPark(o, item)
  if item.key == "day" and o.getStateId() ~= 1 then o = o.setState(1) or o end
  o.setLock(true)
  o.setInvisibleTo(engineEveryone())
  if item.fade then local c = o.getColorTint() o.setColorTint({ c.r, c.g, c.b, 0 }) end
  o.clearButtons()
  o.setPosition({ item.x, ENGINE_STATUS_FIT.parkY, item.z })
  engineStatusShown[item.key] = nil
end
-- item's object put at w = { at, rotY, scale, count, state } (nil: parked), only when that differs from how it is
-- shown. From under the table it comes up at its spot while still hidden, then shows; from another mat it slides.
function engineStatusPut(o, item, w)
  local look = w and string.format("%.2f %.2f %.0f %.3f %s %s", w.at[1], w.at[3], w.rotY, w.scale[1], item.count and w.count or "", tostring(w.state))
  if engineStatusShown[item.key] == look then return end
  if w == nil then return engineStatusPark(o, item) end
  if w.state ~= nil and o.getStateId() ~= w.state then o = o.setState(w.state) or o end
  local wasOut = engineStatusShown[item.key] ~= nil
  o.setLock(true)
  o.setScale(w.scale)
  o.setRotation({ 0, w.rotY, 0 })
  if wasOut then o.setPositionSmooth(w.at, false, true) else o.setPosition(w.at) end
  if item.fade then local c = o.getColorTint() o.setColorTint({ c.r, c.g, c.b, 1 }) end
  o.setInvisibleTo({})
  if item.count then
    -- the count as the original token's script drew its 0: a shadow, then the number (labels only, no click area)
    o.clearButtons()
    for _, b in ipairs({ { { -0.1, 0.1, 0.3 }, { 0.1, 0.1, 0.1, 95 } }, { { 0, 0.15, 0.2 }, { 0.9, 0.9, 0.9, 100 } } }) do
      o.createButton({ click_function = "engineNoop", function_owner = Global, label = w.count, position = b[1], rotation = { 0, 0, 0 },
        width = 0, height = 0, scale = { 1.5, 1.5, 1.5 }, font_size = 800, font_color = b[2], color = { 0, 0, 0, 0 }, tooltip = "" })
    end
  end
  engineStatusShown[item.key] = look
end
-- where seat pl's pieces go: down the corner strip of their mat, centred across it, under their last marks box, in
-- ENGINE_STATUS_PIECES' order; each scaled down to the strip's width if wider. Written into want[guid].
function engineStatusPlace(want, o, pl)
  local marks = {}
  for _, m in ipairs(pl.allMarks) do marks[#marks + 1] = tostring(m) end
  local boxes = engineMarksBoxes(marks)
  if #boxes == 0 then return end
  local fitIn, fit = ENGINE_MARKS_FIT, ENGINE_STATUS_FIT
  -- (the tracker's button frame, as the boxes are drawn: local z of the last box's bottom edge; the strip's middle in
  -- button x, from the boxes' inner edge to the widest box's outer edge)
  local bottom = fitIn.top - fitIn.gap / fitIn.perLocal
  for _, b in ipairs(boxes) do bottom = bottom + (b.height + fitIn.gap) / fitIn.perLocal end
  local sign = engineMarksOutward(o)
  if sign == 0 then sign = 1 end
  local cx = sign * (fitIn.max / 2 - fitIn.inner) / fitIn.perLocal
  local p0, s = o.getPosition(), o.getScale()
  local a = math.rad(o.getRotation().y or 0)
  local room = fitIn.max / fitIn.perLocal * s.x - 2 * fit.side
  local g = seatGeometry(pl.color)
  local rotY = (g and g.rotY or (o.getRotation().y or 0)) % 360
  local top = bottom + fit.gap / s.z -- (local z of the next piece's top edge)
  -- the seat's pieces at the strip's width, and the depth they take with their gaps (world units)
  local list, need = {}, 0
  for _, p in ipairs(ENGINE_STATUS_PIECES) do
    local count = nil -- (= nil: TTS reads a bare local in a for-in body as the looped table, tests/test_moonsharp_loop_locals.js)
    for _, m in ipairs(marks) do count = count or engineStatusMatch(m, p.mark) end
    local e = count and engineStatusObj(p, pl.color)
    local unit = e and want[e.g] == nil and engineStatusFootprint(e.g)
    if unit then
      local k = math.min(1, room / math.max(unit.x * p.scale[1], 0.01))
      list[#list + 1] = { e = e, p = p, k = k, depth = unit.z * p.scale[3] * k, count = count }
      need = need + unit.z * p.scale[3] * k + fit.gap
    end
  end
  -- (all of them down to what is left of the strip before the mat's near edge, `matHalf` past its centre along its
  -- forward axis, less `side`: every piece at once ran off the mat)
  if g ~= nil and #list > 0 then
    local edge = g.mat + g.fwd * fit.matHalf
    local left = ((edge.x - p0.x) * math.sin(a) + (edge.z - p0.z) * math.cos(a)) - top * s.z - fit.side
    local gaps = fit.gap * (#list - 1)
    if need - fit.gap > left and left > gaps then
      local f = (left - gaps) / (need - fit.gap - gaps)
      for _, x in ipairs(list) do x.k, x.depth = x.k * f, x.depth * f end
    end
  end
  for _, x in ipairs(list) do
    local p, k = x.p, x.k
    local bz = top + x.depth / 2 / s.z
    -- (button x is drawn on the reader's right, world (-cos ry, sin ry); local z at (sin ry, cos ry))
    want[x.e.g] = { at = { p0.x + s.x * cx * -math.cos(a) + s.z * bz * math.sin(a), p.y, p0.z + s.x * cx * math.sin(a) + s.z * bz * math.cos(a) },
      rotY = rotY, scale = { p.scale[1] * k, p.scale[2], p.scale[3] * k }, count = x.count }
    top = top + (x.depth + fit.gap) / s.z
  end
end
-- Day // Night's spot for the engine's day or night (state 1 day, state 2 night; TTS gives a card's other state its own
-- GUID, so either is the card): want.day, nothing when it is neither
function engineStatusDayPlace(want, day)
  local d = ENGINE_DAY_NIGHT
  local state = (day == "day" and 1) or (day == "night" and 2) or nil
  if type(d) ~= "table" or state == nil then return end
  local o = getObjectFromGUID(d.states[1]) or getObjectFromGUID(d.states[2])
  local unit = o and engineStatusFootprint(o.getGUID(), o)
  if unit == nil then return end
  local fit = ENGINE_STATUS_FIT.day
  local k = math.min(1, fit.width / math.max(unit.x * d.scale[1], 0.01))
  want.day = { at = { 0, d.y, -(fit.edge + fit.gap + unit.z * d.scale[3] * k / 2) }, rotY = fit.rotY, scale = { d.scale[1] * k, d.scale[2], d.scale[3] * k }, state = state }
end
-- From each board (updateTrackers, beside the marks boxes): every piece to its holder's mat, or parked. A piece only
-- one player can have (the monarch, the initiative) goes to the first row that has it. Each seat's placing and each
-- piece's move runs in its own pcall: one that fails leaves the others to move or park.
function engineStatusPieces(m)
  if not ENGINE_MODE or type(ENGINE_STATUS_PIECES) ~= "table" then return end
  local want = {}
  for _, pl in ipairs(m.players or {}) do
    local o = getObjectFromGUID(LIFE_TRACKERS[pl.color or ""] or "")
    if o ~= nil and type(pl.allMarks) == "table" then pcall(engineStatusPlace, want, o, pl) end
  end
  pcall(engineStatusDayPlace, want, m.day)
  for _, item in ipairs(engineStatusList()) do
    pcall(engineStatusPutItem, item, want[item.key])
  end
end
function engineStatusPutItem(item, w)
  local o = (w ~= nil or engineStatusShown[item.key] ~= nil) and engineStatusObject(item)
  if o then engineStatusPut(o, item, w) end
end
-- Every piece back under the table. mode nil: all of them; "unplaced": those no board put out (on load); "strays":
-- those, when above the table (every 2 s while no game runs). One pcall a piece, as for the board.
function engineStatusParkAll(mode)
  for _, item in ipairs(engineStatusList()) do pcall(engineStatusParkItem, item, mode) end
end
function engineStatusParkItem(item, mode)
  local o = not (mode ~= nil and engineStatusShown[item.key] ~= nil) and engineStatusObject(item)
  if o and (mode ~= "strays" or o.getPosition().y > ENGINE_STATUS_FIT.above) then engineStatusPark(o, item) end
end
Wait.frames(function() pcall(engineStatusParkAll, "unplaced") end, 20)
Wait.time(function()
  local t = engineTable ~= nil and engineTable() or nil
  if t == nil or t.gameOver then pcall(engineStatusParkAll, "strays") end
end, 2, -1)
-- true while a player's open question has its own glow on the object (it gives the base glow back afterwards)
function engineGlowOwned(o)
  for _, set in pairs(engineGlowing or {}) do if set[o] then return true end end
  return false
end
engineStatic = {} -- engine card id -> fixed details (name, pictures, type line, text) the bridge sent once

-- Updates list cards as { id, tapped, counters, ..., s = 1 }; their fixed details come from engineStatic.
-- the bridge shortens picture links (bridge.js shortUrl): "" is the default card back, "kf"/"kb" + uuid a klrmngr picture
function engineExpandUrl(u)
  if type(u) ~= "string" then return u end
  if u == "" then return ENGINE_BACK end
  local side, id = u:match("^k([fb])(%x%x%x%x%x%x%x%x%-[%x%-]+)$")
  if side == nil then return u end
  return "https://img.klrmngr.com/display/" .. (side == "f" and "front" or "back") .. "/" .. id:sub(1, 1) .. "/" .. id:sub(2, 2) .. "/" .. id .. ".webp"
end
function engineFaceKey(c) return tostring(c.f) .. "|" .. tostring(c.b) end
function engineStoreStatic(id, st)
  st.f, st.b, st.o2 = engineExpandUrl(st.f), engineExpandUrl(st.b), engineExpandUrl(st.o2)
  local old = engineStatic[id]
  if old ~= nil and old.tx ~= nil and st.tx == nil then st.tx = old.tx end
  engineStatic[id] = st
end

local function mergeStatic(m)
  if m == nil then return end
  -- the restore points the bridge left out because they didn't change (keepRewind): the last board's
  if m.keepRewind then m.rewind = lastTable and lastTable.rewind or nil m.keepRewind = nil end
  -- zones the bridge left out because they didn't change: reuse the last board's (already merged) lists
  for _, pl in ipairs(m.players or {}) do
    if pl.keep ~= nil then
      local prev = nil
      for _, q in ipairs((lastTable and lastTable.players) or {}) do if q.color == pl.color then prev = q end end
      for _, z in ipairs(pl.keep) do pl[z] = prev and prev[z] or {} end
      pl.keep = nil
    end
  end
  local fresh = {}
  for id, st in pairs(m.cards or {}) do engineStoreStatic(id, st) fresh[id] = true end
  m.cards = nil
  for _, pl in ipairs(m.players or {}) do
    -- ("playable" too: cards you may play from exile or a graveyard lay as card backs without it, playtest 2026-10-26;
    -- "revealed", the hand cards shown to everyone: engineRevealStrip; and "ctlHand", a controlled player's hand:
    -- engineCtlHands. The bridge's ZONE_KEYS, every list it slims)
    for _, z in ipairs({ "hand", "battlefield", "graveyard", "exile", "command", "playable", "revealed", "ctlHand" }) do
      for _, c in ipairs(pl[z] or {}) do
        if c.s ~= nil then
          local st = engineStatic[c.id] or {}
          for k, v in pairs(st) do if c[k] == nil then c[k] = v end end
          c.s = nil
        elseif fresh[c.id] then
          -- (details sent again for a card in a zone kept from the last board: a token's picture found after it was
          -- drawn as a card back never reached it, hp-12 re-test 2026-10-27)
          for k, v in pairs(engineStatic[c.id]) do c[k] = v end
        end
      end
    end
  end
  -- (the planes in play, Planechase: slimmed the same way, sent with every board)
  for _, c in ipairs(m.planes or {}) do
    if c.s ~= nil then
      for k, v in pairs(engineStatic[c.id] or {}) do if c[k] == nil then c[k] = v end end
      c.s = nil
    end
  end
end

-- Rules texts arrive after the cards (in small messages): store them, fill them into the current board and update
-- the hover text of cards already on the table.
function engineOnTexts(m)
  local t = m.texts or {}
  for id, tx in pairs(t) do
    if engineStatic[id] ~= nil then engineStatic[id].tx = tx end
  end
  for _, pl in ipairs((lastTable and lastTable.players) or {}) do
    for _, z in ipairs({ "hand", "battlefield", "graveyard", "exile", "command" }) do
      for _, c in ipairs(pl[z] or {}) do
        if t[c.id] ~= nil then
          c.tx = t[c.id]
          local o = engineObjs[c.id]
          if o ~= nil and not o.isDestroyed() then o.setDescription(description(c)) end
        end
      end
    end
  end
end

-- An option's words on its own card (its buttons, its menu): the ability alone. The bridge sends it as "ab"; for an
-- older message the card's name in front of the label is cut off (structural review 2026-10-27: this was done twice).
function engineAbilityText(o)
  if o.ab ~= nil then return tostring(o.ab) end
  local label = tostring(o.label or "")
  local own = tostring((engineStatic[o.cardId] or {}).n or "")
  if own ~= "" and label:sub(1, #own + 2) == own .. ": " then label = label:sub(#own + 3) end
  return (label:gsub("^Activate [^:]*: ", ""))
end
-- A question that wants exactly one pick: the click answers it (engineConfirmIfComplete), so the corner counts instead
-- of offering Done and the instruction says so. One rule for the table, the row's pictures and its buttons (structural
-- review 2026-10-27). A pick of 2 or more keeps Done: the second click answering made a misclick final (suite review).
function engineExactPick(p)
  return p ~= nil and p.min == p.max and tonumber(p.max) == 1
end
-- Cuts text to at most n bytes without splitting a character: Lua counts bytes, and a cut in the middle of "—" or "…"
-- left a broken character (and crashed the headless test table's JSON, 2026-10-22). A character the cut would split
-- is left out whole.
function engineCut(text, n)
  text = tostring(text or "")
  if #text <= n then return text end
  local cut = text:sub(1, n)
  local i = #cut
  while i > 0 and cut:byte(i) >= 128 and cut:byte(i) < 192 do i = i - 1 end -- back to the last character's first byte
  if i > 0 then
    local b = cut:byte(i)
    local need = (b >= 240 and 4) or (b >= 224 and 3) or (b >= 192 and 2) or 1
    if #cut - i + 1 < need then cut = cut:sub(1, i - 1) end
  end
  return cut
end
-- A card picture the screen UI can draw, for every player. TTS's screen UI can't draw .webp, and Scryfall's CDN refuses
-- TTS's downloader by its user-agent (HTTP 400): both left pictures white. The bridge's own route on this PC reached
-- only the host: the other players saw grey tiles with names (playtest 2026-10-23). wsrv.nl, a public image proxy,
-- fetches Scryfall's jpg for every player's TTS. Any other picture (the card back, a custom image) is used as it is.
-- A panel picture: the card back first, then the card. A picture that loads slowly, or not at all, left the previous
-- card's picture showing under the new card's name (playtest 2026-10-26: "Sacrifice Evolving Wilds?" showed Uro, Chord's
-- question showed Tenacious Underdog). The back shows until the new one arrives.
-- TTS draws whichever download ends last, not the newest set: a picture asked for moments earlier and still loading
-- (the AI's Relentless Rats) replaced the next one (Consuming Sepulcher's trigger) when it arrived. The wanted picture
-- is set again after such a load can have ended; the same link set again is drawn at once (hp-12 re-test 2026-10-27).
engineImgWant = {} -- UI element id -> the picture it should show
function engineSetImage(id, url)
  if engineImgWant[id] == url then return end
  engineImgWant[id] = url
  UI.setAttribute(id, "image", engineUiImage(ENGINE_BACK))
  local function again() if engineImgWant[id] == url then UI.setAttribute(id, "image", url) end end
  Wait.frames(again, 2)
  Wait.time(again, 3)
  Wait.time(again, 8)
end
function engineUiImage(u)
  u = engineExpandUrl(u) or ENGINE_BACK
  return (u:gsub("^https://img%.klrmngr%.com/display/(%a+)/(%x)/(%x)/([%x%-]+)%.webp$", "https://wsrv.nl/?url=cards.scryfall.io/normal/%1/%2/%3/%4.jpg"))
end

-- Shows the newest spell or ability put on the stack (once per stack item), for 8.5 seconds.
local popSeen = {}
local popToken = 0
popShown = nil -- { id, at, token } of the stack item the pop-up shows
-- Its X closes it for that player only (TTS shows a UI element to the colours in its "visibility"); the next card
-- that pops up shows to everyone again.
enginePopClosed = {}
do
  local POP_COLOURS = { "White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Grey", "Black" }
  local function popVisibility()
    local v = {}
    for _, c in ipairs(POP_COLOURS) do if not enginePopClosed[c] and not engineEffectsOff[c] then v[#v + 1] = c end end
    -- (an empty list would show it to everyone)
    if #v == 0 then UI.setAttribute("eng_pop", "active", "false") else UI.setAttribute("eng_pop", "visibility", table.concat(v, "|")) end
  end
  local popXFlip = false
  function enginePopOpen()
    enginePopClosed = {}
    popVisibility()
    UI.setAttribute("eng_pop", "active", "true")
    -- (showing a button again draws its label dark unless its text colour changes: see nextWhite)
    popXFlip = not popXFlip
    UI.setAttribute("eng_pop_x", "textColor", popXFlip and "#FFFFFF" or "#FEFEFE")
  end
  function enginePopRefresh() popVisibility() end
  function onMtgPopClose(player)
    enginePopClosed[player.color] = true
    popVisibility()
  end
end

-- ───────── M5: target, attack and block lines (Arena draws these; on a 4-player table "at whom?" matters more) ─────────
-- One arc per target of a stack item (cyan, from the spell on the stack or an ability's source card to the card, the
-- player's life counter or the other spell), per attacker (red-pink, to the player's life counter or the planeswalker
-- / battle) and per block (gold, blocker to attacker). Global vector lines are shared with what players draw by
-- hand: ours are told apart by their exact thickness and only ours are replaced.
do -- (its own scope, as the setup buttons below: the main chunk is at standard Lua's 200-locals limit)
local LINE_STYLE = { target = { color = {0.35, 0.85, 1}, thickness = 0.3001 }, attack = { color = {1, 0.32, 0.4}, thickness = 0.2201 },
  block = { color = {1, 0.8, 0.25}, thickness = 0.1601 } }
local linesSig = ""
local function isOurLine(l)
  for _, st in pairs(LINE_STYLE) do if math.abs((tonumber(l.thickness) or 0) - st.thickness) < 0.00005 then return true end end
  return false
end
function engineIsAttackLine(l) return math.abs((tonumber(l.thickness) or 0) - LINE_STYLE.attack.thickness) < 0.00005 end
local function lifeSpot(color)
  local o = LIFE_TRACKERS[color] and getObjectFromGUID(LIFE_TRACKERS[color])
  if o ~= nil then return o.getPosition() end
  local g = seatGeometry(color)
  return g and g.mat or nil
end
-- Where a player is aimed at: their life counter, the heart clicked to attack or target them. Attack lines, spell/ability
-- target lines, the attack lunge and a burst at a player. (It was the back centre of their board, behind the land row,
-- 2026-10-22; with the land row moved down the mat that spot was its bottom edge, and Craw Wurm's line at White read
-- as aimed at White's lands, live game 2026-11-11.)
local function playerSpot(color)
  return lifeSpot(color)
end
enginePlayerSpot = playerSpot -- (the table effects' burst for damage to a player lands here too)
local function cardSpot(id)
  if enginePlanned[id] ~= nil then return enginePlanned[id] end -- where it is going (it may still be moving)
  local o = engineObjs[id]
  if o ~= nil and not o.isDestroyed() then return o.getPosition() end
  -- (a token drawn in a stack: the stack's card)
  local rep = engineGroupOf[id]
  if rep ~= nil and rep ~= id then return cardSpot(rep) end
  return nil
end
-- a raised arc from a to b, 11 points
local function arc(a, b, lift)
  local d = math.sqrt((b.x - a.x) ^ 2 + (b.z - a.z) ^ 2)
  local h = lift or (0.5 + d * 0.12)
  local pts = {}
  for i = 0, 10 do
    local t = i / 10
    pts[#pts + 1] = { a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + 0.3 + 4 * h * t * (1 - t), a.z + (b.z - a.z) * t }
  end
  return pts
end
-- Attack lunge (the player, 2026-10-22, as in Arena): when combat damage is dealt, each attacking card swings all of
-- the way into what it hits (its blocker, the planeswalker or battle, or the back centre of the defending player's
-- board, Arena's player portrait) and back.
-- Plain object movement, no AssetBundle. The attackers and their blockers are remembered from the combat steps
-- before damage (the damage board may already have them gone); one lunge per combat. A creature that died in the
-- damage is gone from the table before it could swing (its graveyard flash shows instead).
engineAnimUntil = {} -- engine card id -> os.clock() until which place() leaves it alone
local lunge = { atk = {}, turn = nil, done = nil }
local DAMAGE_STEPS = { combatFirstStrikeDamage = true, combatDamage = true, combatEnd = true }
-- Arena's swing (reference video hOY2wZcuMJk 12:11): a wind-up (the card lifts and pulls back a little), the hit (it
-- lands right on its target, overlapping it), then back to its spot
-- Several attackers swing one after another, each swing quick (2026-10-24: "make the multi hit attack one at a time
-- but make it faster per hit"; before that they all swung at once, first fast, then at half speed): LUNGE_STEP apart,
-- each one LUNGE_WIND into its wind-up and back home LUNGE_OUT after it starts.
local LUNGE_REACH, LUNGE_LIFT, LUNGE_BACK, LUNGE_WIND, LUNGE_OUT, LUNGE_STEP = 0.92, 0.9, 0.8, 0.15, 0.45, 0.6
function engineCombatLunge(m)
  if m == nil then lunge.atk, lunge.turn, lunge.done = {}, nil, nil return end
  local turn = tostring(m.turn)
  local atk = {}
  for _, pl in ipairs(m.players or {}) do
    for _, c in ipairs(pl.battlefield or {}) do if c.atk then atk[c.id] = { atkT = c.atkT } end end
  end
  for _, pl in ipairs(m.players or {}) do
    for _, c in ipairs(pl.battlefield or {}) do
      for _, a in ipairs(c.blkOf or {}) do if atk[a] ~= nil and atk[a].blocker == nil then atk[a].blocker = c.id end end
    end
  end
  if next(atk) ~= nil and not DAMAGE_STEPS[tostring(m.step)] then lunge.atk, lunge.turn = atk, turn end
  if not DAMAGE_STEPS[tostring(m.step)] or lunge.turn ~= turn or lunge.done == turn then return 0 end
  lunge.done = turn
  -- (when each swing lands, os.clock(): its target's id or colour, and a blocked attacker's own id; the table effects
  -- time their impacts with it, for this board only)
  engineLungeHits = { board = m }
  local n = 0
  local order = {}
  for id in pairs(lunge.atk) do order[#order + 1] = id end
  table.sort(order)
  for _, id in ipairs(order) do
    local a = lunge.atk[id]
    local o = engineObjs[id]
    local to = (a.blocker and cardSpot(a.blocker)) or (a.atkT ~= nil and (LIFE_TRACKERS[a.atkT] ~= nil and playerSpot(a.atkT) or cardSpot(a.atkT))) or nil
    if o ~= nil and not o.isDestroyed() and to ~= nil then
      local from = enginePlanned[id] or o.getPosition()
      local dx, dz = to.x - from.x, to.z - from.z
      local len = math.max(0.001, math.sqrt(dx * dx + dz * dz))
      local wind = Vector(from.x - dx / len * LUNGE_BACK, from.y + LUNGE_LIFT, from.z - dz / len * LUNGE_BACK)
      local hit = Vector(from.x + dx * LUNGE_REACH, from.y + LUNGE_LIFT, from.z + dz * LUNGE_REACH)
      local at = n * LUNGE_STEP
      engineAnimUntil[id] = os.clock() + at + LUNGE_OUT + 0.6
      local hitAt, tgt = os.clock() + at + LUNGE_WIND, a.blocker or a.atkT
      if engineLungeHits[tgt] == nil or hitAt < engineLungeHits[tgt] then engineLungeHits[tgt] = hitAt end
      if a.blocker ~= nil and (engineLungeHits[id] == nil or hitAt < engineLungeHits[id]) then engineLungeHits[id] = hitAt end
      local go = function(to2) if o ~= nil and not o.isDestroyed() then o.setPositionSmooth(to2, false, true) end end
      if at > 0 then Wait.time(function() go(wind) end, at) else go(wind) end
      Wait.time(function() go(hit) end, at + LUNGE_WIND)
      Wait.time(function() go(enginePlanned[id] or from) end, at + LUNGE_OUT)
      n = n + 1
    end
  end
  return n
end
function engineDrawLines(m, stackSpot)
  if m ~= nil and m.gameOver then m = nil end -- (the game is over: no attack or target lines stay on the table)
  local ours = {}
  local drawn = {} -- (one line per pair of spots: twenty tokens in one stack attacking one player are one line)
  local function add(a, b, style, lift)
    if a == nil or b == nil then return end
    local key = string.format("%.2f,%.2f,%.2f,%.2f,%.4f", a.x, a.z, b.x, b.z, style.thickness)
    if drawn[key] then return end
    drawn[key] = true
    ours[#ours + 1] = { points = arc(a, b, lift), color = style.color, thickness = style.thickness }
  end
  if m ~= nil then
    engineLinesSpot = stackSpot -- (for the block lines a question's clicks draw: engineQuestionBlocks)
    -- the blocks picked in an open blockers question, and an answered one's until the next board (token stacks spec:
    -- "a block shows only a blue outline on the blocker: there is no line to the attacker it blocks")
    for _, pair in ipairs(engineQuestionBlocks ~= nil and engineQuestionBlocks() or {}) do add(cardSpot(pair[1]), cardSpot(pair[2]), LINE_STYLE.block, 0.3) end
    for _, s in ipairs(m.stack or {}) do
      for _, t in ipairs(s.tg or {}) do
        local to = nil
        if t.k == "p" then to = playerSpot(t.c) elseif t.k == "s" then to = stackSpot and stackSpot[t.id] else to = cardSpot(t.id) end
        add(stackSpot and stackSpot[s.id], to, LINE_STYLE.target)
      end
    end
    for _, pl in ipairs(m.players or {}) do
      for _, c in ipairs(pl.battlefield or {}) do
        if c.atk and c.atkT ~= nil then
          add(cardSpot(c.id), LIFE_TRACKERS[c.atkT] ~= nil and playerSpot(c.atkT) or cardSpot(c.atkT), LINE_STYLE.attack, 0.5)
        end
        for _, a in ipairs(c.blkOf or {}) do add(cardSpot(c.id), cardSpot(a), LINE_STYLE.block, 0.3) end
      end
    end
  end
  -- only when they changed (setVectorLines redraws for everyone and goes into the save)
  local parts = {}
  for _, l in ipairs(ours) do
    local a, b = l.points[1], l.points[#l.points]
    parts[#parts + 1] = string.format("%.4f:%.1f,%.1f,%.1f,%.1f", l.thickness, a[1], a[3], b[1], b[3])
  end
  local sig = table.concat(parts, ";")
  if sig == linesSig then return end
  linesSig = sig
  local keep = {}
  for _, l in ipairs(Global.getVectorLines() or {}) do if not isOurLine(l) then keep[#keep + 1] = l end end
  for _, l in ipairs(ours) do keep[#keep + 1] = l end
  Global.setVectorLines(keep)
end
end
function enginePopups(m)
  local newest
  local now = {}
  for _, st in ipairs(m.stack or {}) do
    now[st.id] = true
    if not popSeen[st.id] then newest = st end
  end
  popSeen = now
  if newest == nil or not panelReadyForPopup() then return end
  local stc = newest.src and engineStatic[newest.src] or nil
  local img = engineUiImage(newest.f or (stc and stc.f) or ENGINE_BACK)
  local who = newest.ctl and (" - " .. tostring(newest.ctl)) or ""
  -- the engine starts with "Ponder (18) - ": cut up to the first "(n) - " near the start ("^.-" on a long text made
  -- MoonSharp fail with "pattern too complex", which also stopped the rest of that table update)
  local text = tostring(newest.tx or "")
  local _, cut = text:sub(1, 120):find("%(%d+%) %- ")
  if cut ~= nil then text = text:sub(cut + 1) end
  engineSetImage("eng_pop_img", img)
  UI.setValue("eng_pop_who", tostring(newest.n) .. who)
  UI.setValue("eng_pop_text", engineCut(text, 260))
  enginePopOpen()
  popToken = popToken + 1
  popShown = { id = newest.id, at = os.clock(), token = popToken }
end
-- The pop-up stays while what it shows is on the stack (Arena keeps the stack in view), at least POP_MIN seconds so
-- a quick resolve can still be read. Called with every board update, after enginePopups.
POP_MIN = 2.5
function enginePopupsClose(m)
  local shown = popShown
  if shown == nil then return end
  for _, st in ipairs(m.stack or {}) do if st.id == shown.id then return end end
  popShown = nil
  local left = POP_MIN - (os.clock() - shown.at)
  local hide = function() if popToken == shown.token then UI.setAttribute("eng_pop", "active", "false") end end
  if left > 0 then Wait.time(hide, left) else hide() end
end

-- ───────── M5 (2026-10-22): knock-outs, VICTORY / DEFEAT, deaths, countered spells ─────────
-- With the table's own UI and highlights (no AssetBundle yet; docs/m5-plan.md). Called with every board update after
-- the pop-ups. Short, never in the way, Arena's colours: violet for death, red for knocked out / countered, gold for
-- victory. "mtg effects off" turns a player's big banners off (engineEffectsOff); world highlights are for everyone.
engineEffectsOff = {}
do
  -- (step 4, the table effects, docs/m5-effects-design.md: seven panels of Object UI on a life counter, moved to where
  -- something happened and switched on and off; nothing is spawned. UNIT, AX, AY, ROT0, LIFT and CARD are to be
  -- calibrated on the real table with engineFxTest; AX = 1 was measured on the real table 2026-11-06 (with -1 an
  -- effect at Red's seat drew on White's mat), the rest looked right there. SHOW = true plays the Grow / FadeOut tweens with UI.show, which
  -- ignores visibility: then "mtg effects off" can't hide them from one player.)
  local FX = { prev = nil, dimmed = {}, VIOLET = { 0.62, 0.25, 0.95 }, OUT = { 0.38, 0.38, 0.42 },
    slotUntil = {}, slotOn = {}, slotText = {}, gen = 0, built = false, jumpNext = false, sndAt = {}, sndLast = -100,
    UNIT = 100, AX = 1, AY = 1, ROT0 = 180, LIFT = 0.7, CARD = 2.2, SHOW = false, SLOTS = 6, PER_BOARD = 6, MAX_RINGS = 4, MAX_HITS = 4,
    COLOURS = { "White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Grey", "Black" },
    SOUND_OF = { knockout = "knockout", death = "death", wave = "death", player = "playerhit", damage = "damage", counter = "counter", countered = "countered" },
    WIPE = 3, BURST_MAX = 8, BIG_HIT = 5 }
  local TRACK = { White = "23e485", Red = "448880", Yellow = "37e533", Blue = "395037" }
  -- the carrier of the effect panels: White's life counter, else the first other one there is
  function FX.carrier()
    for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do
      local o = getObjectFromGUID(TRACK[c] or "")
      if o ~= nil and not o.isDestroyed() then return o end
    end
    return nil
  end
  -- pictures only once all three links are set (engineFxArt); until then a coloured "●" stands in
  function FX.hasArt()
    local a = engineFxArt or {}
    for _, k in ipairs({ "burst", "smoke", "ring" }) do if type(a[k]) ~= "string" or a[k] == "" then return false end end
    return true
  end
  function FX.slotXml(id, art)
    local pic = art and ('<Image id="' .. id .. '_img" image="fx_burst" color="#FFFFFFE6" preserveAspect="true" raycastTarget="false"/>')
      or ('<Text id="' .. id .. '_img" fontSize="200" color="#FFFFFFE6" alignment="MiddleCenter" raycastTarget="false">●</Text>')
    return '<Panel id="' .. id .. '" active="false" raycastTarget="false" width="220" height="220" position="0 0 -70" showAnimation="Grow" hideAnimation="FadeOut" animationDuration="0.15">'
      .. pic .. '<Text id="' .. id .. '_txt" fontSize="90" fontStyle="Bold" color="#FFFFFF" outline="#000000C0" outlineSize="3 -3" alignment="MiddleCenter" raycastTarget="false"> </Text></Panel>'
  end
  -- once per game at most (the first board): the pool goes on the carrier unless it is already there (it stays in
  -- the save, inactive). A marker panel says which kind of pool it is, so setting the picture links rebuilds it once.
  -- FX.built is set only once the rigs were looked for and the pool is in place: anything raising before that leaves
  -- it unset, so the next board tries again instead of running with no pool (a bundle spawn that fails doesn't raise:
  -- FX.spawnBundle catches it and the effects use the pool's slots).
  function FX.build()
    FX.findRigs() -- (the effect bundle's rigs: once a game too)
    local o = FX.carrier()
    FX.car = o
    if o == nil then FX.built = true return end
    local art = FX.hasArt()
    FX.art = art
    local want = art and "eng_fx_pool_art" or "eng_fx_pool_dots"
    local xml = tostring(o.UI.getXml() or "")
    if xml:find('id="' .. want .. '"', 1, true) then FX.built = true return end
    -- (an older pool goes: everything from its marker on is ours; a pool without a marker means the XML is all ours)
    local cut = xml:find('<Panel id="eng_fx_pool_', 1, true)
    if cut ~= nil then xml = xml:sub(1, cut - 1) elseif xml:find("eng_fx_", 1, true) then xml = "" end
    local parts = { xml, '<Panel id="' .. want .. '" active="false" raycastTarget="false"></Panel>' }
    for i = 1, FX.SLOTS do parts[#parts + 1] = FX.slotXml("eng_fx_" .. i, art) end
    parts[#parts + 1] = FX.slotXml("eng_fx_ko", art)
    if art then
      local a = engineFxArt
      pcall(o.UI.setCustomAssets, { { name = "fx_burst", url = a.burst }, { name = "fx_smoke", url = a.smoke }, { name = "fx_ring", url = a.ring } })
    end
    o.UI.setXml(table.concat(parts))
    FX.slotOn, FX.slotText = {}, {}
    FX.built = true
  end
  -- who sees the panels: every colour but those who turned their effects off (an empty list would mean everyone)
  function FX.viewers()
    local v = {}
    for _, c in ipairs(FX.COLOURS) do if not engineEffectsOff[c] then v[#v + 1] = c end end
    return v
  end
  -- anything to show at all: the host's table animations on and a seated player with effects on
  function FX.visualsOn()
    if engineAnimOff then return false end
    for _, c in ipairs(getSeatedPlayers()) do if not engineEffectsOff[c] then return true end end
    return false
  end
  function FX.toggle(id, on)
    local o = FX.car
    FX.slotOn[id] = on or nil
    if o == nil or o.isDestroyed() then return end
    if FX.SHOW then if on then o.UI.show(id) else o.UI.hide(id) end
    else o.UI.setAttribute(id, "active", on and "true" or "false") end
  end
  -- one picture of an effect: which one, its colour and its size in card widths (one UI call). (The "●" stand-in's
  -- font stays inside its box: TTS draws no text taller than its box, and at 1.3x the dot never showed, 2026-11-06.)
  function FX.pic(id, ph, s)
    local w, h = math.floor(ph.size * FX.CARD * FX.UNIT / s.x), math.floor(ph.size * FX.CARD * FX.UNIT / s.z)
    if FX.art then FX.car.UI.setAttributes(id .. "_img", { image = "fx_" .. ph.img, color = ph.col, width = w, height = h })
    else FX.car.UI.setAttributes(id .. "_img", { color = ph.col, fontSize = math.floor(math.min(w, h) * 0.85), width = w, height = h }) end
  end
  -- one effect in one slot, `delay` seconds from now. e: { spot, seat, phases = { { t, img, col, size }, ... }, stop,
  -- text, textCol }. The panel is moved, sized and shown in one call; each later picture is one call; off is one.
  function FX.start(id, e, delay)
    local o, gen = FX.car, FX.gen
    local s = o.getScale()
    local big = 0
    for _, ph in ipairs(e.phases) do big = math.max(big, ph.size) end
    local function step(k)
      if FX.gen ~= gen or o.isDestroyed() then return end
      if k > 1 then FX.pic(id, e.phases[k], s) return end
      local l = o.positionToLocal(e.spot)
      local g = e.seat and seatGeometry(e.seat)
      local attrs = { position = string.format("%.0f %.0f %.0f", FX.AX * l.x * FX.UNIT, FX.AY * l.z * FX.UNIT, -FX.LIFT * FX.UNIT / s.y),
        width = math.floor(big * FX.CARD * FX.UNIT / s.x), height = math.floor(big * FX.CARD * FX.UNIT / s.z),
        rotation = string.format("0 0 %.0f", FX.ROT0 + (g and g.rotY or 0) - o.getRotation().y),
        visibility = table.concat(FX.viewers(), "|") } -- (read now: a player who turned effects off since is left out)
      if not FX.SHOW then attrs.active = "true" end
      o.UI.setAttributes(id, attrs)
      local txt, col = e.text or " ", e.textCol or "#FFFFFF"
      if FX.slotText[id] ~= txt .. col then FX.slotText[id] = txt .. col o.UI.setAttributes(id .. "_txt", { text = txt, color = col }) end
      FX.pic(id, e.phases[1], s)
      if FX.SHOW then o.UI.show(id) end
      FX.slotOn[id] = true
    end
    for k, ph in ipairs(e.phases) do
      if delay + ph.t <= 0 then step(k) else Wait.time(function() step(k) end, delay + ph.t) end
    end
    Wait.time(function() if FX.gen == gen then FX.toggle(id, false) end end, delay + e.stop)
  end
  -- a free slot: "ko" (knock-outs only) or 1..SLOTS; busy until the effect in it has ended (never reused early)
  function FX.slot(ko)
    local now = os.clock()
    if ko and now >= (FX.slotUntil.ko or 0) then return "ko" end
    for i = 1, FX.SLOTS do if now >= (FX.slotUntil[i] or 0) then return i end end
    return nil
  end
  -- what each kind looks like (design section 4)
  function FX.look(e)
    if e.kind == "death" then
      return { phases = { { t = 0, img = "burst", col = "#FFFFFFE6", size = e.wipe and 1.5 or 1.0 }, { t = 0.15, img = "smoke", col = "#3D1A5CDD", size = e.wipe and 2.2 or 1.5 } },
        stop = 0.9, text = e.wipe and ("×" .. e.n) or nil }
    elseif e.kind == "counter" then
      return { phases = { { t = 0, img = "ring", col = e.m1 and "#9A7ACCE6" or "#A8D8FFE6", size = 1.1 } }, stop = 0.5 }
    elseif e.kind == "damage" then
      return { phases = { { t = 0, img = "burst", col = "#FFB050E6", size = 1.2 } }, stop = 0.35, text = "−" .. e.n, textCol = "#FF4A3A" }
    elseif e.kind == "player" then
      return { phases = { { t = 0, img = "burst", col = "#FF9A40E6", size = 2.0 } }, stop = 0.45 }
    end
    return { phases = { { t = 0.6, img = "burst", col = "#FFF2D0F0", size = 3 }, { t = 0.8, img = "smoke", col = "#C8401AD0", size = 4 } }, stop = 1.5 }
  end
  -- a life counter's red flash (seen by everyone; not while a question has it lit as a target)
  function FX.glowLife(c, rgb, len, delay)
    local life = getObjectFromGUID(TRACK[c] or "")
    if life == nil or engineGlowOwned(life) then return end
    local gen = FX.gen
    local go = function() if FX.gen == gen and not life.isDestroyed() and not engineGlowOwned(life) then life.highlightOn(rgb, len) end end
    if delay > 0 then Wait.time(go, delay) else go() end
  end
  -- ── the effect bundle (step 4's particles, docs/m5-assetbundle-build.md) ──
  -- Rigs: copies of one AssetBundle whose GM notes are "engine:fx", parked under the table in the save (nothing is
  -- spawned: destruct costs ~360 ms here). For an effect, a free rig is moved to the spot and plays the trigger effect of
  -- that name (AssetBundle.playTriggerEffect, the index from getTriggerEffects), then goes back under the table. No rig,
  -- none free, or no effect of that name in the bundle: the Object UI slot as before. Particles are seen by everyone;
  -- a player with "mtg effects off" gets the rig made invisible to them (setInvisibleTo: whether that hides particles
  -- is the build doc's two-client test). RIG_NAME: our kind -> the trigger effect's name in the bundle; RIG_ELSE: the
  -- kind whose effect stands in when the bundle lacks one; RIG_LEN: how long each plays (s); RIG_AT: its start after
  -- the event (the knock-out's burst and sound are 0.6 s in); RIG_LEAD: the least time between the move and the
  -- trigger; RIG_TAIL: time for the last particles to fade before the rig goes back; RIG_LIFT: above the spot.
  -- (2026-11-12, docs/particle-fx-spec.md: burn, the death from damage, falling back to death; wave, the coloured
  -- board-wide sweep of a wipe, which has no stand-in: without it a wipe is the old cloud)
  FX.RIG_NAME = { death = "death", wipe = "death_wipe", exile = "exile", countered = "countered", damage = "damage",
    player = "player_hit", counter = "counter", counter_minus = "counter_minus", lifegain = "lifegain", knockout = "knockout",
    burn = "death_burn" }
  FX.RIG_ELSE = { wipe = "death", player = "damage", counter_minus = "counter", burn = "death" }
  FX.RIG_LEN = { death = 1.0, wipe = 1.5, exile = 1.0, countered = 1.5, damage = 0.4, player = 0.5, counter = 0.6,
    counter_minus = 0.6, lifegain = 1.0, knockout = 1.5, burn = 1.0, wave = 0.6 }
  FX.RIG_AT = { knockout = 0.6 }
  FX.RIG_LEAD, FX.RIG_TAIL, FX.RIG_LIFT, FX.RIG_PARK_Y = 0.1, 0.6, 0.3, -30
  -- The wipe (3 or more permanents to graveyards or exile on one board, FX.WIPE): one wave from the caster's side
  -- (WAVE_BACK behind the middle of their playmat, toward their edge, local +z toward the table's centre, scaled by
  -- WAVE_SCALE: at 1 the band is one seat wide and sweeps 17 units), in the cause's colour (WAVE_KEY when none is
  -- known); then each card's own small death or exile, WIPE_FIRST after the wave and WIPE_STEP apart in the order the
  -- wave reaches them, WIPE_DRAW at most (and only while a rig is free). TINT: the colour a neutral effect is tinted
  -- with (engineFxTint), per key. All to be tuned on the real table.
  FX.WIPE_DRAW, FX.WIPE_FIRST, FX.WIPE_STEP, FX.WAVE_SCALE, FX.WAVE_BACK, FX.WAVE_KEY = 8, 0.15, 0.12, 2, 6, "B"
  FX.TINT = { W = { 0.95, 0.82, 0.48 }, U = { 0.56, 0.84, 1 }, B = { 0.67, 0.44, 0.99 }, R = { 1, 0.48, 0.23 },
    G = { 0.56, 0.89, 0.42 }, C = { 0.82, 0.83, 0.86 }, M = { 0.91, 0.76, 0.35 } }
  -- The bolts (the mtg-bolt bundle's rigs): MAX_BOLTS a board, BOLT_STEP apart; each hits BOLT_HIT after it plays
  -- (the head's flight), plays BOLT_LEN; an exile's light leaves FLIGHT_AT after the exile starts. The fallback
  -- (engineFxBoltMove) moves the rig over BOLT_FRAMES frames instead.
  FX.MAX_BOLTS, FX.BOLT_STEP, FX.BOLT_HIT, FX.BOLT_LEN, FX.FLIGHT_AT, FX.BOLT_FRAMES = 4, 0.15, 0.25, 0.6, 0.7, 15
  FX.atan2 = math.atan2 or math.atan -- (Lua 5.2's two-argument arc tangent; 5.3's math.atan takes both)
  -- the rigs, looked for once a game (FX.build) and by engineFxTest: every "engine:fx" object with an AssetBundle, and
  -- every "engine:bolt" one (the bolt bundle's). One found above the table (a reload cut its effect short) goes back
  -- under it, at scale 1 and untinted. The same look finds the sound object. Fewer than FX.RIGS (FX.BOLTS) and a link
  -- in engineFxBundle.fx (.bolt): the missing ones are spawned, once per load ("mtg fx off": none); one sound object.
  FX.RIGS, FX.BOLTS = 6, 4
  function FX.addRig(o, bolt)
    local p = o.getPosition()
    local home = p
    if p.y > FX.RIG_PARK_Y / 2 then home = Vector(p.x, FX.RIG_PARK_Y, p.z) o.setPosition(home) end
    o.interactable = false -- (over a card for a second: it mustn't take the clicks meant for the card)
    local s, c = o.getScale(), o.getColorTint()
    if s ~= nil and math.abs(s.x - 1) > 0.001 then o.setScale(Vector(1, 1, 1)) end
    if c ~= nil and (c.r or 1) + (c.g or 1) + (c.b or 1) < 2.99 then o.setColorTint({ 1, 1, 1 }) end
    local list = bolt and FX.bolts or FX.rigs
    list[#list + 1] = { o = o, home = home, busy = 0, use = 0, scale = 1 }
  end
  function FX.findRigs()
    FX.rigs, FX.rigIdx, FX.bolts, FX.boltIdx = {}, nil, {}, nil
    local snd = nil
    for _, o in ipairs(getObjects()) do
      local gm = o.getGMNotes()
      if gm == "engine:fx" then FX.addRig(o)
      elseif gm == "engine:bolt" then FX.addRig(o, true)
      elseif gm == "engine:sounds" then snd = o end
    end
    if snd ~= nil and FX.sndObj ~= snd then FX.sndObj, FX.sndIdx = snd, nil end
    local links = engineFxBundle or {}
    if engineFxMode ~= "off" then
      FX.topUp(links.fx, "engine:fx", FX.rigs, FX.RIGS, "spawnedFx", 0)
      FX.topUp(links.bolt, "engine:bolt", FX.bolts, FX.BOLTS, "spawnedBolt", 2)
    end
    if snd == nil and FX.bundleLink(links.sounds) and not FX.spawnedSnd then
      FX.spawnedSnd = FX.spawnBundle(links.sounds, "engine:sounds", 0, function(o) FX.sndObj, FX.sndIdx = o, nil end)
    end
  end
  -- the rigs missing from a pool of `want` (list), spawned from `url` with GM notes gm, once per load (FX[flag]; a spawn
  -- that raises leaves it unset, so the next game tries again); row: their park row
  function FX.topUp(url, gm, list, want, flag, row)
    if #list >= want or not FX.bundleLink(url) or FX[flag] then return end
    FX[flag] = true
    local bolt = gm == "engine:bolt"
    for i = #list + 1, want do
      if not FX.spawnBundle(url, gm, i, function(o) if FX.rigs ~= nil and FX.bolts ~= nil then FX.addRig(o, bolt) end end, row) then FX[flag] = false break end
    end
  end
  -- a usable bundle link (engineFxBundle): a non-empty string
  function FX.bundleLink(url) return type(url) == "string" and url ~= "" end
  -- one bundle object, locked and parked under the table (the n-th a little along x, so none overlaps). The data needs
  -- a Transform: without one real TTS's spawnObjectData raises "Object reference not set to an instance of an object"
  -- (seen live 2026-11-12, file:/// and https:// alike). True when the spawn was made; false (the error kept in
  -- FX.spawnErr) when it raised, so the caller can try again next game and the effects fall back to the UI slots.
  function FX.spawnBundle(url, gm, n, done, row)
    local x, z = -40 + 1.5 * n, 30 + (row or 0)
    local ok, err = pcall(spawnObjectData, {
      data = { Name = "Custom_Assetbundle", Nickname = "", GMNotes = gm, Locked = true,
        Transform = { posX = x, posY = FX.RIG_PARK_Y, posZ = z, rotX = 0, rotY = 0, rotZ = 0, scaleX = 1, scaleY = 1, scaleZ = 1 },
        CustomAssetbundle = { AssetbundleURL = url, AssetbundleSecondaryURL = "", MaterialIndex = 0, TypeIndex = 0, LoopingEffectIndex = 0 } },
      position = Vector(x, FX.RIG_PARK_Y, z), rotation = Vector(0, 0, 0),
      callback_function = done })
    if not ok then FX.spawnErr = tostring(err) end
    return ok
  end
  -- trigger effect name -> index, from the first rig whose bundle answers (they are copies of one bundle); asked again
  -- while the bundle is still loading (no AssetBundle yet, or an empty list), nil until then
  function FX.rigIndex(bolt)
    local key = bolt and "boltIdx" or "rigIdx"
    if FX[key] ~= nil then return FX[key] end
    for _, r in ipairs((bolt and FX.bolts or FX.rigs) or {}) do
      local ab = not r.o.isDestroyed() and r.o.AssetBundle or nil
      if ab ~= nil then
        local ok, list = pcall(ab.getTriggerEffects)
        if ok and type(list) == "table" and #list > 0 then
          FX[key] = {}
          for _, t in ipairs(list) do if t.name ~= nil then FX[key][t.name] = t.index end end
        end
        break
      end
    end
    return FX[key]
  end
  -- the kind of rig effect an event is: a wipe's cloud, a death from damage and a -1/-1 counter's ring have their own
  function FX.rigKind(e)
    if e.kind == "death" and e.wipe then return "wipe" end
    if e.kind == "death" and e.burn then return "burn" end
    if e.kind == "counter" and e.m1 then return "counter_minus" end
    return e.kind
  end
  -- the bundle's trigger effect for a kind (its own, else its stand-in's), or nil: "mtg fx off", no rig, a bundle still
  -- loading, or no such effect in it. An event with its own names (e.names: a wave, a tinted exile) takes the first of
  -- them the bundle has, and its tint when that is e.tintName (the neutral effect); -> name, tint or nil
  function FX.rigName(k, e)
    if engineFxMode == "off" or FX.rigs == nil or #FX.rigs == 0 then return nil end
    local idx = FX.rigIndex()
    if idx == nil then return nil end
    if e ~= nil and e.names ~= nil then
      for _, name in ipairs(e.names) do if idx[name] ~= nil then return name, (name == e.tintName) and e.tint or nil end end
      return nil
    end
    for _, kk in ipairs({ k, FX.RIG_ELSE[k] or "" }) do
      local name = FX.RIG_NAME[kk]
      if name ~= nil and idx[name] ~= nil then return name end
    end
    return nil
  end
  -- a free rig of a pool (now: os.clock()), or nil
  function FX.freeRig(list, now)
    for _, r in ipairs(list or {}) do if now >= r.busy and not r.o.isDestroyed() then return r end end
    return nil
  end
  -- one effect on a free rig, `delay` s from now: the rig moves there at once (so other players have its new spot
  -- before the trigger arrives), plays at least RIG_LEAD later, and goes back under the table once it is over (never
  -- reused before). e.rot / e.scale: a wave's turn and size (else the seat's turn, scale 1). The trigger effect's name,
  -- or nil (no rig free, or none for it): the caller falls back to a slot.
  function FX.rigPlay(e, spot, delay, gen)
    local k = FX.rigKind(e)
    local name, tint = FX.rigName(k, e)
    if name == nil then return nil end
    local rig = FX.freeRig(FX.rigs, os.clock())
    if rig == nil then return nil end
    local at = math.max(delay + (FX.RIG_AT[k] or 0), FX.RIG_LEAD)
    local g = e.rot == nil and e.seat and seatGeometry(e.seat) or nil
    FX.rigGo(rig, Vector(spot.x, spot.y + FX.RIG_LIFT, spot.z), e.rot or Vector(0, g and g.rotY or 0, 0), e.scale or 1, tint,
      FX.rigIdx[name], at, at + (FX.RIG_LEN[k] or 1) + FX.RIG_TAIL, gen)
    return name
  end
  -- a rig taken: moved, turned, sized and tinted at once (each call only when it changes), trigger effect idx played
  -- `at` s from now, and back under the table at `over` (scale 1, untinted)
  function FX.rigGo(rig, pos, rot, scale, tint, idx, at, over, gen)
    rig.busy, rig.use = os.clock() + over, rig.use + 1
    local use, o = rig.use, rig.o
    -- (who mustn't see it: the players with effects off, one setInvisibleTo when that changes)
    local off = {}
    for _, c in ipairs(FX.COLOURS) do if engineEffectsOff[c] then off[#off + 1] = c end end
    local offKey = table.concat(off, "|")
    if rig.off ~= offKey then rig.off = offKey o.setInvisibleTo(off) end
    local rotKey = string.format("%.1f,%.1f,%.1f", rot.x, rot.y, rot.z)
    if rig.rot ~= rotKey then rig.rot = rotKey o.setRotation(rot) end
    if rig.scale ~= scale then rig.scale = scale o.setScale(Vector(scale, scale, scale)) end
    local tintKey = tint and table.concat(tint, ",") or nil
    if rig.tint ~= tintKey then rig.tint = tintKey o.setColorTint(tint or { 1, 1, 1 }) end
    o.setPosition(pos)
    Wait.time(function()
      local ab = FX.gen == gen and rig.use == use and not o.isDestroyed() and o.AssetBundle or nil
      if ab ~= nil and idx ~= nil then pcall(ab.playTriggerEffect, idx) end
    end, at)
    Wait.time(function() if rig.use == use and not o.isDestroyed() then FX.park(rig) end end, over)
  end
  function FX.park(rig)
    local o = rig.o
    o.setPosition(rig.home)
    if rig.scale ~= 1 then rig.scale = 1 o.setScale(Vector(1, 1, 1)) end
    if rig.tint ~= nil then rig.tint = nil o.setColorTint({ 1, 1, 1 }) end
  end
  -- a new game: every rig still out goes back under the table, and the next game looks for them again
  function FX.rigsReset()
    for _, list in ipairs({ FX.rigs or {}, FX.bolts or {} }) do
      for _, r in ipairs(list) do
        r.use = r.use + 1
        if r.busy > os.clock() and not r.o.isDestroyed() then FX.park(r) end
        r.busy = 0
      end
    end
    FX.rigs, FX.rigIdx, FX.bolts, FX.boltIdx = nil, nil, nil, nil
  end
  -- ── the board's colours (docs/particle-fx-spec.md section 1: a wipe in its cause's colour, a bolt in its source's) ──
  -- a colour key from the bridge's cl letters: W U B R G, C colourless, M two or more; nil unknown
  function FX.keyOf(cl)
    if type(cl) ~= "string" or cl == "" then return nil end
    if #cl > 1 then return "M" end
    if ("WUBRGC"):find(cl, 1, true) then return cl end
    return nil
  end
  -- a card's cl: its static details, else a last board's stack item of it (prev: engineEffects' snapshot)
  function FX.clOf(id, prev)
    if id == nil then return nil end
    local st = engineStatic[id]
    if st ~= nil and st.cl ~= nil then return st.cl end
    for _, s in ipairs(prev and prev.stack or {}) do if s.src == id and s.cl ~= nil then return s.cl end end
    return nil
  end
  -- the bridge's battlefield departures by card (m.lv) and the cards hit on this board -> their source (m.hits; true
  -- when it names none)
  function FX.lvOf(m)
    local out = {}
    for _, x in ipairs(m.lv or {}) do if x.id ~= nil then out[x.id] = x end end
    return out
  end
  function FX.hitOf(m)
    local out = {}
    for _, h in ipairs(m.hits or {}) do if h.to ~= nil then out[h.to] = h.src or out[h.to] or true end end
    return out
  end
  -- the bundle objects belong to the table, not to a game: the sweep of engine objects, "mtg start" and the table's
  -- own check leave them alone
  function engineIsBundleObject(gm) return gm == "engine:fx" or gm == "engine:bolt" or gm == "engine:sounds" end
  -- one frame after the board (engineCombatLunge has stamped its hit times by then): start what fits, drop the rest
  -- kind: the board's sound (engineFxBoard picked it), played when the first event of that kind starts (a wipe's with
  -- the first death; a hit's with its first hit, FX.ofSound; a sound-only kind, exile, lifegain, a cast, at once); n: the
  -- board's count for it (its burst)
  -- bolts: FX.boltsOf's, flown first (their impacts time their targets' effects, as the swings do)
  function FX.dispatch(m, ev, visual, gen, kind, n, bolts)
    if FX.gen ~= gen then return end
    local t0 = os.clock()
    local hits = (engineLungeHits ~= nil and engineLungeHits.board == m) and engineLungeHits or {}
    local last = engineFxLast or {}
    last.fx, last.dropped = last.fx or {}, last.dropped or 0
    if visual and bolts ~= nil and #bolts > 0 then hits = FX.boltsFire(bolts, gen, hits, last) end
    if visual and (FX.car == nil or FX.car.isDestroyed()) then FX.car = FX.carrier() end
    local started, deaths, soundAt = 0, 0, nil
    for _, e in ipairs(ev) do
      local hit = hits[e.id or e.seat]
      local delay = hit ~= nil and math.max(0, hit - os.clock()) or 0
      -- (a wave's cards at their own times, e.at; a combat death is from damage too: a burn)
      if e.at ~= nil then delay = e.at
      elseif e.kind == "death" then delay = delay + 0.08 * deaths deaths = deaths + 1 end
      if e.kind == "death" and hit ~= nil and not e.sac then e.burn = true end
      if soundAt == nil and kind ~= nil and FX.ofSound(e, kind) then soundAt = delay + (e.kind == "knockout" and 0.6 or 0) end
      if visual then
        local spot = e.spot
        if e.kind == "knockout" then local life = getObjectFromGUID(TRACK[e.seat] or "") spot = life and life.getPosition() end
        -- (a rig of the effect bundle when there is one for it, else a slot; a bundle-only kind has no slot look; a
        -- wave's cards have their own cap, FX.WIPE_DRAW, not the board's)
        local room = e.under or started < FX.PER_BOARD
        local rig = (room and spot ~= nil) and FX.rigPlay(e, spot, delay, gen) or nil
        local key = (rig == nil and not e.rigOnly and room and spot ~= nil and FX.car ~= nil) and FX.slot(e.kind == "knockout") or nil
        if key ~= nil then
          local look = FX.look(e)
          look.spot, look.seat = spot, e.seat
          FX.start("eng_fx_" .. key, look, delay)
          FX.slotUntil[key] = os.clock() + delay + look.stop
        end
        if key ~= nil or rig ~= nil then
          if not e.under then started = started + 1 end
          last.fx[#last.fx + 1] = { kind = e.kind, seat = e.seat, at = delay, x = spot.x, z = spot.z, n = e.n, slot = key, rig = rig, key = e.key }
          if e.kind == "player" then FX.glowLife(e.seat, { 1, 0.2, 0.15 }, 0.5, delay)
          elseif e.kind == "knockout" then FX.glowLife(e.seat, { 1, 0.15, 0.1 }, 0.7, delay) end
        else last.dropped = last.dropped + 1 end
      end
    end
    if kind ~= nil then
      soundAt = soundAt or 0
      if soundAt <= 0 then engineSoundPlay(kind, false, n) else Wait.time(function() if FX.gen == gen then engineSoundPlay(kind, false, n) end end, soundAt) end
    end
    local S = engineProfile and engineProfile.sect
    if S ~= nil then S.fx = (S.fx or 0) + (os.clock() - t0) * 1000 end
  end
  -- whether an event is one of the board's sound kind (FX.dispatch: the sound starts with the first of them): a wipe's
  -- are its deaths; a hit of more than FX.BIG_HIT (a creature's or a player's) is a bighit, a player's of 5 or less a
  -- playerhit, and damage, the fallback of both (design section 6), takes every hit
  function FX.ofSound(e, kind)
    local of = FX.SOUND_OF[e.kind]
    if of == "damage" or of == "playerhit" then
      if kind == "damage" then return true end
      if (tonumber(e.n) or 0) > FX.BIG_HIT then return kind == "bighit" end
    end
    return of == (kind == "wipe" and "death" or kind)
  end
  -- The board's events, most important first: knock-outs, deaths, damage to players, damage to creatures, counters
  -- (then, with the effect bundle, exiles, countered spells and life gained). prev/now are engineEffects' snapshots,
  -- diedIds its deaths, exiledIds the permanents exiled, countered the last board's stack items countered. Picks the
  -- board's one sound by its counts per kind (FX.dispatch plays it). Returns how many (visual) events it found.
  function engineFxBoard(m, prev, now, diedIds, exiledIds, countered, lv)
    local ev, nOut = {}, 0
    local sortedKeys = function(t) local ks = {} for k in pairs(t) do ks[#ks + 1] = k end table.sort(ks) return ks end
    for _, c in ipairs(sortedKeys(now.status)) do
      if now.status[c] ~= "playing" and prev.status[c] == "playing" then ev[#ev + 1] = { kind = "knockout", seat = c } nOut = nOut + 1 end
    end
    -- a wipe with the bundle's wave (FX.waveOf): the wave and the cards' own effects, in place of the deaths below
    -- and of its cards' exiles (inWave); causes: what caused it, which flies no bolt
    lv = lv or {}
    local hitBy = FX.hitOf(m)
    local waveEv, inWave, causes = FX.waveOf(m, prev, now, diedIds, exiledIds, lv, hitBy)
    inWave, causes = inWave or {}, causes or {}
    for _, e in ipairs(waveEv or {}) do ev[#ev + 1] = e end
    -- deaths by the battlefield they left; more than 3 on one = one bigger cloud with "×N" in the middle of them. A
    -- death from damage (a hit on this board, not a sacrifice) is a burn on a rig (FX.rigKind); FX.dispatch adds the
    -- combat ones, by the lunge
    local bySeat = {}
    for _, ids in pairs(waveEv == nil and diedIds or {}) do
      for _, id in ipairs(ids) do
        local x = prev.bf[id]
        if x ~= nil then bySeat[x.owner] = bySeat[x.owner] or {} table.insert(bySeat[x.owner], id) end
      end
    end
    for _, c in ipairs(sortedKeys(bySeat)) do
      local list = bySeat[c]
      table.sort(list)
      if #list > 3 then
        local sx, sz, k, y = 0, 0, 0, 0
        for _, id in ipairs(list) do local p = prev.bf[id].pos if p ~= nil then sx, sz, k, y = sx + p.x, sz + p.z, k + 1, p.y end end
        if k > 0 then ev[#ev + 1] = { kind = "death", seat = c, id = list[1], spot = Vector(sx / k, y, sz / k), n = #list, wipe = true } end
      else
        local at = {}
        for _, id in ipairs(list) do
          local p = prev.bf[id].pos
          local key = p and string.format("%.1f,%.1f", p.x, p.z)
          local sac = lv[id] ~= nil and lv[id].how == "s"
          if p ~= nil and not at[key] then at[key] = true ev[#ev + 1] = { kind = "death", seat = c, id = id, spot = p, n = 1, sac = sac, burn = hitBy[id] ~= nil and not sac or nil } end
        end
      end
    end
    -- damage to players: life went down (life paid reads the same); a player's life going up is the lifegain sound
    -- (nGained, nHurt: how many players, for the bursts; nBig: the hits over FX.BIG_HIT, players' and creatures')
    local nGained, nHurt, nBig = 0, 0, 0
    for _, c in ipairs(sortedKeys(now.life)) do
      local was, life = tonumber(prev.life[c]), tonumber(now.life[c])
      if was ~= nil and life ~= nil and life < was then
        nHurt = nHurt + 1
        if was - life > FX.BIG_HIT then nBig = nBig + 1 end
        if enginePlayerSpot ~= nil then ev[#ev + 1] = { kind = "player", seat = c, n = was - life, spot = enginePlayerSpot(c) } end
      elseif was ~= nil and life ~= nil and life > was then nGained = nGained + 1 end
    end
    -- damage to creatures and counters put on permanents: only cards on the battlefield in both boards, one per spot
    -- (grouped tokens share one)
    local hitsAt, rings = {}, {}
    for id, x in pairs(now.bf) do
      local p = prev.bf[id]
      if p ~= nil and x.pos ~= nil then
        if x.dmg > p.dmg then hitsAt[#hitsAt + 1] = { kind = "damage", seat = x.owner, id = id, spot = x.pos, n = x.dmg - p.dmg } end
        local grew, other = false, false
        if x.ctr ~= nil then
          local was = p.ctr or {}
          for k, v in pairs(x.ctr) do
            if (tonumber(v) or 0) > (tonumber(was[k]) or 0) then grew = true if k ~= "M1M1" then other = true end end
          end
        end
        if grew then rings[#rings + 1] = { kind = "counter", seat = x.owner, id = id, spot = x.pos, m1 = not other } end
      end
    end
    local nBigP = nBig
    for _, e in ipairs(hitsAt) do if e.n > FX.BIG_HIT then nBig = nBig + 1 end end
    table.sort(hitsAt, function(a, b) if a.n ~= b.n then return a.n > b.n end return a.id < b.id end)
    table.sort(rings, function(a, b) return a.id < b.id end)
    for _, list in ipairs({ { hitsAt, FX.MAX_HITS }, { rings, FX.MAX_RINGS } }) do
      local at, n = {}, 0
      for _, e in ipairs(list[1]) do
        local key = string.format("%.1f,%.1f", e.spot.x, e.spot.z)
        if n < list[2] and not at[key] then at[key], n = true, n + 1 ev[#ev + 1] = e end
      end
    end
    -- with the effect bundle only (FX.rigName; no slot look of their own, rigOnly): permanents exiled (one per spot),
    -- a countered spell where it stood on the stack (engineFxStackSpot, the last board's), a player's life going up at
    -- their life counter
    -- (an exile: tinted in its exiler's colour with engineFxTint, the neutral exile; and its light flies to the card that
    -- exiled it when that is on the battlefield, lv's by or the exiled card's ew: a bolt, FX.boltsOf)
    local flights = {}
    if FX.rigName("exile") ~= nil then
      local list, at = {}, {}
      for _, id in ipairs(exiledIds or {}) do if prev.bf[id] ~= nil and prev.bf[id].pos ~= nil and not inWave[id] then list[#list + 1] = id end end
      table.sort(list)
      for _, id in ipairs(list) do
        local p = prev.bf[id].pos
        local key = string.format("%.1f,%.1f", p.x, p.z)
        if not at[key] then
          at[key] = true
          local by = (lv[id] and lv[id].by) or (now.ew and now.ew[id]) or nil
          local ck = FX.keyOf(FX.clOf(by, prev))
          local e = { kind = "exile", seat = prev.bf[id].owner, id = id, spot = p, n = 1, rigOnly = true }
          if engineFxTint == true and ck ~= nil then e.names, e.tint, e.tintName = { "exile_neutral", "exile" }, FX.TINT[ck], "exile_neutral" end
          ev[#ev + 1] = e
          local to = by ~= nil and by ~= id and now.bf[by] ~= nil and now.bf[by].pos or nil
          if to then flights[#flights + 1] = { from = p, to = to, tgt = by, key = ck or "W", q = tonumber(lv[id] and lv[id].q) or 0, flight = true } end
        end
      end
    end
    if FX.rigName("countered") ~= nil then
      for _, st in ipairs(countered or {}) do
        local p = engineFxStackSpot and engineFxStackSpot[st.id]
        if p ~= nil then ev[#ev + 1] = { kind = "countered", seat = st.ctl, id = st.id, spot = p, n = 1, rigOnly = true } end
      end
    end
    if FX.rigName("lifegain") ~= nil then
      for _, c in ipairs(sortedKeys(now.life)) do
        local was, life = tonumber(prev.life[c]), tonumber(now.life[c])
        local tr = getObjectFromGUID(TRACK[c] or "")
        if was ~= nil and life ~= nil and life > was and tr ~= nil then ev[#ev + 1] = { kind = "lifegain", seat = c, spot = tr.getPosition(), n = life - was, rigOnly = true } end
      end
    end
    -- the board's sound kinds (design section 6), each by its count on this board, the one record of both whether it
    -- is on the board (over 0) and its burst (FX.burst): players out; permanents to graveyards (a wipe: 3 or more, all
    -- seats together; one with no spot to smoke at still counts); permanents exiled from the battlefield; creatures hit
    -- (all, not only the 4 shown) plus players hit, every hit (the fallback of the two below); of those, the hits over
    -- 5 (bighit) and the players hit by 5 or less (playerhit); players whose life went up (a board has life totals
    -- only: two gains by one player count once); the spells countered (as the COUNTERED pop-up takes them); a sorcery
    -- and an instant cast (1 at most each); permanents given counters
    local nDied = 0
    for _, ids in pairs(diedIds) do nDied = nDied + #ids end
    local counts = { knockout = nOut, wipe = nDied >= FX.WIPE and nDied or 0, death = nDied, exile = exiledIds and #exiledIds or 0,
      bighit = nBig, playerhit = nHurt - nBigP, damage = #hitsAt + nHurt, lifegain = nGained, countered = countered and #countered or 0,
      sorcery = FX.castOf(prev, now, "sor") and 1 or 0, instant = FX.castOf(prev, now, "ins") and 1 or 0, counter = #rings }
    -- one sound: the most important kind on this board that has a pick
    local kind = nil
    for _, k in ipairs(engineSoundKinds or {}) do if kind == nil and (counts[k] or 0) > 0 and FX.picked(k) then kind = k end end
    local n = kind and counts[kind] or 1
    -- (the bolts: their spots now, before the stack is laid out again; flown one frame later with the rest)
    local bolts = FX.boltsOf(m, prev, now, flights, causes)
    if #ev == 0 and #bolts == 0 and kind == nil then return 0 end
    local visual = (#ev > 0 or #bolts > 0) and FX.visualsOn()
    if not visual and kind == nil then return #ev end
    if visual and not FX.built then FX.build() end
    local gen = FX.gen
    Wait.frames(function() FX.dispatch(m, ev, visual, gen, kind, n, bolts) end, 1)
    return #ev
  end
  -- The wipe (FX.WIPE or more permanents to graveyards or exile on this board, every seat together): the wave, then
  -- the cards' own death, burn or exile ("mtg fx on" only, FX.WIPE_DRAW at most); or nil: "mtg fx off", too few, or no
  -- wave in the bundle (the old cloud then). Its colour is the commonest key among its cards' causes (lv's by, else the
  -- source of the damage dealt to the card), else a stack item gone since the last board's, else FX.WAVE_KEY; its side
  -- is that cause's controller's (the last board's stack item, else its battlefield), else the active player's.
  -- -> events, { id = true } of its cards, { cause id = true }
  function FX.waveOf(m, prev, now, diedIds, exiledIds, lv, hitBy)
    if engineFxMode == "off" then return nil end
    local gone, dead = {}, {}
    for _, ids in pairs(diedIds) do
      for _, id in ipairs(ids) do if prev.bf[id] ~= nil and prev.bf[id].pos ~= nil then gone[#gone + 1] = id dead[id] = true end end
    end
    for _, id in ipairs(exiledIds or {}) do if prev.bf[id] ~= nil and prev.bf[id].pos ~= nil then gone[#gone + 1] = id end end
    if #gone < FX.WIPE then return nil end
    table.sort(gone)
    local count, byOf, causes = {}, {}, {}
    for _, id in ipairs(gone) do
      local by = (lv[id] and lv[id].by) or (type(hitBy[id]) == "string" and hitBy[id]) or nil
      local key = FX.keyOf(FX.clOf(by, prev))
      if by ~= nil then causes[by] = true end
      if key ~= nil then count[key] = (count[key] or 0) + 1 byOf[key] = byOf[key] or by end
    end
    local key, best = nil, 0
    for _, k in ipairs({ "W", "U", "B", "R", "G", "C", "M" }) do if (count[k] or 0) > best then key, best = k, count[k] end end
    local by = key and byOf[key] or nil
    if key == nil then
      local still = {}
      for _, st in ipairs(now.stack) do still[st.id] = true end
      for _, st in ipairs(prev.stack) do if key == nil and not still[st.id] and FX.keyOf(st.cl) ~= nil then key, by = FX.keyOf(st.cl), st.src end end
    end
    local seat = nil
    for _, st in ipairs(prev.stack) do if seat == nil and by ~= nil and st.src == by then seat = st.ctl end end
    seat = seat or (by and ((prev.bf[by] and prev.bf[by].owner) or (now.bf[by] and now.bf[by].owner))) or m.active
    local wave = FX.waveEvent(seat, key, #gone)
    if wave == nil then return nil end
    local o, dx, dz = wave.spot, wave.dx, wave.dz
    local ev, inWave = { wave }, {}
    for _, id in ipairs(gone) do inWave[id] = true end
    if engineFxMode ~= "on" then return ev, inWave, causes end
    -- (the cards in the order the wave reaches them, one per spot: grouped tokens share one)
    local along, at = {}, {}
    for _, id in ipairs(gone) do local p = prev.bf[id].pos along[id] = (p.x - o.x) * dx + (p.z - o.z) * dz end
    table.sort(gone, function(a, b) if along[a] ~= along[b] then return along[a] < along[b] end return a < b end)
    for _, id in ipairs(gone) do
      local x = prev.bf[id]
      local spotKey = string.format("%.1f,%.1f", x.pos.x, x.pos.z)
      if #ev <= FX.WIPE_DRAW and not at[spotKey] then
        at[spotKey] = true
        local sac = lv[id] ~= nil and lv[id].how == "s"
        ev[#ev + 1] = { kind = dead[id] and "death" or "exile", burn = dead[id] and hitBy[id] ~= nil and not sac or nil, sac = sac, seat = x.owner,
          id = id, spot = x.pos, n = 1, rigOnly = true, under = true, at = FX.RIG_LEAD + FX.WIPE_FIRST + FX.WIPE_STEP * (#ev - 1) }
      end
    end
    return ev, inWave, causes
  end
  -- one wave of n cards from seat's side in colour key (nil: FX.WAVE_KEY), or nil: no wave in the bundle, or no seat.
  -- With engineFxTint the neutral wipe_wave tinted, else the baked death_wipe_<key> (each the other's stand-in). It
  -- starts WAVE_BACK behind the middle of the seat's playmat, its local +z toward the table's centre (dx, dz).
  function FX.waveEvent(seat, key, n)
    key = (key ~= nil and FX.TINT[key] ~= nil) and key or FX.WAVE_KEY
    local tint = engineFxTint == true
    local wave = { kind = "wave", n = n, key = key, rigOnly = true, at = 0, tintName = "wipe_wave", tint = tint and FX.TINT[key] or nil,
      names = tint and { "wipe_wave", "death_wipe_" .. key } or { "death_wipe_" .. key, "wipe_wave" } }
    if FX.rigName("wave", wave) == nil then return nil end
    local g = seat and seatGeometry(seat)
    if g == nil then return nil end
    local dx, dz = -g.mat.x, -g.mat.z
    if dx * dx + dz * dz < 0.0001 then dx, dz = g.fwd.x, g.fwd.z end
    local len = math.max(0.01, math.sqrt(dx * dx + dz * dz))
    dx, dz = dx / len, dz / len
    wave.seat, wave.dx, wave.dz = seat, dx, dz
    wave.spot = Vector(g.mat.x - dx * FX.WAVE_BACK, g.mat.y, g.mat.z - dz * FX.WAVE_BACK)
    wave.rot, wave.scale = Vector(0, math.deg(FX.atan2(dx, dz)), 0), FX.WAVE_SCALE
    return wave
  end
  -- The board's bolts ("mtg fx on" only, docs/particle-fx-spec.md section 1): each hit of a spell or an ability (not
  -- combat: the lunge shows that) at a card or a player, from where its source was (a spell: its spot on the last
  -- board's stack; an ability: its source card) to its target, in the source's colour, in Forge's order (q); and the
  -- exiles' lights (flights, engineFxBoard). A source with more than FX.MAX_BOLTS hits on this board (a sweep) or the
  -- cause of this board's wave flies none; FX.MAX_BOLTS at most, the rest get only their impact (the target's own
  -- effect, at once). -> { { from, to, tgt, key, q, flight } }
  function FX.boltsOf(m, prev, now, flights, causes)
    local out = {}
    if engineFxMode ~= "on" then return out end
    local per = {}
    for _, h in ipairs(m.hits or {}) do if not h.combat and h.src ~= nil then per[h.src] = (per[h.src] or 0) + 1 end end
    for _, h in ipairs(m.hits or {}) do
      if not h.combat and h.src ~= nil and per[h.src] <= FX.MAX_BOLTS and not causes[h.src] then
        local from = FX.boltFrom(h.src, prev, now)
        local to = (LIFE_TRACKERS[h.to] ~= nil and enginePlayerSpot ~= nil and enginePlayerSpot(h.to)) or (prev.bf[h.to] and prev.bf[h.to].pos)
          or (now.bf[h.to] and now.bf[h.to].pos) or nil
        if from ~= nil and to ~= nil then out[#out + 1] = { from = from, to = to, tgt = h.to, key = FX.keyOf(FX.clOf(h.src, prev)), q = tonumber(h.q) or 0 } end
      end
    end
    for _, x in ipairs(flights or {}) do out[#out + 1] = x end
    table.sort(out, function(a, b) if a.q ~= b.q then return a.q < b.q end return tostring(a.tgt) < tostring(b.tgt) end)
    while #out > FX.MAX_BOLTS do table.remove(out) end
    return out
  end
  -- where a bolt of src starts: a spell's spot on the last board's stack (engineFxStackSpot, not yet laid out again),
  -- an ability's source card (the last board's spot, else this one's); nil when neither (a spell no board showed)
  function FX.boltFrom(src, prev, now)
    for _, st in ipairs(prev.stack) do
      if st.src == src then
        if st.spell or st.sp then return engineFxStackSpot and engineFxStackSpot[st.id] or nil end
        break
      end
    end
    return (prev.bf[src] and prev.bf[src].pos) or (now.bf[src] and now.bf[src].pos) or nil
  end
  -- One bolt `at` s from now on a free bolt rig (b: FX.boltsOf's): at its start, turned so local +z points at the
  -- target (yaw and pitch), scaled to the distance, bolt_<key> (else the red-orange bolt) played at `at`; the head
  -- lands BOLT_HIT later. engineFxBoltMove (the fallback, should the bundle's animation not play): bolt_trail at
  -- scale 1, the rig moved to the target over BOLT_FRAMES frames, bolt_impact there. -> the impact's os.clock(), name,
  -- distance; nil when no bolt rig is free or the bundle has neither
  function FX.boltPlay(b, at, gen)
    if engineFxMode ~= "on" or FX.bolts == nil or #FX.bolts == 0 then return nil end
    local idx = FX.rigIndex(true)
    if idx == nil then return nil end
    local move = engineFxBoltMove == true
    local want = (b.key ~= nil and b.key ~= "C" and b.key ~= "M") and ("bolt_" .. b.key) or "bolt"
    local name = move and "bolt_trail" or (idx[want] ~= nil and want or "bolt")
    if idx[name] == nil then return nil end
    local rig = FX.freeRig(FX.bolts, os.clock())
    if rig == nil then return nil end
    local a = Vector(b.from.x, b.from.y + FX.RIG_LIFT, b.from.z)
    local z = Vector(b.to.x, b.to.y + FX.RIG_LIFT, b.to.z)
    local dx, dy, dz = z.x - a.x, z.y - a.y, z.z - a.z
    local d = math.sqrt(dx * dx + dy * dy + dz * dz)
    if d < 0.05 then return nil end
    local rot = Vector(-math.deg(math.asin(dy / d)), math.deg(FX.atan2(dx, dz)), 0)
    local fly = move and (FX.BOLT_FRAMES / 60) or FX.BOLT_HIT
    FX.rigGo(rig, a, rot, move and 1 or d, nil, idx[name], at, at + FX.BOLT_LEN + fly + FX.RIG_TAIL, gen)
    if move then FX.boltMove(rig, a, z, at, gen, idx.bolt_impact) end
    return os.clock() + at + fly, name, d
  end
  -- the fallback's flight: a straight move, one setPosition a frame, then the impact at the target
  function FX.boltMove(rig, a, z, at, gen, impact)
    local use, o = rig.use, rig.o
    local step = 0
    local function hop()
      if FX.gen ~= gen or rig.use ~= use or o.isDestroyed() then return end
      step = step + 1
      local t = step / FX.BOLT_FRAMES
      o.setPosition(Vector(a.x + (z.x - a.x) * t, a.y + (z.y - a.y) * t, a.z + (z.z - a.z) * t))
      if step < FX.BOLT_FRAMES then Wait.frames(hop, 1)
      elseif impact ~= nil and o.AssetBundle ~= nil then pcall(o.AssetBundle.playTriggerEffect, impact) end
    end
    Wait.time(function() Wait.frames(hop, 1) end, at)
  end
  -- the bolts flown (FX.dispatch, before the board's other events): each target's first impact becomes its hit time,
  -- as the lunge's, so its damage, hit or death lands then. hits: the lunge's (copied, never changed). -> hit times
  function FX.boltsFire(bolts, gen, hits, last)
    local out = {}
    for k, v in pairs(hits) do out[k] = v end
    last.bolts = last.bolts or {}
    for i, b in ipairs(bolts) do
      local at = FX.RIG_LEAD + (i - 1) * FX.BOLT_STEP + (b.flight and FX.FLIGHT_AT or 0)
      local imp, name, d = FX.boltPlay(b, at, gen)
      if imp ~= nil and not b.flight and out[b.tgt] == nil then out[b.tgt] = imp end
      last.bolts[#last.bolts + 1] = { name = name, at = at, d = d, tgt = b.tgt, flight = b.flight, key = b.key,
        fx = b.from.x, fz = b.from.z, tx = b.to.x, tz = b.to.z }
    end
    return out
  end
  -- a burst (docs/sounds.md "Bursts"): the engineSounds key for n of a kind at once, the largest <kind>_x<N> with a
  -- pick and N at or under n, never over FX.BURST_MAX; the plain kind for 1 or when none fits
  function FX.burst(kind, n)
    local top = math.min(math.floor(tonumber(n) or 1), FX.BURST_MAX)
    for b = top, 2, -1 do
      local key = kind .. "_x" .. b
      if FX.picked(key) then return key end
    end
    return kind
  end
  -- a sound kind with something to play (engineSounds: a link or a bundle name) and the table's sounds on
  function FX.picked(k)
    local pick = engineSounds ~= nil and engineSounds[k]
    return not engineSoundsMuted and type(pick) == "string" and pick ~= ""
  end
  -- an instant (flag "ins") or a sorcery ("sor", 2026-11-12) cast on this board: a stack item the bridge marks so (never
  -- an ability, never one still being cast) that wasn't on the stack before. A copy is one with the name of one already
  -- on the stack while its controller's hand didn't shrink (Twincast's copy, storm's); the same name cast from a hand counts.
  function FX.castOf(prev, now, flag)
    local was, names = {}, {}
    for _, st in ipairs(prev.stack or {}) do
      if st[flag] then was[st.src or st.id] = true names[tostring(st.n)] = true end
    end
    for _, st in ipairs(now.stack) do
      if st[flag] and not was[st.src or st.id] then
        local hcNow, hcWas = now.hc and now.hc[st.ctl], prev.hc and prev.hc[st.ctl]
        local fromHand = hcNow ~= nil and hcWas ~= nil and hcNow < hcWas
        if not names[tostring(st.n)] or fromHand then return true end
      end
    end
    return false
  end
  -- a jump, not a play: the next board only gives the effects a new start (the table was sent again, "started")
  function engineEffectsJump() FX.jumpNext = true end
  -- for calibrating on the real table (real-table check 2): one slot on a card (engine id) or a player's spot (a
  -- colour) for 3 s; kind = "ring", "burst" or "smoke"; or a kind of the effect bundle (FX.RIG_NAME: "death", "wipe",
  -- "exile", ...) plays that on a rig (looked for again first, so a bundle put on the table mid-game shows)
  -- (2026-11-12, for the live checks of docs/particle-fx-spec.md: "bolt" flies one from id to `to`, a card or a colour,
  -- in colour key `key`; "wave" sweeps from colour id's side in key `to`, W U B R G C M)
  function engineFxTest(kind, id, to, key)
    if not FX.built then FX.build() end
    local spotOf = function(x) return enginePlanned[x] or (engineObjs[x] ~= nil and not engineObjs[x].isDestroyed() and engineObjs[x].getPosition())
      or (enginePlayerSpot ~= nil and LIFE_TRACKERS[x] ~= nil and enginePlayerSpot(x)) or nil end
    local spot = spotOf(id)
    if not spot then return "no such card or colour on the table" end
    local seat = (engineMeta[id] and engineMeta[id].color) or (LIFE_TRACKERS[id] ~= nil and id) or nil
    if kind == "bolt" or kind == "wave" then
      if FX.rigs == nil or (#FX.rigs == 0 and #FX.bolts == 0) or (kind == "bolt" and FX.boltIdx == nil) or (kind == "wave" and FX.rigIdx == nil) then FX.findRigs() end
      if kind == "bolt" then
        local dest = to and spotOf(to)
        if not dest then return "no such target" end
        return FX.boltPlay({ from = spot, to = dest, key = key }, FX.RIG_LEAD, FX.gen) and "shown" or "no free bolt rig with that bolt"
      end
      local e = FX.waveEvent(seat, to, 3)
      if e == nil then return "no wave in the effect bundle, or no seat " .. tostring(id) end
      return FX.rigPlay(e, e.spot, 0, FX.gen) and "shown" or "no free effect bundle rig"
    end
    if FX.RIG_NAME[kind] ~= nil then
      if FX.rigs == nil or #FX.rigs == 0 or FX.rigIdx == nil then FX.findRigs() end
      if FX.rigPlay({ kind = kind, seat = seat }, spot, 0, FX.gen) == nil then return "no free effect bundle rig with " .. kind end
      return "shown"
    end
    if FX.car == nil then return "no life counter to carry the effects" end
    FX.slotUntil[1] = os.clock() + 3
    FX.start("eng_fx_1", { spot = spot, seat = seat, phases = { { t = 0, img = kind or "ring", col = "#FFFFFFE6", size = 1.0 } }, stop = 3, text = "×3" }, 0)
    return "shown"
  end
  -- M5 sounds (design section 6), at most one per board: each kind at most every 0.3 s, any two 0.15 s apart.
  -- engineSounds[kind]: nil or "" = silent (FX.picked); a link (https://...) plays through the table's music player
  -- (route A, shared by everyone); a name plays that trigger effect of the sound object whose GM notes are
  -- "engine:sounds" (route B). force (mtg sounds test) skips the spacing. n: how many at once, for the bursts (FX.burst: death_x4 for 5 deaths;
  -- the spacing stays the kind's). True if it played. engineSoundLog: "clip route" (death_x4 music), for the tests.
  function engineSoundPlay(kind, force, n)
    if not FX.picked(kind) then return false end
    local key = FX.burst(kind, n)
    local pick = engineSounds[key]
    local now = os.clock()
    if not force and (now - (FX.sndAt[kind] or -100) < 0.3 or now - FX.sndLast < 0.15) then return false end
    local route
    if pick:find("^https?://") then
      if MusicPlayer == nil then return false end
      -- (the players' own music is never cut while it plays: a clip of theirs that is playing; a clip of ours is titled
      -- "MTG effect: ..."; a paused one is replaced and stays in their music library. Live check 2026-11-11: TTS loads a
      -- save's track paused, so keeping paused tracks silenced every table sound on the playgroup's own save)
      local okBusy, busy = pcall(function()
        local clip = MusicPlayer.getCurrentAudioclip() or {}
        local theirs = tostring(clip.url or "") ~= "" and tostring(clip.title or ""):sub(1, 10) ~= "MTG effect"
        return theirs and MusicPlayer.player_status == "Play"
      end)
      if not okBusy or busy then return false end
      -- (played once the player holds this very clip and has loaded it: right after setCurrentAudioclip, loaded can
      -- still be the last clip's; and only if no newer sound has replaced it since, the newest wins)
      -- (by its link, or by its title should TTS hand the link back spelled another way)
      FX.sndSeq = (FX.sndSeq or 0) + 1
      local seq, title = FX.sndSeq, "MTG effect: " .. key
      local function ours()
        local okClip, clip = pcall(MusicPlayer.getCurrentAudioclip)
        return FX.sndSeq == seq and okClip and clip ~= nil and (clip.url == pick or clip.title == title)
      end
      -- (live check 2026-11-11: when a clip ends, TTS goes on to the next track in the players' music library and plays
      -- it. So ours plays with repeat on, which keeps TTS on it, and is paused just before its length (engineSoundLen)
      -- runs out; TTS gives no sign when a clip loops. The players' repeat setting comes back afterwards. A clip
      -- loaded too late to go with its board (2 s) isn't played; TTS starts a loaded clip by itself, so it is paused
      -- once it does, in the same way)
      local setAt = os.clock()
      local function finish()
        if FX.sndSeq ~= seq then return end
        if ours() then MusicPlayer.pause() end
        if FX.sndRepeat ~= nil then MusicPlayer.repeat_track = FX.sndRepeat FX.sndRepeat = nil end
      end
      -- (not to be played: paused once TTS starts it, a minute at most; also for a clip still loading after 30 s)
      local function whenStarted()
        Wait.condition(finish, function() return FX.sndSeq ~= seq or MusicPlayer.player_status == "Play" end, 60, finish)
      end
      local ok = pcall(function()
        if FX.sndRepeat == nil then FX.sndRepeat = MusicPlayer.repeat_track == true end
        MusicPlayer.repeat_track = true
        MusicPlayer.setCurrentAudioclip({ url = pick, title = title })
        Wait.condition(function()
          if not ours() then return end
          if os.clock() - setAt > 2 then whenStarted() return end
          MusicPlayer.play()
          -- (0.25 s early: live, the pause came 0.18 s late, and past the end repeat starts the clip again)
          Wait.time(finish, (engineSoundLen[key] or 2) - 0.25)
        end, function() return FX.sndSeq ~= seq or (ours() and MusicPlayer.loaded == true) end, 30, whenStarted)
      end)
      -- (a set that failed still gives the players' repeat setting back, verifier 2026-11-11)
      if not ok then pcall(finish) return false end
      route = "music"
    else
      -- (a name with no sound object on the table: one look over every object each 5 s at most, not one per board)
      if FX.sndObj == nil or FX.sndObj.isDestroyed() then
        FX.sndObj, FX.sndIdx = nil, nil
        if force or now - (FX.sndScanAt or -100) >= 5 then
          FX.sndScanAt = now
          for _, o in ipairs(getObjects()) do if o.getGMNotes() == "engine:sounds" then FX.sndObj = o end end
        end
      end
      local o = FX.sndObj
      if o == nil or o.AssetBundle == nil then return false end
      -- (an empty list is a bundle still loading: asked again with the next sound, not kept as "no effects")
      if FX.sndIdx == nil then
        local okList, list = pcall(o.AssetBundle.getTriggerEffects)
        if okList and type(list) == "table" and #list > 0 then
          FX.sndIdx = {}
          for _, t in ipairs(list) do if t.name ~= nil then FX.sndIdx[t.name] = t.index end end
        end
      end
      local idx = FX.sndIdx and FX.sndIdx[pick]
      if idx == nil or not pcall(o.AssetBundle.playTriggerEffect, idx) then return false end
      route = "bundle"
    end
    FX.sndAt[kind], FX.sndLast = now, now
    engineSoundLog = engineSoundLog or {}
    engineSoundLog[#engineSoundLog + 1] = key .. " " .. route
    if #engineSoundLog > 50 then table.remove(engineSoundLog, 1) end
    return true
  end
  local function result(c, text, color, outline, hold, size)
    if engineEffectsOff[c] or Player[c] == nil or not Player[c].seated then return end
    UI.setValue("eng_result_" .. c, text)
    -- (a long line smaller: "<NAME> WINS THE GAME" ran past the 1600-wide banner at 120)
    UI.setAttribute("eng_result_" .. c, "fontSize", tostring(size or 120))
    UI.setAttribute("eng_result_" .. c, "color", color)
    UI.setAttribute("eng_result_" .. c, "outline", outline)
    -- (not UI.show: it showed the text to every player, VICTORY over DEFEAT, playtest 2026-10-23)
    UI.setAttribute("eng_result_" .. c, "active", "true")
    -- (one mark per player: a banner shown to two players at once hid only the second one's)
    FX.resultMark = FX.resultMark or {}
    FX.resultMark[c] = (FX.resultMark[c] or 0) + 1
    local mark = FX.resultMark[c]
    Wait.time(function() if FX.resultMark[c] == mark then UI.setAttribute("eng_result_" .. c, "active", "false") end end, hold)
  end
  local function seatedColors(m)
    local out = {}
    for _, pl in ipairs(m.players or {}) do if pl.color and Player[pl.color] ~= nil and Player[pl.color].seated then out[#out + 1] = pl.color end end
    return out
  end
  -- the owner's graveyard pile flashes violet; "xN" on it when several died at once (a board wipe shows once)
  -- (a graveyard of one card is that card, not a pile: then the card that died lights up)
  -- (the dead cards slide onto the pile and the pile is rebuilt over the next ~30 frames: it lights up once they have
  -- landed; it keeps looking for a second, then settles for the card itself)
  local function deathFlash(color, n, ids, tries)
    if engineAnimOff then return end -- (the host turned table animations off)
    Wait.frames(function()
      local target = nil
      for _, o in ipairs(getObjects()) do if o.getGMNotes() == "engine:graveyard:" .. color and not o.isDestroyed() then target = o end end
      if target == nil and (tries or 0) < 4 then return deathFlash(color, n, ids, (tries or 0) + 1) end
      if target == nil then
        for _, id in ipairs(ids) do local o = engineObjs[id] if target == nil and o ~= nil and not o.isDestroyed() then target = o end end
      end
      engineFxFlashed = target and tostring(target.getGMNotes()) or "none" -- (what lit up, for the tests)
      if target == nil then return end
      target.highlightOn(FX.VIOLET, 1.2)
      if n > 1 then
        target.createButton({ click_function = "engineNoop", function_owner = Global, label = "x" .. n, position = { 0, 0.6, 0 },
          rotation = { 0, 0, 0 }, width = 520, height = 380, font_size = 300, color = { 0.25, 0.08, 0.4, 0.9 }, font_color = { 1, 1, 1 }, tooltip = "" })
        Wait.time(function() if target ~= nil and not target.isDestroyed() then target.clearButtons() end end, 1.4)
      end
    end, (tries or 0) == 0 and 40 or 15)
  end
  function engineEffects(m)
    if not engineBoardNew then return end -- (a redraw of the same board: nothing happened)
    local prev = FX.prev
    local now = { bf = {}, gy = {}, ex = {}, ew = {}, stack = {}, status = {}, life = {}, hc = {}, turn = tonumber(m.turn) }
    for _, pl in ipairs(m.players or {}) do
      local c = pl.color
      if c ~= nil then
        now.status[c] = pl.status
        now.life[c] = pl.life
        now.hc[c] = tonumber(pl.handCount) -- (a spell cast from a hand takes a card from it; a copy doesn't: the instant sound)
        -- (its spot on this board, for the effects; a token drawn as part of a group has its group's spot)
        for _, card in ipairs(pl.battlefield or {}) do
          now.bf[card.id] = { owner = c, tok = card.tok, pos = enginePlanned[card.id] or (engineGroupOf[card.id] ~= nil and enginePlanned[engineGroupOf[card.id]]) or nil,
            dmg = tonumber(card.dmg) or 0, ctr = card.ctr }
        end
        for _, card in ipairs(pl.graveyard or {}) do now.gy[card.id] = c end
        for _, card in ipairs(pl.exile or {}) do now.ex[card.id] = c if card.ew ~= nil then now.ew[card.id] = card.ew end end
      end
    end
    for i, st in ipairs(m.stack or {}) do now.stack[i] = st end
    -- (a board that leaves a zone out because it didn't change: carry the last one over)
    for _, pl in ipairs(m.players or {}) do
      local c = pl.color
      if c ~= nil and prev ~= nil then
        if pl.battlefield == nil then for id, x in pairs(prev.bf) do if x.owner == c then now.bf[id] = x end end end
        if pl.graveyard == nil then for id, x in pairs(prev.gy) do if x == c then now.gy[id] = x end end end
        if pl.exile == nil then for id, x in pairs(prev.ex or {}) do if x == c then now.ex[id] = x end end end
      end
    end
    -- a rewind, a bridge resume or a table resend is a jump, not a play: the bridge says so (jump), and until it does
    -- the turn going down, the newest restore point going down or a newly approved rewind vote say it too
    local r = m.rewind
    now.newest = (r and r.points and r.points[1] and tonumber(r.points[1].id)) or (prev and prev.newest) or nil
    now.approved = (r and r.vote and r.vote.status == "approved") and r.vote.id or nil
    local jump = m.jump == true or FX.jumpNext
    if prev ~= nil and ((now.turn ~= nil and prev.turn ~= nil and now.turn < prev.turn) or (now.newest ~= nil and prev.newest ~= nil and now.newest < prev.newest)
      or (now.approved ~= nil and now.approved ~= prev.approved)) then jump = true end
    FX.jumpNext = false
    FX.prev = now
    if not FX.built then FX.build() end -- (the first board of a game: the effect panels, once)
    if prev == nil or m.gameOver and prev.over then now.over = m.gameOver return end
    now.over = m.gameOver
    if jump then
      -- (and a player the rewind brought back gets their life counter lit again)
      for c, tint in pairs(FX.dimmed) do
        local life = now.status[c] == "playing" and getObjectFromGUID(TRACK[c] or "")
        if life then life.setColorTint(tint) FX.dimmed[c] = nil end
      end
      engineFxLast = { died = {}, fx = {}, dropped = 0, jump = true }
      return
    end
    -- exiled: battlefield -> exile, by the exile zone or by the bridge's exd (the engine's word on the move: a token
    -- exiled ceases to exist, and no board shows it in exile). Sound only (design section 6).
    -- (and by the bridge's lv, every battlefield departure as the engine tells it, docs/particle-fx-spec.md section 3:
    -- exiled too when it says e; a token it says went to a hand, a library or the command zone is no death)
    local exd, exiledIds = {}, {}
    for _, id in ipairs(m.exd or {}) do exd[id] = true end
    local lv = FX.lvOf(m)
    for id, x in pairs(lv) do if x.to == "e" then exd[id] = true end end
    for id in pairs(prev.bf) do
      if now.bf[id] == nil and (now.ex[id] ~= nil or exd[id]) then exiledIds[#exiledIds + 1] = id end
    end
    -- deaths: battlefield -> its owner's graveyard, and tokens that left the battlefield (they go nowhere) but not to exile
    local died, diedIds = {}, {}
    for id, x in pairs(prev.bf) do
      local away = lv[id] ~= nil and (lv[id].to == "h" or lv[id].to == "l" or lv[id].to == "c")
      if now.bf[id] == nil and (now.gy[id] ~= nil or (x.tok and not exd[id] and now.ex[id] == nil and not away)) then
        local c = now.gy[id] or x.owner
        died[c] = (died[c] or 0) + 1
        diedIds[c] = diedIds[c] or {}
        diedIds[c][#diedIds[c] + 1] = id
      end
    end
    for c, n in pairs(died) do deathFlash(c, n, diedIds[c]) end
    engineFxLast = { died = died, fx = {}, dropped = 0 }
    -- countered: a spell on the last board's stack whose card the bridge's ctrd names (the cards its log said "is
    -- countered" of since the last board). Not from the stack itself: Forge's stack words name the target ("Counter
    -- Fury.", no "counter target") and its stack lists no spell targets, so the pop-up never fired, live check
    -- 2026-11-12. A spell is the bridge's spell (a permanent spell) or sp (an instant or a sorcery: spell is false for
    -- any spell with spell text, so a countered instant had no pop-up before 2026-11-11)
    local ctrd, countered = {}, {}
    for _, id in ipairs(m.ctrd or {}) do ctrd[id] = true end
    for _, st in ipairs(prev.stack) do
      if st.src ~= nil and ctrd[st.src] then countered[st.id] = true end
    end
    for _, st in ipairs(prev.stack) do
      if countered[st.id] and (st.spell or st.sp) and panelReadyForPopup() then
        local stc = st.src and engineStatic[st.src] or nil
        engineSetImage("eng_pop_img", engineUiImage(st.f or (stc and stc.f) or ENGINE_BACK))
        UI.setValue("eng_pop_who", "COUNTERED: " .. tostring(st.n))
        UI.setAttribute("eng_pop_who", "color", "#FF6B5A")
        UI.setValue("eng_pop_text", " ")
        enginePopOpen()
        popToken = popToken + 1
        local token = popToken
        popShown = nil
        Wait.time(function()
          UI.setAttribute("eng_pop_who", "color", "#FFD27A")
          if popToken == token then UI.setAttribute("eng_pop", "active", "false") end
        end, 1.8)
        break
      end
    end
    -- knocked out (lost, or conceded: the engine's "conceded" got no banner before step 4): DEFEAT for them,
    -- "<NAME> IS OUT" for the others; their life counter goes dark
    for c, status in pairs(now.status) do
      if status ~= nil and status ~= "playing" and prev.status[c] == "playing" then
        for _, viewer in ipairs(seatedColors(m)) do
          if viewer == c then result(viewer, "DEFEAT", "#C9A3FF", "#1a0730E0", 3)
          elseif not m.gameOver then result(viewer, string.upper(c) .. " IS OUT", "#FF8A7A", "#2a0700E0", 2) end
        end
        local life = getObjectFromGUID(TRACK[c] or "")
        if life ~= nil and FX.dimmed[c] == nil then FX.dimmed[c] = life.getColorTint() life.setColorTint(FX.OUT) end
      end
    end
    -- game over: VICTORY for the winner, DEFEAT for everyone else (2.5 s after the knock-out, as Arena), for 2 s; then
    -- who won, for 4 s, to everyone (the user, 2026-11-09, item 14); no winner: DRAW, then "THE GAME IS A DRAW"
    if m.gameOver and not prev.over then
      Wait.time(function()
        for _, viewer in ipairs(seatedColors(m)) do
          if m.winner == nil then result(viewer, "DRAW", "#E8E2D0", "#1a1a1aE0", 2)
          elseif viewer == m.winner then result(viewer, "VICTORY", "#FFD27A", "#2a1600E0", 2)
          else result(viewer, "DEFEAT", "#C9A3FF", "#1a0730E0", 2) end
        end
        Wait.time(function()
          local said = m.winner ~= nil and (string.upper(engineNameOf(m.winner)) .. " WINS THE GAME") or "THE GAME IS A DRAW"
          for _, viewer in ipairs(seatedColors(m)) do result(viewer, said, "#FFD27A", "#2a1600E0", 4, #said > 20 and 72 or 96) end
        end, 2)
      end, 2.5)
    end
    -- step 4: the table effects and their sound (nothing found = no UI call at all)
    local counteredSt = {} -- (the spells countered, as the pop-up takes them: for the bundle's "countered" effect)
    for _, st in ipairs(prev.stack) do if countered[st.id] and (st.spell or st.sp) then counteredSt[#counteredSt + 1] = st end end
    local okFx, errFx = pcall(engineFxBoard, m, prev, now, diedIds, exiledIds, counteredSt, lv)
    if not okFx then print("[MTG] table effects: " .. tostring(errFx)) end
  end
  -- a new game: the life counters light up again, nothing carried over (an effect still showing goes off)
  function engineEffectsReset()
    for c, tint in pairs(FX.dimmed) do
      local life = getObjectFromGUID(TRACK[c] or "")
      if life ~= nil then life.setColorTint(tint) end
    end
    FX.dimmed, FX.prev = {}, nil
    FX.gen = FX.gen + 1
    for id in pairs(FX.slotOn) do FX.toggle(id, false) end
    FX.slotOn, FX.slotUntil, FX.slotText, FX.built, FX.jumpNext = {}, {}, {}, false, false
    FX.rigsReset()
  end
end

local rewindOffAt = -100
-- where a board update spends its time (engineProfile.sect: name -> total ms; read over the debug channel)
local sectAt = 0
local function sect(name)
  local now = os.clock()
  local S = engineProfile and engineProfile.sect
  if S ~= nil and name ~= nil then S[name] = (S[name] or 0) + (now - sectAt) * 1000 end
  sectAt = now
end

function engineRender(m)
  if m == nil then return end
  if engineFixHolds ~= nil and engineFixHolds(m) then return end -- (a manual fix has the engine paused: the board waits)
  sect()
  mergeStatic(m)
  engineBoardDiff(m)
  detectPending(m)
  if engineMarkSpecial ~= nil then pcall(engineMarkSpecial, m) end
  if engineMillDetect ~= nil then pcall(engineMillDetect, m) end
  -- (an answered combat question's picks are drawn until the engine's next board says what came of them)
  if m ~= lastTable then engineCombatHeld = {} end
  lastTable = m
  if engineCheckDue ~= nil then pcall(engineCheckDue, m) end
  -- losses and the winner are announced to everyone ("you win the game" cards and "can't lose" effects are the
  -- engine's rules: a player at 0 life who can't lose stays "playing")
  engineStatusSeen = engineStatusSeen or {}
  for _, pl in ipairs(m.players or {}) do
    local was = engineStatusSeen[pl.color or pl.slot]
    if was ~= nil and was ~= pl.status and (pl.status == "lost" or pl.status == "conceded") then
      broadcastToAll("[MTG] " .. tostring(pl.name or pl.color) .. (pl.status == "conceded" and " has conceded." or " has lost the game."), {1, 0.45, 0.35})
    end
    engineStatusSeen[pl.color or pl.slot] = pl.status
  end
  if m.gameOver and not engineOverAnnounced then
    engineOverAnnounced = true
    -- (the bridge's why already names the winner, or says "a draw": said once, "GAME OVER - Blue wins! (AI 1 is at 0
    -- life. Blue wins)" said it twice, review 2026-11-09)
    broadcastToAll("[MTG] GAME OVER - " .. (m.overWhy and (tostring(m.overWhy) .. ".") or (m.winner and (engineNameOf(m.winner) .. " wins!") or "draw.")), {1, 0.85, 0.3})
    if engineGameOverBanner ~= nil then engineGameOverBanner(m) end
    -- (and every question still open closes: "Your priority" stayed up under GAME OVER after a concession, Kykar re-test
    -- new bug 8)
    for c in pairs(enginePrompts) do
      local okClose, errClose = pcall(engineOnPrompt, { color = c, promptId = nil })
      if not okClose then print("[MTG] game over: " .. tostring(errClose)) end
    end
  elseif not m.gameOver then engineOverAnnounced = false end
  sect("status")
  if engineTakeFromPiles ~= nil then pcall(engineTakeFromPiles, m) end
  sect("takeFromPiles")
  keepStashed()
  sect("keepStashed")
  local seen = {}
  enginePlanned = {}
  engineGroupList, engineSubDrawn = {}, {} -- (groupTokens draws them again; a token gone from the board leaves them)
  -- every card something is attached to, on any battlefield (an aura can sit on another player's token)
  local allHosts = {}
  for _, pl in ipairs(m.players or {}) do for _, c in ipairs(pl.battlefield or {}) do if c.att ~= nil then allHosts[c.att] = true end end end
  for _, pl in ipairs(m.players or {}) do
    local color = pl.color
    local g = color and seatGeometry(color)
    if g ~= nil then
      engineColors[color] = true
      local creatures, others, lands, attached = {}, {}, {}, {}
      for _, c in ipairs(pl.battlefield or {}) do
        if c.att ~= nil then attached[#attached + 1] = c
        elseif hasType(c, "Land") then lands[#lands + 1] = c
        elseif hasType(c, "Creature") then creatures[#creatures + 1] = c
        else others[#others + 1] = c end
      end
      creatures = groupTokens(creatures, seen, allHosts)
      others = groupTokens(others, seen, allHosts)
      -- cards carrying auras/equipment get room beside them; the attachments sit there at half size, stacked
      local hosts, perHost = {}, {}
      for _, c in ipairs(attached) do hosts[c.att] = true end
      layoutRow(g, creatures, ROWS.creature, seen, color, hosts)
      layoutRow(g, others, ROWS.other, seen, color, hosts)
      layoutRow(g, lands, ROWS.land, seen, color, hosts)
      sect("battlefield")
      for _, c in ipairs(attached) do
        perHost[c.att] = (perHost[c.att] or 0) + 1
        local k = perHost[c.att]
        local host = enginePlanned[c.att] or gridPos(g, 0, ROWS.other)
        -- toward the next column (the space layoutRow left), first one level with the host's top, then downward
        local spot = host - g.right * (GRID.colStep * (0.5 + ATTACH.extraCols / 2)) + g.fwd * (0.8 - 1.0 * (k - 1)) + Vector(0, 0.02 * k, 0)
        place(c, spot, Vector(0, g.rotY + (c.tap and 90 or 0), 0), seen, nil, { zone = "attached", color = color, host = c.att })
      end
      local pend = enginePending[color]
      local graveShown = pl.graveyard or {}
      if pend ~= nil and #pend.mill > 0 then
        -- held mills lie face up on top of the library, fanned toward the graveyard, so you see what is coming
        graveShown = {}
        local k = 0
        for _, c in ipairs(pl.graveyard or {}) do
          if heldIn(pend.mill, c.id) then
            k = k + 1
            local spot = g.lib + (g.grave - g.lib) * math.min(0.85, 0.25 + 0.12 * (k - 1)) + Vector(0, 0.6 + 0.05 * k, 0)
            place(c, spot, Vector(0, g.rotY, 0), seen, nil, { zone = "heldmill", color = color, from = g.lib + Vector(0, 1.6, 0), k = k })
          else graveShown[#graveShown + 1] = c end
        end
      end
      sect("attached")
      engineZonePile(color, "graveyard", engineWithoutSpecial(graveShown), g.grave, g.rotY, seen)
      engineZonePile(color, "exile", engineWithoutSpecial(pl.exile or {}), g.lib + g.libFwd * 4.16, g.rotY, seen)
      sect("piles")
      local labels = TAX_LABELS[color] or {}
      local k = 0
      for _, c in ipairs(pl.command or {}) do
        local base = nil
        -- (a dungeon has its own spot past the second tax label, the way from the first to the second once more: on a
        -- label it covered a partner commander, docs/planechase-dungeon-engine-spec.md D7)
        if hasType(c, "Dungeon") then
          local first, second = getObjectFromGUID(labels[1] or ""), getObjectFromGUID(labels[2] or "")
          if first ~= nil and second ~= nil then base = second.getPosition() + (second.getPosition() - first.getPosition())
          else base = g.lib - g.libFwd * 2.6 end
        else
          k = k + 1
          local label = getObjectFromGUID(labels[k] or labels[1] or "")
          base = label and label.getPosition() or g.lib
        end
        -- (the dropped spot only while it is being cast; a commander that came back goes to its command zone,
        -- playtest 2026-10-26: Kenrith back in the command zone was still drawn where it had been on the battlefield)
        place(c, (engineManualPlay[c.id] and engineManual[c.id]) or onTable(base), Vector(0, g.rotY, 0), seen, nil, { zone = "command", color = color })
      end
      if pl.hand ~= nil and g.handPos ~= nil and Player[color].seated then
        for _, c in ipairs(pl.hand) do
          if pend ~= nil and heldIn(pend.draw, c.id) then seen[c.id] = true -- still on top of the library
          else place(c, g.handPos + Vector(0, 1, 0), Vector(0, g.rotY, 0), seen, color, { zone = "hand", color = color }) end
        end
      end
      sect("commandHand")
      local heldDraw = enginePendingCount(color)
      engineLibraryDeck(color, g, (pl.library or 0) + heldDraw, seen)
      sect("library")
    end
  end
  -- the planes in play (Planechase, docs/planechase-dungeon-engine-spec.md P9): at the table's centre, raised over the
  -- life trackers, larger, turned to read from the planar controller's seat; that player's buttons on it are a
  -- permanent's (the planar die's roll, as the ability boxes draw them), and a roll's result is a banner
  -- (enginePlanarBanner)
  for i, pc in ipairs(m.planes or {}) do
    local pg = pc.ctl and seatGeometry(pc.ctl) or nil
    place(pc, Vector(4.6 * (i - (#m.planes + 1) / 2), 2.4, 0), Vector(0, ((pg and pg.rotY) or 180) + 90, 0), seen, nil, { zone = "plane", color = pc.ctl })
  end
  pcall(enginePlanarBanner, m)
  local okCtl, errCtl = pcall(engineCtlHands, m, seen) -- (a controlled player's hand, see engineCtlHands)
  if not okCtl then print("[MTG] controlled hand: " .. tostring(errCtl)) end
  local okPop, errPop = pcall(function() enginePopups(m) enginePopupsClose(m) engineEffects(m) end) -- a pop-up problem must never stop the board update
  if not okPop then print("[MTG] pop-up: " .. tostring(errPop)) end
  sect("popups")
  -- The stack floats above its caster's own playmat (the table centre is where the life trackers are), newest on
  -- top and a little to the side, so you can read every spell waiting to resolve.
  local perCaster = {}
  local stackGlow = {}
  local stackSpot = {} -- stack item id -> where its target lines start
  engineFxStackSpot = {} -- stack item id -> its spot on the stack (the next board's effects: where a countered spell stood)
  for i, s in ipairs(m.stack or {}) do
    local g = s.ctl and seatGeometry(s.ctl)
    local n = (perCaster[s.ctl or "?"] or 0) + 1
    perCaster[s.ctl or "?"] = n
    local pos, rot = nil, nil
    if g ~= nil then
      pos = g.mat + g.right * (1.4 * (n - 1) - 2) + Vector(0, 2.5 + 0.1 * i, 0)
      rot = Vector(0, g.rotY, 0)
    else
      pos, rot = Vector(-3 + 1.2 * (i - 1), 3 + 0.1 * i, 0), Vector(0, 180, 0)
    end
    engineFxStackSpot[s.id] = pos
    -- an ability's lines start at its source card, a spell's at its spot on the stack
    local srcObj = s.src and engineObjs[s.src]
    stackSpot[s.id] = (not s.spell and s.src and (enginePlanned[s.src] or (srcObj ~= nil and not srcObj.isDestroyed() and srcObj.getPosition()))) or pos
    local st = s.src and engineStatic[s.src]
    if s.spell and st ~= nil then
      -- the spell's own card moves onto the stack (spawning a new object costs a frame hitch while its picture loads)
      local c = { id = s.src }
      for k, v in pairs(st) do c[k] = v end
      -- a card you dropped on your battlefield to cast waits right there, raised a little
      if engineManual[s.src] ~= nil then pos = engineManual[s.src] + Vector(0, 0.6, 0) end
      place(c, pos, rot, seen, nil, { zone = "stack", color = s.ctl })
    elseif not s.spell and s.src and engineObjs[s.src] ~= nil then
      stackGlow[s.src] = true -- an ability: its source glows purple; the panel lists the stack
    else
      place({ id = "stack:" .. tostring(s.id), n = s.n, tl = "On the stack", tx = s.tx, f = s.f, b = ENGINE_BACK },
        pos, rot, seen, nil, { zone = "stack", color = s.ctl })
    end
  end
  -- what each card glows when no question is open: ability on the stack (purple), attacking (red), blocking (blue).
  -- Everyone sees these, for the whole combat.
  sect("stack")
  if engineScryPlace ~= nil then pcall(engineScryPlace, seen) end
  if enginePlaceSpecial ~= nil then
    local okSp, errSp = pcall(enginePlaceSpecial, m, seen)
    if not okSp then print("[MTG] playable / linked cards: " .. tostring(errSp)) end
  end
  local okRv, errRv = pcall(engineRevealStrip, m, seen)
  if not okRv then print("[MTG] revealed hands: " .. tostring(errRv)) end
  local combat = {}
  for _, pl in ipairs(m.players or {}) do
    for _, c in ipairs(pl.battlefield or {}) do
      if c.atk then combat[c.id] = "atk" elseif c.blk then combat[c.id] = "blk" end
    end
  end
  for id in pairs(engineStackGlow) do if engineObjs[id] == nil then engineStackGlow[id] = nil end end -- gone from the table
  -- a face-down card that may be played only through its permanent (a hideaway card: Mosswort Bridge's needs creatures
  -- with total power 10) doesn't glow as playable; a foretold one does (playtest 2026-10-26)
  local onlyVia = {}
  for _, pl in ipairs(m.players or {}) do for _, c in ipairs(pl.playable or {}) do if c.fd and not c.fo then onlyVia[c.id] = true end end end
  for id, o in pairs(engineObjs) do
    local want = stackGlow[id] and "stack" or combat[id] or (engineSpecial[id] == "playable" and not onlyVia[id] and "playable" or nil)
    if engineStackGlow[id] ~= want and o ~= nil and not o.isDestroyed() then
      engineStackGlow[id] = want
      engineBaseGlow[o] = want and BASE_GLOW[want] or nil
      if not engineGlowOwned(o) then
        if want then o.highlightOn(BASE_GLOW[want]) else o.highlightOff() end
      end
    end
  end
  sect("glow")
  engineManualLanded = engineManualLanded or {}
  engineManualPlay = engineManualPlay or {}
  for id in pairs(engineManual) do
    -- a spell on the stack isn't drawn under its card id; keep the spot it was dropped on until it lands
    local z = seen[id] and engineMeta[id] and engineMeta[id].zone
    if seen[id] and z ~= "battlefield" and z ~= "command" and z ~= "stack" then engineManual[id] = nil engineManualPlay[id] = nil end
    -- a commander that was on the battlefield and went back to the command zone: forget where it was dropped
    if z == "battlefield" then engineManualLanded[id] = true
    elseif z == "command" and engineManualLanded[id] then engineManual[id] = nil engineManualLanded[id] = nil end
  end
  for id, o in pairs(engineObjs) do
    if not seen[id] then
      if o ~= nil and not o.isDestroyed() then op("destroy") engineDispose(o) end
      engineObjs[id] = nil
    end
  end
  local okLn, errLn = pcall(engineDrawLines, m, stackSpot)
  if not okLn then print("[MTG] lines: " .. tostring(errLn)) end
  if engineCombatLunge ~= nil and not engineAnimOff then
    local okLu, errLu = pcall(engineCombatLunge, m)
    if not okLu then print("[MTG] attack lunge: " .. tostring(errLu)) end
  end
  sect("dispose")
  local okRw, errRw = pcall(engineRewindUpdate, m.rewind, m.gameOver)
  if not okRw then print("[MTG] rewind panel: " .. tostring(errRw)) end
  updateTrackers(m)
  sect("trackers")
  if engineRefreshBrowse ~= nil then engineRefreshBrowse() end
  sect("browse")
  engineRenderPanels("none")
  sect("panels")
  if engineSetupButtons ~= nil then pcall(engineSetupButtons) end -- (hidden while a game runs; "New game" after it)
  if enginePlayableGlowAll ~= nil then enginePlayableGlowAll() end
  -- the open questions' ability buttons once their permanents are known: a question that came before the board (after
  -- a reload) had no card on the battlefield yet and drew none (seen 2026-10-26); unchanged lists redraw nothing
  if engineAbilityBoxes ~= nil and enginePromptKind ~= nil then
    for color, q in pairs(enginePrompts) do
      local kind = enginePromptKind(q)
      if (kind == "action" or kind == "attack" or kind == "block" or kind == "target") and q.__abWait ~= false then pcall(engineAbilityBoxes, color, q, kind) end
    end
  end
  if engineFixUpdate ~= nil then
    local okFx, errFx = pcall(engineFixUpdate, m.fix)
    if not okFx then print("[MTG] manual fix: " .. tostring(errFx)) end
  end
end

-- ───────── imported decks step aside during an engine game ─────────
-- The original spot is also written on the object itself (memo), so putting things back works even after a reload
-- lost this script's memory; objects already under the table are never pushed further down. They are invisible to
-- everyone while there: a low camera can see under the table, and a card has no opacity to turn down.
local function stashObject(o)
  if o == nil or stashed[o.getGUID()] then return end
  local p, r = o.getPosition(), o.getRotation()
  if p.y < -5 then return end
  stashed[o.getGUID()] = { pos = p, rot = r, lock = o.getLock() }
  o.memo = string.format("enginestash:%.3f,%.3f,%.3f,%.1f,%.1f,%.1f,%s", p.x, p.y, p.z, r.x, r.y, r.z, tostring(o.getLock()))
  o.setLock(true)
  o.setPosition(p + Vector(0, -15, 0))
  o.setInvisibleTo(engineEveryone())
end

local function stashImported(colors)
  for _, color in ipairs(colors) do
    local zone = data[color] and data[color].libraryZone
    stashObject(zone and getDeckFromZone(zone))
    for _, o in ipairs(Player[color].getHandObjects() or {}) do
      if o.type == "Card" and not tostring(o.getName()):find("Identity") and not tostring(o.getGMNotes()):find("^engine:") then stashObject(o) end
    end
    local anchors = {}
    for _, guid in ipairs(TAX_LABELS[color] or {}) do
      local a = getObjectFromGUID(guid)
      if a then anchors[#anchors + 1] = a.getPosition() end
    end
    for _, o in ipairs(getObjects()) do
      if o.type == "Card" and not tostring(o.getName()):find("Identity") and not tostring(o.getGMNotes()):find("^engine:") then
        local p = o.getPosition()
        for _, a in ipairs(anchors) do
          -- only cards on the table: ones already put away under it must not be pushed down again
          if (p.x - a.x) ^ 2 + (p.z - a.z) ^ 2 < 6.25 and p.y > a.y - 3 then stashObject(o) break end
        end
      end
    end
  end
end

local function restoreStash()
  for guid, s in pairs(stashed) do
    local o = getObjectFromGUID(guid)
    if o ~= nil then o.setInvisibleTo({}) o.setPosition(s.pos) o.setRotation(s.rot) o.setLock(s.lock) o.memo = nil end
    if o ~= nil and o.type == "Deck" then
      for _, e in ipairs(o.getObjects() or {}) do
        if e.gm_notes == "libcard" and o.getQuantity() > 1 then
          o.takeObject({ guid = e.guid, position = o.getPosition() + Vector(0, 3, 0), smooth = false, callback_function = function(x) x.destruct() end })
        end
      end
    end
  end
  stashed = {}
  -- anything still marked (its record was lost in a reload) goes back to the spot written on it
  for _, o in ipairs(getObjects()) do
    local m = tostring(o.memo or "")
    local x, y, z, rx, ry, rz, lock = m:match("^enginestash:([-%d.]+),([-%d.]+),([-%d.]+),([-%d.]+),([-%d.]+),([-%d.]+),(%a+)")
    if x ~= nil then
      o.setInvisibleTo({})
      o.setPosition(Vector(tonumber(x), tonumber(y), tonumber(z)))
      o.setRotation(Vector(tonumber(rx), tonumber(ry), tonumber(rz)))
      o.setLock(lock == "true")
      o.memo = nil
    end
  end
end

-- Every engine card on the table, including ones a reload or undo left behind that this script no longer tracks.
-- They are hidden at once and merged into the trash deck (free), and that deck is thrown away once when the merges
-- have landed: one ~360 ms pause instead of one per card (a 40-card board froze TTS for ~15 s, a late 4-player one
-- for most of a minute). Older trash decks a reload left behind go the same way.
local function sweepEngineCards()
  local current = engineTrash
  for _, o in ipairs(getObjects()) do
    local gm = tostring(o.getGMNotes())
    if gm == "engine:trash" then
      if o ~= current then o.setGMNotes("enginetrash-old") Wait.frames(function() if not o.isDestroyed() then o.destruct() end end, 2) end
    -- library placeholders too: one left lying on the library spot got merged into the player's deck put back there
    elseif engineIsBundleObject(gm) then -- (the effect and sound bundles are the table's: kept)
    elseif gm:find("^engine:") or gm == "enginetrash" or gm == "libcard" then engineDispose(o)
    elseif o.type == "Deck" then
      -- and a deck of nothing but library placeholders, which has no GM notes of its own: TTS made one of cards added
      -- to a library together (the libAdd path before 2026-11-06) and it lay on the library after a reset
      local n, plain = 0, true
      for _, e in ipairs(o.getObjects() or {}) do
        n = n + 1
        if e.gm_notes ~= "libcard" then plain = false break end
      end
      if plain and n > 0 then engineDispose(o) end
    end
  end
  Wait.condition(function()
    local t = engineTrash
    engineTrash = nil -- the next game starts a new trash deck
    if t ~= nil and not t.isDestroyed() then t.setGMNotes("enginetrash-old") Wait.frames(function() if not t.isDestroyed() then t.destruct() end end, 2) end
  end, function() return #trashQueue == 0 and not trashSpawning end, 10)
end

engineGen = 0 -- counts games: callbacks scheduled for an earlier game do nothing

function engineClear()
  engineGen = engineGen + 1
  -- (each open question ends the one way, engineExitPrompt: the ability panel stayed on the normal table after a reset,
  -- stage 3 review 2026-10-27)
  for c in pairs(enginePrompts or {}) do if engineExitPrompt ~= nil then pcall(engineExitPrompt, c) end end
  if engineAbilityReset ~= nil then engineAbilityReset() end
  if engineCountersReset ~= nil then pcall(engineCountersReset) end
  sweepEngineCards()
  engineFlipped, engineStatic, engineSearch, engineSearchIds, engineChoosable = {}, {}, {}, {}, {}
  engineBadge, cardClickAt, engineGroupShown = {}, {}, {}
  if engineResetUi ~= nil then engineResetUi() end -- the panel's per-player state (defined further down)
  engineObjs, engineSpawning, enginePlanned, engineColors, engineInHand, engineFace = {}, {}, {}, {}, {}, {}
  engineMeta, engineManual, engineHeld, lastTurnSet = {}, {}, {}, nil
  engineLifeSeen = {} -- the next game's first board sets the counters without a "-N"
  if engineEffectsReset ~= nil then engineEffectsReset() end -- life counters lit again, no effects carried over
  if enginePileReset ~= nil then enginePileReset() end -- piles, groups and glows: ids repeat in the next game
  lastTable = nil
  enginePlanarRollSeen = nil -- (the next game's planar die rolls count from 1 again)
  enginePrompts = {}
  restoreStash()
  engineRenderPanels()
  -- back to the normal table, except after the NEW GAME button (straight back to READY)
  -- (a start clears the last game's cards, and the bridge's own reset clears again: a one-time flag was used up by the
  -- first clear and the second turned engine mode off, playtest 2026-10-23; it now lasts while the start runs)
  if engineKeepEngineMode then engineKeepUntil = os.clock() + 30 engineKeepEngineMode = nil end
  if ENGINE_MODE and not (engineKeepUntil ~= nil and os.clock() < engineKeepUntil) then setEngineMode(false) end
end

function engineStarted(m)
  paceArmed = {}
  enginePending = {}
  local humans = {}
  for slot, color in pairs(m.colors or {}) do
    local isAI = false
    for _, c in ipairs(m.ai or {}) do if c == color then isAI = true end end
    if not isAI then humans[#humans + 1] = color end
  end
  if lastTable == nil then engineGen = engineGen + 1 sweepEngineCards() end -- a new game: nothing from an earlier one stays behind
  if engineEffectsJump ~= nil then engineEffectsJump() end -- (the bridge sends "started" again before a resend: no effects for it)
  stashImported(humans)
  if not ENGINE_MODE then setEngineMode(true) end
end

-- ───────── prompt panel (added next to the table's own UI, never replacing it) ─────────
-- The panel is built once per seated colour; after that only its texts and buttons are updated. Rebuilding the
-- whole Global UI on every change caused frame hitches and reset the scroll position.
enginePrompts = {}        -- colour -> open prompt from the bridge
local engineSelected = {} -- colour -> { [option index] = true }
-- The panel is hidden unless something opened it (the player playtested it popping up on every card played):
-- "pin" = the player pressed the Choices tab (stays until pressed again), "ask" = a question the table can't answer
-- itself (closes again once that question is gone), "browse" = a side tab opened it (engineOpenTab).
local engineShown = {}    -- colour -> nil | "pin" | "ask" | "browse"
local engineFilter = {}   -- colour -> search text
local engineVisible = {}  -- colour -> { [button slot] = option index }
local baseXml = nil       -- the table's own Global UI, captured once
local builtFor = nil      -- colours the panels were built for, e.g. "White,Red"
local panelReady = false
local uiCache = {}        -- element id .. attribute -> last value set (skip redundant UI calls)
-- option buttons per panel: a longer list pages with its last button ("More..."), and the search box narrows it.
-- (60 until 2026-10-23: a quarter of every seat's screen UI, which four seats need small; past 60 a list was cut off)
local POOL = 30

local function count(t) local n = 0 for _ in pairs(t or {}) do n = n + 1 end return n end

-- Each UI change costs TTS about a millisecond, and a new prompt changes dozens, so every change is one call.
-- Any set on a Button redraws it from the attributes the element holds itself (docs/engine-ui-spec.md 2.1): its label
-- goes back to TTS's dark grey unless the same call carries a textColor, and TTS ignores a textColor equal to the
-- stored one; its background goes back to TTS's white when its colour lived only in a <Defaults> class (the ability
-- panel was grey with dark text, Auto-resolve's text dim, 2026-11-10). So every call carries both: the colour as it is
-- (once on the element, a redraw keeps it), the text colour alternating between two that look the same so it counts.
-- ENGINE_THEME: the colours of the engine's screen UI, taken from the table's own buttons (#1A1A1A, white text).
ENGINE_THEME = { window = "#161616F0", button = "#262626", dock = "#1A1A1A", tabOn = "#3A3022", muted = "#1C1C1C",
  mutedText = "#8C9199", gold = "#FFD27A", text = "#FFFFFF" }
-- The combat parts (docs/engine-ui-spec.md 9): attacking green, being attacked (blocking) red; "On" = picked, the button
-- that attacks or blocks, the word COMBAT in the phase bar. word = the phase bar's rich-text colours.
ENGINE_COMBAT = { attack = "#1F4D2B", attackOn = "#2E9E4F", block = "#5E1E1E", blockOn = "#C62828",
  attackWord = "#7CFC9A", blockWord = "#FF6B6B" }
-- "Resolve N× <name>" (__group): the corner's third button and its line in the Choices panel
ENGINE_GROUP_COLOR = "#6A3D9A"
engineBtnLook = {} -- Button id -> { bg, tc }: the colours its XML gives it (engineRenderPanels)
engineColorFlip = {}
function engineFlipColor(key, hex)
  engineColorFlip[key] = not engineColorFlip[key]
  hex = tostring(hex)
  if not engineColorFlip[key] or not hex:find("^#%x+$") then return hex end
  local last = tonumber(hex:sub(-1), 16)
  return hex:sub(1, -2) .. string.format("%X", last - last % 2 + (1 - last % 2))
end
-- (every Button of the screen XML, recorded as it is built: a list of id patterns had taken in panels too, "^eng_undo"
-- the Undo list and "^eng_scoop" the Concede box, which would now get a button's colour)
local function isButton(id) return engineBtnLook[id] ~= nil end
-- The Buttons of a screen XML and their colours, by plain finds (no pattern with captures over 50 KB: MoonSharp's
-- "pattern too complex"): engineBtnLook[id] = { bg = its color, tc = its textColor }
function engineRecordButtons(xml)
  local pos = 1
  local function attr(tag, key)
    local i = tag:find(" " .. key .. '="', 1, true)
    if i == nil then return nil end
    local s = i + #key + 3
    return tag:sub(s, (tag:find('"', s, true) or #tag + 1) - 1)
  end
  while true do
    local i = xml:find("<Button ", pos, true)
    if i == nil then break end
    local e = xml:find(">", i, true) or #xml
    local tag = xml:sub(i, e)
    local id = attr(tag, "id")
    if id ~= nil then engineBtnLook[id] = { bg = attr(tag, "color"), tc = attr(tag, "textColor") } end
    pos = e + 1
  end
end

-- Applies only the attributes that changed, in one call. attrs: { text = ..., color = ..., active = ... }; the call
-- also carries the button's colour and text colour (see ENGINE_THEME above), except one that only hides it.
local function setButton(id, attrs)
  local changed, n = {}, 0
  for k, v in pairs(attrs) do
    v = tostring(v)
    local key = k == "text" and id or (id .. "|" .. k)
    if uiCache[key] ~= v then
      uiCache[key] = v
      changed[k] = v
      n = n + 1
    end
  end
  if n == 0 then return end
  if not (n == 1 and changed.active == "false") then
    local look = engineBtnLook[id] or {}
    changed.textColor = engineFlipColor(id .. "|tc", uiCache[id .. "|textColor"] or look.tc or "#FFFFFF")
    -- (the colour as it is: once set on the element itself, a redraw keeps it)
    changed.color = uiCache[id .. "|color"] or look.bg or ENGINE_THEME.button
  end
  if engineProfile then engineProfile.uiCalls = engineProfile.uiCalls + 1 end
  UI.setAttributes(id, changed)
end

local function setText(id, text)
  text = tostring(text or "")
  if isButton(id) then return setButton(id, { text = text }) end
  if uiCache[id] == text then return end
  uiCache[id] = text
  if engineProfile then engineProfile.uiCalls = engineProfile.uiCalls + 1 end
  UI.setValue(id, text) -- Text and InputField elements draw their value
end

local function setAttr(id, attr, value)
  if isButton(id) then return setButton(id, { [attr] = value }) end
  value = tostring(value)
  local key = id .. "|" .. attr
  if uiCache[key] == value then return end
  uiCache[key] = value
  if engineProfile then engineProfile.uiCalls = engineProfile.uiCalls + 1 end
  UI.setAttribute(id, attr, value)
end

local function statusText()
  local m = lastTable
  if m == nil then return "" end
  local n = m.activeTurnNo or 1
  local suffix = (n % 10 == 1 and n % 100 ~= 11) and "st" or (n % 10 == 2 and n % 100 ~= 12) and "nd"
    or (n % 10 == 3 and n % 100 ~= 13) and "rd" or "th"
  local s = string.format("%s's %d%s turn (game turn %s) - %s - priority: %s",
    tostring(m.active), n, suffix, tostring(m.turn), tostring(m.step), tostring(m.priority))
  if m.stack and #m.stack > 0 then
    local names = {}
    for i = #m.stack, 1, -1 do names[#names + 1] = m.stack[i].n end
    s = s .. "\nStack (top first): " .. table.concat(names, ", ")
  end
  if m.gameOver then s = "GAME OVER" .. (m.winner and (" - winner: " .. tostring(m.winner)) or "") .. "\n" .. s end
  return s
end

-- Arena-style corner: a big button for the main choice, a smaller one for the second, and the turn's phases.
-- Arena-style card row in the middle of the screen: the cards an order / scry / small "choose a card" question is
-- about, as pictures to click, with that question's buttons under them (pictures: see engineUiImage).
ROW_MAX, ROW_BTNS = 7, 5
local function rowXml(c)
  local tiles, btns = {}, {}
  for k = 1, ROW_MAX do
    local s = c .. "_" .. k
    tiles[#tiles + 1] = '<Panel id="eng_rowslot_' .. s .. '" preferredWidth="180" preferredHeight="300" color="#FFFFFF14" active="false">'
      .. '<Image id="eng_rowimg_' .. s .. '" width="168" height="234" rectAlignment="UpperCenter" offsetXY="0 -6" preserveAspect="true" raycastTarget="false"></Image>'
      .. '<Text id="eng_rowname_' .. s .. '" width="172" height="54" rectAlignment="LowerCenter" offsetXY="0 2" fontSize="13" color="#FFFFFF" alignment="MiddleCenter" raycastTarget="false"> </Text>'
      .. '<Button id="eng_rowbtn_' .. s .. '" onClick="onMtgRow" width="180" height="300" color="#00000000"></Button>'
      .. '</Panel>'
  end
  for k = 1, ROW_BTNS do
    btns[#btns + 1] = '<Button id="eng_rowopt_' .. c .. '_' .. k .. '" onClick="onMtgRowOpt" preferredWidth="220" preferredHeight="44" color="#2e3a59" textColor="#ffffff" fontSize="17" fontStyle="Bold" active="false"> </Button>'
  end
  return '<Panel id="eng_row_' .. c .. '" visibility="' .. c .. '" width="720" height="470" rectAlignment="MiddleCenter" offsetXY="0 60" color="#161616E8" allowDragging="true" returnToOriginalPositionWhenReleased="false" active="false">'
    -- (title and line sized to the panel: at 1300 px wide a long line ran off both edges, 2026-10-22)
    .. '<Text id="eng_rowtitle_' .. c .. '" width="700" height="34" rectAlignment="UpperCenter" offsetXY="0 -8" fontSize="22" resizeTextForBestFit="true" resizeTextMinSize="14" resizeTextMaxSize="22" fontStyle="Bold" color="#FFD27A" alignment="MiddleCenter"> </Text>'
    .. '<Text id="eng_rowsub_' .. c .. '" width="690" height="42" rectAlignment="UpperCenter" offsetXY="0 -42" fontSize="14" resizeTextForBestFit="true" resizeTextMinSize="10" resizeTextMaxSize="14" horizontalOverflow="Wrap" color="#D8DEE8" alignment="MiddleCenter"> </Text>'
    .. '<HorizontalLayout width="1360" height="300" rectAlignment="UpperCenter" offsetXY="0 -88" spacing="12" childAlignment="MiddleCenter" childForceExpandWidth="false" childForceExpandHeight="false">'
    .. table.concat(tiles) .. '</HorizontalLayout>'
    .. '<HorizontalLayout width="1300" height="44" rectAlignment="LowerCenter" offsetXY="0 16" spacing="12" childAlignment="MiddleCenter" childForceExpandWidth="false" childForceExpandHeight="false">'
    .. table.concat(btns) .. '</HorizontalLayout></Panel>\n'
end

-- Rewind by vote (M4.5): the Undo tab lists the engine's restore points (engineSidePrompt); a vote pop-up asks the
-- other players. Auto-resolve sits in the dock's row, right of the tabs (docs/engine-ui-spec.md 3).
local function rewindXml(c)
  return '<Button id="eng_autores_' .. c .. '" onClick="onMtgAutoResolve" visibility="' .. c .. '" width="150" height="30" rectAlignment="UpperLeft" offsetXY="468 -140" color="#1A1A1A" textColor="#ffffff" fontSize="14" tooltip="Pass priority by itself: on other players\' turns, or until a phase you pick" active="false">Auto-resolve: off...</Button>\n'
    .. '<Panel id="eng_vote_' .. c .. '" visibility="' .. c .. '" width="600" height="146" rectAlignment="UpperCenter" offsetXY="0 -120" color="#161616F0" active="false">'
    .. '<Text id="eng_votetext_' .. c .. '" width="580" height="84" rectAlignment="UpperCenter" offsetXY="0 -6" fontSize="18" color="#FFFFFF" alignment="MiddleCenter"> </Text>'
    .. '<HorizontalLayout width="440" height="40" rectAlignment="LowerCenter" offsetXY="0 10" spacing="16" childForceExpandWidth="true">'
    .. '<Button id="eng_voteyes_' .. c .. '" onClick="onMtgVote" color="#2e7d32" textColor="#ffffff" fontSize="18" fontStyle="Bold" active="false">Rewind</Button>'
    .. '<Button id="eng_voteno_' .. c .. '" onClick="onMtgVote" color="#8e2a2a" textColor="#ffffff" fontSize="18" fontStyle="Bold" active="false">Keep playing</Button>'
    .. '<Button id="eng_votego_' .. c .. '" onClick="onMtgVote" color="#2e7d32" textColor="#ffffff" fontSize="18" fontStyle="Bold" active="false">Rewind</Button>'
    .. '</HorizontalLayout></Panel>\n'
end

-- Scoop (concede): a screen button beside the player's name at the top, only for that player and only in a game;
-- it opens a big "Concede this game?" box with Scoop / Keep playing (screen UI: readable from any camera angle)
local function scoopXml(c)
  return '<Button id="eng_scoop_' .. c .. '" onClick="onMtgScoopAsk" visibility="' .. c .. '" width="120" height="40" rectAlignment="UpperCenter" offsetXY="250 -118" color="#c62828" textColor="#ffffff" fontSize="18" fontStyle="Bold" active="false">Scoop</Button>\n'
    .. '<Panel id="eng_scoopask_' .. c .. '" visibility="' .. c .. '" width="620" height="230" rectAlignment="MiddleCenter" offsetXY="0 40" color="#161616F2" active="false">'
    .. '<Text width="600" height="110" rectAlignment="UpperCenter" offsetXY="0 -10" fontSize="30" fontStyle="Bold" color="#FFFFFF" alignment="MiddleCenter">Concede this game?</Text>'
    .. '<HorizontalLayout width="560" height="70" rectAlignment="LowerCenter" offsetXY="0 22" spacing="24" childForceExpandWidth="true">'
    .. '<Button id="eng_scoopyes_' .. c .. '" onClick="onMtgScoopYes" color="#c62828" textColor="#ffffff" fontSize="26" fontStyle="Bold">Scoop</Button>'
    .. '<Button id="eng_scoopno_' .. c .. '" onClick="onMtgScoopNo" color="#2e3a59" textColor="#ffffff" fontSize="26" fontStyle="Bold">Keep playing</Button>'
    .. '</HorizontalLayout></Panel>\n'
end

local function cornerXml(c)
  return rowXml(c) .. rewindXml(c) .. scoopXml(c) .. (engineFixXml ~= nil and engineFixXml(c) or "")
    -- M5: VICTORY / DEFEAT / "<NAME> IS OUT", big, in the middle of the screen
    .. '<Text id="eng_result_' .. c .. '" visibility="' .. c .. '" width="1600" height="200" rectAlignment="MiddleCenter" offsetXY="0 120" fontSize="120" fontStyle="Bold" color="#FFD27A" outline="#2a1600E0" outlineSize="4 -4" alignment="MiddleCenter" showAnimation="Grow" hideAnimation="FadeOut" animationDuration="0.35" active="false"> </Text>\n'
    .. '<Panel id="eng_phasebg_' .. c .. '" visibility="' .. c .. '" width="900" height="46" rectAlignment="UpperCenter" offsetXY="0 -64" color="#161616C8" active="false"></Panel>'
    .. '<Text id="eng_phase_' .. c .. '" visibility="' .. c .. '" width="900" height="46" rectAlignment="UpperCenter" offsetXY="0 -64" fontSize="22" color="#B8C0CC" alignment="MiddleCenter" active="false"> </Text>\n'
    -- Arena-style instruction line above the corner buttons (at the top it ran into TTS's name tags): what the open question wants, in table terms
    .. '<Text id="eng_hint_' .. c .. '" visibility="' .. c .. '" width="620" height="130" rectAlignment="LowerRight" offsetXY="-20 196" fontSize="18" fontStyle="Italic" color="#F2F2F2" outline="#000000C0" outlineSize="1 -1" alignment="LowerRight" active="false"> </Text>\n'
    -- big turn banner in the middle of the screen when the turn changes
    .. '<Text id="eng_banner_' .. c .. '" visibility="' .. c .. '" width="1200" height="120" rectAlignment="MiddleCenter" offsetXY="0 80" fontSize="64" fontStyle="Bold" color="#FFD27A" outline="#2a1600E0" outlineSize="3 -3" alignment="MiddleCenter" showAnimation="FadeIn" hideAnimation="FadeOut" animationDuration="0.25" active="false"> </Text>\n'
    -- the third, above the second, only while the bridge offers "Resolve N× <name>" (__group: the run of the same
    -- trigger on top of the stack, the user 2026-11-12); purple, apart from the orange Resolve and navy Resolve all
    .. '<Button id="eng_big3_' .. c .. '" onClick="onMtgBig3" visibility="' .. c .. '" width="280" height="44" rectAlignment="LowerRight" offsetXY="-20 190" color="' .. ENGINE_GROUP_COLOR .. '" textColor="#ffffff" fontSize="18" active="false"> </Button>\n'
    .. '<Button id="eng_big2_' .. c .. '" onClick="onMtgBig2" visibility="' .. c .. '" width="280" height="44" rectAlignment="LowerRight" offsetXY="-20 140" color="#2e3a59" textColor="#ffffff" fontSize="18" active="false"> </Button>\n'
    .. '<Button id="eng_big_' .. c .. '" onClick="onMtgBig" visibility="' .. c .. '" width="280" height="64" rectAlignment="LowerRight" offsetXY="-20 70" color="#e8711a" textColor="#ffffff" fontSize="26" fontStyle="Bold" active="false"> </Button>\n'
    .. engineAbPanelXml(c)
end
-- The actions of the card you point at, as big buttons on the screen (engineAbPanelShow): the buttons on the card are
-- a few pixels tall at the usual camera, and its right-click menu opened under the top bars (hp-07, 2026-10-27). Since
-- batch B every ability, greyed with its reason when it can't be used, ENGINE_AB_MAX a page with More (eng_abpg_) and a
-- close X (eng_abpx_); the panel grows up from its foot to fit its lines.
ENGINE_AB_MAX = 6
function engineAbPanelXml(c)
  local rows = {}
  for k = 1, ENGINE_AB_MAX do
    rows[#rows + 1] = '<Button id="eng_abp_' .. c .. '_' .. k .. '" onClick="onMtgAbPanel" preferredHeight="40" fontSize="14" textAlignment="MiddleLeft" color="#262626" textColor="#ffffff" active="false"> </Button>'
  end
  return '<Panel id="eng_abp_' .. c .. '" visibility="' .. c .. '" width="440" height="320" rectAlignment="LowerRight" offsetXY="-20 272" color="#161616F0" active="false">'
    .. '<VerticalLayout padding="8 8 6 6" spacing="4" childForceExpandHeight="false" childAlignment="LowerCenter">'
    .. '<Text id="eng_abpt_' .. c .. '" preferredHeight="24" fontSize="16" fontStyle="Bold" color="#FFD27A" alignment="MiddleLeft"> </Text>'
    .. table.concat(rows)
    .. '<Button id="eng_abpg_' .. c .. '" onClick="onMtgAbPanel" preferredHeight="30" fontSize="13" color="#333333" textColor="#ffffff" active="false"> </Button>'
    .. '</VerticalLayout>'
    .. '<Button id="eng_abpx_' .. c .. '" onClick="onMtgAbPanel" width="28" height="28" rectAlignment="UpperRight" offsetXY="-6 -6" color="#333333" textColor="#ffffff" fontSize="15" fontStyle="Bold" tooltip="Close">X</Button></Panel>\n'
end

-- A spell or ability going on the stack pops up for everyone, with its picture and text (Arena-style).
local POPUP_XML = '<Panel id="eng_pop" width="300" height="500" rectAlignment="MiddleRight" offsetXY="-30 40" color="#161616E8" active="false">'
  .. '<VerticalLayout padding="8 8 8 8" spacing="6" childForceExpandHeight="false">'
  .. '<Text id="eng_pop_who" fontSize="14" color="#FFD27A" alignment="MiddleCenter" preferredHeight="22"> </Text>'
  .. '<Image id="eng_pop_img" preferredHeight="390" preserveAspect="true" color="#FFFFFF"></Image>'
  .. '<Text id="eng_pop_text" fontSize="12" color="#FFFFFF" alignment="UpperLeft" preferredHeight="70"> </Text>'
  .. '</VerticalLayout>'
  .. '<Button id="eng_pop_x" onClick="onMtgPopClose" width="34" height="34" rectAlignment="UpperRight" offsetXY="-4 -4" color="#333333" textColor="#ffffff" fontSize="20" fontStyle="Bold" tooltip="Close (only for you)">X</Button>'
  .. '</Panel>'

local function panelXml(color)
  local slots = {}
  for k = 1, POOL do
    slots[#slots + 1] = string.format('<Button id="eng_opt_%s_%d" onClick="onMtgSlot" active="false" minHeight="32" fontSize="14" color="#262626" textColor="#ffffff"> </Button>', color, k)
  end
  local c = color
  -- The dock (batch B, docs/engine-ui-spec.md 3): the window's tabs and the log's switch in one row at the top left,
  -- under TTS's own menu and right of its left tool bar (82 px wide); Auto-resolve and Fix follow at x 468 and 622. (At
  -- the top right these covered the first items of the cards' right-click menus, playtest 2026-10-26; at the bottom
  -- left they sat on the hand and the chat, playtest 2026-10-31.) Undo shows only with restore points; the row closes up.
  local function tab(id, fn, w, label)
    return '<Button id="' .. id .. c .. '" onClick="' .. fn .. '" preferredWidth="' .. w .. '" color="#1A1A1A" textColor="#ffffff" fontSize="14" active="false">' .. label .. '</Button>'
  end
  return '<HorizontalLayout id="eng_dock_' .. c .. '" visibility="' .. c .. '" width="364" height="30" rectAlignment="UpperLeft" offsetXY="96 -140" spacing="4" childAlignment="MiddleLeft" childForceExpandWidth="false" childForceExpandHeight="true">'
    .. tab("eng_toggle_", "onMtgToggle", 76, "Choices") .. tab("eng_browse_", "onMtgBrowse", 92, "Graveyards")
    .. tab("eng_undo_", "onMtgUndo", 56, "Undo") .. tab("eng_set_", "onMtgSettings", 76, "Settings")
    .. tab("eng_logbtn_", "onMtgLog", 48, "Log") .. '</HorizontalLayout>\n'
    .. '<Panel id="eng_log_' .. c .. '" visibility="' .. c .. '" width="430" height="290" rectAlignment="UpperRight" offsetXY="-10 -150" color="#161616D0" allowDragging="true" returnToOriginalPositionWhenReleased="false" active="false">'
    .. '<Text id="eng_logtext_' .. c .. '" width="414" height="280" fontSize="13" color="#FFFFFF" alignment="LowerLeft"> </Text></Panel>\n'
    .. '<Panel id="eng_panel_' .. c .. '" visibility="' .. c .. '" width="430" height="600" rectAlignment="UpperLeft" offsetXY="96 -176" color="#161616F0" allowDragging="true" returnToOriginalPositionWhenReleased="false" active="false">\n'
    .. '  <VerticalLayout padding="8 8 8 8" spacing="5" childForceExpandHeight="false">\n'
    .. '    <Text id="eng_status_' .. c .. '" fontSize="13" color="#FFFFFF" alignment="UpperLeft" preferredHeight="44"> </Text>\n'
    .. '    <Text id="eng_title_' .. c .. '" fontSize="17" fontStyle="Bold" color="#FFFFFF" alignment="MiddleLeft" preferredHeight="26">Waiting for other players...</Text>\n'
    .. '    <Text id="eng_text_' .. c .. '" fontSize="13" color="#FFFFFF" alignment="UpperLeft" preferredHeight="46"> </Text>\n'
    .. '    <InputField id="eng_search_' .. c .. '" onValueChanged="onMtgSearch" placeholder="Search..." preferredHeight="30" fontSize="14" active="false"></InputField>\n'
    .. engineCombatTabsXml(c)
    .. '    <VerticalScrollView id="eng_scroll_' .. c .. '" preferredHeight="318" flexibleHeight="0" color="#FFFFFF0A" scrollSensitivity="120">\n'
    .. '      <VerticalLayout contentSizeFitter="vertical" childForceExpandHeight="false" spacing="4" padding="4 14 4 4">\n'
    .. table.concat(slots, "\n") .. '\n'
    .. '      </VerticalLayout>\n'
    .. '    </VerticalScrollView>\n'
    .. '    <HorizontalLayout preferredHeight="36" spacing="6" childForceExpandWidth="true">\n'
    .. '      <Button id="eng_confirm_' .. c .. '" onClick="onMtgConfirm" active="false" color="#1e6f5c" textColor="#ffffff" fontSize="15">Done</Button>\n'
    .. '      <Button id="eng_cancel_' .. c .. '" onClick="onMtgCancel" active="false" color="#8b1e1e" textColor="#ffffff" fontSize="15">Cancel</Button>\n'
    .. '    </HorizontalLayout>\n'
    .. '    <HorizontalLayout id="eng_stops_' .. c .. '" preferredHeight="30" spacing="4" childForceExpandWidth="true">'
    .. '<Button id="eng_stop_start_' .. c .. '" onClick="onMtgStop" color="#262626" textColor="#ffffff" fontSize="12">Stop: start of turn</Button>'
    .. '<Button id="eng_stop_combat_' .. c .. '" onClick="onMtgStop" color="#262626" textColor="#ffffff" fontSize="12">Stop: combat</Button>'
    .. '<Button id="eng_stop_end_' .. c .. '" onClick="onMtgStop" color="#262626" textColor="#ffffff" fontSize="12">Stop: end of turn</Button>'
    .. '<Button id="eng_stop_hold_' .. c .. '" onClick="onMtgStop" color="#262626" textColor="#ffffff" fontSize="12" tooltip="Keep priority once after something goes on the stack">Hold</Button>'
    .. '</HorizontalLayout>\n'
    .. '  </VerticalLayout>\n'
    .. '</Panel>'
end

-- Options of the open prompt as { index, label }; numbers for number prompts.
local function optionList(p, filter)
  local list = {}
  if p.mode == "number" then
    -- every number in range that matches the search (the search box finds 99 in 0-100), the first 1000 (paged)
    for n = p.min or 0, p.max or 0 do
      local label = tostring(n)
      if filter == nil or filter == "" or label:find(filter, 1, true) then list[#list + 1] = { index = n, label = label } end
      if #list >= 1000 then break end
    end
    return list
  end
  for i, o in ipairs(p.options or {}) do list[#list + 1] = { index = i, label = tostring(o.label or o.id or "?") } end
  return list
end

-- Button colours: the default answer orange, End turn navy, attackers green, blockers red (brighter once picked).
local KIND_OLD_TITLES = { { "^Pay ", "mana" }, { "^Declare attackers", "attack" }, { "^Declare blockers", "block" },
  { "^Mulligan", "mulligan" }, { "^Put %d", "mulliganPutBack" }, { "^Dice", "dice" } }
-- { kind = the engine's question type ("priority", "mana", "attack", "cards", "order", ...), toLibrary = the chosen
-- cards go to the library }. Kept on the prompt (p.__view) until it changes.
-- How many options are only pictures: cards with no object on the table (in a graveyard or exile pile). A question
-- with more than the card row holds is picked in the Engine panel (hp-07 #41 2026-10-27); cards in a hand or on the
-- battlefield are clicked on the table however many there are.
-- (inside a pile deck, engineInPile: a token folded into its group or a card still spawning has no object either, and
-- opened the panel for a plain "sacrifice a creature", suite review 2026-10-27)
function enginePileOnly(p)
  local n = 0
  for _, o in ipairs((p and p.options) or {}) do
    if o.img ~= nil and engineInPile ~= nil and engineInPile[(tostring(o.id):gsub("^card|", ""))] then n = n + 1 end
  end
  return n
end
-- "panel" when a question's choices can only be made in the Engine panel: more pile pictures than the card row
-- holds, or a life payment whose buttons don't fit the row; else nil. Read by the panel's open check and the hints
-- (they had drifted: the panel opened while the hint said "Click a glowing card", suite review 2026-10-27).
function engineAnswerPlace(p)
  if p == nil then return nil end
  if enginePileOnly(p) > ROW_MAX then return "panel" end
  if engineLifePayOption(p) ~= nil then
    local n = 0
    for _, o in ipairs(p.options or {}) do local id = tostring(o.id) if not id:find("^tap:") and not id:find("^untap:") then n = n + 1 end end
    if n > ROW_BTNS then return "panel" end
  end
  return nil
end
-- The option of a payment that pays with life (the bridge's "Pay N life" for a Phyrexian cost), or nil
function engineLifePayOption(p)
  for i, o in ipairs((p and p.options) or {}) do
    if o.id == "pay-life" or tostring(o.label or ""):find("^Pay %d+ life$") then return i end
  end
end
function describePrompt(p)
  if p == nil then return nil end
  if p.__view ~= nil then return p.__view end
  local v = {}
  if p.kind ~= nil then
    v.kind = tostring(p.kind)
    v.toLibrary = p.dest == "library"
  else
    local t = tostring(p.title or "")
    if t == "Your priority" then v.kind = "priority" end
    for _, r in ipairs(KIND_OLD_TITLES) do if v.kind == nil and t:find(r[1]) then v.kind = r[2] end end
    -- and from the question's shape: Yes/No, a lone OK (something revealed), a number
    local ids = {}
    for _, o in ipairs(p.options or {}) do ids[#ids + 1] = tostring(o.id) end
    if v.kind == nil and #ids == 2 and ((ids[1] == "yes" and ids[2] == "no") or (ids[1] == "no" and ids[2] == "yes")) then v.kind = "yesno" end
    if v.kind == nil and #ids == 1 and ids[1] == "ok" then v.kind = "reveal" end
    if v.kind == nil and p.mode == "number" then v.kind = "number" end
    v.toLibrary = engineToLibrary(t)
  end
  p.__view = v
  return v
end

function optionColor(p, index, picked)
  local o = (p.options or {})[index] or {}
  if o.tint ~= nil then return o.tint end -- (a side tab's line that sets its own, engineSidePrompt)
  local kind = describePrompt(p).kind
  -- (combat clarity, the user 2026-11-09: the attack parts green, the block parts red, as you are the one attacked;
  -- docs/engine-ui-spec.md 9)
  if o.id == "__allattack" then return ENGINE_COMBAT.attackOn end
  if o.id == "__noattack" then return "#2e3a59" end
  if kind == "attack" then return picked and ENGINE_COMBAT.attackOn or ENGINE_COMBAT.attack end
  if kind == "block" then return picked and ENGINE_COMBAT.blockOn or ENGINE_COMBAT.block end
  -- Arena-style, same colours as the corner buttons and the card row: orange main choice, blue alternative,
  -- red for what you picked
  if picked then return "#E53935" end
  if o.id == "__endturn" then return "#2e3a59" end
  if o.id == "__resolve" then return "#b8860b" end -- yellow: pass until the stack is empty
  if o.id == "__group" then return ENGINE_GROUP_COLOR end -- purple, as its corner button
  if p.mode == "single" and index == 1 then return "#e8711a" end
  return "#262626"
end

-- "Graveyards / exile" view: every player's graveyard and exile as a searchable, look-only list in the panel.
engineBrowse = {}     -- colour -> true while that player browses graveyards and exile
local browseCards = {} -- colour -> list shown, { label, card }
local function browsePrompt(color)
  local list, options = {}, {}
  for _, pl in ipairs((lastTable and lastTable.players) or {}) do
    local who = (pl.color == color) and "Your" or ((pl.name or pl.color or "?") .. "'s")
    for _, z in ipairs({ { "graveyard", "graveyard" }, { "exile", "exile" } }) do
      for i = #(pl[z[1]] or {}), 1, -1 do -- newest first
        local c = pl[z[1]][i]
        if c.n ~= nil then list[#list + 1] = { label = c.n .. "   (" .. who .. " " .. z[2] .. ")", card = c } end
      end
    end
  end
  browseCards[color] = list
  for i, e in ipairs(list) do options[i] = { id = "browse:" .. i, label = e.label } end
  return { title = "Graveyards and exile (look only)", mode = "browse",
    text = #list == 0 and "Nothing in any graveyard or exile yet." or "Click a card to read it. Search by name or by whose it is.",
    options = options }
end
-- The open side tab's list (engineOpenTab), shown in the window's answer buttons like a question of mode "browse":
-- Undo's restore points, Settings' switches (each line says what it is now), else the graveyards. nosearch: no box.
function engineSidePrompt(color)
  local tab = engineBrowse[color]
  if tab == "undo" then
    local o = {}
    for k, pt in ipairs((engineRewind and engineRewind.points) or {}) do o[k] = { id = "undo:" .. k, label = tostring(pt.label) } end
    return { title = "Rewind to... (the others vote)", mode = "browse", nosearch = true, options = o,
      text = #o == 0 and "No restore points yet." or "Pick a moment to go back to: the other players vote on it." }
  elseif tab == "settings" then
    -- (the host's switch: what moves on the table is the same for everyone; others see it greyed and can't press it)
    local host = Player[color] ~= nil and Player[color].host
    return { title = "Settings", mode = "browse", nosearch = true,
      text = "My effects: banners, the stack pop-up and table effects, for you only. Sounds and animations are shared: the host's.",
      options = {
        { id = "fx", label = engineEffectsOff[color] and "My effects: off" or "My effects: on" },
        { id = "snd", label = engineSoundOff[color] and "My sounds: off" or "My sounds: on" },
        { id = "anim", label = "Table animations: " .. (engineAnimOff and "off" or "on") .. (host and "" or " (the host's)"), tint = not host and ENGINE_THEME.muted or nil },
        { id = "pace", label = "Draw / mill / untap by itself: " .. (engineAutoOn(color) and ("on (" .. AUTO_PACE_DELAY .. " s)") or "off") } } }
  end
  return browsePrompt(color)
end

-- The corner's two buttons mirror the prompt: the first (default) choice big, a second useful one small.
local PHASES = { { "upkeep", "Upkeep" }, { "draw", "Draw" }, { "main1", "Main 1" }, { "combat", "Combat" }, { "main2", "Main 2" }, { "end", "End" } }
engineCorner = {} -- colour -> { big = option index or "confirm", small = option index, group = __group's index }
-- A question that puts cards on top or at the bottom of your library ("Put 1 on the bottom"): whole words only, so a
-- card named "Treetop Village" in the title doesn't count.
function engineToLibrary(title)
  local low = " " .. tostring(title or ""):lower() .. " "
  return low:find("%f[%a]bottom%f[%A]") ~= nil or low:find("%f[%a]top%f[%A]") ~= nil
end

-- What the screen calls a player: the Steam name of whoever sits at that colour (as the chat does), an AI player's name
-- ("AI 1"), else the colour (playtest 2026-10-26: "replace Red's turn with the player's name sitting in red").
function engineNameOf(c)
  if c == nil then return "" end
  local pl = Player[c]
  if pl ~= nil and pl.seated and pl.steam_name ~= nil and pl.steam_name ~= "" then return pl.steam_name end
  for _, x in ipairs((lastTable and lastTable.players) or {}) do
    if x.color == c and x.name ~= nil and x.name ~= c then return tostring(x.name) end
  end
  return tostring(c)
end
-- The step you were just asked in, as a banner like YOUR TURN: only for a real question (your priority) and never with
-- Auto-resolve on (playtest 2026-10-26: "what part of your turn ... shouldn't pop up if you have auto pass on or if
-- you don't have any priority"). Combat once per combat. Cleanup has no priority: its banner comes with the
-- discard-to-hand-size question instead (it showed END while asking to discard, playtest 2026-10-26).
engineStepNames = { upkeep = "UPKEEP", draw = "DRAW", main1 = "MAIN PHASE 1", main2 = "MAIN PHASE 2", ["end"] = "END STEP",
  endOfTurn = "END STEP", cleanup = "CLEANUP" }
engineStepSeen = {}
function engineStepBanner(color, t)
  if t == nil or engineEffectsOff[color] or engineAutoResolve[color] or engineSkipTo[color] then return end
  local step = tostring(t.step or "")
  local label = engineStepNames[step] or (step:find("^combat") and "COMBAT") or nil
  if label == nil then return end
  local key = tostring(t.turn) .. "|" .. label
  if engineStepSeen[color] == key then return end
  engineStepSeen[color] = key
  local show = function()
    if engineStepSeen[color] ~= key then return end
    setText("eng_banner_" .. color, label)
    setAttr("eng_banner_" .. color, "color", "#FFFFFF")
    setAttr("eng_banner_" .. color, "outline", "#101010E0")
    setAttr("eng_banner_" .. color, "active", "true")
    Wait.time(function() if engineStepSeen[color] == key then setAttr("eng_banner_" .. color, "active", "false") end end, 1.1)
  end
  -- (after the turn banner, not over it)
  local since = engineBannerAt and engineBannerAt[color] and (os.clock() - engineBannerAt[color]) or 99
  if since < 1.7 then Wait.time(show, 1.7 - since) else show() end
end
-- On screen when the game ends, like YOUR TURN (the board just stood still with its attack lines, playtest 2026-10-26)
-- (the big VICTORY / DEFEAT, then "<NAME> WINS THE GAME", is the table effects' result banner; this step banner says the
-- same for a player who turned the effects off, so nobody sees two at once (both showed together, item 14 2026-11-10))
-- A planar die roll's result on everyone's screen for 4 s: CHAOS, PLANESWALK or BLANK (Planechase, the board's
-- planar.last, said once by its sequence number; a jump board, a rewind or a reload, only records it)
enginePlanarRollSeen = nil
function enginePlanarBanner(m)
  local last = m.planar and m.planar.last
  if last == nil or last.seq == nil or last.seq == enginePlanarRollSeen then return end
  enginePlanarRollSeen = last.seq
  if m.jump then return end
  local word = string.upper(tostring(last.result or ""))
  if word == "" then return end
  for _, c in ipairs(getSeatedPlayers()) do
    if Player[c] ~= nil then
      setText("eng_banner_" .. c, word)
      setAttr("eng_banner_" .. c, "color", word == "CHAOS" and "#FF9A6B" or word == "PLANESWALK" and "#C9A7FF" or "#FFFFFF")
      setAttr("eng_banner_" .. c, "outline", "#101010E0")
      setAttr("eng_banner_" .. c, "active", "true")
      Wait.time(function() if enginePlanarRollSeen == last.seq then setAttr("eng_banner_" .. c, "active", "false") end end, 4)
    end
  end
end
function engineGameOverBanner(m)
  for _, c in ipairs(getSeatedPlayers()) do
    if Player[c] ~= nil and engineEffectsOff[c] then
      -- (a step banner's own timer, shown just before the game ended, would hide this one: its key no longer matches)
      engineStepSeen[c] = "over"
      if engineBannerSeen ~= nil then engineBannerSeen[c] = "over" end
      setText("eng_banner_" .. c, m.winner == nil and "DRAW" or (m.winner == c and "VICTORY" or "DEFEAT"))
      setAttr("eng_banner_" .. c, "color", m.winner == c and "#FFD27A" or "#D6E4FF")
      setAttr("eng_banner_" .. c, "outline", "#101010E0")
      setAttr("eng_banner_" .. c, "active", "true")
      Wait.time(function()
        setText("eng_banner_" .. c, m.winner == nil and "THE GAME IS A DRAW" or (string.upper(engineNameOf(m.winner)) .. " WINS THE GAME"))
        Wait.time(function() setAttr("eng_banner_" .. c, "active", "false") end, 4)
      end, 2)
    end
  end
end
-- What a target question offers: { cards, players, spells, walkers }, walkers true when it offers cards and every one
-- is a planeswalker ("target player or planeswalker": the hint names both, item 24 2026-11-11). One reading for the
-- hint and for the click on a card the question leaves out.
function engineTargetSorts(q)
  local s = { cards = false, players = false, spells = false, walkers = true }
  for _, o in ipairs((q and q.options) or {}) do
    local id = tostring(o.id)
    if id:find("^player|") then s.players = true
    elseif id:find("^spell|") then s.spells = true
    elseif id:find("^card|") then
      s.cards = true
      if not hasType(engineStatic[id:sub(6)] or {}, "Planeswalker") then s.walkers = false end
    end
  end
  s.walkers = s.cards and s.walkers
  return s
end
-- Which side of the combat a player is on now: "attack" on their own turn, "block" while a creature attacks them or
-- one of their planeswalkers (or a blockers question is theirs), else nil. Read from the board (atk / atkT).
function engineCombatSide(color, t)
  if t == nil or not tostring(t.step or ""):find("^combat") then return nil end
  if t.active == color then return "attack" end
  local q = enginePrompts[color]
  if q ~= nil and describePrompt(q).kind == "block" then return "block" end
  for _, pl in ipairs(t.players or {}) do
    for _, c in ipairs(pl.battlefield or {}) do
      if c.atk and c.atkT ~= nil and (c.atkT == color or (engineMeta[c.atkT] or {}).color == color) then return "block" end
    end
  end
  return nil
end
function engineUpdateCorner(color, p)
  local t = lastTable
  local step = tostring(t and t.step or "")
  local parts = {}
  for _, ph in ipairs(PHASES) do
    local here = step == ph[1] or (ph[1] == "combat" and step:find("^combat")) or (ph[1] == "end" and (step == "end" or step == "cleanup" or step == "endOfTurn"))
    local name = (here and step == "cleanup") and "Cleanup" or ph[2]
    -- (COMBAT green on your own turn, red while you are the one attacked: combat clarity, docs/engine-ui-spec.md 9)
    local side = (here and ph[1] == "combat") and engineCombatSide(color, t) or nil
    local gold = side == "attack" and ENGINE_COMBAT.attackWord or side == "block" and ENGINE_COMBAT.blockWord or "#FFD27A"
    parts[#parts + 1] = here and ("<b><color=" .. gold .. ">" .. string.upper(name) .. "</color></b>") or name
  end
  local whose = t and t.active and ((t.active == color) and "<b><color=#7CFC9A>YOUR TURN</color></b>" or ("<b>" .. string.upper(engineNameOf(t.active)) .. "'S TURN</b>")) or ""
  setAttr("eng_phase_" .. color, "active", t ~= nil and "true" or "false")
  setAttr("eng_phasebg_" .. color, "active", t ~= nil and "true" or "false")
  -- day or night, once a daybound card has made it one (nothing showed it, playtest 2026-10-26)
  local day = (t and t.day == "day") and "      <b><color=#FFE08A>DAY</color></b>" or ((t and t.day == "night") and "      <b><color=#9FB4FF>NIGHT</color></b>" or "")
  -- (and the plane in play, Planechase: after DAY or NIGHT, docs/planechase-dungeon-engine-spec.md P9)
  for _, pc in ipairs((t and t.planes) or {}) do
    local st = engineStatic[pc.id] or pc
    day = day .. "      <b><color=#C9A7FF>" .. (hasType(st, "Phenomenon") and "PHENOMENON: " or "PLANE: ") .. string.upper(tostring(st.n or "?")) .. "</color></b>"
  end
  -- (a finished game shows no turn: the bar read "YOUR TURN ... MAIN 1" after the engine ended Kykar's game, #16)
  if t ~= nil and t.gameOver then
    setText("eng_phase_" .. color, "<b><color=#FFD27A>GAME OVER</color></b>" .. (t.overWhy and ("      " .. engineCut(tostring(t.overWhy), 150)) or ""))
  else
    setText("eng_phase_" .. color, whose .. "      " .. table.concat(parts, "   ›   ") .. day)
  end
  -- instruction line (Arena-style): what the open question wants, in table terms; or who you're waiting for
  local hint = ""
  local q = enginePrompts[color]
  if q ~= nil then
    local kind = enginePromptKind and enginePromptKind(q)
    local title = tostring(q.title or "")
    local low = title:lower()
    -- (Arena's top line: the question, then one short line on how to answer it here)
    if kind == "cards" and describePrompt(q).toLibrary then
      hint = title .. (engineExactPick(q) and "\nClick the card" .. (q.max == 1 and "" or "s") .. " to put there: the last click answers. Dragging works too."
        or "\nClick a card, then your library (or Done). Dragging it there works too.")
    -- (cards in a graveyard or exile pile, maybe another player's: nothing on the table glows, so say where they are;
    -- Dauthi Voidwalker's choice among the AI's exiled cards showed only Done, hp-07 2026-10-27)
    -- (copies of cards in a pile are cast, the cards stay: nothing to drag out, Kykar hand test #27; any kind, as the
    -- pile's cards are no objects of their own)
    elseif q.copies then
      hint = title .. "\nPick it in the card row or the Engine panel."
    elseif kind == "cards" and q.pileChoices ~= nil then
      hint = title .. "\nRight-click that graveyard or exile pile -> Search, and drag the card out. Or Choices (top left)."
    elseif kind == "cards" and engineExactPick(q) then
      hint = title .. "\nClick " .. q.max .. " glowing card" .. (q.max == 1 and "" or "s") .. ": the last click answers." .. (q.cancel and " (Or Cancel.)" or "")
    elseif kind == "cards" then hint = title .. (q.cancel and "\nClick the glowing cards, then Done (or Cancel)." or "\nClick the glowing cards, then Done.")
    elseif kind == "target" then
      local sorts = engineTargetSorts(q)
      local cards, players, spells = sorts.cards, sorts.players, sorts.spells
      -- (targets in a graveyard or exile come with a picture: more than the card row holds are picked in the Engine panel,
      -- which then opens; "Click a glowing card" showed with nothing glowing, hp-07 #41 2026-10-27)
      local pile = enginePileOnly(q)
      -- (spells on the stack have no card to click: Counterspell said "Click a glowing card" with nothing glowing, hp-01 #5)
      if spells and not cards and not players then hint = title .. "\nPick the spell in the Engine panel (Choices, top left)."
      elseif engineAnswerPlace(q) == "panel" then hint = title .. "\nThe cards are in a graveyard or exile: pick one in the Engine panel."
      -- (the cards pictures in the card row: nothing glows on the table, hp-07 re-test 2026-10-27; with players too, a
      -- life counter, suite review)
      elseif pile > 0 and pile == #(q.options or {}) then hint = title .. "\nClick its picture in the card row."
      elseif pile > 0 and players then hint = title .. "\nClick its picture in the card row or a player's life counter."
      elseif cards and players and sorts.walkers then hint = title .. "\nClick a player's life counter or a glowing planeswalker."
      else hint = title .. ((cards and players) and "\nClick a glowing card or a life counter." or players and "\nClick a player's life counter." or "\nClick a glowing card.") end
    elseif kind == "attack" then hint = title .. "\nClick a creature, then who it attacks. Or All attack / No attacks."
    elseif kind == "block" then hint = title .. "\nClick your creature, then the attacker it blocks."
    elseif kind == "mana" then
      local life = engineLifePayOption(q)
      hint = title .. (life and ("\nTap lands (Q/E), Auto-pay, or " .. tostring(q.options[life].label) .. (engineAnswerPlace(q) == "panel" and " (in the Engine panel)." or "."))
        or "\nTap lands (Q/E), or Auto-pay.")
    elseif describePrompt(q).kind ~= "priority" then hint = title end
    -- (the bridge's "note" for a question answered on the table: the panel's text isn't seen there; Connive's "a nonland
    -- card discarded puts a +1/+1 counter" was missing, hp-06 2026-10-28)
    if hint ~= "" and q.note ~= nil and q.note ~= "" then hint = hint .. "\n" .. engineCut(tostring(q.note), 140) end
    if describePrompt(q).kind == "priority" or step == "cleanup" then engineStepBanner(color, t) end
  elseif t ~= nil and t.priority ~= nil and t.priority ~= color and not t.gameOver then
    hint = "Waiting for " .. engineNameOf(t.priority) .. "..."
  elseif t ~= nil and t.priority == color and not t.gameOver then
    hint = "Thinking..." -- you answered; the engine hasn't asked the next thing yet (instant click feedback)
  end
  setAttr("eng_hint_" .. color, "active", hint ~= "" and "true" or "false")
  setText("eng_hint_" .. color, hint ~= "" and hint or " ")
  -- (the "Waiting for ..." line flashes in rainbow colours once it has waited 5 s: engineWaitFlash)
  local waitingFor = hint:match("^Waiting for (.-)%.%.%.$")
  local w = engineWaiting[color]
  if waitingFor == nil then
    if w ~= nil then engineWaiting[color] = nil setAttr("eng_hint_" .. color, "color", "#F2F2F2") end
  elseif w == nil or w.who ~= waitingFor then
    engineWaiting[color] = { who = waitingFor, since = os.clock() }
    setAttr("eng_hint_" .. color, "color", "#F2F2F2")
  end
  -- turn banner when the turn changes
  engineBannerSeen = engineBannerSeen or {}
  if t ~= nil and t.active ~= nil and engineBannerSeen[color] ~= tostring(t.active) .. "|" .. tostring(t.turn) then
    local first = engineBannerSeen[color] == nil
    engineBannerSeen[color] = tostring(t.active) .. "|" .. tostring(t.turn)
    if not first and not engineEffectsOff[color] then
      setText("eng_banner_" .. color, t.active == color and "YOUR TURN" or (string.upper(engineNameOf(t.active)) .. "'S TURN"))
      engineBannerAt = engineBannerAt or {}
      engineBannerAt[color] = os.clock()
      -- gold for your turn, blue-white for someone else's (as Arena). (Not UI.show / UI.hide: they showed every
      -- player's banner to everyone, YOUR TURN over BLUE'S TURN, playtest 2026-10-23; "active" keeps it to its player.)
      setAttr("eng_banner_" .. color, "color", t.active == color and "#FFD27A" or "#D6E4FF")
      setAttr("eng_banner_" .. color, "outline", t.active == color and "#2a1600E0" or "#0b1a3aE0")
      setAttr("eng_banner_" .. color, "active", "true")
      local mark = engineBannerSeen[color]
      Wait.time(function() if engineBannerSeen[color] == mark then setAttr("eng_banner_" .. color, "active", "false") end end, 1.6)
    end
  end
  local big, small, bigLabel, smallLabel, labelOnly
  local group, groupLabel, groupTip = nil, nil, nil -- the third button: "Resolve N× <name>" (__group), when offered
  if p ~= nil and p.mode == "browse" then p = enginePrompts[color] end
  -- (a finished game asks nothing: Next and End turn stayed under GAME OVER after a concession, Kykar re-test new bug 8)
  local over = t ~= nil and t.gameOver
  if over then p = nil end
  -- (the attack question's buttons that attack green, the blockers question's Done red, No attacks navy where it is
  -- set below; any other question orange and navy: combat clarity, docs/engine-ui-spec.md 9)
  local ck = p ~= nil and describePrompt(p).kind or nil
  local bigColor = ck == "attack" and ENGINE_COMBAT.attackOn or ck == "block" and ENGINE_COMBAT.blockOn or "#e8711a"
  local smallColor = ck == "attack" and ENGINE_COMBAT.attackOn or "#2e3a59"
  if p ~= nil and p.mode == "single" and p.options and p.options[1] then
    big, bigLabel = 1, p.options[1].label
    for i, o in ipairs(p.options) do
      if i > 1 and (o.id == "__endturn" or o.id == "__resolve" or o.id == "no" or o.id == "mull") then small, smallLabel = i, o.label break end
      -- (Cancel takes a spell back while paying for it: it was only in the Engine panel, playtest 2026-10-24)
      if i > 1 and o.id == "__cancel" and small == nil then small, smallLabel = i, "Cancel" end
    end
    for i, o in ipairs(p.options) do
      if i > 1 and o.id == "__group" then group, groupTip = i, tostring(o.label) break end
    end
    -- (the whole label when it fits, "Resolve 12× Spirit Token"; else without "Resolve ", then cut; the tooltip keeps it all)
    if group ~= nil then
      groupLabel = groupTip
      if #groupLabel > 28 and groupLabel:sub(1, 8) == "Resolve " then groupLabel = groupLabel:sub(9) end
      if #groupLabel > 28 then groupLabel = engineCut(groupLabel, 27) .. "…" end
    end
  elseif p ~= nil and p.mode == "multi" then
    big, bigLabel = "confirm", "Done"
    -- attacks, as Arena: nothing chosen yet: No attacks / All attack; some chosen: Attack (n) / No attacks. (The
    -- second button used to be overwritten with "Attack", so No attacks never showed, playtest 2026-10-24.)
    local all, none
    for i, o in ipairs(p.options or {}) do
      if o.id == "__allattack" then all = i end
      if o.id == "__noattack" then none = i end
    end
    if all ~= nil or none ~= nil then
      local n = 0
      for k in pairs(engineSelected[color] or {}) do
        local o = p.options[k]
        if o ~= nil and tostring(o.id):sub(1, 2) ~= "__" then n = n + 1 end
      end
      if n == 0 then
        if none ~= nil then big, bigLabel = none, "No attacks" else big, bigLabel = "confirm", "No attacks" end
        bigColor = "#2e3a59"
        if all ~= nil then small, smallLabel = all, "All attack" end
      else
        big, bigLabel = "confirm", "Attack (" .. n .. ")"
        if none ~= nil then small, smallLabel, smallColor = none, "No attacks", "#2e3a59" end
      end
    end
    -- an exact number to pick answers by itself at the last click (engineConfirmIfComplete): no Done, which would land
    -- on the next question (it passed main 1 after a player's life counter answered "choose a player to draw", playtest
    -- 2026-10-27); the button counts instead and does nothing
    if all == nil and none == nil and engineExactPick(p) then
      big, bigLabel, labelOnly = nil, count(engineSelected[color]) .. " of " .. p.max .. " chosen", true
    end
    if small == nil and p.cancel then small, smallLabel = "cancel", "Cancel" end
  end
  -- a long label ("Keep this order: Mist-Syndicate Naga, Crystal Ball, ...") keeps only the part before the colon
  if bigLabel and #bigLabel > 22 and bigLabel:find(":") then bigLabel = bigLabel:sub(1, bigLabel:find(":", 1, true) - 1) end
  if smallLabel and #smallLabel > 30 and smallLabel:find(":") then smallLabel = smallLabel:sub(1, smallLabel:find(":", 1, true) - 1) end
  if bigLabel and #bigLabel > 22 then bigLabel = engineCut(bigLabel, 21) .. "…" end
  if smallLabel and #smallLabel > 30 then smallLabel = engineCut(smallLabel, 29) .. "…" end
  if big == nil and small == nil and p == nil and not over and engineLinger(color, function() engineUpdateCorner(color, nil) end) then return end
  -- a button whose words just changed under the pointer ignores clicks for 0.6 s (Resolve became Next as the spell
  -- resolved by itself, and the click meant for Resolve passed the main phase, playtest 2026-10-26). Only a new
  -- question the player did nothing for counts: their own picks ("Attack (1)") change the words too, and so does the
  -- payment that follows their own cast (Auto-pay, clicked at once).
  local was = engineCorner[color] or {}
  local asked = p and (tostring(p.promptId) .. "|" .. tostring(p.step)) or was.asked
  local acted = engineActedAt[color] ~= nil and was.shownAt ~= nil and engineActedAt[color] >= was.shownAt
  local fresh = asked ~= was.asked and not acted
  engineCorner[color] = { big = big, small = small, bigLabel = bigLabel, smallLabel = smallLabel, asked = asked,
    shownAt = (asked ~= was.asked) and os.clock() or was.shownAt,
    bigAt = (fresh and was.bigLabel ~= nil and bigLabel ~= nil and was.bigLabel ~= bigLabel) and os.clock() or was.bigAt,
    smallAt = (fresh and was.smallLabel ~= nil and smallLabel ~= nil and was.smallLabel ~= smallLabel) and os.clock() or was.smallAt,
    group = group, groupLabel = groupLabel,
    groupAt = (fresh and was.groupLabel ~= nil and groupLabel ~= nil and was.groupLabel ~= groupLabel) and os.clock() or was.groupAt }
  setButton("eng_big_" .. color, { active = (big ~= nil or labelOnly) and "true" or "false", text = bigLabel or " ", color = bigColor })
  setButton("eng_big2_" .. color, { active = small ~= nil and "true" or "false", text = smallLabel or " ", color = smallColor })
  -- (no call while it was never shown: the XML has it hidden, and the hint at its usual place)
  if group ~= nil then
    setButton("eng_big3_" .. color, { active = "true", text = groupLabel, tooltip = groupTip })
  elseif uiCache["eng_big3_" .. color .. "|active"] == "true" then
    setButton("eng_big3_" .. color, { active = "false" })
  end
  -- (the instruction line sits above the corner's top button: up one row while the third shows)
  if group ~= nil or uiCache["eng_hint_" .. color .. "|offsetXY"] ~= nil then
    setAttr("eng_hint_" .. color, "offsetXY", group ~= nil and "-20 246" or "-20 196")
  end
  for _, g in ipairs({ "start", "combat", "end" }) do
    setButton("eng_stop_" .. g .. "_" .. color, { color = engineStopsOf(color)[g] and "#b8860b" or "#262626" })
  end
  -- (the ability panel follows the board too: a tap, a counter, priority moving on greys or brightens its lines)
  if engineAbPanelFor ~= nil and engineAbPanelFor[color] ~= nil then
    local ok, err = pcall(engineAbPanelShow, color, engineAbPanelFor[color])
    if not ok then print("[MTG] ability panel: " .. tostring(err)) end
  end
end
engineStops = {} -- colour -> { start = true, combat = true, end = true }
-- Start of turn and End of turn are on until a player switches them off (2026-10-24: "we are skipping upkeep priority
-- and end step priority"); they only stop when you can do something there. Same default in the bridge (DEFAULT_STOPS).
function engineStopsOf(color)
  if engineStops[color] == nil then engineStops[color] = { start = true, ["end"] = true } end
  return engineStops[color]
end

-- whether n picks answer a multi-pick question p: from its min (0 when unsaid) to its max (99); the one rule for the
-- row's Done colour and confirm's refusal, which say the same of the same picks
function engineCountOk(p, n)
  return n >= (p.min or 0) and n <= (p.max or 99)
end
-- ───────── combat pickers under tabs (combat clarity, docs/engine-ui-spec.md 9) ─────────
-- "Attacker and defender pickers organised under tabs, so a big token board doesn't need endless scrolling; same-named
-- tokens (#1 to #20) under one tab" (the user, 2026-11-09). An attack or blockers question with more than
-- ENGINE_CTAB_MIN creature lines and two or more names gets a row of tabs under the search box, one per name of the
-- creature you choose with (the attacker, the blocker): the list shows that tab's lines, All attack / No attacks above
-- them. ENGINE_CTABS buttons; with more names the last one turns the tabs' page. A search looks through every tab.
ENGINE_CTABS, ENGINE_CTAB_MIN = 8, 8
engineCombatTab = {} -- colour -> { prompt = promptId, key = the open tab's name, page = the tabs' page }
function engineCombatTabsXml(c)
  local rows = {}
  for r = 0, 1 do
    local b = {}
    for k = r * 4 + 1, r * 4 + 4 do
      b[#b + 1] = '<Button id="eng_ctab_' .. c .. '_' .. k .. '" onClick="onMtgCTab" color="#1A1A1A" textColor="#ffffff" fontSize="12" active="false"> </Button>'
    end
    rows[#rows + 1] = '<HorizontalLayout spacing="3" childForceExpandWidth="true">' .. table.concat(b) .. '</HorizontalLayout>'
  end
  return '    <VerticalLayout id="eng_ctabs_' .. c .. '" preferredHeight="56" spacing="3" childForceExpandHeight="true" active="false">' .. table.concat(rows) .. '</VerticalLayout>\n'
end
-- The name a combat line is filed under: its label's start, the bridge's name for the creature ("Spirit Token 1/1 #3 →
-- Blue", "Wall of Omens 0/4 [1 +1/+1 counter] (2 dmg) blocks ..."), without the number, size, counters and damage.
-- The label, not engineStatic: it is what the player reads, and a face-down creature's says only "(face-down)".
function engineCombatName(label)
  local l = tostring(label or "")
  local cut = l:find(" blocks ", 1, true) or l:find(" →", 1, true)
  if cut ~= nil then l = l:sub(1, cut - 1) end
  -- (the bridge's cardLabel and numberedLabels add, in this order: the size, the counters, the damage, the number;
  -- taken off last first, so a Spirit with a counter or damage on it sits under Spirit Token with the rest)
  return (l:gsub(" #%d+$", ""):gsub(" %(%d+ dmg%)$", ""):gsub(" %[[^%]]*%]$", ""):gsub(" %-?%d+/%-?%d+$", ""))
end
-- the question's tabs, in the order of its lines: { { key, n = creatures, picked = creatures picked, opts = { index = true } } },
-- or nil when it gets none
function engineCombatGroups(color, p)
  local kind = p ~= nil and p.mode == "multi" and describePrompt(p).kind or nil
  if kind ~= "attack" and kind ~= "block" then return nil end
  local groups, byKey, lines = {}, {}, 0
  local sel = engineSelected[color] or {}
  for i, o in ipairs(p.options or {}) do
    local id = tostring(o.id)
    local bar = id:find("|", 1, true)
    if bar ~= nil and id:sub(1, 2) ~= "__" then
      lines = lines + 1
      local own = id:sub(1, bar - 1)
      local key = engineCombatName(o.label)
      local g = byKey[key]
      if g == nil then
        g = { key = key, n = 0, picked = 0, opts = {}, own = {}, chose = {} }
        byKey[key] = g
        groups[#groups + 1] = g
      end
      g.opts[i] = true
      if not g.own[own] then g.own[own] = true g.n = g.n + 1 end
      if sel[i] and not g.chose[own] then g.chose[own] = true g.picked = g.picked + 1 end
    end
  end
  if lines <= ENGINE_CTAB_MIN or #groups < 2 then return nil end
  return groups
end
-- Draws the tab row for colour's open question p (nil hides it) and returns the open tab's group, or nil: then the
-- list shows every line (no tabs, or a search under way)
function engineCombatTabsDraw(color, p, filter)
  local groups = p ~= nil and engineCombatGroups(color, p) or nil
  if not panelReady then return nil end
  -- (no UI call while there were and are no tabs: as the XML has it)
  if groups == nil and uiCache["eng_ctabs_" .. color .. "|active"] ~= "true" then engineCombatTab[color] = nil return nil end
  setAttr("eng_ctabs_" .. color, "active", groups and "true" or "false")
  -- (the answers' list gives the tabs their room: the window keeps its height)
  setAttr("eng_scroll_" .. color, "preferredHeight", groups and "258" or "318")
  if groups == nil then engineCombatTab[color] = nil return nil end
  local st = engineCombatTab[color]
  if st == nil or st.prompt ~= p.promptId then st = { prompt = p.promptId, page = 0 } engineCombatTab[color] = st end
  local paged = #groups > ENGINE_CTABS
  local per = paged and ENGINE_CTABS - 1 or ENGINE_CTABS
  local pages = math.ceil(#groups / per)
  st.page = st.page % pages
  -- the open tab: the one clicked; none yet (a new question, a new page of tabs) or gone: the page's first
  local open = nil
  for _, g in ipairs(groups) do if g.key == st.key then open = g end end
  if open == nil then open = groups[st.page * per + 1] st.key = open.key end
  local searching = filter ~= nil and filter ~= ""
  -- (what each button stands for as drawn, which onMtgCTab reads: a tab's name, or true for More tabs)
  st.slots = {}
  for k = 1, ENGINE_CTABS do
    local g = groups[st.page * per + k]
    local id = "eng_ctab_" .. color .. "_" .. k
    if paged and k == ENGINE_CTABS then
      st.slots[k] = true
      setButton(id, { text = "More tabs (" .. (st.page + 1) .. "/" .. pages .. ")", color = "#333333", textColor = ENGINE_THEME.text, active = "true" })
    elseif g ~= nil and k <= per then
      st.slots[k] = g.key
      local on = g == open and not searching
      setButton(id, { text = engineCut(g.key, 13) .. " (" .. (g.picked > 0 and (g.picked .. "/" .. g.n) or tostring(g.n)) .. ")",
        color = on and ENGINE_THEME.tabOn or ENGINE_THEME.dock, textColor = on and ENGINE_THEME.gold or ENGINE_THEME.text, active = "true" })
    else
      setAttr(id, "active", "false")
    end
  end
  if searching then return nil end
  return open
end
local function updateOptions(color)
  -- (a fix from hand: the engine is paused, and the panel lists the player's hand instead, M7 §12)
  if engineFixHandDraw ~= nil and engineFixHandDraw(color) then engineCombatTabsDraw(color, nil) return end
  local p = engineBrowse[color] and engineSidePrompt(color) or enginePrompts[color]
  -- (the combat tabs: only for an open attack or blockers question, never under a side tab)
  local tabGroup = engineCombatTabsDraw(color, not engineBrowse[color] and p or nil, string.lower(engineFilter[color] or ""))
  engineVisible[color] = {}
  if p == nil then
    setText("eng_title_" .. color, (lastTable and lastTable.gameOver) and "Game over" or "Waiting for other players...")
    setText("eng_text_" .. color, " ")
    setAttr("eng_search_" .. color, "active", "false")
    setAttr("eng_confirm_" .. color, "active", "false")
    setAttr("eng_cancel_" .. color, "active", "false")
    for k = 1, POOL do setAttr("eng_opt_" .. color .. "_" .. k, "active", "false") end
    engineUpdateCorner(color, nil)
    if engineRowUpdate ~= nil then pcall(engineRowUpdate, color) end
    return
  end
  setText("eng_title_" .. color, p.title)
  setText("eng_text_" .. color, (p.text ~= nil and p.text ~= "") and p.text or " ")
  local all = optionList(p, string.lower(engineFilter[color] or ""))
  setAttr("eng_search_" .. color, "active", (not p.nosearch and (#all > 8 or p.mode == "browse")) and "true" or "false")
  local filter = string.lower(engineFilter[color] or "")
  local sel = engineSelected[color] or {}
  local shown = {}
  for _, o in ipairs(all) do
    -- (under a combat tab: that tab's lines, and the quick buttons, All attack / No attacks)
    local inTab = tabGroup == nil or tabGroup.opts[o.index] or tostring((p.options[o.index] or {}).id):sub(1, 2) == "__"
    if inTab and (filter == "" or string.find(string.lower(o.label), filter, 1, true)) then shown[#shown + 1] = o end
  end
  -- a longer list than the buttons: pages of POOL - 1, the last button turns the page (kept for the same question,
  -- search and combat tab; anything else starts at page one)
  local per, first = POOL, 1
  if #shown > POOL then
    per = POOL - 1
    local key = table.concat({ tostring(p.promptId), tostring(p.title), #all, filter, tostring(p.mode), tabGroup and tabGroup.key or "" }, "|")
    local pg = enginePage[color]
    if pg == nil or pg.key ~= key then pg = { key = key, n = 0 } enginePage[color] = pg end
    pg.n = pg.n % math.ceil(#shown / per)
    first = pg.n * per + 1
  end
  local last = math.min(#shown, first + per - 1)
  local k = 0
  for i = first, last do
    local o = shown[i]
    k = k + 1
    engineVisible[color][k] = o.index
    local picked = p.mode == "multi" and sel[o.index]
    setButton("eng_opt_" .. color .. "_" .. k, { text = (p.mode == "multi" and (picked and "[x] " or "[  ] ") or "") .. o.label,
      color = optionColor(p, o.index, picked), active = "true" })
  end
  for j = k + 1, per do setAttr("eng_opt_" .. color .. "_" .. j, "active", "false") end
  if per < POOL then
    engineVisible[color][POOL] = "more"
    setButton("eng_opt_" .. color .. "_" .. POOL, { text = string.format("More... (%d-%d of %d)", first, last, #shown),
      color = "#333333", active = "true" })
  end
  engineUpdateCorner(color, p)
  if p.mode == "multi" then
    local n = count(sel)
    local need = (p.min == p.max) and tostring(p.min) or (tostring(p.min) .. "-" .. tostring(p.max))
    setText("eng_confirm_" .. color, p.min == p.max and string.format("Done (%d of %s)", n, need) or string.format("Done (%d chosen)", n))
    -- (pressable below its count too: confirm says how many, live check 11)
    setAttr("eng_confirm_" .. color, "interactable", "true")
    setAttr("eng_confirm_" .. color, "active", "true")
  else
    setAttr("eng_confirm_" .. color, "active", "false")
  end
  setAttr("eng_cancel_" .. color, "active", p.cancel and "true" or "false")
  if engineRowUpdate ~= nil then
    local ok, err = pcall(engineRowUpdate, color)
    if not ok then print("[MTG] card row: " .. tostring(err)) end
  end
end

-- a combat tab clicked: its lines in the list (from their first page); "More tabs" shows the next tabs and opens the
-- first of them. The button means what engineCombatTabsDraw drew on it (st.slots).
function onMtgCTab(player, value, id)
  local color, k = tostring(id):match("^eng_ctab_(%a+)_(%d+)$")
  if color == nil or player.color ~= color then return end
  local st = engineCombatTab[color]
  local slot = st ~= nil and st.slots ~= nil and st.slots[tonumber(k)] or nil
  if slot == nil then return end
  if slot == true then st.page, st.key = st.page + 1, nil
  else
    st.key = slot
    -- (a tab clicked during a search: the search ends, the tab's lines show)
    if engineFilter[color] ~= nil and engineFilter[color] ~= "" then engineFilter[color] = nil setText("eng_search_" .. color, "") end
  end
  if panelReady then updateOptions(color) end
end

-- the panel's per-player question state, cleared when a game ends (engineClear)
function engineResetUi()
  engineSkipTo, engineAutoListOpen = {}, {} -- (a skip ends with its game)
  -- the rewind button, its list and an open vote belong to the game that ended
  if engineRewindUpdate ~= nil then engineRewindUpdate(nil, true) end
  if engineDrawLines ~= nil then pcall(engineDrawLines, nil, nil) end -- and the target/attack/block lines
  if engineCombatLunge ~= nil then pcall(engineCombatLunge, nil) end -- and the remembered attackers
  -- a new game checks decks again (the bridge forgets them on reset too): every Ready button goes back to yellow
  if engineReadyState ~= nil then for k in pairs(engineReadyState) do engineReadyState[k] = nil end end
  for k in pairs(engineSelected) do engineSelected[k] = nil end
  for k in pairs(engineFilter) do engineFilter[k] = nil end
  for k in pairs(engineBrowse) do engineBrowse[k] = nil end
  for k in pairs(enginePage) do enginePage[k] = nil end
  for k in pairs(engineCombatTab) do engineCombatTab[k] = nil end
end

engineLogHidden = {} -- colour -> true when the player closed the game log
AUTO_PACE_DELAY = 2

-- "Your mana pool: GG B" for the player's own floating mana.
local POOL_ORDER = { "W", "U", "B", "R", "G", "C" }
local function poolText(color)
  for _, pl in ipairs((lastTable and lastTable.players) or {}) do
    if pl.color == color and pl.pool ~= nil then
      local parts = {}
      for _, k in ipairs(POOL_ORDER) do
        local n = tonumber(pl.pool[k] or 0) or 0
        if n > 0 then parts[#parts + 1] = string.rep(k, n) end
      end
      if #parts > 0 then return "\nYour mana pool: " .. table.concat(parts, " ") end
    end
  end
  return ""
end

-- "Waiting for you: draw 1 ..." while moves are held for the player.
local function pendingText(color)
  local d, mi, u = enginePendingCount(color)
  local parts = {}
  if d > 0 then parts[#parts + 1] = "draw " .. d .. " (click your library or press Draw)" end
  if mi > 0 then parts[#parts + 1] = "mill " .. mi .. " (drag one of the face-up cards or press Mill)" end
  if u > 0 then parts[#parts + 1] = "untap (press Untap)" end
  if #parts == 0 then return "" end
  return "\nWaiting for you: " .. table.concat(parts, ", ")
end

-- the dock's tabs: button id prefix -> its tab (engineOpenTab); Undo's button shows only with restore points
ENGINE_TABS = { { "eng_toggle_", "choices" }, { "eng_browse_", "browse" }, { "eng_undo_", "undo" }, { "eng_set_", "settings" } }
local function updatePanel(color)
  local inGame = lastTable ~= nil
  -- (also while a fix from hand lists this player's hand in it)
  local open = inGame and (engineShown[color] ~= nil or (engineFixHandWants ~= nil and engineFixHandWants(color)))
  setAttr("eng_panel_" .. color, "active", open and "true" or "false")
  -- the open tab gold on warm brown, the others white on the table's near-black
  local on = open and (engineBrowse[color] or "choices") or nil
  for _, t in ipairs(ENGINE_TABS) do
    local look = { color = on == t[2] and ENGINE_THEME.tabOn or ENGINE_THEME.dock, textColor = on == t[2] and ENGINE_THEME.gold or ENGINE_THEME.text }
    if t[2] ~= "undo" then look.active = inGame and "true" or "false" end
    setButton(t[1] .. color, look)
  end
  -- (the stops belong to the answers: not under a side tab's list)
  setAttr("eng_stops_" .. color, "active", engineBrowse[color] and "false" or "true")
  setAttr("eng_logbtn_" .. color, "active", inGame and "true" or "false")
  -- (hidden while the log is empty: an empty black box at the top right, 2026-11-10)
  setAttr("eng_log_" .. color, "active", (inGame and not engineLogHidden[color] and #engineLog > 0) and "true" or "false")
  -- (the Settings tab's lines say what each switch is now: a switch changed from the chat shows too)
  if engineBrowse[color] == "settings" and panelReady then updateOptions(color) end
  setText("eng_status_" .. color, statusText() .. poolText(color) .. pendingText(color))
end

-- The screen UI as small as it can be (2026-10-23): TTS sends the whole XML to every player, and with two players
-- seated it had grown past 64 KB, when the second player's buttons stopped working (a size limit is the likely cause,
-- not proven). Each element's look (every attribute but its id, events, visibility and class) becomes a class in the
-- <Defaults> block whenever two elements share it, so every seat's copy of a panel shares one set of classes and a seat
-- costs little more than its ids (four seats came to ~90 KB with the hand-picked classes this replaced). Events stay on
-- the element: TTS honours "active" and the layout attributes from <Defaults> (checked in TTS, 2026-10-23), onClick
-- there was not checked. An element that already has a class is left as written.
-- Returns the compacted XML and the class entries it needs (they go into the document's one <Defaults> block).
function engineXmlCompact(xml)
  local tags, uses, pos = {}, {}, 1
  while true do
    local i, j, name = xml:find("<(%a%w*)", pos)
    if i == nil then break end
    local keep, rest, has, k = {}, {}, false, j + 1
    while true do
      local _, e, key, val = xml:find('^%s+([%w_]+)="([^"]*)"', k)
      if e == nil then break end
      local pair = " " .. key .. '="' .. val .. '"'
      if key == "id" or key == "visibility" or key:find("^on%u") then keep[#keep + 1] = pair
      else
        if key == "class" then has = true end
        rest[#rest + 1] = pair
      end
      k = e + 1
    end
    local _, e, close = xml:find("^%s*(/?)>", k)
    if e == nil then pos = j + 1
    else
      local look = (not has and #rest > 0) and (name .. table.concat(rest)) or nil
      tags[#tags + 1] = { i = i, e = e, name = name, keep = table.concat(keep), rest = table.concat(rest), close = close, look = look }
      if look ~= nil then uses[look] = (uses[look] or 0) + 1 end
      pos = e + 1
    end
  end
  local out, defaults, class, last = {}, {}, {}, 1
  for _, t in ipairs(tags) do
    out[#out + 1] = xml:sub(last, t.i - 1)
    if t.look ~= nil and uses[t.look] > 1 then
      if class[t.look] == nil then
        class[t.look] = "m" .. (#defaults + 1)
        defaults[#defaults + 1] = "<" .. t.name .. ' class="' .. class[t.look] .. '"' .. t.rest .. "/>"
      end
      out[#out + 1] = "<" .. t.name .. t.keep .. ' class="' .. class[t.look] .. '"' .. t.close .. ">"
    else
      out[#out + 1] = "<" .. t.name .. t.keep .. t.rest .. t.close .. ">"
    end
    last = t.e + 1
  end
  out[#out + 1] = xml:sub(last)
  return table.concat(out), table.concat(defaults)
end
-- the classes into the table's own <Defaults> block (one per document), or a block of their own
function engineXmlJoin(base, ours, defaults)
  if defaults == "" then return base .. "\n" .. ours end
  local i, j = base:find("<Defaults>", 1, true)
  if i ~= nil then return base:sub(1, j) .. defaults .. base:sub(j + 1) .. "\n" .. ours end
  return "<Defaults>" .. defaults .. "</Defaults>\n" .. base .. "\n" .. ours
end
function engineXmlMinify(xml) return (xml:gsub("\r?\n%s*", " "):gsub(">%s+<", "><")) end

-- Builds the panels once (and again only when the seated colours change); otherwise just updates them.
-- promptColor: refresh that colour's options too ("none" = status lines only, nil = everyone's options).
function engineRenderPanels(promptColor)
  local seated = {}
  for _, c in ipairs(getSeatedPlayers()) do if data[c] then seated[#seated + 1] = c end end
  local key = table.concat(seated, ",")
  if key ~= builtFor then
    builtFor, panelReady, uiCache = key, false, {}
    if engineAbPanelFor ~= nil then engineAbPanelFor = {} end -- (rebuilt hidden: pointing at the card shows it again)
    if baseXml == nil then baseXml = engineXmlMinify(UI.getXml() or "") end
    -- (no covers over TTS's tool bars any more: measured on one screen, they floated as black boxes on others,
    -- docs/engine-ui-spec.md 2.2)
    local parts = {}
    for _, c in ipairs(seated) do parts[#parts + 1] = panelXml(c) parts[#parts + 1] = cornerXml(c) end
    parts[#parts + 1] = POPUP_XML
    parts[#parts + 1] = engineAutoListXml()
    local raw = table.concat(parts, "\n")
    engineBtnLook = {}
    engineRecordButtons(raw)
    local ours, defaults = engineXmlCompact(raw)
    -- (without the table's Scryfall search and deck panels, the last thing in its UI: only an "MTG Importer" object opens
    -- them, and the table has none, docs/table-functions-global-importer.md 1.8. 3.8 KB of the 60 KB limit, 2026-10-30)
    local base = baseXml:sub(1, (baseXml:find('<Panel id="SearchPanel"', 1, true) or #baseXml + 1) - 1)
    local xml = engineXmlJoin(base, ours, defaults)
    engineXmlSize = #xml
    if engineXmlSize > 60000 then
      print("[MTG] The screen UI is " .. math.floor(engineXmlSize / 1024) .. " KB with " .. #seated .. " players: other players' buttons may not work (it reached them below 60 KB).")
    end
    UI.setXml(xml)
    engineImgWant = {} -- (the new panel shows no pictures yet)
    Wait.frames(function()
      panelReady = true
      for _, c in ipairs(seated) do updatePanel(c) updateOptions(c) end
      if engineRewindRedraw ~= nil then engineRewindRedraw() end -- the new XML starts with the rewind UI hidden
      if engineFixRedraw ~= nil then engineFixRedraw() end -- and the manual-fix UI
      if engineScoopRedraw ~= nil then engineScoopRedraw() end -- and with Scoop hidden
    end, 3)
    return
  end
  if not panelReady then return end
  for _, c in ipairs(seated) do
    updatePanel(c)
    if promptColor == nil or promptColor == c then updateOptions(c)
    -- a board update without a new question: the phase bar, hint line and turn banner still follow the board
    -- (before, the bar showed DRAW while the game was in main 1, until the next question arrived)
    else engineUpdateCorner(c, enginePrompts[c]) end
  end
end

function panelReadyForPopup() return panelReady end

-- After an answer the question's buttons stay up for half a second before they go (engineLinger): the next question
-- often follows at once with the same buttons (Sylvan Library's "pay 4 life? (2 of 2)" 0.1 s after "(1 of 2)"), and
-- buttons switched off and on again under a mouse that didn't move ignored the next click (playtest 2026-10-23: the
-- second "Pay 4 life" did nothing, so the player pressed No). Clicks in that half second do nothing.
engineAnsweredAt = {}
engineActedAt = {} -- colour -> os.clock() of the player's last answer or drag sent to the engine (the big button's guard)
function engineLinger(color, redo)
  local at = engineAnsweredAt[color]
  if enginePrompts[color] ~= nil or at == nil or os.clock() - at > 0.5 then return false end
  Wait.time(function()
    engineAnsweredAt[color] = nil
    if enginePrompts[color] == nil then redo() end
  end, 0.55)
  return true
end
local function engineAnswer(color, choice)
  local p = enginePrompts[color]
  if p == nil then return end
  engineAnsweredAt[color] = os.clock()
  engineActedAt[color] = os.clock()
  engineSend("answer", { color = color, promptId = p.promptId, choice = choice })
  if engineHoldCombat ~= nil then engineHoldCombat(color, p, choice) end
  enginePrompts[color] = nil
  if engineExitPrompt ~= nil then engineExitPrompt(color) end
  if panelReady then setText("eng_search_" .. color, "") updateOptions(color) end
end

-- Picking option number i of the open prompt (number prompts: the number itself).
-- Instant feedback: what a panel click will most likely do is shown at once (the engine answers 0.1-0.9 s later
-- and its board then puts everything exactly where it belongs, or back if the move was refused).
local function optimistic(color, o)
  if o == nil or o.cardId == nil then return end
  local obj = engineObjs and engineObjs[o.cardId]
  local g = seatGeometry(color)
  if obj == nil or obj.isDestroyed() or g == nil then return end
  local label = tostring(o.label or "")
  local spot
  if label:find("^Play ") then spot = gridPos(g, 0, ROWS.land) + Vector(0, 0.5, 0)
  elseif label:find("^Cast ") then spot = g.mat + Vector(0, 2.5, 0)
  elseif label:find("^Mana: tap ") then
    local r = obj.getRotation()
    obj.setRotationSmooth(Vector(r.x, r.y + 90, r.z), false, true)
    return
  else return end
  engineHeld[o.cardId] = os.clock()
  obj.setLock(false)
  obj.setPosition(spot)
end

local function pick(color, i)
  local tab = engineBrowse[color]
  if tab == "undo" then
    -- (asked: the tab shuts, as the Undo list did; the vote pop-up follows)
    if i ~= nil and engineAskRewind(color, i) then engineOpenTab(color, "undo") end
    return
  elseif tab == "settings" then
    local o = (engineSidePrompt(color).options or {})[i]
    local pl, id = Player[color], o and o.id
    if id == "fx" then onMtgFx(pl, nil, "eng_fx_" .. color)
    elseif id == "snd" then onMtgSnd(pl, nil, "eng_snd_" .. color)
    elseif id == "anim" then onMtgAnim(pl, nil, "eng_anim_" .. color)
    elseif id == "pace" then onMtgPace(pl, nil, "eng_pace_" .. color) end
    if panelReady then updateOptions(color) end
    return
  elseif tab then
    local e = (browseCards[color] or {})[i]
    if e ~= nil then
      local c = e.card
      local pt = (c.p ~= nil and c.t ~= nil) and ("  " .. tostring(c.p) .. "/" .. tostring(c.t)) or ""
      broadcastToColor(c.n .. "  -  " .. tostring(c.tl or "") .. pt .. "\n" .. tostring(c.tx or ""), color, {0.85, 0.9, 1})
    end
    return
  end
  local p = enginePrompts[color]
  if p == nil or i == nil then return end
  if p.mode == "number" then return engineAnswer(color, { i }) end
  if p.mode == "multi" and p.options[i] ~= nil and tostring(p.options[i].id):sub(1, 2) == "__" then
    return engineAnswer(color, { p.options[i].id }) -- a quick button: answers by itself
  end
  if p.mode == "single" then
    if p.options[i] == nil then return end
    pcall(optimistic, color, p.options[i])
    return engineAnswer(color, { p.options[i].id })
  end
  engineSelected[color] = engineSelected[color] or {}
  if not engineSelected[color][i] and describePrompt(p).kind == "block" then
    -- a creature blocks one attacker: picking it for this one drops its other pick
    local blocker = tostring((p.options[i] or {}).id):match("^(.-)|")
    for j, o in ipairs(p.options or {}) do
      if j ~= i and engineSelected[color][j] and tostring(o.id):match("^(.-)|") == blocker then engineSelected[color][j] = nil end
    end
  end
  if engineSelected[color][i] then engineSelected[color][i] = nil
  elseif count(engineSelected[color]) < (p.max or 99) then engineSelected[color][i] = true end
  if panelReady then updateOptions(color) end
  -- the table shows the same picks (red glows): a pick from the panel, corner or card row redraws them too
  if enginePhase2Prompt ~= nil then pcall(enginePhase2Prompt, color) end
end

function engineSelectedFor(color, i) return engineSelected[color] ~= nil and engineSelected[color][i] == true end
-- (what is selected, every key and value as text: for checks and debugging)
function engineSelectedKeys(color)
  local out = {}
  for k, v in pairs(engineSelected[color] or {}) do out[#out + 1] = tostring(k) .. ":" .. type(k) .. "=" .. tostring(v) end
  return table.concat(out, ",")
end

local function confirm(color)
  local p = enginePrompts[color]
  if p == nil then return end
  if p.scry ~= nil and engineScryFinish ~= nil then return engineScryFinish(color) end
  local ids = {}
  for i, o in ipairs(p.options or {}) do if engineSelected[color] and engineSelected[color][i] then ids[#ids + 1] = o.id end end
  -- too few or too many would make the engine abort the game (the bridge checks this too): said, as the bridge's own
  -- refusal says it (forage's Done of 1 of 3 did nothing and said nothing, live check 11)
  if not engineCountOk(p, #ids) then
    -- (the same bounds engineCountOk reads: a question without its min or max says "0-..." or "...-99", never "nil")
    local lo, hi = p.min or 0, p.max or 99
    local need = lo == hi and tostring(lo) or (tostring(lo) .. "-" .. tostring(hi))
    if engineTell ~= nil then engineTell(color, "Choose " .. need .. " (you chose " .. #ids .. ").") end
    return
  end
  engineAnswer(color, ids)
end

enginePick = pick
-- a card chosen by dragging it (a discard of 2, cards to the bottom): shown chosen like a click would
function enginePickById(color, id)
  local p = enginePrompts[color]
  for i, o in ipairs((p and p.options) or {}) do
    if tostring(o.id) == tostring(id) and not engineSelectedFor(color, i) then
      pick(color, i)
      if engineConfirmIfComplete ~= nil then engineConfirmIfComplete(color) end -- (a drag or a pile pick: the same rule)
      if enginePhase2Prompt ~= nil then enginePhase2Prompt(color) end
      return
    end
  end
end
engineConfirm = confirm

-- ───────── card row (Arena-style order / scry / pick) ─────────
engineRowMap = {} -- colour -> { tiles = { k -> option index }, btns = { k -> option index or "confirm" } }
local function shortLabel(l)
  l = tostring(l or "")
  if #l > 24 and l:find(":") then l = l:sub(1, l:find(":", 1, true) - 1) end
  return l
end
-- Questions answered with buttons in the row (no card to click on the table): a mode, a colour, which mana, a
-- yes/no about a card, a number, a reveal, how to split damage. The card asking (p.show) is pictured above them.
local ROW_BUTTON_KINDS = { modal = true, color = true, choice = true, damage = true, yesno = true, number = true, reveal = true, place = true }
local COLOR_BTN = { w = "#d8cfa8", u = "#2f6fb5", b = "#444444", r = "#c0392b", g = "#2e8b57", c = "#8e8e8e" }
engineNumber = {}    -- colour -> { prompt = the number question, value = what the row's picker shows }
-- colour -> { prompt, n = the page shown, pages }: a question showing more pictures than the row holds (Animist's
-- Awakening's 8 cards, 2026-10-30; a revealed hand) pages through them with Back / More, ROW_MAX at a time
engineRowPage = {}
function engineRowUpdate(color)
  local p = enginePrompts[color]
  local tiles, others = {}, {}
  local usable = p ~= nil and not engineBrowse[color] and p.scry == nil and (enginePromptKind == nil or enginePromptKind(p) ~= "cards")
  local numberMode = usable and p.mode == "number"
  if usable and (p.mode == "single" or p.mode == "multi") then
    for i, o in ipairs(p.options or {}) do
      if o.img ~= nil then tiles[#tiles + 1] = { opt = i, n = o.label, img = o.img } else others[#others + 1] = i end
    end
  end
  -- a cost that can be paid with life (Phyrexian {W/P}): Auto-pay, Pay N life and Cancel as buttons in the row, the
  -- lands still tapped on the table ("Pay 2 life" was only in the Engine panel, hp-07 #30 re-test 2026-10-27)
  local lifePay = usable and describePrompt(p).kind == "mana" and engineLifePayOption(p) ~= nil
  if lifePay then
    local keep = {}
    for _, i in ipairs(others) do
      local id = tostring(p.options[i].id)
      if not id:find("^tap:") and not id:find("^untap:") then keep[#keep + 1] = i end
    end
    others = keep
  end
  local buttonMode = numberMode or (usable and #tiles == 0 and (ROW_BUTTON_KINDS[describePrompt(p).kind] or lifePay)
    and #others > 0 and #others <= (p.mode == "multi" and ROW_BTNS - 1 or ROW_BTNS))
  local page = nil
  if usable and #tiles == 0 then
    local show = p.show or {}
    page = engineRowPage[color]
    -- (keyed on the question, not its table: the same question sent again keeps its page)
    if page == nil or page.prompt ~= (p.promptId or p) then page = { prompt = p.promptId or p, n = 1 } engineRowPage[color] = page end
    -- (paged only when its Back and More buttons fit beside the question's own and its Done: else the first pictures, as
    -- before. Without Done counted, a pick of several with 3 buttons and 9 pictures lost Done to More, suite review
    -- 2026-11-10)
    local done = (p.mode == "multi" and not engineExactPick(p)) and 1 or 0
    page.pages = (not numberMode and #others + 2 + done <= ROW_BTNS) and math.max(1, math.ceil(#show / ROW_MAX)) or 1
    page.n = math.max(1, math.min(page.n, page.pages))
    for k = (page.n - 1) * ROW_MAX + 1, math.min(#show, page.n * ROW_MAX) do tiles[#tiles + 1] = { n = show[k].n, img = show[k].img } end
  end
  local on = (#tiles > 0 and #tiles <= ROW_MAX and #others <= ROW_BTNS - 1) or buttonMode
  engineRowMap[color] = { tiles = {}, btns = {} }
  if not on and p == nil and engineLinger(color, function() engineRowUpdate(color) end) then return end
  setAttr("eng_row_" .. color, "active", on and "true" or "false")
  if not on then return end
  local map = engineRowMap[color]
  setAttr("eng_row_" .. color, "height", #tiles > 0 and "470" or "170")
  -- the short one (buttons only: "how do you play it?") in the upper half: in the middle it covered your own mat and
  -- the card you had just dropped, whose pop-up text then hid its buttons (hp-07 2026-10-27). setAttr sends only a
  -- change, so a panel the player dragged stays where they put it until the size changes.
  setAttr("eng_row_" .. color, "offsetXY", #tiles > 0 and "0 60" or "0 230")
  setText("eng_rowtitle_" .. color, tostring(p.title or ""))
  local sub = tostring(p.text or ""):gsub("\n", "   ")
  if numberMode then
    local st = engineNumber[color]
    if st == nil or st.prompt ~= p then st = { prompt = p, value = p.min or 0 } engineNumber[color] = st end
    sub = "Number: " .. tostring(st.value) .. "   (" .. tostring(p.min or 0) .. " to " .. tostring(p.max) .. ")   " .. sub
  -- (an exact number answers at the last click, onMtgRow: the line said "then Done" for Kenrith's one target, hp-07 re-test)
  elseif p.mode == "multi" and #tiles > 0 and tiles[1].opt ~= nil then
    sub = (engineExactPick(p) and ("Click " .. (p.max == 1 and "the card" or (p.max .. " cards")) .. " you want: the last click answers.   ")
      or "Click the cards you want, then Done.   ") .. sub
  elseif p.mode == "multi" and engineExactPick(p) then sub = "Pick one: the click answers.   " .. sub
  elseif p.mode == "multi" then sub = "Pick, then Done.   " .. sub
  elseif tiles[1] ~= nil and tiles[1].opt ~= nil then sub = "Click a card.   " .. sub end
  if page ~= nil and page.pages > 1 then
    sub = string.format("Cards %d-%d of %d.   ", (page.n - 1) * ROW_MAX + 1, (page.n - 1) * ROW_MAX + #tiles, #p.show) .. sub
  end
  setText("eng_rowsub_" .. color, engineCut(sub, 220))
  local sel = engineSelected[color] or {}
  for k = 1, ROW_MAX do
    local t, s = tiles[k], color .. "_" .. k
    setAttr("eng_rowslot_" .. s, "active", t ~= nil and "true" or "false")
    if t ~= nil then
      map.tiles[k] = t.opt
      engineSetImage("eng_rowimg_" .. s, engineUiImage(t.img))
      setText("eng_rowname_" .. s, engineCut(t.n, 70))
      setAttr("eng_rowslot_" .. s, "color", (t.opt ~= nil and sel[t.opt]) and "#E53935" or "#FFFFFF14")
    end
  end
  local b = {}
  if numberMode then
    local v = engineNumber[color].value
    b = { { id = "num:-1", text = "-", ok = v > (p.min or 0) }, { id = "num:+1", text = "+", ok = v < (p.max or v) },
      { id = "num:min", text = "Min" }, { id = "num:max", text = "Max" }, { id = "num:ok", text = "OK: " .. tostring(v), primary = true } }
  end
  for _, i in ipairs(others) do
    local o = p.options[i]
    -- a colour choice: each button in its colour
    local tint = describePrompt(p).kind == "color" and COLOR_BTN[tostring(o.id):sub(1, 1):lower()] or nil
    b[#b + 1] = { id = i, text = shortLabel(o.label), tint = tint, picked = p.mode == "multi" and sel[i] }
  end
  if page ~= nil and page.pages > 1 then
    b[#b + 1] = { id = "page:-1", text = "< Back", ok = page.n > 1 }
    b[#b + 1] = { id = "page:+1", text = "More >", ok = page.n < page.pages }
  end
  if p.mode == "multi" and not engineExactPick(p) then
    local n = count(sel)
    -- (pressable below its count too, to say how many: only its colour says it isn't ready)
    b[#b + 1] = { id = "confirm", text = "Done (" .. n .. ")", primary = engineCountOk(p, n) }
  end
  -- wide enough for its pictures and its buttons (220 each, 12 apart)
  setAttr("eng_row_" .. color, "width", tostring(math.max(720, #tiles * 192 + 60, math.min(#b, ROW_BTNS) * 232 + 48)))
  for k = 1, ROW_BTNS do
    local e = b[k]
    map.btns[k] = e and e.id
    setButton("eng_rowopt_" .. color .. "_" .. k, { active = e ~= nil and "true" or "false", text = e and e.text or " ",
      color = (e ~= nil and e.picked) and "#E53935" or (e ~= nil and e.tint) or ((e ~= nil and (e.primary or (p.mode == "single" and k == 1))) and "#e8711a" or "#2e3a59"),
      interactable = (e == nil or e.ok ~= false) and "true" or "false" })
  end
end
function onMtgRow(player, value, id)
  local color, k = id:match("^eng_rowbtn_(%a+)_(%d+)$")
  if color == nil or player.color ~= color then return end
  local i = (engineRowMap[color] and engineRowMap[color].tiles or {})[tonumber(k)]
  if i == nil then return end
  pick(color, i)
  -- (an exact number: the last pick answers here too, as on the table: Dauthi's "choose a card" in the row waited for
  -- Done while the corner said "1 of 1 chosen", hp-07 #33 re-test 2026-10-27)
  engineConfirmIfComplete(color)
end
function onMtgRowOpt(player, value, id)
  local color, k = id:match("^eng_rowopt_(%a+)_(%d+)$")
  if color == nil or player.color ~= color then return end
  local v = (engineRowMap[color] and engineRowMap[color].btns or {})[tonumber(k)]
  local p, st = enginePrompts[color], engineNumber[color]
  local page = engineRowPage[color]
  if type(v) == "string" and v:sub(1, 5) == "page:" then
    -- (the next or the last pictures of a long reveal: engineRowUpdate)
    if page ~= nil and p ~= nil and page.prompt == (p.promptId or p) then page.n = page.n + tonumber(v:sub(6)) engineRowUpdate(color) end
    return
  end
  if type(v) == "string" and v:sub(1, 4) == "num:" and p ~= nil and st ~= nil and st.prompt == p then
    -- the number picker: change the value, or answer with it
    local lo, hi = p.min or 0, p.max or st.value
    if v == "num:ok" then pick(color, st.value) return end
    if v == "num:-1" then st.value = math.max(lo, st.value - 1) elseif v == "num:+1" then st.value = math.min(hi, st.value + 1)
    elseif v == "num:min" then st.value = lo elseif v == "num:max" then st.value = hi end
    engineRowUpdate(color)
    return
  end
  -- (a button of an exact pick answers at the last click too, as the row's pictures and the table's cards: Power
  -- Depot's "which applies first?" waited for Done while the corner said "0 of 1 chosen", hp-12 #7 2026-10-27)
  if v == "confirm" then confirm(color) elseif v ~= nil then pick(color, v) engineConfirmIfComplete(color) end
end

-- Confirms a multi prompt once exactly the required number is chosen (table clicks feel instant).
function engineConfirmIfComplete(color)
  local p = enginePrompts[color]
  if not engineExactPick(p) or p.mode ~= "multi" then return end
  if count(engineSelected[color]) == p.max then confirm(color) end
end

local function idColor(id) return id:match("^eng_%a+_(%a+)") end

function onMtgSlot(player, value, id)
  local color, slot = id:match("^eng_opt_(%a+)_(%d+)$")
  if color == nil or player.color ~= color then return end
  if engineFixHandClick ~= nil and engineFixHandClick(color, tonumber(slot)) then return end
  local v = (engineVisible[color] or {})[tonumber(slot)]
  if v == "more" then
    enginePage[color].n = enginePage[color].n + 1
    updateOptions(color)
    return
  end
  -- a block picked in the window is confirmed in the chat too, as one picked on the table (combat clarity 2026-11-09),
  -- with the block it replaced (a creature blocks one attacker: pick drops its other one)
  local p = enginePrompts[color]
  local o = (p ~= nil and type(v) == "number" and not engineBrowse[color]) and (p.options or {})[v] or nil
  if o ~= nil and describePrompt(p).kind ~= "block" then o = nil end
  local was, dropped = false, nil
  if o ~= nil then
    was = engineSelectedFor(color, v)
    local b = tostring(o.id):match("^(.-)|")
    for j, x in ipairs(p.options) do
      if j ~= v and engineSelectedFor(color, j) and tostring(x.id):match("^(.-)|") == b then dropped = x end
    end
  end
  pick(color, v)
  if o == nil or engineTell == nil then return end
  local label = tostring(o.label)
  if engineSelectedFor(color, v) then
    local l = dropped and tostring(dropped.label) or ""
    local at = l:find(" blocks ", 1, true)
    engineTell(color, label .. "." .. (at and (" (It no longer blocks " .. l:sub(at + 8) .. ".)") or "") .. " Done when finished.", true)
  elseif was then engineTell(color, "Taken back: " .. label .. ".", true) end
end
enginePage = {} -- colour -> { key, n }: the page of a long answer list (see updateOptions)
function onMtgConfirm(player, value, id)
  if player.color ~= idColor(id) then return end
  if engineFixHandClick ~= nil and engineFixHandClick(player.color, "done") then return end -- (Done of a fix from hand)
  confirm(player.color)
end
function onMtgCancel(player, value, id) if player.color == idColor(id) then engineAnswer(player.color, { "__cancel" }) end end
function onMtgToggle(player, value, id)
  if player.color ~= idColor(id) then return end
  engineOpenTab(player.color, "choices")
end
-- ───────── game log (phase 3) ─────────
engineLog = {}
-- The panel's Text (414x280, fontSize 13, LowerLeft) holds about 19 rows of 60-62 characters, and TTS clips what
-- overflows at the BOTTOM: 16 entries with a wrapped one (the debug-setup line is ~9 rows, a mill of 10 cards 2-3) hid
-- the newest lines (live check 2026-11-11: the panel stopped at 14:49, the log ran to 14:52). So entries are taken from
-- the newest back while their estimated rows fit, erring on fewer (58 a row, 18 rows; bytes, so é and → count more).
ENGINE_LOG_ROWS, ENGINE_LOG_ROW_CHARS = 18, 58
-- an entry's lines (split with plain find: no pattern for MoonSharp to give up on)
function engineLogLines(entry)
  local s, out, at = tostring(entry), {}, 1
  while true do
    local nl = s:find("\n", at, true)
    if nl == nil then out[#out + 1] = s:sub(at) return out end
    out[#out + 1] = s:sub(at, nl - 1)
    at = nl + 1
  end
end
-- rows one entry takes: each of its lines wraps every perRow characters
function engineLogRows(entry, perRow)
  local rows = 0
  for _, line in ipairs(engineLogLines(entry)) do rows = rows + math.max(1, math.ceil(#line / perRow)) end
  return rows
end
-- an entry taller than `rows` rows, cut to fit with "…" (a row kept for the "…"; cut at a character's first byte, as
-- a UTF-8 character split in two shows as junk)
function engineLogCut(entry, rows, perRow)
  local kept, left = {}, rows - 1
  for _, line in ipairs(engineLogLines(entry)) do
    local n = math.max(1, math.ceil(#line / perRow))
    if n > left then
      local cut = math.max(0, left * perRow)
      while cut > 0 and (line:byte(cut + 1) or 0) >= 128 and (line:byte(cut + 1) or 0) < 192 do cut = cut - 1 end
      kept[#kept + 1] = line:sub(1, cut) .. "…"
      break
    end
    kept[#kept + 1] = line
    left = left - n
  end
  return table.concat(kept, "\n")
end
-- the newest entries of `log` that fit `rows` rows, oldest first; the newest always, cut if it alone is taller
function engineLogFit(log, rows, perRow)
  local out, used = {}, 0
  for i = #log, 1, -1 do
    local n = engineLogRows(log[i], perRow)
    if used + n > rows then
      if #out == 0 then out[1] = engineLogCut(log[i], rows, perRow) end
      break
    end
    table.insert(out, 1, log[i])
    used = used + n
  end
  return out
end
function engineRenderLog()
  if not panelReady then return end
  local lines = engineLogFit(engineLog, ENGINE_LOG_ROWS, ENGINE_LOG_ROW_CHARS)
  local text = #lines > 0 and table.concat(lines, "\n") or "Nothing has happened yet."
  for _, c in ipairs(getSeatedPlayers()) do if data[c] then setText("eng_logtext_" .. c, text) end end
end
function engineOnLog(m)
  local was = #engineLog
  if m.reset then engineLog = {} end
  for _, l in ipairs(m.lines or {}) do engineLog[#engineLog + 1] = l end
  while #engineLog > 200 do table.remove(engineLog, 1) end
  engineRenderLog()
  -- (the log panel shows from its first line, and hides again with an emptied log)
  if panelReady and (was == 0) ~= (#engineLog == 0) then
    for _, c in ipairs(getSeatedPlayers()) do if data[c] then updatePanel(c) end end
  end
end
function onMtgLog(player, value, id)
  if player.color ~= idColor(id) then return end
  engineLogHidden[player.color] = not engineLogHidden[player.color] or nil
  updatePanel(player.color)
end

local function cornerPress(color, which)
  local c = engineCorner[color]
  local v = c and c[which]
  if v == nil then return end
  local changed = c[which .. "At"]
  if changed ~= nil and os.clock() - changed < 0.6 then return end
  if v == "confirm" then confirm(color) elseif v == "cancel" then engineAnswer(color, { "__cancel" }) else pick(color, v) end
end
function engineCornerPress(color, which) cornerPress(color, which) end
function onMtgBig(player, value, id) if id == "eng_big_" .. player.color then cornerPress(player.color, "big") end end

-- ───────── rewind by vote (M4.5): the bridge sends `rewind` = { points = {{id,label}}, vote = {...} } with the board ─────────
engineRewind = nil
local rewindSig = nil
function engineRewindUpdate(r, gameOver)
  engineRewind = r
  -- (a plain string, not JSON.encode: cheap, and nothing here can trip TTS's encoder. With whether a board has come:
  -- the Auto-resolve button drawn here shows only in a game, and a redraw of the panels before the first board read
  -- gameOver false too, so a game without restore points never showed it, live check batch 2, 2026-11-12)
  local parts = { tostring(gameOver) .. "|" .. tostring(lastTable ~= nil) }
  for _, pt in ipairs((r and r.points) or {}) do parts[#parts + 1] = tostring(pt.id) .. "=" .. tostring(pt.label) end
  local v0 = r and r.vote
  if v0 ~= nil then parts[#parts + 1] = table.concat({ tostring(v0.id), tostring(v0.status), tostring(v0.by), tostring(v0.byColor), tostring(v0.to), table.concat(v0.waiting or {}, ","), tostring(v0.note), tostring(v0.go) }, "|") end
  local sig = table.concat(parts, ";")
  if sig == rewindSig then return end
  rewindSig = sig
  local v = r and r.vote
  for c in pairs(engineColors) do
    if Player[c] ~= nil and Player[c].seated then
      -- (gameOver too: a reset draws this while lastTable is still the ended game's)
      if engineAutoResolveDraw ~= nil then engineAutoResolveDraw(c, gameOver) end
      local has = r ~= nil and r.points ~= nil and #r.points > 0 and not gameOver
      setAttr("eng_undo_" .. c, "active", has and "true" or "false")
      -- (the Undo tab follows the points: listed again, or shut once there are none)
      if engineBrowse[c] == "undo" and panelReady then
        if has then updateOptions(c) else engineOpenTab(c, "undo") end
      end
      local pending = v ~= nil and v.status == "pending"
      local mine = false
      for _, w in ipairs((v and v.waiting) or {}) do if w == c then mine = true end end
      -- (the asker's Keep playing takes the vote back while someone is still to vote: a voter who never answered held
      -- the game until a concession, table log 2026-11-12 01:18; the bridge's byColor)
      local asker = pending and not mine and v.byColor == c and v.waiting ~= nil and #v.waiting > 0
      setAttr("eng_vote_" .. c, "active", pending and "true" or "false")
      if pending then
        -- (everyone has voted and the engine waits for a priority question: v.note says who it waits for)
        -- (the people still to vote by name; a bot votes by itself, so it isn't waited for: waitingNames, the bridge's)
        local names = v.waitingNames or v.waiting or {}
        setText("eng_votetext_" .. c, tostring(v.by or "A player") .. " asks to rewind to " .. tostring(v.to) .. "."
          .. (v.note ~= nil and ("\n" .. tostring(v.note)) or (mine or #names == 0) and "" or ("\nWaiting for " .. table.concat(names, ", ") .. "..."))
          .. (asker and "\nKeep playing takes it back." or ""))
      end
      setAttr("eng_voteyes_" .. c, "active", (pending and mine) and "true" or "false")
      setAttr("eng_voteno_" .. c, "active", (pending and (mine or asker)) and "true" or "false")
      -- (everyone agreed but a question is open: the button says where to, and goes there without answering it)
      local go = pending and v.go == true
      setAttr("eng_votego_" .. c, "active", go and "true" or "false")
      if go then setText("eng_votego_" .. c, "Rewind to " .. tostring(v.to)) end
    end
  end
end
-- the panels were rebuilt (someone sat down): draw the rewind UI again from the last board's state
function engineRewindRedraw()
  rewindSig = nil
  engineRewindUpdate(engineRewind, lastTable ~= nil and lastTable.gameOver)
end
-- Auto-resolve (2026-10-23): your own setting, beside Undo; the bridge passes for you. A list since 2026-10-31 (the
-- player's request): off, other players' turns, or until a phase ("mtg skip", the bridge's SKIP_PHASES). One choice at a
-- time. One list shared by every seat, like the stack pop-up (its "visibility" is who has it open): a list per seat
-- would take 4 KB of the 60 KB limit, and only 3.5 KB was left.
engineAutoResolve = {}
engineSkipTo = {}       -- colour -> the phase word the bridge is passing until
engineAutoListOpen = {} -- colour -> true while that player has the list open
engineAutoChoices = { { "off", "Off" }, { "others", "Other players' turns" }, { "upkeep", "Until upkeep" }, { "draw", "Until draw" },
  { "main", "Until main phase" }, { "combat", "Until combat" }, { "blockers", "Until blockers" }, { "damage", "Until damage" },
  { "main2", "Until main 2" }, { "end", "Until end step" }, { "mine", "Until my turn" } }
-- (TTS's own tool bars were covered while a game ran, 2026-11-02, by panels measured on one 1920x1080 screen: on other
-- screens and UI scales they floated as black boxes, the user's "floating black boxes", 2026-11-09; removed 2026-11-10)
function engineAutoListXml()
  local o = {}
  for i, ch in ipairs(engineAutoChoices) do
    o[i] = '<Button id="eng_auto_' .. ch[1] .. '" onClick="onMtgAutoPick" preferredHeight="26" color="#262626" textColor="#ffffff" fontSize="14">' .. ch[2] .. '</Button>'
  end
  return '<Panel id="eng_autolist" width="176" height="' .. (#o * 28 + 10) .. '" rectAlignment="UpperLeft" offsetXY="468 -174" color="#161616F0" active="false">'
    .. '<VerticalLayout padding="4 4 4 4" spacing="2" childForceExpandHeight="false">' .. table.concat(o) .. '</VerticalLayout></Panel>'
end
function engineAutoListDraw()
  local v = {}
  for c in pairs(engineAutoListOpen) do v[#v + 1] = c end
  table.sort(v)
  -- (an empty list would show it to everyone)
  if #v > 0 then setAttr("eng_autolist", "visibility", table.concat(v, "|")) end
  setAttr("eng_autolist", "active", #v > 0 and "true" or "false")
end
-- (over: the caller knows the game is over, engineRewindUpdate at a reset)
function engineAutoResolveDraw(c, over)
  local inGame, skip = lastTable ~= nil and not lastTable.gameOver and not over, engineSkipTo[c]
  local label = engineAutoResolve[c] and "Auto-resolve: on" or "Auto-resolve: off"
  for _, ch in ipairs(engineAutoChoices) do if ch[1] == skip then label = ch[2] end end
  setAttr("eng_autores_" .. c, "active", inGame and "true" or "false")
  setText("eng_autores_" .. c, label .. "...")
  setAttr("eng_autores_" .. c, "color", (engineAutoResolve[c] or skip) and "#2e7d32" or ENGINE_THEME.dock)
  if not inGame then engineAutoListOpen[c] = nil end
  engineAutoListDraw()
end
function engineSetAutoResolve(c, on)
  engineAutoResolve[c] = on or nil
  if on then engineSkipTo[c] = nil end
  engineSend("autoresolve", { color = c, on = on and true or false })
  engineAutoResolveDraw(c)
end
-- the bridge says what this player's list is set to: it ends a skip by itself, and "mtg skip" comes from the chat
function engineOnAutoState(m)
  engineSkipTo[m.color] = m.phase ~= "" and m.phase or nil
  engineAutoResolve[m.color] = m.on or nil
  engineAutoResolveDraw(m.color)
end
function onMtgAutoResolve(player, value, id)
  local c = player.color
  if id ~= "eng_autores_" .. c then return end
  engineAutoListOpen[c] = not engineAutoListOpen[c] or nil
  engineAutoListDraw()
end
function onMtgAutoPick(player, value, id)
  local c, pick = player.color, id:match("^eng_auto_(%w+)$")
  if not engineAutoListOpen[c] then return end
  engineAutoListOpen[c] = nil
  -- (engineTell, not tell: tell is a local defined further down, nil here; calling it raised an error)
  if pick == "others" then
    engineSetAutoResolve(c, true)
    engineTell(c, "Auto-resolve on: on other players' turns you pass by itself. Your own turn asks as usual.")
  elseif pick == "off" then
    if engineAutoResolve[c] then engineSetAutoResolve(c, false) engineTell(c, "Auto-resolve off.") end
    if engineSkipTo[c] then engineSend("skipto", { color = c, phase = "off" }) end
  else
    engineSend("skipto", { color = c, phase = pick }) -- (the bridge answers with engineOnAutoState)
  end
  engineAutoListDraw()
end
-- the Undo tab (its button shows while there are restore points)
function onMtgUndo(player, value, id)
  local c = player.color
  if id ~= "eng_undo_" .. c then return end
  engineOpenTab(c, "undo")
end
function engineAskRewind(color, k)
  local pt = engineRewind and engineRewind.points and engineRewind.points[k]
  if pt == nil then return false end
  engineSend("rewind", { color = color, checkpointId = pt.id })
  return true
end
-- (the old Undo list's buttons, "eng_undopt_<colour>_<k>": the tests still pick with them; the tab's lines are the
-- window's answer buttons, picked in pick)
function onMtgUndoPick(player, value, id)
  local c = player.color
  local k = tonumber(tostring(id):match("^eng_undopt_" .. c .. "_(%d+)$") or "")
  if k == nil then return end
  if engineBrowse[c] == "undo" then engineOpenTab(c, "undo") end
  engineAskRewind(c, k)
end
function onMtgVote(player, value, id)
  local c = player.color
  if id == "eng_voteyes_" .. c then engineSend("rewindVote", { color = c, accept = true })
  elseif id == "eng_voteno_" .. c then engineSend("rewindVote", { color = c, accept = false })
  elseif id == "eng_votego_" .. c then engineSend("rewindGo", { color = c }) end
end
function onMtgBig2(player, value, id) if id == "eng_big2_" .. player.color then cornerPress(player.color, "small") end end
function onMtgBig3(player, value, id) if id == "eng_big3_" .. player.color then cornerPress(player.color, "group") end end

function onMtgStop(player, value, id)
  local g, color = id:match("^eng_stop_(%a+)_(%a+)$")
  if color ~= player.color then return end
  if g == "hold" then engineSend("hold", { color = color, on = true }) return end
  local stops = engineStopsOf(color)
  stops[g] = not stops[g] or nil
  local list = {}
  for k in pairs(engineStops[color]) do list[#list + 1] = k end
  engineSend("stops", { color = color, stops = list })
  engineUpdateCorner(color, enginePrompts[color])
end

-- Settings (2026-10-22): a tab of the window (batch B) listing My effects / My sounds / Table animations / held moves.
engineSoundOff = {}    -- colour -> true: that player asked for no sounds (the table's sounds are shared: the host's switch)
-- M5 step 4 sound picks (docs/m5-effects-design.md section 6, "Plugging in a sound"): nil = silent. A link to an
-- .mp3 (https://...) plays through the table's music player, for everyone; a name plays that trigger effect of the
-- sound object (an AssetBundle whose GM notes are "engine:sounds"). The sounds are on the host's TTS Cloud
-- (docs/sounds.md). Every kind has one since 2026-11-12: that day's upload added counter, knockout, countered,
-- playerhit, bighit, sorcery and their bursts, and the louder death, instant, death_x2..x8 and wipe_x3..x8.
engineSounds = engineSounds or {
  death = "https://steamusercontent-a.akamaihd.net/ugc/11698913979615550185/7F13F2B39D7065CE85AC235B6369A0747F6F712E/",       -- a permanent to the graveyard
  wipe = "https://steamusercontent-a.akamaihd.net/ugc/11479971636843136595/5C0FB88EC6DE1F473D4067207ADDB4CCC0540597/",        -- 3 or more to graveyards on one board
  damage = "https://steamusercontent-a.akamaihd.net/ugc/10124521221080295893/E301DC2C50A312AB8C6C1EDBB7C295B3AC76B06E/",      -- damage to a creature (5 or less); every hit with no playerhit / bighit pick
  exile = "https://steamusercontent-a.akamaihd.net/ugc/17507000918538872455/683F8320B4DB9EAF77CF1AF05D1205EF94F7BA65/",       -- a permanent exiled from the battlefield
  instant = "https://steamusercontent-a.akamaihd.net/ugc/15655704109114108865/027ADEDADC1E8E89E6AF2D66E77010F5D9A82298/",     -- an instant cast (not abilities, not copies)
  lifegain = "https://steamusercontent-a.akamaihd.net/ugc/18328296034120530417/099A768F25DE573194668B6ACDFC47C3BC4F0DE7/",    -- a player's life goes up
  counter = "https://steamusercontent-a.akamaihd.net/ugc/18384867903770801477/E84A3FA1E2AA6059EFD2D315A776D43AEBFD2E87/",     -- a counter put on a permanent
  knockout = "https://steamusercontent-a.akamaihd.net/ugc/11703297018823193116/BCCEEF4571C8BD6A30FF2AF0350DE2C53A1DF345/",    -- a player loses or concedes
  countered = "https://steamusercontent-a.akamaihd.net/ugc/16931120861737353001/A2214840FC305FC9063F57823D4C2852D2383CD3/",   -- a spell countered (as the COUNTERED pop-up)
  playerhit = "https://steamusercontent-a.akamaihd.net/ugc/17427026780177468511/DC419EEC5FE59459E3F2417452DDE9E381380D0F/",   -- 1 to 5 damage to a player (bursts playerhit_x2..x8)
  bighit = "https://steamusercontent-a.akamaihd.net/ugc/13928224574378758506/BFC535CE502EC967E020203AE6E1CAA2A68E703C/",      -- one hit of more than 5, to a player or a creature (bursts bighit_x2..x8)
  sorcery = "https://steamusercontent-a.akamaihd.net/ugc/14467135192415793223/86376C7381097865A4421068FCA1FF8827BE47A8/",     -- a sorcery cast (not abilities, not copies)
  -- the bursts (docs/sounds.md "Bursts", 2026-11-11): the kind's sound stacked N times, for N or more of it on one board
  -- (FX.burst: the largest at or under the count, up to x8); wipe's plain sound is already its 3+ one, so it has no x2
  bighit_x2 = "https://steamusercontent-a.akamaihd.net/ugc/10102534904146116314/FEC357F76AD3BC3E204485638504751C6EA5B3B4/",
  bighit_x3 = "https://steamusercontent-a.akamaihd.net/ugc/11596786930130643260/0DCA16B265095D18A20987D952273510DE3145BB/",
  bighit_x4 = "https://steamusercontent-a.akamaihd.net/ugc/16029644423041008713/DBCF6A81CA79412C182C41A9A2EBDC7CFB595643/",
  bighit_x6 = "https://steamusercontent-a.akamaihd.net/ugc/11089834991395856694/583F01EAB5F918482F28CB6B30208E082AD7F95E/",
  bighit_x8 = "https://steamusercontent-a.akamaihd.net/ugc/14567024543913859128/655F1FDF1BF798D88ACBA5CC2648E8EB878C4135/",
  damage_x2 = "https://steamusercontent-a.akamaihd.net/ugc/9466119173358429772/2E01C49BC2F53D6B93F512EA0A64749DDA634A13/",
  damage_x3 = "https://steamusercontent-a.akamaihd.net/ugc/17172338814229470186/BA59E9063B3D8BCAB7189038A65371A54F7D222C/",
  damage_x4 = "https://steamusercontent-a.akamaihd.net/ugc/13841800202556732767/F0038F1475AEFEC61821E465C78BC3EC21D80C35/",
  damage_x6 = "https://steamusercontent-a.akamaihd.net/ugc/11502082504506897617/CF4A879844D92A2B54F7C750CD94BB636EE34ED4/",
  damage_x8 = "https://steamusercontent-a.akamaihd.net/ugc/15514955064335890272/27041620B6C22438F8CEE38F4DEA99C3F41E499F/",
  death_x2 = "https://steamusercontent-a.akamaihd.net/ugc/16160518566392322538/3D6776DCCE5662B172CD4184F6344747B424BB5D/",
  death_x3 = "https://steamusercontent-a.akamaihd.net/ugc/11242284143342103969/869EFC92C49790389FF0AC51C65A2932903FAE7E/",
  death_x4 = "https://steamusercontent-a.akamaihd.net/ugc/14108423383041101533/2B7557832A1D8B69BE205F1FA054FD5985C9243C/",
  death_x6 = "https://steamusercontent-a.akamaihd.net/ugc/13804901690921610856/0E73D20BEA8004922AC93B72FBC240863778E6D3/",
  death_x8 = "https://steamusercontent-a.akamaihd.net/ugc/17462850133371665419/F8E3B2BB340E54993FC37392890ACC457FB1485B/",
  exile_x2 = "https://steamusercontent-a.akamaihd.net/ugc/17186924497210315771/FE7A0190EFBB0DD9CF10187AC7F4A053FF1445A5/",
  exile_x3 = "https://steamusercontent-a.akamaihd.net/ugc/16360686395485260339/33E0E7B8EE9466915355D652E0E2F53319E380E2/",
  exile_x4 = "https://steamusercontent-a.akamaihd.net/ugc/10667382779559099124/73D0ED29786C7A9DBED6E09027F1BD86EA407F00/",
  exile_x6 = "https://steamusercontent-a.akamaihd.net/ugc/17333791709913556002/D96572C923879FA41AA4FF78BABF33C230B7BE18/",
  exile_x8 = "https://steamusercontent-a.akamaihd.net/ugc/16336440088589292350/C7421989BD48CF0D53217080BCD600880C9EABF3/",
  lifegain_x2 = "https://steamusercontent-a.akamaihd.net/ugc/10399168408910104955/AACB8F7F754DBFEC4CB9FA5E160B526C0B369D03/",
  lifegain_x3 = "https://steamusercontent-a.akamaihd.net/ugc/14232928834878565003/0A18B59FCF2658F59C5946B812F153BC70EE8BB3/",
  lifegain_x4 = "https://steamusercontent-a.akamaihd.net/ugc/15145076126188951042/48A9C18F2948F0AAF6BE76DCE1ADC5A4F9694697/",
  lifegain_x6 = "https://steamusercontent-a.akamaihd.net/ugc/13678081104005473403/478E8433DBE00A0525EA21D206CA4DEEAFB5CBBE/",
  lifegain_x8 = "https://steamusercontent-a.akamaihd.net/ugc/12456025496901847800/D91EEE8A25C5F36EB72180F2363E38FC7B649D23/",
  playerhit_x2 = "https://steamusercontent-a.akamaihd.net/ugc/18385823772406590874/F67603DF33151D56EE4F4918A969DA71AEC93182/",
  playerhit_x3 = "https://steamusercontent-a.akamaihd.net/ugc/15674528219804165919/03D2A5F8726309453086C91906045D28E9407290/",
  playerhit_x4 = "https://steamusercontent-a.akamaihd.net/ugc/17558314647484330927/633D523AF1FC71C73C7737BA1C2D3D449CF9E983/",
  playerhit_x6 = "https://steamusercontent-a.akamaihd.net/ugc/11410730380554930576/B9D76DCEE32CFC1BEBB704F01E34AF4BB66F2409/",
  playerhit_x8 = "https://steamusercontent-a.akamaihd.net/ugc/13466691882656356958/8CBA319CD04332BEA45C8976283C9FD7A53C78D6/",
  wipe_x3 = "https://steamusercontent-a.akamaihd.net/ugc/15886777703497702507/C882FFB1C26BEE20C87791A7135A3FBA1EAD3990/",
  wipe_x4 = "https://steamusercontent-a.akamaihd.net/ugc/12703812866224761222/8F7B4507EC055B76100A5BF6966D5C085331E6A8/",
  wipe_x6 = "https://steamusercontent-a.akamaihd.net/ugc/14531756883241499521/4AB4F03063BBA056EE23C175B621BE4FB228DE58/",
  wipe_x8 = "https://steamusercontent-a.akamaihd.net/ugc/10603921525270560187/08115EEC453EE7937CD5B34288B696512A190D7D/",
}
-- each clip's length in seconds, where it isn't 2 (docs/sounds.md: every clip is padded to at least 2 s; a clip is
-- paused just before its length runs out, engineSoundPlay)
engineSoundLen = engineSoundLen or { exile_x6 = 2.04, exile_x8 = 2.25, lifegain_x8 = 2.25, bighit_x8 = 2.2 }
-- the sound kinds, most important first: one sound per board, the first of these on it that has a pick
engineSoundKinds = { "knockout", "wipe", "bighit", "death", "exile", "countered", "playerhit", "damage", "lifegain", "sorcery", "instant", "counter" }
engineSoundsMuted = false -- the host's switch for the whole table
-- the three pictures of the table effects (links from TTS's Cloud Manager); nil = a coloured "●" stands in
engineFxArt = engineFxArt or { burst = nil, smoke = nil, ring = nil }
-- the effect and sound AssetBundles (M5 step 4, docs/m5-assetbundle-build.md): their links (TTS Cloud Manager). With
-- a link and no such object on the table, a game's first board spawns them once, parked under the table (fx: the
-- pool of rigs, GM notes "engine:fx"; sounds: one object, "engine:sounds"); they then stay in the save. nil or "" =
-- nothing spawned (rigs or a sound object already in the save are still used); with none, the effects are today's.
-- bolt: the bolt bundle (mtg-bolt.unity3d, rigs "engine:bolt"), not uploaded yet: no bolts until it is.
engineFxBundle = engineFxBundle or { fx = "https://steamusercontent-a.akamaihd.net/ugc/17312155686528737831/7C7D27241612C44285FAC94314BB736DD2887FCA/", sounds = nil, bolt = nil }
-- The particle effects (docs/particle-fx-spec.md), "mtg fx on|low|off" (the host's, saved with the game): on, all of
-- them; low, a wipe's wave without its cards' own deaths, and no bolts; off, no rig effect at all, the table as it was
-- without the bundle (sounds, slots and flashes stay). engineFxTint: the host's flag for the live tint check (a
-- neutral effect tinted by setColorTint instead of the baked colours); engineFxBoltMove: the bolt's fallback should
-- the bundle's animation not play (Lua moves the rig).
engineFxMode = engineFxMode or "on"
engineFxTint = engineFxTint or false
engineFxBoltMove = engineFxBoltMove or false
function engineSetFxMode(mode, by)
  if mode ~= "on" and mode ~= "low" and mode ~= "off" then return false end
  engineFxMode = mode
  broadcastToAll("[MTG] Table particle effects: " .. mode .. (by and (" (" .. by .. ")") or "") .. ".", {1, 0.85, 0.4})
  return true
end
-- "mtg sounds on/off" and Settings → My sounds: the host mutes the table; anyone else is told it's shared
function engineSetSounds(player, on)
  engineSoundOff[player.color] = (not on) or nil
  if player.host then
    engineSoundsMuted = not on
    broadcastToAll("[MTG] Table sounds " .. (on and "on" or "off") .. " (" .. tostring(player.steam_name) .. ").", {1, 0.85, 0.4})
  else
    player.broadcast("[MTG] Table sounds are shared: ask the host, or turn down Music / Effects in TTS's settings.", {1, 0.85, 0.4})
  end
  if panelReady then updatePanel(player.color) end
end
function onMtgSettings(player, value, id)
  if player.color ~= idColor(id) then return end
  engineOpenTab(player.color, "settings")
end
function onMtgSnd(player, value, id)
  if player.color ~= idColor(id) then return end
  engineSetSounds(player, engineSoundOff[player.color] ~= nil)
end
-- Effects (each player, 2026-10-22): that player's own screen effects: the VICTORY / DEFEAT / "IS OUT" banners, the
-- turn banner, the stack pop-up and (step 4) the table effects' panels on their screen. Players who want the plain
-- TTS table turn them off; others keep the Arena look.
function onMtgFx(player, value, id)
  if player.color ~= idColor(id) then return end
  engineEffectsOff[player.color] = not engineEffectsOff[player.color] or nil
  if enginePopRefresh ~= nil then enginePopRefresh() end
  updatePanel(player.color)
end
-- Table animations (the host, 2026-10-22): the attack lunge, mills turning over on their way to the graveyard and the
-- graveyard flash when creatures die. These move or light real objects, which every player sees, so one switch
-- for the table. The target / attack / block lines stay (they say what is attacking and targeting what).
engineAnimOff = false
function engineSetAnimations(on, by)
  engineAnimOff = not on
  broadcastToAll("[MTG] Table animations " .. (on and "on" or "off") .. (by and (" (" .. by .. ")") or "") .. ".", {1, 0.85, 0.4})
  for _, c in ipairs(getSeatedPlayers()) do if panelReady then updatePanel(c) end end
end
function onMtgAnim(player, value, id)
  if player.color ~= idColor(id) or not player.host then return end
  engineSetAnimations(engineAnimOff, player.steam_name)
end
function onMtgPace(player, value, id)
  if player.color ~= idColor(id) then return end
  engineAutoPace[player.color] = not engineAutoOn(player.color)
  updatePanel(player.color)
  if engineAutoOn(player.color) then
    local color = player.color
    Wait.time(function() if engineAutoOn(color) then engineReleasePending(color, "all") end end, AUTO_PACE_DELAY)
  end
end

function onMtgBrowse(player, value, id)
  if player.color ~= idColor(id) then return end
  engineOpenTab(player.color, "browse")
end

-- The window's tabs (docs/engine-ui-spec.md 3): "choices" (the open question's answers), or a side tab over them,
-- engineBrowse[color] = "browse" (graveyards and exile), "undo" (restore points) or "settings". A side tab opens the
-- window if it was shut ("browse" in engineShown); clicking the open side tab goes back to what was there before (the
-- answers if they were open, else the window shuts). Choices opens the answers pinned, or shuts a pinned window.
function engineOpenTab(color, tab)
  local was = engineBrowse[color]
  engineFilter[color] = nil
  if tab == "choices" then
    if was == nil then engineShown[color] = not engineShown[color] and "pin" or nil else engineShown[color] = "pin" end
    engineBrowse[color] = nil
  elseif was == tab then
    engineBrowse[color] = nil
    if engineShown[color] == "browse" then engineShown[color] = nil end
  else
    engineBrowse[color] = tab
    engineShown[color] = engineShown[color] or "browse"
  end
  if panelReady then setText("eng_search_" .. color, "") end
  updatePanel(color)
  updateOptions(color)
end

-- Keeps an open graveyard/exile list current as cards come and go.
function engineRefreshBrowse()
  if not panelReady then return end
  for c in pairs(engineBrowse) do updateOptions(c) end
end

function onMtgSearch(player, value, id)
  if player.color ~= idColor(id) then return end
  if engineFixHandNote ~= nil and engineFixHandNote(player.color, value) then return end -- (the box is a fix note then)
  engineFilter[player.color] = value
  updateOptions(player.color)
end

-- Older button ids, still used by the automated tests: "o|Color|i", "confirm|Color", "cancel|Color", "n|Color|n".
function onMtgClick(player, value, id)
  local kind, color, arg = id:match("^(%a+)|(%a+)|?(.*)$")
  if kind == nil or player.color ~= color then return end
  if kind == "o" or kind == "n" then pick(color, tonumber(arg))
  elseif kind == "confirm" then confirm(color)
  elseif kind == "cancel" then engineAnswer(color, { "__cancel" })
  elseif kind == "toggle" then engineOpenTab(color, "choices") end
end

function engineOnPrompt(m)
  -- library searches carry each card's details once (like the board): merge them, then fill in the slim entries
  for id, st in pairs(m.cards or {}) do engineStoreStatic(id, st) end
  m.cards = nil
  for _, c in ipairs(m.librarySearch or {}) do
    if c.s ~= nil then
      for k, v in pairs(engineStatic[c.id] or {}) do if c[k] == nil then c[k] = v end end
      c.s = nil
    end
  end
  if m.promptId == nil then enginePrompts[m.color] = nil else enginePrompts[m.color] = m end
  -- the cards anyone's open question names (targets, attackers to block, cards to choose, planeswalkers) are clickable
  -- now; the ones no longer named lock again if they are not their owner's to move (see engineClickable)
  local wasClickable = engineClickable
  engineClickable = {}
  for _, q in pairs(enginePrompts) do
    for _, o in ipairs(q.options or {}) do
      for id in (tostring(o.id or "") .. "|" .. tostring(o.cardId or "")):gmatch("engine%-card%-%d+") do engineClickable[id] = true end
    end
  end
  for id in pairs(engineClickable) do
    local o = engineObjs[id]
    if not wasClickable[id] and o ~= nil and not o.isDestroyed() and o.getLock() then o.setLock(false) end
  end
  for id in pairs(wasClickable) do
    local o, meta = engineObjs[id], engineMeta[id]
    -- (never a hand card: a locked card drops out of its hand zone and shows to everyone until the next redraw, the hands
    -- of those who had answered Nicol Bolas's "each opponent discards" lay open until the last one did, game 2026-11-01)
    local inHand = meta ~= nil and (meta.zone == "hand" or meta.hand2)
    if not engineClickable[id] and o ~= nil and not o.isDestroyed() and not isFree(meta) and not inHand then o.setLock(true) end
  end
  engineChoosable = engineChoosable or {}
  engineChoosable[m.color] = nil
  if m.promptId ~= nil and m.pileChoices ~= nil then
    engineChoosable[m.color] = {}
    for _, cid in ipairs(m.pileChoices) do engineChoosable[m.color][cid] = true end
  end
  local search = m.promptId ~= nil and m.librarySearch or nil
  if (engineSearch or {})[m.color] ~= search then
    engineSearch = engineSearch or {}
    engineSearch[m.color] = search
    if lastTable ~= nil then Wait.frames(function() if lastTable ~= nil then engineRender(lastTable) end end, 1) end
  end
  -- a question closes (answered elsewhere, withdrawn) or a new one opens: see engineEnterPrompt / engineExitPrompt
  if m.promptId == nil then engineExitPrompt(m.color)
  else engineSelected[m.color] = nil engineFilter[m.color] = nil engineEnterPrompt(m.color, m) end
  -- The panel opens by itself only for questions the table can't answer (not priority, paying, combat, targets,
  -- cards on the table, the card row, two-button questions in the corner) and closes again once the next question
  -- is one of those, or the question is gone. A panel the player opened (the Choices tab) stays open.
  if engineShown[m.color] ~= "pin" and engineShown[m.color] ~= "browse" then
    local handled = true
    if m.promptId ~= nil then
      local kind = enginePromptKind and enginePromptKind(m)
      -- (the corner's second button only shows End turn / Resolve / No / Mulligan: "Tap X for which mana?" with two
      -- colours needs the panel)
      local opts = m.options or {}
      local small = { __endturn = true, __resolve = true, no = true, mull = true }
      -- the card row (engineRowUpdate) fits ROW_MAX pictures and ROW_BTNS buttons: anything bigger needs the panel (a
      -- 352-way "choose a creature type" with its card's picture showed nowhere, 2026-10-22 review); a library search
      -- is picked from the panel's list (or right-click Search), as Arena opens a search window
      local pictures = 0
      for _, o in ipairs(opts) do if o.img ~= nil then pictures = pictures + 1 end end
      local fits = #opts <= (m.mode == "multi" and ROW_BTNS - 1 or ROW_BTNS)
      -- (a question whose cards are pictures, not on the table, that the row can't hold is answered in the panel: Kenrith's
      -- "target creature card from a graveyard" with 8 showed nowhere, hp-07 #41 2026-10-27)
      handled = (kind ~= nil and m.librarySearch == nil and engineAnswerPlace(m) ~= "panel")
        or (m.mode == "single" and (#opts <= 1 or (#opts == 2 and small[tostring(opts[2].id)])))
        or m.mode == "number"
        or (pictures > 0 and pictures <= ROW_MAX and #opts - pictures <= ROW_BTNS - 1)
        or (pictures == 0 and #opts > 0 and fits and (m.show ~= nil or ROW_BUTTON_KINDS[describePrompt(m).kind] ~= nil))
    end
    engineShown[m.color] = (not handled) and "ask" or nil
  end
  if m.promptId ~= nil and describePrompt(m).kind ~= "priority" and engineBrowse[m.color] then
    engineBrowse[m.color] = nil
    if engineShown[m.color] == "browse" then engineShown[m.color] = nil end
    if panelReady then updatePanel(m.color) end
  end
  if panelReady then setText("eng_search_" .. m.color, "") end
  -- (once in ~60 games TTS raised "Value cannot be null, key" right after a question arrived: catch it and say where)
  local ok, err = pcall(engineRenderPanels, m.color)
  if not ok then print("[engine] panel error (" .. tostring(m.color) .. ", " .. tostring(m.title) .. "): " .. tostring(err)) end
  if enginePhase2Prompt ~= nil then
    ok, err = pcall(enginePhase2Prompt, m.color)
    if not ok then print("[engine] glow/menu error (" .. tostring(m.color) .. ", " .. tostring(m.title) .. "): " .. tostring(err)) end
  end
  if enginePlayableGlow ~= nil then
    ok, err = pcall(enginePlayableGlow, m.color)
    if not ok then print("[engine] playable glow error: " .. tostring(err)) end
  end
end

-- ───────── playing by hand (SPEC §10a) ─────────
-- Players drag their own cards like on a normal table; each move is a request to the engine, which accepts it
-- (the card stays) or refuses it (the card snaps back with a reason). Opponents' cards can be looked at only.
local function isEngineCard(o) return o ~= nil and tostring(o.getGMNotes()):find("^engine:") ~= nil end
local function engineIdOf(o) return (tostring(o.getGMNotes()):gsub("^engine:", "")) end

local toldAt = {}
-- always: said even when the same words were said in the last 3 s (a confirmation: "Now click the attacker to block."
-- for a second blocker within 3 s said nothing, so the block looked ignored, combat clarity 2026-11-09)
local function tell(color, text, always)
  local key = color .. text
  if not always and toldAt[key] and os.clock() - toldAt[key] < 3 then return end
  toldAt[key] = os.clock()
  engineTableLog(color, "told: " .. text)
  if Player[color] ~= nil and Player[color].seated then broadcastToColor("[MTG] " .. text, color, {1, 0.65, 0.2}) end
end
engineTell = tell -- (for code above this point)

local function insideZone(zoneObj, pos)
  if zoneObj == nil then return false end
  local l = zoneObj.positionToLocal(pos)
  return math.abs(l.x) <= 0.5 and math.abs(l.z) <= 0.5
end

-- Which of the player's own areas a position is in.
local function dropArea(color, pos)
  local d = data[color]
  if d == nil then return "elsewhere" end
  if insideZone(d.graveyard, pos) then return "graveyard" end
  if insideZone(d.libraryZone, pos) then return "library" end
  if insideZone(d.playmat, pos) then return "battlefield" end
  local exile = engineExileSpot(d)
  if (pos.x - exile.x) ^ 2 + (pos.z - exile.z) ^ 2 < 2.5 then return "exile" end
  for _, guid in ipairs(TAX_LABELS[color] or {}) do
    local a = getObjectFromGUID(guid)
    if a ~= nil then
      local p = a.getPosition()
      if (pos.x - p.x) ^ 2 + (pos.z - p.z) ^ 2 < 2.25 then return "command" end
    end
  end
  return "elsewhere"
end

-- Whose card an object is: an engine card's player, an engine pile's ("library:Blue"), or for any other card or deck the
-- player whose mat, piles or command zone it lies in. nil: nobody's (the middle of the table, a token bag).
function engineSeatOf(o)
  if o == nil then return nil end
  if isEngineCard(o) then
    local id = engineIdOf(o)
    return (engineMeta[id] or {}).color or id:match("^%a+:(%a+)$")
  end
  for c in pairs(data or {}) do
    if Player[c] ~= nil and dropArea(c, o.getPosition()) ~= "elsewhere" then return c end
  end
  return nil
end

-- Who may touch which card (docs/next-features-2026-11-09.md item 1). The rule follows the game, not engine mode:
-- - no engine game on the table (engine mode off, or on before the first Start, or after New game cleared the last
--   one): anyone moves any card, as on the table without the engine (setting up seats, a deck for an empty AI seat);
-- - a game being played: your own cards, as the engine allows (below);
-- - a game over, its board still lying there until New game: nobody touches another player's cards, engine cards or
--   not, not even a click; your own only to pick up and flip as in the game.
function onPlayerAction(player, action, targets)
  if not ENGINE_MODE or lastTable == nil then return true end
  if lastTable.gameOver then
    for _, o in ipairs(targets or {}) do
      local seat = engineSeatOf(o)
      if seat ~= nil and seat ~= player.color then
        tell(player.color, "The game is over: those are " .. engineNameOf(seat) .. "'s cards.")
        return false
      end
    end
  end
  if action == Player.Action.Select then return true end
  for _, o in ipairs(targets or {}) do
    if isEngineCard(o) then
      local meta = engineMeta[engineIdOf(o)] or {}
      local mine = meta.color == player.color
      local movable = mine and (meta.zone == "hand" or meta.zone == "battlefield" or meta.zone == "command" or meta.zone == "playable")
      -- (in your hand too: a double-faced card's back is its other face, so you can read both sides)
      if action == Player.Action.FlipOver and mine and (meta.zone == "battlefield" or meta.zone == "command" or meta.zone == "hand") then
        -- flipping is only for looking (e.g. the back of a double-faced card); the engine's card is unchanged
        local id = engineIdOf(o)
        engineFlipped[id] = not engineFlipped[id] or nil
        return true
      end
      if action ~= Player.Action.PickUp or not movable then
        tell(player.color, mine and "The engine handles that (rotate, copy and delete are off; you can flip cards on your battlefield to look at them)."
          or "You can only touch your own cards.")
        return false
      end
    end
  end
  return true
end

local function snapBack()
  if lastTable ~= nil then engineRender(lastTable) end
end

local function request(color, kind, id, obj, side)
  engineHeld[id] = os.clock()
  engineActedAt[color] = os.clock()
  engineSend("intent", { color = color, kind = kind, id = id, side = side })
end
-- The side of a two-faced card its object shows (docs/card-other-side-spec.md): 1 the engine's face, 2 its other face,
-- in state 2 or turned over (a card on its own shows its other face on its back, but in a hand); nil for a card with one
-- face (no states). The bridge plays that side's way.
function engineShownSide(obj, id)
  if obj == nil or obj.isDestroyed() or obj.getStateId() == -1 then return nil end
  local side = obj.getStateId() == 2 and 2 or 1
  if engineFlipped[id] then side = 3 - side end
  return side
end

function onObjectDrop(color, obj)
  if not (ENGINE_MODE and lastTable ~= nil and isEngineCard(obj)) then return end
  local id = engineIdOf(obj)
  local meta = engineMeta[id]
  if meta == nil or meta.color ~= color then return Wait.frames(snapBack, 2) end
  Wait.frames(function()
    if obj == nil or obj.isDestroyed() then return end
    if meta.zone == "hand" and isInHand(obj, color, meta.hand2 and 2 or 1) then return end -- just rearranged inside the hand (or a controlled player's, its second one)
    if meta.zone == "playable" and isInHand(obj, color, 2) then return end -- (a private playable card, moved in its zone)
    local area = dropArea(color, obj.getPosition())
    -- (the playable row lies on the mat: a card picked up and put down near its spot goes back, it isn't played)
    local home = enginePlanned[id]
    if meta.zone == "playable" and home ~= nil then
      local p = obj.getPosition()
      if (p.x - home.x) ^ 2 + (p.z - home.z) ^ 2 < 1.8 ^ 2 then return snapBack() end
    end
    if (meta.zone == "hand" or meta.zone == "command" or meta.zone == "playable") and area == "battlefield" then
      local real = id:match("^cast:%a+:(.+)$") or id -- (a stand-in for another player's hand card: engineCastId)
      engineManual[real] = onTable(obj.getPosition())
      engineManualPlay[real] = true -- (held there while it is cast; a land then goes to the mana box, layoutRow)
      request(color, "play", real, obj, engineShownSide(obj, id))
    elseif meta.zone == "hand" and area == "graveyard" then
      request(color, "discard", id, obj)
    elseif meta.zone == "hand" and area == "library" then
      request(color, "bottom", id, obj)
    elseif meta.zone == "battlefield" and area == "graveyard" then
      request(color, "sacrifice", id, obj) -- accepted only when the engine is asking you to sacrifice it
    elseif meta.zone == "battlefield" and area == "battlefield" and engineEquipTarget(color, id, obj) ~= nil then
      -- equipment dropped onto one of your creatures: equip it there (Arena's gesture, playtest 2026-10-26)
      local to = engineEquipTarget(color, id, obj)
      engineTableLog(color, "attach " .. tostring((engineStatic[id] or {}).n) .. " to " .. tostring((engineStatic[to] or {}).n))
      engineSend("intent", { color = color, kind = "attach", id = id, to = to })
      snapBack()
    elseif meta.zone == "battlefield" and area == "battlefield" then
      engineManual[id] = onTable(obj.getPosition()) -- rearranging your own permanents
      obj.setLock(false)
    elseif meta.zone == "command" and area == "command" then
      return
    else
      if area ~= "elsewhere" and area ~= meta.zone then tell(color, "The engine moves cards there itself (it isn't a legal move right now).") end
      snapBack()
    end
  end, 2)
end

-- Your creature an equipment card was dropped onto (nil when it isn't equipment, or nothing of yours is under it)
function engineEquipTarget(color, id, obj)
  local st = engineStatic[id] or {}
  if not tostring(st.tl or ""):find("Equipment") then return nil end
  local p, best, bestD = obj.getPosition(), nil, 1.6
  for other, meta in pairs(engineMeta) do
    local o, ost = engineObjs[other], engineStatic[other] or {}
    if other ~= id and meta.color == color and meta.zone == "battlefield" and o ~= nil and not o.isDestroyed() then
      local isCreature = false
      for _, t in ipairs(ost.ty or {}) do if t == "Creature" then isCreature = true end end
      local q = o.getPosition()
      local d = math.sqrt((p.x - q.x) ^ 2 + (p.z - q.z) ^ 2)
      if isCreature and d < bestD then best, bestD = other, d end
    end
  end
  return best
end
function engineRefused(m)
  if m.id ~= nil then
    engineHeld[m.id] = nil
    local meta = engineMeta[m.id]
    if meta and meta.zone ~= "battlefield" then engineManual[m.id] = nil engineManualPlay[m.id] = nil end
  end
  snapBack()
end

-- ───────── table log (2026-10-24) ─────────
-- What the table does that the engine never hears about (held draws and their release, what a player is told, cards
-- slid back), sent to the bridge every 2 s; it writes tmp/table-log.log beside what the table sent the engine.
engineTLog = {}
function engineTableLog(color, text)
  engineTLog[#engineTLog + 1] = os.date("%H:%M:%S", os.time()) .. " " .. tostring(color or "-") .. " " .. tostring(text)
  if #engineTLog > 200 then table.remove(engineTLog, 1) end
end
Wait.time(function()
  if #engineTLog > 0 and engineSend ~= nil and ENGINE_MODE then
    local lines = table.concat(engineTLog, "\n")
    engineTLog = {}
    engineSend("tlog", { lines = lines })
  end
end, 2, -1)

-- Flick containment (2026-10-23): a card you may move (your battlefield and command zone, or a card a question asks
-- someone to click) can be flicked or thrown, and TTS reports neither as a drop: Blue knocked cards across the table
-- and into the other player's hand. Five times a second, each such card that nobody holds, that isn't on its way
-- anywhere (a smooth move: control changing, an attack swing) and that is away from where the board update put it
-- (enginePlanned):
--   * your own permanent resting anywhere on your own playmat stays there, as if you had dropped it (engineManual);
--   * anything else (off the mat, on a pile, on another mat, a commander off its spot) is stopped and slides back.
-- Not while a manual fix is under way (cards go anywhere then), nor for a card waiting on the engine after a drag
-- (engineHeld: a commander dragged out to be cast lies on the battlefield until the engine answers).
engineContain = { back = 0 } -- back: cards slid back; err: the first error (printed once)
do
  local CONTAIN_ZONES = { battlefield = true, command = true, attached = true, linked = true }
  local function check(id, o, meta)
    if o.isDestroyed() or o.held_by_color ~= nil or o.isSmoothMoving() then return end
    local p, home = o.getPosition(), enginePlanned[id]
    if home == nil or (p.x - home.x) ^ 2 + (p.z - home.z) ^ 2 < 4 then return end
    local d = data[meta.color]
    if meta.zone == "battlefield" and isFree(meta) and d ~= nil and insideZone(d.playmat, p) then
      local v = o.getVelocity()
      if v.x ^ 2 + v.y ^ 2 + v.z ^ 2 < 0.25 then
        engineManual[id] = onTable(p)
        enginePlanned[id] = engineManual[id]
      end
      return
    end
    o.setVelocity(Vector(0, 0, 0))
    o.setAngularVelocity(Vector(0, 0, 0))
    o.setPositionSmooth(home, false, true)
    local r = o.getRotation()
    o.setRotationSmooth(Vector(0, r.y, (r.z > 90 and r.z < 270) and 180 or 0), false, true)
    engineContain.back = engineContain.back + 1
    engineTableLog(meta.color, "card slid back onto its mat: " .. tostring(o.getName():match("^[^\n]*")))
  end
  function engineContainHome(id) return enginePlanned[id] end -- (for the tests)
  function engineContainTick()
    if not ENGINE_MODE or lastTable == nil or engineFix ~= nil then return end
    local now = os.clock()
    for id, o in pairs(engineObjs) do
      local meta = engineMeta[id]
      if meta ~= nil and CONTAIN_ZONES[meta.zone] and meta.color ~= nil and engineHeld[id] == nil
        and (isFree(meta) or engineClickable[id]) and (engineAnimUntil[id] or 0) <= now then
        local ok, e = pcall(check, id, o, meta)
        if not ok and not engineContain.err then engineContain.err = e print("[MTG] flick containment: " .. tostring(e)) end
      end
    end
  end
end
Wait.time(function() pcall(engineContainTick) end, 0.2, -1)

-- Two engine cards dropped onto each other form a TTS deck; break it up and redraw the real cards.
local tableEnterContainer = onObjectEnterContainer
function onObjectEnterContainer(container, obj)
  if obj ~= nil and engineEntering[obj.getGUID()] then
    engineEntering[obj.getGUID()] = nil -- the renderer added this card to a pile itself
    return
  end
  local cgm = container ~= nil and tostring(container.getGMNotes()) or ""
  if cgm:find("^engine:graveyard:") or cgm:find("^engine:exile:") then
    -- never break up a pile, but a card that doesn't belong in it (a permanent dropped onto the graveyard by
    -- accident) comes back out and is drawn where the engine has it; otherwise it vanished into the pile (P9).
    -- A card dropped there to discard goes in for real once the engine has moved it.
    if ENGINE_MODE and lastTable ~= nil and isEngineCard(obj) then
      local id = engineIdOf(obj)
      local zone, color = cgm:match("^engine:(%a+):(%a+)$")
      local belongs = false
      for _, pl in ipairs(lastTable.players or {}) do
        if pl.color == color then for _, c in ipairs(pl[zone] or {}) do if c.id == id then belongs = true end end end
      end
      if not belongs then
        if engineDebugDispose then print("[engine] " .. id .. " landed in " .. cgm .. " by mistake: taking it out") end
        local guid = obj.getGUID()
        Wait.frames(function()
          if container ~= nil and not container.isDestroyed() then
            for _, e in ipairs(container.getObjects() or {}) do
              if e.guid == guid then
                engineTakingOut[id] = true -- (the table's own take, not a player's: no "Look only", suite review 2026-10-27)
                container.takeObject({ guid = guid, smooth = false, callback_function = function(o) engineDispose(o) end })
              end
            end
          end
          local cur = engineObjs[id]
          if cur == nil or cur.isDestroyed() then engineObjs[id] = nil end -- merged away: draw it again
          Wait.frames(snapBack, 2)
        end, 1)
      end
    end
    return
  end
  if ENGINE_MODE and lastTable ~= nil and isEngineCard(obj) then
    Wait.frames(function()
      if container ~= nil and not container.isDestroyed() then
        local onlyEngine = container.type == "Deck"
        for _, e in ipairs(container.getObjects() or {}) do
          if not tostring(e.gm_notes or ""):find("^engine:") then onlyEngine = false end
        end
        if onlyEngine then engineDispose(container) -- a deck made of engine cards only: the engine redraws them
        else container.takeObject({ guid = obj.getGUID(), smooth = false, callback_function = function(o) engineDispose(o) end }) end
      end
      Wait.frames(snapBack, 2)
    end, 1)
    return
  end
  if tableEnterContainer ~= nil then return tableEnterContainer(container, obj) end
end

-- ───────── phase 2: tap to pay, tap to attack, click to block / target, right-click actions (SPEC §10a) ─────────
-- Gestures answer the open prompt the same way the panel buttons do (pick → engineAnswer), so the panel and the
-- table always agree. Glows show what you can use: mana sources, attackers, blockers, targets.
-- white: can attack/block; red: attacking or a picked target; blue: blocking; orange: can be targeted; gold: can pay
-- (M5, after MTG Arena's colour code: green = you can act on it, like the hand's playable glow; orange-gold = chosen;
-- red = attacking, blue = blocking, as the base glows; gold = the lands that will pay)
local CAN, CHOSEN = {0.3, 1, 0.4}, {1, 0.7, 0.15}
local GLOW = { mana = {1, 0.85, 0.2}, attack = CAN, attackPick = {1, 0.12, 0.08}, block = CAN, blockPick = {0.15, 0.45, 1},
  target = CAN, targetPick = CHOSEN, picked = CHOSEN }
engineGlowing = {}
local glowing = engineGlowing -- colour -> { object = true }
local menued = {}          -- colour -> { object = true } (context menus we added)
local pendingBlocker = {}  -- colour -> blocker card id waiting for its attacker
local unblock              -- defined below; declared here so the "Don't block with this" menu (above it) can call it
local pendingAttacker = {} -- colour -> attacker id whose target the next click chooses

-- How the table answers a question: "mana" (tap lands), "attack", "block", "action" (your priority), "target"
-- (click a card or life counter), "cards" (click cards on the table), or nil (the panel / card row).
local SURFACE = { mana = "mana", attack = "attack", block = "block", priority = "action", target = "target" }
local function promptKind(p)
  if p == nil then return nil end
  local surface = SURFACE[describePrompt(p).kind]
  if surface ~= nil then return surface end
  local cards = 0
  for _, o in ipairs(p.options or {}) do
    local id = tostring(o.id)
    if id:sub(1, 5) == "card|" or id:sub(1, 7) == "player|" then return "target" end
    if engineObjs[id] ~= nil then cards = cards + 1 end
  end
  -- choose cards (put on the bottom, discard, Brainstorm, Ponder's order...): click the cards themselves
  if cards > 0 then return "cards" end
  return nil
end

enginePromptKind = promptKind -- for the instruction line (engineUpdateCorner is defined earlier)
local function startsWith(s, prefix) return tostring(s):sub(1, #prefix) == prefix end

local function unglow(color)
  local was = glowing[color] or {}
  glowing[color] = {}
  for o in pairs(was) do
    if o ~= nil and not o.isDestroyed() and not engineGlowOwned(o) then
      local base = engineBaseGlow[o]
      if base then o.highlightOn(base) else o.highlightOff() end
    end
  end
end

local function glowObj(color, o, rgb)
  if o == nil or o.isDestroyed() then return end
  o.highlightOn(rgb)
  glowing[color] = glowing[color] or {}
  glowing[color][o] = true
end
local function glowCard(color, id, rgb) glowObj(color, engineObjs[id], rgb) end

local function clearMenus(color)
  for o in pairs(menued[color] or {}) do if o ~= nil and not o.isDestroyed() then o.clearContextMenu() end end
  menued[color] = {}
end

-- Option index for a predicate over the open prompt's options.
local function findOption(color, test)
  local p = enginePrompts[color]
  for i, o in ipairs((p and p.options) or {}) do if test(o) then return i, o end end
end

local function isSelected(color, i)
  local p = enginePrompts[color]
  return p ~= nil and p.mode == "multi" and engineSelectedFor(color, i)
end

-- Glows and right-click menus for the prompt that just opened.
-- A player's question, its whole life: opened (a new question from the engine), closed (answered, withdrawn, or
-- the game ended). Everything that belongs to one question is dropped here and nowhere else: the selection and
-- search text, the table's glows and right-click menus, a half-made two-click gesture (attacker waiting for its
-- target, blocker waiting for its attacker) and the pile cards it allowed. enginePhase2Prompt only redraws.
-- (Preferences such as the hidden panel, the stops, auto-pace and the green glow are not part of a question.)
function engineEnterPrompt(color, m)
  pendingBlocker[color] = nil
  -- the same attack question sent again (a refused answer) keeps the attacker that waits for its target
  if describePrompt(m).kind ~= "attack" then pendingAttacker[color] = nil end
  -- (a combat question asked again, a refused answer: its held picks are no longer the answer)
  local kind = describePrompt(m).kind
  if kind == "attack" or kind == "block" then engineCombatHeld[color] = nil end
end
function engineExitPrompt(color)
  local split = false
  for key, by in pairs(engineSplit) do if by == color then engineSplit[key] = nil split = true end end
  if split then Wait.frames(snapBack, 2) end -- the stacks split for this question go back together
  -- (stacks cut by picks of a question withdrawn unanswered go back together; an answer's picks are held)
  if not split and engineRestackSoon ~= nil then Wait.frames(function() if engineCombatStale() then engineRestackSoon() end end, 1) end
  -- (and the lines of its blocks: an answer's are held, a withdrawn question's go)
  if (engineBlockLinesFor or {})[color] then
    engineBlockLinesFor[color] = nil
    Wait.frames(function() if lastTable ~= nil and engineDrawLines ~= nil then pcall(engineDrawLines, lastTable, engineLinesSpot) end end, 1)
  end
  engineSelected[color] = nil
  engineFilter[color] = nil
  pendingBlocker[color] = nil
  pendingAttacker[color] = nil
  if engineChoosable ~= nil then engineChoosable[color] = nil end
  unglow(color)
  clearMenus(color)
  if engineAbilityBoxes ~= nil then pcall(engineAbilityBoxes, color, nil, nil) end
end

-- Redraws the table's side of the open question (glows, right-click menus) from its current state.
-- The glow of a card a question offers (a card to choose, a card to target), picked or not: one rule for the whole
-- question (enginePhase2Prompt) and for a card that arrives after it (engineGlowLate). (Structural review 2026-10-27:
-- the late path was a copy that had already drifted by a check.)
function engineGlowOption(color, kind, i, id)
  if kind == "cards" then glowCard(color, id, isSelected(color, i) and GLOW.targetPick or GLOW.attack)
  elseif kind == "target" and startsWith(id, "card|") then glowCard(color, id:sub(6), isSelected(color, i) and GLOW.targetPick or GLOW.target) end
end
-- A card whose object arrives after the question that names it (a token made a moment before the legend rule asked
-- which one stays: only the other one glowed, playtest 2026-10-27): that question is drawn again on the next frame,
-- glows and menus of every kind, at most once a frame however many cards arrive in it (altitude review 2026-10-27).
engineRedrawSoon = {} -- colour -> true while a redraw is waiting for the next frame
function engineGlowLate(id)
  for color, p in pairs(enginePrompts or {}) do
    -- (a token folded into a stack is drawn as the stack's card: that card arriving counts too, batch 1 review 2026-11-12)
    local named = tostring(p.attacker) == id or (p.attacker ~= nil and engineGroupOf ~= nil and engineGroupOf[tostring(p.attacker)] == id)
    for _, o in ipairs(p.options or {}) do
      local oid = tostring(o.id)
      if oid == id or o.cardId == id or oid:sub(-#id - 1) == "|" .. id or oid:sub(1, #id + 1) == id .. "|" then named = true break end
    end
    if named and not engineRedrawSoon[color] then
      engineRedrawSoon[color] = true
      -- (the question open then, the same or one that replaced it: stage 3 review 2026-10-27)
      Wait.frames(function() engineRedrawSoon[color] = nil if enginePrompts[color] ~= nil then enginePhase2Prompt(color) end end, 1)
    end
  end
end
function enginePhase2Prompt(color)
  unglow(color)
  clearMenus(color)
  local p = enginePrompts[color]
  local kind = promptKind(p)
  -- the creature a defender is chosen for (Hero of Bladehold's token, put onto the battlefield attacking): red, as an
  -- attacker picked on the attack question, whether the question is answered on the table or in the panel
  -- (a token folded into a stack has no object of its own: the stack's card lights, batch 1 review 2026-11-12)
  if p ~= nil and p.attacker ~= nil then
    glowCard(color, (engineGroupOf ~= nil and engineGroupOf[tostring(p.attacker)]) or tostring(p.attacker), GLOW.attackPick)
  end
  -- (no kind the table draws: the last question's ability buttons go, a click on one answered this question with an
  -- option of the same id, stage 3 review 2026-10-27)
  if kind == nil then if engineAbilityBoxes ~= nil then pcall(engineAbilityBoxes, color, nil, nil) end return end
  -- (a card's right-click list: a two-faced card's ways for the side it shows first, engineSideFirst; i is only read by
  -- the other kinds, in the question's own order)
  for i, o in ipairs(kind == "action" and engineSideFirst(p.options or {}) or (p.options or {})) do
    local id = tostring(o.id)
    if kind == "mana" and o.cardId ~= nil and startsWith(id, "tap:") then glowCard(color, o.cardId, GLOW.mana)
    elseif kind == "mana" and o.cardId ~= nil and startsWith(id, "untap:") then glowCard(color, o.cardId, GLOW.picked)
    elseif kind == "attack" and id:find("|", 1, true) then -- ("All attack"/"No attacks" buttons have no creature)
      local att = id:match("^(.-)|")
      -- one creature has an option per target: red once any of them is picked
      local picked = false
      for k, x in ipairs(p.options) do if startsWith(x.id, att .. "|") and isSelected(color, k) then picked = true end end
      glowCard(color, att, picked and GLOW.attackPick or GLOW.attack)
    elseif kind == "block" and id:find("|", 1, true) then
      local blocker, attacker = id:match("^(.-)|(.+)$")
      local picked = false
      for k, x in ipairs(p.options) do if startsWith(x.id, blocker .. "|") and isSelected(color, k) then picked = true end end
      glowCard(color, blocker, picked and GLOW.blockPick or GLOW.block)
      local obj = engineObjs[blocker]
      if obj ~= nil and not obj.isDestroyed() and not (menued[color] or {})[obj] then
        -- (said always, by name: "Block removed." for a second blocker within 3 s said nothing, as the clicks did)
        obj.addContextMenuItem("Don't block with this", function(playerColor)
          if playerColor == color and unblock(color, blocker) then tell(color, engineBlockerName(color, blocker) .. " won't block. Done when finished.", true) end
        end)
        menued[color] = menued[color] or {}
        menued[color][obj] = true
      end
    elseif kind == "cards" or (kind == "target" and startsWith(id, "card|")) then engineGlowOption(color, kind, i, id)
    elseif kind == "target" and startsWith(id, "player|") then
      -- a player you can target: their life counter glows (click it); red once picked
      for _, pl in ipairs((lastTable and lastTable.players) or {}) do
        if pl.slot == id:sub(8) and LIFE_TRACKERS[pl.color] then glowObj(color, getObjectFromGUID(LIFE_TRACKERS[pl.color]), isSelected(color, i) and GLOW.targetPick or GLOW.target) end
      end
    elseif kind == "action" and o.cardId ~= nil then
      -- right-click menu on the card: cast it / activate its ability
      local obj = engineObjs[o.cardId]
      if obj ~= nil and not obj.isDestroyed() then
        -- (the menu is the card's own: its name in front only cut the ability off, "Kenrith, the Returned King:
        -- {3}{U}: Ta…", playtest 2026-10-27)
        local label = engineAbilityText(o)
        if #label > 40 then label = engineCut(label, 38) .. "…" end
        local optionId = o.id
        obj.addContextMenuItem(label, function(playerColor)
          if playerColor ~= color then return end
          local idx = findOption(color, function(x) return x.id == optionId end)
          if idx ~= nil then enginePick(color, idx) end
        end)
        menued[color] = menued[color] or {}
        menued[color][obj] = true
      end
    end
  end
  if kind == "attack" or kind == "block" then
    -- token stacks: the menus of an attack question's stacks; the stacks drawn again when the picks cut them otherwise;
    -- a blocker waiting for its attacker glows in its stack; the blocks picked so far are drawn as lines
    if kind == "attack" then engineStackMenus(color, p) end
    if engineCombatStale() then engineRestackSoon() end
    local waiting = pendingBlocker[color]
    if kind == "block" and waiting ~= nil then glowCard(color, engineGroupOf[waiting] or waiting, GLOW.blockPick) end
    if kind == "block" and lastTable ~= nil and engineDrawLines ~= nil then
      engineBlockLinesFor = engineBlockLinesFor or {}
      engineBlockLinesFor[color] = true
      pcall(engineDrawLines, lastTable, engineLinesSpot)
    end
  end
  if engineAbilityBoxes ~= nil then pcall(engineAbilityBoxes, color, p, kind) end
end

-- Removes every block chosen for this blocker. Returns true if there was one.
function unblock(color, blockerId) -- the local declared with pendingBlocker
  local p = enginePrompts[color]
  local any = false
  for i, o in ipairs((p and p.options) or {}) do
    if startsWith(o.id, blockerId .. "|") and engineSelectedFor(color, i) then
      enginePick(color, i) -- picking a selected option again deselects it
      any = true
    end
  end
  if any then enginePhase2Prompt(color) end
  return any
end
-- A blocker's name as the blockers question says it ("Spirit Token 1/1 #3", so two tokens read apart), else its card's
-- name, else "It": the words of every block confirmation (the click and the right-click menu)
function engineBlockerName(color, b)
  local _, o = findOption(color, function(x) return startsWith(x.id, b .. "|") end)
  local l = o and tostring(o.label or "")
  local at = l and l:find(" blocks ", 1, true)
  local x = engineObjs[b]
  return (at and l:sub(1, at - 1)) or (x ~= nil and not x.isDestroyed() and x.getName():match("^[^\n]*")) or "It"
end
-- What an attack's target reads as in the chat that confirms it: a player by name ("AI 1"), a planeswalker by its name
-- and its controller's ("Jace Beleren (AI 1)"), from the board last drawn
function engineAttackTargetName(target)
  local players = (lastTable and lastTable.players) or {}
  for _, pl in ipairs(players) do
    if pl.slot == target then return tostring(pl.name or pl.color) end
  end
  for _, pl in ipairs(players) do
    for _, c in ipairs(pl.battlefield or {}) do
      if c.id == target then
        local ctl = c.ctl or pl.color
        local owner = ctl
        for _, q in ipairs(players) do if q.color == ctl then owner = q.name or q.color end end
        return tostring((engineStatic[target] or {}).n or c.n or "That planeswalker") .. " (" .. tostring(owner) .. ")"
      end
    end
  end
  return tostring((engineStatic[target] or {}).n or "it")
end

-- ───────── token stacks the Arena way (docs/token-stacks-spec.md) ─────────
-- The combat part of each token's stack (see groupTokens), by engine card id: "a>" what it attacks, "b>" the attacker it
-- blocks, "B<" itself when it is blocked (each blocked attacker is drawn on its own, so a block's line ends on it). From
-- the board's combat, the open combat questions' picks, and an answered one's picks until the next board.
function engineCombatSubs()
  local attack, blocker, blocked = {}, {}, {}
  local function fromPicks(kind, ids)
    for _, oid in ipairs(ids or {}) do
      local x, y = tostring(oid):match("^(.-)|(.+)$")
      if x ~= nil and kind == "attack" then attack[x] = attack[x] or y
      elseif x ~= nil and kind == "block" then blocker[x] = blocker[x] or y blocked[y] = true end
    end
  end
  for _, pl in ipairs((lastTable and lastTable.players) or {}) do
    for _, c in ipairs(pl.battlefield or {}) do
      if c.atk then attack[c.id] = tostring(c.atkT) end
      if c.blkOf ~= nil and #c.blkOf > 0 then
        local of = {}
        for _, a in ipairs(c.blkOf) do of[#of + 1] = tostring(a) blocked[tostring(a)] = true end
        table.sort(of)
        blocker[c.id] = table.concat(of, ",")
      end
    end
  end
  for color, p in pairs(enginePrompts or {}) do
    local kind = promptKind(p)
    if kind == "attack" or kind == "block" then
      local ids = {}
      for i, o in ipairs(p.options or {}) do if engineSelectedFor(color, i) then ids[#ids + 1] = o.id end end
      fromPicks(kind, ids)
    end
  end
  for _, h in pairs(engineCombatHeld) do fromPicks(h.kind, h.ids) end
  local out = {}
  local function part(id)
    out[id] = (attack[id] and ("a>" .. attack[id]) or "") .. "/" .. (blocker[id] and ("b>" .. blocker[id]) or "") .. "/" .. (blocked[id] and ("B<" .. id) or "")
  end
  for id in pairs(attack) do part(id) end
  for id in pairs(blocker) do part(id) end
  for id in pairs(blocked) do part(id) end
  return out
end
-- the blocks picked in the open blockers questions and held from answered ones: { { blocker id, attacker id }, ... }
function engineQuestionBlocks()
  local out = {}
  local function add(ids)
    for _, oid in ipairs(ids or {}) do
      local b, a = tostring(oid):match("^(.-)|(.+)$")
      if b ~= nil then out[#out + 1] = { b, a } end
    end
  end
  for color, p in pairs(enginePrompts or {}) do
    if promptKind(p) == "block" then
      local ids = {}
      for i, o in ipairs(p.options or {}) do if engineSelectedFor(color, i) then ids[#ids + 1] = o.id end end
      add(ids)
    end
  end
  for _, h in pairs(engineCombatHeld) do if h.kind == "block" then add(h.ids) end end
  return out
end
-- true when a stack on the table was drawn for picks that have changed since
function engineCombatStale()
  local subs = engineCombatSubs()
  for id, drawn in pairs(engineSubDrawn) do if (subs[id] or "") ~= drawn then return true end end
  return false
end
-- the stacks are drawn again on the next frame (at most once a frame), and the combat questions' menus and glows with them
function engineRestackSoon()
  if engineRestacking then return end
  engineRestacking = true
  Wait.frames(function()
    engineRestacking = nil
    if not engineCombatStale() then return end
    snapBack()
    for color, p in pairs(enginePrompts) do
      local kind = promptKind(p)
      if kind == "attack" or kind == "block" then enginePhase2Prompt(color) end
    end
  end, 1)
end
-- an answered attack or block question: its picks stay drawn until the engine's next board (no stack merging back for
-- the moment before the attackers are on it)
function engineHoldCombat(color, p, choice)
  local kind = promptKind(p)
  if kind == "attack" or kind == "block" then engineCombatHeld[color] = { kind = kind, ids = choice } end
end

-- A stack in an attack question: "all" (a click on it: all of it attacks, or a second click: none), "one" (its next
-- token attacks; the attacking ones are drawn as their own stack), "back" (an attacking stack's last token doesn't),
-- "none", "split" (laid out to pick one by one: the Split box's)
function engineStackAttack(color, id, how)
  local p = enginePrompts[color]
  if p == nil or promptKind(p) ~= "attack" then return end
  if how == "split" then return engineUseAbility(color, "__split:" .. id) end
  local members = {}
  for _, m in ipairs(engineGroupMembers(id)) do
    if findOption(color, function(o) return startsWith(o.id, m .. "|") end) ~= nil then members[#members + 1] = m end
  end
  local picks = function(m)
    local out = {}
    for k, o in ipairs(p.options or {}) do if startsWith(o.id, m .. "|") and engineSelectedFor(color, k) then out[#out + 1] = k end end
    return out
  end
  local unpick = function(m) for _, k in ipairs(picks(m)) do enginePick(color, k) end end
  local attacking = function()
    local n = 0
    for k, o in ipairs(p.options or {}) do if tostring(o.id):find("|", 1, true) and engineSelectedFor(color, k) then n = n + 1 end end
    return n
  end
  -- (a token's words as the question says them, "Soldier Token 1/1 #2", before its " → AI 1")
  local nameOf = function(m)
    local _, o = findOption(color, function(x) return startsWith(x.id, m .. "|") end)
    local l = tostring((o or {}).label or "")
    local cut = l:find(" → ", 1, true) or l:find(" attacks ", 1, true)
    return (cut and cut > 1) and l:sub(1, cut - 1) or tostring((engineStatic[m] or {}).n or "A creature")
  end
  if how == "one" then
    -- (the stack's own card goes last, so the stack keeps its object while it has tokens left)
    local order = {}
    for k = 2, #members do order[#order + 1] = members[k] end
    order[#order + 1] = members[1]
    for _, m in ipairs(order) do
      if #picks(m) == 0 then
        local i, o = findOption(color, function(x) return startsWith(x.id, m .. "|") end)
        enginePick(color, i)
        enginePhase2Prompt(color)
        pendingAttacker[color] = m
        tell(color, nameOf(m) .. " attacks " .. engineAttackTargetName(tostring(o.id):match("|(.+)$")) .. " (" .. attacking() .. " attacking in all). "
          .. "Right-click the stack for another; click a life counter or a planeswalker to change what it attacks.")
        return
      end
    end
    return tell(color, "Every token in that stack is attacking already.")
  end
  if how == "back" then
    local last = members[#members]
    if last == nil then return end
    unpick(last)
    if pendingAttacker[color] == last then pendingAttacker[color] = nil end
    enginePhase2Prompt(color)
    return tell(color, nameOf(last) .. " won't attack (" .. attacking() .. " attacking in all).")
  end
  if how == "none" or (pendingAttacker[color] == id and #picks(id) > 0) then
    for _, m in ipairs(members) do unpick(m) end
    pendingAttacker[color] = nil
    enginePhase2Prompt(color)
    return tell(color, "Not attacking.")
  end
  for _, m in ipairs(members) do
    if #picks(m) == 0 then enginePick(color, (findOption(color, function(o) return startsWith(o.id, m .. "|") end))) end
  end
  enginePhase2Prompt(color)
  pendingAttacker[color] = id
  tell(color, (#members > 1 and ("All " .. #members .. " attacking (right-click the stack to send fewer). ") or "Attacking. ")
    .. "Click a life counter or a planeswalker to choose what " .. (#members > 1 and "they attack" or "it attacks") .. "; click it again to cancel.")
end
-- the right-click menu of each stack in an attack question (cleared with the question's other menus)
function engineStackMenus(color, p)
  local done = {}
  for _, o in ipairs(p.options or {}) do
    local rep = tostring(o.id):match("^(.-)|")
    local obj = rep and engineObjs[rep]
    local list = rep and engineGroupList[rep]
    if list ~= nil and #list > 1 and not done[rep] and obj ~= nil and not obj.isDestroyed() and not (menued[color] or {})[obj] then
      done[rep] = true
      local picked = false
      for k, x in ipairs(p.options) do if startsWith(x.id, rep .. "|") and engineSelectedFor(color, k) then picked = true end end
      local item = function(label, how) obj.addContextMenuItem(label, function(playerColor) if playerColor == color then engineStackAttack(color, rep, how) end end) end
      if picked then
        item("Don't attack with these " .. #list, "none")
        item("Take one back", "back")
      else
        item("Attack with all " .. #list, "all")
        item("Attack with one", "one")
        item("Pick one by one", "split")
      end
      menued[color] = menued[color] or {}
      menued[color][obj] = true
    end
  end
end

-- Q/E on one of your cards: pay with it, or attack with it.
local function tapGesture(color, id)
  local p = enginePrompts[color]
  local kind = promptKind(p)
  local function turnNow()
    local o = engineObjs[id]
    if o ~= nil and not o.isDestroyed() then
      local r = o.getRotation()
      o.setRotationSmooth(Vector(r.x, r.y + 90, r.z), false, true)
    end
  end
  if kind == "mana" then
    -- a land that makes several colours: the one the cost still needs (the bridge ranks each button: 2 a needed
    -- colour, 1 generic only, 0 no use), not simply its first button
    local i, best = nil, -1
    for k, o in ipairs((p and p.options) or {}) do
      if o.cardId == id and startsWith(o.id, "tap:") and (o.rank or 1) > best then i, best = k, (o.rank or 1) end
    end
    if i ~= nil and best == 0 then
      tell(color, "That makes the wrong colour for this cost.")
      return true
    end
    if i ~= nil then turnNow() end
    -- turning a source you already tapped for this cost back gives its mana back
    if i == nil then i = findOption(color, function(o) return o.cardId == id and startsWith(o.id, "untap:") end) end
    if i ~= nil then enginePick(color, i) return true end
    tell(color, "That can't pay for this.")
    return true
  elseif kind == "attack" then
    local i = findOption(color, function(o) return startsWith(o.id, id .. "|") end)
    if i ~= nil then
      enginePick(color, i)
      enginePhase2Prompt(color)
      pendingAttacker[color] = engineSelectedFor(color, i) and id or nil
      if pendingAttacker[color] then tell(color, "Attacking. Click a life counter or a planeswalker to change what it attacks.") end
      return true
    end
    -- (the bridge's reason when it has one: "Hill Giant can't attack: summoning sick.", attack reminder spec part 2)
    tell(color, (p and p.cantAttack and p.cantAttack[id]) or "That creature can't attack right now.")
    return true
  elseif kind == "action" then
    -- turning back a source whose mana you haven't spent: the mana goes back and it untaps
    local u = findOption(color, function(o) return o.cardId == id and startsWith(tostring(o.id), "untap:") end)
    if u ~= nil then enginePick(color, u) return true end
    -- tapping a land while you have priority makes its mana (it floats until you spend it)
    turnNow()
    engineSend("intent", { color = color, kind = "tapmana", id = id })
    return true
  end
  return false
end

-- Clicking a card or a life tracker: choose a target, or set up a block.
cardClickAt = {} -- object guid -> os.clock() of its last acted-on click
-- false when this object was already clicked in the last 0.4 s (one click arrives as both "select" and "pick up";
-- counting it twice undid the pick, an attack or a target)
local function firstClick(obj)
  local guid = obj.getGUID()
  if (cardClickAt[guid] or -1) > os.clock() - 0.4 then return false end
  cardClickAt[guid] = os.clock()
  return true
end
local clickGesture
-- a life counter's own button was clicked (its script hands the click over): the same as clicking the counter object
function engineLifeTrackerClick(params)
  local o = params and getObjectFromGUID(params.guid or "")
  if o == nil or params.color == nil then return end
  if not clickGesture(params.color, o) then
    tell(params.color, "Life totals follow the game. To attack or target this player, choose your creature or spell first.")
  end
end
-- What a click on a card or a target said, for a pick that waits for Done: chosen, or taken back by a second click
-- (one place for cards and targets: the cards' line said "Chosen" for the click that took it back, and a target said
-- nothing, so "up to 1 target to fight" went to Done empty, hp-12 re-test 2026-10-27). Said before the pick can answer.
function engineTellPick(color, p, i)
  if not isSelected(color, i) then tell(color, "Taken back.") return end
  tell(color, "Chosen. Click it again to undo; click Done" .. (describePrompt(p).toLibrary and " or your library" or "") .. " when you're finished.")
end
clickGesture = function(color, obj)
  local p = enginePrompts[color]
  local kind = promptKind(p)
  if kind == nil then return false end
  local id = isEngineCard(obj) and engineIdOf(obj) or nil
  if kind == "cards" then
    if id == "library:" .. color and describePrompt(p).toLibrary then
      -- the chosen cards go to your library: clicking it confirms (like dragging a card onto it)
      if engineConfirm ~= nil then engineConfirm(color) end
      return true
    end
    local i = id and findOption(color, function(o) return tostring(o.id) == id end)
    if i == nil then return false end
    if not firstClick(obj) then return true end
    enginePick(color, i)
    if p.mode == "multi" then
      -- (an exact number: the last click answers, as for targets; the corner has no Done for it, so a legend rule's pick
      -- did nothing, stage 3 review 2026-10-27)
      if not engineExactPick(p) then engineTellPick(color, p, i) end
      engineConfirmIfComplete(color)
      enginePhase2Prompt(color)
    end
    return true
  end
  if kind == "target" then
    local i
    if id ~= nil then i = findOption(color, function(o) return o.id == "card|" .. id end) end
    if i == nil then
      -- a life tracker stands for its player
      for _, pl in ipairs((lastTable and lastTable.players) or {}) do
        if LIFE_TRACKERS[pl.color] == obj.getGUID() and pl.slot ~= nil then
          i = findOption(color, function(o) return o.id == "player|" .. pl.slot end)
        end
      end
    end
    if i ~= nil then
      if not firstClick(obj) then return true end
      enginePick(color, i)
      -- (a single target answers at the click; an exact pick at its last one)
      if p.mode == "multi" and not engineExactPick(p) then engineTellPick(color, p, i) end
      engineConfirmIfComplete(color)
      enginePhase2Prompt(color)
      return true
    end
    -- a permanent that can't be chosen says so (a click that did nothing looked like the table ignoring you); a
    -- planeswalker by that name, and a question of players only says so (item 24, 2026-11-11: planeswalkers by click)
    if id ~= nil and (engineMeta[id] or {}).zone == "battlefield" and firstClick(obj) then
      local what = hasType(engineStatic[id] or {}, "Planeswalker") and "That planeswalker" or "That card"
      local sorts = engineTargetSorts(p)
      tell(color, what .. ((sorts.players and not sorts.cards and not sorts.spells) and " can't be chosen for this: it asks for a player. Click a glowing life counter."
        or " can't be chosen for this. Click a glowing card, or a player's life counter if a player can be."))
    end
    return false
  elseif kind == "attack" and id ~= nil and findOption(color, function(o) return startsWith(o.id, id .. "|") end) ~= nil then
    -- one of your creatures: click = attack (the first opponent, then click a life counter / planeswalker to change).
    -- A stack of tokens attacks as a whole ("full swing"); its right-click menu sends fewer (engineStackAttack).
    if not firstClick(obj) then return true end
    engineStackAttack(color, id, "all")
    return true
  elseif kind == "attack" and pendingAttacker[color] ~= nil then
    local target = id
    if target == nil then
      for _, pl in ipairs((lastTable and lastTable.players) or {}) do
        if LIFE_TRACKERS[pl.color] == obj.getGUID() then target = pl.slot end
      end
    end
    if target == nil then return false end
    local set = 0
    local who = {}
    for _, att in ipairs(engineGroupMembers(pendingAttacker[color])) do
      local j = findOption(color, function(o) return o.id == att .. "|" .. target end)
      if j ~= nil then
        -- (the attacker's words as the question says them, "Soldier Token 1/1 #2", before its " → target")
        local l = tostring(((p and p.options or {})[j] or {}).label or "")
        local cut = l:find(" → ", 1, true) or l:find(" attacks ", 1, true)
        who[#who + 1] = (cut and cut > 1) and l:sub(1, cut - 1) or tostring((engineStatic[att] or {}).n or "A creature")
        -- one target per attacker: drop its other pick, then pick this one
        for k, o in ipairs((p and p.options) or {}) do
          if k ~= j and startsWith(o.id, att .. "|") and engineSelectedFor(color, k) then enginePick(color, k) end
        end
        if not engineSelectedFor(color, j) then enginePick(color, j) end
        set = set + 1
      end
    end
    if set == 0 then return false end
    enginePhase2Prompt(color)
    -- what was set, not just that something was (live check 2026-11-11: "Target set." said nothing)
    -- (a stack of tokens is counted, not listed six times)
    local names = (#who > 3 and (#who .. " creatures")) or (#who > 1 and (table.concat(who, ", ", 1, #who - 1) .. " and " .. who[#who])) or who[1]
    tell(color, names .. (#who > 1 and " attack " or " attacks ") .. engineAttackTargetName(target) .. ".")
    return true
  elseif kind == "block" and id ~= nil then
    -- (one click arrives as select + pick up: the second one did the click again. After a block was set it fell
    -- through to "You can only touch your own cards", and the next click on the creature took the block back:
    -- blocking looked broken, playtest 2026-10-24)
    if not firstClick(obj) then return true end
    -- Every click says what it did, always (combat clarity 2026-11-09: "assigning a blocker sometimes gave no
    -- confirmation": the same words within 3 s were dropped, and an attacker clicked after a block was taken back
    -- did nothing). A blocker's name is the question's own (engineBlockerName), so two tokens read apart.
    -- A stack of tokens blocks one token at a time, without laying the army out (token stacks spec): a click on your
    -- stack takes its next token with no block, a click on an attacking stack blocks its next attacker nobody blocks yet,
    -- and a click on a stack whose tokens all block takes the last one's block back. A card alone is a stack of one.
    -- (the stack's own card is taken last, so the stack keeps its object while it has tokens left)
    local members = engineGroupMembers(id)
    local order = {}
    for k = 2, #members do order[#order + 1] = members[k] end
    order[#order + 1] = members[1]
    local waiting = pendingBlocker[color]
    local waitsHere = false
    for _, m in ipairs(members) do if m == waiting then waitsHere = true end end
    if waitsHere then
      -- the creature waiting for its attacker (its stack), clicked again: it doesn't block
      pendingBlocker[color] = nil
      enginePhase2Prompt(color)
      tell(color, engineBlockerName(color, waiting) .. " won't block. Done when finished.", true)
      return true
    end
    local canBlock = function(b) return findOption(color, function(o) return startsWith(o.id, b .. "|") end) ~= nil end
    local blocking = function(b)
      for k, o in ipairs((p and p.options) or {}) do if startsWith(o.id, b .. "|") and engineSelectedFor(color, k) then return true end end
      return false
    end
    local who = nil
    for _, m in ipairs(order) do if who == nil and canBlock(m) and not blocking(m) then who = m end end
    for k = #members, 1, -1 do if who == nil and canBlock(members[k]) then who = members[k] end end
    if who ~= nil then
      -- one of your blockers: its block, if it has one, is taken back, and the attacker clicked next is the one it blocks
      -- (unblock redraws the question when it takes one back)
      pendingBlocker[color] = who -- (before unblock's redraw, which glows the one waiting)
      local had = unblock(color, who)
      if not had then enginePhase2Prompt(color) end
      glowCard(color, id, GLOW.blockPick)
      local name = engineBlockerName(color, who)
      local free = 0
      for _, m in ipairs(members) do if canBlock(m) and not blocking(m) and m ~= who then free = free + 1 end end
      -- (said as it is: the block is gone now, and stays gone unless an attacker is clicked, verifier 2026-11-11)
      tell(color, had and (name .. "'s block is taken back: it won't block unless you click an attacker for it now.")
        or ("Now click the attacker for " .. name .. " to block (or click it again: no block)."
          .. (#members > 1 and (" " .. free .. " more in this stack have no block.") or "")), true)
      return true
    end
    if pendingBlocker[color] ~= nil then
      -- (an attacking stack: its next attacker nobody blocks yet, else the next this blocker can block)
      local b = pendingBlocker[color]
      local blocked = function(a)
        for k, x in ipairs((p and p.options) or {}) do if tostring(x.id):sub(-#a - 1) == "|" .. a and engineSelectedFor(color, k) then return true end end
        return false
      end
      local i, o = nil, nil
      for _, a in ipairs(order) do if i == nil and not blocked(a) then i, o = findOption(color, function(x) return x.id == b .. "|" .. a end) end end
      for _, a in ipairs(order) do if i == nil then i, o = findOption(color, function(x) return x.id == b .. "|" .. a end) end end
      if i ~= nil then
        -- (the question's words, else the cards' names: a label without "blocks" is no bridge's)
        local said = tostring(o.label or "")
        if not said:find(" blocks ", 1, true) then
          local name = function(x) return x ~= nil and not x.isDestroyed() and (x.getName():match("^[^\n]*")) or "It" end
          said = name(engineObjs[engineGroupOf[b] or b]) .. " blocks " .. name(obj)
        end
        if not engineSelectedFor(color, i) then enginePick(color, i) end
        pendingBlocker[color] = nil
        enginePhase2Prompt(color)
        tell(color, said .. ". Click the blocker again to change it; Done when finished.", true)
        return true
      end
      tell(color, engineBlockerName(color, pendingBlocker[color]) .. " can't block that. Click an attacking creature, or the blocker again: no block.", true)
      return true
    end
    -- an attacker clicked with no blocker waiting: said too (it did nothing silently)
    if findOption(color, function(o) local s = tostring(o.id) return s:sub(-#id - 1) == "|" .. id end) ~= nil then
      tell(color, "Click one of your creatures first, then this attacker.", true)
      return true
    end
  end
  return false
end

local phase1PlayerAction = onPlayerAction
function onPlayerAction(player, action, targets)
  if ENGINE_MODE and lastTable ~= nil and enginePrompts[player.color] ~= nil then
    local A = Player.Action
    for _, o in ipairs(targets or {}) do
      if (action == A.RotateIncrementalLeft or action == A.RotateIncrementalRight) and isEngineCard(o) then
        local meta = engineMeta[engineIdOf(o)] or {}
        if meta.color == player.color and tapGesture(player.color, engineIdOf(o)) then return false end
      elseif action == A.Select or action == A.PickUp then
        -- choosing cards: the click chooses, and picking it up still works (drag it onto your library)
        local cardsKind = promptKind(enginePrompts[player.color]) == "cards"
        if clickGesture(player.color, o) and not (cardsKind and action == A.PickUp) then return false end
      end
    end
  end
  return phase1PlayerAction(player, action, targets)
end

-- ───────── undo / copy / paste safety ─────────
-- Ctrl+Z, copy-paste and similar bring back engine cards the renderer didn't make. Remove those copies and redraw
-- from the engine's state, which never changes because of them.
local resyncQueued = false
local function resyncSoon()
  if resyncQueued then return end
  resyncQueued = true
  Wait.frames(function() resyncQueued = false snapBack() end, 5)
end

-- ───────── a card's other side (docs/card-other-side-spec.md) ─────────
-- A player turning a two-faced card to its other state (right-click, States) replaces its object: TTS destroys the old
-- one and makes the state's. The new one becomes the card's object (no copy to throw away, nothing to spawn again),
-- keeping the face recorded for it; its badges, lock, glow and right-click list are drawn again. Only for a card the
-- table knows whose object is gone (or is the one TTS names as the old state): a pasted copy beside it is not adopted.
-- True when obj is the card's object now.
function engineAdoptState(obj, oldGuid)
  if obj == nil or obj.isDestroyed() or not isEngineCard(obj) or obj.getStateId() == -1 then return false end
  local id = engineIdOf(obj)
  local old = engineObjs[id]
  if old == obj then return true end
  local meta = engineMeta[id]
  if meta == nil or (old ~= nil and not old.isDestroyed() and (oldGuid == nil or old.getGUID() ~= oldGuid)) then return false end
  local face = engineFace[id]
  engineCardEntry(id, obj, nil)
  engineFace[id] = face
  Wait.frames(function()
    if lastTable ~= nil then engineRender(lastTable) end
    if meta.color ~= nil and enginePlayableGlow ~= nil then enginePlayableGlow(meta.color) end
  end, 1)
  return true
end
do
  local before = onObjectStateChange
  function onObjectStateChange(obj, oldGuid)
    if ENGINE_MODE and lastTable ~= nil then engineAdoptState(obj, oldGuid) end
    if before ~= nil then return before(obj, oldGuid) end
  end
end
-- The options in the order a card's right-click list shows them: a two-faced card's ways for the side its object shows
-- first (option.side, from the bridge), the others after; the list itself when no option names a side.
function engineSideFirst(options)
  local any = false
  for _, o in ipairs(options) do if o.side ~= nil then any = true end end
  if not any then return options end
  local first, rest = {}, {}
  for _, o in ipairs(options) do
    local shown = o.side ~= nil and o.cardId ~= nil and engineShownSide(engineObjs[o.cardId], o.cardId) or nil
    if shown ~= nil and shown ~= o.side then rest[#rest + 1] = o else first[#first + 1] = o end
  end
  for _, o in ipairs(rest) do first[#first + 1] = o end
  return first
end

local tableObjectSpawn = onObjectSpawn
function onObjectSpawn(obj)
  -- (not the effect and sound bundles, which are the table's: their rigs were deleted a frame after they spawned, live
  -- check batch 2 2026-11-12)
  if ENGINE_MODE and lastTable ~= nil and isEngineCard(obj) and not engineIsBundleObject(obj.getGMNotes()) then
    local id = engineIdOf(obj)
    local deckId = id:find("^library:") or id:find("^graveyard:") or id:find("^exile:") or id == "trash"
    if not deckId and not engineSpawning[id] and engineObjs[id] ~= obj and not (engineSearchIds or {})[id] and not (engineInPile or {})[id] then
      Wait.frames(function()
        -- (a card a player turned to its other state is kept, should TTS not say so itself: engineAdoptState)
        if obj ~= nil and not obj.isDestroyed() and engineObjs[id] ~= obj and not engineAdoptState(obj) then engineDispose(obj) end
        resyncSoon()
      end, 1)
    end
  end
  if tableObjectSpawn ~= nil then return tableObjectSpawn(obj) end
end

local tableObjectDestroy = onObjectDestroy
function onObjectDestroy(obj)
  if ENGINE_MODE and lastTable ~= nil and isEngineCard(obj) then resyncSoon() end
  if tableObjectDestroy ~= nil then return tableObjectDestroy(obj) end
end

-- ───────── surviving a reload ─────────
-- Save & Play, Ctrl+S/loading a save, or a script reload keep the objects but forget this script's memory.
-- The positions of anything moved aside are saved with the game; after a reload they are put back, leftover
-- engine cards are swept away, and the bridge is asked to redraw a game that is still running.
function onSave()
  local s = {}
  for guid, st in pairs(stashed) do
    s[guid] = { pos = { st.pos.x, st.pos.y, st.pos.z }, rot = { st.rot.x, st.rot.y, st.rot.z }, lock = st.lock }
  end
  -- (and the host's "mtg fx" setting, a word)
  return JSON.encode({ engineStash = s, engineFx = engineFxMode })
end

Wait.frames(function()
  local ok, saved = pcall(JSON.decode, Global.script_state or "")
  if ok and type(saved) == "table" and type(saved.engineStash) == "table" then
    for guid, st in pairs(saved.engineStash) do
      stashed[guid] = { pos = Vector(st.pos[1], st.pos[2], st.pos[3]), rot = Vector(st.rot[1], st.rot[2], st.rot[3]), lock = st.lock }
    end
  end
  if ok and type(saved) == "table" and (saved.engineFx == "on" or saved.engineFx == "low" or saved.engineFx == "off") then engineFxMode = saved.engineFx end
  sweepEngineCards()
  restoreStash()
  engineSend("hello", { stamp = engineStamp(), keepRewind = true })
  -- the running game sent back on that hello was not drawn once, after a TTS relaunch with a big table still loading
  -- (hp-22 re-test 2026-10-28: the bridge's record has it sent; the table showed READY): ask again while nothing came
  local function askAgain(tries)
    Wait.time(function()
      if lastTable ~= nil then return end
      engineSend("hello", { again = true, stamp = engineStamp(), keepRewind = true })
      if tries > 1 then askAgain(tries - 1) end
    end, 10)
  end
  askAgain(3)
end, 30)

-- The library is a real face-down deck holding as many cards as the engine says. Draws take cards off it toward
-- the hand; during a library search it holds exactly the cards you may pick, so right-click → Search works.
local libraryState = {}  -- colour -> { qty, key }
engineSearch = {}        -- colour -> cards the open prompt lets you pick from your library
engineSearchIds = {}        -- engine card id -> true while that card sits in a search deck
libraryAnimTo = {}          -- colour -> where cards leaving the library fly next (graveyard for a mill)
local libraryAnimUntil = {} -- colour -> os.clock() until which cards leaving the deck are our own draw animation

local function libraryDeckData(color, count, candidates)
  local backKey = engineDeckKey(ENGINE_BACK, ENGINE_BACK)
  local objs, ids, decks = {}, {}, { [backKey] = deckEntry(ENGINE_BACK, ENGINE_BACK) }
  for _, c in ipairs(candidates or {}) do
    local d = engineCardData(c, "search")
    for k, e in pairs(d.CustomDeck) do decks[k] = e end
    objs[#objs + 1] = d
    ids[#ids + 1] = d.CardID
  end
  for _ = #objs + 1, math.max(count, #objs) do
    objs[#objs + 1] = { Name = "Card", Nickname = "Library card", GMNotes = "libcard", CardID = backKey * 100,
      CustomDeck = { [backKey] = decks[backKey] }, Transform = FLAT }
    ids[#ids + 1] = backKey * 100
  end
  return { Name = "Deck", Nickname = "Library", GMNotes = "engine:library:" .. color, Locked = true,
    DeckIDs = ids, CustomDeck = decks, ContainedObjects = objs, Transform = FLAT }
end

-- Linked and playable exile (2026-10-23, needs our Forge build: reports/MTG linked exile and zone quirks.md).
-- A card a seated player may play from exile or a graveyard (Tibalt, flashback, adventure, plot, foretell, Gonti,
-- impulse draw...) leaves its pile for that player's playable row, as Arena puts them beside the hand: face-up ones in
-- a public row on the wood strip between the player's mat and hand, centred on the hand (PLAYABLE_DEPTH), glowing (in front of the
-- small second hand zone it was half hidden under the big buttons, playtest 2026-10-26); ones others may not see (foretold, Gonti's face-down
-- card) inside that second hand zone, where TTS shows a card's face to its owner only. An exiled card linked to a
-- permanent still on the battlefield (Banishing Light, Valki, Arcane Bombardment, imprint) lies half-size under that
-- permanent, as Forge shows it, instead of in the pile. Dragging a playable card onto the battlefield plays it.
engineSpecial = {} -- engine card id -> "playable" | "linked" on the current board
-- (beside the hand, item 10 2026-11-10: the wood strip between the mat and the hand, measured on the real table: the
-- mat's near edge is 10.38 past its centre, the hand counter screen starts at 14.07 (White's z -25.81 and -29.5), so a
-- card 3.06 deep centred at 12.2 clears both; the row is centred on the hand, 2.3 apart, squeezed past 20.7 wide)
PLAYABLE_DEPTH, PLAYABLE_STEP, PLAYABLE_SPAN = 12.2, 2.3, 20.7
function engineMarkSpecial(m)
  engineSpecial = {}
  local onField = {}
  for _, pl in ipairs(m.players or {}) do for _, c in ipairs(pl.battlefield or {}) do onField[c.id] = pl.color end end
  local _, castOf, inHand = enginePlayableRows(m)
  for _, pl in ipairs(m.players or {}) do
    if pl.color ~= nil and Player[pl.color] ~= nil and Player[pl.color].seated then
      for _, c in ipairs(pl.playable or {}) do
        local stand = engineCastId(pl.color, c.id)
        if castOf[stand] ~= nil then engineSpecial[stand] = "playable"
        elseif inHand[c.id] == nil then engineSpecial[c.id] = "playable" end
      end
    end
  end
  for _, pl in ipairs(m.players or {}) do
    for _, c in ipairs(pl.exile or {}) do
      if engineSpecial[c.id] == nil and c.ew ~= nil and onField[c.ew] ~= nil then engineSpecial[c.id] = "linked" end
    end
  end
  engineLinkHost = onField
end
function engineWithoutSpecial(list)
  if next(engineSpecial) == nil then return list end
  local out = {}
  for _, c in ipairs(list) do if engineSpecial[c.id] == nil then out[#out + 1] = c end end
  return out
end
-- the hand cards the table lays in seated players' hands: id -> that player's colour; then a controlled player's hand
-- cards not in a seated hand, laid in the controller's second hand zone (engineCtlHands): id -> the controller's colour
function engineSeatHands(m)
  local out = {}
  for _, pl in ipairs(m.players or {}) do
    if pl.color ~= nil and pl.hand ~= nil and Player[pl.color] ~= nil and Player[pl.color].seated then
      for _, c in ipairs(pl.hand) do out[c.id] = pl.color end
    end
  end
  for _, pl in ipairs(m.players or {}) do
    local by = pl.ctlBy
    if by ~= nil and Player[by] ~= nil and Player[by].seated then
      for _, c in ipairs(pl.ctlHand or {}) do if out[c.id] == nil then out[c.id] = by end end
    end
  end
  return out
end
-- Each playable card goes into one row only: its controller's when that seat has it, else the first seat listing it
-- (Thief of Sanity's card, controlled by its owner, in its caster's row). A card in a seated player's hand stays in
-- that hand (Sen Triplets: its caster may cast the target's hand cards); the caster's row gets a stand-in of its own,
-- cast:<caster>:<id> (castOf: stand-in id -> the hand's colour), which casts the real card when dragged. The real card
-- was placed in the hand and again in the caster's row, and jumped onto the caster's mat from the second board on. A card an open scry holds stays in that
-- player's hand zone (engineScryPlace). Placing one card in several rows threw it across the table on every board:
-- Courser of Kruphix's revealed top card was in both players' rows, and each scry put it in Blue's hand zone, then
-- White's row, then Blue's (2026-11-08 20:23 game). -> rowOf (id -> the row's colour), castOf, and engineSeatHands(m),
-- which the callers need too.
function enginePlayableRows(m)
  local held, inHand = engineScryHeld(), engineSeatHands(m)
  local rowOf, castOf = {}, {}
  for _, pl in ipairs(m.players or {}) do
    local color = pl.color
    if color ~= nil and Player[color] ~= nil and Player[color].seated then
      for _, c in ipairs(pl.playable or {}) do
        if inHand[c.id] ~= nil then
          if inHand[c.id] ~= color then castOf[engineCastId(color, c.id)] = inHand[c.id] end
        elseif not held[c.id] and (rowOf[c.id] == nil or c.ctl == color) then rowOf[c.id] = color end
      end
    end
  end
  return rowOf, castOf, inHand
end
function enginePlaceSpecial(m, seen)
  if next(engineSpecial) == nil then return end
  local faceDown = {}
  for _, pl in ipairs(m.players or {}) do
    for _, z in ipairs({ "exile", "graveyard" }) do for _, c in ipairs(pl[z] or {}) do if c.fd then faceDown[c.id] = true end end end
  end
  local rowOf, castOf = enginePlayableRows(m)
  local shown = {} -- (a stand-in for a hand card nobody else sees goes in the second hand zone, as a face-down card)
  for _, pl in ipairs(m.players or {}) do for _, c in ipairs(pl.revealed or {}) do shown[c.id] = true end end
  for _, pl in ipairs(m.players or {}) do
    local color = pl.color
    local g = color and seatGeometry(color)
    local row = {}
    for _, c in ipairs(pl.playable or {}) do
      local stand = engineCastId(color, c.id)
      if rowOf[c.id] == color then row[#row + 1] = c
      elseif castOf[stand] ~= nil then
        if not shown[c.id] then faceDown[stand] = true end
        row[#row + 1] = engineStandIn(c, stand, "In " .. engineNameOf(castOf[stand]) .. "'s hand: drag it onto the battlefield to cast it")
      end
    end
    if g ~= nil and Player[color] ~= nil and Player[color].seated and #row > 0 then
      local side = Player[color].getHandTransform(2)
      local base = side and side.position or (g.handPos or g.mat)
      local k, public = 0, 0
      for _, c in ipairs(row) do if not (faceDown[c.id] or c.fo) then public = public + 1 end end
      local lat = g.handPos and (g.handPos - g.mat):dot(g.right) or 0
      local span = math.min(PLAYABLE_STEP * (public - 1), PLAYABLE_SPAN)
      local step = public > 1 and span / (public - 1) or 0
      for _, c in ipairs(row) do
        if faceDown[c.id] or c.fo then
          place(c, base + Vector(0, 1, 0), Vector(0, g.rotY, 0), seen, color, { zone = "playable", color = color, hand2 = true })
        else
          local spot = onTable(g.mat + g.fwd * PLAYABLE_DEPTH + g.right * (lat + span / 2 - k * step), 0)
          k = k + 1
          place(c, spot, Vector(0, g.rotY, 0), seen, nil, { zone = "playable", color = color })
        end
      end
    end
  end
  local perHost = {}
  for _, pl in ipairs(m.players or {}) do
    for _, c in ipairs(pl.exile or {}) do
      if engineSpecial[c.id] == "linked" then
        local hostColor = engineLinkHost[c.ew]
        local g = hostColor and seatGeometry(hostColor)
        local host = enginePlanned[c.ew]
        if g ~= nil and host ~= nil then
          perHost[c.ew] = (perHost[c.ew] or 0) + 1
          local n = perHost[c.ew]
          local spot = host + g.fwd * (1.1 + 0.35 * (n - 1)) + g.right * (0.35 * (n - 1)) + Vector(0, -0.02 * n, 0)
          place(c, spot, Vector(0, g.rotY, c.fd and 180 or 0), seen, nil, { zone = "linked", color = hostColor, host = c.ew })
        end
      end
    end
  end
end
-- Hand cards shown to everyone (the bridge's revealed list: Revelation's "Players play with their hands revealed", Sen
-- Triplets): face up, half size and locked, in the grid row between the creatures and the other permanents of the
-- owner's mat, which nothing else uses (attachments and linked cards reach into it by about a third). Each is an
-- object of its own, "reveal:<id>", so the real hand card stays in the hand; one no longer listed goes with the
-- board's sweep (engineRender). An AI's hand shows too: the strip doesn't need a seated player.
REVEAL_ROW, REVEAL_STEP = 1, 1.3
function engineRevealStrip(m, seen)
  for _, pl in ipairs(m.players or {}) do
    local g = pl.color and seatGeometry(pl.color)
    local n = #(pl.revealed or {})
    if g ~= nil and n > 0 then
      -- (as wide as the battlefield's rows at most: a long hand is squeezed)
      local step = math.min(REVEAL_STEP, (GRID.perRow - 1) * GRID.colStep / math.max(1, n - 1))
      for k, c in ipairs(pl.revealed) do
        local r = engineStandIn(c, "reveal:" .. tostring(c.id), "Revealed: in " .. engineNameOf(pl.color) .. "'s hand")
        local spot = onTable(g.mat + g.right * (GRID.colStart - (k - 1) * step) + g.fwd * (REVEAL_ROW * GRID.rowStep + GRID.rowStart), 0.02)
        place(r, spot, Vector(0, g.rotY, 0), seen, nil, { zone = "revealed", color = pl.color })
      end
    end
  end
end
-- Mills, as the table's own Mill button does them (its mill1: each card turns face up and slides to the graveyard, a
-- moment apart; the player, 2026-10-22). A mill is a new card in a graveyard that wasn't anywhere public before,
-- while that player's library shrank. Cards held for the player (enginePending, up to 5, Auto off) come off the library
-- turning face up onto the fan (place) and slide into the graveyard pile when released (engineZonePile takes them in);
-- the others (Auto on, bigger mills, AI players) fly face up from the library to the graveyard as stand-ins, the first
-- MILL_FLY of them, MILL_GAP apart, while the graveyard pile already holds them.
engineMillNow = {}   -- colour -> cards milled on this board (the library takes as many off without flying them)
MILL_FLY, MILL_GAP, MILL_TIME = 5, 0.25, 0.6
function engineMillDetect(m)
  for _, pl in ipairs(m.players or {}) do
    local color = pl.color
    local diff = color ~= nil and engineBoardDiffs[color] or nil
    local milled = {}
    for _, c in ipairs(diff and diff.fresh or {}) do
      if #milled < diff.drop then milled[#milled + 1] = c end
    end
    if #milled > 0 then
      engineMillNow[color] = #milled
      local held = {}
      for _, id in ipairs((enginePending[color] or {}).mill or {}) do held[id] = true end
      local g = seatGeometry(color)
      local k = 0
      for _, c in ipairs(milled) do
        if not held[c.id] and k < MILL_FLY and g ~= nil and not engineAnimOff then
          k = k + 1
          engineMillFly(c, g, (k - 1) * MILL_GAP)
        end
      end
    end
  end
end
-- one stand-in card: face down on the library, turning face up as it slides onto the graveyard, then gone
function engineMillFly(c, g, delay)
  Wait.time(function()
    local data = engineCardData(c)
    data.GMNotes = "enginefx"
    op("spawn")
    spawnObjectData({ data = data, position = g.lib + Vector(0, 1.6, 0), rotation = Vector(0, g.rotY, 180), callback_function = function(obj)
      engineSlideAway(obj, g.grave + Vector(0, 1.2, 0), MILL_TIME + 0.3, true, Vector(0, g.rotY, 0))
    end })
  end, math.max(delay, 0.01))
end
-- A card leaving the table by sliding somewhere and going: a milled card's stand-in, a stray card joining its pile.
-- (rot: it turns as it goes; fast: TTS's quick smooth move)
function engineSlideAway(obj, pos, after, fast, rot)
  obj.setLock(true)
  if rot ~= nil then obj.setRotationSmooth(rot, false, true) end
  obj.setPositionSmooth(pos, false, fast == true)
  Wait.time(function() if obj ~= nil and not obj.isDestroyed() then engineDispose(obj) end end, after)
end
function engineLibraryDeck(color, g, count, seen)
  local id = "library:" .. color
  seen[id] = true
  engineMeta[id] = { zone = "library", color = color }
  local candidates = engineSearch[color]
  local key = candidates and ("search:" .. tostring(#candidates)) or "plain"
  local st = libraryState[color]
  local o = engineObjs[id]
  local alive = o ~= nil and not o.isDestroyed()
  if alive and st ~= nil and st.key == key and st.qty == count then return end
  if engineSpawning[id] then
    -- a deck is already on its way; when it arrives it checks it is still current (see below)
    libraryState[color] = { qty = count, key = key, pendingRebuild = true }
    return
  end
  -- Draws: take the difference off the top toward the hand (the real card appears there), no rebuild.
  if alive and st ~= nil and st.key == "plain" and key == "plain" and o.type == "Deck" and count < st.qty and count >= 2 then
    libraryAnimUntil[color] = os.clock() + 2
    local target = (libraryAnimTo[color] or g.handPos or g.lib) + Vector(0, 2, 0)
    libraryAnimTo[color] = nil
    -- (milled cards leave as their own face-up cards, engineMillDetect: their plain backs just go, without flying to
    -- the hand as they used to)
    local milled = math.min(engineMillNow[color] or 0, st.qty - count)
    engineMillNow[color] = nil
    for k = 1, math.min(st.qty - count, o.getQuantity() - 1) do
      local quiet = k <= milled
      op("take") o.takeObject({ position = quiet and (o.getPosition() + Vector(0, -3, 0)) or target, smooth = not quiet, callback_function = function(card)
        Wait.time(function() if card ~= nil and not card.isDestroyed() then engineDispose(card) end end, quiet and 0 or 0.6)
      end })
    end
    st.qty = count
    return
  end
  -- Cards added (put on the bottom, a mulligan's cards back): ONE object goes in, a plain card or a deck of them, built
  -- as the library's own plain backs. (Several cards spawned on one spot merged into their own unnamed deck lying on
  -- the library instead, real table 2026-11-06: the debug setup's dealt hand of 7; "mtg reset" left it there.)
  if alive and st ~= nil and st.key == "plain" and key == "plain" and o.type == "Deck" and count > st.qty then
    local add = libraryDeckData(color, count - st.qty)
    if #add.ContainedObjects == 1 then add = add.ContainedObjects[1] end
    add.Nickname, add.GMNotes, add.Locked = "Library card", "libcard", nil
    op("libAdd")
    spawnObjectData({ data = add, position = o.getPosition() + Vector(0, 2, 0), rotation = Vector(0, g.rotY, 180), callback_function = function(obj)
      if o == nil or o.isDestroyed() then engineDispose(obj) return end -- (the library was replaced meanwhile)
      engineEntering[obj.getGUID()] = true
      enginePutInDeck(o, obj) -- (a deck put into a deck merges its cards in: TTS's putObject "works for ... decks")
    end })
    st.qty = count
    return
  end
  if alive then engineDispose(o) end
  engineObjs[id] = nil
  libraryState[color] = { qty = count, key = key }
  engineSearchIds = {}
  for _, c in ipairs(candidates or {}) do engineSearchIds[c.id] = true end
  if count <= 0 and not candidates then return end
  local data
  if count + #(candidates or {}) <= 1 and not candidates then
    data = engineCardData({ id = id, n = "Library", tl = "1 card", cmc = 0, f = ENGINE_BACK, b = ENGINE_BACK })
  else
    data = libraryDeckData(color, count, candidates)
  end
  engineSpawning[id] = true
  local built, gen = libraryState[color], engineGen
  op("deckSpawn") spawnObjectData({ data = data, position = onTable(g.lib, 0.3), rotation = Vector(0, g.rotY, 180), callback_function = function(obj)
    -- (a callback from an earlier game: registering it locked a trashed deck and its keepOnly could throw away the next
    -- game's library)
    if engineSpawnStale(gen, obj, id) then return end
    engineSpawning[id] = nil
    local now = libraryState[color]
    if now ~= built and now ~= nil and now.pendingRebuild then
      -- the library changed while this deck was spawning: replace it with an up-to-date one
      engineDispose(obj)
      libraryState[color] = nil
      if lastTable ~= nil then engineRender(lastTable) end
      return
    end
    engineObjs[id] = obj
    obj.setLock(true)
    keepOnly(id, obj)
    -- a library holding a search's candidates (face down, with names): only its owner sees it, so nobody else can
    -- right-click → Search it or pull a card out that would answer the owner's search
    if candidates then
      local others = {}
      for _, c in ipairs(Player.getAvailableColors()) do if c ~= color then others[#others + 1] = c end end
      others[#others + 1] = "Grey"
      obj.setInvisibleTo(others)
    end
  end })
end

-- Cards leaving a library deck: the chosen card of a search becomes the player's pick; anything else goes back.
local libraryLeaveBefore = onObjectLeaveContainer
function onObjectLeaveContainer(container, obj)
  local gm = container ~= nil and tostring(container.getGMNotes()) or ""
  local color = gm:match("^engine:library:(%a+)$")
  if ENGINE_MODE and color ~= nil and obj ~= nil then
    local ogm = tostring(obj.getGMNotes())
    local cid = ogm:match("^engine:(.+)$")
    if cid ~= nil and engineSearchIds[cid] and engineSearch[color] ~= nil then
      engineCardEntry(cid, obj, nil, { held = true }) -- the engine will say where it goes next
      engineSend("intent", { color = color, kind = "choose", id = cid })
      return
    end
    if ogm == "libcard" and libraryAnimUntil[color] ~= nil and os.clock() < libraryAnimUntil[color] then return end
    tell(color, "The engine draws and shuffles your library; cards go back in.")
    Wait.frames(function()
      if obj ~= nil and not obj.isDestroyed() then engineDispose(obj) end
      libraryState[color] = nil
      local lib = engineObjs["library:" .. color]
      if lib ~= nil and not lib.isDestroyed() then engineDispose(lib) end
      engineObjs["library:" .. color] = nil
      for _, x in ipairs(getObjects()) do if tostring(x.getGMNotes()) == "libcard" then engineDispose(x) end end
      if lastTable ~= nil then engineRender(lastTable) end
    end, 1)
    return
  end
  if libraryLeaveBefore ~= nil then return libraryLeaveBefore(container, obj) end
end

-- Graveyard and exile are real face-up decks (right-click → Search to look through them). One card is a plain card;
-- two or more become a deck. A card arriving from elsewhere slides onto the pile first, then joins the deck.
engineInPile = {}           -- engine card id -> true while the card sits inside a graveyard/exile deck
local pileState = {}        -- "graveyard:White" -> key of the cards it was built with
engineChoosable = {}        -- colour -> { [engine card id] = true } cards the open prompt lets you pick from a pile

local pileIds = {}   -- "graveyard:White" -> card ids the pile deck holds, in order
engineEntering = {}  -- object GUID -> true while the renderer itself puts that card into a pile deck

-- A card joining an existing pile goes into that deck (putObject): no new deck, no destroyed objects. Rebuilding the
-- whole pile for every card made Unity's clean-up passes (265-400 ms freezes) grow with each game.
pileRepairAt = {} -- pile id -> os.clock() of its last repair
local function addToPile(deck, c)
  engineInPile[c.id] = true
  local single = engineObjs[c.id]
  engineObjs[c.id] = nil
  local pileId = (deck ~= nil and not deck.isDestroyed()) and tostring(deck.getGMNotes()):gsub("^engine:", "") or nil
  -- (its zone now, for a drop of it before it is in: it read as a hand card, and Rancor dragged from beside the pile was
  -- asked to be cast and then discarded, 2026-11-08 23:39 and 23:52)
  local pz, pc = tostring(pileId):match("^(%a+):(%a+)$")
  if pz ~= nil then engineMeta[c.id] = { zone = pz, color = pc } end
  -- a few frames later the card must be inside the pile; if the pile was replaced meanwhile or the put didn't take,
  -- redraw the pile from the engine's list so the card can't get lost (it once vanished with an old pile deck)
  -- (a check that can't decide yet looks again, up to 6 times half a second apart: giving up at the first "not yet"
  -- left a card missing for good when its pile was being redrawn or another repair had just run)
  local gen = engineGen
  -- The object put in, still there once the card is in the pile: a stray copy nothing moves any more (Rancor lay beside
  -- Blue's graveyard for 48 minutes, discarded while Blue was dragging it, 2026-11-08 23:39). Only one provably left
  -- behind: alive, still its card's, not that card's object again, lying loose on the table (getObjectFromGUID finds no
  -- object inside a container, so a reference real TTS kept to the card it merged is never it), in nobody's grip, and
  -- seen so on two checks half a second apart. A held one is looked at again.
  local seenStray = false
  local function strayLeft(later)
    if single == nil or single.isDestroyed() or engineObjs[c.id] == single then return false end
    if tostring(single.getGMNotes()) ~= "engine:" .. c.id then return false end
    if getObjectFromGUID(single.getGUID()) == nil then return false end
    local held = single.held_by_color
    if held ~= nil and held ~= "" then
      seenStray = false
      later()
      return false
    end
    if not seenStray then
      seenStray = true
      later()
      return false
    end
    return true
  end
  local function verify(attempt)
    attempt = attempt or 1
    local function later() if attempt < 6 then Wait.frames(function() verify(attempt + 1) end, 30) end end
    Wait.frames(function()
      if pileId == nil or lastTable == nil or gen ~= engineGen then return end
      -- a pile being rebuilt is spawned from the engine's full list: check again once it is there (checking during
      -- it made the repair rebuild the pile again and again, and the whole graveyard went missing)
      if engineSpawning[pileId] then later() return end
      local d = engineObjs[pileId]
      if d == nil or d.isDestroyed() then later() return end
      if d.type ~= "Deck" then return end -- drawn another way (a one-card pile is the card itself)
      for _, e in ipairs(d.getObjects() or {}) do
        if e.gm_notes == "engine:" .. c.id then
          -- in the pile: the object put in is disposed only if it was provably left behind (strayLeft)
          if strayLeft(later) then
            op("pileStray")
            engineDispose(single)
          end
          return
        end
      end
      if engineObjs[c.id] ~= nil then return end -- it is drawn as its own object after all
      -- still in this pile in the engine's game? (it may have moved on since)
      local zone, color = pileId:match("^(%a+):(%a+)$")
      local still = false
      for _, pl in ipairs(lastTable.players or {}) do
        if pl.color == color then for _, x in ipairs(pl[zone] or {}) do if x.id == c.id then still = true end end end
      end
      if not still then return end
      if (pileRepairAt[pileId] or -100) > os.clock() - 3 then later() return end -- at most one repair per pile every 3 s
      pileRepairAt[pileId] = os.clock()
      op("pileRepair")
      print("[engine] pile repair: " .. tostring(c.n or c.id) .. " was missing from " .. pileId)
      if engineRebuildPile ~= nil then engineRebuildPile(pileId) end
    end, 6)
  end
  local function put(obj)
    if obj == nil or obj.isDestroyed() then verify() return end
    if deck == nil or deck.isDestroyed() then verify() return end
    engineEntering[obj.getGUID()] = true
    enginePutInDeck(deck, obj)
    verify()
  end
  if single ~= nil and not single.isDestroyed() then
    if engineInHand[c.id] then
      -- cards held in a hand are lifted out first; the hand would keep re-taking them
      engineInHand[c.id] = nil
      single.setPosition(deck.getPosition() + Vector(0, 2, 0))
      Wait.frames(function() put(single) end, 1)
    else
      put(single)
    end
  else
    op("pileSpawn")
    -- (built as the cards a pile deck is built from: it goes straight in, so it needs no lock and no engine tag)
    spawnObjectData({ data = engineCardData(c, "inside"), position = deck.getPosition() + Vector(0, 2, 0), callback_function = put })
  end
end

-- Cards that LEFT a pile (reanimated, cast from exile, ...) are taken out of the pile deck before the board is
-- drawn: the taken card becomes the object that moves to its new place, so nothing is respawned or rebuilt.
-- A pile deck taken down to one card turns into that card (TTS's deck.remainder): it becomes the remaining card's
-- object and the pile is no deck any more. After the table's own takes (engineTakeFromPiles) and a player's pick.
function enginePileRemainder(id, deck)
  local rem = deck ~= nil and deck.remainder or nil
  if rem == nil then return false end
  -- (only an engine card becomes a card's object: anything else left in a pile, a card a player dropped into it, stays
  -- as it is; the pile is no deck any more either way)
  local gm = tostring(rem.getGMNotes())
  if gm:sub(1, 7) == "engine:" then engineCardEntry(gm:sub(8), rem) end
  engineObjs[id] = nil
  pileState[id], pileIds[id] = nil, nil
  return true
end
function engineTakeFromPiles(m)
  for _, pl in ipairs(m.players or {}) do
    for _, zone in ipairs({ "graveyard", "exile" }) do
      local id = zone .. ":" .. tostring(pl.color)
      local old, deck = pileIds[id], engineObjs[id]
      if old ~= nil and deck ~= nil and not deck.isDestroyed() and deck.type == "Deck" and not engineSpawning[id] then
        local now, nowIds = {}, {}
        for _, c in ipairs(pl[zone] or {}) do now[c.id] = true nowIds[#nowIds + 1] = c.id end
        local removed, kept = {}, {}
        for _, cid in ipairs(old) do if now[cid] then kept[#kept + 1] = cid else removed[#removed + 1] = cid end end
        -- only when the rest of the pile is unchanged (same cards, same order) and something stays behind
        local same = #kept == #nowIds and #kept >= 1 and #removed > 0
        for i = 1, #kept do if kept[i] ~= nowIds[i] then same = false break end end
        if same then
          -- (by its place in the deck, read again for each card: cards inside a deck can share a guid, and a take by guid
          -- took the first of them, a Swamp, for Bayek of Siwa; that Swamp then read as a player's "Look only", hp-07
          -- #42 2026-10-27)
          -- (read once and taken from the highest index down, so a take never moves a later one, suite review)
          local takes, want = {}, {}
          for _, cid in ipairs(removed) do want["engine:" .. cid] = cid end
          for _, e in ipairs(deck.getObjects() or {}) do
            local cid = want[tostring(e.gm_notes)]
            if cid ~= nil then takes[#takes + 1] = { cid = cid, at = e.index } end
          end
          table.sort(takes, function(a, b) return a.at > b.at end)
          for _, t in ipairs(takes) do
            if deck ~= nil and not deck.isDestroyed() then
              engineTakingOut[t.cid] = true -- (the table's own take: not a player's, see onObjectLeaveContainer)
              local obj = deck.takeObject({ index = t.at, position = deck.getPosition() + Vector(0, 1.5, 0), smooth = false })
              if obj ~= nil then
                engineCardEntry(t.cid, obj)
                op("pileTake")
              else engineTakingOut[t.cid] = nil end
            end
          end
          -- a deck taken down to one card turns into that card (enginePileRemainder)
          if not enginePileRemainder(id, deck) then
            pileIds[id] = kept
            pileState[id] = table.concat(kept, ",")
          end
        end
      end
    end
  end
end

-- A card the pile already holds that is still a separate object on the table (taken from a search and dropped short
-- of the pile, then put there by the engine: it stayed where it lay, locked, 2026-10-21): it slides onto the pile and
-- goes away, as the cards a new pile is built from do.
function enginePileStrays(cards, base)
  for _, c in ipairs(cards) do
    local single = engineObjs[c.id]
    if single ~= nil and not single.isDestroyed() then
      engineObjs[c.id] = nil
      engineSlideAway(single, onTable(base, 0.3), 0.6)
    end
  end
end
-- A pile deck's hover text: what its cards can still do there and their counters (the bridge's notes; a card inside
-- a deck shows none of its own), newest first as the pile lies. Set on the deck as it changes, so a suspended card's
-- time counters count down without the pile being rebuilt.
function enginePileNotes(cards)
  local lines = {}
  for i = #cards, 1, -1 do
    local c = cards[i]
    if c.nt ~= nil and #c.nt > 0 then lines[#lines + 1] = "[b]" .. tostring(c.n or "A card") .. "[/b]: " .. table.concat(c.nt, "; ") end
  end
  return (table.concat(lines, "\n"):gsub('"', "'"))
end
function enginePileDescribe(id, notes)
  local o = engineObjs[id]
  if o ~= nil and not o.isDestroyed() and o.type == "Deck" and o.getDescription() ~= notes then o.setDescription(notes) end
end
function engineZonePile(color, zone, cards, base, rotY, seen)
  local id = zone .. ":" .. color
  seen[id] = true
  engineMeta[id] = { zone = zone .. "pile", color = color }
  if #cards <= 1 then
    -- a single card is an ordinary engine card
    local o = engineObjs[id]
    if o ~= nil and not o.isDestroyed() then engineDispose(o) end
    engineObjs[id], pileState[id], pileIds[id] = nil, nil, nil
    for _, c in ipairs(cards) do
      engineInPile[c.id] = nil
      place(c, onTable(base), Vector(0, rotY, c.fd and 180 or 0), seen, nil, { zone = zone, color = color })
    end
    return
  end
  local notes = enginePileNotes(cards)
  local ids = {}
  for _, c in ipairs(cards) do ids[#ids + 1] = c.id end
  local key = table.concat(ids, ",")
  local o = engineObjs[id]
  if pileState[id] == key and (engineSpawning[id] or (o ~= nil and not o.isDestroyed())) then
    for _, c in ipairs(cards) do seen[c.id] = true end
    enginePileStrays(cards, base)
    enginePileDescribe(id, notes)
    return
  end
  local old = pileIds[id]
  if old ~= nil and #ids > #old and o ~= nil and not o.isDestroyed() and o.type == "Deck" and not engineSpawning[id] then
    local same = true
    for i = 1, #old do if ids[i] ~= old[i] then same = false break end end
    if same then
      for i = #old + 1, #cards do addToPile(o, cards[i]) end
      pileState[id], pileIds[id] = key, ids
      for _, c in ipairs(cards) do seen[c.id] = true end
      enginePileStrays(cards, base)
      enginePileDescribe(id, notes)
      return
    end
  end
  -- cards that are still separate objects slide onto the pile, then disappear into the new deck
  for _, c in ipairs(cards) do
    seen[c.id] = true
    local single = engineObjs[c.id]
    if single ~= nil and not single.isDestroyed() then
      engineObjs[c.id] = nil
      engineSlideAway(single, onTable(base, 0.3), 0.6)
    end
    engineInPile[c.id] = true
  end
  if o ~= nil and not o.isDestroyed() then engineDispose(o) end
  engineObjs[id] = nil
  pileState[id] = key
  pileIds[id] = ids
  local decks, objs, deckIds = {}, {}, {}
  for i = #cards, 1, -1 do -- newest first: the top of a face-up deck is the card you see
    local n = #objs + 1
    objs[n] = engineCardData(cards[i], "inside")
    for k, e in pairs(objs[n].CustomDeck) do decks[k] = e end
    deckIds[n] = objs[n].CardID
  end
  local data = { Name = "Deck", Nickname = (zone == "graveyard" and "Graveyard" or "Exile"), Description = notes, GMNotes = "engine:" .. id,
    Locked = true, DeckIDs = deckIds, CustomDeck = decks, ContainedObjects = objs, Transform = FLAT }
  engineSpawning[id] = true
  local gen = engineGen
  Wait.time(function()
    if gen ~= engineGen then engineSpawning[id] = nil return end -- the game ended meanwhile
    op("deckSpawn") spawnObjectData({ data = data, position = onTable(base, 0.2), rotation = Vector(0, rotY, 0), callback_function = function(obj)
      engineSpawning[id] = nil
      if pileState[id] ~= key then engineDispose(obj) return end -- a newer version of this pile is on its way
      engineObjs[id] = obj
      obj.setLock(true)
      keepOnly(id, obj)
    end })
  end, 0.5)
end

-- Throws a pile deck away and redraws it from the engine state, clearing loose copies of its cards first
-- (pulling a card out of a 2-card deck leaves TTS with two loose cards).
function enginePileReset()
  engineTakingOut = {} -- (ids repeat in the next game: no mark may outlive this one)
  for k in pairs(pileState) do pileState[k] = nil end
  for k in pairs(pileIds) do pileIds[k] = nil end
  engineInPile = {}
  engineGroupOf = {}
  engineGroupKey = {}
  engineGroupList = {}
  engineSubDrawn = {}
  engineCombatHeld = {}
  engineSplit = {}
  engineAutoMana = nil
  engineStackGlow = {}
  engineBaseGlow = {}
  engineManualLanded = {}
  engineManualPlay = {}
end

function engineRebuildPile(id)
  pileState[id] = nil
  local o = engineObjs[id]
  if o ~= nil and not o.isDestroyed() then engineDispose(o) end
  engineObjs[id] = nil
  for _, x in ipairs(getObjects()) do
    local cid = tostring(x.getGMNotes()):match("^engine:(.+)$")
    if cid ~= nil and (engineInPile[cid] or x.getGMNotes() == "engine:" .. id) and engineObjs[cid] ~= x then engineDispose(x) end
  end
  if lastTable ~= nil then Wait.frames(function() if lastTable ~= nil then engineRender(lastTable) end end, 2) end
end

-- Cards pulled out of a graveyard/exile deck: the pick for an open prompt, otherwise the pile is redrawn.
-- engineTakingOut: engine card ids the table itself takes out (a card the engine moved out of the pile): those are not
-- the player's, who was told "Look only" when Kenrith returned Hero of Iroas from the graveyard (hp-07 #42 2026-10-27).
-- By card id, not guid: a card leaving a deck can get a new guid when its old one is taken.
engineTakingOut = {}
local pileLeaveBefore = onObjectLeaveContainer
function onObjectLeaveContainer(container, obj)
  local gm = container ~= nil and tostring(container.getGMNotes()) or ""
  local zone, color = gm:match("^engine:(%a+):(%a+)$")
  local takenId = obj ~= nil and tostring(obj.getGMNotes()):match("^engine:(.+)$") or nil
  if takenId ~= nil and engineTakingOut[takenId] then
    engineTakingOut[takenId] = nil
    if pileLeaveBefore ~= nil then return pileLeaveBefore(container, obj) end
    return
  end
  -- (not while a manual fix is being edited: taking a card out of a pile is how a fix moves it; the handler threw it
  -- back, found by the fake table once it fired this event as TTS does, hp-07 #42 2026-10-27)
  if ENGINE_MODE and not ENGINE_FIX_EDIT and (zone == "graveyard" or zone == "exile") and obj ~= nil then
    local cid = tostring(obj.getGMNotes()):match("^engine:(.+)$")
    local chooser = nil
    for c, set in pairs(engineChoosable) do if cid ~= nil and set[cid] then chooser = c end end
    if chooser ~= nil then
      engineCardEntry(cid, obj, nil, { held = true }) -- the engine says where it goes next
      -- (picked out of a 2-card pile: the card left is loose now, and stayed on the table as a stray copy)
      enginePileRemainder(zone .. ":" .. color, container)
      engineSend("intent", { color = chooser, kind = "choose", id = cid })
      return
    end
    tell(color, "Look only: the engine moves cards out of the " .. zone .. " when an effect lets you.")
    Wait.frames(function()
      if obj ~= nil and not obj.isDestroyed() then engineDispose(obj) end
      engineRebuildPile(zone .. ":" .. color)
    end, 1)
    return
  end
  if pileLeaveBefore ~= nil then return pileLeaveBefore(container, obj) end
end

-- Nothing merges into the engine's own library / graveyard / exile decks by physics (a card sliding onto a pile
-- while it is rebuilt would otherwise be swallowed); the engine decides what those decks contain.
local tryEnterBefore = tryObjectEnterContainer
function tryObjectEnterContainer(container, obj)
  if obj ~= nil and engineEntering[obj.getGUID()] then return true end
  if ENGINE_MODE and container ~= nil then
    local gm = tostring(container.getGMNotes())
    if gm:find("^engine:library:") or gm:find("^engine:graveyard:") or gm:find("^engine:exile:") then return false end
    -- one engine card dropped onto another (rearranging your lands) made TTS merge them into a deck: both cards
    -- vanished until the table broke the deck up and drew them again (the "stacking glitch", playtest 2026-10-24).
    -- They don't merge now; the card just lies on the other.
    if gm:find("^engine:engine%-card%-") and obj ~= nil and isEngineCard(obj) then
      if engineTableLog ~= nil then engineTableLog(nil, "kept " .. tostring(obj.getName():match("^[^\n]*")) .. " from stacking into " .. tostring(container.getName():match("^[^\n]*"))) end
      return false
    end
  end
  if tryEnterBefore ~= nil then return tryEnterBefore(container, obj) end
  return true
end

-- ───────── profiling (read engineProfile over the debug channel) ─────────
-- Times the table's main engine handlers; slow calls are what players feel as a frame hitch.
engineProfile = { calls = {}, total = {}, max = {}, slow = {}, recent = {}, hitches = {}, sect = {}, frames = 0, uiCalls = 0 }

-- Frame-hitch recorder: a frame over 50 ms is logged with the engine handlers that ran just before it (TTS does
-- UI layout and spawning after a script returns, so that cost lands in the following frame).
function onUpdate()
  local P = engineProfile
  P.frames = P.frames + 1
  local dt = Time.delta_time -- Unity caps this at 0.15 s, so 150 means "150 ms or more"
  if dt > 0.05 and #P.hitches < 60 then
    local ops = {}
    for k, v in pairs(engineOps) do ops[#ops + 1] = k .. "=" .. v end
    P.hitches[#P.hitches + 1] = string.format("%.0fms after [%s] ui=%d ops{%s}", dt * 1000, table.concat(P.recent, ","), P.uiCalls, table.concat(ops, " "))
  end
  P.recent = {}
  P.uiCalls = 0
  engineOps = {}
end
local function profiled(name)
  local fn = _G[name]
  if type(fn) ~= "function" then return end
  _G[name] = function(...)
    local t0 = os.clock()
    engineProfile.recent[#engineProfile.recent + 1] = name
    local a, b, c = fn(...)
    local ms = (os.clock() - t0) * 1000
    local P = engineProfile
    P.calls[name] = (P.calls[name] or 0) + 1
    P.total[name] = (P.total[name] or 0) + ms
    if ms > (P.max[name] or 0) then P.max[name] = ms end
    if ms > 30 and #P.slow < 40 then P.slow[#P.slow + 1] = string.format("%s %.0fms", name, ms) end
    return a, b, c
  end
end
for _, n in ipairs({ "engineRender", "engineOnPrompt", "engineRenderPanels", "onExternalMessage", "engineZonePile", "engineLibraryDeck" }) do profiled(n) end

-- ───────── table buttons (phase 3) ─────────
-- The manual Untap / Reveal / Draw / Mill / Scry buttons and the Mulligan tiles stay in engine mode (they ask the
-- engine, engineTableButton). A player who presses READY gets their own set out of the way: it goes under the table
-- until they un-ready, the game ends or engine mode goes off (2026-10-21, the user's call).
local TABLE_BUTTONS = {
  "86e447", "1f3e4a", "18fb5d", "e2f7ae", -- Untap
  "59ab68", "0ad181", "c489e1", "d67eb4", -- Reveal
  "885f49", "305c12", "26775a", "b49d50", -- Draw
  "67b4a5", "da5d0d", "d06889", "57914a", -- Mill
  "ffa67c", "8a4c8b", "614515", "4e19c8", -- Scry
  "c53ac6", "47645d", "3b07ae", "e0a3bc", -- Mulligan tiles
}
local BUTTON_DROP = 20
local buttonSeat = {} -- table button guid -> the seat whose playmat it is nearest (worked out once)
local function seatOfButton(o)
  local guid = o.getGUID()
  if buttonSeat[guid] == nil then
    local p, bestD = o.getPosition(), nil
    for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do
      local mat = data[c] and data[c].playmat
      if mat ~= nil then
        local m = mat.getPosition()
        local d = (p.x - m.x) ^ 2 + (p.z - m.z) ^ 2
        if bestD == nil or d < bestD then buttonSeat[guid], bestD = c, d end
      end
    end
  end
  return buttonSeat[guid]
end
-- hide: true / false for every seat, or a function seat -> true / false
function engineTableButtons(hide)
  for _, guid in ipairs(TABLE_BUTTONS) do
    local o = getObjectFromGUID(guid)
    if o ~= nil then
      local p = o.getPosition()
      local h = hide
      if type(hide) == "function" then h = hide(seatOfButton(o)) end
      if h and p.y > -5 then
        o.setLock(true)
        o.setPosition(p + Vector(0, -BUTTON_DROP, 0))
      elseif not h and p.y < -5 then
        o.setPosition(p + Vector(0, BUTTON_DROP, 0))
      end
    end
  end
end
-- where `color`'s Draw button stands on the table (also while it is under it): the READY button goes there
local DRAW_BUTTONS = { "885f49", "305c12", "26775a", "b49d50" }
function engineDrawButtonSpot(color)
  local mat = data[color] and data[color].playmat
  if mat == nil then return nil end
  local m, best, bestD = mat.getPosition(), nil, nil
  for _, guid in ipairs(DRAW_BUTTONS) do
    local o = getObjectFromGUID(guid)
    if o ~= nil then
      local p = o.getPosition()
      local d = (p.x - m.x) ^ 2 + (p.z - m.z) ^ 2
      if bestD == nil or d < bestD then best, bestD = p, d end
    end
  end
  return best and Vector(best.x, m.y + 0.2, best.z) or nil
end
-- Pirate Cannon, first-player die (the engine picks who goes first), the two "Screen bar keys" boxes (Ctrl + F1..F3)
local HIDE_IN_ENGINE_MODE = { "540e21", "ee33ec", "9065aa", "e8e28d" }
-- where each one was is kept in its memo (saved with the table, as text: see the JSON.encode freeze), so it goes back
-- to the same spot and lock state even after a save and reload in engine mode
function engineHideForEngine(on)
  for _, guid in ipairs(HIDE_IN_ENGINE_MODE) do
    local o = getObjectFromGUID(guid)
    local home = o ~= nil and tostring(o.memo or ""):match("^mtghome (.+)$")
    if o ~= nil and on and home == nil then
      local p = o.getPosition()
      o.memo = string.format("mtghome %.3f %.3f %.3f %s", p.x, p.y, p.z, tostring(o.getLock()))
      o.setLock(true)
      o.setPosition({ p.x, -30, p.z })
    elseif o ~= nil and not on and home ~= nil then
      local x, y, z, locked = home:match("^(%S+) (%S+) (%S+) (%S+)$")
      o.memo = ""
      o.setPosition({ tonumber(x), tonumber(y), tonumber(z) })
      o.setLock(locked == "true")
    end
  end
end
local setEngineModeWithoutButtons = setEngineMode
function setEngineMode(on)
  setEngineModeWithoutButtons(on)
  engineTableButtons(false) -- (back for everyone; READY hides a player's own set again)
  engineHideForEngine(on)
  if not on and engineStatusParkAll ~= nil then pcall(engineStatusParkAll) end -- (the normal table never shows them)
end
Wait.frames(function() engineTableButtons(false) engineHideForEngine(ENGINE_MODE) end, 20)

-- For the debug channel: the last board the bridge sent (lastTable is private to this file).
function engineTable() return lastTable end
-- A seat named as the game log names it ("AI 1", not "Red"; bug h's leftover, real table 2026-11-05)
function engineSeatName(color)
  for _, pl in ipairs((lastTable and lastTable.players) or {}) do
    if pl.color == color then return pl.name or color end
  end
  return color
end
-- For the table's hand counters (make-engine-copy "Hand counter"): the engine's count while a game runs, nil otherwise
-- (they counted the hand's objects and caught cards being re-laid out, hp-07 2026-10-27)
function engineHandCount(p)
  if not ENGINE_MODE or lastTable == nil or lastTable.gameOver or p == nil then return nil end
  for _, pl in ipairs(lastTable.players or {}) do if pl.color == p.color then return tonumber(pl.handCount) end end
  return nil
end

-- ───────── doing it yourself: releasing held moves ─────────
function heldInList(list, id)
  for _, x in ipairs(list) do if x == id then return true end end
  return false
end
-- kind: "draw" (one card), "mill" (all held mills), "untap" (all), "all".
function engineReleasePending(color, kind)
  local p = enginePending[color]
  if p == nil then return false end
  local did = false
  if (kind == "draw" or kind == "all") and #p.draw > 0 then
    p.draw = {} -- one click takes every held card
    did = true
  end
  if (kind == "mill" or kind == "all") and #p.mill > 0 then
    p.mill = {}
    did = true
  end
  if (kind == "untap" or kind == "all") and next(p.untap) ~= nil then
    p.untap = {}
    did = true
  end
  if did then engineTableLog(color, "takes the held " .. kind) end
  if did and engineTable() ~= nil then engineRender(engineTable()) end
  return did
end

-- The table's own Draw / Mill / Untap / Scry / Mulligan / Reveal buttons, while the engine runs.
function engineTableButton(kind, color)
  if color == nil or engineTable() == nil then return end
  local function say(t) broadcastToColor("[MTG] " .. t, color, {1, 0.85, 0.4}) end
  if kind == "draw" then
    if not engineReleasePending(color, "draw") then say("Not now: the engine draws for you when a rule or card says so.") end
  elseif kind == "mill" then
    if not engineReleasePending(color, "mill") then say("Not now: nothing is milling you.") end
  elseif kind == "untap" then
    if not engineReleasePending(color, "untap") then say("Not now: your permanents untap in your untap step.") end
  elseif kind == "mulligan" then
    local p = enginePrompts[color]
    local i
    for k, o in ipairs((p and p.options) or {}) do if o.id == "mull" then i = k end end
    if i ~= nil then enginePick(color, i) else say("Not now: you can only mulligan before the game starts.") end
  elseif kind == "scry" or kind == "reveal" then
    local p = enginePrompts[color]
    local k = p ~= nil and describePrompt(p).kind or nil
    local asks = (kind == "reveal" and k == "reveal") or (kind == "scry" and (k == "cards" or k == "place" or k == "order") and tostring(p.title):lower():find("scry"))
    if asks then say("Choose in your panel on the left.")
    else say("Not now: the engine asks you when a card makes you " .. kind .. ".") end
  end
end

-- Clicking or picking up your own library takes the held card (a draw first, then any mill).
local paceBeforeAction = onPlayerAction
function onPlayerAction(player, action, targets)
  if ENGINE_MODE and engineTable() ~= nil and (action == Player.Action.Select or action == Player.Action.PickUp) then
    for _, o in ipairs(targets or {}) do
      local gm = tostring(o.getGMNotes())
      local p = enginePending[player.color]
      if p ~= nil and #p.mill > 0 and heldInList(p.mill, (gm:gsub("^engine:", ""))) then
        engineReleasePending(player.color, "mill")
        return false
      end
      if gm == "engine:library:" .. player.color then
        local d, mi = enginePendingCount(player.color)
        if d > 0 then engineReleasePending(player.color, "draw") return false end
        if mi > 0 then engineReleasePending(player.color, "mill") return false end
      end
    end
  end
  return paceBeforeAction(player, action, targets)
end

-- A decision about a held card shows that card first.
local paceBeforePrompt = engineOnPrompt
function engineOnPrompt(m)
  local title = tostring(m.title or "")
  local k = describePrompt(m).kind
  if m.promptId ~= nil and k ~= "mulligan" and k ~= "mulliganPutBack" and k ~= "dice" then
    paceArmed[m.color] = true
  end
  local p = enginePending[m.color]
  if p ~= nil and m.promptId ~= nil then
    local wanted = {}
    for _, o in ipairs(m.options or {}) do
      if o.cardId then wanted[o.cardId] = true end
      local id = tostring(o.id or "")
      wanted[id] = true
      wanted[id:gsub("^card|", "")] = true
    end
    for _, list in ipairs({ p.draw, p.mill }) do
      for _, id in ipairs(list) do if wanted[id] then engineReleasePending(m.color, "all") break end end
    end
  end
  return paceBeforePrompt(m)
end

-- ───────── hotkey: pass priority (bind it to P) ─────────
-- Scripts can't claim a letter key themselves; this registers "MTG: pass priority / main button", which each
-- player binds once (Options → Controls). It passes priority, or presses the big corner button when there is no
-- pass (e.g. Confirm).
pcall(function()
  addHotkey("MTG: pass priority / main button", function(playerColor)
    local p = enginePrompts[playerColor]
    if p == nil then return end
    for i, o in ipairs(p.options or {}) do
      if o.id == "__pass" then enginePick(playerColor, i) return end
    end
    if engineCornerPress ~= nil then engineCornerPress(playerColor, "big") end
  end)
end)

-- ───────── rewind snapshots: once a minute instead of every ~10 s ─────────
-- TTS serializes the whole table for its rewind history about every 10 seconds. Measured with PresentMon
-- (2026-10-19): each snapshot froze this table for 2.6-2.8 s, all CPU, even with no game running. storeRewindState(fn,
-- true) stores one state now and blocks automatic ones for 60 s; renewing it every 55 s keeps rewind working (one state
-- a minute) while removing four of every five freezes. (allowRewindStore() LIFTS the block; it doesn't set it.)
local function holdRewind()
  if type(storeRewindState) == "function" then pcall(storeRewindState, function() end, true) end
  Wait.time(holdRewind, 55)
end
Wait.time(holdRewind, 5)

-- Debug readout for one engine card (tools/tts-check.lua uses it to explain a "missing object"): its object and the
-- table's bookkeeping about it.
function engineDebugCard(id)
  local o = engineObjs[id]
  local copies = 0
  for _, x in ipairs(getObjects()) do if tostring(x.getGMNotes()) == "engine:" .. id then copies = copies + 1 end end
  local m = engineMeta[id] or {}
  return string.format("obj=%s spawning=%s inPile=%s held=%s inHand=%s zone=%s manual=%s copies=%d",
    o == nil and "nil" or (o.isDestroyed() and "destroyed" or o.getGUID() .. "@" .. string.format("%.0f,%.0f", o.getPosition().x, o.getPosition().z)),
    tostring(engineSpawning[id]), tostring(engineInPile[id]), tostring(engineHeld[id]), tostring(engineInHand[id]),
    tostring(m.zone), tostring(engineManual[id] ~= nil), copies)
end

-- ───────── playable cards glow green in your hand (only you see it) ─────────
-- TTS highlights are seen by every player, so the glow is a frame drawn by the card's own UI with visibility set to
-- the hand's owner. Only cards you can cast or play right now ("Your priority" options) glow, and since 2026-11-11 your
-- permanents with an ability you can use now (enginePermanentGlowIds). "mtg glow" toggles both.
engineGlowOff = engineGlowOff or {}  -- colour -> true when that player switched the green glow off
local playableShown = {}            -- colour -> { card id = object } currently framed
-- A green frame sticking out past the card's edges: the UI draws under the card, so a frame inside the card's
-- outline (or a transparent panel's "outline", which Unity draws at the panel's own zero alpha) never showed.
local PLAYABLE_BAR = '<Panel color="#3dff6e" raycastTarget="false" width="%d" height="%d" rectAlignment="%s"/>'
local PLAYABLE_XML = '<Panel id="eng_play" visibility="%s" position="0 0 -12" rotation="0 0 180" width="266" height="366" color="#00000000" raycastTarget="false" active="%s">'
  .. string.format(PLAYABLE_BAR, 266, 13, "UpperCenter") .. string.format(PLAYABLE_BAR, 266, 13, "LowerCenter")
  .. string.format(PLAYABLE_BAR, 13, 366, "MiddleLeft") .. string.format(PLAYABLE_BAR, 13, 366, "MiddleRight") .. '</Panel>'
local playableBuilt = {} -- object -> owner colour its frame was built for (built once, then only shown/hidden)
-- First builds wait in a queue and go ENGINE_FRAME_BUILDS a frame (a full UI build costs a frame: a 40-permanent priority
-- built at once would stutter, SPEC.md "Green glow on permanents"). The frame is added beside whatever else the card's
-- UI holds, never by replacing it; a rebuild (another colour: a stolen permanent) takes only its own panel out.
ENGINE_FRAME_BUILDS = 4
engineFrameQueue = { list = {}, want = {}, pumping = false } -- want: object -> { color, on } waiting for its build
function engineFrameBuild(obj, color, on)
  local x = tostring(obj.UI.getXml() or "")
  local a = x:find('<Panel id="eng_play"', 1, true)
  if a ~= nil then
    -- (ours ends at the "</Panel>" that closes it, the Panels opened inside it counted: its bars close themselves as
    -- written, and are counted too should getXml give them back written out in full)
    local depth, pos, b = 0, a, nil
    while b == nil do
      local open, close = x:find("<Panel", pos, true), x:find("</Panel>", pos, true)
      if close == nil then break end
      if open ~= nil and open < close then
        local e = x:find(">", open, true) or #x
        if x:sub(e - 1, e - 1) ~= "/" then depth = depth + 1 end
        pos = e + 1
      else
        depth = depth - 1
        if depth <= 0 then b = close + 7 end
        pos = close + 8
      end
    end
    if b ~= nil then x = x:sub(1, a - 1) .. x:sub(b + 1) end
  end
  obj.UI.setXml(x .. string.format(PLAYABLE_XML, color, on and "true" or "false"))
  playableBuilt[obj] = color
end
function engineFramePump()
  local q = engineFrameQueue
  local n = 0
  while #q.list > 0 and n < ENGINE_FRAME_BUILDS do
    local obj = table.remove(q.list, 1)
    local w = q.want[obj]
    q.want[obj] = nil
    if w ~= nil and obj ~= nil and not obj.isDestroyed() then
      n = n + 1
      -- (a card whose UI can't be built is said and skipped: an error here left the pump marked running, and no frame
      -- was built again, verifier 2026-11-11)
      local ok, err = pcall(engineFrameBuild, obj, w.color, w.on)
      if not ok then print("[MTG] green frame: " .. tostring(err)) end
    end
  end
  q.pumping = #q.list > 0
  if q.pumping then Wait.frames(engineFramePump, 1) end
end
-- Shows or hides colour's frame on obj. Built for this colour: only its "active" switch (and a build queued for another
-- colour is dropped when this one is shown: the last asked wins). Not yet: shown queues the build; hidden drops this
-- colour's queued build (a frame hidden before it was built is never built), and leaves another colour's frame alone.
local function frameOn(obj, color, on)
  local q = engineFrameQueue
  local w = q.want[obj]
  if playableBuilt[obj] == color then
    if on then q.want[obj] = nil end
    obj.UI.setAttribute("eng_play", "active", on and "true" or "false")
  elseif on then
    if w == nil then q.list[#q.list + 1] = obj end
    q.want[obj] = { color = color, on = true }
    if not q.pumping then q.pumping = true Wait.frames(engineFramePump, 1) end
  elseif w ~= nil and w.color == color then
    q.want[obj] = nil
  end
end
function enginePlayableGlow(color)
  if color == nil then return end
  local want = {}
  local p = enginePrompts[color]
  if p ~= nil and not engineGlowOff[color] and describePrompt(p).kind == "priority" then
    for _, o in ipairs(p.options or {}) do
      local l = tostring(o.label)
      -- (your hand, your commander in the command zone, and your playable row of exile and graveyard cards)
      local m = o.cardId ~= nil and engineMeta[o.cardId]
      local mine = m and m.color == color and (m.zone == "command" or m.zone == "playable")
      local stand = o.cardId ~= nil and engineCastId(color, o.cardId)
      if o.cardId ~= nil and (l:find("^Cast ") or l:find("^Play ")) then
        if (engineInHand[o.cardId] and m and m.color == color) or mine then want[o.cardId] = true
        elseif engineObjs[stand] ~= nil then want[stand] = true end
      end
    end
    -- the engine offers one "Play Island" for three Islands: frame every copy in this player's hand
    local names = {}
    for id in pairs(want) do local st = engineStatic[id] if st and st.n then names[st.n] = true end end
    for id in pairs(engineInHand) do
      local st, meta = engineStatic[id], engineMeta[id]
      if st and names[st.n] and meta and meta.color == color and meta.zone == "hand" then want[id] = true end
    end
    -- and your permanents with an ability you can use now (the ability boxes' list, mana abilities left out there)
    for id in pairs(enginePermanentGlowIds(color)) do want[id] = true end
  end
  local shown = playableShown[color] or {}
  for id, obj in pairs(shown) do
    if not want[id] or engineObjs[id] ~= obj then
      if obj ~= nil and not obj.isDestroyed() then frameOn(obj, color, false) end
      shown[id] = nil
    end
  end
  local missing = false
  for id in pairs(want) do
    local obj = engineObjs[id]
    if shown[id] == nil and obj ~= nil and not obj.isDestroyed() then
      frameOn(obj, color, true)
      shown[id] = obj
    elseif obj == nil or obj.isDestroyed() then missing = true end
  end
  playableShown[color] = shown
  -- (a card drawn just now is still being made when the question arrives: it was never framed, playtest 2026-10-23)
  if missing and not playableRetry[color] then
    playableRetry[color] = true
    Wait.frames(function() playableRetry[color] = nil enginePlayableGlow(color) end, 30)
  end
end
playableRetry = {}
-- The permanents of yours that glow at your priority (SPEC.md "Green glow on permanents with a usable ability", the user
-- 2026-11-11): exactly the cards behind the question's ability options, engineAbilityWant (filled by engineAbilityBoxes
-- for this question, mana abilities and "Untap ... (mana back)" left out there). A token folded into a stack glows on
-- the stack's card; a phased-out card never glows. Only the controller's: engineAbilityBoxes lists only the cards on
-- this colour's own battlefield (engineMeta: whose battlefield, not whose card) when the question came, and a card
-- that changed sides under the open question stops glowing at the next board (engineMeta read again here).
function enginePermanentGlowIds(color)
  local out, board = {}, nil
  for id, w in pairs(engineAbilityWant or {}) do
    local rep = (engineGroupOf or {})[id] or id
    if w.color == color and (engineMeta[rep] or {}).color == color then
      -- (the board's cards by id, made once: engineAbilityCard looked through every battlefield for each card)
      if board == nil then
        board = {}
        for _, pl in ipairs((lastTable and lastTable.players) or {}) do
          for _, c in ipairs(pl.battlefield or {}) do board[c.id] = c end
        end
      end
      local c = board[rep]
      if c ~= nil and not c.po then out[rep] = true end
    end
  end
  return out
end
-- after every board: the hand may have changed under an open question
function enginePlayableGlowAll()
  for c in pairs(enginePrompts) do pcall(enginePlayableGlow, c) end
end
function engineToggleGlow(color)
  engineGlowOff[color] = not engineGlowOff[color] or nil
  enginePlayableGlow(color)
  return engineGlowOff[color] and "off" or "on"
end

-- ───────── setup buttons: Ready on each seat, Start in the middle (docs/game-modes-spec.md §6) ─────────
-- The same as typing "mtg ready" / "mtg start", for players who'd rather not type. Ready sits on each seated player's
-- playmat, near their life counter: yellow until their deck is checked, green when it's ready, red when the check
-- found a problem (the chat says what). Start sits on a small tile between the life counters: yellow until every
-- seated player is ready, then green, and anyone may press it. While a game runs both are hidden; after it ends the
-- middle button offers "New game" (anyone, as "mtg reset"). Only in engine mode.
do -- (its own scope: the main chunk is near the 200-locals limit of standard Lua, which the tests run on)
engineReadyState = {} -- colour -> "ready" | "problem" (from the bridge's deck report)
local SETUP = { tag = "mtgsetup", sig = nil, spawning = false, seats = { "White", "Red", "Yellow", "Blue" }, size = 2.5, tileW = 2.2, tileD = 1.5, -- (the tile fits the gap between the four life counters)
  color = { wait = {0.85, 0.68, 0.12}, go = {0.2, 0.68, 0.3}, bad = {0.78, 0.2, 0.18}, idle = {0.28, 0.33, 0.46} } }

local function setupTile()
  for _, o in ipairs(getObjects()) do if o.getGMNotes() == SETUP.tag then return o end end
  return nil
end

-- What the last drawing put where: the tile's label and, per seat, whether its mat has a READY button.
SETUP.drawn = { tile = nil, mats = {} }
function engineSetupIntact()
  local tile = setupTile()
  local want = SETUP.drawn.tile
  local have = tile ~= nil and (tile.getButtons() or {})[1] or nil
  if (want == nil) ~= (have == nil) or (have ~= nil and have.label ~= want) then return false end
  if SETUP.drawn.friendly and #((tile and tile.getButtons()) or {}) < 2 then return false end
  for c in pairs(SETUP.drawn.mats) do
    local mat = data[c] and data[c].playmat
    local any = false
    for _, b in ipairs((mat and mat.getButtons()) or {}) do if b.click_function == "onMtgSetupReady" then any = true end end
    if not any then return false end
  end
  return true
end
local function seatedSetupColors()
  local out = {}
  for _, c in ipairs(SETUP.seats) do if Player[c] ~= nil and Player[c].seated and data[c] and data[c].playmat then out[#out + 1] = c end end
  return out
end

-- one button on `obj` at world position `at`, readable from the seat `facing` (nil: as the object lies). tileTurn:
-- the button is on the middle tile, where real TTS draws a button's x mirrored and turned half a turn (2026-11-10: a
-- button meant at x -48 showed at x +48, upside down from White), so x is negated and tileTurn is its rotation there
-- (180 reads from the White/Red side, 90 is that turned a quarter left, seen from White)
local function setupButton(obj, click, label, color, at, facing, width, height, tileTurn)
  local s = obj.getScale()
  local rotY = tileTurn or 0
  if facing ~= nil then
    local hand = Player[facing].getHandTransform()
    rotY = ((hand and hand.rotation.y or 0) + 180) - obj.getRotation().y
  end
  local pos = obj.positionToLocal(at)
  if tileTurn ~= nil then pos.x = -pos.x end
  -- (the playmats and the tile are stretched objects: the scale undoes that, then makes the button readable from a
  -- seat. TTS stretches a button along its object's axes after turning it, so a quarter-turned one takes the other
  -- axis's stretch: live 2026-11-10, the 90-turned mulligan button's text ran off its box on the 2.2 x 1.5 tile)
  local sx, sz = s.x, s.z
  if tileTurn ~= nil and tileTurn % 180 == 90 then sx, sz = s.z, s.x end
  obj.createButton({ click_function = click, function_owner = Global, label = label, position = pos,
    rotation = { 0, rotY, 0 }, scale = { SETUP.size / sx, 1 / s.y, SETUP.size / sz }, width = width or 1300, height = height or 420, font_size = 220,
    color = color, font_color = { 1, 1, 1 }, tooltip = "" })
end

function engineDeckReport(m)
  local ok = {}
  for _, c in ipairs(m.ready or {}) do ok[c] = true end
  for _, c in ipairs(m.checked or m.ready or {}) do engineReadyState[c] = ok[c] and "ready" or "problem" end
  engineSetupButtons()
end

function engineSetupButtons()
  local game = engineTable ~= nil and engineTable() or nil
  local running = game ~= nil and not game.gameOver
  local seated = seatedSetupColors()
  local ready = 0
  for _, c in ipairs(seated) do if engineReadyState[c] == "ready" then ready = ready + 1 end end
  local over = game ~= nil and game.gameOver
  -- only when something changed (buttons on objects are synced to every player)
  local alive = {}
  for _, pl in ipairs((game and game.players) or {}) do if pl.status == "playing" then alive[#alive + 1] = tostring(pl.color) end end
  table.sort(alive)
  local sig = table.concat({ tostring(ENGINE_MODE), tostring(running), tostring(over), table.concat(seated, ","), tostring(ready), table.concat(alive, ","),
    (function() local p = {} for _, c in ipairs(seated) do p[#p + 1] = tostring(engineReadyState[c]) end return table.concat(p, ",") end)(), tostring(engineFriendly) }, "|")
  -- (unchanged, and the buttons are still there: TTS's own scripts or a reload can wipe an object's buttons, and after a
  -- game ended the READY buttons and the middle tile stayed gone or stale, "Engine: off" with engine mode on, playtest
  -- 2026-10-24; engineSetupHeal below looks every 2 s)
  if sig == SETUP.sig and engineSetupIntact() then return end
  SETUP.sig = sig
  SETUP.drawn = { tile = nil, mats = {} }
  for _, c in ipairs(SETUP.seats) do
    local mat = data[c] and data[c].playmat
    if mat ~= nil then mat.clearButtons() end
  end
  local tile = setupTile()
  if tile ~= nil then tile.clearButtons() end
  if engineTableButtons ~= nil then
    engineTableButtons(function(c) return ENGINE_MODE and c ~= nil and engineReadyState[c] == "ready" end)
  end
  if tile == nil then
    if not SETUP.spawning then
      SETUP.spawning = true
      spawnObject({ type = "BlockSquare", position = { 0, 0.95, 0 }, scale = { SETUP.tileW, 0.08, SETUP.tileD }, callback_function = function(o)
        SETUP.spawning = false
        o.setLock(true)
        o.setGMNotes(SETUP.tag)
        o.setName("MTG game setup")
        o.setColorTint({ 0.08, 0.1, 0.14 })
        SETUP.sig = nil
        engineSetupButtons()
      end })
    end
  end
  if tile ~= nil and math.abs(tile.getScale().x - SETUP.tileW) > 0.01 then tile.setScale({ SETUP.tileW, 0.08, SETUP.tileD }) end -- (an older, bigger tile)
  if tile ~= nil and tile.getPosition().y < -10 then tile.setPosition({ 0, 0.95, 0 }) end -- (an older tile kept under the table)
  if not ENGINE_MODE then
    if tile ~= nil then
      SETUP.drawn.tile = "Engine: off"
      tile.createButton({ click_function = "onMtgSetupEngine", function_owner = Global, label = "Engine: off", position = { 0, 0.6, 0 },
        rotation = { 0, 0, 0 }, scale = { 1 / SETUP.tileW, 1, 1 / SETUP.tileD }, width = 1100, height = 720, font_size = 260,
        color = SETUP.color.idle, font_color = { 1, 1, 1 }, tooltip = "Turn the rules engine on (anyone)" })
    end
    return
  end
  if not running and not over then
    for _, c in ipairs(seated) do
      local mat = data[c].playmat
      local st = engineReadyState[c]
      local life = LIFE_TRACKERS[c] and getObjectFromGUID(LIFE_TRACKERS[c])
      local m = mat.getPosition()
      local toward = life and life.getPosition() or Vector(0, m.y, 0)
      -- below the Draw button (further from the playmat, toward the player); without one, toward the life counter
      local spot = engineDrawButtonSpot ~= nil and engineDrawButtonSpot(c) or nil
      local at = m + (toward - m) * 0.62 + Vector(0, 0.2, 0)
      local away = spot ~= nil and Vector(spot.x - m.x, 0, spot.z - m.z) or Vector(at.x - m.x, 0, at.z - m.z)
      local len = math.sqrt(away.x ^ 2 + away.z ^ 2)
      local step = len > 0 and away * (1.4 / len) or Vector(0, 0, 0)
      if spot ~= nil then at = spot + step end
      SETUP.drawn.mats[c] = true
      setupButton(mat, "onMtgSetupReady", st == "ready" and "READY" or (st == "problem" and "FIX DECK" or "READY?"),
        st == "ready" and SETUP.color.go or (st == "problem" and SETUP.color.bad or SETUP.color.wait), at, c)
    end
  end
  if tile ~= nil then
    local label, color, click = nil, nil, "onMtgSetupStart"
    if over then label, color = "New game", SETUP.color.idle
    elseif running then label = nil
    elseif #seated > 0 and ready == #seated then label, color = "Start", SETUP.color.go
    else label, color, click = "Engine: on", SETUP.color.idle, "onMtgSetupEngine" end -- (Start appears once all are ready)
    if label ~= nil then
      SETUP.drawn.tile = label
      tile.createButton({ click_function = click, function_owner = Global, label = label, position = { 0, 0.6, 0 },
        rotation = { 0, 0, 0 }, scale = { 1 / SETUP.tileW, 1, 1 / SETUP.tileD }, width = 1100, height = 720,
        font_size = #label > 6 and 260 or 400, color = color, font_color = { 1, 1, 1 }, tooltip = "" })
    end
    -- (after the middle button: engineSetupIntact reads the tile's first button)
    if not running and not over then
      SETUP.drawn.friendly = true
      setupButton(tile, "onMtgSetupFriendly", engineFriendlyLabel(), SETUP.color.wait, FRIENDLY_SPOT, nil, 1700, 620, 90)
    end
  end
  engineScoopRedraw()
end

-- Scoop: each seated player still in the game sees it beside their name at the top (screen UI). Also called after
-- the screen UI is rebuilt (a game start seats players): the rebuilt XML starts with it hidden, and attributes set
-- while TTS is still loading new XML are lost.
function engineScoopRedraw()
  local game = engineTable ~= nil and engineTable() or nil
  local running = ENGINE_MODE and game ~= nil and not game.gameOver
  for _, c in ipairs(SETUP.seats) do
    local show = false
    if running and Player[c] ~= nil and Player[c].seated then
      for _, pl in ipairs(game.players or {}) do if pl.color == c and pl.status == "playing" then show = true end end
    end
    -- (through setAttr: shown with a plain UI.setAttribute, its label was drawn dark red on red, 2026-11-10 screenshots)
    setAttr("eng_scoop_" .. c, "active", show and "true" or "false")
    if not show then UI.setAttribute("eng_scoopask_" .. c, "active", "false") end
  end
end

-- Engine mode on/off from the middle button (anyone, seated or not, as "mtg engine on/off")
function onMtgSetupEngine(obj, playerColor)
  local pl = Player[playerColor]
  if pl ~= nil then engineChat(ENGINE_MODE and "mtg engine off" or "mtg engine on", pl) end
end

-- Scoop: the button opens the "Concede this game?" box; Scoop there concedes (each player sees only their own)
function onMtgScoopAsk(player, value, id)
  if id == "eng_scoop_" .. player.color then UI.setAttribute("eng_scoopask_" .. player.color, "active", "true") end
end
function onMtgScoopYes(player, value, id)
  if id ~= "eng_scoopyes_" .. player.color then return end
  UI.setAttribute("eng_scoopask_" .. player.color, "active", "false")
  engineSend("concede", { color = player.color })
end
function onMtgScoopNo(player, value, id)
  if id == "eng_scoopno_" .. player.color then UI.setAttribute("eng_scoopask_" .. player.color, "active", "false") end
end

function onMtgSetupReady(obj, playerColor)
  local c = nil
  for _, col in ipairs(SETUP.seats) do if data[col] and data[col].playmat == obj then c = col end end
  if c == nil then return end
  if playerColor ~= c then
    broadcastToColor("[MTG] That's " .. c .. "'s Ready button. Use the one on your own playmat.", playerColor, { 1, 0.65, 0.2 })
    return
  end
  if engineReadyState[c] == "ready" then -- pressed again: not ready any more (the table buttons come back)
    engineReadyState[c] = nil
    return engineSetupButtons()
  end
  engineChat("mtg ready", Player[c])
end

-- Friendly mulligans: ONE count for the whole table (none, 1, 2, none...), the free mulligans each player has in
-- all, the rules' multiplayer free one included (2026-11-10: "one button be the answer for everyone and anyone can
-- click it"; "have it be one button"). One button, on the rim where the Pirate Cannon (540e21) sits outside engine
-- mode (it's hidden in engine mode, the only time this button shows), turned a quarter left from White ("turn it 90
-- left away from the camera, have it sit where the cannon would be"). Start sends the count. A rematch keeps it; a
-- table reload clears it.
engineFriendly = 0
FRIENDLY_SPOT = Vector(-60, 1.1, 0) -- (the cannon's saved home, its memo "mtghome -60.000 0.732 0.000")
function engineFriendlyLabel()
  return "Free mulligans\n" .. (engineFriendly == 0 and "None" or tostring(engineFriendly))
end
-- n: 0, 1 or 2; pl: who set it (everyone is told)
function engineSetFriendly(n, pl)
  engineFriendly = n
  local who = pl ~= nil and (pl.steam_name or pl.color) or "Someone"
  broadcastToAll("[MTG] " .. tostring(who) .. " set free mulligans for everyone: "
    .. (n == 0 and "none" or string.format("%d each", n) .. " (the rules' free one in a 3+ player game included)") .. ".", { 1, 0.85, 0.4 })
  engineSetupButtons()
end
function onMtgSetupFriendly(obj, playerColor)
  engineSetFriendly((engineFriendly + 1) % 3, Player[playerColor])
end

function onMtgSetupStart(obj, playerColor)
  local game = engineTable ~= nil and engineTable() or nil
  local pl = Player[playerColor]
  if pl == nil then return end
  if game ~= nil and game.gameOver then
    engineKeepEngineMode = true -- (back to READY, engine mode stays on)
    engineChat("mtg reset", pl) -- (as typed: anyone once the game is over)
    return
  end
  if game ~= nil then return end
  local seated = seatedSetupColors()
  for _, c in ipairs(seated) do
    if engineReadyState[c] ~= "ready" then
      broadcastToColor("[MTG] Waiting for " .. c .. " to press READY.", playerColor, { 1, 0.85, 0.4 })
      return
    end
  end
  if #seated == 0 then return end
  engineStartGame(pl, #seated == 1 and "ai 1" or "")
end

function onPlayerChangeColor(color)
  if engineSetupButtons ~= nil then engineSetupButtons() end
end
-- on load (engine mode is off then): the middle tile with its engine switch
Wait.frames(function() if engineSetupButtons ~= nil then pcall(engineSetupButtons) end end, 60)
-- and every 2 s while no game is running: buttons wiped or left from another state are drawn again
Wait.time(function()
  local t = engineTable ~= nil and engineTable() or nil
  if t == nil or t.gameOver then pcall(engineSetupButtons) end
end, 2, -1)

-- ───────── manual fix by vote (PLAN M7, docs/m7-manual-fix-spec.md) ─────────
-- The bridge sends `fix` = { id, state, by, waiting, lines, message } with the board while a fix is under way
-- (voting -> pausing -> editing -> review -> applying). While the engine is paused (editing, review, applying) the
-- table holds its board: nothing snaps back, and in editing every seated player may pick up, turn and flip any
-- engine card. A card dropped on a pile or the library pops back out and lies there, so every moved card is a loose
-- card whose area (dropArea) says where it went. Done reads the cards that were touched and sends the change list;
-- numbers (life, poison, counters) are set by chat:  mtg fix life blue 31 / mtg fix poison red 2 /
-- mtg fix counters +1/+1 3  (the card under your pointer). When the fix ends the next board is drawn as usual: the
-- engine's new one after an apply, the old one after Cancel (everything goes back where it was).
-- Once paused, the panel first asks which kind of fix (§12): "Edit the board" is the above; "Fix from hand" keeps the
-- cards locked and lists each player's hand in their Engine panel instead (see "fix from hand" below).
engineFix = nil
engineFixTouched = {}  -- engine card id -> true: picked up, turned, flipped or taken from a pile while editing
engineFixExtra = {}    -- key -> op, from the chat commands
engineFixBottom = {}   -- engine card id -> true: "Put on the bottom of the library" (right-click) while editing
ENGINE_FIX_EDIT = false -- (read by the life and commander-damage counters' scripts: they work again while editing)
FIX_HOLD = { editing = true, review = true, applying = true }
do
  local F = { sig = nil }
  function engineFixXml(c)
    return '<Button id="eng_fixcall_' .. c .. '" onClick="onMtgFix" visibility="' .. c .. '" width="64" height="30" rectAlignment="UpperLeft" offsetXY="622 -140" color="#1A1A1A" textColor="#ffffff" fontSize="14" active="false">Fix...</Button>\n'
      .. '<Panel id="eng_fixp_' .. c .. '" visibility="' .. c .. '" width="660" height="270" rectAlignment="UpperCenter" offsetXY="0 -250" color="#161616F0" active="false">'
      .. '<Text id="eng_fixtext_' .. c .. '" width="640" height="200" rectAlignment="UpperCenter" offsetXY="0 -8" fontSize="17" resizeTextForBestFit="true" resizeTextMinSize="11" resizeTextMaxSize="17" color="#FFFFFF" alignment="UpperCenter"> </Text>'
      .. '<HorizontalLayout width="560" height="40" rectAlignment="LowerCenter" offsetXY="0 10" spacing="16" childForceExpandWidth="true">'
      .. '<Button id="eng_fixbyes_' .. c .. '" onClick="onMtgFix" color="#2e7d32" textColor="#ffffff" fontSize="18" fontStyle="Bold" active="false">Yes</Button>'
      -- (the kind question's second answer, "Edit the board": §12)
      .. '<Button id="eng_fixbk_' .. c .. '" onClick="onMtgFix" color="#2e3a59" textColor="#ffffff" fontSize="18" fontStyle="Bold" active="false">Edit the board</Button>'
      .. '<Button id="eng_fixbno_' .. c .. '" onClick="onMtgFix" color="#8e2a2a" textColor="#ffffff" fontSize="18" fontStyle="Bold" active="false">No</Button>'
      .. '</HorizontalLayout></Panel>\n'
  end
  function F.waitingFor(fix, c) return heldIn((fix and fix.waiting) or {}, c) end
  -- the engine card id of a card object (not a pile or the library deck), or nil
  function F.cardId(o) return o ~= nil and tostring(o.getGMNotes()):match("^engine:(engine%-card%-%d+)$") or nil end
  -- Which kind of fix (§12): "hand" (fix from hand: the cards stay locked, each player picks free plays from their own
  -- hand and permanents in their Engine panel) or "board" (edit the board, as above); nil until someone picks one.
  -- The bridge's `fix.kind` wins; else the pick made on this table (F.kind, for that fix id).
  function F.kindOf(fix)
    if fix == nil then return nil end
    if fix.kind == "hand" or fix.kind == "board" then return fix.kind end
    if F.kind ~= nil and F.kind.id == fix.id then return F.kind.kind end
    return nil
  end
  function F.paused() return engineFix ~= nil and engineFix.state == "editing" end
  -- editing the board: engine cards unlocked, moves read back at Done
  function F.editing() return F.paused() and F.kindOf(engineFix) == "board" end
  -- the panel's text and its buttons for one seat: text, yes, no, and the kind question's "Edit the board"
  function engineFixPanel(fix, c)
    local mine = F.waitingFor(fix, c)
    local who = tostring(fix.by or "A player")
    local waits = (#(fix.waiting or {}) > 0 and not mine) and ("\nWaiting for " .. table.concat(fix.waiting, ", ") .. "...") or ""
    local lines = (fix.lines and #fix.lines > 0) and ("\n- " .. table.concat(fix.lines, "\n- ")) or ""
    local s = fix.state
    if s == "voting" then return who .. " asks to pause the game for a manual fix." .. waits, mine and "Pause" or nil, mine and "Keep playing" or "Cancel"
    elseif s == "pausing" then return "Manual fix: waiting for a moment with nothing on the stack...", nil, "Cancel"
    elseif s == "editing" then
      local refused = fix.message and ("\nThe engine refused the last list: " .. tostring(fix.message)) or ""
      local kind = F.kindOf(fix)
      if kind == nil then
        return "MANUAL FIX - the engine is paused. Which kind of fix?\n- Fix from hand: cast, activate or play cards from your hand for free (or activate your own permanents), or put a hand card into your graveyard. The cards on the table stay locked.\n- Edit the board: move, turn and flip the engine's cards by hand."
          .. refused, "Fix from hand", "Cancel", "Edit the board"
      elseif kind == "hand" then
        return "FIX FROM HAND - the engine is paused.\nPick what should have happened in your Engine panel, then press Done. Nothing happens until everyone agrees. A note for the log: the panel's box, or  mtg fix note <text>."
          .. F.listText() .. refused, "Done", "Cancel"
      end
      return "MANUAL FIX - the engine is paused.\nMove cards to where they belong (battlefield, graveyard, exile, library, hand, command zone), turn them to tap or untap, flip them face down, drop an aura or equipment onto its permanent, right-click for the library's top or bottom. Life and commander damage: their counters. Also: mtg fix poison red 2 / mtg fix counters +1/+1 3 (the card under your pointer) / mtg fix token treasure."
        .. refused, "Done", "Cancel"
    elseif s == "review" then return who .. " wants to apply these changes:" .. lines .. waits, mine and "Apply" or nil, mine and "Not yet" or "Cancel"
    elseif s == "applying" then return "Applying the changes..." .. lines, nil, nil end
    return "", nil, nil
  end
  function engineFixUpdate(fix)
    local entering = fix ~= nil and fix.state == "editing" and (engineFix == nil or engineFix.state ~= "editing")
    -- (a new fix starts with an empty pick list and no notes)
    if (fix and fix.id) ~= F.picksFor then F.handReset(fix and fix.id) end
    engineFix = fix
    if fix == nil then engineFixTouched, engineFixExtra = {}, {} end
    local leaving = fix == nil and F.menued ~= nil
    -- editing the board (not the kind question, not a fix from hand: the cards stay locked then)
    local board = fix ~= nil and fix.state == "editing" and F.kindOf(fix) == "board"
    local unlock = board and not F.unlocked
    F.unlocked = board
    ENGINE_FIX_EDIT = board
    -- "mtg mana <n>" called this fix: add the mana and press Done for its caller (only right after the call)
    local auto = entering and fix.by ~= nil and engineAutoMana ~= nil and engineAutoMana[fix.by] or nil
    if auto ~= nil then
      engineAutoMana[fix.by] = nil
      if os.clock() - auto.at < 30 then
        local by = fix.by
        Wait.frames(function() if F.paused() then engineFixSet(by, "mana " .. auto.rest) engineFixDone(by) end end, 2)
      end
    end
    if unlock then
      -- (engine cards lie locked; piles and the library stay locked: search them to take a card out). A right-click
      -- puts a card on top of or under its library.
      F.menued = F.menued or {}
      for id, o in pairs(engineObjs) do
        if o ~= nil and not o.isDestroyed() and o.type == "Card" and tostring(id):find("^engine%-card%-") then
          o.setLock(false)
          for _, where in ipairs({ "top", "bottom" }) do
            o.addContextMenuItem(where == "top" and "Fix: top of its library" or "Fix: bottom of its library", function(playerColor)
              if not F.editing() or not engineColors[playerColor] then return end
              local meta = engineMeta[id] or {}
              local d = data[meta.color or playerColor]
              if d == nil or d.libraryZone == nil or o.isDestroyed() then return end
              engineFixTouched[id] = true
              engineFixBottom[id] = where == "bottom" or nil
              o.setPosition(d.libraryZone.getPosition() + Vector(0, 2, 0))
            end)
          end
          F.menued[#F.menued + 1] = o
        end
      end
    end
    if leaving then
      for _, o in ipairs(F.menued) do if o ~= nil and not o.isDestroyed() then o.clearContextMenu() end end
      F.menued = nil
      engineFixBottom = {}
      -- (a life or commander-damage counter turned during the fix shows the engine's number again by itself: the
      -- board after the fix is drawn as usual, and updateTrackers sets every counter that differs)
    end
    local over = lastTable == nil or lastTable.gameOver
    local sig = table.concat({ tostring(over), fix and table.concat({ tostring(fix.id), tostring(fix.state), tostring(fix.by),
      table.concat(fix.waiting or {}, ","), table.concat(fix.lines or {}, ","), tostring(fix.message), tostring(F.kindOf(fix)), F.ver }, "|") or "-" }, ";")
    if sig == F.sig then return end
    F.sig = sig
    for c in pairs(engineColors) do
      if Player[c] ~= nil and Player[c].seated then
        setAttr("eng_fixcall_" .. c, "active", (fix == nil and not over) and "true" or "false")
        setAttr("eng_fixp_" .. c, "active", fix ~= nil and "true" or "false")
        if fix ~= nil then
          local text, yes, no, alt = engineFixPanel(fix, c)
          setText("eng_fixtext_" .. c, text)
          setAttr("eng_fixbyes_" .. c, "active", yes and "true" or "false")
          if yes then setText("eng_fixbyes_" .. c, yes) end
          setAttr("eng_fixbk_" .. c, "active", alt and "true" or "false")
          setAttr("eng_fixbno_" .. c, "active", no and "true" or "false")
          if no then setText("eng_fixbno_" .. c, no) end
        end
      end
    end
    -- a fix from hand lists each player's hand in their Engine panel (engineFixHandDraw); it goes back to its
    -- questions when the fix moves on
    if panelReady then
      local on = F.handMode()
      for c in pairs(engineColors) do
        if (on or F.handOn[c]) and Player[c] ~= nil and Player[c].seated and data[c] ~= nil then updatePanel(c) updateOptions(c) end
      end
    end
  end
  function engineFixRedraw()
    F.sig = nil
    engineFixUpdate(engineFix)
  end
  function onMtgFix(player, value, id)
    local c = player.color
    local fix = engineFix
    local choosing = fix ~= nil and fix.state == "editing" and F.kindOf(fix) == nil
    if id == "eng_fixcall_" .. c then engineSend("fix", { color = c, action = "call" })
    elseif id == "eng_fixbk_" .. c and choosing then F.choose(c, "board")
    elseif id == "eng_fixbyes_" .. c and fix ~= nil then
      if choosing then F.choose(c, "hand")
      elseif fix.state == "editing" then engineFixDone(c)
      elseif F.waitingFor(fix, c) then engineSend("fix", { color = c, action = "vote", accept = true }) end
    elseif id == "eng_fixbno_" .. c and fix ~= nil then
      if F.waitingFor(fix, c) then engineSend("fix", { color = c, action = "vote", accept = false })
      else engineSend("fix", { color = c, action = "cancel" }) end
    end
  end
  -- Where a loose engine card is now: a hand (either hand zone), else the first seat whose area holds it.
  function engineFixWhere(o)
    for c in pairs(engineColors) do
      if Player[c] ~= nil and (isInHand(o, c, 1) or isInHand(o, c, 2)) then return "hand", c end
    end
    local pos = o.getPosition()
    for c in pairs(engineColors) do
      local area = dropArea(c, pos)
      if area ~= "elsewhere" then return area, c end
    end
    return nil, nil
  end
  -- The change list from the touched cards: { ops } or { unplaced = names }.
  function engineFixRead()
    local before = {}
    for _, pl in ipairs((lastTable and lastTable.players) or {}) do
      for _, z in ipairs({ "hand", "battlefield", "graveyard", "exile", "command" }) do
        for _, c in ipairs(pl[z] or {}) do before[c.id] = { zone = z, color = pl.color, tap = c.tap and true or false, fd = c.fd and true or false, att = c.att } end
      end
    end
    local now, posOf = {}, {}
    for _, o in ipairs(getObjects()) do
      local gm = tostring(o.getGMNotes())
      local id = F.cardId(o)
      local pz, pc = gm:match("^engine:(%a+):(%a+)$")
      if id ~= nil and o.type == "Card" then posOf[id] = o.getPosition() end
      if id ~= nil and engineFixTouched[id] and before[id] ~= nil and o.type == "Card" then
        local zone, color = engineFixWhere(o)
        local planned, p = enginePlanned[id], o.getPosition()
        local kept = planned ~= nil and (p.x - planned.x) ^ 2 + (p.z - planned.z) ^ 2 < 1.0
        if kept then zone, color = before[id].zone, before[id].color end
        local tapped = false
        if zone == "battlefield" then
          local g = seatGeometry(color)
          local rel = ((o.getRotation().y - (g and g.rotY or 0)) % 360 + 360) % 360
          tapped = (rel > 45 and rel < 135) or (rel > 225 and rel < 315)
        end
        now[id] = { zone = zone, color = color, tap = tapped, fd = o.is_face_down and true or false, name = tostring(o.getName()):match("^[^\n]*"), kept = kept }
      elseif (pz == "graveyard" or pz == "exile") and o.type == "Deck" then
        for _, e in ipairs(o.getObjects() or {}) do
          local eid = tostring(e.gm_notes):match("^engine:(engine%-card%-%d+)$")
          if eid ~= nil and engineFixTouched[eid] and before[eid] ~= nil then now[eid] = { zone = pz, color = pc, tap = false, fd = before[eid].fd } end
        end
      end
    end
    -- a card dropped onto another permanent (overlapping it) goes on that permanent
    for id, n in pairs(now) do
      if n.zone == "battlefield" and not n.kept then
        local best, bestD = nil, 1.3 ^ 2
        for hid, hp in pairs(posOf) do
          local hb = before[hid]
          if hid ~= id and hb ~= nil and hb.zone == "battlefield" and (now[hid] == nil or now[hid].zone == "battlefield") then
            local d = (hp.x - posOf[id].x) ^ 2 + (hp.z - posOf[id].z) ^ 2
            if d < bestD then best, bestD = hid, d end
          end
        end
        n.host = best
      end
    end
    local ops, unplaced = {}, {}
    local ids = {}
    for id in pairs(now) do ids[#ids + 1] = id end
    table.sort(ids, function(a, b) return (tonumber(a:match("%d+$")) or 0) < (tonumber(b:match("%d+$")) or 0) end)
    for _, id in ipairs(ids) do
      local b, n = before[id], now[id]
      if n.zone == nil then unplaced[#unplaced + 1] = n.name or id
      else
        if n.zone ~= b.zone or (n.zone == "library" and engineFixBottom[id]) then
          local op = { op = "move", card = id, zone = n.zone }
          if n.zone == "library" and engineFixBottom[id] then op.position = "bottom" end
          ops[#ops + 1] = op
        end
        if n.zone == "battlefield" and n.host ~= nil and n.host ~= b.att then ops[#ops + 1] = { op = "attach", card = id, to = n.host }
        elseif n.zone == "battlefield" and n.host == nil and b.att ~= nil and not n.kept then ops[#ops + 1] = { op = "attach", card = id } end
        if n.zone == "battlefield" and n.color ~= b.color then ops[#ops + 1] = { op = "control", card = id, player = n.color } end
        if n.zone == "battlefield" and n.tap ~= (b.zone == "battlefield" and b.tap) then ops[#ops + 1] = { op = "tap", card = id, tapped = n.tap } end
        if n.zone ~= "hand" and n.zone ~= "library" and n.zone ~= "graveyard" and n.fd ~= b.fd then ops[#ops + 1] = { op = "faceDown", card = id, value = n.fd } end
      end
    end
    -- the table's own counters, turned while editing (a number typed by chat wins over its counter)
    for _, pl in ipairs((lastTable and lastTable.players) or {}) do
      local c = pl.color
      local lt = c and getObjectFromGUID(LIFE_TRACKERS[c] or "")
      local life = lt and tonumber(lt.getVar("count"))
      if life ~= nil and pl.life ~= nil and life ~= pl.life and life >= 0 and engineFixExtra["life:" .. c] == nil then
        ops[#ops + 1] = { op = "life", player = c, n = math.floor(life) }
      end
      for from, guid in pairs((c and CMD_DAMAGE[c]) or {}) do
        local o = getObjectFromGUID(guid)
        local v = o and tonumber(o.getVar("val"))
        if v ~= nil and v >= 0 and v ~= ((pl.cmdDamage or {})[from] or 0) and engineColors[from] then
          ops[#ops + 1] = { op = "commanderDamage", player = c, from = from, n = math.floor(v) }
        end
      end
    end
    return F.extraOps(ops), unplaced
  end
  -- the chat numbers (life, poison, counters, tokens, mana) after the other ops, sorted by key
  function F.extraOps(ops)
    local keys = {}
    for k in pairs(engineFixExtra) do keys[#keys + 1] = k end
    table.sort(keys)
    for _, k in ipairs(keys) do ops[#ops + 1] = engineFixExtra[k] end
    return ops
  end
  -- Done: the change list to the bridge, { color, action = "done", ops, kind?, notes? } (kind: "hand" or "board" once
  -- picked; notes: { { color, text } } from mtg fix note / the panel's box, never ops). A fix from hand sends its picks
  -- in list order, then the chat numbers; editing the board sends what the touched cards read back.
  function engineFixDone(color)
    local kind = F.kindOf(engineFix)
    local ops, unplaced
    if kind == "hand" then ops, unplaced = F.handOps(), {}
    else ops, unplaced = engineFixRead() end
    if #unplaced > 0 then
      tell(color, "Not in any zone: " .. table.concat(unplaced, ", ") .. ". Put each on a battlefield, graveyard, exile, library, hand or command zone first.")
      return
    end
    if #ops == 0 then
      tell(color, kind == "hand" and "Nothing picked yet: pick what should have happened in your Engine panel first (or press Cancel)."
        or "Nothing was changed yet. Move some cards first (or press Cancel).")
      return
    end
    local msg = { color = color, action = "done", ops = ops }
    if kind ~= nil then msg.kind = kind end
    local notes = F.noteList()
    if #notes > 0 then msg.notes = notes end
    engineSend("fix", msg)
  end
  F.KINDS = (function() local t = {} for key, label in pairs(COUNTER_NAMES) do t[label:lower()] = key end return t end)()
  -- mtg fix life <colour> <n> / poison <colour> <n> / counters <kind> <n> (hovered card)
  function engineFixSet(color, rest)
    if not F.paused() then tell(color, "The game isn't paused for a fix.") return end
    -- mtg fix note <text>: what should have happened, for the log (any kind of fix; an empty one removes it)
    if rest == "note" or rest:find("^note%s") then F.setNote(color, rest:sub(5), true) return end
    -- mtg fix token <what> [for <colour>] [tapped]
    local what0, body = rest:match("^(%a+)%s+(.+)$")
    if what0 == "token" then
      local tapped = body:find("%f[%a]tapped%f[%A]") ~= nil
      body = body:gsub("%f[%a]tapped%f[%A]", "")
      -- (the leftmost "for <who>" that ends the text, by an unanchored find: "^(.-)%s+for..." raised "pattern too
      -- complex" in TTS on 99+ characters, tmp/pattern-trap/audit.md)
      local forAt, _, forWho = body:find("%s+for%s+(%a+)%s*$")
      local name = forAt ~= nil and body:sub(1, forAt - 1) or nil
      local who = color
      if forWho ~= nil then
        who = nil
        for c in pairs(engineColors) do if c:lower() == forWho:lower() then who = c end end
        if who == nil then tell(color, "No player " .. forWho .. ".") return end
      end
      name = (name or body):gsub("^%s+", ""):gsub("%s+$", "")
      if name == "" then tell(color, "Use:  mtg fix token treasure  (or  mtg fix token 1/1 green saproling for red tapped)") return end
      F.tokens = (F.tokens or 0) + 1
      engineFixExtra[string.format("token:%03d", F.tokens)] = { op = "createToken", script = name, player = who, tapped = tapped }
      tell(color, "New token for " .. engineSeatName(who) .. ": " .. name .. (tapped and ", tapped" or "") .. " (press Done to list the changes).")
      return
    end
    -- mtg fix mana <n> [for <colour>]: n of each colour (W U B R G and colourless) that stays in the pool through the
    -- steps until the end of the turn (Forge's persistent mana; 2026-10-26, for testing against a harmless AI: "99 mana")
    if what0 == "mana" then
      local k, forWho = body:match("^(%d+)%s*for%s+(%a+)%s*$")
      k = tonumber(k or body:match("^(%d+)%s*$") or "")
      local who = color
      if forWho ~= nil then
        who = nil
        for c in pairs(engineColors) do if c:lower() == forWho:lower() then who = c end end
      end
      if k == nil or k < 1 or k > 99 or who == nil then tell(color, "Use:  mtg fix mana <1-99> [for <colour>]  (that many of each colour)") return end
      local syms = {}
      for _, m in ipairs({ "W", "U", "B", "R", "G", "C" }) do for _ = 1, k do syms[#syms + 1] = m end end
      engineFixExtra["mana:" .. who] = { op = "mana", player = who, mana = table.concat(syms, " ") }
      tell(color, engineSeatName(who) .. " gets " .. k .. " of each colour until the end of the turn (press Done to list the changes).")
      return
    end
    local what, a, n = rest:match("^(%a+)%s+(%S+)%s+(%d+)$")
    n = tonumber(n or "")
    if what == "life" or what == "poison" then
      local who = nil
      for c in pairs(engineColors) do if c:lower() == tostring(a):lower() then who = c end end
      if who == nil or n == nil then tell(color, "Use:  mtg fix " .. what .. " <colour> <number>") return end
      engineFixExtra[what .. ":" .. who] = { op = what, player = who, n = n }
      tell(color, engineSeatName(who) .. "'s " .. what .. " will be " .. n .. " (press Done to list the changes).")
    elseif what == "counters" then
      local o = Player[color] ~= nil and Player[color].getHoverObject() or nil
      local id = F.cardId(o)
      if id == nil or n == nil then tell(color, "Point at a card and type  mtg fix counters +1/+1 3") return end
      local kind = F.KINDS[tostring(a):lower()] or tostring(a):upper():gsub("[^%w]", "_")
      engineFixExtra["counters:" .. id .. ":" .. kind] = { op = "counters", card = id, kind = kind, n = n }
      tell(color, o.getName() .. ": " .. n .. " " .. tostring(a) .. " counter(s) (press Done to list the changes).")
    else
      tell(color, "Use:  mtg fix life <colour> <n>,  mtg fix poison <colour> <n>,  mtg fix counters <kind> <n>,  mtg fix token <what> [for <colour>],  mtg fix mana <n> [for <colour>],  mtg fix note <text>")
    end
  end
  -- ───── fix from hand (§12): each player's Engine panel (eng_panel_, free while the engine is paused: the screen UI
  -- has no room for a panel of its own, 4 seats are at ~58 of 60 KB) lists their own hand, and their permanents with an
  -- activated ability, with Cast free / Activate free / Play land / To graveyard. A pick only joins the list: one per
  -- card, shared by everyone, in the order things happen; its owner moves it up or down or takes it out. Done sends the
  -- list as ops (freeCast / freeActivate / freeLand with the player's colour, move to the graveyard); the notes go
  -- beside the ops. The bridge words the lines for the vote and maps colours to slots (tmp/fix-from-hand-table.md).
  F.picks, F.notes, F.sel, F.page, F.rows, F.handOn, F.ver = {}, {}, {}, {}, {}, {}, 0
  F.OP = { cast = "freeCast", activate = "freeActivate", land = "freeLand" }
  F.ACT = { cast = "Cast free", activate = "Activate free", land = "Play land", grave = "To graveyard" }
  F.WORDS = {
    cast = function(who, name) return who .. " casts " .. name .. " for free" end,
    activate = function(who, name) return who .. " activates " .. name .. "'s ability for free" end,
    land = function(who, name) return who .. " plays " .. name .. " for free (the land drop stays unused)" end,
    grave = function(who, name) return who .. " puts " .. name .. " into their graveyard (no effect)" end,
  }
  -- the keywords of activated abilities that work from a hand / on the battlefield (a line of the text starts with one)
  F.HAND_WORDS = { "cycling", "ninjutsu", "commander ninjutsu", "channel", "forecast", "transmute", "bloodrush", "reinforce" }
  F.BF_WORDS = { "equip", "fortify", "level up", "outlast", "crew", "reconfigure" }
  function F.handMode() return F.paused() and F.kindOf(engineFix) == "hand" end
  -- (updatePanel asks) this seat's Engine panel shows the hand list
  function engineFixHandWants(c) return F.handMode() and engineColors[c] ~= nil end
  function F.handReset(id)
    F.picks, F.notes, F.sel, F.page, F.picksFor = {}, {}, {}, {}, id
    -- (the kind picked here, for another fix: fix ids start at 1 again in the next game, and its first fix would
    -- skip the kind question)
    if F.kind ~= nil and F.kind.id ~= id then F.kind = nil end
    F.ver = F.ver + 1
  end
  function F.choose(c, kind)
    if not engineColors[c] or engineFix == nil then return end
    F.kind = { id = engineFix.id, kind = kind }
    engineSend("fix", { color = c, action = "kind", kind = kind })
    engineFixRedraw()
  end
  -- a card's text as lines, reminder text left out ("Cycling {2} ({2}, Discard this card: Draw a card.)")
  function F.lines(card)
    local out = {}
    for line in (tostring(card.ct or card.tx or "") .. "\n"):gmatch("([^\n]*)\n") do out[#out + 1] = (line:gsub("%b()", "")) end
    return out
  end
  -- "cost: effect" split at the first colon, nil without one (a plain find: TTS's Lua raises "pattern too complex"
  -- when a pattern such as "^([^:]*):" fails on a line of 99+ characters, tmp/pattern-trap/rule.md)
  function F.split(line)
    local at = line:find(":", 1, true)
    if at == nil then return nil, nil end
    return line:sub(1, at - 1), line:sub(at + 1)
  end
  function F.starts(line, words)
    local head = line:lower():match("^%s*(%a+ ?%a*)") or ""
    for _, w in ipairs(words) do
      if head == w or head:sub(1, #w + 1) == w .. " " or (w == "cycling" and head:find("cycling", 1, true)) then return true end
    end
    return false
  end
  -- (a guess from the text, as Forge words it: a wrong one is refused by the engine with a reason, and the list
  -- goes back to editing)
  function F.handAbility(card)
    local name = tostring(card.n or "")
    for _, line in ipairs(F.lines(card)) do
      if F.starts(line, F.HAND_WORDS) then return true end
      local cost = F.split(line)
      if cost ~= nil and (cost:find("from your hand", 1, true)
        or (cost:find("Discard", 1, true) and (cost:find("this card", 1, true) or (name ~= "" and cost:find(name, 1, true))))) then return true end
    end
    return false
  end
  -- a non-mana activated ability on the battlefield: a keyword, or "cost: effect" whose cost is mana, a tap, a
  -- sacrifice ... or loyalty, and whose effect isn't "Add ..."
  function F.bfAbility(card)
    for _, line in ipairs(F.lines(card)) do
      if F.starts(line, F.BF_WORDS) then return true end
      local cost, effect = F.split(line)
      if cost ~= nil and not F.starts(line, F.HAND_WORDS) and not effect:find("^%s*Add ") and not cost:find("from your ", 1, true) then
        local loyalty = #cost <= 6 and cost:find("[%dX]") ~= nil and cost:find("%a%a") == nil
        if loyalty or cost:find("{", 1, true) or cost:find("^%s*Sacrifice") or cost:find("^%s*Discard") or cost:find("^%s*Pay ")
          or cost:find("^%s*Exile") or cost:find("^%s*Remove") or cost:find("^%s*Tap ") or cost:find("^%s*Untap ") or cost:find("^%s*Return") then return true end
      end
    end
    return false
  end
  -- what one seat may pick: { id, name, where = "hand" | "battlefield", acts } from the last board (its own hand; the
  -- permanents it controls with an ability)
  function F.cards(c)
    local out = {}
    for _, pl in ipairs((lastTable and lastTable.players) or {}) do
      if pl.color == c then
        for _, card in ipairs(pl.hand or {}) do
          if card.id ~= nil and card.n ~= nil and not card.fd then
            -- (a land is never cast, a land creature such as Dryad Arbor included: the engine would refuse the
            -- whole list, "has no spell to cast")
            local land, spell = false, #(card.ty or {}) == 0
            for _, t in ipairs(card.ty or {}) do if t == "Land" then land = true else spell = true end end
            if land then spell = false end
            local acts = {}
            if spell then acts[#acts + 1] = "cast" end
            if F.handAbility(card) then acts[#acts + 1] = "activate" end
            if land then acts[#acts + 1] = "land" end
            acts[#acts + 1] = "grave"
            out[#out + 1] = { id = card.id, name = tostring(card.n), where = "hand", acts = acts }
          end
        end
      end
    end
    for _, pl in ipairs((lastTable and lastTable.players) or {}) do
      for _, card in ipairs(pl.battlefield or {}) do
        if card.id ~= nil and card.n ~= nil and not card.fd and not card.po and (card.ctl == c or (card.ctl == nil and pl.color == c)) and F.bfAbility(card) then
          out[#out + 1] = { id = card.id, name = tostring(card.n), where = "battlefield", acts = { "activate" } }
        end
      end
    end
    return out
  end
  function F.can(c, id, act)
    for _, e in ipairs(F.cards(c)) do
      if e.id == id then for _, a in ipairs(e.acts) do if a == act then return true end end end
    end
    return false
  end
  function F.pickLine(p) return F.WORDS[p.act](engineSeatName(p.color), p.name) end
  function F.noteList()
    local out = {}
    for c, t in pairs(F.notes) do
      local s = tostring(t):gsub("^%s+", ""):gsub("%s+$", "")
      if s ~= "" then out[#out + 1] = { color = c, text = s:sub(1, 200) } end
    end
    table.sort(out, function(a, b) return a.color < b.color end)
    return out
  end
  -- the list as the main fix panel shows it
  function F.listText()
    local out = {}
    for i, p in ipairs(F.picks) do out[#out + 1] = "\n" .. i .. ". " .. F.pickLine(p) end
    for _, n in ipairs(F.noteList()) do out[#out + 1] = "\nNote (" .. engineSeatName(n.color) .. "): " .. n.text end
    return #out > 0 and ("\nThe list:" .. table.concat(out)) or "\nThe list is empty."
  end
  -- the panel's rows for one seat: the whole list (yours with Move up / Move down / Remove under the one you clicked),
  -- then what you can still pick
  function F.rowsFor(c)
    local rows, picked = {}, {}
    for i, p in ipairs(F.picks) do
      picked[p.id] = true
      local mine, open = p.color == c, p.color == c and F.sel[c] == p.id
      rows[#rows + 1] = { kind = "pick", id = p.id, label = (open and "> " or "") .. i .. ". " .. F.pickLine(p), color = open and "#8a7428" or (mine and "#6b5a1e" or "#333333") }
      if open then
        rows[#rows + 1] = { kind = "up", id = p.id, label = "      Move up", color = "#2e3a59" }
        rows[#rows + 1] = { kind = "down", id = p.id, label = "      Move down", color = "#2e3a59" }
        rows[#rows + 1] = { kind = "remove", id = p.id, label = "      Take it out of the list", color = "#8e2a2a" }
      end
    end
    for _, e in ipairs(F.cards(c)) do
      if not picked[e.id] then
        for _, act in ipairs(e.acts) do
          rows[#rows + 1] = { kind = "add", id = e.id, act = act, name = e.name, where = e.where, color = "#262626",
            label = F.ACT[act] .. ": " .. e.name .. (e.where == "battlefield" and " (on the battlefield)" or "") }
        end
      end
    end
    return rows
  end
  -- (updateOptions asks first) draws the hand list into this seat's Engine panel; false when it isn't showing (and
  -- the panel's note box becomes the search box again)
  function engineFixHandDraw(c)
    if not engineFixHandWants(c) then
      if F.handOn[c] then
        F.handOn[c] = nil
        setAttr("eng_search_" .. c, "placeholder", "Search...")
        setAttr("eng_search_" .. c, "characterLimit", "0")
        setText("eng_search_" .. c, "")
      end
      return false
    end
    F.handOn[c] = true
    local rows = F.rowsFor(c)
    local per, first = POOL, 1
    if #rows > POOL then
      per = POOL - 1
      F.page[c] = (F.page[c] or 0) % math.ceil(#rows / per)
      first = F.page[c] * per + 1
    end
    local last = math.min(#rows, first + per - 1)
    local slots, k = {}, 0
    engineVisible[c] = {}
    for i = first, last do
      k = k + 1
      slots[k] = rows[i]
      setButton("eng_opt_" .. c .. "_" .. k, { text = rows[i].label, color = rows[i].color, active = "true" })
    end
    for j = k + 1, per do setAttr("eng_opt_" .. c .. "_" .. j, "active", "false") end
    if per < POOL then
      slots[POOL] = { kind = "more" }
      setButton("eng_opt_" .. c .. "_" .. POOL, { text = string.format("More... (%d-%d of %d)", first, last, #rows), color = "#333333", active = "true" })
    end
    F.rows[c] = slots
    setText("eng_title_" .. c, "Fix from hand")
    setText("eng_text_" .. c, (#rows == 0 and "Your hand is empty. " or "") .. "A pick only joins the list: nothing happens until everyone agrees. The list runs top to bottom (spells: the last one resolves first). Click a line of yours to move it or take it out.")
    setAttr("eng_search_" .. c, "active", "true")
    setAttr("eng_search_" .. c, "placeholder", "Note: what should have happened (optional)")
    setAttr("eng_search_" .. c, "characterLimit", "200")
    setText("eng_search_" .. c, F.notes[c] or "")
    setText("eng_confirm_" .. c, "Done: show the list to everyone")
    setAttr("eng_confirm_" .. c, "interactable", "true")
    setAttr("eng_confirm_" .. c, "active", "true")
    setAttr("eng_cancel_" .. c, "active", "false")
    return true
  end
  -- (onMtgSlot / onMtgConfirm ask first) a click in the hand list: slot number, or "done"; false when the list isn't
  -- showing for this seat
  function engineFixHandClick(c, slot)
    if not F.handOn[c] then return false end
    if not engineFixHandWants(c) then return true end -- (a click on a list that is going away)
    if slot == "done" then engineFixDone(c) return true end
    local r = (F.rows[c] or {})[slot]
    if r == nil then return true end
    local at = nil
    for i, p in ipairs(F.picks) do if p.id == r.id then at = i end end
    if r.kind == "more" then F.page[c] = (F.page[c] or 0) + 1
    elseif r.kind == "pick" then
      local p = at and F.picks[at]
      if p == nil then return true end
      if p.color ~= c then tell(c, "Only " .. engineSeatName(p.color) .. " can move or take out that line.") return true end
      F.sel[c] = F.sel[c] ~= p.id and p.id or nil
    elseif r.kind == "up" or r.kind == "down" then
      local to = at and (r.kind == "up" and at - 1 or at + 1)
      if to == nil or F.picks[to] == nil then return true end
      F.picks[at], F.picks[to] = F.picks[to], F.picks[at]
    elseif r.kind == "remove" then
      if at ~= nil then table.remove(F.picks, at) end
      F.sel[c] = nil
    elseif r.kind == "add" then
      if at ~= nil then tell(c, r.name .. " is in the list already.") return true end
      if not F.can(c, r.id, r.act) then tell(c, r.name .. " can't be picked for that now.")
      else F.picks[#F.picks + 1] = { color = c, id = r.id, act = r.act, name = r.name, where = r.where } end
    end
    F.ver = F.ver + 1
    engineFixRedraw()
    return true
  end
  -- (onMtgSearch asks first) the note box: what was typed, as it is (trimmed when sent)
  function engineFixHandNote(c, value)
    if not F.handOn[c] or not engineFixHandWants(c) then return false end
    value = tostring(value or ""):sub(1, 200)
    uiCache["eng_search_" .. c] = value
    F.setNote(c, value, false)
    return true
  end
  -- said: typed in chat (mtg fix note <text>): trimmed and confirmed to the player
  function F.setNote(c, text, said)
    text = tostring(text or ""):sub(1, 200)
    local bare = text:gsub("^%s+", ""):gsub("%s+$", "")
    if said then
      F.notes[c] = bare ~= "" and bare or nil
      tell(c, bare ~= "" and ("Note: " .. bare .. " (it goes to the log with the fix)") or "Note taken out.")
    else
      F.notes[c] = text ~= "" and text or nil
    end
    F.ver = F.ver + 1
    engineFixRedraw()
  end
  -- the picks as ops, in list order (a pick whose card has moved is taken out and its owner told), then the chat
  -- numbers (life, poison, counters, tokens, mana)
  function F.handOps()
    local keep, ops = {}, {}
    for _, p in ipairs(F.picks) do
      if F.can(p.color, p.id, p.act) then keep[#keep + 1] = p
      else tell(p.color, p.name .. " isn't where it was: taken out of the list.") end
    end
    if #keep ~= #F.picks then F.picks = keep F.ver = F.ver + 1 engineFixRedraw() end
    for _, p in ipairs(F.picks) do
      if p.act == "grave" then ops[#ops + 1] = { op = "move", card = p.id, zone = "graveyard" }
      else ops[#ops + 1] = { op = F.OP[p.act], card = p.id, player = p.color } end
    end
    return F.extraOps(ops)
  end
  -- (engineRender asks first) the board waits while the engine is paused: only the zones the bridge left out are
  -- filled in from the last board, and the panel is updated
  -- (a fix from hand moved nothing on the table: while the engine plays its picks, asking for targets and the like, the
  -- board is drawn as the engine has it)
  function engineFixHolds(m)
    if m.fix == nil or not FIX_HOLD[m.fix.state] or lastTable == nil then return false end
    if m.fix.state == "applying" and F.kindOf(m.fix) == "hand" then return false end
    mergeStatic(m)
    lastTable = m
    local ok, err = pcall(engineFixUpdate, m.fix)
    if not ok then print("[MTG] manual fix: " .. tostring(err)) end
    return true
  end
  F.act = onPlayerAction
  function onPlayerAction(player, action, targets)
    if ENGINE_MODE and lastTable ~= nil and F.editing() then
      local A = Player.Action
      if not engineColors[player.color] then
        for _, o in ipairs(targets or {}) do if isEngineCard(o) then return false end end
        return true
      end
      local free = action == A.Select or action == A.PickUp or action == A.FlipOver
        or action == A.RotateIncrementalLeft or action == A.RotateIncrementalRight
      for _, o in ipairs(targets or {}) do
        if isEngineCard(o) then
          if not free then tell(player.color, "During a manual fix cards can be moved, turned and flipped only.") return false end
          if action ~= A.Select then engineFixTouched[engineIdOf(o)] = true end
        end
      end
      return true
    end
    return F.act(player, action, targets)
  end
  F.drop = onObjectDrop
  function onObjectDrop(color, obj)
    if engineFix ~= nil and FIX_HOLD[engineFix.state] then return end
    return F.drop(color, obj)
  end
  F.enter = onObjectEnterContainer
  function onObjectEnterContainer(container, obj)
    if F.editing() and F.cardId(obj) ~= nil then
      -- (it stays a loose card on that spot: the spot says where it went)
      local guid, id = obj.getGUID(), engineIdOf(obj)
      engineFixTouched[id] = true
      Wait.frames(function()
        if container == nil or container.isDestroyed() or container.type ~= "Deck" then return end
        pcall(function()
          container.takeObject({ guid = guid, position = container.getPosition() + Vector(0, 1.2, 0), smooth = false,
            callback_function = function(card) if card ~= nil then card.setLock(false) end end })
        end)
      end, 1)
      return
    end
    if F.enter ~= nil then return F.enter(container, obj) end
  end
  F.leave = onObjectLeaveContainer
  function onObjectLeaveContainer(container, obj)
    if F.editing() and F.cardId(obj) ~= nil then
      engineFixTouched[F.cardId(obj)] = true
    end
    if F.leave ~= nil then return F.leave(container, obj) end
  end
end

-- Cards thrown or flicked into a hand they don't belong in (no drop event reaches the table then: playtest 2026-10-23,
-- Blue's card landed in White's hand, and its face showed to White): an engine card entering a hand zone other than
-- its owner's, or any hand when it isn't a hand card, goes back where the engine has it at once. (A manual fix's
-- editing is left alone: moving cards into hands is how a fix says "to the hand".)
do
  local before = onObjectEnterZone
  function onObjectEnterZone(zone, obj)
    if before ~= nil then before(zone, obj) end
    if not ENGINE_MODE or lastTable == nil or zone == nil or obj == nil or zone.type ~= "Hand" then return end
    local id = tostring(obj.getGMNotes()):match("^engine:(engine%-card%-%d+)$")
    local meta = id and engineMeta[id]
    if meta == nil or (engineFix ~= nil and engineFix.state == "editing") then return end
    local zp, owner = zone.getPosition(), nil
    for c in pairs(engineColors) do
      for i = 1, 2 do
        local t = Player[c] ~= nil and Player[c].getHandTransform(i) or nil
        if t ~= nil and (t.position.x - zp.x) ^ 2 + (t.position.z - zp.z) ^ 2 < 1 then owner = c end
      end
    end
    -- (the table's own cards in its owner's second hand zone too: a scry's looked-at card is laid there, and set this
    -- off, "can't go into another player's hand", hp-08 #4 2026-10-28)
    if (meta.zone == "hand" or meta.zone == "playable" or meta.hand2) and owner == meta.color then return end
    -- (a card of that player's open scry or surveil, by the question itself: Grave Researcher's surveil card still set it
    -- off, its record being the library's when it reached the hand, hp-06 #15 2026-10-28)
    if owner ~= nil then
      local _, sp = engineScryOpen(owner)
      if sp ~= nil and engineScryIndex(sp, id) ~= nil then return end
    end
    engineInHand[id] = true -- (out of a hand by a jump: TTS lays hand cards out again after a smooth move)
    Wait.frames(function() if lastTable ~= nil then engineRender(lastTable) end end, 2)
    if meta.color ~= nil then tell(meta.color, "Cards can't go into another player's hand: it went back.") end
  end
end

-- Hand-test deck kits (tools/make-handtest-kits.js): a bag holding a 39-card test deck and its commander, with a
-- "Load into my seat" button. Its deck goes on the player's library spot and the commander on their command zone,
-- ready for READY and Start. Not during a game; a test deck already there is replaced; the player's own cards there
-- stop it (they would merge).
function engineLoadTestKit(params)
  local kit, c = getObjectFromGUID((params and params.guid) or ""), params and params.color
  local d = c and data[c]
  -- (broadcastToColor throws for a colour nobody sits at)
  local say = function(t) if c ~= nil and Player[c] ~= nil and Player[c].seated then broadcastToColor("[MTG] " .. t, c, { 1, 0.85, 0.4 }) else print("[MTG] " .. t) end end
  if kit == nil or d == nil or d.libraryZone == nil then if c ~= nil and Player[c] ~= nil then say("Sit at a seat with a playmat first.") end return end
  local t = engineTable ~= nil and engineTable() or nil
  if t ~= nil and not t.gameOver then return say("Not during a game: press New game (or type  mtg reset ) first.") end
  -- (an empty kit was already loaded: a second click on its button deleted the deck it had just put down, as an "old
  -- test deck", and loaded nothing, 2026-10-22)
  if #(kit.getObjects() or {}) == 0 then return say(kit.getName() .. " is empty: it is already loaded (or put its deck back in to load it again).") end
  local lib = d.libraryZone.getPosition()
  local label = getObjectFromGUID((TAX_LABELS[c] or {})[1] or "")
  local cmd = label and label.getPosition() or lib
  local near = function(p, q) return math.abs(p.x - q.x) < 2.5 and math.abs(p.z - q.z) < 2.5 end
  local old = {}
  for _, o in ipairs(getObjects()) do
    if (o.type == "Card" or o.type == "Deck") and o ~= kit then
      local p, gm = o.getPosition(), tostring(o.getGMNotes())
      if near(p, lib) or near(p, cmd) then
        if gm == "testcard" then old[#old + 1] = o
        elseif not gm:find("^engine") then return say("Your own " .. string.lower(o.type) .. " is on your library or command spot: move it off first (it would merge with the test deck).") end
      end
    end
  end
  for _, o in ipairs(old) do o.destruct() end -- (an earlier test deck: replaced)
  local name = kit.getName()
  -- (commanders side by side, each its own card: a partner or Background pair put on one spot merged into a pile the
  -- table doesn't read as commanders, "not ready", hp-09 gap 2026-10-29; within the command spot's 2.5 reach)
  local k = 0
  for _, e in ipairs(kit.getObjects()) do
    local isDeck = tostring(e.name):find("^Test deck") ~= nil
    if not isDeck then k = k + 1 end
    kit.takeObject({ guid = e.guid, smooth = false, position = isDeck and Vector(lib.x, 2, lib.z) or Vector(cmd.x + 1.4 * (k - 1), 2, cmd.z),
      rotation = isDeck and Vector(0, 180, 180) or Vector(0, 180, 0) })
  end
  say(name .. " loaded. Press READY, then Start. (For a harmless AI: type  mtg aideck ai_passive_lands  first.)")
end
end

-- ───────── scry, the table's way (2026-10-24) ─────────
-- "Make sure scry cards use the TTS mechanic": as the table's own Scry button (scry1 deals the cards into the second hand
-- zone), an engine scry puts its cards there, face up, seen by that player only. Dragged onto the library a card stays
-- on top (the last one dragged ends up on top); clicked (or right-click > Bottom) it goes to the bottom, dragged onto
-- the graveyard it goes there (surveil). Done answers; so does dragging the last card out. Cards still in the zone stay
-- on top. The bridge marks such a question with "scry" and reads the answer "__tts", "top:<id>"..., "move:<id>"...
engineScry = {} -- colour -> { promptId, top = { ids in the order dragged }, gone = { id -> true }, menu = { id -> true } }
function engineScryOpen(color)
  local p = enginePrompts[color]
  if p == nil or p.scry == nil then engineScry[color] = nil return nil end
  local st = engineScry[color]
  if st == nil or st.promptId ~= p.promptId then
    st = { promptId = p.promptId, top = {}, gone = {}, menu = {} }
    engineScry[color] = st
  end
  return st, p
end
function engineScryIndex(p, id)
  for i, o in ipairs(p.options or {}) do if tostring(o.id) == tostring(id) then return i end end
  return nil
end
-- the cards open scries hold in their players' hand zones (id -> true): no other spot takes them (enginePlayableRows)
function engineScryHeld()
  local held = {}
  for color in pairs(enginePrompts) do
    local st, p = engineScryOpen(color)
    if st ~= nil and Player[color] ~= nil and Player[color].seated then
      for _, o in ipairs(p.options or {}) do if not st.gone[o.id] then held[o.id] = true end end
    end
  end
  return held
end
function engineScryPlace(seen)
  for color in pairs(enginePrompts) do
    local st, p = engineScryOpen(color)
    local g = st and seatGeometry(color)
    if g ~= nil and Player[color] ~= nil and Player[color].seated then
      local side = Player[color].getHandTransform(2)
      local base = side and side.position or (g.handPos or g.mat)
      for i, o in ipairs(p.options or {}) do
        if not st.gone[o.id] then
          place({ id = o.id, n = o.label, f = o.img }, base + Vector(0, 1, 0), Vector(0, g.rotY, 0), seen, color, { zone = "scry", color = color, hand2 = true })
          local obj = engineObjs[o.id]
          if obj ~= nil and not obj.isDestroyed() and not st.menu[o.id] then
            st.menu[o.id] = true
            obj.addContextMenuItem(p.scry.move == "graveyard" and "Into the graveyard" or "Bottom of library", function(pc)
              if pc == color and enginePrompts[color] == p then enginePick(color, i) end
            end)
          end
        end
      end
    end
  end
end
-- the whole answer: dragged cards top first (last dragged on top), chosen ones moved
function engineScryFinish(color)
  local st, p = engineScryOpen(color)
  if st == nil then return end
  local choice = { "__tts" }
  for k = #st.top, 1, -1 do choice[#choice + 1] = "top:" .. st.top[k] end
  for i, o in ipairs(p.options or {}) do
    if engineSelectedFor(color, i) and not st.gone[o.id] then choice[#choice + 1] = "move:" .. o.id end
    if engineSelectedFor(color, i) and st.gone[o.id] == "move" then choice[#choice + 1] = "move:" .. o.id end
  end
  engineTableLog(color, "scry: " .. table.concat(choice, " ", 2))
  engineAnswer(color, choice)
end
function engineScryDrop(color, obj, id)
  local st, p = engineScryOpen(color)
  if st == nil or obj == nil or obj.isDestroyed() then return end
  if isInHand(obj, color, 2) or isInHand(obj, color, 1) then return end -- rearranged in a hand
  local area = dropArea(color, obj.getPosition())
  local i = engineScryIndex(p, id)
  if area == "library" then
    for k = #st.top, 1, -1 do if st.top[k] == id then table.remove(st.top, k) end end
    st.top[#st.top + 1] = id
    st.gone[id] = "top"
    if i ~= nil and engineSelectedFor(color, i) then enginePick(color, i) end
    engineDispose(obj)
    tell(color, "On top of your library.")
  elseif area == "graveyard" and p.scry.move == "graveyard" then
    st.gone[id] = "move"
    if i ~= nil and not engineSelectedFor(color, i) then enginePick(color, i) end
    engineDispose(obj)
    tell(color, "Into your graveyard.")
  else
    local side = Player[color].getHandTransform(2)
    if side ~= nil then obj.setPosition(side.position + Vector(0, 1, 0)) end
    return
  end
  for _, o in ipairs(p.options or {}) do if not st.gone[o.id] then return end end
  engineScryFinish(color) -- the last card is out of the zone
end
do
  local scryDrop = onObjectDrop
  function onObjectDrop(color, obj)
    if ENGINE_MODE and lastTable ~= nil and obj ~= nil and isEngineCard(obj) then
      local st, p = engineScryOpen(color)
      local id = engineIdOf(obj)
      if st ~= nil and engineScryIndex(p, id) ~= nil then
        Wait.frames(function() engineScryDrop(color, obj, id) end, 2)
        return
      end
    end
    return scryDrop(color, obj)
  end
  -- a scry question arriving draws its cards into the hand zone at once (not at the next board)
  local scryEnter = engineEnterPrompt
  function engineEnterPrompt(color, m)
    local r = scryEnter(color, m)
    if m ~= nil and m.scry ~= nil and lastTable ~= nil then engineRender(lastTable) end
    return r
  end
end

-- ───────── "Waiting for ..." flashes (2026-10-24) ─────────
-- "Have the 'waiting for X' start flashing after 5 seconds, random colors of the rainbow": once a player has waited 5 s
-- for the same player, their line changes to a random rainbow colour (never the same twice running) 3 times a second,
-- until the wait ends or moves on to someone else (engineUpdateCorner keeps engineWaiting).
engineWaiting = {} -- colour -> { who, since, last }
ENGINE_RAINBOW = { "#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#00C7BE", "#007AFF", "#AF52DE" }
function engineWaitFlash()
  local now = os.clock()
  for color, w in pairs(engineWaiting) do
    if now - w.since >= 5 then
      local k = math.random(#ENGINE_RAINBOW - 1)
      if w.last ~= nil and k >= w.last then k = k + 1 end
      w.last = k
      setAttr("eng_hint_" .. color, "color", ENGINE_RAINBOW[k])
    end
  end
end
Wait.time(function() pcall(engineWaitFlash) end, 0.33, -1)

-- ───────── ability boxes (2026-10-24) ─────────
-- "Instead of right-clicking a card for an ability or to attach it, a floating clear grey box beside it, like the
-- counter box, saying the ability as the engine writes it." While you have priority, each of your permanents with an
-- ability you can use now (equip and attach included; mana abilities and "Untap" left out: lands would all get one)
-- shows one button per ability on the card. Everyone sees the buttons; only you can use them (a click checks the
-- colour). Clicking a button does what the right-click entry does (that stays too).
engineAbilityOn = {}   -- colour -> { card id -> signature of what it shows }
-- The boxes are buttons on the card, drawn like its counter badges (the player asked for a box "like the colored
-- counter box on cards"; the first version was a screen panel on the card, too small to read at the usual camera
-- distance, turned sideways with a tapped card, and only drawn at the next question, playtest 2026-10-26).
-- engineAbilityWant: card id -> { color, promptId, list = { { id, text } }, sig }; updateBadge draws them when they change.
engineAbilityWant = {}
-- (a reset: nothing of the last game's buttons or panel stays, stage 3 review 2026-10-27)
function engineAbilityReset()
  for c in pairs(engineAbPanelFor or {}) do setAttr("eng_abp_" .. c, "active", "false") end
  engineAbilityWant, engineAbilityOn, engineAbPanelFor, engineRedrawSoon = {}, {}, {}, {}
  engineAbShown, engineAbPage = {}, {}
end
-- one short line per ability: its cost and the start of what it does ("{1}{G}: Put a +1/+1…"); the button's tooltip
-- has the whole text
function engineAbilityShort(text, n)
  -- (split by a plain find: the pattern "^([^:]+):%s*(.+)$" raised "pattern too complex" in TTS on a text of 100+
  -- characters with no colon, tmp/pattern-trap/rule.md)
  text = tostring(text)
  local at = text:find(":", 1, true)
  local cost, eff = nil, nil
  if at ~= nil and at > 1 and at < #text then
    local rest = text:sub(at + 1)
    cost, eff = text:sub(1, at - 1), rest:gsub("^%s+", "")
    if eff == "" then eff = rest:sub(-1) end
  end
  if cost == nil or #cost > 14 then cost, eff = nil, text end
  local out = ""
  for word in eff:gmatch("%S+") do
    if out ~= "" and #out + #word + 1 > n then out = out .. "…" break end
    out = out == "" and word or (out .. " " .. word)
  end
  return cost and (cost .. ": " .. out) or out
end
function engineAbilitySig(c)
  local w = engineAbilityWant[c.id]
  if w == nil then return "" end
  return tostring(c.tap or false) .. "|" .. w.sig
end
-- The ability on button number k of the card object obj, for player colour c (nil unless it is theirs)
function engineAbilityAt(obj, k, c)
  local w = obj ~= nil and engineAbilityWant[tostring(obj.getGMNotes()):gsub("^engine:", "")] or nil
  local a = w and w.color == c and w.list[tonumber(k)]
  return a and a.id or nil, w and w.promptId
end
-- one click function per button number, shared by every card (one per card and button stayed in _G for good). A
-- right-click arrives too, as alt_click: it used the ability when the card's menu was wanted, playtest 2026-10-27.
ENGINE_AB_BUTTONS = ENGINE_AB_MAX -- (the panel's rows: a 7th ability was on the card only, stage 3 review 2026-10-27)
for k = 1, ENGINE_AB_BUTTONS do
  _G["engineAbBtn" .. k] = function(obj, playerColor, altClick)
    if altClick then return end
    local id, promptId = engineAbilityAt(obj, k, playerColor)
    if id then engineUseAbility(playerColor, id, promptId) end
  end
end
function engineAbilityButtons(o, c)
  local w = engineAbilityWant[c.id]
  if w == nil or o == nil or o.isDestroyed() then return end
  local z, h = -0.95, 190
  for k, a in ipairs(w.list) do
    if k > ENGINE_AB_BUTTONS then break end
    -- on the card itself, top down (beside it they covered the next card, seen 2026-10-26); a tapped card turns its
    -- buttons back so they read the right way up
    local zz = z + h / 2000
    -- (a little above the badges: where they meet, the ability is what a click means, suite review 2026-10-27)
    local pos, rot = { 0, 0.31, zz }, { 0, 0, 0 }
    if c.tap then pos, rot = { -zz, 0.31, 0 }, { 0, -90, 0 } end
    o.createButton({ click_function = "engineAbBtn" .. k, function_owner = Global, label = engineAbilityShort(a.text, 16),
      position = pos, rotation = rot, width = 1000, height = h, font_size = 115,
      color = { 0.12, 0.13, 0.16, 0.92 }, font_color = { 1, 1, 1 }, hover_color = { 0.32, 0.36, 0.44, 0.95 }, tooltip = a.text })
    z = z + h / 1000 + 0.05
  end
end
-- (the card's current entry on the board, for a redraw of its buttons)
function engineAbilityCard(id)
  for _, pl in ipairs((lastTable and lastTable.players) or {}) do
    for _, c in ipairs(pl.battlefield or {}) do if c.id == id then return c end end
  end
  -- (a plane in play: the planar die's roll, Planechase)
  for _, c in ipairs((lastTable and lastTable.planes) or {}) do if c.id == id then return c end end
end
function engineAbilityBoxes(color, p, kind)
  local want = {}
  -- (an ability whose card is not one of your permanents on the table yet, or a token stack this question names: the
  -- renders after it ask again, which only redraws what changed. A cycling card in the hand keeps it asking; a card
  -- the table still had in a hand when the question came is the case it is for, stage 3 review 2026-10-27.)
  local waiting = false
  if kind == "attack" or kind == "block" or kind == "target" then
    local named = {}
    for _, o in ipairs((p and p.options) or {}) do
      for piece in tostring(o.id):gmatch("[^|]+") do named[piece] = true end
    end
    for rep, key in pairs(engineGroupKey) do
      local obj = engineObjs[rep]
      local n = engineGroupShown[rep] or 1
      if named[rep] then waiting = true end
      if named[rep] and n > 1 and engineSplit[key] == nil and obj ~= nil and not obj.isDestroyed() then
        want[rep] = { { id = "__split:" .. rep, text = "Split the " .. n .. " to pick one by one" } }
      end
    end
  end
  local options = (kind == "action" and p and p.options) or {}
  local sent = false -- (a bridge that sends "ab" sends it on every ability: then nothing else is one)
  for _, o in ipairs(options) do if o.ab ~= nil then sent = true break end end
  for _, o in ipairs(options) do
    local id, label = tostring(o.id), tostring(o.label or "")
    -- (a token folded into a stack has no object or place of its own: the stack's card says whose it is)
    local meta = o.cardId and engineMeta[engineGroupOf[o.cardId] or o.cardId]
    -- (an ability: the bridge sends its text as "ab"; older messages are told apart by their label. "Untap X (mana
    -- back)" is not one: every land tapped for mana got a button, stage 3 review 2026-10-27)
    local ability = o.ab ~= nil or (not sent and not id:find("^tap:") and not id:find("^untap:") and not label:find("^Mana:")
      and not label:find("^Cast ") and not label:find("^Play ") and not label:find("^Untap "))
    if meta ~= nil and meta.color == color and (meta.zone == "battlefield" or meta.zone == "attached" or meta.zone == "plane") and ability then
      -- (by card id: a permanent still being spawned gets its buttons when it is drawn)
      want[o.cardId] = want[o.cardId] or {}
      local w = want[o.cardId]
      w[#w + 1] = { id = o.id, text = engineAbilityText(o) }
    elseif o.cardId ~= nil and ability then waiting = true end
  end
  if p ~= nil then p.__abWait = waiting end
  -- cards that no longer have a box lose it, and each changed card is drawn again with its badges
  local on = engineAbilityOn[color] or {}
  local changed = {}
  for id in pairs(on) do
    if want[id] == nil then on[id] = nil engineAbilityWant[id] = nil changed[id] = true end
  end
  for id, list in pairs(want) do
    -- (drawn again only when the words change: the ids are positions and shift with every new option, which redrew
    -- every card's buttons; a click reads the list as it is now, stage 3 review 2026-10-27)
    local sig = {}
    for _, a in ipairs(list) do sig[#sig + 1] = a.text end
    sig = table.concat(sig, "|")
    local had = engineAbilityWant[id]
    if on[id] ~= sig or had == nil or had.color ~= color then changed[id] = true end
    on[id] = sig
    engineAbilityWant[id] = { color = color, promptId = p and p.promptId, list = list, sig = sig }
  end
  engineAbilityOn[color] = on
  for id in pairs(changed) do
    local obj, c = engineObjs[id], engineAbilityCard(id)
    if obj ~= nil and not obj.isDestroyed() and c ~= nil then updateBadge(obj, c, "battlefield")
    -- (a card that left the battlefield, bounced to a hand: its buttons go with the question, stage 3 review)
    elseif obj ~= nil and not obj.isDestroyed() and engineAbilityWant[id] == nil then obj.clearButtons() engineBadge[id] = nil end
  end
  -- (the screen panel follows the question: its lines answer this one now, offered or greyed)
  local shown = engineAbPanelFor and engineAbPanelFor[color]
  if shown ~= nil then engineAbPanelShow(color, shown) end
  -- (and the green frames of your permanents follow the same list: on at priority, gone with the question)
  if enginePlayableGlow ~= nil then pcall(enginePlayableGlow, color) end
end

-- (by name, for tests and tools: "ab|<object guid>|<button number>")
function onMtgAbility(player, value, id)
  local guid, k = tostring(id):match("^ab|(%w+)|(%d+)$")
  if guid == nil then return end
  local optionId, promptId = engineAbilityAt(getObjectFromGUID(guid), k, player.color)
  if optionId then engineUseAbility(player.color, optionId, promptId) end
end
-- An ability (or a stack's Split) chosen on a card's button or on the screen panel: one way to use it
function engineUseAbility(color, optionId, promptId)
  -- (only for the question the buttons were drawn for: ids are positions, "prompt-action-0" is in the next one too)
  if promptId ~= nil and (enginePrompts[color] or {}).promptId ~= promptId then return end
  local splitRep = tostring(optionId):match("^__split:(.+)$")
  if splitRep ~= nil then
    local key = engineGroupKey[splitRep]
    if key == nil then return end
    engineSplit[key] = color
    engineTableLog(color, "split a stack of " .. tostring(engineGroupShown[splitRep]))
    snapBack()
    -- the new cards glow (and the stack's box goes) once they are on the table
    return Wait.time(function() if enginePrompts[color] ~= nil then enginePhase2Prompt(color) end end, 0.6)
  end
  local p = enginePrompts[color]
  for i, o in ipairs((p and p.options) or {}) do
    if o.id == optionId then
      engineTableLog(color, "ability box: " .. tostring(o.label))
      return enginePick(color, i)
    end
  end
end

-- The screen panel (engineAbPanelXml): every action the engine offers for the card you point at, and every activated
-- ability in its text that it doesn't offer now, greyed with the reason when the table can tell (docs/engine-ui-spec.md
-- 5: "mimic the engine", the user 2026-11-10). ENGINE_AB_MAX lines a page, More turns it. It stays while you move to
-- it, follows the board (engineUpdateCorner, engineAbilityBoxes) and goes when the card has nothing left to list.
engineAbPanelFor = {} -- colour -> engine card id shown
engineAbShown = {}    -- colour -> { id, rows, first, promptId }: what the panel's lines are now (a click reads it)
engineAbPage = {}     -- colour -> { id, n }: the page shown for that card
-- keyword abilities with a cost and no colon, used on the battlefield (as the fix's F.BF_WORDS)
ENGINE_AB_KEYWORDS = { "Equip", "Crew", "Fortify", "Reconfigure", "Level up", "Outlast", "Station" }
-- a cost's first word that makes "X: Y" an activated ability without a mana symbol in it
ENGINE_AB_COSTWORDS = { Sacrifice = true, Discard = true, Pay = true, Exile = true, Remove = true, Tap = true, Untap = true,
  Return = true, Put = true, Reveal = true, Mill = true, Collect = true, Forage = true }
-- "+1", "−2" (U+2212), "-X", "0" -> the number (a minus is negative, X counts 0), else nil
function engineLoyaltyCost(cost)
  local s = tostring(cost):gsub("\226\136\146", "-")
  s = s:gsub("^%s+", ""):gsub("%s+$", "")
  if #s == 0 or #s > 4 then return nil end
  local sign, n = s:sub(1, 1), s
  if sign == "+" or sign == "-" then n = s:sub(2) else sign = "" end
  if n ~= "X" and not n:find("^%d+$") then return nil end
  local v = tonumber(n) or 0
  return sign == "-" and -v or v
end
-- One line of rules text as an activated ability { text, cost, eff, loyalty, mana, keyword }, or nil. Reminder text
-- (in brackets) goes first, so a basic land's "({T}: Add {G}.)" is none; a cost with a quote is a granted ability
-- ("Enchanted land has "{T}: ..."), not the card's own. Plain finds only (MoonSharp's "pattern too complex").
function engineTextAbility(line)
  line = tostring(line or ""):gsub("%b()", ""):gsub("^%s+", ""):gsub("%s+$", "")
  if line == "" then return nil end
  local at = line:find(":", 1, true)
  for _, k in ipairs(ENGINE_AB_KEYWORDS) do
    if at == nil and line:sub(1, #k + 1) == k .. " " then return { text = line, cost = line:sub(#k + 2), eff = k, keyword = k } end
  end
  if at == nil or at < 2 or at > 70 then return nil end
  local cost, eff = line:sub(1, at - 1), (line:sub(at + 1):gsub("^%s+", ""))
  if cost:find(".", 1, true) or cost:find('"', 1, true) then return nil end
  local loyalty = engineLoyaltyCost(cost)
  local first = cost:match("^(%a+)") or ""
  if loyalty == nil and not cost:find("{", 1, true) and not ENGINE_AB_COSTWORDS[first] then return nil end
  return { text = line, cost = cost, eff = eff, loyalty = loyalty, mana = eff:find("^Add ") ~= nil }
end
-- the activated abilities in a card's text, in its order
function engineTextAbilities(tx)
  local out = {}
  for line in (tostring(tx or "") .. "\n"):gmatch("([^\n]*)\n") do
    local a = engineTextAbility(line)
    if a ~= nil then out[#out + 1] = a end
  end
  return out
end
function engineHasType(card, want)
  for _, ty in ipairs((card and card.ty) or {}) do if ty == want then return true end end
  return false
end
-- Why an ability in the card's text isn't offered now, as far as the table can tell. card: { ty, tx, tap, sick, ctr }
-- (its battlefield entry with its static details); p: the player's open question; prio: it is a priority question.
function engineAbWhy(color, card, a, p, prio)
  local t = lastTable or {}
  -- (Forge offers mana abilities while a cost is paid, not at priority)
  if a.mana then return "Used while paying a cost (tap it with Q/E)" end
  if p == nil then
    if t.priority ~= nil and t.priority ~= color and not t.gameOver then return "Not your priority (waiting for " .. engineNameOf(t.priority) .. ")" end
    return "Not your priority"
  end
  if not prio then return "Answer the open question first" end
  local cost = tostring(a.cost or "")
  if card ~= nil then
    if cost:find("{T}", 1, true) and card.tap then return "Tapped" end
    if cost:find("{Q}", 1, true) and not card.tap then return "Untapped ({Q} untaps it)" end
    if cost:find("{T}", 1, true) and engineHasType(card, "Creature") and card.sick and not tostring(card.tx or ""):find("Haste", 1, true) then return "Summoning sickness" end
  end
  local main = t.active == color and (t.step == "main1" or t.step == "main2") and #(t.stack or {}) == 0
  if a.loyalty ~= nil then
    if not main then return "Loyalty: your main phase, empty stack" end
    local have
    for k, v in pairs((card and card.ctr) or {}) do if tostring(k):upper() == "LOYALTY" then have = tonumber(v) end end
    if a.loyalty < 0 and have ~= nil and have < -a.loyalty then return "Needs " .. (-a.loyalty) .. " loyalty (has " .. have .. ")" end
    return "Loyalty: once each turn"
  end
  local low = tostring(a.eff):lower()
  local sorcery = low:find("activate only as a sorcery", 1, true) or a.keyword == "Equip" or a.keyword == "Fortify"
    or a.keyword == "Reconfigure" or a.keyword == "Level up" or a.keyword == "Outlast"
  if sorcery and not main then return "Only as a sorcery" end
  if low:find("activate only once each turn", 1, true) then return "Once each turn" end
  return "Can't be used now (its cost or a rule)"
end
-- The panel's lines for card id and player colour: { opt = the option id to answer with (nil: greyed), text, cost,
-- why, mana }. First the ways to cast or play it, then its text's abilities in order (offered or greyed), then what
-- the engine offers that the text doesn't name (a granted ability, its mana button, "Untap ... (mana back)").
function engineAbList(color, id)
  local p = enginePrompts[color]
  local prio = p ~= nil and enginePromptKind ~= nil and enginePromptKind(p) == "action"
  local sent = false -- (a bridge that sends "ab" sends it on every ability, engineAbilityBoxes)
  for _, o in ipairs((prio and p.options) or {}) do if o.ab ~= nil then sent = true break end end
  local casts, abils, others = {}, {}, {}
  for _, o in ipairs((prio and p.options) or {}) do
    if o.cardId == id then
      local label = tostring(o.label or "")
      if label:find("^Mana:") or label:find("^Untap ") then others[#others + 1] = o
      elseif o.ab ~= nil or (not sent and not label:find("^Cast ") and not label:find("^Play ")) then abils[#abils + 1] = o
      else casts[#casts + 1] = o end
    end
  end
  local rows = {}
  for _, o in ipairs(casts) do rows[#rows + 1] = { opt = o.id, text = tostring(o.label) } end
  -- (the board's entry with its static details: a slim entry carries only what changes)
  local entry, st = engineAbilityCard(id), engineStatic[id] or {}
  local card = entry ~= nil and { ty = entry.ty or st.ty, tx = entry.ct or entry.tx or st.tx, tap = entry.tap, sick = entry.sick, ctr = entry.ctr } or nil
  local function norm(s) return (tostring(s):lower():gsub("\226\136\146", "-"):gsub("[%s%.]", "")) end
  local taken, manaUsed, manaOpt, greyMana = {}, false, nil, {}
  for _, o in ipairs(others) do if tostring(o.label):find("^Mana:") then manaOpt = o end end
  for _, a in ipairs(card ~= nil and engineTextAbilities(card.tx) or {}) do
    local hit = nil
    if a.mana then hit = manaOpt
    else
      -- (an option's ability text starts with the line's cost; of several, the one whose effect starts the same)
      local head = a.keyword and norm(a.keyword) or (norm(a.cost) .. ":")
      local want = a.keyword and "" or norm(a.eff):sub(1, 10)
      for _, o in ipairs(abils) do
        local ab = norm(engineAbilityText(o))
        if not taken[o] and ab:sub(1, #head) == head then
          if hit == nil then hit = o end
          if want ~= "" and ab:sub(#head + 1, #head + #want) == want then hit = o break end
        end
      end
      if hit ~= nil then taken[hit] = true end
    end
    if hit ~= nil and hit == manaOpt then manaUsed = true end
    local r = { opt = hit and hit.id, text = a.text, cost = a.cost, mana = a.mana,
      why = hit == nil and engineAbWhy(color, card, a, p, prio) or nil }
    -- (a mana ability not offered goes last: it is used while paying, never from here)
    if hit == nil and a.mana then greyMana[#greyMana + 1] = r else rows[#rows + 1] = r end
  end
  for _, o in ipairs(abils) do if not taken[o] then rows[#rows + 1] = { opt = o.id, text = engineAbilityText(o) } end end
  for _, o in ipairs(others) do
    if not (o == manaOpt and manaUsed) then rows[#rows + 1] = { opt = o.id, text = tostring(o.label), mana = true } end
  end
  for _, r in ipairs(greyMana) do rows[#rows + 1] = r end
  return rows, card
end
-- The lines to show for that card, or nil when the panel shouldn't open for it: not yours, nothing to list, a hand
-- card with one way to play it (the drag does that), a land with only its mana abilities
function engineAbPanelRows(color, id)
  local meta = id and engineMeta[id]
  if meta == nil or meta.color ~= color then return nil end
  local rows, card = engineAbList(color, id)
  local land = engineHasType(card or engineStatic[id], "Land")
  local offered, other = 0, false
  for _, r in ipairs(rows) do
    if r.opt ~= nil then offered = offered + 1 end
    if not (r.mana and land) then other = true end
  end
  if not other or (meta.zone == "hand" and offered < 2) then return nil end
  return rows
end
-- one line's words: the cost in gold, then the effect; a greyed line's reason after it in italics. Cut to fit two lines.
function engineAbRowLabel(r)
  local text = tostring(r.text)
  local head, rest = r.cost, nil
  if head ~= nil and text:sub(1, #head) == head then rest = (text:sub(#head + 1):gsub("^:%s*", ""))
  else
    local at = text:find(":", 1, true)
    if at ~= nil and at > 1 and at <= 28 then head, rest = text:sub(1, at - 1), (text:sub(at + 1):gsub("^%s+", "")) else head, rest = nil, text end
  end
  local room = 92 - (head and #head + 2 or 0) - (r.why and #r.why + 4 or 0)
  local cut = engineCut(rest, math.max(20, room))
  if #cut < #rest then cut = cut:gsub("%s+%S*$", "") .. "…" end
  if r.opt == nil then
    return " " .. (head and (head .. ": ") or "") .. cut .. "  <i><color=#E0B060>" .. tostring(r.why or "") .. "</color></i>"
  end
  return " " .. (head and ("<b><color=#FFD27A>" .. head .. ":</color></b> ") or "") .. cut
end
function engineAbPanelHide(color)
  if engineAbPanelFor[color] ~= nil then setAttr("eng_abp_" .. color, "active", "false") end
  engineAbPanelFor[color], engineAbShown[color] = nil, nil
end
-- Shows card id's lines (on hover), or redraws them (a new question, a board update); hides the panel when the card
-- it shows has nothing left to list
function engineAbPanelShow(color, id)
  local rows = engineAbPanelRows(color, id)
  if rows == nil then
    if id ~= nil and engineAbPanelFor[color] == id then engineAbPanelHide(color) end
    return
  end
  engineAbPanelFor[color] = id
  local pg = engineAbPage[color]
  if pg == nil or pg.id ~= id then pg = { id = id, n = 0 } engineAbPage[color] = pg end
  pg.n = pg.n % math.ceil(#rows / ENGINE_AB_MAX)
  local first = pg.n * ENGINE_AB_MAX + 1
  local p = enginePrompts[color]
  engineAbShown[color] = { id = id, rows = rows, first = first, promptId = p and p.promptId }
  setText("eng_abpt_" .. color, tostring((engineStatic[id] or {}).n or "Abilities"))
  local shown = 0
  for k = 1, ENGINE_AB_MAX do
    local r = rows[first + k - 1]
    if r == nil then setButton("eng_abp_" .. color .. "_" .. k, { active = "false" })
    else
      shown = shown + 1
      -- (one call: the tooltip in a second call redrew the button grey with dark text, docs/engine-ui-spec.md 2.1)
      setButton("eng_abp_" .. color .. "_" .. k, { active = "true", text = engineAbRowLabel(r),
        tooltip = tostring(r.text) .. (r.why and ("\n" .. r.why) or ""),
        color = r.opt and ENGINE_THEME.button or ENGINE_THEME.muted, textColor = r.opt and ENGINE_THEME.text or ENGINE_THEME.mutedText })
    end
  end
  local more = #rows > ENGINE_AB_MAX
  setButton("eng_abpg_" .. color, { active = more and "true" or "false",
    text = more and string.format("More... (%d-%d of %d)", first, first + shown - 1, #rows) or " " })
  -- (as tall as its lines: one ability was a tall black box with a button at its foot)
  setAttr("eng_abp_" .. color, "height", tostring(44 + shown * 44 + (more and 34 or 0)))
  setAttr("eng_abp_" .. color, "active", "true")
end
function onMtgAbPanel(player, value, idAttr)
  local c, id = player.color, tostring(idAttr)
  if id == "eng_abpx_" .. c then return engineAbPanelHide(c) end
  if id == "eng_abpg_" .. c then
    if engineAbPage[c] ~= nil then engineAbPage[c].n = engineAbPage[c].n + 1 end
    return engineAbPanelShow(c, engineAbPanelFor[c])
  end
  local cc, k = id:match("^eng_abp_(%a+)_(%d+)$")
  if cc == nil or cc ~= c then return end
  -- (from the list the panel shows: the card's buttons may not be drawn yet; structural review 2026-10-27)
  local s = engineAbShown[c]
  local r = s and s.rows[s.first + tonumber(k) - 1]
  if r == nil then return end
  if r.opt ~= nil then return engineUseAbility(c, r.opt, s.promptId) end
  engineTell(c, tostring((engineStatic[s.id] or {}).n or "That card") .. ": " .. tostring(r.text) .. " - " .. tostring(r.why) .. ".")
end
-- (chained to the table's own onObjectHover, which keeps hoveredObjs for "mtg commander" and the hover hotkeys:
-- replacing it broke both, structural review 2026-10-27)
do
local before = onObjectHover
function onObjectHover(color, obj)
  if before ~= nil then before(color, obj) end
  if not ENGINE_MODE or obj == nil or Player[color] == nil then return end
  local id = tostring(obj.getGMNotes()):match("^engine:(engine%-card%-%d+)$")
  -- (a card pointed at afresh starts at its first page)
  if id ~= nil and engineAbPanelFor[color] ~= id then engineAbPage[color] = nil engineAbPanelShow(color, id) end
end
end

-- Does the table show exactly what the engine says? Run by the table itself as each turn starts and once attackers are
-- declared (engineCheckDue), and by tools/tts-check.lua. It reads and reports; it moves nothing.
function engineSelfCheck()
  local m = lastTable
  if m == nil then return { error = "no table yet" } end
  local problems = {}
  local function add(s) if #problems < 40 then problems[#problems + 1] = s end end

  -- every engine object by id, and the cards sitting inside graveyard/exile decks
  local byId, inPile = {}, {}
  for _, o in ipairs(getObjects()) do
    local gm = tostring(o.getGMNotes())
    if gm:find("^engine:") and not engineIsBundleObject(gm) then -- (the effect and sound bundles aren't a game's)
      local id = gm:sub(8)
      if byId[id] then add("duplicate object for " .. id) end
      byId[id] = o
      if o.type == "Deck" and (gm:find("^engine:graveyard:") or gm:find("^engine:exile:")) then
        for _, e in ipairs(o.getObjects()) do inPile[tostring(e.gm_notes):sub(8)] = gm:match("^engine:(%a+):") end
      end
    end
  end

  local function inZone(zoneObj, p)
    if zoneObj == nil then return false end
    local l = zoneObj.positionToLocal(p)
    return math.abs(l.x) <= 0.55 and math.abs(l.z) <= 0.55
  end
  local function near(a, b, r) return (a.x - b.x) ^ 2 + (a.z - b.z) ^ 2 < r * r end
  -- (the first point of the line drawn from an attacker: the table reads back the lines it drew)
  local lines = Global.getVectorLines() or {}
  local function attackLineFrom(p)
    for _, l in ipairs(lines) do
      local q = l.points and l.points[1]
      if q ~= nil and engineIsAttackLine(l) and near({ x = q.x or q[1], z = q.z or q[3] }, p, 2.5) then return true end
    end
    return false
  end
  -- What the engine says about a card on the battlefield against what a player sees on it. Each "map:" line is a fact
  -- bridge/table-map.js says is checked here, and tests/test_table_map.js looks for it.
  local function checkFacts(card, o, label)
    -- map:badges (attached cards have none; a face-down one's are on its back: updateBadge)
    -- map:counters (they are in badgeParts: a pair of +1/+1 and -1/-1 counters shows nothing, so this is what can say)
    if card.att == nil then
      local want, have = {}, {}
      for _, b in ipairs(badgeParts(card)) do want[#want + 1] = b[2] end
      for _, b in ipairs(o.getButtons() or {}) do if b.click_function == "engineNoop" then have[#have + 1] = tostring(b.label) end end
      table.sort(want) table.sort(have)
      local w, h = table.concat(want, " | "), table.concat(have, " | ")
      if w ~= h then add(label .. " shows badges [" .. h .. "], the engine says [" .. w .. "]") end
      -- map:phased
      local marked = h:find("PHASED OUT", 1, true) ~= nil and o.getColorTint().r < 0.6
      if (card.po == true) ~= marked then add(label .. (card.po and " is phased out, and the table doesn't show it" or " shows as phased out, and isn't")) end
    end
    -- map:attack
    local glow = engineStackGlow[card.id]
    if glow ~= "stack" and (card.atk == true) ~= (glow == "atk") then add(label .. (card.atk and " is attacking, and doesn't glow" or " glows as an attacker, and isn't")) end
    -- map:attackLine
    if card.atk and card.atkT ~= nil and not attackLineFrom(o.getPosition()) then add(label .. " is attacking, with no attack line from it") end
    -- map:faceDown (a player may turn their own card over to look: engineFlipped)
    if not engineFlipped[card.id] and (card.fd == true) ~= (o.is_face_down == true) then add(label .. (card.fd and " should be face down" or " should be face up")) end
    -- map:attached
    if card.att ~= nil then
      local host = byId[card.att]
      if host == nil then add(label .. " is attached to a card the table doesn't have")
      elseif not near(o.getPosition(), host.getPosition(), 2.5) then add(label .. " is attached, and lies away from its card") end
    end
  end

  -- draws and mills waiting for the player sit on top of the library, not in the hand/graveyard yet; they are the engine's cards too
  local expected, heldNow = {}, {}
  for _, p in pairs(enginePending or {}) do
    for _, id in ipairs(p.draw or {}) do heldNow[id] = true expected[id] = true end
    for _, id in ipairs(p.mill or {}) do heldNow[id] = true expected[id] = true end
  end
  local counts = {}
  -- (a playable card lies in the row of the seat that may play it, which needn't be its owner's: Thief of Sanity's and
  -- Mnemonic Betrayal's cards are the caster's to play, on the caster's mat or in the caster's second hand zone)
  local rowOf = enginePlayableRows(m)
  local handSets = {}
  local function inHandOf(color, o, which)
    local key = tostring(color) .. ":" .. which
    if handSets[key] == nil then
      handSets[key] = {}
      for _, h in ipairs(Player[color].getHandObjects(which) or {}) do handSets[key][h.getGUID()] = true end
    end
    return handSets[key][o.getGUID()] == true
  end
  for _, pl in ipairs(m.players or {}) do
    local c, d = pl.color, data[pl.color]
    counts[c] = { bf = #(pl.battlefield or {}), hand = pl.hand and #pl.hand or pl.handCount, gy = #(pl.graveyard or {}), ex = #(pl.exile or {}), cmd = #(pl.command or {}), lib = pl.library, life = pl.life }
    -- (cards playable from a library's top aren't in any zone of the board: The Reality Chip)
    for _, card in ipairs(pl.playable or {}) do expected[card.id] = true end
    -- (a hand card shown to everyone has an object of its own in the owner's strip: engineRevealStrip)
    for _, card in ipairs(pl.revealed or {}) do expected["reveal:" .. tostring(card.id)] = true end
    -- (another player's hand card this seat may cast has a stand-in in this seat's row: enginePlaceSpecial)
    for _, card in ipairs(pl.playable or {}) do expected[engineCastId(c, card.id)] = true end
    -- (a controlled player's hand, in the controller's second hand zone, or as stand-ins there: engineCtlHands)
    for _, card in ipairs(pl.ctlHand or {}) do expected[card.id] = true expected[engineCastId(pl.ctlBy, card.id)] = true end
    local handY = nil
    local function inHand(o, which) return inHandOf(c, o, which) end
    local function homeRotation()
      if handY == nil then
        local hand = Player[c].getHandTransform()
        handY = (hand and hand.rotation.y or 0) + 180
      end
      return handY
    end
    local function check(list, zone)
      for _, card in ipairs(list or {}) do
        expected[card.id] = true
        local o = byId[card.id]
        local label = (card.n or "?") .. " (" .. c .. " " .. zone .. ")"
        if o == nil and heldNow[card.id] then -- held draw/mill: drawn on the library until the player takes it
        elseif o == nil and (engineGroupOf or {})[card.id] ~= nil then -- an identical token drawn as part of a group (xN): fine
        elseif o == nil and inPile[card.id] == zone then -- inside its pile deck: fine
        -- map:present
        elseif o == nil then add("missing object: " .. label .. ((engineDebugCard and #problems < 40) and (" [" .. engineDebugCard(card.id) .. "]") or ""))
        else
          local p = o.getPosition()
          local ok = true
          -- (a playable exiled card lies in its player's playable row on the mat or in the second hand zone; a linked one
          -- under its permanent: engineMarkSpecial. Face-Breaker's impulse-drawn cards read "wrong place", hp-03 sweep)
          local special = (engineSpecial or {})[card.id]
          if special == "playable" then -- map:playable
            -- (or its row beside the hand, off the mat: enginePlaceSpecial; all of them the row's seat's, rowOf)
            local rc = rowOf[card.id] or c
            ok = inZone((data[rc] or d).playmat, p) or inHandOf(rc, o, 2) or (enginePlanned[card.id] ~= nil and near(p, enginePlanned[card.id], 1.6))
          elseif special == "linked" then -- map:linked
            local host = byId[card.ew]
            ok = host ~= nil and near(p, host.getPosition(), 2.5)
          elseif zone == "hand" then ok = inHand(o, 1)
          elseif zone == "battlefield" then ok = inZone(d.playmat, p) or card.att ~= nil
          elseif zone == "graveyard" then ok = heldNow[card.id] or near(p, d.graveyard.getPosition(), 1.6) -- (a held mill lies on its fan)
          elseif zone == "exile" then ok = near(p, engineExileSpot(d), 1.6)
          elseif zone == "command" then
            ok = false
            for _, g in ipairs(TAX_LABELS[c] or {}) do local a = getObjectFromGUID(g) if a and near(p, a.getPosition(), 1.6) then ok = true end end
          end
          local moving = o.isSmoothMoving() or o.held_by_color ~= nil -- on its way (a move, a tap turn, a player's hand): judge it next time
          -- (a face-down card a second seat may play is named from that seat's view, and this board is another seat's)
          if not (card.fd and special == "playable") then
            -- map:hoverName
            if o.getName() ~= nickname(card) then add(label .. " is named [" .. tostring(o.getName()):gsub("\n", " / ") .. "] on the table") end
            -- map:hoverText
            if o.getDescription() ~= description(card) then add(label .. " has the wrong hover text") end
          end
          -- map:place
          if not ok and not moving then add(string.format("wrong place: %s at (%.1f,%.1f,%.1f)", label, p.x, p.y, p.z)) end
          if zone == "battlefield" and not moving then checkFacts(card, o, label) end
          -- map:tapped
          if zone == "battlefield" and card.tap ~= nil and not moving then
            local tapped = math.abs(((o.getRotation().y - homeRotation() + 540) % 360) - 180) > 45
            -- (an untap waiting for its player is the player's to do: enginePending)
            if tapped ~= card.tap and not (tapped and engineHeldTapped(card.id)) then add(label .. (card.tap and " should be tapped" or " should be untapped")) end
          end
          -- map:cost (a hand or command card's cost badge, engineCostParts; none on a card its owner turned over)
          if (zone == "hand" or zone == "command") and not moving and not engineFlipped[card.id] then
            local want, have = {}, {}
            for _, b in ipairs(engineCostParts(card)) do want[#want + 1] = b[2] end
            for _, b in ipairs(o.getButtons() or {}) do if b.click_function == "engineNoop" then have[#have + 1] = tostring(b.label) end end
            table.sort(want) table.sort(have)
            local w, h = table.concat(want, " | "), table.concat(have, " | ")
            if w ~= h then add(label .. " shows cost badge [" .. h .. "], the engine's cost says [" .. w .. "]") end
          end
        end
      end
    end
    check(pl.battlefield, "battlefield")
    check(pl.graveyard, "graveyard")
    check(pl.exile, "exile")
    check(pl.command, "command")
    if pl.hand ~= nil and Player[c].seated then check(pl.hand, "hand") end
    -- life tracker follows the engine
    local t = LIFE_TRACKERS[c] and getObjectFromGUID(LIFE_TRACKERS[c])
    if t ~= nil and t.getVar("count") ~= pl.life then add(c .. " life tracker shows " .. tostring(t.getVar("count")) .. ", engine says " .. tostring(pl.life)) end
  end
  -- a spell on the stack is drawn by its own card (the stack entry's source)
  for _, s in ipairs(m.stack or {}) do if s.src then expected[s.src] = true end end
  for id, o in pairs(byId) do
    -- (a scry's cards are in the player's hand zone while they choose: engineScryPlace)
    if not expected[id] and (engineMeta[id] or {}).zone ~= "scry" and id ~= "trash" and not id:find("^library:") and not id:find("^stack:") and not id:find("^graveyard:") and not id:find("^exile:") then
      add("leftover object not in the engine's game: " .. tostring(o.getName():match("^[^\n]*")) .. " [" .. id .. "]")
    end
  end
  return { turn = m.turn, step = m.step, active = m.active, counts = counts, problems = problems }
end
-- Runs the check 3 s after a board asked for it, on whatever the newest board is by then. A problem has to still be there
-- 2 s later: a board can change while it is being checked. The bridge logs the result; nothing shows on the table.
function engineCheckRun()
  if lastTable == nil or lastTable.gameOver then return end -- (a finished game's board is being cleared)
  local function failed(why) engineSend("check", { stamp = engineStamp(), turn = lastTable and lastTable.turn, step = lastTable and lastTable.step, problems = "the check itself failed: " .. tostring(why) }) end
  local t0 = os.clock()
  local ok, first = pcall(engineSelfCheck)
  if not ok then failed(first) return end
  if first.error ~= nil then return end
  local ms = math.floor((os.clock() - t0) * 1000)
  local function send(list) engineSend("check", { stamp = engineStamp(), turn = first.turn, step = first.step, ms = ms, problems = table.concat(list, "\n") }) end
  if #first.problems == 0 then send({}) return end
  Wait.time(function()
    if lastTable == nil or lastTable.gameOver then return end
    local ok2, second = pcall(engineSelfCheck)
    if not ok2 then failed(second) return end
    if second.error ~= nil then return end
    local was, still = {}, {}
    for _, p in ipairs(first.problems) do was[p] = true end
    for _, p in ipairs(second.problems) do if was[p] then still[#still + 1] = p end end
    send(still)
  end, 2)
end
-- Called with each board: once as each turn starts, and once more when attackers are declared
function engineCheckDue(m)
  if m.gameOver then return end
  local thisTurn = engineCheckedAt ~= nil and engineCheckedAt.turn == m.turn
  if thisTurn and engineCheckedAt.attacked then return end
  local attacking = false
  for _, pl in ipairs(m.players or {}) do
    for _, c in ipairs(pl.battlefield or {}) do attacking = attacking or c.atk == true end
  end
  if thisTurn and not attacking then return end
  engineCheckedAt = { turn = m.turn, attacked = attacking }
  Wait.time(engineCheckRun, 3)
end
-- This script's version, set in the save by tools/patch-save.js; the bridge compares it with the last deploy
function engineStamp() return "dev" end
