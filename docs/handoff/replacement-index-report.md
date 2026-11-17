# Report: speeding up replacement checks on a board of many tokens

Cloud session, 2026-11-17, branch `cloud/replacement-index`, from `origin/cloud/engine-stress-caps` (f0e03e5). No Docker
image was built and nothing was checked live.

## What the profile shows

I timed one effect making N 1/1 Servo tokens, with the runaway caps lifted for the test, and recorded it with Java
Flight Recorder at 2500 tokens.

| Board | Tokens made | Time |
| --- | --- | --- |
| bare (40 lands) | 1041 | 2.2 s |
| bare (40 lands) | 2541 | 9.3 s |
| doublers (Doubling Season, Anointed Procession, Parallel Lives, Rest in Peace, Leyline of the Void, Hardened Scales) | 2047 | 6.5 s |
| the same doublers | 4047 | 23.4 s |

Both boards are clearly quadratic.

**Where the time goes in `ReplacementHandler.getReplacementList`** (about 28–34% of all samples, inclusive):

- **76% of it is the two `GameAction.checkStaticAbilities` calls** that every card moving to the battlefield makes
  (CR 614.12, the card as it would be on the battlefield).
  - Each one recomputes the static abilities of the whole board, so a token entering a board of N costs O(N).
  - Inside that, `StaticAbilityDevotion.getDevotionMod` alone is about 16% of all samples: it scans every card's
    static abilities for each player, on every check.
  - Forge's own comment on `Game.DEFAULT_RUNAWAY_TOKENS_PER_EFFECT` already names this cost.
- **About 18% is `LastStateBattlefield.get(c)`.** `FCollection.get(T)` is a linear search, and it ran once per card in
  the game per check.
- **About 7% is the walk over every card's replacement effects.** That's the part an index of "cards that carry
  replacement effects" would save.

## What changed

**`ReplacementHandler.LastStateIndex`.**

- Within one `getReplacementList` call, the last-known battlefield is looked up through a hash map built once. It's
  rebuilt if the collection in `runParams` is replaced or changes size.
- **It gives the same answer:**
  - `FCollection.get(T)` returns the first element equal to the card, or the card itself.
  - The map keeps the first equal element in the collection's order (`putIfAbsent`) and returns the card when there
    is none (`getOrDefault(c, c)`).
  - Cards are equal exactly when their ids, which `hashCode` returns, are equal (`GameEntity.equals`).
- `ReplacementHandler.useLastStateIndex` (public, default `true`) switches back to the linear search, so a test can run
  a board both ways.

The patch adds one section to `forge.patch`, `ReplacementHandler.java`. Upstream's copy of that file at `e7d2b93b` is LF,
not CRLF; `make-patches.sh` keeps the clean tree's line endings, and `git apply --check` passes on Forge `e7d2b93b` with
`core.autocrlf=false`.

## What was not changed, and why

- **An index of cards with replacement effects.** It would save at most the 7% walk.
  - Replacement effects come from the card itself, from statics granted through layers (Master Chef, auras), and
    through LKI copies (`preList`, `LastStateBattlefield`) that aren't in the game's zones.
  - Every grant, layer pass and zone change would have to keep the index right. Too much risk for too little.
- **The static-ability recompute for each entering card.** That's where the quadratic cost really is. It can't be
  removed with the same behaviour guaranteed:
  - **Batching tokens that enter together** (one effect's tokens are created simultaneously) would change what each
    token's ETB replacements see.
  - **Caching `getDevotionMod`** would need to know when any static's conditions change.
  - Both need a design review and a broad regression run, not a drop-in change.

## Tests

**`ReplacementIndexTest` (new), 3 of 3.**

- `aMixedReplacementBoardEndsTheSameBothWays` plays the same board with the linear search, then with the index, and
  compares a full description of the end:
  - each player's battlefield with every card's counters;
  - their graveyard, exile, library size and life;
  - before the wipe, after it, and after a later mill.
- The board:
  - **White:** Doubling Season, Anointed Procession, Parallel Lives, Hardened Scales and Rest in Peace, plus Master
    Chef, whose static grants a Moved replacement to White's commander, and Grizzly Bears.
  - **Blue:** Leyline of the Void, Hardened Scales and Serra Angels.
- What it does:
  1. Tokens for both players, multiplied and with extra counters.
  2. +1/+1 counters on every creature.
  3. A mill.
  4. A wipe of every nonland permanent.
  5. Another mill.
- `leavingReplacementsComeFromTheLastState` checks the result:
  - Rest in Peace and Leyline of the Void die in that same wipe, yet still send every card to exile. They apply
    through their last state, which is the path the index serves.
  - A mill after they're gone fills the graveyards again.
- `manyTokensAreNoSlowerWithTheIndex` times one effect making 1000 and 2500 tokens both ways. The index may not be
  slower than the linear search by more than a quarter (plus 200 ms of noise), and 2500 must finish in under 2 minutes.
- **`engine/test-harness-local.sh --all`:** 30 of 30 classes.

**Timing, linear → indexed:**

| Run | Linear | Indexed |
| --- | --- | --- |
| 1000 tokens, bare | 1.7–2.0 s | 1.2–1.3 s |
| 2500 tokens, bare | 7.0–7.5 s | 6.2–6.5 s |
| 4047 tokens, doublers | 23.4 s | 20.9 s |

That's about 10–30%. It doesn't remove the quadratic shape, for the reasons above.

## Break-its

3 break-its, each compiled over the jar. All 3 are caught by name, and the file was restored and checked by sha256.

| Mutation | Fails |
| --- | --- |
| the index ignores the last state (returns the card) | leavingReplacementsComeFromTheLastState ("cards still reached a graveyard"), aMixedReplacementBoardEndsTheSameBothWays |
| (the same, aimed at the comparison) | aMixedReplacementBoardEndsTheSameBothWays ("the board ends differently") |
| the index rebuilt for every card | manyTokensAreNoSlowerWithTheIndex ("1000 tokens took 3338 ms with the index, 1670 ms without") |

## Left

- The real fix for quadratic token creation is the recompute for each entering card (batching, or an incremental
  devotion and static pass). That needs design work.
- The runaway cap of 100 tokens per effect (`Game.DEFAULT_RUNAWAY_TOKENS_PER_EFFECT`) stays as it is. The test lifts it
  only for itself.
