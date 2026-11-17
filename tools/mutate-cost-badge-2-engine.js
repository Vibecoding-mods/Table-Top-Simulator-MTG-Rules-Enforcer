// Break-it for the engine's cost badge, phase 2 (forge-harness CostBadgeTest): each mutation switches one piece of
// PlayCost (or its hook in the snapshot) off, compiles only the edited file over the harness jar, runs the test class
// and requires the named check to fail; the file is put back and checked by sha256.
// Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both).
//   node tools/mutate-cost-badge-2-engine.js <engine tree> [label pattern]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const H = "forge-harness/src/main/java/forge/harness/host/";
const P = H + "PlayCost.java";
const X = H + "InteractiveSnapshotExtractor.java";
// [label, file (in the tree), from, to, check that must fail]
const MUTATIONS = [
  ["a permission to cast is ignored", P, "                } else if (paidPermission) {", "                } else if (false) {", "may play: a permission to cast from the graveyard, the card's own cost"],
  ["the alternative costs aren't listed", P, "for (final SpellAbility alt : GameActionUtil.getAlternativeCosts(base, viewer, false)) {", "for (final SpellAbility alt : new ArrayList<SpellAbility>()) {", "flashback: the flashback cost from the graveyard"],
  ["the way isn't named", P, "mode = alt.name().toLowerCase(Locale.ROOT);", "mode = \"alternative\";", "flashback: the flashback cost from the graveyard"],
  ["a foretold card read face down", P, "card.getState(CardStateName.Original) : card.getCurrentState()", "card.getCurrentState() : card.getCurrentState()", "foretell: the foretell cost from exile"],
  ["the foretold card's printed cost not sent", X, "dto.playCostPrinted = play.pick.printed.equals(cardPrinted) ? null : play.pick.printed;", "dto.playCostPrinted = null;", "foretell: the foretell cost from exile"],
  ["raises not applied", P, "final Cost adjusted = CostAdjustment.adjust(sa.getPayCosts().copy(), sa, false);", "final Cost adjusted = sa.getPayCosts().copy();", "flashback: Thalia's tax on it"],
  ["reductions not applied", P, "            if (choosesToReduce(sa)) {", "            if (true) {", "reduced: Goblin Electromancer on a flashback cost"],
  ["reductions not applied to a hand cost", P, "            if (choosesToReduce(sa)) {", "            if (true) {", "reduced: Goblin Electromancer on a hand cost"],
  ["a reduction to nothing not read as {0} (hand)", X, "? (printed.isEmpty() || printed.equals(\"no cost\") ? null : \"{0}\") : effective", "? null : effective", "zero: a hand cost reduced to nothing reads {0}"],
  ["no cost not read as {0} (play cost)", P, "return s.isEmpty() || s.equals(\"no cost\") ? \"{0}\" : s;", "return s;", "plot: a plotted card is free"],
  ["assist not guarded", P, "Keyword.ASSIST, Keyword.DELVE, Keyword.CONVOKE", "Keyword.DELVE, Keyword.CONVOKE", "assist: an assist card in hand is priced with no question asked"],
  ["every seat's view priced", X, "if (dto.mayPlay && viewerPlayer != null && !card.isInZone(ZoneType.Hand)) {", "if (viewerPlayer != null && !card.isInZone(ZoneType.Hand)) {", "none: another player's view of my graveyard"],
  ["split cards keep one badge", X, "        if (card.isLand() || card.isSplitCard()) {", "        if (card.isLand()) {", "split: an untaxed split card in hand sends nothing"],
  ["the halves not sent", X, "            dto.spellCosts = PlayCost.halves(card, card.getController());\n", "", "split: a taxed split card in hand has no one badge, and each half is priced"],
  ["the adventure not read", P, "            if (card.isAdventureCard()) {\n                spells.addAll(card.getState(CardStateName.Secondary).getSpellAbilities());", "            if (false) {\n                spells.addAll(card.getState(CardStateName.Secondary).getSpellAbilities());", "adventure: the adventure is priced beside the creature"],
  ["the half's state not taken for its pricing", P, "            if (flip) {\n                host.setState(want, false);", "            if (false) {\n                host.setState(want, false);", "adventure: the adventure is priced beside the creature"],
  ["the card's state not put back", P, "            if (flip) {\n                host.setState(was, false);\n            }\n", "", "adventure: the card is back in its own state after the pricing"],
  ["a fuse card's whole taken as a half", P, "        return !(card.isSplitCard() && sa.getCardState() != null && sa.getCardState().getStateName() == CardStateName.Original);", "        return true;", "split: a fuse card's whole is not a half"],
  ["the first way, not the cheapest", P, "                if (w.mana.getCMC() < pick.mana.getCMC()) {", "                if (false) {", "cheapest: of a permission and flashback, the cheaper way, the other listed"],
  ["the other ways not sent", X, "                    dto.playCostOthers = others;\n", "", "halves: a permission on a split card names the half and lists the other"],
  ["aftermath not priced", P, "                    mode = sa.isAftermath() ? \"aftermath\" : \"cast\";", "                    mode = null;", "aftermath: the graveyard half, against its own printed cost"],
  ["the half not named", X, "                dto.playCostName = card.isSplitCard() || card.isAdventureCard() ? play.pick.name : null;\n", "", "aftermath: the graveyard half, against its own printed cost"],
  ["a half against the whole card's printed cost", P, "                final String printed = halves ? text(sa.getCardState().getManaCost()) : cardPrinted;", "                final String printed = cardPrinted;", "halves: a permission on a split card names the half and lists the other"],
  ["the cost not sent", X, "                dto.playCost = play.pick.cost();\n", "", "escape: the escape cost"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-cost2-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
const runTest = (extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), "forge.harness.host.CostBadgeTest"], { cwd: TREE, encoding: "utf8", timeout: 600000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith("FAIL CostBadgeTest"));
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
