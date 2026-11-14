# See and cast a card's other side (asked 2026-11-06)

The user's words: be able to see the other side of a card to cast it (Valki, God of Lies // Tibalt, Cosmic Impostor)
or just to read it (Exdeath, Void Warlock // Neo Exdeath), reusing TTS's own object states (state 1 and 2).

## What the table does today (read from source, 2026-11-06)

- A double-faced card is one TTS card whose picture back is its other face (`CustomDeck` `FaceURL` / `BackURL`).
- **Battlefield and command zone:** flipping it (F, `Player.Action.FlipOver`) shows the other face, for looking only
  (`engineFlipped`, tools/engine-renderer.lua ~3600; the engine's card is unchanged).
- **Hand:** the bridge gives every hand card the plain Magic back (`b: DEFAULT_BACK`, bridge/bridge.js ~2615), because
  TTS shows the other players a hand card's back, and a double-faced card's back would show them its other face
  (playtest 2026-10-25: a daybound card in Yellow's hand showed its night side). So **in your hand you cannot read
  the other face today.**
- **Casting the back:** the cast button already offers it ("Cast Tibalt, Cosmic Impostor (back face)", play modes such
  as `backFaceLand`), but you have to know it is there; nothing on the card shows the back.
- Graveyard, exile and the stack: the picture back is the other face, but those cards can't be flipped.

## Wanted

1. **Read the other side anywhere you can see the card:** your hand, your battlefield and command zone, and any
   graveyard, exile or stack card (both faces of a double-faced card are public there).
2. **Cast from the side you're looking at:** in your hand (or another zone you may cast from: command zone,
   playable exile, top of library), showing the back face and clicking casts the back face; showing the front casts
   the front. The existing cast list keeps both choices; the shown side only puts its own first.
3. **Privacy kept:** the other players still see the plain Magic back of your hand cards, whichever side you look at.

## Design: TTS object states

TTS lets one object hold several states (right-click → States, or the state number keys / PageUp-PageDown while
hovering). Each state is a full object of its own, with its own picture and back.

- A double-faced card is spawned with two states:
  - state 1: its front face, back = the plain Magic back;
  - state 2: its other face, back = the plain Magic back.
  Only cards with two faces (transforming, modal double-faced, meld halves); adventures, split cards and Rooms are
  one face and keep today's cast list.
  Because both states use the plain back, a hand card shows only the Magic back to other players in either state.
  Outside a hand, the plain back is never seen face up, so nothing is lost.
- Flipping (F) on the battlefield keeps today's behaviour and also works by state: the "looks only" rule stays.
- The shown state drives the click: `engineMeta`/`engineFace` record which face is up; a cast click on a card in
  state 2 picks the back-face play option ("(back face)", `backFaceLand`, the MDFC's back), in state 1 the front's.
  If the shown side can't be cast right now, the table says so ("Tibalt, Cosmic Impostor can't be cast right now")
  instead of casting the other side.
- A transformed permanent (Neo Exdeath on the battlefield) is spawned with the engine's current face as state 1, so
  the state number never claims to change the game: changing state is always looking, never transforming.
- Hover tooltip / name: the card's name line names both faces ("Valki, God of Lies // Tibalt, Cosmic Impostor").

## Things to check in real TTS before building (risks)

- **Changing state replaces the object** (`setState` returns a new object; the old one is destroyed). The renderer's
  maps (`engineObjs`, `engineFace`, `engineMeta`, holds, highlights, buttons on the card) must follow the new object.
  TTS calls `onObjectStateChange(obj, oldGuid)`? To confirm in the scripting API and on the real table; if it doesn't
  exist, catch it with `onObjectSpawn` and the GM notes `engine:<id>`.
- **Object budget:** states are stored as data inside the card, not as loaded objects, but each state's picture is a
  separate texture once shown. Measure "Loaded Objects now" with a hand of 7 double-faced cards and a board of 20
  (the ~78k rule, see tts-live-spawn-crash).
- **Rewind snapshots:** a card with states is a bigger object to save (tts-perf-facts: big CustomDeck numbers slowed
  snapshots). Both states share the card's existing deck key range.
- **A hand card changing state** must stay in the hand zone and keep its hand position (a locked card drops out of
  its hand zone: mtg-pending-deploy note).
- **Other seats:** confirm a remote player's hand card in state 2 shows the Magic back to everyone else.

## Tests

- Table golden: a double-faced card in hand gets two states, both with the plain back; on the battlefield, state 1
  is the engine's current face.
- Click: casting from state 2 sends the back-face action; from state 1 the front; a side that can't be cast says so.
- Real table: Valki // Tibalt in hand, switch to Tibalt and cast it (7 mana); Exdeath in the command zone and
  transformed on the battlefield, read the other side; a second seat sees only Magic backs.

## Built (2026-11-11), not yet seen in real TTS

- **Bridge** (`otherSide`, `actionSide` in bridge/bridge.js): a card has two faces when Scryfall's cached picture has a
  back (the engine's `isDoubleFaced` is false for a modal double-faced card: Forge's `Card.isDoubleFaced` is transform
  or meld only). Tokens and copies have one. Such a card goes out with `o2` (the other face's picture, in a hand too) and
  `n2` (its name, from Scryfall's `card_faces`; a cache entry from before names were kept asks Scryfall once per bridge
  run and keeps its picture). Each priority option of such a card carries `side`: Forge's harness names the face in the
  label ("Cast Tibalt, Cosmic Impostor", "Play Emeria, Shattered Skyclave", mode `normal` for both faces), so a label
  naming the card's own name is side 1 and any other side 2 (`backFaceLand` mode is 2). A drag with `side` plays that
  side's ways (with any of no side, cycling); none: "Tibalt, Cosmic Impostor can't be cast right now. Valki, God of Lies
  can: show that side and drag it again." A drag without `side` (an older table) asks among them all as before. A drag
  kept for the next priority keeps its side and never casts the other one.
- **Table** (tools/engine-renderer.lua): a card on its own with `o2` is spawned with `States["2"]` (`engineCardData`):
  the other face, the plain back behind it where state 1 has it (a hand), else state 1's face. Both states carry the
  same GM notes, tag, lock and name line ("Valki, God of Lies // Tibalt, Cosmic Impostor"). A player's state change is
  adopted (`engineAdoptState`, from `onObjectStateChange` and, should TTS fire only a spawn, from the spawn watcher):
  the new object becomes the card's, nothing is respawned, badges, glow and the right-click list are drawn again.
  The drop sends `side` (`engineShownSide`: state 2, or state 1 turned over in the command zone or battlefield), and the
  right-click list puts the shown side's ways first (`engineSideFirst`). Pile and library members keep one state; a
  card taken out of one onto the table is replaced to get its second state.
- **No engine change.** Graveyard, exile and stack cards are piles or the pop-up, unchanged (the back is the other face).
- **Tests:** `node tests/test_card_other_side.js` (a gate).
- **To check in real TTS:** the risks above, in particular that `onObjectStateChange` fires and a hand card in state 2
  stays in the hand; Valki in hand → state 2 → drag casts Tibalt; Exdeath in the command zone and transformed on the
  battlefield, state 2 reads the other side; a second seat sees only Magic backs.

## Every two-sided layout (audit and fixes 2026-11-13, branch other-side)

Forge's layouts are its `CardSplitType` (forge-core `CardSplitType.java`: None, Transform, Meld, Split, Flip,
Adventure, Omen, Modal, Prepare, Specialize; the script line is `AlternateMode:`, a transforming card's is
`DoubleFaced`), plus Prototype, a keyword on a one-faced card. In Forge's cardsfolder (2026-11-13): DoubleFaced 399,
Adventure 151, Split 128 (Rooms, fuse and aftermath among them), Modal 100, Prepare 72, Flip 20, Specialize 19, Omen 16,
Meld 14, `K:Prototype` 21. The states a card can be in are its `CardStateName`: Original, FaceDown, Flipped, Backside,
Meld, LeftSplit, RightSplit, Secondary (adventure, omen), PreparedSpell, EmptyRoom, SpecializeW/U/B/R/G; every one is a
row below. What the engine sends, read from the harness and Forge:

- **Name**: `Card.getName()`, the state it is in: the front in a hand, the back face when transformed ("Neo Exdeath,
  Dimension's End"), "Kenzo the Hardhearted" flipped, "Brisela, Voice of Nightmares" melded, "Fire // Ice" whole (Forge
  sets a split card's name to both halves), and the part being cast on the stack ("Stomp", "Fire", "Ribbons").
- **Text**: the state's oracle text only (`Card.getOracleText`), except a split card, whose whole text is both halves
  ("(Fire) ...\r\n\r\n(Ice) ...", `CardFactory.readCard`). So in a hand an adventure card's text has no Stomp, a
  modal double-faced card's no Tibalt.
- **Ways**: `formatActionLabel`: "Cast <the face's name>" / "Play <the face's name>" (the ability's card state, so a back
  face or a half names itself), " (<AlternativeCost>)" after it ("Cast Starscream, Seeker Leader (MTMtE)", "Cast
  Generous Soul (Disturb)"), " (Prototype)" for a prototype cast; a fused split card is "Cast Wear // Tear".
- **Pictures** (Scryfall): two for modal double-faced and transforming cards; one for flip, split, fuse, aftermath,
  Room, adventure, omen and prototype cards (Scryfall's `card_faces` with no own pictures); a meld half is a card of
  its own with one picture, the melded card (Brisela) another (`all_parts`, `meld_result`). Scryfall's batch lookup
  finds a card by any face's name (it answers "Kenzo the Hardhearted" with "Bushi Tenderfoot // Kenzo the Hardhearted")
  but not by a split card's whole name. **It also answers a classic card's name with a newer card that has a face of that
  name**: "Lightning Bolt" with Emeritus of Conflict // Lightning Bolt, "Channel" with Yavimaya Bloomsage // Channel
  (25 of Forge's 72 prepare cards copy a classic spell, `CopyFaceFrom:`); its exact-name lookup
  (`/cards/named?exact=`) answers the classic card. Prepare cards are Scryfall's layout `prepare`, one picture. A
  specialize card (Alchemy) is `normal`, each specialized version a card of its own (Alora, Cheerful Thief), listed
  in the base card's `all_parts`. Scryfall's `reversible_card` printings were not its answer to a name (Zndrsplt, Eye
  of Wisdom came back `normal`), and a `double_faced_token` is a token, which gets no other side here (`otherSide`).

| Layout (example) | Hand / command / playable row | Battlefield | Stack, graveyard, exile | Ways | Before (2026-11-11 build) | After (other-side) |
|---|---|---|---|---|---|---|
| Modal DFC (Valki // Tibalt, Emeria's Call, Shatterskull Smashing, Pathways) | state 2 = back face; cast the side shown | the face it was cast as; the other face as state 2 / flip | one state (piles); the picture back is the other face | "Cast Valki", "Cast Tibalt", "Play Shatterskull, the Hammer Pass", "Play Grimclimb Pathway" | states, side-cast, refusals; the back's rules text nowhere but its picture (state 2's hover showed the front's text) | + the other face's rules text in the hover (both states, piles too); tested with Scryfall's real cards, two-land Pathway |
| Transform (Exdeath, Delver, daybound, Fable of the Mirror-Breaker, MTMtE Starscream, Disturb Beloved Beggar, battles: Invasion of Zendikar // Awakened Skyclave) | state 2 = back face, to read; the back cast only by MTMtE / Disturb | transformed: named and pictured as its back, the front its other side | as above | front "Cast Exdeath"; "Cast Starscream, Seeker Leader (MTMtE)", "Cast Generous Soul (Disturb)" = side 2 | states, side 2 for MTMtE / Disturb (untested); back text not in the hover | + back text; MTMtE, Disturb (from the graveyard's playable row), a flip saga, a battle and a transformed permanent tested |
| Meld (Gisela + Bruna = Brisela) | — | the halves; melded, Brisela | — | each half cast as itself | a half had no other side (Scryfall gives it no back); Brisela showed its own picture | a half's other side is Brisela: picture as state 2, name, text (Scryfall's `meld_result`); Bruna, which Forge's index gives one face, found by its "Melds with" text |
| Flip (Bushi Tenderfoot // Kenzo the Hardhearted) | one picture, both halves on it | flipped: "Kenzo the Hardhearted" | — | "Cast Bushi Tenderfoot" | **flipped card had no picture**: the decks know "Bushi Tenderfoot", the face name was never cached and was asked of Scryfall on every board (376 asks in one harness run); Kenzo's text not in the hand's hover | the deck's picture of the card; asked once; the other half's name and text in the hover. **Not** turned 180° (see below) |
| Split (Fire // Ice) | one picture, name and text both halves | — | on the stack the half's name | "Cast Fire", "Cast Ice": a drag asks which | right half on the stack ("Ice") re-asked on every board, no picture; left half Scryfall's printing, not the deck's | the deck's printing; every half cached from Scryfall's answer for the whole card; a half by its own name (Ice on the stack) has no other side either (Scryfall's `split` layout) |
| Fuse (Wear // Tear) | as split | — | as split | + "Cast Wear // Tear" read "Cast both halves (fuse)" | worked (hp-15) | unchanged, tested |
| Aftermath (Cut // Ribbons) | as split; Ribbons from the graveyard's playable row | — | "Ribbons" on the stack | "Cast Cut"; "Cast Ribbons" from the graveyard | castable; Ribbons on the stack re-asked on every board, no picture | picture, asked once |
| Room (Unholy Annex // Ritual Chamber; Scryfall `split`; state EmptyRoom, no door unlocked) | as split | doors (room badges, unlock modes) | — | right door / unlock modes | its own feature | unchanged (no other side: both doors in the name; a door by its own name is a `split` half), tested |
| Adventure (Bonecrusher Giant // Stomp), Omen (Dirgur Island Dragon // Skimming Strike) | one picture; the spell's text not in the engine's | the creature | "Stomp" on the stack; exiled on an adventure, cast from the playable row | "Cast Bonecrusher Giant", "Cast Stomp": a drag asks which | Stomp's text only on the picture; Stomp on the stack re-asked on every board, no picture | named "Bonecrusher Giant // Stomp", Stomp's text in the hover; the stack shows the deck's picture; asked once |
| Prepare (Abigale, Poet Laureate // Heroic Stanza; Emeritus of Conflict // Lightning Bolt; state PreparedSpell) | one picture; the spell's text not in the engine's | prepared (notePrepared's status box) | the spell's copy, a token in exile, linked to its creature | "Cast Abigale, Poet Laureate"; the copy's "Cast Heroic Stanza" from the playable row | the spell's text only on the picture; the copy named after its spell had no picture of its own | the spell's name and text in the hover; the copy shows its deck's picture of the creature's card; **a classic spell's own card (every Lightning Bolt) is not given the creature as its other side**: Scryfall's face entry is kept off by Forge's index, and the classic card is found by its exact name (both 2026-11-13); tested |
| Specialize (Alchemy, Alora, Rogue Companion; states SpecializeW/U/B/R/G) | one face | specialized: Forge names it after that version ("Alora, Cheerful Thief") | — | the base card's cast | Scryfall's picture of that version, by its name (a card of its own there; the deck has only the base card) | unchanged, tested; no other side: five versions, chosen once and for good, none of them the card's back |
| Face down (morph, disguise, manifest, cloak, foretell, hideaway; state FaceDown) | foretold: in the seat's own playable row with its face | a 2/2 with no name, picture or text (tableCard), its face to the seats that may look (facePeek) | exiled face down: the same | "(face down)" casts | its own feature | unchanged: not another side of the card, and never sent to the table as one (the board goes to every seat) |
| Prototype (Autonomous Assembler) | one face | its prototype P/T on the badge | — | "Cast X", "Cast X (Prototype)": a drag asks which | worked (kw-14) | unchanged, tested |

**TTS states where they help:** only a card with a second picture (modal double-faced, transforming, a meld half) gets
state 2. A card printed whole on one picture (flip, split, fuse, aftermath, Room, adventure, omen, prepare, prototype) would
get a second state with the same picture: nothing new to look at, so it has none, its hover names and reads both
parts, and a drag asks which way (Arena's question, "Bonecrusher Giant: how do you play it?").

**Not done, deliberately:** a flipped Kamigawa card is not turned 180° on the battlefield. Turning it would turn its
badges and buttons (P/T, counters, ability buttons) upside down for its controller, and the table's self-check reads a
card 180° off as tapped (`engineSelfCheck`, ±45° rule). Its name line and hover read Kenzo; the picture shows Kenzo
upside down, as the printed card does.

**How (bridge only, plus one line of the renderer):** `scryEntries` caches every name a Scryfall card may go by,
with its layout (`l`), face names and rules texts (`faces`, `texts`) and a meld half's result (`meld`); `putImage`
adds those to an old entry without changing its picture. `otherSide` returns `{ pic, name, text }` for every layout
above but split (pic null for one picture), asking Scryfall once per run for an entry from before layouts were kept
(a back, Forge's index giving the card two faces, or a meld text). `wholeCardName` gives a face of a one-picture card
its deck's picture (a token too: a prepared spell's copy). `actionSide` marks sides only for a card with two pictures.
The bridge sends `t2` (the other side's text) as a static detail; `description` (tools/engine-renderer.lua) adds it to
the hover text. No new Lua locals.
A face name Forge's index gives another card (Lightning Bolt, Channel, Reanimate: prepare spells that copy a classic
card) is not cached from the newer card (`scryEntries`), and a name Scryfall's batch lookup answered with another card
is asked once of its exact-name lookup (`fetchImages`, `exactAsked`), which finds the classic card.

**Tests:** `tests/test_card_other_side.js` section 4, from Scryfall's real answers
(`tests/golden/fixtures/scryfall-two-sided.json`, fetched 2026-11-13; prepare, battle and specialize cards and the
real Lightning Bolt added the same day) and Forge's label rules; each layout's checks were shown to fail by name with
its code broken (16 mutations, then 8 more for the additions, each file restored and checked by sha256; on
2026-11-14 the additions' mutations run again: the exact-name lookup asked on every board survived, and a check with an
exact-name answer that caches nothing under the name asked now catches it).

**To check live:** Valki in hand, hover shows Tibalt's text in both states; Gisela in hand turned to state 2 shows
Brisela; a Bushi Tenderfoot that flips keeps its picture; Bonecrusher Giant's hover reads Stomp and Stomp on the stack
shows the card; a prepare creature's hover reads its spell and its prepared copy in exile shows the creature's card;
a deck's Lightning Bolt (or Channel) has no other side; plus the 2026-11-11 list above (state change adopted, hand
privacy, Tibalt cast from state 2).

## Size

About 3–4 h with the checker, the code review and a real-table run. Renderer and a little bridge (the play option per
face is already sent). No engine change.
