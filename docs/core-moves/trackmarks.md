# trackMarks: status (2026-11-06)

For `docs/core-moves-cleanup-plan.md` "2. trackMarks", steps 1 to 5. Steps 6 (drop the old fields) and 7 (new log
lines) not done, on purpose. Nothing deployed, nothing committed.

Before starting: the review's fix 3 is in. `extraTurn` reads Forge's `isExtraTurn` and guesses only for a board
without it; its case "review trackMarks: the extra-turn header is Forge's isExtraTurn" passes (turn 6 extra, turn 7
plain). Not changed.

Files changed (mine only):
- `bridge/bridge.js`
- `tests/golden/bridge-cases.js` (5 new cases "trackMarks: ...", at the end), `tests/golden/bridge_golden.json`
- `tools/engine-renderer.lua` (`enginePlayerCounters` only)
- `tests/golden/table-run.js` (10 steps added at the END of the 1v1 game; every old step keeps its index),
  `tests/golden/table_golden.json`
- `tests/test_table_claims.js` (one block of 7 checks at the end, "trackMarks")

Working copies and tools in `tmp/core-moves/trackmarks/`: goldens after each step, `mutate.js`, `tdiff.js`,
`logdiff.js`, `allmarks-check.js`, `count-locals.js`, `engine-renderer.before.lua`.

Main-chunk locals in the built Global: 191, unchanged (the one new Lua line is inside the function).

## Step 1: photographs (today's code)

Bridge golden, 5 new cases (1017 -> 1022; the 1017 old ones byte-equal):
- "every mark on both players' rows": every mark set on Blue (upper-case counters) and the AI (lower-case), then the
  monarch and initiative swapped with some marks gone, then none. Records each row's mark fields.
- "every mark changes on one board (the log)": six boards, the log lines of each. Board 1 changes everything at once,
  with a dungeon room.
- "the first board's marks are not said": a first board with every mark says nothing; the next change is said.
- "logEvents with a player the earlier board did not have": today said blessing, story and poison (3 lines).
- "the text board's player rows": poison only.

Table golden: 4 steps at the end of the 1v1 game. A row with poison 3, energy 2, monarch, initiative, blessing,
story and 2 marks (Blue), and poison 1, story, 1 mark (White). Label and width read under both life counters:
`POISON 3   ENERGY 2   MONARCH   INITIATIVE   CITY'S BLESSING   ENDURING STORY   RING TEMPTED 2   YOU CAN'T LOSE
THE GAME @21300` and `POISON 1   ENDURING STORY   SPEED 1 @6425`. Then no marks: both labels go.

## Step 2: `PLAYER_MARKS` for the row

- `PLAYER_MARKS`: one row per mark (`key`, `read`, `label`, later `say`), in label order: poison, energy, monarch,
  initiative, blessing, story, experience, rad, tickets, Ring, speed, turn run by, extra turn, prevent, hand size,
  keywords. `trackMarks(p, pub)` returns `{ values, labels, marks }`.
- `playerMarks(p, pub)` is now the row's mark fields, all from `trackMarks` (sendTable still spreads it; that keeps
  `test_table_map`'s text checks green without editing that test).
- `sendView` reads poison from `trackMarks` too.
- **Golden byte-equal (1022 of 1022).**
- One rule change no case reaches: a negative experience, rad or ticket count was shown, now it is not (Forge never
  sends one).

## Step 3: the log reads the rows

- `logSnapshot` keeps `marks: { playerId: values }` instead of six separate fields.
- `logEvents`: one loop over the rows that have `say`, one guard: the earlier board must have the player.
- 3a, same order as before. **Diff: 1 case**, "logEvents with a player the earlier board did not have": 3 lines ->
  none. This is the one guard. It cannot happen in a real game: the player list stays the same all game, and a
  game's first board is never logged (`updateLog`).
- 3b, the loop in row order, the rooms after it. **Diff: 2 cases, both new photographs; only the ORDER changes**,
  same lines on each board (checked by `logdiff.js`). No old case changed.
  - Log order risk from the plan: on board 1 the room line moves from between initiative and energy to after
    everything. On board 2, energy moves up next to poison. The room still comes after the initiative.
  - The plan missed one more change of order: when several marks change on one board, the lines now come in label
    order (poison, energy, monarch, initiative, blessing, story), not blessing first. No recorded game has two of
    them on one board; "log: an enduring story" has blessing and story together and keeps its order.

## Step 4: one label list, either order of deploy

- Bridge: the row gets `allMarks`, the whole label in order, left out when empty. The old fields stay.
  **Diff: 9 cases**: the 7 with marks, plus "game over: in the game log once" (poison 12). Checked by
  `allmarks-check.js`: with `allMarks` taken off, every case equals the step-3 golden except the photograph that lists
  it. On all 3670 table rows, `allMarks` equals the label the old Lua builds from the old fields (47 rows have
  marks, 0 differ).
- Lua: `enginePlayerCounters` draws `allMarks` when the row has it, otherwise the old way.
- Table golden, 6 more steps at the end of the 1v1 game. Recorded first with the OLD Lua:
  - old fields + `allMarks` (a new bridge on an old table): the same label and width (21300 / 6425);
  - `allMarks` alone (a step-6 bridge): no label on the old Lua.
  Then with the new Lua, **diff: 2 steps**: `allMarks` alone now draws the same label @21300 / @6425.
- `test_table_claims`, 7 checks: old fields alone; none; both (same label and width, once); `allMarks` wins over old
  fields that disagree; `allMarks` alone; a row without `allMarks` again; an empty `allMarks` draws nothing.

## Step 5: break-it and gates

Bridge: 20 mutants on `bridge/bridge.trackmarks-mut.js` (`BRIDGE_PATH`, deleted after), run with
`test_bridge_golden`. **19 of 19 caught; 1 control escaped on purpose** (B20 adds an unused field to the blessing
row: the runner must not call that a catch). bridge.js sha256 the same before and after.

| Mutant | First failing cases |
|---|---|
| B1 story row dropped (plan) | log: an enduring story; trackMarks rows; trackMarks log |
| B2 monarch and initiative rows swapped (plan) | log: monarch and initiative; trackMarks rows and log |
| B3 "RING TEMPTED" written "RING" (plan) | table: player marks; trackMarks rows |
| B4 no "first board" guard (plan) | trackMarks: logEvents with a player the earlier board did not have |
| B5 `say` called on no change (plan) | 619 cases |
| B6 no allMarks / B7 allMarks without the six / B8 marks with the six | 9 cases each |
| B9 a 0 shown | 619 cases |
| B10 EXTRA TURN on a player not taking the turn | table: player marks |
| B11 a hand size of 0 hidden | table: player marks |
| B12 rooms before the marks | trackMarks log |
| B13 every player's marks read from the first player | 7 log cases |
| B14 monarch said when lost / B15 poison gets/loses swapped / B17 energy never said | the log cases |
| B16 text board poison from energy | trackMarks: the text board's player rows |
| B18 "TURN RUN BY" not in capitals | table: player marks |
| B19 the old monarch flag sent as false | 619 cases |

On the plan's mutant "a game whose first board already has a monarch must say nothing": the first board is never
logged (`updateLog` returns while there is no earlier board), so no guard mutant can reach it. B4 is caught by the
"player the earlier board did not have" case instead.

Lua: 5 mutants, each in the renderer text inside a built save (`TABLE_SAVE`); `tools/engine-renderer.lua` never
written (sha256 checked). Run with `test_table_claims` and `test_table_golden`. **5 of 5 caught**: L1 ignores
`allMarks` (plan), L2 shows both, doubled (plan), L3 an empty `allMarks` falls back, L4 one space between marks,
L5 the last mark dropped.

Gates: see the end of this file.

## Not done

- Step 6 (drop the old fields and the Lua fallback): only after both halves are live.
- Step 7 (new log lines for the Ring, speed, a turn run by another player): needs the user's OK.
- Docs I don't own, out of date now: `docs/our-code-reference.md` lines ~1307, 1446, 1450 (`enginePlayerCounters`
  now draws `allMarks`; `playerMarks` is the row's mark fields from `PLAYER_MARKS`).
- `bridge/table-map.js` still says `marks`/`poison`/... for the player facts. Right until step 6; then it should name
  `allMarks`, and `tests/test_table_map.js` line 50 should look for `allMarks` (not my files).

## Going live

- Bridge (steps 2-4): a bridge restart between games. Safe on today's table: the old Lua ignores `allMarks` and
  gets the same old fields (checked above).
- Lua (step 4): a table deploy by the lead, bundled with engineCardEntry's. Safe with the old bridge: the fallback.

## Real-table check (the lead, after both are live)

Look under each life counter (the green label):
1. Poison and energy (any toxic or energy card): "POISON n" first, "ENERGY n" next, gone at 0.
2. Monarch (Palace Jailer) and initiative: "MONARCH" / "INITIATIVE" moves with it.
3. Ascend or storied (if a deck has one): "CITY'S BLESSING", "ENDURING STORY".
4. With two or more marks: three spaces between, the green box as wide as the text, no mark twice.
5. The log: the same lines as before for these; when several change at once, poison and energy come first now.
6. "mtg reset": the label goes.

## Gates

All 19 GATES in `tools/deploy.js` green, run one by one, on bridge.js 6c7168d2... and engine-renderer.lua d26678e2...
(the same hashes before and after the run; log in `tmp/core-moves/trackmarks/gates.txt`): test_bridge_golden
1022/1022, test_bridge_events 226, test_bridge_claims 49, test_bridge_debug 47, test_state_delta 26, test_table_map
450, test_alignment 71, test_table_check 111, test_table_claims 305 (298 + 7), test_table_golden 5 games / 1052
steps, test_table_kind_relation, test_table_board_diff 8, test_table_effects 69, test_engine_json 42,
test_table_fix_hand 69, test_open_items_relations 1316, test_fix_hand_relations 737, test_editor_forward 93,
test_moonsharp_patterns 20. No new test file, so no GATES edit needed.

Note for the engineCardEntry review: if its fixes land in engine-renderer.lua after this, `table_golden.json` must be
re-recorded on top of mine (my 10 new steps are at the end of the 1v1 game).

## Round 2 (after the independent review, 2026-11-06)

The review found no bugs and two small gaps. Only bridge files changed (`bridge/bridge.js` f75f688f...,
`tests/golden/bridge-cases.js`, `bridge_golden.json`: 1024 cases, 2 new, the 1022 old ones byte-equal).

1. **Stale extra-turn flag (review mutant R16 escaped).** New case "trackMarks: Time Warp on yourself, the flag
   stays on in the next player's turn". Blue's `isExtraTurn` stays set through the AI's turn 7, as Forge does. The
   header says "(extra turn)" on turn 6 only, and the label EXTRA TURN shows only on turn 6, under Blue. R16 is now
   caught. No code change was needed: `extraTurn` already reads only the active player's flag.
2. **A counter that isn't a positive number.** In round 1, poison or energy sent as "0", "x" or true showed a mark,
   and so did a negative counter (R13 escaped). Now the five counter rows (poison, energy, experience, rad, tickets)
   have `count: true`, and `markShown(m, v)` shows them only for a number above 0, as the table's own poison and
   energy did. New case "trackMarks: a counter that isn't a positive number shows nothing" ("0", true, -1, "x",
   -2 show nothing; 2 and 3 show). The old row fields are still sent raw, and the old Lua also shows nothing for
   those values. One edge case is left: a counter sent as the string "3" showed on the old table and shows nothing
   on the new one. Forge sends numbers.

Break-it, round 2: **4 of 4 caught**: R16; R13 (a negative counter shown); R13b (a counter that isn't a number
shown); R13c (the count rule dropped). The bridge sha256 was the same before and after.

Gates, round 2: all 19 GATES green, run one by one, with bridge.js f75f688f and engine-renderer.lua 0a30ddd3 (the
engineCardEntry round 2 version), the same hashes before and after (log: `tmp/core-moves/trackmarks/gates-round2.txt`).
Results: test_bridge_golden 1024/1024, test_table_claims 315, test_table_golden 5 games / 1065 steps, the rest as in
round 1.

## Hours

About 3 hours (photographs 1 h, steps 2-4 1.25 h, mutation passes and gates 0.75 h; estimated, not measured).

## Round 3: jr-programmer-suite (2026-11-06)

Bridge only (`bridge/bridge.js`), not deployed. Step 6 is still not done: the old row fields stay, because the Lua
fallback that reads them is the renderer's to remove (another agent, same night). Same run as askUnder round 3.

What changed:
- **One reading of a number mark.** Round 2 put the "positive number only" rule in `markShown` (`count` rows), but the
  log's `say` and the old row fields still got the raw value: poison `"0"` was sent as `"0"`, `true` as `true`, and a
  `-1` would have been said as "loses 1 poison counter (-1 in all)". Now `read` gives a positive number or 0
  (`positive`, `counterOf`), for the five counters and for the Ring, speed and prevention. `count` is gone;
  `markShown(v)` is one rule. The comment's promise "poison and energy as numbers" was false before; it is true now.
  - Golden: 1 case changed, "a counter that isn't a positive number shows nothing": only the old fields
    (`poison: "0"` -> 0, `energy: true` -> 0, `poison: -2` -> 0). The labels are the same.
  - Changed for inputs Forge does not send: a Ring, speed or prevention of `"3"` or `true` showed ("RING TEMPTED
    true"); now nothing.
- **The extra-turn header reads the row.** `isExtraTurn` was read twice (the row and `extraTurn()`). The row's value is
  now Forge's flag for the active player (undefined when the board has none); `extraTurn(prev, cur)` reads
  `cur.marks`. Golden unchanged.
- **A controller that isn't text no longer crashes the board.** `controlledBy: 5` threw in `toUpperCase`, so no board
  went out (the old code recorded a TypeError on the new case). Now `String(...)`.

Photograph: 1 new case "trackMarks: the Ring, speed, prevention and a controller that aren't plain".
Claims check (`tests/test_bridge_claims.js`): for every pair of 9 poison values (3, "3", "0", true, -1, "x", null, 0,
2), the old field is a number, the label shows `POISON n` exactly when it is above 0, and the log has a poison line
exactly when it changed (81 pairs, with preconditions that some pairs say a line and some do not).

Break-it: **14 mutants, 12 caught, 2 escaped, both equivalent.**
- Caught: `positive` by truthiness; counters read raw; EXTRA TURN on a flagged non-active player; the header's flag by
  truthiness; the header reading the earlier board; no `String` (a TypeError, by name); the old poison read raw; hand
  size by truthiness; `allMarks` always sent; keywords not flattened; the log guard by value; speed by truthiness.
- T3 (`n >= 0`): equivalent. 0 gives 0 either way, and 0 shows nothing.
- T13 (energy's `n > was` as `n >= was`): equivalent. `say` is called only when the value changed.

Claims audit (trackMarks): 7 already tested; 2 true but untested, now tested (the label, log and old field agree; a
controller that isn't text must not stop the board); 1 false, CODE fixed ("poison and energy as
numbers"). Untestable: "read once by the extraTurn row" (an only-place claim; today `isExtraTurn` is read in one place)
and "Forge keeps the flag on the player after the turn" (Forge's behaviour, from the review).

Docs: `docs/our-code-reference.md` has a new section "Core moves: askUnder and trackMarks, bridge half"; its rows on
"how do you play it?" Back and `playerMarks` are updated. `bridge/table-map.js` says every mark is also in `allMarks`.
Not mine and still stale: `docs/our-code-reference.md` table rows for `enginePlayerCounters` (~line 1307: "poison and
energy as one label"; ~1450: "the marks join the label") should say it draws `allMarks`, with the old fields as the
fallback.

Gates: see the end of the lead's report (all 19 GATES run one by one).

Hours: about 2.5 for both askUnder and trackMarks round 3 (estimated, not measured), about 1 of it waiting on the
mutation run and the gates.

## Lua (jr-programmer-suite, 2026-11-06)

Renderer only (`tools/engine-renderer.lua`), not deployed. Scope: enginePlayerCounters, which draws `pl.allMarks` and falls back to the old fields.

- **Code:** unchanged. The fallback comment now says both halves are live since 2026-11-06 and that removing the fallback goes with step 6.
- **Claims:** "an allMarks that is not a list is drawn the old way" was true but untested. It is now tested in tests/test_table_claims.js (`allMarks: "POISON 9"` with poison 2 draws `POISON 2`, with no error).
- **Break-it, Q28–Q32:** 5 of 5 caught.
  - allMarks ignored.
  - allMarks and the old fields both drawn.
  - An empty allMarks falls back.
  - The last mark dropped.
  - Truthiness instead of the type test. This one escaped in round 1; the new check catches it.
- **Docs:** the `docs/our-code-reference.md` rows at ~1307 and ~1450 now say it draws `allMarks`, with the old fields as the fallback. That closes the "not mine and still stale" note above.

## Round 4: the independent break-it pass's findings (2026-11-06)

- **T21: the text board's poison read raw escaped.** The code already reads it through the row (`trackMarks`, so
  `positive`); nothing checked it. New claims check: poison "0", "3", true, -1 and 2 on the text board give 0, 0, 0,
  0 and 2. The mutant is caught by name.
