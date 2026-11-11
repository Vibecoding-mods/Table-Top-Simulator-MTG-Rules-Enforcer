# Custom card art, player-made (spec, item 16)

Status: design only, written 2026-11-11. No code changed. Source item: docs/next-features-2026-11-09.md, item 16.

## What the user sees

- You put your own picture on a card by adding a link to the end of its line in the deck list you paste into the Card Importer:
  `1 Sol Ring #https://example.com/my-sol-ring.png`
- Your imported deck shows your picture on that card. Then you press `mtg ready` and play. The picture stays your picture in your library, hand, on the battlefield, on the stack, in the graveyard and in exile.
- Everyone at the table sees the same picture, because the link is public.
- Only the picture changes. The name, rules text, power and toughness, badges and hover text come from Forge. If your picture lies about the card, the hover line still says the real card.
- Every copy of that card name in your deck wears your picture. (One line per card name; see "Copies".)
- Double-faced cards: you give one link for the front. The back keeps its normal picture, unless you give a second link (`#front-url #back-url`, new, see below).
- A link that does not work shows a white card. The table says so in chat when the deck is checked: "Sol Ring: the picture link did not load".
- The host can switch custom art off for the game (`mtg art off`): everyone then sees the normal pictures. Proposed so one player cannot make misleading art stick.
- Tokens made by the game use the normal token pictures. Token copies of your card use your picture.

## Findings: how it works today

### The importer (table-scripts/_854FD9_Card_Importer_49D54F_6.6__988e5e.lua, documented in docs/table-functions-global-importer.md)

- Syntax. `resolveDeckTextEntries` (around line 1395) reads each line and takes `%s#(https?://%S+)$`: a space, a hash, then an http or https link with no spaces, at the very end of the line. It strips the link from the card name and keeps it as `entry.image`. Lines that START with `#` or `//` are comments.
- `spawnDeckEntries` (line 1666) copies each link into `qTbl.image[i]`. The card builder `Card` (line 2804) uses `qTbl.image[n]` where `n` is its own spawn counter, not the line number. The docs (global-importer.md, around line 1329) note that token enrichment is asynchronous, so counter and line can differ and a picture can land on the wrong card. Not fixed.
- The link goes through `cleanImageUrl` (line 530). It cuts everything after a `?` (so links with signed query strings or cache keys break) and rewrites `cards.scryfall.io` to `img.klrmngr.com`. It does not check the host, the file type or the length.
- The first image rule wins (line 2804): a per-line link beats everything. For a double-faced card that rule comes first, so the DFC branch (the one that builds the second state with the back face, line 2806 onward) is skipped. A DFC with a custom link imports as a single-faced card with no back. This is a real gap.
- Other ways to give art: `spawn <image url> [name]` for one card (`spawnWithImage`, `Importer.Spawn`, docs line 854), and a "Custom Image" branch for `t.image` (line 2835). Neither matters for engine mode.
- The URL ends up as `FaceURL` in the `CustomDeck` entry of the spawned card or deck. The back is the default back.

### Engine mode (what happens after the deck is imported)

- `mtg ready` runs in tools/engine-renderer.lua (around lines 395-415). It reads each imported card's `FaceURL`/`BackURL` from the deck's `CustomDeck` entries and sends them to the bridge with the name.
- `checkDeck` in bridge/bridge.js (line 292) builds `images[engineName]`: a list of `{ face, back }`, one entry per distinct face link. It stores it in `readyDecks[color].images`.
- `imagesFor(name, ownerColor, id)` (bridge.js line 1074) returns one entry for an engine card: the owner's deck first, then other decks. If a name has several pictures, it picks by `id` number modulo the list length. It passes over a face that is the card back or known dead. Then `ttsImage()` rewrites only Scryfall CDN links; custom links are untouched.
- `tableCard` (bridge.js about line 1220) uses that picture first (`img?.face`), then Scryfall's lookup by name (`cachedImage`) only when the deck has none. Tokens use `tokenImage` first. The stack uses `pictureOf` (bridge.js line 3512), which calls `imagesFor` too. A reveal or a pile uses the same card data.
- So the engine-mode card keeps the imported link in these places: hand, battlefield, command zone, graveyard, exile, stack, library top. Custom art is NOT replaced by Scryfall art for a plain card whose name resolves to a deck card.
- On the table, `engineCardData` (engine-renderer.lua line 205) builds the object from `c.f` and `c.b`. `engineDeckKey` (line 94) gives every distinct `face|back` pair its own `CustomDeck` number from 3000 up. TTS caches pictures by that number, so two different pictures never share one. `engineFace[id]` remembers the picture; if it changes the card is replaced (line 461).
- The links are saved with the running game (`game.pictures`, in the resume file) so a restart shows the same pictures.

### Where custom art is lost or wrong today

1. Double-faced cards: the importer drops the back (above). Even with a back, `tableCard` builds `b` from `imageCache[normName(name)]?.back || img?.back` (bridge.js line 1223), so Scryfall's back wins over the deck's back. A transformed card's engine name is the back face's name; `imagesFor` finds nothing under that name and Scryfall is used. Custom back art needs work in all three places.
2. Several links for one name: if two lines have the same card but different links, or one has a link and one does not, `imagesFor` mixes them by card id. Forge decides which copy is which, so "this exact copy wears this art" is not possible. Decide a rule (below).
3. A link that is dead is found only for `img.klrmngr.com` links (`checkDeckImages`, bridge.js about line 1100). A dead custom link shows white and nobody is told.
4. The importer strips `?` queries and mis-orders pictures in async imports (above).
5. Tokens: the importer attaches its own tokens; the engine makes its own. Engine tokens use Scryfall token art. A player cannot give art to a token today.
6. The stack pop-up and the big card view (`engineUiImage`, engine-renderer.lua line 1413 and 1871) use the same link in the TTS UI. A URL that works for card objects works there.

## How to build it

### Rule for copies

- One picture per card name per owner. If any line for that name has a link, every copy of that name in that deck wears the first link given. State this in the chat message from `mtg ready`: "Sol Ring: your picture on all 1 copies".
- If a deck has two different links for one name, use the first and warn. (Basic lands: each printing of a basic is common in a deck; allow several links for basics only and keep today's mixing for them.)
- This removes the order and counter problem for engine mode, because it keys on the name.

### Import syntax

- Keep `N Card Name #https://link` as it is.
- Add a second optional link for double-faced cards: `1 Delver of Secrets #https://front.png #https://back.png`. The importer already finds the last link; extend the match to two.
- Tighten what the importer accepts (the importer is a table script, so this goes through the deploy tool and the table script update):
  - https only (reject http; TTS and most hosts need https).
  - no spaces, quotes, backslashes, angle brackets or control characters in the link (the link is put into spawned JSON and Lua tables).
  - length at most 500.
  - a path that ends in .png, .jpg, .jpeg or .webp (a query string is cut by `cleanImageUrl` already; say so in the message).
  - Broadcast "Custom art ignored for X: <reason>" and import the card with its normal picture.
- DFC fix in the importer: when a per-line link exists for a DFC, still build the second state (back). Back picture = the second link, else the normal back from the card data.

### Keeping the art through engine mode

- Bridge `checkDeck`: store which names have custom art (`customArt: Set`) beside `images`. Use the rule above.
- Bridge `imagesFor`: if the owner's deck has a custom picture for the name, return it ahead of any other printing.
- DFC: when the deck gave a back link, `tableCard` uses it instead of `imageCache` back. For the transformed state, store the deck's back link under the back face's name too (`checkDeck` knows both names from Forge's card index; the harness index lists faces), so `imagesFor(back name)` finds it.
- Tokens that are copies of a deck card already work (`imagesFor` by name). No change for tokens made by the game.
- Do not rewrite the link with `ttsImage`. Leave custom links exactly as given (after validation).
- Dead-link check: see Safety. Add a HEAD or GET check that is safe for arbitrary hosts, or leave it to the players' clients.

### What other players see

- The picture link is part of the card object that the host's TTS script spawns. Each other player's TTS client downloads the link itself when it sees the object. So the link must work from every player's computer, not only the host's. A link to a local file, a LAN address or a page that needs a login shows white to others.
- The bridge never sends the picture itself. It only carries the link text. Players on the companion page do not see table pictures.
- A late joiner, or someone who rejoins, downloads the link again.

### Image hosting limits in TTS

These are TTS behaviours I know in general and did not measure here; verify them on the real table before promising them:

- It must be a direct link to the image file, not a web page (not a Google Drive "view" page, not an Imgur album page).
- https is the safe choice. TTS loads png and jpg; webp has worked for the existing klrmngr links in this project.
- TTS downloads each link once and caches it on disk by link. Changing the picture means changing the link (a new file name), or the old cached picture stays.
- Card images are about 488 x 680 pixels (the Scryfall "normal" size). A much bigger image works but costs memory and load time. Suggest at most 1000 pixels tall and 1 MB.
- Free hosts that block hot-linking, or that answer with a page instead of an image, show white. The usual workable hosts: Imgur direct links (i.imgur.com), Discord CDN links (these expire), GitHub raw links.
- The card back is the project's default back; custom backs are not in scope.
- Every distinct picture is one more `CustomDeck` entry. The project already numbers them small (3000 up) for snapshot speed. A deck of 100 custom pictures adds 100 entries. The earlier measurement (a big number cost 25 ms per card per snapshot) is about the number's size, not the count. The count has not been measured.

## Safety

- Only picture links. The importer and bridge never run anything from a link. TTS loads it as an image. A wrong file type shows white.
- Every player's client visits the link. A hostile link host learns the IP addresses of the players (a tracking pixel). Say this once in the help text: "Everyone at the table downloads your picture from that site."
- The link is placed into a JSON string and a Lua table by the importer and the engine renderer. A quote or backslash in a link could break the data. So the importer and bridge both reject those characters (the bridge repeats the check; do not trust the table text).
- The bridge must not fetch arbitrary links. A HEAD check from the host's PC could be aimed at a LAN address (server-side request forgery). Either skip the check for custom links, or allow it only for https links whose host name resolves to a public address, with a short timeout and a size cap. Recommend skipping at first.
- Picture content (offensive or misleading art) is the table's business. The host switch `mtg art off` is the control. Hover text and the engine's card name always show the real card.
- Rules stay Forge's. Art never changes the card's name, cost, text or abilities. The bridge still resolves the card by name from the deck line.

## Tests

- tests/test_bridge_golden.js and the bridge golden: a deck with a custom link on one card, on a DFC (front and back), and with two links for one name. The engine card's `f` is the custom link in every zone (hand, battlefield, stack, graveyard, exile, command).
- tests/test_bridge_claims.js: a claim that `imagesFor` prefers the custom link; a claim that a bad link (http, quote, space, over 500, wrong extension) is dropped with a chat message; a claim that custom links are not rewritten by `ttsImage`.
- Importer: a table test that parses `resolveDeckTextEntries` lines (the existing fake TTS can load the importer script; check tests/lua first) for: one link, two links, a link with a query string, a comment line starting with `#`, a line with a link but no quantity.
- Table: tests/test_table_golden.js board with a custom picture; `engineDeckKey` gives two different numbers for two different links.
- Mutation run on the new code (agent rules): accept http, accept a quote, ignore the owner, use the last link instead of the first, skip the back, rewrite the link, drop the warning.
- Live checklist: import a three-card deck with one PNG on Imgur, one DFC with two links, one bad link. `mtg ready`, start, draw it, play it, put it on the stack, send it to the graveyard, flip the DFC (transform), see it from another seat, restart the bridge and reload (resume keeps the picture). Switch `mtg art off` and see normal pictures.

## Risks

- The importer is Pie's table script; changes need the table-script patch path and a deploy with TTS closed (docs/mtg-deploy-and-alignment notes). A change there is the biggest part of the work.
- DFC back art touches three places (importer, `tableCard`, `imagesFor`). The rule is easy to get wrong for a transformed permanent whose engine name is the back face.
- Hosting is outside our control. Players will report white cards for links that are fine for them but not for others.
- The async-import ordering bug may still put a link on the wrong card for non-engine imports. Engine mode is safe once keyed by name, but the importer's own table cards stay wrong until it is fixed. Fixing the importer's counter-to-line mapping is separate work, about 2 h.
- Custom art for tokens made by the game and for opponents' decks are out of scope.

## Estimate

- Bridge rule by name, DFC back and transformed names, per-link validation: 4-5 h.
- Importer: second link, DFC state kept, validation messages, tests: 4-5 h.
- `mtg art off` setting and chat messages: 2 h.
- Tests, mutation run, docs rows: 4 h.
- Real-table checks and hosting experiments (Imgur, GitHub raw, Discord): 2-3 h.
- Total: about 16-19 h (2 to 2.5 working days). A first slice (plain cards only, validation, engine keeps the link, no DFC back) is about 6-8 h, and most of it works today without code: a plain card with a link in the deck list already keeps its picture in engine mode (not yet verified on a real table; verify first).
