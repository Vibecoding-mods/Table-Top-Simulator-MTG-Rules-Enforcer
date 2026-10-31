-- Helpers for tools/handplay.js (hand-play sweep): make the gestures a player makes on the table (click a card or a
-- life counter, turn a card with Q/E) through the table's own handlers, and read back what happened.
-- Loaded once into the headless TTS (or a real one) through the bridge's /exec, after tools/tts-sim.lua.
HP = HP or {}
local TRACKERS = { White = "23e485", Red = "448880", Yellow = "37e533", Blue = "395037" }

function HP.obj(id)
  for _, o in ipairs(getObjects()) do if o.getGMNotes() == "engine:" .. tostring(id) then return o end end
end
function HP.counterOf(slot)
  for _, pl in ipairs((debugTable and debugTable.players) or {}) do
    if tostring(pl.slot) == tostring(slot) then return getObjectFromGUID(TRACKERS[pl.color] or "") end
  end
end
-- a click on a card (engine id) or on a player's life counter ("player|<slot>")
function HP.click(color, id)
  local slot = tostring(id):match("^player|(.+)$")
  if slot ~= nil then
    local o = HP.counterOf(slot)
    if o == nil then return "no life counter" end
    engineLifeTrackerClick({ guid = o.getGUID(), color = color })
    return "clicked counter"
  end
  local o = HP.obj(id)
  if o == nil then return "no object" end
  onPlayerAction(Player[color], Player.Action.Select, { o })
  return "clicked"
end
-- Q/E on a card
function HP.turn(color, id)
  local o = HP.obj(id)
  if o == nil then return "no object" end
  onPlayerAction(Player[color], Player.Action.RotateIncrementalRight, { o })
  return "turned"
end
-- what the player sees for the open question (ease-of-use review, 2026-10-22): the instruction line, the corner
-- buttons, the card row and whether the Engine panel had to open, with its title, text and buttons
function HP.seen(color)
  local A = function(id, k) return UI.getAttribute(id, k) end
  local V = function(id) return UI.getValue(id) end
  local s = { hint = V("eng_hint_" .. color), big = A("eng_big_" .. color, "active") == "true" and A("eng_big_" .. color, "text") or nil,
    big2 = A("eng_big2_" .. color, "active") == "true" and A("eng_big2_" .. color, "text") or nil,
    row = A("eng_row_" .. color, "active") == "true", panel = A("eng_panel_" .. color, "active") == "true" }
  if s.row then
    s.rowtitle = V("eng_rowtitle_" .. color) s.rowsub = V("eng_rowsub_" .. color)
    s.rowbtns = {}
    for i = 1, 8 do local id = "eng_rowopt_" .. color .. "_" .. i if A(id, "active") == "true" then s.rowbtns[#s.rowbtns + 1] = A(id, "text") end end
  end
  if s.panel then
    s.title = V("eng_title_" .. color) s.text = V("eng_text_" .. color)
    s.btns = {}
    for i = 1, 12 do local id = "eng_opt_" .. color .. "_" .. i if A(id, "active") == "true" then s.btns[#s.btns + 1] = A(id, "text") end end
  end
  return JSON.encode(s)
end
-- the open question as the table shows it: kind (action/mana/attack/block/target/cards/nil), options and picks
function HP.prompt(color)
  local p = enginePrompts[color]
  if p == nil then return "null" end
  local o = {}
  for i, x in ipairs(p.options or {}) do
    o[i] = { id = tostring(x.id), label = tostring(x.label), card = x.cardId and tostring(x.cardId) or "", img = x.img ~= nil, rank = x.rank, sel = engineSelectedFor(color, i) and true or false }
  end
  local about = {}
  for _, x in ipairs(p.aboutCards or {}) do about[#about + 1] = tostring(x) end
  return JSON.encode({ id = p.promptId, title = tostring(p.title), mode = tostring(p.mode), min = p.min or 0, max = p.max or 0, about = about, otherwiseDo = tostring(p.otherwiseDo or ""),
    kind = tostring(enginePromptKind(p)), options = o })
end
-- where the engine's last board has a card: "<colour>:<zone>[:tapped][:attacking][:blocking]", "stack" or "nowhere"
function HP.where(id)
  local m = debugTable
  if m == nil then return "no table" end
  id = tostring(id)
  for _, s in ipairs(m.stack or {}) do if tostring(s.id) == id or tostring(s.src) == id then return "stack" end end
  for _, pl in ipairs(m.players or {}) do
    for _, z in ipairs({ "hand", "battlefield", "graveyard", "exile", "command" }) do
      for _, c in ipairs(pl[z] or {}) do
        if tostring(c.id) == id then
          return pl.color .. ":" .. z .. (c.tap and ":tapped" or "") .. (c.atk and ":attacking" or "") .. (c.blk and ":blocking" or "")
        end
      end
    end
  end
  return "nowhere"
end
-- the player's cards on the battlefield: "id=name=tapped" joined by ";" (text, not JSON: see the JSON.encode freeze)
function HP.mine(color, zone)
  local out = {}
  for _, pl in ipairs((debugTable and debugTable.players) or {}) do
    if pl.color == color then
      for _, c in ipairs(pl[zone or "battlefield"] or {}) do out[#out + 1] = tostring(c.id) .. "=" .. tostring(c.n) .. "=" .. tostring(c.tap == true) end
    end
  end
  return table.concat(out, ";")
end
-- what the table told the player (the last 30 lines), so a refused gesture says why
if not HP.wrapped then
  HP.wrapped, HP.said, HP.n = true, {}, 0
  local b = broadcastToColor
  function broadcastToColor(text, color, rgb)
    HP.n = HP.n + 1
    HP.said[HP.n] = tostring(color) .. ": " .. tostring(text)
    HP.said[HP.n - 30] = nil
    return b(text, color, rgb)
  end
end
-- HP.n counts lines told so far; HP.saidSince(n) = the lines after the n-th
function HP.saidSince(n)
  local out = {}
  for i = math.max(n + 1, HP.n - 29), HP.n do out[#out + 1] = HP.said[i] end
  return table.concat(out, " || ")
end
return "handplay helpers loaded"
