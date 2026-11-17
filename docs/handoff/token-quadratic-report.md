# Report: quadratic token creation

Cloud session, 2026-11-17, branch `cloud/token-quadratic` from `origin/cloud/opening-hand` (ad44b80, with the
opening-hand review fix). The engine change is `engine1122-tokenbatch` in `docs/engine-changes.md`.
- Forge only: no protocol change, so no Rust literal.
- Not built into an image, not tried live. No permission prompt is pending.

## 1. Measurement (`engine/checks/TokenBench.java`, new)

**The bench:** White has Glorious Anthem, Intangible Virtue, Honor of the Pure, Field Marshal and 20 Plains; Blue has 20
Grizzly Bears; with or without Anointed Procession. It resolves one `Token` effect of white 1/1 Soldiers and reports
the ms, the ms per token, the static passes (`GameAction.getStaticPasses`) and the state check after.
- Modes: `sizes`, `piles` (several kinds of 500 on one board), `callers` (which callers run the static passes) and
  `hot` (a sampler).
- **`Game.UNBOUNDED_TOKENS` caps one effect (and one pile) at 500** (big-turns-2). So 2,000 is measured as four kinds
  of 500 on one board.

**Before (same container, one sample each, with the doubler):**

| Tokens made | Time | Per token | Static passes |
|---|---|---|---|
| 10 | 0.6 s | 60 ms | 120 |
| 24 | 0.7 s | 28 ms | 288 |
| 50 | 1.7 s | 35 ms | 600 |
| 100 | 5.2 s | 52 ms | 1,200 |
| 200 | 20.7 s | 104 ms | 2,400 |

- 12 full static passes per token, each over the whole board, which grows with the tokens: quadratic.
- 500 wasn't run before the change: one try ran more than 13 minutes without finishing.

**Where the 12 come from** (`callers` mode):
- 10 are `ReplacementHandler.getReplacementList`. For a card moving to the battlefield, each of the 5 replacement
  layers does the CR 614.12 lookahead: one full pass with the card as it would be on the battlefield, and one to
  reset after it.
- 2 are `GameAction.changeZone`'s own: before registering the card's triggers, and after its ETB counters.
- Triggers were already batched: each token's zone change waits and is collected and checked after the effect.

## 2. What changed (`forge.patch`: `TokenEffectBase`, `ReplacementHandler`, `AbilityKey`)

`TokenEffectBase.makeTokenTable` makes one effect's tokens of one kind (one prototype, after the CreateToken
replacements such as Anointed Procession) as a batch:
- **The first token enters as before**, with every pass and the full replacement check.
- **`ReplacementHandler.MovedBatch`** (passed in the move's params as `AbilityKey.MovedBatch`) records whether any
  replacement effect could apply to that first token at any layer. Only the token's own outermost check decides: when
  one applies, `run` calls itself again for the updated event, where the effect already applied isn't found.
  `TokenBatchTest` caught exactly that bug in my first version (1 of 20 tokens entered tapped).
- **When none could apply,** the rest of that kind:
  - skip the enter-the-battlefield replacement check;
  - enter with the static checks held (`setHoldCheckingStaticAbilities`, as Forge's own state-based actions do for
    creatures dying at once);
  - then one pass runs.
- **Why that keeps the rules (603.2, 603.6a, 614.12):**
  - **Triggers:** each token still triggers on its own. Its zone change trigger waits as before, and is collected and
    checked after the effect, by which time the layers are applied (a static pass doesn't collect triggers: the state
    check after the effect does). Each token also still gets its ETB counters from the table.
  - **Replacements:** the rest are copies of the first, entering at the same time. Replacement effects of permanents
    entering simultaneously don't apply to each other (614.12). And since nothing was replaced, nothing else changed,
    so a replacement that couldn't apply to the first can't apply to them.
  - **Layers:** applied once to all of them, after they are all on the battlefield.
- **Not batched** (today's per-token path):
  - copies of permanents (`clone`, `getCopiedPermanent`);
  - tokens attached as they're made (`AttachedTo`: the attach check needs its own pass);
  - tokens made with counters (`WithCountersType`: a trigger a static grants for counters must be registered first);
  - a kind where a replacement applied to the first token, or was found for it;
  - a single token.

**After (same bench):**

| Tokens made | Before | After | Static passes |
|---|---|---|---|
| 10 | 0.6 s | 0.18 s | 120 → 13 |
| 50 | 1.7 s | 0.10 s | 600 → 13 |
| 200 | 20.7 s | **0.33 s** | 2,400 → 13 |
| 500 | over 13 min (not finished) | **0.44 s** (0.5 s without the doubler) | → 13 |
| 4 × 500 on one board (by board size) | not run | 0.9 / 5.0 / 22.7 / 34.7 s | 13 each |

**What remains is per pass, not per token.**
- One effect is 13 passes at any size: the first token's 10-pass lookahead, the end pass, and the two of its own
  `changeZone`.
- On a board of 1,000 or more permanents a pass costs about 1.5 s here. The sampler puts it in `Card.updateKeywords`
  and `CardView.updateAbilityText` for every card the anthems touch (`checkStaticAbilities` → `updateKeywords`).
  The state check after the effect (7 to 11 s at those sizes) is the same cost.
- **Next steps** (not done; they change every card entering the battlefield, not only tokens, so they need their own
  review):
  - do the 614.12 lookahead once per `run`, not once per layer: 10 → 2 passes;
  - make a pass's view updates cheaper on big boards.

## 3. Tests: `TokenBatchTest`, 10 checks (new)

**Counters, not timing:** `TokenEffectBase.getTokensBatched`, `ReplacementHandler.getMovedChecks` and
`GameAction.getStaticPasses`, plus one loose timing check.
- **Layers:** 30 tokens on the anthem board are all 5/5, first strike and vigilance; 29 of them batched.
- **Passes:** 20 tokens and 200 tokens take the same number of static passes (20 at most).
- **Lookahead:** one enter-the-battlefield replacement check for 50 tokens of one kind.
- **Triggers:** with Soul Warden, 40 tokens make 40 triggers.
- **Replacements:**
  - under Authority of the Consuls (Blue's), all 20 of White's tokens enter tapped, none batched;
  - under Grumgully, the Generous, all 20 get a +1/+1 counter, none batched.
- **With counters:** `WithCountersType` tokens each get 2 counters, none batched.
- **Hold:** the static checks aren't held after the effect, and a creature added later gets the anthems.
- **Doubler:** with Anointed Procession, 25 becomes 50, and 49 are batched.
- **Sanity:** 400 tokens on the anthem board in under 15 s (0.4 s here).
- **Written after the code.** The two replacement checks were red against my first version. The break-it shows each
  check failing without its piece.

**Break-it: `node tools/mutate-token-batch.js <tree>`: 9 of 9 caught by name**, every file restored by sha256. The
mutations:
- no batch;
- the rest not held;
- no pass after the batch;
- the hold not released;
- tokens made with counters batched;
- the lookahead not skipped;
- the updated event's check deciding too (the bug above);
- lookahead checks not counted;
- batched tokens not counted.

**Not a mutation: `replacersFound`.** It stops a batch when a replacement was found for the first token but didn't
replace it, such as a declined optional one: each later token must get its own choice. No card in Forge's pool gives
an entering token an optional replacement from another permanent (every optional Moved replacement is `Card.Self` or
for another zone). So no check can reach it; it's kept as a guard.

**What changes in play:**
- A token kind with a replacement effect for other creatures (e.g. "each other creature you control enters with a
  counter") no longer applies it to its siblings from the same effect. Forge's one-at-a-time loop did. The rules
  (614.12, simultaneous entry) say it shouldn't. No check covers this: I found no such token script.
- Trigger order and collection are as before.

## Gates

- **Harness:** `engine/test-harness-local.sh --all`: **48 of 48 classes pass**, after the last change.
- **Patches:** both `git apply --check` clean on fresh `fd16e2f` / `e7d2b93b` worktrees, and they reproduce every
  edited file. No comments in the harness Java diff.
- **The repo's JS gates:** not rerun. This branch changes only `engine/` patches, `engine/checks`, `tools/` and docs.

## Not done

- No image, no live game.
- The per-pass cost on big boards and the per-layer lookahead (see 2).
- 500 tokens before the change wasn't timed to the end.
