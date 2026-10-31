# Hand test: hp-15 "Keywords 13" (40 cards)

Played 2026-10-29, seat White (kit "Test 15: Keywords 13" by tmp/kit-15-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
TTS and the bridge relaunched fresh before the deck (the bridge with every fix through hp-14).

Covers: Extort, Boast, Spell mastery, Adamant, Revolt, Vivid, Retrace, Miracle, Fuse, Mountainwalk, Teamwork, Eerie,
Survival, Assist, Fabricate.

## Worked
- Fuse (Turn // Burn): "how do you play it?" Cast Burn | Cast Turn // Burn | Cast Turn; fused, Turn on Kenrith (it lost
  its abilities for the turn), Burn on AI 1 (-2).
- Cascade (Throes of Chaos): Marionette Apprentice hit and cast (Fabricate: the Servo); Retrace from the graveyard:
  "pay Retrace (Discard a land card)?", "discard which land card (Retrace)?", the cascade hit Blind Obedience.
- Extort (Blind Obedience): each later spell asked, paid: +1 / -1 life.
- Desecrate Reality: the AI's Swamp exiled (one per player). Assist (Game Plan): no helper, cast; everyone's hand and
  graveyard shuffled away and seven drawn.
- Survival (Kona): attacked with haste from Kenrith, at the second main phase "Kona, Rescue Beastie: put which permanent
  card onto the battlefield?" (the hp-05 put rule).

## Findings and fixes (bridge/bridge.js)
1. Fuse's way read "Cast Turn // Burn". Fixed: "Cast both halves (fuse)".
2. Cascade's exiled cards read "Throes of Chaos: look at these cards (your library)" (Forge: "Cascade - Throes of
   Chaos" as the ability text). Fixed: "Throes of Chaos: cascade: cards exiled from the top of your library".
3. Cascade's hit read "Cast Marionette Apprentice?" (no ability text). Fixed: after a cascade or discover reveal (30
   s), "Cast Marionette Apprentice without paying its mana cost?".
4. Fabricate read "Marionette Apprentice: pay Put a +1/+1 counter on Marionette Apprentice?" Pay ... | No: create one
   1/1 ... Servo. Fixed: "fabricate 1: a +1/+1 counter on it, or a 1/1 Servo token?" +1/+1 counter | Servo token.
5. "White casts Throes of Chaos" was logged twice: the cascade trigger ("Cascade - Throes of Chaos", its source the
   spell on the stack) read as a second spell under the spell's key (seen in the recorded table stream). Fixed: Forge's
   "<Keyword> - <card>" trigger text is an ability: "White uses Throes of Chaos's ability".
6. Extort read "Blind Obedience: pay {W/B}?" and the payment asked again after Yes. Fixed: "extort: pay {W/B}?" with
   "If you do, each opponent loses 1 life and you gain that much life." under it; Pay on your own card's question
   starts the payment, which then comes from the pool (an opponent's card's still asks).
7. Assist read "Game Plan: choose any you want" over "AI 1". Fixed: "assist: ask which player to pay up to {5} of
   it?", "Pick none to pay it all yourself.".
(Open: a fused split card's first target reads "choose a target" without its half (Forge sends Fuse's reminder as the
ability text); Game Plan's shuffle of hands and graveyards logged only "AI 1 draws a card".)
Not tested: Boast (Varragoth was shuffled away by Game Plan), Miracle (Reforge the Soul never the first draw), Revolt,
Vivid, Spell mastery, Adamant's bonus, Teamwork, Eerie's draw, Mountainwalk.
Tests: 596 bridge scenarios. Mutation pass tmp/mut24.js: 13/14; the escape (an Assist card's optional-cost selection)
is now an input: 14/14.

## Gap fill (2026-10-30): every keyword played
Kit "Gap 15" (tmp/handplay/gap-15.json) against ai_gap_creatures, two games (the first ended when Reforge the Soul's
seven-card draw emptied White's library).

Played:
- Spell mastery: Animist's Awakening X=8 with one sorcery in the graveyard: its four lands entered tapped; again (back in
  hand by manual fix) with Demonic Tutor and Mystical Tutor there: its five lands entered untapped.
- Vivid: Kithkeeper made one Kithkin (X = colours among White's permanents: Kenrith and Kithkeeper are white only, lands
  colourless; the plan's "Kenrith alone gives all five" confused colour identity with colour). Bloom Tender added {W}{G}
  (white Kenrith, green Bloom Tender).
- Eerie: Entity Tracker, then Glorious Anthem entering: a card drawn.
- Boast: Varragoth attacked; its boast in the second main phase targeted White: Brainstorm searched and put on top.
- Miracle: Brainstorm put Reforge the Soul back; drawn first in White's draw step: the miracle trigger, revealed, cast
  for {1}{R} paid by lands; each player discarded and drew seven.
- Teamwork: HULK SMASH! with Kenrith tapped (power 4+): both modes, Thran Dynamo destroyed and Kenrith's damage killed
  Savannah Lions.
- Adamant: Desecrate Reality paid {7} from the pool's colourless: Scrubland (mana value 0) exiled, Entity Tracker (3)
  returned from the graveyard.
- Mountainwalk: Dwarven Grunt attacked unblocked while the AI had Stomping Ground and four untapped creatures (a 3/3
  among them).
- Revolt: Fatal Push on White's own Entity Tracker (mana value 3): survived without revolt; after Evolving Wilds was
  cracked, the second Push (back in hand by manual fix) destroyed it.

Findings and fixes (bridge/bridge.js unless said):
1. Animist's Awakening asked "click the card to put on top" over the lands it puts onto the battlefield. Fixed: the order
   lands go onto the battlefield together isn't asked (as bottom-of-library and exile-all orders aren't).
2. Its lands read "White puts X onto the battlefield" once per land, never "tapped". Fixed: one line per player, tapped
   ones apart: "White puts Command Tower, Forest, Exotic Orchard onto the battlefield tapped".
3. Forge's script for Animist's Awakening remembers its lands and never clears them (no Cleanup): cast a second time, its
   spell mastery untapped the first cast's four lands too. Fixed in manabrew/forge/forge-gui/res/cardsfolder/a/
   animists_awakening.txt (DBCleanup, ClearRemembered); 53 more scripts remember without clearing, flagged for a
   separate audit. Takes effect with the rebuilt mtg-forge-node image.
4. Varragoth's boast search read "choose a card" ("Target player searches their library"), and its "shuffles their
   library and puts that card on top" logged nothing. Fixed: "search your library for which card?" and "White shuffles
   and puts a card on top of their library".
5. Brainstorm's two cards went back with no order asked: the last picked ended on top, so Reforge the Soul picked first
   lay under a Swamp. Fixed: after the pick, "Brainstorm: click the card to put on top" (or keep: the first picked on
   top). Confirmed live in the second game (Forest put on top, drawn next).
6. Miracle's trigger read "Use Reforge the Soul?" and its cast "Cast Reforge the Soul?". Fixed: "Reforge the Soul:
   miracle: reveal it to cast it for {1}{R}?" (Reveal it / Keep it) and "Reforge the Soul: cast it for its miracle cost
   {1}{R}?"; the log says "White casts Reforge the Soul (miracle)".
7. Reforge the Soul's resolution read "AI 1 draws a card" and "AI 1 mills Elvish Mystic, ..." and nothing of White's
   draws. Fixed: "each player discards" / "each opponent discards" make those players' hand-to-graveyard cards
   discards, and a hand discarded then drawn anew counts its draws though it ended smaller.
8. White's loss to the empty library was said only in chat. Fixed: "Game over: ..." in the game log, once.
9. `mtg mana 99` left the priority question without the spells it paid for (seen three times: "a land play gives a fresh
   question"). Cause: the harness's mana op ran produceMana through GameAction.invoke, which queues it on a thread named
   "Game..." when called from another thread, so the playable list was computed before the mana arrived. Fixed in
   manabrew/forge-harness ManaBrewInteractiveSession.applyStateOp: produceMana called directly (the game is held in
   that priority wait). Takes effect with the rebuilt image.
10. HULK SMASH!'s targets, with Forge sending every mode, read "• Destroy which noncreature artifact?" for all three.
    Fixed: the one target phrase every candidate fits, by type words and controller, makes the question: "which
    creature you control deals damage equal to its power to target creature an opponent controls?"; a leading bullet
    is dropped.
11. Teamwork's creatures to tap read "to crew it". Fixed: "tap which creatures for teamwork (total power 4 or more)?"
    (the keyword is read with its reminder).
12. Fatal Push read "mana value 2 or less" with revolt on. Fixed: a revolt card's question says "Revolt is ON: a
    permanent you controlled left the battlefield this turn" (or off); the bridge notes each player's departures.

Open: draws are listed before discards when both happen in one board (Reforge the Soul). "Evolving Wilds goes to the
graveyard" for a sacrifice paid as a cost. Varragoth's target question reads "choose a player to search their library".
Tests: 752 bridge scenarios. Mutation pass tmp/mut47.js: 27 mutations, 6 escaped (22%), all closed with new inputs and
re-run caught (tmp/mut47b.js 4/6, then tmp/mut47c.js 2/2): the game-over question coming twice, a revolt from the turn
before, two modes with the same target phrase, a lone bullet, an artifact creature alone among the candidates ("non"
words), and a miracle declined then the card cast the usual way (a "(miracle)" record kept would have named that cast).
Image: mtg-forge-node:exile rebuilt with fixes 3 and 9 (63789b68057e; rollback mtg-forge-node:animist-prev) and swapped
in between games. Fix 9 confirmed live at the start of the hp-16 gap game: the question right after `mtg mana 99`
offered every spell, with no land play needed.
