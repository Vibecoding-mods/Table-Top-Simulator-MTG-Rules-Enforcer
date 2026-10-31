# Review notes: Encoder, Easy Modules, enablers

Source: subagent review, 2026-10-17. Files are in `table-scripts/`.

**Where these scripts live:**
- Loose on the table (always running): Encoder 02e062, Easy Modules b93b40, πKeywords ae12d3, Morphin' Time ad044a, Phasing c2df33, Is-it-a-token 716ee6, Sticker Encoder c5ea55.
- Inside bag **4f3387** (inert until taken out): all Enablers, plus Mass Face Down, Possibility Storm, Card Stamp, moon-equip, Tovoloar and Scrambleverse.
- Inside bag **b35666**: Krark's Coin Flipper.

## Encoder (02e062, v4.6.1) → REUSE as the overlay write API

- **Where state lives:** in the Encoder, not on the cards: `EncodedObjects[guid] = {values, encoded, flip, disable…}` (49-62). It is saved in the Encoder's `onSave` (289-341), keyed by GUID. `Object.call` returns copies.
- **How to reach it:** `Global.getVar('Encoder')` (set at 130) or `getObjectFromGUID('02e062')`.
- **API** (`enc.call(name, tbl)`):

| Call | Line | Purpose |
|---|---|---|
| `APIencodeObject{obj}` | 1087 | Start tracking a card |
| `APIobjectExists` | 1091 | Is the card tracked? |
| `APIobjEnableProp{obj,propID}` | 1176 | Turn a module on for the card (seeds its defaults) |
| `APIobjDisableProp` | 1186 | Turn a module off |
| `APIobjIsPropEnabled` | 1140 | Is the module on? |
| `APIobjGetPropData{obj,propID}` | 1234 | Read the module's values |
| `APIobjSetPropData{obj,propID,data}` | 1247 | Write the module's values |
| `APIobjGet/SetValueData` | 1208/1220 | Read/write single values |
| `APIobjGet/SetAllData` | 1259/1266 | Read/write all values |
| `APIrebuildButtons{obj}` | 1436 | Redraw the card's overlay |
| `APIFlip` / `APIgetFlip` | 1447 | Which face shows the overlay |
| `APIdisableEncoding` / `APIenableEncoding` | 1457 | Suspend/resume the overlay |
| `APIregisterProperty/Value/Menu/Zone` | — | Register a module |

- **Validation:** number and boolean values of the wrong type are silently ignored; `'nil'`-typed values pass through unchecked (791-813).
- **`buildButtons` runs `clearButtons()` and `clearInputs()` on every rebuild** (643). For engine buttons on a card, register an Encoder property such as `propID='Engine'`, or use object XML UI.
- **Hooks:** zone enter/leave on hand zones, `onObjectLeaveContainer` (483) and `onObjectDropped` (517).

## Easy Modules Unified (b93b40, pID `_MTG_Simplified_UNIFIED`, value `tyrantUnified`)

Draws per-card overlays: P/T, the +1/+1 badge, a generic/loyalty/defense counter, planeswalker ability buttons, an owner/controller gem, the DFC face, copy/reimport/tokens.

**Data fields** (311-356):

| Field | Meaning |
|---|---|
| `hasParsed` | false = re-parse from the card text on next draw |
| `activeFace` | which face is showing |
| `doubleFaceType` | DFC kind |
| `cardFaces[i]` | `{basePower, baseToughness, isPlaneswalker, isBattle, pwAbilities, pwCount}` |
| `power`, `toughness` | **deltas** added to the base |
| `plusOneCounters` | shown as a separate badge |
| `namedCounters` | loyalty / defense / other counter |
| `display*` flags | which parts are visible |
| `ownerColor`, `controllerColor` | seat colours |

Displayed P/T = `tonumber(basePower) + power` (~1286). Base values are parsed once from the description (`ParseCardData` 2378-2620).

**Recipe for driving it from the engine:**
1. `getObjectFromGUID('b93b40').call('TryTimedEncoding', card)` (2685). Engine-spawned cards are never auto-encoded, because that only happens on a player drop (2668).
2. `d = enc.call('APIobjGetPropData', {obj=card, propID='_MTG_Simplified_UNIFIED'}); t = d.tyrantUnified`.
3. Write the engine values:
   - `t.hasParsed = true`
   - `t.cardFaces[t.activeFace].basePower` / `.baseToughness` = the engine's P/T; `t.power = 0; t.toughness = 0`
   - `t.plusOneCounters = p1p1 - m1m1`
   - `t.namedCounters` = loyalty, defense or the main counter
   - `t.displayPowTou`, `t.displayCounters`, `t.displayPlusOne`
   - `t.controllerColor` / `t.ownerColor`
   - `t.activeFace`
4. `enc.call('APIobjSetPropData', {obj=card, propID=PID, data=d})`, then `APIrebuildButtons`.

Sticker Encoder line 180 already writes P/T this way.

**Hooks to watch:**
- `onObjectSpawn` (2673) sets an object table, and **`CheckRevertInvertedFaces` swaps the URLs and `reload()`s the card if its face URL contains "/back/"** (2823). Spawn cards with the correct face.
- `onObjectEnterScriptingZone` (2845) guesses deck owners. Not needed in engine mode.

**Gate in engine mode:**
- All `Receive*Click` handlers that change counters or P/T (2072-2165).
- The gem/controller/ownership handlers (2038-2059).
- `ReceiveChangeActiveFace` (1968; `setState` produces a new object).
- `MakeExactCopy` (2167) and `ReImport` / `EmblemsAndTokens` (2301/2339).
- **Reroute** `ReceivePlaneswalkerClickSlot1-4` (2096-2122) to the engine's "activate loyalty N".
- Keep the `ToggleDisplay*` handlers (1905-1966).

## πKeywords (ae12d3) → DRIVE-FROM-ENGINE

- Values: `mtg_stuncounter`, deathtouch, defender, doublestrike, firststrike, flying, haste, hexproof, indestructible, lifelink, menace, reach, suspend, trample, vigilance (numbers), plus `mtg_exert`, `mtg_frozen`, `mtg_monstrous`, `mtg_renowned` (booleans), `activeIcons` (list), `iconMenuOn`, `iconLayout`.
- **Write sequence:**
  1. `APIobjEnableProp{propID='πKeywords'}`
  2. Get the data, then set the values and `activeIcons`
  3. Set the data
  4. **`getObjectFromGUID('ae12d3').setVar('updateDecals', true)`**
  5. Rebuild
- Gate the `toggleStatus*` and `toggleIconMenu` clicks (210, 197).
- **Global's Untap reads these values as rules logic** (stun, frozen, exert). Disable it.

## Others

| Script | Verdict | Notes |
|---|---|---|
| Morphin' Time (ad044a) | DRIVE visual; DISABLE player entry points | Drive with `genericFlip{card, mode}` (412), `genericChangeMode` (433), `genericFlipUp` (429); these toggle, so check `APIobjIsPropEnabled` first. It **renames cards** (setName/setDescription), so match by GUID. Disable the "Morph/Disguise/Flip Over" context items it adds to every card. Leak risk: it's the real card flipped, so spawn generic face-down proxies for opponents instead |
| Mass Face Down (bag) | DISABLE | Reference call pattern at 98-105 |
| Phasing (c2df33) | DRIVE | `MTG_Phase` / `mtg_phased`. Gate `unPhased` (223). **Self-updates from GitHub** (247-264) |
| Is it a token (716ee6) | DRIVE | `MTG_Token` / `mtg_token`. Gate `toggleToken` (326) |
| Sticker Encoder | KEEP | Reference for the P/T formula |
| Card Stamp | KEEP | Doesn't unlock locked cards (233) |
| moon-equip (bag) | DISABLE; REUSE layout | `addAttachment` absorbs objects. Layout: `equipped_offset(i) = Vector(-1.65-1.15*floor(i/3), 0.05-(i%3)*0.0167, -0.75+(i%3)*0.733)`, scale 0.475, at `host.positionToWorld` |
| Possibility Storm (bag) | DISABLE | Adds a context item to all cards |
| Enablers (bag 4f3387): Cascade, Jodah, Chaos Wand, Planar Bridge, Oath of Druids, Atla Palani, Indomitable Creativity, Manifest/Cloak, Mindmoil, River Sol | DISABLE | Drop on a deck → takeObject/shuffle/move. Gate in Global `onObjectLeaveContainer` when the container is 4f3387, or leave the bag out of the engine-mode save |
| Tovoloar (day/night) | DISABLE | `setState` swaps objects |
| Scrambleverse | DISABLE; REUSE grid | `playmat.pos + right*(nRight*-2.4+10.75) + forward*(nDown*3.2-8)`, 10 per row (208-216) |
| Krark's Coin Flipper | KEEP, cosmetic | Engine's random number generator decides |

## Security (remote code)

1. **Easy Modules `onChat` (376-402): any player** typing "force encoder/importer update/temporary" fetches Lua from GitHub and replaces the Encoder's or Importer's `script_code`. No admin check.
2. **Encoder onLoad** (266-282) checks GitHub every time. If no menu module registers within 2 frames, it downloads and spawns `Encoder_Menu_Default.lua` (438-453). The admin "Update" context item replaces all module scripts (345-390).
3. **Phasing** `updateModule` runs downloaded code or self-destructs.
