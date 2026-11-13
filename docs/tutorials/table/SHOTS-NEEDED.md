# Shots still needed for the table tutorial

The players' tutorial (`index.html`, printed to `docs/tutorials/MTG-Table-Tutorial.pdf`) has 11 striped placeholder boxes.
Each box shows its picture as soon as the file `docs/tutorials/table/img/needed/<name>.jpg` exists (the box crops the
picture to fill it, so keep about the aspect given below). Then re-print:

```
node C:/Users/you/mtg-tts/docs/tutorials/build-pdf.js table --check
```

## How to capture

Everything below goes through the live-check driver (`tmp/live-checks/lc.js`, see `tmp/live-checks/PLAN.md`) and the
TTS-window capture (`lc.js shot <name>` runs `tools/tts-shot.ps1` and saves `tmp/live-checks/shots/<name>.jpg`).
Save each shot as `tut-<name>`; `needed-crops.txt` already lists a crop for each (rectangles for a 1920x1000 window at
the live-check camera; look at each crop and adjust before re-printing):

```
L="node C:/Users/you/mtg-tts/tmp/live-checks/lc.js"
X="http://127.0.0.1:48787/exec"     # raw Lua on the table's Global: curl -s -X POST --data-binary '<lua>' $X
powershell -File C:/Users/you/mtg-tts/docs/tutorials/table/make-crops.ps1 C:/Users/you/mtg-tts/docs/tutorials/table/needed-crops.txt C:/Users/you/mtg-tts/docs/tutorials/table/img/needed
```

Rules of the live checks apply: no game of the user's running (`lc.js start` resets the room), check `$L objects` first
(one debug game per TTS launch; past ~83k loaded objects TTS crashes), never Save & Play. Shots 2-9 fit in **one game**
(two scenario files below); shot 1 is before it, shot 10 needs a second person, shot 11 is the companion page.

### The two scenario files to add (`scenarios/`)

`scenarios/tut-a.json` (White on the default `rebuilt_mairsil`, U/B/R, against `ai_passive_lands`):

```json
{
  "label": "tutorial shots: Swiftspear prowess run (Resolve N×), Jace's ability panel, Thalia cost badge, Counterspell on Opt, a dungeon room box",
  "mana": 10,
  "hand": ["Lightning Bolt", "Lightning Bolt", "Opt", "Counterspell", "Chaos Warp"],
  "battlefield": ["Monastery Swiftspear", "Monastery Swiftspear", "Monastery Swiftspear", "Monastery Swiftspear", "Jace Beleren"],
  "dungeon": { "name": "Lost Mine of Phandelver", "room": "Goblin Lair" },
  "opponents": { "battlefield": ["Thalia, Guardian of Thraben", "Grizzly Bears"] }
}
```

`scenarios/tut-marks.json` (typed mid-game with `mtg debug tut-marks`: it keeps the hand and adds no lands):

```json
{
  "label": "tutorial shot: several marks on one mat (MONARCH, RING TEMPTED 2, SPEED, EXTRA TURN)",
  "keepHand": true,
  "mana": 20,
  "hand": ["Palace Jailer", "Claim the Precious", "Claim the Precious", "Burnout Bashtronaut", "Lightning Bolt", "Time Walk"],
  "opponents": { "battlefield": ["Grizzly Bears", "Hill Giant", "Craw Wurm"] }
}
```

## The shots

| # | File (img/needed/) | Aspect | Section / page |
|---|---|---|---|
| 1 | ready-start.jpg | 16 : 4.6 | 2 Joining (p. 3) |
| 2 | dungeon-room.jpg | 580 : 320 | 12 Planechase and dungeons (p. 13) |
| 3 | cost-badge.jpg | 16 : 7 | 4 Playing a card (p. 5) |
| 4 | ability-panel.jpg | 440 : 330 | 4 Playing a card (p. 5) |
| 5 | undo-tab.jpg | 470 : 270 | 13 Fix and rewinding (p. 14) |
| 6 | fix-panel.jpg | 800 : 330 | 13 Fix and rewinding (p. 14) |
| 7 | corner-resolve.jpg | 640 : 330 | 5 The stack and the corner buttons (p. 6) |
| 8 | countered-popup.jpg | 800 : 240 | 15 Sounds and effects (p. 16) |
| 9 | marks-stack.jpg | 580 : 320 | 11 Marks (p. 12) |
| 10 | rewind-vote.jpg | 800 : 220 | 13 Fix and rewinding (p. 14) |
| 11 | debug-draw-mill.jpg | 640 : 300 | 16 Troubleshooting, "For testers" (p. 17) |

### 1. ready-start.jpg: the middle tile, READY? and Free mulligans (before a game)
- State: no game running, engine on (`$L reset`, then `$L chat mtg engine on`), White's deck imported on White's mat
  (by hand with the Card Importer, or left from the last game's reset), not yet checked.
- Show: the middle tile with **Engine: on** and **Start**, White's **READY?** button on the playmat, and the
  **Free mulligans / None** button on the left rim (the cannon's spot). Optionally press READY? first so it reads READY (green).
- Capture: `$L shot tut-ready-start`. The camera must take in the middle of the table and the left rim; if the default
  view doesn't, move it by hand (or `Player["White"].lookAt{...}` through `$X`) and re-crop.

### 2. dungeon-room.jpg: a dungeon card's ROOM / NEXT box
- `$L start tut-a` (White + 1 AI; the scenario applies at White's first priority with the dungeon set).
- Show: White's command zone with Lost Mine of Phandelver and its box "ROOM: Goblin Lair / NEXT: Storeroom or Dark Pool"
  (no second "Dungeon DB..." badge: bug D's fix 3409561 is deployed since 64a891c).
- Capture: `$L shot tut-dungeon-room`; crop around the command zone (needed-crops.txt guesses 1340,500).

### 3. cost-badge.jpg: a hand card with Thalia's +1
- Same moment (Thalia is on the AI's side). `$L card Opt` should report "Costs {1}{U} now (printed {U})".
- Show: Opt (or Chaos Warp, {3}{R} vs {2}{R}) in White's hand zone on the table with the round counter over its mana
  number and the red rim. The hand cards are small at the default camera: zoom the camera onto White's hand zone first.
- Capture: `$L shot tut-cost-badge` (needed-crops.txt takes the whole window; crop to ~16:7 around the card).

### 4. ability-panel.jpg: the ability panel with a greyed line
- `$L tostep White main1`.
- Open the panel for Jace Beleren: point at the card in TTS, or find Jace's engine id in `$L state` and send
  `engineAbPanelShow("White", "<id>") return "ok"` to `$X`.
- Show: bottom right above the corner buttons, the title "Jace Beleren", +2 and -1 bright, -10 greyed with
  "Needs 10 loyalty (has 3)".
- Capture: `$L shot tut-ability-panel`.

### 5. undo-tab.jpg: the Undo tab's restore points
- Same game, a few actions in (restore points exist after the first priorities; play a land or pass once if the dock
  has no Undo tab yet).
- Send `engineOpenTab("White", "undo") return "ok"` to `$X` (the same click as the dock's Undo tab).
- Show: the dock with **Undo** gold and the window under it listing the restore points.
- Capture: `$L shot tut-undo-tab`, then send the same Lua again to close the tab. Don't pick a point.

### 6. fix-panel.jpg: "Which kind of fix?"
- Main phase, empty stack: `$L chat mtg fix`. Against the AI the vote passes at once and the engine pauses.
- Wait for the panel at the top centre: "MANUAL FIX - the engine is paused. Which kind of fix?" with
  **Fix from hand / Edit the board / Cancel** (`$L waitlog "Which kind of fix" 30` or look at the window).
- Capture: `$L shot tut-fix-panel`, then `$L chat mtg fix cancel`.

### 7. corner-resolve.jpg: Resolve / Resolve all (N) / purple "Resolve 4× Monastery Swiftspear"
- Still White's main 1, empty stack: `$L chat mtg hold`, `$L play Lightning Bolt`, `$L pick "AI 1"` (pay with
  `$L pick __auto` if asked; the 10 floating mana pays by itself).
- Four prowess triggers go on top of the Bolt; with Hold (and a second Bolt in hand) White gets priority. `$L opts`
  should list "Resolve", "Resolve 4× Monastery Swiftspear" and "Resolve all (5)".
- Show: bottom right: the purple third button above the navy "Resolve all (5)" and the orange "Resolve", the
  instruction line above them.
- Capture: `$L shot tut-corner-resolve`, then `$L pick "Resolve all"`.

### 8. countered-popup.jpg: "COUNTERED: Opt"
- Empty stack, White's priority: `$L play Opt`; White is asked over it (Counterspell in hand): `$L play Counterspell`,
  `$L pick Opt` (its target), then `$L pick __pass` until Counterspell resolves.
- The pop-up shows for about 1.8 s: start a burst right after the pick that resolves Counterspell, e.g.
  `$L pick __pass; for i in 1 2 3 4; do $L shot tut-countered-popup-$i; done`, and keep the one with the pop-up as
  `tut-countered-popup.jpg`. (`$L fx watch` / `fx read` tells whether it fired.)
- Crop around the pop-up (needed-crops.txt guesses the middle of the screen; adjust).

### 9. marks-stack.jpg: several mark boxes on one mat
- Same game, empty stack: `$L chat mtg debug tut-marks` (applies at once against the AI).
- Then, in White's main phase: `$L play Palace Jailer` (target a creature; White becomes the monarch),
  `$L play Claim the Precious` twice (targets: the AI's creatures; RING TEMPTED 2), `$L play Burnout Bashtronaut`,
  `$L play Lightning Bolt` at "AI 1" (SPEED 2), `$L play Time Walk`, then pass to the extra turn
  (`$L tostep White main1`).
- Show: White's mat corner under the heart with separate boxes MONARCH, RING TEMPTED 2, SPEED 2 (3 on the extra turn),
  EXTRA TURN, none overlapping (the old overlap: tmp/live-checks/shots/9-crop-label-overlap.png).
- Capture: `$L marks` (lists them), `$L shot tut-marks-stack`; crop like img/marks-dungeon.jpg.
- After this shot: `$L reset` and `$L cleanup` as usual.

### 10. rewind-vote.jpg: the rewind vote box (needs a second person)
- Against the AI a rewind happens at once, so this needs a second human seated (e.g. a friend on Blue) in any game.
- White opens the Undo tab and picks a restore point (or `$L chat mtg undo`).
- Show, on the other player's screen or White's: the box at the top centre "White asks to rewind to ..." with
  **Rewind / Keep playing** (White's own box shows "Keep playing takes it back.").
- Capture on the host's PC: `$L shot tut-rewind-vote` shows White's view; for the voter's view, the friend sends a
  screenshot. Then answer the vote.

### 11. debug-draw-mill.jpg: the companion page's Debug tools
- Not TTS: the MTG Companion's web page on the host's PC (Table tools → Debug tools, docs/companion-app-spec.md §10.3).
  Switch Debug tools on (it is off at every bridge start and the table is told) and open the section so **Draw** and
  **Mill** (Number 1-99) show beside mana, hand, battlefield, life and untap. A game must be running for the buttons.
- Capture: a browser screenshot of that section, cropped to about 640:300, saved straight to
  `img/needed/debug-draw-mill.jpg`. (The companion tutorial in docs/tutorials/companion/ may already have one to reuse.)
- Draw and Mill need the engine image built with the `draw`/`mill` fix ops; if the buttons are missing, the running
  engine is older.
