# MTGA effect reference notes (red ping, white exile, black board wipe, creature death)

Research for the TTS particle-effects spec, made 2026-11-12. These are my own frame-by-frame descriptions. Nothing is copied from the videos except the timestamps.

## How the frames were taken

- I used YouTube in the built-in browser pane at 1080p, muted and paused. Each frame was seeked with `video.currentTime` and drawn into a canvas overlay as a contact sheet, at 0.05–0.15 s steps through each effect.
- Colours were measured, not guessed. I diffed each effect frame against a frame taken before the effect, then took the dominant colours of the pixels that changed (hex values below).
- **No sound cues were observed.** I have no audio access in this setup, so every sound note below is marked as an inference. Someone needs to listen to the clips at the listed timestamps to fill in the sound column.
- Size unit: **1 card = one battlefield card** in MTGA's default zoom, about 1 card width by 1.4 card widths tall.
- Reference contact sheets (my screenshots of the frames) are in `docs/fx-research/img/`. They are listed per section.

## Videos and timestamps used

| Effect | Video | URL | Timestamps |
|---|---|---|---|
| Red ping (Burst Lightning, 2 dmg, kills a 1/2) | "It's Time to Use Lightning Bolt in Standard \| Standard BO1 MTGA Gameplay" (gameplay, 1080p) | https://www.youtube.com/watch?v=0qV34x6tFOY | 6:40.8–6:43.9 (400.8–403.9 s); trigger streak 6:49.4–6:50.2 |
| White destroy (Fateful Absence) | "[ MTGA ] 運命的不在 / Fateful Absence エフェクト" (MTG Arena Effect Channel, 10 s clip) | https://www.youtube.com/watch?v=iaPNk9bAO0o | 0:03.6–0:08.5 |
| White **exile** (Skyclave Apparition ETB exile) | "Mono White Devotion - What If Ossification Can Exile 2 Things? \| Explorer BO3 Ranked" (Takobyte) | https://www.youtube.com/watch?v=m5xChaw_aJ8 | 3:03.6–3:05.4 (183.6–185.4 s) |
| W/U board wipe, for contrast (Supreme Verdict) | same Takobyte video | https://www.youtube.com/watch?v=m5xChaw_aJ8 | 5:00.4–5:01.5 (300.4–301.5 s) |
| Black board wipe, -X/-X deaths (The Meathook Massacre) | "[ MTGA ] 食肉鉤虐殺事件 / The Meathook Massacre" (MTG Arena Effect Channel) | https://www.youtube.com/watch?v=Legu5LmChSc | 0:14.2–0:16.0 |
| Black board wipe, exile (Extinction Event) | "MTGA: Extinction Event Cast Animation" (TrainGame99) | https://www.youtube.com/watch?v=JVXd29ey5Jw | 0:05.3–0:08.0 (a second cast at 0:15–0:18) |

Caveats:
- **Fateful Absence destroys; it does not exile** (the same is true of Get Lost). I kept it because it is the cleanest white "destroy" clip. The real white **exile** reference is Skyclave Apparition, and the two look very different.
- **Meathook and Extinction Event are not plain wipes.** Meathook is a legendary card and Extinction Event is a rare. Either may have bespoke art. A plain Damnation clip was not found. Read them as "how MTGA dresses a black mass removal", not as the generic default.
- **No ping to a player's face was captured.** Both red events in the gameplay video hit a creature or the stack.

---

## 1. Red ping: Burst Lightning on a 1/2 creature

Contact sheets: `img/red-ping-1-target-and-travel.jpg`, `img/red-ping-2-fireball-impact-closeup.jpg`, `img/red-ping-2b-impact-to-gone.jpg`, `img/red-ping-3-damage-death-dissolve.jpg`, `img/red-trigger-streak-to-stack.jpg`

### Timeline (t = 0 at impact, 6:42.65)

| t (s) | What happens |
|---|---|
| -1.85 | **Targeting.** A cyan arc (#2EC8FF-ish, glowing, about 0.15 card thick) loops from the spell on the stack (right side of the screen, shown large) over to the target creature. A "chosen target" label sits under the target. The arc stays up while the spell waits on the stack. |
| -1.0 to -0.6 | (A Slickshot trigger fires first. See "ability streak" below.) |
| -0.25 | **Launch.** A fireball leaves the stack card on the right and flies **straight** at the target (very slight curve, near-linear, fast). |
| -0.25 to 0 | **Travel**, about 0.2 s for roughly half a screen width. Ease-in: it is visibly faster near the target. Head: about 0.25 card wide, yellow-white core. Body and tail: coral-red to orange, tail about 0.6 card long, a few loose embers shedding behind. |
| 0.00 | **Impact flash.** A white-hot 4-point star with long thin spikes (lens-flare cross, spikes about 1.5 card wide). It covers the whole card for 1–2 frames. |
| +0.05 | The flash becomes a **bright white sphere** about 1.2 cards across, with a pink-magenta rim and a spray of small red sparks. |
| +0.10 | **Shockwave shell.** A thin white ring/bubble edge at about 1.5 card widths, the inside turning pink. |
| +0.15 | The shell **breaks into grey shards/chips** that fly outward a short way. The pink glow is still in the middle. |
| +0.2 to +0.45 | **Smoke.** A charcoal / indigo-grey smoke cloud about 1.3 cards wide hides the card, with a fading pink ember in its centre. A small **red damage number ("2")** pops up just below and right of the card and holds for about 0.4 s. |
| +0.5 to +0.85 | **Death (damage).** The smoke thins and the card shows again **darkened and charred**. It then **burns away in place**: holes eat through the art with faint glowing edges, it turns semi-transparent, a few dark ash flecks fall, and it is gone at about +0.9 s. It does **not** fly to the graveyard visibly. |
| +1.1 to +1.25 | The **resolved spell card** (on the stack, right) shrinks and slides to its owner's graveyard pile (lower-left), about 0.15–0.3 s. |

Total from launch to an empty slot: **about 1.15 s**. From cast to the end, with the trigger and arc, it is about 3 s of game time.

### Colours (measured)
- Fireball body: **#F8524F** coral red, **#FA665A**, **#FB7167**. Outer and tail: **#F98D71** salmon-orange. Head: near-white yellow.
- Impact flash: **#FDFAFD** (white). Bloom fringe: **#F5D1F0** pale pink, **#F4AFD0** / **#EF91B0** rose-pink, a few **#F68D91** red sparks.
- Smoke: **#4C4A70** slate-indigo, **#373751**, **#292534**. A faint **#F297D1** pink ember inside, early on.
- Charred card while it burns away: **#342834**, **#482F39** (dark maroon-brown).
- Note: the impact is **pink-white, not orange**. Orange belongs only to the projectile. The explosion skews magenta.

### Motion
- The projectile goes in a straight line from the **stack card to the target**, not from the caster's avatar. It travels about 0.2 s and accelerates.
- No camera shake could be seen at this zoom. There was no global screen flash either: the flash is local and roughly 2 cards across.

### Related: ability / trigger streak (red creature's "whenever you cast" trigger)
- 6:49.4–6:50.2. The **source creature flares** (an orange-gold glow pops on the card, about 0.1 s). A **thin glowing comet line** then whips from the source to the stack card in about 0.3 s. It has a peach head (**#FCD0AD**, **#F1AE91**) and a long thin trail, in a slight arc that rises first. It ends in an orange flash burst on the stack card.
- This is how MTGA shows "source → effect". A pinger ability (Prodigal Sorcerer style) would likely look the same as this streak followed by the impact above.

### Sound (not observed)
- Not heard. I would expect a cast whoosh at launch and the main hit at the impact frame (t=0). Please verify by ear at 6:42.4–6:43.0.

---

## 2. White exile vs white destroy

### 2a. True exile: Skyclave Apparition exiles a creature (3:03.6–3:05.4)

Contact sheets: `img/white-exile-skyclave-1-sequence.jpg`, `img/white-exile-skyclave-2-closeup.jpg`, `img/white-exile-skyclave-3-orb-travel.jpg`

There is **no projectile**: the effect happens on the target, then the card **leaves as a light that travels to the exiling source**.

| t (s, 0 = 3:04.11) | What happens |
|---|---|
| -0.5 | While targeting (cyan arc), the target card is already shown **desaturated / grey**. |
| 0.00 | The card face **goes dark**: the art drops to a dark slate-navy. |
| +0.07 to +0.35 | **Void swirl inside the card frame.** The card face is a dark navy-black field with **pale blue-white wisps spiralling** in it, like a small portal. Soft smoky edges spill a little past the card. The card tilts or turns slightly. |
| +0.42 | A **thin bright ring** (white with a faint pink-lilac tint, about 2 card widths across, a 1–2 px hairline) appears around the card, centred on it. |
| +0.49 | **Collapse.** The card is gone, replaced by a **bright white star**: 4 main spikes plus diagonal ones inside a small ring, about 0.5 card across, with a long **horizontal anamorphic light streak** about 3 cards wide. |
| +0.56 to +1.0 | The star shrinks to a **small white orb with a periwinkle glow** and flies off in a gentle arc to the **source permanent** (the Apparition, on the caster's side), trailing a short sparkle tail. Travel about 0.45 s, roughly constant speed. |
| +1.0 to +1.25 | The orb fades at the source. The trigger card on the stack disappears. |

Measured colours: void **#292831**, **#363747** (slate). Ring **#FAEEF9** (white, pink tint). Star and orb **#A9B2F3** / **#8D93D3** periwinkle, with a white core.

Key difference from death: the card **never breaks, burns or drops**. It goes dark, implodes into a point of light, and the light *goes somewhere*. Exile reads as "taken away", not "destroyed".

### 2b. White destroy: Fateful Absence (0:03.6–0:08.5)

Contact sheets: `img/white-fateful-absence-1-trigger-and-landing.jpg`, `img/white-fateful-absence-2-target-closeup.jpg`, `img/white-fateful-absence-3-spell-to-gy-and-clue.jpg`

| t (s, video time) | What happens |
|---|---|
| 3.6–3.9 | The card flies from hand to the stack (right side, large). A small white-blue **electric glint** crackles along the card as it lands, about 0.15 s. |
| 4.2–5.3 | Cyan targeting arc to the target. |
| 5.34–5.9 | (A different trigger: a cyan-white comet streak from one of the caster's permanents to the stack card, about 0.5 s, ending in a white star flash on the stack card. Measured **#6EFDFF** cyan with a white core.) |
| 5.90 | **Effect appears directly on the target. Nothing travels from the stack.** White-violet **crackling energy, like lightning tendrils**, fills the card frame. |
| 5.98–6.22 | **Spirit column.** Pale blue-white smoke and plasma **rises straight up** off the card about 1.5 card heights, wavering like a ghost leaving, with a bright white core. |
| 6.30 | The column fades. The card is **fully desaturated grey**. |
| 6.38–6.54 | The card darkens to charcoal grey. |
| 6.62 | **Shatter.** The card breaks into a **grid of small square chips** (mosaic, about 10×14 tiles). |
| 6.70 | The chips scatter and fall slightly outward, then fade. |
| 6.78 | Gone. From the effect's start to an empty slot is **about 0.9 s**. |
| 6.9–7.2 | The spell card shrinks and flies from the stack to the caster's graveyard (lower-left), about 0.3 s. |
| 7.5–8.4 | A Clue token appears for the opponent with a **white 4-point sparkle star**, then a short pink-white puff, and settles. |

Measured colours: core **#FBFEFF**, wisps **#B4CAF4** / **#B3CCF9** pale ice-blue, **#7389B2** / **#546692** steel blue, **#8896D2** periwinkle. Dying card **#4B4D54**, **#8A8B96**; chips **#494F4D**.

### Sound (not observed)
- Not heard. I would expect a choir or chime swell at the effect frame (5.90) and a glassy crumble at the shatter (6.62). Please verify by ear.

---

## 3. Black board wipe

### 3a. The Meathook Massacre (-X/-X to everything, 0:14.2–0:16.0)

Contact sheets: `img/black-meathook-1-wave.jpg`, `img/black-meathook-2-deaths.jpg`

| t (s) | What happens |
|---|---|
| 14.35 | The board is normal and the card is on the stack (right). |
| 14.42 | **The wave starts at the stack card.** Violet-magenta streaks burst leftward from it. |
| 14.49–14.63 | **A screen-wide wave** sweeps right to left across the whole battlefield, both players' rows, in about 0.2 s. It is many thin, wind-blown horizontal **streaks and slivers** (like torn ribbons or shards), with the brightest highlights on the leading edge. The whole board takes on a **violet tint**: an overlay about 2–3 card heights tall, covering the middle of the board. |
| 14.70 | The wave thins and fades. The tint lifts. The enchantment leaves the stack. |
| 14.77 | **Every creature gets hit at once.** The same white-violet crackle as Fateful Absence appears inside each affected card. |
| 14.84–15.05 | A **spirit column** rises from each card (pale blue-white), the same as the single destroy. |
| 15.15–15.35 | The cards go grey and dark. |
| 15.45 | The **first card shatters** into square chips (the caster's own creature). |
| 15.55–15.75 | **The second card shatters** about 0.1–0.2 s later (the opponent's). Both slots are empty by 15.75. |

So the wipe is **one screen-wide sweep**, then **per-card deaths that are nearly simultaneous, with a slight stagger** (about 0.1–0.2 s between cards). It is not a slow one-by-one sequence. Each card's death is **the same animation as a single destroy**: crackle, rising wisps, grey, chip-shatter, about 0.9 s.

Measured colours: wave **#AC71FD** (bright lavender-violet, dominant), **#9351F6** violet, **#AC53FE** magenta-violet, **#8E54CF** / **#8850B1** mid purple, **#70378F** / **#6D378E** deep plum. The fading tint is **#744A91**, **#754DAF**. The dying cards' crackle and grey are **#50566B**, **#6A718A**, **#71778B**.

### 3b. Extinction Event (exile all odd or even creatures, 0:05.3–0:08.0)

Contact sheets: `img/black-extinction-event-1-eclipse.jpg`, `img/black-extinction-event-2-collapse.jpg`

This is a **single black hole centred over the group of affected creatures**, not a wave.

| t (s) | What happens |
|---|---|
| 5.30 | The affected creatures get a **pink-magenta highlight** (only the ones that will be exiled). |
| 5.38 | A **pale grey haze disc** forms above the group, about 1.6 card widths across. |
| 5.45 | It thickens into a translucent grey-brown disc. |
| 5.52 | The disc is opaque **near-black** with a soft amber glow at its rim. |
| 5.59–5.73 | **Eclipse.** A pure black disc with an **amber-gold corona** and fine **radial light rays** out to about 2.5× the disc radius. It holds for about 0.15 s. |
| 5.80 | The corona **flares bright yellow-white**. The rays lengthen; this is the "burst" frame. |
| 5.87 | The corona turns **white-hot with a pink-red fringe**. |
| 5.94–6.15 | A **magenta and violet energy vortex** forms: swirling rings around the hole, with white streaks pulled **inward**. The cards under it darken. |
| 6.22–6.43 | The magenta fades. White-cream rays remain. The cards show as dark ghosts. |
| 6.5–6.9 | The cards **break into small shards with magenta edges that drift UP into the hole**. The corona dims slowly. |
| 7.1–7.3 | Only a black disc with smoky edges is left. Dark smoke tendrils drip downward. |
| 7.4 | The disc **dissolves into dark smoke**. |
| 7.5–8.0+ | Gone. **Residue:** the board stays darkened and covered in a web of **thin purple-magenta crack or vein lines** across the floor, which fades over about 1 s or more. |
| 7.85 | The spell card goes to the graveyard. |

Measured colours: hole **#0E0C08** (near black). Corona **#CFAE68**, **#B18E53** amber, **#CF8E49** orange, **#CFCA51** yellow at the flare. Flash **#FEF7F3**. Fringe **#F6CFCF** / **#F2B1B1**. Vortex **#FA91F7**, **#F549F7**, **#CC4DD3** magenta, **#F6D1F5** lilac. Board shadow afterward is about 35% darker than the floor.

### 3c. Contrast: Supreme Verdict (W/U "destroy all", 5:00.4–5:01.5)

Contact sheet: `img/wu-supreme-verdict-beam-wipe.jpg`

- 5:00.55: a **blinding horizontal beam** fires across the **entire width** of the battlefield along the creatures' row, about 1 card height thick. Core **#FEFEFC**, edges pale yellow **#F9FCCF** and **#F5D18E**. Every creature in the row is covered at once.
- 5:00.65–5:01.15: the beam **narrows** to a thin cyan-edged line, about 0.2 card thick, over about 0.5 s. The cards show underneath as grey ghosts.
- 5:01.25–5:01.45: the beam is gone. **All creatures turn to translucent grey and crumble to dust together, with no stagger seen.** The board is clear by 5:01.45.
- White and blue wipes read as **light sweeping the board**. Black wipes read as **colour draining or a void pulling cards in**.

### Board wipe vs single death: summary
- **A wipe adds one global element** (a sweep wave, a beam, or a black hole) that lasts about 0.2–1.5 s and covers the board or the whole affected group. A single removal only has a local effect about 1–2 cards wide.
- **Each card's death inside a wipe is the same per-card death animation** as a single kill. The deaths fire **together or with a short 0.1–0.2 s stagger**, never as a slow one-by-one sequence.
- The global element **comes first** and the per-card deaths follow about 0.1–0.3 s later.
- A black void wipe leaves **residue on the board** (darkening plus purple veins) for about 1 s after.

### Sound (not observed)
- Not heard. I would expect a low, swelling sound under the wave (Meathook 14.42) or the eclipse flare (EE 5.80), then overlapping crumble sounds on the deaths. Please verify by ear.

---

## 4. Creature death: the variants seen

| Cause | Look | Duration | Where the card goes |
|---|---|---|---|
| **Damage** (red ping) | Impact → indigo smoke cloud → the card shows again **charred dark maroon** → **burns away in place** (holes with faint glowing edges, transparency, ash flecks) | about 0.9 s after impact | Disappears in place. No flight to the graveyard was seen. |
| **Destroy / -X/-X** (Fateful Absence, Meathook, Verdict) | White-violet **crackle** in the card → **pale wisps rise** about 1.5 card heights → card turns **grey**, then charcoal → **shatters into a grid of square chips** that scatter and fade | about 0.9 s | Disappears in place. |
| **Exile, single** (Skyclave) | Card goes **dark** → navy void **swirl** inside the frame → **thin white ring** → **implodes to a white star** with a horizontal flare → **light orb flies to the exiling source** | about 1.1 s | A light orb travels to the source. |
| **Exile, mass** (Extinction Event) | Pink highlight → black-hole eclipse overhead → cards **shatter into shards that get sucked up** into the hole | about 2.2 s for the whole event | Pulled into the void. |

Common to all of them:
- The dying card **never visibly flies to the graveyard**. It is destroyed in place and the slot empties. (Only the *resolved spell card* is seen sliding from the stack to the graveyard.)
- **No camera shake** was visible in any of the clips at the default zoom.
- **The remaining cards do not react.** No ripple or knock-back on neighbours was seen.

---

## 5. Notes for the TTS spec (my interpretation)

- **Red ping:**
  - Projectile from source (or stack) to target: a small coral-red fireball with a yellow-white head and an orange ember trail. It travels in a straight line, accelerating, over about 0.2–0.3 s.
  - The impact should be **white with a pink bloom** (not orange): a short star flash, then an expanding white ring about 1.5 cards across, then grey shards and slate-indigo smoke.
  - Show a red damage number for about 0.4 s.
  - The death is a charred **burn-away dissolve** over about 0.4 s.
- **White exile:**
  - No projectile. Desaturate the card, then a dark swirl, then a hairline white ring.
  - Collapse to a white star with a horizontal streak, then a periwinkle orb that flies to the source card or to an exile spot.
- **White destroy:**
  - Pale blue-white crackle, then a rising wisp column, then grey, then a square-chip shatter.
- **Black wipe:**
  - One global violet streak wave sweeping the table (about 0.2 s), or a single black eclipse disc with an amber corona that turns into a magenta vortex.
  - Then per-card deaths with a 0.1–0.2 s stagger.
  - Optional: purple vein residue on the mat for about 1 s.
- **Ability or trigger "from source":**
  - The source card flares, then a thin glowing comet line arcs to the target or stack (about 0.3 s), with a small burst on arrival.
- **Constraints from our TTS memory notes:**
  - Many simultaneous particle objects are a risk at high object counts.
  - The per-card death in a wipe should be cheap and reused. Only the single global element should be heavy.
