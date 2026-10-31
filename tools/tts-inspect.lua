-- Summary of the engine's cards on the table, for testing through the debug channel.
local out = { zones = {}, cards = 0, samples = {}, prompt = nil }
local function near(p, q, r) return (p.x - q.x) ^ 2 + (p.z - q.z) ^ 2 < r * r end
local function where(o)
  local p = o.getPosition()
  for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do
    for _, h in ipairs(Player[c].getHandObjects() or {}) do if h == o then return c .. ":hand" end end
    local d = data[c]
    if d then
      if near(p, d.libraryZone.getPosition(), 1.5) then return c .. ":library" end
      if near(p, d.graveyard.getPosition(), 1.5) then return c .. ":graveyard" end
      if near(p, d.libraryZone.getPosition() + d.libraryZone.getTransformForward() * 4.16, 1.5) then return c .. ":exile" end
      local m = d.playmat.getPosition()
      if math.abs(p.x - m.x) < 18.5 and math.abs(p.z - m.z) < 10.4 then return c .. ":playmat" end
    end
  end
  if p.y > 2.5 and math.abs(p.x) < 6 and math.abs(p.z) < 3 then return "stack" end
  return string.format("other(%.1f,%.1f,%.1f)", p.x, p.y, p.z)
end
for _, o in ipairs(getObjects()) do
  local gm = tostring(o.getGMNotes())
  if gm:find("^engine:") then
    out.cards = out.cards + 1
    local z = where(o)
    out.zones[z] = (out.zones[z] or 0) + 1
    if #out.samples < 6 or z:find("command") or z:find("other") then
      local p, r = o.getPosition(), o.getRotation()
      out.samples[#out.samples + 1] = string.format("%s @%s pos(%.1f,%.1f,%.1f) rot(%.0f,%.0f,%.0f) locked=%s", (o.getName():match("^[^\n]*")), z, p.x, p.y, p.z, r.x, r.y, r.z, tostring(o.getLock()))
    end
  end
end
local life = getObjectFromGUID("23e485")
out.whiteLife = life and life.getVar("count")
out.turn = Turns.turn_color
out.engineMode = ENGINE_MODE
local p = enginePrompts and enginePrompts.White
if p then out.prompt = { title = p.title, mode = p.mode, options = #(p.options or {}), first = p.options and p.options[1] and p.options[1].label } end
local stashedDeck = getDeckFromZone(data.White.libraryZone)
out.importedDeckStillInZone = stashedDeck ~= nil
return JSON.encode(out)
