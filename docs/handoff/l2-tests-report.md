# Report: Two-Headed Giant level 2, track A (tests first)

Cloud session, 2026-11-15. All four steps of `docs/handoff/l2-tests.md` are done.

## Step 1: build without Docker

Done. The new script is `engine/test-harness-local.sh [TestClass ...]`, and its header lists what it needs. It fetches both pinned
commits into `ENGINE_WORK_DIR` (default `~/engine`), applies the patches, commits the result locally, generates the
protocol classes, builds the harness jar and runs the classes. A run from an empty folder worked.

- JDK 21 worked; the image uses 17. No network or version fixes were needed. The jar build took about 1 minute and the
  protocol generation about 30 s on 4 CPUs.
- The `forge/pom.xml` module strip is put back after the build, so it never reaches a patch.

First result, on the patches as handed over, matched the expected result:

```
SharedTurnsTest: 25 of 26 ok
FAIL cr805.5b theTeamPassesOnceBothMembersPass: java.lang.AssertionError: after Red's ability the passes went [Red, Yellow, Blue, White]: White and Red pass for their team before Yellow's team (rule 805.5b)
TeamGameTest: PASS (35 checks)
```

## Step 2: mutation proof

Done. The new mode is `node tools/l2-mutate.js --local <manabrew tree>`. For each mutation it:

1. edits the Forge file in place (keeping its line endings);
2. compiles only the edited files over the jar;
3. runs SharedTurnsTest from the Manabrew root;
4. writes the original bytes back and checks their sha256, and stops if a hash doesn't match.

Ctrl-C and errors also restore the files. After every run, `git status` in the Forge tree was clean.

On the original 17 mutations: **17 of 17 caught by name, 0 escapes**. The "none" run failed only
`theTeamPassesOnceBothMembersPass`.

## Step 3: the missing tests

There are seven new checks in SharedTurnsTest, each with a level 1 contrast. The card scripts are Forge's own: Awakening, Leyline of Sanctity, Obeka, Jangling
Automaton, Paradox Haze, Phyrexian Arena.

| Check | Track | Result | Mutation |
| --- | --- | --- | --- |
| `cr805.2 thePrimaryPlayerOrdersTheTeamsTriggers` | B | **FAILS**, known-failing | none yet |
| `cr805.3a theStartingTeamDeclaresMulligansFirst` | B | passes | `mulligans-from-first-seat` |
| `cr805.3b theStartingTeamTakesPregameActionsFirst` | B | passes | `pregame-from-first-seat` |
| `cr805.7 theActiveTeamOrdersAllItsTriggersFirst` | B | **FAILS**, known-failing | none yet |
| `cr805.9 theActivePlayerIsOnePlayerOfTheActiveTeam` | B | passes | `active-player-is-whole-team` |
| `cr805.10e defendingPlayerIsThePlayerItAttacks` | C | passes | `defending-player-is-first-defender` |
| `cr805.8 aPartnersExtraStepIsTheTeams` | B | passes | `extra-step-not-the-teams`; also added to `phase-trigger-first-seat-only` |

Final run: SharedTurnsTest **30 of 33**. The 3 failures are all on the known-failing list. TeamGameTest passes.

```
FAIL cr805.5b theTeamPassesOnceBothMembersPass: ... the passes went [Red, Yellow, Blue, White] ...
FAIL cr805.2 thePrimaryPlayerOrdersTheTeamsTriggers: ... trigger orders were asked of [[White, White], [Red, Red], [Yellow, Yellow], [Blue, Blue]] ...
FAIL cr805.7 theActiveTeamOrdersAllItsTriggersFirst: ... ordered in the batches [[Yellow, Yellow], [Blue, Blue], [White, White], [Red, Red]] ...
```

The two new known-failing checks fail on their first assertion, so their level 1 halves never run. I ran them once
with that assertion turned off, and both level 1 halves passed. That probe was not committed.

### Mutation table (final run, 23 runs)

Each "caught" row means every listed check failed by name. Known-failing names fail in every run and aren't
counted as catches.

| Mutation | Caught by name |
| --- | --- |
| none | ok: fails only the 3 known-failing names |
| isPlayerTurn-player-only | caught |
| active-team-is-first-seat | caught |
| next-turn-next-seat | caught |
| extra-turn-one-member | caught |
| skip-turn-one-member | caught |
| skip-step-one-member | caught |
| starting-team-draws | caught |
| draw-first-seat-only | caught |
| discard-first-seat-only | caught |
| untap-first-seat-only | caught |
| phase-trigger-first-seat-only | caught, `aPartnersExtraStepIsTheTeams` included |
| each-upkeep-fires-per-member | caught |
| partner-not-asked-to-attack | caught |
| must-attack-first-seat-only | caught |
| attacking-player-is-first-seat | caught |
| when-you-attack-first-seat-only | caught |
| partner-not-asked-to-block | caught |
| mulligans-from-first-seat (new) | caught |
| pregame-from-first-seat (new) | caught |
| active-player-is-whole-team (new) | caught |
| defending-player-is-first-defender (new) | caught |
| extra-step-not-the-teams (new) | caught |

**Escapes: 0.** No mutation was stale.

### New known-failing names

- `thePrimaryPlayerOrdersTheTeamsTriggers` [B]
- `theActiveTeamOrdersAllItsTriggersFirst` [B]

## Step 4: patches

`ENGINE_WORK_DIR=~/engine ENGINE_BUILD_DIR=<clean tree at the pinned commits> bash engine/make-patches.sh`:

- `forge.patch` came out byte-identical, because no Forge code changed.
- `manabrew.patch` changed only in the SharedTurnsTest hunk.

Both patches apply cleanly to a fresh tree at the two pinned commits. Commits are on `cloud/l2-tests` only.

## What I couldn't do, and open questions

- **Which seat is the primary player (805.2).** The rule says "the player seated in the rightmost seat from that team's
  perspective". Play passes to the left, so I read the rightmost seat as the team's first seat in turn order (White,
  Yellow). `docs/game-modes-spec.md` §5.4 says the opposite ("teamLead's mirror image"). The owner should decide.
  Flipping the check is one line.
- **Rules text.** I couldn't read the full Comprehensive Rules here: the rules sites I tried are outside this
  session's network allowlist. The 805.2 wording comes from a web search result. For 805.3, 805.7, 805.9 and 805.10e
  the checks test the engine-observable part of each rule, worded as in `docs/game-modes-spec.md`.
- **No mutations for the two known-failing checks.** There is no engine code to break yet, so a mutation would be
  caught trivially. Track B should add them along with the team trigger order.
- **Not tested.** Two choices have no team choice in Forge yet, so no check covers them:
  - 805.9's "the active team chooses which player": `ActivePlayer` is always the first seat.
  - 805.10e's choice when an effect names a defending player without an attacker.
- **805.3a "all mulligans at once".** Forge mulligans each player right after they declare. The check covers the order
  of declarations and the free first mulligan, not that they happen at the same time.
