# Hand test: hp-26 "Library-style effects" (40 cards)

Played 2026-10-29, seat White (kit "Test 26: Library-style effects" by tmp/kit-26-direct.lua), against `mtg start 1`
with `mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Same TTS session as hp-23 at first; TTS froze once in the upkeep of White's third turn (not responding, 133 MB): killed,
bridge restarted with every fix up to the trigger wording, ENGINE MODE reloaded, and the game carried on from the same
question (Mirri's Guile's order).

Covers: Ponder, Faithless Looting, Mystical Tutor, Scroll Rack, Sensei's Divining Top, Abundance, Worldly Tutor,
Brainstorm, Frantic Search, Enlightened Tutor, Mirri's Guile, Mystic Remora, Dark Confidant, Phyrexian Arena, Sylvan
Library, Preordain, Demonic Tutor, Vampiric Tutor.

## Worked
- Ponder: "click the card to put on top", then "Ponder: shuffle your library?".
- Faithless Looting: draw 2, discard 2 ("White discards ...").
- Frantic Search: "discard 2 cards" (the table's Arena wording, already pinned), "White discards Swamp, Swamp".
- Enlightened Tutor, Demonic Tutor ("puts a card from their library into their hand"): the search by the card's kind.
- Mirri's Guile: "look at the top three cards ... ?", then the order, top card first.
- Dark Confidant: "Dark Confidant: revealed (your library)", the card by name in the log, the life loss.
- Mystic Remora: its cumulative upkeep said ("pay {1} for each age counter on it, or it is sacrificed"); with no mana in
  the upkeep (`mtg mana` gives the main phase's) Forge sacrificed it without asking, as the rules have it.
- Phyrexian Arena: the draw and the life.
- Preordain: the scry the table's way, then the draw.
- Live after the restart: Abundance's question and reveal (fixes 3 and 4), Vampiric Tutor's put-on-top (fix 5), the
  trigger wording (fix 7).

## Findings and fixes (bridge/bridge.js)
1. Scroll Rack's cards read "Scroll Rack: choose cards". Fixed: "exile which cards face down?".
2. Sensei's Divining Top's draw read "Sensei's Divining Top returns to White's hand" and no draw. Fixed by its record
   ("is put on top of White's library", the draw counted); re-test 13 below.
3. Abundance's land or nonland read "Kenrith, the Returned King: Abundance" (Forge asks it under the drawing card).
   Fixed: "Abundance: reveal until a land or a nonland card?" with what happens to the revealed cards under it.
4. Abundance's reveal read "Kenrith, the Returned King: look at these cards (your library)" and the log "White looked
   at a card", though Abundance reveals. Fixed: "Abundance: revealed until a nonland card (your library)", the cards
   named in the log, the card into the hand "puts ... into their hand", not "draws".
5. Mystical Tutor's and Worldly Tutor's pick left nothing in the log (no card reaches the hand and the library keeps its
   count). Fixed: "White reveals Dark Confidant, shuffles and puts it on top of their library"; Vampiric Tutor (no
   reveal): "shuffles and puts a card on top". Worldly Tutor's live text says "the card", not "that card".
6. Brainstorm's two cards back on top were not said. Fixed: "White puts 2 cards from their hand on top of their
   library".
7. Triggers read like activations: "White uses Dark Confidant's ability". Fixed: "Dark Confidant's ability triggers
   (White)" for a stack item that starts When / Whenever / At and that the player did not start; four older scenarios
   changed wording, each a real trigger; an activation stays "uses".
8. Scries were never logged (Preordain). Fixed: "White scries 2: a card on the bottom" / "all on top" (how many, not
   which; surveil's cards are seen going to the graveyard already). (A scry's title keeps its own "Scry 2:" heading
   with no card name: the 2026-10-22 wording review's rule, left as it is.)
9. Sylvan Library asked twice: "draw two additional cards?", then Forge's own "Draw two Cards". Fixed: after Yes to a
   trigger's "you may ...", the same card's next yes/no whose words are all in it is answered yes.
10. Sylvan Library's card put back on top was not said. Fixed: "White puts a card from their hand on top of their
    library" (picked or dragged).
11. Re-test of 2 on the restarted bridge: still "returns to White's hand". The record is dropped when its "uses ...'s
    ability" line is said, while the ability is on the stack; it resolves a snapshot later. Fixed: also by the
    ability's stack item in the snapshot before (its text says "on top of its owner's library", gone now). The old
    scenario fed both in one snapshot; two more feed them apart, and another of Top's abilities on the stack still
    reads "returns to hand".
12. (mutation pass) The stack item in 11 is known gone by its stack ids, not its key: a Top bounced with its draw still
    on the stack has its key changed (its source hidden, the item reads as a spell), and read "is put on top".
Also: `gameLogLine(line)` for the four places that pushed a line to the game log and the table.

Open: an ability still on the stack whose source went to a hidden zone (a bounced Top) reads "Blue casts Sensei's
Divining Top": isAbilityOnStack tells a spell by its card being in no zone, as a bounced source is. Rare; pinned as it
is in "log: Sensei's Divining Top (bounced, its ability still on the stack)".
Not tested: Mystic Remora's draw (it was sacrificed, and the AI cast no noncreature spell).
Not seen live (added after the restart; the bridge isn't restarted mid-game at this object count): 8, 10, 11, 12.
Tests: 652 bridge scenarios (with the suite run's). Mutation pass tmp/mut35.js: 19/25, then 25/25 after six
inputs (one, a bounced Top, changed the code: fix 12). Suite: docs/reviews/suite-hp08-23-24-26-2026-10-29.md.

## Gap fill (2026-10-30)
Kit "Gap 26" (tmp/handplay/gap-26.json) against ai_gap_spells, on a fresh bridge. Kenrith's draw fed the AI cards.

Played:
- Mystic Remora's draw: the Remora out from turn one, cumulative upkeep paid from lands ({1}, then {2} asked). The AI
  cast Consider with two lands, could not pay {4}: "Mystic Remora's ability triggers (White)", "Mystic Remora: draw a
  card?", Yes, "White draws a card" (library 30 to 29).

No fixes needed. Open: the AI's Deep Analysis discarded at cleanup reads "is put into AI 1's graveyard" (an AI's instant or
sorcery leaving its hand between boards is not called a discard, as it may have been cast). The AI paying {4} was not
seen: it never had the mana.

Tests: 849 bridge scenarios, no new ones. No bridge change, so no mutation pass.
