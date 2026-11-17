# Report: custom card art past plain cards (DFC backs, tokens, the AI's decks)

Cloud session, 2026-11-17, branch `cloud/custom-art-2` from `origin/main` f63de76. Bridge and the table's chat and
deck reading only; no engine change and no new screen XML. Not tried on the real table. No permission prompt is
pending. The full description is in `docs/custom-art-spec.md`, in the new section "Built: DFC backs, tokens, the AI's
decks".

## The spec's open items, and what was built

| Open item (spec "Not yet") | Here |
|---|---|
| DFC backs | **Built, bridge + table:**<ul><li>`mtg ready` reads a card's second state (`n2`, `f2`);</li><li>the deck's other face is the card's back and its hand's other side, ahead of Scryfall's;</li><li>a transformed card shows that face, with the front as its back;</li><li>a player's back link is checked and said;</li><li>`mtg art back <card> <link>` gives a back while the importer can't.</li></ul> |
| Tokens made by the game | **Built:** `mtg art token <token name> <link>`, for the player's own tokens of that name. |
| The AI's decks | **Built:** a deck list pasted for an AI seat keeps its `#https://...` links (front, and a second for the back) under the table deck's rules. Its seat's message names them, and the AI's colour wears them. A table deck from an empty seat already did this. |
| The Card Importer's checks, its second `#link`, its DFC state kept with a link | **Not built.** The importer's script is in the Workshop save, which is not in this repository or this session, so its text can't be patched or tested here. This is the remaining gap for a DFC with its own front link imported from a deck list; `mtg art back` covers it meanwhile. |
| A Steam Cloud link | Already allowed on main (`artProblem`'s Steam Cloud check). |
| The real-table check | Not possible here. |

Everywhere:
- every link passes `artProblem`;
- a bad one falls back to the normal picture with a chat line;
- the host's `mtg art off` puts every kind away;
- the known-owner rule holds: a player's pictures never go on another player's cards.

## Tests (written first: the first run failed 26 of 43 before the code)

- **`node tests/test_bridge_custom_art_2.js`: 46 of 46, in GATES.**
  - DFC checks:
    - the deck's back and hand side ahead of Scryfall's;
    - transformed;
    - a player's front and back, and their chat lines;
    - art off for both, and for a player's back on a normal front;
    - a bad back link;
    - transformed with no Scryfall record (the deck's own name for the back face).
  - `mtg art back` checks: set, transformed, not another player's copy, a bad link, an unknown name, clear.
  - Token checks:
    - the player's own tokens;
    - not another player's, another token, or a non-token card;
    - the list;
    - art off;
    - a bad link, with the good one kept;
    - clear;
    - the usage line.
  - AI checks:
    - `parseDeckList`'s names and links;
    - `setAiSeat`'s message;
    - the AI's card, its DFC and transformed side;
    - a bad link;
    - not the human's copy;
    - art off.
  - Table checks: `cardInfo` on fengari (a plain card as before, a card's second state, a deck card's second state from
    the deck's images), and the chat passing `mtg art token|back` on as typed.
- **Break-it: `node tools/mutate-custom-art-2.js`: 28 of 28 caught by name**, every file restored by sha256.
  - The first run had two survivors, the transformed side not filed and art off keeping a player's back. Scryfall's
    face list in the test's cache covered for the first, and no case had a normal front with a player's back for the
    second. Three checks were added for them.
- **Regression:**
  - `test_bridge_custom_art` 54 of 54.
  - `test_table_map` 631.
  - `test_bridge_claims` the same as on `main`: one check fails on both trees ("live files guard", paths), not this
    change.
  - The 75 GATES against `origin/main`: GATES_RESULT.
- **Lua:** `cardInfo` and `engineChat` parse (luaparse).
  - No new main-chunk locals: `cardInfo` is an existing local, and its new `local`s are inside it, not in a for-in loop.
  - The chat checks `token` / `back` with plain `sub`.

## For the real table

1. **Second state:** a normal DFC import's second state should reach `mtg ready` (`n2`, `f2`).
2. **Pictures:** a DFC's back and its transformed side should show the deck's pictures.
3. **The chat commands:** `mtg art token Soldier <link>` and `mtg art back <card> <link>` should behave as above.
4. **AI decks:** a pasted AI deck list with links should show them.
