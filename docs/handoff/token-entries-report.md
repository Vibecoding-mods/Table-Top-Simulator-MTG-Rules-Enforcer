# Report: identical tokens as one table entry

Cloud session, 2026-11-17, branch `cloud/token-entries` from `origin/main` f63de76. Not tried on the real table. No
permission prompt is pending.

**Not run here: the table golden (`tests/test_table_golden.js`).** It needs the Workshop table save
(`2296042369.json`, or `MTG_TABLE_JSON`), and the cloud session has only its profile. See "To run on the PC".

## What changed

- **Bridge (`bridge/bridge.js` `tokenRuns`, `packRunIds`).** After a board's zones are slimmed, each battlefield list is
  scanned.
  - **A run:** tokens next to each other that are the same in everything the table reads. That means:
    - their whole slim entry except the id (name and details, P/T, counters, tapped, damage, attacking and at whom,
      blocking and whom, `inf`, status words, notes, peeks, and so on);
    - their fixed details (the `sentStatic` key: picture, type line, token flag).
  - **What goes out:** the run's first entry with `gi`, the other ids.
    - "engine-card-N" ids in a row go as `[first N, count]`, so 1,000 tokens made together are `"gi":[[1001,999]]`.
    - Any other id goes as itself.
  - **The other tokens' details** and rules text aren't sent, and they count as never sent. So a token that later
    stands alone gets its own details in full. That stays true when the outbox replaces an older board with a newer one.
  - **Changed details:** if another token's details changed in a board (its picture found later), that battlefield goes
    out whole, not as `keep`.
  - **Only for a table that says so:** runs are sent only when the table's hello says `tokenRuns` (as with
    `keepRewind`). An older table gets every token as before.
  - **The count:** it isn't a separate field. `n` is already the card's name in table entries, so the count is
    `1 + gi`'s ids, and the ids are needed anyway for clicks and lines.
- **Table (`tools/engine-renderer.lua`).**
  - `mergeStatic` stores the card details first, then lays each run out again (`engineExpandRuns`): one entry per
    token, each a deep copy of the first with its own id and its details pointed at the first one's.
  - Everything after `mergeStatic` (`groupTokens`' stacks, combat parts, splits, clicks, lines, badges) reads the same
    per-token board it always did.
  - The hello says `tokenRuns = true`.
  - Lua rules:
    - main-chunk locals: 91, unchanged; lua-scan local names: 175, unchanged;
    - no `local` in a for-in loop body;
    - no new patterns;
    - no new buttons.
- **`tools/deploy.js` GATES:** `test_table_token_entries` is added.

## Why not "the renderer's stacks read n"

- I chose to lay the runs out again in `mergeStatic`, rather than have `groupTokens` and the rest read a count:
  - the renderer reads token ids in many places (`engineGroupList`, combat parts, splits, held picks, lines, clicks,
    `engineStatic`, targets);
  - the table golden can't run in this session to check a rewrite of those.
- **This way every board is the same by construction,** and most of the cost is still gone: real TTS decodes JSON at
  about 15 ms a KB, and the decode was most of the per-token cost.
- **What still grows with the tokens:** the copies in `mergeStatic`, and the drawing after it.
- **A next step,** if wanted: `groupTokens` takes a run as a stack directly, and splits it only in combat.

## Measured

`node tests/test_table_token_entries.js`, the first board of N identical Soldier tokens:

| Tokens | Bytes before | Bytes after | Decode + merge before (fengari) | After |
|---|---|---|---|---|
| 1 | 782 | 782 | 0.4 ms | 1.4 ms (noise) |
| 50 | 8,720 | 799 | 5.9 ms | 1.7 ms |
| 1,000 | 162,620 | 800 | 127 ms | 33 ms |

- **Real TTS, at about 15 ms a KB:** the 1,000-token board's decode goes from about 2.4 s to about 12 ms.
- **The fengari time:** the table's own decoder (`engineJsonDecode`) plus `mergeStatic`. The 33 ms left is the copies.

## Tests

- **New `tests/test_table_token_entries.js`: 23 of 23** (no save needed).
  - **The method:** the bridge sends the same boards with runs and without. The renderer's real `mergeStatic` and run
    functions, with `engineJsonDecode`, take every table message in order on fengari. What the table reads must be
    identical: every zone of every player, and every card's details by id.
  - **The boards:**
    - 1, 50 and 1,000 tokens, over three boards: one taps and a new one comes, then the first dies;
    - a mixed board over three boards:
      - tapped, countered, attacking, infinite, damaged and enchanted tokens;
      - another kind with ids not in a row;
      - a non-token between two runs;
      - a Goblin alike in all but its details;
      - ids that aren't `engine-card-N`;
      - the other player's tokens;
    - nothing alike;
    - a board replaced in the outbox before the table took it.
  - **Also checked:**
    - the 1,000 tokens' ids go as one range;
    - the board is under a tenth of its old size;
    - a hello without `tokenRuns` gets every token, and one with it gets runs;
    - the table's hello says `tokenRuns`;
    - the decode is faster.
  - **With the Workshop save** (skipped here), the test also replays the table golden's own games through the fake TTS,
    as recorded and with their token runs packed. Every step's effects (objects, `setVectorLines`, UI) must be
    byte-identical.
- **Regression:** every one of the 75 GATES gives the same result on this branch as on `origin/main` f63de76. I ran
  both trees here; the only differences in the output are the worktree paths.
  - `test_bridge_golden`: all 1084 scenarios match, unchanged. Its scenarios have no hello with `tokenRuns`, so no runs.
  - The gates that need the Workshop save fail to build or skip on both trees: `test_table_golden` and the others that
    use `buildSave`.
- **Break-it: `node tools/mutate-token-entries.js`: 16 of 16 caught by name**, every file restored by sha256.
  - Bridge:
    - no runs;
    - runs to a table that doesn't read them;
    - details not compared;
    - any token joins a run;
    - a range one short;
    - ids out of a row as one range;
    - changed details kept rather than resent;
    - the others counted as sent;
    - the others' details still sent.
  - Table:
    - runs not laid out;
    - a range one late;
    - a plain id dropped;
    - the others' details not set;
    - runs laid out before the details are stored;
    - the run marker kept;
    - the hello without `tokenRuns`.
  - Three survived the first run and are now caught:
    - the hello check now goes through `onTTS`;
    - the outbox case now really replaces a board (an empty board first takes the line);
    - non-`engine-card-N` ids were added to the mixed board.

## To run on the PC (with the Workshop table)

1. `node tests/test_table_golden.js`: must pass unchanged. The recorded streams carry no runs, and the renderer's change
   does nothing to them.
2. `node tests/test_table_token_entries.js`: the fake-TTS part runs, one check per golden game. That code has not been
   exercised here.
3. A live board of many tokens (the Scute Swarm scenario): it should look and click the same, with a smaller message.
