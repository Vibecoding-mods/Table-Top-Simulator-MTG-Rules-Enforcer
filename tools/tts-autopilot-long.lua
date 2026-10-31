autopilotSecs = autopilotSecs or 900
-- In-TTS autopilot for White (no debug commands while it plays): 240 s from install.
autopilotStart = os.time()
local function autopilot()
  if os.time() - autopilotStart > (autopilotSecs or 240) then return end
  if engineReleasePending then engineReleasePending("White", "all") end
  local p = enginePrompts.White
  if p ~= nil then
    local quick
    for i, o in ipairs(p.options or {}) do if o.id == "__allattack" then quick = i end end
    if tostring(p.title):find("^Declare blockers") then onMtgClick(Player.White, nil, "confirm|White")
    elseif quick then onMtgClick(Player.White, nil, "o|White|" .. quick)
    elseif tostring(p.title):find("^Pay ") and (function()
        for _, o in ipairs(p.options or {}) do local id = tostring(o.id) if id:find("^tap:") or id:find("^untap:") then return true end end
        return false end)() then -- a mana payment ("Pay 1 life" is a yes/no question and falls through)
      -- pay with a source if one is offered; otherwise cancel (choosing "undo mana" forever was a loop)
      -- Auto-pay first (tapping the first source can be the wrong colour: City of Brass for {W} on a {R} cost
      -- looped forever), then a source, then cancel
      local tap, cancel, auto
      for i, o in ipairs(p.options or {}) do
        local id = tostring(o.id)
        if id:find("^tap:") and tap == nil then tap = i end
        if id == "__cancel" then cancel = i end
        if (id == "__auto" or id == "__pool") and autopilotAutoFor ~= p.promptId then auto = i end
      end
      if auto then autopilotAutoFor = p.promptId end
      local pick = auto or tap or cancel
      if pick then onMtgClick(Player.White, nil, "o|White|" .. pick) end
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
return "autopilot on for " .. (autopilotSecs or 240) .. " s"
