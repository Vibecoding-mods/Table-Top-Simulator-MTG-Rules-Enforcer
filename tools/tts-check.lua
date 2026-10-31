-- Consistency check for the engine renderer: does the table show exactly what the engine says?
-- Run through the bridge debug channel (tools/tts-exec.sh). Needs the debugTable hook (see tts-autoplay.js).
local m = debugTable
if m == nil then return JSON.encode({ error = "no table yet" }) end
local problems = {}
local function add(s) if #problems < 40 then problems[#problems + 1] = s end end

local byId, dupes = {}, {}
for _, o in ipairs(getObjects()) do
  local gm = tostring(o.getGMNotes())
  if gm:find("^engine:") then
    local id = gm:sub(8)
    if byId[id] then dupes[#dupes + 1] = id end
    byId[id] = o
  end
end
for _, id in ipairs(dupes) do add("duplicate object for " .. id) end

local function inZone(zoneObj, p)
  if zoneObj == nil then return false end
  local l = zoneObj.positionToLocal(p)
  return math.abs(l.x) <= 0.55 and math.abs(l.z) <= 0.55
end
local function near(a, b, r) return (a.x - b.x) ^ 2 + (a.z - b.z) ^ 2 < r * r end
local labels = { White = {"908f60", "ce8ea5"}, Red = {"9d380e", "16aed3"}, Yellow = {"baffa9", "dc9c6d"}, Blue = {"0c0c5e", "3b2d18"} }

-- cards sitting inside graveyard/exile decks
local inPile = {}
for _, o in ipairs(getObjects()) do
  local gm = tostring(o.getGMNotes())
  if o.type == "Deck" and (gm:find("^engine:graveyard:") or gm:find("^engine:exile:")) then
    for _, e in ipairs(o.getObjects()) do inPile[tostring(e.gm_notes):sub(8)] = gm:match("^engine:(%a+):") end
  end
end
local expected = {}
-- draws and mills waiting for the player sit on top of the library, not in the hand/graveyard yet
local heldNow = {}
for _, p in pairs(enginePending or {}) do
  for _, id in ipairs(p.draw or {}) do heldNow[id] = true end
  for _, id in ipairs(p.mill or {}) do heldNow[id] = true end
end
local counts = {}
for _, pl in ipairs(m.players or {}) do
  local c, d = pl.color, data[pl.color]
  counts[c] = { bf = #(pl.battlefield or {}), hand = pl.hand and #pl.hand or pl.handCount, gy = #(pl.graveyard or {}), ex = #(pl.exile or {}), cmd = #(pl.command or {}), lib = pl.library, life = pl.life }
  local function check(list, zone)
    for _, card in ipairs(list or {}) do
      expected[card.id] = true
      local o = byId[card.id]
      local label = (card.n or "?") .. " (" .. c .. " " .. zone .. ")"
      if o == nil and heldNow[card.id] then -- held draw/mill: drawn on the library until the player takes it
      elseif o == nil and (engineGroupOf or {})[card.id] ~= nil then -- an identical token drawn as part of a group (xN): fine
      elseif o == nil and inPile[card.id] == zone then -- inside its pile deck: fine
      elseif o == nil then add("missing object: " .. label .. (engineDebugCard and (" [" .. engineDebugCard(card.id) .. "]") or ""))
      else
        local p = o.getPosition()
        local ok = true
        -- (a playable exiled card lies in its player's playable row on the mat or in the second hand zone; a linked one
        -- under its permanent: engineMarkSpecial. Face-Breaker's impulse-drawn cards read "wrong place", hp-03 sweep)
        local special = (engineSpecial or {})[card.id]
        if special == "playable" then
          ok = inZone(d.playmat, p)
          for _, h in ipairs(Player[c].getHandObjects(2) or {}) do if h == o then ok = true end end
        elseif special == "linked" then
          local host = card.ew and byId[card.ew]
          ok = host ~= nil and near(p, host.getPosition(), 2.5)
        elseif zone == "hand" then
          ok = false
          for _, h in ipairs(Player[c].getHandObjects() or {}) do if h == o then ok = true end end
        elseif zone == "battlefield" then ok = inZone(d.playmat, p) or card.att ~= nil
        elseif zone == "graveyard" then ok = near(p, d.graveyard.getPosition(), 1.6)
        elseif zone == "exile" then ok = near(p, d.libraryZone.getPosition() + d.libraryZone.getTransformForward() * 4.16, 1.6)
        elseif zone == "command" then
          ok = false
          for _, g in ipairs(labels[c] or {}) do local a = getObjectFromGUID(g) if a and near(p, a.getPosition(), 1.6) then ok = true end end
        end
        local moving = o.isSmoothMoving() -- still on its way (a move or a tap/untap turn in progress): judge it next time
        if not ok and not moving then add(string.format("wrong place: %s at (%.1f,%.1f,%.1f)", label, p.x, p.y, p.z)) end
        if zone == "battlefield" and card.tap ~= nil and not moving then
          local ry = o.getRotation().y
          local hand = Player[c].getHandTransform()
          local base = (hand and hand.rotation.y or 0) + 180
          local tapped = math.abs(((ry - base + 540) % 360) - 180) > 45
          if tapped ~= card.tap then add(label .. (card.tap and " should be tapped" or " should be untapped")) end
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
  local lt = ({ White = "23e485", Red = "448880", Yellow = "37e533", Blue = "395037" })[c]
  local t = lt and getObjectFromGUID(lt)
  if t ~= nil and t.getVar("count") ~= pl.life then add(c .. " life tracker shows " .. tostring(t.getVar("count")) .. ", engine says " .. tostring(pl.life)) end
end
-- a spell on the stack is drawn by its own card (the stack entry's source)
for _, s in ipairs(m.stack or {}) do if s.src then expected[s.src] = true end end
-- held draws and mills (waiting for the player) are the engine's cards too
for _, p in pairs(enginePending or {}) do
  for _, id in ipairs(p.draw or {}) do expected[id] = true end
  for _, id in ipairs(p.mill or {}) do expected[id] = true end
end
for id, o in pairs(byId) do
  if not expected[id] and id ~= "trash" and not id:find("^library:") and not id:find("^stack:") and not id:find("^graveyard:") and not id:find("^exile:") then
    add("leftover object not in the engine's game: " .. tostring(o.getName():match("^[^\n]*")) .. " [" .. id .. "]")
  end
end
return JSON.encode({ turn = m.turn, step = m.step, active = m.active, counts = counts, problems = problems })
