-- [engine copy] DeckCheck deck links in rikrassen's MTG importer (docs/deckcheck-spec.md, "rikrassen's importer").
-- make-engine-copy.js puts this and tools/deckcheck.lua into the importer's script, and its M.deck hands a deckcheck.co
-- link here before it POSTs to rikrassen's server, which doesn't read DeckCheck links. One GET to DeckCheck, no key;
-- the answer becomes a plain decklist (deckcheckDecklist: the commanders under "Commander", as MTG Arena exports it)
-- and is dropped; the server builds the deck from that list. Nothing is kept (DeckCheck's terms). DeckCheck is not
-- affiliated with this project.

-- colour -> the DeckCheck tag of that seat's last deck import (deckcheckTag), nil when the last one wasn't a
-- DeckCheck link: the server builds the deck from a plain list, so the tag is put on the decks it spawns
-- (deckcheckRikTagSpawned) for the bracket and threat label (engine-renderer.lua engineDeckCheckLabels)
DECKCHECK_RIK_TAG = {}
-- colour -> how many deck imports that seat has started: only the latest one's DeckCheck answer may set its tag (an
-- earlier DeckCheck import answered after a later import of another link put its tag on that other deck)
DECKCHECK_RIK_SEQ = {}

-- M.deck's request `data` with a deckcheck.co link in data.url: true, and this takes it over: an error is said to
-- `color` in plain words and nothing is posted; else data.data = the decklist, data.url = '' and post() is called
-- once. false for any other link (or none): the server reads it, as before.
function deckcheckRikDeck(color, data, post)
  local seq = nil
  if type(color) == "string" then
    DECKCHECK_RIK_TAG[color] = nil
    DECKCHECK_RIK_SEQ[color] = (DECKCHECK_RIK_SEQ[color] or 0) + 1
    seq = DECKCHECK_RIK_SEQ[color]
  end
  local url = nil
  if type(data) == "table" then url = data.url end
  if type(url) ~= "string" or not string.find(string.lower(url), "deckcheck.co/", 1, true) then return false end
  local function fail(msg)
    broadcastToColor(msg, color, Color.Red)
  end
  local id = deckcheckId(url)
  if id == nil then
    fail(deckcheckError(400))
    return true
  end
  WebRequest.get(DECKCHECK_API .. id, function(wr)
    local body = nil
    -- (a WebRequest userdata in real TTS, a table in tests)
    if (type(wr) == "table" or type(wr) == "userdata") and type(wr.text) == "string" and wr.text ~= "" then
      local ok, v = pcall(JSON.decode, wr.text)
      if ok and type(v) == "table" then body = v end
    end
    local err = deckcheckError(deckcheckStatus(wr), body)
    if err ~= nil then return fail(err) end
    local info = deckcheckEntries(body)
    if info == nil then return fail(deckcheckError(500)) end
    local big = deckcheckTooBig(info)
    if big ~= nil then return fail(big) end
    local text = deckcheckDecklist(info)
    if text == nil then return fail("That DeckCheck deck has no cards.") end
    data.data = text
    data.url = ''
    if DECKCHECK_RIK_SEQ[color] == seq then DECKCHECK_RIK_TAG[color] = deckcheckTag({ id = id, bracket = info.bracket, threatIndex = info.threatIndex, maxThreat = info.maxThreat }) end
    post()
  end)
  return true
end

-- each object the importer spawns from the server's answer (its callback, make-engine-copy.js): a Deck spawned for a
-- seat's deck request whose link was DeckCheck's gets that deck's tag in its GM notes, after any notes it already has
function deckcheckRikTagSpawned(color, reqType, obj)
  if reqType ~= "deck" or type(color) ~= "string" or obj == nil then return end
  local tag = DECKCHECK_RIK_TAG[color]
  if tag == nil or obj.type ~= "Deck" then return end
  local notes = tostring(obj.getGMNotes() or "")
  if notes == "" then obj.setGMNotes(tag) else obj.setGMNotes(notes .. "\n" .. tag) end
end
