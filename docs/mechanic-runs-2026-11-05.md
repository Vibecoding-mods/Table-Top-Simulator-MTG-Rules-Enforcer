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

## Fixed after the first write-up (2026-11-05 night, bridge e64e34a3, then 3e533e72 with the trigger-note fix)

Live re-test, 9 decks:
- **Confirmed on the real table:**
  - #12: after Remora's Auto-paid upkeep the priority row had no "mana back";
  - #13: Bear Umbra was cast after Auto-pay;
  - #15: "Coruscation Mage 1/1 (token) / Coruscation Mage 2/2 (token)";
  - #16: "Saw in Half (face down)";
  - #17: "mana value 4 or less";
  - #18: "Ephemerate: click the one that comes back first";
  - #19: "from this land";
  - #20: "Glamerdye changes nothing in Forest's text".
- **#14, first try:** the Chalice and Together Forever triggers were ordered by themselves, but Twinflame's still asked. Forge's note on each trigger ("[Card: Twinflame … SpellAbility: Choose any number of target creatures …]") tripped the "does it target" check, which now reads the text without Forge's notes (golden case from the live text; caught when broken). Re-run on bridge 3e533e72: Twinflame's two Mage triggers ordered by themselves, both logged; the one question left was Warboss vs Nelly, two different triggers.
- **#21:** not reached live (the runner returned Mountains, not the token); covered by its test.
- **hp-06:** first re-run timed out. The scenario's 6 {C} were partly spent before Emrakul's madness {C}x6; the plan now gives 12.

| # | found in | what was wrong | fix | test (goes red without the fix) |
|---|---|---|---|---|
| 12 | hp-05 | after Mystic Remora's upkeep paid with Auto-pay, one "Untap Forest (mana back)" per land stayed, for mana already spent (Forge keeps its undo list after an "unless you pay" cost) | "mana back" is offered only while mana floats in your pool | golden "undo listed but the pool is empty" (2) |
| 13 | hp-17 | Auto-pay spent the colours the hand needs (4 of 5 Forests for {4}{B} with 4 Plains free; Bear Umbra lost) | the bridge taps for plain costs itself, only for a payment that names its card: each coloured symbol from a source of that colour, the generic part from the sources the rest of the hand needs least; on a tie a painless ability before a painful one (a pain land's coloured mana pays last), then a basic before a dual land. It remembers the taps it sent (one offered again goes to Forge's auto-pay, never twice) and forgets them on a rewind. Hybrid, X, Phyrexian and extra-cost sources go to Forge's auto-pay as before | golden "hp-17: auto-pay" (7 cases; 7 of 8 mutants red, the 8th an equivalent program) |
| 14 | hp-14 | identical triggers (two Coruscation Mages) asked for an order | ordered by themselves when name and text are the same and nothing targets, as Arena does | golden "identical triggers" (3) |
| 15 | hp-14 | two token copies read "Coruscation Mage (token) / Coruscation Mage" (the token pass changed a label before comparing the next) | collisions decided first: a token beside a card of its name gets "(token)"; alike creatures then get power/toughness, then anything still alike (two Treasures, two Forests too) gets #1 / #2. A face-down card you may not see reads "Face-down creature" | golden "target labels" |
| 16 | hp-06 | a manifested card you may see was offered as "Brainstorm" | "Brainstorm (face down)" | golden "target labels" |
| 17 | hp-15 | Fatal Push asked "mana value 2 or less" with revolt on | with revolt on the question says "4 or less" | golden "revolt on or off" |
| 18 | hp-09 | "Ephemerate: pick #1" | "Ephemerate: click the one that comes back first" | golden "an order of creatures coming back" |
| 19 | hp-18 | a land's graft asked "from this creature" | "from this land" (a non-creature card's "this creature" is said as its type) | golden "graft" (2) |
| 20 | hp-25 | Glamerdye on a Forest logged "Forest's text changes" with no detail | "Glamerdye changes nothing in Forest's text" | test_bridge_events "text change" (2 new) |
| 21 | hp-23 | a bounced token read "leaves the battlefield" | "Everywhere token returns to White's hand and ceases to exist" | test_bridge_events "token: returned to the hand" |

Break-it pass: 16 of 16 mutants of #12, #14-#21 caught by name; #13 7 of 8 (above).

## Runner limits (not game bugs)

Misses from the runner's own picks: the first option when a step's wording did not match, comma names split in attacks
before the fix (hp-10 Gitrog, hp-13 Ragavan, hp-14 Nelly), numbers (Ribbons' X) before number answers, a loyalty cost
("Vraska: -2"), a tier named after "the tier" (Cura), "replace X with Y", a card named with "from the graveyard" (all
fixed in the runner, re-runs scored higher: hp-22 5/7 to 6/7, rebuilt 4/8 to 6/8), hovers (text boxes, badges) it
cannot do, and doc expectations worded from older builds.
