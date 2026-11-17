# Report: the static pass on a real big board (CR 613.8 dependency scans)

Cloud session, 2026-11-17, branch `cloud/dependency-scans` from `origin/cloud/static-pass` (2df32e2). The engine change
is `engine1124-depscans` in `docs/engine-changes.md`.
- Forge only (`GameAction`, plus two methods made public). No protocol change, so no Rust literal.
- Not built into an image, not tried live. No permission prompt is pending.

## Which item

I read `docs/handoff/open-after-1121.md` and every handoff report from 2026-11-15 on, for open items that can be done
and checked here.
- **Done later or waiting on a merge:**
  - the cost badge's non-mana costs and tie-break (cost-badge-4);
  - bo3's sideboarding, Concede match and Game N of 3 (bo3-extras);
  - the AI attack's budget (ai-budgets, cheap-assault).
- **Needs live TTS, an image or the user:** most of the rest (the table looks, the images, the owner's questions).
- **On a branch that was never merged:** team-draws' gaps (optional effects, Investigate/Amass, every `Dig` shared). I
  left them: they belong with that branch.
- **Open, and can be done here:** the big-board items:
  - ai-budgets' "past the budget the payment's source choice is unbounded: 10 s at 6 × 120";
  - open-after-1121's "`MagicStack.add`'s static pass for each mana ability … the CR 613.8 dependency re-detection
    after each tap (about 430 ms a tap at 6 × 60), which needs a dependency cache across game states".

**Measured, these are one item.** The {8} payment at 6 × 120 (`BigBoardCheck sample pay 120`) is:
- 499 of 509 samples in `checkStaticAbilities`;
- half of them the pass after the first tap (`MagicStack.add`);
- half the pass when the held payment ends.

It isn't the source choice. **One static pass on that board was 4.8 s.** Of that:
- **The abilities layer (layer 6) is all of it:** 46 statics, and 2,930 dependency pairs tried per pass.
- On an unchanged state the order cache makes the same layer 92 ms. A tap changes the state version, so every pass in
  a payment pays in full.
- **The dependencies are real.** Titania's Song takes all abilities from noncreature artifacts, so every equipment's
  static depends on it (the "exists" test of CR 613.8b). Forge rightly builds the whole graph.

(The static-pass report's "50 µs per permanent" was from a board with 4 anthems. This board, from the real card pool,
has 68 continuous statics.)

## Where the time went

`findStaticAbilityToApply` tries each pair (A, B) in a layer: apply B, filter the battlefield again for A, compare, undo
B. Two full battlefield scans per pair:
- **B's own scan** inside `applyContinuousAbilityBefore`: 54% of the samples;
- **A's rescan** after B: 39%.

## The change: `GameAction.DependencyScans` (per layer of a pass)

1. **B's filter and conditions once per search.** Every pair starts from the same state (each B is undone before the
   next), so B's affected cards (`getAffectedCards`) and its conditions (`appliesBefore`, the check
   `applyContinuousAbilityBefore` makes first) are the same for every A. They are worked out once and reused.
   - B is then applied to a copy of its cards with `StaticAbilityContinuous.applyContinuousAbility`: what
     `applyContinuousAbilityBefore` does after its own scan.
2. **A B that applies to nothing is skipped.** It has `Affected$`, no cards and no players, so applying it returns at
   once (`applyContinuousAbility`'s "nothing more to do") and changes nothing. It can't make a dependency, and A's
   rescan after it is skipped. Its removal still runs, as before.
3. **The results carry to the layer's next search** while the static applied in between changed nothing (it applied to
   nothing, or its conditions were off). Any other application drops them.
4. **A's rescan after each B is still done in full.**

**Unchanged:** the order the pass settles on, Forge's dependency table (`GameView.getDependencies`), and every
application.

**`GameAction.dependencyScanCache`** (true) switches it off; **`getDependencyScans()`** counts the filters run.

## Numbers (`BigBoardCheck sample pass` / `sample pay`, `-Dbb.depScans=false|true`, this container, one sample each)

| Board | One pass after a tap: off | on | Filters run | AI {8} payment: off | on |
|---|---|---|---|---|---|
| 6 × 60 (358 permanents) | 0.77 s | 0.28 s | 1,531 → 403 | 3.1 s | 2.4 s |
| 6 × 90 (534) | 2.6 s | 0.6 s | 3,058 → 629 | 5.0 s | 2.7 s |
| 6 × 120 (714) | 4.7 s | 1.4 s | 4,890 → 1,142 | 10.0 s | 4.5 s |

The payment at 6 × 120 is still over its 2 s budget. It runs about three passes, and the one when the held payment ends
can't be skipped.

## Tests: `DependencyScanTest`, 9 checks (new)

Written first; its first run was a compile failure on the missing switch and counter.

**Scans:**
- **After a tap, on a 33-static layer 6 board** with Titania's Song (both players with Levitation, Sephara, Gravity
  Sphere, the Archetypes, Akroma's Memorial and others, and 16 Bonesplitters): at most half the scans of the old way.
  - The check first makes sure the tap changed the state version, so the order cache can't hide the work, and that
    the old way did at least k(k−1)/2.
  - Measured: 25,887 → 11,681.
- **Eight layer 6 statics with no creature to affect:** each is scanned once.

**The same both ways:** each scenario is played twice from one seed. Every card must match: power/toughness, types,
keywords, tapped, colours and ability counts, and Forge's dependency table too.
- **Titania's Song over attached Lightning Greaves and Loxodon Warhammer:**
  - the equipment becomes creatures of its mana value (2/2, 3/3) with no abilities, and grants nothing;
  - after the Song leaves, its effect lasts the turn, as its text says.
- **Levitation, then Sephara** (other fliers you control have indestructible): Grizzly Bears has flying and
  indestructible. Then Gravity Sphere, later, takes both.
- **The other order:** Gravity Sphere first, then Levitation. The Bears fly and are indestructible, and Forge's table
  has Sephara depending on Levitation.
- **Sephara, then Toby, Beastie Befriender:** Toby's flying for tokens is off with two tokens (no dependency) and on
  with four.
- **Humility then Opalescence**, then Serra Angel: a 1/1 with no keywords.
- **Mycosynth Lattice under Titania's Song and March of the Machines.**
- **The 33-static board through a tap, Serra Angel entering, and an untap.**

**My own expectations I had wrong, not the code:**
- Sephara gives indestructible, not lifelink.
- Titania's Song's effect outlasts it for the turn.

## Break-it: `node tools/mutate-dependency-scans.js <engine tree>`: 7 of 7 caught by name

`GameAction.java` was restored by sha256 after each mutation. The mutations:
- the results kept after a static that changed something;
- the results dropped after every static;
- A's rescan taken from the stored results;
- a static that applies to nothing still applied and rescanned;
- B's conditions not checked;
- B applied to A's cards;
- the switch ignored.

**Toby was first behind Sephara at first,** so the conditions mutation was caught only by the big board. Toby, by
timestamp, was never the B to Sephara. With Sephara first, the Toby check catches it by name.

## Gates

- **Harness:** `engine/test-harness-local.sh --all`: **50 of 50 classes pass**.
- **Patches:** both `git apply --check` clean on fresh `fd16e2f` / `e7d2b93b` worktrees. No comments in the harness
  Java diff. The added comments are in Forge's `GameAction`, as before.
- The repo's JS gates are not rerun: this branch changes only `engine/` patches, `engine/checks` and `tools/`.

## Not done (the next step)

**A's rescan after each B (39% before, about 60% of what's left)** could be limited to B's own cards. In the type,
abilities and P/T layers, applying B changes only the cards it affects. So a filter that reads only the card itself
can change its answer only there:
- its types, colours, keywords, counters;
- its controller against the host's.

But that rests on a hand-made list of which filter words are "the card itself". One wrong entry silently changes rules
results, so I left it.

**Also not done:**
- `MagicStack.add`'s pass per mana ability is unchanged. Each one is now about 1.4 s, not 4.7 s, at 6 × 120.
- No image, no live game.
