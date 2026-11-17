# Report: snapshot speed, combat flags from one static scan

Cloud session, 2026-11-17, branch `cloud/snapshot-speed` from `origin/cloud/three-headed-giant` b9d3c34. Only
`engine/manabrew.patch` changed; `forge.patch` is unchanged. Not tried against a live engine. No permission prompt is
pending.

## The problem

- `InteractiveSnapshotExtractor.combatFlags` sets each creature's `cantBlock`, `cantAttack` and `mustAttack`.
- It called three Forge functions:
  - `CombatUtil.canBlock(card, true)`;
  - `CombatUtil.canAttackNextTurn(card, defender)`, for each possible defender;
  - `StaticAbilityMustAttack.entitiesMustAttack(card)`.
- Each of those walks every static ability of every card in the static zones, for every creature. With N creatures and
  D defenders, that is about (2 + D) x N x N static checks per snapshot.
- The flags were already cached per card within a snapshot round, and a round is shared by the viewers of one wait. So
  the cost was the quadratic scan, not repeats across viewers.

## The change (no comments in the Java)

- **`forge-harness/.../host/CombatStatics.java` (new).** One walk of `game.getCardsIn(STATIC_ABILITIES_SOURCE_ZONES)`.
  - It keeps the statics whose `checkMode` is one of `CantAttack`, `CanAttackDefender`, `CantBlock` or `MustAttack` and
    whose `checkConditions()` holds. That is Forge's `checkConditions(mode)`, split.
  - It then answers each creature with Forge's own per-ability checks, in Forge's order:
    - **Block:** the creature or battle check; the "can't block" keywords; detained; `applyCantBlockAbility`.
    - **Attack:** battle; the "can't attack" keywords; detained; `applyCantAttackAbility`.
    - **Must attack:** the `ValidCreature` check and `MustAttack$`, with the CR 506.2 rule that skips a player whose turn
      it is.
  - A `CantAttack` static from the Defender keyword is answered with the cached `CanAttackDefender` list (Rolling
    Stones), because Forge's `applyCantAttackAbility` would rescan for it. The two optional parameters it checks don't
    occur on a keyword static; any static that has them still goes to Forge's function.
  - Two rare cases fall back to Forge's `CombatUtil`:
    - a goaded attacker;
    - a "can't block alone" blocker. Both need the board's other creatures.
- **`InteractiveSnapshotExtractor`.** `SnapshotRound` builds one `CombatStatics` on first use, rebuilt if the game
  differs. `staticScans()` counts the builds, for the test. `combatFlags` uses the cache.

## Results

- **The output is identical.** I compared the whole snapshot JSON (hash and length) for one viewer between the old
  extractor and the new one at 1,000, 3,000 and 10,000 tokens, with Moat, Ensnaring Bridge and a Wall on the board.
- **One viewer's snapshot, best of 3** (one run at 10,000), this cloud machine:

| Tokens | Before | After |
|---|---|---|
| 1,000 | 102 ms | 42 ms |
| 3,000 | 987 ms | 114 ms |
| 10,000 | 13.4 s | 0.30 s |

- **The flags alone at 1,000 tokens:** Forge's per-creature scans take about 105 ms; the cache takes about 5 ms.
- **The bench:** a throwaway `SnapshotBench` class, not committed. It compiles the old extractor from the tree's
  `patched` commit over the jar.

## Tests

- **New `SnapshotSpeedTest`: 9 of 9** (`engine/test-harness-local.sh SnapshotSpeedTest`; three back-to-back runs
  passed).
  - Six "same flags" checks. Each compares every creature's three flags in the snapshot with Forge's own functions, for
    each of 3 viewers and on each of the 3 players' turns:
    - **a mixed board:**
      - two Walls of Wood with Rolling Stones;
      - Blazing Archon;
      - Moat with Serra Angel;
      - Ensnaring Bridge with Craw Wurm, Grizzly Bears and Ornithopter, and a 2-card hand;
      - Pacifism on a Hill Giant;
      - Hulking Goblin;
      - Bloodrock Cyclops;
      - Goblin Rabblemaster and Raging Goblin;
      - Public Enemy;
      - Propaganda;
      - a Peacekeeper in a graveyard, whose conditions fail.
    - The mixed board also checks that every flag is seen both ways.
    - **Peacekeeper:** nobody can attack.
    - **Defenders:** a Wall without Rolling Stones (can't attack), then with it (can).
    - **Ensnaring Bridge** as the hand goes from 0 to 7 cards.
    - **A goaded creature.**
    - **Can't block alone:** Jackal Familiar alone, then with a partner.
  - **The scan:** one static scan for a round of 1,000 creatures.
  - **Timing, 1,000 tokens:** the cached flags at least 3x faster than Forge's per-creature scans (about 20x here).
  - **Timing, linear:** 3,000 creatures' flags under 7x the time of 1,000 (about 3x here; quadratic would be about 9x).
- **Regression:** `CardStateFlagsTest` 18 of 18. The whole harness suite (`--all`, 29 classes) passes.
- **Break-it: `node tools/mutate-snapshot-speed.js <engine tree>`: 12 of 12 caught by name**, files restored by sha256.
  - Can't-block statics.
  - Can't block alone.
  - Can't-attack statics.
  - The Defender keyword.
  - Rolling Stones.
  - Peacekeeper.
  - Must attack's turn rule.
  - Must attack's `ValidCreature`.
  - The statics' conditions.
  - The scan kept across rounds.
  - The scan made per creature.
  - Forge's per-creature attack scan put back.
  - On the first run three survived. The mixed board's Moat hid both defender mutations, and putting Forge's block scan
    back wasn't slow enough to trip the 3x timing check. I added the defender board, swapped that mutation for the attack
    scan, and added the linear check.

## Patch

- Regenerated with `engine/make-patches.sh` against the clean `fd16e2f` / `e7d2b93b` tree (`core.autocrlf=false`).
- `git apply --check` is clean for both patches.
- Applied to fresh worktrees of the pinned commits, the patch gives the same three files as the working tree.
- In the patch diff, the only removed lines are the six lines of the old `combatFlags` code.
- `docs/engine-changes.md` has a new row and section, "engine1117-snapspeed".
- `engine/checks/harness-tests.sh`'s default list now includes `ThreeHeadedGiantTest` and `SnapshotSpeedTest`.

## Not done / notes

- No image and no live game.
- The rest of the snapshot is still linear work per viewer: about 300 ms at 10,000 tokens, mostly building the JSON.
- `cloud/tie-offer` also changes `InteractiveSnapshotExtractor` (a `tieOffer` line beside `stateFix`) and the harness test
  list. Expect a small merge in both files' patches when they come together.
