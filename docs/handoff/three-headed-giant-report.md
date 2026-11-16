# Report: Three-Headed Giant 3v3 on the six-seat table

Cloud session, 2026-11-16, branch `cloud/three-headed-giant` from `origin/main` 1558cdb. Not tried against a live engine
or the real table.

## Bridge

- **The mode.** `"3hg"` in `bridge/teams.js` `TEAM_MODES`: `{ rule: "sharedLife", name: "Three-Headed Giant", gameMode:
  null, seats: 6 }`.
  - `gameMode: null` means Commander or Standard.
  - `seats: 6` refuses it on a four-seat table, with "Three-Headed Giant is played on the 6-seat table (this table has
    4 seats)."
- **Teams: by side, not alternating.**
  - White + Red + Yellow (south) against Green + Blue + Purple (north). This is the spec's layout (§8.1).
  - On the six-seat table's turn order (White, Red, Yellow, Green, Blue, Purple) each side is three seats next to each
    other.
  - The engine's shared life needs that: `configureTeamRules` refuses partners apart in seat order. So alternating
    seats can't be used at Level 1.
  - The teams always follow the sides; teams sent by the table are ignored.
- **Turns:** Level 1, each player their own turn, the team's back to back. A `teamTurns: "shared"` sent with 3HG is
  ignored.
- **Life and poison:** the bridge sends only the teams, as for 2HG. The engine's numbers for three apply:
  - 45 life and 20 poison in constructed: rule 810.11, read in the spec;
  - 120 life and 63 commander damage in Commander: the engine's own 40 and 21 a head.
  - The setup line says "shared life: 120 a team, poison 20" (45 in Standard).
- **Seats filled:** all six are needed (seated players plus AI players), else the start is refused saying so.
- **Board:** the board's sides of three, the team life tip ("Team life: Green + Blue + Purple"), poison out of 20, and
  the team win all work without change. They read the engine's team numbers.
- **Joint block panel:** it is already data-driven: the engine's title, lines and current blocks. A team of three gets
  both partners named in their seat colours, and the third partner's settle notice. This is tested.
- **Not done here:** the table (`engine-renderer.lua`).
  - `mtg mode 3hg` and the Teams button on the six-seat table aren't there, so today the table can't send
    `teamMode: "3hg"`.
  - The table tests need the TTS save, which isn't in the cloud session.

## Engine

**What I checked, with a new `ThreeHeadedGiantTest`** (6 checks, 6 of 6 pass):

- the request gives 45 life and 20 poison;
- a Bolt to one head takes life from all three;
- 19 poison doesn't lose, and 20 loses all three, with the other team still in;
- one player's concession concedes for all three;
- the defending team of three blocks as one decision: Green, Blue, Purple, then Green and Blue again after Purple's
  change;
- a revise prompt names the partner who changed.

**One change was needed.** In a team of three, a revise round's title named every partner ("Green and Purple changed the
blocks. Agree or change?"), though only one of them had changed the block.

- Forge: `Combat.teamBlockChangedBy`, set by `PhaseHandler` when an answer changes the team's block and cleared when
  the block ends.
- Harness: the title names that player. Round 1 still says "Block with Green and Purple".
- This is in `engine/forge.patch` (Combat, PhaseHandler) and `engine/manabrew.patch` (the controller and the new test),
  with a `docs/engine-changes.md` row: "engine1117-3hg".
- Both patches apply to clean trees at the pinned commits.
- `TeamGameTest`, `SharedCombatTest` and `SharedTurnsTest` still pass.

**No change needed** for life and poison mirroring (`sharedLifeTeam` is the whole team), the team loss (every teammate),
the formulas (by team size), and the level-1 joint block (any team size).

## Tests

- **`node tests/test_bridge_3hg.js`:** 26 of 26.
  - Its relay-flow checks need the engine's preset decks at `manabrew/public/preset_decks`; I linked a Manabrew tree.
  - It checks Blue plus five Forge AIs through to `gameConfig`, every colour's team, and no life sent.
- **Regression:** all pass.
  - `test_bridge_team_modes` 49 of 49.
  - `test_bridge_teams` 35 of 35.
  - `test_bridge_2hg_level2` 47 of 47.
  - `test_bridge_2hg_team_block` 56 of 56.
  - Every text that `tools/mutate-team-modes.js` mutates still matches exactly once.
- **Golden:** recaptured with `node --max-old-space-size=8192 tools/capture_bridge_golden.js`, and its two-run check
  passed.
  - The 1076 scenarios already on main are byte-identical, and 3 are new:
    - "3HG: a start on the four-seat table is refused"
    - "3HG: four of six seats is refused"
    - "3HG: six seats, the sides as teams, to gameConfig"

## Break-its

- **`node tools/mutate-3hg.js`:** 9 mutations, each restored by sha256. The run without the golden test caught 9 of 9:
  - the six-seat rule;
  - Commander only;
  - either game mode refused;
  - teams as sent;
  - shared turns allowed;
  - alternating seats;
  - any player count;
  - 2HG's life in the words;
  - the start's seat check.
- **The same with `--golden`:** 9 of 9 caught. The mutations that change what the golden scenarios record also fail
  those by name, for example "3HG: a start on the four-seat table is refused: effect #1".
- **`node tools/mutate-3hg-engine.js <engine tree>`:** 6 of 6 caught by name:
  - the revise title naming every partner;
  - who changed never recorded;
  - only the first defender re-asked;
  - life shared with two of the team;
  - a loss taking one teammate;
  - poison fixed at 15.

## Questions for the user

1. **3HG Commander life.** Is it 120 (the engine's 40 a head), 90 (Wizards' 60 scaled, 30 a head) or 75 (60 + 15, as
   810.11 adds)? The spec (§8.1, question 2) lists 90 and 75. The peer's brief and the engine say 120. Commander damage
   is 63 (21 a head) against the spec's 21 from one commander.
2. **3HG in Standard too?** It is allowed in both game modes, like the request's 45 and 120. 2HG is Commander only by
   the owner's earlier call.
3. **Level 2 for 3HG** (one team turn): not offered. Should it be?
4. **The table:** `mtg mode 3hg` and a Teams button for the six-seat table are table work (`engine-renderer.lua`), left
   for the owner's PC.
