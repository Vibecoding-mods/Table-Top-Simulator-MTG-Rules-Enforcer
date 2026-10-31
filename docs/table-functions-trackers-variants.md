# Function reference: trackers, turns, hands, counters, variants, misc

**Table:** "MTG 4 player table - scripted" (Steam Workshop 2296042369, local file `Mods/Workshop/2296042369.json`).
**Source files:** `table-scripts/<file>.lua`. `table-scripts/_index.json` maps each file to its objects. The index lists at most 6 objects per script, so the longer GUID lists below were read from the full save.
**Consistent with:** `table-review/notes-trackers-turns.md`, `table-review/notes-variants.md` and `table-review/COMPATIBILITY.md`.
**Reviewed:** 2026-10-17, reading every line of every function.

**Scope.** This file covers every script that the other two references don't. They cover:
- Global, the importers and deck tools;
- the Encoder and its modules, the π tools, the Enablers, and the bagged deck tools (Tovoloar, Scrambleverse, Krark, Bag of Tricks, Drop-On-Card Counter 4f684b).

## Conventions

**Line numbers** count `\n` line breaks, the same way `cat -n` and `_index.json` do. Only one file has stray lone `\r` characters: the playmat enabler, which has 2. Editors that treat a lone `\r` as a line break will show its lines shifted by up to 2.

**Table columns** for each function:
- **What it does:** the behaviour, the return value, every global it reads (R:) or writes (W:), every branch and every early return.
- **Called by:** the button, event or function that triggers it. "TTS" means a TTS engine event.
- **Side effects:** objects spawned, moved or destroyed; UI changes; chat and broadcasts.

**TTS button callbacks** are always called as `f(obj, player_color, alt_click)`. Where a script declares fewer parameters, the extra arguments are dropped.

**`self.memo`** is the object's Memo string. Several card scripts here (The Ring, the dungeons) store their state in it rather than in `script_state`.

**Driving pattern** (from notes-trackers-turns):
1. `obj.setVar(name, v)`
2. `obj.call('<render fn>')`
3. `obj.call('updateSave')`

`obj.call` passes only one argument. Where a render function needs more than one, add a one-line `engineSet(p)` wrapper to that script.

**"Engine:"** lines repeat the verdicts in COMPATIBILITY.md:
- 🔁 feed from engine
- ⛔ disable in engine mode
- ✅ keep
- ♻️ reuse code
- ✋ manual layer

## Coverage checklist (79 files)

| Area | Files |
|---|---|
| Trackers | Life_Tracker__23e485 · Commander_Damage__b748df · Red_Commander_Damage__dceed5 · Commander_Zone__908f60 · Suspend_Counter__a5df2d · Suspend_Counter__f07e80 · White_Mana_Counter__2c49c6 · Energy__b531c1 · Timer__809133 · Highlight_Mat__5cb175 · \_b_Day_b\_\_\_4e8c7b · \_b_Night_b\_\_\_cdf2d2 · \_b_The_Ring_b\_\_\_d9fcbc |
| Turns & seating | Turn_Skipper__62e99d · turn_phase_announcer__33c58f · Upkeep_Reminders__430f58 · Who_goes_first___ee33ec · Auto_Player_Promoter__cd83de · smart_mulligan__dc2d88 · \_b_EXPERIMENTAL_b_4p_table_playmat_enabler__0ae315 |
| Hands | Hand_Counter__2f714c · Hand_Counter__5b0cc8 · Hand_Counter_Self___9243e9 · Hand_Counter_Self___9d9dda · Hand_Counter_Screen__3d7324 · hand_rotator__b7e70c · Rotate_Hands_Left___17bafe · Rotate_Hands_Right___e69660 · Ready___f85b39 · Reset_Readiness_Tokens__f598ea |
| Counters | Counter__c9128a · Loyality_Counter__3aad21 · Text__808d36 · \_1_1__7c9dfd · Notecard__1b86d3 · \_b_Drop-On-Card_Counter_b\_\_\_7071ce · static labels: Counter__0beb07, Loyality_Counter__1f2263, \_X_Y_Counter__29d31b, Notecard__56a44e, Energy_Counter__da1b48, Text_Counter__e76686 |
| Variants: Treachery | \_MTG_Treachery_Randomizer__29b1bb · 17 identity files (see §5.2) |
| Variants: Planechase | Planechase__b7ccfb · Planechase_Eternities_Map__bae9e7 · Custom_Dice__4a0860 |
| Variants: Dungeons | \_b_Undercity_b\_\_\_2db63a · \_b_Dungeon_of_the_Mad_Mage_b\_\_\_d075c6 · \_b_Lost_Mine_of_Phandelver_b\_\_\_df09d5 · \_b_Tomb_of_Annihilation_b\_\_\_91aaed · \_b_Baldur_s_Gate_Wilderness_b\_\_\_d3959e |
| Fun & misc | Die_20__8f8d5d · Die_12__b607cb · Die_10__b3e98f · Quarter__227d07 · Custom_Tile__7cf430 · Rhystic_Block_1__1fc1e0 · Bruh_Button__5a7db4 · Pirate_Cannon__540e21 · Table_Instructions__e40450 · PiecePack_Crowns__82bf98 · Human-Time_Lord_Meta-Crisis_Phenomenon_0CMC__2f4321 · hold_alt__fb6538 |

Every `.lua` file in `_index.json` falls either in this list or in the scope of the other two documents.

---

# 1. Trackers

## 1.1 Life Tracker

| | |
|---|---|
| **GUIDs** | White 23e485, Red 448880, Yellow 37e533, Blue 395037 (4 copies) |
| **Object** | Custom_Token, loose on each playmat. Its description is the owner colour. |
| **File** | `Life_Tracker__23e485.lua` (354 lines). By Amuzet, polished by π. |

**Overview.**
- Shows the owner's life total (default 40), plus a temporary ±delta label that clears after 3 s.
- Click changes life by ±1. The side buttons do ±1/±20, or ±5/±100 with right-click.
- Chat commands handle group life effects.
- The tracker dims itself when its owner isn't seated or has a face-down Turn Skipper.

**State.**
- `script_state = {"c":count}` (line 8). Saved value: `{"c":40}`.
- Module globals at 344-354: `x`, `y`, `z`, `scale`, `scale2`, `back`, `owner`, `C2`.
- `owner` is set from the object's description in `onload`.

**Buttons** (created in `onload`):

| Index | Purpose | Callback |
|---|---|---|
| 0 | life total | `option` |
| 1 | delta label | `null` |
| 2-5 | ▲ ▼ +20 −20 | `valueChange1..4`: closures registered with `self.setVar` at 285 |
| 6 | [R] | `resetLife` |

**Chat commands** (`lCheck` table, 122-174). The command must contain a number, and spaces are read as `_`:
- `extort N`
- `drain N`
- `opponents lose N`
- `everyone loses N`
- `double my life N`
- `reset life N`
- `set life N`

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `updateSave()` | 7 | W: `self.script_state = {c=count}`. Returns nothing. | `click_changeValue` 75, `onChat` 203, `resetLife` 323 | saves state |
| `wait(t)` | 11 | Coroutine helper: yields until `os.time() > s+t`. Whole-second resolution. | `clickCoroutine` 58 | none |
| `sL(l,n)` | 16 | Render function. Button 0 label = `l`. Button 1 = `'+'..n` if n>0, `n` if n<0, `''` if n is nil or 0. Cancels the pending `slID` timer, then schedules button 1 to be cleared after 3 s. R/W: `slID`. Global `plus`. | `clickCoroutine`, `onChat`, `onNumberTyped`, `resetLife` | `editButton` 0 and 1; `Wait.time` |
| `onPlayerChangeColor()` | 32 | Calls `onload(self.script_state)`, which rebuilds every button from the saved state. | TTS | full button rebuild |
| `onPlayerConnect()` | 36 | Same as above. | TTS | full button rebuild |
| `option(o,c,a)` | 40 | n = −1 if right-click, else +1. Calls `click_changeValue(o,c,n)`. | button 0 | none directly |
| `click_changeValue(obj,color,val)` | 48 | `count += val`. Defines the global function `clickCoroutine` as a closure (53-73), starts it, then calls `updateSave()`. The owner/admin check at 49 is commented out, so anyone can click. | `option`, `valueChange1..4` | coroutine; save |
| `clickCoroutine()` (nested) | 53 | 1. If C2 is nil, set C2 = the pre-click value C3. 2. Show `sL(count, count-C2)`. 3. `wait(3)`. 4. If no further click happened (`C1==count`) and the net change ≠ 0: re-show `sL(count)`, print `"<owner> gained/lost N life \|count\|"` in the owner colour, and `log` it. 5. Clear C2. Returns 1. R/W globals: `C2`. Upvalues: `C1`, `C3`. | `startLuaCoroutine` 74 | `printToAll`, `log` |
| `getActivePlayers()` | 78 | Rebuilds `activePlayerList[color]`: true for every seated player. Then, for every object named `Turn Skipper`, sets its tint colour false (face-down) or true (face-up). | `onObjectDrop`, `onObjectRotate`, `onObjectDestroy`, `onChat`, `onload` | none (scans `Global.getObjects()`) |
| `onObjectDrop(ply,obj)` | 98 | If the dropped object is named `Turn Skipper`: `getActivePlayers()`, then `onload(script_state)`. | TTS | rebuild |
| `onObjectRotate(obj)` | 105 | For a Turn Skipper: once it is nil or resting (`Wait.condition`), runs `getActivePlayers` + `onload`. | TTS | rebuild |
| `onObjectDestroy(obj)` | 114 | Same as `onObjectDrop`, on destroy. | TTS | rebuild |
| `lCheck.extort_(n,c)` | 123 | **Owner typed it:** for each other seated active player, adds n to `count` and to `nseated`, then returns `(count, 'extorted everyone for', n*nseated)`. **Someone else typed it** and the owner is seated and active: returns `(count-n, false, -n)`. Otherwise returns nil. | `onChat` | none |
| `lCheck.drain_` | 137 | Owner (and active): returns `count+n`. Seated and active non-owner: returns `count-n`. | `onChat` | none |
| `lCheck.opponents_lose_` | 144 | Owner: returns unchanged `count` and a message. Others: `count-n`. | `onChat` | none |
| `lCheck.everyone_loses_` | 151 | If the owner is seated and active: returns `count-n`. | `onChat` | none |
| `lCheck.double_my_life_` | 156 | Owner only: returns `count*2^n`. | `onChat` | none |
| `lCheck.reset_life_` | 161 | Owner: returns `(n, message)`. Others: `(n, false)`. Every tracker resets. | `onChat` | none |
| `lCheck.set_life_` | 168 | Owner only: returns `(n, 'life total changed by …')`. | `onChat` | none |
| `onChat(msg,player)` | 176 | 1. Only acts if the message contains `[ _]-?\d+`. 2. Lower-cases it and turns spaces into `_`. 3. Finds the first `lCheck` key that matches `key-?\d+`. 4. Calls `getActivePlayers`. If the owner isn't active: broadcasts "You have a Turn Skipper active!" to the owner (if the owner typed it), then returns, **unless** the message is `set life`. 5. Calls f. If it returns a value: `count=a`, `sL(count,nn)`, break. Otherwise **returns `msg`** at 199, which leaves the chat message unchanged and skips `updateSave`. 6. `updateSave()`. 7. If a message text came back: `broadcastToAll(color..t..n)` and return false, which hides the chat line. | TTS | broadcast, save, button edit |
| `onload(s)` | 212 | 1. `owner = description`, `ownerRGB`, `ref_type='life'`, `txt` format string. 2. Tint the object, make it interactable. 3. `count = decode(s).c`, or 40 if s is empty. 4. `clearButtons`. 5. `getActivePlayers`. 6. Font alpha is 100/50/20 if the owner is seated and active, else 20/15/15. 7. Create button 0, button 1, buttons 2-5 (registering `valueChange1..4` via `setVar` 285: alt multiplies the step by 5), then button 6. | TTS load + the re-entries above | `setColorTint`, `clearButtons`, `createButton` ×7 |
| `valueChange1..4(o,c,a)` | 285 | Closure: `click_changeValue(o, c, v.n * (a and 5 or 1))`, where v.n is 1, −1, 20 or −20. | buttons 2-5 | via `click_changeValue` |
| `resetLife(obj,color)` | 319 | `sL(40,0)`, `count=40`, prints "reset their life to \|40\|", then `updateSave`. | button 6 | print, save |
| `onNumberTyped(col,int)` | 327 | `self.max_typed_number=999` (326). Shows `sL(int, int-count)`. Restarts `tID` with a 3 s timer; if `int ~= count` when it fires, sets `count=int` and prints gained/lost. **Never calls `updateSave`**, so the value is lost at the next `onload` re-entry. | TTS (hover + number keys) | print |
| `null()` | 341 | No-op. | button 1 | none |

**Bugs and oddities.**
- `onNumberTyped` never saves (327).
- `clickCoroutine` is a global that each click redefines. Clicks less than 3 s apart share `C2`, so they produce one combined message. That is intentional.
- The `extort_` branch adds to `count` inside the loop (129), so the owner's total changes even before it is returned.
- `onChat` returning `msg` (199) leaves the chat line visible.

**Engine:** 🔁 Set `count`, call `sL(count, delta)`, then **always** `updateSave`, because `onload` re-runs from `script_state` on connect, colour change and Turn Skipper events. Suggested wrapper: `engineSet(p) count=p.life; sL(count,p.delta); updateSave()`. Gate in engine mode: `option`, `valueChange1..4`, `resetLife`, `onNumberTyped`, `onChat`.

## 1.2 Commander Damage (per victim/attacker pair) and the spare "<Colour> Commander Damage" trackers

| | |
|---|---|
| **Main GUIDs** (12) | **White victim:** b748df (B), 0f6598 (Y), 6b6e1f (R). **Blue victim:** bfcf4a (W), 8d172a (R), f43e61 (Y). **Yellow victim:** 906d4b (R), 484c38 (W), 45331a (B). **Red victim:** d5907a (Y), 95eb63 (B), 4bfa09 (W). |
| **Main object** | Custom_Token. The description is the attacker colour and is also the tint. |
| **Main file** | `Commander_Damage__b748df.lua` (176 lines) |
| **Spare GUIDs** (8, inside infinite bags) | dceed5 (Red) in cf8328 and 0cebc6; b540d0 (Yellow) in 140a9c and 59d2ee; d3e95f (White) in 30609e and d658b5; f54af9 (Blue) in 19ff7c and 080e23 |
| **Spare file** | `Red_Commander_Damage__dceed5.lua` (170 lines) |

**Overview.**
- Shows a number from 0 to 21 (`MIN_VALUE`/`MAX_VALUE`, lines 1-2) with an outlined label and a [R] reset.
- **State:** `script_state = [val]` (16-18).

**Buttons** (created in `createAll`):

| Index | Purpose | Callback |
|---|---|---|
| 0 | [R] shadow (31) | `reset_val` |
| 1-9 | [R] outline grid (46-63) | `reset_val` |
| 10 | [R] main (65) | `reset_val` |
| 11 | value shadow (80) | `null` |
| 12-20 | value outline (94-110) | `null` |
| 21 | main value (112) | `add_subtract` |

Buttons 0-9 have zero size, so only button 10 is actually clickable.

**Spare variant differences** (diff of the two files):
- The tint comes from the first word of the name (line 10: `getName():gsub('[ ].*','')`).
- It has no `onChat`.
- Line numbers after 150 shift: `reset_val` 154, `onNumberTyped` 162, `null` 168.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 3 | `interactable=true`. `val=0`, or `saved[1]`. `colStr = description`. Tints the object, then calls `createAll()`. | TTS | `setColorTint`, buttons |
| `updateSave()` | 15 | W: global `saved_data` and `self.script_state = JSON([val])`. | `add_subtract`, `onChat`, `reset_val`, `onNumberTyped` | save |
| `createAll()` | 21 | W: `s_color`, `f_color`, `ttText`. The tooltip shows the value only if the global `tooltip_show` is truthy, which is never set, so the tooltip is just the name. Creates the 22 buttons. | `onload` | 22 `createButton` |
| `add_subtract(_obj,_color,alt_click)` | 127 | `mod` = −1 if right-click, else +1. Clamps `val+mod` to 0..21. If the value changed: `updateVal`, `updateSave`. W globals: `mod`, `new_value`. | button 21 | edit, save |
| `updateVal()` | 137 | Sets the label and tooltip of buttons 11..21 to `val`. | `add_subtract`, `onChat`, `reset_val`, `onNumberTyped` | 11 `editButton` |
| `onChat(msg)` (main only) | 153 | If `msg:lower()=='reset life 40'`: `val=0`, `updateVal`, `updateSave`. Doesn't hide the chat line. | TTS | edit, save |
| `reset_val()` | 161 (spare 154) | `val=0`, `updateVal`, `updateSave`, then **`self.reload()`**. | buttons 0-10 | **object reload** (scripts re-init) |
| `onNumberTyped(col,int)` | 169 (spare 162) | `max_typed_number=99` (168). `val=int`, unclamped (it can go above 21). Then `updateVal`, `updateSave`. | TTS | edit, save |
| `null()` | 175 (spare 168) | No-op. | buttons 11-20 | none |

**Bugs and oddities.**
- `reset_val` reloads the whole object (165 / spare 158).
- Typed values skip the 0..21 clamp.

**Engine:** 🔁 Set `val`, then `updateVal`, then `updateSave`. **Never call `reset_val`.** Use the spare trackers for partner commanders. Gate `add_subtract`, `reset_val`, `onNumberTyped`, `onChat`.

## 1.3 Commander Zone (tax display)

| | |
|---|---|
| **GUIDs** | White 908f60/ce8ea5, Red 9d380e/16aed3, Yellow baffa9/dc9c6d, Blue 0c0c5e/3b2d18 (8) |
| **Object** | Custom_Model, transparent and non-interactable. Its description is the owner colour. |
| **File** | `Commander_Zone__908f60.lua` (93 lines) |

**Overview.**
- Shows the commander tax, from 0 to 100 (lines 1-2), in steps of 2.
- **No `script_state`:** the value resets to 0 on load.
- **Buttons:** indices 0-8 are a black outline grid, index 9 is the coloured main button. All of them use `add_subtract`.
- Lines 45-73 are a commented-out `onCollisionEnter` that used to reload commander cards.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 4 | `val=0`. Sets the tint to transparent, `interactable=false`, `pTime=os.time()` (unused). Reads `colStr` (first word of the description), then `col`, `bcolor` (alpha 100). Builds `bpars` and creates the 9 outline buttons (30-35) and the main button (37-41). | TTS | 10 `createButton` |
| `add_subtract(_obj,_color,alt_click)` | 75 | `mod = ±2`. Clamps to 0..100. If changed, relabels buttons 0..9. W: `mod`, `new_value`, `val`. | all buttons | 10 `editButton` |
| `onChat(msg)` | 86 | On `'reset life 40'`: `val=0` and relabels buttons 0..9. | TTS | edit |

**Engine:** 🔁 Set `val`, then `editButton({index=i, label=val})` for i=0..9. Re-push after every reload, because the value isn't saved. Gate `add_subtract` and `onChat`.

## 1.4 Idan-style counter family: mana pool, suspend, energy, experience, poison, tickets

These scripts share one template ("better notecards and counters" by Idan) and differ only in button sizes and colours.

| File | GUIDs (parent bag) | Difference from the a5df2d template |
|---|---|---|
| `Suspend_Counter__a5df2d.lua` (193) | 12 copies. Suspend a5df2d (f07e80, 9360fc); Blue be93f0 (7ae211, 4783af); Green 8e1f05 (daebb2, cdbccc); Red a90926 (b991d5, 220d2f); Black 63e4e1 (887dd2, 1c4a59); Colorless a7dc6e (52e44b, aeeb11) | template |
| `White_Mana_Counter__2c49c6.lua` (193) | 2c49c6 in 389c4d and cd8bb6 | `f_color` 0.6 grey (29); shadow font fixed at 0.1 (51) |
| `Energy__b531c1.lua` (193) | Energy b531c1 (5035f1, 721688); Experience 4c60bd (b3961f, 444725); Poison 30f3c2 (3cba4d, bfceec); "Tickets" 30f3c2 in 4f3387 | Scale 1.5 instead of 0.75; main button 600×600 (45-96) |
| `Suspend_Counter__f07e80.lua` (186) | **The infinite bags themselves** (14): f07e80, 9360fc, 7ae211, 4783af, daebb2, cdbccc, b991d5, 220d2f, 887dd2, 1c4a59, 52e44b, aeeb11, 389c4d, cd8bb6 | Main button is 10×10 (61-62), so effectively not clickable. No `onNumberTyped`. `null` at 185. The bag only *displays* a number. |

**State:** `script_state = [light_mode, val, tooltip_show]` (20-22). Bag-spawned counters arrive with the bag's state. Notes-trackers says to spawn with `LuaScriptState='[true,N,false]'`.

**Buttons:**

| Index | Purpose | Callback |
|---|---|---|
| 0 | shadow label | `null` |
| 1 | value | `add_subtract` |
| 2 | "swap text color" (on the underside) | `swap_fcolor` |
| 3 | "reset" (on the underside) | `reset_val` |

Values are clamped to 0..99 (lines 1-2).

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 4 | Defaults: `light_mode=true`, `tooltip_show=false`, `val=0`. If state is saved, decodes `[1],[2],[3]`. Then `createAll()`. | TTS | buttons |
| `updateSave()` | 19 | W: global `saved_data` and `script_state`. | `add_subtract`, `reset_val`, `reloadAll`, `onNumberTyped` | save |
| `createAll()` | 25 | W: `s_color`, `f_color` (from `light_mode`), `ttText`, `lightButtonText`. Creates buttons 0-3, then calls `setTooltips()`. | `onload`, `reloadAll` | 4 `createButton` |
| `removeAll()` | 105 | `removeButton(0..3)`. | `reloadAll` | removes buttons |
| `reloadAll()` | 112 | `removeAll`, `createAll`, `setTooltips`, `updateSave`. | `swap_fcolor`, `swap_align` | rebuild, save |
| `swap_fcolor(_o,_c,_a)` | 119 | Toggles `light_mode`, then `reloadAll`. | button 2 | rebuild |
| `swap_align(_o,_c,_a)` | 124 | Toggles the global `center_mode` (unused here), then `reloadAll`. No button uses it. | none | rebuild |
| `editName(_obj,_string,value)` | 129 | `self.setName(value)`, then `setTooltips`. No input field uses it. | none | rename |
| `add_subtract(_obj,_color,alt_click)` | 134 | ±1, clamped to 0..99. If changed: `updateVal`, `updateSave`. | button 1 | edit, save |
| `updateVal()` | 144 | Recomputes `ttText`. Sets the label and tooltip of buttons 0 and 1 to `val`. | `add_subtract`, `reset_val`, `onNumberTyped` | 2 `editButton` |
| `reset_val()` | 165 | `val=0`, `updateVal`, `updateSave`. | button 3 | edit, save |
| `setTooltips()` | 171 | Recomputes `ttText` and edits button 0 with `{value=…, tooltip=…}`. `value` isn't a button field, so only the tooltip changes. | `createAll`, `reloadAll`, `editName` | edit |
| `null()` | 185 | No-op. | button 0 | none |
| `onNumberTyped(col,int)` | 189 | `max_typed_number=999` (188). `val=int`, unclamped. Then `updateVal`, `updateSave`. (Not in f07e80.) | TTS | edit, save |

**Engine:** 🔁 Set `val`, then `updateVal`, then `updateSave`. Energy, Experience and Poison have no fixed tracker objects: spawn one from the bag when the engine reports a non-zero value. Gate the click handlers.

## 1.5 Timer

| | |
|---|---|
| **GUIDs** | White 809133, Red 29f427, Yellow 57b8f3, Blue 9df6a3 |
| **Object** | BlockSquare, locked and non-interactable. Its description is the owner colour. |
| **File** | `Timer__809133.lua` (251 lines) |

**Overview.**
- Shows a per-turn mm:ss clock and a turn number while it is the owner's turn.
- Right-click the swap area to see the total time for 5 s.
- **State:** `script_state = [turnN, totT]` (90-92).

**Buttons.** All button tables alias one table, `bpars` (40-85), so each mutation leaks into the buttons created after it.

| Index | Purpose | Callback |
|---|---|---|
| 0-4 | digits | `'null'` (not defined in this script; the buttons are zero-size) |
| 5 | "turn" caption | |
| 6 | turn number | `modTurn` |
| 7 | duplicate turn/total caption (78) | `modTurn` |
| 8 | 900×350 swap area | `swapTot` |

**Chat commands:**
- `timers on`, `timers off`
- any message containing `reset life` zeroes the counters

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad(saved_data)` | 1 | 1. `owner` = description. 2. `setLock(true)`, `interactable=false`. 3. Moves itself to y=0. 4. `timerOn=true`, `viewTot=false`, `ownerCol`. 5. `turnN`/`totT` from save (inside `pcall`). 6. `updateSave`. 7. Builds buttons 0-8. | TTS | moves self, 9 buttons |
| `updateSave()` | 89 | W: `script_state = [turnN, totT]`. | `onLoad`, `modTurn`, `swapTot`, `showTimer`, `onChat` | save |
| `modTurn(obj,ply,alt)` | 95 | `turnN ±= 1`. Relabels button 6, then `updateSave`. | buttons 6, 7 | edit, save |
| `swapTot(obj,ply,alt)` | 101 | **Right-click only** (left-click does nothing): sets `viewTot=true`, shows "turn"/turnN/"total", formats `totT` as mm:ss into `updateButtons`, and saves. Restarts `totTimer`, which sets `viewTot=false` after 5 s. W: `tdiff`, `mins`, `secs`, `secStr`, `minStr`, `timeStr`. | button 8 | edit, save, `Wait` |
| `onPlayerTurn(ply)` | 136 | If `timerOn` and `ply.color==owner`: `turnT=0`, `turnN+=1`, `showTimer(ply)`. Otherwise `hideTimer(ply)`. | TTS (`Turns`) | via callees |
| `showTimer()` | 151 | Stops the old `timerID`. Starts `Wait.time(…, 1, 5999)`. Each second: `turnT++` and `totT++`; shows "turn" and turnN; shows the total if `viewTot`, otherwise the turn time; mm:ss into `updateButtons`; then `updateSave`. | `onPlayerTurn` | edits every second, save every second |
| `hideTimer(ply)` | 196 | Stops `timerID`. Blanks the digits, and blanks and shrinks buttons 5-8. | `onPlayerTurn` | edit |
| `updateButtons(str)` | 210 | If `timerOn`, writes characters 5..1 of `str` into buttons 0..4. Otherwise blanks them. | `swapTot`, `showTimer`, `hideTimer`, `onChat` | 5 `editButton` |
| `onChat(msg,ply)` | 229 | `timers on` → `timerOn=true`. `timers off` → `timerOn=false` and blank the display. Any message containing `reset life` → `turnN=turnT=totT=0`, save, and relabel button 6 if `Turns.turn_color==owner`. | TTS | edit, save |

**Bugs and oddities.**
- `null` is undefined (29), but the buttons using it are zero-size.
- Aliased `bpars` (40-85).
- It saves to `script_state` every second while running.
- Turning the timer off mid-turn doesn't stop `timerID`; only the display is blanked.

**Engine:** ✅ It runs off `Turns`. Set `Turns.turn_color` from the engine's active player. For the turn number, set `turnN` and `editButton({index=6,label=turnN})`, then `updateSave`. Note the `reset life` chat hook.

## 1.6 Highlight Mat

| | |
|---|---|
| **GUIDs** | White d1ae7b, Red 5cb175, Yellow 40b95f, Blue a42baa |
| **File** | `Highlight_Mat__5cb175.lua` (19 lines) |
| **Overview** | A transparent mat that tints faintly in the owner colour on the owner's turn. It has no state. |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Fully transparent tint. `interactable=false`. `thisplayer` = description. | TTS | tint |
| `onPlayerTurn(player)` | 7 | If `player==nil`: transparent, return. If it's the owner: tint to the owner colour at alpha 0.05 and set `startTime=os.time()` (unused). Otherwise transparent. | TTS | tint |

**Engine:** ✅ Driven by `Turns.turn_color`.

## 1.7 Day / Night card

| | |
|---|---|
| **GUIDs** | Day 4e8c7b is state 1. Night cdf2d2 is state 2 of the same object. The GUID changes with the state, so find the card by name. |
| **Files** | `_b_Day_b___4e8c7b.lua` (40), `_b_Night_b___cdf2d2.lua` (40). They are mirror images. |
| **Overview** | A button switches the card to the other state. When the state changes, the new state's script transforms every matching daybound/nightbound card on every playmat. |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | `data = Global.getTable('data')`, `plys = Player.getAvailableColors()`, `enc = Global.getVar('Encoder')`, `noencode=true`. Creates the "switch to night" button (Night's says "switch to day"). | TTS | button |
| `switchState()` | 20 | Day: `self.setState(2)`. Night: `setState(1)`. | button | **replaces this object** |
| `onStateChange()` | 24 | For each colour, for each object on `data[ply].playmat`: if it's a `Card` (not this one) whose description contains `nightbound` (Night's version: `daybound`), find the state whose description contains `daybound` (Night: `nightbound`). Then `card=card.setState(id)`, `enc.call('APIencodeObject')`, `enc.call('APIrebuildButtons')`, and flash a highlight 5 times (yellow for Day, dark blue for Night). | TTS on the new state | **transforms cards with `setState`**; Encoder calls |

**Oddity.** Day's handler transforms `nightbound` cards to their `daybound` face, and Night's does the reverse.

**Engine:** 🔁 Indicator only: `setState(1)` for day, `setState(2)` for night. ⛔ `onStateChange`: it replaces card objects behind the engine's back. Disable it before driving the state.

## 1.8 The Ring

| | |
|---|---|
| **GUID** | d9fcbc |
| **Object** | Card. Memo `'1'`. Its `script_state` is a Scryfall list holding "The Ring // The Ring Tempts You", which the script doesn't read. |
| **File** | `_b_The_Ring_b___d9fcbc.lua` (148 lines) |

**Overview.**
- Four ability rows. Rows the player hasn't reached yet are darkened (alpha 0.95); reached rows stay light (alpha 0.1).
- A counter button shows how many times you have been tempted (0-4).
- **State:** `self.memo = pressedButton` (39).

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | `enc = Global.getVar('Encoder')` (unused), `noencode=true`. `pressedButton = tonumber(self.memo)`; the code assumes the memo isn't empty. Defines `colDown`/`colUp`, `positions`, `width_height`, `labs` (the 4 Ring abilities). Then `createButtons()`. | TTS | buttons |
| `createButtons()` | 37 | `self.memo = pressedButton`. `clearButtons`. For rows i=1..4: `colDown` (dark) if `pressedButton <= i-1`, i.e. the row isn't reached yet; otherwise `colUp`. Callback `press<i>`, tooltip `labs[i]`. Then creates the counter button (`upDown`) labelled `pressedButton`. | `onLoad`, `press1..4`, `upDown` | memo write, 5 buttons |
| `setCol(ply)` | 86 | `col = Color.fromString(ply)`. The `colDown` overrides are commented out. | `press1..4` | none |
| `upDown(obj,ply,alt)` | 92 | ±1, clamped to 0..4. Then `createButtons`. | counter button | rebuild |
| `press1..press4(obj,ply)` | 107 / 117 / 127 / 137 | `setCol`. If `pressedButton==i`, set it to 0; otherwise set it to i. Then `createButtons`. | rows 1-4 | rebuild |
| `doNothing()` | 147 | No-op, unused. | none | none |

**Engine:** 🔁 Set `pressedButton`, then call `createButtons`, which persists it to memo. There is only one shared copy, so the engine tracks the level per player. Gate `press1..4` and `upDown`.

---

# 2. Turns and seating

## 2.1 Turn Skipper

| | |
|---|---|
| **GUID** | 62e99d, one in each of bags b653d2 and 05b07c. Bagged and inert until taken out. |
| **Object** | Custom_Assetbundle |
| **File** | `Turn_Skipper__62e99d.lua` (56 lines) |

**Overview.**
- Picking the token up, or dropping it in a hand or playmat zone, assigns it to that colour.
- While the token is face down, its owner's turn is skipped by setting `Turns.turn_color` to the next player.
- Life trackers read its tint and face to dim their owner (§1.1).
- The saved `LuaScriptState` `{"turnSkipPlayer":"White"}` is ignored: there's no `onSave`, and `onLoad` resets the owner to nil.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 3 | `turnSkipPlayer=nil` (a file-local `local`, line 1). Grey tint. | TTS | tint |
| `assignColor(color)` | 8 | If `color` is a seated player: tint it and set `turnSkipPlayer=color`. | `onPickUp`, `onObjectEnterZone` | tint |
| `onPickUp(color)` | 15 | `assignColor(color)`. **Note:** the TTS event is `onPickUp(player_color)`, so this works. | TTS | tint |
| `onObjectEnterZone(zone,object)` | 19 | Returns unless `object==self`. If the zone is a hand: `assignColor(hzone.getValue())`. Then, inside `pcall`, compares the zone with `Global.getTable('data')[color].playmat` and assigns that colour. | TTS | tint |
| `onDrop(color)` | 39 | Once the token rests: if `turnSkipPlayer==color`, it is that player's turn, and the token is face down, broadcast "Skipping X's turn." and, 2 frames later, set `Turns.turn_color` to the next colour. | TTS | **writes `Turns`**, broadcast |
| `onPlayerTurn(player)` | 50 | If the new turn belongs to `turnSkipPlayer` and the token is face down: broadcast and advance `Turns.turn_color` 2 frames later. | TTS | **writes `Turns`** |

**Bugs.**
- `onDrop` passes `color.color` (42). `color` is a string, so the broadcast colour is nil.
- `onPlayerTurn` will error if `player` is nil (51).

**Engine:** ⛔ It writes `Turns`. Keep it bagged.

## 2.2 Turn phase announcer

| | |
|---|---|
| **GUID** | 33c58f, in bag 4f3387 (bagged) |
| **Object** | PiecePack_Suns |
| **File** | `turn_phase_announcer__33c58f.lua` (88 lines) |

**Overview.**
- A button shows the current phase. Click goes forward, right-click goes back. The context menu jumps straight to a phase.
- Each change is broadcast in the clicker's colour.
- **No state.** `phases` lists 8 phases: untap, upkeep, draw, 1st main, combat, 2nd main, end turn, clean up.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Sets `phases` and `i=1`. Adds 8 context menu items, then `createButtons`. | TTS | context menu, button |
| `pha1..pha8(ply)` | 15-43 | Set `i` to 1..8, then `announceAndButtons(ply)`. | context menu | broadcast |
| `announceAndButtons(ply)` | 48 | `broadcastToAll(phases[i], ply)`, then `createButtons`. | `pha*`, `nextPhase` | broadcast, rebuild |
| `createButtons()` | 53 | `clearButtons`, then one button labelled `phases[i]` with callback `nextPhase`. | `onLoad`, `announceAndButtons`, `onPlayerTurnStart` | button |
| `nextPhase(obj,ply,alt)` | 69 | `i ±= 1`, wrapping 1↔8. Then `announceAndButtons`. | button | broadcast |
| `onPlayerTurnStart()` | 84 | Meant to reset to "untap" at turn start. **TTS has no such event** (it's `onPlayerTurn`), so this never fires. | none | none |

**Engine:** 🔁 `setTable('phases',{…})`, `setVar('i',k)`, `call('createButtons')`. Don't use `announceAndButtons` unless a broadcast is wanted. Gate `nextPhase` and the 8 context items.

## 2.3 Upkeep Reminders

| | |
|---|---|
| **GUID** | 430f58, in bag 4f3387 (bagged) |
| **Object** | PiecePack_Suns |
| **File** | `Upkeep_Reminders__430f58.lua` (142 lines) |
| **Overview** | At each turn change, scans every face-up card on every playmat for text patterns (extra land drops, extra draws, "players can't draw", upkeep triggers). Flashes the matching cards and privately broadcasts a summary to the active player. It has no state and never changes the game. |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | `data = Global.getTable('data')`. | TTS | none |
| `onDrop()` | 5 | If `Turns.enable`: `onPlayerTurn(Player[Turns.turn_color])`. | TTS | via callee |
| `onPlayerTurn(ply)` | 12 | Returns if `ply` is nil. Tally table `t`: `u` upkeep triggers, `d` damage (unused, the code is commented out at 81-89), `c` draws (start 1), `l` land drops (start 1). See the steps below the table. | TTS, `onDrop` | highlights, `Player.broadcast` |

How `onPlayerTurn` tallies, for each face-up `Card` on `data[p].playmat` with a non-empty description:
- **Lines 36-50, land drops:** "Each player may play N additional land…" adds 1. "You may play …" adds 2 if the text contains " two ", else 1, and only counts for the active player's own cards.
- **Line 52:** "Players can't draw cards" sets `nodraw`.
- **Lines 56-70, draw step:** Well of Ideas adds 2 to the active player's draws. "an additional card" adds 1. "two additional cards" adds 2. Anything else appends the card name to `t.C` (no separator).
- **Lines 73-77, upkeep:** "At the beginning of your upkeep" on the active player's own cards adds the coloured name to `t.U`.
- **Lines 79-103:** "each … upkeep" with "opponent's upkeep" on a non-active player's card, or with "player's upkeep", also adds to `t.U`.
- **Lines 106-111, flash:** 5 short highlights, then a 10 s highlight, in `p`'s colour.

Then:
- **Lines 117-119:** format `D`, `C` and `L`.
- **Line 122:** `nodraw` forces the message "Players can't draw cards!".
- **Lines 127-138:** `ply.broadcast` for each non-default tally.

**Oddities.**
- The local `c` (120) is unused.
- The inner `if p~=ply.color` (91) repeats the outer check.

**Engine:** Irrelevant in engine mode (notes): it only broadcasts. Keep it bagged.

## 2.4 Who goes first? die

| | |
|---|---|
| **GUID** | ee33ec |
| **Object** | Custom_Dice, parked at y=200, out of sight |
| **File** | `Who_goes_first___ee33ec.lua` (132 lines). By 0rganics, v3.14. |

**Overview.**
- Rebuilds its own image URL from the seated colours: `0rganics.org/tts/wgf/2.php?v=3.14&c=<codes>`.
- Picks d6, d8 or d10 to fit the player count. Names the faces after the seated players' Steam names.
- The die doesn't write `Turns` itself. The Pirate Cannon does that if the die is fired from it (§6.8).
- **No state.**

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 3 | `whoGoesFirstNameSides()`. | TTS | rename, rotation values |
| `onPlayerChangeColor(col)` | 7 | `pcall(whoGoesFirst)`. | TTS | may reload |
| `onPickedUp()` | 13 | `pcall(whoGoesFirst)`. | TTS | may reload |
| `onObjectRandomize(obj)` | 17 | If `obj==self`: `whoGoesFirst()`. | TTS | may reload |
| `whoGoesFirst()` | 23 | Inside `pcall`: builds the seated code string from r,o,y,g,t,b,p,i,n,w. Pads 7 or 9 players with `x` ("roll again"). The die type is 1 (d6) for 1/2/3/6 players, 2 (d8) for 4/7/8, 3 (d10) for 5/9/10. The string is repeated to fill the faces. If the URL changed: `setCustomObject({image=url,type=…})` and `self.reload()`. Otherwise `whoGoesFirstNameSides()`. | above | **external image URL**, `reload` |
| `whoGoesFirstNameSides()` | 65 | Decodes the code letters from the current image URL into `playersides`: Steam name if seated, else colour, or "Roll again to see who". Builds the `rotvals` for die type 1, 2 or 3. Sets the name to "goes first!", or "Who goes first?" if there are no codes. Then `setRotationValues(rotvals)`. | `onLoad`, `whoGoesFirst` | `setName`, `setRotationValues` |

**Engine:** ⛔ The engine picks the starting player. The die also fetches its image from `0rganics.org`.

## 2.5 Auto Player Promoter

| | |
|---|---|
| **GUID** | cd83de |
| **Object** | PiecePack_Crowns, hidden at y=−5 |
| **File** | `Auto_Player_Promoter__cd83de.lua` (187 lines). Lines 1-60 are a header and config: `objectIsInteractable=true` (44), `chatEnabled=false` (49), `loggingEnabled=false` (52). |

**Overview.**
- Promotes every player when the game loads and when a player joins.
- Remembers players the host demoted, by Steam ID, and doesn't promote them again.
- **State:** `onSave()` returns a JSON set of demoted Steam IDs. Saved value: `[]`.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `_log(element,label)` (local) | 61 | `log(...)` if `loggingEnabled`. | several | log |
| `_printToAll(message)` (local) | 69 | `printToAll` if `chatEnabled`. | `tryPromotePlayer` | chat (off) |
| `_playerAsTable(player)` (local) | 77 | Returns a plain table of the player's fields, for logging. | logging calls | none |
| `isOnDemotedPlayerList(player)` | 107 | Returns whether `_demotedPlayerSteamIds[steam_id] ~= nil`. | `tryPromotePlayer` | none |
| `isPromoted(player)` | 112 | Returns `player.promoted or player.host`. | `tryPromotePlayer`, `savePlayerPromotionState` | none |
| `tryPromotePlayer(player)` | 117 | Demoted: log and skip. Already promoted: skip. Otherwise `player.promote()`. | `onLoad`, `onPlayerConnect` | **promotes the player** |
| `savePlayerPromotionState(player)` | 131 | Promoted: removes the ID from the demoted set. Otherwise adds it. | `onPlayerDisconnect`, `onSave` | W: `_demotedPlayerSteamIds` |
| `onLoad(saveData)` | 151 | Sets `interactable`. Decodes the demoted set. Calls `tryPromotePlayer` for every player. | TTS | promotes |
| `onPlayerConnect(player)` | 167 | `tryPromotePlayer`. | TTS | promotes |
| `onPlayerDisconnect(player)` | 172 | `savePlayerPromotionState`. | TTS | state |
| `onSave()` | 177 | Records every player's state, then returns the JSON. | TTS | none |

**Engine:** ⛔ (recommended). Promoted players can delete or alter engine objects.

## 2.6 smart mulligan (hidden switch)

| | |
|---|---|
| **GUID** | dc2d88 |
| **Object** | PiecePack_Suns, invisible, parked at (−122.6, −5.1, 68.6) |
| **File** | `smart_mulligan__dc2d88.lua` (39 lines) |
| **Overview** | An invisible 1000×1000 button. Only Steam ID <table author Steam ID> can use it. It toggles `Global.smartMulligan`, which Global's mulligan reads to "ensure 2-5 lands in hand" (`_Global.lua:616`), so it rigs shuffles. |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | `interactable=false`, transparent, `ttip='off'`, `createButton()`. | TTS | button |
| `createButton()` | 8 | A global function with the same name as the object method `self.createButton`. `clearButtons`, then an invisible button with callback `mullSwitch` and tooltip `ttip`. | `onLoad`, `mullSwitch` | button |
| `mullSwitch(obj,ply)` | 22 | Does nothing unless the clicker's `steam_id` is <table author Steam ID>. Otherwise toggles `Global.smartMulligan` (default false), sets `ttip` to 'on'/'off', rebuilds, and privately broadcasts the state to the clicker. | button | **writes the Global variable `smartMulligan`** |

**Engine:** ⛔ It's a hard-coded permission (COMPATIBILITY must-fix #1). Remove it in the engine copy.

## 2.7 EXPERIMENTAL 4p table playmat enabler

| | |
|---|---|
| **GUID** | 0ae315 |
| **Object** | PiecePack_Suns |
| **File** | `_b_EXPERIMENTAL_b_4p_table_playmat_enabler__0ae315.lua` (96 `\n` lines; it has 2 stray lone `\r`) |

**Overview.**
- The chat command `playmat <imageURL>` spawns a locked art mat under the player's playmat area. `playmat none` removes it.
- **State:** `script_state = {color: matGUID}`. Saved value: `{"Blue":"607c61","Red":"5573f7","White":"4cd048"}`.
- `playmatJSON` (63-96) is a Custom_Model template with an empty `DiffuseURL` and a 1-line script that makes it non-interactable.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad(saved_data)` | 1 | `playmats` comes from the save, or `{}`. `deckDirs = Global.getTable('deckDirs')`. The announcement at 3 is commented out. | TTS | none |
| `onChat(message,player)` | 15 | W: global `ply=player.color`. On `^[Pp]laymat (.*)`: if the argument is `none`, destroys the mat and clears the entry, inside `pcall`. If it's non-empty, `makePlaymat`. Returns false, which hides the chat line. | TTS | destroy or spawn |
| `makePlaymat(ply,imageURL)` | 33 | 1. Broadcasts to the player. 2. Destroys the old mat. 3. Substitutes the URL into the JSON. 4. Position: hand position + `right*0.7*deckDirs[ply]` + `forward*19.07`, y=0.96, rotation hand+180. 5. `spawnObjectJSON` with an inline callback (52-56) that sets `interactable=false`, records the GUID, and saves state. | `onChat` | **spawns an object**, broadcast, save |

**Engine:** ✅ Cosmetic. Engine scans should ignore objects named "Art Playmat".

---

# 3. Hands

## 3.1 Hand Counter (seen by the opposite side) and Hand Counter (Self)

| | |
|---|---|
| **Hand Counter GUIDs** | White 2f714c, Red 25f80a (file `Hand_Counter__2f714c.lua`, invisible to White and Red); Yellow 5b0cc8, Blue b40ce7 (file `Hand_Counter__5b0cc8.lua`, invisible to Yellow and Blue). 73 lines each. The two files differ only in the `setInvisibleTo` list (24). |
| **Hand Counter (Self) GUIDs** | White 9d9dda, Red 0af44c (file `Hand_Counter_Self___9d9dda.lua`, invisible to Yellow, Blue and Grey); Yellow 9243e9, Blue d29299 (file `Hand_Counter_Self___9243e9.lua`, invisible to White, Red and Grey). 76 lines each. |
| **Object** | BlockSquare. The description is the hand colour. |

**Overview.**
- Each counter moves itself 4 units in front of its colour's hand.
- Once a second it shows "N card(s)" for that hand.
- The plain counter is visible to the opposite side of the table. The Self version is rotated 180° (36), sits at y=−0.04 (20), and is visible to its own side.

| Function | Line (Self) | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 1 | 1. `colStr` = description. `on` = whether `colStr` is an available colour. The Self version also builds an unused `plyList` (6-11). 2. If on: `player=Player[colStr]`. Moves and rotates itself to the hand transform plus `forward*4`, y=0.05 (Self: −0.04). Then `setInvisibleTo`, transparent, locked, scale 1, non-interactable. 3. Creates one zero-size button in the hand colour, callback `updateCardCount`. 4. Starts `Wait.time(updateCardCount, 1, 999999)`. | TTS | moves self, button, repeating timer |
| `updateCardCount()` | 61 (64) | Returns if `not on`. `ncards = #player.getHandObjects()`. Label: "1 card", "N cards", or `''`. Loops `ind=0..nButs` (nButs=0) and edits the button with **`index=inds`** in the plain version (71). `inds` is nil, so the edit relies on TTS defaulting a nil index. Self fixes this with `index=ind` (74). | timer, button | `editButton` |

**Engine:** ✅ It polls `getHandObjects()` every second, so it works as long as the engine puts hand cards in hand zone 1. Otherwise use `setVar('on',false)` and `editButton`. Known bug: `inds` at line 71.

## 3.2 Hand Counter Screen

| | |
|---|---|
| **GUIDs** | Yellow 3d7324, White 5137aa, Red fcb7b5, Blue 4563bf |
| **File** | `Hand_Counter_Screen__3d7324.lua` (21 lines) |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 1 | `tableCols` = all available colours plus Grey. Moves itself to the description colour's hand + `forward*4`, y=1.05, rotation +90°. Then invisible to everyone, black tint, locked, scale (1, 1, 2.2), non-interactable. | TTS | moves self |

**Overview.** A backing screen that nobody can see. **Engine:** ✅ inert.

## 3.3 hand rotator (draft)

| | |
|---|---|
| **GUID** | b7e70c, in bag 098c38 (bagged) |
| **Object** | Custom_Token |
| **File** | `hand_rotator__b7e70c.lua` (176 lines) |

**Overview.**
- Passes every non-empty hand to the next player (counter-clockwise or clockwise) using `deal`, then repairs cards that didn't arrive.
- **State:** `script_state = [allHands, counterclock]`. Saved value: `[false,false]`.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad(saved_data)` | 1 | Defaults to true/true, or decodes the save. Re-saves, then `createButtons`. | TTS | save, buttons |
| `createButtons()` | 18 | `clearButtons`. Rotate button: ↺ or ↻ with a direction tooltip and callback `rotateHands`. While `rotating` it becomes greyed out with callback `doNothing`. The underside button reads "all hands" or "only seated", callback `swapPlayerList`. | `onLoad`, `rotateHands`, `swapPlayerList` | 2 buttons |
| `rotateHands(obj,ply,alt)` | 75 | **Right-click:** toggles `counterclock`, saves, rebuilds, returns. **Left-click:** 1. `rotating=true`; rebuild; schedules another rebuild once `not rotating`. 2. `plys` = available colours if `allHands`, else `getSeatedPlayers()`. 3. Players with cards in hand 1 become `activePlayers`. 4. Each player's target is the previous or next index, mod n. 5. Builds `allObjs[obj]=targetColor`. 6. Staggered every 2 frames: `obj.deal(1, ply)`, then `checkMoveSuccess` 1 s later. 7. After `k*2+5` frames, waits until `lastObj` stops moving, then sets `rotating=false`. | button | **moves every hand card** |
| `checkMoveSuccess(obj,ply)` | 143 | Returns if `obj` is nil. If `obj` isn't in `ply`'s hand, `setPosition`/`setRotation` it to hand 1's transform (rotation y+180). | `rotateHands` | move |
| `swapPlayerList()` | 168 | Toggles `allHands`, saves, rebuilds. | underside button | save |
| `doNothing()` | 175 | No-op. | button while rotating | none |

**Bug.** If no hand has cards, `lastObj` is nil and the `Wait.condition` at 136 errors.

**Engine:** ⛔ Draft tool. It moves hidden cards. Keep it bagged.

## 3.4 Rotate Hands (Left) / (Right)

| | |
|---|---|
| **GUIDs** | Left 17bafe, Right e69660, each in bags 098c38 and 5c8648 (bagged) |
| **Object** | BlockSquare |
| **Files** | `Rotate_Hands_Left___17bafe.lua`, `Rotate_Hands_Right___e69660.lua` (122 lines each). They differ only in the label and in which ordering is used: Left uses `playersClockwise`, Right uses `playersCounterClockwise` (lines 5, 16, 22, 30). |
| **Overview** | tobii Draft Tools. Moves every seated player's hand to the next player in angular order, then flips every Ready token face down. No state. |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 1 | One 400×400 button, callback `onClick_RotateHands`. | TTS | button |
| `onClick_RotateHands()` | 14 | `players = getRealSeatedPlayers()`. Orders them. Each player i sends every hand card to player i+1 (wrapping) by `setPosition`/`setRotation` to that player's `getPlayerHand()` position (rotation y+180). Then every object with `getVar('tobiiDraftTools_isReadyToken')` is rotated to z=180. Note: `local playersClockwise = playersClockwise(players)` shadows the function name inside this scope. | button | **teleports hand cards**, rotates Ready tokens |
| `getRealSeatedPlayers()` | 51 | Returns `Player` objects for seated colours whose `getPlayerHand()` isn't nil. | above | none |
| `playerAngles(players)` | 66 | Returns `{atan2(z,x) → player}`. | ordering functions | none |
| `playersCounterClockwise(players)` | 74 | Players sorted by ascending angle. | Right | none |
| `playersClockwise(players)` | 84 | The same order, reversed. | Left | none |
| `getPlayerAngle(player)` | 94 | `math.atan2(hand.pos_z, hand.pos_x)`. | `playerAngles` | none |
| `pairsByKeys(t,f)` | 101 | Iterator over the keys in sorted order. | ordering functions | none |
| `iter()` (closure) | 106 | Inner iterator: returns the next key and value, or nil. | `pairsByKeys` | none |
| `reverseArray(tbl)` | 115 | Reverses the table in place. Unused. | none | none |

**Oddities.** Uses the deprecated `getPlayerHand()`. The direction labels assume a particular seating.

**Engine:** ⛔ Bagged.

## 3.5 Ready? token and Reset Readiness Tokens

| | |
|---|---|
| **Ready? GUIDs** | f85b39, in bags 098c38 and 5c8648 |
| **Ready? file** | `Ready___f85b39.lua` (1 line): `tobiiDraftTools_isReadyToken = true`. It has no functions; the line is a marker other scripts look for. |
| **Reset GUIDs** | f598ea, in bags 098c38 and 5c8648 |
| **Reset file** | `Reset_Readiness_Tokens__f598ea.lua` (24 lines) |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` (Reset) | 1 | Creates the "Reset Ready Tokens" button with callback `onClick_RotateHands`. | TTS | button |
| `onClick_RotateHands()` (Reset) | 14 | Rotates every object with `getVar('tobiiDraftTools_isReadyToken')` to z=180. The name is copy-pasted from the hand rotator; it doesn't rotate hands. | button | rotates tokens |

**Engine:** ⛔ Bagged draft tools.

---

# 4. Counters (per card and loose)

## 4.1 Counter (Idan template, value −99..999)

| | |
|---|---|
| **GUID** | c9128a, in bags 4256ba and 917dc3 |
| **Object** | Custom_Token |
| **File** | `Counter__c9128a.lua` (222 lines) |

**Overview.**
- A counter with an underside settings panel: show/hide the value in the tooltip, swap the text colour, reset, and a sample "#" input field.
- **State:** `script_state = [light_mode, val, tooltip_show]`. Defaults: false, 0, true.

**Buttons:**

| Index | Purpose | Callback |
|---|---|---|
| 0 | value | `add_subtract` |
| 1 | tooltip toggle | `swap_tooltip` |
| 2 | text colour | `swap_fcolor` |
| 3 | [ Reset ] | `reset_val` |
| input 0 | "#" sample | `keepSample` |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 4 | Defaults, then decode, then `createAll`. | TTS | buttons |
| `updateSave()` | 19 | Writes `script_state`. | `add_subtract`, `reset_val`, `reloadAll`, `onNumberTyped` | save |
| `createAll()` | 25 | Sets `f_color` from `light_mode`, the `ttText` and toggle labels. Creates buttons 0-3 and the input, then `setTooltips`. | `onload`, `reloadAll` | UI |
| `removeAll()` | 130 | `removeInput(0)`, then `removeButton(0..3)`. | `reloadAll` | UI |
| `reloadAll()` | 138 | `removeAll`, `createAll`, `setTooltips`, `updateSave`. | `swap_*`, `keepSample` | UI, save |
| `swap_fcolor(_o,_c,_a)` | 145 | Toggles `light_mode`, then `reloadAll`. | button 2 | UI |
| `swap_align(_o,_c,_a)` | 150 | Toggles `center_mode` (unused), then `reloadAll`. No button uses it. | none | UI |
| `swap_tooltip(_o,_c,_a)` | 155 | Toggles `tooltip_show`, `reloadAll`, `setTooltips`. | button 1 | UI |
| `editName(_obj,_string,value)` | 161 | `setName`, then `setTooltips`. Unused. | none | rename |
| `add_subtract(_obj,_color,alt_click)` | 166 | ±1, clamped to −99..999. If changed: `updateVal`, `updateSave`. | button 0 | edit, save |
| `updateVal()` | 176 | Updates `ttText`, then button 0's label and tooltip. | `add_subtract`, `reset_val`, `onNumberTyped` | edit |
| `reset_val()` | 190 | `val=0`, `updateVal`, `updateSave`. | button 3 | edit, save |
| `setTooltips()` | 196 | Edits button 0's tooltip. The `value` key is ignored. | several | edit |
| `null()` | 210 | No-op. | none | none |
| `keepSample(_obj,_string,value)` | 213 | `reloadAll()`, which throws away whatever was typed, so the "#" input stays fixed. | input | UI |
| `onNumberTyped(col,int)` | 218 | `max_typed_number=999`. `val=int`, then `updateVal` and `updateSave`. | TTS | edit, save |

**Engine:** 🔁 Set `val`, then `updateVal`, then `updateSave`. **Risk:** loose tokens get left behind when the engine moves a card. Prefer Encoder overlays (Easy Modules or πCounter).

## 4.2 Loyality Counter (value 0..99)

| | |
|---|---|
| **GUID** | 3aad21, in bags 8c31d2 and 0a79c7 |
| **File** | `Loyality_Counter__3aad21.lua` (214 lines) |
| **Template** | The same as §4.1 with these differences. |

**Differences from §4.1:**
- Five buttons:

  | Index | Purpose | Callback |
  |---|---|---|
  | 0-1 | shadows | `null` |
  | 2 | value | `add_subtract` (72) |
  | 3 | swap text colour | `swap_fcolor` |
  | 4 | reset | `reset_val` |

- There is no tooltip toggle and no input field.
- Defaults: `light_mode=false`, `tooltip_show=true`.

**Function lines:**

| Function | Line | Notes |
|---|---|---|
| `onload` | 4 | |
| `updateSave` | 19 | |
| `createAll` | 25 | 5 buttons |
| `removeAll` | 120 | removes 0..4 |
| `reloadAll` | 128 | |
| `swap_fcolor` | 135 | |
| `swap_align` | 140 | unused |
| `editName` | 145 | unused |
| `add_subtract` | 150 | ±1, clamped to 0..99 |
| `updateVal` | 160 | edits buttons 0, 1 and 2 |
| `reset_val` | 186 | |
| `setTooltips` | 192 | edits button 0 only, so the value button's tooltip goes stale until `updateVal` runs |
| `null` | 206 | |
| `onNumberTyped` | 210 | `max_typed_number=999` (209); unclamped |

The behaviour of each function matches §4.1.

**Engine:** 🔁 `val`, then `updateVal`, then `updateSave`. Same left-behind risk as §4.1. Prefer the Easy Modules loyalty overlay.

## 4.3 Text counter (labelled counter, value −99..999)

| | |
|---|---|
| **GUID** | 808d36, in bags b02684 and 7eeb77 |
| **File** | `Text__808d36.lua` (249 lines) |
| **Template** | The same as §4.1, plus input 0, a **name field** on the top face (`editName`, 55-75). The counter's label is its object name. |

**Buttons:** 0 value (`add_subtract`), 1 tooltip toggle, 2 text colour, 3 [ Reset ]. Inputs: 0 = name, 1 = "#" sample (`keepSample`).

| Function | Line | Differences from §4.1 |
|---|---|---|
| `onload` | 4 | same |
| `updateSave` | 19 | same |
| `createAll` | 25 | adds the name input |
| `removeAll` | 147 | removes inputs 0 and 1 and buttons 0..3 |
| `reloadAll` | 156 | same |
| `swap_fcolor` | 163 | same |
| `swap_align` | 168 | same (unused) |
| `swap_tooltip` | 173 | same |
| `editName(_obj,_string,value)` | 179 | **used** by input 0: `setName(value)`, then `setTooltips` |
| `add_subtract` | 184 | same |
| `updateVal` | 194 | also calls `setTooltips` |
| `reset_val` | 210 | `val=0`, then save, then `editName(_obj,_string,'Text')`, which resets the name. `_obj` and `_string` are nil globals here, which is harmless. |
| `setTooltips` | 218 | also writes input 0's value to the current name |
| `null` | 237 | same |
| `keepSample` | 240 | same |
| `onNumberTyped` | 245 | same |

**Engine:** 🔁 `setName(label)`, then `val`, `updateVal`, `updateSave`.

## 4.4 +1/+1 (power/toughness modifier)

| | |
|---|---|
| **GUIDs** | 7c9dfd in bag beb998; ad6bf5 in bag d82eb8 |
| **File** | `_1_1__7c9dfd.lua` (302 lines). By "Oops I baked a pie", based on Idan. |

**Overview.**
- Separate power and toughness values (`valP`, `valT`, −999..999).
- The object renames itself to `"+P/+T"`.
- The font shrinks for long labels.
- **State:** `script_state = [valP, valT, fsize]` (26). `light_mode` isn't saved.

**Buttons:**

| Index | Label | Callback |
|---|---|---|
| 0 | P | `add_subtractP` |
| 1 | T | `add_subtractT` |
| 2 | "/" | `add_subtractPT` |
| 3 | P10 | `add_subtractP10` |
| 4 | T10 | `add_subtractT10` |
| 5 | PT10 | `add_subtractPT10` |
| 6 | swap text colour | `swap_fcolor` |
| 7 | [ Reset ] | `reset_val` |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 7 | `light_mode=true`, `tooltip_show=true`, `valP=valT=1`, `fsize=500`. Decodes the save, then `createAll` and `updateVal`. | TTS | UI, rename |
| `updateSave()` | 25 | Writes `[valP, valT, fsize]`. | every modifier, `updatefsize` | save |
| `createAll()` | 31 | Sets `f_color` and the tooltip texts `ttext1`/`ttext10`. Creates the 8 buttons. | `onload`, `swap_fcolor` | UI |
| `swap_fcolor(_o,_c,_a)` | 175 | Toggles `light_mode`, removes buttons 0..7, then `createAll`. Doesn't call `updateVal`, so the labels go back to the defaults until the next change. | button 6 | UI |
| `add_subtractP` | 188 | `valP ±= 1`, clamped. Then `updateSave`, `updateVal`. | button 0 | rename, save |
| `add_subtractT` | 196 | `valT ±= 1`. | button 1 | rename, save |
| `add_subtractPT` | 203 | Both ±1. | button 2 | rename, save |
| `add_subtractP10` | 211 | `valP ±= 10`. | button 3 | rename, save |
| `add_subtractT10` | 218 | `valT ±= 10`. | button 4 | rename, save |
| `add_subtractPT10` | 225 | Both ±10. | button 5 | rename, save |
| `updateVal()` | 233 | `labelP`/`labelT` get a '+' prefix when > 0. Calls `updatefsize()`, edits buttons 0-2 (label and font size), then `self.setName(labelP..'/'..labelT)`. | everything above, `onload`, `reset_val`, `onNumberTyped` | edit, **rename** |
| `updatefsize()` | 270 | `fsize` = 300/350/400/450/500 by label length (>8, >7, >6, >5, else). Then `updateSave`. | `updateVal` | save |
| `reset_val()` | 285 | P = T = 1, `updateVal`, `updateSave`. | button 7 | rename, save |
| `onNumberTyped(col,int)` | 293 | P = T = int, `updateVal`, `updateSave`. | TTS | rename, save |
| `null()` | 300 | No-op. | none | none |

**Engine:** 🔁 Set `valP`/`valT`, then `updateVal` (it saves through `updatefsize`). It renames itself, so never match it by name. Prefer the Easy Modules P/T overlay.

## 4.5 Notecard (editable)

| | |
|---|---|
| **GUID** | 1b86d3, in bags 855d09 and 195243 |
| **File** | `Notecard__1b86d3.lua` (284 lines) |

**Overview.**
- The note text is the object's **description**, edited through input 0 on the top face.
- The underside has settings: reset, light/dark, centre/left align, tooltip on/off, and a font sample. The top face has font size ±.
- **State:** `script_state = [light_mode, center_mode, tooltip_show, f_size]` (17).

**Buttons:**

| Index | Purpose | Callback |
|---|---|---|
| 0 | + | `upFontSize` |
| 1 | − | `downFontSize` |
| 2 | "- Notecard Settings -" | `null` |
| 3 | [ Reset ] | `reset` |
| 4 | light/dark | `swap_fcolor` |
| 5 | centre/left | `swap_align` |
| 6 | tooltip | `swap_tooltip` |
| 7 | "Sample" | `null` |
| input 0 | text | `editDesc` |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(saved_data)` | 1 | Defaults: 300, true, true, true. Decode, then `createAll`. | TTS | UI |
| `updateSave()` | 16 | Writes the 4-tuple. | `reloadAll` | save |
| `createAll()` | 22 | Sets `f_color`, `f_align` (3 = centre, 1 = left), `ttText` (name + description), and the toggle labels. Creates buttons 0-7 and input 0, then `setTooltips`. | `onload`, `reloadAll` | UI |
| `null()` | 198, again at 278 | No-op, defined twice. | buttons 2, 7 | none |
| `removeAll()` | 201 | `removeInput(0)`, `removeButton(0..7)`. | `reloadAll` | UI |
| `reloadAll()` | 208 | remove, create, `setTooltips`, `updateSave`. | most handlers | UI, save |
| `reset()` | 215 | Restores the defaults, then `reloadAll`. The text is kept. | button 3 | UI |
| `upFontSize()` | 223 | `f_size = ceil(f_size*4/3)`, then reload. | button 0 | UI |
| `downFontSize()` | 227 | `f_size = ceil(f_size*3/4)`, then reload. | button 1 | UI |
| `swap_fcolor` | 232 | Toggles light/dark, then reload. | button 4 | UI |
| `swap_align` | 237 | Toggles `center_mode`, then reload. | button 5 | UI |
| `swap_tooltip` | 242 | Toggles, reloads, `setTooltips`. | button 6 | UI |
| `editName(_obj,_string,value)` | 248 | `setName`, then `setTooltips`. Unused. | none | rename |
| `editDesc(_obj,_string,value)` | 253 | `self.setDescription(value)`, then `setTooltips`. | input 0 | **description write** |
| `setTooltips()` | 258 | `title` (unused), `desc`. Input 0's value = description, its tooltip = desc or ''. | several | edit input |
| `keepSample(_obj,_string,value)` | 281 | `reloadAll`. No input uses it. | none | UI |

**Engine:** ✅ Notes. To write a note from the engine: `setDescription(text)`, then `call('setTooltips')`.

## 4.6 Drop-On-Card Counter (7071ce)

| | |
|---|---|
| **GUIDs** | 7071ce (−45.5, 1, 7), f62d00 (45.5, 1, −7) |
| **Object** | Custom_Token, loose |
| **File** | `_b_Drop-On-Card_Counter_b___7071ce.lua` (65 lines) |

**Overview.**
- This file is the token's own face: a click counter with a caption. The drop-onto-card behaviour belongs to the πCounter and Encoder module (see the encoder reference).
- **No state:** `picounter` resets on load.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | `picounter=0`, then `createButtons`. | TTS | UI |
| `createButtons()` | 6 | `clearButtons`. Creates the caption (`null`), a 3×3 black outline grid (36-42), a shadow (44-46), then the main value button (`add_subtract`, 48-53). `opars=bpars` is an alias, so each assignment mutates `bpars`. | `onLoad`, `add_subtract` | 12 buttons |
| `add_subtract()` | 56 | `picounter + (alt and -1 or 1)`, clamped to 0..999. **`alt` is an undefined global**, because the function declares no parameters, so a click always adds 1. If changed: `createButtons`. | main button | UI |
| `null()` | 64 | No-op. | caption, outline | none |

**Bug.** Right-click can't decrement (57).

**Engine:** Display only. Use πCounter through the Encoder (`APIobjSetValueData{valueID='picounter'}`) for on-card counters, and don't use the drop-on token's `toggleProp` (notes-trackers).

## 4.7 Static bag-label tokens (no logic)

Each of these draws one or two fixed labels with a `null` callback. Their only functions are `onload` (line 1) and `null()`. They sit on top of the matching infinite bags as captions.

| File | GUIDs | Label | `null` line |
|---|---|---|---|
| `Counter__0beb07.lua` (18) | 0beb07, e0d9cc | "0" | 17 |
| `Loyality_Counter__1f2263.lua` (18) | 1f2263, 792837 | "0" | 17 |
| `_X_Y_Counter__29d31b.lua` (18) | 29d31b, 2e1ed6 | "+X / +Y" | 17 |
| `Notecard__56a44e.lua` (18) | 56a44e, d9bd81 | "Notecard". Also passes a stray `value=getName()` field. | 17 |
| `Energy_Counter__da1b48.lua` (36) | Energy da1b48/f209f9, Experience 576ccd/895bd9, Poison 94b67a/e6f47f | shadow "0" plus main "0" | 35 |
| `Text_Counter__e76686.lua` (32) | e76686, e2c813 | "0" plus "Text" | 31 |

**Engine:** ✅ Inert. Several of them are moved by Table Instructions "×" (§6.9).

---

# 5. Variants

## 5.1 MTG Treachery Randomizer

| | |
|---|---|
| **GUID** | 29b1bb, inside fc40c8 |
| **Object** | Custom_Model_Bag. Its `ContainedObjects` are decks named …Leaders / Guardians / Assassins / Traitors, plus a Rules object. |
| **File** | `_MTG_Treachery_Randomizer__29b1bb.lua` (260 lines) |

**Overview.**
- Pre-game only. Pick 4-8 players and the rarities to include.
- **Start** spawns the right number of identity cards face down into one shuffled deck, spawns the rules sheet, then destroys the randomizer.
- It never records who has which role.
- **No state.**

**Buttons:**

| Purpose | Callback |
|---|---|
| "N player start" | `start` |
| + / − | `incPl` / `decPl` |
| U / R / M rarity toggles | `toggleU`, `toggleR`, `toggleM` |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | `Nplayers=4`, all rarities on, `makeButtons`. Seeds and warms up `math.random`. | TTS | UI |
| `makeButtons()` | 13 | `clearButtons`. Builds 6 buttons by mutating one shared `bpars`. Rarity buttons are dimmed when off. | `onLoad`, toggles, `incPl`, `decPl` | UI |
| `toggleU/R/M(obj,ply)` | 91 / 96 / 101 | Flip `Uon`/`Ron`/`Mon`, then rebuild. | rarity buttons | UI |
| `incPl()` / `decPl()` | 106 / 112 | `Nplayers` ±1, clamped to 4..8, then rebuild. | +/− | UI |
| `start(obj,ply)` | 118 | See the steps below the table. | start button | **spawns cards**, chat, **self-destruct** |
| `selectCards(ddat,N)` | 209 | Builds `possible` = contained cards whose nickname matches an enabled rarity, then permutes it. Picks N distinct random indices (re-rolls duplicates; this loops forever if `#possible < N`). Appends the picks to the global `selected`. | `start` | W: `selected`, `possible`, `lis` |
| `addToDeck(card)` | 243 | The first card spawned becomes `finalDeck`. Each later card is `putObject` into it, then `shuffle`. | spawn callback | merges and shuffles |
| `permute(tab)` | 252 | Fisher-Yates shuffle in place. Returns `tab`. W: global `n`. | `selectCards`, `start` | none |

How `start` works:
1. **Line 122:** if every rarity is off, privately broadcast an error and return.
2. Print the "TREACHERY INITIATED" banner and the role mix and win conditions for `Nplayers`.
3. **`nIds` (151-157):** the role counts per player count.
4. **`data = self.getData()` (161).** For each contained deck, by its lower-case nickname: `selectCards` for leaders, guardians, assassins and traitors. `rules` is spawned 4 units forward at scale 1.5. The token-spawning branch (172-178) is commented out.
5. **Lines 192-199:** permute `selected`. Spawn each card at the bag's transform, rot z=180 (face down), scale 1, with the callback `addToDeck`.
6. **Lines 201-205:** lock the bag, move it to (0, 500, 0), and `destruct` it after 1 s.

**Oddity.** It works only once per load (notes), because it destroys itself.

**Engine:** ✅ / ✋ pre-game only. With the engine's 4-player limit the mix is 1 Leader, 1 Traitor, 2 Assassins and no Guardian.

## 5.2 Treachery identity cards: 5 templates, 17 objects

All identity cards are `Card` objects inside the role decks: Leaders 46478a, Guardians 13167d, Assassins 932c29, Traitors 0783d9. They come out through the randomizer. Each sets `noencode=true`, so the Encoder skips them.

**Hidden-information leak:** the card *name* contains the role ("…Identity — Traitor…"). The bridge must skip `Identity —` objects (notes-variants #6).

**Shared helper: the double-click guard.** Every token or ability callback starts with the same block:
- If `prevT` is nil, set it to now−5.
- If more than 0.3 s have passed since `prevT`, set `nClick=1`, store the time, and **return**.
- Otherwise increment `nClick`, and return unless `nClick>=2`.

`os.time()` has whole-second resolution, so two clicks in the same wall-clock second count as a double-click. `prevT` and `nClick` are shared by every guarded callback on that card.

**`noScript()`**, guarded by the same block, calls `self.clearButtons()`: the "×" button hides the card's buttons until the next load.

### Template A: counter identities (61 lines each)

| File | GUID | Tooltip |
|---|---|---|
| `Her_Seedborn_Highness_…___2ceb28.lua` | 2ceb28 (Leader) | seed counter |
| `The_Void_Tyrant_…___e4a187.lua` | e4a187 (Leader) | void counter |
| `The_Queen_of_Light_…___4a9a17.lua` | 4a9a17 (Leader) | purification counter |
| `The_Bio-Engineer_…___5b3301.lua` | 5b3301 (Assassin) | nut counter |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | `noencode=true`, `val=0`. Button 0 is the counter (`counter`); button 1 is "×" (`noScript`). | TTS | UI |
| `counter(obj,ply,alt)` | 34 | `val ±= 1`, clamped to 0..99. Relabels button 0. Not saved. | button 0 | edit |
| `onNumberTyped(col,int)` | 41 | `max_typed_number=99` (40). `val=int`, relabel. Returns true. | TTS | edit |
| `noScript()` | 47 | Guarded `clearButtons`. | button 1 | UI |

**Engine:** ✋ manual layer. The values aren't saved.

### Template B: single-token identities (121 lines each)

| File | GUID | Token JSON (`tokenJSON` 1-56) | Button |
|---|---|---|---|
| `The_Grenadier_…___c224ba.lua` | c224ba (Traitor) | Explosive (artifact) | spawn explosive |
| `The_Blood_Empress_…___37817e.lua` | 37817e (Leader) | Spirit | spawn spirit |
| `The_King_over_the_Scrapyard_…___9c31d6.lua` | 9c31d6 (Leader) | Treasure | spawn treasure |
| `The_Old_Ruler_…___8f7df8.lua` | 8f7df8 (Leader) | Treasure | spawn treasure |
| `The_Summoner_…___be1838.lua` | be1838 (Guardian) | Elemental Beast | spawn elemental |
| `The_War_Shaman_…___47ceb9.lua` | 47ceb9 (Assassin) | Elemental | spawn elemental |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 58 | `noencode=true`. Button 0 spawns (`getToken`); button 1 is "×" (`noScript`). | TTS | UI |
| `noScript()` | 90 | Guarded `clearButtons`. | button 1 | UI |
| `getToken(obj,ply)` | 105 | Guarded. `spawnObjectJSON(tokenJSON)` 3.2 units in front of the card, at the card's rotation (line 120). | button 0 | **spawns a token card** (FaceURL plus `Memo` oracle_id) |

**The Marshal** uses the same template with different line numbers: `The_Marshal_…___99809a.lua`, 99809a (Guardian), 3314 lines.
- `deckJSON` (1-3249) is an embedded "1/1 Tokens" deck of about 57 tokens: Beeble, Brainiac, Cat, Citizen, …
- `onLoad` 3251 ("spawn 1/1 tokens"), `noScript` 3283, `getToken` 3298. It spawns the whole deck, raised 0.5.

### Template C: two-token identities

| File | Layout | Notes |
|---|---|---|
| `The_Beastmaster_…___a8422e.lua` (179), a8422e (Assassin) | `json1` 1, `json2` 56; `onLoad` 111 ("spawn some beasts"), `noScript` 143, `getToken` 158 | `getToken` spawns both Beast tokens, at ±1.2 right of the card (lines 176-182). **Bug:** `json2` has `"Transfaworm"` instead of `"Transform"` (line 59), so the second token ignores its transform block. |
| `The_Chaos_Bringer_…___1254e2.lua` (212), 1254e2 (Leader) | `json1` 1 (Goat), `json2` 58 (Treasure); `onLoad` 115, `noScript` 163, `getToken1` 178, `getToken2` 196 | Two separate buttons, "spawn goat" and "spawn treasure". Both share the guard state. |
| `The_Gatekeeper_…___ed4631.lua` (178), ed4631 (Traitor) | `tokenJSON` 1, `gatekeeperToken` 58 (**unused**); `onLoad` 115, `noScript` 147, `getToken` 162 | Spawns one Cerberus token (`tokenJSON`). |

### Template D: The Gathering

`The_Gathering_…___d8427d.lua` (366 lines), d8427d (Leader).

**Overview.**
- Five colour buttons track "choose one that hasn't been chosen": a double-click hides that colour.
- Red also spawns 3 Goblins (`json1/2/3` at 1, 56, 111).
- **Buttons:** 0 white, 1 blue, 2 black, 3 red, 4 green, 5 "×".

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 167 | `noencode=true`. Creates the 6 buttons. | TTS | UI |
| `noScript()` | 247 | Guarded `clearButtons`. | button 5 | UI |
| `white(obj,ply)` | 262 | Guarded. Shrinks button 0 to 0×0. | button 0 | UI |
| `blue(obj,ply)` | 281 | Guarded. Shrinks button 1. | button 1 | UI |
| `black(obj,ply)` | 300 | Guarded. Shrinks button 2. | button 2 | UI |
| `green(obj,ply)` | 319 | Guarded. Shrinks button 4. | button 4 | UI |
| `red(obj,ply)` | 337 | Guarded. Shrinks button 3, then spawns `json1/2/3` at −2.4, 0 and +2.4 right of the card. | button 3 | **spawns 3 tokens** |

### Template E: The Wearer of Masks

`The_Wearer_of_Masks_…___e8fe44.lua` (890 lines), e8fe44 (Traitor).
- `traitorJSON` (1-690) is an embedded deck of Traitor identities.
- `gatekeeperToken` (691) and `grenadierToken` (748) are the companion tokens.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 806 | `noencode=true`. Button "unveil" (`getTraitors`) and "×" (`noScript`). | TTS | UI |
| `noScript()` | 838 | Guarded `clearButtons`. | "×" | UI |
| `getTraitors(obj,ply)` | 853 | See the steps below the table. | "unveil" | **spawns cards, deals them into the hand, destroys the deck** |

How `getTraitors` works (guarded):
1. `traitorDeck = spawnObjectJSON(traitorJSON)` above and in front of the card, face down (rot z=180).
2. Reseeds and warms up the RNG, then calls `shuffle()` five times.
3. Four times: `c = traitorDeck.takeObject()` and `c.deal(1, ply, 1)`. If the name contains gatekeeper or grenadier, also spawn the matching token and deal it to the clicker.
4. `traitorDeck.destruct()`.

**Possible bug** (notes): `takeObject` runs in the same frame as the spawn.

**Engine (all identities):** ✋ manual layer. ⛔ The spawn buttons in engine mode (gate `getToken*`, `red`, `getTraitors` on `ENGINE_MODE`): they create cards the engine doesn't know about. The token JSON (FaceURL plus `Memo` oracle_id) is still usable as an image source.

## 5.3 Planechase memory bag

| | |
|---|---|
| **GUID** | b7ccfb |
| **Object** | Custom_Model_Bag |
| **File** | `Planechase__b7ccfb.lua` (547 lines). Directsun utility memory bag v2.6.0, forked from MrStump's Memory Bag 2.0. |

**Overview.**
- Remembers the position, rotation and lock state of a set of objects. **Unpack** lays them out; **Pack Up** recalls them.
- The memory includes the planar die bag 2230a8 and the Eternities Map.
- **State:** `script_state = {"ml": {guid: {pos, rot, lock}}}` (6-8).

**Buttons.**
- Setup mode: Cancel, Submit, Add, Selection, Set New, Remove, Reset, plus one `selectButton_<n>` on each object.
- Memory mode: Unpack (`buttonClick_place`), Pack Up (`buttonClick_recall`), "s" (setup), "m" (transpose).

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `updateSave()` | 5 | `script_state = {ml=memoryList}`. | add, remove, reset, setNew, submit | save |
| `combineMemoryFromBagsWithin()` | 11 | For each contained object with a `lua_script_state` holding `ml`, merges its entries into `memoryList`. | add, submit | W: `memoryList` |
| `updateMemoryWithMoves()` | 26 | `memoryList = memoryListBackup`. Shifts every entry by how far the `moveGuid` object moved (rotation shift commented out). Then `moveList={}`. | submit | W: `memoryList` |
| `onload(saved_data)` | 52 | `fresh=true`. Decodes `ml`. `moveList={}`, `moveGuid=nil`. If memory is empty, `createSetupButton`; otherwise `fresh=false` and `createMemoryActionButtons`. | TTS | UI |
| `createSetupButton()` | 79 | "Setup" button, callback `buttonClick_setup`. | onload, cancel, reset | UI |
| `buttonClick_transpose()` | 88 | Broadcasts the instructions. Backs up memory, clears `memoryList` and `moveList`, `clearButtons`, then `createButtonsOnAllObjects(true)` and `createSetupActionButtons(true)`. | "m" | UI, broadcast |
| `buttonClick_setup()` | 100 | Backs up memory, clears it, then creates the selection buttons on **all** objects and the setup action buttons. | Setup, "s" | UI |
| `getAllObjectsInMemory()` | 108 | Returns the objects for the GUIDs in `memoryListBackup` (may contain nil). | `createButtonsOnAllObjects` | none |
| `createButtonsOnAllObjects(move)` | 122 | For each candidate object (memory only in move mode, otherwise `getAllObjects()`), excluding self: works out the bag-local position (`findOffsetDistance`, `rotateLocalCoordinates`, scale, +0.5 for PDFs), registers `selectButton_<n>` via `self.setVar` as a closure calling `buttonClick_selection(obj,move)` (154-160), creates the button, and records it in `buttonIndexMap`. | setup, transpose | many buttons |
| `createSetupActionButtons(move)` | 173 | Cancel and Submit always. If not move: Add and Selection, plus Set New and Remove when not `fresh`. Reset always. | setup, transpose | UI |
| `buttonClick_selection(obj,move)` | 225 | Toggles `obj` in `theList`: `moveList` in move mode, where only one object is allowed and the previous one is un-highlighted and removed. Otherwise `memoryList`. On select: green button, store pos/rot/lock (rounded to 4 places), green highlight. On deselect: red or blue button, remove, highlight off. W: `previousGuid`, `selectedGuid`, `previousIndex`, `theList`. | `selectButton_n` | edit, highlight |
| `editDragSelection(bagObj,player,remove)` | 267 | Adds the player's drag selection to `memoryList` (or, if `remove`, removes it), with the same button and highlight handling. A right-click passes `remove=true`. | "Selection" | edit, highlight |
| `buttonClick_cancel()` | 300 | Restores the backup, rebuilds the right buttons, clears every highlight on the table, broadcasts. | Cancel | UI, broadcast |
| `buttonClick_submit()` | 315 | See the steps below the table. | Submit | **moves objects**, save, broadcast |
| `combineTables(a,b)` | 356 | Copies b's keys into a. | add | none |
| `buttonClick_add()` | 360 | Merges the backup into the new selection, then merges the inner bags. Rebuilds, counts, broadcasts, saves. | Add | save |
| `buttonClick_remove()` | 377 | Removes the currently selected GUIDs from the backup, restores it, broadcasts the count, saves. | Remove | save |
| `buttonClick_setNew()` | 393 | For every table object in the backup, overwrites the saved pos/rot/lock with its current values. Restores and saves. W: global `guid`. | Set New | save |
| `buttonClick_reset()` | 413 | `fresh=true`, empties memory, shows the Setup button, clears highlights, saves. | Reset | **wipes memory** |
| `createMemoryActionButtons()` | 428 | Unpack, Pack Up, "s", "m". | many | UI |
| `buttonClick_place()` | 452 | For each memory entry: if the object is on the table, `setPositionSmooth`/`setRotationSmooth`/`setLock`. If it's in the bag, `takeObject{guid, position, rotation, smooth=false}`, then `setLock`. Broadcasts "Objects Placed". | Unpack, submit | **moves and unpacks objects** |
| `buttonClick_recall()` | 478 | `self.putObject(obj)` for every memory object on the table. Broadcasts. | Pack Up | **bags objects** |
| `findOffsetDistance(p1,p2,obj)` | 491 | Returns p2−p1, with y adjusted by the object's bounds when `obj` is given. | several | none |
| `rotateLocalCoordinates(desiredPos,obj)` | 505 | Rotates (x, z) by `obj`'s y-rotation. Returns `{x,y,z}`. | `createButtonsOnAllObjects` | none |
| `rotateMyCoordinates(desiredPos,obj)` | 514 | A broken variant: multiplies by sin and cos separately. Unused. | none | none |
| `wait(time)` | 522 | Coroutine sleep. Unused. | none | none |
| `duplicateTable(oldTable)` | 528 | Shallow copy. The nested pos/rot tables stay shared, which is why `updateMemoryWithMoves` changes the backup too. | setup, transpose | none |
| `removeAllHighlights()` | 537 | `highlightOff` on **every** object. | cancel, reset | clears every highlight |
| `round(num,dec)` | 544 | Rounds to `dec` decimal places. | selection, drag selection, moves | none |

How `buttonClick_submit` works (`fresh=false`):
1. **If `moveList` has entries (transpose):** take its GUID. If that GUID isn't in the backup, broadcast an error. Otherwise rebuild, un-highlight, `updateMemoryWithMoves`, `updateSave`, `buttonClick_place()`.
2. **Else if nothing was selected:** restore the backup and broadcast "No selections made".
3. **Then always:** merge the inner bags, rebuild, un-highlight, broadcast "N Objects Saved", save, `moveGuid=nil`.

**Engine:** ✅ KEEP. If the engine runs Planechase, gate `buttonClick_place` (452) so the bag doesn't lay out a TTS planar deck of its own. The `removeAllHighlights` calls would also wipe engine highlights.

## 5.4 Planechase Eternities Map

| | |
|---|---|
| **GUID** | bae9e7, inside b7ccfb |
| **Object** | Custom_Tile |
| **File** | `Planechase_Eternities_Map__bae9e7.lua` (495 lines). By Tispy Hobbit, node maths reworked by PieHere. |

**Overview.**
- A manual planar map. "gather the planes" grabs the planar deck from a scripting zone over the map.
- Eight arrows shift the map and deal new planes into the empty slots next to the centre.
- There is no planar die logic. The map has a TV mode (upright) and a lock button.
- **State** (returned by `onSave`): `{"Zonesdeck": zoneGUID, "Deck": deckGUID, "Nodes_<x:z>": cardGUID…}`. Saved value: `{"Zonesdeck":"a1de13"}`.

**Module data** (lines 4-27):
- `compass`: 8 directions, each with a local vector.
- `compT`: the 4 orthogonal directions.
- `compO`: the diagonals.
- `compN`: reverse lookup.
- `nodeTable`, `graveList`, `centerNode`, `deckScript` (the zone), `nodeDepth=3`, `deck`.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload(save_data)` | 29 | Saves `oldRot`/`oldPos`. Fills `compN`. `centerNode = createNode(3)`, `prepFunctions()`. From the save: `deckScript`, `deck`, and each node's card. Then `createZones`, `createButtons`. | TTS | may spawn a zone, UI |
| `onSave()` | 59 | Returns the JSON above. Errors if `deckScript` is nil. | TTS | none |
| `onDestroy()` | 71 | Destroys the zone. Makes the deck interactable again. | TTS | destroys the zone |
| `onObjectDestroy(obj)` | 79 | If the destroyed object is the deck: destroys every card on the map, clears the nodes, `deck=nil`, `createButtons`. | TTS | **destroys plane cards** |
| `prepFunctions()` | 94 | Registers the global closures `_G["move"..dir]`, which call `shiftMap(dir)`, for the 8 directions (`moveTS`, `moveTN`, `moveTW`, `moveTE`, `moveSW`, `moveSE`, `moveNW`, `moveNE`). | `onload` | none |
| `createNode(dist,prev,dir)` | 102 | Recursively builds a diamond of nodes up to Manhattan distance `dist`. Each node: `l_pos`, `g_pos` (from `l_pos2g_pos`), `dis`, `sca = 1 − 0.1·dis`, `adj` (all 8 neighbours, filled after recursion), `card`, `name`. Returns the node. W: `nodeTable`, globals `v` and `dPose`. | `onload` | none |
| `nodeName(pos)` | 130 | Returns `"x:z"`. | several | none |
| `recalcNodePos()` | 134 | Recomputes every `g_pos` and the global `cardRot = getCardRot()`, then `moveCards()`. | collision, lock, TV, reset | moves cards |
| `onCollisionEnter(cI)` | 145 | Creates the zone if missing, otherwise moves it onto the map. Then `recalcNodePos`, `createButtons`. | TTS | moves the zone and cards |
| `createZones()` | 155 | If there's no `deckScript`, spawns a `scriptingTrigger` at the map, scaled to it (rotation `cardRot`, nil the first time). | `onload`, collision | **spawns a zone** |
| `createButtons()` | 167 | `clearButtons`. **No deck:** 4 "gather the planes" buttons (`getDeck`). **Deck present:** ⌂ (`lockMat`), RESET (`reset`), TV (`tvMode`), 4 orthogonal arrows as shadow and main pairs (`moveT*`), and 4 diagonal arrows (`moveNW/SW/NE/SE`), each only when its corner node is empty. | many | UI |
| `getDeck()` | 215 | Picks up any `Deck` in the zone as `deck`. Broadcasts "place the deck somewhere safe…". Rebuilds. | gather buttons | broadcast |
| `lockMat()` | 225 | Toggles `interactable` and lock (lock only while locking), along with the deck's `interactable`. Then `recalcNodePos`, `createButtons`. | ⌂ | lock |
| `tvMode()` | 242 | Only when resting. Unlocks with gravity off. If roughly flat: save the old pose, stand the map up at x=80 (raised and shifted). Otherwise go back to `oldPos`/`oldRot` (with defaults). Then `Wait.condition(lockInPosition, checkResting)`. | TV | moves self |
| `checkResting()` | 278 | Returns `self.resting`. | `tvMode` | none |
| `lockInPosition()` | 281 | Lock, gravity on. After 30 frames: `recalcNodePos` and `createButtons`. | `tvMode` | lock, moves cards |
| `reset()` | 288 | Moves every node card into `graveList` and clears the nodes. `recalcNodePos`, which sends the grave cards back onto the deck. Unlocks the deck, `deck=nil`, rebuilds. | RESET | moves cards |
| `shiftMap(dir)` | 307 | Only with a deck. Snapshots node→card. Each node takes the card of its neighbour opposite to `dir`; a card with no node in direction `dir` goes to `graveList`. Then `moveCards()`. For the 4 nodes next to the centre, deals a face-up card into any empty one. **`hellride` is always true**: the loop compares the numeric index `k` with the string `dir` (330-333), so the centre is also refilled if empty. Then `createButtons`. | `move*` closures | **deals and moves planes** |
| `moveCards()` | 345 | For each placed card not yet at its node: smooth-move it there, set rotation `cardRot`, scale by `sca·matScale/12`, `use_hands=false`, and highlight only the centre card blue. Flips it face up if needed. Each `graveList` card is flipped face down, smooth-moved 4 above the deck, unlocked, and scaled to the deck. Returns 1. | `shiftMap`, `dealCard`, `recalcNodePos` | **moves cards** |
| `dealCard(node,flip)` | 380 | `enc = Global.getVar('MTGEncoder')`. **Wrong name**: Global's variable is `Encoder`, so `enc` is nil and the encoder branch (395-399) never runs. `deck.randomize()`. `node.card = deck.takeObject{position, rotation=cardRot, flip, top=true}`. Lock and scale it, then `moveCards()`. | `shiftMap` | **takes a card from the deck** |
| `addVectors(a,b)` | 405 | Returns the component-wise sum. | many | none |
| `multVector(a,b)` | 408 | Component-wise product; a number `b` is broadcast to all components. | many | none |
| `upright(ent)` | 415 | Returns the sign of `transformUp.y` (+1 face up, −1 face down). | `moveCards`, `flipEnt` | none |
| `flipEnt(ent)` | 418 | Rotates z by +180 and nudges y by ±0.2. | `moveCards` | moves |
| `waitFrames(num_frames)` | 429 | Coroutine frame wait that checks the global `destroying`. Unused. | none | none |
| `null()` | 440 | No-op. | none | none |
| `sign(a)` | 443 | Returns −1 or 1. | `diminish` | none |
| `diminish(a)` | 451 | `a − sign(a)·a²·0.05`: compresses far-away nodes. | `l_pos2g_pos` | none |
| `l_pos2g_pos(l_pos,dis)` | 455 | Converts a grid position to a map-relative offset: x·−0.3, z·−0.2 (scaled), y = (3−dis)·0.5+0.2, rotated by the map's axes. | `createNode`, `recalcNodePos` | none |
| `getCardRot()` | 473 | Derives Euler angles for cards lying flat on the map from its right/forward/up vectors. | `recalcNodePos` | none |

**Engine:** ⛔ the movement. 🔁 / ♻️ reuse the visuals (`l_pos2g_pos` 455, `getCardRot` 473, `moveCards`, the highlight, TV mode) to show the engine's current plane(s). Forge implements standard Planechase but not the Eternities Map.

## 5.5 Custom Dice (planar die)

| | |
|---|---|
| **GUID** | 4a0860, inside 2230a8 (the planar die bag, in Planechase memory) |
| **Object** | Custom_Dice |
| **File** | `Custom_Dice__4a0860.lua` (53 lines) |

**Overview.**
- After a roll it prints "<colour> paid N mana for Planeswalk/Chaos/Nothing" (face 1 = Planeswalk, 6 = Chaos).
- The mana counter resets when a different player rolls, or at turn change.
- **Module globals:** `player="Black"`, `timesRolled=0`, `side`, `text`, `randomized=false`.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onObjectRandomize(Object,player_color)` | 7 | For this die only. If the roller differs from `player`, `changePlayer`. If not already rolling, sets `randomized=true` and starts the `afterDrop` coroutine. | TTS | tint |
| `afterDrop()` | 19 | Yields until resting, `randomized=false`, `printDiceFace()`, then returns 1. | coroutine | chat |
| `printDiceFace()` | 28 | `getValue()` maps to the face name. Prints the line in the die's tint, then `timesRolled += 1`. | `afterDrop` | `printToAll` |
| `changePlayer(new)` | 42 | `player=new`, `timesRolled=0`, tint to `new`. | `onObjectRandomize` | tint |
| `onPlayerTurn(new)` | 50 | `player=new`, `timesRolled=0`. **Bug:** `new` is a Player object, so the string concatenation at 37 errors on the next roll unless the roller's colour differs (which calls `changePlayer`). | TTS | none |

**Engine:** Irrelevant unless playing Planechase (notes). If the engine runs Planechase, it rolls the planar die itself.

## 5.6 Dungeons: one template, 5 cards

| | |
|---|---|
| **Undercity** | 2db63a, 256 lines |
| **Dungeon of the Mad Mage** | d075c6, 257 lines |
| **Lost Mine of Phandelver** | df09d5, 230 lines |
| **Tomb of Annihilation** | 91aaed, 203 lines |
| **Baldur's Gate Wilderness** | d3959e, 404 lines |
| **Object** | Card, loose at x≈−52.9 |

**Overview.**
- Each room is a transparent button with the room text as its tooltip.
- Clicking a room toggles **one** marker, shaded in the clicker's colour. There is no adjacency check, only one marker for all players, and no initiative tracking.
- Some rooms spawn tokens from the card's `script_state`, which is a Scryfall `list` JSON of related tokens.
- **State:** `self.memo = pressedButton` (the room index, 0 = none). Saved value: `'1'`.
- `createButtons` and `spawnTokens`/`setOracle` are identical across the five files, except for a debug `print(cardName)` in Baldur's Gate (388).

| Function | Line (Undercity) | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | `enc = Global.getVar('Encoder')` (unused), `noencode=true`, `pressedButton = tonumber(self.memo)`. Sets `colDown` (white 0.5), `colUp` (clear), `positions`, `width_height`, `labs`. Then `createButtons`. Lost Mine declares `onLoad(saved_data)` but ignores the argument. | TTS | UI |
| `createButtons()` | 50 | `self.memo = pressedButton`, `clearButtons`. One "✘" button per room, callback `press<i>`, coloured `colDown` if i is the pressed room. | `onLoad`, every `press` | memo write, UI |
| `setCol(ply)` | 81 | `colDown` = the clicker's colour at alpha 0.5. | every `press` | none |
| `press<i>(obj,ply)` | 87… | `setCol`. If i is already pressed, clear it to 0; otherwise set it to i, and **spawn tokens for the token rooms**. Then `createButtons`. | room buttons | marker, maybe spawns |
| `doNothing()` | 179 | No-op, unused. | none | none |
| `spawnTokens(inds)` | 185 | Returns unless `script_state` contains `"object":"list"`. For each card n in `json.data` whose index is in `inds`: builds Card data in the Card Importer format (Nickname "Name\nType NCMC", Description via `setOracle`, Memo oracle_id, `CustomDeck` FaceURL with a date cache-buster for non-highres scans, the card's own back). Double-faced cards get a state 2 (front and back swapped if the URLs are reversed). Then `spawnObjectData` 3.2 units in front of the card. | token rooms | **spawns tokens** |
| `setOracle(cardDat)` | 246 | Returns oracle text, plus `\n[b]P/T[/b]` or loyalty when present. | `spawnTokens` | none |

**Per dungeon** (room lines and token rooms):

| Dungeon | `script_state` tokens | `press` lines | Token rooms |
|---|---|---|---|
| Undercity | 1 Treasure, 2 Skeleton | 87, 97, 107, 117, 127, 137, 148, 158, 169 | press6 Stash → {1} (143); press8 Catacombs → {2} (164) |
| Mad Mage | 1 Treasure, 2 Skeleton | 87, 97, 107, 118, 128, 138, 148, 160, 170 | press3 Goblin Bazaar → {1} (113); press7 Muiral's Graveyard → {2} twice (154-155) |
| Lost Mine | 1 Treasure, 2 Goblin | 80, 90, 101, 112, 122, 132, 142 | press2 Goblin Lair → {2} (96); press3 Mine Tunnels → {1} (107) |
| Tomb | 1 The Atropal | 75, 85, 95, 105, 115 | press5 Cradle of the Death God → {1} (121) |
| Baldur's Gate (19 rooms) | 1 Knight, 2 Faerie Dragon, 3 Treasure, 4 Treasure, 5 Skeleton | 131, 141, 152, 163, 173, 183, 193, 205, 215, 225, 235, 246, 256, 266, 276, 286, 297, 307, 317 | press2 Goblin Camp → {3} (147); press3 Emerald Grove → {1} (158); press7 Ebonlake Grotto → {2} twice (199-200); press11 Reithwin Tollhouse → {4} once (241); press16 Undercity Ruins → {5} once (292) |

Other function lines (`createButtons` / `setCol` / `doNothing` / `spawnTokens` / `setOracle`):
- Mad Mage: 50 / 81 / 180 / 186 / 247
- Lost Mine: 44 / 75 / 153 / 159 / 220
- Tomb: 38 / 69 / 126 / 132 / 193
- Baldur's Gate: 94 / 125 / 327 / 330 / 394

**Bugs.**
- Baldur's Gate Reithwin Tollhouse should create 2d4 Treasures but spawns 1.
- Baldur's Gate Undercity Ruins should create three Skeletons but spawns 1.
- Baldur's Gate has a debug `print` (388).
- `tonumber(self.memo)` returns nil on a card with an empty memo. A nil marker never compares equal, so it is harmless until the first click.

**Engine:** 🔁 drive the marker from the engine: set `pressedButton`, call `createButtons`. **Never call `press<i>`**, because it spawns tokens. ⛔ token spawning and free clicking: Forge resolves venture, initiative and room effects itself. ♻️ reuse `positions`/`width_height`/`labs` (room → rectangle), and turn a room click into the answer to the engine's "choose next room" prompt. Still needed: one marker per player, an initiative indicator, a completed-dungeon count.

---

# 6. Fun and misc

## 6.1 Dice (d20 / d12 / d10 / d8 / d6)

| File | GUIDs | Settings |
|---|---|---|
| `Die_20__8f8d5d.lua` (16) | 8f8d5d, in 1d701a and ae70ca | flash, sound and chat log **on**; `parent_guid` "2391b9" |
| `Die_12__b607cb.lua` (16) | d12 b607cb (5c471e, e3ecb3); d8 aa9563 (14da25, fcd8d9); d6 c59653 (979e78, b8b9ed) | all off; `parent_guid` "card01" |
| `Die_10__b3e98f.lua` (16) | b3e98f, in 544ef3 and 64d53e | identical to Die_12 |

**Overview.**
- A minified "3D-text roll value" script. Every function after `onLoad` is on **line 15**.
- When the die comes to rest it spawns a floating 3D text with the result, which rises, spins, grows, and then destroys itself.
- Optionally it prints "[colour] X rolled a N", flashes on a maximum roll, and plays sounds through `parent_guid`'s AssetBundle.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Sets `lifespan=3`, `spin_speed=3`, `rise_speed=1`, `grow_speed=2`, `font_size=3`, the flash/sound/log flags, `parent_guid`, `roll_active=false`, and `rv = getRotationValues()`. | TTS | none |
| `onDrop(a)` | 15 | `trigger(a)`. | TTS | via `trigger` |
| `onRandomize(a)` | 15 | `trigger(a)`. | TTS | via `trigger` |
| `trigger(a)` | 15 | Returns false if a roll is active. Sets `roll_active`. When resting (30 s timeout, which logs and clears): logs and returns if there are no rotation values. Spawns `3DText` above the die with the value, tint and size. After 1 frame: non-interactable, `rise`, `spin`, `grow`, `log`, and optionally `printToAll`. On a max roll, optionally `flash` the die and text and play trigger effect 0. On a 1, optionally effect 1. Destructs the text after `lifespan`. | `onDrop`, `onRandomize` | **spawns and destroys 3D text**, chat |
| `rise(d,c)` | 15 | Moves the text up by `rise_speed/100` each frame until it's gone. | `trigger` | moves |
| `spin(d,f)` | 15 | `setRotationSmooth` every 0.5 s. | `trigger` | rotates |
| `grow(d,font_size)` | 15 | Font grows ×1.02 every 0.1 s. | `trigger` | edit |
| `flash(d,g)` | 15 | Alternates the tint and a random colour every 0.2 s for 20 steps (font colour for text, a highlight for objects). | `trigger` | highlight |
| `randomColor()` | 15 | Returns a random RGB. | `flash` | none |

**Engine:** ✅ Keep. The 3D-text roll animation could be reused (notes).

## 6.2 Quarter

| | |
|---|---|
| **GUID** | 227d07, inside 9cf532 |
| **File** | `Quarter__227d07.lua` (27 lines) |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onObjectRandomize(obj)` | 1 | If `obj` is this coin: a random spin split over the axes with random signs. Launch power = the description as a number (`pcall`), default 30. `setVelocity({0,pow,0})` and `setAngularVelocity(spin)`. W globals: `success`, `pow`, `launchVelocity`. | TTS | physics |

**Engine:** ✅ Keep.

## 6.3 Custom_Tile (workshop link)

| | |
|---|---|
| **GUID** | 7cf430 |
| **File** | `Custom_Tile__7cf430.lua` (75 lines) |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | **Line 2 ends in a stray comma**, so it parses as `link = '<url>', self.setName(link)`. `setName` is evaluated **before** the assignment, with `link=nil`, which is why the saved name is `''`. `setDescription(link)` then works. Creates a large invisible button, callback `showLink`. | TTS | rename, UI |
| `showLink()` | 20 | Creates a read-only-style input holding the URL (callback `null`, tooltip "ctrl-C"). Swaps the button to `hideLink`. Auto-hides after 10 s (`wid`). | button | UI |
| `hideLink()` | 54 | Stops `wid`. Clears the inputs and buttons. Restores the `showLink` button. | button, timer | UI |
| `null()` | 74 | No-op (input callback). | input | none |

**Engine:** ✅ Keep.

## 6.4 Rhystic Block

| | |
|---|---|
| **GUID** | 1fc1e0, inside 63bc71 and bc8aef |
| **File** | `Rhystic_Block_1__1fc1e0.lua` (25 lines). By Amuzet. |

**Overview.**
- A numbered block. When dropped, it broadcasts "Did You Pay N?".
- **State:** `script_state = [count]`. Saved value: `[1]`.
- **Top-level code** (lines 2-7) sets `mod_name`, `version` and `author`, renames the object "Rhystic Block 1", and defines `B`: a button-parameter table whose metatable `__call` creates a button `(label, tooltip, position, click_function)`.

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onPickedUp(player_color)` | 10 | `setDescription(player_color)`. | TTS | description |
| `onSave()` | 11 | Assigns `self.script_state = [count]` instead of returning a string. The saved value `[1]` shows the state survives. | TTS | save |
| `onLoad(s)` | 12 | `count` from the save. `B(count, tooltip, nil, 'cng')` creates the button. | TTS | UI |
| `onDrop(c)` | 16 | Tints to the description colour. `broadcastToAll("Did You Pay N?")` in the dropper's colour. | TTS | tint, broadcast |
| `cng(o,c,a)` | 22 | `count ±= 1`, then relabels button 0. | button | edit |

**Engine:** Irrelevant in engine mode (notes): it's an honour-system reminder. Keep it bagged.

## 6.5 Bruh Button

| | |
|---|---|
| **GUID** | 5a7db4 |
| **Object** | Custom_Assetbundle |
| **File** | `Bruh_Button__5a7db4.lua` (62 lines). Based on MrStump's "Big, Animated Button". |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `buttonPress()` | 2 | If `lockout == false`: play trigger effect 0 (the sound), `lockout=true`, `startLockoutTimer()`. | 8 buttons | sound |
| `onload()` | 12 | `interactable=false`. 8 invisible 730×730 buttons rotated in 11.25° steps (14-45) to approximate a round hit area. `lockout=false`. | TTS | UI |
| `startLockoutTimer()` | 50 | `Timer.create{identifier=guid, function_name='unlockLockout', delay=0}`. A delay of 0 means there's effectively no lockout. | `buttonPress` | timer |
| `unlockLockout()` | 55 | `lockout=false`. | timer | none |
| `onDestroy()` | 60 | `Timer.destroy(guid)`. | TTS | none |

**Oddity.** It uses the deprecated `Timer` API.

**Engine:** ✅ Keep.

## 6.6 hold alt

| | |
|---|---|
| **GUID** | fb6538, high above the table (y=47.8) |
| **File** | `hold_alt__fb6538.lua` (16 lines) |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Transparent, non-interactable. One 0×0 button labelled "hold [Alt] to view these panels easier", callback `nothing`. | TTS | UI |
| `nothing()` | 16 | No-op. | button | none |

Table Instructions "×" destroys it (§6.9). **Engine:** ✅ Keep.

## 6.7 Human-Time Lord Meta-Crisis Phenomenon / The Golden City of Orazca

| | |
|---|---|
| **GUIDs** | 2f4321 (in 5d0afc); c09f41 "The Golden City of Orazca" (in 7a3e43). Both are Card objects that share this file. |
| **File** | `Human-Time_Lord_Meta-Crisis_Phenomenon_0CMC__2f4321.lua` (83 lines) |
| **Overview** | The Card Importer's per-card "spawn related tokens" script. `script_state` holds a Scryfall `list` of tokens: Human-Time Lord has `Copy`; Golden City has `Treasure` and `City's Blessing`. |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Creates the "T" (spawn token) button **only if `Global.getVar('Encoder')` is nil**. On this table the Encoder exists, so there's normally no button. | TTS | UI |
| `spawnTokens()` | 19 | The same as the dungeon `spawnTokens` (§5.6), but spawns **every** token in the list. | "T" | **spawns tokens** |
| `setOracle(cardDat)` | 72 | Same as §5.6. | `spawnTokens` | none |

**Engine:** Irrelevant in engine mode (notes). The script is inert because the Encoder is present. If the button ever appears, gate `spawnTokens`.

## 6.8 Pirate Cannon

| | |
|---|---|
| **GUID** | 540e21, at (−60, 0.7, 0) |
| **Object** | Custom_Assetbundle. Description "Power: 60". |
| **File** | `Pirate_Cannon__540e21.lua` (429 lines) |

**Overview.**
- "Load" moves the clicker's selected (or previously loaded) unlocked small objects into the barrel. "Fire!" launches them with a random spin.
- Hitting the vent hole also fires the cannon.
- **Turn hook:** if the launched object is the "goes first!" die, once the die stops the cannon sets `Turns.enable=true` and `Turns.turn_color` to the player whose Steam name the die shows (205-219).

**Module data** (lines 1-33):
- `fx` (trigger effect ids)
- `settings`: barrel and muzzle offsets, spin range, colours, `useRecoil=false`
- `help` strings (`buttonFire` is missing, so the Fire tooltip is nil)
- runtime tables, `isFiring`

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 35 | `CreateButtons()`, `self.tooltip=false`. | TTS | UI |
| `FireCannon(obj,color)` | 40 | Returns if already firing. `(power, vel) = CalcPowerAndLaunchVelocity(color)`. If power > 0: `isFiring=true`, play effect `Fire`, `LaunchBarrelContents(vel)`, `AfterFire()`. | Fire buttons, `onCollisionEnter` | sound, launch |
| `AddObjects(obj,color)` | 55 | Gets the current barrel contents and the clicker's selection, filtered by `GetFirableObjects`. If any: remembers them per colour. Otherwise reuses that colour's memory, then the "no color" memory. If nothing: `broadcastToColor(nothingSelected)` and return. Collects objects not already in the barrel, locks the cannon, `Shuffle`s them, then `MoveTableToBarrel`. | Load buttons | lock, moves objects |
| `LaunchBarrelContents(launchVelocity)` | 91 | For each barrel object: a random spin between `minSpin` and `maxSpin`, then `LaunchObject`. | `FireCannon` | launch |
| `AfterFire()` | 99 | With recoil (off): Recoil, Reset and Lock timers. **Bug:** this path uses `self.GetGUID` and the nil global `power`. Otherwise: a Reset timer at 2.5 s. | `FireCannon` | timer |
| `CalcPowerAndLaunchVelocity(color)` | 113 | Direction = forward rotated 45° about right. Parses `Power: a[-b]` from the description. If it's unreadable: error broadcast and print, return 0. Power is random in [min, max]; if ≤ 0, broadcast and return 0. Returns `(power, velocity)`. | `FireCannon` | broadcast |
| `CreateTimer(timerName,funcName,delay,params)` | 136 | Wraps `Timer.create`, the deprecated API. | `AfterFire`, `MoveTableToBarrel` | timer |
| `Reset()` | 151 | With recoil: smooth-moves back to the launch pose. `isFiring=false`. | timer | maybe moves |
| `Lock()` | 159 | `setLock(true)`, interactable. | timer (recoil only) | lock |
| `Unlock()` | 164 | Non-interactable, unlocked. Unused (its timer is commented out). | none | lock |
| `ToggleLock()` | 169 | Toggles the lock. Its button is commented out. | none | lock |
| `Recoil(args)` | 173 | Pushes the cannon backwards with power `args.power/2+3`. | timer (recoil only) | velocity |
| `LaunchObject(thisObj,launchVelocity,launchSpin)` | 186 | Skips self. Random signed spin, then `setVelocity` and `setAngularVelocity`. **If the name is "goes first!"**: non-interactable; after 5 frames and once resting, interactable again, read `getRotationValue()`, and find the player with that `steam_name`. Then `Turns.enable=true` and `Turns.turn_color = ply.color`. | `LaunchBarrelContents` | physics, **writes `Turns`** |
| `GetBarrelContents()` | 225 | `Physics.cast` sphere from the barrel offset along the launch direction. Returns `(set of guids, count)`, excluding self. | `AddObjects`, `LaunchBarrelContents` | none |
| `GetFirableObjects(t)` | 252 | Keeps the unlocked objects for which `IsSmallEnough` is true. Returns `(set, count)`. | `AddObjects` | none |
| `IsSmallEnough(obj)` | 266 | Normalised bounds must be under `scale.x*1.8` on every axis. Prints "too large" otherwise. | `GetFirableObjects` | print |
| `MoveTableToBarrel(params)` | 279 | Pops one object. If it's unlocked, smooth-moves it to a random point between the muzzle offsets. Schedules itself again after 0.2 s for the rest. | `AddObjects`, timer | moves |
| `CreateButtons()` | 300 | 3 "Fire!" buttons (`FireCannon`) and 3 "Load" buttons (`AddObjects`) at angles around the barrel. The Lock button is commented out. | `onload` | UI |
| `onPickedUp(player_color)` | 362 | Loops effect `Move`. | TTS | sound |
| `onDropped(player_color)` | 366 | Loops effect `Idle`. **Note:** the TTS event is `onDrop`, so this may never fire. | TTS | sound |
| `onCollisionEnter(hit)` | 370 | When not firing: if a non-Dice object hits the local area y>2.9, z<−1.7 (the vent), `FireCannon(nil,"no color")`. | TTS | fires |
| `Shuffle(t)` | 385 | In-place shuffle. Returns `t`. | `AddObjects` | none |
| `dotProduct(a,b)` | 397 | Returns the 3-component dot product. | `applyMatrixRowsToVec3` | none |
| `applyMatrixRowsToVec3(v,r1,r2,r3)` | 402 | Returns a matrix × vector product. | `rotateVec3` | none |
| `rotationVectors(u,angle)` | 407 | Rodrigues rotation matrix rows. **Typo at 415:** `r3[2]` uses `du[2]*u[2]`, which should be `du[3]*u[2]`. The tilt is slightly wrong unless the axis is axis-aligned. | `rotateVec3` | none |
| `rotateVec3(v,u,angle)` | 420 | Rotates v by `angle` degrees about u. Returns a table with both [1..3] and .x/.y/.z. | `CalcPowerAndLaunchVelocity`, `GetBarrelContents`, `Recoil` | none |

**Engine:** ✅ Keep as a toy. ⛔ the who-goes-first `Turns` write (205-219).

## 6.9 Table Instructions ("×" de-clutter)

| | |
|---|---|
| **GUID** | e40450 |
| **Object** | Custom_Tile, high above the table |
| **File** | `Table_Instructions__e40450.lua` (63 lines) |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onload()` | 1 | `chatInstr` = 7b59f7, `altButton` = fb6538 (hold alt). Makes both interactable. Creates the "×" button with callback `closeSelf` and the tooltip "remove clutter". | TTS | UI |
| `closeSelf(obj,ply)` | 24 | See the list below the table. | "×" | **destroys about 95 objects, moves 25** |

What `closeSelf` does. The commented-out check at 42 used to limit it to Black.

**Destroys (lines 44-50):**
- six room objects: cb1610, a7a029, 4c02f8, a3e6a8, 9c553c, eb479b
- the `unnecessaryStuff` list (26-36). It includes the Treachery container fc40c8, Planechase b7ccfb, the coin bag 9cf532, the Rhystic, dice and counter bags, the draft bag 098c38, the Turn Skipper bag 05b07c, Deck Lister 5006a4 and Custom Tile 7cf430.

Each destroy is wrapped in `pcall`.

**Moves 3 units in −x (52-56):** the `moveThese` list (38-40): the counter and label bags and tokens, 7071ce and 3c7ad3. These calls aren't wrapped in `pcall`, so one missing object aborts the rest.

**Then:** destroys `altButton` and `chatInstr`, and itself one frame later.

**Engine:** ✅ Keep, but don't depend on any of those bag GUIDs: "×" destroys or moves them.

## 6.10 PiecePack_Crowns (anti-malware)

| | |
|---|---|
| **GUID** | 82bf98 |
| **Object** | PiecePack_Crowns, hidden at (0, −100, 0) |
| **File** | `PiecePack_Crowns__82bf98.lua` (67 lines) |

| Function | Line | What it does | Called by | Side effects |
|---|---|---|---|---|
| `onLoad()` | 1 | Moves itself to (0, −100, 0), non-interactable, then `destroyAllbaddies()`. | TTS | moves self |
| `onObjectSpawn(obj)` | 7 | Returns if the script is empty. Flags: `getluascript():reverse`; `setluascript` **without** `global.getvar('encoder')`; `ondestroy(` together with `self.clone(`; `while true do end`. If any flag is set: clear the object's `onDestroy`, clear its script, `destruct` it, then `destroyAllbaddies()`. Then names the closest player by pointer distance, broadcasts a red warning with their Steam name and ID, and shows them an info dialog. Returns false. W globals: the four flags, `players`, `closest`, `pos`, `hand_pos`, `dist`. | TTS (every spawn) | **destroys the spawned object**, broadcast, dialog |
| `destroyAllbaddies()` | 43 | Applies the same pattern scan to `getAllObjects()`, destroying and announcing matches. **Bug (47):** `return` on the first object with an empty script, so the sweep usually stops almost at once. | `onLoad`, `onObjectSpawn` | destroys |
| `distance(p1,p2)` | 63 | Returns the Euclidean distance. | `onObjectSpawn` | none |

**Engine:** ✅ Keep, but objects the renderer spawns **must not** contain any of those patterns, `setluascript` in particular. COMPATIBILITY "must-fix" #5.
