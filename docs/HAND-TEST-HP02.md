# Hand test: hp-02 "Mechanics 2" (40 cards)

Played 2026-10-28, seat White (kit "Test 02: Mechanics 2" by tmp/kit-02-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`. TTS crashed twice during the deck (NVIDIA resets 16:11:22 idle and
17:17:17, both at ~81.5k objects): relaunched and the save loaded by hand each time; the game came back by itself on
TTS's "game loaded" (the hp-06 fix, seen live). While the user worked in other windows, actions went through the
table's functions (tmp/act.js) instead of the mouse.

Covers: Demonic Tutor, Cultivate, Faithless Looting, Brainstorm, Ponder, Raise the Alarm, Hardened Scales, Valakut
Awakening // Valakut Stoneforge, Bonecrusher Giant, Bonesplitter, Rancor, Sakura-Tribe Elder, Raise Dead, Think Twice,
Wrath of God.

## Worked
- Think Twice (dragged by hand), then its Flashback by dragging it from the playable row: drew, then exiled.
- Bonecrusher Giant: "how do you play it?" Cast Bonecrusher Giant | Cast Stomp; Stomp at the AI (2), the Giant in exile
  and in the playable row, then cast from there.
- Valakut Awakening // Valakut Stoneforge: "how do you play it?" Play Valakut Stoneforge | Cast Valakut Awakening; the
  land enters tapped (its own text).
- Demonic Tutor's search; Cultivate's search, then "Cultivate: put which card onto the battlefield?" (Forest tapped,
  Mountain to the hand).

- Sakura-Tribe Elder's sacrifice: the search asked at once (no library OK first: fix 5 live), an Island tapped in.
- Ponder: the top three in order (Keep this order), "Ponder: shuffle your library?" No, drew Rancor.
- Hardened Scales: Kenrith's {1}{G} counter on the Giant made two ("Bonecrusher Giant gets 2 +1/+1 counters": the
  hp-06 #11 line live). Bonecrusher Giant targeted by Rancor: 2 damage to me. Rancor attached.
- Wrath of God: the Giant and Kenrith died, Kenrith back to the command zone (asked), Rancor back to the hand.
- Raise Dead: "return which creature card to your hand?" (the Giant). Faithless Looting: drew 2, discarded 2, then its
  Flashback from the playable row (exiled after). Brainstorm (fix 8 live). Raise the Alarm: two Soldier tokens.
  Bonesplitter: equipped to a Soldier.
All 15 covered. TTS crashed a third time in the deck (17:33:14, ~81.6k objects); the game came back after the reload.

## Findings and fixes (bridge/bridge.js)
1. (log) Stomp's card read "Bonecrusher Giant is exiled". Fixed: "Bonecrusher Giant goes on an adventure (Stomp)".
2. (none: Valakut Stoneforge enters tapped by its own text.)
3. (log) The Giant cast from exile read "returns to the battlefield from exile". Fixed: "enters the battlefield".
4. Regression from hp-01 #3: Demonic Tutor's look read "no card, put that card in your library" (the kind pattern took
   "card, put that"). Fixed: a kind is words without a comma or "card"; "a card" is any card.
5. A search showed the whole library first as "look at these cards" with an OK. Fixed: a look at your own library
   before a search with something to find answers itself (marked as a search); a search that found nothing still
   shows what it saw.
6. Privacy: Cultivate's look at the whole library was logged to the table card by card as "revealed" (its "reveal those
   cards" is for the lands found). Fixed: a search's look is never a reveal. Scenario "hp-02: Cultivate's library look
   is no reveal" (no log line).
7. Cultivate's second question repeated "search your library for which basic land cards?". Fixed: Forge's step in its
   description ("Select a card to put onto the battlefield") wins: "Cultivate: put which card onto the battlefield?".
   Seen live.
8. Brainstorm asked "choose 2 cards from your hand". Fixed: the purpose rule takes a count ("put two cards ... on top of
   your library"): "Brainstorm: put which cards on top of your library? (choose 2)". Seen live.
9. (log, open) Cards returned from the graveyard to the hand (Rancor after Wrath, the Giant by Raise Dead) have no line;
   equipping reads "uses Bonesplitter's ability" (as hp-01 #1).
Tests: 507 bridge scenarios; all four suites pass.

## /jr-programmer-suite after hp-02 (covers hp-22 re-test, hp-06, hp-01, hp-02)
Two reviewers read the scoped code (structure/simplify; correctness/claims), findings applied:
- "is countered" went by NAME on the last stack (a same-named card milled, an evoked creature, a legend-rule loser read
  "countered"): now a spell card another stack item TARGETED (the snapshot keeps each item's stack ids and spell targets).
- Connive/loot read as mills: a card its owner just chose to discard is a discard though the hand stayed level, capped
  at what could have left the hand (its drop plus what left the library); the rest is a mill or "put into".
- The search kind said "no ... in your library" for "a green creature card", "a nonland card", "a historic card": only
  known words now (types, supertypes, capitalised subtypes/names); "up to two ... cards" read; "a basic land card or a
  Gate card" is no single kind.
- The library look was answered unasked when nothing was understood (nothing showed at all): only when the search was
  understood and has something to find.
- A split card's half or a face-down spell exiled read "goes on an adventure": excluded.
- An AI's land play plus an effect's land between two boards read as two plays: no more plays than the count rose.
- Stack names said "ability" for an instant (Forge gives instants text): the log's own isAbilityOnStack now.
- "Cast it" checked the owner, not the caster (Etali/Villainous Wealth casts asked "Pay from mana pool" again): dropped.
- Structure: revealCards works out whose library once and decides the search mark in one place; the note goes through
  displayText/plainWords like the text; the unused realName dropped; a repeat hello with no game is ignored (it logged
  and rescheduled every seat's view); the table's scry/surveil guard uses engineScryOpen's prompt.
Claims: 7 false comments (countered, mill, kind, auto-acknowledge, adventure, "only your own card's", stackName) — the
CODE was wrong each time and was fixed. Untestable/untested: "card text has no such brackets" (no card corpus here);
the Lua changes (askAgain, the guard, the hints) have no table test and rest on live checks.
Tests: 515 scenarios (8 new). Mutation pass tmp/mut13.js: 16/17 caught; the escape (the note not passed through
displayText) is equivalent today: every note is bridge words plus a card name, which carry no relay usernames or Forge
notes. Not fixed (low): a note two brackets deep leaves a stray "]".
