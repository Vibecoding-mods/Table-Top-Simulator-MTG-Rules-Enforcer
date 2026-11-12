// Builds bridge/forge-planes.json: every plane and phenomenon Forge knows, for "mtg planes random" and the names a
// player types (docs/planechase-dungeon-engine-spec.md P1). Reads the card scripts inside the running engine
// container, as build-forge-card-index.js does, or a local Forge checkout's cardsfolder with --dir.
//   node tools/build-forge-plane-list.js [container]
//   node tools/build-forge-plane-list.js --dir <forge>/forge-gui/res/cardsfolder
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const at = process.argv.indexOf("--dir");
const SCRIPT = `grep -rlE '^Types:(Plane|Phenomenon)( |$)' --include='*.txt' . | xargs awk 'FNR==1{if(n)print t "\\t" n; n=""; t=""} /^Name:/{sub(/^Name:/,""); sub(/\\r$/,""); n=$0} /^Types:/{sub(/^Types:/,""); sub(/\\r$/,""); t=$0} END{if(n)print t "\\t" n}'`;
const raw = at > 0
  ? execFileSync("sh", ["-c", SCRIPT], { cwd: process.argv[at + 1], maxBuffer: 16 * 1024 * 1024, encoding: "utf8" })
  : execFileSync("docker", ["exec", process.argv[2] || "stack-forge-room-1", "sh", "-c", `cd /build/forge/forge-gui/res/cardsfolder && ${SCRIPT}`],
    { maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
const planes = new Set(), phenomena = new Set();
for (const line of raw.split("\n")) {
  const [types, name] = line.split("\t");
  if (!name) continue;
  if (/^Phenomenon\b/.test(types)) phenomena.add(name.trim());
  else if (/^Plane\b/.test(types)) planes.add(name.trim());
}
const out = path.join(__dirname, "..", "bridge", "forge-planes.json");
const sorted = (s) => [...s].sort((a, b) => a.localeCompare(b));
fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), planes: sorted(planes), phenomena: sorted(phenomena) }, null, 1) + "\n");
console.log(`${planes.size} planes, ${phenomena.size} phenomena -> ${out}`);
