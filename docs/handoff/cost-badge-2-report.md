# Report: cost badge phase 2 (cards cast from a graveyard or exile)

Cloud session, 2026-11-17, branch `cloud/cost-badge-2` from `origin/main` f63de76. Engine (harness and protocol),
bridge and table; no new screen XML. Not built into an image, not tried on the real table or a live engine. No
permission prompt is pending. The full description is in `docs/cost-badge-spec.md` Step 5 and
`docs/engine-changes.md` (`engine1117-costbadge2`).

## Engine (`engine/manabrew.patch`; `engine/forge.patch` unchanged)

- **Protocol:** `CardDto` gains three optional fields:
  - `playCost`: what the card costs cast from there now;
  - `playCostMode`: the way it is cast (`flashback`, `escape`, `foretold`, `plotted`, other Forge `AlternativeCost`
    names, `may play` for a permission, `free`);
  - `playCostPrinted`: a foretold card's own printed cost. Forge's `manaCost` there belongs to the face-down state.
- **Harness, new `PlayCost`** (no comments). It covers a card the extractor marks `mayPlay` outside the hand, in the
  seat's own view only:
  - **a permission:** a free one is `{0}`; one naming an alternative mana cost uses that cost; otherwise the card's
    own spell;
  - **otherwise:** the first alternative-cost spell Forge restricts to the card's zone;
  - **a foretold card:** read from its original state.
- **Found and fixed in phase 1:** `effectiveManaCost` never showed a reduction. `CostAdjustment.adjust(Cost, …)`
  applies only raises and the commander tax.
  - Both costs now go through the `ManaCostBeingPaid` form of `CostAdjustment.adjust`, with `test` set, after the
    raises.
  - Nothing left reads `{0}`, not null.
  - A spell whose reduction is a choice keeps its raised cost: assist, delve, convoke, improvise, waterbend,
    `TapCreaturesForMana`, offering, emerge.
    - **Assist** is the guard that matters. `choosePlayerToAssistPayment` asks the player outside payment, and without
      the guard the snapshot waits on it (the break-it shows this).
    - The interactive controller's delve and convoke choosers already decline outside payment. Those keep the guard
      because the reduction is a choice.
- **`git apply --check`:** clean for both patches on fresh `fd16e2f` / `e7d2b93b` worktrees. The files they produce
  match the built tree's.

## Bridge and table

- **`costNow` (bridge):** a card in the seat's playable row takes:
  - `playCost` as `ec`;
  - `playCostPrinted`, or its printed cost, as `mc`;
  - `em` for the way: `flashback`, `escape`, `foretell`, `plot`. None for a permission or a free cast.

  This applies when the engine sent no `effectiveManaCost` and the two costs differ.
  - The public graveyard and exile piles never carry it.
  - A face-down row card (foretold) gets no badge fields. That follows the existing privacy rule: its buttons might
    show to other players. Its hover text says it instead: "Costs {1}{U} now by foretell (printed {1}{U}{U})".
- **`bridge/table-map.js`:** `playCost → ec`, `playCostMode → em`, `playCostPrinted → mc`.
- **Table (`engine-renderer.lua`):**
  - `engineCostChange(mc, ec, em)` adds "by <way>" to the hover words: "Costs {2}{R} now by flashback (printed {R})".
  - `description` and the badge's tooltip pass `c.em`.
  - The badge itself is phase 1's; the playable row was already a cost zone.
  - Lua rules: no new main-chunk locals, no locals in for-in bodies, plain finds only, no buttons added.

## Tests

- **Harness `CostBadgeTest`: 14 of 14.** It is in `engine/checks/harness-tests.sh`'s defaults. Checks:
  - flashback `{2}{R}`, and Thalia's tax on it `{3}{R}`;
  - escape `{R}{R}`;
  - foretell `{1}{U}`, printed `{1}{U}{U}`;
  - plot `{0}`;
  - Kess's permission `{R}`;
  - no cost for a plain graveyard card, or in the other seat's view;
  - Goblin Electromancer on a flashback cost and on a hand cost;
  - Helm of Awakening taking Sol Ring to `{0}`;
  - a delve card and an assist card in hand priced within 60 s, with no question;
  - none on a hand card.
- **The whole harness suite (44 classes).**
  - `SharedTurnsPlayTest` failed once: an AI game had no combat where both partners attacked.
  - On a rerun it passed, both on this tree and on main's. It is an AI game's chance, not this change.
  - Every other class passed.
- **`node tests/test_bridge_cost_badge_2.js`: 23 of 23, in GATES.** Bridge checks:
  - every way;
  - a permission at the printed cost (no badge);
  - a free cast (no way named);
  - `effectiveManaCost` first;
  - the foretold card's words and no badge fields;
  - the public piles;
  - no permission;
  - `costNow` alone.

  Table checks on fengari: the hover words with and without a way, and both callers passing `em`.
- **Break-its:**
  - `node tools/mutate-cost-badge-2-engine.js <tree>`: 13 of 13 caught by name.
  - `node tools/mutate-cost-badge-2.js`: 15 of 15 caught by name.
  - Every file is restored by sha256.
  - The first engine run missed two:
    - **The foretell/plot exile shortcut:** redundant, because Forge restricts those spells to exile already, so the
      code was removed.
    - **The delve guard:** the delve chooser doesn't ask, so the check now uses an assist card, which does.
- **Regression:**
  - `test_table_map` 645.
  - `test_bridge_claims` the same as on `main` (one check, "live files guard", fails on both trees).
  - The GATES against `origin/main`, both trees run here: the same result for every gate except `test_table_map` (631 → 645, the three new entries) and the new `test_bridge_cost_badge_2`. The gates that need the Workshop save fail to build on both trees.

## Not done

- No image, no live game.
- A card with two ways from one zone shows the first one Forge lists.
- A split or adventure card's second half is not priced.
- Non-mana parts of a cost are not shown (escape's exiled cards).
- The badge's place on a playable row card is phase 1's estimate (`BADGE.cost`).

## For the real table

1. Faithless Looting in the graveyard should show a red rim with 2 over its generic spot, and the hover "Costs {2}{R}
   now by flashback (printed {R})".
2. A foretold card in the row should have no badge, and its hover should give the foretell cost.
3. Under Goblin Electromancer, a hand instant should now show a green badge (it showed none before).
