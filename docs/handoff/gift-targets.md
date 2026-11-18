# Gift spells and their targets (engine1128-gift)

Branch `cloud/gift-targets`, on `cloud/engine1126-combined` (d81d157). Harness only: `ActionSpace`.

## The bug

Long River's Pull ("Gift a card. Counter target creature spell. If the gift was promised, instead counter target
spell.") was never offered with only a noncreature spell on the stack. Into the Flood Maw had the same problem with only
a noncreature permanent.

- `ActionSpace.hasValidTargets` checked `getMinTargets()`, and the script's `TargetMin$ X` with
  `X:Count$PromisedGift.0.1` reads `getCastSA().isGiftPromised()`.
- Before the cast the gift isn't chosen (it is chosen at cast time, `HarnessPlayPlumbing.chooseOptionalAdditionalCosts`).
- So only the ungifted half's target counted.

## The fix

A spell whose targets don't fit, and that has a `PromiseGift` optional cost not yet chosen, is checked again:

- on a copy with the gift added;
- the copy is made the card's cast ability for the check and put back after, in a `finally`.

The action offered is the spell as it was, not promised, so its cast still asks the gift question.

## The 26 Gift cards with PromisedGift

| Shape | Cards | Before the fix |
|---|---|---|
| The gift switches the target | Long River's Pull, Into the Flood Maw | the bug |
| More targets with the gift (2/1) | Peerless Recycling, Wear Down | already offered |
| Up to N | Dewdrop Cure | already offered |
| A target only with the gift (1/0) | Consumed by Greed, Mind Spiral, Sazacap's Brew, Valley Rally, Wildfire Howl | already offered |
| Outside targeting | the rest | not affected |

The three shapes that worked were already offered because the count without the gift is the lower one.

## Tests

`common.GiftTargetsTest`, 11 checks:

- **switch:**
  - Long River's Pull offered against Lightning Bolt, and against a creature spell; not with an empty stack;
  - Into the Flood Maw offered against an opponent's Sol Ring; not with only a land.
- **ask:** the offered spell is not promised, and has its gift still to choose.
- **residue:** the card's cast ability is put back.
- **more:** Wear Down offered with one artifact; not with none.
- **extra:** Valley Rally offered with no creature.
- **plain:** Essence Scatter (no gift) not offered against a noncreature spell.

Three checks fail before the fix: both "offered" switch checks, and the ask check.

`tools/mutate-gift-targets.js`: 10 of 10 caught by name. Harness `--all`: 56 of 56.

## Not checked

A cast where the player declines the gift and the ungifted half has no legal target. Forge's targeting step decides
that case.

## Patches

`engine/manabrew.patch` is regenerated, with no comments in harness Java. `engine/forge.patch` is unchanged.
`git apply --check` is clean on `fd16e2f` / `e7d2b93b`.
