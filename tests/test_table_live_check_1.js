// Live check 1's three table findings (docs/handoff/live-check-1-fixes-report.md), on fengari with stand-ins for TTS
// and the table profiles' real positions; no TTS save needed.
//  1. The GIF frame (engineGif.freeSpot) never lands on the strip its owner's marks boxes may fill (SPELLS THIS TURN and
//     the effects under it: engineMarksStrip), on every seat of the 4- and 6-player tables. The strip is worked out
//     here on its own, from ENGINE_MARKS_FIT and the life tracker's spot (its rotation the seat's mat's, its scale the
//     4-player table's measured 1.258: the profiles hold neither). Live, White's frame lay at (4.2, -7.9) on it.
//  2. A playable row card from exile says FROM EXILE (engineCostParts), its hover where it is cast from and why when
//     known; the bridge sends og "exile" (and ogw) for it, as og "graveyard" before.
//  3. The planned attack line is clearly visible (as wide as a target line, a quarter towards white, a target line's arc,
//     ten dashes) and bends around the attacker's own life counter (ENGINE_LINE_AVOID.arc): White to Red on the 4-player
//     table ran over White's counter.
//   node tests/test_table_live_check_1.js
const fs = require("fs");
const path = require("path");
const harness = require("./bridge-harness");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
const FOUR = require("../tools/profiles/2296042369.json"), SIX = require("../tools/profiles/2293586471.json");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const fail = (why) => { process.stdout.write(`FAIL test_table_live_check_1: ${why}\n`); process.exit(1); };
const fn = (name) => {
  const a = SRC.indexOf(`\nfunction ${name}(`);
  const b = a < 0 ? -1 : SRC.indexOf("\nend\n", a);
  if (a < 0 || b < 0) fail(`${name} is gone from engine-renderer.lua`);
  return SRC.slice(a, b + 5);
};
const line = (start) => {
  const a = SRC.indexOf(start);
  if (a < 0) fail(`"${start.slice(0, 40)}" is gone`);
  return SRC.slice(a, SRC.indexOf("\n", a) + 1);
};
const field = (re) => { const m = SRC.match(re); if (!m) fail(`${re} is gone`); return m[1]; };
const SCALE = 1.258;
const GIF = { SIZE: Number(field(/\n  SIZE = ([\d.]+),/)), R: field(/\n  SPOTS_R = (\{[^}]*\})/), F: field(/\n  SPOTS_F = (\{[^}]*\})/) };
const LUA = [
  line("ENGINE_MARKS_FIT = {"), line("BADGE.from = {"), line("ENGINE_LINE_AVOID = {"),
  ...["engineMarksOutward", "engineMarksStrip", "engineMarksStripHit", "engineGif.freeSpot", "engineCostChange", "engineCostParts", "ENGINE_LINE_AVOID.hit", "ENGINE_LINE_AVOID.arc"].map(fn),
].join("\n");
const STUBS = `
local vmt = {}
vmt.__add = function(a, b) return Vector(a.x + b.x, a.y + b.y, a.z + b.z) end
vmt.__sub = function(a, b) return Vector(a.x - b.x, a.y - b.y, a.z - b.z) end
vmt.__mul = function(a, k) if type(a) == "number" then a, k = k, a end return Vector(a.x * k, a.y * k, a.z * k) end
function Vector(x, y, z) return setmetatable({ x = x, y = y, z = z }, vmt) end
function onTable(p, h) return Vector(p.x, 1 + (h or 0), p.z) end
BADGE = { cost = {}, less = {}, more = {} }
engineGif = { SIZE = ${GIF.SIZE}, SPOTS_R = ${GIF.R}, SPOTS_F = ${GIF.F}, ownerOf = function() return nil end }
-- a TTS object at (x, z) turned ry about y, scaled s: Unity's turn, local +x -> (cos, 0, -sin), +z -> (sin, 0, cos)
function obj(x, z, ry, s)
  local a = math.rad(ry)
  return { getPosition = function() return Vector(x, 1, z) end, getRotation = function() return { x = 0, y = ry, z = 0 } end,
    getScale = function() return { x = s, y = s, z = s } end,
    positionToLocal = function(p) local dx, dz = p.x - x, p.z - z return Vector((dx * math.cos(a) - dz * math.sin(a)) / s, 0, (dx * math.sin(a) + dz * math.cos(a)) / s) end }
end
TRACKERS = {}
LIFE_TRACKERS = {}
function getObjectFromGUID(g) return TRACKERS[g] end
OBJECTS = {}
function getObjects() return OBJECTS end
function geometry(mx, mz, ry)
  local a = math.rad(ry)
  return { mat = Vector(mx, 1, mz), right = Vector(math.cos(a), 0, -math.sin(a)), fwd = Vector(math.sin(a), 0, math.cos(a)) }
end
`;
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(`${STUBS}\n${LUA}`)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) fail(`the table code doesn't load: ${lua.lua_tojsstring(L, -1)}`);
const q = (src, ...args) => {
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
  for (const a of args) lua.lua_pushstring(L, to_luastring(a));
  if (lua.lua_pcall(L, args.length, 1, 0) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
  const v = lua.lua_isnil(L, -1) ? null : lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  return v;
};

// ── 1. the GIF frame and the marks strip ──
// the strip's world box, worked out here: button x = -local x, local -> world by the tracker's turn and scale
const FIT = (() => { const t = line("ENGINE_MARKS_FIT = {"); const g = (k) => Number(t.match(new RegExp(`\\b${k} = ([\\d.]+)`))[1]); return { inner: g("inner"), max: g("max"), boxes: g("boxes"), gap: g("gap"), perLocal: g("perLocal"), top: g("top") }; })();
function stripBox(tr, ry) {
  const a = (ry * Math.PI) / 180;
  const s = -tr.x * Math.cos(a) + tr.z * Math.sin(a);
  const sign = s < -0.01 ? -1 : 1;
  const bxs = [sign * -FIT.inner / FIT.perLocal, sign * (FIT.max - FIT.inner) / FIT.perLocal];
  const zs = [FIT.top, FIT.top + FIT.boxes * (380 + FIT.gap) / FIT.perLocal];
  const pts = bxs.flatMap((bx) => zs.map((lz) => { const lx = -bx; return { x: tr.x + SCALE * (lx * Math.cos(a) + lz * Math.sin(a)), z: tr.z + SCALE * (-lx * Math.sin(a) + lz * Math.cos(a)) }; }));
  return { x1: Math.min(...pts.map((p) => p.x)), x2: Math.max(...pts.map((p) => p.x)), z1: Math.min(...pts.map((p) => p.z)), z2: Math.max(...pts.map((p) => p.z)) };
}
const overlaps = (p, half, b) => p.x + half > b.x1 && p.x - half < b.x2 && p.z + half > b.z1 && p.z - half < b.z2;
const spotOf = (color, seat) => q(`local p = engineGif.freeSpot("${color}", geometry(${seat.playmat.x}, ${seat.playmat.z}, ${seat.playmat.rotY})) return string.format("%.3f,%.3f", p.x, p.z)`);
const firstSpot = (seat) => q(`local g = geometry(${seat.playmat.x}, ${seat.playmat.z}, ${seat.playmat.rotY}) local p = g.mat + g.right * engineGif.SPOTS_R[1] + g.fwd * engineGif.SPOTS_F[1] return string.format("%.3f,%.3f", p.x, p.z)`);
for (const [name, prof] of [["4-player", FOUR], ["6-player", SIX]]) {
  for (const color of prof.seats) {
    const seat = prof.seat[color];
    q(`TRACKERS["t${color}"] = obj(${seat.lifeTracker.x}, ${seat.lifeTracker.z}, ${seat.playmat.rotY}, ${SCALE}) LIFE_TRACKERS["${color}"] = "t${color}" OBJECTS = {} return "ok"`);
    const box = stripBox(seat.lifeTracker, seat.playmat.rotY);
    // (the table's strip, point by point around the counter, against this working-out of it)
    const grid = [];
    for (let dx = -8; dx <= 8; dx += 0.5) for (let dz = -14; dz <= 14; dz += 0.5) grid.push([seat.lifeTracker.x + dx, seat.lifeTracker.z + dz]);
    const luaHits = q(`local s = engineMarksStrip("${color}") local out = {} for _, xz in ipairs({ ${grid.map(([gx, gz]) => `{ ${gx}, ${gz} }`).join(", ")} }) do out[#out + 1] = engineMarksStripHit(s, Vector(xz[1], 1, xz[2]), 0) and "1" or "0" end return table.concat(out)`);
    const jsHits = grid.map(([gx, gz]) => (gx > box.x1 + 1e-6 && gx < box.x2 - 1e-6 && gz > box.z1 + 1e-6 && gz < box.z2 - 1e-6 ? "1" : (gx < box.x1 - 1e-6 || gx > box.x2 + 1e-6 || gz < box.z1 - 1e-6 || gz > box.z2 + 1e-6 ? "0" : "?"))).join("");
    const differ = [...jsHits].map((c, i) => (c !== "?" && c !== luaHits[i] ? `${grid[i][0]},${grid[i][1]}` : null)).filter(Boolean);
    ok(`strip: ${name} ${color}'s marks strip, where the boxes go, under the counter on the mat's inner corner`, differ.length === 0, `${differ.length} points differ, first ${differ.slice(0, 3).join(" ")}`);
    const [x, z] = spotOf(color, seat).split(",").map(Number);
    ok(`frame: ${name} ${color}'s GIF frame is clear of the marks strip under the life counter`, !overlaps({ x, z }, GIF.SIZE, box), `frame at ${x}, ${z}, the strip x ${box.x1.toFixed(2)}..${box.x2.toFixed(2)}, z ${box.z1.toFixed(2)}..${box.z2.toFixed(2)}`);
    // (the frame's spot is still one of its candidates beside the battlefield grid: within the mat's reach)
    ok(`frame: ${name} ${color}'s frame stays beside their own mat`, Math.hypot(x - seat.playmat.x, z - seat.playmat.z) < 25, `${x}, ${z}`);
  }
}
{
  // the live finding itself: White's first candidate on the 4-player table is (4.2, -7.9), on the strip
  const w = FOUR.seat.White;
  same("frame: White's first candidate on the 4-player table is the live finding's spot", firstSpot(w), "4.200,-7.900");
  ok("frame: that spot is on White's marks strip (the finding)", overlaps({ x: 4.2, z: -7.9 }, GIF.SIZE, stripBox(w.lifeTracker, w.playmat.rotY)));
  // every spot off the strip taken by objects: the first spot off the strip, not the first spot (on it)
  q(`TRACKERS.tWhite = obj(${w.lifeTracker.x}, ${w.lifeTracker.z}, 180, ${SCALE}) LIFE_TRACKERS.White = "tWhite"
    local g = geometry(${w.playmat.x}, ${w.playmat.z}, 180) OBJECTS = {}
    for _, r in ipairs(engineGif.SPOTS_R) do for _, f in ipairs(engineGif.SPOTS_F) do
      local p = g.mat + g.right * r + g.fwd * f
      OBJECTS[#OBJECTS + 1] = { type = "Card", getPosition = function() return Vector(p.x, 1, p.z) end, getBounds = function() return { center = Vector(p.x, 1, p.z), size = Vector(2, 1, 2) } end }
    end end return "ok"`);
  const [x, z] = spotOf("White", w).split(",").map(Number);
  ok("frame: with every spot taken, the frame still keeps off the marks strip", !overlaps({ x, z }, GIF.SIZE, stripBox(w.lifeTracker, 180)), `${x}, ${z}`);
  q("OBJECTS = {} return 'ok'");
}

// ── 2. FROM EXILE ──
const parts = (c) => q(`local c = { og = ${JSON.stringify(c.og)}, ogw = ${c.ogw ? JSON.stringify(c.ogw) : "nil"}, fd = ${!!c.fd} } local out = {} for _, b in ipairs(engineCostParts(c)) do out[#out + 1] = b[1] .. "|" .. b[2] .. "|" .. b[4] end return table.concat(out, ";")`);
same("exile: a playable row card from exile says FROM EXILE, its hover where it is cast from", parts({ og: "exile" }), "costFrom|FROM EXILE|Playable from exile");
same("exile: its hover says why when the bridge knows", parts({ og: "exile", ogw: "Castable until end of turn, by Outpost Siege" }), "costFrom|FROM EXILE|Playable from exile: Castable until end of turn, by Outpost Siege");
same("exile: a graveyard card still says FROM GRAVEYARD", parts({ og: "graveyard" }), "costFrom|FROM GRAVEYARD|Playable from its owner's graveyard");
same("exile: a face-down card says nothing (others may see the buttons)", parts({ og: "exile", fd: true }), "");

// ── 3. the planned attack line ──
const style = (k) => { const m = SRC.match(new RegExp(`\\b${k} = \\{ color = \\{[^}]*\\}, thickness = ([\\d.]+) \\}`)); return m ? Number(m[1]) : null; };
const thick = { target: style("target"), attack: style("attack"), block: style("block"), planned: style("planned"), border: Number(field(/thick = ([\d.]+), y = 0\.98/)) };
ok("line: the planned line is as wide as a target line or wider (it was 0.12)", thick.planned >= 0.25, JSON.stringify(thick));
ok("line: its width is its own (lines are told apart by width)", new Set(Object.values(thick).map((t) => t.toFixed(4))).size === 5, JSON.stringify(thick));
ok("line: drawn on a target line's arc, bent around the planner's own counter (engineDrawLines' call)", SRC.includes("plannedStyle(pa[3]), nil, true, lifeSpot(pa[3]), g and g.mat or nil)"));
ok("line: a quarter towards white, not halfway (White's own stays white)", SRC.includes("{ (1 + 3 * rgb[1]) / 4, (1 + 3 * rgb[2]) / 4, (1 + 3 * rgb[3]) / 4 }"));
const arc = (a, b, avoid, mat, lift = "nil") => JSON.parse(q(`local pts = ENGINE_LINE_AVOID.arc(Vector(${a.x}, 1.2, ${a.z}), Vector(${b.x}, 1.2, ${b.z}), ${lift}, ${avoid ? `Vector(${avoid.x}, 1, ${avoid.z})` : "nil"}, ${mat ? `Vector(${mat.x}, 1, ${mat.z})` : "nil"}) local out = {} for _, p in ipairs(pts) do out[#out + 1] = string.format("[%.3f,%.3f,%.3f]", p[1], p[2], p[3]) end return "[" .. table.concat(out, ",") .. "]"`));
const AV = (() => { const t = line("ENGINE_LINE_AVOID = {"); const g = (k) => Number(t.match(new RegExp(`\\b${k} = ([\\d.]+)`))[1]); return { hx: g("hx"), hz: g("hz") }; })();
const onCounter = (p, t) => Math.abs(p[0] - t.x) < AV.hx && Math.abs(p[2] - t.z) < AV.hz;
{
  const w = FOUR.seat.White, r = FOUR.seat.Red;
  // White's front-row creatures near the middle, attacking Red: the straight line runs over White's counter
  const froms = [{ x: 9, z: -6 }, { x: 11, z: -5 }, { x: 8.5, z: -7.5 }, { x: 13, z: -9 }];
  const straightHits = froms.filter((a) => arc(a, r.lifeTracker, null, null).slice(3).some((p) => onCounter(p, w.lifeTracker)));
  ok("line: the finding: a straight line from White's front row to Red runs over White's own counter", straightHits.length > 0);
  for (const a of froms) {
    const pts = arc(a, r.lifeTracker, w.lifeTracker, w.playmat);
    const at = `from ${a.x}, ${a.z}`;
    ok(`line: White to Red ${at} keeps off White's own life counter`, !pts.slice(3).some((p) => onCounter(p, w.lifeTracker)), JSON.stringify(pts.filter((p) => onCounter(p, w.lifeTracker))));
    const end = pts.at(-1);
    ok(`line: White to Red ${at} still starts on the attacker and ends on Red's counter`, Math.abs(pts[0][0] - a.x) < 0.01 && Math.abs(end[0] - r.lifeTracker.x) < 0.01 && Math.abs(end[2] - r.lifeTracker.z) < 0.01, JSON.stringify([pts[0], end]));
    ok(`line: White to Red ${at} bends towards the middle of the table, not over the marks boxes`, pts.every((p) => p[2] >= Math.min(a.z, r.lifeTracker.z) - 0.01), JSON.stringify(pts.map((p) => p[2].toFixed(2))));
  }
  // a line that never comes near the counter is not bent: on the 6-player table, White to Red, White's counter at the
  // far end of White's mat (the 4-player table's middle is too crowded for one: every counter is within 7 of another)
  const sixFar = arc({ x: 20, z: -9 }, SIX.seat.Red.lifeTracker, SIX.seat.White.lifeTracker, SIX.seat.White.playmat), sixPlain = arc({ x: 20, z: -9 }, SIX.seat.Red.lifeTracker, null, null);
  same("line: a line clear of the counter is not bent", sixFar, sixPlain);
  // high enough to read over the cards: its middle well over the table (the old fixed lift 0.5 put it at 0.8)
  const mid = arc(froms[0], r.lifeTracker, w.lifeTracker, w.playmat)[10];
  ok("line: on a target line's arc, its middle at least 1.5 over its ends", mid[1] - 1.2 >= 1.5, JSON.stringify(mid));
  same("line: 21 points, ten dashes when drawn dashed", arc(froms[0], r.lifeTracker, w.lifeTracker, w.playmat).length, 21);
  // the six-player table: White to Red, the counters far apart, nothing in the way
  const sw = SIX.seat.White, sr = SIX.seat.Red;
  const six = arc({ x: 20, z: -9 }, sr.lifeTracker, sw.lifeTracker, sw.playmat);
  ok("line: on the 6-player table White to Red keeps off White's counter", !six.slice(3).some((p) => onCounter(p, sw.lifeTracker)));
}

// ── the bridge: og "exile" ──
(async () => {
  const F = require("./golden/fixtures/dump2.json");
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const h = harness.load();
  try {
    const b = clone(F.board);
    b.gameView.battlefield = b.gameView.battlefield || undefined;
    const bf = b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
    bf.push({ id: "engine-card-950", identity: { name: "Outpost Siege" }, types: ["Enchantment"], text: "As Outpost Siege enters, choose Khans or Dragons.\n• Khans — At the beginning of your upkeep, exile the top card of your library. Until end of turn, you may play that card.", controllerId: "player-0", ownerId: "player-0" });
    b.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-0").cards.push(
      { id: "engine-card-951", identity: { name: "Bonecrusher Giant" }, types: ["Creature"], mayPlay: true, ownerId: "player-0", controllerId: "player-0" },
      { id: "engine-card-952", identity: { name: "Lightning Bolt" }, types: ["Instant"], mayPlay: true, exiledWith: "engine-card-950", ownerId: "player-0", controllerId: "player-0" },
      { id: "engine-card-953", identity: { name: "Saw It Coming" }, types: ["Instant"], mayPlay: true, isFaceDown: true, isForetold: true, ownerId: "player-0", controllerId: "player-0" });
    const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
    seat.slot = "player-0";
    seat.board = { state: clone(b), fingerprint: null };
    h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
      slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
    h.B.sendTable(); await h.flush();
    const me = (h.effects.filter((e) => e.tts?.t === "table").map((e) => e.tts)[0]?.players || []).find((p) => p.slot === "player-0");
    const row = (id) => (me?.playable || []).find((c) => c.id === id);
    ok("bridge: an adventure creature castable from exile is in the row with og exile", row("engine-card-951")?.og === "exile", JSON.stringify(row("engine-card-951")));
    ok("bridge: a card another let be played says why (ogw)", row("engine-card-952")?.og === "exile" && /Outpost Siege$/.test(row("engine-card-952")?.ogw || ""), JSON.stringify(row("engine-card-952")));
    ok("bridge: a foretold card (face down to the others) has no og: its label is a button everyone may see", row("engine-card-953") && row("engine-card-953").og == null, JSON.stringify(row("engine-card-953")));
    ok("bridge: an exile card not in the row has no og", ((me?.exile || []).find((c) => c.id === "engine-card-951") || {}).og == null);
  } finally { harness.restore(); }
  process.stdout.write(`${failed ? "FAIL" : "PASS"} test_table_live_check_1: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_table_live_check_1: ${e.stack}\n`); process.exit(1); });
