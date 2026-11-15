# M6 comparison: 4-player Global/XmlUI vs 6-player Global/XmlUI

Read-only comparison, 2026-11-15. Sources: Workshop 2296042369 ("4p", our base) and 2293586471 ("6p"), both under
`Documents/My Games/Tabletop Simulator/Mods/Workshop/`. Neither file was changed. Line numbers below are in the scripts
extracted with Node to `(scratchpad)/m6cmp/`:
`4p.lua` (2803 lines), `6p.lua` (2799), `4p.xml` / `6p.xml` (394 each). `diff 4p.lua 6p.lua` is 250 lines; every
difference is covered in section 1.

## Short answer

- **XmlUI: byte-identical** (13,963 characters, 394 lines, `diff` prints nothing). Nothing seat-specific in it: no colour
  names, no seat ids, every `visibility=""`. No 6-player XmlUI work is needed beyond the UI-size work already in the spec.
- **Global: the 6p script is an older revision of the same author's script** with the seat data swapped. Of the 250 diff
  lines, most are the `registerObjectGUIDs` block, `props`, `deckDirs`, the seat list and the layout constants; the rest are
  4p-only newer features the 6p script lacks (Wastes, the `flash` fix, the `checkPosMove` guard, `getCMC` special cases).
  One function exists in only one script (`deckRampWa`, 4p); nine differ in body.
- **"6 seats" in Global comes from four tables**: `buildDataStructure`, `registerObjectGUIDs`, `props`, `deckDirs`. Every other
  function loops over `data` / `pairs(data)` and follows the seat count by itself. There is no hard-coded
  `White/Red/Yellow/Blue` list anywhere in either Global.
- **The save, not the script, holds most of the seat knowledge** (hand zones, life trackers, commander zones, highlight mats,
  hand counters, timers, damage objects). Our project hard-codes the 4p versions of those (section 4).
- **Running `make-engine-copy.js` on the 6p file today fails 4 gates and writes nothing** (4.1).
- Spec section 2.1 is mostly right. Real gaps: it flags the playmat and life-tracker GUID traps but not the library,
  mulligan, reveal, commander-zone (tax) and hand-counter traps, and not that the two Global scripts are different revisions
  (section 5).

## 1. Global script

104 top-level functions in 4p, 103 in 6p.

### 1.1 Only in one table

| Function | Where | What |
|---|---|---|
| `deckRampWa(ply)` | 4p.lua L1235-L1253 | Context-menu action "Get Basic Wastes" (takes a Basic Wastes out of the deck at `deckDirs[ply]*2.4`). Registered by `addLandContextMenus` (4p L1139-1141). 6p has neither. |

Nothing exists only in 6p.

### 1.2 Functions whose body differs

| Function (4p line / 6p line) | How it differs |
|---|---|
| `onload` (4p L2-L40 / 6p L2-L39) | (a) First non-interactable GUID list: 4p `{'cb1610','a7a029','4c02f8','a3e6a8','9c553c','eb479b','3d4319','540e21'}`; 6p `{'eb479b','f72932','3da261','5f75f7','06d2e0','c42075','a3e6a8','cb1610','3d4319','540e21'}`. a7a029, 4c02f8, 9c553c are not in the 6p save; f72932, 3da261, 5f75f7, 06d2e0, c42075 are (unnamed Custom_Assetbundles under the table: corners plus (0,+-58) on 6p). (b) The "-- flip hands on load" comment is gone in 6p (code identical). (c) **Layout constants** (the `4pl` / `6pl specific vars` block, 4p L32-L39 / 6p L31-L38): `revealNrow` 12/12, `revealUp` 15.5 -> 18, `revealUpS` 3.1/3.1, `revealRi` 1.5 -> 0, `exileRot` -180 -> -90, `exileFor` 4.16 -> 3.17, `gravFor` -4.14 -> -3.6. They are globals used by `revealFan`/`revealStack` (row position `lib + fwd*(revealUp+revealUpS*row) + right*deckDirs*2.25*(col+revealRi)`, 6p L519), `move2exile` (6p L486-487) and `move2grav` (6p L453): distances from the library zone, tuned to each table's mat and library geometry. |
| `buildDataStructure` (4p L43 / 6p L42) | Seat list: 4p White, Red, Yellow, Blue; 6p White, Red, Yellow, Green, Blue, Purple. This is the seat order; `pairs(data)` is how every other function iterates seats. |
| `registerObjectGUIDs` (4p L53-L97 / 6p L54-L116) | 9 GUID fields per seat (library zone, graveyard, playmat, mulligan, untap, draw, scry, mill, reveal): 36 on 4p, 54 on 6p. Full tables in 1.4. |
| `props` (4p L100 / 6p L119) | Card-importer spawn points per colour (read by `spawn`, 4p L2392 / 6p L2388; `spawn` picks `main` when `isPart`, an existing quirk in both). 4p: White x=25.5/22.5, Red -25.5/-22.5 (z=-5, rotY 180), Yellow -25.5/-22.5, Blue 25.5/22.5 (z=5, rotY 0). 6p: White 25/28, Red -5/-2, Yellow -35/-32 (z=-5, rotY 180), Green -25/-28, Blue 5/2, Purple 35/32 (z=5, rotY 0). `part` differs from `main` by 3: on 4p always toward the centre (25.5 -> 22.5, -25.5 -> -22.5); on 6p +3 in the south row and -3 in the north row (White 25 -> 28, Green -25 -> -28), i.e. not mirrored. |
| `deckDirs` (4p L118 / 6p L145) | Sign on `libZone.getTransformRight()` for "next to the deck": 4p White -1, Red **+1**, Yellow -1, Blue **+1**; 6p all **-1**. Used in `revealFan`/`revealStack` (6p L519), `checkPosMove` callers (6p L553), the `deckRamp*` functions (`rig:scale(deckDirs[ply]*2.4)`, 6p L1173..1245), `discardCard`/`cascade` offsets (6p L1615, L2027), and by the object script "table playmat enabler" (0ae315). |
| `move2grav` (4p L397 / 6p L426) | Card rotation after "move to graveyard": 4p `libraryZone.rot.y + exileRot` (-180); 6p hard-codes `+ 180`. Same angle modulo 360 on 4p; on 6p `exileRot` is -90 and is used only by `move2exile`, which is why graveyard got its own literal. Do not unify the two. |
| `checkPosMove` (4p L536 / 6p L564) | 4p only nudges a hit card when `math.abs(objPos.z) > 7` (4p L551); 6p has no guard (6p L579-585). On 6p the mats are nearer the centre line and the zones overlap more, so the missing guard can push cards sitting elsewhere. |
| `playerUntap` (4p L644 / 6p L670) | 4p resets `flash = false` per card (4p L654) and sets `flash = true` in the stun / frozen / exert branches (L661, 670, 676, 691, 695; the final `if untaps == false and flash == true` at L701). 6p has no reset, so the global `flash` carries over from the previous card in the loop and the flash can fire on a card that did untap. |
| `addLandContextMenus` (4p L1100 / 6p L1124) | 4p tracks `wastes` as a sixth basic (4p L1101, L1119-1121) and adds "Get Basic Wastes" (L1139-1141). 6p: five basics only. |
| `getCMC` (4p L1888 / 6p L1887) | 4p adds `if cmc==nil and (desc has 'suspend' or name has 'pact' or 'evermind') then cmc=0` (4p L1903-1905). |

### 1.3 Everything else is identical

Including `onPlayerDisconnect`, `buildTableButtons` and `onObjectNumberTyped` (both loop over `data`),
`createTableButton*`, `onChat` (the 'promote me' Steam-ID line; `your turn <colour>` uses `Player.getColors()`),
`playerMulligan`, `playerDraw/Mill/Scry`, `getHand2Pos`, the `Turns.*` uses (6p L314-322, L1465, L1914, L2162-2179; none lists
colours), `cascade`, `revealUntilType`, `show`/`visibleOpenRules` (builds panel ids `color .. "Counter"` that exist in neither
XmlUI: a dead path on both), `fixDeck`, and the importer glue.

Checked by grep: after the four tables above, the only colour literals left in 6p.lua are `colorIds = {vWhite="W",...}` (L2226,
card colours, not seats) and `"Grey"` (L2469). Turn order is not scripted (TTS's `Turns`); the save's `Turns.TurnOrder` is `[]`
on both, so TTS uses seat order.

### 1.4 Hard-coded GUID tables and positions in Global


**4p Global `registerObjectGUIDs` (4p.lua L53-L97)**, with each object's x,z in the save:

| Colour | libraryZone | graveyard | playmat | mulliganButton | untapButton | drawButton | scryButton | millButton | revealButton |
|---|---|---|---|---|---|---|---|---|---|
| White | 166036 (40.8,-18.8) | 68549d (40.8,-22.9) | 8b3401 (19.4,-15.4) | 3b07ae (13.0,-26.5) | 18fb5d (19.0,-27.0) | 26775a (21.0,-27.0) | 614515 (23.0,-27.0) | 57914a (25.0,-27.0) | d67eb4 (27.0,-27.0) |
| Red | 2365d0 (-40.7,-18.8) | 07dd80 (-40.8,-22.9) | c20e3f (-19.4,-15.4) | c53ac6 (-13.0,-26.5) | 86e447 (-27.0,-27.0) | 885f49 (-25.0,-27.0) | ffa67c (-23.0,-27.0) | da5d0d (-21.0,-27.0) | 0ad181 (-19.0,-27.0) |
| Yellow | 033b34 (-40.8,18.7) | 8b439a (-40.8,22.9) | 129eaa (-19.4,15.4) | 47645d (-13.0,26.5) | 1f3e4a (-19.0,27.0) | 305c12 (-21.0,27.0) | 8a4c8b (-23.0,27.0) | 67b4a5 (-25.0,27.0) | 59ab68 (-27.0,27.0) |
| Blue | c04462 (40.8,18.7) | debc40 (40.8,22.9) | 56cd9d (19.4,15.4) | e0a3bc (13.0,26.5) | e2f7ae (27.0,27.0) | b49d50 (25.0,27.0) | 4e19c8 (23.0,27.0) | d06889 (21.0,27.0) | c489e1 (19.0,27.0) |

**6p Global `registerObjectGUIDs` (6p.lua L54-L116)**, with each object's x,z in the save:

| Colour | libraryZone | graveyard | playmat | mulliganButton | untapButton | drawButton | scryButton | millButton | revealButton |
|---|---|---|---|---|---|---|---|---|---|
| White | 409503 (41.8,-20.1) | 7c926c (41.8,-23.7) | 7cffe1 (27.3,-14.9) | 23ac26 (19.6,-26.6) | 18fb5d (25.5,-26.9) | 26775a (27.5,-26.9) | 614515 (29.4,-26.9) | 57914a (31.4,-26.9) | 77a7c1 (33.3,-26.9) |
| Red | 2365d0 (12.4,-20.1) | 9af898 (12.4,-23.7) | c20e3f (-2.1,-14.9) | 822ab4 (-9.8,-26.6) | e748df (-3.9,-26.9) | a65396 (-1.9,-26.9) | d40eab (0.0,-26.9) | e913ee (2.0,-26.9) | df3848 (3.9,-26.9) |
| Yellow | 166036 (-17.0,-20.1) | f66368 (-17.0,-23.7) | 8b3401 (-31.5,-14.9) | 3b07ae (-39.2,-26.6) | 4c341b (-33.3,-26.9) | 1a75c7 (-31.3,-26.9) | 2b2b11 (-29.4,-26.9) | a7ecfc (-27.4,-26.9) | d67eb4 (-25.5,-26.9) |
| Green | c04462 (-41.8,20.1) | 8fb941 (-41.7,23.7) | 56cd9d (-27.3,14.9) | 18bae8 (-19.6,26.6) | f8f6dc (-25.5,26.9) | abb9f2 (-27.4,26.9) | cf8508 (-29.4,26.9) | ea446d (-31.3,26.9) | c770a1 (-33.3,26.9) |
| Blue | 033b34 (-12.4,20.1) | 46d9bd (-12.3,23.7) | 129eaa (2.1,14.9) | 91ab85 (9.8,26.6) | afd316 (3.9,26.9) | f22818 (2.0,26.9) | aed706 (0.0,26.9) | ab1894 (-1.9,26.9) | 87bc5b (-3.9,26.9) |
| Purple | 60bfe2 (17.1,20.1) | d95d4f (17.1,23.7) | d2aff5 (31.5,14.9) | a05a94 (39.2,26.6) | 4ee479 (33.3,26.9) | 9e9836 (31.4,26.9) | db39e0 (29.4,26.9) | 9f26e5 (27.5,26.9) | 0f77f4 (25.5,26.9) |

**GUIDs that exist on both tables but mean a different seat** (from the two `registerObjectGUIDs` blocks):

| Field | GUID | 4p seat | 6p seat |
|---|---|---|---|
| libraryZone | 166036 | White | Yellow |
| libraryZone | c04462 | Blue | Green |
| libraryZone | 033b34 | Yellow | Blue |
| playmat | 8b3401 | White | Yellow |
| playmat | 56cd9d | Blue | Green |
| playmat | 129eaa | Yellow | Blue |
| mulliganButton | 3b07ae | White | Yellow |
| revealButton | d67eb4 | White | Yellow |

**Same GUID, same seat on both** (safe, but only because the seat did not move): Red libraryZone 2365d0; Red playmat c20e3f; White untapButton 18fb5d; White drawButton 26775a; White scryButton 614515; White millButton 57914a.

**Hand zones** (HandTrigger; two per seat, "main" in front of the mat, "side" at the corner; `getHandTransform()` = index 1, `(2)` = the second):

| Table | Colour | GUID | x,z | rotY | scale |
|---|---|---|---|---|---|
| 4p | Red | 360dc1 | -20.0,-34.5 | 0 | 21.0x5.2 |
| 4p | Red | 640235 | -38.0,-32.0 | 0 | 11.0x1.3 |
| 4p | White | a11f20 | 20.0,-34.5 | 0 | 21.0x5.2 |
| 4p | White | 7295a1 | 38.0,-32.0 | 0 | 11.0x1.3 |
| 4p | Yellow | b798d6 | -20.0,34.5 | 180 | 21.0x5.2 |
| 4p | Yellow | 350f7f | -38.0,32.0 | 180 | 11.0x1.3 |
| 4p | Blue | 993f89 | 20.0,34.5 | 180 | 21.0x5.2 |
| 4p | Blue | bb8c76 | 38.0,32.0 | 180 | 11.0x1.3 |
| 6p | Green | fa1564 | -26.6,35.0 | 180 | 18.4x4.9 |
| 6p | Green | 666e0e | -40.5,32.0 | 180 | 7.9x1.3 |
| 6p | White | 541bb1 | 26.7,-35.0 | 0 | 18.4x4.9 |
| 6p | White | 5b3c39 | 40.6,-32.0 | 0 | 7.9x1.3 |
| 6p | Yellow | 3d19e1 | -32.1,-35.0 | 0 | 18.4x4.9 |
| 6p | Yellow | 41ad09 | -18.0,-32.0 | 0 | 7.9x1.3 |
| 6p | Red | c029b6 | -2.8,-35.0 | 0 | 18.4x4.9 |
| 6p | Red | 25f290 | 11.3,-32.0 | 0 | 7.9x1.3 |
| 6p | Purple | ce0263 | 32.2,35.0 | 180 | 18.4x4.9 |
| 6p | Purple | 272027 | 18.0,32.0 | 180 | 7.9x1.3 |
| 6p | Blue | e3dba4 | 2.7,35.0 | 180 | 18.4x4.9 |
| 6p | Blue | f2a866 | -11.2,32.0 | 180 | 7.9x1.3 |


Other GUID constants in Global: the `onload` non-interactable lists (1.2) and, on both, the delayed list `{'02e062','de4346','d936a8','b93b40'}`
(Encoder, πScry, Easy Modules...; present with the same GUID on both, 02e062 and b93b40 with different script sizes); `3d4319` and
`540e21` (Pirate Cannon; script 12,167 vs 12,104 bytes). No colours, hand-zone GUIDs or turn order are listed in Global. Hard-coded
Steam ID (`onChat` 'promote me', 76561197968157267): identical on both; make-engine-copy removes it. `LuaScriptState` is empty on both.

## 2. XmlUI

`diff 4p.xml 6p.xml` prints nothing. Contents (both): `SearchTypePanel`, `GetValuePanel`, `SearchPanel` (the Scryfall search window; the
`vWhite`..`vColorless` toggles are card colours, not seats) and `ListPanel`; all `visibility=""`. No per-seat ids, no colour-keyed
panels. Global's `visibleOpenRules(color, color .. "Counter")` would use `WhiteCounter`-style ids that exist in neither file.
Nothing to port. (The project's engine UI is built at runtime by `engine-renderer.lua`, not from this XML.)

## 3. The save outside the scripts (what Global relies on)

Object counts: 4p 250, 6p 282. Both `Table_Custom`; Hands Enable, DisableUnused=false, Hiding=0; Turns Enable, Type 0, TurnOrder [].

### 3.1 Sizes

- Playmat ScriptingTrigger scale: **4p 37.00 x 20.75, 6p 24.80 x 22.00**. The engine's battlefield grid (`GRID = {colStep 2.4,
  colStart 10.75, rowStep 3.2, rowStart -8, perRow 10}`, engine-renderer.lua L22) puts card centres at x = +10.75..-10.85 from the mat
  centre, so card edges reach about +-11.9; a 24.8-wide mat is +-12.4. It fits, but only just. Rows 0..4.7 reach z about +7 on a mat 11
  deep: fine. Look at it on the real table before relying on this.
- Library trigger scale 2.25x3.0x3.25 (4p) vs 2.13x3.0x3.09 (6p); hand trigger 21.04x7x5.21 vs 18.41x7x4.90. Hand zones: 8 on 4p, 12 on
  6p, two per seat (the second is the corner "side" zone: `getHandTransform(2)`), with the seat colour in `FogColor` (table in 1.4).

### 3.2 Per-seat objects the Global does not list

| Thing | 4p | 6p |
|---|---|---|
| Life Tracker (script 8,533 B, identical) | 4: White 23e485 (3.5,-2.6), Red 448880 (-3.5,-2.6), Yellow 37e533 (-3.5,2.6), Blue 395037 (3.5,2.6); all near the table centre | 6: White c2e905 (41.8,-5.7), Red 448880 (12.4,-5.7), Yellow 37e533 (-17.0,-5.7), Green 0c1b22 (-41.8,5.7), Blue 395037 (-12.3,5.7), Purple 2ee5fb (17.1,5.7); each in its library zone's x column. 448880, 37e533, 395037 keep their colour; White's changed. |
| Commander Zone (tax button; script 2,156 vs 2,157 B: only `zcoord` -1.8 -> -1.35 and button y 0.03 -> 0.05) | 8, two per seat: White 908f60 (39.5,-8.4), ce8ea5 (42.1,-8.4); Red 9d380e (-42.0,-8.3), 16aed3 (-39.5,-8.3); Yellow baffa9 (-39.5,8.3), dc9c6d (-42.0,8.3); Blue 0c0c5e (42.0,8.3), 3b2d18 (39.5,8.3) | 12, two per seat, in the library column: White **9d380e** (41.8,-13.4), 40584f (41.8,-9.6); Red f9be00 (12.4,-13.4), 9cb4b6 (12.4,-9.6); Yellow ba751d (-17.0,-13.4), 48daef (-17.0,-9.6); Green 206ce5 (-41.8,13.4), 2fa3e2 (-41.8,9.6); Blue 144ccc (-12.3,13.4), 399da3 (-12.3,9.6); Purple 2af6c5 (17.1,13.4), 47e079 (17.1,9.6) |
| Commander Damage | 12 `Custom_Token` "Commander Damage" (script 3,793 B), 3 per seat, at x=+-6.8 near the centre; 8 "<Colour> Commander Damage" bags at x=+-53.8 | **0 tokens.** 12 infinite bags only, 6 per end (x=-52.6 and +52.4), one per colour including Green and Purple |
| Highlight Mat (script 478 B; `getDescription()` = seat colour, tints on `onPlayerTurn`) | 4 at (+-22.3, +-15.4) | 6 at (0/+-29.4, +-14.8); needs a seat-to-object map |
| Hand Counter / (Self) / Screen | 4 each. Counter 2f714c hides itself with `setInvisibleTo({'White','Red'})` (script L24) | 6 each. 2f714c is **Yellow's** here (-32.1,-31) and its script says `setInvisibleTo({'White','Red','Yellow'})` with `editButton({index=ind ...})` where 4p has the newer `index=inds` |
| Timer | 4 (809133, 29f427, 57b8f3, 9df6a3), scripts 5,580 B | 6 (809133, 37dd7e, 252e18, 8a13cc, cbb976, ab15d9), older scripts 3,594 B; 809133 is White's on both |
| Mulligan tile / Untap, Draw, Scry, Mill, Reveal models | 4 each | 6 each |
| Energy, Experience, Poison | at x=+-45.5. Left (x=-45.5): bags 5035f1 b3961f 3cba4d, tokens da1b48 576ccd 94b67a. Right (+45.5): bags 721688 444725 bfceec, tokens f209f9 895bd9 e6f47f | the GUIDs swap ends: bags 5035f1 b3961f 3cba4d and tokens da1b48 576ccd 94b67a are on the **right** (+45.5); the left has new GUIDs (bags e894f7 d31e4a dc2408, tokens b64ac1 a6ae5f 42ef12); the right-hand 4p GUIDs do not exist on 6p |
| Object scripts overall | 110 scripted objects | 112; by content (multiset) 66 match across the tables; 41 are identical with the same GUID. Different: Card Importer 6.6 vs 6.4 (139,540 vs 120,806 B), Encoder (45,687 vs 45,159), Easy Modules Unified, πKeywords (24,219 vs 23,119; two copies on 6p), Notepad, smart mulligan (the 6p one has a typo `smartMulliganas=`), Timer, Hand Counter, Commander Zone, Pirate Cannon, Table Instructions, table playmat enabler. 4p-only: Deck Lister, Bruh Button, Goaded and MtG Treachery bags, a Custom_Tile with a 1,504 B script, 3 "EXPERIMENTAL" PiecePack_Suns |
| Table Instructions (e40450) "remove clutter" | its `unnecessaryStuff` / `moveThese` lists are 4p GUIDs | own 6p lists (include the 6 colour commander-damage bag GUIDs d7dc8e..818de4); destroys eb479b f72932 3da261 5f75f7 06d2e0 c42075 a3e6a8 cb1610 |
| "table playmat enabler" (0ae315; uses Global `deckDirs` and the hand zone) | `hand.right*0.7*deckDirs + hand.forward*19.07`, scaleX 2.3, scaleZ 3.0 | `hand.right*-0.75*deckDirs + hand.forward*20.15`, scaleX 3.57, scaleZ 3.16, another mesh |

Turn order (both tables): seen from above (x right, z up) the seats run along the bottom row right to left, then the top row left to
right, i.e. clockwise. 4p: White, Red, Yellow, Blue. 6p: White, Red, Yellow, Green, Blue, Purple.

Sides: 4p has two seats per side (bottom White, Red; top Yellow, Blue); 6p has three per side (bottom White, Red, Yellow; top Green,
Blue, Purple). The two-headed-giant / team presets "White + Red vs Yellow + Blue" (engine-renderer.lua L744, L820) have no natural
6-seat equivalent: by side it is 3 v 3, but 2HG needs a chosen pairing.

## 4. What our project hard-codes for the 4-player table (needs a 6-player profile value)

### 4.1 An actual run (read only; output went to the scratchpad)

`node tools/make-engine-copy.js <6p.json> <scratchpad>/out6.json` writes nothing when a patch fails, and it did not write. Log:
`scratchpad/m6cmp/run6.txt`. Four failures:

1. `gate Get basic land: not found: deckRampWa`. The gate list names the Wastes function; 6p has no such function.
2. `gate Treachery identity token buttons: 0 functions, not found getToken, getToken1, getToken2`. 6p lacks the MtG Treachery bag scripts.
3. `gate Treachery identity token buttons: not found: red`. Same cause.
4. `hand counters relabel only on change (12)`: expects exactly 8 (`n !== 8`, make-engine-copy.js L811-812); 6p has 12 (6 + 6 Self).

Everything else passed on 6p: the 'promote me' removal, smart-mulligan removal and Global patch, every other engine gate (Draw, Scry,
Mill, Untap, Mulligan, Reveal, hotkeys, zone menus, Cascade, Life counter 6 scripts, Counters, Day/Night, Ring, Dungeon...), Hand-counter
patch on 12 scripts, status pieces parked, no Steam-ID checks left. The side-clutter step removed **138** objects on 6p (including the
12 colour commander-damage bags) because `CLUTTER_BOXES` are coordinate boxes (x +-44..56) that happen to match the 6p end columns too;
that count wants a deliberate look rather than a pass.

### 4.2 Constants to give a profile value (current line numbers)

| Where | Constant | 4p value | 6p value needed |
|---|---|---|---|
| tools/make-engine-copy.js L9-10 | `SRC`, `DEST` defaults | 2296042369, "MTG 4 player table - ENGINE MODE.json" | 2293586471, a new save name |
| L247 | seat loop in the `mtg start ai N` path | `{"White","Red","Yellow","Blue"}` | six colours, clockwise |
| L413-414 | `mtg winner` colour loop and usage text | 4 | 6 |
| L499 | the `mtg` help text (names "White + Red vs Yellow + Blue") | | team help for six |
| L505 | `COMMAND_ZONES` (2 GUIDs per seat) | 908f60/ce8ea5, 9d380e/16aed3, baffa9/dc9c6d, 0c0c5e/3b2d18 | the 12 GUIDs in 3.2 (9d380e is White's there) |
| L811-812 | hand counters expected `8` | 8 | 12 (seats x 2) |
| L820-824 | `SLIM` removal list: Encoder-module GUIDs, 222541, 5a7db4, timers 809133/29f427/57b8f3/9df6a3, bundles eb479b/a3e6a8/a7a029/4c02f8/9c553c/cb1610 | as listed | timers 809133/37dd7e/252e18/8a13cc/cbb976/ab15d9; bundles eb479b/a3e6a8/f72932/3da261/5f75f7/06d2e0/c42075/cb1610; re-check the module GUIDs (ae12d3 and ddd349 are both πKeywords on 6p) |
| L826-829 | `CLUTTER_BOXES` | x[-56,-44] z[-8.5,32]; x[44,56] z[-26,8.5] | measure on 6p (damage bags at x +-52.5, z +-11..19; counters at +-45.5) |
| L838 | `STATUS_SEATS` (per-seat copies of City's Blessing, The Ring, Poison, Energy, Experience) | 4 | 6 |
| L840-849 | `STATUS_PIECES` GUIDs (8963ec, 197ab6, 2db63a, cb418b, d9fcbc, 94b67a, da1b48, 576ccd) and `DAY_NIGHT` 4e8c7b | 4p positions | the run reported the pieces kept (24 parked); Poison/Energy/Experience (94b67a, da1b48, 576ccd) are at the other end of the table on 6p (3.2) |
| tools/engine-renderer.lua L7 | `LIFE_TRACKERS` | 23e485/448880/37e533/395037 | c2e905/448880/37e533/0c1b22/395037/2ee5fb |
| L9-14 | `CMD_DAMAGE` (12 tokens, victim -> attacker) | 12 | none exist (spec 2.4) |
| L15 | `TAX_LABELS` | = COMMAND_ZONES | = COMMAND_ZONES |
| L22 | `GRID` | colStart 10.75, 10 per row | check against the 24.8 x 22 mat |
| L43-55 | `seatGeometry` | reads `data[colour]` plus `Player[color].getHandTransform()` (index 1) | no change; relies on hand-zone index 1 being the zone in front of the mat (true by position in both saves) and on `rotY = hand.rotation.y + 180` (6p hand rotY 0 south, 180 north: consistent) |
| L744, 765-786, 820, 829, 855, 938 | team presets and colour lists (`ENGINE_TEAMS = {White=1,Red=1,Yellow=2,Blue=2}`, `seats = {...}`) | 4 | per-profile |
| L2339-2342 | `TRACK` table (life trackers again) and its seat loop | | profile |
| L8198 | seat loop | | profile |
| L8713 | `SETUP.seats` and the Start tile ("fits the gap between the four life counters") | | profile plus a Start position |
| bridge/bridge.js L1797 | `TABLE_COLORS` | 4 | 6, clockwise |
| bridge/engine-test.js L42; bridge/teams.js L30 | `SEAT_COLORS`; `TEAM_COLORS` | 4 | 6 |
| tools/handplay.lua L5; tools/tts-gesture-test.js L36, L54; tools/tts-inspect.lua L32 | life-tracker GUIDs | 4p | per-table |

The renderer already reads library, playmat and graveyard through `data[colour]`, so Global's `registerObjectGUIDs` block is the
per-table seat table; a profile does not need a second copy of it.

## 5. Spec docs/m6-six-seat-spec.md section 2.1: right, wrong, missing

Right (checked against the saves):
- XmlUI identical (13,971 bytes UTF-8; 13,963 characters). Global 2,800 vs 2,804 lines.
- The seat table: every playmat GUID and x,z, every hand-zone x,z, the north/south sides, the life-tracker GUID per seat and
  its position (the "14 to the right of the mat" is the library column; z = +-5.7).
- GUID traps 8b3401 (White there, Yellow here), 56cd9d (Blue -> Green), 129eaa (Yellow -> Blue), and White's tracker 23e485 -> c2e905.
- No per-seat commander-damage trackers on 6p; 12 infinite bags, six per end at x about +-53; poison/energy/experience: two end sets.
- Older Card Importer (6.4 vs 6.6), Encoder and Hand Counters; same Steam IDs. Clockwise order.

Wrong or imprecise:
- "Only one of the 4-player tax GUIDs (9d380e) exists here": true, but that GUID is a different seat. 4p **Red**'s (-42.0,-8.3) is
  **White**'s on 6p (41.8,-13.4). The 6p table has twelve Commander Zones (two per seat); 11 are new GUIDs, readable by position.
- "Object scripts: 81 of 97 identical": I count 110 / 112 scripted objects, 41 identical with the same GUID, 66 identical by content.
  Not reproducible; it does not change the plan.
- The make-engine-copy line numbers in section 2.3 are stale: the four-colour lists are now L247 and L413 (spec: ~220, ~325);
  `COMMAND_ZONES` is L505 (spec: ~384); `SLIM`/`CLUTTER_BOXES` are L820-L829 (spec: ~689). The renderer colour lists are now at
  L768/786/829/855, L938, L2339-2342, L8198, L8713 (spec: ~1189, ~4900, ~5207).

Missing from the spec:
1. **More GUID traps**: libraries 166036 (White -> Yellow), c04462 (Blue -> Green), 033b34 (Yellow -> Blue); mulligan tile 3b07ae
   (White -> Yellow); reveal button d67eb4 (White -> Yellow); Hand Counter 2f714c (White -> Yellow); Commander Zone 9d380e (Red -> White);
   Energy/Experience/Poison GUIDs swap ends. Only the mats were listed.
2. **The two Global scripts are different revisions**: 4p is newer (Wastes, `flash` reset, `checkPosMove` z>7 guard, `getCMC`
   suspend/pact/evermind). Patches anchored on 4p text may not apply to 6p (they did, except the three gates in 4.1).
3. **Layout constants differ**: `revealUp` 15.5 -> 18, `revealRi` 1.5 -> 0, `exileRot` -180 -> -90, `exileFor` 4.16 -> 3.17, `gravFor`
   -4.14 -> -3.6, `deckDirs` all -1. They place revealed cards, exile and graveyard moves in the manual-play functions.
4. **Mat size 24.8 x 22 vs 37 x 20.75**; the engine's battlefield grid fits by about 0.5 each side (3.1).
5. **Four of make-engine-copy's checks fail on the 6p file** (4.1), including a hard-coded count of 8 hand counters.
6. **Hand zones**: 12 on 6p, two per seat; colour is in `FogColor`. The profile extractor must read them from the save.
7. **Seats per side** (3 + 3 vs 2 + 2) for the 2HG / Juggernaut team presets.
8. **Highlight Mat, Timer, Hand Counter** are per-seat objects keyed by description or position, six each on 6p.
9. **The 6p "table playmat enabler" and "Table Instructions"** carry their own GUID lists (only relevant if manual mode is kept).
