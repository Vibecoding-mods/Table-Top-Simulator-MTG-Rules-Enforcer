# Every keyword and mechanic, and how it was tested

Generated 2026-11-06 from docs/keywords-by-card-count.md (Scryfall, 342 names), docs/keyword-test-results.md (Oct 2026 headless autoplay + scripted checks) and tmp/mech-scenario-plan.json (the 28 debug-mode decks run on the real table 2026-11-05).

- **Oct test**: played = White's autoplay used it with no table problem; fixed = flagged first, played clean on the 2026-10-20 recheck; blank = not in that test.
- **Debug run**: a card with it was set up in a `mtg debug` deck on the real table. Approximate: matched on Forge's card script text, so it means "on the table in a debug run", not "its rule was checked step by step". "no" = not in any debug deck.

## Keyword abilitys (219; 124 in a debug run)

| # | Name | Commander cards | Oct test | Debug run |
|---|---|---|---|---|
| 1 | Flying | 3164 | played | Angel of the Ruins |
| 2 | Enchant | 1241 | played | Rancor |
| 3 | Trample | 994 | played | Rancor |
| 4 | Vigilance | 727 | played | Vigilance |
| 5 | Haste | 640 | played | Lightning Greaves |
| 6 | Flash | 608 | played | Mithril Coat |
| 7 | Equip | 601 | played | Lightning Greaves |
| 9 | Reach | 424 | played | Six |
| 12 | Menace | 382 | played | Nelly Borca, Impulsive Accuser |
| 13 | Cycling | 394 | fixed (played) | Unearth |
| 14 | First strike | 375 | fixed (played) | Knight of the White Orchid |
| 15 | Lifelink | 362 | played | Lifelink |
| 17 | Deathtouch | 329 | played | Typhoid Rats |
| 18 | Defender | 308 | played | no |
| 21 | Kicker | 226 | played | Tear Asunder |
| 22 | Flashback | 215 | fixed (played) | Faithless Looting |
| 23 | Ward | 192 | played | Hexing Squelcher |
| 24 | Protection | 193 | played | Emrakul, the World Anew |
| 27 | Crew | 181 | played | Hedge Shredder |
| 29 | Morph | 153 | played | Grim Haruspex |
| 33 | Partner | 129 | fixed (played) | Kodama of the East Tree |
| 34 | Devoid | 132 | fixed (played) | Benthic Infiltrator |
| 35 | Landwalk | 128 | played | Dryad Sophisticate |
| 36 | Double strike | 120 | played | Lizard Blades |
| 37 | Indestructible | 111 | played | Heroic Intervention |
| 40 | Convoke | 104 | played | no |
| 41 | Prowess | 94 | played | Monastery Swiftspear |
| 43 | Typecycling | 94 | played | Ash Barrens |
| 44 | Hexproof | 92 | played | Heroic Intervention |
| 45 | Landcycling | 91 | played | Ash Barrens |
| 47 | Cumulative upkeep | 80 | played | Mystic Remora |
| 49 | Affinity | 74 | played | no |
| 51 | Suspend | 70 | played | Suspend |
| 54 | Changeling | 62 | played | Changeling Outcast |
| 55 | Madness | 61 | played | Emrakul, the World Anew |
| 56 | Unearth | 56 | played | Molten Gatekeeper |
| 59 | Foretell | 51 | played | Delayed Blast Fireball |
| 60 | Partner with | 52 | played | Zndrsplt, Eye of Wisdom |
| 61 | Echo | 50 | played | no |
| 63 | Disguise | 43 | played | Bayek of Siwa |
| 64 | Infect | 46 | played | no |
| 69 | Bestow | 43 | played | Springheart Nantuko |
| 70 | Toxic | 37 | played | Skrelv, Defector Mite |
| 71 | Swampwalk | 41 | played | Bog Wraith |
| 72 | Basic landcycling | 36 | played | (named in a plan) |
| 73 | Exhaust | 36 | fixed (played) | Riverchurn Monument |
| 74 | Buyback | 39 | played | no |
| 75 | Shadow | 37 | played | Dauthi Voidwalker |
| 76 | Max speed | 34 | played | no |
| 77 | Fear | 40 | played | Fear |
| 81 | Cascade | 37 | played | Throes of Chaos |
| 84 | Ninjutsu | 35 | played | Nashi, Moon Sage's Scion |
| 85 | Bushido | 37 | played | Jade Avenger |
| 86 | Warp | 32 | played | Exalted Sunborn |
| 87 | Power-up | 37 | fixed (played) | no |
| 89 | Evoke | 35 | played | Shriekmaw |
| 90 | Exalted | 35 | fixed (played) | Ignoble Hierarch |
| 91 | Nightbound | 35 | played | no |
| 92 | Storm | 33 | played | Grapeshot |
| 93 | Daybound | 35 | played | no |
| 97 | Rebound | 34 | played | Ephemerate |
| 98 | Shroud | 35 | played | Lightning Greaves |
| 99 | Station | 31 | played | no |
| 101 | Mutate | 34 | played | Gemrazer |
| 102 | Islandwalk | 34 | played | Mind Bend |
| 104 | Escape | 32 | played | Uro, Titan of Nature's Wrath |
| 107 | Entwine | 32 | fixed (played) | no |
| 108 | Choose a background | 32 | played | no |
| 109 | Saddle | 30 | played | The Gitrog, Ravenous Ride |
| 111 | Megamorph | 31 | played | no |
| 113 | Splice | 30 | played | Desperate Ritual |
| 114 | Flanking | 29 | played | no |
| 117 | Overload | 27 | played | no |
| 118 | Forestwalk | 28 | played | Mind Bend |
| 119 | Delve | 28 | fixed (played) | Dig Through Time |
| 120 | Horsemanship | 28 | played | no |
| 124 | Wither | 26 | played | no |
| 125 | Ascend | 27 | played | no |
| 126 | Aftermath | 27 | fixed (seen) | (named in a plan) |
| 127 | Doctor's companion | 27 | played | no |
| 128 | Gift | 25 | played | Dawn's Truce |
| 129 | Sneak | 27 | played | no |
| 130 | Soulshift | 26 | played | no |
| 131 | Encore | 26 | played | Impulsive Pilferer |
| 132 | Firebending | 26 | played | no |
| 138 | Level Up | 25 | played | Joraga Treespeaker |
| 139 | Persist | 25 | played | no |
| 140 | Soulbond | 25 | played | Deadeye Navigator |
| 141 | Disturb | 25 | played | (named in a plan) |
| 142 | Backup | 25 | played | no |
| 143 | Banding | 24 | played | Benalish Hero |
| 147 | Modular | 24 | played | Power Depot |
| 148 | Improvise | 23 | played | no |
| 149 | Craft | 24 | played | (named in a plan) |
| 150 | Undying | 23 | played | no |
| 153 | Myriad | 23 | played | no |
| 154 | Bloodthirst | 23 | played | no |
| 155 | Evolve | 22 | fixed (played) | Gyre Sage |
| 156 | Exploit | 23 | played | no |
| 157 | Intimidate | 23 | played | no |
| 158 | Devour | 23 | played | Mycoloth |
| 161 | Dash | 22 | played | Ragavan, Nimble Pilferer |
| 162 | Bargain | 20 | played | Beseech the Mirror |
| 165 | Split second | 21 | played | no |
| 166 | Reconfigure | 17 | played | Lizard Blades |
| 167 | Prototype | 19 | played | no |
| 168 | Spree | 21 | fixed (seen) | no |
| 169 | Offspring | 20 | played | Coruscation Mage |
| 170 | Replicate | 19 | played | no |
| 171 | Renown | 20 | fixed (played) | no |
| 172 | Vanishing | 20 | played | no |
| 173 | Mentor | 20 | played | Legion Warboss |
| 174 | Intensity | 0 |  | no |
| 178 | Living weapon | 19 | played | no |
| 179 | Multikicker | 19 | played | Everflowing Chalice |
| 180 | Blitz | 17 | played | no |
| 181 | Specialize | 0 |  | no |
| 182 | Double team | 0 |  | no |
| 183 | Job select | 19 | played | no |
| 186 | Fading | 17 | played | no |
| 187 | Extort | 17 | played | Blind Obedience |
| 188 | Boast | 18 | played | no |
| 193 | Retrace | 17 | fixed (played) | Six |
| 194 | Miracle | 17 | played | no |
| 195 | Fuse | 17 | fixed (seen) | (named in a plan) |
| 196 | Mountainwalk | 17 | fixed (played) | Goblin King |
| 197 | Teamwork | 17 | fixed (played) | no |
| 200 | Assist | 16 | played | no |
| 201 | Fabricate | 16 | played | Marionette Apprentice |
| 202 | Skulk | 16 | played | no |
| 203 | Casualty | 15 | played | Cut Your Losses |
| 204 | Sunburst | 16 | played | no |
| 205 | Mayhem | 16 | played | no |
| 206 | Hideaway | 15 | played | Mosswort Bridge |
| 207 | Unleash | 14 | played | no |
| 208 | Embalm | 15 | played | Vizier of Many Faces |
| 209 | Battle Cry | 14 | played | Hero of Bladehold |
| 210 | Cipher | 15 | played | no |
| 211 | Awaken | 15 | played | no |
| 212 | Emerge | 15 | played | no |
| 213 | Squad | 15 | played | Galadhrim Brigade |
| 214 | Enlist | 12 | played | Yavimaya Steelcrusher |
| 215 | Hidden agenda | 0 |  | no |
| 216 | For Mirrodin! | 13 | played | Hexplate Wallbreaker |
| 217 | Hexproof from | 13 | fixed (played) | Skrelv, Defector Mite |
| 218 | More Than Meets the Eye | 15 | fixed (played) | no |
| 219 | Umbra armor | 15 | played | Bear Umbra |
| 220 | Mobilize | 13 | played | no |
| 221 | Solved | 13 | played | no |
| 224 | Transmute | 14 | played | Muddle the Mixture |
| 225 | Scavenge | 14 | played | Boneyard Mycodrax |
| 226 | Annihilator | 13 | played | no |
| 227 | Dredge | 14 | played | Life from the Loam |
| 228 | Augment | 0 |  | no |
| 233 | Jump-start | 12 | played | no |
| 234 | Graft | 13 | fixed (played) | Llanowar Reborn |
| 235 | Rampage | 12 | played | (named in a plan) |
| 236 | Phasing | 12 | played | no |
| 237 | Outlast | 13 | fixed (played) | Abzan Falconer |
| 238 | Riot | 13 | played | (named in a plan) |
| 239 | Living metal | 13 | played | no |
| 240 | Plainscycling | 13 | played | (named in a plan) |
| 241 | Mountaincycling | 13 | played | (named in a plan) |
| 248 | Melee | 12 | played | no |
| 249 | Eternalize | 12 | played | Fanatic of Rhonas |
| 250 | Ravenous | 12 | played | The Gitrog, Ravenous Ride |
| 251 | Cleave | 12 | played | no |
| 252 | Champion | 12 | played | no |
| 253 | Freerunning | 12 | played | no |
| 254 | Harmonize | 11 | played | no |
| 260 | Forecast | 11 | played | Skyscribing |
| 261 | Reinforce | 11 | played | Brighthearth Banneret |
| 262 | Afterlife | 11 | played | Tithe Taker |
| 263 | Tribute | 11 | played | no |
| 264 | Surge | 11 | played | no |
| 265 | Spectacle | 11 | played | Light Up the Stage |
| 266 | Conspire | 11 | played | no |
| 267 | Afflict | 11 | played | Neheb, the Eternal |
| 268 | Training | 11 | played | Torens, Fist of the Angels |
| 269 | Swampcycling | 11 | played | no |
| 270 | Islandcycling | 11 | played | no |
| 271 | Forestcycling | 11 | played | (named in a plan) |
| 275 | Haunt | 10 | played | Blind Hunter |
| 276 | Companion | 10 | played | (named in a plan) |
| 277 | Read Ahead | 10 | played | The Cruelty of Gix |
| 278 | Web-slinging | 10 | played | no |
| 279 | Prowl | 10 | fixed (played) | no |
| 280 | Increment | 9 | played | no |
| 284 | Provoke | 9 | played | no |
| 285 | Ingest | 9 | played | Benthic Infiltrator |
| 286 | Amplify | 9 | played | Kilnmouth Dragon |
| 287 | Dethrone | 9 | fixed (played) | Scourge of the Throne |
| 288 | Escalate | 9 | fixed (played) | no |
| 289 | Storied | 9 | played | no |
| 301 | Recover | 7 | played | no |
| 302 | Compleated | 7 | played | Vraska, Betrayal's Sting |
| 303 | Tiered | 7 | fixed (played) | Restoration Magic |
| 309 | Offering | 6 | fixed (played) | no |
| 310 | Demonstrate | 6 | played | Incarnation Technique |
| 311 | Impending | 5 | played | Overlord of the Hauntwoods |
| 313 | Ripple | 5 | played | Surging Dementia |
| 314 | Epic | 5 | played | no |
| 315 | Plainswalk | 4 | played | no |
| 316 | Undaunted | 5 | played | no |
| 317 | Paradigm | 5 | fixed (played) | no |
| 324 | Gravestorm | 3 | played | no |
| 326 | Legendary landwalk | 2 | played | no |
| 327 | Fortify | 2 | played | (named in a plan) |
| 328 | Desertwalk | 2 | played | no |
| 329 | Wizardcycling | 2 | played | no |
| 331 | Commander ninjutsu | 1 | fixed (played) | Yuriko, the Tiger's Shadow |
| 332 | Nonbasic landwalk | 1 | played | Dryad Sophisticate |
| 333 | Frenzy | 0 |  | no |
| 334 | Transfigure | 1 | played | no |
| 335 | Aura Swap | 1 | played | Arcanum Wings |
| 336 | Double agenda | 0 |  | no |
| 337 | Decayed | 1 | played | no |
| 338 | Slivercycling | 1 | played | Homing Sliver |
| 339 | Halflingcycling | 1 | played | no |

## Keyword actions (60; 25 in a debug run)

| # | Name | Commander cards | Oct test | Debug run |
|---|---|---|---|---|
| 8 | Mill | 581 | played | Six |
| 10 | Scry | 425 | played | Viscera Seer |
| 11 | Transform | 424 | played | (named in a plan) |
| 16 | Treasure | 350 | played | Tireless Provisioner |
| 19 | Regenerate | 271 | played | Regenerate |
| 20 | Surveil | 252 | played | no |
| 26 | Conjure | 0 |  | no |
| 28 | Food | 150 | played | Tireless Provisioner |
| 30 | Fight | 143 | fixed (seen) | no |
| 31 | Investigate | 134 | played | Tireless Tracker |
| 32 | Double | 131 | played | Lizard Blades |
| 38 | Seek | 0 |  | no |
| 42 | Proliferate | 96 | played | High Perfect Morcant |
| 46 | Goad | 80 | played | Disrupt Decorum |
| 48 | Prepared | 72 | played | no |
| 52 | Amass | 71 | played | Orcish Bowmasters |
| 53 | Manifest | 58 | played | Reality Shift |
| 58 | Explore | 53 | played | no |
| 62 | Connive | 50 | played | Ledger Shredder |
| 65 | Open an Attraction | 21 | played | no |
| 68 | Draft from a spellbook | 0 |  | no |
| 78 | Role token | 38 | played | no |
| 79 | Plot | 39 | played | no |
| 82 | Empower Jace | 35 | played | no |
| 83 | Venture into the dungeon | 38 | played | Acererak the Archlich |
| 88 | Monstrosity | 37 | played | Giggling Skitterspike |
| 94 | Exert | 36 | played | Arena of Glory |
| 95 | Earthbend | 36 | played | no |
| 103 | Manifest dread | 30 | fixed (played) | Manifest dread |
| 105 | Heal | 33 | played | Regenerate |
| 106 | Incubate | 33 | played | no |
| 110 | Discover | 30 | played | Chimil, the Inner Sun |
| 116 | Clash | 29 | played | no |
| 121 | Waterbend | 28 | played | no |
| 133 | Populate | 26 | fixed (played) | no |
| 134 | Blight | 26 | fixed (played) | High Perfect Morcant |
| 135 | Behold | 23 | fixed (played) | Champions of the Perfect |
| 144 | Adapt | 25 | played | Incubation Druid |
| 145 | Assemble | 1 | played | no |
| 151 | Bolster | 24 | played | (named in a plan) |
| 159 | Collect evidence | 22 | played | no |
| 163 | Learn | 21 | played | no |
| 175 | Suspect | 19 | played | Nelly Borca, Impulsive Accuser |
| 184 | Support | 19 | played | Together Forever |
| 222 | Convert | 15 | played | no |
| 242 | Airbend | 13 | fixed (played) | no |
| 255 | Detain | 12 | played | no |
| 256 | Endure | 10 | played | no |
| 272 | Cloak | 9 | fixed (played) | no |
| 281 | Recruit | 10 | played | no |
| 290 | Time Travel | 9 | played | no |
| 291 | Heist | 0 |  | no |
| 292 | Forage | 7 | played | no |
| 304 | Meld | 7 | played | no |
| 312 | Incorporate | 0 |  | no |
| 318 | Triple | 5 | fixed (played) | no |
| 325 | Roll to Visit Your Attractions | 3 | played | no |
| 330 | Fateseal | 2 | played | no |
| 340 | Assimilate | 0 |  | no |
| 341 | Face a dilemma | 0 |  | no |

## Ability words (63; 26 in a debug run)

| # | Name | Commander cards | Oct test | Debug run |
|---|---|---|---|---|
| 25 | Landfall | 188 | played | Tireless Tracker |
| 39 | Threshold | 105 | played | no |
| 50 | Delirium | 73 | played | no |
| 57 | Domain | 56 | played | no |
| 66 | Raid | 46 | played | no |
| 67 | Heroic | 45 | played | Hero of Iroas |
| 80 | Channel | 37 | played | no |
| 96 | Metalcraft | 36 | played | no |
| 100 | Constellation | 35 | played | Eidolon of Blossoms |
| 112 | Magecraft | 30 | played | (named in a plan) |
| 115 | Morbid | 30 | played | no |
| 122 | Converge | 28 | played | no |
| 123 | Imprint | 28 | played | Chrome Mox |
| 136 | Ferocious | 26 | played | Fanatic of Rhonas |
| 137 | Corrupted | 24 | played | no |
| 146 | Enrage | 24 | fixed (seen) | no |
| 152 | Alliance | 23 | played | no |
| 160 | Hellbent | 23 | played | no |
| 164 | Battalion | 21 | played | Frontline Medic |
| 176 | Strive | 20 | played | Twinflame |
| 177 | Coven | 20 | played | no |
| 185 | Inspired | 19 | played | no |
| 189 | Spell mastery | 18 | played | no |
| 190 | Adamant | 18 | fixed (played) | no |
| 191 | Revolt | 18 | fixed (played) | Fatal Push |
| 192 | Vivid | 15 | played | no |
| 198 | Eerie | 16 | played | Entity Tracker |
| 199 | Survival | 13 | played | no |
| 223 | Void | 14 | played | Dauthi Voidwalker |
| 229 | Formidable | 14 | played | no |
| 230 | Rally | 14 | played | no |
| 231 | Renew | 12 | played | Qarsi Revenant |
| 232 | Repartee | 12 | played | Stirring Hopesinger |
| 243 | Bloodrush | 13 | fixed (played) | Wasteland Viper |
| 244 | Lieutenant | 13 | played | no |
| 245 | Undergrowth | 13 | fixed (played) | no |
| 246 | Flurry | 11 | played | no |
| 247 | Infusion | 12 | played | no |
| 257 | Kinship | 12 | played | no |
| 258 | Celebration | 11 | played | Raging Battle Mouse |
| 259 | Valiant | 9 | played | Heartfire Hero |
| 273 | Will of the council | 11 | played | Council's Judgment |
| 274 | Opus | 10 | played | no |
| 282 | Radiance | 10 | played | Bathe in Light |
| 283 | Addendum | 10 | played | Unbreakable Formation |
| 293 | Chroma | 9 | played | no |
| 294 | Cohort | 9 | played | Munda's Vanguard |
| 295 | Fateful hour | 9 | played | no |
| 296 | Parley | 9 | played | Selvala, Explorer Returned |
| 297 | Council's dilemma | 9 | fixed (played) | no |
| 298 | Paradox | 9 | fixed (played) | no |
| 299 | Disappear | 9 | played | Disappear |
| 300 | Pack tactics | 8 | fixed (played) | Battle Cry Goblin |
| 305 | Grandeur | 7 | played | no |
| 306 | Tempting offer | 7 | played | no |
| 307 | Eminence | 6 | fixed (played) | (named in a plan) |
| 308 | Fathomless descent | 6 | played | no |
| 319 | Join forces | 5 | played | Minds Aglow |
| 320 | Secret council | 5 | played | no |
| 321 | Will of the Planeswalkers | 5 | played | no |
| 322 | Sweep | 4 | fixed (played) | Barrel Down Sokenzan |
| 323 | Actualize | 0 |  | no |
| 342 | Covercast | 0 |  | no |
