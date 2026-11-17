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
| `tmp/mb-wt-cards`, `tmp/mb-wt-game`, `tmp/mb-wt-damage` | Worktrees of `mb-pc` for branches `card-flags-1112`, `game-state-1112`, `damage-events-1112`. |
| `tmp/mb-wt-merge` | Worktree of branch `engine-1112` (tip `ecf76ab`): the three branches merged on `4753e36`. Built engine1112. |
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

## 2. Pending / in progress (2026-11-13)

`engine1113` (the four engine1112 review follow-ups, section 4) is **deployed** (2026-11-13 09:37 UTC with main `75fc8a2`,
`tools/deploy.js --image engine1113`; its live tests passed; live-checked on the table the same morning). Merged to main
`e64787f` after an independent review (verdict: merge, no blockers; bridge claims 1395 pass). Backed up to
`D:\MTG-Engine-Backup\2026-11-13`.

Open follow-ups from that review (none a regression of engine1113; the table is protected by the bridge for 1 and 2):
1. `EffectsView.effects(player)` has no viewer filter: an effect whose source card went to a hand or library still sends
   that card's id, name and text in every seat's raw view (the bridge filters it: claims check "engine1112 hidden: an
   effect from a hand card"). Fix: give `effects` the same `shownTo` predicate `delayed` got.
2. The delayed-trigger filter treats a face-down permanent as shown (`CardView.canBeShownTo` is true on the battlefield),
   and `Trigger.toString` can name the real card through `getHostName`. Fix: `shownTo(c) && (!c.isFaceDown() ||
   faceShownTo(c, viewer))`. Rare (a permanent turned face down after its trigger was made); the bridge's
   `publicCardIds` already excludes face-down cards.
3. bridge `delayedOf`: a host in seat 0's own hand vs another seat's hand gives different player marks (no card named
   either way).
4. `CardStateFlagsTest.seatsWhileTheGameWaitsShareOneRound` can fail spuriously if a 1 s `pollAction` timeout falls
   between its snapshots.
5. The engine1113 entry below says a prompt's `cardDto` "still shares the defenders per controller": outside a snapshot
   each card gets its own round, so nothing is shared (output unchanged).

Planechase engine bugs found by the live spike `tests/live_planechase_check.js` on 2026-11-13 (engine1113 /
`mtg-forge-node:exile`). **Fixed in source 2026-11-13, not built** (branch `planechase-fix-1113`, below). On engine1113 the
spike passes 41 of 41 checks by setting its cases up around them.
Node log evidence is from the test stack, run 2026-11-13 18:54 and 19:00-19:07 local.
1. **Abort (ConcurrentModificationException) in Forge `Game.onPlayerLost`, the 901.10 block** (`Game.java:1019`):
   `for (Card c : getActivePlanes()) { ... planarController.removeCurrentPlane(c); }`. `Game.activePlanes` is the same
   list object as the `currentPlanes` of the last player to planeswalk (`Player.planeswalkTo` calls
   `game.setActivePlanes(currentPlanes)`). When that player is also the planar controller and the plane's owner is
   someone else, the loop removes from the list it is iterating, the engine thread dies, and the room aborts the game.
   - Natural play never gets this shape: the list holder walked from their own deck, so they are the owner.
   - The harness's debug `planeswalk` op does get it: `Planechase.applyOp` walks the op's player to a plane from any
     deck. The bridge's debug scenarios send it as the seat's own player (a `"planechase"` scenario's `"current"`, or
     `"planeswalk"`), and the plane may be in an AI's dealt deck. If that AI leaves on the seat's turn (or on its own
     turn, with the seat next) before anyone planeswalks again, the game aborts. Debug games only.
   - Fix (forge patch): iterate a copy, `for (Card c : new CardCollection(getActivePlanes()))`, in that loop. The 901.6
     loop above it only reads, but could take a copy too.
2. **Priority goes round for ever after a debug planar op's player leaves.** `ManaBrewInteractiveSession.applyState`
   treats `planeswalk` and `chaos` like free plays: `lastPlayer = statePlayer(op.player)`, then
   `handler.setPriority(lastPlayer)`, which sets `pFirstPriority` too. If that player then leaves the game,
   `PhaseHandler.mainLoopStep`'s "everyone passed" test (`pFirstPriority == nextPlayer`) can never be true, because
   `getNextPlayerAfter` skips a lost player. The step never ends, every seat is asked again and again, and Forge's
   runaway cap ends the game as a draw ("5001 triggers fired in one turn"). Seen with H asked 814 times in main 1,
   the board unchanged.
   - Harness fix: leave `PLANAR_OPS` out of `lastPlayer`. A planeswalk or chaos is not a play, so the player who had
     priority keeps it.
   - The same Forge gap exists without Planechase (source reading only, not run). A non-active player who holds
     `pFirstPriority` (they cast something and keep priority) and then leaves before the others pass leaves the loop
     the same way; the only exit Forge has is for the ACTIVE player (`mainLoopStep`'s "Active player is no longer in
     the game"). Fix (forge patch): at the `pFirstPriority == nextPlayer` test, treat a lost `pFirstPriority` as the
     next player in the game after it.
3. **The debug `planeswalk` op leaves the plane under its owner's control**, not the active player's (rule 901.6).
   `Player.planeswalkTo` sets no controller; Forge only moves the planes at the next turn (PhaseHandler,
   `p.setController(next, 0)` + `controllerChangeZoneCorrection`). Natural planeswalks are made by the active player
   from their own deck, so they are right; the op is wrong until the turn ends. Harness fix in `Planechase.applyOp`:
   walk as the card's owner (`destination.getOwner().planeswalkTo(...)`, the natural shape, which also avoids 1), then
   give control to `game.getPhaseHandler().getPlayerTurn()` the same way PhaseHandler does.
What a fix takes: fix 1 and the Forge half of 2 go in `engine/forge.patch`; the harness half of 2 and fix 3 go in
`Planechase.java` / `ManaBrewInteractiveSession.java`, plus a `PlanechaseTest` case for each. No protocol change, so a
node rebuild only (about 20 minutes). After the rebuild, the spike's case set-ups can go back to the simple shape (the
seat walks on its own turn), and both must pass.
**planechase-fix-1113 (source only, not built, 2026-11-13).** All three fixes, in `engine/forge.patch` and
`engine/manabrew.patch` (regenerated with `engine/make-patches.sh`; the diff against the engine1113 patches is only these
hunks). Worktree `tmp/mb-pcfix` (Manabrew branch `planechase-fix-1113` from `2af9fe9`, commit `b2e59fd`; its `forge/` is a
clone at the patch base `8f3f705d` + commit `ae1e586c`). Node only, no protocol change.
- Forge `Game.onPlayerLost` 901.10: iterates `new CardCollection(getActivePlanes())` (fix 1).
- Forge `PhaseHandler.mainLoopStep`, just before the `pFirstPriority == nextPlayer` test: if `pFirstPriority` has lost
  and is not the player passing now, it becomes `game.getNextPlayerAfter(pFirstPriority)` (the Forge half of fix 2).
  Conservative on purpose: nothing changes unless the first player to act has left. Every player between the lost one and
  the one passing now has already passed in turn, so the step still ends only after each remaining player passed once.
  It waits while the lost player itself holds priority (moving `pFirstPriority` then would end the step before anyone
  else passed). Forge's own "Active player is no longer in the game" branch runs earlier in the same call and leaves
  `pFirstPriority` on a player still in the game, so the two never meet.
- Harness `ManaBrewInteractiveSession.applyState`: `planeswalk` and `chaos` no longer set `lastPlayer` (fix 2).
- Harness `Planechase.applyOp`: walks `destination.getOwner()`, then gives every active plane to the turn player with
  `setController(active, 0)` + `controllerChangeZoneCorrection`, as PhaseHandler does (fix 3). Side effect, debug only:
  `planeswalkedToThisTurn` and the PlaneswalkedTo trigger's player are the owner, not the op's player.
- `PlanechaseTest`, five new checks: `planeswalkOpWalksAsTheOwnerAndGivesControlToTheActivePlayer`,
  `planarOpsLeavePriorityWithThePlayerWhoHadIt`, `anOwnerLeavingWhileThePlanarControllerHoldsTheirPlanePlaneswalksOn`
  (the raw Forge shape, fix 1), `anOwnerLeavingAfterThePlaneswalkOpPlaneswalksOn`, `theStepEndsWhenTheFirstPlayerToActHasLeft`
  (no Planechase, three passive AIs, fix 2's Forge half). **Not run yet**: there is no JDK here and the tests need the
  java-builder image. The break-it proof (each check fails by name with its fix removed) is part of the build steps.
- `tests/live_planechase_check.js --raw`: the spike in the simple shape (the seat's own walks, the controller checked on
  op turns). It must pass on the new image and fail (abort or runaway) on engine1113.
Build and check (bash, from `C:/Users/you/mtg-tts`, when no other agent is building):
1. `ENGINE_BUILD_DIR=$PWD/tmp/engine-build-pcfix bash engine/build-images.sh pcfix1113` (fetches the pinned upstream
   commits, applies both patches in a clean LF tree, builds node and relay; relay source is unchanged).
2. `docker build --target java-builder -f tmp/engine-build-pcfix/manabrew-rs/crates/self-hosted-node/Dockerfile -t
   mtg-harness-test:pcfix1113 tmp/engine-build-pcfix`, then `MSYS_NO_PATHCONV=1 docker run --rm -v
   "C:/Users/you/mtg-tts/tmp/engine-build-pcfix/forge-harness:/src:ro" -v
   "C:/Users/you/mtg-tts/engine/checks/harness-tests.sh:/harness-tests.sh:ro" --entrypoint sh
   mtg-harness-test:pcfix1113 /harness-tests.sh PlanechaseTest`, then with no class name (every class).
3. Break-it: revert one fix at a time and re-run PlanechaseTest. The harness fixes can be reverted in the mounted
   `forge-harness`; a Forge fix needs the java-builder image rebuilt with that hunk removed.
4. `LIVE_STACK=1 LIVE_TIMEOUT=600 bash tools/live-check.sh pcfix1113 tests/live_planechase_check.js`, then the same with
   `LIVE_ARGS=--raw`. Both must pass.
Then the usual: a row in section 3 and an entry in section 4, a rollback tag, `deploy.js --image pcfix1113`.
**Update 2026-11-14:** this source is now **built inside `engine1114-rejoin`** (section 4), whose `engine/manabrew.patch`
starts from the planechase-fix-1113 patch. In `mtg-harness-test:engine1114-rejoin` the five new `PlanechaseTest` checks
pass (whole suite 16 of 16 classes, 140 checks). Steps 3 (break-it) and 4 (the live spike, plain and `--raw`) are still
to do, on `engine1114-rejoin` in place of `pcfix1113`, before that image is deployed.
**Update 2026-11-15:** step 4 done on the deployed `engine1115b` (`:exile`, `c298b620cfd8`, which carries this source):
`tests/live_planechase_check.js` passed 38 of 38 plain and 38 of 38 with `LIVE_ARGS=--raw` (LIVE_STACK=7). In the plain
run the op left the plane with the active player at once (fix 3). Step 3 (the harness break-it) is still to do.

**engine1115-2hg (Two-Headed Giant Level 1 and team plumbing, built 2026-11-14, not deployed).** Section 4's
"2026-11-14 engine1115-2hg" entry. On top of engine1114-rejoin. Branch `2hg` of the outer repo (worktree `tmp/wt-2hg`),
not merged to main.

## 3. Summary table (newest first)

"Protocol?" says which images carry the change. "Source" gives commits in `tmp/mb-pc` (Manabrew) and the outer `mtg-tts`
repo (`engine/manabrew.patch`). Image ids are node / relay. The image list below is what Docker still holds (2026-11-12);
older ids come from the notes.

| Date (image created) | Tag (node id / relay id) | What changed | Protocol? | Source commits | Live since (deploy) | Rollback tag |
|---|---|---|---|---|---|---|
| 2026-11-17 (no image; built in a cloud session) | `engine1117-snapspeed` (no image ids) | On top of `engine1117-3hg`: the snapshot's combat flags (`cantBlock`, `cantAttack`, `mustAttack`) no longer rescan every card's statics for each creature. New harness class `CombatStatics` collects the active `CantAttack`, `CanAttackDefender`, `CantBlock` and `MustAttack` statics once per snapshot round (`SnapshotRound`, shared by the viewers of one wait) and runs Forge's own `apply*` checks on that list. A goaded creature and a "can't block alone" creature still go through Forge's `CombatUtil`. The output is byte-identical (the whole snapshot JSON at 1,000, 3,000 and 10,000 tokens). One viewer's snapshot: 102 → 42 ms at 1,000 tokens, 987 → 114 ms at 3,000, 13.4 s → 0.30 s at 10,000. `SnapshotSpeedTest` 9 checks, break-it 12 of 12 | no | outer branch `cloud/snapshot-speed` (engine/manabrew.patch only; forge.patch unchanged); branch `cloud/snapshot-speed` (`2e2b442`), merged on `engine-1120`: `engine/manabrew.patch` regenerated from a source-level merge in a clean `fd16e2f` tree (base `b9d3c34`, no source conflicts), `git apply --check` clean | not deployed | `engine1117-3hg` |
| 2026-11-16 (not built; tested as an overlay in `mtg-harness-test:l2-ai` with hand-mirrored generated classes) | big-turns-2 B (attack tax, split stacks) | The attack question now fills the step-0 fields: per attacker and legal defender `damage` (`ComputerUtilCombat.damageIfUnblocked`: pumps, double strike, prevention, 0 for infect and for a player who can't lose life), `poison` (`poisonIfUnblocked`) and, in Commander, `commander`; per defender `life` (a planeswalker's loyalty, a battle's defense; team life is mirrored), `poisonLeft`, `commanderLeft` per attacking commander (`getCommanderDamageToLose` minus the team's damage) and `canLose` (false under `cantLose` or `cantLoseForZeroOrLessLife`). Fix: cancelling one attack-tax payment no longer asks the whole declaration again (the mana-payment snapshot's restore replaced the combat with a copy whose attack constraints counted the already-tapped attackers as unable to attack, so `validateAttackers` failed and Forge re-asked and charged every attacker again); `payCombatCost` rebuilds the copy's constraints with the attackers untapped for the count. New `AttackTaxLethalTest` (12 checks: damage, pump, double strike, infect, prevention, commander, Platinum Angel, a planeswalker's loyalty, payment order follows the declaration order, a cancel leaves only that attacker home, 200 attackers in about 0.5 s). Bridge: the lethal-minimum tax question and its automatic payments; a token stack waiting for "whom?" splits among the players | node only (no new protocol field) | outer branch `big-turns-2b`; engine/manabrew.patch (ManaBrewInteractiveSession.java, ManaBrewInteractiveController.java, AttackTaxLethalTest.java, harness AGENTS.md) regenerated in a clean `fd16e2f` tree, `git apply --check` clean; `forge.patch` unchanged; `AttackTaxLethalTest` added to the harness-tests.sh defaults | not built | big-turns-2 step 0 |
| 2026-11-16 (not built; tested as an overlay in `mtg-harness-test:l2-ai` with hand-mirrored generated classes) | big-turns-2 step 0 (protocol fields) | Every protocol field of `docs/big-turns-2-spec.md` added with its default, so nothing changes yet: `CardDto.unbounded`; `AttackerOptionDto.damage` (`AttackDamageDto`); `AttackTargetDto.life`/`poisonLeft`/`commanderLeft` (`CommanderLeftDto`)/`canLose`; directives `offerTie`, `tieVote`, `releaseHold` (the harness reads and drops them); `GameViewDto.tieVote` (`TieVoteDto`), `stalemate` (`StalemateDto`), `drawReason`. Harness sends none of them (null/false). Bridge: `inf` on a card when `unbounded`, and `engineAttackData` keeps `damage`/`defenders`; nothing reads them. New `ProtocolDefaultsTest` (6 checks) | **Protocol** (node and relay must both be rebuilt: the relay drops a directive it doesn't know, and the java-builder image must regenerate the Java DTOs) | outer branch `big-turns-2`; `engine/manabrew.patch` regenerated in a clean `fd16e2f` tree, `git apply --check` clean; `forge.patch` unchanged | not built | the patches before it |
| 2026-11-16 (no image; built in a cloud session) | `engine1117-3hg` (no image ids) | main's engine + Three-Headed Giant: a revise round's title names the partner who changed the team's block (a team of three); `ThreeHeadedGiantTest` | Node only (no protocol change) | outer branch `cloud/three-headed-giant`; branch `cloud/three-headed-giant` (`b9d3c34`) merged on `engine-queue`: both patches regenerated from a source-level merge in a clean `fd16e2f` / `e7d2b93b` tree (base `1558cdb`, no source conflicts), `git apply --check` clean; `ThreeHeadedGiantTest` added to the harness-tests.sh defaults | not deployed | main's engine |
| 2026-11-16 (not built; tested as an overlay in `mtg-harness-test:l2-ai`) | big-turns (on top of Archenemy rules) | Big turns (`docs/big-turns.md`): a held exhaust pass also ends after 20 resolutions; at the runaway limit the active person is asked "Keep going" / "End in a draw" (3 a turn) instead of a silent draw; Forge `StackMerge` resolves up to 20 allowlisted alike items (fixed-number GainLife, nothing watching) back to back while every player is a person holding a pass | node only (no protocol change) | branch `big-turns` (outer repo); branch `big-turns` (`cee1f5f`) merged on `engine-queue`: both patches regenerated from a source-level merge in a clean `fd16e2f` / `e7d2b93b` tree (base: main's patches, no source conflicts), `git apply --check` clean | not deployed | engine1117-cap |
| 2026-11-16 (not built yet) | rewind card state (on top of the Archenemy patches) | A rewind now puts back what Forge's `GameSnapshot` never copied. Each card's state is copied both ways (`GameSnapshot.copyCardState`): counters (a creature kept counters put on after the point, and one that died came back with none; a planeswalker that died came back with no loyalty and died again), marked damage, the turn it entered its zone, its controllers (`Card.copyControllersFrom`: a creature stolen after the point stayed with the thief and sat on both battlefields; the zone move now takes a card out of whatever zone holds it), activation counts (`Card.copyActivationsFrom`: loyalty activations, "activate only once each turn", "triggers only once each turn"; trigger abilities mapped by trigger), remembered (it was appended, never cleared, and mapped into the snapshot's own game), imprinted, exiled cards, exiled-with/by, chosen cards/player/type/name/number; and, on the same card object only, until-end-of-turn effects with no static ability behind them (`Card.copyEffectsFrom`: power/toughness boosts and set P/T, keywords, hidden keywords, types, colours). Game state: the zones' entered-this-turn history (`Zone.copyTurnHistoryTo`: morbid, landfall counts, gravestorm), `Game`'s left-the-battlefield/graveyard lists and counters put on/removed this turn (`Game.copyTurnHistoryTo`: revolt, void), the phase counts (`PhaseHandler.copyTurnCountsTo`: first combat, first upkeep), extra phases (extra combats), the delayed triggers (`TriggerHandler.copyDelayedTriggersTo`: a Sneak Attack sacrifice that fired after the point comes back, one made after it goes), the until-phase commands (`Phase.restoreCommands`: the point's commands come back, commands made since are kept, so a pump from before the point still ends at cleanup), the monarch, initiative and day/night going back to nobody/neither (day/night set without firing its trigger, `Game.dangerouslySetDayTime`), the Ring's tempt count and ring-bearer, speed. New harness test `CardStateRewindTest` (23 checks; all 26 `harness-tests.sh` default classes pass on the overlay of `mtg-harness-test:l2-ai`); on the patches before it 21 fail; the other two (the monarch passing between players, a foretell undone) already passed there and stay as regression checks; with each fix taken out on its own, every fix fails its own checks by name (counters 3, damage 1, effects 3, activations 3, zone history 2, game history 3, controllers 1, zone move 1, monarch/day 1, remembered 1, exiled-with 1, delayed triggers 2, phase commands 1, turn in zone 1, Ring/speed 1, phase counts 1). Not changed: an until-end-of-turn effect on a card that changed zones after the point is dropped (its ending command holds the older object), `CardDamageHistory` (attacked/blocked/dealt damage this turn per creature), the per-card leaves-play/untap command lists, clone states of a clone that died after the point, the plotted flag, player keyword changes (still ended by their kept command), the achievement tracker and the Archenemy flag (set once per game) | no | outer repo engine/forge.patch (GameSnapshot.java, Game.java, card/Card.java, phase/Phase.java, phase/PhaseHandler.java, trigger/TriggerHandler.java, zone/Zone.java), engine/manabrew.patch (CardStateRewindTest.java, harness AGENTS.md); `CardStateRewindTest` added to the `harness-tests.sh` defaults; branch `rewind-audit` (`02496f5`), merged on `engine-queue`: both patches regenerated from a source-level merge in a clean `fd16e2f` / `e7d2b93b` tree (base `b68aae7`, no source conflicts), `git apply --check` clean | not yet | the patches before it |
| 2026-11-16 (not built; harness jar built in a cloud session) | First player | `gameConfig.firstPlayer` (seat index; node -> start request `firstPlayer`) names who takes the first turn in any game; in an Archenemy game without it the archenemy goes first (CR 904.6); absent, nothing changes. Refused: a seat that isn't one, or a seat that disagrees with a player's `goesFirst`. `FirstPlayerTest` 7 checks and a node test, each with a break-it | Node only (new optional `gameConfig.firstPlayer`; relay unchanged) | outer branch `cloud/first-player` (`8b1c3ec`), merged on `engine-queue`: both patches regenerated from a source-level merge in a clean `fd16e2f` / `e7d2b93b` tree (base `1e3882e`, no source conflicts), `git apply --check` clean; `FirstPlayerTest` added to the harness-tests.sh defaults | not deployed | the patches before it |
| 2026-11-16 (not built; harness jar built in a cloud session) | Archenemy view | Each player in an Archenemy game carries `isArchenemy`, `schemeDeckCount` (the order is never sent) and `schemes` (`{id, name, ongoing}`) while any are in motion; events get `how: setInMotion`, `abandoned` or `returned`. Forge `AbandonEffect` now fires the zone-change event. `ArchenemyViewTest` 7 checks and 2 protocol tests, each with a break-it | **Protocol** (`PlayerDto` gains three optional fields and `SchemeDto`; the node must be rebuilt, or it drops them) | outer branch `cloud/archenemy-view` (`3748b53`), merged on `engine-queue`: both patches regenerated from a source-level merge in a clean `fd16e2f` / `e7d2b93b` tree (base `1e3882e`, no source conflicts), `git apply --check` clean; `ArchenemyViewTest` added to the harness-tests.sh defaults | not deployed | the patches before it |
| 2026-11-16 (not built; harness jar built in a cloud session) | Archenemy scheme sweep | `ArchenemySchemeSweepTest` sets each of the 102 Forge schemes in motion through the session's prompts; all pass. Fix: `ManaBrewInteractiveController.chooseCardsToDiscardFrom` asks nothing for a discard of zero or fewer cards (Your Nightmares Are Delicious asked an opponent with 3 cards to discard -2, and the prompt refused every answer) | Node only (harness; no protocol change) | outer branch `cloud/archenemy-spike`, merged on `archenemy-spike-merge`: `engine/manabrew.patch` regenerated from a source-level merge in a clean `fd16e2f` tree (no conflicts), `git apply --check` clean; `ArchenemySchemeSweepTest` added to the `harness-tests.sh` defaults | not deployed | the patches before it |
| 2026-11-16 (not built; harness jar built in a cloud session) | Archenemy rules (on top of Archenemy plumbing) | A game is an Archenemy game when the start request says `"archenemy": true` (node: `gameConfig.archenemy`) or any player brings schemes. `Archenemy.schemeDecks` refuses a start with no archenemy, two archenemies, a scheme deck under 20 or with 3+ copies of a scheme, or shared team life (`sharedLife`, `sharedTurns`). `Archenemy.seat`: the archenemy starts at 80 in Commander and 40 otherwise unless the host named a life; the archenemy is alone on team 1 and everyone else on team 2 (request team numbers are overridden), so the others win together. No restore points in scheme games, as in Planechase (`recordCheckpoint` and the fix-op checkpoint). Non-scheme games: no change (every new path is behind a scheme deck or the flag). `ArchenemyTest` 14 checks (9 new), node test `a_game_config_archenemy_flag_reaches_java`; report `docs/handoff/archenemy-rules-report.md` | Node only (new optional `archenemy` in the start request and `gameConfig`; relay unchanged) | outer branch `cloud/archenemy-rules` (`5f71d19`), merged on `archenemy-rules-merge`: `engine/manabrew.patch` regenerated from a source-level merge in a clean `fd16e2f` tree (merge-base, branch and main patches each applied and committed, merged with git; one conflict, the `appliedVariants` signature line, taken from the branch with main's indentation), `git apply --check` clean; `forge.patch` unchanged | not deployed | the patches before it |
| 2026-11-16 (not built; harness jar built in a cloud session) | Archenemy plumbing (on top of the 2026-11-16 patches) | A player's scheme list reaches Forge: the node copies a deck's `schemes` section (as it does `planes`) or a `gameConfig.players[].schemes` name list into `players[].schemes`; the harness resolves each name to a Forge scheme (refusing any other card), applies `GameType.Archenemy` when any player has one, and gives the deck through the new `RegisteredPlayer.setSchemes`, so life stays what the request says (the 80/40 house rule goes through `startingLife`). Forge: `Player.isArchenemy` stays true once a scheme deck was dealt, even with every scheme in motion (plan §2.4), and `setSchemeInMotion` does nothing on an empty scheme deck instead of reading past it. `ArchenemyTest` 5 checks and 2 node unit tests, each with a break-it | Node only (new optional `players[].schemes` and `gameConfig.players[].schemes`; relay unchanged) | outer branch `cloud/archenemy-engine`, merged on `archenemy-merge` after the AI team attack and relay seat cap rows: both patches regenerated from a source-level merge in a clean `fd16e2f` / `e7d2b93b` tree (main and the branch each applied and committed, then merged with git; no conflicts in the Java, Rust or Forge sources), `git apply --check` clean; `ArchenemyTest` added to the `harness-tests.sh` defaults | not deployed | the patches before it |
| 2026-11-16 (not built yet) | engine1117-cap + AI team attack | On top of engine1117-cap + rewind draw count, in the same patches. The Forge attack AI now counts every creature the defending team can block with: with shared team life a defender's partner may block a creature attacking the defender (CR 805.10d, already in `CombatUtil.canBlock`), but `AiAttackController.getOpponentCreatures` listed only the chosen defender's creatures, so an AI sent a Grizzly Bears at a defender with no blockers into the partner's untapped Hill Giant. It now lists both partners' possible blockers when the game has shared team life (Level 1 and Level 2 2HG); free-for-all is unchanged. New harness test `SharedTurnsPlayTest` (5 checks): a rewind after the partner declared keeps the team's attack and drops a team extra turn taken after the point; a rewind to the partner's priority passes as a team; two AI partners attack together; the AI attacker counts the defending partner's blockers; a full AI-vs-AI 2HG Level 2 game (4 Forge AI, white flyers against green) plays to the end with one team winning, team turns alternating and both partners attacking in most combats. The rewind and team-attack checks passed before any change. Without the AI fix `anAiAttackerCountsTheDefendingPartnersBlockers` fails. `engine/checks/harness-tests.sh` now runs `SharedTurnsTest`, `SharedTurnsDevTest`, `SharedCombatTest` and `SharedTurnsPlayTest` by default | no | outer repo engine/forge.patch (forge-ai AiAttackController.java), engine/manabrew.patch (SharedTurnsPlayTest.java) | not yet | engine1116-teams3 |
| 2026-11-16 (not built yet) | relay seat cap 8 (M6 step 7) | The relay's `SetMaxPlayers` (`manabrew-server/src/lobby.rs` `set_max_players_sync`) clamps to 8 instead of 4, the same cap as room creation (`room.rs`), so the bridge's request for 5 or 6 seats works in a room the relay reset to 4 after a game. `reset_lobby_settings` still puts 4 back after each game. Only the lobby.rs section of `engine/manabrew.patch` changed (one hunk added, regenerated in a clean `fd16e2f` tree with the whole patch applied; `git apply --check` clean). No comment in the code; no relay test asserts the 4. `stack/compose.yml` default `SEATS` 4 → 6 (the node's room size; it spawns at most 5 AI) | Relay only (no protocol change); node unchanged. Rebuild the relay with the next engine image | outer repo branch `m6-seats` (engine/manabrew.patch, stack/compose.yml) | not yet | the relay tag before it |
| 2026-11-16 (not built yet) | engine1117-cap + rewind draw count | On top of engine1117-cap, in the same patches. A rewind now restores how many cards each player drew this turn: Forge's `GameSnapshot.assignPlayerState` never copied `Player.numDrawnThisTurn`, so after a rewind the count kept its later value and "second card each turn" triggers (Faerie Mastermind, live 2026-11-15, `bridge/game-log.txt` ~5473-5510) stopped firing. It now also copies the extra-draw count, cards drawn last turn and lands played last turn (new `Player.setNumDrawnThisTurn(drawn, extra)` and `getNumExtraDrawnThisTurn()`). Test `DrawCountRewindTest` (3 checks); with the copy line removed, `rewindRestoresTheCardsDrawnThisTurn` and `faerieMastermindTriggersOnTheSecondDrawAfterARewind` fail. Second pass, same day: the snapshot now copies every other per-turn player counter that `Player.onCleanupPhase` resets: draws this draw step, hand size at turn start, rolls and dice rolls, flips, explored, foretold, tokens created, investigated, scry, surveil, attractions visited, descended, ventured, tapped a land for mana, life-gain times, life gained by the team (the 2HG life house rule reads it), dealt combat damage since last turn, elemental bends, last turn number, spells cast this game (new setters on Player). Discarded and sacrificed this turn and spells cast since your last turn are lists of last-known-information copies that are in no zone, so they are copied as they are, not mapped; planes walked to, attacked players this and last turn and the creatures that attacked this turn are mapped to the other game's cards and players (new `Player.copyTurnHistoryToSnapshot`). Spells cast this turn (the storm count) was never restored: it is the stack's cast list, which the snapshot did not copy, and the old `addSpellCastThisTurn` loop only raised the spells-cast-this-game count (it ran 0 times on a restore, so nothing was double counted, and nothing was rolled back either). The stack's this-turn and last-turn cast lists are now copied (new `MagicStack.setSpellsCast`). Not copied: the zones' cards-added-this-turn history and the achievement tracker. Test `TurnCounterRewindTest` (8 checks); removing the team life-gain copy fails `rewindRestoresLifeGainedByTeam`, the scry copy fails `rewindRestoresTheScryCount`, the stack copy fails `rewindRestoresTheSpellsCastThisTurn` and `stormCountsFromTheCheckpointAfterARewind` | no | outer repo engine/forge.patch (GameSnapshot.java, player/Player.java, zone/MagicStack.java), engine/manabrew.patch (both tests) | not yet | engine1116-teams3 |
| 2026-11-15 (not built yet) | engine1117-cap | engine1117-block (2HG level 2, life house rule, joint team blocks) plus the runaway caps back to Forge's default 25,000 per turn: the harness no longer lowers them to 1,000 new cards / 5,000 triggers (Main and ManaBrewEngineAdapter). A real Second Harvest turn (about 112 tokens doubled) hit 5,000 and the game was ended as a draw, live 2026-11-15. The owner chose 25,000 | no | outer repo engine/*.patch (team-block patches from cloud/team-block + this hunk) | not yet | engine1116-teams3 |
| 2026-11-15 12:08 / (relay layers cached, 2026-11-14 12:51 stamp) | `engine1116-teams3` (`c156f48555ce` / `5b2f8fd69dc8`) | engine1116-teams2 + the 2HG house rule: a partner's life gain or loss counts as yours (triggers, this-turn counts, first time each turn, lifegain replacements), behind `GameRules.teamLifeEvents`, on in every `sharedLife` game | Node only (relay source unchanged) | tree `tmp/wt-2hghouse/tmp/eb-house`, branch `2hg-house` (`1806dd9` on `ba4da9e`), its `forge/` `2hg-house` (`02c1dad1` on `85bc8c3d`); outer branch `2hg-house-life` | not deployed | `engine1116-teams2` (`a904893325fc` / `5173c7e692c2`) |
| 2026-11-15 04:21 / (relay layers cached, 2026-11-14 12:51 stamp) | `engine1116-teams2` (`a904893325fc` / `5173c7e692c2`) | engine1116-teams + engine1115-2hgrules in one engine (the four 2hg-rules Forge commits and their harness tests cherry-picked) | Node only, as both parts | tree `tmp/wt-teams/tmp/eb1116-teams`, branch `teams-1116` (+ `6c97e3b`..`ba4da9e`), its `forge/` + `e7b32d36`..`85bc8c3d`; outer branch `teams-2v2-juggernaut` | not deployed | `engine1115b` |
| 2026-11-15 03:16 / (relay layers cached, 2026-11-14 12:51 stamp) | `engine1116-teams` (`0966b1c0d6cb` / `b07cf1600b20`) | Per-player rules for 2v2 Team Commander and Juggernaut: perks (hidden effect cards from Forge script lines), a player's own commander-damage limit, a named first player, `ReplaceBeginTurn` `ExtraTurn$ False`; on top of engine1115b | Node only (`gameConfig` fields through the node's serde structs; relay source unchanged) | tree `tmp/wt-teams/tmp/eb1116-teams`, branch `teams-1116` (`0569073`, `36617e3`, `4eb95da` on `44de312`), its `forge/` branch `teams-1116` (`7451885e` on `19931d89`); outer branch `teams-2v2-juggernaut` | not deployed | `engine1115b` (`c298b620cfd8` / `8f10863542e6`) |
| 2026-11-15 (2026-11-15 03:46 / relay layers cached, 2026-11-14 12:51 stamp) | `engine1115-2hgrules` (`01be70a2e78f` / `b3d530c62920`) | Two-Headed Giant rules audit against CR 810: team pay life (810.9h), can't win (810.8a), can't get poison (810.10c), opponents' poison once a team (810.10a), set life and redistribution one member a team (810.9d, 810.9f), proliferate one poison a team (701.34b) | Both rebuilt, no protocol change | tree `tmp/wt-2hgrules/tmp/eb-rules`, branch `2hg-rules` (`8b33391` on `44de312`), its `forge/` branch `2hg-rules` (`ec4266d5` on `19931d89`); outer branch `2hg-team-rules` | not deployed | `engine1115b` (`c298b620cfd8` / `8f10863542e6`) |
| 2026-11-14 16:00 / (relay layers cached, 12:51 stamp) | `engine1115b` (`c298b620cfd8` / `8f10863542e6`) | engine1115-2hg with the one Java comment taken out of `ActionSpace.getStackTargetCandidates` (the AGENTS.md rule); no code change | Both rebuilt, no protocol change (relay source unchanged) | tree `tmp/eb1115b`, branch `nocomment-1115` (`44de312` on `f995fab`), its `forge/` branch `nocomment-1115` = `19931d89`; outer branch `engine-nocomment` | not deployed | `engine1115-2hg` (`fcb808036400` / `034587f1f7b1`) |
| 2026-11-14 12:49 / 12:51 | `engine1115-2hg` (`fcb808036400` / `034587f1f7b1`) | Two-Headed Giant Level 1 (shared life and poison, team loss, team blocks, team-lead start, 2HG Commander numbers) and the team plumbing (`gameConfig`, `teamRules`); the Forge AI blocks for its partner; on top of engine1114-rejoin | **Both** (protocol: `StartGameRequest` team fields, `GameViewDto.teamRules`, relay allow-list `gameConfig`) | tree `tmp/eb1115-2hg` in `tmp/wt-2hg`, branch `2hg-1115` (`4f4411c`, `f995fab`), its `forge/` branch `2hg-1115` (`ef17522a`, `7f3026cb`, `19931d89`); outer branch `2hg` | not deployed | `engine1114-rejoin` (or `engine1113`, the live one) |
| 2026-11-14 03:25 / (relay cached, 2026-11-12 20:07 stamp) | `engine1114-rejoin` (`3e8f2005bda9` / `4e47919e1966`) | A rewind brings back players who conceded or lost after the point; also carries planechase-fix-1113 (first build) | Node only (no protocol change; relay source unchanged) | tree `tmp/eb1114-rejoin` in worktree `agent-ac7d563c775ca72fd`, branch `rejoin-1114` (`866240c`, `0d6dfa3`, `df0e503`); bridge "is back in the game" line | not deployed | `engine1113` (`4d0f4dcaa0f7` / `d88922ebdd9f`) |
| 2026-11-13 02:07 / (relay layers all cached, 20:07 stamp) | `engine1113` (`4d0f4dcaa0f7` / `d88922ebdd9f`) | Combat flags once per snapshot round; delayed-trigger ids per viewer; face-down `unlockedDoors` blanked; no ownerless or targetless damage entries | Node only (no protocol change; relay rebuilt from the same tree, source unchanged) | tree `tmp/eb1113` in the outer worktree (`engine/manabrew.patch` regenerated); bridge `delayedOf` reads an empty text as hidden | **deployed 2026-11-13 09:37 UTC** (main 75fc8a2) | `engine1112` (`0306d683de26` / `58cf2e3da251`) |
| 2026-11-12 20:03 / 20:07 | `engine1112` (`0306d683de26` / `58cf2e3da251`) | Per-permanent card flags; effects, delayed triggers, storm and per-turn counts in the view; damage events in the feed | Node needed; relay optional (the old relay passes the new fields, proved live) | mb-wt-merge `86b9279`, `6b6d362`, `8fac2bb`, merge `ecf76ab`; no compile fix needed | **deployed 2026-11-12** (main `f66ba5e`, table `01875e13`, save `30d57321`) | `batch2-1112` (`975d62f6279e` / `57aa07a9b314`) |
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
mtg-forge-node:engine1113               4d0f4dcaa0f7  2026-11-13 02:07:15   (added 2026-11-13)
mtg-relay:engine1113                    d88922ebdd9f  2026-11-12 20:07:48   (added 2026-11-13; every layer from cache)
mtg-relay:engine1112                    58cf2e3da251  2026-11-12 20:07:48
mtg-forge-node:engine1112               0306d683de26  2026-11-12 20:03:48
mtg-harness-test:engine1112             5a8646db5b1f  2026-11-12 19:36:54
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

### 2026-11-17 engine1117-snapspeed: combat flags from one static scan per snapshot (built in the cloud, no image)
- **Problem:** on big boards most of each snapshot's time went to `InteractiveSnapshotExtractor.combatFlags`. Forge's
  `CombatUtil.canBlock`, `canAttackNextTurn` (for each possible defender) and `StaticAbilityMustAttack.entitiesMustAttack`
  each walk every static ability of every card in the static zones, for every creature. That is quadratic in the board
  size.
- **Change:**
  - `forge-harness/.../host/CombatStatics.java` (new) walks the static zones once. It keeps the statics whose
    `checkMode` is `CantAttack`, `CanAttackDefender`, `CantBlock` or `MustAttack` and whose `checkConditions()` holds.
  - It then answers each creature with Forge's own per-ability checks (`applyCantAttackAbility`,
    `applyCanAttackDefenderAbility`, `applyCantBlockAbility`, and the `MustAttack` loop with its CR 506.2 turn rule).
    The keyword and detained checks keep Forge's order.
  - A defender's `CantAttack` keyword static is answered from the cached `CanAttackDefender` list, since Forge's own
    `canAttackDefender` would rescan.
  - A goaded attacker and a "can't block alone" blocker fall back to Forge's `CombatUtil`.
  - `SnapshotRound` holds one `CombatStatics` and builds it on first use. The flags were already cached per card in the
    round.
- **Tests:**
  - `SnapshotSpeedTest`, 9 checks. It compares every creature's three flags in the snapshot with Forge's own functions,
    for each viewer and on each player's turn. The boards cover:
    - a mixed board: two Walls, Rolling Stones, Blazing Archon, Moat, Ensnaring Bridge, Pacifism, Hulking Goblin,
      Bloodrock Cyclops, Goblin Rabblemaster, Public Enemy, Propaganda, and a Peacekeeper in a graveyard;
    - Peacekeeper;
    - defenders without and then with Rolling Stones;
    - Ensnaring Bridge as the hand goes from 0 to 7 cards;
    - a goaded creature;
    - can't block alone, alone and then with a partner.
  - Further checks: one static scan for a round of 1,000 creatures; the cached flags at least 3x faster than Forge's
    per-creature scans at 1,000 tokens (about 5 ms against 105 ms here); and 3,000 creatures taking under 7x the time of
    1,000.
  - `CardStateFlagsTest` and the whole harness suite (29 classes) pass.
  - Break-it: `node tools/mutate-snapshot-speed.js <tree>`, 12 of 12 caught by name.
- **Not done:** no image, no live game.

### 2026-11-16 big-turns-2 B: attack tax at the lethal minimum, one stack per defender (not built)
- **Why:** `docs/big-turns-2-spec.md` items 3 and 4, with the user's decisions 5 ("Pay for all" next to the lethal
  minimum) and 7 (attacks split into one stack per defending player automatically).
- **Harness** (`publishAttackersPrompt`): each attacker's `damage` per legal defender, from Forge's own AI helpers:
  `damageIfUnblocked(attacker, defender, combat, false)` (net combat damage, known pumps, double strike, prevention; 0
  with infect and for a player who can't lose life), `poisonIfUnblocked` (0 at a planeswalker or battle) and, when the
  Commander variant applies and the attacker is a commander attacking a player, `commander` = its damage. Each
  defender: `life` (a player's life, mirrored team life in 2HG; a planeswalker's loyalty; a battle's defense),
  `poisonLeft` (`GameRules.getPoisonCountersToLose` minus the player's poison), `commanderLeft` (one entry per
  commander among the offered attackers, Commander only: the player's `getCommanderDamageToLose` minus
  `getTeamCommanderDamage`), `canLose` (false when `cantLose()` or `cantLoseForZeroOrLessLife()`; true for a
  planeswalker or battle).
- **Fix:** cancelling one attack-tax payment asked the whole declaration again. The payment's `GameSnapshot` restore
  replaces the combat with a copy (`Combat(Combat, map)`) whose `AttackConstraints` are built while the attackers are
  already tapped (CR 508.1f taps them before the taxes), so `validateAttackers` counted every attacker as illegal;
  Forge then cleared the attack and asked again, and the mana already paid for the others was gone (Forge's own TODO:
  no refund). `ManaBrewInteractiveController.payCombatCost` now rebuilds the restored combat's constraints with its
  tapped attackers untapped for the count (`initConstraints`), then taps them again. Found by `AttackTaxLethalTest`.
- **Measured:** the attack question for 200 attackers under Ghostly Prison is built in about 0.5 s (`time attackPrompt200`).
- **Proved:** Forge pays the taxes in declaration order within a defender (`combat.getAttackers()` walks each
  defender's bands in the order they were added, and the controller adds the declaration in the order sent), so the
  bridge sending its plan highest damage first makes Forge charge those first.
- **Bridge:** `attackTaxPlan` asks once per taxed defender with two or more attackers: "Pay {X} for k" (the fewest
  attackers lethal by life, 10 poison or one commander's 21, highest damage first), "Pay for all n", "Don't attack",
  Back. `taxPlanPay` answers the payments by itself (auto-pay, then the pool; the first that can't finish and every later
  one at that defender are cancelled) and priority says "Paid for 9 of 14 attackers at Blue; the other 5 stay home."
  `attackSplit` splits a token stack waiting for "whom?" among the players (seat order from the attacker's left,
  floor(N/k) and the first N mod k one more; one share per team with shared life), and the log says it in one line.
  The plan never picks paying life itself; what Forge's auto-pay does with Norn's Annex's {W/P} is unchecked. A player
  under `cantLoseForZeroOrLessLife` (Phyrexian Unlife) is sent `canLose: false`, so the poison and commander routes are
  not offered for them either (the fail-safe side: "Pay for all").
- **Tests:** `AttackTaxLethalTest` (harness, in the defaults); `tests/test_bridge_attack_tax_lethal.js` (57),
  `tests/test_bridge_stack_split.js` (24) in the deploy gates; a table check in `test_table_claims.js` that a split
  stack draws as three stacks. Break-its fail by name; an adversary pass of 27 bridge mutations caught all but one
  equivalent program after five new checks (poison order, planned-first order, a full share, sizes, a gone target).

### 2026-11-16 big-turns-2 step 0: the protocol fields (not built)
- **Why:** a new protocol field needs a new `java-builder` image, so every field the five big-turns-2 items need goes in
  one step (`docs/big-turns-2-spec.md` section 7, with the user's decisions at its end). Nothing fills them yet.
- **New fields** (all optional; an old relay, node or bridge ignores them):
  - `CardDto.unbounded: bool` (skipped when false; the harness's Gson writes `"unbounded": false` like the other card
    flags).
  - `AttackerOptionDto.damage: [AttackDamageDto { defenderId, damage: u32, poison: u32, commander?: u32 }]` (skipped
    when empty; the harness passes null, so the attack question's JSON is unchanged).
  - `AttackTargetDto.life?: i32`, `poisonLeft?: i32`, `commanderLeft: [CommanderLeftDto { commanderId, left: i32 }]`,
    `canLose?: bool` (all null from the harness).
  - `GameViewDto.tieVote?: TieVoteDto { voteId, requestedByPlayerId? (none = the engine offered it on a stalemate),
    awaitingPlayerIds, status: pending | accepted | declined { playerId } }`, `stalemate?: StalemateDto { playerId, lock
    (cantLose, lifeCantFall, damageCantKill, damagePrevented or fogLock), cardId?, cardName?, roundsWithoutProgress? }`,
    `drawReason?: string` (why the engine drew a game: the missed runaway questions, the heap backstop, a forced or an
    agreed tie; the bridge's `gameEndWords` says no reason today). The harness's snapshot map doesn't add them.
  - Directives `{type: "offerTie"}`, `{type: "tieVote", voteId, accept}`, `{type: "releaseHold"}`: the node routes them
    to the seat like `restoreVote`; `ManabrewProtocolAdapter` turns them into `offer_tie`, `tie_vote`, `release_hold`;
    the session's `takeAction` drops them.
- **Not protocol** (the decisions' "Pay for all" button, the automatic split per defender): bridge-only, no field needed.
- **Files:** manabrew-protocol `game/mod.rs`, `prompts/choose_attackers.rs`, `prompts/common.rs`, `transport/mod.rs`;
  manabrew-agent-interface `game_view_dto.rs`, `agent_impl/mod.rs`, `agent_impl/combat.rs`; self-hosted-node `host.rs`;
  `src/lib/gameCard.ts`; harness Session, `ManabrewProtocolAdapter`, new `ProtocolDefaultsTest`; bridge.js.
- **Not checked here:** no Rust toolchain or image was used, so `cargo check` and the real `gen-protocol` run happen at
  the next image build. The harness tests compiled against hand-made copies of the generated Java (`AttackerOptionDto`,
  `AttackTargetDto`, `CardDto`, new `AttackDamageDto` and `CommanderLeftDto`), written the way
  `scripts/gen-harness-prompts.mjs` writes them (field order = Rust order).

### 2026-11-16 engine1117-3hg: Three-Headed Giant checks and the revise title (built in the cloud, no image)
- **Checked:** the team code takes three members as it is: shared life and poison mirror to all three
  (`Player.sharedLifeTeam` is the whole team), a loss or a concession takes the whole team (`GameAction` loops over every
  teammate), the joint block re-asks every partner who already answered, and `configureTeamRules` gives 45 life and 20
  poison (120 and 63 in Commander) for three (`TeamGameTest` already checked those numbers).
- **Changed:** in a team of three a revise round's title named every partner ("Green and Purple changed the blocks").
  `Combat.teamBlockChangedBy` (set by `PhaseHandler` when an answer changes the team's block) now names the one who
  changed; the harness title uses it.
- **Tests:** new `ThreeHeadedGiantTest`, 6 checks (45 life and 20 poison from the request, a Bolt to one head takes it from
  all three, 19 poison doesn't lose and 20 loses all three, a concession concedes all three, the defending team of three
  blocks as one decision, a revise prompt names the partner who changed). Break-it: `node tools/mutate-3hg-engine.js
  <tree>`, 6 of 6 caught by name. `TeamGameTest`, `SharedCombatTest` and `SharedTurnsTest` still pass.
- **Not done:** no image, no live game.

### 2026-11-16 big-turns: held passes end every 20, the runaway limit asks, StackMerge (not built)
- **Problem:** live 2026-11-15 ~23:06: 75 Scute Swarm landfall triggers took 73.5 s (two human priority prompts per
  trigger), then Second Harvest ran 137 s inside Forge and hit the runaway limit: a draw nobody was asked about.
- **What, harness (`engine/manabrew.patch`):** `PriorityFastForward.exhaustEnded` also ends a held exhaust pass once
  `EXHAUST_RESOLUTIONS` (20) declared items have left the stack; `heldResolutionsLeft` (and the controller's) says how
  many are left. `ManaBrewInteractiveSession` installs `keepGoingPastCap` as Forge's `Game.RunawayChoice` (a
  `confirm_action` boolean, title "This turn passed the engine's limit", buttons "Keep going" / "End in a draw", the body
  in `presentation.description`; asks the active person, else the first person) and `heldByEveryone` as the merge gate of
  `MagicStack`. `forge-harness/.../AGENTS.md` says so. No protocol change.
- **What, Forge (`engine/forge.patch`):** `Game`: `RunawayChoice`, `RUNAWAY_CONTINUES_PER_TURN` (3), a per-turn allowance
  for each limit (a yes raises that limit by its own size), the card limit asked at the next trigger or token request
  (`cardsCapPending`), `checkRunawayCap` renamed `endRunawayGame`; with no choice installed the limits draw as before.
  New `forge.game.zone.StackMerge` (the allowlist and why each entry is safe, in its Javadoc and `docs/big-turns.md`),
  `MagicStack.resolveAlike`, `setMergeGate`, `getMergedResolutions`, `TriggerHandler.watches` and `hasWaitingTriggers`.
- **Tests:** `BigTurnsTest` (21 checks, all pass) and `BigTurnTimingTest` (the timings in `docs/big-turns.md`), run as an
  overlay on `mtg-harness-test:l2-ai`; break-its in one container, each mutation failing named checks.
- **Bridge (not engine, same branch):** `heldPass` sends `exhaustStack` on automatic passes over a whole-stack run of 5 or
  more alike untargeted triggers; `mtg stop`; the runaway question shown with the engine's words and announced to all.
- **Rollback:** engine1117-cap.

### 2026-11-15 engine1116-teams3: the 2HG house rule, a partner's life gain or loss is yours (built, not deployed)
- **Problem:** the user's answer to the rules audit's first conflict (2026-11-15): build it as a house rule. In 2HG a
  teammate's life gain or loss also counts as yours for "you gain/lose life" triggers and conditions. CR 810.9 has them
  happen to each player alone, so this is not the CR (`docs/game-modes-spec.md` §5.9.1 says so). Commander damage stays 42
  summed over the team (the user: no change).
- **What, Forge (`engine/forge.patch`, behind the new `GameRules.teamLifeEvents`, which counts only with
  `sharedTeamLife`):** `Trigger.matchesValidLifePlayer` (used by `TriggerLifeGained`, `TriggerLifeLost`,
  `TriggerLifeLostAll`): a gain or loss by a teammate of the trigger's controller is tested as the controller's own, so
  Ajani's Pridemate grows on the partner's gain; the event is still one player's, so each trigger fires once per gain.
  `ReplaceGainLife.gainedByTeammate`: "if you would gain life" replacements (Boon Reflection) apply to the partner's gain,
  each replacement once. `Player.lifeEventTeam` and `getTeamLifeGainedThisTurn`, `getTeamLifeGainedTimesThisTurn`,
  `getTeamLifeLostThisTurn`, `getTeamLifeLostLastTurn` (the team's sums) feed the counts `LifeYouGainedThisTurn`,
  `LifeYouLostThisTurn`, `LifeYouGainedTimesThisTurn`, the player counts `LifeLostThisTurn`, `LifeLostLastTurn`,
  `LifeGainedThisTurn` and the `LostLifeThisTurn` player property; a gain's or loss's `FirstTime` is the team's first that
  turn. Each player's own fields and getters are unchanged, so rewinds and game copies copy them as before. Not changed
  (chosen): "if you would lose life" replacements, opponents' counts (`LifeOppsLostThisTurn`).
- **What, harness (`engine/manabrew.patch`):** `configureTeamRules` turns `setTeamLifeEvents(true)` on with
  `setSharedTeamLife(true)` (no request field: every 2HG game has it); `forge-harness/.../AGENTS.md` says so; 6 new
  `TeamGameTest` checks and one more line in `requestSetsTeamsAndTwoHeadedGiantNumbers` (41 in all). No protocol change.
- **Source:** tree `tmp/wt-2hghouse/tmp/eb-house`, a clone of `tmp/wt-teams/tmp/eb1116-teams` (engine1116-teams2, left
  untouched): branch `2hg-house` = `teams-1116` (`ba4da9e`) + `1806dd9`; its `forge/` branch `2hg-house` =
  `teams-1116` (`85bc8c3d`) + `02c1dad1`. Patches regenerated with `ENGINE_WORK_DIR=tmp/wt-2hghouse/tmp/eb-house
  ENGINE_BUILD_DIR=tmp/wt-2hgrules/tmp/engine-build bash engine/make-patches.sh` (446 and 58 files); against main's
  engine1116-teams2 patches only the house-rule files and hunk offsets differ.
- **Build:** through `tmp/slot.js`, `ENGINE_BUILD_DIR=tmp/wt-2hgrules/tmp/engine-build bash engine/build-images.sh
  engine1116-teams3`: `mtg-forge-node:engine1116-teams3` `c156f48555ce`, `mtg-relay:engine1116-teams3` `5b2f8fd69dc8`
  (relay unchanged); test image `mtg-harness-test:engine1116-teams3` `21ef2452af0c` (`--target java-builder`). The running
  stack was not touched.
- **Proof:** `engine/checks/harness-tests.sh` in `mtg-harness-test:engine1116-teams3` on
  `tmp/wt-2hghouse/tmp/eb-house/forge-harness`: 18 of 18 classes, 194 checks (`TeamGameTest` 41). New checks:
  `aPartnersLifeGainTriggersYourPridemateOnce` (Red gains 3: White's and Red's Pridemates once each, Yellow's not),
  `lifeGainedThisTurnCountsThePartnersGain` (Angelic Accord's count: Red's 4 gained and 2 lost are White's, not Yellow's;
  each player's own record unchanged), `theFirstGainEachTurnIsTheTeams` (Attended Healer once on Red's first gain, not
  again on White's), `aPartnersLifeLossTriggersYourLoseLifeTrigger` (Gonti's Machinations on a Bolt to Red),
  `yourLifegainReplacementDoublesAPartnersGainOnce` (White's Boon Reflection: Red's 2 becomes 4, an opponent's stays 2),
  `partnersLifeEventsAreTheirOwnWithoutTheHouseRule` (shared life with the flag off: no trigger, no count, no doubling).
  Break-it (`tmp/wt-2hghouse/tmp/mutate-house.sh`: the nine changed Forge classes compiled into the harness classpath
  ahead of the engine1116-teams2 jar, one mutation at a time, each file restored and checked by sha256), baseline 41 of
  41: the trigger's partner test removed fails `aPartnersLifeGainTriggersYourPridemateOnce` and
  `theFirstGainEachTurnIsTheTeams`; the first gain the player's own fails `theFirstGainEachTurnIsTheTeams`; gained and
  lost this turn the player's own each fail `lifeGainedThisTurnCountsThePartnersGain`; the replacement's partner test
  removed fails `yourLifegainReplacementDoublesAPartnersGainOnce`; a gain also run as each partner's (the double trigger)
  fails `aPartnersLifeGainTriggersYourPridemateOnce` (2 triggers); the rule on with shared life alone fails
  `lifelinkRaisesTheTeamAndTriggersOnlyItsController` and `partnersLifeEventsAreTheirOwnWithoutTheHouseRule`; the harness
  not setting it fails `requestSetsTeamsAndTwoHeadedGiantNumbers`. Live, `LIVE_STACK=8 LIVE_TIMEOUT=600 sh
  tools/live-check.sh engine1116-teams3 tests/live_2hg_check.js`: 24 of 24. A headless 2HG Commander game to the end on
  test stack 8 (port 9452, `tmp/wt-2hghouse/tmp/headless-2hg.sh`, `bridge/engine-test.js --seats 4 --bots 3 --mode 2hg`):
  80 shared life, 33 turns, 632 responses, Yellow + Blue won. `tests/test_table_golden.js` 6 games match;
  `tests/test_bridge_golden.js` (with `MTG_HOME` at the main checkout, for Manabrew's preset decks) 1072 of 1072.
- **Deploy (when wanted):** TTS closed, no game running, from main after this branch is merged:
  `MTG_MANABREW=tmp/wt-2hghouse/tmp/eb-house node tools/deploy.js --image engine1116-teams3`.
- **Rollback:** `node tools/deploy.js --image engine1116-teams2` (or `engine1115b`, the live one).

### 2026-11-15 engine1116-teams2: engine1116-teams and the 2HG rules audit together (built, not deployed)
- **What:** one engine with both 2026-11-15 changes: engine1116-teams (below) and engine1115-2hgrules (its entry below).
  The 2hg-rules Forge commits `e71b3451`, `a34d23ca`, `5dd8325a`, `ec4266d5` (in `tmp/wt-2hgrules/tmp/eb-rules`) cherry-picked
  onto `forge/` branch `teams-1116` as `e7b32d36`, `4ec7daea`, `6edccf0c`, `85bc8c3d`; its harness tests `a19510f`..`8b33391`
  onto `teams-1116` as `6c97e3b`..`ba4da9e`. No conflicts (both touch `Player.java` in different places). Patches
  regenerated (forge.patch 440 files, manabrew.patch 58); every per-file section from main's engine1115-2hgrules patches
  is unchanged in them, and only the engine1116-teams files differ.
- **Build:** `ENGINE_BUILD_DIR=tmp/wt-teams/tmp/engine-build-teams bash engine/build-images.sh engine1116-teams2` through
  `tmp/slot.js`: `mtg-forge-node:engine1116-teams2` `a904893325fc`, `mtg-relay:engine1116-teams2` `5173c7e692c2`; test image
  `mtg-harness-test:engine1116-teams2` `5e579df9370c`. The running stack was not touched.
- **Proof:** `engine/checks/harness-tests.sh` in `mtg-harness-test:engine1116-teams2`: 18 of 18 classes, 188 checks
  (TeamGameTest with the 2hg-rules checks, PlayerRulesTest 13). `node engine/checks/mutate-player-rules.js
  tmp/wt-teams/tmp/eb1116-teams engine1116-teams2`: 12 of 12 caught. Headless games to the end, `bridge/engine-test.js --seats 4 --bots 3 --mode ...` on test stack 7 (port 9451,
  beside the real stack) through `tmp/slot.js`: **2v2** 35 turns, 40 life each, Yellow + Blue won after White and Red
  lost; **Juggernaut** (Red, defaults) 21 turns, Red started at 80 life with 10 cards, went first and drew 2 a turn,
  Red alone won ("Ramses" deck; White and Yellow were marked lost alive at 36 and 40 when Blue fell, most likely the
  commander's own win line, not checked); **Juggernaut** (White, `--jugg-order after --jugg-cmd 42`) 44 turns, the
  turns went J, Red, J, Yellow, J, Blue, J... (the library 2 shorter on each Juggernaut turn), White lost at -10 life
  and the three won together; **2HG** 26 turns, 80 shared life, Yellow + Blue won. The same four on engine1116-teams
  first (2v2, Juggernaut defaults and 2HG to the end; the "after" run hit the merge in progress and was redone).
  `LIVE_STACK=7 LIVE_TIMEOUT=600 sh tools/live-check.sh engine1116-teams2 tests/live_2hg_check.js`: 24 of 24.
- **Deploy (when wanted):** TTS closed, no game running, from main after this branch is merged:
  `MTG_MANABREW=tmp/wt-teams/tmp/eb1116-teams node tools/deploy.js --image engine1116-teams2`.
- **Rollback:** `node tools/deploy.js --image engine1115b`.

### 2026-11-15 engine1116-teams: per-player rules for 2v2 and Juggernaut (built, not deployed; superseded by engine1116-teams2)
- **Problem:** the next game modes (`docs/game-modes-spec.md` §4.1, §6): 2v2 Team Commander needs nothing the 2HG plumbing
  lacks, but Juggernaut needs per-player rules the engine had no way to take: the Juggernaut's extra draw and land plays,
  its own commander-damage limit (42 as an option, the others 21), the Juggernaut going first (no roll), and the
  optional turn order "the Juggernaut after every challenger".
- **What, Forge (`engine/forge.patch`):** `GameRules.startingPlayer` (-1 by default), read by
  `GameAction.determineFirstTurnPlayer` after the Puzzle check; `RegisteredPlayer.commanderDamageToLose` (0: the game's
  limit) and `Player.getCommanderDamageToLose` (the player's own, else the rules'), used by the commander-damage loss
  check and by forge-ai `ComputerUtilCombat.getLifeThreateningCommanders`; `ReplaceBeginTurn` reads `ExtraTurn$ False`
  (replace only a turn that is not an extra turn; before, `ExtraTurn` could only mean True). Outside these settings
  every path is as before.
- **What, harness and node (`engine/manabrew.patch`):** `gameConfig` / `StartGameRequest` players gain `perks` (Forge
  card-script lines: Name:, Oracle:, SVar:, T:, S:, R:), `commanderDamageToLose` and `goesFirst`.
  `ManaBrewEngineAdapter.configurePlayerRules` refuses an unknown perk line, a limit below 1 and two first players,
  and sets `GameRules.startingPlayer`; `configurePlayer` sets the player's limit; after `match.createGame()`
  `host/Perks.addAll` makes one effect card per player with perks (`GamePieceType.EFFECT`, owner the player, in the
  command zone; an immutable card with no effect source, so neither the command zone nor EffectsView shows it). Node
  `java_backend.rs`: `GameConfigPlayer` and `PlayerConfig` carry the three fields (serde defaults; skipped when empty),
  `apply_game_config` copies them. The relay passes `gameConfig` as it is, so its source is unchanged.
- **The perks the bridge sends** (`bridge/teams.js` `juggPerks`, the same lines `PlayerRulesTest` proves): extra draw, a
  static `Phase` trigger in the draw step (`DB$ Draw`); extra land plays, a continuous `AdjustLandPlays`; turn order
  "after", a static upkeep trigger on each opponent's upkeep (`DB$ AddTurn`, an extra turn after this one) plus a
  `BeginTurn` replacement `ExtraTurn$ False | Skip$ True` on the Juggernaut's own normal turns.
- **Source:** tree `tmp/wt-teams/tmp/eb1116-teams`, a clone of `tmp/eb1115b` (left untouched): branch `teams-1116` =
  `nocomment-1115` + `0569073` (feature), `36617e3` (a missing import found by the first build), `4eb95da` (the test
  helper resets the phase's active triggers, as `PhaseHandler.onPhaseBegin` does); its `forge/` branch `teams-1116` =
  `19931d89` + `7451885e`. No comments in the Manabrew Java. Patches regenerated with `ENGINE_WORK_DIR=tmp/wt-teams/tmp/eb1116-teams
  ENGINE_BUILD_DIR=tmp/wt-teams/tmp/engine-build-teams bash engine/make-patches.sh` (forge.patch 438 files).
- **Build:** through `tmp/slot.js`, `ENGINE_BUILD_DIR=tmp/wt-teams/tmp/engine-build-teams bash engine/build-images.sh
  engine1116-teams`: `mtg-forge-node:engine1116-teams` `0966b1c0d6cb`, `mtg-relay:engine1116-teams` `b07cf1600b20`
  (the same relay layers as engine1115-2hg); test image `mtg-harness-test:engine1116-teams` `f92b8299f270`. The running
  stack was not touched.
- **Proof:** `engine/checks/harness-tests.sh` in `mtg-harness-test:engine1116-teams`: 18 of 18 classes, 178 checks (new
  `PlayerRulesTest`, 13). Break-it `node engine/checks/mutate-player-rules.js tmp/wt-teams/tmp/eb1116-teams`: 12 of 12
  mutations (3 Forge, 5 Perks, 4 adapter) caught by name, the tree unchanged by sha256. Headless results: see engine1116-teams2.
- **Deploy (when wanted):** TTS closed, no game running, from main after this branch is merged:
  deploy engine1116-teams2 instead (it has this and the 2HG rules audit).
### 2026-11-15 engine1115-2hgrules: Two-Headed Giant rules audit (built, not deployed)
- **Problem:** the user (2026-11-15): "In 2 headed giant [an] effect that affects you affects your teammates the same;
  the engine should treat two people [on a team] the same." Every 2HG rule of CR 810 (effective 2026-11-06) and 701.34b
  was checked against the engine (`docs/game-modes-spec.md` §5.9.1 has the whole table). Six places treated the partners
  apart where the rules make them one:
  - 810.9h: a partner of a "can't lose life" player (Platinum Emperion) could still pay life, and paid it for nothing
    (`canPayLife` read only the payer, `loseLife` then lost nothing).
  - 810.8a: the partner of a "can't win" player (Abyssal Persecutor) could win (Thassa's Oracle).
  - 810.10c: a partner of a "can't get poison counters" player (Melira, Sylvok Outcast) still got them.
  - 810.10a: the opponents' poison count (Phyrexian Swarmlord, Mycosynth Fiend, Vishgraz) added both opponents' mirrored
    counts, twice the team's.
  - 810.9d / 810.9f: "each player's life total becomes N" set every member in seat order (the first seat always the one
    affected), and a redistribution could take both partners.
  - 701.34b: proliferating both partners gave the team two poison counters, not one.
- **What, Forge (`engine/forge.patch`, all behind `GameRules.sharedTeamLife`; `cantWin` reads only the player outside
  it):** `Player.canPayLife` refuses a payment above 0 when the team can't lose life; `Player.cantWin` reads every partner
  still in the game; `Player.canReceiveCounters` reads the partners for poison; `getOpponentsTotalPoisonCounters` counts
  each opposing team once; `LifeSetEffect.oneMemberOfEachTeam` asks a team's first listed member which partner a
  "becomes N" sets (the Forge AI takes the first) and keeps the first chosen partner of a redistribution;
  `CountersProliferateEffect.poisonedPlayers` asks the proliferating player which chosen partner gets the poison counter.
  Tried and taken back in the same branch: letting a partner's "can't lose" stop an opponent's alternate win. A player who
  wins ends the game at once (CR 104.1), and Forge's own `loseConditionMet` skips can't-lose effects for that reason, so
  the team check keeps skipping it (guard `anOpponentsAlternateWinBeatsAPartnersCantLose`).
- **What, harness (`engine/manabrew.patch`):** tests only, 10 new `TeamGameTest` checks (35 in all). No node, relay or
  protocol change.
- **Source:** tree `tmp/wt-2hgrules/tmp/eb-rules`, a clone of `tmp/eb1115b`: branch `2hg-rules` = `nocomment-1115`
  (`44de312`) + `a19510f`, `56d31e0`, `adcf6fd`, `742377d`, `8b33391` (tests); its `forge/` branch `2hg-rules` = `19931d89` +
  `e71b3451`, `a34d23ca`, `5dd8325a`, `ec4266d5`. Patches regenerated with `ENGINE_WORK_DIR=tmp/wt-2hgrules/tmp/eb-rules
  ENGINE_BUILD_DIR=tmp/wt-2hgrules/tmp/engine-build bash engine/make-patches.sh` (56 and 438 files: `LifeSetEffect` and
  `CountersProliferateEffect` are new to the patch).
- **Build:** 2026-11-15 through `tmp/slot.js`, `ENGINE_BUILD_DIR=tmp/wt-2hgrules/tmp/engine-build bash
  engine/build-images.sh engine1115-2hgrules`: `mtg-forge-node:engine1115-2hgrules` `01be70a2e78f`,
  `mtg-relay:engine1115-2hgrules` `b3d530c62920` (relay source unchanged, the same layers as engine1115-2hg's); test image
  `mtg-harness-test:engine1115-2hgrules` `32ae2b0f77e2` (`--target java-builder`, same tree).
- **Proof:** in `mtg-harness-test:engine1115-2hgrules` on `tmp/wt-2hgrules/tmp/eb-rules/forge-harness`,
  `engine/checks/harness-tests.sh` with no class name: 17 of 17 classes, 175 checks (`TeamGameTest` 35). Break-it
  (`tmp/wt-2hgrules/tmp/mutate-rules.sh`: the changed Forge classes compiled into the harness classpath ahead of the
  engine1115b jar, one mutation at a time, each file restored and checked by sha256), baseline 35 of 35: pay life without
  the team's can't-lose fails `payingLifeUsesTheTeamTotalAndATeammateWhoCantLoseLifeStopsIt`; can't win on the player
  alone fails `aTeammateWhoCantWinStopsTheTeamsWin`; can't get poison on the player alone fails
  `aTeammateWhoCantGetPoisonKeepsItOffTheTeam`; opponents' poison summed over players fails
  `opponentsPoisonIsCountedOnceATeam`; every partner set fails `settingEachPlayersLifeAffectsTheMemberTheTeamChooses` and
  `aRedistributionTouchesOneMemberOfEachTeam`; the first partner set with no choice fails `settingEach...`; proliferate
  poison on every chosen partner fails `proliferatingBothPartnersGivesTheTeamOnePoison`; can't-lose effects (own and
  partner's) let stop an opponent's win fails `anOpponentsAlternateWinBeatsAPartnersCantLose`; a life loss not shared fails
  10 checks, the new guards `settingOnePlayersLifeMovesTheTeamByTheDifference` and
  `eachOpponentLosingLifeCountsEveryPlayerOfTheTeam` among them. Live, `LIVE_STACK=7 LIVE_TIMEOUT=600 sh
  tools/live-check.sh engine1115-2hgrules tests/live_2hg_check.js`: 24 of 24. `tests/test_table_golden.js`: 6 games
  match; `tests/test_bridge_golden.js`: 1064 of 1066, the two that differ list deck files that are not in the repo
  (`decks/ashling_limitless_commander.json` and others, missing on main too; no bridge file changed here).
- **Known limits:** 810.9d when a card sets each player in a `RepeatEach` (Biorhythm: the last seat's number stands);
  "each player loses a third of their life" (Pox, `RepeatEach`) works the second partner's third out from the lowered
  total; the Forge AI picks the first partner in the two new choices. The Level 1 limits of §5.9 stand (own turns, own
  blocks).
- **Deploy (when wanted):** TTS closed, no game running, from main after this branch is merged:
  `node tools/deploy.js --image engine1115-2hgrules`.
- **Rollback:** `node tools/deploy.js --image engine1115b`.

### 2026-11-14 engine1115b: no comments in the Manabrew Java (built, not deployed)
- **Problem:** `engine/manabrew.patch` shipped one Java comment, against the no-comments rule for Manabrew Java
  (`manabrew/AGENTS.md`): `forge-harness/src/main/java/forge/harness/common/ActionSpace.java` line 395 (in
  `getStackTargetCandidates`, the `catch (NullPointerException upstream)` of the Spider-Sense fix), "Forge's
  SpellAbility.isValid reads root.getCardState() unguarded; ...". It was the only `//` or `/*` comment our patch adds to
  Manabrew Java (the two other `//` hits are the card name "Bottomless Pool // Locker Room" in `CardStateFlagsTest`).
  `engine/forge.patch` has comments (the 2HG CR notes, `AssimilateEffect` javadoc); Forge has no such rule, so they stay.
- **What:** the comment line removed; no code changed. `engine/manabrew.patch` differs from engine1115-2hg's by that line
  and the hunk's line counts; `engine/forge.patch` is unchanged.
- **Source:** tree `tmp/eb1115b`, a clone of `tmp/wt-2hg/tmp/eb1115-2hg` (left untouched as the rollback source): branch
  `nocomment-1115` = `2hg-1115` (`f995fab`) + `44de312`; its `forge/` branch `nocomment-1115` = `19931d89`. Patches
  regenerated with `ENGINE_WORK_DIR=tmp/eb1115b ENGINE_BUILD_DIR=tmp/wt-nocomment/tmp/engine-build-nc bash
  engine/make-patches.sh` (56 and 436 files, as before).
- **Build:** through `tmp/slot.js`, `ENGINE_BUILD_DIR=tmp/wt-nocomment/tmp/engine-build-nc bash engine/build-images.sh
  engine1115b`: `mtg-forge-node:engine1115b` `c298b620cfd8`, `mtg-relay:engine1115b` `8f10863542e6`; test image
  `mtg-harness-test:engine1115b` `81c1bd1b6e81` (`--target java-builder`, same tree).
- **Proof:** in `mtg-harness-test:engine1115b` on `tmp/eb1115b/forge-harness`, `engine/checks/harness-tests.sh` with no
  class name: 17 of 17 classes, 165 checks (the same as engine1115-2hg). Live on test stack 5 (port 9449, beside the real
  stack): `LIVE_STACK=5 LIVE_TIMEOUT=600 sh tools/live-check.sh engine1115b tests/live_2hg_check.js` 24 of 24, and
  `LIVE_STACK=5 sh tools/live-check.sh engine1115b tests/live_events_check.js` 51 of 51. `tests/test_table_map.js` with
  `MTG_MANABREW=tmp/eb1115b`: 615 checks pass.
- **Deploy (when wanted):** TTS closed, no game running, from main after this branch is merged:
  `MTG_MANABREW=tmp/eb1115b node tools/deploy.js --image engine1115b` (retags node and relay).
- **Rollback:** `node tools/deploy.js --image engine1115-2hg`.

### 2026-11-14 engine1115-2hg: Two-Headed Giant Level 1 (built, not deployed)
- **Problem:** the user asked for Two-Headed Giant (`docs/game-modes-spec.md` §5, decisions §12): partners share one
  life total (30, 80 in Commander), poison (15) and a commander's damage (42, the house rule), lose together and block for
  each other; Level 1 keeps each player's own turn, the team's two back to back. Forge has team numbers but none of that.
- **What, Forge (`engine/forge.patch`, all behind `GameRules.sharedTeamLife`, off by default):** life and poison
  mirrored to the teammates after each change (`Player.shareLifeWithTeam`, `setCounters` for poison; 810.9, 810.10),
  can't gain / can't lose life for the whole team (810.9g-h), the poison limit from `GameRules.poisonCountersToLose` instead
  of 10, a new `commanderDamageToLose` with one commander's damage summed over the team (`getTeamCommanderDamage`), a
  player's loss (concession too) is the team's (`loseWithTeammate`, 810.8a-b) and a teammate's "can't lose" protects the
  team, an alternate win is the team's, a defender may block a creature attacking a teammate (`CombatUtil.canBeBlocked`,
  805.10d) and is asked to (`PhaseHandler.isTeammateAttacked`), the starting team skips both first draws (103.8b, kept
  across an extra turn), the first-player roll and Power Play start at the team's first seat (`GameAction.teamLead`).
  **New in this build, forge-ai:** `ComputerUtilCombat` reads the shared-life team for the life, poison and commander
  damage an attack costs (`attackersOfTeam`, `combatDamageTo`, `combatPoisonTo`, `getLifeThreateningCommanders`
  against `getCommanderDamageToLose`), and `AiBlockController.sortPotentialAttackers` sorts a teammate's attackers in
  with its own, so a Forge AI blocks for its partner. Outside a shared-life game every one of these reads the player
  alone, as before (the team is just the player, the limit 21).
- **What, harness and node (`engine/manabrew.patch`):** `StartGameRequest` gains `teamRules` (`none`, `teams`,
  `sharedLife`), `poisonToLose`, `commanderDamageToLose` and per player `team`, `startingLife`, `startingHand`;
  `ManaBrewEngineAdapter.configureTeamRules` refuses an unknown rule, a missing or negative team, fewer than two teams,
  uneven `sharedLife` teams, partners apart in seat order, partners at different starting life and limits below 1; the
  2HG defaults by team size (2 heads: 30 life, 80 in Commander, poison 15, commander damage 42). The roll offers only team
  leads. `GameViewDto.teamRules` (rule and limits) when a team has two players; a teammate's hand shown to the viewer in
  a `sharedLife` game (`InteractiveSnapshotExtractor.sharesHandWith`, 810.5). Node: the room controller's `gameConfig`
  roomRelay message is kept (`HostSnapshot.game_config`) and applied to the next game started; the relay passes it
  (allow-list in `manabrew-server/src/connection.rs`); the Rust backend logs a warning and ignores it.
- **Source:** tree `tmp/eb1115-2hg` in the outer worktree `tmp/wt-2hg`, a clone of `eb1114-rejoin`: branch `2hg-1115`
  = `rejoin-1114` (`df0e503`) + `4f4411c` (the harness, protocol, node and relay work of `tmp/mb-2hg` branch
  `2hg-1113`, `fc28388..3badb9c`, applied as one diff with no conflicts) + `f995fab` (new checks). Its `forge/` is a
  clone of `tmp/mb-2hg/forge` (`ef17522a`, `0d5e213f` planechase, `7f3026cb` review fixes) + `19931d89` (the AI).
  `engine/manabrew.patch` is `git diff fd16e2f` of that branch (56 files), `engine/forge.patch` is `git diff e7d2b93`
  of its `forge/` (436 files with the Star Trek import). Main's forge patch plus this work differs from it only in the
  2HG files (checked by applying main's patch to `e7d2b93` and diffing against `7f3026cb`).
- **Build:** 2026-11-14 through `tmp/slot.js`, `ENGINE_BUILD_DIR=tmp/wt-2hg/tmp/engine-build-2hg bash
  engine/build-images.sh engine1115-2hg` (clean tree from the pinned upstream commits + both patches):
  `mtg-forge-node:engine1115-2hg` `fcb808036400`, `mtg-relay:engine1115-2hg` `034587f1f7b1` (relay rebuilt: the
  allow-list changed). Test image `mtg-harness-test:engine1115-2hg` `0097fcf338ed` (`--target java-builder`, same tree).
  Older images `mtg-forge-node:2hg` / `mtg-harness-test:2hg` (2026-11-13, on engine1113, no AI change) are superseded.
- **Proof:** in `mtg-harness-test:engine1115-2hg`, `engine/checks/harness-tests.sh` with no class name: 17 of 17 classes,
  165 checks (`TeamGameTest` 25, `RejoinRewindTest` 6, `PlanechaseTest` with the five planechase-fix checks). New
  `TeamGameTest` checks: `theAiCountsAttacksOnItsPartnerAgainstTheTeam`, `anAiDefenderBlocksForItsPartnerWhenTheTeamWouldLose`,
  `theAiSeesACommanderThreatenTheTeamsTotal`, `aRewindPutsTheTeamsLifeBackOnBothPartners` (rewind x shared life, the
  merge with engine1114-rejoin). Break-it (`tmp/wt-2hg/tmp/mutate-2hg.sh`: the two forge-ai classes compiled into the
  harness classpath ahead of the image's Forge jar, one mutation at a time, each file restored and checked by sha256):
  block sort on own attackers fails `anAiDefenderBlocks...`; remaining life on own attackers fails `theAiCounts...` and
  `anAiDefenderBlocks...`; poison on own attackers, and `attackersOfTeam` on the player alone, each fail
  `theAiCounts...`; the commander threat on own damage at 21, and on the player alone, each fail
  `theAiSeesACommander...`; a restore without the snapshot fails `aRewindPuts...`. Baseline 25 of 25.
  Live, `LIVE_STACK=5 LIVE_TIMEOUT=600 sh tools/live-check.sh engine1115-2hg tests/live_2hg_check.js` (four human seats,
  2HG Commander): 24 of 24 (partners see each other's hands and no one else's, 80 life, poison 15, commander damage 42,
  the team's first seat starts and its turns come back to back, both first draws skipped, shared life and poison, 41 over
  the team stays in, 42 loses both, the other team wins). The check now waits for the dealt hands before looking at them
  (its first run here read a board from before the deal, 0 of 0 cards) and fails if it never did.
- **Known limits:** spec §5.9 (each defender still declares blocks on their own; 810.9d, 810.9f and 701.34b left out;
  poison set in bulk is not mirrored; the Rust backend has no team rules).
- **Deploy (when wanted):** protocol changed, so both images: TTS closed, no game running, from the merged checkout
  `node tools/deploy.js --image engine1115-2hg` (retags node and relay). The bridge and table changes are on branch `2hg`
  and work on the old engine for free-for-all games; a 2HG start on an engine without `gameConfig` would start a plain
  free-for-all, so deploy the engine with the branch.
- **Rollback:** `node tools/deploy.js --image engine1113` (the live one, node `4d0f4dcaa0f7`, relay `d88922ebdd9f`), or
  `engine1114-rejoin` if that went live first.

### 2026-11-14 engine1114-rejoin: a rewind brings back a player who conceded or lost after the point (built, not deployed)
- **Problem:** the user asked that a player who conceded can get back into the game when the table rewinds. A rewind to a
  point from before a concession (or any loss) left that player out: `Game.onPlayerLost` (CR 800.4a) sets the outcome,
  takes the player out of `Game.getPlayers()` into `getLostPlayers()`, and in a game of 3 or more makes every card they own
  cease to exist (zone `None`, in no list) and hands the permanents they controlled back to their owners. `GameSnapshot`
  only walks the players of the live game, so the restore set the others back and left the player out, outcome and all.
- **What (harness only):**
  1. Each restore point (`SavedState`) also keeps the ids of the players still in the game at it (`playersInGame`, a player
     whose outcome is already a loss counts as out) and a `CardPlaces`: every card's zone at the point (stack cards aside)
     and, for a card controlled by someone other than its owner, a copy of `Card.tempControllers` (private, read by
     reflection; listed in `native/extra-config/reflect-config.json` for the native image).
  2. `restoreState` calls `rejoinPlayers` before `GameSnapshot.restoreGameState`. For each registered player the point had
     in the game who is out now: outcome cleared (`getStats().setOutcome(null)`, so `hasLost()` is false and the view's
     `status` is `playing`), `setHasLost(false)` on the view, off `getLostPlayers()`, and `getPlayers()` rebuilt in seat
     order (so `getNextPlayerAfter`, priority and the restore vote see them again). `CardPlaces.putBack` then puts their own
     cards back into the zones the point had them in (the same card objects, with `Zone.add(..., rollback=true)` so no
     zone-change bookkeeping runs), and gives back each permanent they controlled with its original temp-controller
     timestamp, moving it off its owner's battlefield list. The snapshot then sets everything else as it does for any player.
  3. A player already out at the point stays out; a rewind with nobody to bring back does nothing new.
- **Not covered (found on the way, not regressions):** control set by `Card.setController` (an exchange of control) is not
  given back. And for every card, not only a returning player's, **counters added after a point stay after a rewind**:
  `GameSnapshot` builds its copies from the paper card, so they carry no counters, and the restore never sets counters on a
  live card (a probe in `RejoinRewindTest`, 2026-11-14: +1/+1 counters set after the point were still 3 after the rewind,
  same card object). That is a general rewind bug worth its own fix.
- **Bridge:** `checkRestored` says "<names> is/are back in the game." in the chat and the game log for each player the
  rewound board shows playing whom `noteOuts` had seen go out (once; the out record is then forgotten as before). The rest
  of the table already follows the engine's `status`: `isPlaying` (concede, rewind requests, the vote's waiting list, fix
  tools), the life counter relit on a jump (`engine-renderer.lua`, unchanged), and the node's `active_player_usernames`
  (a rejoined seat counts as active again).
- **Files:** harness `ManaBrewInteractiveSession` (`SavedState`, `saveState`, `playersInGame`, `rejoinPlayers`,
  `restoreState`), new `CardPlaces`, `reflect-config.json`, `AGENTS.md` (restore-point paragraph); new test
  `RejoinRewindTest` (6 checks: `aConcededPlayerRejoinsOnARewindToBeforeTheConcession`,
  `aPlayerAtZeroLifeRejoinsOnARewindToBeforeTheLoss`, `aRewindToAfterTheConcessionKeepsThePlayerOut`,
  `aRejoinedPlayerTakesTheirTurnAndVotes`, `aRejoinedCommanderComesBackOnce`,
  `permanentsThatChangedControlComeBackWithTheirController`), added to `engine/checks/harness-tests.sh`. Outer repo:
  `bridge/bridge.js` (`checkRestored`, `onConcede` comment), `tests/test_bridge_claims.js` (+6 "rejoin:" checks), new live check
  `tests/live_rejoin_check.js`. No protocol
  change.
- **Source:** tree `tmp/eb1114-rejoin` in the outer worktree `.claude/worktrees/agent-ac7d563c775ca72fd`, a clone of
  `tmp/eb1113`: branch `rejoin-1114` = `fd16e2f` + `866240c` (the committed `engine/manabrew.patch` of `c1170fe` applied;
  its `git diff fd16e2f` reproduces that patch byte for byte) + `0d6dfa3` (this change). `engine/manabrew.patch` is that
  branch's `git diff fd16e2f` (55 files); `forge.patch` unchanged. So this build **also carries the planechase-fix-1113 source
  (section 2), built for the first time here**. (Branch `rejoin-on-1113`, `1bd7900`, is the same change on `2af9fe9`, where
  it was first written and tested.)
- **Build:** 2026-11-14 through `tmp/slot.js`: `ENGINE_BUILD_DIR=$PWD/tmp/engine-build-rejoin bash engine/build-images.sh
  engine1114-rejoin` (pinned upstream + both patches in a clean LF tree). `mtg-forge-node:engine1114-rejoin` `3e8f2005bda9`
  (03:25 EST); `mtg-relay:engine1114-rejoin` `4e47919e1966` (all layers cached, 2026-11-12 20:07 stamp; relay source
  unchanged). Test image `mtg-harness-test:engine1114-rejoin` (`--target java-builder` from the same tree).
- **Proof:** the built tree in `mtg-harness-test:engine1114-rejoin`: 16 of 16 classes, 140 checks (the five new
  planechase-fix `PlanechaseTest` checks among them, run here for the first time). Live, `tools/live-check.sh
  engine1114-rejoin tests/live_rejoin_check.js` (three human seats, `LIVE_STACK=7`): 9 of 9: a seat concedes on turn 4, its
  permanents leave, it is not awaited in the rewind vote, after the rewind all three seats see it `playing` with the
  point's life and zone counts, it is awaited in the next vote, and it is asked to act on its own next turn. The same
  check on `engine1113` fails 4 of 8 and times out: after the rewind every seat still sees the seat `conceded` (its cards
  back on the board, which the old snapshot already did), and it is not awaited in the next vote. Earlier, on the engine1113 harness in `mtg-harness-test:engine1112`: 16 of 16 classes (135 checks), the new
  class 6 of 6; before the fix 4 of its 5 first checks failed ("Blue has still lost: has conceded", "the turn after White's
  goes to Red"). Break-it, one mutation at a time in the mounted harness, restored by sha256 each time (all restored):
  no `rejoinPlayers` call fails 5 checks (all but the stays-out one); rejoined players appended instead of in seat order
  fails 4 ("players in the game are [White, Red, Blue]", "the turn after White's goes to Red"); no `putBack` fails 4
  ("Blue's state is not the checkpoint's"); lost players counted as in the game at the point fails
  `aRewindToAfterTheConcessionKeepsThePlayerOut`; the outcome left set fails 4 (incl. "White's rewind awaits seats []");
  no temp controllers given back, and no move off the owner's battlefield, each fail
  `permanentsThatChangedControlComeBackWithTheirController`. Bridge: `test_bridge_golden` 1066 of 1066, `test_bridge_claims`
  1451 of 1451, `test_bridge_events` 602 of 602, `test_table_map` 613 of 613 (`MTG_MANABREW=tmp/eb1114-rejoin`); break-it
  without the chat line fails 2 rejoin checks, without the log line 1, naming every playing player 4.
- **Deploy (when wanted):** first the planechase spike on this image (section 2, steps 3 and 4: `LIVE_STACK=1
  LIVE_TIMEOUT=600 bash tools/live-check.sh engine1114-rejoin tests/live_planechase_check.js`, then `LIVE_ARGS=--raw`),
  since the image carries those fixes too. Then, with TTS closed and no game running, from the merged main checkout:
  `node tools/deploy.js --image engine1114-rejoin` (node only, no protocol change; the bridge change is in this commit and
  works on the old engine too, it just never fires there).
- **Rollback:** `node tools/deploy.js --image engine1113` (node `4d0f4dcaa0f7`, relay `d88922ebdd9f`).

### 2026-11-13 engine1113: the engine1112 review follow-ups (deployed 2026-11-13 09:37 UTC)
- **Problem:** the four follow-ups the engine1112 review left (that entry, "Follow-ups, none blocking"): the combat flags cost
  three board-wide static scans per creature on every seat's snapshot; delayed triggers sent `hostCardId`/`cardIds` of hand
  and library cards to every seat; a face-down permanent kept its `unlockedDoors`; a damage entry could say
  `ownerId "player--1"` or name no target.
- **What:**
  1. *Snapshot cost.* `InteractiveSnapshotExtractor.SnapshotRound` caches each controller's `CombatUtil.getAllPossibleDefenders`
     and each creature's `cantBlock`/`cantAttack`/`mustAttack`. The session's `pollAction` opens a round just before it releases
     `gameLock` and drops it when it takes the lock back, so every seat's snapshot while the game waits for one action shares
     it. The game cannot change while it waits (it holds the lock at every other moment), so the output is the same. A
     snapshot outside a wait (tests, the browser bridge, a prompt's `cardDto`) gets a fresh round, which still shares the
     defenders per controller.
  2. *Delayed-trigger ids.* `EffectsView.delayed(game, shown)` takes the viewer's `shownTo`. A host or remembered card the viewer
     may not see is left out of `hostCardId`/`cardIds`, and then `text` is sent empty, because Forge's text names the card. The
     bridge's `delayedOf` now treats an empty text as hidden (fixed words "At end step: a delayed trigger" / "DELAYED TRIGGER"),
     as it already did for a hidden id; without that change it would show "At end step: " (proved below).
  3. `redact()` blanks `unlockedDoors`.
  4. *Damage entries.* `EngineEventLog` drops a damage entry whose source has no owner in the game (or no source), or whose
     player target is unknown, before it takes a `seq`; `view()` leaves out one whose target card has no id in the view (a
     token that died before any snapshot saw it). Those can leave a gap in `seq`; the bridge's gap check reads only the ring's
     first entry, so a gap inside the ring is harmless.
- **Files:** harness `InteractiveSnapshotExtractor`, `ManaBrewInteractiveSession`, `EffectsView`, `EngineEventLog`, `AGENTS.md`
  (lock, delayed, damage and face-down notes); tests `CardStateFlagsTest` (+3: `faceDownRoomHidesItsUnlockedDoors`,
  `seatsWhileTheGameWaitsShareOneRound`, `theNextWaitSeesWhatChanged`), `EffectsViewTest` (+2: `aHostInAHandIsNotNamedToAnotherSeat`,
  `aRememberedCardInAHandIsNotNamedToAnotherSeat`; `pactUpkeepIsOnItsCastersTurn` now reads the caster's view, since its Pact sits
  in a hand), `EngineEventDamageTest` (+2: `damageToACardWithNoIdIsNotSent`, `damageWithNoSourceOwnerIsNotSent`). Outer repo:
  `bridge/bridge.js` (`delayedOf`), `tests/test_bridge_claims.js` (+3 engine1113 checks), `engine/checks/SnapshotTimingCheck.java`
  (new). No protocol change.
- **Build:** the source tree is `tmp/eb1113` inside the outer repo's worktree `.claude/worktrees/agent-adfc665514bd5e1fa`: a clone
  of the clean `tmp/engine-build` (Manabrew `fd16e2f`, Forge `e7d2b93` + `engine/forge.patch`), with engine1112's 53 files copied
  from `tmp/mb-wt-merge` by the make-patches line-ending rule (its diff equalled the committed `manabrew.patch` byte for byte),
  committed there as `engine1112 base`, then these edits. `engine/manabrew.patch` is that tree's `git diff fd16e2f` (53 files, the
  8 touched sections changed); `forge.patch` unchanged. `tmp/mb-wt-merge` itself is untouched (this run could not run git there).
  Two traps on the way: a clone made with Windows' system `autocrlf=true` leaves 2344 Manabrew files CRLF in the working tree
  even after `core.autocrlf false` (every `.sh` too, which breaks the native step), so re-check out with
  `git rm -r --cached . && git reset --hard`; Forge's own `.gitattributes` (`* text=auto`) makes its files CRLF on Windows
  whatever the setting, as in `tmp/engine-build` before. Also, the committed `engine/manabrew.patch` has no CRs (the outer repo's
  `eol=lf`), so it applies only where upstream files are LF (all 53 here are). The node build took about 35 minutes (context
  transfer alone about 6); the relay rebuilt entirely from cache.
- **Timing** (`engine/checks/SnapshotTimingCheck.java` in `mtg-harness-test:engine1112`, HotSpot JVM, 4 players, 120 creatures,
  168 permanents, statics Propaganda, Ghostly Prison, Glorious Anthem, Crusade, Silent Arbiter, Norn's Annex, Pacifism, Lure):
  - A round of 4 seats' snapshots while the game waits for an action: **engine1112 median 98.98 ms (mean 100.28), engine1113
    median 34.06 ms (mean 35.61)**, about 2.9 times faster, 60 rounds each.
  - One snapshot alone (no wait, so no shared round): 100.19 ms vs 95.04 ms per 4 seats; sharing the defenders per controller
    alone saves little.
  - The flag work alone, both ways interleaved in one process: 58.3 vs 12.8 ms (old harness run) and 85.6 vs 16.6 ms (new
    harness run) per 4 seats, so the flags were about 60 to 85 % of a round; the same flags in 60 of 60 rounds.
  - The four snapshots hash the same on both harnesses (`4070d41e8d795c77`), with and without the waiting game thread: the
    output is unchanged.
  - The machine was shared with other agents' runs (a first engine1112 run on a busier machine gave medians of 323 and 136 ms
    for the same code), so take the ratios, not the milliseconds; the native image is slower in absolute terms than HotSpot.
- **Proof:** harness 15 of 15 classes in `mtg-harness-test:engine1112` (CardStateFlagsTest 18, EffectsViewTest 13,
  EngineEventDamageTest 12 checks). Break-it, each fix reverted in a copy of the harness and the touched classes run:
  stale round (never renewed) fails `theNextWaitSeesWhatChanged`; no sharing (a fresh round per snapshot) fails
  `seatsWhileTheGameWaitsShareOneRound` ("computed 0 times"); unfiltered ids fail both EffectsView hidden checks (the other seat
  got `hostCardId` and the Pact's text); `redact` without the line fails `faceDownRoomHidesItsUnlockedDoors`; targetless entries
  fail `damageToACardWithNoIdIsNotSent` (1 event, not 0); the old owner rule fails `damageWithNoSourceOwnerIsNotSent` (2 events,
  not 1). Bridge `delayedOf` without the empty-text rule fails both engine1113 claim checks ("At end step:", "NEXT UPKEEP:").
  Bridge gates with `MTG_MANABREW=tmp/eb1113`: `test_bridge_golden` 1066 of 1066, `test_bridge_claims` 1395 of 1395,
  `test_bridge_events` 597 of 597, `test_table_map` 610 of 610. Live checks against `engine1113` (test stack, port 9444,
  `mtg-relay:engine1113`): `live-check.sh engine1113 tests/live_phasing_check.js` 29 of 29, `live_events_check` 51 of 51 (the same
  counts as engine1112). Run through `bash`: `sh tools/live-check.sh` launched from PowerShell exited 1 with no output here.
- **Deploy (when wanted):** `node tools/deploy.js --image engine1113` (TTS closed, no game), with `MTG_MANABREW` pointing at a tree
  that has the engine1112 protocol (`tmp/eb1113` in that worktree, or `tmp/mb-wt-merge`; the protocol is the same) and the bridge
  change from this commit, which an older bridge lacks (an older bridge would show "At end step: " for a hidden delayed trigger).
- **Rollback:** `node tools/deploy.js --image engine1112` (node `0306d683de26`, relay `58cf2e3da251`).

### 2026-11-12 engine1112: card flags, effects, delayed triggers, damage events (deployed)
- **Problem:** the table guessed several per-permanent states (monstrous, saddled, paired, "can't attack/block") from
  text or counters. It could not show continuous effects (Fog, Teferi's Protection) or delayed triggers (unearth's exile,
  Sneak Attack's sacrifice), had no storm count, and the feed reported no damage.
- **What (`86b9279`, card flags):** `CardDto` gains `skipsNextUntap`, `monstrous`, `saddled`, `saddledBy[]`, `harnessed`,
  `solved`, `unlockedDoors[]`, `pairedWith`, `attachedToPlayer`, `protectorId`, `cantAttack`, `cantBlock`, `mustAttack`
  (booleans and lists left out when false or empty). `exerted` now holds until its controller's next untap step, not
  only the turn it was exerted. The defaults in `src/lib/gameCard.ts` are filled in.
- **What (`6b6d362`, game state):** a new `EffectsView` adds four kinds of field. Each player gets `effects[]` (`EffectDto {id, name, text,
  sourceCardId?, emblem, untilEndOfTurn, duration?}`, from the command-zone effect cards). The game gets `delayed[]` (`DelayedTriggerDto
  {id, text, controllerId, hostCardId?, cardIds[], when?, turnOf?}`, read from `TriggerHandler.delayedTriggers` and
  `playerDefinedDelayedTriggers`, both added to `reflect-config.json`) and `stormCount`. Each player also gets `spellsCastThisTurn`,
  `lifeGainedThisTurn` and `lifeLostThisTurn`. All are left out when empty or 0.
- **What (`8fac2bb`, damage events):** `EngineEventLog` adds one feed entry per damage dealt: `kind: "damage"`, `to: "Damage"`,
  `ownerId` (the source's owner), `sourceCardId`, `targetCardId` or `targetPlayerId`, `amount`, `combat`. Damage to a planeswalker or
  battle is read from its counter drop. Ring capacity 256 -> 512.
- **Files:** harness `InteractiveSnapshotExtractor`, `EffectsView` (new), `EngineEventLog`, `native/extra-config/reflect-config.json`,
  `AGENTS.md`; protocol `manabrew-protocol/src/game/mod.rs`, `manabrew-agent-interface/src/game_view_dto.rs`; tests
  `CardStateFlagsTest` (15), `EffectsViewTest` (11), `EngineEventDamageTest` (10).
- **Build:** this was the first compile of these edits. It compiled on the first try, with **no compile-fix commit**. It took the same route as batch2-1112:
  1. A manabrew patch made from `tmp/mb-wt-merge` against the clean `tmp/engine-build` tree (the manabrew half of make-patches,
     53 files, kept as `tmp/manabrew-engine1112.patch`, sha1 `653b09f9762a`).
  2. That patch applied in `tmp/engine-build` with `engine/forge.patch` (unchanged).
  3. A `docker build` from that tree of the node, the relay and `--target java-builder` (harness-test).

  `engine/manabrew.patch` is **not** regenerated yet. Regenerate it before the deploy commit. The build generates the Java
  protocol classes from the Rust types: the image's generated `CardDto.java` carries the new fields, and the harness tests
  compile against it.
- **Proof:** harness 15 of 15 classes in `mtg-harness-test:engine1112` (the three new ones pass 15, 11 and 10 checks). On a
  test stack (port 9444) the live checks match batch2-1112: `live-check.sh engine1112` (phasing/rewind) 29 of 29, `live_events_check`
  51 of 51, and the draw/mill check 20 of 20. A new wire check, `live_engine1112_check.js` (session scratchpad), passed 22 of 22 twice with
  `mtg-relay:engine1112` and 22 of 22 with `LIVE_RELAY=batch2-1112`. It shows these on the wire, through the real relay:
  - Shock on a Grizzly Bears: a damage event `{kind:"damage", sourceCardId: Shock, targetCardId: bear, amount: 2, combat: false, ownerId, to:"Damage"}`.
  - Moment's Peace: the caster's `effects` gains `{name:"Moment's Peace's Effect", text:"Prevent all combat damage this turn.",
    untilEndOfTurn: true, emblem: false, sourceCardId}`.
  - `stormCount` 2 and `spellsCastThisTurn` 2 after two spells (both absent before).
  - Dregscape Zombie's unearth: `delayed` gains `{text:"Exile Dregscape Zombie at the beginning of the next end step.",
    when:"end step", hostCardId/cardIds: the zombie, controllerId}`.
  - Fleecemane Lion's monstrosity: `monstrous: true`.
  - The other seat sees all of them.
- **Deployed 2026-11-12 ~22:25** with main `f66ba5e` (the four readability merges, the table-side display of these fields, and the
  particle-effects wiring): engine node `0306d683de26`, relay `58cf2e3da251`, table `01875e13`, save `30d57321` (old save backed up as
  `tmp/backup/TS_Save_1.f0c9f91e.json`). Two deploy gates needed fixes first: `test_table_map` (the new fields mapped, `15e15ec`) and
  `live_events_check` (a destroyed token now reads "is destroyed by Doom Blade", `f66ba5e`). Not yet seen in real TTS.
- **Deploy (as planned):** `node tools/deploy.js --image engine1112` (TTS closed, no game) retags both images. The
  relay swap is optional, because the old relay carries every new field. The deploy gate `tests/test_table_map.js` reads the protocol's `game/mod.rs`, so
  the deploy needs `MTG_MANABREW=tmp/mb-wt-merge` (batch 2 used `tmp/mb-pc`). That tree has the new fields; `mb-pc` and the
  shared `manabrew` checkout don't. The bridge does not read the new fields yet.
- **Rollback:** `node tools/deploy.js --image batch2-1112` (node `975d62f6279e`, relay `57aa07a9b314`).
- **Review (Opus, read-only, verdict deploy):** no hidden-info leak, thread-safety or snapshot-crash problem found. Follow-ups, none blocking:
  1. Snapshot cost: `InteractiveSnapshotExtractor.java` ~956-969 calls `canBlock`, `canAttackNextTurn` per defender and
     `entitiesMustAttack` for every creature on every viewer's snapshot; each scans the board's static abilities. Time it on a big
     4-player board live; if it shows, compute defenders once per controller and the flags once per snapshot round.
  2. `EffectsView.java` ~90/95 sends delayed-trigger `hostCardId`/`cardIds` to every seat unchecked, so a hand or library card's id
     can be followed by a raw-protocol client. The table never forwards these ids, and the bridge drops the text for hidden cards.
     Fix in a later image: drop ids `shownTo(card, null)` rejects.
  3. `redact()` (~555) doesn't blank `unlockedDoors` on a face-down permanent (Ixidron on an unlocked Room creature; already public).
  4. A damage entry can carry `ownerId "player--1"` or no target (a token that died before getting an id); the bridge tolerates both.
  Also: delayed entries can have empty `text`; `untilEndOfTurn` is set only for Effect and Fog sources.
  All four are done in `engine1113` (2026-11-13, above).

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
- **Update 2026-11-13 (branch `planechase-1113`, bridge only, no engine change, no image build):** the deployed
  `engine1113` (`4d0f4dcaa0f7`) already holds every planechase-1111 harness change. Its source `tmp/eb1113` has the same
  `Planechase.java`, planar block and `Planeswalk`/`Chaos` ops, and the image's `libforgeharness.so` has their strings.
  The bridge items are done: the chaos trigger is said as chaos on the stack, in the log and in its target question.
  The 901.10 line "<plane> leaves the game with <player>" is in; the bridge tracks each plane's owner (who planeswalked
  to it, overridden by a trigger's `ownerId` on the stack, kept in the resume file). Forge's "Would you like to
  planeswalk?" and Interplanar Tunnel's "Select a card from your planar deck" are reworded. A debug scenario has a
  `"planechase"` field (`{ "planes": [...], "current": name }`, before a game only), and plane pictures are fetched when
  the pool is set. The live spike is `tests/live_planechase_check.js`:
  `LIVE_STACK=1 LIVE_TIMEOUT=600 bash tools/live-check.sh exile tests/live_planechase_check.js` (`exile` is the
  deployed engine1113 node and its relay; a test stack only; not yet run). Optional engine follow-up: a `planar.ownerIds` map (`Planechase.planarState` plus a field in the
  Rust `PlanarStateDto`, which needs a node rebuild) would replace the bridge's owner tracking.
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
