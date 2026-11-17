// One command that moves the bridge, the table script and the engine together, and records what went out, so the bridge
// can warn when they drift apart (bridge/versions.js). It stops at the first thing that fails, and nothing runs during a
// game. Up to the engine swap nothing has moved. A failure after that leaves the record as it was, so /versions says
// what is out of step; the save is written last, and a dry run of it comes first.
//   node tools/deploy.js                 the bridge and the table, the engine as it is
//   node tools/deploy.js --image exile2  and the engine: live-tested, retagged, its containers recreated
// TTS must be closed for the table: it would save over the patched file.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const versions = require("../bridge/versions");
const { ttsRunning, main: patchSave } = require("./patch-save");

const ROOT = path.join(__dirname, "..");
const GATES = ["test_bridge_golden", "test_bridge_events", "test_bridge_claims", "test_bridge_debug", "test_bridge_planar", "test_bridge_standard", "test_bridge_ai_tools", "test_state_delta", "test_table_map", "test_alignment", "test_table_check", "test_table_claims", "test_table_golden", "test_table_kind_relation", "test_table_board_diff", "test_table_effects", "test_table_dungeon", "test_engine_json", "test_table_fix_hand", "test_open_items_relations", "test_fix_hand_relations", "test_editor_forward", "test_moonsharp_patterns", "test_moonsharp_loop_locals", "test_card_other_side", "test_foreign_names", "test_bridge_custom_art", "test_table_standard", "test_table_clear_deck", "test_table_promote", "test_table_flip_guard", "test_bridge_gifs", "test_table_gifs", "test_bridge_hand", "test_table_hand_chat", "test_table_floating_mana", "test_bridge_teams", "test_table_teams", "test_table_team_looks", "test_bridge_lag", "test_bridge_team_modes", "test_table_lag", "test_table_team_modes", "test_deckcheck", "test_bridge_2hg_level2", "test_table_2hg_level2", "test_bridge_2hg_team_block", "test_table_2hg_team_block", "test_bridge_repeat_yesno", "test_table_repeat_yesno", "test_table_deckcheck", "test_bridge_trigger_groups", "test_table_trigger_groups", "test_table_profile", "test_table_seats", "test_table_six", "test_bridge_rejoin", "test_rejoin_prompt", "test_bridge_3hg", "test_table_3hg", "test_bridge_archenemy", "test_bridge_big_turns", "test_table_archenemy_lua", "test_table_shared_turn", "test_bridge_stress_caps", "test_table_stress_caps", "test_bridge_repeat_loop", "test_table_repeat_loop", "test_bridge_attack_tax_lethal", "test_bridge_stack_split", "test_bridge_attack_lines", "test_table_attack_lines", "test_ui_budget", "test_bridge_tie_offer", "test_table_tie_offer", "test_bridge_unbounded_tokens", "test_bridge_loop_quiet", "test_table_loop_quiet", "test_table_token_entries", "test_bridge_custom_art_2", "test_table_archenemy_view", "test_bridge_treachery_first", "test_bridge_match_bo3"];
const LIVE_TESTS = ["tests/live_phasing_check.js", "tests/live_events_check.js"];
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", timeout: 600000, env: { ...process.env, ...env } });
const stop = (why) => { console.error(`deploy stopped: ${why}`); process.exit(1); };
// (only a line saying it passed counts: an empty log, a crash or a test that never ran isn't a pass)
const livePassed = (log) => /^PASSED:/m.test(log);

// (again before each thing that would land on a game: the gates take minutes)
async function mustBeIdle() {
  let state = null;
  try { state = await fetch("http://127.0.0.1:48787/state").then((r) => r.json()); }
  catch (e) { if (e.cause?.code !== "ECONNREFUSED") stop(`can't tell whether a game is running: ${e.message}`); } // (refused: no bridge, so no game)
  if (state?.started) stop("a game is running");
  if (ttsRunning()) stop("TTS is running: close it first, it would save over the table's new script");
}

// The bridge running is the one on disk: the loop that keeps it up hides a crash, and a stop that failed leaves the old one
async function bridgeCameUp() {
  const want = versions.bridgeHash();
  for (let i = 0; i < 40; i++) {
    const v = await fetch("http://127.0.0.1:48787/versions").then((r) => r.json()).catch(() => null);
    if (v?.now?.bridge === want) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  stop(`the bridge running isn't the new one (${want}): see tmp/bridge-live.log. No deploy recorded`);
}

async function main() {
  const at = process.argv.indexOf("--image");
  const image = at > 0 ? process.argv[at + 1] : null;
  if (at > 0 && !image) stop("--image needs a tag");
  await mustBeIdle();

  const { trial } = patchSave(false); // (a table that can't be patched stops it here, with nothing moved)
  for (const g of GATES) { console.log(`gate ${g}`); run(process.execPath, [`tests/${g}.js`]); }
  // the gates play the source's build; this plays the script going out, with what is held back left out
  const trialFile = path.join(ROOT, "tmp", "patched-trial.json");
  fs.writeFileSync(trialFile, trial);
  console.log("gate the patched script");
  run(process.execPath, ["tests/test_table_check.js"], { TABLE_SAVE: trialFile });
  fs.rmSync(trialFile);
  if (image) {
    // a protocol change comes with a relay built from the same source under the same tag: test and swap it too
    let relay = false;
    try { execFileSync("docker", ["image", "inspect", `mtg-relay:${image}`], { stdio: "ignore" }); relay = true; } catch {}
    for (const t of LIVE_TESTS) {
      console.log(`live ${t} on ${image}${relay ? " (with its relay)" : ""}`);
      const log = execFileSync("sh", ["tools/live-check.sh", image, t], { cwd: ROOT, encoding: "utf8", timeout: 600000, env: { ...process.env, LIVE_RELAY: relay ? image : "exile" } });
      console.log(log.split("\n").slice(-4).join("\n"));
      if (!livePassed(log)) stop(`${t} didn't pass on ${image}`);
    }
    await mustBeIdle();
    run("docker", ["tag", `mtg-forge-node:${image}`, "mtg-forge-node:exile"]);
    if (relay) run("docker", ["tag", `mtg-relay:${image}`, "mtg-relay:exile"]);
    run("docker", ["compose", "-f", "stack/compose.yml", "up", "-d", "--force-recreate", "relay", "forge-room"]);
  }
  await mustBeIdle();
  run("powershell", ["-ExecutionPolicy", "Bypass", "-File", "tools/start-bridge.ps1"]);
  await bridgeCameUp();

  const patched = patchSave(true);
  const images = await new Promise((done) => versions.containerImages(done));
  if (!images.node) stop("the table and bridge moved, and Docker can't say what the engine is: no deploy recorded");
  fs.writeFileSync(versions.MANIFEST, `${JSON.stringify({ bridge: versions.bridgeHash(), tableSource: versions.fileHash(versions.TABLE_SOURCE),
    table: patched.stamp, save: patched.save, ...images, at: new Date().toISOString() }, null, 1)}\n`);
  console.log(`deployed: table ${patched.stamp}, save ${patched.save}, engine ${images.node.slice(7, 19)}`);
}

if (require.main === module) main().catch((e) => stop(e.message));
module.exports = { livePassed, GATES };
