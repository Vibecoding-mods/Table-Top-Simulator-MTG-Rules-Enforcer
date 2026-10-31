# Compatibility map: "MTG 4 player table - scripted" with the rules engine

**Table:** Steam Workshop 2296042369, local file `Mods/Workshop/2296042369.json`.
**Reviewed:** 2026-10-17. 119 distinct scripts, about 30k lines, extracted to `table-scripts/` with `tools/extract-tts-scripts.js`.
**Detailed notes:** `notes-global-importer.md`, `notes-encoder-modules.md`, `notes-trackers-turns.md`, `notes-variants.md`.

## Bottom line

**This table can be the face of the engine.** Almost every display it has (life, commander damage, tax, P/T, counters, keyword icons, phase, active player, timers) can be fed engine data through APIs the table already has, so it looks the same as today.

The work is mostly **switching off** the table's manual rules helpers when the engine is running. There are three kinds:
- buttons and hotkeys that draw, mill, untap, mulligan, scry or pass the turn;
- context-menu tools such as cascade, tutors and token copies;
- the "enabler" bags.

We then **feed** the displays from the engine and **spawn cards** in the same format the table's Card Importer uses.

The table keeps working normally when engine mode is off.

## How integration works ("engine mode")

1. **A single flag.** Global gets `ENGINE_MODE = true/false`. Every script that changes game state checks it at the top of its click, chat or event handler. When it's on, the handler does nothing, or sends a request to the engine instead (for example the planeswalker ability buttons become "activate loyalty N").
2. **Our code lives inside the table's Global.** TTS only delivers bridge messages to Global, so the engine renderer (the `onExternalMessage` handler, card spawning, display updates) is **appended** to the table's existing 2,800-line Global script. It doesn't replace it.
3. **Cards look exactly like today.** The bridge builds card objects in the Card Importer's format:

   | Field | Value |
   |---|---|
   | Nickname | `Name\nType\nNCMC` |
   | Description | oracle text plus P/T |
   | Memo | `oracle_id` |
   | FaceURL | `img.klrmngr.com/large/front/…/<scryfall-uuid>.jpg` |
   | Back | the same card back |
   | Double-faced cards | back face as `States` |

   Cards are spawned with `spawnObjectData` at the right zone and locked. They share the same image URLs, so TTS's image cache serves them.
4. **Zones come from the table.** Global's `data[color]` already holds every player's library, graveyard and playmat positions (plus the exile and graveyard offsets). Commander-zone, life and damage objects have fixed GUIDs. So cards land where your group expects them.
5. **Overlays go through the Encoder** (object 02e062, `APIobjSetPropData` + `APIrebuildButtons`):
   - P/T, +1/+1 counters, loyalty/defense and the controller gem use Easy Modules (`tyrantUnified`).
   - Keyword counters, stun, exert and "doesn't untap" use πKeywords.
   - Phased-out uses Phasing; tokens use Is-it-a-token; face-down uses Morphin' Time.
6. **Trackers.** Each tracker is set with `setVar` + its own render function + `updateSave`. The engine also sets the active player with `Turns.turn_color`, which automatically updates the highlight mats and turn timers.
7. **Prompts.** Engine prompts appear in the table's own style where one fits:
   - scry/surveil uses πScry's ▲/▼/☠ card buttons;
   - yes/no choices use the ✓/✗ buttons from Global's cascade code;
   - per-card actions (cast, activate) go in πMenu;
   - everything else uses our side panel.

## Verdict summary

✅ keep · 🔁 feed from engine · ♻️ reuse code · ⛔ disable in engine mode · ✋ manual layer

| Area | Script / feature | Verdict |
|---|---|---|
| **Cards** | Card Importer: deck import before the game | ✅ pre-game → convert the deck for the engine. Better: the bridge fetches Archidekt/Moxfield itself, which also gives commanders and set/collector numbers |
| | Card Importer: in-game spawns (single cards, tokens, respawn, print) | ⛔ |
| | Card Importer card format and image CDN | ♻️ the renderer builds identical cards |
| | get deck data, rikrassen importer | ⛔ / pre-game only |
| | Deck Lister | ✅ pre-game |
| | Tutor, get basic/non-basic land | ⛔ |
| **Global** | `data[color]` zone registry | ♻️ |
| | Draw, Mill, Untap, Mulligan, Scry, Reveal buttons; hotkeys 0–9 | ⛔ (Mulligan → engine prompt; key 0 → "pass priority") |
| | Animation helpers (deal, smooth move, reveal fan, push-aside, highlight) | ♻️ to animate engine moves |
| | `onObjectEnterZone` / `LeaveZone` (they wipe card context menus) | ⛔ **first thing to gate** |
| | Context items: token copy, cascade, reveal-until, get basic, random discard | ⛔ |
| | Context item: sort hand by CMC | ✅ |
| | "my turn" / "your turn" chat | ⛔ (the engine sets `Turns.turn_color`) |
| **Overlays** | Encoder | ♻️ write API for every on-card overlay |
| | Easy Modules (P/T, counters, loyalty, gem, DFC) | 🔁 display; ⛔ clicks; planeswalker buttons → engine |
| | πKeywords, Phasing, Is-it-a-token | 🔁 |
| | Morphin' Time (face-down) | 🔁 visual; ⛔ "Morph/Disguise" context items |
| | πScry | ♻️ as the scry/surveil prompt UI |
| | πCounter, πMenu | ♻️ (πMenu as a home for per-card engine actions) |
| **Trackers** | Life ×4, Commander Damage ×12, Commander Zone tax ×8 | 🔁 |
| | Energy / Experience / Poison | 🔁 spawned from their bags when the engine says a player has any |
| | Hand counters, highlight mats, timers | ✅ (work automatically once the engine sets turns and hands) |
| | Phase announcer | 🔁 |
| | Day/Night indicator | 🔁 indicator; ⛔ its card-transforming `onStateChange` |
| | The Ring | 🔁 |
| **Turns / setup** | Turn Skipper, Who Goes First, Pirate Cannon turn hook, smart mulligan | ⛔ |
| | Auto Player Promoter | ⛔ recommended |
| **Bagged tools** | All Enablers (Cascade, Jodah, Oath, …), Possibility Storm, Mass Face Down, Scrambleverse, Tovoloar, Bag of Tricks, draft hand rotators | ⛔ when taken out of their bag (they're inert while bagged) |
| | moon-equip, Scrambleverse | ♻️ layout math only (attachment offsets, playmat grid) |
| **Variants** | Dungeons ×5 | 🔁 room marker (one per player); ⛔ their token spawns; room clicks → answer the engine's "choose room" prompt |
| | Planechase Eternities Map | ⛔ movement; 🔁 show the engine's current plane |
| | Treachery randomizer + identities | ✋ manual layer only: Forge has no Treachery. ⛔ their token buttons |
| **Fun / cosmetic** | Dice, Quarter, Bruh Button, notes, Card Stamp, Color Module, playmats, Timer | ✅ |

## Must-fix before connecting the bridge (security)

1. **Hard-coded account permission in Global (`_Global.lua:2158`).** The Steam account <table author Steam ID> is auto-promoted when it types "promote me". The same ID is the only one allowed to press the hidden smart-mulligan button, which rigs opening hands.
2. **Remote code by chat.** In Easy Modules (`onChat` 376-402), any player can type "force encoder update" or "force importer update". That downloads Lua from GitHub and replaces the Encoder's or Importer's code.
3. **Auto-updaters.** The Encoder auto-downloads a menu module if none registers in time. Phasing and the Encoder's "Update" menu replace their own scripts with downloaded code.
4. **rikrassen importer** spawns whatever object JSON its server returns, scripts included, and rewrites the Global UI.
5. **Anti-malware object** (PiecePack_Crowns, hidden under the table) deletes spawned objects whose scripts contain certain patterns. Our spawned objects must avoid them (`setluascript` and others).

These matter more once a bridge is talking to your PC. The fix is to remove or admin-gate items 1–4 in our engine-mode copy of the table.

## Things that will bite the renderer

- **Objects that get replaced:** `setState` (DFC flip, day/night), the drop-on counter (`setLuaScript` + `reload`), and Easy Modules' `CheckRevertInvertedFaces` (`reload`) all swap objects. **Track cards by engine ID → current GUID**, and re-find them in `onObjectSpawn`.
- **Encoder state is keyed by GUID**, so re-push overlays after every respawn.
- **Encoder `buildButtons` clears all buttons on a card.** Engine buttons must be registered as an Encoder property or put in object XML UI.
- **Trackers rebuild from `script_state`** when players join or change colour, so always call `updateSave`. Commander tax isn't saved at all, so re-push it.
- **Morphin' Time renames cards**, so never match by name.
- **Hidden information:**
  - Face-down Treachery identity names contain the role.
  - Face-down morphs are the real card.
  - The bridge must skip `Identity —` objects and spawn generic proxies for hidden cards.
- **Commander damage trackers are per colour, not per commander.** Partners need the spare trackers or a combined label.

## Decisions (2026-10-17)
- **Security fixes:** applied to the separate engine-mode copy (`Saves/MTG 4 player table - ENGINE MODE.json`, made with `tools/make-engine-copy.js`). The original workshop table is untouched.
- **Treachery:** an honour-system manual layer.
- **Planechase and dungeons:** later.
- **Decks:** keep importing with the Card Importer as today. The bridge reads the imported deck from the table and checks it against Forge before the game starts (see PLAN.md M4 "Deck intake").

## Open questions (original list, now answered above)

1. Do you want **Treachery** under enforcement? It works only as a manual layer: you'd declare the winner, and identity powers are honour-system.
2. Do you play **Planechase or dungeons** often enough to wire them up early?
3. **Decks:** keep importing as today and have the bridge convert, or paste the Archidekt/Moxfield link to the bridge? The link is more reliable for commanders and printings.
4. Should engine mode be **a separate copy of the table** (recommended at first), or a toggle in your current table?
