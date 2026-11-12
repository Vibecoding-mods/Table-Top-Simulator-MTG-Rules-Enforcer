# M5 plan: Arena feel on the TTS table

Status: plan, 2026-10-21. **Steps 1 and 2 are done** (step 2 on 2026-10-22, see the table below). **Step 1:**
- target, attack and block lines;
- Arena glow colours;
- blue-white banner for other players' turns, with fades;
- the stack pop-up stays while its spell is on the stack.

Sources:
- `reports/MTG Arena effects from gameplay video.md`: 14 gameplay videos, frame by frame.
- `reports/MTG Arena style effects for TTS.md`: what TTS can do, legal assets, cost.

## Ground rules (from the research and our measurements)

- **Short:**
  - Arena's machine-driven moments last 0.3–1.5 s, so nothing of ours lasts longer.
  - Effects never block play: the engine never waits for an effect.
- **No camera shake** (none in any Arena frame) and no screen-filling flashes, except at game end.
- **Arena's colour code:**
  - green = you can act on it;
  - orange-gold = chosen / paying;
  - red = attacking or damage;
  - blue = blocking or boosted;
  - gold lines = blocks;
  - green numbers = life gained;
  - purple-black smoke = death.
- **Never `destruct()` mid-game:** each one pauses TTS ~360 ms. Effects are a pool of objects made once and reused (moved, triggered, parked).
- **Everything public:** effects show for every player, private ones (your hand glow) only for you.
- **Settings:**
  - "Effects: full / reduced / off" per player for screen UI;
  - the host's choice for particles and sounds, since TTS shows those to everyone.
- **Cost budget:** effect work stays under 5 ms per board update on the host; checked with PresentMon and `engineProfile.sect`.

## Step 2: numbers and badges ✅ (done 2026-10-22)

Built as planned except: the life change shows for 3 s (the counter's own change line, which TTS keeps for 3 s), creature damage shows as the red toughness on the P/T badge instead of a separate floating number, and the tapped look is unchanged.

| Event | What players see | How |
|---|---|---|
| Damage to a player | a red number that pops over their life counter and fades (0.6 s); life jumps to the new value | Object UI text on the life tracker; summed per player per damage step, so a combat with 5 attackers shows one "-14" |
| Life gain | a green "+N" that drifts up (0.6 s) | the same, green |
| Damage to a creature | a small red number near its P/T badge (0.5 s) | the card's button label, briefly |
| +1/+1 and other counters | a small dark-blue circle with the number at the card's top right; raised P/T in blue | extends the existing badge (`badgeText`) |
| Identical tokens | one card with "×N" (Arena stacks them) | `groupTokens` already groups; add the ×N badge |
| Tapped look | keep the 90° turn (players expect it on a tabletop) | — |

Data: the bridge already sends life, damage and counters each update; step 2 compares with the last update, so no
engine change is needed.

## Step 2b: effects with the table's own UI ✅ (2026-10-22)

What steps 4 and 6 planned that needs no AssetBundle: knock-out and VICTORY / DEFEAT banners (screen UI, per player, `mtg effects off` turns them off), a violet flash on the graveyard pile when creatures die ("xN" for a board wipe: grouped per board update), "COUNTERED" on the stack pop-up. The particle versions (smoke, shatter, impact) still wait for step 3.

## Step 3: does it show for everyone? (a test, half a day, needs a second person or a second TTS)

Before any art:
- **2-client sync test:** do AssetBundle trigger effects, `highlightOn`, Object UI text and bundle sounds fired by the host's Global Lua show on another player's screen?
- **Late join:** what does a player who joins mid-effect see?
- **Unity version:** build one test bundle with Unity 6000.0.62f1 (what the TTS modding kit says) and check it loads in the installed TTS (6000.3).
- **Sound:** does hiding a rig from one player also mute its sound for them?

The answers decide whether particles and sounds go ahead as one shared bundle or stay as UI-only effects.

## Step 4: effects (design 2026-11-05, not built)

Full design: `docs/m5-effects-design.md`. It needs no AssetBundle, no Unity and no new objects, and doesn't wait for
step 3. The bundle below stays the later, nicer version.

| Event | What players see | Length |
|---|---|---|
| A permanent to the graveyard | white flash, then purple-black smoke where the card was; a board wipe: one bigger cloud with "×N" | 0.9 s |
| A counter put on a permanent | a pale blue ring around the card (violet-grey for -1/-1) | 0.5 s |
| Damage to a creature | an orange-white burst with "−N", when the attacker's swing hits | 0.35 s |
| Damage to a player | an orange burst at the back of their board, their life counter flashes red | 0.45 s |
| A player knocked out (loses **or concedes**) | red glow on their life counter, a white-hot burst, orange-red smoke | 1.5 s |

How:
- **Pictures, not particles:** seven pre-built panels of Object UI (XML UI that belongs to one object) on White's life
  counter. They are moved where needed and switched on and off. One UI build per game, nothing spawned or destroyed.
- **Pictures:** three CC0 pictures (smoke, burst, ring). The user uploads them once; until then a coloured "●" stands
  in.
- **Data:** read from the board the bridge already sends (`battlefield`/`graveyard` ids, `dmg`, `ctr`, `life`,
  `status`). One new bridge field, `jump`, keeps rewinds and resends from playing effects.
- **Cheap:**
  - at most 6 effects at once and 6 per board, the rest dropped;
  - nothing runs on a board that didn't change;
  - one sound per board.
- **Switches:** `mtg effects off` hides them for you, `mtg animations off` (host) stops them for everyone.
- **Sounds:** `engineSounds = { death, counter, damage, knockout }`, empty until the user picks.
  - A link plays through the table's music player: works today, shared by everyone, no volume from Lua, delay
    unmeasured.
  - A name plays a sound bundle's trigger effect, later.
  - `mtg sounds off` (host) mutes the table; `mtg sounds test <kind>` tries a sound.
- **Found while designing:** a concession sends status `"conceded"`, which today's knock-out banners don't look for.
  Step 4 covers it.
- **Limits:**
  - flat pictures, at most 3 steps each;
  - life paid reads as damage;
  - planeswalker damage isn't covered;
  - the life counter glow can't be hidden per player;
  - nothing yet checked with a second player.

## Step 4 (earlier plan): the effect bundle (about 3–5 days, after step 3)

**Lua side built 2026-11-11** (the bundle itself waits for Unity 6000.0.62f1): rigs are `engine:fx` objects found at a
game's first board, moved and triggered by name, falling back to the Object UI slots; route B sounds by name from the
`engine:sounds` object. What the Unity build must contain, the command-line build and the two-client test:
`docs/m5-assetbundle-build.md`. With the bundle links in `engineFxBundle` and none on the table, a game's first board
spawns the 6 rigs and the sound object once; they stay in the save after that (never destroyed: `destruct` costs
~360 ms here). No link: nothing changes.

One small AssetBundle, under ~5 MB, made from CC0 textures (Kenney particle pack) with Unity's standard particle system (Shuriken). No Asset Store packs, since they can't be redistributed in a public mod. At load, a pool of rigs is spawned under the table, then moved and triggered when needed:

| Rig | Used for | Look (from the Arena frames) | Length |
|---|---|---|---|
| Smoke + shatter | a card goes to the graveyard (dies, sacrificed, destroyed: all the same, with the poof sound) | white flash, purple-black smoke ~1.5× the card, square shards | ~1 s |
| Smoke burst | a spell is countered | large white-grey smoke over the stack spot | ~1.5 s |
| Impact | damage to a player or creature | white-orange starburst | ~0.4 s |
| Knocked out | a player loses | red glow building at their life counter, a flash, debris; their playmat dims | ~1.5 s |
| Mana beams (later) | paying a spell | a beam per land in the land's colour (white gold, blue cyan, black violet, green lime, red orange) to the stack | ~0.5 s |

Plus banners:
- "VICTORY" in gold / "DEFEAT" in purple, a full-width UI banner 2.5 s after the knock-out;
- the existing turn banner.

### From the player's reference video (2026-10-22, [CGB, Dimir midrange](https://youtu.be/hEe0HKRHncg), frame by frame)

- **Death (8:24.3–8:25.1, Kaito dies):** the card dims, a bright white flash bursts from its centre, dark purple smoke
  swirls into a vortex with a white crescent in it, then drifts off as the card is gone. About 0.8 s. Sound: a
  whooshing smoke poof (the player: every move to a graveyard sounds the same: dies, sacrificed, destroyed).
- **Exile (the player's request):** the same spiral, in exile's colours (white-gold or pale blue instead of purple-black).
- **Bounce (8:22.3–8:22.7):** no effect: the card lifts and flies to its owner's hand.
- **Cast (8:29.5):** a blue electric beam from the caster's side into the stack spot, with sparks. Sound: electric
  (the player).
- **Counterspell (8:35–8:41):** the counter spell goes on the stack with a cyan arc to the spell it targets; the stack
  fans out on the right; when it resolves the countered spell washes out white and is gone. No big burst.
- **Damage (8:21.5):** an orange beam across the board to the target.
- **Spell leaving the stack (8:24.7):** a blue-white swirl at the stack spot.
- **Attack (the player's request):** the attacking card lunges into what it attacks (a creature, a planeswalker or the
  player's life) and back. Plain object movement: no AssetBundle needed, can come before step 4.
- **A player dies or concedes:** an explosion sound (the player).
- **Damage to a player from a spell (17:40):** the same hit sound as an attack hitting the player (the player): one
  "hit" sound for both.

## Step 5: sounds (about 1–2 days, after step 3)

- **Already covered by TTS itself (2026-10-22, from the player):** draw, play, tap/untap, shuffle, phase change, pass
  turn, game start. Not remade.
- **What Arena does (from the player, 2026-10-22):** no per-creature sounds. An attack is one bang; every move to a
  graveyard (dies, sacrificed, destroyed) is the same whooshing smoke poof.
- **Events to add:** attack (a bang), to the graveyard (the smoke poof, once per group: a board wipe plays it once),
  casting a spell (electric), a player dies or concedes (an explosion). Still to check against Arena: countered spell,
  damage to a player, life gain, game won / lost.
- **Sources:**
  - CC0: Kenney Impact pack (the bang), a CC0 whoosh/poof from Freesound or Kenney (the graveyard), Kenney's jingles if
    the win/lose sounds are wanted;
  - CC-BY from Freesound, listed in CREDITS.md;
  - no Arena audio, no subscription libraries (Epidemic Sound, Soundstripe: their licences don't cover a mod whose
    files every player downloads, checked 2026-10-22).
- **Level:** quiet and short (-16 to -18 LUFS; UI clicks 6–10 dB quieter). Inside the same bundle, as trigger effects.

## Step 6: polish

- Effect level setting (full / reduced / off).
- Group same-type effects within ~300 ms: a board wipe shows one smoke cloud with "×12", not 12.
- Bigger treatment for commander damage and your own commander's arrival.

## Tests for every step

- **Golden master (fake TTS):** each effect is recorded as the calls it makes (UI text, trigger calls, pooled object moves). The fake TTS gets `AssetBundle.playTriggerEffect` recorded like the other calls.
- **Mutation pass on the effect code**, as for the rest of the table.
- **Performance:** a 4-player AI game (`tools/bigboard-test.sh QUIET=1`) with effects on vs off. No new frames over 100 ms, and `engineRender` time within budget.
- **Screenshots of each effect in the real TTS**, before showing you.

## Order and rough time

| Step | Needs | Time |
|---|---|---|
| 2 numbers and badges | nothing | 1–2 days |
| 3 sync test | a second TTS client (you + a friend, or a second PC) | ½ day |
| 4 particles | step 3 OK; Unity 6000.0.62f1 installed (download) | 3–5 days |
| 5 sounds | step 3 OK | 1–2 days |
| 6 polish | 4 and 5 | 1–2 days |

## Player requests, 2026-10-29 (from the hand-test gap fill)

| Request | Status | Notes |
|---|---|---|
| Skip priority until a chosen phase | **built** 2026-10-29 | `mtg skip <upkeep\|draw\|main\|combat\|blockers\|damage\|main2\|end\|mine\|off>`: the bridge passes priority (`seat.skipTo`, `SKIP_PHASES`, `skipReached`) until that phase, the next time it comes on anyone's turn ("mine": your own next turn), and then stops there whatever the step stops say. An opponent's spell or ability on the stack ends it. A phase Forge gives no priority in (a combat with no attackers) stops at the next one after it. Other questions (targets, blocks, discards) are still asked. Chat only for now; a button can follow. |
| Turn timers (as in MTG Arena) | **built** 2026-10-30 | `mtg timer [seconds]` / `mtg timer off` (host): 60 seconds a decision by default (10-600), then a 120-second time bank that refills 15 each of your turns; a warning at 15 seconds left; at zero the question takes its safest answer (pass, keep, no attackers or blockers, No, cancel a payment, else the first legal picks). Paused during a manual fix or rewind vote. No auto-concede: the host decides. Original notes: the host toggles them on and off for everyone. Arena's model to start from: a timer per decision, a "rope" shown near its end, a time bank that refills a little each turn; running out passes priority (or takes the default answer), and repeated timeouts concede. To decide: the lengths, what a timeout does for a question that isn't priority (targets, blocks), and whether the AI is timed. Lives in the bridge (it owns the prompts and their answers) with a timer bar on the table. |
| Hold priority | **built** 2026-10-30 | `mtg hold` or the Hold button: priority kept once this turn after something goes on the stack, when you can respond. Original notes: Your own spell in your main phase passes priority by itself (as Arena), so you can't respond to your own spell (Flusterstorm on your own Bolt, Aven Interrupter on your own Ponder). Arena's hold-priority key keeps priority after you cast. A button or `mtg hold` that keeps the next stop. |
| Test-kit loader: partner and Background pairs | **fixed** 2026-10-29 | `engineLoadTestKit` lays each commander card side by side (1.4 apart) on the command spot; two on one spot merged into a pile the table didn't read as commanders. Table check "kit loader: two commanders, two cards side by side". |

### Keywords skipped in the hand tests (for now)
These can't be played with the hand-test setup and are left until the pieces they need exist:
- **Companion** (hp-20): Forge takes a companion only from the sideboard at game start, and the bridge always sends
  `sideboard: []`; the deck must also meet the companion's condition (Lurrus fails with Kenrith, mana value 5). Needs the
  bridge to send a sideboard, and a deck built for it.
- **Attractions** (hp-23): there is no Attraction deck in this setup; Line Cutter only rolls the d6.
- **Doctor's companion** (hp-11): a commander pairing with a Doctor; the hand-test decks' commander is Kenrith.

## Table UI size (2026-10-30)
The screen UI must stay under 60 KB: at about 64 KB the second player's buttons stopped working, and the code's note calls a size limit the likely cause, which isn't confirmed. Each seat adds its own panels. Measured with four seats at 59,988 bytes: element ids 12.6 KB, shared styles 10 KB, style references 9.1 KB, click handlers 7.1 KB. The table's dead Scryfall panels (3.8 KB) are now left out of the engine UI. Next room if needed: fewer answer buttons per page (POOL, 30, about 62 bytes each per seat), or building settings panels on demand.
