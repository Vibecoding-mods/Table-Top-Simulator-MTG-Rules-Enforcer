@echo off
rem One click to get the rules-enforced MTG table going on the host's PC (only the host runs this; friends just join
rem the host's TTS game). Starts Docker Desktop if needed, the Forge engine stack (relay + Forge room), a fresh room,
rem the bridge, and Tabletop Simulator. Then load "MTG 4 player table - ENGINE MODE" in TTS (see HOW-TO-PLAY.md).
title MTG table - starting
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo [1/4] Docker...
docker info >nul 2>&1
if errorlevel 1 (
  echo       starting Docker Desktop, this can take a minute
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
)
set /a tries=0
:waitdocker
docker info >nul 2>&1
if not errorlevel 1 goto dockerup
set /a tries+=1
if %tries% geq 60 (
  echo       Docker didn't start after 3 minutes. Open Docker Desktop yourself, then run this again.
  pause
  exit /b 1
)
ping -n 4 127.0.0.1 >nul
goto waitdocker
:dockerup

docker image inspect mtg-forge-node:exile mtg-relay:exile >nul 2>&1
if errorlevel 1 (
  echo       The engine images aren't built yet. In Git Bash, run this once ^(about 20 minutes^):
  echo         bash engine/build-images.sh
  pause
  exit /b 1
)

echo [2/4] Forge engine (relay + room), fresh...
docker compose -f "%ROOT%\stack\compose.yml" up -d
if errorlevel 1 (
  echo       The engine stack didn't start. Check Docker Desktop, then run this again.
  pause
  exit /b 1
)
rem (a fresh room: a room left over from an earlier game refuses a new start)
docker compose -f "%ROOT%\stack\compose.yml" restart relay forge-room >nul
ping -n 16 127.0.0.1 >nul

echo [3/4] Bridge...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\start-bridge.ps1"

echo [4/4] Tabletop Simulator...
tasklist /FI "IMAGENAME eq Tabletop Simulator.exe" 2>nul | find /I "Tabletop Simulator.exe" >nul
if errorlevel 1 (
  start "" steam://rungameid/286160
  echo       launching TTS
) else (
  echo       TTS is already running
)

echo.
echo Ready. In TTS: Create a Multiplayer server, then Games ^> Saved Games ^> "MTG 4 player table - ENGINE MODE".
echo Friends join your server; everyone sits at a colour, presses READY, and the host presses Start.
echo How to play: %ROOT%\HOW-TO-PLAY.md
echo.
pause
