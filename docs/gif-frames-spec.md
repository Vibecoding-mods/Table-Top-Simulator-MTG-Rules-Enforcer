# GIF frames: one per player (spec, 2026-11-13)

Status: **Phase 1+2 built on branch `gif-frames` (2026-11-13), not merged or deployed; see "Phase 1 checks and the build" at the end.** Earlier: spec only. The user asked for "an object that shows gifs (giphy klipy etc) one per player".
Facts below are marked **(verified)** with a source, **(unverified)** when only third-party pages say so, and
**(spike)** when only a test in real TTS can settle it. Phase 0 (§6) settles the spike items before any build.

## 1. What the players get

- Every seated player has a **GIF frame** on the table: a square picture frame **as tall as a card** (width = height),
  the same size for everyone, that everyone at the table can see. It spawns in a free spot on its owner's playmat and
  **only its owner can move it** (anywhere on their own mat; others can't pick it up). It is there **always**, in a game
  or not (decided 2026-11-13).
- A player sets their own frame: click it (only the owner can) and a small panel opens on their screen with a search
  box, eight results as still pictures, More, and Clear. Pick one and it plays on your frame for everyone. Chat works
  too: `mtg gif <words>` shows the first match, `mtg gif off` clears your frame.
- The GIF plays for a while (default 12 s), then holds on one still frame so the table isn't busy all game. Clicking
  the frame (anyone) plays it again.
- **Hide GIFs for me:** any player can hide every frame on their own screen only (others keep seeing them).
- **Host controls** (chat, host only): `mtg gifs on|off` (the whole feature, saved with the game), `mtg gif clear
  <colour>` (empties one player's frame), `mtg gifs rating g|pg|pg-13` (default **pg-13**, decided 2026-11-13).
- AI seats get no frame. Spectators see the frames but can't set one.

## 2. The hard part: TTS can't show a GIF

**Settled by Phase 0 (2026-11-13): route M.** GIPHY's MP4 link put straight on a Custom Tile plays and loops in TTS
(verified live; see "Phase 0 results" at the end). GIF and animated WebP links both fail. Routes W, V and F below are
kept as the record of what was weighed; the build uses route M. Checked since ("Phase 1 checks" at the end): MP4 on an
Object UI Image (no: results stay stills), six playing tiles' frame time (cheap), a save/reload with a video tile
(works), `.webm` (VP8 only; GIPHY has none). Still open: a second player's client.

- TTS does not load GIF pictures: a 2021 player report gets "Load image failed unsupported format" for a .gif, and a
  2015 developer reply said there was no GIF support and pointed at AssetBundles instead
  ([2021 thread](https://steamcommunity.com/app/286160/discussions/0/5879990700806314352),
  [2015 thread](https://steamcommunity.com/app/286160/discussions/0/617329150703241572)) **(unverified for today's
  TTS 14.2.2; T1 checks it)**.
- Our custom-art code already accepts `.webp` links (bridge custom art rule), so TTS loads WebP pictures. Whether an
  **animated** WebP plays or shows only its first frame is unknown **(spike T2)**. GIPHY serves a WebP of every GIF.
- So there are three ways to make it move, and Phase 0 picks one:

| Route | How | Good | Bad |
|---|---|---|---|
| **W: animated WebP** | Put the provider's WebP link straight on the frame (a Custom Tile or an Object UI Image) | Nothing per frame; every client plays it itself | Only if TTS animates WebP (T2), which is doubtful |
| **V: video bundle** | A Unity AssetBundle with a VideoPlayer playing the provider's MP4 link onto the frame's face | Smooth, each client streams it itself, no Lua per frame | Only if TTS keeps a VideoPlayer component in a bundle and lets it read a URL (T5, unknown); needs a bundle build like `mtg-fx` |
| **F: flipbook** | The GIF's frames as separate PNG links, preloaded as the frame object's UI pictures, and the host's Lua swaps the picture 8-10 times a second | Works with what we know TTS does | Lua work per frame on the host, and every swap goes to every client (T4 measures it); each client downloads every frame |

**Frame links for route F.** The host's bridge can cut frames, but it has no public web address, so remote players
couldn't download them. A public image proxy can: images.weserv.nl processes the first frame by default, `n=-1`
handles all frames of an animated GIF or WebP, and `page=` picks one page
([wsrv docs mirror](https://images-wsrv.thepage.ua/docs/format)) **(unverified that `page=` picks a GIF frame;
spike T3)**. A frame link would look like
`https://wsrv.nl/?url=<gif link>&page=<k>&output=png&w=256`. If `page=` doesn't pick GIF frames, route F needs
another public host for frames, and none is free of an account, so route F would fall back to showing the still.

## 3. Providers

- **GIPHY first.** A new key is a beta key limited to 100 calls an hour; production keys are applied for in the
  dashboard ([quick start](https://developers.giphy.com/docs/api/quick-start-guide/)) **(verified: official docs)**.
  Apps must show the "Powered By GIPHY" mark where the API is used ([API docs](https://developers.giphy.com/docs/api))
  **(verified: official docs)**: the search panel shows it. GIPHY's results carry still pictures, WebP and MP4 links,
  and a `rating` filter.
- **KLIPY second, after reading its terms.** Third-party guides say the key goes in the path
  (`https://api.klipy.com/api/v1/<key>/gifs/search?q=...`) and that ads run in Search and Trending results
  ([Zuplo guide](https://zuplo.com/learning-center/klipy-api)) **(unverified; KLIPY's own docs page is mostly about
  ads)**. If its terms require showing its ads, it may not fit a game table; decide after reading them.
- One small adapter per provider in the bridge, both returning the same list (§4), so adding a provider is one file.

**Keys.** The host makes their own GIPHY (and KLIPY) developer key; Claude can't make accounts. The key is typed into
the companion (Table tools), kept on the host's PC only, and passed to the bridge at start. It is **never** in the
table save or the table script: the save goes to friends and into release packages, so a key there would be public.
That is also why the search runs in the bridge, not in TTS's Lua (`WebRequest` from the table script would need the
key in the script). No key: the frames don't appear and `mtg gif` says how to add one.

## 4. How it fits the code

- **Bridge** (`bridge/gifs.js`, new): `search(provider, words, page, rating)` returns up to 8 items
  `{ id, title, still, webp, mp4, frames, w, h }` (`frames`: the route-F frame links, at most 24). Answers are cached
  (the same words within a day cost no call), the GIPHY hour limit is counted, and when it runs out the player is told
  "GIF search is resting for N minutes". New messages: table to bridge `gif_search {color, q, provider, page}`; bridge
  to table `gif_results {color, items, credit}`. The table log gets one line per pick ("White shows a GIF: <title>").
- **Table** (`tools/engine-renderer.lua`): the frames are spawned once per load like the effect rigs (GM notes
  `engine:gif`, memo the colour; the sweep, the stray watcher and `mtg start` leave them alone). The search panel is
  **Object UI on the frame itself**, not the screen UI: the screen UI is at about 60 KB with four seats and above that
  other players' buttons stopped working (docs/m5-plan.md). Visibility per player is the XmlUI `visibility` attribute
  (already used for every seat's panels). "Hide GIFs for me" removes that colour from each frame's visibility. The
  frame's state (link, title, still) is saved in `onSave` inside an existing saved table: **no new main-chunk local**
  (MoonSharp allows 200 and the table is close: older docs say 179 to 194, so count again before building).
- **Companion**: a "GIF search keys" field in Table tools (with the tooltip saying where the key is stored and that it
  never leaves this PC), and the key handed to the bridge the way other settings are.
- **Rewind/Undo:** frames are not game state; an Undo leaves them as they are.

## 5. Costs and limits

- Route F, measured in T4 before it's chosen: host Lua per swap, how many swaps a second four frames cost, and whether
  remote players see the frames in time. Hard caps either way: at most 2 frames animating at once (the rest hold their
  still), 8-10 frames a second, 24 frames per GIF, 256 px wide.
- Downloads per client: a GIF's frames at 256 px are roughly 20-40 KB each, so up to about 1 MB per GIF per client on
  route F **(estimate)**; route V streams the MP4 (GIPHY's are small); route W is one WebP.
- Rating filter on every search; the host's clear command covers anything that slips through.

## 6. Phase 0: the spike (about half a day, before any build)

All in real TTS on the user's PC, with a scratch table, not the user's save:

1. **T1** a `.gif` link on a Custom Tile and on an Object UI Image: loads or "unsupported format"?
2. **T2** a GIPHY animated `.webp` link on both: shows, and does it move?
3. **T3** wsrv.nl `page=0..5` on a GIPHY GIF with `output=png`: six different frames, and how fast?
4. **T4** route F on one object: 24 frames preloaded with `UI.setCustomAssets`, the Image swapped 10 times a second
   for 60 s; record host frame time (our usual PresentMon method) with 1 and with 4 frames; a second client if one is
   available.
5. **T5** a test bundle from the Unity project (`C:\Users\you\mtg-unity\Tabletop-Simulator-Modding`) with a
   VideoPlayer playing a GIPHY MP4 URL onto a quad: does it play in TTS?

Pick the route: W if T2 moves; else V if T5 plays; else F if T3 and T4 pass; else **the feature is dropped** (the
user, 2026-11-13: stills only is not worth building).

## 7. Build phases (after Phase 0)

1. **Stills** (about 1 day): keys in the companion, the bridge's GIPHY adapter with tests on recorded real answers
   (captured once, never typed by hand), the frames, the search panel, chat commands, hide-for-me, host controls.
   Built only once Phase 0 has found a route that moves; it does not ship on its own.
2. **Motion** (about 1-2 days, depends on the route).
3. **KLIPY** (about half a day, only if its terms fit).

Each phase: a builder and a checker agent, the table's simulator tests and a break-it proof, one deploy with TTS closed.
A two-person check (that remote players see the frames and their downloads keep up) needs a second player.

## 8. Decisions (the user, 2026-11-13)

1. **Place and size:** square, as tall as a card; spawns in a free spot on the owner's mat; only the owner can move it.
2. **When:** always on, not only during a game.
3. **Default rating:** PG-13.
4. **Stills only:** not worth building. If Phase 0 finds no moving route, the feature is dropped.

## Phase 0 results (2026-11-13)

Run in real TTS 14.2.2 on a blank scratch singleplayer game (TTS was at its main menu, not on the user's table, so
a scratch game was created; the user's save was not loaded). GIPHY test id `26ufdipQqU2lhNA4g` (200x200; its
`giphy.webp` starts with `RIFF..WEBPVP8X` and has `ANIM`/`ANMF` chunks, so it is a truly animated WebP).
Shots and scripts: `tmp/gif-phase0/`.

- **T1, `.gif` link on a Custom Tile: does not work (verified live).** TTS prints "Supported formats: .jpg, .png,
  .webp, .webm, .mp4, .m4v, .mov, .rawt, .unity3d" and shows no image.
- **Route W, animated `.webp` on a Custom Tile (T2): does not work (verified live).** TTS prints "Async loading
  images: WEBP decoding failed" for the GIPHY animated WebP; no picture. (A static WebP loads, per the bridge's
  custom-art rule; the animated one is what the decoder rejects.) Not tested on an Object UI Image.
- **New route M: a plain `.mp4` link straight on a Custom Tile PLAYS and LOOPS (verified live).** That error message
  lists `.mp4`, `.m4v`, `.mov`, `.webm` as formats a custom image link accepts. `https://media.giphy.com/media/
  26ufdipQqU2lhNA4g/giphy.mp4` as the Custom Tile's `ImageURL` (via `spawnObjectData`, Custom_Tile, Stretch on)
  showed the GIF moving: four window captures a second apart each showed a different frame, and captures minutes
  later were still moving (it loops). No Unity bundle, no Lua per frame, no flipbook. GIPHY serves an MP4 for every
  GIF, so the provider adapter just returns the `mp4` link.
- **Route V (Unity VideoPlayer in an AssetBundle): not built, not needed.** Research (web search; the official
  custom-AssetBundle page, kb.tabletopsimulator.com/custom-content/custom-assetbundle/, says a bundle may not hold
  our own scripts and lists only TTSAssetBundleEffects/Sounds) found no TTS source for VideoPlayer in a bundle or a
  workshop video-player mod: **unverified, no evidence either way**. Unity 6000.0.62f1 is installed and the project
  builds `mtg-fx`, so a bundle could be built if route M fails later.
- **Left untested:** MP4 on an Object UI Image (`UI.setCustomAssets` + `<Image>`; my exec channel stopped answering
  before it ran: the bridge on 48787 had gone away and a direct External Editor API call got no reply); whether
  other players' clients play it and in sync (needs a second player); frame-time cost with 4-6 playing tiles (T4's
  PresentMon method); audio (GIPHY MP4s have none, so nothing was heard or tried); the owner-only move/lock and
  `Custom_Tile` vs a small custom frame model; `.webm`/`.mov` links; save/reload with a video tile on it.
- **Route pick:** W is out; M is the new first choice (needs a two-player check and a cost measurement before the
  build); F is only a fallback now, V only if M fails in multiplayer.

## Phase 1 checks and the build (2026-11-13)

Checked live in TTS 14.2.2 on a scratch singleplayer game (never the user's table; `TS_Save_1.json` checked unchanged,
sha256 b3e24db7...). Scripts and shots: `tmp/gif-p1/`.

- **(a) MP4 on an Object UI Image: does not work (verified live).** TTS prints "Xml UI only supports Texture2D" and draws
  nothing. A `.jpg` does: GIPHY's `480w_s.jpg` still, and a GIF's still turned into a JPEG by wsrv.nl
  (`https://wsrv.nl/?url=media.giphy.com/media/<id>/200w_s.gif&w=160&h=160&fit=inside&output=jpg`). So the search
  results are still pictures, and the "hold" after 12 s is an Object UI Image of the still laid over the playing tile
  (the tile isn't reloaded to stop it).
- **(b) Six tiles playing GIPHY MP4s cost little (verified live, PresentMon, 30 s each, empty scratch table).**
  Baseline 4300 frames (143 fps), median 6.9 ms, p99 8.2 ms; six playing 4295 frames, median 6.9 ms, p99 8.3 ms, worst
  31 ms. GPU busy 1.92 to 2.36 ms a frame (p99 3.62 to 5.64), CPU busy unchanged (6.83 to 6.84 ms); the TTS process
  used 20% more of one core (62% to 82%) and 8 MB more memory. **The spec's "at most 2 playing" cap was for route F and
  is dropped**: every frame may play. Not measured on the 70-80k-object game table. A picture change is a respawn: one
  87 ms frame on the empty table (expect up to ~0.4 s on the full one, as `destruct`), so it happens only on a pick or
  a clear, never for hold/replay.
- **(c) Save and reload with video tiles: works (verified live).** An autosave captured two MP4 tiles; loading it brought
  both back, playing (frames changed between shots).
- **(d) `.webm`: only VP8 (verified live).** A VP9 `.webm` fails (TTS opens its CUSTOM TILE import dialog and closing
  that deletes the object); a VP8 `.webm` plays; an MP4 remuxed to `.mov` plays. GIPHY serves no `.webm`
  (`giphy.webm` answers 403), so the adapter uses MP4 only.
- Also seen: a failed picture link (bad MP4, VP9) opens that import dialog on the host, and its X deletes the object.
  Every link the bridge sends is checked to be GIPHY's own media host over https (`media*.giphy.com`, `i.giphy.com`).

**Built (branch `gif-frames`).**

- **Bridge** `bridge/gifs.js` (new): the GIPHY adapter and the search: 8 items a page `{ id, title, mp4, still, thumb,
  w, h }`; the original MP4 unless it is over 2 MB (then the 200-high one); the still is `480w_still` (a .jpg) or the
  original still through wsrv.nl as a JPEG; the thumb is the small still through wsrv.nl at 160 px; titles lose
  quotes, angle brackets, ampersands, backslashes and control characters. Cached a day per words/page/rating; the
  hour's calls counted (100 for a beta key), past it "GIF search is resting for N minutes"; GIPHY's own 429 rests it
  15 minutes; 401/403 say the key was refused. `bridge/bridge.js` ("GIF frames" block): `gif_hello` and the
  table's hello -> `gif_config { on, credit, why }` (the hello one only while a key is set, so a table without a key
  hears nothing new); `gif_search` -> `gif_results`; `gif_pick` -> one table-log line "White shows a GIF: <title>";
  `POST /tools { kind: "gif-key", provider, key }` sets or (empty) removes the key; `GET /tools` has
  `gifs { giphy: { set, ends }, used, limit, restingMin }`, never the key.
- **The key** is kept in `%APPDATA%/MTG-TTS/gif-keys.json` (`~/.config/MTG-TTS` elsewhere; `MTG_GIF_KEYS` overrides; a
  test bridge keeps it in memory), outside the repo, the save, the table script and the friend package. It is typed
  in the companion's Table tools (GIF frames: a password box, Save key, Remove key), handed to the bridge over its
  local `/tools`, and the page never shows it back (only its last four). `MTG_GIPHY_KEY` in the live bridge's
  environment also works.
- **Table** (`tools/engine-renderer.lua`, "GIF FRAMES" block at the end; all state in the global table `engineGif`, no
  new main-chunk local: 187 before and after). Changes from §4: GM notes `mtggif:<colour>` rather than `engine:gif`,
  so the engine's sweep, stray watcher and self-check never see a frame and none of their code changed; the frame is
  **unlocked** (a locked object can't be picked up) and `onPlayerAction` refuses every action on it but the owner's
  pick-up, select and rotate; a frame dropped off its owner's mat goes back. Spawned in the first free spot of 24 beside
  the mat's battlefield grid (`SPOTS_R` x `SPOTS_F`), turned like the owner's cards. Empty: the card back, square, with
  a dark "GIF" panel; with a GIF: the MP4, stretched, fitted inside the card-tall square (scale 1.53 / aspect for a
  wide one), its UI scaled back up so buttons are the same size on every frame. Under it: GIF... (owner only) and
  Replay (everyone; a click on the frame replays too). The panel (owner only, Object UI beside the frame): search box
  (Enter), 8 thumbs, More, Clear, X, a status line, "Powered By GIPHY". Chat: `mtg gif <words>` (first match),
  `mtg gif off`, `mtg gif help`, `mtg gifs` (state), `mtg gifs hide|show` (`setInvisibleTo` plus the UI's
  visibility, that player only), host: `mtg gifs on|off`, `mtg gifs rating g|pg|pg-13` (both saved in `onSave`
  beside the table's own state, only when not the defaults), `mtg gif clear <colour>`. Frames come and go with
  seated players (AI seats, Grey and Black get none) and all go on `gif_config off` or the host's off. A save's
  frames are adopted at load (their GIF is in the memo; a duplicate is removed) and the bridge is asked about its key.
- **Tests**: `tests/test_bridge_gifs.js` (adapter, links, cache, limits, key handling, the bridge's messages and
  tool) against `tests/fixtures/gifs/giphy-search.docs-shape.json`, which is **written from GIPHY's documented
  response shape, not recorded** (the host had no key yet): re-record it with a real key, and it is not part of any
  golden master. `tests/test_table_gifs.js` (the table side on the fake TTS). `tests/test_companion_page.js` (the key
  field). The fake TTS gained an object's `UI.setCustomAssets` / `getCustomAssets`.

**Seen live on the scratch game (2026-11-13)**, with the block loaded over the bridge's exec beside stand-ins for the
table's mat and seat (shots `tmp/gif-p1/l1.jpg` to `l6.jpg`): the empty frame and its GIF... button; a real click on
GIF... reached `Global/engineGifUiClick` and opened the panel to the owner's right, readable; four results drawn as
thumbs (wsrv JPEGs); a pick respawned the frame playing the 16:9 MP4, fitted inside the square, with GIF... and Replay
under it at the same size. It also found a bug, fixed since: `onObjectDestroy` compared the destroyed old frame with
the new one by `==`, which raised "Object reference not set to an instance of an object" in TTS; frames are now
compared by GUID (`engineGif.same`). The fix itself was not re-run live: loading the block a second time into the same
scratch game chained each wrapper to itself and froze TTS (a test-harness mistake: the table loads the block once per
script load), so TTS was closed. Not seen live: typing in the search box (`onEndEdit`), the hold after 12 s.

**Needs a live check after the deploy:** frames spawning on the real table's four mats (spots clear of the trackers,
tax labels and dungeon), the UI's side and reading direction at each seat, the `Global/` handlers from Object UI
buttons and the InputField's `onEndEdit`, the still overlay hiding the video, a second player's client (plays, in
sync enough, sees only their own panel), the respawn hitch on the full table, and the frame time with four playing
during a big game. **The user must** make a GIPHY key (developers.giphy.com: Create an App, API) and paste it into the
companion's Table tools; then a real search answer should be recorded to replace the docs-shaped fixture.

**Key guide for other hosts (2026-11-13, the steps the user walked).** Under the companion's GIPHY key box, a
collapsed "Get a GIPHY key" block, and the same steps in HOW-TO-PLAY.md's host section ("Optional: GIF frames"):
developers.giphy.com, menu, Dashboard (sign in or a free account), Create an App / Create API Key; screen 1 of 2
**API, not SDK** (the SDK form says "SDK beta key" and asks for the SDK licence: the wrong one); screen 2 of 2 any
name, Platform **Other**, a one-line description, the box naming the **GIPHY API Terms**, Create API Key; copy the key
into the box. Also said: only the host needs a key; free; a beta key is 100 searches an hour for the whole table; the
key stays on this PC, never in the save or the friend package; don't share it or paste it in chats; with no key the
frames don't appear and everything else works. The bridge's no-key chat line points at the block.
`tests/test_companion_page.js` checks both (the "key guide" checks). HOW-TO-PLAY.md also gained the players' "GIF
frames" section and the chat commands. The bridge's search now has a `.catch`: an async throw is logged, never an
unhandled rejection that would end the bridge.

**Phase 1 checks done live (above):** (a) MP4 on an Object UI Image, (b) frame time with six playing tiles, (c) save
and reload, (d) `.webm`. **Not checked:** a second player's client, audio, the frame time on the full 70-80k-object
table, typing in the search box, the 12 s hold, the GUID fix for `onObjectDestroy`.
