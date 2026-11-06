-- Helpers for tests/test_engine_json.js, loaded after tts-sim.lua and before tools/engine-json.lua.
--   __lowByteOn(): string.gmatch sees text the way TTS (MoonSharp, UTF-16 strings) does for the decoder's one pattern.
--   __canon(v): a decoded value as sorted "path<TAB>value" rows, compared with the same rows from JSON.parse.

-- TTS matches patterns on each character's low byte only, so U+2022 (the bullet in modal card text), U+2122, U+0122
-- and every U+xx22 count as '"' (tmp/json-decode/bench.md). fengari's strings are UTF-8 bytes and never show this. The
-- emulation runs the real gmatch on a shadow copy of the text in which the last byte of every such character is '"'
-- (the same length, so every position matches), and cuts the captures from the real text. Must be on before the
-- decoder loads: it keeps string.gmatch in a local.
function __lowByteOn()
  local realGmatch, gsub, byte, sub = string.gmatch, string.gsub, string.byte, string.sub
  local function shadow(s)
    return (gsub(s, "[\194-\244][\128-\191]+", function(c)
      local b1, cp = byte(c, 1), nil
      if b1 < 224 then cp = (b1 % 32) * 64 + byte(c, 2) % 64
      elseif b1 < 240 then cp = ((b1 % 16) * 64 + byte(c, 2) % 64) * 64 + byte(c, 3) % 64
      else cp = (((b1 % 8) * 64 + byte(c, 2) % 64) * 64 + byte(c, 3) % 64) * 64 + byte(c, 4) % 64 end
      if cp % 256 == 34 then return sub(c, 1, -2) .. '"' end
      return c
    end))
  end
  __lowByteHits = 0
  string.gmatch = function(s, pat)
    if pat ~= '([^"]*)"([^"]*)"()' then return realGmatch(s, pat) end
    local sh = shadow(s)
    if sh ~= s then __lowByteHits = __lowByteHits + 1 end
    local it = realGmatch(sh, '()[^"]*()"()[^"]*()"()')
    return function()
      local a, b, c, d, e = it()
      if a == nil then return nil end
      return sub(s, a, b - 1), sub(s, c, d - 1), e
    end
  end
end

local function hex(s) return (string.gsub(s, ".", function(c) return string.format("%02x", string.byte(c)) end)) end
function __canon(v)
  local rows = {}
  local function walk(x, path)
    local t = type(x)
    if t == "table" then
      rows[#rows + 1] = path .. "\t{}"
      for k, val in pairs(x) do
        local seg = type(k) == "number" and ("n" .. string.format("%.17g", k)) or ("s" .. hex(tostring(k)))
        walk(val, path .. "/" .. seg)
      end
    elseif t == "string" then rows[#rows + 1] = path .. "\ts" .. hex(x)
    elseif t == "number" then rows[#rows + 1] = path .. "\tn" .. string.format("%.17g", x)
    elseif t == "boolean" then rows[#rows + 1] = path .. "\tb" .. tostring(x)
    else rows[#rows + 1] = path .. "\t?" .. t end
  end
  walk(v, "")
  table.sort(rows)
  return table.concat(rows, "\n")
end

-- decodes __text (a global set by the driver): "ok\n<rows>" or "err\n<message>"
function __decodeText()
  local ok, v = pcall(engineJsonDecode, __text)
  if not ok then return "err\n" .. tostring(v) end
  return "ok\n" .. __canon(v)
end
