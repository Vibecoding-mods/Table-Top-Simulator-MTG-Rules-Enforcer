# bridge/teams.js in plain English

Technical notes live in the header comment of `bridge/teams.js`. This page says what the file is for, without the code.

## What it does

When people play Magic as teams rather than everyone for themselves, someone has to decide who is on which side,
check that the seating makes sense, tell the rules engine about the teams before the game starts, and then explain
the team parts of the game to the players while it runs. This file is that someone, for the bridge (the program that
sits between Tabletop Simulator and the rules engine).

It knows five team games:

- **Two-Headed Giant** (Commander only): two teams of two. Partners share one life total, one poison count and the
  commander damage they take, they lose together and they can see each other's hands. The official rules, plus two
  house rules the engine applies: when your partner gains or loses life it counts as your gain or loss too (for cards
  that care), and a team is out after 42 combat damage from one commander, added up over both partners. The two
  players on each long side of the table are partners by default (White with Red, Yellow with Blue),
  and the first seat of each team (White, Yellow) is the team's leader, who has the last word when the team's blocks
  or triggers need one order. Partners must sit next to each other in turn order, because the team plays its turns
  back to back.
- **2v2** (Standard only): two teams of two, but each player keeps their own life and turn. Teammates can't attack
  each other, and a team wins when both opponents are out.
- **Juggernaut** (Commander only): one strong player against a team of three. The host picks the Juggernaut's life,
  opening hand, extra draws, extra land plays, the commander damage that knocks them out, and whether they go first
  or take a turn after every challenger. Those extras are written as small rule cards the engine understands.
- **Archenemy** (either format): one player with a deck of schemes against everyone else, who take their turn
  together. The file checks the scheme deck (at least 20 schemes, no more than 2 of any one).
- **Three-Headed Giant** (the six-seat table only): Two-Headed Giant with three a team, the table's two sides.

The four-seat team games (Two-Headed Giant, 2v2, Juggernaut) are played on the four-seat table; the six-seat table
refuses them by name at the start, rather than starting a game where one seat has no team.

## What it does not do

It does not play the game. The rules engine does the shared life, the lost-together, the skipped first draw and the
rest; this file only says who is on which team and how big the Juggernaut is. It also keeps nothing between games:
the table sends the teams with every start, so a restarted bridge loses nothing.

## How we know it still works

`tests/test_teams_golden.js` replays about 4,600 calls into this file, many of them deliberately odd (missing
values, wrong types, team number 0, made-up rule names, every possible seating), and checks each answer against a
recording. It also checks two rules that need no recording: swapping which team is called "1" never changes whether
a seating may start, and every player of a game the checks let start is on a team. `tools/mutate-teams-golden.js`
breaks the file in over 40 small, realistic ways and checks that the test notices each one.
