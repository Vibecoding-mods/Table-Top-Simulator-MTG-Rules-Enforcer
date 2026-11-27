# bridge/gifs.js in plain English

Technical notes live in the header comment of `bridge/gifs.js`. This page says what the file is for, without the code.

## What it does

The table has picture frames that can show a moving GIF. A player types a few words, and this file asks GIPHY (the
GIF search site) for matching clips, then hands the table back a short list: for each clip, the moving version, a
still picture to hold once it has played, a small preview for the search panel, and its size.

It is careful in four ways:

- **Only addresses built from GIPHY's own links reach the table.** Every link in GIPHY's answer is checked: it must be a
  secure link on one of GIPHY's media servers, with no port, no user name and no tricks in the path. Anything else is
  thrown away, so a strange answer can never put some other website's picture on everyone's table. One exception, by
  design: a still picture that GIPHY only offers as a .gif (which Tabletop Simulator can't load) is sent as a link to the
  public image service wsrv.nl, which turns that same GIPHY picture into a .jpg. So wsrv.nl sees those requests and
  serves those pictures to every player; the address inside the link is still checked as GIPHY's.
- **The GIPHY key stays on the host's PC.** The key is typed into the companion app and kept on the host's computer.
  It is never put in the table's script (which friends receive), never shown in full (the companion sees only its
  last four characters), and never written into a log, even when something goes wrong.
- **It doesn't spend the key's allowance.** A new GIPHY key allows about 100 searches an hour. The same words searched
  again within a day are answered from memory without asking GIPHY. Past the hour's limit, or when GIPHY says "too
  many requests", players are told the search is resting for a few minutes. One player can use at most 40% of the
  hour and must wait two seconds between their own searches, so nobody can use up the table's searches alone.
- **Favourites are kept per player, on the host's PC.** A player can star a GIF they were shown; up to 48 per player
  are kept, newest first, under their Steam ID (or their seat colour when the table has none). The saved file is
  checked with the same link rules when it is read back, so an edited file can't sneak a foreign link in either.

## What it does not do

It does not show anything itself: the table does. It does not search anywhere but GIPHY. It cannot check that GIPHY's
real answers still look like the documented ones (the test answer was written from GIPHY's documentation); when no
clip in an answer is usable it writes a line in the log saying so.

## How we know it still works

`tests/test_gifs_golden.js` replays about 390 cases against a recording: every link-checking rule on lookalike and
broken addresses, the word and title cleaning, and whole search sessions on a stopped clock with a pretend GIPHY
(the hour limit, the day-long memory, refused keys, a network that is down, favourites filling up). It also checks
that no log line ever holds the key. `tools/mutate-gifs-golden.js` breaks the file in 44 small, realistic ways and
checks the recording notices each one (four changes are shown to make no difference and are marked so).
