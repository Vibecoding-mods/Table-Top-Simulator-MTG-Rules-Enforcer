-- Counts frames and slow frames (>= 100 ms) per whole second for 240 s, doing nothing else.
-- Install once through the debug channel; read with: return engineFrameReport()
-- (Keys are whole numbers in a plain list: TTS's JSON encoder froze the game on a table keyed by fractional
--  os.time() values, which is what hung TTS during the first versions of this test.)
frameCounter = { start = math.floor(os.time()), perSec = {}, slowPerSec = {}, slow = 0, frames = 0 }
for i = 1, 240 do frameCounter.perSec[i] = 0 frameCounter.slowPerSec[i] = 0 end
local prevUpdate = onUpdate
function onUpdate()
  local fc = frameCounter
  local i = math.floor(os.time()) - fc.start + 1
  if i >= 1 and i <= 240 then
    fc.frames = fc.frames + 1
    fc.perSec[i] = fc.perSec[i] + 1
    if Time.delta_time >= 0.1 then
      fc.slow = fc.slow + 1
      fc.slowPerSec[i] = fc.slowPerSec[i] + 1
    end
  end
  if prevUpdate then prevUpdate() end
end
-- plain text, no JSON: "frames slow|frames slow|..." one entry per second
function engineFrameReport()
  local parts = {}
  for i = 1, 240 do parts[i] = frameCounter.perSec[i] .. " " .. frameCounter.slowPerSec[i] end
  return table.concat(parts, "|")
end
return "frame counter running for 240 s"
