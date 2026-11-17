# Report: follow-ups 2 (Planechase and Archenemy)

Cloud session, 2026-11-17, branch `cloud/followups-2`. Not built into an image, not tried on the real table or a live
engine. No permission prompt is pending.

**Base:** `origin/main` f63de76, with `origin/cloud/archenemy-view` (98d838e) merged in, a fast-forward: that branch is
main plus one commit. Item 3's `game.schemesSeen`, `schemeNow` and the table's `engineSchemeSeen` exist only on
archenemy-view. This branch therefore holds that commit too, the one being merged on your side.

## 1. planar.ownerIds from the engine (`engine1117-planarowners`)

- **Engine** (`engine/manabrew.patch` only; no comments in the harness Java):
  - `PlanarStateDto.owner_ids`: plane id -> owner, left out when empty.
  - `Planechase.planarState` sends it from `Card.getOwner()`, the player whose planar deck the plane came from. A
    snapshot's plane card `ownerId` is its command zone's player, so it couldn't say.
- **Bridge:**
  - `logSnapshot` keeps the engine's owners in the planar block.
  - `logEvents`' 901.10 line takes the owner from the engine, from the board the plane was last on. Otherwise it uses
    the bridge's own tracking (who planeswalked to it, a trigger's `ownerId`, kept in the resume file), which stays for
    an engine without `ownerIds`.
- **Tests:**
  - **`PlanechaseTest`: 2 new checks, written first, red first.** After White planeswalks to Akoum from Blue's deck,
    the owner is Blue's and the controller White's. No `ownerIds` before a plane.
  - **The whole harness suite:** 43 of 43 classes pass.
  - **`node tests/test_bridge_planar_owners.js`: 6 of 6, in GATES, written first (4 red).**
    - a plane Blue walked to from AI 1's deck leaves with AI 1;
    - the engine's word over the tracking;
    - the owner from the board before;
    - an older engine, two checks;
    - the snapshot.
  - **Break-its:**
    - `node tools/mutate-planar-owners-engine.js <tree>`: 4 of 4 by name;
    - the bridge's part is in `tools/mutate-followups-2.js`.
- **Patches:** `git apply --check` clean on fresh `fd16e2f` / `e7d2b93b` worktrees, and they produce the built tree's
  files. `docs/engine-changes.md` has the row and section, and section 2's "optional follow-up" note now points to
  them.

## 2. The planar deck's order question (Norn's Seedcore and the like)

- **The cards:** Norn's Seedcore, Pools of Becoming, The Fertile Lands of Saulvinia and Spatial Merging put revealed
  planes and phenomena "on the bottom of your planar deck in any order".
- **The harness** asks that as a plain reorder titled with the source's name ("Arrange these cards in order.").
- **What the bridge's words did:**
  - Norn's Seedcore read "click the one that goes first", with nowhere said.
  - Pools of Becoming's was answered without asking, as a library's bottom is, because its text also puts a hand on
    the bottom of a library.
- **The fix:** a reorder of only planes and phenomena from a source whose text says "bottom of your planar deck" is
  asked in planar-deck words:
  - "Norn's Seedcore: these go to the bottom of your planar deck: click the one that comes up first", then "next";
  - the hint: "The one you click first is nearest the top of your planar deck: it comes up first of these."
  - A planar deck is ten or so cards, so this order is the next planes'. A library's bottom is still kept without
    asking.
- **The direction is from Forge's code, not a run:** `DigUntilEffect` and `ChangeZoneAllEffect` move the ordered cards
  to position -1 one by one, so the first ends nearest the top.
- **Tests:** `node tests/test_bridge_planar_order.js`: 11 of 11, in GATES, written first (6 red).
  - Seedcore: asked, the words, the hint, the cards, next, and the answer in the order clicked.
  - Pools of Becoming's planar order asked, and its hand's library bottom still kept.
  - Spatial Merging.
  - A mixed list not taken as a planar deck's.

## 3. Archenemy across a bridge restart

- **Bug:** `game.schemesSeen` and `game.schemeNow` were not in the resume file. A restarted bridge counted `seq` from
  1 over the schemes still in play, so the table (which shows the banner once per seq) showed an old scheme's banner
  again and skipped the next one's.
- **Fix:**
  - `saveResume` saves both: the set as a list, `schemeNow` as it is.
  - `resumeGame` restores the set. A save from before this change resumes as before.
  - `schemeView` saves the resume file when a scheme arrives or leaves the command zone, after dropping the ones gone.
    A restart right after a scheme still knows it, and a scheme that went back under the deck is new again when it
    comes out.
- **Tests:** `node tests/test_bridge_archenemy_resume.js`: 11 of 11, in GATES, written first (red).
  - The save: written on a new scheme and on one leaving, with the schemes seen and the scheme set in motion.
  - The resume: the set back as a set, the same schemes keeping seq 3, the next scheme seq 4.
  - An old save.

## Break-it (bridge): `node tools/mutate-followups-2.js`: 16 of 16 by name

- Every file is restored by sha256.
- The first run had three misses, all mutations that couldn't be seen. They were rewritten:
  - an extra save that didn't move the real one;
  - a match that wasn't unique;
  - a list reversed without its answer.
- The checks were not changed.

## Regression

- The GATES against `origin/main`, both trees run here: the same result for every gate except:
  - `test_table_map` 631 → 637 (archenemy-view's map entries);
  - the four new tests, all passing: `test_table_archenemy_view` (from that branch), `test_bridge_archenemy_resume`,
    `test_bridge_planar_order`, `test_bridge_planar_owners`.

  The gates that need the Workshop save fail to build on both trees.
- `test_bridge_events` 602, `test_bridge_planar` 27, `test_table_archenemy_view` 40, `test_bridge_trigger_groups` 25,
  `test_table_map` 637, all passing.
- No Lua or XML change.

## Not done

- No image, no live game.
- The planar order's direction is read from Forge's code, not seen in a game.
