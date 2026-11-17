# Report: Archenemy follow-ups from review

Cloud session, 2026-11-16, branch `cloud/archenemy-polish`, from `origin/cloud/archenemy-bridge` (f1b16e4).

- `cloud/first-player` was not merged in: the bridge already makes the archenemy first with `goesFirst: true`.
- No change to `forge.patch` or `manabrew.patch`.
- Not tried on the real table or against a live engine.

## The five fixes

1. **The sticky switch's refusal on the 6-player table** (`bridge.js` `withArchenemy`, `startGame`).
   - `mtg archenemy <colour>` stays on for the next games, so on the 6-seat table every start was refused with no way
     out named.
   - A start the switch made is now marked (`arch.sticky`). Its refusal ends with: "The Archenemy switch is on for the
     next games: type  mtg archenemy off  to play without it."
   - The same sentence ends the "isn't in this game" refusal of such a start.
   - A table's own Archenemy start (`teamMode: "archenemy"`) has no switch to turn off, so it doesn't say it.
2. **The Undo tab** (`engine-renderer.lua` `engineSidePrompt`).
   - With no restore points, the tab used to read "No restore points yet."
   - It now shows the board's `rewind.off` when there is one: "Undo isn't available in Archenemy games: the schemes in
     play can't be rewound yet."
   - Other games are unchanged.
3. **The archenemy marked on the table** (plan step 9's marking; `engineTeamTurnTag`, `engineTeamLooks`), the same way
   the Juggernaut is:
   - **Phase bar:** "(ARCHENEMY)" on the archenemy's turn, "(YOU, THE ARCHENEMY)" for the archenemy.
   - **Mat line:** the archenemy's is gold (tint 3); the others get their team's tint.
   - It reads the board's `teams.archenemy`, which the bridge already sent.
   - The rest of step 9 isn't done: the scheme in motion, the ongoing row, the scheme deck pile and the banner.
4. **The false refusal when an AI player fills the archenemy's seat** (`startGame`).
   - The check counted only seated colours, AI-seat colours (`mtg ai <colour> forge`) and a full table.
   - So `mtg archenemy Red`, White seated and `mtg start ai 1` was refused, though the AI player sits at Red.
   - It now works out the colours as `clockwiseOrder` seats them: the seated ones, the AI seats', then the free seats
     in turn order, one per remaining AI player.
   - An archenemy colour no AI player reaches is still refused, for example Yellow with one AI.
5. **The team info in a 2-player Archenemy game** (`teams.js` `teamsField`, new `archTeamsField`).
   - The engine names a team only when it has two players or more (`InteractiveSnapshotExtractor.teamNumber`). With
     two players the board had no `teamRules` and no team numbers, so the board lost its teams, the archenemy and the
     team win.
   - When the bridge knows the game is Archenemy, `teamsField` now builds the sides from the archenemy's colour. They
     come in turn order, with `archenemy`, `mode: "archenemy"`, and `won` at the end.
   - Other modes are unchanged; a 2-player game outside Archenemy still has no teams.

## Lua rules

- **No new main-chunk locals:** `tools/lua-scan.js` gives the same 175 locals and 565 globals before and after.
- **No `local` in a for-in loop, no `find` or `sub`:** the Lua diff adds no `local` at all and no `string.find` or
  `string.sub`.
- **It parses:** checked with luaparse.

## Tests

- **`node tests/test_bridge_archenemy.js`: 66 of 66.** 11 new checks for fixes 1, 4 and 5:
  - the 6-seat refusal with and without the switch;
  - Red filled by an AI player, Yellow still refused, Blue reached by three AI players;
  - the 2-player sides, both wins and the turn order;
  - a 2-player game outside Archenemy;
  - the table's board.
- **One existing check updated:** a switch-made start's exact shape now includes `sticky: true`.
- **`node tests/test_table_archenemy_lua.js` (new): 10 of 10**, for fixes 2 and 3.
  - It takes `engineTeamTurnTag`, `engineTeamLooks` and `engineSidePrompt` from `engine-renderer.lua` as written, and
    runs them in fengari with stubs for what they call.
  - The full table tests (`test_table_*.js`) need the TTS workshop save, which isn't in a cloud session, so they
    weren't run.
  - It needs `npm ci` in `tests/lua` (fengari).
- **Regression:** all pass.
  - `test_bridge_team_modes` 49 of 49.
  - `test_bridge_teams` 35 of 35.
  - `test_bridge_2hg_level2` 47 of 47.
  - `test_bridge_2hg_team_block` 56 of 56.
- **Golden:** recaptured with `tools/capture_bridge_golden.js`.
  - 1079 scenarios byte-identical; the 2 that changed are both intended:
    - "archenemy: refused starts (the archenemy not in the game, a short list)": the refusal now ends with the way
      off (fix 1).
    - "archenemy: undo refused, the board says why": a 2-player game, whose board now carries the teams (fix 5).
  - `test_bridge_golden`: all 1081 match.

## Break-its

`tools/mutate-archenemy.js` has 11 new mutations. It now also runs `tests/test_table_archenemy_lua.js`.

| Fix | Mutation | Caught by |
| --- | --- | --- |
| 1 | a refusal never says `mtg archenemy off` | "6-player table, the switch on: the refusal says  mtg archenemy off", "one AI player takes Red, not Yellow: ..." |
| 1 | a switch start not marked | "switch on: a 2HG start becomes Archenemy with Red alone" (+2) |
| 1 | the way off said for a table's own start too | "6-player table, a table's own Archenemy start: no switch to turn off, so it isn't mentioned" |
| 4 | the old seat check back | "an AI player takes the archenemy's seat (Red, the first free one): started, Red the archenemy" |
| 4 | every free seat counted as an AI player's | "start: an archenemy colour not in the game is refused, saying how", "one AI player takes Red, not Yellow ..." |
| 5 | no sides in a 2-player game | "2 players: the sides, the archenemy and the mode though the engine sends no teams" (+) |
| 5 | the archenemy's win given to the other side | "2 players: the archenemy's win" |
| 5 | the sides out of turn order | "2 players, the archenemy first in turn order: their side first" |
| 3 | no (ARCHENEMY) on the phase bar | "phase bar: the archenemy's turn says (ARCHENEMY)", "phase bar: the archenemy sees (YOU, THE ARCHENEMY)" |
| 3 | the archenemy's mat not gold | "mat: the archenemy's mat is gold (3) ...", "mat: a 2-player Archenemy game marks the archenemy too" |
| 2 | the Undo tab doesn't say why | "Undo tab: a scheme game says why Undo is off" |

**Results:**

- The whole set, now 40 mutations (the bridge report's 29 plus these 11): **40 caught, 0 survived**, every file
  restored by sha256.
- One of the 29 had to follow the new code: "start: an archenemy not in the game let through" now mutates the new seat
  check.
- With `--golden` (each mutation also against `test_bridge_golden`): **40 caught, 0 survived**, every file restored by
  sha256.
- **How the source got committed:** the golden run took about 50 minutes and edits the source files in place.
  - `teams.js` and `engine-renderer.lua` went in from copies taken at moments when they were clean. "Clean" was
    checked as: every mutation's `from` text present exactly once.
  - `bridge.js` was rebuilt from the committed file with the same edits, then tested on a separate worktree: all the
    suites above pass, and the golden matches 1081 of 1081.
  - After the run, the restored working files are byte-identical to the pushed ones.

## Left

- The rest of plan step 9: the scheme in motion at the centre, the ongoing row, the scheme deck pile with its count,
  the "SET IN MOTION" banner and a setup-tile button.
- A look on the real table: screenshots need TTS.
- A live game.
