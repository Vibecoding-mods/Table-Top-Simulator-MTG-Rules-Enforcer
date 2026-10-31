#!/usr/bin/env bash
# One automated test game on the engine table: reset, deal a test deck to White, mtg ready, mtg start ai N,
# bug-hunting autoplay, then reset and clean up.   tools/tts-run-game.sh <presetDeckId> [stopTurn] [aiCount]
cd "$(dirname "$0")/.."
DECK=${1:-neheb_minotaur_commander}; STOP=${2:-14}; AI=${3:-1}
X=tools/tts-exec.sh
[ -f tmp/spawn-$DECK.lua ] || node tools/make-test-deck-lua.js $DECK tmp/spawn-$DECK.lua >/dev/null
echo 'return tostring(engineChat("mtg reset", Player.White))' | $X >/dev/null; sleep 6
$X tools/tts-cleanup-test.lua >/dev/null; sleep 2
$X tmp/spawn-$DECK.lua >/dev/null
for i in $(seq 1 15); do
  sleep 2
  v=$(echo 'local d = getDeckFromZone(data.White.libraryZone) return (d and d.getQuantity() or 0) .. "/" .. #(Player.White.getHandObjects() or {})' | $X)
  echo "$v" | grep -q '"92/7"' && break
done
echo "deck/hand: $v"
echo 'engineSendDecks({ "White" }, "White") return "ok"' | $X | grep -o 'White[^"]*ready[^"\]*' | head -1
sleep 2
echo "return tostring(engineChat(\"mtg start ai $AI\", Player.White))" | $X >/dev/null; sleep 9
node tools/tts-autoplay2.js $STOP 700
echo 'return tostring(engineChat("mtg reset", Player.White))' | $X >/dev/null; sleep 6
$X tools/tts-cleanup-test.lua >/dev/null
