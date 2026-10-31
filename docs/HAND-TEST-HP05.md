# Hand test: hp-05 "Keywords 3" (40 cards)

Played 2026-10-28, seat White (kit "Test 05: Keywords 3" by tmp/kit-05-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith and The One Ring draws; actions through the table's functions
(tmp/act.js) while the user worked in other windows. Two games: TTS froze in the first (81,990 objects, AI 1's turn 2);
relaunched, the save loaded by hand, the bridge restarted with the fixes below, and a second game played the rest.

Covers: Double strike, Partner, Devoid, Landwalk, Indestructible, Threshold, Convoke, Prowess, Proliferate,
Typecycling, Hexproof, Landcycling, Goad, Cumulative upkeep.

## Worked
- The One Ring: protection from everything until your next turn: Kenrith's "which player draws a card?" offered only
  AI 1 (right; nothing says why). Its tap: "uses The One Ring's ability", "White draws 2 cards"; its upkeep trigger,
  -1 life per burden counter.
- Cumulative upkeep (Mystic Remora): with no land out it couldn't be paid, Forge asked nothing and Remora went to the
  graveyard. Sheoldred's upkeep return with no creature card: no target, no question.
- Prowess (Pinnacle Monk): 2/2 to 5/5 over three noncreature spells; its return of an instant or sorcery: "Pinnacle
  Monk: return which instant or sorcery card to your hand?".
- Threshold (Cabal Ritual, 14 cards in the graveyard). Double strike (Lizard Blades' Reconfigure {2} attached to the
  Monk). Lotus Field (hexproof): "choose 2 lands to sacrifice", City of Brass and itself.
- Kodama of the East Tree (Partner): Lizard Blades and Unnatural Growth entering asked for a card from the hand; Lotus
  Field and Mana Confluence put in; a card it put didn't trigger it again.
- Proliferate (Karn's Bastion): "give which another counter (proliferate)?", the counter logged.
- Typecycling: Angel of the Ruins "how do you play it?" Plainscycling {2} | Cast; "search your library for which
  Plains card?". Lórien Revealed's Islandcycling: "no Island card in your library" (none left).
- Convoke (Chord of Calling): X asked 0-4, "search your library for which creature card with mana value X or less?",
  Sowing Mycospawn put onto the battlefield (the pool paid, so no creature was tapped for convoke).

## Findings and fixes (bridge/bridge.js)
1. Mystic Remora's cumulative upkeep logged "White uses Mystic Remora's ability". Fixed: "Mystic Remora's cumulative
   upkeep: pay {1} for each age counter on it, or it is sacrificed" (as echo's).
2. Kodama's pick read "choose up to 1 card from your hand". Fixed: "Kodama of the East Tree: put which permanent card
   onto the battlefield?" (the put rule takes "with equal or lesser mana value").
3. A trigger seen together with the permanent that caused it was logged first: "uses Kodama of the East Tree's
   ability", then "Lizard Blades enters the battlefield"; Lotus Field's own trigger before Lotus Field. Fixed: a
   trigger (no record of the player's) seen with an entry is said after the entries.
4. The cleanup discard was logged under the next turn's line ("--- AI 1's turn 2 ---", then "White discards ...").
   Fixed: the last turn's player's discard seen with a new turn comes before its line.
5. Karn's Bastion offered "Kenrith, the Returned King 6/6 [1 P1P1]". Fixed: counters in words, "[1 +1/+1 counter]",
   "[3 burden counters]".
6. Chord of Calling's creature from the library to the battlefield, with Pinnacle Monk's card back from the graveyard,
   logged "White puts a card from their library into their hand" and nothing for Lórien Revealed. Fixed: when a
   graveyard or exile card left too, library cards that came public elsewhere don't count toward the hand; "Lórien
   Revealed is put into White's hand from the graveyard". The draw count is what left the library for the hand (it
   read "draws 2 cards" for a draw and a graveyard card).
(Not changed: a cycled card from the hand logs "discards" (Angel) or "is put into White's graveyard" (Lórien, its
graveyard arrival seen apart from the hand's drop); Chord's title keeps "X" rather than the chosen number; an
equipment's attach still logs no line (open since hp-03).)
Tests: 529 bridge scenarios; all four suites pass. Mutation pass tmp/mut16.js: 11/17 caught at first (WEAK, 35%
escaped: the deferral's three conditions, the cleanup owner, the stack and face-down exclusions); new inputs closed all
six; 18/18 with the draw count.
Not tested here: Goad (Disrupt Decorum resolved, the AI never had a creature), Devoid and Sowing Mycospawn's cast
trigger (put, not cast), Landwalk, Indestructible.

## Gap fill (2026-10-29): every keyword played
Kit "Gap 05" (tmp/handplay/gap-05.json, plan tmp/handplay/gap-05.md), against ai_gap_creatures (Sisay; cheap creatures
of every colour, Swamp-type lands).

Played:
- Devoid and Sowing Mycospawn's cast triggers: colourless in Forge's view ({3}{G} cost), cast kicked ("pay Kicker
  ({1}{C})?"), both "when you cast" triggers ordered and resolved: an AI land exiled ("Breeding Pool is exiled"), a
  land searched onto the battlefield.
- Indestructible: The One Ring (protection from everything until the next turn; Kenrith's draw couldn't target White
  meanwhile, as the rules say), then Vindicate on it: it stayed.
- Swampwalk: Sheoldred, Whispering One with haste attacked while the AI had a Swamp and seven untapped creatures:
  unblocked, 9 damage with Sowing Mycospawn.
- Goad: Disrupt Decorum; on the AI's next turn all six of its creatures (Sisay too) attacked.
Also seen: Sheoldred's upkeep trigger on the AI's upkeep made it sacrifice Typhoid Rats.

Findings and fixes (bridge/bridge.js):
1. Goad was shown nowhere: the log said "White casts Disrupt Decorum" and the cards looked as before. Fixed: the log
   says "Kird Ape, Typhoid Rats are goaded by White: they attack each combat, a player other than White if able, until
   White's next turn", and each goaded card carries a "Goaded by White" badge (with the keywords another card gave it)
   until the goader's next turn. Forge shows no goad: the bridge reads it from the resolved spell's or ability's words,
   all creatures its controller doesn't control, or its targets.
Not seen live (the bridge isn't restarted mid-game): the goad line and badge.
