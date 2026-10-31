-- Click latency: from White's click (an answer leaving TTS) to the web request finishing and to the next prompt or
-- board arriving. Uses frame counts and Time.time (no JSON of odd tables). Read: return engineLatencyReport()
latency = { clicks = {}, frame = 0 }
local prevUpdate = onUpdate
function onUpdate() latency.frame = latency.frame + 1 if prevUpdate then prevUpdate() end end
local cur = nil
local prevSend = engineSend
function engineSend(t, payload)
  if t == "answer" or t == "intent" then cur = { t0 = Time.time, f0 = latency.frame } latency.clicks[#latency.clicks + 1] = cur end
  return prevSend(t, payload)
end
local prevPrompt = engineOnPrompt
function engineOnPrompt(m)
  if cur ~= nil and m.promptId ~= nil and cur.prompt == nil then
    cur.prompt = string.format("%.0fms/%df", (Time.time - cur.t0) * 1000, latency.frame - cur.f0)
  end
  return prevPrompt(m)
end
local prevRender = engineRender
function engineRender(m)
  if cur ~= nil and cur.board == nil then cur.board = string.format("%.0fms/%df", (Time.time - cur.t0) * 1000, latency.frame - cur.f0) end
  return prevRender(m)
end
function engineLatencyReport()
  local out = {}
  for i, c in ipairs(latency.clicks) do out[#out + 1] = i .. ": board " .. tostring(c.board) .. ", next prompt " .. tostring(c.prompt) end
  return table.concat(out, " | ")
end
return "latency probe on"
