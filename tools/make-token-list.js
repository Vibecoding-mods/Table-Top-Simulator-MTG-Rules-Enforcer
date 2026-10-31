// Writes bridge/token-scripts.json: the names of Forge's token scripts (forge-gui/res/tokenscripts), which the
// manual fix (M7) turns a typed token ("treasure", "1/1 green saproling") into. Run again after a Forge update.
//   node tools/make-token-list.js [path to tokenscripts]
const fs = require("fs");
const path = require("path");
const dir = process.argv[2] || path.join(__dirname, "..", "manabrew", "forge", "forge-gui", "res", "tokenscripts");
const names = fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, -4)).sort();
const out = path.join(__dirname, "..", "bridge", "token-scripts.json");
fs.writeFileSync(out, JSON.stringify(names));
console.log(`${names.length} token scripts -> ${out}`);
