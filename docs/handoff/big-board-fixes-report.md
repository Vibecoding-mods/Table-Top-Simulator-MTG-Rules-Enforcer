# Report: big-board fixes (recommendations 1, 2, 4 and 5 of docs/big-board-measurements.md)

Cloud session, 2026-11-17, branch `cloud/big-board-fixes`. Not built into an image, not tried live. No permission
prompt is pending. The engine change is `engine1117-bigboard` in `docs/engine-changes.md`.

## Base

- `origin/main` f63de76.
- `origin/cloud/mana-sources` (22ef7b6), merged as a fast-forward.
- Your local fix applied to it: in `ActionSpace.getPossibleActions` the ThreadLocal setup (`MANA_ABILITIES`,
  `MANA_SOURCES`, `TARGET_COST_STATICS`, `PROBED_COSTS`, `BATTLEFIELD_SOURCES`) moved inside the `try`, so a throw in
  `targetCostStatics` still clears them. I made the same change from your description. If your local version differs,
  keep yours.
- `cloud/measure-big-boards` (`BigBoardCheck` and the measurements), cherry-picked for the timings.
- The engine tree is the pins (`fd16e2f` / `e7d2b93b`) with this branch's patches.

## What was built

**4. The repeated static pass.**
- **The action list:** the cost was `GameActionUtil.getAlternativeCosts` on the play ability of every land already on
  the battlefield. While any static affects the stack (Maelstrom Nexus and the like), it made a stack copy of the land
  and ran the full static pass twice: once with the copy, once to reset.
  - A spell on the battlefield already returned at once. A land play now does too: a land on the battlefield can't be
    played, so none of its play's alternatives can.
  - That removes the per-card passes entirely, rather than running one per action list.
  - The action list is identical: the test compares whole lists with `GameActionUtil.skipInPlayLandAlternatives` off
    and on.
- **The payment:** `MagicStack.add`'s pass for each mana ability is left as it is.
  - Profiling showed its cost is Forge's CR 613.8 dependency detection, which our build caches per game state. A tap
    is a new state, so each tap redoes it: about 430 ms a tap at 6 × 60.
  - Skipping or reusing that pass isn't identical, because a tap can change what a static applies to (the code's own
    note: Vhal, Candlekeep Researcher).
  - So the payment is bounded by item 2 instead. Making the pass itself cheaper would mean caching dependency
    detection across states, a larger change of its own.

**2. A budget for AI mana payment.**
- `ComputerUtilMana.payManaCost` (real payments; test payments untouched) has `Game.AI_TIMEOUT` as its budget, like
  combat.
- Past it, the rest of the payment holds the static checks (`GameAction.setHoldCheckingStaticAbilities`) and one pass
  runs when it ends, on every way out.
- The sources are chosen exactly as before. Only the passes between taps are skipped.
- **Why not the harness's simple auto-pay:** that is `AutoPay`, in the harness. Forge's AI can't reach it, and choosing
  sources wasn't the cost.

**1. A checkpoint cap by size.**
- `checkpointCap(cards) = max(1, min(40, CHECKPOINT_BUDGET_BYTES / (CHECKPOINT_BYTES_PER_CARD × cards)))`, with
  `CHECKPOINT_BUDGET_BYTES` = 250 MB and `CHECKPOINT_BYTES_PER_CARD` = 27 KB. The cards are `Game.getCardsInGame()`.
  That gives 40 at 100 cards, 23 at 400, 15 at 600, 10 at 900, 3 at 3,000.
- **Superseded 2026-11-17 (the owner's decision, `owner-decisions-1117-report.md`):** the cap now thins by turn and keeps each
  turn's first point and the newest (`thinVictim`); the test below was renamed `restorePointsAreCappedAt40KeepingTheTurnsFirst`
  (60 points in one turn keep 1 and 22..60). What follows is what was true when this report was written.
- **Not "keep each turn's first".** There is no such thinning on origin. The session drops the oldest first, and the
  existing `StressCapsTest.restorePointsAreCappedAt40OldestFirst` requires that: 60 points in one turn keep the
  newest 21..60, the turn's first not kept.
  - My first build kept each turn's first, and that test failed. I didn't change the test.
  - The cap now drops the oldest first, as before, with only the number changed.
  - If your local main keeps each turn's first, `thinCheckpoints` is the one place to change, together with that test.

**5. Blocks past the budget.**
- After the normal declaration, when the deadline has passed and the unblocked attack would be lethal,
  `AiBlockController` chump-blocks: the least valuable blockers left (`evaluateCreature`), the biggest attackers
  first, until it wouldn't be lethal.
- Trample counts only the blocker's toughness.
- It is not deadline-checked, but its cost is the attackers times the blockers, with no combat prediction.
- Within the budget nothing changes.

`GameAction.getStaticPasses()` counts the static passes, so the tests can check them without timing.

## Tests: `BigBoardFixesTest`, 11 checks, in `harness-tests.sh`'s defaults

The test was written before the code. It needs new methods (`getStaticPasses`, `checkpointCap`, `thinCheckpoints`,
`isHoldingStaticAbilities`), so its first run was a compile failure, not red checks. The break-it below is what shows
each check failing without its piece.

- **Actions:** the same list with the skip off and on (Maelstrom Nexus, Crucible of Worlds, 24 lands, a land in the
  graveyard); no static pass for an in-play land's play, against at least one each without the skip; Bojuka Bog still
  playable from the graveyard.
- **Checkpoints:** the cap at 100 / 400 / 600 / 900 / 3,000 / 1,000,000 cards; the oldest go; a real session keeps
  the cap (40 of 45, the newest).
- **Pay:** past the deadline the {8} is paid with 8 lands tapped, one static pass and the hold released; within it,
  one pass per mana ability as before.
- **Block:** past the deadline, 9 damage against 6 life is chump-blocked below lethal; against 20 life, no blocks;
  within the deadline the AI blocks as before.
- **Two mistakes in my first version of the test, found by the break-it:**
  - A deadline of 0 s is "now", which Forge's `now > deadline` doesn't pass on a small board. The past-the-deadline
    checks use -1 s.
  - The block fixture moved the phase after declaring the attack, which emptied the combat, so the block checks passed
    with no attack at all. There is now a precondition: three attackers, 9 damage.
  - That exposed a bug in my chump pass: Forge sets `isBlocked` only when blocks are finalized, so the pass and the
    test both read "no blockers" through `getBlockers(attacker)` instead.
- **Break-it: `node tools/mutate-big-board-fixes.js <tree>`: 13 of 13 caught by name**, every file restored by
  sha256. The mutations: the skip off, the skip too wide, the pass not counted, the hold never set, never released, no
  pass after it, the deadline at once, no chump blocks, chump when not lethal, the cap not by size, the bytes per card,
  the newest dropped, the session not capped.
- **The whole harness suite:** 45 of 45 classes pass, `StressCapsTest` again included (run after the last change).
- **Patches:** both `git apply --check` clean on fresh `fd16e2f` / `e7d2b93b` worktrees, and they produce the built
  tree's files. No comments in the harness Java diff.

## Before and after (`BigBoardCheck`, same base, same JVM, 6 seats, one sample each)

| Per seat | Action list (actions) | AI attack | AI block, slowest (blockers) | AI pay {3} | AI pay {8} |
|---|---|---|---|---|---|
| 40 before | 1.9 s (27) | 5.1 s | 0.88 s (18) | 0.25 s | 0.69 s |
| 40 after | **68 ms** (27) | 5.1 s | 0.63 s (18) | 0.28 s | 0.86 s |
| 60 before | 4.5 s (42) | 5.3 s | 5.1 s (**0**) | 1.3 s | 3.8 s |
| 60 after | **75 ms** (42) | 5.5 s | 5.2 s (**26**) | 1.2 s | 3.7 s |
| 90 before | 21.3 s (67) | 6.3 s | 5.6 s (**0**) | 4.2 s | **13.4 s** |
| 90 after | **0.32 s** (67) | 6.5 s | 6.0 s (**42**) | 4.4 s | **7.5 s** |

- **The action list** is 30 to 70 times faster, with the same actions.
- **Blocks:** past the budget the AI now chump-blocks a lethal attack (26 and 42 blockers, where it had none).
- **Payment** past the budget is bounded: 13.4 → 7.5 s at 90 per seat. Under the budget nothing changes.
  - It isn't down to 5 s: the work before the deadline is reached and the one pass at the end both remain.
  - A shorter budget for payment alone would bring it down further.
- **AI attack** is unchanged; it wasn't in scope.
- The other columns (state check, statics, snapshot) are within noise.

**Checkpoints under `-Xmx1100m`, after** (before: `docs/big-board-measurements.md`):

| Board (cards in zones) | Kept | Checkpoint heap | Heap used | Before |
|---|---|---|---|---|
| 4 × 60 + 40 (400) | 23 | 247 MB | 338 MB | 40, 428 MB |
| 4 × 125 (500) | 18 | 247 MB | 366 MB | 40, 548 MB |
| 4 × 125 + 100 (900) | 10 | 242 MB | 419 MB | out of memory |
| 6 × 84 + 60 (864) | 10 | 233 MB | 402 MB | out of memory |

## Not done

- No image, no live game.
- `MagicStack.add`'s per-tap pass is unchanged (see item 4).
- The AI attack's budget overrun at 6 × 120 is unchanged.
- The payment budget is the combat one (5 s). A smaller one for payment would be a one-line choice.
- The checkpoint numbers are JVM ones. The native image's per-card size should be measured before the budget is
  settled.
