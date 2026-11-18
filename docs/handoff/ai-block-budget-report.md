# Report: the AI's block declaration on big boards

Cloud session, 2026-11-18, branch `cloud/ai-block-budget` from `origin/cloud/ai-attack-budget` (3a16573). The engine
change is `engine1124-blockbudget` in `docs/engine-changes.md`.
- Forge AI only (`AiBlockController`, `ComputerUtilCombat`). No protocol change, so no Rust literal.
- Not built into an image, not tried live. No permission prompt is pending.

## Where the 7 s went

`BigBoardCheck` has a new `sample block` mode. The 6 × 120 board's creatures attack round the robin, and the defender
with the most attackers, at 6 life, declares its blocks under the stack sampler.

**Before: 6.37 s for 13 attackers.** The 5 s declaration budget already stops every stage (`makeGoodBlocks`,
`makeTradeBlocks`, `makeChumpBlocks`…).
- **Up to the deadline:** 73% was `makeGoodBlocks`.
  - About half of everything was one question asked for every attacker and blocker pair: "could the attacker (or
    blocker) pay for a pump?"
  - That is `ComputerUtilCombat.predictPowerBonusOfAttacker` / `…OfBlocker` and the toughness ones, through
    `ComputerUtilCost.canPayCost`.
  - Each answer is a scan of every mana source on the board (`buildSourcesByManaColor`).
- **After the deadline, 1.4 s:**
  - 0.8 s was big-board-fixes' chump pass (`makeChumpBlocksPastDeadline`). Its sorts called `damageIfUnblocked`
    (another pump-cost scan per attacker) and `evaluateCreature` inside the comparators, O(n log n) times.
  - The rest was the stage in progress finishing its pair.

## The change

1. **Pump costs once per declaration** (`ComputerUtilCombat.beginPumpCosts` / `endPumpCosts`, around
   `AiBlockController.declareBlockers`).
   - The real declaration changes only the `Combat` object, never the game. So whether a player can pay for an ability
     is the same for the whole declaration, and each (ability, player) is answered once.
   - Only that real declaration is covered. Predictions and other callers are as before.
   - `ComputerUtilCombat.pumpCostMemo` (true) switches it off.
2. **The chump pass works out each value once.** Each unblocked attacker's damage and each free blocker's value is
   worked out once into a map, then sorted by it. That is the same order: nothing changes during the sort.
   - What the pass does is unchanged: when what is still unblocked would kill, chump with the least valuable blockers
     left, the biggest attackers first, until it wouldn't.

**What the declaration gets from it:** the same 5 s budget goes further. It makes more of its considered blocks before
the deadline, and the past-the-deadline work (the closing `lifeInDanger` checks, the chump pass) is about 0.3 s.

## Bench, the harness way (view text off, AI budget 5 s, one sample each after a warm-up, this container)

**`BigBoardCheck decisions 60,90,120 6`:** the slowest defender's block declaration, against the creatures that could
attack spread over the five defenders.
- **Before** is this same tree built with `cloud/ai-attack-budget`'s patches: its report's "after" row, run here the
  same day.

| 6 seats × | Block declaration: before | after | Blocks made (before → after) |
|---|---|---|---|
| 60 | 5.23 s | **5.14 s** | 24 → 24 |
| 90 | 5.88 s | **5.60 s** | 42 → 42 |
| 120 | 7.05 s | **5.41 s** | 54 → 54 |

**`BigBoardCheck sample block`** (one defender at 6 life):

| 6 seats × | Before | After |
|---|---|---|
| 60 | (not run) | 2.72 s (6 attackers, 9 blocks) |
| 90 | (not run) | 3.72 s (9 attackers, 10 blocks) |
| 120 | 6.37 s | **5.32 s** (13 attackers, 11 blocks) |

**Within the budget at 60 and 90 for one defender; 0.4 s over at 120.**
- In `decisions` the slowest defender still runs to about 5 s at every size. The declaration uses its whole budget
  there, and makes more of its considered blocks in it.
- At 6 × 120 the overrun is now about 0.3–0.4 s, from 2 s.

## Tests: `BlockBudgetTest`, 8 checks (new)

The code came before this test, not after. Each check was then shown to fail without the piece it guards (the
break-it below).

**Pump costs:**
- **Once per declaration:** 12 pumpers (Shivan Dragon, Frozen Shade, Wall of Fire) over Mountains and Swamps. One
  declaration makes at most 24 checks (two players), against at least 5 times as many without the memo.
- **Outside a declaration nothing is kept:** two `canDestroyBlocker` calls check the costs twice.

**The same blocks both ways:** each board is played twice with one seed (random trade blocks), a 600 s budget so no
deadline cuts either run, and the memo off then on. Every attacker's blockers must match, and something must be
blocked.
- Pumpers at 6 life and at 20 life.
- Serra Angel, Craw Wurm and Elvish Warrior (flying, trample, first strike), and Trained Armodon, against Wall of Wood,
  Giant Spider, Typhoid Rats (deathtouch) and Youthful Knight, at 7 life.

**Lethal past the deadline** (`AI_TIMEOUT = -1`):
- **40 Hill Giants at 6 life against 25 blockers** (20 Llanowar Elves, 5 Giant Spiders): all 25 block. Either what is
  left unblocked isn't lethal, or no free blocker could block any unblocked attacker. This is the peer's "no blocker
  left unassigned when a lethal attack is coming".
- **9 damage against 20 life:** no forced blocks.

**The chump pass:** at most one value per attacker and per blocker (40 + 25).

## Break-it: `node tools/mutate-ai-block-budget.js <engine tree>`: 8 of 8 caught by name

Every file was restored by sha256 after each mutation. The mutations:
- the memo never started;
- the memo kept after the declaration;
- the memo answering no;
- the declaration not beginning it;
- no chump pass past the deadline;
- chump blocks when not lethal;
- the chump pass stopping at its first block;
- the values worked out in the sort again.

**Not mutations:**
- **Keying the memo by the ability alone.** An ability is only ever checked for its own card's controller, so that's
  equivalent.
- **The chump pass's attacker order.** The lethal board's 40 attackers are alike, so no check could see it.

## Gates

- **Harness:** `engine/test-harness-local.sh --all`: **47 of 47 classes pass**. That includes `BigBoardFixesTest` (its
  block checks: chump past the deadline, none when safe, the declaration within the deadline, no chumps in
  predictions).
- **Patches:** both `git apply --check` clean on fresh `fd16e2f` / `e7d2b93b` worktrees.
  - Against `cloud/ai-attack-budget` only `AiBlockController`, `ComputerUtilCombat` and the new test changed.
  - No comments in the harness Java diff (the Forge diff has its own, as before).
  - (A first regeneration here left out the tree's untracked new files. It was caught by comparing the file list
    against the base patch, and redone. `cloud/dependency-scans` and `cloud/snapshot-viewers` were checked the same
    way: nothing missing.)
- The repo's JS gates are not rerun: this branch changes only `engine/` patches, `engine/checks`, `tools/` and docs.

## Not done

- No image, no live game.
- The slowest defender in `decisions` still uses its whole 5 s budget. Cutting it further would mean a smaller block
  budget, which is a choice for the owner, not a bound.
- The stage in progress at the deadline still finishes its current pair.
