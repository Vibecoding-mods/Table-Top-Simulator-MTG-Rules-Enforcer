# Report: HOW-TO-PLAY and the game modes spec brought up to date

Cloud session, 2026-11-18, branch `cloud/how-to-play-1124` from `origin/main` (f4f614d). Docs only:
- `HOW-TO-PLAY.md`;
- `docs/game-modes-spec.md`;
- the two Team draws entries in `docs/handoff/open-after-1121.md`.

No code changed. No personal names were added.

## How it was checked

Everything written is what **main's code** does, not what a plan or a report says.
- A read-only survey of `bridge/bridge.js`, `bridge/teams.js`, `tools/engine-renderer.lua`, `tools/make-engine-copy.js`
  (the chat commands and `mtg help`) and the companion. Each fact was taken with its file and line.
- I spot-checked the ones that decide the wording:
  - game 1's roll winner simply goes first;
  - Archenemy is refused on six seats;
  - the leader notice reads "decides (team leader)";
  - a table-imported deck carries no sideboard.

**Where a feature is only on an unmerged branch, the docs say "coming"** and describe what main does now:

| Feature | On main | Coming (unmerged branch) |
|---|---|---|
| Best of three, game 1 | the roll winner goes first | the winner chooses play or draw (`bo3-roll-choice`) |
| Picked opening hand | a debug tool against the AI, swapped in at the first priority of turn 1 | dealt at the keep-or-mulligan question (`opening-hand`) |
| Archenemy | four-player table | six seats (`archenemy-six`) |
| Cost badges | the badge and hover lines below | the "also costs" lines for non-mana parts (`cost-badge-4`); not described |

## HOW-TO-PLAY.md

**New sections:**
- **Best of three:** turning it on; game 1's roll and banner; the loser's Play / Draw / Concede match; sideboarding
  (Keep deck, Swap cards, Reset to registered; private; the next game waits); the score marks, "GAME 2 OF 3" and "MATCH
  WON"; conceding the match.
  - The limit is stated: a deck imported on the table has no sideboard, so only a deck loaded with one is asked.
- **Team games:**
  - Two-Headed Giant: the official rules plus the one house rule; the **Block with <partner>** panel, Agree or change,
    the change lines, "<leader> decides (team leader)"; one turn per team as a host option, not yet tried with several
    people.
  - Three-Headed Giant: teams by side; 120 / 45 life, poison 20; the 3HG Teams cycle on six seats; the six-seat save
    marked coming, with the message shown until then.
- **Archenemy:** the command and setup button, the scheme deck, the game, the table's view (banner, scheme face up,
  ongoing row, scheme deck), Undo off, six seats coming.

**New bullets:**
- **The tie pop-up:** when it appears, Tie / Keep playing, the 3-round forced tie, the Stalemate accomplishment. Under
  "When something goes wrong".
- **Cost badges and hover text:** the number is the new generic amount, the green/red rim, the coloured chips, where
  badges show, the "Costs {2}{R} now by flashback (printed {R})" line, split and adventure halves, foretell, "FROM
  GRAVEYARD".
- **Battles:** the defense counters, the protector, attacking it, defeat and the free back face.
- **Big turns:** copies' "keep their targets?", ×N triggers, the +N-more-in-hand card, the attack tax's "Pay for all",
  the engine's limit question, `mtg stop`. Next to it, "All (N)" / "None" and the scry and surveil shortcuts are added
  to the long-lists bullet.

**Updated:**
- **Undo:** the Rewind to... list (the newest 12 points, which steps), the vote pop-up, off in Archenemy.
- **Tokens and the Treasure stack:** what counts as identical, the Split button's real label "Split the N to pick one by
  one", Treasure spent after lands, "x∞".
- **Face-down cards:** foretold cards too, and what others see ("Face-down card").
- **Own server:** the Windows companion's own-server box. The text said Linux and macOS only. The setup steps are
  reordered so step 1 (the server) applies to both.
- **Custom art:** `mtg art token` and `mtg art back`, and a double-faced card's back from the deck. It said both kept
  their normal pictures.
- **Who goes first:** Treachery's Leader, the archenemy, the Juggernaut and best of three's roll; up to 5 AI on the
  six-seat table.
- **The command table:**
  - new rows: `mtg mode 3hg`, `mtg match`, `mtg archenemy` / `mtg schemes`, `mtg treachery`, `mtg winner`, `mtg tie`,
    `mtg accomplishments`, `mtg art token` / `back`, `mtg hand` (the picked hand, a testing command, with the
    companion's Starting hand);
  - updated rows: the 2HG row (the panel and the leader notice), the Teams button (3HG on six seats) and `mtg concede`
    (3HG concedes for the team; in best of three it concedes the game, not the match).

**Unchanged:** rejoin. The text already matched main ("Rejoining: the table is updating for you...", "You're back in",
"Couldn't rejoin").

## docs/game-modes-spec.md

- **Status at the top:** the old "Nothing in §3–§9 is built" is replaced by what is built since, pointing to each
  section's "as built" note. Two-Headed Giant is stated as the official rules plus the one house rule of §5.9.1.
- **§5.12:** the old line said shared turns were the default. On main the default is each player's own turn, and
  `mtg 2hg turns shared` is the host's option. Corrected.
- **§6.1:** "Not built: Archenemy schemes" now points to §13.
- **§8.4 (new), Three-Headed Giant as built:**
  - setup, the numbers (120 Commander life from the user's decision in §12, 45 Standard, poison 20), Level 1 only;
  - what the table shows, and what it doesn't: no team tint or team-life panel for teams of three, no three-mat tracker;
  - not done: the six-seat save doesn't exist, nothing tried in TTS, and the concede text says "both" with three
    partners.
- **§13 (new), Archenemy as built:** setup, the scheme deck, the game, the table, Undo off, six seats coming (refused on
  main), what is not checked on the real table.

## Team draws

The two docs on main never described it, so there was nothing to remove from them. The two entries in
`open-after-1121.md` that listed it as open work are deleted. Its code is only on the unmerged `cloud/team-draws`.

## Gates

The tests that read these files or cite them pass:
- `test_companion_page`: 242 (it checks HOW-TO-PLAY's GIPHY key steps).
- `test_bridge_2hg_level2`, `test_bridge_2hg_team_block`, `test_bridge_3hg`, `test_bridge_bo3_extras`,
  `test_bridge_match_bo3`, `test_bridge_standard`, `test_bridge_team_modes`, `test_bridge_teams`,
  `test_bridge_treachery_first`.

## Seen, not changed (worth a decision)

- **The rewind chat line** "Undo limits: counters put on cards after the undo point stay on them, and a permanent someone
  took control of for good is not given back". An engine change (rewind card state) restores those, so the line may be
  out of date once that engine is deployed. HOW-TO-PLAY doesn't repeat it.
- **Several older commands are in `mtg help` but not in HOW-TO-PLAY's table:** `mtg planechase`, `mtg planes`,
  `mtg ai <colour>`, `mtg refresh`, `mtg fx`, `mtg animations`, `mtg commander`. They are outside this update's list.
