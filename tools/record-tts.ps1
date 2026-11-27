# Records the Tabletop Simulator window with what the PC plays to an mp4:
#   video: tools/loopback-rec/WindowRec.exe (PrintWindow, so other windows may cover TTS; ffmpeg's gdigrab froze on one
#          stale frame behind the Claude window, 2026-11-14)
#   audio: tools/loopback-rec/LoopbackRec.exe (WASAPI loopback of the default playback device; Stereo Mix only hears the
#          Realtek speakers, so it recorded silence when TTS played on another device, 2026-11-14)
#   powershell -File tools/record-tts.ps1 <out.mp4> [seconds]
param([Parameter(Mandatory = $true)][string]$Out, [int]$Seconds = 120)
$ff = if ($env:FFMPEG) { $env:FFMPEG } else { (Get-Command ffmpeg -ErrorAction Stop).Source } # ffmpeg on PATH, or FFMPEG=<path to ffmpeg.exe>
$dir = Join-Path $PSScriptRoot "loopback-rec"
$wav = [IO.Path]::ChangeExtension($Out, ".wav")
$vid = [IO.Path]::ChangeExtension($Out, ".video.mp4")
$audio = Start-Process -FilePath (Join-Path $dir "LoopbackRec.exe") -ArgumentList @("`"$wav`"", "$Seconds") -NoNewWindow -PassThru
$video = Start-Process -FilePath (Join-Path $dir "WindowRec.exe") -ArgumentList @("`"$ff`"", "`"$vid`"", "$Seconds", "30") -NoNewWindow -PassThru
$audio.WaitForExit(); $video.WaitForExit()
& $ff -hide_banner -loglevel error -y -i $vid -i $wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest $Out
# (the parts are kept when the mux failed: deleting them lost the whole recording, 2026-11-27)
if ($LASTEXITCODE -eq 0 -and (Test-Path $Out)) { Remove-Item $vid, $wav -ErrorAction SilentlyContinue }
else { Write-Error "ffmpeg failed to mux ($LASTEXITCODE); kept $vid and $wav"; exit 1 }
