# Token stacks like Arena (asked 2026-11-06)

## What the real table does today (test 2026-11-06, scenario tmp/wt-head/scenarios/token-swarm.json)

20 × 1/1 Soldier (White) against 20 × 2/2 Zombie (AI 1), bridge and table at 8d75957.
- **Stacking:** identical tokens at 5 or more are ONE card with an "x20" label (`groupTokens`, `ENGINE_GROUP_MIN = 5`,
  tools/engine-renderer.lua ~670). There is no limit on a stack's size.
- **Attacking:** clicking the stack makes all 20 attack. During the attack question the stack has a button,
  "Split the 20 to…". It lays all 20 out as single cards in one tight, overlapping row, and each one can then be
  clicked. 12 of 20 picked one by one → "Attack (12)" → right. The AI blocked all 12; they died.
- **Blocking:** both stacks (your blockers, its attackers) get the Split button. After splitting, you click a token,
  then an attacker: a double block and a single block both worked. Engine result right: one Zombie died, 3 Soldiers
  died, 40 → 4 life (18 unblocked × 2).
- **Seen problems:**
  - one x20 card, not piles of 5;
  - the split row of 20 overlaps, so the cards are hard to click with a mouse;
  - no right-click menu on a stack;
  - a block shows only a blue outline on the blocker: there is no line to the attacker it blocks;
  - the log says "Soldier Token, Soldier Token block Zombie Token", which doesn't say which Zombie.

## Wanted (the user)

- **Decided 2026-11-06: the Arena way.** One stack per kind of identical token, no size cap, with an "xN" badge
  (today's grouping stays). Arena shows x23 / x224 / x163 piles (video 3:52, 5:38) and caps a game at 250 tokens.
  The earlier "stacks of 5" idea is dropped.
- Attack: click a stack = that stack attacks. You can also pick single tokens within a stack. A right-click menu on
  a stack (only during the attack question): "Attack with all N", "Attack with one", "Pick one by one". The existing
  box beside the stack, shown only during the attack question, stays.
- Block: block per token within each stack, without having to lay out the whole army.

Arena reference: youtu.be/ZQh7yPdkpaw, around 8:25–8:40. Arena draws identical tokens as a small fanned pile with an
"x5" badge. The 5-per-stack size is the user's description; the frames checked don't show a 20-token combat.

## Open design points (for the build)

- Object count: unchanged (one object per stack), so no new load on Unity's clean-up pass (tts-perf-facts).
- Picking within a stack without laying out the whole army: the stack's count drops as tokens are picked, and the
  picked ones are drawn as their own "attacking" stack (Arena moves attackers forward the same way).
- Click on your stack in a block question: assign the next unassigned token in it; click on an attacker stack:
  block the next attacker in it that this blocker hasn't blocked. Clicking again takes back the last one.
- `obj.addContextMenuItem` on the stack's representative, added when the question opens and cleared when it closes.
- Draw a line from each blocker to its attacker; log lines that count ("2 Soldier tokens block a Zombie token").
- No new main-chunk locals in the renderer.

## Built (2026-11-11, source only)

- A kind still stacks from 5 on its whole count (today's grouping). In combat it is cut into one stack per part it plays:
  the tokens picked to attack (one stack per target), the tokens blocking (one stack per attacker), and each blocked
  attacker on its own card, so a block's line ends on the attacker it blocks. Picking 1 of 20 draws x19 + 1: one more
  object, never the 20 a split lays out. The stack's own card is always taken last, so it keeps its object.
- Attack question: right-click a stack: "Attack with all N", "Attack with one", "Pick one by one" (the Split box's
  layout, which stays). An attacking stack offers "Don't attack with these N" and "Take one back". A click is still all.
- Blockers question: a click on your stack takes its next token with no block; a click on an attacking stack blocks its
  next attacker nobody blocks yet; the stack clicked again while its token waits: that one doesn't block; a click on a
  stack whose tokens all block takes the last one's block back (it waits for a new attacker). A double block: click the
  blocked attacker's own card.
- Each block picked is drawn as a gold line while you block; an answered question's picks stay drawn until the next
  board, so stacks don't merge back before the engine's board comes.
- Log: "AI 1 attacks with 20 Zombie tokens"; "2 Soldier tokens block a Zombie token"; "3 Zombie tokens are blocked by
  a Soldier token each". Lines without tokens read as before.
- Not built: Arena's 250-token cap; menus in the blockers question (the existing "Don't block with this" stays).

## Live check (real table)

1. Token swarm scenario (tmp/wt-head/scenarios/token-swarm.json): one x20 stack a side.
2. Attack: right-click your stack: three items. "Attack with one" three times: an x17 and an x3 stack, the x3 red; the
   chat names each token. Click a life counter: the last one picked changes target. Click the x17: one x20 again.
3. Answer with some attacking: the attacking stack doesn't flash back into the other before the engine's board.
4. Block: click your stack, then their stack: one Soldier and one Zombie come out, with a gold line between them.
   Click your stack and the single Zombie: a double block (x2 Soldiers on it). Watch the frame rate while clicking.
5. The log: counted lines, as above.
