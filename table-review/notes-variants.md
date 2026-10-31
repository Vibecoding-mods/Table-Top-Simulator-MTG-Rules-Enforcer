# Review notes: variant formats (Treachery, Planechase, dungeons)

Source: subagent review, 2026-10-17. Files are in `table-scripts/`. None of these scripts make web requests or call Global, apart from an unused `getVar`.

## Treachery

- **Randomizer (29b1bb) → KEEP / MANUAL-LAYER.** Pre-game only. Picks role cards for 4-8 players, spawns them face down into a shuffled deck, then destroys itself. It never records who has which role. Manabrew allows 4 players at most, which means 1 Leader, 1 Traitor, 2 Assassins and no Guardian.
- **Counter identities (Seedborn Highness, Void Tyrant, Queen of Light, Bio-Engineer) → MANUAL-LAYER.** The counter values aren't saved.
- **Token-spawning identities → DISABLE the spawn buttons in engine mode** (gate `getToken*` on `ENGINE_MODE`). They create cards the engine doesn't know about. Their token JSON (FaceURL plus the `Memo` oracle_id) can still serve as an image source.
  - Blood Empress, Old Ruler, King over the Scrapyard, Summoner, War Shaman, Grenadier, Gatekeeper, Beastmaster, Chaos Bringer, The Gathering (Goblins).
  - The Marshal: 3,250 of its 3,314 lines are an embedded deck of about 60 tokens.
- **Wearer of Masks (e8fe44) → MANUAL-LAYER.** Deals 4 Traitor cards (plus their tokens) face down into the clicker's hand. Possible bug: `takeObject` runs straight after the spawn.

**Treachery under enforcement:** possible only as a manual layer on top of a free-for-all Commander game. These parts break:
1. Win conditions. Forge only knows free-for-all, so the result has to be conceded or declared by hand.
2. The Leader has to go first, so the engine needs a "set the starting player" option.
3. Unveil costs that need mana or a sacrifice.
4. Unveil and triggered effects that change the game state. These need engine judge/dev actions or custom Forge command-zone cards.
5. "The Leader" and "Undercover" conditions are resolved manually.
6. **Hidden-information leak:** the TTS name of a face-down identity card contains its role, for example "…Identity — Traitor…". The bridge must skip any object named `Identity —` in scans, logs and stray-object cleanup. The pattern to copy is Global's existing `planechase` exclusion (_Global.lua:957/1010/1056).
7. The command-zone layout must leave a slot for the physical identity card.

## Planechase

- **Planechase bag (b7ccfb):** a generic Directsun "memory bag" v2.6.0 that unpacks and recalls objects to saved spots. Verdict: KEEP. If the engine runs Planechase, gate `buttonClick_place` (452) so it doesn't lay out a TTS planar deck of its own.
- **Eternities Map (bae9e7):** a manual planar map. 8-direction arrows shift the planes and deal new ones (`shiftMap` 307, `dealCard` 380); it has no planar die. Forge implements standard Planechase but not the Eternities Map. Verdicts:
  - DISABLE the movement in engine mode.
  - DRIVE-FROM-ENGINE / REUSE the visuals (`l_pos2g_pos` 455, `getCardRot` 473, `moveCards`, highlight, TV mode) to show the engine's current plane(s).

## Dungeons (Undercity, Mad Mage, Lost Mine, Tomb, Baldur's Gate)

All five use one template: each room is a transparent button; clicking one toggles a single colored marker (kept in `self.memo`); some rooms spawn tokens through `spawnTokens` (Undercity 185/242). There's no adjacency check, only one marker for all players, and no initiative tracking.

Verdicts:
- DRIVE-FROM-ENGINE for the marker.
- DISABLE token spawning and free clicking. Forge resolves venture, initiative and room effects itself, so spawned tokens would be duplicates.
- REUSE the `positions`/`width_height`/`labs` tables (room name → button rectangle).
- A room click can become the answer to the engine's "choose next room" prompt.

Changes needed:
- One marker per player.
- An initiative indicator.
- A completed-dungeon count.

## Small existing bugs

- Beastmaster `"Transfaworm"` (line 59).
- Baldur's Gate token counts (Reithwin Tollhouse, Undercity Ruins).
- Eternities Map `hellride` is always true.
- The Randomizer works only once per load.

## Open questions

- Does Manabrew expose Forge's judge/dev actions (create token, move a card, counters, life, starting player, declare winner)?
- Does it load custom Forge card scripts?
- Does Planechase work in Commander through Manabrew, with the planar die?
- Is Baldur's Gate Wilderness (an Alchemy card) in Forge?
- Does the group want Treachery under enforcement?
