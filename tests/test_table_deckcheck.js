// DeckCheck on the table (docs/deckcheck-spec.md, "Import" and "Bracket and threat level next to the commander"), on
// the fake TTS:
//  1. the Card Importer (its engine-copy script, tools/make-engine-copy.js step 7 + tools/deckcheck-import.lua) takes a
//     deckcheck.co link: ONE request to the /deck endpoint, the deck spawned commanders first under DeckCheck's name,
//     the tag in its GM notes; every error in plain words; Moxfield and Archidekt as before. The web answers come
//     from the hand-made fixture tests/golden/fixtures/deckcheck-deck.json, never a recorded DeckCheck response.
//  2. Global (tools/engine-renderer.lua engineDeckCheckLabels / engineDeckCheckDraw): in engine mode with no game
//     running, each seated player whose deck on their library spot carries the tag gets the label beside their
//     commander zones; none without a tag; gone while a game runs and back after it; each seat its own.
//   node tests/test_table_deckcheck.js
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { runImporter } = require("./lua/importer-run");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "deckcheck-deck.json"), "utf8"));
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) { passed++; console.log(`ok   ${name}`); } else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 600)}` : ""}`); } };
const DOT = "·";
const API = "https://deckcheck.co/api/external/deck?deck_id=";

// ───────── 1. the Card Importer ─────────
function* allObjects(list) { for (const o of list || []) { yield o; yield* allObjects(o.ContainedObjects); yield* allObjects(Object.values(o.States || {})); } }
const importer = [...allObjects(save.ObjectStates)].find((o) => typeof o.LuaScript === "string" && o.LuaScript.includes("function parseImporterChatArgs"));

const answer = (status, body) => ({ response_code: status, is_error: status >= 400, error: status >= 400 ? `HTTP/1.1 ${status}` : "", text: typeof body === "string" ? body : JSON.stringify(body) });
const dcUrl = (id) => `${API}${id}`;
const saidAll = (r) => (r.said || []).join(" | ");

ok("importer: the engine copy's Card Importer has the DeckCheck code", importer && importer.LuaScript.includes("function fetchDeckCheckDeck(") && importer.LuaScript.includes("function deckcheckEntries("));

{
  const id = "abcDEF_12";
  const r = runImporter(importer.LuaScript, `Importer deck https://deckcheck.co/app/deckview/${id}`, { [dcUrl(id)]: answer(200, FIX.partners) });
  ok("import: runs", !r.error, r.error);
  const dc = (r.requests || []).filter((u) => u.includes("deckcheck.co"));
  ok("import: one request to DeckCheck, to the /deck endpoint by id, no key", dc.length === 1 && dc[0] === dcUrl(id), JSON.stringify(dc));
  const deck = (r.decks || [])[0];
  ok("import: one deck of 100 cards", r.decks && r.decks.length === 1 && deck.n === 100, JSON.stringify(r.decks && r.decks.map((d) => d.n)));
  ok("import: named as on DeckCheck", deck && deck.desc === "Test Partners Pile", deck && deck.desc);
  ok("import: commanders first", deck && deck.names[0] === "Thrasios, Triton Hero" && deck.names[1] === "Tymna the Weaver", deck && deck.names.slice(0, 3).join(", "));
  ok("import: basic lands as many times as their quantity", deck && deck.names.filter((n) => n === "Plains").length === 40, deck && deck.names.filter((n) => n === "Plains").length);
  ok("import: the tag in the deck's GM notes", deck && deck.gm === `[deckcheck] id=${id} bracket=3 threat=54/96`, deck && deck.gm);
  ok("import: no error said", !/DeckCheck/.test(saidAll(r)) || /All 100 cards loaded/.test(saidAll(r)), saidAll(r));
}
{
  // every link kind, www., upper-case host, a query string and a trailing slash: the same id
  for (const link of ["https://www.deckcheck.co/app/decklist/Zz9-x/", "https://DeckCheck.co/app/builder/Zz9-x?tab=stats"]) {
    const r = runImporter(importer.LuaScript, `Scryfall deck ${link}`, { [dcUrl("Zz9-x")]: answer(200, FIX.standard) });
    ok(`import: ${link} reads the id`, r.requests && r.requests.filter((u) => u.includes("deckcheck.co")).join() === dcUrl("Zz9-x"), JSON.stringify(r.requests));
    ok(`import: ${link} non-Commander deck spawns, tag without bracket or threat`, r.decks && r.decks.length === 1 && r.decks[0].n === 28 && r.decks[0].gm === "[deckcheck] id=Zz9-x", JSON.stringify(r.decks && r.decks.map((d) => [d.n, d.gm])));
  }
}
{
  const cases = [
    [403, { error: "Deck is private" }, /That DeckCheck deck is private: make it public or unlisted on DeckCheck and try again\./],
    [404, { error: "Deck not found" }, /DeckCheck has no deck at that link/],
    [429, { error: "Too many requests" }, /DeckCheck is busy/],
    [500, { error: "Internal" }, /DeckCheck had a problem on its side/],
    [400, { error: "Bad deck_id" }, /doesn't look like a DeckCheck deck link/],
  ];
  for (const [status, body, want] of cases) {
    const r = runImporter(importer.LuaScript, "Importer deck https://deckcheck.co/app/deckview/Err1", { [dcUrl("Err1")]: answer(status, body) });
    ok(`import error ${status}: said in plain words, nothing spawned, one request`, want.test(saidAll(r)) && r.decks.length === 0 && r.requests.filter((u) => u.includes("deckcheck.co")).length === 1, saidAll(r));
  }
  // the status only in the error text (no response_code), as UnityWebRequest can give it
  const r1 = runImporter(importer.LuaScript, "Importer deck https://deckcheck.co/app/deckview/Err2", { [dcUrl("Err2")]: { is_error: true, error: "HTTP/1.1 403 Forbidden", text: "" } });
  ok("import error: the status read from 'HTTP/1.1 403 Forbidden'", /is private/.test(saidAll(r1)), saidAll(r1));
  const r2 = runImporter(importer.LuaScript, "Importer deck https://deckcheck.co/app/deckview/Err3", {});
  ok("import error: no answer -> couldn't reach DeckCheck, nothing spawned", /Couldn't reach DeckCheck/.test(saidAll(r2)) && r2.decks.length === 0, saidAll(r2));
  const r3 = runImporter(importer.LuaScript, "Importer deck https://deckcheck.co/app/home", {});
  ok("import error: a deckcheck.co link that isn't a deck: said, and no request", /doesn't look like a DeckCheck deck link/.test(saidAll(r3)) && r3.requests.filter((u) => u.includes("deckcheck.co")).length === 0, saidAll(r3) + " " + JSON.stringify(r3.requests));
  const r4 = runImporter(importer.LuaScript, "Importer deck https://deckcheck.co/app/deckview/Err4", { [dcUrl("Err4")]: answer(200, "<!DOCTYPE html><html></html>") });
  ok("import error: a 200 that isn't JSON: said, nothing spawned", /DeckCheck had a problem on its side/.test(saidAll(r4)) && r4.decks.length === 0, saidAll(r4));
  const huge = JSON.parse(JSON.stringify(FIX.standard));
  huge.boards.mainboard.cards["dc-s2"].quantity = 100000;
  const r5 = runImporter(importer.LuaScript, "Importer deck https://deckcheck.co/app/deckview/Err5", { [dcUrl("Err5")]: answer(200, huge) });
  ok("import error: an answer with too many cards is refused", /importer takes at most 250/.test(saidAll(r5)) && r5.decks.length === 0, saidAll(r5));
}
{
  // Moxfield as before: its own endpoint, and its deck carries no GM notes
  const mox = { name: "Mox Pile", commanders: { a: { quantity: 1, card: { scryfall_id: "00000000-0000-4000-8000-0000000000c1", name: "Thrasios, Triton Hero" } } },
    mainboard: { b: { quantity: 3, card: { scryfall_id: "00000000-0000-4000-8000-0000000000a5", name: "Plains" } } } };
  const r = runImporter(importer.LuaScript, "Importer deck https://www.moxfield.com/decks/abc123", { "https://api2.moxfield.com/v2/decks/all/abc123/": answer(200, mox) });
  ok("moxfield: still its own endpoint, no DeckCheck request", r.requests && r.requests.includes("https://api2.moxfield.com/v2/decks/all/abc123/") && !r.requests.some((u) => u.includes("deckcheck")), JSON.stringify(r.requests));
  ok("moxfield: the deck spawns with no GM notes", r.decks && r.decks.length === 1 && r.decks[0].n === 4 && r.decks[0].gm === "" && r.decks[0].desc === "Mox Pile", JSON.stringify(r.decks));
}

// ───────── 2. the label beside the commander zones ─────────
// (the commander zones: the 4-player table's profile, TABLE_PROFILE.tax in the built script)
const PROFILE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tools", "profiles", "2296042369.json"), "utf8"));
const tax = (c) => PROFILE.seat[c].commandZones.map((z) => z.guid);
const q = (code, mark, frames) => ({ lua: code, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => r.steps.find((s) => s.step === mark)?.value;

// a deck on colour's library spot with these GM notes
const deckOn = (color, gm) => `local z = data["${color}"].libraryZone.getPosition()
  spawnObjectData({ data = { Name = "Deck", Nickname = "${color} deck", GMNotes = ${JSON.stringify(gm)}, DeckIDs = { 100, 101 }, CustomDeck = { ["1"] = { FaceURL = "f", BackURL = "b", NumWidth = 1, NumHeight = 1 } },
    ContainedObjects = {}, Transform = { posX = z.x, posY = z.y, posZ = z.z, rotX = 0, rotY = 0, rotZ = 180, scaleX = 1, scaleY = 1, scaleZ = 1 } }, position = z })`;
// each mat's DeckCheck labels: "Colour: label@x,z" with the world spot where real TTS draws it (a mat zone's button
// with its local x mirrored), "|" between, or "none"
const LABELS = 'local out = {} for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do local mat = data[c].playmat ' +
  'for _, b in ipairs(mat.getButtons() or {}) do if b.click_function == "engineDeckCheckNoop" then local w = mat.positionToWorld(Vector(-b.position.x, b.position.y, b.position.z)) ' +
  'out[#out + 1] = c .. ": " .. tostring(b.label) .. string.format("@%.2f,%.2f", w.x, w.z) end end end return #out == 0 and "none" or table.concat(out, " | ")';
const SPOTS = 'local out = {} for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do ' +
  `local a = getObjectFromGUID(({ White = "${tax("White")[0]}", Red = "${tax("Red")[0]}", Yellow = "${tax("Yellow")[0]}", Blue = "${tax("Blue")[0]}" })[c]).getPosition() ` +
  `local b = getObjectFromGUID(({ White = "${tax("White")[1]}", Red = "${tax("Red")[1]}", Yellow = "${tax("Yellow")[1]}", Blue = "${tax("Blue")[1]}" })[c]).getPosition() ` +
  'local l = data[c].libraryZone.getPosition() out[#out + 1] = string.format("%s %.2f,%.2f %.2f,%.2f %.2f,%.2f", c, a.x, a.z, b.x, b.z, l.x, l.z) end return table.concat(out, "|")';
// per mat with a label: "Colour label-turn ready-turn" (the label reads from the seat, as the READY button beside it)
const TURNS = 'local out = {} for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do local mat = data[c].playmat local lab, rdy = nil, nil ' +
  'for _, b in ipairs(mat.getButtons() or {}) do if b.click_function == "engineDeckCheckNoop" then lab = b.rotation[2] end if b.click_function == "onMtgSetupReady" then rdy = b.rotation[2] end end ' +
  'if lab ~= nil then out[#out + 1] = string.format("%s %.1f %s", c, lab % 360, rdy and string.format("%.1f", rdy % 360) or "none") end end return table.concat(out, "|")';
const W_TAG = "Imported 2026-11-15\n[deckcheck] id=wDeck1 bracket=3 threat=54/96";
const R_TAG = "[deckcheck] id=rDeck2 bracket=4 threat=60/96";
const players = ["White", "Red", "Yellow", "Blue"].map((color, i) => ({ color, slot: `player-${i}`, name: color, ai: false, life: 40, status: "playing", pool: {},
  cmdDamage: {}, tax: [], library: 50, handCount: 0, hand: null, battlefield: [], graveyard: [], exile: [], command: [] }));
const board = (extra = {}) => JSON.stringify({ t: "table", turn: 2, step: "main1", active: "White", activeTurnNo: 1, priority: "White", gameOver: false, winner: null, players, stack: [], cards: {}, ...extra });
const started = JSON.stringify({ t: "started", colors: { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" },
  names: { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" }, ai: [] });

const r = simulate({ save, seated: ["White", "Red", "Yellow", "Blue"], host: "Blue", steps: [
  q(`${deckOn("White", W_TAG)} ${deckOn("Red", R_TAG)} ${deckOn("Yellow", "some other notes")} return "decks"`, "decks", 30),
  q(LABELS, "engine off", 150),
  q('engineChat("mtg engine on", Player.Blue) return "on"', "on", 150),
  q(LABELS, "engine on"), q(SPOTS, "spots"), q(TURNS, "turns"),
  q('engineChat("mtg mode 2hg", Player.Blue) return "ok"', "to 2hg", 150),
  q('return tostring(engineTeamsLabel and engineTeamsLabel())', "teams label"),
  q(LABELS, "2hg"),
  // (only the label goes: the READY button left, so the heal has to notice the label itself)
  q('local mat = data.White.playmat for i, b in ipairs(mat.getButtons()) do if b.click_function == "engineDeckCheckNoop" then mat.removeButton(i - 1) break end end return "wiped"', "wiped", 150),
  q(LABELS, "healed"),
  // (Blue's spot already holds the save's exported deck, the one getDeckFromZone and the READY check read: tagged now)
  q('getDeckFromZone(data.Blue.libraryZone).setGMNotes("[deckcheck] id=bDeck3 threat=20/96") return "blue deck"', "blue deck", 150),
  q(LABELS, "blue deck added"),
  { msg: { t: "started", json: started } },
  { msg: { t: "table", json: board() }, frames: 150 },
  q(LABELS, "game running"),
  // (the deck the label would read, whatever lies first on White's library spot mid-game, tagged for a moment: still
  // no label, since nothing is read while a game runs; its own notes put back before the game is cleared)
  q(`${deckOn("White", W_TAG)} local d = getDeckFromZone(data.White.libraryZone) __was = d.getGMNotes() __d = d d.setGMNotes(${JSON.stringify(W_TAG)}) return "tagged"`, "mid-game deck", 150),
  { msg: { t: "table", json: board() }, frames: 150 },
  q(LABELS, "game running, tagged deck on the spot"),
  q('__d.setGMNotes(__was) return "put back"', "put back"),
  { msg: { t: "table", json: board({ gameOver: true, winner: "White" }) }, frames: 30 },
  q('onMtgSetupStart(nil, "Blue") return "new game"', "new game"), // (NEW GAME: engine mode stays on)
  { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 150 },
  q(LABELS, "after the game"),
  q('engineChat("mtg engine off", Player.Blue) return "off"', "off", 150),
  q(LABELS, "engine off again"),
] });
ok("label: the script ran", !r.errors.length, r.errors.slice(0, 3).join(" | "));
const parse = (s) => Object.fromEntries(String(s).split(" | ").filter((x) => x !== "none").map((x) => { const [c, rest] = x.split(": "); const [label, at] = rest.split("@"); return [c, { label, at: at.split(",").map(Number) }]; }));
ok("label: none with engine mode off", valueOf(r, "engine off") === "none", valueOf(r, "engine off"));
const on = parse(valueOf(r, "engine on"));
ok("label: White's DeckCheck deck shows its bracket and threat", on.White && on.White.label === `Bracket 3 ${DOT} Threat 54 (32-51)`, valueOf(r, "engine on"));
ok("label: Red's shows its own", on.Red && on.Red.label === `Bracket 4 ${DOT} Threat 60 (52-67)`, valueOf(r, "engine on"));
ok("label: no tag (Yellow's notes, Blue's exported deck): no label", !on.Yellow && !on.Blue && Object.keys(on).length === 2, valueOf(r, "engine on"));
// beside the commander zones: centred between the two along the column, on the library side past their near edge
// (half a card, 1.55) and short of the exile pile's far edge (4.16 - 1.53 from the library)
{
  const spots = Object.fromEntries(String(valueOf(r, "spots")).split("|").map((s) => { const [c, a, b, l] = s.split(" "); return [c, [a, b, l].map((p) => p.split(",").map(Number))]; }));
  const beside = (c) => {
    const [a, b, l] = spots[c];
    const at = on[c] && on[c].at;
    if (!at) return false;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const toLib = Math.hypot(l[0] - mid[0], l[1] - mid[1]);
    const dMid = Math.hypot(at[0] - mid[0], at[1] - mid[1]), dLib = Math.hypot(at[0] - l[0], at[1] - l[1]);
    return Math.abs(dMid + dLib - toLib) < 0.05 && dMid > 1.55 + 0.375 && dLib > 4.16 + 1.53 + 0.375;
  };
  ok("label: White's lies between its commander zones and its exile pile", beside("White"), `${valueOf(r, "spots")} / ${valueOf(r, "engine on")}`);
  ok("label: Red's lies between its commander zones and its exile pile", beside("Red"), `${valueOf(r, "spots")} / ${valueOf(r, "engine on")}`);
}
{
  const t = String(valueOf(r, "turns")).split("|").map((x) => x.split(" "));
  ok("label: reads from its seat (turned as the READY button on the same mat)", t.length === 2 && t.every(([, lab, rdy]) => rdy !== "none" && Math.abs(Number(lab) - Number(rdy)) < 0.05), valueOf(r, "turns"));
}
ok("label: the table really is in 2HG for the next check", /2HG|Two-Headed/i.test(String(valueOf(r, "teams label"))), valueOf(r, "teams label"));
ok("label: kept in 2HG, each player's own", valueOf(r, "2hg") === valueOf(r, "engine on"), valueOf(r, "2hg"));
ok("label: wiped buttons come back (the 2 s heal)", valueOf(r, "healed") === valueOf(r, "engine on"), valueOf(r, "healed"));
const blue = parse(valueOf(r, "blue deck added"));
ok("label: a deck tagged later gets its label; threat alone reads 'Threat 20/96'", blue.Blue && blue.Blue.label === "Threat 20/96" && Object.keys(blue).length === 3, valueOf(r, "blue deck added"));
ok("label: hidden while a game runs", valueOf(r, "game running") === "none" && valueOf(r, "game running, tagged deck on the spot") === "none", valueOf(r, "game running") + " / " + valueOf(r, "game running, tagged deck on the spot"));
ok("label: back after the game ends", valueOf(r, "after the game") === valueOf(r, "blue deck added"), valueOf(r, "after the game"));
ok("label: gone with engine mode off", valueOf(r, "engine off again") === "none", valueOf(r, "engine off again"));

// an empty seat's deck: no label (only seated players get one)
{
  const r2 = simulate({ save, seated: ["White", "Blue"], host: "Blue", steps: [
    q(`${deckOn("White", W_TAG)} ${deckOn("Red", R_TAG)} return "decks"`, "decks", 30),
    q('engineChat("mtg engine on", Player.Blue) return "on"', "on", 150),
    q(LABELS, "labels"),
  ] });
  const l = parse(valueOf(r2, "labels"));
  ok("label: an empty seat's tagged deck gets none; the seated player's does", !r2.errors.length && l.White && !l.Red, valueOf(r2, "labels") + " " + r2.errors.join(" | "));
}

console.log(`${failed ? failed + " failed, " : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
