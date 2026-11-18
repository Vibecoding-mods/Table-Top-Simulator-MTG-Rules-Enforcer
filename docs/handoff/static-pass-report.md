# Report: the static pass's cost (token-quadratic's "proposed next")

Cloud session, 2026-11-17, branch `cloud/static-pass` from `origin/cloud/prompt-shapes` (efe04ae). The engine change is
`engine1124-staticpass` in `docs/engine-changes.md`.
- Forge only (`ReplacementHandler`): no protocol change, so no Rust literal.
- Not built into an image, not tried live. No permission prompt is pending.

## First, a correction to token-quadratic's numbers

**The "1.5 s per pass on 1,000+ permanents" wasn't production's cost.**
- Most of a pass in my benches was `CardView.updateAbilityText`: the view's rules text, which asks every conditional
  static whether it applies.
- Forge has a switch for that (`GameRules.setRenderAbilityText`), and **the harness already turns it off**
  (`ManaBrewEngineAdapter`, for the node: the snapshot builds its own text).
- `TokenBench` and `BigBoardCheck` made their own games with Forge's default (on).
- Same board (soldiers, spirits, humans and knights, 500 each, on the anthem board), one pass:

| Permanents | View text on (the benches before) | Off (the harness) |
|---|---|---|
| 545 | 73 ms | 25 ms |
| 1,045 | 1,460 ms | 55 ms |
| 1,545 | 2,378 ms | 83 ms |
| 2,045 | 3,503 ms | 107 ms |

**So item (2), cheaper view updates per pass, is already done in production by Forge's own switch.** Both benches now
run as the harness does: `-Dtb.render=true` / `-Dbb.render=true` turn the text back on.

**The 6 × 60/90/120 AI numbers** (ai-budgets) **barely move with it off:** attack 5.7 to 5.9 s and payment 9.5 to
9.6 s at 6 × 120. Those decisions don't make view updates. The token numbers did move.

## (1) One 614.12 lookahead per run (done)

**What it was.** `ReplacementHandler.run` tries the replacement layers in order: 614.17 can't-happen, then 616.1b to
616.1e (Control, Copy, Transform, Other). For a card moving to the battlefield, each layer's `getReplacementList` made
its own CR 614.12 lookahead: one full static pass with the card as it would be on the battlefield (with its ETB
counters), then one to reset. That's 10 passes, plus `changeZone`'s 2.

**Why one lookahead is the same:**
- **Nothing changes between layers until a replacement is chosen.** Walking the layers, the loop goes on to the next
  only when the last had nothing to apply (`NotReplaced` with an empty list). So the lookahead's state is the same for
  every layer, and each layer's list is what its own lookahead would find.
- **A layer's list is a filter of the same scan.** The old filter was `layer == null || re.getLayer() == layer`, so
  one scan with no layer, split by layer, gives the same lists in the same order.
- **Can't-happen:** its scan stopped at the first effect found and used `get(0)`. The split keeps the first first.
- **An effect with no layer** was in no layer's list before; it's skipped now too.
- **Once a layer applies one:** an `Updated` result runs the event again, and a declined one runs it again too. Either
  way the new run computes its own lists, as before.
- **A move a replacement itself caused** (`AbilityKey.ReplacementEffect` in the params) keeps the per-layer path. Its
  other choices for its own layer are the RIOT shortcut, which a scan with no layer can't take.

**The result:** 12 → **4 static passes** for a card entering. One effect's tokens: 13 → **5**.

**`ReplacementHandler.lookaheadPerRun`** (true) switches it off. The tests compare both ways, and the benches measure
both (`-Dtb.perRun`, `-Dbb.perRun`).

**Tokens** (`TokenBench`, with the doubler, view text off, one sample each):

| Board | Per layer | Per run |
|---|---|---|
| 500 on 45 permanents | 0.84 s, 13 passes | 0.74 s, 5 passes |
| 500 on 545 | 2.09 s | 1.73 s |
| 500 on 1,045 | 1.31 s | 0.79 s |
| 500 on 1,545 | 1.77 s | 1.13 s |

The state check after them is 0.1 to 0.3 s. These are noisy single samples: the pass count is the steady part.

**The 6 × 60/90/120 AI decisions** (`BigBoardCheck`, view text off) are the same within noise both ways. Their cost
isn't cards entering.

## Tests: `StaticPassTest`, 7 checks (new)

**Passes:** one creature entering runs 12 static passes with a lookahead per layer, and 4 with one per run.

**The same outcome both ways:** each scenario is played twice from the same seed (`MyRandom`), with the switch off and
on. The whole board must be identical: each card's zone, power/toughness, types, tapped, counters, colours and ability
counts.
- **Replacement-heavy:** Doubling Season, Rest in Peace and Grumgully (White's); Authority of the Consuls, Leyline of
  the Void and Serra Angel (Blue's).
  - Clone enters; the AI declines its optional copy, the same both ways: a tapped 0/0 with Grumgully's counter doubled,
    2/2.
  - Hill Giant enters tapped, a 5/5 with two counters.
  - Then, under Essence of the Wild, Grizzly Bears enters **as a copy of Essence**, tapped, an 8/8 with two counters:
    the Copy layer first, then Other.
  - An Elf put into the graveyard goes to exile (Rest in Peace).
- **Anthems:** Glorious Anthem and Field Marshal on three creatures entering (Grizzly Bears 3/3).
- **Humility then Opalescence** (the layer 7 dependency), then a Serra Angel entering.
- **Urborg, Tomb of Yawgmoth under Blood Moon:** it's a Mountain only, and the Forest gets no Swamp type.
- **Painter's Servant's color** as it enters, then a creature after it.
- **Cards with their own replacements:** Thriving Grove enters tapped; Scavenging Ooze, Gingerbrute and Walking
  Ballista enter as themselves; Gruul Spellbreaker's riot; Mox Diamond's discard-a-land. Xantcha, Sleeper Agent
  **enters under Blue's control**: its own Control-layer replacement moves it, the one kind of move that carries
  `AbilityKey.ReplacementEffect`.
- **Not in the set:** a text-changing effect. Those are spells that target (Mind Bend), and none applies as a card
  enters, which is all this change touches.

**Break-it: `node tools/mutate-static-pass.js <tree>`: 4 of 4 caught by name**, every file restored by sha256.
- The mutations:
  - a lookahead for each layer still;
  - no layer gets its list;
  - every layer gets the Other layer's list;
  - the Copy layer's list for all;
  - a move a replacement made takes the single lookahead too.
- **Not a mutation: the guard that keeps a move a replacement itself made on the per-layer path** (Xantcha's).
  Removing it changed nothing: with no other choices for its layer, the cause's shortcut isn't taken, and one
  lookahead finds the same lists. The guard matters only when the cause has other choices in its own layer (two
  replacements in one layer that move the same entering card): the shortcut's `layer.equals` would then throw on a
  scan with no layer. No card in the pool sets that up, so it stays as a guard.
- **Not a mutation:** the layers' order. That loop is shared by both paths, so a "same both ways" check can't see a
  change to it. The absolute checks (Essence of the Wild's tapped copy with two counters) cover what it decides.

## Gates

- **Harness:** `engine/test-harness-local.sh --all`: **49 of 49 classes pass**. That ran before Gruul Spellbreaker, Mox
  Diamond and Xantcha were added to `StaticPassTest`; the extended test passes on its own.
- **Patches:** both `git apply --check` clean on fresh `fd16e2f` / `e7d2b93b` worktrees. No comments in the harness
  Java diff.
- **Benches:** `engine/checks/TokenBench.java` (a `pass` mode, `-Dtb.render`, `-Dtb.perRun`) and `BigBoardCheck`
  (`-Dbb.render`, `-Dbb.perRun`).

The repo's JS gates are not rerun: this branch changes only `engine/` patches, `engine/checks` and `tools/`.

## Not done

- No image, no live game.
- A pass's remaining cost, about 50 µs per permanent, is Forge's static application itself.
