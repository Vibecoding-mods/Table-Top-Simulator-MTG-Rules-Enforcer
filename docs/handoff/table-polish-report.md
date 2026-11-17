# Report: table polish (scheme shape, the ∞ sign)

Cloud session, 2026-11-17, branch `cloud/table-polish`, from `origin/cloud/owner-decisions-1117` (`e819680`). Table
code only: `tools/engine-renderer.lua`. No bridge, engine or XML change.

## 1. Schemes at the scheme card's shape (Archenemy plan step 10)

**The real shape.** Scheme cards are oversized, about 8.9 × 12.7 cm, as Planechase planes are.

- Unlike planes, they are upright (portrait), not landscape. (The task said "6.3 × 8.8 cm landscape": 6.3 × 8.8 is a
  normal card, and schemes are oversized upright cards.)
- So schemes take the plane path's larger size, but not its 90° turn.
- Their ratio (88.9 / 127 ≈ 0.70) is close to a TTS card object's (63 / 88 ≈ 0.72), so a uniform scale keeps the
  picture's shape.

**What changed.**

- **One function, `engineZoneScale(zone)`,** gives the size for every zone. It is used both where a card is spawned
  (`place`) and where a card already on the table is updated each board.
  - Before, the spawn path knew only planes and attached cards. The scheme set in motion was drawn at scale 1 when it
    first appeared, and 1.5 only from the next board on.
  - The ongoing row and the deck stand-in were always scale 1.
- **Sizes:**
  - planes, 1.5 and turned, as before;
  - the scheme set in motion, each ongoing scheme and the scheme-deck stand-in, `ENGINE_SCHEME.scale` = 1.4 (the
    oversized width over a normal card's);
  - attached, linked, revealed and suspended cards, small as before.
- **Place:** the spots are unchanged.
  - Using the TTS card size at scale 1 (about 2.2 × 3.1), the row keeps a gap: 3.4 apart against 3.15 wide.
  - The row and the deck stay more than half a unit clear of the scheme set in motion.
  - The schemes, 0.42 of the way to the archenemy's mat, stay clear of a plane at the centre. A plane reaches about
    1.7 from the centre; the scheme set in motion starts about 6.2 from it, with a mat 20 away.
  - They stay clear of the stack, which floats over the caster's own mat.
  - Attack lines arc over the table (0.3 plus a rise with distance), so they pass above the flat schemes.
- **Picture and back:**
  - The picture comes from the bridge's usual Scryfall lookup by name, as for any card (`cachedImage`).
  - The deck stand-in still uses the table's normal card back. A real scheme back would need its own image URL.

**Tests:** `tests/test_table_archenemy_view.js`, 47 of 47 (fengari, no save).

- Its old check, which matched `plane or schemenow ... 1.5` in the source, is replaced by checks on
  `engineZoneScale` itself:
  - every scheme zone 1.4, a plane 1.5, others as before;
  - both scale paths use it;
  - schemes are never turned;
  - the gaps above at that size.
- The drawing checks' positions are unchanged: the spots didn't move.
- No golden scenario has schemes, so the table golden doesn't change.

## 2. The "x∞" sign

**Can TTS draw ∞? It can't be confirmed from here.**

- The table's button labels, and the life counter's number, are drawn by TTS's object-button font. No font file ships
  with the table or the repo.
- The non-ASCII characters in the renderer are mostly box-drawing in comments. The ones that reach the screen are `×`
  and `—`, plus `●` in a UI XML text; none is from the Mathematical Operators block that ∞ (U+221E) is in.
- The code already said "not yet seen on real TTS", and PLAN's real-table checklist lists "the ∞ badge".

**So the fallback is behind one switch.**

- `ENGINE_INF = { glyph = "∞", fallback = "INF", ascii = false }` and `engineInfText()`.
- Every ∞ the table draws now goes through it:
  - the token stack's "x∞" badge (now `"x" .. engineInfText()`);
  - `engineCompact`'s "∞" / "-∞" at the engine's cap, used by the life counter and the counter and P/T badges.
- `engineLifeLook` counts the letters of either form, so the life counter's font stays right: "INF" fits the
  counter's own font, and "-INF" is four letters and gets a smaller one.
- **The default stays the sign.** The table tests that pin "∞" (`test_table_stress_caps`, `test_table_trigger_groups`)
  need the TTS save, so they can't be rerun here.
- If the real table shows a box, the fix is one line: set `ENGINE_INF.ascii = true`. PLAN's checklist now says so.

**Tests:** `tests/test_table_inf_glyph.js` (new, in GATES), 14 of 14 (fengari, no save).

- Both settings: the sign, the cap and minus the cap, the life counter's letters and font, and numbers under the cap
  unchanged.
- No other ∞ in the table's code (comments aside).
- The token badge goes through the function.
- The default is the sign.

## Break-its

`node tools/mutate-table-polish.js`: **13 of 13 caught by name**, the renderer restored by sha256.

- **Scheme shape:**
  - only the scheme set in motion large;
  - schemes at a normal size;
  - the plane's size tied to the schemes';
  - a spawned card left at scale 1;
  - an existing card not resized;
  - schemes turned as planes;
  - the row too tight, or against the scheme set in motion.
- **The ∞ switch:**
  - the switch ignored;
  - the cap's sign as a literal;
  - the badge as a literal;
  - the sign counted as three letters;
  - the fallback as the default.

## Lua rules

- **Main-chunk locals:** 189, as before (limit 200). `ENGINE_INF` and `engineZoneScale` are globals, and the scale
  lives in `ENGINE_SCHEME`.
- **Loops:** no bare `local x` in a for-in body. The new `local zs` is in `place`'s body, outside any loop.
- **String functions:** plain find only (`string.find(label, ENGINE_INF.glyph, 1, true)`).

## Gates

- **Run here:** 62 of 100 deploy GATES pass, the two new and changed tests among them.
- **Not run, they need the TTS Workshop save** (36), among them:
  - `test_table_golden` (its build step), `test_table_claims`, `test_alignment`;
  - `test_table_stress_caps` and `test_table_trigger_groups`, which pin "∞" and stay valid since the default is
    unchanged;
  - `test_table_archenemy_lua` passes here; `test_moonsharp_loop_locals` needs the save (the main-chunk count was
    checked by hand above);
  - `test_ui_budget` and the rest of the `test_table_*` gates.
- **Environment failures:**
  - `test_bridge_claims`: its live files guard fails on the unchanged base here too.
  - `test_editor_forward`: no IPv6.
- **Not done:** no real-table look at the schemes' size or at ∞.

## Left

- On the real table: look at an Archenemy game's schemes (the size, the gaps, the picture's shape at 1.4) and at a
  stack of infinitely many tokens and a life at the cap. If ∞ draws a box, set `ENGINE_INF.ascii = true`.
- A real scheme card back for the deck stand-in, if one should show.
