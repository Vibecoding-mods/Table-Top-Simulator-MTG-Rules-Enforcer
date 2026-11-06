// Static scan of the table's Global Lua (as built into the save) for names used before a `local` of the same name
// is declared further down. Lua resolves such a use to a GLOBAL of that name, usually nil: the "Don't block with
// this" menu called `unblock` that way and would have failed (fixed 2026-10-20). Also lists globals that are read
// but never assigned anywhere (typos, removed functions).
//   node tools/lua-scan.js [save.json | file.lua]
const fs = require("fs");
const path = require("path");
const luaparse = require(path.join(__dirname, "..", "tests", "lua", "node_modules", "luaparse"));

// (the default is the save tools/deploy.js writes, "Mock MTGA 4 player"; the old ENGINE MODE save was deleted)
const arg = process.argv[2] || require("./patch-save").SAVE;
const src = arg.endsWith(".json") ? JSON.parse(fs.readFileSync(arg, "utf8")).LuaScript : fs.readFileSync(arg, "utf8");

// TTS API and Lua standard names that are globals by design
const KNOWN = new Set(("_G _VERSION assert error getmetatable ipairs next pairs pcall print rawequal rawget rawlen rawset require select " +
  "setmetatable tonumber tostring type xpcall unpack load loadstring math string table coroutine os bit32 utf8 " +
  "self Global UI Player Wait Turns Time Color Vector JSON Physics Notes Timer Info Lighting Hands Grid Tables Backgrounds " +
  "MusicPlayer WebRequest broadcastToAll broadcastToColor printToAll printToColor getObjectFromGUID getObjects getAllObjects " +
  "spawnObject spawnObjectJSON spawnObjectData getSeatedPlayers getObjectsWithTag getObjectsWithAnyTags getObjectsWithAllTags " +
  "log logStyle logString sendExternalMessage startLuaCoroutine destroyObject flipTable copy paste group addContextMenuItem " +
  "clearContextMenu addHotkey showHotkeyConfig getNotebookTabs addNotebookTab editNotebookTab removeNotebookTab " +
  "getDeckFromZone onLoad onSave onUpdate onFixedUpdate onExternalMessage onObjectDrop onObjectPickUp onPlayerAction " +
  "onObjectEnterContainer onObjectLeaveContainer onObjectSpawn onObjectDestroy onChat onPlayerChangeColor onScriptingButtonDown " +
  "onObjectEnterZone onObjectLeaveZone onObjectHover onPlayerTurn onBlindfold setLookingForPlayers getLookingForPlayers " +
  "stringColorToRGB lua").split(/\s+/));

const ast = luaparse.parse(src, { scope: true, locations: true, ranges: false, luaVersion: "5.2", comments: false });

const localDecl = new Map(); // name -> [line of each `local name` / `local function name`]
const globalSet = new Set(); // names assigned as globals somewhere
const globalReads = [];      // { name, line }
// only file-level locals: a `local` inside some other function can't be what an earlier function meant
const addLocal = (name, line) => (localDecl.get(name) || localDecl.set(name, []).get(name)).push(line);
for (const st of ast.body) {
  if (st.type === "LocalStatement") for (const v of st.variables) addLocal(v.name, v.loc.start.line);
  if (st.type === "FunctionDeclaration" && st.isLocal && st.identifier) addLocal(st.identifier.name, st.identifier.loc.start.line);
}
function walk(n, parentKey) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach((x) => walk(x, parentKey)); return; }
  if (n.type === "TableKeyString") { walk(n.value, "value"); return; } // {deck = nil}: "deck" is a key, not a name
  if (n.type === "FunctionDeclaration" && !n.isLocal && n.identifier && n.identifier.type === "Identifier" && !n.identifier.isLocal) globalSet.add(n.identifier.name);
  if (n.type === "AssignmentStatement") for (const v of n.variables) if (v.type === "Identifier" && !v.isLocal) globalSet.add(v.name);
  if (n.type === "Identifier" && !n.isLocal && parentKey !== "variables" && parentKey !== "identifier") globalReads.push({ name: n.name, line: n.loc.start.line });
  for (const [k, v] of Object.entries(n)) if (k !== "loc" && v && typeof v === "object") walk(v, k);
}
walk(ast.body);

const lines = src.split("\n");
const forward = globalReads.filter((r) => (localDecl.get(r.name) || []).some((l) => l > r.line) && !(localDecl.get(r.name) || []).some((l) => l < r.line) && !globalSet.has(r.name));
const unassigned = [...new Set(globalReads.filter((r) => !globalSet.has(r.name) && !KNOWN.has(r.name) && !localDecl.has(r.name)).map((r) => r.name))];
// a forward use is only a bug when nothing assigns that name as a global either
console.log(`Global script: ${lines.length} lines, ${localDecl.size} local names, ${globalSet.size} globals assigned`);
console.log(`\nUsed before a later \`local\` of the same name (resolves to a global, usually nil): ${forward.length}`);
for (const r of forward) console.log(`  line ${r.line}: ${r.name}  (local declared at line ${localDecl.get(r.name).join(", ")})  | ${lines[r.line - 1].trim().slice(0, 110)}`);
console.log(`\nGlobals read but never assigned anywhere (not TTS/Lua built-ins): ${unassigned.length}`);
for (const name of unassigned) {
  const first = globalReads.find((r) => r.name === name);
  console.log(`  ${name}  first read at line ${first.line}: ${lines[first.line - 1].trim().slice(0, 100)}`);
}
process.exitCode = forward.length ? 1 : 0;
