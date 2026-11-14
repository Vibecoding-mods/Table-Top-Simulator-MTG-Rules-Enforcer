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
| mtg-death.mp3 | a permanent goes to the graveyard (`death`; x1.5 louder since 2026-11-12) | 0.90 s | Permanent_and_creature_removal_sound_effect.wav | https://steamusercontent-a.akamaihd.net/ugc/9800569858149488327/8971500EFD07C4FD0BD18D68B8B252405017A5A0/ |
| mtg-wipe.mp3 | several permanents go to the graveyard on one board (`wipe`, new) | 1.60 s | Board_wipe_to_graveyard_sound_effect.ogg (really a WAV) | https://steamusercontent-a.akamaihd.net/ugc/15817545063740906107/206A0FA5435B601208C14BC12289526592275C05/ |
| mtg-damage.mp3 | damage of 5 or less to a creature (`damage`; also every hit if playerhit or bighit has no link) | 0.80 s | hit01.mp3.flac (really FLAC) | https://steamusercontent-a.akamaihd.net/ugc/18394554027578421591/38584ACB11DF0374F06EF58288CC103E1A7BCB17/ |
| mtg-exile.mp3 | a permanent is exiled (`exile`, new) | 1.50 s | Exile_sound_effect.ogg | https://steamusercontent-a.akamaihd.net/ugc/15277917318962835347/67E988768501AE61D76EA0B61CE26CBF7B9047F3/ |
| mtg-instant.mp3 | an instant resolves (not when it is cast, countered, fizzles or is a copy: since 2026-11-12), instants only (`instant`, new; x1.5 louder since 2026-11-12) | 0.90 s | Instant_spell_cast.ogg (really a WAV) | https://steamusercontent-a.akamaihd.net/ugc/12129289638876188200/E4A383D9F0FD11D33AD0C3231ADBDC76640FB6F4/ |
| mtg-lifegain.mp3 | a player gains life (`lifegain`, new) | 1.80 s | Health_gain.aif | https://steamusercontent-a.akamaihd.net/ugc/14589447832811798852/152589A1C8FC457DF750D1F1DA09974B7D4621DC/ |
| mtg-counter.mp3 | a counter is put on a permanent (`counter`, 2026-11-12) | 0.65 s | Counter gain.mp3 (the user's) | https://steamusercontent-a.akamaihd.net/ugc/10198555696183163869/22D514A072E215258BFB7BDD0D94438B93234282/ |
| mtg-knockout.mp3 | a player loses or concedes (`knockout`, 2026-11-12) | 1.60 s | ours, `tools/make-effect-sounds.js` | https://steamusercontent-a.akamaihd.net/ugc/17359985036682352321/876EDEC83B31E9D171B93725698195BD3A60998D/ |
| mtg-countered.mp3 | a spell is countered (`countered`, 2026-11-12) | 1.05 s | If a spell is countered.ogg | https://steamusercontent-a.akamaihd.net/ugc/16224198548986524439/ECC3E042EBA1BBB7F8ACA675DF0D15CDED64151C/ |
| mtg-playerhit.mp3 | 1 to 5 damage to a player (`playerhit`, 2026-11-12) | 0.85 s | player damage from pingorbolts pells.ogg | https://steamusercontent-a.akamaihd.net/ugc/13286146598818442690/A0BF8B16B8001A089539C205ABEA92AD37067A30/ |
| mtg-bighit.mp3 | one hit of more than 5, to a player or a creature (`bighit`, 2026-11-12) | 1.14 s | Damage from anything over 5.ogg | https://steamusercontent-a.akamaihd.net/ugc/10985637461852960373/895695DAAB6E6CFED9309BB61B579480F0019975/ |
| mtg-sorcery.mp3 | a sorcery resolves (not when it is cast, countered, fizzles or is a copy), sorceries only (`sorcery`, 2026-11-12; remade that night, "Sorcery remake" below) | 2.22 s | qubodup-PowerDrain.flac, reversed, 3x faster, then half speed at the same pitch, with our pop and crackle (uploaded as mtg3-sorcery.mp3) | https://steamusercontent-a.akamaihd.net/ugc/17287502999685576865/30550DE1D11406AE8BB4478A926881AD27AC8101/ |
| mtg-treasure.mp3 | Treasure tokens created (`treasure`, 2026-11-13; "Treasure" below) | 1.88 s | gold_sack.wav ("Sack of Gold"), levelled (uploaded as mtg3-treasure.mp3) | https://steamusercontent-a.akamaihd.net/ugc/13794614518614591327/CB0C3DB1DE80ED6670AE453526BC661BD65E285B/ |
| mtg-treasurespend.mp3 | Treasure tokens leaving the battlefield, sacrificed for mana or not, in place of death (`treasurespend`, 2026-11-13) | 0.90 s | the death sound: death's own link (the user's pick, 2026-11-13) | https://steamusercontent-a.akamaihd.net/ugc/9800569858149488327/8971500EFD07C4FD0BD18D68B8B252405017A5A0/ |

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
| mtg-bighit-x2.mp3 | bighit | 2 | https://steamusercontent-a.akamaihd.net/ugc/14501727456834808804/628C139A9EC2F064F0AEBAAEB358CC3F5A40173D/ |
| mtg-bighit-x3.mp3 | bighit | 3 | https://steamusercontent-a.akamaihd.net/ugc/14675707134736660256/DE23EECC399113DB5A8A701388F4602430CE862A/ |
| mtg-bighit-x4.mp3 | bighit | 4 | https://steamusercontent-a.akamaihd.net/ugc/12947269894393077649/85CCD3DCB33516740ABC987287B3377D5A4056A7/ |
| mtg-bighit-x6.mp3 | bighit | 6 | https://steamusercontent-a.akamaihd.net/ugc/10328800220900197571/5E27AF2CFFF991B0299DAE84D956A878410BB649/ |
| mtg-bighit-x8.mp3 | bighit | 8 | https://steamusercontent-a.akamaihd.net/ugc/15836800511667477523/58269293AE3E3564573F65363CB2CD69342DEE7C/ |
| mtg-damage-x2.mp3 | damage | 2 | https://steamusercontent-a.akamaihd.net/ugc/15391021997800247402/7C763CA26C8CD97E1034D2CFDA51E12EF92CF4D4/ |
| mtg-damage-x3.mp3 | damage | 3 | https://steamusercontent-a.akamaihd.net/ugc/11994110290441954314/FEC87CC02628F37F7943AD3E2135796B3AEA9410/ |
| mtg-damage-x4.mp3 | damage | 4 | https://steamusercontent-a.akamaihd.net/ugc/13578099046086566174/4E86F9603540AB189BF84E0AD81053317898F17B/ |
| mtg-damage-x6.mp3 | damage | 6 | https://steamusercontent-a.akamaihd.net/ugc/13086995823088759042/AC30C0C5FB2451996CDA7668D3D0260B2A396E85/ |
| mtg-damage-x8.mp3 | damage | 8 | https://steamusercontent-a.akamaihd.net/ugc/15550604889634791289/8440E3ED39B3788D00E0FA66E873F5D698E0D1B6/ |
| mtg-death-x2.mp3 | death | 2 | https://steamusercontent-a.akamaihd.net/ugc/9883242587509736557/6981B43D6337A0228E5B453184A9B6B4A375C466/ |
| mtg-death-x3.mp3 | death | 3 | https://steamusercontent-a.akamaihd.net/ugc/10436603059024612911/CCB29073C58A677B180E47CF78A95FEBAECDAF43/ |
| mtg-death-x4.mp3 | death | 4 | https://steamusercontent-a.akamaihd.net/ugc/9611064040962894146/B332E6D7EDBD65B4A51C597E8A7765AC9A973232/ |
| mtg-death-x6.mp3 | death | 6 | https://steamusercontent-a.akamaihd.net/ugc/13035548119423571592/E20CCA3DD638DDE3277520B4919AF32372247E4B/ |
| mtg-death-x8.mp3 | death | 8 | https://steamusercontent-a.akamaihd.net/ugc/11027633385360712386/AE3BDE68AC8603D4E63502B86013A24FE3DA3E66/ |
| mtg-exile-x2.mp3 | exile | 2 | https://steamusercontent-a.akamaihd.net/ugc/10685423988775677223/93E9E99CDF836B7D5DA0B5617E9B87FB9A68EF63/ |
| mtg-exile-x3.mp3 | exile | 3 | https://steamusercontent-a.akamaihd.net/ugc/9798376956180430026/5E3EAAE6998CEFF1B80E4FBC73A9180EEF487C51/ |
| mtg-exile-x4.mp3 | exile | 4 | https://steamusercontent-a.akamaihd.net/ugc/15676129596723056222/2E876EFB1AD5BBC1BC6B73559C841AB957FE7682/ |
| mtg-exile-x6.mp3 | exile | 6 | https://steamusercontent-a.akamaihd.net/ugc/12325136851710697223/AF2DC095D2C8A6286940804E26981F83C2B789BD/ |
| mtg-exile-x8.mp3 | exile | 8 | https://steamusercontent-a.akamaihd.net/ugc/15810681250109920267/AB7833248EB102767DE58D9F8CE062C31BEB51FD/ |
| mtg-lifegain-x2.mp3 | lifegain | 2 | https://steamusercontent-a.akamaihd.net/ugc/15339424935138826246/1444B69A779AA728EFDF604E0BDAB87C709BDE2D/ |
| mtg-lifegain-x3.mp3 | lifegain | 3 | https://steamusercontent-a.akamaihd.net/ugc/17719154414524319005/5D58B34080D1067DA20E96974CFE6357539F29A5/ |
| mtg-lifegain-x4.mp3 | lifegain | 4 | https://steamusercontent-a.akamaihd.net/ugc/18102140899015148787/6CD1962F9508D7E9364D090732B8996563A343B6/ |
| mtg-lifegain-x6.mp3 | lifegain | 6 | https://steamusercontent-a.akamaihd.net/ugc/13527528297040637011/4C81282CAC5AA2CAD15ECC4B20BA029E9A8B3CB2/ |
| mtg-lifegain-x8.mp3 | lifegain | 8 | https://steamusercontent-a.akamaihd.net/ugc/14653307058996790132/E8D8FD2B9D8CA49761FDD2729CA52FA035286611/ |
| mtg-playerhit-x2.mp3 | playerhit | 2 | https://steamusercontent-a.akamaihd.net/ugc/15301479630649839933/C414A6E2C196E53148B30626BE78521D1E00843F/ |
| mtg-playerhit-x3.mp3 | playerhit | 3 | https://steamusercontent-a.akamaihd.net/ugc/14011261080340369559/79EC7CD4B9480EE39C2AD12564CE9F76C6CF5067/ |
| mtg-playerhit-x4.mp3 | playerhit | 4 | https://steamusercontent-a.akamaihd.net/ugc/11616489111656235985/EBCE64F9B3D5A01A129CF554713D23F13472BEAC/ |
| mtg-playerhit-x6.mp3 | playerhit | 6 | https://steamusercontent-a.akamaihd.net/ugc/15803660923802238346/33D1A2940FA8EE1CC7B495703D55F8723ECE0399/ |
| mtg-playerhit-x8.mp3 | playerhit | 8 | https://steamusercontent-a.akamaihd.net/ugc/9578969410471442226/6AF64F6E1EBAB1724840868E3C869709EB78AD23/ |
| mtg-wipe-x3.mp3 | wipe | 3 | https://steamusercontent-a.akamaihd.net/ugc/17918509475140877353/A5A47B70A0BA927059446A66327EDFDC6C2CA13B/ |
| mtg-wipe-x4.mp3 | wipe | 4 | https://steamusercontent-a.akamaihd.net/ugc/11527446792693991431/417A49F207E5F1F4E5C5FB1C71B8D476FC83FE4F/ |
| mtg-wipe-x6.mp3 | wipe | 6 | https://steamusercontent-a.akamaihd.net/ugc/9953796201784196604/979D6AC4A3B7413143E6C58F9703F0B52403DBDD/ |
| mtg-wipe-x8.mp3 | wipe | 8 | https://steamusercontent-a.akamaihd.net/ugc/12689661881266718549/61F509DB71B97DED9C31385ECD35D6A24AC92B15/ |
| mtg-treasure-x2.mp3 | treasure | 2 | https://steamusercontent-a.akamaihd.net/ugc/17949130541744455112/65D1E290589FD73EB288EC6907C2FB640ABD6C4C/ |
| mtg-treasure-x3.mp3 | treasure | 3 | https://steamusercontent-a.akamaihd.net/ugc/11666964080657862260/B487C1E5D6DE6F6A9975B6989531CE7F4A4825A7/ |
| mtg-treasure-x4.mp3 | treasure | 4 | https://steamusercontent-a.akamaihd.net/ugc/17660563052074390177/0A4C0DD264A4887F57D1B38252B9F487E82AC155/ |
| mtg-treasure-x6.mp3 | treasure | 6 | https://steamusercontent-a.akamaihd.net/ugc/16507546084760307611/BF94A7AF7BB947FBB9205880D3CC7A8C6B1BE7FD/ |
| mtg-treasure-x8.mp3 | treasure | 8 | https://steamusercontent-a.akamaihd.net/ugc/17585473593631833822/0F6C1788B92B63F4A55DF8342B807AA8276AA49C/ |
| mtg-treasurespend-x2.mp3 | treasurespend | 2 | https://steamusercontent-a.akamaihd.net/ugc/9883242587509736557/6981B43D6337A0228E5B453184A9B6B4A375C466/ |
| mtg-treasurespend-x3.mp3 | treasurespend | 3 | https://steamusercontent-a.akamaihd.net/ugc/10436603059024612911/CCB29073C58A677B180E47CF78A95FEBAECDAF43/ |
| mtg-treasurespend-x4.mp3 | treasurespend | 4 | https://steamusercontent-a.akamaihd.net/ugc/9611064040962894146/B332E6D7EDBD65B4A51C597E8A7765AC9A973232/ |
| mtg-treasurespend-x6.mp3 | treasurespend | 6 | https://steamusercontent-a.akamaihd.net/ugc/13035548119423571592/E20CCA3DD638DDE3277520B4919AF32372247E4B/ |
| mtg-treasurespend-x8.mp3 | treasurespend | 8 | https://steamusercontent-a.akamaihd.net/ugc/11027633385360712386/AE3BDE68AC8603D4E63502B86013A24FE3DA3E66/ |

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

## Treasure (made 2026-11-13; sounds replaced the same day)

The user: "I want some sounds for treasure tokens". Two kinds, each with bursts x2 x3 x4 x6 x8:

| Kind | Plays when | Sound |
|---|---|---|
| `treasure` | Treasure tokens created: tokens new on the battlefield whose type line has the Treasure subtype (a renamed one counts; a token merely named "Treasure Token" with another type line doesn't); the count is all seats together | "Sack of Gold" by Amarikah (`assets/sounds/treasure2/gold_sack.wav`): a sack of coins dropped on a table |
| `treasurespend` | Treasure tokens leaving the battlefield the way a death does (sacrificed for mana, mostly; destroyed too): **in place of** death and wipe, so a Treasure is never counted in either (three spent on one board are a `treasurespend_x3`, not a wipe; a creature dying with a Treasure spent is a `death`, not a `death_x2`). Exiled or bounced Treasures are as before (exile; nothing) | death's own clip and bursts: `treasurespend` and `treasurespend_x2..x8` have death's links |

**Replaced the same day.** The first upload (`treasure` from Spring Spring's "Purchasing Sound Effect", `treasurespend`
from StarNinjas' "12 Coin Sound Effects") didn't please the user: "I didn't really like them". From five CC0 candidates
(previews in `tmp/treasure-preview/`) they chose: "Sack of Gold is perfect for treasure made, then permanent removal
sound for treasure spent". So `treasurespend` keeps its kind (the counting above and its place in the order) and plays
the death sound. Its old files (`mtg2-treasurespend*.mp3`) and the old jingle (`mtg2-treasure*.mp3`) stay on the host's
TTS Cloud, unused.

Still one sound per board (`engineSoundKinds`, `docs/m5-effects-design.md` section 6): lifegain > **treasure >
treasurespend** > sorcery > instant > counter, so a creature dying, an exile or a hit on the same board wins, and a
spell that makes Treasures plays the sack rather than its sorcery or instant sound. The table reads a Treasure from
the board (`FX.isTreasure`, `tools/engine-renderer.lua`: the card's `tok` and its `tl` type line, "Artifact — Treasure";
by Forge's name "Treasure Token" only when there is no type line). Only tokens count: a non-token artifact with the
Treasure subtype (a card that becomes a copy of one, say) is left to the usual death sound, since Treasures are almost
always tokens and `tok` is what keeps a creature-land or animated artifact out; the bridge is unchanged. The visuals are unchanged:
a Treasure spent still gets its death smoke (and, 3 or more with the effect bundle, the wipe wave).

**How they were made**: `node tools/make-treasure-sounds.js` (source `assets/sounds/treasure2/gold_sack.wav`,
gitignored with `assets/`, 729,370 bytes, sha256 `f3f8aaafefa1db77b69a584abd16355f2a04c5c3b24d6551f32a3e042370f958`;
output to `assets/sounds/tts/` and a copy in `tmp/upload5/` to upload). A run on the same source with the same ffmpeg
(9.0.2, WinGet) makes the same files byte for byte (checked: two runs, the same 6 sha256s).

- Decoded to 44.1 kHz stereo, low-passed at 18.6 kHz (what the mp3 keeps); trimmed from the first sample over -60 dBFS
  to the end of the last 10 ms over -60 dBFS RMS.
- Levelled by loudness on the mp3, not by -20 dBFS RMS: the loudest 400 ms (EBU R128 momentary, M) at -13 LUFS, about
  the median of the table's single sounds (M -11.0 to -15.0, median -12.6), peaks limited to stay under -1 dBFS, never
  by more than 6 dB (bighit took 5.8). The sack needed 0.3 dB. Then an 80 ms fade-out.
- Bursts: the sack stacked N times, 110 ms apart with the 2026-11-11 bursts' fixed jitter table, each copy 1 dB quieter
  and leaning alternately left and right, each pitched a little (0, +0.6, -0.5, +1.1, -0.9, +0.3, -1.3, +0.9
  semitones, `asetrate`), so the pile doesn't comb; then scaled so the mp3's peak is under -1 dBFS, no limiter.
- Then the recipe above: padded to 2 s (or the sound + 0.25 s, rounded up to 0.1 s, when that is longer: the table
  pauses a clip 0.25 s before its length), libmp3lame 192 kbps, 44.1 kHz, ID3v2.3, title "MTG effect <name>"
  (`treasure-x3` for a burst). Named mtg3- so they can't be mixed up with the first day's mtg2-treasure uploads.

| File | Sound | File length | Loudness M / I (LUFS) | Limited | sha256 |
|---|---|---|---|---|---|
| mtg3-treasure.mp3 | 1.88 s | 2.20 s (54,617 bytes) | -13.0 / -18.3 | 0.3 dB | `88655c9b15643f23ba69e5c28d5d5a88cc3b8f93346e958ed42c8c502e2f3c4a` |
| mtg3-treasure-x2.mp3 | 1.95 s | 2.20 s (54,620 bytes) | -11.2 / -16.7 | no | `5124dcbc22e09dd161f3c9377f0459481a98835356b9652c5e84f211d8852f26` |
| mtg3-treasure-x3.mp3 | 2.16 s | 2.50 s (61,517 bytes) | -10.9 / -15.7 | no | `fb6c7b3442fcfc8ce12df0712862a7987c91049aaf7eeb2046295a0a75511336` |
| mtg3-treasure-x4.mp3 | 2.16 s | 2.50 s (61,517 bytes) | -10.2 / -15.4 | no | `e06ec809b43bc4b0cfc3c40f4de450bfad980f359abeba1e32d50ce4254ce14c` |
| mtg3-treasure-x6.mp3 | 2.43 s | 2.70 s (66,532 bytes) | -10.0 / -14.1 | no | `4e4b55895ea8eb33d946b36e374ab641bbf8f8fbb79726659bb7bbe7dd3f0352` |
| mtg3-treasure-x8.mp3 | 2.70 s | 3.00 s (73,428 bytes) | -9.8 / -14.1 | no | `6f099d38e157899dc35d8313ed09c6e2b071b9235d19ddb5a2c2131bb3449baa` |

(The limiting of a burst is the sack's; the bursts themselves were only scaled. x3 and x4 end together: the fourth
copy starts early enough, with its jitter, to end inside the third.) All six are longer than 2 s, so each has its length
in `engineSoundLen` (`treasure = 2.2`, `treasure_x2 = 2.2`, `_x3 = 2.5`, `_x4 = 2.5`, `_x6 = 2.7`, `_x8 = 3.0`;
`tests/test_table_effects.js` checks them against this table). `treasurespend*` play death's files, which are all 2 s.

**The links** (the mtg3 files uploaded 2026-11-13 through TTS's Cloud Manager; each link downloaded back and matched to
its file by the sha256 above): in `engineSounds` in `tools/engine-renderer.lua` and in the first two tables above (as
`mtg-treasure*.mp3` rows; the files are the mtg3- ones; the `mtg-treasurespend*.mp3` rows carry death's links). After a
deploy, check as the host with `mtg sounds test treasure`, `treasurespend`, `treasure 8`, `treasurespend 3`.

## The sound bundle (route B, built 2026-11-13; not uploaded, not heard)

The same sounds as one AssetBundle, `mtg-sounds.unity3d` (1,536,075 bytes, sha256
`679c7eceda5901bb99975eace4f186a18c82c44aab8389fc5bc1cb816417d662`): a trigger effect per `engineSounds` key (58), each
the uploaded mp3 of that key with the music player's padding cut off, so it sounds the same through either route. Keys
sharing a link share a clip (`treasurespend*` = death's), 52 clips. Index with every key's clip, length and link:
`docs/fx-research/SOUNDS.md`; how it is made: `docs/m5-assetbundle-build.md` section 4, "Built".

- It changes nothing until it is uploaded, its link is in `engineFxBundle.sounds`, and the host sets
  `engineSoundRoute = "bundle"` (`tools/engine-renderer.lua`; default `"music"`). Then a sound plays as a trigger
  effect of the table's sound object: no music player (no clip title shown, the players' own music never touched, no
  1.5 s minimum, no load wait), heard at TTS's sound-effect level, not the Music slider's (to be checked).
- **A sound changed or added here needs the bundle rebuilt** (`node tools/make-sound-bundle-clips.js`, then the Unity
  build) and uploaded again: `tests/test_table_effects.js` fails while a key's link isn't the one the bundle was built
  from. Until then that key plays its link.
- The licences are the clips' own (below): the bundle carries the same audio as the links, so publishing it is
  publishing them.

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
| treasure, treasure_x2..x8 (2026-11-13, replacing the purchase jingle the same day) | [Sack of Gold](https://opengameart.org/content/sack-of-gold) (`gold_sack.wav`, 729,370 bytes, sha256 `f3f8aaafefa1db77b69a584abd16355f2a04c5c3b24d6551f32a3e042370f958`) | Amarikah | CC0 ("Credit me if you like") | certain: the licence field read on the page, 2026-11-13; downloaded with the user's permission | allowed, no attribution required (credit is a courtesy) |

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
- **CC0 (damage; treasure, 2026-11-13)**: no conditions. Amarikah's page says "Credit me if you like": a courtesy,
  given in the attribution text below. (treasurespend plays the death sound, so it has no source of its own.)

**Attribution text to add** (once death and lifegain are settled; add their lines the same way):

- `README.md`, "Credits and legal", a new bullet:
  > Sounds: the wipe, instant and exile sounds come from "Spell Sounds Starter Pack" by p0ss
  > (https://opengameart.org/content/spell-sounds-starter-pack), licensed CC-BY-SA 3.0
  > (https://creativecommons.org/licenses/by-sa/3.0/); we trimmed, levelled, padded and stacked them, and our versions
  > are CC-BY-SA 3.0 too. The sorcery sound is "PowerDrain" by Iwan 'qubodup' Gabovitch (http://qubodup.net),
  > CC-BY-SA 3.0; we reversed it, sped it up and levelled it, and our version is CC-BY-SA 3.0 too. The damage sound comes from "37 hits/punches" by Independent.nu
  > (https://opengameart.org/content/37-hitspunches), CC0. The Treasure sound comes from "Sack of Gold" by Amarikah
  > (https://opengameart.org/content/sack-of-gold), CC0. The counter and knockout sounds are ours. See
  > docs/sounds.md.

  and the licence line after it: "That covers our code only, not Manabrew, Forge (or our changes to them), the
  Workshop table, the table's sound effects or Magic's cards (see the notices)."
- The Workshop and itch.io descriptions:
  > Sound effects: "Spell Sounds Starter Pack" by p0ss, CC-BY-SA 3.0, https://opengameart.org/content/spell-sounds-starter-pack
  > (edited: trimmed, levelled, stacked; the edited clips are CC-BY-SA 3.0). Hits from "37 hits/punches" by
  > Independent.nu, CC0, https://opengameart.org/content/37-hitspunches. Sorcery: "PowerDrain" by Iwan 'qubodup'
  > Gabovitch, CC-BY-SA 3.0 (edited: reversed, 3x faster, levelled; the edited clip is CC-BY-SA 3.0). Treasure:
  > "Sack of Gold" by Amarikah, CC0, https://opengameart.org/content/sack-of-gold.
- `THIRD-PARTY-NOTICES.md`: the rows are in (2026-11-11); the sorcery row (qubodup) and the four not-cleared 2026-11-12 sounds are in too (2026-11-12).
