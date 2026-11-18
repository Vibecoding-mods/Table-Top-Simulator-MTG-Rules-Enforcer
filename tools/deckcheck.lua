-- DeckCheck (deckcheck.co) deck links: pure functions, no TTS calls (docs/deckcheck-spec.md).
-- Inserted into the table's Card Importer script later; tested headless by tests/test_deckcheck.js.
-- MoonSharp-safe: plain string.find + sub (no captures over long text), no goto, `local x = nil` in for-in bodies.
-- DeckCheck is not affiliated with this project; its public API is used read-only, one request per import.

DECKCHECK_API = "https://deckcheck.co/api/external/deck?deck_id="
DECKCHECK_TAG = "[deckcheck]"
DECKCHECK_MAX_THREAT = 96
DECKCHECK_KINDS = { "deckview", "decklist", "builder" }

-- a whole number >= 0 (JSON numbers can arrive as 3.0), or nil
function deckcheckWhole(v)
  local n = tonumber(v)
  if n == nil or n ~= n or n < 0 or n == math.huge or n ~= math.floor(n) then return nil end
  return math.floor(n)
end

-- letters, digits, _ and - only, 1 to 64 long (checked byte by byte: no pattern to blow up)
function deckcheckIdOk(id)
  if type(id) ~= "string" or id == "" or string.len(id) > 64 then return false end
  for i = 1, string.len(id) do
    local b = string.byte(id, i)
    local ok = (b >= 48 and b <= 57) or (b >= 65 and b <= 90) or (b >= 97 and b <= 122) or b == 95 or b == 45
    if not ok then return false end
  end
  return true
end

-- the deck id in a DeckCheck link (/app/deckview|decklist|builder/<id>), or nil
function deckcheckId(url)
  if type(url) ~= "string" then return nil end
  local s = url
  while string.len(s) > 0 and string.find(" \t\r\n<>", string.sub(s, 1, 1), 1, true) do s = string.sub(s, 2) end
  while string.len(s) > 0 and string.find(" \t\r\n<>", string.sub(s, -1), 1, true) do s = string.sub(s, 1, -2) end
  local low = string.lower(s)
  if string.sub(low, 1, 8) == "https://" then s = string.sub(s, 9)
  elseif string.sub(low, 1, 7) == "http://" then s = string.sub(s, 8) end
  low = string.lower(s)
  if string.sub(low, 1, 4) == "www." then s = string.sub(s, 5) low = string.sub(low, 5) end
  if string.sub(low, 1, 13) ~= "deckcheck.co/" then return nil end
  local path = string.sub(s, 13) -- from the "/"
  if string.sub(path, 1, 5) ~= "/app/" then return nil end
  local rest = string.sub(path, 6)
  local id = nil
  for _, kind in ipairs(DECKCHECK_KINDS) do
    if string.sub(rest, 1, string.len(kind) + 1) == kind .. "/" then id = string.sub(rest, string.len(kind) + 2) end
  end
  if id == nil then return nil end
  local cut = string.len(id) + 1
  for _, ch in ipairs({ "/", "?", "#" }) do
    local at = string.find(id, ch, 1, true)
    if at and at < cut then cut = at end
  end
  id = string.sub(id, 1, cut - 1)
  if not deckcheckIdOk(id) then return nil end
  return id
end

-- one board's cards (an object keyed by deckCardId, or a list) → entries sorted by name then scryfallId,
-- the same scryfallId merged; cards with no scryfallId or a quantity of 0 are left out. An entry also has `set` and
-- `number` (setCode, collectorNumber) when both are plain codes (letters, digits, _ and -, up to 16 long)
function deckcheckBoard(boards, key)
  local out = {}
  local board = nil
  if type(boards) == "table" then board = boards[key] end
  if type(board) ~= "table" or type(board.cards) ~= "table" then return out end
  local byId = {}
  for _, e in pairs(board.cards) do
    local c = nil
    if type(e) == "table" then c = e.card end
    if type(c) == "table" and type(c.scryfallId) == "string" and c.scryfallId ~= "" then
      local q = 1
      if e.quantity ~= nil then q = deckcheckWhole(e.quantity) or 0 end
      if q > 0 then
        local have = byId[c.scryfallId]
        if have then have.count = have.count + q
        else
          have = { scryfall_id = c.scryfallId, name = type(c.name) == "string" and c.name or "", count = q }
          if deckcheckIdOk(c.setCode) and deckcheckIdOk(c.collectorNumber) and string.len(c.setCode) <= 16 and string.len(c.collectorNumber) <= 16 then
            have.set = c.setCode
            have.number = c.collectorNumber
          end
          byId[c.scryfallId] = have
          out[#out + 1] = have
        end
      end
    end
  end
  table.sort(out, function(a, b)
    if a.name ~= b.name then return a.name < b.name end
    return a.scryfall_id < b.scryfall_id
  end)
  return out
end

-- the decoded /deck response → { name, commanders, entries (commanders first), bracket, threatIndex, maxThreat }
-- or nil when it isn't a deck at all
function deckcheckEntries(json)
  if type(json) ~= "table" then return nil end
  local commanders = deckcheckBoard(json.boards, "commanders")
  local main = deckcheckBoard(json.boards, "mainboard")
  local entries = {}
  for _, e in ipairs(commanders) do entries[#entries + 1] = e end
  for _, e in ipairs(main) do entries[#entries + 1] = e end
  local dti = nil
  if type(json.dti) == "table" then dti = json.dti end
  local threat = deckcheckWhole(json.threatIndex)
  if threat == nil and dti then threat = deckcheckWhole(dti.score) end
  local maxThreat = nil
  if dti then maxThreat = deckcheckWhole(dti.maxScore) end
  if maxThreat == nil or maxThreat == 0 then maxThreat = DECKCHECK_MAX_THREAT end
  local name = "DeckCheck deck"
  if type(json.name) == "string" and json.name ~= "" then name = json.name end
  return {
    name = name, commanders = commanders, entries = entries,
    bracket = deckcheckWhole(json.bracket), threatIndex = threat, maxThreat = maxThreat,
  }
end

-- the plain-words chat message for a failed request (nil for a 2xx)
function deckcheckError(status, body)
  local s = tonumber(status)
  if s == nil or s == 0 then return "Couldn't reach DeckCheck. Check the internet connection and try again." end
  if s >= 200 and s < 300 then return nil end
  if s == 400 then return "That doesn't look like a DeckCheck deck link. Copy the link from the deck's page on deckcheck.co and try again." end
  if s == 403 then return "That DeckCheck deck is private: make it public or unlisted on DeckCheck and try again." end
  if s == 404 then return "DeckCheck has no deck at that link. Check the link and try again." end
  if s == 429 then return "DeckCheck is busy (too many requests). Wait a few seconds and try again." end
  if s >= 500 and s < 600 then return "DeckCheck had a problem on its side. Try again in a minute." end
  local why = ""
  if type(body) == "table" and type(body.error) == "string" and body.error ~= "" then
    why = ": " .. string.sub(body.error, 1, 120)
  end
  return "DeckCheck didn't send the deck (error " .. string.format("%d", math.floor(s)) .. ")" .. why .. "."
end

-- the HTTP status of a TTS web answer: response_code; else the number after "HTTP/1.1 " in the error ("HTTP/1.1 404
-- Not Found"); else 200 for an answer with text and no error; else 0 (no answer: a timeout or no connection)
-- (real TTS answers with a WebRequest userdata, not a table: a "table" check read every answer as no connection, live
-- 2026-11-18, with rikrassen's importer and the Card Importer both)
function deckcheckStatus(wr)
  if type(wr) ~= "table" and type(wr) ~= "userdata" then return 0 end
  local s = tonumber(wr.response_code)
  if s ~= nil and s > 0 then return math.floor(s) end
  local e = tostring(wr.error or "")
  local at = string.find(e, "HTTP/", 1, true)
  if at ~= nil then
    local sp = string.find(e, " ", at, true)
    local n = sp and tonumber(string.sub(e, sp + 1, sp + 3)) or nil
    if n ~= nil and n >= 100 and n < 600 then return math.floor(n) end
  end
  if not wr.is_error and type(wr.text) == "string" and wr.text ~= "" then return 200 end
  return 0
end

DECKCHECK_MAX_CARDS = 250 -- (a Commander deck is 100; more is a broken or hostile answer, not a deck to spawn)

-- the plain-words refusal for a deck (deckcheckEntries) of more than DECKCHECK_MAX_CARDS cards, or nil
function deckcheckTooBig(info)
  local total = 0
  for _, e in ipairs(info.entries) do total = total + e.count end
  if total <= DECKCHECK_MAX_CARDS then return nil end
  return "That DeckCheck deck has " .. string.format("%d", total) .. " cards; the importer takes at most " .. string.format("%d", DECKCHECK_MAX_CARDS) .. "."
end

-- one decklist line, MTG Arena style: "4 Lightning Strike (m19) 152", or "4 Lightning Strike" without a printing
-- (rikrassen's server falls back to the name for a printing it doesn't know). A line break in the name becomes a
-- space, so a name can't add lines; nil for an entry with no name.
function deckcheckDecklistLine(e)
  local raw = type(e.name) == "string" and e.name or ""
  local parts = {}
  for i = 1, string.len(raw) do
    local ch = string.sub(raw, i, i)
    if ch == "\r" or ch == "\n" or ch == "\t" then ch = " " end
    parts[#parts + 1] = ch
  end
  local name = table.concat(parts)
  while string.sub(name, 1, 1) == " " do name = string.sub(name, 2) end
  while string.len(name) > 0 and string.sub(name, -1) == " " do name = string.sub(name, 1, -2) end
  if name == "" then return nil end
  local line = string.format("%d", e.count) .. " " .. name
  if e.set ~= nil and e.number ~= nil then line = line .. " (" .. e.set .. ") " .. e.number end
  return line
end

-- a deck (deckcheckEntries) as a plain decklist, MTG Arena style: the commanders under "Commander", the rest under
-- "Deck", a blank line between; a deck with no commander has the "Deck" part only. nil when no card has a name.
function deckcheckDecklist(info)
  if type(info) ~= "table" or type(info.entries) ~= "table" then return nil end
  local nCommanders = type(info.commanders) == "table" and #info.commanders or 0
  local commanders, deck = {}, {}
  for i, e in ipairs(info.entries) do
    local line = deckcheckDecklistLine(e)
    if line ~= nil then
      if i <= nCommanders then commanders[#commanders + 1] = line else deck[#deck + 1] = line end
    end
  end
  local out = {}
  if #commanders > 0 then
    out[#out + 1] = "Commander"
    for _, l in ipairs(commanders) do out[#out + 1] = l end
  end
  if #deck > 0 then
    if #out > 0 then out[#out + 1] = "" end
    out[#out + 1] = "Deck"
    for _, l in ipairs(deck) do out[#out + 1] = l end
  end
  if #out == 0 then return nil end
  return table.concat(out, "\n")
end

-- the GM-notes line for a deck from DeckCheck: "[deckcheck] id=<id> bracket=3 threat=54/96" (missing parts left out)
function deckcheckTag(info)
  if type(info) ~= "table" or not deckcheckIdOk(info.id) then return nil end
  local line = DECKCHECK_TAG .. " id=" .. info.id
  local b = deckcheckWhole(info.bracket)
  if b ~= nil then line = line .. " bracket=" .. string.format("%d", b) end
  local t = deckcheckWhole(info.threatIndex)
  if t ~= nil then
    local m = deckcheckWhole(info.maxThreat)
    if m == nil or m == 0 then m = DECKCHECK_MAX_THREAT end
    line = line .. " threat=" .. string.format("%d", t) .. "/" .. string.format("%d", m)
  end
  return line
end

-- one tag line → { source = "deckcheck", id, bracket, threatIndex, maxThreat }, or nil
function deckcheckParseTag(line)
  local n = string.len(DECKCHECK_TAG)
  if string.sub(line, 1, n + 1) ~= DECKCHECK_TAG .. " " then return nil end
  local info = { source = "deckcheck" }
  local rest = string.sub(line, n + 2) .. " "
  local at = 1
  while at <= string.len(rest) do
    local sp = string.find(rest, " ", at, true)
    local word = string.sub(rest, at, sp - 1)
    at = sp + 1
    local eq = string.find(word, "=", 1, true)
    if eq then
      local k, v = string.sub(word, 1, eq - 1), string.sub(word, eq + 1)
      if k == "id" and deckcheckIdOk(v) then info.id = v
      elseif k == "bracket" then info.bracket = deckcheckWhole(v)
      elseif k == "threat" then
        local sl = string.find(v, "/", 1, true)
        if sl then
          info.threatIndex = deckcheckWhole(string.sub(v, 1, sl - 1))
          info.maxThreat = deckcheckWhole(string.sub(v, sl + 1))
        else info.threatIndex = deckcheckWhole(v) end
      end
    end
  end
  if info.id == nil then return nil end
  if info.threatIndex ~= nil and (info.maxThreat == nil or info.maxThreat == 0) then info.maxThreat = DECKCHECK_MAX_THREAT end
  return info
end

-- the tag in a deck's GM notes (any other lines are ignored; the first tag wins), or nil
function deckcheckReadTag(notes)
  if type(notes) ~= "string" or notes == "" then return nil end
  local at = 1
  local len = string.len(notes)
  while at <= len do
    local nl = string.find(notes, "\n", at, true) or (len + 1)
    local line = string.sub(notes, at, nl - 1)
    if string.sub(line, -1) == "\r" then line = string.sub(line, 1, -2) end
    while string.sub(line, 1, 1) == " " or string.sub(line, 1, 1) == "\t" do line = string.sub(line, 2) end
    local info = deckcheckParseTag(line)
    if info then return info end
    at = nl + 1
  end
  return nil
end

-- the label next to the commander: "Bracket 3 · Threat 54/96", one half when the other is missing, or nil
-- Each bracket's Threat Index range, from DeckCheck's "How the Threat Index works" (updated 2026-10).
-- A gate or a card can raise a deck's bracket, so its score may sit outside its bracket's range.
DECKCHECK_BRACKET_RANGE = { { 0, 15 }, { 16, 31 }, { 32, 51 }, { 52, 67 }, { 68, 96 } }

function deckcheckLabel(info)
  if type(info) ~= "table" then return nil end
  local parts = {}
  local b = deckcheckWhole(info.bracket)
  if b ~= nil then parts[#parts + 1] = "Bracket " .. string.format("%d", b) end
  local t = deckcheckWhole(info.threatIndex)
  if t ~= nil then
    local range = nil
    if b ~= nil then range = DECKCHECK_BRACKET_RANGE[b] end
    if range ~= nil then
      parts[#parts + 1] = "Threat " .. string.format("%d", t) .. " (" .. string.format("%d", range[1]) .. "-" .. string.format("%d", range[2]) .. ")"
    else
      local m = deckcheckWhole(info.maxThreat)
      if m == nil or m == 0 then m = DECKCHECK_MAX_THREAT end
      parts[#parts + 1] = "Threat " .. string.format("%d", t) .. "/" .. string.format("%d", m)
    end
  end
  if #parts == 0 then return nil end
  return table.concat(parts, " \194\183 ")
end
