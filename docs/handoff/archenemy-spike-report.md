# Report: Archenemy spike, every scheme (plan step 5)

Cloud session, 2026-11-16, on branch `cloud/archenemy-spike` (based on `cloud/archenemy-rules`). No Docker image was
built and nothing was checked live. `bridge/` is untouched.

## The sweep

`ArchenemySchemeSweepTest` reads every script under `forge/forge-gui/res/cardsfolder` whose type line is `Scheme` or
`Ongoing Scheme`, and sweeps each card. It finds 102 cards: 81 non-ongoing and 21 ongoing.

**Setup for each card:**

- a fresh two-player Archenemy game; both seats are interactive players of a real `ManaBrewInteractiveSession`;
- the scheme on top of the archenemy's scheme deck, with two other schemes under it;
- each player has creatures, lands, an artifact and an enchantment in play, plus cards in hand, graveyard and library,
  so effects have something to act on.

**What runs:**

- `setSchemeInMotion` runs on a game thread holding the session's lock, as a real game does.
- The main thread answers each session prompt by its type, picking the first legal answer (ported from
  `bridge/engine-test.js`).

**Checks for each card:**

1. The set-in-motion and its triggers resolve without an exception, and without getting stuck: no 60 s timeout and no
   more than 200 prompts.
2. Every choice reaches a player as a session prompt. The test records the prompt types and who was asked, and fails on
   a prompt type it doesn't know.
3. A script with a "When you set this scheme in motion" trigger has that ability resolve.
4. A non-ongoing scheme ends on the bottom of the scheme deck, below anything that did not move.
5. An ongoing scheme stays in the command zone, then goes back to the scheme deck when abandoned (`DB$ Abandon`).

## Result

**102 of 102 schemes pass**, in about 9 seconds. All 27 harness classes pass.

55 schemes asked at least one prompt. The types reached:

- the archenemy: `chooseBoardTargets`, `chooseBoolean`, `chooseCards`, `chooseFromSelection`, `chooseNumber`,
  `reorder`, `revealCards`;
- the opponent: `chooseBoardTargets`, `chooseCards`, `chooseFromSelection`, `reorder`, `revealCards`.

The full list per card is in the test's output: each `ok` line names the prompt types it saw.

## Engine bug found and fixed

**Your Nightmares Are Delicious** threw `IllegalArgumentException: selected card count out of range: 0`.

- The scheme says "each opponent who has more than five cards in hand discards the difference". An opponent with 3
  cards was asked to discard -2.
- `ManaBrewInteractiveController.chooseCardsToDiscardFrom` passed that count to a card prompt, and the prompt refused
  any answer.
- Fix: a discard of zero or fewer cards, or from an empty choice, asks nothing and discards nothing. Negative minimums
  count as 0.

No other engine bug showed up.

## Break-its

Each break-it was compiled over the jar and run through the sweep. Each file was restored and checked by sha256.

| Break-it | Result |
| --- | --- |
| non-ongoing schemes not returned (`GameAction.stateBasedAction_Scheme`) | the 81 non-ongoing schemes fail by name: "the non-ongoing scheme stayed in the command zone" |
| the Ongoing check removed | the 21 ongoing schemes fail: "the ongoing scheme left the command zone before it was abandoned" |
| no `SetInMotion` trigger (`Player.setSchemeInMotion`) | the 81 schemes with that trigger fail: "its "when you set this scheme in motion" ability never resolved" |
| the discard fix reverted | only Your Nightmares Are Delicious fails: "selected card count out of range: 0" |

## Limits

- **Only the first legal answer is tried.** Other branches of a choice (other modes, other targets) are not played.
- **Delayed effects are not run.** A scheme's effect that waits for a later turn, step or combat is not played out.
  Examples: All in Good Time's extra turn, and the abandon conditions of ongoing schemes.
- **Wrong effects are not caught.** A choice Forge makes without asking would not show up as a prompt. The sweep
  checks that every prompt that is asked reaches a player, not that a scheme does the right thing beyond resolving.
- **Two players only.** "Each opponent" effects with several opponents are not covered here.
- **Patches:** `manabrew.patch` changed only in `ManaBrewInteractiveController.java` and the new
  `ArchenemySchemeSweepTest.java`; `forge.patch` is unchanged. Both pass `git apply --check` on clean Forge `e7d2b93`
  and Manabrew `fd16e2f`.
