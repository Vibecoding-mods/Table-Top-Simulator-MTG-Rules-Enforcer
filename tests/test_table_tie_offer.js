// The tie offer on the table (tools/engine-renderer.lua engineTieUpdate / engineTieDraw / engineTieWords / onMtgTie /
// engineSteamIds, the pop-up in rewindXml; tools/make-engine-copy.js "mtg tie" and "mtg accomplishments", and the
// start message's Steam IDs): the renderer's functions on fengari with stand-ins for the TTS calls, no save needed.
//   node tests/test_table_tie_offer.js
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const ROOT = path.join(__dirname, "..");
const RENDERER = fs.readFileSync(path.join(ROOT, "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
const COPY = fs.readFileSync(path.join(ROOT, "tools", "make-engine-copy.js"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const fn = (src, name) => {
  const a = src.indexOf(`\nfunction ${name}(`);
  const b = a < 0 ? -1 : src.indexOf("\nend\n", a);
  if (a < 0 || b < 0) { console.log(`FAIL test_table_tie_offer: ${name} is gone`); process.exit(1); }
  return src.slice(a, b + 5);
};
const FUNCS = ["engineTieUpdate", "engineTieDraw", "engineTieWaits", "engineTieWords", "engineSteamOf", "engineSteamIds", "onMtgTie"].map((n) => fn(RENDERER, n)).join("");
// the chat's tie and accomplishments branches, from make-engine-copy.js's engineChat
const chatFrom = COPY.indexOf('  elseif cmd == "tie" then');
const chatTo = COPY.indexOf('  elseif cmd == "glow" then', chatFrom);
const CHAT = chatFrom > 0 && chatTo > chatFrom ? COPY.slice(chatFrom, chatTo) : null;
if (!CHAT) { console.log("FAIL test_table_tie_offer: the chat's tie branch is gone"); process.exit(1); }
const STUBS = `
attrs, texts, sent = {}, {}, {}
function setAttr(id, k, v) attrs[id .. "." .. k] = v end
function setText(id, v) texts[id] = v end
function engineSend(t, m) sent[#sent + 1] = { t = t, m = m } end
engineColors = { White = true, Red = true, Blue = true }
told = {}
function mk(c, steam) return { color = c, seated = true, steam_id = steam, broadcast = function(t) told[#told + 1] = c .. ": " .. t end } end
Player = { White = mk("White", "76561190000000001"), Red = mk("Red", nil), Blue = mk("Blue", "76561190000000003") }
Player.Blue.seated = false
ENGINE_TIE_SIG = nil
function chat(cmd, rest, pl)
  if false then
${CHAT}  end
end
function lastSent() local s = sent[#sent] if s == nil then return "none" end return s.t .. " " .. tostring(s.m.color) .. " " .. tostring(s.m.accept) .. " " .. tostring(s.m.steam) end
`;
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(STUBS + FUNCS)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
  console.log(`FAIL test_table_tie_offer: the code doesn't load: ${lua.lua_tojsstring(L, -1)}`); process.exit(1);
}
const q = (src) => {
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
  const v = lua.lua_isnil(L, -1) ? null : lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  return v;
};
const attr = (id) => q(`return attrs["${id}.active"]`);
const text = (id) => q(`return texts["${id}"]`);
const PENDING = `{ id = 1, status = "pending", rounds = 0, toForce = 3, locked = { { who = "White", color = "White", why = { "can't lose the game" } } }, waiting = { "White", "Blue" }, waitingNames = { "White" } }`;

q(`engineTieUpdate(${PENDING}, false) return nil`);
same("pending: the pop-up opens for the seated players", [attr("eng_tie_White"), attr("eng_tie_Red")], ["true", "true"]);
same("pending: an empty seat's isn't drawn", attr("eng_tie_Blue"), null);
same("pending: Tie and Keep playing for a player still to answer", [attr("eng_tieyes_White"), attr("eng_tieno_White")], ["true", "true"]);
same("pending: no buttons for a player who answered", [attr("eng_tieyes_Red"), attr("eng_tieno_Red")], ["false", "false"]);
same("pending: the words, to the one asked", text("eng_tietext_White"), "White can't lose the game: the game may never end. A tie is offered.");
same("pending: the words, who it waits for", text("eng_tietext_Red"), "White can't lose the game: the game may never end. A tie is offered.\nWaiting for White...");
q(`texts = {} engineTieUpdate(${PENDING}, false) return nil`);
same("the same offer again isn't drawn again", text("eng_tietext_White"), null);
q(`engineTieUpdate({ id = 1, status = "declined", rounds = 2, toForce = 3, declinedBy = "Red", locked = { { who = "White", why = { "can't lose the game", "can't lose life" } } }, waiting = {} }, false) return nil`);
same("declined: the pop-up stays, no buttons", [attr("eng_tie_White"), attr("eng_tieyes_White"), attr("eng_tieno_White")], ["true", "false", "false"]);
same("declined: the count", text("eng_tietext_White"), "White can't lose the game and can't lose life: the game may never end.\nRed declined the tie. Rounds without progress: 2 of 3; at 3 the game is a forced tie.");
q(`engineTieUpdate({ id = 1, status = "forced", rounds = 3, toForce = 3, locked = {}, waiting = {} }, true) return nil`);
same("game over: the pop-up shuts", [attr("eng_tie_White"), attr("eng_tie_Red")], ["false", "false"]);
q(`engineTieUpdate(${PENDING}, false) engineTieUpdate(${PENDING}, true) return nil`);
same("game over: an open offer's pop-up shuts too", [attr("eng_tie_White"), attr("eng_tieyes_White")], ["false", "false"]);
q(`engineTieUpdate(${PENDING}, false) engineTieUpdate(nil, false) return nil`);
same("no offer: the pop-up shuts", attr("eng_tie_White"), "false");

q('onMtgTie(Player.White, nil, "eng_tieyes_White") return nil');
same("Tie: a tieVote yes with the Steam ID", q("return lastSent()"), "tieVote White true 76561190000000001");
q('onMtgTie(Player.White, nil, "eng_tieno_White") return nil');
same("Keep playing: a tieVote no", q("return lastSent()"), "tieVote White false 76561190000000001");
q('sent = {} onMtgTie(Player.Red, nil, "eng_tieyes_White") return nil');
same("another seat's button sends nothing", q("return lastSent()"), "none");
q('onMtgTie(Player.Red, nil, "eng_tieyes_Red") return nil');
same("no Steam ID: sent empty", q("return lastSent()"), "tieVote Red true ");
same("engineSteamIds: the seated players'", q('local t = engineSteamIds({ "White", "Red" }) return t.White .. "|" .. t.Red'), "76561190000000001|");

q('chat("tie", "yes", Player.White) return nil');
same("mtg tie yes", q("return lastSent()"), "tieVote White true 76561190000000001");
q('chat("tie", "no", Player.White) return nil');
same("mtg tie no", q("return lastSent()"), "tieVote White false 76561190000000001");
q('sent = {} chat("tie", "maybe", Player.White) return nil');
ok("mtg tie <other>: how to use it", q("return lastSent()") === "none" && /mtg tie yes/.test(q("return told[#told]") || ""), q("return told[#told]"));
q('chat("accomplishments", "", Player.White) return nil');
same("mtg accomplishments asks the bridge with the Steam ID", q('local s = sent[#sent] return s.t .. " " .. s.m.color .. " " .. s.m.steam'), "accomplishments White 76561190000000001");

// the start message carries the seated players' Steam IDs
ok("start: the Steam IDs go with the start", /start\.steam = engineSteamIds\(seats\)/.test(COPY), "make-engine-copy.js's engineStartGame");
// the pop-up's XML: in rewindXml, its buttons on onMtgTie
const xml = RENDERER.slice(RENDERER.indexOf("local function rewindXml(c)"), RENDERER.indexOf("\nend\n", RENDERER.indexOf("local function rewindXml(c)")));
ok("xml: the tie pop-up and its two buttons", /id="eng_tie_' \.\. c/.test(xml) && /id="eng_tieyes_' \.\. c \.\. '" onClick="onMtgTie"/.test(xml) && /id="eng_tieno_' \.\. c \.\. '" onClick="onMtgTie"/.test(xml), "rewindXml");
ok("board: each board update draws the tie pop-up", /pcall\(engineTieUpdate, m\.tie, m\.gameOver\)/.test(RENDERER), "the board's apply");

console.log(`${failed ? "FAIL" : "PASS"} test_table_tie_offer: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
