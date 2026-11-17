// Player-made card art, past plain cards (docs/custom-art-spec.md, the parts after the plain-cards slice):
//  - double-faced cards: the deck's own other face (the importer's second state, read by "mtg ready" as f2 / n2, or a
//    player's "mtg art back <card> <link>") is the card's back and its hand's other side, ahead of Scryfall's; a
//    transformed card (its engine name the back face's) shows that face with the front as its back;
//  - tokens the game makes: a player's "mtg art token <name> <link>" for their own tokens of that name;
//  - the AI's decks: a deck list pasted for an AI seat keeps its "#https://..." links (front, and a second for a
//    back) under the same rules, as a table deck does.
// Every link passes the same checks (artProblem), the host's "mtg art off" puts every one of them away, and a link that
// fails falls back to the normal picture with a chat line. Also the table's reading of a card's second state
// (make-engine-copy.js cardInfo) on fengari. No TTS save needed.
//   node tests/test_bridge_custom_art_2.js
const fs = require("fs");
const path = require("path");
const harness = require("./bridge-harness");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const D2 = require("./golden/fixtures/dump2.json");
const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);

const klr = (n, side = "front") => `https://img.klrmngr.com/display/${side}/${n}/${n}/${String(n).repeat(8)}-0000-0000-0000-00000000000${n}.webp`;
const CMD = klr(4);
const DELVER = klr(5), DELVER_BACK = klr(5, "back");
const SCRY_BACK = "https://cards.scryfall.io/normal/back/a/b/scryfall-insectile.jpg";
const MY_FRONT = "https://i.imgur.com/my-delver.png", MY_BACK = "https://i.imgur.com/my-insectile.png";
const MY_SOLDIER = "https://i.imgur.com/my-soldier.png";
const AI_BOLT = "https://i.imgur.com/ai-bolt.jpg", AI_FRONT = "https://i.imgur.com/ai-delver.png", AI_BACK = "https://i.imgur.com/ai-insectile.png";
// (Scryfall's own record of the card, as the bridge's cache holds it: its back face and both faces' names)
const CACHE = { "delver of secrets": { face: "https://cards.scryfall.io/normal/front/a/b/scryfall-delver.jpg", back: SCRY_BACK, faces: ["Delver of Secrets", "Insectile Aberration"] } };

function game(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: clone(D2.board), fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  return seat;
}
const ready = async (h, seats) => { h.B.onTTS({ t: "decks", json: JSON.stringify({ seats }) }); await h.flush(); };
const deckWith = (...library) => ({ deckName: "Art", commander: [{ n: "Neheb, the Eternal", f: CMD }], library });
const card = (id, name, owner, extra = {}) => ({ id, identity: { name }, types: ["Creature"], power: 1, toughness: 1, controllerId: owner, ownerId: owner, ...extra });
const token = (id, name, owner) => card(id, name, owner, { identity: { name, isToken: true }, subtypes: [name], colors: ["W"] });
const art = async (h, text, color = "Blue") => { h.B.onTTS({ t: "artset", color, text }); await h.flush(); };
const run = async (opts, fn) => { const h = harness.load(opts); try { return await fn(h); } finally { harness.restore(); } };

(async () => {
  // ── double-faced cards: the deck's own other face ──
  await run({ imageCache: CACHE }, async (h) => {
    game(h);
    await ready(h, { Blue: deckWith({ n: "Delver of Secrets", f: DELVER, n2: "Insectile Aberration", f2: DELVER_BACK }) });
    const t = h.B.tableCard(card("engine-card-700", "Delver of Secrets", "player-0"));
    same("dfc: the deck's front", t.f, DELVER);
    same("dfc: the deck's other face is the card's back, not Scryfall's", t.b, DELVER_BACK);
    same("dfc: and its other side in a hand", t.o2, DELVER_BACK);
    const x = h.B.tableCard(card("engine-card-701", "Insectile Aberration", "player-0"));
    same("dfc: transformed, the deck's back face shows, the front as its back", [x.f, x.b], [DELVER_BACK, DELVER]);
  });
  await run({ imageCache: CACHE }, async (h) => {
    game(h);
    let n = h.effects.length;
    await ready(h, { Blue: deckWith({ n: "Delver of Secrets", f: MY_FRONT, n2: "Insectile Aberration", f2: MY_BACK }) });
    const said = chats(h, n).find((c) => /Blue \(Art\): ready/.test(c)) || "";
    ok("dfc: the chat names both pictures", /Delver of Secrets: your picture on all 1 copies/.test(said) && /Delver of Secrets: your back picture \(Insectile Aberration\)/.test(said), said);
    const t = h.B.tableCard(card("engine-card-702", "Delver of Secrets", "player-0"));
    same("dfc: a player's front and back", [t.f, t.b], [MY_FRONT, MY_BACK]);
    const x = h.B.tableCard(card("engine-card-703", "Insectile Aberration", "player-0"));
    same("dfc: transformed with a player's back", [x.f, x.b], [MY_BACK, MY_FRONT]);
    h.B.onTTS({ t: "art", color: "Blue", on: false }); await h.flush();
    const off = h.B.tableCard(card("engine-card-704", "Delver of Secrets", "player-0"));
    ok("art off: neither picture of the player's shows", off.f !== MY_FRONT && off.b !== MY_BACK && off.b === SCRY_BACK, JSON.stringify([off.f, off.b]));
    const offX = h.B.tableCard(card("engine-card-705", "Insectile Aberration", "player-0"));
    ok("art off: transformed, not the player's back either", offX.f !== MY_BACK, offX.f);
    h.B.onTTS({ t: "art", color: "Blue", on: true }); await h.flush();
  });
  await run({ imageCache: CACHE }, async (h) => {
    game(h);
    let n = h.effects.length;
    await ready(h, { Blue: deckWith({ n: "Delver of Secrets", f: DELVER, n2: "Insectile Aberration", f2: "http://i.imgur.com/insectile.png" }) });
    const said = chats(h, n).find((c) => /Blue \(Art\): ready/.test(c)) || "";
    ok("dfc: a bad back link is said, with why", /Delver of Secrets: the back picture link was not used \(the link must start with https:\/\/\); its back shows its normal picture/.test(said), said);
    same("dfc: a bad back link falls back to the normal back", h.B.tableCard(card("engine-card-706", "Delver of Secrets", "player-0")).b, SCRY_BACK);
  });
  await run({}, async (h) => {
    // (no Scryfall record of the card: the transformed side is found by the name the deck's second state gave)
    game(h);
    await ready(h, { Blue: deckWith({ n: "Delver of Secrets", f: DELVER, n2: "Insectile Aberration", f2: MY_BACK }) });
    const x = h.B.tableCard(card("engine-card-707", "Insectile Aberration", "player-0"));
    same("dfc: transformed, by the deck's own name for the back face", [x.f, x.b], [MY_BACK, DELVER]);
    same("dfc: a normal front with a player's back", h.B.tableCard(card("engine-card-708", "Delver of Secrets", "player-0")).b, MY_BACK);
    h.B.onTTS({ t: "art", color: "Blue", on: false }); await h.flush();
    ok("art off: a player's back on a normal front is put away", h.B.tableCard(card("engine-card-709", "Delver of Secrets", "player-0")).b !== MY_BACK, h.B.tableCard(card("engine-card-709", "Delver of Secrets", "player-0")).b);
  });
  // (the importer drops a DFC's back when its front has a link: "mtg art back" gives the back in the meantime)
  await run({ imageCache: CACHE }, async (h) => {
    game(h);
    await ready(h, { Blue: deckWith({ n: "Delver of Secrets", f: MY_FRONT }) });
    let n = h.effects.length;
    await art(h, `back Delver of Secrets ${MY_BACK}`);
    ok("mtg art back: said", chats(h, n).some((c) => /^\[MTG\] Blue: your back picture for Delver of Secrets \(on every copy you own\)\./.test(c)), chats(h, n).join(" | "));
    same("mtg art back: the card's back", h.B.tableCard(card("engine-card-710", "Delver of Secrets", "player-0")).b, MY_BACK);
    same("mtg art back: transformed", h.B.tableCard(card("engine-card-711", "Insectile Aberration", "player-0")).f, MY_BACK);
    ok("mtg art back: not on another player's copy", h.B.tableCard(card("engine-card-712", "Delver of Secrets", "player-1")).b !== MY_BACK);
    n = h.effects.length;
    await art(h, "back Delver of Secrets http://x.example/a.png");
    ok("mtg art back: a bad link refused, with why", chats(h, n).some((c) => /^\[MTG\] That picture link can't be used: the link must start with https:\/\//.test(c)), chats(h, n).join(" | "));
    n = h.effects.length;
    await art(h, `back Not A Real Card ${MY_BACK}`);
    ok("mtg art back: a name the engine doesn't know is refused", chats(h, n).some((c) => /The engine doesn't know a card named "Not A Real Card"/.test(c)), chats(h, n).join(" | "));
    await art(h, "back clear");
    same("mtg art back clear: the normal back again", h.B.tableCard(card("engine-card-713", "Delver of Secrets", "player-0")).b, SCRY_BACK);
  });

  // ── tokens the game makes ──
  await run({}, async (h) => {
    game(h);
    let n = h.effects.length;
    await art(h, `token Soldier ${MY_SOLDIER}`);
    ok("mtg art token: said", chats(h, n).some((c) => /^\[MTG\] Blue: your picture for your Soldier tokens\./.test(c)), chats(h, n).join(" | "));
    same("token: the player's own Soldier tokens wear it", h.B.tableCard(token("engine-card-720", "Soldier", "player-0")).f, MY_SOLDIER);
    ok("token: another player's Soldier tokens don't", h.B.tableCard(token("engine-card-721", "Soldier", "player-1")).f !== MY_SOLDIER);
    ok("token: another token of the player's doesn't", h.B.tableCard(token("engine-card-722", "Zombie", "player-0")).f !== MY_SOLDIER);
    ok("token: a card named Soldier that isn't a token doesn't", h.B.tableCard(card("engine-card-723", "Soldier", "player-0")).f !== MY_SOLDIER);
    n = h.effects.length;
    await art(h, "token");
    ok("mtg art token: lists the player's", chats(h, n).some((c) => /^\[MTG\] Your token pictures: Soldier\./.test(c)), chats(h, n).join(" | "));
    h.B.onTTS({ t: "art", color: "Blue", on: false }); await h.flush();
    ok("art off: the token's normal picture", h.B.tableCard(token("engine-card-724", "Soldier", "player-0")).f !== MY_SOLDIER);
    h.B.onTTS({ t: "art", color: "Blue", on: true }); await h.flush();
    n = h.effects.length;
    await art(h, 'token Soldier https://x.example/a".png');
    ok("mtg art token: a bad link refused, with why", chats(h, n).some((c) => /can't be used: .*quote/.test(c)), chats(h, n).join(" | "));
    same("token: the good link stays", h.B.tableCard(token("engine-card-725", "Soldier", "player-0")).f, MY_SOLDIER);
    await art(h, "token clear");
    ok("mtg art token clear: the normal picture again", h.B.tableCard(token("engine-card-726", "Soldier", "player-0")).f !== MY_SOLDIER);
    n = h.effects.length;
    await art(h, "nonsense here");
    ok("mtg art <other>: how to use it", chats(h, n).some((c) => /Use:  mtg art token <token name> <link>/.test(c)), chats(h, n).join(" | "));
  });

  // ── the AI's decks: a pasted deck list keeps its links ──
  await run({ imageCache: CACHE }, async (h) => {
    const parsed = h.B.parseDeckList(`Commander\n1 Neheb, the Eternal\nDeck\n1 Lightning Bolt #${AI_BOLT}\n1 Delver of Secrets #${AI_FRONT} #${AI_BACK}\n1 Mountain #Ramp`);
    same("list: names without their links or tags", parsed.cards, ["Lightning Bolt", "Delver of Secrets", "Mountain"]);
    same("list: the links kept, a second as the back", h.B.deckListArt(`Commander\n1 Neheb, the Eternal\nDeck\n1 Lightning Bolt #${AI_BOLT}\n1 Delver of Secrets #${AI_FRONT} #${AI_BACK}\n1 Mountain #Ramp`), { "Lightning Bolt": { front: AI_BOLT, back: null }, "Delver of Secrets": { front: AI_FRONT, back: AI_BACK } });
    const list = `Commander\n1 Neheb, the Eternal\nDeck\n1 Lightning Bolt #${AI_BOLT}\n1 Delver of Secrets #${AI_FRONT} #${AI_BACK}\n1 Shock #http://i.imgur.com/shock.png\n` + "1 Mountain\n".repeat(20);
    const r = h.B.setAiSeat("White", "forge", { list });
    ok("ai: the seat takes the deck", r.ok, r.message);
    ok("ai: the message says the pictures", /your pictures on 2 cards/.test(r.message) && /Shock: the picture link was not used \(the link must start with https:\/\/\)/.test(r.message), r.message);
    game(h);
    h.B._getGame().pictures = h.B.gamePictures(["tts-Blue-ab12", "self-hosted-node-77-bot"]);
    same("ai: the AI's card wears the list's picture", h.B.tableCard(card("engine-card-730", "Lightning Bolt", "player-1")).f, AI_BOLT);
    same("ai: its DFC both pictures", ((t) => [t.f, t.b])(h.B.tableCard(card("engine-card-731", "Delver of Secrets", "player-1"))), [AI_FRONT, AI_BACK]);
    same("ai: transformed", h.B.tableCard(card("engine-card-732", "Insectile Aberration", "player-1")).f, AI_BACK);
    ok("ai: a bad link falls back", h.B.tableCard(card("engine-card-733", "Shock", "player-1")).f !== "http://i.imgur.com/shock.png");
    ok("ai: not on the human's copy", h.B.tableCard(card("engine-card-734", "Lightning Bolt", "player-0")).f !== AI_BOLT);
    h.B.onTTS({ t: "art", color: "Blue", on: false }); await h.flush();
    ok("art off: the AI's normal pictures", h.B.tableCard(card("engine-card-735", "Lightning Bolt", "player-1")).f !== AI_BOLT);
  });

  // ── the table: "mtg ready" reads a card's second state, and the chat passes "mtg art token|back" on ──
  const COPY = fs.readFileSync(path.join(__dirname, "..", "tools", "make-engine-copy.js"), "utf8").replace(/\r\n/g, "\n");
  const a = COPY.indexOf("local function cardInfo(");
  const b = a < 0 ? -1 : COPY.indexOf("\nend\n", a);
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const code = `${a < 0 ? "" : 'local function cardName(nick) local first = tostring(nick or ""):match("^[^\\n]*") or "" return (first:gsub("%s+$", "")) end\n' + COPY.slice(a, b + 5)}
    function info(d, deck) local c = cardInfo(d, deck) return tostring(c.n) .. "|" .. tostring(c.f) .. "|" .. tostring(c.b) .. "|" .. tostring(c.n2) .. "|" .. tostring(c.f2) end`;
  if (a < 0 || lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) ok("table: cardInfo loads", false, a < 0 ? "cardInfo is gone" : lua.lua_tojsstring(L, -1));
  else {
    const q = (src) => { if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`; const v = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return v; };
    same("table: a plain card, as before", q(`return info({ Nickname = "Sol Ring", CustomDeck = { ["1"] = { FaceURL = "F", BackURL = "B" } } })`), "Sol Ring|F|B|nil|nil");
    same("table: a DFC's second state: its name and picture", q(`return info({ Nickname = "Delver of Secrets", CustomDeck = { ["1"] = { FaceURL = "F", BackURL = "B" } },
      States = { ["2"] = { Nickname = "Insectile Aberration", CustomDeck = { ["2"] = { FaceURL = "F2", BackURL = "B" } } } } })`), "Delver of Secrets|F|B|Insectile Aberration|F2");
    same("table: a card in a deck, its second state's picture from the deck", q(`return info({ Nickname = "Delver of Secrets", CardID = 100, States = { ["2"] = { Nickname = "Insectile Aberration", CardID = 200 } } },
      { [1] = { FaceURL = "F", BackURL = "B" }, [2] = { FaceURL = "F2", BackURL = "B" } })`), "Delver of Secrets|F|B|Insectile Aberration|F2");
  }
  ok("table: mtg art token and back go to the bridge, from any player", /rest:sub\(1, 5\) == "token" or rest:sub\(1, 4\) == "back"[\s\S]{0,200}engineSend\("artset", \{ color = pl\.color, text = message:sub\(restAt\) \}\)/.test(COPY), "make-engine-copy.js engineChat");

  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_custom_art_2: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_custom_art_2: ${e.stack}`); process.exit(1); });
