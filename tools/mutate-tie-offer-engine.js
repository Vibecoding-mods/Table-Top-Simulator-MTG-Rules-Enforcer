// Break-it for the engine's tie offer (forge-harness TieOfferTest): each mutation switches one piece of TieOffer (or its
// hooks in the session, the protocol adapter and the snapshot) off, compiles only the edited file over the harness jar,
// runs the test class and requires the named check to fail; the file is put back and checked by sha256.
// Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-tie-offer-engine.js <engine tree> [label pattern]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const H = "forge-harness/src/main/java/forge/harness/host/";
const T = H + "TieOffer.java";
// [label, file (in the tree), from, to, check that must fail]
const MUTATIONS = [
  ["Player.cantLose not read", T, "        if (player.cantLose()) {\n", "        if (false) {\n", "lock: Platinum Angel is a lock (cantLose)"],
  ["canLoseLife not read", T, "        if (!player.canLoseLife()) {\n", "        if (false) {\n", "lock: Platinum Emperion is a lock (cantLoseLife)"],
  ["Phyrexian Unlife's poison threat ignored", T, " && !player.canReceiveCounters(CounterEnumType.POISON)\n", "\n", "lock: Phyrexian Unlife alone is no lock (poison)"],
  ["Unlife with Solemnity not a lock", T, "            out.add(\"cantLoseForZeroLife\");\n", "", "lock: Phyrexian Unlife with Solemnity is a lock"],
  ["commander damage threat ignored", T, "            if (other != player && !other.hasLost() && !other.getCommanders().isEmpty()) {", "            if (false) {", "lock: Unlife with Solemnity in Commander is no lock (commander damage)"],
  ["damage prevention not read", T, "        if (prevented) {\n            out.add(\"damagePrevented\");", "        if (false) {\n            out.add(\"damagePrevented\");", "lock: Glacial Chasm prevents all damage"],
  ["a conditional prevention counts", T, "                        && PLAIN_PREVENTION_PARAMS.containsAll(effect.getMapParams().keySet())\n", "\n", "lock: a conditional prevention is no lock"],
  ["the AI is asked too", T, "            if (human.test(seat)) {", "            if (true) {", "offer: the humans are asked, the AI accepts"],
  ["one accept is a draw", T, "            accepted.add(voter);\n            if (awaiting.isEmpty()) {", "            accepted.add(voter);\n            if (true) {", "offer: all accept is a draw"],
  ["a vote for another offer counts", T, "if (status != Status.PENDING || id != voteId || !awaiting.remove(voter)) {", "if (status != Status.PENDING || !awaiting.remove(voter)) {", "offer: a vote for an old offer is ignored"],
  ["the broken lock keeps the offer", T, "            if (status != Status.NONE) {\n                status = Status.NONE;\n                VIEWS.remove(game);\n            }\n", "", "offer: the lock breaking clears the offer"],
  ["four rounds to force", T, "static final int ROUNDS_TO_FORCE = 3;", "static final int ROUNDS_TO_FORCE = 4;", "forced: three rounds without progress after a decline"],
  ["no draw outcome (no intentional draw)", T, "            player.intentionalDraw();\n", "", "offer: all accept is a draw"],
  ["a life drop is no progress", T, "if (life.get(i) < before.life.get(i) || poison", "if (poison", "forced: a life drop restarts the count"],
  ["poison is no progress", T, " || poison.get(i) > before.poison.get(i)\n", "\n", "forced: poison restarts the count"],
  ["commander damage is no progress", T, "                        || commanderDamage.get(i) > before.commanderDamage.get(i)\n", "\n", "forced: commander damage restarts the count"],
  ["a permanent leaving is no progress", T, "                if (!battlefield.contains(id)) {", "                if (false) {", "forced: a permanent leaving restarts the count"],
  ["a mill is no progress", T, "                if (before.library.contains(id) && !before.graveyard.contains(id)) {", "                if (false) {", "forced: a mill restarts the count"],
  ["a loss is no progress", T, "                        || lost.get(i) && !before.lost.get(i)) {", "                        ) {", "forced: a loss restarts the count"],
  ["a life gain is progress", T, "if (life.get(i) < before.life.get(i) || poison", "if (!life.get(i).equals(before.life.get(i)) || poison", "forced: a life gain is no progress"],
  ["priority doesn't recheck", H + "ManaBrewInteractiveSession.java", "        tieOffer.update(this::votesOnTies);\n", "", "session: priority rechecks and the snapshot carries the offer"],
  ["the snapshot leaves the offer out", H + "InteractiveSnapshotExtractor.java", "            view.put(\"tieOffer\", tieOffer);\n", "", "session: priority rechecks and the snapshot carries the offer"],
  ["the session ignores tie votes", H + "ManaBrewInteractiveSession.java", "            if (\"tie_vote\".equals(kind)) {", "            if (\"tie_vote_off\".equals(kind)) {", "session: tieVote directives end the game in a draw"],
  ["the adapter reads tieVote as a rewind vote", H + "ManabrewProtocolAdapter.java", "                flat.addProperty(\"kind\", \"tie_vote\");", "                flat.addProperty(\"kind\", \"restore_vote\");", "session: tieVote directives end the game in a draw"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-tie-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
const runTest = (extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), "forge.harness.host.TieOfferTest"], { cwd: TREE, encoding: "utf8", timeout: 600000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith("FAIL TieOfferTest"));
  return lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`)) || l.slice(5, 80));
};
const base = runTest(null);
if (base.length) { console.log(`BASELINE FAILS: ${base.join(", ")}`); process.exit(1); }
let missed = 0, ran = 0;
try {
  MUTATIONS.forEach(([label, file, from, to, name], i) => {
    if (only && !only.test(label)) return;
    ran++;
    const f = path.join(TREE, file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8").replace(/\r\n/g, "\n");
    const crlf = orig.includes("\r\n");
    if (src.split(from).length - 1 !== 1) { missed++; console.log(`NOT APPLIED ${label}`); return; }
    const out = path.join(tmp, `m${i}`);
    fs.mkdirSync(out);
    let failed = null;
    try {
      const next = src.replace(from, to);
      fs.writeFileSync(f, crlf ? next.replace(/\n/g, "\r\n") : next);
      const c = javac(out, [f]);
      failed = c.status === 0 ? runTest(out) : [`COMPILE ERROR ${c.stderr.split("\n")[0]}`];
    } finally {
      fs.writeFileSync(f, orig);
      if (sha(f) !== h) { console.log(`RESTORE FAILED: ${file}`); process.exit(100); }
    }
    const hit = failed.includes(name);
    if (!hit) missed++;
    console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.join(" | ") || "nothing failed"}`);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`${ran - missed} of ${ran} caught by name; files restored by sha256`);
process.exit(missed);
