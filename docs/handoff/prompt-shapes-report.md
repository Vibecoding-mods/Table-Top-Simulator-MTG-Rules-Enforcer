# Report: prompt shapes the ability sweep never drove end to end

Cloud session, 2026-11-17, branch `cloud/prompt-shapes` from `origin/cloud/token-quadratic` (6d2d0f2).
- Bridge only: no engine change, no protocol field, no Lua.
- Not tried in TTS. No permission prompt is pending.

## How it was probed (`tools/prompt-shapes-probe.js`, new)

**The engine:** the real harness, `ManaBrewEngineAdapter` through `engine/checks/HeadlessGameServer.java` as
`tools/headless-six.js` uses it. No relay or node image (there is no Docker here).

**The bridge:** the real `bridge/bridge.js` between the engine and a fake table, in `tests/bridge-harness.js`, as
`tools/m6-stream.js` plays a recording.

**The players:** three people.
- **White** is the bridge's seat. Each of White's questions goes to the bridge, and the probe records:
  - what the table is shown (the title, the text, the options);
  - what the table answers (the first legal option unless the shape says which; Auto-pay for a payment);
  - what the bridge sends back to the engine.
- **Blue and Red** are answered by the probe.
- The engine's player names are the relay's usernames (`tts-White-002k`, `self-hosted-node-77-bot`,
  `self-hosted-node-77-bot 2`), as in a real game. That is what the bridge's name translation (`tableNames`) works on.

**Per shape:** a fresh game, played to the caster's first main phase; the cards made with an `apply_state` (as a debug
setup is); the card cast, played or activated; then every question until the stack is empty again.

**Flagged:**
- a question the bridge answered by itself;
- one it showed nothing for (a hang);
- a raw id in a question, the log or chat;
- an answer the engine refused.

All the text below is live: Forge's own questions through today's bridge.

## Results

| Shape | Card | What White sees | |
|---|---|---|---|
| ChooseNumber, each player, secretly | Menacing Ogre | "Menacing Ogre: choose a number" (a number box, Forge's text: "When Menacing Ogre enters, each player secretly chooses a number…"). Then chat: "Menacing Ogre: you chose 3. AI 1 chose 0. AI 2 chose 0", and the log has the same and the life loss | OK |
| GenericChoice, an opponent choosing | Remorseless Punishment (Blue's, at White) | "Remorseless Punishment: choose one" [you lose 5 life unless you discard two cards. / you lose 5 life unless you sacrifice a creature or planeswalker.], twice (it repeats). With no creature or planeswalker, the one choice left is taken without asking | OK |
| Its unless cost | Remorseless Punishment | **Was** "Remorseless Punishment: pay Discard two cards?" [Pay Discard two cards / No: lose 5 life]. **Now** "Remorseless Punishment: discard two cards?" [Discard two cards / No: lose 5 life]. Then "discard which cards? (choose 2)" | **fixed** |
| ChoosePlayer, an opponent | Black Vise | **Was** "Black Vise: choose one" [AI 1 / AI 2]. **Now** "Black Vise: choose an opponent" (the engine's own description). Log: "White chooses AI 1 (Black Vise)"; chat: "Black Vise: you picked AI 1" | **fixed** |
| Fortify | Darksteel Garrison | The action "Darksteel Garrison: Fortify {3} ({3}: Attach to target land you control. Fortify only as a sorcery.)", then "attach to which land you control?" [Plains #1 … #5]. Log: "White fortifies with Darksteel Garrison", "Darksteel Garrison is attached to Plains" | OK |
| Reconfigure | Lizard Blades | The action "Lizard Blades: Reconfigure {2}: Attach" (and Unattach once attached), then "choose a target to attach it to" [Grizzly Bears]. Log: "Lizard Blades is attached to Grizzly Bears" | OK |
| Bestow | Boon Satyr | "Cast Boon Satyr — bestow" beside "Cast Boon Satyr", then "choose a target to attach it to". Log: "White casts Boon Satyr (bestow) targeting Grizzly Bears", "Boon Satyr enters the battlefield, attached to Grizzly Bears" | OK |
| ChooseColor, as it enters | Painter's Servant | "Painter's Servant: choose a color" [White / Blue / Black / Red / Green] | OK |
| ChooseType, a creature type | Cavern of Souls | "Cavern of Souls: choose a creature type": Forge's whole list of creature types, from Advisor | OK (a long list) |
| ChooseCardName | Pithing Needle | **Was** "Pithing Needle: Name a card". **Now** "Pithing Needle: name a card" [Island / Llanowar Elves / Mountain / Pithing Needle / Plains] | **fixed** (wording) |
| Vote, each player | Council's Judgment | "Council's Judgment: vote for which nonland permanent you don't control?" [Grizzly Bears / Hill Giant]. Each other vote said in chat and the log: "Council's Judgment: AI 1 voted for Grizzly Bears. Votes: Grizzly Bears: White, AI 1". Forge's "(125)" ids are not shown | OK |
| A Charm on a trigger: one or more modes, each a different player | Vindictive Lich (sacrificed to Village Rites) | "Vindictive Lich: choose 1 to 2" [Target opponent discards two cards. / … loses 5 life. / … sacrifices a creature.], then "choose a player to discard" [AI 1 / AI 2]. Log: "AI 1 discards Island, Island (Vindictive Lich)" | OK |
| A tempting offer, each opponent may accept | Tempt with Discovery | "Tempt with Discovery: search your library for which land card?". The opponents' accept or decline is theirs; White isn't told what they chose (see below) | OK |

**Questions answered by the bridge itself** (none wrong):
- payment steps after Auto-pay, and priority passes it makes as usual;
- a reveal the result is said for in chat (Menacing Ogre's numbers, Black Vise's pick, the votes);
- one-choice selections: Menacing Ogre's counter kind "P1P1", and Remorseless Punishment's one choice left.

**None hung, none showed a raw id, and the engine refused none.**

## The three fixes (`bridge/bridge.js`)

**1. A choice of players only.**
- `entityWords` returned nothing when every option was a player, so the question fell back to "choose one".
- It now reads them, by their table names. The question uses the engine's own description when it is "Choose an
  opponent" or "Choose a player" (Black Vise's).
- Otherwise it reads "choose which opponent?", or "which player?" when the chooser is one of them.
- A defender's choice (a creature put onto the battlefield attacking) keeps its own wording.

**2. An unless cost that isn't mana.** Forge's "Pay Discard two cards?" is asked as the cost itself: the title "…:
discard two cards?", and the button "Discard two cards". The same goes for Put, Remove, Sacrifice, Exile, Tap, Untap and
Return. The bare "Pay X?" question already did this; the question with an otherwise ("No: lose 5 life") didn't.

**3. "Name a card"** is said in the table's style: "Pithing Needle: name a card".

## Tests

**`tests/test_bridge_prompt_shapes.js`: 62 checks, in GATES.**
- **The fixture:** `tests/golden/fixtures/prompt-shapes.json`, 17 of the probe's live questions, each with White's view
  of the board (the libraries' cards left out), 381 KB.
- **Per question:** the title and the options pinned to the live text; no raw id; and the table's answer reaching the
  engine as the probe's did.
- **Two variations of Black Vise's question:** without the description it reads "which opponent"; with the chooser among
  them, "which player".
- **Red first:** before the fixes, exactly the 6 fix checks failed.

**Break-it: `node tools/mutate-prompt-shapes.js`: 7 of 7 caught by name**, `bridge.js` restored by sha256.

**No harness test:** nothing was wrong on the engine side.

## Seen, not changed

- **Pithing Needle offers the names of the cards in the game** (all zones, libraries and sideboards too), not all of
  Forge's names. That's the harness's `filterCardFaces`, by design: a list of tens of thousands of names isn't a table
  question. A card nobody has can't be named. If that matters, it needs a typed name, which is an engine and table
  change.
- **Cavern of Souls lists every creature type** (several hundred). It is legal and answerable, just long.
- **A tempting offer doesn't tell White what the opponents chose.** Forge sends White nothing for their accepts or
  declines. Only White's own search and its result reach the log.
- **The probe's AI seats are people answered by the probe, so their names are "AI 1" and "AI 2".** In a real game
  against the Forge AI, its own questions never reach the table.

## Gates

- **Repo GATES**, against the previous run (opening-hand, same container): the same, apart from:
  - the new `test_bridge_prompt_shapes` (62);
  - `test_bridge_opening_hand` now at 23 (its review fix);
  - `test_bridge_golden`: 3 scenarios whose questions read better, the same fixes on cards already in the golden file.
    Re-recorded from today's bridge, 14 lines. Only their title, button label and log lines changed; the options' ids,
    the answers and the mode are the same:
    - hp-18, Riot's choice: Spider-Punk's "pay Put a +1/+1 counter on Spider-Punk?" now reads "put a +1/+1 counter on
      Spider-Punk?", button "Put a +1/+1 counter on Spider-Punk";
    - hp-15, Fabricate's choice: Marionette Apprentice, the same;
    - "planeswalker by click: players alone stay a list": Zevlor's "choose one" over [AI 1 / Blue] now reads "choose
      which player?". It is still a list.
  - All 1,084 golden scenarios match after.
- **The 39 gates that need the Workshop save** can't run here, as before.
