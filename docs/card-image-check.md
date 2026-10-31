# Card picture and name check

Run 2026-10-18 16:26 UTC over every card the engine knows: 33975 names, 577 s.

- **Found on Scryfall:** 33575
- **Not found:** 274 after the fix below. The first pass missed 400; 126 of those were split and Room cards ("Alive // Well"), which Scryfall's batch lookup misses but its exact-name lookup finds. The bridge now falls back to that, and their pictures are in the cache. The remaining 274 show the card back:
  - 230 Alchemy "A-" cards: digital-only rebalanced versions with no paper picture.
  - 44 crossover printings (The Walking Dead, Street Fighter, Stranger Things, D&D movie) that Forge knows by names Scryfall does not list.
- **Image server sample:** 200 cards + 25 double-faced backs checked, 0 broken

## Layouts

| Layout | Cards |
|---|---|
| normal | 32106 |
| transform | 389 |
| saga | 189 |
| planar | 172 |
| adventure | 162 |
| vanguard | 106 |
| scheme | 102 |
| modal_dfc | 98 |
| prepare | 69 |
| class | 35 |
| mutate | 34 |
| leveler | 26 |
| prototype | 21 |
| flip | 20 |
| host | 17 |
| case | 15 |
| meld | 14 |

## Not found (after the fix)

- A-Acererak the Archlich
- A-Akki Ronin
- A-Alrund's Epiphany
- A-Alrund, God of the Cosmos
- A-Ancestral Katana
- A-Ardent Dustspeaker
- A-Armory Veteran
- A-Asari Captain
- A-Baba Lysaga, Night Witch
- A-Baleful Beholder
- A-Base Camp
- A-Binding Geist
- A-Blessed Hippogriff
- A-Blood Artist
- A-Bretagard Stronghold
- A-Briar Hydra
- A-Brine Comber
- A-Bruenor Battlehammer
- A-Buy Your Silence
- A-Cabaretti Charm
- A-Canopy Tactician
- A-Capenna Express
- A-Carnelian Orb of Dragonkind
- A-Case the Joint
- A-Cauldron Familiar
- A-Celebrity Fencer
- A-Celestial Regulator
- A-Circle of the Land Druid
- A-Circuit Mender
- A-Civil Servant
- A-Cloister Gargoyle
- A-Cobbled Lancer
- A-Cori-Steel Cutter
- A-Cosmos Charger
- A-Cosmos Elixir
- A-Dawnbringer Cleric
- A-Deal Gone Bad
- A-Death-Priest of Myrkul
- A-Demilich
- A-Demon's Due
- A-Devoted Grafkeeper
- A-Divide by Zero
- A-Dokuchi Silencer
- A-Dorothea, Vengeful Victim
- A-Dragon's Rage Channeler
- A-Dragonborn Looter
- A-Dreamshackle Geist
- A-Druid Class
- A-Druidic Ritual
- A-Dueling Coach
- A-Dungeon Descent
- A-Dwarfhold Champion
- A-Earthquake Dragon
- A-Eiganjo Exemplar
- A-Elderfang Ritualist
- A-Elderleaf Mentor
- A-Ellywick Tumblestrum
- A-Elven Bow
- A-Emerald Dragon
- A-Esika's Chariot
- A-Excavation Explosion
- A-Exhibition Magician
- A-Eyes of the Beholder
- A-Faceless Haven
- A-Falcon Abomination
- A-Fall of the Impostor
- A-Fates' Reversal
- A-Find the Path
- A-Fires of Invention
- A-Forge Boss
- A-Futurist Operative
- A-Galvanic Discharge
- A-Geological Appraiser
- A-Geology Enthusiast
- A-Glamorous Outlaw
- A-Glittermonger
- A-Gnarlid Colony
- A-Goggles of Night
- A-Goldspan Dragon
- A-Goma Fada Vanguard
- A-Graveyard Shift
- A-Guide of Souls
- A-Guildsworn Prowler
- A-Gutter Skulker
- A-Hagra Constrictor
- A-Hall of Tagsin
- A-Harald Unites the Elves
- A-Harald, King of Skemfar
- A-Haywire Mite
- A-Heartfire Hero
- A-High-Rise Sawjack
- A-Hobbling Zombie
- A-Hullbreaker Horror
- A-Imperial Subduer
- A-Incriminate
- A-Iridescent Hornbeetle
- A-Jackhammer
- A-Jade Orb of Dragonkind
- A-Kargan Intimidator
- A-Kargan Warleader
- A-Karn, Living Legacy
- A-Kenku Artificer
- A-Knockout Blow
- A-Kona, Rescue Beastie
- A-Krydle of Baldur's Gate
- A-Kumano Faces Kakkazan
- A-Lantern Bearer
- A-Lantern of Revealing
- A-Lapis Orb of Dragonkind
- A-Leyline of Resonance
- A-Lier, Disciple of the Drowned
- A-Llanowar Greenwidow
- A-Llanowar Loamspeaker
- A-Luminarch Aspirant
- A-Maelstrom Muse
- A-Manticore
- A-Masked Bandits
- A-Master of Winds
- A-Mentor's Guidance
- A-Meria's Outrider
- A-Metropolis Angel
- A-Midnight Assassin
- A-Mightstone's Animation
- A-Minsc & Boo, Timeless Heroes
- A-Mischievous Catgeist
- A-Mishra, Excavation Prodigy
- A-Monster Manual
- A-Moon-Circuit Hacker
- A-Moss-Pit Skeleton
- A-Most Wanted
- A-Mr. Orfeo, the Boulder
- A-Nadu, Winged Wisdom
- A-Nael, Avizoa Aeronaut
- A-Nahiri, Heir of the Ancients
- A-Narfi, Betrayer King
- A-Nashi, Moon Sage's Scion
- A-Navigation Orb
- A-Nezumi Prowler
- A-Ocelot Pride
- A-Ochre Jelly
- A-Ominous Parcel
- A-Omnath, Locus of Creation
- A-Oran-Rief Ooze
- A-Orcish Bowmasters
- A-Paragon of Modernity
- A-Patrician Geist
- A-Peerless Samurai
- A-Phantom Carriage
- A-Phylath, World Sculptor
- A-Plate Armor
- A-Precipitous Drop
- A-Prosperous Thief
- A-Pseudodragon Familiar
- A-Psionic Snoop
- A-Public Enemy
- A-Pyre-Sledge Arsonist
- A-Queza, Augur of Agonies
- A-Radha's Firebrand
- A-Radha, Coalition Warlord
- A-Raiyuu, Storm's Edge
- A-Rakish Revelers
- A-Ready to Rumble
- A-Return Upon the Tide
- A-Revel Ruiner
- A-Riveteers Initiate
- A-Rockslide Sorcerer
- A-Rowan, Scholar of Sparks
- A-Rulik Mons, Warren Chief
- A-Saheeli, Filigree Master
- A-Satoru Umezawa
- A-Scout the Wilderness
- A-Security Rhox
- A-Sepulcher Ghoul
- A-Sewer Crocodile
- A-Shattered Seraph
- A-Shessra, Death's Whisper
- A-Shipwreck Sifters
- A-Sigardian Paladin
- A-Sigil of Myrkul
- A-Silver-Fur Master
- A-Sizzling Soloist
- A-Skemfar Avenger
- A-Skemfar Elderhall
- A-Skull Skaab
- A-Skyclave Shadowcat
- A-Social Climber
- A-Sorcerer Class
- A-Sorin, Imperious Bloodlord
- A-Soul of Windgrace
- A-Spara's Adjudicators
- A-Speakeasy Server
- A-Spell Satchel
- A-Split the Spoils
- A-Splitting the Powerstone
- A-Sprouting Goblin
- A-Steadfast Unicorn
- A-Stimulus Package
- A-Stitched Assistant
- A-Sunbathing Rootwalla
- A-Symmetry Sage
- A-Syndicate Infiltrator
- A-Tanazir Quandrix
- A-Tatyova, Steward of Tides
- A-Teferi, Time Raveler
- A-Tenured Inkcaster
- A-The Meathook Massacre
- A-The One Ring
- A-Thornmantle Striker
- A-Thousand-Faced Shadow
- A-Thran Portal
- A-Thran Spider
- A-Tome Shredder
- A-Triumphant Adventurer
- A-Tyvar Kell
- A-Umara Mystic
- A-Unholy Heat
- A-Urza's Command
- A-Urza, Powerstone Prodigy
- A-Uurg, Spawn of Turg
- A-Vampire Scrivener
- A-Vega, the Watcher
- A-Visions of Phyrexia
- A-Vivi Ornitier
- A-Warm Welcome
- A-Winota, Joiner of Forces
- A-Wizard Class
- A-You Come to a River
- A-Young Blue Dragon
- A-Young Red Dragon
- A-Zar Ojanen, Scion of Efrava
- Antagonism
- Blanka, Ferocious Friend
- Blinding Radiance
- Chief Jim Hopper
- Chun-Li, Countless Kicks
- Daryl, Hunter of Walkers
- Dhalsim, Pliable Pacifist
- Distract
- Doric, Nature's Warden
- Drake Stone
- Dustin, Gadget Genius
- E. Honda, Sumo Champion
- Edgin, Larcenous Lutenist
- Eleven, the Mage
- Enthrall
- Forge, Neverwinter Charlatan
- Glenn, the Voice of Calm
- Goblin Bruiser
- Guile, Sonic Soldier
- Hawkins National Laboratory
- Holga, Relentless Rager
- Human-Time Lord Meta-Crisis
- Ken, Burning Brawler
- Lucas, the Sharpshooter
- Lucille
- Max, the Daredevil
- Michonne, Ruthless Survivor
- Mike, the Dungeon Master
- Mind Flayer, the Shadow
- Negan, the Cold-Blooded
- Ogre Painbringer
- P-Joven and Chandler
- P-No Way Out
- Ratonhnhaké:ton
- Rick, Steadfast Leader
- Ryu, World Warrior
- Simon, Wild Magic Sorcerer
- Titanic Pelagosaur
- Treetop Recluse
- Waste Land
- Where We're Going . . .
- Will the Wise
- Xenk, Paladin Unbroken
- Zangief, the Red Cyclone

## Broken pictures in the sample

None.
