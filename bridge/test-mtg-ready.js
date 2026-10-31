// Headless test of "mtg ready": run  node bridge.js --tts-in 48998 --tts-out 48999  then  node test-mtg-ready.js
// Headless test of "mtg ready": sends decks the way the table's Global does, then starts a game with one.
const net = require("net");
const send = (cm) => { const c = net.connect(48998, "127.0.0.1", () => c.end(JSON.stringify({ messageID: 4, customMessage: cm }))); };
const preset = require("./presets").readPreset("neheb_minotaur_commander");
const img = (i) => ({ f: `https://img.klrmngr.com/large/front/a/b/${i}.jpg`, b: "https://steamusercontent-a.akamaihd.net/ugc/back/" });
const lib = [];
for (const e of preset.cards) if (e.name !== preset.commander) for (let k = 0; k < (e.count || 1); k++) lib.push({ n: `${e.name}`, ...img(lib.length) });
const good = { deckName: "Test Player", library: lib, commander: [{ n: "Neheb, the Worthy", ...img("cmd") }] };
const bad = { deckName: "Broken", library: [...lib.slice(0, 50), { n: "Fire", ...img("x") }, { n: "Totally Fake Card" }, { n: "Lightning Bolt" }, { n: "Lightning Bolt" }], commander: {} };
net.createServer((s) => { let b = ""; s.on("data", (d) => (b += d)); s.on("end", () => {
  let m = JSON.parse(b).customMessage; if (typeof m.json === "string") m = JSON.parse(m.json);
  if (m.t === "chat") console.log("CHAT>", m.color ? `(${m.color})` : "", m.text);
  if (m.t === "deckReport") console.log("REPORT>", JSON.stringify(m));
  if (m.t === "view" && !global.v) { global.v = 1; console.log("VIEW> game running, turn", m.view.turn, "| our command zone:", m.view.players.find((p) => p.you).command.join(", ")); setTimeout(() => { send({ t: "reset" }); setTimeout(() => process.exit(0), 14000); }, 500); }
}); }).listen(48999, "127.0.0.1", () => {
  send({ t: "hello" });
  setTimeout(() => send({ t: "decks", request: 1, seats: { White: good, Red: bad } }), 400);
  setTimeout(() => send({ t: "start", seats: ["White"], bots: 1 }), 1500);
});
setTimeout(() => { console.log("timeout"); process.exit(1); }, 90000);
