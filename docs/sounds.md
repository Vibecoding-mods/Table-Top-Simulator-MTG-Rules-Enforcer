# Table sound effects

The table's sounds. Six came from the user on 2026-11-11, from OpenGameArt; knockout is ours ("Counter and knockout"); counter, countered, playerhit, bighit and sorcery are the user's files of 2026-11-12, when death and instant were also made x1.5 louder ("Added and changed 2026-11-12"). Each of the six was trimmed to where its sound ends, given an 80 ms fade-out, levelled to about -20 dBFS RMS (peaks under -1 dBFS), and encoded as 160 kbps mp3 with VLC. All are on the host's TTS Cloud (Steam Cloud); the links below are what the table plays. Each link was downloaded back and matches its mtg2 file by sha256: the six on 2026-11-11, the 2026-11-12 upload (28 files: 27 sounds and the effect bundle `mtg-fx.unity3d`, `docs/m5-assetbundle-build.md`) on 2026-11-12.

**Re-encoded 2026-11-11 (the links below are the new ones, files assets/sounds/tts/mtg2-*.mp3).** TTS's music player never loaded the first uploads. Live probes showed two causes:

- TTS rejects the VLC-made mp3s ("AudioClip Error: Unsupported Format!"), even at 1.6–1.8 s.
- It loads no clip shorter than about 1.5 s, in any format (WAV and OGG under 1.5 s failed too).

ffmpeg's libmp3lame mp3s with an ID3 tag load fine, so every file, plain and burst, was padded with silence to at least 2 s and re-encoded:

`ffmpeg -i <old>.mp3 -af "apad=whole_dur=2" -c:a libmp3lame -b:a 192k -ar 44100 -id3v2_version 3 -metadata title=<name> mtg2-<name>.mp3`

All 30 loaded in TTS from file:/// links before the upload. The lengths in the table are the sound's own; the files are 2 s or longer. A new sound must follow the same recipe. A file longer than 2 s also needs its length in `engineSoundLen` (tools/engine-renderer.lua: exile-x6 2.04 s, exile-x8 and lifegain-x8 2.25 s; 2026-11-12: bighit-x8 2.2 s). The table pauses each clip just before its end, because TTS would otherwise go on to the players' next track.

Since that day, only a track of the players' own that is *playing* holds off the table's sounds. A paused one is replaced; it stays in their music library. TTS loads a save's track paused, so the earlier rule silenced every sound on the playgroup's own save.

| File | Plays when | Length | Original file | Link |
|---|---|---|---|---|
| mtg-death.mp3 | a permanent goes to the graveyard (`death`; x1.5 louder since 2026-11-12) | 0.90 s | Permanent_and_creature_removal_sound_effect.wav | https://steamusercontent-a.akamaihd.net/ugc/11698913979615550185/7F13F2B39D7065CE85AC235B6369A0747F6F712E/ |
| mtg-wipe.mp3 | several permanents go to the graveyard on one board (`wipe`, new) | 1.60 s | Board_wipe_to_graveyard_sound_effect.ogg (really a WAV) | https://steamusercontent-a.akamaihd.net/ugc/11479971636843136595/5C0FB88EC6DE1F473D4067207ADDB4CCC0540597/ |
| mtg-damage.mp3 | damage of 5 or less to a creature (`damage`; also every hit if playerhit or bighit has no link) | 0.80 s | hit01.mp3.flac (really FLAC) | https://steamusercontent-a.akamaihd.net/ugc/10124521221080295893/E301DC2C50A312AB8C6C1EDBB7C295B3AC76B06E/ |
| mtg-exile.mp3 | a permanent is exiled (`exile`, new) | 1.50 s | Exile_sound_effect.ogg | https://steamusercontent-a.akamaihd.net/ugc/17507000918538872455/683F8320B4DB9EAF77CF1AF05D1205EF94F7BA65/ |
| mtg-instant.mp3 | an instant resolves (not when it is cast, countered, fizzles or is a copy: since 2026-11-12), instants only (`instant`, new; x1.5 louder since 2026-11-12) | 0.90 s | Instant_spell_cast.ogg (really a WAV) | https://steamusercontent-a.akamaihd.net/ugc/15655704109114108865/027ADEDADC1E8E89E6AF2D66E77010F5D9A82298/ |
| mtg-lifegain.mp3 | a player gains life (`lifegain`, new) | 1.80 s | Health_gain.aif | https://steamusercontent-a.akamaihd.net/ugc/18328296034120530417/099A768F25DE573194668B6ACDFC47C3BC4F0DE7/ |
| mtg-counter.mp3 | a counter is put on a permanent (`counter`, 2026-11-12) | 0.65 s | Counter gain.mp3 (the user's) | https://steamusercontent-a.akamaihd.net/ugc/18384867903770801477/E84A3FA1E2AA6059EFD2D315A776D43AEBFD2E87/ |
| mtg-knockout.mp3 | a player loses or concedes (`knockout`, 2026-11-12) | 1.60 s | ours, `tools/make-effect-sounds.js` | https://steamusercontent-a.akamaihd.net/ugc/11703297018823193116/BCCEEF4571C8BD6A30FF2AF0350DE2C53A1DF345/ |
| mtg-countered.mp3 | a spell is countered (`countered`, 2026-11-12) | 1.05 s | If a spell is countered.ogg | https://steamusercontent-a.akamaihd.net/ugc/16931120861737353001/A2214840FC305FC9063F57823D4C2852D2383CD3/ |
| mtg-playerhit.mp3 | 1 to 5 damage to a player (`playerhit`, 2026-11-12) | 0.85 s | player damage from pingorbolts pells.ogg | https://steamusercontent-a.akamaihd.net/ugc/17427026780177468511/DC419EEC5FE59459E3F2417452DDE9E381380D0F/ |
| mtg-bighit.mp3 | one hit of more than 5, to a player or a creature (`bighit`, 2026-11-12) | 1.14 s | Damage from anything over 5.ogg | https://steamusercontent-a.akamaihd.net/ugc/13928224574378758506/BFC535CE502EC967E020203AE6E1CAA2A68E703C/ |
| mtg-sorcery.mp3 | a sorcery resolves (not when it is cast, countered, fizzles or is a copy), sorceries only (`sorcery`, 2026-11-12; remade that night, "Sorcery remake" below) | 2.22 s | qubodup-PowerDrain.flac, reversed, 3x faster, then half speed at the same pitch, with our pop and crackle (uploaded as mtg3-sorcery.mp3) | https://steamusercontent-a.akamaihd.net/ugc/13241084417049183126/BB800BB0A8D05F14C238A0B03A137A70148E6B41/ |
| mtg-treasure.mp3 | Treasure tokens created (`treasure`, 2026-11-13; "Treasure" below) | 1.21 s | snd_purchase.wav, levelled (uploaded as mtg2-treasure.mp3) | https://steamusercontent-a.akamaihd.net/ugc/17824248367881460454/3B2D359381239D6747F3CBF52718D1A3F3CE21C6/ |
| mtg-treasurespend.mp3 | Treasure tokens leaving the battlefield, sacrificed for mana or not, in place of death (`treasurespend`, 2026-11-13) | 0.45 s | coin.1.ogg, levelled (uploaded as mtg2-treasurespend.mp3) | https://steamusercontent-a.akamaihd.net/ugc/13970842037467871805/FDEF1F5E0B2E081CD7A708F320272D17BF04158E/ |

Every kind has a link since 2026-11-12. The upload of that day (the five 2026-11-12 kinds, knockout, the louder death and instant, the bursts below) has not been heard in TTS yet. Details: "Counter and knockout" and "Added and changed 2026-11-12" below.

The links are in `engineSounds` in `tools/engine-renderer.lua` (2026-11-11 and 2026-11-12); when each kind plays and which wins on a
busy board: `docs/m5-effects-design.md` section 6. `tests/test_table_effects.js` checks the two lists match.
## Bursts (stacked copies)

TTS's music player plays one clip at a time, so a sound can't overlap itself live. For drama when many things happen at once, each burst below is the same sound stacked N times, pre-mixed offline (the mixes in assets/sounds/stack, the files the table plays in assets/sounds/tts as mtg2-<kind>-xN.mp3, both gitignored). The table picks the largest bucket that is no more than the count, capped at ×8, and still plays one sound per board, so a runaway turn (exponential life gain or damage) never plays more than one ×8 clip per update.

- damage, death, exile: N copies about 110–170 ms apart with a little timing jitter, each 1 dB quieter than the one before, leaning alternately left and right.
- lifegain: style B, rising chimes (the user picked it from three options on 2026-11-11): copies 170 ms apart, each pitched up min(2, 9/(N-1)) semitones from the last.
- wipe: the wipe sound mixed over death ×N at -4 dB (no ×2: a wipe is 3+ permanents).
- bighit, playerhit (2026-11-12): as damage's, 110 ms apart ("Added and changed 2026-11-12").

Uploaded 2026-11-11 (re-encoded, mtg2-*); each link was downloaded back and matches its mtg2 file by sha256. On
2026-11-12 the death and wipe bursts were replaced by louder ones and the bighit and playerhit bursts added, uploaded
and checked by sha256 the same way.

| File | Kind | Copies | Link |
|---|---|---|---|
| mtg-bighit-x2.mp3 | bighit | 2 | https://steamusercontent-a.akamaihd.net/ugc/10102534904146116314/FEC357F76AD3BC3E204485638504751C6EA5B3B4/ |
| mtg-bighit-x3.mp3 | bighit | 3 | https://steamusercontent-a.akamaihd.net/ugc/11596786930130643260/0DCA16B265095D18A20987D952273510DE3145BB/ |
| mtg-bighit-x4.mp3 | bighit | 4 | https://steamusercontent-a.akamaihd.net/ugc/16029644423041008713/DBCF6A81CA79412C182C41A9A2EBDC7CFB595643/ |
| mtg-bighit-x6.mp3 | bighit | 6 | https://steamusercontent-a.akamaihd.net/ugc/11089834991395856694/583F01EAB5F918482F28CB6B30208E082AD7F95E/ |
| mtg-bighit-x8.mp3 | bighit | 8 | https://steamusercontent-a.akamaihd.net/ugc/14567024543913859128/655F1FDF1BF798D88ACBA5CC2648E8EB878C4135/ |
| mtg-damage-x2.mp3 | damage | 2 | https://steamusercontent-a.akamaihd.net/ugc/9466119173358429772/2E01C49BC2F53D6B93F512EA0A64749DDA634A13/ |
| mtg-damage-x3.mp3 | damage | 3 | https://steamusercontent-a.akamaihd.net/ugc/17172338814229470186/BA59E9063B3D8BCAB7189038A65371A54F7D222C/ |
| mtg-damage-x4.mp3 | damage | 4 | https://steamusercontent-a.akamaihd.net/ugc/13841800202556732767/F0038F1475AEFEC61821E465C78BC3EC21D80C35/ |
| mtg-damage-x6.mp3 | damage | 6 | https://steamusercontent-a.akamaihd.net/ugc/11502082504506897617/CF4A879844D92A2B54F7C750CD94BB636EE34ED4/ |
| mtg-damage-x8.mp3 | damage | 8 | https://steamusercontent-a.akamaihd.net/ugc/15514955064335890272/27041620B6C22438F8CEE38F4DEA99C3F41E499F/ |
| mtg-death-x2.mp3 | death | 2 | https://steamusercontent-a.akamaihd.net/ugc/16160518566392322538/3D6776DCCE5662B172CD4184F6344747B424BB5D/ |
| mtg-death-x3.mp3 | death | 3 | https://steamusercontent-a.akamaihd.net/ugc/11242284143342103969/869EFC92C49790389FF0AC51C65A2932903FAE7E/ |
| mtg-death-x4.mp3 | death | 4 | https://steamusercontent-a.akamaihd.net/ugc/14108423383041101533/2B7557832A1D8B69BE205F1FA054FD5985C9243C/ |
| mtg-death-x6.mp3 | death | 6 | https://steamusercontent-a.akamaihd.net/ugc/13804901690921610856/0E73D20BEA8004922AC93B72FBC240863778E6D3/ |
| mtg-death-x8.mp3 | death | 8 | https://steamusercontent-a.akamaihd.net/ugc/17462850133371665419/F8E3B2BB340E54993FC37392890ACC457FB1485B/ |
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
| mtg-playerhit-x2.mp3 | playerhit | 2 | https://steamusercontent-a.akamaihd.net/ugc/18385823772406590874/F67603DF33151D56EE4F4918A969DA71AEC93182/ |
| mtg-playerhit-x3.mp3 | playerhit | 3 | https://steamusercontent-a.akamaihd.net/ugc/15674528219804165919/03D2A5F8726309453086C91906045D28E9407290/ |
| mtg-playerhit-x4.mp3 | playerhit | 4 | https://steamusercontent-a.akamaihd.net/ugc/17558314647484330927/633D523AF1FC71C73C7737BA1C2D3D449CF9E983/ |
| mtg-playerhit-x6.mp3 | playerhit | 6 | https://steamusercontent-a.akamaihd.net/ugc/11410730380554930576/B9D76DCEE32CFC1BEBB704F01E34AF4BB66F2409/ |
| mtg-playerhit-x8.mp3 | playerhit | 8 | https://steamusercontent-a.akamaihd.net/ugc/13466691882656356958/8CBA319CD04332BEA45C8976283C9FD7A53C78D6/ |
| mtg-wipe-x3.mp3 | wipe | 3 | https://steamusercontent-a.akamaihd.net/ugc/15886777703497702507/C882FFB1C26BEE20C87791A7135A3FBA1EAD3990/ |
| mtg-wipe-x4.mp3 | wipe | 4 | https://steamusercontent-a.akamaihd.net/ugc/12703812866224761222/8F7B4507EC055B76100A5BF6966D5C085331E6A8/ |
| mtg-wipe-x6.mp3 | wipe | 6 | https://steamusercontent-a.akamaihd.net/ugc/14531756883241499521/4AB4F03063BBA056EE23C175B621BE4FB228DE58/ |
| mtg-wipe-x8.mp3 | wipe | 8 | https://steamusercontent-a.akamaihd.net/ugc/10603921525270560187/08115EEC453EE7937CD5B34288B696512A190D7D/ |
| mtg-treasure-x2.mp3 | treasure | 2 | https://steamusercontent-a.akamaihd.net/ugc/15868461381369419176/37EBD32BFF46E4DAF374B0584104988D185CAECB/ |
| mtg-treasure-x3.mp3 | treasure | 3 | https://steamusercontent-a.akamaihd.net/ugc/10935892306243320307/BEE92BD0A11A258C2FA0FF1FEA68983ADA9E0704/ |
| mtg-treasure-x4.mp3 | treasure | 4 | https://steamusercontent-a.akamaihd.net/ugc/11162875445695134125/A6F396D35E514BC742C366C3BEEE1659194996FF/ |
| mtg-treasure-x6.mp3 | treasure | 6 | https://steamusercontent-a.akamaihd.net/ugc/15126618132993431564/C6E6DBF4D4EE47F136224E7972454024920586D5/ |
| mtg-treasure-x8.mp3 | treasure | 8 | https://steamusercontent-a.akamaihd.net/ugc/11939821030113657645/9783AB64A5F45AA366F0B04BFA3DE3000BB4F0D9/ |
| mtg-treasurespend-x2.mp3 | treasurespend | 2 | https://steamusercontent-a.akamaihd.net/ugc/16741179117198945457/332DF84948C8873AA62F99D31CBF2C360C405502/ |
| mtg-treasurespend-x3.mp3 | treasurespend | 3 | https://steamusercontent-a.akamaihd.net/ugc/16318789669511781064/CD2C89EB01D46E497114BB6B74116E3D3872BB9D/ |
| mtg-treasurespend-x4.mp3 | treasurespend | 4 | https://steamusercontent-a.akamaihd.net/ugc/14925489419790829503/2018FE8940702D166851E72C4A0C10FDF1DC9B59/ |
| mtg-treasurespend-x6.mp3 | treasurespend | 6 | https://steamusercontent-a.akamaihd.net/ugc/13940715731990975781/0C9AC369A768637688F4F7B9F8E63C15037DD563/ |
| mtg-treasurespend-x8.mp3 | treasurespend | 8 | https://steamusercontent-a.akamaihd.net/ugc/9847596886716429556/853FA485628EABEDEBFBBC79BAD5EC2A4BDB311F/ |

## Counter and knockout (made 2026-11-11; knockout uploaded 2026-11-12)

**Since 2026-11-12 only knockout here is the table's.** The `counter` kind takes the user's own "Counter gain" sound
(next section), and `tools/make-effect-sounds.js` now writes its generated counter as `mtg2-counter-generated.mp3`, so a
run can't overwrite the user's.

Made with ffmpeg's own generators by `tools/make-effect-sounds.js`: no downloaded or third-party audio, so they are this
project's work and public domain like the code (`LICENSE`). The noise seeds are fixed: a run makes the same files, byte
for byte. Levelled like the six (-20 dBFS RMS over the sound, peaks under -1 dBFS, 80 ms fade-out), then the TTS recipe
above (padded to 2 s, libmp3lame 192 kbps, ID3v2.3, titles "MTG effect counter" / "MTG effect knockout"). The same
recipe as the 30 that load in TTS; the knockout was uploaded 2026-11-12 but has not been heard in TTS yet.

| File (assets/sounds/tts/) | Kind | Sound | File length | sha256 | Link |
|---|---|---|---|---|---|
| mtg2-counter-generated.mp3 (was mtg2-counter.mp3) | replaced 2026-11-12 by the user's "Counter gain" (below); not to be uploaded | 0.62 s: a soft tick, then two rising bell notes (E6, B6) | 2.00 s (49,601 bytes) | `0b21690e0d7c5373fd082dc8fc0d81dd7a7e9018dd0187a47d2ef5ea8ebbc71a` | none |
| mtg2-knockout.mp3 | a player loses or concedes (`knockout`) | 1.60 s: an explosion (a noise crack, a low rumble, a sub thump falling 80 to 30 Hz) | 2.00 s (49,602 bytes) | `5f45e58c0e0c4f22a57f12b3f2c6e81924f600983ee5ccdb68f8f5653fed1103` | in the first table (`mtg-knockout.mp3`) |

Both files (the knockout and the now unused generated counter) are 2.0 s, so neither needs an `engineSoundLen` entry (the table pauses a clip at its length minus 0.25 s,
1.75 s, after both sounds have ended).

**The links: done 2026-11-12.** The knockout (and the user's counter) were uploaded (TTS → Modding → Cloud Manager),
each link downloaded back and matched to its file by sha256, and put in `engineSounds` (`tools/engine-renderer.lua`)
and the first table above, which `tests/test_table_effects.js` reads. Still to do: deploy, then as the host
`mtg sounds test counter` and `mtg sounds test knockout`.

## Added and changed 2026-11-12 (uploaded 2026-11-12)

The user's requests: four new sounds, and "permanent leaving the battlefield sound needs to be louder, increase 1.5,
same for instant sound".

**What plays when** (the order on a busy board: `docs/m5-effects-design.md` section 6):

| Kind | Plays when | Source file (assets/sounds/) |
|---|---|---|
| `countered` (new) | a spell is countered: the spells the COUNTERED pop-up takes (the bridge's `ctrd` names its card; a permanent spell, an instant or a sorcery, never an ability) | `If a spell is countered.ogg` |
| `counter` (new sound) | a counter put on a permanent, as before | `Counter gain.mp3` (replaces our generated one) |
| `playerhit` (new) | 1 to 5 damage to a player (a player's life going down by 1 to 5 on a board; life paid reads the same, as for damage) | `player damage from pingorbolts pells.ogg` |
| `bighit` (new) | one hit of more than 5: a player's life down by 6 or more, or a creature's damage up by 6 or more, on one board | `Damage from anything over 5.ogg` |
| `damage` (narrower) | damage of 5 or less to a creature. It still counts every hit, so with no playerhit or bighit pick (as before the 2026-11-12 upload) every hit plays damage | (unchanged) |
| `sorcery` (new) | a sorcery resolved, mirroring instant: sorceries only, not abilities, not copies, not one countered, fizzled or exiled from the stack (the bridge's `rsv` on the board names each instant and sorcery that resolved, `k` `sor` or `ins`; since 2026-11-12, the user: "only play if not countered", both played on the cast before) | `sorc cast sound/flac/qubodup-PowerDrain.flac`, reversed and 3x faster |

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

**The files uploaded** (all in `tmp/upload`, also in `assets/sounds/tts`; `tmp/upload` also keeps `mtg-fx.unity3d` and
`mtg2-knockout.mp3` from before, uploaded with them):

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

All 26 were uploaded 2026-11-12 (TTS → Modding → Cloud Manager); each link was downloaded back and matched to its
file by sha256 against the table above. None has been heard in TTS yet (same recipe as the 30 that load).

**The links: done 2026-11-12.** In `engineSounds` (`tools/engine-renderer.lua`): `countered`, `counter`, `playerhit`,
`bighit`, `sorcery`, `playerhit_x2..x8` and `bighit_x2..x8` filled in, the links of `death`, `instant`,
`death_x2..x8` and `wipe_x3..x8` replaced; in this file, the first two tables (12 plain links, 34 bursts), which
`tests/test_table_effects.js` checks against the table's. Still to do: deploy, then as the host
`mtg sounds test countered`, `playerhit`, `bighit`, `sorcery`, `bighit 8`.

## Sorcery remake (2026-11-12 night, uploaded the same night)

The user's picks, in order: the 2026-11-12 sorcery "slowed down by half" (the same-pitch version), "needs like cracking
sound at the end" (crackle take 1), then "a popping sound or small explosion in-between the og sound and crackling"
(pop take 2, "Pop2 wins"). The work files are in `assets/sounds/test/` (gitignored with `assets/`): the filtergraphs
`pop2.txt` and `crackle1.txt`, the mix `pop2.wav`, the result `mtg2-sorcery-new.mp3` (= `tmp/upload3/mtg3-sorcery.mp3`).

- Swell: the first 1.0 s of `mtg2-sorcery.mp3` through `atempo=0.5` (half speed, pitch kept), so 2.0 s.
- Pop (ours, ffmpeg generators, no third-party audio): a boom `sin(2*PI*(38*t+(110/8)*(1-exp(-8*t))))*exp(-t*9)`
  (a sine falling from 148 to 38 Hz), 0.4 s of brown-noise rumble, and a 0.03 s white-noise crack, at 1620 ms.
- Crackle (ours, as above): `crackle1.txt`, at 1780 ms.
- Then the recipe: leading silence removed, cut at 2.215 s, low-passed at 18.6 kHz, -3.2 dB (on target measured on the
  mp3, peak under -1 dBFS), 80 ms fade-out, padded to 2.4 s, libmp3lame 192 kbps, ID3v2.3, title "MTG effect sorcery".

| File | Sound | File length | sha256 |
|---|---|---|---|
| mtg3-sorcery.mp3 | 2.22 s | 2.40 s (59,079 bytes) | `710d548770a41d71f768b4f284c363b0ee30bb9bd2fdd6d0f9dbe020ebd5556f` |

The file is longer than 2 s, so `engineSoundLen.sorcery = 2.4`: the table pauses it at 2.15 s, which takes off the last
65 ms of the fade-out (the crackle is already fading). Uploaded 2026-11-12 night with the effect bundles
(`mtg-fx2.unity3d`, `mtg-bolt.unity3d`); the link was downloaded back and matched by sha256. The old `mtg2-sorcery.mp3`
link stays on the Cloud, unused. Licence: still qubodup's CC-BY-SA 3.0 (the swell); the pop and crackle are ours.

## Treasure (made and uploaded 2026-11-13)

The user: "I want some sounds for treasure tokens". Two kinds, each with bursts x2 x3 x4 x6 x8:

| Kind | Plays when | Source (assets/sounds/treasure/) |
|---|---|---|
| `treasure` | Treasure tokens created: tokens new on the battlefield whose type line has the Treasure subtype (a renamed one counts; a token merely named "Treasure Token" with another type line doesn't); the count is all seats together | `snd_purchase.wav`, "Purchasing Sound Effect" by Spring Spring |
| `treasurespend` | Treasure tokens leaving the battlefield the way a death does (sacrificed for mana, mostly; destroyed too): **in place of** death and wipe, so a Treasure is never counted in either (three spent on one board are a `treasurespend_x3`, not a wipe; a creature dying with a Treasure spent is a `death`, not a `death_x2`). Exiled or bounced Treasures are as before (exile; nothing) | `coins/coin.N.ogg`, "12 Coin Sound Effects" by StarNinjas |

Still one sound per board (`engineSoundKinds`, `docs/m5-effects-design.md` section 6): lifegain > **treasure >
treasurespend** > sorcery > instant > counter, so a creature dying, an exile or a hit on the same board wins, and a
spell that makes Treasures plays the jingle rather than its sorcery or instant sound. The table reads a Treasure from
the board (`FX.isTreasure`, `tools/engine-renderer.lua`: the card's `tok` and its `tl` type line, "Artifact — Treasure";
by Forge's name "Treasure Token" only when there is no type line); the bridge is unchanged. The visuals are unchanged:
a Treasure spent still gets its death smoke (and, 3 or more with the effect bundle, the wipe wave).

**How they were made**: `node tools/make-treasure-sounds.js` (sources in `assets/sounds/treasure/`, gitignored with
`assets/`: `snd_purchase.wav`, `coins_-_starninjas.zip` and its `coins/coin.1.ogg` .. `coin.12.ogg`; output to
`assets/sounds/tts/` and a copy in `tmp/upload4/` to upload). A run on the same sources with the same ffmpeg (9.0.2,
WinGet) makes the same files byte for byte (checked: two runs, the same 12 sha256s).

- Decoded to 44.1 kHz stereo, low-passed at 18.6 kHz (what the mp3 keeps); trimmed from the first sample over -60 dBFS
  to the end of the last 10 ms over -60 dBFS RMS.
- Levelled by loudness on the mp3, not by -20 dBFS RMS: the loudest 400 ms (EBU R128 momentary, M) at -13 LUFS, about
  the median of the table's single sounds (M -11.0 to -15.0, median -12.6), peaks limited to stay under -1 dBFS, never
  by more than 6 dB (bighit took 5.8). The purchase jingle is a few sparse coin hits (-29 dBFS RMS with a 0 dBFS peak):
  -20 dBFS RMS would have taken 8 to 9 dB off its hits, so it stops at the 6 dB cap, M -14.8 LUFS (inside the others'
  range, at their quiet end with knockout). Then an 80 ms fade-out.
- `treasure` bursts: the jingle stacked N times, 110 ms apart with the 2026-11-11 bursts' fixed jitter table, each copy
  1 dB quieter and leaning alternately left and right, each pitched a little (0, +0.6, -0.5, +1.1, -0.9, +0.3, -1.3,
  +0.9 semitones, `asetrate`), so the pile doesn't comb; then scaled so the mp3's peak is under -1 dBFS, no limiter.
- `treasurespend`: coin.1 (the loudest). Its bursts are N different coins, each levelled as above (coin.1, 9, 2, 11,
  3, 7, 8, 10, in that order; coin.2, 7 and 10 reach the 6 dB cap, coin.7 stays at M -20.3, the sixth copy), 80 ms
  apart with the same jitter, 1 dB quieter each, leaning left and right; scaled as the treasure bursts.
- Then the recipe above: padded to 2 s (or the sound + 0.25 s, rounded up to 0.1 s, when that is longer: the table
  pauses a clip 0.25 s before its length), libmp3lame 192 kbps, 44.1 kHz, ID3v2.3, title "MTG effect <name>"
  (`treasure-x3` for a burst).

| File | Sound | File length | Loudness M / I (LUFS) | Limited | sha256 |
|---|---|---|---|---|---|
| mtg2-treasure.mp3 | 1.21 s | 2.00 s (49,602 bytes) | -14.8 / -17.9 | 6.0 dB | `579562921873cef3dc18f9739d1c54206676c2f6d08ea77d02e3495682b706db` |
| mtg2-treasure-x2.mp3 | 1.30 s | 2.00 s (49,605 bytes) | -12.5 / -15.8 | no | `672430b100665fba23e70683b1c1edc1cca83aaa68d423da11f962f02849a831` |
| mtg2-treasure-x3.mp3 | 1.47 s | 2.00 s (49,605 bytes) | -11.3 / -14.9 | no | `313c58508b6331a8d316390bcdd54bcee4faff4cbfc13933e87e4456a72c5585` |
| mtg2-treasure-x4.mp3 | 1.50 s | 2.00 s (49,605 bytes) | -10.9 / -14.9 | no | `e7309167704108ae20749c5e8c65e70781eaf5f644bc37ceafcf824cffc98944` |
| mtg2-treasure-x6.mp3 | 1.76 s | 2.10 s (52,113 bytes) | -11.2 / -14.7 | no | `4a63a2e284cb583056116e27f38e30f4722275ec291f3f986eedbf523a259344` |
| mtg2-treasure-x8.mp3 | 1.98 s | 2.30 s (57,128 bytes) | -11.2 / -14.8 | no | `0a7c789a989ef6d6ecba33f9cf3d59b74934d881357d7fb248d8443b89df69bf` |
| mtg2-treasurespend.mp3 | 0.45 s | 2.00 s (49,607 bytes) | -13.0 / -13.1 | 0.9 dB | `ddf69a1375bfd0294e247004e964dafd4c649e0017051fbed1f6d76ba4af511b` |
| mtg2-treasurespend-x2.mp3 | 0.55 s | 2.00 s (49,610 bytes) | -10.9 / -11.9 | no | `9393b3692c8ca9f75582d6bcd22bdf2dbc3f5424be9fce7565c52d3de689a038` |
| mtg2-treasurespend-x3.mp3 | 0.55 s | 2.00 s (49,610 bytes) | -10.4 / -12.3 | no | `98405a304ef431f1fd45cdb3f687c8cc73db9cee11441bd972c74c5e9029d112` |
| mtg2-treasurespend-x4.mp3 | 0.77 s | 2.00 s (49,610 bytes) | -10.4 / -12.8 | no | `e329020debae67cd44ac0c1ada271932922f9a04ff2048e6ac281b373e10cd1e` |
| mtg2-treasurespend-x6.mp3 | 0.77 s | 2.00 s (49,610 bytes) | -10.3 / -12.4 | no | `7e88821b60c3476848643a4218b837b45722593046f7e6c41429c542af4898d9` |
| mtg2-treasurespend-x8.mp3 | 0.94 s | 2.00 s (49,610 bytes) | -10.3 / -12.4 | no | `2960c99e4504b87cd20cd26bbf2b85462974fdcfbb9e442b5f3c99d635a886a3` |

(The limiting of a burst is its coins'; the bursts themselves were only scaled. treasurespend-x6 and x8 end where x4
does: their later coins are shorter.) `treasure-x6` and `treasure-x8` are longer than 2 s: `engineSoundLen.treasure_x6
= 2.1` and `treasure_x8 = 2.3` (`tests/test_table_effects.js` checks them against this table).

**The links** (uploaded 2026-11-13 through TTS's Cloud Manager; each link downloaded back and matched to its file by the
sha256 above): in `engineSounds` in `tools/engine-renderer.lua` and in the first two tables above (as
`mtg-treasure*.mp3` rows; the files are the mtg2- ones). After a deploy, check as the host with `mtg sounds test
treasure`, `treasurespend`, `treasure 8`, `treasurespend 3`.

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
| knockout (and the generated counter, no longer used) | ours (`tools/make-effect-sounds.js`) | this project | public domain (`LICENSE`) | certain | allowed |
| sorcery (2026-11-12) | "PowerDrain" (`qubodup-PowerDrain.flac`, the user's folder `sorc cast sound/` with its `license.txt`); we reversed it and sped it up 3x, and (remake, 2026-11-12 night) slowed that to half speed at the same pitch and added our own pop and crackle | Iwan 'qubodup' Gabovitch (http://qubodup.net), 2012 | CC-BY-SA 3.0 (the folder's licence.txt is its full text) | certain: the licence and copyright line came with the file | allowed, with attribution and share-alike (below) |
| countered, counter, playerhit, playerhit_x2..x8, bighit, bighit_x2..x8 (2026-11-12) | **unknown**: the user's files `If a spell is countered.ogg`, `Counter gain.mp3`, `player damage from pingorbolts pells.ogg`, `Damage from anything over 5.ogg`, no source pages | ? | ? | — | **not cleared** |
| treasure, treasure_x2..x8 (2026-11-13) | [Purchasing Sound Effect](https://opengameart.org/content/purchasing-sound-effect) (`snd_purchase.wav`, 622,170 bytes, sha256 `091bfc1a3ee7ebd7713636ec631c940b79de715e141856e6c0daf09e8868486e`) | Spring Spring | CC0 | certain: the licence field read on the page, 2026-11-13; downloaded with the user's permission | allowed, no attribution required (credit is a courtesy) |
| treasurespend, treasurespend_x2..x8 (2026-11-13) | [12 Coin Sound Effects](https://opengameart.org/content/12-coin-sound-effects) (the zip, sha256 `3af4ef8dedb45868055dae6c8f1b35daea13d89736e5ac812a9047c0755725ac`; we use coin.1, 2, 3, 7, 8, 9, 10, 11) | StarNinjas ([OpenGameArt profile](https://opengameart.org/users/starninjas), the usual OGA profile address, not opened) | CC0 (the page asks for credit, not required) | certain: the licence field read on the page, 2026-11-13; downloaded with the user's permission | allowed; credit StarNinjas with a link to their profile, as asked |

**Flags.**

- **death and lifegain (and wipe_x3..x8, which mix the death sound in), and since 2026-11-12 countered, counter,
  playerhit and bighit (and their bursts), are not cleared** for a public repo, an itch.io
  release or a Workshop upload: their source and licence are unknown (a 2026-11-12 search of OpenGameArt found no page
  for the death or lifegain filenames; the wobbleboxx pack for lifegain stays an unverified guess, CC0 if right, no
  attribution needed; the original files were not found on disk to compare). The table plays them from the host's Steam Cloud
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
- **CC0 (damage; treasure and treasurespend, 2026-11-13)**: no conditions. StarNinjas ask for credit with a link to
  their OpenGameArt profile: a courtesy, given in the attribution text below.

**Attribution text to add** (once death and lifegain are settled; add their lines the same way):

- `README.md`, "Credits and legal", a new bullet:
  > Sounds: the wipe, instant and exile sounds come from "Spell Sounds Starter Pack" by p0ss
  > (https://opengameart.org/content/spell-sounds-starter-pack), licensed CC-BY-SA 3.0
  > (https://creativecommons.org/licenses/by-sa/3.0/); we trimmed, levelled, padded and stacked them, and our versions
  > are CC-BY-SA 3.0 too. The sorcery sound is "PowerDrain" by Iwan 'qubodup' Gabovitch (http://qubodup.net),
  > CC-BY-SA 3.0; we reversed it, sped it up and levelled it, and our version is CC-BY-SA 3.0 too. The damage sound comes from "37 hits/punches" by Independent.nu
  > (https://opengameart.org/content/37-hitspunches), CC0. The Treasure sounds come from "Purchasing Sound Effect" by
  > Spring Spring (https://opengameart.org/content/purchasing-sound-effect) and "12 Coin Sound Effects" by StarNinjas
  > (https://opengameart.org/content/12-coin-sound-effects), both CC0. The counter and knockout sounds are ours. See
  > docs/sounds.md.

  and the licence line after it: "That covers our code only, not Manabrew, Forge (or our changes to them), the
  Workshop table, the table's sound effects or Magic's cards (see the notices)."
- The Workshop and itch.io descriptions:
  > Sound effects: "Spell Sounds Starter Pack" by p0ss, CC-BY-SA 3.0, https://opengameart.org/content/spell-sounds-starter-pack
  > (edited: trimmed, levelled, stacked; the edited clips are CC-BY-SA 3.0). Hits from "37 hits/punches" by
  > Independent.nu, CC0, https://opengameart.org/content/37-hitspunches. Sorcery: "PowerDrain" by Iwan 'qubodup'
  > Gabovitch, CC-BY-SA 3.0 (edited: reversed, 3x faster, levelled; the edited clip is CC-BY-SA 3.0). Treasure:
  > "Purchasing Sound Effect" by Spring Spring and "12 Coin Sound Effects" by StarNinjas, both CC0, on OpenGameArt.
- `THIRD-PARTY-NOTICES.md`: the rows are in (2026-11-11); the sorcery row (qubodup) and the four not-cleared 2026-11-12 sounds are in too (2026-11-12).
