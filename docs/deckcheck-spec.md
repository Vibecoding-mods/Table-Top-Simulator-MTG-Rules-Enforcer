# DeckCheck links: import, bracket and threat level

Status 2026-11-15: headless part built and on main; TTS part (import, label) built on branch `deckcheck-tts`, tested
on the fake TTS only. Not yet seen on the real table (see "TTS part" at the end).

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
  next to the commander zone: `Bracket 3 | Threat 54 (32-51)`, the score and its bracket's range (DeckCheck, updated 2026-10: 1 = 0-15, 2 = 16-31, 3 = 32-51, 4 = 52-67, 5 = 68-96). A gate can raise a bracket, so the score may sit outside the range shown.
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
   - `deckcheckLabel(info)`: `Bracket 3 | Threat 54 (32-51)`, or `Bracket 3` / `Threat 54/96` when one is missing, or
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

  `deckcheckEntries` read 1 commander and 90 entries (100 cards), with the label "Bracket 3 | Threat 45 (32-51)".

### TTS part

Built 2026-11-15 (branch `deckcheck-tts`), gate `tests/test_table_deckcheck.js`:

- **Import.** `tools/make-engine-copy.js` step 7 patches the engine copy's Card Importer (the Workshop file is only
  read):
  - `Importer.Deck` sends any `deckcheck.co/` link to `fetchDeckCheckDeck` (`tools/deckcheck-import.lua`), ahead of
    Archidekt and Moxfield;
  - `tools/deckcheck.lua` and `tools/deckcheck-import.lua` are appended to the importer's script;
  - the spawned deck's data gets `GMNotes = qTbl.gmNotes` (nil for every other import);
  - the help and "not supported" lines name DeckCheck.
- `fetchDeckCheckDeck`: a link that isn't a deck link is refused with the 400 message and no request. Otherwise ONE
  GET through the importer's own `WebGetSSL` (15 s timeout, no key). The status comes from `response_code`, else the
  `HTTP/1.1 NNN` in the error, else 0 (no answer). Then `deckcheckError`, or `deckcheckEntries` → each card
  `count` times, commanders first → `spawnDeckEntries`. The deck is named as on DeckCheck (`qTbl.full`, the deck's
  description, as Moxfield's), and the tag goes in its GM notes. The answer is not kept.
- Choices the spec left open:
  - a 200 that isn't JSON, or isn't a deck, reads as the 500 message;
  - more than 250 cards is refused ("the importer takes at most 250"), so a broken answer can't spawn thousands;
  - a one-card deck spawns as a lone card, which carries no tag (the importer's solo-card path is unchanged).
- **Label.** `tools/deckcheck.lua` is also appended to Global, before `engine-renderer.lua`. In `engineSetupButtons`,
  with engine mode on and no game running, each seated colour's deck on its library spot (`getDeckFromZone`, the
  deck the READY check reads) is read with `deckcheckReadTag` / `deckcheckLabel`. Each label is a button on the
  seat's playmat (`engineDeckCheckDraw`):
  - centred between the two commander zones, moved toward the library past the zones' near edge onto the strip
    before the exile pile (White: about x 40.8, z -10.5);
  - 5.4 x 0.75, readable from the seat;
  - local x negated, because real TTS mirrors a mat zone's buttons.
- The labels are part of the setup redraw's signature, so they follow the deck within the 2 s heal, and they go and
  come back with the READY buttons:
  - hidden once a game runs;
  - while the game-over board shows, the decks are still put away, so there is no label;
  - back after NEW GAME / `mtg reset` puts the decks back.
- In 2HG and the team modes every seat reads its own deck.
- To check on the real table:
  - a real DeckCheck import (`Importer deck <link>`);
  - that TTS gives `response_code` for a 403/404;
  - the label's spot, size and direction for all four seats (`tools/tts-shot.ps1`);
  - that it goes at a game start and comes back after NEW GAME.
- Deploying: `tools/patch-save.js` patches Global only. The importer is an object script, so it reaches the user's
  save only through a rebuild or `tools/tts-push-global.js --patched`, which wipes the table: never with decks on it.
  (Since then `importerScripts` in `tools/patch-save.js` gives a top-level object of the save the built script when
  that one has `function deckcheckId(` and the saved one doesn't: the Card Importer, and rikrassen's importer below.)

### rikrassen's importer

Added 2026-11-18, gate `tests/test_table_rik_deckcheck.js`. The table's second importer (rikrassen's MTG
Deck/Draft/Cube Importer, GUID ddf5de: a "Deck site URL" box) POSTs the link to rikrassen's server, which refuses
deckcheck.co ("unable to read cards from ..."). So the engine copy reads DeckCheck itself and hands the server a list:

- `tools/make-engine-copy.js` (step 6, the Workshop file is only read):
  - in `M.deck`, after the seat check, the POST becomes a local `post()`, and `deckcheckRikDeck(color, data, post)`
    (`tools/deckcheck-rik.lua`) goes first;
  - `tools/deckcheck.lua` and `tools/deckcheck-rik.lua` go into the script just before the luabundle's closing
    `return __bundle_require("__root")` (nothing may follow a `return`);
  - the Deck tab's list of sites names deckcheck.co.
- `deckcheckRikDeck`: any other link (or none) is left to the server, unchanged. A `deckcheck.co/` link that isn't a
  deck link gets the 400 message and no request. Otherwise ONE `WebRequest.get` of the `/deck` endpoint (no key),
  then `deckcheckStatus` / `deckcheckError` (the same plain words as the Card Importer, said to the player in red),
  `deckcheckEntries`, the 250-card cap (`deckcheckTooBig`), and `deckcheckDecklist`. Then `data.data` = the list,
  `data.url` = '', and the usual POST to `/build`. On an error nothing is posted and the importer window stays open.
  The answer is not kept.
- The list (`deckcheckDecklist`, MTG Arena style, which the server reads: checked live 2026-11-18, a "Commander"
  part spawns the commander as its own card, two as their own deck):

  ```
  Commander
  1 Thrasios, Triton Hero (c16) 46

  Deck
  40 Plains (unf) 235
  ```

  - the printing (`setCode`, `collectorNumber`) is added only when both are plain codes (letters, digits, `_`, `-`,
    up to 16); the server falls back to the name for a printing it doesn't know (checked live);
  - no commander: the "Deck" part only; a line break in a name becomes a space, so a name can't add a line.
- Live, 2026-11-18: a 100-card builder deck read from DeckCheck and posted as this list came back from the server as
  a 99-card deck plus the commander card.
