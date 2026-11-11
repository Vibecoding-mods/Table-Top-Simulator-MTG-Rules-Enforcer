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

-- ───────── Vector ─────────
local V = {}
V.__index = function(t, k)
  if k == 1 then return rawget(t, "x") elseif k == 2 then return rawget(t, "y") elseif k == 3 then return rawget(t, "z") end
  return V[k]
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
  local m = M[k]
  if m then
    -- TTS methods are called with a dot (obj.getPosition()); a colon call passes the object twice
    -- (an object destroyed in an earlier frame raises on every call but isDestroyed, as in TTS; in the frame it was
    -- destroyed it still answers, as Unity removes it at the frame's end)
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
  rawset(o, "UI", {
    setXml = function(x) o.__d.uiXml = x fx("objUI.setXml", o, hash(x)) end,
    getXml = function() return o.__d.uiXml end,
    setAttribute = function(id, k, v) o.__d.uiAttrs[id .. "|" .. k] = tostring(v) fx("objUI.setAttribute", o, id, k, tostring(v)) end,
    getAttribute = function(id, k) return o.__d.uiAttrs[id .. "|" .. k] end,
    setAttributes = function(id, t) for k, v in pairs(t) do o.__d.uiAttrs[id .. "|" .. k] = tostring(v) end fx("objUI.setAttributes", o, id, t) end,
    setValue = function(id, v) fx("objUI.setValue", o, id, v) end,
  })
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
function M.getColorTint(o) local c = o.__d.tint or { 1, 1, 1 } return { r = c.r or c[1], g = c.g or c[2], b = c.b or c[3] } end
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
function M.createButton(o, p)
  o.__d.buttons[#o.__d.buttons + 1] = p
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
  if b ~= nil then for k, v in pairs(p) do if k ~= "index" then b[k] = v end end end
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
function M.setInvisibleTo(o, c) fx("setInvisibleTo", o, c) end
function M.flip(o) local r = o.__d.rot r.z = (r.z + 180) % 360 fx("flip", o) end
function M.getTransformForward(o) local a = math.rad(o.__d.rot.y) return vec(math.sin(a), 0, math.cos(a)) end
function M.getTransformRight(o) local a = math.rad(o.__d.rot.y) return vec(math.cos(a), 0, -math.sin(a)) end
function M.positionToWorld(o, p) p = vec(p) local f, r = M.getTransformForward(o), M.getTransformRight(o) local s = o.__d.scale
  return o.__d.pos + r * (p.x * s.x) + vec(0, p.y * s.y, 0) + f * (p.z * s.z) end
function M.positionToLocal(o, p) p = vec(p) - o.__d.pos local f, r = M.getTransformForward(o), M.getTransformRight(o) local s = o.__d.scale
  return vec(V.dot(p, r) / s.x, p.y / s.y, V.dot(p, f) / s.z) end
function M.getBoundsNormalized(o) return { center = o.__d.pos:copy(), size = vec(2.2, 0.2, 3.1), offset = vec(0, 0, 0) } end
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
function getObjects() local out = {} for _, o in ipairs(SIM.order) do if alive(o) then out[#out + 1] = o end end return out end
getAllObjects = getObjects
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
  local o = makeObj({ Name = d.Name, Nickname = d.Nickname, Description = d.Description, GMNotes = d.GMNotes, ContainedObjects = d.ContainedObjects,
    CustomDeck = d.CustomDeck, CardID = d.CardID, Locked = d.Locked,
    Transform = { posX = p.position and vec(p.position).x or 0, posY = p.position and vec(p.position).y or 0, posZ = p.position and vec(p.position).z or 0,
      rotX = p.rotation and vec(p.rotation).x or 0, rotY = p.rotation and vec(p.rotation).y or 0, rotZ = p.rotation and vec(p.rotation).z or 0, scaleX = 1, scaleY = 1, scaleZ = 1 } })
  o.__d.data = d
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
      SIM.webq[#SIM.webq + 1] = { id = SIM.webN, url = url, method = method, body = body }
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
Notes = { setNotes = function() end, getNotes = function() return "" end, getNotebookTabs = function() return {} end }
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
  local b = SIM.btn and SIM.btn[id]
  return b and (b.bg .. "|" .. b.fg) or "nil"
end
UI = {
  setXml = function(x) SIM.xml = x readButtons(x) fx("UI.setXml", hash(x)) end,
  getXml = function() return SIM.xml end,
  setAttribute = function(id, k, v) SIM.attrs[id .. "|" .. k] = tostring(v) redraw(id, { [k] = v }) fx("UI.setAttribute", id, k, tostring(v)) end,
  setAttributes = function(id, t) for k, v in pairs(t) do SIM.attrs[id .. "|" .. k] = tostring(v) end redraw(id, t) fx("UI.setAttributes", id, t) end,
  getAttribute = function(id, k) return SIM.attrs[id .. "|" .. k] end,
  setValue = function(id, v) SIM.values[id] = v fx("UI.setValue", id, v) end,
  getValue = function(id) return SIM.values[id] end,
  show = function(id) fx("UI.show", id) end,
  hide = function(id) fx("UI.hide", id) end,
  setCustomAssets = function(t) fx("UI.setCustomAssets", #t) end,
  getCustomAssets = function() return {} end,
}

-- ───────── players ─────────
local COLORS = { "White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Grey", "Black" }
Player = setmetatable({}, { __index = function(t, color)
  if color == "getPlayers" then return function() local out = {} for c in pairs(SIM.seated) do out[#out + 1] = t[c] end table.sort(out, function(a, b) return a.color < b.color end) return out end end
  if color == "getAvailableColors" then return function() return { "White", "Red", "Yellow", "Blue" } end end
  if color == "getColors" then return function() return COLORS end end
  if color == "Action" then return { PickUp = 0, Select = 1, FlipOver = 2, RotateIncrementalLeft = 3, RotateIncrementalRight = 4, Copy = 5, Paste = 6, Delete = 7, Group = 8, Randomize = 9, Cut = 10 } end
  local p = { color = color, seated = SIM.seated[color] == true, steam_name = SIM.seated[color] and ("Player" .. color) or "", host = color == SIM.host,
    admin = color == SIM.host, promoted = false, team = "None", steam_id = "0" }
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
end
return SIM
