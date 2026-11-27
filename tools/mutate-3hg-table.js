// Break-it for Three-Headed Giant on the table (tests/test_table_3hg.js): each mutation switches one piece of the
// table's 3HG code off (tools/engine-renderer.lua), runs the test, lists the checks that failed by name, then puts the
// file back and checks it by sha256. A mutation no check catches is printed as SURVIVED.
//   node tools/mutate-3hg-table.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_table_3hg.js"];
const R = "tools/engine-renderer.lua";

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["3hg not a mode", R, "or cmd == \"mode\" and rest == \"3hg\"", "or false"],
  ["3hg on any table", R, "  if isMode and rest == \"3hg\" then\n    if not engineSixSeats() then", "  if isMode and rest == \"3hg\" then\n    if false then"],
  ["engineSixSeats: any seat list", R, "return ENGINE_TABLE_SEATS ~= nil and #ENGINE_TABLE_SEATS == 6 end", "return ENGINE_TABLE_SEATS ~= nil end"],
  ["engineSixSeats: never", R, "return ENGINE_TABLE_SEATS ~= nil and #ENGINE_TABLE_SEATS == 6 end", "return false end"],
  ["the teams not the sides", R, "Green = 2, Blue = 2, Purple = 2 }", "Green = 1, Blue = 2, Purple = 2 }"],
  ["the teams not set", R, "    for c, n in pairs(ENGINE_3HG_TEAMS) do ENGINE_TEAMS[c] = n end\n", ""],
  ["the mode not kept", R, "    ENGINE_TEAM_MODE = \"3hg\"\n", ""],
  ["the help text dropped", R, "engineTeamsText() .. ENGINE_TEAM_HELP[\"3hg\"]", "engineTeamsText() .. \"\""],
  ["the teams text four seats", R, "ENGINE_TEAM_MODE == \"3hg\" and {", "false and {"],
  ["the label", R, "m == \"3hg\" and (ENGINE_TEAM_TURNS == \"shared\" and \"3HG team turns\" or \"3HG\") or \"None\"", "m == \"3hg\" and \"None\" or \"None\""],
  ["mtg team in 3hg allowed", R, "  if ENGINE_TEAM_MODE == \"3hg\" then pl.broadcast(\"[MTG] In Three-Headed Giant", "  if false then pl.broadcast(\"[MTG] In Three-Headed Giant"],
  ["the button never offers 3hg", R, "  if engineSixSeats() then\n    nextOf[", "  if false then\n    nextOf["],
  ["the button: 3hg loops", R, "    nextOf[\"3hg\"] = \"ffa\"\n", "    nextOf[\"3hg\"] = \"3hg\"\n"],
  ["the game-mode switch drops 3hg", R, "ENGINE_TEAM_GAME_MODE[\"3hg\"] = ENGINE_TEAM_MODE == \"3hg\" and mode or nil", "ENGINE_TEAM_GAME_MODE[\"3hg\"] = nil"],
  ["the switch's 3hg entry left behind", R, "  ENGINE_TEAM_GAME_MODE[\"3hg\"] = nil\n", ""],
  ["2v2 after 3hg keeps the sides", R, "ENGINE_TEAM_MODE == \"juggernaut\" or ENGINE_TEAM_MODE == \"3hg\" then ENGINE_TEAMS =", "ENGINE_TEAM_MODE == \"juggernaut\" or false then ENGINE_TEAMS ="],
];

function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
      if (m && !/^test_/.test(m[1])) failed.push(m[1].slice(0, 110));
    }
    if (r.status !== 0 && !failed.length) failed.push(`${t} exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  }
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null; // (a label pattern: just those mutations)
const base = runTests();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let survived = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`?? ${label}: the code to break is not there once`); survived++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTests(); } finally { fs.writeFileSync(file, text); }
  const ok = sha(file) === before;
  if (!failed.length) survived++;
  console.log(`${failed.length ? "caught" : "SURVIVED"}: ${label}${failed.length ? ` -> ${failed.join(" | ")}` : ""}${ok ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught, every file restored`);
process.exit(survived ? 1 : 0);
