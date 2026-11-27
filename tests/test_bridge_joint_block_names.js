// jointBlockLines colours a player's name ("Yellow's Wall of Wood") in their seat colour: a name that is the end of another
// player's name ("Joe" in "Big Joe's Wall") is not coloured there (2026-11-27). Pure function: no TTS, no ports.
//   node tests/test_bridge_joint_block_names.js
const teams = require("../bridge/teams");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 300)}` : ""}\n`); } };
const P = [{ name: "Joe", color: "Yellow" }, { name: "Big Joe", color: "Red" }];
const one = (line, players = P) => teams.jointBlockLines([line], players)[0];
ok("a name is coloured in its seat's colour", one("Joe's Wall -> your Bear") === `<color=${teams.SEAT_HEX.Yellow}>Joe's</color> Wall → your Bear`, one("Joe's Wall -> your Bear"));
ok("the longer name wins over its ending", one("Big Joe's Wall -> your Bear") === `<color=${teams.SEAT_HEX.Red}>Big Joe's</color> Wall → your Bear`, one("Big Joe's Wall -> your Bear"));
ok("both on one line", one("Joe's Wall, Big Joe's Ox") === `<color=${teams.SEAT_HEX.Yellow}>Joe's</color> Wall, <color=${teams.SEAT_HEX.Red}>Big Joe's</color> Ox`, one("Joe's Wall, Big Joe's Ox"));
ok("a word that merely ends in a name is left alone", one("Bigjoe's Wall", [{ name: "joe", color: "Blue" }]) === "Bigjoe's Wall", one("Bigjoe's Wall", [{ name: "joe", color: "Blue" }]));
ok("plain lines (colored false) get no colour", teams.jointBlockLines(["Joe's Wall -> x"], P, false)[0] === "Joe's Wall → x");
process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} joint block name checks pass\n`);
process.exit(failed ? 1 : 0);
