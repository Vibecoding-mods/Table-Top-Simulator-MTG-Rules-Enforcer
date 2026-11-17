# Big turns benchmark: how far the token and trigger limits can go

Measured 2026-11-16 on branch `bench-limits` (from `big-turns` cee1f5f; benchmark code only, never to be merged).
Question: the highest per-effect token cap and trigger limits that don't hurt performance, and what breaks first
(Forge, bridge, Lua).

**Short answer**
- **Token cap per effect: 500** (`Game.DEFAULT_RUNAWAY_TOKENS_PER_EFFECT`, the "UNBOUNDED_TOKENS" number). Up to 500
  tokens from one effect cost Forge under 1 s. 1,000 cost 2-5.6 s, and everything after that grows with the square
  of the board.
- **The real limit is the board, not one effect.** At about 1,000 tokens on the battlefield, every step costs about 1 s
  or more: per-viewer snapshots, rewind checkpoints, combat, and the table's Lua. At 2,500 that becomes several seconds.
- **The first thing to fail is Forge plus our harness, both quadratic.** The bridge is linear and stays under ~1 s at 10,000
  tokens. The Lua table is linear too and keeps the object count flat, but real TTS needs about 1 s per board at
  ~1,000 tokens (an estimate).
- **Trigger exhaust batch: keep 20.** 20 triggers are 0.3 s on a small board and 1-2 s of real Scute-copy triggers.
- **Runaway limits:** ask at **5,000 triggers per turn** and **2,500 cards created per turn** (today both are 25,000).
  Past 2,500 every step is seconds, and a loop would run 6-27 minutes before anyone is asked at 25,000.
- **Wrath of God is the steepest curve:** 0.84 s at 500 tokens, 6.8 s at 1,000, 75 s at 2,500. Combat follows:
  1,000 attackers take ~67 s with an AI declaring.

## 1. How it was measured

- **Engine:** `BigTurnsBench` (benchmark class in the harness tests, `forge-harness/src/test/java/forge/harness/host/`,
  kept in the scratchpad copy and on branch `bench-limits` as `engine/bench/BigTurnsBench.java`).
  - It ran in `mtg-harness-test:l2-ai`, with the big-turns Forge files (StackMerge, the runaway ask) compiled on top as
    an overlay. The deployed images were never touched.
  - Setup: `--cpus=2`, `-Xmx4g -XX:+UseSerialGC`, every runaway cap lifted (`setRunaway*Cap(0)`), one warm-up pass at 20.
  - Two AI players. N tokens are 2/2 vanilla creatures on Blue's side, or 1/1 Saprolings made by
    `DB$ Token | TokenAmount$ X`.
  - A step longer than the budget (90 s, 45 s for section 3) skips the bigger sizes.
- **Bridge:** `tests/bench_limits_bridge.js`. This is the real `bridge.js` through `tests/bridge-harness.js`, fed a fake
  engine state: N tokens of K kinds, plus a stack of S identical untargeted triggers. Times are the median of 3.
- **Table:** `tests/bench_limits_table.js`. This is the real Global (`buildSave`) on fengari plus the fake TTS
  (`tests/lua/tts-sim.lua`). Real TTS was not touched.
- **Profiling:** the `profile` op samples the main thread's stack every 10 ms during one snapshot and one 100-token
  effect at 2,500 tokens.
- **Raw output:**
  - Scratchpad: `<scratchpad>/bench/`
    (`runA.out`, `runB.out`, `runC.out`, `runP.out`, `bridge-*.out`, `table-*.out`; real 1,000-10,000-token snapshots
    in `out/`).
  - Copied to `tmp/wt-bench/engine/bench/` on the branch.
- **Caveats:**
  - Live Forge runs as a GraalVM native image inside `stack-forge-room-1`, not on this JVM, so absolute times differ
    somewhat. The shapes (linear or quadratic) and the byte counts carry over.
  - The smallest "create" rows ran right after warm-up, so they are JIT-cold. The "doubled" rows ran warm and are the
    better guide for creation cost.

## 2. Results

### 2.1 Engine (Forge + harness), N tokens

**Token creation** (one effect onto an empty board; doubled = 3 Parallel Lives, so N/8 is asked for):

| N | create X (cold) | doubled ×8 (warm) | +100 onto a board of N | +1 onto a board of N | heap after |
|---|---|---|---|---|---|
| 50 | 0.29 s | 0.10 s | 0.09 s | 8 ms | 54 MB |
| 100 | 0.59 s | 0.08 s | 0.12 s | 12 ms | 55 MB |
| 250 | 1.16 s | 0.42 s | 0.37 s | 14 ms | 64 MB |
| 500 | 2.6 s | 0.57 s | 0.91 s | 23 ms | 69 MB |
| 1,000 | 5.6 s | 2.0 s | 2.0 s | 44 ms | 92 MB |
| 2,500 | 17.1 s | 14.3 s | 11.0 s | 454 ms | 135 MB |
| 5,000 | 84 s | 83 s | 45 s | 1.4 s | 219 MB |
| 10,000 | 496 s | 547 s | 139 s | 4.5 s | 386 MB |

**A board of N at rest: what each prompt and update costs** (snapshot = one viewer's state JSON; every update builds one per
person; checkpoint = the rewind save, `GameSnapshot.makeCopy`, taken once per phase with an empty stack):

| N | snapshot | snapshot size | action list | checkpoint | checkpoint heap | restore | AI priority | heap (board) |
|---|---|---|---|---|---|---|---|---|
| 50 | 7 ms | 60 KB | 1.6 ms | 8 ms | 1 MB | 9 ms | 18 ms | 53 MB |
| 100 | 10 ms | 111 KB | 2.0 ms | 9 ms | 2 MB | 8 ms | 7 ms | 54 MB |
| 250 | 28 ms | 265 KB | 8 ms | 21 ms | 4 MB | 6 ms | 8 ms | 57 MB |
| 500 | 35 ms | 521 KB | 8 ms | 29 ms | 8 MB | 24 ms | 15 ms | 61 MB |
| 1,000 | 153 ms | 1.0 MB | 10 ms | 193 ms | 15 MB | 81 ms | 49 ms | 69 MB |
| 2,500 | 906 ms | 2.5 MB | 51 ms | 643 ms | 47 MB | 429 ms | 107 ms | 93 MB |
| 5,000 | 6.9 s | 5.0 MB | 97 ms | 2.2 s | 77 MB | 1.4 s | 94 ms | 133 MB |
| 10,000 | 67.6 s | 10.0 MB | 186 ms | 11.1 s | 155 MB | 8.5 s | 235 ms | 213 MB |

The "create" runs measured the snapshot of the Saproling board as well: 0.47 s at 1,000, 1.9 s at 2,500, 8.7 s at
5,000 and 65 s at 10,000 (about 1.07 KB per token).

**Combat with N attackers** (Forge's declare-attackers step with the AI deciding, the same declaration made by hand, the
defending AI's blocks, then combat damage to a player):

| N | AI declares | declared by hand | AI blocks | combat damage | snapshot in combat |
|---|---|---|---|---|---|
| 50 | 0.36 s | 15 ms | 2 ms | 0.14 s | 24 ms |
| 100 | 0.64 s | 76 ms | 7 ms | 0.26 s | 28 ms |
| 250 | 4.2 s | 0.43 s | 17 ms | 1.1 s | 67 ms |
| 500 | 6.1 s | 1.6 s | 55 ms | 4.7 s | 193 ms |
| 1,000 | 27.6 s | 13.7 s | 156 ms | 38.9 s | 720 ms |
| 2,500 | not finished (the run hit its container time limit) | | | | |

**A board wipe and "for each creature"** (Wrath of God over N; gain X life with X = creatures you control; Craterhoof-style
PumpAll +X/+X and trample to each):

| N | Wrath of God | gain X life (one count) | PumpAll +X/+X (N pumps) |
|---|---|---|---|
| 50 | 16 ms | 0.7 ms | 18 ms |
| 100 | 38 ms | 0.7 ms | 43 ms |
| 250 | 187 ms | 2.6 ms | 51 ms |
| 500 | 0.84 s | 4.5 ms | 107 ms |
| 1,000 | 6.8 s | 7 ms | 193 ms |
| 2,500 | 75 s | 16 ms | 0.78 s |
| 5,000 | skipped (over budget) | 34 ms | 3.4 s |
| 10,000 | skipped | 115 ms | 22.2 s |

- **The wipe is the steepest curve measured.** It roughly multiplies by 8-11 for each doubling of N, so 1,000 tokens is
  already 6.8 s.
- **Counting is cheap.** A count is linear, about 10 µs per card.
- **Pumping every creature** is linear up to ~1,000 and quadratic after that.

### 2.2 Where the quadratic time goes (profile at 2,500 tokens)

- **The snapshot** (3.6 s for one viewer, under the profiler) is our own harness code:
  - 73% is `InteractiveSnapshotExtractor.combatFlags`, which works out "can attack / can block" for every creature.
  - That calls `CombatUtil.canAttack` and `canBlock`, and each call walks every static ability on every card
    (`StaticAbilityCantAttackBlock.cantAttack/cantBlock`, `StaticAbilityMustAttack.entitiesMustAttack`). That is
    N creatures × N cards.
  - Gson serialization is only 9%.
  - **This is fixable in the harness.** Ideas: compute the flags once per token kind, or gather the battlefield's
    CantAttack/CantBlock/MustAttack statics once per snapshot and skip the per-card scan when there are none.
- **A token effect** (14.9 s for 100 tokens onto 2,500) is Forge's own code:
  - 78% is `ReplacementHandler.getReplacementList` → `Game.forEachCardInGame`. Every token that moves to the
    battlefield visits every card in the game to look for replacement effects.
  - Another 14% is `GameAction.checkStaticAbilities`.
  - This is the same N² as Second Harvest in `docs/big-turns.md`. Fixing it means a Forge-wide change: an index of the
    cards that have replacement effects.
- **Combat** is Forge plus the AI. The AI's attack planning and the damage step (one damage event per attacker, each
  with its own replacement and trigger pass) both grow faster than N.

### 2.3 Bridge (`bench_limits_bridge.js`), N tokens, ms per engine step

| N | engine state | JSON.parse | first board | patch | log diff | table message | prompt | step total | node heap |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 12 KB | 0.1 | 122 | 0.2 | 1.5 | 4.3 | 0.4 | 6.5 | 42 MB |
| 100 | 22 KB | 0.2 | 119 | 0.1 | 3.2 | 7.0 | 0.2 | 10.7 | 71 MB |
| 250 | 54 KB | 0.3 | 157 | 0.1 | 5.3 | 14.2 | 0.2 | 20.1 | 79 MB |
| 500 | 106 KB | 0.7 | 99 | 0.2 | 17.6 | 30.6 | 0.3 | 49.4 | 115 MB |
| 1,000 | 211 KB | 1.8 | 142 | 0.5 | 43 | 163 | 1.3 | 209 | 143 MB |
| 2,500 | 526 KB | 3.6 | 213 | 0.6 | 80 | 165 | 11.5 | 261 | 191 MB |
| 5,000 | 1.05 MB | 6.9 | 320 | 2.7 | 153 | 325 | 36 | 523 | 281 MB |
| 10,000 | 2.1 MB | 15.7 | 626 | 4.4 | 321 | 659 | 74 | 1,074 | 587 MB |

- With 10 kinds the rows are the same within noise (10,000: 1,003 ms per step).
- With a stack of N identical triggers as well (Impact Tremors, stack = N), the state is 6 MB at 10,000 and the step
  takes 1.4 s.
- The bridge is linear everywhere and stays under ~0.5 s per step up to 5,000 tokens.
- The real engine state is about 5 times this synthetic one (1 KB per token, section 2.1). JSON.parse is ~7 ms per MB,
  so that adds little.
- (The bridge harness's fake TTS socket stopped delivering boards over ~1,000 tokens in this setup, so the table bytes
  are taken from the table bench below. The bridge's build time, `tableMs`, is measured either way.)

### 2.4 Table (`bench_limits_table.js`, fengari, not MoonSharp)

| N | board message | strings | engineJsonDecode | board handler (first / next) | objects (1 kind / 10 kinds) | real TTS estimate per board |
|---|---|---|---|---|---|---|
| 50 | 5 KB | 705 | 37 ms (cold) | 127 / 63 ms | 1/147, 10/156 | ~0.2 s |
| 100 | 9 KB | 1,305 | 13 ms | 112 / 70 ms | same | ~0.25 s |
| 250 | 20 KB | 3,105 | 41 ms | 252 / 214 ms | same | ~0.7 s |
| 500 | 39 KB | 6,105 | 59 ms | 310 / 183 ms | same | ~0.6 s |
| 1,000 | 78 KB | 12,105 | 100 ms | 531 / 357 ms | same | ~1.2 s |
| 2,500 | 195 KB | 30,105 | 231 ms | 1,217 / 897 ms | same | ~3 s |
| 5,000 | 391 KB | 60,105 | 510 ms | 2,504 / 1,931 ms | same | ~6.5 s |
| 10,000 | 781 KB | 120,105 | 1,092 ms | 4,689 / 3,790 ms | same | ~13 s |

- **The object count is flat,** confirmed: one table object per token kind at every size (147 objects with 1 kind, 156
  with 10). The 30 frames after a board stay at 4-30 ms at any size.
- **The Lua cost is not flat:**
  - It is linear in the message: about 78 bytes and 12 strings per token, and about 0.38 ms per token in fengari.
  - The handler walks every token: decode, `groupTokens`, `engineTokenKey`.
- **The real-TTS column is an estimate.**
  - `engineJsonDecode` was measured on real TTS at 236 ms for 56 KB (`tmp/json-decode/bench.md`). Fengari decodes
    about 3.4 times faster than that, and the column applies the same factor to the whole handler.
  - In TTS the board handler runs on the frame, so that time is a freeze.
  - The fake TTS also skips Unity's own per-frame cost, which the flat object count keeps small.

## 3. N identical triggers (Impact Tremors, one per token entering)

**How the run was set up:**
- Impact Tremors is on Blue's battlefield, and one effect makes N Saprolings, so N triggers go on the stack.
- Each trigger then resolves the way a held exhaust pass does it: resolve, state-based actions, new triggers, and the
  `exhaustEnded` check.
- After every 20 the table "catches up": the action list plus both viewers' snapshots, which is what each return of a
  held pass costs.
- 45 s budget. At 1,000 the run stopped after 421 triggers and the rest is projected.

| N tokens = triggers | make the tokens | put N triggers on the stack | per trigger | one held batch of 20 | catch-up every 20 | whole run |
|---|---|---|---|---|---|---|
| 50 | 0.18 s | 47 ms | 15.7 ms | 0.26-0.37 s | 58 ms | 0.9 s |
| 100 | 0.35 s | 33 ms | 15.1 ms | 0.24-0.35 s | 59 ms | 1.8 s |
| 250 | 0.39 s | 82 ms | 17.2 ms | 0.25-0.38 s | 101 ms | 5.5 s |
| 500 | 0.73 s | 246 ms | 26.6 ms | 0.49-0.57 s | 194 ms | 18.1 s |
| 1,000 | 2.2 s | 644 ms | 64.8 ms | 0.98-1.11 s | 856 ms | ~108 s (projected) |

- **A trigger's own cost depends on the board, not on the stack.** It is ~15 ms up to 250 tokens on the battlefield,
  27 ms at 500 and 65 ms at 1,000.
- **The held-pass check is free** (`exhaustEnded` at 0.01-0.04 ms, even with 1,000 items on the stack).
- **The catch-up costs:** about 60 ms per batch on small boards, and 0.86 s at 1,000 tokens, which is the snapshot's N²
  again.
- **For comparison, the live Scute Swarm triggers cost 56-115 ms each** (copies of a card with its own landfall
  trigger; `docs/big-turns.md` §2). A batch of 20 of those is 1.1-2.3 s.

## 4. The knee

| Part | Under ~1 s per step up to | Breaks down at | Why |
|---|---|---|---|
| Forge: one token effect | 500 tokens from one effect (0.6 s warm) | 1,000 (2-5.6 s), 2,500 (14-17 s) | Each new token scans every card for replacements (N²) |
| Harness: snapshot per viewer | 1,000 tokens on board (0.15-0.47 s; ×3-4 people per update) | 2,500 (0.9-1.9 s each), 5,000 (7-9 s) | `combatFlags`: canAttack/canBlock per creature over every static (N²) |
| Harness: rewind checkpoint | 1,000 (0.19 s, 15 MB each) | 2,500 (0.64 s, 47 MB), 5,000 (2.2 s, 77 MB) | Full game copy once per phase; up to ~4 turns of them are kept |
| Forge + AI: combat | ~100-250 attackers | 500 (6 s AI declare + 4.7 s damage), 1,000 (67 s) | AI attack planning, and one damage event per attacker |
| Forge: board wipe | ~500 (0.84 s) | 1,000 (6.8 s), 2,500 (75 s) | Each destroyed card's zone change rescans the game |
| Forge: N triggers in a row | 20 per batch on any board ≤ 1,000 (0.3-1.1 s) | per trigger 65 ms at 1,000 tokens; whole run of 1,000 ≈ 108 s | Each resolution's state check and statics pass walk the board |
| Bridge | 5,000 tokens (0.5 s) | 10,000 (1.1-1.4 s) | Linear: log diff and table message |
| Table Lua (real TTS, estimated) | ~750 tokens | 1,000 (~1.2 s per board), 2,500 (~3 s) | Linear: decoding and grouping every token on every board |

**Memory:**
- Forge's heap for the board itself stays small: 213 MB at 10,000.
- The checkpoints are what blow it up. The harness keeps one per phase with a person's priority over the last
  `CHECKPOINT_TURNS` (3) turns plus the current one, so about 30-40 copies:
  - 1,000 tokens: about 0.5 GB;
  - 2,500 tokens: about 1.5-2 GB, past the Java backend's 1 GB default heap (`SELF_HOSTED_NODE_JAVA_HEAP_MB`);
  - the WSL VM has 8 GB with about 1 GB free.
- With `-XX:+ExitOnOutOfMemoryError` the engine process dies rather than slowing down. Memory, not time, is what can
  crash a game.

## 5. Recommendations

1. **Token cap per effect: 500** (`Game.DEFAULT_RUNAWAY_TOKENS_PER_EFFECT`, today 100; the number Agent A's
   `Game.UNBOUNDED_TOKENS` needs).
   - Up to 500, one effect costs Forge under 1 s with doublers (0.57 s), and that board still renders, snapshots and
     checkpoints in well under 1 s.
   - Above it the ask still comes ("Keep going" allows that size once).
   - Don't go to 1,000: one effect is then 2-5.6 s inside Forge with no prompt, and the board it leaves is at the knee
     of every other row.
2. **Cards created per turn: about 2,500,** instead of 25,000.
   - Past 2,500 tokens every step is seconds (snapshot 0.9-1.9 s per viewer, a checkpoint 0.6 s and 47 MB) and creation is
     quadratic.
   - 25,000 can never be reached in a playable time: 10,000 alone took 8-9 minutes in Forge.
   - The cap is an ask, so a player can still go past it.
3. **Trigger exhaust batch: keep 20** (`EXHAUST_RESOLUTIONS` = `HELD_RESOLUTIONS`).
   - 20 cheap triggers are 0.3 s and 20 real Scute-copy triggers are 1-2 s. That is about the longest the table should
     go without an update, and how soon `mtg stop` lands.
   - A bigger batch saves only the catch-up: 60 ms per 20 on small boards, so 50 would save ~5% of a run. On a big board
     the catch-up is the slow snapshot, and a bigger batch would only make each freeze longer.
   - If it is ever changed, make it adaptive (for example "stop the batch after ~1 s of resolving") rather than a bigger
     number.
4. **Triggers per turn (runaway ask): 5,000,** instead of 25,000.
   - Each trigger costs at least ~15 ms in Forge, and 65 ms or more on a 1,000-token board. A real loop therefore reaches
     5,000 after about 1.5-5 minutes of resolving, and 25,000 only after 6-27 minutes with nobody asked.
   - A huge but finite turn loses nothing at 5,000: "Keep going" allows another 5,000, three times a turn.
5. **What to fix first, by payoff:**
   1. **Harness snapshot `combatFlags`** (our code, not Forge): it is N² and runs once per viewer on every update.
      Caching the statics scan per snapshot should make the snapshot linear, about 0.2 s at 2,500 tokens instead of 0.9-1.9 s.
   2. **Checkpoint memory:**
      - skip the per-phase checkpoint, or keep fewer, when the board is huge (for example over 1,000 cards);
      - or raise the engine heap. Either avoids an out-of-memory kill.
   3. **Table:** send a token stack as one entry with a count and an id list (`docs/big-turns.md` §4.2, not built).
      The message and the Lua then scale with the number of kinds, not of tokens.
   4. **Forge's replacement scan per moved card** (N²): a Forge-wide change, the same one Second Harvest needs.
