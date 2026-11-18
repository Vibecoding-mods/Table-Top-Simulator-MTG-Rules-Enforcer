# Formats and ban lists spec: a Format button, ban and restricted switches, an always-current ban list

Status: spec only, written 2026-11-18. Nothing is built. Code lines are from main at `e24696a` (2026-11-18); other
work moves them.

## What the owner wants

1. A **Format** button on the table, before the game starts, with the paper formats and the MTG Arena formats.
2. Per format, a switch to **allow or not allow banned cards** (house rules), and (added the same day) a second,
   separate switch to **enforce or not enforce restricted cards**. Both default to enforce.
3. A **list of banned cards per format**, kept up to date: whenever the list changes, the table's banned-list button
   shows the new list.
4. A deck with a banned card: an alert names the cards and the game **won't start**, the same way a card the engine
   doesn't know stops it today.
5. Asked along the way: "when a card is banned is it banned in all formats?" **No** (§1).

## 1. Bans are per format

A card has its own status in **each** format. Scryfall gives every card one of four words per format, in its
`legalities` object. Sol Ring, read 2026-11-18:

| Format | Sol Ring |
|---|---|
| commander, predh | `legal` |
| vintage | `restricted` (one copy) |
| legacy, oathbreaker, duel | `banned` |
| standard, modern, pauper, premodern, ... | `not_legal` |

So Sol Ring is fine in Commander, one copy in Vintage, banned in Legacy, and simply not part of Modern. **Only the
chosen format is checked.** A card banned in Legacy is no problem in a Commander game.

The four words mean different things, and the alert says them differently:

| Status | Meaning | The deck check says | Which switch turns it off |
|---|---|---|---|
| `legal` | allowed | nothing | none |
| `banned` | in the format's card pool, but banned by the format's rules committee | `banned in Modern: Mycosynth Lattice, ...` | **Banned cards** |
| `restricted` | at most one copy (Vintage, Old School). In Duel Commander Scryfall uses it for its "banned as commander" list (§3.4). | `restricted in Vintage (1 copy each): 4× Brainstorm, ...` | **Restricted cards** |
| `not_legal` | not part of the format at all: not from its sets (Standard, Pioneer, Modern, Premodern, Old School), not a common (Pauper), not on MTG Arena (Historic, Timeless, Alchemy), or a silver-border / acorn card | `not legal in Pioneer (not from its sets): Brainstorm, ...` (§5.3 has the reason words per format) | none: it stays enforced in every format. "Casual" (§3.1) is the way to play anything. |

The two switches are independent:
- **Banned off:** banned cards are allowed. `not_legal` cards still stop the deck.
- **Restricted off:** a restricted card follows the format's normal copy limit (4 in Vintage and Old School). In
  Duel Commander it may then be the commander.
- Turning **Banned** off does not touch restricted cards, and turning **Restricted** off does not touch banned ones.

## 2. What exists today (read 2026-11-18)

### 2.1 How a bad deck stops the game today: the mechanism to reuse

This is the "invalid card" behaviour the owner means:

1. **READY** (the seat's button, or `mtg ready`): the table reads the deck on the library spot, the commanders, the
   hand, and in Standard the sideboard on the graveyard spot. It sends `{t:"decks", seats, request, mode}`
   (`engineSendDecks`, `tools/make-engine-copy.js:834-882`).
2. The bridge's `onDecks` (`bridge/bridge.js:1418-1442`) asks Scryfall about foreign names first, then runs
   `checkDeck(color, entry, mode)` (`bridge/bridge.js:1331-1414`) per seat. `checkDeck` collects `problems`:
   - no deck;
   - no commander;
   - "the engine doesn't know N card(s): ..." (`:1385`, the unknown card);
   - in Standard, everything `standardProblems` finds (`:1061-1091`: 60+, 15 sideboard, 4 copies, "banned in
     Standard: ...", "not in Standard's sets (...)", no commander).
3. With any problem, `checkDeck` deletes `readyDecks[color]` and sends the alert as chat:
   `[MTG] White (deck name): not ready for Standard.` followed by one `- problem` line each (`:1395-1399`). The table
   shows a bridge `chat` with `broadcastToColor` to that seat (the coloured centre-screen text plus chat), else
   `broadcastToAll` (`tools/make-engine-copy.js:965-970`).
4. The bridge answers `{t:"deckReport", ready, checked}` (`:1441`). The table's `engineDeckReport`
   (`tools/engine-renderer.lua:9985-9990`) marks the seat `"problem"`. `engineSetupButtons` (`:9992`) then draws its
   button red, **FIX DECK** (`:10068-10069`), and the middle tile never shows **Start**: it shows "Engine: on" until every
   seated colour is `"ready"` (`:10076-10079`).
5. Pressing Start anyway (or `mtg start`) still refuses:
   - `onMtgSetupStart` (`tools/engine-renderer.lua:10292-10312`) says "Waiting for X to press READY";
   - the bridge's `startGame` (`bridge/bridge.js:2273-2284`) refuses any seat where `readyFor(c, mode)`
     (`:1492`) is false: no checked deck, or one checked for the other mode.

**Plan: ban and legality problems are more `problems` lines in step 2.** Everything after that (the chat alert, red
FIX DECK, no Start, the bridge's refusal) is reused unchanged. `readyFor` becomes "checked under the same rules"
(§6.3), so a deck checked before the host changed the format or a switch can't start.

### 2.2 Game modes and Standard legality (already built)

Docs: [game-modes-spec.md](game-modes-spec.md) §3.

- `MODES` (`bridge/bridge.js:1010-1013`): `commander` and `standard`. The host picks one with `mtg mode` or the
  **Game mode** button.
  - The button: `engineSetGameMode`, `engineModeLabel`, `onMtgSetupMode`, `MODE_SPOT`
    (`tools/engine-renderer.lua:10190-10290`).
  - It decides: 40 or 20 life, the commander zone pieces (`engineModePieces`), the AI decks, and the `format` sent with
    `StartGame`.
- The table sends `mode` with `hello`, `decks` and `start` (only when Standard). The bridge keeps it with `noteMode`
  (`:1027-1031`).
- Standard's list is Forge's own: `tools/build-forge-card-index.js --formats` builds `bridge/forge-formats.json` from
  `forge-gui/res/formats/Sanctioned/Standard.txt`. Read by `forgeFormat` (`bridge/bridge.js:1045-1056`). **Only
  Standard is in the file today** (built 2026-11-13: 5,169 legal names, 13 banned).
- Commander today checks **no** ban list. 100 cards and duplicates are warnings only (`:1390-1391`), not problems.
- Precedent for Scryfall in the bridge: `lookUpForeign` (`:1134-1175`), with a `User-Agent`, ~120 ms between requests,
  and a cache file kept out of git (`.gitignore`: `bridge/foreign-names.json*`).

### 2.3 Host-only switches on the table

- `engineChat` treats `pl.host or pl.admin or pl.promoted` as the host (`tools/engine-renderer.lua:12610`).
- The setup tile's west strip holds Game mode, Free mulligans, Teams and Archenemy. Their spots come from
  `tools/table-profile.js:39,42` (`spots.mode` etc.) through `TABLE_PROFILE` (`tools/make-engine-copy.js:333`).
- A change resets every seat's READY (`engineSetGameMode`, `tools/engine-renderer.lua:10209`) and is broadcast to all.

## 3. Formats to offer

### 3.1 The list

Checked against Scryfall's `legalities` keys (a live card, 2026-11-18). The keys are: `standard future historic
timeless gladiator pioneer modern legacy pauper vintage penny commander oathbreaker standardbrawl brawl
competitivebrawl alchemy paupercommander duel oldschool premodern predh tlr`.

- "Banned / restricted" are Scryfall search counts, measured 2026-11-18 (`banned:<key>`, `restricted:<key>`).
  From Timeless on, the searches hit Scryfall's rate limit (HTTP 429), so those counts are **not measured**. This is
  one more reason to use the bulk file (§4), not searches.
- "Forge fallback" is the format file in our pinned Forge (`e7d2b93`, 2026-09-21), under
  `forge-gui/res/formats/`.

| Format (button word) | Scryfall key | Banned / restricted | Forge fallback | Deck shape (§5.1) | v1? |
|---|---|---|---|---|---|
| **Paper** | | | | | |
| Commander | `commander` | 83 / 0 | `Casual/Commander.txt` | Commander | yes |
| Duel Commander | `duel` | 250 / 27 | none | Commander | yes (Scryfall only) |
| Pauper Commander | `paupercommander` | 4 / 0 | none | Commander | yes (Scryfall only) |
| PreDH | `predh` | 48 / 0 | `Casual/PreDH.txt` (its own TODO: some old sets missing) | Commander | yes |
| Standard | `standard` | 13 / 0 | `Sanctioned/Standard.txt` | 60-card | yes (built) |
| Pioneer | `pioneer` | 31 / 0 | `Sanctioned/Pioneer.txt` | 60-card | yes |
| Modern | `modern` | 52 / 0 | `Sanctioned/Modern.txt` | 60-card | yes |
| Legacy | `legacy` | 171 / 0 | `Sanctioned/Legacy.txt` | 60-card | yes |
| Vintage | `vintage` | 101 / 52 | `Sanctioned/Vintage.txt` (`Restricted:`) | 60-card | yes |
| Pauper | `pauper` | 76 / 0 | `Sanctioned/Pauper.txt` (rarity rule not readable by our builder) | 60-card | yes |
| Premodern | `premodern` | 33 / 0 | `Casual/Premodern.txt` | 60-card | yes |
| Old School | `oldschool` | 7 / 22 | none | 60-card | yes (Scryfall only) |
| Oathbreaker | `oathbreaker` | 210 / 0 | `Casual/Oathbreaker.txt` | 60 + oathbreaker + signature spell | **no**: no signature-spell zone or engine path (§9) |
| **MTG Arena** | | | | | |
| Standard (Arena) | `standard` (same list as paper; Scryfall has no separate Arena Standard key) | 13 / 0 | `Archived/Arena Standard/2026-09-29.txt` | 60-card | yes, as "Standard" |
| Alchemy | `alchemy` | 1 / 0 | `Archived/Alchemy/2026-10-13.txt` | 60-card | yes (see note) |
| Historic | `historic` | 84 / 0 | `Sanctioned/Historic.txt` | 60-card | yes (see note) |
| Timeless | `timeless` | not measured | `Archived/Timeless/2026-10-13.txt` (has `Restricted:`) | 60-card | yes (see note) |
| Brawl (100-card) | `brawl` | not measured | `Casual/Brawl.txt` (no bans in it) | 100 + commander, 25 life | **no**: life and the Brawl variant are engine work (§9) |
| Standard Brawl | `standardbrawl` | not measured | none | 60 + commander | **no** (§9) |
| Explorer | **no key** | | none | | **no**: Scryfall has no Explorer legality any more (reason not verified) |
| **Casual** | | | | | |
| Casual Commander | none: no list | | | Commander | yes. This is today's Commander behaviour: deck shape only, every card the engine knows. |
| Casual 60-card | none | | | 60-card | yes, the same for 60-card decks |

Not offered: `gladiator`, `penny`, `competitivebrawl`, `future`, and `tlr` (a key whose format we couldn't identify).
The builder keeps them in the cache, so offering one later is a table change only.

Arena note: Alchemy's rebalanced cards ("A-" names) and other Arena-only cards may be unknown to the engine (not
checked). The existing "the engine doesn't know N card(s)" problem catches those; nothing new is needed.

### 3.2 Format, game mode and deck shape

The format **replaces** the Game mode button's choice. Each format names its game mode:
- Commander, Duel Commander, Pauper Commander, PreDH and Casual Commander → `commander` (40 life, the commander zone);
- every 60-card format → `standard`. The `MODES` entry is renamed in words only ("60-card"); its key stays
  `standard`, so the relay and node mapping (game-modes-spec §3.2) are unchanged. `StartGame`'s `format` stays
  `"Standard"` for every 60-card format: Forge plays them all as `Constructed`.

So everything keyed on `ENGINE_GAME_MODE` / `gameMode.mode` keeps working: life, the commander pieces, team modes
(2v2 for 60-card, 2HG/Juggernaut/Archenemy for Commander), AI decks, best of three (60-card 1v1).

### 3.3 Out of scope for v1, and said so in the format's tooltip

- **Life totals other than 40 / 20.** Duel Commander and Pauper Commander have their own starting life. In v1 they
  start at the Commander 40 (the format's own rule is said in its tooltip). Changing it needs a life override in the
  relay/node, because the harness takes life from `forVariants` (game-modes-spec §1).
- **Colour identity and commander eligibility** (legendary creature, Pauper Commander's uncommon commander). Neither
  the bridge nor Forge's harness checks them today. Scryfall's bulk file has `color_identity` and `type_line`, so the
  builder keeps them (§4.3), and a later slice can add the check cheaply.
- **Brawl, Standard Brawl, Oathbreaker** as playable formats (§9).
- **AI decks** are not checked against the format's lists. The host chose them. Start says so once: "AI decks are
  not checked against Modern's ban list." Our own presets are still filtered for 60-card legality, as `presetsFor`
  does for Standard today (`bridge/bridge.js:1468`); extend it to the chosen format.

### 3.4 Duel Commander's "restricted"

Scryfall reports 27 Duel Commander cards as `restricted`. Duel Commander has no 1-copy rule (every deck is
singleton). This is the format's "banned as commander" list, as Scryfall stores it (**not verified** beyond the counts;
checked with a card at build time). So in Duel Commander a restricted card:
- may be in the 99;
- may not be a commander while **Restricted** is on: `restricted in Duel Commander (not as your commander): ...`.

## 4. The ban list data: source, refresh, cache

### 4.1 Sources weighed

| Source | Fresh | Covers | Cost | Verdict |
|---|---|---|---|---|
| **Scryfall bulk `oracle_cards`** | Regenerated daily (`updated_at` 2026-11-18T10:01Z when read). Scryfall changes legalities when a ban announcement takes effect. | All 23 keys; banned, restricted **and** not_legal per card, rarity included (Pauper right) | 1 metadata GET + one ~25.5 MB gzip download (`jsonl_download_uri`, `compressed_size` 25,520,540, read 2026-11-18) | **Recommended** |
| Scryfall search (`banned:modern`) | Live | banned and restricted only, no "legal" list. Unknown keys error. | 1-2 requests per format per refresh. The search endpoint hit 429 after ~30 quick requests (measured 2026-11-18). | No: no legality, rate-limited |
| Forge's format files | As fresh as the pinned Forge (2026-09-21). Archived files are dated (Timeless and Alchemy 2026-10-13). | 14 of our formats. Set lists + bans. Pauper's rarity rule isn't read by our builder. Un-cards are listed as banned (Commander: 97 names, Scryfall 83; the 14 extra are silver-border cards, which Scryfall calls not_legal). | Already on disk. Refreshed only by a Forge update | **Fallback** (offline, first run) |
| MTGJSON (`AtomicCards`, `Legalities`) | Daily builds | Similar per-card legalities | Larger files, a second outside dependency | No: nothing Scryfall lacks, and the bridge already talks to Scryfall |

Scryfall's terms and limits: their API docs (`scryfall.com/docs/api`) gave HTTP 403 to our fetch, so they were **not
re-read** for this spec. What we follow, as for `lookUpForeign`:
- a `User-Agent` and `Accept` header;
- bulk files rather than many requests, and at most one bulk download a day;
- the data is not republished: the cache stays out of git and out of friend packages, and no Scryfall data is
  committed as test fixtures (fixtures are hand-made in the same shape, as `deckcheck-spec.md` does);
- credit Scryfall in README "Credits" (already there for card pictures; check).

### 4.2 Refresh: when

Everything happens in the **bridge** (Node). The table never fetches, so the WebRequest-userdata trap
(`tools/deckcheck.lua:139`) can't come up here.

1. **At bridge start:** load the cache (§4.3) at once. Then check freshness in the background: `GET
   https://api.scryfall.com/bulk-data/oracle-cards`, and compare its `updated_at` with the cache's.
2. **Every 12 hours** while the bridge runs, the same check.
3. **`mtg banlist refresh`** (host) and the companion page's button: the same check, now, said in chat ("Ban lists:
   up to date (Scryfall, 2026-11-18)" or "Updating ...").
4. Newer `updated_at` → download `jsonl_download_uri`, gunzip as a stream, read one card per line, keep only what §4.3
   lists, and write the cache (to a temp file, then renamed, as `foreign-names.json` is).
5. **Never during a game, and never on the bridge's main thread.** Parsing 25 MB would stall the bridge for seconds
   (it answers every board). So:
   - the download and the reduction run in a `worker_threads` worker (`bridge/legality-worker.js`);
   - a refresh that comes due while a game runs waits for the game to end;
   - a running game keeps the list it started with (`game.rules`, §6.3).
6. Scryfall's file changes every day (prices), but the lists rarely do. The reduced data gets a **content hash**. Only
   when the hash changes does the bridge say so and resend the list version to the table: "Ban lists updated
   (Scryfall, 2026-11-18): Modern +2 banned, Pioneer -1." (counts per changed format).
7. Failures (offline, 429, 5xx, a bad file): the cache stays as it was. The failure is logged and tried again at the
   next check. A 429 waits at least the `Retry-After`, else an hour.

### 4.3 Cache file

`bridge/legality-cache.json`, git-ignored (add `bridge/legality-cache.json*` beside the image caches). Built by the
worker:

```
{ "source": "scryfall", "updatedAt": "2026-11-18T10:01:54Z", "hash": "<sha1 of formats+cards>",
  "keys": ["standard", "pioneer", ...],               // the key order of each card's status string
  "formats": { "modern": { "banned": [...names], "restricted": [...] }, ... },
  "cards": { "<normName>": "lnlbn...", ... },          // one letter per key: l legal, b banned, r restricted, n not_legal
  "identity": { "<normName>": "WU" } }                 // for the later colour-identity slice (§3.3)
```

- About 36,000 oracle cards × ~45 bytes ≈ 1.6 MB. It is read once, kept in memory, and looked up by
  `normName` (`bridge/bridge.js:999`).
- **Names.** Each card is stored under its full name, its front face's name, and each face's name. Forge names a
  double-faced card by its front face; the deck check sends the engine name (`canon` in `standardProblems`). "A-"
  Alchemy names stay as they are.
- **A name the cache doesn't have** (a card printed after the cache was built, which the engine knows from a newer
  Forge) counts as not checked, not as not legal. Said as a warning, never a problem: "Not on Scryfall's list from
  2026-11-18 (newer card?): X."

### 4.4 Fallback order and what the table shows

1. **The Scryfall cache, any age.** Shown as "Scryfall, 2026-11-18". Older than 7 days is shown as "(old: offline?)".
2. **No cache yet** (first run offline): Forge's files, built for all 14 Forge formats by `build-forge-card-index.js
   --formats` (the `--only` default extended). Shown as "Forge, 2026-09-21". The un-card difference doesn't matter:
   they are also "not legal" under Scryfall.
3. **Neither has the format** (Duel Commander, Pauper Commander or Old School offline on a first run): the Format
   button skips it, saying "Duel Commander needs Scryfall's list: the bridge hasn't downloaded it yet (mtg banlist
   refresh)."

The bridge sends the table `{t:"banlist", format, source, date, counts:{banned, restricted}}`:
- on `hello`;
- on every format change;
- after a refresh whose hash changed.

## 5. The deck check per format

### 5.1 Deck shape (the format's own rules, enforced as problems)

| Shape | Rules | Today |
|---|---|---|
| Commander (Commander, Duel, Pauper Commander, PreDH) | a commander (two for partners: unchanged), exactly 100 cards with the commander(s), one copy of each card except basic lands and cards that say otherwise (`copyLimits` from `forge-formats.json`, as Standard reads it) | 100 and singleton are **warnings** (`bridge/bridge.js:1390-1391`). They become **problems** in the four named Commander formats, and stay warnings in Casual Commander. |
| 60-card (all others) | `standardProblems`' rules unchanged: 60+, ≤15 sideboard, ≤4 across main and side, no commander | as Standard today |

`standardProblems(cards, commanders, sideboard)` becomes `formatProblems(format, rules, cards, commanders,
sideboard)`. It returns `{ problems, warnings }` and takes the lists from §4, so Standard is one case of it.
`checkDeck` calls it for every format except the two Casual ones (shape only). The sideboard is read for every
60-card format (`checkDeck`'s `if (std)` at `:1373` is already keyed on the mode, so this comes for free).

### 5.2 The order of the lines in the alert

The alert is the existing "not ready" chat (`bridge/bridge.js:1397`), with the format named:

```
[MTG] White (Izzet Phoenix): not ready for Modern.
- banned in Modern: Mycosynth Lattice, Up the Beanstalk
- not legal in Modern (not from its sets): Brainstorm
- more than 4 copies of: 5× Lightning Bolt (basic lands excepted)
Ban list: Scryfall, 2026-11-18. The host can allow banned cards (Banned cards button).
```

Order: unknown cards, deck shape, banned, restricted, not legal. Each list shows up to 8 names and "and N more", as
`few()` does today. The last line names the data and, only for a banned or restricted problem, which switch the host
could change.

### 5.3 Wording per status

- Banned: `banned in <Format>: ...`
- Restricted, 4-of formats: `restricted in <Format> (1 copy each): 4× Brainstorm, 2× Ancestral Recall`. One copy of
  a restricted card is fine.
- Restricted, Duel Commander: `restricted in Duel Commander (not as your commander): ...`, only for the
  command-zone cards.
- Not legal: `not legal in <Format> (<reason>): ...`, with the reason by format:
  - "not from its sets": Standard, Pioneer, Modern, Premodern, Old School, PreDH;
  - "not a common": Pauper;
  - "not a common, or an uncommon commander": Pauper Commander;
  - "not on MTG Arena": Historic, Timeless, Alchemy;
  - "not a tournament card": Commander, Duel Commander, Legacy, Vintage. In these formats only silver-border,
    acorn and similar cards are not legal.

  Scryfall gives no reason per card, so the reason is the format's usual one. A card can be not legal for another
  reason than the one said (rare; accepted).
- **Banned off:** `banned in Modern` lines go. When the deck has banned cards, the ready line says so: "ready for
  Modern (banned cards allowed by the host: Up the Beanstalk)", so nobody is surprised.
- **Restricted off:** the restricted line goes. The cards count against the normal limit (4, or 1 in a singleton
  format).

## 6. Table and bridge pieces

### 6.1 Buttons (host only, hidden during a game, as the other setup buttons)

| Button | Where | Label | Click |
|---|---|---|---|
| **Format** | the Game mode button's spot (`MODE_SPOT`); it replaces Game mode | `Format\nModern` | Left-click: next format. Right-click (TTS passes `alt_click` to an object button's function): previous. Typed: `mtg format modern` / `mtg format` (lists them). |
| **Banned cards** | a new spot, `spots.banned` in `tools/table-profile.js`. Proposed on the east strip (x +47; the 6-seat table +49), z 2.5. The west strip is full from z -2.5 to 27.5. | `Banned cards\nNot allowed` / `Allowed` | toggles. `mtg banned on|off` |
| **Restricted cards** | `spots.restricted`, east strip z -7.5. Shown only for a format with a restricted list (Vintage, Old School, Timeless, Duel Commander). | `Restricted\n1 copy` / `Normal limit` (Duel: `Restricted\nNot as commander` / `Allowed`) | toggles. `mtg restricted on|off` |
| **Banned list** | `spots.banlist`, east strip z -17.5. Anyone may press it. | `Banned list\nModern · 52` | §6.2 |

- Each of these buttons is an object button on the tile, drawn by `engineSetupButtons`, like Free mulligans (§6.4).
  Spots are proposals: placed with `tools/tts-shot.ps1` on both tables.
- The two switches are **per format** and start on (enforce) for every format: `ENGINE_BAN_RULES[format] = { banned
  = true, restricted = true }`. A table reload is back to all-on, as Game mode and Free mulligans are back to their
  defaults today.
- Any change to the format or a switch:
  - is said to everyone: "[MTG] Host set the format: Modern (60+ cards, at most 4 of a card; banned cards not
    allowed; ban list Scryfall 2026-11-18). Everyone presses READY again.";
  - clears every READY, as `engineSetGameMode` does (`tools/engine-renderer.lua:10209`);
  - is sent to the bridge (`{t:"format", format, banned, restricted}`).
- A non-host pressing a switch is told "Only the host can change the format." (`engineChat`'s `isHost`).

### 6.2 Where the banned list is seen

- **The Banned list button:** a short line to the presser ("Modern: 52 banned. The full list is in the Notebook,
  tab 'Banned: Modern' (Scryfall, 2026-11-18).").
- **The Notebook tab:** the table's Notebook gets one tab, "Banned list", rewritten for the chosen format
  (`Notes.editNotebookTab`, or `addNotebookTab` the first time; the tab is found by its title).
  - It shows: banned, then restricted, alphabetical; the source and date; how many cards are on the list.
  - Every player can open the Notebook, and it costs nothing against the screen-UI budget
    (`tests/test_ui_budget.js`), unlike a panel.
  - **Not verified** that real TTS lets Global edit the Notebook while players have it open: check live.
- **The bridge sends the names** as `{t:"banlistNames", format, source, date, banned:[...], restricted:[...]}`:
  - when the format changes, and after a refresh whose hash changed;
  - 250 names at most (Duel Commander has 250 banned) is ~6 KB of JSON, well under the sizes that hurt
    (`engineJsonDecode` is used for every bridge message);
  - the table rewrites the tab when it arrives. **This is "the button updated whenever the list is updated."**
- The button's label has the count. It is part of `engineSetupButtons`' redraw signature (`:10008`, add the list's
  `date|count`), so a refresh redraws it within the 2 s heal.
- **Never `UI.setValue` on a Button:** real TTS ignores it (`tts-toolbar-limits`). The tile buttons are object buttons
  redrawn by `createButton`, so this doesn't arise. If a screen-UI piece is ever added, it uses `setAttr` with
  `text`.

### 6.3 Bridge

New module `bridge/legality.js` (pure, testable without network) plus `bridge/legality-worker.js`:
- `loadLegality()`: the cache, else Forge's `forge-formats.json`, else nothing. It returns `{ source, date, hash,
  status(format, name) → "l"|"b"|"r"|"n"|null, list(format) → {banned, restricted} }`.
- `reduceOracleLine(line, out)`: one JSONL line into the cache shape (§4.3). The worker uses it, and so do the tests.
- `formatProblems(...)` (§5.1), and the words of §5.3 (`formatWords`, `notLegalReason`).
- `refreshLegality({ force })`: the metadata check and the download through the worker (§4.2). It resolves to
  `{changed, summary}`.
- `FORMATS`: the table of §3.1 (key, words, game mode, shape, fallback file, reason word, has restricted). One place,
  sent to the table on `hello` so the table's button order can't drift (or a generated Lua table from it at build
  time, as `TABLE_PROFILE` is).

`bridge/bridge.js` changes:
- `gameMode` grows `format`, `banned`, `restricted`. `noteMode(m)` reads `m.format`, `m.banned`, `m.restricted` (a
  message without them is Casual Commander, today's behaviour, so an older table script changes nothing).
- `checkDeck` (`:1331`) calls `formatProblems`. `readyDecks[c]` records `rules = "<format>|<banned>|<restricted>|<hash>"`.
- `readyFor(c, mode)` (`:1492`) becomes `readyFor(c, rules)`: a deck checked under other rules is not ready. The
  refusal says so: "Not started: White's deck was checked for Commander; the format is now Modern: press READY again."
- **A refresh between READY and Start:** the bridge re-runs `formatProblems` on every `readyDecks` entry (it keeps
  the engine names). A deck that now fails is dropped, gets the usual alert, and a `deckReport` turns its button red.
  A deck that still passes gets the new hash. So a new ban that lands mid-setup stops the start, with the reason.
- `game.rules` is kept with the game and in the resume file. The game-over line, the companion page and the log
  name the format.
- The message dispatch (`:13143` hello, `:13223` decks, `:13387` mode) gets `case "format"` and `case "banlist"`
  (refresh, host-checked on the table).

### 6.4 Lua constraints for the table script

- **No new main-chunk locals.** `tools/engine-renderer.lua` has 189 `^local` lines and standard Lua's limit is 200.
  The new code goes inside the existing setup `do ... end` block (`:9861`), or a new `do ... end`. Its state is in
  globals (`ENGINE_FORMAT`, `ENGINE_BAN_RULES`, `ENGINE_BANLIST`), as `ENGINE_GAME_MODE` is.
- **No bare `local x` in a for-in loop body** (MoonSharp keeps the looped table: write `local x = nil`). Gate:
  `test_moonsharp_loop_locals`.
- **Plain `string.find(s, x, 1, true)` only**: no patterns with captures (MoonSharp "pattern too complex"). Format
  names from chat are matched by lower-casing and comparing whole words to the `FORMATS` list.
- **No WebRequest on the table.** The bridge fetches. If one is ever added, the callback's request is a userdata in
  real TTS, not a table (`tools/deckcheck.lua:139`): never `type(req) == "table"`.
- **UI budget:** no screen-XML changes, so `tests/test_ui_budget.js` must pass unchanged (its ratchet would catch
  growth). The Notebook carries the long list.
- **Object buttons:** buttons on the tile follow `setupButton` with `tileTurn` (x negated, the tile's half turn,
  `:9958-9981`); on playmat zones x is mirrored too (`tts-zone-button-x-mirrored`). `engineSetupIntact`
  (`:9877-9897`) counts the tile's buttons: raise its expected count by the new ones, or the 2 s heal redraws
  forever.
- `engineSendDecks` and `engineStartGame` (`tools/make-engine-copy.js:876`, `:399`) send `format`, `banned`,
  `restricted` beside `mode`. The table sends nothing new for Casual Commander (the bridge's default), so Commander
  games' goldens stay byte-identical.
- Deploying: Global only (`tools/patch-save.js`); no object script changes, so no wiping push.

## 7. Multiplayer

- **Who picks:** the host (host, admin or promoted, as every other setup switch). Everyone sees the Format, Banned
  cards and Restricted labels on the tile, and the broadcast on each change.
- **Each seat's deck is checked separately** at its READY, under the table's current rules. Start needs every seated
  player's deck checked under the same rules hash (§6.3).
- **2HG and team modes:** every player's own deck is checked. The format's game mode must suit the team mode, as
  today (`teams2hg.teamModeProblem`, `bridge/bridge.js:2296`). Picking a 60-card format drops 2HG back to none,
  exactly as switching Game mode to Standard does now (`tools/engine-renderer.lua:10215-10225`).
- **AI seats:** §3.3. **Best of three:** sideboards are checked with the main deck at READY. Sideboarding between
  games re-checks the new deck under `game.rules` (the existing best-of-three check runs `standardProblems` at
  `bridge/bridge.js:1600`: it calls `formatProblems` instead).
- The companion page shows the format and the list date. Its own deck chooser lists only presets legal in the format.

## 8. Tests (the project's style; each check broken once by a mutation script)

1. **`tests/test_bridge_legality.js`** (new; pure, no network):
   - `reduceOracleLine` on a hand-made JSONL fixture `tests/golden/fixtures/oracle-sample.jsonl`. About 20 real card
     names, statuses written by hand, the documented shape. It covers:
     - a double-faced card under each face's name;
     - an "A-" Alchemy card;
     - a card with `restricted`;
     - an un-card `not_legal` in Commander;
     - a line that isn't JSON (skipped, counted).
   - The golden is `tests/golden/legality-cache.json` (the reduced file).
   - `loadLegality` fallback order: cache → Forge file → none; a corrupt cache falls back and is logged.
   - `formatProblems` per shape and status: banned on/off, restricted on/off (Vintage 4× vs 1×; Duel Commander
     commander vs 99), not legal with each reason word, a name missing from the cache (a warning), 100-card and
     singleton problems in Commander formats vs warnings in Casual.
2. **`tests/test_bridge_formats.js`** (new; through `tests/bridge-harness`, as `test_bridge_standard.js`):
   - `format` / `hello` / `decks` / `start` messages;
   - the alert text (§5.2) as a golden per format;
   - `deckReport` ready/checked;
   - `startGame` refusing a deck checked under other rules;
   - a refresh between READY and Start that bans a card in a ready deck (dropped, alert, red report);
   - the resume file's `rules`;
   - the `banlist` / `banlistNames` messages;
   - an older table's messages (no `format`) = today's Commander check, byte-identical to `test_bridge_golden.js`.
3. **`tests/test_bridge_legality_refresh.js`** (new; `fetch` stubbed, worker run in-process):
   - same `updated_at` → no download;
   - newer → download, reduce, rename, hash changed → one "updated" chat with per-format counts;
   - newer but same hash → silent;
   - offline / 429 with `Retry-After` / 500 / truncated gzip → cache untouched;
   - a refresh due mid-game waits for the game's end;
   - a 12 h timer that never runs twice at once.
4. **`tests/test_table_formats.js`** (new; fake TTS, `tests/lua/run-sim`):
   - the Format button cycles both ways (alt-click) and skips formats with no list;
   - host only;
   - the two switches per format, defaults on, Restricted shown only where it applies;
   - labels and broadcasts;
   - READY cleared on every change;
   - `engineSetupIntact` with the new button count (no redraw loop: the signature is stable over 10 heals);
   - the Notebook tab written, rewritten on `banlistNames`, found by title;
   - the messages sent carry `format`/`banned`/`restricted`;
   - 2HG dropped by a 60-card format.
5. Existing gates kept green: `test_bridge_standard.js` (Standard is now a format: its expectations stay),
   `test_table_standard.js`, `test_table_team_modes.js`, `test_ui_budget.js`, the table and bridge goldens,
   `test_moonsharp_loop_locals`, the locals-count gate.
6. **Break-it:** `tests/mutate-formats.js`, as `tests/mutate-standard.js`. Each mutant must fail at least one test:
   - each status check off: banned, restricted, not legal;
   - each switch inverted;
   - the rules hash left out of `readyFor`;
   - the re-check after a refresh left out;
   - the face-name index left out;
   - the fallback order swapped;
   - the "never mid-game" guard removed;
   - the host check removed;
   - the READY reset removed;
   - the Notebook rewrite removed.
7. **Live smoke, by hand only:** `tools/legality-smoke.js`. It runs one real metadata check and download into `tmp/`,
   and prints per-format counts against §3.1's table, to catch Scryfall shape drift (e.g. a renamed key). Never in the
   gates, because of network and Scryfall's limits.
8. **Live on the real table:**
   - the buttons' spots on both tables (`tools/tts-shot.ps1`);
   - a Modern deck with a banned card going red with the alert, then allowed with Banned off;
   - a Vintage 4× restricted card;
   - the Notebook tab;
   - a 1v1 to the end.

## 9. Later (not in this work)

- **Brawl and Standard Brawl:** Forge has a Brawl variant (25 life, `forVariants`), but the bridge always sends a
  Commander or Constructed start. Needs a third game mode through relay and node, and 60-card commander decks for
  Standard Brawl.
- **Oathbreaker:** a signature-spell zone on the table and the Oathbreaker variant end to end.
- **Starting life per format** (Duel Commander, Pauper Commander), via a node/relay life override.
- **Colour identity and commander eligibility** from the cache's `identity` and type line (§3.3).

## 10. Open questions for the owner

1. **Default format.** Today a Commander game checks no ban list. Should the table start on **Commander (bans
   enforced)**, which may stop decks your group plays now (Dockside Extortionist, Mana Crypt, Jeweled Lotus, Nadu are
   on the list), or on **Casual Commander** (today's behaviour) with Commander one click away?
2. **"Allow banned cards" and not-legal cards.** As proposed, Banned off allows only banned cards. A card from outside
   the format (e.g. a Modern card in Pioneer) still stops the deck; the way to play anything is the Casual format.
   Is that what you want, or should Banned off also let not-legal cards through?
3. **Commander deck shape.** In the named Commander formats, should a deck that isn't exactly 100 cards, or has two
   of a non-basic card, **stop** the game (proposed), or stay a warning as it is now?

## 11. Effort (estimate, tests included)

| Part | Hours |
|---|---|
| `bridge/legality.js` + worker: reduce, cache, fallback, refresh timer, hash and summary | 6-8 |
| Forge fallback: `build-forge-card-index.js --formats` for the 14 Forge formats (Casual and Archived paths) | 1-2 |
| `formatProblems`, `checkDeck`, `readyFor` rules hash, re-check after refresh, wording, presets per format | 4-6 |
| Table: Format button (replacing Game mode), two switches, Banned list button, Notebook tab, messages, spots on both tables | 5-7 |
| Tests 1-4, goldens, mutation script, smoke script | 6-8 |
| Live checks on both tables, doc and engine-changes note (no engine change: bridge and table only) | 2-3 |
| **Total** | **24-34** |

No engine, relay or node change. The deploy is a bridge restart plus a Global patch.

## 12. The owner's decisions (2026-11-18)

1. **Default format: Casual Commander** (today's behaviour). Commander with bans enforced is one click away.
2. **"Allow banned cards" lets only banned cards through.** A card from outside the format's sets still stops the deck;
   the way to play anything is a Casual format. (The restricted switch is separate, as §1 says.)
3. **Commander deck shape stops the game** in the named Commander formats: a deck that isn't exactly 100 cards, or has
   two of a non-basic card, is a problem (red, no Start), not a warning. Casual Commander keeps today's warnings.

### Work split (three pieces in parallel, then review, merge, one deploy)

- **A, the ban list data** (§4, §6.3 data parts): `bridge/legality.js` + worker, Scryfall bulk refresh, cache,
  Forge fallback, content hash and change summary, `mtg banlist refresh`. Tests 1 and 3 (§8).
- **B, the deck check** (§3, §5, §6.3 check parts, §7): the format list and its game modes, `formatProblems`,
  `checkDeck`, `readyFor` rules hash, re-check after a refresh, the wording, the two switches' effect, the decisions
  above. Test 2 (§8). B codes against A's interface in §6.3 (a stub until A lands).
- **C, the table** (§6.1, §6.2): the Format button replacing Game mode, the two switches, the Banned list button and
  its Notebook tab, messages; placed with screenshots on both tables. Test 4 (§8).
