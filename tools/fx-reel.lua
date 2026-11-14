-- A close-up reel of every table particle effect, each with its sound and its name on White's screen, for a screen
-- recording (marketing). Run with no game on, through the bridge's debug exec:
--   curl -X POST http://127.0.0.1:48787/exec --data-binary @tools/fx-reel.lua
-- It moves the table's own effect rigs (engine:fx, engine:bolt) over White's playmat, plays their trigger effects and
-- parks them back under the table (y -30) when it ends; it touches nothing else. Returns the reel's length in seconds.
local S = { x = 20, y = 1.5, z = -12 }                       -- (White's playmat, above its card row, a little above it)
local rigs, bolts = {}, {}
for _, o in ipairs(getObjects()) do
  local g = o.getGMNotes()
  if g == "engine:fx" then rigs[#rigs + 1] = o elseif g == "engine:bolt" then bolts[#bolts + 1] = o end
end
local park = {}
for _, o in ipairs(rigs) do park[o] = o.getPosition() end
for _, o in ipairs(bolts) do park[o] = o.getPosition() end
Player.White.lookAt({ position = { S.x, 0, S.z }, pitch = 50, yaw = 0, distance = 12 })
local t, nextRig = 1.5, 0
local function rig() nextRig = nextRig % #rigs + 1 return rigs[nextRig] end
local function say(at, text) Wait.time(function() broadcastToColor(text, "White", { 1, 0.85, 0.4 }) end, at) end
local function sound(at, kind) if kind then Wait.time(function() pcall(engineSoundPlay, kind, true) end, at) end end
-- one effect: idx on a rig at (x, z), rotation yaw, scale
local function fire(at, idx, x, z, yaw, scale, kind)
  local o = rig()
  Wait.time(function()
    o.setRotation({ 0, yaw or 0, 0 }) o.setScale({ scale or 1, scale or 1, scale or 1 })
    o.setPosition({ x, S.y, z })
    Wait.time(function() o.AssetBundle.playTriggerEffect(idx) end, 0.1)
  end, at)
  sound(at + 0.1, kind)
end
local function beat(name, idx, kind)
  say(t, name) fire(t + 0.4, idx, S.x, S.z, 0, 1, kind) t = t + 3
end
beat("Creature dies", 0, "death")
beat("Creature dies from damage (burn)", 10, "death")
beat("Exiled", 2, "exile")
beat("Exiled (neutral)", 11, "exile")
beat("Spell countered", 3, "countered")
beat("Damage to a creature", 4, "damage")
beat("Damage to a player", 5, "playerhit")
beat("+1/+1 counter", 6, "counter")
beat("-1/-1 counter", 7, "counter")
beat("Life gained", 8, "lifegain")
beat("Player knocked out", 9, "knockout")
-- the bolts, one per colour: a bolt rig at the source, local +z at the target, scaled to the distance
local names = { { 0, "Bolt" }, { 1, "Bolt (white)" }, { 2, "Bolt (blue)" }, { 3, "Bolt (black)" }, { 4, "Bolt (red)" }, { 5, "Bolt (green)" } }
for i, b in ipairs(names) do
  local o = bolts[(i - 1) % #bolts + 1]
  local a, z = { x = S.x - 7, z = S.z + 1 }, { x = S.x + 6, z = S.z - 1 }
  local dx, dz = z.x - a.x, z.z - a.z
  local d = math.sqrt(dx * dx + dz * dz)
  say(t, b[2])
  Wait.time(function()
    o.setRotation({ 0, math.deg((math.atan2 or math.atan)(dx, dz)), 0 }) o.setScale({ d, d, d })
    o.setPosition({ a.x, S.y, a.z })
    Wait.time(function() o.AssetBundle.playTriggerEffect(b[1]) end, 0.1)
  end, t + 0.4)
  sound(t + 0.65, "damage")
  t = t + 2.6
end
-- the board wipes: the wave in each colour, from behind White's playmat toward the table's middle, with deaths
local waves = { { 13, "white" }, { 14, "blue" }, { 15, "black" }, { 16, "red" }, { 17, "green" }, { 18, "colourless" }, { 19, "multicolour" } }
for _, w in ipairs(waves) do
  say(t, "Board wipe (" .. w[2] .. ")")
  fire(t + 0.4, w[1], S.x, S.z - 5, 0, 1.4, "wipe")
  for k = 0, 3 do fire(t + 0.7 + 0.12 * k, 1, S.x - 4.5 + 3 * k, S.z + 1, 0, 1, nil) end
  t = t + 4
end
Wait.time(function()
  for o, p in pairs(park) do if not o.isDestroyed() then o.setScale({ 1, 1, 1 }) o.setRotation({ 0, 0, 0 }) o.setPosition(p) end end
  broadcastToColor("That's every effect.", "White", { 1, 0.85, 0.4 })
end, t + 0.5)
return t + 1.5
