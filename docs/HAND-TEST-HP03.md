# Hand test: hp-03 "Keywords 1" (40 cards)

Played 2026-10-28, seat White (kit "Test 03: Keywords 1" by tmp/kit-03-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`. The user worked in other windows, so actions went through the table's
functions (tmp/act.js). TTS crashed once (NVIDIA reset 18:19:07, ~82.5k objects); relaunched, the save loaded by hand,
the game came back by itself.

Covers: Flying, Enchant, Trample, Vigilance, Haste, Flash, Equip, Mill, Reach, Scry, Transform, Menace, Cycling, First
strike, Lifelink.

## Worked
- Cycling (Ash Barrens): "how do you play it?" Basic landcycling {1} | Play Ash Barrens (the hp-06 short label live);
  the search asked at once (no library OK), logged "discards Ash Barrens", "puts a card from their library into their
  hand" (the card hidden).
- Enchant (Wild Growth): no land yet, "can't be cast right now"; after a Forest, "choose a target to attach it to".
- Craterhoof Behemoth (haste, trample), Knight of the White Orchid, Professional Face-Breaker (menace): all attacked for
  30; Face-Breaker's Treasures.
- Flash + Mithril Coat attached to the only legendary creature; Six dragged while a question was open: queued and cast
  at the next priority.
- Transform: Growing Rites of Itlimoc became Itlimoc, Cradle of the Sun at the end step (four creatures).
- Mill: Six's attack, "White mills Mountain, Island, Rampaging Baloths" (the hp-06 mill line live); the land into hand.
- Not seen: Scry (Path of Ancestry scries only when its own mana pays for the creature; the test mana paid). Flying,
  reach, lifelink, vigilance, first strike: static, Forge's.

## Findings and fixes (bridge/bridge.js)
1. Growing Rites' pick read "choose up to 1 card". Fixed: "put which creature card into your hand?" ("a X card from
   among them and put it into your hand").
2. Mangara picked from the top four was logged "White draws a card": the look's search mark (20 s) had run out. Fixed:
   a pick from your own library marks the next card into the hand as put, when the pick is made.
3. The transform logged nothing. Fixed: a battlefield card under another name, "X becomes Y" (a copy effect too).
4. Six's question read "look in your graveyard and exile for a card?", then "choose up to 1 card". Fixed: "Six: put a
   land card from among them into your hand?" and "Six: put which land card into your hand?".
5. (hp-02 #9) A card from a graveyard or exile into the hand logged nothing. Fixed: "Rancor is put into Blue's hand from
   the graveyard" when the hand grew by more than the library gave.
6. (log, open) An Aura's line doesn't say what it enchants ("Wild Growth enters the battlefield").
Tests: 521 bridge scenarios; all four suites pass. Mutation pass tmp/mut14.js: 9/10 caught; the escape (a name change outside the battlefield logged too) is equivalent: public cards change name only there, face-down ones excluded.
