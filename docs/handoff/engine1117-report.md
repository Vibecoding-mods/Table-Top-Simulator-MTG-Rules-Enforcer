# Report: engine1117 (Two-Headed Giant level 2 + the life house rule)

Cloud session, 2026-11-15. Done on branch `cloud/team-block` (the owner asked for engine1117 and team-block in one
session, pushed there only); `cloud/engine1117` itself was not pushed to.

1. **Build and run:** `engine/test-harness-local.sh --all` on the patches as handed over: **23 of 23 classes pass**
   (SharedTurnsTest, SharedTurnsDevTest, SharedCombatTest, TeamGameTest and the rest). No compile errors, no conflicts
   to fix. New check where the two features meet: `SharedTurnsTest.aGainInTheTeamTurnTriggersThePartnersLifeCardOnce`.
   In White's team turn (level 2), and in White's own turn (level 1), White's gain of 3 triggers Red's Ajani's Pridemate
   once, White's once, Yellow's not. It passes.
2. **Mutations:** `node tools/l2-mutate.js --local <tree>`: **39 of 39 caught by name, 0 escaped, 0 stale** (plus the
   "none" run, which fails nothing). New: `life-house-rule-off` (`matchesValidLifePlayer` matches plain `ValidPlayer`
   only), caught by the new check. Every file restored by sha256; the Forge tree was clean after the run.
3. **Patches:** `forge.patch` byte-identical (474 files), `manabrew.patch` changed only in SharedTurnsTest (63 files);
   both pass `git apply --check` on fresh trees at the pinned commits.
4. `docs/engine-changes.md`: the "engine1117" entry (section 4) and its row.
5. `docs/game-modes-spec.md` §5.1, §5.4 item 4 and §5.10: the primary player is the team's furthest-right seat from the
   team's view, White and Yellow on the 4-player table (the team's first seat in turn order, `GameAction.teamLead`).

Not done: no Docker image, no live check.
