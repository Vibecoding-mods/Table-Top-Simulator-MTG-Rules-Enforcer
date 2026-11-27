// Break-it for the prompt shapes (tests/test_bridge_prompt_shapes.js): each mutation switches one of this branch's bridge
// fixes off (a choice of players only, the engine's "Choose an opponent", the unless cost asked as itself, "name a card"),
// runs the test and requires the named check to fail; the file is put back and checked by sha256.
//   node tools/mutate-prompt-shapes.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const B = path.join(ROOT, "bridge", "bridge.js");
const TEST = path.join(ROOT, "tests", "test_bridge_prompt_shapes.js");
const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
// [label, from, to, check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["players only: not asked as players", "      if (words?.onlyPlayers && !/", "      if (false && words?.onlyPlayers && !/", "ChoosePlayer chooseFromSelection: the title"],
  ["players only: the list not read", "  if (words.includes(null) || (!cards && !players)) return null;", "  if (words.includes(null) || !cards) return null;", "ChoosePlayer chooseFromSelection: the title"],
  ["the engine's description not used", "const said = /^Choose an? (?:opponent|player)$/i.test(desc) ?", "const said = false ?", "ChoosePlayer chooseFromSelection: the title"],
  ["the chooser among them still an opponent", "${words.labels.includes(nameOf(seat.slot)) ? \"player\" : \"opponent\"}", "opponent", "ChoosePlayer, no description, the chooser among them: which player"],
  ["the cost's button says Pay", "        const ask = costWords ? costWords[1] : asked;", "        const ask = asked;", "GenericChoice chooseBoolean: the options"],
  ["the cost's question says pay", "        const askTitle = costWords ? costWords[1][0].toLowerCase() + costWords[1].slice(1) : asked;", "        const askTitle = asked;", "GenericChoice chooseBoolean: the title"],
  ["Name a card as Forge says it", " : title === \"Name a card\" ? \"name a card\" : title;", " : title;", "ChooseCardName chooseFromSelection: the title"],
];
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const run = () => {
  const r = spawnSync(process.execPath, [TEST], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  return `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5));
};
const base = run();
if (base.length) { console.log(`BASELINE FAILS: ${base.slice(0, 3).join(" | ")}`); process.exit(1); }
const orig = fs.readFileSync(B), h = sha(B), src = orig.toString("utf8");
let missed = 0, ran = 0;
for (const [label, from, to, want] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  ran++;
  if (src.split(from).length - 1 !== 1) { missed++; console.log(`NOT APPLIED ${label}`); continue; }
  let failed;
  try { fs.writeFileSync(B, src.replace(from, () => to)); failed = run(); }
  finally { fs.writeFileSync(B, orig); if (sha(B) !== h) { console.log("RESTORE FAILED"); process.exit(100); } }
  const hit = failed.some((f) => f.startsWith(`${want}:`));
  if (!hit) missed++;
  console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.map((f) => f.slice(0, 80)).join(" | ") || "nothing failed"}`);
}
console.log(`${ran - missed} of ${ran} caught by name; bridge.js restored by sha256`);
process.exit(missed);
