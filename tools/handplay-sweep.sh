#!/usr/bin/env bash
# Hand-play sweep with no TTS window: the headless table (tests/lua/headless-tts.js) and a second bridge play each
# 40-card deck from tools/make-handplay-decks.js with tools/handplay.js (gestures first, each one checked against
# what the engine did). The mechanics decks play an attacking AI (decks/ai_handplay_rats.json, so blocks get made),
# the keyword decks the passive one (longer games, more keyword cards cast). Results: tmp/coverage/autoplay-hp-NN.json
# (+ the usual coverage files) and tmp/handplay/report.md. Uses the Forge room: not while a real game is played.
#   tools/handplay-sweep.sh [stopTurn=30]
cd "$(dirname "$0")/.."
STOP=${1:-30}
[ -f tmp/handplay/hp-01.json ] || node tools/make-handplay-decks.js
MECH=(tmp/handplay/hp-01.json tmp/handplay/hp-02.json)
KW=($(ls tmp/handplay/hp-*.json | grep -v -e hp-01.json -e hp-02.json))
AUTOPLAY=tools/handplay.js AI_DECK=ai_handplay_rats bash tools/headless-coverage.sh "$STOP" "${MECH[@]}"
AUTOPLAY=tools/handplay.js bash tools/headless-coverage.sh "$STOP" "${KW[@]}"
node tools/handplay-report.js
