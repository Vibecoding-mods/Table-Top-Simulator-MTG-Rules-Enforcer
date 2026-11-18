# Report: engine1125, the combine

Cloud session, 2026-11-18, branch `cloud/merge-engine-1125` from `origin/main` (`e814bab`, engine1124). The engine
change is `engine1125` in `docs/engine-changes.md`. No image built.

## What went in, in `open-after-1124.md`'s order

1. **`archenemy-six`, then `archenemy-team-turns`.**
2. **`stress-extra-turns`:** no patch change. Its patched state is the same tree as `static-pass`'s, in both repos.
3. **`snapshot-viewers`.**
4. **`team-block-2`.**
5. **`ai-block-budget`'s delta** over `ai-attack-budget`.
6. **`autopay-big-boards`' delta** over `ai-block-budget`.
7. **`ai-attack-budget`'s report.** Its BigBoardCheck changes were already on main. Its engine delta was checked to be
   ai-budgets' (followups-3 → ai-budgets) line for line, ignoring line numbers, and ai-budgets is an ancestor of main.
   So that delta was skipped.

## How the engine patches were combined

**At source level, in `~/engineAB`.** These are `git worktree`s of the pins, with commits on detached HEADs; nothing
was reset or deleted.

1. **For each branch and each base:**
   - its two patches were applied on fresh pins (`fd16e2f` / `e7d2b93b`) and committed;
   - then both patches were regenerated from that commit and compared with the branch's own.
   - **All 14 states reproduced byte for byte** (main, archenemy-audit, archenemy-six, archenemy-team-turns,
     snapshot-viewers, team-block-2, main@f4f614d, ai-attack-budget, ai-block-budget, autopay, stress-extra-turns,
     static-pass, followups-3, ai-budgets). So the regeneration step is trusted.
2. **Onto main's state,** each branch's delta over its own base was applied in order, three-way, one commit each.
3. **Both patches were regenerated** from the result, with the new files included.
   - Their file lists are exactly the union of main's and the branches' (forge 490, manabrew 104), nothing missing or
     extra.
   - `git apply --check` is clean on fresh pins.

**Engine conflicts: none.** Three pairs of branches touch the same source files; I read the hunks, and each pair
changes different regions:

| File | Branches | What each changes |
|---|---|---|
| `AiBlockController`, `ComputerUtilCombat` | archenemy-team-turns, ai-block-budget | team-turns: who counts as the blocking team. Block-budget: the pump-cost memo at the pump sites, `declareBlockers` and the chump pass |
| `InteractiveSnapshotExtractor` | archenemy-team-turns, snapshot-viewers | team-turns: the team rule's `teamTurns` value. Snapshot-viewers: the battlefield loop and the round's card cache |
| `ArchenemyTest` | archenemy-six, then archenemy-team-turns | one after the other |

## Conflicts in the repo, and how they were resolved

The branches were git-merged one by one.

| Merge | Conflicted | Resolution |
|---|---|---|
| archenemy-six | none | |
| archenemy-team-turns | `engine/forge.patch`, `engine/manabrew.patch`, `docs/engine-changes.md`, `tools/deploy.js` | Patches: a placeholder, then replaced by the regenerated ones. engine-changes: both rows kept. GATES: the union, main's order with the branch's new tests appended |
| stress-extra-turns | `tools/deploy.js` | GATES union |
| snapshot-viewers | `docs/engine-changes.md`, `engine/manabrew.patch` | both rows; patch regenerated |
| team-block-2 | `docs/handoff/open-after-1121.md`, `tools/deploy.js` | Main had removed the Team draws entries; team-block-2 rewrote the Team blocks item as done. Kept the removal and team-block-2's "done" text. GATES union |
| ai-attack-budget | `docs/engine-changes.md`, `docs/handoff/ai-budgets-report.md`, `engine/checks/BigBoardCheck.java`, `engine/forge.patch`, `tools/mutate-ai-budgets.js` | All main's side: these came with ai-budgets, already on main and changed since. Its aibudgets row is on main already, so not duplicated. Only its new report, `ai-attack-budget-report.md`, is added |
| ai-block-budget | `docs/engine-changes.md`, `engine/checks/BigBoardCheck.java`, `engine/forge.patch` | both rows; patch regenerated. BigBoardCheck: main's `pass` mode kept, and `combat` no longer `final`, because the new `block` mode replaces it |
| autopay-big-boards | `engine/checks/BigBoardCheck.java` | all three switches kept: `bb.perRun`, `bb.depScans`, `bb.autopayBudget` |

**`engine/manabrew.patch`** text-merged without a conflict in the last merge. It was replaced by the regenerated one
anyway, like every patch here.

## Gates

- **Harness:** `engine/test-harness-local.sh --all` on the combined engine: **53 of 53 classes pass**.
- **Break-its, every merged branch's, each caught by name:**

| Tool | Caught |
|---|---|
| `mutate-archenemy-team-turns` | 11 of 11 |
| `mutate-snapshot-viewers` | 6 of 6 |
| `mutate-team-block-2-engine` | 7 of 7 |
| `mutate-ai-block-budget` | 8 of 8 |
| `mutate-autopay` | 7 of 7 |
| `mutate-ai-budgets` | 20 of 20 |
| `mutate-archenemy-six` | 13 of 13 |
| `mutate-archenemy-team-turns-bridge` | 7 of 7 |
| `mutate-archenemy` | 39, 0 survived |
| `mutate-extra-turns` | 6, 0 survived |
| `mutate-team-block-2` | 8 of 8 |

- **Deploy GATES** (those that run without the Workshop save; the `manabrew` link pointed at the engine tree for the
  run, removed before the commit). Against `origin/main` on the same machine, the only differences are additions:

| Gate | main | engine1125 |
|---|---|---|
| `test_bridge_3hg_team_block` | not there | 10 |
| `test_bridge_archenemy_team_turns` | not there | 14 |
| `test_table_extra_turns_lua` | not there | 40 |
| `test_bridge_archenemy` | 66 | 88 |
| `test_bridge_six_golden` | 18 | 30 |
| `test_table_archenemy_view` | 47 | 56 |

  Every other gate gives the same line on both, `test_bridge_golden` included. The gates that build from the Workshop
  save fail to build on both, as before.
- **Rules:** no comments added to harness Java. No protocol or Rust file changed, so there is no struct literal to
  update.

## Not done

- No image built, no live game.
- The Workshop-save gates still need a run on a machine with the saves.
