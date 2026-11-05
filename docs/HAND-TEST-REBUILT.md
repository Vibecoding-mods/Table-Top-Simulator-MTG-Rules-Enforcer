# Hand test: the decks rebuilt from the 2026-11-03 logs

The user's last real games (2026-11-03, 15:14 to 16:00) were White's Mairsil, the Pretender against Blue's Darien, then
Zurgo, then Niv-Mizzet, Visionary. No deck list was saved (imported on the table; container logs reset since), so each
deck is rebuilt from what `tmp/table-log.log` showed of it: cards drawn, played, offered as Play/Cast, or listed by the
player's own library, hand or graveyard questions. Filled to 40 with basics for a hand test.

- `decks/rebuilt_mairsil.json`: Mairsil + 31 cards seen in three games (log lines 106498 to 107670, White).
- `decks/rebuilt_niv.json`: Niv-Mizzet + 25 cards seen in one game (lines 106913 to 107670, Blue).
- Rebuilt by `scratchpad/decks-from-log.js` + `make-rebuilt-decks.js` (session scratchpad).

Set-up: White plays `mtg deck rebuilt_mairsil`, the AI `mtg aideck rebuilt_niv`; `mtg mana 99` each turn; play every
card, drag and drop only (see the hand-test workflow). Bugs are numbered below as found, fixed after the deck is done.

## What to check, per card

Mairsil (White, played by hand):

| Card | Mechanic | The log should say |
|---|---|---|
| Mairsil, the Pretender | ETB: exile an artifact/creature from hand or graveyard with a cage counter; has the activated abilities of caged cards | the exile and the cage counter; Mairsil using a caged card's ability by its name |
| Buried Alive | search: up to three creatures to the graveyard | which cards went to the graveyard (public) |
| Helm of the Host | equipped: token copy each combat, not legendary, haste | "creates" the copy |
| Spark Double, Clone | enters as a copy (Spark Double: +1/+1 counter or loyalty, not legendary) | enters as a copy of X |
| Saw in Half | destroy, two half-size token copies | dies, creates 2 tokens |
| Fable of the Mirror-Breaker | Saga: Goblin Shaman token, rummage, transforms into Reflection of Kiki-Jiki | chapters, the transform |
| Bloodline Keeper | tap: 2/2 Vampire; transforms with five vampires | creates; transforms |
| Exchange of Words | swaps text boxes | the swap |
| Stitch in Time | coin flips until lost, extra turns | flips, extra turn |
| Flare of Duplication | alt cost: sacrifice a nontoken red creature; copy target instant/sorcery | "(alternative cost)" / the sacrifice, copies |
| Ancient Copper Dragon | combat damage: roll d20, that many Treasures | the roll, creates N Treasures |
| Wyll, Blade of Frontiers | rolls one more die and ignores the lower | the rolls |
| Zndrsplt, Eye of Wisdom | coin flips: draw when won | flips, draws |
| Royal Assassin | tap: destroy target tapped creature | destroyed |
| Rhystic Study, Phyrexian Arena | taxes / upkeep draw and life loss | pays or draws; life |
| Arcane Denial, Chaos Warp, Blasphemous Act | counter (+ draws), shuffle-in and reveal, board wipe at reduced cost | countered; shuffled; each dies |
| Brainstorm, Ponder | cards put back on top | "puts 2 cards on top" |
| Temple of Deceit, lands | scry on ETB | the scry count |

Niv-Mizzet (AI 1, read from its log lines):

| Card | Mechanic | The log should say |
|---|---|---|
| Niv-Mizzet, Visionary | draws when a source you control deals noncombat damage to an opponent | draws N |
| Guttersnipe, Firespitter Whelp | damage to each opponent on instant/sorcery cast | life lines |
| Archmage Emeritus | magecraft: draw | the trigger, a draw |
| Reverberate, Twinflame Tyrant | copy a spell; damage doubled | copies X; life |
| Electro, Assaulting Battery | mana from instant/sorcery casts, leaves: X damage | the trigger |
| Mystic Forge, Sensei's Divining Top | cast from the top of the library; look and reorder | "from the top of their library" |
| Urza's Saga | Saga land: makes Construct, tutors a 0/1-cost artifact, sacrificed | chapters, tutors, sacrificed |
| Wizard Class | Class levels | "levels up" / Level N |
| Training Center, Riverpyre Verge, Prismatic Vista | lands; Vista fetches a basic | sacrificed, the search |
| Basilisk Collar | deathtouch + lifelink | — |
| Boltwave, Flame Rift | damage to each opponent / each player | life lines |
| Aetherize | returns attacking creatures | return to hand |
| Slip Out the Back | phases out, +1/+1 counter | phases out |
| Pongify | destroy, 3/3 Ape for its controller | dies, creates Ape |
| Strix Serenade | counter artifact/creature/planeswalker, 2/2 Bird | countered, creates |
| Archmage of Runes, Goblin Electromancer | cost reductions | — |
| The Vision and Scarlet Witch | (new card) | its lines |

## How it was played (2026-11-04)

- Game 1: `rebuilt_mairsil` (Mairsil commander) vs AI `rebuilt_niv`, 12 Treasures for the AI by a fix so its deck casts.
  Five turns: one draw a turn was too slow to reach the deck (no fix can take cards out of a library).
- Game 2: `decks/handtest_mairsil_kenrith.json` (temporary: the same 31 cards with Mairsil in the 99, Kenrith commander for
  draws) vs the same AI, until White drew from an empty library (turn 10). Actions through the table's functions
  (tmp/act.js); log read from the table's game-log messages.
- Played and right (mechanics): Mairsil's cage from hand and graveyard, Mairsil (and its Spark Double and Helm copies)
  holding Royal Assassin's ability; commander to the command zone (Saw in Half, Pongify, Blasphemous Act); Saw in Half's
  two copies and the legend rule; Stitch in Time and Zndrsplt flips; Zndrsplt draws; Fable's three chapters and
  Reflection of Kiki-Jiki's copy; Bloodline Keeper's Vampires and transform; Clone, Spark Double (+1/+1 counter, not
  legendary); Buried Alive; Chaos Warp (shuffled, revealed, put onto the battlefield); Brainstorm, Ponder, Temple scry;
  Helm of the Host's token Mairsil (haste, cage trigger); Phyrexian Arena; Flare of Duplication copying Blasphemous Act;
  Arcane Denial countering the AI's Reverberate and its delayed draws; Xander's Lounge cycling; empty-library loss.
  AI: Niv-Mizzet, Mystic Forge (exiles and casts from the top), Electro, Guttersnipe, Pongify, Archmage of Runes,
  Reverberate, Training Center.
- Not reached: Ancient Copper Dragon's d20 with Wyll (caged both games), the AI's Aetherize, Basilisk Collar, Boltwave,
  Firespitter Whelp, Flame Rift, Goblin Electromancer, Prismatic Vista, Riverpyre Verge, Sensei's Divining Top, Slip Out
  the Back, Sol Ring, Strix Serenade, The Vision and Scarlet Witch, Twinflame Tyrant, Urza's Saga, Wizard Class,
  Archmage Emeritus.
- The "Screen bar keys" boxes: at y -30 with engine mode on, back at their saved places (y 0) once it went off.

## Bugs found

1. Mairsil's cage: "Ancient Copper Dragon is exiled" says neither the cage counter nor Mairsil (the table itself shows
   the counter and the link).
2. A cost reveal is not in the log (Foreboding Ruins: revealed Mountain).
3. A Treasure sacrificed for mana is one line each, without why: "Treasure Token is sacrificed" x7 for one spell.
4. A manual fix that makes tokens lists each one with Forge's script name: "New token for Red: treasure
   (c_a_treasure_sac); New token for Red: ..." x12.
5. Token copies of a name with a comma: "White creates 2 Mairsil, the Pretenders".
6. The second token Mairsil's cage question has no card name ("Exile an artifact or creature card ...?").
7. Public coin flips and reveals read as private and in the second person: "White saw: Zndrsplt, Eye of Wisdom: You win
   the flip", "White saw: Chaos Warp: revealed from AI 1's library: Mountain".
8. Triggered abilities logged as used: Fable's chapters ("White uses Fable of the Mirror-Breaker's ability"), Reflection
   of Kiki-Jiki's delayed sacrifice, Arcane Denial's delayed draws.
9. Lines out of order: Fable's chapter before its lore counter, Goblin Shaman's attack trigger before "White attacks",
   Electro's leave trigger before "Electro dies", Fable II's draws before its discards.
10. A copy says nothing of being one: Clone as Bloodline Keeper reads "Bloodline Keeper enters the battlefield", Spark
    Double as Mairsil "Mairsil, the Pretender enters the battlefield with a +1/+1 counter"; at death "Clone dies",
    "Spark Double dies", "Fable of the Mirror-Breaker dies" (it was Reflection of Kiki-Jiki).
11. Exchange of Words: the swapped text boxes show nowhere (table card text, the engine's text, a note).
12. The same ability on several permanents of one name shows once: three Mairsils could each destroy a tapped creature,
    the list offered one, so the player cannot pick which Mairsil taps (bridge.js "identical copies show once").
13. Rhystic Study: whether the opponent paid is not in the log.
14. Mairsil's cage question says "from your hand?" when the only card offered is in the graveyard.
15. Stitch in Time's extra turn: the turn header doesn't say it is an extra turn.
16. Ponder's look at the top three is not in the log (Brainstorm's put-back is).
17. Mairsil using a caged card's ability: "White uses Mairsil, the Pretender's ability" doesn't say whose (Royal
    Assassin's).
18. Flare of Duplication offered no "sacrifice a red creature" way to cast while White had three nontoken red Mairsils
    (paid with mana instead). To check: Forge's offer or the table's list.

## Fixes (2026-11-04)

Bridge (`bridge/bridge.js`), each with a case in `tests/test_bridge_events.js` or a "rebuilt #N" scenario in
`tests/golden/bridge-cases.js`:

1. The exile line names the card it was exiled with, its counters, and "until X leaves the battlefield" when it comes back.
2. A card revealed for a cost is logged: "White reveals Mountain (Foreboding Ruins)".
3. Sacrifices for one reason are one line; a card that sacrifices itself for its own mana says "for mana".
4. A manual fix's token reads "Red gets a treasure token", identical lines counted (×12).
5. Token copies of a legend: "White creates 2 Mairsil, the Pretender tokens".
6. A question with no card is named after the one card on the board whose text asks it.
7. Coin flips: "White wins the flip (Zndrsplt, Eye of Wisdom)". Reveals: "AI 1 reveals Mountain from their library
   (Chaos Warp)", once for the table.
8. Saga chapters: "Fable of the Mirror-Breaker's chapter I triggers (White)". Delayed triggers by Forge's "at the
   beginning of the next end step" ending, and any trigger once the engine marks it (below).
9. Triggers are logged after everything else the same board shows (dies, attacks, counters).
10. Copies: "Clone enters the battlefield as Bloodline Keeper"; deaths by what was on the battlefield: "Bloodline Keeper
    (Clone) dies", "Reflection of Kiki-Jiki dies".
12. Same-named permanents each keep their ability in the list, "(#2)" on the second.
14. The cage pick says "from your hand or graveyard".
15. The turn header says "(extra turn)" when a player follows their own turn.
16. Ponder: "White looks at the top 3 cards of their library (Ponder)".
17. "White uses Mairsil, the Pretender's ability (Royal Assassin's)", from the caged card with the same ability text.
18. A drag of a card with a static alternative cost under the same label (Flare) now asks how to cast it; before, the two
    ways were merged and the normal cast taken.

Engine (`manabrew/`, node image `mtg-forge-node:trig`): stack items carry `isTrigger` (Forge's `sa.isTrigger()`, so
Arcane Denial's delayed "Draw a card." reads as a trigger); a cloned permanent's `printedName` is its own name (for #10).
Protocol: `StackObjectDto.is_trigger` (optional, so the old relay passes it through).

Not fixed: 11 (Exchange of Words: Forge records the swap as changed text, which the table already draws as a text box;
to look at in the re-test), 13 (whether the AI paid for Rhystic Study: nothing the bridge receives says so).

## Suite run on the fixes (2026-11-04)

- Shape: the graveyard branch and the departures had two copies of "group tokens, push the rest"; now one `leave` helper.
- Review findings fixed: an activation ending in "...at the beginning of the next end step." (Kiki's) read as a delayed
  trigger (now not when the text has a cost colon); a face-down card's death named "a face-down card"; an edict on a
  Treasure said "for mana" (the cause is checked now); a Cancel in a reveal-for-cost list was logged as a card; "a" before
  a vowel; "(extra turn)" on a fixture where one player has every turn (now only with another player's turn on record);
  unrelated sacrifices merged into one line (now only those with a reason).
- Break-it pass: 28 careless edits to today's code, each run against `tests/test_bridge_events.js` and
  `tests/test_bridge_golden.js` (`bridge/bridge.mutant.js`, the real file checked by hash every time). First run: 23
  caught, 5 escaped (18%, SOUND). The escapes were holes and all are closed, each now failing by its own name: an
  unnamed edict on a Treasure, a card in exile that is not caged by the source, a reveal shown to two seats (the old test
  sent both to one seat, which never reached the dedupe), a fix's repeated tokens, and "an". Final: 28 of 28 caught.
- Gates: 893 bridge scenarios, 133 event checks, 31 bridge claims, 26 state-delta, 450 map, 4 table games (993 steps),
  256 table checks, 111 table-check tests, kind relation, 70 alignment: all pass.
- What these cannot see: the engine fields (`isTrigger`, clone `printedName`) are faked in fixtures; only the re-test in
  real TTS on the `:trig` image shows Forge sends them. Two seats answering one reveal at nearly the same time are only
  tested in sequence.

## Re-test (2026-11-04, after deploying `:trig`)

Played on the headless table (tests/lua/headless-tts.js + a second bridge), not real TTS: the PC bugchecked twice that
day (0x119 at 05:21 while TTS loaded the table, 0x133 around 10:00 with TTS closed) and the GPU reset (nvlddmkm 153) at
09:24 while TTS drew cards. Same bridge, table script and engine. `handtest_mairsil_kenrith` vs AI `rebuilt_niv`, to
White's turn 7 (library nearly empty). Recording: tmp/tts-stream-rebuilt-retest.jsonl.

Right live: 1 ("...exiled from White's graveyard with Mairsil, the Pretender (a cage counter)"), 5 ("creates 2
Zndrsplt, Eye of Wisdom tokens"), 6 (the token Mairsil's cage question is named), 7 ("White wins / loses the flip
(Zndrsplt, Eye of Wisdom)", "AI 1 reveals Island from their library (Chaos Warp)"), 8 (chapters I-III, Kiki's delayed
sacrifice and Arcane Denial's delayed draws "trigger"; Forge sends isTrigger), 10 ("Clone enters the battlefield as
Bloodline Keeper", "Bloodline Keeper (Clone) dies", "Mairsil, the Pretender (Spark Double) dies"), 11 (the table's cards
carry the swapped text as changed text; the engine's ability list follows the swap), 12 ("... (#2)"), 14, 17 ("White
uses Mairsil, the Pretender's ability (Royal Assassin's)"), 9 in part (lore counter before its chapter).

Still wrong:
- 2: no reveal line. Forge sends "Reveal for cost" as the question's description; the fix read only the title.
- 9: Fable's chapter II logs "White draws 2 cards" before "White discards ...".
- 10: a copy coming back from a graveyard isn't named as one: Spark Double returned by Kenrith as Mairsil reads "Mairsil,
  the Pretender returns to the battlefield from White's graveyard with a +1/+1 counter".

New:
- After Saw in Half on Zndrsplt and the legend rule, "White casts Zndrsplt, Eye of Wisdom": a token, never cast, and no
  enter line for it.
- Arcane Denial countered Niv-Mizzet, Visionary: no "is countered" line.
- Kiki's token copy reads "White creates Mairsil, the Pretender" (no "token").
- Chaos Warp: the reveal line comes before "Island is put into AI 1's library".
- Exchange of Words: the log never says the text boxes were swapped.

Not reached: 3 (Ancient Copper Dragon caged), 15 (Stitch in Time lost its first flip), 16 (Ponder not drawn), 18 (no
instant or sorcery on the stack while Flare was in hand), 4 (golden only). 13 has no fix.

## Fixes after the re-test (2026-11-04, bridge only, not yet deployed)

Each has a test that fails with the fix taken out (checked by breaking it):

- 2: the reveal for a cost is read from the question's title or its description ("Choose" / "Reveal for cost"), and
  said after the board that plays the land.
- 9: draws and discards go in the order the engine's event feed numbered them, per player: a discard before its draw
  is said first (Fable's chapter II; cycling now reads discard, then draw, as it is paid).
- 10: a copy says what it is from anywhere: "Spark Double returns to the battlefield from White's graveyard as Mairsil,
  the Pretender", the same from exile.
- New, token "casts": the second Zndrsplt token died to the legend rule with its "Partner with" trigger on the stack;
  with its source in no zone the trigger was taken for a spell. The engine's `isTrigger` is now read first.
- New, no "is countered": Niv-Mizzet is the AI's commander, so countered it went to the command zone, where the check
  never ran. Now "Niv-Mizzet, Visionary is countered and returns to the command zone". (The engine's event feed gives
  no cause for a move off the stack, so this stays the board check.)
- New, copy token: "White creates a Mairsil, the Pretender token"; any token whose name lacks "Token" reads so
  ("an Everywhere token", "a Changing Loyalty token").
- New, Chaos Warp: a reveal line waits for the next board's lines (2 s at most), so it follows what the spell did first.
- 11 / new, Exchange of Words: "Royal Assassin and Bloodline Keeper exchange text boxes (Exchange of Words)", when two
  permanents' texts change in one board as a text-box swap resolves, or each now reads as the other did.

Found on the way: the first draft of the draw/discard order threw on a board with no event feed and silently dropped
that board's log lines; the golden master caught it (three scenarios with no lines).

Deployed 2026-11-04 (bridge only; all ten gates passed in the deploy).

## Re-test 2 (2026-11-04, after deploying the fixes above)

Headless table again, `handtest_mairsil_kenrith` vs AI `rebuilt_niv`, four games (one per thing left to reach), with
`mtg mana 99` (and `mtg mana 99 for Red` on the AI's turn so it could cast Niv-Mizzet). Recordings:
tmp/tts-stream-rebuilt-retest.{1,2,3}.jsonl and tmp/tts-stream-rebuilt-retest.jsonl.

Right live:
- 2: "White plays Foreboding Ruins", "White reveals Mountain (Foreboding Ruins)".
- 9: Fable's chapter II: "White discards Exotic Orchard, Helm of the Host", then "White draws 2 cards".
- 10: "Spark Double returns to the battlefield from White's graveyard as Mairsil, the Pretender with a +1/+1 counter".
- 15: "--- White's turn 3 (extra turn) ---" after Stitch in Time won its flip.
- 16: "White looks at the top 3 cards of their library (Ponder)".
- 18: Flare of Duplication is offered both ways while a spell of White's is on the stack.
- Saw in Half on Zndrsplt and the legend rule: two "partner with triggers" lines, no "casts".
- One copy token: "White creates a Bloodline Keeper token" (Helm of the Host).
- Chaos Warp: "Sensei's Divining Top is put into AI 1's library", then "AI 1 reveals Mountain from their library (Chaos Warp)".
- Exchange of Words: "Zndrsplt, Eye of Wisdom and Bloodline Keeper exchange text boxes (Exchange of Words)".
- Arcane Denial on Niv-Mizzet: right only after the fix below.

Found and fixed (bridge, deployed): a commander countered and recast before the next board read as never countered nor
recast ("White casts Arcane Denial", then "Niv-Mizzet, Visionary enters the battlefield"). The AI recast it at once with
its mana. Forge's event feed has no move for a cast out of the command zone (the guess log shows every commander cast as
"left command"), so the move read Stack, Graveyard, Command. Now a spell back on the stack under a new stack id (Forge
never gives one twice) is said as cast again, after "is countered" when a counterspell had it; the feed says where it
went between ("and returns to the command zone"; a bounce: "returns to AI 1's hand"). With no feed it still says
"is countered" and the cast. Live after the fix: "Niv-Mizzet, Visionary is countered and returns to the command zone",
"AI 1 casts Niv-Mizzet, Visionary". Tests: 7 in tests/test_bridge_events.js (155 pass); break-it 10 of 11 caught, the one
escape equivalent (the old loop adds nothing for a recast card: it starts at the previous board's count, 1).

Found in re-test 2, fixed 2026-11-05 (each checked live on the headless table with its `scenarios/bug-*.json`):
- a. The attack line now comes before what its trigger made in the same board ("White attacks with Goblin Shaman token",
  then "Goblin Shaman token's ability resolves (White)", "White creates a Treasure token").
- b. "White rolls 15 (Ancient Copper Dragon)", in the public log, said of the roller (only a seated player's name counts
  as a roller).
- c. Treasures paid one click at a time join one line: "Treasure token ×4 are sacrificed for mana" (only a board whose
  first line is more of them, right after that line; the table's log is sent again with the line rewritten).
- d. "a Treasure token", "15 Treasure tokens", "Goblin Shaman token", in creating, attacking and leaving.
- e. Flare of Duplication: the harness now sends Forge's static alternative cost (OptionalCost.AltCost) as the
  `staticAlternative` mode (node image `mtg-forge-node:altcost`, no protocol change), so a drag asks "how do you play
  it?" with "Cast Flare of Duplication (sacrifice a nontoken red creature instead of its mana cost)"; the priority row
  says the same. Live: Goblin Guide sacrificed, no mana spent, Bolt and its copy dealt 6.
- f. "Exchange of Words' ability", "Archmage Emeritus' magecraft".
- g. An ability that resolved between two boards, unseen on the stack, is named from the event feed's cause (an effect's
  word only: not a cost, a replacement, a card moving itself, or a source off the battlefield).
- h. Manual-fix and debug lines name players as the log does ("AI 1 gets Island (battlefield) ×5").
- i. A spell that resolved in the turn just ended goes above the next turn's header; the new turn's own lines (its draw,
  a spell cast in it) stay under it.
Tests: tests/test_bridge_events.js (183), tests/test_bridge_debug.js (47), golden 898. Break-it on the log code: 35 of
35 caught after closing 11 escapes of the first pass (20 of 31); the jr-programmer-suite ran on all the fixes (one token
naming helper, the bug-i move without index arithmetic, the bug-c join through updateLog's own tail so the 300-line trim
applies).

Before the fixes, as found:
- a. Goblin Shaman's attack trigger: "White creates Treasure Token" before "White attacks with ...".
- b. A die roll reads private and second person: "White saw: Ancient Copper Dragon: White rolled 6" (coin flips were
  fixed in #7, dice not).
- c. Treasures paid one click at a time: four "Treasure Token is sacrificed for mana" lines for one spell.
- d. Tokens named "... Token" keep Forge's name: "White creates Treasure Token", "White creates Ape Token" (Arena: "a
  Treasure token").
- e. Flare of Duplication: the second way reads "Cast Flare of Duplication (option 2)", not the sacrifice; a drag takes
  the mana way without asking (the ask only runs when the two labels are the same).
- f. "Exchange of Words's ability triggers" (possessive of a name ending in s).
- g. A trigger that resolves inside one board is never named: Fable's chapter I on the cast board, Helm of the Host's
  combat trigger, Archmage Emeritus's draw ("AI 1 draws a card" alone).
- h. A manual fix names the AI by seat colour: "Red gets mana ..." where the log says "AI 1".
- i. The AI's Sensei's Divining Top "enters the battlefield" after the next turn's header (resolved on the board that
  changed the turn).
