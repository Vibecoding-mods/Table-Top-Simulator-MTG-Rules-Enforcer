# Report: mana sources shared per action list

Cloud session, 2026-11-17, branch `cloud/mana-sources`, from `origin/main` (f63de76). No Docker image was built and
nothing was checked live.

## The problem

With 500 Clues, the held-pass check (`heldActionsChanged` → `ActionSpace.getPossibleActions`) cost about 160–250 ms
for each new game state. Each ability's payability probe rebuilt everything about the board's mana from scratch.

## What the profile showed

A stack sampler on the bench thread (JFR took too few samples there) showed these hot spots on the 500-Clue board:

- **`addBattlefieldManaSources`** and **`canPayWithManaCostSources`** walk every permanent's mana abilities for every
  ability probed. On each permanent they redo `canPlay`, `checkRestrictions` and `canPayAdditionalCosts`
  (`canTap`, with the replacement-effect walk).
- **Forge's `ComputerUtilMana.groupSourcesByManaColor`** does the same walk again inside each `canPayManaCost`.
- **Forge's static loops:**
  - Per ability, `CostAdjustment.adjust` (raise, reduce and set cost), `StaticAbilityAlternativeCost` and
    `StaticAbilityManaConvert` each loop over every static ability of every card.
  - With 500 Clues that is about 500 cards with nothing relevant, for every ability.
- **`costDependsOnTargets`** collected the target-cost statics from every card, for every ability.

## What changed

All of it applies only inside one `getPossibleActions` call, while the board can't change. When the call ends,
everything is dropped.

**Harness, `ActionSpace`:**

- **`MANA_SOURCES` and `BATTLEFIELD_SOURCES`** are each player's mana sources, built once per call. A source is kept
  with:
  - its mana abilities;
  - what each ability makes;
  - the checks that don't depend on the ability being paid for: `canPlay`, restrictions, additional costs, the mana
    cost of the mana ability, and the implicit land mask.

  These checks are still done for each ability:
  - mana restrictions (`meetsManaRestrictions`);
  - the ability's own host;
  - reserved sacrifices.
- **`TARGET_COST_STATICS`** holds the target-dependent cost statics on the battlefield, stack and command zone, once
  per call. The host's own statics are still read live.
- **`PROBED_COSTS`** holds each ability's adjusted mana cost (`CostAdjustment` and the rest), keyed by the ability,
  the cost, the host and `effect`, all by identity.
  - The memo keeps a copy, and each caller gets a fresh copy.
  - It is skipped while `canPayManaWithAnnouncedX` or `canPayManaWithTargets` tries an X or a target
    (`VARYING_PROBE`), and when the payer isn't the activating player.
- **`shareManaSources`** (default on) switches all of this off. The test uses it to compare the two ways.

**Forge:**

- **`ComputerUtilMana.beginSharedSources` / `endSharedSources`** cache `groupSourcesByManaColor` per player and
  `checkPlayable`, and return a copy each time.
- **`StaticSourceScope` (new)** is used by `CostAdjustment` (both card loops), `StaticAbilityAlternativeCost` and
  `StaticAbilityManaConvert`.
  - Inside a scope those loops visit only the cards that have a static of the mode they look for, in the same order.
  - A card with no such static adds nothing to the loop, so the result is the same.
  - The host (the lead card) is read live and put where the original list had it, or at the end when that list
    lacked it.
  - `getPossibleActions` clears the scope after it applies the stack statics.
- **Without a scope** each of these runs exactly as before. Forge's own AI never opens one.

## Why the results are identical

- **The memos live for one call only**, and the board doesn't change within it. The one change inside the call (the
  stack statics) clears the static scope.
- **Everything that depends on the ability is still checked per ability:**
  - mana restrictions, the host, reserved sacrifices and the excluded source;
  - for a host, cost statics, alternative costs and target statics.
- **Callers that modify a result get a copy:** the probed cost and Forge's source map.
- **X and target tries aren't memoised.**

## Timings

`HeldPassBench`, new-state median, same jar, two runs each. "Before" is `shareManaSources` off, which runs the old code
path.

| Shape | Before | After |
| --- | --- | --- |
| no tokens | 0.28–0.30 ms | 0.27–0.28 ms |
| 500 Soldiers | 1.6–2.1 ms | 1.7 ms |
| 500 + 500 Soldiers | 1.7–2.0 ms | 2.2–3.5 ms |
| **500 Clues** | **161 ms** | **14–19 ms** |
| **500 + 500 Treasures** | **34 ms** | **1.2–2.4 ms** |

- The same-state check stays at about 0.1 ms.
- In `ManaSourcesTest` the 500-Clue median was about 19 ms.
- The Soldier rows are within run-to-run noise.

## Tests

**`ManaSourcesTest` (new): 10 of 10.**

Each "same both ways" check compares every action's label and description with sharing off and on, with the life
fallback off and on, and needs more than 3 actions. The boards:

- **`aMixedManaBoardHasTheSameActionsBothWays`:**
  - Swamps, Forests, Mountains, Cabal Coffers, Gaea's Cradle, Pillar of the Paruns, Lotus Petal;
  - Llanowar Elves, one sick and one not; Serra Angels; Grizzly Bears;
  - Treasure, Clue and Food tokens.

  The hand, used by most boards:
  - Stoke the Flames (convoke), Dismember (Phyrexian), Gitaxian Probe, Fireball (X), Krosan Tusker (cycling);
  - Lightning Bolt, Llanowar Elves, Grizzly Bears, Serra Angel;
  - Ghalta, Primal Hunger, Electrolyze, Bounty of the Hunt (alternative cost).
- **`costChangersAndConversionsGiveTheSameActionsBothWays`:** Goblin Electromancer, the opponent's Thalia, Chromatic
  Orrery, Fist of Suns.
- **`aTappedOutBoardHasTheSameActionsBothWays`.**
- **`lowLifeAndPhyrexianManaGiveTheSameActionsBothWays`:** 3 life.
- **`spellsThatChangeTheirOwnCostGiveTheSameActionsBothWays`:** Quicksand Whirlpool, payable only by targeting a tapped
  creature, and Ghalta for GG. It also checks that both are offered.
- **`stackStaticsGiveTheSameActionsBothWays`:** Witherbloom, the Balancer and Inspiring Statuary, which give spells on
  the stack affinity and improvise.

Direct checks:

- **`theProbeMemoGivesAFreshCostForEachProbe`:** the probe in a memo matches a fresh one, for `effect` false and true.
  Changing a returned cost doesn't change the next one.
- **`theSharedManaSourcesAreFreshCopiesPerQuestion`:** Forge's shared map gives what it gives without sharing, for
  `checkPlayable` true and false, and clearing one answer doesn't empty the next.
- **`theStaticScopeRereadsTheBoardAfterAClear`.**
- **`theHeldCheckOn500CluesIsUnder30Ms`:** HeldPassBench's 500-Clue shape, with an interactive session and the lock
  held. Median of 25 new-state checks under 30 ms.

**`engine/test-harness-local.sh --all`: 43 of 44 classes passed. `SharedTurnsPlayTest` failed once:**

- The failure is `aiTeamsPlayASharedTurnGameToTheEnd` ("no combat had both partners attacking"), a full AI-vs-AI game.
- It is flaky without this change too:
  - with `shareManaSources` off, the old path, it failed 1 run in 6;
  - with it on, 2 in 6;
  - one more run on its own passed 2 of 3.
- The other four checks in the class always pass.

## Break-its

13 mutations, each compiled over the jar and run against `ManaSourcesTest` (a local runner, not committed).
**12 caught by name, 1 escaped.** Each file was restored and checked by sha256.

| Mutation | Fails |
| --- | --- |
| probe memo without the X/target bypass | spellsThatChangeTheirOwnCostGiveTheSameActionsBothWays ("own cost board, life fallback true: the actions differ") |
| probe memo hands out its own copy | theProbeMemoGivesAFreshCostForEachProbe ("... gives {6}{R}{R}, not {1}{R}{R}") |
| probe memo key without `effect` | theProbeMemoGivesAFreshCostForEachProbe ("the effect probe in a memo gives {1}{R}{R}, not {2}{R}{R}") |
| scope drops a host that isn't in the list | spellsThatChangeTheirOwnCostGiveTheSameActionsBothWays (Ghalta) |
| scope drops the lead card | the mixed, changers, tapped and stack-statics boards |
| scope gives no ManaConvert cards | costChangersAndConversionsGiveTheSameActionsBothWays, theStaticScopeRereadsTheBoardAfterAClear |
| Forge's shared map not copied | theSharedManaSourcesAreFreshCopiesPerQuestion ("... has 0, not 6") |
| Forge's shared key without `checkPlayable` | theSharedManaSourcesAreFreshCopiesPerQuestion ("... has 6, not 8") |
| `clear()` does nothing | theStaticScopeRereadsTheBoardAfterAClear ("after a clear the scope gives []") |
| the scope never caches | theStaticScopeRereadsTheBoardAfterAClear ("the scope reread the board before a clear") |
| the battlefield memo always rebuilt | theHeldCheckOn500CluesIsUnder30Ms (41 ms) |
| no static scope | theHeldCheckOn500CluesIsUnder30Ms (64–73 ms) |
| **`getPossibleActions` doesn't clear after the stack statics** | **escaped** |

**Why the last one escapes.** The stack statics change only the spells being cast. Those spells' hosts are read live
anyway, and no card in the pool gives a spell on the stack a static ability that changes other spells' costs. So no
board has shown a difference. The clear is kept as a cheap precaution: it costs one rebuild, and only when stack
statics exist. `clear()` itself is covered by its own check.

Five break-its escaped on the first run, because the boards never reached those paths. They were fixed by adding the
own-cost and stack-statics boards and the direct checks, not by dropping the break-its. One more break-it (the
battlefield memo) didn't compile on the first run and was rewritten.

## Patches

- `engine/make-patches.sh` was run against clean trees at Manabrew `fd16e2f` and Forge `e7d2b93b`, with
  `core.autocrlf=false`.
- Only these sections differ:
  - **Forge:** `ComputerUtilMana`, `CostAdjustment`, `StaticAbilityAlternativeCost`, `StaticAbilityManaConvert`, the new
    `StaticSourceScope`;
  - **Manabrew:** `ActionSpace`, the new `ManaSourcesTest`.
- Both pass `git apply --check`.
- No comments in the harness Java; Forge has short ones.

## Left

- An image build and a look in a live game.
- `SharedTurnsPlayTest`'s full AI game is flaky, with or without this change.
