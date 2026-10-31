-- MTG rules-enforced board, M3 text version (SPEC.md §5). Global script.
-- Needs bridge/bridge.js running. Chat commands: mtg help | mtg start [ai N] | mtg deck <id> | mtg decks | mtg reset

local views = {}      -- color -> latest board view from the bridge
local prompts = {}    -- color -> open prompt (title, text, mode, options, min, max, cancel, promptId)
local selected = {}   -- color -> { [optionIndex] = true } for multi-select prompts
local hidden = {}     -- color -> true when the player collapsed the panel
local renderQueued = false

-- TTS only passes flat messages intact, so payloads travel as JSON strings both ways: { t, json }.
local function send(t, payload)
  payload = payload or {}
  payload.t = t
  sendExternalMessage({ t = t, json = JSON.encode(payload) })
end

-- ───────── helpers ─────────
local function esc(s)
  s = tostring(s or "")
  s = s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"):gsub("'", "&apos;"):gsub("\n", "&#10;")
  return s
end

local function list(t, sep)
  local out = {}
  for _, v in ipairs(t or {}) do out[#out + 1] = tostring(v) end
  return table.concat(out, sep or ", ")
end

local function count(t)
  local n = 0
  for _ in pairs(t or {}) do n = n + 1 end
  return n
end

local function seatedColors()
  local out = {}
  for _, c in ipairs(getSeatedPlayers()) do
    if c ~= "Grey" and c ~= "Black" then out[#out + 1] = c end
  end
  return out
end

-- ───────── board text (Unity rich text, escaped into the XML attribute) ─────────
local function boardText(v)
  local lines = {}
  local function add(s) lines[#lines + 1] = s end
  if v.gameOver then add("<color=#ffd166><b>GAME OVER</b>" .. (v.winner and (" - winner: " .. v.winner) or "") .. "</color>") end
  add(string.format("<b>Turn %s</b> - %s - active: <b>%s</b> - priority: <b>%s</b>", tostring(v.turn), tostring(v.step), tostring(v.active), tostring(v.priority)))
  if v.stack and #v.stack > 0 then
    add("<color=#ff9f43><b>Stack</b> (top first):</color>")
    for i = #v.stack, 1, -1 do add("  " .. v.stack[i]) end
  end
  for _, p in ipairs(v.players or {}) do
    add("")
    local head = "<b>" .. p.name .. "</b>" .. (p.you and " (you)" or "")
    if p.active then head = head .. " <color=#7bed9f>[turn]</color>" end
    if p.priority then head = head .. " <color=#70a1ff>[priority]</color>" end
    if p.status and p.status ~= "playing" then head = head .. " <color=#ff6b6b>[" .. p.status .. "]</color>" end
    add(head)
    local stats = string.format("  Life <b>%s</b> - Hand %s - Library %s - Graveyard %s - Exile %s", p.life, p.hand, p.library, p.graveyard, p.exile)
    if p.poison and p.poison > 0 then stats = stats .. " - Poison " .. p.poison end
    add(stats)
    if p.command and #p.command > 0 then add("  Command zone: " .. list(p.command)) end
    if p.commanderDamage and #p.commanderDamage > 0 then add("  <color=#ff6b6b>Commander damage taken: " .. list(p.commanderDamage) .. "</color>") end
    if p.lands and #p.lands > 0 then add("  Lands (untapped/total): " .. list(p.lands)) end
    if p.permanents and #p.permanents > 0 then add("  Permanents: " .. list(p.permanents)) end
  end
  if v.hand then
    add("")
    add("<b>Your hand (" .. #v.hand .. "):</b> " .. list(v.hand))
  end
  return table.concat(lines, "\n")
end

-- ───────── UI XML ─────────
local function button(id, label, color, enabled)
  return string.format('<Button id="%s" onClick="onMtgClick" minHeight="34" fontSize="15" color="%s" textColor="#ffffff" interactable="%s">%s</Button>',
    id, color or "#2f3542", enabled == false and "false" or "true", esc(label))
end

local function promptXml(color)
  local p = prompts[color]
  if not p then return '<Text fontSize="14" color="#aaaaaa" alignment="MiddleLeft">Waiting for the engine...</Text>' end
  local x = {}
  x[#x + 1] = string.format('<Text fontSize="17" fontStyle="Bold" color="#ffd166" alignment="MiddleLeft">%s</Text>', esc(p.title))
  if p.text and p.text ~= "" then
    x[#x + 1] = string.format('<Text fontSize="13" color="#dddddd" alignment="UpperLeft" contentSizeFitter="vertical">%s</Text>', esc(p.text))
  end
  local opts = p.options or {}
  if p.mode == "single" then
    for i, o in ipairs(opts) do x[#x + 1] = button("o|" .. color .. "|" .. i, o.label, i == 1 and "#1e6f5c" or nil) end
  elseif p.mode == "multi" then
    local sel = selected[color] or {}
    for i, o in ipairs(opts) do
      x[#x + 1] = button("o|" .. color .. "|" .. i, (sel[i] and "[x] " or "[  ] ") .. o.label, sel[i] and "#3742fa" or nil)
    end
    local n = count(sel)
    local ok = n >= (p.min or 0) and n <= (p.max or 99)
    x[#x + 1] = button("confirm|" .. color, string.format("Confirm (%d selected, need %s)", n,
      (p.min == p.max) and tostring(p.min) or (tostring(p.min) .. "-" .. tostring(p.max))), ok and "#1e6f5c" or "#555555", ok)
    if p.cancel then x[#x + 1] = button("cancel|" .. color, "Cancel", "#8b1e1e") end
  elseif p.mode == "number" then
    local hi = math.min(p.max or 0, (p.min or 0) + 20)
    for n = p.min or 0, hi do x[#x + 1] = button("n|" .. color .. "|" .. n, tostring(n)) end
  end
  return table.concat(x)
end

local function panelXml(color)
  local v = views[color]
  local toggle = string.format(
    '<Button id="toggle|%s" onClick="onMtgClick" visibility="%s" width="110" height="36" rectAlignment="UpperRight" offsetXY="-10 -60" color="#1e272e" textColor="#ffffff" fontSize="15">%s</Button>',
    color, color, hidden[color] and "MTG  show" or "MTG  hide")
  if hidden[color] or (not v and not prompts[color]) then return toggle end
  return toggle .. string.format([[
<Panel visibility="%s" width="600" height="940" rectAlignment="MiddleRight" offsetXY="-10 -20" color="rgba(10,12,16,0.92)">
  <VerticalLayout padding="10 10 10 10" spacing="8" childForceExpandHeight="false">
    <VerticalScrollView preferredHeight="560" flexibleHeight="0" color="rgba(0,0,0,0)" scrollSensitivity="40">
      <VerticalLayout contentSizeFitter="vertical" childForceExpandHeight="false" padding="2 14 2 2">
        <Text fontSize="14" color="#f1f2f6" alignment="UpperLeft" contentSizeFitter="vertical" horizontalOverflow="Wrap">%s</Text>
      </VerticalLayout>
    </VerticalScrollView>
    <VerticalScrollView preferredHeight="350" flexibleHeight="0" color="rgba(255,255,255,0.04)" scrollSensitivity="40">
      <VerticalLayout contentSizeFitter="vertical" childForceExpandHeight="false" spacing="4" padding="4 14 4 4">%s</VerticalLayout>
    </VerticalScrollView>
  </VerticalLayout>
</Panel>]], color, esc(v and boardText(v) or "Waiting for the game to start..."), promptXml(color))
end

local function render()
  if renderQueued then return end
  renderQueued = true
  Wait.frames(function()
    renderQueued = false
    local parts = {}
    for _, c in ipairs(seatedColors()) do parts[#parts + 1] = panelXml(c) end
    UI.setXml(table.concat(parts, "\n"))
  end, 1)
end

-- ───────── clicks ─────────
local function answer(color, choice)
  local p = prompts[color]
  if not p then return end
  send("answer", { color = color, promptId = p.promptId, choice = choice })
  prompts[color] = nil
  selected[color] = nil
  render()
end

function onMtgClick(player, value, id)
  local kind, color, arg = id:match("^(%a+)|(%a+)|?(.*)$")
  if not kind or player.color ~= color then return end
  local p = prompts[color]
  if kind == "toggle" then
    hidden[color] = not hidden[color]
  elseif kind == "o" and p then
    local i = tonumber(arg)
    if p.mode == "single" then
      return answer(color, { p.options[i].id })
    end
    selected[color] = selected[color] or {}
    if selected[color][i] then selected[color][i] = nil
    elseif count(selected[color]) < (p.max or 99) then selected[color][i] = true end
  elseif kind == "confirm" and p then
    local ids = {}
    for i, o in ipairs(p.options or {}) do if selected[color] and selected[color][i] then ids[#ids + 1] = o.id end end
    return answer(color, ids)
  elseif kind == "cancel" and p then
    return answer(color, { "__cancel" })
  elseif kind == "n" and p then
    return answer(color, { tonumber(arg) })
  end
  render()
end

-- ───────── bridge messages ─────────
function onExternalMessage(m)
  if type(m.json) == "string" then
    local ok, d = pcall(JSON.decode, m.json)
    if not ok or type(d) ~= "table" then return end
    m = d
  end
  if m.t == "view" then
    views[m.color] = m.view
    render()
  elseif m.t == "prompt" then
    if m.promptId == nil then prompts[m.color] = nil else prompts[m.color] = m end
    selected[m.color] = nil
    hidden[m.color] = nil
    render()
  elseif m.t == "chat" then
    if m.color and Player[m.color] and Player[m.color].seated then
      broadcastToColor(m.text, m.color, { 1, 0.85, 0.4 })
    else
      broadcastToAll(m.text, { 1, 0.85, 0.4 })
    end
  elseif m.t == "clear" then
    views, prompts, selected = {}, {}, {}
    render()
  end
end

-- ───────── chat commands ─────────
function onChat(message, player)
  local cmd, rest = message:match("^mtg%s*(%a*)%s*(.*)$")
  if cmd == nil then return true end
  if cmd == "" or cmd == "help" then
    printToColor("[MTG] mtg start [ai N] - start a game with everyone seated (+ N Forge AI players)\n" ..
      "mtg deck <id> - pick your Commander deck before start (mtg decks lists them)\n" ..
      "mtg reset - end the game and restart the engine room\n" ..
      "Use the MTG panel on the right; 'MTG hide' toggles it.", player.color, { 1, 0.85, 0.4 })
  elseif cmd == "start" then
    local n = tonumber(rest:match("ai%s*(%d+)") or rest:match("(%d+)") or "0")
    send("start", { seats = seatedColors(), bots = n })
  elseif cmd == "deck" or cmd == "decks" then
    send("deck", { color = player.color, deck = (cmd == "deck" and rest ~= "") and rest or nil })
  elseif cmd == "reset" then
    send("reset", {})
  else
    return true
  end
  return false
end

function onPlayerChangeColor() render() end

function onLoad()
  send("hello", {})
  print("[MTG] Board script loaded. Type 'mtg help'.")
  render()
end
