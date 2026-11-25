# Sound credits and licences

Every sound the table plays, where it comes from, its licence, and what credit it needs. Checked 2026-11-25 against
`engineSounds` in `tools/engine-renderer.lua` and the "Licences and sources" section of `docs/sounds.md`, which holds
the evidence behind each row (file metadata, page checks, sha256s).

**No audio file is in this repository.** `assets/` is gitignored. The table plays each clip from a Steam Cloud link in
`engineSounds`, and the route B sound bundle (`mtg-sounds.unity3d`, its link in `engineFxBundle.sounds`) holds the same
clips. But the links are in the table's script, so publishing the table or this repo publishes the sounds. The
licences below therefore apply to the repo, a release and any Workshop upload alike.

The public-domain licence (`LICENSE`) covers our code only. It does not cover these sounds, except the ones marked
"ours".

## Inventory

One row per sound kind. "Bursts" are the same clip stacked 2 to 8 times (`docs/sounds.md` "Bursts"); they are edits
of the kind's clip and carry its licence. Every clip was also trimmed, levelled, padded to 2 s and made twice as loud
(`docs/sounds.md` "Twice as strong"), so every third-party clip below is an edited version.

| Kind (`engineSounds` key) | Plays when | Bursts | Source | Author | Licence | Status | Credit needed |
|---|---|---|---|---|---|---|---|
| `wipe` | 3 or more permanents to graveyards on one board | x3..x8 (the wipe sound mixed over death xN) | [Spell Sounds Starter Pack](https://opengameart.org/content/spell-sounds-starter-pack), OpenGameArt | p0ss | CC-BY-SA 3.0 (also GPL 2.0/3.0; we use CC-BY-SA 3.0) | **cleared, source probable** (WAV named `.ogg`, a fault the page's comments report; 3.43 s like the pack's other files). The bursts are **not cleared**: they mix in the death sound | Yes: author, title, link, licence link, "changed"; our edits CC-BY-SA 3.0 |
| `instant` | an instant resolves | none | Spell Sounds Starter Pack (as above) | p0ss | CC-BY-SA 3.0 | **cleared, source probable** | Yes, as wipe |
| `exile` | a permanent is exiled | x2..x8 | Spell Sounds Starter Pack (as above) | p0ss | CC-BY-SA 3.0 | **cleared, source probable** (Ogg tagged as made in LMMS, as the pack says) | Yes, as wipe |
| `sorcery` | a sorcery resolves | none | "PowerDrain" (`qubodup-PowerDrain.flac`, came with its `license.txt`); reversed, 3x faster, half speed at the same pitch, plus our own pop and crackle | Iwan 'qubodup' Gabovitch (http://qubodup.net), 2012 | CC-BY-SA 3.0 | **cleared** (licence text and copyright line came with the file; no source page found, a search on 2026-11-25 found none either) | Yes: author, title, licence link, "changed"; our version CC-BY-SA 3.0 |
| `damage` | 5 or less damage to a creature (every hit when playerhit/bighit have no link) | x2..x8 | [37 hits/punches](https://opengameart.org/content/37-hitspunches), OpenGameArt (submitted by qubodup) | Independent.nu | CC0 | **cleared, source likely** (filename `hit01.mp3.flac` matches a known re-upload's naming; the page answers 403 to automated fetches) | No (credit given as a courtesy) |
| `treasure` | Treasure tokens created | x2..x8 | [Sack of Gold](https://opengameart.org/content/sack-of-gold), OpenGameArt | Amarikah | CC0 ("Credit me if you like") | **cleared, certain** (licence read on the page 2026-11-13) | No (credit given as a courtesy) |
| `knockout` | a player loses or concedes | none | ours: ffmpeg generators, `tools/make-effect-sounds.js` | this project | public domain (`LICENSE`) | **cleared** | No |
| `death` | a permanent goes to the graveyard | x2..x8 | **unknown**: `Permanent_and_creature_removal_sound_effect.wav`, a 1.85 s WAV tagged as made in FL Studio's Edison; supplied as a file with no source page | ? | ? | **NOT CLEARED** (OpenGameArt searches 2026-11-12, web search 2026-11-25: no page offers it) | Unknown |
| `treasurespend` | Treasure tokens leaving the battlefield | x2..x8 | plays death's own links | ? | ? | **NOT CLEARED** (it is the death sound) | Unknown |
| `lifegain` | a player gains life | x2..x8 (rising chimes) | **unknown**: `Health_gain.aif`, a 3.20 s AIFF. Unverified guess: [Level up, power up, Coin get (13 Sounds)](https://opengameart.org/content/level-up-power-up-coin-get-13-sounds) by wobbleboxx, CC0; no page lists a `Health_gain` file | ? | ? | **NOT CLEARED** (web search 2026-11-25: no match) | Unknown |
| `countered` | a spell is countered | none | **unknown**: `If a spell is countered.ogg`, supplied as a file | ? | ? | **NOT CLEARED** | Unknown |
| `counter` | a counter is put on a permanent | none | **unknown**: `Counter gain.mp3`, supplied as a file | ? | ? | **NOT CLEARED** | Unknown |
| `playerhit` | 1 to 5 damage to a player | x2..x8 | **unknown**: `player damage from pingorbolts pells.ogg`, supplied as a file | ? | ? | **NOT CLEARED** | Unknown |
| `bighit` | one hit of more than 5 | x2..x8 | **unknown**: `Damage from anything over 5.ogg`, supplied as a file | ? | ? | **NOT CLEARED** | Unknown |

The filenames of the unknown clips are descriptive names, not the authors' own, so they can't be searched for. The
original files are not on disk to compare against candidate packs.

**Summary.** Cleared: wipe (the plain clip), instant, exile, sorcery, damage, treasure, knockout. Not cleared: death
(and with it treasurespend and the wipe bursts), lifegain, countered, counter, playerhit, bighit, and all their bursts.
The sound bundle `mtg-sounds.unity3d` holds all of them, so it is not cleared either until they are.

## What clears the rest

Either the maintainer names the page each unknown clip was downloaded from (then its licence is checked like the rows
above), or the clip is replaced. Nothing below has been downloaded or put on the table; each needs the maintainer's
listening pick, then the usual steps (recipe and upload: `docs/sounds.md`, "Kenney CC0 candidates", "What the user
does"; then the sound bundle rebuilt).

Proposed CC0 replacements (licence, length and type read on each page 2026-11-25):

| For | Candidate | Author | Length, type | Licence | Note |
|---|---|---|---|---|---|
| `death` (and `treasurespend`, wipe bursts) | [Poof in cloud](https://freesound.org/people/Mateusz_Chenc/sounds/512217/), Freesound | Mateusz_Chenc | 0.83 s, mp3 | CC0 | "disappear things in clouds": a card leaving |
| `death` | [Puff of Smoke](https://freesound.org/people/qubodup/sounds/714257/), Freesound | qubodup | 0.5 s, wav | CC0 | a short poof; matches the table's death smoke |
| `lifegain` | [Heal Restore](https://freesound.org/people/Qvantor/sounds/878621/), Freesound | Qvantor | 3.24 s, wav | CC0 | a soft pad rising into a major chord; would need trimming to about 1.8 s |
| `lifegain` | [Improvement/Healing Chime](https://freesound.org/people/Raclure/sounds/483608/), Freesound | Raclure | 0.63 s, mp3 | CC0 | short; suits the rising-chime bursts |
| `countered` | `mtg5-countered-kenney-a` / `-b`, already made (`docs/sounds.md` "Kenney CC0 candidates") from Kenney's [Digital Audio](https://kenney.nl/assets/digital-audio) | Kenney | 0.44 s / 0.65 s | CC0 (pack `License.txt` read) | ready to upload |
| `counter` | our generated counter (`mtg2-counter-generated.mp3`, `tools/make-effect-sounds.js`), the table's counter before 2026-11-12 | this project | 0.62 s | public domain | ready to upload; no third party |
| `playerhit` | [37 hits/punches](https://opengameart.org/content/37-hitspunches): another hit from the pack damage already uses | Independent.nu | pack | CC0 | same family as damage, no new source |
| `playerhit` | [Punch](https://freesound.org/people/danlucaz/sounds/517744/), Freesound | danlucaz | 1.01 s, wav | CC0 | a palm punch |
| `bighit` | [ANI Big Pipe Hit](https://freesound.org/people/ani_music/sounds/244983/), Freesound | ani_music | 1.0 s, wav | CC0 | "a heavy slightly detuned metallic ringing thud" |
| `bighit` | Kenney's [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) `lowFrequency_explosion_000.ogg` (already downloaded for the knockout candidates) | Kenney | 2 s or more (cut at 1.75 s for knockout) | CC0 | a deep boom |

Or make them like knockout, from ffmpeg generators (`tools/make-effect-sounds.js`): no third party at all.

## Attribution text

In `README.md` "Credits and legal" (added 2026-11-25). For the Workshop and itch.io descriptions:

> Sound effects: "Spell Sounds Starter Pack" by p0ss, CC-BY-SA 3.0, https://opengameart.org/content/spell-sounds-starter-pack
> (edited: trimmed, levelled, stacked, made louder; the edited clips are CC-BY-SA 3.0). Sorcery: "PowerDrain" by Iwan
> 'qubodup' Gabovitch, http://qubodup.net, CC-BY-SA 3.0 (edited: reversed, sped up, levelled, with added sounds; the
> edited clip is CC-BY-SA 3.0). Hits from "37 hits/punches" by Independent.nu, CC0,
> https://opengameart.org/content/37-hitspunches. Treasure: "Sack of Gold" by Amarikah, CC0,
> https://opengameart.org/content/sack-of-gold. Licence: https://creativecommons.org/licenses/by-sa/3.0/

Add a line for each replacement once it is picked (CC0 needs none; a courtesy credit is fine).

## Share-alike, in short

The p0ss and qubodup clips are CC-BY-SA 3.0. Redistributing and editing them is allowed, commercial use too, on these
conditions: credit the author and title with a link, link the licence, say they were changed, and offer our edited
clips under CC-BY-SA 3.0. The edited clips are public on their Steam Cloud links, so they are available. The share-alike
covers the sounds, not the table's code.
