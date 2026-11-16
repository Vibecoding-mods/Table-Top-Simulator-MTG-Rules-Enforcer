# Report: Archenemy rules (plan step 2's leftovers and step 6)

Cloud session, 2026-11-16, on branch `cloud/archenemy-rules` (based on `cloud/archenemy-engine`). No Docker image was
built and nothing was checked live.

## What was built

**Archenemy game:**

- A game is an Archenemy game when the start request says `"archenemy": true`, or when any player brings schemes.
- The node sends `archenemy: true` when `gameConfig.archenemy` is set. It is left out when false.

**Refusals.** Each is an `IllegalArgumentException` from `Archenemy.schemeDecks`, before the game is made:

- no archenemy: "an Archenemy game needs one player with a scheme deck: the archenemy";
- two archenemies: "an Archenemy game has one archenemy, but White, Blue each brought a scheme deck";
- a bad scheme deck size:
  - "White's scheme deck has 19 schemes; it needs at least 20";
  - "White's scheme deck has 3 copies of X; a scheme deck holds at most 2 of each";
- shared team life (`sharedLife` or `sharedTurns`): "Archenemy plays with each player's own life and turns, not
  sharedLife".

**Life (plan §2.7 house rule).** The archenemy starts at 80 in Commander and 40 otherwise, through `startingLife`
(`Archenemy.seat`).

- A starting life the host names for the archenemy is kept.
- The other players keep the format's life: 40 in Commander, 20 otherwise.

**Teams and the win.**

- The archenemy is alone on team 1 and everyone else is on team 2, whatever team numbers the request sent.
- Forge's team win then gives the result:
  - the archenemy wins only when every opponent is out;
  - when the archenemy loses, the others win together (`AllOpposingTeamsLost`).

**Rewind off in scheme games.** No restore points are taken, the same way Planechase games skip them
(`recordCheckpoint` and the fix-op checkpoint). The Undo wording ("not available in Archenemy games") belongs to the
bridge and is not done.

## Tests

- `ArchenemyTest`: 14 of 14 pass, 9 of them new.
- Node unit tests: 3 of 3 pass, 1 of them new (`a_game_config_archenemy_flag_reaches_java`).
- `engine/test-harness-local.sh --all`: 26 of 26 classes pass.

| New check | Break-it | Fails with |
| --- | --- | --- |
| aStartWithNoArchenemyIsRefused | the no-archenemy refusal off | "a start was accepted that should be refused with "an Archenemy game needs one player with a scheme deck"" |
| (same) | the `archenemy` flag not parsed | the same |
| aStartWithTwoArchenemiesIsRefused | the two-archenemies refusal off | "... "has one archenemy, but White, Blue each brought a scheme deck"" |
| aSchemeDeckOfTheWrongSizeIsRefused | the 20-scheme minimum off | "... "White's scheme deck has 19 schemes; it needs at least 20"" |
| (same) | the 2-copy limit off | "... "has 3 copies of A Display of My Dark Power; ..."" |
| archenemyWithSharedLifeIsRefused | the shared-life refusal off | "... "Archenemy plays with each player's own life and turns, not sharedLife"" |
| theArchenemyStartsAtDoubleTheFormatsLife | no double life | "Standard starting life [20, 20, 20], not the archenemy at 40 and the others at 20" |
| (same) | Commander not doubled | "Commander starting life [40, 40, 40], not the archenemy at 80 and the others at 40" |
| (same) | a named life overridden | "a starting life the host named for the archenemy became 40" |
| theArchenemyPlaysAloneAgainstOneTeam, theOtherPlayersWinAsOneTeam | no teams | "the archenemy's loss did not end the game as a team win: running" |
| theArchenemyWinsAlone | the archenemy on the opponents' team | "the game ended with only Blue of the archenemy's opponents out" |
| aSchemeGameTakesNoRestorePoints | restore points kept in scheme games | "an Archenemy game took a restore point" |
| a_game_config_archenemy_flag_reaches_java (Rust) | the flag not copied from `gameConfig` | the test fails by name |

The 7 break-its from `cloud/archenemy-engine` still fail by name. In all: 19 Java and 3 Rust break-its, and every file
was restored and checked by sha256.

The earlier tests now use 20-scheme decks: the named schemes, filled up with real Forge schemes, two of each. A test
that needs a small deck trims it after the start.

## Patches

- `forge.patch`: unchanged on this branch.
- `manabrew.patch`: only `Archenemy.java`, `ArchenemyTest.java`, `ManaBrewEngineAdapter.java`,
  `ManaBrewInteractiveSession.java` and `java_backend.rs` changed.
- Both pass `git apply --check` on clean Forge `e7d2b93` and Manabrew `fd16e2f`.
- The harness Java has no comments.

## Not checked, and left

- **CR 904 text.** The rules site was not reachable from this session.
  - The 20-scheme minimum is CR 904.3 as I know it; plan step 0 asks for the text to be read.
  - The 2-copy limit is Forge's own (`DeckFormat`, scheme section).
- **Teams.** The archenemy's team is forced. A request with its own team numbers is overridden rather than refused.
- **Not done:** the bridge's Undo message and mode, the view (step 4), the spike (step 5), the image and a live game.
