# Hand test: hp-07 "Keywords 5" (40 cards), drag and drop only

Picked first of the 24 hand-play decks for risk (2026-10-27): an extra zone (Attractions), face-down (Disguise), auras
that become creatures (Bestow), poison (Infect, Toxic), evasion the table must draw right (Shadow, Fear, Swampwalk).
Same rules as docs/HAND-TEST-40.md: drag and drop and the table's own buttons only, the Engine panel closed unless a
question needs it, against `mtg aideck ai_passive_lands` with `mtg mana 99` every turn. Play until every card has been
drawn and played, log each finding here with a number, fix only after the deck is complete.

## Setup
1. White's seat. The kit "Test 07: Keywords 5" came out of the "Hand-test decks (40 cards)" bag alone (its
   40 cards, not the bag's 1,000). Your own Thantis deck (c9e8b7) and Thantis (c5b11f) were moved off White's library
   and command spots to x 46.5, z -26 / -31 so the kit could load; they go back to x 40.8 z -18.8 / x 39.5 z -8.4.
2. `mtg aideck ai_passive_lands`, `mtg engine on`, READY, Start with 1 AI. Keep 7. `mtg mana 99`.

## Checklist (expected result in brackets)
- Kenrith (command zone) [cast by dragging, tax after it dies; its five abilities as buttons on the card; {3}{U} draws]
- Bayek of Siwa: Disguise [cast face down for {3} as a 2/2 with ward {2}; nobody else sees what it is; turn face up for
  its disguise cost; the log names it only once face up]
- Blightsteel Colossus: Infect, indestructible [combat damage to the AI gives poison counters (shown on the table), to
  creatures -1/-1 counters; shuffled back into the library if it would go to a graveyard]
- "Lifetime" Pass Holder: Open an Attraction [Attractions are an Un-set mechanic; Forge may not support it: note what
  happens: a question, nothing, or a refusal]
- Alesha, Who Laughs at Fate: Raid [attack trigger: +1/+1 counter; raid end step: return a creature card with mana value
  <= Alesha's power from the graveyard]
- Hero of Iroas: Heroic [auras cost {1} less; targeting it with a spell puts a +1/+1 counter on it]
- Springheart Nantuko: Bestow [cast for its bestow cost as an aura on a creature (half-size under it, like Rancor);
  landfall makes a token copy of the enchanted creature; if the creature leaves, Nantuko stays as a creature]
- Skrelv, Defector Mite: Toxic 1 [combat damage to a player gives 1 poison; its ability gives a creature toxic and
  protection from a colour: a colour question]
- Filth: Swampwalk [in the graveyard, your creatures have swampwalk (the AI has Swamps?)]
- Migratory Route: Basic landcycling {2} [cycle from the hand: search for a basic land, the library search shows only basics]
- Riverchurn Monument: Exhaust [an exhaust ability works once; afterwards no button for it]
- Constant Mists: Buyback {sacrifice a land} [the cast asks whether to pay buyback; with it, the card returns to the hand
  and a land is sacrificed; fog: no combat damage]
- Dauthi Voidwalker: Shadow [can only block/be blocked by shadow; cards going to the AI's graveyard are exiled with void
  counters instead (linked under Voidwalker?); its ability plays one of them]
- Muraganda Raceway: Max speed [speed rises once per turn when an opponent loses life; at max speed its ability works]
- Shriekmaw: Fear, evoke [evoke cost asks; ETB destroys target nonartifact nonblack creature]
- Not Dead After All: Role token [return a creature card... and a Wicked Role attached to it (a token aura shown under it)]
- Lands: Command Tower, Exotic Orchard, City of Brass (1 damage), Mana Confluence (1 life) [mana colour questions; life
  loss shown], basics to the land row

## Results
### Session 1 (2026-10-27, White vs AI 1 at Red, AI went first)
Worked: Disguise face-down cast (no name anywhere until it died: "Bayek of Siwa dies"); paying from floating mana by
itself; Bestow (how-do-you-play-it, target glow, Alesha 3/3, Nantuko under her); heroic (+1/+1 when targeted by Not
Dead After All); evoke (two triggers ordered, destroy first, "Shriekmaw dies"); commander destroyed -> "Put back in
the command zone?" -> recast with tax; Kenrith's {4}{B} reanimation ("returns to the battlefield from White's
graveyard"); Buyback (optional cost question, sacrifice, back to hand); basic landcycling (offered on the drag, only
basics to choose, "looked at 7 cards" only); Exhaust (menu, mill 0 of an empty graveyard); "Back" puts the card in the
hand at once (#30 fix); optional second target "or Done (1 chosen)" (#47 fix); Kenrith's draw button on the card;
"Lifetime" Pass Holder: nothing to open (no Attraction deck: correct).

1. Before Start, the table's manual Scry tool (red round button, "left click for 1 card") shows on the mat in engine
   mode. (Gone once the game runs.)
2. The die-roll chat line names the AI by its engine name ("self-hosted-node-afcf42ad-...-bot rolled 18 ... goes
   first") instead of "AI 1".
3. With 8+ cards TTS's bottom hand strip widens over the Undo... button (bottom-left row).
4. The how-do-you-play-it box sits over the battlefield: the dropped card's hover text covers its buttons, and the
   creature row (bestow targets) is hidden while it is open.
5. Casts and activations are often missing from the log ("White casts Dauthi Voidwalker", Kenrith's cast, some of
   Kenrith's draws): only "enters the battlefield" / "draws a card". Intermittent: when the spell is paid from the pool
   and resolves before a board with it on the stack is sent.
6. A face-down permanent (Disguise 2/2) is laid out in the non-creature row beside the lands, not with the creatures
   (the face-down card is sent with no types).
7. Ability buttons on cards: even at the closest camera a card is ~25 px wide, the buttons ~2-5 px tall: they can't be
   read and the right one can't be hit reliably (Kenrith's 4th and 5th buttons). Needs a screen-size form (e.g. big
   buttons on screen for the card you click).
8. Right-click menu labels start with the card's whole name ("Kenrith, the Returned King: {3}{U}: Ta..."): the ability
   text is cut off. Drop the card's own name, as the buttons do.
9. A one-target question (player to draw) is answered by the click on the target, but the corner shows Done: pressing
   it then passed priority (Next), skipping the rest of main 1. Either the click shouldn't send, or Done shouldn't show.
10. The stack pop-up for the bestow cast showed a card back (Springheart Nantuko); later pop-ups (Shriekmaw) were fine.
11. Right-clicking a card where an ability button sits uses that button instead of opening the card's menu.
12. (withdrawn) hand label "20 cards" for a moment while 15 were in hand: animation, it settled.
13. Buyback's sacrifice question says "choose a target to sacrifice": a sacrifice is not a target ("choose a land").
14. Constant Mists (instant, buyback) logged as "White uses Constant Mists's ability".
15. Blightsteel Colossus shows a card back in the library look (Migratory Route's search).
16. The look's text lists "Blightsteel Colossus 11/11 (sick)": summoning sickness for a library card.
17. Landcycling's searched land is logged as "White draws a card".
18. A click on a card in the choose-a-card panel also printed "Look only: the engine moves cards out of the graveyard
    when an effect lets you" (the click reached the graveyard card behind the panel).
19. Riverchurn Monument's mill target question: "choose up to 2 players to buff" (it mills them).
20. Right-click menus near the top still open under the top-centre bars (phase bar, player name, Scoop): the first
    items (the abilities) were fully hidden; clicks then hit other menu items ("Cards can't go into another player's
    hand", "Life totals follow the game...").
21. Discards are logged one line per card ("Mountain is put into White's graveyard" x14 at cleanup) instead of
    "White discards 14 cards".
22. A "you may pay" trigger of my own card (Nantuko's landfall: "Pay {1}{G}") asks again with "Pay from mana pool"
    right after I answered Pay, though the pool covers it.
23. The legend-rule question is titled only "Choose a card": it doesn't say it is the legend rule or whether the card
    picked is kept or put into the graveyard.
24. Nantuko's landfall "No" button reads "No: create a token that's a copy of Alesha": that is what paying does (No
    created an Insect token).
25. In the legend-rule question only the original Alesha glows; the token copy (with its COPY label) isn't marked as
    a choice.
26. Poison counters are never shown: the AI had 1 poison (Skrelv's toxic) and the table knows it (players[].poison),
    but no counter or label shows it.
27. Bayek of Siwa (cast face down, later died) shows a card back in Kenrith's graveyard target list: the picture of a
    card first seen face down is never loaded.
28. When Forge aborts after a normal win (Blightsteel's infect: 12 poison), the chat says "White had to draw from an
    empty library (that's a loss)": the abort explanation blames whoever's library is empty (mine, 0 cards) though the
    AI lost to poison. Name poison >= 10 / life <= 0 first, and say nothing about the library then.
Also worked: City of Brass colour question + 1 damage logged; Kenrith {2}{W} life gain logged ("40 -> 45"); Cancel on a
target question; haste/trample button; commander damage 5 shown on the tracker; keep mode at cleanup (7 of 21); the
VICTORY banner; Alesha's raid correctly not triggering (Bayek mana value 5 > power 4).
Game 1 ended (turn 7, AI at 12 poison) with every card drawn. Not yet played: Command Tower (discarded), Exotic
Orchard, Mana Confluence; not yet used: Skrelv's ability, Dauthi Voidwalker's void exile and its ability, Muraganda
Raceway at max speed. -> game 2.

### Session 1, game 2 (same day): the cards and abilities game 1 didn't reach
Worked: Skrelv's ability (target, Phyrexian cost paid with 2 life, colour question, toxic on Kenrith: AI 1 poison);
Riverchurn's mill with Dauthi Voidwalker out ("Plains is exiled", "Island is exiled" with void counters); Dauthi's
ability (sacrifice, choose an exiled card, the Island then in my playable row on the near strip: the #11 fix live);
Command Tower (colour question with the commander's colours); Mana Confluence (colour, then 1 life); summoning-sick
Skrelv had no ability button ({T} in its cost); the log started fresh in game 2 (#41 fix); keep mode again (7 of 33).
Not covered: Exotic Orchard (discarded both games by mis-picks at cleanup), Muraganda Raceway at max speed (needs four
turns of opponent life loss), casting Bayek face up (only face down tested).

29. The hand-zone label shows a wrong count while a question is open ("1 card", "22 cards" with 8 and 33 in hand); it
    is right again afterwards.
30. A Phyrexian cost ({W/P}): Auto-pay doesn't pay it with 2 life and then gives up; the "pay 2 life" option is
    labelled with its raw id "pay-life" and is only in the Engine panel; the corner offers "Tap Swamp for {B}", which
    can't pay {W/P}.
31. Granted keywords aren't shown (Kenrith got toxic 1 and hexproof from blue from Skrelv: nothing on the card).
32. "Sacrifice Dauthi Voidwalker?" asked after using Dauthi's own "{T}, Sacrifice Dauthi" ability (the #9 auto-yes
    didn't apply).
33. Dauthi's "choose an exiled card" (cards in the AI's exile): nothing glows and the corner only shows Done; the way
    (right-click the opponent's exile -> Search, or the Engine panel) is only in the panel text.
34. End turn pressed in main 1 still stopped at "Choose attackers" (Arena's End turn skips the attack too).
35. Mana Confluence: after choosing the colour a second question "pay 1 life?" (Pay / Don't pay): tapping it already
    means paying.

## Deck complete (2026-10-27): 35 findings (#12 withdrawn). Fix next.

## Fixed and reviewed (2026-10-27)
Every finding but #10, #15, #27 (card backs: first-load latency, links verified) and #31 was fixed then; #31 had been missed and was fixed in the re-test below. Engine-side parts deferred
to the next engine build: an isAbility flag on stack items, the UnlessSwitched flag for may-pay, auto-confirming cost
parts in confirmPayment. Then /jr-programmer-suite on these changes (docs/reviews/structural-review-hp07-2026-10-27.md:
structure 12 of 13 applied, simplify, correctness 27 findings fixed, each with a check that fails without it).
Next: deploy, then Undo in game 2 back to #29 and re-test #29–35 on the table. Game 1 (#1–28) is exempt for now (the
game was reset); its outputs are tested later.

## Undo re-test of game 2 (2026-10-27, after the suite)
Rewound with Undo to the earliest restore point (turn 3, Red's attacks; the 25 kept points reach about 3 turns back).
- #29 PASS after a fix: the counter showed "5 cards" with 7 in hand. The deploy never reached the counters: Save & Play
  saves the live table over TS_Save_1 before reloading, so object-script patches made after the table was loaded are
  lost (#37). Patched live, then `tts-push-global.js --patched` added (pushes every "-- [engine copy]" object script).
- Land fix (stage 3 #1) PASS live: "White plays Command Tower", one line.
- Ability panel PASS: pointing at Skrelv showed its ability on the screen; clicking it asked for the target.
- #30 PARTLY: "Pay 2 life" is the option's label and comes before the taps, but nothing on the table showed it (only
  the Engine panel). Fixed: a cost payable with life puts Auto-pay / Pay N life / Cancel in the card row and the hint
  names it (checks "life pay: …"). Not yet seen live.
- #36 NEW: after a rewind the log told the board difference as plays ("Dauthi Voidwalker returns to the battlefield",
  "Command Tower leaves the battlefield"). Fixed: one "--- Rewound to turn N (step) ---" line, the board it went back
  to is the log's new start (scenario "log: a rewind is one line…").
- Stopped there: TTS crashed (d3d11 device removed, 01:19) during the Skrelv payment. The engine game waits at
  "Pay {W/P} for Skrelv". Still to re-test: #30 live, #31, #32, #33, #34, #35 (Mana Confluence left the battlefield
  in the rewind: only if it comes back).

## Undo re-test, continued (2026-10-27, after TTS was reloaded with the new save)
- #29 PASS live: "7 cards" with a question open (the counters carry the patch now; deploys use `--patched`).
- #30 PASS live: the card row showed Auto-pay / Pay 2 life / Cancel and the hint named it; Pay 2 life paid (40 -> 38).
- #31 FAIL, then fixed: nothing showed the granted keywords (no fix had been made). The bridge now sends the keywords a
  card's own text doesn't give it (`kw`, in words: "Toxic 1", "Hexproof from red", "Swampwalk", from Forge's raw
  "Toxic:1", "Hexproof:Red", "Landwalk:Swamp" read with the new debug route GET /card/<name>); the table draws them
  in a green badge. PASS live on Kenrith.
- #32 FAIL, then fixed: "Sacrifice Dauthi Voidwalker?" was still asked. Forge's live title has no "?"
  ("Sacrifice Dauthi Voidwalker"); the auto-yes pattern and the test scenarios had assumed one. PASS live after the fix
  (redone after an Undo: Riverchurn mill, then Dauthi went straight to "choose a card").
- #33 PASS live: the AI's exiled void cards are pictured in the card row; the corner counts "0 of 1 chosen". The row
  click did not answer the exact pick (it waited for Done): fixed, a row pick answers at the last click like the table.
- #34 PASS live: End turn in main 1 went straight to cleanup, no "Choose attackers".
- #35 NOT TESTED: Mana Confluence left the battlefield in the rewind.
- #36 first fix half right: a rewind to the newest restore point in the same turn was not detected (the turn and the
  newest point did not move) and the log again told the difference as plays. Now Forge's approved vote id is the
  third signal. PASS live: "--- Rewound to turn 5 (upkeep) ---", nothing else.
- Exact pick on the table PASS live: cleanup "Discard a card", one click answered.
- #38 NEW, fixed (scenarios only, not yet seen live): "up to 2 players to mill": Done with one chosen asked "another
  target, or Done (1 chosen)", a second Done. The bridge now answers Forge's one-at-a-time follow-ups from the
  player's own picks (the ones not yet taken, then Done; same card, 30 s).

## Finishing the re-test (2026-10-27, game 3)
Game 2 ended by my own mistake: three stacked Kenrith draws emptied the 40-card library (Forge reports that loss as
"aborted"). Game 3: a fresh hp-07 game (kit spawned alone, your Thantis deck moved aside as in Setup) vs ai_passive_lands.
- #35 PASS live: Mana Confluence tapped with E, colour chosen, no "pay 1 life?" (40 -> 39).
- #33 PASS live: Kenrith's {4}{B} with 7 graveyard creatures showed them in the card row; one click answered.
- #38 PASS live: Riverchurn "up to 2 players": one Done, the follow-up and the payment answered by themselves.
- #34 PASS again: End turn went straight to cleanup; keep mode (keep 7 of 34) answered at the last pick.
- #39 NEW, fixed: casting the commander from the command zone (public already) was never logged as a cast when it
  resolved between boards. Scenario "log: a commander cast from the command zone is one cast line".
- #40 NEW, engine-side, deferred: the first priority question after `mtg mana 99` is built before the fix's mana is in
  the pool, so it lists only what lands can pay; the next question is right.
- #41 NEW, fixed: 8 graveyard targets (more than the card row's 7) showed nowhere and the hint said "Click a glowing
  card". Now the Engine panel opens and the hint says so (checks "many pile targets: ..."); with 7 or fewer the hint
  says "Click its picture in the card row", and the row's own line says "the last click answers" for an exact pick.
- #42 NEW, fixed: "Look only" was told whenever the engine moved a card out of a graveyard. Cause: the table took the
  card out of the pile deck by guid, and cards inside a deck can share a guid: it took a Swamp for Bayek. Now by its
  place in the deck, and the table's own takes are marked. The fake table now fires onObjectLeaveContainer as TTS
  does, which showed a second bug: during a manual Fix, taking a card out of a graveyard or exile pile was thrown
  back (fixed: not while the fix is being edited). PASS live: Filth returned, no message, every object the right card.
hp-07 complete. Engine rebuild list: isAbility flag, UnlessSwitched, confirmPayment cost parts, #40.
