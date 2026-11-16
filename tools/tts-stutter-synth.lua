-- Synthetic stutter test (no game needed). Install once through the debug channel; it then runs inside TTS:
--   window 1 (60 s): idle
--   window 2 (60 s): the bridge-side script sends 1 message a second (tools/tts-stutter-synth.js)
--   window 3 (60 s): this script sends 1 web request a second to the bridge
--   window 4 (60 s): 1 panel update a second (5 button texts, like a new prompt)
-- Result: return JSON.encode(stutterSynth)
stutterSynth = { win = 1, w = {} }
local names = { "idle", "inbound", "webrequest", "panel" }
local function cur()
  local k = stutterSynth.win .. "-" .. names[stutterSynth.win]
  stutterSynth.w[k] = stutterSynth.w[k] or { frames = 0, slow = 0, worst = 0, start = os.time(), events = 0 }
  return stutterSynth.w[k]
end
local prevMsg = onExternalMessage
function onExternalMessage(m)
  if type(m) == "table" and m.t == "noop" then cur().events = cur().events + 1 return end
  return prevMsg(m)
end
local prevUpdate = onUpdate
function onUpdate()
  if stutterSynth.win <= 4 then
    local b = cur()
    b.frames = b.frames + 1
    local dt = Time.delta_time
    if dt >= 0.1 then b.slow = b.slow + 1 end
    if dt > b.worst then b.worst = dt end
    if os.time() - b.start >= 60 then stutterSynth.win = stutterSynth.win + 1 end
  end
  if prevUpdate then prevUpdate() end
end
local n = 0
local function tick()
  if stutterSynth.win > 4 then return end
  n = n + 1
  local w = names[stutterSynth.win]
  if w == "webrequest" then
    cur().events = cur().events + 1
    WebRequest.custom("http://127.0.0.1:48787/msg", "POST", true, '{"t":"noop","json":"{}"}', { ["Content-Type"] = "application/json" }, function() end)
  elseif w == "panel" then
    (engineUI or UI).setAttribute("eng_panel_White", "active", "true")
    cur().events = cur().events + 1
    for k = 1, 5 do (engineUI or UI).setAttributes("eng_opt_White_" .. k, { text = "Option " .. k .. " #" .. n, textColor = (n % 2 == 0) and "#FFFFFF" or "#FEFEFE", active = "true" }) end
  end
  Wait.time(tick, 1)
end
Wait.time(tick, 1)
return "synthetic stutter test: 4 minutes"
