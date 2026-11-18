# Report: live check 1's three table findings

Cloud session, 2026-11-18, branch `cloud/live-check-1-fixes`, from `origin/main` (`f4f614d`). No engine change. The
table (`tools/engine-renderer.lua`) and, for item 2, two fields from the bridge (`bridge/bridge.js`).

## 1. The GIF frame over the banners under SPELLS THIS TURN

**Why it happened.**

- **The banners** (the player's marks: SPELLS THIS TURN, then the effects, MOSSWORT BRIDGE, STOMP, …) are buttons on
  the life tracker. They stack down the mat's inner corner from the counter (`enginePlayerCounters`, `ENGINE_MARKS_FIT`).
- **The GIF frame** takes the first free spot from a list beside the battlefield grid (`engineGif.freeSpot`, `SPOTS_R` ×
  `SPOTS_F`), and "free" meant "no object there". Buttons aren't objects, so the strip looked empty.
- On the 4-player table, White's first spot (15.2 right, −7.5 forward of the mat) is world (4.2, −7.9): the live
  finding's spot, on the strip.

**The fix.**

- **`engineMarksStrip(color)`** is the strip the boxes may ever fill: all `ENGINE_MARKS_FIT.boxes` of them (the last one
  "+n MORE") at the tallest one-line box, from `top` down, `inner` toward the middle to `max` wide.
  - It is in the tracker's button coordinates (x negated, as for mat-zone UI), from the tracker's own transform, so it
    is right on every seat of either table.
  - The whole strip is kept clear, not just the boxes shown now, because the frame is placed once and the boxes grow
    during the turn.
- **`engineMarksStripHit`** is the frame's square against it. `freeSpot` skips a spot that reaches it.
- **If every spot is taken by objects,** the frame goes to the first spot off the strip (it used to take the first spot,
  which is on it).
- **Kept as it was:** a frame already on the table, which a respawn keeps where it lies; a frame its owner dragged.

**Where the frames go now** (no other objects, the test's runs; candidate order unchanged):

- **4-player:**
  - **White** at (4.2, −21.1), 5.7 forward on the same inner side, instead of (4.2, −7.9).
  - **Yellow**, its mirror: (−4.2, 21.1) instead of (−4.2, 7.9).
  - **Red** (−34.6, −7.9) and **Blue** (34.6, 7.9) are unchanged: their first candidate is on the mat's outer side,
    never on their strip.
- **6-player:** every seat's first candidate is already clear of its strip, so none moves: White (12.1, −7.4), Red
  (−17.3, −7.4), Yellow (−46.7, −7.4), Green (−12.1, 7.4), Blue (17.3, 7.4), Purple (46.7, 7.4). The fix matters there
  only once objects take the earlier spots.

## 2. FROM EXILE

- **Bridge:** a playable row card in exile gets `og: "exile"`, as a graveyard one gets `og: "graveyard"`. It also gets
  `ogw`, why it may be cast from there, when the board says:
  - the card that let it be played, from `playNote`: "Castable until end of turn, by Outpost Siege";
  - "exiled for madness";
  - "warped".
- **Not on a card face down to the others** (a foretold card): the label is a button every player may see, the same
  rule as the cost badge.
- **An adventure creature on its adventure** gets FROM EXILE with the plain hover. Forge's card view doesn't send
  `isOnAdventure`, and an engine change is out of scope.
- **Table:** `engineCostParts` draws "FROM EXILE" for og "exile", where FROM GRAVEYARD goes. Its hover is "Playable from
  exile", then ": " and the `ogw` when there is one.
- `engineCostText`, the badge's change key, now includes the hover, so a change of why redraws it.
- `bridge/table-map.js` describes `og` (now both) and `ogw`. `test_table_map` asked for it.

## 3. The planned attack line

**Why it was faint.**

- 0.12 wide (target lines are 0.30, attack lines 0.22);
- its seat colour mixed halfway to white, so White's line was pale white;
- on a low fixed arc (lift 0.5) that the cards hid;
- 5 dashes.

**Why it crossed White's counter.** On the 4-player table the four counters sit in the middle, 7 apart. A straight line
from White's front row to Red's counter passes over White's own.

**The fix** (planned lines only; declared attack lines are unchanged):

- **Width 0.2601.** Our lines are told apart by width, so it is a width no other line has: target 0.3001, attack
  0.2201, block 0.1601, the team border 0.3501.
- **Colour** a quarter toward white, not halfway: Blue reads (0.34, 0.65, 1.00), White stays white.
- **Arc:** a target line's height (0.5 + 0.12 × length, not a fixed 0.5).
- **21 points, so 10 dashes.**
- **Bent around the attacker's own counter** (`ENGINE_LINE_AVOID.arc`):
  - It is a curve pushed sideways only as far as clears the counter's footprint (`ENGINE_LINE_AVOID`: 3.4 × 2.7 world
    from its centre, plus 0.4).
  - It bends to the side away from the attacker's mat, toward the middle of the table, not over the marks boxes under
    the counter.
  - A line that doesn't cross the counter is drawn as before, unbent.
  - It still starts on the attacker and ends on the defender's counter.

## Tests

**`tests/test_table_live_check_1.js`** (new, in GATES): 62 of 62, on fengari with stand-ins for TTS and the profiles'
real positions. No save.

- **Item 1:**
  - For every seat of both tables, the strip point by point against the test's own working-out of it, from
    `ENGINE_MARKS_FIT` and the tracker's spot;
  - the frame clear of it, and beside its own mat;
  - the live spot reproduced: White's first candidate is (4.2, −7.9), on the strip;
  - with every spot taken, still off the strip.
- **Item 2:**
  - FROM EXILE with the plain hover, and with the why;
  - FROM GRAVEYARD as before;
  - nothing on a face-down card;
  - the bridge: og exile on an adventure creature castable from exile, `ogw` naming Outpost Siege, no og on a foretold
    card or outside the row.
- **Item 3:**
  - the width (≥ 0.25, and its own);
  - the colour;
  - the call (a target line's arc, the planner's counter passed);
  - the live finding reproduced: a straight line from White's front row runs over White's counter;
  - from four spots: the bent line keeps off it, starts and ends where it should, and bends toward the middle;
  - a line clear of the counter unbent;
  - the arc's height;
  - 21 points;
  - the 6-player table.

**Assumptions the test makes:** the profiles hold the trackers' spots but not their rotation or scale, and rebuilding
them needs the save. So the test takes each tracker facing its own seat (the mat's rotY) at the 4-player table's measured
scale, 1.258 (`test_table_claims`' "a 4500-wide label was 11.75 world units"). The Lua reads the real transform at
runtime.

**`tests/test_table_attack_lines.js`** pins the planned line's look, so its pins are moved:

- width 0.1201 → 0.2601;
- 5 → 10 dashes a line (15 → 30 for three lines);
- light blue 0.56,0.77,1.00 → 0.34,0.65,1.00.

Its checks are otherwise unchanged. **Not run here:** it builds the table from the TTS save.

## Goldens

- **`test_bridge_golden`:** 1084 scenarios, re-recorded. **The diff is exactly item 2:** one scenario, "table: linked and
  playable exile". Its playable exile card (face up, `mayPlay`) gains `"og": "exile"` on its two boards, the first and
  "playable again"; nothing else:

  ```
  -         "fo": true
  +         "fo": true,
  +         "og": "exile"
  ```

  (twice, at the two boards; `git diff --stat`: 4 insertions, 2 deletions)
- **`test_bridge_six_golden`:** 18 of 18, unchanged.
- **The table goldens** (`test_table_golden`, `test_table_golden_six`) build the table from the TTS save. They weren't
  rerun or re-recorded here. Where the save is, expect diffs only from these changes:
  - the planned lines (width, colour, points);
  - the FROM EXILE chip, on a board that has a playable exile card.

## Break-it

`node tools/mutate-live-check-1.js`: **17 of 17 caught by name**, files restored by sha256.

- **The frame:**
  - the strip ignored;
  - one box deep;
  - on the wrong side of the counter;
  - the button x not negated;
  - every spot taken, back to the first spot.

  (The last two first survived the frame checks: mirrored, the strip still covers the same candidate spots. The
  point-by-point strip check catches them.)
- **FROM EXILE:**
  - no label;
  - no why;
  - the bridge sending no og, or no why;
  - a foretold card labelled.
- **The line:**
  - thin again;
  - as wide as the attack line;
  - halfway to white;
  - the low arc with no counter passed;
  - never bent;
  - bent to whichever side;
  - 11 points.

## Lua rules

- **Main-chunk locals unchanged:** 189 by the old `^local` count, 91 by a luaparse count of the main chunk's own.
  - The new helpers are globals (`engineMarksStrip`, `engineMarksStripHit`) and functions on the new global
    `ENGINE_LINE_AVOID`.
  - The planned line's code is in the existing `do … end` scope.
- **No bare `local x` in a for-in body** (luaparse count: 0).
- **No pattern functions:** no `find`, `match` or `gsub` added.
- **Mat-zone UI:** the strip's x is the button's, the local x negated.
- The whole renderer compiles under fengari.

## Gates

- **Run here:** 60 of 98 deploy GATES pass, the new test and `test_table_map` among them. The other 38:
  - 36 need the TTS Workshop save, among them `test_table_attack_lines`, `test_table_golden`, `test_table_golden_six`,
    `test_table_claims`, `test_ui_budget` and `test_moonsharp_loop_locals`;
  - `test_bridge_claims`, whose live files guard fails on the base too;
  - `test_editor_forward`, for want of IPv6.
- **Not done:** no look on a real table. On it, look at:
  - White's frame with a few banners;
  - FROM EXILE on an adventure creature;
  - the planned line from White to Red, and on the 6-player table.
