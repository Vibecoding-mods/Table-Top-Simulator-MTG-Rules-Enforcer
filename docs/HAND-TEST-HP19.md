# Hand test: hp-19 "Keywords 17" (40 cards)

Played 2026-10-29, seat White (kit "Test 19: Keywords 17" by tmp/kit-19-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Same TTS session as hp-18 (bridge with fixes through hp-17).

Covers: Eternalize, Ravenous, Cleave, Champion, Freerunning, Harmonize, Detain, Endure, Kinship, Celebration, Valiant,
Forecast, Reinforce, Afterlife, Tribute.

## Worked
- Ravenous (Jacked Rabbit): X = 3, "enters the battlefield with 3 +1/+1 counters".
- Reinforce (Brighthearth Banneret) from the hand: "how do you play it?" Reinforce 1— {1}{R} | Cast; "put a +1/+1 counter
  on which creature?"; "White discards Brighthearth Banneret" (hp-17's cost discard live).
- Valiant (Heartfire Hero): Kenrith's counter on it set off its valiant counter.
- Harmonize (Nature's Rhythm): cast for X = 2 (Tithe Taker), then from the graveyard: the power to tap, the creature
  tapped, Tax Collector found; the card exiled. Detain (Tax Collector) triggered with nothing to detain.

## Findings and fixes (bridge/bridge.js)
1. Harmonize asked "Nature's Rhythm: Choose power of creature to tap". Fixed: "harmonize: tap a creature of how much
   power, to pay that much less?" with "0: tap none." under it.
2. Its "Tap creature?" came as a 0-to-1 number picker. Fixed: a 0-to-1 number whose title is a question is a yes/no.
Not tested: Eternalize, Cleave, Champion, Freerunning, Endure, Kinship, Celebration, Forecast, Afterlife (Tithe Taker
didn't die), Tribute.
Tests: 621 bridge scenarios. Mutation pass tmp/mut29.js: 4/5; the escape (a question-titled number over a wider range)
is now an input: 5/5.

## Gap fill (2026-10-30): every keyword played
Kit "Gap 19" (tmp/handplay/gap-19.json) against ai_gap_creatures.

Played:
- Eternalize: Faithless Looting discarded Fanatic of Rhonas; eternalized: a black 4/4 Zombie token copy.
- Champion: Silvergill Adept (its additional cost: Wanderwine Prophets revealed), then Wanderwine Prophets championed it
  (exiled). Later Prophets dealt combat damage and its own trigger sacrificed it: "Silvergill Adept returns to the
  battlefield from exile" (and an extra turn).
- Tribute: Nessian Wilds Ravager; the AI paid the tribute (six +1/+1 counters).
- Afterlife: Tithe Taker murdered: a 1/1 flying Spirit.
- Endure: Warden of the Grove with counters; Leaf-Crowned Elder, Raging Battle Mouse and Sakura-Tribe Elder entering:
  counters chosen twice, a Spirit token once.
- Celebration: Raging Battle Mouse's beginning-of-combat +1/+1 (two nonland permanents in), in both combats.
- Freerunning: Kenrith dealt combat damage; Overpowering Attack cast "— freerunning" for {2}{R}: attackers untapped, a
  second combat.
- Cleave: in the AI's main phase Wash Away (paid from lands) countered its Daring Skyjek, cast from its hand: Forge
  charged the cleave cost {1}{U}{U} by itself, the only way to target that spell.
- Kinship: Sakura-Tribe Elder on top (Worldly Tutor); White's upkeep: looked, revealed, cast it free.
- Forecast: Skyscribing revealed in White's upkeep ({2}{U} from lands): each player drew.

Findings and fixes (bridge/bridge.js):
1. Silvergill Adept's additional cost read "choose any you want" over two identical "Silvergill Adept - Creature 2 / 1"
   (the brackets naming each cost were cut as reminder text). Fixed: "Silvergill Adept: pay which additional cost?"
   with "Reveal a Merfolk card from your hand" / "Pay {3}".
2. Champion's question read "Wanderwine Prophets: search your battlefield?". Fixed: "champion a Merfolk: exile one of
   yours until Wanderwine Prophets leaves?" (Exile one / Sacrifice Wanderwine Prophets), with what happens.
3. Its trigger read "Wanderwine Prophets's champion a triggers": the two-word keyword rule took the article. Fixed:
   "champion triggers".
4. Its exile pick read "choose up to 1 card". Fixed: "exile which other Merfolk you control?".
5. Endure's question read "You may put 2 +1/+1 counters on Leaf-Crowned Elder. If you don't, create a 2/2 white Spirit
   creature token.?". Fixed: "Leaf-Crowned Elder: endure 2: put 2 +1/+1 counters on it, or create a 2/2 white Spirit
   token?" (Counters on it / 2/2 white Spirit token).
6. Celebration's target read "choose a target" (an intervening "if ..., " before the sentence). Fixed: "which creature
   you control gets +1/+1 until end of turn?".
7. Wash Away's counter went unsaid: the board after it was already the next turn, and the countered-spell targets were
   cleared before the check. Fixed: the last turn's still count in that board: "Daring Skyjek is countered".
8. Kinship's reveal read "Reveal cards to other players?". Fixed: "kinship: reveal the top card to play it without
   paying its mana cost?".
9. Forecast read "White uses Skyscribing's ability". Fixed: "White forecasts Skyscribing".

Test-run notes: library thin twice: six lands and Sakura-Tribe Elder were moved by manual fix (lands from the hand to
the bottom, Sakura to the top), and three lands from the hand onto the battlefield so the off-main-phase costs (Cleave,
Forecast) could be paid from lands. Open: Wash Away's cast line doesn't say "(cleave)": Forge sends it as a normal cast
and charges the cleave cost itself.
10. (from the mutation pass) A selection where only one option names an additional cost still read two identical
    labels. Fixed: such a bracket stays as words: "Some Spell - Sorcery — additional cost: {3}".
Tests: 796 bridge scenarios. Mutation pass tmp/mut51.js: 14 mutations, 2 escaped (14%), both closed with inputs (endure
1, a selection with one additional cost) and re-run caught (tmp/mut51b.js 2/2).
