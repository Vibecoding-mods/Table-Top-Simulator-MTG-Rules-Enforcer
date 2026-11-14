// LoopbackRec: records what the default playback device plays (WASAPI loopback) to a WAV file.
//   LoopbackRec.exe <out.wav> <seconds>
// build (Windows' own C# compiler, .NET Framework 4; the .exe is not in the repo):
//   C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe -nologo -o -out:tools/loopback-rec/LoopbackRec.exe tools/loopback-rec/LoopbackRec.cs
// Prints "recording" once capture has started, so a caller can start a video capture at the same moment.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

class LoopbackRec
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        int GetBufferSize(out uint frames);
        int GetStreamLatency(out long latency);
        int GetCurrentPadding(out uint padding);
        int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        int GetMixFormat(out IntPtr format);
        int GetDevicePeriod(out long defaultPeriod, out long minPeriod);
        int Start();
        int Stop();
        int Reset();
        int SetEventHandle(IntPtr handle);
        int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        int ReleaseBuffer(uint frames);
        int GetNextPacketSize(out uint frames);
    }

    const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;

    static int Main(string[] args)
    {
        if (args.Length < 2) { Console.Error.WriteLine("usage: LoopbackRec <out.wav> <seconds>"); return 2; }
        string outPath = args[0];
        double seconds = double.Parse(args[1], System.Globalization.CultureInfo.InvariantCulture);

        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        IMMDevice device;
        Check(enumerator.GetDefaultAudioEndpoint(0, 1, out device), "GetDefaultAudioEndpoint");
        Guid iidClient = typeof(IAudioClient).GUID;
        object o;
        Check(device.Activate(ref iidClient, 23, IntPtr.Zero, out o), "Activate");
        var client = (IAudioClient)o;
        IntPtr fmtPtr;
        Check(client.GetMixFormat(out fmtPtr), "GetMixFormat");
        short channels = Marshal.ReadInt16(fmtPtr, 2);
        int rate = Marshal.ReadInt32(fmtPtr, 4);
        short blockAlign = Marshal.ReadInt16(fmtPtr, 12);
        short bits = Marshal.ReadInt16(fmtPtr, 14);
        short cbSize = Marshal.ReadInt16(fmtPtr, 16);
        byte[] fmtBytes = new byte[18 + cbSize];
        Marshal.Copy(fmtPtr, fmtBytes, 0, fmtBytes.Length);

        Check(client.Initialize(0, AUDCLNT_STREAMFLAGS_LOOPBACK, 10000000, 0, fmtPtr, IntPtr.Zero), "Initialize");
        Guid iidCapture = typeof(IAudioCaptureClient).GUID;
        Check(client.GetService(ref iidCapture, out o), "GetService");
        var capture = (IAudioCaptureClient)o;

        using (var fs = new FileStream(outPath, FileMode.Create, FileAccess.Write))
        using (var w = new BinaryWriter(fs))
        {
            // RIFF header with the device's own mix format (usually 32-bit float, WAVE_FORMAT_EXTENSIBLE); sizes patched at the end
            w.Write(new[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F' }); w.Write(0);
            w.Write(new[] { (byte)'W', (byte)'A', (byte)'V', (byte)'E' });
            w.Write(new[] { (byte)'f', (byte)'m', (byte)'t', (byte)' ' }); w.Write(fmtBytes.Length); w.Write(fmtBytes);
            w.Write(new[] { (byte)'d', (byte)'a', (byte)'t', (byte)'a' });
            long dataSizePos = fs.Position; w.Write(0);

            Check(client.Start(), "Start");
            Console.WriteLine("recording " + rate + " Hz " + channels + " ch " + bits + " bit");
            Console.Out.Flush();
            var start = DateTime.UtcNow;
            long totalFrames = 0;
            long wantFrames = (long)(seconds * rate);
            byte[] buf = new byte[0];
            while (totalFrames < wantFrames)
            {
                Thread.Sleep(10);
                uint packet;
                Check(capture.GetNextPacketSize(out packet), "GetNextPacketSize");
                if (packet == 0)
                {
                    // loopback delivers nothing while nothing plays: pad with silence to keep wall-clock time
                    long due = (long)((DateTime.UtcNow - start).TotalSeconds * rate);
                    if (due - totalFrames > rate / 10)
                    {
                        long gap = Math.Min(due - totalFrames, wantFrames - totalFrames);
                        w.Write(new byte[gap * blockAlign]);
                        totalFrames += gap;
                    }
                    continue;
                }
                while (packet != 0)
                {
                    IntPtr data; uint frames, flags; ulong dp, qp;
                    Check(capture.GetBuffer(out data, out frames, out flags, out dp, out qp), "GetBuffer");
                    int bytes = (int)frames * blockAlign;
                    if (buf.Length < bytes) buf = new byte[bytes];
                    if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0) Array.Clear(buf, 0, bytes);
                    else Marshal.Copy(data, buf, 0, bytes);
                    w.Write(buf, 0, bytes);
                    totalFrames += frames;
                    capture.ReleaseBuffer(frames);
                    Check(capture.GetNextPacketSize(out packet), "GetNextPacketSize");
                }
            }
            client.Stop();
            long end = fs.Position;
            fs.Position = 4; w.Write((int)(end - 8));
            fs.Position = dataSizePos; w.Write((int)(end - dataSizePos - 4));
        }
        Console.WriteLine("done");
        return 0;
    }

    static void Check(int hr, string what) { if (hr != 0) throw new Exception(what + " failed: 0x" + hr.ToString("X8")); }
}
