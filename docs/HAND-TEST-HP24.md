# Hand test: hp-24 "Keywords 22" (40 cards)

Played 2026-10-29, seat White (kit "Test 24: Keywords 22" by tmp/kit-24-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Same TTS session as hp-23 (bridge with fixes through hp-21; ~81,600 loaded objects).

Covers: Fortify, Desertwalk, Wizardcycling, Fateseal, Commander ninjutsu, Nonbasic landwalk, Transfigure, Aura Swap,
Decayed, Slivercycling, Halflingcycling.

## Worked
- Slivercycling (Homing Sliver): "how do you play it?" Slivercycling {3} | Cast; "search your library for which Sliver
  card?", Mesmeric Sliver found.
- Fateseal (Mesmeric Sliver): "fateseal 1?", AI 1 picked by itself (the only opponent), its top card looked at, a
  Swamp to the bottom.
- Transfigure (Fleshwrither): sacrificed, no creature of the same mana value left: nothing asked.
- Halflingcycling (Hobbit Hole, a land) offered as an ability.

## Findings and fixes (bridge/bridge.js)
1. Fateseal's pick read "Mesmeric Sliver: choose up to 1 card" (Forge: "Choose card(s) to put on the bottom of <engine
   name> library"). Fixed: "put which cards on the bottom of AI 1's library?" with "The rest stay on top in the same
   order." under it.
Not tested: Fortify, Desertwalk, Wizardcycling, Commander ninjutsu (Yuriko drawn, no unblocked attacker), Nonbasic
landwalk, Aura Swap, Decayed.
Tests: 635 bridge scenarios. Mutation pass tmp/mut34.js: 1/2; the escape (the player's name passed through
displayText) was equivalent, the last pass does it, and the call was removed.

Suite (2026-10-29): docs/reviews/suite-hp08-23-24-26-2026-10-29.md.

## Gap fill (2026-10-30)
Kit "Gap 24" (tmp/handplay/gap-24.json). Game 1 against ai_gap_lands, which barely cast a creature. Game 2 against the
table's stock Edgar Markov deck (it was on Red's seat after TTS was relaunched at 14:10; `mtg aideck` only fills empty
seats), which attacks and blocks.

Played:
- Wizardcycling: Step Through, {2}: "search your library for which Wizard card?" (Silvergill Adept).
- Fortify: C.A.M.P. onto Command Tower. Tapping the Tower paying for something: its trigger, a +1/+1 counter on the
  picked creature, and a Junk token only when the creature shares the mana's colour (Yuriko with blue, yes; Kenrith, mono
  white, no).
- Commander ninjutsu: at declare blockers, paid {U}{B} from Command Tower and Swamp, returned Dryad Sophisticate:
  Yuriko entered tapped and attacking; her trigger revealed a card and the AI lost its mana value.
- Aura swap: Arcanum Wings for Rancor: on the same creature, Wings back in hand.
- Decayed: Rot-Curse Rakshasa attacked and was sacrificed at end of combat. Goblin Guide attacked with Rakshasa my only
  untapped creature: no block question came (a block question is asked whenever a legal block exists).
- Nonbasic landwalk: Dryad Sophisticate attacked alone into an untapped Hill Giant, the AI with nonbasic lands. No block,
  though it was a free kill and the same AI had just blocked Yuriko with Goblin Guide. Good evidence, not proof.
- Desertwalk: Hazezon unblocked with Shefet Dunes out, but that AI blocked nothing all game, Yuriko (no evasion)
  included. Played, not proved; the Edgar deck has no Deserts.

Findings and fixes (bridge/bridge.js):
1. Aura swap's pick read "choose up to 1 card from your hand". Fixed: "aura swap: exchange it with which Aura card from
   your hand?".
2. Ninjutsu, Fortify and Aura swap read "White uses X's ability". Fixed: "White ninjutsus Yuriko", "White fortifies with
   C.A.M.P.", "White swaps Arcanum Wings (aura swap)".
3. What ninjutsu or aura swap sends back read "leaves the battlefield": the hand stays level, one card in and one out.
   Fixed: "Dryad Sophisticate returns to White's hand". Golden only: edited after the last game started.

Open:
- Cancelling a payment after tapping the fortified land refunds the mana, yet the land's trigger still happens: a free
  counter and Junk token. Forge's behaviour (the undo of a mana payment).
- A cancelled cast stays in the log: "White casts Silvergill Adept".
- Goblin Guide's revealed land put into the hand reads "White draws a card".
- The cast label doesn't show a cost reduced or changed by another card.

Tests: 849 bridge scenarios, 24 bridge claims, 192 table checks, 4 table games. Mutation pass tmp/mut56.js: 15 mutations,
3 escaped (20%, SOUND), closed with inputs (another keyword's record, another player's, a token arriving) and re-run
caught (tmp/mut56b.js 3/3).

## Re-test from the defender's seat (2026-10-30)
Kit "Gap 27" (tmp/handplay/gap-27.json) against decks/ai_gap_walkers.json, a deck of landwalkers, so the block question itself
is the proof. Each walker's block options were read with and without its land on White's side.
- Desertwalk: PROVEN. With no Desert: "Memnite blocks Hazezon" and "Yuriko blocks Hazezon" offered. With Shefet Dunes out,
  both still untapped: no block option.
- Legendary landwalk: PROVEN. With no legendary land: blocks on Ayumi offered, none on Hazezon in the same attack. With
  Urborg out: no block option.
- Nonbasic landwalk: PROVEN with a land out (no block option on Dryad Sophisticate); not seen without one in this game.
- Plainswalk: PROVEN with a Plains out (four Zodiac Roosters attacked, blockers untapped, no block option); the Roosters
  never attacked before the Plains came, so no "without" case.
- Undaunted: PROVEN. Curtains' Call, {5}{B}, asked "Pay {4}{B}" against one opponent.
- Log wordings live: "AI 1 controls that copy of Incarnation Technique", "White copies Improvisation Capstone", "Arcanum
  Wings returns to White's hand" and "White ninjutsus" on fresh bridges.
Finding: "returns to White's hand" passed its golden and failed live: the play record was spent before the card left. Fixed
with a timed note on the seat (handSwap). Mutation pass tmp/mut57.js 5/6, the escape closed (tmp/mut57b.js 1/1).
Not re-tested live: "AI 1's Gaea's Cradle" and a discard seen while its spell resolves: golden only.

## Release re-test on the rebuilt engine (2026-10-30)
Engine built from a clean upstream clone plus engine/*.patch (image 9b2708d7c2ca; rollbacks mtg-forge-node:rel-prev, mtg-relay:rel-prev).
- Turn timers: 10 seconds plus the bank: warned at 116 s, took the default at 130 s (the hand was kept).
- Hold priority: Lightning Bolt with hold on kept priority; Flusterstorm countered it. Driven through the bridge command:
  the Hold button and the `mtg hold` / `mtg timer` chat commands need a table push, refused while the stock decks are out.
- Fortify cancel: tapping the fortified land and cancelling refunded the mana with no trigger; a real payment still triggers.
- Audit cards: Primal Surge looped through five permanents and stopped at a sorcery; Thieves' Auction, all eight chosen, game
  went on (no command-zone choice came up, so that case wasn't exercised); Obzedat exiled, returned, had Haste; Puppet Master
  paid and declined, on repeat use; Forgefire Automaton across two upkeeps, each returning only the legal card.
  Not played: the other 23 audited scripts.
- Found: Lightning Bolt read "deals 3 damage to any which?"; Flusterstorm's copy read "Copy of Lightning Bolt" and offered a raw
  card id. Fixed. "Blue cancels ..." passed its golden and failed live: fixed by reading the game log. Mutation pass
  tmp/mut58.js: 25 mutations, 2 escaped, both closed (tmp/mut58b.js 2/2, tmp/mut58c 2/2).

Second live pass (2026-10-30, the same engine): "deals 3 damage to which target?", "White cancels Lightning Bolt", "returns to White's hand"
for aura swap and ninjutsu, and "White puts AI 1's Eiganjo, Seat of the Empire onto the battlefield" all read correctly. That last one had
passed its golden and failed live: a card on a battlefield reports that zone's player as its owner, so the fixture's owner was
one the engine never sends. Fixed by reading the spell that took it, and the fixture now has the live shape. Mutation pass
tmp/mut59.js: 1/3, then 3/3 with two new inputs. A bridge restart resumed the running game.
Not yet seen live: the Hold button, `mtg hold`, `mtg timer` from chat, and the slimmer UI, which need the ENGINE MODE save loaded.

Third live pass (2026-10-31), the new table script pushed (the normal push; the table held none of the owner's decks):
`mtg timer 10` from chat (warned, took the default at 130 s) and `mtg timer off`; the Hold button's handler and `mtg hold` from chat, each
keeping priority, with an unheld cast passing as before; the UI at 24,963 bytes for one seat (28,549 before), Hold in the Engine panel
and fitting its row. Hold gives no lit state while armed, only a chat line. The Engine panel is hidden by default, so `mtg hold` is
the quicker way. Two more log lines fixed live: "White casts Tibalt, Cosmic Impostor" (read Valki) and "White plays Swamp from exile".
