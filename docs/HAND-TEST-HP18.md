# Hand test: hp-18 "Keywords 16" (40 cards)

Played 2026-10-29, seat White (kit "Test 18: Keywords 16" by tmp/kit-18-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
TTS and the bridge relaunched fresh before the deck (the bridge with every fix through hp-17).

Covers: Graft, Rampage, Phasing, Outlast, Riot, Living metal, Plainscycling, Mountaincycling, Airbend, Bloodrush,
Lieutenant, Undergrowth, Flurry, Infusion, Melee.

## Worked
- Riot (Spider-Punk): the +1/+1 counter chosen, "enters the battlefield with a +1/+1 counter".
- Graft (Llanowar Reborn): the land entered with its counter; each creature entering asked to move it.
- Outlast (Abzan Falconer): not offered while summoning sick ({T}); next turn, a +1/+1 counter.
- Lieutenant (Loyal Apprentice, with Kenrith as commander): a Thopter at the beginning of combat.
- Phasing (Taniwha): phased out at my upkeep.

## Findings and fixes (bridge/bridge.js)
1. Riot read "Spider-Punk: pay Put a +1/+1 counter on Spider-Punk?" Pay ... | No: spider-Punk gains haste (Forge's
   payment wording, no ability text). Fixed: "Spider-Punk: riot: a +1/+1 counter, or haste?" +1/+1 counter | Haste.
2. The "otherwise" sentence lowered and turned a card name into a verb: "No: spider-Punk gains haste". Fixed: a sentence
   about the asking card stays as it is ("No: Spider-Punk gains haste").
3. Playing Llanowar Reborn asked "choose one" between "Llanowar Reborn enters tapped." and "Graft 1 (...)": the order of
   its own enter effects, which all apply. Fixed: not asked (a played or cast card's selection whose options all say
   "enters").
4. A land arriving with a +1/+1 counter didn't say so. Fixed: "plays Llanowar Reborn with a +1/+1 counter".
5. Taniwha's phasing out was logged "Taniwha leaves the battlefield" (Forge leaves a phased-out card out of the view).
   Fixed: a card with phasing gone from the view "phases out", and "phases in" when it is back.
(Open: Graft's move question says "from this creature onto it" without naming the creature that entered. "White puts
Llanowar Reborn onto the battlefield" once: the play's 60-second record ran out while I edited code, not a bug.)
Not tested: Rampage, Living metal, Plainscycling/Mountaincycling (hp-03 covered landcycling), Airbend, Bloodrush,
Undergrowth, Flurry, Infusion, Melee; Taniwha's phasing in (next turn).
Tests: 617 bridge scenarios. Mutation pass tmp/mut28.js: 10/10.

## Gap fill (2026-10-30): every keyword played
Kit "Gap 18" (tmp/handplay/gap-18.json) against ai_gap_creatures.

Played:
- Plainscycling / Mountaincycling: Eagles of the North (no Plains left in the library: "no Plains card in your
  library") and Oliphaunt (a Mountain found) cycled from the hand.
- Undergrowth: Buried Alive put Skyhunter Strike Force in the graveyard (three creature cards with the cycled two);
  Izoni made three Insects.
- Infusion: Moseo, Vein's New Dean; Kenrith's {2}{W} gained 5; at the end step Skyhunter Strike Force returned.
- Living metal: Ratchet cast converted ("— more than meets the eye"); an artifact creature on White's turn, only an
  artifact Vehicle (no power) on the AI's.
- Flurry: Cori-Steel Cutter, then Eladamri's Call and Imperial Seal: the second spell made a Monk, the Cutter attached.
  Again later with Avatar's Wrath and the Skyhunter cast.
- Melee: Skyhunter Strike Force and Izoni (melee from Kenrith, lieutenant) attacked: 6 damage, +1/+1 each.
- Rampage: Varchild's War-Riders attacked; Woolly Thoctar blocked; the rampage trigger (one blocker: +0). Its cumulative
  upkeep gave the AI Survivors first.
- Bloodrush: after the block, Wasteland Viper from the hand ({G}): Varchild got +1/+2 and deathtouch; the Thoctar died
  to 1 damage and 4 trampled over.
- Airbend: Avatar's Wrath spared Kenrith; everything else exiled; Skyhunter Strike Force cast back from exile for {2}.
- Taniwha's phasing: phased out at White's next untap step and in at the one after; its upkeep trigger then phased
  White's lands out.

Findings and fixes (bridge/bridge.js):
1. Cycling read "White uses Eagles of the North's ability". Fixed: "White cycles Eagles of the North" (landcycling too).
2. Buried Alive's search into the graveyard read "White mills Skyhunter Strike Force". Fixed: after a library search,
   "White puts Skyhunter Strike Force into their graveyard from their library".
3. Bloodrush read "White uses Wasteland Viper's ability". Fixed: "White bloodrushes Wasteland Viper".
4. Avatar's Wrath's target read "choose which creature, then airbend all other creatures?". Fixed: "which creature is
   spared? Every other creature is airbent".
5. Avatar's Wrath's resolution read nine "is exiled" and eight "leaves the battlefield". Fixed: one line each, with
   counts: "Izoni, Thousand-Eyed, Moseo, Vein's New Dean, Wind Drake are exiled", "Insect Token ×2, Survivor Token leave
   the battlefield".
6. The Skyhunter cast back for {2} read "White casts Skyhunter Strike Force". Fixed: a cast from exile with no way named
   says "from exile" (an adventurer's creature cast now reads so too).
7. Taniwha's trigger phasing White's lands out read "Mountain leaves the battlefield". Fixed: after a resolved "phase
   out" trigger, its controller's permanents gone from the view phase out (and later phase in).

Test-run notes: the "Combat" stop is off by default (Arena-style), so White wasn't asked during White's own combat and
the first Bloodrush window was missed; it was switched on (the panel's stop, onMtgStop) for the test. Ninjutsu has a stop
of its own in that case; Bloodrush (an ability from the hand usable only while a creature attacks) has none. Left as a
question for the player-facing design, not changed.
Tests: 784 bridge scenarios. Mutation pass tmp/mut50.js: 17 mutations, 3 escaped (18%). Two were equivalent and their
guards removed: "!c.plotted" on a battlefield exile (plot exiles from the hand, never from the battlefield) and "!how" in
the from-exile name (the way is named first anyway). One closed with an input (a land bounced while Taniwha's trigger
still waits on the stack returns to the hand), re-run caught (tmp/mut50b.js 1/1).
