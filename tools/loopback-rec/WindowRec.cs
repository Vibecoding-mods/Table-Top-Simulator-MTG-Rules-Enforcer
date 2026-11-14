// WindowRec: records the Tabletop Simulator window with PrintWindow (works while other windows cover it, unlike
// ffmpeg's gdigrab, which froze on one stale frame behind the Claude window: 2026-11-14) to an mp4 through ffmpeg.
// build (Windows' own C# compiler, .NET Framework 4; the .exe is not in the repo):
//   C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe -nologo -o -r:System.Drawing.dll -out:tools/loopback-rec/WindowRec.exe tools/loopback-rec/WindowRec.cs
//   WindowRec.exe <ffmpeg.exe> <out.mp4> <seconds> [fps]
// Frames go out at a constant rate: a slow grab repeats the last frame, so video time stays wall-clock time.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

class WindowRec
{
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }

    static int Main(string[] args)
    {
        if (args.Length < 3) { Console.Error.WriteLine("usage: WindowRec <ffmpeg.exe> <out.mp4> <seconds> [fps]"); return 2; }
        double seconds = double.Parse(args[2], System.Globalization.CultureInfo.InvariantCulture);
        int fps = args.Length > 3 ? int.Parse(args[3]) : 30;
        IntPtr hwnd = IntPtr.Zero;
        foreach (var p in Process.GetProcesses())
            if (p.ProcessName.StartsWith("Tabletop Simulator") && p.MainWindowHandle != IntPtr.Zero) { hwnd = p.MainWindowHandle; break; }
        if (hwnd == IntPtr.Zero) { Console.Error.WriteLine("Tabletop Simulator window not found"); return 1; }
        RECT r; GetClientRect(hwnd, out r);
        int w = r.R & ~1, h = r.B & ~1;
        var psi = new ProcessStartInfo(args[0],
            "-hide_banner -loglevel error -y -f rawvideo -pix_fmt bgra -s " + w + "x" + h + " -r " + fps +
            " -i - -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \"" + args[1] + "\"");
        psi.UseShellExecute = false; psi.RedirectStandardInput = true;
        var ff = Process.Start(psi);
        var stdin = ff.StandardInput.BaseStream;
        var bmp = new Bitmap(r.R, r.B, PixelFormat.Format32bppArgb);
        byte[] frame = new byte[w * h * 4];
        long total = (long)(seconds * fps), sent = 0;
        var clock = Stopwatch.StartNew();
        Console.WriteLine("recording " + w + "x" + h + " at " + fps + " fps");
        Console.Out.Flush();
        while (sent < total)
        {
            // (not before the next frame is due: a fast grab would run the video ahead of the clock)
            while ((long)(clock.Elapsed.TotalSeconds * fps) < sent) System.Threading.Thread.Sleep(2);
            using (var g = Graphics.FromImage(bmp)) { IntPtr dc = g.GetHdc(); PrintWindow(hwnd, dc, 3); g.ReleaseHdc(dc); }
            var bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            for (int y = 0; y < h; y++) Marshal.Copy(bd.Scan0 + y * bd.Stride, frame, y * w * 4, w * 4);
            bmp.UnlockBits(bd);
            long due = Math.Min(total, (long)(clock.Elapsed.TotalSeconds * fps) + 1);
            do { stdin.Write(frame, 0, frame.Length); sent++; } while (sent < due); // (a slow grab: its frame repeated)
        }
        stdin.Close();
        ff.WaitForExit();
        Console.WriteLine("done " + sent + " frames in " + clock.Elapsed.TotalSeconds.ToString("0.0") + " s");
        return ff.ExitCode;
    }
}
