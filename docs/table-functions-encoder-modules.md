# Table function reference: Encoder and its modules

Table: "MTG 4 player table - scripted". Scripts: `table-scripts\` (one file per unique script). Review verdicts: `table-review/notes-encoder-modules.md` (and, for πScry, πMenu, πCounter, Bag of Tricks, `notes-trackers-turns.md` and `COMPATIBILITY.md`).

## How to read this file

- Every line number is a line in the extracted `.lua` file named in the heading.
- Each script has a summary table (`name(params)` | line | what it does | called by | side effects), then a **Details** list. Details give, per function: parameters and return value, the globals and state it reads and writes, every branch and early return, side effects, callees, and bugs or oddities.
- "Global var" means a Lua global inside that object's script. "Global" (capital G) means the table's Global script.
- "Encoder rebuild" means the Encoder's `buildButtons` (Encoder 637) calling a module's `createButtons{obj}` or a menu's `activateFunc{obj}`.
- Click functions in TTS receive `(obj, player_color, alt_click)`. Input functions receive `(obj, player_color, value, still_editing)`. Context-menu callbacks receive `(player_color, menu_position, obj)` for object items, and `(player_color)` for items on the script's own object.
- `Object.call(name, arg)` passes **one** argument and returns a **copy** of tables. Callers must write tables back.
- Global clears every object's context menu when it enters a zone (Global `onObjectEnterZone`, about line 1032). Scripts that add context items wait one frame and re-add them for this reason.

### Where the objects live

| Container | GUID | Type | Notes |
|---|---|---|---|
| Loose on the table | — | — | Always running. |
| "Pie's MTG Enablers" | **4f3387** | Custom_Model_Bag | Itself inside Infinite_Bag **2d3496** (same name). Scripts inside are inert until taken out. |
| "Krark's Coin Flipper" | **b35666** | Infinite_Bag | Each pull spawns a copy with a new GUID. |
| "Drop-On-Card Counter" | **3c7ad3**, **82e64d** | Custom_Model_Infinite_Bag | Each pull spawns a copy with a new GUID. |

Container names come from the saved table JSON (`Saves/MTG 4 player table - ENGINE MODE.json`); parents come from `_index.json`.

### Line numbers that differ from the review notes

The review notes cite some line numbers that do not match the extracted files. The behaviour they describe is the same. Correct lines:

| Notes say | Actual line in the extracted file |
|---|---|
| Is it a token `toggleToken` (326) | 62 |
| Phasing `unPhased` (223); self-update (247-264) | 64; `updateModule` 88-105 |
| Card Stamp "doesn't unlock locked cards (233)" | 48 |
| Scrambleverse grid (208-216) | 117-120 |
| πKeywords value names "deathtouch, defender…" | Real valueIDs are `mtg_deathtouchcounter`, `mtg_defendercounter`, … (see πKeywords) |

### Scope note

`_b_EXPERIMENTAL_b_4p_table_playmat_enabler__0ae315.lua` matches `*enabler*` only case-insensitively. It is not an Encoder module, so it is not covered. `_i_River_Sol_Enabler_i___b5797b.lua` is covered because the review notes list it with the Enablers.

---

# Part 1. Encoder architecture

Encoder object: **02e062**, `PiecePack_Arms`, loose. Version `4.6.1` (12). Modified by "π" from Tipsy Hobbit's Encoder (1-15).

## 1.1 Registries (file-local tables)

| Table | Line | Key | Shape | Saved? |
|---|---|---|---|---|
| `EncodedObjects` | 49 | card GUID | `{this=Object, oName, oDesc, values={valueID=v}, encoded={propID=bool}, menus={menuID={open,pos}}, editing=propID or nil, flip=1 or -1, disable=bool}` (566-576) | yes, `onSave` 298-307 |
| `Players` | 63 | color | `{this=color, values={}, encoded={}, editing=nil, style="basic", menus={}}` (586-593) | yes, 295 |
| `Properties` | 75 | propID | the table the module passed to `APIregisterProperty`, deep-copied (848) | yes, `funcOwner` saved as GUID (316-324) |
| `Values` | 88 | valueID | `{default, validType, desc, validate=function}` (927-931) | yes, `validate` saved as `''` (325-330) |
| `Zones` | 95 | zone GUID | `{name, func_enter, func_leave, funcOwner, color}` (429-434) | yes (308-315) |
| `Styles` | 103 | styleID | `{styleID, name, desc, styleTable}`; only `Basic_Style` (104) | no |
| `Menus` | 111 | menuID | `{menuID, funcOwner, activateFunc, visible_in_hand}` (952-957) | yes (331-338) |
| `CORE_VALUE` | 26 | — | `{menu_count, style_count, beta, style}` | **no** (so `beta` resets to false on every load) |

`basicstyleTableDefault` (33-46) is the button style the Encoder merges into its own "X" button (688-692) and returns from `APIgetStyleTable`.

## 1.2 How a module registers

1. The module's `onload` waits for `Global.getVar('Encoder') ~= nil` (`Wait.condition`), then runs its own `registerModule`. Every in-scope module does this. Most also have a "register" button or a "Register Module" context item.
2. `registerModule` calls, through `enc.call`:
   - `APIregisterValue{valueID, validType, default, desc}` once per value (925).
   - `APIregisterProperty{propID, name, values={valueIDs}, funcOwner=self, activateFunc, visible, visible_in_hand, tags}` (837).
   - or, for a menu, `APIregisterMenu{menuID, funcOwner, activateFunc, visible_in_hand}` (951).
3. The module must define `createButtons(t)` (property) or the named `activateFunc(t)` (menu). The Encoder calls these with `{obj=card}` on every rebuild.
4. Re-registration also happens:
   - on Encoder load, for every saved property and menu owner (`registerModule` via `Wait.condition`, 151-156 and 209-217);
   - when a player drops any object that has a `pID` script variable (Encoder `onObjectDropped` 530-532).

**Property fields used by the Encoder and πMenu:**

| Field | Used at | Meaning |
|---|---|---|
| `propID` | 848 | key |
| `name` | πMenu 169 | menu label |
| `values` | 763, 1200, 1238, 1250 | the valueIDs that belong to this property. Must already be registered, or defaults are not seeded |
| `funcOwner` | 664, 669 | object whose `createButtons` is called |
| `activateFunc` | πMenu 178, Encoder 1171 | function πMenu binds to the property's menu button |
| `visible` | πMenu 161 | `false` hides it from πMenu |
| `visible_in_hand` | 665-672 | `0` or nil = draw only on the table; `1` = table and hand; `2` = hand only |
| `tags` | 863-868 | filter for `APIgetPropsList` |
| `callOnActivate` | — | legacy, unused |

**Value `validType` rules** (`buildValueValidationFunction` 791-813). The validator is `validate(new, current)`; it returns the value to store.

| validType | Validator | Effect of a bad value |
|---|---|---|
| `nil` or `'nil'` | returns `new` (810) | anything is stored, including tables |
| `'string'`, `'number'`, `'boolean'` | `type(new)==vt` (796-797) | keeps `current` silently |
| `'pattern(<lua pattern>)'` | `string.find(new, pat)` (798-804) | keeps `current`; errors if `new` is not a string |
| contains `'color'` | `''`, nil, or `Player[new] ~= nil` (805-807) | keeps `current` |
| anything else | no validator is set | later writes error (nil function) |

The test at 794 uses `validType` as a Lua pattern against the text `'stringnumberboolean'`.

## 1.3 Where per-card data lives

- **In the Encoder, keyed by card GUID**, not on the card (49). All module values for a card are in `EncodedObjects[guid].values`. `encoded[propID]` says which modules are on.
- Saved by the Encoder's `onSave` (289-341) and restored in `onLoad` (188-201). A card whose GUID no longer exists is dropped on load (193-194).
- If a card is replaced by a new object with a new GUID (`setState`, a spawn, a clone), its data does not follow. `APIobjUpdateThis` and `APIobjCloneData` exist for this. Easy Modules' `SetExactCopyData` and Global (1285-1294) copy data by hand.
- Some modules also store data **on the card object**:
  - Easy Modules: a `tyrantUnified` table set with `card.setTable` (2799, 2819, 2790, 2897).
  - πKeywords, Morphin' Time, Card Stamp: decals.
  - Morphin' Time: the card's name and description (346-347, 353-354).
  - πCounter and the Drop-On-Card Counter: they replace the card's Lua script and `reload()` it.
  - moon-equip: a `moon-mtg-equip-ctx` script variable on decks, and attachments.

## 1.4 The rebuild cycle (`buildButtons(o, h)`, 637-696)

1. `h` (in a hand) defaults to `handCheck(o)` (638-640).
2. Returns if `o` is nil (641). Errors if `o` is not encoded (642 indexes nil).
3. Does nothing at all if `disable == true` (642).
4. **Clears every button and input on the card** (643-644). Any button another script put on an encoded card is wiped on the next rebuild.
5. If `editing == nil`:
   - For each menu (646-662): seeds `menus[menuID] = {open=false,pos=0}`. Writes `visible_in_hand = 0` into the Menus entry when nil. Calls `funcOwner.call(activateFunc, {obj=o})` if the hand/table filter passes.
   - For each `encoded[propID] == true` with a live owner (663-674): writes `visible_in_hand = 0` into the Properties entry when nil. Calls `funcOwner.call("createButtons", {obj=o})` if the filter passes.
6. Else (editing mode, 675-694): calls only the edited property's `createButtons`, then adds an Encoder "X" button (`closeEditor`) at `{(-1.1+offset_x)*flip, 0.28*flip, 1.4+offset_y}`, merged with the style table.
7. Writes global vars `k`, `flip`, `temp`, `barSize`, `fsize`, `offset_x`, `offset_y`, `ob` (676-683).

**What triggers a rebuild:** `APIrebuildButtons`, `encodeObject`, `APIenableEncoding`, `closeEditor`, `disableEncoding`, `flipMenu` (`APIFlip`), hand-zone enter/leave (458-469), `onObjectDropped` (522-529), `onObjectLeaveContainer` (483-495), and Encoder load (197).

## 1.5 Registered properties, menus and values on this table

| propID | Name | Owner (GUID, where) | activateFunc | visible | visible_in_hand | tags | Values |
|---|---|---|---|---|---|---|---|
| `_MTG_Simplified_UNIFIED` | Easy Modules Unified | b93b40 loose | `ModuleActivation` | false | 0 | basic,counter | `tyrantUnified` |
| `πKeywords` | Keywords^π | ae12d3 loose | `toggleKeywordsMenu` | (true) | 1 | basic,counter | `activeIcons`, `iconMenuOn`, `iconLayout`, 19 `mtg_*` keys |
| `MorphinTime` | Morphin' Time | ad044a loose | `toggleFaceDown` | (true) | 1 | basic,counter | `subMenuOpen`, `cardName`, `cardDesc`, `activeMode` |
| `MTG_Phase` | Phase Out | c2df33 loose | `phaseOut` | (true) | nil→0 | tool,face_prop | `mtg_phased` |
| `MTG_Token` | Is Token | 716ee6 loose | `tToken` | (true) | nil→0 | tool | `mtg_token` |
| `Stickers` | Sticker Menu | c5ea55 loose | `toggleProp` | false | nil→0 | basic | (none) |
| `MTG_Colors` | MTG Colors | b8b8df loose | `callEditor` | (true) | nil→0 | basic,face_prop | `mtg_colors` |
| `πCounter` | Counter^π | def0af loose | `toggleProp` | (true) | nil→0 | basic | `picounter` |
| `πScry` | Scry Module | de4346 loose | `toggleProp` | false | 2 | tool,table_tool | (none) |
| `πotepad` | Notepad^π | 7a0067 loose | `toggleProp` | (true) | 1 | tool | `note` |
| `moon-mtg-equip` | Manage Equipment | 7deec9 in bag 4f3387 | `""` | false | 0 | basic,counter | `moon_mtg_equip` |
| `Card Importer` | (out of scope) | 988e5e loose | — | — | — | — | Easy Modules looks it up (2264) |

Menu: `πMenu` (c369d7, loose): `activateFunc='createMenu'`, `visible_in_hand=1`.

| valueID | validType | default | Registered at |
|---|---|---|---|
| `obj_owner` | (passed as `type='color'`, so validType is nil → no check) | `'Grey'` | Encoder 140 |
| `tyrantUnified` | `'nil'` | big table (Easy Modules 315-354) | Easy Modules 356 |
| `activeIcons` | `'nil'` | `{}` | πKeywords 123 |
| `iconMenuOn` | boolean | false | πKeywords 125 |
| `iconLayout` | string | `'art'` | πKeywords 127 |
| `mtg_*` keyword values | number or boolean | 0 or false | πKeywords 130-137 |
| `subMenuOpen` | boolean | false | Morphin' 94 |
| `cardName`, `cardDesc` | string | `"Morphin' Time Error"` | Morphin' 101-115 |
| `activeMode` | string | `"mtg_faceDownCreature"` | Morphin' 117 |
| `mtg_phased` | boolean | false | Phasing 27 |
| `mtg_token` | boolean | false | Is it a token 25 |
| `mtg_colors` | `'pattern(^[wubrg]*$)'` | `''` | Color Module 44 |
| `picounter` | number | 0 | πCounter 29 |
| `note` | nil | `{text='', editON=true}` | πNotepad 38 |
| `moon_mtg_equip` | `'nil'` | `{}` | moon-equip 58 |

**Default tables are shared.** `APIobjGetPropData` (1240) and `APIobjGetValueData` (1212) store `Values[v].default` by reference. Outside callers get copies through `.call`, so this only matters inside the Encoder.

## 1.6 Public API (`enc.call(name, tbl)`)

Reach the Encoder with `Global.getVar('Encoder')` (set at 130 and 520) or `getObjectFromGUID('02e062')`. Every API function takes one table. "Not encoded" means `EncodedObjects[guid] == nil`.

### Registration and lookup

| Function | Line | Param shape | Returns | Behaviour, branches, bugs | Callers in scope |
|---|---|---|---|---|---|
| `APIregisterProperty(p)` | 837 | `{propID, name, values, funcOwner, activateFunc, visible?, visible_in_hand?, tags?}` | nil | `Properties[propID] = deepcopy(p)`; logs `"<propID> Registered"` (849). Overwrites any earlier entry. | every property module |
| `APIgetPropsList(p)` | 854 | `{tags={...}}` or nil | `{propID = "[Red]MISSING![White]"? .. "propID : name {v1,v2,}"}` | Writes global vars `tags`, `data`. With tags: writes `Properties[k].tags='untagged'` when empty (864-866), then matches with `string.find` (868). Without tags: lists all. | πMenu 115 |
| `APIpropertyExists(p)` | 898 | `{propID}` | bool | — | Easy Modules, moon-equip, Drop-On counter |
| `APIgetPropValues(p)` | 902 | `{propID}` | list or `{}` | — | none |
| `APIgetProp(p)` | 909 | `{propID}` | property table or nil | Through `.call`, `funcOwner` comes back as an Object. | πMenu 160, Easy Modules 2264 |
| `APIremoveProperty(p)` | 1483 | `{propID}` | nil | Deletes the entry; cards keep `encoded[propID]`. | Phasing 94, Color 159 |
| `APIregisterValue(p)` | 925 | `{valueID, validType, default, desc}` | nil | Always overwrites (the "already registered" check is commented out, 926). Rebuilds the validator (931). | every value module |
| `APIlistValues()` | 936 | — | `{valueID = "validType --desc"}` | **Always errors on this table**: `obj_owner` and `note` have nil `validType`, and 939 concatenates it. | none |
| `APIvalueExists(p)` | 944 | `{valueID}` | bool | — | Sticker's spawned script (180) |
| `APIregisterMenu(p)` | 951 | `{menuID, funcOwner, activateFunc, visible_in_hand}` | nil | Does **not** increment `CORE_VALUE.menu_count`. | πMenu 78 |
| `APIlistMenus()` | 959 | — | list of menuIDs | Writes global var `data`. | none |
| `APIgetMenu(p)` | 966 | `{menuID}` | menu table or nil | — | none |
| `APIregisterStyle(p)` | 1014 | `{styleID, name, desc, styleTable}` | nil | — | none |
| `APIlistStyles()` | 1022 | — | `{styleID = "id = name:desc"}` | — | none |
| `APIsetGlobalStyle(p)` | 1029 | `{styleID}` | nil | Ignored if the style is unknown. | none |
| `APIgetGlobalStyle()` | 1034 | — | styleID | — | none |
| `APIgetStyleTable(p)` | 1037 | `{styleID}` or `{color}` or nil | style table | `{color}` errors if `Players[color]` is nil (1043). Falls back to the global style. | Color 56, 70; Is it a token 38 |
| `APIregisterZone(p)` | 1054 | `{guid, name, func_enter, func_exit, funcOwner, color}` | nil | `func_exit` is stored as `func_leave`. **The zone events call these function names on the Encoder itself (475, 480), not on `funcOwner`.** | none |
| `APIlistZones()` | 1062 | — | `Zones` (copy) | Keys are hand-zone GUIDs; `name` is `"<Color>_<n>"`. | πScry 65, Easy Modules 2857, Global 19 |
| `APIgetZone(p)` / `APIisZone(p)` | 1065 / 1068 | `{guid}` | entry / bool | — | none |

### Per-object state

| Function | Line | Param shape | Returns | Behaviour, branches, bugs | Callers in scope |
|---|---|---|---|---|---|
| `APIencodeObject(p)` | 1087 | `{obj}` | nil (the inner bool is dropped) | `encodeObject` (561): skips if `obj.getVar('noencode') == true`, if already encoded, or if `obj` is the Encoder. Else creates the entry and rebuilds. | Easy Modules 2694, 2235; Morphin' 416; Mass Face Down 98, 122; Cascade 158; Manifest 113; Tovoloar 60, 78; moon-equip 73; Drop-On 133; Sticker's spawned script |
| `APIobjectExists(p)` | 1091 | `{obj}` | bool | — | many |
| `APIobjDisabled(p)` | 1095 | `{obj}` | bool | false if not encoded. | none |
| `APIobjReset(p)` | 1102 | `{obj}` | nil | `APIobjResetProp` for every propID in `encoded`. | none |
| `APIobjRemove(p)` | 1111 | `{obj}` | the removed entry | Clears buttons and inputs. Sets `noencode` to the **string** `"Will no longer be encoded."` (1114). `encodeObject` only blocks `noencode == true` (562), so the card can be re-encoded at once. | none |
| `APIobjCloneData(p)` | 1120 | intended `{obj=new, data=source, new_obj=new}` | nil | Mixed keys: GUID from `p.obj` (1121) and `p.data` (1122), encodes `p.new_obj` (1125). Works only if `obj` and `new_obj` are the same object. | none |
| `APIobjUpdateThis(p)` | 1131 | `{obj}` | nil | Re-resolves `this` by GUID. | πCounter 55; Drop-On 147 |
| `APIobjIsPropEnabled(p)` | 1140 | `{obj, propID}` | bool | false if not encoded or never set. | many |
| `APIobjGetProps(p)` | 1152 | `{obj}` | `{propID=bool}` or nil | — | πMenu 151, Easy Modules 2211, Global |
| `APIobjSetProps(p)` | 1159 | `{obj, data={propID=bool}}` | nil | Replaces `encoded` whole. Does not seed defaults. | Easy Modules 2237, Global 1290 |
| `APIobjCallProp(p)` | 1166 | `{obj, propID, color?, data?}` | nil | Calls `funcOwner.call(activateFunc, {obj, color, alt})`: the module gets **one positional table**. | none |
| `APItoggleProperty(p)` | 1077 | `{obj}` and/or `{ply}`, plus `propID` | nil | `toggleProperty` (751): nil→true, true→false, other→true; seeds defaults. The `ply` branch errors (769 calls `o.getGUID()` first at 752). | most modules' activateFuncs |
| `APIobjEnableProp(p)` | 1176 | `{obj, propID}` | nil | Toggles only if not already `true`. | Easy Modules, Tovoloar, moon-equip, Drop-On, Global, Sticker |
| `APIobjDisableProp(p)` | 1186 | `{obj, propID}` | nil | Toggles if not `false`. **If the property was never set (nil), this turns it ON** (1190). | Is it a token 67; Phasing 73; πScry 74, 87, 111, 181, 205, 228 |
| `APIobjResetProp(p)` | 1196 | `{obj, propID}` | nil | `encoded[propID]=false`; every value back to default. Errors if a value is unregistered (1201). | Color 98 |
| `APIobjGetValueData(p)` | 1208 | `{obj, valueID}` | `{valueID=value}` or nil | Seeds the default. Writes global vars `val`, `data`. | Morphin' 357; πCounter 66, 125; πKeywords 198, 275 |
| `APIobjSetValueData(p)` | 1220 | `{obj, valueID, data={valueID=v}}` | nil | Runs `_G[valueID.."Validate"](new, cur)`. | Morphin', πCounter, πKeywords, Drop-On |
| `APIobjDefaultValue(p)` | 1226 | `{obj, valueID}` | nil | — | none |
| `APIobjGetPropData(p)` | 1234 | `{obj, propID}` | `{valueID=value}` for the property's values; nil if not encoded | Seeds defaults. **Errors if `propID` is not registered** (1238). Writes global var `data`. | most modules |
| `APIobjSetPropData(p)` | 1247 | `{obj, propID, data={valueID=v}}` | nil | For each of the property's values present in `data`: `Values[v].validate(new, cur)`. Other keys are ignored. Errors after an Encoder reload until the value is re-registered (see `onLoad` Details). | most modules |
| `APIobjGetAllData(p)` | 1259 | `{obj}` | `values` (copy) or nil | — | Easy Modules 2212; Global 657; Sticker's spawned script |
| `APIobjSetAllData(p)` | 1266 | `{obj, data={valueID=v}}` | nil | Unregistered keys are skipped. | Easy Modules 2236; Global; Sticker's spawned script |
| `APIdisableEncoding(p)` | 1457 | `{obj}` | nil | `disable=true`, clears buttons and inputs. Does not restore the name (compare `disableEncoding` 709). | Cascade 159 |
| `APIenableEncoding(p)` | 1464 | `{obj}` | nil | `disable=false`, rebuild. | Cascade 221, 236 |
| `APIobjGetOName(p)` / `APIobjGetODesc(p)` | 1470 / 1473 | `{obj}` | name / desc at encode time | Errors if not encoded. | none |

### Menus, editing, buttons

| Function | Line | Param shape | Returns | Behaviour, branches, bugs | Callers in scope |
|---|---|---|---|---|---|
| `APIobjGetMenuData(p)` | 971 | `{obj, menuID}` | `{open,pos}`; nil if not encoded | Default `{open=false,pos=0}` is returned but not stored. Writes global var `data`. | πMenu 116 |
| `APIobjSetMenuData(p)` | 981 | `{obj, menuID, data}` | nil | Merges keys. | none |
| `APIobjGetMenus(p)` | 992 | `{obj}` | `menus` | — | none |
| `APIobjToggleMenu(p)` | 998 | `{obj, menuID}` | nil | Flips `open`. | πMenu 219 |
| `APIsetEditing(p)` | 1411 | `{obj, propID}` or `{ply, propID}` | nil | Rebuilds then draw only that property plus an "X". | Color 91 |
| `APIgetEditing(p)` | 1420 | `{obj}` or `{ply}` | propID or nil | Errors if not encoded. | Color 122 |
| `APIclearEditing(p)` | 1428 | `{obj}` or `{ply}` | nil | — | Color 111 |
| `APIrebuildButtons(p)` | 1436 | `{obj}` | nil | `buildButtons(obj)`. With `{ply}` it calls `updateXML`, which **does not exist** (1440). | nearly every module |
| `APIformatButton(p)` | 1443 | `{str, font_size, max_len, xJust, yJust}` | `barSize, fsize, offset_x, offset_y` | Wraps `updateSize` (600). | Phasing 42, Global 2513 |
| `APIFlip(p)` | 1447 | `{obj, flip?}` | nil | `flipMenu(obj, p.flip)`. Every caller passes only `{obj}`, so the "also flip the selection" branch never runs. | Morphin', Easy Modules, πMenu, Drop-On, Global |
| `APIgetFlip(p)` | 1451 | `{obj}` | `1` (front) or `-1` (back) | Errors if not encoded. | every `createButtons` |
| `APIversionComp(p)` | 1478 | `{wv, cv}` | the larger version string; `cv` on a tie | — | Phasing 97, Color 162 |

### Player-color API (unused on this table)

| Function | Line | Param shape | Bug |
|---|---|---|---|
| `APIencodePlayer` | 1281 | `{ply}` | — |
| `APIplayerExists` | 1285 | `{ply}` | — |
| `APIplyIsPropEnabled` | 1289 | `{ply, propID}` | Checks `EncodedObjects[color]` instead of `Players` (1291), so it always returns false. |
| `APIplyGetProps` / `APIplySetProps` | 1301 / 1308 | `{ply}` / `{ply, data}` | — |
| `APIplyEnableProp` / `APIplyDisableProp` | 1315 / 1325 | `{ply, propID}` | Index `Players` by `p.obj.getGUID()` and call the table `Players(...)` (1318-1320, 1328-1330). Both always error. |
| `APIplyGetValueData` / `APIplySetValueData` / `APIplyDefaultValue` | 1335 / 1347 / 1353 | `{ply, valueID, data?}` | — |
| `APIplyGetPropData` / `APIplySetPropData` | 1361 / 1374 | `{ply, propID, data?}` | — |
| `APIplyGetAllData` / `APIplySetAllData` | 1385 / 1392 | `{ply, data?}` | — |

---

# Part 2. Script reference

## Encoder

- **Object:** "Encoder", GUID **02e062**, `PiecePack_Arms`, loose. Description is overwritten with `change_log` on load (128). Global makes it non-interactable 5 frames after load (Global 11-13).
- **Encoder propID / values:** registers the value `obj_owner` only (140).
- **Overview:** the per-card data store and button host for every module in Part 1. It rebuilds card buttons, tracks hand zones, and self-updates from GitHub.
- **API functions:** all listed in 1.6 (called by other objects through `.call`).

### Function table (non-API)

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad(saved_data)` | 124 | Restores registries and cards; sets up buttons, context items, zones, update check. | TTS load event | Sets Global `Encoder`; WebRequest; may spawn a menu object |
| `onSave()` | 289 | Serialises all registries to JSON. | TTS save event | Writes global var `saved_data` |
| `callVersionCheck()` | 345 | Fetches the Encoder source and every module `UPDATE_URL`. | "Update" context item (255, admin only) | WebRequests that can replace scripts |
| `updateCheck(wr)` | 366 | Compares the remote version; does nothing with the result. | WebRequest callback (267, 269) | none |
| `versionCheck(wr)` | 376 | Replaces its own script if the remote version is newer. | WebRequest callback (347, 349) | `self.script_code = wr; self.reload()` |
| `versionComp(a,b)` | 393 | Returns the larger dotted version string. | 368, 378, 518, `APIversionComp` | Writes global vars `va`, `vb` |
| `buildZones()` | 416 | Registers every hand zone in `Zones`. | `onLoad` after 2 frames (274) | Writes `Zones`; global var `id` |
| `getMenuModule(wr)` | 438 | Spawns a "Menu Module" chip running downloaded code. | WebRequest callback (277) | Spawns `PiecePack_Crowns`; sets its `script_code` |
| `hideCardDetails(tar)` | 458 | Rebuilds a card with "in hand" filtering. | `onObjectEnterZone` via `self.call` (475) | Card buttons rebuilt |
| `showCardDetails(tar)` | 464 | Rebuilds a card with "on table" filtering. | `onObjectLeaveZone` via `self.call` (480) | Card buttons rebuilt |
| `onObjectEnterZone(zone,obj)` | 472 | Runs the zone's `func_enter` on the Encoder. | TTS event | see above |
| `onObjectLeaveZone(zone,obj)` | 478 | Runs the zone's `func_leave` on the Encoder. | TTS event | see above |
| `onObjectLeaveContainer(ctr,obj)` | 483 | Rebuilds an encoded card after it leaves a deck or bag and settles. | TTS event | Card buttons rebuilt |
| `onObjectDestroyed(obj)` | 496 | When the Encoder itself is destroyed, strips all encoded cards and destroys non-hand zones. | TTS event | Clears buttons and context menus on every encoded card; renames them |
| `onObjectDropped(c,obj)` | 517 | Claims Global `Encoder`; rebuilds a dropped encoded card; re-registers dropped modules. | TTS event | Global var; card buttons; `registerModule` call |
| `handCheck(obj)` | 537 | Tells whether a card rests in a registered hand zone. | `buildButtons`, 489, 525 | none |
| `doNothing()` | 550 | Empty button callback. | Encoder label buttons (133, 136) | none |
| `createEncoderButtons()` | 554 | Draws the "Encoder" and version labels on itself. | `onLoad` (229) | Buttons on the Encoder |
| `encodeObject(o)` | 561 | Creates the per-card entry and draws it. | `APIencodeObject`, `APIobjCloneData` | Writes `EncodedObjects`; rebuild |
| `encodePlayer(c)` | 584 | Creates a `Players` entry for a color. | `onLoad` (227), `APIencodePlayer` | Writes `Players` |
| `updateSize(text,font_size,max_len,x_just,y_just)` | 600 | Computes a button width, font size and x offset for a label. | `onLoad` (135), `buildButtons` (682), `APIformatButton` | Writes global vars `offset_x`, `offset_y`, `barSize` |
| `buildContextMenu(o)` | 631 | Adds a "Flip Menu" context item to a card. | nobody (call commented out at 578) | — |
| `buildButtons(o,h)` | 637 | Clears and redraws all module buttons on a card. | see 1.4 | Card buttons and inputs cleared and redrawn |
| `closeEditor(o)` | 699 | Leaves editing mode and redraws. | Encoder "X" button (684) | Writes `editing=nil`; rebuild |
| `disableEncoding(o,p)` | 709 | Turns encoding off for a card and the player's selection; restores original names. | πMenu "Disable Encoding" button (πMenu 200, `function_owner=enc`) | `setName(oName)`; clears buttons |
| `flipMenu(o,p)` | 729 | Moves the overlay to the other face of the card. | `APIFlip` | Writes `flip`; sets `hide_when_face_down`; rebuild |
| `toggleProperty(o,p)` | 751 | Flips `encoded[propID]` and seeds that property's value defaults. | `APItoggleProperty`, `APIobjEnableProp`, `APIobjDisableProp` | Writes `encoded`, `values` |
| `buildValueValidationFunction(p)` | 791 | Builds the validator for a value. | `APIregisterValue` (931), `onLoad` (180) | Writes `Values[p].validate`, `_G[p.."Validate"]`, global var `v` |
| `deepcopy(orig)` | 1490 | Recursive table copy with metatables. | `APIregisterProperty` | none |
| `garbageCollect()` | 1505 | Drops entries for destroyed cards and for modules whose owner is gone. | "Clean Tables" context item (262, no admin check) | Deletes registry entries |

**Context items on the Encoder (231-265):** "Main Branch" (admin: `beta=false`), "Beta Branch" (admin: `beta=true`), "Update" (admin: `callVersionCheck` + broadcast), "Clean Tables" (anyone: `garbageCollect`). Non-admins get a broadcast refusal (238, 249, 258).

**Event handlers:** `onLoad`, `onSave`, `onObjectEnterZone`, `onObjectLeaveZone`, `onObjectLeaveContainer`, `onObjectDestroyed`, `onObjectDropped`.

**Chat commands:** none.

**Buttons:** two labels on the Encoder (`doNothing`); per card, the "X" `closeEditor` button in editing mode (683-693).

**Remote code:**
- `URLS` (18-23), all on raw.githubusercontent.com/Jophire.
- Every load: GET `ENCODER` → `updateCheck` (a no-op) (266-270).
- After 2 frames, if `menu_count == 0`: GET `BASIC_MENU` and spawn it as a scripted object (273-282, 438-453).
- Admin "Update": GET `ENCODER`/`ENCODER_BETA` → `versionCheck` replaces the Encoder's script. Then GET each module's `UPDATE_URL` → that module's `updateModule` (345-363). Phasing (c2df33) and Color Module (b8b8df) define one. Sticker (c5ea55) sets `UPDATE_URL=''`, which is not nil, so a GET to `''` is attempted with a callback (`updateModule`) that Sticker does not define.
- `URLS.XML` is unused (284 is commented out).

### Details

- **`onLoad(saved_data)` 124-285**
  - W: global vars `basic_buttons` (125), `barSize`, `fsize`, `offset_x`, `offset_y` (135), `loaded_data` (144); Global `Encoder` (130); description (128).
  - Registers value `obj_owner` with key `type`, not `validType` (140), so it has no validation and breaks `APIlistValues`.
  - If `saved_data` is non-empty (143):
    - `properties` (145-160): decode each. Resolve `funcOwner` by GUID once (149). `Wait.condition` calls `funcOwner.call('registerModule')` when the owner is non-nil. The 0.1 s timeout deletes the property. The condition reads the field resolved once, so a missing owner always times out. The module's own onload re-registers it later.
    - `zones` (161-174): same pattern. The success function is empty (168). On timeout (0.2 s) the zone is deleted.
    - `values` (175-184): decode. `buildValueValidationFunction` runs only if `validate == nil` (179). **Bug:** `onSave` stores `validate = ''` (327), so after a reload `validate` is the string `''`. Any `APIobjSetPropData` on that value then errors ("attempt to call a string value") until a module re-registers the value. All in-scope modules re-register on load, which hides the bug.
    - `players` (185-187): replaced whole.
    - `cards` (188-201): decode. Drop if the GUID no longer resolves. Else `buildButtons` after 2 frames.
    - `menus` (202-223): reset `menu_count` to 0. Each owner gets `registerModule` and `menu_count + 1` when it resolves (0.1 s timeout deletes the menu).
  - `encodePlayer` for every color (226-228); `createEncoderButtons` (229); context items (231-265).
  - Update check (266-270); `CORE_VALUE.beta` is always false here (not saved).
  - `Wait.frames(…, 2)` (273-282): `buildZones()`. Then if `menu_count == 0`: broadcast "No menu module located…" and download the default menu. The menu restore runs inside a `Wait.condition`, so this check races it.
- **`onSave()` 289-341** — Returns a JSON string with `cards`, `properties`, `zones`, `values`, `players`, `menus`. For each card it re-resolves `this` (300). Live cards are encoded with `this=""` and then restored. Destroyed cards are skipped but stay in memory. Owners are swapped for GUIDs and back (309-337). `validate` is swapped for `''` and back (325-330). W: global var `saved_data`.
- **`callVersionCheck()` 345-363** — Called with the player color, which is ignored. Branch on `CORE_VALUE.beta` for the URL. For each property and menu, `v.funcOwner.getVar('UPDATE_URL')`; errors if an owner is nil. Writes global var `u`.
- **`updateCheck(wr)` 366-374** — `wr = wr.text`; `string.match(wr, "version = '(.-)'")`. If the remote text has no match, `versionComp(nil, …)` errors in `gmatch`. Both outcome broadcasts are commented out.
- **`versionCheck(wr)` 376-390** — If `versionComp(remote, local) ~= local`: broadcast (branch on `beta`), replace `script_code`, `reload()`. Else broadcast "No update found".
- **`versionComp(a,b)` 393-412** — Splits on `([0-9]+)%.?`, compares part by part (missing parts count as 0). Returns `a` if larger, `b` if smaller, `b` on a tie.
- **`buildZones()` 416-436** — For each `Hands.getHands()`: color from `getValue()`; counts hands per color; `Zones[hand.guid] = {name=color.."_"..n, func_enter='hideCardDetails', func_leave='showCardDetails', funcOwner=self, color}`. Hand 1 of Red is `Red_1`, hand 2 is `Red_2`. πScry relies on these names.
- **`getMenuModule(wr)` 438-453** — Spawns `PiecePack_Crowns` 1 unit above the Encoder, scale 2/3, silent. The callback names it "Menu Module", sets `script_code = wr`, `reload()`. Then `Wait.condition` calls `registerModule` when `obj.spawning` is **true** (450); that reference is the pre-reload object. W: global var `params`.
- **`hideCardDetails(tar)` / `showCardDetails(tar)` 458-469** — `tar = tar[1]` (the `{obj}` packed at 475/480). Rebuild only if encoded, with `h=true` / `h=false`.
- **`onObjectEnterZone` / `onObjectLeaveZone` 472-482** — Only for zones in `Zones`. Uses `self.call(func_enter/func_leave, {obj})`, ignoring `funcOwner`.
- **`onObjectLeaveContainer(ctr,obj)` 483-495** — Only for encoded objects: refresh `this`. If `obj.use_hands`: wait until not resting, then until resting or nil, then `buildButtons(obj, handCheck(obj))`. Non-hand objects get no rebuild.
- **`onObjectDestroyed(obj)` 496-516** — Only when `obj == self`. For every encoded card: re-resolve `this`, `clearButtons()`, `setName(v.name)` and `clearContextMenu()`. **Bug:** the field is `oName`, so `setName(nil)` (501). A destroyed card makes `v.this` nil and the loop errors. Loops colors with an empty body (504-508). Destructs zone objects whose `type ~= "Hand"` (509-514); none exist here. W: global var `o`.
- **`onObjectDropped(c,obj)` 517-533**
  - 518: `versionComp(Global.getVar('Encoder').getVar('version'), version)` errors if Global `Encoder` is nil; the nil check at 519 comes too late.
  - If this Encoder's version is the newest (and `mod_name == 'Encoder'`), or Global is nil → `Global.setVar('Encoder', self)`.
  - If `obj` is encoded, not disabled and `use_hands`: wait until resting, then rebuild with `handCheck`.
  - If `obj.getVar("pID") ~= nil` → `obj.call("registerModule")`. Applies to Easy Modules, πKeywords, Morphin', Phasing, Is-token, Sticker, Color, πMenu, πCounter, πScry, πNotepad. moon-equip uses `prop_id`, so it is not re-registered this way.
- **`handCheck(obj)` 537-547** — false if `obj` is nil, locked, or held. True if any of `obj.getZones()` is in `Zones` with `type == "Hand"`.
- **`doNothing()` 550** — empty.
- **`createEncoderButtons()` 554-558** — `self.createButton` for each entry of `basic_buttons` (`Name`, `VersionDisp`).
- **`encodeObject(o)` 561-582** — Returns false if `noencode == true` (strict). Returns false if already encoded or `o == self`. Else creates the entry (`flip=1`, `disable=false`), `buildButtons(o)` and returns true. 578 (`buildContextMenu`) is commented out.
- **`encodePlayer(c)` 584-598** — Creates `Players[c]` if missing; returns true. Else false. 594 (`updateXML`) is commented out.
- **`updateSize(...)` 600-628** — Finds the longest line and the line count. If the longest line is over `max_len`, the font is scaled down (621). `offset_x = -x_just*(size/19+0.05)`; `offset_y = 0`; `barSize = size*(fsize/(150/83))+20`. Returns all four. `size`/`depth`/`fsize` are local; `offset_x`, `offset_y`, `barSize` are globals.
- **`buildContextMenu(o)` 631-633** — `o.addContextMenuItem('Flip Menu', …flipMenu(o,0))`. Dead code.
- **`buildButtons(o,h)` 637-696** — See 1.4.
- **`closeEditor(o)` 699-706** — `type(o) == 'String'` is never true (Lua returns `'string'`), so it always clears the object's `editing` and rebuilds.
- **`disableEncoding(o,p)` 709-727** — `disable=true`, `setName(oName)` on `o`. If the player has a selection, the same for every other encoded selected object, plus `clearButtons`, `clearInputs`, `buildButtons` (a no-op because disabled). Then clears `o`. Restoring `oName` undoes any Morphin' Time rename made after encoding.
- **`flipMenu(o,p)` 729-749** — `flip ~= 1` → `flip=1`, `hide_when_face_down=true`; else `flip=-1`, `hide_when_face_down=false`. If `p` is a string (a player color): recurse on that player's other encoded selected objects with `p=0`. Then rebuild. `flip=-1` disables TTS's hide-when-face-down for the card.
- **`toggleProperty(o,p)` 751-787** — Encoded branch: nil→true (754-755); non-true→true (757-758); true→false (760). Seeds defaults for each value in `Properties[p].values` (763-767); errors if `p` is not registered. Returns the new state. The `'String'` player branch (769) is unreachable; see `APItoggleProperty`. Returns nil if not encoded.
- **`buildValueValidationFunction(p)` 791-813** — See 1.2. W: global var `v`, `Values[p].validate`, `_G[p..'Validate']`.
- **`deepcopy(orig)` 1490-1503** — Standard recursive copy, including keys and metatables.
- **`garbageCollect()` 1505-1528** — Deletes `EncodedObjects[k]` when `this == nil` and the GUID no longer resolves. Deletes properties, zones and menus whose `funcOwner` is nil.

**With the rules engine:** REUSE as the overlay write API (get/set prop data, then `APIrebuildButtons`). Key it by current GUID. Re-register values before writing after an Encoder reload. Never put engine buttons directly on a card, because rebuilds clear them; register a property such as `Engine` or use XML UI. Gate the "Update" context item: it fetches remote code.

---
## TyrantNomad's Easy Modules Unified

- **Object:** "[FFCC00]TyrantNomad's[-] Easy Modules Unified", GUID **b93b40**, `PiecePack_Arms`, loose. Global sets it non-interactable 5 frames after load (Global 11-13).
- **Encoder:** propID `_MTG_Simplified_UNIFIED` (`pID`, 9). Value `tyrantUnified` (validType `'nil'`, default 315-354). `visible=false`, `visible_in_hand=0`, `activateFunc='ModuleActivation'`.
- **Overview:** draws the per-card P/T box, +1/+1 badge, generic/loyalty/defense counter, planeswalker ability buttons, owner/controller gem, DFC face button, and side buttons for counter/P/T/+1 toggles, exact copy, re-import, and emblems/tokens. It auto-encodes cards a player drops and parses base P/T, loyalty and DFC type from the card text. It also tracks which deck a card came from, to guess its owner.

**`tyrantUnified` default (315-354):** `hasParsed=false`, `exactCopyOffset=0`, `activeFace=1`, `doubleFaceType="none"`, `doubleFaceStates=false`, `cardFaces={ {basePower=0, baseToughness=0, isPlaneswalker=false, pwAbilities={}, pwCount=0}, {…back…} }`, `power=0`, `toughness=0`, `plusOneCounters=0`, `namedCounters=0`, `hasNonLoyaltyCounter=false`, `displayCounters=false`, `displayPlaneswalkerAbilities=false`, `displayPowTou=false`, `displayPlusOne=false`, `displayOwnership=true`, `displayDFC=false`, `ownerColor="Grey"`, `controllerColor="Grey"`. `cardFaces[i].isBattle` is added by the parser (2542). `doubleFaceType` can be `none`, `split`, `flip`, `adventure`, `oldImport`, `modal`, `battle`, `weredrazi`, `discovery`, `ascendant`, `werecard`, `default`.

**Script globals (saved by `onSave` 40-52):** `autoActivateModule`, `autoActivatePlayerSettings` (steam_id → bool), `autoActivateCounter`, `autoActivatePowTou`, `autoActivatePlusOne`, `autoActivateDFC`, `autoActivateOwnership` (all default true, 54-60). Not saved: `isRegistered`, `encVersion`, `enc` (global, set in many places), `copyCount`, `lockReImport`, `lockEmblemsAndTokens`, `deckCandidateTracker`, `deckPlayerPairs`.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 20 | Loads settings, sets up deck tracking, schedules registration, draws chip buttons. | TTS load | Buttons on b93b40; Timer |
| `SelfUpdateCheck(webRequest)` | 31 | Replaces own script if GitHub has a newer `moduleVersion`. | Nothing wired (22 commented). Chat "module…update" calls it with no argument (453) | Would rewrite `script_code` |
| `onSave()` | 40 | Saves the auto-activate settings. | TTS save | none |
| `ProcessSavedData(saved_data)` | 61 | Restores the auto-activate settings. | `onload` | Writes the `autoActivate*` globals |
| `TryAutoRegister(data)` | 75 | Schedules `RegisterModule` 2 s later (via a Timer that calls itself). | `onload`, `ForceEncoderUpdate`, `ForcePlaceholderEncoder`, `GetClickdataTable`, Timer | Timer "unifiedModuleAutoRegister" |
| `ForceEncoderUpdate(placeholderCode)` | 91 | Overwrites the Global Encoder's script with downloaded code and reloads it. | WebRequest callback from chat "force encoder update" (381) | **Replaces Encoder script** |
| `ForceImporterUpdate(placeholderCode)` | 104 | Overwrites the Card Importer's script with downloaded code. | WebRequest callback from chat "force importer update" (395) | **Replaces Importer script** |
| `ForcePlaceholderDependency(placeholderCode, moduleName)` | 116 | Spawns a reversi chip running downloaded code. | `ForcePlaceholderEncoder`, `ForcePlaceholderImporter` | Spawns an object; sets its script |
| `ForcePlaceholderEncoder(placeholderCode)` | 131 | Spawns a placeholder Encoder, then re-registers. | WebRequest callback (383) | as above |
| `ForcePlaceholderImporter(placeholderCode)` | 138 | Spawns a placeholder Card Importer. | WebRequest callback (397) | as above |
| `AttachCodeToPlaceholder(placeholderObject, placeholderCode)` | 142 | Sets a spawned object's script and reloads it. | spawn callback (125) | Script replaced |
| `CreateModuleChipButtons()` | 147 | Draws the module chip's labels, register button and AUTO toggle. | `onload`, `RefreshModuleChipButtons` | 7 buttons on b93b40 |
| `ClearModuleChipButtons()` | 259 | Removes the chip's buttons. | `RefreshModuleChipButtons` | Buttons removed |
| `RefreshModuleChipButtons()` | 266 | Clears and redraws the chip buttons. | `RegisterModule`, `ToggleAutoActivate` | Buttons |
| `registerModule()` | 273 | Alias of `RegisterModule`. | Encoder `onLoad` (152), Encoder `onObjectDropped` (531) | see below |
| `RegisterModule()` | 274 | Registers the property and the `tyrantUnified` value. | chip button (227), `TryAutoRegister` | Encoder registries; broadcasts |
| `RefreshEncoderVersion(encoder)` | 368 | Reads the Encoder's `version` as a number. | `RegisterModule`, `GetAmuzetsCardImporter` | Writes global `encVersion` |
| `ModuleActivation(obj,ply)` | 372 | Toggles the property on a card. | Encoder `APIobjCallProp` only (hidden from πMenu) | Encoder state |
| `onChat(message, player)` | 376 | Handles `force …`, `auto …`, `module …` chat commands. | TTS chat event | Remote code, settings, broadcasts |
| `BroadcastSettings()` | 457 | Broadcasts the auto-activate settings. | `onChat` | Broadcasts; global vars |
| `BroadcastCommands()` | 485 | Broadcasts the command list. | `onChat` | Broadcasts |
| `ToggleAutoActivate()` | 498 | Flips `autoActivateModule`. | chip "AUTO ON/OFF" button (244) | Redraws chip |
| `createButtons(t)` | 504 | Parses the card if needed and draws every overlay button. | Encoder rebuild | Buttons on the card |
| `GetPlaneswalkerAbilityVerticalOffset(abilityIndex, abilityCount)` | 1784 | Returns the z position for a loyalty ability button. | `createButtons` (1197) | none |
| `PropagateValueChange(dataTable)` | 1847 | Applies a value change to every encoded selected card, or to the clicked card. | all click handlers | Encoder data; rebuilds |
| `UpdateEncoderDataValue(dataTable)` | 1868 | Adds (number) or sets (bool/string) one `tyrantUnified` field and rebuilds. | `PropagateValueChange` | Encoder data; rebuild; broadcasts on type errors |
| `ToggleDisplayCounter(tar, ply, alt)` | 1905 | Toggles `displayCounters`; right-click toggles PW buttons instead. | "①" side button (687, 903) | Data; rebuild |
| `TogglePlaneswalkerAbilities(tar, ply, alt)` | 1916 | Toggles `displayPlaneswalkerAbilities`. | `ToggleDisplayCounter` right-click | Data; rebuild |
| `ToggleDisplayPowTou(tar, ply, alt)` | 1925 | Toggles `displayPowTou`. | "1/" side button (712, 928) | Data; rebuild |
| `ToggleDisplayPlusOne(tar, ply, alt)` | 1934 | Toggles `displayPlusOne`. | "+1" side button (737, 953) | Data; rebuild |
| `ToggleDisplayOwnership(tar, ply, alt)` | 1943 | Toggles `displayOwnership` and highlights (left) or unhighlights (right) the card and selected cards. | gem toggle button (1585) | Data; highlights |
| `ReceiveChangeActiveFace(tar, ply, alt, sel)` | 1968 | Switches the active DFC face (state swap, re-import, or data flip plus a physical flip). | DFC button (1663) | `setState` (new object), re-import, `flip()` |
| `ReceiveReimportOrChangeActiveFace(tar, ply, alt)` | 2032 | Old-import DFC: left re-imports, right switches face. | DFC button when type is `oldImport` (1655) | as above |
| `ReceiveGemClick(tar, ply, alt)` | 2038 | Left sets controller; right sets owner. | gem button (1522) | Data |
| `ReceiveOwnershipClick(tar, ply, alt)` | 2043 | Sets `ownerColor = ply`. | `ReceiveGemClick` | Data |
| `ReceiveControllerClick(tar, ply, alt)` | 2052 | Sets `controllerColor = ply`. | `ReceiveGemClick` | Data |
| `GetClickdataTable(tar, ply, alt)` | 2061 | Builds the change request table. | all click handlers | May schedule re-registration |
| `ReceiveCounterClick(tar,ply,alt)` | 2072 | `namedCounters` ±1. | counter button (1142) | Data |
| `ReceiveTenCounterClick(tar,ply,alt)` | 2079 | `namedCounters` ±10. | counter "+10" strip (1159) | Data |
| `GetPlaneswalkerAbilityDelta(dataTable, index)` | 2086 | Returns the loyalty change for ability `index` (X = -1; right-click reverses). | slot handlers | Writes `dataTable.varDelta` |
| `ReceivePlaneswalkerClickSlot1..4(tar, ply, alt)` | 2096, 2103, 2110, 2117 | Adds ability N's loyalty cost to `namedCounters`. | PW buttons (`'ReceivePlaneswalkerClickSlot'..index`, 1203) | Data |
| `ReceivePowerClick(tar,ply,alt)` | 2124 | `power` ±1. | power box (1385) | Data |
| `ReceiveToughnessClick(tar,ply,alt)` | 2131 | `toughness` ±1. | toughness box (1410) | Data |
| `ReceiveToughnessZeroClick(tar, ply, alt)` | 2138 | Same as `ReceiveToughnessClick`. | nobody | — |
| `ReceivePowTouClick(tar,ply,alt)` | 2145 | `power` and `toughness` ±1. | P/T strip (1298) | Data (2 rebuilds) |
| `ReceivePlusOneClick(tar,ply,alt)` | 2151 | `plusOneCounters` ±1. | +1 badge (1491) | Data |
| `ReceiveTenPlusOneClick(tar,ply,alt)` | 2158 | `plusOneCounters` ±10. | +1 "+10" strip (1446) | Data |
| `MakeExactCopy(tar, ply, alt)` | 2167 | Clones the card into a 5-wide grid; left-click also copies its Encoder data. | "❐" side button (762, 978) | Spawns a clone; Timers |
| `SetExactCopyData(dataTable)` | 2234 | Encodes the clone and copies values, props and flip. | Timer (0.2 s) | Encoder data; unlocks the clone |
| `ResetExactCopyOffset(dataTable)` | 2244 | Resets the grid counter. | Timer (3 s) | Data |
| `GetAmuzetsCardImporter()` | 2253 | Finds the Card Importer object through the Encoder's "Card Importer" property. | `createButtons`, `ReImport`, `EmblemsAndTokens`, `ForceImporterUpdate`, chat "force importer reload" | Broadcasts if too old |
| `CreateImporterRequestTable(tar, ply)` | 2281 | Builds the Importer request (name, oracle id from memo, spawn position). | `ReImport`, `EmblemsAndTokens` | none |
| `ReImport(tar, ply, alt)` | 2301 | Asks the Card Importer to re-import this card. | "↺" side button (788, 1004), `ReceiveChangeActiveFace`, `ReceiveReimportOrChangeActiveFace` | Spawns a card via the Importer; Timer |
| `ReEnableReImport()` | 2334 | Clears the re-import spam lock. | Timer (0.5 s) | — |
| `EmblemsAndTokens(tar, ply, alt)` | 2339 | Asks the Card Importer for this card's tokens and emblems. | "☗" side button (839, 1055) | Spawns tokens via the Importer |
| `ReEnableEmblemsAndTokens()` | 2373 | Clears the tokens spam lock. | Timer (0.5 s) | — |
| `ParseCardData(object, enc)` | 2378 | One-time parse of name/description into faces, P/T, loyalty, PW abilities, DFC type and display flags. | `createButtons`, `AutoActivate`, `InitializeCardData` | Encoder data |
| `string.splitUsingFind(text, separator)` | 2622 | Splits a string on a pattern. | `ParseCardData` | none |
| `HasKeywordOrNamedCounter(nameLine, description)` | 2638 | Detects counter keywords or "put N X counters on it". | `ParseCardData` | Writes global var `namedCounters` |
| `onObjectDropped(playerColor, object)` | 2668 | Auto-encodes a dropped card unless disabled globally or for that player. | TTS event | Encoder data |
| `onObjectSpawn(obj)` | 2673 | Fixes inverted card faces and stamps a `tyrantUnified` card or deck table. | TTS event | May `reload()` the card |
| `TryTimedEncoding(object)` | 2685 | Encodes a card and enables this property with parsed and ownership data. | `onObjectDropped`, `ReceiveChangeActiveFace`, other objects via `.call` | Encoder data; rebuild |
| `AutoActivate(dataTable)` | 2708 | Fallback activation when a card has no data yet. | `ParseCardData` (2386) | Encoder data |
| `InitializeCardData(object, enc)` | 2732 | Parses, then assigns ownership. | `TryTimedEncoding` | Encoder data |
| `TryAssignOwnership(object, enc)` | 2737 | Sets owner and controller from the card's source deck. | `InitializeCardData` | Encoder data |
| `InitializeDeckTables()` | 2758 | Creates an empty tracker per color. | `onload` | Writes `deckCandidateTracker` |
| `onObjectLeaveContainer(container, object)` | 2766 | Copies the container's deck info into a card leaving it. | TTS event | `setTable` on deck and card |
| `onObjectEnterContainer(container, object)` | 2772 | Copies a card's table to the container 1 s later. | TTS event | Timer; `setTable` on container |
| `ResetDeckTable(dataTable)` | 2789 | Writes the delayed container table. | Timer | `setTable` |
| `CheckGetSetContainerTable(container)` | 2793 | Gets or creates a deck's `tyrantUnified` table. | several | `setTable` on deck |
| `CheckGetSetCardTable(card, containerTable)` | 2804 | Gets or creates a card's `tyrantUnified` table, merging deck info. | several | `setTable` on card |
| `CheckRevertInvertedFaces(card)` | 2823 | Detects a face URL containing "/back/" and a back URL containing "/front/". | `onObjectSpawn` | may reload the card |
| `InvertCardFaces(card)` | 2833 | Swaps face and back URLs and reloads the card. | `CheckRevertInvertedFaces` | `setCustomObject` + `reload()` (new object) |
| `onObjectEnterScriptingZone(zone, object)` | 2845 | Counts cards from each deck entering each color's hand zone; after 7 it assigns that deck to the color. | TTS event | Writes trackers; `setTable` on deck |
| `AddPlayerDeck(playerColor, containerGUID)` | 2887 | Records the deck → color pairing. | `onObjectEnterScriptingZone` | `setTable` on deck |
| `DoNothing()` | 2901 | Empty callback. | label buttons | — |

**Event handlers:** `onload`, `onSave`, `onChat`, `onObjectDropped`, `onObjectSpawn`, `onObjectLeaveContainer`, `onObjectEnterContainer`, `onObjectEnterScriptingZone`.

**Chat commands (`onChat` 376-455, any player, lower-cased):**

| Starts with / contains | Effect |
|---|---|
| `force encoder` + `update` | GET Jophire Encoder Core.lua → `ForceEncoderUpdate`: **replaces the live Encoder's script** (381) |
| `force encoder` + `temporary` | same URL → spawns a placeholder Encoder chip (383) |
| `force encoder` + `reload` | `enc.reload()`; calls undefined `BroadcastToAll` first, which errors (387) |
| `force importer` + `update` | GET Amuzet Importer.lua → **replaces the Card Importer's script** (395) |
| `force importer` + `temporary` | spawns a placeholder Importer (397) |
| `force importer` + `reload` | `GetAmuzetsCardImporter().reload()`; errors if none (399-400) |
| contains `auto` and ` on`/` off` | sets `powtou` / `plusone` / `counter` / `encode` / `dfc` or `double-faced` / `owner` or `control`; `player` sets the sender's per-steam_id auto-encode (404-448) |
| `module` + `help` / `setting` / `update` | `BroadcastCommands` / `BroadcastSettings` / `SelfUpdateCheck()` (errors: nil argument) |

The `auto` match is a plain substring, so any chat line containing "auto" and " on"/" off" changes settings.

**Buttons on b93b40 (147-257):** "TyrantNomad's", background, "EASY MODULES", "VERSION …", "REGISTERED"/"ADD MODULE" labels (`DoNothing`). Register button (`RegisterModule` until registered). "AUTO ON/OFF" on the underside (`ToggleAutoActivate`).

**Buttons per card (`createButtons`):** see Details. Context items: none.

**Remote code:** chat-triggered script replacement of the Encoder and Importer (above), with no admin check. `SelfUpdateCheck` is disabled (22).

### Details

- **`onload(saved_data)` 20-29** — `ProcessSavedData`, `InitializeDeckTables`, `TryAutoRegister{recursiveCall=false}`, `CreateModuleChipButtons`. The self-update GET is commented out (22).
- **`SelfUpdateCheck(webRequest)` 31-38** — Parses `moduleVersion%s=%s(%d+%.%d+)` from the text. If greater than 3.14159265358979: replace script and reload. With nil input (from chat, 453) it errors at 32.
- **`onSave()` 40-52** — Returns JSON of the 7 `autoActivate*` globals.
- **`ProcessSavedData(saved_data)` 61-73** — Only if non-empty. Each bool falls back to true when nil. `autoActivatePlayerSettings` keeps `{}` when nil.
- **`TryAutoRegister(data)` 75-89** — `recursiveCall` true → `RegisterModule()`. Else destroy and create Timer `unifiedModuleAutoRegister` (2 s) that calls itself with `recursiveCall=true`.
- **`ForceEncoderUpdate(placeholderCode)` 91-102** — `.text`; if Global `Encoder` exists: set `script_code`, `reload()`, `TryAutoRegister`. Else broadcast failure.
- **`ForceImporterUpdate(placeholderCode)` 104-114** — Gets the importer, but checks `encoder ~= nil` instead of `importer` (110). A missing importer errors at 111.
- **`ForcePlaceholderDependency(placeholderCode, moduleName)` 116-129** — Spawns `reversi_chip` named "[FF0000]PLACEHOLDER [-]"..name at (0,5,0), scale (4,32,4), with a mocking description. Callback `AttachCodeToPlaceholder`. W: global var `spawnParams`.
- **`ForcePlaceholderEncoder` 131-136** — Placeholder plus `TryAutoRegister`. **`ForcePlaceholderImporter` 138-140** — placeholder only.
- **`AttachCodeToPlaceholder` 142-145** — `script_code = code; reload()`.
- **`CreateModuleChipButtons()` 147-257** — `isRegistered = enc.call("APIpropertyExists",{propID=pID})`, or false if there is no Encoder. Seven buttons; the register button's function and colors depend on `isRegistered`, and the AUTO label on `autoActivateModule`.
- **`ClearModuleChipButtons()` 259-264** — `self.removeButton(index-1)` for each entry of `getButtons()`. Indices shift as buttons are removed, but TTS keeps indices stable within a frame, so it is believed to work.
- **`RefreshModuleChipButtons()` 266-269** — Clear, then create.
- **`RegisterModule()` 274-366** — If an Encoder exists: `RefreshEncoderVersion`. Below 4.2 → broadcast and return. Below 4.4 → legacy property table (`callOnActivate=false`, `activateFunc=''`). Else modern (`tags`, `visible_in_hand=0`, `activateFunc='ModuleActivation'`). Then `APIregisterProperty`, `APIregisterValue(tyrantUnified)`, refresh the chip. No Encoder → two broadcasts. The 4.6.1 Encoder parses to `4.6`.
- **`RefreshEncoderVersion(encoder)` 368-370** — `tonumber(version:match("%d+%.%d+"))` → global `encVersion`.
- **`ModuleActivation(obj,ply)` 372-374** — `enc.call("APItoggleProperty",…)` using the global `enc`; nil if no other function has set it yet. Only `APIobjCallProp` passes `{obj,color,alt}` as one table, so `obj` would be that table.
- **`onChat` 376-455** — See the chat table. W: `autoActivate*`, `autoActivatePlayerSettings[steam_id]`, global `enc`.
- **`BroadcastSettings()` 457-483** — Broadcasts the version and settings. W: global vars `autoCounterText`, `autoPowTouText`, `autoPlusOneText`, `autoDFCtext`, `autoOwnershipText`. If auto is off: one warning. Else: one line per player who disabled auto (the enabled branch is empty, 474), then a hint.
- **`BroadcastCommands()` 485-496** — 10 broadcasts.
- **`ToggleAutoActivate()` 498-501** — Flips and redraws.
- **`createButtons(t)` 504-1782**
  - Sets global `enc`. No Encoder → nothing.
  - `ParseCardData(t.obj, enc)` (508) parses once per `hasParsed=false`.
  - Reads `tyrantUnified`, `APIgetFlip`, `activeFace`, `GetAmuzetsCardImporter()`. Builds color constants and about 25 tooltip strings (518-666; the multi/single-select prefixes are blanked, 545-548).
  - **Side buttons (668-1102):** two passes at the same spots.
    - First pass: size-0 visible labels at x=±1.025 (686-885).
    - Second pass: 150×150 transparent hit areas at x=±0.92 with hover color (887-1101).
    - Left column: "①" `ToggleDisplayCounter` (row 2), "1/" `ToggleDisplayPowTou` (row 1), "+1" `ToggleDisplayPlusOne` (row 0).
    - Right column: "❐" `MakeExactCopy`, "↺" `ReImport` (red error tint and other tooltip without an importer), "☗" `EmblemsAndTokens` (rotated 180°).
    - Font colors show the on/off state; the PW-abilities state shows in green (`buttonTextColorOnExtra`).
  - **Counter (1105-1276)** if `displayCounters`:
    - Position: x=0.81 (loyalty) or -0.87, z=1.3315. Battles: name line contains "battle" → x=0.9, z=-1.35, rotated -90 (1118-1122).
    - Buttons: light-grey bg (`DoNothing`), number `ReceiveCounterClick` (label `" N "`), and a "+10" strip `ReceiveTenCounterClick`.
    - **Bug:** `font_size=fSize` is an undefined global (1152), so the TTS default size is used.
    - PW abilities if `isPlaneswalker and displayPlaneswalkerAbilities` and `pwCount>0`: for each ability with a non-nil `abilityDelta`, three buttons. (1) Clickable "☗"/"■" `ReceivePlaneswalkerClickSlot<index>`, flipped 180° for minus costs. (2) A dark shadow glyph. (3) A cost label (`"+N "`, `"-N "`, `"-X "`). Vertical position from `GetPlaneswalkerAbilityVerticalOffset`.
    - **Oddity:** `index` is the text-line index, not the ability index. A loyalty card with a static line before its abilities, or more than 4 abilities, gets `…Slot5`/`Slot6` names, which have no handler.
  - **P/T (1279-1429)** if `displayPowTou`:
    - power = `basePower + power` if `basePower` is numeric. Else `basePower` when `power == 0`, else `power`. Same for toughness (1288-1292).
    - Buttons: a "both" strip `ReceivePowTouClick`, "/" label, two bg plates, power `ReceivePowerClick`, toughness `ReceiveToughnessClick`. Placed at x=0.75, z=1.3315 plus `loyaltyOffset` (-0.33 when a PW counter shows).
  - **+1/+1 (1432-1510)** if `displayPlusOne`: width grows with digits. Label `"+N/+N "` or `"-N/-N "`; W: global var `plusOneLabelString`. Buttons: "+10" strip `ReceiveTenPlusOneClick`, bg, badge `ReceivePlusOneClick`.
  - **Ownership (1512-1603):** if `displayOwnership`: black bg `ReceiveGemClick` at z=1.345 (scale 0.375), owner gem (black lerped to the owner color), controller gem (white lerped to the controller color). Always: toggle strip `ToggleDisplayOwnership` at z=1.475.
  - **DFC (1606-1780)** if `displayDFC` and type not none/flip/split:
    - Offset: planeswalker; artifact werecard; battle front; Transformers/MOM back list or battle back → `MOMback`; else by type.
    - **Oddity:** `MOMbacks:lower():match(cardName:lower())` uses the card name as a Lua pattern. An empty name always matches (1640).
    - Buttons: yellow "●" bg with `dfcFunction` (`ReceiveReimportOrChangeActiveFace` for `oldImport`, else `ReceiveChangeActiveFace`), a "○" frame, and two face symbols per type (1711-1779).
    - `adventure` and `artifactWerecard` are missing from `dfcLabelSymbols`. `adventure` never sets `displayDFC` (2597), so this is not reached.
    - W: global vars `dfcBGcolor`, `dfcFrameColor`, `dfcTextColor`.
- **`GetPlaneswalkerAbilityVerticalOffset(abilityIndex, abilityCount)` 1784-1844** — Index 1-6 only (else nil). Tables for 6, 5, 4, 3 and 2 slots. Count 1 uses the 4-slot table at index+2.
- **`PropagateValueChange(dataTable)` 1847-1866** — Only if `dataTable.player` is a string. If the player has a selection, applies `UpdateEncoderDataValue` to each selected object that `APIobjectExists` (the clicked card is affected only if it is selected). Else applies it to the target. Uses a local `enc`.
- **`UpdateEncoderDataValue(dataTable)` 1868-1903**
  - Number delta: adds if the field is a number, else broadcasts a mismatch. Bool or string delta: sets if the types match, else broadcasts. Other types: broadcasts an error.
  - A nil field: broadcasts "Overriding nil value" and sets it.
  - Writes back with `APIobjSetPropData`, then `enc.call("APIrebuildButtons")` using the **global** `enc` (1902).
- **`ToggleDisplay*` 1905-1966** — Each reads the current flag and sets its negation through `PropagateValueChange`. `ToggleDisplayCounter` with `alt` calls `TogglePlaneswalkerAbilities` instead. `ToggleDisplayOwnership` also highlights the card and selected cards in the clicker's color (left), or removes that highlight (right).
- **`ReceiveChangeActiveFace(tar, ply, alt, sel)` 1968-2030**
  - `sel` nil/true and a selection exists → recurse on each selected Card with `sel=false`, then return.
  - Returns if there is no data or `displayDFC` is off.
  - `doubleFaceStates` → `tar.setState(states[1].id)`: a new object. Copies the scale, then `TryTimedEncoding` and rebuild on the new object. The old object's Encoder data is not carried over.
  - `ownerColor ~= "Grey"` → `ReImport(tar, ply, false)` and return. Library cards are re-imported rather than flipped.
  - Else: switch `activeFace`. A PW face shows counters and abilities and hides P/T. Otherwise P/T shows only if the face's base P/T is non-zero.
  - `alt == false` → `tar.flip()` and `APIFlip`. Then write and rebuild (global `enc`, 2029). W: global vars `facePower`, `faceToughness`.
- **`ReceiveReimportOrChangeActiveFace` 2032-2036** — `alt` → change face; else `ReImport`.
- **`ReceiveGemClick` 2038-2041** — `alt == false` → controller; else owner.
- **`ReceiveOwnershipClick` / `ReceiveControllerClick` 2043-2059** — Read data (unused), set the string field to `ply` via `PropagateValueChange`.
- **`GetClickdataTable` 2061-2070** — Returns `{encoder, target, player, alt_click}`. The `varName, varDelta` entries in the constructor are nil globals. No Encoder → `TryAutoRegister` and returns nil; the caller then errors on `dataTable.varDelta`.
- **`ReceiveCounterClick` / `ReceiveTenCounterClick` 2072-2084** — `namedCounters` ±1 / ±10. No lower bound.
- **`GetPlaneswalkerAbilityDelta` 2086-2094** — Re-reads data. Delta = number, or -1 for X. Right-click negates it.
- **`ReceivePlaneswalkerClickSlot1-4` 2096-2122** — `namedCounters += delta`.
- **`ReceivePowerClick` / `ReceiveToughnessClick` / `ReceiveToughnessZeroClick` / `ReceivePowTouClick` / `ReceivePlusOneClick` / `ReceiveTenPlusOneClick` 2124-2163** — As in the table. Deltas are applied to the stored fields, which are deltas over base P/T. `ReceiveToughnessZeroClick` is unused.
- **`MakeExactCopy(tar, ply, alt)` 2167-2232**
  - Sets global `enc`. Grid slot from `exactCopyOffset` (5 per row); increments and saves it.
  - Directions: the card's right/forward, or, when the controller is not Grey, the reversed controller hand-1 transform. W: global var `controllerHand`.
  - Offset `-2.4*right*col + 3.6*forward*row`, y+0.05. `tar.clone(params)`; `copyCount++`.
  - Left click (`alt == false`): lock the clone, grab `APIobjGetProps` and `APIobjGetAllData`, Timer `exactCopyTimer<guid><n>` 0.2 s → `SetExactCopyData`.
  - Always: restart the 3 s Timer → `ResetExactCopyOffset`.
- **`SetExactCopyData(dataTable)` 2234-2242** — Encode the clone, `APIobjSetAllData`, `APIobjSetProps`. Flip if `flipData < 0`, using the **global** `enc` (2238). Rebuild, unlock.
- **`ResetExactCopyOffset` 2244-2251** — `exactCopyOffset = 0`.
- **`GetAmuzetsCardImporter()` 2253-2279**
  - Sets global `enc`. Below 4.4: `enc.getTable("Tools")["Card Importer"]`. Else `APIgetProp{propID="Card Importer"}` (W: global `moduleReference`).
  - Returns nil if missing. Reads the importer's `version`; below 1.901 → two broadcasts and nil. Else returns the object.
  - On this table it resolves to 988e5e if that importer registers a "Card Importer" property.
- **`CreateImporterRequestTable(tar, ply)` 2281-2298** — `oracleid = tar.memo` if set. Position: card position - forward×3.2 + 0.025 up. `player = steam_id`, `name` = first name line, `mode=""`, `full=""`.
- **`ReImport(tar, ply, alt)` 2301-2332** — Locked → broadcast "SPAM-CLICK" to the player and return. Empty name → error broadcast and return. Importer found → set `full="Reimporting Card"`, `importer.call('Importer', req)`, lock, 0.5 s Timer to unlock. Else two broadcasts. W: global `amuzetCardImporter`.
- **`EmblemsAndTokens` 2339-2371** — Same, with `mode="Token"` and `full="Importing Tokens & Emblems"`. W: global `importerRequestTable`.
- **`ParseCardData(object, enc)` 2378-2620**
  - Reads `tyrantUnified`. If nil → `AutoActivate` and return.
  - Only if `hasParsed == false`: sets it true first, then runs the body in `pcall` (2393). **Parse errors are swallowed and the card is never re-parsed** unless something resets `hasParsed`, as Morphin' Time does (359).
  - Name: strip BBCode `[..]` and a `\nNCMC` line.
  - State-based DFC (`getStates() ~= nil`): `doubleFaceStates=true`. Builds both faces' "name\ndescription" text, ensures each ends in `b]`, and sets `activeFace` from `states[1].id`.
  - Else description with blank lines collapsed. Then drop italic flavour lines.
  - **Abort** if any `[xxxxxx` color code or `]www` sequence remains (2427).
  - DFC detection: `//` = `oldImport`; `]\n` or states = general. Inserts line breaks before `[b` stat blocks (2434-2448). Real minus "−" → "-".
  - Split into lines. DFC: per face, line 1 = name, line 2 = type, a line starting `[` = stats (advances the face), others = text. Single face: name and type from the name field; a line containing `[` = stats.
  - Abort if there is no name or type.
  - Per face: "laneswalker" → `isPlaneswalker`; loyalty from `b](\d+)[` into `namedCounters`. Each text line with `\w:\s` becomes an ability (`abilityDelta` = number or "X"); every text line increments `pwCount`. Two-slot fix-ups (2521-2533). Otherwise base P/T from `([%d%*xX]+)/` (strings).
  - "battle" with a defense value → `isBattle`, `namedCounters`.
  - +1/+1: front face creature whose text says "+1/+1 counter(s) on it/<first name word>" → `displayPlusOne` (the `break` exits only the inner loop).
  - DFC type order: split (both faces instant or sorcery), flip ("lip it"/"lip <name>"), adventure, werecard (daybound/nightbound), modal (no "ransform"/"onvert"), battle, weredrazi, discovery (back is a land), ascendant (creature → PW), default. W: global vars `frontFaceSplitCheck`, `backFaceSplitCheck`, `adventureCheck`, `flipCardCheck`.
  - `displayDFC = autoActivateDFC` unless none/flip/split/adventure; false if both faces have the same name.
  - Finally: `displayPowTou = autoActivatePowTou and creature`; `hasNonLoyaltyCounter`; `displayPlaneswalkerAbilities = pwCount > 0`; `displayCounters = PW or battle or (autoActivateCounter and hasNonLoyaltyCounter)`. Write back.
- **`string.splitUsingFind(text, separator)` 2622-2636** — Adds to the global `string` table. The separator is a pattern.
- **`HasKeywordOrNamedCounter(nameLine, description)` 2638-2665** — True for Cumulative upkeep, Suspend, Vanishing, Fading or "after III". Or for "put/with <a> <b> counter(s) on <x>" that targets "it" or the card's first name word and names charge, storage, quest, spore, depletion, ki or verse. W: global var `namedCounters` (a list; it shadows nothing in the data).
- **`onObjectDropped(playerColor, object)` 2668-2671** — Returns if `autoActivateModule == false` or this player's steam_id is set to false. Else `TryTimedEncoding(object)`. **Only player drops auto-encode;** engine-spawned cards do not.
- **`onObjectSpawn(obj)` 2673-2683** — Card: `CheckRevertInvertedFaces`, then `CheckGetSetCardTable` (W: global `cardTable`). Deck: `CheckGetSetContainerTable` (W: global `containerTable`).
- **`TryTimedEncoding(object)` 2685-2706** — Card only. `noencode == true` → return. No Encoder → return. Encode if not encoded. Property not registered → return. If the property is off: enable, `InitializeCardData`, rebuild. If it is already on, nothing happens.
- **`AutoActivate(dataTable)` 2708-2730**
  - Returns if there is no Encoder or the property is unregistered.
  - `APIobjectExists(...) ~= nil` is always true, because the result is a bool.
  - Returns data if `data.hasStats` exists; that field is never set anywhere.
  - Property off → enable, `ParseCardData`, rebuild, return data (pre-parse). Otherwise returns nil.
- **`InitializeCardData` 2732-2735** — `ParseCardData` then `TryAssignOwnership`.
- **`TryAssignOwnership(object, enc)` 2737-2753** — Owner = the card table's `ownerColor`, or `deckPlayerPairs[containerID]`. If found: owner = controller = that color. `displayOwnership = autoActivateOwnership`. Write back.
- **`InitializeDeckTables()` 2758-2764** — `deckCandidateTracker[color] = {}` for each `Color.list`.
- **`onObjectLeaveContainer` 2766-2770** — Card only. Container table → merge into the card table (`cardBack`, `containerID`, `ownerColor`).
- **`onObjectEnterContainer` 2772-2787** — Returns if the container already has a table or the object has none. Only Card or "Container" tags. Saves the object's table and copies it onto the container 1 s later (Timer `<guid>setDataTimer`). W: global vars `sourceTable`, `dataTable`.
- **`ResetDeckTable(dataTable)` 2789-2791** — `object.setTable("tyrantUnified", sourceTable)`.
- **`CheckGetSetContainerTable(container)` 2793-2802** — If missing: `{cardBack="", frontFace=customObject.front or "", backFace="", containerID=guid, ownerColor=""}` and `setTable`. W: global `containerData`.
- **`CheckGetSetCardTable(card, containerTable)` 2804-2821** — If missing: build it from the custom object `front`/`back`. If a container table is given: copy `cardBack`, `containerID`, `ownerColor`. Always `setTable`. W: global `cardData`.
- **`CheckRevertInvertedFaces(card)` 2823-2831** — Face URL has "/back/" and back URL has "/front/" → `InvertCardFaces`.
- **`InvertCardFaces(card)` 2833-2843** — Swap the URLs, `setCustomObject`, `reload()`. The reload produces a new object. W: globals `cardData`, `initialFrontFace`, `initialBackFace`.
- **`onObjectEnterScriptingZone(zone, object)` 2845-2885** — Card only. Gets Encoder zones with `APIlistZones` (or `getTable("Zones")` if that API is missing). If the zone is a registered (hand) zone and the card has a `containerID`: increments `deckCandidateTracker[color][deck].count`. At exactly 7, if the deck still exists, `AddPlayerDeck`. The Encoder's zones are hand zones. In current TTS this deprecated event fires for scripting zones only, so this deck-ownership guess probably never fires. Untested here.
- **`AddPlayerDeck(playerColor, containerGUID)` 2887-2899** — If the deck was paired before, resets that color's count. Pairs it, then writes `ownerColor` into the deck's table. W: global `containerObject`, `containerTable`.
- **`DoNothing()` 2901** — empty.

**With the rules engine:** DRIVE the display through the notes' recipe: `TryTimedEncoding`, then get, write `hasParsed=true`, base P/T, deltas = 0, `plusOneCounters`, `namedCounters`, display flags, colors, `activeFace`; then set and rebuild. Gate every `Receive*Click`, the gem and ownership handlers, `ReceiveChangeActiveFace`, `MakeExactCopy`, `ReImport` and `EmblemsAndTokens`. Reroute the PW slot buttons to "activate loyalty N". Keep the `ToggleDisplay*` handlers. Spawn cards face-correct to avoid `CheckRevertInvertedFaces` reloads. Disable the `force …` chat commands.

---
## πKeywords

- **Object:** "πKeywords", GUID **ae12d3**, `PiecePack_Arms`, loose.
- **Encoder:** propID `πKeywords` (8). `activateFunc='toggleKeywordsMenu'`, `visible_in_hand=1`, tags `basic,counter`.
- **Values:** `activeIcons` (`'nil'`, `{}`): ordered list of active keyword keys. `iconMenuOn` (boolean). `iconLayout` (string, `'art'` or `'above'`). Plus one value per entry of `KeywordList` (11-107):
  - numbers (default 0): `mtg_stuncounter`, `mtg_deathtouchcounter`, `mtg_defendercounter`, `mtg_doublestrikecounter`, `mtg_firststrikecounter`, `mtg_flyingcounter`, `mtg_hastecounter`, `mtg_hexproofcounter`, `mtg_indestructiblecounter`, `mtg_lifelinkcounter`, `mtg_menacecounter`, `mtg_reachcounter`, `mtg_suspendcounter`, `mtg_tramplecounter`, `mtg_vigilancecounter`;
  - booleans (default false): `mtg_exert`, `mtg_frozen`, `mtg_monstrous`, `mtg_renowned`.
  - Each entry has `name`, `des` (tooltip), `iconN` (unused), `val`, `url` (decal image on steamusercontent), `def`.
- **Overview:** shows keyword icons as decals on the card art (or above the card), with click-to-change counts. A side menu lists every keyword. Global's Untap reads `mtg_stuncounter`, `mtg_frozen` and `mtg_exert` (Global 659-679).
- **Script globals:** `enc`, `updateDecals` (one flag shared by all cards), `iconMenuOn`, `iconLayout`, `activeIcons`, and many leaked layout variables.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 109 | Makes itself interactable, adds the register button, waits for the Encoder. | TTS load | Button on ae12d3 |
| `registerModule(obj,ply)` | 119 | Registers 22 values, one click function per keyword, and the property. | register button (112), `Wait.condition` (116), Encoder `onLoad`/`onObjectDropped` | Encoder registries; `_G['toggleStatus'..key]` |
| `toggleKeywordsMenu(obj,ply)` | 158 | Turns the module on (opens the menu) or off (clears all keywords and decals). | πMenu button for the property | Encoder data; decals removed |
| `checkConflictingMenus(obj)` | 184 | Closes Morphin' Time's sub-menu on the same card. | `toggleKeywordsMenu`, `toggleIconMenu` | Morphin' data |
| `toggleIconMenu(obj,ply)` | 197 | Opens or closes the keyword side menu. | ">>>"/"<<<" buttons (462, 467, 475) | Data; rebuild |
| `toggleStatus(obj,ply,alt,key)` | 210 | Left adds 1 / sets true; right subtracts 1 / sets false. | `toggleStatus<key>` buttons (415, 421, 505-528) | Data; icon list; decal flag; rebuild |
| `rmFromTable(oldList,key)` | 264 | Returns a copy of a list without `key`. | 227, 250, 316 | none |
| `toggleLayout(obj,ply)` | 274 | Switches icon layout between `art` and `above`. | "layout:" button (480) | Data; decal flag; rebuild |
| `resetDecals(obj)` | 287 | Removes every keyword decal from the object, keeping other decals. | 167, 341, 551 | `setDecals` |
| `isKeyword(str)` | 301 | Tells whether a decal name is a keyword display name. | `resetDecals` | none |
| `updateActiveIcons(data,obj)` | 311 | Drops keys whose value is 0/false from `activeIcons`. | `createButtons` | Data; may set the decal flag |
| `createButtons(t)` | 329 | Draws icon decals and count buttons, and the menu. | Encoder rebuild; `onObjectSpawn` | Decals and buttons on the card |
| `null()` | 541 | Empty callback. | label buttons | — |
| `onObjectSpawn(obj)` | 544 | Redraws keyword buttons on a spawned card that has the property; strips keyword decals from other spawned objects. | TTS event | Buttons or decals |

**Event handlers:** `onload`, `onObjectSpawn`. **Chat:** none. **Context items:** none.

**Buttons:** register button on ae12d3. Per card: per active keyword, five buttons (name shadow, name, count shadow, count outline, clickable count). Menu toggle ">>>"/"<<<" at top right `(0.875*flip, 0.28*flip, -1.485)`. When open: a "layout:" button, two headers, and one button per keyword (numbers in column x=1.7, booleans at x=2.9, rows z=-1.6+n*0.2).

**Remote code:** none. Decal images load from Steam CDN URLs (15-105).

### Details

- **`onload()` 109-117** — `self.interactable=true` (110), so Global's later non-interactable list does not include ae12d3. Creates the register button. `Wait.condition(registerModule, Encoder ~= nil)`.
- **`registerModule(obj,ply)` 119-156** — W: global `enc`, `value`, `values`, `properties`. If an Encoder exists: register `activeIcons`, `iconMenuOn`, `iconLayout`; then each keyword with `validType = v.val`. Defines `_G['toggleStatus'..k]` as a closure calling `toggleStatus(obj,ply,alt,k)` (138). Builds the values list and registers the property. No Encoder → does nothing. The click functions exist only after this runs; before that, keyword buttons on loaded cards error when clicked.
- **`toggleKeywordsMenu(obj,ply)` 158-182** — `APItoggleProperty`.
  - Now enabled: global `iconMenuOn = true`; write it; close Morphin's menu.
  - Now disabled: `resetDecals`; set every number to 0 and every bool to false; `iconMenuOn=false`; write back. `activeIcons` is not cleared here; the next `createButtons` prunes it.
  - Always rebuild.
- **`checkConflictingMenus(obj)` 184-195** — `APIobjGetPropData{propID="MorphinTime"}`. This errors if Morphin' Time is not registered (Encoder 1238). If `subMenuOpen` is true, set it false and write back. W: global `keywordsData` (holds Morphin's data despite the name).
- **`toggleIconMenu(obj,ply)` 197-208** — Uses the global `enc` without re-reading it. Flip `iconMenuOn`; if now on, close Morphin's menu; write; rebuild.
- **`toggleStatus(obj,ply,alt,key)` 210-262**
  - Boolean: left and not already true → true, append to `activeIcons`, `updateDecals=true`. Right and not already false → false, remove the icon, `updateDecals=true`.
  - `'color'` branch (233-238): unused (no color keywords).
  - Number: left → if it was 0, append icon and set the flag; then +1. Right → if it was 1, remove icon and set the flag; then -1, clamped to 0.
  - Writes `activeIcons` and the data, then rebuilds. No upper bound.
- **`rmFromTable(oldList,key)` 264-272** — New list without `key`.
- **`toggleLayout(obj,ply)` 274-285** — Global `enc`. `above` → `art`, anything else → `above`. Sets the flag, writes, rebuilds. W: global `iconLayout`.
- **`resetDecals(obj)` 287-299** — If `getDecals()` is non-nil: keep only decals whose `name` is not a keyword display name; `setDecals`. A decal is matched by display name (e.g. "Flying"), so a user decal with the same name is also removed.
- **`isKeyword(str)` 301-309** — Linear scan of `KeywordList[*].name`.
- **`updateActiveIcons(data,obj)` 311-327** — Removes keys whose value is 0 or false, writes `activeIcons` with `APIobjSetValueData`, and sets `updateDecals=true` if the list changed (compared with `table.concat`). Returns the list.
- **`createButtons(t)` 329-539**
  - Global `enc`. Reads data and flip; `activeIcons = updateActiveIcons(...)`.
  - If `updateDecals`: `resetDecals` first.
  - For each active icon with a non-zero/true value: positions depend on layout. `above`: a 5-wide grid above the card (z from -1.55). `art`: 1, 2, 3, 4 or 5+ icons in fixed patterns over the art.
  - Adds the decal only if `updateDecals` (445-447). Adds five buttons; the count label shows only when a number is above 1.
  - After the loop `updateDecals=false` (456). Because the flag is one script global, **decals are redrawn only on the first rebuild after a change**. An engine write must set `updateDecals=true` on ae12d3 before the rebuild (review notes, step 4).
  - Menu closed: two ">>>" buttons (shadow and clickable). Open: "<<<", "layout:\n<layout>" (`toggleLayout`), the "Counters" and "Status Effects" headers, then one button per keyword in `pairs` order (unordered). Lit yellow when active; tooltips describe the clicks.
  - W: global vars `activeIcons`, `nIcons`, `iconN`, `val`, `nPerRow`, `gridX`, `gridY`, `posD`, `posB`, `sm`, `rotD`, `rotB`, `dpars`, `ttip`, `lab`, `bpars`, `bparsO`, `bparsS`, `bparsNs`, `bparsN`.
- **`null()` 541** — empty.
- **`onObjectSpawn(obj)` 544-554** — Runs for every spawned object, including cards leaving decks. If the property is enabled → `createButtons{obj}` directly, without the Encoder's clear first, so buttons can duplicate until the next rebuild. Else `resetDecals(obj)`: copies and clones lose keyword decals ("prevent copy pasting", 543).

**With the rules engine:** DRIVE-FROM-ENGINE: `APIobjEnableProp`, get, set values and `activeIcons`, set, `setVar('updateDecals', true)` on ae12d3, rebuild. Gate `toggleStatus*` (210) and `toggleIconMenu` (197). Disable Global's Untap use of stun, frozen and exert.

---

## Morphin' Time

- **Object:** "Morphin' Time", GUID **ad044a**, `PiecePack_Moons`, loose. Sets Global var `MorphinTime` to itself (6).
- **Encoder:** propID `MorphinTime` (1). `activateFunc='toggleFaceDown'`, `visible_in_hand=1`, tags `basic,counter`. Values `subMenuOpen` (boolean), `cardName` (string), `cardDesc` (string), `activeMode` (string, a `faceDownTypes` key).
- **Modes (`faceDownTypes` 34-86):** `mtg_faceDownCreature`, `mtg_faceDownForest`, `mtg_faceDownCyberman`, `mtg_faceDownCloak`, `mtg_faceDownDisguise`, `mtg_faceDownManifest`, `mtg_faceDownMorph`. Each has `name`, `cardName`, `cardDesc` and a decal `url`. Cyberman's URL is on img.klrmngr.com; the rest are Steam CDN. `contextMenuName` (40, 83) is unused.
- **Overview:** turns a real card face down as a morph/manifest/disguise/cloak/etc. It renames the card to the face-down text, adds a face-down decal on the back, and shows a "< Mode >" button on the back that turns it face up again. It adds Morph/Disguise/Flip Over context items to cards.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 5 | Sets Global `MorphinTime`, adds the register button, waits for the Encoder, adds context items to every object. | TTS load | Global var; context items |
| `onObjectEnterZone(zone,obj)` | 24 | Re-adds context items. | TTS event (any zone) | Context items |
| `onObjectLeaveZone(zone,obj)` | 28 | Re-adds context items. | TTS event | Context items |
| `registerModule(obj,ply)` | 90 | Registers 4 values, the property, and one `changeMode<key>` function per mode. | "+" button (9), `Wait.condition` (14), Encoder | Encoder registries; `_G` |
| `toggleFaceDown(obj)` | 148 | Turns the module on (flip face down, rename, decal) or off (flip face up, restore). | πMenu property button; "< Mode >" button (284, 291); `genericFlip`; `genericFlipUp` | **Flips the card, renames it**, decals, overlay side |
| `openSubMenu(obj,ply)` | 201 | Opens the mode list. | ">>>" buttons (228, 233) | Data; rebuild |
| `closeSubMenu(obj)` | 208 | Closes the mode list. | "<<<" (242); `changeMode`; `genericFlip` | Data; rebuild |
| `createButtons(t)` | 214 | Draws the menu toggle, the mode list, and the turn-face-up button on the back. | Encoder rebuild | Buttons |
| `changeMode(obj,_ply,_alt,key)` | 301 | Sets the face-down mode and rewrites the card text. | `changeMode<key>` buttons (255, 261); `genericChangeMode` | Data; rename; decal |
| `setCardDetails(obj, data, isFlipped)` | 322 | Applies (face-down text and decal) or removes (original text) the disguise; asks Easy Modules to re-parse. | `toggleFaceDown`, `changeMode` | `setName`, `setDescription`, decals, `tyrantUnified.hasParsed=false` |
| `addContextOptions(obj)` | 367 | After 1 frame, adds "Flip Over" (if active) or "Morph"/"Disguise" (by text). | `onload`, zone events | Context items on cards |
| `contextMorph(ply, objPos, obj)` | 404 | Face-down as Morph. | "Morph" context item | via `genericFlip` |
| `contextDisguise(ply, objPos, obj)` | 408 | Face-down as Disguise. | "Disguise" context item | via `genericFlip` |
| `genericFlip(params)` | 412 | `{obj, mode}`: encode, set the mode, turn face down, close the menu. | context items; Mass Face Down (102); Manifest/Cloak Enabler (117) via `.call` | as `toggleFaceDown` |
| `contextGenericFlipUp(ply, objPos, obj)` | 425 | Turns face up. | "Flip Over" context item | via `toggleFaceDown` |
| `genericFlipUp(obj)` | 429 | Toggles face-down state (turns face up when on). | `contextGenericFlipUp`; Mass Face Down (126) via `.call` | as `toggleFaceDown` |
| `genericChangeMode(params)` | 433 | `{obj, mode}` → `changeMode`. | Mass Face Down (105) via `.call` | as `changeMode` |
| `checkConflictingMenus(obj)` | 439 | Closes πKeywords' menu on the same card. | `toggleFaceDown`, `openSubMenu` | πKeywords data |

**Event handlers:** `onload`, `onObjectEnterZone`, `onObjectLeaveZone`. **Chat:** none.

**Context items on cards:** "Flip Over" (380), "Morph" (386), "Disguise" (390). **Buttons:** "+" register on ad044a; per card ">>>"/"<<<", one button per mode, and the "< Mode >" face-up button.

**Remote code:** none (decal image URLs only).

### Details

- **`onload()` 5-22** — `Global.setVar('MorphinTime', self)`; "+" button; `Wait.condition(registerModule, Encoder ~= nil)`; `addContextOptions` for every object in `getObjects()`.
- **`onObjectEnterZone` / `onObjectLeaveZone` 24-30** — `addContextOptions(obj)` for any zone and any object.
- **`registerModule(obj,ply)` 90-144** — W: global `enc`, `value`, `values`, `properties`. Registers the 4 values and the property. Defines `_G['changeMode'..k]` closures (141).
- **`toggleFaceDown(obj)` 148-198**
  - W: global `enc`, `data`, `flip`, `encoderFlip`. Reads the data first, `flip = obj.is_face_down`, `encoderFlip = APIgetFlip`. Then `APItoggleProperty`.
  - Now enabled: `subMenuOpen=true`; `checkConflictingMenus`; if face up → `obj.flip()`; if the overlay is on the front (`>0`) → `APIFlip`; store the current name/description in `cardName`/`cardDesc`; `setCardDetails(true)`.
  - Now disabled: if face down → `obj.flip()`; if the overlay is on the back → `APIFlip`; `activeMode` back to Creature; `setCardDetails(false)` restores the text.
  - Write data; rebuild.
  - **Oddities:** the "store original name" step runs every time the module is turned on, so turning it on for a card that is already renamed saves the disguised name. `genericFlipUp` toggles: on a card where the module is off, it turns it **on** (face down).
- **`openSubMenu(obj,ply)` / `closeSubMenu(obj)` 201-211** — Use the global `enc`. Write `subMenuOpen` true/false and rebuild. `openSubMenu` also closes πKeywords' menu.
- **`createButtons(t)` 214-298**
  - Global `enc`; reads data and flip. W: global `activeMode`, `buttonLabel`, `buttonColor`.
  - Closed: ">>>" shadow and button at `(0.875*flip, 0.28*flip, 1.485)` (bottom right).
  - Open: "<<<", then one button per mode at `x=1.7*flip`, `z=1.6-j*0.2` (`pairs` order), yellow for the active mode.
  - Always: two buttons at `(0,-0.28,-1.29)` rotated 180°, so they sit on the card's back face. Grey, or green for Forest. Label `"< <name> >"`, click `toggleFaceDown`.
  - Errors at 271 if `activeMode` is not a known key.
- **`changeMode(obj,_ply,_alt,key)` 301-320** — If the mode differs: write and rebuild. Always `setCardDetails(obj, data, true)` and `closeSubMenu`. Note that `setCardDetails` does not flip the card; it only rewrites the text, so this is only meaningful while face down.
- **`setCardDetails(obj, data, isFlipped)` 322-365**
  - Removes decals named after any mode key with `table.remove` inside `pairs` (330-336). Removing during iteration can skip the next decal.
  - `isFlipped`: `setName`/`setDescription` to the mode's text; `addDecal{name=activeMode, url, position={0,-0.28,0}, rotation={-90,0,0}, scale={2.15,3.05,1}}` on the back. Else restore `data.cardName`/`data.cardDesc`.
  - Then, if the card has a `tyrantUnified` value, set `hasParsed=false` (357-361) so Easy Modules re-parses (face-down cards then show 2/2). W: global `activeMode`, `modeData`.
- **`addContextOptions(obj)` 367-402** — Cards only. After 1 frame (so Global's context-menu reset runs first, comment 371). Global `enc` re-read.
  - Module active on the card → add "Flip Over" and return.
  - Else lower-cased description: `find('morph') and find('morph {') or find('morph—')` → "Morph". Same pattern for "Disguise".
  - No duplicate check; relies on Global clearing menus on zone entry.
- **`contextMorph` / `contextDisguise` 404-410** — `genericFlip({obj, mode})`.
- **`genericFlip(params)` 412-423** — W: global `obj`, `mode`. Uses the global `enc` (set by `registerModule`); does nothing if nil. Encode, write `activeMode`, `toggleFaceDown(obj)`, `closeSubMenu(obj)`. If the module was already on, `toggleFaceDown` turns it **off** (face up); Mass Face Down checks this first.
- **`contextGenericFlipUp` 425-427**, **`genericFlipUp(obj)` 429-431** — `toggleFaceDown(obj)`.
- **`genericChangeMode(params)` 433-435** — `changeMode(params[1], nil, nil, params[2])`.
- **`checkConflictingMenus(obj)` 439-450** — Reads πKeywords data (errors if πKeywords is not registered). If `iconMenuOn`, set it false and write. W: global `keywordsData`.

**With the rules engine:** DRIVE the visuals with `genericFlip{card, mode}`, `genericChangeMode`, `genericFlipUp`. They toggle, so check `APIobjIsPropEnabled` first. Disable the "Morph"/"Disguise"/"Flip Over" context items. It renames cards, so match by GUID. Hidden-info leak: this flips the real card, so spawn generic face-down proxies for opponents instead.

---

## Mass Face Down Tool

- **Object:** "Mass Face Down Tool", GUID **ca0e60**, `Custom_Token`, in bag **4f3387**.
- **Encoder:** no property of its own; drives `MorphinTime`.
- **Overview:** eight buttons that turn every selected card face down in a given mode (through Morphin' Time), or face up.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 3 | Draws 8 buttons; caches the Encoder. | TTS load (when taken out of the bag) | Buttons; global `Encoder` |
| `massFaceDown(color, faceDownTechnicalName)` | 89 | For each selected card: encode, then `genericFlip` (if off) or `genericChangeMode` (if on). | the six `mass*` mode handlers | Cards flipped and renamed via Morphin' |
| `massFaceUp(_obj, color, _alt_click)` | 113 | For each selected card with the module on: `genericFlipUp`. | "Face Up" button (76) | Cards flipped up |
| `massMorph` / `massManifest` / `massDisguise` / `massCloak` / `massCyberman` / `massCreature` / `massForest` `(_obj, color, _alt_click)` | 134 / 138 / 142 / 146 / 150 / 154 / 158 | Call `massFaceDown` with the matching mode key. | buttons at 11, 20, 29, 38, 47, 56, 66 | as above |

**Event handlers:** `onload`. **Chat / context items / remote code:** none.

### Details

- **`onload(saved_data)` 3-87** — Decodes `saved_data` into a local and ignores it (5-7). Eight buttons in a 2×4 grid. `Encoder = Global.getVar('Encoder')` (85), cached once; a reloaded Encoder makes it stale.
- **`massFaceDown(color, name)` 89-111** — W: global `MorphinTime`, `selectedObjects`. Requires `Encoder`, Global `MorphinTime` and a selection. For each `Card`: `APIencodeObject`. If `MorphinTime` is off → `MorphinTime.call("genericFlip", {card, name})`. Else `genericChangeMode`. Reference call pattern at 98-105.
- **`massFaceUp` 113-132** — Same guards; only cards with `MorphinTime` on → `MorphinTime.call("genericFlipUp", card)`.
- **Mode wrappers 134-160** — one line each.

**With the rules engine:** DISABLE (bagged). Its call pattern (98-105) is the reference for driving Morphin' Time.

---

## Phasing

- **Object:** "Phasing", GUID **c2df33**, `PiecePack_Arms`, loose. Tipsy Hobbit module v1.12 (5).
- **Encoder:** propID `MTG_Phase` (3), name "Phase Out", `activateFunc='phaseOut'`, tags `tool,face_prop`. Value `mtg_phased` (boolean).
- **Overview:** puts a large "PHASED OUT" panel over a card. Clicking the panel phases it back in (also for the player's selection).

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 7 | Draws the "+" register button; waits for the Encoder. | TTS load | Button |
| `registerModule()` | 15 | Registers the property and `mtg_phased`. | "+" button, `Wait.condition`, Encoder | Encoder registries |
| `createButtons(t)` | 36 | Draws the "PHASED OUT" panel. | Encoder rebuild | Button covering the card |
| `phaseOut(obj,ply)` | 50 | Toggles the property and flips `mtg_phased`. | πMenu "Phase Out" button | Data; rebuild |
| `unPhased(obj,ply)` | 64 | Clears `mtg_phased` and turns the property off, for the card and the player's selection. | the panel (44) | Data; rebuild |
| `updateModule(wr)` | 88 | Replaces its own script with the GitHub version if newer; self-destructs if marked "DEPRECIATED". | Encoder `callVersionCheck` WebRequest callback | **Remote code**; may destroy itself |

**Event handlers:** `onload`. **Chat / context items:** none.

**Remote code:** `UPDATE_URL` (4) on Jophire's GitHub; fetched only through the Encoder's admin "Update" item.

### Details

- **`onload()` 7-14** — "+" button with a version tooltip; `Wait.condition(registerModule, …)`.
- **`registerModule()` 15-35** — W: global `enc`, `properties`, `value`. The property is registered **before** its value, so on a first-ever registration `toggleProperty` would not seed `mtg_phased`. Re-registrations are fine.
- **`createButtons(t)` 36-49** — W: global `enc`, `flip`, `scaler`, `temp`, `barSize`, `fsize`, `offset_x`, `offset_y`. Calls `APIformatButton`. One 1500×1000 dark button, label " PHASED OUT ", at y=0.63. **Bug:** `tooltip` is inside the `rotation` table (46), so there is no tooltip, and the rotation is `{0,90,90-90*flip}`.
- **`phaseOut(obj,ply)` 50-63** — W: global `enc`, `data`. `APItoggleProperty`, then flip `mtg_phased`, write, rebuild. The property state and the value are toggled separately and could drift.
- **`unPhased(obj,ply)` 64-87**
  - Requires the card to be encoded. W: global `flip` (unused), `data`.
  - If `mtg_phased` is true: set false, write, `APIobjDisableProp`.
  - If `ply` is a string: recurse on each selected encoded object with `ply=0`. The "skip self" test uses an undefined `tar` (79), so the clicked card is processed twice; harmless.
  - Rebuild.
- **`updateModule(wr)` 88-105** — W: global `enc`, `wrv`. Parse `version = '…'`. If `DEPRECIATED`: `APIremoveProperty` and `self.destruct()`, then keeps executing on the destroyed object. If `APIversionComp` says the remote is newer: broadcast, set `script_code`, `reload()`. Else broadcast "No update found".

**With the rules engine:** DRIVE (`mtg_phased` plus enabling the property). Gate `unPhased` (64). It self-updates from GitHub through the Encoder's "Update" (88-105).

---

## Is it a token?

- **Object:** "Is it a token?", GUID **716ee6**, `PiecePack_Arms`, loose. Tipsy Hobbit "Token Designator" v1.7.1.
- **Encoder:** propID `MTG_Token` (3), name "Is Token", `activateFunc='tToken'`, tag `tool`. Value `mtg_token` (boolean). Global enables `MTG_Token` on its "Make Token Copy" clones (Global 1293).
- **Overview:** shows a "Token" badge above the card. Clicking the badge removes it (for the selection too).

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 7 | Adds a "Register Module" context item; waits for the Encoder. | TTS load | Context item on 716ee6 |
| `registerModule()` | 13 | Registers the property and `mtg_token`. | context item, `Wait.condition`, Encoder | Encoder registries |
| `createButtons(t)` | 35 | Draws the "Token" badge. | Encoder rebuild | Button |
| `tToken(obj,ply)` | 48 | Toggles the property. | πMenu "Is Token" button | Encoder state; rebuild |
| `toggleToken(obj,ply)` | 62 | Sets `mtg_token=false` and turns the property off (card and selection). | "Token" badge (41) | Data; rebuild |

**Event handlers:** `onload`. **Chat / remote code:** none. **Context items:** "Register Module" on itself.

### Details

- **`registerModule()` 13-33** — W: global `enc`, `properties`, `value`. Property registered before its value (as in Phasing).
- **`createButtons(t)` 35-46** — W: global `Style.proto` (unused), `flip`. Button "Token" at `(0, 0.28*flip, -1.7)` (just above the top edge), scale 0.5.
- **`tToken(obj,ply)` 48-60** — `APItoggleProperty`. Then it flips `data.mtg_token` locally but **never writes it back** (no `APIobjSetPropData`), so `mtg_token` stays false through this path. Only the property flag tracks token status. Rebuild.
- **`toggleToken(obj,ply)` 62-83**
  - `data.mtg_token=false`; `APIobjDisableProp`; write.
  - If `ply` is a string: for each selected object, `enc.call("APIobjExists", …)`. **That API does not exist** (it is `APIobjectExists`), so the call returns nil, the test fails, and the selection is never processed. `tar` is undefined (74).
  - Rebuild.

**With the rules engine:** DRIVE (`MTG_Token` on/off; write `mtg_token` yourself). Gate `toggleToken` (62).

---

## Sticker Encoder

- **Object:** "Sticker Encoder", GUID **c5ea55**, `PiecePack_Arms`, loose. By ZachStover, v`0.1pi`.
- **Encoder:** propID `Stickers` (7), name "Sticker Menu", no values, `visible=false`, `activateFunc='toggleProp'`, tag `basic`. `UPDATE_URL=''` (9).
- **Overview:** for cards whose name contains "Stickers", it draws one small button per description line of the form `… — <text>`. The button shows the number of `{TK}` symbols on that line. Clicking spawns a "Sticker" chip carrying that text. When the chip touches a card, it either sets that card's P/T (if the text is like `3/3`) or appends the text to the card's πNotepad note.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 11 | Adds "Register Module"; waits for the Encoder. | TTS load | Context item |
| `registerModule()` | 16 | Registers the `Stickers` property. | context item, `Wait.condition`, Encoder | Encoder registry |
| `toggleProp(obj, ply)` | 32 | Prints "Stickers!". | nothing in scope (hidden from πMenu) | Chat print |
| `createButtons(t)` | 36 | Draws the sticker buttons. | Encoder rebuild | Buttons |
| `getStickers(obj)` | 46 | Parses `— text` lines and creates two buttons per line. | `createButtons` | Buttons; `_G[i.."func"]`; script vars `copyText<i>` |
| `onObjectDropped(playerColor, obj)` | 102 | Enables `Stickers` on any dropped card whose name contains "Stickers". | TTS event | Encoder state; rebuild |
| `copyToClipboard(obj, index)` | 113 | Spawns a "Sticker" chip with line `index`'s text as its description. | `_G[i.."func"]` buttons | Spawns an object |
| `NotepadDropper()` | 136 | Returns the JSON for the "Sticker" chip, including its script. | `copyToClipboard` | none |

**Embedded script of the spawned "Sticker" chip (inside `NotepadDropper`, line 180):**
- `onload` draws its name.
- `onCollisionEnter(c)`: for a Card, if the Encoder exists and the chip is not held:
  - Encode the card and enable `_MTG_Simplified_UNIFIED` if it was not encoded.
  - If the description matches `(%d+)/(%d+)` and is under 6 characters: set `displayPowTou=true` and `power = new - basePower`, `toughness = new - baseToughness` (or the raw values if the base is not numeric). This is the P/T formula the notes cite.
  - Else, if the `note` value exists: append the text and a newline to `note.text`, set `editON=false`, enable `πotepad`.
  - `APIobjSetAllData`, rebuild, `self.destruct()`.

**Event handlers:** `onload`, `onObjectDropped`. **Chat:** none. **Context items:** "Register Module" on itself.

**Remote code:** none of its own. Its empty `UPDATE_URL` is still fetched by the Encoder's "Update" (see Encoder).

### Details

- **`createButtons(t)` 36-43** — Global `enc`; `getStickers(t.obj)`; then reads prop data and flip into globals `data` and `flip`, which are never used.
- **`getStickers(obj)` 46-99**
  - For each non-empty description line with `— ` (em dash): `count` = number of `{TK}`.
  - Defines an unused local `buttonFunction` that calls the non-existent `self.UI.setClipboard`. Sets the script var `copyText<i>` to a closure calling `copyToClipboard(text)` (wrong arguments; unused). Defines `_G[i.."func"] = function(obj) copyToClipboard(obj, num) end`.
  - Two buttons at fixed slots (`positions`, 4 entries): a grey square and a white label showing `count`, tooltip = text. A 5th line indexes `positions[5]` = nil.
  - Computes an unused `position` (97-98). The global functions are named `1func`, `2func`, …, shared by all cards.
- **`onObjectDropped(playerColor, obj)` 102-111** — Card only, name matches "Stickers" → `APIobjEnableProp` + rebuild. It does not encode first, so it does nothing for cards that are not encoded (Easy Modules usually encodes them in the same drop).
- **`copyToClipboard(obj, index)` 113-134** — Finds the `index`-th line and takes its text after "— " (nil if that line has none). `spawnObjectJSON` 2.2 units in front of the card (local (0,1,-2.2)), scale 0.5. `setDescription(text)` on the spawned object. W: global `object`.
- **`NotepadDropper()` 136-186** — Returns a `PiecePack_Suns` "Sticker" JSON with the embedded script described above.

**With the rules engine:** KEEP. It is the reference for the P/T formula (180). Note that its chip writes `tyrantUnified` directly, so it would bypass the engine if left active on engine cards.

---
## Card Stamp Tool

- **Object:** "[i]Card Stamp Tool[/i]", GUID **9c48a1**, `PiecePack_Suns`, in bag **4f3387**.
- **Encoder:** none.
- **Overview:** the tool shows the image whose URL is in its description. Touching a card with it adds that image as a decal where they touched. While a player holds the tool, cards they hover are briefly locked so they can right-click without picking them up.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Shows the stamp image; resets the rate limiter. | TTS load | Decal on itself |
| `onHover(ply)` | 8 | Records the player and refreshes the image. | TTS object event | Decal |
| `onDrop(ply)` | 12 | Same. | TTS object event | Decal |
| `onPickUp(ply)` | 16 | Same. | TTS object event | Decal |
| `updateSelf()` | 22 | Sets its own decal from its description (or a default image that flashes red). | the four above | `setDecals` on itself; highlight |
| `onObjectHover(ply, obj)` | 47 | Locks a hovered unlocked card while the holder hovers it. | TTS global event | `setLock(true/false)` on cards |
| `onCollisionEnter(co)` | 61 | Adds a decal to the card it touches. | TTS object event | Card decal; broadcast |

**Event handlers:** all of the above. **Chat / buttons / context items:** none.

**Remote code:** none; it loads whatever image URL is in its description (default Steam CDN, 30).

### Details

- **`onLoad()` 1-4** — `updateSelf()`; global `prevt=0`.
- **`onHover` / `onDrop` / `onPickUp` 8-19** — global `held_color = ply`; `updateSelf()`.
- **`updateSelf()` 22-43** — W: globals `stampName` (its own name), `stampUrl`. Clears the red highlight. Empty description → default image, flash red 5 times (`Wait.time` every 0.2 s), scale 1.5. `setDecals` with one decal named `stampImage` on top of the tool. This replaces any other decals on the tool.
- **`onObjectHover(ply, obj)` 47-58** — Returns for nil, already-locked or non-Card objects. Only if this tool is held by `ply`: lock the card, then unlock it when the player's hover target changes (or after a 3 s timeout). It never unlocks cards that were locked to begin with (48).
- **`onCollisionEnter(co)` 61-139**
  - Runs at most once per second (`os.time`, 63-66). Returns if the description is empty or the other object is not a Card. Sets `prevt`.
  - Averages the contact points (W: global `count`). `flip=-1` when the card's z rotation is between 90 and 270.
  - Decal position = contact point in card-local space, with y = `flip`. Rotation from the tool and card yaw. Scale = tool scale / card scale × 2. Name = `stampName` (or "stamp" if empty).
  - Appends it to the card's decals and calls `setDecals` inside `pcall`. W: global `success`.
  - If `held_color` is set: broadcast to that player "use the decal tool (F9) to remove it".

**With the rules engine:** KEEP (cosmetic). It does not unlock cards that were already locked (48).

---

## moon-mtg-equip

- **Object:** "moon-mtg-equip", GUID **7deec9**, `PiecePack_Moons`, in bag **4f3387**. By stella + Lilith, v1.0.0.
- **Encoder:** `prop_id = "moon-mtg-equip"` (13), name "Manage Equipment", `visible=false`, `visible_in_hand=0`, `activateFunc=""`. Value `moon_mtg_equip` (`'nil'`, `{}`): list of attachment indices.
- **Overview:** adds an "equip all to top" context item to decks. It takes the deck's top card as host, then attaches every other card of the deck to it as a small locked attachment. A host shows an "unequip all" button that detaches them.
- **Encoder proxy (22-33):** `encoder()` returns a table whose `enc.X(args)` calls `Encoder.call("APIX", args)`, or nil if there is no Encoder.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `encoder()` (local) | 29 | Returns the Encoder proxy or nil. | every function | none |
| `register_module()` (local) | 37 | Checks Encoder ≥ 4.4, registers the property and value. | "Register Module" context item (199), `Wait.condition` (200) | Encoder registries; may `error()` |
| `init_card(card)` (local) | 66 | Encodes a card and enables this property. | `onObjectDropped`, the deck context item | Encoder state; rebuild |
| `equipped_offset(i)` (local) | 84 | Local offset for attachment slot `i`. | `equip_to` | none |
| `equip_to(deck, to)` (local) | 90 | Moves every card of `deck` onto `to` as attachments. | deck context item | **Absorbs cards** into `to` |
| `setup_deck_ctx(obj, force)` (local) | 125 | Adds the "equip all to top" item to an object once (unless forced). | `onload`, `onObjectSpawn`, `onObjectEnterContainer`, zone events | Context item; script var |
| `createButtons(params)` | 146 | Draws "unequip all" if the card has attachments. | Encoder rebuild | Button |
| `unequip_all(obj, ply)` | 176 | Detaches every attachment and stacks them above the host. | "unequip all" button (171) | Moves cards; unlocks them |
| `onload()` | 198 | Adds "Register Module", waits for the Encoder, adds the deck item to every deck. | TTS load | Context items |
| `onObjectDropped(ply, obj)` | 209 | `init_card(obj)`. | TTS event | Encoder state |
| `onObjectSpawn(obj)` | 213 | Cards only: adds the deck item after 10 frames. | TTS event | Context item |
| `onObjectEnterContainer(container, obj)` | 219 | A card entering a deck → add the deck item (unless already added). | TTS event | Context item |
| `onObjectEnterZone(zone,obj)` | 225 | Decks (not "planechase") → re-add the item after 10 frames. | TTS event | Context item |
| `onObjectLeaveZone(zone, obj)` | 234 | Same as enter. | TTS event | Context item |

**Context items:** "Register Module" on itself; "equip all to top" on decks. **Chat / remote code:** none.

### Details

- **`register_module()` 37-64** — No Encoder → return. Version below 4.4 → broadcast in red and `error("bad encoder version")`. Registers the property **before** the value.
- **`init_card(card)` 66-82** — Card only; `noencode == true` → return. Encode if needed. Property not registered → return. If off: enable and rebuild. Every card a player drops while this tool is out of the bag gets this property.
- **`equipped_offset(i)` 84-88** — `col = floor(i/3)`, `row = i%3` → `Vector(-1.65-1.15*col, 0.05-row*(0.05/3), -0.75+row*(2.2/3))`. Three per column, columns extend to the left of the host.
- **`equip_to(deck, to)` 90-121**
  - Reads `to`'s `moon_mtg_equip`. `origin` is unused.
  - Loop while `deck` is a Card or still has objects: take the top card (`smooth=false`; `deck = deck.remainder or deck`), or use the last single card.
  - Place it at `to.positionToWorld(offset(#list))`, copy `to`'s rotation, scale 0.475, lock it, `to.addAttachment(card)`, append `#to.getAttachments()`.
  - Write the list back.
- **`setup_deck_ctx(obj, force)` 125-142** — Returns if the `moon-mtg-equip-ctx` var is set and not forced. The item: if the target is a Deck, take the top card 1 unit up as the host, `init_card(host)`, then `equip_to(rest, host)`. Sets the var. Forced calls (from `onload`, spawn and zone events) add duplicate items unless Global cleared the menu first.
- **`createButtons(params)` 146-174** — Only when `flip` is 1 (front) and the list is non-empty: "unequip all" at the card centre.
- **`unequip_all(obj, ply)` 176-194** — Lifts the host by `#list+1`. For i from last to first: `removeAttachment(list[i]-1)`, place at `origin + (0, n-i+1, 0)`, scale 1, unlock. Write `{moon_mtg_equip={}}`. Does not rebuild, so the button stays until the next rebuild.
- **`onload()` 198-207** — "Register Module"; `Wait.condition(register_module, …, 30)` (30 s timeout); forced deck items on every Deck.
- **`onObjectSpawn(obj)` 213-217** — Only for Cards, it calls `setup_deck_ctx` on the **card** (the item then returns early because the target is not a Deck). It looks intended for decks.
- **Zone events 225-241** — Skip nil, non-Card/Deck, and names containing "planechase". Decks get a forced re-add after 10 frames.

**With the rules engine:** DISABLE (bagged). `addAttachment` absorbs card objects. REUSE the layout: `equipped_offset(i)`, scale 0.475, at `host.positionToWorld`.

---

## Possibility Storm

- **Object:** "Possibility Storm [sub][i]enables context menu option on cards[/i][/sub]", GUID **65f205**, `Custom_Token`, in bag **4f3387**.
- **Encoder:** none.
- **Overview:** adds a "Possibility Storm" context item to every card. Using it reveals cards from the player's library until one shares a type word with the selected card. That card is set aside and highlighted; the rest are shuffled and put on the bottom.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Reads Global `data` and `deckDirs`; adds the item to every card. | TTS load | Context items |
| `onDrop()` | 12 | Broadcasts how to use it. | TTS object event | Broadcast |
| `onObjectEnterScriptingZone(zone,obj)` | 16 | Re-adds the item after 1 frame. | TTS event | Context item |
| `onObjectExitScriptingZone(zone,obj)` | 25 | Same. | **never** (TTS has no event by this name) | — |
| `possibility(ply)` | 34 | Runs the reveal. | "Possibility Storm" context item | Moves, takes, groups and shuffles cards; broadcast |
| `groupCards(c)` | 138 | Stacks revealed cards into one deck. | `takeObject` callback (105) | `putObject` |
| `onObjectEnterContainer(container, enter_object)` | 146 | Follows the revealed stack when it merges into a deck. | TTS event | Writes global `cDeck` |
| `getDeckFromZone(zone)` | 152 | First Deck in a zone. | `possibility` | none |

**Chat / buttons / remote code:** none.

### Details

- **`onLoad()` 1-10** — W: globals `data` (Global `data`), `deckDirs`, `types` (7 card types). Adds the item to every Card in `Global.getObjects()`.
- **`possibility(ply)` 34-136**
  - The context callback receives `(player_color, position, obj)`; only `ply` is used.
  - If `data` or `deckDirs` is nil it broadcasts "only works on Pie's MTG tables" but **does not return** (36-38), so it then errors.
  - W: globals `keepGoing`, `cardInd`, `foundCard`, `cDeck`, `finalCard`, `crot`, `cpos`, `dpos`, `drot`.
  - Deck = first Deck in `data[ply].libraryZone`. The cast card is the player's **first selected object**, not the right-clicked card. Clears the selection. Returns if it is not a Card or there is no deck.
  - Types = those of the 7 words found in the cast card's name. Scans the deck for the first card whose name (punctuation removed) contains one; `nCards` = its position (or the deck size if none). If none is found, `foundCard` stays nil and the broadcast at 112 errors.
  - `Physics.cast` box 3.6 units to the side (by `deckDirs[ply]`); pushes any card or deck found there forward to `targPos`.
  - Moves the cast card 2.4 units to the side, face up.
  - Every 0.1 s: takes the top card to the side (stacking with `groupCards`). The last one goes 4.8 units to the side, is highlighted red for 5 s, and triggers a broadcast "<steam_name> wanted to cast X but got Y instead". `keepGoing=true` 1 s later.
  - When `keepGoing`: after 0.5 s, shuffle `cDeck` (which starts as the cast card, so the cast card goes to the bottom too), rotate face down, move it to the deck's position at y=1, lift the library 2 units so the stack slides under.
- **`groupCards(c)` 138-144** — First card becomes `cDeck`; later ones `cDeck = cDeck.putObject(c)`.
- **`onObjectEnterContainer` 146-150** — If `cDeck` was absorbed, follow the container.
- **`getDeckFromZone(zone)` 152-162** — Linear scan.

**With the rules engine:** DISABLE (bagged; it adds a context item to every card when taken out).

---

## Color Module

- **Object:** "Color Module", GUID **b8b8df**, `PiecePack_Arms`, loose. Tipsy Hobbit v1.12.
- **Encoder:** propID `MTG_Colors` (5), name "MTG Colors", `activateFunc='callEditor'`, tags `basic,face_prop`. Value `mtg_colors` (`'pattern(^[wubrg]*$)'`, `''`).
- **Overview:** marks a card's color identity as small colored pips. An editor mode shows five large color toggles.
- **Script globals:** `colors` (9-15: w/u/b/r/g with a `Color` and a name), `Style`, `enc`, `data`, `flip`, `scaler`, `editing`, `i`.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 17 | Adds 6 named colors to TTS's `Color` table; adds "Register Module"; waits for the Encoder. | TTS load | `Color.Add`; context item |
| `registerModule(obj,ply)` | 30 | Registers the property and value; defines `toggle<w/u/b/r/g>`; builds `Style`. | context item, `Wait.condition`, Encoder | Encoder registries; `_G` |
| `refreshStyle()` | 69 | Re-reads the style table. | nobody | — |
| `toggleStatus(obj,ply,alt,val)` | 73 | Adds or removes one color letter. | `toggle<c>` editor buttons (137) | Data; rebuild |
| `toggleEditor(obj,ply)` | 88 | Enters editing mode for this property. | colored pips (129, 146); `callEditor` | Encoder editing; rebuild |
| `callEditor(obj,ply,alt)` | 95 | Left: toggle the property (and open the editor when turning on). Right: reset it. | πMenu "MTG Colors" button | Encoder state |
| `toggleEditClose(obj,ply)` | 108 | Leaves editing mode. | nobody (the Encoder's "X" does this) | — |
| `createButtons(t)` | 116 | Draws pips (normal) or the 5 toggles (editing). | Encoder rebuild | Buttons |
| `updateModule(wr)` | 153 | Self-update from GitHub, or self-destruct if deprecated. | Encoder `callVersionCheck` | **Remote code** |

**Context items:** "Register Module" on itself. **Chat:** none.

**Remote code:** `UPDATE_URL` (6), fetched only by the Encoder's admin "Update".

### Details

- **`onload()` 17-29** — `Color.Add` for `mtg_white`, `mtg_blue`, `mtg_black`, `mtg_red`, `mtg_green`, `mtg_colorless`.
- **`registerModule(obj,ply)` 30-68** — Property before value. `_G['toggle'..c]` closures (53). `Style.proto = APIgetStyleTable(nil)`. `Style.new(o)` fills missing keys from the proto (59-66).
- **`toggleStatus(obj,ply,alt,val)` 73-86** — Letter present → `gsub` it out; else append. Write; rebuild. The pattern validator keeps only `^[wubrg]*$` strings.
- **`toggleEditor(obj,ply)` 88-94** — `APIsetEditing{obj, propID}`; rebuild.
- **`callEditor(obj,ply,alt)` 95-107**
  - `type(obj) == 'Table'` never matches (Lua returns `'table'`), so the `APIobjCallProp` packed form is not unpacked (96).
  - Uses the global `enc`.
  - `alt` → `APIobjResetProp` (property off, value ''), with no rebuild.
  - Else toggle; if now on → `toggleEditor`; else rebuild.
- **`toggleEditClose(obj,ply)` 108-114** — `APIclearEditing`; rebuild. Unused.
- **`createButtons(t)` 116-152**
  - Normal (`editing == nil`): one small pip per color in `mtg_colors` at `(1.0*flip, 0.28*flip, -1.4+i*0.1)` (top right edge), click `toggleEditor`. `label=temp` reads the global `temp`, which is the Encoder's variable in another script, so here it is nil.
  - Editing this property: five 300×100 toggles down the card centre, click `toggle<c>`.
  - Normal with no colors: one grey "Colorless" pip via `Style.new` (145-149).
  - Editing another property: draws nothing.
- **`updateModule(wr)` 153-171** — Same as Phasing's.

**With the rules engine:** KEEP (cosmetic). It is listed with the "Keep as-is" items. It can rewrite its own script through the Encoder's "Update".

---

## πMenu

- **Object:** "πMenu", GUID **c369d7**, `PiecePack_Arms`, loose. π's version of Tipsy Hobbit's Basic Menu.
- **Encoder:** menu `πMenu` (11), `activateFunc='createMenu'`, `visible_in_hand=1`. No values.
- **Overview:** the "<<<" button on the top-left corner of every encoded card. It opens a list of every visible property; each list button runs that property's `activateFunc` on its own module. It also adds "Flip Menu" (flips the card and the overlay) and "Disable Encoding".

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `GetStringWidth(str)` | 38 | Sums per-character widths from `charWidth` (15-36). | `getWidthOffset` | none |
| `getWidthOffset(str,align,fSize,xScale)` | 54 | Button width and x offset for a label. | `createMenu` | none |
| `onload()` | 60 | Waits for the Encoder; draws the register button. | TTS load | Button |
| `registerModule()` | 69 | Registers the menu; builds `Style`. | button (63), `Wait.condition`, Encoder | Encoder `Menus` |
| `createMenu(t)` | 102 | Draws the closed "<<<" or the open list. | Encoder rebuild (menu) | Buttons |
| `piFlipMenu(o)` | 208 | Moves the overlay to the other face and flips the card. | "Flip Menu" button (192) | `APIFlip`; `o.flip()` |
| `toggleMenu(o)` | 216 | Opens or closes the list. | "<<<"/">>>" buttons (120, 125, 133) | Encoder menu state; rebuild |

**Chat / context items / remote code:** none.

### Details

- **Constants 49-58** — `scales`/`scaleR` lookup; `scaleI=5` so `xScale=0.5`. `getWidthOffset` = `GetStringWidth/scaleR[5]*fSize + 100/0.5` and `offset = width*xScale*align/2/480.8`.
- **`onload()` 60-67** — `Wait.condition` first, then the register button.
- **`registerModule()` 69-100** — W: global `enc`, `menu`, `Style`. `APIregisterMenu`. `Style.proto` = scale 0.5, height 240, font 200, dark color, white text. `Style.new` fills missing keys.
- **`createMenu(t)` 102-206**
  - Calls `registerModule` if `Style` is nil. Global `enc`.
  - `props = APIgetPropsList()` (all), `md = APIobjGetMenuData`.
  - Closed: shadow and button "<<<" at `(-0.875*flip, 0.3*flip, -1.485)`, click `toggleMenu`.
  - Open: ">>>" `toggleMenu`. `propOrder` (139-149) fixes the order by the first two letters of the name: co, no (notepad), ke (keywords), ca (importer), mt (colors), ph (phasing), is (token), ma (manifest), mo (morph). Others follow in `pairs` order.
  - For each property with a live owner and `visible ~= false`: a button labelled with its name, yellow if on. `click_function = activateFunc`, `function_owner = funcOwner`. So a click runs `activateFunc(card, color, alt)` on the module. Rows at `z=-1.4+pos*0.25`, left-aligned at x=-1.1.
  - Then "Flip Menu" (`piFlipMenu`) and "Disable Encoding" (red, `click_function='disableEncoding'`, `function_owner=enc`, i.e. the Encoder's internal function, Encoder 709). Both are pushed to row 10 or later.
  - W: global `md`, `onProps`, `v`, `fColor`, `propName`, `propName_repPi`, `width`, `xOffset`, `t2`, `pos`.
  - Hidden properties on this table: Easy Modules, Sticker, πScry, moon-equip. Shown: πKeywords, Morphin', Phasing, Is Token, MTG Colors, πCounter, πNotepad, and the Card Importer's property if it registers one.
- **`piFlipMenu(o)` 208-214** — `APIFlip` then `o.flip()` (a physical flip, which shows the card to everyone).
- **`toggleMenu(o)` 216-222** — `APIobjToggleMenu`; rebuild.

**With the rules engine:** KEEP; it is a good home for per-card engine actions (register an engine property and it appears here). `piFlipMenu` (208-214) calls `o.flip()`, and "Disable Encoding" restores original names, so gate both on engine cards.

---

## πCounter

- **Object:** "πCounter", GUID **def0af**, `PiecePack_Arms`, loose.
- **Encoder:** propID `πCounter` (4), name "Counter^π", `activateFunc='toggleProp'`, tag `basic`. Value `picounter` (number, 0).
- **Overview:** a big number drawn on the card (0-999). Click +1, right-click -1. When enabled it **replaces the card's Lua script** with a small script (39) so the player can type a number while hovering the card.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 7 | Register button; waits for the Encoder. | TTS load | Button |
| `registerModule()` | 17 | Registers the property and value. | button, `Wait.condition`, Encoder | Encoder registries |
| `toggleProp(obj,ply)` | 41 | Toggles the property, installs or removes the card script, reloads the card. | πMenu "Counter^π" button; "×" button (71) | **`setLuaScript` + `reload()`** on the card |
| `createButtons(t)` | 62 | Draws the number with an outline and shadow, plus a close "×". | Encoder rebuild | Buttons |
| `add_subtract(obj,color,alt)` | 124 | ±1, clamped to 0-999. | the number button (112) | Data; rebuild |
| `null()` | 135 | Empty callback. | label buttons | — |

**Card script (`script`, 39):** sets `self.max_typed_number=999`. `onNumberTyped(ply, int)` writes `picounter=int` and rebuilds through the Encoder, returning true (so the card is not dealt).

**Chat / context items / remote code:** none.

### Details

- **`registerModule()` 17-37** — Property before value.
- **`toggleProp(obj,ply)` 41-60**
  - `APItoggleProperty`. On → `obj.setLuaScript(script)`. Off → `setLuaScript('')` and `picounter=0`.
  - `obj = obj.reload()`, then when the new object stops spawning: `APIobjUpdateThis` and rebuild.
  - Any other script on the card is lost.
- **`createButtons(t)` 62-120**
  - W: globals `flip`, `dat`, `picounter`, `pos`, `bpars`, `opars`.
  - "×" close button at `(0.65*flip, 0.25*flip, -1.09)`.
  - The 9-button outline loop reuses one table: `opars = bpars` is the same table, so each `createButton(bpars)` has the updated position. That is how the outline gets drawn.
  - Shadow; then the clickable number (600×600, `add_subtract`) at `(0, 2*flip, -0.45)`. y=2 puts it well above the card surface.
- **`add_subtract(obj,color,alt)` 124-133** — Global `enc`. Writes and rebuilds only if the value changes.

**With the rules engine:** REUSE (♻️). The script swap and reload replace the card object, so track cards by engine ID → current GUID.

---

## πScry

- **Object:** "πScry", GUID **de4346**, `PiecePack_Arms`, loose. Global makes it non-interactable 5 frames after load (Global 11-13).
- **Encoder:** propID `πScry` (1), name "Scry Module", no values, `visible=false`, `visible_in_hand=2` (**hand only**), tags `tool,table_tool`. Global's `scry1` enables it on each card it deals to the player's hand 2 (Global 777-785).
- **Overview:** on a card in the scry hand it draws ▲ (to library top), ▼ (to library bottom) and ☠ (to graveyard). Each moves the card, and any other selected scry cards in random order. The property turns itself off when the card reaches hand 1 or lands on the table.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 4 | Register button; waits for the Encoder. | TTS load | Button |
| `registerModule()` | 13 | Caches Global `data` as `tableGUIDs`; registers the property. | button, `Wait.condition`, Encoder | Encoder registry |
| `toggleProp(obj,ply)` | 31 | Toggles the property; rebuild. | nothing in scope (hidden) | Encoder state |
| `onObjectEnterZone(zone,obj)` | 60 | A card entering a hand-1 zone loses the property. | TTS event | `APIobjDisableProp` |
| `onObjectDestroy(obj)` | 81 | A destroyed card loses the property. | TTS event | `APIobjDisableProp` |
| `onObjectDrop(ply,obj)` | 93 | A card dropped outside any hand 2 loses the property. | TTS event | Disable; rebuild |
| `createButtons(t)` | 116 | Draws ▲ ▼ ☠ with background frames. | Encoder rebuild (in hand) | Buttons |
| `move2Lib(card, playerColor, alt)` | 171 | Left = top, right = bottom. | nobody ("currently unused") | — |
| `move2TopLib(card, playerColor)` | 179 | Moves the card face down onto the library top. | ▲ button | Hides, rotates, moves the card |
| `move2BotLib(card, playerColor)` | 203 | Moves the card face down under the library. | ▼ button | same |
| `move2Grav(card, playerColor)` | 226 | Moves the card face up to the graveyard. | ☠ button | Rotates, moves |
| `shuffleList(list)` | 247 | Fisher-Yates shuffle in place. | the three move functions | Reseeds `math.random` |
| `allBut(playerColor)` | 257 | Every color except one. | top/bottom moves | none |
| `unhide(card,nframes)` | 266 | `setHiddenFrom({})`. | 0.2 s after the moves | Visibility |
| `handTrigger(obj)` | 273 | Turns `use_hands` off for 0.1 s. | the moves | Object flag |
| `handOn(obj)` | 279 | Turns `use_hands` back on. | `handTrigger` | Object flag |
| `checkMoveSuccess(card,targetPos,playerColor)` | 286 | Teleports the card if it did not reach the target. | 0.5 s after each move | `setPosition` |

**Chat / context items / remote code:** none.

### Details

- **`registerModule()` 13-29** — W: global `enc`, `tableGUIDs = Global.getTable('data')` (a copy with zone objects), `properties`.
- **`toggleProp` 31-34** — Uses the global `enc`.
- **`onObjectEnterZone(zone,obj)` 60-79** — Cards only. Looks up the zone in `APIlistZones`. If its name contains `_1` (hand 1), the card is encoded and the property is on → `APIobjDisableProp`, with no rebuild here (the Encoder's own zone event rebuilds). The commented-out hand-2 version is at 36-58.
- **`onObjectDestroy(obj)` 81-90** — In `pcall`. Disables the property on destroyed cards; this does not clean up Encoder data.
- **`onObjectDrop(ply,obj)` 93-114** — Cards with the property on. If the card is not among any color's hand-2 objects → disable and rebuild.
- **`createButtons(t)` 116-168** — W: global `card`. Three pairs (grey frame `null`, dark button) at local `(-0.8,0.1,-2.2)`, `(-0.8,0.1,-1.77)`, `(-0.8,0.1,1.77)`. Click functions `move2TopLib`, `move2BotLib`, `move2Grav`. `null` is not defined in this script.
- **`move2TopLib(card, playerColor)` 179-201**
  - Disable the property; target = library zone position at y=3; `clearButtons`.
  - Hide from everyone but the owner; unhide after 0.2 s; rotate face down.
  - After 0.2 s: `handTrigger` and smooth-move. After 0.5 s: `checkMoveSuccess`.
  - Then, for each other selected card that still has the property (shuffled), repeat on the following frames. Clears the selection.
  - W: global `selected`.
- **`move2BotLib` 203-224** — Same with y=0.95 (under the deck).
- **`move2Grav` 226-245** — Face up, graveyard position at y=3, no hiding.
- **`shuffleList(list)` 247-254** — Reseeds with `os.time()` on every call.
- **`checkMoveSuccess` 286-300** — Compares the z (or x) coordinate depending on hand 2's facing. Teleports if off by more than 1.

**With the rules engine:** REUSE the ▲/▼/☠ buttons (116-168) and the animations (179-245) as the UI for engine scry/surveil prompts. The buttons send the answer; the move is animated when the engine's patch arrives.

---

## πNotepad

- **Object:** "πNotepad", GUID **7a0067**, `PiecePack_Arms`, loose.
- **Encoder:** propID `πotepad` (12; note the spelling), name "Notepad^π", `activateFunc='toggleProp'`, `visible_in_hand=1`, tag `tool`. Value `note` (no validType, default `{text='', editON=true}`).
- **Overview:** a text box drawn over the card's text area. Editable when unlocked; when locked it shows the text as a word-wrapped label of up to 9 lines.

### Function table

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 15 | Register button; waits for the Encoder. | TTS load | Button |
| `registerModule()` | 25 | Registers the property and `note`. | button, `Wait.condition`, Encoder | Encoder registries |
| `toggleProp(obj,ply)` | 48 | Toggles the property; rebuild. | πMenu "Notepad^π" button | Encoder state |
| `createButtons(t)` | 53 | Draws the lock toggle plus an input (edit mode) or a label (locked). | Encoder rebuild | Buttons and an input |
| `toggleEdit(obj,ply)` | 162 | Flips `note.editON`. | ✏/✉ buttons (65, 81, 145) | Data; rebuild |
| `editText(obj,ply,val,sel)` | 169 | Saves the text when editing ends. | the text input (96) | Data |
| `findStringLength(str)` | 206 | Width of a string. | nobody | — |
| `insertBreaks(str)` | 221 | Word-wraps text to `maxWidth` and pads to 9 lines. | `createButtons` | none |
| `null()` | 305 | Empty callback. | label buttons | — |

**Chat / context items / remote code:** none.

### Details

- **`toggleProp` 48-51** — Uses the global `enc`.
- **`createButtons(t)` 53-160** — W: global `flip`, `data`, `ttip`, `bLabel`.
  - Always a dark square toggle at `(0.835*flip, 0.28*flip, 0.275)`.
  - `editON`: a "✏" label (rotated) and a `createInput` (1770×1320, scale 0.5, value = text, `editText`).
  - Locked: an unclickable background, the wrapped text label, and a "✉" label.
- **`toggleEdit(obj,ply)` 162-167** — Uses the global `enc`; negate; write; rebuild.
- **`editText(obj,ply,val,sel)` 169-180** — `sel == false` (editing finished) → write `note.text = val`, with no rebuild. Otherwise only `log(...)` of the partial text.
- **`insertBreaks(str)` 221-301** — Splits on existing newlines. For each piece, breaks at the last space once the width passes 59837 (or mid-word if there is no space). Stops after more than 9 lines, then pads with `' '` to 9. Returns the lines joined with `\n`. W: global `prevLen`.

**With the rules engine:** KEEP ("Notecard/πotepad" in the keep list).

---
## Enablers (bag 4f3387): shared "reveal until" pattern

Cascade, Jodah, Chaos Wand, Planar Bridge, Oath of Druids, Atla Palani, Indomitable Creativity and Bag of Tricks/Codie share most of their code. They are tokens you **drop onto a library deck**. `onCollisionEnter(co)` then does the following:

1. Runs at most once per second, using the global `prevt` and `os.time()`. Acts only if the touched object is a Deck. W: global `deck`.
2. Scans `deck.getObjects()` from the top for the first match. Counts `nCards` up to and including it. With no match, `nCards` is the whole deck. `cardInd = i` uses an undefined `i` (always nil).
3. `Physics.cast` a box beside the deck (`deckDir` × 2.4 or 3.6). Any card or deck it hits is pushed to `targPos = deck - forward×3.4`, clearing the landing area.
4. Every 0.1 s, takes one card face up to the side (`deckDir`×2.4). `groupCards` stacks these into `cDeck`. The last (matching) card goes to `deckDir`×4.8 and is highlighted red.
5. Puts the stack on the bottom of the library: shuffle, rotate face down, move to the deck position at y=1, and lift the deck 2 units so it slides under. Oath of Druids sends it to the graveyard instead.
6. `self.destruct()` (single-use).

`onObjectEnterContainer` follows `cDeck` (and sometimes `deck`) when they merge into a container. Each has a "←/→" button (`changeDeckDir`) that sets which side cards come out on, saved in `script_state`. None has chat commands, context items or remote code. None uses the Encoder except Cascade and Manifest/Cloak.

**With the rules engine (all Enablers):** DISABLE. They take, shuffle and move library cards. Gate them in Global `onObjectLeaveContainer` when the container is 4f3387, or leave the bag out of the engine-mode save.

---

## Cascade Enabler

- **Object:** "Cascade Enabler", GUID **c012f6**, `Custom_Token`, in bag **4f3387**.
- **Encoder:** no property. Uses `APIencodeObject`, `APIdisableEncoding`, `APIenableEncoding`, `APIobjectExists`.
- **Overview:** reveal until a nonland with CMC ≤ N (default 5). Offers ✓ (cast) / ✗ (decline) buttons on the hit; the rest go to the bottom in random order.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 1 | Loads `{CascadeCMC, deckDir}`; draws the number and direction buttons; caches the Encoder. | TTS load | Buttons; global `Encoder` |
| `changeDeckDir()` | 49 | Flips the side and saves. | "←/→" button (37) | Button edit; `script_state` |
| `updateSave()` | 62 | Saves `{CascadeCMC, deckDir}` to `script_state`. | 60, 73, 86 | `script_state` |
| `add_subtract(_obj, _color, alt_click)` | 67 | N ±1 (0-99). | number button (11) | Label; save |
| `updateVal()` | 76 | Redraws the number. | 72, 85 | Button edit |
| `onNumberTyped(col,int)` | 83 | Sets N from a typed number (`max_typed_number=99`, 82). | TTS event | Label; save |
| `groupCards(c)` | 90 | Stacks revealed cards; `keepGoing2=true`. | `takeObject` callback (145) | `putObject` |
| `onCollisionEnter(co)` | 99 | Runs the cascade (shared pattern) and adds ✓/✗ to the hit. | TTS event | Moves cards; Encoder; parks itself, then destructs |
| `acceptCascade(card)` | 217 | Re-enables encoding on the hit, clears its buttons, sends the rest to the bottom, destructs. | ✓ button (192); 10 s timeout (211) | Moves cards; destruct |
| `declineCascade(card)` | 232 | Re-enables encoding; adds the hit to the rest; sends all to the bottom; destructs. | ✗ button (173) | Moves cards; destruct |
| `moveCDeckToBot(cDeck)` | 256 | Shuffles and slides the stack under the library. | accept/decline | Moves cards |
| `onObjectEnterContainer(container, enter_object)` | 270 | Follows `cDeck` while `cascadingNow`. | TTS event | Global `cDeck` |
| `getCMC(name,desc)` | 275 | Reads "N CMC"/"CMC N" from name or description; nil for lands with no or zero CMC. | `onCollisionEnter` | Global `cmc`, `isLand` |

**Details:**
- **`onload`** — `saved_data ~= ""` → decode it. `tooltip=ttText` is an undefined global, overridden by the later `tooltip` key. W: globals `keepGoing1`, `keepGoing2`, `cDeck`, `lab`, `tip`, `Encoder`.
- **`onCollisionEnter`** — Match: `cmc ~= nil and tonumber(cmc) <= CascadeCMC` (112). Cast box 3.6 units, size 4×4×2. Revealed cards are placed at y=2. Sets `cascadingNow=true`.
  - When the last card rests: `cascadingNow=false`; highlight; `APIencodeObject` + `APIdisableEncoding` (so no overlay shows); four buttons on the hit. Two grey frames use `click_function='null'`, which this script does not define. ✗ calls `declineCascade`, ✓ calls `acceptCascade`, both with `function_owner=self`.
  - The enabler then moves itself to (0,0,500) and locks (204-205). After 10 s it destructs and auto-accepts if `finalCard` is still set (206-213).
- **`acceptCascade(card)`** — `finalCard=nil`; `APIenableEncoding` if encoded; `setGMNotes('')`; `clearButtons`; `moveCDeckToBot(cDeck)` if there is a stack; `self.destruct()`.
- **`declineCascade(card)`** — As accept, but moves the hit onto the stack and puts it into the stack after 1 frame, then `moveCDeckToBot` after 1 s. With no stack, the hit alone goes face down under the library (y=0.96).
- **`moveCDeckToBot(cDeck)`** — W: global `dpos`, `drot`. Shuffle, rotate face down, move to the deck at y=1, lift the deck 2.

**With the rules engine:** DISABLE (bagged Enabler; see the shared note above).

---

## Jodah Enabler

- **Object:** "Jodah Enabler", GUID **fd2638**, `Custom_Token`, in bag **4f3387**. A copy of Cascade with "legendary" required.
- **Overview:** reveal until a **legendary** card with CMC ≤ N.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 1 | As Cascade (loads N and side; caches `Encoder`, unused). | TTS load | Buttons |
| `changeDeckDir()` | 49 | Flips the side; saves. | "←/→" button | Button; `script_state` |
| `updateSave()` | 62 | Saves `{CascadeCMC, deckDir}`. | 60, 73, 86 | `script_state` |
| `add_subtract(_obj, _color, alt_click)` | 67 | N ±1 (0-99). | number button | Label; save |
| `updateVal()` | 76 | Redraws N. | 72, 85 | Button |
| `onNumberTyped(col,int)` | 83 | Typed N. | TTS event | Label; save |
| `groupCards(c)` | 90 | Stacks revealed cards; `keepGoing2=true`. | `takeObject` callback | `putObject` |
| `onCollisionEnter(co)` | 99 | Shared pattern; match = `cmc ≤ N` and "legendary" in the name (112-113). | TTS event | Moves cards; **destructs at once** (173) |
| `moveCDeckToBot(cDeck)` | 177 | Same as Cascade's. | nobody | — |
| `onObjectEnterContainer(container, enter_object)` | 191 | Follows `cDeck`. | TTS event | Global `cDeck` |
| `getCMC(name,desc)` | 196 | As Cascade. | `onCollisionEnter` | globals |

**Details:** revealed cards stack at `y + 0.1*i`. The bottom step runs when `keepGoing1 and keepGoing2`. `keepGoing1` is set 1 s after the last take. `self.destruct()` is called right after scheduling the waits (173), so the scheduled steps depend on TTS running Wait callbacks of a destroyed object. Not verified here. No accept/decline buttons.

**With the rules engine:** DISABLE (bagged Enabler; see the shared note above).

---

## Chaos Wand Enabler

- **Object:** "Chaos Wand Enabler", GUID **1ba507**, `Custom_Token`, in bag **4f3387**.
- **Overview:** reveal until an instant or sorcery.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad(saved_data)` | 1 | Search terms `instant`/`sorcery`; side from `saved_data` as a number; "←/→" button. | TTS load | Button |
| `changeDeckDir()` | 32 | Flips the side; `script_state = deckDir` (a number). | "←/→" button (22) | Button; `script_state` |
| `groupCards(c)` | 45 | Stacks; `keepGoing2=true`. | `takeObject` callback (96) | `putObject` |
| `onCollisionEnter(co)` | 54 | Shared pattern; match = name contains either term. Cast box 2.4 units, 1×4×2. | TTS event | Moves cards; destructs (124) |
| `onObjectEnterContainer(container, enter_object)` | 128 | Follows `cDeck`. | TTS event | Global `cDeck` |

**With the rules engine:** DISABLE (bagged Enabler; see the shared note above).

---

## Planar Bridge Enabler

- **Object:** "Planar Bridge Enabler", GUID **e1af73**, `Custom_Token`, in bag **4f3387**.
- **Overview:** identical code to Chaos Wand with terms `creature`/`planeswalker` (2-3).

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad(saved_data)` | 1 | Terms, side, "←/→" button. | TTS load | Button |
| `changeDeckDir()` | 32 | Flips and saves the side. | "←/→" button | Button; `script_state` |
| `groupCards(c)` | 45 | Stacks; `keepGoing2=true`. | `takeObject` callback | `putObject` |
| `onCollisionEnter(co)` | 54 | Reveal until a creature or planeswalker (by name). | TTS event | Moves cards; destructs (124) |
| `onObjectEnterContainer(container, enter_object)` | 128 | Follows `cDeck`. | TTS event | Global `cDeck` |

**With the rules engine:** DISABLE (bagged Enabler; see the shared note above).

---

## Oath of Druids Enabler

- **Object:** "Oath of Druids Enabler", GUID **d83b34**, `Custom_Token`, in bag **4f3387**.
- **Overview:** reveal until a creature; the other revealed cards go to the **graveyard**, not the bottom.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad(saved_data)` | 1 | Terms `creature`/`creature`; `gravFor = Global.getVar('gravFor')` or -4.14; side; button. | TTS load | Button |
| `changeDeckDir()` | 39 | Flips and saves the side. | "←/→" button | Button; `script_state` |
| `groupCards(c)` | 52 | Stacks; `keepGoing2=true`. | `takeObject` callback | `putObject` |
| `onCollisionEnter(co)` | 61 | Reveal until a creature. Then makes the stack non-interactable with no gravity for 1 s, and moves it face up to `deck - forward×gravFor` at y=3 (the graveyard) (115-131). | TTS event | Moves cards; destructs (133) |
| `onObjectEnterContainer(container, enter_object)` | 137 | Follows `cDeck`. | TTS event | Global `cDeck` |

**With the rules engine:** DISABLE (bagged Enabler; see the shared note above).

---

## Atla Palani Enabler

- **Object:** "Atla Palani Enabler", GUID **5e98cd**, `Custom_Token`, in bag **4f3387**.
- **Overview:** repeats "reveal until a creature" `nReps` times (default 1). Each hit is laid out in a row; non-creatures are shuffled to the bottom after each repeat.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 1 | Loads `{nReps, deckDir}`; number and "←/→" buttons. | TTS load | Buttons |
| `changeDeckDir()` | 48 | Flips and saves the side. | "←/→" button (37) | Button; `script_state` |
| `updateSave()` | 61 | Saves `{nReps, deckDir}`. | several | `script_state` |
| `add_subtract(_obj, _color, alt_click)` | 66 | `nReps` ±1 (0-99). | number button (16) | Label; save |
| `updateVal()` | 75 | Redraws `nReps`. | 71, 84 | Button |
| `onNumberTyped(col,int)` | 82 | Typed `nReps`. | TTS event | Label; save |
| `onCollisionEnter(co)` | 88 | Locks the deck from interaction, clears the landing area, then runs `nReps` chained repeats. | TTS event | Moves cards; destructs (202) |
| `groupCards(c)` | 206 | Stacks revealed non-matches. | `takeObject` callback (150) | `putObject` |
| `onObjectEnterContainer(container, enter_object)` | 214 | Follows `cDeck` and `deck`. | TTS event | Globals |

**Details (`onCollisionEnter` 88-204):**
- `deck.interactable=false`.
- For each repeat, a `Wait.condition` waits for the previous repeat (`repsDone[n-1]`). `repsDone` is re-created as `{}` in every loop iteration (122), so only the last repeat's entry survives and the chaining condition for repeats beyond 2 may never become true.
- Inside a repeat: scan for the next creature. None → `printToAll('could not find any valid cards')` and return (the deck stays non-interactable).
- Take cards (hit placed at `deckDir*(4.8 + (rep-1)*1.5)`). When the hit rests, `keepGoing=true`. Then shuffle the stack, move it under the deck at y=0.95 and lift the deck. If the stack became a Deck, it becomes `deck` (182).
- On the last repeat the deck becomes interactable again.

**With the rules engine:** DISABLE (bagged Enabler; see the shared note above).

---

## Indomitable Creativity Enabler

- **Object:** "Indomitable Creativity Enabler", GUID **a0464f**, `Custom_Token`, in bag **4f3387**.
- **Overview:** in one pass, finds the first `nReps` creature-or-artifact cards. Each is laid out in a row; all other revealed cards go under the deck, which is then shuffled.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 1 | Loads `{nReps, deckDir}`; buttons. | TTS load | Buttons |
| `changeDeckDir()` | 48 | Flips and saves the side. | "←/→" button | Button; `script_state` |
| `updateSave()` | 61 | Saves. | several | `script_state` |
| `add_subtract(_obj, _color, alt_click)` | 66 | `nReps` ±1 (0-99). | number button | Label; save |
| `updateVal()` | 75 | Redraws. | 71, 84 | Button |
| `onNumberTyped(col,int)` | 82 | Typed `nReps`. | TTS event | Label; save |
| `onCollisionEnter(co)` | 92 | Records hit positions; takes cards one by one (hits to the row, others stacked); then puts the stack under and shuffles 10 times. | TTS event | Moves cards; destructs (188) |
| `groupCards(c)` | 192 | Stacks non-hits. | `takeObject` callback | `putObject` |
| `onObjectEnterContainer(container, enter_object)` | 200 | Follows `cDeck` and `deck`. | TTS event | Globals |

**Details:** no hit → print and return, leaving the deck non-interactable (119-122). `finalCard.highlightOn` runs right after `takeObject`. After the stack moves under, `deck.shuffle()` and `interactable=true` run 10 times, every 0.1 s (181). The `nCards` scan stops at the `nReps`-th hit, so cards after it are untouched.

**With the rules engine:** DISABLE (bagged Enabler; see the shared note above).

---

## Manifest/Cloak Enabler

- **Object:** "Manifest/Cloak Enabler", GUID **f1ee95**, `Custom_Token`, in bag **4f3387**. A two-state object: state 2 is "Cloak/Manifest Enabler" (**174475**, listed in `_index.json` as a child of f1ee95).
- **Encoder:** no property; uses `APIencodeObject` and Morphin' Time's `genericFlip`.
- **Overview:** drop it on a library: the top card comes off face down and becomes a Manifest or Cloak (by state) through Morphin' Time.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 1 | Copies the side from the other state's save; labels the button by state; side button. | TTS load | Buttons |
| `changeDeckDir()` | 81 | Flips and saves the side. | "←/→" button (56) | Button; `script_state` |
| `updateSave()` | 94 | Saves `{deckDir}`. | 20, 92 | `script_state` |
| `toggleState(obj, _color, alt_click)` | 99 | Switches to the other state (Manifest ↔ Cloak). | label button (33) | **`setState`: replaces the object** |
| `morphCard(card)` | 110 | Encodes the card and calls Morphin' `genericFlip{card, mode}`. | `takeObject` callback (156) | Card flipped and renamed |
| `onCollisionEnter(co)` | 121 | Takes the top card face down beside the deck → `morphCard`. Parks itself and destructs after 10 s. | TTS event | Moves a card; destruct |

**Details:**
- **`onload` 1-65** — `obj = getObjectFromGUID(self.guid)`. Collects the other states' `lua_script_state` into `otherStateData` (defined at 67, which runs first because it is top-level). If `saved_data` is non-empty and the other state's save is non-empty, adopt its `deckDir` and save. Button label = `faceDownTypes[stateId].name` (1 = Manifest, 2 = Cloak), or "Error". Caches `Encoder`. W: globals `obj`, `otherStates`, `decodedOtherStateData`, `stateId`, `buttonLabel`, `lab`, `tip`.
- **`morphCard(card)` 110-119** — Requires `Encoder` and Global `MorphinTime`. Mode from this object's current state id. W: global `MorphinTime`, `technicalName`.
- **`onCollisionEnter` 121-168** — `nCards=1`. Clears the landing area. Takes 1 card face down (z rotation 180) at y=2 with callback `morphCard`. Moves itself to (0,0,500), locks, destructs after 10 s.

**With the rules engine:** DISABLE (bagged Enabler; see the shared note above).

---

## Mindmoil Enabler

- **Object:** "Mindmoil Enabler", GUID **cbec15**, `Custom_Token`, in bag **4f3387**.
- **Overview:** a button: put your hand-1 cards on the bottom of your library in random order, then draw that many.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Draws the button; reads Global `data`; decides whether to use library zones. | TTS load | Button |
| `mindmoil(obj,ply,alt)` | 25 | Groups hand cards face down, shuffles, puts them under the library, deals the same count. | button (3) | Moves and deals cards |
| `onObjectLeaveContainer(deck,card)` | 88 | Without Global data: learns a player's deck after 7 draws from it. | TTS event | Globals |
| `onObjectEnterContainer(container,enter_object)` | 112 | Follows tracked decks into containers. | TTS event | Globals |
| `onObjectPickUp(ply, obj)` | 122 | Registers a picked-up deck for a player who was asked to. | TTS event | Global; broadcast |
| `getDeck(ply)` | 130 | The player's library deck (zone, or tracked). | `mindmoil` | May take a card (see below) |
| `getCardFromZone(zone)` | 143 | Highest Deck or gravity card in a zone; for a deck, takes its top card. | `getDeck` | `takeObject`; **calls the undefined `gravityTrigger`** |
| `getDeckFromZone(zone)` | 177 | First Deck in a zone. | `getDeck` | none |
| `handTrigger(obj)` | 189 | `use_hands=false` for 0.1 s. | `mindmoil` | Flag |
| `handOn(obj)` | 195 | `use_hands=true`. | `handTrigger` | Flag |

**Details:**
- **`onLoad`** — `useDeckZones` is true if Global `data[color].libraryZone` exists. The loop overwrites it per color, so the last color decides.
- **`mindmoil(obj,ply,alt)`**
  - No deck → broadcast (zone mode), or ask the player to pick their deck up (sets `deckSearch`) and return.
  - Hand-1 cards and decks are rotated face down. After 0.5 s: `group(cards)` (or the single card), no gravity, non-interactable, shuffle. After 1 s more: restore, shuffle, move under the deck (or the zone at y=1), lift the deck.
  - After 1 s: `getDeck(ply).deal(nCards, ply, 1)`.
  - If the hand is empty, `gr` is nil and it returns (55).
- **`getDeck(ply)`** — Zone mode: deck in the library zone, else `getCardFromZone`. If the library is a single card, that path calls `gravityTrigger`, which is undefined and errors (164, 170). The deck branch also *takes* a card off the deck just to find it.
- **`onObjectLeaveContainer`** — Ignored in zone mode. After the card settles, if it is in some player's hand 1: count draws per deck GUID; at 7 or more, `deckDats[player] = deck`.

**With the rules engine:** DISABLE (bagged Enabler; see the shared note above).

---

## River Sol Enabler

- **Object:** "[i]River Sol Enabler[/i]", GUID **b5797b**, `Custom_Token`, in bag **4f3387**.
- **Overview:** a button that draws the bottom card of your library.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Draws the button; reads Global `data`; decides the deck mode. | TTS load | Button |
| `drawBottom(obj,ply,alt)` | 25 | Lifts the deck to y=2, takes the bottom card in front of it, deals it to hand 1. | button (3) | Moves the deck; deals a card |
| `getDeck(ply)` | 55 | Library-zone deck, or the tracked deck. | `drawBottom` | none |
| `getDeckFromZone(zone)` | 65 | First Deck in a zone. | `getDeck` | none |
| `onObjectPickUp(ply, obj)` | 77 | Registers a picked-up deck for a player who was asked to. | TTS event | Global; broadcast |

**Details:** with no deck, broadcasts and (in non-zone mode) sets `deckSearch`. `takeObject{top=false, smooth=false}` at deck + forward, y=0.98. When the card stops spawning, `card.deal(1, ply, 1)`. A single remaining card (not a Deck) is not found.

**With the rules engine:** DISABLE (bagged Enabler; see the shared note above).

---

## Tovoloar Trigger

- **Object:** "Tovoloar Trigger", GUID **512015**, `Custom_Tile`, in bag **4f3387**.
- **Encoder:** no property; enables `_MTG_Simplified_UNIFIED` on cards it transforms.
- **Overview:** a day/night toggle. Switching transforms (by `setState`) every daybound/nightbound card on all playmats, plus the clicking player's Tovolar-style cards. Then it swaps its own image and reloads.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad(savedat)` | 1 | Loads `state` (1 = day, 2 = night); reads Global `data`, colors, Encoder; draws the button. | TTS load | Button; highlight |
| `makeButtons()` | 15 | Redraws the button and highlight for the current state. | `onLoad`, `switchState` | Buttons; highlight |
| `switchState(_,plyCol)` | 50 | Toggles the state, transforms matching cards, swaps its own image, reloads itself. | button (21, 36) | **`setState` on cards**; Encoder; `reload()` self |

**Details (`switchState` 50-91):**
- `state = 3 - state`; redraw.
- To day (1): `script_state='1'`. For each color's playmat objects: a Card not named "[b]Day[/b]" whose description contains "nightbound" → `setState(1)`. Because `and` binds tighter than `or`, the clicker's-playmat condition applies only to the `line2` text (58).
- On each new object: `APIencodeObject`, `APIobjEnableProp(_MTG_Simplified_UNIFIED)`, rebuild, flash.
- Then sets its own `CustomObject.image` to an img.klrmngr.com front/back URL and `reload()`s.
- To night (2): the mirror (daybound, `line1`, `setState(2)`).
- W: globals `dat`, `card`. Cards without states error inside the loop (no `pcall` around `setState`).

**Remote:** image URLs only (68, 86).

**With the rules engine:** DISABLE; `setState` swaps objects.

---

## Scrambleverse

- **Object:** "Scrambleverse", GUID **d468e2**, `Custom_Token`, in bag **4f3387**.
- **Overview:** double-click to give every nonland card on each seated player's playmat to a random seated player, laid out on that player's playmat.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Draws the button; reads Global `data`. | TTS load | Button |
| `scramble(obj,ply,alt)` | 25 | First click: announcements; second click (same second): redistribute. | button (3) | Broadcasts; prints; **moves cards between playmats** |

**Details (`scramble` 25-133):**
- Any player color without `data[color].playmat` → broadcast "only works on Pie's MTG tables" and return.
- Click counter: `os.time()` has 1 s resolution, so "within 0.5 s" (36) means "in the same clock second". On one click, after 1 s: six timed broadcasts, then `announceOff` for 10 s. With 2 or more clicks: stop that timer and continue.
- Broadcast "Enacting Scambleverse!" plus the rules text. Seed the RNG and burn 100-200 values.
- `seatedColors` = seated players. Players with a face-down "Turn Skipper" of their tint are removed (with `print` debug output, 93-96). Removing inside an `ipairs` loop can skip one.
- For each seated color except Grey/Black: every Card on its playmat whose name lacks "land" is scheduled 0.05 s apart:
  - pick a random color; highlight in the old owner's color;
  - slot `nCol[sel]` → `nDown = floor(n/10)`, `nRight = n%10`;
  - target = playmat + right×(nRight×-2.4+10.75) + forward×(nDown×3.2-8), y=1 (117-123);
  - rotation adjusted by the playmat yaw difference; smooth move.
- W: globals `color`, `nClicks`, `lastClick`, `wid`, `announceOff`, `seatedColors`, `nCol`, `skipColors`, `cardAssign`, `nCard`.

**With the rules engine:** DISABLE. REUSE the grid (117-120, 10 per row) for laying out a player's permanents.

---

## Krark's Coin Flipper

- **Object:** "Krark's Coin Flipper", GUID **2477ad**, `Custom_Tile`, inside Infinite_Bag **b35666** (each pull is a fresh copy with a new GUID).
- **Overview:** coin-flip buttons. "Krark's Thumb" mode flips two and keeps a success.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Seeds the RNG; draws 5 buttons and an X input. | TTS load | Buttons; input |
| `toggle()` | 94 | Toggles Krark's Thumb. | "Krark's Thumb?" button (80) | Button edit |
| `flip()` | 106 | One coin; appends ✓/✗ to the line. | flip loops | Globals `coin`, `coinLine` |
| `thumb()` | 111 | Two coins; success if either succeeds. | flip loops | Globals `coin1`, `coin2`, `coin`, `coinLine` |
| `printCoin()` | 122 | Broadcasts the coin line and counts; resets the line. | all flip handlers | Broadcast |
| `xCoin()` | 129 | Flips X coins (X from the input). | "Flip X Coins" (29) | Broadcast |
| `oneCoin()` | 156 | One flip. | "Flip a Coin" (17) | Broadcast |
| `manyCoin()` | 172 | Flip until a failure. | "Flip 'til Fail" (56) | Broadcast |
| `manyCoin2()` | 191 | Flip until a success. | "Flip 'til Success" (68) | Broadcast |
| `null()` | 210 | Input callback (no-op). | the X input (41) | — |

**Details:** the X input's initial value is the object's description (40). `xCoin` with a non-number broadcasts "X must be a number". Its `i = i + 1` inside the `for` has no effect. `manyCoin`/`manyCoin2` have no cap. With Thumb on, "til fail" stops only when both coins fail. Globals: `thumbToggle`, `coinStr`, `succ`, `fail`, `X`, `msg`, `rgb`, `y` (unused).

**With the rules engine:** KEEP, cosmetic. The engine's random number generator decides real flips.

---

## Bag of Tricks (also "Codie Enabler")

- **Object:** GUID **01298d**, `Custom_Token`, in bag **4f3387**. `_index.json` lists two contained objects with this **same GUID**: nicknames "Bag of Tricks" and "Codie Enabler" (copies 2). When both are taken out, TTS assigns the second a new GUID.
- **Overview:** the Cascade code with a type filter: reveal until an instant or sorcery with CMC ≤ N (default 5). The rest go to the bottom.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 1 | Loads `{CascadeCMC, deckDir}`; terms `instant`/`sorcery`; number and side buttons; caches `Encoder` (unused). | TTS load | Buttons |
| `changeDeckDir()` | 52 | Flips and saves the side. | "←/→" button (42) | Button; `script_state` |
| `updateSave()` | 65 | Saves `{CascadeCMC, deckDir}`. | several | `script_state` |
| `add_subtract(_obj, _color, alt_click)` | 70 | N ±1 (0-99). | number button (16) | Label; save |
| `updateVal()` | 79 | Redraws N. | 75, 88 | Button |
| `onNumberTyped(col,int)` | 86 | Typed N. | TTS event | Label; save |
| `groupCards(c)` | 92 | Stacks; `keepGoing2=true`. | `takeObject` callback (145) | `putObject` |
| `onCollisionEnter(co)` | 101 | Shared pattern; match = `cmc ≤ N` and the name contains a term (112-113). | TTS event | Moves cards; destructs (173) |
| `onObjectEnterContainer(container, enter_object)` | 177 | Follows `cDeck`. | TTS event | Global `cDeck` |
| `getCMC(name,desc)` | 183 | As Cascade, but called with the raw name (not punctuation-stripped). | `onCollisionEnter` | globals |

**With the rules engine:** DISABLE (library manipulation; bagged).

---

## Drop-On-Card Counter

- **Object:** "[b]Drop-On-Card Counter[/b]", template GUIDs **4f684b** (in Infinite_Bag **3c7ad3**) and **c1ae57** (in Infinite_Bag **82e64d**). `Custom_Token`. Each pull is a copy with a new GUID.
- **Encoder:** uses πCounter's propID `πCounter` (88) and its value `picounter`.
- **Overview:** a token with its own number (0-999). Drop it on a card: the card gets a πCounter with that number (and the typed-number script), and the token destroys itself.

| `name(params)` | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad(saved_data)` | 1 | Loads `picounter`; draws its buttons. | TTS load | Buttons |
| `updateSave()` | 11 | Saves `{picounter}`. | 20, 78 | `script_state` |
| `onNumberTyped(ply, int)` | 18 | Sets the number (`max_typed_number=999`, 17). | TTS event | Save; redraw |
| `createButtons()` | 24 | Draws the title, outlined number, shadow and the clickable number. | `onLoad`, 21, 79 | Buttons on itself |
| `add_subtract(obj,ply,alt)` | 74 | ±1 (0-999). | number button (66) | Save; redraw |
| `null()` | 83 | Empty callback. | label buttons | — |
| `onCollisionEnter(co)` | 89 | Records a touched card; schedules `enableCounter` next frame. | TTS event | Globals |
| `enableCounter()` | 99 | Picks the nearest recorded card (within 20 units) and applies the counter; destructs. | `Wait.frames` (95) | Destruct; broadcasts |
| `toggleProp(obj)` | 130 | Encodes the card, aligns the overlay side, enables `πCounter`, sets `picounter`, installs the card script and reloads it. | `enableCounter` | **`setLuaScript` + `reload()`** on the card |

**Details:**
- **`createButtons()` 24-72** — `clearButtons`. The title label has no `function_owner`. The outline loop reuses one table (`opars = bpars`), so each button gets the updated position. W: globals `pos`, `bpars`, `opars`.
- **`onCollisionEnter(co)` 89-97** — Cards that are not spawning and differ from the last one (`prevGuid`): append the collision and set `nRunning=0`. Resetting `nRunning` on every touch defeats the "only once" guard if two cards are touched in different frames.
- **`enableCounter()` 99-127** — `nRunning++`; return if above 1. Nearest card by distance (`obj` global; if none is within 20 it keeps the last `obj`). Requires the Encoder and the `πCounter` property, else broadcasts. Then `toggleProp(obj)` and `self.destruct()`.
- **`toggleProp(obj)` 130-151**
  - `APIencodeObject`. `cardFlip = -1` if the card's z rotation is between 90 and 270; `APIFlip` if the overlay side differs.
  - `APIobjEnableProp(πCounter)`; `APIobjSetValueData{picounter}`; `setLuaScript(script)` (the same script as πCounter 39); `obj = obj.reload()`.
  - When spawned: if face down, `hide_when_face_down=false`. `APIobjUpdateThis`; rebuild.

**With the rules engine:** COMPATIBILITY lists the drop-on counter among objects that get replaced (`setLuaScript` + `reload`). Track cards by engine ID → current GUID, and re-find them in `onObjectSpawn`.
