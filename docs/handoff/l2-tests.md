# Handoff: Two-Headed Giant level 2, track A (tests first)

You are a Claude Code cloud session picking up one track of a bigger job. Read this file, then
`docs/2hg-level2-tests.md` (the test plan) before you change anything.

## The job in one paragraph

This repo runs Commander in Tabletop Simulator with the Forge rules engine. Two-Headed Giant (2HG) level 1
(shared life) is done. Level 2 adds shared team turns (CR 805 + CR 810). Four tracks build it: **A** tests
(you), **B** turns and priority, **C** combat, **D** the bridge and table. B, C and D run on the owner's PC.
Your track writes and proves the engine tests that B and C must make pass. You do the CPU-heavy part
(building Forge, running the tests and the mutation proof) because the owner's PC is short of CPU.

## Where things are

- Engine source is not in this repo as files. It is two patches against pinned upstream commits:
  - `engine/manabrew.patch` against Manabrew `fd16e2fbaf31873cf7a8305a44911b77d277bef0`
    (https://github.com/witchesofthehill/manabrew.git)
  - `engine/forge.patch` against Forge `e7d2b93ba9f800a1f5f3a5de91db1aad3ed46831`
    (https://github.com/witchesofthehill/forge.git), checked out at `<manabrew>/forge`
  - On this branch the patches carry the WIP level 2 engine plus the tests.
- The tests: `forge-harness/src/test/java/forge/harness/host/SharedTurnsTest.java` (inside the patched
  Manabrew tree). 26 checks, 25 pass. `theTeamPassesOnceBothMembersPass` fails on purpose (track B owns it).
- `docs/2hg-level2-known-failing.txt`: checks that may fail until their track lands.
- `tools/l2-mutate.js` + `tools/l2-mutate.sh`: the mutation proof (break one rule, the named checks must fail).
- `tests/golden/fixtures/2hg-level2-protocol.json` + `tests/make_2hg_level2_fixture.js`: fixture for track D.

## Step 1: build the engine without Docker

There is no Docker here. Do what `engine/build-images.sh` and
`manabrew-rs/crates/self-hosted-node/Dockerfile` (stages "protocol-builder" and "java-builder") do, by hand:

1. Fetch both upstream commits into a work folder outside the repo (e.g. `~/engine`, Forge at `~/engine/forge`),
   with `core.autocrlf false`, and apply the patches:
   `git -C ~/engine apply --whitespace=nowarn engine/manabrew.patch` and the same for `forge.patch` in `~/engine/forge`.
2. Commit the patched trees locally (`git add -A && git commit`) so you can diff your later edits.
3. Generate the Java protocol classes (needs Rust stable + Node):
   `cargo run -q -p manabrew-relay-protocol --bin gen-protocol -- src/protocol` then
   `node scripts/gen-harness-prompts.mjs <out>`; copy `<out>/forge/harness/protocol/` into
   `forge-harness/src/main/java/forge/harness/protocol/`.
4. Build the harness jar with JDK 17 + Maven 3.9: strip the desktop and mobile `<module>` lines from
   `forge/pom.xml` exactly as the Dockerfile's `sed` does, then
   `mvn -pl forge-harness -am -DskipTests -Dcheckstyle.skip package -q`.
   Result: `forge-harness/target/forge-harness-jar-with-dependencies.jar`.
5. Compile and run the tests the way `l2-tests.sh` does on the owner's PC (main and test sources are plain
   `javac`, no test framework; each test class has a `main`):
   ```
   javac -nowarn -encoding UTF-8 -proc:none -d /tmp/test -cp "$jar" $(find forge-harness/src/test/java -name '*.java')
   java -cp "/tmp/test:$jar" forge.harness.host.SharedTurnsTest
   ```
   Lines start with `ok`, `FAIL` or `PASS`. Run from the Manabrew root. Also run `TeamGameTest` (level 1) to show
   it still passes.

Write this as a script, `engine/test-harness-local.sh <TestClass>...`, so the next session doesn't redo it.
If a step needs a fix (network, versions), note it in the script's header.

Expected first result: SharedTurnsTest 25 of 26, failing only `theTeamPassesOnceBothMembersPass`.
If it differs, stop and record what failed in the report before going on.

## Step 2: the mutation proof

`tools/l2-mutate.js` runs each mutation in the owner's Docker image (`--image`, `--base 85bc8c3d`, a local
commit that doesn't exist here). Add a `--local <manabrew tree>` mode that edits the source in place, rebuilds
only what changed (compile the edited Forge files over the jar, as `l2-tests.sh` does), runs SharedTurnsTest,
and **restores each file by sha256** after every mutation (check the hash, never an inverse string replace).
Then run all mutations. Each one must make its listed checks fail **by name** (a crash or a neighbour failing
doesn't count). The "none" run may fail only names on the known-failing list. Report the escape count.

## Step 3: the missing tests

Add checks to SharedTurnsTest for the rules the plan lists as "not tested yet":
- 805.2 the primary player settles a team disagreement
- 805.3a/b team mulligans and pregame actions
- 805.7 the active team orders all its triggers before the other team
- 805.9 "the active player" means one chosen player
- 805.10e "defending player" for an attacker
- 805.8 an extra phase or step (not a whole turn)

For each: a level 1 contrast (the same setup with `sharedTurns` off keeps the old behaviour), a check name
printed as `cr<rule> <name>`, and a mutation in `l2-mutate.js` that makes it fail. A check that fails because
B or C hasn't built the rule yet goes on the known-failing list with its owner. Never weaken a check to make
it pass. Update the table in `docs/2hg-level2-tests.md`.

Use the engine's real text: read Forge's actual card scripts and prompt strings, don't guess them.

## Step 4: hand it back

1. Regenerate the patches from your engine tree: `ENGINE_WORK_DIR=~/engine ENGINE_BUILD_DIR=<a clean tree at the
   two pinned commits> bash engine/make-patches.sh`. They are written into `engine/`.
2. Commit on **this branch only, `cloud/l2-tests`**, and push it. Never push to `main` or any other branch.
3. Last commit: write `docs/handoff/l2-tests-report.md` with the result of every step, the mutation table
   (caught/escaped), the new known-failing names, and anything you couldn't do and why.

## Rules (the repo is public)

- No API keys or tokens anywhere. No personal names or local paths (`C:\Users\...`) in anything you commit.
- **No comments in Manabrew harness Java** (`forge-harness/**`, see the Manabrew AGENTS.md). Forge Java may
  have short comments.
- Don't change engine behaviour (that's B and C). You may only add tests, test helpers and tools.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Short, plain report. Say what failed, with the output.
