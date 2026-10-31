@echo off
rem Stops the bridge and the Forge engine stack (Docker keeps running; TTS is left alone).
title MTG table - stopping
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\stop-bridge.ps1"
docker compose -f "%ROOT%\stack\compose.yml" stop
echo Stopped.
pause
