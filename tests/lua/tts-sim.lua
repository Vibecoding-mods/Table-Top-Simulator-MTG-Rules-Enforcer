-- A stand-in for Tabletop Simulator's Lua API, enough to run the table's Global script outside TTS (on fengari,
-- Lua 5.3) for the golden-master test. Everything the script does to the world is recorded in __fx (in order);
-- time only moves when the driver calls __sim.frames(n). Objects come from the save (__sim.load).
-- Not modelled: physics, object scripts other than Global (obj.call records the call and returns nil), rendering.
local SIM = { frame = 0, clock = 0, guidN = 0, objects = {}, order = {}, waits = {}, waitN = 0, xml = "", attrs = {}, values = {},
  seated = {}, host = "Blue", hands = {} }
__sim = SIM
__fx = {}

-- ───────── recording ─────────
local function r3(n) if type(n) ~= "number" then return n end return math.floor(n * 1000 + 0.5) / 1000 end
local function show(v, depth)
  depth = depth or 0
  local t = type(v)
  if t == "number" then local x = r3(v) local i = math.tointeger(x) if i then return tostring(i) end return tostring(x) end
  if t == "string" then return string.format("%q", v) end
  if t == "table" then
    if v.__vector then return string.format("V(%s,%s,%s)", show(v.x), show(v.y), show(v.z)) end
    if v.__obj then return "obj:" .. v.__guid end
    if depth > 3 then return "{...}" end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    local parts = {}
    for _, k in ipairs(keys) do parts[#parts + 1] = tostring(k) .. "=" .. show(v[k], depth + 1) end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  if t == "function" then return "fn" end
  return tostring(v)
end
SIM.show = show
local function fx(...)
  if SIM.quiet then return end -- (a test timing the script: the record's own string building isn't the script's)
  local parts = { "f" .. SIM.frame }
  for i = 1, select("#", ...) do parts[#parts + 1] = show((select(i, ...))) end
  __fx[#__fx + 1] = table.concat(parts, " ")
end
SIM.fx = fx
-- short stable fingerprint of a long string (XML), so a change shows without storing 30 KB per call
-- (kept below 2^31: fengari's integers are 32-bit)
local function hash(s)
  local h = 5381.0
  for i = 1, #s do h = (h * 33 + s:byte(i)) % 2147483647 end
  return tostring(math.tointeger(h)) .. "/" .. #s
end
SIM.hash = hash

-- ───────── Lua 5.1/MoonSharp names the script expects ─────────
unpack = unpack or table.unpack
loadstring = loadstring or load
math.pow = math.pow or function(a, b) return a ^ b end
-- MoonSharp differences, measured on TTS's own interpreter 2026-11-02 (tests/test_tts_sim_contract.js):
-- error(table) arrives as a string (a string error keeps its level: the wrapper is not a tail call, so level + 1)
do
  local rawError = error
  error = function(e, level)
    if type(e) == "table" then rawError(tostring(e), 0) end
    if level == 0 then rawError(e, 0) end
    rawError(e, (level or 1) + 1)
  end
end
-- select("#") with no arguments is 1 (inside a script function: for i = 1, select("#", ...) runs once on nil)
do
  local rawSelect = select
  select = function(n, ...)
    if n == "#" then local k = rawSelect("#", ...) if k == 0 then return 1 end return k end
    return rawSelect(n, ...)
  end
end

-- ───────── Vector ─────────
local V = {}
V.__index = function(t, k)
  if k == 1 then return rawget(t, "x") elseif k == 2 then return rawget(t, "y") elseif k == 3 then return rawget(t, "z") end
  return V[k]
end
-- (and v[1] = ... sets x, as on a TTS Vector: the table's own onPlayerDisconnect turns hand cards with rot[3] = 180)
V.__newindex = function(t, k, v)
  if k == 1 then rawset(t, "x", v) elseif k == 2 then rawset(t, "y", v) elseif k == 3 then rawset(t, "z", v) else rawset(t, k, v) end
end
local function vec(x, y, z)
  if type(x) == "table" then
    local t = x
    x, y, z = t.x or t[1] or 0, t.y or t[2] or 0, t.z or t[3] or 0
  end
  return setmetatable({ x = x or 0, y = y or 0, z = z or 0, __vector = true }, V)
end
V.__add = function(a, b) a, b = vec(a), vec(b) return vec(a.x + b.x, a.y + b.y, a.z + b.z) end
V.__sub = function(a, b) a, b = vec(a), vec(b) return vec(a.x - b.x, a.y - b.y, a.z - b.z) end
V.__mul = function(a, b)
  if type(a) == "number" then a, b = b, a end
  if type(b) == "number" then return vec(a.x * b, a.y * b, a.z * b) end
  return vec(a.x * b.x, a.y * b.y, a.z * b.z)
end
V.__div = function(a, b) return vec(a.x / b, a.y / b, a.z / b) end
V.__unm = function(a) return vec(-a.x, -a.y, -a.z) end
V.__eq = function(a, b) return a.x == b.x and a.y == b.y and a.z == b.z end
V.__tostring = function(a) return string.format("Vector: { %s, %s, %s }", tostring(a.x), tostring(a.y), tostring(a.z)) end
function V.magnitude(a) return math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) end
function V.normalized(a) local m = V.magnitude(a) if m == 0 then return vec(0, 0, 0) end return vec(a.x / m, a.y / m, a.z / m) end
function V.normalize(a) local n = V.normalized(a) a.x, a.y, a.z = n.x, n.y, n.z return a end
function V.copy(a) return vec(a.x, a.y, a.z) end
function V.distance(a, b) return V.magnitude(vec(a) - vec(b)) end
function V.dot(a, b) return a.x * b.x + a.y * b.y + a.z * b.z end
function V.setAt(a, k, v) a[k] = v return a end
function V.get(a) return a.x, a.y, a.z end
function V.scale(a, s) if type(s) == "number" then a.x, a.y, a.z = a.x * s, a.y * s, a.z * s else a.x, a.y, a.z = a.x * s.x, a.y * s.y, a.z * s.z end return a end
function V.add(a, b) a.x, a.y, a.z = a.x + b.x, a.y + b.y, a.z + b.z return a end
function V.sub(a, b) a.x, a.y, a.z = a.x - b.x, a.y - b.y, a.z - b.z return a end
function V.rotateOver(a, axis, ang)
  local r = math.rad(ang)
  local c, s = math.cos(r), math.sin(r)
  if axis == "y" then a.x, a.z = a.x * c + a.z * s, -a.x * s + a.z * c
  elseif axis == "x" then a.y, a.z = a.y * c - a.z * s, a.y * s + a.z * c
  else a.x, a.y = a.x * c - a.y * s, a.x * s + a.y * c end
  return a
end
Vector = setmetatable({ new = vec }, { __call = function(_, ...) return vec(...) end })
vector = Vector
SIM.vec = vec

-- ───────── JSON (keys sorted when encoding, so output is stable) ─────────
local function jencode(v)
  local t = type(v)
  if v == nil then return "null" end
  if t == "boolean" then return tostring(v) end
  if t == "number" then local i = math.tointeger(v) if i then return tostring(i) end if v ~= v or v == math.huge or v == -math.huge then return "null" end return tostring(v) end
  if t == "string" then
    return '"' .. v:gsub('[%c"\\]', function(c)
      local m = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
      return m[c] or string.format("\\u%04x", c:byte())
    end) .. '"'
  end
  if t == "table" then
    if v.__vector then return jencode({ x = v.x, y = v.y, z = v.z }) end
    local n = #v
    local isArray = n > 0 or next(v) == nil
    if isArray then for k in pairs(v) do if type(k) ~= "number" then isArray = false break end end end
    if isArray then
      local parts = {}
      for i = 1, n do parts[i] = jencode(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    local parts = {}
    for _, k in ipairs(keys) do
      local val = v[k]
      if val == nil then val = v[tonumber(k)] end
      parts[#parts + 1] = jencode(k) .. ":" .. jencode(val)
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
local function jdecode(s)
  local i = 1
  local function ws() i = s:find("[^ \t\r\n]", i) or #s + 1 end
  local value
  local function str()
    i = i + 1
    local out = {}
    while true do
      local c = s:sub(i, i)
      if c == '"' then i = i + 1 break end
      if c == "\\" then
        local e = s:sub(i + 1, i + 1)
        if e == "u" then
          local code = tonumber(s:sub(i + 2, i + 5), 16)
          out[#out + 1] = utf8.char(code)
          i = i + 6
        else
          out[#out + 1] = ({ n = "\n", r = "\r", t = "\t", b = "\b", f = "\f" })[e] or e
          i = i + 2
        end
      else
        local j = s:find('["\\]', i)
        out[#out + 1] = s:sub(i, j - 1)
        i = j
      end
    end
    return table.concat(out)
  end
  function value()
    ws()
    local c = s:sub(i, i)
    if c == "{" then
      i = i + 1
      local t = {}
      ws()
      if s:sub(i, i) == "}" then i = i + 1 return t end
      while true do
        ws()
        local k = str()
        ws(); i = i + 1 -- :
        t[k] = value()
        ws()
        local d = s:sub(i, i)
        i = i + 1
        if d == "}" then return t end
      end
    elseif c == "[" then
      i = i + 1
      local t = {}
      ws()
      if s:sub(i, i) == "]" then i = i + 1 return t end
      while true do
        t[#t + 1] = value()
        ws()
        local d = s:sub(i, i)
        i = i + 1
        if d == "]" then return t end
      end
    elseif c == '"' then return str()
    elseif s:sub(i, i + 3) == "true" then i = i + 4 return true
    elseif s:sub(i, i + 4) == "false" then i = i + 5 return false
    elseif s:sub(i, i + 3) == "null" then i = i + 4 return nil
    else
      local num = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", i)
      i = i + #num
      return tonumber(num)
    end
  end
  local ok, v = pcall(value)
  if not ok then return nil end
  return v
end
JSON = { encode = jencode, encode_pretty = jencode, decode = jdecode }
SIM.jencode, SIM.jdecode = jencode, jdecode

-- ───────── Wait / time ─────────
local function addWait(w)
  SIM.waitN = SIM.waitN + 1
  w.id = SIM.waitN
  SIM.waits[#SIM.waits + 1] = w
  return w.id
end
Wait = {
  frames = function(fn, n) return addWait({ fn = fn, at = SIM.frame + math.max(1, n or 1) }) end,
  time = function(fn, sec, reps) return addWait({ fn = fn, at = SIM.frame + math.max(1, math.ceil((sec or 0) * 60)), every = (reps and reps ~= 1) and math.max(1, math.ceil((sec or 0) * 60)) or nil, reps = reps }) end,
  condition = function(fn, cond, timeout, onTimeout) return addWait({ fn = fn, cond = cond, at = SIM.frame + 1, until_ = timeout and (SIM.frame + math.ceil(timeout * 60)) or nil, onTimeout = onTimeout }) end,
  stop = function(id) for k, w in ipairs(SIM.waits) do if w.id == id then table.remove(SIM.waits, k) return end end end,
  stopAll = function() SIM.waits = {} end,
}
Time = { delta_time = 1 / 60, time = 0, fixed_delta_time = 1 / 60 }
__realclock = os.clock -- (the host's own CPU clock, for the tests that time the script)
os.clock = function() return SIM.clock end
os.time = function(t) if t then return 1792500000 end return 1792500000 + math.floor(SIM.clock) end
os.date = function(f) return "2026-10-20 12:00:00" end

local function runFrame()
  SIM.frame = SIM.frame + 1
  SIM.clock = SIM.frame / 60
  Time.time = SIM.clock
  if SIM.landPuts then SIM.landPuts() end
  local due = {}
  local keep = {}
  for _, w in ipairs(SIM.waits) do
    if w.cond ~= nil then
      local ok, met = pcall(w.cond)
      if ok and met then due[#due + 1] = w
      elseif w.until_ and SIM.frame >= w.until_ then w.fn = w.onTimeout or function() end due[#due + 1] = w
      else keep[#keep + 1] = w end
    elseif SIM.frame >= w.at then
      due[#due + 1] = w
      if w.every and (w.reps == -1 or (w.reps or 1) > 1) then
        keep[#keep + 1] = { id = w.id, fn = w.fn, at = SIM.frame + w.every, every = w.every, reps = w.reps == -1 and -1 or (w.reps - 1) }
      end
    else keep[#keep + 1] = w end
  end
  SIM.waits = keep
  for _, w in ipairs(due) do
    local ok, err = pcall(w.fn)
    if not ok then fx("ERROR wait", tostring(err)) end
  end
  if onUpdate then local ok, err = pcall(onUpdate) if not ok then fx("ERROR onUpdate", tostring(err)) end end
end
function SIM.frames(n) for _ = 1, n do runFrame() end end

-- ───────── objects ─────────
local M = {} -- object methods: M.name(self, ...)
local function newGuid()
  SIM.guidN = SIM.guidN + 1
  return string.format("s%05d", SIM.guidN)
end
local ObjMeta = {}
ObjMeta.__index = function(o, k)
  if k == "is_face_down" then local z = (o.__d.rot and o.__d.rot.z or 0) % 360 return z > 90 and z < 270 end
  -- (a 3D text's words: the Card Importer's "Spawning here" labels; not drawn, so nothing is kept)
  if k == "TextTool" then local n = function() end return { setValue = n, setFontSize = n, setFontColor = n, getValue = function() return "" end } end
  local m = M[k]
  if m then
    -- TTS methods are called with a dot (obj.getPosition()); a colon call passes the object twice
    -- (an object destroyed in an earlier frame raises on every call but isDestroyed, as in TTS; in the frame it was
    -- destroyed it still answers, as Unity removes it at the frame's end)
    if SIM.calls then local ck = (o.__guid == "sim-table" and "table." or "") .. k SIM.calls[ck] = (SIM.calls[ck] or 0) + 1 end -- (a test counting the script's object calls, the table's apart)
    return function(a, ...)
      local died = rawget(o, "__d") and o.__d.diedAt
      if died ~= nil and died < SIM.frame and k ~= "isDestroyed" then
        error("sim: " .. k .. " called on " .. o.__guid .. ", destroyed in frame " .. died, 2)
      end
      if a == o then return m(o, ...) end return m(o, a, ...)
    end
  end
  return nil
end
ObjMeta.__tostring = function(o) return o.__guid end

local function makeObj(d)
  local o = setmetatable({ __obj = true }, ObjMeta)
  rawset(o, "__guid", d.GUID or newGuid())
  rawset(o, "__d", {
    name = d.Name or "Custom", nick = d.Nickname or "", desc = d.Description or "", gm = d.GMNotes or "",
    pos = vec(d.Transform and d.Transform.posX or 0, d.Transform and d.Transform.posY or 0, d.Transform and d.Transform.posZ or 0),
    rot = vec(d.Transform and d.Transform.rotX or 0, d.Transform and d.Transform.rotY or 0, d.Transform and d.Transform.rotZ or 0),
    scale = vec(d.Transform and d.Transform.scaleX or 1, d.Transform and d.Transform.scaleY or 1, d.Transform and d.Transform.scaleZ or 1),
    lock = d.Locked or false, contained = d.ContainedObjects or {}, customDeck = d.CustomDeck, cardId = d.CardID,
    data = d, buttons = {}, menu = {}, vars = {}, tags = d.Tags or {}, fog = d.FogColor, uiXml = d.XmlUI or "", uiAttrs = {},
    zoneType = (d.Name == "ScriptingTrigger" and "Scripting") or (d.Name == "HandTrigger" and "Hand") or nil,
  })
  rawset(o, "type", (d.Name == "Card" or d.Name == "CardCustom") and "Card" or ((d.Name == "Deck" or d.Name == "DeckCustom") and "Deck")
    or (d.Name == "ScriptingTrigger" and "Scripting") or (d.Name == "HandTrigger" and "Hand") or (d.Name:find("Token") and "Token") or "Generic")
  rawset(o, "tag", o.type)
  rawset(o, "guid", o.__guid)
  -- uiBlank: names whose picture was still loading when the XML was last set. Real TTS draws an image whose asset hasn't
  -- loaded yet as a blank white card and keeps it so until the XML is set again (live 2026-11-14: the GIF panel's page 2
  -- stayed white under fresh names, and loaded at a second setXml). Loading takes 20 frames here; UI.loading says so.
  rawset(o, "UI", setmetatable({
    setXml = function(x)
      if (o.__d.uiXml or "") == "" then o.__d.uiFirstXmlFrame = SIM.frame end
      o.__d.uiXml = x
      local blank = {}
      if SIM.frame < (o.__d.uiLoadingUntil or -1) then for n in pairs(o.__d.uiNew or {}) do blank[n] = true end end
      o.__d.uiBlank = blank
      fx("objUI.setXml", o, hash(x))
    end,
    getXml = function() return o.__d.uiXml end,
    -- (an attribute set in the same frame as the object's first XML: real TTS hasn't built it yet and raises, live
    -- 2026-11-14 at every GIF pick, the new frame's play right after its first draw)
    setAttribute = function(id, k, v)
      if o.__d.uiFirstXmlFrame == SIM.frame then error("Object reference not set to an instance of an object (setAttribute in the same frame as the first XML)") end
      o.__d.uiAttrs[id .. "|" .. k] = tostring(v) fx("objUI.setAttribute", o, id, k, tostring(v)) end,
    getAttribute = function(id, k) return o.__d.uiAttrs[id .. "|" .. k] end,
    setAttributes = function(id, t) for k, v in pairs(t) do o.__d.uiAttrs[id .. "|" .. k] = tostring(v) end fx("objUI.setAttributes", o, id, t) end,
    setValue = function(id, v) fx("objUI.setValue", o, id, v) end,
    -- (the pictures its XML names, as TTS: a list of { name, url }, replacing the last one)
    -- uiLoaded: name -> the link that name's picture was loaded from on this object, or false: real TTS loads a name's
    -- picture once per object and never again for another link under the same name (the image stays a blank white
    -- card; the GIF panel's page 2, seen live 2026-11-14)
    setCustomAssets = function(t)
      local before = {}
      for _, a in ipairs(o.__d.uiAssets or {}) do before[a.name] = a.url end
      local new = {}
      for _, a in ipairs(t) do if before[a.name] ~= a.url then new[a.name] = true end end
      if next(new) ~= nil then o.__d.uiNew = new o.__d.uiLoadingUntil = SIM.frame + 20 end
      -- uiDup: a link listed under a second name in one list: real TTS loads it under the first name only, the second
      -- shows a blank card (live 2026-11-14, a starred result on the Favourites tab)
      local byUrl, dup = {}, {}
      for _, a in ipairs(t) do if byUrl[a.url] ~= nil and byUrl[a.url] ~= a.name then dup[a.name] = true else byUrl[a.url] = a.name end end
      o.__d.uiDup = dup
      o.__d.uiAssets = t
      o.__d.uiLoaded = o.__d.uiLoaded or {}
      for _, a in ipairs(t) do
        local was = o.__d.uiLoaded[a.name]
        if was == nil then o.__d.uiLoaded[a.name] = a.url elseif was ~= a.url then o.__d.uiLoaded[a.name] = false end
      end
      fx("objUI.setCustomAssets", o, #t)
    end,
    getCustomAssets = function() return o.__d.uiAssets or {} end,
  }, { __index = function(_, k) if k == "loading" then return SIM.frame < (o.__d.uiLoadingUntil or -1) end end }))
  -- an AssetBundle object (Custom_Assetbundle, or any with CustomAssetbundle data) has obj.AssetBundle, as in TTS; others
  -- have none (nil). The trigger effects live in the bundle file, not the save, so the fake takes their names from
  -- CustomAssetbundle.SimTriggerEffects, else from __sim.bundleEffects[AssetbundleURL] (what the bundle file at that
  -- link would hold: a spawned object), index 0, 1, ... in that order, as TTS numbers them. o.__d.bundleLoaded =
  -- false makes getTriggerEffects answer {} (a bundle still loading). Both calls are recorded.
  if d.Name == "Custom_Assetbundle" or d.CustomAssetbundle ~= nil then
    local cab = d.CustomAssetbundle or {}
    o.__d.triggers = cab.SimTriggerEffects or (SIM.bundleEffects and SIM.bundleEffects[cab.AssetbundleURL or ""]) or {}
    o.__d.bundleLoaded = true
    rawset(o, "AssetBundle", {
      getTriggerEffects = function()
        fx("AssetBundle.getTriggerEffects", o)
        if not o.__d.bundleLoaded then return {} end
        local out = {}
        for i, n in ipairs(o.__d.triggers) do out[i] = { index = i - 1, name = n } end
        return out
      end,
      playTriggerEffect = function(i)
        fx("AssetBundle.playTriggerEffect", o, i)
        o.__d.played = o.__d.played or {}
        -- (and how it stood then: turned, sized and tinted, for the effects' aim, scale and colour checks)
        o.__d.played[#o.__d.played + 1] = { index = i, frame = SIM.frame, pos = o.__d.pos:copy(), rot = o.__d.rot:copy(), scale = o.__d.scale:copy(), tint = o.__d.tint }
      end,
      getLoopingEffects = function() return {} end,
      playLoopingEffect = function(i) fx("AssetBundle.playLoopingEffect", o, i) end,
      getLoopingEffectIndex = function() return 0 end,
    })
  end
  -- (a save's or a spawn's Memo is the object's memo, as in TTS)
  if d.Memo ~= nil and d.Memo ~= "" then rawset(o, "memo", d.Memo) end
  SIM.objects[o.__guid] = o
  SIM.order[#SIM.order + 1] = o
  return o
end
SIM.makeObj = makeObj

local function alive(o) return o ~= nil and not o.__d.destroyed end
local function kill(o) if not o.__d.destroyed then o.__d.destroyed = true o.__d.diedAt = SIM.frame end end
SIM.kill = kill
function M.getGUID(o) return o.__guid end
function M.getName(o) return o.__d.nick end
function M.setName(o, n) o.__d.nick = n fx("setName", o, n) end
function M.getDescription(o) return o.__d.desc end
function M.setDescription(o, s) o.__d.desc = s fx("setDescription", o, hash(tostring(s))) end
function M.getGMNotes(o) return o.__d.gm end
function M.setGMNotes(o, s) o.__d.gm = s fx("setGMNotes", o, s) end
function M.getPosition(o) return o.__d.pos:copy() end
function M.setPosition(o, p) o.__d.pos = vec(p) fx("setPosition", o, o.__d.pos) end
function M.setPositionSmooth(o, p, coll, fast) o.__d.pos = vec(p) fx("setPositionSmooth", o, o.__d.pos) end
function M.getRotation(o) return o.__d.rot:copy() end
function M.setRotation(o, r) o.__d.rot = vec(r) fx("setRotation", o, o.__d.rot) end
function M.setRotationSmooth(o, r) o.__d.rot = vec(r) fx("setRotationSmooth", o, o.__d.rot) end
function M.getScale(o) return o.__d.scale:copy() end
function M.setScale(o, s) o.__d.scale = vec(s) fx("setScale", o, o.__d.scale) end
function M.getLock(o) return o.__d.lock end
function M.setLock(o, b) if o.__d.lock ~= b then fx("setLock", o, b) end o.__d.lock = b end
function M.setColorTint(o, c) o.__d.tint = c fx("setColorTint", o, c) end
-- (the alpha only when one was set: TTS's Color has one, a = 1 when none was given)
function M.getColorTint(o) local c = o.__d.tint or { 1, 1, 1 } return { r = c.r or c[1], g = c.g or c[2], b = c.b or c[3], a = c.a or c[4] } end
function M.isDestroyed(o) return o.__d.destroyed == true end
function M.destruct(o) if not o.__d.destroyed then kill(o) fx("destruct", o) end return true end
function M.isSmoothMoving(o) return false end
function M.getVelocity(o) return (o.__d.vel or vec({ x = 0, y = 0, z = 0 })):copy() end
function M.setVelocity(o, v) o.__d.vel = vec(v) fx("setVelocity", o, o.__d.vel) end
function M.setAngularVelocity(o, v) fx("setAngularVelocity", o, vec(v)) end
function M.highlightOn(o, c, d) o.__d.highlight = c fx("highlightOn", o, c) end
function M.highlightOff(o, c) o.__d.highlight = nil fx("highlightOff", o) end
function M.addContextMenuItem(o, label, fn) o.__d.menu[#o.__d.menu + 1] = { label = label, fn = fn } fx("menu+", o, label) end
function M.clearContextMenu(o) if #o.__d.menu > 0 then fx("menu clear", o) end o.__d.menu = {} end
-- ───────── what real TTS draws where it differs from what the script asked (tests/test_tts_sim_contract.js) ─────────
-- The record keeps what the script asked; these say what real TTS would show, and run-sim makes a hidden label an error.
-- (1) a button on a scripting zone (the playmats) or on the middle tile (GM notes in SIM.mirrorTags) is drawn with its
-- local x mirrored: live 2026-11-10 (the tile: a button meant at x -48 showed at +48) and 2026-11-14 (a mat's team panel)
SIM.mirrorTags = { mtgsetup = true }
function SIM.mirrors(o) return o.__d.zoneType == "Scripting" or SIM.mirrorTags[tostring(o.__d.gm or "")] == true end
function SIM.buttonDrawnAt(o, i)
  local b = o.__d.buttons[i]
  if b == nil then return nil end
  local p = vec(b.position or { 0, 0, 0 })
  if SIM.mirrors(o) then p.x = -p.x end
  return M.positionToWorld(o, p)
end
-- (2) a button's label fades with its background colour's alpha: a see-through background (alpha under 0.1) with a
-- background to draw (width and height above 0; TTS's defaults are 100) shows no label at all, live 2026-11-24 (the
-- mana counters: alpha 0 and 0.01 drew nothing, the same label with width 0 showed). Each such label is listed in
-- SIM.hiddenLabels as it is made or edited.
local function alphaOf(c)
  if type(c) == "table" then return tonumber(c[4] or c.a) or 1 end
  if type(c) == "string" and c:sub(1, 1) == "#" and #c == 9 then return (tonumber(c:sub(8, 9), 16) or 255) / 255 end
  return 1
end
function SIM.labelShown(o, i)
  local b = o.__d.buttons[i]
  if b == nil then return false end
  local label = tostring(b.label or "")
  if not label:find("%S") then return false end
  local w, h = tonumber(b.width or 100) or 100, tonumber(b.height or 100) or 100
  if w > 0 and h > 0 and alphaOf(b.color) < 0.1 then return false end
  return alphaOf(b.font_color) >= 0.1
end
SIM.hiddenLabels = {}
local function checkLabel(o, i)
  local b = o.__d.buttons[i]
  if b ~= nil and tostring(b.label or ""):find("%S") and not SIM.labelShown(o, i) then
    SIM.hiddenLabels[#SIM.hiddenLabels + 1] = { guid = o.__guid, label = tostring(b.label) }
  end
end
function M.createButton(o, p)
  o.__d.buttons[#o.__d.buttons + 1] = p
  checkLabel(o, #o.__d.buttons)
  -- (the colour too: the table's setup buttons say "Start" in yellow or green)
  local c = p.color
  local pos = p.position
  local at = type(pos) == "table" and string.format("at %.2f,%.2f,%.2f", pos[1] or pos.x or 0, pos[2] or pos.y or 0, pos[3] or pos.z or 0) or ""
  local sc = p.scale
  if type(sc) == "table" then at = at .. string.format(" scale %.4f", sc[1] or sc.x or 0) end
  if type(c) == "table" then fx("createButton", o, p.label or "", string.format("%.2f,%.2f,%.2f", c[1] or c.r or 0, c[2] or c.g or 0, c[3] or c.b or 0), at)
  else fx("createButton", o, p.label or "", at) end
end
function M.editButton(o, p)
  fx("editButton", o, p.index, p.label or "")
  -- (the button itself changes too, as in TTS: a later getButtons sees the new label)
  local b = o.__d.buttons[(p.index or 0) + 1]
  if b ~= nil then for k, v in pairs(p) do if k ~= "index" then b[k] = v end end checkLabel(o, (p.index or 0) + 1) end
end
function M.removeButton(o, i) fx("removeButton", o, i) table.remove(o.__d.buttons, i + 1) end
function M.clearButtons(o) o.__d.buttons = {} end
function M.getButtons(o) return o.__d.buttons end
function M.setVar(o, k, v) o.__d.vars[k] = v end
function M.getVar(o, k) return o.__d.vars[k] end
-- (the argument too: a table as its sorted key=value pairs, so "-5" on a life counter is in the record)
function M.call(o, fn, params)
  if type(params) == "table" then
    local ks = {}
    for k, v in pairs(params) do if type(v) ~= "table" then ks[#ks + 1] = tostring(k) .. "=" .. tostring(v) end end
    table.sort(ks)
    fx("call", o, fn, table.concat(ks, ","))
  elseif params ~= nil then fx("call", o, fn, tostring(params))
  else fx("call", o, fn) end
  return nil
end
function M.getTags(o) return o.__d.tags end
function M.hasTag(o, t) for _, x in ipairs(o.__d.tags) do if x == t then return true end end return false end
function M.setHiddenFrom(o, c) fx("setHiddenFrom", o, c) end
-- (kept, for the checks: TTS has no getter, __d.invisibleTo is the sim's own)
function M.setInvisibleTo(o, c) o.__d.invisibleTo = c fx("setInvisibleTo", o, c) end
-- States as TTS has them (2026-11-11): the other states are in the object's data (States, keyed by their id); its own
-- id is the one missing there. setState replaces the object by that state's object, under that state's GUID, at the
-- same spot and turn, and returns it; the old object is gone.
function M.getStateId(o)
  local ids = {}
  for k in pairs(o.__d.data.States or {}) do ids[tonumber(k)] = true end
  if next(ids) == nil then return -1 end
  local i = 1
  while ids[i] do i = i + 1 end
  return o.__d.stateId or i
end
function M.getStates(o)
  local out = {}
  for k, s in pairs(o.__d.data.States or {}) do out[#out + 1] = { id = tonumber(k), guid = s.GUID, name = s.Nickname or "", description = s.Description or "" } end
  table.sort(out, function(a, b) return a.id < b.id end)
  return out
end
function M.setState(o, id)
  local states = o.__d.data.States or {}
  local s = states[tostring(id)]
  -- (a state it hasn't, its own included, does nothing; the call is kept for the checks)
  if s == nil then fx("setState", o, id, "none") return nil end
  local mine = M.getStateId(o)
  local me = {}
  for k, v in pairs(o.__d.data) do if k ~= "States" then me[k] = v end end
  local others = { [tostring(mine)] = me }
  for k, v in pairs(states) do if k ~= tostring(id) then others[k] = v end end
  local d = {}
  for k, v in pairs(s) do d[k] = v end
  d.States = others
  local n = makeObj(d)
  n.__d.pos, n.__d.rot, n.__d.scale, n.__d.stateId = o.__d.pos:copy(), o.__d.rot:copy(), o.__d.scale:copy(), id
  kill(o)
  fx("setState", o, id, n)
  return n
end
function M.flip(o) local r = o.__d.rot r.z = (r.z + 180) % 360 fx("flip", o) end
function M.getTransformForward(o) local a = math.rad(o.__d.rot.y) return vec(math.sin(a), 0, math.cos(a)) end
function M.getTransformRight(o) local a = math.rad(o.__d.rot.y) return vec(math.cos(a), 0, -math.sin(a)) end
function M.positionToWorld(o, p) p = vec(p) local f, r = M.getTransformForward(o), M.getTransformRight(o) local s = o.__d.scale
  return o.__d.pos + r * (p.x * s.x) + vec(0, p.y * s.y, 0) + f * (p.z * s.z) end
function M.positionToLocal(o, p) p = vec(p) - o.__d.pos local f, r = M.getTransformForward(o), M.getTransformRight(o) local s = o.__d.scale
  return vec(V.dot(p, r) / s.x, p.y / s.y, V.dot(p, f) / s.z) end
-- (as scaled, as TTS's: a card 2.2 x 3.1 at scale 1, anything else 2 x 2; the real crown and counters may differ)
function M.getBoundsNormalized(o)
  local s, card = o.__d.scale, o.type == "Card"
  return { center = o.__d.pos:copy(), size = vec((card and 2.2 or 2) * s.x, 0.2 * s.y, (card and 3.1 or 2) * s.z), offset = vec(0, 0, 0) }
end
function M.getBounds(o) return M.getBoundsNormalized(o) end
function M.getData(o)
  local d = o.__d.data
  d.Nickname, d.Description, d.GMNotes, d.GUID = o.__d.nick, o.__d.desc, o.__d.gm, o.__guid
  d.ContainedObjects = o.__d.contained
  return d
end
function M.getJSON(o) return jencode(M.getData(o)) end
function M.reload(o) fx("reload", o) return o end
function M.setCustomObject(o, t) fx("setCustomObject", o, t) end
function M.getCustomObject(o) return {} end
function M.use_hands() return true end
-- containers
function M.getQuantity(o) if o.type == "Deck" then return #o.__d.contained end return -1 end
function M.getObjects(o)
  if o.__d.zoneType then return SIM.inZone(o) end
  local out = {}
  for i, c in ipairs(o.__d.contained) do
    out[#out + 1] = { guid = c.GUID, name = c.Nickname or "", nickname = c.Nickname or "", description = c.Description or "", gm_notes = c.GMNotes or "", index = i - 1, lua_script = "" }
  end
  return out
end
function M.takeObject(o, p)
  p = p or {}
  local idx
  for i, c in ipairs(o.__d.contained) do
    if (p.guid and c.GUID == p.guid) or (p.index ~= nil and i - 1 == p.index) then idx = i break end
  end
  if p.guid == nil and p.index == nil then idx = p.top == false and #o.__d.contained or 1 end
  local c = idx and table.remove(o.__d.contained, idx)
  if not c then fx("takeObject none", o) return nil end
  c.Name = c.Name or "Card"
  local n = makeObj(c)
  n.__d.pos = vec(p.position or o.__d.pos)
  fx("takeObject", o, n, n.__d.pos)
  -- (TTS calls the script's onObjectLeaveContainer for a card taken out of a deck, as for one a player drags out)
  if type(_G.onObjectLeaveContainer) == "function" then _G.onObjectLeaveContainer(o, n) end
  if p.callback_function then Wait.frames(function() p.callback_function(n) end, 1) end
  return n
end
-- putObject as TTS does it (2026-11-06): the script's tryObjectEnterContainer is asked first (false: refused); the
-- object lands at the frame's end (a deck that is locked by then refuses it, measured 2026-10-19); a deck put into a
-- deck merges its cards in on top, in their order ("Works for stacking chips, decks, and bags", the putObject API),
-- anything else goes in as one card; the script's onObjectEnterContainer is told while the object still answers, and
-- the object is gone after that frame.
local function landPut(o, x)
  if not alive(o) or not alive(x) then fx("putObject lost", o, x) return end
  if o.__d.lock and o.type == "Deck" then fx("putObject refused (locked)", o, x) return end
  if x.type == "Deck" and o.type == "Deck" then
    for i = #x.__d.contained, 1, -1 do table.insert(o.__d.contained, 1, x.__d.contained[i]) end
  else
    local d = M.getData(x)
    d.Name = "Card"
    table.insert(o.__d.contained, 1, d)
  end
  if type(_G.onObjectEnterContainer) == "function" then _G.onObjectEnterContainer(o, x) end
  kill(x)
end
function M.putObject(o, x)
  if not alive(x) then fx("putObject none", o) return nil end
  if type(_G.tryObjectEnterContainer) == "function" and _G.tryObjectEnterContainer(o, x) == false then
    fx("putObject refused (tryObjectEnterContainer)", o, x) return nil
  end
  fx("putObject", o, x)
  SIM.landing[#SIM.landing + 1] = { o = o, x = x }
  return o
end
SIM.landing = {} -- puts made this frame: they land at the start of the next, before its Wait callbacks
SIM.landPuts = function()
  local q = SIM.landing
  SIM.landing = {}
  for _, p in ipairs(q) do
    local ok, err = pcall(landPut, p.o, p.x)
    if not ok then fx("ERROR putObject", tostring(err)) end
  end
end
function M.shuffle(o) fx("shuffle", o) end
function M.deal(o, n, color) fx("deal", o, n, color) if o.type == "Card" then o.__d.pos = SIM.hands[color] and SIM.hands[color][1].__d.pos:copy() or o.__d.pos end end
function M.getZones(o)
  local out = {}
  for _, z in ipairs(SIM.order) do if alive(z) and z.__d.zoneType and SIM.contains(z, o.__d.pos) then out[#out + 1] = z end end
  return out
end
-- a box zone (scripting or hand) contains a point
function SIM.contains(z, p)
  local loc = M.positionToLocal(z, p)
  return math.abs(loc.x) <= 0.5 and math.abs(loc.z) <= 0.5 and math.abs(loc.y) <= 0.5 + 2
end
function SIM.inZone(z)
  local out = {}
  for _, o in ipairs(SIM.order) do
    if alive(o) and o ~= z and not o.__d.zoneType and SIM.contains(z, o.__d.pos) then out[#out + 1] = o end
  end
  return out
end

-- ───────── world ─────────
function getObjectFromGUID(g) local o = SIM.objects[g] if alive(o) then return o end return nil end
function getObjects() if SIM.calls then SIM.calls.getObjects = (SIM.calls.getObjects or 0) + 1 end local out = {} for _, o in ipairs(SIM.order) do if alive(o) then out[#out + 1] = o end end return out end
getAllObjects = getObjects
-- The table object (Tables.getTableObject): made when first asked for, kept out of getObjects as TTS keeps it out.
-- flipTable() is TTS's top-menu Flip as measured live 2026-11-14: the table turns over and drops, and every object,
-- locked or not, is thrown (moved, turned, set moving); __sim.flipDestroy = { [guid] = true } destroys those as well.
Tables = {
  getTableObject = function()
    if SIM.tableObj == nil then
      SIM.tableObj = makeObj({ Name = "Table_Custom", GUID = "sim-table", Locked = true, Transform = { posX = 0, posY = -3, posZ = 0 } })
      SIM.objects["sim-table"] = nil
      table.remove(SIM.order) -- (makeObj put it last)
    end
    return SIM.tableObj
  end,
}
function flipTable()
  fx("flipTable")
  local t = Tables.getTableObject()
  t.__d.pos = vec(0, -9, 0) t.__d.rot = vec(1.4, 345.9, 294.2)
  local doomed = SIM.flipDestroy or {}
  for i, o in ipairs(SIM.order) do
    if alive(o) then
      -- (a GUID in __sim.flipDestroy falls through the floor as well)
      if doomed[o.__guid] then kill(o)
      else
        o.__d.pos = vec(o.__d.pos.x + (i % 7) - 3, o.__d.pos.y + 2 + (i % 3), o.__d.pos.z + (i % 5) - 2)
        o.__d.rot = vec((o.__d.rot.x + 40) % 360, (o.__d.rot.y + 75) % 360, (o.__d.rot.z + 120) % 360)
        o.__d.vel = vec(1, 5, -2)
      end
    end
  end
end
function getObjectsWithTag(t) local out = {} for _, o in ipairs(getObjects()) do if M.hasTag(o, t) then out[#out + 1] = o end end return out end
function spawnObject(p)
  local o = makeObj({ Name = p.type or "Custom", Transform = { posX = p.position and vec(p.position).x or 0, posY = p.position and vec(p.position).y or 0, posZ = p.position and vec(p.position).z or 0,
    rotY = p.rotation and vec(p.rotation).y or 0, scaleX = 1, scaleY = 1, scaleZ = 1 } })
  fx("spawnObject", p.type, o, o.__d.pos)
  if p.callback_function then Wait.frames(function() p.callback_function(o) end, 1) end
  return o
end
function spawnObjectData(p)
  local d = p.data
  -- real TTS raises on an AssetBundle's data with no Transform (seen live 2026-11-12; other kinds not checked), and a
  -- test can make a spawn fail (__sim.spawnFail(data) -> true) to see what happens then
  if d.Name == "Custom_Assetbundle" and d.Transform == nil then error("Object reference not set to an instance of an object", 2) end
  if SIM.spawnFail and SIM.spawnFail(d) then error("spawn failed (test)", 2) end
  -- (TTS keeps the data's GUID when no object has it, else gives a new one)
  local keepGuid = d.GUID ~= nil and getObjectFromGUID(d.GUID) == nil and d.GUID or nil
  local o = makeObj({ GUID = keepGuid, Name = d.Name, Nickname = d.Nickname, Description = d.Description, GMNotes = d.GMNotes, Memo = d.Memo, ContainedObjects = d.ContainedObjects,
    CustomDeck = d.CustomDeck, CardID = d.CardID, Locked = d.Locked, CustomAssetbundle = d.CustomAssetbundle,
    Transform = { posX = p.position and vec(p.position).x or 0, posY = p.position and vec(p.position).y or 0, posZ = p.position and vec(p.position).z or 0,
      rotX = p.rotation and vec(p.rotation).x or 0, rotY = p.rotation and vec(p.rotation).y or 0, rotZ = p.rotation and vec(p.rotation).z or 0, scaleX = 1, scaleY = 1, scaleZ = 1 } })
  o.__d.data = d
  -- (TTS calls the script's onObjectSpawn for every object spawned: the stray-card watcher there deleted the effect
  -- bundle's rigs a frame after they spawned, live check batch 2 2026-11-12, which a fake that never called it hid)
  if type(_G.onObjectSpawn) == "function" then onObjectSpawn(o) end
  -- the picture numbers matter (big CustomDeck keys slow TTS's snapshots): record the card's and the deck's
  local keys = {}
  for k in pairs(d.CustomDeck or {}) do keys[#keys + 1] = tostring(k) end
  table.sort(keys)
  fx("spawnObjectData", d.Name, o, d.Nickname or "", o.__d.pos, #(d.ContainedObjects or {}), d.CardID or 0, table.concat(keys, ","))
  -- (a spawn arrives a frame later; a test may make some slower, as a big deck is in TTS: __sim.spawnDelay(data) -> frames)
  local delay = 1
  if SIM.spawnDelay then local v = SIM.spawnDelay(d) if type(v) == "number" then delay = v end end
  if p.callback_function then Wait.frames(function() p.callback_function(o) end, delay) end
  return o
end
function spawnObjectJSON(p) return spawnObjectData({ data = jdecode(p.json), position = p.position, rotation = p.rotation, callback_function = p.callback_function }) end
function destroyObject(o) if o then M.destruct(o) end end
function group(list) fx("group", #list) return list end
function getDeckFromZone(z) for _, o in ipairs(SIM.inZone(z)) do if o.type == "Deck" then return o end end return nil end

-- ───────── messages ─────────
function print(...) local p = {} for i = 1, select("#", ...) do p[#p + 1] = tostring((select(i, ...))) end fx("print", table.concat(p, " ")) end
function log(v, label) fx("log", label or "", show(v)) end
function broadcastToAll(m, c) fx("broadcastToAll", m) end
function broadcastToColor(m, color, c) fx("broadcastToColor", color, m) end
function printToAll(m, c) fx("printToAll", m) end
function printToColor(m, color, c) fx("printToColor", color, m) end
function sendExternalMessage(t) fx("sendExternalMessage", t) end
WebRequest = {
  post = function(url, body, cb) fx("WebRequest.post", url, body) if cb then Wait.frames(function() cb({ is_done = true, is_error = false, text = "ok" }) end, 1) end return {} end,
  get = function(url, cb) fx("WebRequest.get", url) if cb then Wait.frames(function() cb({ is_done = true, is_error = true, text = "" }) end, 1) end return {} end,
  custom = function(url, method, download, body, headers, cb)
    fx("WebRequest.custom", url, method, body)
    if SIM.liveWeb then
      -- headless TTS: the host sends it for real and answers through __sim.webDone
      SIM.webN = (SIM.webN or 0) + 1
      SIM.webq = SIM.webq or {}
      SIM.webcb = SIM.webcb or {}
      SIM.webq[#SIM.webq + 1] = { id = SIM.webN, url = url, method = method, body = body, headers = headers }
      SIM.webcb[SIM.webN] = cb
    elseif cb then Wait.frames(function() cb({ is_done = true, is_error = false, text = "ok" }) end, 1) end
    return {}
  end,
}
function startLuaCoroutine(obj, name) local f = _G[name] if f then local co = coroutine.create(f) while coroutine.status(co) ~= "dead" do coroutine.resume(co) end end end
function addHotkey(name, fn) fx("addHotkey", name) end
function addContextMenuItem(label, fn) fx("global menu+", label) SIM.globalMenu = SIM.globalMenu or {} SIM.globalMenu[label] = fn end
function clearContextMenu() SIM.globalMenu = {} end
function showHotkeyConfig() end
function stringColorToRGB(c) return { r = 1, g = 1, b = 1 } end
Color = setmetatable({ fromString = function(s) return { r = 1, g = 1, b = 1, a = 1 } end, new = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end },
  { __call = function(_, r, g, b, a) return { r = r, g = g, b = b, a = a or 1 } end })
Physics = { cast = function(p) fx("Physics.cast") return {} end }
-- (the Notebook's tabs as the TTS API describes them: { index, title, body, color }, index from 0 here, not yet
-- checked on the real table; add / edit recorded)
SIM.notebook = {}
Notes = { setNotes = function() end, getNotes = function() return "" end,
  getNotebookTabs = function()
    local out = {}
    for i, t in ipairs(SIM.notebook) do out[i] = { index = i - 1, title = t.title, body = t.body, color = t.color } end
    return out
  end,
  addNotebookTab = function(p)
    SIM.notebook[#SIM.notebook + 1] = { title = p.title or "", body = p.body or "", color = p.color or "Grey" }
    fx("Notes.addNotebookTab", p.title)
    return #SIM.notebook - 1
  end,
  editNotebookTab = function(p)
    local t = SIM.notebook[(tonumber(p.index) or -1) + 1]
    if t == nil then return false end
    if p.title ~= nil then t.title = p.title end
    if p.body ~= nil then t.body = p.body end
    if p.color ~= nil then t.color = p.color end
    fx("Notes.editNotebookTab", p.index, p.title)
    return true
  end }
Lighting = { apply = function() end }
Turns = { enable = true, turn_color = "White", pass_turns = true, getNextTurnColor = function() return "Red" end, getPreviousTurnColor = function() return "Blue" end, order = {} }
Hands = { enable = true, disable_unused = false, hiding = 0 }
Info = { name = "sim" }
Encoder = setmetatable({}, ObjMeta)
rawset(Encoder, "__guid", "encoder") rawset(Encoder, "__d", { pos = vec(0, 0, 0), rot = vec(0, 0, 0), scale = vec(1, 1, 1), menu = {}, buttons = {}, vars = {}, tags = {}, contained = {}, uiAttrs = {} })
rawset(Encoder, "call", function(fn, params) fx("Encoder.call", fn) return {} end)

-- headless TTS: the web requests waiting to go out (as JSON), and their answers coming back
function SIM.takeWeb() local q = SIM.webq or {} SIM.webq = {} return JSON.encode(q) end
function SIM.webDone(id, isError)
  local cb = SIM.webcb and SIM.webcb[id]
  if SIM.webcb then SIM.webcb[id] = nil end
  if cb then cb({ is_done = true, is_error = isError, text = isError and "" or "ok" }) end
end

-- ───────── screen UI ─────────
-- How real TTS draws a Button after a script changes it (docs/engine-ui-spec.md 2.1): every setAttribute(s) call redraws
-- the button from the attributes the element holds itself. Its label goes back to TTS's dark grey unless that call
-- carries a textColor different from the stored one, and its background is its own color, or TTS's plain white when
-- the colour came only from a <Defaults> class. SIM.btn[id] = { own = { color, textColor }, bg, fg }: own = written on
-- the element (or set since), bg / fg = what TTS shows now. __sim.drawn(id) -> "<background>|<label>".
local TTS_LABEL, TTS_BUTTON = "#323232", "#FFFFFF"
local function attrOf(tag, key)
  local i = tag:find(" " .. key .. '="', 1, true)
  if i == nil then return nil end
  local s = i + #key + 3
  return tag:sub(s, tag:find('"', s, true) - 1)
end
local function readButtons(x)
  SIM.btn, SIM.classLook = {}, {}
  local d1, d2 = x:find("<Defaults>", 1, true), x:find("</Defaults>", 1, true)
  local pos = d1 or 1
  while d1 and d2 do -- the classes: their colours are what TTS draws when it builds the XML
    local i = x:find("<Button class=\"", pos, true)
    if i == nil or i > d2 then break end
    local e = x:find(">", i, true)
    local tag = x:sub(i, e)
    SIM.classLook[attrOf(tag, "class")] = { color = attrOf(tag, "color"), textColor = attrOf(tag, "textColor") }
    pos = e
  end
  pos = 1
  while true do
    local i = x:find("<Button ", pos, true)
    if i == nil then break end
    local e = x:find(">", i, true)
    local tag = x:sub(i, e)
    local id = attrOf(tag, "id")
    if id ~= nil then
      local own = { color = attrOf(tag, "color"), textColor = attrOf(tag, "textColor") }
      local cl = SIM.classLook[attrOf(tag, "class") or ""] or {}
      SIM.btn[id] = { own = own, bg = own.color or cl.color or TTS_BUTTON, fg = own.textColor or cl.textColor or TTS_LABEL }
    end
    pos = e
  end
end
local function redraw(id, t)
  local b = SIM.btn and SIM.btn[id]
  if b == nil then return end
  local tc = t.textColor ~= nil and tostring(t.textColor) or nil
  b.fg = (tc ~= nil and tc ~= b.own.textColor) and tc or TTS_LABEL
  if tc ~= nil then b.own.textColor = tc end
  if t.color ~= nil then b.own.color = tostring(t.color) end
  b.bg = b.own.color or TTS_BUTTON
end
function SIM.drawn(id)
  local m = rawget(_G, "engineUiMap")
  local b = SIM.btn and SIM.btn[(m and m.s[id]) or id]
  return b and (b.bg .. "|" .. b.fg) or "nil"
end
-- The script's screen UI has short ids (engineUiMap, engine-renderer.lua: s = long -> code, l = code -> long). The
-- record names an element by its long id, so recordings read as before. A set made with a long id that has a code is a
-- call that missed engineUI: in TTS it changes nothing. It is listed in SIM.longIds (run-sim makes it an error). A get
-- takes either id (tests and tools read with the long one).
local function uiMap() return rawget(_G, "engineUiMap") end
local function uiShort(id) local m = uiMap() return (m and m.s[id]) or id end
local function uiLong(id) local m = uiMap() return (m and m.l[id]) or id end
local function uiSet(id)
  local m = uiMap()
  if m and m.s[id] ~= nil then SIM.longIds[#SIM.longIds + 1] = tostring(id) end
  return uiShort(id)
end
SIM.longIds = {}
SIM.buttonValues = {}
-- the screen XML with the long ids back in (tests read the built XML by them)
function SIM.longXml() local m = uiMap() if not m then return SIM.xml end return (SIM.xml:gsub(' id="([%w_]+)"', function(c) return ' id="' .. (m.l[c] or c) .. '"' end)) end
UI = {
  setXml = function(x) SIM.xml = x readButtons(x) fx("UI.setXml", hash(x)) end,
  getXml = function() return SIM.xml end,
  setAttribute = function(id, k, v) id = uiSet(id) SIM.attrs[id .. "|" .. k] = tostring(v) redraw(id, { [k] = v }) fx("UI.setAttribute", uiLong(id), k, tostring(v)) end,
  setAttributes = function(id, t) id = uiSet(id) for k, v in pairs(t) do SIM.attrs[id .. "|" .. k] = tostring(v) end redraw(id, t) fx("UI.setAttributes", uiLong(id), t) end,
  getAttribute = function(id, k) return SIM.attrs[uiShort(id) .. "|" .. k] end,
  -- (real TTS ignores UI.setValue on a Button, it draws the text attribute: live 2026-11-02. The call is recorded,
  -- the value is not kept, and the call is listed in SIM.buttonValues, which run-sim makes an error)
  setValue = function(id, v)
    id = uiSet(id)
    if SIM.btn ~= nil and SIM.btn[id] ~= nil then SIM.buttonValues[#SIM.buttonValues + 1] = tostring(uiLong(id))
    else SIM.values[id] = v end
    fx("UI.setValue", uiLong(id), v)
  end,
  getValue = function(id) return SIM.values[uiShort(id)] end,
  show = function(id) fx("UI.show", id) end,
  hide = function(id) fx("UI.hide", id) end,
  setCustomAssets = function(t) fx("UI.setCustomAssets", #t) end,
  getCustomAssets = function() return {} end,
}

-- ───────── players ─────────
local COLORS = { "White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Grey", "Black" }
Player = setmetatable({}, { __index = function(t, color)
  if color == "getPlayers" then return function() local out = {} for c in pairs(SIM.seated) do out[#out + 1] = t[c] end for c in pairs(SIM.present or {}) do if not SIM.seated[c] then out[#out + 1] = t[c] end end table.sort(out, function(a, b) return a.color < b.color end) return out end end
  if color == "getAvailableColors" then return function() return { "White", "Red", "Yellow", "Blue" } end end
  if color == "getColors" then return function() return COLORS end end
  if color == "Action" then return { PickUp = 0, Select = 1, FlipOver = 2, RotateIncrementalLeft = 3, RotateIncrementalRight = 4, Copy = 5, Paste = 6, Delete = 7, Group = 8, Randomize = 9, Cut = 10 } end
  local p = { color = color, seated = SIM.seated[color] == true, steam_name = SIM.seated[color] and ("Player" .. color) or "", host = color == SIM.host,
    admin = color == SIM.host or (SIM.promoted or {})[color] == true, promoted = (SIM.promoted or {})[color] == true, steam_id = "sim-" .. color }
  -- (team: kept per colour, as TTS keeps a player's team; a write is logged, "Player.team")
  setmetatable(p, { __index = function(_, k) if k == "team" then return (SIM.teams or {})[color] or "None" end end,
    __newindex = function(tt, k, v) if k == "team" then SIM.teams = SIM.teams or {} SIM.teams[color] = v fx("Player.team", color, v) else rawset(tt, k, v) end end })
  -- (promote() toggles, like TTS (api.tabletopsimulator.com/player/instance: no parameters); an argument is ignored)
  p.promote = function()
    SIM.promoted = SIM.promoted or {}
    local b = not SIM.promoted[color]
    SIM.promoted[color] = b and true or nil
    fx("Player.promote", color, tostring(b))
  end
  p.getHandTransform = function(i)
    local h = SIM.hands[color] and SIM.hands[color][i or 1]
    if not h then return nil end
    return { position = h.__d.pos:copy(), rotation = h.__d.rot:copy(), scale = h.__d.scale:copy(), forward = M.getTransformForward(h), right = M.getTransformRight(h), up = vec(0, 1, 0) }
  end
  p.getHandObjects = function(i)
    local h = SIM.hands[color] and SIM.hands[color][i or 1]
    if not h then return {} end
    return SIM.inZone(h)
  end
  p.getHandCount = function() return SIM.hands[color] and #SIM.hands[color] or 0 end
  p.broadcast = function(m, c) fx("Player.broadcast", color, m) end
  p.print = function(m, c) fx("Player.print", color, m) end
  p.getSelectedObjects = function() return {} end
  p.clearSelectedObjects = function() end
  p.changeColor = function() end
  p.getPointerPosition = function() return vec(0, 0, 0) end
  p.getPointerRotation = function() return 0 end -- (the Card Importer turns what it spawns by it)
  -- the object under the player's pointer: __sim.hover = { [color] = guid } (none by default)
  p.getHoverObject = function() local g = SIM.hover and SIM.hover[color] return g and getObjectFromGUID(g) or nil end
  p.lookAt = function() end
  return p
end })
function getSeatedPlayers() local out = {} for _, c in ipairs(COLORS) do if SIM.seated[c] then out[#out + 1] = c end end return out end

Global = setmetatable({}, ObjMeta)
rawset(Global, "__guid", "-1")
rawset(Global, "__d", { pos = vec(0, 0, 0), rot = vec(0, 0, 0), scale = vec(1, 1, 1), menu = {}, buttons = {}, vars = {}, tags = {}, contained = {}, uiAttrs = {} })
rawset(Global, "UI", UI)
rawset(Global, "getLuaScript", function() return SIM.script or "" end)
rawset(Global, "call", function(fn, params) local f = _G[fn] if f then return f(params) end end)
rawset(Global, "getVar", function(k) return _G[k] end)
rawset(Global, "setVar", function(k, v) _G[k] = v end)
-- vector lines (the table's target/attack/block lines): recorded as one summary per call, rounded
SIM.vectorLines = {}
rawset(Global, "getVectorLines", function() return SIM.vectorLines end)
rawset(Global, "setVectorLines", function(lines)
  SIM.vectorLines = lines or {}
  local parts = {}
  for _, l in ipairs(SIM.vectorLines) do
    local a, b = l.points[1], l.points[#l.points]
    local c = l.color or {}
    local mid = l.points[math.floor((#l.points + 1) / 2)] -- (its height shows the arc)
    parts[#parts + 1] = string.format("%.2f,%.2f,%.2f t%.3f n%d (%.1f,%.1f)->(%.1f,%.1f) mid y%.1f", c[1] or 0, c[2] or 0, c[3] or 0, l.thickness or 0, #l.points, a[1] or a.x, a[3] or a.z, b[1] or b.x, b[3] or b.z, mid[2] or mid.y)
  end
  fx("Global.setVectorLines", #SIM.vectorLines, table.concat(parts, " | "))
end)
self = Global

-- ───────── loading the save ─────────
function SIM.load(save)
  for _, d in ipairs(save.ObjectStates or {}) do
    local o = makeObj(d)
    if d.Name == "HandTrigger" and d.FogColor then
      SIM.hands[d.FogColor] = SIM.hands[d.FogColor] or {}
      table.insert(SIM.hands[d.FogColor], o)
    end
  end
  SIM.xml = save.XmlUI or ""
  readButtons(SIM.xml) -- (the save's own screen UI is what TTS starts with: its Buttons ignore setValue too)
end
return SIM
