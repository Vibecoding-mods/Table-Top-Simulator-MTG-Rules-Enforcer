# Plan: the last three "core moves" cleanups (askUnder, trackMarks, engineCardEntry)

Written 2026-11-05 evening for PLAN.md "Still to move onto the core moves" (the three ⬜ items) and SPEC §4a.
No code was changed for this plan.

**Line numbers** are as read on 2026-11-05 evening. Other agents were editing `bridge/bridge.js` and
`tests/golden/bridge-cases.js` at the same time (bridge lines moved by about 17 while this was written), so search by
the function name given next to each number. `tools/engine-renderer.lua` moved too during the review (by about 300
lines below line 1900, e.g. `engineClear` 1621 -> 1956, `engineTakeFromPiles` 4238 -> 4547): search by name there as well.

**Reviewed 2026-11-05** by a second agent: see "Review 2026-11-05" at the end. Two askUnder bugs and the extra-turn
header bug are proven by test, with small fixes that can land before the refactor.

Words used below:
- **golden** = a recorded "photograph" test (`tests/test_bridge_golden.js`, `tests/test_table_golden.js`): it replays
  cases and fails on any change in output.
- **mutant** = a deliberate small break in the code, made by hand and reverted, to prove a test notices it.
- **gates** = the test commands listed in the agent rules; all must pass after every step.
- **sim** = the fake TTS in `tests/lua/tts-sim.lua` that the table tests run on.

Order and size, in short:

| Order | Item | Where | Core hours | Optional |
|---|---|---|---|---|
| 1 | askUnder | bridge only | 8.5 | – |
| 2 | trackMarks | bridge, then one small Lua change | 7.5 | +2 (new log lines) |
| 3 | engineCardEntry | Lua only | 8 | – |
| | **Total** | | **24** (about 3 working days) | |

---

## 1. askUnder: a question asked while another one is open

### What it means

The bridge sometimes asks the player its own small question while an engine question is still open, and it is not
the engine's next step. Example: you drag a two-faced card onto the battlefield while you have priority; the bridge asks
"how do you play it?" (cast or land). The engine's priority question stays open underneath. The answer either goes to
the engine, or "Back" returns to the question underneath.

This is different from **steps** (`next()`, bridge.js:3248, used by `orderSteps` 3254, `damageSteps`, `scryPlaceSteps`):
steps split one engine question into parts and have no way back. They already share one mechanism and are not touched.

### Today: every place that does it

All in `bridge/bridge.js`. Each site copies the open question by hand, builds its own toOutput and sends its own
`toTTS({ t: "prompt", ... step })`.

| # | Site | Function, line | Back option | Card put back on Back? |
|---|---|---|---|---|
| A | "X: how do you play it?" (two-faced, adventure, split, alternative costs) | `onIntent` "play", 5230-5252 | `__back` "Back" | yes, `returns: m.id` |
| B | "X: cast it now?" (Necromancy outside main phase) | `onIntent` "play", 5260-5266 | `__back` "Wait (keep it)" | yes |
| C | "X: which ability?" (Q/E on a card with two {T} abilities) | `onIntent` "tapmana", 5314-5318 | `cancel: true` flag, no option id | no |
| D | "Tap X for which mana?" (Q/E on a land with two colours) | `onIntent` "tapmana", 5323-5327 | `cancel: true` flag, no option id | no |
| E | "Tap X for which mana?" (the "Mana: tap X" button at priority) | `chooseAction` `manaChoice`, 3798-3803 | none (it is a `next()` step) | – |

How Back works today:
- A and B return `{ __next: { ...prev, returns } }`; `onAnswer` (5403, the `__next` branch at 5428-5434) sends
  `refused` for the card, re-runs `prepareUi` on the old question and re-sends it with a new `step` number.
- C and D do `Object.assign(seat.prompt, back)` **and** return `next(back.ui, back.toOutput)`: the open question is
  restored twice, by two different means.
- E has no way back.

The timer (`timerExpired` 5101, `timeoutChoice` 5095) answers whatever is on screen, step by step, up to 12 times.
`timeoutChoice` prefers `__pass`, `keep`, `__cancel`, `__auto`, `__keep`, `auto`, `ok`, `no`, else the **first option**.

### Where they disagree (bugs)

1. **Real, PROVEN by test (review): a timeout during A, B or C does the thing the player did not choose.** With turn
   timers on ("mtg timer"):
   - A: options are `[way 1, way 2, __back]`, none preferred, so the first way is picked: the dragged two-faced card
     is **cast** (or played) when the clock runs out.
   - B: options are `[Cast anyway, __back]`: Necromancy is **cast outside the main phase** and will be sacrificed.
   - C: the first {T} ability is **used** (a fetch land pays 1 life and sacrifices itself).
   - D, E: the land is tapped for the first colour (small harm: the mana floats and empties).
   - `timeoutChoice`'s own comment says "the safest legal answer"; the safe answer here is Back, then the priority
     question's own default, Pass.
2. **Real (bridge half PROVEN by test, table half read from the code): Cancel on C or D leaves the card drawn
   tapped.** The table turns the
   card at once when Q/E is pressed (`tapGesture`, engine-renderer.lua:3599-3605 and 3639) before the bridge asks.
   Cancel sends no `refused`, so nothing redraws the card until the next board update. At a quiet priority (nothing
   changing) the land looks tapped until the player does something else. A and B send `refused` and redraw at once.
3. **Same question, three versions.** "Tap X for which mana?" comes from D (with Cancel), E (no way back) and the
   engine's own colour question in `chooseColor` (4718, which is an engine prompt and stays as it is).
4. **Low: a new engine question that replaces an open bridge question** (`onPrompt` 5058 sets `seat.prompt` over it,
   for example the engine asking again after a reconnect) does not put the dragged card back. It heals itself at the
   next board update (the table clears `engineManual` for a card still in the hand, engine-renderer.lua:1491).
5. **Minor: Back re-sends the old question with a new `step`**, so the table's corner keys it as a new question
   (engine-renderer.lua:2218; its 0.6 s guard against clicks on changed words can start again). Harmless today.
6. **Minor: the bridge's own questions skip the wording pass** that engine questions get at the end of `onPrompt`
   (`plainQuestion`, the "Card: question" prefix, `arenaWords`); they only get `prepareUi`. The titles are written by
   hand already, so nothing reads wrong today.

Not in this item, but found on the way: `checkRestored` (6140, the reset after a rewind) clears follow-up fields by a
hand-kept list (6164-6181). It does not list `textWord`, `smartPay`, `autoPayFailedFor` or `mustAttack`. No wrong
behaviour was found from that (each is cleared by the next question of another type, or is keyed by prompt id), but a
new field added later can be forgotten the same way.

Engine questions asked inside another engine question (a colour while paying, Abundance's look, Sylvan Library's pick
after No) are **not** this item. They use the follow-up memory `lately` (`note` / `justDid` / `forget`, bridge.js:423)
and the payment fields, which the 2026-10-20 structural review (finding 2) kept apart on purpose.

### Target: one function

```js
// Ask the player a question of the bridge's own while the engine's question stays open underneath. Back (and a
// timeout) returns to that question exactly as it was; the card the gesture moved is put back on the table.
// opts: { back: "Back" | "Cancel" | "Wait (keep it)", returns: cardId | null }
function askUnder(seat, ui, toOutput, opts = {}) -> void
```

Data kept on the seat (no new seat field: it lives inside `seat.prompt`):

```js
seat.prompt = { ...under, ui, toOutput: wrapped, under: { ui, toOutput, step, returns } }
```

What it does, once for every caller:
- adds the Back option as a real option id `__back` (label from `opts.back`), so the panel, the corner and the timer all
  see it the same way;
- on `__back`: sends `refused` for `opts.returns` (if any), restores `under.ui`, `under.toOutput` and the old `step`,
  re-sends that question;
- otherwise calls the caller's `toOutput`;
- runs `prepareUi` once.

Changes around it:
- `timeoutChoice`: `__back` goes first in the preference list. The timer loop then takes Back, and on the next turn of
  its loop answers the priority question with `__pass`.
- `onPrompt`: when it replaces a `seat.prompt` that has `under.returns`, it sends `refused` for that card first.
- Callers: sites A, B, C, D in `onIntent`, and E in `manaChoice` (E gets a Back button; this is the one new button).
- `tapGesture` (Lua) is not changed: `refused` already makes the table redraw the card (engine-renderer.lua:3269-3276).

Also (small, same step as the rewind list): one `seat.clearFollowUps()` method on `Seat` that holds the list from
`checkRestored`; `checkRestored` and `resetGame` call it. The four fields listed above are added to it.

### Steps

Each step lands with all bridge gates green (`test_bridge_golden`, `test_bridge_events`, `test_bridge_claims`,
`test_bridge_debug`).

1. **Photograph first (2 h).** New cases in `tests/golden/bridge-cases.js`, recorded with today's behaviour:
   - timeout during A, B, C, D and E (`_timerExpired` with `game.timer.on`): which response the engine got;
   - Cancel on C and D: whether a `refused` was sent, what `seat.prompt` is after;
   - Back on A then Pass: the response is `pass` with the right prompt id;
   - a new `onPrompt` while A is open: what the table was sent.

   These record today's bugs on purpose; step 3 changes them, and the change is read line by line.
2. **`askUnder` with no change in behaviour (2 h).** Move A to E onto it, keeping each site's exact labels, the
   `cancel` flag on C/D, and E without Back. The golden must not change at all. Mutants that must fail the golden:
   - Back restores the old `ui` but not the old `toOutput`;
   - Back forgets `returns` (no `refused` for A/B);
   - Back re-sends with the wrong prompt id.
3. **The fixes, one at a time (2.5 h).** Each is its own golden diff, read and accepted on its own:
   - timeout prefers `__back` (A, B, C, D, E now end in Pass);
   - C and D get `__back` as a real option (label "Cancel"), and Cancel sends `refused`, so the card turns back at once;
     drop their `cancel: true` flag in the same change, or the panel shows two Cancel buttons (its own `eng_cancel`
     button follows the flag, engine-renderer.lua `p.cancel`, about line 2644). If the tonight fix (review, fix 2) has
     landed, only the option/flag swap is left here;
   - E gets Back;
   - `onPrompt` puts the card back when it replaces an open bridge question;
   - Back keeps the old `step` (finding 5).

   Mutants: remove `__back` from `timeoutChoice` (the timeout cases must fail); drop the `refused` on Cancel.
4. **`clearFollowUps` (1 h).** One golden case: a rewind with every field set, then all of them empty. Mutant: leave
   one field out of the list.
5. **Mutation pass and gates (1 h).** Run the mutants above, record the grade in PLAN.

### Risks

- Lua 194/200 locals: none. This is bridge-only.
- TTS performance: none new. Cancel now sends one `refused`, which causes one table redraw (`snapBack`), the same as a
  refused drag does today.
- What a player sees change: a timed-out sub-question passes instead of casting or tapping; Cancel turns the land back
  at once; the "Mana: tap X" colour question gets a Back button. The panel and the corner already show a Back/Cancel
  button, so no layout work.
- Going live needs a bridge restart (between games, by the lead). No table push.

---

## 2. trackMarks: the marks under a player's life total

### What it means

Forge sends facts about each player that change the game: poison, energy and other player counters, the monarch, the
initiative, the city's blessing, an enduring story, the Ring's temptations, speed, a turn run by another player, an
extra turn, damage prevention, hand size, and keywords on the player. The table shows them as one green label under the
life counter; the log says some of them when they change.

### Today: every place that does it

Bridge (`bridge/bridge.js`):
- `sendTable` row, 2475-2481: `poison` and `energy` as numbers, `monarch`, `initiative`, `blessed`, `story` as
  booleans, then `...playerMarks(p, pub)`.
- `playerMarks`, 2630-2650: everything else as finished text in `marks` (EXPERIENCE, RAD, TICKETS, RING TEMPTED,
  SPEED, TURN RUN BY, EXTRA TURN, PREVENT, NO MAX HAND SIZE / MAX HAND, the player's keywords).
- `logSnapshot`, 1328-1333: reads `blessed`, `story`, `poison`, `energy`, `monarch`, `initiative` again, its own way.
- `logEvents`, 2229-2252: says blessing, story, poison, monarch, initiative, (venture rooms), energy, day. Four
  different "first board" guards: none (blessing), `prev.story &&`, `prev.monarch !== undefined`, `was == null`.
- `extraTurn`, 1587-1590, and the turn header at 1598: guesses an extra turn from who had the turn before
  (`game.turnOwners`).
- `sendView`, 3208 (the text board for non-table games): poison only.
- `LOSS_REASONS`, 2598: poison (for the end-of-game message; a different job, stays).
- `playerCounter`, 2625: reads a counter spelled either way. Shared by all of the above.

Table (`tools/engine-renderer.lua`):
- `enginePlayerCounters`, 794-824: words six of the marks itself ("POISON n", "ENERGY n", "MONARCH", "INITIATIVE",
  "CITY'S BLESSING", "ENDURING STORY"), then appends the bridge's `marks`; sizes and draws the label.
- `ENGINE_COUNTERS_TIP`, 784 (the tooltip), `engineCountersReset`, 787 (clears it after a game), called from
  `updateTrackers`, 757.

Harness: `InteractiveSnapshotExtractor.java` 303-324 sends the player fields; `playerCounters` 384-390 sends only
poison, energy, experience, radiation and ticket. No harness change is needed.

### Where they disagree (bugs)

1. **Real, PROVEN by test (review): the extra turn is said two ways.** The label uses Forge's `isExtraTurn`; the log header guesses from turn
   order. Case: 4 players White, Red, Yellow, Blue; White casts Time Warp on Red. Red's extra turn follows White's, so
   the guess says a plain turn; Red's normal turn then follows Red's own, so the guess says "(extra turn)" on the wrong
   one. The label under Red's life is right both times. SPEC §4a says not to guess what the engine says.
2. **Two owners of the wording.** Six marks are worded in Lua, the rest in the bridge. Changing "CITY'S BLESSING"
   needs a table push (the risky Save & Play path), the others only a bridge restart. The label's order is fixed by the
   Lua code, not by one list.
3. **The same Forge fields are read three times** (row, log snapshot, text board), each with its own code.
4. **Most marks are never said in the log**: the Ring tempting you, speed, experience, rad, tickets, a turn run by
   another player, prevention, hand size, player keywords. Same kind of gap as the hp-11/16/17/21 fixes for poison,
   energy, monarch and blessing.
5. **Minor: four styles of "first board" guard** in `logEvents` (listed above). None is wrong today because `prev`
   always comes from the same process, but each new mark picks a style by chance.

### Target: one table of marks in the bridge

```js
// One row per player mark: how it is read from Forge's player, how the label under the life total says it, and
// (optionally) the log line when it changes. The order of the rows is the order of the label.
const PLAYER_MARKS = [
  { key: "poison", read: (p) => playerCounter(p, "poison"), label: (n) => `POISON ${n}`,
    say: (who, n, was) => (n > was ? `${who} gets ${countWords(n - was, n - was, "poison counter")} (${n} in all)` : ...) },
  { key: "energy", ... }, { key: "monarch", read: (p, pub) => pub.monarchId === p.id, label: () => "MONARCH",
    say: (who) => `${who} becomes the monarch` }, // ... initiative, blessed, story,
  // then today's playerMarks order: experience, radiation, ticket, ring, speed, controlledBy, extraTurn, prevention,
  // hand size, keywords (a row may give a list of labels: keywords)
];
function trackMarks(p, pub) -> { values: { [key]: value }, labels: string[] }
```

Rules the rows follow:
- a value of `0`, `false`, `null` or `[]` shows nothing;
- `say(who, now, was)` is called only when the value changed **and** a previous board had the row (one guard for all);
- the row order equals today's label order, so the label text and width do not change.

Who calls it:
- `sendTable`: `allMarks: labels` on each player row (plus the old fields for one release, see step 4);
- `logSnapshot`: `marks: { [playerId]: values }`;
- `logEvents`: one loop over the rows that have `say`, replacing 2229-2240 and 2246-2250; the venture-room lines move
  to just after the loop (see risks);
- `sendView`: `marks: labels` instead of `poison` alone (text board only).

Table, after: `enginePlayerCounters(o, pl)` joins `pl.allMarks` and draws; it keeps its six readers only as the
fallback for a bridge that sends no `allMarks`, and drops them in step 6.

Not in the table of marks: day and night (a game fact, shown beside the turn, `sendTable` 2520), life, commander damage
and commander tax (their own counters on the table).

### Steps

Gates: the bridge gates for steps 1-3 and 5; `test_table_golden`, `test_table_claims` for step 4 and 6.

1. **Photograph first (1.5 h).**
   - Bridge golden: one case with every row set on two players (poison 3, energy 2, monarch, initiative, blessing,
     story, plus today's `playerMarks` inputs), recording each row sent to the table, then one board where each value
     changes, recording the log lines. Today's cases "table: player marks", "log: monarch and initiative", the blessing,
     poison, energy and story cases stay.
   - Table golden: a step that sends a player with `poison`, `energy`, `monarch`, `initiative`, `blessed`, `story` and
     `marks` set, and records the label and its width (the existing "notes ... player marks" step in
     `tests/golden/table-run.js` covers only `marks`; the recorded game streams only ever have poison 0 and energy 0).
2. **`PLAYER_MARKS` for the row (1.5 h).** `playerMarks` and the six row fields come from `trackMarks`. Golden
   unchanged. Mutants: drop the `story` row; swap two rows; "RING TEMPTED" written "RING".
3. **The log reads the rows (1.5 h).** `logSnapshot` and `logEvents` use the rows' values and `say`. Golden unchanged
   except, possibly, the order of a venture line and an energy line on the same board (read it; see risks). Mutants:
   no "first board" guard (a game whose first board already has a monarch must say nothing); `say` called on no change.
4. **One label list for the table, either order of deploy (1.5 h).** The bridge adds `allMarks` (the whole label
   list) and keeps the old fields. Lua uses `allMarks` when it is there, else the old way. Old table + new bridge: the
   old Lua ignores `allMarks`, same as today. New table + old bridge: the fallback. The table golden step from step 1
   must give the same label and width when fed the new row. Mutants: Lua ignores `allMarks`; Lua shows both (doubles).
5. **Mutation pass and gates (1 h).**
6. **After both are live (0.5 h, later):** remove the old six fields from the row and the Lua fallback. Table golden
   unchanged.
7. **Optional, needs the user's OK (2 h): new log lines.** Rows get `say` for the Ring ("X is tempted by the Ring
   (2)"), speed, a turn run by another player, and the extra-turn header reads `isExtraTurn` instead of the guess. First
   check on the 9444 test stack that Forge's `isExtraTurn` is true for the whole extra turn and false after (memory
   rule: read the live engine, do not guess). Each line is a golden diff read on its own.

### Risks

- Lua 194/200 locals: none added. `enginePlayerCounters` is a global function; it gets shorter.
- TTS performance: `allMarks` adds a few short strings per player per board while the old fields stay (step 4 to 6).
  Player rows are not zones, so the bridge's "unchanged zone" trimming does not apply to them; the cost is a few dozen
  bytes per board, against 1.5-4.7 KB boards today. The label is redrawn only when its text changes
  (`engineCountersShown`), as now.
- Log order: today a venture line sits between the initiative and energy lines (2242-2244). Taking the initiative also
  ventures, so the rooms must stay **after** the initiative line; moving them after the whole loop only changes the
  order when energy and a room change on the same board. The golden shows whether any recorded case does.
- What a player sees change: nothing in steps 1-6. Step 7 adds log lines and fixes the extra-turn header (Time Warp on
  another player).
- Going live: steps 2-3 need a bridge restart; step 4's Lua half needs a table deploy (`tools/deploy.js`, TTS closed,
  by the lead; never Save & Play with decks on the table). Bundle it with the engineCardEntry deploy.

---

## 3. engineCardEntry: one way a card object is made on the table

### What it means

Every engine card the table shows is a TTS object whose GM notes say `engine:<card id>`. The table keeps bookkeeping
per card id (`engineObjs`, `engineFace`, `engineBadge`, `engineSpawning`, `engineInPile`, `engineHeld`,
`engineStackGlow`). An object becomes "card X's object" in several ways, and each way does its own part of that
bookkeeping.

### Today: every place that does it

All in `tools/engine-renderer.lua`.

Making the card's data (what TTS spawns):
- `engineCardData`, 189-199: one card; `Locked = true`, `Tags = { "engine" }`, its own transform literal.
- `libraryDeckData`, 3905-3923: search candidates inside the library deck, built inline (3912-3913); back is always the
  plain back; no `Locked`, no `Tags`. Also `backDeckEntry`, 3901-3903, a copy of `deckEntry(ENGINE_BACK, ENGINE_BACK)`.
- `engineZonePile`, 4370-4384: graveyard and exile pile members, built inline (4377-4379), no `Locked`, no `Tags`.
- The trash card (178), the library's plain backs ("libcard", 3917 and 4087), the one-card library (4106) and the mill
  stand-ins (`engineMillFly`, 4034, GM notes "enginefx") are not engine cards; they stay as they are.

Making an object card X's object:
1. `place`, 404-433: spawns from `engineCardData`; the callback (419-432) sets `engineSpawning` nil, `engineObjs`,
   `engineStackGlow` nil, `engineFace` (from the board's card), `engineBadge` nil, draws the badge, sets lock and the
   half scale for attached cards, and calls `engineGlowLate`.
2. `engineAdopt`, 239-245, from four callers: a search card pulled out of the library (4145), a card the engine moved
   out of a pile (`engineTakeFromPiles`, 4268), the last card left of a pile deck (4277), a pile card picked for an open
   question (4450). It sets `engineObjs`, `engineSpawning` nil, `engineFace` (from `engineStatic`), `engineInPile` nil,
   `engineHeld`.
3. `addToPile`, 4231-4232: spawns a card only to put it straight into a pile deck (not registered; correct).
4. `onObjectSpawn`, 3838-3850: the watcher that throws away any engine object that is not expected. Its test (3842)
   lists the flags the ways above set: `engineSpawning`, `engineObjs`, `engineSearchIds`, `engineInPile`.

`engineAdopt` itself was the last cleanup of this kind: its comment (235-238) says it replaced four copies, two of
which did not record the face, and a tutored card was thrown away and spawned again.

### Where they disagree (bugs)

1. **Likely real: a creature returned from a pile can come back without its badge.** `engineAdopt` does not reset
   `engineBadge`; the spawn path does (428). `addToPile` keeps the old value when the card goes into a pile. When the
   card comes back out (`engineTakeFromPiles` -> `engineAdopt` -> `place` -> `updateBadge`) and its badge text is the
   same as before it died, `updateBadge` (349) returns early and draws nothing on the new object. Case: Serra Angel
   (status box "Flying, Vigilance", its own keywords) is destroyed untapped while its owner's graveyard already holds a
   card, then Reanimate returns it: no status box. Same for a P/T box raised by an anthem that is still there. The sim
   loses buttons through put/take (`M.putObject` copies `getData`, no buttons), so a table golden step will show it;
   whether real TTS keeps script buttons on a card through putObject/takeObject is not checked.
2. **Doubtful as stated (review): no game check in `place`'s spawn callback.** (See the review: the sweep most likely
   catches the spawning object; the gap is a late callback touching a trashed object.) `engineZonePile` (4388) and `addToPile`'s check (4191)
   skip a callback from an earlier game (`engineGen`); `place` (419) does not. Case: "mtg reset" while the first board
   of a game is still spawning. `engineClear` (1621) has already swept the table and emptied `engineObjs`; the late
   callbacks then register the old objects, and with no new game they stay on the normal table as engine cards.
3. **Minor: a searched double-faced card records the wrong back.** `engineAdopt` takes the face from `engineStatic`
   (its real back) while a search-deck card has the plain back (3911). Only seen if its owner flips it on the table.
4. **Three builders of one card's data**, with different `Locked`/`Tags`/back rules (see above). Nothing reads the
   `engine` tag today (searched the renderer and tests), so the difference has no effect yet.
5. **The expected-object test in `onObjectSpawn` must know every way.** A new way that forgets a flag gets its object
   thrown away as a stray, the kind of loss `engineAdopt` was made to stop.

### Target: one function for the bookkeeping, one for the data

```lua
-- The one way an object becomes engine card `id`'s object on the table: just spawned (from engineCardSpawn), or taken
-- over (pulled from a pile or a search, what is left of a pile deck). c: the board's card when known (else
-- engineStatic[id]); opts: { held = true (the player just took it), meta = { zone, color } }
function engineCardEntry(id, obj, c, opts)
--   engineObjs[id] = obj; engineSpawning[id] = nil; engineInPile[id] = nil
--   engineFace[id] = face the OBJECT shows (from the data it was made with)
--   engineBadge[id] = nil; engineStackGlow[id] = nil   (a new object: badge and glow are drawn again)
--   if opts.held then engineHeld[id] = os.clock() end
--   if c and opts.meta then updateBadge(obj, c, opts.meta.zone), lock, attached scale end
--   engineGlowLate(id)

-- Spawns engine card c's object and enters it; a callback from an earlier game throws its object away.
function engineCardSpawn(c, pos, rot, opts)

-- engineCardData(c, how): how = nil (a card on its own: Locked, Tags, as today) | "inside" (a member of a pile or the
-- library: no Locked, no Tags) | "search" (inside, with the plain back)
```

Who calls them:
- `place` (418) calls `engineCardSpawn`;
- the four `engineAdopt` callers call `engineCardEntry`; `engineAdopt` stays one release as a one-line alias, then goes;
- `libraryDeckData` and `engineZonePile` build their members with `engineCardData(c, "inside" / "search")`;
- `backDeckEntry` is removed (it is `deckEntry(ENGINE_BACK, ENGINE_BACK)`), and the one `FLAT` transform (3900) moves
  up above `engineCardData` and is used by all builders.

Not changed: the order of operations around `takeObject` (adopt right after it returns, before TTS's own spawn event
reaches `onObjectSpawn`), the trash, the libcard backs, the mill stand-ins, `onObjectSpawn`'s test.

### Steps

Gates: `test_table_golden`, `test_table_claims`, `test_table_board_diff`, `test_table_kind_relation`,
`test_table_map`, `test_table_check`, `test_alignment`.

1. **Photograph first (2.5 h).** New table golden steps in `tests/golden/table-run.js`, recorded with today's code:
   - a creature with a status box dies into a graveyard that already holds a card, then returns to the battlefield
     (`engineTakeFromPiles`): record its buttons (today: none, the bug);
   - the same with a P/T box under an anthem;
   - "mtg reset" (`engineClear`) one frame after a board starts spawning: record which engine objects are left;
   - a search: a card pulled from the library deck, then placed on the battlefield (the face it records).

   Plus a `test_table_claims` check that pile and library members have no `Locked` and no `Tags`.
   First check whether the recorded game streams already contain a card leaving a 2+ card pile; if they do, note the
   step, the new case is still needed for the badge.
2. **`engineCardEntry`, no change in behaviour (2 h).** `place`'s callback and `engineAdopt` both call it, keeping each
   one's exact bookkeeping (badge reset only on spawn for now). Golden unchanged; every spawnObjectData line, its
   CardID and CustomDeck keys must be identical (the sim records them). Mutants: entry does not set `engineFace` (the
   next board respawns the card: more spawn lines); entry does not clear `engineInPile`.
3. **The two fixes (1 h).** Badge and glow reset for every entry (finding 1); the game check in the spawn path
   (finding 2). Each is one golden diff, read on its own. Mutants: remove the badge reset; remove the game check.
4. **One data builder (1.5 h).** `engineCardData(c, how)`, `backDeckEntry` removed, one `FLAT`. Golden unchanged
   (same keys, same CardIDs, same contained counts). Mutant: `Locked = true` on members (the claims check fails).
5. **Mutation pass and gates (0.5 h).**
6. **Real table check (0.5 h, the lead, with the user's standing OK for TTS use).** After the deploy, one game on the
   real table: a creature with a keyword box reanimated from a 2+ card graveyard shows its box; draws, mills, a
   search and a pile pick still work; no PresentMon run needed unless frames feel worse.

### Risks

- **Lua 194/200 main-chunk locals** (luaparse counts 180 in `engine-renderer.lua` alone; the rest are in the table
  script it is appended to). `engineCardEntry` and `engineCardSpawn` are globals, like `engineAdopt`. Removing
  `backDeckEntry` frees one local. Moving `FLAT` keeps the count. Net: one fewer.
- **TTS performance:**
  - Spawns: no new spawn and no new dispose. The golden records every spawn's CardID and CustomDeck keys, so a change
    shows. Disposing goes to the trash deck (free); `destruct()` (about 360 ms each) is never added.
  - Snapshots: CustomDeck numbers still come only from `engineDeckKey` (small sequential keys from 3000). Pile and
    library members get no `Tags`, so the saved table does not grow.
  - The badge reset redraws buttons once on each card taken out of a pile: a few `createButton` calls, once.
- **Real TTS can differ from the sim** in when `onObjectSpawn` fires after `takeObject`. The step keeps today's order
  exactly; the real-table check in step 6 covers it.
- What a player sees change: a creature brought back from a pile shows its badge (fix); no leftover cards after a reset
  during a board draw (fix). Nothing else.
- Going live: a table deploy (`tools/deploy.js`, TTS closed, by the lead), together with trackMarks step 4.

---

## Order and why

1. **askUnder first.** Bridge-only (no table push, no Lua locals), and it fixes the bug a player can feel most: a timed
   out sub-question casting a card. It goes live with a bridge restart between games.
2. **trackMarks second.** Mostly bridge; its one Lua change is small and order-free to deploy. It also fixes a real
   log error (the extra-turn header) if the optional step is taken.
3. **engineCardEntry last.** It touches how card objects are made, the part of the table where TTS freezes and lost
   cards came from before; it needs the real-table check. Its Lua change ships in the same table deploy as trackMarks
   step 4, so the table is pushed once.

## The riskiest step

engineCardEntry step 2 (routing `place`'s spawn callback and the four take-over paths through one function). A wrong
flag there loses or doubles card objects on the real table, and the sim cannot show TTS's real event timing around
`takeObject`. Keep that step behaviour-identical (golden byte-equal, every spawn line the same), land the fixes
separately in step 3, and do the real-table check before calling it done.

---

## Review 2026-11-05

A second agent checked every bug claim against the code and, where it was cheap, proved it with a throwaway test.
No project code or tests were changed. The tests are in `tmp/core-moves-review/`:
- `review-askunder.js`: drives the bridge (tests/bridge-harness.js) through A to E: timeout, Cancel, Back.
- `review-extraturn.js`: the log header for Time Warp cast on another player.
- `make-patched.js`: writes `bridge-patched.js`, a copy of today's bridge with the fixes below
  (`EXTRA_FIX=1` adds fix 3). Run a test or a gate on the copy with `BRIDGE_PATH=<that file>`.

### Verdicts

| Item | Claim | Verdict |
|---|---|---|
| askUnder 1 | timeout during A, B, C does the unchosen thing | **Proven.** A casts `a-cast1`, B casts Necromancy outside the main phase, C uses the fetch land's first ability, D and E tap for the first colour. Control: a timeout at plain priority passes. |
| askUnder 2 | Cancel on C, D sends no `refused` | **Proven** in the bridge (no `refused`, priority re-sent). That the land then looks tapped is read from the code: `tapGesture` turns it at once, and a re-sent prompt does not redraw the board (`engineOnPrompt`); only `refused` (`snapBack`) or the next board turns it back. |
| askUnder 3-6 | | Correct as read. |
| trackMarks 1 | extra-turn header guesses wrong | **Proven.** Turn 6 (the AI's extra turn) is logged as a plain turn; turn 7 (its normal one) as "(extra turn)". Forge sets `isExtraTurn` on the new active player at every turn start (PhaseHandler `getNextActivePlayer`), and the harness sends it (`InteractiveSnapshotExtractor`, "isExtraTurn"), so the field can be read instead of guessed. |
| trackMarks 2-5 | | Correct. One more "first board" style: poison uses `?? 0` (no guard at all), like the blessing. |
| engineCardEntry 1 | badge missing after a 2+ pile | **Likely, read only.** `addToPile` never clears `engineBadge`, `engineAdopt` doesn't either, and `updateBadge` returns early on the same text. Worse than the plan says: the same early return skips the card's **ability buttons** too (the `#ab` half of the key), for a card that had no ability buttons on screen when it died. Not proven: a table-golden case needs the whole 1v1 stream replayed. |
| engineCardEntry 2 | `mtg reset` mid-draw leaves stray cards | **Doubtful as stated.** `engineClear` runs `sweepEngineCards` over `getObjects()`; in TTS a just-spawned object is listed at once, so it is trashed (GM notes "enginetrash", hidden). The real gap is smaller: the late callback writes a trashed object into the next game's `engineObjs` and calls `setLock`/`setScale` on it (an error once the trash merge has destroyed it). Keep the game check as hygiene, not as a fix a player sees. |
| engineCardEntry 3 | searched DFC records the wrong back | Correct as read; minor. |
| engineCardEntry, locals | removing `backDeckEntry` frees one local | Correct, but it has **two** callers (`libraryDeckData` and the one-card library): both become `deckEntry(ENGINE_BACK, ENGINE_BACK)`. |

### Missed (new, low)

- **A second gesture while a sub-question is open.** Proven by test. With "how do you play it?" open for card X:
  dragging another one-way card casts it and closes X's question **without** `refused` for X (X sits on the
  battlefield until the next board). A Q/E nests a second sub-question; its Cancel goes back to X's question, not to
  priority. `askUnder` should refuse a new gesture while one is open, or put the first card back first. Add both to
  askUnder step 1's photographs.
- **The timer's chat line** says "took its default answer" with the sub-question's title; after the fix it passes
  (wording only).

### Minimal fixes that can land tonight (bridge only, a bridge restart between games)

Checked on the patched copy: the review tests show A to D end in Pass; Cancel and timeout on C/D send `refused`; the
extra-turn headers are right. Gates on the copy: `test_bridge_events` 224/224, `test_bridge_claims` 39/39,
`test_bridge_debug` 47/47, `test_bridge_golden` 941/944. The 3 differences are only the new `onTimeout` field in the
three "tapmana: ... asks" cases (re-record them). E (the "Mana: tap X" step) still taps the first colour on timeout:
the player pressed a tap button, so it is left for the refactor.

Fix 1, `timeoutChoice` (the timer takes Back, then the priority question's own Pass on the loop's next turn):

```js
function timeoutChoice(ui) {
  if (ui.onTimeout) return [ui.onTimeout];
  if (ui.mode === "number") return [String(ui.min ?? 0)];
  const ids = (ui.options || []).map((o) => String(o.id));
  if (ui.mode === "multi") return ids.filter((id) => !id.startsWith("__")).slice(0, ui.min || 0);
  return [["__back", "__pass", "keep", "__cancel", "__auto", "__keep", "auto", "ok", "no"].find((id) => ids.includes(id)) ?? ids[0]];
}
```

Fix 2, sites C and D in `onIntent` "tapmana": both `prepareUi` calls get `onTimeout`, and both `toOutput`s change the
same way (the `Object.assign` was redundant: `onAnswer`'s `__next` branch sets `ui` and `toOutput` itself).

```js
// C
const ui = prepareUi({ title: `${name}: which ability?`, mode: "single", cancel: true, onTimeout: "__cancel", kind: "choice",
// D
const ui = prepareUi({ title: `Tap ${name} for which mana?`, mode: "single", cancel: true, onTimeout: "__cancel", kind: "choice",
// C and D: the toOutput
seat.prompt = { ...p, ui, toOutput: (a) => (a[0] === "__cancel" ? { __next: { ...back, returns: m.id } } : { type: "act", actionId: a[0] }) };
```

Fix 3, the extra-turn header (`extraTurn` and its one caller in `logEvents`; the guess stays only for a board without
the field). No golden change.

```js
function extraTurn(prev, cur, pub) {
  const said = (pub?.players || []).find((p) => p.id === cur.active)?.isExtraTurn;
  if (typeof said === "boolean") return said;
  const owners = game.turnOwners || {};
  // ... the guess, unchanged
// in logEvents' turn header
${extraTurn(prev, cur, pub) ? " (extra turn)" : ""}
```

With the fixes, add the cases from the review tests to `tests/golden/bridge-cases.js` (timeouts and Cancel on A to D,
the Time Warp header); they become askUnder step 1's photographs, recorded with the fix in.

### Plan corrections

- **askUnder:** with fixes 1-2 in, step 3 shrinks to C/D's `__back` option (dropping `cancel: true`), E's Back,
  `onPrompt` putting the card back, the old `step`, and the new nested-gesture rule. Step 1 is half written (the
  review tests). Estimate stays about 8.5 h (1 h saved, 1 h added for the nested gesture).
- **trackMarks:** its only real bug is fixed by fix 3 (1 h with the golden case), so step 7 loses the header. The
  "check `isExtraTurn` live" note is answered by Forge's source (one look on the 9444 stack is still cheap). What is
  left is ownership and the marks the log never says: 7.5 h plus a table deploy, for no change a player sees. Move it
  **last**, after engineCardEntry, or ship steps 1-3 (bridge only) and keep the Lua half (steps 4 and 6) for a table
  deploy that is due anyway.
- **engineCardEntry:** the badge fix also brings back ability buttons (add a case: a creature with an activated
  ability and no buttons on screen when it dies, reanimated, then priority). The reset case in step 1 should record
  calls made on trashed objects, not "stray cards". Step 1 needs the Workshop table JSON (`buildSave`); keep the full
  2.5 h. Estimate 8 h stands.
- **Order:** askUnder (after tonight's fixes), engineCardEntry, then trackMarks. Total about 24 h plus 1 h for fix 3.
- **Riskiest step:** agreed, engineCardEntry step 2.
- **Not checked:** the `checkRestored` field list; whether real TTS keeps script buttons through
  `putObject`/`takeObject` (believed not, as in the sim); the Lua half of askUnder bug 2 in the sim.

## Results 2026-11-06

All three are built, independently reviewed, fixed after review, and deployed (table 0d1f4982, save 165c09a4, bridge
4b7228e4). Each one's full record (steps, golden diffs, mutation results, review rounds) is in `docs/core-moves/`:
`askunder.md`, `cardentry.md`, `trackmarks.md`. Step 6 of trackMarks (drop the old fields) is still to do, now that
both halves are live; step 7 (new log lines) needs the user's OK.

Real-table check, same night (debug scenarios `core-moves` and `core-moves-2`, 1v1 against the AI):
- PASS: a creature card picked out of a graveyard of exactly 2 cards (Raise Dead): one card left, no stray copy.
- PASS: Prodigal Sorcerer under Glorious Anthem, killed into a 4-card graveyard and reanimated: its "Summoning sick"
  and 2/2 boxes show at once; next turn at priority its "{T}: Prodigal…" ability button shows.
- PASS: Demonic Tutor, a card taken out of the search deck: answers the question at once, lands in the hand.
- PASS: Palace Jailer and Harnessed Lightning: "ENERGY 2   MONARCH" under the life total (energy first), log lines
  "White becomes the monarch", "White gets 3 energy (3 in all)", "White pays 1 energy (2 left)".
- PASS: "mtg reset" two frames after the first engine card spawned, and 0.4 s after a search closed: no engine object
  left, no console error.
- NOT REACHED: the "Mana: tap X" colour question (Birds of Paradise had no mana button with mana already floating);
  C/D's Cancel option; a creature dying within a frame of being played. Covered by the goldens only.
- FOUND (older bug, not from these changes): putting several cards on the bottom of a library at once (the debug
  setup's dealt hand, 7 cards; also a London mulligan's bottom cards) spawns the plain backs together, and they merge
  into their own unnamed 7-card deck on top of the library instead of going into it. It has no engine GM note, so
  "mtg reset" leaves it on the normal table. Reproduced twice. Fix queued with the jr-programmer-suite run.
