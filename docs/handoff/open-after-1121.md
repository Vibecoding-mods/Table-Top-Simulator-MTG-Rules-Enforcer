# What is still open, across this cloud session's handoff reports

**Superseded (2026-11-18) by [open-after-1124.md](open-after-1124.md).**

Written 2026-11-17 from the 21 reports and measurement notes this session pushed (every commit with this session's
trailer, read from `origin`). Read-only: nothing was changed or re-run for this list.
- Branch names are where each report lives on `origin`. Some are merged locally already: local main was about 10
  merges ahead of `origin` when this was written. So an item here may already be closed there.
- Items that a later branch of this session already did are listed at the end, so they aren't picked up twice.

## 1. Needs the real table (TTS, the Workshop saves)

None of the table work was seen in TTS. The gates that build from the Workshop save (`test_table_golden`, `test_ui_budget`,
`test_table_profile`, `test_table_six`, `test_table_claims`' save part) couldn't run in the cloud. They need a run on a
machine with the saves (2296042369 and 2293586471) before or after the merge.

| Item | From | What to check |
|---|---|---|
| Six-seat table golden | m6-headless | Record `tests/golden/table_golden_6p.json` with `node tests/test_table_golden_six.js --record` (read what it draws first), then add `test_table_golden_six` to GATES. It has never run. |
| Token entries on the table | token-entries | `node tests/test_table_golden.js` unchanged, and the fake-TTS part of `tests/test_table_token_entries.js` (one check per golden game). Not exercised in the cloud. |
| Three-Headed Giant table | 3hg-table, three-headed-giant | `mtg mode 3hg`, the Teams button's 3HG cycle and the setup text on the six-seat table. `test_table_profile` / `test_table_six` SKIPped here. |
| Archenemy view | archenemy-table-view | The spots of the scheme set in motion, the ongoing row and the scheme deck pile (clear of the stack, planes and attack lines). The setup button 10 past Teams. Schemes drawn at a normal card's shape (plan step 10, oversized pictures, still open). |
| Cost badge phase 2 | cost-badge-2, followups-1 | Faithless Looting in the graveyard: a red rim with 2, and the hover "Costs {2}{R} now by flashback (printed {R})". A foretold card in the row: no badge, the foretell cost in the hover. Goblin Electromancer: a green badge on a hand instant. A split card in hand: no badge, each half in the hover. `BADGE.cost` is still phase 1's estimate. |
| Custom art 2 | custom-art-2, followups-1 | A DFC import's second state reaching `mtg ready` (`n2`, `f2`); DFC backs and transformed sides showing the deck's pictures; `mtg art token|back`; a pasted AI deck list with links. Pictures following the player (Steam ID) when seats change. |
| Treachery and best of three | treachery-bo3 | Identity cards' real TTS names contain "Identity" and "Leader" and are dealt within reach of each seat's mat. The Play/Draw question shows after the game-over board and is answered from the panel. |
| 2HG Level 2 looks | shared-turn-looks | The shared team turn's header and colours on the table. |
| Planechase / Archenemy follow-ups | followups-2 | The planar deck order question's words with Norn's Seedcore; the direction ("comes up first") is from Forge's code, not seen in a game. An Archenemy banner across a bridge restart. |
| M6 real games | m6-headless | Spec step 15: host + 5 AI on the six-seat engine save (once the user allows the new save), then a game with friends. |

## 2. Needs an engine image or a live engine

No branch of this session built a Docker image or played against a live engine. Every engine change below is "not
deployed", and each needs `engine/build-images.sh` (and a live check) on the owner's PC:

| Engine change (`docs/engine-changes.md`) | Branch |
|---|---|
| engine1117 (2HG Level 2, the life house rule) | engine1117, team-block |
| Team blocks as one decision | team-block |
| Three-Headed Giant checks | three-headed-giant |
| Tie offer | tie-offer |
| Snapshot speed (`engine1117-snapspeed`) | snapshot-speed |
| Cost badge phase 2 (`engine1117-costbadge2`) and follow-ups (`engine1117-costbadge3`) | cost-badge-2, followups-1 |
| Planar owners (`engine1117-planarowners`) | followups-2 |
| Big-board fixes (`engine1117-bigboard`, on mana-sources) | big-board-fixes |

Also waiting on images:
- `bridge/engine-test.js --seats 6 --turns 12` twice on the rebuilt relay (m6-headless; spec step 7's relay image).
- The companion's own-server mode against a real relay over the internet, TLS (`secure: true`) and Tailscale
  (companion-server).

## 3. Code not built (follow-ups)

**Cost badge:**
- Done on `cloud/cost-badge-4` (`engine1121-costbadge4`, not deployed): the non-mana parts of every way are in the
  hover, and a tie in mana value goes to the way with fewer non-mana parts, then less life
  (`docs/handoff/cost-badge-4-report.md`).

**Big boards** (big-board-fixes, measure-big-boards):
- `MagicStack.add`'s static pass for each mana ability is unchanged. Its cost is the CR 613.8 dependency
  re-detection after each tap (about 430 ms a tap at 6 × 60), which needs a dependency cache across game states.
- AI payment past its budget is 7.5 s at 6 × 90, not 5 s. A shorter payment-only budget is a one-line choice.
- The AI attack goes past its 5 s budget at 6 × 120 (9.7 s): its defender prediction before the deadline check
  isn't bounded.
- The checkpoint budget (250 MB, 27 KB a card) is from JVM numbers. Measure the native image before settling it.
- The human's auto-pay button (`AutoPay`) wasn't timed on big boards.
- No full game was played at these sizes: the boards were placed, not cast.

**Snapshot speed:** the rest of the snapshot is still linear work per viewer, about 300 ms at 10,000 tokens, mostly
building the JSON.

**Two-Headed Giant:**
- **Team blocks (team-block):** both items done in team-block-2 (`docs/handoff/team-block-2-report.md`):
  - the re-ask order with teams of three is tested in `ThreeHeadedGiantTest` and, through the bridge, in
    `tests/test_bridge_3hg_team_block.js`;
  - the bridge already printed the change notices and acknowledged them at once (since 5ed5043); the new test checks it
    for all three defenders.
- **Level 2 tests (l2-tests):**
  - ~~805.9's "the active player" and 805.10e's "defending player" (an effect naming a defending player without an
    attacker) have no choice in Forge and no check~~: the controller of the spell or ability chooses (not the team),
    `cloud/l2-team-choices`, with 805.10c's attacking player;
  - 805.3a's simultaneous mulligans are checked only for order.

**Best of three (treachery-bo3), spec §3.6 later:**
- sideboarding between games;
- "Concede match";
- game 1's random pick and the winner's choice (game 1 keeps the engine's roll);
- "Game 2 of 3" in the phase bar.

**Custom art (custom-art-2):** the Card Importer's own checks, its second `#link` and its DFC state kept with a link.
The importer's script is in the Workshop save, so this needs the save. `mtg art back` covers it meanwhile.

**Tie offer:** no golden scenario was added; the new tests cover the flow.

## 4. Decisions for the owner

| Question | From |
|---|---|
| 805.2's primary player: **decided 2026-11-17**, the team's first seat in turn order on every table size (spec says so now). | l2-tests |
| The team-block notice: **decided**, "Yellow decides (team leader)", sent so by the engine. | team-block |
| Checkpoint thinning: **decided**, drop the oldest turns' in-between points first, then the oldest turn's first, the current turn's last (never its newest, never a pending vote's point); the size cap stays. | big-board-fixes |
| Companion own-server mode, **decided**: (1) Windows keeps `server.json`; (2) the key encrypted with DPAPI on Windows, the file mode 600 on Linux/Mac; (3) with a server, `mtg reset` skips the local Docker restart and says "restart the room on the host's server"; (4) the companion compares the server's engine version with the table's on connect and warns; (5) no status-page box; (6) Tailscale only. | companion-server |

## Done later by this session (not open)

- **cost-badge-2's** "a card with two ways from one zone shows the first", and the split and adventure second halves:
  done in followups-1 (`engine1117-costbadge3`).
- **custom-art-2's** token and back pictures kept by seat colour (the follow-up raised in review): done in
  followups-1, now kept by Steam ID.
- **archenemy-bridge's** "table work (plan step 9)": done in archenemy-table-view.
- **three-headed-giant's** "the table": done in 3hg-table.
- **The measurements' recommendations 1, 2, 4 (in part) and 5:** done in big-board-fixes.
- **The planar owners from the engine, the planar order wording, the Archenemy resume:** done in followups-2.
