-- Safety check before any test: "clear" only if White's library zone, hand and command zones hold nothing of the
-- player's (engine cards and test cards don't count). Otherwise names what is there.
local function theirs(o) local gm = tostring(o.getGMNotes()) return gm ~= "testcard" and not gm:find("^engine:") and gm ~= "libcard" end
local d = getDeckFromZone(data.White.libraryZone)
if d and theirs(d) then return "deck " .. d.getName() end
for _, o in ipairs(Player.White.getHandObjects() or {}) do if theirs(o) then return "hand card " .. o.getName() end end
for _, o in ipairs(getObjects()) do
  if (o.type == "Card" or o.type == "Deck") and theirs(o) then return "card/deck on the table: " .. tostring(o.getName()):gsub("\n.*", "") end
end
return "clear"
