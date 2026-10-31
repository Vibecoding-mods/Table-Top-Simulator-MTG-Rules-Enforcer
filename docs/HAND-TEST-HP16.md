# Hand test: hp-16 "Keywords 14" (40 cards)

Played 2026-10-29, seat White (kit "Test 16: Keywords 14" by tmp/kit-16-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Same TTS session as hp-15 (~82,700 loaded objects, no crash).

Covers: Skulk, Casualty, Sunburst, Mayhem, Hideaway, Unleash, Embalm, Battle Cry, Cipher, Awaken, Emerge, Squad, Enlist,
For Mirrodin!, Hexproof from.

## Worked
- Squad (Galadhrim Brigade): "pay {1}{G} how many times? (Squad)", 2: two token copies.
- Hideaway (Mosswort Bridge): "exile which card face down?", Hero of Bladehold hidden ("a face-down card is exiled").
- Unleash (Tesak): "have this creature enter with a +1/+1 counter on it?", entered with the counter (the hp-13 arrival
  counter line live).
- Casualty (Cut Your Losses): "sacrifice a creature with power 2 or greater?", a Brigade sacrificed, the copy's
  target; AI 1 milled half its library twice.
- Cipher (Whispering Madness): "Exile Whispering Madness and encode it onto a creature you control?", onto Tesak.
- Sunburst (Pentad Prism): two charge counters. Emerge (Herigast): "how do you play it?" ... (Emerge), a token
  sacrificed. Awaken (Part the Waterveil): Mosswort Bridge awakened.

## Findings and fixes (bridge/bridge.js)
1. Hideaway asked "look at these cards (your library)" before its pick over the same cards. Fixed: the look answers
   itself (the pick shows them).
2. Playing Mosswort Bridge logged "White casts Mosswort Bridge" and "White puts Mosswort Bridge onto the battlefield":
   its own hideaway trigger on the stack took the land play's record. Fixed: a land play's record is not taken by a
   stack item, and stays a play while its land's trigger is on the stack: "White plays ...".
3. "a face-down card is exiled" began in lower case. Fixed: every log line starts with a capital.
4. "White casts Cut Your Losses" was logged twice (the casualty copy). Fixed: a second of one card's spell on the stack
   is a copy: "White copies Cut Your Losses".
5. The mills of 46 and 23 cards were one name after another. Fixed: more than six cards by count, "AI 1 mills 46
   cards: Swamp ×42, Relentless Rats ×4".
6. Cipher's creature read "Whispering Madness: choose a card" (Forge: "Choose a creature you control to encode").
   Fixed: "encode it onto which creature you control?" with what it does under it.
7. Awaken's land read "Part the Waterveil: choose a target". Fixed: "awaken 6: which land you control gets 6 +1/+1
   counters and becomes a 0/0 Elemental creature with haste?".
(Open: the casualty copy's target came with no card at all, "Choose a player to mill"; Whispering Madness's discard of
whole hands, with as many drawn, logged as mills (the hands stayed level); cipher's exile reads "is exiled", not the
creature it is encoded on.)
Not tested: Skulk, Mayhem, Embalm, Battle Cry, Enlist, For Mirrodin!, Hexproof from (Volatile Stormdrake was discarded).
Tests: 603 bridge scenarios. Mutation pass tmp/mut25.js: 13/13.

## Gap fill (2026-10-30): every keyword played
Kit "Gap 16" (tmp/handplay/gap-16.json) against ai_gap_creatures, on the rebuilt engine image (fixes from hp-15).

Played:
- For Mirrodin!: Hexplate Wallbreaker made a 2/2 Rebel and attached itself to it.
- Mayhem: Survival of the Fittest discarded Chameleon, Master of Disguise; "Cast Chameleon, Master of Disguise — mayhem"
  was offered from the graveyard that turn and cast for {2}{U}, entering as a copy of Kenrith (named Chameleon).
- Embalm: Faithless Looting discarded Vizier of Many Faces; its embalm from the graveyard made a token copy of the Rebel:
  white, a Zombie as well, no mana cost.
- Battle Cry and Enlist: Hero of Bladehold and Yavimaya Steelcrusher attacked; the Steelcrusher enlisted the 4/4 Rebel
  (+4/+0); the battle cry and the Hero's two Soldiers (tapped and attacking): 7 damage. The AI's first-striking Precinct
  Captain blocked and killed the Steelcrusher.
- Hexproof from: Volatile Stormdrake exchanged with Precinct Captain (4 energy, 2 paid to keep it); with the AI holding
  the Stormdrake, Kenrith's {1}{G} counter ability didn't offer it as a target.
- Skulk: Ingenious Prodigy (X=2, a 2/3) attacked; the AI's only untapped creature, Elvish Mystic made a 3/3 with two of
  Kenrith's counters, didn't block. (The AI's choice isn't visible: consistent, not a proof.)

Findings and fixes (bridge/bridge.js):
1. The Wallbreaker's attach to its Rebel (a board after it entered) was never said. Fixed: "Hexplate Wallbreaker is
   attached to Rebel Token" when a permanent that stays gets attached to something new (an equip too).
2. Survival of the Fittest's discard cost read "search your library for which Creature card?" over the hand card.
   Fixed: Forge's "Choose cards to discard" from the hand reads "discard which creature card for the cost?", and a
   discard that is no cost "discard which card?" (Faithless Looting read "choose a card from your hand").
3. Chameleon's (and the Vizier's) copy choice read "choose a card". Fixed: "copy which creature you control?" from the
   card's "enter as a copy of ...".
4. The embalm read "White uses Vizier of Many Faces's ability". Fixed: "White embalms Vizier of Many Faces" (eternalize
   the same).
5. Enlist's question came with no card: "Choose cards (up to 1)". Fixed: "Enlist: which of your attackers enlists a
   creature?" with what it does.
6. The battle cry read "Hero of Bladehold's battle triggers". Fixed: a two-word keyword whole, "battle cry".
7. The Soldiers that entered attacking read "White attacks with Soldier Token, Soldier Token". Fixed: "White creates 2
   Soldier Tokens, tapped and attacking"; only creatures that were already there are declared attackers.
8. The Stormdrake's target read "Volatile Stormdrake: GainControl" (Forge's hint, two words run together). Fixed: such
   hints are hints: "exchange control of Volatile Stormdrake and which creature an opponent controls?".
9. Energy (gained 4, paid 2), shown on the table, was never logged. Fixed: "White gets 4 energy (4 in all)", "White
   pays 2 energy (2 left)".
10. The exchange of control was never logged. Fixed: "AI 1 gains control of Volatile Stormdrake", "White gains control
    of Precinct Captain".
Test helpers: tmp/draw.sh and tmp/attack.sh matched both Kenrith's and Chameleon's copied abilities and picked nothing
(a turn passed without the attack); they take the first now.

Open: the Precinct Captain block was never on a board the bridge saw (the block and first-strike damage came between
two of White's questions), so the log said only "Yavimaya Steelcrusher dies". Mayhem's "not castable the next turn"
couldn't be checked: Chameleon was on the battlefield by then.
Tests: 764 bridge scenarios. Mutation pass tmp/mut48.js: 18 mutations, 3 escaped (17%). One was a guard Forge never
reaches ("Choose cards to discard" always comes over hand cards): removed. One closed with an input (GainControl over a
card whose text gives no sentence), re-run caught (tmp/mut48b.js 1/1). One is uncatchable here: the energy line's
"no earlier count" guard only matters for a board saved by an older bridge (a resume after a restart), which no golden
input reaches.
