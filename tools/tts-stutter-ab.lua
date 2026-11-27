-- Stutter A/B test, run once through the debug channel while a game is going (White against Forge AI).
-- Everything after this runs inside TTS, so no debug commands disturb the measurement:
--   * an autopilot answers White's prompts every 1.5 s (first option / confirm / no blocks / all attack)
--   * every 90 s the mode changes: A = normal, B = board updates decoded but not drawn, C = board updates ignored
--   * per mode it counts frames, frames >= 100 ms, wall seconds and board messages
-- Read the result afterwards:  return JSON.encode(stutterAB)
stutterAB = { modes = {}, order = { "A", "B", "C", "A", "B", "C" }, idx = 1 }
local origMsg = onExternalMessage
local origRender = engineRender
local function mode() return stutterAB.order[stutterAB.idx] end
local function bucket()
  local m = mode()
  stutterAB.modes[m .. stutterAB.idx] = stutterAB.modes[m .. stutterAB.idx] or { frames = 0, slow = 0, msgs = 0, start = os.time() }
  return stutterAB.modes[m .. stutterAB.idx]
end

function onExternalMessage(msg)
  -- (after the last bucket mode() is nil: bucket() would concatenate nil and every table message would throw before origMsg)
  if mode() ~= nil and type(msg) == "table" and msg.t == "table" then
    bucket().msgs = bucket().msgs + 1
    if mode() == "C" then return end
  end
  return origMsg(msg)
end
function engineRender(m)
  if mode() == "B" then lastTableForTest = m return end
  return origRender(m)
end

local prevUpdate = onUpdate
function onUpdate()
  if stutterAB.idx <= #stutterAB.order then
    local b = bucket()
    b.frames = b.frames + 1
    if Time.delta_time >= 0.1 then b.slow = b.slow + 1 end
    b.secs = os.time() - b.start
    if b.secs >= 90 then
      stutterAB.idx = stutterAB.idx + 1
      if mode() ~= "B" and lastTableForTest ~= nil then origRender(lastTableForTest) end
      if mode() == nil then onExternalMessage = origMsg engineRender = origRender end -- (the test is over: the wrappers come off)
    end
  end
  if prevUpdate then prevUpdate() end
end

local function autopilot()
  if stutterAB.idx > #stutterAB.order then return end
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
return "stutter A/B test running for 9 minutes"
