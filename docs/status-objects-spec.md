# Status objects on the mat

**Asked 2026-11-10, the user:** "Add to the spec to add back in objects removed from the original board but they pop up
in with player status box too: if the box says monarch the crown spawns in on their mat. Also have relevant objects
hidden under the table with opacity at 0."

**Status:** built in source 2026-11-11 (`engineStatusPieces` in tools/engine-renderer.lua, the status-piece step in
tools/make-engine-copy.js, `addPieces` in tools/patch-save.js), not yet seen on the real table. It builds on the marks
boxes (one small green box a mark, stacked down the inner corner of each mat under the heart, `enginePlayerCounters`,
2026-11-10). Decisions taken while building:
- One copy a seat (copies of the original under new GUIDs, parked) for the poison, energy and experience counters, and
  also for City's Blessing and The Ring: the rules let several players have each of those at once. One crown, one
  Monarch card, one Undercity (one holder at a time). 23 pieces and Day // Night in all.
- The counters' own scripts go too (they only drew a 0); the table draws the count on the token itself.
- A seat's stack that would run past the mat's near edge (every piece at once under ten boxes does) is scaled down
  together to fit.
- A piece is hidden both ways: invisible to every colour, and the crown and tokens also at tint alpha 0.
- Day // Night lies at x 0 between the middle tile and White and Red's hearts, readable from that side, scaled to the
  1.8-wide gap between the mats. Its Night state is its own object in TTS (GUID cdf2d2); the table switches with
  `setState`, which costs one object swap a change of day or night.
- The deploy's save patch (`tools/patch-save.js`) only replaced the script, so it now also adds the pieces a save
  lacks; `tools/make-user-save.js` already carries every object of the engine table.

## What the user sees

- When a player's marks include a status that the original table had a piece for, that piece appears on their mat,
  in the same corner strip as the marks boxes, just under the last box. The box still shows; the piece is a picture
  of the same fact, not a replacement.
- When the status moves to another player (a new monarch, the initiative taken), the piece moves to that player's mat.
- When nobody has it any more, the piece goes back under the table, unseen.
- A table-wide status (day or night) sits in the middle of the table, between the four hearts' row and the setup tile.
- The pieces are pictures only. The rules engine owns the state: a piece is locked, can't be picked up, and clicking it
  does nothing (its own script, if it has one, doesn't run in engine mode; see "Scripts" below).

## The pieces (all from the original table, workshop 2296042369)

The engine-mode copy removed these as side clutter in `tools/make-engine-copy.js` (`CLUTTER_BOXES`, 2026-10-18). They
come back for this, parked, not on the table surface.

| Mark (bridge `PLAYER_MARKS`) | Piece | GUID | Kind | Notes |
|---|---|---|---|---|
| `MONARCH` | Monarch crown | 8963ec | Custom_Model, scale 0.6 | the user's example: "the crown spawns in on their mat" |
| `MONARCH` | The Monarch card | 197ab6 | Card | optional, under the crown; the crown alone may be enough |
| `INITIATIVE` | Undercity | 2db63a | Card, has a script (6.3 KB) | the initiative's dungeon; its room markers are not driven yet |
| `CITY'S BLESSING` | City's Blessing | cb418b | Card | |
| `RING TEMPTED n` | The Ring | d9fcbc | Card, has a script (2.7 KB) | the ring-bearer stays on the creature (the engine's mark) |
| day / night (table-wide) | Day // Night | 4e8c7b | Card with a second state, script (1.2 KB) | state 1 Day, state 2 Night, set by the engine's day/night |
| `POISON n` | Poison Counter | 94b67a | Custom_Token, scale 0.46 | the count as the token's number, if the token shows one; else the box only |
| `ENERGY n` | Energy Counter | da1b48 | Custom_Token, scale 0.46 | as poison |
| `EXPERIENCE n` | Experience Counter | 576ccd | Custom_Token, scale 0.46 | as poison |

**Left out on purpose:**
- The dungeon cards (Lost Mine of Phandelver df09d5, Dungeon of the Mad Mage d075c6, Tomb of Annihilation 91aaed,
  Baldur's Gate Wilderness d3959e). The engine renderer already draws the dungeon a player is in, as its own card
  ("dungeon D3", f75159a, live since 2026-11-06).
- Foretell (a043c2) and On an Adventure (c0d19f). Those are exile piles of cards, not player statuses. The exile
  research in progress decides how they show.
- The keyword markers (Flying, Deathtouch, ...), mana counters and dice. Card statuses, not player statuses; the
  engine's card text and glows already carry them.

One piece of each kind is enough for a 4-player game for everything except poison, energy and experience, which more
than one player can have at once. For those, either one token a seat (four of each, copied from the original under new
GUIDs, parked) or the box only. Decide when building; four of each is 12 more parked objects.

## Hidden under the table

- Each piece is parked under the table top: the copy writes it at its own spot but at `y = -30` (the same depth the
  Pirate Cannon is hidden at in engine mode; the cannon's memo `mtghome x y z lock` is the pattern for remembering
  where an object goes back to).
- "Opacity at 0": TTS has no single opacity call for every object kind.
  - Custom_Model and Custom_Token: `setColorTint` with alpha 0 makes them see-through. Use it on the crown and the
    counter tokens.
  - Cards: a tint's alpha doesn't make a card see-through. Use `setInvisibleTo` with every seat colour (and the
    spectator/grey) instead, which hides it from everyone, as if at opacity 0.
  - Both are set when parked and undone when shown, so a piece is never seen sliding up through the table.
- Parked pieces are locked, so physics never moves them and nothing lands on them.
- Engine mode off (the normal table): the pieces stay parked. The original manual table doesn't get them back on its
  surface; that's the user's call if wanted.

## Showing and moving a piece

- Driven by the same board update that draws the marks boxes: `engineRender` → for each player row,
  `enginePlayerCounters(tracker, row)`. A new function beside it, called from the same place, decides each piece's
  holder from the rows' `allMarks` (the monarch: the row whose marks include `MONARCH`; nobody: parked).
- **Move, never spawn.** The pieces already exist (parked). Showing one is `setInvisibleTo({})`, tint alpha back to
  1, then `setPositionSmooth` to its spot and lock. Spawning per change is what crashed TTS at high object counts
  (memory: live-spawning many decks, NVIDIA TDR), and moving an existing object costs nothing comparable.
- **Spot:** in the mat's inner corner strip (the free strip at the inner end of the battlefield rows, the mat's inner
  edge to a tapped card in column 0), centred across the strip, just under the last marks box with a gap of 0.3. More
  than one piece on a mat stacks down the strip in the order of the table above. Each piece is scaled to fit the
  strip's width (5.9 world units, less 0.3 each side) if it is wider.
- Facing: readable from the player whose mat it is (the mat's rotation + 180, as the engine's cards are placed).
- Redrawn only on a change of holder (or of day/night state, or of a counter's number), as the marks boxes are.
- The rewind button and a crash recovery redraw the board: the pieces follow the restored rows, nothing extra needed.

## Scripts

The Day // Night card, The Ring and Undercity have their own Lua. In engine mode a click must not change anything
(Undercity's buttons would move a marker the engine doesn't know about; the dungeon note in
`docs/table-functions-trackers-variants.md` warns that its `press<i>` spawns tokens). Either:
- the copy strips their `LuaScript` in the engine-mode copy (simplest; the normal table keeps the originals), or
- the copy keeps the scripts and the pieces are `interactable = false` while shown.

Pick the first unless one of those scripts draws something the user wants to keep seeing (The Ring's card text is on
the card face either way).

## Reset, rematch, reload

- `engineClear` (rematch / reset) and `engineCountersReset` park every piece, as they clear the marks boxes.
- A table reload: the pieces are in the save wherever they were. The first board update puts each where the rows say;
  with no game, the setup's heal loop parks any piece that isn't parked.
- Engine mode off: park all.

## Constraints

- No new main-chunk local in the renderer (~190 of 200 used): globals or fields of an existing table.
- The engine-mode copy keeps passing its existing gates; the 125-object clutter report changes to list these pieces
  as kept (parked), not removed.
- The 4-player table only; the parked 6-player table (`docs/m6-six-seat-spec.md`) is untouched.

## Checks to write (tests/test_table_claims.js)

- Precondition: each piece in the copy, parked (y -30), locked, hidden (invisible to every colour, or tint alpha 0).
- A row with `MONARCH`: the crown on that player's mat, inside the corner strip, under the last box, visible, locked.
- The monarch moves to another row: the crown on the new mat, gone from the old one; one crown on the table.
- Nobody has it: parked and hidden again.
- Day then night: the same card, state 1 then state 2, in the middle.
- Two players poisoned: either a token on each mat or none (whichever was built), never one token jumping between.
- `engineClear` parks all; a reload redraws from the rows; engine mode off parks all.
- Clicking a shown piece changes nothing in the engine and in the piece.
- Mutation pass on the new code, as for the marks boxes.

## Live check

Load the table, start a debug game, `mtg debug` a monarch card (Palace Jailer or Queen Marchesa) for White:
- the crown appears in White's corner under the MONARCH box;
- an AI takes the monarch by combat damage and the crown moves;
- after the game, Reset parks it, and nothing shows under the table from any seat's camera angle.
