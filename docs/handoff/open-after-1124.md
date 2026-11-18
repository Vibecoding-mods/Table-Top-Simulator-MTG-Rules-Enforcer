# What is still open after engine1124

Written 2026-11-18. It replaces `open-after-1121.md`. Read-only: nothing was changed or re-run for it.
- **Sources:** the branches on `origin`, read with git, and PLAN.md's status of 2026-11-17.
- **engine1124** is the merge `32d90da` (dependency-scans, cheap-assault with 4 review fixes, static-pass,
  token-quadratic, prompt-shapes, archenemy-audit). It isn't on `origin` yet, so where this list says "in engine1124",
  that is read from those branches, not from the merge itself.
- **"main"** below is `origin/main` (`f4f614d`).

## (a) The 1121 list, item by item

Done items are struck through, with the branch that did them.

### Needs the real table

All of these are still open: nothing was seen in TTS. See (d), which adds the newer ones.

- ~~Six-seat table golden: record `tests/golden/table_golden_6p.json`, add `test_table_golden_six` to GATES~~ (recorded
  and in GATES, `cloud/m6-headless`, d9777e4). It still needs the Workshop saves to run, so it SKIPs in the cloud.
- **Still open:**
  - token entries on the table;
  - the 3HG table;
  - the Archenemy view;
  - cost badges phase 2;
  - custom art 2;
  - Treachery and best of three on the table;
  - 2HG Level 2 looks;
  - the Planechase / Archenemy follow-ups;
  - M6 real games.

### Needs an engine image

- ~~engine1117 (2HG Level 2, the life house rule), team blocks, Three-Headed Giant checks, tie offer, snapshot speed~~:
  deployed with engine1120 or going out with engine1121 (PLAN.md, 2026-11-17).
- ~~Cost badge phase 2 and follow-ups, planar owners, big-board fixes~~: going out with engine1121.
- **Still open:**
  - `bridge/engine-test.js --seats 6 --turns 12` twice on the rebuilt relay;
  - the companion's own-server mode against a real relay over the internet, with TLS and with Tailscale.

### Code not built (the 1121 follow-ups)

**Cost badge:**
- ~~"Cheapest" by mana value only~~ (`cloud/cost-badge-4`, in engine1124). It is still mana value first, then the fewer
  non-mana parts, then less life.
- ~~Non-mana parts of a cost not shown~~ (`cloud/cost-badge-4`, in engine1124: "Escape also costs: ...").

**Big boards:**
- **`MagicStack.add`'s static pass per mana ability:** partly done. `cloud/dependency-scans` (in engine1124) takes a 6 ×
  120 pass from 4.7 s to 1.4 s. The pass itself still runs once per tap.
  - **Next step:** narrow the rescan in dependency detection to the other static's own cards for filters that read only
    the card itself (`dependency-scans-report.md`).
- ~~AI payment past its budget, 7.5 s at 6 × 90~~ (the payment-only 2 s budget: `cloud/ai-budgets`, in engine1124; on
  main as `cloud/ai-attack-budget`).
- ~~The AI attack past its 5 s budget at 6 × 120~~ (`cloud/ai-budgets` and `cloud/cheap-assault`, in engine1124).
- **The checkpoint budget is from JVM numbers:** still open. Measure the native image before settling it.
- ~~The human's auto-pay not timed on big boards~~ (`cloud/autopay-big-boards`, queued). 21.3 → 5.0 s for {8} at 6 ×
  120. Two static passes are the floor without dependency-scans.
- **No full game played at these sizes:** still open.
- **The AI block declaration (new):** 7.05 → 5.41 s at 6 × 120 (`cloud/ai-block-budget`, queued). It still uses the
  whole 5 s budget at every size; a smaller budget is the owner's choice.

**Snapshot speed:**
- ~~The rest of the snapshot linear per viewer~~ (`cloud/snapshot-viewers`, queued). The viewers after the first: 268 →
  49 ms at 10,000 tokens. The first viewer is unchanged.

**Two-Headed Giant:**
- ~~Team blocks: the notices should print, not wait for a click~~: already so on main since 5ed5043 (found by
  `cloud/team-block-2`).
- ~~Team blocks: teams of three not tested for the re-ask order~~ (`cloud/team-block-2`, queued).
- **Level 2 tests, still open:**
  - ~~805.9's "the active player" and 805.10e's "defending player" with no attacker named have no choice in Forge~~
    (`cloud/l2-team-choices`, engine1126): the controller of the spell or ability chooses, as the rules
    say (not the whole team); with no controller in the game, the active team's leader;
  - ~~805.10c's "attacking player" with no creature named goes to the active team's first seat~~ (same branch): the
    controller chooses there too. `TeamChoiceTest`, 31 checks with the review fixes (`cloud/l2-team-choices-fixes`);
  - 805.3a's simultaneous mulligans are checked only for order.

**Best of three:**
- ~~Sideboarding between games, "Concede match", game 1's random pick, "Game 2 of 3"~~ (`cloud/bo3-extras`, on main).
- ~~The roll winner chooses play or draw~~ (`cloud/bo3-roll-choice`, in engine1124).
- **Still open:**
  - a deck imported on the table has no sideboard, so in a real game nobody is asked to sideboard;
  - no turn-timer clock for sideboarding;
  - no laid-out swap.

**Custom art:**
- **The Card Importer's own checks:** still open. That is its second `#link`, and its DFC state kept with a link. It
  needs the Workshop save.

**Tie offer:**
- ~~No golden scenario~~ (`cloud/tie-golden`: five scenarios; to merge after the engine1124 deploy).

**Opening hand:**
- ~~The real opening hand at the mulligan, not at the first priority~~ (`cloud/opening-hand`, in engine1124).

### Decisions for the owner

- ~~805.2's primary player~~, ~~the team-block notice wording~~, ~~checkpoint thinning~~ and ~~the companion's six
  own-server questions~~ were all decided on 2026-11-17 (`cloud/owner-decisions-1117` and `-fixes`, in engine1124):
  - the primary player is the team's first seat in turn order;
  - the notice is "<X> decides (team leader)";
  - thinning keeps each turn's first point;
  - Windows keeps own-server mode, the key is encrypted at rest, and there is no status-page box;
  - Tailscale only.
- **Still open:**
  - the 5 s AI block budget (left as it is for now);
  - holding the human's and the AI's payment from the first tap when a pass is known to be slow (left as it is for
    now).

## (b) The queue for engine1125

Checked against `origin` on 2026-11-18:

| Branch | Tip | On main? | In engine1124? | What it is |
|---|---|---|---|---|
| `cloud/archenemy-six` | 792d6f2 | no | no (its base, archenemy-audit, is) | Archenemy on the six-seat table |
| `cloud/archenemy-team-turns` | 5a65cf4 | no | no | the opponents take one turn together |
| `cloud/ai-attack-budget` | 3a16573 | no | **its engine change is**: it is a cherry-pick (22c8db5) of ai-budgets' 0bb4d3d, which is in engine1124's chain; only its report commit (3a16573) is new | the attack budget and payment budget on main |
| `cloud/ai-block-budget` | f1bab8f | no | no | the block declaration's pump-cost memo and the chump pass |
| `cloud/autopay-big-boards` | db2dcf8 | no | no | the human's Auto payment budget |
| `cloud/snapshot-viewers` | e12a4f3 | no | no | the battlefield built once per snapshot round |
| `cloud/team-block-2` | fc4436e | no | no | teams of three's re-ask order (a test), the notices finding |
| `cloud/stress-extra-turns` | f0d9ac2 | no | no (its base, static-pass, is) | "EXTRA TURNS 99+" |
| `cloud/opening-hand` | ad44b80 | **no** | **yes**: an ancestor of static-pass and dependency-scans | the picked hand dealt as the opening hand |
| `cloud/bo3-roll-choice` | fec39d6 | **no** | **yes**: an ancestor of static-pass and dependency-scans | the roll winner chooses play or draw |

**opening-hand and bo3-roll-choice are not on main, but they come with engine1124.** The static-pass chain is
bo3-roll-choice → followups-3 → ai-budgets → opening-hand → token-quadratic → prompt-shapes → static-pass →
dependency-scans. So they need no place in engine1125's queue.

## (c) Each queued branch's base, and the patch files it touches

What changed between each branch and its base. In the patch columns, "-" is unchanged and the names are the patched
source files whose hunks change.

| Branch | Base | `forge.patch` | `manabrew.patch` | Other shared files |
|---|---|---|---|---|
| archenemy-six | `cloud/archenemy-audit` (b03e30f, in engine1124) | - | ArchenemyTest | bridge.js, teams.js, engine-renderer.lua, headless-six.js, m6-stream.js, golden fixtures (six-seat Archenemy), test_bridge_archenemy.js, test_bridge_six_golden.js, test_table_archenemy_view.js |
| archenemy-team-turns | `cloud/archenemy-six` | AiAttackController, AiBlockController, ComputerUtilCombat, GameRules, CombatUtil | Archenemy, InteractiveSnapshotExtractor, ManaBrewEngineAdapter, ArchenemyTest | bridge.js, teams.js, bridge_golden.json, golden fixtures (4p and 6p Archenemy), engine-changes.md, deploy.js (GATES) |
| ai-attack-budget | `origin/main` | AiAttackController, AiBlockController, AiController, ComputerUtil, ComputerUtilMana, GameCopier, Game (= ai-budgets, already in engine1124) | BigBoardFixesTest, ManaSourcesTest, SharedTurnsPlayTest (the same) | BigBoardCheck.java, engine-changes.md |
| ai-block-budget | `cloud/ai-attack-budget` | AiBlockController, ComputerUtilCombat | BlockBudgetTest | BigBoardCheck.java, engine-changes.md |
| autopay-big-boards | `cloud/ai-block-budget` | - | AutoPay, AutoPayBudgetTest | BigBoardCheck.java, engine-changes.md |
| snapshot-viewers | `origin/main` | - | InteractiveSnapshotExtractor, ManaBrewInteractiveSession, SnapshotViewersTest | engine-changes.md |
| team-block-2 | `origin/main` | - | ThreeHeadedGiantTest | open-after-1121.md, deploy.js (GATES) |
| stress-extra-turns | `cloud/static-pass` (in engine1124) | - | - | bridge.js (a comment), engine-renderer.lua, test_table_claims.js, deploy.js (GATES) |

**Where the same source file changes in two places:**
- **AiBlockController and ComputerUtilCombat:** ai-block-budget and archenemy-team-turns.
- **AiAttackController and AiBlockController:** archenemy-team-turns and cheap-assault (in engine1124).
- **InteractiveSnapshotExtractor:** snapshot-viewers and archenemy-team-turns.
- **ArchenemyTest:** archenemy-six and archenemy-team-turns, one after the other on one line.

**The patch files are generated diffs, so git can't merge them line by line.** Two branches that regenerated
`forge.patch` or `manabrew.patch` from different bases conflict as text, even when their source changes don't
overlap. Combine them as the earlier batches were:
1. Apply engine1124's patches to fresh pins (`fd16e2f` / `e7d2b93b`).
2. Take each queued branch's own source delta: the difference between its patch and its base's patch, as in the table
   above.
3. Apply those deltas in this order:
   1. `archenemy-six`, then `archenemy-team-turns`. Both are on archenemy-audit, which is in engine1124.
   2. `stress-extra-turns`: no patch change. A plain git merge onto engine1124.
   3. `snapshot-viewers`. Then check `InteractiveSnapshotExtractor` against archenemy-team-turns' change.
   4. `team-block-2`: a test only.
   5. `ai-block-budget`'s delta over `ai-attack-budget`. Check `AiBlockController` and `ComputerUtilCombat` against
      archenemy-team-turns.
   6. `autopay-big-boards`' delta over `ai-block-budget`.
   7. `ai-attack-budget`: its engine change is already in engine1124. Take only its report and its BigBoardCheck
      change. The latter is in ai-block-budget and autopay's BigBoardCheck too, which build on it.
4. Regenerate both patches from the tree, and include the untracked new files: `git add -N` before `git diff`. A
   regeneration without it drops the patch's new files.
5. Check the regenerated patches' file lists against the base's, then run `git apply --check` on fresh pins.
6. Run `engine/test-harness-local.sh --all`.

**`docs/engine-changes.md`:** each engine branch adds a row at the top of the table. They conflict only by
position; keep them all.

**`tools/deploy.js` (GATES):** stress-extra-turns, team-block-2 and archenemy-team-turns each add a test; keep them
all.

## (d) Still needs the real table

**The six-player save:** it isn't made yet, and needs the owner's OK. Until then:
- Three-Headed Giant can't start;
- Archenemy on six seats (`archenemy-six`) can't be seen;
- the six-seat golden SKIPs.

**A look on the real table** (from PLAN.md and the reports since):
- the ∞ badge;
- the attack lines;
- the Archenemy view: the schemes' spots, the oversized scheme shape from table-polish, and the setup button's place;
- cost badges and their hover text, including the "also costs" lines;
- custom art for backs and tokens;
- Play / Draw and the best-of-three marks;
- 3HG;
- token runs;
- the floating mana chips;
- the tie pop-up;
- the extra-turn badge at "EXTRA TURNS 99+";
- the team block panel's height with three or more attackers, and its colours.

**Multi-human tests:**
- 4 humans;
- the rewind and manual-fix votes;
- 2HG shared turns;
- Treachery with 4 people;
- a second GIF client;
- Archenemy's opponents' shared turn (archenemy-team-turns).

**Elsewhere:**
- a Steam Deck test of the Linux/Mac companion;
- the uploads (particle bundles, sound bundle), telling the table's author, and the sound licences.

**Docs to correct once engine1124 is out:**
- HOW-TO-PLAY's Windows "Own server" box. It describes main's companion; owner-decisions-1117 removed the box (a friend
  writes `server.json`).
- The rewind "Undo limits" line, once rewind-card-state ships.
