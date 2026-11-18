// Every command `mtg help` lists (tools/make-engine-copy.js, the "[MTG] Commands:" text) has a row in HOW-TO-PLAY.md's
// "Chat commands" table: one check per command word ("mtg planes", "mtg refresh"), named after it, so a command added
// to the help without a line in the guide fails by name.
//   node tests/test_howto_commands.js
// (HELP_SOURCE=<a copy of make-engine-copy.js> and HOWTO_PATH=<a copy of HOW-TO-PLAY.md> read copies:
// tools/mutate-howto-commands.js breaks one so a check fails by name.)
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const helpSource = fs.readFileSync(process.env.HELP_SOURCE || path.join(ROOT, "tools", "make-engine-copy.js"), "utf8");
const howTo = fs.readFileSync(process.env.HOWTO_PATH || path.join(ROOT, "HOW-TO-PLAY.md"), "utf8");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${why}` : ""}`); } };

// the help text: from "[MTG] Commands:" to the end of its list
const at = helpSource.indexOf("[MTG] Commands:");
const end = at < 0 ? -1 : helpSource.indexOf("].join", at);
const help = at < 0 || end < 0 ? "" : helpSource.slice(at, end);
const helpWords = [...new Set([...help.matchAll(/\bmtg ([a-z]+)/g)].map((m) => m[1]))].sort();
ok("precondition: the mtg help text found, with 30 or more commands", helpWords.length >= 30, `${helpWords.length}: ${helpWords.join(" ")}`);

// the guide's table: the rows of "## Chat commands" (lines starting "|"), the command cell only (the first column)
const section = (/## Chat commands\n([\s\S]*?)(?=\n## )/.exec(howTo) || [])[1] || "";
const rows = section.split("\n").filter((l) => /^\|\s*`/.test(l));
const tableWords = new Set();
for (const row of rows) {
  const cell = row.replace(/\\\|/g, "\u0000").split("|")[1] || "";
  for (const m of cell.matchAll(/`mtg ([a-z]+)/g)) tableWords.add(m[1]);
}
ok("precondition: HOW-TO-PLAY.md's Chat commands table found, with 30 or more rows", rows.length >= 30, `${rows.length} rows`);

for (const word of helpWords) {
  ok(`HOW-TO-PLAY's command table has mtg ${word}`, tableWords.has(word), `mtg help lists "mtg ${word}", the guide's table has no row for it`);
}
console.log(failed ? `${failed} failed (${passed} passed)` : `all ${passed} help command checks pass`);
process.exit(failed ? 1 : 0);
