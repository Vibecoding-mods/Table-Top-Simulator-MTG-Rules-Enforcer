# Hand test: hp-11 "Keywords 9" (40 cards)

Played 2026-10-29, seat White (kit "Test 11: Keywords 9" by tmp/kit-11-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Same TTS session as hp-09 and hp-10 on NVIDIA 621.01: ~83,400 loaded objects, no crash.

Covers: Wither, Ascend, Aftermath, Doctor's companion, Gift, Sneak, Soulshift, Encore, Firebending, Populate, Blight,
Behold, Ferocious, Corrupted, Level Up.

## Worked
- Gift (Dawn's Truce): "promise an opponent a card?", promised: "AI 1 draws a card".
- Level up (Joraga Treespeaker) twice: 2 level counters, the label "[2 level counters]" (hp-05's counter words live).
- Behold (Champions of the Perfect): High Perfect Morcant beheld from the hand and exiled; when Sneak returned Champions,
  its leave trigger put Morcant back: "High Perfect Morcant is put into White's hand from exile".
- Ferocious (Shamanic Revelation): 7 cards drawn, +12 life. Firebending Student's prowess on each noncreature spell.
- Sneak (Splinter's Technique): at declare blockers, "return which unblocked attacker to your hand?", then the search.
- Aftermath (Cut // Ribbons): Cut killed Thief of Hope (soulshift had no Spirit to return: no question, right);
  Ribbons cast from the graveyard with X = 5, AI 1 lost 5, the card exiled.
- Populate (Rootborn Defenses) with no token: nothing asked. Skrelv's Hive, Impulsive Pilferer, High Perfect Morcant cast.

## Findings and fixes (bridge/bridge.js)
1. Gift's option read "Pay Promise Gift: Gift something". Fixed: "Promise the gift".
2. Level up logged "White uses Joraga Treespeaker's ability"; a crew or saddle seen on the stack read the same. Fixed:
   one keywordLine for a player's keyword activation, stack seen or not: "White levels up Joraga Treespeaker",
   "crews", "saddles", "unearths".
3. Behold's pick read "Champions of the Perfect: choose a card" (Forge: "Behold"). Fixed: "behold which Elf (it is
   exiled)?" from the card's text, with what may be chosen under it.
4. Champions of the Perfect, returned to the hand by Sneak's cost, was logged "leaves the battlefield". Fixed: a
   nontoken permanent gone while its owner's hand gained a card logs "returns to White's hand"; the hand's gain counts
   the cards cast or played from it at the same time, a spell still on the stack included.
5. Splinter's Technique cast by Sneak showed its search as "look at these cards (your library)", then titled the
   search "return which unblocked attacker to your hand?": Forge sends Sneak's reminder as the ability text. Fixed: a
   cast way's keyword-only text (keywordOnly) gives way to the card's own text for a look at, or cards from, your
   library: the look answers itself and the pick reads "search your library for which card?".
6. "Cut // Ribbons is put into White's graveyard" after Cut resolved (the stack had it as "Cut"). Fixed: a card off
   the stack is known by its id too.
Not tested: Wither (the AI never had a creature to damage), Ascend (no 10 permanents: no lands were played), Encore
(Impulsive Pilferer never reached the graveyard), Corrupted (no poison), Blight, Doctor's companion (K-9 drawn last).
Tests: 565 bridge scenarios. Mutation pass tmp/mut20.js: 14/16 at first; the escapes (a creature cast from the hand
resolving beside the bounce; a spell already on the stack before) are now inputs: 16/16.

## Gap fill (2026-10-30): every keyword played but one
Kit "Gap 11" (tmp/handplay/gap-11.json) against ai_gap_creatures.

Played:
- Ascend: Wayward Swordtooth wasn't offered as an attacker; Secure the Wastes for X=10 ("White creates 10 Warrior
  Tokens") made 13 permanents; next turn it attacked for 5.
- Corrupted: Skrelv's Hive's upkeep Mites (toxic 1) with the AI at 4+ poison (Vraska's Fall, Prologue to Phyresis, the
  Mites' toxic): the Mites had lifelink, White 37 -> 40.
- Blight: High Perfect Morcant entering made the AI blight 1: Tolarian Scholar got a -1/-1 counter.
- Encore: Impulsive Pilferer discarded by Faithless Looting, then "Encore {3}{R}": exiled from the graveyard, a token
  copy created.
- Wither: Necroskitter blocked by Tolarian Scholar and Goblin Rabblemaster, then by Deadly Recluse: its damage became
  -1/-1 counters (the Scholar's second, the Recluse's first); the Recluse's deathtouch killed it.
Skipped: Doctor's companion (K-9 as a second commander beside a Doctor; the gap commander is Kenrith), noted in
docs/m5-plan.md.

Findings and fixes (bridge/bridge.js):
1. Nothing said the city's blessing came. Fixed: "White gets the city's blessing" (Forge's hasCityBlessing), once.
2. Poison counters were never logged. Fixed: "AI 1 gets 2 poison counters (2 in all)", and losses.
3. A creature token killed in combat read "Phyrexian Mite Token leaves the battlefield" (a token leaves no card in a
   graveyard). Fixed: a creature token gone in the combat damage step "dies".
4. -1/-1 counters (blight, wither) were never logged, unlike +1/+1. Fixed: "Tolarian Scholar gets a -1/-1 counter".
Also seen live: "Tolarian Scholar blocks Phyrexian Mite Token", "Tolarian Scholar, Goblin Rabblemaster block
Necroskitter" (hp-10's block line).
