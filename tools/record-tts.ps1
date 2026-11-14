# Records the Tabletop Simulator window with the PC's sound (Stereo Mix) to an mp4, until stopped.
#   powershell -File tools/record-tts.ps1 <out.mp4> [seconds]
# Stop early: write a "q" to the stop file printed at the start, or kill ffmpeg (the file still closes cleanly with q).
param([Parameter(Mandatory = $true)][string]$Out, [int]$Seconds = 120)
$ff = "C:\Users\bruhm\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"
$args = @("-hide_banner", "-loglevel", "error", "-y",
  "-thread_queue_size", "1024", "-f", "gdigrab", "-framerate", "30", "-draw_mouse", "0", "-i", "title=Tabletop Simulator",
  "-thread_queue_size", "1024", "-f", "dshow", "-i", "audio=Stereo Mix (Realtek(R) Audio)",
  "-t", "$Seconds",
  "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", $Out)
& $ff @args
