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

The links are in `engineSounds` in `tools/engine-renderer.lua` (2026-11-11); when each kind plays and which wins on a
busy board: `docs/m5-effects-design.md` section 6. `tests/test_table_effects.js` checks the two lists match.

Licence: OpenGameArt items each carry their own licence (CC0, CC-BY, CC-BY-SA, GPL ...). Before the repo or the table goes public, record each sound's OpenGameArt page, author and licence here and in THIRD-PARTY-NOTICES.md.
