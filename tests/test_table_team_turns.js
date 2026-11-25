// The Team turns button and Three-Headed Giant's shared turns on the table (docs/game-modes-spec.md §5.12, §8.4;
// tools/engine-renderer.lua engineTeamChat's "mtg 2hg|3hg turns shared|own", engineTeamTurnsMode, engineTeamTurnsSent,
// engineTeamTurnsLabel, engineTeamTurnsSpot, onMtgSetupTeamTurns, engineSetupButtons; make-engine-copy.js's concede):
//   1. the team code alone on fengari: the setting for 2HG and 3HG, the button's click (exactly the chat command), its
//      label, what Start sends, and the modes without the option (2v2, Juggernaut, free-for-all);
//   2. the 4-player table on the fake TTS: the button on the setup tile beside Teams, host only, shown in 2HG only,
//      hidden during a game;
//   3. the six-seat table (built from the Workshop file when it is there): the button in 3HG, inside the cleared west
//      strip and clear of the other west-strip buttons and Green's column; a 3HG concede says "You are all out".
//   node tests/test_table_team_turns.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { simulate } = require("./lua/run-sim"); // (before fengari: run-sim patches it the way MoonSharp matches)
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");
const { buildSave } = require("./golden/table-run");

const ROOT = path.join(__dirname, "..");
const RENDERER = fs.readFileSync(path.join(ROOT, "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── 1. the team code on fengari ──
const from = RENDERER.indexOf("\nENGINE_TEAMS = nil");
const to = RENDERER.indexOf("\n-- The Archenemy button beside it");
if (from < 0 || to < 0) { console.log("FAIL test_table_team_turns: the renderer's team code moved (ENGINE_TEAMS = nil / the Archenemy button)"); process.exit(1); }
const STUBS = `
TABLE_PROFILE = { spots = { teams = { -47, 1.1, 17.5 } } }
function Vector(x, y, z) return { x = x, y = y, z = z } end
ENGINE_GAME_MODE = "commander"
ENGINE_TABLE_SEATS = nil
said = {}
function broadcastToAll(t) said[#said + 1] = "all: " .. t end
function engineNameOf(c) return c end
redraws = 0
function engineSetupButtons() redraws = redraws + 1 end
function engineSend() end
engineReadyState = {}
host = { color = "Blue", steam_name = "Host", broadcast = function(t) said[#said + 1] = "host: " .. t end }
guest = { color = "Yellow", steam_name = "Guest", broadcast = function(t) said[#said + 1] = "guest: " .. t end }
Player = { Blue = host, Yellow = guest }
typed = {}
function engineChat(text, pl)
  typed[#typed + 1] = pl.color .. ": " .. text
  local cmd, rest = text:match("^mtg%s+(%a*)%s*(.-)%s*$")
  return engineTeamChat(cmd or "", rest or "", pl, pl == host)
end
function lastSaid() return said[#said] or "" end
function lastTyped() return typed[#typed] or "" end
`;
function freshLua() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const code = STUBS + RENDERER.slice(from, to);
  if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) throw new Error(`the team code doesn't load: ${lua.lua_tojsstring(L, -1)}`);
  return (expr) => {
    if (lauxlib.luaL_loadstring(L, to_luastring(`return ${expr}`)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
    const v = lua.lua_isnil(L, -1) ? null : lua.lua_tojsstring(L, -1);
    lua.lua_pop(L, 1);
    return v;
  };
}
const SIX = '{ "White", "Red", "Yellow", "Green", "Blue", "Purple" }';
{
  let q = freshLua();
  ok("logic: free-for-all has no team turns option", q("tostring(engineTeamTurnsMode())") === "false");
  same("logic: the label starts at Own", q("engineTeamTurnsLabel()"), "Team turns\nOwn");
  q('engineChat("mtg mode 2hg", host)');
  ok("logic: Two-Headed Giant has the option", q("tostring(engineTeamTurnsMode())") === "true");
  q('onMtgSetupTeamTurns(nil, "Blue")');
  same("click (2HG, own): exactly  mtg 2hg turns shared", q("lastTyped()"), "Blue: mtg 2hg turns shared");
  ok("click (2HG, own): one turn for each team, said to everyone", q("ENGINE_TEAM_TURNS") === "shared" && /^all: \[MTG\] Host set Two-Headed Giant to one turn for each team/.test(q("lastSaid()")), q("lastSaid()"));
  same("click: the label says Shared", q("engineTeamTurnsLabel()"), "Team turns\nShared");
  same("click: Start sends teamTurns shared with 2HG", q("engineTeamTurnsSent()"), "shared");
  q('onMtgSetupTeamTurns(nil, "Blue")');
  same("click (2HG, shared): exactly  mtg 2hg turns own", q("lastTyped()"), "Blue: mtg 2hg turns own");
  ok("click (2HG, shared): back to own turns", q("ENGINE_TEAM_TURNS") === null && q("engineTeamTurnsLabel()") === "Team turns\nOwn" && q("engineTeamTurnsSent()") === null, q("lastSaid()"));
  q('onMtgSetupTeamTurns(nil, "Yellow")');
  ok("click: not the host, refused, nothing changes", q("ENGINE_TEAM_TURNS") === null && /^guest: \[MTG\] Only the host/.test(q("lastSaid()")), q("lastSaid()"));
  q('onMtgSetupTeamTurns(nil, "Nobody")');
  same("click: an unknown colour does nothing", q("lastTyped()"), "Yellow: mtg 2hg turns shared");
  q('engineChat("mtg 2hg turns shared", host)');
  q('engineChat("mtg mode juggernaut", host)');
  ok("logic: Juggernaut has no option and sends no team turns", q("tostring(engineTeamTurnsMode())") === "false" && q("engineTeamTurnsSent()") === null);
  q('(function() ENGINE_GAME_MODE = "standard" end)()');
  q('engineChat("mtg mode 2v2", host)');
  same("logic: precondition, 2v2 set", q("ENGINE_TEAM_MODE"), "2v2");
  ok("logic: 2v2 has no option and sends no team turns", q("tostring(engineTeamTurnsMode())") === "false" && q("engineTeamTurnsSent()") === null);
  // (the spot: 4 further out than Teams on its strip, or the profile's own)
  same("spot: 4 out from Teams on the west strip", q('(function() local v = engineTeamTurnsSpot() return v.x .. "," .. v.y .. "," .. v.z end)()'), "-51,1.1,17.5");
  same("spot: the profile's teamTurns when it names one", q('(function() TABLE_PROFILE.spots.teamTurns = { -50, 1.2, 20 } local v = engineTeamTurnsSpot() TABLE_PROFILE.spots.teamTurns = nil return v.x .. "," .. v.y .. "," .. v.z end)()'), "-50,1.2,20");

  // Three-Headed Giant
  q = freshLua();
  q(`(function() ENGINE_TABLE_SEATS = ${SIX} end)()`);
  q('engineChat("mtg mode 3hg", host)');
  ok("3HG: the option is offered", q("tostring(engineTeamTurnsMode())") === "true");
  ok("3HG: the mode's help says how to share turns", /mtg 3hg turns shared/.test(q("lastSaid()")), q("lastSaid()"));
  q('onMtgSetupTeamTurns(nil, "Blue")');
  same("click (3HG): exactly  mtg 3hg turns shared", q("lastTyped()"), "Blue: mtg 3hg turns shared");
  ok("click (3HG): said with Three-Headed Giant's name", q("ENGINE_TEAM_TURNS") === "shared" && /^all: \[MTG\] Host set Three-Headed Giant to one turn for each team: partners take their turn together, attack together and block together\.$/.test(q("lastSaid()")), q("lastSaid()"));
  same("3HG: Start sends teamTurns shared (no longer ignored)", q("engineTeamTurnsSent()"), "shared");
  same("3HG: the Teams button says 3HG team turns", q("engineTeamsLabel()"), "Teams\n3HG team turns");
  q('engineChat("mtg 3hg turns", host)');
  ok("3HG: mtg 3hg turns says the setting and how", /^host: \[MTG\] Three-Headed Giant turns: one turn for each team\. Use:  mtg 3hg turns shared/.test(q("lastSaid()")), q("lastSaid()"));
  q('engineChat("mtg 2hg turns own", host)');
  ok("3HG: the one setting, typed as 2hg too, named by the mode set", q("ENGINE_TEAM_TURNS") === null && /^all: \[MTG\] Host set Three-Headed Giant to each player's own turn/.test(q("lastSaid()")), q("lastSaid()"));
  q('engineChat("mtg mode ffa", host)');
  q('engineChat("mtg 3hg turns shared", host)');
  ok("3HG: set before the mode, with a note how to play it", q("ENGINE_TEAM_TURNS") === "shared" && /\(for Three-Headed Giant games:  mtg mode 3hg, on the six-seat table\)$/.test(q("lastSaid()")) && q("engineTeamTurnsSent()") === null, q("lastSaid()"));
  q('engineChat("mtg 3hg turns sideways", host)');
  ok("3HG: a bad word says how, changes nothing", q("ENGINE_TEAM_TURNS") === "shared" && /Use:  mtg 3hg turns shared/.test(q("lastSaid()")), q("lastSaid()"));
}

// ── 2. the 4-player table on the fake TTS ──
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => r.steps.find((s) => s.step === mark)?.value;
const fxOf = (r, mark) => r.steps.find((s) => s.step === mark)?.fx || [];
const chats = (r, mark) => fxOf(r, mark).filter((l) => /broadcast/.test(l)).join(" | ");
const TILE = 'local tile for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then tile = o end end ';
const BTN = TILE + 'local out = "none" for _, b in ipairs((tile and tile.getButtons()) or {}) do if b.click_function == "onMtgSetupTeamTurns" then ' +
  'local p, r = b.position or {}, b.rotation or {} local w = tile.positionToLocal(engineTeamTurnsSpot()) ' +
  'out = b.label:gsub("\\n", "/") .. "|" .. b.width .. "x" .. b.height .. "@" .. tostring(r.y or r[2]) .. "|" .. string.format("%.2f,%.2f", (p.x or p[1]) + w.x, (p.z or p[3]) - w.z) end end return out';
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" },
  names: { "player-0": "AI 1", "player-1": "AI 2", "player-2": "Yellow", "player-3": "Blue" }, ai: ["White", "Red"] });
function board4() {
  const pl = (color, slot) => ({ color, slot, name: color, ai: color === "White" || color === "Red", life: 80, status: "playing", pool: {},
    cmdDamage: {}, tax: [], library: 50, handCount: 0, hand: [], battlefield: [], graveyard: [], exile: [], command: [] });
  return JSON.stringify({ t: "table", turn: 2, step: "main1", active: "White", activeTurnNo: 1, priority: "White", gameOver: false, winner: null,
    players: [pl("White", "player-0"), pl("Red", "player-1"), pl("Yellow", "player-2"), pl("Blue", "player-3")], stack: [], cards: {},
    teams: { poison: 15, sides: [["White", "Red"], ["Yellow", "Blue"]] } });
}
{
  const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
  const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [
    q('setEngineMode(true) return "on"', "on", 30),
    q(BTN, "ffa"),
    q('engineChat("mtg mode 2hg", Player.Blue) return "2hg"', "2hg", 5), q(BTN, "2hg button"),
    q('onMtgSetupTeamTurns(nil, "Blue") return tostring(ENGINE_TEAM_TURNS)', "host click", 5), q(BTN, "after host click"),
    q('onMtgSetupTeamTurns(nil, "Yellow") return tostring(ENGINE_TEAM_TURNS)', "guest click", 5), q(BTN, "after guest click"),
    q('engineChat("mtg mode juggernaut", Player.Blue) return "jugg"', "jugg", 5), q(BTN, "jugg button"),
    q('engineChat("mtg mode commander", Player.Blue) engineChat("mtg mode 2hg", Player.Blue) return "2hg again"', "2hg again", 5), q(BTN, "2hg again button"),
    q('engineAutoPace.Yellow = false engineAutoPace.Blue = false engineChat("mtg start ai 2", Player.Blue) return "start"', "start", 10),
    { msg: { t: "started", json: STARTED } },
    { msg: { t: "table", json: board4() }, frames: 60 },
    q(BTN, "in game"),
  ] });
  ok("4-player: no errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  same("4-player: no Team turns button in free-for-all", valueOf(r, "ffa"), "none");
  const b = String(valueOf(r, "2hg button")).split("|");
  same("4-player: in 2HG the button on the setup tile, label Own, a quarter turned, 1700 x 620", b.slice(0, 2), ["Team turns/Own", "1700x620@90"]);
  same("4-player: drawn at its spot, x mirrored as every tile button", b[2], "0.00,0.00");
  same("4-player: the host's click shares the turns, the label follows", [valueOf(r, "host click"), String(valueOf(r, "after host click")).split("|")[0]], ["shared", "Team turns/Shared"]);
  ok("4-player: the host's click is said to everyone", /set Two-Headed Giant to one turn for each team/.test(chats(r, "host click")), chats(r, "host click"));
  ok("4-player: another player's click is refused", valueOf(r, "guest click") === "shared" && /Only the host/.test(chats(r, "guest click")) && String(valueOf(r, "after guest click")).startsWith("Team turns/Shared|"), chats(r, "guest click"));
  same("4-player: hidden in Juggernaut", valueOf(r, "jugg button"), "none");
  ok("4-player: back in 2HG it shows the kept setting", String(valueOf(r, "2hg again button")).startsWith("Team turns/Shared|"), String(valueOf(r, "2hg again button")));
  same("4-player: hidden during a game", valueOf(r, "in game"), "none");
}

// ── 3. the six-seat table (built from the Workshop file, read only) ──
const WS = process.env.MTG_WORKSHOP_DIR || path.join(process.env.USERPROFILE || process.env.HOME || "", "Documents", "My Games", "Tabletop Simulator", "Mods", "Workshop");
const FOUR = path.join(WS, "2296042369.json"), SIXF = path.join(WS, "2293586471.json");
if (fs.existsSync(FOUR) && fs.existsSync(SIXF)) {
  const tp = require(path.join(ROOT, "tools", "table-profile.js"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-turns-"));
  try {
    const out = path.join(tmp, "six.json");
    const b6 = spawnSync(process.execPath, [path.join(ROOT, "tools", "make-engine-copy.js"), SIXF, out, "--profile", tp.profilePath("2293586471"), "--tracker-source", FOUR], { encoding: "utf8", maxBuffer: 1 << 26 });
    ok("six-seat: the table builds", b6.status === 0, (b6.stdout || "").split("\n").filter((l) => /^FAIL/.test(l)).join(" | ") || b6.stderr);
    const six = b6.status === 0 ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
    if (six) {
      const SEATS = ["White", "Red", "Yellow", "Green", "Blue", "Purple"];
      const players = SEATS.map((color, i) => ({ color, slot: `player-${i}`, name: color, ai: false, life: 120, status: "playing", pool: {}, cmdDamage: {}, tax: [], library: 50, handCount: 0, hand: [], battlefield: [], graveyard: [], exile: [], command: [] }));
      const board = JSON.stringify({ t: "table", turn: 2, step: "main1", active: "White", activeTurnNo: 1, priority: "White", gameOver: false, winner: null, players, stack: [], cards: {},
        teams: { poison: 20, sides: [["White", "Red", "Yellow"], ["Green", "Blue", "Purple"]] } });
      const started = JSON.stringify({ t: "started", colors: Object.fromEntries(players.map((p) => [p.slot, p.color])), names: Object.fromEntries(players.map((p) => [p.slot, p.color])), ai: [] });
      const SPOTS = 'local out = {} local function s(k, v) out[#out + 1] = k .. "=" .. v.x .. "," .. v.z end s("teams", TEAMS_SPOT) s("arch", ENGINE_ARCH_SPOT) s("friendly", FRIENDLY_SPOT) s("mode", MODE_SPOT) s("turns", engineTeamTurnsSpot()) return table.concat(out, ";")';
      const r = simulate({ save: six, seated: SEATS, host: "White", steps: [
        q('engineChat("mtg engine on", Player.White) return "on"', "on", 150),
        q('engineChat("mtg mode 3hg", Player.White) return tostring(ENGINE_TEAM_MODE)', "3hg", 10), q(BTN, "3hg button"), q(SPOTS, "spots"),
        q('onMtgSetupTeamTurns(nil, "White") return tostring(ENGINE_TEAM_TURNS) .. " " .. tostring(engineTeamTurnsSent())', "click", 5), q(BTN, "after click"),
        q('engineAutoPace = engineAutoPace or {} return "x"', "x"),
        { msg: { t: "started", json: started } },
        { msg: { t: "table", json: board }, frames: 60 },
        q(BTN, "in game"),
        q('engineConcedeAsk = nil engineChat("mtg concede", Player.Green) return "asked"', "concede"),
      ] });
      ok("six-seat: no errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
      const b = String(valueOf(r, "3hg button")).split("|");
      same("six-seat: in 3HG the button on the setup tile, label Own, a quarter turned, 1700 x 620, at its spot", [b[0], b[1], b[2]], ["Team turns/Own", "1700x620@90", "0.00,0.00"]);
      same("six-seat: the click sets 3HG's shared turns, sent with Start", valueOf(r, "click"), "shared shared");
      ok("six-seat: the click is said with Three-Headed Giant's name", /set Three-Headed Giant to one turn for each team/.test(chats(r, "click")), chats(r, "click"));
      ok("six-seat: the label follows", String(valueOf(r, "after click")).startsWith("Team turns/Shared|"), String(valueOf(r, "after click")));
      same("six-seat: hidden during a game", valueOf(r, "in game"), "none");
      ok("six-seat: a 3HG concede is for all three", /Concede for your team \(PlayerGreen \+ PlayerBlue \+ PlayerPurple\)\? You are all out for good\./.test(chats(r, "concede")), chats(r, "concede"));
      // (a quarter-turned 1700 x 620 button: its width along z, its height along x; world size = units x SETUP.size (2.5) / 480)
      const spots = Object.fromEntries(String(valueOf(r, "spots")).split(";").map((l) => { const [k, v] = l.split("="); return [k, v.split(",").map(Number)]; }));
      const boxOf = ([x, z]) => [x - (620 * 2.5) / 960, x + (620 * 2.5) / 960, z - (1700 * 2.5) / 960, z + (1700 * 2.5) / 960];
      const meets = (a, c) => a[0] < c[1] && c[0] < a[1] && a[2] < c[3] && c[2] < a[3];
      const tb = boxOf(spots.turns || [0, 0]);
      ok("six-seat: the button lies in the cleared west strip (x -56..-45, z -8.5..33)", tb[0] >= -56 && tb[1] <= -45 && tb[2] >= -8.5 && tb[3] <= 33, JSON.stringify(tb));
      const clash = ["teams", "arch", "friendly", "mode"].filter((k) => spots[k] && meets(tb, boxOf(spots[k])));
      ok("six-seat: clear of the other west-strip buttons", clash.length === 0, clash.join(" "));
      const green = ["0c1b22", "206ce5", "2fa3e2", "c04462", "8fb941"].map((g) => six.ObjectStates.find((o) => o.GUID === g)).filter(Boolean);
      const hit = green.filter((o) => meets(tb, [o.Transform.posX - 1.6, o.Transform.posX + 1.6, o.Transform.posZ - 1.6, o.Transform.posZ + 1.6])).map((o) => o.GUID);
      ok("six-seat: clear of Green's column", green.length === 5 && hit.length === 0, `${green.length} found; hit ${hit.join(" ")}`);
      // (the 4-player table's spot: x -51, inside its cleared strip x -56..-44)
      const t4 = boxOf([-51, 17.5]);
      ok("4-player: the button's spot lies in its cleared west strip (x -56..-44, z -8.5..32)", t4[0] >= -56 && t4[1] <= -44 && t4[2] >= -8.5 && t4[3] <= 32, JSON.stringify(t4));
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
} else {
  console.log(`(six-seat part skipped: the Workshop tables aren't in ${WS})`);
}

console.log(`${failed ? "FAIL" : "PASS"} test_table_team_turns: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
