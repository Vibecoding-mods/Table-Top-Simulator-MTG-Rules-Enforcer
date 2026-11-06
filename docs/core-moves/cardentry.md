# engineCardEntry status (2026-11-06)

Plan: docs/core-moves-cleanup-plan.md §3 and its Review 2026-11-05. Nothing deployed, nothing pushed, no commits.

Files changed (mine only):
- tools/engine-renderer.lua
- tests/golden/table-run.js (a new 5th game, "card entry: every way a card object is made"; the 4 old games untouched)
- tests/golden/table_golden.json (re-recorded, see each step)
- tests/test_table_claims.js (a new block of 20 checks at the end, "engineCardEntry"). First written as its own file,
  tests/test_table_card_entry.js; moved into test_table_claims because test_alignment requires every tests/test_table_*
  file to be in deploy.js GATES, which I do not own. The old file is kept at tmp/core-moves/test_table_card_entry.moved.js

Copies of every stage are in tmp/core-moves/ (engine-renderer.cardentry-step0/2/3a/3b/3/4.lua, table_golden.*.json).

Main-chunk locals (built Global, luaparse): 192 before, 191 after (renderer alone 180 -> 179). `backDeckEntry` is
gone; `FLAT` moved up (same count); `engineCardEntry` is a global; the game check's `gen` is inside `place`.

## Step 1: photograph first (today's code)

New game in the table golden, crafted boards after the 1v1's first board. It covers every entry path the sim can run:
- 4 creatures die into a graveyard that already holds 2 cards (a pile deck, `addToPile`), then all come back
  (`engineTakeFromPiles` takes them out): Serra Angel with a status box (Hexproof, Flying, Vigilance), Grizzly Bears
  3/3 under a Glorious Anthem that stays, Prodigal Sorcerer (ability, no buttons on screen when it died), Royal
  Assassin (ability buttons on screen when it died). Then a priority question offering both abilities.
- a library search: a double-faced card pulled out of the library deck, then played (board), then the question closes.
- a graveyard card picked for a question (pulled out of the pile deck, `engineChoosable`), then put in the hand.
- "mtg reset" one frame after a board starts spawning 3 cards; calls made on the objects once destroyed are logged.
- reports are named steps ("ce: ..."), read by the new block in tests/test_table_claims.js.

What today's code did (recorded in step 1):
- Finding 1 PROVEN: back from the pile, Serra Angel and the Bears have no buttons at all (`7001 [] | 7002 []`),
  still none at the next priority.
- Review's ability-button claim NOT reproduced in this order: both ability creatures get their buttons at the next
  priority (a new question always changes the key). Only the status/P/T boxes are lost.
- Finding 2 (review's version) PROVEN: after the reset the late callbacks register the 3 destroyed objects as the
  cards' objects and call `setLock` on each (3 calls on destroyed objects; an error each in real TTS).
- Finding 3 confirmed: the searched card keeps the plain back on the battlefield (any searched card, not only a
  double-faced one).
- Members the table builds (graveyard pile, library search deck) have no Locked and no Tags.
- The recorded streams have no card the engine takes out of a 2+ card pile (only the manual-fix "pops back out" step).
- Seen while building the case, not changed: if the search question closes BEFORE the board that places the pulled
  card, the old board is drawn again first, the loose card is thrown away and the next board spawns it fresh (one
  dispose + one spawn). The golden case sends the board first, then the close.
- Not reachable in the sim: `deck.remainder` (a pile deck taken down to one card). The sim has no remainder.

## Step 2: engineCardEntry, no change in behaviour

- `engineCardEntry(id, obj, c, opts)`: `place`'s spawn callback and the four take-overs (library search pull, pile
  take, pile remainder, pile pick) all call it. `engineAdopt` stays as a one-line alias.
- Kept each path's old bookkeeping exactly (badge/glow reset and drawing only on spawn, inPile cleared only on
  take-over). The arrive animation's `Wait.time` is still scheduled before the entry, so wait order is unchanged.
- Golden: all 5 games byte-equal (1040 steps, every spawnObjectData line with its CardID and CustomDeck keys).
- Break-it (all CAUGHT): entry does not set engineFace (golden: more spawns in all games); does not clear engineInPile
  (card-entry check + golden); does not set engineObjs; does not mark held; spawned card takes its face from the
  details (golden + checks).

## Step 3: the fixes, each its own golden diff

- 3a badge reset for every entry. Diff: only the card-entry game, 3 steps: 2 `createButton` lines on the return board
  (the status box and 3/3), and the two button reports. Re-recorded.
- 3b glow reset + `engineGlowLate` for every entry. Diff: only the card-entry game, 4 steps: the pulled search card
  and the pulled graveyard card now glow as choosable (green) until their question closes, as a spawned card does.
  Re-recorded.
- 3c `engineInPile` cleared for every entry (also a spawned card). No golden change.
- 3d game check in `place`'s spawn callback: a callback from an earlier game touches nothing; an object the sweep
  missed (still "engine:<id>") is thrown away. Diff: only the reset report (no object registered, no calls on
  destroyed objects). Re-recorded.
- Break-it: badge reset only on spawn CAUGHT; no game check CAUGHT; late glow only on spawn CAUGHT; keep the missed
  object CAUGHT (needed a new case, below). ESCAPED: removing the stack-glow reset (equivalent: the render already
  drops the glow of a card with no object, line ~1842, so it is always nil by the time a card is taken back);
  disposing every late object (equivalent in the sim: a swept object is destroyed or re-trashed harmlessly).
- Added after the first mutation pass (an escape): one late object hidden from the sweep (as if TTS listed it a frame
  late); the fix throws it away. Golden re-recorded for that new case only.

## Step 4: one data builder

- `engineCardData(c, how)`: nil = a card on its own (Locked, Tags, as before); "inside" = pile member; "search" =
  library search member with the plain back. `engineZonePile` and `libraryDeckData` use it; one `FLAT`.
- `backDeckEntry` removed; both callers (library deck, the plain backs added to a library) use
  `deckEntry(ENGINE_BACK, ENGINE_BACK)`.
- One rule change with no golden effect: a search member with no name now shows the back (as every other builder).
- Golden: byte-equal. Break-it (all CAUGHT): Locked on members, Tags on members, search members with their own back.

## Not done, on purpose

- Finding 3 (searched card keeps the plain back) is NOT fixed. Recording "the face the object shows" would make the
  next board respawn every tutored card (its sleeve back differs from the plain back), the respawn `engineAdopt` was
  made to stop. Recommend leaving it.
- No separate `engineCardSpawn`: `place` is the only spawner of engine cards, so the game check sits in its callback.
- tools/make-engine-copy.js not touched (not needed).

## Gates

All 19 GATES of tools/deploy.js green at the end (renderer sha256 34c4d792...): test_table_claims 298 (278 + 20 new),
test_table_golden 5 games / 1042 steps, test_table_kind_relation also covers the new game, test_alignment 71.
The 4 new-check groups were seen red by name inside test_table_claims too (badge reset, game check, Locked, Tags).
Every mutant was restored by overwrite and its sha256 checked (aside copy: tmp/core-moves/engine-renderer.cardentry-mut.lua).

Golden re-records, all intended: step 1 (new game added, 4 old games byte-equal), 3a (badge), 3b (glow), 3d (game
check), and once more for the "hidden from the sweep" case added after the mutation pass. Steps 2, 3c and 4: no change.

## Real-table check (the lead, after a deploy)

One game on the real table (Mock MTGA 4 player, engine mode):
1. A creature with a status box (a keyword granted to it, e.g. by an equipment or anthem, so its box shows) or a P/T
   box raised by an anthem: let it die while the graveyard already has 2+ cards, then reanimate it (Reanimate,
   Animate Dead, Zombify). Expect: its status box / P/T box shows at once on the returned card. Before: no box.
2. Then at your priority, a returned creature with a tap ability shows its ability button.
3. A tutor (Demonic Tutor): pull the card out of the library (right-click Search, drag it out). Expect: it glows green
   until the question closes; it lands without flicker (if the question closes before its board, it may be thrown
   away and spawned again: old behaviour, not changed).
4. A "return target card from your graveyard" choice: drag the card out of the graveyard pile. Same: glows, stays.
5. Draws, mills and the graveyard/exile piles still work as before.
6. "mtg reset" right after a board starts drawing (e.g. while the opening hands appear): no TTS console error
   ("object destroyed"), no card left on the normal table afterwards.
7. Watch for frames: no new spawns were added; PresentMon only if it feels worse.
Added in round 2:
8. A search (Demonic Tutor), then "mtg reset" right after the question closes (the library deck is being rebuilt):
   no console error, no library deck left in the old place, the next game's library is whole.
9. A "return target card from your graveyard" pick from a graveyard of exactly 2 cards: drag one out. Expect: the
   card left stays as the graveyard (one card, no second copy on top of it), and the next board leaves it alone.
   This is the one fix the fake table cannot show for real: it has no deck.remainder, so the test sets it by hand.
   If TTS fills remainder only after onObjectLeaveContainer, the fix does nothing (no harm: the old stray stays).
10. A creature that dies within a frame of being played (e.g. a 0-toughness one): it lands in the graveyard pile, the
   pile count is right, and no loose copy stays on the battlefield.

## Round 2 (the coordinator's review fixes)

Baseline: the trackMarks agent's renderer (sha d26678e2..., kept aside as engine-renderer.cardentry-r2base.lua) and
golden (table_golden.r2base.json). Their changes are kept; the renderer diff against that baseline is only mine.
Renderer now sha256 0a30ddd3... (copy: engine-renderer.cardentry-r2.lua). Main-chunk locals 191, no new ones.

1. inPile on the spawn path. engineCardEntry clears inPile only for a taken card (c == nil); place clears it when it
   starts a spawn. A late callback no longer clears a card a pile took in meanwhile. New case 4b: a card leaving a
   rebuilt pile is spawned with inPile=nil; a creature that dies while spawning stays inPile=true after its callback,
   and the loose late object goes on the next board.
2. DeckIDs. The members report now says whether DeckIDs are the members' CardIDs in order (pile and library).
3. Library game check. engineLibraryDeck's callback skips (and throws away) a deck from an earlier game. Case: a search
   closes, then "mtg reset" while the library deck spawns; after it the library has no object and no calls were made
   on the destroyed deck.
4. Pile pick remainder. New enginePileRemainder (a global) is shared by engineTakeFromPiles and the pile pick. Claims
   check plays the pick with remainder set by hand and the deck destroyed: the card left is that object, copies=1.
5. Done: addToPile spawns with engineCardData(c, "inside"), so no Locked and no engine tag. Nothing reads the tag.
   Golden: the one setLock(false) on that card is gone (game 0 step 266, game 1 "White's turn, a mill").

Break-it (all CAUGHT by name in test_table_claims, restored by overwrite, sha checked): r2-no-place-clear,
r2-entry-clear-always, r2-deckids-first, r2-lib-deckids-back, r2-no-library-gen, r2-no-pick-remainder,
r2-pile-spawn-own. test_table_claims 315 checks (10 new).
Golden re-recorded once: games 2-3 equal; games 0-1 only the setLock line above; card entry adds 4b, the search
before the reset, and the DeckIDs text.

## Proposed for others

- None needed: the checks live in test_table_claims, already a gate.

## Hours

About 4 h (photographs 1.5 h, step 2 0.5 h, fixes 0.75 h, data builder 0.25 h, mutation passes and gates 1 h).

## jr-programmer-suite run (2026-11-06, table half)

**Part 1, libAdd.** A real-table bug: when a library grew by N plain cards at once, N separate "Library card" objects were spawned and put in one by one. Now the N cards are one object (a card for N = 1, otherwise one deck of N members built by libraryDeckData), put in with one enginePutInDeck. The "library destroyed meanwhile → dispose" guard is kept. sweepEngineCards also disposes a deck whose members are all "libcard". Golden diff, read with ids dropped: in 4 old 1v1 steps, N card spawns became one deck and N puts became 1. In card entry, the reset report's stray-deck count went from 1 to 0. Nothing else changed.

**Sim deck merge.** The fake TTS put a deck into a deck as one object. TTS merges the cards. SIM_DECK_MERGE in tests/golden/table-run.js now does the merge for every scenario. It should move into tests/lua/tts-sim.lua's putObject, which I don't own.

**Stages.**
- Structural: the engineAdopt alias is gone (nothing called it). The two game checks (place, library deck) now share engineSpawnStale(gen, obj, id). It is a global, so locals stay at 191.
- Simplify: nothing more.
- Analysis: in enginePileRemainder, only an engine card becomes a card's object. A foreign remainder is ignored.
- Claims: "(the deck is)" in engineCardData's comment now says "locked", not tagged. The stale "goes once both are live" was corrected.

**Claims buckets.**
- Tested already: ~10.
- True but untested, now tested: one builder (`GMNotes = "engine:"` appears twice), one way (3 engineObjs writes), the table's own remainder take, a foreign remainder, a DFC in the hand.
- False: 2 sentences, fixed.
- Real-table only: TTS merging decks on putObject, and the stack-glow reset.

**Mutation (TABLE_SAVE).**
- Part 1: 17 mutants, 14 caught, 3 escaped.
  - P10 (engineEntering not set): the sim fires no container events.
  - P14 (n > 0 dropped): equivalent, since TTS has no empty deck.
  - P16 (break dropped): equivalent, since plain stays false.
- Part 2: 32 mutants. Round 1: 29 caught. After the new checks, 31 caught and 1 escaped.
  - Q19 (the pile's object kept): equivalent, because the same board's engineZonePile clears it.

**Real-table checks.**
1. A debug setup or London mulligan puts 7 on the bottom: no deck is left lying on the library, and the count is right.
2. "mtg reset" removes an old stray deck of plain backs and keeps the player's decks.
3. Several cards go into a library while it is rebuilt.
4. A DFC drawn into the hand is not respawned.
5. Reanimating from a 2-card graveyard leaves no stray.

**Hours.** About 4.5 h.
