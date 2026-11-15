# Handoff: Two-Headed Giant team blocks as one joint decision (CR 805.10d)

Run this **after** `cloud/engine1117` is done, on top of that branch. It works on the same harness controller.

## Why

Officially, the defending team declares its blocks together: partners talk it over and either can change their mind
until they agree, and the primary player settles a disagreement (805.2). Our engine asks each defender once, in turn
order (primary first). The partner sees the primary's blocks, but the primary can't change theirs after seeing the
partner's. The owner wants this aligned with the official rules.

## The design (the owner approved it)

In a team block, meaning `ManaBrewInteractiveController.declareBlockers` with the team's attackers listed (shared turns,
and the level 1 shared-life case that lists the partner's attackers too):

1. **Round 1, as now:** the primary player declares, then the partner. Each is offered only their own creatures, and
   the prompt lists every creature attacking the team.
2. **Revise rounds:** after a defender's answer **changes** the team's block, the other defender is asked again.
   - The prompt shows the current team block (the partner's blocks in `gameView.combatAssignments`, as now).
   - The answer comes pre-filled with that defender's current blocks, if the protocol lets a prompt carry a current
     selection. If it can't, record how the table should show "your current blocks" instead.
   - An answer identical to that defender's current blocks means "agreed".
3. **Agreement:** the loop ends when a defender answers with no change. A defender whose partner hasn't changed
   anything since their last answer isn't asked again.
4. **Cap:** after 4 revise rounds without agreement, the primary player's latest answer stands, together with the
   partner's latest answer. Tell both players in a `revealCards` notice with no cards: "<primary> settles the team's
   blocks (rule 805.2)".
5. **Validation:** the team's block is then checked as a whole, exactly as now. An illegal block still gets the
   existing refusal re-ask, up to 3 rounds. A refusal starts again from round 1.
6. **AI defenders:** in a revise round, the AI re-decides with the partner's blocks visible. It already leaves an
   attacker its partner blocks to the partner. It must reach agreement: if its new answer equals its old one, that
   ends the loop. Make sure two AI partners agree within the cap.
7. **Out of scope:** free-for-all, 2v2 and Juggernaut keep one ask per defender. Attacks don't change; official team
   attacks have the same shape, but the owner asked about blocks only.

## Tests (SharedCombatTest, and a level 1 case in TeamGameTest or SharedCombatTest)

- **A change of mind sticks:** Yellow blocks attacker A with X. Blue blocks A with Y. Yellow, asked again, moves X to
  B. The final block is X on B and Y on A.
- **Agreement ends it:** Blue answers round 1, then Yellow answers unchanged. Total asks: Yellow 2, Blue 1, and
  nothing more.
- **No change, no extra ask:** if Blue's round 1 answer adds nothing that changes the team's block (Blue blocks with
  nothing), Yellow isn't asked again.
- **The cap:** two scripted defenders keep swapping. After 4 revise rounds, the primary's latest answer and the
  partner's latest answer stand, and both players get the 805.2 notice.
- **Refusal:** an illegal combined block is still refused and re-asked. The re-ask starts again from round 1.
- **Two AI partners:** the block finishes within the cap.
- **Level 1 contrast:** free-for-all has exactly one ask per defender.
- **Mutations** (with `l2-mutate.js --local`, each failing by name, files restored by sha256):
  - no revise rounds;
  - the cap ignored, as an infinite loop guarded by the test's timeout, which must report a named failure, never a
    hang;
  - the primary not winning the cap;
  - "unchanged" counted as a change;
  - the first defender not re-asked.

## What players must see (the owner: "it has to be easy to read and easy to do")

The table is built on the owner's PC. The engine must give it everything it needs for this:

- **Title:** "Block with <partner>" in round 1. In a revise round, "<partner> changed the blocks. Agree or change?"
- **The team's block:** one line per attacker, e.g. `Goblin Guide -> your Bear + Yellow's Wall`.
- **Agreeing is one click:** an "Agree" button that sends the defender's current blocks unchanged.
  - So a revise-round prompt must say it is a revise round, and give the round number (1 to 4).
  - It must carry the defender's own current blocks, so the table can pre-fill them and send them back on Agree.
  - Add these as optional fields on the existing chooseBlockers prompt. Older tables must still work, so don't
    rename anything.
- **Changing works as today:** pick creatures and attackers, then press Done.
- **Chat:** after each answer that changes something, one notice per change, e.g. "Yellow: Bear now blocks Goblin
  Guide." These are notices with no cards and the text in plain words, so the table only prints them.
- **At the cap:** "White decides (team leader)", then the block is final.

## Protocol and table notes (no table work here; the table is on the owner's PC)

The report says exactly what the table will see:

- the prompt type for a revise round, and whether it carries the current blocks;
- the `decidingPlayerId` sequence for each case above;
- the text of the 805.2 notice.

## Hand back

1. Regenerate both patches with `engine/make-patches.sh`.
2. Add an entry to `docs/engine-changes.md`.
3. Commit and push to **`cloud/team-block` only**. Make the branch from `cloud/engine1117`, after it has finished and
   pushed.
4. Write `docs/handoff/team-block-report.md`.

## Rules (the repo is public)

- No API keys or tokens, no personal names, no local paths.
- **No comments in Manabrew harness Java** (`forge-harness/**`).
- Never weaken a test.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Short, plain report.
