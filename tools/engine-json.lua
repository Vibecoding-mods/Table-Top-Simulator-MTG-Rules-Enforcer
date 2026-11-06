-- engineJsonDecode(s): a JSON decoder for TTS (MoonSharp) whose cost grows with the size, not with its square.
-- Why: TTS's JSON.decode is a Lua library that calls string.find once per token, and in TTS every string.find,
-- string.match and string.gsub call first copies the whole text (measured: 100 finds cost ~0 ms on 1 KB and 2-3.5 ms
-- on 40 KB; one gsub over 25 KB ~100 ms). So JSON.decode takes ~1.2-2 s on 25 KB and ~7 s on 56 KB.
-- string.gmatch steps, string.sub and string.byte do not copy the text.
-- How:
--   1. One gmatch walks the text one string at a time: '([^"]*)"([^"]*)"()' gives the structural text before a
--      string (the "gap", e.g. ',' or '},{' or ':25,') and the string's body.
--   2. A gap becomes a short list of steps ({ [ } ] and number/true/false/null values), worked out once per
--      distinct gap and cached (a real 56 KB message has ~3,000 gaps but only ~25-35 distinct ones).
--   3. The body is a key (in an object, when no key is waiting) or a value.
--   4. A body ending in an odd number of backslashes ended at an escaped quote, not at the string's end; and in TTS
--      a pattern sees only each character's low byte, so U+2022 (the bullet in modal card text), U+2122 and every
--      U+xx22 also end a body. Either way the real end is found with a plain string.find (exact), and the gmatch
--      starts again after it (one restart per such character). Bodies holding a backslash are unescaped.
-- Result matches JSON.decode: arrays 1-based, [] and {} both plain empty tables, null -> nil (a hole in an array, an
-- absent key in an object), object keys stay strings, numbers via tonumber. One deliberate difference: \uXXXX above
-- 127 becomes that character (JSON.decode gives its UTF-8 bytes as separate characters, i.e. mojibake); the bridge
-- never sends those (JSON.stringify writes non-ASCII as itself), only \u0000-\u001f, which come out the same.
-- Lenient: it does not check commas and colons, so some invalid texts decode instead of erroring. Unbalanced
-- brackets, unterminated strings and bad values raise an error. A text that is not an object or array goes to
-- JSON.decode.
-- A global function with its helpers in a closure (the table's main chunk has no locals to spare).
-- tools/make-engine-copy.js appends this file to the table's Global ahead of engine-renderer.lua; engineOnMessage
-- decodes the bridge's { t, json } messages with it and falls back to JSON.decode on an error.
-- Tested by tests/test_engine_json.js (real messages and edge cases against JSON.parse; prototype and timings in
-- tmp/json-decode/bench.md).
engineJsonDecode = (function()
  local sub, gmatch, find, match, byte, char, tonumber, concat = string.sub, string.gmatch, string.find, string.match, string.byte, string.char, tonumber, table.concat
  local ESC = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
  local NONE = {} -- a gap piece that is only whitespace
  local NULL = {} -- the literal null
  local gapSteps = {} -- gap text -> its steps (shared by every call: gaps repeat across messages too)
  local gapCount = 0

  -- a number, true, false or null
  local function prim(g)
    local v = tonumber(g)
    if v ~= nil then return v end
    if g == "true" then return true elseif g == "false" then return false elseif g == "null" then return NULL end
    g = match(g, "^%s*(.-)%s*$")
    if g == "" then return NONE end
    v = tonumber(g)
    if v ~= nil then return v end
    if g == "true" then return true elseif g == "false" then return false elseif g == "null" then return NULL end
    error("bad JSON value '" .. sub(g, 1, 20) .. "'")
  end

  -- the steps of one gap: "{", "[", "}", "]" or a box { value } (commas and colons need no step)
  local function compile(g)
    local steps, k, pos, len = {}, 0, 1, #g
    while pos <= len do
      local a = find(g, "[{}%[%],:]", pos)
      local stop = a or len + 1
      if stop > pos then
        local v = prim(sub(g, pos, stop - 1))
        if v ~= NONE then k = k + 1; steps[k] = { v } end
      end
      if a == nil then break end
      local c = sub(g, a, a)
      if c ~= "," and c ~= ":" then k = k + 1; steps[k] = c end
      pos = a + 1
    end
    if gapCount < 2000 and len <= 64 then gapCount = gapCount + 1; gapSteps[g] = steps end -- (gaps holding numbers vary: a cap)
    return steps
  end

  -- the text of a string body holding backslash escapes
  local function unescape(raw)
    local out, k, pos = {}, 0, 1
    while true do
      local b = find(raw, "\\", pos, true)
      if b == nil then k = k + 1; out[k] = sub(raw, pos); break end
      k = k + 1; out[k] = sub(raw, pos, b - 1)
      local e = sub(raw, b + 1, b + 1)
      if e == "u" then
        local code = tonumber(sub(raw, b + 2, b + 5), 16)
        if code == nil then error("bad JSON \\u escape") end
        k = k + 1; out[k] = char(code) -- (TTS strings are UTF-16: a surrogate pair stays two halves, as it should)
        pos = b + 6
      else
        local v = ESC[e]
        if v == nil then error("bad JSON escape \\" .. e) end
        k = k + 1; out[k] = v
        pos = b + 2
      end
    end
    return concat(out)
  end

  -- does this body end in an odd number of backslashes (so its closing quote was escaped)?
  -- (string.byte loops, not patterns: in TTS a pattern that fails and retries ~150+ times raises "pattern too
  -- complex", e.g. match(s, '^.*()"') with 300 characters after the last quote)
  local function oddTail(body)
    local k, n = #body, 0
    while k > 0 and byte(body, k) == 92 do n = n + 1; k = k - 1 end
    return n % 2 == 1
  end

  return function(s)
    local b1 = byte(s, 1)
    if b1 ~= 123 and b1 ~= 91 then -- not { or [ at once: allow leading whitespace, else hand it to JSON.decode
      local first = match(s, "^%s*(.)")
      if first ~= "{" and first ~= "[" then return JSON.decode(s) end
    end
    local esc = find(s, "\\", 1, true) ~= nil
    -- the last quote: the gmatch runs only up to it (past it, a failing gmatch errors, see above)
    local q = #s
    while q > 0 and byte(s, q) ~= 34 do q = q - 1 end
    if q == 0 then q = nil end
    local SC, SA, SN, sp = {}, {}, {}, 0 -- the stack of open containers: table, is-array, item count
    local root, cur, isArr, an, key = nil, nil, false, 0, nil
    local function gap(g)
      local steps = gapSteps[g] or compile(g)
      for k = 1, #steps do
        local st = steps[k]
        if st == "{" or st == "[" then
          local t = {}
          if cur == nil then
            if root ~= nil then error("JSON text continues after the end") end
            root = t
          elseif isArr then an = an + 1; cur[an] = t
          else cur[key] = t; key = nil end
          sp = sp + 1; SC[sp] = cur; SA[sp] = isArr; SN[sp] = an
          cur, isArr, an = t, st == "[", 0
        elseif st == "}" or st == "]" then
          if sp == 0 then error("unbalanced JSON") end
          cur, isArr, an = SC[sp], SA[sp], SN[sp]
          sp = sp - 1
        else
          if cur == nil then error("JSON value outside any container") end
          local v = st[1]
          if v == NULL then v = nil end
          if isArr then an = an + 1; cur[an] = v else cur[key] = v; key = nil end
        end
      end
    end
    local base = 1 -- where the current gmatch started in s
    while q ~= nil and base <= q do
      local restart = nil
      for g, body, e in gmatch(sub(s, base, q), '([^"]*)"([^"]*)"()') do
        if g ~= ":" and g ~= "," then gap(g) end -- (the commonest gaps need no step: skip the call)
        if cur == nil then error("JSON string outside any container") end
        if byte(s, base + e - 2) ~= 34 or (esc and oddTail(body)) then
          -- the "quote" that ended this body was escaped, or was not a quote at all: in TTS, pattern matching sees
          -- only a character's low byte, so U+2022 (the bullet in modal card text), U+2122 (TM) and every other
          -- U+xx22 count as '"' (string.byte and plain string.find see them right). Find the string's real end.
          local from = base + e - 2 - #body -- the body's first character in s
          local p = base + e - 1 -- just past that character
          while true do
            local qq = find(s, '"', p, true)
            if qq == nil or qq > q then error("unterminated JSON string") end
            if not oddTail(sub(s, from, qq - 1)) then p = qq; break end
            p = qq + 1
          end
          body = sub(s, from, p - 1)
          restart = p + 1
        end
        if esc and find(body, "\\", 1, true) then body = unescape(body) end
        if isArr then an = an + 1; cur[an] = body
        elseif key == nil then key = body
        else cur[key] = body; key = nil end
        if restart then break end
      end
      if restart == nil then break end
      base = restart
    end
    gap(q and sub(s, q + 1) or s)
    if sp ~= 0 or root == nil then error("unbalanced JSON") end
    return root
  end
end)()
