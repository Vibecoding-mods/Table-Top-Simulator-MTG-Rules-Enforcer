# Report: AI budgets on big boards, and two timing-sensitive harness tests

Cloud session, 2026-11-17, branch `cloud/ai-budgets` from `origin/cloud/followups-3` (ce33124). The engine change is
`engine1117-aibudgets` in `docs/engine-changes.md`.
- Forge AI and harness tests only: no protocol change, so no Rust literal to touch.
- Not built into an image, not tried live. No permission prompt is pending.
- The engine tree is the pins (`fd16e2f` / `e7d2b93b`) with this branch's patches. Both patches `git apply --check`
  clean on fresh worktrees and reproduce every edited file.
- No comments in the harness Java diff (nor in `engine/checks/BigBoardCheck.java`'s new `attack` sampling mode).

## 1. The attack declaration past its budget

**Where the time went.** A stack sample of the AI attack at 6 seats × 120 permanents (`BigBoardCheck sample attack
120`, new mode) took 16 s in this container, about evenly split between two parts, neither deadline-checked:
- **The defender choice** (`AiAttackController.choosePreferredDefenderPlayer`, in the controller's constructor).
  - `ComputerUtil.evaluateBoardPosition` for each opponent predicts that opponent's next combat:
    `predictNextCombatsRemainingLife`, a full block assignment.
  - The prediction's block assignment checks the deadline only against the whole declaration's budget. So at 6 × 90
    the first opponent's prediction ran until the deadline, and the declaration had nothing left.
  - The chump pass from big-board-fixes also ran inside predictions once past the deadline: attackers × blockers.
- **`doAssault`** ("should everything attack?"): its attacker × blocker `canBeBlocked` / `canBlock` loops, about
  7.5 s at 6 × 120 on their own.

**What changed (Forge, `forge.patch`):**
- **The defender choice gets half of the budget.** While it runs, `AiController.halveCombatDeadline` sets the combat
  deadline to half of what is left, and puts it back after. Its predictions stop there, and the declaration keeps the
  other half.
- **Past the budget, the cheap defender:**
  - before each opponent is scored (and once more after the loop, since a prediction cut short says "in danger" and
    the scores no longer compare), the choice is the opponent with the least life, the first in turn order on a tie;
  - no board evaluation and no prediction.
- **`doAssault` checks the deadline** at its start and in both loops. Past it, the answer is `cheapAssault`:
  - each of the defender's possible blockers (and its extra blocks) takes the biggest attacker it could;
  - a blocker without flying or reach takes only attackers without flying;
  - the assault goes ahead if what is left unblocked is lethal;
  - other evasion counts as none, so it errs on not attacking.
- **Predictions no longer chump-block.** The past-the-budget chump blocks belong to the real declaration only
  (`AiBlockController.declareBlockers`, called by `AiController.declareBlockersFor`). A prediction is the assignment
  alone.
- **Two corrections found by the tests:**
  - **A deadline already passed stays as it is when halved.** Moved to "now", it counted as not passed within the same
    millisecond (Forge's `now > deadline`), and two predictions ran.
  - **A plain "no assault" past the deadline was not enough.** It left the AI attacking with nothing at 60 to 120 per
    seat, where it had sent everything in. Hence the half budget and the cheap estimate, which keep the real assault
    decision wherever it fits.

**BigBoardCheck, this container, same pins, one sample each** (before: the same tree with this branch's Forge changes
stashed):

| Per seat | AI attack | Attackers | AI pay {8} | AI pay {3} |
|---|---|---|---|---|
| 40 | 5.2 → **4.8 s** | 0 → 0 | 1.4 → 1.5 s | 0.5 → 0.5 s |
| 60 | 5.5 → **2.9 s** | 29 → 29 | 5.8 → **3.0 s** | 2.2 → 2.1 s |
| 90 | 6.7 → **3.7 s** | 45 → 45 | 9.0 → **4.6 s** | 6.5 → **4.3 s** |
| 120 | 15.3 → **5.8 s** | 61 → **0** | 14.4 → **10.2 s** | 14.3 → **10.1 s** |

(This container is slower than the measurement notes' machine: there, 6 × 120's attack was 9.7 s.)

- **The attack is now within or close to its 5 s** at every size. The 0.8 s over at 120 is the prediction running when
  the half-budget passes; its block assignment checks the deadline between blockers, not inside them.
- **At 6 × 120 the AI no longer sends all 61 in.** The real `doAssault` there takes 7.8 s on its own, more than the
  budget left. The cheap estimate says the attack isn't lethal: 69 possible blockers, 11 with flying or reach,
  against 61 attackers, 8 with flying. The real check, run without a deadline in a probe, says lethal; I didn't
  trace which of its steps (trample, non-combat damage) makes the difference. The AI attacks as at 6 × 40, where it
  also attacked with nothing before. If an all-in on these boards matters, the cheap estimate needs that step next.
- **The block declaration** (7.1 s at 120, 8.9 s before) wasn't in scope. Its own steps check the deadline.

## 2. The payment's own budget

- `Game.AI_PAY_TIMEOUT_MS` = 2000. `getAIPayTimeoutMs()` is `min(AI_PAY_TIMEOUT_MS, AI_TIMEOUT × 1000)`, so a test that
  sets `AI_TIMEOUT = -1` still passes it at once. `GameCopier` copies it.
- `ComputerUtilMana`'s `PayBudget` uses it instead of the combat budget. Past it, the payment holds the static checks
  and runs one pass at the end, as before.
- **At 6 × 90:** {8} 9.0 → 4.6 s, under 5 s.
- **At 6 × 120:** {8} 14.4 → 10.2 s. The rest is the source choice before the first mana ability is activated (where
  the budget is checked) and the pass at the end. Bounding the source choice is the next step there, not a shorter
  budget.

## Tests: `BigBoardFixesTest`, 11 → 22 checks

Written before the code, so their first run was a compile failure on the missing methods. Counters let them check work
done without timing: `ComputerUtil.getCombatPredictions` and `getBoardEvaluations`, `AiAttackController.getAssaultChecks`
and `AiController.getCombatShares`.
- **Defender:**
  - past the deadline it is the lowest-life opponent, five times, with no prediction and no board evaluation;
  - within it, one prediction per opponent;
  - the choice halves the deadline once and puts it back;
  - halving gives half of what is left, changes nothing outside a declaration, and leaves a passed deadline as it is.
- **Assault:**
  - past the deadline a lethal one (3 Hill Giants against 2 life and one blocker) is made with no assault checks;
  - one that isn't lethal (20 life) isn't;
  - three Wind Drakes over six ground blockers at 6 life are lethal;
  - within the deadline the assault is weighed and all three attack.
- **Blocks:** a prediction past the deadline makes no chump blocks. The declaration's chump checks are unchanged.
- **Pay:**
  - the payment budget is shorter than combat's;
  - with the payment budget passed and the combat one not, the payment is held, with one pass.

**Break-it: `node tools/mutate-ai-budgets.js <tree>`: 20 of 20 caught by name**, every file restored by sha256.
- 18 of them are attack, block and payment mutations. The other 2 are item 3's: the battlefield memo always rebuilt,
  and no static scope.
- **On the first run, four weren't caught:**
  - **"No cheap defender past the deadline":** nearly equivalent, because each prediction checks the deadline itself.
    But the loop still evaluated each opponent's board: about 2.4 s of creature evaluation at 6 × 120. Now caught by
    the board-evaluation counter.
  - **"The full assault check past the deadline":** the loops' own checks caught it at their first pass, leaving the
    per-attacker attack-cost setup. Those checks are now counted too.
  - **One mutation not applied:** its text occurred twice.
  - **The memo one:** item 3's first limit was too loose.
- `tools/mutate-big-board-fixes.js`: 13 of 13. Its chump mutation names the moved line.
- **The whole harness suite:** 46 of 46 classes pass (Gates, below).

## 3. The two timing-sensitive tests

**`SharedTurnsPlayTest` cr805 `aiTeamsPlayASharedTurnGameToTheEnd`** ("no combat had both partners attacking:
[[Blue],[Yellow]x5]" on the owner's PC).

**The cause:** the test recorded a combat's attackers in the defender's `declareBlockers`. Forge asks a player to block
only when one of their creatures can (`PhaseHandler.declareBlockersFor`: `if (CombatUtil.canBlock(p, combat))`).
- The white team's deck is mostly flyers, and the green team has nothing that blocks a flyer, so the white team's
  attacks were often never recorded.
- The failure lists only Blue and Yellow, the green team.
- Whether the green partners attack together is down to the AI's random choices, so the check failed about 1 game in
  5, on any machine.
- **Measured here,** before the fix, 5 games at each budget: 1 failure at 60 s, 1 at 5 s, none at 1 s.
- So it was not chiefly the AI deadlines under load, as first thought. A 1 s budget passed 5 of 5. One check at 0 s
  fails with no attacks at all, which is a different shape.

**The fix:**
- Each combat is recorded when it is declared: the union of the partners' declarations, by turn.
- The check is the same: some combat had both partners attacking. It now sees both teams' combats, the flyers'
  included.
- The game also runs with a 60 s AI budget (`-DsharedTurns.aiTimeout=` overrides it), so a loaded machine's deadlines
  don't cut a partner's attack short.
- After the fix: **18 of 18 games pass**, 10 one after another and 8 at once on this container's 4 cores (25 to 31 s
  each). The fewest combats with both partners attacking in any game was 3 of 7.
- **A seed was tried and dropped:** `MyRandom` seeded didn't make the game repeat, because the AI's threads and other
  randomness still vary.

**`ManaSourcesTest` 500 Clues (renamed `theHeldCheckOn500CluesIsUnderATenthOfTheUnsharedPath`):**
- The absolute "median under 30 ms" became a comparison within the same run. The same 500-Clue board's held check is
  timed with the shared mana sources (median of 25, twice: the faster median counts, the first being colder) and with
  `ActionSpace.shareManaSources` off, the old path (median of 7). The shared one must be under a tenth of the old one.
- **Here:** 8 to 19 ms against 172 to 245 ms, a ratio of 0.03 to 0.06.
- **The two mutations the old limit caught:**
  - the battlefield memo always rebuilt: ratio 0.15 to 0.18 (a fifth as the limit missed it, so it is a tenth);
  - no static scope: caught.
- A slower PC should slow both paths alike, so the owner's 40 ms should pass if their old path is slower in the same
  proportion. That is expected, not measured there.

## Gates

- **Harness:** `engine/test-harness-local.sh --all`: **46 of 46 classes pass**, after the last change.
- **The repo's JS gates:** unchanged by this branch, which changes only `engine/` patches, `engine/checks`, `tools/`
  and docs. Not rerun.

## Not done

- No image, no live game.
- The attack still runs 0.8 s over at 6 × 120. The cheap assault doesn't know trample (it does since
  `cloud/cheap-assault`, `docs/handoff/cheap-assault-report.md`: trample, menace, evasion, double strike).
- Past the budget the payment's source choice is unbounded: 10 s at 6 × 120.
- The block declaration at 6 × 120 (7 s) wasn't in scope.
