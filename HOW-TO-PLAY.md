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

The MTG Companion (on Windows, and on Linux and macOS: `start.sh`, or "MTG Companion.command") can use an engine (the relay
and the Forge room) that runs on a server of yours, instead of starting one on this computer. TTS and the bridge still
run here. On every system it is set with a file, `server.json`, in the companion's folder (step 2): there is no box on
the status page for it. A friend uses the host's engine the same way, with the host's server key.

1. On the server (Ubuntu or Debian): `sudo bash tools/setup-server.sh`. It runs the relay and a Forge room in Docker, binds
   the relay to your Tailscale address if there is one (else to the server itself: `--bind <ip>` or `--public` change that;
   use `--public` only behind your own firewall), and writes the server's key to `stack/.env` there
   (`MANABREW_SERVER_KEY=...`).
2. In the companion's folder, make a file named `server.json`:

   ```json
   { "host": "100.64.0.5", "port": 9443, "key": "the MANABREW_SERVER_KEY from the server's stack/.env" }
   ```

   `host` and a key are needed. `host` is a name or an IP address (an IPv6 address in `[brackets]`), without `ws://`.
   `port` is 9443 unless given. `key` is the server's relay key; leave it out only to use the `MTG_SERVER_KEY` environment
   variable instead (with neither, the light says so: this package's own key is never sent to a server).
   Use Tailscale to reach the server: both computers join the same Tailscale network, and `host` is the server's Tailscale
   address or name (we don't recommend a relay on the internet, with or without TLS). Keep the file private:
   `chmod 600 server.json` (the companion does this itself when it finds the file readable by others). On Windows the
   companion encrypts the key in `server.json` for your Windows account the first time it reads it.
3. Start the companion as usual. Its window says "Own server: the engine runs on mtg.example.org:9443". On the status page,
   **Container engine** and **Engine images** say "Not needed here", and **Engine stack** logs in to your server:
   green when its Forge room is open, amber when the server runs another engine build than your table was deployed
   with (ask the host to update the server, or update your package).

If the light is red, it says why, for example:

- "refused the connection: nothing listens on port 9443 there": the port is wrong, or the engine isn't running on the server;
- "didn't answer": the server is off, or its firewall blocks the port;
- "isn't known": the name in `host` doesn't resolve (check the spelling, or use the IP address);
- "refused the key": put the server's key in `server.json` as `"key"`;
- "its Forge room isn't open" or "busy with an earlier game": start or restart the Forge room on the server.

Fix it, then press **Try again**. To use it for one run only: `./start.sh --server mtg.example.org:9443`. For the host
`server.json` names, that changes only the port; for another host, nothing of `server.json` is used (not its key, port
or `secure`: a key is never sent to a server it wasn't written for), so set `MTG_SERVER_KEY` to that server's key. To go
back to the engine on this computer, delete `server.json`. **Stop everything** stops the bridge only; the server's engine
keeps running (with a `server.json` that has a problem, it stops the engine on this computer, as without a server).
`mtg reset` can't restart the Forge room on a server: it says to restart the room on the host's server. When a room is
stuck ("busy with another game"), restart it there (`docker compose -f stack/compose.yml restart forge-room` in its folder). A bridge left running for another engine
is restarted when you press **Start engine** (never during a game). Keep `server.json` to yourself: the key in it lets
anyone into your server's games.

### The companion: updates, and going back (friend package on Windows)

- **Check for updates** (on the status page, or right-click the tray icon) asks the project's Releases page whether a newer
  package is out. It only installs releases signed with the project's key, never whatever was last pushed to the repository.
  The line says what the release changes, for example "changes the table and the app" (the table, the app, the engine). Nothing
  installs until you press **Update now**, and never during a game: it waits, and installs 2 minutes after the game ends.
- Each update keeps a copy of what it replaced. **Revert to v…** (beside Check for updates, and in the tray menu) goes back to
  the version before the last update: the table, the app and the engine as they were, and the companion itself if the update
  changed it. It asks first, and during a game it waits like an update. If something goes wrong half way (even a power cut), the
  companion finishes or undoes it the next time it starts.
- It is greyed out (**Revert update**) when there is no earlier version to go back to, for example before the first update.
- After going back, the companion won't offer that same release again by itself. Press **Check for updates** when you want it,
  or wait for a newer release.
- On Linux and macOS the companion only checks for updates; it doesn't install them, so there is nothing to go back to. To go
  back there, unpack the older package from the Releases page beside this one (your table save stays).

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
   with `mtg art off` (`mtg art on` brings it back). A double-faced card imported with both faces shows the deck's
   picture for its back too. For your tokens and backs: `mtg art token <token name> <link>` (every token of that name
   you make), `mtg art back <card> <link>` (your two-faced card's back); `mtg art token clear` / `mtg art back clear`
   take them off. Your pictures follow you (your Steam account), not the seat colour.
5. When everyone is ready, anyone seated presses **Start** on the middle tile.
   - Against the computer: `mtg start ai 1` (up to 3 AI players; up to 5 on the six-seat table); `mtg aideck <deck>`
     (host) picks their deck.
   - **Turn order goes clockwise round the table: White → Red → Yellow → Blue.** A dice roll picks who goes first;
     the next turn is always the seat clockwise of them. AI players take the empty seats. Some games pick the first
     player instead: in Treachery the Leader goes first, in Archenemy the archenemy, in Juggernaut the Juggernaut, and
     in a best-of-three match game 1's roll (see "Best of three" below).

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
  or to block or target one, press **Split the N to pick one by one** (on the stack and on your screen): the tokens
  lie out one by one until the question is answered. Tokens are "identical" when they have the same name, controller,
  tapped or not, power and toughness, damage, counters and keywords, with nothing attached. **Treasure** (and Clues,
  Food...) stack the same way; paying a cost spends your lands and other mana sources before any Treasure. A stack
  of infinitely many tokens reads **x∞** (the engine keeps 500 real ones).
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
- **Cost badges:** when a card would cost something other than what is printed (a cost reducer, a tax, the commander
  tax), a small box over its generic mana shows the new generic amount (**3**, not "+1"), with a thin rim under it:
  **green** cheaper, **red** dearer. A change to a coloured symbol is a chip beside the cost, such as **-G** or **+BB**.
  Badges show in your hand, your command zone and the row of cards you may play from elsewhere, never on the
  battlefield and never on a face-down card. Hover the card for the words: "Costs {2}{R} now by flashback (printed
  {R})". A split or adventure card has no badge; its hover gives each half ("Stomp: costs {2}{R} now (printed
  {1}{R})"), and a card in the row lists "Other ways to cast it" too. A foretold card shows its foretell cost in its
  hover. A card from your graveyard says **FROM GRAVEYARD** across its picture.
- **Battles:** a battle sits on its controller's battlefield with its defense counters as the number in its corner.
  When one enters, its controller picks which opponent protects it. Attack it like a player: click it as the attack's
  target. Its protector's creatures are the only ones that can block for it, and the protector can't attack it.
  Every 1 damage takes off a defense counter; at 0 it is defeated, and its controller may cast its back face free.
  Hover it for the details.
- **Draws and mills wait for you:** click your library (or the table's Draw button) to take the card. With **Auto**
  on (the default) a draw goes by itself after 2 s and a milled card flies straight to your graveyard.
- **Cards you may play from exile or your graveyard** (flashback, foretell, Tibalt, adventure...) sit in a glowing
  row on the near strip of your own mat (below your lands); private ones (foretold) are in the small second hand zone. Drag one onto the battlefield to
  play it.
- **Cards exiled by a permanent** (Banishing Light, O-Ring...) lie half-size under that permanent.
- **Your own face-down cards** (a hideaway card under Mosswort Bridge, a morph, a foretold card): point at the card,
  or at the land it lies under, and its face shows on your screen, left of the ability box ("Face down under Mosswort
  Bridge, only you see it"). Only you see it; everyone else sees "Face-down card".
- **Discarding most of your hand** (cleanup with a huge hand, "discard 2" with 3 cards): the table asks which cards
  to **keep** instead; the rest are discarded. Dragging a card onto your graveyard still discards that card.
- **The same yes/no several times** (Smothering Tithe's "Pay {2}?" for each card you draw, Rhystic Study's for each
  spell): the question offers **No ×3** (the third button, bottom right) to answer all of them at once, and **How many…**
  to answer only some (pick the number, from 1 up). The chat says what was answered. Anything else that happens first
  (another question, a new spell or ability on the stack, a new step) stops it, and the rest are asked as usual. A
  "Pay?" offers only No ×3: paying asks for the mana each time.
- **An infinite loop you may stop** (Kiki-Jiki + Zealous Conscripts, a sacrifice-outlet loop; rule 732.2): play one
  pass by hand, back to the same board (your same permanents, tapped or untapped, and the same stack). Your priority then
  offers **Repeat ×N** (the third button, bottom right): pick ×1, ×10, ×100, ×1000 or **How many…**, or type
  `mtg repeat 100`. The table answers the same questions the same way that many more times and shows "Repeating 37/100"
  with **Stop**. Every other player still gets priority each pass and may respond. It stops at once, and the chat says
  why, when a question differs from your pass, a card or target is gone, someone plays something, the step changes or
  the game ends; Stop or `mtg stop` ends it too.
  While someone else repeats a loop, your panel offers **No responses for this loop (Blue repeating ×1000)** (also the
  third button in your priority). Press it and your priority passes are answered for you for the rest of that loop; your
  own triggers still go on the stack and their questions are still asked. It ends when the loop ends or stops or the
  step changes. **Stop** on your panel (or `mtg stop`) turns it off at once and asks your next priority, so you can
  still respond and stop the loop.
- **Long lists** (a creature type, a big search): the last button says **More...** and shows the next page; the
  search box narrows the list. A question that lets you pick any number of cards offers **All (N)** and **None**.
  Scrying or surveilling more than 5 cards offers **All on top**, **All on the bottom** or **All into the graveyard**.
- **Big turns:**
  - copies of a spell (Storm, Thousand-Year Storm) ask once: "N copies of Grapeshot: keep their targets?", with
    **Keep targets for all ×N** or **Choose each**;
  - identical triggers show once, with "×N";
  - a hand of more than 40 cards shows the first 40, and a "+N more in hand" card beside your library opens the rest
    in the Engine panel;
  - an attack tax (Ghostly Prison) asks once for all your attackers: **Pay {2} for all 3**, **Don't attack Blue**, or
    **Back**;
  - when a turn passes the engine's limit (a loop with no way to stop it), the table asks **Keep going** or **End in
    a draw**; `mtg stop` stops a long run of triggers resolving by itself.
- **Cancel a cost:** while you choose what to sacrifice, discard, exile or tap to pay for something, **Cancel** (the
  second button, bottom right) takes the spell or ability back. The card returns to your hand and the lands you
  tapped for it untap.
- **Your cards stay on your mat:** move your permanents around your own mat as you like. A card you flick or throw off
  your mat slides back.

## GIF frames (when the host has a GIPHY key)

- Every seated player has a square **GIF frame** on their own mat, in a game or not. Everyone sees it; only you can
  move yours (anywhere on your mat).
- **GIF...** under your frame opens your search panel (only you see it): type words, press Enter, click a result. It
  loops on your frame for everyone, all the time. **Clear** empties your frame.
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

- **Undo...** (bottom right): **Rewind to...** lists the newest 12 points (upkeep, main phase, attacks and second
  main phase of each turn, such as "turn 4, Blue's attacks"). Pick one; the others vote in a pop-up (**Rewind** /
  **Keep playing**, or `mtg vote yes` / `mtg vote no`), and you can take it back with Keep playing. Once everyone
  agrees it happens at once; if someone still has a question open, a **Rewind to ...** button appears for everyone, and
  pressing it goes back without answering the question. Undo is off in Archenemy games ("the schemes in play can't be
  rewound yet").
- **A game that can't end:** when a player can't lose (Platinum Angel, "can't lose life", all damage to them
  prevented), a pop-up offers a tie: "<who> can't lose the game: the game may never end. A tie is offered." Each
  seated player presses **Tie** or **Keep playing** (or `mtg tie yes` / `mtg tie no`); AI players accept. If everyone
  accepts, the game is a draw. If someone keeps playing and nothing changes for 3 full rounds (no life lost, no poison
  or commander damage, no permanent leaving the battlefield, no card milled, nobody losing), the game ends in a forced
  tie, with a warning each round. A forced tie gives everyone the **Stalemate** accomplishment (`mtg accomplishments`
  lists yours).
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
- **Dropped out?** The game keeps your seat and cards. Rejoin TTS and sit at your colour: your screen says **Rejoining: the table is updating for you...** while your hand and board are drawn again, then **You're back in** (the same after an engine reconnect, a bridge restart, or an Undo to before you conceded). If it says **Couldn't rejoin**, the chat says what to do; `mtg refresh` draws your own view again.

## Best of three (Standard, one against one)

- The host types `mtg mode standard`, then `mtg match bo3` (`mtg match bo1` goes back to single games). Two seats play,
  one may be an AI.
- **Game 1:** a roll for who goes first, two d20, shown on everyone's screen ("BLUE WINS THE ROLL (14–7)"). The roll's
  winner goes first. (Letting the winner choose play or draw is coming.)
- **After each game:** the loser is asked **Play**, **Draw** or **Concede match** for the next game (after a drawn game,
  the same player as before). An AI that lost plays first.
- **Sideboarding:** a player whose deck came with a sideboard is asked **Keep deck**, **Swap cards** (take cards out,
  then bring sideboard cards in; the main deck keeps 60 or more, the sideboard at most 15) or **Reset to registered**.
  Only you see what you swapped; the others see "Blue is done sideboarding for game 2". The next game waits until every
  player is done.
- **Your sideboard, for a deck you import on the table:** the Card Importer puts a list's sideboard in the Notebook,
  not in the deck. So import the 15 as a deck of their own (paste only the sideboard's lines), and put that deck face
  down on your **graveyard spot** before the game, with your main deck on the library spot as usual. `mtg ready`
  checks both together (60 or more in the deck, at most 15 in the sideboard, at most 4 of a card across the two) and
  tells only you "Sideboard: 15 cards". When the game starts it is put away with your deck, and it comes back when the
  game ends. `mtg clear deck` takes it away too. In Commander a deck there is left alone.
- **The score:** "MATCH 1–0" and "GAME 2" under each life total, "GAME 2 OF 3" on the bar at the top, and a line in the
  chat and the log after each game. The first to win 2 games wins the match ("MATCH WON"); a drawn game counts for
  neither, and the match ends after at most 5 games.
- **Giving up the match:** `mtg match concede` twice within 15 s, or **Concede match** between games. Conceding a game
  (`mtg concede`, Scoop) is not conceding the match. `mtg match` says the score.

## Team games

- **Two-Headed Giant** (`mtg mode 2hg`, Commander): see the table below for the rules. The official Two-Headed Giant
  rules apply, with one house rule: your partner gaining or losing life counts as you gaining or losing it.
  - **Blocking together:** when your team is attacked, each partner gets a **Block with <partner>** panel. It shows
    the team's block so far, one line per attacker (the other players' names in their seat colours). Press **Agree**
    to keep your blocks, or change them (your creature, then the attacker it blocks) and press **Done**. When your
    partner changes the blocks you are asked again ("Yellow changed the blocks. Agree or change?"), and the chat says
    what changed ("Yellow: Wall of Wood now blocks Hill Giant."). After four rounds of changes the team leader's
    blocks stand, and the chat says "<leader> decides (team leader)". Running out of time counts as Agree.
  - **The log:** a team shares one life total, so a change is one line for the team, "White + AI 1: 80 -> 74 life
    (-6, Reanimate)", not a line each (which read as twice the loss). Partners whose totals differ keep a line each.
  - **One turn for each team:** `mtg 2hg turns shared` (host) makes it one turn for the team: both partners untap,
    draw, attack and block together, and the team leader orders the team's triggers. `mtg 2hg turns own` goes back
    (the default: each player takes their own turn, the team's back to back). Not yet tried with several people.
- **Three-Headed Giant** (`mtg mode 3hg`, on the six-seat table): each side of the table is a team of three, White +
  Red + Yellow against Green + Blue + Purple. A team shares life (120 in Commander, 45 in Standard), poison (20 loses)
  and losing, blocks together and sees each other's hands; each player takes their own turn, the team's back to back.
  Hover a life counter for "Team life: ...". The log gives a life change one line for the team, as in Two-Headed Giant
  ("White + Red + Yellow: 120 -> 114 life (-6)"). On the six-seat table the Teams button also offers 3HG. The six-seat
  table save ("MTG 6 player table - ENGINE MODE", with its own commander-damage trackers) is coming; until then
  Three-Headed Giant can't start ("Three-Headed Giant is played on the six-seat table").

## Archenemy

- The host types `mtg archenemy <colour>` (a player or an AI), or presses the **Archenemy** button on the setup tile
  (Off, then each of the table's colours: four on the four-player table, six on the six-seat table). `mtg archenemy off`
  ends it. The archenemy plays against everyone else as one team: one to three others on the four-player table, one to
  five on the six-seat table.
- **The scheme deck:** `mtg schemes random` (20 at random) or `mtg schemes <name>; <name>; ...` (20 or more, at most 2
  of each; "2 <name>" for two).
- **The game:** the archenemy has 80 life in Commander (40 in Standard) and goes first; the others have their usual
  life (each their own). **The others take one turn together**, as the rules' Archenemy does (rule 904.2): after the
  archenemy's turn comes the team's, then the archenemy's again. On the team's turn every one of them untaps, draws,
  plays a land and casts at sorcery speed, and they attack together. The bar at the top says "YOUR TEAM'S TURN" to
  them (to the archenemy, "TEAM WHITE + RED + YELLOW'S TURN"). When the archenemy attacks, the team blocks together
  (the rules' one combined block, as in Two-Headed Giant: see "Team games"), and each of them may block a creature
  attacking any of them. The setup line says it: "(40 life each, one turn together)" (20 each in Standard).
- **Schemes:** at each of the archenemy's first main phases the top scheme is set in motion: a banner on
  every screen ("SET IN MOTION: <scheme>"), the scheme face up beside the archenemy's mat, ongoing schemes in a row
  beside it, and the scheme deck face down ("ARCHENEMY, 20 SCHEMES"; hover it for how many are left). The bar at the top
  says "(ARCHENEMY)" on their turns. The archenemy wins when all the others have lost; they win together when the
  archenemy loses.
- **On the six-seat table** the schemes lie in front of the archenemy's own seat, and the setup button sits beside the
  Teams button.
- Undo is off in Archenemy games.

## Chat commands

| Command | What it does |
|---|---|
| `mtg help` | the list of commands |
| `mtg ready` | the same as the READY? button |
| `mtg commander` | point at your commander first: marks that card as your commander (when READY? didn't find one on your command zone) |
| `mtg clear deck` | removes your own deck and commander from your seat (when your Delete key does nothing on them); not during a game |
| `mtg friendly 0\|1\|2` | free mulligans each, for everyone, the same as the Free mulligans button |
| `mtg mode 2hg` / `mtg mode ffa` | host: the next games are Two-Headed Giant (White + Red against Yellow + Blue) or free-for-all again. Partners share one life total (80 a team), poison (15 loses) and a commander's damage (42 loses), lose together and see each other's hands. Each player takes their own turn, the team's two turns back to back. Blocking is one team decision (the **Block with <partner>** panel, see "Team games" above): each partner sets their own blockers, sees the team's block line by line, and clicks Agree or changes it; after four changes the team leader's blocks stand ("<leader> decides (team leader)"). `mtg 2hg turns shared` (host, not yet tried live) makes it one turn for each team: both partners untap, draw, attack and block together, and the team leader (White, or Yellow) puts the team's triggers in order; `mtg 2hg turns own` goes back. House rule (not the official rules): your partner gaining or losing life counts as you gaining or losing it, so your Ajani's Pridemate grows when your partner gains life and "if you gained life this turn" counts their gains (each gain still triggers each card once). All four seats play (Forge AI players fill the empty ones). Commander only |
| `mtg mode 2v2` | host, Standard only (`mtg mode standard` first): 2v2, White + Red against Yellow + Blue, with Standard decks. Each player keeps their own life (20) and turn, no commander; teammates can't attack each other; a team wins when both its opponents have lost. All four seats play. The Teams button on the setup tile offers only the game mode's own: None, 2HG, Juggernaut in Commander; None, 2v2 in Standard; on the six-seat table 3HG as well. Switching the Game mode sets Teams back to None (said in chat) when the new mode doesn't play it |
| `mtg mode juggernaut` | host: Juggernaut, one player (White unless changed) against the other three. Commander only. The Juggernaut starts with 80 life, 10 cards, draws one extra card each draw step and goes first; it wins when all three have lost, and the three win together when it loses. All four seats play |
| `mtg juggernaut ...` | host: the Juggernaut's settings: `mtg juggernaut <colour>` (who), `life <n>` or `life auto`, `hand <n>`, `draw <n>` (extra cards), `land <n>` (extra land plays), `cmd 21` or `cmd 42` (commander damage that knocks it out), `order first` or `order after` (a turn after every challenger's); `mtg juggernaut` alone says the settings |
| `mtg mode 3hg` | host, on the six-seat table: Three-Headed Giant, each side of the table a team of three (see "Team games"). Commander or Standard |
| `mtg match bo3` / `bo1` / `concede`, `mtg match` | host: best of three in Standard 1v1, or single games again; anyone: give up the match (twice within 15 s), or the score (see "Best of three") |
| `mtg archenemy <colour>` / `off`, `mtg schemes random` / `mtg schemes <name>; <name>` | host: Archenemy in the next games, and the scheme deck (see "Archenemy") |
| `mtg treachery on\|off\|leader <colour>` | host: in Treachery the Leader goes first (found from the table's identity cards, or the colour named); off leaves it to the engine's own pick |
| `mtg winner <colour>` | host, Treachery: name the winner |
| `mtg tie yes` / `mtg tie no` | answer a tie offer (a player who can't lose), the same as the pop-up's Tie / Keep playing |
| `mtg accomplishments` | your accomplishments (a forced tie earns Stalemate) |
| `mtg team <colour> 1\|2` | host, after `mtg mode 2hg` or `mtg mode 2v2`: move a seat to team 1 or 2 (in Two-Headed Giant partners must sit next to each other in turn order; 2v2 takes any 2 + 2) |
| `mtg engine on` / `off` | anyone seated: the rules engine on or off |
| `mtg ai <colour> harmless\|forge [deck]` / `mtg ai <colour> off` | host: who plays an empty seat, in every game while nobody sits there: `forge` a Forge AI player (with the deck named, or one of its own), `harmless` a test player that keeps its hand, passes every priority and never attacks or blocks; `off` frees the seat again. The companion's page sets the same |
| `mtg start [ai N]` | anyone seated: start (optionally with N Forge AI players) |
| `mtg reset` | host: end the game and give the imported decks back (anyone seated once the game is over) |
| `mtg undo [N]` / `mtg vote yes/no` | rewind, and the vote on it (the player who asked: `mtg vote no` takes it back) |
| `mtg repeat <n>` | after one pass of a loop by hand, back to the same board, repeat it n more times (up to 1000); the same as the Repeat ×N button. Anyone may respond, and that stops it |
| `mtg stop` | stop a long run of triggers resolving by itself (your next priority with something on the stack is asked); it also stops a Repeat ×N |
| `mtg refresh` | your hand, your question and your panels drawn again (after a lag-out, or a question that never showed) |
| `mtg hold` / `mtg hold off` | keep priority once after something goes on the stack, to respond to your own trigger or with an ability (or press Hold); over your own spell you are asked anyway when you hold a spell to cast |
| `mtg skip <phase>` / `mtg skip off` | the Auto-resolve list's "Until" choices, typed: upkeep, draw, main, combat, blockers, damage, main2, end, mine |
| `mtg timer [seconds]` / `mtg timer off` | turn timers for everyone (host) |
| `mtg art token <token name> <link>`, `mtg art back <card> <link>`, `mtg art token clear` / `mtg art back clear` | your own picture for your tokens of that name, or for your two-faced card's back |
| `mtg art off` / `mtg art on` | host: everyone sees the normal card pictures / the pictures players linked in their deck lists (`1 Sol Ring #https://...`) |
| `mtg fix` (`yes` / `no` / `done` / `cancel`) | the manual fix, as the Fix... button |
| `mtg concede` | leave the game (twice within 15 s); in Two-Headed Giant and Three-Headed Giant it concedes for your whole team (in 2v2 and Juggernaut only for you). In best of three it concedes the game, not the match |
| `mtg effects on/off`, `mtg sounds on/off` | your own effects and sounds (the host's `mtg sounds on/off` is shared) |
| `mtg animations on/off` | host: the table's animations, for everyone (also under Settings) |
| `mtg fx on/low/off`, `mtg fx test <effect> [colour]` | host: the table's particle effects, all, fewer or none; `test` plays one now, at the card you point at |
| `mtg sounds test <kind> [N]` | host: play one table sound now, with N the one for N at once (death 5 plays the 4-stack); kinds: knockout, wipe, bighit, death, exile, countered, playerhit, damage, lifegain, treasure, treasurespend, sorcery, instant, counter |
| `mtg planechase on\|off` | host: Planechase in the next games |
| `mtg planes random [N]` / `mtg planes <name>; <name>` | host: the planar decks: N random planes and phenomena a player (10 unless given, 1 to 30), or the planes named |
| `mtg mana 99` | (testing) a manual fix in one line: 99 of each mana until the end of the turn |
| `mtg debug <scenario>` / `list` / `off` | (testing) a test board from `scenarios/<name>.json`: 20 lands out (the commander's colours, or the lands the file names) and the scenario's cards in hand, plus anything it puts in other zones for you or the opponents. Typed before a game, it is set up at your first priority on your own turn (your opening hand is kept by itself); during one, at the next moment with nothing on the stack. Other players vote as for any fix. Testers: `scenarios/LIVE-CHECKS.md` lists a scenario for each live check (rewind, Archenemy, art and effects, the runaway limit, the "also costs" hover, the hand-overflow card, No ×N, the 2HG team block), the commands to run it and what to look for on the table |
| `mtg hand <card>, <card> ...` / `mtg hand off` / `mtg hand` | (testing, with the host's debug tools on, against the AI only) your next game's starting cards, up to 7, the rest dealt from your deck; also the companion's **Starting hand** (Table tools → Debug tools). The engine deals the opening hand itself, so the picked cards are swapped in at your first priority in turn 1 and the dealt hand is kept by itself. (Getting them at the keep-or-mulligan question is coming) |
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
