#!/usr/bin/env bash
# Run Lua in the loaded TTS game through the bridge's debug channel. Usage: tools/tts-exec.sh file.lua  (or pipe Lua on stdin)
curl -s -X POST --data-binary @"${1:--}" "http://127.0.0.1:${BRIDGE_PORT:-48787}/exec"; echo  # BRIDGE_PORT=48788: the headless TTS
