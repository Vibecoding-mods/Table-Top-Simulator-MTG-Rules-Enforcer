# Report: the shared team turn's looks (2HG Level 2)

Cloud session, 2026-11-16, branch `cloud/shared-turn-looks`, from `origin/cloud/3hg-table` 6919fa0. This is the polish
from the Level 2 gap report (84d5c0b): there, TTS's turn colour followed only the first seat, and the game log's turn
header named only the first seat. Not tried in TTS or against a live engine.

No permission prompt is pending.

## What changed

- **The game log's turn header** (`bridge/bridge.js` `logEvents`).
  - In a shared-turn game, the header names the team: `--- White + Red's turn 2 ---`.
  - It uses `turnOwnerWords`, the same words the rewind list already used.
  - Outside a shared turn, the header is as before (`--- White's turn 2 ---`). All 1076 golden scenarios are
    byte-identical.
  - The turn number is still the first seat's count. In a shared turn the first seat is always the active player, so
    the number counts the team's turns.
- **TTS's turn colour** (`tools/engine-renderer.lua`, the board's apply).
  - TTS's `Turns.turn_color` holds one colour, so it can't show two seats at once. Instead, in a shared team turn it
    now follows the team:
    - the active player, when that player is seated;
    - otherwise the team's first seated player.
  - So an AI's team turn now lights its human partner. Before, nothing changed, and the colour stayed on the last team.
  - Two new global functions do this:
    - `engineTurnColor(m)`: the colour to show, or nil when nobody of the turn is seated.
    - `engineTurnKey(m)`: the turn, keyed as the active player plus the team.
  - The colour is set once per turn, as before. A colour a player moves by hand in the middle of a turn is kept until
    the turn changes.
  - Outside a shared turn the behaviour is as before: the active player when seated, else no change.
- The phase bar and the banner already said "YOUR TEAM'S TURN" or "TEAM WHITE + RED'S TURN" (`engineTeamTurnWords`).
  They are unchanged.

## Lua rules

- **Main-chunk locals:** 91, unchanged; lua-scan counts 175 local names, also unchanged.
- **Loops:** the one new `local` (`turnColor`) is in an `if` block, not in a for-in loop body.
- **Patterns:** none added. No buttons added.
- **The file parses.**
- **Older break-it tools:** none of their mutation texts went stale on this branch. The 10 texts that don't match were
  already stale on the base branch:
  - 9 in `mutate-team-modes.js` and `mutate-teams.js`, already in the 3HG report;
  - 1 in `mutate-team-block.js`: "Level 1 by default".

## Tests

- **New `node tests/test_table_shared_turn.js`: 13 of 13.**
  - It is fake-TTS on fengari and needs no save. It loads `engineTurnColor`, `engineTurnKey` and the apply's
    turn-colour lines, with stand-ins for `Player` and `Turns`.
  - Level 1:
    - the active player's colour;
    - an AI's turn leaves the colour unchanged.
  - Level 2:
    - the active player first;
    - an AI's team turn shows the seated partner;
    - the next team turn;
    - nobody seated gives nil.
  - The keys.
  - The same team turn twice: the colour isn't set again.
- **`test_bridge_2hg_level2`: 49 of 49, two new checks.**
  - Level 2 headers: `--- Yellow + Blue's turn 1 ---` and `--- White + Red's turn 2 ---`.
  - Level 1, the same boards: `--- Yellow's turn 1 ---` and `--- White's turn 2 ---`.
- **Break-it: `node tools/mutate-shared-turn-looks.js`: 8 of 8 caught by name**, both files restored by sha256.
  - The turn colour has 6 mutations:
    - the active player only;
    - the partner even when the active player is seated;
    - an unseated partner;
    - the key without the team;
    - set on every board;
    - the colour not used.
  - The log header has 2 mutations:
    - the first seat only;
    - the board's team named in Level 1 too.
  - On the first run, "set every board" failed only because the test couldn't find the code it loads. I anchored the
    extraction on the comment, and now the "not set again" check catches it by name.
  - An earlier Level 1 mutation turned out to be equivalent: Level 1 boards carry no `activeTeamIds`. I replaced it with
    the board's team numbers, which the Level 1 check catches.
- **Regression:**
  - `test_bridge_2hg_team_block` 56 of 56.
  - `test_bridge_teams` 35 of 35.
  - `test_bridge_team_modes` 49 of 49.
  - `test_table_3hg` 16 of 16.
  - `test_table_map` 619 of 619. It needs the engine tree linked at `manabrew/` for the run; the link isn't committed.
  - `test_bridge_golden`: all 1076 match.

## Not run

- **The fake-TTS tests that need the save (`buildSave`):** test_table_2hg_level2, test_table_2hg_team_block,
  test_table_board_diff, test_table_check, test_table_claims, test_table_clear_deck, test_table_deckcheck,
  test_table_dungeon, test_table_effects, test_table_fix_hand, test_table_flip_guard, test_table_floating_mana,
  test_table_gifs, test_table_golden, test_table_hand_chat, test_table_kind_relation, test_table_lag, test_table_promote,
  test_table_repeat_yesno, test_table_seats, test_table_standard, test_table_team_looks, test_table_team_modes,
  test_table_teams, test_table_trigger_groups.
  - None of them reads `Turns.turn_color`.
  - test_table_2hg_level2 and test_table_team_looks are the ones closest to this change.
- **test_table_profile and test_table_six:** SKIP, because the Workshop tables aren't here.
- **A live game:** `tests/live_2hg_level2_check.js` needs Docker.

## For the user

- TTS shows one turn colour. If both partners should light up, that would need something drawn on the table; the
  banner and phase bar already name the team.
