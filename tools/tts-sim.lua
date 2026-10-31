-- Test helpers loaded into the open TTS game by tools/tts-autoplay2.js.
-- Test helpers: find engine cards and simulate a player's drag-and-drop.
function simFind(pred)
  for _, o in ipairs(getObjects()) do
    local gm = tostring(o.getGMNotes())
    if gm:find("^engine:") and pred(o) then return o end
  end
end
function simHand(color)
  local out = {}
  for _, o in ipairs(Player[color].getHandObjects() or {}) do if tostring(o.getGMNotes()):find("^engine:") then out[#out + 1] = o end end
  return out
end
function simDrop(color, o, pos)
  o.setLock(false)
  o.setPosition(pos)
  onObjectDrop(color, o)
end
function simWhere(o)
  local p = o.getPosition()
  for _, h in ipairs(Player.White.getHandObjects() or {}) do if h == o then return "hand" end end
  return string.format("(%.1f,%.1f,%.1f)", p.x, p.y, p.z)
end
return "helpers loaded"
