# Report: Two-Headed Giant level 2, merged engine

Cloud session, 2026-11-15. All six steps of `docs/handoff/l2-merge.md` are done. Commits are on `cloud/l2-merge` only.

## Step 1: build and run

`engine/test-harness-local.sh` now also takes `--all` (every class under `forge-harness/src/test/java`) and
`common.X` names.

First run, on the patches as handed over:

```
SharedTurnsTest: 31 of 33
FAIL cr805.2 thePrimaryPlayerOrdersTheTeamsTriggers: ... asked of [[White, White], [Red, Red], [Yellow, Yellow], [Blue, Blue]] ...
FAIL cr805.7 theActiveTeamOrdersAllItsTriggersFirst: ... ordered in the batches [[Yellow, Yellow], [Blue, Blue], [White, White], [Red, Red]] ...
SharedTurnsDevTest PASS, SharedCombatTest PASS, TeamGameTest PASS
```

Track B's team priority made `theTeamPassesOnceBothMembersPass` pass.

**The two trigger-order failures: the check was wrong, B's code is right.** In B's code the primary player chooses the
team's order (`orderSimultaneousSa`), and then each controller puts its own trigger on the stack with
`orderAndPlaySimultaneousSa`, one trigger at a time. That matches the rules: 805.2 and 805.7 give the order to the primary
player, and the controller of a triggered ability still makes its choices, such as targets, as it goes on the stack
(603.3d). My check recorded only `orderAndPlaySimultaneousSa`, so it saw those single placements. I fixed the check
side: `recordTriggerOrders` now records whoever chooses the order, through either method, and skips a placement whose
order was already chosen. The assertions are unchanged, and the level 1 halves pass as before.

Final run, `test-harness-local.sh --all`: **23 of 23 classes pass**. SharedTurnsTest 33 of 33, SharedTurnsDevTest 16,
SharedCombatTest 14, TeamGameTest, all host classes, `common.ActionSpaceTest` and `common.HarnessPlayPlumbingTest`.
Four classes print no ok/PASS lines and are judged by exit status alone: InteractiveSnapshotExtractorTest,
ManaBrewEngineAdapterTest and the two `common` classes. All four exit 0.

## Step 2: known-failing list

`docs/2hg-level2-known-failing.txt` is empty of names. `docs/2hg-level2-tests.md` no longer marks the three checks as
FAILS.

## Step 3: mutation proof

`tools/l2-mutate.js --local` now:

- runs SharedTurnsTest, SharedTurnsDevTest and SharedCombatTest for every mutation;
- can mutate harness files (paths under `forge-harness/`);
- reads check names without a `cr` prefix;
- qualifies names as `Class.check` where two classes share a name;
- fails a mutation that has no expected check.

Docker mode is unchanged: it runs SharedTurnsTest only and reports a harness mutation as NEEDS-LOCAL.

**Stale after the merge, updated, not dropped:**

- `active-player-is-whole-team`: `ActivePlayer` now calls `getActivePlayerFor(...)`.
- `phase-trigger-first-seat-only`: the step triggers moved into `runForEachActivePlayer`. That loop also runs the
  TurnBegin triggers, so the mutation now breaks both.
- `partner-not-asked-to-block`: the old edit still ran, but at level 2 the team is now asked through `teamBlock ?
  getTeamInTurnOrder(p)`, so it caught nothing. The old edit is kept, and a second edit on that line is added.

**Results.** Each row means every expected check failed by name. Every file was restored by sha256, and the Forge tree
was clean after each run.

| Mutation | Rule | Caught by |
| --- | --- | --- |
| none | | fails nothing |
| isPlayerTurn-player-only | 805.4 | isPlayerTurnCoversThePartner, eachPartnerMayPlayALand (+ others) |
| active-team-is-first-seat | 805.4 | 8 named (29 fail) |
| next-turn-next-seat | 805.4 | nextTurnGoesToTheOtherTeam, aPartnersExtraTurnIsTheTeams |
| extra-turn-one-member | 805.8 | aPartnersExtraTurnIsTheTeams (both classes) |
| skip-turn-one-member | 805.8 | aPartnerSkippingATurnSkipsTheTeams |
| skip-step-one-member | 805.8 | aPartnerSkippingAStepSkipsTheTeams |
| starting-team-draws | 805.4b | startingTeamSkipsOnlyTurnOnesDraw |
| draw-first-seat-only | 805.4b | theTeamDrawsTogether |
| discard-first-seat-only | 805.4 | theTeamDiscardsToHandSize |
| untap-first-seat-only | 805.4 | theTeamUntapsTogether |
| phase-trigger-first-seat-only (updated) | 805.4d | the 4 named, + 4 in SharedTurnsDevTest |
| each-upkeep-fires-per-member | 805.4d | eachUpkeepTriggersOnce |
| partner-not-asked-to-attack | 805.10a | bothPartnersCreaturesAttackTogether, whenYouAttackTriggersForThePartner |
| must-attack-first-seat-only | 805.10b | aPartnersMustAttackBindsTheCombinedAttack |
| attacking-player-is-first-seat | 805.10c | attackingPlayerOfACreatureIsItsController, attackingTeamAssignsDamageFirst |
| when-you-attack-first-seat-only | 805.10a | whenYouAttackTriggersForThePartner |
| partner-not-asked-to-block (updated) | 805.10d | theDefendingTeamBlocksTogether, theDefendingTeamIsAskedOnceInTurnOrder |
| mulligans-from-first-seat | 805.3a | theStartingTeamDeclaresMulligansFirst |
| pregame-from-first-seat | 805.3b | theStartingTeamTakesPregameActionsFirst |
| active-player-is-whole-team (updated) | 805.9 | theActivePlayerIsOnePlayerOfTheActiveTeam |
| defending-player-is-first-defender | 805.10e | defendingPlayerIsThePlayerItAttacks |
| extra-step-not-the-teams | 805.8 | aPartnersExtraStepIsTheTeams |
| **team-priority-off** (new) | 805.5b | theTeamPassesOnceBothMembersPass |
| **primary-not-asked-to-order** (new) | 805.2 | thePrimaryPlayerOrdersTheTeamsTriggers (both classes) |
| **partner-orders-the-teams-triggers** (new) | 805.2 | thePrimaryPlayerOrdersTheTeamsTriggers (both classes) |
| **triggers-ordered-per-player** (new) | 805.7 | thePrimaryPlayerOrdersTheTeamsTriggers, theActiveTeamOrdersAllItsTriggersFirst |
| **active-team-triggers-not-first** (new) | 805.7 | theActiveTeamOrdersAllItsTriggersFirst, theActiveTeamsTriggersGoOnTheStackFirst |
| **active-player-always-first-seat** (new) | 805.9 | eachPlayersEndStepCountsThatPlayersLands |
| **once-per-team-off** (new) | 805.8 | oneEffectSkippingBothOpponentsTurnsSkipsOneTeamTurn, oneEffectSkippingBothUntapsSkipsOneUntapStep |
| **add-turn-per-player** (new) | 805.8 | oneEffectGivingBothPartnersATurnGivesOneTeamTurn (new check) |
| **skip-phase-per-player** (new) | 805.8 | oneEffectSkippingBothUntapsSkipsOneUntapStep |
| **skip-turn-per-player** (new) | 805.8 | oneEffectSkippingBothOpponentsTurnsSkipsOneTeamTurn |
| **team-block-validated-per-player** (new) | 805.10d | aCreatureThatCantBlockAloneBlocksBesideItsPartnersBlocker |
| **team-block-checks-first-member-only** (new) | 805.10d | theTeamsBlockIsCheckedForTheSecondDefenderToo (new check) |
| **team-block-not-re-asked** (new) | 805.10d | aRefusedTeamBlockIsAskedAgainThenStands |
| **team-attack-not-re-asked** (new) | 805.10b | aRefusedTeamAttackIsAskedAgainThenTakesTheLegalAttack |
| **level1-block-prompt-own-attackers** (new, harness) | 805.10d | aLevelOneDefenderBlocksForItsPartnerInThePrompt |
| **coveted-jewel-first-seat** (new) | 805.10c | anUnblockedPartnerGetsCovetedJewel |

**39 of 39 caught** (none + 38 mutations; first written as 40 of 40, a miscount corrected on `cloud/engine1117`). The first full run had two escapes, and a new check closes each one. A rerun of every changed
mutation passed.

- `add-turn-per-player`: no check gave both partners an extra turn with one effect.
  - New check: `SharedTurnsDevTest.oneEffectGivingBothPartnersATurnGivesOneTeamTurn`. AddTurn with
    `Defined$ Player.YourTeam` must give turns W, Y, W, not W, W, Y.
- `team-block-checks-first-member-only`: every block check put the illegal part on the first defender.
  - New check: `SharedCombatTest.theTeamsBlockIsCheckedForTheSecondDefenderToo`. Blue's Watchdog ("blocks each combat
    if able") is left out of the team's block, which must be refused for three rounds of Yellow then Blue.

Both new checks pass on the merged engine. The harness test Java has no comments.

## Step 4: patches

`ENGINE_WORK_DIR=<work tree> ENGINE_BUILD_DIR=<clean tree at the pinned commits> bash engine/make-patches.sh`:

- `forge.patch`: 470 files, byte-identical, because no Forge code changed.
- `manabrew.patch`: 63 files; only the SharedTurnsTest, SharedTurnsDevTest and SharedCombatTest hunks changed.

Both pass `git apply --check` on a fresh fetch of Manabrew `fd16e2f` and Forge `e7d2b93`.

## Step 5

`docs/engine-changes.md` has the "engine1117-l2" entry (section 4) and its summary row. No Docker image was built and
nothing was deployed.

## Open question (recorded, not decided)

805.2 primary player: my checks assume the team's **first seat in turn order** (White, Yellow), as B's
`PhaseHandler.getPrimaryPlayer` does (`GameAction.teamLead`). `docs/game-modes-spec.md` §5.4/§5.10 says the mirror
image (the rightmost seat being the other one). The owner decides. Changing it means changing `getPrimaryPlayer` plus
two lines in each `thePrimaryPlayerOrdersTheTeamsTriggers`. The mutation `partner-orders-the-teams-triggers` already
proves the checks notice the other seat.

## Not done or not checked

- No Docker images, no live check against a stack.
- The rest of 805.2's choices (other than the trigger order), 805.9's "the active team chooses which player", and
  805.10e's choice when there is no attacker are still untested, as in the track A report.
