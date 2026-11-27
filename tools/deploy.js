// One command that moves the bridge, the table script and the engine together, and records what went out, so the bridge
// can warn when they drift apart (bridge/versions.js). It stops at the first thing that fails, and nothing runs during a
// game. Up to the engine swap nothing has moved. A failure after that leaves the record as it was, so /versions says
// what is out of step; the save is written last, and a dry run of it comes first.
//   node tools/deploy.js                 the bridge and the table, the engine as it is
//   node tools/deploy.js --engine-tests  the same, with the engine's Java tests run too (always run with --image)
//   node tools/deploy.js --image exile2  and the engine: live-tested, retagged, its containers recreated
// MTG_MANABREW names the engine's source tree going out (tmp/eb-1128, relative to the repo): its harness's Java tests
// run before anything moves (engine/checks/harness-tests.sh, every class), and a test class left out of that script's
// list stops it.
// TTS must be closed for the table: it would save over the patched file.
const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const versions = require("../bridge/versions");
const { ttsRunning, main: patchSave } = require("./patch-save");
const { engineBuildId } = require("./engine-build-id");

const ROOT = path.join(__dirname, "..");
const GATES = ["test_bridge_golden", "test_bridge_events", "test_bridge_claims", "test_bridge_debug", "test_bridge_planar", "test_bridge_standard", "test_bridge_formats", "test_bridge_ai_tools", "test_state_delta", "test_table_map", "test_alignment", "test_table_check", "test_table_claims", "test_table_golden", "test_table_kind_relation", "test_table_board_diff", "test_table_effects", "test_table_dungeon", "test_engine_json", "test_table_fix_hand", "test_open_items_relations", "test_fix_hand_relations", "test_editor_forward", "test_moonsharp_patterns", "test_moonsharp_loop_locals", "test_card_other_side", "test_foreign_names", "test_bridge_custom_art", "test_table_standard", "test_table_clear_deck", "test_table_promote", "test_table_flip_guard", "test_bridge_gifs", "test_table_gifs", "test_bridge_hand", "test_table_hand_chat", "test_table_floating_mana", "test_table_mana_counters", "test_bridge_teams", "test_table_teams", "test_table_team_looks", "test_bridge_lag", "test_bridge_team_modes", "test_table_lag", "test_table_team_modes", "test_deckcheck", "test_bridge_2hg_level2", "test_table_2hg_level2", "test_bridge_2hg_team_block", "test_table_2hg_team_block", "test_bridge_repeat_yesno", "test_table_repeat_yesno", "test_table_deckcheck", "test_table_rik_deckcheck", "test_bridge_trigger_groups", "test_table_trigger_groups", "test_table_profile", "test_table_seats", "test_table_six", "test_bridge_rejoin", "test_rejoin_prompt", "test_bridge_3hg", "test_table_3hg", "test_bridge_archenemy", "test_bridge_big_turns", "test_table_archenemy_lua", "test_table_shared_turn", "test_bridge_stress_caps", "test_table_stress_caps", "test_bridge_repeat_loop", "test_table_repeat_loop", "test_bridge_attack_tax_lethal", "test_bridge_stack_split", "test_bridge_attack_lines", "test_table_attack_lines", "test_ui_budget", "test_bridge_tie_offer", "test_table_tie_offer", "test_bridge_unbounded_tokens", "test_bridge_loop_quiet", "test_table_loop_quiet", "test_table_token_entries", "test_bridge_custom_art_2", "test_table_archenemy_view", "test_table_inf_glyph", "test_bridge_treachery_first", "test_bridge_match_bo3", "test_bridge_stress_catalog2", "test_table_stress_catalog2_lua", "test_bridge_cost_badge_2", "test_bridge_art_owner", "test_bridge_cost_badge_3", "test_bridge_cost_badge_4", "test_engine_build_record", "test_bridge_six_golden", "test_table_golden_six", "test_companion_own_server", "test_bridge_ability_sweep2", "test_bridge_bo3_extras", "test_table_bo3_extras_lua", "test_bridge_archenemy_resume", "test_bridge_planar_order", "test_bridge_planar_owners", "test_bridge_bo3_roll_choice", "test_bridge_opening_hand", "test_bridge_prompt_shapes", "test_howto_commands", "test_table_live_check_1", "test_bridge_scenario_checks", "test_bridge_team_life_log", "test_bridge_archenemy_team_turns", "test_table_extra_turns_lua", "test_bridge_3hg_team_block", "test_bridge_sideboard_imported", "test_table_sideboard_imported", "test_bridge_library_order", "test_bridge_mairsil_answers", "test_table_mairsil_answers", "test_bridge_mairsil_look", "test_table_mairsil_look", "test_bridge_mairsil_text", "test_table_mairsil_text", "test_bridge_sac_x_mana", "test_bridge_legality", "test_bridge_legality_refresh", "test_table_formats", "test_bridge_tax_auto", "test_bridge_unless_team", "test_table_tax_auto", "test_bridge_hand_land_question", "test_bridge_trigger_loop", "test_bridge_exile_link", "test_bridge_3hg_turns", "test_table_team_turns", "test_bridge_attack_split", "test_table_attack_split", "test_bridge_fixops_keys", "test_bridge_joint_block_names", "test_bridge_loss_reasons", "test_bridge_token_runs_fresh", "test_bridge_why_target_union"];
// the tools' own tests and the packages friends get (kept apart from the line above, one name a line, sorted)
GATES.push(
  "test_accomplishments_golden",
  "test_companion_node",
  "test_companion_page",
  "test_companion_server",
  "test_deploy",
  "test_editor_forward_golden",
  "test_friend_package",
  "test_friend_package_unix",
  "test_gif_key_file",
  "test_gifs_golden",
  "test_home_paths",
  "test_mutate_table_anchors",
  "test_patch_save_write",
  "test_publish_release",
  "test_state_delta_golden",
  "test_table_golden_gaps",
  "test_teams_golden",
  "test_tts_push_global",
  "test_tts_sim_contract",
  "test_versions_golden",
);
// Every tests/test_*.js is a gate above or here, with why it isn't one (tests/test_alignment.js "deploy: no gate left out")
const NOT_GATES = {
  // about 5 minutes, and it builds companion\bin\MTG Companion.exe with csc when stale; the Windows companion isn't
  // what a deploy moves (it ships in a release): run it before tools/make-friend-package.js --release
  test_companion_update: "slow (about 5 min) and builds the companion exe; run before a release",
};
const LIVE_TESTS = ["tests/live_phasing_check.js", "tests/live_events_check.js"];
const HARNESS_SCRIPT = path.join(ROOT, "engine", "checks", "harness-tests.sh");
const HARNESS_TIMEOUT_MS = 90 * 60 * 1000; // (53 classes, each up to 15 min by the script's own limit; about 20 min seen)
// a stop is an error: main's caller prints it ("deploy stopped: ...") and exits 1
const stop = (why) => { throw new Error(why); };
// (only a line saying it passed counts: an empty log, a crash or a test that never ran isn't a pass)
const livePassed = (log) => /^PASSED:/m.test(log);

// The test classes harness-tests.sh runs with no class named: the names after its `set --`, up to the list's end
function harnessDefaults(script) {
  const m = /\[ \$# -gt 0 \] \|\| set -- ((?:[^\n]*\\\r?\n)*[^\n]*)/.exec(script);
  if (!m) return null;
  return m[1].replace(/\\\r?\n/g, " ").trim().split(/\s+/).filter(Boolean);
}
// The *Test.java classes under a tree's forge-harness/src/test/java/forge/harness, named as harness-tests.sh names them:
// forge.harness.host.X is X, any other package under forge.harness keeps it (common.GiftTargetsTest)
function harnessTestClasses(tree) {
  const base = path.join(tree, "forge-harness", "src", "test", "java", "forge", "harness");
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (/Test\.java$/.test(e.name)) out.push(r.replace(/\.java$/, "").replace(/^host\//, "").replace(/\//g, "."));
    }
  };
  walk("");
  return out.sort();
}
// what deploy would leave out: the tree's test classes the script's default list hasn't got (null: no list found)
function missingFromHarness(tree, script) {
  const list = harnessDefaults(script);
  if (!list) return null;
  return harnessTestClasses(tree).filter((c) => !list.includes(c));
}

// The engine tree going out, from MTG_MANABREW: required, since the repo's own manabrew/ checkout is not what deploys
function engineTree(env) {
  if (!env.MTG_MANABREW) stop("MTG_MANABREW isn't set: name the engine's source tree going out (e.g. MTG_MANABREW=tmp/eb-1128), its Java tests run first");
  const tree = path.resolve(ROOT, env.MTG_MANABREW);
  if (!fs.existsSync(path.join(tree, "forge-harness", "src", "test", "java"))) stop(`MTG_MANABREW=${env.MTG_MANABREW}: ${tree} has no forge-harness/src/test/java`);
  return tree;
}

// every test class of the tree is in harness-tests.sh's default list, or a new one would be left out without a word
function checkHarnessList(d, tree) {
  const missing = missingFromHarness(tree, d.readFile(HARNESS_SCRIPT));
  if (missing === null) stop("engine tests: can't find the default class list in engine/checks/harness-tests.sh");
  if (missing.length) stop(`engine tests: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} in ${path.relative(ROOT, tree)}/forge-harness/src/test but not in engine/checks/harness-tests.sh's default list: add ${missing.length === 1 ? "it" : "them"} there`);
}

// The engine's own Java tests, every class, in a throwaway container (engine/checks/harness-tests.sh). The test image
// (the node Dockerfile's java-builder stage: Forge's jar) is built from the tree, tagged with the build id; docker's
// cache makes that quick when Forge's Java is unchanged. Anything but exit 0 with the script's PASSED line stops it.
async function engineTests(d, tree) {
  const tag = `mtg-harness-test:${d.engineBuildId()}`;
  const slash = (p) => p.replace(/\\/g, "/");
  d.log(`engine tests: building ${tag} (java-builder) from ${path.relative(ROOT, tree)}`);
  const built = await d.stream("docker", ["build", "--target", "java-builder", "-f", slash(path.join(tree, "manabrew-rs", "crates", "self-hosted-node", "Dockerfile")), "-t", tag, slash(tree)], HARNESS_TIMEOUT_MS, true);
  if (built.code !== 0) stop(`engine tests: the test image ${tag} didn't build (exit ${built.code}), so the engine's tests can't run`);
  d.log("engine tests: every class in engine/checks/harness-tests.sh");
  const ran = await d.stream("docker", ["run", "--rm", "-v", `${slash(tree)}/forge-harness:/src:ro`, "-v", `${slash(HARNESS_SCRIPT)}:/harness-tests.sh:ro`, "--entrypoint", "sh", tag, "/harness-tests.sh"], HARNESS_TIMEOUT_MS);
  const failedLine = /^FAILED:.*$/m.exec(ran.out);
  if (ran.code !== 0 || !livePassed(ran.out)) stop(`engine tests didn't pass (exit ${ran.code}${failedLine ? `, ${failedLine[0]}` : ", no PASSED line"})`);
}

// The gates three at a time (the user 2026-11-27: "make the deploy faster"; one at a time they took ~25 minutes). A
// gate that opens a fixed local port (a debug server, an editor forward, a headless TTS) runs in lane 0, one after
// another, so two never want one port. Each gate's output is kept and printed only when it fails; the first failure
// stops the others and the deploy, as the one-at-a-time loop did.
const GATE_LANES = 3;
function gateUsesPort(g) {
  try { return /\blisten\(|MTG_DEBUG_PORT|BRIDGE_PORT|headless-tts|4878\d|4899\d|39999/.test(fs.readFileSync(path.join(ROOT, "tests", `${g}.js`), "utf8")); } catch { return true; }
}
function runGatesParallel(gates, lanes) {
  const serial = gates.filter(gateUsesPort);
  const free = gates.filter((g) => !serial.includes(g));
  const queues = Array.from({ length: lanes }, (_, i) => (i === 0 ? [...serial] : []));
  free.forEach((g, i) => queues[(i % (lanes - 1)) + 1].push(g));
  const kids = new Set();
  let failed = null, done = 0;
  const t0 = Date.now();
  const one = (g) => new Promise((resolve) => {
    let out = "";
    const p = spawn(process.execPath, [`tests/${g}.js`], { cwd: ROOT, windowsHide: true });
    kids.add(p);
    const take = (b) => { out += b.toString(); };
    p.stdout.on("data", take);
    p.stderr.on("data", take);
    const timer = setTimeout(() => { out += "\n(timed out after 10 min)\n"; p.kill(); }, 600000);
    p.on("close", (code) => {
      clearTimeout(timer);
      kids.delete(p);
      done++;
      if (code !== 0 && !failed) {
        failed = g;
        process.stdout.write(`${out.split("\n").slice(-30).join("\n")}\ngate ${g} FAILED (exit ${code})\n`);
        for (const k of kids) k.kill();
      } else if (code === 0) console.log(`gate ${g} ok (${done}/${gates.length}, ${Math.round((Date.now() - t0) / 1000)} s)`);
      resolve();
    });
  });
  const lane = async (q) => { for (const g of q) { if (failed) return; await one(g); } };
  return Promise.all(queues.map(lane)).then(() => { if (failed) stop(`gate ${failed} failed`); });
}

// the real effects; tests/test_deploy.js hands main its own
function realDeps() {
  return {
    argv: process.argv.slice(2),
    env: process.env,
    log: (s) => console.log(s),
    getJson: (url) => fetch(url).then((r) => r.json()),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    ttsRunning,
    patchSave,
    engineBuildId,
    versions,
    run: (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", timeout: 600000, env: { ...process.env, ...env } }),
    capture: (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: 600000, env: { ...process.env, ...env } }),
    imageExists: (tag) => { try { execFileSync("docker", ["image", "inspect", tag], { stdio: "ignore" }); return true; } catch { return false; } },
    // a long command, its output passed through as it comes and kept: { code, out } (an error starting it is code -1)
    stream: (cmd, args, timeoutMs, quiet = false) => new Promise((done) => {
      let out = "";
      const p = spawn(cmd, args, { cwd: ROOT, windowsHide: true });
      const take = (b) => { const s = b.toString(); out += s; if (!quiet) process.stdout.write(s); };
      p.stdout.on("data", take);
      p.stderr.on("data", take);
      const timer = setTimeout(() => { out += `\n(timed out after ${timeoutMs / 60000} min)\n`; p.kill(); }, timeoutMs);
      p.on("error", (e) => { clearTimeout(timer); done({ code: -1, out: `${out}${e.message}\n` }); });
      p.on("close", (code) => { clearTimeout(timer); if (quiet && code !== 0) process.stdout.write(out.split("\n").slice(-20).join("\n")); done({ code: code ?? -1, out }); });
    }),
    runGates: (gates) => runGatesParallel(gates, GATE_LANES),
    readFile: (f) => fs.readFileSync(f, "utf8"),
    writeFile: (f, s) => fs.writeFileSync(f, s),
    removeFile: (f) => fs.rmSync(f),
  };
}

// (again before each thing that would land on a game: the gates take minutes)
async function mustBeIdle(d) {
  let state = null;
  try { state = await d.getJson("http://127.0.0.1:48787/state"); }
  catch (e) { if (e.cause?.code !== "ECONNREFUSED") stop(`can't tell whether a game is running: ${e.message}`); } // (refused: no bridge, so no game)
  if (state?.started) stop("a game is running");
  if (d.ttsRunning()) stop("TTS is running: close it first, it would save over the table's new script");
}

// The bridge running is the one on disk: the loop that keeps it up hides a crash, and a stop that failed leaves the old one
async function bridgeCameUp(d) {
  const want = d.versions.bridgeHash();
  for (let i = 0; i < 40; i++) {
    const v = await d.getJson("http://127.0.0.1:48787/versions").catch(() => null);
    if (v?.now?.bridge === want) return;
    await d.sleep(500);
  }
  stop(`the bridge running isn't the new one (${want}): see tmp/bridge-live.log. No deploy recorded`);
}

async function main(d = realDeps()) {
  const at = d.argv.indexOf("--image");
  const image = at >= 0 ? d.argv[at + 1] : null;
  if (at >= 0 && (!image || image.startsWith("--"))) stop("--image needs a tag");
  await mustBeIdle(d);
  const tree = engineTree(d.env); // (before anything runs: a deploy without its engine tree can't test the engine)
  checkHarnessList(d, tree);

  const { trial } = d.patchSave(false); // (a table that can't be patched stops it here, with nothing moved)
  if (d.runGates) await d.runGates(GATES);
  else for (const g of GATES) { d.log(`gate ${g}`); d.run(process.execPath, [`tests/${g}.js`]); }
  // the gates play the source's build; this plays the script going out, with what is held back left out
  const trialFile = path.join(ROOT, "tmp", "patched-trial.json");
  d.writeFile(trialFile, trial);
  d.log("gate the patched script");
  d.run(process.execPath, ["tests/test_table_check.js"], { TABLE_SAVE: trialFile });
  d.removeFile(trialFile);
  // the engine's own Java tests (~20 min) only when the engine changes (--image), or asked for (--engine-tests): a
  // bridge and table deploy leaves the running engine as it is (the user 2026-11-27: "make it skip engine tests")
  if (image || d.argv.includes("--engine-tests")) await engineTests(d, tree);
  else d.log("engine tests: skipped, the engine isn't changing (no --image; --engine-tests runs them)");
  if (image) {
    // a protocol change comes with a relay built from the same source under the same tag: test and swap it too
    const relay = d.imageExists(`mtg-relay:${image}`);
    for (const t of LIVE_TESTS) {
      d.log(`live ${t} on ${image}${relay ? " (with its relay)" : ""}`);
      const log = d.capture("sh", ["tools/live-check.sh", image, t], { LIVE_RELAY: relay ? image : "exile" });
      d.log(log.split("\n").slice(-4).join("\n"));
      if (!livePassed(log)) stop(`${t} didn't pass on ${image}`);
    }
    await mustBeIdle(d);
    d.run("docker", ["tag", `mtg-forge-node:${image}`, "mtg-forge-node:exile"]);
    if (relay) d.run("docker", ["tag", `mtg-relay:${image}`, "mtg-relay:exile"]);
    d.run("docker", ["compose", "-f", "stack/compose.yml", "up", "-d", "--force-recreate", "relay", "forge-room"]);
  }
  // the bridge's list of the engine's cards (bridge/forge-cards.json) read from the engine about to run: rebuilt when it
  // was made for another engine build, before the bridge starts with it
  let cardList = null;
  try { cardList = JSON.parse(d.readFile(path.join(ROOT, "bridge", "forge-cards.json"))).engineBuild || null; } catch {}
  if (cardList !== d.engineBuildId()) {
    d.log(`the card list is for engine ${cardList || "(unrecorded)"}, this tree's is ${d.engineBuildId()}: rebuilding it from the running engine`);
    d.run(process.execPath, ["tools/build-forge-card-index.js"]);
  }
  await mustBeIdle(d);
  d.run("powershell", ["-ExecutionPolicy", "Bypass", "-File", "tools/start-bridge.ps1"]);
  await bridgeCameUp(d);

  const patched = d.patchSave(true);
  const images = await new Promise((done) => d.versions.containerImages(done));
  if (!images.node) stop("the table and bridge moved, and Docker can't say what the engine is: no deploy recorded");
  // (the engine build id, a hash of the pins and the patches this tree deployed, tools/engine-build-id.js: an
  // own-server companion compares its server's with it. The running node says its own; a different one means the
  // image wasn't built from this tree's patches, so nothing is recorded. An image older than the id says none.)
  const engineBuild = d.engineBuildId();
  const running = await new Promise((done) => d.versions.containerBuild(done));
  if (running && running !== engineBuild) stop(`the running engine is build ${running}, but this tree's patches make ${engineBuild}: rebuild it (engine/build-images.sh), no deploy recorded`);
  if (!running) d.log(`note: the running engine image says no build id (built before engine/engine-build-id.sh); recorded this tree's, ${engineBuild}`);
  d.writeFile(d.versions.MANIFEST, `${JSON.stringify({ bridge: d.versions.bridgeHash(), tableSource: d.versions.fileHash(d.versions.TABLE_SOURCE),
    table: patched.stamp, save: patched.save, ...images, engineBuild, at: new Date().toISOString() }, null, 1)}\n`);
  d.log(`deployed: table ${patched.stamp}, save ${patched.save}, engine ${images.node.slice(7, 19)}`);
}

if (require.main === module) main().catch((e) => { console.error(`deploy stopped: ${e.message}`); process.exit(1); });
module.exports = { livePassed, GATES, NOT_GATES, LIVE_TESTS, HARNESS_SCRIPT, harnessDefaults, harnessTestClasses, missingFromHarness, engineTree, checkHarnessList, engineTests, realDeps, main };
