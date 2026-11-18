# Report: the human's Auto payment on big boards

Cloud session, 2026-11-18, branch `cloud/autopay-big-boards` from `origin/cloud/ai-block-budget` (f1bab8f). The engine
change is `engine1124-autopay` in `docs/engine-changes.md`.
- `manabrew.patch` only (`forge-harness` `AutoPay`); `forge.patch` is unchanged. No protocol change, so no Rust
  literal.
- Not built into an image, not tried live. No permission prompt is pending.

## The item

`docs/handoff/open-after-1121.md` §3: "The human's auto-pay button (`AutoPay`) wasn't timed on big boards".

## How it was timed (`BigBoardCheck autopay`, new)

**The board:** the big board from the real card pool, 6 seats × 60, 90 and 120 permanents.
- Seat 0 is a human (`ManaBrewInteractiveLobbyPlayer`) with 10 Plains added, so the coloured cost can be paid.
- View text is off, as the harness runs it.

**The payments:** {3} (Bottle Gnomes), {8} (Ulamog's Crusher) and {3}{W}{W} (Serra Angel), from untapped lands each time.

**The real path:**
- Under the game lock, the human controller's `payManaCost` builds the payment prompt.
- The bench answers it as the table's Auto button does (`{"type":"pay","auto":true}`). That runs
  `AutoPay.floatManaForCost`, then confirms from the pool.
- Only prompts for that payment's own card are answered.
- It records the time to the prompt, the Auto part, the static passes and which cards were tapped.

## Before

The Auto part of the payment, one sample each:

| 6 seats × | {3} | {8} | {3}{W}{W} |
|---|---|---|---|
| 60 | 1.5 s | 2.9 s | 1.9 s |
| 90 | 3.5 s | 8.8 s | 6.1 s |
| 120 | 8.0 s | **21.3 s** | 13.3 s |

**The prompt itself** (the payment's undo snapshot, the sources listed) is 0.1–0.25 s at every size. It isn't the
problem.

**The Auto part is one static pass per mana ability:** 3, 8 and 5 passes. `floatManaForCost` activates one mana ability
at a time through `MagicStack.add`, which runs a full static pass. On this chain (without `cloud/dependency-scans`) a
pass at 6 × 120 is about 2.5 s.

## The change: the AI payment's budget, in `AutoPay`

The same as `ComputerUtilMana`'s `PayBudget` (big-board-fixes, ai-budgets):
- A payment gets `Game.getAIPayTimeoutMs()`, the AI payment's 2 s.
- Before each mana ability is activated, if that time has passed, the rest of the payment holds the static checks.
- One pass runs when the payment ends.

It covers both of AutoPay's loops:
- **`floatManaForCost`:** the Auto button.
- **`payManaCostWithTrace`:** the payment without a prompt, which the controller uses for mana abilities' own costs and
  the like.

`AutoPay.payBudget` (true) switches it off; `AutoPay.getHolds()` counts.

## After

Same bench, `-Dbb.autopayBudget=false` then `true`, one run each:

| 6 seats × | {3}: off → on | {8}: off → on | {3}{W}{W}: off → on | Passes on ({3} / {8} / coloured) |
|---|---|---|---|---|
| 60 | 1.5 → 1.3 s | 2.9 → 2.7 s | 1.9 → 1.8 s | 3 / 7 / 5 |
| 90 | 3.5 → 3.4 s | 8.8 → **3.4 s** | 6.1 → **3.1 s** | 3 / 3 / 3 |
| 120 | 8.0 → **5.4 s** | 21.3 → **5.0 s** | 13.3 → **6.1 s** | 2 / 2 / 2 |

**The payment that comes out is unchanged:** the same cards tapped both ways at every size. At 6 × 120 the three full
lists were compared and are identical. At 60 and 90 the logged lists were cut at 200 characters, so there the counts
and the visible part match.

**Past 2 s at 90 and 120 is the floor this budget leaves:** two static passes.
- the one after the first mana ability, which runs before the budget is checked;
- the one when the payment ends.

On this chain each is about 1.6 s at 6 × 90 and 2.5 s at 6 × 120. `cloud/dependency-scans` (`engine1124-depscans`)
brings a 6 × 120 pass to about 1.4 s, so with it the {8} at 6 × 120 should be about 3 s.
- Getting under 2 s there would mean holding from the first mana ability once a pass is known to be slow. That would
  change the AI payment too, so I left it as a choice.

## Tests: `AutoPayBudgetTest`, 8 checks (new)

Written first; its first run was a compile failure on `AutoPay.getHolds`. The fixture pays through the real
interactive path: a human seat, the controller's `payManaCost`, prompts answered with Auto.

**Held:**
- **Past the budget** (`AI_TIMEOUT = -1`), the Auto payment of {8} from 8 Plains taps 8 and runs one static pass, with
  one hold.
- **Within the budget** it runs at least one pass per mana ability, with no hold.
- **The checks are not left held** after the payment.
- **The payment without a prompt** (`AutoPay.payManaCost`, called on the controller's own AutoPay) holds past the
  budget too, then one pass.

**The same both ways.** Each board is paid once within the budget and once past it. The tapped cards and the whole
board after the payment must match: P/T, tapped, the pool.
- {8}, {3}{W}{W} and {G}{U} from Plains, Island, Forest, Tundra, Savannah, Tropical Island, three Guildgates, Command
  Tower, Llanowar Elves and Birds of Paradise.
- The same with Glorious Anthem, Gaea's Liege and an opponent's Krosan Tusker.
- {8} from two lands: cancelled both ways, nothing tapped.

## Break-it: `node tools/mutate-autopay.js <engine tree>`: 7 of 7 caught by name

`AutoPay.java` was restored by sha256 after each mutation. The mutations:
- the budget never holding;
- holding from the first tap within the budget;
- never released;
- no pass at the end;
- the Auto click not budgeted;
- the payment without a prompt not budgeted;
- holds not counted.

## Gates

- **Harness:** `engine/test-harness-local.sh --all`: **48 of 48 classes pass**. That includes `BigBoardFixesTest`'s AI payment checks and `AttackTaxLethalTest`, whose attack-tax payments go through Auto.
- **Patches:** `manabrew.patch` `git apply --check` clean on a fresh `fd16e2f` worktree.
  - Against `cloud/ai-block-budget` only `AutoPay.java` and the new test changed, with the untracked new files
    included. `forge.patch` is identical.
  - No comments in the harness Java diff.
- The repo's JS gates are not rerun: this branch changes only `engine/` patches, `engine/checks`, `tools/` and docs.

## Not done

- No image, no live game.
- The two-pass floor above.
- The Auto payment's choices (`chooseCandidate`) were not timed apart from the passes. They are a small part at these
  sizes: the bench's Auto time is the passes' time.
