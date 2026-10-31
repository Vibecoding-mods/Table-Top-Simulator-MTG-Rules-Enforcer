# Hand test: hp-01 "Mechanics 1" (40 cards)

Played 2026-10-28 on the live table, seat White (kit "Test 01: Mechanics 1" by tmp/kit-01-direct.lua), against
`mtg start 1` with `mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws. TTS relaunched fresh before the deck
and the ENGINE MODE save loaded through the Games menu by hand (68.9k objects at the start). Real clicks and drags for
the interaction kinds; routine casts and Kenrith's draws through tmp/act.js.

Covers: Hermit Druid, Verdant Catacombs, Evolving Wilds, Prodigal Sorcerer, Llanowar Elves, Sol Ring, Arcane Signet,
Feed the Swarm, Imp's Mischief, Counterspell, Swords to Plowshares, Lightning Bolt, Beast Within, Lightning Greaves,
Heroic Intervention.

## Worked (by hand)
- Keep; Prodigal Sorcerer cast by drag.
- Prodigal Sorcerer (haste from Kenrith's {R}): clicked, its ability button, then the AI's life counter: 1 damage.
- Llanowar Elves tapped for mana by hovering and pressing E: {G} into the pool.
- Arcane Signet tapped with E: "Tap Arcane Signet for which mana?" with the five colours of the commander's identity
  as coloured buttons; {U} clicked, {U} into the pool.

- Lightning Greaves equipped by hand: clicked, "Equip {0} (...Equip only as…" (cut at a word), then Hermit Druid
  clicked: "Lightning Greaves: choose a target to attach it to".
- Hermit Druid (haste from Greaves): clicked, its ability, "Hermit Druid: revealed (your library)" (the hp-22 reveal
  wording live), a Mountain into the hand.

- Sol Ring tapped with E: {C}{C}.
- Swords to Plowshares on my Prodigal Sorcerer (target clicked; Hermit Druid, shrouded by Greaves, not offered): exiled,
  +1 life. Beast Within on Llanowar Elves (clicked): dies, a 3/3 Beast token. Heroic Intervention: Kenrith hexproof and
  indestructible. Lightning Bolt at the AI's life counter: 3.
- Verdant Catacombs: dragged in, clicked: "Verdant Catacombs: pay 1 life?" Pay 1 life | Don't pay; no Swamp or Forest
  was left, so Forge showed the library.
- Counterspell on the AI's Relentless Rats (dragged from the hand while the Rats were on the stack), then Imp's
  Mischief on my own Counterspell: 2 life lost (its mana value), Counterspell's new target asked; the Rats countered.
- Not tested: Feed the Swarm (the AI never had a creature or enchantment on the battlefield), Evolving Wilds (as
  Verdant). The game ended at my turn-7 draw (Kenrith had drawn the deck).

## Findings
1. (log) Equipping read "White uses Lightning Greaves's ability" (not which creature it was attached to). Open.
2. (log) Hermit Druid's Mountain into the hand read "White draws a card", and the table showed it as a draw. Fixed: a
   reveal whose ability puts the card into your hand marks it as put, not drawn (scenario "hp-01: Hermit Druid's
   reveal marks the hand card as put": Druid yes, Parley no). Not seen live yet (the bridge restarts with the next
   relaunch).
3. Verdant Catacombs with nothing to find read "look at these cards (your library)". Fixed: a search for a kind of card
   with none of that kind shown says "Verdant Catacombs: no Swamp or Forest card in your library" (a card fits a
   term when each word is its name, type or subtype).
4. Counterspell's and Imp's Mischief's targets read "engine-stack-56", "engine-stack-58": a player can't tell them
   apart. Fixed: "Relentless Rats (AI 1's spell)", "Prodigal Sorcerer (your ability)".
5. (table) A spell target has no card to click (clicking the spell on the stack did nothing) and the hint said "Click
   a glowing card". Fixed the hint: "Pick the spell in the Engine panel (Engine: show)." Making the stack's cards
   clickable for a spell target is still open.
6. (log) The countered Rats left no line. Fixed: "Relentless Rats is countered" (a permanent spell from the stack into
   a graveyard; an instant resolving there isn't).
Tests: 501 bridge scenarios; all four suites pass. 3-6 not seen live (the bridge isn't restarted above ~80k objects).
