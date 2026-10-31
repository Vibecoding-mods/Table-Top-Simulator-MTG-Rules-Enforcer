-- Stress recorder (no debug polling needed while it runs): every 15 s logs the number of objects, engine cards,
-- the worst frame and the count of frames over 50/100 ms in that window. Read with: return table.concat(stressLog, "\n")
stressLog, stressWin = {}, { worst = 0, n50 = 0, n100 = 0, frames = 0 }
stressT0 = os.time()
if not stressHooked then
  stressHooked = true
  local prevU = onUpdate
  function onUpdate()
    local dt = Time.delta_time * 1000
    local w = stressWin
    w.frames = w.frames + 1
    if dt > w.worst then w.worst = dt end
    if dt > 50 then w.n50 = w.n50 + 1 end
    if dt > 100 then w.n100 = w.n100 + 1 end
    if prevU then prevU() end
  end
end
local function tick()
  local objs, eng, inPiles = 0, 0, 0
  for _, o in ipairs(getObjects()) do
    objs = objs + 1
    if tostring(o.getGMNotes()):find("^engine:") then eng = eng + 1 if o.type == "Deck" then inPiles = inPiles + o.getQuantity() end end
  end
  local t = engineTable and engineTable()
  local w = stressWin
  stressLog[#stressLog + 1] = string.format("%4ds turn %s: objects %d (engine %d, in piles %d), %d frames, worst %.0f ms, >50ms %d, >100ms %d",
    os.time() - stressT0, tostring(t and t.turn), objs, eng, inPiles, w.frames, w.worst, w.n50, w.n100)
  stressWin = { worst = 0, n50 = 0, n100 = 0, frames = 0 }
  if os.time() - stressT0 < (stressSecs or 900) then Wait.time(tick, 15) end
end
Wait.time(tick, 15)
return "stress recorder on"
