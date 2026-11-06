# askUnder: status (2026-11-06)

For `docs/core-moves-cleanup-plan.md` "1. askUnder". Bridge only (`bridge/bridge.js`), not deployed: going live needs a
bridge restart between games (the lead). No Lua change, no table push.

Before starting: the review's fixes 1-3 were already in `bridge/bridge.js` (`timeoutChoice` takes `ui.onTimeout`, then
`__back` first; C and D had `onTimeout: "__cancel"`; `extraTurn` reads `isExtraTurn`). Not applied twice.

## What changed, step by step

Each step: golden re-recorded only where the change was meant, every bridge gate green after it.

1. **Photographs (no code change).** 15 new golden cases "askUnder: ..." in `tests/golden/bridge-cases.js` (inside the
   review block, next to the 6 "review askUnder" cases already there). Each makes a list of moves on one priority
   question and records, after each move: what the engine got (with prompt id), cards put back (`refused`), every
   question sent to the panel (id, step, title, options, Cancel flag), and what is open after.
   - Back then Pass on A, B ("Wait"), C and D (Cancel): Pass goes to prompt #900.
   - E (the "Mana: tap X" colour): a timeout, a colour picked.
   - The engine asking again while A, C or E is open.
   - A second gesture while a sub-question is open: a second card dragged on A; Q/E on A then Cancel then Back; Q/E on
     A then a timeout; a two-way card dragged on C; a card dragged on E; Q/E on E.
   - Recorded today's bugs: E timeout tapped the first colour; the engine asking again sent no `refused`; the second
     drag cast Vraska's Fall and left Hurloon Minotaur out; Q/E nested a second sub-question.
2. **One `askUnder(seat, ui, pick, opts)` (behaviour-identical).** Sites A, B, C, D (`onIntent`) and E (`manaChoice`)
   all call it. It adds the Back option, runs `prepareUi` once, keeps the question underneath in
   `seat.prompt.under = { ui, toOutput, step, returns, under }`, and handles Back itself (refused, restore, re-send).
   A toOutput that asked a sub-question returns `ASKED`, and `onAnswer` then sends nothing. The `returns` handling left
   `onAnswer`'s `__next` branch: steps (`next()`) no longer know about askUnder. **Golden byte-equal (1009 of 1009).**
3. **The fixes, one at a time:**
   - **3a C and D: Cancel is a real option `__back` ("Cancel").** Dropped `cancel: true` and `onTimeout: "__cancel"`
     (the panel would have shown two Cancels). 14 cases re-recorded: every case that opens C or D (the prompt sent
     has no `cancel`/`onTimeout`, and has the `__back` option). 5 case inputs changed from `"__cancel"` to `"__back"`
     (the 2 "review askUnder: C/D Cancel" cases and 3 photographs), because that is what the table now sends.
   - **3b E gets Back.** (First without a card to give back; wrong, see round 2 fix 1.) 6 cases re-recorded (every case that opens
     E, plus "chooseAction: mana creature with two colours asks which"), 1 new case "E Back, then Pass". E's timeout now
     takes Back, then Pass: it used to tap the first colour.
   - **3c `onPrompt` puts the card back** when a new engine question replaces an open sub-question (`putBackUnder`,
     first line of `onPrompt`, walks the whole `under` chain). 2 cases re-recorded: "A open / C open, the engine asks
     again" now send `refused` for the card first. 1 case added during the mutation pass ("A open, two questions passed
     by End turn: the card goes back once"), for the paths where `onPrompt` answers by itself and keeps `seat.prompt`.
     (`putBackUnder` left the sub-question open on the panel; replaced in round 2, fix 2.)
   - **3d Back keeps the old step.** The engine's question had no step, so Back now re-sends it with none (was a new
     one). `onAnswer`'s step branch also records the step it sends in `seat.prompt.step` (so a sub-question asked under a step knows it). 16 cases re-recorded: in each, only the one
     re-sent priority prompt changed (`"step":0` -> no step).
   - **3e The nested-gesture rule: refuse.** A gesture (drag, Q/E, any kind) while a sub-question is open is refused
     with "X stays: answer "<question>" first (or Back/Cancel)." The open sub-question stays. 6 cases re-recorded (the
     6 nested photographs).
     - Why refuse, not "put the first card back first": nothing is done in the engine for a gesture made while the
       player had another question in front of them (TTS drags are easy to misdrop); one rule for every gesture kind
       (play, Q/E, attach, sacrifice); no chain to unwind and re-run; Arena's own sub-choices are modal too. The cost
       is one chat line and a card snapping back.

### Round 2: the independent review (2026-11-06)

1. **E's Back and timeout left the card looking tapped.** The table turns the card at the button press
   (`engine-renderer.lua` `optimistic`, "Mana: tap"). E now has `returns: cid`. 3 cases re-recorded (E timeout, E Back
   then Pass, E open / the engine asks again): each gains one `refused` for the card.
2. **A sub-question stayed on the panel after the bridge answered a new question itself** (End turn holding: a late
   Back re-sent #900, Pass answered #900, which the engine had moved past). `putBackUnder` is gone. `onPrompt` now
   starts with `if (seat.prompt?.under) closePrompt(seat)`: the card goes back, the panel is cleared and `seat.prompt`
   is null, so a late Back or Pass on #900 is ignored (`onAnswer` needs an open prompt with that id). 3 cases
   re-recorded ("A / C / E open, the engine asks again", "two questions passed by End turn"): each gains the
   `prompt: null` sent to the panel before the new question.
3. **Other closes left the card out** (mtg skip, auto-resolve, a fix holding the question, a rewind). Chose to do it
   in `closePrompt` itself: `closePrompt(seat, answered)` sends `refused` for an open sub-question's card unless
   `answered`. Why it is safe for every caller:
   - only `onAnswer`'s last line passes `answered`. That is the one place the sub-question's own option is taken, so
     its card goes ahead (cast, or tapped for mana);
   - every gesture path in `onIntent` that calls `closePrompt` comes after the refuse rule, so no sub-question can be
     open there;
   - every other caller (skip, auto-resolve, holdForFix, the rewind check, the auto-pass paths in `onPrompt`) answers
     or ends the engine's question without playing that card, so the card should go back.

   The `under` chain is gone too. A sub-question is never asked under another one: gestures are refused, and E is
   asked only from the priority question's own answer. So R1 (walk only the top of the chain) has nothing left to
   test.
4. **Cases added for the escaped mutants:** a sacrifice drag and an attach drag while A is open (R2, R3), a
   "priority"-kind question while A is open (R11), End turn passing #901 then Back and Pass on #900 (probe 1), mtg skip
   while A is open (probe 2), auto-resolve while A is open on their turn. 6 new cases, 1017 in all.
   - **R8 is equivalent** (the sub-question stores the step of the question under it): nothing reads a sub-question's
     own `seat.prompt.step`. It is read only as `under.step` when a sub-question is asked under it, and that never
     happens. What the table gets is unchanged: the sub-question is still sent with its new step.

What a player sees change: a timed-out sub-question now passes for E too (A to D already did); "which ability?" and
"which mana?" show Cancel as a button in the list instead of the panel's Cancel; the "Mana: tap X" colour question has a
Back button; a new engine question, mtg skip, auto-resolve, a fix or a rewind put a dragged or turned card back at
once, and take the sub-question off the panel; a second gesture while a sub-question is open snaps back with a reason.

## Break-it results

Each mutant is one text change in a copy (`bridge/bridge.askunder-mut.js`, run with `BRIDGE_PATH`, deleted after);
`bridge/bridge.js` itself was never written (sha256 checked after the run). Run against `test_bridge_golden`.

**14 of 14 caught** (13 on the first run; the 14th escaped, got a new case, then was caught).

| Mutant | Result | Caught by (first failing cases) |
|---|---|---|
| S2-1 Back restores the old ui but not the old toOutput | caught | review askUnder A/B/C/D timeout; askUnder: A Back, then Pass |
| S2-2 Back forgets `returns` (no `refused` on Back or Cancel) | caught | play: a two-faced card ... Back; early sacrifice: Wait ...; review C Cancel |
| S2-3 Back re-sends with the wrong prompt id | caught | play: a two-faced card ... Back; early sacrifice: Wait ... |
| S2-4 `onAnswer` does not stop at `ASKED` | caught | chooseAction: mana creature with two colours asks which; askUnder: E timeout (crash) |
| S2-5 Back does not pop the `under` chain | caught | play: a two-faced card asks cast or land; Back, then the land |
| S3a-1 `timeoutChoice` without `__back` | caught | review askUnder: A, B, C, D timeout |
| S3a-2 C's Cancel puts nothing back | caught | review C Cancel; askUnder: C Cancel, then Pass; C open, the engine asks again |
| S3a-3 D has no Cancel option | caught | tapmana: two colours asks; review D Cancel / timeout |
| S3b-1 E has no Back | caught | chooseAction: mana creature with two colours ...; askUnder: E (all 6) |
| S3c-1 `onPrompt` does not put the card back | caught | askUnder: A open / C open, the engine asks again |
| S3c-2 `putBackUnder` does not forget the chain | **escaped**, then caught | new case "askUnder: A open, two questions passed by End turn: the card goes back once" |
| S3d-1 Back sends a new step | caught | play: a two-faced card ... Back; review A/B timeout |
| S3e-1 no nested-gesture rule | caught | askUnder: the 6 nested cases |
| S3e-2 the rule only for drags (Q/E nests again) | caught | askUnder: A open, Q/E ...; E open, Q/E on a two-colour land |

**Round 2 (after the review): 20 of 21 caught, R8 equivalent (argued above).** Same method, on bridge 9aa45af5.
The reviewer's escapes R2, R3 and R11 are now caught; R1 has no target left (the chain is gone).

| Mutant | Result | Caught by (first failing cases) |
|---|---|---|
| S2-1 to S2-5, S3a-1 to S3a-3, S3b-1, S3d-1, S3e-1, S3e-2 (above, re-run on the new code) | all caught | as above |
| N1 E's Back gives no card back (review 1) | caught | askUnder: E timeout; E Back, then Pass; E open, the engine asks again |
| N2 `closePrompt` gives nothing back (review 3) | caught | askUnder: A/C/E open, the engine asks again; mtg skip; auto-resolve |
| N3 `onAnswer`'s close gives the answered card back | caught | chooseAction: mana creature ...; play: a two-faced card ...; early sacrifice: cast ... |
| N4 `onPrompt` does not close an open sub-question (review 2) | caught | askUnder: A/C/E open, the engine asks again; End turn cases |
| N5 `onPrompt` gives the card back but leaves the question open (the old `putBackUnder`) | caught | the same, plus "End turn passes #901, then Back and Pass on #900" |
| R11 the close after the "priority" kind's early return | caught | askUnder: A open, a priority-kind question |
| R2 the refuse rule skips sacrifice drags | caught | askUnder: A open, a sacrifice drag |
| R3 the refuse rule skips attach drags | caught | askUnder: A open, an attach drag |
| R8 the sub-question keeps the step of the question under it | escaped (equivalent) | – |

Final files: `bridge/bridge.js` 9aa45af5..., `tests/golden/bridge-cases.js` 2b5f93f6..., `bridge_golden.json`
d15c1be4... (1017 scenarios; 994 before this work, 23 new).

## Not done

- Plan step 4 (`seat.clearFollowUps()` for `checkRestored`): not in this task's list.
- The timer's chat line still names the sub-question ("ran out of time: Hurloon Minotaur: how do you play it? took its
  default answer") although it now goes back and passes (review, wording only).
- Finding 6 (bridge questions skip `plainQuestion`/`arenaWords`): not touched, nothing reads wrong today.
- Not checked on the real table: the "Cancel" option on C/D (the panel's list shows it like A's Back; read from
  `engine-renderer.lua`, the corner reads only `__cancel`, `__endturn`, `__resolve`, `no`, `mull`).

## Gates

Round 2: all 19 GATES in `tools/deploy.js` green on bridge 9aa45af5..., run one by one, with
`tools/engine-renderer.lua` pristine (34c4d792...) before and after each: test_bridge_golden 1017/1017,
test_bridge_events 226, test_bridge_claims 49, test_bridge_debug 47, test_state_delta 26, test_table_map 450,
test_alignment 71, test_table_check 111, test_table_claims 298, test_table_golden 5 games (1042 steps),
test_table_kind_relation, test_table_board_diff 8, test_table_effects 69, test_engine_json 42, test_table_fix_hand 69,
test_open_items_relations 1316, test_fix_hand_relations 737, test_editor_forward 93, test_moonsharp_patterns 20.

Round 1 note: an earlier full run had red table gates and a hung `test_table_golden`. The renderer was being changed
by the engineCardEntry agent during it, so it does not count. `test_alignment` was red for a while because
`test_table_card_entry` was not yet in GATES; it passes now.

No new gate needed: every new check is a case in `test_bridge_golden`, which is already a gate.

## Hours

About 3 hours for round 1 and 1.5 hours for round 2 (estimated, not measured), about 1.5 of them waiting on mutation and gate runs.

## Round 3: jr-programmer-suite (2026-11-06)

Bridge only, not deployed (a bridge restart between games, by the lead). Same run as trackMarks round 3
(`docs/core-moves/trackmarks.md`).

What changed in `bridge/bridge.js`:
- **`askUnder` returns `ASKED` itself.** `manaChoice` returned it on a line of its own (two ways of saying one thing).
- **`back` is required** (`askUnder(seat, ui, pick, { back, returns })`). Every caller has one; a question with no way
  back is a step (`next()`). The "no back" branches are gone. No behaviour change.
- **Back re-sends the question underneath as it was first sent.** It used to run `prepareUi` on it a second time.
  That was harmless with real names (the wording pass gives the same text twice), but the header promised "exactly as
  it was". Golden unchanged.

Photograph (`tests/golden/bridge-cases.js`, 4 new cases, the old ones unchanged):
- "A open, the game is rewound", "C open, the game is rewound": the card goes back, the panel is cleared (the
  rewind's own close, `checkRestored`, was untested). "A open, a board one turn later": no rewind, the question stays.
- "A open, the engine asks #900 again": the engine asking the SAME question again (a relay reconnect). Added for the
  escaped mutant A7 below.

Claims checks (`tests/test_bridge_claims.js`, new):
- Back on A, B, C, D and E re-sends a message equal to the first one (an Equality relation: no recorded answer).
- Every gesture in `bridge/table-map.js` `GESTURES` (7 kinds) is refused while A is open: the card snaps back with
  the reason, nothing reaches the engine, A stays open. The golden covered 4 of the 7.

Break-it (`bridge/bridge.jrsuite-bridge-mut.js`, deleted after; bridge.js sha256 the same after every mutant):
**14 mutants: 12 caught at once, 2 escaped. A7 was then closed by a new case (13 caught); A3 is equivalent.**
- Caught: Back gives no card back; Back sends a new step (caught by the new Equality check too); askUnder returns
  nothing; timeout without `__back`; the answered card given back; the refuse rule skips discard (**only the new
  claims check caught it**); the refuse line without "(or Back)"; Back option first; E without `returns`; C labelled
  Back; a rewind drops the question without closing it (new cases); Back leaves `under` set.
- A7 (onPrompt closes only a question with a new id): **escaped**, then caught by the new "#900 again" case.
- A3 (Back runs `prepareUi` again): **equivalent**. The wording pass changes only Forge's usernames into seat names
  and `{LIFE}` into "life"; neither can appear in its own output with real usernames ("tts-Blue-…"). A probe with a
  made-up one-letter username did change the text, so the new code is the safer of the two.

Claims audit (askUnder): 10 already tested; 3 true but untested, now tested ("exactly as it was", "every gesture",
"a rewind" closes it); 0 false. One wording fix in this file ("keeps" `seat.prompt.step` meant "records").

Found, not changed (outside this cleanup's code):
- `onAnswer`'s two re-sends after a refused answer, and `resendToTable`, send the open question without its `step`.
  For a sub-question the table's corner then keys it as the question underneath (`engine-renderer.lua` ~2602).
  Small: the 0.6 s click guard may start again. A fix is one spread of `step` in each; it touches `next()` steps too.

Hours: see trackmarks.md round 3 (one run for both).

## Round 4: the independent break-it pass's findings (2026-11-06)

The pass graded the bridge work SOUND (2 real escapes of 46). Closed:
- **A03: Back could store one step and send another.** All sends of an open question now go through one function,
  `showPrompt(seat)`, which sends `seat.prompt` as stored (id, step, ui). New claims check: open, Back, open, Back on
  A and E; the second Back equals the first message. Mutant caught by it and by 17 golden cases.
- **The re-sends dropped the step** (`onAnswer` after a refused answer, twice, and `resendToTable` after a reload).
  Now `showPrompt`. Golden diff: 0 of 1029 old cases; new case "A open, a wrong answer and a reloaded table re-send it
  with its step" (step was null before, 0 now under the tests' frozen clock).
- **False sentence:** the header said the corner shows `__back`. It doesn't (`engineUpdateCorner` shows the first
  option and End turn / Resolve all / No / Cancel). Sentence corrected; code unchanged.

Break-it, round 4: 4 of 4 caught (the stored step, the text board's poison read raw, `showPrompt` without the step,
the old `resendToTable` line). bridge.js sha256 unchanged after each.
