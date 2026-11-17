# Report: the Archenemy table view (plan step 9)

Cloud session, 2026-11-17, branch `cloud/archenemy-view` from `origin/main` f63de76. The branch name was used before
for the engine side (plan step 4, `docs/handoff/archenemy-view-report.md`); that work is in main, so this push is a
fast-forward of it.

Not seen in TTS: the positions below are first guesses that need a look on the real table. No permission prompt is
pending.

## What the board carries now (`bridge/bridge.js`)

The engine (engine1119) already sends `PlayerDto.isArchenemy`, `schemeDeckCount` and `schemes` (`[{ id, name,
ongoing }]`, the scheme cards in the command zone). The bridge didn't pass them on, and the scheme cards were drawn as
ordinary cards in the archenemy's command row. Now:

- **The player row:** `arch: true` and `schemeDeck: N`, for the archenemy only.
- **The board's `schemes`:** every scheme card in a command zone, taken out of the command row as planes are. Each is a
  slim card (picture, name, text) with `ctl`, and `ong` for an ongoing one: the engine's flag, else its Ongoing
  supertype.
- **The board's `schemeNow`:** `{ seq, card }`, the scheme set in motion last.
  - `seq` counts from 1 each game, whenever a scheme the bridge hasn't seen in a command zone arrives.
  - A scheme that isn't ongoing goes back under the deck once it resolves. Its card is kept, so the table keeps showing
    it until the next one.
  - A scheme that comes back out of the deck later counts as new.
  - The engine's `setInMotion` events (step 4) say the same. They could replace the command-zone watch later: a
    scheme set in motion and gone back between two boards would then still get its banner.
- No Archenemy game: nothing new on the board.

## What the table draws (`tools/engine-renderer.lua`)

All of it sits by the archenemy's seat, between their mat and the table's centre (`ENGINE_SCHEME`: 42% of the way from
the centre to the mat, y 2.4), turned to read from that seat, and look-only.

- **The scheme set in motion:** face up and large (1.5, as a plane), its rules text in its hover.
  - `engineTextInto` lets texts that arrive after the board reach the schemes. `engineOnTexts` only covered the player
    zones.
- **The ongoing schemes:** in a row to its right, 4.4 and then every 3.4 along the mat's right.
- **The scheme deck:** a card-back stand-in to its left, with a box reading "ARCHENEMY / 17 SCHEMES" (the dungeon room
  box's place and look). Its hover says how many are left and when the next one is set in motion. This box is also the
  mark on the archenemy's seat, beside the existing gold mat line and the phase bar's "(ARCHENEMY)".
- **The banner:** "SET IN MOTION: <NAME>" in gold on every seated player's screen for 4 s, once per `seq`.
  - A jump board (rewind, reload) only records the scheme, as the planar die banner does.
  - A new game counts from 1 again.
- **The archenemy:** the row's `arch`, else the board's `teams.archenemy` (`engineArchColor`).
- **The setup button** (plan step 9's "button on the setup tile"): "Archenemy / Off" beside Teams, host only, on the
  4-player table.
  - Each press goes off, White, Red, Yellow, Blue, then off, sending `mtg archenemy <colour>` / `off` through the chat.
    The bridge keeps the setting and says it, as before.
  - `mtg archenemy` typed in chat updates the button too (`engineArchNoted`).
  - Its spot is the profile's `spots.archenemy`, else 10 past Teams on the same strip. `setupButton` mirrors x, as for
    the other tile buttons. It is counted in `engineSetupIntact` and in the redraw signature.
- **Lua rules:**
  - main-chunk locals: 91, unchanged; lua-scan local names: 175, unchanged;
  - no `local` in a for-in loop body in the new code (a luaparse walk; the one it finds is `engineOnTexts`' old
    `local o`);
  - no new patterns;
  - the only button is the setup tile's, through `setupButton`;
  - no `UI.setValue` on a button.
- **`bridge/table-map.js`:** `isArchenemy` → `arch`, `schemeDeckCount` → `schemeDeck`, `schemes` → `schemes` (and
  `schemeNow`), each with what is shown. They are no longer gaps.

## Tests

- **New `node tests/test_table_archenemy_view.js`: 40 of 40, in GATES.** No save needed.
  - The bridge sends five boards through `sendTable`:
    1. a scheme set in motion;
    2. an ongoing one joining;
    3. the first gone back under the deck;
    4. a new one;
    5. the first again.
  - Those board and text messages, in order, go into the renderer's own functions on fengari, with stand-ins for
    `place`, `seatGeometry` and the screen UI.
  - Bridge checks:
    - schemes leave the command row;
    - `ong` and `ctl`;
    - `arch` / `schemeDeck` on the archenemy only;
    - each `seq` (kept, next, again from the deck);
    - the card kept after it leaves;
    - nothing in a game without Archenemy.
  - Table checks:
    - each placement (spot, zone, colour, turn);
    - the row's order;
    - the deck's words (singular too);
    - the archenemy from `arch` or from `teams`;
    - nothing without one;
    - the hover text, including a text arriving after its board.
  - Banner checks: once per scheme, gold, not on a jump board, put away after 4 s.
  - Button checks: the label, the full cycle, `mtg archenemy` setting it, its drawing, its redraw and its count.
  - Board-path checks: details filled in, drawn each board, drawn large, reset for a new game.
- **Break-it: `node tools/mutate-archenemy-view.js`: 32 of 32 caught by name**, every file restored by sha256.
  - The first run had one survivor, "rules texts never reach a scheme": a later board in the same stream refilled the
    text anyway. A direct check now covers a text arriving after its board.
- **Regression:**
  - `test_table_archenemy_lua` 10.
  - `test_bridge_archenemy` 66.
  - `test_table_map` 637.
  - `test_bridge_planar` 27.
  - `test_bridge_teams` 35.
  - `test_bridge_team_modes` 49.
  - `test_moonsharp_patterns`.
  - `test_bridge_golden`: all 1084, unchanged. No golden board has a scheme.
  - The 75 GATES against `origin/main`, both trees run here: the same result everywhere, except `test_table_map`
    (637 checks against 631: the three Archenemy fields now mapped) and the new test.
  - `test_table_3hg` failed on the first run, because the button code sat inside the team block it loads. That code
    now follows `engineTeamId`, and the test passes 16 of 16.

## For the real table

1. **The spots:** the scheme set in motion, the row and the deck pile should sit clear of the stack, the planes and
   the attack lines.
2. **The setup button's spot:** 10 past Teams has not been seen on the real table.
3. **Scheme pictures:** the bridge asks Scryfall by name, and chosen schemes are fetched ahead. Schemes are oversized
   cards and will be drawn at a normal card's shape. Plan step 10 is still open.
4. **The table tests that need the save** weren't run here.
