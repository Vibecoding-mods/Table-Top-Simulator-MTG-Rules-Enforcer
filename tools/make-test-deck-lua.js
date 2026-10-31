// Builds a Lua snippet that spawns one of Manabrew's preset Commander decks on White's side in the Card
// Importer's real format (pictures stored on the deck), deals 7 to White's hand and puts the commander on
// the command zone. For automated testing only.   node make-test-deck-lua.js <presetId> <out.lua>
const fs = require("fs"), path = require("path");
const [id, out] = process.argv.slice(2);
const p = id.endsWith(".json") ? require(path.resolve(id)) : require(require("../bridge/presets").presetFile(id));
const BACK = "https://steamusercontent-a.akamaihd.net/ugc/1647720103762682461/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/";
(async () => {
  const names = [...new Set(p.cards.map((e) => e.name))];
  const img = {};
  for (let i = 0; i < names.length; i += 75) {
    const r = await fetch("https://api.scryfall.com/cards/collection", { method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "mtg-tts-bridge/0.1" },
      body: JSON.stringify({ identifiers: names.slice(i, i + 75).map((name) => ({ name })) }) }).then((r) => r.json());
    for (const c of r.data || []) {
      const f = c.id ? `https://img.klrmngr.com/display/front/${c.id[0]}/${c.id[1]}/${c.id}.webp` : "";
      img[c.name] = f; if (c.card_faces) img[c.card_faces[0].name] = f;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const parent = {}, kids = []; let k = 1, cmd = null;
  const mk = (e, n) => ({ Name: "Card", GMNotes: "testcard", Nickname: `${e.name}\n${(e.types || []).join(" ")}\n${e.cmc || 0}CMC`, Description: e.text || "", CardID: n * 100,
    Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 } });
  for (const e of p.cards) for (let i = 0; i < (e.count || 1); i++) {
    const n = k++;
    const cd = { FaceURL: img[e.name] || BACK, BackURL: BACK, NumWidth: 1, NumHeight: 1, BackIsHidden: true, UniqueBack: false, Type: 0 };
    if (e.name === p.commander && !cmd) { cmd = { ...mk(e, n), CustomDeck: { [n]: cd } }; continue; }
    parent[n] = cd; kids.push(mk(e, n));
  }
  const deck = { Name: "Deck", GMNotes: "testcard", Nickname: "Test Player", Description: `test import: ${p.label}`, Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 },
    DeckIDs: kids.map((c) => c.CardID), CustomDeck: parent, ContainedObjects: kids };
  fs.writeFileSync(out, `local deck = JSON.decode([==[${JSON.stringify(deck)}]==])
local cmd = JSON.decode([==[${JSON.stringify(cmd)}]==])
local lib = data.White.libraryZone.getPosition()
local label = getObjectFromGUID("908f60").getPosition()
-- never spawn onto the player's own cards: TTS would merge the test deck/commander into them
for _, o in ipairs(getObjects()) do
  if o.type == "Card" or o.type == "Deck" then
    local gm, p = tostring(o.getGMNotes()), o.getPosition()
    if gm ~= "testcard" and not gm:find("^engine") and gm ~= "libcard" and p.y > -3 then
      for _, s in ipairs({ lib, label }) do
        if math.abs(p.x - s.x) < 3 and math.abs(p.z - s.z) < 3 then return "STOP: the player's " .. o.type .. " '" .. o.getName():gsub("\\n.*", "") .. "' is on a test spawn spot" end
      end
    end
  end
end
spawnObjectData({ data = deck, position = Vector(lib.x, 1.6, lib.z), rotation = Vector(0, 180, 180), callback_function = function(o) Wait.time(function() o.deal(7, "White") end, 1.5) end })
spawnObjectData({ data = cmd, position = Vector(label.x, 1.6, label.z), rotation = Vector(0, 180, 0) })
return "spawned ${p.label}: " .. #deck.ContainedObjects .. " cards + commander"`);
  console.log(`${id}: ${kids.length} cards, ${Object.keys(img).length}/${names.length} images → ${out}`);
})();
