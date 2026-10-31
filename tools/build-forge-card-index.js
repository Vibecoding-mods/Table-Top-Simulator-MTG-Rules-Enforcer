// Builds bridge/forge-cards.json: every card name Forge knows, so `mtg ready` can check decks before a game.
// Reads the card scripts inside the running engine container (rerun after updating the Manabrew image).
//   node build-forge-card-index.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CONTAINER = process.argv[2] || "stack-forge-room-1";
const DIR = "/build/forge/forge-gui/res/cardsfolder";
// One line per card script: "<split 0|1>\t<face name>\t<face name>..."
const awk = `FNR==1{if(n)print s "\\t" out; n=0; out=""; s=0}
/^Name:/{sub(/^Name:/,""); sub(/\\r$/,""); out=out (n?"\\t":"") $0; n++}
/^AlternateMode:[ ]*Split/{s=1}
END{if(n)print s "\\t" out}`;
const raw = execFileSync("docker", ["exec", CONTAINER, "sh", "-c",
  `cd ${DIR} && find . -name '*.txt' -print0 | xargs -0 awk '${awk.replace(/'/g, "'\\''")}'`],
  { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });

// Same normalisation the bridge applies to names read from TTS cards.
const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'")
  .replace(/\s+/g, " ").trim().toLowerCase();

const index = {}; // normalised name (any face, or "A // B") → name to send the engine
let cards = 0;
for (const line of raw.split("\n")) {
  if (!line.trim()) continue;
  const [split, ...faces] = line.split("\t").filter((x, i) => i === 0 || x);
  if (!faces.length) continue;
  cards++;
  // Forge finds split cards by their full name and double-faced/adventure cards by the front face.
  const canonical = split === "1" && faces.length > 1 ? faces.join(" // ") : faces[0];
  for (const key of [canonical, faces.join(" // "), ...faces]) {
    const k = norm(key);
    if (!(k in index) || key === faces[0]) index[k] = canonical; // a front-face name wins over a back face elsewhere
  }
}
const out = path.join(__dirname, "..", "bridge", "forge-cards.json");
fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), cards, index }));
console.log(`${cards} cards, ${Object.keys(index).length} lookup names → ${out}`);
