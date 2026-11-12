# M5 step 4: what the effect and sound AssetBundles must hold

The table side is built (2026-11-12, `tools/engine-renderer.lua`, the M5 block: `FX.findRigs`, `FX.rigPlay`, the route B
part of `engineSoundPlay`; tests in `tests/test_table_effects.js`, "the effect bundle"). This is what the two bundles
must contain so the table can use them, how to build them, and the two-client test. Build project:
`C:\Users\you\mtg-unity\Tabletop-Simulator-Modding` (Berserk-Games' modding project, `ProjectVersion.txt`
6000.0.62f1). Plan: `docs/m5-plan.md` step 4. Sound route B: `docs/m5-effects-design.md` section 6.

## 1. What the table does

| Object | GM notes | How many | Bundle | Link setting |
|---|---|---|---|---|
| Effect rig | `engine:fx` | 6 (`FX.RIGS`) | `mtg-fx.unity3d` | `engineFxBundle.fx` |
| Sound object | `engine:sounds` | 1 | `mtg-sounds.unity3d` | `engineFxBundle.sounds` |

- `engineFxBundle = { fx = nil, sounds = nil }` (next to `engineFxArt` in `tools/engine-renderer.lua`): the TTS Cloud
  links. **No link and no such object on the table: nothing happens**, the effects stay today's Object UI slots and
  the sounds stay the MusicPlayer links.
- With a link and none of that object on the table, a game's first board spawns them once (`spawnObjectData`,
  `Custom_Assetbundle`, locked, parked under the table at y −30, x −40…−31, z 30). They stay in the save after that;
  the next games find them by their GM notes. Rigs already in the save are used without a link too. The spawn data
  carries a `Transform` at the park spot: without one real TTS raises "Object reference not set to an instance of an
  object" and spawns nothing (live check 2026-11-12). A spawn that raises is caught: that game's effects use the
  Object UI slots and the next game tries the spawn again.
- Each game's first board looks for the rigs once: made `interactable = false` (a rig over a card mustn't take its
  clicks), one found above the table goes back under it. The trigger effect names come from the first rig's
  `AssetBundle.getTriggerEffects()`; no AssetBundle yet or an empty list (still loading) is asked again later.
- For an effect, a free rig moves 0.3 above the spot at once, turned to the seat, plays the trigger effect
  (`playTriggerEffect(index)`) at least 0.1 s later, and goes back under the table after the effect's length + 0.6 s.
  No rig free, or no effect of that name: today's Object UI slot.
- `mtg animations off` (host): no rigs at all. `mtg effects off` (a player): the rig is `setInvisibleTo` them (whether
  that hides particles is check 4 below). No seated player with effects on: no rigs.
- The bundle objects are the table's: the new-game sweep of `engine:` objects, `mtg start`'s "cards from the last game"
  check and `engineSelfCheck` leave them alone (`engineIsBundleObject`). (Before this, the sweep destroyed any object
  whose GM notes start with `engine:`, the sound object too.)

## 2. The components (from `Assets/Scripts` of the modding project)

- **`TTSAssetBundleEffects`**: two lists, `LoopingEffects` and `TriggerEffects`. Each effect has `Name`,
  `GameObjects` (each `{ gameObject }`), `Particles` (each `{ Particle: ParticleSystem }`), `Sound` (`{ Audio:
  AudioClip, Positional3D: bool }`, Positional3D **on** by default), `Animation`, `Animator`; a trigger effect also has
  `Duration` (1 s by default). The index Lua uses is the effect's place in `TriggerEffects`, from 0; the table looks
  effects up by `Name`, so order doesn't matter.
- **`LoopingEffects`** starts with one empty entry and an object plays looping effect 0 when it loads
  (`LoopingEffectIndex` 0). Keep exactly one looping effect, named `idle`, with nothing in it.
- **`TTSAssetBundleSounds`**: the object's own physics sounds (`TriggerSounds`: Pickup, Drop, Shake; `ImpactSounds`:
  Generic, Wood, Metal, …). **Not used**: the rigs are never picked up or dropped. Leave it off both prefabs.
- Both scripts are TTS's own classes (a bundle may hold no scripts of its own): use them as they are in the project,
  in its default assembly, unrenamed and unedited.

## 3. `mtg-fx`: the effect prefab

```
MTG_FX                       (root: TTSAssetBundleEffects, BoxCollider 0.2 x 0.2 x 0.2, no MeshRenderer)
├── death                    (one child per trigger effect, named as the effect; inactive in the prefab)
│   ├── flash                (ParticleSystem)
│   ├── smoke                (ParticleSystem)
│   └── shards               (ParticleSystem)
├── death_wipe
├── exile
├── countered
├── damage
├── player_hit
├── counter
├── counter_minus
├── lifegain
└── knockout
```

Each trigger effect: `Name` as below, `GameObjects` = its child, `Particles` = that child's particle systems, `Sound`
empty, `Duration` = the length below. **The names must be exactly these** (`FX.RIG_NAME` in the Lua):

| Trigger effect | When (Lua kind) | Without it the table uses | Look | Length (`FX.RIG_LEN`) |
|---|---|---|---|---|
| `death` | a permanent to a graveyard (`death`) | the slot | white flash, purple-black smoke ~1.5 cards, square shards | 1.0 s |
| `death_wipe` | 4+ deaths on one battlefield, at their middle (`wipe`) | `death` | the same, ~2.2 cards, more smoke | 1.5 s |
| `exile` | a permanent exiled from the battlefield (`exile`) | nothing | the death spiral in white-gold / pale blue, no shards | 1.0 s |
| `countered` | a spell countered, where it stood on the stack (`countered`) | nothing | large white-grey smoke puff | 1.5 s |
| `damage` | damage to a creature (`damage`) | the slot | small white-orange starburst | 0.4 s |
| `player_hit` | damage to a player, their board's back row (`player`) | `damage` | bigger orange starburst | 0.5 s |
| `counter` | a counter put on a permanent (`counter`) | the slot | pale blue ring, a few sparkles | 0.6 s |
| `counter_minus` | only -1/-1 counters (`counter_minus`) | `counter` | violet-grey ring | 0.6 s |
| `lifegain` | a player's life goes up, at their life counter (`lifegain`) | nothing | green-white sparkles rising | 1.0 s |
| `knockout` | a player loses or concedes, at their life counter (fired 0.6 s in) | the slot | red glow, flash, debris | 1.5 s |

Plus the looping effect `idle` (empty). Mana beams are not in the Lua map yet.

Particle systems: **Simulation Space World** (the rig is moved back 0.6 s after the length; in Local the last
particles would follow it), **Play On Awake off**, **Looping off**, Scaling Mode Hierarchy, Max Particles ≤ 64, 1–3
systems per effect, lifetimes inside the length. One card is 2.2 world units (`FX.CARD`): start sizes 0.5–3.
**No sound in this bundle**: the table's sounds come from `engineSounds` (one per board, spaced, muteable).

Colours (Start Color / Color over Lifetime, so one grey smoke texture serves several): death `#3D1A5C` smoke and
`#FFFFFF` flash; exile `#FFF2C0` / `#A8D8FF`; damage `#FFB050`; player hit `#FF9A40`; counter `#A8D8FF`, minus
`#9A7ACC`; lifegain `#B8FFB0`; knockout `#C8401A` and `#FFF2D0` (the same as the slot looks, `FX.look`).

Textures: [Kenney "Particle Pack"](https://kenney.nl/assets/particle-pack), CC0 (credit it in
`THIRD-PARTY-NOTICES.md` anyway). About 12, 256×256, BC7 or DXT5 with mipmaps: two or three smokes, a flare, a star,
a spark, a circle, a twirl, a light, a scorch, a dirt; plus a plain white 16×16 square for the shards (drawn, not
downloaded). The pack's file names (`smoke_01`, `flare_01`, `star_06`, `circle_05`, `twirl_01`, …) are from memory:
pick by eye once it is unpacked. No Asset Store or Fab packs (not redistributable).

## 4. `mtg-sounds`: the sound prefab

```
MTG_SOUNDS                   (root: TTSAssetBundleEffects, BoxCollider 0.2, no MeshRenderer)
```

One trigger effect per sound, with only `Sound` set: `Audio` = the clip, **`Positional3D` off** (everyone hears it the
same), `Duration` = the clip's length; no GameObjects, no Particles. Plus the empty looping effect `idle`.

- Names: the `engineSounds` keys: `death`, `wipe`, `damage`, `exile`, `instant`, `lifegain`; the bursts `death_x2`
  `death_x3` `death_x4` `death_x6` `death_x8`, the same five for `damage`, `exile`, `lifegain`, and `wipe_x3`
  `wipe_x4` `wipe_x6` `wipe_x8` (`docs/sounds.md`); `counter` and `knockout` once they have sounds. 30 effects.
- Clips: the 30 mixes behind `docs/sounds.md` (`assets/sounds/stack`, gitignored), unpadded (the 2 s padding was for
  the music player only). Import: Force To Mono, Decompress On Load, Vorbis quality ~60, 44.1 kHz; level −16 to −18
  LUFS (no volume from Lua).
- **Licences:** `docs/sounds.md` says the six originals are from OpenGameArt; none is listed in
  `THIRD-PARTY-NOTICES.md`. Find and list each one's licence before a public mod carries this bundle.
- Switching a sound to the bundle: `engineSounds.death = "death"` (a value without `http` is a trigger effect name).
  Not automatic: route A (the music player) is known to reach everyone, route B isn't yet (check 3).

## 5. Shaders, platforms, size

- Built-in render pipeline. Materials use only Unity's built-in **`Particles/Standard Unlit`** (Additive for flashes
  and sparks, Fade for smoke). No `Legacy Shaders/Particles/*`, no `Mobile/*`, no Shader Graph or custom shaders: the
  TTS KB says those "will likely appear pink" on other platforms. A built-in shader is in TTS itself; the bundle only
  names it.
- One bundle file per prefab serves every player (an object has one bundle link): build it once for Windows
  (`StandaloneWindows64`). Mac and Linux players load the same file; the built-in-shader rule is what keeps it
  working there, to be seen in check 6. If it shows pink there anyway, stop and ask before trying per-platform builds.
- Budget under 5 MB together: `mtg-fx` under 1.5 MB, `mtg-sounds` under 3 MB.

## 6. Building

- The project's own menu, **Assets → Build AssetBundles** (`Assets/Editor/TTSAssetBundlesMenuItems.cs`): builds every
  prefab with an AssetBundle name (set `mtg-fx` on `MTG_FX`, `mtg-sounds` on `MTG_SOUNDS` in the Inspector) for the
  editor's selected standalone target into `AssetBundles/`, renaming each to `.unity3d` and deleting the manifests.
  Set File → Build Profiles to Windows first.
- From the command line (the editor closed on that project), with a small editor script of our own beside theirs,
  `Assets/Editor/MtgBundles.cs`, that does the same with a fixed target and the size check:

```csharp
using System.IO;
using UnityEditor;
using UnityEngine;

public static class MtgBundles
{
    // unity.exe -batchmode -nographics -quit -projectPath <project> -executeMethod MtgBundles.Build -logFile <log>
    public static void Build()
    {
        const string outDir = "AssetBundles";
        Directory.CreateDirectory(outDir);
        var builds = new[] {
            new AssetBundleBuild { assetBundleName = "mtg-fx.unity3d", assetNames = new[] { "Assets/MTG/MTG_FX.prefab" } },
            new AssetBundleBuild { assetBundleName = "mtg-sounds.unity3d", assetNames = new[] { "Assets/MTG/MTG_SOUNDS.prefab" } },
        };
        if (BuildPipeline.BuildAssetBundles(outDir, builds, BuildAssetBundleOptions.None, BuildTarget.StandaloneWindows64) == null) Fail("build failed");
        long fx = new FileInfo(Path.Combine(outDir, "mtg-fx.unity3d")).Length, snd = new FileInfo(Path.Combine(outDir, "mtg-sounds.unity3d")).Length;
        Debug.Log($"MTG bundles: mtg-fx {fx} bytes, mtg-sounds {snd} bytes");
        if (fx > 1_500_000 || snd > 3_000_000 || fx + snd > 5_000_000) Fail("over the size budget");
        Debug.Log("MTG bundles built");
    }
    static void Fail(string why) { Debug.LogError("MTG bundles: " + why); EditorApplication.Exit(1); }
}
```

```
"C:\Program Files\Unity\Hub\Editor\6000.0.62f1\Editor\Unity.exe" -batchmode -nographics -quit ^
  -projectPath C:\Users\you\mtg-unity\Tabletop-Simulator-Modding -buildTarget StandaloneWindows64 ^
  -executeMethod MtgBundles.Build -logFile C:\Users\you\mtg-tts\tmp\unity-bundles.log
```

  Exit 0 and "MTG bundles built" in the log: done; exit 1: the reason is on the "MTG bundles:" line.
- Upload both in TTS (Modding → Cloud Manager), put the links in `engineFxBundle`, deploy as usual. The first game
  spawns the objects; save the table once so they stay.

## 7. After the first bundle

- `engineFxTest("death", "<card id>")` (or any kind of §3's table by its Lua name: `"wipe"`, `"exile"`, `"lifegain"`,
  …; a colour for a player's spot) plays one effect on a rig at once, looking for the rigs again first. For
  screenshots (`tools/tts-shot.ps1`).
- First guesses to tune: `FX.RIG_LIFT` 0.3, `FX.RIG_LEAD` 0.1 s, `FX.RIG_TAIL` 0.6 s, `FX.RIG_LEN`.
- A new effect needs its name in the bundle, a line in `FX.RIG_NAME` and `FX.RIG_LEN`, and a test.

## 8. The two-client test (plan step 3, not yet run)

A second TTS client (a friend, or a second Steam account on another PC) joins the host's table and sits.

| # | Check | How | Pass |
|---|---|---|---|
| 1 | A host-fired trigger effect shows for the other player | host: `engineFxTest("death", "<card id>")` | the client sees the smoke at the card, about when the host does |
| 2 | At the right spot for them | 1 at each seat | at the card, not under the table first (else raise `FX.RIG_LEAD`) |
| 3 | A host-fired sound effect is heard by the other player | `engineSounds.death = "death"`, `mtg sounds test death` | the client hears it; note the delay, and route A's for comparison |
| 4 | Effects off hides particles | client: `mtg effects off`; host fires 1 | the client sees nothing; if they do, `HOW-TO-PLAY.md` says particles are for everyone, like the life-counter glow |
| 5 | Animations off stops them | host: `mtg animations off`; a creature dies | nothing for anyone |
| 6 | No pink elsewhere | a Mac or Linux client, if one can be found | the same look as on Windows |
| 7 | A client still loading the bundle | a client joins mid-game | no error; effects start once it has loaded |
| 8 | Overlap | two deaths 0.2 s apart; two sounds 0.3 s apart | both effects show; whether the second sound cuts the first |
| 9 | Cost | 4-player AI game, effects on vs `mtg animations off` (`tools/bigboard-test.sh QUIET=1`) | no new frames over 100 ms, `engineProfile.sect.fx` under 5 ms a board, no growth in loaded objects |

If 1 or 3 fails (a trigger effect the host's Lua fires isn't sent to the others), the bundles are host-only: keep the
Object UI slots and route A as the shared effects, and say so in `docs/m5-effects-design.md`.
