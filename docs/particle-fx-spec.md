# Particle effects: death, coloured board wipe, exile, damage bolt (spec)

Status: **spec only, written 2026-11-12. Nothing is built; the user said to wait on building.**
Sources:
- `docs/fx-research/mtga-video-notes.md`: frame-by-frame notes from three MTGA videos (red ping, white exile/destroy, black wipes), with measured colours.
- `docs/fx-research/tech-inventory.md`: what our Unity bundle, the table and the bridge can do today.
- Also `docs/m5-effects-design.md` and `docs/m5-assetbundle-build.md`.

The effects are our own. MTGA is the reference for **feel**: timing, readability and "the card does not fly to the graveyard". It is not a template to copy. We copy no assets, shapes or exact sequences.

## 1. What the user gets

| Effect | When it plays | What it looks like (target ~1 s or less) |
|---|---|---|
| **Death** | A permanent goes from the battlefield to a graveyard (tokens too) | The card flashes, darkens and breaks apart **in place**: smoke and shards. Two flavours: *destroyed* (pale crackle, grey, square-chip shatter) and *died from damage* (charred burn-away), when the cause is known |
| **Board wipe** | 3+ permanents leave in one board update from one cause (destroy, sacrifice, −X/−X, damage) | **One board-wide element first**: a wave sweeping the table from the spell, in the **colour of the spell that caused it**. Then every card plays its own small death, staggered 0.1–0.2 s. One big thing plus cheap small things |
| **Exile** | A permanent is exiled from the battlefield | No projectile. The card greys, a dark swirl fills it with a thin bright ring, and it collapses to a point of light. Optionally the light flies to the source card (Banishing Light style). A mass exile (Farewell) uses the wipe wave in the exile style |
| **Damage bolt** | A spell or ability deals damage to a creature, planeswalker or player (not combat: the attack lunge already shows that) | A small bolt flies from the source (the spell on the stack, or the ability's card) to the target in ~0.2–0.3 s. A bright impact plays on arrival, and the damage, hit or death effect lands **at impact**, not before |

### Colours (board wipe, and optionally bolt and exile)

| Key | Spell colour | Wave palette (starting point; tune on the table) |
|---|---|---|
| W | white | white-gold light `#FFF6D8` / `#F2D27A` |
| U | blue | cyan to deep blue `#8FD6FF` / `#2E6FD8` |
| B | black | violet to plum, dark smoke `#AC71FD` / `#70378F` / `#1A0F24` |
| R | red | orange-red embers `#FF7A3A` / `#F8524F` |
| G | green | leaf green and gold motes `#8EE36A` / `#3E9B3A` |
| C | colourless | silver-grey `#D0D4DC` |
| M | two or more colours | gold `#E8C25A` (option: two waves, one per colour, when the pool allows) |

The bolt defaults to red-orange (red is the common pinger). Per-colour bolts come free if tinting works (§4, question 2).

## 2. What exists already (no new art needed for three of the four)

The shipped bundle `mtg-fx.unity3d` (118 KB, built from code by `Assets/Editor/MtgFxBuild.cs` in `C:\Users\you\mtg-unity\Tabletop-Simulator-Modding`, Unity 6000.0.62f1) holds these one-shot effects:

| Effect | What it is |
|---|---|
| `death` | white flash, purple smoke, shards |
| `death_wipe` | bigger, purple only, no colours |
| `exile` | gold/blue spiral, rising motes |
| others | `damage`, `player_hit`, `countered`, `counter`, `counter_minus`, `lifegain`, `knockout` |

- The table keeps **6 "rigs"** (copies of the bundle object) parked under the table. They are spawned once and never destroyed. For an effect, a free rig moves to the spot, plays the effect 0.1 s later, and goes back under the table.
- **None of it has been seen on the real table yet**, and the two-player test (does a host-fired effect show for the other players?) has never been run. Everything below depends on that test (§4, step 0).
- Nothing in the bundle moves. A bolt is the only effect that needs new Unity work.

## 3. What the table needs to know (bridge data)

| Need | Today | Change |
|---|---|---|
| Died vs exiled vs bounced, per card | mostly (graveyard / `exd`); a bounced token reads as a death | `lv`: every battlefield departure with where it went (`g e h l c x`), how (destroyed / sacrificed), the cause card, and Forge's order `q`. Replaces `exd` |
| The colour of the spell behind a wipe | **no colour reaches the table** | `cl` (colour letters) on each card's static data and on stack items, from the engine's `CardDto.color`. Wipe colour = the `cl` of the commonest cause among that board's departures. A state-based death with no cause (damage or −X/−X wipes) is blamed on the last spell or ability that resolved |
| Who damaged whom, and how much | combat only. For spells it is a guess, which misses untargeted pings, divided damage, and spells cast and resolved between two boards | `hits`: `[{src, to, n, q}]`. **Phase A:** from the bridge's existing `damageNews` (bridge only). **Phase B:** from Forge's own damage events (`GameEventCardDamaged`, `GameEventPlayerDamaged`), which the harness doesn't listen to yet. That needs a protocol field and an engine image rebuild, and is exact for every source |
| Order inside one board update | combat only | `q` on `lv` and `hits`, so the table can play bolt → impact → death in Forge's order |

All new fields stay outside the board signature and are cleared once sent, like `exd`. Gates: `test_bridge_golden`, `test_bridge_events`, `test_state_delta`.

## 4. How it is built

### Step 0: check what is shipped (first, ~0.5 day; nothing else starts before it)

1. On the real table, play `death`, `death_wipe` and `exile` on a card with `engineFxTest`. Check the spot, size and colours, and screenshot them (`tools/tts-shot.ps1`).
2. Two-player test (build doc §8, checks 1, 2, 4 and 7). Does a host-fired effect show for the other player, at the right spot?
   - **If it doesn't, the plan changes.** Rig effects would be host-only, and only object UI, highlights and sounds are shared.
3. Measure "Loaded Objects" in Player.log before and after the 6 rigs, to size the pool.
4. Five quick probes:
   1. Does `setColorTint` on the bundle object tint its particles? If yes, one neutral effect serves every colour, for bolts and exile too.
   2. Does a legacy `Animation` inside a trigger effect play in TTS?
   3. Can one rig play two effects back to back?
   4. Do particle sizes stay the same when the rig is scaled? This one can be checked in the Unity editor.
   5. Measure each rig's object cost.

### Death (~0.5 day)

- Keep `death`. Add the "died from damage" burn-away variant only once `hits` says the death came from damage.
- When a bolt targets the card on the same board, the death waits for the bolt's impact. The impact time is written into the same table the attack lunge already fills, so no new plumbing is needed.

### Board wipe, coloured (~1.5–2 days)

- **If tint works:** one neutral `wipe` effect, tinted per colour.
- **Otherwise:** bake 7 variants `death_wipe_W/U/B/R/G/C/M` in a loop in `MtgFxBuild.cs`. That is about 20 lines of C#, shared materials, and a few KB.
- Lua picks `death_wipe_<key>`, falling back to `death_wipe`, then `death`.
- The board-wide wave is one rig at the spell's side of the table. The per-card deaths reuse the small `death`, staggered.
- **Cap:** up to 8 per-card deaths are drawn. Past that, only the wave plays plus the sounds' bursts, which already exist (`wipe_x3..x8`).

### Exile (~0.25–0.5 day)

- Keep `exile`. Re-style it toward the swirl-and-collapse look if step 0 shows it reads poorly.
- Optional: `exile_wipe` for 4+ at once.
- Optional: tint it by the source's colour, free if tint works.

### Damage bolt (~3–4 days, plus ~1–1.5 for Phase B data)

- **Unity:** a new `bolt` effect.
  - Its head is a baked animation from local z 0 to 1 over ~0.25 s, with a slight arc and a world-space trail.
  - An impact burst plays at the end.
  - Particle sizes stay fixed while the path scales.
- **Lua, once per bolt with no per-frame code:**
  1. Put a rig at the source: the spell's spot on the stack, or the ability's card.
  2. Turn it to face the target and scale it to the distance.
  3. Play `bolt` 0.1 s later.
  4. Schedule the target's damage, hit or death effect at impact.
- **Fallback** if the baked animation doesn't play in TTS: Lua moves the rig while a trail plays. That is steppier for other players, so it's the fallback only.
- **Pool:** raise the rigs from 6 to ~10–12 (top up the missing ones once).
- **Cap:** 4 bolts a board. Extra hits get only the impact burst, as today.

## 5. Performance

- **No spawning or deleting during play.** Effects reuse the parked rigs. Creating or deleting objects mid-game is what causes the hitches (a delete costs ~360 ms).
- **Object count:**
  - Estimate: about 100–200 Unity objects per rig, so 12 rigs ≈ 2,400. This PC's crashes have come near 78,000, so that is roughly 3% of the headroom.
  - This is an estimate until step 0 measures it. If it is higher, use fewer rigs or a separate small bolt bundle.
- **Graphics:** short bursts (≤1.5 s) of a few dozen particles each, with built-in unlit materials only and no real-time lights. The board-wide wave is the one heavier element, one per wipe. Measured with PresentMon on the table before shipping, given this PC's GPU resets.
- **Host Lua:** a few calls per effect, inside the existing 5 ms per-board budget. There are no per-frame movers, except the bolt fallback.
- **Caps** (above): 8 per-card deaths and 4 bolts per board.
- **Off switch:** `mtg fx off` / `mtg fx on`, host only, saved with the game. With it off the table behaves exactly as today: sounds and UI flashes stay.

## 6. Order and effort

| Phase | Work | Estimate |
|---|---|---|
| 0 | Live check of the shipped effects, two-player test, object count, probes | 0.5 day |
| 1 | Bridge `cl` + `lv`; coloured wipe; death and exile tweaks; `mtg fx off` | 2–2.5 days |
| 2 | Bridge `hits` (Phase A); Unity bolt; Lua aim, scale and sequencing; pool top-up | 3–4 days |
| 3 (optional) | Harness damage events (Phase B), with an engine image rebuild | 1–1.5 days |

**Total about 6–8.5 days.** Without the bolt (death, exile, coloured wipe): about 2.5–3 days.

Each phase gets its builder plus a read-only verifier, tests that go red when the effect is broken, and a live check on the real table before it counts as done.

## 7. Open decisions for the user

1. Multicolour wipes: one gold wave, or one wave per colour?
2. Exile: should the light fly to the source card (Banishing Light, Oblivion Ring), or just vanish?
3. Bolt colour: always red-orange, or the source's colour?
4. Is the default for `mtg fx` on or off?
