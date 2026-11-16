# M6: making the screen UI fit six seats

Measured 2026-11-05 on the current sources. Scripts: `tmp/ui-size/` (how to re-run is at the end).
"Screen UI" means the one XML string `engineRenderPanels` hands to `UI.setXml` (tools/engine-renderer.lua). Sizes are bytes.

The build plan that uses this is `docs/m6-six-seat-spec.md`.

## 8. Built 2026-11-16 (branch `m6-ui-size`)

Measured on the 2026-11-16 sources (the UI had changed since the 2026-11-05 numbers below: the Undo list and Settings
are now tabs of the answer panel, so `eng_undolist_` and `eng_setpanel_` no longer exist). `tests/test_ui_budget.js`,
engine mode on (a game started), Green and Purple borrowing Blue's and Red's data:

| Human seats | Before | After | Under 60,000 |
|---|---|---|---|
| 1 | 26,142 | 16,785 | 43,215 |
| 2 | 38,079 | 25,465 | 34,535 |
| 3 | 47,711 | 32,256 | 27,744 |
| 4 | 57,802 | 39,107 | 20,893 |
| 5 | 67,740 | 45,938 | 14,062 |
| 6 | 77,831 | **52,789** | **7,211** |

Six seats with engine mode off (between games, the table's two panels back in): 58,862. A seat now costs about
6,850 bytes (was about 10,000).

What was done. None of it changes what a player sees or can do, so only the screen UI's text changed:
- **Counter ids** (§4.2): `engineXmlCompact(xml, base)` gives each `eng_` element a code (`a`..`z`, `a1`...), kept in
  `engineUiMap` for the session (a click from an older XML still means its own element). Every caller keeps the long
  ids; the screen-UI calls go through `engineUI.*` (`setAttribute`, `setAttributes`, `setValue`, `getAttribute`,
  `getValue`), which map them. No code equals one of the table's ids or classes. About 11,500 at six seats.
- **One handler**: each `eng_` element's event is `E`, which calls the recorded handler with the long id, so every
  handler runs unchanged (the search box's `onValueChanged` too). About 4,400.
- **Self-closing**: `<X ...></X>` written `<X .../>`. A lone space inside an element is its text and stays. About 4,000.
- **Line breaks** between our elements out. About 1,250.
- **The table's Reveal-until-type and Cascade panels** (`SearchTypePanel`, `GetValuePanel`) left out while engine mode
  is on (`engineTablePanels`): both tools are guarded then. Engine mode is in the rebuild key and `setEngineMode`
  rebuilds the UI, so the normal table has them back. About 6,070. Cost: the first build of a game now comes when engine
  mode turns on (the setup buttons or "started") instead of at the first question, and there is one more full
  `UI.setXml` when engine mode goes off after the game. The golden diff showed only that, plus the text-colour
  alternation (`engineFlipColor`, #FFFFFF / #FFFFFE) shifting by one call.
- **Short class names** (codes, not `m<n>`): about 350.

Not done (each changes what players see or how a handler works): shared copies (§4.1 item 2) and 20 answer buttons a
page. The two-player probe (§6.2 of the spec) is still not run.

Proof that nothing else changed: the table golden recorded with the new code but without the engine-mode rebuild
matched the old recording on every step except the `UI.setXml` hash (the fake TTS records long ids, `tests/lua/tts-sim.lua`).
The fake TTS now also fails a test on any screen-UI set made with a long id that has a code (a missed `engineUI`).

## Review (second agent, 2026-11-05 night)

All scripts re-run on the current sources: every "today" number and every technique number reproduces exactly. Corrections, now applied below:
1. **The Graveyards / exile button can't be shared.** Its label is per player ("Back to choices" while that player browses, `updatePanel`). The shared buttons are Log, Settings, Undo..., Scoop and Fix... only: 2,265 saved, not 2,785.
2. **The short ids could collide.** Stem code + colour letter + tail with mixed-case codes lets stem `aB` + tail `12` equal stem `a` + Blue + `12`. It passed today only by luck. Use a **counter id** per element instead (`a`, `b`, ... `a0`, `a1`...): unique by construction, and smaller.
3. With both fixes the combination C is **48,553 bytes at six seats** (was 48,721), 42,788 at five, 37,049 at four. The margin to the 50,000 aim is only 1,447, so the spec also takes 20 answer buttons a page: **45,553 at six**.
4. **The playable glow is not screen UI.** It is `obj.UI` on the commander card, its own XML. Its `eng_play` id must not be mapped.
5. **More callers read the long ids:** `tools/handplay.lua` (the hand-test helper), `tools/tts-stutter-synth.lua`, and `onMtgSearch` (an `onValueChanged`, not an `onClick`). They need the same id map.
6. **Shared panels need handler edits.** Today's handlers check `id == "..._" .. player.color`. A shared copy's id has no colour, so those checks must go. And `visibility=""` means *everyone*: a shared panel whose list goes empty must be hidden with `active`, never given an empty list.
7. **The relay fix alone doesn't give a 5–6 seat game** (section 5). The node spawns at most `SELF_HOSTED_NODE_MAX_PLAYERS − 1` AI players, and the stack's default is 4. The bridge also has only 4 AI decks.
8. **The probe doesn't copy the failure.** The dead buttons had `visibility` set to the friend's colour and were changed by `setAttribute` just after `setXml`. The probe's button is shown to everyone and never changed. The spec adds both cases and a "friend joins after" run.

## Summary

- Today six seats come to **78,699 bytes**, against the 60,000-byte guard in the code. Each human seat adds about **10,100 bytes**.
- A mix of four changes brings six seats to **48,553 bytes** (11,447 under the guard, about 15,000 under the size that failed). Each seat then adds about 5,750 bytes. With 20 answer buttons a page: 45,553.
- The "60 KB limit" is a **guard**, not a known TTS limit. TTS's own network code shows no cap near 64 KB. The one failure (a friend's buttons died at about 64 KB, 2026-10-23) has not been explained. Settle it with a two-player probe (below) before trusting any number.
- Only seated **humans** get panels. A 6-seat game of 2 humans and 4 Forge AIs builds 2 seats' panels (38,671 bytes today). Six humans is the case that needs the cut.

## 1. What the limit is

What we know:
- The code warns above 60,000 bytes (`engineXmlSize > 60000`, engine-renderer.lua). The number comes from one event: with two players seated the UI had passed about 64 KB, and the second player's buttons stopped working. The code's comment says the cause was "not proven". The UI was then compacted (classes in `<Defaults>`), and the warning was set below the failure.
- The string is the **runtime** Global UI, not the save. The saved `XmlUI` is the table's own 13,971 bytes (identical on the 4- and 6-player tables). Our panels are added at runtime by `UI.setXml`. TTS v10.6.1 patch notes: setXml changes are "runtime changes only", never written to the save.
- TTS does send runtime UI to every player. Read from the installed game's assembly metadata (`Assembly-CSharp.dll`, v14.2.x, method and constant names only):
  - `UI.setXml` → `XmlUIObject.SetXml` → `Init` → a network RPC `RPCXml(string, assets)` to the clients.
  - A player who joins later gets the current XML (`OnPlayerConnect` sends `GetXml()`).
  - `UI.setXmlTable` turns the table into a string and calls the same `SetXml`. So it travels the same way and saves nothing.
  - Clicks go back to the host as an RPC carrying the element's id (`ReceiveMessage` → `RPCReceiveMessage` → the Lua handler).
  - `setAttribute(s)` sent to a client wait until that client has finished loading the XML (`RPCSetAttributes` → `WaitToLoad`).
- **No 64 KB cap shows up in TTS's network code:**
  - Strings are written as UTF-8 with a 32-bit length (`NewNet.BitStream.WriteString` calls `WriteInt`, not a 16-bit write).
  - Reliable RPC streams are 10,000,000 bytes (`NetworkManager.GetStream` → `BitStream.GetPooled(10000000)`, `MAX_PACKET_SIZE = 10000000`).
  - One Steam message is up to 524,280 bytes (`SteamP2PManager.MAX_SINGLE_MESSAGE_SIZE`).
- Patch notes v10.9.0: "Fixed string size limit over the network being increased for large xml." So a network limit on XML strings existed in an old version and was raised. They don't say to what. v14.2 (2026-10-02) replaced the Steam P2P networking.
- No TTS docs, forum post or patch note found that names a 60 or 64 KB limit on Global UI.

What we don't know:
- Why the buttons died. Size is still possible: another layer may cap it, and I read only call lists, not whole methods. Other possible causes:
  - the client still building a big XML while the host was already sending changes;
  - something else that changed in that session.
- Whether anything above about 39 KB has ever worked for a remote player. Two seats is 38,671 bytes today. Three or four humans have never played (PLAN: "4 human players on the real table" is open). **The 58,530 bytes of four seats has never been seen by a second human.**

**Verdict:** treat 60,000 as a guard until a test says otherwise. Aim for six seats at 50,000 or less.

**The test (30 minutes, needs a friend):** `tmp/ui-size/limit-probe.lua`. Not run. With no game running, it pads the screen UI to a target size and shows a Probe button to everyone. The friend clicks it at 50, 60, 64, 70, 100 and 200 KB, once with the padding as one long string and once as many small buttons.
- Both kinds fail at the same size: it's a byte cap.
- Only the many-buttons kind fails: it's build time or element count. Then the fix is fewer elements, not fewer bytes.
- Nothing fails: the guard can go up.

`uiProbeEnd()` puts the UI back. It only changes the runtime UI, never the save.

Review 8: the probe as written doesn't copy the failure. The dead buttons were shown only to the friend (`visibility="<colour>"`) and were changed by `setAttribute` right after `setXml`, while the friend's game may still have been building the XML (`RPCSetAttributes` → `WaitToLoad`). The spec (`docs/m6-six-seat-spec.md` §6.2) adds those two cases and a run where the friend joins after the UI is set. Run it at the sizes in rising order: about 2,800 hidden buttons at 200 KB might stall the host.

## 2. Today's numbers

`node tmp/ui-size/dump-xml.js`: the table built from the current sources, run on the fake TTS, with 1–6 seats seated.

| Human seats | Bytes | Over the 60,000 guard |
|---|---|---|
| 1 | 26,650 | |
| 2 | 38,671 | |
| 3 | 48,368 | |
| 4 | 58,530 | |
| 5 | 68,537 | yes |
| 6 | 78,699 | yes, by 18,699 |

Seats 5 and 6 (Green, Purple) borrow Blue's and Red's table data, because the 4-player table has no mats for them. The panel builders only use the colour's name, so the bytes are the same as on the 6-player table, whose own UI is identical.

At six seats (`node tmp/ui-size/analyze.js`):
- **Shared, not per seat: 18,961 (24%).**
  - The `<Defaults>` block: 10,284 (our 70 classes 9,577, the table's own 696).
  - The table's own panels: 6,102. `SearchTypePanel` (4,324) is for "Reveal until type". `GetValuePanel` (1,749) is for "Cascade".
  - Covers, the stack pop-up and the Auto-resolve list: about 2,500.
- **Per seat: 9,700–10,100 each.** The colour's name length makes the difference: Red is the shortest, Yellow and Purple the longest.

One seat's copy, biggest first:

| Element | Bytes | What it is |
|---|---|---|
| `eng_panel_<C>` | 3,348 | the answer panel; 30 answer buttons of about 71 bytes each are 2,130 of it |
| `eng_row_<C>` | 2,217 | the card row (7 tiles × 4 elements, 5 buttons) |
| `eng_undolist_<C>` | 871 | the Undo list (8 buttons) |
| `eng_abp_<C>` | 599 | the ability panel (6 buttons) |
| `eng_vote_<C>` | 402 | the rewind vote |
| `eng_setpanel_<C>` | 358 | Settings |
| `eng_scoopask_<C>` | 330 | "Concede this game?" |
| `eng_fixp_<C>` | 309 | the manual-fix panel |
| 19 single buttons and texts | about 1,650 | Engine: hide, Log, Auto, Undo..., Scoop, banners, phase line, hint... |

By kind, at six seats:
- `id` attributes: 18,074 (23%).
- `class` references: 11,447 (14.5%).
- `onClick`: 10,896 (13.8%). 180 of them are the same `onClick="onMtgSlot"`, and 31 handler names are used.
- Tag names: 8,525. Close tags: 8,397.
- `visibility`: 2,910. Whitespace between tags: about 1,235. Visible text: 2,132.
- Looks (colours, sizes) are mostly in classes already: everything else together is about 15%.

## 3. Techniques tried

`node tmp/ui-size/shrink.js 6` runs each one on a copy of the six-seat XML. `node tmp/ui-size/validate.js` checks the results: tags balanced, no duplicate ids; all pass. Hours include updating the tests. "Synced" means TTS sends the result to every player the same way as today: every technique still ends in one `UI.setXml` string.

| Technique | Saved at 6 seats | Risk | Hours | Notes |
|---|---|---|---|---|
| Remove whitespace between our tags | 813 | none | 0.25 | `engineXmlMinify` on ours too |
| Short ids (`eng_opt_Blue_12` → `aB12`) | 10,766 | medium | 4 | the biggest item; **can collide** (review 2): use counter ids, see 4.2 |
| Counter ids (each element `a`, `b`, ... `a0`...; review) | not run alone | medium | 4 | unique by construction; inside combination C it saves 564 more than short ids; see 4.2 |
| Medium ids (`opt_B_12`) | about 7,000 | medium | 3 | same work as short ids, less saved |
| One click handler (`onClick="E"`, routes by id) | 4,632 | low | 1 | handlers already get the id |
| Short handler names (`mA`, `mB`...) | 4,170 | low | 1 | worse than one handler |
| `onClick` inside the classes in `<Defaults>` | 9,635 | **unknown** | 0.5 to try | TTS honours `active` and layout there (checked 2026-10-23); events were never checked |
| Class names of 1–2 letters (`m21` → `u`) | 1,666 | none | 0.25 | |
| A tag's most-used class as that tag's default | 3,888 | high | 1 | the table's own buttons would inherit it |
| Undo list: one copy, `visibility` = who has it open | 4,385 | low | 1.5 | the restore points are the same for everyone; `eng_autolist` already works this way |
| "Concede?" box: one copy | 1,640 | low | 1 | same text for everyone; handler uses `player.color` |
| Rewind vote: 2 copies (asked / waiting) instead of 6 | 1,603 | low | 1.5 | the text differs only in "Waiting for..." |
| Same-for-everyone buttons: one copy each (Log, Settings, Undo..., Scoop, Fix...) | 2,265 | low–medium | 2 | handlers check `id == "..._" .. player.color` today; the Scoop list must drop knocked-out players. **Not Graveyards / exile**: its label is per player (shrink.js still shares it: 2,785) |
| Leave out the table's Cascade and Reveal-until-type panels while engine mode is on | 6,073 | medium | 1.5 | both tools are blocked in an engine game (make-engine-copy.js `guard`); the UI must be rebuilt when engine mode turns off |
| 20 answer buttons a page instead of 30 | 4,370 | low | 0.25 | more "More..." paging (60 → 30 was done 2026-10-23) |
| 15 answer buttons a page | 6,555 | low | 0.25 | more paging again |
| 5 card-row tiles instead of 7 | 2,704 | low | 0.5 | longer rows page or fall back to the list |
| Build the whole UI from Lua at runtime instead of the save | 0 | – | – | **already how it works**: the save holds only the table's own XML |
| `UI.setXmlTable` instead of `UI.setXml` | 0 or worse | – | – | TTS turns it into the same string (not measured: it may come out indented, so bigger) |
| Lazy panels (build a seat's panel only when it opens) | 0 at the peak | high | 4+ | TTS can't add one element: any new panel is a full `UI.setXml`, sent again to everyone, and every player's panel state must be redrawn. All six answer panels can be open at once, so the peak doesn't drop |
| A pool of 2–3 answer panels lent to whoever has a question | about 10,000 (3 of 6) | high | 6+ | needs proof that no more than 3 players ever have a question at once (mulligans? "Engine: show" pins one) |
| Panels on objects instead of Global | – | – | – | object UI is drawn on the object in 3D, not on the screen |

## 4. Recommendation

### 4.1 The combination ("C" in shrink.js)

Do these:
1. Whitespace removed.
2. One shared copy each of the Undo list, the Concede box and the five same-for-everyone buttons; two copies of the rewind vote.
3. The table's Cascade and Reveal panels left out while engine mode is on.
4. Counter ids (review 2; the first version had short ids).
5. One click handler.

Numbers from the review's re-run (shrink.js's transforms with Graveyards / exile not shared and counter ids in place of short ids; scratch scripts, not in the repo):

| Human seats | Today | With C | Under 60,000 | C + 20 answers a page |
|---|---|---|---|---|
| 2 | 38,671 | 25,597 | 34,403 | 24,597 |
| 4 | 58,530 | 37,049 | 22,951 | 35,049 |
| 5 | 68,537 | 42,788 | 17,212 | 40,288 |
| 6 | 78,699 | **48,553** | **11,447** | **45,553** |

(shrink.js as written still prints C = 48,721: it shares Graveyards / exile and uses the colliding short ids.)

- Each seat then costs about 5,750 bytes, instead of 10,100.
- 8 seats would be about 60,050: right at the guard. Fine for M6 (4–6 seats).
- Total work about 14 hours, plus a 30-minute two-player check.

In reserve, in this order:
- 20 answer buttons a page: 3,000 more at six seats. **The spec takes this one now**: C alone is only 1,447 under the 50,000 aim.
- `onClick` in `<Defaults>`, if a TTS check shows it works. (`tests/test_table_claims.js` checks today that `<Defaults>` holds no events: that claim would change.)
- 5 card-row tiles.

Cheaper paths that don't leave enough room (re-run without the Graveyards / exile share):
- Without the id change (whitespace, shares, one handler, no table panels): 58,249.
- Medium ids instead of counter ids: 53,028. Over the 50,000 aim.
- Text changes only (whitespace, short ids, one handler): 62,488, still over.

### 4.2 How the short ids can work without rewriting the renderer

- Keep every id the code uses as it is (`"eng_opt_" .. c .. "_" .. k`). Shorten them only in a last pass over the built XML, as `engineXmlCompact` already does for looks.
- That pass fills two maps, long→short and short→long, kept in an existing table or as globals. The main chunk has no free `local`s.
- **Counter ids, not stem codes** (review 2): the pass gives each `eng_` element the next code in build order, letter first (`a`..`z`, then `a0`..`zz`). 690 elements at six seats fit in two characters. No table id is 1–3 characters long today; the pass should still refuse a code that equals a table id.
- The pass also records each element's handler (`onClick`), so one dispatcher can call it: `E(player, value, short)` → `handler[short](player, value, long[short])`.
- `setButton`, `setText` and `setAttr` look up the short id at the `UI.*` call, after `isButton`, `uiCache` and `nextWhite` have used the long one. So do the direct `UI.setAttribute` / `UI.setValue` calls: `eng_pop*`, `eng_result_`, `eng_cover_`, Scoop, the picture loader (`engineUiImage`). Grep `UI%.set` and `UI%.get` in engine-renderer.lua.
- **Not** the playable glow: `obj.UI.setXml` / `obj.UI.setAttribute("eng_play", ...)` is the card's own object UI and keeps its id.
- `onValueChanged="onMtgSearch"` (the search box) also gets the short id: map it too, or route it through the dispatcher.
- Today's handlers then run unchanged, except the ones whose element becomes shared (they compare the id with the player's colour).
- Tests and tools read ids through `UI.getAttribute("eng_opt_Blue_30", ...)`: `tests/test_table_claims.js`, `tests/golden/table-run.js`, `tools/handplay.lua`, `tools/tts-stutter-synth.lua`. They need one global helper that maps the id.
- A sim test should fail on any UI call with an id that isn't in the XML. The fake UI (`tests/lua/tts-sim.lua`, `UI.setAttribute` at about line 534) records any id today without checking. That catches a missed direct call, which would otherwise break one widget silently.

### 4.3 Checks before calling it done

- `node tmp/ui-size/dump-xml.js` and `shrink.js` again on the built code: six seats ≤ 50,000.
- The UI-size test in `tests/test_table_claims.js`: widen it to 6 seats with the 50,000 bound.
- The table gates: `test_table_golden`, `test_table_claims`, `test_table_check`, `test_table_board_diff`. The golden recordings will change wherever they hold ids.
- The two-player probe (section 1), then one real game with a friend: answer, Undo list, Concede, vote.

## 5. Not about the UI, but blocks a 5–6 seat game: the relay's 4-seat cap

Checked in `manabrew/manabrew-rs/crates/manabrew-server/src` (branch tts-engine, last commit on lobby.rs b7a42c8):
- **A new room can have up to 8 seats.** `room.rs:83` clamps to 2–8. That's why the 2026-10-20 test seated 6 (`SELF_HOSTED_NODE_MAX_PLAYERS=6`).
- **After a game the room drops back to 4.** `room.rs:155-159` (`reset_lobby_settings`) sets `max_players = 4`. It's called by:
  - `reset_room_to_lobby` (`lobby.rs:808`), when a game ends;
  - `leave_room_sync` (`lobby.rs:438`) and `cleanup.rs:535`, when the last player leaves.
- **Asking for more seats can't get past 4.** `set_max_players_sync`, `lobby.rs:640`: `room.max_players = max_players.clamp(floor, 4)`.
- The bridge does send that request. `bridge/bridge.js:710` sends `SetMaxPlayers` with `game.total` ("the relay resets a room to 4 seats after every game"). The relay then clamps it to 4.

So the first 6-seat game in a fresh room works, and the next one gets 4 seats. But only if the stack was started with `SEATS=6` (review 7):
- `stack/compose.yml:42` creates the room with `SELF_HOSTED_NODE_MAX_PLAYERS: "${SEATS:-4}"`. The default is 4.
- The node spawns at most `max_players − 1` AI players (`self-hosted-node/src/host.rs:1023`, `spawn_bots`), counted from that env var, not from the room.
- It spawns one AI per deck the bridge sends (`decks.iter()`). The bridge sends the unused `DEFAULT_DECKS`, and there are 4 (`bridge.js:25`, used at about line 716). One human + 5 AI gets 3 decks, so 3 AI, and the game waits for 6 forever.

The fix is in the relay:
- In `lobby.rs:640`, clamp to 8, like `room.rs:83`.
- Or have `reset_lobby_settings` keep the room's seat count.

This means rebuilding the `mtg-relay:exile` image. Upstream Manabrew may want the 4: that's a question for the PR (no upstream PR yet, by the user's rule). SPEC §7 already says this (updated 2026-11-05).

## 6. Open questions

1. What actually broke the friend's buttons at about 64 KB? The probe answers it. If it was a byte cap, where is it? It is not in `BitStream` or `NetworkManager`.
2. Has a second human ever played with more than about 39 KB of UI? If not, even four humans today (58,530) is untested.
3. Does TTS honour `onClick` from a `<Defaults>` class? That's 9,635 bytes for 30 minutes of testing.
4. Can more than three players have an open question at once? That decides whether a pool of answer panels is safe.
5. How long does a client take to build a 50–80 KB UI? If build time is the real cause, fewer elements matter more than fewer bytes. Today's six seats have 991 elements; C has about 690.

## 7. Re-running

```
node tmp/ui-size/dump-xml.js      # builds into tmp/ui-size/build, writes tmp/ui-size/xml/seats-1..6.xml
node tmp/ui-size/analyze.js tmp/ui-size/xml/seats-6.xml --top 25
node tmp/ui-size/shrink.js 6      # each technique and the combinations; also 4 or 2
node tmp/ui-size/validate.js
```

- `dump-xml.js` uses the 4-player Workshop JSON, like `tests/golden/table-run.js`. Set `MTG_TABLE_JSON` to use another one.
- It builds into its own folder, not the shared `tmp/table-build`.
