# Table sound effects

Six sounds the user supplied on 2026-11-11, from OpenGameArt. Each was trimmed to where its sound ends, given an 80 ms fade-out, levelled to about -20 dBFS RMS (peaks under -1 dBFS), and encoded as 160 kbps mp3 with VLC. They were uploaded to the host's TTS Cloud (Steam Cloud); the links below are what the table plays (each link was downloaded back and matches its mtg2 file by sha256).

**Re-encoded 2026-11-11 (the links below are the new ones, files assets/sounds/tts/mtg2-*.mp3).** TTS's music player never loaded the first uploads. Live probes showed two causes:

- TTS rejects the VLC-made mp3s ("AudioClip Error: Unsupported Format!"), even at 1.6–1.8 s.
- It loads no clip shorter than about 1.5 s, in any format (WAV and OGG under 1.5 s failed too).

ffmpeg's libmp3lame mp3s with an ID3 tag load fine, so every file, plain and burst, was padded with silence to at least 2 s and re-encoded:

`ffmpeg -i <old>.mp3 -af "apad=whole_dur=2" -c:a libmp3lame -b:a 192k -ar 44100 -id3v2_version 3 -metadata title=<name> mtg2-<name>.mp3`

All 30 loaded in TTS from file:/// links before the upload. The lengths in the table are the sound's own; the files are 2 s or longer. A new sound must follow the same recipe. A file longer than 2 s also needs its length in `engineSoundLen` (tools/engine-renderer.lua: exile-x6 2.04 s, exile-x8 and lifegain-x8 2.25 s). The table pauses each clip just before its end, because TTS would otherwise go on to the players' next track.

Since that day, only a track of the players' own that is *playing* holds off the table's sounds. A paused one is replaced; it stays in their music library. TTS loads a save's track paused, so the earlier rule silenced every sound on the playgroup's own save.

| File | Plays when | Length | Original file | Link |
|---|---|---|---|---|
| mtg-death.mp3 | a permanent goes to the graveyard (`death`) | 0.90 s | Permanent_and_creature_removal_sound_effect.wav | https://steamusercontent-a.akamaihd.net/ugc/13327121084153162136/0C977DB5060F3953980271BE4789081E6889FD46/ |
| mtg-wipe.mp3 | several permanents go to the graveyard on one board (`wipe`, new) | 1.60 s | Board_wipe_to_graveyard_sound_effect.ogg (really a WAV) | https://steamusercontent-a.akamaihd.net/ugc/11479971636843136595/5C0FB88EC6DE1F473D4067207ADDB4CCC0540597/ |
| mtg-damage.mp3 | damage to a creature or a player (`damage`) | 0.80 s | hit01.mp3.flac (really FLAC) | https://steamusercontent-a.akamaihd.net/ugc/10124521221080295893/E301DC2C50A312AB8C6C1EDBB7C295B3AC76B06E/ |
| mtg-exile.mp3 | a permanent is exiled (`exile`, new) | 1.50 s | Exile_sound_effect.ogg | https://steamusercontent-a.akamaihd.net/ugc/17507000918538872455/683F8320B4DB9EAF77CF1AF05D1205EF94F7BA65/ |
| mtg-instant.mp3 | an instant is cast, instants only (`instant`, new) | 0.90 s | Instant_spell_cast.ogg (really a WAV) | https://steamusercontent-a.akamaihd.net/ugc/13908604519167356078/0E2D2096A9D13080B6AC9F2204F29D2B419AD00A/ |
| mtg-lifegain.mp3 | a player gains life (`lifegain`, new) | 1.80 s | Health_gain.aif | https://steamusercontent-a.akamaihd.net/ugc/18328296034120530417/099A768F25DE573194668B6ACDFC47C3BC4F0DE7/ |

`counter` and `knockout` have clips (below, "Counter and knockout") but no link yet, so they stay silent.

The links are in `engineSounds` in `tools/engine-renderer.lua` (2026-11-11); when each kind plays and which wins on a
busy board: `docs/m5-effects-design.md` section 6. `tests/test_table_effects.js` checks the two lists match.
## Bursts (stacked copies)

TTS's music player plays one clip at a time, so a sound can't overlap itself live. For drama when many things happen at once, each burst below is the same sound stacked N times, pre-mixed offline (the mixes in assets/sounds/stack, the files the table plays in assets/sounds/tts as mtg2-<kind>-xN.mp3, both gitignored). The table picks the largest bucket that is no more than the count, capped at ×8, and still plays one sound per board, so a runaway turn (exponential life gain or damage) never plays more than one ×8 clip per update.

- damage, death, exile: N copies about 110–170 ms apart with a little timing jitter, each 1 dB quieter than the one before, leaning alternately left and right.
- lifegain: style B, rising chimes (the user picked it from three options on 2026-11-11): copies 170 ms apart, each pitched up min(2, 9/(N-1)) semitones from the last.
- wipe: the wipe sound mixed over death ×N at -4 dB (no ×2: a wipe is 3+ permanents).

Uploaded 2026-11-11 (re-encoded, mtg2-*); each link was downloaded back and matches its mtg2 file by sha256.

| File | Kind | Copies | Link |
|---|---|---|---|
| mtg-damage-x2.mp3 | damage | 2 | https://steamusercontent-a.akamaihd.net/ugc/9466119173358429772/2E01C49BC2F53D6B93F512EA0A64749DDA634A13/ |
| mtg-damage-x3.mp3 | damage | 3 | https://steamusercontent-a.akamaihd.net/ugc/17172338814229470186/BA59E9063B3D8BCAB7189038A65371A54F7D222C/ |
| mtg-damage-x4.mp3 | damage | 4 | https://steamusercontent-a.akamaihd.net/ugc/13841800202556732767/F0038F1475AEFEC61821E465C78BC3EC21D80C35/ |
| mtg-damage-x6.mp3 | damage | 6 | https://steamusercontent-a.akamaihd.net/ugc/11502082504506897617/CF4A879844D92A2B54F7C750CD94BB636EE34ED4/ |
| mtg-damage-x8.mp3 | damage | 8 | https://steamusercontent-a.akamaihd.net/ugc/15514955064335890272/27041620B6C22438F8CEE38F4DEA99C3F41E499F/ |
| mtg-death-x2.mp3 | death | 2 | https://steamusercontent-a.akamaihd.net/ugc/15977504191754705363/9CB0EBE3DEB258B6EC662929F722AA63C1859207/ |
| mtg-death-x3.mp3 | death | 3 | https://steamusercontent-a.akamaihd.net/ugc/10197623558912609913/8E8411F1BB726E5EC9E9DCCAF2BDA12DA8873A94/ |
| mtg-death-x4.mp3 | death | 4 | https://steamusercontent-a.akamaihd.net/ugc/13749034421601130711/8C34460B16F3A2C67691C9CDB2648B3B4FC700DC/ |
| mtg-death-x6.mp3 | death | 6 | https://steamusercontent-a.akamaihd.net/ugc/14981614231409099112/DFE78BFC666DAB2A2EF88031E551780A8AD4AF5A/ |
| mtg-death-x8.mp3 | death | 8 | https://steamusercontent-a.akamaihd.net/ugc/15294488810888848110/3E48CF911CB8DA8E2E91231BE0A3DA620D1AB5B5/ |
| mtg-exile-x2.mp3 | exile | 2 | https://steamusercontent-a.akamaihd.net/ugc/17186924497210315771/FE7A0190EFBB0DD9CF10187AC7F4A053FF1445A5/ |
| mtg-exile-x3.mp3 | exile | 3 | https://steamusercontent-a.akamaihd.net/ugc/16360686395485260339/33E0E7B8EE9466915355D652E0E2F53319E380E2/ |
| mtg-exile-x4.mp3 | exile | 4 | https://steamusercontent-a.akamaihd.net/ugc/10667382779559099124/73D0ED29786C7A9DBED6E09027F1BD86EA407F00/ |
| mtg-exile-x6.mp3 | exile | 6 | https://steamusercontent-a.akamaihd.net/ugc/17333791709913556002/D96572C923879FA41AA4FF78BABF33C230B7BE18/ |
| mtg-exile-x8.mp3 | exile | 8 | https://steamusercontent-a.akamaihd.net/ugc/16336440088589292350/C7421989BD48CF0D53217080BCD600880C9EABF3/ |
| mtg-lifegain-x2.mp3 | lifegain | 2 | https://steamusercontent-a.akamaihd.net/ugc/10399168408910104955/AACB8F7F754DBFEC4CB9FA5E160B526C0B369D03/ |
| mtg-lifegain-x3.mp3 | lifegain | 3 | https://steamusercontent-a.akamaihd.net/ugc/14232928834878565003/0A18B59FCF2658F59C5946B812F153BC70EE8BB3/ |
| mtg-lifegain-x4.mp3 | lifegain | 4 | https://steamusercontent-a.akamaihd.net/ugc/15145076126188951042/48A9C18F2948F0AAF6BE76DCE1ADC5A4F9694697/ |
| mtg-lifegain-x6.mp3 | lifegain | 6 | https://steamusercontent-a.akamaihd.net/ugc/13678081104005473403/478E8433DBE00A0525EA21D206CA4DEEAFB5CBBE/ |
| mtg-lifegain-x8.mp3 | lifegain | 8 | https://steamusercontent-a.akamaihd.net/ugc/12456025496901847800/D91EEE8A25C5F36EB72180F2363E38FC7B649D23/ |
| mtg-wipe-x3.mp3 | wipe | 3 | https://steamusercontent-a.akamaihd.net/ugc/14397732191257991892/A2E4928820C613C1C7F795C4D22F39A951A14A0E/ |
| mtg-wipe-x4.mp3 | wipe | 4 | https://steamusercontent-a.akamaihd.net/ugc/14089368148864425489/1B489E29E6BD0AA6026B4541D50135F5DF522F6B/ |
| mtg-wipe-x6.mp3 | wipe | 6 | https://steamusercontent-a.akamaihd.net/ugc/16706646390672856597/464A1F9ED5D5B2B15041BFDD9E6BF355867838D1/ |
| mtg-wipe-x8.mp3 | wipe | 8 | https://steamusercontent-a.akamaihd.net/ugc/17471838172650004055/385D7FB6163AFE2C6DFD043DAE5036647530E63E/ |

## Counter and knockout (made 2026-11-11, not uploaded yet)

Made with ffmpeg's own generators by `tools/make-effect-sounds.js`: no downloaded or third-party audio, so they are this
project's work and public domain like the code (`LICENSE`). The noise seeds are fixed: a run makes the same files, byte
for byte. Levelled like the six (-20 dBFS RMS over the sound, peaks under -1 dBFS, 80 ms fade-out), then the TTS recipe
above (padded to 2 s, libmp3lame 192 kbps, ID3v2.3, titles "MTG effect counter" / "MTG effect knockout"). The same
recipe as the 30 that load in TTS, but these two have not been loaded in TTS yet.

| File (assets/sounds/tts/) | Kind | Sound | File length | sha256 | Link |
|---|---|---|---|---|---|
| mtg2-counter.mp3 | a counter put on a permanent (`counter`) | 0.62 s: a soft tick, then two rising bell notes (E6, B6) | 2.00 s (49,601 bytes) | `0b21690e0d7c5373fd082dc8fc0d81dd7a7e9018dd0187a47d2ef5ea8ebbc71a` | none yet |
| mtg2-knockout.mp3 | a player loses or concedes (`knockout`) | 1.60 s: an explosion (a noise crack, a low rumble, a sub thump falling 80 to 30 Hz) | 2.00 s (49,602 bytes) | `5f45e58c0e0c4f22a57f12b3f2c6e81924f600983ee5ccdb68f8f5653fed1103` | none yet |

Both files are 2.0 s, so neither needs an `engineSoundLen` entry (the table pauses a clip at its length minus 0.25 s,
1.75 s, after both sounds have ended).

**Where the links go**, once the lead has uploaded the two files (TTS → Modding → Cloud Manager) and downloaded each
link back to check its sha256 against the table above:

1. `tools/engine-renderer.lua`, the `engineSounds = engineSounds or {` table: replace `nil` in the lines
   `counter = nil, -- a counter put on a permanent` and `knockout = nil, -- a player loses or concedes` with the quoted
   links (`counter = "https://steamusercontent-a.akamaihd.net/ugc/.../",`). Until then both stay `nil`, which plays
   nothing (`FX.picked`), so a board with only a counter or a knock-out is silent and the next kind down plays instead.
   Update the comment above the table ("counter and knockout have none yet").
2. This file: move the two rows into the first table as `mtg-counter.mp3` / `mtg-knockout.mp3` with ``(`counter`)`` /
   ``(`knockout`)`` in the "Plays when" column and the link last, the way the six are written: `tests/test_table_effects.js`
   reads that table.
3. `tests/test_table_effects.js`, the "the user's sounds" block: the check that the doc has 6 links becomes 8, and
   "counter and knockout stay silent" becomes a check that they are the doc's links. Its `PICKS` lists and the design
   doc's "six of the eight kinds" (`docs/m5-effects-design.md` section 6) change with them.
4. Run the gates, deploy as usual, then as the host `mtg sounds test counter` and `mtg sounds test knockout`.

## Licences and sources (checked 2026-11-11)

The user supplied the six as files, with no source pages (session uploads `Health_gain.aif`,
`Board_wipe_to_graveyard_sound_effect.ogg`, `Permanent_and_creature_removal_sound_effect.wav`,
`Instant_spell_cast.ogg`, `Exile_sound_effect.ogg`, `hit01.mp3.flac`; most names are descriptive, not the authors').
The sources below were found from the files' own metadata and the OpenGameArt pages; none was confirmed by comparing
the audio (that would need the packs downloaded). **The user should confirm each page, and name the two unknown ones.**

| Our sound (and its bursts) | Source (OpenGameArt) | Author | Licence | How sure | Public repo / Workshop |
|---|---|---|---|---|---|
| wipe, wipe_x3..x8 (also mixes in death) | [Spell Sounds Starter Pack](https://opengameart.org/content/spell-sounds-starter-pack) | p0ss | CC-BY-SA 3.0, GPL 3.0, GPL 2.0 (pick one: CC-BY-SA 3.0) | probable: the file is a WAV named `.ogg`, a fault the page's comments report for this pack, and all three of these uploads are 3.43 s | allowed, with attribution and share-alike (below) |
| instant | Spell Sounds Starter Pack (as above) | p0ss | as above | probable: a WAV named `.ogg`, 3.43 s | as above |
| exile, exile_x2..x8 | Spell Sounds Starter Pack (as above) | p0ss | as above | probable: a real Ogg whose tag says it was made in Linux MultiMedia Studio, as the pack says, 3.43 s | as above |
| damage, damage_x2..x8 | [37 hits/punches](https://opengameart.org/content/37-hitspunches) (submitted by qubodup); an mp3 re-upload of it, "Hit Sound Effects" by KonitaTutorials, names its files `hitNN.mp3.<ext>` like our `hit01.mp3.flac` (that page now answers 403) | Independent.nu | CC0 | likely | allowed, no attribution required (credit is a courtesy) |
| death, death_x2..x8 (and the death under wipe_x3..x8) | **unknown**: a 1.85 s WAV whose tag says FL Studio's Edison made it. Searched 2026-11-12 (OpenGameArt web searches for the filename, "creature removal", FL Studio/Edison, card-game death/destroy): no page offers it | ? | ? | — (not found) | **not cleared** |
| lifegain, lifegain_x2..x8 | **unknown**: a 3.20 s AIFF. Unconfirmed guess: [Level up, power up, Coin get (13 Sounds)](https://opengameart.org/content/level-up-power-up-coin-get-13-sounds) by wobbleboxx, CC0 (per search snippets; the page returned 403 to our fetch, so its file list and licence text were not read; a commenter names a `Rise03.aif` in it, but no `Health_gain` file is listed anywhere we could see) | wobbleboxx (if the guess holds) | CC0 (if the guess holds; unverified) | — (guess only; no page found offering `Health_gain.aif`) | **not cleared** |
| counter, knockout | ours (`tools/make-effect-sounds.js`) | this project | public domain (`LICENSE`) | certain | allowed |

**Flags.**

- **death and lifegain (and wipe_x3..x8, which mix the death sound in) are not cleared** for a public repo, an itch.io
  release or a Workshop upload: their source and licence are unknown (a 2026-11-12 search of OpenGameArt found no page
  for either filename; the wobbleboxx pack for lifegain stays an unverified guess, CC0 if right, no attribution needed;
  the original files were not found on disk to compare). The table plays them from the host's Steam Cloud
  links, and those links are in the table's script, so publishing the table publishes them. Before going public,
  either the user names their OpenGameArt pages (then check each licence like the rows above), or they are replaced
  with clips made like counter and knockout. The audio files themselves are gitignored (`assets/`), so the repo
  holds only the links.
- **The p0ss sounds are CC-BY-SA 3.0 (share-alike).** Redistribution, edits and commercial use are allowed, but:
  credit the author and title with a link, link the licence, say they were changed, and offer our changed versions
  (the trimmed, levelled, padded clips and every burst made from them) under CC-BY-SA 3.0 too. So they are **not**
  public domain like our code: README's licence line must exclude them. Their Steam Cloud links are public, which keeps
  the changed files available. Nothing in CC-BY-SA forbids a Workshop upload; the attribution has to travel with it
  (the Workshop or itch.io description). The GPL options add nothing for audio, so CC-BY-SA 3.0 is the one to cite.
- **CC0 (damage)**: no conditions.

**Attribution text to add** (once death and lifegain are settled; add their lines the same way):

- `README.md`, "Credits and legal", a new bullet:
  > Sounds: the wipe, instant and exile sounds come from "Spell Sounds Starter Pack" by p0ss
  > (https://opengameart.org/content/spell-sounds-starter-pack), licensed CC-BY-SA 3.0
  > (https://creativecommons.org/licenses/by-sa/3.0/); we trimmed, levelled, padded and stacked them, and our versions
  > are CC-BY-SA 3.0 too. The damage sound comes from "37 hits/punches" by Independent.nu
  > (https://opengameart.org/content/37-hitspunches), CC0. The counter and knockout sounds are ours. See
  > docs/sounds.md.

  and the licence line after it: "That covers our code only, not Manabrew, Forge (or our changes to them), the
  Workshop table, the table's sound effects or Magic's cards (see the notices)."
- The Workshop and itch.io descriptions:
  > Sound effects: "Spell Sounds Starter Pack" by p0ss, CC-BY-SA 3.0, https://opengameart.org/content/spell-sounds-starter-pack
  > (edited: trimmed, levelled, stacked; the edited clips are CC-BY-SA 3.0). Hits from "37 hits/punches" by
  > Independent.nu, CC0, https://opengameart.org/content/37-hitspunches.
- `THIRD-PARTY-NOTICES.md`: the rows are in (2026-11-11).
