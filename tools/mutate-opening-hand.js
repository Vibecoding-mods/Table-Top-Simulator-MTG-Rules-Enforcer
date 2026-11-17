// Break-it for the picked opening hand (engine1122-openinghand): Forge's GameAction.stackOpeningCards and
// RegisteredPlayer, the harness's openingCards (ManaBrewEngineAdapter), the node's gameConfig field (java_backend.rs),
// and the bridge's gameConfig and mulligan question (startConfig, openingCardsConfig, handPrompt). Each mutation
// switches one piece off and requires the named check to fail, then puts the file back and checks it by sha256:
//  - bridge/bridge.js: changed in place for a run of tests/test_bridge_opening_hand.js;
//  - Java (in the engine tree): only the edited file compiled over the harness jar, then forge-harness OpeningHandTest;
//  - Rust (in the engine tree): cargo test of the node's gameConfig tests.
// Needs a patched engine tree with its jar (engine/test-harness-local.sh builds both) and cargo.
//   node tools/mutate-opening-hand.js <engine tree> [label pattern]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TREE = path.resolve(process.argv[2] || path.join(os.homedir(), "engine"));
const only = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const GA = "forge/forge-game/src/main/java/forge/game/GameAction.java";
const AD = "forge-harness/src/main/java/forge/harness/host/ManaBrewEngineAdapter.java";
const RS = "manabrew-rs/crates/self-hosted-node/src/engine_backend/java_backend.rs";
const BR = "bridge/bridge.js";
const JS = "tests/test_bridge_opening_hand.js";
const RUST_TEST = "a_game_config_seat_gives_its_player_opening_cards";
// [label, file, from, to, check that must fail]: a bridge file is in this repo, the others in the engine tree
const MUTATIONS = [
  ["forge: not stacked", GA, "                stackOpeningCards(p1);\n", "", "thePickedCardsAreTheHandAtTheMulliganQuestion"],
  ["forge: stacked at the bottom", GA, "        top.addAll(rest);\n        library.setCards(top);", "        rest.addAll(top);\n        library.setCards(rest);", "thePickedCardsAreTheHandAtTheMulliganQuestion"],
  ["forge: the deck's own copy never taken", GA, "                if (c.getName().equals(name)) {", "                if (false) {", "aPickedCardTheDeckHasIsItsOwnAndOneItHasntIsCreated"],
  ["forge: names past the hand used", GA, "            if (top.size() >= p.getStartingHandSize()) {\n                break;\n            }\n", "", "moreNamesThanTheHandTakesOnlyTheFirst"],
  ["harness: not read from the start", AD, ".withOpeningCards(optionalStrings(playerObject, \"openingCards\")));", ".withOpeningCards(List.of()));", "theStartRequestCarriesEachPlayersOpeningCards"],
  ["harness: every seat gets a Mountain", AD, ".withOpeningCards(optionalStrings(playerObject, \"openingCards\")));", ".withOpeningCards(List.of(\"Mountain\")));", "theOtherSeatIsDealtAsUsual"],
  ["harness: not given to Forge", AD, "        registeredPlayer.setOpeningCards(playerConfig.getOpeningCards());\n", "", "theStartRequestCarriesEachPlayersOpeningCards"],
  ["node: not copied from the gameConfig", RS, "            player.opening_cards = seat.opening_cards.iter().map(|name| java_card_name(name)).collect();\n", "", RUST_TEST],
  ["node: an empty list sent", RS, "    #[serde(skip_serializing_if = \"Vec::is_empty\")]\n    opening_cards: Vec<String>,", "    opening_cards: Vec<String>,", RUST_TEST],
  ["bridge: no openingCards in the gameConfig", BR, "  return Object.entries(game?.handPick || {}).map(", "  return Object.entries({}).map(", "start: the gameConfig names Blue's picked cards for the engine to deal"],
  ["bridge: no gameConfig for a picked hand alone", BR, "  if (idx < 0 && !opening.length) return null;", "  if (idx < 0) return null;", "start: the gameConfig names Blue's picked cards for the engine to deal"],
  ["bridge: the first player's gameConfig without them", BR, "  return { type: \"gameConfig\", ...(idx >= 0 ? { firstPlayer: idx } : {}), players: opening };", "  return { type: \"gameConfig\", ...(idx >= 0 ? { firstPlayer: idx } : {}), players: idx >= 0 ? [] : opening };", "start with a first player too: both in the one gameConfig"],
  ["bridge: teams without them", BR, "      if (p) p.openingCards = o.openingCards; else cfg.players.push(o);", "      if (p) p.openingCards = undefined;", "teams: the openingCards on Blue's own team entry, no entry added"],
  ["bridge: teams add an entry", BR, "      if (p) p.openingCards = o.openingCards; else cfg.players.push(o);", "      cfg.players.push(o);", "teams: the openingCards on Blue's own team entry, no entry added"],
  ["bridge: a dealt hand answered for the player", BR, "  if (type === \"mulligan\" && !handOps(h.names, seat.color, gv).length) {", "  if (false) {", "dealt: the mulligan question is Blue's, not answered for them"],
  ["bridge: a dealt hand not said", BR, "    chat(`[MTG] ${poss(seat.color)} picked hand was dealt as the opening hand: keep it or take a mulligan as usual.`);\n", "", "dealt: said"],
  ["bridge: a dealt hand's pick kept", BR, "    delete game.handPick[seat.color];\n    chat(`[MTG] ${poss(seat.color)} picked hand was dealt as the opening hand", "    chat(`[MTG] ${poss(seat.color)} picked hand was dealt as the opening hand", "dealt: the pick is used up"],
  ["bridge: every hand taken as dealt", BR, "  if (type === \"mulligan\" && !handOps(h.names, seat.color, gv).length) {", "  if (type === \"mulligan\") {", "not dealt: kept by itself, as before"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const where = (file) => (file === BR ? path.join(ROOT, file) : path.join(TREE, file));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-openinghand-"));
const tests = path.join(tmp, "test");
fs.mkdirSync(tests);
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else if (f.endsWith(".java")) out.push(f); } return out; };
const javac = (out, files) => spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", out, "-cp", JAR, ...files], { encoding: "utf8" });
if (javac(tests, walk(path.join(TREE, "forge-harness", "src", "test", "java"))).status !== 0) { console.log("the tests don't compile"); process.exit(1); }
const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
const named = (lines) => lines.map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`) || l === `FAIL ${n}`) || l.slice(5, 90));
const runJava = (extra) => {
  const r = spawnSync("java", ["-cp", [extra, tests, JAR].filter(Boolean).join(path.delimiter), "forge.harness.host.OpeningHandTest"], { cwd: TREE, encoding: "utf8", timeout: 900000 });
  return named(`${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith("FAIL OpeningHandTest")));
};
const runJs = () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, JS)], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
  const lines = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.startsWith("FAIL "));
  return r.status !== 0 && !lines.length ? [`exit ${r.status}`] : named(lines);
};
const runRust = () => {
  const r = spawnSync("cargo", ["test", "-q", "-p", "self-hosted-node", "--lib", "game_config"], { cwd: path.join(TREE, "manabrew-rs"), encoding: "utf8", timeout: 1800000 });
  const out = `${r.stdout}${r.stderr}`;
  if (/error(\[E\d+\])?:/.test(out) && r.status !== 0 && !/test result/.test(out)) return [`COMPILE ERROR ${out.split("\n").find((l) => /error/.test(l))}`];
  return NAMES.filter((n) => new RegExp(`${n} \\.\\.\\. FAILED|---- .*${n} stdout ----|${n}' panicked|${n}\\b.*FAILED`).test(out));
};
for (const [what, base] of [["OpeningHandTest", runJava(null)], [JS, runJs()], ["the node's gameConfig tests", runRust()]]) {
  if (base.length) { console.log(`BASELINE FAILS (${what}): ${base.join(", ")}`); process.exit(1); }
}
let missed = 0, ran = 0;
try {
  MUTATIONS.forEach(([label, file, from, to, name], i) => {
    if (only && !only.test(label)) return;
    ran++;
    const f = where(file), orig = fs.readFileSync(f), h = sha(f), src = orig.toString("utf8").replace(/\r\n/g, "\n");
    const crlf = orig.includes("\r\n");
    if (src.split(from).length - 1 !== 1) { missed++; console.log(`NOT APPLIED ${label}`); return; }
    let failed = null;
    try {
      const next = src.replace(from, () => to);
      fs.writeFileSync(f, crlf ? next.replace(/\n/g, "\r\n") : next);
      if (file === BR) failed = runJs();
      else if (file === RS) failed = runRust();
      else {
        const out = path.join(tmp, `m${i}`);
        fs.mkdirSync(out);
        const c = javac(out, [f]);
        failed = c.status === 0 ? runJava(out) : [`COMPILE ERROR ${c.stderr.split("\n")[0]}`];
      }
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
