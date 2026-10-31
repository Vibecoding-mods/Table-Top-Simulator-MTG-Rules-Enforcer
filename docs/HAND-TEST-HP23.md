# Hand test: hp-23 "Keywords 21" (40 cards)

Played 2026-10-29, seat White (kit "Test 23: Keywords 21" by tmp/kit-23-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
TTS and the bridge relaunched fresh before the deck (the bridge with every fix through hp-21).

Covers: Demonstrate, Impending, Ripple, Epic, Plainswalk, Undaunted, Paradigm, Triple, Join forces, Secret council,
Will of the Planeswalkers, Sweep, Gravestorm, Roll to Visit Your Attractions, Legendary landwalk.

## Worked
- Join forces (Minds Aglow): paid 2 ("Pay {2}" from the pool by itself, hp-15's rule live), each player drew 2.
- Impending (Overlord of the Hauntwoods): "how do you play it?" ... (Impending); its Everywhere land token.
- Sweep (Barrel Down Sokenzan): a Mountain returned ("Mountain returns to White's hand", hp-11's line live), the damage.
- Will of the Planeswalkers (Path of the Pyromancer): "vote for planeswalk or chaos", the AI's vote told; hand
  discarded and redrawn.

## Findings and fixes (bridge/bridge.js)
1. Join forces asked "Minds Aglow: choose X" (Forge: "Choose a value for amount of mana to pay"). Fixed: "join forces:
   pay how much mana?" with "Each player draws X cards, where X is the total amount of mana paid this way." under it.
2. Overlord's Everywhere token was logged "White puts Everywhere onto the battlefield". Fixed: a land token is created:
   "White creates Everywhere".
3. Sweep's pick read "Barrel Down Sokenzan: choose up to 2 cards". Fixed: "return which Mountains to your hand?" (the
   return rule takes "any number of ... you control to their owner's hand").
(Open: Path of the Pyromancer's discard of the whole hand and the same number drawn logged as single "is put into
White's graveyard" lines, the hp-16 hand-for-hand case.)
Not tested: Demonstrate, Ripple, Epic, Plainswalk, Undaunted, Paradigm, Triple, Secret council, Gravestorm,
Attractions, Legendary landwalk (the library ran out).
Tests: 634 bridge scenarios. Mutation pass tmp/mut33.js: 5/5.

Suite (2026-10-29): docs/reviews/suite-hp08-23-24-26-2026-10-29.md.

## Gap fill (2026-10-30)
Kit "Gap 23" (tmp/handplay/gap-23.json) against ai_gap_lands, image 8b8d6ff33d14, then a second game on a fresh bridge to
re-test the fixes live. Attractions skipped (the user's decision; no Attraction deck exists in this setup. Line Cutter's
roll to visit did show in the log).

Played:
- Ripple: Vampiric Tutor put a Surging Dementia on top, the one from hand revealed four and cast it free; that copy's
  ripple found the third. The rest went to the bottom.
- Demonstrate: Incarnation Technique copied by White and AI 1: each milled five and returned a creature (AI 1's Knight
  of the Reliquary; Line Cutter in the second game).
- Undaunted: Curtains' Call destroyed Knight of the Reliquary and Viscera Seer. The cost cut was not read: the pool had
  99 of each colour and the cast label shows no cost.
- Gravestorm: Ominous Harvest after those two deaths: two copies.
- Paradigm: Improvisation Capstone exiled itself; at the next first main phase "cast a copy" was offered and cast free;
  it was offered again each later turn and declined.
- Secret council: Mob Verdict, cast free from Capstone's exile: "White voted for AI 1. AI 1 voted for White".
- Triple: Fiery Emancipation: Mob Verdict's 2 dealt 6, the Rooster's 2 dealt 6, Ayumi's 7 dealt 21.
- Plainswalk: Zodiac Rooster unblocked past an untapped Sisay with a Plains on the AI's side. Not proof: the AI may
  simply not have blocked a 6-damage attacker.
- Legendary landwalk: Ayumi unblocked for 21 past an untapped Sisay, the AI at 22, with Okina out. Likely but not proof
  either; a chump block was the AI's obvious move.
- Epic: Eternal Dominion took Gaea's Cradle; with 99 mana and spells in hand no cast was offered; at each upkeep the
  copy took another card (Urborg).

Findings and fixes (bridge/bridge.js):
1. Ripple's question read "Use Surging Dementia?". Fixed: "ripple 4: reveal the top 4 cards of your library?".
2. Its reveal, public, read "look at these cards" and "White looked at 4 cards (their library)". Fixed: "ripple 4:
   revealed from the top of your library", and the cards named in the log.
3. The revealed namesake's cast read "White copies Surging Dementia". Fixed: "White casts Surging Dementia (ripple)",
   the question "Cast Surging Dementia without paying its mana cost?".
4. Ripple's trigger read "White uses Surging Dementia's ability". Fixed for Forge's "<Keyword> N - <card>" form:
   "Surging Dementia's ripple triggers"; cascade's reads the same way.
5. The rest of the reveal asked "click the card to put on top" though it goes to the bottom. Fixed: not asked.
6. Target player's discards while the spell resolves read "Explosive Vegetation is put into AI 1's graveyard" for
   sorceries. Fixed: the player a spell targets counts as discarding, the spell gone or still on the stack.
7. A draw just after a tutor that puts its card on top read "puts a card from their library into their hand". Fixed.
8. Demonstrate's question said nothing of the opponent's copy. Fixed: "demonstrate: copy it? If you do, an opponent you
   choose copies it too".
9. The AI's demonstrate copy read "White copies ..." then "AI 1 casts ...". Fixed: a spell with no new card of its name
   is not a new spell; "AI 1 controls that copy of Incarnation Technique". The second copy is still first said as
   White's: that is how it first appears on the stack.
10. Capstone's exile read "is exiled". Fixed: "is exiled (paradigm): at the start of each of their first main phases,
    White may cast a copy of it without paying its mana cost".
11. Exile-until cards were named twice (the reveal and the board). Fixed: the reveal's cards are left out of the
    board's line.
12. Forge's effect "Improvisation Capstone' Paradigm" (its own missing "s") read as a spell: "White casts Improvisation
    Capstone' Paradigm", even when declined. Fixed: "Improvisation Capstone's paradigm triggers"; the question reads
    "paradigm: cast a copy of it without paying its mana cost?"; the free copy reads "White copies ...".
13. An opponent's searched card shown from their hand read "White looked at a card (AI 1's hand)" although the ability
    reveals it. Fixed: named.
14. Epic showed nowhere. Fixed: "White can't cast spells for the rest of the game (epic); at each of their upkeeps,
    Eternal Dominion is copied".
15. Epic's upkeep copy read "Eternal Dominion (5)'s Effect's ability triggers", "White casts Eternal Dominion" and asked
    "Choose a player to search their library" with no card. Fixed: "Eternal Dominion's ability triggers", "White copies
    Eternal Dominion", "Eternal Dominion: choose a player to search their library".
16. Another player's land read "White puts Gaea's Cradle onto the battlefield". Fixed: "White puts AI 1's Gaea's
    Cradle ...". Golden only: the last game's bridge predates it.

Open:
- Undaunted's cost cut, plainswalk's and legendary landwalk's "can't be blocked" were not proved (see above).
- A search of an opponent's library asks OK on the whole library before the pick (one's own doesn't).
- The gravestorm copy's new target reads "Copy of Ominous Harvest: choose a player to draw": no card text to word it from.
- "White saw: Incarnation Technique: White picked AI 1" for the only opponent, picked automatically.
- Re-test: fixes 1-5, 7-15 were seen live on a fresh bridge, except three edited after that game started, golden only: the free copy's "White copies Improvisation Capstone" (fix 12),
  fix 6's last change (the spell still resolving) and fix 9's "controls that copy" line.

Tests: 841 bridge scenarios, 24 bridge claims, 192 table checks, 4 table games. Mutation pass tmp/mut55.js: 35 mutations,
6 escaped (17%, SOUND). One was a redundant line (the search mark forgotten after a top tutor, the reveal no longer sets
it): deleted. Five closed with inputs (the cast question after paradigm's yes, another player's same-named spell, a draw
after a top tutor, exile-until cards named once) and re-run caught (tmp/mut55b.js, tmp/mut55c.js 5/5).
