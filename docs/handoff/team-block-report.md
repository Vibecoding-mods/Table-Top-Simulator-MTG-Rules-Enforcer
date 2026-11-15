# Report: Two-Headed Giant team blocks as one joint decision (CR 805.10d, 805.2)

Cloud session, 2026-11-15, branch `cloud/team-block`. `cloud/engine1117` was still only a handoff, so on the owner's
answer I did its steps first, here (`docs/handoff/engine1117-report.md`). Then I did every step of
`docs/handoff/team-block.md`. Nothing was pushed to any other branch.

## Results

- **Harness:** `engine/test-harness-local.sh --all` passes 23 of 23 classes.
  - SharedCombatTest has 22 checks, 8 of them new.
  - SharedTurnsTest, SharedTurnsDevTest and TeamGameTest still pass.
- **Mutations:** `node tools/l2-mutate.js --local <tree>` catches **49 of 49 mutations by name, 0 escaped**.
  - That is the 39 from engine1117 plus 10 new ones.
  - Every file was restored by sha256, and the Forge tree was clean after the run.
  - One new mutation first failed to compile: a constant `false` loop condition is unreachable code for javac. I
    reworded it, and it is caught.
- **Rust:** `cargo build` passes for the protocol, agent-interface, manabot, self-hosted-node and manabrew-server
  crates. `cargo test -p manabrew-protocol` passes 147 tests.
- **Patches:** regenerated against a clean tree. `forge.patch` has 474 files and `manabrew.patch` has 64; the new
  file is `choose_blockers.rs`. Both apply to fresh trees at the pinned commits.
- **Not done:** no Docker images and no live check.
  - Build both images: the shared protocol crate changed.
  - I did not check whether the relay keeps unknown prompt fields.

## What was built

- **Joint block (Forge, `PhaseHandler.declareJointBlockers`):**
  - **Where it applies:** every team block at level 2. At level 1 (shared life, own turns) the attacked team now
    blocks the same way; each defender's blockers are still finished on their own. Free-for-all, 2v2 and Juggernaut
    keep one ask per defender.
  - **Round 1:** each defender in turn order, primary first.
  - **Revise rounds:** an answer that changes the team's block asks again each partner who had already answered. Their
    own blocks are taken back first, so an AI re-decides with only the partner's blocks in place.
  - **Agreement:** an answer equal to the defender's last answer.
  - **Cap:** after 4 revise asks without agreement, the primary's latest answer stands with the partner's latest. Both
    defenders get the notice.
  - **Validation:** the team's block is checked as a whole after that, as before. A refusal starts again from round 1,
    for up to 3 rounds in all.
- **Protocol:** four optional fields on the existing `chooseBlockers` prompt. Nothing was renamed, so older tables keep
  working.

## What the table sees

**Prompt:** it is still `chooseBlockers`, and the answer is still `declareBlockers` with `assignments`. In a team block
it also carries:

| Field | Round 1 | Revise round |
| --- | --- | --- |
| `title` | `"Block with Yellow"` (the partners' names) | `"Yellow changed the blocks. Agree or change?"` |
| `reviseRound` | absent | 1 to 4 |
| `currentAssignments` | the defender's own blocks, if any (after a refusal) | the defender's own blocks from their last answer |
| `teamBlockLines` | one line per attacker | same |

- **Lines:** each line names the attacker and its blockers, e.g. `"Hill Giant -> your Centaur Courser"`,
  `"Grizzly Bears -> Yellow's Wall of Wood"`, or `"Goblin Guide -> not blocked"`. Several blockers are joined with
  ` + `.
- **Agree:** send `currentAssignments` back unchanged as `assignments`.
- **Change:** works as today: pick creatures and attackers, then Done.
- **Pre-fill:** the defender's own blocks are taken off the board while they are asked, so the table pre-fills them
  from `currentAssignments`. `gameView.combatAssignments` shows only the partner's blocks during the ask.
- **Outside team blocks:** free-for-all, 2v2 and Juggernaut prompts have none of these fields.

**Notices:** these are the existing no-card `revealCards` notices, sent to both defenders.

- **A change:** one line per changed blocker, e.g. `"Yellow: Wall of Wood now blocks Hill Giant."` or
  `"Blue: Centaur Courser no longer blocks."`
  - A notice is sent only for an answer made after a partner has already answered, so it is the answer that asks
    someone again.
  - The first defender's round 1 answer sends none: the partner sees it in their own prompt.
- **At the cap:** `"Yellow settles the team's blocks (rule 805.2)"`.
  - The owner's note asked for "White decides (team leader)". I used the handoff's 805.2 text so the tests have one
    string to check.
  - The table can show "Yellow decides (team leader)" from this notice, or I can change the text if the owner prefers.

**`decidingPlayerId` sequences:** White's team attacks; Yellow is `player-2` (primary) and Blue is `player-3`.

| Case | Asks |
| --- | --- |
| A change of mind (Yellow changes in her re-ask, Blue agrees) | player-2, player-3, player-2 (`reviseRound` 1), player-3 (`reviseRound` 2) |
| Agreement (Blue changes, Yellow agrees) | player-2, player-3, player-2 (`reviseRound` 1) |
| No change (Blue blocks nothing) | player-2, player-3 |
| The cap (both keep changing) | player-2, player-3, then player-2, player-3, player-2, player-3 with `reviseRound` 1 to 4; then the 805.2 notice to both |
| Refusal (Blue's Watchdog must block and doesn't) | player-2, player-3, player-2 (`reviseRound` 1, agrees), refused; player-2, player-3, refused; player-2, player-3, stands |
| Level 1 (shared life), a change of mind | the same as level 2 |
| Free-for-all | each attacked defender once |

## Tests (SharedCombatTest, 8 new checks)

| Check | Shows |
| --- | --- |
| `aChangeOfMindSticks` | Yellow X on A, Blue Y on A, Yellow moves X to B. Final: X on B, Y on A. The change notices go to both. |
| `anUnchangedAnswerIsAgreement` | Asks are Yellow 2, Blue 1, and nothing more. |
| `noChangeNoExtraAsk` | Blue blocks nothing, so Yellow isn't asked again and no notice is sent. |
| `thePrimarySettlesTheBlocksAtTheCap` | Scripted swaps. After 4 revise asks, Yellow's latest (no block) and Blue's latest (Y on B) stand, and both get the 805.2 notice. |
| `aRefusedJointBlockStartsAgainFromRoundOne` | The refusal sequence above. |
| `twoAiPartnersAgreeWithinTheCap` | Two Forge AI defenders against three attackers agree in fewer than 6 asks, and no settle notice is sent. |
| `aLevelOneTeamBlocksAsOneDecision` | The change of mind at level 1. The free-for-all contrast asks each defender once. |
| `theRevisePromptCarriesTheTeamsBlock` | Revise round 2: the title, `reviseRound`, `currentAssignments`, the lines and Agree. Round 1: the title, with no `reviseRound`. Free-for-all: no team fields. |

## Mutation table (the new ones)

| Mutation | Caught by |
| --- | --- |
| no-revise-rounds | aChangeOfMindSticks, anUnchangedAnswerIsAgreement, thePrimarySettlesTheBlocksAtTheCap, aRefusedJointBlockStartsAgainFromRoundOne, aLevelOneTeamBlocksAsOneDecision |
| team-block-cap-ignored (an endless loop) | thePrimarySettlesTheBlocksAtTheCap. The check's prompt timeout reports a named failure, not a hang. |
| primary-not-winning-the-cap (the primary's first answer re-applied) | thePrimarySettlesTheBlocksAtTheCap |
| unchanged-counted-as-change | anUnchangedAnswerIsAgreement, noChangeNoExtraAsk, theDefendingTeamIsAskedOnceInTurnOrder |
| first-defender-not-re-asked | aChangeOfMindSticks, anUnchangedAnswerIsAgreement, aLevelOneTeamBlocksAsOneDecision |
| change-notices-not-sent | aChangeOfMindSticks |
| settle-notice-not-sent | thePrimarySettlesTheBlocksAtTheCap |
| level1-team-block-off | aLevelOneTeamBlocksAsOneDecision |
| revise-prompt-plain (harness) | theRevisePromptCarriesTheTeamsBlock |
| revise-prompt-no-current-blocks (harness) | theRevisePromptCarriesTheTeamsBlock |

All 39 older mutations are still caught.

## Open

- **Notice wording:** "Yellow settles the team's blocks (rule 805.2)" or "Yellow decides (team leader)"; the owner
  picks one.
- **Teams of three or more:** a re-ask goes to the first partner in turn order who is due. That isn't tested, because
  the table has only teams of two.
- **Notice acknowledgements:** the change notices use the existing acknowledged `revealCards` notice. A human defender
  gets one per change in a re-ask round, so the bridge should print them, not wait for a click.
