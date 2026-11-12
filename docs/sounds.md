# Table sound effects

Six sounds the user supplied on 2026-11-11, from OpenGameArt. Each was trimmed to where its sound ends, given an 80 ms fade-out, levelled to about -20 dBFS RMS (peaks under -1 dBFS), and encoded as 160 kbps mp3 with VLC. They were uploaded to the host's TTS Cloud (Steam Cloud); the links below are what the table plays (each link was downloaded back and matches its mtg2 file by sha256).

**Re-encoded 2026-11-11 (the links below are the new ones, files assets/sounds/tts/mtg2-*.mp3).** TTS's music player never loaded the first uploads. Live probes showed two causes:

- TTS rejects the VLC-made mp3s ("AudioClip Error: Unsupported Format!"), even at 1.6–1.8 s.
- It loads no clip shorter than about 1.5 s, in any format (WAV and OGG under 1.5 s failed too).

ffmpeg's libmp3lame mp3s with an ID3 tag load fine, so every file, plain and burst, was padded with silence to at least 2 s and re-encoded:

`ffmpeg -i <old>.mp3 -af "apad=whole_dur=2" -c:a libmp3lame -b:a 192k -ar 44100 -id3v2_version 3 -metadata title=<name> mtg2-<name>.mp3`

All 30 loaded in TTS from file:/// links before the upload. The lengths in the table are the sound's own; the files are 2 s or longer. A new sound must follow the same recipe. A file longer than 2 s also needs its length in `engineSoundLen` (tools/engine-renderer.lua: exile-x6 2.04 s, exile-x8 and lifegain-x8 2.25 s; 2026-11-12: bighit-x8 2.2 s). The table pauses each clip just before its end, because TTS would otherwise go on to the players' next track.

Since that day, only a track of the players' own that is *playing* holds off the table's sounds. A paused one is replaced; it stays in their music library. TTS loads a save's track paused, so the earlier rule silenced every sound on the playgroup's own save.

| File | Plays when | Length | Original file | Link |
|---|---|---|---|---|
| mtg-death.mp3 | a permanent goes to the graveyard (`death`) | 0.90 s | Permanent_and_creature_removal_sound_effect.wav | https://steamusercontent-a.akamaihd.net/ugc/13327121084153162136/0C977DB5060F3953980271BE4789081E6889FD46/ |
| mtg-wipe.mp3 | several permanents go to the graveyard on one board (`wipe`, new) | 1.60 s | Board_wipe_to_graveyard_sound_effect.ogg (really a WAV) | https://steamusercontent-a.akamaihd.net/ugc/11479971636843136595/5C0FB88EC6DE1F473D4067207ADDB4CCC0540597/ |
| mtg-damage.mp3 | damage to a creature or a player (`damage`) | 0.80 s | hit01.mp3.flac (really FLAC) | https://steamusercontent-a.akamaihd.net/ugc/10124521221080295893/E301DC2C50A312AB8C6C1EDBB7C295B3AC76B06E/ |
| mtg-exile.mp3 | a permanent is exiled (`exile`, new) | 1.50 s | Exile_sound_effect.ogg | https://steamusercontent-a.akamaihd.net/ugc/17507000918538872455/683F8320B4DB9EAF77CF1AF05D1205EF94F7BA65/ |
| mtg-instant.mp3 | an instant is cast, instants only (`instant`, new) | 0.90 s | Instant_spell_cast.ogg (really a WAV) | https://steamusercontent-a.akamaihd.net/ugc/13908604519167356078/0E2D2096A9D13080B6AC9F2204F29D2B419AD00A/ |
| mtg-lifegain.mp3 | a player gains life (`lifegain`, new) | 1.80 s | Health_gain.aif | https://steamusercontent-a.akamaihd.net/ugc/18328296034120530417/099A768F25DE573194668B6ACDFC47C3BC4F0DE7/ |

`counter` and `knockout` have clips (below, "Counter and knockout"; counter is the user's own since 2026-11-12) but no link yet, so they stay silent. The four kinds added 2026-11-12 and the louder death and instant: "Added and changed 2026-11-12" below.

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

**Since 2026-11-12 only knockout here is the table's.** The `counter` kind takes the user's own "Counter gain" sound
(next section), and `tools/make-effect-sounds.js` now writes its generated counter as `mtg2-counter-generated.mp3`, so a
run can't overwrite the user's. The steps below are for knockout; the counter link follows the next section's steps.

Made with ffmpeg's own generators by `tools/make-effect-sounds.js`: no downloaded or third-party audio, so they are this
project's work and public domain like the code (`LICENSE`). The noise seeds are fixed: a run makes the same files, byte
for byte. Levelled like the six (-20 dBFS RMS over the sound, peaks under -1 dBFS, 80 ms fade-out), then the TTS recipe
above (padded to 2 s, libmp3lame 192 kbps, ID3v2.3, titles "MTG effect counter" / "MTG effect knockout"). The same
recipe as the 30 that load in TTS, but these two have not been loaded in TTS yet.

| File (assets/sounds/tts/) | Kind | Sound | File length | sha256 | Link |
|---|---|---|---|---|---|
| mtg2-counter-generated.mp3 (was mtg2-counter.mp3) | replaced 2026-11-12 by the user's "Counter gain" (below); not to be uploaded | 0.62 s: a soft tick, then two rising bell notes (E6, B6) | 2.00 s (49,601 bytes) | `0b21690e0d7c5373fd082dc8fc0d81dd7a7e9018dd0187a47d2ef5ea8ebbc71a` | none |
| mtg2-knockout.mp3 | a player loses or concedes (`knockout`) | 1.60 s: an explosion (a noise crack, a low rumble, a sub thump falling 80 to 30 Hz) | 2.00 s (49,602 bytes) | `5f45e58c0e0c4f22a57f12b3f2c6e81924f600983ee5ccdb68f8f5653fed1103` | none yet |

Both files (the knockout and the now unused generated counter) are 2.0 s, so neither needs an `engineSoundLen` entry (the table pauses a clip at its length minus 0.25 s,
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

## Added and changed 2026-11-12 (made, not uploaded yet)

The user's requests: four new sounds, and "permanent leaving the battlefield sound needs to be louder, increase 1.5,
same for instant sound".

**What plays when** (the order on a busy board: `docs/m5-effects-design.md` section 6):

| Kind | Plays when | Source file (assets/sounds/) |
|---|---|---|
| `countered` (new) | a spell is countered: the spells the COUNTERED pop-up takes (the bridge's `ctrd` names its card; a permanent spell, an instant or a sorcery, never an ability) | `If a spell is countered.ogg` |
| `counter` (new sound) | a counter put on a permanent, as before | `Counter gain.mp3` (replaces our generated one) |
| `playerhit` (new) | 1 to 5 damage to a player (a player's life going down by 1 to 5 on a board; life paid reads the same, as for damage) | `player damage from pingorbolts pells.ogg` |
| `bighit` (new) | one hit of more than 5: a player's life down by 6 or more, or a creature's damage up by 6 or more, on one board | `Damage from anything over 5.ogg` |
| `damage` (narrower) | damage of 5 or less to a creature. It still counts every hit, so with no playerhit or bighit pick (today, until the upload) every hit plays damage as before | (unchanged) |
| `sorcery` (new) | a sorcery cast, mirroring instant: sorceries only, not abilities, not copies (the bridge marks the stack item `sor`, as `ins` for instants) | `sorc cast sound/flac/qubodup-PowerDrain.flac`, reversed and 3x faster |

"One hit" is per player or creature per board: the table sees totals, so two Shocks at one player that land on one
board read as one 4-damage hit.

**How they were made** (`tmp/sounds-1112/build.js` in the main checkout, gitignored with its inputs: the 2026-11-11
`trim/` and `stack/` wavs in `tmp/sounds-1112/old`; ffmpeg 9.0.2 from WinGet, the one `tools/make-effect-sounds.js`
uses; `node build.js --install` rebuilds the same files and copies them to `assets/sounds/tts` and `tmp/upload`, the
replaced ones kept in `assets/sounds/tts-replaced-2026-11-12`):

- New sounds: decoded to 44.1 kHz stereo; trimmed at both ends to the first and last sample over -60 dBFS; levelled
  to -20 dBFS RMS over the sound; peaks limited to -1.41 dBFS where needed; 80 ms fade-out; then the recipe above
  (padded to 2 s, libmp3lame 192 kbps, ID3v2.3, title "MTG effect <name>"). Sorcery first: `areverse`, then
  `asetrate=144000,aresample=44100` (the 48 kHz file played 3x fast: tempo and pitch together), 3.0 s to 1.0 s, of
  which 0.87 s is sound.
- **Levels are measured on the mp3, not the wav.** libmp3lame at 192 kbps cuts everything above about 18.6 kHz, and
  some of these sounds carry a lot there: the instant's wav measured 2.5 dB louder than its own mp3 (the 2026-11-11
  files went through VLC too: the uploaded death and instant play 2.4 and 4.4 dB quieter than their levelled
  wavs, at about -24 and -26.4 dBFS RMS over the sound). So every file is low-passed at 18.6 kHz first (what the limiter sees is what the mp3 keeps), encoded, decoded,
  measured, and its gain corrected until the mp3 is on target with its peak under -1 dBFS.
- **x1.5 louder** (+3.52 dB, by RMS, on the mp3 against the uploaded mtg2 file it replaces): `death` and `instant` from
  the 2026-11-11 lossless `trim/` wavs, each +3.51 / +3.52 dB, no limiting needed. `death-x2..x8` stacked again from
  the louder death with the same tool and settings as 2026-11-11 (`snd-stack.js`: 110 ms apart with its fixed jitter
  table, each copy 1 dB quieter, leaning left and right; it reproduces the 2026-11-11 wavs byte for byte from the
  same input), then +3.49 to +3.51 dB on the uploaded bursts: **these needed limiting**, 2.7 to 4.3 dB of gain
  reduction on the loudest peaks, with the ceiling lowered to -1.66..-2.65 dBFS so the mp3 stays under -1 dBFS.
  `wipe-x3..x8` mixed again (`snd-mix.js`: the wipe sound at 0 dB over death xN) with the death part x1.5 of the one in
  the uploaded mix; the wipe part is unchanged, so the whole mix is 2.2 to 2.6 dB louder; limited by 0.6 dB.
- Limiting on the new sounds: playerhit 3.4 dB, bighit 5.8 dB, sorcery 1.0 dB (their peaks are sharp: levelled to
  -20 dBFS RMS they would peak at +2.0, +4.4 and -0.4 dBFS); none on countered or counter.
- The bursts of `playerhit` and `bighit` (x2 x3 x4 x6 x8, as damage's, since they take over part of damage's): made as
  damage's were, `snd-stack.js` at 110 ms, peak scaled to -1 dBFS, no limiter. A table has 4 seats, so playerhit
  above x4 can't happen yet (as lifegain's x6 and x8); the six-seat table would use them. `bighit-x8` is 1.94 s of
  sound, so its file is padded to 2.2 s and `engineSoundLen.bighit_x8 = 2.2` (paused at 1.95 s, after it ends).
- `countered`, `playerhit`, `bighit` and `sorcery` have no bursts of their own beyond those (countered and sorcery are
  1 at a time, like instant).

**The files to upload** (all in `tmp/upload`, also in `assets/sounds/tts`; `tmp/upload` also keeps `mtg-fx.unity3d` and
`mtg2-knockout.mp3` from before):

| File | Sound | File length | Limited | sha256 |
|---|---|---|---|---|
| mtg2-countered.mp3 | 1.05 s | 2.00 s | no | `3d9e45b8791992f9527be65f0db6bf2870092a6362e96c1a3b4cfba38ab1c782` |
| mtg2-counter.mp3 | 0.65 s | 2.00 s | no | `3c1b99245956aa5a76347478a61600dbbe8ab4cf90f6e8595c89759a38691ef6` |
| mtg2-playerhit.mp3 | 0.85 s | 2.00 s | 3.4 dB | `77ecc886d0e2139bce405ff22bed98387a2d6056e092822d4855a339b67bc43b` |
| mtg2-bighit.mp3 | 1.14 s | 2.00 s | 5.8 dB | `add85f0e053c17076e8f2f5d363421d50285a7b644b0852fabff38b15d6a0671` |
| mtg2-sorcery.mp3 | 0.87 s | 2.00 s | 1.0 dB | `3b673c3dac475d465a810d72ae4be698dcf6632e502524218d1c8429f872c8a7` |
| mtg2-playerhit-x2.mp3 | 0.98 s | 2.00 s | no | `94e0adf5d939e7ad9ce4cc2bdf499ff58a299d8380a2f277e551075fb12aa043` |
| mtg2-playerhit-x3.mp3 | 1.08 s | 2.00 s | no | `48bff0c8c331227d609aeb295bdb3a7a164ff88f8647fdbb2a2a242013d6af97` |
| mtg2-playerhit-x4.mp3 | 1.21 s | 2.00 s | no | `554cd219d24c6e34b2e0e3348c09f00840e81bf1f78655c279536e0325b0da91` |
| mtg2-playerhit-x6.mp3 | 1.42 s | 2.00 s | no | `6aa378824871c9b55b7d7ad132641212a8dc487e2d947ab180d2a4d08989cbb4` |
| mtg2-playerhit-x8.mp3 | 1.65 s | 2.00 s | no | `9c845d3fe6365cd0e20b8b96b565554b495f5bd34c54b64b0bf9c7e37a59ca75` |
| mtg2-bighit-x2.mp3 | 1.27 s | 2.00 s | no | `e2857383cce5c1b719dcdeb9d33f78b4090419331de6d9e45fe727fe26493891` |
| mtg2-bighit-x3.mp3 | 1.37 s | 2.00 s | no | `8f68a8cc7f69ee4d70106e3f63f59c0aac23e5c7a65e51d52b25550d3f4677e0` |
| mtg2-bighit-x4.mp3 | 1.50 s | 2.00 s | no | `d67f9ec59ee375a3d3df9eca374382b0a8f823cc7fa2ef930fb743996936e048` |
| mtg2-bighit-x6.mp3 | 1.71 s | 2.00 s | no | `fd4b93ec7920fe2ce55307dcee86aaadd3c32c70f31e2006030fe8ffd54ef86b` |
| mtg2-bighit-x8.mp3 | 1.94 s | 2.20 s | no | `a88c29437eb4705e9d3f4cad3f5e04ee1c88ec718c660705d0144cf8ed330463` |
| mtg2-death.mp3 | 0.90 s | 2.00 s | no | `eef0a83fc35bb53f8aff2c17894c79b6f470864610ac453daf8a7c230212ff07` |
| mtg2-instant.mp3 | 0.90 s | 2.00 s | no | `402804d40becf47ea00ee7c4b252fb6e7f313dbf1b6c02d1126f3cfad47bc6fd` |
| mtg2-death-x2.mp3 | 1.03 s | 2.00 s | 3.0 dB | `1879ded3ead4896028022b4db6180ef163aa1e11c8255453369a17b06eac6e0c` |
| mtg2-death-x3.mp3 | 1.13 s | 2.00 s | 2.7 dB | `7e11b7b153ec9312df9bb53d7da8b188a9f6e25315fd7a3d45aaa028be94067f` |
| mtg2-death-x4.mp3 | 1.26 s | 2.00 s | 4.3 dB | `57e4e8c78f0ce27403f038055fc080f3cce24fdc5ca41fe85ebb7ee7eeab9e3a` |
| mtg2-death-x6.mp3 | 1.47 s | 2.00 s | 3.3 dB | `6f178f486dc10ebe02d9c25dada2f864ad095c33db31f5606121ad9213b83a98` |
| mtg2-death-x8.mp3 | 1.70 s | 2.00 s | 3.2 dB | `6e7ea2ac35f4ecfccf40b6f0dff602c4bf5571988f2eab8a2b6d63b8e5b4e9a1` |
| mtg2-wipe-x3.mp3 | 1.60 s | 2.00 s | 0.6 dB | `f53d06329a9ab4bbfc4c0b0b784d105c3685ec64e0ed869fb03f6c74c0b1f7e7` |
| mtg2-wipe-x4.mp3 | 1.60 s | 2.00 s | 0.6 dB | `c047dc78e1265a2c0f025aeb8a45806e1706faa15b0d36d5962b74d675fd8505` |
| mtg2-wipe-x6.mp3 | 1.60 s | 2.00 s | 0.6 dB | `457c59d4d9e64c120250dc46184acfe8b9e31136bc8c59ba64d93d89aaa32032` |
| mtg2-wipe-x8.mp3 | 1.70 s | 2.00 s | 0.6 dB | `76f022eba5af89c64ffccaf413e638ea46f662adb7578e99fb4c8805fee00b05` |

None of the 26 has been loaded in TTS yet (same recipe as the 30 that load).

**Where the links go**, once uploaded (TTS → Modding → Cloud Manager) and each link downloaded back and checked
against its sha256 above:

1. `tools/engine-renderer.lua`, `engineSounds`: fill `countered`, `counter`, `playerhit`, `bighit`, `sorcery` (now
   `nil`), add `playerhit_x2..x8` and `bighit_x2..x8`, and replace the links of `death`, `instant`, `death_x2..x8` and
   `wipe_x3..x8`. Until then the table plays exactly what it did on 2026-11-11 (the new kinds have no pick; every hit is
   `damage`).
2. This file: the rows of the first two tables (new kinds' plain sounds as `mtg-<kind>.mp3` rows with ``(`<kind>`)``,
   bursts as `mtg-<kind>-xN.mp3` rows; the replaced death, instant, death and wipe burst links), so the counts that
   `tests/test_table_effects.js` checks (6 plain links, 24 bursts) become 11 and 34, and its "no link until the user
   uploads" check becomes a check that they are the doc's.
3. Gates, deploy, then as the host `mtg sounds test countered`, `playerhit`, `bighit`, `sorcery`, `bighit 8`.

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
| death, death_x2..x8 (and the death under wipe_x3..x8) | **unknown**: a 1.85 s WAV whose tag says FL Studio's Edison made it | ? | ? | — | **not cleared** |
| lifegain, lifegain_x2..x8 | **unknown**: a 3.20 s AIFF. A guess, nothing more: [Level up, power up, Coin get (13 Sounds)](https://opengameart.org/content/level-up-power-up-coin-get-13-sounds) by wobbleboxx (CC0) ships .aif files | ? | ? | — | **not cleared** |
| knockout (and the generated counter, no longer used) | ours (`tools/make-effect-sounds.js`) | this project | public domain (`LICENSE`) | certain | allowed |
| sorcery (2026-11-12) | "PowerDrain" (`qubodup-PowerDrain.flac`, the user's folder `sorc cast sound/` with its `license.txt`); we reversed it and sped it up 3x | Iwan 'qubodup' Gabovitch (http://qubodup.net), 2012 | CC-BY-SA 3.0 (the folder's licence.txt is its full text) | certain: the licence and copyright line came with the file | allowed, with attribution and share-alike (below) |
| countered, counter, playerhit, playerhit_x2..x8, bighit, bighit_x2..x8 (2026-11-12) | **unknown**: the user's files `If a spell is countered.ogg`, `Counter gain.mp3`, `player damage from pingorbolts pells.ogg`, `Damage from anything over 5.ogg`, no source pages | ? | ? | — | **not cleared** |

**Flags.**

- **death and lifegain (and wipe_x3..x8, which mix the death sound in), and since 2026-11-12 countered, counter,
  playerhit and bighit (and their bursts), are not cleared** for a public repo, an itch.io
  release or a Workshop upload: their source and licence are unknown. The table plays them from the host's Steam Cloud
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
- **The sorcery sound is CC-BY-SA 3.0 too** (qubodup's PowerDrain): the same conditions as p0ss's. Credit "PowerDrain" by
  Iwan 'qubodup' Gabovitch, link the licence, say we reversed it, sped it up 3x, trimmed and levelled it, and offer
  our version under CC-BY-SA 3.0. Its `license.txt` names no page; qubodup posts his sounds on OpenGameArt and
  Freesound, so the user may want to find the page to link.
- **CC0 (damage)**: no conditions.

**Attribution text to add** (once death and lifegain are settled; add their lines the same way):

- `README.md`, "Credits and legal", a new bullet:
  > Sounds: the wipe, instant and exile sounds come from "Spell Sounds Starter Pack" by p0ss
  > (https://opengameart.org/content/spell-sounds-starter-pack), licensed CC-BY-SA 3.0
  > (https://creativecommons.org/licenses/by-sa/3.0/); we trimmed, levelled, padded and stacked them, and our versions
  > are CC-BY-SA 3.0 too. The sorcery sound is "PowerDrain" by Iwan 'qubodup' Gabovitch (http://qubodup.net),
  > CC-BY-SA 3.0; we reversed it, sped it up and levelled it, and our version is CC-BY-SA 3.0 too. The damage sound comes from "37 hits/punches" by Independent.nu
  > (https://opengameart.org/content/37-hitspunches), CC0. The counter and knockout sounds are ours. See
  > docs/sounds.md.

  and the licence line after it: "That covers our code only, not Manabrew, Forge (or our changes to them), the
  Workshop table, the table's sound effects or Magic's cards (see the notices)."
- The Workshop and itch.io descriptions:
  > Sound effects: "Spell Sounds Starter Pack" by p0ss, CC-BY-SA 3.0, https://opengameart.org/content/spell-sounds-starter-pack
  > (edited: trimmed, levelled, stacked; the edited clips are CC-BY-SA 3.0). Hits from "37 hits/punches" by
  > Independent.nu, CC0, https://opengameart.org/content/37-hitspunches. Sorcery: "PowerDrain" by Iwan 'qubodup'
  > Gabovitch, CC-BY-SA 3.0 (edited: reversed, 3x faster, levelled; the edited clip is CC-BY-SA 3.0).
- `THIRD-PARTY-NOTICES.md`: the rows are in (2026-11-11); the sorcery row (qubodup) and the four not-cleared 2026-11-12 sounds are in too (2026-11-12).
