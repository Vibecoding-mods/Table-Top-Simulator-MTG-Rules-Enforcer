# How to play: the rules-enforced MTG table

Commander in Tabletop Simulator, with the Forge rules engine running the game: it knows the rules, asks the
questions (targets, blockers, triggers) and moves the cards. You play with the table as usual (drag, tap, click),
and anything illegal snaps back with the reason.

## Host: starting up (once per session)

1. Double-click **Start MTG** (in this folder). It starts Docker, the
   Forge engine, the bridge and TTS. Wait for "Ready" in its window.
2. In TTS: **Create → Multiplayer** (your friends need a server to join), then
   **Games → Saved Games → "MTG 4 player table - ENGINE MODE"**.
3. Friends join your server (Steam invite, or the server browser). Only the host runs Start MTG; friends just need
   TTS.

To shut down: **Stop MTG.bat** in the same folder.

### Optional: GIF frames (a GIPHY key, once)

With a GIPHY key, every seated player gets a GIF frame on their mat (see "GIF frames" below). Getting one takes about
five minutes:

1. In your browser, go to **developers.giphy.com**, open the menu and choose **Dashboard**. Sign in, or make a free
   GIPHY account.
2. Click **Create an App** (some pages say **Create API Key**).
3. Screen 1 of 2: choose **API**, not SDK. The SDK form says "SDK beta key" and asks you to accept the SDK licence:
   that is the wrong one, go back and pick API.
4. Screen 2 of 2: any app name (MTG table is fine), Platform **Other**, a one-line description (GIF frames for our
   Tabletop Simulator table), tick the box that names the **GIPHY API Terms**, then **Create API Key**.
5. Copy the key from your GIPHY dashboard. In the companion's page, open **Table tools**, paste it into the
   **GIPHY key** box and press **Save key**. (The same steps are under that box: **Get a GIPHY key**.)

- Only the host needs a key. Players don't.
- It's free. A new key is a beta key: 100 searches an hour for the whole table.
- The key stays on this PC: never in the table save or the friend package. Don't share it or paste it in chats.
- No key: the GIF frames don't appear, and everything else works as usual. **Remove key** takes them away again.

### Optional: Own server (the engine on another computer)

The MTG Companion for Linux and macOS (`start.sh`, or "MTG Companion.command") can use an engine (the relay and the Forge room) that
runs on a server of yours, instead of starting one on this computer. TTS and the bridge still run here.

1. On the server (Ubuntu or Debian): `sudo bash tools/setup-server.sh`. It runs the relay and a Forge room in Docker, binds
   the relay to your Tailscale address if there is one (else to the server itself: `--bind <ip>` or `--public` change that;
   use `--public` only behind your own firewall), and writes the server's key to `stack/.env` there
   (`MANABREW_SERVER_KEY=...`).
2. In the companion's folder, make a file named `server.json`:

   ```json
   { "host": "mtg.example.org", "port": 9443, "key": "the MANABREW_SERVER_KEY from the server's stack/.env" }
   ```

   Only `host` is needed: a name or an IP address (an IPv6 address in `[brackets]`), without `ws://`. `port` is 9443 unless
   given. `key` is the server's relay key; leave it out to use the `MTG_SERVER_KEY` environment variable, or this
   package's own key. `"secure": true` connects with `wss://` (the relay behind TLS).
3. Start the companion as usual. Its window says "Own server: the engine runs on mtg.example.org:9443". On the status page,
   **Container engine** and **Engine images** say "Not needed here", and **Engine stack** logs in to your server:
   green when its Forge room is open.

If the light is red, it says why, for example:

- "refused the connection: nothing listens on port 9443 there": the port is wrong, or the engine isn't running on the server;
- "didn't answer": the server is off, or its firewall blocks the port;
- "isn't known": the name in `host` doesn't resolve (check the spelling, or use the IP address);
- "refused the key": put the server's key in `server.json` as `"key"`;
- "its Forge room isn't open" or "busy with an earlier game": start or restart the Forge room on the server.

Fix it, then press **Try again**. To use it for one run only: `./start.sh --server mtg.example.org:9443` (the key still comes
from `server.json` or `MTG_SERVER_KEY`). To go back to the engine on this computer, delete `server.json`. **Stop everything**
stops the bridge only; the server's engine keeps running. Keep `server.json` to yourself: the key in it lets anyone
into your server's games.

## Everyone: getting into a game

1. **Sit at a colour** (White, Red, Yellow, Blue).
2. **Bring your deck** the usual way, with the table's Card Importer: the deck on your library spot, your commander
   on your command zone. A [DeckCheck](https://deckcheck.co) link works too (`Importer deck
   https://deckcheck.co/app/deckview/...`, a public or unlisted deck): once the engine is on and before the game
   starts, the deck's bracket and threat level show beside your command zone, e.g. `Bracket 3 · Threat 45 (32-51)`
   (the score and that bracket's usual range). Not affiliated with DeckCheck.
3. Anyone seated turns the engine on with the middle tile (**Engine: on**), or types `mtg engine on`.
4. Press **READY?** on your playmat. It checks every card against the engine:
   - **READY** (green): good to go;
   - **FIX DECK** (red): the chat says what's wrong (an unknown card, no commander, ...).
   On the left rim of the table (where the cannon sits outside engine mode) is **Free mulligans / None**: anyone clicks it for 1,
   2, then back to None (or `mtg friendly 0|1|2`); it's one count for the whole table and everyone is told who changed it. That's
   the free mulligans each player has in all, the rules' free first one in a 3+ player game included. A free mulligan is a new 7
   with nothing put on the bottom. The game says when a player has used theirs.
   AI players take normal mulligans. Your vote stays for a rematch.

   **Your own card art.** Add a picture link to the end of a card's line in the deck list you paste into the Card
   Importer: `1 Sol Ring #https://i.imgur.com/your-picture.png`. Every copy of that card in your deck wears it, in
   every zone (two different links for one card: the first one; basic lands can mix several). The link must be a
   direct https link to a .png, .jpg, .jpeg or .webp file, at most 500 characters, with no spaces or quotes. Pressing
   READY? names the cards wearing your picture, and any link it could not use (that card shows its normal picture).
   Only the picture changes: the name, rules and hover text stay the real card's. Everyone at the table downloads your
   picture from that site, so it must open for everyone, not only you. The host can switch custom art off for everyone
   with `mtg art off` (`mtg art on` brings it back). For now a double-faced card's back and the tokens the game makes
   keep their normal pictures.
5. When everyone is ready, anyone seated presses **Start** on the middle tile.
   - Against the computer: `mtg start ai 1` (up to 3 AI players); `mtg aideck <deck>` (host) picks their deck.
   - **Turn order goes clockwise round the table: White → Red → Yellow → Blue.** A dice roll picks who goes first;
     the next turn is always the seat clockwise of them. AI players take the empty seats.

## Your turn, Arena style

- **Play a land / cast a spell:** drag it from your hand onto your battlefield. Your commander: drag it from the
  command zone (the tax is added for you). Tip: drag from the cards in your hand zone on the table, not from the strip
  at the bottom of the screen: that strip (TTS's own) rises when the pointer touches it, and the card under the
  pointer moves away.
- **The big orange button** (bottom right) is your main answer: **Next** (pass), **Resolve**, **Done**,
  **End turn**. The blue one under it is the other choice. Tip: bind *MTG: pass priority / main button* to **P**
  (Options → Controls → scripting hotkeys). When a new question changes the button's words (Resolve becomes Next),
  a click in the next half second is ignored, so a click meant for the old button doesn't pass by mistake.
- **Floating mana:** mana in a player's pool shows as coloured chips on their life counter, on the side towards
  their mat: one chip a colour, its letter and amount (**G2** = two green, **C** = colourless). Everyone's pool
  shows; the chips go when the pool empties (at the end of each step and phase, unless an effect keeps the mana).
  While you have mana floating, your pass button says so, **Next (3 floating)**: passing loses it.
- **Step banners:** when the table stops to ask you something, the step shows in the middle of the screen (UPKEEP,
  DRAW, MAIN PHASE 1, COMBAT, MAIN PHASE 2, END STEP, CLEANUP), once per step. Never with Auto-resolve on. Turn and
  win banners name the player by their Steam name.
- **Day and night:** once a daybound card makes it day, the bar at the top says **DAY** or **NIGHT**; the log says
  when it changes.
- **Glows tell you what you can do:** green = you can act on it (a target, an attacker, a blocker, a card to pick);
  gold = chosen.
- **Pay mana:** the cost is usually paid for you (Auto-pay uses your lands and other sources before anything it has
  to sacrifice, such as a Treasure); or press **Q/E** on a glowing land or mana source to tap it. Mana already in your
  pool pays for a spell or ability you just started by itself, as on Arena.
- **Attack:** Q/E on a glowing creature makes it attack (click a life counter, planeswalker or battle to pick what it
  attacks), then Done.
- **Block:** click your glowing creature, then the attacker. Done.
- **Tokens:** up to four identical tokens lie side by side; from five they stack as one card with an "xN" label.
  Clicking a stack to attack sends the whole stack (a life counter then aims all of them). To use only some of them,
  or to block or target one, press **Split** in the grey box beside the stack: the tokens lie out one by one until
  the question is answered.
- **Targets:** click the glowing card or player.
- **Exact picks** ("which one stays?", "discard 1"): click the glowing card(s); the last one you need answers. The
  orange button counts them ("1 of 1 chosen") instead of offering Done.
- **Necromancy and similar cards** (sacrificed at cleanup if cast when a sorcery couldn't be): cast outside your main
  phase, the table asks first (**Cast anyway** / **Wait**).
- **Blink and you miss it:** a creature that enters and leaves the battlefield within a few seconds is announced in the
  chat, with what left alongside it.
- **Abilities:** the abilities you can use right now are dark buttons on the card itself (yours only), one short line
  each (its cost and the start of what it does); hover a button for the whole text, click it to use the ability. Pointing at
  the card also shows them as big buttons on the screen. Right-clicking the card shows the same list in its menu.
- **Equip:** drag the equipment onto your creature (or use its Equip button). It works when equipping is legal (your
  main phase, empty stack, mana available); otherwise the table says why.
- **Copies:** a permanent that copies another (Phantasmal Image as your commander) has a purple **COPY** label.
- **Draws and mills wait for you:** click your library (or the table's Draw button) to take the card. With **Auto**
  on (the default) a draw goes by itself after 2 s and a milled card flies straight to your graveyard.
- **Cards you may play from exile or your graveyard** (flashback, foretell, Tibalt, adventure...) sit in a glowing
  row on the near strip of your own mat (below your lands); private ones (foretold) are in the small second hand zone. Drag one onto the battlefield to
  play it.
- **Cards exiled by a permanent** (Banishing Light, O-Ring...) lie half-size under that permanent.
- **Your own face-down cards** (a hideaway card under Mosswort Bridge, a morph): point at the card, or at the land
  it lies under, and its face shows on your screen, left of the ability box. Only you see it.
- **Discarding most of your hand** (cleanup with a huge hand, "discard 2" with 3 cards): the table asks which cards
  to **keep** instead; the rest are discarded. Dragging a card onto your graveyard still discards that card.
- **The same yes/no several times** (Smothering Tithe's "Pay {2}?" for each card you draw, Rhystic Study's for each
  spell): the question offers **No ×3** (the third button, bottom right) to answer all of them at once, and **How many…**
  to answer only some (pick the number, from 1 up). The chat says what was answered. Anything else that happens first
  (another question, a new spell or ability on the stack, a new step) stops it, and the rest are asked as usual. A
  "Pay?" offers only No ×3: paying asks for the mana each time.
- **Long lists** (a creature type, a big search): the last button says **More...** and shows the next page; the
  search box narrows the list.
- **Cancel a cost:** while you choose what to sacrifice, discard, exile or tap to pay for something, **Cancel** (the
  second button, bottom right) takes the spell or ability back. The card returns to your hand and the lands you
  tapped for it untap.
- **Your cards stay on your mat:** move your permanents around your own mat as you like. A card you flick or throw off
  your mat slides back.

## GIF frames (when the host has a GIPHY key)

- Every seated player has a square **GIF frame** on their own mat, in a game or not. Everyone sees it; only you can
  move yours (anywhere on your mat).
- **GIF...** under your frame opens your search panel (only you see it): type words, press Enter, click a result. It
  plays on your frame for everyone for 12 s, then holds a still picture. **Replay** under any frame plays it again.
  **Clear** empties your frame.
- In chat: `mtg gif <words>` shows the first match, `mtg gif off` empties your frame, `mtg gifs hide` / `mtg gifs show`
  hides or shows every frame on your screen only. A GIF that is a **white square** for you (a Steam Deck, Mac or
  Linux TTS can't play the video): `mtg gifs still` shows every frame's still picture instead, on your screen only;
  `mtg gifs video` undoes it.
- Host: `mtg gifs off` / `on` (everyone), `mtg gifs rating g|pg|pg-13` (PG-13 unless changed), `mtg gif clear
  <colour>` empties one player's frame.

## The buttons at the top left (yours only)

A row above Auto-resolve / Fix... / Undo...:

- **Engine: show** — the full question panel (it also opens by itself when a question needs it).
- **Graveyards / exile** — look through everyone's piles.
- **Log** — the game log.
- **Auto** — how fast held draws and untaps happen by themselves.
- **Settings** — your effects and sounds; the host also switches the table's animations.

Under it, **Auto-resolve...** opens a list. Pick one:

- **Off** — you are asked as usual.
- **Other players' turns** — you pass by yourself on their turns; your own turn asks as usual.
- **Until upkeep / draw / main phase / combat / blockers / damage / main 2 / end step** — you pass until that phase next
  comes, on anyone's turn, then the button goes back to off. Your own priority is passed too, so play your lands first.
- **Until my turn** — the same, up to your next turn.

An opponent's spell or ability on the stack ends an "Until" so you can answer, and questions other than priority
(targets, blocks, discards) are still asked. Picking an "Until" turns Other players' turns off.
- **Stop: start of turn / combat / end of turn, and Hold** (in the panel) — where the game waits for you on other
  players' turns.

## When something goes wrong

- **Undo...** (bottom right): rewind to an earlier point; the other players vote. Once everyone agrees it happens at once; if someone still has a question open, a **Rewind to ...** button appears for everyone, and pressing it goes back without answering the question.
- A **phased-out** permanent stays where it was, dimmed, with PHASED OUT in its status box. It counts as not there until it phases in at its controller's next untap step, with its counters and attachments.
- **Fix...** (bottom right): pause the game and put the board right by hand (the engine got a rule wrong, or the
  mistake is too old to rewind). The others vote first, then:
  - move cards where they belong (battlefield, graveyard, exile, library, hand, command zone), turn them to tap or
    untap, flip them face down;
  - drop an aura or equipment onto its permanent to attach it;
  - right-click a card: **Fix: top / bottom of its library**;
  - turn the **life and commander-damage counters**;
  - in chat: `mtg fix token treasure`, `mtg fix token 1/1 green saproling for red tapped`, `mtg fix poison red 2`,
    `mtg fix counters +1/+1 3` (the card under your pointer);
  - press **Done**: the change list is shown, the others vote, and the engine applies it.
- **Scoop** (top, beside your name): concede the game.

## Chat commands

| Command | What it does |
|---|---|
| `mtg help` | the list of commands |
| `mtg ready` | the same as the READY? button |
| `mtg clear deck` | removes your own deck and commander from your seat (when your Delete key does nothing on them); not during a game |
| `mtg friendly 0\|1\|2` | free mulligans each, for everyone, the same as the Free mulligans button |
| `mtg mode 2hg` / `mtg mode ffa` | host: the next games are Two-Headed Giant (White + Red against Yellow + Blue) or free-for-all again. Partners share one life total (80 a team), poison (15 loses) and a commander's damage (42 loses), lose together and see each other's hands. Each player takes their own turn, the team's two turns back to back. Blocking is one team decision: each partner sets their own blockers, sees the team's block line by line, and clicks Agree or changes it; after four changes the team leader's blocks stand. `mtg 2hg turns shared` (host, not yet tried live) makes it one turn for each team: both partners untap, draw, attack and block together, and the team leader (White, or Yellow) puts the team's triggers in order; `mtg 2hg turns own` goes back. House rule (not the official rules): your partner gaining or losing life counts as you gaining or losing it, so your Ajani's Pridemate grows when your partner gains life and "if you gained life this turn" counts their gains (each gain still triggers each card once). All four seats play (Forge AI players fill the empty ones). Commander only |
| `mtg mode 2v2` | host, Standard only (`mtg mode standard` first): 2v2, White + Red against Yellow + Blue, with Standard decks. Each player keeps their own life (20) and turn, no commander; teammates can't attack each other; a team wins when both its opponents have lost. All four seats play. The Teams button on the setup tile offers only the game mode's own: None, 2HG, Juggernaut in Commander; None, 2v2 in Standard. Switching the Game mode sets Teams back to None (said in chat) when the new mode doesn't play it |
| `mtg mode juggernaut` | host: Juggernaut, one player (White unless changed) against the other three. Commander only. The Juggernaut starts with 80 life, 10 cards, draws one extra card each draw step and goes first; it wins when all three have lost, and the three win together when it loses. All four seats play |
| `mtg juggernaut ...` | host: the Juggernaut's settings: `mtg juggernaut <colour>` (who), `life <n>` or `life auto`, `hand <n>`, `draw <n>` (extra cards), `land <n>` (extra land plays), `cmd 21` or `cmd 42` (commander damage that knocks it out), `order first` or `order after` (a turn after every challenger's); `mtg juggernaut` alone says the settings |
| `mtg team <colour> 1\|2` | host, after `mtg mode 2hg` or `mtg mode 2v2`: move a seat to team 1 or 2 (in Two-Headed Giant partners must sit next to each other in turn order; 2v2 takes any 2 + 2) |
| `mtg engine on` / `off` | anyone seated: the rules engine on or off |
| `mtg start [ai N]` | anyone seated: start (optionally with N Forge AI players) |
| `mtg reset` | host: end the game and give the imported decks back (anyone seated once the game is over) |
| `mtg undo [N]` / `mtg vote yes/no` | rewind, and the vote on it (the player who asked: `mtg vote no` takes it back) |
| `mtg hold` / `mtg hold off` | keep priority once after something goes on the stack, to respond to your own trigger or with an ability (or press Hold); over your own spell you are asked anyway when you hold a spell to cast |
| `mtg skip <phase>` / `mtg skip off` | the Auto-resolve list's "Until" choices, typed: upkeep, draw, main, combat, blockers, damage, main2, end, mine |
| `mtg timer [seconds]` / `mtg timer off` | turn timers for everyone (host) |
| `mtg art off` / `mtg art on` | host: everyone sees the normal card pictures / the pictures players linked in their deck lists (`1 Sol Ring #https://...`) |
| `mtg fix` (`yes` / `no` / `done` / `cancel`) | the manual fix, as the Fix... button |
| `mtg concede` | leave the game (twice within 15 s); in Two-Headed Giant it concedes for your whole team (in 2v2 and Juggernaut only for you) |
| `mtg effects on/off`, `mtg sounds on/off` | your own effects and sounds |
| `mtg sounds test <kind> [N]` | host: play one table sound now, with N the one for N at once (death 5 plays the 4-stack); kinds: knockout, wipe, death, exile, damage, lifegain, instant, counter (counter and knockout have no sound yet) |
| `mtg mana 99` | (testing) a manual fix in one line: 99 of each mana until the end of the turn |
| `mtg debug <scenario>` / `list` / `off` | (testing) a test board from `scenarios/<name>.json`: 20 lands out (the commander's colours, or the lands the file names) and the scenario's cards in hand, plus anything it puts in other zones for you or the opponents. Typed before a game, it is set up at your first priority on your own turn (your opening hand is kept by itself); during one, at the next moment with nothing on the stack. Other players vote as for any fix |
| `mtg gif <words>` / `mtg gif off` / `mtg gif help` | your GIF frame: the first match for the words / empty it / the GIF commands |
| `mtg gifs hide` / `show` | every GIF frame hidden or shown on your screen only |
| `mtg gifs still` / `video` | every GIF frame's still picture instead of the moving GIF, on your screen only (for a GIF that is a white square for you) |
| `mtg gifs on\|off`, `mtg gifs rating g\|pg\|pg-13`, `mtg gif clear <colour>` | host: the GIF frames for everyone, their rating, one player's frame emptied |
| `mtg aideck <name>[, <name>...]` | host: the deck(s) the Forge AI players get (one name per AI; a new list replaces the old) |

## Trouble?

- **"Room not found" or the game won't start:** run Start MTG again (it gives you a fresh room), then Start.
- **A friend's buttons don't react:** reload the save (the screen UI is rebuilt for everyone who is seated), and
  tell Claude what they see. Their TTS log is
  `%USERPROFILE%\AppData\LocalLow\Berserk Games\Tabletop Simulator\Player.log`.
- **Something looks stuck:** the bridge restarts itself; its log is `tmp/bridge-live.log`.
