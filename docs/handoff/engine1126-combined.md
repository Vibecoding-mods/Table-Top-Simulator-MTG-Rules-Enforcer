# engine1126-combined: l2-long-tail + l2-team-choices-fixes

Branch `cloud/engine1126-combined`, from `cloud/l2-long-tail` (cf2e386).

- **The setup:** both branches sit on ac0dae3 and regenerate the same two patch files.
- **The combine:**
  - cf2e386's engine tree with the team-choices review fixes (524eba3) re-applied to the source: `AbilityUtils`,
    `PhaseHandler` and `TeamChoiceTest`. They applied cleanly, with small line offsets in `PhaseHandler`.
  - Both patches regenerated with `engine/make-patches.sh`; `git apply --check` is clean on `fd16e2f` / `e7d2b93b`.
    Against cf2e386 the patches differ only in those three files.
  - `tools/mutate-team-choices.js`, `docs/handoff/l2-team-choices-fixes.md` and the open lists come from 524eba3.
  - The fixes' text is merged into cf2e386's renamed `engine1126-teamchoices` row in `docs/engine-changes.md`. The
    `engine1127-longtail` row is as cf2e386 has it.
- **Run on the combined tree:**
  - harness `--all`: 55 classes, all passed;
  - `tools/mutate-team-choices.js`: 34 of 34 caught by name;
  - `tools/mutate-long-tail.js`: 15 of 15 caught by name;
  - files restored by sha256.
