# Report: stress catalog, second batch (A to G)

Cloud session, 2026-11-17, branch `cloud/stress-catalog-2`, from `origin/main` (f63de76).

- Bridge and table only. No engine patch changes.
- Not tried on the real table or against a live engine.
- The list is the peer's message of 2026-11-17. `docs/stress-catalog.md` was not committed when this was written; it is in the repo now (2026-11-27).

## The seven items

**A. Keep the same targets ×N for copies** (`bridge.js`: `offerKeepTargets`, `copyKeepOf`, `keepFits`, `keepEnd`;
`seat.keepTargets`).

- **The question:** Storm, Thousand-Year Storm and the like ask "You may choose new targets for the copy" once per
  copy. Each comes as a target question with no card. The first of several now asks first: "N copies of Flusterstorm:
  keep their targets?", with **Keep targets for all ×N** and **Choose each**.
- **Keep targets for all ×N** answers this copy and the next ones unseen, with the copied spell's targets as the
  question offers them. A spell is offered by its card's id.
- **Choose each** asks this copy's targets as usual, and the next copy asks again.
- **How N is counted:**
  - for a storm spell, the storm count less the spell itself and the copies already on the stack;
  - otherwise unknown: **Keep targets for all copies**, offered when the resolving stack item copies "for each"
    (Thousand-Year Storm).
  - With one copy (N = 1, as Twincast makes), nothing is offered.
- **When it stops**, the rest are asked as usual and one chat line says why:
  - a copy's targets differ from the first one's, or aren't offered;
  - another question comes;
  - a priority comes;
  - the step changes.
- **One chat line at the end:** "You kept the targets of 3 copies of Flusterstorm."
- **A label fix found on the way.** A storm copy of a spell that targets a spell was named after its target: a
  Flusterstorm copy on Chart a Course read "Copy of Chart a Course". The newest spell's own target is now taken as the
  spell being copied only when that spell copies a target spell (Twincast), or when its words aren't known (Flare of
  Duplication as the engine sent it). The golden still matches.

**B. Pick-many questions** (`addQuickPicks`, `quickPicked`).

- **All and None:** a question with 3 or more options, any number of which may be picked (none to all), gets
  **All (N)** and **None**.
- **All of a name:** past 100 options, it also gets **All <name> (k)** for each name that k options share, when k may
  be picked. For example, 120 Goblin tokens.
- **How they answer:** they are quick buttons. The table already answers a `__` option in a pick-many question by
  itself. The bridge turns one into the picks it stands for before the count and option checks.
- **Not for:** blockers (each option is a pair), attackers (they have their own All attack), a scry's layout, or
  smaller questions.
- **Narrowed during the work:**
  - The first version added None to every "up to N" question, which changed 76 golden scenarios.
  - Limited to "any number from none to all" and 3 or more options, no golden scenario changes.
- **The table side was already there:** the renderer pages 29 at a time with a search box (POOL = 30), and quick
  buttons come first.

**C. Scry and surveil past 5 cards** (`scryAllOptions`; the renderer's `engineScryCard`).

- **What changed:** past 5 cards, the question offers **All on top** and **All on the bottom (N)** (surveil: **All
  into the graveyard (N)**). This applies:
  - in the table's two-zone layout, which is how a plain scry or surveil comes;
  - in `scryPlaceSteps` (three or more zones, one question per card), on the first card's question.
- **After it:** All on top goes on to the order question, where Keep this order keeps the library's order.
- **The peer's note was partly off:** a plain scry or surveil isn't asked one card at a time; `scryPlaceSteps` only runs
  for three or more zones. Both now have the shortcut.
- **Table change:** the two-zone layout lays every option out in the second hand zone as a card. The scry code now
  leaves the quick buttons out of it (`engineScryCard`, used in `engineScryHeld`, `engineScryPlace` and the
  last-card check).

**D. Big hands** (renderer: `engineHandPlace`, `engineHandMoreClick`).

- **The layout:** the first 40 hand cards (`ENGINE_HAND_SHOW`), in the engine's order, are laid out in the hand zone.
- **The rest:** one **+N more in hand** card beside the library. Its button opens the Engine panel on its answers,
  which play every card in the hand.
- **A big draw:** at most 12 new hand cards spawn a frame (`ENGINE_HAND_SPAWNS`), with one redraw a frame for the rest.
- **The hand counter** keeps the engine's count (`engineHandCount`, unchanged; checked).

**E. The effects hover** (`EFFECT_HOVER = 20`).

- The "+N MORE EFFECTS" box's hover lists 20 texts, then "... and N more". It was 8.
- **An older test updated:** `test_bridge_stress_caps` expected 8. It now checks 20 on 30 effects. Its break-it in
  `tools/mutate-stress-caps.js` follows the new name, and is still caught.

**F. The number picker and combat damage.**

- **The number search** (the renderer's `optionList`):
  - it looks at most 100,000 numbers (`ENGINE_NUMBER_SCAN`);
  - the number typed comes first when it is in range, and isn't listed twice;
  - a typed number out of range isn't offered.
- **Combat damage** (`damageSteps`): one pick is at most 999,999 (`DAMAGE_PICK_MAX`). What is left after the others
  still goes to the last one, so all of an attacker's 2^30 damage is assigned.

**G. The largest state each game** (`noteLargest`, `saveLargest`).

- **What is measured:** the board with the most cards (every zone, a library by its count) plus stack items that any
  seat was sent. It is kept with its battlefield, stack, biggest hand, turn and time.
- **GET /stats:** `largest` is this game's so far; `games` holds the last 20 games.
- **The log:** said once as each game ends, at a reset or a new game started over it.

## Lua rules

- **No new main-chunk locals:** `tools/lua-scan.js` gives 175 locals before and after. The new names are globals
  (603 → 609).
- **No bare `local x` in a for-in loop body.**
- **No pattern `find` or `sub`:** the only `sub` is the plain `tostring(o.id):sub(1, 2)` the renderer already uses for
  quick buttons.
- **It parses:** checked with fengari.

## Tests

- **`tests/test_bridge_stress_catalog2.js` (new): 50 of 50**, for A, B, C, E, F and G.
  - **A:** the Flusterstorm storm case as hp-08 sent it (the golden case's shapes), Thousand-Year Storm on Shock.
  - **B:** Living Death's "exile any number of creature cards" as a `chooseCards` question, and the golden case's
    blockers.
  - **C:** scry 8, surveil 8 and a three-zone look at 8.
- **`tests/test_table_stress_catalog2_lua.js` (new): 18 of 18**, for D, the table half of C, and F's number search.
  - It takes the functions from `engine-renderer.lua` as written and runs them in fengari with stubs, as
    `test_table_archenemy_lua` does.
  - Each run has a budget of Lua instructions, so a search that runs away fails its check instead of hanging.
  - The full table tests need the TTS workshop save, which a cloud session doesn't have.
- **Both are in `tools/deploy.js` GATES.**
- **The gates here:**
  - Every gate that runs without the TTS save passes, with three exceptions that fail the same way without these
    changes:
    - `test_bridge_claims`: a live-files guard check;
    - `test_table_map`: "unbounded is still a CardDto field";
    - `test_editor_forward`: this container has no IPv6.
  - `test_bridge_golden`: all 1084 scenarios match, no recapture.
  - The gates that need the TTS save weren't run.

## Break-its

`node tools/mutate-stress-catalog2.js`: 39 mutations. **39 caught by name, 0 survived.** The real files were checked by
sha256 after each, and the copies removed.

- Each one must fail the check it names. A failure of some other check doesn't count.
- About 1 minute in all.

| Item | Mutations | Caught by |
| --- | --- | --- |
| A | no keep question; the next copies asked again; targets that differ kept anyway; the storm trigger counted as a copy; a storm copy named by its target; no end line; a priority doesn't end it; Thousand-Year Storm not seen | "A copies: the first copy asks keep or choose each", "... the next two copies are answered unseen", "A differ: ...", "... the keep button counts the copies", "A choose each: the copy is named by its own spell ...", "... one chat line at the end", "A priority: ...", "A Thousand-Year Storm: no count, all copies" |
| B | no All/None; All/None for any question; a quick button sent as itself; no name buttons; name buttons at 10; a run over the most allowed offered; blockers get All | "B quick (any number)", "B quick (1 or more)", "B quick: All sends its picks", "B names: past 100 options ...", "... 100 options or fewer ...", "... a run over the most allowed gets none", "B blockers: ..." |
| C | no quick buttons; quick from 5 cards; the two-zone All ignored; the three-zone All taken as one card; every card's question offers All; a quick button laid out as a card; the held cards unfiltered | "C scry 8 ...: offers them all at once", "C scry 5: no quick buttons", "C scry 8 ...: sent at once", "C three zones ...: sent at once", "C three zones: the second card's question has none", "C a quick button is no scry card", "C the hand zone holds the cards ..." |
| D | every hand card laid out; 41 laid out; no more card; the more card a hand card; a big draw at once; no redraw; the panel not opened | "D 60 cards: 40 laid out ...", "... the hand's first 40 ...", "D the more card is no hand card", "D a big draw: 12 new hand cards ...", "D the more card opens the Engine panel ..." |
| E | the hover back at 8 | "E effects: 22 past the marks list 20 ..." |
| F | the damage pick and its answer unclipped; no scan limit; the typed number not first; a typed number out of range offered | "F damage: one pick at most 999,999", "F damage: a pick over it is clipped ...", "F past 100,000 numbers ...", "F a number typed in a huge range comes first", "F a number out of range isn't offered" |
| G | the largest not kept; a library not counted; said every time; not kept in the games list | "G largest: this game's so far ...", "G largest: said once in the log", "G largest: kept in the games list ..." |

**The first run hung.** Without the scan limit, the search over 0 to 2^30 ran in fengari for over 20 minutes. The Lua
test now has an instruction budget, and the check that catches it uses a range of 300,000 numbers.

## Left

- A look on the real table: the "+N more in hand" card's place beside the library, its button, and the scry layout
  with the quick buttons. Screenshots need TTS.
- A live game: the storm copies' questions as the engine really sends them, and the 999,999 damage pick.
- `docs/stress-catalog.md` itself, if it should be in the repo.
