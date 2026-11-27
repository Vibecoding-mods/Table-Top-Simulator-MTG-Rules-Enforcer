-- Stutter timeline: records the wall-clock second of every slow frame (>= 100 ms) for 3 minutes while the White
-- autopilot plays, so it can be lined up with Docker CPU samples taken at the same time.
-- Result: return engineTimelineReport()  (plain text, no JSON: TTS's JSON encoder froze the game on a table keyed by
-- fractional os.time() values, see tts-frame-counter.lua; whole seconds in a plain list here)
stutterTL = { slowAt = {}, frames = {}, start = math.floor(os.time()) }
for i = 1, 181 do stutterTL.frames[i] = 0 end
local prevUpdate = onUpdate
function onUpdate()
  local s = math.floor(os.time()) - stutterTL.start + 1
  if s >= 1 and s <= 181 then
    stutterTL.frames[s] = stutterTL.frames[s] + 1
    if Time.delta_time >= 0.1 then stutterTL.slowAt[#stutterTL.slowAt + 1] = s end
  end
  if prevUpdate then prevUpdate() end
end
-- "frames in second 1 ... 181|slow at: the seconds (counted from the start) of each slow frame"
function engineTimelineReport()
  return table.concat(stutterTL.frames, " ") .. "|slow at: " .. table.concat(stutterTL.slowAt, " ")
end
local function autopilot()
  if os.time() - stutterTL.start > 180 then return end
  if engineReleasePending then engineReleasePending("White", "all") end
  local p = enginePrompts.White
  if p ~= nil then
    local quick
    for i, o in ipairs(p.options or {}) do if o.id == "__allattack" then quick = i end end
    if tostring(p.title):find("^Declare blockers") then onMtgClick(Player.White, nil, "confirm|White")
    elseif quick then onMtgClick(Player.White, nil, "o|White|" .. quick)
    elseif p.mode == "multi" then
      for i = 1, (p.min or 0) do onMtgClick(Player.White, nil, "o|White|" .. i) end
      onMtgClick(Player.White, nil, "confirm|White")
    else
      local pickI = 1
      for i, o in ipairs(p.options or {}) do
        local l = tostring(o.label)
        if l:find("^Play ") then pickI = i break end
        if l:find("^Cast ") and pickI == 1 then pickI = i end
      end
      onMtgClick(Player.White, nil, "o|White|" .. pickI)
    end
  end
  Wait.time(autopilot, 1.5)
end
Wait.time(autopilot, 1.5)
return "timeline started at " .. stutterTL.start .. ", read it with engineTimelineReport()"
