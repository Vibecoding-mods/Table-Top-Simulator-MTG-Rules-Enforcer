#!/usr/bin/env bash
# Keyword follow-up rounds: small decks of the keywords not yet played, until every keyword is played or the last round.
# Logs TTS health after every deck (tmp/health.log) and reloads the table every 5 decks.
#   tools/keyword-rounds.sh [startRound=1] [lastRound=6]
cd "$(dirname "$0")/.."
START=$(cat tmp/kwrun.start)
SAVE="${SAVE:-$USERPROFILE/Documents/My Games/Tabletop Simulator/Saves/MTG 4 player table - ENGINE MODE + your decks.json}"
# (that default save is gone, 2026-11-27: a missing save or a failed push stops the run instead of logging "reloaded")
[ -f "$SAVE" ] || { echo "keyword-rounds: the save '$SAVE' doesn't exist: set SAVE=<a TTS save file> and run again" >&2; exit 1; }
PLAYED=0
for R in $(seq "${1:-1}" "${2:-6}"); do
  [ "$R" -gt 1 ] && node tools/make-keyword-decks-small.js "$R"
  for D in tmp/kwsmall/r$R-*.json; do
    N=$(basename "$D" .json)
    [ -f "tmp/coverage/result-$N.json" ] && continue
    tools/run-coverage.sh 25 "$D" 2>&1 | tail -1
    tools/tts-health.sh >> tmp/health.log
    # TTS's game slows a little with every game until the table is reloaded (problem-log P6): reload every 5 decks
    PLAYED=$((PLAYED + 1))
    if [ $((PLAYED % 5)) -eq 0 ]; then
      timeout 90 node tools/tts-push-global.js "$SAVE" --force > /dev/null 2>&1 || { echo "table reload FAILED" >> tmp/health.log; echo "keyword-rounds: the table reload failed" >&2; exit 1; }
      sleep 45
      echo "reloaded table" >> tmp/health.log; tools/tts-health.sh >> tmp/health.log
    fi
  done
  node tools/keyword-report.js "$START" | tail -1
  grep -q "| not drawn |\|| seen |" docs/keyword-test-results.md || break
done
echo "rounds done"
