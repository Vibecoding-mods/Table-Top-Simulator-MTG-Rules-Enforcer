# Handoff: engine1117, level 2 shared team turns plus the live life house rule

You are a Claude Code cloud session. This branch (`cloud/engine1117`) starts from `cloud/l2-merge`; read
`docs/handoff/l2-merge-report.md` first.

## What changed

`engine/forge.patch` and `engine/manabrew.patch` were regenerated on the owner's PC from one engine tree:

- level 2 shared team turns, exactly as you left it on `cloud/l2-merge`;
- plus the live engine's house rule `teamLifeEvents` (engine1116-teams3): a partner's life gain or loss triggers your
  "whenever you gain/lose life" cards. The level 2 work branched before this rule, so it was merged in.
  - Two Forge conflicts were resolved by keeping both sides:
    - `GameRules.java`: the `sharedTeamTurns` and `teamLifeEvents` flags and their accessors;
    - `Trigger.java`: `firesForTeamRun`/`refersToTriggeredPlayer` and `matchesValidLifePlayer`.
  - One harness conflict was resolved the same way: `configureTeamRules` now calls both `setSharedTeamTurns` and
    `setTeamLifeEvents`.
  - The life house rule's checks are in `TeamGameTest`.

The "Team draws" and "Team effects" house rules (branch `cloud/team-draws`) are **dropped**. The owner decided to keep
official Two-Headed Giant plus only the life rule. Don't bring them back.

The merged tree has **not been compiled or tested**.

## Steps

1. Run `engine/test-harness-local.sh --all`. Every class must pass, including SharedTurnsTest, SharedTurnsDevTest,
   SharedCombatTest and TeamGameTest.
   - Fix compile errors and real conflicts between the two features.
   - Add a check where they meet: at level 2, one life gain by White triggers Red's "whenever you gain life" card
     once, not once per player run of the team's turn.
2. Run the full l2 mutation set on the merged engine.
   - Add a mutation that breaks the life house rule: `matchesValidLifePlayer` back to plain `ValidPlayer` matching.
   - Update stale `from` strings; never drop a mutation.
   - Each mutation must fail by name, with files restored by sha256.
   - Report caught and escaped.
3. Regenerate both patches with `engine/make-patches.sh` against a clean tree at the pinned commits, and confirm they
   apply to fresh trees.
4. Update `docs/engine-changes.md` with one entry: "engine1117 (Two-Headed Giant level 2 + the life house rule), built
   in the cloud, no image".
5. Update `docs/game-modes-spec.md` §5.4/§5.10 for the owner's 805.2 decision below.
6. Commit and push to **`cloud/engine1117` only**. Last commit: `docs/handoff/engine1117-report.md`.

## Owner decisions

- 805.2 primary player: the team's furthest-right seat from the team's view. On the 4-player table that is White for
  team 1 and Yellow for team 2: the team's first seat, which the code and checks already use.
- No Team draws and no Team effects.

## Rules (the repo is public)

- No API keys or tokens, no personal names, no local paths.
- **No comments in Manabrew harness Java** (`forge-harness/**`).
- Never weaken a test.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Short, plain report.
