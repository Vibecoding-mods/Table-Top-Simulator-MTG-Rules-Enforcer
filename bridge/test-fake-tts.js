// Headless integration test for bridge.js: run  node bridge.js --tts-in 48998 --tts-out 48999  then  node test-fake-tts.js
// Stand-in for TTS: listens on 39999 like TTS, drives bridge.js like the Lua board would,
// and answers every prompt the way a careless player would (first option / minimum picks).
const net = require("net");
const send = (cm) => { const c = net.connect(48998, "127.0.0.1", () => c.end(JSON.stringify({ messageID: 4, customMessage: cm }))); };
const stats = { views: 0, prompts: {}, chats: [], lastView: null };
const seen = new Set();
net.createServer((s) => { let b = ""; s.on("data", (d) => (b += d)); s.on("end", () => {
  let m = JSON.parse(b).customMessage; if (typeof m.json === "string") m = JSON.parse(m.json);
  if (m.t === "view") { stats.views++; stats.lastView = m.view; if (m.view.turn > 8) done(); }
  else if (m.t === "chat") { stats.chats.push(m.text); console.log("chat:", m.text); }
  else if (m.t === "prompt" && m.promptId != null) {
    stats.prompts[m.title.split(":")[0].slice(0, 30)] = (stats.prompts[m.title.split(":")[0].slice(0, 30)] || 0) + 1;
    if (!seen.has(m.mode)) { seen.add(m.mode); console.log("first", m.mode, "prompt:", JSON.stringify(m).slice(0, 300)); }
    let choice;
    if (m.mode === "single") choice = [m.options[Math.random() < 0.5 && m.options.length > 1 ? 1 : 0].id];
    else if (m.mode === "multi") choice = m.options.slice(0, m.min).map((o) => o.id);
    else if (m.mode === "number") choice = [m.min];
    setTimeout(() => send({ t: "answer", color: m.color, promptId: m.promptId, choice: choice.length ? choice : {} }), 5);
  }
}); }).listen(48999, "127.0.0.1", () => { send({ t: "hello" }); setTimeout(() => send({ t: "start", seats: ["White"], bots: 1 }), 300); });
function done() {
  if (stats.done) return; stats.done = true;
  console.log("\nviews received:", stats.views, "\nprompt titles:", stats.prompts);
  const v = stats.lastView; console.log("last view: turn", v.turn, v.step, "players:", v.players.map((p) => `${p.name} life ${p.life} perms ${p.permanents.length} lands ${p.lands.join("/")}`).join(" | "), "\nhand:", v.hand.join(", "));
  send({ t: "reset" }); setTimeout(() => process.exit(0), 15000);
}
setTimeout(() => { console.log("timeout"); done(); }, 240000);
