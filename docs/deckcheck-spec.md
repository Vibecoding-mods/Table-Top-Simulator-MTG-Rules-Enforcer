# DeckCheck links: import, bracket and threat level

Status 2026-11-15: spec. The headless part is being built first; the TTS part comes later.

## What the owner wants

1. The table's Card Importer accepts DeckCheck deck links (`deck <link>` in chat, like Moxfield and Archidekt).
2. When engine mode is on and before a game starts, a deck imported from DeckCheck shows its **bracket** and
   **threat level** next to its commander.

## The API (https://deckcheck.co/docs/api, read 2026-11-15)

- `GET https://deckcheck.co/api/external/deck?deck_id=<id>` (or `deck_url=<url-encoded link>`). It needs **no API key**.
- Links: `https://deckcheck.co/app/deckview/<id>`, `/app/decklist/<id>`, `/app/builder/<id>`. The id looks like
  `sBid_JEUQZ4D`.
- Fields used:
  - `name`, `format`, `publicUrl`;
  - `bracket` (integer, Commander only, else null);
  - `threatIndex` (integer 0 to 96, "DTI", Commander only, else null), also as `dti.score` / `dti.maxScore`;
  - `boards.commanders.cards` and `boards.mainboard.cards`: objects keyed by `deckCardId`, each with `quantity`
    and `card.{name, scryfallId, setCode, collectorNumber}`.
- Errors come as JSON `{"error": "..."}`:

  | Status | Meaning |
  | --- | --- |
  | 400 | bad link |
  | 403 | private deck |
  | 404 | no such deck |
  | 429 | rate limit (10 requests/s per IP without a key) |
  | 500 | server error |

- Terms:
  - Allowed: read-only display of public deck data in a user-facing product.
  - Not allowed: scraping, bulk download, mirroring or redistributing their data, embedding keys.
  - So:
    - one request per import, with no key;
    - no stored cache beyond the deck object the import creates;
    - no recorded DeckCheck responses in the public repo (test fixtures are hand-made, same shape, made-up
      deck);
    - credit DeckCheck in README "Credits" and THIRD-PARTY-NOTICES, "not affiliated".

## Design

### Import (TTS, later)

The importer already fetches Moxfield JSON in Lua (`WebGetSSL`, then `spawnDeckEntries` with `scryfall_id` entries,
commanders first). DeckCheck goes the same way:

1. `Importer.Deck` sees `deckcheck.co/app/(deckview|decklist|builder)/<id>`. Our patch (tools/make-engine-copy.js)
   adds the host next to moxfield/archidekt.
2. It GETs the `/deck` endpoint and turns the response into entries, with commanders first, then mainboard, each
   `quantity` times, keyed by `scryfallId`. It then spawns them through the existing `spawnDeckEntries`.
3. The deck's name is the DeckCheck name. The spawned deck records `{source="deckcheck", id, bracket, threatIndex}`
   in its GM notes as a tagged line, so it survives a save and costs no second request.
4. Errors are said in plain words in chat, for example: "That DeckCheck deck is private: make it public or
   unlisted on DeckCheck and try again."

### Bracket and threat level next to the commander (TTS, later)

- Engine mode is on and no game is running: for each seat whose deck carries a DeckCheck tag, a small label sits
  next to the commander zone: `Bracket 3 · Threat 54/96`.
- The label is hidden when the game starts, and shown again after the game ends and before the next one.
- No tag (any other source): no label. We don't estimate brackets ourselves.
- In 2HG and team modes, each player's own deck shows its own label.

### Headless parts (now)

1. **`tools/deckcheck.lua`**: pure functions, no TTS calls, run in the headless Lua tests (fengari):
   - `deckcheckId(url)`: returns the id or nil, for all three link kinds, with or without `www.`, a query string,
     a trailing slash, or upper/lower-case host;
   - `deckcheckEntries(json)`: the decoded response → `{ name, commanders = {...}, entries = {{scryfall_id, name,
     count}...}, bracket, threatIndex, maxThreat }`, commanders first; it tolerates missing boards, null
     bracket/threatIndex (non-Commander), and partner commanders;
   - `deckcheckError(status, body)`: the plain-words chat message for each error status;
   - `deckcheckTag(info)` and `deckcheckReadTag(notes)`: write and read the GM-notes line; reading tolerates other
     lines and a missing tag;
   - `deckcheckLabel(info)`: `Bracket 3 · Threat 54/96`, or `Bracket 3` / `Threat 54/96` when one is missing, or
     nil.
2. **`tests/test_deckcheck.js`**: drives the Lua through the existing headless runner (`tests/lua/`), on a
   hand-made fixture `tests/golden/fixtures/deckcheck-deck.json` with the documented shape (made-up deck, real
   card names, made-up ids). Cases:
   - two commanders (partners);
   - quantities above 1 (basic lands);
   - a non-Commander deck with null bracket;
   - an empty mainboard;
   - every error status;
   - every link variant, plus links that must be rejected (other hosts, `/app/home`, an empty id).
3. A live smoke script `tools/deckcheck-smoke.js <link>`, run by hand only, never in the gates. It fetches one
   public deck from Node and runs the result through the same shape check, to catch API drift.

Built 2026-11-15: `tools/deckcheck.lua`, `tests/test_deckcheck.js` (a deploy gate; loader `tests/lua/deckcheck-run.js`),
`tools/deckcheck-smoke.js`. Choices the spec left open:

- `commanders` holds the commander entries (same fields as `entries`); within a board, entries are sorted by name
  then `scryfallId`, and the same `scryfallId` twice is merged. Only `commanders` and `mainboard` are read.
- A card with no `scryfallId` or a `quantity` of 0 is left out; a missing `quantity` is one copy. A bracket or
  threat that isn't a whole number reads as missing; `threatIndex` falls back to `dti.score`, the maximum is
  `dti.maxScore` or 96.
- The tag line is `[deckcheck] id=<id> bracket=3 threat=54/96` (missing parts left out), at the start of its line.
- Any other 5xx reads as 500; 0/nil (no answer) is "Couldn't reach DeckCheck"; another status names its number.

Live shape: **confirmed 2026-11-15.**
- The docs' example id `sBid_JEUQZ4D` got a JSON 404, the documented error form.
- A public `/app/builder/` deck got a 200 whose shape matches the docs:
  - the commander's `deckCardId` keys are like `com0_<name>`;
  - `setName` is null;
  - `prices` uses the short keys `ck`, `cm`, `mp` and `usd`.

  `deckcheckEntries` read 1 commander and 90 entries (100 cards), with the label "Bracket 3 · Threat 45/96".

The TTS wiring (importer patch, label drawing, the start/end hide and show) comes after the headless part passes,
and is tested on the real table.
