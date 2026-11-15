// Break-it for the engine1116-teams per-player rules (forge-harness PlayerRulesTest): each mutation breaks one piece in a
// throwaway copy of forge-harness/src (a Forge class is copied in under src/main/java, where harness-tests.sh compiles
// it ahead of the jar, so the mutated Forge class wins), runs PlayerRulesTest in mtg-harness-test:<tag>, and lists the
// checks that failed by name. The real tree is never written; its files are checked by sha256 before and after.
//   node engine/checks/mutate-player-rules.js <engine tree> [tag]      (tag default engine1116-teams)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const tree = process.argv[2];
const tag = process.argv[3] || "engine1116-teams";
if (!tree) { console.error("usage: node engine/checks/mutate-player-rules.js <engine tree> [tag]"); process.exit(2); }
const harness = path.join(tree, "forge-harness");
const game = path.join(tree, "forge/forge-game/src/main/java");
const ai = path.join(tree, "forge/forge-ai/src/main/java");
const script = path.join(__dirname, "harness-tests.sh");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

// [label, source root, path under that root, from, to]: `from` must occur exactly once
const H = "src/main/java/forge/harness/host/";
const MUTATIONS = [
  ["Forge: the named first player ignored", game, "forge/game/GameAction.java", "if (named >= 0 && named < game.getPlayers().size()) {", "if (false) {"],
  ["Forge: ExtraTurn$ False read as True", game, "forge/game/replacement/ReplaceBeginTurn.java", "!= \"True\".equalsIgnoreCase(getParam(\"ExtraTurn\"))", "!= true"],
  ["Forge: a player's own commander limit ignored", game, "forge/game/player/Player.java", "return rp != null && rp.getCommanderDamageToLose() > 0 ? rp.getCommanderDamageToLose() : game.getRules().getCommanderDamageToLose();", "return game.getRules().getCommanderDamageToLose();"],
  ["Perks: no triggers", harness, H + "Perks.java", "card.addTrigger(TriggerHandler.parseTrigger(rest, card, true));", ""],
  ["Perks: no statics", harness, H + "Perks.java", "card.addStaticAbility(StaticAbility.create(rest, card, card.getCurrentState(), true));", ""],
  ["Perks: no replacements", harness, H + "Perks.java", "card.addReplacementEffect(ReplacementHandler.parseReplacement(rest, card, true));", ""],
  ["Perks: an ordinary card, not an effect", harness, H + "Perks.java", "card.setGamePieceType(GamePieceType.EFFECT);", ""],
  ["Perks: any line accepted", harness, H + "Perks.java", "if (line == null || kind(line) == null) {", "if (line == null) {"],
  ["adapter: nobody goes first", harness, H + "ManaBrewEngineAdapter.java", "rules.setStartingPlayer(first);", ""],
  ["adapter: two first players allowed", harness, H + "ManaBrewEngineAdapter.java", "throw new IllegalArgumentException(\"only one player can go first\");", "first = first;"],
  ["adapter: a player's commander limit dropped", harness, H + "ManaBrewEngineAdapter.java", "registeredPlayer.setCommanderDamageToLose(playerConfig.getCommanderDamageToLose());", ""],
  ["adapter: a zero commander limit allowed", harness, H + "ManaBrewEngineAdapter.java", "throw new IllegalArgumentException(\"commanderDamageToLose must be positive: \" + seat.getName());", "seat.getName();"],
];

const watched = [...new Set(MUTATIONS.map(([, root, rel]) => path.join(root, rel)))];
const before = Object.fromEntries(watched.map((f) => [f, sha(f)]));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-player-rules-"));

function runCopy(mutate) {
  const src = path.join(work, "src");
  fs.rmSync(src, { recursive: true, force: true });
  fs.cpSync(path.join(harness, "src"), src, { recursive: true });
  if (mutate) mutate(src);
  const r = spawnSync("docker", ["run", "--rm", "-v", `${work.replace(/\\/g, "/")}:/src:ro`, "-v", `${script.replace(/\\/g, "/")}:/harness-tests.sh:ro`,
    "--entrypoint", "sh", `mtg-harness-test:${tag}`, "/harness-tests.sh", "PlayerRulesTest"], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, timeout: 900000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").map((l) => l.match(/^FAIL (\w+):/)).filter(Boolean).map((m) => m[1]).filter((n) => n !== "PlayerRulesTest");
  if (r.status !== 0 && !failed.length) failed.push(`no check by name (exit ${r.status}): ${out.split("\n").filter((l) => /error|FAIL/.test(l)).slice(0, 3).join(" ").slice(0, 200)}`);
  return failed;
}

let survived = 0;
const base = runCopy(null);
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
for (const [label, root, rel, from, to] of MUTATIONS) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  if (text.split(from).length !== 2) { console.log(`?? ${label}: the code to break is not there once`); survived++; continue; }
  const failed = runCopy((src) => {
    const dest = root === harness ? path.join(src, "..", rel) : path.join(src, "main/java", rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text.replace(from, () => to));
  });
  const caught = failed.length && !failed[0].startsWith("no check by name");
  if (!caught) survived++;
  console.log(`${caught ? "caught" : "SURVIVED"}: ${label}${failed.length ? ` -> ${failed.join(" | ")}` : ""}`);
}
fs.rmSync(work, { recursive: true, force: true });
const moved = watched.filter((f) => sha(f) !== before[f]);
console.log(moved.length ? `TREE CHANGED: ${moved.join(", ")}` : "the engine tree is unchanged (sha256)");
console.log(survived ? `${survived} of ${MUTATIONS.length} survived` : `all ${MUTATIONS.length} caught`);
process.exit(survived || moved.length ? 1 : 0);
