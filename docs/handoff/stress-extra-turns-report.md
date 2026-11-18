# Report: the extra-turn badge past 99 (stress catalog #21)

Cloud session, 2026-11-17, branch `cloud/stress-extra-turns` from `origin/cloud/static-pass` (2df32e2).
- Table only (`tools/engine-renderer.lua`), plus one bridge comment. No engine change, no protocol field, no Rust
  literal, no new screen XML.
- Not tried in TTS. No permission prompt is pending.

## Which item

The catalog's open items, top first:
- **#21, the extra-turn badge.** It is the top open item that can be done and checked here.
- **#23, graveyard and exile piles respawned.** It asks for a live measurement first (`tts-shot`/PresentMon), which
  needs TTS.
- **#8's spread of a big draw's spawns over frames** is also left, for the same reason.
- **#22, #24 and #25** are "keep as is".

## What was wrong

**`engineExtraTurnBadge` read "EXTRA TURN nx" at any count.** It tried fonts 175, 150, 135 and 120 for the badge's
room: from x -2 to 0.55 on the tracker, 1,224 button units.
- "EXTRA TURN 99x" already needs 120.
- "EXTRA TURN 1000x" is 1,240 wide at 120, so it ran past x -2, toward the commander-damage icon from -2.13 on two
  seats.
- "EXTRA TURN 123456x" was 1,380 wide.

## The change

- **Up to 99:** as before, "EXTRA TURN", "EXTRA TURN 2x" … "EXTRA TURN 99x".
- **Past 99:** "EXTRA TURNS 99+", 15 letters, which fits at 120 (1,170 of 1,224). That is 99's font.
- **The hover always names the real count:** "AI 1 has 4321 extra turns coming".
- **Past 99 only the hover changes as a turn is taken.** The badge already edits its one button when the label or
  the hover differs, so 5,000 then 4,999 edits the hover in place.
- **The bridge still sends the real count** (`extraTurns`). Only its comment changed.

## Tests

**`tests/test_table_extra_turns_lua.js`: 40 checks, new, in GATES.** It needs no TTS save: it runs the renderer's own
`engineMarksWidth`, `engineExtraTurnTip` and `engineExtraTurnBadge` in fengari, on a fake tracker. The counts tried
are 1, 2, 10, 99, 100, 999, 1,000, 123,456 and 2^31−1. For each:
- the label;
- the hover's exact count;
- the badge inside x -2 to 0.55 with its right edge at 0.55, at z -1.45, at a font of at least 120;
- one button on the tracker.

**A sequence on one tracker:** 5,000, 4,999, 100, 99, 3, 0, then no count. It checks:
- the hover edited past 99;
- the number back at 99;
- the badge gone at 0 and with no count.

**Also:**
- the font past 99 is 99's, the same for every count;
- one extra turn is still at 175.

**Red first:** 11 checks failed before the change, every one past 99.
- One of my own first checks was wrong, not the code: I had guessed "EXTRA TURNS 99+" would get a larger font than
  "EXTRA TURN 99x". Both are 120, so the check now asks for the same font.

**`tests/test_table_claims.js` (needs the Workshop save, so not run here):**
- "badge fit" has four more cases on all four trackers: 99, 100, 1,000 and 123,456, the last beside seven marks. Each
  is placed against the tracker's own life number, -20 and [R], the marks boxes and the commander-damage icons.
- The extra-turn counter test has 99, 100, 4,321 and 4,320 through a real table message: the label, the real count in
  the hover, and one button.

**Break-it: `node tools/mutate-extra-turns.js`: 6 of 6 caught by name.** The real `engine-renderer.lua` was unchanged
(sha256); each mutation was made in a copy (`RENDERER_LUA`), and the copy was removed. The mutations:
- no cap;
- the cap at 999;
- 99 itself capped;
- "EXTRA TURN 99x" past 99;
- the hover's count capped at 99 too;
- a hover-only change not edited.

## Gates

- **Repo GATES** (with the `manabrew` link to the engine tree for the run, removed before the commit): the same as
  prompt-shapes' run, apart from:
  - the new `test_table_extra_turns_lua` (40);
  - `test_bridge_golden` "all 1084 scenarios match": prompt-shapes' run was from before its own re-record.
- **The gates that need the Workshop save** can't run here, as before. That includes `test_table_claims` with the new
  cases.
- **Lua:** no new main-chunk locals and no new patterns; `test_moonsharp_patterns` and `test_moonsharp_loop_locals`
  pass.

## Not done

- No live TTS check of the badge at "EXTRA TURNS 99+".
- #23 and #8's frame spread need a live TTS measurement.
