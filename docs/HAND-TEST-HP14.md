# Hand test: hp-14 "Keywords 12" (40 cards)

Played 2026-10-29, seat White (kit "Test 14: Keywords 12" by tmp/kit-14-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Same TTS session as hp-09 onward on NVIDIA 621.01 (~83,600 loaded objects, no crash).

Covers: Offspring, Replicate, Renown, Vanishing, Mentor, Suspect, Strive, Coven, Living weapon, Multikicker, Blitz,
Job select, Support, Inspired, Fading.

## Worked
- Offspring (Coruscation Mage): "pay {2} for Offspring?", the 1/1 token copy; both Mages pinged on each noncreature spell.
- Living weapon (Nettlecyst): "White creates Phyrexian Germ Token". Job select (Black Mage's Rod): "White creates Hero
  Token".
- Blitz (Jaxis): "how do you play it?" Cast | Cast (Blitz); sacrificed at the end step, a card drawn.
- Vanishing (Dreamtide Whale): its upkeep counter removal. Dreamtide Whale's second-spell proliferate pick.
- Multikicker (Everflowing Chalice): "pay {2} how many times? (Multikicker)", 3: three charge counters.
- Strive (Twinflame): two targets, the cost {3}{R}{R}; two hasty copies created.
- Support (Together Forever): two creatures got a +1/+1 counter each.
- Coven (Augur of Autumn), Inspired (King Macar) cast; Nelly Borca cast (suspect is on attack).

## Findings and fixes (bridge/bridge.js)
1. Strive's targets read "choose up to 8 targets to copy" with no word of the extra cost. Fixed: "Strive: each target
   after the first costs {2}{R} more." under the pick (more than one target only).
2. Support read "choose up to 2 targets" (Forge's title "Buff"). Fixed: "Together Forever: support 2: which creatures
   get a +1/+1 counter?" ("other creatures" when the card's reminder says so).
(Noted, not a bug: Kenrith's abilities were missing from a priority question asked before `mtg mana 99` took effect; a
land play gave a fresh question with them.)
Not tested: Replicate, Renown (Relic Seeker never dealt combat damage), Mentor, Suspect (Nelly didn't attack), Fading
(Tangle Wire not cast), Coven's count, Inspired's untap.
Tests: 585 bridge scenarios. Mutation pass tmp/mut23.js + mut23b: 7/7.

## Gap fill (2026-10-30): every keyword played
Kit "Gap 14" (tmp/handplay/gap-14.json) against ai_gap_creatures.

Played:
- Mentor: Legion Warboss attacked with its Goblin token: "Legion Warboss: mentor: put a +1/+1 counter on which attacking
  creature with lesser power?"; the Goblin got the counter.
- Renown: Relic Seeker made unblockable by Rogue's Passage hit the AI: +1/+1 counter, renowned, its search asked (no
  Equipment was left in the library: "no Equipment card in your library").
- Suspect: Nelly Borca attacked and suspected Garruk's Companion (menace, goaded). In the AI's turn Tangle Wire had
  tapped it, so it couldn't attack.
- Replicate: Changing Loyalty, "pay {2} how many times? (Replicate)" 2: the spell and two token copies, each with its own
  target (two on Garruk's Companion, one on a Goblin). When King Macar exiled the Companion, its Auras went to the
  graveyard (the token copy ceased to exist).
- Coven: Augur of Autumn with Kenrith 5, Relic Seeker 3, Augur 2, a Goblin 1. The library had no creature left, so King
  Macar went from the hand to the top by the table's manual fix; "Cast King Macar, the Gold-Cursed" was offered and cast
  from there.
- Inspired: King Macar attacked, untapped in White's next untap step: it exiled Garruk's Companion and made a Gold token.
- Fading: Tangle Wire entered with 4 fade counters, lost one each upkeep of White's (4, 3, 2, 1, 0) and was sacrificed
  on the fifth. Each upkeep the player tapped one permanent per counter (the AI tapped all four of its own; White tapped
  Goblins and Tangle Wire itself).

Findings and fixes (bridge/bridge.js):
1. Mentor's target question read "mentor Whenever this creature attacks, put a +1/+1 counter on which ...". Fixed: a
   keyword's reminder trigger keeps the keyword ("mentor: put ...").
2. Nelly's read "Nelly Borca, Impulsive Accuser: impulsive Accuser attacks, suspect which creature?": the trigger's
   condition was cut at the comma in her name. Fixed: a comma between capitalised words (or before "the X") is a
   name's; "Nelly Borca, Impulsive Accuser: suspect which creature?". Blood Artist's still ends at "dies,".
3. Renowned showed nowhere (Forge sends no flag), and renown never triggers twice. Fixed: a renown trigger gone from the
   stack with its creature still there makes it renowned: "Relic Seeker becomes renowned" and "Renowned" on the card
   until it leaves.
4. Suspect: the log said nothing (the player's trigger resolved between two boards) and the card showed only menace.
   Fixed: the target picked for a "suspect target" trigger is noted; once the trigger is gone, "Garruk's Companion is
   suspected: menace, and can't block", "is goaded by White ...", and "Suspected: can't block" on the card. "Goad all
   suspected creatures" goads every suspected one.
5. Changing Loyalty and its copies read "creates Changing Loyalty" with nothing on where. Fixed: an arrival attached to
   something says it: "Blue creates Changing Loyalty, attached to Goblin Token".
6. King Macar cast from the top of the library read "White casts King Macar". Fixed: "... from the top of their
   library" (a cast by flashback or another mode keeps saying the mode).
7. The manual fix was only in chat, not the game log. Fixed: "White's manual fix: King Macar ...: White's hand → White's
   library (top)".
8. Tangle Wire entered "enters the battlefield" with no counters said, and lost them unsaid. Fixed: an arrival names its
   other counters (not +1/+1's own line, not loyalty): "with 4 fade counters"; a change reads "Tangle Wire loses a fade
   counter (3 left)", "gets 2 time counters (3 in all)".
9. Tangle Wire's taps were unsaid (the AI tapped its four permanents). Fixed: a resolved "taps an untapped ..." trigger
   says what its player tapped: "AI 1 taps Taiga, Garruk's Companion (Tangle Wire)".
10. King Macar's yes/no read "exile target creature?" right after Garruk's Companion was picked. Fixed: a "you may"
    question names the target just picked for that card: "King Macar, the Gold-Cursed: exile Garruk's Companion?".
11. Tangle Wire sacrificed by its fading read "goes to the graveyard". Fixed: a permanent sacrificed by its own resolved
    "sacrifice it" reads "Tangle Wire is sacrificed".

Open: an attack and a combat damage trigger seen in one board read in the wrong order ("Relic Seeker's renown triggers"
before "White attacks with ..."); the lines of one board are said by kind, not by when they happened. An Aura's cast
target reads "choose a target to attach it to" (understandable, not "enchant which creature?").
Tests: 725 bridge scenarios. Mutation pass tmp/mut45.js: 24 mutations, 5 escaped (21%); one was an equivalent program
(the cast's mode is named before "from the top", so `!how` in fromTop did nothing: removed); the other four closed with
new inputs (a renown trigger held on the stack over two boards, a second suspect, a mana tap while Tangle Wire's trigger
waits, a card's own non-sacrifice trigger) and re-run caught 4/4 (tmp/mut45b.js).

Live re-test (2026-10-30, new game after a bridge restart): confirmed live:
- the Aura lines ("White creates Changing Loyalty, attached to Legion Warboss")
- "Tangle Wire enters the battlefield with 4 fade counters"
- the manual fix in the game log
- King Macar refused from the top without coven (powers 5 and 2 only), then "casts King Macar ... from the top of their
  library" with it
- the mentor and suspect titles
- suspected, goaded and renowned, in the log and on the cards ("Renowned", "Suspected: can't block")
- "AI 1 taps Taiga, Kird Ape (Tangle Wire)" and White's own taps
- "Tangle Wire loses a fade counter (2 left)"
- "King Macar, the Gold-Cursed: exile Deadly Recluse?"

Two more found in the re-test:
12. Live, Inspired's target came titled "Exile", which took the generic "choose a target to exile" before the card's
    text was read. Fixed: a verb title ("choose a target to exile/destroy/counter/...") is also replaced by the card's
    own sentence when it gives one: "King Macar, the Gold-Cursed: you may exile which creature?". Five recorded
    scenarios changed, all for the better: "Counterspell: counter which spell?", "Heated Debate: deals 4 damage to which
    creature or planeswalker?" (a sentence starting with the card's own name drops it after "<card>: "). Strive's cost
    sentence "for each target beyond the first" is no purpose (Twinflame keeps "choose up to 1 target to copy").
13. Tangle Wire sacrificed by its fading still read "goes to the graveyard": Forge's trigger says "sacrifice CARDNAME"
    (CardFactoryUtil's TriggerDescription), sent with the card's name, not "sacrifice it". Fixed: either form is read;
    a fading creature (Blastoderm) reads "is sacrificed" too.
Tests: 728 scenarios. Mutation pass tmp/mut46.js: 5/5 caught. Fixes 12 and 13 are tested against fixtures shaped like
the live prompt and Forge's own text; the bridge running this game had the earlier code.
