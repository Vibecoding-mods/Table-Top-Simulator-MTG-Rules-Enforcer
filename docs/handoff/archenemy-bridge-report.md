# Report: Archenemy in the bridge (plan step 8)

Cloud session, 2026-11-16, branch `cloud/archenemy-bridge`, rebased on `origin/main` 1558cdb. No change to
`forge.patch` or `manabrew.patch`. Not tried against a live engine.

## What was built

- **The mode.** `archenemy` in `bridge/teams.js` `TEAM_MODES`: `{ rule: "teams", name: "Archenemy", gameMode: null }`.
  - `gameMode: null` means either game mode, so `teamModeProblem` lets it through in Commander and in Standard.
  - 2HG, 2v2 and Juggernaut are unchanged: their own tests pass, and every text that `tools/mutate-team-modes.js`
    mutates still matches exactly once.
- **The archenemy.**
  - Any of the four seats, a seated player or an AI seat. `mtg archenemy <colour>` sets it, `mtg archenemy off` clears
    it, and `mtg archenemy` says what is set.
  - At start, the colour must be in the game: seated, set as an AI seat (`mtg ai <colour> forge`), or a full table.
    Otherwise the start is refused with how to fix it, because AI players take the free seats in turn order.
- **Schemes.**
  - `bridge/forge-schemes.json` holds 81 schemes and 21 ongoing schemes from Forge's card scripts. It is made by the
    new `tools/build-forge-scheme-list.js` (as the plane list is), here with `--dir` on Forge `e7d2b93`'s cardsfolder.
  - `mtg schemes random`, the default, picks 20 different schemes at random.
  - `mtg schemes <name>; <name>; ...` takes the host's list: names in any case, `2 <name>` or `2x <name>` for copies,
    separated by `;` or newlines.
  - A list is refused by name for unknown schemes, for fewer than 20, and for more than 2 copies of one. These are the
    engine's own rules (`Archenemy.schemeDecks`, `cloud/archenemy-rules`), so the host hears it in chat before a start.
  - A table start can also carry `teamMode: "archenemy"` with `archenemy: { color, schemes }`.
- **The start** (`withArchenemy`, `startGame`). With the switch on, the next start is an Archenemy game whatever teams the
  table sent. The archenemy is alone on team 1, everyone else on team 2.
- **gameConfig** (`teams2hg.gameConfig`):
  - `teamRules: "teams"` and `archenemy: true`;
  - the archenemy's entry carries `team: 1`, `startingLife` (80 in Commander, 40 in Standard), `goesFirst: true` and
    `schemes: [names]`, which the node reads as `GameConfigPlayer.schemes`;
  - the others carry `team: 2` only.
- **Chat at setup:** "Archenemy: Blue (80 life, goes first, 20 random schemes) vs White + Red + Yellow (40 life each, their
  own turns). The archenemy sets a scheme in motion at each of their first main phases; the archenemy wins when all the
  others have lost, and they win together when the archenemy loses. Undo is off in Archenemy games."
- **Board:** the board's `teams` carries `archenemy: <colour>`, as it carries `juggernaut` in a Juggernaut game. The
  winners come from the team win as before.
- **Undo off:**
  - Asking to rewind in an Archenemy game is refused in chat, with "Undo isn't available in Archenemy games: the schemes
    in play can't be rewound yet."
  - The board's `rewind` carries `off` with the same text, and the table's `mtg undo` prints it instead of "No restore
    points yet".
  - A Juggernaut game still rewinds; a test checks this.
- **Table chat** (`tools/make-engine-copy.js`): `mtg archenemy` and `mtg schemes` are passed to the bridge (host only to
  change them), and there is a help line. The edited Lua parses (luaparse).
- **The 6-player table:** the team modes are the 4-player table's (`teams.js` `TEAM_COLORS`), so an Archenemy start on a
  6-seat table is refused, saying why.

## Tests

- **`node tests/test_bridge_archenemy.js`:** 55 of 55. It covers the scheme list, the mode, `setupOf`, `archOf`, life,
  the scheme deck rules, `teamsProblem`, `gameConfig` in Commander and Standard, the board, the setup words, both chat
  commands, the switch, starts through to the relay's `gameConfig`, the refused starts, Undo off, and a Juggernaut game
  still rewinding.
  - The relay-flow checks need the engine's preset decks at `manabrew/public/preset_decks`, as the other bridge start
    tests do. I linked a Manabrew tree for the run.
- **Regression:** all pass.
  - `test_bridge_team_modes` 49 of 49.
  - `test_bridge_teams` 35 of 35.
  - `test_bridge_2hg_level2` 37 of 37.
  - `test_bridge_2hg_team_block` 56 of 56.
- **Golden:**
  - `node --max-old-space-size=8192 tools/capture_bridge_golden.js` recorded 1081 scenarios. Its two-run determinism
    check passed.
  - Compared with main's file, the 1076 existing scenarios are byte-identical and 5 are new:
    - `archenemy: mtg archenemy Blue, random schemes, a start to gameConfig`
    - `archenemy: a pasted scheme list, two of one`
    - `archenemy: a Standard start from the table, an AI archenemy`
    - `archenemy: refused starts (the archenemy not in the game, a short list)`
    - `archenemy: undo refused, the board says why`
  - `test_bridge_golden` matches all 1081 scenarios.

## Break-its

`node tools/mutate-archenemy.js --golden` makes 29 mutations, one per piece:

- in `teams.js`: the mode, the either-game-mode rule, the teams, the colour check, life, the 20 minimum, the 2-copy
  limit, `teamsProblem`, the flag, the archenemy's entry, the first turn, the schemes, the board, the Undo words;
- in `bridge.js`: the chat colour, `2 <name>`, unknown names, the deck check, the switch, the host's list on a table
  start, the switch at start, the colour in the game, the 6-seat table, the scheme deck at start, `game.arch`,
  `gameConfig`, the board's archenemy, the Undo refusal, and the board's Undo text.

Each mutation runs `test_bridge_archenemy` and `test_bridge_golden`, lists the checks that failed by name, and restores the
file by sha256.

- **Before rebasing,** with the archenemy test only: 28 of 28 caught, 0 survived. The 6-seat case didn't exist yet.
- **Rebased, with the golden test:** 29 of 29 caught by name, 0 survived, every file restored by sha256. The mutations
  that touch what the new golden scenarios record also fail those scenarios by name, for example
  "archenemy: mtg archenemy Blue, random schemes, a start to gameConfig: effect #12".

## Questions for the user

1. **How many players?** Archenemy is allowed with 2 to 4 players (the archenemy against 1 to 3). CR 904 wasn't read
   here: the rules site is outside this session's network. Should a 1-against-1 Archenemy be allowed?
2. **The 6-player table:** Archenemy is refused there for now, like the other team modes, which are 4-seat. Should it
   come to the 6-seat table, as one against five?
3. **A table button.** The setting is in chat (`mtg archenemy`, `mtg schemes`) and kept by the bridge, like Planechase.
   The setup tile's Teams button doesn't offer Archenemy. Is a button wanted? That is table work (`engine-renderer.lua`).
4. **Where the schemes appear.** The table doesn't draw them yet (plan step 9).
5. **The two engine branches.**
   - main's engine has the per-player `schemes` but not `cloud/archenemy-rules`, which has the `archenemy` flag, the
     refusals and the forced teams.
   - The bridge works with either: it sends life, teams and schemes itself, and the flag is ignored where it isn't
     known.
   - With main's engine, though, restore points are still taken, so only the bridge's refusal keeps Undo off.

## Not done

- Table work (plan step 9). The table's own tests need the TTS save, which isn't in the cloud session.
- A live game.
