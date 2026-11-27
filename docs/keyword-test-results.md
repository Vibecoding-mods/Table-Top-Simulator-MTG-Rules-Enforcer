# Keyword test results

## Recheck after the table fixes (2026-10-20)

Every keyword the first pass flagged (PROBLEM, seen, not drawn or no card) was replayed headless (tools/headless-coverage.sh: the table's Global script in a fake TTS, a second bridge, White on the autoplay against Errant, Street Artist with 99 Islands, decks with tutors added by tools/make-keyword-decks-small.js), in three rounds (t1-t3). Engine errors 0, TTS errors 0.

Played now: 42 of 47. Table problems on those cards: 0.

Still not played (situational, the autoplay never sets them up): Enrage, Spree, Fight, Aftermath, Fuse. These go to the scripted check `bash tools/rules-check.sh keywords` (bridge/rules-check.js --game keywords), which casts each one on purpose.

**Scripted check (2026-10-20):** `bash tools/rules-check.sh keywords` casts each on purpose. In the last 3 runs (0 engine errors in each): Aftermath (Cut, then Ribbons from the graveyard) 3/3, Fuse ("Cast Turn // Burn", offered only once both halves can be paid) 3/3, Enrage (Apex Altisaur) 3/3, Fight (Bridgeworks Battle) 3/3, Spree (Return the Favor copying Shock) 2/3 (one game never had it, Shock and the mana together). So all 47 flagged keywords are now played through the engine.

| Keyword | First pass | Recheck | Round | Evidence |
|---|---|---|---|---|
| Adamant | PROBLEM | played | t1 | White uses Desecrate Reality's ability |
| Airbend | PROBLEM | played | t2 | White uses Avatar's Wrath's ability |
| Behold | PROBLEM | played | t2 | White casts Champions of the Perfect |
| Blight | PROBLEM | played | t2 | High Perfect Morcant enters the battlefield (White) |
| Bloodrush | PROBLEM | played | t2 | White casts Wasteland Viper |
| Cloak | PROBLEM | played | t2 | White uses Unexplained Absence's ability |
| Commander ninjutsu | PROBLEM | played | t2 | White casts Yuriko, the Tiger's Shadow |
| Cycling | PROBLEM | played | t2 | White plays Ash Barrens |
| Delve | PROBLEM | played | t1 | White uses Dig Through Time's ability |
| Dethrone | PROBLEM | played | t2 | White casts Scourge of the Throne |
| Devoid | PROBLEM | played | t2 | White casts Sowing Mycospawn |
| Entwine | PROBLEM | played | t2 | White uses Tooth and Nail's ability |
| Escalate | PROBLEM | played | t1 | White uses Collective Resistance's ability |
| Evolve | PROBLEM | played | t2 | White casts Gyre Sage |
| Exalted | PROBLEM | played | t2 | White casts Ignoble Hierarch |
| Exhaust | PROBLEM | played | t1 | White casts Riverchurn Monument |
| First strike | PROBLEM | played | t2 | White casts Knight of the White Orchid |
| Flashback | PROBLEM | played | t1 | White uses Faithless Looting's ability |
| Graft | PROBLEM | played | t1 | White plays Llanowar Reborn |
| Hexproof from | PROBLEM | played | t2 | White casts Volatile Stormdrake |
| More Than Meets the Eye | PROBLEM | played | t1 | White casts Slicer, Hired Muscle |
| Mountainwalk | PROBLEM | played | t1 | White casts Dwarven Grunt |
| Offering | PROBLEM | played | t2 | White casts Blast-Furnace Hellkite |
| Outlast | PROBLEM | played | t1 | White casts Abzan Falconer |
| Pack tactics | PROBLEM | played | t2 | White casts Battle Cry Goblin |
| Paradox | PROBLEM | played | t2 | White casts Flaming Tyrannosaurus |
| Partner | PROBLEM | played | t2 | White casts Kodama of the East Tree |
| Populate | PROBLEM | played | t2 | Rootborn Defenses enters the battlefield (White) |
| Power-up | PROBLEM | played | t2 | White casts Human Torch, Johnny Storm |
| Prowl | PROBLEM | played | t1 | White uses Notorious Throng's ability |
| Renown | PROBLEM | played | t2 | White casts Relic Seeker |
| Retrace | PROBLEM | played | t1 | White casts Throes of Chaos |
| Revolt | PROBLEM | played | t3 | White uses Fatal Push's ability |
| Sweep | PROBLEM | played | t2 | White uses Barrel Down Sokenzan's ability |
| Teamwork | PROBLEM | played | t1 | White uses HULK SMASH!'s ability |
| Tiered | PROBLEM | played | t1 | White uses Restoration Magic's ability |
| Undergrowth | PROBLEM | played | t2 | White casts Izoni, Thousand-Eyed |
| Council's dilemma | seen | played | t2 | White uses Expropriate's ability |
| Eminence | seen | played | t3 | White casts The Ur-Dragon |
| Manifest dread | seen | played | t2 | White uses Abhorrent Oculus's ability |
| Paradigm | seen | played | t2 | White uses Improvisation Capstone's ability |
| Triple | seen | played | t1 | White casts Fiery Emancipation |
| Enrage | PROBLEM | seen | t1 | White saw: Look at these cards (player-view-0's library): Rootborn Defenses, Forest, Grim  |
| Spree | PROBLEM | seen | t1 | White saw: Look at these cards (player-view-0's library): Mountain, Island, Vampiric Tutor |
| Fight | not drawn | seen | t1 | Bridgeworks Battle is put into White's graveyard |
| Aftermath | no card Forge knows | seen | t1 | Cut // Ribbons is put into White's graveyard |
| Fuse | no card Forge knows | seen | t1 | White saw: Look at these cards (player-view-0's library): Mountain, Island, Vampiric Tutor |

## First pass (before the fixes)

Games: 82 keyword decks (tools/make-keyword-decks.js), White on the bug-hunting autoplay vs 1 Forge AI, checked against the engine every step.

Played: 279 · Seen but not played by White: 5 · Not drawn: 1 · Problems: 39 · No card: 2

| Keyword | Test card | Result | Evidence |
|---|---|---|---|
| Adamant | Desecrate Reality | PROBLEM | turn 18 main1 [step 50]: missing object: Desecrate Reality (White graveyard) |
| Airbend | Avatar's Wrath | PROBLEM | turn 11 endOfTurn [step 29]: missing object: Avatar's Wrath (Red exile) [obj=nil spawning=nil inPile=true held=nil inHan |
| Behold | Champions of the Perfect | PROBLEM | turn 16 main1 [step 43]: missing object: Champions of the Perfect (White graveyard) |
| Blight | High Perfect Morcant | PROBLEM | turn 14 combatDamage [step 46]: missing object: High Perfect Morcant (White graveyard) [obj=nil spawning=nil inPile=true |
| Bloodrush | Wasteland Viper | PROBLEM | turn 24 main1 [step 89]: missing object: Wasteland Viper (White hand) [obj=nil spawning=nil inPile=nil held=nil inHand=n |
| Cloak | Unexplained Absence | PROBLEM | turn 14 upkeep [step 40]: missing object: Unexplained Absence (White graveyard) [obj=nil spawning=nil inPile=true held=3 |
| Commander ninjutsu | Yuriko, the Tiger's Shadow | PROBLEM | turn 7 combatDamage [step 8]: Yuriko, the Tiger's Shadow (Red battlefield) should be tapped |
| Cycling | Ash Barrens | PROBLEM | turn 5 main1 [step 6]: missing object: Ash Barrens (White hand) [obj=nil spawning=nil inPile=nil held=nil inHand=nil zon |
| Delve | Dig Through Time | PROBLEM | turn 22 main2 [step 96]: missing object: Dig Through Time (Red graveyard) |
| Dethrone | Scourge of the Throne | PROBLEM | turn 23 main1 [step 100]: missing object: Scourge of the Throne (White graveyard) |
| Devoid | Sowing Mycospawn | PROBLEM | turn 7 main1 [step 7]: wrong place: Sowing Mycospawn (White hand) at (21.4,3.4,-15.4) |
| Enrage | Apex Altisaur | PROBLEM | turn 16 main1 [step 43]: missing object: Apex Altisaur (White graveyard) |
| Entwine | Tooth and Nail | PROBLEM | turn 36 main2 [step 78]: wrong place: Tooth and Nail (White hand) at (20.8,1.0,-13.0) |
| Escalate | Collective Resistance | PROBLEM | turn 23 main1 [step 66]: wrong place: Collective Resistance (White hand) at (19.4,1.0,-15.4) |
| Evolve | Gyre Sage | PROBLEM | turn 14 main1 [step 17]: missing object: Gyre Sage (White hand) [obj=nil spawning=nil inPile=nil held=nil inHand=nil zon |
| Exalted | Ignoble Hierarch | PROBLEM | turn 10 main1 [step 9]: missing object: Ignoble Hierarch (White hand) [obj=nil spawning=nil inPile=true held=nil inHand= |
| Exhaust | Riverchurn Monument | PROBLEM | turn 21 main1 [step 63]: missing object: Riverchurn Monument (White hand) [obj=nil spawning=nil inPile=nil held=nil inHa |
| First strike | Knight of the White Orchid | PROBLEM | turn 20 main1 [step 40]: missing object: Knight of the White Orchid (White graveyard) |
| Flashback | Faithless Looting | PROBLEM | turn 19 main1 [step 68]: missing object: Faithless Looting (Red graveyard) [obj=nil spawning=nil inPile=true held=nil in |
| Graft | Llanowar Reborn | PROBLEM | turn 19 main1 [step 52]: missing object: Llanowar Reborn (White hand) [obj=nil spawning=nil inPile=true held=nil inHand= |
| Hexproof from | Volatile Stormdrake | PROBLEM | turn 8 main1 [step 12]: wrong place: Volatile Stormdrake (Red battlefield) at (14.7,1.0,-14.8) |
| More Than Meets the Eye | Slicer, Hired Muscle | PROBLEM | turn 12 main2 [step 17]: wrong place: Slicer, Hired Muscle (Red battlefield) at (24.4,1.0,-16.2) |
| Mountainwalk | Dwarven Grunt | PROBLEM | turn 9 combatDeclareBlockers [step 15]: wrong place: Dwarven Grunt (Red battlefield) at (13.1,1.0,-12.3) |
| Offering | Blast-Furnace Hellkite | PROBLEM | turn 8 main1 [step 5]: missing object: Blast-Furnace Hellkite (White hand) [obj=nil spawning=nil inPile=true held=nil in |
| Outlast | Abzan Falconer | PROBLEM | turn 10 main1 [step 19]: missing object: Abzan Falconer (White hand) [obj=nil spawning=nil inPile=true held=nil inHand=n |
| Pack tactics | Battle Cry Goblin | PROBLEM | turn 10 main1 [step 6]: missing object: Battle Cry Goblin (White hand) [obj=nil spawning=nil inPile=true held=nil inHand |
| Paradox | Flaming Tyrannosaurus | PROBLEM | turn 7 main1 [step 14]: missing object: Flaming Tyrannosaurus (White hand) |
| Partner | Kodama of the East Tree | PROBLEM | turn 20 main1 [step 40]: missing object: Kodama of the East Tree (White graveyard) |
| Populate | Rootborn Defenses | PROBLEM | turn 10 main1 [step 17]: missing object: Rootborn Defenses (White hand) |
| Power-up | Human Torch, Johnny Storm | PROBLEM | turn 12 main1 [step 14]: missing object: Human Torch, Johnny Storm (White hand) [obj=nil spawning=nil inPile=true held=n |
| Prowl | Notorious Throng | PROBLEM | turn 5 main1 [step 7]: missing object: Notorious Throng (White hand) |
| Renown | Relic Seeker | PROBLEM | turn 16 main1 [step 45]: wrong place: Relic Seeker (Red battlefield) at (15.9,1.1,-12.1) |
| Retrace | Throes of Chaos | PROBLEM | turn 14 main2 [step 33]: wrong place: Throes of Chaos (White graveyard) at (21.4,3.4,-15.4) |
| Revolt | Fatal Push | PROBLEM | Fatal Push?" |
| Spree | Return the Favor | PROBLEM | turn 9 upkeep [step 13]: wrong place: Return the Favor (White hand) at (7.0,1.0,-19.6) |
| Sweep | Barrel Down Sokenzan | PROBLEM | turn 6 main1 [step 7]: missing object: Barrel Down Sokenzan (White hand) |
| Teamwork | HULK SMASH! | PROBLEM | turn 14 main1 [step 47]: wrong place: HULK SMASH! (White hand) at (27.6,1.0,-13.3) |
| Tiered | Restoration Magic | PROBLEM | turn 10 main1 [step 8]: wrong place: Restoration Magic (White hand) at (19.4,1.0,-15.4) |
| Undergrowth | Izoni, Thousand-Eyed | PROBLEM | turn 12 main1 [step 34]: missing object: Izoni, Thousand-Eyed (White hand) |
| Adapt | Incubation Druid | played | White casts Incubation Druid |
| Addendum | Unbreakable Formation | played | White uses Unbreakable Formation's ability |
| Affinity | Emry, Lurker of the Loch | played | White casts Emry, Lurker of the Loch |
| Afflict | Neheb, the Eternal | played | White casts Neheb, the Eternal |
| Afterlife | Tithe Taker | played | White casts Tithe Taker |
| Alliance | Witty Roastmaster | played | White casts Witty Roastmaster |
| Amass | Orcish Bowmasters | played | White casts Orcish Bowmasters |
| Amplify | Kilnmouth Dragon | played | White casts Kilnmouth Dragon |
| Annihilator | Kozilek, Butcher of Truth | played | White casts Kozilek, Butcher of Truth |
| Ascend | Wayward Swordtooth | played | Wayward Swordtooth enters the battlefield (White) |
| Assemble | Steamflogger Boss | played | White casts Steamflogger Boss |
| Assist | Game Plan | played | White uses Game Plan's ability |
| Aura Swap | Arcanum Wings | played | White casts Arcanum Wings |
| Awaken | Part the Waterveil | played | White uses Part the Waterveil's ability |
| Backup | Archpriest of Shadows | played | White casts Archpriest of Shadows |
| Banding | Benalish Hero | cast only: no band can be formed in an attack (HP12 finding 4, open) | White casts Benalish Hero |
| Bargain | Beseech the Mirror | played | White uses Beseech the Mirror's ability |
| Basic landcycling | Migratory Route | played | White uses Migratory Route's ability |
| Battalion | Frontline Medic | played | White casts Frontline Medic |
| Battle Cry | Hero of Bladehold | played | White casts Hero of Bladehold |
| Bestow | Springheart Nantuko | played | White casts Springheart Nantuko |
| Blitz | Jaxis, the Troublemaker | played | White casts Jaxis, the Troublemaker |
| Bloodthirst | Indoraptor, the Perfect Hybrid | played | White casts Indoraptor, the Perfect Hybrid |
| Boast | Varragoth, Bloodsky Sire | played | White casts Varragoth, Bloodsky Sire |
| Bolster | Anafenza, Kin-Tree Spirit | played | White casts Anafenza, Kin-Tree Spirit |
| Bushido | Jade Avenger | played | White casts Jade Avenger |
| Buyback | Constant Mists | played | White uses Constant Mists's ability |
| Cascade | Apex Devastator | played | White casts Apex Devastator |
| Casualty | Cut Your Losses | played | White uses Cut Your Losses's ability |
| Celebration | Raging Battle Mouse | played | White casts Raging Battle Mouse |
| Champion | Wanderwine Prophets | played | White casts Wanderwine Prophets |
| Changeling | Realmwalker | played | White casts Realmwalker |
| Channel | Boseiju, Who Endures | played | White plays Boseiju, Who Endures |
| Choose a background | Jaheira, Friend of the Forest | played | White casts Jaheira, Friend of the Forest |
| Chroma | Springjack Shepherd | played | White casts Springjack Shepherd |
| Cipher | Whispering Madness | played | White uses Whispering Madness's ability |
| Clash | Marvo, Deep Operative | played | White casts Marvo, Deep Operative |
| Cleave | Wash Away | played | White uses Wash Away's ability |
| Cohort | Munda's Vanguard | played | White casts Munda's Vanguard |
| Collect evidence | Analyze the Pollen | played | White uses Analyze the Pollen's ability |
| Companion | Lurrus of the Dream-Den | played | White casts Lurrus of the Dream-Den |
| Compleated | Vraska, Betrayal's Sting | played | White casts Vraska, Betrayal's Sting |
| Connive | Ledger Shredder | played | White casts Ledger Shredder |
| Conspire | Rally the Galadhrim | played | White uses Rally the Galadhrim's ability |
| Constellation | Eidolon of Blossoms | played | White casts Eidolon of Blossoms |
| Converge | Painful Truths | played | White uses Painful Truths's ability |
| Convert | Starscream, Power Hungry | played | White casts Starscream, Power Hungry |
| Convoke | Chord of Calling | played | White uses Chord of Calling's ability |
| Corrupted | Skrelv's Hive | played | White casts Skrelv's Hive |
| Coven | Augur of Autumn | played | White casts Augur of Autumn |
| Craft | Tithing Blade | played | White casts Tithing Blade |
| Crew | Hedge Shredder | played | White casts Hedge Shredder |
| Cumulative upkeep | Mystic Remora | played | White casts Mystic Remora |
| Dash | Ragavan, Nimble Pilferer | played | White casts Ragavan, Nimble Pilferer |
| Daybound | Tovolar, Dire Overlord | played | White casts Tovolar, Dire Overlord |
| Deathtouch | Baleful Strix | played | White casts Baleful Strix |
| Decayed | Rot-Curse Rakshasa | played | White casts Rot-Curse Rakshasa |
| Defender | Crashing Drawbridge | played | White casts Crashing Drawbridge |
| Delirium | Shifting Woodland | played | White plays Shifting Woodland |
| Demonstrate | Incarnation Technique | played | White uses Incarnation Technique's ability |
| Desertwalk | Hazezon, Shaper of Sand | played | White casts Hazezon, Shaper of Sand |
| Detain | Tax Collector | played | White casts Tax Collector |
| Devour | Mycoloth | played | White casts Mycoloth |
| Disappear | Rat King, Verminister | played | White casts Rat King, Verminister |
| Discover | Chimil, the Inner Sun | played | White casts Chimil, the Inner Sun |
| Disguise | Bayek of Siwa | played | White casts Bayek of Siwa |
| Disturb | Lunarch Veteran | played | White casts Lunarch Veteran |
| Doctor's companion | K-9, Mark I | played | White casts K-9, Mark I |
| Domain | Scion of Draco | played | White casts Scion of Draco |
| Double | Unnatural Growth | played | White casts Unnatural Growth |
| Double strike | Lizard Blades | played | White casts Lizard Blades |
| Dredge | Life from the Loam | played | White uses Life from the Loam's ability |
| Earthbend | Badgermole Cub | played | White casts Badgermole Cub |
| Echo | Karmic Guide | played | White uses Karmic Guide's ability |
| Eerie | Entity Tracker | played | White casts Entity Tracker |
| Embalm | Vizier of Many Faces | played | White casts Vizier of Many Faces |
| Emerge | Herigast, Erupting Nullkite | played | White casts Herigast, Erupting Nullkite |
| Empower Jace | Fatehold Charm | played | White uses Fatehold Charm's ability |
| Enchant | Wild Growth | played | White casts Wild Growth |
| Encore | Impulsive Pilferer | played | White casts Impulsive Pilferer |
| Endure | Warden of the Grove | played | White casts Warden of the Grove |
| Enlist | Yavimaya Steelcrusher | played | White casts Yavimaya Steelcrusher |
| Epic | Eternal Dominion | played | White uses Eternal Dominion's ability |
| Equip | Swiftfoot Boots | played | White casts Swiftfoot Boots |
| Escape | Uro, Titan of Nature's Wrath | played | White casts Uro, Titan of Nature's Wrath |
| Eternalize | Fanatic of Rhonas | played | White casts Fanatic of Rhonas |
| Evoke | Mulldrifter | played | White casts Mulldrifter |
| Exert | Arena of Glory | played | White plays Arena of Glory |
| Exploit | Sidisi, Undead Vizier | played | White casts Sidisi, Undead Vizier |
| Explore | Get Lost | played | White uses Get Lost's ability |
| Extort | Blind Obedience | played | White casts Blind Obedience |
| Fabricate | Marionette Apprentice | played | White casts Marionette Apprentice |
| Fading | Tangle Wire | played | White casts Tangle Wire |
| Fateful hour | Courageous Resolve | played | White uses Courageous Resolve's ability |
| Fateseal | Mesmeric Sliver | played | White casts Mesmeric Sliver |
| Fathomless descent | Matzalantli, the Great Door | played | White casts Matzalantli, the Great Door |
| Fear | Shriekmaw | played | White casts Shriekmaw |
| Ferocious | Shamanic Revelation | played | White uses Shamanic Revelation's ability |
| Firebending | Firebending Student | played | White casts Firebending Student |
| Flanking | Sidar Kondo of Jamuraa | played | White casts Sidar Kondo of Jamuraa |
| Flash | Mithril Coat | played | White casts Mithril Coat |
| Flurry | Cori-Steel Cutter | played | White casts Cori-Steel Cutter |
| Flying | Birds of Paradise | played | White casts Birds of Paradise |
| Food | Academy Manufactor | played | White casts Academy Manufactor |
| For Mirrodin! | Hexplate Wallbreaker | played | White casts Hexplate Wallbreaker |
| Forage | Camellia, the Seedmiser | played | White casts Camellia, the Seedmiser |
| Forecast | Skyscribing | played | White uses Skyscribing's ability |
| Forestcycling | Generous Ent | played | White uses Generous Ent's ability |
| Forestwalk | Chatterfang, Squirrel General | played | White casts Chatterfang, Squirrel General |
| Foretell | Delayed Blast Fireball | played | White uses Delayed Blast Fireball's ability |
| Formidable | Gimli's Reckless Might | played | White casts Gimli's Reckless Might |
| Fortify | C.A.M.P. | played | White casts C.A.M.P. |
| Freerunning | Overpowering Attack | played | White uses Overpowering Attack's ability |
| Gift | Dawn's Truce | played | White uses Dawn's Truce's ability |
| Goad | Disrupt Decorum | played | White uses Disrupt Decorum's ability |
| Grandeur | Page, Loose Leaf | played | White casts Page, Loose Leaf |
| Gravestorm | Ominous Harvest | played | White uses Ominous Harvest's ability |
| Halflingcycling | Hobbit Hole | played | White plays Hobbit Hole |
| Harmonize | Nature's Rhythm | played | White uses Nature's Rhythm's ability |
| Haste | Craterhoof Behemoth | played | White casts Craterhoof Behemoth |
| Haunt | Blind Hunter | played | White casts Blind Hunter |
| Heal | Asceticism | played | White casts Asceticism |
| Hellbent | Gibbering Descent | played | White casts Gibbering Descent |
| Heroic | Hero of Iroas | played | White casts Hero of Iroas |
| Hexproof | Lotus Field | played | White uses Lotus Field's ability |
| Hideaway | Mosswort Bridge | played | White uses Mosswort Bridge's ability |
| Horsemanship | Herald of Hoofbeats | played | White casts Herald of Hoofbeats |
| Impending | Overlord of the Hauntwoods | played | White casts Overlord of the Hauntwoods |
| Imprint | Chrome Mox | played | White uses Chrome Mox's ability |
| Improvise | Kappa Cannoneer | played | White casts Kappa Cannoneer |
| Increment | Pensive Professor | played | White casts Pensive Professor |
| Incubate | Sunfall | played | White uses Sunfall's ability |
| Indestructible | The One Ring | played | White casts The One Ring |
| Infect | Blightsteel Colossus | played | Blightsteel Colossus enters the battlefield (White) |
| Infusion | Moseo, Vein's New Dean | played | White casts Moseo, Vein's New Dean |
| Ingest | Benthic Infiltrator | played | White casts Benthic Infiltrator |
| Inspired | King Macar, the Gold-Cursed | played | White casts King Macar, the Gold-Cursed |
| Intimidate | Mikaeus, the Unhallowed | played | White casts Mikaeus, the Unhallowed |
| Investigate | Tireless Tracker | played | White casts Tireless Tracker |
| Islandcycling | Monstrosity of the Lake | played | White uses Monstrosity of the Lake's ability |
| Islandwalk | Cold-Eyed Selkie | played | White casts Cold-Eyed Selkie |
| Job select | Black Mage's Rod | played | White casts Black Mage's Rod |
| Join forces | Minds Aglow | played | White uses Minds Aglow's ability |
| Jump-start | Quasiduplicate | played | White uses Quasiduplicate's ability |
| Kicker | Tear Asunder | played | White uses Tear Asunder's ability |
| Kinship | Leaf-Crowned Elder | played | White casts Leaf-Crowned Elder |
| Landcycling | Lórien Revealed | played | White uses Lórien Revealed's ability |
| Landfall | Tireless Provisioner | played | White casts Tireless Provisioner |
| Landwalk | Sheoldred, Whispering One | played | White casts Sheoldred, Whispering One |
| Learn | First Day of Class | played | White uses First Day of Class's ability |
| Legendary landwalk | Ayumi, the Last Visitor | played | White casts Ayumi, the Last Visitor |
| Level Up | Joraga Treespeaker | played | White casts Joraga Treespeaker |
| Lieutenant | Loyal Apprentice | played | White casts Loyal Apprentice |
| Lifelink | Mangara, the Diplomat | played | White casts Mangara, the Diplomat |
| Living metal | Ratchet, Field Medic | played | White casts Ratchet, Field Medic |
| Living weapon | Nettlecyst | played | White casts Nettlecyst |
| Madness | Emrakul, the World Anew | played | White uses Emrakul, the World Anew's ability |
| Magecraft | Storm-Kiln Artist | played | White casts Storm-Kiln Artist |
| Manifest | Reality Shift | played | White uses Reality Shift's ability |
| Max speed | Muraganda Raceway | played | White plays Muraganda Raceway |
| Mayhem | Chameleon, Master of Disguise | played | White casts Chameleon, Master of Disguise |
| Megamorph | Gudul Lurker | played | White casts Gudul Lurker |
| Meld | Gisela, the Broken Blade | played | White casts Gisela, the Broken Blade |
| Melee | Skyhunter Strike Force | played | White casts Skyhunter Strike Force |
| Menace | Professional Face-Breaker | played | White casts Professional Face-Breaker |
| Mentor | Legion Warboss | played | White casts Legion Warboss |
| Metalcraft | Mox Opal | played | Mox Opal enters the battlefield (White) |
| Mill | Takenuma, Abandoned Mire | played | White plays Takenuma, Abandoned Mire |
| Miracle | Reforge the Soul | played | White uses Reforge the Soul's ability |
| Mobilize | Voice of Victory | played | White casts Voice of Victory |
| Modular | Power Depot | played | White plays Power Depot |
| Monstrosity | Giggling Skitterspike | played | White casts Giggling Skitterspike |
| Morbid | Tragic Slip | played | White uses Tragic Slip's ability |
| Morph | Grim Haruspex | played | Grim Haruspex enters the battlefield (White) |
| Mountaincycling | Oliphaunt | played | White casts Oliphaunt |
| Multikicker | Everflowing Chalice | played | White casts Everflowing Chalice |
| Mutate | Gemrazer | played | White casts Gemrazer |
| Myriad | Battle Angels of Tyr | played | White casts Battle Angels of Tyr |
| Nightbound | Outland Liberator | played | White casts Outland Liberator |
| Ninjutsu | Nashi, Moon Sage's Scion | played | White casts Nashi, Moon Sage's Scion |
| Nonbasic landwalk | Dryad Sophisticate | played | White casts Dryad Sophisticate |
| Offspring | Coruscation Mage | played | White casts Coruscation Mage |
| Open an Attraction | "Lifetime" Pass Holder | played | "Lifetime" Pass Holder enters the battlefield (White) |
| Opus | Molten-Core Maestro | played | White casts Molten-Core Maestro |
| Overload | Cyclonic Rift | played | White uses Cyclonic Rift's ability |
| Parley | Selvala, Explorer Returned | played | White casts Selvala, Explorer Returned |
| Partner with | Alisaie Leveilleur | played | White casts Alisaie Leveilleur |
| Persist | Glen Elendra Archmage | played | White casts Glen Elendra Archmage |
| Phasing | Taniwha | played | White casts Taniwha |
| Plainscycling | Eagles of the North | played | White uses Eagles of the North's ability |
| Plainswalk | Zodiac Rooster | played | White casts Zodiac Rooster |
| Plot | Aven Interrupter | played | White casts Aven Interrupter |
| Prepared | Grave Researcher | played | White uses Grave Researcher's ability |
| Proliferate | Karn's Bastion | played | White plays Karn's Bastion |
| Protection | Yawgmoth, Thran Physician | played | White casts Yawgmoth, Thran Physician |
| Prototype | Steel Seraph | played | White casts Steel Seraph |
| Provoke | Goblin Grappler | played | White casts Goblin Grappler |
| Prowess | Pinnacle Monk | played | White casts Pinnacle Monk |
| Radiance | Bathe in Light | played | White uses Bathe in Light's ability |
| Raid | Alesha, Who Laughs at Fate | played | White casts Alesha, Who Laughs at Fate |
| Rally | Hero of Goma Fada | played | White casts Hero of Goma Fada |
| Rampage | Varchild's War-Riders | played | White casts Varchild's War-Riders |
| Ravenous | Jacked Rabbit | played | White casts Jacked Rabbit |
| Reach | Six | played | White casts Six |
| Read Ahead | The Cruelty of Gix | played | White casts The Cruelty of Gix |
| Rebound | Ephemerate | played | White uses Ephemerate's ability |
| Reconfigure | The Reality Chip | played | White casts The Reality Chip |
| Recover | Garza's Assassin | played | White uses Garza's Assassin's ability |
| Recruit | The Queen of Dale | played | White casts The Queen of Dale |
| Regenerate | Swarmyard | played | White plays Swarmyard |
| Reinforce | Brighthearth Banneret | played | White casts Brighthearth Banneret |
| Renew | Qarsi Revenant | played | White casts Qarsi Revenant |
| Repartee | Stirring Hopesinger | played | Stirring Hopesinger enters the battlefield (White) |
| Replicate | Changing Loyalty | played | White casts Changing Loyalty |
| Riot | Spider-Punk | played | White casts Spider-Punk |
| Ripple | Surging Dementia | played | White uses Surging Dementia's ability |
| Role token | Not Dead After All | played | White uses Not Dead After All's ability |
| Roll to Visit Your Attractions | Line Cutter | played | White casts Line Cutter |
| Saddle | The Gitrog, Ravenous Ride | played | White casts The Gitrog, Ravenous Ride |
| Scavenge | Boneyard Mycodrax | played | White casts Boneyard Mycodrax |
| Scry | Path of Ancestry | played | White plays Path of Ancestry |
| Secret council | Mob Verdict | played | White uses Mob Verdict's ability |
| Shadow | Dauthi Voidwalker | played | White casts Dauthi Voidwalker |
| Shroud | Argothian Enchantress | played | White casts Argothian Enchantress |
| Skulk | Ingenious Prodigy | played | White casts Ingenious Prodigy |
| Slivercycling | Homing Sliver | played | White uses Homing Sliver's ability |
| Sneak | Splinter's Technique | played | White uses Splinter's Technique's ability |
| Solved | Case of the Locked Hothouse | played | White casts Case of the Locked Hothouse |
| Soulbond | Deadeye Navigator | played | White casts Deadeye Navigator |
| Soulshift | Thief of Hope | played | White casts Thief of Hope |
| Spectacle | Light Up the Stage | played | White uses Light Up the Stage's ability |
| Spell mastery | Animist's Awakening | played | White uses Animist's Awakening's ability |
| Splice | Desperate Ritual | played | White uses Desperate Ritual's ability |
| Split second | Krosan Grip | played | White uses Krosan Grip's ability |
| Squad | Galadhrim Brigade | played | White casts Galadhrim Brigade |
| Station | Evendo, Waking Haven | played | White plays Evendo, Waking Haven |
| Storied | Kíli the Resourceful | played | White casts Kíli the Resourceful |
| Storm | Flusterstorm | played | White uses Flusterstorm's ability |
| Strive | Twinflame | played | White uses Twinflame's ability |
| Sunburst | Pentad Prism | played | White casts Pentad Prism |
| Support | Together Forever | played | White casts Together Forever |
| Surge | Fall of the Titans | played | White uses Fall of the Titans's ability |
| Surveil | Consider | played | White uses Consider's ability |
| Survival | Kona, Rescue Beastie | played | White casts Kona, Rescue Beastie |
| Suspect | Nelly Borca, Impulsive Accuser | played | White casts Nelly Borca, Impulsive Accuser |
| Suspend | Profane Tutor | played | White uses Profane Tutor's ability |
| Swampcycling | Troll of Khazad-dûm | played | White uses Troll of Khazad-dûm's ability |
| Swampwalk | Filth | played | White casts Filth |
| Tempting offer | Tempt with Discovery | played | White uses Tempt with Discovery's ability |
| Threshold | Cabal Ritual | played | White uses Cabal Ritual's ability |
| Time Travel | The Tenth Doctor | played | White casts The Tenth Doctor |
| Toxic | Skrelv, Defector Mite | played | White casts Skrelv, Defector Mite |
| Training | Torens, Fist of the Angels | played | White casts Torens, Fist of the Angels |
| Trample | Rampaging Baloths | played | White casts Rampaging Baloths |
| Transfigure | Fleshwrither | played | White casts Fleshwrither |
| Transform | Growing Rites of Itlimoc | played | White casts Growing Rites of Itlimoc |
| Transmute | Muddle the Mixture | played | White uses Muddle the Mixture's ability |
| Treasure | An Offer You Can't Refuse | played | White uses An Offer You Can't Refuse's ability |
| Tribute | Nessian Wilds Ravager | played | White casts Nessian Wilds Ravager |
| Typecycling | Angel of the Ruins | played | White uses Angel of the Ruins's ability |
| Umbra armor | Bear Umbra | played | White casts Bear Umbra |
| Undaunted | Curtains' Call | played | White uses Curtains' Call's ability |
| Undying | Gleeful Arsonist | played | White casts Gleeful Arsonist |
| Unearth | Molten Gatekeeper | played | White casts Molten Gatekeeper |
| Unleash | Tesak, Judith's Hellhound | played | White casts Tesak, Judith's Hellhound |
| Valiant | Heartfire Hero | played | White casts Heartfire Hero |
| Vanishing | Dreamtide Whale | played | White casts Dreamtide Whale |
| Venture into the dungeon | Acererak the Archlich | played | White casts Acererak the Archlich |
| Vigilance | Sun Titan | played | White casts Sun Titan |
| Vivid | Bloom Tender | played | White casts Bloom Tender |
| Void | Elegy Acolyte | played | White casts Elegy Acolyte |
| Ward | Roaming Throne | played | White casts Roaming Throne |
| Warp | Exalted Sunborn | played | White casts Exalted Sunborn |
| Waterbend | The Unagi of Kyoshi Island | played | White casts The Unagi of Kyoshi Island |
| Web-slinging | Spider-Sense | played | White uses Spider-Sense's ability |
| Will of the council | Council's Judgment | played | White uses Council's Judgment's ability |
| Will of the Planeswalkers | Path of the Pyromancer | played | White uses Path of the Pyromancer's ability |
| Wither | Necroskitter | played | White casts Necroskitter |
| Wizardcycling | Step Through | played | White uses Step Through's ability |
| Council's dilemma | Expropriate | seen | Expropriate is put into White's graveyard |
| Eminence | The Ur-Dragon | seen | The Ur-Dragon is put into White's graveyard |
| Manifest dread | Abhorrent Oculus | seen | Abhorrent Oculus is put into White's graveyard |
| Paradigm | Improvisation Capstone | seen | Improvisation Capstone is put into White's graveyard |
| Triple | Fiery Emancipation | seen | Fiery Emancipation is put into White's graveyard |
| Fight | Bridgeworks Battle | not drawn |  |
| Aftermath | - | no card Forge knows | undefined |
| Fuse | - | no card Forge knows | undefined |
