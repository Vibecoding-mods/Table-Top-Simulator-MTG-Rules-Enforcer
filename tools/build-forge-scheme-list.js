// Builds bridge/forge-schemes.json: every scheme Forge knows (Types:Scheme and Types:Ongoing Scheme), for "mtg schemes
// random" and the names an Archenemy types (docs/team-turns-archenemy-plan.md §2.7). Reads the card scripts inside the
// running engine container, as build-forge-plane-list.js does, or a local Forge checkout's cardsfolder with --dir.
//   node tools/build-forge-scheme-list.js [container]
//   node tools/build-forge-scheme-list.js --dir <forge>/forge-gui/res/cardsfolder
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const at = process.argv.indexOf("--dir");
const SCRIPT = `grep -rlE '^Types:(Ongoing )?Scheme( |$)' --include='*.txt' . | xargs awk 'FNR==1{if(n)print t "\\t" n; n=""; t=""} /^Name:/{sub(/^Name:/,""); sub(/\\r$/,""); n=$0} /^Types:/{sub(/^Types:/,""); sub(/\\r$/,""); t=$0} END{if(n)print t "\\t" n}'`;
const raw = at > 0
  ? execFileSync("sh", ["-c", SCRIPT], { cwd: process.argv[at + 1], maxBuffer: 16 * 1024 * 1024, encoding: "utf8" })
  : execFileSync("docker", ["exec", process.argv[2] || "stack-forge-room-1", "sh", "-c", `cd /build/forge/forge-gui/res/cardsfolder && ${SCRIPT}`],
    { maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
const schemes = new Set(), ongoing = new Set();
for (const line of raw.split("\n")) {
  const [types, name] = line.split("\t");
  if (!name) continue;
  if (/^Ongoing Scheme\b/.test(types)) ongoing.add(name.trim());
  else if (/^Scheme\b/.test(types)) schemes.add(name.trim());
}
const out = path.join(__dirname, "..", "bridge", "forge-schemes.json");
const sorted = (s) => [...s].sort((a, b) => a.localeCompare(b));
fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), schemes: sorted(schemes), ongoing: sorted(ongoing) }, null, 1) + "\n");
console.log(`${schemes.size} schemes, ${ongoing.size} ongoing schemes -> ${out}`);
