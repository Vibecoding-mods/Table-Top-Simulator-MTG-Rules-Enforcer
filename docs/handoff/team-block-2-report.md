# Report: team blocks, part 2 (the notices, and teams of three)

Cloud session, 2026-11-17, branch `cloud/team-block-2`, from `origin/main` (`f4f614d`). Both items are from
`docs/handoff/open-after-1121.md` §3, "Team blocks". No engine code changed: only `ThreeHeadedGiantTest` (in
`engine/manabrew.patch`), a new bridge test and two break-its. Not built as an image.

## 1. Print the change notices, don't wait for a click: already done on main

The bridge has done this since `5ed5043` ("2HG level 2: joint team block panel, shared team turns by default",
2026-11-15). The open item came from the engine-side notes in `docs/handoff/team-block.md`, which were written before
the bridge part landed.

- **Engine:** `tellTeam` sends each defender `notifyOfValue`, which becomes an acknowledged `revealCards` prompt with no
  cards and the message as `presentation.title`.
- **Bridge** (`bridge/bridge.js`, the no-card `revealCards` path): `teams.teamBlockNotice(title)` recognises a change
  ("Purple: Trained Armodon now blocks Juggernaut.") or the cap ("Green settles the team's blocks (rule 805.2)", said
  "Green decides (team leader)"). The bridge then:
  - prints one `[MTG]` chat line to that seat;
  - writes the game log once for the team (`tableNotice` with a `teamblock|` key);
  - answers `revealCardsAcknowledged` at once and returns, so nothing is shown or asked.
- **Already tested** for two defenders in `tests/test_bridge_2hg_team_block.js` ("notice: printed, never asked
  (acknowledged, nothing shown)"). The new test below checks it for three.

Nothing was changed for this item.

## 2. The re-ask order with teams of three

**Engine** (`ThreeHeadedGiantTest`, 6 seats: White, Red and Yellow attack; Green, Blue and Purple defend). Five new
`cr805.10d threes` checks, recording who is asked and every notice:

- `aFirstAnswerTellsNobody`: three answers that change nothing. Three asks, no notices.
- `aMiddlePartnersChangeReasksOnlyWhoAnswered`: Blue changes the block in round 1. Only Green, who had already
  answered, is asked again; Purple, not yet asked, is asked once. Asks: Green, Blue, Purple, Green.
- `aChangeInAReviseRoundReasksTheOtherTwoInTurnOrder`: Purple changes in round 1, then Green in the revise round.
  Both others are asked again, in team order: Green, Blue, Purple, Green, Blue, Purple.
- `reasksAfterTwoChangesGoInTurnOrder`: three changes in a row (Purple, Green, Blue). The next ask is always the
  first stale partner in team order: Green, Blue, Purple, Green, Blue, Green, Purple.
- `theCapAfterFourReasksLetsThePrimaryDecide`: changes every time. After four re-asks the primary (Green) settles the
  block; seven asks, the block is Green's last, and each of the three is told who decided.

All 11 `ThreeHeadedGiantTest` checks pass.

**Bridge** (`tests/test_bridge_3hg_team_block.js`, new, in GATES): the engine order from
`reasksAfterTwoChangesGoInTurnOrder` played through the bridge on a six-seat board, question by question, with each
notice sent to all three defenders. 10 of 10:

- the asks go to the seats in that order, with the revise round told to the table;
- round 1's title names both partners ("Block with Blue and Purple"); a revise round's names who changed;
- the team's block names both partners, each in their seat colour;
- Agree sends `currentAssignments` back; a pick is sent as picked;
- each change is one chat line to each of the three, acknowledged at once and never shown, and once in the game log;
- the cap's notice reads "Green decides (team leader)" to all three.

## Break-its (each fails by name, files restored by sha256)

- `node tools/mutate-team-block-2-engine.js <tree>`: **7 of 7** on `PhaseHandler`'s joint block:
  - the next re-ask not the first stale partner in team order;
  - a partner not yet asked counted as answered;
  - the cap one higher;
  - an answer that changes nothing re-asking the others;
  - a re-asked partner left stale;
  - the changer not named;
  - only the first stale partner re-asked.
- `node tools/mutate-team-block-2.js`: **8 of 8** on the bridge:
  - only the first other player named in colour;
  - the title ignored;
  - the round not told to the table;
  - Agree sending the picks;
  - the change notice not in chat;
  - the notice logged once per defender;
  - the notice never acknowledged;
  - the 805.2 notice not reworded.

## Gates

- **The full harness suite** (`engine/test-harness-local.sh --all`, on this branch's tree): every class passed except
  `SharedTurnsPlayTest`, whose `aiTeamsPlayASharedTurnGameToTheEnd` failed once ("no combat had both partners
  attacking"). The bridge golden was running out of memory on the same machine at that moment. Rerun alone it passed 3
  of 3. It is an AI game with time budgets and this change touches no engine code, so it looks load-sensitive, not
  broken; it may be worth a look if it fails again under load.
- **Deploy GATES:** 60 of 98 pass, the new `test_bridge_3hg_team_block` among them, and `test_bridge_golden` (1084
  scenarios). The other 38:
  - 36 need the TTS Workshop save;
  - `test_bridge_claims`, whose live files guard fails on the base too;
  - `test_editor_forward`, for want of IPv6.
- `tools/mutate-team-block.js` (the 2HG break-it) wasn't rerun: its baseline needs `test_table_2hg_team_block`, which
  needs the save. No code it mutates changed.
- **Patches:** `engine/manabrew.patch` regenerated, and only `ThreeHeadedGiantTest.java` changed. `engine/forge.patch`
  is unchanged. `git apply --check` is clean on `fd16e2f` / `e7d2b93b`. No comments in harness Java.

## Docs

- `docs/handoff/open-after-1121.md` §3: the team-block items are marked done, pointing here.

## Not done

- No image was built and no live 3HG game was played.
- The table side (`tests/test_table_2hg_team_block.js`) isn't widened to three: it needs the save.
