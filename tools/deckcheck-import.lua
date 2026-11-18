-- [engine copy] DeckCheck deck links in the Card Importer (docs/deckcheck-spec.md, "Import"). make-engine-copy.js
-- appends this to the importer's script after tools/deckcheck.lua, and Importer.Deck sends a deckcheck.co link here.
-- One GET per import, no key, and nothing kept but the deck it spawns (DeckCheck's terms): the answer is read, turned
-- into the importer's entries and dropped. DeckCheck is not affiliated with this project.
-- Uses the importer's own WebGetSSL (a GET with a timeout), safeJSON, spawnDeckEntries and endLoop.

-- (deckcheckStatus, DECKCHECK_MAX_CARDS and deckcheckTooBig are in tools/deckcheck.lua: rikrassen's importer uses them
-- too, tools/deckcheck-rik.lua)

-- the decoded answer -> the importer's entries (each card `count` times, commanders first) and the deck's GM-notes
-- tag; or nil and the plain-words reason
function deckcheckImportPlan(id, json)
  local info = deckcheckEntries(json)
  if info == nil then return nil, deckcheckError(500) end
  local big = deckcheckTooBig(info)
  if big ~= nil then return nil, big end
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
