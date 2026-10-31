# Review notes: Global, Card Importer, deck tools

Source: subagent review, 2026-10-17. Files are in `table-scripts/`; line numbers refer to those files.

## _Global.lua (2804 lines)

- **`data[color]` registry (43-121) → REUSE.** Holds zone GUIDs per color: library, graveyard and playmat. Also the button GUIDs (mulligan, untap, draw, scry, mill, reveal), the spawn positions in `props`, and `deckDirs`. Exile sits at library pos + forward×4.16 and the graveyard at forward×−4.14 (33-39). About 12 scripts read it through `Global.getTable('data')`.
- **onload (2-40) → KEEP, but gate the load-time flip.** It flips the cards in the Encoder "_1" hand zones face down.
- **onPlayerDisconnect (125-134) → KEEP.** Flips the hand face down.
- **Table buttons → DISABLE in engine mode; reroute to engine prompts.** Draw `draw1` (726), Mill `mill1` (749), Scry `scry1` (777), Reveal fan/stack (467-534), and Untap (644-710, with hard-coded untap exceptions and stun/exert handling via the Encoder). Mulligan (565-640) has no London bottoming and is optionally rigged by `smartMulligan`.
- **Reuse these animation primitives:** `getCardFromZone` (808-840), `deal()`, `setPositionSmooth`, the `checkMoveSuccess` teleport fallback (878-894), `buttonPress`/`buttonCooldown` (855-875), `highlightOn`, the reveal fan math (487-497), and `checkPosMove` (536-562). Engine-owned objects have to be unlocked while animating.
- **Hotkeys `onScriptingButtonDown` (283-325) → DISABLE.** 0 = end turn (`Turns.turn_color`). 1-6 = untap, draw, scry, mill, reveal. 7/8/9 = to graveyard / exile / library bottom. Key 0 could be rerouted to "pass priority".
- **`onObjectHover` (392) → REUSE** for picking targets.
- **`onObjectEnterZone`/`LeaveZone` (1008-1098) → MUST GATE FIRST.** They call `clearContextMenu()` on every card or deck that enters or leaves a zone, which would wipe the engine's context-menu actions. They also add these context items:
  - Make Token Copy (1272), Cascade, Reveal until Type, Get Basic (1145-1251) and Random Discard (1389) → DISABLE.
  - Sort Hand by CMC (1323) → KEEP. It's cosmetic.
- **Global context items (979-993) → KEEP.** "have a response" could become a "hold priority" request.
- **Cascade / Reveal-until-type (1460-2152, XML panels) → DISABLE.** The ✓/✗ on-card button pattern is worth reusing for engine yes/no prompts.
- **onChat (2156-2188) → DRIVE `Turns.turn_color` from the engine** and ignore the "my turn"/"your turn" commands.
- **Hard-coded account permission at 2158-2163.** Steam ID <table author Steam ID> typing "promote me" is auto-promoted. Remove it.
- **Legacy Scryfall search panel (2194-2552) → dead code.** No "MTG Importer" object exists.

## Card Importer 6.6 (4064 lines; Amuzet, rewritten by Vokerr and Pie)

**Verdict:** REUSE its card format and lookup approach (copy it, don't call it). DISABLE in-game spawning in engine mode.

**Inputs:** chat starting with "Scryfall"/"Importer": names (fuzzy), `name (SET) num`, oracleid, UUID, image URL, and `deck <url>`. Supported deck sites:
- Archidekt `api/decks/<id>/small/` (1714)
- Moxfield `api2.moxfield.com/v2/decks/all/<id>/` with a Referer header (1762)
- deckstats, pastebin, mtgdecks, deckbox, tappedout, mtggoldfish, cubecobra (2999)

Bare `deck` reads the newest Notebook tab. Other commands: token, print, text, rawdeck.

**Hosts it calls:**
- Images: `img.klrmngr.com/large/{front|back}/<u1>/<u2>/<scryfall-uuid>.jpg` (544).
- Card index: `raw.githubusercontent.com/Oops-I-baked-a-pie/Tabletop-Simulator-Scripts/master/Magic/CardIndex`. Uses sharded lookups by name, set-collector and oracle; shard key = djb2 % 256 (164).
- Tokens: `pub-6c935b50ab2c43f291df08b7f566585b.r2.dev` (`token-cdn-defaults.json`, token shards).

**Card object template (`Card` class, 2758-2929):**

| Field | Value |
|---|---|
| Name | `Card` |
| Nickname | `"<Name>\n<type line>\n<cmc>CMC"` |
| Description | oracle text (`"`→`'`) plus `\n[b]P/T[/b]` |
| Memo | `<oracle_id>[|tokens:<uuid>,…]` |
| Tags | `oid:<oracle_id>` |
| CustomDeck | FaceURL = Kai CDN (contains the Scryfall printing UUID), BackURL = `DEFAULT_BACK` (steam ugc), 1×1, BackIsHidden |
| States[2] | DFC back face |
| AltLookAngle | split/battle/room/planar cards |

Set code and collector number are **not** stored on the object; the UUID can only be recovered from FaceURL (`uuidFromCdnUrl` 590).

**Decks:** `spawnDeckEntries` (1656) spawns one card every 0.2 s, so a 100-card deck takes 20 s or more. The deck appears at the pointer, face up. Commanders are **not** marked: Moxfield commanders are simply placed first, and Archidekt maybeboard rows probably leak in.

**For the engine:**
- (a) Build the same `spawnObjectData` in the bridge/Global with an explicit position and a callback that returns the GUID. Same URLs means TTS reuses its image cache.
- (b) An imported deck converts as: name = first line of Nickname, UUID from FaceURL, oracle from Memo. Set and collector number then come from the CDN `set-collector` shard or Scryfall. Better: have the bridge fetch Archidekt/Moxfield itself, which also gives scryfall_id and the commander.
- (c) In engine mode, gate the importer's `onChat` and Encoder buttons on `Global.getVar('engineMode')`, and allow deck import only before the game.

## Smaller scripts

| Script | Verdict | Notes |
|---|---|---|
| get_deck_data | pre-game only | Unthrottled Scryfall requests, rewrites card metadata |
| Deck_Lister | KEEP, pre-game | Writes "1 Name" lines to Notebook |
| Tutor, get_basic_land, get_non-basic_land | DISABLE | takeObject + shuffle |
| CardCustom | KEEP | Secret number |
| Card_Size_Multiplier | KEEP | Scales cards 2× on the playmat; the renderer must account for it |
| rikrassen Deck/Draft/Cube Importer | DISABLE/pre-game | **SECURITY:** spawns remote server object JSON unchecked; rewrites the Global UI XML (`UI.setXmlTable`) |

## Security summary

1. Hard-coded permission in Global at 2158 (auto-promote for one Steam ID).
2. Easy Modules: any player typing "force importer update" or "force encoder update" overwrites the importer's or Encoder's code with code downloaded from GitHub (`_FFCC00_…b93b40.lua:393-397`).
3. rikrassen's importer spawns object JSON from a remote server.
4. The Card Importer itself runs no downloaded code, but it depends on 3 third-party CDNs.

## Open questions

- Does Global `onChat` returning false stop object `onChat` handlers?
- Does the Archidekt `/cards/` response include category or maybeboard fields?
- How should the library be shown: a mirrored face-down TTS Deck, or placeholder cards?
