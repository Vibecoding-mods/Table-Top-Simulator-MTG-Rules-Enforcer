# Report: the AI attack's budget and a payment-only budget, on main

Cloud session, 2026-11-17, branch `cloud/ai-attack-budget` from `origin/main` (f4f614d). The engine change is
`engine1117-aibudgets` in `docs/engine-changes.md`.
- Not built into an image, not tried live. No permission prompt is pending.

## The work was already written

The two items, from `docs/handoff/open-after-1121.md` §3 Big boards, are this session's `cloud/ai-budgets` (0bb4d3d,
report `docs/handoff/ai-budgets-report.md`, carried here):
- "the AI attack goes past its 5 s budget at 6 × 120: its defender prediction before the deadline check isn't bounded";
- "a shorter payment-only budget is a one-line choice".

That branch was never merged. It sat on two other unmerged commits, `bo3-roll-choice` (fec39d6) and `followups-3`
(ce33124). So this branch is `origin/main` plus that one commit, cherry-picked. It applied with no conflict. Nothing in
it was rewritten.

**What it does** (details in the ai-budgets report):
- **The attack (`AiAttackController`):**
  - The defender choice (`choosePreferredDefenderForAssault`) checks the deadline before each prediction. Past it, the
    choice is the lowest-life opponent, with no prediction or board evaluation.
  - The prediction's block assignment checks it between blockers.
  - "Should everything attack?" (`doAssault`) uses a cheap estimate past the deadline: the biggest attacker each
    possible blocker could take, and fliers blocked only by flying or reach.
  - Predictions no longer make chump blocks. Those belong to the real declaration only.
- **The payment (`ComputerUtilMana`, `PayBudget`):**
  - It uses `Game.AI_PAY_TIMEOUT_MS` = 2,000 ms, through `getAIPayTimeoutMs()`: the smaller of that and the AI budget.
  - It is no longer the 5 s combat budget. Past it, the payment holds the static checks and runs one pass when it
    ends, as before. `GameCopier` copies it.

## Bench, the way the harness does

`engine/checks/BigBoardCheck decisions 60,90,120 6`:
- view text off (`GameRules.setRenderAbilityText(false)`, as `ManaBrewEngineAdapter` runs it);
- AI budget 120 s for the simulation (`setSimTimeout`), the AI's own 5 s budget for its decisions;
- one sample each, after a warm-up row;
- this container, 4 vCPU.

Both runs are on the same engine tree, built from fresh pins (`fd16e2f` / `e7d2b93b`):
- **before:** `origin/main`'s patches;
- **after:** this branch's, swapped in place (main's patches reversed, the branch's applied) and rebuilt.

| 6 seats × | AI attack: before | after | Attackers (before / after) | {8} payment: before | after | {3} payment: before | after |
|---|---|---|---|---|---|---|---|
| 60 (358 permanents) | 6.0 s | **3.2 s** | 29 / 29 | 5.9 s | **2.9 s** | 2.2 s | 2.2 s |
| 90 (534) | 6.8 s | **3.6 s** | 45 / 45 | 8.7 s | **4.7 s** | 6.6 s | 4.4 s |
| 120 (714) | 15.4 s | **5.8 s** | 61 / 0 | 14.5 s | **9.9 s** | 14.2 s | 9.4 s |

**The attack is within its 5 s budget at 60 and 90, and 0.8 s over at 120.** At 120 the overrun is the half-budget
prediction finishing its current blocker.
- At 6 × 120 the AI no longer sends all 61 creatures in. The real assault check alone takes longer than the budget
  left there, and the cheap estimate finds the attack isn't lethal: many blockers, several with flying or reach.
- (On the notes' faster machine the 6 × 120 attack was 9.7 s before. Here it was 15.4 s.)

**The payment roughly halves at 60 and 90.** At 120 it is still about 10 s. What's left is not the payment's own work:
- Each static pass on that board is about 4.7 s.
- A payment runs about two passes that can't be skipped: the one after the first mana ability, before the budget is
  checked, and the one when the held payment ends.
- That cost is CR 613.8 dependency detection in layer 6. `cloud/dependency-scans` (`engine1124-depscans`, on the
  static-pass chain, not on main) takes a pass on that board from 4.7 s to 1.4 s, and this payment to about 4.5 s.

**The block declaration** (5.3 / 5.9 / 7.1–8.8 s) is unchanged. It wasn't in scope, and its own steps check the deadline.

## Tests and gates

- **`BigBoardFixesTest`, 11 → 22 checks** (from the ai-budgets commit). Its checks use counters, not timing:
  predictions, board evaluations, assault checks, combat shares.
- **The two timing-robust rewrites** (`SharedTurnsPlayTest`, `ManaSourcesTest`) come with it.
- **Harness:** `engine/test-harness-local.sh --all` on this branch's engine: **46 of 46 classes pass**.
- **Break-it:** `node tools/mutate-ai-budgets.js <engine tree>`: **20 of 20 caught by name**, files restored by sha256.
- **Patches:** both `git apply --check` clean on fresh `fd16e2f` / `e7d2b93b` worktrees. No comments in the harness
  Java diff, and no protocol change, so no Rust literal.
- The repo's JS gates are not rerun: the branch changes only `engine/` patches, `engine/checks`, `tools/` and docs.

## Not done

- No image, no live game.
- The 6 × 120 payment's two static passes. They are the dependency-scans work, which should come with or after this.
- The block declaration at 6 × 120.
