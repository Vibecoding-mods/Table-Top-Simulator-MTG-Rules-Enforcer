# Table functions: Global, Card Importer, deck tools

Scope: the table's own scripts for Global, the Card Importer and the deck/utility tools of "MTG 4 player table - scripted" (Steam workshop 2296042369). Our engine code is in [our-code-reference.md](our-code-reference.md).
Files are in `table-scripts/`. Line numbers ("L") refer to those files as of 2026-10-17. Verdicts follow [table-review/notes-global-importer.md](../table-review/notes-global-importer.md).

Contents:
1. `_Global.lua` and `_Global.xml`
2. Card Importer 6.6 (`_854FD9_Card_Importer_49D54F_6.6__988e5e.lua`)
3. get deck data (`get_deck_data__5912cf.lua`)
4. Deck Lister (`Deck_Lister__5006a4.lua`)
5. Tutor, get basic land, get non-basic land
6. CardCustom (`CardCustom__997547.lua`)
7. Card Size Multiplier (`Card_Size_Multiplier__d1d8be.lua`)
8. rikrassen's MTG Deck/Draft/Cube Importer (`_b_rikrassen_s_b_MTG_Deck_Draft_Cube_Importer__ddf5de.lua`)

How each function is written up:
- The heading gives `name(params)` and its lines.
- **Ret** is the return value. **By** lists the callers: TTS events, buttons, context items, XML handlers, other functions, other objects. **Calls** lists the functions it calls.
- **Does** describes the behaviour, including its branches and early returns.
- **State** lists the variables it reads (R) and writes (W). In TTS Lua an unqualified assignment creates a script global; these are flagged as "(leaks)".
- **Effects** covers spawns, moves, destroys, web requests, UI changes and broadcasts.
- **Odd** covers bugs and oddities.
- A line is left out when its answer is "none".

"Bag 4f3387" is Pie's MTG Enablers bag. Objects inside it are inert until someone takes them out. In engine mode, `tools/make-engine-copy.js:356-361` puts anything taken out of that bag straight back in.

---

## 1. `_Global.lua` (2804 lines) and `_Global.xml` (395 lines)

**What it is.** This is the table's Global script, so it is not an object. It does five jobs:
- It holds the per-colour registry `data` (zones, playmats, button objects) and turns the six button objects per seat into table buttons: Draw, Scry, Mill, Untap, Mulligan, Reveal.
- It handles hotkeys and adds context-menu items to cards and decks by zone.
- It runs the Cascade and Reveal-until-type procedures through two XML panels.
- It manages turns from chat.
- It still carries a legacy Scryfall search and deck panel that nothing opens any more.

**TTS event handlers.** These are:
- `onload` (2). This is the legacy lower-case name, which TTS still calls.
- `onPlayerDisconnect` (125), `onObjectNumberTyped` (157), `onScriptingButtonDown` (283) and `onObjectHover` (393).
- `onObjectEnterZone` (1008), `onObjectLeaveZone` (1054), `onObjectEnterContainer` (1861) and `onChat` (2156).

**Chat commands** (`onChat`, 2156). The message is lower-cased and stripped of punctuation first.
- `promote me`: a hard-coded permission for Steam ID <table author Steam ID> (2158-2164).
- `my turn` and `no my turn` (2165).
- `your turn <color>` (2170-2187).

**Buttons it creates.**
- Draw, Scry, Mill and Untap: one invisible 600×600 button on each button object (208).
- Mulligan: a 2500×850 button (231).
- Reveal: two buttons, fan on top and stack on the flipped side (250).
- ✗ and ✓ buttons on the cascaded or revealed card, plus grey backing frames (1691-1726, 2114-2149).
- `createButtons` (2506) would add "Fix Images", but nothing calls it.

**Context-menu items.**
- Global menu: "have a response" (979), "could you not" (982), "hand counts" (985).
- Library deck: "Cascade for X", "Reveal until Type", and "Get Basic Plains/Island/Mountain/Swamp/Forest/Wastes" for each basic it contains.
- Playmat card: "Make Token Copy", plus "Cascade" when the card's text mentions cascade.
- Hand card: "Sort Hand by CMC" and "Random Discard".
- `addZoneContextMenus` (954) adds these at load. The zone handlers (1008, 1054) add them again on every zone change.

**Global variables other objects read through `Global.getTable/getVar`.**
- `data`: 11 scripts, among them Card Size Multiplier, Scry, Night/Day, Upkeep Reminders, Turn Skipper, Tovoloar, Scrambleverse, Possibility Storm and River Sol.
- `deckDirs`: Possibility Storm and the EXPERIMENTAL playmat enabler.
- `gravFor`: Oath of Druids Enabler.

Other objects also store their own state in Global:
- `Encoder`: set by Encoder 02e062 (`Encoder__02e062.lua:130, 520`).
- `smartMulligan`: smart mulligan dc2d88.
- `MorphinTime`: Morphin Time.
- `savedGUIDs`: Commander Zone.
- `MTGEncoder`: read by Planechase, but nothing sets it.

**Global variables it reads but does not own.**
- `Encoder`, through the `Encoder.call` APIs: APIlistZones, APIobjectExists, APIobjGetAllData, APIobjSetAllData, APIrebuildButtons, APIencodeObject, APIobjEnableProp, APIgetFlip, APIFlip, APIobjToggleMenu, APIobjGetProps, APIobjSetProps, APIdisableEncoding, APIenableEncoding and APIformatButton.
- `smartMulligan`.
- The TTS globals `Turns.enable` and `Turns.turn_color`, which it both reads and writes.
- `Hands.disable_unused`, which it writes (17).

**Public functions other objects call.** None by `Global.call`. The only outside entry points are the XML handlers listed in §1.9.

### 1.1 Setup and registry (KEEP; REUSE `data`)

#### `onload()` — L2-40
**By** the TTS load event. **Calls** `buildDataStructure`, `registerObjectGUIDs`, `buildTableButtons`, `addZoneContextMenus` and `Encoder.call("APIlistZones")`.
- **Does:** It builds the registry, buttons and context items. It makes eight objects non-interactable inside `pcall`: cb1610, a7a029, 4c02f8, a3e6a8, 9c553c, eb479b, 3d4319 and 540e21 (Pirate Cannon) (7-9). Five frames later it does the same for 02e062 (Encoder), de4346 (Scry), d936a8 and b93b40 (Easy Modules) (10-14). It then waits until `Encoder ~= nil` and flips every Card in every zone the Encoder lists face down by setting rot z=180 (18-30). Last, it sets the 4-player layout constants (33-39).
- **State W:** `Hands.disable_unused=false`, `revealNrow=12`, `revealUp=15.5`, `revealUpS=3.1`, `revealRi=1.5`, `exileRot=-180`, `exileFor=4.16`, `gravFor=-4.14`.
- **Effects:** Changes interactable flags and rotates cards in the Encoder zones.
- **Odd:** The `pcall`s hide missing GUIDs. The load-time flip affects every card in those zones, including cards a player put there face up on purpose. The notes say to gate it.

#### `buildDataStructure()` — L43-50
**By** `onload`.
- **Does:** Resets `data` to `{White,Red,Yellow,Blue = {deck=nil}}`.
- **State W:** `data`.

#### `registerObjectGUIDs()` — L53-98
**By** `onload`.
- **Does:** Fills `data[color]` with object refs for each colour. In the order White/Red/Yellow/Blue:
  - `libraryZone`: 166036, 2365d0, 033b34, c04462
  - `graveyard`: 68549d, 07dd80, 8b439a, debc40
  - `playmat`: 8b3401, c20e3f, 129eaa, 56cd9d
  - `mulliganButton`: 3b07ae, c53ac6, 47645d, e0a3bc
  - `untapButton`: 18fb5d, 86e447, 1f3e4a, e2f7ae
  - `drawButton`: 26775a, 885f49, 305c12, b49d50
  - `scryButton`: 614515, ffa67c, 8a4c8b, 4e19c8
  - `millButton`: 57914a, da5d0d, 67b4a5, d06889
  - `revealButton`: d67eb4, 0ad181, 59ab68, c489e1
- **State W:** `data[*]`.
- **Odd:** A missing GUID stores nil, and the later index of that entry errors.

#### Top-level tables `props` (L100-116) and `deckDirs` (L118-121)
- `props[color].spawns.main/part` holds the legacy card-spawner positions (posX ±25.5 or ±22.5, posZ ±5, rotY 0 or 180).
- `deckDirs` is White −1, Red 1, Yellow −1, Blue 1. It gives the side toward which cards are fanned out of the library.

#### `onPlayerDisconnect(player)` — L125-134
**By** the TTS event.
- **Does:** For each of the player's hands, rotates every hand object to z=180 (face down).
- **State W:** `objs` (leaks).
- **Effects:** Rotates the cards in that hand.

### 1.2 Table buttons (DISABLE in engine mode)

#### `buildTableButtons()` — L137-155
**By** `onload`. **Calls** `createTableButton` ×4, `createTableButtonM` and `createTableButtonR`.
- **Does:** For each colour in `data` it creates the Draw, Scry, Mill and Untap, Mulligan and Reveal buttons. It sets `mulliganNumber=7` and `max_typed_number=99` on the draw, scry, mill and reveal objects.
- **State W:** `nAlt=3` and `drawDelay=0.1` (globals), `data[c].mulliganNumber`.
- **Effects:** Creates buttons, locks the objects and renames them.

#### `onObjectNumberTyped(obj, ply, int)` — L157-205
**By** the TTS event: the player hovers a button object and types a number.
**Calls** `getDeckFromZone`, `draw1`, `scry1`, `mill1`, `revealFan` and `revealStack`.
- **Does:**
  - For each colour it checks whether `obj` is that seat's draw, scry, mill or reveal object and `ply` is that colour.
  - It then reads the deck in the library zone and returns if there is none (165, 174, 183, 192). This `return` ends the whole loop.
  - It clamps `int` to the deck size and, when `int>0`, broadcasts "drawing/scrying/milling/revealing N cards".
  - It then repeats the action `int` times at `drawDelay` intervals with `Wait.time`.
  - Reveal uses fan mode when the object's rotation z is exactly 0 and stack mode when it is exactly 180 (196-200).
- **Ret:** nil, so TTS still applies its default number handling.
- **Effects:** Moves cards and broadcasts to the player.
- **Odd:** The exact float comparison of rotation z means a slightly tilted reveal object does nothing.

#### `createTableButton(object, name, clickFunction, ttip)` — L208-229
**Ret** the result of `createButton`. **By** `buildTableButtons`.
- **Does:**
  - It sets `tooltip=false` and `interactable=true`, locks the object and names it.
  - For Untap the tooltip is just the bold name. Otherwise it is a 3-line help: left click for 1, right click for `nAlt`, or type a number.
  - It then creates a transparent 600×600 button at y 0.1. Its click function is a Global function, because Global is the default `function_owner`.

#### `createTableButtonM(object, name, clickFunction, ttip)` — L231-248
**By** `buildTableButtons`.
- **Does:** Same as above but `interactable=false`, a 2500×850 button with hover and press colours, and a fixed "friendly/unfriendly" tooltip. `ttip` is ignored.

#### `createTableButtonR(object)` — L250-280
**Ret** two button results. **By** `buildTableButtons`.
- **Does:**
  - It rotates the object to z=0, locks it and names it "Reveal".
  - It stores `memo=os.time()` and `GMNotes='0'`, which hold the last reveal time and the reveal count.
  - It creates `revealFan` on top and `revealStack` on the underside (rotation z 180).
- **Odd:** `function_owner=self` resolves to Global here.

#### `onScriptingButtonDown(index, playerColor)` — L283-325
**By** the TTS hotkey event.
**Calls** `playerUntap`, `playerDraw`, `playerScry`, `playerMill`, `revealFan`, `revealStack`, `move2grav`, `move2exile` and `move2botLib`.
- **Does:** Each branch broadcasts "keybind N: …" to the player.
  - Index 10 (key 0) passes the turn when `Turns.enable` is on and the player is the turn colour (`Turns.getNextTurnColor`). Otherwise it turns turns on and gives the turn to that player.
  - Keys 1-9 run the matching action. 1 untap, 2 draw, 3 scry, 4 mill, 5 fan reveal, 6 stack reveal, 7 to graveyard, 8 to exile, 9 to library bottom.
- **State R/W:** `Turns.enable` and `Turns.turn_color`.
- **Odd:** Keys 1-6 index `data[playerColor]`, so a colour outside the four (Green, Black, Grey…) raises a nil-index error.

#### `move2botLib(ply)` — L327-390
**By** hotkey 9. **Calls** `group`, `getDeckFromZone`, `getCardFromZone` and `handTrigger`.
- **Does:**
  - It takes the player's selected cards and decks and flips them face down smoothly.
  - After 0.25 s, if there are two or more, it slides them to their average position and groups them. If nothing was selected it falls back to `hoveredObjs[ply]`, and it returns if the result is not a card or deck (356).
  - It makes the group non-interactable without gravity and shuffles it.
  - After 1 s it restores the flags, calls `handTrigger` for a single card, and puts the group at the library position at y=1 with the deck's rotation. It then lifts the deck by 2 so the deck falls back on top, which leaves the group at the bottom. With no deck it places the group face down on the library zone.
- **State R:** `hoveredObjs`. **W:** `targpos` (leaks).
- **Effects:** Moves cards and decks, groups them and shuffles.
- **Odd:**
  - With no deck in the zone, `getCardFromZone` (364) *takes* the top card off whatever is there.
  - `rot` (357-358) is computed and never used.
  - `shuffle()` is called three times, even on a single card.

#### `onObjectHover(ply, obj)` — L393-395
**By** the TTS event.
- **Does:** Records the hovered object for each player.
- **State W:** `hoveredObjs[ply]`. The table is defined at L392.

#### `move2grav(ply)` — L397-429
**By** hotkey 7. **Calls** `group` and `handTrigger`.
- **Does:**
  - It groups the selected cards and decks, or falls back to the hovered object, and returns if that is not a card or deck.
  - It turns off interaction and gravity. After 1 s it restores them and moves the group face up to library pos + forward×`gravFor` at y=3, with rotation y = library y + `exileRot`.
- **Effects:** Moves and groups objects.
- **Odd:** It uses `exileRot` for the graveyard rotation. It computes the graveyard spot from the library zone rather than `data[ply].graveyard`, which `mill1` uses.

#### `move2exile(ply)` — L432-464
**By** hotkey 8.
- **Does:** Same as `move2grav`, but the target is library pos + forward×`exileFor` (4.16).

#### `revealFan(button, ply, alt)` — L467-502
**By** the Reveal top button click, `onObjectNumberTyped` and hotkey 5. **Calls** `getCardFromZone`, `buttonPress` and `checkPosMove`.
- **Does:**
  - It returns unless `button` is that seat's reveal object.
  - On right click (`alt`) it flips the object to z=180 (stack mode) and returns.
  - Otherwise it presses the button, takes the top card, and returns if there is none.
  - It resets the count when more than 10 s have passed since `button.memo`. It places the card in a grid of 12 per row in front of the library: forward `revealUp + revealUpS*row`, sideways `deckDirs*2.25*(col+revealRi)`.
  - It clears the spot with `checkPosMove`, then moves the card face up, highlights it for 10 s, bumps the count in GMNotes, and broadcasts "N: name".
- **Effects:** Moves a card, writes the button's memo and GMNotes, broadcasts to all.
- **Odd:** `checkPosMove` sets `pos[2]=1` on the same table (538), so the card is sent to y=1.

#### `revealStack(button, ply, alt)` — L504-534
**By** the Reveal underside button, `onObjectNumberTyped` and hotkey 6.
- **Does:** Same guard. Right click flips the object back to z=0. Otherwise it moves the top card face up to library pos + (0,2,0) + right×`deckDirs*2.4`, which stacks the reveals. It then counts and broadcasts. There is no highlight and no `checkPosMove`.

#### `checkPosMove(pos, libZone)` — L536-562
**By** `revealFan`, `cascade`, `revealUntilType` and itself (recursion).
- **Does:**
  - It casts a 1×4×1.5 box at `pos` with y set to 1.
  - Each Card or Deck hit whose |z|>7 (that is, not on the centre strip) is pushed 3.1 units further along the library zone's local z, scaled by zone scale.
  - It recurses at the new spot first, then moves the object.
- **Effects:** Moves objects.
- **Odd:** It mutates the caller's `pos`, setting y=1. `newRelPos` aliases `relPosObj`. The recursion has no depth limit.

#### `playerMulligan(button, playerColor, alt)` — L565-640
**By** the Mulligan button. **Calls** `buttonCooldown` and `getDeckFromZone`.
- **Does:**
  - It returns unless the button belongs to the seat.
  - It counts clicks in `nMullClick`, which resets after 0.5 s.
  - If the playmat holds any card or deck and this is not a double click, it warns once per 10 s ("accidental mulligan press…") and returns (577-593).
  - Otherwise it starts a 2 s cooldown. With a library deck:
    - Left click sets the hand size to 7. Right click (the "unfriendly" mulligan) lowers it by 1, minimum 1.
    - It puts the cards from hand 1 into the deck.
    - It shuffles 7 times at 0.1 s intervals.
    - After 0.8 s it deals `mulliganNumber` cards to hand 1.
  - If `smartMulligan` is on, it shuffles up to three times until 3-4 of the top 7 names contain "land" (616-633).
- **State R:** `smartMulligan`. **W:** `nMullClick`, `mulliganSatety` (sic), `data[c].mulliganNumber`.
- **Effects:** Moves cards into the deck, shuffles, deals, broadcasts.
- **Odd:**
  - It has no London-mulligan bottoming.
  - The smart loop errors when the deck has fewer than 7 cards (`cards[i]` nil, 625).
  - The comment says 2-5 lands but the code checks 3-4.
  - It tests `obj.tag` rather than `type` (609).

#### `playerUntap(button, playerColor, alt)` — L644-710
**By** the Untap button and hotkey 1. **Calls** `buttonPress` and the Encoder APIs.
- **Does:** It returns unless the button belongs to the seat. For each card or deck on the playmat:
  - With the Encoder: a positive `mtg_stuncounter` lowers the counter by 1, rebuilds the buttons and skips the untap. `mtg_frozen` skips it. `mtg_exert` is cleared and the untap skipped.
  - For Cards, these names skip the untap: "mana vault", "basalt monolith", "grim monolith". So does a description containing "doesn't untap during your untap step". A type line containing "battle" skips it too, but without the flash.
  - A skipped card with flash on blinks a highlight 3×. Otherwise the card rotates to the playmat's y angle.
- **State W:** `flash` (leaks).
- **Effects:** Rotates cards and writes Encoder data.
- **Odd:** The exceptions are hard-coded by name.

#### `playerDraw(button, playerColor, alt)` — L713-724
**By** the Draw button and hotkey 2. **Calls** `buttonPress`, `buttonCooldown` and `draw1`.
- **Does:** Returns unless the button belongs to the seat. Left click draws 1 card. Right click draws `nAlt` (3) with a cooldown.

#### `draw1(playerColor)` — L726-733
**By** `playerDraw` and `onObjectNumberTyped`. **Calls** `getCardFromZone`.
- **Does:** Takes the top card and, once it stops spawning, deals it to hand 1.

#### `playerMill(button, playerColor, alt)` — L736-747
**By** the Mill button and hotkey 4.
- **Does:** Same pattern as `playerDraw`, using `mill1`.

#### `mill1(playerColor)` — L749-761
**By** `playerMill`, `onObjectNumberTyped` and `enterMillVal`. **Calls** `getCardFromZone` and `checkMoveSuccess`.
- **Does:** Moves the top card face up to the `graveyard` object's x,z at y=3. After 0.5 s it calls `checkMoveSuccess`, which teleports the card if it did not arrive.

#### `playerScry(button, playerColor, alt)` — L764-775
**By** the Scry button and hotkey 3.
- **Does:** Same pattern, using `scry1`.

#### `scry1(playerColor)` — L777-786
**By** `playerScry`, `onObjectNumberTyped` and `enterScryVal`. **Calls** `getCardFromZone`, `Encoder.call(APIencodeObject)` and `Encoder.call(APIobjEnableProp, "πScry")`.
- **Does:** Deals the top card to hand 2 (the scry hand) and turns on the card's πScry Encoder property.
- **Odd:** It calls `Encoder` without a nil check, so it errors if the Encoder is missing.

#### `getHand2Pos(playerColor)` — L793-800
**Ret** a Vector: hand 2 position + right × scale.x×0.55.
- **Odd:** Unused.

### 1.3 Shared helpers (REUSE as animation primitives)

#### `getCardFromZone(zone)` — L808-840
**Ret** a Card or nil. **By** move2botLib, revealFan, revealStack, draw1, mill1, scry1, cascade, moveCDeckToBot, revealUntilType.
- **Does:**
  - It picks the highest object in the zone that is a Deck, or a Card with gravity on.
  - For a Deck it calls `pcall(deck.takeObject)` (the top card). It locks the deck for 1 frame, sets `use_hands`, calls `gravityTrigger` and returns the card.
  - For a Card it sets `use_hands`, calls `gravityTrigger` and returns it. Otherwise it returns nil.
- **Effects:** Takes a card out of the deck.
- **Odd:** Cards that are moving with gravity off are skipped on purpose.

#### `getDeckFromZone(zone)` — L842-852
**Ret** the first Deck in the zone, or nil. **By** 21 call sites.

#### `buttonPress(button, T)` — L855-864
- **Does:** Moves the button object to y 0.9, then back to y 1 after max(T, 0.05) s.

#### `buttonCooldown(button, T)` — L867-875
- **Does:** Flips every button on the object (rotation z 180) for T seconds.
- **State W:** `buts` (leaks).

#### `checkMoveSuccess(card, targetPos, playerColor)` — L878-894
**By** `mill1` and `discardCard`.
- **Does:**
  - It returns if the card is gone.
  - It uses hand 2's forward axis to pick which coordinate to compare: z if |forward.z|>0.5, x if |forward.x|>0.5.
  - If the card is more than 1 unit off, it teleports it with `setPosition`.

#### `allBut(playerColor)` — L897-905
**Ret** `Color.list` without that colour. **By** `sortHands`.

#### `unhide(card)` — L906-910
- **Does:** `setHiddenFrom({})`.
- **Odd:** Unused.

#### `gravityTrigger(obj)` and `gravOn(obj)` — L913-918, 919-923
- **Does:** Turns gravity off, then back on after 0.2 s.

#### `interactTrigger(obj)` and `interactOn(obj)` — L925-930, 931-935
- **Does:** Turns `interactable` off for 0.2 s.
- **Odd:** Unused; the calls at 729 and 754 are commented out.

#### `handTrigger(obj)` and `handOn(obj)` — L937-942, 943-947
- **Does:** Turns `use_hands` off for 0.1 s, so a card that moves past a hand zone is not pulled into it.

#### `null()` — L949-950
**By** the cascade frame buttons and the get-deck-data label buttons, both through the default owner, Global.
- **Does:** No-op click target.

### 1.4 Context menus and zone handlers (GATE FIRST)

#### `addZoneContextMenus()` — L954-976
**By** `onload`. **Calls** `addLandContextMenus`.
- **Does:** At load, for each colour it adds items:
  - Library decks, unless the name contains "planechase": "Cascade for X", "Reveal until Type" and the land items.
  - Playmat cards: "Make Token Copy", plus "Cascade" when the description contains "cascade".
  - Hand-1 objects: "Sort Hand by CMC" and "Random Discard".

#### Global context items — L979-993 (anonymous; KEEP)
- "have a response" broadcasts "<steam name> has a response!" in the player's colour.
- "could you not" broadcasts a canned quote.
- "hand counts" sends the player one line per player with the hand count, zero-padded, in that player's colour.

#### `onObjectEnterZone(zone, obj)` — L1008-1052 and `onObjectLeaveZone(zone, obj)` — L1054-1098
**By** the TTS events. **Calls** `Encoder.call(APIlistZones)` and `addLandContextMenus`. The two bodies are identical.
- **Does:**
  - It returns for anything that is not a card or deck, and for names containing "planechase".
  - For each zone the object is now in, it checks for an Encoder zone whose name matches `_1` (the hand), a playmat, or a library zone.
  - It then calls `obj.clearContextMenu()` and re-adds the items for that zone, as in `addZoneContextMenus`.
  - A deck in a library zone also gets `setScale({1,1,1})`.
- **Effects:** Wipes **all** context items on the object, including the engine's. Rescales library decks.
- **Odd:** It calls the Encoder's `APIlistZones` once per zone per event, which is costly on mass moves.

#### `addLandContextMenus(deck)` — L1100-1143
- **Does:** Scans the deck's names after lower-casing and stripping punctuation. For each basic land type it finds a name containing "basic", "land" and that type, and adds "Get Basic <Type>".

#### `deckRampW(ply)`, `deckRampU(ply)`, `deckRampR(ply)`, `deckRampB(ply)`, `deckRampG(ply)`, `deckRampWa(ply)` — L1145-1161, 1163-1179, 1181-1197, 1199-1215, 1217-1233, 1235-1251 (DISABLE)
**By** the "Get Basic …" context items.
- **Does:** Returns without a library deck. Otherwise it takes the first matching basic face up and places it `deckDirs*2.4` to the side, then shuffles the deck 5 times at 0.1 s.
- **Effects:** takeObject and shuffle.
- **Odd:** The six functions are copy-pasted. The context-menu player argument is a colour, so a non-seat colour errors.

#### `toggleEncMenu(ply)` — L1254-1270
- **Does:** For the selected objects it locks each one, encodes it, syncs the Encoder flip with the card's z rotation, toggles the πMenu and rebuilds its buttons, then unlocks after 1 frame.
- **State W:** `objs` (leaks).
- **Odd:** Unused; the context item is commented out (1002, 1033).

#### `cardToken(ply)` — L1272-1296 (DISABLE)
**By** the "Make Token Copy" item.
- **Does:**
  - It takes the first selected object, clears the selection, and returns unless it is a Card.
  - It copies `getData()` with the position 3.2 toward the player and y+0.1, and reads the Encoder flip, props and values.
  - It calls `spawnObjectData`. When the copy has spawned it re-applies the Encoder data, flips it if needed, enables `MTG_Token` and rebuilds the buttons.
- **State W:** `objs` and `card` (leak).
- **Effects:** Spawns a card.
- **Odd:**
  - `Wait.Condition` at 1287 has a capital C. The TTS API is `Wait.condition`, so the Encoder copy step probably errors after the spawn.
  - `objs[1]` is nil when nothing is selected, which errors at 1276.

#### `cardCascade(ply)` — L1298-1320 (DISABLE)
**By** the "Cascade" item. **Calls** `getCMC` and `cascade`.
- **Does:**
  - It works only when the selected card is on the player's own playmat.
  - It computes `val = CMC − 1`. When `val>=0` and there is a deck, it flips the deck face down and cascades for `val`.
- **Odd:** It has the same nil-selection risk as `cardToken`. `getCMC` returns a string, and `cmc-1` relies on Lua string coercion.

#### `sortHands(ply)` — L1323-1387 (KEEP; cosmetic)
**By** the "Sort Hand by CMC" item. **Calls** `getCMC` and `allBut`.
- **Does:** For each of the player's hands:
  - It collects CMCs; a missing CMC becomes '-2' and sets `noCMCs`. It sorts the cards numerically.
  - **If any card lacks a CMC:**
    - It tells the player to use Deck Lister or the Deck Data Fetcher.
    - It pings GUIDs 6d07c3, 5006a4, 6d46cd and 6ed442. Only 5006a4 (Deck Lister) is a scripted object in this save.
  - **Otherwise:**
    - It hides each card from the other players and locks it, then moves it to the sorted slot positions.
    - When nothing is smooth-moving any more, it unlocks the cards, snaps them into place, and unhides them 20 frames later.
- **State W:** `noCMCs` and `cmc` (leak).
- **Effects:** Moves hand cards, hides them briefly, broadcasts.

#### `randomDiscard(ply)` — L1389-1405 (DISABLE)
**By** the "Random Discard" item. **Calls** `discardCard`.
- **Does:**
  - It highlights random cards from hand 1 20 times at 0.1 s. After 2 s it flashes the final pick red 10 times. At 3 s it discards the pick.
- **Odd:** An empty hand errors: `math.random(0)`.

#### `discardCard(card, playerColor)` — L1407-1416
**Calls** `handTrigger` and `checkMoveSuccess`.
- **Does:** Turns the card face up, moves it to the graveyard object at y 3 after 0.2 s, and checks the move at 0.5 s.

### 1.5 Cascade and the value panel (DISABLE; REUSE the ✓/✗ pattern)

#### `deckCascade(ply)` — L1460-1483
**By** the "Cascade for X" item.
- **Does:**
  - If `GetValuePanel` is open for another colour, that colour keeps it unless `ply` holds `Turns.turn_color`. In that case both players are told, and the function returns.
  - Otherwise it clears the `repeatCascadeX` and `CMinput` fields and shows the panel to `ply` only with the text "enter CMC to cascade for".
- **Effects:** Global UI attributes and broadcasts.
- **Odd:** The commented-out `deckScry` and `deckMill` (1420-1458) were the only other users of this panel.

#### `CMgetVal(ply, txt)` — L1485-1487
**By** XML `CMinput onEndEdit`.
- **State W:** `CMVal`.

#### `CMcancel(ply)` — L1489-1491
**By** the XML ✗ button.
- **Does:** Hides `GetValuePanel`.

#### `CMokay(player)` — L1493-1516
**By** the XML ✓ button and `CMinput onSubmit`. **Calls** `enterScryVal`, `enterMillVal` and `enterCascadeVal`.
- **Does:**
  - It hides the panel.
  - It returns with a broadcast when the player's colour is not one of the four, or when there is no library deck.
  - It returns when `CMVal` is empty.
  - Otherwise it routes by the `CMtext` attribute: scry, mill or cascade.
- **State W:** `ply` (leaks). **R:** `CMVal`.
- **Odd:** `CMVal` only updates on end-edit, so a stale value from a previous use can be applied.

#### `enterScryVal(deck, ply, CMVal)` — L1518-1534 and `enterMillVal(deck, ply, CMVal)` — L1536-1552
- **Does:** Clamps the value to the deck size with a broadcast. When the value is above 0 it flips the deck face down and repeats `scry1` or `mill1` the value times. Otherwise it broadcasts "strange value".
- **Odd:** Reachable only if `CMtext` says scry or mill, which nothing sets now. The XML default text is "scry", but the panel is only ever opened by `deckCascade`.

#### `enterCascadeVal(deck, ply, CMVal)` — L1554-1565
- **Does:** When the value is ≥0 it flips the deck face down and calls `cascade`. Otherwise it broadcasts.
- **Odd:** `maxVal` is unused.

#### `cascade(deck, playerColor, CMC)` — L1569-1729
**By** `cardCascade`, `enterCascadeVal`, and `acceptCascade`/`declineCascade` when repeating.
**Calls** `getCMC`, `checkPosMove`, `getCardFromZone` and the Encoder APIs.
- **Does:**
  - **Early returns:**
    - while `doneCascading==false`;
    - when there is no deck;
    - when a previous `cardToPlay` is still waiting (broadcast).
  - **Search:** It walks `deck.getObjects()` from the top, counting `nCards`.
    - If any card checked before the hit has no CMC, it broadcasts, pings the helper GUIDs and returns.
    - A card counts as a hit when it is not a land (CMC '-1') and its CMC ≤ `CMC`.
    - With no hit it broadcasts, clears both repeat counters and returns.
  - **Clear the area:** It casts a 5×4×3 box beside the library and pushes the cards and decks there forward or back with `checkPosMove`.
  - **Deal out:** It broadcasts "cascading for CMC=…" (with "i/X" when repeating). It then deals `nCards` cards one per `drawDelay`:
    - the first `nCards−1` go face up into a pile at `2.5*deckDir`, and the first of them is remembered as `cDeck`;
    - the last goes to `5*deckDir` as `cardToPlay`, highlighted for 10 s.
  - **Prompt:** After `nCards*drawDelay+0.75` s:
    - It sets `doneCascading` once `cardToPlay` rests.
    - It encodes and then disables encoding on `cardToPlay`, and writes the owner colour to its GMNotes.
    - It adds a grey frame and a ✗ (`declineCascade`) button, and a frame and a ✓ (`acceptCascade`) button.
- **State W:** `nCards`, `cardFound`, `cmc`, `isLand`, `libZone`, `libPos`, `cDeck`, `cardToPlay`, `deckDir`, `doneCascading`, `repeatSearchX`, `repeatCascadeX` (all leak). **R:** `repeatN`.
- **Effects:** Moves many cards and other objects, adds buttons, broadcasts.
- **Odd:**
  - The search relies on "N CMC" text in names or descriptions.
  - `forgpars=backpars` aliases and mutates the frame table after it is used, which is harmless.
  - `Encoder.call` has no nil check.

#### `acceptCascade(card, ply)` — L1731-1768
**By** the ✓ button on the card. **Calls** `moveCDeckToBot`, `revealUntilType` and `cascade`.
- **Does:**
  - It returns unless `ply` matches the owner in GMNotes.
  - It clears `cardToPlay`, re-enables encoding, clears the GMNotes and buttons, and sends the other cascaded cards to the bottom.
  - When repeating it bumps `repeatN` and, after 1 s, runs the next search or cascade. It runs the cascade with `tonumber(CMVal)`.

#### `declineCascade(card, ply)` — L1770-1821
**By** the ✗ button.
- **Does:**
  - The guard and cleanup match `acceptCascade`.
  - With `cDeck`, it moves the card onto the pile and, after 1 s, sends the pile to the bottom; the wait before repeating becomes 2 s.
  - Without one, it moves the card to the library position at y 0.96, face down.
  - The repeat logic matches `acceptCascade`.
- **Odd:** The no-pile path does not lift the deck, so the card can land on top rather than at the bottom.

#### `UIrepeatCascade(player, val, id)` — L1823-1826
**By** XML `repeatCascadeX onEndEdit`.
- **State W:** `repeatCascadeX=tonumber(val)` and `repeatN=0`.

#### `moveCDeckToBot(cDeck, ply)` — L1828-1858
- **Does:**
  - It falls back to `cDeckBackup` when `cDeck` is nil, clears the pile's buttons, flips it face down and shuffles it.
  - After 0.25 s it sets `doneCascading=true` and shuffles again. With a library deck it moves the pile to the deck's spot and lifts the deck by 2, so the pile ends at the bottom. With no deck it places the pile face down on the zone.
  - It sets the parameter `cDeck` to nil, which is a local, not the global.
- **Odd:** It errors if both `cDeck` and `cDeckBackup` are nil.

#### `onObjectEnterContainer(container, enter_object)` — L1861-1886
**By** the TTS event.
- **Does:**
  - Every Card that enters any container is un-hidden, with `use_hands` and `use_gravity` turned back on.
  - Then, while `cDeck` is set:
    - It clears `cDeck` if the container or the object is any seat's library deck.
    - If `cDeck` itself enters a container, it rebinds `cDeck` to the new container once that container has spawned.
    - When cascading is finished it moves `cDeck` into `cDeckBackup`, for when players put the pile back by hand.
- **State W:** `cDeck` and `cDeckBackup`.
- **Odd:** The un-hide runs for every container. Engine-hidden cards entering a deck lose their hiding.

#### `getCMC(name, desc)` — L1888-1907
**Ret** a string CMC, '-1' for lands, number 0, or nil. **By** `cardCascade`, `sortHands` and `cascade`.
- **Does:** Tries the patterns "N cmc" and "cmc N" on the name, then on the description. A land (name contains "Land", case-sensitive) with no CMC or 0 gives '-1'. Suspend, "pact" or "evermind" with no CMC gives 0.
- **State W:** `cmc` and `isLand` (leak).
- **Odd:** The return type is mixed: string or number.

### 1.6 Reveal until type (DISABLE)

#### `deckSeachType(ply)` — L1912-1944 (sic)
**By** the "Reveal until Type" item.
- **Does:**
  - It applies the same one-user lock as `deckCascade`, on `SearchTypePanel`.
  - It resets the toggles to off with white text, clears the custom type and repeat fields, and shows the panel to `ply`.
- **State W:** `searchTypeVect` (7 types false), `seachTypeCustom=''`, `repeatSearchX=nil`.

#### `STcancel(ply)` — L1946-1948
- **Does:** Hides the panel.

#### `STokay(player)` — L1950-1972
**Calls** `enterSearchTypes`.
- **Does:** Hides the panel. It runs the same colour and deck checks as `CMokay`, then builds `searchTypes` from the toggles plus the custom type.
- **State W:** `ply` and `searchTypes`.

#### `UItypeToggle(player, val, id)` — L1974-1976
**By** the XML type toggles.
- **State W:** `searchTypeVect[id] = (val=="True")`.

#### `UItypeCustom(player, val, id)` — L1978-1980
- **State W:** `seachTypeCustom`.

#### `UIrepeatSearchType(player, val, id)` — L1982-1985
- **State W:** `repeatSearchX` and `repeatN=0`.

#### `enterSearchTypes(deck, ply, searchTypes)` — L1987-1996
- **Does:** With at least one type, flips the deck face down and calls `revealUntilType`. Otherwise it broadcasts.

#### `revealUntilType(deck, playerColor, searchTypes)` — L1998-2152
- **Does:** The flow matches `cascade`. A hit is a nickname that contains any search type, case-insensitive, as a substring.
- **State W:** the same globals as `cascade`, plus `types`.
- **Odd:** It returns while `cardToPlay` is pending but does not check `doneCascading`. The substring match is loose: "land" also matches names such as "Highland…".

### 1.7 Chat (DRIVE `Turns` FROM ENGINE; REMOVE THE HARD-CODED PERMISSION)

#### `onChat(message, pl)` — L2156-2188
**By** the TTS chat event.
- **Does:** It lower-cases the message and strips punctuation. Then:
  - **Hard-coded permission (2158-2164):** if the message is "promote me" and `pl.steam_id=='<table author Steam ID>'`, it promotes the player when they are not already promoted or admin, moves them to Black, and returns false, which hides the message.
  - "my turn" or "no my turn" sets `Turns.enable=true` and gives the turn to the speaker.
  - "your turn X" capitalises X. If X is a table colour with a seated player, it gives X the turn.
- **Ret:** false only on the hard-coded path. Otherwise nil, so the message still shows.
- **State W:** `Turns.*`, `colStr`, `isColor`.

### 1.8 Legacy Scryfall spawner and deck panel (dead code)

#### `show(obj, color, alt)` — L2194-2204
- **Does:** Would open `SearchPanel`, `ListPanel` (on right click) or `<color>Counter` for objects named "MTG Importer" or "MTG Counter".
- **Odd:** Unused. No such objects exist, and the `<color>Counter` panels are not in `_Global.xml`.

#### `close(player, value, id)` — L2206-2214
**By** the XML close buttons. **Calls** `visibleCloseRules`.
- **Does:** Hides the matching panel for this player.

#### `search(player)` — L2216-2270
**By** the XML Search button.
- **Does:** Builds a Scryfall query from the name, CMC, power and toughness fields, the colour toggles (inverted: "False" means included), and the token/emblem toggles. It sends `GET https://api.scryfall.com/cards/search?...`, which is answered by `objectProccessor`.
- **Odd:**
  - `string.sub(q,1,2)=="+"` can never be true (2262), so a leading "+" is kept.
  - With all colours included, `xColors[1]` is nil, so `~= ""` is true and the query gets an empty `+(-c:)` (2243-2245).

#### `objectProccessor(webReturn, player, isPart)` — L2272-2293
- **Does:**
  - An error prints "Scryfall server error" and runs `errorJson`.
  - With no `"object"` field it runs `errorJson`.
  - Otherwise it routes on the object type: a list goes to `listJson`, an error to `errorJson`, a card to `cardJson`. A part goes straight to `cardJson`.

#### `listJson(json, player)` — L2295-2299
- **Does:** Fetches the first `"uri"` in a search list, so it only ever spawns the first result.

#### `setOracle(c)` — L2301-2310
**Ret** the oracle text with `"`→`'`, plus `\n[b]P/T[/b]` or loyalty, or `[b][/b]` when there are no stats.

#### `cardJson(json, type, player, isPart)` — L2312-2368
**Calls** `JSONdecode`, `setOracle` and `spawn`.
- **Does:**
  - For a DFC (type "card") it takes the face and back from `card_faces`, swapping them when the URLs are reversed. For type "deck" it takes only the face.
  - It builds the name as "Name\nType NCMC" and the oracle text per face.
  - It calls `spawn`. If this is not a part, it fetches each `all_parts` entry other than itself: only Emblem combo pieces, plus every non-combo part.
- **State W:** `face` and `back` (leak).
- **Effects:** Web requests and spawns.

#### `errorJson(json, player)` — L2370-2377
- **Does:** Prints "no match" on a 404, otherwise `details`.

#### `getOracle(json)` — L2379-2390
**Ret** the concatenated oracle text with P/T and loyalty.
- **Odd:** Unused except for its own recursion.

#### `spawn(oracleID, name, oracle, face, back, player, isPart)` — L2392-2415
- **Does:** Builds a Card JSON string by string concatenation at `props[color].spawns` and calls `spawnObjectJSON`.
- **Odd:**
  - The positions are swapped: a part goes to `main` and a non-part to `part` (2396-2400).
  - Nothing is JSON-escaped, so newlines and backslashes in the text can break the JSON.
  - A Grey or other colour without `props` errors.

#### `getDeckList(player)` — L2417-2435
**By** the XML Import button.
- **Does:** For each line of `vDeckList` in the form "N name", it fuzzy-looks-up Scryfall (`cards/named?fuzzy=`) and calls `getDeck`. An empty list broadcasts "Deck is empty".
- **Odd:** The first line that does not start with a digit `return`s, which aborts the rest of the list.

#### `getDeck(webReturn, cardCount, player)` — L2437-2451
- **Does:** Handles errors as above, otherwise calls `cardJson(...,"deck")` `cardCount` times.

#### `updateText(player, value, id)`, `updatevColor(player, value, id)`, `updateType(player, value, id)` — L2453-2455, 2457-2459, 2461-2470
**By** the XML fields and toggles.
- **Does:** Echo the value back into the attribute. `updateType` makes the three toggles exclusive.

#### `visibleOpenRules(color, id)` — L2472-2486
- **Does:** For colours other than Grey, adds the colour to the panel's `visibility` list and activates the panel.

#### `visibleCloseRules(player, id)` — L2488-2503
- **Does:** Removes the player's colour from the list. If it was the only one, it deactivates the panel.

#### `createButtons(obj)` — L2506-2522
- **Does:** Would add a "Fix Images" button through the Encoder's `APIformatButton`.
- **State W:** `enc`, `flip`, `scaler`, `temp`, `barSize`, `fsize`, `offset_x`, `offset_y`.
- **Odd:** Unused. It passes `font_size=fSize` while the variable assigned is `fsize`, so the font size is nil (2518).

#### `fixDeck(obj, color)` — L2524-2542
- **Does:** The click target of the button above. It would re-fetch every card in a deck, or a single card, from Scryfall and spawn new copies.
- **Odd:** Unreachable.

#### `encodeChar(chr)` — L2545-2547 and `encodeString(str)` — L2549-2552
- **Does:** Percent-encode every non-alphanumeric character.

#### `JSONdecode(txt)` — L2615-2722
**Ret** a table.
- **Does:**
  - Anything that is not a Scryfall card or list goes to `JSON.decode`.
  - A list decodes each card. A card is parsed by hand: `all_parts` (up to 31), `card_faces` (up to 5), then the keys in `normal_card_keys`, in order.
- **Odd:**
  - In the list branch, `local cardEnd` (2634) shadows the outer variable, so every iteration finds the same first card.
  - `'loyalty'` is listed twice (2578, 2581).
- Uses the key tables `normal_card_keys`, `image_uris_keys`, `related_card_keys` and `card_face_keys` (2563-2611).

#### `getNextCardDatFromList(txt, startHere)` — L2726-2753
**Ret** card, start, end.
- **Odd:** Unused. The comment says `startHere` is global, but it is a parameter (2746).

#### `findClosingBracket(txt, st)` — L2756-2775
**Ret** the index of the matching `}` or `]`.
- **Odd:** When no match is found, `txt:sub(nil)` errors before the nil check at 2766 can run.

#### `getKeyValue(txt, key, st)` — L2778-2804
**Ret** value, end index.
- **Does:** Handles a number, a string (unescaping `\"` and `\n` and dropping `\uXXXX`), or the `image_uris` sub-table.
- **Odd:** For `image_uris`, `local val,s` (2788) shadows `s`, so `en` is the key's start position.

### 1.9 `_Global.xml` panels and handlers

| Panel (lines) | Element id → handler |
|---|---|
| `SearchTypePanel` (1-191): draggable; `active=False` | `typeCustom` onEndEdit→`UItypeCustom`. Toggles `land`, `creature`, `artifact`, `enchantment`, `planeswalker`, `instant`, `sorcery`→`UItypeToggle`. `repeatX` onEndEdit→`UIrepeatSearchType`. ✓→`STokay`, ✗→`STcancel` |
| `GetValuePanel` (193-278) | `CMtext` holds the prompt text, which routes `CMokay`. `CMinput` onSubmit→`CMokay`, onEndEdit→`CMgetVal`. `repeatCascadeX` onEndEdit→`UIrepeatCascade`. ✓→`CMokay`, ✗→`CMcancel` |
| `<Defaults>` (281-291) | Classes for the legacy panels |
| `SearchPanel` "MTG Card Spawner" (292-367; dead) | `closeButton`→`close`. `vName`, `vCmc`, `vPower`, `vToughness`→`updateText`. `vWhite`…`vColorless`→`updatevColor`. `vToken`, `vEmblem`, `vOther`→`updateType`. `search`→`search` |
| `ListPanel` "MTG Deck Importer" (371-395; dead) | `ListCloseButton`→`close`. `vDeckList`→`updateText`. `ListImport`→`getDeckList` |

Note: rikrassen's importer rewrites this whole XML table with `UI.setXmlTable` (§8).

### 1.10 How it fits with the rules engine
Split verdict:
- **REUSE:** the `data` registry and the animation helpers (`getCardFromZone`, `setPositionSmooth` with `checkMoveSuccess`, `buttonPress`/`buttonCooldown`, `checkPosMove`, the fan maths).
- **KEEP:** `onload` (gate its flip), `onPlayerDisconnect`, the Global context items and Sort Hand.
- **DISABLE in engine mode:** the table buttons, hotkeys, Cascade, Reveal-until-type, Get Basic, Token Copy and Random Discard.
- **GATE FIRST:** the zone handlers.
- Drive `Turns` from the engine and remove the hard-coded permission. The legacy Scryfall panel is dead code.

---
## 2. Card Importer 6.6: `[854FD9]Card Importer [49D54F]6.6`, GUID 988e5e, loose on the table (Custom_Model)

**What it is.** Amuzet's importer, rewritten by Vokerr and Pie (4064 lines). It spawns cards, tokens, decks and alternate-art previews from chat commands and from Encoder buttons on cards. It does not use the Scryfall API at runtime. Instead it uses three hosts:
- Images: `img.klrmngr.com` (Kai CDN, L44).
- Card index: `raw.githubusercontent.com/Oops-I-baked-a-pie/…/Magic/CardIndex` (L48). This holds `card-index.json` and the record, name, set-collector, oracle-id, printings and fuzzy-word shards.
- Token metadata and UI arrows: `pub-6c935b50ab2c43f291df08b7f566585b.r2.dev` (L45). This holds the token shards, `token-cdn-defaults.json` and the parents-by-name shards.

Decks can also come from:
- archidekt.com and api2.moxfield.com;
- deckstats, pastebin, mtgdecks, deckbox, tappedout, mtggoldfish and cubecobra, through `DeckSites`.

**TTS event handlers:** `onSave` (3884), `onLoad` (3885), `onDestroy` (3888), `onChat` (3910).

**Chat commands.** A message counts when it starts with `Scryfall` or `Importer` (any case, optional `!`; parsed at 3900). The rest is:

| Rest | Effect |
|---|---|
| `help` | Prints `Usage` (3849) to the player. Returns false, which hides the message |
| `hide` | Admin only. Toggles `chatToggle`; when on, importer messages are hidden |
| `promote me` | Host only. `p.promote()` |
| `clear queue` | `self.reload()` |
| `token debug` | Runs `debugTokenResolution` on the hovered card |
| `token <name>` | Runs `spawnTokensForName` |
| `token` | Runs `spawnTokensForCard` on the hovered card |
| `deck <url>`, `deck` | `Importer.Deck`. Bare `deck` reads the newest Notebook tab |
| `print <name>` | Alternate-art previews |
| `text <name>` | Oracle text, written onto the hovered object or sent to the player |
| `rawdeck` | Deck list taken from the hovered object's description |
| `front <url>` | Replaces the hovered custom card's face |
| `spawn …` or anything else | Spawns a card. Accepts a fuzzy name, `oracleid:<id>`, a UUID, `name (SET) num`, `name [SET:num]`, `name&set=xxx`, or `<image url> [name]` |

**Buttons it creates.**
- Encoder menu buttons on cards: "Respawn", "Emblem\nAnd Tokens" and "Printings" (`toggleMenu`, 4054). They call `eRespawn`, `eEmblemAndTokens` and `ePrintings`.
- Invisible click buttons on alt-art preview cards (`altArtPreviewClick`) and on the nav arrows (`altArtPreviewNextPage` and `altArtPreviewPrevPage`).

It adds no context-menu items.

**Global variables.**
- It reads `Encoder` (3998, 4054). It writes no Global variables.
- Object-level globals: `mod_name`, `version`, `textItems`, `newText`, `Card`, `Importer`, `MODES`, `setCSV`, `deckDat`, `pID`, `enc`, `buttons`, `flip`, `Button`, `charEncoder`, `success`, `errorMSG`.
- File locals: `Deck`, `Tick`, the CDN URLs and every shard cache.

**Public functions other objects call.**
- `Importer(tbl)`: called by Easy Modules with `.call('Importer', …)` (`_FFCC00_…b93b40.lua:2317, 2356`). Its re-import uses `full='Reimporting Card'`.
- `getVar('version')`: read by Easy Modules (b93b40:2270).
- `toggleMenu`: the Encoder property's `activateFunc`.
- `eRespawn`, `eEmblemAndTokens`, `ePrintings`: button targets.
- `ReImport(tar, ply, alt)`: a compatibility shim that nothing in this save calls. Easy Modules has its own `ReImport`.

Easy Modules can also overwrite this object's `script_code` ("force importer update", b93b40:104-114); see the review notes, security item 2.

**Request flow (queue).**
1. `onChat` builds `tbl` and calls `Importer(tbl)`.
2. `__call` (3800) spawns a status text and queues the request. When it is first in line, it dispatches to `Deck`, `Spawn` or `t[mode]`.
3. Each finished path calls `endLoop()` (3874). That removes the head, deletes its text and calls `Importer()` again to run the next request.
4. Requests with `standalone=true` (Encoder buttons, token chat) bypass the queue.

### 2.1 Chat, commands and plumbing

#### `newText(p, text, f, color)` — metatable `__call` L13-38 (object `newText`, L9-38)
**Ret** a closure `function(t)` (L26-37). **By** `Importer.__call` (3819).
- **Does:** Spawns a 3DText object at `p`. With a colour, it faces that player (rotation y = pointer rotation + 180) and uses that colour. It stores the object in `textItems` and sets the text and font size (default 50). The returned closure `t(str)` updates the text; `t()` removes the object from `textItems` and destroys it.
- **Effects:** Spawns or destroys a 3DText.

#### `WebGetSSL(url, callback, headers, timeoutSec)` — L118-134
**By** every fetcher. **Calls** `WebRequest.custom` (GET).
- **Does:** Starts a timeout (default `WEB_GET_TIMEOUT`=15 s) that fires `callback({is_error=true,error='Timeout…'})`. A `settled` flag makes sure the callback runs exactly once. The default headers are User-Agent `TTS-MTG-Card-Importer/6.6` and Accept JSON.
- **Effects:** Web request.

#### `TokenWebGetSSL(url, callback, headers)` — L136-138
- **Does:** `WebGetSSL` with a 6 s timeout (`TOKEN_WEB_TIMEOUT`). The "fast" paths use it.

#### `chatTargetFromPlayer(p)` — L140-147
**Ret** the hovered object, or the object hit by `p.castRay()` (pcall), or nil. **By** `tokenChatTable` and `onChat`.

#### `tokenChatTable(p, mode, full)` — L149-159
**Ret** `{position=pointer, target, player=steam_id, color, mode, full, standalone=true}`. **By** `onChat` (3928, 3932, 3940).

#### `webRequestFailed(wr, qTbl, source)` — L518-527
**Ret** true or false. **By** `fetchArchidektDeck` and `fetchMoxfieldDeck`.
- **Does:** On an error or an empty body it broadcasts "<source> failed: <msg>" in red, calls `endLoop()` and returns true. A message containing "404" becomes "Deck not found. Is it public?".

#### `safeJSON(text)` — L2746-2751
**Ret** the decoded table, or nil for an empty body, an HTML body or a decode error. **By** every shard and deck fetcher.

#### `decodeQueryName(raw)` — L1309-1312
**Ret** the string with every `%XX` decoded. **By** 13 call sites. It undoes the encoding that `onChat` applied (3969-3988).

#### `failNotInCache(qTbl, label, suggestions, matchedName)` — L1589-1603
**By** `spawnFromCdnQuery`, `spawnTokensForName`, `Spawn`, `Print` and `Text`.
- **Does:** Broadcasts one of three messages: "matches several cards. Did you mean: 1… 2…", "looks like X, but … not in the card index yet", or "not found. Use a deck URL…". It calls `endLoop()` unless the request is standalone.

#### `endLoop()` — L3874-3880
**By** about 30 sites.
- **Does:** If a request is queued, it calls the head's text closure (destroying the text) and removes it. It then calls `Importer()` with no table, which dispatches the next request.
- **Effects:** Destroys the status text.

#### `uNotebook(t, b, c)` — L3881-3883
**Ret** the tab index. **By** `spawnDeck` and `spawnCSV`.
- **Does:** Adds a Notebook tab, or edits the one with the same title (default colour Grey).
- **Effects:** Notebook.
- **Odd:** It returns −1 when it adds a new tab.

#### `onSave()` — L3884
- **Does:** `self.script_state=''`, so nothing persists.

#### `onLoad(data)` — L3885-3887
- **Does:** Preloads the token defaults (`loadTokenDefaults`). Module registration happens separately, through a top-level `Wait.time(registerModule, 1)` (4063).

#### `onDestroy()` — L3888-3893
- **Does:** Clears all alt-art previews (`clearAllImporterPreviews`) and destroys every status text.

#### `parseImporterChatArgs(message)` — L3900-3908
**Ret** the trimmed rest after `Scryfall`/`Importer` (optional `!`, any case), or nil when the rest is empty.

#### `onChat(msg, p)` — L3910-3993
**By** the TTS chat event. **Calls** `parseImporterChatArgs`, `debugTokenResolution`, `spawnTokensForName`, `spawnTokensForCard`, `tokenChatTable` and `Importer`.
- **Does:**
  - It returns when the message is not an importer command.
  - Its branches follow the command table above. `hide` (case-sensitive) needs `p.admin`. `promote me` needs `p.host`. `token debug` and `token` warn when the queue is busy but run anyway.
  - **Default branch:**
    - It extracts the first URL; quotes and angle brackets are tolerated.
    - It builds `tbl` with `position` (pointer; {0,2,0} for Grey), `target`, `player`, `color`, `url`, `mode` (first word), `name` and `full`.
    - It matches the mode case-insensitively against the `Importer` function keys, then removes the first match of the mode word from the lower-cased name.
    - An empty name becomes `'blank card'`. Otherwise it drops one leading space and percent-encodes 17 characters through the global `charEncoder`.
    - It then calls `Importer(tbl)`.
- **Ret:** false for help, token and debug. Otherwise false only when `chatToggle` is on.
- **State W:** `chatToggle` (file local) and `charEncoder` (leaks).
- **Odd:**
  - The name is lower-cased.
  - Mode removal uses a Lua pattern, so it removes the first occurrence anywhere in the name.
  - The importer also answers "promote me", but only for the host, unlike Global's hard-coded permission.

#### `Importer.__call(t, qTbl)` — L3800-3844 (`Importer` table L3639-3844)
**By** `onChat`, `ENC`, `resolveAltArtPreview` (indirectly through `Card`), `endLoop` (no table), and Easy Modules through `.call`.
- **Does:**
  1. A re-import request (`isExternalReimportRequest`) is fulfilled right away.
  2. A standalone request is dispatched right away:
     - with a url: `Deck`, and if that returns false, set `Card.image=url` and `Spawn`;
     - otherwise `t[mode]`, or `Spawn`.
  3. Otherwise the request gets a status text (`newText`), joins `t.request` and is logged.
  4. With 13 or more queued requests it broadcasts "Clearing…" and calls `endLoop()`. With 2 or more it broadcasts "Queueing request N", plus hints from the 3rd or 4th request.
  5. If the head exists, it dispatches the head as in step 2. A re-import head also calls `endLoop()`.
  6. With a `qTbl` and no head it broadcasts "Importer did not get a mode".
- **Effects:** Spawns 3DText objects and broadcasts.

#### `MODES` — L3845-3847
- **Does:** A space-separated list of the `Importer` keys.
- **Odd:** Unused.

#### `Importer.Front(qTbl)` — L3643-3657
- **Does:**
  - With a target that is a custom card, it sets `custom.face=qTbl.url`, calls `setCustomObject` and `reload()`, and broadcasts.
  - A target that is not a custom card gives a red broadcast.
  - No target gives "You must be hovering…".
  - It always calls `endLoop()`.
- **Effects:** Changes the hovered card's image and reloads it.

#### `Importer.Spawn(qTbl)` — L3659-3709
**Calls** `respawnFromTarget`, `resolveQueryUuidAsync`, `ensureCardRecords`, `enrichRecordRelatedTokens`, `indexRecordToCardObject`, `Card`, `failNotInCache` and `spawnFromCdnQuery`.
- **Does:**
  1. A standalone request with a target makes a JSON copy of the target (`respawnFromTarget`) and returns.
  2. When `Card.image` is set (custom art), it moves the image into a local and clears the global. It defines `spawnWithImage` (L3668-3696):
     - several suggestions call `failNotInCache`;
     - with a record it enriches the tokens and calls `Card` with that image;
     - without one it spawns a bare card named after the match or the query.
  3. The name 'blank card' is never looked up (3699-3702). Any other name is resolved, then passed to `spawnWithImage`.
  4. Without custom art it calls `spawnFromCdnQuery`.

#### `Importer.Token(qTbl)` — L3711-3713
- **Does:** `spawnTokensForCard(qTbl)`.

#### `Importer.TokenDebug(qTbl)` — L3715-3717
- **Does:** `debugTokenResolution(qTbl)`.

#### `Importer.Print(qTbl)` — L3719-3736
**Calls** `resolvePrintOracleId`, `fetchOraclePrintings`, `printingsToSpawnEntries` and `spawnAlternateArtPrintings`.
- **Does:** It resolves the oracle id, from the target or the name, and calls `failNotInCache` on a miss. It fetches the printings. Non-empty entries go to `spawnAlternateArtPrintings`. Otherwise it broadcasts "No alternate art printings…" and calls `endLoop` unless standalone.

#### `Importer.Text(qTbl)` — L3738-3756
- **Does:** Resolves the name to a UUID and its record (`failNotInCache` when either is missing), then builds the text with `cardOracleText`. With a target it writes the text with `setDescription`; otherwise it broadcasts the text. It calls `endLoop` unless standalone.
- **Effects:** Overwrites the description of the hovered object.

#### `Importer.Deck(qTbl)` — L3758-3790
**Ret** true when a URL was handled, otherwise false. **Calls** `fetchArchidektDeck`, `fetchMoxfieldDeck`, `DeckSites[k]`, `WebGetSSL`/`WebRequest.get` and `spawnDeck`.
- **Does:**
  - A scryfall.com URL is refused (broadcast, `endLoop`).
  - An archidekt.com or moxfield.com URL goes to the matching fetcher.
  - Any other URL is matched against the `DeckSites` keys. The matching function gives `url, handler`. With no url the handler is called with `{}`; an https URL is fetched with `WebGetSSL`; anything else with `WebRequest.get`.
  - With no URL and `mode=='Deck'`, it reads the last Notebook tab and calls `spawnDeck({text=body,url='Notebook '..title..color})`.
- **Odd:**
  - An empty Notebook errors at 3788 (`d[#d]` is nil).
  - A URL that matches no site returns false. `__call` then treats the URL as a card image and spawns it.

#### `Importer.Rawdeck(qTbl)` — L3792-3797
- **Does:** With a target it calls `spawnDeck` on the target's description.
- **Odd:** With no target it never calls `endLoop`, so the queue stalls until "clear queue".

### 2.2 Card index lookups (REUSE the approach; copy it, don't call it)

#### `parentNameShardKey(cardName)` — L164-172
**Ret** a 2-hex-digit shard key. **By** the name, set-collector and parent-token lookups and debug.
- **Does:** djb2 (h = h×33 + byte, mod 2³²) over `normalizeIndexName`, then %256. An empty name gives '00'.

#### `normalizeIndexName(name)` — L581-583
**Ret** the first line, lower-cased and trimmed.

#### `isUuid(s)` — L585-588
**Ret** a boolean: an 8-4-4-4-12 hex pattern.

#### `fetchLookupShard(base, shardKey, cache, loading, waiters, callback, fast)` — L267-287
**By** `fetchNameShard`, `fetchSetColShard` and `fetchOracleIdLookupShard`.
- **Does:** Serves from the cache when it can. Otherwise it queues the callback, makes at most one GET of `base..key..'.json'` (the 6 s fast timeout when `fast`), caches the parsed shard, and calls every waiter with it (nil on failure).
- **Effects:** Web request.
- **Odd:** Failures are not cached, so they retry next time.

#### `fetchNameShard`, `fetchSetColShard`, `fetchOracleIdLookupShard` — L289-291, 293-295, 297-299
- **Does:** Wrap `fetchLookupShard` around the `names-by-name`, `set-collector` and `oracle-ids` shard bases.

#### `loadIndexManifest(callback)` — L301-356 (inner `finish(manifest)` L308-319)
**By** `ensureCardRecords`, `fetchCardRecordByUuid`, `spawnDeckFromText`, `spawnFromCdnQuery`, `spawnTokensForName`, `fetchOraclePrintings` and `Spawn`.
- **Does:**
  - If the manifest is already loaded, it returns it. If an earlier load already failed, it returns nil.
  - Otherwise it queues the callback and fetches `card-index.json` once. Depending on the content:
    - a version below 2 with `byId` becomes `legacyFatIndex`, with an empty manifest;
    - a non-empty `byExactName` gives a v2 manifest that keeps `stats` and `shardUrls`;
    - anything else is stored raw.
  - `finish` stores the result, marks it tried, keeps a fat `byExactName` as legacy, and calls every waiter.
- **State W:** `indexManifest`, `indexManifestLoading`, `indexManifestTried`, `legacyFatIndex`, `indexManifestWaiters`.
- **Odd:** One failure is never retried for the rest of the session.

#### `legacyNameIds(norm)`, `legacySetColUuid(key)`, `legacyOracleIds(oracleId)` — L358-361, 363-366, 368-371
**Ret** the entry from `legacyFatIndex`, or nil.

#### `lookupAllUuidsByName(name, callback)` — L373-381
**Ret** (callback) the list of UUIDs for an exact normalised name, from the legacy index or the name shard.

#### `lookupUuidByName(name, callback)` — L383-387
**Ret** (callback) the first UUID.

#### `lookupUuidBySetCollector(set, collector, callback)` — L389-397
- **Does:** Builds the key `set|num` (lower-case, cut at `_`) and looks it up in the legacy index or the set-collector shard.

#### `lookupUuidByOracleId(oracleId, callback)` — L399-407
- **Does:** Returns nil for an id that is not a UUID. Otherwise it takes the first printing from the legacy index or the oracle-id shard. The shard key is the first 2 hex digits (`tokenShardKey`).

#### `lookupOracleIdByName(name, callback)` — L409-416
- **Does:** Name → UUID → record → `oracle_id`.
- **Odd:** Unused.

#### `cacheCardRecord(uuid, rec)` — L418-420 and `getCachedRecord(uuid)` — L422-425
- **Does:** Write and read `cardRecordCache`.

#### `fetchCardShard(shardKey, callback, fast)` — L427-451
- **Does:** Works like `fetchLookupShard` on `cards/shards`. It also caches every record in the shard.

#### `cardIndexShardKey(id, kind)` — L456-460
**Ret** the first N hex digits of the id. N is the manifest's `shardKeyHex[kind]`, default 2. An empty id gives N zeroes.

#### `ensureCardRecords(uuids, callback)` — L462-482
**By** the deck, spawn, token, print and text paths.
- **Does:** After the manifest loads, it works out which record shards are missing for the given UUIDs and fetches them all, then calls back once. If none are missing it calls back at once.

#### `fetchCardRecordByUuid(uuid, callback, fast)` — L732-751
**Ret** (callback) a record or nil.
- **Does:** Checks the cache, then the legacy `byId` (not on fast paths), then the record shard after the manifest loads.

#### `parseMtgFooter(text)` — L484-500
**Ret** `oid, tokens` from a `[mtg:oid=…;tok=a,b]` footer.
- **Odd:** The current Card class no longer writes this footer into descriptions (2848). The parser stays for older cards.

#### `oracleIdFromTags(target)` — L502-511
**Ret** the UUID from an `oid:<uuid>` tag.

#### `oracleIdFromMemo(memo)` — L603-611
**Ret** the oracle id from the part of the memo before `|`. An `oracleid:` prefix is accepted. Anything that is not a UUID gives nil.

#### `faceUuidFromTarget(target)` — L257-265
**Ret** the printing UUID from the custom object's face URL, else from the `FaceURL` in `getJSON()`.

#### `cleanImageUrl(uri)` — L530-535
**Ret** the URL without its query string, with `cards.scryfall.io` replaced by `img.klrmngr.com`.

#### `cleanSpawnJson(jsonLine)` — L537-542
- **Does:** Strips query strings from the image URLs inside a JSON string and rewrites the Scryfall host.

#### `cdnImageFromUuid(uuid, side)` — L544-548
**Ret** `https://img.klrmngr.com/large/<side>/<u1>/<u2>/<uuid>.jpg`.

#### `r2ImageFromUuid(uuid)` — L550-553
**Ret** `<tokenR2ImageCdn>/cards/<uuid>.jpg`, or ''.

#### `faceUrlFromUuid(uuid, imageCdn)` — L555-571
**Ret** the image URL for a token.
- **Does:** An explicit CDN that differs from Kai wins. Next come the R2 URL for `kaiMiss` UUIDs and for `r2Fallback` UUIDs. Otherwise it returns the Kai URL.

#### `cachedImageUri(imageUris, uuid, side, qual)` — L573-579
**Ret** the Kai URL when there is a UUID. Otherwise the cleaned `image_uris[qual]` (falling back to large, normal, small), or ''.

#### `uuidFromCdnUrl(url)` — L590-596
**Ret** the first UUID in the URL: before an extension, then between slashes, then anywhere.

#### `faceUrlFromJson(json)` — L598-601
**Ret** the first `"FaceURL"` value.

#### `parentIdsFromTarget(target, qTbl)` — L613-628
**Ret** `uuid, oracleId`.
- **Does:** The UUID comes from the face. The oracle id comes from the memo, then `qTbl.oracleid`, then the tags, then the description footer.

#### `setCollectorFromTarget(target)` — L630-640
**Ret** the set and number from a nickname line `· set #num`, else from `X+Y+Z #num`.
- **Odd:** The second pattern, `(%u%+%u%+%u)` (637), needs literal plus signs. It is probably a typo for `%u+`.

#### `cardNameFromTarget(target)` — L764-769
**Ret** the first nickname line, with `[...]` BBCode removed and trimmed.

#### `resolveOracleIdLight(target, qTbl, callback, fast)` — L642-660
- **Does:** Uses the embedded oracle id if there is one ('embedded'). Otherwise it uses the face UUID's record ('card_shard'). Otherwise it returns nil ('none').

#### `resolveOracleIdFromIdentity(target, qTbl, callback)` — L662-688
**By** `resolvePrintOracleId`.
- **Does:** Tries the memo or tags, then the description footer, then the face UUID's record, then `resolveOracleIdFromNameAndSet`. The callback gets `(oid, uuid, source)`.
- **Odd:** `footerTokens` is unused.

#### `resolveOracleIdFromNameAndSet(target, uuid, callback)` — L690-730 (inner `afterSetMiss` L692-711)
- **Does:** Looks up the set and collector number first. On a miss, `afterSetMiss` tries name → UUID → record. Every failure ends in `callback(nil, uuid, 'none')`.

#### `enrichParentOracleId(parentUuid, parentOracleId, callback, fast)` — L753-762
**Ret** (callback) the given oracle id when it is valid. Otherwise the oracle id from the parent's record, or nil.

#### `deckSpawnRecord(entry)` — L914-924
**Ret** the cached record, or a minimal record built from the deck-site entry: name, oracle id, text, type and CMC.

#### Fuzzy name search: the `do` block L932-1306

The word files are `index/cards/fuzzy/k_<abc>.txt` and `s_<end>.txt` on the card-index host (comment L926-931).

**`pack(...)` — L941.** **Ret** a packed table with `n`.

**`runSliced(work, done)` — L946-964.** Runs `work(pause)` in a coroutine and resumes it once per frame through `Wait.frames(step,1)`. It falls back to a synchronous run when coroutines or `Wait.frames` are not available. An error logs "Fuzzy search failed" and calls `done(nil)`.
- **`step()` — L952-962.** The resume loop.

**`foldAccent(c)` — L987.** **Ret** the ASCII fold for a Latin-1 character. `ACCENT_FOLD` is built at 972-985 for both single code units and UTF-8 byte pairs. Anything else gives ' '.

**`fuzzyKey(s)` — L990-997** (script global). **Ret** the search key: the first line with right quotes removed, accents folded, lower-cased, punctuation dropped, and every other run of characters turned into one space, trimmed.

**`shardPlan(key)` — L1000-1028.** **Ret** `prefixes` (up to 3 `k_` files, for the longest distinct non-stopwords) and `endingWords` (up to 2 words of length ≥5).

**`parseShard(text)` — L1030-1040.** **Ret** `{keys, names, kinds, ranks, count, split}`. Each line is `key\tname\tkind\trank`. `split` is set when the text starts with `#split`.

**`bandedOsa(qb, lq, spacedKey, lk, maxd)` — L1046-1092.** **Ret** `full, pre`: the optimal-string-alignment distance to the whole key and to its best prefix, each capped at maxd+1. It uses a diagonal band and exits early when a row's minimum is above maxd. It reuses the module-level rows `ROW_A/B/C`.

**`maxTypos(len)` — L1094-1099.** **Ret** 0 for length <3, 1 for ≤5, 2 for ≤12, otherwise 3.

**`matchShards(key, shards, prefixTypos, pause)` — L1103-1190.**
- **Ret** `top, tier, best, rankOf`.
- Pass 1 scores an exact key at its kind (0-2), and all query words in order as a prefix (10+ when the first word is anchored, otherwise 20+).
- When pass 1 finds nothing, it tries typos with `bandedOsa`. A whole-name match scores 100+10d; a prefix match (only when `prefixTypos`) scores 105+10d.
- It returns the lowest-scoring names, shortest first, with the tier exact, prefix or typo.
- It calls `pause()` every 800 work units.
- **`consider(sh, i, score)` — L1110-1116** keeps the best score and rank per name.

**`fetchShard(fileName, callback)` — L1194-1214.**
- **Does:** Fetches one word file with Accept text/plain and caches it for the session. A 404 is cached as `false`; other failures retry later. Concurrent callers wait on the same request.
- **Effects:** Web request.

**`fetchShards(fileNames, callback)` — L1216-1226.** Loads several files in parallel. The result keeps the input order, with `false` for missing files.

**`fetchEndings(words, callback)` — L1229-1248.** For each word it fetches `s_<last 3>` and follows `#split` files one letter deeper, up to 6 letters. **`step(len)` — L1233-1245** does the walk.

**`fuzzyResolveName(query, callback, exactOnly)` — L1252-1288** (script global).
- **Does:** A key shorter than 3 gives nil.
  - **Pass 1:** It adds the prefix files one at a time and stops at the first match. With `exactOnly`, only the exact tier is accepted.
  - **Pass 2:** Not run with `exactOnly`. It adds the ending files and allows prefix typos.
- The callback gets `(names, tier, scores, ranks)` or nil.

**`fuzzySuggestions(scores, ranks)` — L1291-1305** (script global).
- **Ret** up to 5 names, sorted by band (exact, prefix, typo), then EDHREC rank, then length, then alphabetically.
- **`band(score)` — L1294** gives 0, 1 or 2.

#### `resolveQueryUuidAsync(rawName, callback, opts)` — L1316-1379 (inner `tryNext` L1351-1362)
**By** `resolveDeckLine`, `spawnFromCdnQuery`, `spawnTokensForName`, `resolvePrintOracleId`, `Spawn` and `Text`.
- **Does:** It decodes and trims the name, then tries in order:
  1. `oracleid:<id>`;
  2. any UUID in the text;
  3. it removes a leading "N ";
  4. `name (SET) num`;
  5. `name [SET:num]`;
  6. `name&set=xxx`: every UUID for the name, with `tryNext` checking each record's `set`;
  7. the exact name;
  8. fuzzy search.
- **Ret** (callback): `uuid`; or `nil, suggestions` when several names fit; or `nil, nil, matchedName` when one name fits but is not in the index.
- **Odd:** The names "blank card" and empty skip the fuzzy step.

#### `resolveDeckLine(rest, callback)` — L1381-1391
- **Does:** If the line contains a UUID it uses it directly. Otherwise it resolves the line with `exactOnly`.
- **Odd:** `rest:gsub(uuid,'')` (1384) uses the UUID as a Lua pattern, so the `-`s act as quantifiers. The UUID text is usually not removed from the name.

#### `resolveDeckTextEntries(deckText, qTbl, callback)` — L1393-1430 (inner `nextLine` L1412-1427)
**Ret** (callback) `entries, uuids`.
- **Does:** It skips blank lines and lines starting with `//`, `#`, "sideboard" or "maybeboard". Each remaining line is "N rest", or "rest" with qty 1; a trailing `#https://…` gives custom art. Lines are resolved one at a time. A miss broadcasts "Not in CDN index: …". Each hit adds qty entries.
- **Odd:**
  - Only the "Sideboard"/"Maybeboard" header lines are skipped. The cards listed under them are still imported.
  - Lines are resolved one after another, which is slow for long lists.

#### `fetchOraclePrintings(oracleId, callback)` — L3036-3039
- **Does:** For a valid id, loads the manifest and then calls `fetchOraclePrintingsShard`.

#### `fetchOraclePrintingsShard(oracleId, callback)` — L3041-3064
- **Does:** Fetches and caches `printings-by-oracle/shards/<key>.json`, sharing one request between waiters. Each waiter gets its own oracle id's list.

#### `resolvePrintOracleId(qTbl, callback)` — L3066-3082
- **Does:** With a target it calls `resolveOracleIdFromIdentity`. With a name it resolves the UUID and reads `record.oracle_id`. An empty name gives nil. A miss passes the suggestions through.

#### `isPlayablePrintingEntry(entry)` — L3025-3034
**Ret** false for art_series, token, emblem and double_faced_token layouts, and for Token or Emblem type lines.

#### `printingsToSpawnEntries(printings, fallbackName)` — L3084-3099
**Ret** the playable printings, deduplicated: `{uuid, name, set, collector_number}`.

### 2.3 Token lookup (REUSE the approach; DISABLE spawning in engine mode)

#### `fetchParentNameShard(shardKey, callback, fast)` — L174-194
- **Does:** A cached and shared fetch of `tokens/parents-by-name/shards/<key>.json` from the metadata CDN.

#### `lookupParentTokensByCardName(cardName, callback, fast)` — L196-204
**Ret** (callback) a related-token list or nil.

#### `relatedTokensFromParentNameEntry(entry)` — L206-229
**Ret** `{uuid, name, type_line, power, toughness, imageCdn}` entries; plain strings become `{uuid, 'Token'}`. The result goes through `dedupeRelatedTokensByName`.

#### `dedupeRelatedTokensByName(related)` — L232-255
**Ret** one entry per normalised token name, preferring the default printing in `tokenDefaultsByName`, or nil.

#### `fetchRelatedTokensByOracleId(oracleId, callback, fast)` — L771-773
- **Does:** `fetchRelatedTokens(nil, oracleId, …)`.

#### `loadTokenDefaults(callback, forceReload)` — L775-809
**By** `onLoad`, `spawnTokenDeck` (force), `finishTokenLookup` and `resolveTokensForTarget`.
- **Does:** Fetches `token-cdn-defaults.json` once, sharing it between waiters. It sets `tokenDefaultsByName`, `tokenR2ImageCdn`, `tokenR2Fallbacks` and `tokenKaiMisses`. A failure leaves `{}`.

#### `tokenShardKey(id)` — L811-814
**Ret** the first 2 hex digits of the id, lower-cased, or '00'.

#### `fetchTokenShard(shardBase, shardKey, callback, fast)` — L816-838
- **Does:** A cached and shared fetch, keyed by base+key.

#### `fetchRelatedTokens(parentUuid, parentOracleId, callback, fast)` — L840-897
Inner functions: `tryOracle` L845-854, `deliver` L858-864, `checkDone` L866-869.
- **Does:**
  - With both a UUID and an oracle id, it fetches the parent and oracle token shards in parallel. The first non-empty answer wins; if both are empty it returns nil.
  - With only a UUID, it tries the parent shard, then enriches the oracle id and tries the oracle shard.
  - With only an oracle id, it tries the oracle shard.
  - With neither, it returns nil.

#### `tokenRecordFromEntry(entry)` — L899-912
**Ret** a minimal token record. The default is `{name='Token', type_line='Token', cmc=0}`.

#### `relatedTokensFromDescription(text)` — L513-516
**Ret** the tokens from the `[mtg:]` footer.

#### `relatedTokensFromMemo(memo)` — L1560-1571
**Ret** the UUIDs from `|tokens:a,b` in the memo.

#### `relatedTokensFromCardRecord(rec)` — L2247-2256
**Ret** `rec.relatedTokens` mapped to `{uuid, name}`.

#### `enrichRecordRelatedTokens(record, callback)` — L1530-1558
**By** `spawnDeckEntries`, `spawnFromCdnQuery`, `spawnTokensForName`, `resolveAltArtPreview` and `Spawn`.
- **Does:**
  - It passes the record through when it already has tokens, when its text does not create tokens (`oracleCreatesTokens`), or when it has no oracle id.
  - Otherwise it looks up the token shards by oracle id. If that fails, it tries the parent-name shard (fast).
- **State W:** `record.relatedTokens`.

#### `isAmbiguousTokenName(norm)` — L2117-2119
**Ret** true for generic names in `AMBIGUOUS_TOKEN_NAMES` (2108-2115), such as goblin, zombie or soldier.

#### `indexLookupByTokenName(name)` — L2121-2132
**Ret** the first record with a token layout or Token type line for that exact name. It works only with the legacy fat index.

#### `normalizeTokenLookupName(raw)` — L2134-2148
**Ret** the name with leading a/an/N/"P/T", a colour word, a trailing creature/artifact/enchantment and "token(s)" removed.

#### `resolveTokenUuidByName(name, defaults, opts)` — L2150-2191
**Ret** `uuid, rec`, or nil.
- **Does:** Tries the legacy index, then the exact defaults (ambiguous names blocked when `allowAmbiguousDefaults=false`). With `exactDefaultsOnly` it stops there. Otherwise it takes the longest default key that is a substring of the name. A UUID in `r2Fallback` gets `imageCdn`.

#### `isTokenReplacementSentence(sentence)` — L2193-2202
**Ret** true for doubling or replacement wording ("would create one or more tokens", "twice that many…").

#### `sentenceCreatesTokens(sentence)` — L2204-2224
**Ret** a boolean from the keyword heuristics: excludes replacement, nontoken and "tokens you control" wording; includes create+token, offspring, "that's a copy", food, treasure, clue and blood.

#### `oracleCreatesTokens(text)` — L2226-2232
- **Does:** Splits the text into sentences and runs `sentenceCreatesTokens` on each.

#### `oracleCreatesEmblem(text)` — L2234-2241
**Ret** true for "get an emblem", "you get … emblem" or "creates … emblem".

#### `oracleExpectsRelatedParts(text)` — L2243-2245
**Ret** tokens OR emblem.

#### `parseTokenNamesFromOracle(text)` — L2258-2291 (inner `add` L2262-2271)
**Ret** the token names guessed from the text: quoted names, "create … token" spans, and the words before "token". Filler such as "create", "whenever", "if", "at", "for each" is skipped, and names are deduplicated.

#### `parseEmblemNamesFromOracle(text)` — L2293-2322 (inner `add` L2297-2304)
**Ret** the emblem names, from quotes and "X emblem".

#### `tokensFromOracleText(oracleText, defaults, opts)` — L2324-2359
Inner functions: `addEntry` L2328-2332, `noteUnresolved` L2333-2342.
**Ret** `out, missing`.
- **Does:** Resolves each parsed token and emblem name (adding " Emblem" where needed). Misses are kept, except for junk words.

#### `spawnTokensFromOracle(qTbl, oracleText, defaults, opts)` — L2361-2381
**Ret** true when it spawned.
- **Does:** With nothing resolved it broadcasts the missing names (if any) and returns false. Otherwise it broadcasts the missing ones and calls `spawnTokenDeck`.

#### `targetHasEmbeddedTokens(target)` — L2446-2452, `targetHasCdnIdentity(target)` — L2459-2466, `cardLikelyCreatesTokens(target)` — L2468-2477
- **Does:** Boolean pre-checks. A card "likely creates tokens" if any of these holds: it has embedded tokens; its description says it makes tokens or an emblem; or it has a CDN identity (oracle id or face UUID).
- **Odd:** That means almost every imported card passes.

#### `broadcastNoTokensForCard(qTbl)` — L2454-2457
- **Does:** Broadcasts "This card does not create tokens." and calls `endLoop` unless standalone.

#### `resolveTokensForTarget(qTbl, callback)` — L2480-2590
Inner functions: `tryDefaultsFallback` L2498-2508, `tryLightIdentity` L2510-2525, `tryTokenShards` L2527-2537, `continueShardCascade` L2539-2564, `afterParentNameMiss` L2566-2580.
**By** `spawnTokensForCard` and `debugTokenResolution`.
- **Does:** With no target it returns `callback(nil)`. Otherwise it tries these sources in order:
  1. the parent-name shard;
  2. the memo tokens;
  3. the description footer;
  4. the face record's `relatedTokens`;
  5. the parent and oracle token shards;
  6. a light identity with a different oracle id, then the oracle shard;
  7. the defaults: it spawns from parsed oracle text and calls back `'__spawned__'`.
- **Ret** (callback) `related | '__spawned__' | nil, uuid, oid`.

#### `finishTokenLookup(qTbl, parentUuid, parentOracleId, fromHover, expectsTokens, onSettled)` — L2383-2444
Inner functions: `markSettled` L2392-2394, `noTokensFound` L2396-2410.
**By** `spawnTokensForCard`.
- **Does:** It tries these in order:
  1. the parent-name shard: spawn with backfill;
  2. the target's oracle-text parse, exact defaults only;
  3. the query name as a token name;
  4. a UUID in the query;
  5. otherwise `noTokensFound`, which broadcasts "Token not on Scryfall/CDN yet…" or "does not create tokens" and calls `endLoop` unless standalone.
- **Odd:** `fromHover` is unused.

#### `debugTokenResolution(qTbl)` — L2592-2674 (inner `finish(msg, color)` L2607-2611)
**By** chat `token debug` and `Importer.TokenDebug`.
- **Does:** With no target it broadcasts how to aim and returns. Otherwise it collects:
  - the face UUID, the memo or tag oracle id, and the set and number;
  - the name and its shard key, and the memo and footer token counts;
  - the parent-name result and the full `resolveTokensForTarget` result.
  It broadcasts the lines once, with an 18 s timeout message.
- **Effects:** Broadcasts. It can spawn tokens through the defaults fallback.

#### `spawnTokensForCard(qTbl)` — L2676-2721 (inner `tokenFail` L2686-2691)
**By** chat `token`, `Importer.Token` and `eEmblemAndTokens`.
- **Does:**
  - It refuses early when `cardLikelyCreatesTokens` is false.
  - It arms a 24 s timeout and broadcasts "Looking up tokens...".
  - It runs `resolveTokensForTarget`. A list of tokens is spawned with backfill. `__spawned__` ends the request. Anything else goes to `finishTokenLookup`.
- **Effects:** Spawns tokens and writes the target's memo and tags (backfill).

#### `spawnTokensForName(name, qTbl)` — L2724-2744
**By** chat `token <name>`.
- **Does:** Resolves the card, loads its record and enriches it. With no tokens it broadcasts "<name> does not create tokens." Otherwise it spawns them at the pointer.
- **Odd:** When there are no tokens it calls neither `endLoop` nor anything else. That is fine only because the request is standalone.

#### `collectTokenEntries(related, parentUuid)` — L1857-1883
**Ret** `{uuid, record}` per unique token name, excluding the parent. Records come from the cache or `tokenRecordFromEntry`.

#### `hydrateTokenEntries(tokens, callback)` — L1885-1903
- **Does:** Loads the record shards for the token UUIDs and replaces each record with the cached one, keeping the fallback name.

#### `tokenRecordIsDfc(record)` — L1905-1914
**Ret** true for two faces, `double_faced_token`, or " // " in the type line or name.

#### `tokenFaceNickname(face, cmc, dfcSuffix)` — L1916-1921
**Ret** "Name\nType\nNCMC[ DFC]".

#### `buildTokenCardDat(n, uuid, record, back)` — L1923-2019
**Ret** card data: `CardID n*100`, `CustomDeck[n]`, the memo set to `record.oracle_id`, and the image URL. A DFC gets `States[2]` with the back image (Kai `back` side) and its own nickname and oracle text. When face data is missing, the name and type are split on `//`.

#### `spawnTokenDeck(qTbl, tokens)` — L2021-2067
**By** `spawnRelatedTokens`, `spawnTokensFromOracle` and `finishTokenLookup`.
- **Does:**
  - It force-reloads the defaults. With no tokens it broadcasts "No related tokens…" and calls `endLoop` unless standalone.
  - It hydrates the tokens and gets the transform (`getTokenSpawnTransform`).
  - One token is spawned as a single card. Several are spawned as a Deck named "Tokens" with description `qTbl.name`, face down (rotation z 180).
- **Effects:** `spawnObjectData`.

#### `getTokenSpawnTransform(qTbl)` — L1838-1854
**Ret** `pos, rot`. With a target: 3.2 in front of it, lifted 0.5, with the target's rotation. Otherwise: position + (2, 0.5, 0) with the pointer yaw.

#### `spawnRelatedTokens(qTbl, related, parentUuid)` — L2069-2071
- **Does:** `spawnTokenDeck(collectTokenEntries(...))`.

#### `backfillTokenEmbedOnTarget(target, qTbl, related, oracleId)` — L2073-2098
- **Does:** Works out the oracle id (argument, then memo, then embedded) and writes `memo=oracle|tokens:…` on the target. It adds an `oid:` tag when none exists.
- **Effects:** Changes the target's memo and tags.

#### `spawnRelatedTokensWithBackfill(qTbl, related, parentUuid, oracleId)` — L2100-2106
- **Does:** Deduplicates, spawns, and backfills the target.

### 2.4 Deck sites (pre-game only in engine mode)

#### `archidektTypeLine(oc)` — L1432-1441
**Ret** the supertypes, types and subtypes joined with " — ".

#### `fetchArchidektDeck(deckUrl, qTbl)` — L1714-1760 (inner `finish` L1723-1747)
**By** `Importer.Deck` and `DeckSites.archidekt`.
- **Does:**
  - A URL without `/decks/<id>` gives "Invalid Archidekt URL" and `endLoop`.
  - It sends two GETs in parallel: `archidekt.com/api/decks/<id>/small/` for the deck name, and `/cards/` for the rows. A failure on `/cards/` goes through `webRequestFailed`.
  - When both have answered, `finish` sets `deckName`/`full` and builds qty entries for every row with `card.uid`: uuid, oracle name, text, type line, CMC. It then calls `spawnDeckEntries`.
- **Effects:** Web requests and a deck spawn.
- **Odd:**
  - Rows are not filtered by category, so maybeboard and sideboard rows may be included (open question in the notes).
  - Commanders are not marked.

#### `fetchMoxfieldDeck(deckUrl, qTbl)` — L1762-1799 (inner `addBoard` L1779-1789)
- **Does:** An invalid URL gives a broadcast and `endLoop`. Otherwise it GETs `api2.moxfield.com/v2/decks/all/<id>/` with a Referer of `https://www.moxfield.com/`. It uses the deck name, and adds `scryfall_id` entries from commanders, companions and mainboard in that order. It then calls `spawnDeckEntries`.
- **Odd:** Commanders come first but are not marked.

#### `spawnDeckEntries(entries, qTbl, opts)` — L1656-1702 (inner `spawnAll` L1672-1693)
**By** `spawnDeckFromText` and the two site fetchers.
- **Does:**
  - Zero entries gives a broadcast and `endLoop`.
  - It resets `Card.n=1` and `Deck=1`, sets `qTbl.deck=#entries`, and copies per-line art into `qTbl.image[i]`.
  - It loads every record shard. Then for each entry `i`, at `i*Tick` (0.2 s), it builds a card object and calls `Card`:
    - with `opts.minimalOnly`, directly from the record or a minimal card;
    - otherwise after `enrichRecordRelatedTokens`.
- **Effects:** One Deck spawn, done inside `Card`.
- **Odd:**
  - A 100-card deck takes at least 20 s.
  - Token enrichment is asynchronous, so the `Card` calls can finish out of order. `Card` takes custom art by its own counter `n`, not by entry index, so per-line art can land on the wrong card.

#### `spawnDeckFromText(deckText, qTbl)` — L1704-1712
- **Does:** Manifest, then `resolveDeckTextEntries`, then `ensureCardRecords`, then `spawnDeckEntries`.

#### `spawnDeck(wr, qTbl)` — L2942-2962
**By** the `DeckSites` handlers, `Deck` (Notebook) and `Rawdeck`.
- **Does:**
  - An error or empty body gives a broadcast and `endLoop`.
  - An HTML body (`!DOCTYPE`) writes the URL to a Notebook tab `D<color>`, broadcasts "make it PUBLIC", destroys the newest status text and calls `endLoop`.
  - Otherwise it cuts everything after a "Sideboard" line into a Notebook tab titled `qTbl.url` and calls `spawnDeckFromText`.
- **Effects:** Notebook and broadcasts.
- **Odd:** `textItems[#textItems]` may be another request's text.

#### `spawnCSV(wr, qTbl)` — L2965-2997 (`setCSV=4` global, L2964)
- **Does:**
  - It parses the CSV rows, stripping commas inside quotes.
  - A short row prints "Deck CSV parse error" and calls `endLoop`. The header row is skipped.
  - It keeps a row as main deck when `setCSV==3`, or `setCSV==4` and column 1 contains "main", or `setCSV==7` and the row is not a board. Such rows become "qty name (SET)". Other rows go to a sideboard Notebook tab.
  - It then calls `spawnDeckFromText`.

#### `DeckSites` — L2999-3023 (file local)
Each entry maps a URL to `url, handler`:
- `archidekt(a)` L3000-3002 and `moxfield(a)` L3003-3005 wrap the fetchers. They are unreachable from `Deck`, which handles those hosts first.
- `deckstats(a)` L3006: `?include_comments=1&export_txt=1`, then `spawnDeck`.
- `pastebin(a)` L3007: the `/raw/` URL, then `spawnDeck`.
- `mtgdecks(a)` L3008: `/dec`, then `spawnDeck`.
- `deckbox(a)` L3010-3013: `/export`. The handler extracts `<body>`, turns `<br>` into newlines, then calls `spawnDeck`.
- `tappedout(a)` L3015-3016: sets the global `setCSV` (3 for `/lists/`, otherwise 4) and adds `?fmt=csv`, then `spawnCSV`.
- `mtggoldfish(a)` L3018-3021: archetype URLs are refused with `endLoop`. `/deck/` becomes `/deck/download/`, then `spawnDeck`. Any other URL broadcasts "malformated".
- `cubecobra(a)` L3022: the MTGO download URL, then `spawnDeck`.
- **Odd:** The mtggoldfish fallback (3021) never calls `endLoop`, so the queue stalls. `pairs` iteration order is undefined.

### 2.5 Card building and spawning (REUSE the card format; DISABLE in-game spawning in engine mode)

#### `indexRecordToCardObject(uuid, record)` — L1443-1483
**Ret** a Scryfall-shaped card table. `oracle_id` holds the memo string with tokens. With two or more faces it builds `card_faces`, each with `image_uuid` and Kai front or back `image_uris`; otherwise it sets `image_uris.large`.

#### `memoWithTokens(record)` — L1485-1495
**Ret** `oracle_id[|tokens:a,b]`.

#### `rawOracleIdFromRecord(record)` — L1497-1504
**Ret** the clean oracle UUID: it strips `|…` and the `oracleid:` prefix, then validates.

#### `buildMtgEmbedSuffix(oracleId, related)` — L1506-1517
**Ret** `[mtg:oid=…;tok=…]`, or ''.

#### `cardSpawnEmbeds(record, related)` — L1519-1528
**Ret** `memo, tags {oid:…}, footer`. `Card` ignores the footer.

#### `minimalCardFromUuid(uuid, displayName, record)` — L1573-1586
**Ret** a card table built from a UUID and whatever record fields exist, with the Kai front image.

#### `respawnFromTarget(qTbl)` — L1605-1621
**By** `Spawn` (standalone with target), `fulfillExternalReimportRequest` and `eRespawn`.
- **Does:** With no target it broadcasts "Hover over a card to respawn." Otherwise it calls `spawnObjectJSON` on the target's cleaned JSON at `qTbl.position` (or the target position), rotated to the player's pointer yaw.
- **Effects:** Spawns a copy.

#### `isExternalReimportRequest(qTbl)` — L1625-1627
**Ret** true when there is a target and `full=='Reimporting Card'` (Easy Modules).

#### `fulfillExternalReimportRequest(qTbl)` — L1629-1636
- **Does:** A card with no name gives a broadcast. Otherwise it calls `respawnFromTarget`.

#### `inFrontOfCard(o, lift)` — L1640-1642
**Ret** `pos + forward×(−3.2) + (0, lift or 0.025, 0)`.

#### `ReImport(tar, ply, alt)` — L1644-1654
- **Does:** A shim that builds a re-import request in front of the card and fulfils it.
- **Odd:** Unused in this save.

#### `spawnFromCdnQuery(qTbl)` — L1801-1836 (inner `spawnUuid` L1803-1822)
**By** `Importer.Spawn`.
- **Does:** It picks the UUID from, in order: the hovered card's face, a UUID in the name, then `resolveQueryUuidAsync`. `spawnUuid` loads the record and calls `Card(indexRecordToCardObject(...))`; it enriches the tokens first unless `lightSpawn` is set. With no record it spawns a minimal card. With no UUID it calls `failNotInCache`.
- **Odd:** When a card is hovered, any typed name is ignored and the hovered card is re-imported.

#### `Card(c, qTbl, spawnRecord)` — the class `Card` L2758-2929 (`__call` L2759)
**By** `spawnDeckEntries`, `spawnFromCdnQuery`, `resolveAltArtPreview` and `Spawn`.
- **Does:** Everything runs inside `pcall`. It takes `n=t.n` and increments it.
  - **Names and text:**
    - Split, adventure or room cards (faces plus `image_uris`) get one "Name\nType\nNCMC" per face. Oracle text is joined across faces. Two non-Aftermath split faces mark the card sideways.
    - DFCs get "Name\nType\nNCMC DFC" from face 1. Battle or Room faces are marked sideways.
    - Normal cards get "Name\nType\nNCMC". The planar layout is marked sideways.
  - **Images**, first match wins:
    1. per-line deck art `qTbl.image[n]`;
    2. for a DFC: the face and back from Kai (swapped if reversed, both overridden by `t.image`), and a `backDat` state 2 with `CardID=(deck+n)*100`;
    3. custom art in `t.image`, which is then cleared;
    4. `image_uris` or the UUID;
    5. the face-1 UUID.
    - A card with no image broadcasts "No image for …".
  - **Identity:** `cardSpawnEmbeds` gives the memo `oracle[|tokens]` and the tag `oid:`.
  - **Card data:** Card, Nickname, Description, Memo, Tags, `CardID n*100`, `CustomDeck[n]` (BackURL = `DEFAULT_BACK`, BackIsHidden). `States[2]` is the DFC back. `AltLookAngle {0,180,270}` is set for the sideways faces.
  - **Spawn:**
    - A single card spawns with `spawnObjectData` at `qTbl.position` (default {0,2,0}), with the pointer yaw. It then calls `endLoop` unless standalone.
    - In a deck, the first card starts the global `deckDat`: a Deck with nickname = steam name and description = `qTbl.full`. Each card adds its DeckID, CustomDeck and ContainedObject. The status text updates with "N cards loaded". When `Deck==qTbl.deck`, it spawns the deck face up at the pointer, broadcasts "All N cards loaded!", resets `Deck` and calls `endLoop`.
  - **On error:** it prints the error, destroys every status text and calls `self.reload()`.
- **State W:** `Card.n`, `Card.image`, `Deck`, `deckDat`, `success`, `errorMSG`.
- **Effects:** Spawns cards and decks, updates 3DText, may reload the importer.
- **Odd:**
  - If per-line art is given for a DFC whose back is a battle or room, `backDat` is nil and `cardDat.States[2]` errors (2874). That is caught and the importer reloads.
  - `('split'):find(c.layout)` and `('planar'):find(...)` are reversed substring tests.
  - The set and collector number are not stored on the card.

#### `setOracle(c)` — L2931-2939
**Ret** the oracle text (`"`→`'`) plus `\n[b]P/T|loyalty|defense[/b]`.

#### `cardOracleText(record)` — L3620-3637
**Ret** the name, type line, text, and each further face's name and text. **By** `Importer.Text`.

#### Alternate-art previews (Print mode)

**`playersExcept(color)` — L3101-3107.** **Ret** `Color.list` minus the colour.

**`altArtPreviewOwnerGuid(qTbl)` — L3109-3112.** **Ret** the target's GUID, or `print_<player|color|anon>`.

**`altArtPreviewOrientYaw(qTbl)` — L3114-3118.** **Ret** the target's yaw, else the pointer yaw, else 0.

**`altArtPreviewBasePos(qTbl)` — L3120-3127.** **Ret** the target position, else `qTbl.position` (array or Vector), else this object's position.

**`altArtPreviewSlotPosition(qTbl, slotIndex, total)` — L3129-3145.** **Ret** a grid slot: 6 per row, 1.2 apart, rows starting 2.6 and stepping 1.8 toward the player, at y+0.5.

**`clearAltArtPreviews(ownerGuid, keepSession)` — L3147-3163.** Bumps the generation counter and destroys this owner's preview and arrow objects. It also drops their data, and the session unless `keepSession`.

**`clearAltArtPreviewSession(ownerGuid)` — L3165-3167.** The same with `keepSession=false`.

**`clearAllAltArtPreviews()` — L3169-3182.** Clears every session, then destroys every object on the table tagged `AltArtPreview` or `AltArtPreviewNav`.

**`clearImporterPreviews(ownerGuid)` — L3184-3186.** Alias for `clearAltArtPreviewSession`.

**`clearAllImporterPreviews()` — L3188-3190.** Alias for `clearAllAltArtPreviews`.

**`isAltArtPreviewDoubleClick(key, window)` — L3192-3202.** **Ret** true on a second click within 0.5 s (`os.clock`).

**`buildAltArtPreviewCardData(entry, deckNum, qTbl)` — L3204-3234.** **Ret** a 0.475-scale preview card with the nickname "Name\n· set #num" and the `AltArtPreview` tag.

**`altArtParentEmbeds(qTbl, session)` — L3236-3244.** **Ret** the parent's description, memo and tags, from the session or the target.

**`captureAltArtParentEmbeds(qTbl)` — L3246-3256.** **Ret** a snapshot of the target's description, memo, tags and nickname.

**`altArtImportNickname(entry, qTbl, session)` — L3258-3279.** **Ret** the new name plus the parent's extra nickname lines. "Alternate Art…" and "· set #" lines are dropped.

**`altArtImportPosition(qTbl)` — L3281-3288.** **Ret** 3.2 in front of the target, lifted 0.5, or the layout slot 1.

**`resolveAltArtPreview(info)` — L3290-3317.**
- **By** `altArtPreviewClick`.
- **Does:** Loads the chosen printing's record. With a record it enriches the tokens and calls `Card` (standalone) at the import position. Without one it calls `spawnLightAltArtCard`, which copies the parent's text, memo and tags. It broadcasts "Imported …" and clears the session.
- **Effects:** Spawns a card and destroys the previews.

**`altArtPreviewClick(obj, color, alt)` — L3319-3325.** The button target on a preview card. It ignores players other than the owner. A double click resolves the preview.

**`altArtPreviewPageSlice(session)` — L3327-3335.** **Ret** the entries on the current page.

**`altArtPreviewNavPosition(qTbl, cardsOnPage, side)` — L3337-3357.** **Ret** an arrow position one gap outside row 1. "next" sits one gap to the −right of slot 1; "prev" sits one gap to the +right of the last slot in the row.

**`buildAltArtNavChipData(imageUrl, deckNum)` — L3359-3382.** **Ret** a 0.35-scale card used as an arrow, tagged `AltArtPreviewNav`.

**`spawnAltArtNavArrow(qTbl, ownerGuid, direction, cardsOnPage)` — L3384-3418.**
- **Does:** Spawns the arrow card (CustomDeck id 7001 for next, 7000 for prev). Its `callback_function` (L3394-3414) sets `noencode`, locks it, makes it invisible to everyone but the owner, records the nav data, and adds a transparent 1200×1200 button that calls `altArtPreviewNextPage` or `altArtPreviewPrevPage`.

**`altArtPreviewNextPage(obj, color, alt)` — L3420-3433** and **`altArtPreviewPrevPage(obj, color, alt)` — L3435-3447.** Owner-only button targets. They move the page within bounds, broadcast "page x/y" and redraw.

**`showAltArtPreviewPage(ownerGuid)` — L3449-3519.**
- **Does:** Clears the old objects but keeps the session. It spawns the prev and next arrows when needed.
- **`spawnOne(i)` — L3469-3517** spawns preview `i` every 0.25 s while the generation counter is unchanged. Its `callback_function` (L3480-3505) destroys stale objects, or sets `noencode`, locks the card, hides it from the other players, records `altArtPreviewData` and adds the 1500×2100 `altArtPreviewClick` button.

**`altArtLayoutPosition(qTbl, slotIndex)` — L3521-3543.** **Ret** `pos, rot`. With a target the slots run 2.4 apart to the target's left. Otherwise they run along the pointer direction.

**`spawnLightAltArtCard(entry, qTbl, slotIndex, cardNum, posOverride, rotOverride)` — L3545-3585.**
- **Does:** Bumps `Card.n` and spawns a card with the chosen Kai face and the parent's description, memo and tags.

**`spawnAlternateArtPrintings(entries, qTbl)` — L3587-3618.**
- **Does:** No entries gives a broadcast. Otherwise it clears the previous previews, sets `Card.n=1`, stores the session (24 per page, plus the parent snapshot), broadcasts the instructions and shows page 1. It calls `endLoop` unless standalone.

### 2.6 Encoder module (DISABLE the buttons in engine mode)

#### `registerModule()` — L3997-4027
**By** a top-level `Wait.time(..., 1)` (4063).
- **Does:**
  - It reads `Encoder`; without it, it does nothing.
  - It sets `buttons={'Respawn','Emblem\nAnd Tokens','Printings'}`.
  - On Encoder versions below 4.4 it calls `APIregisterTool{toolID='Card Importer', display=true}`. Otherwise it calls `APIregisterProperty{propID, values={}, visible=true, tags='tool,cardImporter,Amuzet'}`. Both use `funcOwner=self` and `activateFunc='toggleMenu'`.
  - It defines three globals: `eEmblemAndTokens`, `ePrintings` and `eRespawn`.
- **State R:** `Encoder`. **W:** `enc`, `buttons`.
- **Odd:** It tries only once, 1 s after load, so an Encoder that loads later never gets the module.

#### `eEmblemAndTokens(o, p)` — L4013 and `ePrintings(o, p)` — L4013
**By** the Encoder menu buttons.
- **Does:** `ENC(o, p, 'Token')` and `ENC(o, p, 'Print')`.

#### `eRespawn(o, p)` — L4014-4025
- **Does:** `ENC(o, p)` (which only rebuilds the buttons). A card with no name gives a broadcast. Otherwise it calls `respawnFromTarget` in front of the card.

#### `ENC(o, p, m)` — L4029-4052
- **Does:** Rebuilds the card's Encoder buttons. When a mode is given:
  - a card with no name gives a broadcast;
  - otherwise it builds a standalone `Importer` request: position in front of the card, target `o`, `oracleid='oracleid:'..memo`, name = first nickname line, `mode=m`, `full='Card Encoder'`.
- **Odd:** The fallback `or 'Energy Reserve'` can never apply, because `gsub` always returns a string.

#### `toggleMenu(o)` — L4054
**By** the Encoder, when the property is activated.
- **Does:** Reads the Encoder flip and creates the three buttons with `Button`, then calls `Button:reset()`.
- **State W:** `enc`, `flip`.

#### `Button` — L4055-4062 (`reset(t)` L4055, `__call(t, o, l, f)` L4056-4062)
- **Does:** Builds a button template. Each call takes the label `l` and sets `click_function='e'..label` with whitespace removed, so 'eRespawn', 'eEmblemAndTokens' and 'ePrintings'. It stacks the buttons along z, adding 400 to the height per newline, flips them with `f`, and creates them on `o`. `reset` restores the label and position.

### 2.7 How it fits with the rules engine
REUSE the card format and the lookup approach, but copy them rather than call them. The same image URLs mean TTS reuses its cache.
- **DISABLE in engine mode:** in-game spawning. Gate `onChat` and the Encoder buttons on `engineMode`.
- **Allow before the game:** deck import only. It is better still for the bridge to fetch Archidekt or Moxfield itself, which also gives the commander.

---
## 3. get deck data: GUID 5912cf, Custom_Token in bag 4f3387

**What it is.** A token you drop onto a deck. For every card it sends an unthrottled request to `api.scryfall.com/cards/named?fuzzy=`. It rewrites each card's Nickname to "Name\nType NCMC", its Description to the oracle text plus P/T, and its Memo to the oracle id. It then destroys the deck and respawns it from the edited data. The point is to give Global's `getCMC`, Sort Hand and Cascade the "N CMC" text they need. The token destroys itself after one use.

**Event handlers:** `onCollisionEnter` (1) and `onPickUp` (13).

It has no chat commands and no context items. **Buttons:** two "fetching data from scryfall" labels on the deck, front and back (29-35). Their click target `null` resolves through the default owner, Global.

**Global variables:** none. **Public functions:** none.

#### `onCollisionEnter(co)` — L1-11
**By** the TTS event.
- **Does:** Debounces to one event per second (`nowt`/`prevt`). If the colliding object is a Deck, it calls `fixDeckText(deck)` and then `self.destruct()`.
- **State W:** `nowt`, `prevt` and `deck` (globals).
- **Effects:** Destroys this token.

#### `onPickUp(ply)` — L13-15
- **Does:** Records who picked the token up.
- **State W:** `pickUpPlayer`.

#### `fixDeckText(deck)` — L17-66
**Calls** `encodeString`, `WebRequest.get` and `fixText`.
- **Does:**
  - It uses `pickUpPlayer` as the player, or 'Black' if nobody picked the token up.
  - It snapshots `deck.getData()` into `deckData`, makes the deck non-interactable, turns off `hide_when_face_down`, and adds the two label buttons.
  - For each contained card it either counts a card without a Nickname as processed (with an error broadcast), or fetches the first nickname line with BBCode removed.
  - It waits until `ncards==npross`, with a 10 s timeout. On success it broadcasts "…complete", destroys the deck and calls `spawnObjectData({data=deckData})`. On timeout it broadcasts, restores the flags and clears the buttons.
- **State W:** `ply`, `deckData`, `ncards`, `npross`.
- **Effects:** Web requests, destroys and respawns the deck, broadcasts.
- **Odd:**
  - The respawned deck has a new GUID.
  - The `else` branch at 49-51 is unreachable.
  - The token is already destroyed (L9) before the requests return. Its `Wait` and `WebRequest` callbacks may never run, which would leave the deck non-interactable. The code relies on TTS keeping them alive.

#### `fixText(webReturn, i, name, ply)` — L68-97
**Calls** `errorJson` and `getCardText`.
- **Does:** On an error, or a body without an `"object"` field, it broadcasts "error for card #i" and runs `errorJson`. Otherwise it rewrites `ContainedObjects[i]` Nickname, Description and Memo, and the same fields in every `States` entry, using that state's name to pick the DFC face. It always increments `npross`.
- **State W:** `deckData` and `npross`.

#### `getCardText(json, name)` — L99-115
**Ret** `name, oracle, oracle_id`. **Calls** `JSONdecode` and `setOracle`.
- **Does:** For a DFC it picks the face whose alphanumeric name matches `name`, otherwise face 1. The name is "Name\nType NCMC".

#### `setOracle(c)` — L117-124
**Ret** the oracle text with `\n[b]P/T[/b]` or loyalty appended and `\"` unescaped.
- **Odd:** It mutates `c.oracle_text`. It returns two values from `gsub`; the callers keep only the first.

#### `errorJson(json, player)` — L126-133
- **Does:** A 404 broadcasts "not found". Otherwise it broadcasts `json.details`.
- **Odd:** `JSON.decode` on an HTML or empty body can error.

#### `encodeString(str)` — L135-138 and `encodeChar(chr)` — L140-142
- **Does:** Percent-encoding, as in Global.

#### `JSONdecode(txt)` — L220-327, `getNextCardDatFromList(txt, startHere)` — L331-358, `findClosingBracket(txt, st)` — L361-380, `getKeyValue(txt, key, st)` — L383-409
- **Does:** Copies of Global's parser (§1.8), with extra keys `legalities`, `rulings_uri` and `prints_search_uri` (150-216).
- **Odd:**
  - The same list-branch shadowing bug (238-239).
  - The same `image_uris` end-index bug (393-396).
  - `getNextCardDatFromList` is unused.

**How it fits with the rules engine:** pre-game only. It rewrites card metadata and respawns decks. Disable it in engine mode; it is in bag 4f3387, which the engine copy keeps closed.

---

## 4. Deck Lister: GUID 5006a4, BlockSquare, loose on the table

**What it is.** A pad you place a deck on. Its button writes the deck as "1 Name" lines into a Notebook tab named after the player's colour, so that `Scryfall deck` can re-import it.

**Event handlers:** `onLoad` (5), `onCollisionEnter` (86), `onCollisionExit` (97).

It has no chat commands and no context items. **Buttons:** index 0 "Place Deck" / "Get Card List" → `click`, and index 1, a "Deck\nLister" label that also calls `click` (it is 0×0). **Global variables:** none. **Public functions:** none. Global `sortHands` and `cascade` ping it (`pingTable`).

#### `onLoad()` — L5-42
- **Does:** Overwrites its own description (re-import instructions) and name. It creates the two buttons, scaled to cancel the object's own scale.
- **State W:** `sScale` and `bpars`.

#### `lister(obj, pColor)` — L44-78
**By** `click`.
- **Does:**
  - For a Deck it builds `list` with one "1 <first nickname line>" per card.
  - It removes every Notebook tab whose colour is `pColor`, and sets `proceed` when it reaches the last tab.
  - Once `proceed` is set, it waits 0.2 s, adds the tab `{title=pColor, body=list, color=pColor}` and broadcasts the instructions.
- **Effects:** Notebook.
- **Odd:**
  - With no Notebook tabs at all, `proceed` never becomes true. The `Wait.condition` has no timeout, so nothing happens.
  - `removeNotebookTab(tab.index)` inside the loop may shift the indices.
  - Duplicate cards are listed one per line, not grouped.

#### `click(o, pc, a)` — L80-84
**By** both buttons.
- **Does:** When GMNotes holds the GUID of an existing object, it calls `lister` on that object for the clicking colour.

#### `onCollisionEnter(info)` — L86-95
- **Does:** For a Deck, it stores the deck's GUID in GMNotes and relabels button 0 "Get Card List".

#### `onCollisionExit(info)` — L97-105
- **Does:** For a Deck, it clears GMNotes and relabels the button "Place Deck".

**How it fits with the rules engine:** KEEP, pre-game only. It only reads the deck and writes Notebook tabs.

---

## 5. Tutor (9106c4), get basic land (cdd2cc), get non-basic land (01805a): Custom_Tokens in bag 4f3387

**What they are.** Single-use tokens. You drop one onto a deck. It pulls matching cards out face up beside the deck, shuffles the deck 5 times, and destroys itself.
- **Tutor:** the search term is typed into the token's input box and saved.
- **get basic land** and **get non-basic land:** the token's description holds the count (its digits) and the search term (the rest).

**Event handlers:** `onLoad`, `onCollisionEnter`.

**Buttons:** an arrow button ←/→ (`changeDeckDir`) that picks which side the cards come out on. Tutor also has an input box (`getSearch`).

They have no chat commands and no context items. **Global variables:** none. **Public functions:** none.

### 5.1 Tutor (`Tutor__9106c4.lua`)

#### `onLoad(saved_data)` — L1-42
- **Does:** Restores `searchTerm` and `deckDir` (default −1) from JSON. It creates the arrow button and an input box showing the saved term.
- **State W:** `searchTerm`, `deckDir`, `lab`, `tip`.

#### `getSearch(obj, ply, val)` — L43-46
**By** the input box.
- **Does:** `searchTerm=val`, then `updateSave()`.

#### `changeDeckDir()` — L47-58
**By** the arrow button.
- **Does:** Flips `deckDir`, edits the arrow and tooltip, and saves.

#### `updateSave()` — L59-63
- **Does:** Writes `script_state` as JSON `[searchTerm, deckDir]`.
- **State W:** `saved_data` (leaks).

#### `onCollisionEnter(co)` — L65-94
- **Does:**
  - It debounces to one event per second, then acts only on a Deck.
  - It looks for a card name (lower-cased, punctuation stripped) that matches `searchTerm` as a Lua pattern. It takes the first match (`nTake=1`) with `takeObject` (index `i-nTaken`), places it face up at `deckDir*2.4` beside the deck and stops.
  - It shuffles 5 times and destroys itself, even when nothing matched.
- **State W:** `nowt`, `prevt`, `deck`, `nTake`, `nTaken`, `cname`, `rot`, `pos`, `rig`.
- **Effects:** takeObject, shuffle, self-destruct.
- **Odd:**
  - The search term is not lower-cased, so capital letters never match.
  - An empty term matches the first card.
  - The term is used as a pattern, so characters like `-` act as pattern characters.

### 5.2 get basic land (`get_basic_land__cdd2cc.lua`)

#### `onLoad(saved_data)` — L1-26
- **Does:** `deckDir` comes from `saved_data` (default −1). It creates the arrow button.

#### `changeDeckDir()` — L27-38
- **Does:** Flips the direction, edits the button, and sets `self.script_state = deckDir` (a number).

#### `onCollisionEnter(co)` — L40-74
- **Does:**
  - It debounces and acts only on a Deck.
  - From its description it takes `nTake` (the first digits, default 1) and `searchTerm` (the description with digits and punctuation removed).
  - It takes up to `nTake` cards whose names contain "basic", "land" and the term. They are fanned out at `deckDir*2.4 + (k−1)*1.5`, each a little higher.
  - It shuffles 5 times and destroys itself.
- **Odd:** The term is not lower-cased, so a description like "Forest" never matches the lower-cased names (50-57).

### 5.3 get non-basic land (`get_non-basic_land__01805a.lua`)

#### `onLoad(saved_data)` — L1-26, `changeDeckDir()` — L27-38
- Identical to get basic land.

#### `onCollisionEnter(co)` — L40-75
- **Does:** Same, but the condition is *not* "basic", AND "land", AND the term (57).
- **Odd:** The same case bug. "land" also matches names such as "Landfall" that are not lands, and "Island" if it is not marked basic.

**How it fits with the rules engine (all three):** DISABLE. They take cards out of the library and shuffle, which the engine owns. They stay inside bag 4f3387.

---

## 6. CardCustom: GUID 997547, a CardCustom object in bag 4f3387

**What it is.** A "secret number" card. While it is in its owner's hand, the owner sets a number from 0 to 999 by clicking or typing. When it leaves the hand the number locks, and the owner's Steam name is shown above it.

**Event handlers:**
- `onLoad` (1).
- Global-style `onObjectEnterZone` (9) and `onObjectLeaveZone` (23). These are object-script copies and only react to `self`.
- `onNumberTyped` (104), the object event.

It has no chat commands and no context items.

**Buttons** (`createButtons`, rebuilt on every change):
- An owner-name label.
- Nine black outline copies of the number.
- A shadow.
- A 600×600 number button → `add_subtract`.

**Global variables:** none. Object vars: `owner`, `locked`, `noencode=true` (tells the Encoder to skip it), `picounter`, `pos`, `bpars`, `opars`.

**Public functions:** none.

#### `onLoad(saved_data)` — L1-7
- **Does:** Resets to `owner=nil`, `locked=true`, `noencode=true`, `picounter=0`, then builds the buttons.
- **Odd:** The number is not saved, so it resets to 0 on load.

#### `onObjectEnterZone(zone, obj)` — L9-21
- **Does:** Returns unless `obj` is this object. If the zone is a hand that has an owner colour, it unlocks the number, resets `picounter` to 0, sets the owner, and rebuilds.

#### `onObjectLeaveZone(zone, obj)` — L23-34
- **Does:** Returns unless `obj` is this object. Leaving a hand locks the number and rebuilds.
- **Odd:** It also sets `owner` to the hand's colour.

#### `createButtons()` — L36-91
- **Does:** Clears the buttons. With an owner, it adds the Steam-name label in the owner's colour. It then adds the nine outline copies (offset ±0.02), the shadow and the main button. The main button's tooltip depends on `locked`.
- **Odd:** `opars=bpars` aliases the same table, which is harmless because each button is created before the next change.

#### `add_subtract(obj, ply, alt)` — L93-101
**By** the number button.
- **Does:** Only when unlocked and clicked by the owner: left click +1, right click −1, clamped to 0..999. It rebuilds the buttons when the value changes.

#### `onNumberTyped(ply, int)` — L104-110 (`self.max_typed_number=999` at L103)
- **Does:** When unlocked and typed by the owner, it sets `picounter` and rebuilds.
- **Ret:** true, which suppresses TTS's default number handling.

#### `null()` — L112-113
- **Does:** No-op click target for the labels.

**How it fits with the rules engine:** KEEP. It is a player-side aid and does not touch game state. It is in bag 4f3387, so the engine copy keeps it out of play.

---

## 7. Card Size Multiplier: GUID d1d8be, PiecePack_Suns puck in bag 4f3387

**What it is.** While this puck is out on the table, every Card that enters any seat's playmat zone is scaled to 2×1×2. A card that leaves goes back to 1×1×1, unless it is still inside another playmat zone.

**Event handlers:** `onLoad`, plus `onObjectEnterScriptingZone` and `onObjectLeaveScriptingZone` (the older event names, which TTS still fires).

It has no chat commands, no buttons and no context items.

**Global variables:** it reads `Global.getTable('data')` (L3). **Public functions:** none.

#### `onLoad()` — L1-8
- **Does:** Sets `scaleMultiplier=2`. It reads `data` and builds `playmats` from `data[col].playmat` for each available colour.
- **State W:** `scaleMultiplier`, `data` (a local copy), `playmats`.
- **Odd:**
  - A colour returned by `Player.getAvailableColors()` that has no `data` entry (for example Green) raises a nil-index error at L6.
  - `getTable` returns a copy, so the playmat refs are taken once, at load.

#### `onObjectEnterScriptingZone(zone, obj)` — L10-24
- **Does:** Ignores anything that is not a Card. If `zone` is one of the playmats, it calls `obj.setScale({2,1,2})`.

#### `onObjectLeaveScriptingZone(zone, obj)` — L26-45
- **Does:** For a Card it checks whether the card is still in some *other* playmat zone. If so it keeps the 2× scale; otherwise it sets 1×1×1.
- **Odd:**
  - Any card leaving any zone, a hand for example, is reset to scale 1 when it is not on a playmat.
  - Global's zone handler sets library *decks* to scale 1 (1050), but not cards.

**How it fits with the rules engine:** KEEP. Cards are scaled 2× on the playmat, and the renderer must account for that when it lays them out. It is in bag 4f3387, so it only applies when someone takes it out; in engine mode the engine copy returns it to the bag.

---
## 8. rikrassen's MTG Deck/Draft/Cube Importer: GUIDs ddf5de and 222541 (two copies, Custom_Tile, both loose on the table)

**What it is.** A luabundle (v1.7.0) client for rikrassen's importer server, client version v0.11.0. A button opens a per-player modal with four tabs: Deck (URL or pasted list), Draft (set code), Cube (URL, players, pack size, pack count) and Settings (language, card back, DFC states, prefer original printing).

On submit it POSTs JSON to `https://importer.rikrassen.com/{build|draft|draftCube}`. The deck request includes the player's hand transform; the draft request includes every seated hand.

The server answers with NDJSON. Every line that is not an error line goes **unchecked into `spawnObjectJSON`** (L1163); see the security notes. The UI images and the Roboto font come from `https://importer-static.rikrassen.com`.

**Event handlers:** `onLoad` (69).

It has no chat commands and no context items.

**Buttons:** "deck importer" on the tile (72-83) → `click_show_import`.

**Global UI:** it appends a `<Defaults id="tts-importer-defaults">` node and one `modal-<color>` panel per player to the **Global** XML through `UI.getXmlTable`/`UI.setXmlTable` (167-169, 290-293). It also merges its images into `UI.setCustomAssets` (132-161).

**Global variables:** it writes the script-global `BaseURL` (57) on its own object, not on Global. It reads no Global variables.

**Public functions:** UI callbacks that `utils.callback` creates at render time in this object's `_G`. The XML calls them as `<guid>/<Color>-<name>`.

### 8.1 Bundle loader

#### Bundle factory `(function(superRequire) … end)(nil)` — L2-43
**Ret** `require, loaded, register, modules`.

#### `register(name, body)` — L11-15
- **Does:** Stores a module body if that name is not yet registered.

#### `require(name)` — L17-40
- **Does:** Returns the cached module. On first use it runs the body, guarding against cycles with `loadingPlaceholder`, which makes a cyclic `require` return nil. An unknown module errors, because `superRequire` is nil.

#### Module `__root` — L44-47
- **Does:** `require("import")`.

### 8.2 Module `import` (L48-189)
It sets `BaseURL` for the PROD, STAGING or DEV environment (env is hard-coded `'PROD'`, L52) and builds the asset list.

#### `onLoad()` — L69-84
- **Does:** `utils.set_guid(self.getGUID())`, then creates the "deck importer" button.

#### `render_defaults()` — L86-123 (local)
**Ret** the XML table for `<Defaults>`: UpperLeft alignment and the Roboto font on Button, InputField, Text, Image, Toggle and Dropdown.

#### `click_show_import(importer, color)` — L128-130
**By** the tile button.
- **Does:** `M.show_import(importer, color)`.

#### `load_custom_assets()` — L132-161 (local)
- **Does:** Compares the bundle's assets with `UI.getCustomAssets()`. It replaces assets with the same name but a different URL or type, appends missing ones, and calls `UI.setCustomAssets` only if anything changed.
- **Effects:** The Global UI asset list.

#### `init_ui()` — L163-171 (local)
- **Does:** Loads the assets. If `tts-importer-defaults` is not in the UI yet, it appends `render_defaults()` to the Global XML table.
- **Effects:** `UI.setXmlTable` re-renders the **whole** Global UI. That can reset the runtime state of Global's own panels (`GetValuePanel`, `SearchTypePanel`).

#### `M.show_import(importer, color)` — L176-187
- **Does:** If a modal already exists for the colour, it shows it. Otherwise it runs `init_ui()` and, once the UI is stable, `modal.show(color)`.

### 8.3 Module `utils` (L190-242)

#### `M.flatten(...)` — L193-201
**Ret** one array concatenated from the argument arrays.

#### `M.set_guid(guid)` — L203-205
- **State W:** `M._guid`.

#### `M.callback(name, fn)` — L207-213
**Ret** `'<guid>/<name>'`.
- **Does:** Errors if the GUID is not set. Otherwise it stores `fn` as the global `_G[name]` on this object, so the XML can call it.

#### `M.merge(tbl, ...)` — L215-222
**Ret** `tbl` with the later tables' keys copied in.

#### `M.wait_for_stable(fn)` — L225-234
- **Does:** Runs `fn` once `UI.loading` is false, with a 5 s timeout. On timeout it still runs `fn`.

#### `M.dump(o)` — L236-238
- **Does:** Prints `JSON.encode_pretty(o)`.
- **Odd:** Unused.

### 8.4 Module `modal` (L243-1081)
State: a per-colour cache, `ModalCache`.

#### `update_modal_for_color(color)` — L265-280 (local)
- **Does:** Syncs the cache with the UI:
  - a panel `modal-<color>` in the UI but not in the cache gets a new `Modal`;
  - a cached modal no longer in the UI is dropped;
  - any other mismatch errors.
- **Odd:**
  - It adopts a panel without re-binding the callbacks.
  - Both tiles share the panel ids, so a modal drawn by the other copy routes to that copy's GUID.

#### `M.exists(color)` — L283-286
**Ret** a boolean, after the sync above.

#### `render_modal(m)` — L289-294 (local)
- **Does:** Appends `m:render()` to the Global XML table with `UI.setXmlTable`.

#### `M.show(color)` — L297-307
- **Does:** Creates, caches and renders the modal if needed, then calls `modal:show()` once the UI is stable.

#### `Modal.new(color)` — L312-326
**Ret** a modal with these defaults:
- deck form `{url='', data=''}`;
- draft form `{set=''}`;
- cube form `{url='', drafters=1, packSize=15, packCount=3}`;
- settings `{useStates=true, preferOriginalPrinting=false, lang='en'}`;
- tab `'deck'`.

#### `Modal:_id()` — L328-330
**Ret** `'modal-<color>'`.

#### `Modal:show()` — L332-335
- **Does:** Sets the panel's `visibility` to the colour and refreshes the form values.

#### `Modal:hide()` — L337-339
- **Does:** Sets `visibility='false'`.

#### `Modal:id(suffix)` — L341-343
**Ret** `'<color>-<suffix>'`.

#### `Modal:set_tab(tab)` — L345-359
- **Does:** Shows the old tab's button again and hides the new tab's button. It activates only the chosen tab panel.

#### `Modal:update_form_values()` — L361-369
- **Does:** Writes the stored deck text, URL, set code and the two setting toggles back into the UI.

#### `Modal:render_deck_button()`, `render_draft_button()`, `render_cube_button()`, `render_settings_button()` — L371-392, 394-413, 415-435, 454-474
**Ret** the tab-button XML. Each registers a `switch-to-<tab>` callback that calls `set_tab`. The deck button starts hidden.

#### `Modal:render_submit_button(onclick)` — L437-452
**Ret** the submit button XML for the given callback id.

#### `Modal:render_buttons()` — L476-483
**Ret** the four tab buttons.

#### `Modal:render_deck_tab()` — L485-620
**Ret** the panel. Callbacks:
- `set-deck-url` (505) → `_deck_form.url`;
- `set-deck` (603) → `_deck_form.data`;
- `deck-submit` (613) → `api.deck(color, deck form + settings, hide)`.

The tooltip lists the supported sites: aetherhub, archidekt, tcgplayer, deckstats, manabox, moxfield, mtgazone, mtggoldfish, mtgsalvation, mtgtop8, scryfall and tappedout.

#### `Modal:render_draft_tab()` — L622-679
**Ret** the panel. Callbacks: `set-set` (632) and `draft-submit` (672) → `api.draft`.

#### `Modal:render_cube_tab()` — L681-828
**Ret** the panel. It reads `#getSeatedPlayers()` at render time for the default drafter count. Callbacks:
- `set-cube-url` (697);
- `set-cube-players` (755), `set-cube-pack-size` (781), `set-cube-pack-count` (807), each through `tonumber`;
- `cube-submit` (820) → `api.draft_cube`.

#### `Modal:render_settings_tab()` — L830-1039
**Ret** the panel. Callbacks:
- `set-language` (898) → `_settings.lang`; the empty option is ignored.
- `set-back-url` (930) → `backURL`.
- `set-use-states` (944) and `set-use-states-label` (973), which toggles and syncs the checkbox.
- `set-prefer-original-printing` (984) and `set-prefer-original-printing-label` (1013).

- **Odd:**
  - The languages come from `pairs`, so the option order and the pre-selected first option are arbitrary (852-855).
  - The label callback at 1014 reads `useOriginalPrinting`, which is never set. It therefore always sets `preferOriginalPrinting=true` instead of toggling it.

#### `Modal:render()` — L1041-1077
**Ret** the 600×600 draggable panel `modal-<color>`, visible to that colour. It holds the four tabs, the tab buttons and a close button (`on-cancel` callback, 1061 → `hide`).

### 8.5 Module `api` (L1082-1276)

#### `split_lines(resp)` — L1109-1115 (local)
**Ret** the non-empty lines.

#### `postJSON(url, req, cb)` — L1120-1129 (local)
- **Does:** Moves `req.lang` into the `Accept-Language` header and POSTs `JSON.encode(req)` with Accept `application/x-ndjson` and `X-Client-Version`.
- **Effects:** A web request to rikrassen.com.

#### `callback(resp, player, reqType, next)` — L1135-1176 (local)
- **Does:**
  - It calls `next()` first, which hides the modal.
  - On `resp.error` it broadcasts the server's error or "issue with the server", logs, and returns.
  - It returns while `resp.is_done` is false.
  - It broadcasts "Rendering…". For each NDJSON line, an `{"error":…}` line is collected; any other line goes to `spawnObjectJSON({json=line})`. Collected issues are broadcast.
- **Effects:** Spawns whatever the server sends.
- **Odd:** This is the security issue: remote object JSON can carry its own `LuaScript`.

#### `M.draft_cube(color, data, next)` — L1181-1193
- **Does:** An empty URL gives a broadcast. Otherwise it broadcasts "Building cube..." and POSTs `/draftCube`.

#### `M.deck(color, data, next)` — L1198-1217
- **Does:** Needs a list or URL, and a seat: a nil hand transform gives a broadcast. It adds `data.hand` and POSTs `/build`.

#### `M.draft(color, data, next)` — L1222-1248
- **Does:** Needs a set code. It broadcasts to all, collects the position, forward and right of every seated hand (warning players who have no hand), and POSTs `/draft`.

#### `M.check_version(base_url, asset_base_url, cb)` — L1254-1272
- **Does:** Would GET `/version` and, when it differs, download `importer.lua` and pass the text to `cb`.
- **Odd:** Never called in this bundle.

### 8.6 Module `assets` (L1277-1335)

#### `build(base_url)` — L1281-1332
**Ret** 19 custom assets: tab images, buttons, the coffee image, and the Roboto AssetBundle (type 1). URLs that are not https are prefixed with `base_url`.

**How it fits with the rules engine:** DISABLE in engine mode, or allow it only before the game.
- **Security:** it spawns remote server object JSON unchecked and rewrites the Global UI XML (`UI.setXmlTable`).
- If it is kept for pre-game use, take it out of the engine-mode save or gate `click_show_import` on `engineMode`.
