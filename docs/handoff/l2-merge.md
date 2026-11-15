# Handoff: Two-Headed Giant level 2, merged engine, full test and break-it run

You are a Claude Code cloud session. This branch (`cloud/l2-merge`) starts from `cloud/l2-tests`, so
`engine/test-harness-local.sh` and `node tools/l2-mutate.js --local` are here. Read
`docs/handoff/l2-tests-report.md` for how they work.

## What changed since `cloud/l2-tests`

`engine/forge.patch` and `engine/manabrew.patch` now hold the merged level 2 engine:

- **Track B** (turns and priority), Forge branch `l2-turns`:
  - 805.5b team priority;
  - 805.2 primary player and 805.7 trigger order (the primary player orders the team's triggers);
  - 805.9 "the active player" is one player;
  - 805.8 one effect gives or skips a turn, phase or step once per team;
  - 805.4d step triggers referring to "that player" through a condition or svars;
  - harness: a trigger-order prompt to the primary player;
  - `SharedTurnsDevTest`, 15 checks.
- **Track C** (combat), Forge branch `l2-combat`:
  - 805.10d combined team block: each defender declares in turn, the team's block is checked as a whole, and an
    illegal block is re-asked up to 3 rounds;
  - 805.10b team attack and its refused-attack count;
  - Coveted Jewel ("AttackerUnblockedOnce") triggers once, for the right player;
  - band damage assignment, and per-player end of combat modes;
  - AI as the second declarer;
  - harness: the team's blockers prompt lists every creature attacking the team, at level 1 (shared life) too;
  - `SharedCombatTest`, 13 checks.
- **Your track A tests:** your `SharedTurnsTest` (33 checks) is in as you pushed it.

## Steps

1. Build and run:
   - `engine/test-harness-local.sh SharedTurnsTest SharedTurnsDevTest SharedCombatTest TeamGameTest`;
   - then every test class under `forge-harness/src/test/java` (all host and common classes, plus
     `ActionSpaceTest` and `HarnessPlayPlumbingTest`). Extend the script to take `common.X` names if needed.

   Expected:
   - SharedTurnsTest 33 of 33. Track B's work should make `theTeamPassesOnceBothMembersPass`,
     `thePrimaryPlayerOrdersTheTeamsTriggers` and `theActiveTeamOrdersAllItsTriggersFirst` pass. If they don't,
     find out why. Your checks and B's code may disagree on details; decide which matches the rule and fix that
     side, saying which in the report.
   - Everything else passes.
2. When they pass, empty `docs/2hg-level2-known-failing.txt` of those names.
3. Mutation proof on the merged engine:
   - Run every mutation in `tools/l2-mutate.js --local`. Some `from` strings may have moved with the merge; update
     them to the merged source, never drop one.
   - Add mutations for B's and C's rules where your list has none:
     - team priority off;
     - the primary player not asked to order triggers;
     - the active team's triggers not first;
     - "the active player" meaning both partners;
     - once-per-team off for AddTurn/SkipPhase;
     - the combined block not checked as a whole;
     - the 3-round re-ask removed;
     - the blockers prompt at level 1 listing only the seat's own attackers (`teamAttackers` back to `teamBlock` in
       ManaBrewInteractiveController.declareBlockers);
     - Coveted Jewel naming the first seat.
   - Each must fail a check by name, and every file is restored by sha256.
   - Report the caught/escaped table, and close escapes with new checks.
4. Regenerate both patches with `engine/make-patches.sh` against a clean tree at the pinned commits, and confirm they
   apply to a fresh tree.
5. Add an entry to `docs/engine-changes.md` ("engine1117-l2, Two-Headed Giant level 2 shared team turns, built, not
   deployed"), with a short rule-by-rule list.
6. Commit and push to **`cloud/l2-merge` only**. Last commit: `docs/handoff/l2-merge-report.md`.

## Open question, record it but don't decide it

805.2's primary player: the checks and B's code both take the team's first seat in turn order, while
`docs/game-modes-spec.md` §5.4 says the mirror image. Note in the report which seat your checks assume. The owner
decides.

## Rules (the repo is public)

- No API keys or tokens. No personal names or local paths in anything you commit.
- **No comments in Manabrew harness Java** (`forge-harness/**`). Forge Java may have short comments.
- Never weaken a test to make it pass. A real engine bug goes in the report with the failing output; fix it only if
  the fix is small and clearly right.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Short, plain report.
