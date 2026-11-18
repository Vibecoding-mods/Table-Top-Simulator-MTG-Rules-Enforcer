// The Archenemy view (docs/team-turns-archenemy-plan.md step 9): the bridge's schemeView and player row (bridge.js:
// schemes out of the command zone, ong for an ongoing one, schemeNow { seq, card } for the one set in motion last, the
// archenemy's arch and schemeDeck) and the table's drawing of them (tools/engine-renderer.lua engineSchemes,
// engineSchemeDeckCard, engineSchemeBanner, engineArchColor; the Archenemy setup button engineArchLabel /
// onMtgSetupArch / engineArchNoted). The bridge's own board messages go into the renderer's functions on fengari, with
// stand-ins for TTS (place, seatGeometry, the screen UI). No TTS save needed.
//   node tests/test_table_archenemy_view.js
const fs = require("fs");
const path = require("path");
const harness = require("./bridge-harness");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
const COPY = fs.readFileSync(path.join(ROOT, "tools", "make-engine-copy.js"), "utf8").replace(/\r\n/g, "\n");
const JSONLUA = fs.readFileSync(path.join(ROOT, "tools", "engine-json.lua"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── the bridge ──
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const SLOTS = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" };
const scheme = (n, name, o = {}) => ({ id: `engine-card-${n}`, identity: { name }, types: ["Scheme"], ...(o.ongoing ? { supertypes: ["Ongoing"] } : {}),
  controllerId: "player-3", ownerId: "player-3", text: o.text || `${name}: when you set this scheme in motion, something happens.` });
function board({ schemes = [], arch = true, deck = 17, flags = null } = {}) {
  const gv = { turn: 3, step: "main1", activePlayerId: "player-3", priorityPlayerId: "player-3", stack: [], combatAssignments: [],
    players: Object.keys(SLOTS).map((id) => ({ id, life: id === "player-3" ? 40 : 20, manaPool: {}, status: "playing",
      ...(arch ? { isArchenemy: id === "player-3", schemeDeckCount: id === "player-3" ? deck : 0 } : {}),
      ...(id === "player-3" && schemes.length ? { schemes: (flags || schemes).map((c) => ({ id: c.id, name: c.identity.name, ongoing: !!c.ongoingFlag || (c.supertypes || []).includes("Ongoing") })) } : {}) })),
    zones: Object.keys(SLOTS).flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) };
  const cmd = gv.zones.find((z) => z.zone === "command" && z.ownerId === "player-3");
  cmd.cards.push({ id: "engine-card-1", identity: { name: "Grizzly Bears" }, types: ["Creature"], power: 2, toughness: 2, controllerId: "player-3", ownerId: "player-3", text: "" }, ...schemes);
  cmd.count = cmd.cards.length;
  return gv;
}
async function tables(boards) {
  const h = harness.load();
  try {
    const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
    seat.slot = "player-3";
    seat.respond = () => {};
    h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 3, total: 4, playerOrder: ["tts-Blue-ab12"], slotNames: { ...SLOTS }, slotColor: { ...SLOTS },
      started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
    const out = [];
    for (const gv of boards) {
      seat.board = { state: { gameView: gv }, fingerprint: null };
      const n0 = h.effects.length;
      h.B.sendTable(); await h.flush(100000);
      out.push(h.effects.slice(n0).filter((e) => e.tts?.t === "table" || e.tts?.t === "texts").map((e) => e.tts));
    }
    return out;
  } finally { harness.restore(); }
}
const lastOf = (msgs) => msgs.filter((m) => m.t === "table").at(-1);
// (the last board message, for drawing after its texts arrived: drawn() reads the table's own copy)
const lastM_ = () => null;
const rowOf = (m, color) => m.players.find((p) => p.color === color);

// ── the table, on fengari ──
const fn = (name) => {
  const a = SRC.indexOf(`\nfunction ${name}(`);
  const b = a < 0 ? -1 : SRC.indexOf("\nend\n", a);
  if (a < 0 || b < 0) { console.log(`FAIL test_table_archenemy_view: ${name} is gone from engine-renderer.lua`); process.exit(1); }
  return SRC.slice(a, b + 5);
};
const line = (start) => {
  const a = SRC.indexOf(start);
  if (a < 0) { console.log(`FAIL test_table_archenemy_view: "${start.slice(0, 40)}" is gone`); process.exit(1); }
  return SRC.slice(a, SRC.indexOf("\n", a) + 1);
};
const LUA = [
  line("ENGINE_SCHEME = {"), line("ENGINE_ARCH_SETUP = nil"), line("ENGINE_ARCH_SEATS = {"),
  ...["engineZoneScale", "engineExpandUrl", "engineStoreStatic", "engineFillStatic", "engineArchColor", "engineSchemeSpot", "engineSchemes", "engineSchemeDeckCard",
    "engineSchemeDeckOf", "engineSchemeBanner", "engineArchLabel", "engineSixSeats", "engineArchSeats", "engineArchNext", "onMtgSetupArch", "engineArchNoted", "engineOnTexts", "engineTextInto"].map(fn),
].join("\n");
const STUBS = `
ENGINE_BACK = "https://back"
ATTACH_SCALE = 0.5
ENGINE_TABLE_SEATS = nil
engineStatic = {}
local vmt = {}
function Vector(x, y, z) return setmetatable({ x = x, y = y, z = z }, vmt) end
GEO = { Blue = { mat = Vector(0, 1, 20), right = Vector(-1, 0, 0), rotY = 0 }, White = { mat = Vector(0, 1, -20), right = Vector(1, 0, 0), rotY = 180 } }
function seatGeometry(c) return GEO[c] end
placed = {}
function place(c, pos, rot, seen, hand, meta)
  seen[c.id] = true
  placed[#placed + 1] = { id = c.id, n = c.n, zone = meta.zone, color = meta.color, x = pos.x, y = pos.y, z = pos.z, rot = rot.y, dg = c.dg, tx = c.tx, f = c.f }
end
engineNameOf = function(c) return c end
engineObjs = {}
descs = {}
function description(c) return tostring(c.tx) end
function takeTexts(json) local m = engineJsonDecode(json) lastTable = lastM engineOnTexts(m) return nil end
seated = { "White", "Blue" }
function getSeatedPlayers() return seated end
Player = { White = { color = "White" }, Blue = { color = "Blue" }, Red = { color = "Red" } }
ui = {}
function setText(id, v) ui[id .. ".text"] = v end
function setAttr(id, k, v) ui[id .. "." .. k] = v end
timers = {}
Wait = { time = function(f, s) timers[#timers + 1] = f end }
chats = {}
function engineChat(text, pl) chats[#chats + 1] = pl.color .. ": " .. text end
function takeBoard(json)
  local m = engineJsonDecode(json)
  for id, st in pairs(m.cards or {}) do engineStoreStatic(id, st) end
  for _, c in ipairs(m.schemes or {}) do engineFillStatic(c) end
  if m.schemeNow ~= nil then engineFillStatic(m.schemeNow.card) end
  lastM = m
  return m
end
function drawn(m)
  placed = {}
  local seen = {}
  engineSchemes(m, seen)
  local out = {}
  for _, p in ipairs(placed) do
    out[#out + 1] = p.zone .. "|" .. tostring(p.n) .. "|" .. p.color .. "|" .. string.format("%.2f,%.2f,%.2f", p.x, p.y, p.z) .. "|" .. tostring(p.rot) .. "|" .. tostring(p.dg):gsub("\\n", "/")
  end
  return table.concat(out, "\\n")
end
`;
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(`${JSONLUA}\n${STUBS}\n${LUA}`)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
  console.log(`FAIL test_table_archenemy_view: the table code doesn't load: ${lua.lua_tojsstring(L, -1)}`); process.exit(1);
}
const q = (src, ...args) => {
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
  for (const a of args) lua.lua_pushstring(L, to_luastring(a));
  if (lua.lua_pcall(L, args.length, 1, 0) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
  const v = lua.lua_isnil(L, -1) ? null : lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  return v;
};
// a board message into the table, then what engineSchemes places
const draw = (m) => (m == null ? q("return drawn(lastM)") : q("local json = ... takeBoard(json) return drawn(lastM)", JSON.stringify(m)));
const banner = (m) => q("local json = ... takeBoard(json) engineSchemeBanner(lastM) return tostring(ui['eng_banner_Blue.text']) .. '|' .. tostring(ui['eng_banner_Blue.active']) .. '|' .. tostring(ui['eng_banner_White.color'])", JSON.stringify(m));

(async () => {
  const plot = scheme(500, "A Display of My Dark Power");
  const ongoing = scheme(501, "Nothing Can Stop Me Now", { ongoing: true });
  const later = scheme(502, "Behold the Power of Destruction");
  const [first, second, third, fourth, fifth] = await tables([
    board({ schemes: [plot] }),                 // set in motion
    board({ schemes: [plot, ongoing] }),        // and an ongoing one
    board({ schemes: [ongoing], deck: 15 }),    // the first went back under the deck
    board({ schemes: [ongoing, later], deck: 14 }),
    board({ schemes: [ongoing, plot], deck: 13 }), // the first again, from the deck
  ]);
  const m1 = lastOf(first), m2 = lastOf(second), m3 = lastOf(third), m4 = lastOf(fourth), m5 = lastOf(fifth);

  // the bridge
  const cmd1 = rowOf(first.find((m) => m.t === "table"), "Blue").command || [];
  ok("bridge: schemes leave the command row", !cmd1.some((c) => c.id === plot.id) && cmd1.some((c) => c.id === "engine-card-1"), JSON.stringify(cmd1));
  same("bridge: the board's schemes, ongoing marked", (m2.schemes || []).map((c) => [c.id, !!c.ong, c.ctl]), [[plot.id, false, "Blue"], [ongoing.id, true, "Blue"]]);
  same("bridge: the archenemy's row says arch and the deck's size", [rowOf(m1, "Blue").arch, rowOf(m1, "Blue").schemeDeck], [true, 17]);
  ok("bridge: the others' rows say nothing", ["White", "Red", "Yellow"].every((c) => rowOf(m1, c).arch === undefined && rowOf(m1, c).schemeDeck === undefined), JSON.stringify(rowOf(m1, "White")));
  same("bridge: the first scheme set in motion is seq 1", [m1.schemeNow?.seq, m1.schemeNow?.card?.id], [1, plot.id]);
  same("bridge: an ongoing one joining is set in motion too (seq 2)", [m2.schemeNow?.seq, m2.schemeNow?.card?.id], [2, ongoing.id]);
  same("bridge: the same schemes again keep their seq", [m3.schemeNow?.seq, m3.schemeNow?.card?.id], [2, ongoing.id]);
  same("bridge: a new one is the next seq", [m4.schemeNow?.seq, m4.schemeNow?.card?.id], [3, later.id]);
  same("bridge: one back from the deck is set in motion again", [m5.schemeNow?.seq, m5.schemeNow?.card?.id], [4, plot.id]);
  const plain = lastOf((await tables([board({ arch: false })]))[0]);
  ok("bridge: no Archenemy game, no schemes and no marks", plain.schemes === undefined && plain.schemeNow === undefined && plain.players.every((p) => p.arch === undefined && p.schemeDeck === undefined), JSON.stringify(plain.players[3]));
  // (a scheme gone back under the deck still shows as the one set in motion: its card is kept)
  const kept = lastOf((await tables([board({ schemes: [plot] }), board({ schemes: [] })]))[1]);
  same("bridge: the scheme set in motion is kept after it leaves", [kept.schemeNow?.seq, kept.schemeNow?.card?.id, kept.schemes], [1, plot.id, undefined]);

  // the table, fed the bridge's boards in order
  const feed = (msgs) => { for (const m of msgs) q(m.t === "texts" ? "local json = ... takeTexts(json) return nil" : "local json = ... takeBoard(json) return nil", JSON.stringify(m)); };
  feed(first);
  let d = draw(lastM_(first)).split("\n");
  same("table: the scheme set in motion, large, by the archenemy's seat", d[0], "schemenow|A Display of My Dark Power|Blue|0.00,2.40,8.40|0|nil");
  same("table: the scheme deck beside it, with ARCHENEMY and the count", d[1], "schemedeck|Scheme deck|Blue|4.60,2.40,8.40|0|ARCHENEMY/17 SCHEMES");
  ok("table: the scheme's text in its hover", /something happens/.test(q("return tostring(placed[1].tx)") || ""), q("return tostring(placed[1].tx)"));
  feed(second);
  d = draw(lastM_(second)).split("\n");
  same("table: the newest set in motion takes the large spot, the other goes in the row", d.slice(0, 2), ["schemenow|Nothing Can Stop Me Now|Blue|0.00,2.40,8.40|0|nil", "scheme|A Display of My Dark Power|Blue|-4.40,2.40,8.40|0|nil"]);
  feed(fourth);
  d = draw(lastM_(fourth)).split("\n");
  same("table: the row in order, the deck's count down", d, ["schemenow|Behold the Power of Destruction|Blue|0.00,2.40,8.40|0|nil", "scheme|Nothing Can Stop Me Now|Blue|-4.40,2.40,8.40|0|nil", "schemedeck|Scheme deck|Blue|4.60,2.40,8.40|0|ARCHENEMY/14 SCHEMES"]);
  same("table: one scheme left says SCHEME", q('local c = engineSchemeDeckCard({ players = { { color = "Blue", schemeDeck = 1 } } }, "Blue") return c.dg .. "|" .. c.id'), "ARCHENEMY\n1 SCHEME|schemedeck:Blue");
  same("table: the archenemy from the row's arch", q('return engineArchColor({ players = { { color = "White" }, { color = "Blue", arch = true } } })'), "Blue");
  same("table: else from the board's teams", q('return engineArchColor({ players = { { color = "White" } }, teams = { archenemy = "White" } })'), "White");
  same("table: no archenemy, nothing drawn", q('return drawn({ players = { { color = "White" } }, schemes = { { id = "x", n = "y" } } })'), "");
  // the six-seat table (White's playmat at x 27.3, z -14.9, the profile's; its life tracker at x 41.8): in front of
  // White's own seat, the row toward the table's centre line, the deck on the outer side
  const six = q(`ENGINE_TABLE_SEATS = { "White", "Red", "Yellow", "Green", "Blue", "Purple" }
    local saved = GEO.White
    GEO.White = { mat = Vector(27.333, 1, -14.87), right = Vector(1, 0, 0), rotY = 180 }
    local out = drawn({ players = { { color = "White", arch = true, schemeDeck = 15 } }, schemeNow = { card = { id = "n", n = "Now" } },
      schemes = { { id = "n", n = "Now" }, { id = "o1", n = "Ongoing 1" }, { id = "o2", n = "Ongoing 2" }, { id = "o3", n = "Ongoing 3" }, { id = "o4", n = "Ongoing 4" } } })
    GEO.White = saved ENGINE_TABLE_SEATS = nil
    return out`).split("\n");
  same("six seats: the scheme set in motion in front of the archenemy's own seat (the mat's x), toward the middle strip", six[0], "schemenow|Now|White|27.33,2.40,-6.25|180|nil");
  same("six seats: the ongoing row toward the table's centre line", six.slice(1, 5).map((l) => l.split("|")[3]), ["22.93,2.40,-6.25", "19.53,2.40,-6.25", "16.13,2.40,-6.25", "12.73,2.40,-6.25"]);
  same("six seats: the deck on the outer side", six[5], "schemedeck|Scheme deck|White|31.93,2.40,-6.25|180|ARCHENEMY/15 SCHEMES");
  const xs = six.map((l) => Number(l.split("|")[3].split(",")[0])), zs = six.map((l) => Number(l.split("|")[3].split(",")[2]));
  const half = (1.4 * 2.25) / 2, deep = (1.4 * 3.15) / 2;
  ok("six seats: every scheme clear of the corner's life tracker column (x 41.8)", Math.max(...xs) + half < 41.77 - 1.5, `to x ${Math.max(...xs) + half}`);
  ok("six seats: clear of a plane at the centre and of the stack over the mat (z -14.9)", Math.min(...zs.map(Math.abs)) - deep > 1.5 * 2.25 / 2 + 0.5 && 14.87 - 3.1 / 2 - (Math.max(...zs.map(Math.abs)) + deep) > 0.5, zs.join(","));
  same("table: turned to read from the archenemy's seat", q('return drawn({ players = { { color = "White", arch = true, schemeDeck = 3 } } })'), "schemedeck|Scheme deck|White|-4.60,2.40,-8.40|180|ARCHENEMY/3 SCHEMES");

  same("table: a rules text that arrives after its board reaches the schemes", q('lastTable = { players = {}, schemes = { { id = "x", n = "S" } }, schemeNow = { card = { id = "y", n = "T" } } } engineOnTexts({ texts = { x = "one", y = "two" } }) return lastTable.schemes[1].tx .. "|" .. lastTable.schemeNow.card.tx'), "one|two");

  // the banner
  q("engineSchemeSeen = nil ui = {} return nil");
  same("banner: SET IN MOTION, gold, on every seated player's screen", banner(m1), "SET IN MOTION: A DISPLAY OF MY DARK POWER|true|#FFD27A");
  q("ui = {} return nil");
  same("banner: once per scheme", banner(m1), "nil|nil|nil");
  q("ui = {} return nil");
  same("banner: the next scheme", banner(m2), "SET IN MOTION: NOTHING CAN STOP ME NOW|true|#FFD27A");
  same("banner: put away after 4 s", q("timers[#timers]() return tostring(ui['eng_banner_Blue.active'])"), "false");
  q("ui = {} return nil");
  same("banner: none on a jump board, only noted", banner({ ...m4, jump: true }) + "|" + q("return tostring(engineSchemeSeen)"), "nil|nil|nil|3");

  // the setup button
  q("ENGINE_ARCH_SETUP = nil chats = {} return nil");
  same("button: its label, off", q("return engineArchLabel()"), "Archenemy\nOff");
  const presses = [];
  for (let i = 0; i < 5; i++) { q("onMtgSetupArch(nil, 'White') return nil"); presses.push(q("local c = chats[#chats] engineArchNoted(c:sub(#'White: mtg archenemy ' + 1)) return c")); }
  same("button: off, each seat in turn, then off", presses, ["White: mtg archenemy White", "White: mtg archenemy Red", "White: mtg archenemy Yellow", "White: mtg archenemy Blue", "White: mtg archenemy off"]);
  q("engineArchNoted('red') return nil");
  same("button: mtg archenemy red sets its label", q("return engineArchLabel()"), "Archenemy\nRed");
  q("engineArchNoted('Purple') return nil");
  same("button: a colour it doesn't know leaves it", q("return engineArchLabel()"), "Archenemy\nRed");
  q("engineArchNoted('off') return nil");
  same("button: off", q("return engineArchLabel()"), "Archenemy\nOff");
  // the six-seat table: the button goes round its six seats in turn order (the profile's seats), then off
  q('ENGINE_TABLE_SEATS = { "White", "Red", "Yellow", "Green", "Blue", "Purple" } ENGINE_ARCH_SETUP = nil chats = {} return nil');
  const presses6 = [];
  for (let i = 0; i < 7; i++) { q("onMtgSetupArch(nil, 'White') return nil"); presses6.push(q("local c = chats[#chats] engineArchNoted(c:sub(#'White: mtg archenemy ' + 1)) return c")); }
  same("six seats: the button goes round the six seats, then off", presses6, ["White: mtg archenemy White", "White: mtg archenemy Red", "White: mtg archenemy Yellow", "White: mtg archenemy Green", "White: mtg archenemy Blue", "White: mtg archenemy Purple", "White: mtg archenemy off"]);
  q("engineArchNoted('purple') return nil");
  same("six seats: mtg archenemy purple sets its label", q("return engineArchLabel()"), "Archenemy\nPurple");
  q('ENGINE_TABLE_SEATS = nil engineArchNoted("Purple") return nil');
  same("four seats: Purple isn't a seat there, the label stays", q("return engineArchLabel()"), "Archenemy\nPurple");
  q('ENGINE_ARCH_SETUP = nil engineArchNoted("Green") return nil');
  same("four seats: Green isn't a seat there either", q("return engineArchLabel()"), "Archenemy\nOff");
  const setup = SRC.slice(SRC.indexOf("\nfunction engineSetupButtons("), SRC.indexOf("\nfunction engineScoopRedraw("));
  ok("button: drawn on the setup tile beside Teams, on either table", /if engineArchLabel ~= nil then\n\s+SETUP\.drawn\.arch = true\n\s+setupButton\(tile, "onMtgSetupArch", engineArchLabel\(\), SETUP\.color\.idle, ENGINE_ARCH_SPOT/.test(setup), "engineSetupButtons");
  ok("button: a change redraws the setup buttons", /engineArchLabel ~= nil and engineArchLabel\(\) or ""/.test(setup), "the setup signature");
  ok("button: counted when the tile is checked", /\(SETUP\.drawn\.arch and 1 or 0\)/.test(SRC), "engineSetupIntact");
  ok("chat: mtg archenemy sets the button too", /engineSend\("archenemy", \{ color = pl\.color, text = rest \}\)\n\s+if engineArchNoted ~= nil then engineArchNoted\(rest\) engineSetupButtons\(\) end/.test(COPY), "make-engine-copy.js");

  // the board's own path
  ok("board: the schemes' details filled in (mergeStatic)", /for _, c in ipairs\(m\.schemes or \{\}\) do engineFillStatic\(c\) end\n\s+if m\.schemeNow ~= nil then engineFillStatic\(m\.schemeNow\.card\) end/.test(SRC), "mergeStatic");
  ok("board: each board draws the schemes", /pcall\(engineSchemes, m, seen\)/.test(SRC) && /pcall\(engineSchemeBanner, m\)/.test(SRC), "engineRender");
  // the scheme shape (table-polish): scheme cards are oversized, upright; every scheme zone at that size, planes as before
  same("shape: the scheme set in motion, the ongoing row and the deck at the oversized card's size; planes 1.5; others as before",
    q('local o = {} for _, z in ipairs({ "schemenow", "scheme", "schemedeck", "plane", "battlefield", "attached", "suspended" }) do o[#o + 1] = tostring(engineZoneScale(z)) end return table.concat(o, ",")'),
    "1.4,1.4,1.4,1.5,1,0.5,0.5");
  ok("shape: a card spawned in a zone takes its size (place)", /local zs = engineZoneScale\(opts\.zone\)\n\s+if zs ~= 1 then obj\.setScale\(Vector\(zs, 1, zs\)\) end/.test(SRC), "place");
  ok("shape: a card already there is resized to its zone's size each board", /local wantScale = engineZoneScale\(meta and meta\.zone\)/.test(SRC), "the board's update");
  ok("shape: schemes are never turned as a plane is (upright, the archenemy's seat's rotation)", /local rot = Vector\(0, g\.rotY, 0\)/.test(fn("engineSchemes")) && !/rotY\) \+ 90|g\.rotY \+ 90/.test(fn("engineSchemes")), "engineSchemes");
  // (clear of each other at that size: a TTS card is about 2.2 x 3.1 at scale 1; the plane at the centre, 1.5 and turned,
  // reaches 1.7 from it along the archenemy's axis; the stack floats over the caster's own mat)
  const sz = q("return tostring(ENGINE_SCHEME.scale * 2.25) .. '|' .. tostring(ENGINE_SCHEME.scale * 3.15) .. '|' .. ENGINE_SCHEME.row .. '|' .. ENGINE_SCHEME.rowStart .. '|' .. ENGINE_SCHEME.deck .. '|' .. ENGINE_SCHEME.toward").split("|").map(Number);
  const [w, h, row, rowStart, deckAt, toward] = sz;
  ok("shape: the row's schemes keep a gap at that size", row - w > 0.2, `row ${row}, card ${w}`);
  ok("shape: the row and the deck stay clear of the scheme set in motion", rowStart - w > 0.5 && Math.abs(deckAt) - w > 0.5, `rowStart ${rowStart}, deck ${deckAt}, card ${w}`);
  ok("shape: clear of a plane at the centre (a mat 20 from it)", toward * 20 - h / 2 > 1.5 * 2.25 / 2 + 0.5, `scheme from ${toward * 20 - h / 2}, plane to ${1.5 * 2.25 / 2}`);
  ok("shape: clear of the stack over the archenemy's own mat", 20 - (toward * 20 + h / 2) > 3.1 / 2 + 0.5, `scheme to ${toward * 20 + h / 2}, the stack from ${20 - 3.1 / 2}`);
  ok("board: a new game's schemes count from 1 again", /engineSchemeSeen = nil -- \(and its schemes set in motion\)/.test(SRC), "the reset");

  console.log(`${failed ? "FAIL" : "PASS"} test_table_archenemy_view: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_table_archenemy_view: ${e.stack}`); process.exit(1); });
