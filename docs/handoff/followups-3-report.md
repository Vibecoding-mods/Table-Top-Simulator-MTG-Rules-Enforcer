# Report: follow-ups 3 (the held start's room, the companion own-server break-it)

Cloud session, 2026-11-17, branch `cloud/followups-3` from `origin/cloud/bo3-roll-choice` (fec39d6). No engine or
protocol change and no Lua. Not tried on the real table, on Windows or against a live engine. No permission prompt is
pending.

## 1. The start held for game 1's roll uses the latest room (`bridge/bridge.js`)

**The review note:** `holdStartForRoll`'s `send` closure kept `room` from the update that rolled. A player who left or
reconnected during the 30 s wait got a start built from the old room: `clockwiseOrder(room)`, `controllerOf(room, seats)`.

**The fix:**
- `onRoomUpdate` keeps the latest room and the seat it came to (`game.lastRoom`, `game.lastRoomSeat`).
- The start is `sendStart()`, a function that reads them when it runs, rather than a closure over one update.
- "Can this room start" is one function, `roomStartReady(room)`: its format, the lobby, and everyone in and ready.
  `onRoomUpdate`'s start condition and `sendStart` both use it.
- If the room can't start when the held start goes out (answer or clock), nothing is sent. `game.startSent` goes back
  to false and chat says "The room isn't ready to start: the game starts once everyone is back in and ready."
- The next ready update then starts at once. The roll's choice is kept (`matchRoll.first`), so `matchRollWaits` is
  false: no second roll and no second question.
- A start that isn't held is unchanged: it runs in the same update, so the latest room is that update's room.
- `docs/game-modes-spec.md` §3.6's "Game 1's choice" has a line for this.

**Tests: `test_bridge_bo3_roll_choice`, now 32 of 32 (8 new).** 4 of the new checks fail on the code before the fix.
- **The latest room:** the AI reconnects as "Forge AI (2)" during the wait. Answering Play sends a seat order with the
  new name, Blue first, one start.
- **Not ready:** Blue drops out (not connected) during the wait.
  - Draw then starts nothing and chat says why.
  - The clock running out starts nothing either.
  - Back and ready, one start goes out, with Blue's choice (White first), no second roll and no second question.
  - A later update starts nothing more.

**Break-it: `node tools/mutate-bo3-roll-choice.js`: 18 of 18 caught by name**, every file restored by sha256. The 5 new
mutations:
- the room kept from the roll;
- the readiness check skipped;
- the start dropped for good;
- the chat line removed;
- the roll made again.

The old "start not held" mutation now names `sendStart`.

## 2. The companion own-server break-it

**Running it here:** this session installed mono (`mono-mcs`, `mono-runtime` and the WinForms, Management, Web
Extensions, Security and Compression libraries) from apt. That is what the test and the tool use off Windows. Built
under mono, under `xvfb-run`:
- `tests/test_companion_own_server.js` runs all 27 checks. Before, the cloud ran only the 11 page checks.
- `node tools/mutate-companion-own-server.js` on the merged code (with the reviewer's `73fd9dd`): **26 caught, 0
  survived**.
- `build.cmd`, Windows' `csc` and `COMPANION_OUT` weren't available. So the survivors the review saw on Windows
  can't be reproduced here.

**What differs by platform:** the reviewer's fix, `73fd9dd`, added `NameFailure` to `Probes.RelayLogin`: Windows' .NET
Framework reports an unknown name as a `WebException` (NameResolutionFailure) with no `SocketException`. It sits before
the older socket-error branch (HostNotFound, NoData, TryAgain), which is what mono throws. The only check of either
branch was the live probe against a name that doesn't resolve, so each platform exercised one branch only:
- **On Windows, "a name that doesn't resolve not told apart" was an equivalent program.** The mutation turns the
  socket branch off, but Windows' connect never reaches it: `NameFailure` answers first. No test run on Windows could
  catch it. That is the equivalent survivor.
- **Under mono, the reverse:** removing `NameFailure` would have survived. Mono's failure has no
  NameResolutionFailure. (The socket-branch mutation is caught here, which shows mono goes through that branch.) The
  tool had no mutation for it.

**The fix: one function, checked with both shapes on every platform.**
- The classification moved out of `RelayLogin` into `Probes.ConnectFailureKind(Exception)`, the same expression
  unchanged.
- The self-test's own-server section (`SelfTestServer.cs`) calls it with each platform's exceptions, built by hand:
  - Windows' unknown name, a `WebException` NameResolutionFailure inside a `WebSocketException` inside an
    `AggregateException`: "isn't known";
  - mono's `SocketException` HostNotFound: "isn't known";
  - NoData and TryAgain: "isn't known";
  - a refused connection: refused;
  - another `WebException` (ConnectFailure): closed, not "isn't known";
  - cancelled: timeout.
- These six checks failed before the code: they didn't compile against the old `Probes`.
- Neither branch is now an equivalent program on either platform. Both are checks that fail by name, so they are no
  longer seen on one platform only.

**The tool, now 30 mutations, 30 caught by name, 0 survived, the real files unchanged (sha256):**
- "a name that doesn't resolve not told apart" now names `selftest: login kind: mono's unknown name (SocketException
  HostNotFound): isn't known`. It is no longer equivalent on Windows.
- The four new mutations:
  - Windows' unknown name not told apart (`NameFailure` removed);
  - any `WebException` taken as an unknown name;
  - a refused connection not told apart;
  - a cancelled connect not a timeout.

**The other survivors:** the review's other two survivors aren't in anything this session can read. Every mutation in
the tool applies (one match each) and is caught here. The two platform-split branches above are the only places I
found where a mutation's result depends on the platform. If the review's other two are something else, send their
labels and I'll close them.

## Tests and gates

- GATES on this branch against the previous run (`origin/cloud/bo3-roll-choice`, which matched `origin/main` f4f614d),
  same container: the same, apart from:
  - `test_bridge_bo3_roll_choice` 24 → 32;
  - `test_companion_own_server` 11 (page only) → 27, now that mono is here.
- Also passing: `test_bridge_bo3_extras` 49, `test_bridge_match_bo3` 28, `test_bridge_treachery_first` 28,
  `test_bridge_golden` 1084 and `test_bridge_events` 602, plus the companion tests below.
- Companion tests: `test_companion_page` 242, `test_companion_server` 43, `test_friend_package` 119.
  `test_companion_update` (not a gate) needs Windows' `cmd` and fails here at its spawn.

## Gates not run here

- **39 gates need the Workshop table save** (2296042369), which isn't in the cloud session. They fail at
  `make-engine-copy.js` (ENOENT) or SKIP, identically before and after this branch:
  - `test_table_golden`, `test_ui_budget`, `test_table_profile`, `test_table_six` and `test_table_golden_six`;
  - `test_table_claims`, `test_table_check` and the other `test_table_*` gates;
  - `test_alignment`, `test_engine_json`, `test_editor_forward`, `test_moonsharp_loop_locals`, `test_rejoin_prompt`
    and `test_bridge_big_turns`;
  - `test_card_other_side` also fails the same before and after.
- **The companion on Windows:** `build.cmd` / `csc` (`COMPANION_OUT`) and the break-it built with it. Please run
  `node tools/mutate-companion-own-server.js` there once. All 30 should be caught. The six `login kind` checks don't
  depend on the platform.
