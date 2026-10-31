// A gap-filling hand-test kit: the keywords a deck's first hand test never reached (docs/HAND-TEST-HPnn.md, "Not
// tested"), with tutors to reach them, 40 cards. Reads tmp/handplay/gap-NN.json (the hp-NN.json shape: commander, cards,
// keywords) and writes tmp/kit-gapNN-direct.lua, which spawns that one kit and loads it into White's seat (one kit's 40
// pictures; never all kits at once, see tools/make-handtest-kits.js). The deck is named "Test deck ...": the table's
// loader (engineLoadTestKit) tells the deck from the commander by that name.
//   node tools/make-gap-kit.js 04     then   tools/tts-exec.sh tmp/kit-gap04-direct.lua
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const BACK = "https://steamusercontent-a.akamaihd.net/ugc/1647720103762682461/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/";
const KIT_SCRIPT = `function onLoad()
  self.createButton({ click_function = "loadKit", function_owner = self, label = "Load into my seat", position = { 0, 1.2, 1.6 },
    rotation = { 0, 180, 0 }, width = 1700, height = 420, font_size = 200, color = { 0.18, 0.45, 0.22 }, font_color = { 1, 1, 1 }, tooltip = "" })
end
function loadKit(obj, color) Global.call("engineLoadTestKit", { guid = self.getGUID(), color = color }) end`;
const nn = String(process.argv[2] || "").padStart(2, "0");
const p = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "handplay", `gap-${nn}.json`), "utf8"));
const total = p.cards.reduce((a, e) => a + (e.count || 1), 0);
if (total !== 40) { console.log(`gap-${nn}: ${total} cards, not 40`); process.exit(1); }
(async () => {
  const names = [...new Set(p.cards.map((e) => e.name))];
  const img = {};
  for (let i = 0; i < names.length; i += 75) {
    const r = await fetch("https://api.scryfall.com/cards/collection", { method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "mtg-tts-bridge/0.1" },
      body: JSON.stringify({ identifiers: names.slice(i, i + 75).map((name) => ({ name: name.split(" // ")[0] })) }) }).then((r) => r.json());
    for (const c of r.data || []) {
      const f = c.id ? `https://img.klrmngr.com/display/front/${c.id[0]}/${c.id[1]}/${c.id}.webp` : "";
      img[c.name] = f; img[c.name.split(" // ")[0]] = f;
    }
  }
  let id = 1;
  const cmds = [], cmdNames = p.commanders || [p.commander];
  const parent = {}, kids = [], missing = [];
  const mk = (e, n) => ({ Name: "Card", GMNotes: "testcard", Nickname: e.name, Description: "", CardID: n * 100,
    Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 } });
  for (const e of p.cards) for (let i = 0; i < (e.count || 1); i++) {
    const n = id++;
    const face = img[e.name] || img[e.name.split(" // ")[0]];
    if (!face && !missing.includes(e.name)) missing.push(e.name);
    const cd = { FaceURL: face || BACK, BackURL: BACK, NumWidth: 1, NumHeight: 1, BackIsHidden: true, UniqueBack: false, Type: 0 };
    if (cmdNames.includes(e.name) && !cmds.some((c) => c.Nickname === e.name)) { cmds.push({ ...mk(e, n), CustomDeck: { [n]: cd } }); continue; }
    parent[n] = cd; kids.push(mk(e, n));
  }
  const label = `Gap ${nn}: ${p.label}`;
  const deck = { Name: "Deck", GMNotes: "testcard", Nickname: `Test deck gap-${nn}`, Description: label,
    Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 },
    DeckIDs: kids.map((c) => c.CardID), CustomDeck: parent, ContainedObjects: kids };
  const kws = [...new Set(Object.values(p.keywords || {}))];
  const kit = { Name: "Bag", GMNotes: "testkit", Nickname: label, Description: `${kids.length + cmds.length} cards, commander ${cmdNames.join(" + ")}.\nCovers: ${kws.join(", ")}`,
    LuaScript: KIT_SCRIPT, ColorDiffuse: { r: 0.2, g: 0.45, b: 0.25 },
    Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }, ContainedObjects: [deck, ...cmds] };
  fs.writeFileSync(path.join(ROOT, "tmp", `kit-gap${nn}-direct.lua`), `local p = Vector(4, 2, -28)
spawnObjectData({ data = JSON.decode([==[${JSON.stringify(kit)}]==]), position = Vector(p.x, p.y + 4, p.z), callback_function = function(o) Wait.frames(function() Global.call("engineLoadTestKit", { guid = o.getGUID(), color = "White" }) end, 30) end })
return "gap kit ${nn}"
`);
  console.log(`${label}: ${kids.length + cmds.length} cards${missing.length ? `; no picture: ${missing.join(", ")}` : ""}${p.ai ? `; AI deck: ${p.ai}` : ""}`);
})();
