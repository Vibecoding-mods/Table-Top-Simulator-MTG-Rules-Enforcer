# Hand test: hp-09 "Keywords 7" (40 cards)

Played 2026-10-28, seat White (kit "Test 09: Keywords 7" by tmp/kit-09-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
TTS froze at 82,244 objects (NVIDIA reset 20:28:06, many event-13 graphics errors before it) while Abhorrent Oculus's
cost was open; two relaunches hung on a white window and the PC stopped answering process queries. After a reboot
and the NVIDIA 621.01 driver, a second game (bridge restarted with fixes 1-12) played the rest and re-tested the fixes.

Covers: Exert, Earthbend, Metalcraft, Rebound, Shroud, Station, Constellation, Mutate, Islandwalk, Manifest dread,
Escape, Heal, Incubate, Entwine, Choose a background.

## Worked
- Constellation (Eidolon of Blossoms): Asceticism's arrival drew a card. Shroud: Argothian Enchantress was not offered
  to Ephemerate. Hexproof from Asceticism shown on the creatures.
- Mutate (Gemrazer onto Eidolon): "Mutate: which creature goes on top?"; the trigger with no opponent's artifact or
  enchantment asked nothing.
- Escape (Uro): cast from the hand it was sacrificed (its draw, +3 life, land put); escaped from the graveyard it stayed.
- Entwine (Tooth and Nail): "pay Entwine ({2})?", both halves.
- Earthbend (Badgermole Cub): "which land you control becomes a 0/0 creature with haste that's still a land?"; the
  land's counters logged; exiled by Sunfall, it came back ("returns to the battlefield from exile").
- Rebound (Ephemerate): exiled after resolving, cast again at the next upkeep; the flickered token left the battlefield.
- Incubate (Sunfall): everything exiled, the commander question, "White creates Incubator Token", "{2}: transform":
  "Incubator Token becomes Phyrexian Token". Metalcraft (Mox Opal): no mana ability offered with one artifact (right).

## Findings and fixes (bridge/bridge.js)
1. Asceticism's constellation draw was logged before "Asceticism enters the battlefield". Fixed: a draw seen with a
   nonland entry, past the draw step of the same turn, is said after the entries (a draw step's draw stays first).
2. Gemrazer's mutate target read "Gemrazer: destroy which artifact or enchantment an opponent controls?" (its mutate
   trigger's sentence). Fixed: a mutating spell's own target, while it is not on the battlefield: "mutate onto which
   non-Human creature you own?".
3. The mutate logged "Eidolon of Blossoms becomes Gemrazer" and "Gemrazer enters the battlefield". Fixed: "Gemrazer
   mutates onto Eidolon of Blossoms" (or "under"), from Forge's mergedCardIds.
4. Tooth and Nail's hand half read "search your library for which creature cards?". Fixed: cards all in the hand (or
   all in your library) take the sentence that says so; the put rule reads "up to two creature cards".
5. "White casts Tooth and Nail" was logged twice (its stack text grew with entwine). Fixed: a spell on the stack is
   keyed by its card, not its text.
6. Ephemerate's exile after resolving said only "is exiled". Fixed: "Ephemerate is exiled with rebound: White may cast
   it at their next upkeep".
7. Sunfall asked "Sunfall: pick #1" to order the creatures it exiles. Fixed: an "exile all" order over permanents is
   kept without asking.
8. Rebound's question read "cast Ephemerate (Original) without paying its mana cost?". Fixed: Forge's "(Original)" tag
   is dropped.
9. Rebound's cast was asked twice ("cast without paying?", then "Cast Ephemerate?"). Fixed: after yes to a free cast,
   Forge's "Do you want to play X?" for that card answers itself (30 s).
10. Uro's escape cost read "put which land card onto the battlefield? (choose 5)"; Abhorrent Oculus's additional cost
    the same. Fixed: Forge's "Exile for cost" titles from the card's cost line: "exile which cards for its escape
    cost?", "exile which cards for the cost?".
11. The escape's five cards were five "X is exiled" lines. Fixed: cards exiled from one graveyard together are one
    line ("Forest, Island, ... are exiled from White's graveyard").
12. Clicking Arena of Glory on the battlefield (its one ability a mana ability) said "lands can only be played in your
    main phase with an empty stack". Fixed: a permanent on the battlefield says none of its abilities can be used now
    (a mana ability while paying a cost). The helpers' land cases had used a battlefield Mountain; now a hand one.
13. Evendo's station cost read "tap which card for the cost?" (Forge: "Tap for cost"). Fixed: a keyword before its
    reminder counts too: "Evendo, Waking Haven: tap which card for its station cost?".
14. Manifest dread's pick read "put which card onto the battlefield?" (Forge: "Choose cards to manifest"). Fixed:
    "Abhorrent Oculus: manifest dread: put which card onto the battlefield face down as a 2/2?" with the other card's
    fate under it; a face-down card put onto the battlefield is logged "White puts a card onto the battlefield face
    down" (was "a face-down card enters the battlefield"), a face-down spell's "A face-down creature enters ...".
Re-tested live on the restarted bridge: #2 ("mutate onto which non-Human creature you own?"), #3 ("Gemrazer mutates onto
Eidolon of Blossoms"), #6 (rebound line), #8 (no "(Original)"), #9 (asked once; the cast logged "White casts
Ephemerate", so the earlier "uses Ephemerate's ability" doubt is cleared), #10 (Oculus: "exile which cards for the
cost? (choose 6)"), #11 ("City of Brass, Exotic Orchard, ... are exiled from White's graveyard").
(Open: the mutated permanent shows Gemrazer's picture with the merged Gemrazer card small beside it, so the Eidolon under
it isn't seen on the table; a flicker of a nontoken permanent within one board isn't logged; station's charge counters are not logged (only +1/+1 are); manifest dread's card to the graveyard
reads "mills".)
Tests: 548 bridge scenarios.
Also worked: Station (Evendo, 4 charge counters from Gemrazer); Cold-Eyed Selkie attacked (blocked by the Rats, died).
Not tested: Islandwalk (the AI had no Island), Arena of Glory's exert (manifested face down in game 2), Jaheira's
background (a command-zone pairing; she is an ordinary creature here).

## Gap fill (2026-10-29): every keyword played
Kit "Gap 09" (tmp/handplay/gap-09.json) against ai_gap_creatures, then against ai_gap_spells (its Islands for
islandwalk); kit "Gap 09b" (tmp/handplay/gap-09b.json: Jaheira and Raised by Giants as the two commanders, 38 green
cards) against ai_passive_lands.

Played:
- Exert: Arena of Glory's "{R}, {T}, Exert" paid Jaheira's cost ({R}{R} plus City of Brass's {G}): Jaheira had haste,
  Arena stayed tapped through White's next untap step while the Mountain untapped.
- Islandwalk: Cold-Eyed Selkie attacked while the AI had Islands and an untapped Aegis Sculptor: unblocked; its trigger
  asked "draw a card?".
- Background (on Kenrith): Raised by Giants with Kenrith the commander made him a 10/10 Giant.
- Choose a background, as a pairing: Jaheira and Raised by Giants as commanders: "ready ... commander Raised by Giants &
  Jaheira, Friend of the Forest"; both cast from the command zone; Jaheira became a 10/10 Giant.

Findings and fixes (bridge/bridge.js):
1. Arena of Glory's exert mana read "Tap Arena of Glory for {R}{R}" beside its plain "{R}", with nothing of its cost
   ("{T}, {R}, Exert CARDNAME"). Fixed: a mana ability's other costs said with it, "Tap Arena of Glory for {R}{R} (also
   {R}, exert it)"; one with no tap reads "Use Simian Spirit Guide for {R} (exile it from your hand)" (it read "Tap").
2. Nothing showed that an exerted permanent won't untap. Fixed: a badge "Exerted: doesn't untap next turn" (Forge's
   exerted), with the keywords another card gave it.
Open (table script): the kit loader puts every commander card on the same spot, and two commanders merged into one pile
that the table doesn't read as commanders ("not ready"); split by hand (tmp/split-cmd.lua) for this test. Partner and
Background kits need the loader to lay them side by side.
Also (test driving): an earlier gap kit's bag on the spawn spot swallowed the next kits, and a reset leaves the last
game's cards as an unmarked deck on the library spot, which the loader refuses: tmp/newgame.sh moves both aside first.
