# Report: the snapshot's shared part built once per round, not once per viewer

Cloud session, 2026-11-17, branch `cloud/snapshot-viewers` from `origin/main` (f4f614d). The engine change is
`engine1124-snapviewers` in `docs/engine-changes.md`.
- `manabrew.patch` only (the harness); `forge.patch` is unchanged. No protocol change, so no Rust literal.
- Not built into an image, not tried live. No permission prompt is pending.

## The item

`docs/handoff/open-after-1121.md` §3: "the rest of the snapshot is still linear work per viewer, about 300 ms at 10,000
tokens, mostly building the JSON".
- snapshot-speed had removed the quadratic part: the combat flags.
- What was left: `InteractiveSnapshotExtractor.snapshotJson` builds every card (`toCard`), turns it into a `JsonObject`
  and serializes the whole view, again for each viewer.

## Which parts depend on the viewer

I read every use of the viewer in `buildGameView` and `toCard`. For a battlefield card, only three things:

1. **`choices`:** a secret chosen type, shown to its chooser only (`SecretChoiceVisibility`).
2. **`mayPlay` / `playCost`:** whether the card is in the viewer's "playable outside the hand" set. That set is built
   from the viewer's external zones, graveyard and exile, so no battlefield card is ever in it.
3. **The face-down redaction** after `toCard` (CR 707.7: shown to its controller).

Everything else in a battlefield card is the same for every viewer: P/T, types, counters, combat, flags. That includes
the combat flags, which `SnapshotRound` already shares.

The other zones are small, or depend on the viewer by nature (hands, libraries' tops), and are left as they were.

## The change

**`SnapshotRound`** is the round `pollAction` makes while the game waits for an action: the state is frozen and the
viewers of that wait share it. It now also keeps each battlefield card's serialized JSON, with the viewer's view of its
`choices`.

For each battlefield card, each viewer:
- **Face-down, a mutate pile, or playable from outside the hand:** built as before. The last can't happen; the guard
  stays.
- **Otherwise:**
  - its `choices` are worked out for this viewer;
  - if the round kept this card with the same `choices`, the kept text is used;
  - if not, it is built as before and kept.
- **The kept text** is written with Gson's `JsonWriter.jsonValue` (a `RawJson` wrapper with its own adapter). It is
  exactly what the same `GSON` writes for that `JsonObject` in place, so the bytes don't change.

**Outside a round** (`getSnapshotJson` with no wait: a fresh `SnapshotRound` each call) nothing is reused.

**Also new:**
- `InteractiveSnapshotExtractor.shareCards` (true) switches it off. Off is the old code path.
- `sharedBuilds()` counts the battlefield cards built.
- `ManaBrewInteractiveSession.beginSnapshotRound` / `endSnapshotRound`: what `pollAction` now calls, and what the tests
  use.

## Numbers (`SnapshotViewersTest`'s timing, 10,000 Grizzly Bears tokens over 3 players, best of 3, two runs)

| | Built alone (off) | In a round: the first viewer | each next viewer |
|---|---|---|---|
| Run 1 | 266 ms | 271 ms | 50 ms |
| Run 2 | 270 ms | 269 ms | 48 ms |

- **The first viewer** costs the same as before.
- **Each next one** is about 5.5× faster.
- **For 4 viewers** (3 players and a spectator): about 1,070 ms → 420 ms per state.
- **What's left per viewer:** the other zones, the `choices` check per card and joining the kept texts.

## Tests: `SnapshotViewersTest`, 10 checks (new)

Written first; its first run was a compile failure on the missing switch, counter and round hooks.

**Byte for byte** (the per-viewer byte compare):
- The viewers are 0, 1, 2, a spectator (−1), 0 again and 2 again, in one round with sharing on.
- Each snapshot must equal the one built alone with sharing off. A mismatch prints the first byte that differs.
- Each board also checks that viewers 0 and 1 get different snapshots (someone holds cards), so a board that is the
  same for everyone can't pass by accident.

The boards:
- **A mixed board:** 30 tokens; Serra Angel; a chosen colour; Pacifism on a Bear; a tapped Wall; hands; graveyards
  with a flashback card.
- **In combat:** attackers at two players, a blocker. The snapshot shows `isAttacking`.
- **2,000 tokens.**
- **A face-down Hill Giant:** its name is in its controller's snapshot only.
- **A secret chosen type** (`setSecretChosenType`, remembered for one player): "Elf" is in that player's snapshot only.
- **A mutate pile:** the Hill Giant under it rides the top card (`attachedTo`).
- **Between rounds:** a token tapped and damaged and Glorious Anthem added. The next round sees the change, byte for
  byte.

**Sharing:**
- In one round the first viewer builds every battlefield card, and the next three build none.
- Outside a round two viewers build every card twice.

**Timing:** at 10,000 tokens each viewer after the first is at least 3× faster than building alone. It is about 5.5×.

## Break-it: `node tools/mutate-snapshot-viewers.js <engine tree>`: 6 of 6 caught by name

`InteractiveSnapshotExtractor.java` was restored by sha256 after each mutation. The mutations:
- a card kept regardless of the viewer's `choices` (caught by the secret type);
- face-down cards shared;
- mutate piles shared;
- the kept JSON written as a quoted string;
- cards kept across rounds;
- the switch ignored.

**Not a mutation:** the playable-outside-the-hand guard. It can't be reached from the battlefield (see above), so it is
noted in the tool and not mutated.

## Gates

- **Harness:** `engine/test-harness-local.sh --all`: **47 of 47 classes pass**. That includes `SnapshotSpeedTest`, the
  snapshot / protocol tests and the golden-driven harness tests.
- **Repo GATES** (the `manabrew` link pointed at this engine tree for the run, removed before the commit): the same on
  this branch as on `origin/main`, line for line.
  - `test_bridge_golden`: all 1,084 scenarios match.
  - `test_bridge_six_golden`: 18 of 18.
  - The bridge goldens replay recorded engine output, so they show the bridge is unchanged, not the extractor. The
    extractor's proof is the byte compare above.
  - `test_table_golden` and the other gates that build from the Workshop save can't run here, as before.
- **Patches:** `git apply --check` clean on a fresh `fd16e2f` worktree. Only `InteractiveSnapshotExtractor`,
  `ManaBrewInteractiveSession` and the new test changed in the patch. No comments in the harness Java diff.

## Not done

- No image, no live relay with several viewers. The win depends on the viewers of one wait asking during that wait,
  which is what `SnapshotRound` was made for.
- The first viewer's snapshot is unchanged (about 270 ms at 10,000 tokens).
- The round assumes the state is frozen while the game waits for an action. The combat-flag cache already relies on
  that.
