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

## Size

About 3–4 h with the checker, the code review and a real-table run. Renderer and a little bridge (the play option per
face is already sent). No engine change.
