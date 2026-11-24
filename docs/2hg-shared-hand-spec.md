# 2HG: see your partner's real hand (spec, 2026-11-24, not built)

## The ask
The user, 2026-11-24: "in 2hg don't duplicate my teammates deck on my side make it so that I can see their live hand
they're playing it helps with communication either make us temporary the same color so we can see our hands or game
master view but limited out teams hand only. Spec it out first".

## Today
The bridge sends a partner's hand as `teamHand` / `teamBy` (bridge.js teamHandOf, CR 810.5). The table deals look-only
stand-ins, `team:<partner>:<id>`, into the viewer's second hand zone (engine-renderer.lua engineTeamHands). Each card
is a second object, spawned and moved on every board change. That is the duplication: the partner's cards show twice,
and a big hand costs the object count that tripped the GPU reset (~85k objects).

## The options

### A. TTS Teams (recommended)
TTS has a Teams feature (Hearts, Clubs, Spades, Diamonds, Jokers). Players on one team see each other's hand zones and
hidden zones, and get team chat. Lua sets it: `Player[color].team = "Hearts"`. So at the start of a 2HG game the table
puts each pair on its own team (White's team on Hearts, the other team on Clubs), and puts everyone back to "None" when
the game ends or resets. The partner then sees the real cards in the real hand, live, as they are drawn and played:
nothing is copied.

- engineTeamHands and the bridge's teamHand are no longer needed in 2HG: the table stops placing the stand-ins while
  Teams are on (the bridge can keep sending teamHand for one release, as a fallback).
- Also used for any other mode whose rules let partners see hands. Never in 2v2 or Archenemy unless their rules allow
  it (810.5 is 2HG only).
- The chat says it at the start: "Team White + Red: you can see each other's hands (TTS team Hearts)."

Risks to check live before building (needs two real players, since one PC can't sit in two colours):
1. That a TTS teammate sees the partner's hand card faces in the main hand zone. Community guides say so, but no
   official TTS documentation was found.
2. Hidden zones: a teammate also sees the partner's hidden zones. Our second hand zone holds foretold and face-down
   cards (Gonti, foretell) that only their owner may see. Under the 2HG rules a partner may see their partner's hand.
   Whether that covers face-down exiled cards is a rules question to check (CR 810.5 vs 708.5). If it doesn't, those
   cards need to move out of the hand zone while Teams are on.
3. Notebooks: teammates see each other's notebook pages. That doesn't matter here.
4. A player who changed team themselves in TTS's menu: the table sets it again at each game start, and the host
   command `mtg team …` keeps working as today.

### B. "Same colour for a while"
TTS seats one player per colour, so two people can't share a colour. Swapping colours would also swap whose hand and
panel each person sees. Not possible as asked. Option A is the working form of this idea.

### C. A "partner's hand" panel (game-master view limited to the team)
An XML UI panel, visible only to the partner (`visibility="White"`), with the partner's hand as card pictures (the
cards' face URLs). Hovering one shows it large. It updates from the same teamHand data. No objects are spawned, so
there's no duplicate deck on your side and no object cost.

- Pros: works without the TTS Teams question, and shows only the hand, never hidden zones or notebooks.
- Cons: pictures in a panel, not cards on the table; the UI's image loads add their own cost; hover-zoom has to be
  built.

The real TTS Game Master view (Black) sees every hand, opponents' too, so it can't be limited to a team. C is the
limited form.

## Recommendation
Build A, with C as the fallback if the live check shows TTS Teams don't show hands, or show hidden cards they mustn't.

Steps for A:
1. Live check with a friend (risks 1-2), in a normal 2HG game, setting `Player.<colour>.team` by hand through
   tools/tts-exec.
2. engine-renderer.lua: set the teams at 2HG game start (from the board's teams sides) and clear them at the end or
   reset; skip engineTeamHands while they are on; then clean up the stand-ins left from before.
3. Tests in the fake TTS: teams set and cleared, no stand-ins placed in 2HG, stand-ins still placed when Teams are off.
4. Hand test in a real 2HG game: draw, play, discard; check the partner sees each change and the opponents see
   nothing.

## Questions for the user
- A (TTS Teams, real cards) or C (a pictures panel)?
- If A: may your partner also see your foretold and face-down cards? (If not, A needs extra work for those.)

## Decided (the user, 2026-11-24)
- **A, TTS Teams.**
- **Partners may see each other's face-down and foretold cards too.** So risk 2 needs no extra work: the second hand
  zone stays as it is.
Still to do before calling it done: the live check with a second real player (risk 1).
