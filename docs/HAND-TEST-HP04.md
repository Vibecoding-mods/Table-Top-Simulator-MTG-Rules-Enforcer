# Hand test: hp-04 "Keywords 2" (40 cards)

Played 2026-10-28, seat White (kit "Test 04: Keywords 2" by tmp/kit-04-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js) while
the user worked in other windows. TTS relaunched fresh before the deck; the bridge restarted with no table loaded.

Covers: Treasure, Deathtouch, Defender, Regenerate, Surveil, Kicker, Flashback, Ward, Protection, Landfall, Crew, Food,
Morph, Fight, Investigate.

## Worked
- Landfall: Tireless Tracker and Tireless Provisioner, the trigger order (Keep this order), "Tireless Provisioner: create
  which token?" Food | Treasure; Investigate: the Clue sacrificed, a card drawn, "Tireless Tracker gets a +1/+1 counter"
  (the hp-06 counter line live); Food: +3 life.
- Defender: Crashing Drawbridge. Kicker: "Tear Asunder: pay Kicker ({1}{B})?" then any nonland permanent offered (the
  kicked text), the Drawbridge exiled.
- Surveil (Consider): no "Cards can't go into another player's hand" — the hp-06 #15 guard live on the rebuilt table.
- Fight (Bridgeworks Battle): the pump target, the fight "up to one" with no creature of the AI's.
- Crew (Hedge Shredder) with the Provisioner; Deathtouch/Protection (Baleful Strix, Yawgmoth) cast; Roaming Throne's
  creature type picked (Human).

## Findings and fixes (bridge/bridge.js)
1. (none) Kicker's question is a 0-1 pick with Done for "no kicker": clear enough.
2. Bridgeworks Battle's first target read "choose a target" (Forge's title "Buff"; two target sentences). Fixed: of
   several target sentences, the one the candidates fit (yours or not yours): "Bridgeworks Battle: which creature you
   control gets +2/+2 until end of turn?".
3. Crew read "Hedge Shredder: choose up to 3 cards", and was logged "uses Hedge Shredder's ability". Fixed: "Hedge
   Shredder: tap which creatures to crew it (total power 1 or more)?" and "White crews Hedge Shredder".
(Checked, no bug: a payment asked "Pay from mana pool" after a target because the cast's 60-second mark had run out
while I edited code mid-question.)
Tests: 524 bridge scenarios; all four suites pass. Mutation pass tmp/mut15.js: 4/5 caught; the escape (a "don't control" check) was unreachable ("you don't control" never matches "you control") and was removed.
Not tested here: Regenerate (Swarmyard went at cleanup), Morph (no morph card drawn), Ward (Roaming Throne's needs an
opponent to target it), An Offer You Can't Refuse (the AI casts creatures only), Flashback (hp-02 covered it).

## Gap fill (2026-10-29): every keyword played
Kit "Gap 04" (tmp/handplay/gap-04.json, tools/make-gap-kit.js: the five untested keywords' cards, Drudge Skeletons,
Relentless Rats, Murder and seven tutors, 40 cards), Kenrith, `mtg mana 99`. Game 1 against ai_gap_spells (mono-blue
cantrips, bounce and ward creatures), game 2 against ai_gap_ward (cheap ward creatures, mana, life and discard costs).

Played:
- Regenerate: Drudge Skeletons' shield, then Murder on it: tapped, still there. Swarmyard: "Swarmyard: regenerate
  which Insect, Rat, Spider, or Squirrel?", the Rats shielded.
- Morph: "Cast Grim Haruspex (face down)", a face-down 2/2, then "Morph {B}" turned it face up.
- Ward: Kenrith's +1/+1 counter at the AI's Hexing Squelcher (Ward, pay 2 life): paid, the counter went on.
- An Offer You Can't Refuse: the AI's Opt in its upkeep, countered; the AI got two Treasures.
- Flashback: Faithless Looting, then "Cast Faithless Looting — flashback" from the graveyard, then exiled.

Findings and fixes (bridge/bridge.js):
1. A face-down cast was named to the whole table: "White casts Grim Haruspex". Fixed: "White casts a face-down spell"
   (the cast record of "Cast X (face down)" carries no name). Seen live in game 2.
2. A cast by another way read like a plain cast: flashback's "White casts Faithless Looting" twice. Fixed: the way from
   Forge's mode, "White casts Faithless Looting (flashback)", "(web slinging)". Seen live in game 2.
3. Regeneration logged nothing: "White casts Murder", then silence. Fixed: "Drudge Skeletons regenerates" (Forge shows
   no shield: one is noted from a Regenerate ability leaving the stack, the player's own record, or a regeneration
   target picked; the creature then tapped, not attacking and not by its own {T} ability). The first fix went by the
   stack alone and missed the live game: the player's own ability resolves before any board shows it.
4. The countered Opt was not said (an instant was never "countered", for a copy spell's sake). Fixed: an instant or
   sorcery under a spell whose text says "Counter target" is countered; under Twincast it still resolves.
5. Two Treasures read "AI 1 creates Treasure Token" twice. Fixed: "AI 1 creates 2 Treasure Tokens".
6. Ward's question read "Hexing Squelcher: pay 2 life?" with "No: counter Kenrith, the Returned King's ability unless
   its controller pays {PayLife<2>}" (Forge's otherwise sentence, its cost code). Fixed: "Hexing Squelcher has ward:
   pay 2 life, or your ability is countered?" (Pay 2 life | Don't pay); a spell says "your spell". The mana ward rule
   had the same gap live: its test had no otherwise sentence.
7. The ward trigger read "AI 1 uses Hexing Squelcher's ability". Fixed: a keyword's trigger (its reminder saying when)
   "Hexing Squelcher's ward triggers (AI 1)"; Hideaway's land the same.
Not seen live yet (the bridge isn't restarted mid-game at ~82k objects): 3's final form, 4, 5, 6, 7.
