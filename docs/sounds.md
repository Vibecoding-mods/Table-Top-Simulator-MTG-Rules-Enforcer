# Table sound effects

Six sounds the user supplied on 2026-11-11, from OpenGameArt. Each was trimmed to where its sound ends, given an 80 ms fade-out, levelled to about -20 dBFS RMS (peaks under -1 dBFS), and encoded as 160 kbps mp3 with VLC. They were uploaded to the host's TTS Cloud (Steam Cloud); the links below are what the table plays (each link was downloaded back and matches the file here byte for byte).

| File | Plays when | Length | Original file | Link |
|---|---|---|---|---|
| mtg-death.mp3 | a permanent goes to the graveyard (`death`) | 0.90 s | Permanent_and_creature_removal_sound_effect.wav | https://steamusercontent-a.akamaihd.net/ugc/13335260803010380839/1E14C1BED86C409D90C135F65EBDC64865EE933A/ |
| mtg-wipe.mp3 | several permanents go to the graveyard on one board (`wipe`, new) | 1.60 s | Board_wipe_to_graveyard_sound_effect.ogg (really a WAV) | https://steamusercontent-a.akamaihd.net/ugc/17690707824716063746/6E5813D75AA66D8CD6810895220FAEB28E263475/ |
| mtg-damage.mp3 | damage to a creature or a player (`damage`) | 0.80 s | hit01.mp3.flac (really FLAC) | https://steamusercontent-a.akamaihd.net/ugc/10138799039655438681/650E0A0D5A0BEBE37070522BB3800524F10D371E/ |
| mtg-exile.mp3 | a permanent is exiled (`exile`, new) | 1.50 s | Exile_sound_effect.ogg | https://steamusercontent-a.akamaihd.net/ugc/14014286229650325084/49ED44FAD77D7F67A1C341ABACE74BD605EF9105/ |
| mtg-instant.mp3 | an instant is cast, instants only (`instant`, new) | 0.90 s | Instant_spell_cast.ogg (really a WAV) | https://steamusercontent-a.akamaihd.net/ugc/15164427569377747897/03BA2225589A63582420E6520B2A64610D7023DC/ |
| mtg-lifegain.mp3 | a player gains life (`lifegain`, new) | 1.80 s | Health_gain.aif | https://steamusercontent-a.akamaihd.net/ugc/16916532848789661739/9D8BF0DEB5A473A8542DA200400DE7F5BED9FD17/ |

No sound yet for `counter` and `knockout`.

## Bursts (stacked copies)

TTS's music player plays one clip at a time, so a sound can't overlap itself live. For drama when many things happen at once, each burst below is the same sound stacked N times, pre-mixed offline (files in assets/sounds/stack, gitignored). The table picks the largest bucket that is no more than the count, capped at ×8, and still plays one sound per board, so a runaway turn (exponential life gain or damage) never plays more than one ×8 clip per update.

- damage, death, exile: N copies about 110–170 ms apart with a little timing jitter, each 1 dB quieter than the one before, leaning alternately left and right.
- lifegain: style B, rising chimes (the user picked it from three options on 2026-11-11): copies 170 ms apart, each pitched up min(2, 9/(N-1)) semitones from the last.
- wipe: the wipe sound mixed over death ×N at -4 dB (no ×2: a wipe is 3+ permanents).

Uploaded 2026-11-11; each link was downloaded back and matches its file byte for byte.

| File | Kind | Copies | Link |
|---|---|---|---|
| mtg-damage-x2.mp3 | damage | 2 | https://steamusercontent-a.akamaihd.net/ugc/10464557751799177862/6F604E2D78E13AB28FEBC5365863C687C796F239/ |
| mtg-damage-x3.mp3 | damage | 3 | https://steamusercontent-a.akamaihd.net/ugc/14646174326618084878/B7B9F21BC50D5E77C3081552AC58242841577AF8/ |
| mtg-damage-x4.mp3 | damage | 4 | https://steamusercontent-a.akamaihd.net/ugc/9351534476505836294/236EDE0011031CBB94EDF1613D761474A24A2D3E/ |
| mtg-damage-x6.mp3 | damage | 6 | https://steamusercontent-a.akamaihd.net/ugc/13449254694931788186/FA9521F10BC3E7A46DA69BE4F431541FD2F39C16/ |
| mtg-damage-x8.mp3 | damage | 8 | https://steamusercontent-a.akamaihd.net/ugc/14737365083111146855/D2F838CEDC686E6D93F21C996574C33BB705AF3A/ |
| mtg-death-x2.mp3 | death | 2 | https://steamusercontent-a.akamaihd.net/ugc/10326323065763527521/EA38AB1FC609CE2C42F13FBAF79FD818B7BFCFD5/ |
| mtg-death-x3.mp3 | death | 3 | https://steamusercontent-a.akamaihd.net/ugc/13313831614403357901/CF123A24123CF12F59427C21BCA3C9234733AC89/ |
| mtg-death-x4.mp3 | death | 4 | https://steamusercontent-a.akamaihd.net/ugc/10465797950542334211/35EE9C33A9E836F9B15A40D8455859C5DCDAAFF0/ |
| mtg-death-x6.mp3 | death | 6 | https://steamusercontent-a.akamaihd.net/ugc/11367279803241106197/7F36B299A54543D916642787DDB8066FF5488631/ |
| mtg-death-x8.mp3 | death | 8 | https://steamusercontent-a.akamaihd.net/ugc/16534043275915652105/422141011FDF045A8A216AB280514DFB724BCBDB/ |
| mtg-exile-x2.mp3 | exile | 2 | https://steamusercontent-a.akamaihd.net/ugc/18134726240279761771/DDF33868C453B42AD07594906B14725741300E88/ |
| mtg-exile-x3.mp3 | exile | 3 | https://steamusercontent-a.akamaihd.net/ugc/17124698296492267129/D0629EEAB2E518B30F1B3AD6BA8DCF86913710B8/ |
| mtg-exile-x4.mp3 | exile | 4 | https://steamusercontent-a.akamaihd.net/ugc/14375190080245899306/BE4BCB4D6AE2B42B1FF3D1FBEB185F677B22D761/ |
| mtg-exile-x6.mp3 | exile | 6 | https://steamusercontent-a.akamaihd.net/ugc/12258183096129809973/EADEC21E0C1D9F290E2D10D02229B5DB47E61E93/ |
| mtg-exile-x8.mp3 | exile | 8 | https://steamusercontent-a.akamaihd.net/ugc/15949197280932033623/D971BE8657ACAEB5DF3E706FC2792E8EC45EEA9A/ |
| mtg-lifegain-x2.mp3 | lifegain | 2 | https://steamusercontent-a.akamaihd.net/ugc/17398558531396792153/66093C9877C8157C9362369D52541BB6A734A11F/ |
| mtg-lifegain-x3.mp3 | lifegain | 3 | https://steamusercontent-a.akamaihd.net/ugc/10317449226036305238/4CF0CB7E864ADC8BD98C556D8DE3314208F3C3D1/ |
| mtg-lifegain-x4.mp3 | lifegain | 4 | https://steamusercontent-a.akamaihd.net/ugc/16471321033526055880/DC9083C8464614F3BB035BBE86E339F7CF66672D/ |
| mtg-lifegain-x6.mp3 | lifegain | 6 | https://steamusercontent-a.akamaihd.net/ugc/18356686289443692221/59BF083D94030A873E7BED102E6107285572167D/ |
| mtg-lifegain-x8.mp3 | lifegain | 8 | https://steamusercontent-a.akamaihd.net/ugc/10727762465393289889/3B94CA05E39CDF14444FA3BCE7F5859369C935A9/ |
| mtg-wipe-x3.mp3 | wipe | 3 | https://steamusercontent-a.akamaihd.net/ugc/10435153874502213849/AA66275AB4AEB5700643BCE8DA9FD47B08C6136B/ |
| mtg-wipe-x4.mp3 | wipe | 4 | https://steamusercontent-a.akamaihd.net/ugc/15470057286996991259/958B340B8F7631AFFAEB9B2EB2929CA0538D9731/ |
| mtg-wipe-x6.mp3 | wipe | 6 | https://steamusercontent-a.akamaihd.net/ugc/13452053024172624536/F0F019A93DA593EE8EC97D29B264D2FFA2B7FD08/ |
| mtg-wipe-x8.mp3 | wipe | 8 | https://steamusercontent-a.akamaihd.net/ugc/17828740702280774733/DBA473F3AFA40D27F786436729D47740B38441AE/ |

Licence: OpenGameArt items each carry their own licence (CC0, CC-BY, CC-BY-SA, GPL ...). Before the repo or the table goes public, record each sound's OpenGameArt page, author and licence here and in THIRD-PARTY-NOTICES.md.
