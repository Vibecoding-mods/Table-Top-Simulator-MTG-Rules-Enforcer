// Break-it for the guide's command table (tests/test_howto_commands.js): each mutation changes a COPY of
// HOW-TO-PLAY.md (through HOWTO_PATH) or of tools/make-engine-copy.js (through HELP_SOURCE), runs the test and requires
// the named check to fail. The real files are never written: their sha256 is checked before and after, and the copies
// are removed.
//   node tools/mutate-howto-commands.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const HOWTO = path.join(ROOT, "HOW-TO-PLAY.md");
const HELP = path.join(ROOT, "tools", "make-engine-copy.js");
const TEST = path.join(ROOT, "tests", "test_howto_commands.js");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-howto-"));
// [label, "howto" | "help", from (a regular expression, must match once), to, the check that must fail]
const MUTATIONS = [
  ["the mtg planes row gone", "howto", /^\| `mtg planes random[^\n]*\n/m, "", "HOW-TO-PLAY's command table has mtg planes"],
  ["the mtg refresh row gone", "howto", /^\| `mtg refresh`[^\n]*\n/m, "", "HOW-TO-PLAY's command table has mtg refresh"],
  ["mtg ai only in the row's text, not its command cell", "howto", /^\| `mtg ai <colour> harmless\\\|forge \[deck\]` \/ `mtg ai <colour> off` \|/m, "| the empty seats' players: mtg ai |", "HOW-TO-PLAY's command table has mtg ai"],
  ["mtg stop only in the prose above the table", "howto", /^\| `mtg stop`[^\n]*\n/m, "", "HOW-TO-PLAY's command table has mtg stop"],
  ["a command added to mtg help without a row", "help", /" mtg refresh - /, "\" mtg zebra - a new command\",\n      \" mtg refresh - ", "HOW-TO-PLAY's command table has mtg zebra"],
  ["the help text not found", "help", /\[MTG\] Commands:/, "[MTG] Command list:", "precondition: the mtg help text found, with 30 or more commands"],
  ["the table not found", "howto", /^## Chat commands$/m, "## Commands", "precondition: HOW-TO-PLAY.md's Chat commands table found, with 30 or more rows"],
];
const pristine = { howto: sha(HOWTO), help: sha(HELP) };
const check = () => { if (sha(HOWTO) !== pristine.howto || sha(HELP) !== pristine.help) { console.log("REAL FILE CHANGED"); process.exit(100); } };
const run = (env) => {
  const r = spawnSync(process.execPath, [TEST], { encoding: "utf8", env: { ...process.env, ...env } });
  return String(r.stdout).split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5));
};
const base = run({});
if (base.length) { console.log(`BASELINE FAILS: ${base.join(" | ")}`); process.exit(1); }
let caught = 0, missed = 0;
try {
  MUTATIONS.forEach(([label, which, from, to, name], i) => {
    const file = which === "howto" ? HOWTO : HELP;
    const src = fs.readFileSync(file, "utf8");
    const hits = src.match(new RegExp(from.source, from.flags.includes("g") ? from.flags : from.flags + "g")) || [];
    if (hits.length !== 1) { missed++; console.log(`NOT APPLIED (${hits.length} matches) ${label}`); return; }
    const copy = path.join(tmp, `m${i}-${path.basename(file)}`);
    fs.writeFileSync(copy, src.replace(from, () => to));
    const failed = run(which === "howto" ? { HOWTO_PATH: copy } : { HELP_SOURCE: copy });
    check();
    const short = failed.map((l) => l.slice(0, 90));
    if (failed.some((l) => l === name || l.startsWith(`${name}: `))) { caught++; console.log(`caught   ${label}: ${short.slice(0, 3).join(" | ")}${short.length > 3 ? ` (+${short.length - 3})` : ""}`); }
    else { missed++; console.log(`MISSED   ${label}: ${short.join(" | ") || "nothing failed"}`); }
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); check(); }
console.log(`${caught} of ${caught + missed} caught by name; the real files unchanged (sha256), the copies removed`);
process.exit(missed ? 1 : 0);
