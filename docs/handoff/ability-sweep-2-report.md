# Report: ability sweep follow-ups

Cloud session, 2026-11-17, branch `cloud/ability-sweep-2`, from `origin/main` (f63de76).

- **Bridge only:** no engine patch changes, and no screen XML (`test_ui_budget` passes).
- Not run on the real table or against a live engine.
- Full status per item: `docs/ability-sweep-spec.md`, "Follow-up status, 2026-11-17".

## INV-1 and INV-8

Each was reproduced first with the spec's own example in Forge's shapes. Most of both was already fixed and tested (the
Kykar items); the rest was still open.

**INV-1: a life loss names its source.** Fixed now for what the boards can't read.

- **The gap:** with metalcraft, Galvanic Blast at AI 1 still read "AI 1: 38 -> 34 life (-4)", even when the engine sent
  its own damage entry naming the spell.
  - `damageNews` reads damage only from the boards and a spell's "deals N damage" words, and its comment still said
    "Forge sends no damage event".
  - Since engine1112 the feed does send them (`kind: "damage"`: source, player, amount, combat). The bridge used them
    only for the table's bolt effects.
- **The fix:** when the board reading found nothing for a player, the life line takes that player's feed entries, each
  with its source:
  - "damage from Galvanic Blast";
  - an X spell's amount;
  - "Impact Tremors ×3" for triggers that came and went between two boards;
  - "combat damage from Hill Giant".
- **Still bare, rather than guessed:**
  - a source the bridge has never seen;
  - entries that don't add up to the loss (another kind of loss too);
  - an older engine with no feed.
- **Unchanged:** the board's own reading still wins (Lightning Bolt, drains, pain lands, life paid, prevention and
  redirects), and pain lands and paid life aren't counted twice.

**INV-8: a cast line names its target.** Fixed now for spells on the stack.

- "Blue casts Counterspell" at the AI's Lightning Bolt named nothing: `targetWords` left out Forge's spell targets. It
  now reads "Blue casts Counterspell targeting Lightning Bolt".
- Creatures, players, two targets (Prey Upon) and the AI's casts were already named; checked again.
- **One golden scenario was recaptured,** as intended: `hp-08 gap: log: storm copies, an unless counter, the AI's loot`
  now reads "Blue casts Flusterstorm targeting Chart a Course". The other 1083 are unchanged.

## The spec's other open items

- **Finding 5, Fact or Fiction's split:** fixed now.
  - Forge's three pile titles ("Divide cards into two piles", the left pile, the face-down pile) now read "Fact or
    Fiction: split 5 cards into two piles: pick the cards for pile 1". The text adds: "The cards you pick are pile 1;
    the rest are the other pile (either may be empty). AI 1 chooses one pile next."
  - It also carried the library-search hint and table data, because the revealed cards are in no zone the player sees.
    That hint was wrong and is gone.
- **Finding 8, an edict's sacrifice:** already fixed ("Craw Wurm is sacrificed (Diabolic Edict)" from Forge's cause),
  checked again.
- **Findings 1, 2, 3, 4, 6, 7, 9, 10, 11, 12 and 13, and INV-2 to INV-7 and INV-9 to INV-13:** already fixed, each with
  a test in `test_bridge_events` or `test_bridge_claims` (the Kykar items). Probed again here with the spec's examples:
  - own Counterspell on own Shock;
  - Pyroclasm's survivor;
  - Icy Manipulator;
  - Chaos Warp to the owner's library;
  - Esper Sentinel's {X};
  - Fact or Fiction's revealed cards.

## Tests

- **`tests/test_bridge_ability_sweep2.js` (new, in the deploy GATES): 27 of 27.** It covers INV-1, INV-8, and findings 5
  and 8.
- **Golden:** `test_bridge_golden` 1084 of 1084, after the one recapture.
- **Events:** `test_bridge_events` 602 of 602.
- **Every gate that runs without the TTS save passes, with three exceptions** that fail the same way without these
  changes:
  - `test_bridge_claims`: a live-files guard check;
  - `test_table_map`: "unbounded is still a CardDto field";
  - `test_editor_forward`: this container has no IPv6.
- **The gates that need the TTS save** weren't run.

## Break-its

`node tools/mutate-ability-sweep2.js`: 10 mutations on a copy of `bridge.js`. **10 caught by name, 0 survived.**

- **INV-1:**
  - the feed ignored;
  - the feed added to the board's own reading;
  - combat said as plain damage;
  - an unnamed source named;
  - another player's entries counted.
- **INV-8:** spell targets left out.
- **Finding 5:**
  - the pile titles not read;
  - the library search kept;
  - who chooses not said;
  - the face-down pile read as pile 1.

## Left

- **The spec's invariant checker** (`tmp/log-invariants.js`) was never committed, so no live log has been re-checked
  with it. A game on the real table with the new bridge, and that checker brought into the repo, would confirm INV-1
  and INV-8 there.
- **An older engine without the damage feed** still leaves amounts its words don't give (metalcraft) bare.
