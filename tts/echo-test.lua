-- TTS latency echo test (SPEC.md §6, test 1). Paste into Global script, Save & Play.
-- Needs bridge/echo-bridge.js running. Type "echotest" (or "echotest 2000") in chat.

local N = 500
local sentAt = {}
local results = {}
local i = 0
local running = false

function onLoad()
  sendExternalMessage({ t = "hello" })
  print("[echo] Ready. Type 'echotest' in chat.")
end

function onChat(message, player)
  local n = message:match("^echotest%s*(%d*)$")
  if n == nil then return true end
  if running then print("[echo] Already running.") return false end
  N = tonumber(n) or 500
  results, i, running = {}, 0, true
  print("[echo] Sending " .. N .. " pings...")
  nextPing()
  return false
end

function nextPing()
  i = i + 1
  if i > N then return finish() end
  sentAt[i] = os.clock()
  sendExternalMessage({ t = "ping", id = i })
end

function onExternalMessage(data)
  if data.t == "pong" and sentAt[data.id] then
    results[#results + 1] = (os.clock() - sentAt[data.id]) * 1000
    nextPing()
  end
end

function finish()
  running = false
  local sorted = {}
  for k, v in ipairs(results) do sorted[k] = v end
  table.sort(sorted)
  local function pct(p) return sorted[math.max(1, math.floor(p / 100 * #sorted))] end
  print(string.format("[echo] %d pings  p50 %.1f ms  p95 %.1f ms  p99 %.1f ms  max %.1f ms",
    #sorted, pct(50), pct(95), pct(99), sorted[#sorted]))
  sendExternalMessage({ t = "results", ms = results })
end
