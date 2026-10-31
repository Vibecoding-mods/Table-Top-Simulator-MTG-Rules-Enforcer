# Captures only the Tabletop Simulator window (any monitor, even behind other windows; not when minimized).
# usage: powershell -File tools/tts-shot.ps1 <out.jpg>
param($out)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; } }
"@
$p = Get-Process | Where-Object { $_.ProcessName -like "Tabletop Simulator*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$r = New-Object W+RECT; [W]::GetClientRect($p.MainWindowHandle, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R), ($r.B)
$g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
[W]::PrintWindow($p.MainWindowHandle, $dc, 3) | Out-Null; $g.ReleaseHdc($dc)
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Jpeg); "$($r.R)x$($r.B)"
