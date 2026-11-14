// The flip guard (tools/engine-renderer.lua engineFlipGuardTick), on the fake TTS, whose flipTable() throws the table
// and every object, locked or not, as TTS's top-menu Flip does (measured live 2026-11-14). Engine mode on + a flip: the
// table goes back, the furniture (locked, not engine cards) goes back where the snapshot had it and stays locked, the
// players are told, and the bridge is asked for the board again (hello, again); engine cards and unlocked objects are
// not put back (the bridge redraws the first, the second are the players'); an object the flip destroyed is counted
// lost. A player moving an unlocked card isn't undone. The guard's per-frame cost is the table object only: no object
// scan, no call on any other object, between its 3 s snapshots. Engine mode off: nothing is put back.
// (The user, 2026-11-14: "make the flip the table button not work when engine mode is on".)
//   node tests/test_table_flip_guard.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark, frames) => ({ lua, mark, frames });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const told = (r, mark) => ((r.steps.find((s) => s.step === mark) || {}).fx || []).filter((l) => /broadcast/.test(l)).join(" | ");
const SAID = /The table can't be flipped while the engine is on/;
const save = buildSave();

// __f and __g locked pieces of the table's furniture, __u an unlocked card, __e a locked engine card; __home their spots
const setup = `
for _, o in ipairs(getObjects()) do
  if o.getLock() and not tostring(o.getGMNotes()):find("^engine:") then if __f == nil then __f = o elseif __g == nil then __g = o end end
end
local function card(gm, x, lock)
  return spawnObjectData({ data = { Name = "Card", Nickname = "c", GMNotes = gm, CardID = 100, Locked = lock,
    CustomDeck = { ["1"] = { FaceURL = "f", BackURL = "b", NumWidth = 1, NumHeight = 1 } } }, position = Vector(x, 1, 3) })
end
__u = card("", 4, false)
__e = card("engine:c1", 6, true)
__home = {}
for _, k in ipairs({ "f", "u", "e" }) do local o = _G["__" .. k] __home[k] = { pos = o.getPosition(), rot = o.getRotation() } end
__sent = {}
local real = engineSend
engineSend = function(t, p) __sent[#__sent + 1] = t .. ((type(p) == "table" and p.again) and ":again" or "") return real(t, p) end
return (__f ~= nil and __g ~= nil) and "ok" or "no furniture"`;
// "x,y,z|rx,ry,rz" of the table, and whether each object is at its home spot (and locked)
const at = (mark, frames) => q(`
local function near(a, b) return math.abs(a.x - b.x) + math.abs(a.y - b.y) + math.abs(a.z - b.z) < 0.01 end
local t = Tables.getTableObject()
local p, r = t.getPosition(), t.getRotation()
local s = string.format("table %.2f,%.2f,%.2f|%.2f,%.2f,%.2f", p.x, p.y, p.z, r.x, r.y, r.z)
for _, k in ipairs({ "f", "u", "e" }) do
  local o = _G["__" .. k]
  s = s .. " " .. k .. "=" .. ((near(o.getPosition(), __home[k].pos) and near(o.getRotation(), __home[k].rot)) and "home" or "moved") .. (o.getLock() and "/L" or "")
end
return s .. " sent=" .. table.concat(__sent, ",") .. " lost=" .. tostring(engineFlipGuard.lost)`, mark, frames);
const TABLE_HOME = "table 0.00,-3.00,0.00|0.00,0.00,0.00";

const r = simulate({ save, seated: ["Blue"], host: "Blue", steps: [
  q(setup, "setup"),
  q("setEngineMode(true) return 'ok'", "on"),
  // a player moves their unlocked card, and the guard runs on past a snapshot
  q("local p = __u.getPosition() __u.setPosition(Vector(p.x + 5, p.y, p.z)) __home.u = { pos = __u.getPosition(), rot = __u.getRotation() } return 'ok'", "move", 200),
  at("after move"),
  q("flipTable() return 'ok'", "flip", 2),
  at("after flip"),
  // the second pass, half a second on: still in place, no second message
  q("return 'ok'", "settle", 40),
  at("after settle"),
  // a flip that destroys an object: it is counted lost, the rest goes back
  q("__gid, __gpos = __g.getGUID(), __g.getPosition() __sim.flipDestroy = { [__gid] = true } flipTable() return 'ok'", "flip lost", 2),
  at("after flip lost"),
  q("local o = getObjectFromGUID(__gid) if o == nil or o.isDestroyed() then return 'gone' end local p = o.getPosition() return 'back' .. (o.getLock() and '/L' or '') .. ((math.abs(p.x - __gpos.x) + math.abs(p.y - __gpos.y) + math.abs(p.z - __gpos.z) < 0.01) and '/home' or '/moved')", "back"),
  // engine mode off: the table works like the original
  q("__sim.flipDestroy = nil setEngineMode(false) return 'ok'", "off", 30),
  q("for _, k in ipairs({ 'f', 'u', 'e' }) do local o = _G['__' .. k] __home[k] = { pos = o.getPosition(), rot = o.getRotation() } end __sent = {} return 'ok'", "rehome"),
  q("flipTable() return 'ok'", "flip off", 60),
  at("after flip off"),
] });

ok("flip guard: the script ran", !r.errors.length, r.errors.slice(0, 2).join(" | "));
ok("flip guard: the test found furniture", valueOf(r, "setup") === "ok", valueOf(r, "setup"));
const am = valueOf(r, "after move") || "";
ok("flip guard: a player's move of an unlocked card isn't undone", / u=home/.test(am) && am.startsWith(TABLE_HOME), am);
ok("flip guard: no message without a flip", !SAID.test(told(r, "move")), told(r, "move"));
const af = valueOf(r, "after flip") || "";
ok("flip guard: engine on + flip puts the table back", af.startsWith(TABLE_HOME), af);
ok("flip guard: the furniture goes back, locked", / f=home\/L/.test(af), af);
ok("flip guard: the players are told", SAID.test(told(r, "flip")), told(r, "flip"));
ok("flip guard: the bridge is asked for the board again", /hello:again/.test(af), af);
ok("flip guard: engine cards are left to the bridge's redraw", / e=moved/.test(af), af);
ok("flip guard: unlocked objects aren't put back", / u=moved/.test(af), af);
const as = valueOf(r, "after settle") || "";
ok("flip guard: still in place after the second pass", as.startsWith(TABLE_HOME) && / f=home\/L/.test(as), as);
ok("flip guard: one message for one flip", !SAID.test(told(r, "settle")), told(r, "settle"));
const al = valueOf(r, "after flip lost") || "";
ok("flip guard: an object the flip destroyed is counted lost", / lost=1$/.test(al) && al.startsWith(TABLE_HOME) && / f=home\/L/.test(al), al);
ok("flip guard: and is spawned again, same GUID, locked, where it stood", valueOf(r, "back") === "back/L/home", valueOf(r, "back"));
ok("flip guard: a flip again within 3 s isn't told twice (one message, one redraw)", !SAID.test(told(r, "flip lost")) && !/hello:again,hello:again/.test(al), `${told(r, "flip lost")} ${al}`);
const ao = valueOf(r, "after flip off") || "";
ok("flip guard: engine off + flip puts nothing back", !ao.startsWith(TABLE_HOME) && / f=moved/.test(ao), ao);
ok("flip guard: engine off + flip says nothing and asks for nothing", !SAID.test(told(r, "flip off")) && !/hello:again/.test(ao), `${told(r, "flip off")} ${ao}`);

// per-frame cost: 170 frames between two snapshots, counted with the guard and with it a no-op
const cost = (guard) => {
  const c = simulate({ save, seated: ["Blue"], host: "Blue", steps: [
    q(`${guard ? "" : "engineFlipGuardTick = function() end "}setEngineMode(true) return 'ok'`, "on", 5),
    q("engineFlipGuard.frame = 0 __sim.calls = {} return 'ok'", "count", 170),
    q("local c = __sim.calls __sim.calls = nil local t = {} for k, n in pairs(c) do t[#t + 1] = k .. '=' .. n end table.sort(t) return table.concat(t, ' ')", "counted", 1),
  ] });
  const m = {};
  for (const kv of (valueOf(c, "counted") || "").split(" ").filter(Boolean)) { const [k, n] = kv.split("="); m[k] = Number(n); }
  return { m, errors: c.errors };
};
const on = cost(true), none = cost(false);
ok("flip guard cost: both runs ran", !on.errors.length && !none.errors.length, [...on.errors, ...none.errors].slice(0, 2).join(" | "));
const tableCalls = Object.entries(on.m).filter(([k]) => k.startsWith("table.")).reduce((a, [, n]) => a + n, 0);
ok("flip guard cost: the table object is looked at once a frame (a handful of calls)", (on.m["table.getPosition"] || 0) >= 170 && tableCalls <= 170 * 4, JSON.stringify(on.m));
const extra = Object.keys({ ...on.m, ...none.m }).filter((k) => !k.startsWith("table.") && (on.m[k] || 0) !== (none.m[k] || 0));
ok("flip guard cost: no object scan and no other object touched per frame", extra.length === 0, extra.map((k) => `${k} ${on.m[k] || 0} vs ${none.m[k] || 0}`).join(", "));

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
