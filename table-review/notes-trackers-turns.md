# Review notes: trackers, zones, turns, hands

Source: subagent review, 2026-10-17. Files are in `table-scripts/`. GUIDs and positions were checked against the full save.

**Bagged and inert until taken out:**
- bag 4f3387: Upkeep Reminders, turn phase announcer, Bag of Tricks
- bag 098c38: draft tools (hand rotator, Rotate Hands, Ready, Reset Readiness)
- bags 05b07c / b653d2: Turn Skipper
- other bags: Rhystic Block, dice, Text/Notecard tokens, per-card counters

**Driving pattern:** `obj.setVar(name, v)`, then `obj.call('<render fn>')`, then `obj.call('updateSave')`. `obj.call` passes only one argument, so where a render function needs more, add a one-line `engineSet(p)` wrapper to that script.

## Driving each tracker from the engine

| Object | GUIDs | Set | Gate |
|---|---|---|---|
| Life tracker | W 23e485, R 448880, Y 37e533, B 395037 | `count`; `sL(l,n)` shows the delta (16-30). **`updateSave` is required**: `onload(script_state)` re-runs on player connect, colour change and Turn Skipper events. Suggested wrapper: `engineSet(p) count=p.life; sL(count,p.delta); updateSave()` | `option` (40), `valueChange1..4` (278-300), `resetLife` (319), `onNumberTyped` (327, never saves), `onChat` drain/extort/set_life/reset_life (122-210) |
| Commander damage (victim, attacker colour) | **White:** b748df (B), 0f6598 (Y), 6b6e1f (R). **Blue:** bfcf4a (W), 8d172a (R), f43e61 (Y). **Yellow:** 906d4b (R), 484c38 (W), 45331a (B). **Red:** d5907a (Y), 95eb63 (B), 4bfa09 (W) | `val` + `updateVal` + `updateSave`. **Never `reset_val`**: it calls `self.reload()` | `add_subtract`, reset buttons, `onNumberTyped`, chat "reset life 40" |
| Spare commander damage | dceed5 family ×8, in infinite bags at x=±53.8 | Same as commander damage | Use for partner commanders |
| Commander zone / tax | W 908f60/ce8ea5, R 9d380e/16aed3, Y baffa9/dc9c6d, B 0c0c5e/3b2d18 | `val`, then `editButton` for i=0..9. **Not saved** (resets on reload), so re-push it | `add_subtract`, chat "reset life 40" |
| Energy / Experience / Poison | no fixed objects; infinite bags at x=−45.5 (5035f1, b3961f, 3cba4d) and x=+45.5 (721688, 444725, bfceec) | Spawn with `LuaScriptState='[true,N,false]'`; then `val` + `updateVal` + `updateSave` | `add_subtract`, `reset_val`, `onNumberTyped` |
| Mana pool / Suspend counters | f07e80 (the bags), a5df2d, 2c49c6 | Same `val` interface (optional) | Click handlers |
| Card-top counters | Loyalty 3aad21; Counter c9128a; Text 808d36; +X/+Y 7c9dfd (`valP`/`valT`, renames itself) | `val` + `updateVal` | Clicks. **Risk:** loose tokens get left behind when the engine moves a card |
| πCounter (counter on the card itself, Encoder) | — | Encode the card, enable prop `πCounter`, `APIobjSetValueData{valueID='picounter'}`, rebuild. Don't use the drop-on token's `toggleProp`: it does `setLuaScript` + `reload` | `add_subtract` (124) |
| Hand counters | 2f714c, 5b0cc8, plus Self and Screen versions | Polls `getHandObjects()` every second, so it works if hand cards are in hand zone 1. Otherwise `setVar('on',false)` + `editButton` | Bug: `inds` undefined at line 71 |
| Phase announcer (bagged) | — | `setTable('phases',{…})`, `setVar('i',k)`, `call('createButtons')` | `nextPhase` (69), 8 context items |
| Highlight mat / Timer / Custom dice / Upkeep | Highlight W d1ae7b, R 5cb175, Y 40b95f, B a42baa; Timer W 809133, R 29f427, Y 57b8f3, B 9df6a3 | Driven by `Turns.turn_color`, so set it from the engine's active player. Timer turn number: `turnN` + button 6 | Timer listens for chat containing "reset life" |
| The Ring (d9fcbc) | — | `pressedButton` + `createButtons` (one shared copy; the engine tracks it per player) | `press1..4`, `upDown` |
| Day/Night card | find by name (GUID changes per state) | `setState(1)` = day, `setState(2)` = night | **Disable `onStateChange`**: it transforms playmat cards with `setState` |

## Disable or reroute in engine mode

- **Everything that writes `Turns`:**
  - Turn Skipper
  - Pirate Cannon who-goes-first (205-219)
  - Global key 0 (284-294)
  - Global chat "my turn" / "your turn" (2165-2185)
  - TTS's built-in end-turn button: set `Turns.pass_turns=false`
- **Who Goes First die:** the engine picks the first player. It also fetches an image from `0rganics.org`.
- **smart_mulligan (dc2d88):** only Steam ID <table author Steam ID> can press it, and it rigs shuffles. Global `playerMulligan` becomes an engine mulligan prompt.
- **Draft hand rotators, Ready tokens:** bagged.
- **Global scry dealing:** reuse the πScry ▲/▼/☠ buttons (116-168) and animation (179-245) as the UI for engine scry/surveil prompts. The buttons send the answer; the move is animated when the engine's patch arrives.
- **Bag of Tricks / Codie:** library manipulation.
- **`piFlipMenu` in πMenu (208-214):** calls `o.flip()`. Otherwise πMenu is a good home for per-card engine actions.
- **Auto Player Promoter (cd83de):** promoted players can delete or alter engine objects.

## Keep as-is

Dice (could reuse their 3D-text roll animation), Quarter, Bruh Button, Custom Tile, hold_alt, Notecard/πotepad, Color_Module, playmat enabler, Table_Instructions, static label tokens.

- **Table_Instructions "×"** destroys about 95 objects and shifts about 25 bags, so don't depend on those bag GUIDs.
- **PiecePack_Crowns (82bf98)** is anti-malware hidden at y=−100. It destroys spawned objects whose script contains `setluascript` (unless it also contains `global.getvar('encoder')`), `getluascript():reverse`, `ondestroy(` together with `self.clone(`, or `while true do end`. Renderer-spawned scripts must avoid these patterns. Bug: `destroyAllbaddies` returns early (47).

## Irrelevant in engine mode

Upkeep Reminders (only broadcasts), Rhystic Block, Human-Time Lord, Custom Dice (unless playing Planechase).
