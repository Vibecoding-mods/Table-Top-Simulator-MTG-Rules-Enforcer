# M6 spec: 4–6 seats on the 6-player table

Written 2026-11-05 (night). Spec only: nothing here is built. Sizes are bytes. Hours include updating tests.

**Parked 2026-11-06 (the user):** no work on M6 until the 4-player table is polished and mostly complete. The open
questions in §7 wait until then.

Inputs:
- `docs/m6-ui-size.md`: the UI measurements and the reviewed shrink plan (read its "Review" list first).
- SPEC §7: the player-count limits and the first 6-player table notes (2026-10-31).
- The 6-player table: Workshop 2293586471, "MTG 6 player table - scripted", `Mods/Workshop/2293586471.json` on the host's PC (282 objects).

**Never paste the 4-player Global (or the 4-player engine copy) over the 6-player table.** The two tables reuse some GUIDs for *different* seats (section 2), so a paste would not just fail: it would put one seat's cards on another seat's mat without an error.

## 1. Order of work and hours

| # | Step | Hours | Needs |
|---|---|---|---|
| 0 | Two-player UI probe with a friend (§6.2). Any time a friend is free; the earlier the better | 1 | a friend |
| 1 | UI budget test and the fake UI's id check (§6.1) | 1.5 | |
| 2 | Whitespace out; 20 answer buttons a page | 0.5 | |
| 3 | The table's Cascade and Reveal panels out while engine mode is on | 1.5 | |
| 4 | Shared copies: Undo list, Concede box, rewind vote (2 copies), 5 buttons | 6 | |
| 5 | Counter ids and one click dispatcher | 5 | |
| 6 | Table gates and golden refresh after the UI work | 1 | |
| 7 | Relay seat cap, relay image rebuild, stack default 6 seats (§4) | 2 | lead's OK to rebuild the image |
| 8 | Bridge seat handling (§5) | 2.5 | |
| 9 | Table profile extractor (§2.2) | 3 | |
| 10 | `make-engine-copy.js` takes a profile; patches re-checked on the 6-player scripts | 4 | |
| 11 | Renderer: per-table data instead of the 4-player tables | 3 | |
| 12 | Commander damage on the 6-player table (§2.4) | 3 | user's choice A or B |
| 13 | Background objects out, table buttons placed for six mats | 3 | |
| 14 | Golden recording for the 6-player table | 2 | |
| 15 | Live: headless 6 seats twice, then host + 5 AI in real TTS, then a game with a friend | 5.5 | user's OK for a new save |
| | **Total** | **44.5** | |

- Steps 0–6 (16.5 hours with the probe) work on the 4-player table and help it too: four humans drop from 58,530 to about 35,000.
- Steps 7–8 can be done in parallel with 1–6.
- Steps 9–14 need steps 1–8 done first: the 6-player table can't even seat six without them.

## 2. Porting to table 2293586471

### 2.1 What differs (read from both Workshop files, 2026-11-05)

- The saved `XmlUI` is identical (13,971 bytes both). Global is 2,800 lines against 2,804.
- Seats, clockwise from White, seen from above:

| Colour | Side | Playmat GUID | Mat position (x, z) | Hand zone (x, z) | Life tracker (by position) |
|---|---|---|---|---|---|
| White | south | 7cffe1 | 27.3, −14.9 | 26.7, −35 | c2e905 |
| Red | south | c20e3f | −2.1, −14.9 | −2.8, −35 | 448880 |
| Yellow | south | 8b3401 | −31.5, −14.9 | −32.1, −35 | 37e533 |
| Green | north | 56cd9d | −27.3, 14.9 | −26.6, 35 | 0c1b22 |
| Blue | north | 129eaa | 2.1, 14.9 | 2.7, 35 | 395037 |
| Purple | north | d2aff5 | 31.5, 14.9 | 32.2, 35 | 2ee5fb |

- The life trackers are matched to seats by position: each sits about 14 units to its player's right of the mat. Confirm each one from its script or by clicking it before relying on it.
- **GUID traps** (same GUID, different seat):
  - mat 8b3401 is White on the 4-player table, Yellow here;
  - mat 56cd9d is Blue there, Green here;
  - mat 129eaa is Yellow there, Blue here;
  - White's life tracker is 23e485 there, c2e905 here (the other three keep their colour).
- Commander tax: only one of the 4-player tax GUIDs (9d380e) exists here. Find this table's own (step 9).
- Commander damage: **no per-seat trackers**. The table has 12 infinite bags ("Red Commander Damage" etc.), one set of 6 at each end (x = ±53). Each holds the same counter script as the 4-player trackers. See 2.4.
- Poison, energy and experience counters: only 4 sets, at the table ends. The engine already shows these as a label under the life counter, so nothing is needed.
- Object scripts: 81 of 97 identical; older Card Importer (6.4), Encoder and Hand Counters. Same hard-coded Steam IDs.
- Turn order: clockwise is White → Red → Yellow → Green → Blue → Purple (the same rule that makes the 4-player order White → Red → Yellow → Blue).

### 2.2 Step 9: a table profile, read from the save (3 h)

A new script `tools/table-profile.js <workshop.json>` writes `tools/profiles/<workshop id>.json`:
- seats in clockwise order (from the mat positions);
- each seat's GUIDs from Global's `data["<colour>"]["<field>"] = getObjectFromGUID("...")` lines (library, graveyard, playmat, mulligan, untap, draw, scry, mill, reveal buttons);
- life trackers, tax labels and command zones by script and position;
- the background objects to remove and the clutter boxes (today hard-coded in `make-engine-copy.js`, about line 689);
- a report of every field it could not find. A missing field is an error, never a guess.

Check it on the 4-player file first: its profile must reproduce today's hard-coded values exactly.

### 2.3 Steps 10–11: use the profile (7 h)

`tools/make-engine-copy.js` (4 h):
- Take `--profile` (default: the 4-player one). Source, output name, seats, GUIDs and the remove list come from it.
- Replace its own four-colour lists: about lines 220 and 325 (`{ "White", "Red", "Yellow", "Blue" }`) and `COMMAND_ZONES` (about line 384).
- Every `patchScripts` and `guard` already counts its matches. Run it on the 6-player file and treat every count below `expect`/`min` as a failure to fix, not a warning: the older scripts may differ.
- Write the profile into Global as one global table (e.g. `TABLE_PROFILE = {...}`), so the renderer needs no new `local`s.

`tools/engine-renderer.lua` (3 h):
- Read from `TABLE_PROFILE`: `LIFE_TRACKERS`, `CMD_DAMAGE`, `TAX_LABELS` (lines 7–15), the `TRACK` table (about line 1186), the colour lists (about lines 1189 and 4900), `SETUP.seats` (about line 5207).
- These are already main-chunk locals, so this changes their values, not their count (194 of 200). No new main-chunk `local`.
- `seatGeometry` already reads `data[colour]`: nothing to do there.
- `SETUP`'s Start tile is placed "between the four life counters": give the profile a Start position for each table.

### 2.3.1 Steps 9–11 as built (2026-11-16, branch `m6-profile`)

- `tools/table-profile.js <workshop.json> [--check]` writes `tools/profiles/<id>.json` (both tables checked in). It
  holds GUIDs, positions, colours and our own choices only. Rules it uses (all in the file):
  - seats: the registry's colours, clockwise from White by falling `atan2(z, x)` of the mats;
  - life trackers, timers, commander zones: by object name with the colour in the Description; hand zones: the larger
    HandTrigger of the seat's FogColor;
  - commander zones in a pair: left to right as the player sees them (the hand zone's facing); a level pair (the
    6-player table's lie one behind the other) nearest the player first. **This is a choice** for the 6-player table:
    the first one is the tax label the renderer fills first (`TAX_LABELS[c][1]`);
  - commander-damage trackers: the attacker is the Description, the victim the nearest life tracker; written in the
    order the renderer always had (victims from White then anticlockwise, attackers nearest the middle first), because
    Lua's `pairs` follows a table's build order. The 6-player table has none: `cmdDamage: null` and a `notFound` line;
  - the remove list by kind (Encoder modules by name, all timers, all bundles under y −40, all but the west rikrassen
    importer, the Bruh Button, the Drafting tools and Enablers bags); the clutter boxes are a per-table choice in
    `TABLES` (none yet for the 6-player table: step 13).
  - a table it has no `TABLES` entry for, or any missing field, is an error by name; nothing is written.
- `make-engine-copy.js` reads the profile from its source; `--profile <file>` must match it byte for byte (a 4-player
  profile on the 6-player file is refused). From it: the save name, the seats (AI seat loop, `mtg winner`, status
  piece copies), `COMMAND_ZONES`, the remove list and boxes, the per-seat patch counts (life counters = seats, hand
  counters = 2 × seats), and `TABLE_PROFILE = { id, seats, life, cmdDamage, tax, start, buttons, draw }` in Global
  before the engine code. Gates for tools a table lacks print `SKIP` instead of `FAIL` (`features.wastes`,
  `features.treachery`).
- `engine-renderer.lua`: `LIFE_TRACKERS`, `CMD_DAMAGE`, `TAX_LABELS`, the effects' `TRACK` and carrier list,
  `TABLE_BUTTONS`, `DRAW_BUTTONS`, `seatOfButton`'s list, `SETUP.seats` and the Start tile's spot read
  `TABLE_PROFILE`. No new main-chunk local. **Still four-seat on purpose:** the team modes (2HG, 2v2, Juggernaut:
  their colour lists and `TL.seats`), and the fixed button spots on the west strip (`MODE_SPOT`, `FRIENDLY_SPOT`,
  `TEAMS_SPOT` at x −47: step 13).
- On the 4-player table the built save is the same as before except the `TABLE_PROFILE` block and the lines that read it
  (diffed); `test_table_golden` unchanged. Tests: `tests/test_table_profile.js`.
- On the 6-player table (re-checked 2026-11-16, every patch and gate): all apply except the two `SKIP`s (no Wastes
  button, no Treachery cards). Every definition of a gated name carries its gate, with one exception: the two
  "Drop-On-Card Counter" tokens (in bags at x ±45.3) carry an `onNumberTyped` inside a script string they put on a
  card; on the 4-player table the clutter boxes remove them. Step 13's boxes must too. The Counters gates count 76 / 104
  / 12 functions (4-player: 80 / 120 / 20): the 6-player table has fewer counter objects, all gated.

### 2.3.2 Plan for steps 12–13 (not built; §8's decisions)

Step 12, commander damage as on the 4-player table (§8: permanent trackers, the 4-player objects and script):
1. Source object: the 4-player table's "Commander Damage" token (script hash 0fdc193a, attacker = Description). It is
   not in the repo and must not be: `make-engine-copy.js --tracker-source <the host's 4-player Workshop file>` copies
   one tracker's object data from the host's own copy at build time (as the 6-player file itself is read). Without
   the file: FAIL by name, never a fallback to the 6-player bags' older script (78a9eb00, colour from the Name).
2. 30 trackers (each victim × 5 attackers), Description = attacker, locked, GUIDs made like the status-piece copies
   (sha1 of victim:attacker, checked against every GUID of both tables).
3. Spot (to confirm on screen): a row of five 1.4 apart along x on the middle strip, centred on the victim's life
   tracker, z = −3.0 (south seats) / +3.0 (north): free once the timers are gone (they were at ±2.86); the strip runs
   ±3.9 between the mats' inner edges.
4. `TABLE_PROFILE.cmdDamage` from the made trackers, in the profile's order rule; the renderer, `mtg fix` (it reads
   `CMD_DAMAGE` at Done) and Standard mode's put-away (`engineModePieces`) need no change.
5. Tests: the 6-player sim sets all 30 from `pl.cmdDamage` and hides them in Standard; `test_table_claims`' icon-box
   check run on the 6-player build.

Step 13, background and buttons:
1. Clutter boxes for the 6-player table in `TABLES`: the two end columns (west x −56…−44, east 44…56, the whole
   length), checked against the report: they must take the 12 commander-damage bags, both Drop-On-Card Counters,
   both Turn Order cards, the dice / keyword / mana columns, and keep the status pieces (kept by `STATUS_KEEP`).
2. Backdrop as the 4-player engine table: the skybox is already set for every table; take Lighting and the sky
   settings from the 4-player engine save's fields, keep the 6-player table's own surface. Check whether the mats'
   picture still appears without the playmat enabler (0ae315 spawns it): keep 0ae315 if not.
3. The west-strip buttons (`MODE_SPOT`, `FRIENDLY_SPOT`, `TEAMS_SPOT`) into `TABLE_PROFILE` (a `spots` table), placed
   clear of Green's column (x −41.8) on the 6-player table; the Start tile at the profile's (0, 0.95, 0) clears the
   mats' inner edges by 3.15.
4. Needs the user's OK for the new 6-player save (§2.6) and a TTS session: a screenshot after each change
   (`tools/tts-shot.ps1`).

### 2.4 Step 12: commander damage (3 h; the user chooses)

Six seats need 30 trackers (each victim × 5 attackers). The table has bags, not trackers.
- **A (recommended):** at game start, take 5 counters per seat from the bags (30 objects; small, not a mass spawn) and lay them by the victim's life tracker. Record their GUIDs in the profile's runtime table and remove them at reset. Manual fix keeps working: it reads the counters at Done, as today.
- **B:** show commander damage as text in the label under the life counter (`enginePlayerCounters`). 1.5 h, no objects. But manual fix can't read it; it would need a chat command (+1 h).

### 2.5 Step 13: background objects and table buttons (3 h)

- Remove this table's background objects by the profile's list (the GUIDs differ from the 4-player table).
- Place the Ready, Start, Scoop and engine-mode buttons for six mats. Screenshot after each change (`tools/tts-shot.ps1`).

### 2.6 The save

- Today the only table save is "Mock MTGA 4 player" (`TS_Save_1`). A 6-player engine save is a **new save**: ask the user before making it.
- Build it like the 4-player one: `make-engine-copy.js --profile` then `make-user-save.js`, and keep `tools/patch-save.js` pointed at it with `MTG_SAVE`.
- Deploy only with TTS closed (`tools/deploy.js`), never Save & Play while decks are on the table.

## 3. The UI shrink, in order (steps 1–6)

**Done 2026-11-16 (branch `m6-ui-size`), without the changes players would notice:** steps 1, 2 (whitespace only),
3 and 5, plus self-closing empty elements and short class names. Measured (`tests/test_ui_budget.js`, engine mode on):
four seats 57,802 → 39,107; **six seats 77,831 → 52,789** (58,862 with engine mode off between games). Not done: step 4
(shared copies) and 20 answer buttons a page; they stay in reserve. The budget test enforces under 60,000 and a +200
ratchet per seat count (`tests/golden/ui-size.json`), not the 50,000 aim below. Details: `docs/m6-ui-size.md` §8.
The id map ended up as `engineUI.*` (the long ids everywhere, mapped at the call) and `engineUiId(long)` for tests and
tools; the fake TTS records long ids and fails a test on a set by a long id that has a code.

What and why are in `docs/m6-ui-size.md` §3–4. The order is chosen so each step can be tested and kept on its own, and the risky id change comes last, after the budget test can catch a miss.

1. **Budget test and id check** (1.5 h, §6.1). Start the budget at today's size and lower it after each step (a ratchet).
2. **Whitespace and 20 answers a page** (0.5 h). Run `engineXmlMinify` on our part too. `updateOptions` already pages with "More...".
3. **Table panels out in engine mode** (1.5 h). Cut `SearchTypePanel` and `GetValuePanel` from `baseXml`, the way `SearchPanel` is cut today. Their functions are guarded in engine mode (`cardCascade`, `deckCascade`, `deckSeachType`). Add `ENGINE_MODE` to the rebuild key (`builtFor`), so turning engine mode off rebuilds the UI with them back.
4. **Shared copies** (6 h). Each follows the pattern `eng_autolist` and `eng_pop` already use: one element, `visibility` = the players who should see it, `active` = anyone does.
   - Rules for every shared element:
     - set `visibility` first, then `active`;
     - an empty list means "everyone" in TTS: when the list goes empty, set `active="false"` and leave `visibility` alone;
     - the handler takes the colour from `player.color`, not from the id (today's handlers compare the id with the player's colour; those checks go).
   - Undo list (1.5 h): open state stays per player in `undoOpen`; `visibility` = who has it open.
   - Concede box (1 h): `visibility` = who has it open.
   - Rewind vote (1.5 h): copy 1 for the players still asked (Rewind / Keep playing), copy 2 for everyone else ("Waiting for..."). "Rewind to..." (`votego`) shows only when nobody is still asked, so it lives in copy 2.
   - Buttons (2 h): Log, Settings, Undo..., Fix..., Scoop. Scoop's `visibility` = seated players still playing (today's `engineScoopRedraw` test). **Not** Graveyards / exile: its label is per player.
5. **Counter ids and one dispatcher** (5 h). As in `docs/m6-ui-size.md` §4.2: a last pass over the built XML gives each `eng_` element a letter-first counter id and records its handler. `E(player, value, id)` calls the handler with the long id. The map lives in globals or an existing table. Map at every `UI.*` call; never the card's own `obj.UI` (`eng_play`). Map the search box's `onValueChanged` too. Give tests and tools (`tools/handplay.lua`, `tools/tts-stutter-synth.lua`, `tests/test_table_claims.js`, `tests/golden/table-run.js`) one global helper for the long id.
6. **Gates** (1 h): `test_table_golden`, `test_table_claims`, `test_table_check`, `test_table_board_diff`. Golden recordings change wherever they hold ids.

Expected sizes after step 5 (review re-run in `docs/m6-ui-size.md` §4.1): 2 seats 24,597; 4 seats 35,049; 5 seats 40,288; **6 seats 45,553**.

## 4. Relay seat cap (step 7, 2 h)

- Change, in `manabrew/manabrew-rs/crates/manabrew-server/src/lobby.rs:640` (`set_max_players_sync`):
  - from `room.max_players = max_players.clamp(floor, 4);`
  - to `room.max_players = max_players.clamp(floor, 8);`
  - (8 matches room creation, `room.rs:83`.) No comment in the code (manabrew rule). No relay test asserts the 4.
- Leave `reset_lobby_settings` (`room.rs:158`, back to 4 after a game) as it is: the bridge already raises the cap before each game (`bridge.js:708–711`), and that request now works.
- Rebuild `mtg-relay:exile` (convert the `.sh` files to LF first). Then restart only the relay container: memory says a WSL restart breaks the relay port.
- `stack/compose.yml:42`: change the default to `SELF_HOSTED_NODE_MAX_PLAYERS: "${SEATS:-6}"`. The node spawns at most this − 1 AI players (`self-hosted-node/src/host.rs:1023`). Check first that a 2- and a 4-player game still start in a 6-seat room: the bridge sends `StartGame` itself once `ready >= total`, so they should.
- Test: `node bridge/engine-test.js --seats 6 --turns 12` **twice in a row without restarting the node**. The second run is the one the old cap broke.
- Upstream Manabrew may want its 4: a question for the PR, later (no upstream PR yet).

## 5. Bridge seat handling (step 8, 2.5 h)

`bridge/bridge.js` today:
- `TABLE_COLORS = ["White", "Red", "Yellow", "Blue"]` (line 774). It sets the player limit (line 672, "Need 2–4 players"), the clockwise order (`clockwiseOrder`, line 741), the AI players' colours (`onGameStarted`, line 754) and which slots are AI (lines 657, 762).
- `DEFAULT_DECKS` has 4 decks (line 25). The AI get only the unused ones (about line 716), and the node spawns one AI per deck sent.

Changes:
1. The table tells the bridge its seats (1 h). The engine table sends its clockwise seat list (from `TABLE_PROFILE`) to the bridge when it connects (with its first message, or a new one). The bridge uses it for `TABLE_COLORS`. With no list, keep today's 4.
2. Enough AI decks (0.5 h): cycle through `DEFAULT_DECKS` when there are more AI than unused decks, so 1 human + 5 AI gets 5 decks.
3. The fifth and sixth human (0.5 h): the room starts at 4 seats after a game, and `SetMaxPlayers` goes out on the controller's first room update. A fifth seat that joins before that is refused as "room full". Either send `SetMaxPlayers` before the other seats connect, or have a refused seat retry after the next room update. Check with 5 test clients (`engine-test.js --seats 5 --bots 0`).
4. Tests (0.5 h): a 6-colour case in `test_bridge_golden` / `test_bridge_claims` (clockwise order, AI colours, the 2–6 limit, five AI decks).

Seats with 5 players: the AI take the free colours in clockwise order, so one mat stays empty (Purple when the humans sit elsewhere). Turn order skips it. Nothing else changes.

## 6. Tests

### 6.1 The UI budget test (part of step 1)

A new `tests/test_ui_budget.js`, built like `tmp/ui-size/dump-xml.js`:
- Build the engine table from the sources, run Global on the fake TTS with 1–6 seats, measure `engineXmlSize`.
- Run on the 4-player file (Green and Purple borrow Blue's and Red's data, as dump-xml.js does), and on the 6-player file once step 10 exists.
- **Hard budget: six seats ≤ 50,000 bytes. Fail above it.** Also fail if one seat costs more than 6,000.
- A golden, `tests/golden/ui-size.json`, holds the bytes per seat count. Fail if any count grows more than 200 bytes, and print the elements that grew (`analyze.js`'s list), so a new feature has to pay for its bytes on purpose.
- Replace the "four seats under 60 KB" claim in `tests/test_table_claims.js` (about line 130) with a pointer to this test.
- The fake UI's id check: `tests/lua/tts-sim.lua`'s `UI.setAttribute`, `setAttributes`, `setValue`, `getAttribute` (about line 534) record any id today. Make them count ids that aren't in `SIM.xml`, and have the table tests fail on any. This is what catches a missed id mapping in step 5.

### 6.2 The two-player probe (step 0, 1 h, needs a friend)

`tmp/ui-size/limit-probe.lua`, not run yet. Before running, add three cases (proposed, not made; the file belongs to the UI-size work):
- `uiProbe(size, mode, colour)`: the Probe button with `visibility="<friend's colour>"`, like the panels that died;
- a change right after the new UI: `UI.setAttribute("uiprobe_btn", "text", ...)` 1 frame after `setXml`, then again after 3 s; the friend reports whether the label changed and the click still works;
- a rejoin run: the friend leaves and joins again at each size (that path sends the whole XML with `OnPlayerConnect`).

How to run it:
1. No game running (no "mtg start"). Bridge up (the debug port 48787). The friend joins the host's game and sits at a colour. Nobody changes seats during the probe: a seat change rebuilds our UI.
2. Load the functions: `bash tools/tts-exec.sh tmp/ui-size/limit-probe.lua`.
3. For each size, in rising order (50,000, 60,000, 64,000, 70,000, 100,000, 200,000) and each mode ("string", then "elements"): `echo 'uiProbe(64000, "string")' | bash tools/tts-exec.sh`. The friend clicks the red button. Chat shows `[probe] click from <colour> at <n> bytes` when the click arrives.
4. Then the three new cases at the size that failed, or at 64,000 if none did.
5. `echo 'uiProbeEnd()' | bash tools/tts-exec.sh`. It puts the runtime UI back; the save is never touched.
6. Write the results into `docs/m6-ui-size.md` §1.

Reading the results:
- Both modes fail at one size: a byte cap.
- Only "elements" fails: build time or element count. Then fewer elements matter more than fewer bytes.
- Only the colour or the late-change case fails: the old failure was a timing problem, and the guard number means little.
- Nothing fails: the guard can go up. Keep the 50,000 budget anyway, for margin.

### 6.3 Live (step 15, 5.5 h)

1. Headless: `engine-test.js --seats 6 --turns 12` twice without a node restart (0.5 h).
2. Real TTS, the 6-player engine save: host + 5 Forge AI, a full game to the end, with the log (3 h with fixes). Check: every AI's cards land on its own mat, the life and commander damage counters, turn order clockwise, Scoop, Undo, the rewind vote.
3. With a friend: 2 humans + 4 AI, then more humans if they're around (2 h). Each answers a question, opens the Undo list, votes and concedes once.

## 7. Open questions

1. Commander damage on six seats: A or B (2.4)? Recommended A.
2. May the 6-player engine table become a second save? Needed for step 15.
3. The relay's cap of 8 is a change upstream may refuse. Fine for now: no upstream PR yet.
4. What actually broke the friend's buttons at about 64 KB? The probe (6.2) answers it.

## 8. User decision 2026-11-15

- Remove the 6-player table's background objects and give it the same backdrop as the 4-player engine table (its skybox, lighting and background settings), so there is no lag from decoration objects.
- Commander damage: set up like the 4-player table (the user, 2026-11-15): permanent per-seat commander-damage trackers in the save, one per attacker by each player's life tracker, the same objects and script the 4-player table uses, read by mtg fix and driven by the engine as on the 4-player table. Not options A or B of section 2.4. First check whether the 6-player Workshop table already has such trackers somewhere (docs/m6-compare-objects.md).
- The 6-player engine table may be a second save (the user pointed at Workshop 2293586471 to catch up to the 4-player state).
