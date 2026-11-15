# Two-player check: do effects, highlights and sounds show for everyone? (M5 step 3)

Everything the table shows other players has only been tested on the host's own screen. This check needs two real
people: you (the host) and a friend who joins your table from their own PC. About 20 minutes. The developer version of
the same list, with the reasons, is `docs/m5-assetbundle-build.md` section 8.

**Before you start**

- The latest table is deployed and nobody's game is on the table (a save you care about: save it first).
- Your friend joins, takes a seat (say Red; you are White below), and waits until their screen has finished loading
  (no "Loading" counter in the corner).
- Start a game against nothing harder than the AI: `mtg debug list`, then `mtg debug <scenario>` for a board with
  creatures out, or a normal `mtg start ai 1`. Your friend can play or just watch.
- Each of you keeps a note: for every line, **yes / no / what was different**. Your friend's screen is the one being
  tested; yours is the reference.

## A. Effects (particles)

Type the host's commands in chat. Point at a card with your mouse first to play the effect on that card.

| # | Host does | Friend checks | Pass |
|---|---|---|---|
| A1 | Point at one of your creatures, `mtg fx test death` | smoke at that card, at about the same moment as you | they see it on the same card |
| A2 | Point at one of **their** creatures, `mtg fx test exile` | the exile light on their card | on the card, not under the table or off to one side |
| A3 | `mtg fx test knockout red` | a red burst at their life counter | at their life counter |
| A4 | `mtg fx test wave white R` | a red wave sweeping from your side across the table | they see the wave |
| A5 | `mtg fx test lifegain` (nothing pointed at) | a glow at your life counter | at your life counter |
| A6 | In the game: let a creature die, and (if you have one) cast a burn spell at a creature | the death smoke, and a bolt flying from the spell to its target | both show, at the right cards |
| A7 | Your friend types `mtg effects off`; you repeat A1 | **write down** whether they still see the smoke | either is fine, just note it (the banners must go, see C3) |
| A8 | `mtg animations off` (yours), then let a creature die | no swing, no graveyard flash, for either of you | nothing moves; then `mtg animations on` |
| A9 | `mtg fx off`, let a creature die (your chat says "no free effect bundle rig" for a `mtg fx test` now: expected); then `mtg fx on` | with off: no smoke for anyone | off hides it for both of you |

If A1 to A5 show for you but **never** for your friend, stop here and say so: it means TTS plays these effects only on
the host's screen, and the table will fall back to its shared flashes.

## B. Highlights and lines

| # | When | Friend checks | Pass |
|---|---|---|---|
| B1 | You attack them | your attackers glow red, a red-pink line from each attacker to them | they see glows and lines |
| B2 | They block (if they play) | their blockers glow blue, a gold line to the attacker | as on your screen |
| B3 | You cast a spell with a target | a cyan arc from the spell to the target | they see the arc |
| B4 | Combat damage | each attacker swings into what it attacks and back | the swing shows, smooth |
| B5 | Life changes | the red "-N" / green "+N" under the life number | they see it on the right counter |
| B6 | Their turn starts (if they play) | their turn banner is gold, yours blue-white on their screen | colours as said |

## C. Banners and the stack pop-up

| # | When | Friend checks | Pass |
|---|---|---|---|
| C1 | You cast a spell | the stack pop-up with its picture; it stays while the spell is on the stack | they see it, with the picture |
| C2 | A spell is countered (if a deck has a counterspell) | "COUNTERED: <spell>" on the pop-up | they see it |
| C3 | Your friend types `mtg effects off`, then you cast a spell | **no** pop-up and no turn banner on their screen; still on yours | their own switch hides only their banners |
| C4 | Someone loses (`mtg concede` twice from one of you, or the AI dies) | "<NAME> IS OUT" for the others, DEFEAT for the loser, then VICTORY / DEFEAT | the right banner on each screen |

## D. Sounds

Sounds are shared: they play for everyone through TTS's music player. Your friend needs TTS's music volume up (Music
slider in TTS's own settings) and no music of their own playing.

| # | Host does | Friend checks | Pass |
|---|---|---|---|
| D1 | `mtg sounds test death` | hears the death sound | heard; note how long after you heard it |
| D2 | `mtg sounds test knockout`, then `mtg sounds test countered` | hears both | heard |
| D3 | `mtg sounds test death 5` | the bigger stacked version | heard |
| D4 | In the game: a creature dies | the sound comes with the smoke, not seconds later | about together (say how far apart) |
| D5 | Start a track in TTS's music player (Music in TTS's top menu), let it play; you repeat D1 | the track keeps playing; the table's sound is skipped while it plays (by design) | the track is not cut off |
| D6 | `mtg sounds off`, repeat D1; then `mtg sounds on` | silence while off | nothing heard |

## E. Joining late

| # | When | Friend checks | Pass |
|---|---|---|---|
| E1 | Your friend leaves and joins again mid-game, then you repeat A1 and D1 | no error in their chat; effects and sounds work again once they've loaded | no red error lines |

## Afterwards

Send the notes (every **no**, and anything that looked different on their screen), with a screenshot from your friend
for any effect that was in the wrong place. If they play on a Mac or Linux, say so: pink or missing effects there are
a known risk of TTS effect bundles.
