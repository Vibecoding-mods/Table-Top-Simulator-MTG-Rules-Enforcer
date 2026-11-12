# Own engine: the rules in one place (plan refreshed 2026-11-11)

Status: **plan, nothing scheduled.** The first version (2026-11-02) planned a Java-to-Lua copy of Forge running inside
Tabletop Simulator and began with a "Phase 0" of five cheap tests. That Phase 0 was never run as written, because the same day
the whole translator was built as an experiment on the `copy-engine` branch (`engine-lua/`, commit ddcc69a), and the experiment
answered the question Phase 0 asked. It was **closed 2026-11-03**: the copy plays a correct game inside real TTS but 4.4 times
slower than outside it (PLAN.md "Copy engine experiment"). So "Phase 0 not started" in older notes is stale in one way and true in
another: the *old* Phase 0 is superseded; the **new Phase 0 in §6 has not started**.

The first version, with its translator design, runtime rules and licence reading, stays in git
(`git show 71f6557:docs/spec-own-engine.md`) and, with the build's findings, on the branch
(`git show copy-engine:docs/spec-own-engine.md`, `docs/compare-current-vs-copy.md`, `docs/research-tts-speed.md`,
`engine-lua/DRIFT.md`). This file does not repeat them. It says what is still undecided and how to settle it cheaply.

Numbers in this file are from the repo on 2026-11-11 or from those branch documents; anything I estimated is marked **(estimate)**
and anything I propose rather than know is marked **(proposal)**.

## 1. What the user wants, split into three goals

From the user's 2026-11-02 requests (spec history, kept in the PLAN "Copy engine experiment" section): "big fixes should be easier and better", and "drop the
bridge and Forge" so that friends need no Docker or server. Those are three different goals and a plan can reach one without the
others:

| Goal | Meaning | Reached today? |
|---|---|---|
| **G1 Fixes in one place** | a rules bug is fixed once, where the table can see the engine's own objects, not across Forge/harness Java, an image rebuild, the bridge and the table | No (§2) |
| **G2 No Docker, no hosting** | the host needs TTS only; no WSL, relay, ports, GPU/CPU contention with Forge | No. Docker, WSL cores and the relay are the source of three of the companion's six lights (docs/companion-app-spec.md §4) |
| **G3 No bridge guessing** | the table reads the engine's events instead of comparing boards | Partly: the engine now sends an event feed (`GameViewDto.events`, 2026-11-02) that the bridge uses for the game log; the table is still drawn from boards, with the old guessing as fallback (`docs/engine-interface-reference.md:23`, `SPEC.md:101`, `tests/live_events_check.js`) |

## 2. The architecture today (measured 2026-11-11)

TTS table (Lua) ⇄ HTTP :48787 / External Editor :39999 ⇄ **bridge** (Node) ⇄ WebSocket :9443 ⇄ **relay** (Rust) ⇄ **node**
(Rust host + Java Forge harness, GraalVM native image) (docs/ARCHITECTURE.md §1; `stack/compose.yml`).

| Piece | Size | Where it lives |
|---|---|---|
| Bridge | 9,345 lines JS (`bridge/bridge.js`); it was 7,207 on 2026-11-02 | main |
| Table renderer | 8,300 lines Lua (`tools/engine-renderer.lua`); it was 5,993 on 2026-11-02 | main |
| Our engine changes | `engine/forge.patch` 8,412 lines, `engine/manabrew.patch` 4,739 lines, on Forge `e7d2b93` (the Manabrew fork of 2026-09-21) and Manabrew `fd16e2f` (`engine/build-images.sh:8-11`) | main |
| Images | `mtg-relay:exile`, `mtg-forge-node:exile`; rebuild about 20 minutes, both when the protocol changes (`engine/README.md`) | local Docker |
| Companion | 7,596 lines C# (docs/companion-app-spec.md) | main |
| Tests that matter here | bridge golden (926 scenarios on 2026-11-05, PLAN.md), `tests/test_table_*`, `tests/live_*_check.js` against a test node, 27 hand-test decks (`docs/HAND-TEST-*.md`), `tests/lua/tts-sim.lua` on fengari | main |

Why G1 fails today: a deep bug can touch Forge or the harness (Java, `forge.patch`), a rebuilt node and often relay image,
the bridge, the table script and a save patch (`tools/deploy.js`). The compare doc's bug table (branch `docs/compare-current-vs-copy.md`, "To test")
lists fixes in the harness alone (rewind phasing, the snapshot race), in harness + bridge (Kardur) and in harness + bridge + table
(phased creatures shown as gone); the fifth was never traced. Every Java-side fix also needs an image rebuild. What softens it today: the harness unit tests
recompile without an image rebuild (`engine/README.md`), `tools/live-check.sh` plays a real game against a test node beside the
running stack, and `deploy.js` updates the table with a version stamp and a check.

## 3. What the experiment found (branch `copy-engine`, 2026-11-02/03)

- **Translating works.** All 1,152 Java files of forge-core, forge-game and forge-ai become 169,904 lines of Lua in 3.3 s and run on
  TTS's own MoonSharp DLL. Hand-written: runtime 4,269 lines, translator 2,535 lines of Node, **4 hand patches** to Forge (DRIFT.md).
- **A whole AI-against-AI game is correct**: Red wins on turn 18, no Lua errors, set up in 0.8 s and 63-65 MB. Outside TTS it takes
  191 s (about 11 s a turn, single AI decisions up to 3.5 s).
- **Inside real TTS it takes 4.4 times as long** (906 s, 43 s freezes and the Not Responding close are recorded in `PLAN.md:303-304`): 846 s of engine time, worst single step 46 s; the full save-driven run 906 s elapsed,
  worst 43 s, TTS memory 0.8 to 1.67 GB. A step that runs without yielding freezes TTS for its whole length, and a long freeze got
  TTS closed through Windows' "Not Responding" prompt (event 1002).
- **The cost is spread thin.** 77% of profile samples are in our runtime (list iteration through iterator objects, run-time overload
  choice, enum maps as sorted trees), 20% in translated Forge. The two cheapest fixes bought 6% (203 s to 191 s). Even a perfect
  runtime is about 4 times faster, not 100.
- **Forge itself is heavy**: its replacement-effect check walks every card on every event (33% inclusive), and the AI's attack and
  block prediction is about 30%.
- **No tool can speed up Lua inside TTS.** TTS runs mod Lua in MoonSharp (Lua 5.2, no JIT); no `load`, `io`, `require`, DLL or
  native code is available to a mod; the documented route to a fast engine is outside TTS over `WebRequest`, which is the bridge
  design (`docs/research-tts-speed.md`, 19 sources, 3 claims thrown out).
- **MoonSharp traps found** (all in `engine-lua/` history and now in this repo's tests): a `goto` out of a nested block with locals
  crashes uncatchably; `error(table)` arrives as a string; recursion past about 20,000 deep kills the script; `select("#")` of an
  empty `...` is 1; `math.fmod` has the divisor's sign; `gmatch` on a long string can fail with "pattern too complex"
  (`tests/test_moonsharp_patterns.js`, `tests/test_moonsharp_loop_locals.js`, `tests/lua/moonsharp-patterns.js`).
- **Not measured, so not known** (the branch closed on speed): (a) a **people-only** game with no AI code running, on real 4-seat
  Commander boards (hypothesis, not a measurement: about 0.2 to 0.7 s a click outside TTS, 1 to 3 s inside); (b) Java Forge on the
  same game (the image is a native build and this PC has no `javac`); (c) the **same bugs fixed in both builds**, which is the only
  test of G1.

## 4. Routes

| Route | Reaches | Evidence so far | Verdict |
|---|---|---|---|
| **A. Lua copy in TTS, with AI** (the first plan) | G1, G2, G3 | 4.4 times slower in TTS, 906 s per AI game, 43 s freezes (`PLAN.md:303-304`), no runtime fix beyond about 4x | **Closed** (user, 2026-11-03). Do not resume unless asked |
| **B. Lua copy in TTS, people only** ("the middle way" of the branch's compare doc) | G1 and G3 for human games; G2 only for human games (AI seats still need Docker + bridge) | untested; hypothesis 1 to 3 s a click inside TTS | **Open: this is the one thing worth a cheap test** (Phase 0A) |
| **C. The same Forge engine, no Docker** (the node run natively on the host) | G2 only | none. Forge runs in the node as a GraalVM native shared library called in-process, with no JVM (`docs/engine-interface-reference.md:37, 44`), so a Windows build of the Rust node and relay plus a Windows native-image of the harness may be possible; **not verified** | **Open, unknown**. Phase 0C is a feasibility check |
| **D. A new rules engine we write** (Node or Rust, outside TTS) | G1, G2, G3 | Manabrew's own Rust port is 155,419 lines and its docs still call it incomplete (branch spec); Forge's rules are about 156,000 lines Java | **Not recommended**: the largest option by far, no evidence it beats the patched Forge |
| **E. Keep the current build, make fixes cheaper** | part of G1, G3 | the harness unit-test path and `live-check.sh` exist; the event feed exists | **The default** if Phase 0 closes B and C. Possible work in §8 |

A consequence for planning: **B would not remove the companion**. AI seats are now a built feature (harmless bot, Forge AI with
deck presets or a pasted list, docs/companion-app-spec.md §10); the *harmless* bot needs no Forge (the bridge plays it, `bridge.js:853`)
and could run in Lua, but a **Forge AI seat needs forge-ai** (57,257 lines, the 30% of the profile). So B is a hybrid: engine in
TTS for human-only games, Docker and bridge kept for AI games.

## 5. Scope

In scope for the next step: the three measurements in §6 and a go/no-go.

Out of scope until Phase 0 says go: any translator or runtime work, any change to `main`, any change to the live table, the 6-seat
table (parked; the engine does not care about seats, the UI does, docs/m6-six-seat-spec.md), cloud hosting (docs/cloud-aws-spec.md;
note that route B would remove its `forge` machine for human-only games, while route C would keep the same two-machine design
without Docker on it, **(estimate)**).

## 6. Phase 0: three measurements, each stand-alone

Rules for all three (they come from standing project rules): no code on `main`; work in a worktree; **never touch ports 39999, 39998,
48787 or 9443 of the user's running stack** (use the test node on 9444, as `engine/README.md` and `tools/live-check.sh` do, and the
fake TTS in `tests/lua`); anything that must run inside real TTS needs the user's table cleared and no game running (the 2026-11-02
run used an empty Classic table, then cleared and closed TTS); never push a script onto the user's table.

### 0A. People-only speed (answers route B)
1. From `copy-engine`, make a worktree. Use `engine-lua/host` (H.cs, modes compile, run, watch, profile) and `engine-lua/tts/`
   (the in-TTS harness, 5.1 MB sent through `/exec`).
2. Replace Forge's human controller with a scripted player that passes, or takes the first legal play, so **no AI code runs**.
3. Play the hand-test decks, 4 seats, to a late busy board. Time each engine step and the "what can each player play" query the
   table needs for its highlights. Record the median and worst step per turn.
4. Repeat inside real TTS on an empty table (the 4.4 times factor was measured for AI play; people-only may differ).
- **Exit (proposal, thresholds are mine):** *go* if, inside TTS on a late 4-seat board, the median click is at most 0.25 s and the
  worst at most 1 s, with no freeze past 5 s. The branch's compare doc said "under about 0.1 s a click makes people-only games a real
  option" without saying where; I relax it for a first pass because the user said slower is acceptable, but wrong or frozen is not
  (spec history). *Stop route B* if the median is over 1 s or any step freezes TTS over 10 s.
- **Cost (estimate):** one to two sittings; mostly reusing the branch tooling.

### 0B. Are fixes easier in the copy? (answers G1)
The branch's compare doc lists the test and never ran it. Take five bugs the current build really had (phased-out creatures shown as
gone; phasing lost on rewind; the rewind snapshot race; Kardur's must-attack refusal; Bloodline Keeper left in target lists after a
rewind; `docs/compare-current-vs-copy.md` "To test") and, for each, record in both builds: where the fix lives, files and languages
touched, rebuild and redeploy time, and whether Forge's own code changed. Board setup: Forge's `GameState` text (the branch's compare
doc says the harness already uses it; our debug boards in `scenarios/` go through the `createCard` op instead), because seeds cannot match across the two builds (HashMap order).
- **Exit (proposal):** *G1 is real* if the copy needs one language and no image rebuild for at least 4 of the 5 and the redeploy is
  under a minute; otherwise G1 is not a reason to continue. This test needs only the plain engine outside TTS, so it can run
  **without** 0A's result and costs no TTS time.

### 0C. Native engine without Docker (answers route C)
1. From `engine/build-images.sh` and the Dockerfiles (`manabrew-rs/crates/self-hosted-node/Dockerfile`, `.../manabrew-server/Dockerfile`)
   list what the node needs at run time: the GraalVM native binary, `res/` data, the harness jar, environment variables
   (the `forge-room` environment in `stack/compose.yml`).
2. Find out whether the relay and node build for Windows (MSVC Rust toolchain, GraalVM native-image on Windows). **Unknown today.**
3. If a Windows build exists: run it beside the Docker stack on a test port, play `bridge/rules-check.js` to turn 5, and compare memory
   and CPU against the container on its 2 WSL cores.
- **Exit (proposal):** *go* if the native node and relay run the rules-check scenarios with identical results and the host needs no
  WSL. *Stop* if native-image on Windows cannot build the Forge harness (the harness uses reflection configured in
  `forge-harness/native/extra-config/reflect-config.json`, which `engine/manabrew.patch` edits).
- Value if it works: the companion's Docker, Engine images and Engine stack lights shrink to "engine process runs"; WSL cores, port
  forward after `wsl --shutdown` and the `docker-users` sign-out all disappear.

### Decision after Phase 0 (a table the user fills in)

| 0A | 0B | 0C | Do |
|---|---|---|---|
| go | G1 real | any | Route B, §7 |
| go | G1 not real | any | B only if G2 for human games is worth a hybrid; else E |
| stop | any | go | Route C, §7 |
| stop | any | stop | E, §8, and close this spec |

## 7. Phases after a "go"

### Route B (Lua copy for human-only games)
Each phase has a stop test. Any stop returns to E having spent only that phase.

| Phase | Delivers | Exit criterion |
|---|---|---|
| B1 | Rebuild the translator and runtime on a current Forge pin (the branch was translated from `e7d2b93`, the commit `main`'s `engine/build-images.sh` still pins, but `main` has since gained the Star Trek cards and Java through `engine/forge.patch`, docs/forge-update-2026-11.md, so the pin must be re-checked). Fold the branch's profile fixes into the translator, not the output | the same seeded 1-v-1 game as 0A runs to the end with no errors; hand-patched files stay at most 5% of files used |
| B2 | Runtime for people play: no AI, human controller that waits on a coroutine yield for the table's answer; engine steps spread over frames with a time budget (the branch plan: loop-head budget, yield past 8 ms) | no engine step over 1 s freezes on the 27-deck set; memory under 1 GB |
| B3 | Parity: the same decks and choices on Java Forge (the oracle, in Docker, for testing only) and the Lua engine, outcome-level, not move-for-move (HashMap order), plus the existing hand-test decks, golden tables and `test_table_*` suites running unchanged against the new engine | all 27 hand-test decks play to the end with the same winners-or-states as the oracle on scripted lines; 0 known parity regressions open |
| B4 | On the table: renderer and prompts read engine objects directly (`bridge/table-map.js` is the contract, 136 lines); a switch per game "engine: Lua / Forge" so Forge stays as the fallback and for AI games | four people play it for a night; stop if they find it worse to play than the bridge version |
| B5 | Decide what retires: only the bridge/Docker for human-only games; AI games keep them | none: a decision, not code |

### Route C (native engine, no Docker)
| Phase | Delivers | Exit criterion |
|---|---|---|
| C1 | A reproducible Windows build of relay and node (script beside `engine/build-images.sh`, same pinned commits and patches) | the 0C scenarios pass on it |
| C2 | The companion starts it as processes instead of `docker compose` (the Docker, Images and Stack steps become one step); package grows by the binaries (about the size of the images, **(estimate)**) | fresh-install test (docs/release-fix-plan-2026-11-10.md step 4 recipe) passes on a PC with no Docker |
| C3 | Retire the Docker path for friends, keep it for the cloud `forge` machine (Linux) | one game night on it, no new red lights |

## 8. Route E: cheaper fixes without a new engine
**(proposal)** Candidate work if both routes close: (1) extend the event feed so the table draws from events and the bridge's board
comparison and `guess-log` shrink (G3); (2) keep adding harness unit tests that need no image rebuild (`engine/checks/harness-tests.sh`)
so a Java fix is a minutes-long loop; (3) cut the number of places a protocol change touches: today BOTH images must be rebuilt for any
new directive because the stock relay drops unknown ones (memory note on the images; `engine/README.md`); (4) a `deploy.js` mode that
rebuilds only the node. None is scheduled.

## 9. What to reuse

| Asset | Where | Use |
|---|---|---|
| Translator, runtime, DRIFT.md, host `H.cs`, in-TTS harness `engine-lua/tts/`, `tests/tts_save_test.lua` | branch `copy-engine` | 0A, B1-B3 |
| Profile and the speed ideas | branch spec "Speed pass", `docs/research-tts-speed.md` | B2; do not re-research (3 claims already thrown out) |
| `bridge/table-map.js` and its test | main | the engine-object-to-table contract for B4 |
| `tools/engine-renderer.lua` (8,300 lines) | main | unchanged; B4 changes only where its data comes from |
| 27 hand-test decks, `docs/HAND-TEST-*.md`, `scenarios/` (debug boards) | main | B3 parity and 0B board setup |
| Bridge golden and table golden tests, `tests/test_table_*` | main | must pass unchanged against any new engine |
| `tests/lua/tts-sim.lua` (fengari), `moonsharp-patterns.js`, `test_moonsharp_*` | main | fast Lua tests and the MoonSharp traps |
| `tools/moonsharp-bench.lua` | main | the original Phase 0 benchmark, still valid for a sanity run |
| Engine harness tests, `tools/live-check.sh`, test node on 9444 | main | 0B, 0C, B3 oracle |
| `docs/engine-interface-reference.md`, `docs/our-code-reference.md` | main | where the engine's messages and our code are described |
| Forge licence reading (GPL-3.0 for translated code and scripts; Manabrew AGPL-3.0) | `git show 71f6557:docs/spec-own-engine.md` ("Licence") | before publishing anything translated; not legal advice |

## 10. Risks

- **Speed on big boards** (route B). The experiment's biggest finding and still unmeasured for people-only play. Late Commander boards
  are the worst case for an interpreter. Mitigation: 0A first.
- **Host-only pauses**. A heavy pass stalls the host's TTS in steps, and a freeze past the OS threshold gets TTS closed. Budgeting
  helps and does not remove it.
- **Two engines to support during B3-B4**, and parity cannot be move-for-move (HashMap order, English keys, no event log in the copy).
- **Reload during a game**: a coroutine does not survive a table reload; resume has to go through `GameState` serialised as whole-number
  lists and text (TTS's `JSON.encode` freezes on tables keyed by fractional numbers, branch spec).
- **AI games stay on the old stack** under route B, so the companion and Docker stay: the user must accept a hybrid.
- **Native build unknown** (route C): GraalVM native-image needs a reflection config for classes reached by name (`reflect-config.json`), and a Windows native-image build of the harness has not been tried.
- **Forge drift**: `main` already moved off `e7d2b93` plus patch for Star Trek (docs/forge-update-2026-11.md); the branch pins the older
  tree, so B1 begins with a re-pin.
- **Size and competition**: B is a project of weeks; the open list on `main` (hand tests with people, 6-seat table, cloud hosting) competes.

## 11. Open questions for the user

1. Is a hybrid acceptable (engine in TTS for human-only games, Docker and bridge for AI games), or is "no Docker for anyone" the only
   interesting version? If the latter, route B is pointless and only C (or A, closed) reach it.
2. Are the proposed thresholds in 0A right (median click 0.25 s, worst 1 s)? The branch doc said 0.1 s.
3. Is one TTS session with an empty table allowed for 0A's inside-TTS run, and when (no game running)?
4. Should 0B run first on its own? It needs no TTS and decides whether G1 is even a reason to continue.
5. Is 0C worth a try before the cloud-hosting work, since route C and the AWS `forge` machine overlap?
