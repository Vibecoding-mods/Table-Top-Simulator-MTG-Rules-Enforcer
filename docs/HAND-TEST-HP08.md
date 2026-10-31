# Hand test: hp-08 "Keywords 6" (40 cards)

Played 2026-10-28 on the live table (seat White, kit "Test 08: Keywords 6" spawned alone), against
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws. Faster workflow: most actions through the table's own
functions (tmp/act.js, the same intents a drag or click sends), a real drag for a land; the question panel sat under
another app's window, so answers went through the table's functions too. The game ended on turn 4: Nashi's trigger
exiled the last library card and the next draw lost (the table said so).

## Worked
- Warp (Exalted Sunborn): "how do you play it?" offered Cast / Cast (Warp); exiled at the end step, then shown in the
  playable row with the green outline.
- Evoke (Mulldrifter): drew 2, then sacrificed.
- Venture (Acererak): back to hand each time, Lost Mine of Phandelver in the command zone, Cave Entrance's scry, then
  Goblin Lair's token (two: Exalted Sunborn doubles tokens, correct).
- Monstrosity (Giggling Skitterspike): five +1/+1 counters, 6/6.
- Day/night (Outland Liberator): DAY on the turn bar when it entered; NIGHT after the AI's turn with no spell, and it
  turned into Frenzied Trapbreaker (Tovolar too).
- Cascade x4 (Apex Devastator): revealed Forest, Tovolar; "Cast Tovolar, Dire Overlord?"; the other three found nothing.
- Power-up (Human Torch): three +1/+1 counters.
- Exalted (Ignoble Hierarch): Jade Avenger attacking alone 3/3.
- Ninjutsu (Nashi): offered after no blocks, Jade Avenger back to hand, Nashi tapped and attacking, 3 damage, its
  trigger exiled the top card of each library into White's playable row.
- Fatehold Charm's modes; empty-library loss; manual Fix opened and cancelled.

## Not tested here
- Aven Interrupter plots a target spell as it enters (it has no Plot of its own): cast with nothing on the stack.
- Flusterstorm's storm (no instant or sorcery to target), Boseiju's channel (no nonbasic target), Bushido (no block),
  recasting the warped Sunborn from exile (the game ended first; the headless sweep cast it).

## Findings
1. The dungeon choice read "Acererak the Archlich: Name a card" (Dungeon of the Mad Mage | Lost Mine | Tomb).
2. The dungeon card's zoom window showed a card back, not the dungeon.
3. The room text ended in Forge's note "[Room: Cave Entrance]".
4. Cave Entrance's scry card, laid out by the table beside White's hand, set off the wrong-hand guard: "Cards can't go
   into another player's hand: it went back." Nobody moved it, and it was White's own hand.
5. Trigger order buttons carried Forge's "[Zone Changer: Mull…" and were cut mid-word ("If you do").
6. (withdrawn: Aven Interrupter has no Plot of its own)
7. The stack item's zoom text: "Cascade - Apex Devastator [Card: Apex Devastator, Activator: White, SpellAbility: Apex
   Devastator - Creature 10 / 10]".
8. Ninjutsu's cost read "Nashi, Moon Sage's Scion: choose a card"; it returns an unblocked attacker to hand.
9. The next room read "Acererak the Archlich: choose one" (Goblin Lair — ... | Mine Tunnels — ...).
10. (re-test) With an empty library, Cave Entrance's "Scry 1" asked "Scry 0" with nothing to choose.

## Re-test (2026-10-28, after the fixes, a new game and Undo)
Fixed and seen on the table: 1 ("venture into which dungeon?"), 2 (the dungeon's picture), 3 and 7 (no Room/Card
notes: "Cascade - Apex Devastator"), 5 (clean buttons cut at a word), 8 ("return which unblocked attacker to your
hand?"), 9 ("Lost Mine of Phandelver: which room next?"). 10 answers itself now (scenario "scry 0: nothing to look at
answers itself"). Undo went back to turn 2 with a full library. 4 is fixed in the table script but not seen again:
Nashi emptied the library before another scry. TTS crashed twice (NVIDIA driver resets, nvlddmkm 153).

Question for the player: your own spell in your main phase resolves by itself (as Arena), so a response to your own
spell (Flusterstorm on your own Fatehold Charm) has no way in. Arena has a hold-priority key for that.

Suite (2026-10-29, docs/reviews/suite-hp08-23-24-26-2026-10-29.md): mutation pass tmp/mut37.js 9/9 (Time Wipe's "to your
hand" added); two table checks for #4's guard.

## Gap fill (2026-10-29): every keyword played
Kit "Gap 08" (tmp/handplay/gap-08.json). Game 1 against ai_gap_spells (it casts cantrips and bounce), game 2 against
ai_gap_creatures. Your own spell in your main phase still resolves by itself (no hold-priority), so Storm and Plot were
played on the AI's spells, with lands left untapped for its turn (`mtg mana` waits for an empty stack).

Played:
- Warp: "Cast Exalted Sunborn — warp", exiled at the end step ("Exalted Sunborn is exiled"), then cast from exile on a
  later turn: it entered.
- Storm: on the AI's Chart a Course, Brainstorm and Vampiric Tutor first, then Flusterstorm: three copies, each a new
  target question; the AI paid for them, so Chart a Course resolved.
- Plot: Aven Interrupter flashed in on the AI's Preordain: exiled and plotted (Forge's isPlotted).
- Channel: Boseiju's "{1}{G}, Discard Boseiju" on the AI's Temple Garden: destroyed, the AI fetched Badlands.
- Bushido: Jade Avenger blocked Typhoid Rats (deathtouch): both died; the bushido trigger resolved between two boards.

Findings and fixes (bridge/bridge.js):
1. Mana Confluence tapped while paying (for Vampiric Tutor's {B}) still asked "Mana Confluence: pay 1 life?": the
   "paying is part of tapping it" note was only taken for priority actions. Fixed for payments too.
2. Three identical storm copies asked "Your triggers: click the one that happens first" over "Flusterstorm (145) -
   Counter Chart a Course (61) unless...". Fixed: items all the same but Forge's object numbers are kept without asking;
   the numbers are left out of what is shown.
3. A copy's new target read "Choose a target to counter" (Forge sends no card), its candidates "engine-card-146" (a copy
   is a card in no zone). Fixed: "Copy of Flusterstorm: choose a target to counter", the candidates by their stack item,
   "Flusterstorm (your spell)".
4. The copies read "White casts Flusterstorm" three times (each storm copy is its own card). Fixed: a second spell of the
   same player and name with no cast record is a copy, "White copies Flusterstorm"; the player's own second cast stays
   "casts".
5. "Chart a Course is countered" though the AI paid for Flusterstorm's copies and it resolved. Fixed: a counterspell
   with "unless" doesn't count as a sure counter (isCounterspell).
6. The AI's Chart a Course (draw two, discard one) read "AI 1 draws a card" and "AI 1 mills Island". Fixed: after a
   player's spell or ability that says discard resolves, their card into the graveyard is a discard and their draw counts
   it: "AI 1 draws 2 cards", "AI 1 discards Island".
7. The AI's Sleight of Hand, resolved between two boards, read "AI 1 mills Sleight of Hand". Fixed: an AI's own instant
   or sorcery on its own turn, one card from its library, is neither claimed: "Sleight of Hand is put into AI 1's
   graveyard"; a real mill of more cards still reads "mills".
8. Aven Interrupter's exile read "Preordain is exiled". Fixed: "Preordain is exiled and plotted: AI 1 may cast it
   without paying its mana cost on a later turn, as a sorcery".
Mutation pass tmp/mut41.js: 16/18, then 18/18 (a player's second same-named cast, and an original and its copy in one
board, as inputs).

Open (a decision for the player): your own spell in your main phase resolves by itself, so a response to it (Flusterstorm
on your own Bolt, Aven Interrupter on your own Ponder) has no way in. Arena has a hold-priority key; adding one is a table
change.
Not seen in the log: Bushido's trigger (it resolved between two boards; Forge applied it).
