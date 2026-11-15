# Handoff: Two-Headed Giant house rules, "Team draws" toggle and "Team effects"

You are a Claude Code cloud session. Read this file, then `docs/handoff/l2-tests.md` and
`docs/handoff/l2-tests-report.md` on branch `cloud/l2-tests`: the build-without-Docker steps there
(`engine/test-harness-local.sh`, `node tools/l2-mutate.js --local`) work here too. Copy them onto this branch
if they're missing. This branch is based on `main`, whose `engine/*.patch` files are the live engine
(engine1116-teams3).

## What the owner wants

In Two-Headed Giant the owner wants teammates to be treated as one: "everything shared except mana". Two new
house rules, active only in shared-life games (`GameRules.hasSharedTeamLife()`):

1. **Team draws, a toggle, default OFF.** When ON: when a spell or ability makes a player draw, scry, surveil, or
   look at the top N cards of their library, the partner does the same with their own library. OFF follows the real
   rules: only that player does it (Rhystic Study draws for its controller only).
2. **Team effects, always ON, no toggle.** Effects that make a player discard, mill, or sacrifice, create
   tokens ("you create"), or get player counters (energy, experience; NOT poison) also do the same to the partner.
   A sacrifice makes the partner sacrifice one of their own.

For both:
- **Never shared:** mana; the turn's draw-step draw; anything paid as a cost (a sacrifice or discard paid to cast or
  activate something). Hook at the effect level, not cost payment.
- **Poison:** already team-shared at level 1. It must hit the team once, never doubled.
- **No loops:** a shared copy never shares again.
- Read the real Forge effect classes (DrawEffect, ScryEffect, SurveilEffect, DigEffect for "look at the top",
  DiscardEffect, MillEffect, SacrificeEffect, TokenEffect, CountersPutEffect on players) before hooking.

## The model to copy

The existing house rule is `teamLifeEvents`: a partner's life gain or loss triggers your "you gain/lose life" cards.
See `docs/engine-changes.md` (engine1116-teams3) and commit b49190f.

It is **always on**: the harness calls `rules.setTeamLifeEvents(true)` in `configureTeamRules`
(ManaBrewEngineAdapter) for every sharedLife game. It has no request field and no button. "Team effects" should
work the same way.

"Team draws" needs a full chain, because it is a choice made at setup:

1. Forge: a `GameRules` flag (`teamDraws`) plus the hooks.
2. The harness `StartGameRequest`: a field read in `configureTeamRules`.
3. The Rust node: `manabrew-rs/crates/self-hosted-node`, in `java_backend.rs` (`GameConfig` and `StartGameRequest`,
   copied in `apply_game_config`). The node's serde structs drop fields they don't name, so this step is required.
   Run `cargo build -p self-hosted-node` (or the crate's real name) to prove it compiles.
4. The relay passes `gameConfig` as it is: no change.
5. The bridge: `bridge/teams.js`, where `gameConfig` is built (see `teamRules`). Add `teamDraws` from a table setting
   named `teamDraws` (boolean, default false). Add tests in `tests/test_bridge_teams.js`.
6. The TTS setup button is NOT yours. It stays on the owner's PC. Describe in your report what the table needs to send.

## Tests (harness Java, the style of the house-rule test and SharedTurnsTest)

- **Each category gets a check** in a new `TeamHouseRulesTest`: draw (Divination), scry, surveil, look at the
  top (Impulse), discard, mill, sacrifice ("each opponent sacrifices" and "you sacrifice"), token ("you create"),
  energy counter.
- **Each check has three cases:** the flag's ON case, the OFF case for Team draws, and a level 1 contrast with no
  shared life (free-for-all: nothing shared).
- **Separate checks:**
  - the draw step is not shared;
  - a cost sacrifice or discard is not shared;
  - mana is not shared;
  - poison is counted once;
  - no loop (Team draws ON with two draw-triggered cards).
- Use Forge's real card scripts and real prompt text. Never guess it.
- **Break-it:** a mutation per hook in `tools/l2-mutate.js --local` (or a sibling list). Each check must fail by
  name, and every file is restored by sha256. Report the caught/escaped table.
- **Regression:** `SharedTurnsTest`, `TeamGameTest` and the house-rule test still pass.

## Hand back

1. Add an entry to `docs/engine-changes.md` ("engine1117-teamdraws, built, not deployed").
2. Regenerate `engine/forge.patch` and `engine/manabrew.patch` with `engine/make-patches.sh` against a clean tree
   at the pinned commits.
3. Commit and push to **`cloud/team-draws` only**.
4. Last commit: `docs/handoff/team-draws-report.md`, covering results, the mutation table, the bridge change, what
   the table must send, and anything open.

## Rules (the repo is public)

- No API keys or tokens. No personal names or local paths in anything you commit.
- **No comments in Manabrew harness Java** (`forge-harness/**`). Forge Java may have short comments.
- Never weaken a test to make it pass.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Short, plain report. Say what failed, with the output.
