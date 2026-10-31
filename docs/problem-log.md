# Problem log (keyword test rounds, 2026-10-19)

Found by the automated games (`tools/run-coverage.sh`, checker `tools/tts-check.lua`). Each entry: what happens, evidence, likely cause, possible fix. Status: **open**, **fixed (checker)**, **fixed (code)**, **not a bug**.

## Fix results (2026-10-20)

Tested with a discard-and-return deck (`test_piles`: Faithless Looting, Tormenting Voice, Cathartic Reunion, Thrill of Possibility, Wild Guess, Regrowth, Eternal Witness, Gravedigger, Raise Dead) against the harmless AI (`ai_passive_lands`).

- **P1 fixed.**
  - *First version:* it rebuilt piles in a loop. While a rebuilt pile was still being spawned, the check saw "no pile" and rebuilt again, and the whole graveyard (20 cards) went missing.
  - *Final version:* it skips piles that are being spawned, skips cards that have since left the pile, and repairs each pile at most once per 3 s.
  - *Result:* 0 table problems in a full game. 3 cards really went missing (Forest, Regrowth, Faithless Looting), and each was repaired ("[engine] pile repair" in the console).
- **P2 fixed.** Pile bookkeeping is reset between games. No "missing (hand)" in the test game, which had 5 cards returning from the graveyard.
- **P3 guarded.** The panel and glow drawing for a new question run protected. An error no longer breaks the rest, and it prints which step failed ("[engine] panel error" / "glow/menu error"), so the next occurrence shows its place.
- **P8 fixed.** The end-of-game sweep also removes library placeholders, and a deck put back never keeps them. After a reset: 0 placeholders loose, 0 inside decks.
- **Re-check of all flagged keywords** (round 8: the 39 flagged plus the 12 not yet cast; report `tmp/keyword-recheck.md`):
  - 32 now play cleanly, including 30 of the 39 flagged (Adamant, Delve, Flashback, Prowl, Commander ninjutsu…). Total: **279 of 286 keywords played**, 0 rules-engine errors.
  - Still flagged: **Retrace** (Throes of Chaos; see P9) and **Teamwork** (HULK SMASH!). HULK SMASH! is not a bug: every "wrong place" was a different random spot, i.e. the test driver's own drag-to-cast attempts, which the engine refused before the card snapped back.
- **New, fixed: City of Brass payment buttons.** Paying showed five identical "Tap City of Brass" buttons. They now name the mana ("Tap City of Brass for {R}"). The autopilot also prefers Auto-pay now, since tapping the first source paid {W} for a {R} cost and looped.
- **Checked, not a bug: stacking permanents.** Two battlefield cards were merged into a deck, as a TTS drop does. The table threw the deck away and redrew both cards in place.

### P9. Rare: cards vanish around a drag-play that the engine answers with a question
- **Seen:** twice in the keyword rounds, each time two White permanents at once.
  - r8-03 replay: City of Brass + Slicer, High-Speed Antagonist.
  - First r8-03 run: Forest + Plains.
  - Missing from that step to the end of the game: no object, no copy, never removed through `engineDispose` (logged with `engineDebugDispose = true`).
- **Right before:** White dragged **Llanowar Reborn** (a land with graft) onto the battlefield. The engine asked two "Choose" questions, and the engine then still had the card in the hand ("wrong place").
- **Guess:** the dragged card was dropped onto other permanents and something merged or replaced them outside the normal path. Stacking alone is handled (tested), so the extra question (a held/optimistic move) is the likely difference.
- **Next:** replay a deck with Llanowar Reborn + City of Brass + Slicer and watch object GUIDs around that drag-play; also log `onObjectEnterContainer` for engine cards.
- **Related:** Retrace (Throes of Chaos) stayed at its battlefield-area spot while the engine had it in the graveyard. That is also a card the engine moved while a drag was involved.
- **Cause found in the code:** a graveyard/exile pile kept ANY engine card that landed in it ("never break up a pile"). A permanent dropped onto the pile, e.g. a card released on top of it, was swallowed: no object anywhere, never removed through `engineDispose`, which is exactly what was seen. The test driver drops cards at random spots, some close to the graveyard pile.
- **Fix (2026-10-20):** a card landing in a pile that the engine doesn't have in that pile is taken back out and redrawn where it belongs. A card dropped there to discard goes in once the engine has moved it.
- **Tested:** the regression game (`test_piles`) had 0 table problems, 0 errors and 4 pile repairs. The swallowing drop itself can't be reproduced from a script: `putObject` of a battlefield card into the pile is refused, while a real hand-drop merges. So this is **probably fixed, not yet confirmed**; watch real games for permanents vanishing.
- **Status:** fix in place, not confirmed in a real game.

## Open

### P1. Card discarded by dragging can vanish from the graveyard
- **Seen:** 32 checks in round 1 (decks r1-04, r1-08): Swamp, Plains, High Perfect Morcant… Every case was a card dragged from the hand to the graveyard during a "Discard (N)" question.
- **Evidence:** `obj=nil inPile=true zone=hand copies=0`. The table marked the card as inside the graveyard pile, but it isn't in the pile deck and isn't loose anywhere.
- **Likely cause:** a race between `addToPile` and a pile rebuild. `addToPile` takes the hand card, moves it above the pile and calls `enginePutInDeck` one frame later. If the pile deck is rebuilt in that frame (or a second discard arrives together and changes the pile's order), the old deck goes into the trash with the card inside (`engineDispose(o)`), and the new deck is spawned from a list that the pile state already counts as done.
- **Possible fixes:**
  1. In `addToPile`, re-check `deck` at put time. If it was replaced (`engineObjs[pileId] ~= deck`), drop the card's `engineInPile` mark and call `engineRebuildPile(pileId)`, so the pile is redrawn from the engine's list.
  2. Before disposing an old pile deck, compare its contents with the new list; take out any card the new deck won't contain.
  3. A safety net in `engineRender`: for every graveyard/exile card marked `engineInPile` that isn't in its pile deck and has no object, rebuild that pile once.
- **Status:** fix written, not pushed yet (fixes 1 and 3 combined): every put into a pile is checked 6 frames later; if the card isn't in the pile deck (or the deck was replaced) and has no object of its own, the pile is rebuilt from the engine's list (op "pileRepair"). To verify: a discard-heavy repro after the rounds.

### P2. Card back in the hand from a pile never appears
- **Seen:** a few checks in r1-12…20: Llanowar Reborn, Abzan Falconer, City of Brass, Battle Cry Goblin (White hand).
- **Evidence:** `obj=nil inPile=true zone=nil`. The card left the graveyard/exile pile for the hand, but still carries the `engineInPile` mark, and the table never placed it.
- **Likely cause:**
  - `engineTakeFromPiles` only takes cards out when the rest of the pile is unchanged and in the same order. Otherwise the card stays "in pile" until the pile is rebuilt, and nothing draws it in the hand meanwhile.
  - Also, `engineInPile` is never cleared between games, and engine card ids repeat every game.
- **Possible fixes:**
  1. When a card's zone is hand/battlefield/command and it's still marked `engineInPile`, clear the mark and rebuild the pile it came from.
  2. Clear `engineInPile` (and `pileIds`/`pileState`) in `engineClear`/`engineStarted`.
- **Update:** most of these were held draws waiting on the library (the checker now skips them); `inPile=true` was left over from an earlier game.
- **Status:** fix 2 written, not pushed yet (`enginePileReset` clears pile, group and glow bookkeeping when a game is cleared). Watch round 2 with the new checker.

### P3. TTS error "Value cannot be null. Parameter name: key"
- **Seen:** once, during deck r1-15, at 19:14:18. Later decks' logs repeat the same line, because the console log builds up.
- **Likely cause:** a TTS call with a nil key, e.g. `Player[nil]`, `getObjectFromGUID(nil)`, or a nil id or colour in `UI.setAttribute`.
- **Context:** fired 0.1 s after a "Your priority" question reached the table (bridge log r1-15, prompt #203), so it is in the panel/right-click-menu code that runs for a new question.
- **Possible fix:** find the call from the bridge log at that time; add nil guards to the colour lookups in the panel and tracker code.
- **Status:** open.

### P4. Commander shown at its old battlefield spot after returning to the command zone
- **Status:** fixed (code), `engineManualLanded`. Verify in the next rounds that no "wrong place … (White command)" appears.

### P5. "wrong place" for AI creatures (Dwarven Grunt, Slicer, Hired Muscle) and hand cards (Restoration Magic, Collective Resistance)
- **Seen:** r1-12…20, a few each.
- **Likely cause:** checked mid-move (now skipped with `isSmoothMoving`), or hand cards caught while TTS re-lays out the hand.
- **Status:** watch in round 2 with the new checker.

### P6. TTS slows down over a long session
- **Seen:**
  - after about 22 test games, each test step took 15 s instead of 4 s;
  - TTS used 4.0 GB of memory, with 4-second freezes every 4.4 s, and its asset clean-up pass took 600 ms.
- **Measured after the restart** (`tools/tts-health.sh` after every deck, written to `tmp/health.log`):
  - objects stay at 107, so nothing piles up on the table and the end-of-game cleanup works;
  - TTS memory grows about 90–230 MB per game (1,295 → 1,527 → 1,618 MB);
  - command response time grows too (663 → 985 ms).
- **Likely cause:** TTS keeps the memory for every new card picture and object it loads during a session, and its garbage-collection pauses grow with memory. Test decks bring about 50 never-seen cards per game.
- **Possible fixes:**
  1. Tests: restart TTS every ~8 games; loading the save afterwards needs the player or computer use.
  2. Check whether reloading the table (not restarting TTS) frees the memory. If it does, recommend a reload between games on long game nights.
  3. Smaller card pictures: klrmngr "display" webp images are about 0.5 MB each once decoded.
- **Reload test (19:42):** after 7 games, reloading the table (Save & Play) brought the command response back from 1,637 ms to 585 ms, but memory stayed (1,789 → 1,883 MB). Unity's loaded objects dropped only from 80,000 to 72,000, and its clean-up pass stayed at about 225 ms.
  - So the slowdown is **not the memory**. It is something that builds up in the running game's script state and is cleared by a reload.
  - Suspects: per-object callbacks that are never released (`addContextMenuItem` closures, `Wait` handlers), tables keyed by object GUID that only grow (`engineEntering`, `engineBaseGlow`), or the test driver hooking `engineRender` again every game.
- **Test-tool experiment (20:14):** one full game played by the in-TTS autopilot with no test-tool commands (~150 questions): command response 569 → 572 ms, no build-up. Games with the test driver add 150–250 ms each.
  - So the build-up most likely comes from the **test driver's hundreds of debug commands per game**, not from the game. Suspect: MoonSharp keeps every executed chunk.
  - Real games send none of these, so players shouldn't be affected. The full A/B (3 games without, 3 with) is running to confirm.
- **A/B result (22:18), confirmed:** command response over 3 games, each run starting from a reload.
  - **No test tools** (in-TTS autopilot, nothing polling): 555 → 582 → 611 → 571 ms, flat.
  - **With test tools** (driver + checker): 563 → 663 → 1,055 → 1,054 ms, almost doubled in 3 games.
  - **Cause:** the test tools' hundreds of debug commands per game. **Real games are not affected.**
  - **Possible improvement:** fewer debug commands per step (install the checker once and call it by name) so tests stay fast longer.
- **Workaround in place:** tests run in cycles of 7 decks (`tools/kw-cycle.sh`), with a table reload before each cycle.
- **Also found:** the in-TTS autopilot looped on "Undo mana" when it couldn't afford a spell. It now taps a source if one is offered, otherwise cancels.
- **Next:** find what builds up. Count Lua table sizes and Wait handlers per game, and compare a game run without the test driver's hooks.
- **Player tip until it's fixed:** after many games in one session, reload the table to get the speed back.

### P7. Test results repeat old errors
- **Seen:**
  - "Runaway game: 5001 triggers" and "Value cannot be null" showed up again in later decks' results;
  - `run-coverage.sh` copies the bridge's whole console log (`/log`), which keeps everything since the bridge started.
- **Fix:** take the console log only from the line count at the deck's start, as is already done for the bridge log. Do it between rounds; the script is in use now.
- **Note:** the runaway game was real Magic. The AI's Mist-Syndicate Naga copies itself on combat damage, so it doubles every combat. Forge stops at 5,000 triggers in one turn and ends the game as a draw. Not our bug; token grouping (xN) keeps the table drawable.

### P8. Library placeholders merged into the player's restored deck
- **Seen:** after deck r7-01 (2026-10-20 01:51), White's library spot held one unmarked deck: the 32 test cards plus 4 "Library card" placeholders (GMNotes `libcard`). The next game's safety check refused to start, because the deck looked like the player's.
- **Likely cause:** at game end, `restoreStash` puts the player's imported deck back on the library spot. Leftover placeholder cards near that spot get merged in, either by physics or by a late `enginePutInDeck`. The sweep (`sweepEngineCards`) only removes `^engine:` and `enginetrash`, not `libcard`.
- **Why it matters:** with a real player's deck this would add fake "Library card" cards to their deck.
- **Possible fixes:**
  1. Sweep `libcard` objects at game end too.
  2. In `restoreStash`, after putting a deck back, take any `libcard` entries out of it.
  3. Give placeholders `engine:libcard` GMNotes, so every engine sweep catches them.
- **Status:** open. The test cleanup now removes decks made only of test cards and placeholders.

## Not bugs (checker fixed)
- **Grouped tokens reported missing** (Mist-Syndicate Naga copies, 15 checks): identical tokens are drawn as one "xN" card on purpose. The checker now skips `engineGroupOf`.
- **"should be tapped" while turning** (~20 checks): the checker now skips objects that are still moving or turning (`isSmoothMoving`).
- **Fresh draws missing from the hand:** held draws wait on top of the library for the player's click. The checker now skips held draws and mills.
