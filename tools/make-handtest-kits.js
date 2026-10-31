// Hand-test deck kits for the table: every deck of the hand-play sweep (tmp/handplay/hp-*.json: everyday mechanics
// and every keyword, 40 cards each) plus tmp/handplay/lib-01.json, each as a bag holding its 39-card deck and its
// commander, with a "Load into my seat" button (Global engineLoadTestKit). All of them go in one bag beside White's
// seat. Writes the bag as a TTS Saved Object (Objects > Saved Objects > "Hand-test decks (40 cards)"): bring it in from
// there. The per-kit Lua files (tmp/handtest/) spawn the kits LIVE and loaded ~1,000 card pictures at once: TTS crashed
// (d3d11 887a0005, 2026-10-22). Don't run them on the player's table.
//   node tools/make-handtest-kits.js
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "tmp", "handtest");
fs.mkdirSync(OUT, { recursive: true });
const BACK = "https://steamusercontent-a.akamaihd.net/ugc/1647720103762682461/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/";
const BAG_AT = { x: 4, y: 2, z: -28 }; // in front of White's playmat, left of the hand
const decks = [...fs.readdirSync(path.join(ROOT, "tmp", "handplay")).filter((f) => /^hp-\d+\.json$/.test(f)).sort().map((f) => `tmp/handplay/${f}`), "tmp/handplay/lib-01.json"];
const KIT_SCRIPT = `function onLoad()
  self.createButton({ click_function = "loadKit", function_owner = self, label = "Load into my seat", position = { 0, 1.2, 1.6 },
    rotation = { 0, 180, 0 }, width = 1700, height = 420, font_size = 200, color = { 0.18, 0.45, 0.22 }, font_color = { 1, 1, 1 }, tooltip = "" })
end
function loadKit(obj, color) Global.call("engineLoadTestKit", { guid = self.getGUID(), color = color }) end`;
(async () => {
  const all = decks.map((d) => JSON.parse(fs.readFileSync(path.join(ROOT, d), "utf8")));
  const names = [...new Set(all.flatMap((p) => p.cards.map((e) => e.name)))];
  const img = {};
  for (let i = 0; i < names.length; i += 75) {
    const r = await fetch("https://api.scryfall.com/cards/collection", { method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "mtg-tts-bridge/0.1" },
      body: JSON.stringify({ identifiers: names.slice(i, i + 75).map((name) => ({ name: name.split(" // ")[0] })) }) }).then((r) => r.json());
    for (const c of r.data || []) {
      const f = c.id ? `https://img.klrmngr.com/display/front/${c.id[0]}/${c.id[1]}/${c.id}.webp` : "";
      img[c.name] = f; img[c.name.split(" // ")[0]] = f;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  let missing = 0;
  const kits = [];
  all.forEach((p, k) => {
    const nn = String(k + 1).padStart(2, "0");
    let id = 1;
    const parent = {}, kids = []; let cmd = null;
    const mk = (e, n) => ({ Name: "Card", GMNotes: "testcard", Nickname: e.name, Description: "", CardID: n * 100,
      Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 } });
    for (const e of p.cards) for (let i = 0; i < (e.count || 1); i++) {
      const n = id++;
      const face = img[e.name] || img[e.name.split(" // ")[0]];
      if (!face) missing++;
      const cd = { FaceURL: face || BACK, BackURL: BACK, NumWidth: 1, NumHeight: 1, BackIsHidden: true, UniqueBack: false, Type: 0 };
      if (e.name === p.commander && !cmd) { cmd = { ...mk(e, n), CustomDeck: { [n]: cd } }; continue; }
      parent[n] = cd; kids.push(mk(e, n));
    }
    const kws = Object.values(p.keywords || {});
    const label = `Test ${nn}: ${p.label.replace(/^Hand-play /, "")}`;
    const deck = { Name: "Deck", GMNotes: "testcard", Nickname: `Test deck ${nn}`, Description: label,
      Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 },
      DeckIDs: kids.map((c) => c.CardID), CustomDeck: parent, ContainedObjects: kids };
    const kit = { Name: "Bag", GMNotes: "testkit", Nickname: label,
      Description: `${kids.length + 1} cards, commander ${p.commander}.\n${kws.length ? `Covers: ${[...new Set(kws)].join(", ")}` : ""}`,
      LuaScript: KIT_SCRIPT, ColorDiffuse: { r: 0.2, g: 0.45, b: 0.25 },
      Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }, ContainedObjects: [deck, cmd] };
    kits.push(kit);
    fs.writeFileSync(path.join(OUT, `kit-${nn}.lua`), `local bag
for _, o in ipairs(getObjects()) do if o.getGMNotes() == "handtest-bag" then bag = o end end
if bag == nil then return "no hand-test bag" end
local p = bag.getPosition()
spawnObjectData({ data = JSON.decode([==[${JSON.stringify(kit)}]==]), position = Vector(p.x, p.y + 4, p.z), callback_function = function(o) bag.putObject(o) end })
return "kit ${nn}"`);
  });
  fs.writeFileSync(path.join(OUT, "bag.lua"), `for _, o in ipairs(getObjects()) do if o.getGMNotes() == "handtest-bag" then return "already there" end end
spawnObjectData({ data = { Name = "Bag", GMNotes = "handtest-bag", Nickname = "Hand-test decks (40 cards)",
  Description = "Take a kit out, then press its Load into my seat button: the deck goes to your library spot, the commander to your command zone. Then READY and Start. Harmless AI: type  mtg aideck ai_passive_lands  before Start.",
  ColorDiffuse = { r = 0.85, g = 0.65, b = 0.15 }, Transform = { posX = 0, posY = 0, posZ = 0, rotX = 0, rotY = 0, rotZ = 0, scaleX = 1.4, scaleY = 1.4, scaleZ = 1.4 } },
  position = Vector(${BAG_AT.x}, ${BAG_AT.y}, ${BAG_AT.z}), callback_function = function(o) o.setLock(true) end })
return "bag"`);
  // The way to bring them in: a TTS Saved Object (Objects > Saved Objects), whose contents stay data until a kit is
  // taken out. (Spawning the 25 kits live loaded ~1,000 card pictures at once and TTS crashed: d3d11 887a0005.)
  const savedDir = path.join(process.env.USERPROFILE, "Documents", "My Games", "Tabletop Simulator", "Saves", "Saved Objects");
  fs.mkdirSync(savedDir, { recursive: true });
  const bag = { Name: "Bag", GMNotes: "handtest-bag", Nickname: "Hand-test decks (40 cards)",
    Description: "Take a kit out, then press its Load into my seat button: the deck goes to your library spot, the commander to your command zone. Then READY and Start. Harmless AI: type  mtg aideck ai_passive_lands  before Start.",
    ColorDiffuse: { r: 0.85, g: 0.65, b: 0.15 }, Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1.4, scaleY: 1.4, scaleZ: 1.4 }, ContainedObjects: kits };
  fs.writeFileSync(path.join(savedDir, "Hand-test decks (40 cards).json"), JSON.stringify({ SaveName: "Hand-test decks (40 cards)", GameMode: "", Gravity: 0.5, PlayArea: 0.5, Date: "", Table: "", Sky: "", Note: "", Rules: "", XmlUI: "", LuaScript: "", LuaScriptState: "", ObjectStates: [bag], TabStates: {}, VersionNumber: "" }, null, 1));
  console.log(`${all.length} kits, ${names.length} card names, ${missing} cards without a picture -> ${OUT}`);
})();
