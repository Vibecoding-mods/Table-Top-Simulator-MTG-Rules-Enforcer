# Report: Archenemy on the six-seat table

Cloud session, 2026-11-17, branch `cloud/archenemy-six`, from `origin/cloud/archenemy-audit` (`b03e30f`).

- No engine code changed: only `ArchenemyTest` (in `engine/manabrew.patch`), plus the bridge, the table script and
  the tools.
- The engine already took one archenemy against any number of players; the bridge refused the six-seat table.

## What changed

**The bridge** (`bridge/teams.js`, `bridge/bridge.js`):

- **The refusal is gone.** "Archenemy is played on the 4-player table for now" no longer stops a start; the archenemy
  can face one to five others.
- **The teams cover the table's own seats.** `setupOf(m, colors)` and `archOf(raw, colors)` take the table's seats,
  defaulting to the four as before. The bridge passes its `TABLE_COLORS`, and the new `archTeams(color, colors)` puts
  the archenemy alone on team 1.
- **`mtg archenemy <colour>`** takes the table's seats (Green and Purple on the six-seat table, not on four), and the
  switch's teams use them too.
- **The setup words** name the others from the teams themselves: "Archenemy: Purple (80 life, goes first, 20 random
  schemes) vs White + Red + Yellow + Green + Blue (40 life each, …)".
- **A seat not in the game** is refused with "fill all six seats" on six seats, and "four" on four as before.
- **Life** is as on four seats: double the format's (80 against 40, or 40 against 20 in Standard). The 40 against 20
  is rule 904.5's.

**The table** (`tools/engine-renderer.lua`, Lua rules kept: main-chunk locals 189, no loop locals, plain finds):

- **The setup button** is drawn on either table.
  - It goes round the table's seats in turn order: on six seats the profile's White, Red, Yellow, Green, Blue, Purple
    (`engineArchSeats`), then off.
  - Its spot is the Teams button's strip plus 10 (x −49, z 27.5), inside the six-seat table's cleared west strip
    (z −8.5 to 33).
- **The scheme spots on six seats.** Every mat there is on a long side (z ≈ ±14.9), so a 4-player-style "0.42 of the
  way to the centre" in x would have put the schemes between two seats. Now:
  - the schemes keep the archenemy's mat x, in front of their own seat;
  - they come 0.42 of the way in z, toward the middle strip;
  - the ongoing row runs toward the table's centre line in x;
  - the deck lies on the outer side.
- **Clearances,** at the oversized scheme size (1.4) and with White's real six-seat mat (x 27.3, z −14.9):
  - clear of the corner seat's life-tracker column (x 41.8), even with four ongoing schemes;
  - clear of a plane at the centre;
  - clear of the stack over the mat.
- **The banner** and the rest of the drawing are the same code as on four seats.

**Headless** (`tools/headless-six.js --archenemy`, `tools/m6-stream.js --archenemy`):

- **The engine game.** A real six-seat Commander game through `ManaBrewEngineAdapter`, recorded:
  - Purple (an AI seat) the archenemy at 80, first, with the first 20 schemes of `bridge/forge-schemes.json`;
  - the other five on one team at 40.
  - Turns 1–7: Purple, White, Red, Yellow, Green, Blue, Purple. No problems, no stall.
- **The bridge replay.** Replayed through the sandboxed bridge with the table's Archenemy start, giving the new
  fixtures `six-seat-relay-archenemy.json` and `table-stream-6p-archenemy.json`: 118 messages, 53 boards.

## Tests

- **`tests/test_bridge_six_golden.js`:** 30 of 30. The new Archenemy part checks:
  - the setup words;
  - the six players;
  - Purple marked as archenemy at 80 with a scheme deck of 20, the five at 40 and unmarked;
  - the teams (five against Purple, `archenemy: Purple`);
  - the turns from Purple round the six;
  - a scheme set in motion on turn 1 that shows among the board's schemes while face up;
  - no bridge error;
  - the stream message by message against its recording.
- **`tests/test_bridge_archenemy.js`:** 80 of 80. The three six-seat refusal checks became six-seat start checks:
  - Purple, an AI seat, against five;
  - gameConfig: one player on team 1, 80, first, with the schemes; five on team 2;
  - Standard 40 / 20;
  - `mtg archenemy purple` and the switch;
  - Purple refused on four seats;
  - the "six seats" refusal;
  - unit checks of `archOf`, `archTeams`, `setupOf` and `setupWords` with six seats.
- **`tests/test_table_archenemy_view.js`:** 56 of 56. New:
  - the button's six-seat round, and Purple / Green only on six;
  - the scheme spots on a six-seat mat, and the clearances above.
- **`ArchenemyTest`** (harness): `sixSeats theArchenemyFacesFiveAsOneTeam`.
  - Six players; Standard 40 + 5 × 20 and Commander 80 + 5 × 40.
  - Five opponents of the archenemy, all one team, one archenemy.
  - A scheme set in motion on six seats.
  - 17 of 17.
- **`test_bridge_golden`** is unchanged (1084 scenarios): the four-seat refusal still says "four".

## Break-it

`node tools/mutate-archenemy-six.js`: **13 of 13 caught by name**, files restored by sha256.

- the six-seat refusal back;
- `setupOf`'s teams, `archOf`'s colours, the bridge's `setupOf` call, `mtg archenemy`'s colours and the switch's teams,
  each left at four seats;
- the setup words naming the four;
- the refusal saying "four seats";
- the button on four seats only, and the button going round the four;
- the six-seat schemes between two seats;
- the row running toward the edge;
- the stream's Archenemy start dropped.

## Gates

- **Run here:** 62 of 100 deploy GATES pass. The other 38:
  - 36 need the TTS Workshop save;
  - `test_bridge_claims`, whose live files guard fails on the base too;
  - `test_editor_forward`, for want of IPv6.
- **The full harness suite** wasn't rerun: no engine code changed. `ArchenemyTest` was run, 17 of 17.
- `engine/manabrew.patch` was regenerated (only `ArchenemyTest`); `git apply --check` is clean on `fd16e2f` /
  `e7d2b93b`.

## Not done

- **The six-seat table golden** (`tests/test_table_golden_six.js`) builds the table from the TTS Workshop save, which
  isn't here. So it wasn't extended with the Archenemy stream, and its recording can't be made here. To do it where
  the save is:
  1. add `table-stream-6p-archenemy.json` as a second stream in that test, as `table-stream-6p.json` is;
  2. record it.
- **No real-table look** at the button's spot or the schemes on six seats.
- **904.2's shared team turns** for the opposing team: still each player's own turn, as on four seats
  (`docs/handoff/archenemy-audit-report.md`).
