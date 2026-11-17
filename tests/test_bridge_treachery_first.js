// Treachery's Leader goes first (PLAN.md M4.6; docs/game-modes-spec.md; the engine's gameConfig.firstPlayer,
// docs/handoff/first-player-report.md): the table's start message says who holds the Leader identity card
// (engine-renderer.lua engineTreacheryLeader: the TTS names of Treachery identity cards carry their role, "Identity —
// Leader"), and the bridge sends the engine that seat as gameConfig.firstPlayer, unless the table already chose a first
// player (the start's firstPlayer) or a team mode names one (goesFirst), or the host turned it off (mtg treachery off).
// Also the table's search for the Leader's card, on fengari with stand-ins for TTS. No TTS save needed.
//   node tests/test_bridge_treachery_first.js
const fs = require("fs");
const path = require("path");
const harness = require("./bridge-harness");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);

// the table's start, then the room ready: what the bridge sends the engine (the gameConfig, and StartGame's seat order)
async function start(h, msg, chatFirst = []) {
  for (const text of chatFirst) { h.B.onTTS({ t: "treachery", color: "Blue", text }); await h.flush(); }
  h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, ...msg }) });
  await h.flush();
  const g = h.B._getGame();
  const blue = g.seats.get("Blue");
  blue.heartbeat = () => {};
  blue.ws.emit("open");
  const frame = (m) => blue.ws.emit("message", JSON.stringify(m));
  frame({ type: "AuthResult", success: true });
  frame({ type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
  const bots = ["Forge AI", "Forge AI 2", "Forge AI 3"].map((u) => ({ username: u, ready: true, connected: true, is_bot: true }));
  frame({ type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 4, players: [{ username: blue.username, ready: true, connected: true }, ...bots] } });
  await h.flush();
  const relays = h.effects.map((e) => e.relay).filter(Boolean);
  const cfg = relays.find((r) => r.state?.payload?.type === "gameConfig")?.state.payload || null;
  const startGame = relays.find((r) => r.type === "StartGame") || null;
  return { cfg, order: startGame?.seat_order || [], colors: g.seatColors || [], g };
}
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };

(async () => {
  // ── the bridge ──
  await run(async (h) => {
    const r = await start(h, { treachery: { leader: "Yellow" } });
    ok("leader: a gameConfig goes before StartGame", r.cfg != null && r.order.length === 4, JSON.stringify(r.cfg));
    same("leader: firstPlayer is the Leader's seat", r.cfg?.firstPlayer, r.colors.indexOf("Yellow"));
    ok("leader: the seat order holds the Leader there", r.colors.indexOf("Yellow") >= 0, JSON.stringify(r.colors));
    ok("leader: no team rules with it", r.cfg && r.cfg.teamRules === undefined && Array.isArray(r.cfg.players) && r.cfg.players.length === 0, JSON.stringify(r.cfg));
    ok("leader: said in chat", chats(h).some((c) => /^\[MTG\] Treachery: Yellow is the Leader and goes first\./.test(c)), chats(h).join(" | "));
  });
  await run(async (h) => {
    const r = await start(h, { treachery: { leader: "Yellow" } });
    r.g.seatColors = ["Blue", "White"];
    const n = h.effects.length;
    same("a Leader at no seat of this game: no gameConfig", h.B._startConfig(), null);
    await h.flush();
    ok("a Leader at no seat: said", chats(h, n).some((c) => /Yellow is not a seat in this game/.test(c)), chats(h, n).join(" | "));
  });
  await run(async (h) => {
    const r = await start(h, {});
    same("no Treachery: no gameConfig, as before", r.cfg, null);
  });
  await run(async (h) => {
    const r = await start(h, { treachery: {} });
    same("Treachery with no Leader found: no first player", r.cfg, null);
    ok("Treachery with no Leader found: said", chats(h).some((c) => /Treachery: no Leader identity card was found/.test(c)), chats(h).join(" | "));
  });
  await run(async (h) => {
    const r = await start(h, { treachery: { leader: "Yellow" }, firstPlayer: "Red" });
    same("the table's own first player wins over the Leader", r.cfg?.firstPlayer, r.colors.indexOf("Red"));
  });
  await run(async (h) => {
    const r = await start(h, { treachery: { leader: "Yellow" } }, ["off"]);
    same("mtg treachery off: the Leader isn't sent", r.cfg, null);
  });
  await run(async (h) => {
    const r = await start(h, { treachery: { leader: "Yellow" } }, ["off", "on"]);
    same("mtg treachery on again: the Leader is sent", r.cfg?.firstPlayer, r.colors.indexOf("Yellow"));
  });
  await run(async (h) => {
    const r = await start(h, { treachery: { leader: "Yellow" } }, ["leader red"]);
    same("mtg treachery leader red: the host's Leader", r.cfg?.firstPlayer, r.colors.indexOf("Red"));
  });
  await run(async (h) => {
    // (a team mode that names its own first player: the Juggernaut's goesFirst; the Leader isn't added)
    const r = await start(h, { treachery: { leader: "Yellow" }, teamMode: "juggernaut", juggernaut: { color: "White" }, teams: { White: 1, Red: 2, Yellow: 2, Blue: 2 } });
    ok("a team mode with goesFirst keeps it, no firstPlayer", r.cfg && r.cfg.firstPlayer === undefined && r.cfg.players.some((p) => p.goesFirst), JSON.stringify(r.cfg));
  });
  await run(async (h) => {
    h.B.onTTS({ t: "treachery", color: "Blue", text: "" });
    await h.flush();
    ok("mtg treachery: says the setting", chats(h).some((c) => /^\[MTG\] Treachery: the Leader goes first \(from the table's identity cards\)/.test(c)), chats(h).join(" | "));
    h.B.onTTS({ t: "treachery", color: "Blue", text: "leader purple" });
    await h.flush();
    ok("mtg treachery leader <not a seat>: how to use it", chats(h).some((c) => /Use:  mtg treachery on/.test(c)), chats(h).join(" | "));
  });

  // ── the table: the Leader's identity card, by its name ──
  const SRC = fs.readFileSync(path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
  const COPY = fs.readFileSync(path.join(__dirname, "..", "tools", "make-engine-copy.js"), "utf8").replace(/\r\n/g, "\n");
  const fn = (name) => {
    const a = SRC.indexOf(`\nfunction ${name}(`);
    const b = a < 0 ? -1 : SRC.indexOf("\nend\n", a);
    if (a < 0 || b < 0) return `error("${name} is gone from engine-renderer.lua")`;
    return SRC.slice(a, b + 5);
  };
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const code = `
    local vmt = {}
    function Vector(x, y, z) return { x = x, y = y, z = z } end
    function obj(name, x, z, hand) return { type = "Card", getName = function() return name end, getPosition = function() return Vector(x, 1, z) end, hand = hand } end
    objects = {}
    function getObjects() return objects end
    mats = { White = Vector(0, 1, -20), Red = Vector(-20, 1, 0), Yellow = Vector(0, 1, 20), Blue = Vector(20, 1, 0) }
    data = {}
    for c, p in pairs(mats) do data[c] = { playmat = { getPosition = function() return p end } } end
    Player = {}
    for c in pairs(mats) do Player[c] = { getHandObjects = function() local out = {} for _, o in ipairs(objects) do if o.hand == c then out[#out + 1] = o end end return out end } end
    TABLE_PROFILE = { seats = { "White", "Red", "Yellow", "Blue" } }
    function leaderOf() local t = engineTreacheryLeader() if t == nil then return "none" end return tostring(t.leader) end
    ${["engineTreacheryLeader", "engineIdentityNote", "engineIdentitySeat", "engineHoldsCard", "engineNearerMat"].map(fn).join("\n")}
  `;
  if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    ok("table: the Leader search loads", false, lua.lua_tojsstring(L, -1));
  } else {
    const q = (src) => {
      if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
      const v = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return v;
    };
    same("table: no identity cards, no Treachery", q('objects = { obj("Grizzly Bears", 0, 0) } return leaderOf()'), "none");
    same("table: the Leader's card nearest Yellow's mat", q('objects = { obj("Identity — Assassin", 1, -18), obj("Identity — Leader: The Seer", 2, 17), obj("Identity — Traitor", -18, 1) } return leaderOf()'), "Yellow");
    same("table: the Leader's card in Red's hand", q('objects = { obj("Identity — Leader", 0, 0, "Red"), obj("Identity — Traitor", 0, 0, "Blue") } return leaderOf()'), "Red");
    same("table: identity cards but no Leader's: Treachery, no Leader", q('objects = { obj("Identity — Assassin", 1, -18), obj("Identity — Guardian", 18, 1) } return leaderOf()'), "nil");
    same("table: Identity Crisis is no identity card: no Treachery", q('objects = { obj("Identity Crisis", 0, 0), obj("Grizzly Bears", 0, 0) } return leaderOf()'), "none");
    same("table: two Leader cards at two seats: nobody is the Leader", q('objects = { obj("Identity — Leader", 0, 0, "Red"), obj("Identity — Leader", 0, 0, "Blue") } return leaderOf()'), "nil");
    same("table: two Leader cards at one seat: that seat", q('objects = { obj("Identity — Leader", 0, 0, "Red"), obj("Identity — Leader: The Seer", 0, 0, "Red") } return leaderOf()'), "Red");
    same("table: a card named Leader that isn't an identity card doesn't count", q('objects = { obj("Pack Leader", 0, 19), obj("Identity — Assassin", 1, -18) } return leaderOf()'), "nil");
  }
  ok("table: the start message carries it", /start\.treachery = engineTreacheryLeader\(\)/.test(COPY), "make-engine-copy.js engineStartGame");
  ok("table: mtg treachery reaches the bridge", /elseif cmd == "treachery" then[\s\S]{0,300}engineSend\("treachery", \{ color = pl\.color, text = rest \}\)/.test(COPY), "make-engine-copy.js engineChat");
  ok("table: plain finds only", !/engineTreacheryLeader[\s\S]{0,1500}?:find\("[^"]*[%.\[\]^$*+?-][^"]*"\)/.test(SRC.slice(SRC.indexOf("\nfunction engineTreacheryLeader("), SRC.indexOf("\nfunction engineTreacheryLeader(") + 1500)), "a pattern find");

  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_treachery_first: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_treachery_first: ${e.stack}`); process.exit(1); });
