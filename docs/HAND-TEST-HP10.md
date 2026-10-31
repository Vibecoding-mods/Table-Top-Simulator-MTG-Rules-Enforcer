# Hand test: hp-10 "Keywords 8" (40 cards)

Played 2026-10-29, seat White (kit "Test 10: Keywords 8" by tmp/kit-10-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Played on the same TTS session as hp-09's second game, on the new NVIDIA driver 621.01: TTS stayed up past 83,000
loaded objects (every earlier crash came at 81-84k).

Covers: Saddle, Discover, Megamorph, Magecraft, Splice, Flanking, Morbid, Clash, Overload, Forestwalk, Delve,
Horsemanship, Waterbend, Converge, Imprint.

## Worked
- Imprint (Chrome Mox): "exile a nonartifact, nonland card from your hand?" Yes, then the pick; the card exiled.
- Magecraft (Storm-Kiln Artist): Tragic Slip cast, "White creates Treasure Token". Tragic Slip's -1/-1 target asked.
- Saddle (The Gitrog, Ravenous Ride): Saddle 1 with Storm-Kiln Artist; attacking with Kenrith's haste, the combat
  damage trigger: "sacrifice a creature that saddled it this turn?", the sacrifice, "White draws 4 cards", the lands put.
- Discover (Chimil, the Inner Sun): at the end step, Island and Marvo exiled, "Cast Marvo ... without paying its mana
  cost or put it into your hand?", cast.
- Overload (Cyclonic Rift): with no target for the normal cast, the overload was the only way and was cast at once.
- Megamorph (Gudul Lurker): "how do you play it?" Cast | Cast (face down); "Megamorph {U}" turned it face up with a
  +1/+1 counter.
- Delve (Dig Through Time) cast: the pool paid, so no graveyard card was asked for.

## Findings and fixes (bridge/bridge.js)
1. Chrome Mox's imprint pick read "choose up to 1 card from your hand". Fixed: an exile from your hand or graveyard
   with no destination: "Chrome Mox: exile which nonartifact, nonland card from your hand?".
2. Saddle's creatures read "tap which creatures to crew it (total power 1 or more)?" and the activation would log as an
   ability. Fixed: "to saddle it", and "White saddles The Gitrog, Ravenous Ride".
3. The Gitrog's lands read "choose up to 4 cards from your hand" ("put up to X land cards"). Fixed: the put rule takes
   X: "put which land cards onto the battlefield?".
4. Discover's exiled cards read "Look at these cards (your library)". Fixed: "Chimil, the Inner Sun: discover 5: cards
   exiled from the top of your library" (cascade the same way).
5. Megamorph's face up logged "White uses Gudul Lurker's ability" beside "is turned face up". Fixed: a morph,
   megamorph or disguise turn is only "is turned face up". And a player's record that isn't a cast (unearth, crew, a
   face-up trigger) meeting the card's stack item is logged as an ability, not "casts" (it read "casts" for any record
   but a plain ability).
(Open: the log says "White looked at 2 cards (their library)" beside the discover's exile lines; the overload cast isn't
named as an overload; Desperate Ritual was imprinted, so Splice wasn't tried (it needs a second Arcane spell anyway).)
Not tested: Splice, Clash, Converge (Painful Truths with an empty library would have lost), Delve's graveyard pick,
Flanking, Forestwalk and Horsemanship evasion (the AI had no creatures or Forests), Waterbend.
Tests: 556 bridge scenarios. Mutation pass tmp/mut19.js: 10/14 caught at first; new inputs (a discover from another
player's library, a megamorph through the play record) closed two; the other two are equivalent: the imprint rule's
comma trim never had a trailing comma to trim (removed as dead code), and a face-up record marked said before priority
returns leaves the card's trigger read as an ability by its "When" wording anyway. 12/14, SOUND.
Also fixed during hp-11: Gift's option read "Pay Promise Gift: Gift something", now "Promise the gift".

## Gap fill (2026-10-29): every keyword played
Kit "Gap 10" (tmp/handplay/gap-10.json) in three games: against ai_gap_creatures (it attacked but never blocked),
ai_bigboard (walls, which block) and ai_gap_lands (a Forest early).

Played:
- Clash: Marvo, Deep Operative attacking: "You: Swamp (0), AI 1: Garruk's Companion (2). AI 1 wins.", then "Keep Swamp
  on top of your library?".
- Splice: Kodama's Reach with Desperate Ritual and Glacial Ray spliced: Glacial Ray's damage target asked, {4}{R}{R}{G}
  paid, the AI took 2, both spliced cards stayed in hand.
- Converge: Painful Truths paid from the pool with three colours: three cards drawn.
- Delve: Dig Through Time with no pool, four lands: the payment offered "Exile Diabolic Tutor from your graveyard (Delve:
  pays {1})" per card; four exiled took {6}{U}{U} to {2}{U}{U}; the log said "Diabolic Tutor, City of Brass, Forest,
  Command Tower are exiled from White's graveyard". (With the 99-mana pool Forge pays it all and asks no delve.)
- Flanking: Cavalry Master into Fog Bank: "Cavalry Master's flanking triggers (White)", with Kenrith's trample 2 got
  through.
- Horsemanship: Herald of Hoofbeats and Cavalry Master (a Knight, given horsemanship) unblocked past Fog Bank and Wall of
  Frost.
- Waterbend: Flexible Waterbender's "Waterbend {3}" paid by tapping Kenrith, Cavalry Master and Herald ("Tap X
  (Waterbend: pays {1})"): 5/2.
- Forestwalk: Chatterfang unblocked while the AI had a Forest and an untapped Elvish Mystic.

Findings and fixes (bridge/bridge.js):
1. Splice's choice read "Kodama's Reach: search your library for which basic land cards?" over Desperate Ritual and
   Glacial Ray (Forge's description "Splice", the spell's own text read for a purpose). Fixed: "Kodama's Reach: splice
   which Arcane cards onto it?" with what splicing does under it.
2. The cast line said nothing of the splice: "White casts Kodama's Reach". Fixed: "White casts Kodama's Reach (spliced:
   Desperate Ritual, Glacial Ray)".
3. Dig Through Time's pick read "Dig Through Time: choose 2 cards" ("Put two of them into your hand"). Fixed: "put which
   cards into your hand? (choose 2)".
4. Blocks were never logged (the table draws them as lines). Fixed: "Fog Bank blocks Cavalry Master", "Wall of Air,
   Coral Barrier block Herald of Hoofbeats", from Forge's combat assignments, each new block once.
Not tested here: The Unagi of Kyoshi Island's ward (paid by waterbend) needs an AI that targets it; Waterbend itself is
played. A clash won by White (the AI won this one).
