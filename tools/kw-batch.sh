#!/usr/bin/env bash
# Plays the next N keyword decks (default 7) with the test tools, logging TTS health after each, then exits so the
# caller can reload the table. Moves on to the next round's decks when the current round is done.
#   tools/kw-batch.sh [N=7] [mode=driver|autopilot]
cd "$(dirname "$0")/.."
N=${1:-7}; MODE=${2:-driver}; START=$(cat tmp/kwrun.start); done_n=0
for R in 2 3 4 5 6 7 8 9 10 11 12; do
  ls tmp/kwsmall/r$R-*.json >/dev/null 2>&1 || node tools/make-keyword-decks-small.js "$R" > /dev/null
  for D in tmp/kwsmall/r$R-*.json; do
    K=$(basename "$D" .json)
    [ -f "tmp/coverage/result-$K.json" ] || [ -f "tmp/coverage/autopilot-$K.done" ] && continue
    if [ "$MODE" = autopilot ]; then tools/run-autopilot-game.sh "$D" 900 && touch "tmp/coverage/autopilot-$K.done"
    else tools/run-coverage.sh "${KW_STOP:-25}" "$D" 2>&1 | tail -1; fi
    echo "$(tools/tts-health.sh) [$MODE $K]" >> tmp/health.log
    # memory checkpoints (user's request): at 4, 6 and 8 GB, measure smoothness (baseline at 3.5 GB: 248 fps, 1 slow frame/min)
    MEM=$(tasklist //FI "IMAGENAME eq Tabletop Simulator.exe" //FO CSV //NH | awk -F'","' '{gsub(/[^0-9]/,"",$5); print int($5/1024)}')
    for G in 4000 6000 8000; do
      if [ "${MEM:-0}" -ge "$G" ] && [ ! -f "tmp/memcheck-$G.done" ]; then
        touch "tmp/memcheck-$G.done"
        # measured on the idle table between games (test-tool commands would skew a mid-game reading)
        sleep 30
        tools/presentmon/PresentMon.exe --process_name "Tabletop Simulator.exe" --output_file "tmp/pm-mem$G.csv" --timed 60 --terminate_after_timed --no_console_stats >/dev/null 2>&1
        echo "== memory checkpoint ${G} MB, idle (TTS at ${MEM} MB): $(node tools/pm-analyze.js tmp/pm-mem$G.csv | head -2 | tr '
' ' ')" >> tmp/health.log
      fi
    done
    done_n=$((done_n + 1)); [ "$done_n" -ge "$N" ] && break 2
  done
  node tools/keyword-report.js "$START" > /dev/null
  grep -q "| not drawn |\|| seen |" docs/keyword-test-results.md || { echo "all keywords played"; break; }
done
node tools/keyword-report.js "$START" > /dev/null; sed -n 5p docs/keyword-test-results.md
echo "batch done ($done_n games, $MODE)"
