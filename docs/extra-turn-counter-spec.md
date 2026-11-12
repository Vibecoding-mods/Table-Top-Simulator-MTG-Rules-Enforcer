# Extra-turn counter next to a player's life (asked 2026-11-06)

The user's words: "If someone has an extra turn put a number counter next to their health that increases based off
how many extra turns they have, it starts at 2."

**Status 2026-11-11: built and deployed.** Bridge, log line and table badge in 7c33b9f; the engine half in the Star
Trek update (bfba2e0). No protocol change was needed: `PlayerDto.extra_turn_count` was already upstream, but it sent
Forge's `getExtraTurnCount`, which counts only the unbroken run at the bottom of Forge's queue (wrong once two
players have extra turns queued, Time Walk then Nexus of Fate; tests/live_extra_turn_check.js), so the harness sends `ExtraTurnState.queuedFor` instead, every extra turn queued for the
player, and a rewind puts the queue back. The turn header's " (extra turn)" reads Forge's `isExtraTurn` (core-moves
fix 3), not the turn-order guess. Left: the real-table check under Tests.

## Behaviour

- A small badge beside the player's life counter, shown only while that player has extra turns coming.
- **Changed 2026-11-12** (the user, after live check batch 1 item 4 showed "2" for one extra turn): the count starts
  at 1 and counts the extra turns. One extra turn shows **EXTRA TURN**, two **EXTRA TURN 2x**, n **EXTRA TURN nx**.
  Each extra turn added raises it by one; each one taken lowers it; at no extra turns left it disappears. (Before, it
  was a lone number, extra turns coming + 1, the "starts at 2" read as turns in a row; that reading was wrong.)
- The turn being played as an extra turn still shows the existing " (extra turn)" header and a plain EXTRA TURN label
  under the life total, with no number: it says this turn is one. The badge counts only the ones still to come (Forge's
  count drops as each extra turn begins), so with Time Walk twice the first extra turn shows the label EXTRA TURN and
  the badge EXTRA TURN (one more coming), and the second shows the label alone.
- The badge lies across the counter's top-left lobe, its right edge clear of the [R], growing to the left, at the
  largest font it fits in (175 for one, 135 for "2x", 120 for "10x").
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

- Bridge cases: 0 → no badge; 1 → "EXTRA TURN"; 2 → "EXTRA TURN 2x"; a turn taken lowers it; a rewind past Time Walk
  removes it; a missing field (old engine) shows nothing.
- Headless engine check: Time Walk twice in one turn gives 2, then 1, then 0 over the next turns.
- Real table: cast Time Walk, see "EXTRA TURN" by your life, take the extra turn, see it go.

## Size

About 2–3 h with the checks, plus two image builds. Fits with any other engine change (e.g. the Forge Star Trek
update) so the images are built once.
