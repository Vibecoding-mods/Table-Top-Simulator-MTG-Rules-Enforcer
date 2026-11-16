# Report: choosing the starting player

Cloud session, 2026-11-16, on branch `cloud/first-player` (based on `cloud/archenemy-view`). No Docker image was built
and nothing was checked live. `bridge/` is untouched.

## The field for the bridge

**`gameConfig.firstPlayer`**: a number, the 0-based seat index (`player-N` is seat N).

- The node copies it to the start request as `firstPlayer`, and leaves it out when absent.
- The harness also takes `firstPlayer` at the top level of a start request.

```json
{ "gameConfig": { "teamRules": "teams", "firstPlayer": 2, "players": [ ... ] } }
```

| Case | Who takes the first turn |
| --- | --- |
| `firstPlayer: N` | seat N, in any game: Treachery's Leader, a named Juggernaut, anything else |
| Archenemy game, no `firstPlayer` | the archenemy's seat, the one with the scheme deck (CR 904.6) |
| Archenemy game with `firstPlayer: N` | seat N: a named first player wins over the archenemy default |
| field absent, any other game | unchanged: Forge's random first player, or loser-goes-first after a game |

**Refused with an error:**

- a seat that isn't one: "firstPlayer 4 is not a seat: the seats are 0 to 3";
- `firstPlayer` and a player's `goesFirst` naming different seats: "firstPlayer 1 disagrees with goesFirst on seat 3".

The existing per-player `goesFirst` (`gameConfig.players[].goesFirst`, the Juggernaut setting) still works alone, and
both may be sent if they agree. PLAN.md's "no engine option to choose the starting player" was already out of date
because of `goesFirst`. `firstPlayer` is the plain seat form.

## How it works

`ManaBrewEngineAdapter.configureStart`, called by `startGame`:

1. runs the team rules and the player rules, where `firstPlayer` and `goesFirst` are read and checked;
2. calls `Archenemy.firstPlayer`, which names the archenemy's seat when nothing else was named.

The seat goes into `GameRules.setStartingPlayer`. Forge's `determineFirstTurnPlayer` returns that seat before its coin
flip or loser-goes-first.

Forge already has a 904.6 step of its own: with nobody named, the archenemy goes first in an Archenemy game. The harness
default makes it explicit in the start rules, so it doesn't depend on that fallback.

## Tests

- `FirstPlayerTest`: 7 of 7 pass. Each start is decided 12 times with Forge's own `determineFirstTurnPlayer`.
- New node test `a_game_config_first_player_reaches_java` passes; the `self-hosted-node` suite is 20 of 20.
- `engine/test-harness-local.sh --all`: 29 of 29 classes pass.

| Check | Break-it | Fails with |
| --- | --- | --- |
| theNamedFirstPlayerTakesTheFirstTurn | `firstPlayer` not parsed | "with firstPlayer 2 the first turns went to seats [0, 1, 2, 3]" |
| (same) | `firstPlayer` parsed but ignored | "... went to seats [0, 1, 3]" |
| theArchenemyTakesTheFirstTurnWhenNoneIsNamed | no archenemy default | "the start request names seat -1 to go first, not the archenemy's seat 2" |
| (same) | `configureStart` doesn't call the default | the same |
| aNamedFirstPlayerBeatsTheArchenemyDefault | the default overrides a named seat | "with firstPlayer 1 and the archenemy on seat 2 the first turns went to seats [2]" |
| withoutTheFieldTheFirstPlayerStaysRandom | an absent field means seat 0 | "a start request without firstPlayer names seat 0" |
| aFirstPlayerThatIsNoSeatIsRefused | no seat range check | "a start was accepted that should be refused with "firstPlayer 4 is not a seat ..."" |
| aFirstPlayerThatDisagreesWithGoesFirstIsRefused | no agreement check | "... "firstPlayer 1 disagrees with goesFirst on seat 3"" |
| goesFirstStillWorksAlone | `goesFirst` dropped | "with goesFirst on seat 3 the first turns went to seats [0, 1, 2, 3]" |
| a_game_config_first_player_reaches_java (Rust) | `gameConfig.firstPlayer` not copied | the test fails by name |

Every file was restored and checked by sha256 after its break-it.

**One finding.** With the harness default removed, the archenemy still took the first turn, through Forge's own 904.6
fallback. That break-it is caught only by the check on the start rules, which name the archenemy's seat; the
first-turn check alone would miss it.

## Patches

- `forge.patch`: unchanged.
- `manabrew.patch`: only `Archenemy.java`, `ManaBrewEngineAdapter.java`, the new `FirstPlayerTest.java` and
  `java_backend.rs` changed.
- Both pass `git apply --check` on clean Forge `e7d2b93` and Manabrew `fd16e2f`.
- No comments in the harness Java.

## Left

- The bridge has to send `gameConfig.firstPlayer` for the Treachery Leader (s1).
- PLAN.md line 689 still says it isn't possible. Left for whoever merges, since PLAN.md is the owner's list.
- No image and no live game.
