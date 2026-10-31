# Hand test: 40-card mechanics deck, drag and drop only

Deck: `decks/test_mechanics_40.json` (Kenrith, the Returned King + 39 singletons, one mechanic each).
Opponent: one harmless Forge AI (`mtg aideck ai_passive_lands`: lands only, never attacks or casts).
Mana: `mtg mana 99` at the start of each of your turns — 99 of each colour (and colourless) until the end of that turn.

Rule for the test: every action is a drag, a drop, a click on a card or life counter, Q/E, or the big corner button.
The Engine panel stays closed. Anything that can only be done from the panel is a finding.

## Setup
1. Seat Blue. Put the deck on the library spot, Kenrith on the command zone. `mtg aideck ai_passive_lands`.
2. READY?, then Start (1 seat → 1 AI). Keep 7.
3. `mtg mana 99`. Check: the pool shows 99 of each. Repeat every turn (the mana empties at cleanup).

## Checklist (expected result in brackets)

### Lands
- [ ] Forest / Island: drag onto battlefield [land drop used; a second land is refused]
- [ ] Evolving Wilds: Q/E [sacrificed; library search panel; basic arrives tapped]
- [ ] Boseiju, Who Endures: drag from hand to graveyard area or right-click Channel [channel destroys an artifact/enchantment/nonbasic land; you search]
- [ ] Mosswort Bridge: play [hideaway: look at 4, one exiled face down under it]
- [ ] Bala Ged Recovery: drag [asked: cast the spell or play the land]

### Creatures and combat
- [ ] Monastery Swiftspear: cast, then cast an instant [prowess +1/+1 badge]; attack the same turn [haste]
- [ ] Gilded Goose: cast [Food token]; tap for mana by sacrificing Food
- [ ] Brazen Borrower: cast Petty Theft first [adventure: exiled, playable row]; later cast the creature from exile [flash, flying]
- [ ] Bonecrusher Giant: Stomp first, then the Giant from exile
- [ ] Brutal Cathar: cast [exiles an opponent creature until it leaves; half-size under it]; day/night flip [night side shows; card in hand never shows its back]
- [ ] Mulldrifter: drag and choose evoke [draws 2, then sacrificed]
- [ ] Shardless Agent: cast [cascade reveals until a cheaper nonland; cast it free]
- [ ] Gemrazer: cast for mutate onto a creature [stacked; asked over or under]
- [ ] Hidden Dragonslayer: cast face down [2/2 face down]; turn face up for its megamorph cost
- [ ] Ninja of the Deep Hours: attack with an unblocked creature, ninjutsu it in after blockers [swap]
- [ ] Tireless Tracker: land drop [Clue]; sacrifice a Clue [counter on Tracker]
- [ ] Phantasmal Image: cast [choose a creature to copy]; target it [sacrificed]
- [ ] Viscera Seer: sacrifice a creature [scry 1 with the TTS second hand]
- [ ] Tenacious Underdog: blitz from hand; later blitz from the graveyard
- [ ] Uro: cast from hand [sacrificed unless escaped]; escape from graveyard (exile five)
- [ ] Lunarch Veteran: let it die; disturb from the graveyard [back face, exiled if it would die]
- [ ] Combat: attack the AI with several creatures [one swing each]; check commander damage with Kenrith

### Artifacts, enchantments, planeswalkers
- [ ] Smuggler's Copter: crew it [tap creatures]; attack [loot]
- [ ] Bonesplitter: equip [attached half-size beside the creature; +2/+0]
- [ ] Rancor: aura on a creature; when it goes to the graveyard [back to hand]
- [ ] Banishing Light: exile an AI land [linked; returns when Banishing Light leaves]
- [ ] History of Benalia: chapters I, II, III over turns [Knight tokens; pump; sacrificed]
- [ ] Chandra, Torch of Defiance: each loyalty ability on separate turns [+1 exile and may cast; mana; -3 damage]
- [ ] Necromancy: cast in main phase [aura on the returned creature]; once in the draw step [warning: Cast anyway / Wait]

### Instants and sorceries
- [ ] Lightning Bolt: click the AI's life counter [3 damage]
- [ ] Fire // Ice: each half [split choice]
- [ ] Kolaghan's Command: two modes [mode choice]
- [ ] Ravenform: foretell, cast it later from foretold [private second hand zone]
- [ ] Thunderous Wrath: miracle if drawn first in a turn [miracle offer]
- [ ] Grapeshot: after two spells [storm copies]
- [ ] Faithless Looting: cast, then flashback from the graveyard
- [ ] Treasure Cruise: delve [graveyard cards exiled to pay]
- [ ] Teferi's Protection: cast [you and your permanents phase out]
- [ ] Chord of Calling: convoke with creatures, X = 2 [search a creature onto the battlefield]

### Commander
- [ ] Kenrith: cast from the command zone [tax 0]; each ability ({R}, {1}{G}, {2}{W}, {3}{U}, {4}{B})
- [ ] Kenrith dies [asked: command zone]; recast [tax +2]

### Table behaviour to watch throughout
- [ ] Cards stay on your mat; flicked cards slide back
- [ ] Five or more identical tokens stack; Split works in attacks
- [ ] Rewind (Undo...) keeps the draw order
- [ ] The log and the table log record each action

## Results — session 1 (2026-10-26, drag and drop through screen control, White vs AI at Red)

Worked as expected: land drop by drag; hideaway (look, pick, exile); casting creatures, artifact, Saga (chapters I-II
made Knights); Brazen Borrower offered only as a creature (no adventure target); Food token ability via its ability
box (+3 life); Crew via the box (pick the Knight, Done); Faithless Looting (draw 2, pick 2 discards by clicking hand
cards) and its flashback from the playable row (then exiled); disturb (Lunarch Veteran cast as Luminous Phantom from
the graveyard); blitz from the graveyard (paid 2 life, haste, attacked, sacrificed at the end step, drew a card);
trigger order question; Kenrith from the command zone (no tax; command-zone counter then shows 2); Kenrith's draw
ability via the box; Lightning Bolt at the AI's life counter (target line drawn); Kolaghan's Command (choose 2, two
targets); single attacker and "All attack"; foretell in the end step (only foretell offered).

Findings (to fix):
1. `mtg mana` during your own open priority waits for the NEXT priority question ("waiting for a moment with nothing
   on the stack") — nothing happens until you act.
2. That "waiting" box (with its Cancel bar) sits over the question panel: it covered the hideaway cards.
3. The `mtg mana` auto-apply window is 30 s; the pause came 41 s later and the mana was not added.
4. (suggestion) With mana floating, every cast still needs "Pay from mana pool" — Arena pays from the pool by itself.
5. Food token has no picture: a failed Scryfall lookup was remembered as "no picture" forever (cache token:Food).
7. The hidden-away card (Ninja) glows in the playable row though hideaway needs total power 10.
8. Ability boxes are tiny thin strips at normal camera distance — unreadable; they also sit on the next card.
9. (minor) Using Food asks "Sacrifice Food Token?" after paying, though the ability itself is the sacrifice.
10. The log says "White uses Lightning Bolt's ability" / "Faithless Looting's ability" for instants and sorceries
    (creatures log "casts").
11. The playable row sits at the bottom-right edge behind the big buttons; half off-screen at the default camera.
12. Cards in the playable row lie face down (backs) though they are face up in the engine (Lunarch, Looting).
13. Cards dropped near each other overlap instead of being laid out.
15. A permanent that just entered gets no ability box until the next question.
17. After your own spell/ability resolves in a main phase, the rest of that main phase is passed (Kolaghan's Command
    in main 1 -> straight to combat; Kenrith's draw in main 2 -> end step). Likely the board copy still shows the
    spell on the stack when the next priority question arrives.
18. A tapped permanent's ability box turns sideways with it.
19. (reported by the player) A card played by dragging stays where it was dropped (a land in the middle of the mat
    instead of the lower mana row): the drop spot is kept as a manual position (onObjectDrop sets engineManual). Keep it
    only while the spell is on the stack; on the battlefield the card goes to its row.
20. (requested by the player) A step banner in the style of the YOUR TURN / victory banners: Upkeep, Draw, Main 1,
    Combat, Main 2, End step. Shown only when the table actually stops to ask you something in that step; never while
    Auto-pass / auto-resolve is on and never when you get no priority (no spam).
21. No day/night indicator on the table: casting Brutal Cathar (daybound) made it day with nothing shown or logged.
22. (requested by the player) Banners in the middle of the screen ("RED'S TURN", "Red wins") should name the player
    sitting at that colour (their Steam name, as the chat box does) instead of the colour; AI seats keep their AI name.
(6 withdrawn: the Knight's picture arrived a few seconds late and was redrawn.)

Not yet reached: evoke, cascade, mutate, morph, ninjutsu, miracle, storm, convoke/Chord, delve, Uro escape,
Necromancy, Banishing Light link, equip, Rancor, Phantasmal Image, Viscera Seer scry, Teferi's Protection, split card,
Tracker landfall/Clue, planeswalker, daybound (Brutal Cathar), Mulldrifter, Kenrith dies -> command zone + tax.

## Results — session 2 (same game, turns 4-5)

Worked: `mtg mana 99` in one line when the next question comes soon; Saga chapter III and sacrifice; Brutal Cathar
cast; Bonesplitter cast + Equip via its box (after moving it clear of other cards) — equipment drawn half-size beside
the creature; Kenrith's draw repeated (in main 2 it stayed in main 2); Chord of Calling at instant speed (X = 5,
convoke offered, library look, pick Mulldrifter -> onto the battlefield -> its draw-2 trigger); cascade (Shardless Agent:
reveal Fire // Ice skipped, Grapeshot cast free) and storm (copy with its own target); morph (cast face down for {3},
log "White casts ?") and megamorph face up via the card's right-click menu (+1/+1 counter); Chandra +1 (exile Gemrazer,
"Cast Gemrazer?"); mutate (Gemrazer onto Mulldrifter, "which goes on top?"); adventure (Stomp, then the Giant from
exile); foretold Ravenform cast and Cancel (back to foretold); MDFC choice (Play Bala Ged Sanctuary / Cast Recovery /
Back); alternative-cost choice for blitz (Cast / Cast (Blitz) / Back).

More findings:
23. Dragging equipment onto a creature does nothing (Arena equips that way).
24. Dragging from the bottom hand strip often grabs nothing or the wrong card: hovering raises the hand and the cards
    move under the pointer. Press-hold on the raised card, then move, works.
25. Wrong pictures: Chord's X question showed Tenacious Underdog; the side panel titled "Chord of Calling" showed
    Kenrith; the stack panel titled "Chandra" showed Hidden Dragonslayer (the previous card) — which also revealed my
    face-down card.
26. Tireless Tracker's picture is blank (white) in the Chord library list.
27. PRIVACY: the game log (seen by everyone) lists searched/looked-at library cards: "White saw: Look at these cards
    (your library): Mulldrifter, Rancor, Uro, ..." — the whole library.
29. Fire // Ice (split card) has no picture: shows a card back in the cascade reveal.
30. After "Back" on the how-do-you-play-it question the card lay on the battlefield until the next redraw.
31. PRIVACY: after casting face down, the log says "Hidden Dragonslayer enters the battlefield (White)".
32. Turning a card face up (megamorph) and some activations (equip) are not logged; a cancelled cast is logged as
    "White uses Ravenform's ability".
33. Thin ability-box rows are hard to hit; the card's right-click menu was the reliable way (megamorph, Chandra).
34. TTS's Windows text-input helper (TextInputHost) kept taking focus after chat typing and blocked the screen-control
    tool; the window also blanked for a few seconds after it was closed (environment, not the table).

Still untested (need draws): miracle, ninjutsu (the Ninja is under Mosswort Bridge), Uro escape, delve, evoke,
Necromancy in main phase, Viscera Seer scry, Phantasmal Image, Teferi's Protection, Tracker landfall/Clue, Rancor,
Fire // Ice cast, Evolving Wilds, Boseiju channel (no legal target: the AI has only basics), Kenrith -> command zone.

## Results — session 3 (game 1 end + game 2) — DECK COMPLETE (2026-10-26)

Every card of the 40 was drawn and played (or tested where it can be). Newly confirmed working: Treasure Cruise
(delve offered; paid from pool), Rancor (aura choose-a-creature, attached half-size), Uro cast from hand (sacrificed,
gain 3 + draw + land from hand) and escape (exile five from a list, stays, triggers again), Viscera Seer (sacrifice
-> scry 1), Teferi's Protection (everything phases out, back on my next turn), Tireless Tracker landfall Clue and Clue
sacrifice (+1/+1 on Tracker), Evolving Wilds (Q on it), Necromancy in main phase (no warning; returned Mulldrifter;
with no graveyard creature it entered and did nothing, correctly), Uro attack trigger, game won by combat damage, New
game, evoke (both triggers ordered), ninjutsu by DRAGGING the Ninja in after blockers (pay, choose the unblocked
attacker, draw trigger), miracle (fix put Thunderous Wrath on top; "Use Thunderous Wrath?" -> "Cast it?"), Fire // Ice
split choice + divided damage, Monastery Swiftspear prowess, Phantasmal Image copy (Kenrith) + legend rule, storm copies
each re-targeted, Kenrith dies -> "Put back in the command zone?" -> recast for {6}{W} (tax 2; counter shows 4).

More findings:
35. Right-click menus open under the top bar (Settings / Auto / Log buttons cover the first items).
36. (withdrawn) "game aborted by the relay" at turn 10 was the game ending: the AI was at -23.
38. After a win nothing says so on screen: the attack lines stay, no banner, the New game tile is a tiny label under the
    life counters.
39. (withdrawn) life counter showed -23 correctly; the minus sign is tiny.
40. `mtg aideck` after a reset listed the deck twice ("ai_passive_lands, ai_passive_lands").
41. The log panel keeps the previous game's lines in the next game.
42. "End turn" pressed in my own main phase skipped the rest of that turn without asking (expected) — note only.
43. Pressing Esc on a card menu opens TTS's pause menu (TTS behaviour; menus close with a click on the table).
44. Evolving Wilds had a dead picture link in the spawned deck (old klrmngr id 6e01ec28..., 404); the bridge's cache
    has a working one. Spawned/imported decks need the same picture check the bridge does.
45. "Sacrifice Evolving Wilds?" showed Uro's picture (wrong picture, see #25).
46. Necromancy's half-size attachment looked like an aura on Mulldrifter (fine), but nothing says what it returned.
47. Fire (1-2 targets): after the first target the table asks again for the optional second one and Done does nothing
    — an optional extra target can't be skipped.
48. Discarding many cards (16 of 23 at cleanup) by clicking the hand strip is impractical; the panel's search worked.
49. The panel list scrolls very slowly (5 rows per 15 wheel clicks).
50. Legend rule: both Kenriths glow alike; nothing marks which is the copy.
52. A commander that went back to the command zone is still drawn at its old battlefield spot (glowing).
53. Hand-size discard prompts appear at cleanup with the step banner still saying END.
54. TextInputHost (Windows) grabbed focus after every chat command, and once the desktop shell did; minimize/restore of
    TTS brought focus back.

## Fix plan (2026-10-26)
#17 reclassified: not a bug — my own spell resolved by itself the moment it was paid and the big button became Next;
my "Resolve" click then passed the phase. Guard anyway: ignore the main button for 0.6 s after its meaning changes.
Fix order: privacy (27, 31) -> placement (19, 52, 13) -> playable row (12, 11) -> pictures (25, 45, 5, 44, 29) ->
fix/mana (1, 2, 3) -> optional target (47) -> banners (20, 22, 38, 53, 21) -> log (10, 32, 41) -> ability boxes
(8, 15, 18, 33) -> smaller (7, 9, 23, 30, 40, 48, 49, 50, 24, 4).

## Fix status (2026-10-26, end of the fix round)
Fixed, each with a check that was seen to fail when the fix is undone (bridge golden 292 scenarios, table claims):
- Privacy and log: 27 (a private look logs only "looked at N cards"), 31 (face-down cards and spells unnamed), 10 (an
  instant is "casts", not "uses ...'s ability"), 32 (face up and equip logged), 41 (a new game clears the log), 46
  (a returned card says "returns to the battlefield from X's graveyard" / "from exile").
- Placement: 19 (a dragged land goes to its row), 52 (a commander back in the command zone leaves the battlefield
  spot), 13 (drops are laid out), 30 ("Back" on how-do-you-play-it puts the card back in the hand at once).
- Playable row: 12 (face up). Pictures: 25, 45 (the right card's picture in the panel), 5 (a failed token lookup is
  not remembered), 44 (a dead deck link is passed over), 29 (split cards).
- Fix / mana: 1, 2, 3 (the fix pauses at once; the mana is added); 4 (floating mana pays your own spell by itself).
- 47 (an optional second target can be skipped with Done). 40 (`mtg aideck` replaces the list). 9 (no "Sacrifice
  Food?" after using Food). 7 (a hidden-away card doesn't glow).
- Banners: 20 (step banner), 22 (names instead of colours), 38 (VICTORY / X WINS), 53 (CLEANUP for the discard), 21
  (DAY / NIGHT on the bar and in the log).
- Ability boxes: 8, 15, 33 (real buttons, drawn as soon as the card is there, also after a reload; on the card itself,
  one short line each with the whole text as the tooltip: beside the card they covered the next card). 18 (tapped cards) is drawn
  sideways-corrected but not yet seen in TTS.
- 23 (drag equipment onto your creature to equip). 50 (a copy has a COPY label). #17's guard: the big button ignores
  a click for 0.6 s after a new question changed its words.
- 48: discarding most of a hand asks which cards to keep ("Keep 7 cards: the other 16 are discarded").
- 49: the panel scrolls three times as far per wheel click (not yet seen in TTS).

- 11 (player's choice A): the playable row lies on the near strip of the player's own mat, below the lands; a card
  put down where it lies isn't played.
- 35 (choice A): Engine / Graveyards / Log / Auto / Settings are a row above Auto-resolve / Fix / Undo at the bottom
  left; the right-click menus' first items are no longer under them.
- 24 (choice A): left as TTS's own behaviour; HOW-TO-PLAY says to drag from the hand zone on the table.

Not changed (outside the table):
- 34, 54: TextInputHost (Windows), 43: Esc opens TTS's menu.
