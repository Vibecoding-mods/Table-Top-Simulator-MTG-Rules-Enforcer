# Hand test: hp-17 "Keywords 15" (40 cards)

Played 2026-10-29, seat White (kit "Test 17: Keywords 15" by tmp/kit-17-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Same TTS session as hp-15 and hp-16 (~82,400 loaded objects, no crash).

Covers: More Than Meets the Eye, Umbra armor, Mobilize, Solved, Convert, Void, Transmute, Scavenge, Annihilator,
Dredge, Formidable, Rally, Renew, Repartee, Jump-start.

## Worked
- Transmute (Muddle the Mixture): with nothing to counter it went straight to "search your library for which card with
  the same mana value as this card?"; Life from the Loam found.
- Dredge (Life from the Loam): three cards milled, the Loam back to the hand.
- More Than Meets the Eye (Starscream): cast converted (Starscream, Seeker Leader).
- Annihilator (Kozilek): the AI sacrificed its Swamp. Mobilize (Voice of Victory): two Warrior tokens attacking.
  Rally (Hero of Goma Fada) triggered. 26 damage dealt.

## Findings and fixes (bridge/bridge.js)
1. Transmute's discard logged "Muddle the Mixture is put into White's graveyard" (hp-05's cycling the same). Fixed: the
   card whose ability its owner just used from the hand, into the graveyard: "White discards Muddle the Mixture".
2. Dredge read "Use Life from the Loam?" (Forge: "Apply replacement effect of Life from the Loam?\r\nLife from the Loam
   - Dredge 3"). Fixed: "Life from the Loam: dredge 3 instead of drawing?" Dredge | Draw, with what it does under it.
3. The dredge's three milled cards read "mills Forest, Forest" and "Plains is put into White's graveyard" (the hand's
   gain, the Loam from the graveyard, was counted as drawn). Fixed: the cards drawn are at most what left the library
   for the hand: "White mills Forest, Forest, Plains".
4. More Than Meets the Eye's way read "(MTMtE)", the harness's short name. Fixed: "(More Than Meets the Eye)".
Not tested: Umbra armor, Solved, Convert's flip, Void, Scavenge, Formidable, Renew, Repartee, Jump-start.
Tests: 607 bridge scenarios. Mutation pass tmp/mut26.js: 5/6; the escape (cast records counted too) is equivalent: a
cast record's card reaching a public zone is logged as cast in the same board (castNow), which keeps it out of that
branch.

## Gap fill (2026-10-30): every keyword played
Kit "Gap 17" (tmp/handplay/gap-17.json) against ai_gap_creatures.

Played:
- Renew: Entomb put Qarsi Revenant in the graveyard; renewed onto Stirring Hopesinger (flying, deathtouch and lifelink
  counters).
- Scavenge: Boneyard Mycodrax looted away; first scavenged at power 0 (Renew had exiled the only other creature card),
  then again (back from exile by manual fix, Palace Jailer moved to the graveyard): one +1/+1 counter on Elegy Acolyte.
- Repartee: Quasiduplicate on Hopesinger, later Murder: a +1/+1 counter on each creature White controlled, once per
  Hopesinger.
- Jump-start: Quasiduplicate cast again from the graveyard, a card discarded, then exiled. (Its copy of Kenrith met the
  legend rule: "which Kenrith, the Returned King stays?".)
- Void: a token left the battlefield; Elegy Acolyte's end-step trigger made a Robot.
- Umbra armor: Bear Umbra on Elegy Acolyte, Murder on the Acolyte: it stayed, the Umbra was destroyed; later, cast from
  the top of the library onto Kenrith, it saved Kenrith from Typhoid Rats' deathtouch in a fight.
- Convert: Starscream cast as Seeker Leader ("— more than meets the eye"); Palace Jailer made White the monarch and it
  converted to Power Hungry, whose trigger then drained the AI on each draw.
- Solved: Case of the Locked Hothouse (an extra land each turn), eight lands by Explosive Vegetation and the extra drops;
  solved at White's end step; the top card was then visible and "Cast Bear Umbra" offered from the top.
- Formidable: Gimli's Reckless Might's trigger on an attack with Kenrith (total power 8+): Kenrith fought Typhoid Rats.

Findings and fixes (bridge/bridge.js unless said):
1. Renew and Scavenge read "White uses ...'s ability". Fixed: "White renews Qarsi Revenant", "White scavenges Boneyard
   Mycodrax".
2. An Aura's target read "choose a target to attach it to". Fixed: "Bear Umbra: enchant which creature?".
3. The umbra saving its creature read only "Bear Umbra goes to the graveyard". Fixed: "Bear Umbra is destroyed instead
   of Elegy Acolyte (umbra armor)".
4. The monarch (and the initiative) were shown and said nowhere, though Forge sends them. Fixed: "White becomes the
   monarch" / "takes the initiative" in the log, and MONARCH / INITIATIVE in the label under the player's life counter
   (tools/engine-renderer.lua, pushed; tests/test_table_claims.js, broken and restored by hash).
5. Gimli's Reckless Might's formidable target read "choose a target" (two targets in one sentence). Fixed: the target
   phrase the candidates fit, by type, state (attacking, blocking, tapped, untapped) and controller, from sentences with
   two targets as from modes; its condition and "up to one" left out: "which attacking creature you control fights up to
   one target creature you don't control?", then "... fights which creature you don't control?".
6. The Case's solving read "White uses Case of the Locked Hothouse's ability", and nothing showed it solved (Forge sends
   no flag). Fixed: "Case of the Locked Hothouse is solved" and "Solved" on the card.
Tests: 775 bridge scenarios, 191 table checks. Mutation pass tmp/mut49.js: 21 mutations, 1 escaped (5%): the state
words never decided in the inputs; closed with a tapped/untapped modal case, re-run caught (tmp/mut49b.js 1/1).

Test-run notes: Animist-style decking risk again (the monarch's draws): six graveyard cards were put back on the bottom
of the library by manual fix to reach the solving end step. A `mtg mana` in the draw step left a fix waiting; cancelled.
