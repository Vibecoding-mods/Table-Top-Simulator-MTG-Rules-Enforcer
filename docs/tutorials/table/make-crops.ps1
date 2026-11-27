# Crops real table screenshots for the tutorial. usage: make-crops.ps1 <listfile> <outdir>
# list lines: src|x|y|w|h|outname[|maxWidth]  (w or h 0 = to the edge; a missing source is skipped)
param($list, $outdir)
Add-Type -AssemblyName System.Drawing
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]88)
New-Item -ItemType Directory -Force $outdir | Out-Null
# (the lists say C:\Users\you\mtg-tts for the repo root, scrubbed from the public repo: it is this checkout, three folders up)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$skipped = 0
foreach ($line in Get-Content $list) {
  if ($line -match '^\s*(#|$)') { continue }
  $p = $line.Split('|')
  $p[0] = $p[0].Replace('C:\Users\you\mtg-tts', $root)
  if (-not (Test-Path $p[0])) { "skip $($p[5]): no $($p[0])"; $skipped++; continue }
  $img = [System.Drawing.Image]::FromFile($p[0])
  $x=[int]$p[1]; $y=[int]$p[2]; $w=[int]$p[3]; $h=[int]$p[4]
  if ($w -le 0) { $w = $img.Width - $x }; if ($h -le 0) { $h = $img.Height - $y }
  $max = if ($p.Count -gt 6 -and $p[6]) { [int]$p[6] } else { 1600 }
  $s = [math]::Min(1.0, $max / $w)
  $ow=[int]($w*$s); $oh=[int]($h*$s)
  $bmp = New-Object System.Drawing.Bitmap $ow, $oh
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode='HighQualityBicubic'
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0,0,$ow,$oh), (New-Object System.Drawing.Rectangle $x,$y,$w,$h), [System.Drawing.GraphicsUnit]::Pixel)
  $bmp.Save((Join-Path $outdir $p[5]), $enc, $ep)
  "$($p[5]) ${ow}x${oh} (src ${w}x${h})"
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}
if ($skipped -gt 0) { "$skipped crop(s) skipped: their source shots are not on this machine (tmp/ is not in the repo)"; exit 1 }
