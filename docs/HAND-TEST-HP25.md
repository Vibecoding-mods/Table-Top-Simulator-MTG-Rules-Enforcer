# Hand test: hp-25 "Text changes" (40 cards)

Built 2026-10-27 at the user's request: Deadpool's text-box exchange and every kind of text change Forge has, with the
changed text to be shown on the card as a floating text box. First deck run with the faster workflow: most actions
driven through the table's own functions by tmp/act.js (the same intents a drag or click sends), real clicks once per
interaction kind; against `mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws.

## Deck (tmp/handplay/hp-25.json, kit "Test 25: Text changes")
Text changers: Deadpool, Trading Card (exchange text boxes as it enters), Exchange of Words (exchange while it stays),
Volrath's Shapeshifter (full text of the top creature card of your graveyard), Magical Hack (land type), Artificial
Evolution (creature type), Sleight of Mind (colour word), Crystal Spray (colour or land type until end of turn, draw),
Mind Bend, Spectral Shift (modal, entwine), Alter Reality (flashback), Glamerdye (retrace), Trait Doctoring (cipher),
Whim of Volrath (buyback, until end of turn), Balduvian Shaman. Targets: Bog Wraith, Black Knight, White Knight, Goblin
King, Lord of Atlantis, Elvish Archdruid, Karma, Circle of Protection: Red, Kird Ape, Serra Angel, Llanowar Elves.

## What Forge sends after a text change (read live with GET /card)
- A card's `text` is always the printed text: Bog Wraith still "Swampwalk ... a Swamp" after Mind Bend (Swamp ->
  Island); Lord of Atlantis, Goblin King, Kird Ape, Karma, Circle of Protection, Deadpool, Serra Angel the same.
- Its keywords follow the change: "Landwalk:Island", "Protection from red"; Exchange of Words moved Flying and
  Vigilance to Llanowar Elves; Goblin King's subtype became "Elf" (Artificial Evolution changes its type line too).
- Its abilities follow the change, and Forge marks the change in their descriptions with HTML: "The next time a
  <strike>red</strike> black source of your choice ..." (Circle of Protection after Alter Reality).
- The rules follow the change: Kird Ape 2/3 with an Island after Forest -> Island; Llanowar Elves 3/3 with
  mountainwalk from Goblin King's "Elves"; Serra Angel tapping for {G} after Exchange of Words; Goblin King using
  Deadpool's "{3}, Sacrifice: each other player draws"; the exchange ended when Exchange of Words left.

## Results (numbered findings)
Worked: every changer resolved; flashback (Alter Reality), retrace (Glamerdye, discarding a land), buyback (Whim of
Volrath back to hand), cipher (encoded on Serra Angel, its combat damage cast a free copy), entwine offered, Crystal
Spray's draw, Deadpool's exchange, Exchange of Words ending when it left, Volrath's Shapeshifter becoming the top
creature card (Goblin King) and back.
- T0 (the feature): the changed text never reaches the table: the card's text is printed text. Needs the engine to
  send the current text (Forge has it: the ability descriptions carry it), then a floating text box on the card.
- T1. Mind Bend / Crystal Spray / Trait Doctoring / Whim: "choose one: Change color | Change type": say "a colour
  word" / "a basic land type".
- T2/T3. The two word questions read the same ("choose a basic land" twice, "choose a color" twice): say which is the
  word replaced and which the new one. The first (5 land types) opened the Engine panel with checkboxes and Done (5 >
  the row's 4 buttons), the second (4) row buttons.
- T4. Artificial Evolution's creature type: ~350 types A-Z (the panel has search); the type in the target's text
  (Goblin) should come first.
- T5. The stack pop-up: "Change the text of Goblin King (37) by replacing ...": Forge's card number leaks.
- T6. Optional costs read "choose any you want: Entwine – {2}" / "Retrace – Discard a land card" / "Buyback – {2}":
  say what it is ("Pay Entwine {2} (both modes)?"); from the graveyard, retrace is not optional.
- T7. Raw HTML in labels: "<strike>red</strike> black" in the priority options (and the log).
- T8. Retrace's discard: "Glamerdye: choose a card from your hand": say it is the land discarded for retrace.
- T9. Cipher: "Trait Doctoring: choose a card": "encode it on which creature?".
- T10. The encoded card is in exile with nothing linking it to Serra Angel (no field from Forge): engine.
- T11. "Use Deadpool, Trading Card?": say what (exchange text boxes with another creature?).
- T12. "Deadpool, Trading Card: choose up to 1 card": Forge's own ChoiceTitle ("Choose a creature to exchange text
  boxes with") didn't come through.
- T13. Volrath's Shapeshifter as Goblin King shows as a plain Goblin King (name, picture): nothing says it is the
  Shapeshifter; Forge sends no original identity: engine.
- T14. "Tap Elvish Archdruid for 2{G}" (Arena: {G}{G}).
- T15. Crystal Spray and Whim of Volrath ("until end of turn"): Black Knight still "Protection from blue" and Bog
  Wraith still "Landwalk:Forest" next turn. Forge's revert (ChangeTextEffect: removeChangedText...) recomputes the
  text but doesn't refresh the card's view as the change did (updateStateForView): engine, to confirm.
- T16. Balduvian Shaman's ability was never offered (no legal target per Forge) after Glamerdye changed its "white" to
  "black" (Karma, a black enchantment without cumulative upkeep, should qualify; Circle of Protection: Red is still a
  white card). Forge rules: deferred.
- T17. Cipher's trigger: "Use Serra Angel?": say it casts a copy of the encoded Trait Doctoring.
- T18. "Look only: the engine moves cards out of the graveyard ..." after a manual fix moved Exchange of Words into the
  graveyard (by script here: to check with a real drag).
- Driver note (not a table bug): tmp/act.js's label match picked Circle of Protection's ability for "Next" ("The next
  time ..."); exact labels first now.

## Fixed (2026-10-27)
- T0 (the feature): the engine sends a card's current text when a text effect changed it (`currentText`: Forge's own
  Card.getAbilityText(), only when the card has changed colour/type words or traits changed "by text": Mind Bend and
  its kind, Exchange of Words, Deadpool, Volrath's Shapeshifter), its printed name when a text effect renamed it
  (`printedName`), and the creature a cipher card is encoded on (`encodedOn`). Protocol CardDto + harness
  (InteractiveSnapshotExtractor); images mtg-forge-node:text / mtg-relay:text (rollback :text-prev).
  Bridge: `ct` (Forge's "<strike>Swamp</strike> Island" as "Island (was Swamp)", grey tags left out), `pn`, and the
  cipher card as a linked exile of its creature (`ew` + `enc`). Granted-keyword badges are judged against the changed
  text (Mind Bend's islandwalk is its own text, not a grant).
  Table: a text box over the card's own text box with the changed text (wrapped to 28 characters, 6 lines at most, the
  whole text in its tooltip); the hover text reads "Text changed:" and "<printed name>, as <new name>".
- T1: "Mind Bend: change which kind of word?" - "A colour word" / "A basic land type".
- T2/T3: "Sleight of Mind: replace which colour word?", then "replace Black with which colour word?" (and basic land
  types, creature types).
- T4: the target's own words first (Goblin first among the creature types).
- T5: the stack text without Forge's card numbers ("Goblin King (37)") or its "Ponder (18) - " prefix.
- T6: "Spectral Shift: pay Entwine ({2})?" with "Pay Entwine: {2}" (Retrace, Buyback, Kicker alike).
- T7: "<strike>red</strike> green" in labels and the abilities' button text: "green (was red)".
- T8: "Glamerdye: discard which land card (Retrace)?". T9: "Trait Doctoring: encode it on which creature?".
- T11/T17: "Use X?" says the ability's own "may ...": "Deadpool, Trading Card: exchange his text box and another
  creature's?", "Serra Angel: cast a copy of the encoded card without paying its mana cost?".
- T12: "Deadpool, Trading Card: exchange text boxes with which creature?".
- T14: "Tap Elvish Archdruid for {G}{G}".
Deferred: T15 (Forge: an "until end of turn" text change's revert isn't refreshed in the card's view; to check with
current text live), T16 (Forge rules: Balduvian Shaman after its own text change), T18 (verify with a real drag).

## Live re-test after deploying (2026-10-27, new images and table)
- T0 PASS: Bog Wraith after Mind Bend shows a cream text box over its own text box: "Islandwalk (This creature is
  unblockable as long as defending player controls an Island.)" (type line and 3/3 still visible; tuned twice:
  covered the P/T and clipped the edges at first). Exchange of Words: Serra Angel "{T}: Add {G}.", Llanowar Elves
  "Flying, vigilance". Sleight of Mind: White Knight "First strike, protection from red". Artificial Evolution:
  Goblin King "Other Elf (was Goblin) creatures get +1/+1 and have mountainwalk." Volrath's Shapeshifter as
  "Deadpool, Trading Card" with "[Volrath's Shapeshifter]" kept and Volrath's own "{2}: Discard a card".
- T1 PASS "Mind Bend: change which kind of word?". T2/T3 PASS "replace which basic land type?" (Swamp first) then
  "replace Swamp with which basic land type?"; colours the same. T4 PASS (Goblin first) after one more fix: "Mount"
  matched inside "mountainwalk" (whole words now, or with "s"/"walk") and the rest is A-Z (colours W U B R G).
- T6 PASS "Glamerdye: pay Retrace (Discard a land card)?". T8 PASS after one more fix: live, Forge's ability text has
  no "Retrace" (it is in the card's text) and the question's description is "Choose cards to discard".
- T11/T12 PASS after one more fix: live, Forge's question is "Apply replacement effect of Deadpool, Trading Card?\r\n
  <its text>" with no ability text: the "may ..." is read from the title's second line. "Deadpool, Trading Card:
  exchange his text box and another creature's?" then "exchange text boxes with which creature?".
- T15 confirmed in the rules, not the view: after Crystal Spray (until end of turn), White Knight still has protection
  from blue on the next turn and Forge's freshly built text says so too. Forge rules: deferred.
- Not re-tested live: T9/T17 (no cipher card left in hand; the scenarios use Forge's script texts), T13's table
  display beyond the hover text, T14 (Archdruid summoning sick). T5 seen on the stack pop-ups.
- Test-driver bug found and fixed (not the table): tmp/act.js picked options with a table key (a MoonSharp quirk: a
  local of a loop body held a table after two inner loops), so "pick, then Done" sent "(nothing)" twice (Deadpool's
  exchange, Retrace).
- Remaining work: Forge repeats a replacement's line in Card.getAbilityText ("As Deadpool enters ..." twice in the
  Shapeshifter's box): repeated lines to be dropped in the bridge.
