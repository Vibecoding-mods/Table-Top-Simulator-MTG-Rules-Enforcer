# M5 step 4: table effects (design, 2026-11-05)

Status: built in source 2026-11-05 (`tools/engine-renderer.lua`, `tools/make-engine-copy.js`, test
`tests/test_table_effects.js`), not deployed, not seen on the real table. The bridge's `jump` flag (section 5) is
written as a hunk in `tmp/effects/bridge-hunk.md`, not applied. The short version is in `docs/m5-plan.md`,
"Step 4: effects".

What the build does differently from the text below:
- Until the bridge sends `jump`, the table also treats these as jumps: the turn going down, the newest restore point
  going down, a rewind vote newly "approved", and the first board after a `started` message (a resend sends one).
  The board has no game id; a new game is caught by the reset that `clear` already does.
- Without pictures, each slot's `_img` is a Text element showing "●" (not an inactive Image), so the number text
  ("×N", "−N") stays free.
- The build is `FX.build()` inside the block (no new global); the test hooks are `engineFxLast.fx` (with the slot
  used) and `engineSoundLog` (lines like `"death music"` or `"death bundle"`).
- A blocked attacker's own id gets a lunge hit time too, so damage to it lands at the contact.
- A rewind that brings a knocked-out player back lights their life counter again.

Four events get an Arena-style effect on the table, and each gets a sound hook (the sounds are left empty for the
user to pick):

| Event | Effect on the table | Length |
|---|---|---|
| A permanent goes to the graveyard (dies, sacrificed, destroyed) | white flash, then purple-black smoke where the card was | 0.9 s |
| A counter is put on a permanent | a pale blue ring around the card | 0.5 s |
| Damage to a creature / to a player | an orange-white burst on the card / on the player's side of the table, timed with the attack swing | 0.35 s / 0.45 s |
| A player is knocked out (loses or concedes) | their life counter glows red, then a white-hot burst and orange-red smoke | 1.5 s |

No AssetBundle, no Unity, no new objects. Everything is drawn by a small, pre-built piece of Object UI (XML UI that
belongs to one object) on White's life counter, plus `highlightOn` on the life counters.

## 1. What MTG Arena does (what we copy)

From `reports/MTG Arena effects from gameplay video.md` (14 videos, frame by frame) and the player's reference video
in `docs/m5-plan.md`. Timings are ±0.1–0.25 s.

- **Death** (one look for combat and spell kills, and for sacrifice and destroy):
  - 0 ms: a white flash on the card;
  - then a purple orb in billowing purple-black smoke about 1.5× the card's size; the card darkens and breaks into
    square tiles;
  - 900–1000 ms: the spot is empty; the other cards slide together over 300–500 ms;
  - two deaths at once overlap about 300 ms apart; the card is never seen flying to the graveyard;
  - the player's video (Kaito): white flash from the centre, dark purple smoke swirling into a vortex, about 0.8 s.
- **Counter added** (+1/+1 seen only): white ripple rings spread around each card that got one and its P/T plaque
  flashes white, about 500 ms. Then a dark-blue badge stays and the P/T shows in blue (our step 2 already does that).
- **Damage to a creature:** the attacker lunges in, gold sparks at the contact point, a white flash around the damaged
  card, a small red number near its P/T. 300–600 ms. A burn spell's flash spreads over 2–3 card widths.
- **Damage to a player:** the attacker flies into the player's portrait (about 300 ms each way); an orange-white
  starburst about two portraits wide; a red number; the life total snaps to the new value; the life plate tints red
  for about 500 ms. The next attacker follows 0.4–1.5 s later. A ping from an ability: about 1.7 s from launch to the
  tint clearing.
- **Knocked out:** the board rests about 1.8 s after the last hit; a red glow builds around the loser's portrait, a
  white-hot flash fills about a third of the screen, an orange-red cloud and dark debris burst out, the board dims.
  Glow to debris: 1.3–1.5 s. A concession looks the same. Then VICTORY / DEFEAT about 2.5 s after the kill (we
  already have those banners).
- **Never:** camera shake, screen-filling flashes (except at game end), effects that make the game wait.

## 2. What TTS can do from Lua without our own AssetBundle

| Mechanism | What it does | Seen by other players? | Use here |
|---|---|---|---|
| `obj.highlightOn(color, duration)` | outline that turns itself off after `duration` s ([Object API](https://api.tabletopsimulator.com/object/)) | yes, by everyone (our own note in `tools/engine-renderer.lua`, the playable-frame comment) | life counter red flash only |
| Object UI (`obj.UI.setXml`, `setAttribute(s)`) | XML UI drawn in 3D on an object; `setXml` is asynchronous, `setAttribute(s)` "override ... for all players" ([UI API](https://api.tabletopsimulator.com/ui/)) | yes; `visibility` limits an element to listed colours ([UI attributes](https://api.tabletopsimulator.com/ui/attributes/)) | **all four effects** |
| `showAnimation` / `hideAnimation` | Grow, FadeIn, SlideIn_* / Shrink, FadeOut, SlideOut_*; `animationDuration` default 0.25 s; played by `show()` / `hide()`, "unlike the active attribute" ([UI attributes](https://api.tabletopsimulator.com/ui/attributes/)) | — | see the trap below |
| `UI.show` / `UI.hide` | animated show/hide | **ignores `visibility`**: it showed every player's banner to everyone (playtest 2026-10-23, comments in `engineEffects` and the turn banner) | not used by default |
| `setPositionSmooth` / `setRotationSmooth` | smooth moves ([Object API](https://api.tabletopsimulator.com/object/)) | yes | already used by the attack lunge; not needed here |
| `Global.setVectorLines` | lines for everyone, saved with the game | yes | already used for target/attack/block lines; not for effects (each change redraws all lines) |
| `spawnObject` / `destruct` | new objects; `spawnObject` can play the spawn sound ([Base API](https://api.tabletopsimulator.com/base/)) | yes | **never**: each `destruct()` costs about 360 ms here (`tts-perf-facts`) |
| AssetBundle trigger effects | `obj.AssetBundle.playTriggerEffect(index)`, index from `getTriggerEffects()` ([AssetBundle API](https://api.tabletopsimulator.com/behavior/assetbundle/)); each effect holds particles, one `AudioClip` with a `Positional3D` flag, an animation, `Duration` 1 s by default ([TTSAssetBundleEffects.cs](https://github.com/Berserk-Games/Tabletop-Simulator-Modding/blob/master/Assets/Scripts/TTSAssetBundleEffects.cs)) | not documented; the step 3 two-client test was never run | **sounds later** (route B below) |
| MusicPlayer | one shared player: `setCurrentAudioclip({url, title})`, `play`, `pause`, `loaded` = "all players loaded the current audioclip", `player_status`, `getCurrentAudioclip`; **no volume** ([MusicPlayer API](https://api.tabletopsimulator.com/musicplayer/)) | yes, everyone (it is the table's music player) | **sounds now** (route A below) |
| Component API | `obj.getComponent(name).set(var, value)`; examples include muting an object's audio ([Components](https://api.tabletopsimulator.com/components/examples/)) | not documented | not used (could set a bundle's volume someday; unverified) |
| Plain "play this sound" call | does not exist: no Lua function plays audio ([Base API](https://api.tabletopsimulator.com/base/)) | — | — |

Is a free, public particle AssetBundle realistic? Not soon:
- Bundles must be built in Unity 6000.0.62f1 with no custom scripts, and custom or legacy shaders "will likely appear
  pink" on other platforms ([TTS KB](https://kb.tabletopsimulator.com/custom-content/custom-assetbundle/)).
- Asset Store and Fab packs can't be redistributed in a public mod, and the one big public TTS effects library
  (Workshop 2554037089) was removed for violating Steam's rules (`reports/MTG Arena style effects for TTS.md`).
- So a bundle means building our own from CC0 textures: about 3–5 days including Unity, plus the two-client test.
  This design gets most of the look with no bundle. A bundle can replace the pictures later without changing the
  triggers.

## 3. How it works

### 3.1 The carrier: White's life counter

- The four life counters are ordinary locked `Custom_Token` objects with no XML UI (checked in the user's save:
  `23e485` White at (3.5, 0.89, −2.62), rotation y 180, scale 1.258 on x and z). They stay put all game.
- At the first board of each game, `engineFxBuild()` checks `carrier.UI.getXml()` for `eng_fx_1`. If it isn't
  there, it calls `carrier.UI.setXml(FX_XML)` once and `carrier.UI.setCustomAssets(...)` once. That's one UI build
  per game at most (it then stays in the save, inactive). It never runs during play.
- Carrier: `LIFE_TRACKERS.White`, else the first of Red, Yellow, Blue that exists. If none exists, there are no
  effects (sounds still play).
- Effects anywhere on the table are panels of the carrier's UI, moved by their `position` attribute. No objects
  move, none are spawned.

### 3.2 The pool (FX_XML)

Seven slots: `eng_fx_1` … `eng_fx_6` for cards and players, and `eng_fx_ko` for a knock-out. Each slot is:

```xml
<Panel id="eng_fx_1" active="false" raycastTarget="false" width="220" height="220" position="0 0 -70"
       showAnimation="Grow" hideAnimation="FadeOut" animationDuration="0.15">
  <Image id="eng_fx_1_img" image="fx_burst" color="#FFFFFFE6" preserveAspect="true" raycastTarget="false"/>
  <Text id="eng_fx_1_txt" fontSize="90" fontStyle="Bold" color="#FFFFFF" outline="#000000C0" outlineSize="3 -3"
        alignment="MiddleCenter" raycastTarget="false"> </Text>
</Panel>
```

- `raycastTarget="false"` everywhere, so no click on a card or the counter is ever blocked.
- Pictures are `UI.setCustomAssets` names: `fx_burst` (a white star burst), `fx_smoke` (a soft white smoke puff,
  tinted by `color`), `fx_ring` (a thin white ring). Source: CC0 Kenney Particle Pack (smoke, star/flare and circle
  sprites, 128–256 px PNG). Their URLs go in `engineFxArt = { burst = nil, smoke = nil, ring = nil }`.
  - They need hosting: the user uploads the three PNGs once with TTS's Cloud Manager (Modding → Cloud Manager) and
    pastes the links, or they come from the public repo once it is public. Masters in `assets/vfx/`, credited in
    CREDITS.md.
  - **Until the links are set:** `engineFxBuild` makes each `_img` inactive and the `_txt` shows "●" in the effect's
    colour (font size from the effect's size). Same timings, cruder look. Check on the real table that "●" draws
    (real-table check 4).

### 3.3 Placing a slot at a world spot

```lua
local s = carrier.getScale()
local l = carrier.positionToLocal(spot)                 -- spot: Vector on the table
local x, y = FX.AX * l.x * FX.UNIT, FX.AY * l.z * FX.UNIT
local lift = FX.LIFT * FX.UNIT / s.y                    -- above the cards, below the stack (stack floats at +2.5)
carrier.UI.setAttributes(id, { position = string.format("%.0f %.0f %.0f", x, y, -lift),
  width = math.floor(size * FX.UNIT / s.x), height = math.floor(size * FX.UNIT / s.z),
  rotation = string.format("0 0 %.0f", FX.ROT0 + seatRotY - carrier.getRotation().y),
  visibility = viewers, active = "true" })
```

- Constants to calibrate once on the real table (real-table check 2): `FX.UNIT = 100` (UI units per local unit, the
  value the playable frame's "0 0 -12" suggests), `FX.AX = -1`, `FX.AY = 1`, `FX.ROT0 = 180`, `FX.LIFT = 0.7` world
  units. `FX.CARD = 2.2`: a card's width in world units (check with a card's `getBounds().size.x`).
- `seatRotY` is `seatGeometry(colour).rotY`, so the "xN" and "−N" text reads the right way up for that seat.
- `viewers`: the 12 colours minus every `engineEffectsOff[colour]` (as `popVisibility` does). An empty list means
  "everyone" in TTS, so if it is empty, nothing is shown at all.

### 3.4 Showing and hiding: the `active` trap

- `UI.show` ignores `visibility` (playtest 2026-10-23), so the default is `setAttribute(id, "active", "true" /
  "false")`. That respects `mtg effects off` per player. The TTS page says only `show`/`hide` play the animations,
  so with `active` the slot may just appear and disappear (real-table check 3).
- `FX.SHOW = false` (default): `active`. Set it to `true` to use `carrier.UI.show(id)` / `hide(id)` and get the Grow /
  FadeOut tweens; then `mtg effects off` can no longer hide the table effects from one player (only the host's
  `mtg animations off` stops them). One helper, `fxToggle(id, on)`, holds this choice.
- Changes inside an effect (white flash → smoke) are one `setAttributes` each, at most 3 per effect.

### 3.5 When effects run

- `engineEffects(m)` (existing, `tools/engine-renderer.lua` ~1213) already compares each board with the last one
  (`FX.prev`). Step 4 extends what it remembers and adds one call at its end: `engineFxBoard(m, prev, now, diedIds)`.
- **Nothing changed, nothing runs:**
  - first line of `engineEffects`: `if not engineBoardNew then return end` (a redraw of the same board does nothing;
    today it loops over every card for no result);
  - `engineFxBoard` returns before any UI call when it found no event;
  - if visuals are off for everyone (`engineAnimOff`, or every seated player has `engineEffectsOff`) and sounds are
    off, it returns right after the comparison.
- **Jumps are not plays:** the first board after a rewind, a bridge resume or a table resend carries `jump = true`
  (new bridge field, section 5). On such a board, and on any board whose `turn` is lower than the last one,
  `engineEffects` only stores the new snapshot. This also stops today's false "death" flash for tokens a rewind takes
  away.
- **Dispatch one frame later:** `engineFxBoard` collects the events, then runs them in `Wait.frames(fn, 1)`. By then
  `engineCombatLunge` (which runs later in the same `engineRender`) has filled `engineLungeHits`, so impacts land
  when the swinging card hits.
- **Cost:** count `engineProfile.sect.fx` (os.clock around the dispatch). Budget: under 5 ms per board on the host
  (the M5 rule). Expected: well under 1 ms (at most 6 effects × 3 UI calls).

### 3.6 Caps

- At most 6 effects at a time on the table (the 6 slots). A slot is free once `os.clock() >= FX.slotUntil[i]`.
  `eng_fx_ko` is only for knock-outs.
- At most 6 effects started per board, in this order:
  1. knock-outs;
  2. deaths;
  3. damage to players;
  4. damage to creatures;
  5. counters.
- When no slot is free, the effect is dropped (never queued: effects never hold up play). The count goes into
  `engineFxLast.dropped`.
- A board wipe: more than 3 deaths on one seat's battlefield in one board = one bigger smoke (2.2 card widths) at the
  middle of those cards' spots, with "×N" in white.
- One sound per board (section 4).

## 4. The four effects

All four need `FX.prev` to hold a bit more per battlefield card. In the `now.bf[card.id]` entry, add:
- `pos = enginePlanned[card.id]` (its spot on this board; the zones are laid out before `engineEffects` runs);
- `dmg = tonumber(card.dmg) or 0`;
- `ctr = card.ctr` (a reference, not a copy).

Add `now.life[colour] = pl.life` and `now.turn = tonumber(m.turn)`.

Zones the bridge left out because they didn't change (`keep`) are carried over, as today.

### 4.1 Death (a permanent to the graveyard)

- **Trigger (no bridge change):** a card id in the last board's `players[].battlefield` that is in no
  `players[].battlefield` now, and is in a `players[].graveyard` now, or was a token (`tok`). This is exactly
  today's `died` / `diedIds` in `engineEffects`. All kinds count (creature, land, artifact), as Arena treats every
  move to the graveyard the same. A token that goes back to a hand also counts (known limit: the table can't tell
  without the bridge's `how`).
- **Where:** `prev.bf[id].pos`, the spot the card had on the last board. No spot (a grouped token that had no object
  of its own): use the spot of another card from the same group. If there is none, no smoke (the graveyard flash
  still shows).
- **Look:**
  - 0–150 ms: `fx_burst`, white `#FFFFFFE6`, 1.0 card width;
  - 150–900 ms: `fx_smoke`, purple-black `#3D1A5CDD`, 1.5 card widths;
  - then off.
  - Board wipe: smoke 2.2 card widths with "×N".
- **Timing with combat:** if the card was a blocker swung at this board, start at its `engineLungeHits[id]` time;
  else at once. Two or more deaths: each one 80 ms after the one before (Arena's overlap, kept short).
- **Unchanged:** the violet graveyard flash with "xN" (`deathFlash`) stays.
- **Sound:** `death` (once per board, however many died); `wipe` instead when 3 or more died on the board (section 6).

### 4.2 Counter put on a permanent

- **Trigger (no bridge change):** a card on the battlefield in both boards, and some key of `ctr` now has a higher
  number than before (`(now.ctr[k] or 0) > (prev.ctr[k] or 0)`).
  - Cards that just arrived don't count: a creature entering with counters, a planeswalker's starting loyalty.
  - A loyalty ability's "+1" counts, and that's fine.
- **Where:** the card's `pos` this board. One effect per object: grouped tokens share one.
- **Look:** `fx_ring`, 1.1 card widths, 0–500 ms. Pale blue `#A8D8FFE6`; violet-grey `#9A7ACCE6` when the counter
  that grew is `M1M1`. No number: the dark-blue badge (step 2) already shows it.
- **Cap:** at most 4 rings per board (the badge change shows on the rest).
- **Sound:** `counter`.

### 4.3 Damage

- **To a creature.**
  - Trigger (no bridge change): a card on the battlefield in both boards whose `dmg` went up. `dmg` drops to 0 at
    cleanup, and that is ignored.
  - Where: the card's `pos`.
  - Look: `fx_burst`, orange-white `#FFB050E6`, 1.2 card widths, 0–350 ms; the slot's text "−N" (N = the rise) in red
    `#FF4A3A`.
  - Timing: start at `engineLungeHits[id]` when an attacker swings into it, else at once.
  - Cap: at most 4 per board, the biggest rises first.
- **To a player.**
  - Trigger (no bridge change): `players[].life` lower than on the last board. This also catches life paid or lost,
    which can't be told apart without an engine event (known limit; Arena shows only a small flash for paid life).
  - Where: `enginePlayerSpot(colour)`, the back centre of their board, where attack lines end and lunges hit. To share
    it, add `enginePlayerSpot = playerSpot` inside the lines `do` block.
  - Look:
    - `fx_burst`, orange `#FF9A40E6`, 2.0 card widths, 0–450 ms;
    - plus `lifeCounter.highlightOn({1, 0.2, 0.15}, 0.5)` on their life counter (no other glow is ever on it);
    - the red "−N" on the counter is step 2's and stays.
    - One burst per player per board, summed, like the number.
  - Timing: the first `engineLungeHits[colour]` time, else at once.
- **Lunge times:** in `engineCombatLunge`, when it swings, set
  `engineLungeHits = {}` and, per attacker, `engineLungeHits[target] = min(existing, at + LUNGE_WIND)`, where `target`
  is the blocker's id, else `a.atkT` (a player's colour or a planeswalker/battle id). Leave it alone on boards with no
  swing. `engineFxBoard` only reads entries made in the same `engineRender` (stamp `engineLungeHits.board = m`).
- **Sound:** `damage` (once per board, even for a 5-attacker swing).

### 4.4 Knocked out

- **Trigger (no bridge change):** `players[].status` was `"playing"` and is now `"lost"` or `"conceded"`.
  - Finding: the harness sends `"conceded"` for a concession (`InteractiveSnapshotExtractor.java` line 300). Today's
    `engineEffects` and the "has lost the game" message only look for `"lost"`, so a concession shows no DEFEAT /
    IS OUT banner and no darkened counter. Step 4 fixes the knock-out check in `engineEffects` to
    `status ~= "playing" and prev.status[c] == "playing"`, which also gives the banners to a concession.
- **Where:** the loser's life counter (Arena's portrait).
- **Look (shared, about 1.5 s):**
  - 0 ms: `lifeCounter.highlightOn({1, 0.15, 0.1}, 0.7)`, the red glow building;
  - 600 ms: `eng_fx_ko` with `fx_burst`, white-hot `#FFF2D0F0`, 3 card widths, for 200 ms;
  - 800–1500 ms: the same slot as `fx_smoke`, orange-red `#C8401AD0`, 4 card widths;
  - then off.
- **Unchanged:** the counter darkening (`setColorTint(FX.OUT)`) and the DEFEAT / "<COLOUR> IS OUT" / VICTORY banners
  stay as they are.
- **Cap:** `eng_fx_ko` is one slot. A second knock-out in the same board uses a free normal slot, or is dropped.
- **Sound:** `knockout`, at 600 ms.

### 4.5 How other players see it

| Piece | Host | Other players |
|---|---|---|
| Slots (Object UI attributes) | sees them | sees them: `setAttribute(s)` applies "for all players" (UI API); hidden from players with `mtg effects off` through `visibility` (FX.SHOW = false). Not yet seen on a second client (real-table check 6) |
| Life counter highlights | sees them | sees them (highlights are seen by everyone); `mtg effects off` can't hide them, only the host's `mtg animations off` |
| Timing | — | each change is a network message, so a client may see it a few frames late; the effect is short and changes nothing in the game |
| A player who joins mid-effect | — | may see nothing or the last frame of it; at most 1.5 s |
| Sounds | route A: everyone (shared music player); route B: unknown until the two-client test | same |

## 5. Bridge change (one field)

`bridge/bridge.js`, for jumps only. Nothing else is needed: `life`, `status`, `dmg` and `ctr` are already in every
board.

- In `checkRestored`, in the `seat === leadSeat()` branch, next to `game.sentZones = {}`: `game.fxJump = true;`
- In `resendToTable`, next to `game.sentZones = {}`: `game.fxJump = true;`
- In `sendTable`, in `tableMsg` after `rewind,`: `...(game.fxJump ? { jump: true } : {}),`. Right after
  `toTTS(tableMsg)`: `game.fxJump = false;`.
  - It must be cleared after the send, not before the dedupe check. A board skipped as identical keeps the flag for
    the next one.
- Gates: `test_bridge_golden`, `test_bridge_events`, `test_state_delta` (golden boards gain `jump` only after a
  rewind or resend; re-capture if a golden includes one).

## 6. Sound hooks

```lua
-- M5 sound picks: nil = silent. A link (http...) plays through the table's music player (route A); a name plays
-- that trigger effect of the sound object (an AssetBundle whose GM notes are "engine:sounds", route B).
engineSounds = engineSounds or { death = "https://...", wipe = "https://...", damage = "https://...",
  exile = "https://...", instant = "https://...", lifegain = "https://...", counter = nil, knockout = nil }
engineSoundKinds = { "knockout", "wipe", "death", "exile", "damage", "lifegain", "instant", "counter" }
engineSoundsMuted = false -- the host's switch for the whole table
-- (plus the bursts: death_x2 ... death_x8 and the like, see "Bursts" below)
function engineSoundPlay(kind, force, n)   -- true if it played; n: the board's count for that kind (bursts)
```

**The user's sounds are in (2026-11-11):** `engineSounds` holds the six TTS Cloud links of `docs/sounds.md` (death,
wipe, damage, exile, instant, lifegain); counter and knockout have none yet. Not yet heard on the real table.

**The eight kinds** (four added 2026-11-11, sound only: no table effect of their own):

| Kind | When | Notes |
|---|---|---|
| `knockout` | a player loses or concedes | 600 ms in, with the burst |
| `wipe` | 3 or more permanents go to graveyards on one board, all seats together (a token that leaves the battlefield counts, as for death) | plays instead of death, with the first death; the visual "×N" cloud is still per seat and from 4 |
| `death` | a permanent goes to a graveyard (dies, sacrificed, destroyed), or a token leaves the battlefield other than to exile | |
| `exile` | a permanent leaves the battlefield for exile: it is in an exile zone now, or the bridge's `exd` names it | tokens count: a token exiled ceases to exist and no board shows it in exile, so the bridge sends the engine's word on the move (`exd`, the battlefield → exile moves since the last board sent, once); without the engine's event feed a token exiled still reads as a death. A card exiled from a hand, a library or a graveyard doesn't count; a flicker that is back on the battlefield by the next board doesn't either |
| `damage` | damage to a creature or a player (life down, life paid reads the same) | with the first lunge hit |
| `lifegain` | a player's life goes up on a board | a life loss never plays it |
| `instant` | an instant spell appears on the stack | the bridge marks the stack item `ins`: a spell, not an ability (`isAbilityOnStack`), no longer being cast, whose card it has seen as an Instant (its stack name first, else its card id, from every seat's view outside the battlefield). Forge's stack item has no card types, so an instant whose card no seat has seen face up (an AI's first of that name, from a hand nobody sees) plays nothing. The table plays it once per card (`src`), and not for a copy: a stack item with the name of an instant already on the stack while its controller's hand didn't shrink (Twincast's copy, storm's). Never for a sorcery, an ability, a Flash creature |
| `counter` | a counter put on a permanent | |

- **When:** at most one sound per board: the first kind of `engineSoundKinds` (knockout > wipe > death > exile >
  damage > lifegain > instant > counter) that is on this board **and has a pick**, so a wipe with no wipe pick plays
  death, and a knock-out with no knockout pick plays the damage that did it. Each kind at most once every 0.3 s, and
  any two sounds at least 0.15 s apart. It plays at that kind's first event's start time (lunge hit, knock-out
  600 ms, a wipe's first death); exile, lifegain and instant at once.
- **Bursts (2026-11-11):** a kind with a count can play a stacked clip instead of its plain one. The links are keys
  `<kind>_x<N>` in `engineSounds` (the 24 of `docs/sounds.md`, "Bursts"): damage, death, exile, lifegain ×2 ×3 ×4
  ×6 ×8; wipe ×3 ×4 ×6 ×8 (wipe's plain sound stays the 3+ one, so a wipe of 3 plays `wipe_x3`).
  - `FX.burst(kind, n)` picks the largest bucket with a link at or under the count, capped at `FX.BURST_MAX` = 8 (a
    `_x16` link is never used); a count of 1, or no bucket link under it, plays the plain kind. So 5 plays ×4, 7
    plays ×6, 50 plays ×8.
  - The counts, all on one board: death and wipe = the permanents that went to a graveyard (the same `diedIds` the
    wipe rule counts); exile = the permanents exiled from the battlefield (the exile zones' new ids plus `exd`);
    damage = the creatures that took damage (before the 4-burst visual cap) plus the players whose life went down;
    lifegain = the players whose life went up. The engine's own feed has no separate gain events for the table (the
    bridge only rebuilds gains for its log lines), and a board carries life totals only, so two gains by one player
    on one board count once.
  - Still one clip per board, by the order above, under the same limits: the spacing is kept per kind (`death_x4`
    and `death` share the 0.3 s), so a runaway turn plays at most one clip per update. `engineSoundLog` names the
    clip played (`death_x4 music`); the music player's title is `MTG effect: death_x4`.
  - `mtg sounds test <kind> [N]` plays the clip a count of N would.
- **Countered (fixed 2026-11-11):** the "COUNTERED: <name>" pop-up shows for an instant or a sorcery too. The
  bridge's `spell` (no `sourceAbilityText`: the table moves that card) is false for them, so it marks a stack item
  that is a spell with spell text, not an ability (`isAbilityOnStack`), `sp: true`; the pop-up takes `spell` or `sp`.
- **Not when:** `engineSoundsMuted`, no pick for that kind, a jump board, or (route A) the music player is busy with
  the players' own music: the current clip has a link, its title doesn't start with "MTG effect", and
  `MusicPlayer.player_status` isn't "Stop" (a paused track of theirs counts; before 2026-11-11 only "Play" did).
- **Route A, MusicPlayer (works today, no Unity):**
  - `MusicPlayer.setCurrentAudioclip({ url = pick, title = "MTG effect: " .. kind })`, then a `Wait.condition` (up
    to 2 s) that plays once the player holds this very clip (its link, or its title) and `loaded` is true: right
    after the set, `loaded` can still be the last clip's. A newer sound set before it plays wins; the older one
    never plays (2026-11-11, verifier).
  - Not over the players' own music: no sound while the player holds a clip not titled "MTG effect ..." unless the
    player is stopped (playing or paused, their track stays).
  - Limits (MusicPlayer API):
    - one clip at a time, so a new sound cuts the last one;
    - it waits until **every** player has loaded the clip, so the delay is unknown (real-table check 5: if it is
      over about 0.3 s after the effect, use route B);
    - no volume from Lua: each player's Music slider sets it;
    - the music player shows the clip's title to everyone.
- **Route B, sound AssetBundle (later):**
  - One object with one trigger effect per sound, named `death`, `counter`, `damage`, `knockout`, each a
    `TTSSound` with `Positional3D` off.
  - `engineSoundPlay` finds the object by GM notes once, maps names to indexes with `AssetBundle.getTriggerEffects()`
    (cached), and calls `playTriggerEffect(index)`.
  - Limits:
    - needs Unity 6000.0.62f1 and the step 3 test (do other players hear it?);
    - no volume from Lua (`TTSSound` has only `Audio` and `Positional3D`), so loudness is set in the clip (−16 to −18
      LUFS, plan step 5);
    - a quiet set can be a second effect named `death_quiet` etc., used when `engineSoundLevel == "quiet"`.
- **Commands** (`engineChat` in `tools/make-engine-copy.js`, and the Settings "My sounds" button `onMtgSnd`):
  - `mtg sounds off` / `on` from the host: sets `engineSoundsMuted` and tells everyone. From another player: keeps
    their `engineSoundOff` flag and tells them "Table sounds are shared: ask the host, or turn down Music / Effects in
    TTS's settings."
  - `mtg sounds test <kind> [N]` (host), any of `engineSoundKinds`: plays that pick now (with N, the burst a count
    of N picks), so the user can try sounds; an unknown kind lists them.
- **Bridge fields** (`bridge/bridge.js`, `sendTable`): `ins: true` on a stack item (`isInstantCast`, types from
  `noteTypes`), `sp: true` on a spell that isn't `spell` (an instant or a sorcery: the countered pop-up), and `exd: [card ids]` on the board (from `updateLog`'s engine facts; out of the board's signature like
  `jump`, cleared once sent). A bridge without them: no instant sound, and an exiled token reads as a death.
### Plugging in a sound (the user)

1. Get the sound as an **.mp3** file. The TTS music player docs give only .mp3 links in their examples and list no
   formats ([MusicPlayer API](https://api.tabletopsimulator.com/musicplayer/)), so .ogg or .wav are untested.
2. Upload it once: in TTS, Modding → Cloud Manager → upload. Copy the link it gives (it starts with `https://`).
   A direct `https://` link to the .mp3 elsewhere also goes in. Unchecked: whether the music player takes a Cloud
   Manager link (it has no ".mp3" at its end); try it with `mtg sounds test` (real-table check 5).
3. In `tools/engine-renderer.lua`, find the line that starts with `engineSounds = engineSounds or`, and fill in the
   links, one line per event (done 2026-11-11 for six of the eight kinds, `docs/sounds.md`; the block below is the
   original four-kind example):

   ```lua
   engineSounds = engineSounds or {
     death = "https://steamusercontent-a.akamaihd.net/ugc/.../",    -- a permanent to the graveyard
     counter = "https://steamusercontent-a.akamaihd.net/ugc/.../",  -- a counter put on a permanent
     damage = "https://steamusercontent-a.akamaihd.net/ugc/.../",   -- damage to a creature or a player
     knockout = "https://steamusercontent-a.akamaihd.net/ugc/.../", -- a player loses or concedes
   }
   ```

   Leave an event as `nil` (or leave it out) to keep it silent.
4. The lead deploys the table as usual. Then, as the host, type `mtg sounds test death` (or any other kind: knockout,
   wipe, exile, damage, lifegain, instant, counter) to hear it.

- `mtg sounds off` / `on` (host) mutes or unmutes the table. Nothing plays while the players' own music is playing.
- Pictures work the same way: the line `engineFxArt = engineFxArt or { burst = nil, smoke = nil, ring = nil }`
  takes the three PNG links. Only once all three are set does the table use pictures instead of "●".

- **Picking sounds (the user):** CC0 / CC-BY only (Kenney, Freesound filtered, OpenGameArt; no Arena audio, no
  subscription libraries; plan step 5). The player's own notes: death = a whooshing smoke poof (same for dies,
  sacrificed, destroyed), damage = one "hit" for combat and spells, knockout = an explosion.

## 7. Switches

| Switch | Who | What it stops |
|---|---|---|
| `mtg effects off` / Settings "My effects" | each player | their banners and pop-up (as today) **and** the step 4 slots on their screen (`visibility`; only with FX.SHOW = false) |
| `mtg animations off` / Settings "Table animations" | host | everything in step 4 for everyone (slots and life counter glows), plus today's lunges, mill turns and graveyard flash |
| `mtg sounds off` | host (table), others (told it's shared) | step 4 sounds |

- Text updates: the `effects` reply in `engineChat` and the Settings tooltip say "(banners, turn banner, stack pop-up
  and table effects)".
- Turning a player's effects on or off between effects needs no redraw: `viewers` is read when a slot is shown.

## 8. Where the code goes

- `tools/engine-renderer.lua`:
  - everything inside the existing M5 `do` block (`FX`, ~1169–1304): `engineFxBuild`, `engineFxBoard`, the slot
    helpers, `engineSoundPlay`. **No new main-chunk `local`** (194 of 200 used). New state goes in `FX`; new
    functions are globals or locals inside the block.
  - `engineSounds`, `engineSoundsMuted` and `engineFxArt` are globals next to `engineSoundOff` (~2966).
  - `enginePlayerSpot = playerSpot` and the `engineLungeHits` lines inside the lines `do` block (~993–1126).
  - `engineEffectsReset` also clears `FX.slotUntil` and turns any active slot off (one `setAttribute` per active slot).
- `tools/make-engine-copy.js`: the `effects` and `sounds` branches of `engineChat`.
- `bridge/bridge.js`: section 5.
- `HOW-TO-PLAY.md`: one line about table effects under the effects / sounds commands.
- `docs/our-code-reference.md`: a paragraph after the M5 effects one.
- Test hooks:
  - `engineFxLast` gains `fx = { {kind=, seat=, at=, x=, z=, n=}, ... }` (the effects started on the last new board)
    and `dropped`;
  - `engineSoundLog`, the kinds asked to play, in order, with the route.

## 9. Tests

### Fake TTS (`tests/lua/tts-sim.lua`, `tests/golden/table-run.js`, gate `node tests/test_table_golden.js`)

Add to the fake TTS first:
- `obj.UI.show/hide` (record `objUI.show` / `objUI.hide`);
- `obj.UI.setCustomAssets` (record the count);
- a `MusicPlayer` stub (`setCurrentAudioclip`, `play`, `loaded = true`, `player_status`, `getCurrentAudioclip`,
  recorded);
- `obj.AssetBundle` on objects with `AssetBundle` data (`getTriggerEffects`, `playTriggerEffect`, recorded).

Leave `highlightOn`'s record as it is, so the old goldens stay the same.

New table-run steps, each checked through `engineFxLast` / `engineSoundLog` and the recorded UI calls:

1. **Build once:** the first board of a game makes one `objUI.setXml` on White's counter; a second game (and a redraw
   of the same board) makes none.
2. **Death:** a creature from Blue's battlefield to Blue's graveyard. One `death` effect at the card's old spot
   (`x`, `z` = the last board's planned spot); the graveyard flash as before; slot off after 0.9 s
   (`__sim.frames(60)`).
3. **Board wipe:** 5 of Blue's creatures die in one board. One effect, `n = 5`, "×5" in the slot text; one `death`
   sound.
4. **Counter:** a +1/+1 counter on a creature that was already there: one `counter` ring. A creature entering with
   counters: none. Counters on 7 creatures at once: 4 rings.
5. **Damage:** `dmg` 0 → 3 on a creature: one burst with "−3". Life 40 → 33: one player burst plus
   `highlightOn` on that counter. A combat board with two attackers into Red: the burst starts at the first lunge
   hit (the slot's `active` comes 0.15 s after the board, not at once). `dmg` 3 → 0 at cleanup: nothing.
6. **Knock-out:** status `playing` → `lost`, and in another run `playing` → `conceded`. Counter glow at once, the
   `eng_fx_ko` slot at 0.6 s, DEFEAT / IS OUT banners for both (the concession case is new), one `knockout` sound.
7. **Nothing changed:** the same board rendered twice. The second render makes no `objUI.*` call and no
   `highlightOn`.
8. **Jump:** a board with `jump = true` where Blue lost two creatures and a token. No effect, no graveyard flash, no
   sound. A board whose turn number went down: the same.
9. **Caps:** 10 events in one board give 6 effects in the priority order, `dropped = 4`. A second burst while all 6
   slots are busy: dropped, no slot reused early.
10. **Switches:** `engineChat("mtg effects off", Player.Blue)`: the next slot's `visibility` leaves out Blue.
    `mtg animations off` (host): no slot call and no `highlightOn` from step 4. `mtg sounds off` (host): no sound;
    from Blue: no change, a reply.
11. **Sounds:** with `engineSounds.death = "https://example.invalid/poof.ogg"`, a death records
    `MusicPlayer.setCurrentAudioclip` and `play`. With `player_status = "Play"` and a title "Song": nothing. With a
    name and a sound object stub: `playTriggerEffect` with the matching index. With nil: nothing.
12. **Mutation pass:** `tools/mutate-table.js` over the new functions (as for the rest of the table).

Old goldens change wherever a board has a death, damage, counter or knock-out. Re-capture with
`tools/capture_table_golden.js` and read the diff: only new `objUI.*`, `highlightOn` on life counters and
`MusicPlayer` lines may appear.

### Real table (the user's TTS; a push is the lead's call, the user's save rules apply)

1. **Builds:** start a debug game (`mtg debug ...`). White's counter has no visible change and its buttons still
   work.
2. **Calibration:** with `engineFxTest("ring", <a card id>)` (a test-only global that shows one slot on a card), the
   ring sits on the card, the right size, the "×N" text upright for that seat. Fix `FX.AX/AY/UNIT/ROT0/LIFT/CARD` from
   screenshots (`tools/tts-shot.ps1`). Check all four seats.
3. **`active` vs `show`:** does `active = "true"` play the Grow / FadeOut tween? If not, decide with the user: keep
   `active` (per-player off works, no tween) or set `FX.SHOW = true` (tweens, the host's switch only).
4. **No-picture fallback:** with `engineFxArt` empty, the "●" draws in colour. Then with the three links set, the
   pictures show and no first-use hitch is visible (assets load at build).
5. **Sound route A:** time from the death smoke to the sound on the host. Over about 0.3 s means route B is needed.
   Check that the players' own music isn't cut.
6. **Second player** (needs a friend or a second TTS, as step 3): slots and highlights show for them; with their
   `mtg effects off` the slots don't; route A sound plays for them.
7. **Performance:** `tools/bigboard-test.sh QUIET=1`, a 4-player AI game with effects on vs `mtg animations off`. No
   new frames over 100 ms, `engineProfile.sect.fx` under 5 ms per board, no growth in loaded objects (Player.log
   "Loaded Objects"). Watch the GPU-reset log (`nvlddmkm` 153): no new pattern with effects on.
8. **Screenshots** of each effect before showing the user.

## 10. Limits

- Pictures, not particles: flat, tinted sprites with at most 3 steps per effect (or none if `active` doesn't
  tween). No vortex, no shards, no debris flying. A real particle bundle is still the step 4 bundle plan, later.
- Pictures need hosting (three PNGs). Until then the "●" fallback is crude.
- Life paid or lost reads as damage; a token bounced to a hand reads as a death; damage to planeswalkers and
  battles isn't covered (their loyalty or defence going down can't be told from paying a loyalty cost without an
  engine event).
- A creature killed by damage shows only the smoke, not the hit first.
- `mtg effects off` can't hide the life-counter glows (TTS highlights are for everyone).
- Sounds are shared by everyone (route A, and maybe route B); no volume from Lua; route A's delay is unmeasured.
- The step 3 two-client test was never run: everything other players see is inferred from the TTS docs and the
  table's own playtests, and must be checked (real-table check 6).
