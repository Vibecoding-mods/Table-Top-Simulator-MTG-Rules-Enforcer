# Mechanic runs on the real table, 2026-11-05

Every plan in tmp/mech-scenario-plan.json, played through the debug system (`mtg debug mech-hpXX`) on the live TTS table
by tmp/mech-run.js; one report per deck in this folder, a line each in summary.txt. First-run reports are in first/.

28 of 28 decks ran, no TTS crash, no bridge error. 15 decks re-run after the fixes went live (bridge 3421a294, then
8fa44463, then the text-change wording).

## Fixed in bridge/bridge.js, tested, deployed, confirmed on the real table

| # | found in | what was wrong | test (goes red without the fix) | live re-test |
|---|---|---|---|---|
| 1 | hp-01 | clicking a mana rock (Arcane Signet) at priority: "none of its abilities can be used right now", though its Mana: tap button was offered | test_bridge_claims "mana click" (2) | asks "Tap Arcane Signet for which mana?" |
| 2 | hp-03 | a search that reveals (basic landcycling, Cultivate, Tooth and Nail) said only "puts a card from their library into their hand" | golden hp-09 Tooth and Nail | "White reveals Island (Ash Barrens)" |
| 3 | hp-08 | venturing never said the room. Forge writes no room note on the dungeon card; the room is its ability on the stack, "Yawning Portal — ... (Leads to: Dungeon Level)" | test_bridge_events "venture" (8; 5 mutants red) | "White ventures into Yawning Portal (Dungeon of the Mad Mage)" |
| 4 | hp-09, hp-15 | an enters trigger's resolve line came before the entry | test_bridge_events "enters trigger" (2) | Asceticism, Glorious Anthem enter first |
| 5 | hp-12, hp-16, hp-17 | a card exiled to pay its own cost "is exiled with" itself | test_bridge_events "craft" (1) | gone |
| 6 | hp-16 | "Hexplate Wallbreaker's for triggers": For Mirrodin! cut to "for" | test_bridge_events "For Mirrodin!" (1) | "For Mirrodin! triggers" |
| 7 | hp-16 | Cut Your Losses' list "Galadhrim Brigade / Galadhrim Brigade" | test_bridge_claims "token label" (3) | "Galadhrim Brigade (token)" |
| 8 | hp-24, hp-26 | Dark Confidant's and Yuriko's revealed card read "puts a card from their library into their hand", and once named, came above its reveal | golden "a revealed card put into the hand" (6 cases; 6 mutants red) | "reveals Saw in Half", then "puts Saw in Half into their hand" |
| 9 | rebuilt | legend rule offered "Mairsil 4/4 / Mairsil 4/4" | golden "legend rule: the commander and the one just entered marked" (4 mutants red) | "Mairsil 4/4 (commander) (just entered)" |
| 10 | hp-40, hp-14 | a trigger on a board still in scheduleTable's 40 ms wait, passed by itself (your own spell in your main phase), was never logged | golden "a priority passed by itself with a waiting board" (2 cases; 3 mutants red) | all 4 prowess triggers; both Coruscation Mages each time |
| 11 | hp-25 | Mind Bend / Artificial Evolution / Sleight of Mind left no log line; first wording read live text word by word ("Goblins → strike") | test_bridge_events "text change" (12; 9 mutants red) | "Bog Wraith's text changes: Swampwalk → Islandwalk (Mind Bend)", "Goblin King's ...: Goblin → Elf", "White Knight's ...: black → red" (bridge 3cfe7f78) |

## Open (not fixed)

- hp-05: after paying Mystic Remora's cumulative upkeep with Auto-pay, the priority row keeps one "Untap Forest (mana
  back)" per land tapped, for mana already spent (only after an "unless you pay" cost during a trigger; never after a
  cast). If pressing one untaps the land, it is free mana. Harness: undoableManaSources lists Forge's undo stack, which
  an unless-cost payment never clears. To test on the table before fixing.
- hp-17: Auto-pay spends colours the hand needs: scavenge's {4}{B} took 4 of 5 Forests with 4 Plains untapped, so Bear
  Umbra ({2}{G}{G}) could no longer be cast. Arena's auto-tapper keeps needed colours; Forge's does not.
- hp-14: identical triggers (two Coruscation Mages) still ask for an order; Arena orders identical triggers itself.
  Two token copies of one creature still read "Coruscation Mage (token) / Coruscation Mage (token)".
- hp-15: Fatal Push's question says "mana value 2 or less" with revolt on (it is 4 or less then).
- hp-06: Bowmasters' target list names the manifested face-down card "Brainstorm" (allowed: it is yours) without saying
  it is face down.
- hp-09: flickering a mutated creature asks "Ephemerate: pick #1" (which comes back first), unclear words.
- hp-18: graft on a land says "from this creature".
- hp-25: Glamerdye aimed at a Forest (no colour word to change) still logs "Forest's text changes (Glamerdye)" with
  no detail; Forge's text differs only by the dropped reminder. Better: say nothing changed, or skip the line.
- hp-23: a token returned to the hand (sweep's Everywhere) reads only "leaves the battlefield".

## Runner limits (not game bugs)

Misses from the runner's own picks: the first option when a step's wording did not match, comma names split in attacks
before the fix (hp-10 Gitrog, hp-13 Ragavan, hp-14 Nelly), numbers (Ribbons' X) before number answers, a loyalty cost
("Vraska: -2"), a tier named after "the tier" (Cura), "replace X with Y", a card named with "from the graveyard" (all
fixed in the runner, re-runs scored higher: hp-22 5/7 to 6/7, rebuilt 4/8 to 6/8), hovers (text boxes, badges) it
cannot do, and doc expectations worded from older builds.
