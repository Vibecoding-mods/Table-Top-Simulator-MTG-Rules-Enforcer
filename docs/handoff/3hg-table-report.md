# Report: Three-Headed Giant on the table

Cloud session, 2026-11-16, branch `cloud/3hg-table`, from `origin/main` 1558cdb. The bridge side is on
`cloud/three-headed-giant`. Only `tools/engine-renderer.lua` and `tools/make-engine-copy.js` change. Not tried in TTS.

## What was built

- **`mtg mode 3hg`** (host). This is the new `engineTeamChat` branch.
  - On the six-seat table it sets `ENGINE_TEAM_MODE = "3hg"`. The teams are the table's sides, from the new global
    `ENGINE_3HG_TEAMS`: White, Red and Yellow are team 1; Green, Blue and Purple are team 2. These are the same teams as
    the bridge's `THREE_TEAMS`.
  - It says to everyone: "Host set the next games to Three-Headed Giant: White + Red + Yellow vs Green + Blue + Purple."
    Then the help text: shared life (120 a team in Commander, 45 in Standard), poison 20, losing, blocking and seeing
    hands together, each player's own turn with the team's turns back to back, and AI players in the empty seats.
  - The life numbers are as the engine gives them; the table sends no life.
  - On the four-seat table it is refused: "Three-Headed Giant is played on the six-seat table (three a side); this table
    has 4 seats."
- **`engineSixSeats()`**: a global function, true when `ENGINE_TABLE_SEATS` lists six seats.
- **What Start sends.** `engineTeamModeSent()` gives `"3hg"`, and the teams sent carry all six colours. Juggernaut and
  team turns are not sent.
- **`mtg team`** in 3HG is refused, because the teams are the sides. The check comes before the colour check, so
  `mtg team green 1` gets this answer and not the four-colour usage line.
- **Teams button.**
  - The label reads "Teams / 3HG".
  - On the six-seat table the cycle is:
    - Commander: 2HG, Juggernaut, 3HG, none.
    - Standard: 2v2, 3HG, none.
  - The four-seat table's cycles are unchanged.
- **Game-mode switch** (`engineSetGameMode`). 3HG plays in either game mode, so a switch keeps it. Inside the function,
  `ENGINE_TEAM_GAME_MODE["3hg"]` is set for the switch and cleared afterwards. 2HG, 2v2 and Juggernaut are still reset
  as before, with the same message.
- **Leaving 3HG.** `mtg mode 2hg`, `mtg mode 2v2` or `mtg mode juggernaut` after 3HG goes back to the four-seat teams.
  `mtg mode ffa` clears the teams as before.
- **Help** (`make-engine-copy.js`). The `mtg mode` usage line and the help list name `3hg` (the six-seat table).

## Lua rules checked

- **No new main-chunk locals.** luaparse counts 91, the same as main. `tools/lua-scan.js` gives 175 local names, also the
  same as main. Two more globals are assigned: `ENGINE_3HG_TEAMS` and `engineSixSeats`.
- **No bare `local x` in a for-in loop body.** The changed lines declare no new locals; the existing `isMode` line is
  extended.
- **Plain find and sub only.** No new patterns.
- **No new buttons**, so the rule about negated x on mat zones doesn't come up.
- **The file parses** (luaparse, and loading under fengari).
- **The other break-it tools still match.**
  - Every text that `tools/mutate-team-modes.js` and `tools/mutate-teams.js` target in `engine-renderer.lua` is
    unchanged by this branch.
  - However, 9 targets in those two tools already don't match on main 1558cdb:
    - 8 in `bridge/teams.js` and `bridge/bridge.js`;
    - 1 in the renderer: "table: mtg mode ffa keeps the teams".
  - This branch doesn't touch them. They need refreshing separately.

## Tests

- **New `node tests/test_table_3hg.js`: 16 of 16.** It needs no save.
  - It loads the renderer's team block (from `ENGINE_TEAMS = nil` up to `engineTeamId`) and `engineSetGameMode` into
    fengari, with stand-ins for the TTS calls.
  - It checks:
    - the refusal on four seats, and with a seat list that isn't six;
    - the mode and teams on six seats;
    - the chat text;
    - what Start sends;
    - the label;
    - `mtg team` refused;
    - the button cycles: on six seats in both game modes, and unchanged on four seats in both;
    - a switch to Standard keeping 3HG;
    - 2v2 after 3HG back on the four-seat teams;
    - a switch to Commander still dropping 2v2.
- **Break-it: `node tools/mutate-3hg-table.js`: 16 of 16 caught by name**, each file restored by sha256.
  - The first run had one survivor, "engineSixSeats: any seat list". I added the check with a four-seat seat list, and
    then it was caught.
- **Other fake-TTS tests that need no save:**
  - `test_table_map`: 619 of 619. It needs the engine tree at `manabrew/`, which I linked for the run and didn't commit.
  - `test_table_profile` and `test_table_six`: SKIP, because the Workshop tables aren't in the cloud session.

## Tests not run (they need the TTS save, `buildSave`)

test_table_2hg_level2, test_table_2hg_team_block, test_table_board_diff, test_table_check, test_table_claims,
test_table_clear_deck, test_table_deckcheck, test_table_dungeon, test_table_effects, test_table_fix_hand,
test_table_flip_guard, test_table_floating_mana, test_table_gifs, test_table_golden, test_table_hand_chat,
test_table_kind_relation, test_table_lag, test_table_promote, test_table_repeat_yesno, test_table_seats,
test_table_standard, test_table_team_looks, test_table_team_modes, test_table_teams, test_table_trigger_groups.

Also not run: `test_table_profile` and `test_table_six` (Workshop tables), and a live game in TTS.

`test_table_team_modes` and `test_table_teams` are the ones most worth running with the save. They check the four-seat
team chat and button that this branch extends.
