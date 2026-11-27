# Report: engine stress caps

Cloud session, 2026-11-17, branch `cloud/engine-stress-caps`, from `origin/cloud/three-headed-giant` (b9d3c34, its
engine patches). No Docker image was built and nothing was checked live.

## The four items

1. **Mana X up to 999, by binary search.**
   - **The new method:** Forge `ComputerUtilMana.determineLeftoverMana(sa, player, effect, cap)` finds the largest
     payable X up to `cap` by halving. That works because if X can be paid, so can any smaller X. `XMax` still limits
     it.
   - **Who uses it:** the harness's two calls use it with `ComputerUtilMana.HUMAN_X_LIMIT = 999`. One is the X
     question in `ManaBrewInteractiveController.announceRequirements`; the other is Waterbend's X in
     `HarnessPlayPlumbing`.
   - **Unchanged:** Forge's own AI keeps its linear scan to 99, so the AI plays as before.
   - **Measured** (300 Mountains, Blaze): the binary search finds X = 299 in about 0.6–0.8 s, about 10 payment
     checks. The old scan stopped at 99 and took about 2.9 s.
   - **Not changed:** `FREE_X_MAX = 99`, the X range for a spell cast without paying its mana cost. It's a different
     limit, where mana doesn't bound X.
2. **At most 40 restore points.**
   - `ManaBrewInteractiveSession.addCheckpoint` still drops points older than `CHECKPOINT_TURNS`, and now also drops
     the oldest while more than `MAX_CHECKPOINTS = 40` are kept. That covers extra combats within one turn.
   - **Measured** with the session's own checkpoint metrics (`enableCheckpointMetrics`, `drainCheckpointMetrics`) on 60
     points taken in one turn. The board was 2 players, each with 20 lands in play and a 60-card library:
     - one copy (`saveState`): median about 11–16 ms, the slowest about 45–72 ms;
     - heap for the 40 kept: about 112 MB, about 2.8 MB each (`System.gc` before and after);
     - a bigger board costs more per copy. 40 copies of a busy 4-player board could be several hundred MB, under the
       1100 MB node heap but not by a wide margin.
3. **Life, counters and doubling clamped at 2^30**, so nothing wraps and Guava's Multiset never sees an out-of-range
   count.
   - **The helper:** `GameEntity.NUMBER_CAP = 1 << 30` and `GameEntity.capped(long)`, which clamps to ±2^30.
   - **Life:**
     - `gainLife` and `loseLife` clamp the total, and the this-turn gained and lost amounts.
     - `setLife` clamps its target and works out the difference in long.
     - From -2^30 the largest int gain stops at 2^30 - 1, one short. Reaching 2^30 would need a gain bigger than an
       int, or two gains, which would fire lifegain triggers twice.
   - **Counters:**
     - `Card` and `Player.addCounterInternal` add up to the cap, and the amount reported as added, which the counter
       triggers and the counter table see, is what was really added.
     - `GameEntity.setCounters` keeps a count in 0..2^30.
   - **X maths:** `Twice`, `Thrice` and `Times.N` in `AbilityUtils.doXMath` clamp.
   - **What's sent:** the clamped value, so a life total at the cap is sent as 1073741824. The table can show ∞ at
     2^30 or more.
   - **Not changed:** `Player.addCounterInternal` runs `CounterAdded` once per counter added, which would be slow for a
     huge amount of player counters. That existed before.
4. **The event ring at 4096** (`EngineEventLog.CAPACITY`, from 512).
   - **Measured** after 5000 zone moves:

     | Ring | Snapshot | Build time |
     | --- | --- | --- |
     | empty | about 3 KB | |
     | 512 (old limit) | about 56 KB | |
     | 4096 (full) | about 463 KB | about 14 ms per snapshot in Java, per viewer, before the node parses it |

   - Each event is about 113 bytes. A long game reaches the full ring: every zone move is an event.
   - **Over the wire:** the bridge gets the relay's id-keyed patches, so only new entries travel to it. The cost is in
     Java and in the node, once per viewer per update.
   - **"Only the new events" wasn't done; it isn't cheap safely.** Each viewer's snapshot would have to remember what it
     last sent, but the node also takes viewer-0 snapshots for its own use (`java_backend.rs` lines 98, 2204 and
     2495). Those would swallow events meant for seat 0. Doing it properly needs a cursor the node passes in. That is
     protocol and node work, worth doing if 14 ms per snapshot shows in play.

## Tests

- **`StressCapsTest` (new): 8 of 8.**
  - `manaXGoesPast99WithABinarySearch`: 300, 4 and 0 lands; the AI's search is still 99.
  - `theXPromptOffersEveryPayableX`: the real `chooseNumber` question offers up to 299 and the answer comes back.
  - `restorePointsAreCappedAt40OldestFirst` (renamed `...KeepingTheTurnsFirst` on 2026-11-17: 60 points in one turn now keep 1 and 22..60): 60 points taken by the session's own `recordCheckpoint`; ids 21..60 kept.
  - `lifeStopsAtTheCapBothWays`.
  - `countersStopAtTheCapWithoutThrowing`, including the amount reported added.
  - `twiceAndThriceStopAtTheCap`.
  - `theSnapshotSendsTheCappedLife`.
  - `theEventRingKeeps4096`: 905..5000 kept.
- **`engine/test-harness-local.sh --all`:** 29 of 29 classes.
- **`test_bridge_golden`:** all 1079 scenarios match. The bridge is unchanged.

## Break-its

16 mutations, each compiled over the jar and run against `StressCapsTest`. **16 caught by name, 0 escaped**, and each file
was restored and checked by sha256.

| Mutation | Fails |
| --- | --- |
| the search capped at 99 | manaXGoesPast99WithABinarySearch ("... is 99, not 299"), theXPromptOffersEveryPayableX |
| the search one short | manaXGoesPast99WithABinarySearch ("... is 298, not 299") |
| the X question on the old search | theXPromptOffersEveryPayableX ("offers up to 99, not 299") |
| no restore-point cap | restorePointsAreCappedAt40OldestFirst ("kept 60, not 40") |
| the newest dropped | restorePointsAreCappedAt40OldestFirst ("the points kept are 1..40, not the newest 21..60") |
| life gain unclamped | lifeStopsAtTheCapBothWays ("two huge gains left life at 18"), theSnapshotSendsTheCappedLife |
| life loss unclamped | lifeStopsAtTheCapBothWays ("... left life at 1073741826, not -2^30") |
| life lost this turn unclamped | lifeStopsAtTheCapBothWays ("wrapped to -2") |
| `setLife`'s difference in int | lifeStopsAtTheCapBothWays ("... left life at -1073741824") |
| card counters unclamped | countersStopAtTheCapWithoutThrowing ("+1/+1 counters after two huge adds: 0") |
| `setCounters` unclamped | countersStopAtTheCapWithoutThrowing ("left 2147483647") |
| player counters unclamped | countersStopAtTheCapWithoutThrowing (Guava's `IllegalArgumentException: too many occurrences`) |
| Twice / Thrice / Times unclamped | twiceAndThriceStopAtTheCap ("2^30 twice is -2147483648", "thrice is -1073741824", "times 4 is 0") |
| the ring back at 512 | theEventRingKeeps4096 ("5000 moves left 512 events") |

Two break-its from the first run were fixed, not dropped:

- **`HUMAN_X_LIMIT = 99`** never took effect. Java copies a `static final` constant into the classes that use it, so
  recompiling only `ComputerUtilMana` changed nothing. The search's own bound is broken instead.
- **`while (false)`** doesn't compile in Java (unreachable code). It became a cap of 1040.

One check was added after the first run. With the player clamp removed, the stored count stayed right, because
`setCounters` clamps it, so that break-it escaped. The test now also checks the amount reported added, which the counter
triggers and the counter table see.

## Patches

- `engine/make-patches.sh` was run against clean trees at Manabrew `fd16e2f` and Forge `e7d2b93b`, with
  `core.autocrlf=false`.
- Only these sections differ:
  - **Forge:** `ComputerUtilMana`, `GameEntity`, `AbilityUtils`, `Card`, `Player`;
  - **Manabrew:** `HarnessPlayPlumbing`, `EngineEventLog`, `ManaBrewInteractiveController`,
    `ManaBrewInteractiveSession`, and the new `StressCapsTest`.
- Both pass `git apply --check`.
- No comments in the harness Java; Forge has short ones.
