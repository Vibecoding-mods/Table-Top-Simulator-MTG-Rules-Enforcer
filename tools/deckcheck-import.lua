-- [engine copy] DeckCheck deck links in the Card Importer (docs/deckcheck-spec.md, "Import"). make-engine-copy.js
-- appends this to the importer's script after tools/deckcheck.lua, and Importer.Deck sends a deckcheck.co link here.
-- One GET per import, no key, and nothing kept but the deck it spawns (DeckCheck's terms): the answer is read, turned
-- into the importer's entries and dropped. DeckCheck is not affiliated with this project.
-- Uses the importer's own WebGetSSL (a GET with a timeout), safeJSON, spawnDeckEntries and endLoop.

DECKCHECK_MAX_CARDS = 250 -- (a Commander deck is 100; more is a broken or hostile answer, not a deck to spawn)

-- the HTTP status of an answer: response_code; else the number after "HTTP/1.1 " in the error ("HTTP/1.1 404 Not
-- Found"); else 200 for an answer with text and no error; else 0 (no answer: a timeout or no connection)
function deckcheckStatus(wr)
  if type(wr) ~= "table" then return 0 end
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

-- the decoded answer -> the importer's entries (each card `count` times, commanders first) and the deck's GM-notes
-- tag; or nil and the plain-words reason
function deckcheckImportPlan(id, json)
  local info = deckcheckEntries(json)
  if info == nil then return nil, deckcheckError(500) end
  local total = 0
  for _, e in ipairs(info.entries) do total = total + e.count end
  if total > DECKCHECK_MAX_CARDS then
    return nil, "That DeckCheck deck has " .. string.format("%d", total) .. " cards; the importer takes at most " .. string.format("%d", DECKCHECK_MAX_CARDS) .. "."
  end
  local entries = {}
  for _, e in ipairs(info.entries) do
    for _ = 1, e.count do entries[#entries + 1] = { uuid = e.scryfall_id, name = e.name ~= "" and e.name or "Card" } end
  end
  local tag = deckcheckTag({ id = id, bracket = info.bracket, threatIndex = info.threatIndex, maxThreat = info.maxThreat })
  return { name = info.name, entries = entries, tag = tag }
end

-- "Importer deck https://deckcheck.co/app/deckview/<id>": fetch, then spawn through spawnDeckEntries, the deck named
-- as on DeckCheck and its GM notes holding the tag (the bracket and threat label reads it: engine-renderer.lua)
function fetchDeckCheckDeck(deckUrl, qTbl)
  local function fail(msg)
    Player[qTbl.color].broadcast(msg, {1, 0, 0})
    endLoop()
  end
  local id = deckcheckId(deckUrl)
  if id == nil then return fail(deckcheckError(400)) end
  WebGetSSL(DECKCHECK_API .. id, function(wr)
    local status = deckcheckStatus(wr)
    local body = type(wr.text) == "string" and safeJSON(wr.text) or nil
    local err = deckcheckError(status, body)
    if err ~= nil then return fail(err) end
    local plan, why = deckcheckImportPlan(id, body)
    if plan == nil then return fail(why) end
    qTbl.deckName = plan.name
    qTbl.full = plan.name
    qTbl.gmNotes = plan.tag
    spawnDeckEntries(plan.entries, qTbl)
  end)
end
