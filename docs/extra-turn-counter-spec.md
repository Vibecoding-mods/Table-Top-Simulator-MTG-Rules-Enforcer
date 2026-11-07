# Extra-turn counter next to a player's life (asked 2026-11-06)

The user's words: "If someone has an extra turn put a number counter next to their health that increases based off
how many extra turns they have, it starts at 2."

## Behaviour

- A small number badge beside the player's life counter, shown only while that player has extra turns coming.
- The number is **extra turns coming + 1**: one extra turn shows **2**, two show **3**, and so on (read as "2 turns
  in a row"). Each extra turn added raises it by one; each one taken lowers it; at no extra turns left it disappears.
  (Interpretation to confirm with the user: "starts at 2" read as turns in a row, not as a count of 2 extra turns.)
- The turn being played as an extra turn still shows the existing " (extra turn)" header and EXTRA TURN label; the
  badge counts only the ones still to come.
- Hover text: "AI 1 has 1 extra turn coming" / "… 2 extra turns coming".
- Log: the existing extra-turn lines stay; when the count goes up, "White will take an extra turn (2 coming)".

## Where the number comes from

Forge already keeps it: `Player.getExtraTurnCount()` (PlayerView `ExtraTurnCount`), set by
`PhaseHandler.addExtraTurn` for every player and again at each turn start (`getExtraTurnForPlayer`), so it rises when
Time Walk resolves and falls when the turn begins.

- **Harness:** `InteractiveSnapshotExtractor.toPlayer` adds `extraTurnCount` next to `isExtraTurn` (line ~310).
- **Protocol:** `PlayerDto` gains `extra_turn_count: u32` with a serde default of 0
  (`manabrew-rs/crates/manabrew-protocol/src/game/mod.rs`, beside `is_extra_turn`). A protocol change: rebuild BOTH
  images (mtg-forge-node and mtg-relay), one build at a time.
- **Bridge:** a `PLAYER_MARKS`-style field on the table row (`extraTurns`), mapped in bridge/table-map.js; the log
  line above from the rise.
- **Table:** the badge drawn beside the life counter (no new main-chunk local in the renderer).

## Tests

- Bridge cases: 0 → no badge; 1 → "2"; 2 → "3"; a turn taken lowers it; a rewind past Time Walk removes it; a missing
  field (old engine) shows nothing.
- Headless engine check: Time Walk twice in one turn gives 2, then 1, then 0 over the next turns.
- Real table: cast Time Walk, see "2" by your life, take the extra turn, see it go.

## Size

About 2–3 h with the checks, plus two image builds. Fits with any other engine change (e.g. the Forge Star Trek
update) so the images are built once.
