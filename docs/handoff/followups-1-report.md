# Report: follow-ups 1 (custom art by player; cost badge halves and the cheapest way)

Cloud session, 2026-11-17, branch `cloud/followups-1`. Not built into an image, not tried on the real table or a live
engine. No permission prompt is pending.

**Base:** `origin/cloud/cost-badge-2` (b08e215), as asked, with `origin/cloud/custom-art-2` merged into it (97e19b1).
The token and back pictures in item 1 exist only on custom-art-2, and neither branch is on main yet. The merge had one
conflict, the GATES line in `tools/deploy.js`, where both new tests are kept. After the merge both branches' tests pass
(custom-art-2 46, custom-art 54, cost-badge-2 23).

## 1. Custom art follows the player

- **Bug:** `mtg art token|back` pictures were kept by seat colour (`playerArt[colour]`). A player who later took that
  colour wore the previous player's tokens and backs until the bridge restarted.
- **Fix (bridge.js `noteSeatSteam`, `artKeyOf`, `playerArtOf`, `onArtSet`):**
  - The pictures are kept by the player's Steam ID, the identity the bridge already uses for the accomplishments
    (`game.steam`).
  - The table now sends `steam = pl.steam_id` with `artset` (make-engine-copy.js). The bridge also notes the start's
    `steam` list and the votes' Steam IDs (`noteSteam`).
  - A colour's cards wear the pictures of the player last seen at that colour.
  - Pictures set where no Steam ID came (a hotseat seat, an older table) are the colour's until a Steam ID is seen
    there. The first one is taken as the player's and the pictures go with them. A different one later doesn't
    inherit them.
  - A value that isn't a Steam ID (`not-a-steam-id`) is no player.
- **Tests:**
  - **`node tests/test_bridge_art_owner.js`: 18 of 18, in GATES.** Written first: 12 failed before the fix. Checks:
    - another player at the colour (list and tokens);
    - the player at another colour;
    - another player's clear;
    - a new occupant seen at the start, and the owner back;
    - no Steam ID: the colour's, then the first player's, a different player, and the start;
    - not a Steam ID;
    - back pictures;
    - the table sending the Steam ID.
  - `test_bridge_custom_art_2`'s table check now also expects the Steam ID in the message. It is not weakened.
  - **Break-it: `node tools/mutate-art-owner.js`: 8 of 8 by name.**
  - `tools/mutate-custom-art-2.js` follows the new message: 28 of 28.

## 2. Cost badge: halves and the cheapest way (`engine1117-costbadge3`)

- **Found first:** a split card in hand always showed a false "cheaper" badge. Phase 1 priced its first half (Fire,
  {1}{R}) against the whole card's printed cost ({2}{R}{U}).
- **Engine** (`engine/manabrew.patch`, on top of cost-badge-2; no comments in the harness Java):
  - Protocol: `SpellCostDto { name, cost, printed, mode? }`, and `CardDto.spellCosts`, `playCostName`,
    `playCostOthers`.
  - **A split card has no `effectiveManaCost`.** `spellCosts` lists each half of a split or adventure card that can
    be cast from its zone, with its cost now and printed, when one changed. A fuse card's whole is not a half.
  - **From a graveyard or exile, every way is priced:** a permission (each half), an alternative cost from that zone,
    aftermath. The cheapest by mana value is `playCost`, with the half it casts and that half's printed cost; the rest
    are `playCostOthers`.
  - **A half is priced in its own state:** the card is set to that state without a view update and set back, as Forge
    does when casting it. Without this, Thalia didn't tax Stomp.
  - Both patches `git apply --check` clean on fresh `fd16e2f` / `e7d2b93b` worktrees, and produce the built tree's
    files.
- **Bridge:**
  - A half gets no badge, because the picture shows a cost for each half and the badge sits on one. Its hover says
    "Castable: Memory {5}{U}{U} by aftermath (printed {4}{U}{U})".
  - In hand, each changed half: "Stomp: costs {2}{R} now (printed {1}{R})".
  - The other ways: "Other ways to cast it: Ice {1}{U}; {2}{R} by flashback". Only in the seat's playable row, never
    on the public piles.
  - `table-map.js` has the three new fields. No Lua or XML change.
- **Tests:**
  - **Harness `CostBadgeTest`: 22 of 22.** The 8 new checks were written first and failed first:
    - split, taxed and untaxed;
    - adventure;
    - the state put back after two snapshots;
    - fuse;
    - aftermath;
    - the cheapest of Kess and Deep Analysis's flashback;
    - Kess on a split card.
  - **The whole harness suite (44 classes):** 43 passed.
    - `SharedTurnsPlayTest` (an all-AI game; "no combat had both partners attacking") failed in the full run and in
      one rerun, both while break-it runs were loading the machine.
    - Run alone afterwards it passed 3 of 3 on this tree and 3 of 3 on main's.
    - It doesn't use the cost code. It looks timing-sensitive under load, as in the cost-badge-2 run.
  - **`node tests/test_bridge_cost_badge_3.js`: 17 of 17, in GATES.** Written first.
  - **Break-its, every file restored by sha256:**
    - `node tools/mutate-cost-badge-2-engine.js <tree>`: 24 of 24 by name. The 11 new mutations cover splits,
      halves, the adventure, the state taken and put back, fuse, cheapest, others, aftermath, the half's name and its
      printed cost. The older ones were moved onto the new code.
    - `node tools/mutate-cost-badge-3.js`: 11 of 11.
- `docs/engine-changes.md` has the `engine1117-costbadge3` row and section; `docs/cost-badge-spec.md` has a
  "Follow-ups" section.

## Regression

- The GATES against `origin/main`, both trees run here: the same result for every gate except:
  - `test_table_map`: 631 → 657 (this branch's new fields);
  - the four tests the two merged branches and this one add, which pass: `test_bridge_cost_badge_2`,
    `test_bridge_custom_art_2`, `test_bridge_art_owner`, `test_bridge_cost_badge_3`.

  The gates that need the Workshop save fail to build on both trees.

## Not done

- No image, no live game.
- The cheapest way is by mana value only, so life and other costs aren't weighed.
- Non-mana parts of a cost aren't shown.
