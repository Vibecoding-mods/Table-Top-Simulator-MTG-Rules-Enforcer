# Starts the bridge as its own hidden Windows process (not tied to any terminal or chat session) and restarts it
# if it ever exits. Logs to tmp\bridge-live.log; every message to TTS is also recorded to tmp\tts-stream.jsonl.
#   powershell -ExecutionPolicy Bypass -File tools\start-bridge.ps1        (stop: tools\stop-bridge.ps1)
$root = Split-Path -Parent $PSScriptRoot
$log = "$root\tmp\bridge-live.log"
$loop = @"
@echo off
set MTG_TRACE=1
set MTG_RECORD=$root\tmp\tts-stream.jsonl
cd /d "$root\bridge"
:loop
rem (a crash leaves a Node diagnostic report: the bridge once exited with 0xC0000409 and nothing in the log, 2026-10-22)
node --report-on-fatalerror --report-uncaught-exception --report-directory="$root\tmp\node-reports" bridge.js >> "$log" 2>&1
echo [bridge exited with code %errorlevel% at %time%; restarting in 3 s] >> "$log"
timeout /t 3 /nobreak >nul
goto loop
"@
$script = Join-Path $root "tmp\bridge-loop.cmd"
Set-Content -Path $script -Value $loop -Encoding ASCII
& (Join-Path $PSScriptRoot "stop-bridge.ps1") | Out-Null
Start-Process cmd -WindowStyle Hidden -ArgumentList "/c", "`"$script`""
"bridge started (hidden, restarts itself)"
