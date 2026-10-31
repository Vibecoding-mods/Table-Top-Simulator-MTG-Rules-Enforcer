# Hand test: hp-12 "Keywords 10" (40 cards), drag and drop only

Second of the risky picks (2026-10-27): creatures that come back (Persist, Undying, Disturb), pairing (Soulbond),
counters put on other creatures (Backup, Bolster, Adapt, Modular), combat oddities (Banding, Enrage), artifacts that
pay for spells (Improvise), Craft (exile from the graveyard), Assemble (Contraptions), Battle Angels of Tyr.
Same rules as docs/HAND-TEST-HP07.md: drag and drop and the table's own buttons only, the Engine panel closed unless a
question needs it, against `mtg aideck ai_passive_lands` with `mtg mana 99` every turn. Play until every card has been
drawn and played, log each finding here with a number, fix only after the deck is complete; then /jr-programmer-suite
and the Undo re-test.

Lesson from hp-07: the library is 33 cards. Draw with Kenrith one card at a time and keep at least 3 in the library
(three stacked draws emptied it and ended the game).

## Setup
1. White's seat. The kit "Test 12: Keywords 10" was spawned alone from the Saved Object (its 40 cards);
   your Thantis deck (c9e8b7) and Thantis (c5b11f) were moved to x 46.5, z -26 / -31; `mtg reset` puts them back.
2. `mtg aideck ai_passive_lands`, `mtg engine on`, `mtg start ai 1`. Keep 7. `mtg mana 99` each turn.

## Checklist (expected result in brackets)
- Glen Elendra Archmage: Persist [dies with no -1/-1 counter: comes back with one; the counter shows]
- Deadeye Navigator: Soulbond [pair question on entering; the pair is visible; blink ability on the paired creature]
- Lunarch Veteran: Disturb [cast from the graveyard transformed; exiled if it would leave]
- Archpriest of Shadows: Backup [+1/+1 counters on target creature; it gains the abilities until end of turn]
- Benalish Hero: Banding [attacks in a band]
- Incubation Druid: Adapt [counters once; mana ability doubles with a counter]
- Steamflogger Boss: Assemble [Contraptions: likely unsupported, say so]
- Apex Altisaur: Enrage [fight on entering; enrage triggers chain]
- Power Depot: Modular [counters move to an artifact creature when it dies]
- Kappa Cannoneer: Improvise [artifacts tap for generic mana while paying]
- Tithing Blade: Craft [exile it and an artifact/creature from the battlefield or graveyard: transforms]
- Gleeful Arsonist: Undying [dies with no +1/+1 counter: comes back with one]
- Anafenza, Kin-Tree Spirit: Bolster [counter on the creature with least toughness]
- Witty Roastmaster, Battle Angels of Tyr, Command Tower, Exotic Orchard, City of Brass, Mana Confluence

## Results
1. Soulbond (Deadeye Navigator): the pairing question reads "Deadeye Navigator: choose up to 1 card" / "Click the
   glowing cards, then Done." Nothing says it pairs (Arena: "Pair with which creature?").
2. The question's pop-up shows Forge's internal text after the trigger: "... unpaired creature you control
   [Zone Changer: Deadeye Navigator (1)]".
3. Soulbond pairs are not visible: Forge's card data has no "paired with" field, so the table can't mark the pair
   (Kenrith did gain "{1}{U}: Exile this creature, then return it" from the pairing). Engine-side: send pairedWith.
4. Banding (Benalish Hero): attacking with it and others never offered a band: the attack question has no way to
   form one (All attack sent everyone separately). Matters for damage assignment when blocked.
Worked: Kenrith cast and logged as a cast (#39 fix live); Deadeye Navigator paired with Kenrith, which gained the blink
ability; Apex Altisaur's fight with no target passed quietly; Kenrith {R} (trample, haste) then All attack: AI 40 -> 13,
Battle Angels of Tyr's triggers ran and were logged.
5. Power Depot (Modular on an artifact land that enters tapped): Forge asks which replacement applies first as
   "Power Depot: choose one: Modular 1 | Power Depot enters tapped." / "Pick, then Done. Play land". Say what it is:
   "Power Depot enters: which applies first?" (either order ends the same here).
6. Right after that drop, the bridge told "Power Depot was played and came back to your hand: it returns a land you
   control when it enters..." - wrong: it is not a bounce land; it was still in the hand only because its question was
   open.
7. A row BUTTON in an exact pick (min = max = 1) doesn't answer at the click (needed the row's Done), unlike the row
   pictures and table cards since #33's fix; the corner said "0 of 1 chosen".
8. Power Depot's +1/+1 counter (Modular) is in the engine but shows no badge: counters on a land are not drawn.
9. "Exile Tithing Blade?" (Yes / No) right after using Tithing Blade's own Craft, whose cost is "Exile this artifact":
   Forge's cost confirmation, like "Sacrifice X?" (hp-07 #32), which the bridge answers yes for the card just used.
10. Craft's second cost question reads "Tithing Blade: choose a card" (it is "choose a creature to exile for Craft").
Worked: Craft as a whole: "Exile Tithing Blade?" (asked, see 9), then Benalish Hero chosen with one click on the table,
both exiled and Consuming Sepulcher returned transformed; each step logged.
11. Bolster (Anafenza) asked "Anafenza, Kin-Tree Spirit: choose a card" with one candidate (Lunarch Veteran, the only
    creature with the least toughness): a choice with one answer should answer itself, and the words should say what
    it is ("bolster 1: which creature?").
Worked: trigger order question (Lunarch Veteran's lifegain and Anafenza's Bolster) clear and answered; Bolster's
counter on Lunarch Veteran; Adapt 3 (Incubation Druid: +3/+3 badge, 3/5); Consuming Sepulcher's upkeep drain logged.
Not testable vs the passive AI: Persist (Glen Elendra), Undying (Gleeful Arsonist), Enrage (Apex Altisaur), Modular's
death trigger: nothing kills my creatures. A manual Fix moving Glen to the graveyard is not a death (Persist didn't
fire, correctly). To do in a second hp-12 game against `mtg aideck ai_bigboard`.
Worked: Disturb: Lunarch Veteran put in the graveyard by a Fix, shown in the playable row, dragged from there onto the
battlefield: "White casts Luminous Phantom" (cast transformed; the priority option is labelled with the back face).
12. Exotic Orchard's colour question reads "Exotic Orchard: choose a color" (Blue / Red / White: right, the AI's land
    colours) while other mana sources ask "Tap Mana Confluence for which mana?" with {W} {U} ... buttons: one wording.
Worked: Backup (Archpriest of Shadows on Kenrith: +1/+1 counter and a Deathtouch badge, the #31 fix live on a real
grant); Kappa Cannoneer, Steamflogger Boss (Assemble does nothing without Contraptions), Witty Roastmaster cast and
logged; Mana Confluence tapped: 1 life, no question (#35); Exotic Orchard tapped. Trigger-order questions show Forge's
internal "(Targeting: [[]]) [Zone Changer: ...]" text too (see 2).
8. WITHDRAWN: Power Depot's +1/+1 badge is there ("+1/+1"); the first look was taken while the card was still
   spawning.

## Deck complete (game 1, 2026-10-27): all 40 cards drawn and played. Fixed:
- 1, 10, 11 (bridge): a bare "choose a card" says what it is for, from the ability's or card's own words: "Pair
  Deadeye Navigator with which creature?", "Tithing Blade: which creature is exiled for Craft?", "Anafenza: which
  creature gets the bolster counters?"; a required pick of the only card there is answers itself.
- 2 (bridge): "[Zone Changer: ...]" and "(Targeting: ...)" are left out of every question's words.
- 6 (bridge): the bounce-land note only for a land whose text returns a land.
- 7 (table): a row button of an exact pick answers at the click ("choose two" answers at the second).
- 9 (bridge): "Exile X?" after X's own ability whose cost exiles it is answered yes (as "Sacrifice X?").
- 12 (bridge): the colour of a source just tapped: "Tap X for which mana?" with {U} {R} {W}.
Deferred to the engine rebuild: 3 (send pairedWith), 4 (banding in the attack question), 5 (a title for Forge's
"which replacement applies first" question: it comes as a plain mode choice). Still to test, in a second game vs
`mtg aideck ai_bigboard`: Persist, Undying, Enrage, Modular's death trigger, Improvise paid by tapping artifacts.

## Game 2 (2026-10-27, vs `mtg aideck ai_handplay_rats`): the fixes re-tested live
- #1 PASS: "Pair Deadeye Navigator with which creature?" (Kenrith picked, Done; an "up to 1" pick keeps Done).
- #2 PASS in the questions, FAIL in the stack pop-up: its text still read "... you control [Zone Changer: Deadeye
  Navigator (1)]", and an upkeep trigger read "... you gain 1 life. [Phase: White]". Fixed (bridge): one helper,
  withoutForgeNotes, for every text the table gets (questions and the stack). Scenario "text: Forge's internal trigger
  text is left out of the stack" (fails on the old code by name). After the bridge restart: PASS (Anafenza's bolster
  trigger, no note).
- #6 PASS: Power Depot played, no bounce-land note.
- #7 PASS: "Power Depot: choose one" (Modular 1 | enters tapped): the row button answered at the click.
- #9 PASS: Tithing Blade's Craft: no "Exile Tithing Blade?" reached the player (answered by the bridge).
- #10 PASS: "Tithing Blade: which creature is exiled for Craft?"; Incubation Druid exiled, Consuming Sepulcher returned.
- #11 PASS: "Anafenza, Kin-Tree Spirit: which creature gets the bolster counters?" with two candidates (answered at the
  click); with one, "Anafenza, Kin-Tree Spirit: Lunarch Veteran 1/1 (the only choice)".
13. NEW: the stack pop-up for Consuming Sepulcher's upkeep trigger showed Relentless Rats' picture (cast by the AI a
    moment before) under Sepulcher's name. The attribute held the right link. Reproduced: TTS draws whichever picture
    download ends last, not the newest set (an uncached picture set 10 frames before a cached one replaced it). Fixed
    (table): engineSetImage sets the wanted picture again after 3 s and 8 s (the same link set again is drawn at
    once). Check "panel picture: a late earlier picture is replaced by the newest again" (fails on the old code).
    Patched live on the running table; deployed with the next push.
- Improvise PASS: Kappa Cannoneer cast from lands (a manual fix put five lands out, Kappa back in hand): the payment
  offered "Tap Consuming Sepulcher"; tapped (hover + E): {5}{U} -> {4}{U}, then "Undo mana from Consuming Sepulcher";
  Auto-pay finished it.
- Enrage PASS: the AI got two 4/4 flying Angel tokens (`mtg fix token ... for red`); Apex Altisaur (blinked through a
  new Deadeye pairing) fought one, took 4, Enrage asked again (Angel | Rats), fought the other, asked again (Rats).
- Persist PASS: Glen Elendra attacked, blocked by an Angel, died: back 1/1 with a -1/-1 counter ("returns to the
  battlefield from White's graveyard").
- Undying PASS: Gleeful Arsonist (haste from Kenrith {R}) blocked by Relentless Rats, died: back 2/3 with a +1/+1
  counter. Both triggers asked in one order question.
14. Kappa Cannoneer moved to the hand by a manual fix kept its "+2/+2" badge (and 6/6) there: Forge's fix move keeps
    the counters on the card until it is cast (cast again it entered fresh). Engine: a fix move off the battlefield
    should clear counters and damage. Deferred to the engine rebuild.
15. The Improvise taps read "Tap Consuming Sepulcher" / "Tap Power Depot" (Power Depot twice: its mana ability and its
    Improvise tap). Fixed (bridge): the protocol's useResource / releaseResource say what they pay: "Tap Consuming
    Sepulcher (Improvise: pays {1})", Convoke, Delve, Waterbend likewise.
16. Soulbond on another creature entering (Apex Altisaur blinked in) asked "Pair Deadeye Navigator with which
    creature?" with Deadeye itself the only choice. Fixed (bridge): Forge's "[Zone Changer: X]" names the creature that
    entered ("Deadeye Navigator: pair Apex Altisaur with which creature?"); without it the source isn't named as the
    one paired. Forge's ability text with that note is unverified live (re-test).
17. "Apex Altisaur: choose up to 1 target to fight": a click on an Angel token took the pick silently (its orange
    "picked" glow is hard to see on a card back) and my second click took it back, so the fight went to "(nothing)".
    Fixed (table): a target pick that waits for Done says "Chosen. Click it again to undo; click Done..." and "Taken
    back." (as card picks did).
18. The first two Angel tokens stayed card backs. Their picture is looked up after the first board; the next board left
    the (unchanged) battlefield out and sent only the picture, and the table reused its last battlefield list, so the
    token was never drawn again. Fixed (table): details sent again refresh the card in kept zones too.
19. The two Angels killed by fights left the log silent: a token leaving the battlefield (it ceases to exist) was
    skipped. Fixed (bridge): "Angel Token leaves the battlefield".
Each fix has a scenario or table check that fails on the old code by name. Deferred to the engine rebuild: 14.

## Re-test after the suite (2026-10-27, deployed: bridge restarted, table pushed)
- 16 PASS after one more fix: live, Forge's prompt carries no "[Zone Changer]" note; the trigger's stack item (still on
  the stack while it resolves) does. Read from there: "Deadeye Navigator: pair Apex Altisaur with which creature?".
  Scenario "named from the trigger on the stack" (a second stack item from another source names a wrong creature).
- 17 PASS: "Chosen. Click it again to undo; click Done when you're finished." on clicking the Spirit token to fight.
- 18 PASS: an uncached token kind (1/1 white Spirit) drew with its picture once the lookup finished.
- 19 PASS: "Spirit Token leaves the battlefield" after the fight.
- 15 PASS after one more fix: our Forge build sends Improvise's taps as mana abilities with no cost, no mana and no
  ability number, not the protocol's useResource. The kind comes from the spell's text (kept by id when sent: a spell
  being paid for is on the stack, which carries none): "Tap Consuming Sepulcher (Improvise: pays {1})", and Power
  Depot's Improvise tap told apart from "Tap Power Depot for {C}". Limit: right after a bridge restart a spell already
  being paid for has no text yet and its taps read "Tap X" (rare: cancel and cast again).
- 14 again: Kappa moved to the hand by a fix showed "5/5" and "Trample, Haste" there. Engine (deferred).
- 13: not re-provoked live (a race); the simulator checks pin both re-asserts.
hp-12 complete.
