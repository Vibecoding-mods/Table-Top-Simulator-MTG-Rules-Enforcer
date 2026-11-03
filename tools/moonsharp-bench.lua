-- How fast is TTS's Lua? Timings for the own-engine spec (docs/spec-own-engine.md, Phase 0). No game may be running: it stalls TTS.
--   tools/tts-exec.sh tools/moonsharp-bench.lua
local out = {}
local function t(name, n, f)
  local a = os.clock()
  f()
  local d = os.clock() - a
  out[#out + 1] = name .. ": " .. string.format("%.0f", n / (d * 1000)) .. " per ms (" .. string.format("%.0f", d * 1000) .. " ms)"
end
t("empty loop", 2000000, function() local x = 0 for i = 1, 2000000 do x = x + i end end)
t("function call", 500000, function() local function f(a) return a + 1 end local x = 0 for i = 1, 500000 do x = f(x) end end)
t("table field", 1000000, function() local o = { a = 1, b = 2 } for i = 1, 1000000 do o.a = o.b + i end end)
t("new table", 200000, function() for i = 1, 200000 do local o = { a = i, b = { i } } end end)
t("method via metatable", 300000, function()
  local C = {} C.__index = C
  function C.get(self) return self.v end
  local o = setmetatable({ v = 1 }, C)
  local x = 0
  for i = 1, 300000 do x = x + o:get() end
end)
t("string concat", 200000, function() for i = 1, 200000 do local s = "card" .. i end end)
t("string match", 50000, function()
  local s = "Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self"
  for i = 1, 50000 do local b = s:match("Origin%$ (%a+)") end
end)
for _, lines in ipairs({ 12000, 60000, 240000 }) do
  local src = {}
  for i = 1, lines / 6 do src[#src + 1] = "function gen" .. i .. "(a, b)\n  local x = a + b\n  if x > 3 then return { v = x, w = 'text' } end\n  for i = 1, 3 do x = x + i end\n  return x\nend\n" end
  local code = table.concat(src)
  local a = os.clock()
  local f = load(code)
  local c = os.clock() - a
  local b = os.clock()
  f()
  out[#out + 1] = "compile " .. lines .. " lines, " .. math.floor(#code / 1024) .. " KB: " .. string.format("%.0f", c * 1000) .. " ms, run the chunk " .. string.format("%.0f", (os.clock() - b) * 1000) .. " ms"
end
return table.concat(out, "\n")
