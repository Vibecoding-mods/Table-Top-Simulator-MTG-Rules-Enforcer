// Break-it for a player's own card pictures following the player (tests/test_bridge_art_owner.js): each mutation
// switches one piece off (bridge/bridge.js noteSeatSteam / artKeyOf / playerArtOf / onArtSet / the start's Steam IDs,
// tools/make-engine-copy.js's artset), runs the test and requires the named check to fail, then puts the file back and
// checks it by sha256.
//   node tools/mutate-art-owner.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TEST = "tests/test_bridge_art_owner.js";
const B = "bridge/bridge.js", C = "tools/make-engine-copy.js";

// [label, file, from, to, check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["kept by colour again (the lookup)", B, "  const a = playerArt[artKeyOf(color)];\n", "  const a = playerArt[`seat:${color}`];\n", "the player at another colour: her tokens there wear it"],
  ["kept by colour again (the setting)", B, "  const a = (playerArt[artKeyOf(color)] ??= {", "  const a = (playerArt[`seat:${color}`] ??= {", "another player at the colour: his tokens don't wear the last player's picture"],
  ["who typed it not noted", B, "  noteSeatSteam(color, m.steam); // (who typed it", "  // (who typed it", "another player at the colour: his list is empty"],
  ["the start's Steam IDs not noted", B, "      for (const [c, id] of Object.entries(steamIds(m.steam))) noteSeatSteam(c, id);\n", "\n", "start: Blue is Ben's now, and Anne's picture isn't on Blue's tokens"],
  ["the colour's pictures not given to the first player seen", B, "  if (playerArt[seatKey]) { playerArt[`steam:${steam}`] ??= playerArt[seatKey]; delete playerArt[seatKey]; }\n", "", "no Steam ID: the first Steam ID seen at the colour is taken as the same player's, and keeps them"],
  ["the colour's player not kept", B, "  seatSteam[color] = String(steam);\n", "", "the player at another colour: her tokens there wear it"],
  ["a bad Steam ID taken", B, "  if (!color || !accomplishLib.steamKey(steam)) return;\n  // (pictures kept", "  if (!color || !steam) return;\n  // (pictures kept", "not a Steam ID: the pictures stay the colour's, and go with the first real one seen there"],
  ["the table sends no Steam ID", C, "engineSend(\"artset\", { color = pl.color, steam = pl.steam_id, text", "engineSend(\"artset\", { color = pl.color, text", "table: mtg art token and back carry the player's Steam ID"],
];

const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
function runTest() {
  const r = spawnSync(process.execPath, [TEST], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`) || l === `FAIL ${n}`) || l.slice(5, 90));
  if (r.status !== 0 && !failed.length) failed.push(`exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const base = runTest();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let missed = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to, name] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`NOT APPLIED ${label}: the code to break is not there once`); missed++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTest(); } finally { fs.writeFileSync(file, text); }
  if (sha(file) !== before) { console.log(`RESTORE FAILED: ${rel}`); process.exit(100); }
  const hit = failed.includes(name);
  if (!hit) missed++;
  console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.slice(0, 3).join(" | ") || "nothing failed"}`);
}
console.log(`${list.length - missed} of ${list.length} caught by name; files restored by sha256`);
process.exit(missed ? 1 : 0);
