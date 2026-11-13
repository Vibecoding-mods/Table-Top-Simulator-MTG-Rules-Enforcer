# Engine changes log

A retroactive log (written 2026-11-12) of every change made to the rules engine behind the TTS table. Facts come from the
engine git logs, `engine/`, the Docker image list and the dated memory notes. Where a source did not show a fact, it says
"(unconfirmed)". Image "created" times are Docker's, in EST (-0500).

## 1. What "the engine" is

The engine is the part that enforces the rules. It has four pieces:

- **Forge** (GPL-3.0): the rules code and card scripts. Our base is the Manabrew fork `witchesofthehill/forge` at
  `e7d2b93`.
- **Manabrew** (AGPL-3.0-or-later) at upstream `fd16e2f` (2026-10-16): the **relay** (`mtg-relay`) that seats players and
  passes messages, and the **self-hosted node** (`mtg-forge-node`) that runs Forge in a game room.
- **forge-harness**: the Java glue inside the node (`forge-harness/src/main/java/forge/harness/...`). It turns Forge's
  state and questions into DTOs and turns answers back into Forge calls. Most engine changes are here.
- **Protocol** (`manabrew-rs/crates/manabrew-protocol`, plus `manabrew-agent-interface`): the DTOs and directives. The
  relay parses every player directive against its own copy of the protocol and drops unknown ones.

Where the source lives:

| Place | What |
|---|---|
| `C:\Users\you\mtg-tts\tmp\mb-pc` | Current working checkout, branch `pc-on-batch1` (tip `4753e36`). Built batch1112 and batch2-1112. |
| `C:\Users\you\mtg-tts\tmp\mb-batch1` | Worktree of branch `tts-engine` (tip `ba5ad41`). Origin of the batch 1 commits. |
| `C:\Users\you\mtg-tts\manabrew` | Older shared checkout, branch `tts-engine` (tip `6186d11`, 2026-11-09). Also holds `planechase-1111` (tip `09d608b`) in `tmp/wt-planechase/manabrew`. Its `main` is upstream `fd16e2f`. |
| `tmp/mb-wt-cards`, `tmp/mb-wt-game`, `tmp/mb-wt-damage` | Worktrees of `mb-pc` for the three branches in progress (section 2). |
| `engine/manabrew.patch`, `engine/forge.patch` | The published form: our whole change as a patch on top of the pinned upstream commits. `engine/forge-trek-files.txt` lists the imported Star Trek files. |
| `engine/build-images.sh`, `engine/make-patches.sh`, `engine/checks/` | Build the images from public source; remake the patches; headless checks (`harness-tests.sh`, `TrekCardsLoadCheck.java`, `ExtraTurnCountCheck.java`). |

The git history in `mb-pc` has only 24 commits. Before 2026-11-05 nothing was committed there. The first commit `b7a42c8`
(2026-11-05) is a snapshot of all earlier harness work. For the earlier images the real record is the memory notes and the
outer repo's `engine/manabrew.patch` history (`git -C mtg-tts log -- engine/manabrew.patch`).

### How an image is built and deployed

1. Edit the harness, protocol and (rarely) Forge in a Manabrew checkout.
2. Build the node image: `docker build -f manabrew-rs/crates/self-hosted-node/Dockerfile -t mtg-forge-node:<tag> .`
   (about 20 minutes; the GraalVM native step is about 15). Build the relay with
   `-f manabrew-rs/crates/manabrew-server/Dockerfile -t mtg-relay:<tag> .`. `*.sh` files need LF endings first or the
   native step fails with `env: 'bash\r'`. One docker build at a time. Use a new tag each time. A `TaskStop` on a
   background build does not stop the docker client (2026-11-04), so kill `docker.exe` build processes first.
3. Run the headless tests: `engine/checks/harness-tests.sh` in a `mtg-harness-test:<tag>` container (the `java-builder`
   stage of the node Dockerfile). It recompiles the mounted harness, so the test image only needs a rebuild when
   Forge's own Java changes. Run the live checks against the built tag with `sh tools/live-check.sh <tag> <test.js>`.
4. Regenerate `engine/manabrew.patch` (and `forge.patch`) with `engine/make-patches.sh` in a clean tree made by
   `build-images.sh`.
5. Deploy with `node tools/deploy.js --image <tag>` (TTS closed, no game running). It runs the gates, retags
   `mtg-forge-node:<tag>` as `:exile`, and retags `mtg-relay:<tag>` too when that tag exists. It writes
   `stack/deployed.json`. A deploy of an engine from a tree without the newest protocol fields needs
   `MTG_MANABREW=tmp/mb-pc` (batch 2 did).
6. The stack (`stack/compose.yml`) runs `mtg-relay:exile` and `mtg-forge-node:exile`. Stock digests are kept as comments
   there for rollback.

### Rules

- No comments in Manabrew Java (`manabrew/AGENTS.md`). The patch history shows one reviewer fix for a Java comment (`75844bc`).
- Never push Manabrew (no upstream PR until TTS fully works). Local commits are allowed; `mb-pc`'s `origin` is a local clone.
  The public form is `engine/manabrew.patch` in `Vibecoding-mods/Table-Top-Simulator-Mock-MTGA`.
- When the protocol changes (a new directive, StateOp variant, prompt field the relay must carry), rebuild **both** images
  from the same source. Node-only changes (extra optional DTO fields the relay passes through) need only the node.
- Never swap images in the middle of a game. Restart the relay as well as `forge-room` after a swap, or the room stays
  on the relay ("Game has already started").
- Keep a rollback tag (`:<tag>-prev` or the previous tag name) for every swap.
- Open debt noted 2026-11-02/03: `yarn gen:types`, `build:harness` and `gen:protocol-docs` were not run for the early
  protocol additions (still open as far as the sources show; unconfirmed).

## 2. Pending / in progress (2026-11-12)

Three engine branches are being built in worktrees of `tmp/mb-pc`. **In progress, not built.** All three branch tips
are still `4753e36` (the same as `pc-on-batch1`), so **nothing is committed yet**. Work exists only as uncommitted
changes in each worktree (checked with `git status`/`git diff`, 2026-11-12 evening; worktrees last touched about 19:00).
No image tag exists for any of them.

| Branch | Worktree | Uncommitted so far |
|---|---|---|
| `card-flags-1112` | `tmp/mb-wt-cards` | `InteractiveSnapshotExtractor.java` (+71), `manabrew-protocol/.../game/mod.rs` (+29), `game_view_dto.rs` (+13), `src/lib/gameCard.ts` (+13). New per-card fields seen in the diff: `skipsNextUntap`, `monstrous`, `saddled`, `saddledBy[]`, `harnessed`, `solved`, `unlockedDoors[]`, `pairedWith`, `attachedToPlayer`, `protectorId`, `cantAttack`, `cantBlock`, `mustAttack`. (`exert`, `rooms` are in the brief; the diff may carry them under other names. Unconfirmed.) |
| `game-state-1112` | `tmp/mb-wt-game` | `InteractiveSnapshotExtractor.java` (+17), new `EffectsView.java`, `reflect-config.json` (+4: reflects `TriggerHandler.delayedTriggers` and `playerDefinedDelayedTriggers`), protocol `mod.rs` (+57), `game_view_dto.rs` (+6). New DTOs seen: `DelayedTriggerDto {id, text, controllerId, hostCardId?, cardIds[], when?, turnOf?}`, `EffectDto {id, name, text, sourceCardId?, emblem, untilEndOfTurn, duration?}`, and optional per-player `effects`, `spellsCastThisTurn`, `lifeGainedThisTurn`, `lifeLostThisTurn`, plus game-level `delayed` and `stormCount`. |
| `damage-events-1112` | `tmp/mb-wt-damage` | `EngineEventLog.java` (+126/-8), protocol `mod.rs` (+18). New optional `EngineEventDto` fields seen: `kind`, `sourceCardId`, `targetCardId`, `targetPlayerId`, `amount`, `combat`. |

All three add optional DTO fields, so they would be node-only unless a directive changes (unconfirmed until built).
When one is built, add its entry to section 4 and the table in section 3.

## 3. Summary table (newest first)

"Protocol?" says which images carry the change. "Source" gives commits in `tmp/mb-pc` (Manabrew) and the outer `mtg-tts`
repo (`engine/manabrew.patch`). Image ids are node / relay. The image list below is what Docker still holds (2026-11-12);
older ids come from the notes.

| Date (image created) | Tag (node id / relay id) | What changed | Protocol? | Source commits | Live since (deploy) | Rollback tag |
|---|---|---|---|---|---|---|
| 2026-11-12 05:02 / 05:05 | `batch2-1112` (`975d62f6279e` / `57aa07a9b314`) = `:exile` now | Dungeon rooms and Planechase in the view; dungeon, initiative, planeswalk, chaos fix ops | Both | mb-pc `5356a42`, `62ac39e`, `4753e36`; outer `96e2c4c`, `044f77e`, `f46b12c` (bridge) | 2026-11-12 ~05:50, main `3ae38c3` | `batch1112` (`00d0a4d243ed` / `e6156e135032`) |
| 2026-11-12 03:39 / 02:59 | `batch1112` (`00d0a4d243ed` / `e6156e135032`) | Attack taxes, refusals and limits sent; defender choice names the attacker; draw and mill fix ops; mill triggers | Both | `a7d187a`, `efde6c7`, `6c06a04`, `5a13c18`, `30bd56e`, `ba5ad41`; outer `248165d`, `8d496c4`, `f44b8a4`, `153a6fc` | 2026-11-12 ~04:00, main `dd9f12c` | `walker` node (`c9295fcc7e1c`), relay `exile` as before (`dbfe69213fff`) |
| 2026-11-11 14:12 | `walker` (`c9295fcc7e1c`) | Debug-created planeswalker or battle enters with its printed loyalty or defense | Node only | outer `8fb86e6`; mb-pc sync `f8068c5` | 2026-11-11 14:40, main `bff272c` | `bugs1111` (`d718c138b924`) |
| 2026-11-11 02:53 | `bugs1111` (`d718c138b924`) | Harmless AI never casts; mayPlay for Mayhem, Harmonize, Beam me up, plotted cards | Node only | outer `4f1cbdf`; mb-pc sync `f8068c5` | 2026-11-11 ~05:00, main `496bc24` | `trek2` (`7d14533e3b79`) |
| 2026-11-10 20:30 | `trek2` (`7d14533e3b79`) | Four Star Trek card script fixes (Forge data only) | Node only | outer `8f741ad` | 2026-11-10 23:08, main `9ab42d3` | `trek2-prev` = `reveal` (`a8c9de3ee222`) |
| 2026-11-09/10 (unconfirmed) | `reveal` (`a8c9de3ee222`) | `mayPlay` only for cards the viewer may really play (Courser scry glitch) | Node only | `49450f1`, `6186d11`; outer `ee8caaf` | 2026-11-10, with release-1110 | `trek` (`ef61822078a0`) |
| 2026-11-09 12:08 | `trek` (`ef61822078a0`; relay `trek` `dbfe69213fff`) | Extra-turn queue kept on rewind; `extraTurnCount` counts the queue; Mindslaver prompts routed to the controller | Node only | `b2d3dd7`, `20770d2`; outer `bfba2e0` | 2026-11-09 ~15:00, main `829c900` | `trek-prev` (`d2b8b59eda17`) |
| 2026-11-07 | `trek` first build (`d2b8b59eda17`; relay `trek` `dbfe69213fff`) | Star Trek (TRK, TRC) data and Java in Forge | Node only | outer `bfba2e0` (patch, 11-09); forge-update doc | (unconfirmed; before 2026-11-09) | `forage` (`369481787d62`) (unconfirmed) |
| 2026-11-07 early | `forage` (`369481787d62`) | Optional exactly-N card choices decline instead of aborting the game | Node only | `f9b43fb`; outer `86d69c4` (patch matches this image) | 2026-11-07 early | (unconfirmed) |
| 2026-11-06 night | `dungeon2` (`07b502f6be48`) | Rewind restores dungeon rooms, completed dungeons and `venturedThisTurn` | Node only | `ebed03e`, `29d4c5c` | 2026-11-06 night | `dungeon` / `fixhand` (unconfirmed) |
| 2026-11-06 | `fixhand` (`2cc86784314b` / `d6d8b4f0f314`) | Free casts, lands and activations in the fix directive; `stateFix.dropped`; `free_cards` on a mulligan | Both | `20770d2` (committed 11-09); outer `86d69c4` | 2026-11-06 early | `fixhand-prev` (`a5533acce30c` / `da97369c8be0`) |
| 2026-11-05 | `cleave` (`a5533acce30c`) | "Cast X (Cleave)" and "(Prototype)" labels; optionalCosts | Node only | in `b7a42c8` | 2026-11-05 late | `altcost` (`09de165c85db`) |
| 2026-11-05 | `altcost` (`09de165c85db`) | Static alternative cost sent as `PlayCardMode_staticAlternative` | Node only | in `b7a42c8` | 2026-11-05 early | `debug2` (`c54eae420b74`) |
| 2026-11-04 night | `debug2` (`c54eae420b74`) / relay `debug` (`da97369c8be0`) | `createCard` state op for debug scenarios | Both | in `b7a42c8` | 2026-11-04 night | `debug-prev` (node `2fd9095ae6c8`, relay `4654279a025f`) |
| 2026-11-04 | `optcost` (`00d61a16cc50`) | Optional costs on the stack (unconfirmed detail) | Node only | in `b7a42c8` | 2026-11-04 | `trig` (`2fd9095ae6c8`) |
| 2026-11-04 | `trig` (`2fd9095ae6c8`) | `isTrigger` on stack items; clone `printedName` | Node only (relay unchanged) | in `b7a42c8` | 2026-11-04 | `costs`/`cause` line (unconfirmed) |
| 2026-11-03 later | `costs` (`a8f8030f17d6`) | Cost causes, foretell/plot/suspend `how`, draws settled per move | Node only | in `b7a42c8` | before 2026-11-04 (superseded by `optcost`) | `cause` (`e9760ef3ec03`) |
| 2026-11-03 | `cause` (`e9760ef3ec03`) | Move `cause`, `causeName`, `causeCardId`, `how: "mill"` on events | Node only | in `b7a42c8` | not swapped alone | `events2` (`a64692989fe2`) |
| 2026-11-02 later | `events2` (`a64692989fe2`) | `wasDestroyed`, owner from card, event ids | Node only | in `b7a42c8` | 2026-11-02 evening (first `deploy.js`) | `events` (`8e7f0717e2fa`) |
| 2026-11-02 | `events` (`8e7f0717e2fa`) | `GameViewDto.events` from `EngineEventLog` | Node only | in `b7a42c8` | 2026-11-02 | `events-prev` (`0523af3103a1`) |
| 2026-11-02 | `table` (`0523af3103a1`) | Phased-out cards sent; forced rewind; `gameLock` | Node only | in `b7a42c8` | 2026-11-02 | `table-prev` (`55db8188ff14`) |
| 2026-11-01 late | `race-fix` (`c8790f298f75`) | Snapshot-vs-game lock (rewind race) | Node only | in `b7a42c8` | folded into `table` | (n/a) |
| 2026-11-01 evening | `phase` (`55db8188ff14`) | Attack defender order; rewind restores phasing | Node only | in `b7a42c8` | 2026-11-01 evening | `phase-prev` (unconfirmed id) |
| 2026-10-31 evening | `friendly` (relay/node ids unconfirmed) | `free_cards` on a mulligan (friendly mulligans) | Both | none kept | 2026-10-31; **rolled back 2026-11-01** to `fm-prev` (node `5558c6183a27`, relay `4654279a025f`) | `fm-prev` |
| 2026-10-31 | `pt` | `printedPower`, `printedToughness` on CardDto | Node only | none kept | 2026-10-31 | `pt-prev` |
| 2026-10-30 | `rel` (`9b2708d7c2ca`) | Engine rebuilt from a clean upstream clone plus `engine/*.patch` | Both | outer `93e46d6` | 2026-10-30 (unconfirmed) | `rel-prev` (both) |
| 2026-10-29 | `animist`, `npe` (`8b8d6ff33d14` was the rebuilt npe image; `63789b68057e` animist) | Spider-Sense NPE guard; mana-99 playability; Animist's Awakening script cleanup | Node only | none kept | 2026-10-29 | `npe-prev`, `animist-prev` |
| 2026-10-27 | `text` | `currentText`, `printedName`, `encodedOn` on CardDto | Both | none kept | 2026-10-27 | `text-prev` |
| 2026-10-26 | `mana` | StateOp `mana { player, mana }` | Both | none kept | 2026-10-26 | `mana-prev` (both) |
| 2026-10-25 evening | `seat` | `seat_order` on StartGame; AutoPay ranks self-sacrificing sources last | Both | none kept | 2026-10-25 | `seat-prev` (relay), `rewind-prev` (node) |
| 2026-10-25 | `filter`, rewind fix | Filter-land playability; `Checkpoint.zoneOrder` | Node only | none kept | 2026-10-25 | `filter-prev`, `fd-prev`, `cc2-prev` |
| 2026-10-23 evening | `cc`/`cc2` | Cost Cancel (`ChooseCardsInput.cancellable`) | Both | none kept | 2026-10-23 | `sac`, `prev` (node); `prev` (relay) |
| 2026-10-23 | `exile` (first own images) | CardDto exile fields, `applyState` / `stateFix` directive | Both | none kept | 2026-10-23 | stock digests in `compose.yml` |

Docker images present on 2026-11-12 (read-only listing):

```
mtg-relay:batch2-1112 / :exile          57aa07a9b314  2026-11-12 05:05:31
mtg-forge-node:batch2-1112 / :exile     975d62f6279e  2026-11-12 05:02:49
mtg-harness-test:batch2-1112            00474462f02a  2026-11-12 04:41:31
mtg-forge-node:batch1112                00d0a4d243ed  2026-11-12 03:39:22
mtg-relay:batch1112                     e6156e135032  2026-11-12 02:59:32
mtg-harness-test:batch1112              f53e6e4e2a57  2026-11-12 02:18:28
mtg-forge-node:walker                   c9295fcc7e1c  2026-11-11 14:12:29
mtg-harness-test:bugs1111               7f02a000edfd  2026-11-11 02:56:55
mtg-forge-node:bugs1111                 d718c138b924  2026-11-11 02:53:11
mtg-forge-node:trek2                    7d14533e3b79  2026-11-10 20:30:03
mtg-harness-test:trek2                  b1115850f1e4  2026-11-10 19:28:45
mtg-forge-node:trek                     ef61822078a0  2026-11-09 12:08:50
mtg-relay:trek                          dbfe69213fff  2026-11-05 23:00:04
mtg-relay:walker                        671e6315789a  2026-11-05 23:00:04
```

Older tags (`reveal`, `forage`, `fixhand`, `*-prev`, and so on) are no longer in the local image list, so their rollback
needs a rebuild. Their ids above come from the notes. `mtg-relay:walker` has a different id from `:trek` but the same
creation stamp; it was not the deployed relay (unconfirmed what differs).

## 4. Changes, newest first

### 2026-11-12 batch2-1112: dungeons and Planechase in the engine view
- **Problem:** the table guessed a dungeon's room from card text and had no Planechase at all; initiative and venture
  state could not be set for tests.
- **What:** the view carries `dungeonState` with the dungeon card id and its rooms, and each player gets `completedDungeons`.
  A start request's `planes` turn Planechase on, with a dealt planar deck for players who bring none. The view carries a
  `planar` block. The planar die result is recorded once instead of asking every seat to acknowledge it. A Planechase game
  takes no restore points (rewind refused for now).
- **Files:** harness `DungeonView.java` (new), `Planechase.java` (new), `ManaBrewEngineAdapter`,
  `ManaBrewInteractiveController`, `ManaBrewInteractiveSession`, `InteractiveSnapshotExtractor`; protocol `game/mod.rs`,
  `transport/mod.rs`, `game_view_dto.rs`, `java_backend.rs`; tests `DungeonStateTest`, `PlanechaseTest`.
- **New shapes:**
  - `DungeonRoomDto {name, next[], text}`; dungeon state gains `cardId?` and `rooms[]`.
  - `PlanarStateDto {controllerId, planeIds[], dieRollsThisTurn, deckCounts{}, lastRoll?}`; `PlanarRollDto {playerId, result, seq, ...}`.
  - StateOp variants (fix directive): `Dungeon {player, name, room?}`, `CompletedDungeon {player, name}`, `Initiative {player}`,
    `Planeswalk {player, name}`, `Chaos {player}` (the last two run in the free-play pass).
- **Proof:** 12 of 12 harness classes pass; 25 of 25 gates at deploy (run with `MTG_MANABREW=tmp/mb-pc`). `4753e36` adds a
  test that a dungeon set at its last room is completed. The live spike (`rules-check planechase`: rolls per seat, the {0}
  payment, an AI with no deck, rule 901.10) was **not** run as of PLAN's note; unseen live.
- **Known limits:** no rewind in Planechase; "<plane> leaves the game" line, chaos trigger label on the stack, Interplanar
  Tunnel wording, and plane pictures ahead are open (PLAN). The shared `manabrew` checkout lacks these protocol fields.
- **Rollback:** `node tools/deploy.js --image batch1112` (from main `dd9f12c`). The same commits also exist as `2841bf3`,
  `53057d9` on `pc-src` and `09d608b` on `planechase-1111` (rebased copies).

### 2026-11-12 batch1112: attack taxes, defender names, draw and mill
- **Problem:** the table read attack taxes and "can't attack" reasons from card text and missed War Tax and emblems; Hero
  of Bladehold's two tokens asked "attack whom?" with no way to tell them apart; the debug tools had no real draw or mill.
- **What (a7d187a):** the `chooseAttackers` prompt carries each attacker's `costs` per defender (from
  `CombatUtil.getAttackCost`, with the source cards), `unavailable` (creatures that can't attack, with Forge's reason and
  source; an effect card is named after its source card) and `limits` (each AttackRestrict). `unavailable` and `limits`
  are always serialized so a client can tell an engine that sends them. The bridge falls back to text for an older engine.
- **What (efde6c7):** `chooseSingleEntityForEffect` over a mixed list sends Forge's question as the description and its
  Attacker as the one CARD target (Hero's tokens).
- **What (6c06a04):** `applyState` takes `draw` and `mill` ops, run after the other ops with triggers on
  (`Player.drawCards`; `GameAction.mill` with a Mill EmptySa and a CardZoneTable). A player out of the game or `n < 1`
  refuses the whole fix. **ba5ad41:** a mill's waiting zone-change triggers (Syr Konrad) now run.
- **Files:** `ManaBrewInteractiveSession`, `ManaBrewInteractiveController`; protocol `prompts/choose_attackers.rs`,
  `transport/mod.rs`, `agent_impl/combat.rs`, `emit_prompt_fixtures.rs`; tests `AttackDefenderChoiceTest`,
  `ApplyStateDrawMillTest` (7 checks; `millFiresGraveyardTriggers` was red before ba5ad41), `ApplyStateCreateCardTest` extended.
- **New shapes:** `AttackCostDto {defenderId, cost, sourceIds[], sourceNames[]}`; `AttackRefusalDto {cardId, defenderId?, reason,
  sourceId?, sourceName?}`; `AttackLimitDto {max, defenderId?, sourceId, sourceName}`; prompt fields `costs[]`, `unavailable[]`,
  `limits[]`; StateOp `Draw {player, n}`, `Mill {player, n}`.
- **Proof:** 22 of 22 gates and 10 of 10 harness classes at deploy. Live: one debug game owed; live check 1 of batch 1
  gave 17 pass, 3 fail (bridge side, fixed in `446b7e7`), 8 not reached (`tmp/live-checks/RESULTS-batch1.md`).
- **Known limits:** the controller's attack refusal loop (an `error` on a refused declaration) is not built; the bridge
  still names the limit itself. Harness AGENTS.md note added (883611b).
- **Rollback:** `walker` node with the earlier relay (`node tools/deploy.js --image exile` from `71f6557`, per the notes).
  The batch 1 commits were cherry-picked between `tts-engine` and `pc-on-batch1` (duplicate hashes such as `b4e0c44`,
  `f79c02f`, `d87446f` on branch `drawmill`).

### 2026-11-11 walker: debug planeswalkers keep their loyalty
- **Problem:** a debug scenario's planeswalker entered with 0 loyalty and died (live check 2026-11-11).
- **What:** `applyState createCard` moves a card from no zone, and `GameAction.changeZone` takes its dev-mode path, which
  skips the Moved replacements that add the ETB loyalty or defense counters. `createCard` now adds them itself for a
  planeswalker or battle sent to the battlefield, only when it has none.
- **Files:** `ManaBrewInteractiveSession` (createCard), test `ApplyStateCreateCardTest` (Jace Beleren 3 loyalty, Invasion of
  Zendikar 3 defense, Grizzly Bears nothing; the first two failed before).
- **Protocol:** none. **Proof:** whole harness suite passed on a clean `fd16e2f` tree plus this patch (`mtg-harness-test:bugs1111`).
- **Rollback:** `bugs1111`. (The source was committed to `mb-pc` later, in sync commit `f8068c5`. Image-to-commit mapping unconfirmed.)

### 2026-11-11 bugs1111: harmless AI and mayPlay from graveyard and exile
- **Problem:** the "harmless" bot (`ai_passive_lands`) still cast spells; Mayhem, Harmonize, Beam me up and plotted cards
  never got `mayPlay`, so the table's playable row skipped them.
- **What:** `PassiveLobbyPlayerAi` (new): a Forge AI seat whose main deck is all lands only plays lands (no spells, abilities,
  opening-hand cards, or attacks unless forced). `ManaBrewEngineAdapter.startGame` picks it by the deck's shape (no
  protocol field carries the deck name). `InteractiveSnapshotExtractor` checks the viewer's own graveyard and exile whole
  and marks Harmonize, Beam me up, Mayhem (discarded this turn) and plotted cards `mayPlay`.
- **Files:** `PassiveLobbyPlayerAi.java`, `ManaBrewEngineAdapter`, `InteractiveSnapshotExtractor`; tests `PassiveAiTest`
  (13 checks, 3 are preconditions that a plain AI casts, counters Serra Angel and starts with its Leyline),
  `MayPlayVisibilityTest` (+7). `forge.patch` unchanged.
- **Protocol:** none. Node only. Mindslaver was checked at the same time: routing confirmed live against a Forge AI
  (all 17 questions in the controlled turn reached the controller); no code change.
- **Known limits:** `ai_passive_lands` still casts a Counterspell a scenario puts in its hand (PLAN note, 2026-11-11).
- **Rollback:** `trek2`.

### 2026-11-10 trek2: four Star Trek script fixes
- **What:** Kirk, Commanding Officer (destroy costs {2} as well as the sacrifice), Dr. McCoy, Surly Surgeon (replacement
  active on the battlefield only), Cantankerous Captain (targets a creature you control), Starfleet Communicator (its
  AttachedBy count), copied from Card-Forge/forge `2549d11` over our `upcoming/` copies. Listed in `forge-trek-files.txt`.
- **Files:** `forge.patch` only (no Java, no protocol).
- **Proof:** `TrekCardsLoadCheck` TRK 311 of 311, TRC 337 of 337, PASS; harness-tests five classes pass. The image's `/build` differs
  from `:exile` only in those four scripts.
- **Rollback:** `trek2-prev` (`a8c9de3ee222`, = `reveal`).

### 2026-11-10 reveal: mayPlay only for cards the viewer can really play
- **Problem (scry glitch, 2026-11-08 20:23):** Forge lists cards a player may only look at among those playable from
  outside the hand, so Courser of Kruphix's revealed top card was marked playable for both seats; the table put one id in two
  playable rows and threw it across the board.
- **What:** `mayPlayOutsideHand` keeps a card when the viewer has a play permission or, in its own zones, the reasons
  Forge's filter gives besides a look. Another player's hand card is marked too when the viewer may cast from it (Sen Triplets).
- **Files:** `InteractiveSnapshotExtractor`; test `MayPlayVisibilityTest` (233 lines; unearth and foretold cases in `6186d11`).
- **Protocol:** none. Node only (the deploy kept relay `:exile`; no `mtg-relay:reveal`). The tag name "reveal" does not
  match the content shown by the commits; the notes also call it the "reveal fix" (unconfirmed which table-side reveal work shipped with it).
- **Rollback:** `trek` (`ef61822078a0`).

### 2026-11-09 trek: extra turns on rewind, Mindslaver routing
- **Problem:** a Time Walk cast after a restore point still took its turn after a rewind; a controlled player's (Mindslaver)
  questions went to the wrong seat; `extraTurnCount` counted only Forge's unbroken run.
- **What:** a restore point keeps `PhaseHandler.extraTurns` and each player's `isExtraTurn`, `extraTurnCount`,
  `extraTurnsPlayed` (`ExtraTurnState`, by reflection; both private fields are in `reflect-config.json`). Everything a
  point keeps beside the GameSnapshot is one `SavedState`. `PlayerDto.extraTurnCount` counts every extra turn queued.
  Prompts for a controlled player name the controlling seat; `controllingSeat` follows the chain of control, stops below a
  Forge AI and at a seat already visited.
- **Also in this image:** the free-play fix ops and `free_cards` mulligan answer (`20770d2`, already running since `fixhand`; committed 2026-11-09).
- **Files:** `ExtraTurnState.java` (new), `ManaBrewInteractiveSession`, `ManaBrewInteractiveController`,
  `InteractiveSnapshotExtractor`, `reflect-config.json`; tests `MindslaverControlTest`, `ExtraTurnRewindTest`;
  `engine/checks/ExtraTurnCountCheck.java`.
- **Proof:** mutation pass of 25 edits, 23 caught, 2 equivalent. `live_extra_turn_check` 10 of 10, `live_mindslaver_check` 16 of 16,
  `live_phasing_check` 29 of 29, `live_events_check` 51 of 51 (long timeout needed), `rules-check --game dungeon` 10 of 10.
- **Protocol:** none new (node only; relay `trek` `dbfe69213fff`).
- **Rollback:** `trek-prev` (`d2b8b59eda17`).

### 2026-11-07 trek (first build): Star Trek TRK and TRC
- **Problem:** the Star Trek sets (release 2026-11-13) were mostly unscripted (TRK 92 of 311, TRC 40 listed).
- **What:** option 1 of `docs/forge-update-2026-11.md`: copy card data and port only the needed Java from Card-Forge `6d4a175`.
  357 new card scripts (219 TRK, 138 TRC), 10 updated scripts, 8 token scripts, three edition files, 32 more creature
  types, one language key. Java ported: `Assimilate` effect and AI, `PEACE` counter, Scotty's `KeywordSource` and Beam me up
  `ValidSA`, `SharesCardTypes`, `YouFaceDilemmaThisTurn`, `YourExtraTurns`, TapPowerValue amounts, `Optional` EndCombatPhase.
  Not taken: the 1071-commit Forge merge (it would break the harness; FlatMC AI rework touches `ComputerUtilMana`).
- **Files:** `engine/forge.patch` (about 7954 lines added in `bfba2e0`), `engine/forge-trek-files.txt`, `engine/checks/TrekCardsLoadCheck.java`, `harness-tests.sh`.
- **Proof:** TRK 311 of 311 and TRC 337 of 337 cards loaded; `live_mindslaver_check` makes Borg Queen and Perfection Manifest
  by name and assimilates a Grizzly Bears.
- **Protocol:** none. **Live:** before 2026-11-09 (exact deploy date unconfirmed).

### 2026-11-07 early forage: optional exactly-N card choices
- **Problem:** an optional choice whose minimum is above 1 (forage, behold, discard N) was published as 0..max; one card
  reached `awaitCardsFromPublishedPrompt` and threw "selected card count out of range", which aborted the game.
- **What:** published as min..max with Cancel; Cancel or a wrong count on an optional choice is an empty answer (the cost is not
  paid), as Forge's own human controller does. Mandatory choices still refuse a wrong count.
- **Files:** `ManaBrewInteractiveSession`; test `OptionalCardChoiceTest` (258 lines).
- **Protocol:** none. `engine/manabrew.patch` was regenerated to match this image in `86d69c4` (2026-11-06 23:02).
- **Rollback:** (unconfirmed).

### 2026-11-06 night dungeon2: rewind and dungeons
- **Problem:** Forge's GameSnapshot copies neither `Card.currentRoom` nor `Player.completedDungeons`, nor `venturedThisTurn`,
  so a rewind left a dungeon in the wrong room and Keen-Eared Sentry's once-a-turn limit refused the next venture.
- **What:** each restore point (and each `applyState`) keeps and restores rooms, completed dungeons, and `venturedThisTurn`
  for every registered player. The earlier `dungeon` image carried the first two.
- **Files:** `ManaBrewInteractiveSession` (`ebed03e`, `29d4c5c`). **Protocol:** none. **Proof:** `rules-check --game dungeon` (10 of 10 at the later trek check).

### 2026-11-06 fixhand: free plays in the fix directive (protocol)
- **Problem:** the manual-fix tools could not make a free cast, land play or activation, and friendly mulligans were out.
- **What:** `StateOp` gains `freeCast {card, player}`, `freeLand {card, player}`, `freeActivate {card, player, ability?, abilityId?}`.
  The other ops run first, then each free play is checked and made; a play that cannot be made lands in `stateFix.dropped`
  instead of refusing the whole fix. A fix that played something yields priority to that player. `MulliganDecision` gains
  optional `free_cards`, passed to Forge through `takeMulliganFree`.
- **Files:** `HarnessPlayPlumbing`, `ManaBrewInteractiveController`, `ManaBrewInteractiveSession` (+231), `ManabrewProtocolAdapter`;
  protocol `game/mod.rs`, `prompts/mulligan.rs`, `transport/mod.rs`; manabot (`simple_ai.rs`, `choices.rs`).
- **Protocol:** both images (`deploy.js` retags the relay too since this release). Committed in `mb-pc` only on 2026-11-09 (`20770d2`).
- **Rollback:** `fixhand-prev` (node `a5533acce30c`, relay `da97369c8be0`). Live: Fix from hand checked on the real table (free Bolt, AI 40 to 37).

### 2026-11-05 cleave and altcost
- **altcost:** `playCardMode` sends a static alternative cost (`sa.isOptionalCostPaid(OptionalCost.AltCost)`) as
  `PlayCardMode_staticAlternative`. Before, Flare of Duplication's sacrifice way was sent as `normal`. Node only.
  Rollback `debug2` (`c54eae420b74`). Build log `tmp/build-altcost.log`.
- **cleave:** labels "Cast Dig Up (Cleave)" via NonBasicSpell + PrecostDesc, and Prototype ("Cast X (Prototype)"); Cleave and
  Prototype appear in the stack's `optionalCosts`. Node only. Deployed 2026-11-05 as `a5533acce30c`. Rollback `altcost`.
- **Source:** the first Manabrew commit `b7a42c8` (2026-11-05 11:26), which snapshots all harness work since fd16e2f.
  `beef091` (2026-11-05) brought `engine/manabrew.patch` up to date (EngineEventLog, move and cost causes, isTrigger,
  createCard, optional costs, static alternative cost) and fixed `make-patches.sh` to include new files.

### 2026-11-04 night debug2 (protocol): createCard
- **What:** `StateOp createCard {name, player, zone, tapped}`: a card by name, or a token script when no card has that name;
  battlefield cards are not summoning sick. Used by `mtg debug <scenario>`.
- **Protocol:** both images: node `debug2` `c54eae420b74`, relay `debug` `da97369c8be0`. Rollback `debug-prev`
  (node `2fd9095ae6c8` = `trig`, relay `4654279a025f`).
- **Proof:** debug2 run on the real table: Bolt cast and bug e reproduced. Note: a stale background build tagged the same name
  once; a new tag per build is the rule.

### 2026-11-04 optcost and trig
- **trig:** stack items carry `isTrigger` (`StackObjectDto.is_trigger`, optional); a cloned card's `printedName` is its own name.
  Node only. Build log `tmp/build-trig.log`. **optcost** (`00d61a16cc50`): optional costs on the stack (detail unconfirmed; log `tmp/build-optcost.log`).

### 2026-11-03 costs and cause (event feed, part 3)
- **cause (`e9760ef3ec03`):** `EngineEventDto` gains optional `cause` (a replacement's EFFECT_REPLACED text, or the resolving
  ability's ApiType), `causeName`, `causeCardId`, and `how: "mill"` from `Card.wasMilled`. Proof: `live_events_check` 41 checks (old image fails 9).
- **costs (`a8f8030f17d6`):** cost causes (`Cost:Cycling`, `Cost:Delve`, `Cost:Escape`, `Cost:Sacrifice`... from `game.costPaymentStack`),
  `how` foretell/plot/suspend from the card's flags, a foretold card's entry unnamed (first build leaked its name), draws settled at every move.
  Proof: 51 of 51 three times (first build 48 of 51); phasing/rewind check 23 of 23.
- Node only; the old relay passes the optional fields through (proved live).

### 2026-11-02 events, events2, table; 2026-11-01 phase, race-fix
- **events (`8e7f0717e2fa`):** `GameViewDto.events`, Forge's zone changes from `EngineEventLog` (the subscriber must be listed in
  `native/extra-config/reflect-config.json` or it hears nothing). Proof: `live_events_check` 31 of 31 twice.
  **events2 (`a64692989fe2`):** per-card `wasDestroyed`, owner from the card, each event `id: "event-<seq>"` so the relay's
  delta keys them (mean delta 869 bytes). Node only, rollback `events`.
- **table (`0523af3103a1`):** phased cards sent with `phasedOut`, forced rewind (a further `restoreVote` accept once nobody is
  awaited), `gameLock`. Proof: `live-check.sh table` 23 of 23. Rollback `table-prev` (`55db8188ff14`).
- **race-fix (`c8790f298f75`, 2026-11-01 late):** `ManaBrewInteractiveSession.gameLock` held by the game thread except around the poll in
  `takeAction`, taken by `getSnapshotJson`. Before: 6 of 35 same-instant votes hit the race (3 fatal); after: 0 in 52 rewinds.
- **phase (`55db8188ff14`, 2026-11-01):** `getLegalAttackers()`'s defender listed first in `validTargetIds` (so "All attack" works under Kardur);
  `Checkpoint.phasedOut` puts phasing back on rewind. Proof: 19 of 20 runs passed 8 of 8 (the old build fails both checks).
- **friendly (2026-10-31, rolled back 2026-11-01):** `MulliganDecision.free_cards` first built then; taken out at the user's request
  ("it was working before"). The build is tagged `:friendly`; the whole thing is in `tmp/backup/update-2026-10-31/`. It came back as part of `fixhand`.

### 2026-10-31 and earlier (reconstructed from notes; no commits exist for these)
- **2026-10-31 pt:** `CardDto.printedPower` and `printedToughness` (the table badge compares against them). Node only. Rollback `pt-prev`.
- **2026-10-30 rel:** engine rebuilt from a clean upstream clone plus `engine/*.patch` (image `9b2708d7c2ca`). First commit of the
  outer repo `93e46d6`. Forge rules code: `TriggerHandler.removeWaitingTapsForMana`, used when undoing a mana tap also undoes what it triggered.
  Forge card scripts: 29 scripts that remembered cards and never cleared them (audit in `docs/reviews/forge-remembered-audit.md`; the
  Animist's Awakening one found 2026-10-29).
- **2026-10-29 npe / animist:** `ActionSpace.getStackTargetCandidates` skips a stack candidate whose target check throws (Spider-Sense
  NullPointerException in `SpellAbility.isValid` aborted the game; node `8b8d6ff33d14`, rollback `npe-prev`); playability after `mtg mana 99`
  offers every spell; Animist's Awakening cleanup (`63789b68057e`, rollback `animist-prev`). Order of the two builds unconfirmed.
- **2026-10-27 text:** `CardDto` gains `currentText` (Forge's `Card.getAbilityText()`, only when text-changing effects applied), `printedName`
  (renamed by text effect) and `encodedOn` (cipher). Both images, rollback `text-prev`.
- **2026-10-26 mana:** `StateOp mana { player, mana: "W W U C" }` (Forge persistent mana: kept through steps, emptied at cleanup). Both images, rollback `mana-prev`.
- **2026-10-25 evening seat:** `StartGame.seat_order` (the relay reorders `player_order` and decks only when it is a permutation); AutoPay ranks
  self-sacrificing sources (Treasure) last. Both images; rollback `seat-prev` (relay), `rewind-prev` (node).
- **2026-10-25 filter and rewind:** filter-land playability (`ActionSpace` `canPayWithManaCostSources`); rewind zone-order fix (`Checkpoint.zoneOrder`).
  Node only; rollbacks `filter-prev`, `fd-prev`, `cc2-prev`.
- **2026-10-23 evening cost Cancel:** `ChooseCardsInput.cancellable` plus Cancel; cost-payment frames; the cast's mana abilities undone on Cancel
  (not a full GameSnapshot restore, which ends combat and keeps frozen triggers). Both images; rollbacks `sac`, `prev` (node), `prev` (relay).
- **2026-10-23 first own images:** `mtg-relay:exile` and `mtg-forge-node:exile` from Manabrew `fd16e2f`: `CardDto` exile fields
  (`exiledWith`, `returnsWhenHostLeaves`, `isForetold`, `mayPlay` from Forge's `getExiledWith`, `getUntilLeavesBattlefield`,
  `getCardsActivatableInExternalZones`), the `applyState` directive and `stateFix` result. The stock relay drops the new directive
  as "rejected unauthorized game envelope", which is why both images are ours. Proof: `rules-check --game exile` and `--game fix`.

## 5. Things the sources did not settle

- Exact build and deploy dates of `reveal`, the first `trek` (`d2b8b59eda17`), `forage` rollback, and every October image except as stated.
- Which relay each node tag shipped with in the October entries beyond the ids quoted in the notes.
- The content of `optcost`, and the relationship between `animist`, `npe` and `rel` ids.
- Whether `mtg-relay:walker` (`671e6315789a`) was ever deployed.
- Image-to-commit mapping for `bugs1111`, `walker` (the commits arrived in `mb-pc` in sync commit `f8068c5` on 2026-11-11 22:59).

## 6. How to add an entry

Log every engine change here the same day it is built.

1. Add a row at the top of the table in section 3 (date, tag with node/relay ids from `docker images`, one-line change, protocol: both or node only,
   source commits in `tmp/mb-pc` and the outer repo, deploy date and main commit, rollback tag).
2. Add a section at the top of section 4: the table-side problem, what changed, files touched, new DTO fields or directives with their shape, tests and
   counts, known limits, rollback.
3. Remove the branch from section 2 when its work is built.
4. Commit in `tmp/mb-pc` (no Java comments, never push), regenerate `engine/manabrew.patch` with `engine/make-patches.sh`, rebuild both images when the
   protocol changed, and keep a rollback tag before `deploy.js --image <tag>`.
