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
const FUNCS = ["engineTieXml", "engineTieUpdate", "engineTieDraw", "engineTieWaits", "engineTieWords", "engineSteamOf", "engineSteamIds", "onMtgTie"].map((n) => fn(RENDERER, n)).join("");
// (the seat colours list the renderer's functions walk, from its one definition)
const SEATS = /\nENGINE_SEATS = \{[^}]*\}/.exec(RENDERER);
if (!SEATS) { console.log("FAIL test_table_tie_offer: ENGINE_SEATS is gone"); process.exit(1); }
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
if (lauxlib.luaL_loadstring(L, to_luastring(STUBS + SEATS[0] + FUNCS)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
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
const vis = (id) => q(`return attrs["${id}.visibility"]`);
same("pending: the one pop-up opens, and the table's XML wants it", [attr("eng_tie"), q("return tostring(ENGINE_TIE_UI)")], ["true", "true"]);
same("pending: Tie and Keep playing, shown to the seated player still to answer (an empty seat's isn't)", [attr("eng_tieyes"), attr("eng_tieno"), vis("eng_tieyes"), vis("eng_tieno")], ["true", "true", "White", "White"]);
same("pending: the words (who it waits for too)", text("eng_tietext"), "White can't lose the game: the game may never end. A tie is offered.\nWaiting for White...");
q(`texts = {} engineTieUpdate(${PENDING}, false) return nil`);
same("the same offer again isn't drawn again", text("eng_tietext"), null);
q(`engineTieUpdate({ id = 2, status = "pending", rounds = 0, toForce = 3, locked = {}, waiting = { "White", "Red" }, waitingNames = { "White", "Red" } }, false) return nil`);
same("pending: two to answer, both see the buttons", vis("eng_tieyes"), "Red|White");
q(`engineTieUpdate({ id = 1, status = "declined", rounds = 2, toForce = 3, declinedBy = "Red", locked = { { who = "White", why = { "can't lose the game", "can't lose life" } } }, waiting = {} }, false) return nil`);
same("declined: the pop-up stays, no buttons", [attr("eng_tie"), attr("eng_tieyes"), attr("eng_tieno")], ["true", "false", "false"]);
same("declined: the count", text("eng_tietext"), "White can't lose the game and can't lose life: the game may never end.\nRed declined the tie. Rounds without progress: 2 of 3; at 3 the game is a forced tie.");
q(`engineTieUpdate({ id = 1, status = "forced", rounds = 3, toForce = 3, locked = {}, waiting = {} }, true) return nil`);
same("game over: the pop-up shuts, and leaves the XML", [attr("eng_tie"), q("return tostring(ENGINE_TIE_UI)")], ["false", "false"]);
q(`engineTieUpdate(${PENDING}, false) engineTieUpdate(${PENDING}, true) return nil`);
same("game over: an open offer's pop-up shuts too", [attr("eng_tie"), attr("eng_tieyes")], ["false", "false"]);
q(`engineTieUpdate(${PENDING}, false) engineTieUpdate(nil, false) return nil`);
same("no offer: the pop-up shuts", [attr("eng_tie"), q("return tostring(ENGINE_TIE_UI)")], ["false", "false"]);
ok("xml: the pop-up is in the XML only while an offer is open", RENDERER.includes("if ENGINE_TIE_UI then parts[#parts + 1] = engineTieXml()") && RENDERER.includes('(ENGINE_TIE_UI and "|tie" or "")'), "engineRenderPanels");

q(`engineTieUpdate(${PENDING}, false) engineTieUpdate({ id = 3, status = "pending", rounds = 0, toForce = 3, locked = {}, waiting = { "White", "Red" } }, false) return nil`);
q('onMtgTie(Player.White, nil, "eng_tieyes") return nil');
same("Tie: a tieVote yes with the Steam ID", q("return lastSent()"), "tieVote White true 76561190000000001");
q('onMtgTie(Player.White, nil, "eng_tieno") return nil');
same("Keep playing: a tieVote no", q("return lastSent()"), "tieVote White false 76561190000000001");
q('sent = {} onMtgTie(Player.Blue, nil, "eng_tieyes") return nil');
same("a seat that isn't asked sends nothing", q("return lastSent()"), "none");
q('onMtgTie(Player.Red, nil, "eng_tieyes") return nil');
same("no Steam ID: sent empty", q("return lastSent()"), "tieVote Red true ");
same("engineSteamIds: the seated players'", q('local t = engineSteamIds({ "White", "Red" }) return t.White .. "|" .. t.Red'), "76561190000000001|");

// 12 (hand test Mairsil): after a no, the pop-up that counts the rounds stayed for the rest of the game over White's
// top battlefield row and every centre question's title. It is a one-line strip under the turn bar then, and each player
// may close it for that offer (its words to their chat, "mtg tie" says them again); a question to answer is never hidden.
const at = (id, k) => q(`return attrs["${id}.${k}"]`);
const DECLINED = (id, rounds) => `{ id = ${id}, status = "declined", rounds = ${rounds}, toForce = 3, declinedBy = "Red", locked = { { who = "AI 1", why = { "can't lose the game" } } }, waiting = {} }`;
q(`attrs = {} engineTieUpdate(${PENDING}, false) return nil`);
same("12 tie: an offer to answer keeps its full pop-up, nothing to close", [at("eng_tie", "height"), at("eng_tie", "offsetXY"), at("eng_tiehide", "active")], ["146", "0 -272", "false"]);
q('told = {} onMtgTie(Player.White, nil, "eng_tiehide") return nil');
ok("12 tie: an offer to answer can't be closed", (at("eng_tie", "visibility") || "").split("|").includes("White") && q("return tostring(#told)") === "0", `${at("eng_tie", "visibility")} told ${q("return tostring(#told)")}`);
q(`engineTieUpdate(${DECLINED(4, 1)}, false) return nil`);
same("12 tie: after a no it is a one-line strip under the turn bar, with a close button", [at("eng_tie", "active"), at("eng_tie", "height"), at("eng_tie", "offsetXY"), at("eng_tietext", "fontSize"), at("eng_tiehide", "active")], ["true", "52", "0 -114", "13", "true"]);
{
  // (clear of the centre question row's title: its panel's top edge, from its XML, below the strip's bottom edge; both
  // on TTS's 1920x1080 reference screen)
  const row = /<Panel id="eng_row_' \.\. c \.\. '"[^>]*height="(\d+)" rectAlignment="MiddleCenter" offsetXY="0 (-?\d+)"/.exec(RENDERER);
  const rowTop = row ? 540 - Number(row[2]) - Number(row[1]) / 2 : NaN;
  const stripBottom = -Number(String(at("eng_tie", "offsetXY")).split(" ")[1]) + Number(at("eng_tie", "height"));
  ok("12 tie: the strip clears the centre question's title", stripBottom < rowTop, `strip ends at ${stripBottom} px, the row starts at ${rowTop} px`);
}
q('told = {} onMtgTie(Player.White, nil, "eng_tiehide") return nil');
const seen = () => (at("eng_tie", "visibility") || "").split("|");
ok("12 tie: closed by White, hidden from White only", !seen().includes("White") && seen().includes("Red") && at("eng_tie", "active") === "true", at("eng_tie", "visibility"));
ok("12 tie: the words go to White's chat on closing", /^White: \[MTG\] AI 1 can't lose the game: the game may never end\.\nRed declined the tie\..*mtg tie/s.test(q("return told[1]") || ""), q("return told[1]"));
q(`engineTieUpdate(${DECLINED(4, 2)}, false) return nil`);
ok("12 tie: the next round's count keeps it closed for White", !seen().includes("White") && at("eng_tie", "active") === "true", at("eng_tie", "visibility"));
q('told = {} chat("tie", "", Player.White) return nil');
ok("12 tie: mtg tie alone says the words again", /Rounds without progress: 2 of 3/.test(q("return told[1]") || ""), q("return told[1]"));
q(`engineTieUpdate(${DECLINED(5, 0)}, false) return nil`);
ok("12 tie: a new offer shows again to everyone", seen().includes("White"), at("eng_tie", "visibility"));
q(`engineTieUpdate(nil, false) return nil`);

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
// the pop-up's XML: engineTieXml, its buttons on onMtgTie
const xml = fn(RENDERER, "engineTieXml");
ok("xml: the tie pop-up and its two buttons", /id="eng_tie"/.test(xml) && /id="eng_tieyes" onClick="onMtgTie"/.test(xml) && /id="eng_tieno" onClick="onMtgTie"/.test(xml), "engineTieXml");
ok("board: each board update draws the tie pop-up", /pcall\(engineTieUpdate, m\.tie, m\.gameOver\)/.test(RENDERER), "the board's apply");

console.log(`${failed ? "FAIL" : "PASS"} test_table_tie_offer: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
