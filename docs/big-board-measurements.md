# Big-board measurements (stress items #16 and #17)

Measured 2026-11-17 in a cloud session, on main's engine (the harness jar built from `origin/main` f63de76's
patches). Measurement only: no production code changed. The program is `engine/checks/BigBoardCheck.java`, a harness
check like `SnapshotTimingCheck.java`. Every number below comes from it, and each run's command is given.

Follow-up: recommendations 1, 2, 4 and 5 are built on `cloud/big-board-fixes` (`engine1117-bigboard`), with before and
after timings in `docs/handoff/big-board-fixes-report.md`.

## Summary

- **#16, AI decisions on a big board: yes, decisions pass 10 s.** None of them is an AI combat decision, though.
  - Forge's combat budget holds those to about 5–6 s: our Forge build caps each attack or block declaration at
    `Game.AI_TIMEOUT` = 5 s.
  - Two things have no budget: the AI paying a mana cost, and the list of actions the harness builds for a priority
    question.
    - At 6 × 60 permanents they take 3.2 s and 5.1 s.
    - At 6 × 90 payment passes 10 s (10.3 s) and the action list takes 18.5 s.
    - At 6 × 120 they take 23.8 s and 46.9 s.
  - The AI's attack passes the budget at 6 × 120 (9.7 s).
  - The cost in both unbudgeted paths is the same: `GameAction.checkStaticAbilities`, the whole layer pass, run again
    and again (sampling below).
  - The block budget also has a quality cost. From 6 × 60 up, an AI at 6 life facing about 30 attackers blocked
    nothing: its 5 s ran out before it assigned a blocker.
- **#17, checkpoints: no, 40 checkpoints don't fit a big game in 1100 MB.**
  - `GameSnapshot.makeCopy` costs about **27 KB per card in the game** (every zone, not only the battlefield), each
    checkpoint.
  - A 500-permanent board with nothing else is 13.7 MB a checkpoint, 548 MB for 40.
  - 500 permanents plus about 100 cards per player in libraries, hands and graveyards is 24 MB a checkpoint. 40 of those
    ran out of memory under `-Xmx1100m`.
  - An ordinary four-player Commander game already holds about 400 cards (10.7 MB a checkpoint, 428 MB for 40). A
    six-player one about 600 (about 16 MB, about 650 MB for 40).
  - The node keeps its card database live as well: about 450 MB by the Dockerfile's note, about 250 MB idle by
    `docs/server-setup-spec.md`.
- **Recommendation** (details at the end):
  - cap checkpoints by size (about 27 KB × cards in the game against a budget of about 250 MB), not by count;
  - give the AI's mana payment the combat declarations' kind of deadline;
  - treat 6 × 60 distinct permanents as the size the table supports today;
  - look into the repeated static-ability pass first.

## Method

- **Machine:** this cloud container, 4 vCPU Intel Xeon 2.1 GHz, OpenJDK 21.0.12. These are JVM numbers. The node runs
  a GraalVM native image with G1, so its absolute times and object sizes may differ. The ratios and the growth with
  board size are what to carry over.
- **Engine setup:** Forge as the node sets it up: lazy card scripts, `PERFORMANCE_MODE`, `setSimTimeout(120)`,
  `setRenderAbilityText(false)`. Every seat is a `LobbyPlayerAi` with a `ManaBrewInteractiveSession` attached, as a
  hosted game has.
- **The cards:** distinct permanents chosen reproducibly from Forge's card scripts (`forge/forge-gui/res/cardsfolder`,
  ordered by the SHA-1 of the name). Every card in one game is different.
  - Each seat's share is 37% nonbasic lands, 42% creatures, and the rest noncreature artifacts and enchantments.
  - Left out: planes, schemes, planeswalkers, battles, sagas, Auras, two-faced and other multi-state cards, Alchemy
    cards.
  - Also left out: cards whose static stops every creature attacking or blocking (Peacekeeper). The first run had
    Peacekeeper at 6 × 90, and no creature could attack.
  - The cards are put onto the battlefield directly: no casting, no enters triggers. They are untapped and not
    summoning sick, and each player has 20 life.
- **#16, per board** (6 seats, N permanents each):
  - state-based actions (`checkStateEffects(true)`) and the static layer pass (`checkStaticAbilities`), each the mean
    of 3 runs;
  - the harness's action list for a priority question (`ActionSpace.getPossibleActions`, what a human's prompt and
    the held-pass checks build);
  - one snapshot (`getSnapshotJson`);
  - the AI's payability check (`ComputerUtilMana.canPayManaCost`) and real payment (`payManaCost`) for Bottle Gnomes
    ({3}) and Ulamog's Crusher ({8}) from that board's lands and mana permanents;
  - the AI's attack declaration (`PlayerControllerAi.declareAttackers` at declare attackers, as `PhaseHandler` calls
    it);
  - each defending AI's block declaration (`declareBlockers`), with its life put down to 6 so it has to block.
  - When the AI attacked with fewer than 5 creatures, every creature that could attack was added, round the
    defenders, so that the blocks were measured.
  - A warm-up board (6 × 10) ran first. One sample per size.

  `java -Xmx4g -cp <BigBoardCheck classes>:<harness jar> forge.harness.host.BigBoardCheck decisions 10,20,40,60,75,90,120 6`
  (run from the engine tree)
- **Where the time goes:** a sampler thread took the game thread's stack every 20 ms during one action list and one
  payment at 6 × 60. `... BigBoardCheck sample actions 60` and `... sample pay 60`.
- **#17:**
  - A board of S seats with P permanents each, plus L cards per player in the other zones (70% library, 20%
    graveyard, 10% hand), with `snapshotRecording` on and `enableCheckpointMetrics()`.
  - Any triggers resolved first: a checkpoint is only taken with an empty stack.
  - 40 calls of the session's own `recordCheckpoint` (the turn marker reset each time, so none is skipped as a
    repeat).
  - The heap measured after four `System.gc()` before the game, after it, and after the checkpoints. The session kept
    all 40: `MAX_CHECKPOINTS`, and `CHECKPOINT_TURNS` = 3 doesn't drop any within one turn.
  - `makeCopy` time is from the metrics (`drainCheckpointMetrics`: the copy, then the add and publish).

  `java -Xmx1100m -XX:+UseG1GC ... BigBoardCheck checkpoints <seats> <perSeat> <otherCardsPerPlayer> 40`, and with
  `-Xmx4g` for the boards that don't fit.

## #16: results

| Per seat (permanents / creatures) | State check | Statics pass | Action list (actions) | Snapshot | AI attack (attackers) | AI block, slowest defender (blockers) | AI pay {3} | AI pay {8} |
|---|---|---|---|---|---|---|---|---|
| 10 (60 / 24) | 2 ms | 1 ms | 4 ms (5) | 10 ms | 0.48 s (0 + 4 added) | 13 ms (4) | 13 ms | can't pay |
| 20 (120 / 60) | 12 ms | 5 ms | 35 ms (10) | 31 ms | 1.6 s (1 + 9) | 70 ms (12) | 84 ms | can't pay |
| 40 (240 / 123) | 19 ms | 12 ms | 2.0 s (27) | 24 ms | 5.2 s (0 + 19) | 0.53 s (18) | 0.25 s | 0.68 s |
| **60 (360 / 189)** | 38 ms | 11 ms | **5.1 s** (42) | 31 ms | 5.3 s (29) | **5.0 s (0)** | 1.2 s | **3.2 s** |
| 75 (450 / 235) | 38 ms | 20 ms | 12.6 s (54) | 32 ms | 5.4 s (37) | 5.2 s (0) | 2.3 s | 6.4 s |
| 90 (540 / 282) | 75 ms | 37 ms | **18.5 s** (67) | 30 ms | 5.8 s (45) | 5.6 s (0) | 3.3 s | **10.3 s** |
| 120 (720 / 379) | 126 ms | 44 ms | **46.9 s** (88) | 37 ms | **9.7 s** (61) | 6.5 s (0) | 8.3 s | **23.8 s** |

The blocks' total time over all defenders is the same as the slowest from 60 up: one defender had all the attackers.
At 40 the total was 1.3 s over three defenders.

What it says:
- **State checks, the statics pass and the snapshot stay small.** At most 126 ms, 44 ms and 37 ms at 6 × 120.
- **AI combat is held at about 5 s by its budget** (`AiController.declareAttackers` / `declareBlockersFor`,
  `Game.AI_TIMEOUT` = 5).
  - The attack goes past it at 6 × 120 (9.7 s). The work before the deadline is checked, the attack controller's
    defender prediction, isn't bounded.
  - The budget costs quality. A 6-life defender facing 29 to 61 attackers blocked nothing at 60 per seat and up: the
    deadline passed before its first assignment, and "a partial assignment is legal".
  - At 40 per seat the AI declared no attack in 5.2 s, so the 19 were added by the check.
- **Mana payment has no budget.** It is 3.2 s for {8} at 60 per seat, past 10 s at 90, and 23.8 s at 120.
  - The payability check alone is cheap (4 ms at 60, 55 ms at 120). It is the real payment, which activates each
    mana ability, that costs.
- **The action list has no budget and grows fastest:** 5.1 s at 60, 18.5 s at 90, 46.9 s at 120.
  - It is built for each human priority question and for the held-pass checks (`heldActionsChanged`).
  - So on a board this size a human's question waits seconds before it is even sent.

### Where the time goes (6 × 60, sampled)

- **The action list (5.2 s, 254 samples):**
  - 246 are in `Card.getAllPossibleAbilities` → `GameActionUtil.getAlternativeCosts` → `GameAction.checkStaticAbilities`;
  - 151 of those are in `CardProperty.cardHasProperty`, under `StaticAbilityContinuous.getAffectedCards`.

  Each card's alternative costs run the whole static layer pass again, about 11 ms at this size, for each card looked
  at.
- **The payment ({8}, 3.5 s, 171 samples):**
  - 169 are in `MagicStack.add` → `GameAction.checkStaticAbilities`;
  - 132 of those are in `StaticAbilityContinuous.getAffectedCards`.

  Each mana ability activated goes through `MagicStack.add`, which runs the same pass, and the AI tries many.
- The pass itself grows with the board: 11 ms at 60 per seat, 44 ms at 120. It runs once per card or per mana
  ability, so these two paths grow faster than the board.

## #17: results

| Seats × permanents, + other cards each | Cards in zones | Game heap | Per checkpoint | 40 checkpoints | Heap used at checkpoint 1 / 10 / 40 | `makeCopy` median / max |
|---|---|---|---|---|---|---|
| 4 × 60, + 40 | 400 | 41 MB | 10.7 MB | 428 MB | 102 / 199 / 520 MB | 52 / 144 ms |
| 4 × 125, + 0 (1100 MB cap) | 500 | 68 MB | 13.7 MB | 548 MB | 133 / 256 / 667 MB | 68 / 161 ms |
| 4 × 125, + 100 | 900 | 127 MB | 24.2 MB | 968 MB | 202 / 419 / 1145 MB | 154 / 436 ms |
| 6 × 84, + 60 | 864 | 118 MB | 23.3 MB | 932 MB | 192 / 402 / 1101 MB | 122 / 391 ms |

- **Size:** a checkpoint is about 27 KB per card in the game's zones in every row. It grows with every card in the
  game, not only the battlefield.
- **Under `-Xmx1100m`:** the last two boards ran out of memory before 40 checkpoints. Their numbers are from a
  4 GB heap.
- **The JVM's own heap before the game was 50 MB.** Its card database is loaded lazily, and only the cards used were
  loaded.
  - The node's is larger: the Dockerfile's G1 note says about 450 MB stays reachable, and the server spec says Forge
    idles at about 250 MB.
  - So in the node, the room for the game and its checkpoints is roughly 650 to 850 MB, less G1's working headroom
    (the Dockerfile's note: at 70% of the limit the node sat in permanent reclaim).
- **Time:** `makeCopy` is 50 to 150 ms median and up to 440 ms on these boards. It runs on the game thread at each new
  phase with an empty stack, so on a 900-card game every step pauses for about 0.15 s. Adding and publishing the
  checkpoint is under 0.1 ms.
- **What fits:**

  | Game | Per checkpoint | 40 checkpoints | In about 250 MB |
  |---|---|---|---|
  | Four-player Commander (about 400 cards) | 10.7 MB | about 430 MB | about 23 |
  | Six-player Commander (about 600 cards) | about 16 MB | about 650 MB | about 15 |
  | A 500-permanent board with libraries (about 900 cards) | 24 MB | about 970 MB | about 10 |

  The 40-checkpoint cap fits in 1100 MB only for the smallest games, and only if the card database is small.

## Recommendations

1. **Cap checkpoints by size, not count.**
   - Estimate a checkpoint as about 27 KB × the cards in the game (or measure the first copy).
   - Keep `min(40, budget / estimate)`, with a budget of about 250 MB. That leaves the card database and G1 their room
     in 1100 MB.
   - That is 23 checkpoints for four-player Commander, 15 for six, and 10 on a 500-permanent board.
   - With `CHECKPOINT_TURNS` = 3 and one checkpoint a step, 10 still reach back about a turn.
   - Measure on the native image before settling the budget.
2. **Give AI mana payment a deadline**, like the combat declarations' `AI_TIMEOUT`. Past it, take the first legal
   payment found. Payment is the one AI path here past 10 s (6 × 90).
3. **Treat 6 × 60 distinct permanents as today's limit** for a playable table. There each AI step is about 5 s, a
   human's question is about 5 s, and payment is about 3 s. Past it the waits are 10 to 50 s.
4. **Look into the repeated static pass first**: it is the cost in both unbudgeted paths.
   - `getAlternativeCosts` re-running `checkStaticAbilities` per card in `getAllPossibleAbilities`.
   - `MagicStack.add` re-running it per mana ability during payment.

   A pass reused while nothing changed would take the 5 s action list and the 3 s payment at 6 × 60 down toward the
   tens of milliseconds the pass itself costs. That is an engine change for its own task, with its own tests.
5. **The block budget's cost in quality:** an AI with 6 life that blocks nothing because its time ran out is a
   gameplay problem.
   - A fallback that assigns the obvious chump blocks first, when the budget is nearly gone, would avoid it.
   - Or the budget could scale with the number of attackers.

## Not done

- One sample per board size, on a JVM, not the native image.
- No full game was played at these sizes. The boards were placed, not cast: no enters triggers, no tokens.
- The human's auto-pay button (`AutoPay`) wasn't timed. It pays through the same mana abilities, so it may share the
  payment's cost.
