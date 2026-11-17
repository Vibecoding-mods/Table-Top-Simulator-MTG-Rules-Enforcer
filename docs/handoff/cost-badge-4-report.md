# Report: the cost badge, phase 4 (what a way costs besides mana, the tie-break)

Cloud session, 2026-11-17, branch `cloud/cost-badge-4`, from `origin/main` (f4f614d). Engine tag
`engine1121-costbadge4`, on top of `engine1121`. Not built as an image, not deployed. The items are from
`docs/handoff/open-after-1121.md` §3, "Cost badge".

## What changed

**The hover says what a way costs besides mana.** It uses Forge's words (`CostPart.toString()`), joined with ", ".

- **The way cast now** (`CardDto.playCostExtra`, new, optional), in the playable row only:
  - "Escape also costs: exile eight other cards from your graveyard." (Ox of Agonas)
  - "Flashback also costs: sacrifice three creatures." (Dread Return's flashback reads {0}; this line says why.)
  - A permission or a free cast doesn't name a way: "Casting it also costs: pay 3 life."
- **Each other way** (`SpellCostDto.extra`, new, optional): "Other ways to cast it: {1}{R} by flashback, and pay 3 life".
- **Each half in hand:** "Stomp: costs {2}{R} now (printed {1}{R}), and pay 2 life".
- **Unchanged:**
  - The badge is still mana only.
  - The public graveyard pile says none of it.
  - No Lua or XML change: the table draws hover lines (`nt`) as before. `table-map.js` maps `playCostExtra` to `nt`.

**The tie-break for "cheapest"** (`PlayCost.cheapest`):

1. A lower mana value wins, whatever else the way costs. Life and cards aren't turned into mana: 3 life means
   something different at 40 life and at 3. The hover now says both, so the player can choose.
2. On equal mana value, the way with fewer non-mana parts wins.
3. Then the one that pays less life.
4. Then Forge's order, as before.

So beside Kess, Flash of Defiance shows the plain cast at {1}{R}. The flashback ({1}{R} and 3 life) is listed under
"Other ways".

**Files**

- **Protocol:** `manabrew-protocol` `game/mod.rs` (`SpellCostDto.extra`, `CardDto.play_cost_extra`).
  - The full `CardDto` literal in `manabrew-agent-interface/src/game_view_dto.rs` gains `play_cost_extra: None`, as
    engine1121 taught.
  - `cargo check` fails with E0063 when that line is removed. This was checked by hand: the line was removed, then
    restored and verified by sha256.
- **Harness:**
  - `PlayCost.java`: `Way` carries the extra's words, its part count and its life. Adds `cheapest`/`cheaper`,
    `extraOf`, `partsOf` and `lifeOf`.
  - `InteractiveSnapshotExtractor.java`: `playCostExtra`.
  - `CostBadgeTest.java`.
  - No comments in the harness Java.
- **Bridge:** `bridge.js` `spellCostNotes` (and `lowerFirst`); `table-map.js`.
- **Patches:**
  - `engine/manabrew.patch` was regenerated. Exactly those five engine files differ from main's patch.
  - `engine/forge.patch` is unchanged.
  - `git apply --check` is clean on `fd16e2f` / `e7d2b93b`.
- **Docs:**
  - `docs/engine-changes.md` (a table row and a section);
  - `docs/cost-badge-spec.md` (Phase 4);
  - `docs/handoff/open-after-1121.md` §3 (marked done).

## Tests

- **`CostBadgeTest`: 29 of 29.** The 7 new checks:
  - Ox of Agonas's escape;
  - Deep Analysis's life;
  - Dread Return's sacrifices at {0};
  - Twinned Vision's discard;
  - Faithless Looting with nothing extra;
  - Flash of Defiance beside Kess: the plain way, with the flashback listed with its life;
  - a unit check of `PlayCost.cheapest` on built ways: plain over life, fewer parts, less life, mana value first, and
    Forge's order on a full tie.
- **The full harness suite** (`engine/test-harness-local.sh --all` on the patched tree, rebuilt): 46 classes passed,
  none failed. SharedTurnsPlayTest, the known flaky one, passed this run.
- **`tests/test_bridge_cost_badge_4.js`** (new, in the deploy GATES): 12 of 12.
- **The deploy GATES that run here:** 60 of 98 pass, including every cost-badge, bridge-golden, `test_table_map` (667)
  and `test_state_delta` gate.

## Break-its (each fails by name; files restored by sha256)

- **`node tools/mutate-cost-badge-4-engine.js <tree>`: 9 of 9.** The mutations:
  - the extra's words dropped;
  - the mana part counted as extra;
  - `playCostExtra` not sent;
  - an other way's `extra` not sent;
  - mana value not first;
  - no tie-break by parts;
  - no tie-break by life;
  - a tie going to the last way;
  - more parts preferred.
- **`node tools/mutate-cost-badge-4.js`: 9 of 9.** The mutations:
  - the extra line not said;
  - the way not named;
  - a permission named as a way;
  - Forge's capital kept mid-sentence;
  - an other way's extra not said;
  - an empty extra said as ", and";
  - a half's extra not said;
  - the extra on the public pile;
  - `table-map` not mapping `playCostExtra`.
- **Older break-its updated for the changed code, both still all caught:**
  - `tools/mutate-cost-badge-2-engine.js`: "the first way, not the cheapest" now breaks the new comparison. 24 of 24.
  - `tools/mutate-cost-badge-3.js`: "an other way's way not said" matches the new line. 11 of 11.

## Not covered

- **An alternative-cost permission's extra:** no test card has one, so no break-it either.
- **A half's extra in hand:** the bridge test has it; the engine test doesn't.
- **The life count from a real card on a tie of parts:** only the unit check on built ways covers it.
- **A hand card's additional costs** (kicker, a hand spell's own sacrifice) still aren't said. `effectiveManaCost` is
  mana only, and this task covered the ways from a graveyard or exile and the halves.

## Gates not run here

- **The table gates and anything that builds the table** (36 of the GATES). They need the TTS Workshop save
  (`Mods/Workshop/2296042369.json`), which isn't in this container. They include:
  - `test_table_*`, `test_alignment`, `test_engine_json`, `test_card_other_side`, `test_moonsharp_loop_locals`,
    `test_rejoin_prompt`, `test_bridge_big_turns`, `test_table_golden` (its build step);
  - `test_ui_budget`.
  - No Lua or XML changed, so none of them should move.
- **`test_bridge_claims`:** 1497 pass, and 1 fails, the live files guard (`tmp/table-log.log`). It fails the same way
  on the unchanged base here.
- **`test_editor_forward`:** this container has no IPv6 (`listen EAFNOSUPPORT ::1`).
- **No native image** was built, and no live game was played.

## Left

- Build `engine1121-costbadge4` as an image and deploy.
- In a live game, check the hover on Ox of Agonas, Dread Return and Flash of Defiance beside Kess.
- Run the table gates where the Workshop save is.
