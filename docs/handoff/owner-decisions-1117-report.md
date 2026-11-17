# Report: the owner's decisions of 2026-11-17

Cloud session, 2026-11-17, branch `cloud/owner-decisions-1117`.

- **Base:** the `cloud/cost-badge-4` tip (`ce066a5`), so `engine/manabrew.patch` stays one line of history.
- **Engine tag:** `engine1121-ownerdecisions`, on top of `engine1121-costbadge4`. Not built as an image, not deployed.
- **The questions:** `docs/handoff/open-after-1121.md` §4. That table now says what was decided.

## 1. Team-block cap notice: "Yellow decides (team leader)"

- **Engine:** Forge `PhaseHandler` (`engine/forge.patch`) now tells both defenders "<Primary> decides (team leader)"
  at the 4-revise-round cap. It used to say "... settles the team's blocks (rule 805.2)".
- **Bridge:** `teams.teamBlockNotice` reads the new words as they are. The old words from an engine still on
  `engine1121` read the same way, so the table says the same thing whichever engine runs.
- **Tests:**
  - The fixture `tests/golden/fixtures/2hg-team-block.json` carries the new text.
  - `test_bridge_2hg_team_block` 58 of 58. New checks: the old wording still reads the same; "decides" alone, or in
    a longer line, isn't the cap.
  - `test_bridge_3hg` 26 of 26.
  - `SharedCombatTest`.
  - The live 2HG check's message.
- **Break-its:**
  - `tools/mutate-team-block.js`:
    - its "not reworded" mutation now names the older-engine check;
    - two new ones: the new wording not read, and the wording read anywhere in a line.
    - Run here without the table test (it needs the TTS save): 15 of 15 bridge mutations caught.
    - The 5 Lua mutations had no test to fail without the save. One more, "Level 1 by default", no longer finds its
      code: `tools/engine-renderer.lua` already starts with `ENGINE_TEAM_TURNS = nil` on the base. It is a table
      mutation too, so it was left alone, and someone with the save should look at it.
  - Engine: `tools/mutate-owner-decisions-engine.js` has two: the old notice, and the partner named instead of the
    primary.

## 2. Restore-point thinning keeps each turn's first

- **`ManaBrewInteractiveSession.thinCheckpoints`:** past the cap, each turn's first restore point stays.
  - The oldest turns' in-between points go first (`dropOldestInBetween`).
  - Only when every point left is a turn's first does the oldest turn go.
  - The size cap (`checkpointCap`, at most 40) is unchanged.
- **Tests:**
  - `BigBoardFixesTest`:
    - three checks over turns 1,1,1,2,2,3,3,3 at caps 8 down to 1, a one-a-turn list, and a turn's run;
    - the session's 45 points in one turn keep 1 and 7..45.
  - `StressCapsTest`: `restorePointsAreCappedAt40OldestFirst` is renamed `...KeepingTheTurnsFirst`. 60 points in one
    turn keep 1 and 22..60.
- **Break-its:**
  - `tools/mutate-owner-decisions-engine.js`: 8 thinning mutations:
    - plain oldest-first, caught in each of the three tests;
    - a turn's first taken for an in-between;
    - the newest turn's in-between points first;
    - the newest dropped when only firsts are left;
    - any earlier point of the turn counted, not the run;
    - the size cap off by one.
  - `tools/mutate-big-board-fixes.js`: its "newest dropped" mutation now targets the new fallback. 4 of 4 checkpoint
    mutations caught.

## 3. The primary player is the team's first seat in turn order

`docs/game-modes-spec.md` now says so on every table size (`GameAction.teamLead`): White and Yellow on the four-seat
table. The mirror-image text is gone from §5.1, §5.2, §5.3 and the 3HG section, and from
`docs/team-turns-archenemy-plan.md`. No code changed: this is what was built.

## 4. Companion own-server mode

**a. Windows keeps own-server mode.**

**b. The key at rest.**

- **Windows:**
  - `server.json` keeps the key encrypted for the Windows account with DPAPI (`ProtectedData`, `CurrentUser`, fixed
    extra entropy; new `KeyVault.cs`), as `"keyProtected"`.
  - A plain `"key"` (typed into the file, or from an older companion) is used, and the file is saved again encrypted,
    once, through a temp file and `File.Replace`.
  - Observe mode writes nothing.
  - A key typed beside an older encrypted one wins and replaces it.
  - An encrypted key this account or PC can't open is a red light saying to put the key in again.
  - If encryption fails, the plain file is kept and the game still plays.
  - The pure part is `OwnServer.OpenKey` with the protect and unprotect functions passed in, so the self-test checks
    it with fakes and with the real DPAPI.
- **Linux/Mac:** already built. `companion-node` makes `server.json` mode 600 when others can read it, and the
  bridge's key file is written 600. Its tests are unchanged and pass.

**c. `mtg reset` with a server.** The bridge already restarted nothing with `MTG_REMOTE_ENGINE`. Its words now say
"restart the room on the host's server", as does the busy-room message. `tests/test_companion_server.js` checks the
words and has a new break-it for them.

**d. The engine version on connect.** The server didn't say its build before, so this needed a small relay protocol
field.

- **Engine side:**
  - `CreateRoom.engine_build` and `RoomInfo.engine_build` (optional).
  - The node sends `SELF_HOSTED_NODE_ENGINE_BUILD`, which its image sets from `ARG ENGINE_BUILD`
    (`engine/build-images.sh` passes its tag). The relay lists it.
  - Every Rust literal and destructure was updated: `host.rs`, `room.rs`, `lobby.rs`, `connection.rs`, and the
    `networking-tests` support code.
- **Deploy side:**
  - `bridge/versions.js` `containerBuild` reads the running node's build.
  - `tools/deploy.js` records it in `stack/deployed.json` as `engineBuild`.
  - `tools/make-friend-package.js` carries it into `version.json`, and into the package's `deployed.json`, which
    copies the whole record.
- **Both companions:**
  - The relay login reads the room's `engine_build`.
  - The light is amber when it isn't the table's: "Your server runs engine X, but this table was deployed with engine
    Y. ... ask the host to update the server, or update this package." The start goes on.
  - No warning when either side is unknown (an older server or deploy).

**e. No status-page box.**

- Removed from the page: the Own server box, `serverView`, `serverRequest` and their tips (`WebPage.cs`, shared by
  both companions).
- Removed from the Windows companion: `POST /api/server`, the status JSON's `server` part, `Controller.SetServer`,
  `OwnServer.View`, `KeyEnds` and `FileFromBox`.
- The help text and the refused-key message now point to `server.json`.

**f. Tailscale only.** The friend README section is rewritten:

- join the friend's Tailscale network, the only way we recommend;
- `server.json` with the Tailscale name;
- the key encrypted for your Windows account;
- the amber version light;
- `mtg reset`;
- no TLS or `wss` advice and no box.

HOW-TO-PLAY's Own server section, `docs/companion-app-spec.md` §5.8 and `docs/server-setup-spec.md` say the same.
`"secure": true` is still read (an existing file keeps working) but is no longer suggested.

**Tests**

- **Windows companion:**
  - `--selftest --section own-server`: 66 of 66 (was 60). New: the key at rest (8 checks, one a real DPAPI round trip
    under mono), the build comparison (5), and the wiring:
    - a plain key saved encrypted;
    - the encrypted file opening to the same key;
    - observe mode writing nothing;
    - `POST /api/server` answering 404;
    - no box on the page.
  - `tests/test_companion_own_server.js`: 20 of 20. New: a real run against a fake relay whose room says another
    build (amber) and the same build (green). The page checks now require no box.
- **Linux/Mac companion:**
  - selftest 485 of 485 (5 new);
  - `tests/test_companion_server.js` 45 of 45 (2 new: the real companion amber and green against a fake relay's
    build).
- **Shared tests:**
  - `tests/test_engine_build_record.js` (new, in GATES): 11 of 11.
  - `tests/test_friend_package.js`: 124 of 124 (6 new README checks: Tailscale only, the encrypted key, the version
    warning, `mtg reset`, no box, no TLS advice).
  - `test_companion_page` 242 of 242.
- **Relay:**
  - `manabrew-server` `room::tests`: 2 new. The build is in the room list (and absent without one); an older node's
    `CreateRoom` without the field still parses.
  - Networking `a_rooms_engine_build_is_listed`: the real relay binary, one room with a build and one without, then
    the list.

**Break-its (each fails by name; restored by sha256)**

- **`tools/mutate-companion-own-server.js`: 37 of 37.**
  - 8 new for the key at rest:
    - a plain key not re-saved;
    - observe mode writing;
    - the plain key kept beside the encrypted one;
    - a typed key losing to the old one;
    - another account's key not said;
    - the encrypted key not opened;
    - DPAPI for the machine instead of the account;
    - `Protect` handing back the key itself.
  - 4 new for the build: not compared, warned when unknown, the room's build not read, the table's not passed.
  - 2 new for no box: the box back on the page, `/api/server` answered again.
  - 3 new for the README: Tailscale only, TLS advice, a box.
  - Box mutations whose code is gone were dropped. The busy-room one was rewritten for the new code.
  - One first ran as "survived" because it named the wrong check. `Protect` returning the key is caught by the DPAPI
    round-trip check, so it now names that check.
- **`companion-node/breakit.js`: 52 of 52.** The busy-room text was updated; 2 new for the build comparison.
- **`tests/test_companion_server.js --breakit`: 34 of 34.** 3 new: the room's build not read, the table's build not
  passed, the reset words.
- **`tools/mutate-engine-build-record.js` (new): 6 of 6.**
  - A first run missed two:
    - "a Docker error not noticed": the test's fake gave no output, so it couldn't tell. The test now has Docker print
      a build and still fail.
    - "Windows line ends kept": the mutation changes nothing (`trim()` already strips `\r`), so it was dropped.
- **`tools/mutate-owner-decisions-engine.js <tree>` (new): 10 of 10.**

## Patches

- `engine/manabrew.patch` was regenerated. Only the intended files differ from the cost-badge-4 tip's:
  - the relay protocol;
  - the server's `room.rs`, `lobby.rs` and `connection.rs`;
  - the node's `config.rs`, `host.rs` and `Dockerfile`;
  - the networking tests;
  - the harness's `ManaBrewInteractiveSession`, `BigBoardFixesTest`, `StressCapsTest` and `SharedCombatTest`.
- `engine/forge.patch` was regenerated: only `PhaseHandler`.
- `git apply --check` is clean on `fd16e2f` / `e7d2b93b`.
- No comments were added to harness Java. No Lua changed.
- `docs/engine-changes.md` has the table row and the section.

## Gates

- **The full harness suite** (`engine/test-harness-local.sh --all`, rebuilt): 46 classes.
  - 45 passed.
  - `SharedTurnsPlayTest` failed once: an AI game in which the partners never attacked together, the class known to
    be flaky. Run alone right after, it passed three times out of three.
- **The deploy GATES that run here:** 61 of 99 pass (99 with the new `test_engine_build_record`). The other 38:
  - 36 need the TTS save;
  - `test_bridge_claims` and `test_editor_forward` fail for the environment reasons below.
- **Cargo:**
  - `cargo check --workspace --tests` compiles every crate except two, neither changed here:
    - the Tauri desktop app `manabrew`: this container has no GTK;
    - `manabrew-engine`'s test `cleansing_wildfire_regression`: it doesn't build on this tree before this branch
      either.
  - `cargo test -p manabrew-server --lib room::tests` passes 8 of 8.
- **Not run here:**
  - The table gates and anything that builds the table (`test_table_*`, `test_alignment` and the others listed in
    `docs/handoff/cost-badge-4-report.md`): they need the TTS Workshop save. No Lua changed.
  - `test_bridge_claims`: its live files guard fails on the unchanged base here too.
  - `test_editor_forward`: this container has no IPv6.
  - The networking scenarios that start a real node (`dead_node_room_is_reclaimed`,
    `abandoned_room_serves_a_fresh_game`): they need the `self-hosted-node` binary with Forge, which isn't built
    here. So the node's reading of `SELF_HOSTED_NODE_ENGINE_BUILD` isn't run end to end.
  - The Windows build (`build.cmd`) and the real Windows DPAPI: the C# was built with mono's `mcs` and run under mono,
    whose `ProtectedData` keeps its keys in the user's profile.
  - No image was built, and no live game was played.

## Not covered / left

- A room restored after a relay restart (`GameStartedSpec`) doesn't carry the build. It reads as unknown, so no
  warning shows.
- The engine build shows only on the companion's light, not in the bridge's `/versions` or on the table.
- On Windows, an amber light lets the start go on. On Linux/Mac too (`doServer`). Neither is pinned by a test.
- Build `engine1121-ownerdecisions` with `engine/build-images.sh` (which tags the node with its build) and deploy it.
  `tools/deploy.js` then records `engineBuild`.
- On Windows: `build.cmd`, the own-server self-test section, and a real `server.json` with a plain key, checked to
  be encrypted after the first start.
