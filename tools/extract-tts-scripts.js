// Extracts every Lua script and UI XML from a TTS save/workshop JSON into separate files.
//   node extract-tts-scripts.js <save.json> <outDir>
const fs = require("fs"), path = require("path");
const [src, out] = process.argv.slice(2);
const save = JSON.parse(fs.readFileSync(src, "utf8"));
fs.mkdirSync(out, { recursive: true });
const index = [];
const safe = (s) => (s || "unnamed").replace(/[^\w.-]+/g, "_").slice(0, 60);
const groups = new Map(); // script hash → objects sharing it
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }
function visit(o, parent) {
  const name = o.Nickname || o.Name;
  const lua = o.LuaScript || "";
  const xml = o.XmlUI || "";
  if (lua.trim() || xml.trim()) {
    const key = hash(lua + "\u0000" + xml);
    if (!groups.has(key)) groups.set(key, { lua, xml, objects: [] });
    groups.get(key).objects.push({ guid: o.GUID, name, type: o.Name, parent, desc: (o.Description || "").slice(0, 80) });
  }
  for (const c of o.ContainedObjects || []) visit(c, o.GUID);
  for (const s of Object.values(o.States || {})) visit(s, o.GUID);
}
fs.writeFileSync(path.join(out, "_Global.lua"), save.LuaScript || "");
fs.writeFileSync(path.join(out, "_Global.xml"), save.XmlUI || "");
for (const o of save.ObjectStates || []) visit(o, null);
for (const [key, g] of groups) {
  const first = g.objects[0];
  const base = `${safe(first.name)}__${first.guid}`;
  if (g.lua.trim()) fs.writeFileSync(path.join(out, base + ".lua"), g.lua);
  if (g.xml.trim()) fs.writeFileSync(path.join(out, base + ".xml"), g.xml);
  index.push({ file: base, luaLines: g.lua.split("\n").length, xmlLines: g.xml ? g.xml.split("\n").length : 0, copies: g.objects.length, objects: g.objects.slice(0, 6) });
}
index.sort((a, b) => b.luaLines - a.luaLines);
fs.writeFileSync(path.join(out, "_index.json"), JSON.stringify({ saveName: save.SaveName, globalLuaLines: (save.LuaScript || "").split("\n").length, totalObjects: (save.ObjectStates || []).length, scripts: index }, null, 1));
console.log(`save "${save.SaveName}": ${save.ObjectStates.length} top-level objects, global lua ${(save.LuaScript||"").split("\n").length} lines, ${index.length} unique scripts`);
for (const s of index) console.log(String(s.luaLines).padStart(6), "lua", String(s.xmlLines).padStart(4), "xml", `x${s.copies}`.padStart(4), s.file);
