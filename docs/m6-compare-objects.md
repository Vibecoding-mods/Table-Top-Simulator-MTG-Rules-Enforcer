# M6 compare: 4-player base (2296042369) vs 6-player table (2293586471), by object

Read-only comparison, 2026-11-15. Sources: `Mods/Workshop/2296042369.json` ("MTG 4 player table - scripted", 250 top-level / 622 objects with contents) and `2293586471.json` ("MTG 6 player table - scripted", 282 top-level / 594 objects). Neither was modified. Helper scripts are in the session scratchpad (`m6obj/`), nothing in the repo except this file. "Hash" below = first 8 hex of SHA-1 of the script text. Positions are (x, z); y is only given when it matters. Counts of scripted objects include objects inside bags/decks.

I also ran `tools/make-engine-copy.js` with the 6-player file as source and the output sent to the scratchpad (it only reads SRC; it refused to write because 3 checks failed). Its report is quoted in section 6.

## 0. Short answer

- Scripts: 4p has 225 scripted objects (119 distinct script bodies); 6p has 214 (98 distinct). 82 distinct bodies are byte-identical in both; 37 are only in 4p; 16 only in 6p. Global differs (hash f6e9760d vs fd7fbfdf). XmlUI is byte-identical (hash cbd19611, 13,963 characters).
- The spec's "81 of 97 identical" is roughly right if it means distinct bodies (6p: 98, 82 shared). It is not the right unit for porting: by object, only 41 of 110 top-level scripted objects in 4p have the same GUID and the same script in 6p (66 of 110 have an identical-body twin somewhere). The count hides that the identical scripts sit on objects with **different GUID-to-role meaning** (section 5).
- The spec's seat table, tracker table and GUID traps are correct as far as they go (verified from each object's Description/FogColor), but there are more traps than the four it lists, and four claims need correcting (section 7).
- `make-engine-copy.js` run on the 6p file: 3 hard FAILs (Wastes gate, Treachery gates, the `n === 8` hand-counter check) and, worse, silent wrong results: it deletes the 12 Commander Damage bags, one of six Timers, and misses 5 of the 6p's under-table background bundles.


## 1. Scripts identical in both tables (same body)

82 distinct bodies. Where the GUID is also the same in both, the object is a straight carry-over; the list gives the nickname and (4p count / 6p count) of objects with that body. Per-seat copies differ in count: more objects in 6p.

Straight carry-overs (same GUID, same script; not all listed GUIDs move, but the script is identical): Die_20 / Die_12 / Die_10, Krark's Coin Flipper, Suspend Counter x2 bodies, mana counters (White 2c49c6 etc.), Quarter, +X/+Y, Counter, Text + Counter, Notecard, Loyality Counter (two bodies), Text, +1/+1, Energy / Energy Counter, Poison/Experience Counter bodies (748 chars), Rhystic Block 1, Is it a token? (716ee6), πMenu (c369d7), πScry (de4346), πCounter (def0af), Auto Player Promoter (cd83de), Drop-On-Card Counter (two bodies), Color Module (b8b8df), Phasing (c2df33), hold alt (fb6538), CardCustom, Tovoloar Trigger, Tutor, get deck data, all the "Enabler" objects (Jodah, Indomitable Creativity, Atla Palani, Chaos Wand, Cascade, Planar Bridge, Mindmoil, River Sol, Manifest/Cloak, Oath of Druids), Bag of Tricks, get basic / non-basic land, Possibility Storm, Scrambleverse, Mass Face Down Tool, Card Stamp Tool, Card Size Multiplier, turn phase announcer, Upkeep Reminders, Ready?, Reset Readiness Tokens, Rotate Hands (Left/Right), Turn Skipper, Sticker Encoder (c5ea55), rikrassen's MTG Importer (ddf5de, 222541; hash 2a01b93c, 33,358 chars), πKeywords body 936b9793 (see 2.), Morphin' Time (ad044a), Who goes first? (die), Planechase bag + Eternities Map + Baldur's Gate Wilderness, Day/Night, The Ring, Undercity, Lost Mine, Dungeon of the Mad Mage, Tomb of Annihilation, Highlight Mat (all 6 / 4), Hand Counter Screen (513 chars), **Life Tracker (a9fccda5, 8,533 chars: 4 in 4p, 6 in 6p)**.

Notes:
- The Life Tracker script is identical; the owning colour comes from the object's **Description** ("White", "Red", ...), not from its GUID. So the 6p trackers need no script change, only correct Descriptions (verified: section 4).
- Highlight Mat: identical script (478 chars), Description = colour; 6p has 6 (d1ae7b, 6b0169, 7d303a, 193d0c, 1cf5e3, ca34d8), 4p has 4.
- Hand Counter Screen: Description = colour, 6p has 6 (0f896e, f41c49, d28db7, 5bbe31, 7dcdba, 182ca2), 4p has 4.
- The Day/Night, Ring, Undercity, dungeon cards moved about +2 to +6 in z but kept their GUIDs.


## 2. Same GUID, different script (12 objects)

| GUID | Object | 4p -> 6p chars | What differs |
|---|---|---|---|
| 02e062 | Encoder (-46.75, -5, 0) | 45,687 -> 45,159 | Only the 8-line "modified by pi for his table" header is missing in 6p. Code identical. |
| e40450 | Table Instructions | 2,344 -> 2,328 | **The `unnecessaryStuff` GUID list** (what the "delete room background and clutter" button deletes): 95 GUIDs in 4p, 92 in 6p, each its own table's clutter (section 8). Its `moveThese` list (25 GUIDs it nudges 3 units) differs too. |
| 9d380e | Commander Zone | 2,156 -> 2,157 | Script differs only in `zcoord -1.8 -> -1.35` and button height 0.03 -> 0.05. **The GUID is a different seat's object**: Red's at (-42.0, -8.3) in 4p, White's at (41.8, -13.4) in 6p. |
| 2f714c | Hand Counter | 1,886 -> 1,894 | 4p: `setInvisibleTo({'White','Red'})`; 6p: `{'White','Red','Yellow'}` (and the 6p fixes `editButton({index=inds` to `ind`). The GUID is White's -20,-30.5 in 4p, **Yellow's** (-32.1, -31) in 6p. |
| 9d9dda | Hand Counter (Self) | 1,954 -> 1,962 | `setInvisibleTo({'Yellow','Blue','Grey'})` -> `{'Green','Blue','Purple','Grey'}`. Same GUID again: White's (20, -30.5) in 4p, Yellow's (-32.1, -31) in 6p. |
| 809133 | Timer | 5,580 -> 3,594 | 6p timer is the older, shorter script (no total-time view, `turnN` saved as a bare number, not `{turnN, totT}`). Position (41.77, -2.86) is White's in 6p; in 4p it was the east-side (42.06, -4) timer. |
| 540e21 | Pirate Cannon | 12,167 -> 12,104 | 4p adds `thisObj.interactable=false/true` around the cannon fire. |
| b93b40 | Easy Modules Unified | 119,201 -> 118,991 | 4p newer battle double-face handling (`cardName, typeLine` nil-safe, `battle = {-0.875, 1.20}`); 6p older. |
| ae12d3 | πKeywords | 24,219 -> 23,119 | 6p object is an **older** version; 6p also has a **second, current** copy ddd349 (24,219 chars, hash 936b9793, same body as 4p's ae12d3) at the same position (-46.75, -5.75, 3.5). The older one is the one make-engine-copy's SLIM list names; the newer one stays. |
| 7a0067 | πNotepad | 8,948 -> 8,947 | Header line character only. Same code. |
| dc2d88 | smart mulligan | 852 -> 854 | 6p has a typo `smartMulliganas=Global.getVar('smartMulligan')` (a stray global; the variable the next lines read stays nil). Harmless once the object is removed. |
| 0ae315 | "EXPERIMENTAL 4p/6p table playmat enabler" | 2,418 -> 2,389 | Playmat spawn: `hand.right*0.7 + hand.forward*19.07` -> `*-0.75 + forward*20.15`; mat scale 2.3x3.0 -> 3.57x3.16; different MeshURL (the 6p mat). So the playmat itself is spawned by this script, not saved as an object. |

(This list is by GUID. Objects whose GUID exists only in one table but whose script differs are in section 3.)


## 3. Scripts in only one table (the GUID does not exist in the other)

Script hash is given where it is useful; "same body" means the script is byte-identical to the other table's, only the GUID/count differs.

### 3.1 Only in 4p

| 4p GUID | Object (position) | Script | Note |
|---|---|---|---|
| b748df, 0f6598, bfcf4a, f43e61, 8d172a, 45331a, 906d4b, 484c38, 4bfa09, d5907a, 95eb63, 6b6e1f | 12 x "Commander Damage" trackers (Custom_Token, locked) at x = +-6.8, z = -4.2..4.2 | 0fdc193a, 3,793 chars | The **attacker's** colour is the Description ("Blue", "Yellow", "Red", "White"); the victim is implied by the side of the table. These are the per-seat trackers behind the renderer's `CMD_DAMAGE`. None exist in 6p. |
| 23e485 | White's Life Tracker (3.5, -2.6) | a9fccda5 (same body as 6p) | 6p White is c2e905. |
| 5a7db4 | "Bruh Button" (0, 0.96, 0) | 2cdf4138 | make-engine-copy SLIM removes it. |
| 5006a4 | "Deck Lister" (-52.41, -19.71) | aaa5df4f | 6p Global still pings it (`pingGUIDs = {'6d07c3','5006a4','6d46cd','6ed442'}`, 6p Global lines 1346 and 1588): a dead reference there (6d07c3, 6d46cd, 6ed442 do not exist in either table). |
| fc40c8 / 29b1bb and 16 identity cards inside it | "MtG Treachery" bag and the Treachery randomizer, 16 identity cards (e.g. 488be0d7... Marshal, 99 KB script) | many | 4p only; 6p has no Treachery. |
| 908f60, ce8ea5, 16aed3, baffa9, dc9c6d, 0c0c5e, 3b2d18 (9d380e is reused, see 5) | Commander Zone x8 at the table ends (x = +-39.5..42, z = +-8.3), 2 per colour | 4382a407, 2,156 chars | 6p has 12, script differs in two constants (section 2). |
| 5cb175, 40b95f, a42baa | Highlight Mat x3 (d1ae7b is shared) | same body | 6p has 6. |
| 25f80a, 5b0cc8, b40ce7 / 0af44c, 9243e9, d29299 | Hand Counter / Hand Counter (Self) at (+-20, +-30.5) | 4p variants | 6p has its own twelve (section 4). |
| 3d7324, 5137aa, fcb7b5, 4563bf | Hand Counter Screen x4 | same body | 6p has 6, other GUIDs. |
| 29f427, 57b8f3, 9df6a3 | Timer x3 at (+-42.06, +-4) (809133 is shared) | 771e5f35, 5,580 chars | 6p has 6 timers with a shorter script (section 2). |
| 7cf430 | unnamed Custom_Tile (-53.34, -16.47) | c12f81d3 | In the 4p Table Instructions delete list. |
| 7deec9 | "moon-mtg-equip" (inside a bag, depth 2) | 353ebabc | |
| b7e70c | "hand rotator" (inside a bag, depth 1) | c6e4f346 (same body as 6p's two) | |
| 82bf98 | unnamed PiecePack_Crowns at (0, -100, 0): the script-spawn guard | 851b9527, 2,457 chars | 6p has the same guard as **68a268** (4d19de48, 2,573 chars); only the broadcast and dialog texts differ. |
| 988e5e | "Card Importer 6.6" (-47.7, 0.97, -18.09), 139,540 chars | e1247e26 | 6p has 11415b "Card Importer 6.4" (below). |

### 3.2 Only in 6p

| 6p GUID(s) | Object | Script | Note |
|---|---|---|---|
| inside the 12 infinite bags (4.2) | "<Colour> Commander Damage" token | 78a9eb00, 3,685 chars | Differs from 4p's tracker: attacker colour comes from the object's **Name** (`self.getName():gsub('[ ].*','')`), not the Description, and there is no "reset life 40" chat command. 11 changed lines. |
| 0457c5, ef1556, 2f714c, d929a5, b912b0, c675c4 | Hand Counter x6 | 9da6b119 (south) / c58947e5 (north) | |
| b9436a, 76532e, 9d9dda, 337c73, eb79ea, caa90f | Hand Counter (Self) x6 | f8a8fc46 / 0b7c4926 | |
| 0f896e, f41c49, d28db7, 5bbe31, 7dcdba, 182ca2 | Hand Counter Screen x6 | same body | |
| 809133, 37dd7e, 252e18, 8a13cc, cbb976, ab15d9 | Timer x6 | e0008344, 3,594 chars | |
| 9d380e, 40584f, f9be00, 9cb4b6, 48daef, ba751d, 206ce5, 2fa3e2, 144ccc, 399da3, 2af6c5, 47e079 | Commander Zone x12 | 5b5c69b1, 2,157 chars | |
| c2e905, 0c1b22, 2ee5fb | Life Tracker x3 more (448880, 37e533, 395037 are shared) | same body | |
| 6b0169, 7d303a, 193d0c, 1cf5e3, ca34d8 | Highlight Mat x5 | same body | |
| 0c58c3, 77b1dc | "hand rotator" x2 | same body | |
| ae12d3 | old πKeywords (23,119 chars) | a0fbb983 | A duplicate of ddd349 (current, 24,219 chars, same position). |
| 11415b | "Card Importer 6.4" (-48.12, 0.97, -17.94), 120,806 chars | 4d66a362 | 744 non-whitespace lines differ from 6.6. The make-engine-copy importer patches target rikrassen's tiles (ddf5de, 222541, identical in both), not this model, and its importer gate passed on 6p. |
| 68a268 | script-spawn guard | 4d19de48 | |


## 4. Per-seat objects on the 6-player table

Seats clockwise from White. The colour of each object was read from its Description (life tracker, timer, hand counters, hand-counter screens, highlight mat, commander zones) or its FogColor (hand zones); the rest comes from Global's registry (`data["<colour>"]["<role>"] = getObjectFromGUID(...)`, 6p Global lines 54-116). All of it agrees with the spec's seat table. Entries are `GUID (x, z)`.

| Role | White | Red | Yellow | Green | Blue | Purple |
|---|---|---|---|---|---|---|
| playmat | 7cffe1 (27.33, -14.87) | c20e3f (-2.08, -14.87) | 8b3401 (-31.47, -14.87) | 56cd9d (-27.3, 14.87) | 129eaa (2.07, 14.87) | d2aff5 (31.46, 14.87) |
| libraryZone | 409503 (41.78, -20.12) | 2365d0 (12.38, -20.12) | 166036 (-17.03, -20.12) | c04462 (-41.76, 20.12) | 033b34 (-12.35, 20.11) | 60bfe2 (17.06, 20.11) |
| graveyard | 7c926c (41.78, -23.71) | 9af898 (12.37, -23.71) | f66368 (-17.04, -23.71) | 8fb941 (-41.75, 23.7) | 46d9bd (-12.34, 23.69) | d95d4f (17.06, 23.7) |
| mulliganButton | 23ac26 (19.62, -26.63) | 822ab4 (-9.78, -26.63) | 3b07ae (-39.18, -26.63) | 18bae8 (-19.58, 26.63) | 91ab85 (9.82, 26.63) | a05a94 (39.22, 26.63) |
| untapButton | 18fb5d (25.5, -26.95) | e748df (-3.9, -26.95) | 4c341b (-33.3, -26.95) | f8f6dc (-25.46, 26.95) | afd316 (3.94, 26.95) | 4ee479 (33.34, 26.95) |
| drawButton | 26775a (27.46, -26.95) | a65396 (-1.94, -26.95) | 1a75c7 (-31.34, -26.95) | abb9f2 (-27.42, 26.95) | f22818 (1.98, 26.95) | 9e9836 (31.38, 26.95) |
| scryButton | 614515 (29.42, -26.95) | d40eab (0.02, -26.95) | 2b2b11 (-29.38, -26.95) | cf8508 (-29.38, 26.95) | aed706 (0.02, 26.95) | db39e0 (29.42, 26.95) |
| millButton | 57914a (31.38, -26.95) | e913ee (1.98, -26.95) | a7ecfc (-27.42, -26.95) | ea446d (-31.34, 26.95) | ab1894 (-1.94, 26.95) | 9f26e5 (27.46, 26.95) |
| revealButton | 77a7c1 (33.34, -26.95) | df3848 (3.94, -26.95) | d67eb4 (-25.46, -26.95) | c770a1 (-33.3, 26.95) | 87bc5b (-3.9, 26.95) | 0f77f4 (25.5, 26.95) |
| Life Tracker (Description=colour) | c2e905 (41.8, -5.7) | 448880 (12.4, -5.7) | 37e533 (-17.0, -5.7) | 0c1b22 (-41.8, 5.7) | 395037 (-12.3, 5.7) | 2ee5fb (17.1, 5.7) |
| Commander Zones (Description=colour) | 9d380e (41.8, -13.4); 40584f (41.8, -9.6) | f9be00 (12.4, -13.4); 9cb4b6 (12.4, -9.6) | 48daef (-17.0, -9.6); ba751d (-17.0, -13.4) | 206ce5 (-41.8, 13.4); 2fa3e2 (-41.8, 9.6) | 144ccc (-12.3, 13.4); 399da3 (-12.3, 9.6) | 2af6c5 (17.1, 13.4); 47e079 (17.1, 9.6) |
| Timer | 809133 (41.8, -2.9) | 37dd7e (12.4, -2.9) | 252e18 (-17.0, -2.9) | 8a13cc (-41.8, 2.9) | cbb976 (-12.3, 2.9) | ab15d9 (17.1, 2.9) |
| Hand Counter | 0457c5 (26.7, -31.0) | ef1556 (-2.8, -31.0) | 2f714c (-32.1, -31.0) | d929a5 (-26.6, 31.0) | b912b0 (2.7, 31.0) | c675c4 (32.2, 31.0) |
| Hand Counter (Self) | b9436a (26.7, -31.0) | 76532e (-2.8, -31.0) | 9d9dda (-32.1, -31.0) | 337c73 (-26.6, 31.0) | eb79ea (2.7, 31.0) | caa90f (32.2, 31.0) |
| Hand Counter Screen | f41c49 (26.7, -31.0) | d28db7 (-2.8, -31.0) | 0f896e (-32.1, -31.0) | 5bbe31 (-26.6, 31.0) | 7dcdba (2.7, 31.0) | 182ca2 (32.2, 31.0) |
| Highlight Mat | d1ae7b (29.4, -14.8) | 6b0169 (0.0, -14.8) | 7d303a (-29.4, -14.8) | 193d0c (-29.4, 14.8) | 1cf5e3 (-0.0, 14.8) | ca34d8 (29.4, 14.8) |
| HandTrigger zones (FogColor) | 541bb1 (26.7, -35.0); 5b3c39 (40.6, -32.0) | c029b6 (-2.8, -35.0); 25f290 (11.3, -32.0) | 3d19e1 (-32.1, -35.0); 41ad09 (-18.0, -32.0) | fa1564 (-26.6, 35.0); 666e0e (-40.5, 32.0) | e3dba4 (2.7, 35.0); f2a866 (-11.2, 32.0) | ce0263 (32.2, 35.0); 272027 (18.0, 32.0) |


Observations:
- Playmat = the locked `ScriptingTrigger` at y=0.8, scale 24.8 x 22. White/Red/Yellow on the south edge (rot 180), Green/Blue/Purple on the north edge. The mat picture is spawned by the "EXPERIMENTAL 6 player table playmat enabler" script (0ae315), not stored as an object. Each seat also has a locked `Highlight Mat` token about 2.1 off the mat centre.
- Library zone and graveyard are `ScriptingTrigger`s at x_seat +- 14.4 (south seats +14.4, north seats -14.4), z = +-20.1 and +-23.7: beside the life tracker and commander zones, not on the mat.
- **Hand zones**: each seat has two HandTriggers, not one: the main one (scale 18.4 x 4.9, z = +-35, x about the mat's) and a thin side strip (7.9 x 1.3, z = +-32, x about the life-tracker column less 1.2). The spec lists only the main zone. (4p has the same two-zone pattern: 360dc1, 640235, a11f20, 7295a1, b798d6, 350f7f, 993f89, bb8c76; none of those GUIDs exist in 6p.)
- Button row: untap, draw, scry, mill, reveal are 1.96 apart along z = +-26.95; south seats run untap to reveal with rising x, north seats with falling x (a 180 degree turn of the same layout). The mulligan tile (black Custom_Tile) is at z = +-26.63, about 7.7 to the inside of the mat's x.
- Life trackers, commander zones and timers all share the seat's column x = 41.77, 12.37, -17.04 (south) and -41.75, -12.35, 17.05 (north): that column is the key for matching "this seat's end-of-table objects".
- Commander Zones: two per seat, 3.8 apart in z (south: -13.4 outer, -9.6 inner; north: 13.4, 9.6). Which of the pair is tax 1 and which is partner is not stored in the file. The 4p renderer's `TAX_LABELS` order (White {908f60 at x 39.5, ce8ea5 at x 42.05}; Red {9d380e at -42.0, 16aed3 at -39.5}) has no rule that carries over, so the order needs a decision for 6p.
- Hand Counter, Hand Counter (Self) and Hand Counter Screen are three stacked objects per seat at the same (x, z); their scripts hard-code which colours may not see them (section 2).

### 4.2 Commander damage bags

| End | Colour -> bag GUID (z) |
|---|---|
| West, x = -52.65 | Red cf8328 (11.25), Yellow 140a9c (12.75), White 30609e (14.25), Green 37b220 (15.75), Blue 19ff7c (17.25), Purple 7d7cef (18.75) |
| East, x = +52.35 | Red d7dc8e (-11.25), Yellow a4868a (-12.75), White ed330c (-14.25), Green 7dd5e3 (-15.75), Blue dc19a6 (-17.25), Purple 818de4 (-18.75) |

All 12 are locked infinite bags; each holds one token named "<colour> Commander Damage" with an empty Description. In 6p a token's colour is the **attacker's** only; nothing records the victim, which spec option A has to add itself. 4p has 4 such bags (0cebc6 Red, 59d2ee Yellow, 080e23 Blue, d658b5 White at x = 53.81) besides its 12 fixed trackers, plus 4 older bags at x = -53.82 whose GUIDs (cf8328, 140a9c, 30609e, 19ff7c) are also in 6p.

### 4.3 Table-wide objects
- Turn Order cards aea3f4 (-49, 15) and 633ed3 (49, -15).
- Counter, dice, keyword and mana columns at x = +-45.5..53.5, as in 4p; the east-end mana bags have new GUIDs (9ca38a, b2b54e, 8aab65, 418ec8, fcb171, de25ac, 916ad9) and the Poison/Energy/Experience/Counter token pairs moved from the west to the east end (e.g. Poison 94b67a: x -45.5 in 4p, +45.5 in 6p). Poison, Energy and Experience: one token (and one infinite bag) per end, so two sets of tokens, not four as the spec says.
- Monarch crown 8963ec, The Monarch 197ab6, City's Blessing cb418b, Day 4e8c7b, The Ring d9fcbc, Undercity 2db63a and the dungeon cards keep their GUIDs; positions shifted by about 2 to 6 in z (x about -49..-53).
- "Who goes first?" die ee33ec (0, 200, 0), Pirate Cannon 540e21 (-60, 0.73, 0), Go_Board e261d9 (-60.1, -0.33, 0.27): in both tables.
- Off-table: "Chat Commands" tile 7b59f7 (31, 22, 111.5), Table Instructions e40450 (-30, 22, 111.5), "hold alt" fb6538 (0.06, 47.8, 116.1), smart mulligan dc2d88 (-122.6, -5.05, 68.6).

### 4.4 Global's per-seat data (6p Global vs 4p Global)
- `props[<colour>].spawns` (absolute card-spawn spots) for six colours. Looks like a bug in the 6p table: Blue is `posX 5, posZ -5, rotY 180` (the south side) while Blue sits on the north; Green and Purple use `posZ 5, rotY 0`. Used by `spawn()` at 6p Global line 2391 for single-card spawns.
- `deckDirs` is -1 for all six colours (4p: Red=1, Blue=1, White=-1, Yellow=-1).
- 4p-only code in Global: `exileRot/exileFor/gravFor` variables (6p: -90, 3.17, -3.6), `revealUp` 15.5 vs 18 and `revealRi` 1.5 vs 0, "flip hands on load", the `flash` variable, a `math.abs(objPos.z)>7` guard on the library drop, Wastes ("Get Basic Wastes" / `deckRampWa`), and a suspend/pact/evermind cmc rule.
- Both onload loops list the objects set non-interactable: the 6p list is `eb479b f72932 3da261 5f75f7 06d2e0 c42075 a3e6a8 cb1610 3d4319 540e21` (the first eight are the under-table bundles of section 8; 3d4319 does not exist in either file).


## 5. GUID traps (same GUID, different meaning)

### 5.1 Global's registry (the `data[colour][role]` lines)

14 GUIDs appear in both registries; 6 keep their role and 8 change seat:

| GUID | Role | 4p seat -> 6p seat |
|---|---|---|
| 8b3401 | playmat | White -> **Yellow** |
| 129eaa | playmat | Yellow -> **Blue** |
| 56cd9d | playmat | Blue -> **Green** |
| 166036 | libraryZone | White -> **Yellow** |
| 033b34 | libraryZone | Yellow -> **Blue** |
| c04462 | libraryZone | Blue -> **Green** |
| 3b07ae | mulliganButton | White -> **Yellow** |
| d67eb4 | revealButton | White -> **Yellow** |
| c20e3f | playmat | Red -> Red (same) |
| 2365d0 | libraryZone | Red -> Red (same) |
| 18fb5d / 26775a / 614515 / 57914a | White untap / draw / scry / mill | same seat (positions moved) |

The spec's trap list gives only the three playmats. The libraries, the mulligan tile and the reveal button follow the same pattern, and nothing but a rebuilt registry saves a script that was patched with the 4p GUIDs.

### 5.2 Outside the registry

| GUID | Object | 4p | 6p |
|---|---|---|---|
| 9d380e | Commander Zone | **Red** (-42.0, -8.3) | **White** (41.8, -13.4) |
| 2f714c | Hand Counter | White (20, -30.5) | **Yellow** (-32.1, -31) |
| 9d9dda | Hand Counter (Self) | White (20, -30.5) | **Yellow** (-32.1, -31) |
| 448880, 37e533, 395037 | Life Trackers | Red, Yellow, Blue | Red, Yellow, Blue (same colour, new position) |
| 809133 | Timer | White (42.06, -4) | White (41.77, -2.86) (same colour) |
| d1ae7b | Highlight Mat | White | White (same colour) |
| a3e6a8 | under-table bundle (8) | (-25, -46.1, -59) | (-38, -46.1, -54) (same object kind, new place) |
| 94b67a, da1b48, 576ccd, 3aad21, 30f3c2 ... | Poison / Energy / Experience / Loyalty tokens | west end | east end (x sign flipped) |

Traps already known to the spec: 8b3401 / 56cd9d / 129eaa (mats) and White's life tracker (23e485 -> c2e905). New: the 6 registry GUIDs of 5.1, 9d380e (Red -> White), the two Hand Counters (White -> Yellow), and the east/west flip of the token columns (matters for any "side clutter" box).


## 6. `tools/make-engine-copy.js` and `tools/engine-renderer.lua`: GUIDs touched, and the 6p counterparts

I ran `node tools/make-engine-copy.js <6p file> <scratchpad>/out6.json`. 4p baseline: exit 0, 58 OK lines, nothing failed, wrote the file. 6p: it **refused to write**. Differences against the 4p report:

| 6p result | Cause |
|---|---|
| FAIL gate Get basic land: 5 function(s), not found `deckRampWa` | the 6p Global has no Wastes feature (section 4.4). Change `min`/the name list for 6p. |
| FAIL gate Treachery identity token buttons x2 (`getToken`, `getToken1`, `getToken2`, `red`) | 6p has no Treachery objects. Skip these two guards when the table has none. |
| FAIL hand counters relabel only on change (12) | the check is hard-coded `n === 8` (4 seats x 2); 6p has 12 counters. Use the seat count x 2. |
| OK but counts differ: life counter 6 scripts (4), hand counter 12 (8), life counter click/chat/gate 6/18/6 (4/12/4), Counters gates 76 and 104 (80 and 120), counter chat reset 12 (20), keyword counters 2 (1) | numbers scale with seats; the Counters gates went down (80 -> 76, 120 -> 104, 20 -> 12) although seats went up. They passed their `min`; the cause was not investigated (the 6p counter objects are fewer or older), so confirm they still gate every function. |

### 6.1 Silent problems in the "OK" lines (the run succeeded on these, wrongly)

The SLIM list and `CLUTTER_BOXES` (lines 818-829) are positional/GUID lists taken from 4p:

- **`CLUTTER_BOXES` removes all 12 commander-damage bags** (x = -52.65 / +52.35, z within +-11..19): they sit inside the boxes `{x:[-56,-44], z:[-8.5,32]}` and `{x:[44,56], z:[-26,8.5]}`. It reported "side clutter removed (138)" and listed all twelve first. Spec option A (take 5 counters per seat from the bags) is therefore impossible without exempting those twelve GUIDs. The boxes also swallow the 6p's Spirit (5f39cd), Manifest (9673d3), Morph (d6405a), Foretell, On an Adventure and Creature Elk cards (token cards at x -49..-53, z 23..26), and the Planechase bag b7ccfb (51.5, -22.95) as in 4p.
- **SLIM names 4 Timers (809133, 29f427, 57b8f3, 9df6a3); 6p has 6 with other GUIDs.** Only 809133 exists in 6p, so one timer of six is removed, the other five (37dd7e, 252e18, 8a13cc, cbb976, ab15d9) stay. Same for all other places that assume one per seat.
- **SLIM's under-table bundles `eb479b, a3e6a8, a7a029, 4c02f8, 9c553c, cb1610`**: 6p has eb479b, a3e6a8, cb1610 but not the other three; the 6p's five extra bundles (f72932, 3da261, 5f75f7, 06d2e0, c42075, all at y -45.1) stay. See section 8.
- SLIM `ae12d3` removes the **old** πKeywords in 6p, the current copy ddd349 stays. `5a7db4` (Bruh Button) does not exist in 6p. The other Encoder modules (b93b40, ad044a, 7a0067, cd83de, c5ea55, b8b8df, def0af, c2df33) and `222541` all exist at the same GUID, the same positions.
- `["5c8648","098c38","2d3496"]` (both Drafting tools bags, Pie's Enablers bag): same GUIDs in 6p. `4f3387` (the bag inside it; `onObjectLeaveContainer`): exists in 6p, same GUID.

### 6.2 `COMMAND_ZONES` (make-engine-copy line ~505) and `TAX_LABELS` (renderer line 15)

| 4p colour: GUIDs (positions) | 6p counterpart (same colour) |
|---|---|
| White: 908f60 (39.5, -8.4), ce8ea5 (42.05, -8.4) | White: 9d380e (41.8, -13.4), 40584f (41.8, -9.6) |
| Red: 9d380e (-42.0, -8.3), 16aed3 (-39.5, -8.3) | Red: f9be00 (12.4, -13.4), 9cb4b6 (12.4, -9.6) |
| Yellow: baffa9 (-39.5, 8.3), dc9c6d (-42.0, 8.3) | Yellow: ba751d (-17.0, -13.4), 48daef (-17.0, -9.6) |
| Blue: 0c0c5e (42.0, 8.3), 3b2d18 (39.5, 8.3) | Blue: 144ccc (-12.3, 13.4), 399da3 (-12.3, 9.6) |
| (none) | Green: 206ce5 (-41.8, 13.4), 2fa3e2 (-41.8, 9.6) |
| (none) | Purple: 2af6c5 (17.1, 13.4), 47e079 (17.1, 9.6) |

Within a pair the order (first = tax counter?) is not derivable; see 4.

### 6.3 Renderer tables

- `LIFE_TRACKERS`: White 23e485 -> **c2e905**; Red 448880, Yellow 37e533, Blue 395037 unchanged; add Green **0c1b22**, Purple **2ee5fb**.
- `CMD_DAMAGE` (12 fixed trackers b748df, 0f6598, ...): no 6p equivalents (bags only, 4.2).
- Status pieces (`STATUS_PIECES`, `DAY_NIGHT`): 8963ec, 197ab6, 2db63a, cb418b, d9fcbc, 94b67a, da1b48, 576ccd, 4e8c7b all exist at the same GUID in 6p (the run kept and parked 24 pieces for the 4 seats in `STATUS_SEATS`; the per-seat copies grow once it is extended to six). The three counters moved to the east end.
- `dc2d88` (smart mulligan): same GUID in 6p; the Global `smartMulligan` patch applies.
- Other files that hard-code 4p GUIDs (grep for 23e485): `tools/handplay.lua`, `tools/tts-gesture-test.js`, `tools/tts-inspect.lua`, `tests/golden/table-run.js`, `tests/golden/table_golden.json`, `tests/test_table_claims.js`, `tests/test_table_effects.js`; for the tax/damage GUIDs also `tools/make-test-deck-lua.js` and the golden JSON.

The remaining hard-coded GUIDs in make-engine-copy (098c38, 5c8648, 2d3496, 222541, 4f3387, ...) all resolve to the same object in 6p.


## 7. Verdict on `docs/m6-six-seat-spec.md` section 2.1

| Spec statement | Verdict |
|---|---|
| "The saved XmlUI is identical (13,971 bytes both)" | Right (hash cbd19611 both; 13,963 characters, so 13,971 is bytes with multi-byte characters). |
| "Global is 2,800 lines against 2,804" | Right (2,799 / 2,803 newlines). Missing: it is not a seat-count edit only. Global differs in the registry, `props`, `deckDirs`, the three exile/graveyard offsets, `revealUp/Ri`, the hands-flip on load, Wastes, the library-drop guard, a cmc rule and a `flash` variable (4.4). |
| Seat table: colours, sides, mats, hand zones, life trackers | Right, every row confirmed (4). Missing: the second HandTrigger per seat; the libraries/graveyards/commander zones/timers/hand counters/highlight mats/mulligan and button GUIDs. |
| "Life trackers matched by position ... confirm from script" | Confirmed, and no need to guess: the tracker's colour is its Description ("White" ... "Purple"), one-to-one with the position match. |
| GUID traps: 8b3401, 56cd9d, 129eaa, White's tracker | **Incomplete**: 8 role changes in Global's registry (also libraries 166036 / 033b34 / c04462, mulligan 3b07ae, reveal d67eb4), plus 9d380e (a Commander Zone: Red -> White) and the two Hand Counters 2f714c / 9d9dda (White -> Yellow). See 5. |
| "Commander tax: only one of the 4-player tax GUIDs (9d380e) exists here" | Right, but the one that exists is **White's** here (Red's in 4p). 6p's own tax zones are the 12 Commander Zones, two per seat (6.2). |
| "Commander damage: no per-seat trackers. 12 infinite bags, one set of 6 at each end (x = +-53). Each holds the same counter script as the 4-player trackers." | Bags: right (x = -52.65 and +52.35). **Wrong** that the script is the same: 6p's is a shorter, older variant (3,685 vs 3,793 chars) that reads the colour from the object's Name, not the Description (3.2). Missing: the bags are inside `CLUTTER_BOXES` and the current script deletes all twelve (6.1). |
| "Poison, energy and experience counters: only 4 sets, at the table ends" | One token and one infinite bag per end for each of the three: two sets, not four. Also moved to the opposite end vs 4p. |
| "Object scripts: 81 of 97 identical; older Card Importer (6.4), Encoder and Hand Counters" | The count is close but is by distinct body: 82 of 98 bodies identical (plus Global differs). By object it is 163 of 214 scripted objects with an identical-body twin, 66 of 112 at the top level. The "older" list is: Card Importer 6.4 (right), Easy Modules (older), Keywords (older, plus a current duplicate), Timer (older), Pirate Cannon (older). The Encoder is **not** older: only the 8-line header comment is absent. Hand Counters are *different* (hard-coded invisible-to lists), not older, though the 6p fixes `inds -> ind`. Missing from the spec: Table Instructions' own GUID lists; the commander zone constants; the playmat enabler. |
| "Same hard-coded Steam IDs" | Right. Identical in both tables: 76561197968157267 (Global "promote me", smart mulligan dc2d88), 76561198045776458 (the author id on the Life Trackers, 5 scripts in 4p / 7 in 6p including Rhystic Block 1), 76561197997376704 (Auto Player Promoter cd83de). The Life Tracker one is `author=` only (no control flow in the lines grepped). No new IDs in 6p. |
| Turn order | Right (both have Turn Order cards aea3f4, 633ed3). |
| "Seats: south White, Red, Yellow; north Green, Blue, Purple" | Right. |

Missing from the spec entirely:
1. The 6p Global dead reference to 5006a4 (Deck Lister) and the other 3 dead ping GUIDs.
2. 6p `props` Blue spawn looks wrong (4.4).
3. The old duplicate πKeywords ae12d3 + current ddd349 (the SLIM line removes the wrong one).
4. The 6p's script-spawn guard 68a268 (same function, different texts) and Card Importer 6.4 vs 6.6 (the engine copy's importer gate passed on both).
5. The 3 FAILs and 3 silent errors in 6.

## 8. Background objects (decoration) candidates

The author's own list is in the Table Instructions script (e40450): pressing its button runs

    for _,guid in pairs({'eb479b', 'f72932', '3da261', '5f75f7', '06d2e0', 'c42075', 'a3e6a8', 'cb1610'}) do destruct

then a long `unnecessaryStuff` list and a `moveThese` list. Global's onload also sets `eb479b f72932 3da261 5f75f7 06d2e0 c42075 a3e6a8 cb1610 3d4319 540e21` non-interactable.

Under-table "3D background" Custom_Assetbundles (all locked), y -45 to -46:

| 6p GUID | Position | Bundle | 4p equivalent |
|---|---|---|---|
| eb479b | (0, -46.1, 0), scale 1.5 | C1AF3F2EDA68... | same GUID, same place |
| cb1610 | (0, -46.12, 0), scale 41.5 | 80221BF40847... | same GUID (scale 40 in 4p) |
| a3e6a8 | (-38, -46.1, -54), scale 25 | 99A804A83048... | same GUID but (-25, -59) |
| c42075 | (0, -45.1, -58) | 99A804A83048... | none (4p: 4 corners) |
| 06d2e0 | (38, -45.1, -54) | same | none |
| f72932 | (-38, -45.1, 54) | same | none |
| 3da261 | (0, -45.1, 58) | same | none |
| 5f75f7 | (38, -45.1, 54) | same | none |

4p's equivalents: eb479b, cb1610, a3e6a8 (-25, -59), a7a029 (-25, 59), 4c02f8 (25, 59), 9c553c (25, -59). So the 6p background is the same three bundles plus **five new GUIDs instead of three**; `make-engine-copy` SLIM names only the 4p six, so the six 6p objects would be 3 removed, 5 left under the table.

Other decoration/clutter candidates on the 6p, by position (what Table Instructions would delete, then what the engine copy's boxes catch):
- The Table Instructions 6p delete list has 92 GUIDs; 8 do not exist in 6p (fc40c8, de6cde, c99d05, 606bcc, 6d46cd, 6ed442, 8f2e18, c5addf; 123asd is a placeholder). Of those that exist: Turn Order 633ed3 (east; not aea3f4), the six east-end commander-damage bags (d7dc8e, a4868a, ed330c, 7dd5e3, 818de4, dc19a6; the west six are not in the list), the dice and keyword bags at both ends, the east end's mana/counter/poison/energy/experience bags and tokens, Planechase b7ccfb, Rhystic Block Bag 63bc71, Krark's Coin Flipper b35666, Drafting tools 098c38, the d2 bag 9cf532, Turn Skipper Puck 295538. The west end's counter and mana pieces are not deleted but moved 3 units (`moveThese`, 25 GUIDs, e.g. dc2408, 42ef12, 7ae211, 389c4d). So the button clears one end and compacts the other.
- Under-table and far-off storage (not decoration, keep): the Encoder family at x -46.75, y -4.25..-5.75; script-spawn guard 68a268 (0, -100, 0); smart mulligan dc2d88 (-122.6, -5, 68.6, removed by make-engine-copy); Chat Commands 7b59f7 and Table Instructions e40450 (y 22, z 111.5); "hold alt" fb6538 (z 116, y 47.8); first-player die ee33ec (0, 200, 0).
- Table-edge fixtures: Pirate Cannon 540e21 (-60, 0.73, 0), Go_Board e261d9 (-60.1, -0.33, 0.27), both in 4p too (the engine copy keeps them and hides them).
- Table surface and sky are not objects: TableURL is `...1752456562860399430...` (6p) vs `...1838031787126517045...` (4p); the engine copy replaces it with its skybox; SkyURL is the same. 6p has 30 SnapPoints (4p 24) and 8 TabStates (4p 4).

## 9. GUID references inside the scripts (will they resolve in the 6p?)

Every 6-hex string in quotes in each distinct script, checked against the table's own objects:

| Script | 4p unresolved | 6p unresolved |
|---|---|---|
| Global | 3d4319, d936a8, 6d07c3, 6d46cd, 6ed442 | 3d4319, d936a8, 6d07c3, **5006a4**, 6d46cd, 6ed442 |
| Table Instructions | 10 (de6cde, c99d05, 5ca969, 6d46cd, 6ed442, 673bac, c5addf, 8dad82, 4bf968, 6d07c3) | 8 (fc40c8, de6cde, c99d05, 606bcc, 6d46cd, 6ed442, 8f2e18, c5addf) |
| The Marshal / The Gathering (Treachery) | 0cdbcb, 249e1f / 347d55, 683847, 2293e3 | n/a |
| two untitled objects 8f8d5d, b3e98f | 2391b9 | 2391b9 |
| Planechase Eternities Map (bae9e7) | f33381 | f33381 |

None of the 6p registry GUIDs is dead: all 54 (6 seats x 9 roles, 6p Global lines 54-116) resolve to a top-level object. The dead ones are old pings and delete lists. The ping loop is nil-checked (`if getObjectFromGUID(guid)~=nil`), the onload loops are `pcall`ed, so they are harmless; 5006a4 (Deck Lister) is simply 4p-only.

