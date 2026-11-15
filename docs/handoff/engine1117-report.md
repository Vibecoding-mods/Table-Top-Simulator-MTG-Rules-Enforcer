# Report: engine1117, Two-Headed Giant level 2 plus the life house rule

Cloud session, 2026-11-15. All six steps of `docs/handoff/engine1117.md` are done. Commits are on `cloud/engine1117`
only.

## Step 1: build and test

A fresh tree was made from the owner's patches with `ENGINE_WORK_DIR=<new tree> engine/test-harness-local.sh --all`.

- **The merged tree compiled as is.** There were no compile errors, and the two features don't conflict. The kept-both
  resolutions in `GameRules.java`, `Trigger.java` and `configureTeamRules` work together.
- **23 of 23 classes pass.**
  - SharedTurnsTest 34 of 34;
  - SharedTurnsDevTest 16;
  - SharedCombatTest 14;
  - TeamGameTest 41, with the life house rule's checks;
  - every other host class and both `common` classes. As before, four classes report by exit status only.

**New check where the features meet:** `cr805.4d aPartnersLifeGainTriggersYourCardOnceInTheTeamsUpkeep`
(SharedTurnsTest). The setup is level 2 with `teamLifeEvents` on: White has Honden of Cleansing Fire and Red has Ajani's
Pridemate.

- The team's upkeep runs once for each active player (805.4d), but White's Honden gains the team 2 life once.
- Red's Pridemate gets 1 counter from White's gain, not one per player's run of the step.
- Level 1 contrast with the house rule: the same result.

It passes. Under the mutation `life-trigger-plain-valid-player` it fails by name.

## Step 2: mutation proof

The full l2 set ran on the merged engine, plus two new mutations for the life house rule. Those two also run
TeamGameTest: a mutation can now list extra test classes in `tests`, and Docker mode reports such a mutation as
NEEDS-LOCAL.

| Mutation | Breaks | Caught by |
| --- | --- | --- |
| **life-trigger-plain-valid-player** (new) | `Trigger.matchesValidLifePlayer` back to plain `ValidPlayer` | aPartnersLifeGainTriggersYourCardOnceInTheTeamsUpkeep, aPartnersLifeGainTriggersYourPridemateOnce, aPartnersLifeLossTriggersYourLoseLifeTrigger (+ theFirstGainEachTurnIsTheTeams) |
| **life-replacement-plain-valid-player** (new) | `ReplaceGainLife` without the teammate case | yourLifegainReplacementDoublesAPartnersGainOnce |
| the 38 level 2 mutations from `cloud/l2-merge` | as in `docs/handoff/l2-merge-report.md` | each by its named checks, as there |

- **41 of 41 runs caught by name, 0 escapes, 0 stale.** That is `none` plus 40 mutations, and `none` fails nothing.
- The merge moved no `from` string.
- Every file was restored by sha256. The Forge tree was clean after the run.

**Correction:** the l2-merge report said "40 of 40". The real count there was 39 runs, `none` plus 38 mutations. I
fixed that line and the matching line in `docs/engine-changes.md`.

## Step 3: patches

`engine/make-patches.sh` was run against a clean tree at the pinned commits.

- `forge.patch`: 474 files, byte-identical to the owner's.
- `manabrew.patch`: 63 files; the only change is the new check in SharedTurnsTest.
- Both pass `git apply --check` on fresh trees at Manabrew `fd16e2f` and Forge `e7d2b93`.
- The harness Java has no comments.

## Steps 4 and 5: docs

- `docs/engine-changes.md` has the engine1117 entry, "built in the cloud, no image", and a summary row.
- `docs/game-modes-spec.md` §5.4 and §5.10 now record the 805.2 decision. The primary player is the team's
  furthest-right seat from the team's view: White and Yellow, the team's first seat in turn order. That is what
  `getPrimaryPlayer` and the checks already use, so no code changed.

Team draws and Team effects were not brought back.

## Not done

- No Docker image and no live check.
- One possible meeting point is not covered. A team trigger that fires once in a team run (`firesForTeamRun`) and also
  reads a this-turn life count could in principle read the count partway through the step. No card combination was
  found that makes it observable, so no check covers it.
