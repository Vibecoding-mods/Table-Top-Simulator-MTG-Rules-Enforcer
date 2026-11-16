# Report: Archenemy view (plan step 4)

Cloud session, 2026-11-16, on branch `cloud/archenemy-view` (based on `cloud/archenemy-spike`). No Docker image was
built and nothing was checked live. `bridge/` is untouched.

## The JSON the bridge reads

### Per player

These sit on each entry of `gameView.players[]` (Rust `PlayerDto`, TypeScript `PlayerDto`):

| Field | Type | When it is sent | Meaning |
| --- | --- | --- | --- |
| `isArchenemy` | boolean | every player, Archenemy games only | `true` for the archenemy. It stays `true` even when every scheme is in motion. |
| `schemeDeckCount` | number | every player, Archenemy games only | Schemes left in that player's scheme deck: the archenemy's count, `0` for the others. |
| `schemes` | array of `SchemeDto` | only when the player has a scheme in the command zone | The schemes in motion, in command-zone order. |

`SchemeDto` (new):

```json
{ "id": "engine-card-12", "name": "I Am Untouchable", "ongoing": true }
```

- `id` is the same id the card has in the `command` zone entry of `gameView.zones`. That zone already carried scheme
  cards as full card DTOs, and still does.
- `ongoing` is `true` for an Ongoing scheme, which stays until it is abandoned. A non-ongoing scheme is listed only
  while its "when you set this scheme in motion" ability is on the stack. Then it goes back to the bottom.
- The existing `activeSchemeNames` (names only) is unchanged.

**What is never sent:**

- the scheme deck's cards, names, ids or order, to any viewer;
- the three fields, in a game without schemes.

The Archenemy-game test is Forge's applied `GameType.Archenemy` variant.

Example, the archenemy with one ongoing scheme in motion:

```json
{ "id": "player-0", "name": "White", "life": 40, "teamNumber": 1,
  "activeSchemeNames": ["I Am Untouchable"],
  "isArchenemy": true, "schemeDeckCount": 19,
  "schemes": [{ "id": "engine-card-12", "name": "I Am Untouchable", "ongoing": true }] }
```

### Events

These are entries of `gameView.events[]` (`EngineEventDto`, the same ring as the other moves). They are marked with
the existing `how` field. No new event field.

| `how` | `from` → `to` | Meaning |
| --- | --- | --- |
| `setInMotion` | `SchemeDeck` → `Command` | `ownerId` sets the scheme `cardId` in motion: at the first main phase, or from an effect. |
| `abandoned` | `Command` → `SchemeDeck` | `ownerId` abandons the ongoing scheme `cardId`. |
| `returned` | `Command` → `SchemeDeck` | A non-ongoing scheme went back to the bottom after resolving. Usually not worth logging. |

Example:

```json
{ "id": "event-1", "seq": 1, "cardId": "engine-card-12", "from": "SchemeDeck", "to": "Command",
  "ownerId": "player-0", "how": "setInMotion" }
```

An event carries the card's id, not its name. To get the name:

- `setInMotion`: read `cardId` against the same snapshot's `players[].schemes`, or the `command` zone.
- `abandoned` and `returned`: the card is back in the hidden scheme deck. Read `cardId` against the previous
  snapshot's `schemes`, the last one where the card was in motion.

## What changed

- **Harness:**
  - `InteractiveSnapshotExtractor` adds the three player fields.
  - `Archenemy.schemesInMotion` builds `schemes`.
  - `EngineEventLog` marks the three moves.
- **Forge:** `AbandonEffect` moves the scheme by hand (`zone.remove`/`add`), so it fired no zone-change event. It now
  fires `GameEventCardChangeZone`, which is what the log listens for.
- **Protocol (Rust):**
  - `PlayerDto` gains `is_archenemy`, `scheme_deck_count` and `schemes`. All three are optional and left out when
    empty.
  - A new `SchemeDto` struct.
  - The Rust engine's own view (`manabrew-agent-interface`) leaves the three fields empty.
- **TypeScript:** the bindings are generated, so `yarn gen:types` makes them; `src/protocol` is gitignored. Without
  these Rust fields the node would drop the new keys, because it reads every snapshot into `GameViewDto`.

## Tests

- `ArchenemyViewTest`: 7 of 7 pass.
- New Rust tests `keeps_the_archenemy_fields_of_a_java_player` and `leaves_the_archenemy_fields_out_of_other_games`
  pass.
- Full Rust suites pass: `manabrew-protocol` 150, `manabrew-agent-interface`, and `self-hosted-node` 19.
- `engine/test-harness-local.sh --all`: 28 of 28 classes pass.

| Check | Break-it | Fails with |
| --- | --- | --- |
| eachPlayerShowsTheSchemeDeckCountAndTheArchenemy | `isArchenemy` not sent | "viewer 0: White is not marked the archenemy: null" |
| (same) | the count read from the command zone | "viewer 0: White's scheme deck count 0" |
| theSchemeDeckOrderIsNeverSent | the scheme deck sent as a zone | "viewer 0 is sent the scheme deck's Roots of All Evil" |
| schemesInMotionAreListedWithOngoingMarked | `schemes` not sent | "schemes in motion: null" |
| (same) | `ongoing` always false | "I Am Untouchable is marked ongoing false" |
| aGameWithoutSchemesHasNoArchenemyFields | the fields sent in every game | "a game without schemes sends isArchenemy false, schemeDeckCount 0" |
| settingASchemeInMotionIsAnEvent | `setInMotion` not marked | "no setInMotion event: [...]" |
| abandoningASchemeIsAnEvent | Abandon fires no event (Forge) | "no abandoned event: [...]" |
| (same) | an abandon reported as `returned` | "no abandoned event: [...]" |
| aNonOngoingSchemeReturningIsAnEvent | a return reported as `abandoned` | "no returned event: [...]" |
| keeps_the_archenemy_fields_of_a_java_player (Rust) | `schemes` skipped by serde | the test fails by name |
| leaves_the_archenemy_fields_out_of_other_games (Rust) | `isArchenemy` always serialized | the test fails by name |

Each file was restored and checked by sha256 after its break-it.

## Patches

- `forge.patch`: one new section, `AbandonEffect.java`.
- `manabrew.patch`: only `Archenemy.java`, `EngineEventLog.java`, `InteractiveSnapshotExtractor.java`, the new
  `ArchenemyViewTest.java`, `manabrew-protocol/src/game/mod.rs` and `manabrew-agent-interface/src/game_view_dto.rs`
  changed.
- Both pass `git apply --check` on clean Forge `e7d2b93` and Manabrew `fd16e2f`.
- No comments in the harness Java.

## Left

- The relay was not rebuilt or checked. It passes the game view through, and the new fields are inside `PlayerDto`.
- The view isn't shown on the table (s1, bridge side).
- No image and no live game.
