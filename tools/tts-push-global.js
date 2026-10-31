// Pushes the engine copy's Global script into the game open in TTS (External Editor "Save & Play").
// Object scripts are left as they are, unless --patched (every script make-engine-copy.js patched) or --objects=a,b.
// TTS reloads the game afterwards.
//
// DANGER: "Save & Play" reloads the table from its last saved/loaded state. Anything added since then (decks a
// player imported, cards they moved) is LOST. On 2026-10-18 this wiped the user's imported deck and commander.
// So this tool first asks TTS (debug channel) for cards and decks that are neither engine cards nor test cards,
// and refuses to push while any exist. Ask the player to save the table first (or let them finish), then use
// --force only once they confirm their things are in the saved file.
const fs = require("fs"), net = require("net"), path = require("path"), http = require("http");
const args = process.argv.slice(2);
const force = args.includes("--force");
const file = args.find((a) => !a.startsWith("--")) || path.join(process.env.USERPROFILE, "Documents", "My Games", "Tabletop Simulator", "Saves", "MTG 4 player table - ENGINE MODE.json");

const CHECK = `
local mine = {}
for _, o in ipairs(getObjects()) do
  if o.type == "Card" or o.type == "Deck" then
    local gm = tostring(o.getGMNotes())
    if not gm:find("^engine:") and gm ~= "testcard" and gm ~= "libcard" then
      mine[#mine + 1] = o.type .. " '" .. tostring(o.getName()):gsub("\\n.*", "") .. "'" .. (o.type == "Deck" and (" (" .. o.getQuantity() .. " cards)") or "")
    end
  end
end
return table.concat(mine, "; ")`;

function checkTable() {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: 48787, path: "/exec", method: "POST" }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({ error: "bad reply" }); } });
    });
    req.on("error", (e) => resolve({ error: e.message }));
    req.end(CHECK);
  });
}

(async () => {
  if (!force) {
    const r = await checkTable();
    if (r.error || r.timeout) {
      console.error(`Not pushed: couldn't check the table first (${r.error || "timeout"}). Use --force only if nobody has anything on it.`);
      process.exit(2);
    }
    if (r.value) {
      console.error(`Not pushed: the table has the player's own things, which a reload would wipe:\n  ${r.value}\nAsk them to save the table (or wait until they are done), then rerun with --force.`);
      process.exit(3);
    }
  }
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  const msg = { messageID: 1, scriptStates: [{ name: "Global", guid: "-1", script: s.LuaScript, ui: s.XmlUI || "" }] };
  // --objects a,b,c: those objects' scripts too, from the same file (an object-script patch, e.g. the life counters'
  // engineLifeChange: the player's own save keeps the scripts it was saved with)
  const objArg = args.find((a) => a.startsWith("--objects="));
  const all = [];
  const walk = (l) => { for (const o of l || []) { all.push(o); walk(o.ContainedObjects); } };
  walk(s.ObjectStates);
  // --patched: every object script make-engine-copy.js patched ("-- [engine copy]"). Save & Play first saves the live
  // table over its save, so a patch made after the table was loaded never reached it (the hand counters, hp-07 #29
  // re-test 2026-10-27).
  // (top-level objects only: a contained card's guid can match a live object's; each guid once, suite review)
  if (args.includes("--patched")) {
    for (const o of s.ObjectStates) if (String(o.LuaScript || "").includes("-- [engine copy]")) msg.scriptStates.push({ name: o.Nickname || o.Name, guid: o.GUID, script: o.LuaScript, ui: o.XmlUI || "" });
  }
  if (objArg) {
    const want = new Set(objArg.slice(10).split(",").filter(Boolean));
    for (const o of all) if (want.has(o.GUID) && !msg.scriptStates.some((x) => x.guid === o.GUID)) { msg.scriptStates.push({ name: o.Nickname || o.Name, guid: o.GUID, script: o.LuaScript || "", ui: o.XmlUI || "" }); want.delete(o.GUID); }
    if (want.size) { console.error(`Not pushed: not in ${file}: ${[...want].join(", ")}`); process.exit(4); }
  }
  const c = net.connect(39999, "127.0.0.1", () => c.end(JSON.stringify(msg)));
  c.on("close", () => console.log(`pushed Global (${s.LuaScript.length} chars)${msg.scriptStates.length > 1 ? ` and ${msg.scriptStates.length - 1} object script(s)` : ""}`));
  c.on("error", (e) => { console.error("TTS not reachable:", e.message); process.exit(1); });
})();
